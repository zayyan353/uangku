/** Frozen explicit commands; the storage coordinator must re-prepare under its lock. */
import { validateEntry, walletBalance, transferPostingDates, type Entry } from './finance';
import { serializeSourceWire } from './sourceCodec';
import { SOURCE_POLICY, canonicalSource, validateSourceDocument, type SourceDocument, type SourceMetadata, type SourceLink, type TransferDecision, type TransferLegAnnotation, type TransferPairing, type TransferContext } from './sourceModel';

export type TransferCommand =
  | { kind: 'pair'; debitId: string; creditId: string; fee: number; rate?: number; note?: string; reason: string; at: string }
  | { kind: 'edit'; entry: Entry; sourceDate: string | null; destinationDate: string | null; declareDates?: true; reason: string; at: string }
  | { kind: 'unpair'; entryId: string; destinationEntryId?: string; useBankAnnotations?: true; reason: string; at: string }
  | { kind: 'delete'; entryId: string; reason: string; at: string }
  | { kind: 'restore-deleted'; entryId: string; reason: string; at: string };
const canonical = (value: unknown): string => JSON.stringify(canonicalSource(value));
const signed = (entry: Entry): number => entry.type === 'expense' ? -entry.amount : entry.type === 'transfer' ? -entry.amount - (entry.fee ?? 0) : entry.amount;
function fail(message: string): never { throw new Error(message); }
function decision(command: TransferDecision): TransferDecision {
  if (!command.reason.trim() || !Number.isFinite(Date.parse(command.at))) fail('Isi alasan dan waktu keputusan transfer yang valid.');
  return { reason: command.reason.trim(), at: command.at };
}
function metadata(data: SourceDocument): SourceMetadata {
  return data.metadata ??= { policy: SOURCE_POLICY, facts: [], links: [], statements: [] };
}
function finish(data: SourceDocument): SourceDocument {
  data.state.wallets.forEach(wallet => walletBalance(data.state, wallet.id, data.metadata));
  const result = validateSourceDocument(data); serializeSourceWire(result); return result;
}
function entryById(data: SourceDocument, id: string): Entry {
  return data.state.entries.find(entry => entry.id === id) ?? fail('Transaksi transfer tidak ditemukan.');
}
function linkFor(data: SourceDocument, id: string): SourceLink | undefined { return data.metadata?.links.find(link => link.entryId === id); }
function factMismatch(data: SourceDocument, entry: Entry, sourceDate: string | null, destinationDate: string | null, link = linkFor(data, entry.id)): boolean {
  return (['source','destination'] as const).some(role => {
    const fact = data.metadata?.facts.find(row => row.id === link?.[role]); if (!fact) return false;
    return fact.walletId !== (role === 'source' ? entry.walletId : entry.toWalletId)
      || fact.postedOn !== (role === 'source' ? sourceDate : destinationDate)
      || fact.signedAmount !== (role === 'source' ? signed(entry) : entry.toAmount);
  });
}
function setOverride(m: SourceMetadata, entryId: string, command: TransferDecision): void {
  m.overrides = [...(m.overrides ?? []).filter(item => item.entryId !== entryId), { entryId, ...decision(command) }];
}
function annotation(entry: Entry): TransferLegAnnotation {
  if (!['income','expense','unreviewed','movement'].includes(entry.type)) fail('Pasangan harus berupa pemasukan, pengeluaran, atau perpindahan rekening.');
  return { type: entry.type as TransferLegAnnotation['type'], category: entry.category, note: entry.note, ...(entry.importBatch !== undefined ? { importBatch: entry.importBatch } : {}) };
}
function retainAnnotation(m: SourceMetadata, sourceId: string | undefined, entry: Entry): void {
  if (!sourceId) return;
  m.annotations = [...(m.annotations ?? []).filter(item => item.sourceId !== sourceId), { sourceId, category: entry.category, note: entry.note, confirmedType: entry.type as 'income'|'expense'|'unreviewed'|'movement', ...(entry.importBatch !== undefined ? { importBatch: entry.importBatch } : {}) }];
}
function storedAnnotation(data: SourceDocument, sourceId: string | undefined, inline: TransferLegAnnotation | undefined): TransferLegAnnotation | undefined {
  if (!sourceId) return inline;
  const row = data.metadata?.annotations?.find(item => item.sourceId === sourceId);
  if (!row || row.category === undefined || row.note === undefined || row.confirmedType === undefined) return undefined;
  return { type: row.confirmedType, category: row.category, note: row.note, ...(row.importBatch !== undefined ? { importBatch: row.importBatch } : {}) };
}
function pairContext(data: SourceDocument, entry: Entry): TransferPairing | undefined {
  const context = data.metadata?.transfers?.find(row => row.entryId === entry.id)?.pairing;
  if (context) return context;
  const link = linkFor(data, entry.id);
  return link?.pairing ? { ...link.pairing } : undefined;
}
function pair(data: SourceDocument, command: Extract<TransferCommand,{kind:'pair'}>): SourceDocument {
  const debit = entryById(data, command.debitId), credit = entryById(data, command.creditId);
  if (debit.id === credit.id || debit.walletId === credit.walletId) fail('Pilih dua mutasi berbeda pada dompet yang berbeda.');
  annotation(debit); annotation(credit);
  if (signed(debit) >= 0 || signed(credit) <= 0) fail('Pasangan harus mempunyai satu debit dan satu kredit.');
  if (!Number.isSafeInteger(command.fee) || command.fee < 0) fail('Biaya transfer belum valid.');
  const principal = -signed(debit) - command.fee;
  if (!Number.isSafeInteger(principal) || principal <= 0) fail('Biaya harus lebih kecil dari jumlah debit; nominal debit sudah mencakup biaya.');
  const m = metadata(data), debitLink = linkFor(data,debit.id), creditLink = linkFor(data,credit.id);
  if (debit.toSourceKey || credit.toSourceKey || debitLink?.destination || creditLink?.destination) fail('Konteks sumber mutasi biasa tidak dapat dipasangkan tanpa peninjauan.');
  const sourceWallet = data.state.wallets.find(wallet => wallet.id === debit.walletId)!;
  const destinationWallet = data.state.wallets.find(wallet => wallet.id === credit.walletId)!;
  const group: Entry = { id: debit.id, type:'transfer', walletId:debit.walletId, date:debit.date, amount:principal,
    toWalletId:credit.walletId, toAmount:signed(credit), fee:command.fee, category:'',
    note:command.note ?? `Transfer ${sourceWallet.name} → ${destinationWallet.name}`,
    ...(command.rate !== undefined ? {rate:command.rate} : {}),
    ...(debit.sourceKey !== undefined ? {sourceKey:debit.sourceKey} : {}),
    ...(credit.sourceKey !== undefined ? {toSourceKey:credit.sourceKey} : {}),
    ...(debit.importBatch !== undefined ? {importBatch:debit.importBatch} : {}) };
  const sourceId = debitLink?.source, destinationId = creditLink?.source;
  const origins = new Map(m.creationOrigins?.map(row => [row.entryId,row.origin]));
  const overrides = new Map(m.overrides?.map(row => [row.entryId,{reason:row.reason,at:row.at}]));
  const pairing: TransferPairing = { sourceEntryId:debit.id, destinationEntryId:credit.id,
    ...(origins.has(debit.id) ? {sourceOrigin:origins.get(debit.id)!} : {}),
    ...(origins.has(credit.id) ? {destinationOrigin:origins.get(credit.id)!} : {}),
    ...(overrides.has(debit.id) ? {sourceOverride:overrides.get(debit.id)!} : {}),
    ...(overrides.has(credit.id) ? {destinationOverride:overrides.get(credit.id)!} : {}),
    ...(!sourceId ? {sourceAnnotation:annotation(debit)} : {}),
    ...(!destinationId ? {destinationAnnotation:annotation(credit)} : {}) };
  retainAnnotation(m,sourceId,debit); retainAnnotation(m,destinationId,credit);
  const insertion = Math.min(data.state.entries.indexOf(debit),data.state.entries.indexOf(credit));
  data.state.entries = data.state.entries.filter(entry => entry.id !== debit.id && entry.id !== credit.id);
  const problem = validateEntry(data.state,group); if (problem) fail(problem);
  data.state.entries.splice(insertion,0,group);
  m.links = m.links.filter(link => link.entryId !== debit.id && link.entryId !== credit.id);
  if (sourceId || destinationId) m.links.push({entryId:group.id,...(sourceId?{source:sourceId}:{}),...(destinationId?{destination:destinationId}:{})});
  m.transfers = [...(m.transfers ?? []).filter(row => row.entryId !== debit.id && row.entryId !== credit.id), {entryId:group.id,sourceDate:debit.date,destinationDate:credit.date,pairing,...(!sourceId && !destinationId ? {decision:decision(command)} : {})}];
  if (m.creationOrigins) m.creationOrigins = m.creationOrigins.filter(row => row.entryId !== credit.id);
  if (m.overrides) m.overrides = m.overrides.filter(row => row.entryId !== credit.id);
  if (factMismatch(data,group,debit.date,credit.date)) setOverride(m,group.id,command);
  return finish(data);
}
function edit(data: SourceDocument, command: Extract<TransferCommand,{kind:'edit'}>): SourceDocument {
  const old = data.state.entries.find(row => row.id === command.entry.id);
  if (command.entry.type !== 'transfer') fail('Gunakan pemisahan transfer sebelum mengubahnya menjadi dua catatan biasa.');
  if (old && old.type !== 'transfer' && linkFor(data,old.id)) fail('Untuk mutasi bersumber, pilih pasangan dua posting agar sumber dan tanggal tidak hilang.');
  const m = metadata(data); const entry = structuredClone(command.entry);
  entry.date = command.sourceDate ?? old?.date ?? entry.date;
  const link = linkFor(data,entry.id);
  if (link?.source) entry.sourceKey = m.facts.find(fact => fact.id === link.source)!.fingerprint;
  if (link?.destination) entry.toSourceKey = m.facts.find(fact => fact.id === link.destination)!.fingerprint;
  const oldDates = old ? transferPostingDates(old,m) : null;
  const changed = old && canonical([old.walletId,old.toWalletId,old.amount,old.toAmount,old.rate ?? null,old.fee ?? 0,oldDates?.source,oldDates?.destination])
    !== canonical([entry.walletId,entry.toWalletId,entry.amount,entry.toAmount,entry.rate ?? null,entry.fee ?? 0,command.sourceDate,command.destinationDate]);
  if (link && (changed || command.declareDates)) setOverride(m,entry.id,command);
  const index = data.state.entries.findIndex(row => row.id === entry.id);
  const clean = {...data.state,entries:data.state.entries.filter(row => row.id !== entry.id)};
  const problem = validateEntry(clean,entry); if (problem) fail(problem);
  if (index < 0) { data.state.entries.push(entry); m.creationOrigins = [...(m.creationOrigins ?? []), {entryId:entry.id,origin:'manual'}]; }
  else data.state.entries[index] = entry;
  const previous = m.transfers?.find(row => row.entryId === entry.id);
  // A memo or unrelated financial correction does not recover missing bank dates.
  const keepLegacyDates = old?.type === 'transfer' && !previous && !link?.postingDates && !command.declareDates
    && command.sourceDate === oldDates?.source && command.destinationDate === oldDates?.destination;
  if (keepLegacyDates && changed && !link) fail('Nyatakan tanggal kedua sisi (atau tandai belum diketahui) sebelum mengubah nilai finansial transfer lama; alasan belum disimpan. Catatan lama tetap dipertahankan.');
  const context: TransferContext = {entryId:entry.id,sourceDate:command.sourceDate,destinationDate:command.destinationDate,...(previous?.pairing?{pairing:previous.pairing}:{}),
    ...(!link && !keepLegacyDates ? !old || changed || !previous ? {decision:decision(command)} : previous?.decision ? {decision:previous.decision} : {} : {})};
  if (!keepLegacyDates) m.transfers = [...(m.transfers ?? []).filter(row => row.entryId !== entry.id),context];
  if (link?.postingDates) link.postingDates = {source:command.sourceDate,destination:command.destinationDate};
  return finish(data);
}

export function getTransferUnpairProblem(data: SourceDocument, entryId: string, options: {useBankAnnotations?: boolean} = {}): string | null {
  const entry = data.state.entries.find(row => row.id === entryId);
  if (!entry || entry.type !== 'transfer') return 'Transaksi transfer tidak ditemukan.';
  const dates = transferPostingDates(entry,data.metadata);
  if (dates.basis === 'legacy-assumed') return 'Transfer lama hanya mempunyai satu tanggal pengamatan. Nyatakan tanggal kedua sisi melalui Ubah transfer sebelum memisahkan posting.';
  if (dates.source === null || dates.destination === null) return 'Tanggal kedua sisi harus diketahui atau dinyatakan pengguna sebelum posting dipisahkan.';
  const link = linkFor(data,entry.id), context = pairContext(data,entry);
  const completeFacts = !!link?.source && !!link.destination
    && data.metadata?.facts.some(fact => fact.id === link.source && fact.signedAmount < 0)
    && data.metadata?.facts.some(fact => fact.id === link.destination && fact.signedAmount > 0);
  if (!context && !link && !entry.sourceKey && !entry.toSourceKey) return null;
  if (!context && !completeFacts) return 'Fakta bank debit dan kredit belum lengkap. Fingerprint lama bukan pengganti nominal, tanggal, dan keterangan sumber. Pertahankan transfer; pulihkan cadangan yang masih memiliki kedua fakta atau tinjau bukti bank terlebih dahulu. Rekonstruksi otomatis tidak tersedia.';
  for (const role of ['source','destination'] as const) {
    if (storedAnnotation(data,link?.[role],context?.[role === 'source' ? 'sourceAnnotation' : 'destinationAnnotation'])) continue;
    if (completeFacts && options.useBankAnnotations) continue;
    return 'Anotasi posting lama tidak lengkap. Jika kedua fakta bank tersedia, pilih secara eksplisit untuk memakai keterangan bank sebagai anotasi baru; catatan pengguna lama yang hilang tidak dapat dipulihkan otomatis.';
  }
  return null;
}
function unpair(data: SourceDocument, command: Extract<TransferCommand,{kind:'unpair'}>): SourceDocument {
  const problem = getTransferUnpairProblem(data,command.entryId,command); if (problem) fail(problem);
  const entry = entryById(data,command.entryId), m = metadata(data), link = linkFor(data,entry.id), pairing = pairContext(data,entry);
  const dates = transferPostingDates(entry,m); const intent = decision(command);
  const sourceId = pairing?.sourceEntryId ?? entry.id;
  const destinationId = pairing?.destinationEntryId ?? command.destinationEntryId;
  if (!destinationId || destinationId === sourceId) fail('ID baru untuk posting tujuan diperlukan untuk pemisahan transfer manual.');
  const recoveredAnnotation = (role:'source'|'destination'):TransferLegAnnotation => {
    const ref = link?.[role], saved = m.annotations?.find(row => row.sourceId === ref);
    const fact = m.facts.find(row => row.id === ref);
    if (command.useBankAnnotations && fact) return {type:'unreviewed',category:saved?.category ?? 'Belum dikategorikan',note:saved?.note ?? fact.description,
      ...(saved?.importBatch!==undefined?{importBatch:saved.importBatch}:{})};
    return {type:'unreviewed',category:entry.category,note:entry.note};
  };
  const sourceAnnotation = storedAnnotation(data,link?.source,pairing?.sourceAnnotation) ?? recoveredAnnotation('source');
  const destinationAnnotation = storedAnnotation(data,link?.destination,pairing?.destinationAnnotation) ?? recoveredAnnotation('destination');
  const leg = (id:string,role:'source'|'destination',saved:TransferLegAnnotation):Entry => ({id,type:saved.type==='movement'?'movement':'unreviewed',walletId:role==='source'?entry.walletId:entry.toWalletId!,
    date:(role==='source'?dates.source:dates.destination)!,amount:role==='source'?signed(entry):entry.toAmount!,category:saved.category,note:saved.note,
    ...(saved.importBatch!==undefined?{importBatch:saved.importBatch}:{}),
    ...((role==='source'?entry.sourceKey:entry.toSourceKey)!==undefined?{sourceKey:(role==='source'?entry.sourceKey:entry.toSourceKey)!}:{})});
  const source = leg(sourceId,'source',sourceAnnotation), destination = leg(destinationId,'destination',destinationAnnotation);
  const remaining = data.state.entries.filter(row => row.id !== entry.id);
  if (remaining.some(row => row.id === source.id || row.id === destination.id)) fail('ID posting hasil pemisahan sudah dipakai catatan lain. Data lama dipertahankan.');
  const groupOrigin = m.creationOrigins?.find(row => row.entryId === entry.id)?.origin;
  const groupDecision = m.transfers?.find(row => row.entryId === entry.id)?.decision;
  m.unpairings = [...(m.unpairings ?? []).filter(row => row.id !== entry.id), {id:entry.id,sourceEntryId:source.id,destinationEntryId:destination.id,
    sourceWalletId:entry.walletId,destinationWalletId:entry.toWalletId!,sourceDate:dates.source!,destinationDate:dates.destination!,principal:entry.amount,toAmount:entry.toAmount!,
    ...(entry.rate!==undefined?{rate:entry.rate}:{}),fee:entry.fee??0,...intent,groupNote:entry.note,...(pairing?{pairing}:{}),
    ...(link?.source?{source:link.source}:{}),...(link?.destination?{destination:link.destination}:{}),...(groupOrigin?{groupOrigin}:{}),...(groupDecision?{groupDecision}:{})}];
  const insertion = data.state.entries.findIndex(row => row.id === entry.id);
  data.state.entries = remaining; data.state.entries.splice(insertion,0,source,destination);
  m.transfers = m.transfers?.filter(row => row.entryId !== entry.id);
  m.links = m.links.filter(row => row.entryId !== entry.id);
  if (link?.source) m.links.push({entryId:source.id,source:link.source});
  if (link?.destination) m.links.push({entryId:destination.id,source:link.destination});
  const groupOverride = m.overrides?.find(row => row.entryId === entry.id);
  if (m.overrides) m.overrides = m.overrides.filter(row => row.entryId !== entry.id);
  if (m.creationOrigins) m.creationOrigins = m.creationOrigins.filter(row => row.entryId !== entry.id);
  for (const [role,posting] of [['source',source],['destination',destination]] as const) {
    const origin = pairing?.[role==='source'?'sourceOrigin':'destinationOrigin']
      ?? (!pairing && posting.id===entry.id ? groupOrigin : undefined)
      ?? (!pairing && !link ? 'manual' : undefined);
    if (origin) m.creationOrigins = [...(m.creationOrigins ?? []),{entryId:posting.id,origin}];
    const sourceRef = link?.[role];
    if (sourceRef) {
      const fact = m.facts.find(row => row.id === sourceRef)!;
      const differs = fact.walletId !== posting.walletId || fact.postedOn !== posting.date || fact.signedAmount !== posting.amount;
      const oldOverride = pairing?.[role==='source'?'sourceOverride':'destinationOverride'];
      if (differs) setOverride(m,posting.id,groupOverride ?? command);
      else if (oldOverride) m.overrides = [...(m.overrides ?? []),{entryId:posting.id,...oldOverride}];
      // Unpair explicitly changes classification to pending; preserve notes/category/batch.
      retainAnnotation(m,sourceRef,posting);
    }
  }
  return finish(data);
}

/** Move the complete current interpretation out of the financial ledger once. */
function deleteTransfer(data: SourceDocument, command: Extract<TransferCommand,{kind:'delete'}>): SourceDocument {
  const entry = entryById(data,command.entryId);
  if (entry.type !== 'transfer') fail('Perintah hapus transfer memerlukan grup transfer.');
  const intent = decision(command), link = linkFor(data,entry.id);
  if (link || entry.sourceKey || entry.toSourceKey) {
    const m=metadata(data), context=m.transfers?.find(row=>row.entryId===entry.id), override=m.overrides?.find(row=>row.entryId===entry.id), origin=m.creationOrigins?.find(row=>row.entryId===entry.id)?.origin;
    m.deletedTransfers=[...(m.deletedTransfers??[]).filter(row=>row.entry.id!==entry.id),{entry,...(context?{context}:{}),...(link?{link}:{}),...(override?{override:{reason:override.reason,at:override.at}}:{}),...(origin?{origin}:{}),...intent}];
    for (const ref of [link?.source,link?.destination]) if(ref) m.dispositions=[...(m.dispositions??[]).filter(row=>row.sourceId!==ref),{sourceId:ref,kind:'deleted',...intent}];
    m.links=m.links.filter(row=>row.entryId!==entry.id);
  }
  data.state.entries = data.state.entries.filter(row => row.id !== entry.id);
  if (data.metadata) {
    const m=data.metadata;
    if (m.transfers) m.transfers=m.transfers.filter(row => row.entryId !== entry.id);
    if (m.creationOrigins) m.creationOrigins=m.creationOrigins.filter(row => row.entryId !== entry.id);
    if (m.overrides) m.overrides=m.overrides.filter(row => row.entryId !== entry.id);
  }
  return finish(data);
}

/** Explicit restoration preserves the deleted group's corrections and both legs. */
function restoreDeleted(data: SourceDocument, command: Extract<TransferCommand,{kind:'restore-deleted'}>): SourceDocument {
  decision(command);
  const m=metadata(data), saved=m.deletedTransfers?.find(row=>row.entry.id===command.entryId);
  if(!saved) fail('Grup transfer terhapus tidak ditemukan atau sudah dipulihkan. Baca ulang pratinjau.');
  const usedIds=new Set([saved.entry.id,...(saved.context?.pairing?[saved.context.pairing.sourceEntryId,saved.context.pairing.destinationEntryId]:saved.link?.pairing?[saved.link.pairing.sourceEntryId,saved.link.pairing.destinationEntryId]:[])]);
  if(data.state.entries.some(row=>usedIds.has(row.id))) fail('ID grup atau posting lama sudah dipakai. Pemulihan seluruh grup ditolak tanpa perubahan; tinjau catatan yang bertabrakan.');
  const refs=[saved.link?.source,saved.link?.destination].filter((ref):ref is string=>!!ref);
  if(m.links.some(link=>refs.some(ref=>link.source===ref||link.destination===ref))) fail('Salah satu sumber grup sudah diwakili transaksi lain. Pemulihan ditolak agar mutasi tidak dihitung dua kali.');
  const aliases=new Set([saved.entry.sourceKey,saved.entry.toSourceKey,...refs.map(ref=>m.facts.find(fact=>fact.id===ref)?.fingerprint)].filter((fp):fp is string=>!!fp));
  if(data.state.entries.some(entry=>[entry.sourceKey,entry.toSourceKey].some(fp=>!!fp&&aliases.has(fp)))
    || m.links.some(link=>[link.source,link.destination].some(ref=>!!ref&&aliases.has(m.facts.find(fact=>fact.id===ref)!.fingerprint)))) fail('Referensi lama salah satu sisi juga terdapat pada catatan aktif. Identitas belum dapat dipastikan; pemulihan seluruh grup ditolak agar tidak menggandakan mutasi.');
  data.state.entries.push(saved.entry);
  if(saved.context) m.transfers=[...(m.transfers??[]),saved.context];
  if(saved.link) m.links.push(saved.link);
  if(saved.override) m.overrides=[...(m.overrides??[]),{entryId:saved.entry.id,...saved.override}];
  if(saved.origin) m.creationOrigins=[...(m.creationOrigins??[]),{entryId:saved.entry.id,origin:saved.origin}];
  if(m.dispositions) m.dispositions=m.dispositions.filter(row=>!refs.includes(row.sourceId));
  m.deletedTransfers=m.deletedTransfers!.filter(row=>row.entry.id!==saved.entry.id);
  return finish(data);
}

export function executeTransferCommand(document: SourceDocument, command: TransferCommand): SourceDocument {
  const data = structuredClone(document);
  if (command.kind === 'pair') return pair(data,command);
  if (command.kind === 'edit') return edit(data,command);
  if (command.kind === 'unpair') return unpair(data,command);
  if (command.kind === 'delete') return deleteTransfer(data,command);
  if (command.kind === 'restore-deleted') return restoreDeleted(data,command);
  return fail('Jenis perintah transfer belum didukung.');
}
