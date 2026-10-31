import { validateWallet, type Entry, type Wallet } from './finance';
import { SOURCE_POLICY, type SourceDocument, type SourceMetadata } from './sourceModel';
import { prepareBackup } from './storage';

export interface WalletUsage {
  entryCount: number;
  factCount: number;
  statementCount: number;
  baselineCount: number;
  retainedTransferCount: number;
  /** Exact wallet-ID occurrences anywhere in metadata, excluding archive markers. */
  referenceCount: number;
  used: boolean;
  openingLocked: boolean;
  canDelete: boolean;
}

const archiveRows = (data: SourceDocument) => data.metadata?.walletArchives ?? [];
export function isWalletArchived(data: SourceDocument, id: string): boolean {
  return archiveRows(data).some(row => row.walletId === id);
}
export function isArchivedLinkedEntry(data: SourceDocument, entry: Entry): boolean {
  return isWalletArchived(data, entry.walletId) || !!entry.toWalletId && isWalletArchived(data, entry.toWalletId)
    || archivedReadOnlyEntryIds(data).has(entry.id);
}
function getWallet(data: SourceDocument, id: string): Wallet {
  const wallet = data.state.wallets.find(row => row.id === id);
  if (!wallet) throw new Error('Dompet sudah dihapus atau tidak ditemukan. Muat ulang daftar dompet.');
  return wallet;
}
function occurrences(value: unknown, wanted: ReadonlySet<string>): number {
  if (typeof value === 'string') return wanted.has(value) ? 1 : 0;
  if (Array.isArray(value)) return value.reduce((sum, child) => sum + occurrences(child, wanted), 0);
  if (value && typeof value === 'object') return Object.values(value).reduce<number>((sum, child) => sum + occurrences(child, wanted), 0);
  return 0;
}
const metadataWithoutArchives = (data: SourceDocument) => Object.fromEntries(Object.entries(data.metadata ?? {})
  .filter(([key]) => key !== 'walletArchives' && key !== 'currencies'));

/** Archive state itself never invents financial usage or protects an empty ID. */
export function walletUsage(data: SourceDocument, id: string): WalletUsage {
  const wallet = getWallet(data, id), wanted = new Set([id]);
  const entryCount = data.state.entries.filter(entry => entry.walletId === id || entry.toWalletId === id).length;
  const factCount = data.metadata?.facts.filter(row => row.walletId === id).length ?? 0;
  const statementCount = data.metadata?.statements.filter(row => row.walletId === id).length ?? 0;
  const baselineCount = data.metadata?.baselines?.filter(row => row.walletId === id).length ?? 0;
  const retainedTransferCount = [...data.metadata?.deletedTransfers ?? [], ...data.metadata?.unpairings ?? []]
    .filter(row => occurrences(row, wanted) > 0).length;
  const referenceCount = occurrences(metadataWithoutArchives(data), wanted);
  const openingLocked = entryCount > 0 || referenceCount > 0;
  return { entryCount, factCount, statementCount, baselineCount, retainedTransferCount, referenceCount,
    used: openingLocked || wallet.openingBalance !== 0, openingLocked,
    canDelete: wallet.openingBalance === 0 && !openingLocked };
}
function mutableWallet(data: SourceDocument, id: string): Wallet {
  const wallet = getWallet(data, id);
  if (wallet.kind === 'cash') throw new Error('Histori cash lama disimpan sebagai arsip baca saja.');
  if (isWalletArchived(data, id)) throw new Error('Pulihkan dompet dari arsip sebelum mengubahnya.');
  return wallet;
}
const foldedName = (name: string) => name.trim().normalize('NFKC').toLocaleLowerCase('id-ID').replace(/\u0307/g, '');
function checkedWallet(data: SourceDocument, wallet: Wallet, previous?: Wallet): Wallet {
  const problem = validateWallet(wallet);
  if (problem) throw new Error(problem);
  if (wallet.kind === 'cash') throw new Error('Cash tidak dibukukan lagi. Pilih rekening bank atau e-wallet.');
  const next = { ...wallet, name: wallet.name.trim() };
  const name = foldedName(next.name);
  // Existing duplicate names remain loadable; an unchanged nickname is not a new duplicate.
  if ((!previous || foldedName(previous.name) !== name) && data.state.wallets.some(other =>
    other.id !== next.id && other.currency === next.currency && foldedName(other.name) === name)) {
    throw new Error(`Nama dompet ${next.name} sudah digunakan untuk ${next.currency}. Tambahkan nama pembeda.`);
  }
  return next;
}
export function createWallet(data: SourceDocument, wallet: Wallet): SourceDocument {
  if (data.state.wallets.some(row => row.id === wallet.id)) throw new Error('ID dompet sudah digunakan. Buat ulang formulir tambah dompet.');
  const next = checkedWallet(data, wallet);
  return prepareBackup({ ...data, state: { ...data.state, wallets: [...data.state.wallets, next] } }).data;
}
export function editWallet(data: SourceDocument, wallet: Wallet): SourceDocument {
  const previous = mutableWallet(data, wallet.id);
  if (previous.currency !== wallet.currency) throw new Error('Mata uang dompet yang sudah dibuat tidak dapat diganti. Buat dompet terpisah.');
  const next = checkedWallet(data, wallet, previous);
  if (previous.openingBalance !== next.openingBalance && walletUsage(data, wallet.id).openingLocked) {
    throw new Error('Saldo awal terkunci karena dompet sudah memiliki histori atau bukti bank. Gunakan Cek saldo untuk koreksi saldo sekarang.');
  }
  return prepareBackup({ ...data, state: { ...data.state, wallets: data.state.wallets.map(row => row.id === next.id ? next : row) } }).data;
}
function withoutArchive(data: SourceDocument, id: string): SourceMetadata | undefined {
  if (!data.metadata) return undefined;
  const metadata = { ...data.metadata }, remaining = archiveRows(data).filter(row => row.walletId !== id);
  if (remaining.length) metadata.walletArchives = remaining;
  else delete metadata.walletArchives;
  return metadata;
}
export function deleteUnusedWallet(data: SourceDocument, id: string): SourceDocument {
  const wallet = getWallet(data, id);
  if (wallet.kind === 'cash') throw new Error('Histori cash lama disimpan sebagai arsip baca saja.');
  if (!walletUsage(data, id).canDelete) throw new Error('Dompet memiliki saldo awal, histori, atau bukti yang masih dirujuk. Arsipkan agar histori tetap utuh.');
  const next = { ...data, state: { ...data.state, wallets: data.state.wallets.filter(row => row.id !== id) } };
  if (data.metadata) next.metadata = withoutArchive(data, id);
  return prepareBackup(next).data;
}
export function archiveWallet(data: SourceDocument, id: string, at: string): SourceDocument {
  const wallet = mutableWallet(data, id);
  if (wallet.kind === 'cash') throw new Error('Histori cash lama sudah merupakan arsip baca saja.');
  const metadata: SourceMetadata = data.metadata ?? { policy: SOURCE_POLICY, facts: [], links: [], statements: [] };
  return prepareBackup({ ...data, metadata: { ...metadata, walletArchives: [...archiveRows(data), { walletId: id, at }] } }).data;
}
export function restoreWallet(data: SourceDocument, id: string): SourceDocument {
  const wallet = getWallet(data, id);
  if (wallet.kind === 'cash') throw new Error('Pembukuan cash tidak diaktifkan kembali.');
  if (!isWalletArchived(data, id)) throw new Error('Dompet ini tidak sedang diarsipkan.');
  return prepareBackup({ ...data, metadata: withoutArchive(data, id) }).data;
}

interface Relation { entries: string[]; facts: string[] }
/** Connected transfer legs and source facts remain protected as one record. */
function protectionIds(data: SourceDocument, wallets: ReadonlySet<string>): { entries: Set<string>; facts: Set<string> } {
  const metadata = data.metadata;
  const entries = new Set<string>(), facts = new Set<string>(), queue: Array<{ kind: 'entries' | 'facts'; id: string }> = [];
  const byEntry = new Map<string, Relation[]>(), byFact = new Map<string, Relation[]>();
  const seed = (kind: 'entries' | 'facts', id?: string) => {
    const ids = kind === 'entries' ? entries : facts;
    if (id && !ids.has(id)) { ids.add(id); queue.push({ kind, id }); }
  };
  const relate = (entryIds: Array<string | undefined>, factIds: Array<string | undefined>) => {
    const relation = { entries: entryIds.filter((id): id is string => !!id), facts: factIds.filter((id): id is string => !!id) };
    for (const [ids, index] of [[relation.entries, byEntry], [relation.facts, byFact]] as const) {
      for (const id of ids) { const rows = index.get(id) ?? []; rows.push(relation); index.set(id, rows); }
    }
  };
  for (const entry of data.state.entries) if (wallets.has(entry.walletId) || !!entry.toWalletId && wallets.has(entry.toWalletId)) seed('entries', entry.id);
  for (const fact of metadata?.facts ?? []) if (wallets.has(fact.walletId)) seed('facts', fact.id);
  for (const link of metadata?.links ?? []) relate([link.entryId, link.pairing?.sourceEntryId, link.pairing?.destinationEntryId], [link.source, link.destination]);
  for (const context of metadata?.transfers ?? []) relate([context.entryId, context.pairing?.sourceEntryId, context.pairing?.destinationEntryId], []);
  for (const row of metadata?.unpairings ?? []) {
    relate([row.sourceEntryId, row.destinationEntryId, row.pairing?.sourceEntryId, row.pairing?.destinationEntryId], [row.source, row.destination]);
    if (wallets.has(row.sourceWalletId) || wallets.has(row.destinationWalletId)) { seed('entries', row.sourceEntryId); seed('entries', row.destinationEntryId); }
  }
  for (const row of metadata?.deletedTransfers ?? []) {
    const pairing = row.context?.pairing ?? row.link?.pairing;
    relate([row.entry.id, pairing?.sourceEntryId, pairing?.destinationEntryId], [row.link?.source, row.link?.destination]);
    if (wallets.has(row.entry.walletId) || !!row.entry.toWalletId && wallets.has(row.entry.toWalletId)) seed('entries', row.entry.id);
  }
  const visited = new Set<Relation>();
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    for (const relation of (current.kind === 'entries' ? byEntry : byFact).get(current.id) ?? []) {
      if (visited.has(relation)) continue;
      visited.add(relation); relation.entries.forEach(id => seed('entries', id)); relation.facts.forEach(id => seed('facts', id));
    }
  }
  return { entries, facts };
}

/** One index per render/batch: includes counter-entries retained by transfer history. */
export function archivedReadOnlyEntryIds(data: SourceDocument): ReadonlySet<string> {
  const wallets = new Set(archiveRows(data).map(row => row.walletId));
  if (!wallets.size) return new Set<string>();
  const { entries } = protectionIds(data, wallets);
  return new Set(data.state.entries.filter(entry => entries.has(entry.id)).map(entry => entry.id));
}
function protectedProjection(data: SourceDocument, wallets: ReadonlySet<string>): unknown {
  const metadata = data.metadata, { entries, facts } = protectionIds(data, wallets);
  const statements = new Set(metadata?.statements.filter(row => wallets.has(row.walletId)).map(row => row.id) ?? []);
  const baselines = new Set(metadata?.baselines?.filter(row => wallets.has(row.walletId)).map(row => row.id) ?? []);
  const selected: Record<string, unknown> = {};
  for (const [table, values] of Object.entries(metadata ?? {})) {
    if (!Array.isArray(values) || table === 'walletArchives' || table === 'currencies') continue;
    selected[table] = values.filter((value: unknown) => {
      const row = value as Record<string, unknown>;
      if (occurrences(row, wallets)) return true;
      switch (table) {
        case 'facts': return facts.has(row.id as string);
        case 'links': case 'transfers': case 'overrides': case 'creationOrigins': return entries.has(row.entryId as string);
        case 'annotations': case 'dispositions': return facts.has(row.sourceId as string);
        case 'completions': return statements.has(row.statementId as string) || baselines.has(row.baselineId as string);
        case 'baselineDecisions': return baselines.has(row.baselineId as string);
        case 'unpairings': return entries.has(row.sourceEntryId as string) || entries.has(row.destinationEntryId as string);
        case 'deletedTransfers': return entries.has((row.entry as Entry).id);
        default: return false;
      }
    });
  }
  // Normalize missing/empty tables, but retain array order inside each evidence record.
  const tables = Object.fromEntries(Object.entries(selected).filter(([, value]) => (value as unknown[]).length)
    .map(([name, rows]) => [name, recordSet(rows as unknown[])]));
  return { wallets: recordSet(data.state.wallets.filter(wallet => wallets.has(wallet.id))),
    entries: recordSet(data.state.entries.filter(entry => entries.has(entry.id))), metadata: tables };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  return value;
}
const signature = (value: unknown) => JSON.stringify(canonical(value));
const recordSet = (rows: readonly unknown[]) => rows.map(signature).sort();

/** Restore removes only a marker in that write; changing archived history needs a later write. */
export function assertArchivedWalletsUnchanged(previous: SourceDocument, next: SourceDocument): void {
  const ids = new Set([...archiveRows(previous), ...archiveRows(next)].map(row => row.walletId));
  if (!ids.size) return;
  for (const id of [...ids]) {
    const before = previous.state.wallets.find(wallet => wallet.id === id), after = next.state.wallets.find(wallet => wallet.id === id);
    if (!before) throw new Error('Dompet harus dibuat sebelum dapat diarsipkan.');
    if (!after) {
      if (!isWalletArchived(next, id) && walletUsage(previous, id).canDelete) { ids.delete(id); continue; }
      throw new Error('Dompet arsip masih memiliki histori atau bukti dan tidak dapat dihapus.');
    }
    const beforeMarker = archiveRows(previous).find(row => row.walletId === id), afterMarker = archiveRows(next).find(row => row.walletId === id);
    if (beforeMarker && afterMarker && signature(beforeMarker) !== signature(afterMarker)) throw new Error('Penanda arsip berubah. Pulihkan dompet terlebih dahulu.');
  }
  if (ids.size && signature(protectedProjection(previous, ids)) !== signature(protectedProjection(next, ids))) {
    throw new Error('Dompet arsip dan histori terkait bersifat baca saja. Pulihkan dompet terlebih dahulu, lalu ulangi perubahan.');
  }
}
