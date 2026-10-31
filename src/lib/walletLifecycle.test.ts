import { describe, expect, it } from 'vitest';
import { archiveWallet, archivedReadOnlyEntryIds, assertArchivedWalletsUnchanged, createWallet, deleteUnusedWallet, editWallet,
  isArchivedLinkedEntry, isWalletArchived, restoreWallet, walletUsage } from './walletLifecycle';
import { entryPostings, walletBalance, type Entry, type Wallet } from './finance';
import { SOURCE_POLICY, type SourceDocument } from './sourceModel';
import { parseBackupText, prepareBackup, serializeBackup } from './storage';
import { saveTransferEntry } from './sourceCommands';
import { executeTransferCommand } from './transferCommands';
import { entryCategorySuggestions } from './categorySuggestions';
import { defaultCategorySettings } from './categorySettings';
import { applyBankDecisions } from './bankDecisions';

const at = '2026-10-31T12:00:00.000Z';
const wallet = (id: string, extra: Partial<Wallet> = {}): Wallet => ({ id, name: `Synthetic ${id}`, currency: 'TRY', kind: 'bank', openingBalance: 0, ...extra });
const entry = (id = 'expense', walletId = 'a'): Entry => ({ id, date: '2026-10-01', type: 'expense', walletId, amount: 100, category: 'Belum dikategorikan', note: 'POS ALISVERIS ISYERI SYNTHETIC' });
function empty(): SourceDocument { return { app: 'uangku', version: 1, demo: false, state: { version: 1, wallets: [wallet('a'), wallet('b'), wallet('c')], entries: [] } }; }
function sourced(): SourceDocument {
  const data = empty(); data.state.wallets[0].openingBalance = 1000; data.state.entries = [entry()];
  data.metadata = { policy: SOURCE_POLICY,
    facts: [{ id: 'f', walletId: 'a', currency: 'TRY', postedOn: '2026-10-01', signedAmount: -100, balanceAfter: 900,
      description: entry().note, fingerprintVersion: 'ziraat-v1', fingerprint: 'ziraat:0000000000000001' }],
    statements: [{ id: 's', walletId: 'a', currency: 'TRY', periodStart: '2026-10-01', periodEnd: '2026-10-01', openingBalance: 1000, closingBalance: 900, rowIds: ['f'] }],
    links: [{ entryId: 'expense', source: 'f' }],
    baselines: [{ id: 'baseline', walletId: 'a', origin: 'bank', status: 'confirmed', boundary: { kind: 'before-source', date: '2026-10-01', sourceId: 'f' } }],
    annotations: [{ sourceId: 'f', category: 'Belum dikategorikan', note: entry().note, confirmedType: 'expense' }],
  };
  return prepareBackup(data).data;
}
function transfer(): SourceDocument {
  const data = empty(); data.state.wallets[0].openingBalance = 1000;
  return saveTransferEntry(data, { ...entry('pair'), type: 'transfer', toWalletId: 'b', toAmount: 100, fee: 10, category: '' }, [], {
    sourceDate: '2026-10-01', destinationDate: '2026-10-02', declareDates: true, reason: 'Synthetic explicit transfer', at,
  });
}
const moneySnapshot = (data: SourceDocument) => ({ wallets: data.state.wallets, entries: data.state.entries,
  postings: data.state.entries.flatMap(row => entryPostings(row, data.metadata)),
  balances: data.state.wallets.map(row => [row.id, walletBalance(data.state, row.id, data.metadata)]),
  facts: data.metadata?.facts, statements: data.metadata?.statements, links: data.metadata?.links });

describe('explicit wallet create and edit commands', () => {
  it('creates a detached trimmed wallet without changing existing accounts or source data', () => {
    const data = sourced(), before = serializeBackup(data), next = createWallet(data, wallet('new', { name: '  Synthetic new  ', openingBalance: 500 }));
    expect(next.state.wallets.at(-1)?.name).toBe('Synthetic new');
    expect(next.state.wallets.slice(0, -1)).toEqual(data.state.wallets); expect(next.state.entries).toEqual(data.state.entries);
    expect(next.metadata).toEqual(data.metadata); expect(serializeBackup(data)).toBe(before);
    next.state.wallets[0].name = 'Changed copy'; expect(data.state.wallets[0].name).toBe('Synthetic a');
  });
  it('distinguishes create collisions from an edit of a missing/deleted identity', () => {
    const data = empty(); expect(() => createWallet(data, wallet('a'))).toThrow(/ID dompet/);
    expect(() => editWallet(data, wallet('missing'))).toThrow(/dihapus|tidak ditemukan/);
  });
  it('rejects new same-currency nickname duplicates while permitting another currency', () => {
    const data = empty(); data.state.wallets[0].name = '  Ziraat Synthetic  ';
    expect(() => createWallet(data, wallet('new', { name: 'ziraat synthetic' }))).toThrow(/nama pembeda/);
    expect(createWallet(data, wallet('new', { name: 'ZIRAAT SYNTHETIC', currency: 'USD' })).state.wallets).toHaveLength(4);
    expect(() => editWallet(data, { ...data.state.wallets[1], name: 'ZiRaAt Synthetic' })).toThrow(/nama pembeda/);
  });
  it('keeps historical duplicate nicknames loadable and an unchanged edit valid', () => {
    const data = empty(); data.state.wallets[0].name = data.state.wallets[1].name = 'Old duplicate';
    expect(editWallet(data, { ...data.state.wallets[0], kind: 'ewallet' }).state.wallets[0].kind).toBe('ewallet');
    expect(editWallet(data, { ...data.state.wallets[0], name: 'New distinct' }).state.wallets[0].name).toBe('New distinct');
  });
  it('permits unused opening correction but never changes the existing currency', () => {
    const data = empty(); data.state.wallets[0].openingBalance = 500;
    expect(editWallet(data, { ...data.state.wallets[0], openingBalance: 200 }).state.wallets[0].openingBalance).toBe(200);
    expect(() => editWallet(data, { ...data.state.wallets[0], currency: 'USD' })).toThrow(/Mata uang/);
  });
  it.each(['manual', 'source'] as const)('locks historic opening balances for %s evidence, preserving a safe rename', kind => {
    const data = kind === 'source' ? sourced() : empty();
    if (kind === 'manual') data.state.entries = [entry()];
    const before = serializeBackup(data), original = data.state.wallets[0];
    expect(() => editWallet(data, { ...original, openingBalance: original.openingBalance + 1 })).toThrow(/Cek saldo/);
    expect(editWallet(data, { ...original, name: 'Renamed account' }).state.wallets[0].openingBalance).toBe(original.openingBalance);
    expect(serializeBackup(data)).toBe(before);
  });
  it.each(['create', 'edit'] as const)('keeps legacy cash read-only during %s', kind => {
    const data = empty(); data.state.wallets[0].kind = 'cash';
    expect(() => kind === 'create' ? createWallet(data, wallet('new', { kind: 'cash' })) : editWallet(data, data.state.wallets[0])).toThrow(/Cash|cash/);
  });
  it('validates final wallet count and exact currency aggregates before returning', () => {
    const data = empty(); data.state.wallets = Array.from({ length: 100 }, (_, i) => wallet(`w${i}`));
    const before = JSON.stringify(data); expect(() => createWallet(data, wallet('over-limit'))).toThrow(/100/); expect(JSON.stringify(data)).toBe(before);
    const huge = empty(); huge.state.wallets[0].openingBalance = Number.MAX_SAFE_INTEGER;
    expect(() => createWallet(huge, wallet('overflow', { openingBalance: 1 }))).toThrow(/besar|tepat|batas/i);
  });
});

describe('wallet usage and non-destructive deletion', () => {
  it('reports independent evidence counts and locks opening for source-only history', () => {
    const data = sourced(); data.state.entries = []; data.metadata!.links = [];
    expect(walletUsage(data, 'a')).toMatchObject({ entryCount: 0, factCount: 1, statementCount: 1, baselineCount: 1, used: true, openingLocked: true, canDelete: false });
    expect(walletUsage(data, 'a').referenceCount).toBeGreaterThanOrEqual(3);
  });
  it('treats a nonzero unused opening as money, without inventing historic usage', () => {
    const data = empty(); data.state.wallets[0].openingBalance = -500;
    expect(walletUsage(data, 'a')).toMatchObject({ entryCount: 0, used: true, openingLocked: false, canDelete: false });
    expect(() => deleteUnusedWallet(data, 'a')).toThrow(/saldo awal/);
  });
  it('can delete Ziraat or the final genuinely unused wallet without restoring defaults', () => {
    const data = empty(); data.state.wallets = [wallet('ziraat', { name: 'Ziraat' })];
    const next = deleteUnusedWallet(data, 'ziraat'); expect(next.state.wallets).toEqual([]); expect(next.state.entries).toEqual([]);
    expect(parseBackupText(serializeBackup(next))).toEqual(next); expect(data.state.wallets).toHaveLength(1);
  });
  it('refuses a zero-balance wallet with financial history or as a transfer destination', () => {
    const data = empty(); data.state.entries = [{ ...entry('credit'), type: 'income' }, entry('debit')];
    expect(walletBalance(data.state, 'a')).toBe(0); expect(() => deleteUnusedWallet(data, 'a')).toThrow(/histori|bukti/);
    const paired = transfer(); expect(walletUsage(paired, 'b').entryCount).toBe(1); expect(() => deleteUnusedWallet(paired, 'b')).toThrow(/histori|bukti/);
  });
  it('protects retained deleted-transfer witnesses even without any active entry', () => {
    const original = transfer();
    const data = executeTransferCommand(original, { kind: 'delete', entryId: 'pair', reason: 'Synthetic removal', at });
    data.metadata!.deletedTransfers = [{ entry: original.state.entries[0], context: original.metadata!.transfers![0], origin: 'manual', reason: 'Synthetic retained witness', at }];
    data.state.wallets[0].openingBalance = 0;
    prepareBackup(data);
    expect(data.state.entries).toHaveLength(0); expect(walletUsage(data, 'a')).toMatchObject({ entryCount: 0, retainedTransferCount: 1, openingLocked: true, canDelete: false });
    expect(() => deleteUnusedWallet(data, 'a')).toThrow(/bukti/);
  });
  it('ignores only the archive marker when checking whether an empty wallet is deletable', () => {
    const data = archiveWallet(empty(), 'a', at);
    expect(walletUsage(data, 'a')).toMatchObject({ used: false, openingLocked: false, canDelete: true, referenceCount: 0 });
    const next = deleteUnusedWallet(data, 'a'); expect(next.state.wallets.some(row => row.id === 'a')).toBe(false);
    expect(next.metadata?.walletArchives).toBeUndefined(); expect(() => assertArchivedWalletsUnchanged(data, next)).not.toThrow();
  });
  it('counts arbitrary retained metadata references conservatively and never mutates input', () => {
    const data = sourced(); data.state.wallets.push(wallet('memo-id'));
    data.metadata!.annotations![0].note = 'memo-id';
    expect(walletUsage(data, 'memo-id')).toMatchObject({ referenceCount: 1, openingLocked: true, canDelete: false });
    expect(() => deleteUnusedWallet(data, 'memo-id')).toThrow(/bukti/);
  });
});

describe('durable read-only wallet archives', () => {
  it('preserves every source fact, entry, posting and balance across archive and restore', () => {
    const data = sourced(), before = serializeBackup(data), money = moneySnapshot(data), archived = archiveWallet(data, 'a', at);
    expect(isWalletArchived(archived, 'a')).toBe(true); expect(moneySnapshot(archived)).toEqual(money);
    expect(JSON.parse(serializeBackup(archived)).codec).toBe('table-tuples-v5');
    expect(parseBackupText(serializeBackup(archived))).toEqual(archived);
    expect(() => assertArchivedWalletsUnchanged(data, archived)).not.toThrow();
    const restored = restoreWallet(archived, 'a'); expect(isWalletArchived(restored, 'a')).toBe(false); expect(moneySnapshot(restored)).toEqual(money);
    expect(restored.metadata?.walletArchives).toBeUndefined(); expect(() => assertArchivedWalletsUnchanged(archived, restored)).not.toThrow();
    expect(serializeBackup(data)).toBe(before);
  });
  it('leaves the other archived marker untouched during restore', () => {
    const data = archiveWallet(archiveWallet(empty(), 'a', at), 'b', at), restored = restoreWallet(data, 'a');
    expect(restored.metadata?.walletArchives).toEqual([{ walletId: 'b', at }]);
  });
  it.each(['', 'not-a-time', '2026-02-30T12:00:00Z', '2026-10-31'])('rejects invalid archive timestamp %s', timestamp => {
    const data = empty(), before = JSON.stringify(data); expect(() => archiveWallet(data, 'a', timestamp)).toThrow(); expect(JSON.stringify(data)).toBe(before);
  });
  it('refuses missing, already archived and legacy cash state transitions', () => {
    const data = empty(); expect(() => archiveWallet(data, 'missing', at)).toThrow(/tidak ditemukan/);
    expect(() => restoreWallet(data, 'a')).toThrow(/tidak sedang/);
    const archived = archiveWallet(data, 'a', at); expect(() => archiveWallet(archived, 'a', at)).toThrow(/Pulihkan/);
    expect(() => editWallet(archived, { ...archived.state.wallets[0], name: 'Changed' })).toThrow(/Pulihkan/);
    data.state.wallets[0].kind = 'cash'; expect(() => archiveWallet(data, 'a', at)).toThrow(/cash/);
  });
  it('identifies both sides of a paired transfer as read-only when either wallet is archived', () => {
    const data = archiveWallet(transfer(), 'b', at);
    expect(isArchivedLinkedEntry(data, data.state.entries[0])).toBe(true);
    expect(isArchivedLinkedEntry(data, entry('unrelated', 'c'))).toBe(false);
  });
  it('skips archived automation proposals and rejects direct assignments until restore', () => {
    const data = archiveWallet(sourced(), 'a', at), before = serializeBackup(data);
    expect(entryCategorySuggestions(data, defaultCategorySettings())).toEqual([]);
    expect(() => applyBankDecisions(data, [{ entryId: 'expense', category: 'Belanja' }])).toThrow(/arsip/);
    expect(entryCategorySuggestions(restoreWallet(data, 'a'), defaultCategorySettings())).toHaveLength(1);
    expect(serializeBackup(data)).toBe(before);
  });
});

describe('archived admission guard protects connected history', () => {
  it.each(['wallet', 'entry', 'fact', 'statement', 'annotation'] as const)('rejects mutation of archived %s', target => {
    const previous = archiveWallet(sourced(), 'a', at), next = structuredClone(previous);
    if (target === 'wallet') next.state.wallets[0].name = 'Changed';
    if (target === 'entry') next.state.entries[0].category = 'Changed';
    if (target === 'fact') next.metadata!.facts[0].description = 'Changed';
    if (target === 'statement') next.metadata!.statements[0].closingBalance += 1;
    if (target === 'annotation') next.metadata!.annotations![0].note = 'Changed';
    expect(() => assertArchivedWalletsUnchanged(previous, next)).toThrow(/baca saja|Pulihkan/);
  });
  it('rejects removal or addition of archived entries and deleting a used archived wallet', () => {
    const previous = archiveWallet(sourced(), 'a', at), next = structuredClone(previous);
    next.state.entries = []; expect(() => assertArchivedWalletsUnchanged(previous, next)).toThrow();
    const added = structuredClone(previous); added.state.entries.push(entry('new'));
    expect(() => assertArchivedWalletsUnchanged(previous, added)).toThrow();
    const deleted = structuredClone(previous); deleted.state.wallets = deleted.state.wallets.filter(row => row.id !== 'a'); delete deleted.metadata!.walletArchives;
    expect(() => assertArchivedWalletsUnchanged(previous, deleted)).toThrow(/tidak dapat dihapus/);
  });
  it('cannot bypass the guard by removing the marker and editing in the same write', () => {
    const previous = archiveWallet(sourced(), 'a', at), next = restoreWallet(previous, 'a');
    next.state.entries[0].note = 'Changed in restore'; expect(() => assertArchivedWalletsUnchanged(previous, next)).toThrow(/Pulihkan/);
    const restored = restoreWallet(previous, 'a'), later = structuredClone(restored); later.state.entries[0].note = 'Changed after durable restore';
    expect(() => assertArchivedWalletsUnchanged(restored, later)).not.toThrow();
  });
  it('blocks combined archive-and-edit and archive timestamp replacement', () => {
    const data = sourced(), archived = archiveWallet(data, 'a', at); archived.state.entries[0].amount += 1;
    expect(() => assertArchivedWalletsUnchanged(data, archived)).toThrow();
    const previous = archiveWallet(sourced(), 'a', at), changed = structuredClone(previous); changed.metadata!.walletArchives![0].at = '2026-11-01T12:00:00Z';
    expect(() => assertArchivedWalletsUnchanged(previous, changed)).toThrow(/Penanda arsip/);
  });
  it('allows independent wallet/entry updates and harmless record ordering', () => {
    const previous = archiveWallet(sourced(), 'a', at), next = structuredClone(previous);
    next.state.wallets[1].name = 'Other account renamed'; next.state.entries.push(entry('unrelated', 'b')); next.state.wallets.reverse();
    expect(() => assertArchivedWalletsUnchanged(previous, next)).not.toThrow();
  });
  it('freezes the linked bank fact of the counter-wallet without freezing its unrelated transactions', () => {
    const data = transfer();
    const source = { id: 'fa', walletId: 'a', currency: 'TRY' as const, postedOn: '2026-10-01', signedAmount: -110, balanceAfter: 890,
      description: 'Synthetic debit and fee', fingerprintVersion: 'ziraat-v1' as const, fingerprint: 'ziraat:0000000000000001' };
    const destination = { ...source, id: 'fb', walletId: 'b', postedOn: '2026-10-02', signedAmount: 100, balanceAfter: 100,
      description: 'Synthetic counter credit', fingerprint: 'ziraat:0000000000000002' };
    data.metadata!.facts = [source, destination];
    data.metadata!.statements = [
      { id: 'sa', walletId: 'a', currency: 'TRY', periodStart: source.postedOn, periodEnd: source.postedOn, openingBalance: 1000, closingBalance: 890, rowIds: ['fa'] },
      { id: 'sb', walletId: 'b', currency: 'TRY', periodStart: destination.postedOn, periodEnd: destination.postedOn, openingBalance: 0, closingBalance: 100, rowIds: ['fb'] },
    ];
    data.metadata!.links = [{ entryId: 'pair', source: 'fa', destination: 'fb', postingDates: { source: source.postedOn, destination: destination.postedOn } }];
    delete data.metadata!.transfers![0].decision;
    const previous = archiveWallet(prepareBackup(data).data, 'a', at), changed = structuredClone(previous);
    changed.metadata!.facts[1].description = 'Changed counterparty evidence';
    expect(() => assertArchivedWalletsUnchanged(previous, changed)).toThrow(/baca saja/);
    const unrelated = structuredClone(previous); unrelated.state.entries.push(entry('new-counter-purchase', 'b'));
    expect(() => assertArchivedWalletsUnchanged(previous, unrelated)).not.toThrow();
  });
  it('indexes transitive unpair counter-entries once and excludes them from editable category proposals', () => {
    const split = executeTransferCommand(transfer(), { kind: 'unpair', entryId: 'pair', destinationEntryId: 'counter', reason: 'Synthetic split', at });
    const source = split.state.entries.find(row => row.walletId === 'a')!;
    source.category = 'Belum dikategorikan'; source.note = 'POS MIGROS';
    split.state.entries.push(entry('unrelated-category', 'c'));
    expect(entryCategorySuggestions(split, defaultCategorySettings()).map(row => row.entry.id)).toContain(source.id);
    const archived = archiveWallet(split, 'b', at), ids = archivedReadOnlyEntryIds(archived);
    expect(ids).toEqual(new Set(split.state.entries.filter(row => row.walletId !== 'c').map(row => row.id)));
    expect(isArchivedLinkedEntry(archived, archived.state.entries.find(row => row.id === source.id)!)).toBe(true);
    expect(isArchivedLinkedEntry(archived, entry('new-on-archived', 'b'))).toBe(true);
    expect(isArchivedLinkedEntry(archived, entry('unrelated', 'c'))).toBe(false);
    expect(entryCategorySuggestions(archived, defaultCategorySettings()).map(row => row.entry.id)).toEqual(['unrelated-category']);
    expect(() => applyBankDecisions(archived, [{ entryId: source.id, category: 'Belanja' }])).toThrow(/arsip/);
    const allowed = applyBankDecisions(archived, [{ entryId: 'unrelated-category', category: 'Belanja' }]);
    expect(() => assertArchivedWalletsUnchanged(archived, allowed)).not.toThrow();
    expect(archivedReadOnlyEntryIds(restoreWallet(archived, 'b')).size).toBe(0);
  });
  it('freezes transfer principal, fee, context and counter-wallet split evidence together', () => {
    const previous = archiveWallet(transfer(), 'a', at), changed = structuredClone(previous);
    changed.state.entries[0].toAmount = changed.state.entries[0].toAmount! + 1; expect(() => assertArchivedWalletsUnchanged(previous, changed)).toThrow();
    const fee = structuredClone(previous); fee.state.entries[0].fee = 20; expect(() => assertArchivedWalletsUnchanged(previous, fee)).toThrow();
    const dates = structuredClone(previous); dates.metadata!.transfers![0].destinationDate = '2026-10-03';
    expect(() => assertArchivedWalletsUnchanged(previous, dates)).toThrow();
    const split = executeTransferCommand(transfer(), { kind: 'unpair', entryId: 'pair', destinationEntryId: 'counter', reason: 'Synthetic split', at });
    const archived = archiveWallet(split, 'a', at), counter = structuredClone(archived); counter.state.entries.find(row => row.walletId === 'b')!.amount++;
    expect(() => assertArchivedWalletsUnchanged(archived, counter)).toThrow();
  });
});
