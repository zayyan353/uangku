/** Source-aware commands. No command invents bank facts from mutable entries. */
import { validateEntry, walletBalance, transferPostingDates, createPostingDateIndex, entryPostings, type Entry, type State, type Wallet } from './finance';
import { executeTransferCommand } from './transferCommands';
import { inspectImport, prepareImport, type ImportDecisions, type ImportInspection } from './importCommit';
import { entriesFromImport, type ImportPreview, type ImportRow } from './importer';
import { serializeSourceWire } from './sourceCodec';
import {
  SOURCE_POLICY, canonicalSource, validateSourceDocument,
  type SourceAnnotation, type SourceDocument, type SourceFact, type SourceLink,
  type SourceMetadata, type SourceOverride, type SourceStatement,
} from './sourceModel';

export type SourceResolution = 'keep' | 'restore' | 'skip' | 'distinct';
export interface SourcedImportDecision { signature: string; resolution: SourceResolution }
export type SourcedImportDecisions = Record<string, SourcedImportDecision | undefined>;
export type SourceReviewStatus = 'known-overridden' | 'known-deleted' | 'known-deleted-transfer' | 'known-excluded' | 'known-deferred' | 'known-unrepresented' | 'legacy-uncertain' | 'identity-ambiguous' | 'transfer-limited' | 'alternate-source';
export interface SourceReview {
  status: SourceReviewStatus; signature: string; message: string;
  sourceId?: string; entryId?: string; allowedResolutions: SourceResolution[];
}
export interface SourcedInspection extends ImportInspection { sourceReviews: Record<string, SourceReview> }
export type SourcedImportPreparation =
  | { status: 'ready'; data: SourceDocument; state: State; entries: Entry[]; inspection: SourcedInspection }
  | { status: 'review'; inspection: SourcedInspection }
  | { status: 'invalid'; inspection: SourcedInspection; message: string };
export interface SourceCommandDecision { reason: string; at: string }
const E4_MESSAGE = 'Transfer dengan fakta sumber belum dapat diubah, dipasangkan, dipulihkan, atau dihapus sebelum pengamanan dua sisi E4. Fakta sumber tetap dipertahankan.';
const signed = (entry: Entry): number => ['income', 'adjustment', 'unreviewed', 'movement'].includes(entry.type) ? entry.amount : -entry.amount - (entry.fee ?? 0);
const sourceRefs = (link: SourceLink): string[] => [link.source, link.destination].filter((id): id is string => !!id);
const canonical = (value: unknown): string => JSON.stringify(canonicalSource(value));
function emptyMetadata(): SourceMetadata { return { policy: SOURCE_POLICY, facts: [], links: [], statements: [] }; }
function requireDecision(decision: SourceCommandDecision): void {
  if (!decision.reason.trim()) throw new Error('Isi alasan perubahan atau penghapusan fakta sumber.');
  if (!Number.isFinite(Date.parse(decision.at))) throw new Error('Waktu keputusan sumber tidak valid.');
}
function finalDocument(data: SourceDocument): SourceDocument {
  const normalized = validateSourceDocument(data);
  if (normalized.metadata) serializeSourceWire(normalized); // final persisted/backup representation, never character count
  return normalized;
}
function factFor(row: ImportRow, wallet: Wallet, id: string): SourceFact {
  return { id, walletId: wallet.id, currency: wallet.currency, postedOn: row.date,
    signedAmount: row.amount, balanceAfter: row.balance,
    description: row.originalDescription ?? row.description,
    reference: row.originalReference ?? row.reference,
    fingerprintVersion: row.fingerprintVersion ?? (row.sourceKey.startsWith('generic:') ? 'generic-v1' : 'ziraat-v1'), fingerprint: row.sourceKey };
}
function factSignature(fact: SourceFact): string {
  return canonical([fact.walletId, fact.currency, fact.postedOn, fact.signedAmount, fact.balanceAfter,
    fact.description, fact.reference ?? null, fact.fingerprintVersion, fact.fingerprint]);
}
function financial(entry: Entry, link: SourceLink, role: 'source' | 'destination') {
  return { walletId: role === 'source' ? entry.walletId : entry.toWalletId!,
    date: entry.type === 'transfer' && link.postingDates ? link.postingDates[role] : entry.date,
    signedAmount: role === 'source' ? signed(entry) : entry.toAmount! };
}
export function sourceEntryComparison(data: SourceDocument, entryId: string) {
  const entry = data.state.entries.find(item => item.id === entryId);
  if (!entry) throw new Error('Transaksi tidak ditemukan.');
  const link = data.metadata?.links.find(item => item.entryId === entryId);
  const facts = (['source', 'destination'] as const).flatMap(role => {
    const sourceId = link?.[role]; const fact = data.metadata?.facts.find(item => item.id === sourceId);
    if (!fact || !link) return [];
    const current = financial(entry, link, role);
    if (entry.type === 'transfer') current.date = transferPostingDates(entry,data.metadata)[role];
    const changes = { wallet: current.walletId !== fact.walletId, date: current.date !== fact.postedOn, amount: current.signedAmount !== fact.signedAmount };
    return [{ role, fact, current, changes, represented: !Object.values(changes).some(Boolean) }];
  });
  return { entry, facts, financialChanged: facts.some(item => !item.represented),
    override: data.metadata?.overrides?.find(item => item.entryId === entryId),
    creationOrigin: data.metadata?.creationOrigins?.find(item => item.entryId === entryId)?.origin,
    transferLimited: !!link && entry.type === 'transfer' && !data.metadata?.transfers?.some(row => row.entryId === entry.id) };
}
function annotation(sourceId: string, entry: Entry): SourceAnnotation {
  return { sourceId, category: entry.category, note: entry.note,
    ...(['income','expense','unreviewed','movement'].includes(entry.type) ? { confirmedType: entry.type as SourceAnnotation['confirmedType'] } : {}),
    ...(entry.importBatch ? { importBatch: entry.importBatch } : {}) };
}
function putAnnotation(metadata: SourceMetadata, sourceId: string, entry: Entry): void {
  metadata.annotations = [...(metadata.annotations ?? []).filter(item => item.sourceId !== sourceId), annotation(sourceId, entry)];
}
function putOverride(metadata: SourceMetadata, entryId: string, decision: SourceCommandDecision): void {
  requireDecision(decision);
  metadata.overrides = [...(metadata.overrides ?? []).filter(item => item.entryId !== entryId), { entryId, reason: decision.reason.trim(), at: decision.at }];
}

/** Financial changes require a reason; category/note edits do not become money overrides. */
export function applySourcedEntryEdit(data: SourceDocument, edited: Entry, removeIds: string[], decision: SourceCommandDecision): SourceDocument {
  const previous = data.state.entries.find(row => row.id === edited.id);
  if (edited.type === 'transfer' || previous?.type === 'transfer') {
    if (edited.type !== 'transfer' || previous && previous.type !== 'transfer') throw new Error('Ubah pasangan transfer melalui perintah pasangkan atau pisahkan transfer.');
    const dates = transferPostingDates(edited,data.metadata);
    return executeTransferCommand(data,{kind:'edit',entry:edited,sourceDate:dates.source,destinationDate:dates.destination,...decision});
  }
  if(removeIds.some(id=>id!==edited.id))throw new Error('Perubahan catatan biasa tidak boleh menghapus transaksi lain. Gunakan perintah pasangan transfer yang eksplisit.');
  const next = structuredClone(data);
  const metadata = next.metadata;
  const removed = new Set([...removeIds, edited.id]);
  const sourceLinks = metadata?.links.filter(link => removed.has(link.entryId)) ?? [];
  for (const link of sourceLinks) {
    const old = data.state.entries.find(entry => entry.id === link.entryId)!;
    if (link.entryId !== edited.id || old.type === 'transfer' &&
      canonical([old.date,old.type,old.walletId,old.amount,old.toWalletId ?? null,old.toAmount ?? null,old.rate ?? null,old.fee ?? null]) !==
      canonical([edited.date,edited.type,edited.walletId,edited.amount,edited.toWalletId ?? null,edited.toAmount ?? null,edited.rate ?? null,edited.fee ?? null])) throw new Error(E4_MESSAGE);
  }
  const entry = { ...edited };
  const ownLink = metadata?.links.find(link => link.entryId === entry.id);
  if (ownLink?.source) entry.sourceKey = metadata!.facts.find(fact => fact.id === ownLink.source)!.fingerprint;
  if (ownLink?.destination) entry.toSourceKey = metadata!.facts.find(fact => fact.id === ownLink.destination)!.fingerprint;
  const insertion = next.state.entries.findIndex(item => removed.has(item.id));
  next.state.entries = next.state.entries.filter(item => !removed.has(item.id));
  const problem = validateEntry(next.state, entry); if (problem) throw new Error(problem);
  next.state.entries.splice(insertion < 0 ? next.state.entries.length : insertion, 0, entry);
  if (metadata && ownLink) {
    const comparison = sourceEntryComparison(next, entry.id);
    if (comparison.financialChanged) {
      const old = data.state.entries.find(item => item.id === entry.id);
      const changedNow = !old || old.walletId !== entry.walletId || old.date !== entry.date || signed(old) !== signed(entry);
      if (changedNow) putOverride(metadata, entry.id, decision);
    }
    // A transfer's memo is a group annotation, never overwrite per-bank-row notes.
    if (entry.type !== 'transfer') for (const ref of sourceRefs(ownLink)) putAnnotation(metadata, ref, entry);
  } else if (metadata && !data.state.entries.some(item => item.id === entry.id)) {
    metadata.creationOrigins = [...(metadata.creationOrigins ?? []), { entryId: entry.id, origin: 'manual' }];
  }
  for (const wallet of next.state.wallets) walletBalance(next.state, wallet.id);
  return finalDocument(next);
}

/** Ordinary delete removes the effective posting but retains its original source and decision. */
export function deleteSourcedEntry(data: SourceDocument, entryId: string, decision: SourceCommandDecision): SourceDocument {
  if (data.state.entries.find(row => row.id === entryId)?.type === 'transfer') return executeTransferCommand(data,{kind:'delete',entryId,...decision});
  const next = structuredClone(data);
  const entry = next.state.entries.find(item => item.id === entryId);
  if (!entry) throw new Error('Transaksi tidak ditemukan.');
  const metadata = next.metadata; const link = metadata?.links.find(item => item.entryId === entryId);
  if (link && entry.type === 'transfer') throw new Error(E4_MESSAGE);
  if (link && metadata) {
    requireDecision(decision);
    for (const ref of sourceRefs(link)) {
      putAnnotation(metadata, ref, entry);
      metadata.dispositions = [...(metadata.dispositions ?? []).filter(item => item.sourceId !== ref),
        { sourceId: ref, kind: 'deleted', reason: decision.reason.trim(), at: decision.at }];
    }
    metadata.links = metadata.links.filter(item => item.entryId !== entryId);
    if (metadata.overrides) metadata.overrides = metadata.overrides.filter(item => item.entryId !== entryId);
    if (metadata.creationOrigins) metadata.creationOrigins = metadata.creationOrigins.filter(item => item.entryId !== entryId);
  }
  next.state.entries = next.state.entries.filter(item => item.id !== entryId);
  return finalDocument(next);
}


interface SourceIndex {
  factsByFingerprint: Map<string, SourceFact[]>;
  factsByContent: Map<string, SourceFact[]>;
  aliasesByMovement: Map<string, Entry[]>;
  entries: Map<string, Entry>; linksBySource: Map<string, SourceLink>;
  legacyByFingerprint: Map<string, Entry[]>;
  deletedByFingerprint: Map<string, NonNullable<SourceMetadata['deletedTransfers']>>;
  dispositions: Map<string, NonNullable<SourceMetadata['dispositions']>[number]>;
  annotations: Map<string, SourceAnnotation>; overrides: Map<string, SourceOverride>;
  manualByMovement: Map<string, Entry[]>;
  dates: ReturnType<typeof createPostingDateIndex>;
}
interface Match {
  fact?: SourceFact; link?: SourceLink; entry?: Entry; legacyEntry?: Entry;
  deletedTransfer?: NonNullable<SourceMetadata['deletedTransfers']>[number];
  alternateFacts?: SourceFact[]; alternateLegacy?: Entry[];
  ambiguous: boolean; collision: boolean; signatureParts: unknown[];
}
function sourceIndex(data: SourceDocument): SourceIndex {
  const index: SourceIndex = {factsByFingerprint:new Map(),factsByContent:new Map(),aliasesByMovement:new Map(),entries:new Map(data.state.entries.map(row=>[row.id,row])),linksBySource:new Map(),legacyByFingerprint:new Map(),deletedByFingerprint:new Map(),dispositions:new Map((data.metadata?.dispositions??[]).map(row=>[row.sourceId,row])),annotations:new Map((data.metadata?.annotations??[]).map(row=>[row.sourceId,row])),overrides:new Map((data.metadata?.overrides??[]).map(row=>[row.entryId,row])),manualByMovement:manualSourceCandidates(data),dates:createPostingDateIndex(data.metadata)};
  const linkedIds=new Set<string>();
  for(const link of data.metadata?.links??[]) {linkedIds.add(link.entryId);for(const ref of sourceRefs(link))index.linksBySource.set(ref,link);}
  for(const fact of data.metadata?.facts??[]){const contentKey=sourceContentKey(fact),content=index.factsByContent.get(contentKey)??[];content.push(fact);index.factsByContent.set(contentKey,content);const rows=index.factsByFingerprint.get(fact.fingerprint)??[];rows.push(fact);index.factsByFingerprint.set(fact.fingerprint,rows);}
  for(const entry of data.state.entries) if(!linkedIds.has(entry.id)) for(const fp of new Set([entry.sourceKey,entry.toSourceKey]))if(fp){const rows=index.legacyByFingerprint.get(fp)??[];rows.push(entry);index.legacyByFingerprint.set(fp,rows);}
  const linksByEntry = new Map((data.metadata?.links ?? []).map(link => [link.entryId, link]));
  for (const entry of data.state.entries) {
    const movements = new Map<string, bigint>(), link = linksByEntry.get(entry.id);
    if ((!entry.sourceKey || link?.source) && (!entry.toSourceKey || link?.destination)) continue;
    for (const posting of entryPostings(entry, index.dates)) {
      const role = posting.role === 'destination' ? 'destination' : 'source';
      if (link?.[role] || !(role === 'source' ? entry.sourceKey : entry.toSourceKey)) continue;
      const key = `${posting.walletId}:${posting.date ?? '?'}`;
      movements.set(key, (movements.get(key) ?? 0n) + BigInt(posting.signedAmount));
    }
    for (const [key, amount] of movements) {
      const full = `${key}:${amount}`, candidates = index.aliasesByMovement.get(full) ?? [];
      candidates.push(entry); index.aliasesByMovement.set(full, candidates);
    }
  }
  const factsById=new Map((data.metadata?.facts??[]).map(row=>[row.id,row]));
  for(const tombstone of data.metadata?.deletedTransfers??[])for(const fp of new Set([tombstone.entry.sourceKey,tombstone.entry.toSourceKey,...sourceRefs(tombstone.link??{entryId:tombstone.entry.id}).map(ref=>factsById.get(ref)?.fingerprint)]))if(fp){const rows=index.deletedByFingerprint.get(fp)??[];rows.push(tombstone);index.deletedByFingerprint.set(fp,rows);}
  return index;
}
/** Index only unlinked effective movements; amounts/dates are hints, never identity. */
export function manualSourceCandidates(data:SourceDocument):Map<string,Entry[]> {
  const result=new Map<string,Entry[]>(),links=new Map((data.metadata?.links??[]).map(link=>[link.entryId,link])),dates=createPostingDateIndex(data.metadata);
  for(const entry of data.state.entries){
    const link=links.get(entry.id),movements=new Map<string,bigint>();
    for(const posting of entryPostings(entry,dates)){
      const role=posting.role==='destination'?'destination':'source';
      if(link?.[role]||(role==='source'?entry.sourceKey:entry.toSourceKey))continue;
      const key=`${posting.walletId}:${posting.date??'?'}`;movements.set(key,(movements.get(key)??0n)+BigInt(posting.signedAmount));
    }
    for(const [key,amount]of movements){const full=`${key}:${amount}`,entries=result.get(full)??[];entries.push(entry);result.set(full,entries);}
  }
  return result;
}
function manualMatches(index:SourceIndex,walletId:string,date:string,amount:number):Entry[]{
  return [...new Map([...(index.manualByMovement.get(`${walletId}:${date}:${amount}`)??[]),...(index.manualByMovement.get(`${walletId}:?:${amount}`)??[])].map(entry=>[entry.id,entry])).values()];
}
function sourceContentKey(fact: SourceFact): string {
  return canonical([fact.walletId, fact.currency, fact.postedOn, fact.signedAmount, fact.balanceAfter,
    fact.description.normalize('NFC').trim().replace(/\s+/g, ' ')]);
}
function matchRow(data: SourceDocument, wallet: Wallet, row: ImportRow, index: SourceIndex): Match {
  const incoming=factFor(row,wallet,''),target=factSignature(incoming);
  const candidates=index.factsByFingerprint.get(row.sourceKey)??[];
  const exact=candidates.filter(fact=>factSignature(fact)===target);
  const fact=exact.length===1?exact[0]:undefined;
  const link=fact?index.linksBySource.get(fact.id):undefined;
  const entry=link?index.entries.get(link.entryId):undefined;
  const legacy=index.legacyByFingerprint.get(row.sourceKey)??[];
  const deleted=index.deletedByFingerprint.get(row.sourceKey)??[];
  const alternateFacts = (index.factsByContent.get(sourceContentKey(incoming)) ?? []).filter(candidate =>
    candidate.fingerprint !== incoming.fingerprint && (candidate.fingerprintVersion === 'generic-v1' || incoming.fingerprintVersion === 'generic-v1'));
  const alternateLegacy = [...new Map([...(index.aliasesByMovement.get(`${wallet.id}:${row.date}:${row.amount}`) ?? []), ...(index.aliasesByMovement.get(`${wallet.id}:?:${row.amount}`) ?? [])]
    .filter(entry => entry.sourceKey !== incoming.fingerprint && entry.toSourceKey !== incoming.fingerprint && (incoming.fingerprintVersion === 'generic-v1' || entry.sourceKey?.startsWith('generic:') || entry.toSourceKey?.startsWith('generic:'))).map(entry => [entry.id, entry])).values()];
  const alternateParts = alternateFacts.map(candidate => { const link = index.linksBySource.get(candidate.id); return [candidate,link,link ? index.entries.get(link.entryId) : undefined,index.dispositions.get(candidate.id),index.annotations.get(candidate.id)]; });
  return {fact,link,entry,legacyEntry:legacy.length===1?legacy[0]:undefined,deletedTransfer:deleted.length===1?deleted[0]:undefined,
    ambiguous:(!entry&&!legacy.length&&alternateFacts.length+alternateLegacy.length>1)||exact.length>1||legacy.length>1||deleted.length>1||!!deleted.length&&(!!entry||!!legacy.length),collision:candidates.length>exact.length,
    alternateFacts, alternateLegacy, signatureParts:[candidates,legacy,deleted,alternateParts,alternateLegacy.map(entry => [entry,entry.type === 'transfer' ? transferPostingDates(entry,index.dates) : null])]};
}
/** Build the inspection-only legacy alias projection in one pass. */
function projectedState(data: SourceDocument, walletId?: string): State {
  const state=structuredClone(data.state);
  const entries=new Map(state.entries.map(entry=>[entry.id,entry]));
  const facts=new Map((data.metadata?.facts??[]).map(fact=>[fact.id,fact]));
  const dates=createPostingDateIndex(data.metadata);
  for(const link of data.metadata?.links??[]){const entry=entries.get(link.entryId);if(!entry)continue;
    for(const role of ['source','destination'] as const){const fact=facts.get(link[role]??'');if(!fact)continue;
      const current=financial(entry,link,role);if(entry.type==='transfer')current.date=transferPostingDates(entry,dates)[role];
      if(current.walletId!==fact.walletId||current.date!==fact.postedOn||current.signedAmount!==fact.signedAmount){if(role==='source')delete entry.sourceKey;else delete entry.toSourceKey;}
      else if(role==='source')entry.sourceKey=fact.fingerprint;else entry.toSourceKey=fact.fingerprint;
    }
  }
  // Legacy importer sees only this wallet's effective leg. This projection is
  // inspection-only; original entries and metadata are never persisted from it.
  if(walletId)for(const entry of state.entries)if(entry.type==='transfer'){
    const datesForEntry=transferPostingDates(entry,dates);
    if(entry.walletId===walletId)entry.date=datesForEntry.source??'';
    else if(entry.toWalletId===walletId)entry.date=datesForEntry.destination??'';
  }
  return state;
}
function legacyDecisions(decisions: SourcedImportDecisions): ImportDecisions {
  return Object.fromEntries(Object.entries(decisions).filter(([,d])=>d?.resolution==='skip'||d?.resolution==='distinct')) as ImportDecisions;
}
function reviewFor(data: SourceDocument,wallet: Wallet,row: ImportRow,match: Match,index: SourceIndex): SourceReview|undefined {
  const disposition=index.dispositions.get(match.fact?.id??'');
  let status:SourceReviewStatus|undefined;
  if(match.ambiguous||match.collision)status='identity-ambiguous';
  else if(match.deletedTransfer)status='known-deleted-transfer';
  else if(!match.entry&&!match.legacyEntry&&(match.alternateFacts?.length||match.alternateLegacy?.length))status='alternate-source';
  else if(match.fact&&match.link&&match.entry){
    const role=match.link.source===match.fact.id?'source':'destination';
    const current=financial(match.entry,match.link,role);if(match.entry.type==='transfer')current.date=transferPostingDates(match.entry,index.dates)[role];
    if(current.walletId!==match.fact.walletId||current.date!==match.fact.postedOn||current.signedAmount!==match.fact.signedAmount)status=match.entry.type==='transfer'?'transfer-limited':'known-overridden';
  }else if(match.fact)status=disposition?`known-${disposition.kind}` as SourceReviewStatus:'known-unrepresented';
  else if(match.legacyEntry)status=match.legacyEntry.type==='transfer'?'transfer-limited':'legacy-uncertain';
  if(!status)return;
  const messages:Record<SourceReviewStatus,string>={
    'alternate-source':'Ada fakta sumber dengan ciri sama atau catatan impor lama pada tanggal/nominal yang sama, tetapi identitas format atau referensinya berbeda. Histori legacy tidak selalu memiliki saldo/keterangan sumber yang lengkap. Pertahankan catatan lama untuk tidak menambah transaksi, atau pilih Transaksi berbeda hanya jika benar-benar mutasi lain. Baris yang dipertahankan disimpan sebagai sumber dikecualikan; asosiasi tidak ditebak.',
    'known-overridden':'Fakta bank dikenal, tetapi nilai efektif telah dikoreksi. Pertahankan koreksi atau pulihkan fakta bank secara eksplisit.',
    'known-deleted':'Catatan sumber dihapus. Penghapusan dipertahankan sampai dipilih pulihkan.',
    'known-deleted-transfer':'Sumber terkait transfer terhapus. Pulihkan seluruh grup beserta kedua tanggal, biaya dan koreksinya, atau pertahankan penghapusan.',
    'known-excluded':'Sumber dikecualikan secara eksplisit. Pertahankan keputusan atau pulihkan.',
    'known-deferred':'Sumber belum dipilih pada impor sebelumnya. Pertahankan atau lengkapi secara eksplisit.',
    'known-unrepresented':'Sumber dikenal tanpa catatan efektif. Pilih keputusan saat ini.',
    'legacy-uncertain':'Fingerprint lama cocok, tetapi fakta asli sebelumnya tidak tersedia. Pertahankan catatan atau adopsi fakta file; histori tidak ditebak.',
    'identity-ambiguous':'Fingerprint memiliki beberapa kandidat atau fakta berbeda. Identitas belum pasti; tidak ada penautan otomatis.',
    'transfer-limited':'Koreksi atau sumber legacy transfer tidak dipulihkan per satu baris. Gunakan pengaturan seluruh transfer; fakta dan tanggal tetap dipertahankan.',
  };
  const manual=manualMatches(index,wallet.id,row.date,row.amount);
  const message=messages[status]+(manual.length?` Ada ${manual.length} kandidat catatan manual pada tanggal dan nominal yang sama. Pilih transaksi berbeda hanya bila ini mutasi lain; untuk asosiasi yang belum pasti, pertahankan catatan.`:'');
  return{status,message,signature:canonical([factSignature(factFor(row,wallet,'')),match.signatureParts,match.fact??null,match.link??null,match.entry??null,match.legacyEntry??null,disposition??null,index.annotations.get(match.fact?.id??'')??null,index.overrides.get(match.entry?.id??'')??null,manual.map(entry=>[entry,entry.type==='transfer'?transferPostingDates(entry,index.dates):null])]),
    ...(match.fact?{sourceId:match.fact.id}:{}),...((match.entry??match.legacyEntry??match.deletedTransfer?.entry)?{entryId:(match.entry??match.legacyEntry??match.deletedTransfer?.entry)!.id}:{}),
    allowedResolutions:status==='alternate-source'?['keep','distinct']:status==='identity-ambiguous'||status==='transfer-limited'?['keep']:manual.length?['keep','distinct']:['keep','restore']};
}
export function inspectSourcedImport(data:SourceDocument,wallet:Wallet,preview:ImportPreview,decisions:SourcedImportDecisions={}):SourcedInspection {
  const index=sourceIndex(data),sourceReviews:Record<string,SourceReview>={};
  for(const row of preview.rows){const review=reviewFor(data,wallet,row,matchRow(data,wallet,row,index),index);if(review)sourceReviews[row.id]=review;}
  const base=inspectImport(projectedState(data,wallet.id),wallet,{...preview,rows:preview.rows.map(row=>sourceReviews[row.id]?{...row,selected:false,duplicate:false}:row)});
  let needsReview=base.changedFingerprintIds.length>0;
  const rows=base.rows.map((row,i)=>{const review=sourceReviews[row.id];if(!review)return row;const original=preview.rows[i],decision=decisions[row.id];
    if(!(decision?.signature===review.signature&&review.allowedResolutions.includes(decision.resolution)&&(original.selected?decision.resolution==='restore'||decision.resolution==='distinct':decision.resolution==='keep'||decision.resolution==='skip')))needsReview=true;
    return{...original,duplicate:false,warning:review.message};});
  const overlaps:ImportInspection['overlaps']={};
  for(const row of rows){if(sourceReviews[row.id]||row.duplicate)continue;const candidates=manualMatches(index,wallet.id,row.date,row.amount),decision=decisions[row.id];if(!candidates.length&&!decision)continue;
    if(index.manualByMovement.has(`${wallet.id}:?:${row.amount}`))row.warning=[row.warning,'Kandidat transfer mempunyai tanggal sisi terkait yang belum diketahui; tanggal tidak diasumsikan dari sisi lain.'].filter(Boolean).join(' ');
    const signature=canonical([[row.id,row.sourceKey,row.date,row.amount,row.balance,row.originalDescription??row.description,row.originalReference??row.reference],candidates.map(entry=>[entry,entry.type==='transfer'?transferPostingDates(entry,index.dates):null]).sort((a,b)=>canonical(a).localeCompare(canonical(b)))]);
    overlaps[row.id]={signature,candidates:candidates.map(entry=>structuredClone(entry))};
    if(row.selected&&!(decision?.signature===signature&&decision.resolution==='distinct'))needsReview=true;
  }
  return{...base,rows,overlaps,sourceReviews,needsReview};
}
export function chronologicalSourceRows(preview:ImportPreview):ImportRow[]{
  const forward=preview.rows.every((row,i)=>!i||preview.rows[i-1].date<=row.date&&BigInt(preview.rows[i-1].balance)+BigInt(row.amount)===BigInt(row.balance));
  const reverse=preview.rows.every((row,i)=>!i||preview.rows[i-1].date>=row.date&&BigInt(row.balance)+BigInt(preview.rows[i-1].amount)===BigInt(preview.rows[i-1].balance));
  if(!forward&&!reverse)throw new Error('Urutan fakta sumber atau running balance tidak cocok. Baca ulang file asli.');
  if(preview.sourceOrder!==undefined&&!['oldest','newest'].includes(preview.sourceOrder))throw new Error('Arah urutan sumber belum valid.');
  if(preview.sourceOrder==='oldest'&&!forward||preview.sourceOrder==='newest'&&!reverse)throw new Error('Arah urutan sumber tidak cocok dengan tanggal dan saldo.');
  const rows=preview.sourceOrder==='newest'?[...preview.rows].reverse():preview.sourceOrder==='oldest'||forward?[...preview.rows]:[...preview.rows].reverse();
  if(!rows.length||BigInt(rows[0].balance)-BigInt(rows[0].amount)!==BigInt(preview.openingBalance)||rows.at(-1)!.balance!==preview.closingBalance)throw new Error('Saldo header dan fakta sumber tidak cocok.');
  return rows;
}
function bankEntry(fact:SourceFact,id:string,batchId:string,previous?:Entry,saved?:SourceAnnotation):Entry {
  const chosenType=previous&&['income','expense','unreviewed','movement'].includes(previous.type)?previous.type:saved?.confirmedType??'unreviewed';
  const type=chosenType==='income'&&fact.signedAmount<0||chosenType==='expense'&&fact.signedAmount>0?'unreviewed':chosenType;
  return{id,date:fact.postedOn,walletId:fact.walletId,type:type as Entry['type'],amount:type==='unreviewed'||type==='movement'?fact.signedAmount:Math.abs(fact.signedAmount),category:previous?.category??saved?.category??'Belum dikategorikan',note:previous?.note??saved?.note??fact.description,sourceKey:fact.fingerprint,importBatch:previous?.importBatch??saved?.importBatch??batchId};
}
export function prepareSourcedImport(data:SourceDocument,wallet:Wallet,preview:ImportPreview,decisions:SourcedImportDecisions,useOpening:boolean,batchId:string,at:string):SourcedImportPreparation {
  const inspection=inspectSourcedImport(data,wallet,preview,decisions);
  if(inspection.error)return{status:'invalid',inspection,message:inspection.error};
  if(inspection.needsReview)return{status:'review',inspection};
  try{
    if(!batchId.trim()||!Number.isFinite(Date.parse(at)))throw new Error('Identitas atau waktu perintah impor tidak valid.');
    if(new Set(preview.rows.map(row=>row.sourceKey)).size!==preview.rows.length)throw new Error('Fingerprint berulang dalam file. Seluruh impor ditolak tanpa perubahan.');
    const groupChoices=new Map<string,Set<SourceResolution>>();
    for(const row of inspection.rows){const r=inspection.sourceReviews[row.id],choice=decisions[row.id];if(r?.status==='known-deleted-transfer'&&r.entryId&&choice){const set=groupChoices.get(r.entryId)??new Set();set.add(choice.resolution);groupChoices.set(r.entryId,set);}}
    if([...groupChoices.values()].some(set=>set.size>1))throw new Error('Keputusan untuk seluruh transfer terhapus harus konsisten.');
    const ordered=chronologicalSourceRows(preview),index=sourceIndex(data);
    const next=structuredClone(data),metadata=next.metadata??emptyMetadata();next.metadata=metadata;
    const factIds=new Set(metadata.facts.map(f=>f.id)),rowSources=new Map<string,SourceFact>();
    for(const [i,row]of ordered.entries()){
      const match=matchRow(data,wallet,row,index),fact=match.fact??factFor(row,wallet,`sf:${batchId}:${i}`);
      if(!match.fact){if(factIds.has(fact.id))throw new Error('ID batch impor sudah dipakai untuk fakta lain.');metadata.facts.push(fact);factIds.add(fact.id);}
      rowSources.set(row.id,fact);
    }
    const statement:SourceStatement={id:`stmt:${batchId}`,walletId:wallet.id,currency:preview.currency,periodStart:preview.period.start,periodEnd:preview.period.end,openingBalance:preview.openingBalance,closingBalance:preview.closingBalance,rowIds:ordered.map(row=>rowSources.get(row.id)!.id)};
    const tuple=(s:SourceStatement)=>canonical([s.walletId,s.currency,s.periodStart,s.periodEnd,s.openingBalance,s.closingBalance,s.rowIds]);
    if(!metadata.statements.some(s=>tuple(s)===tuple(statement)))metadata.statements.push(statement);
    const freshRows=inspection.rows.map(row=>inspection.sourceReviews[row.id]?{...row,selected:false,duplicate:false}:row);
    const annotations=new Map((metadata.annotations??[]).map(row=>[row.sourceId,row]));
    const annotate=(fact:SourceFact,entry:Entry)=>annotations.set(fact.id,annotation(fact.id,entry));
    const appended:Entry[]=[];
    if(freshRows.some(row=>row.selected&&!row.duplicate)){
      const projected=projectedState(data,wallet.id),freshPreview={...preview,rows:freshRows};
      const legacy=inspectImport(projected,wallet,freshPreview,legacyDecisions(decisions)),translated=legacyDecisions(decisions);
      for(const [id,overlap]of Object.entries(legacy.overlaps))if(translated[id])translated[id]={...translated[id]!,signature:overlap.signature};
      const prepared=prepareImport(projected,wallet,freshPreview,translated,useOpening,batchId);
      if(prepared.status!=='ready')return prepared.status==='review'?{status:'review',inspection}:{status:'invalid',inspection,message:prepared.message};
      next.state.wallets=prepared.state.wallets;
      next.state.entries.push(...[...prepared.entries].reverse());appended.push(...prepared.entries);
      const byFingerprint=new Map(freshRows.map(row=>[row.sourceKey,row]));
      metadata.creationOrigins??=[];
      for(const entry of prepared.entries){const row=byFingerprint.get(entry.sourceKey!)!,fact=rowSources.get(row.id)!;metadata.links.push({entryId:entry.id,source:fact.id});annotate(fact,entry);metadata.creationOrigins.push({entryId:entry.id,origin:'bank'});}
      if(useOpening&&!data.state.entries.some(entry=>entry.walletId===wallet.id||entry.toWalletId===wallet.id)){
        const baseline={id:`base:${batchId}`,walletId:wallet.id,boundary:{kind:'before-source' as const,date:ordered[0].date,sourceId:rowSources.get(ordered[0].id)!.id},origin:'bank' as const,status:'confirmed' as const};
        metadata.baselines=[...(metadata.baselines??[]).filter(b=>b.walletId!==wallet.id),baseline];
        metadata.baselineDecisions=[...(metadata.baselineDecisions??[]).filter(d=>metadata.baselines!.some(b=>b.id===d.baselineId)),{baselineId:baseline.id,reason:'Pengguna memilih saldo awal dari file sumber saat impor pertama.',at}];
      }
    }
    const restoredGroups=new Set<string>();
    for(const row of inspection.rows){const review=inspection.sourceReviews[row.id];if(!review||!['restore','distinct'].includes(decisions[row.id]?.resolution??''))continue;
      const fact=rowSources.get(row.id)!,match=matchRow(data,wallet,row,index);
      if(match.deletedTransfer){const id=match.deletedTransfer.entry.id;if(restoredGroups.has(id))continue;const restored=executeTransferCommand(next,{kind:'restore-deleted',entryId:id,reason:'Pulihkan seluruh transfer sesuai snapshot penghapusan, kedua tanggal, biaya, dan koreksinya.',at});next.state=restored.state;Object.assign(metadata,restored.metadata);appended.push(next.state.entries.find(e=>e.id===id)!);restoredGroups.add(id);continue;}
      const previous=match.entry??match.legacyEntry;if(previous?.type==='transfer')throw new Error(E4_MESSAGE);
      const restored=review.status==='alternate-source' ? entriesFromImport([{...row, selected:true, duplicate:false}],wallet.id,batchId)[0] : bankEntry(fact,previous?.id??`entry:${row.sourceKey}:${batchId}`,batchId,previous,index.annotations.get(fact.id));
      if(previous)next.state.entries=next.state.entries.map(e=>e.id===previous.id?restored:e);else next.state.entries.push(restored);
      if(!metadata.links.some(link=>link.entryId===restored.id))metadata.links.push({entryId:restored.id,source:fact.id});
      metadata.dispositions=(metadata.dispositions??[]).filter(d=>d.sourceId!==fact.id);
      putOverride(metadata,restored.id,{reason:'Pengguna memilih mengadopsi atau memulihkan fakta file pada keputusan impor saat ini.',at});annotate(fact,restored);
      if(!previous){metadata.creationOrigins??=[];metadata.creationOrigins.push({entryId:restored.id,origin:'bank'});}appended.push(restored);
    }
    const claimed=new Set(metadata.links.flatMap(sourceRefs)),dispositions=new Map((metadata.dispositions??[]).map(d=>[d.sourceId,d]));
    for(const row of ordered){const fact=rowSources.get(row.id)!;if(!claimed.has(fact.id)&&!dispositions.has(fact.id)){const explicitSkip=decisions[row.id]?.resolution==='skip'||inspection.sourceReviews[row.id]?.status==='alternate-source'&&decisions[row.id]?.resolution==='keep';dispositions.set(fact.id,{sourceId:fact.id,kind:explicitSkip?'excluded':'deferred',reason:explicitSkip?'Pengguna menyatakan mutasi dicatat manual tanpa asosiasi otomatis.':'Tidak dipilih pada pratinjau impor.',at});}}
    metadata.annotations=[...annotations.values()];metadata.dispositions=[...dispositions.values()];
    const normalized=finalDocument(next);return{status:'ready',data:normalized,state:normalized.state,entries:appended,inspection};
  }catch(error){return{status:'invalid',inspection,message:error instanceof Error?error.message:'Impor sumber belum dapat disimpan.'};}
}

export function applySourcedBulkCategory(data:SourceDocument,ids:readonly string[],category:string,confirm=false):SourceDocument {
  if(category.length>80)throw new Error('Kategori maksimal 80 karakter.');
  const next=structuredClone(data),wanted=new Set(ids),found=new Set<string>(),links=new Map((next.metadata?.links??[]).map(link=>[link.entryId,link]));
  const annotations=new Map((next.metadata?.annotations??[]).map(row=>[row.sourceId,row]));
  for(const entry of next.state.entries)if(wanted.has(entry.id)){found.add(entry.id);if(entry.type==='transfer'||entry.type==='adjustment')throw new Error('Pilih catatan pemasukan, pengeluaran, atau mutasi untuk kategori massal.');entry.category=category;if(confirm&&entry.type==='unreviewed'){entry.type=entry.amount>0?'income':'expense';entry.amount=Math.abs(entry.amount);}for(const ref of sourceRefs(links.get(entry.id)??{entryId:entry.id}))annotations.set(ref,annotation(ref,entry));}
  if(found.size!==wanted.size)throw new Error('Sebagian transaksi sudah berubah atau dihapus. Pilih ulang daftar.');
  if(next.metadata)next.metadata.annotations=[...annotations.values()];return finalDocument(next);
}

export function saveTransferEntry(data:SourceDocument,entry:Entry,removeIds:readonly string[],options:{sourceDate:string|null;destinationDate:string|null;declareDates?:true;reason:string;at:string}):SourceDocument {
  if(entry.type!=='transfer')throw new Error('Perintah ini memerlukan transfer.');
  const removed=data.state.entries.filter(row=>removeIds.includes(row.id));
  if(removed.length===2&&removed.every(row=>row.type!=='transfer')){
    const debit=removed.find(row=>signed(row)<0),credit=removed.find(row=>signed(row)>0);if(!debit||!credit)throw new Error('Pasangan memerlukan satu debit dan satu kredit.');
    const paired=executeTransferCommand(data,{kind:'pair',debitId:debit.id,creditId:credit.id,fee:entry.fee??0,...(entry.rate!==undefined?{rate:entry.rate}:{}),note:entry.note,reason:options.reason,at:options.at});
    const actual=paired.state.entries.find(row=>row.id===debit.id)!;
    if(actual.amount!==entry.amount||actual.toAmount!==entry.toAmount||actual.walletId!==entry.walletId||actual.toWalletId!==entry.toWalletId)throw new Error('Nilai pasangan harus mempertahankan kedua mutasi asli. Gunakan perubahan transfer sesudah memasangkan.');
    return paired;
  }
  if(removed.length>1||removed.some(row=>row.id!==entry.id))throw new Error('Perintah transfer tidak boleh menghapus catatan lain tanpa pasangan lengkap.');
  const previous=data.state.entries.find(row=>row.id===entry.id),link=data.metadata?.links.find(row=>row.entryId===entry.id);
  if(previous&&previous.type!=='transfer'&&link){
    requireDecision(options);if(!options.declareDates)throw new Error('Nyatakan tanggal kedua sisi sebelum mengubah mutasi bersumber menjadi transfer.');
    const fact=data.metadata!.facts.find(row=>row.id===link.source)!;if(!fact||link.destination)throw new Error('Sumber mutasi tunggal belum lengkap.');
    const next=structuredClone(data),m=next.metadata!,converted={...entry};delete converted.sourceKey;delete converted.toSourceKey;
    const role=fact.signedAmount<0?'source':'destination';if(role==='source')converted.sourceKey=fact.fingerprint;else converted.toSourceKey=fact.fingerprint;
    next.state.entries=next.state.entries.map(row=>row.id===entry.id?converted:row);
    const nextLink:SourceLink={entryId:entry.id,[role]:fact.id,postingDates:{source:options.sourceDate,destination:options.destinationDate}};
    m.links=m.links.map(row=>row.entryId===entry.id?nextLink:row);
    m.transfers=[...(m.transfers??[]).filter(row=>row.entryId!==entry.id),{entryId:entry.id,sourceDate:options.sourceDate,destinationDate:options.destinationDate}];
    putOverride(m,entry.id,options);
    return finalDocument(next);
  }
  return executeTransferCommand(data,{kind:'edit',entry,...options});
}
