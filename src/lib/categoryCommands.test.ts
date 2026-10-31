import { describe, expect, it, vi, afterEach } from 'vitest';
import { applyCategoryAssignments, type CategoryAssignment } from './categoryCommands';
import { walletBalance, type Entry } from './finance';
import { parseBackupText, serializeBackup, MAX_BACKUP_BYTES } from './storage';
import { SOURCE_POLICY, type SourceDocument } from './sourceModel';

const uncategorized = 'Belum dikategorikan';
function plain(): SourceDocument {
  return { app: 'uangku', version: 1, demo: false, state: { version: 1,
    wallets: [{ id: 'bank', name: 'Synthetic bank', kind: 'bank', currency: 'TRY', openingBalance: 10000 },
      { id: 'cash', name: 'Synthetic cash', kind: 'cash', currency: 'TRY', openingBalance: 0 }],
    entries: [
      { id: 'expense', date: '2026-10-01', type: 'expense', walletId: 'bank', amount: 100, category: uncategorized, note: 'Synthetic POS merchant', sourceKey: 'ziraat:0000000000000001', importBatch: 'batch' },
      { id: 'pending', date: '2026-10-02', type: 'unreviewed', walletId: 'bank', amount: 200, category: '', note: 'Synthetic unresolved incoming', sourceKey: 'ziraat:0000000000000002', importBatch: 'batch' },
      { id: 'untouched', date: '2026-10-03', type: 'income', walletId: 'cash', amount: 300, category: 'Already chosen', note: 'Keep this exact note' },
    ] } };
}
function sourced(): SourceDocument {
  const data = plain();
  data.metadata = { policy: SOURCE_POLICY, facts: [
    { id: 'fact-expense', walletId: 'bank', currency: 'TRY', postedOn: '2026-10-01', signedAmount: -100, balanceAfter: 9900, description: '  Original İŞLEM POS  ', fingerprintVersion: 'ziraat-v1', fingerprint: 'ziraat:0000000000000001' },
    { id: 'fact-pending', walletId: 'bank', currency: 'TRY', postedOn: '2026-10-02', signedAmount: 200, balanceAfter: 10100, description: '  Original unresolved incoming  ', fingerprintVersion: 'ziraat-v1', fingerprint: 'ziraat:0000000000000002' },
  ], links: [{ entryId: 'expense', source: 'fact-expense' }, { entryId: 'pending', source: 'fact-pending' }],
  statements: [{ id: 'statement', walletId: 'bank', currency: 'TRY', periodStart: '2026-10-01', periodEnd: '2026-10-02', openingBalance: 10000, closingBalance: 10100, rowIds: ['fact-expense', 'fact-pending'] }],
  annotations: [{ sourceId: 'fact-expense', category: uncategorized, note: 'Preserve prior saved annotation', confirmedType: 'expense', importBatch: 'original-annotation-batch' }] };
  return data;
}
const assignments: CategoryAssignment[] = [
  { entryId: 'expense', category: 'Bahan makanan' }, { entryId: 'pending', category: 'Pengembalian dana' },
];
afterEach(() => vi.unstubAllGlobals());

describe('reviewed category assignments', () => {
  it.each([false, true])('applies varied categories in one detached v1/v2 proposal without financial reinterpretation (metadata=%s)', withMetadata => {
    const data = withMetadata ? sourced() : plain(), before = structuredClone(data);
    const balances = data.state.wallets.map(w => walletBalance(data.state, w.id, data.metadata));
    const result = applyCategoryAssignments(data, assignments);
    expect(data).toEqual(before);
    expect(result.state.wallets).toEqual(data.state.wallets);
    expect(result.state.entries.map(({ category: _category, ...entry }) => entry)).toEqual(data.state.entries.map(({ category: _category, ...entry }) => entry));
    expect(result.state.entries.map(e => e.category)).toEqual(['Bahan makanan', 'Pengembalian dana', 'Already chosen']);
    expect(result.state.entries.find(e => e.id === 'pending')).toMatchObject({ type: 'unreviewed', amount: 200 });
    expect(result.state.wallets.map(w => walletBalance(result.state, w.id, result.metadata))).toEqual(balances);
    if (withMetadata) {
      expect(result.metadata!.facts).toEqual(data.metadata!.facts);
      expect(result.metadata!.links).toEqual(data.metadata!.links);
      expect(result.metadata!.statements).toEqual(data.metadata!.statements);
      expect(result.metadata!.annotations).toEqual([
        { ...data.metadata!.annotations![0], category: 'Bahan makanan' },
        { sourceId: 'fact-pending', category: 'Pengembalian dana' },
      ]);
    } else expect(result.metadata).toBeUndefined();
    const raw = serializeBackup(result);
    expect(JSON.parse(raw).version).toBe(withMetadata ? 2 : 1);
    expect(parseBackupText(raw)).toEqual(result);
  });

  it('retains a negative unresolved amount and does not claim confirmed income/expense in new annotations', () => {
    const data = sourced();
    data.state.entries[1].amount = -200;
    data.metadata!.facts[1].signedAmount = -200;
    data.metadata!.facts[1].balanceAfter = 9700;
    data.metadata!.statements[0].closingBalance = 9700;
    const result = applyCategoryAssignments(data, [{ entryId: 'pending', category: 'Makan & minum' }]);
    expect(result.state.entries[1]).toEqual({ ...data.state.entries[1], category: 'Makan & minum' });
    expect(result.metadata!.annotations!.find(a => a.sourceId === 'fact-pending')).toEqual({ sourceId: 'fact-pending', category: 'Makan & minum' });
  });

  it.each([
    [] as CategoryAssignment[],
    [{ entryId: 'expense', category: 'A' }, { entryId: 'expense', category: 'B' }],
    [{ entryId: 'missing', category: 'Bahan makanan' }],
    [{ entryId: 'untouched', category: 'Overwrite manual choice' }],
    [{ entryId: 'expense', category: '' }],
    [{ entryId: 'expense', category: '  ' }],
    [{ entryId: 'expense', category: uncategorized }],
    [{ entryId: 'expense', category: 'x'.repeat(81) }],
  ].map(selection => [selection]))('rejects empty, duplicate, missing, manual or invalid selections atomically (%j)', selection => {
    const data = sourced(), before = serializeBackup(data), setItem = vi.fn();
    vi.stubGlobal('localStorage', { setItem });
    expect(() => applyCategoryAssignments(data, selection)).toThrow();
    expect(serializeBackup(data)).toBe(before);
    expect(setItem).not.toHaveBeenCalled();
  });

  it.each(['transfer', 'adjustment'] as const)('rejects %s without changing unrelated transfer data', type => {
    const data = plain();
    const entry: Entry = type === 'transfer'
      ? { id: 'restricted', date: '2026-10-04', type, walletId: 'bank', toWalletId: 'cash', amount: 50, toAmount: 50, fee: 2, category: '', note: 'Synthetic transfer' }
      : { id: 'restricted', date: '2026-10-04', type, walletId: 'bank', amount: -50, category: '', note: 'Synthetic adjustment' };
    data.state.entries.push(entry);
    const before = serializeBackup(data);
    expect(() => applyCategoryAssignments(data, [...assignments, { entryId: entry.id, category: 'Lainnya' }])).toThrow(/Transfer dan penyesuaian/);
    expect(serializeBackup(data)).toBe(before);
  });

  it('protects a category filled after preview and leaves the whole batch unapplied', () => {
    const data = sourced();
    data.state.entries[1].category = 'My later explicit choice';
    const before = structuredClone(data);
    expect(() => applyCategoryAssignments(data, assignments)).toThrow(/sudah diisi/);
    expect(data).toEqual(before);
  });

  it('rejects a category batch exceeding the financial budget and retains the old backup exactly', () => {
    const data = plain();
    data.state.entries = [];
    let bytes = new TextEncoder().encode(JSON.stringify(data)).byteLength;
    for (let i = 0; i < 3000; i++) {
      const entry: Entry = { id: `large-${i}`, date: '2026-10-01', walletId: 'bank', amount: 1, type: 'expense', category: '', note: 'x'.repeat(3900) };
      const cost = new TextEncoder().encode(JSON.stringify(entry)).byteLength + (i ? 1 : 0);
      if (bytes + cost > MAX_BACKUP_BYTES - 64) break;
      bytes += cost;
      data.state.entries.push(entry);
    }
    const before = serializeBackup(data);
    expect(new TextEncoder().encode(before).byteLength).toBeLessThanOrEqual(MAX_BACKUP_BYTES);
    const selections = data.state.entries.map(e => ({ entryId: e.id, category: 'Synthetic valid long category '.padEnd(80, 'x') }));
    expect(() => applyCategoryAssignments(data, selections)).toThrow(/8 MB|8 MiB|batas/);
    expect(serializeBackup(data)).toBe(before);
  }, 20_000);
});
