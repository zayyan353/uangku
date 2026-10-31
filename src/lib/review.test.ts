import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { canCategorize, categorizeEntries, transferCandidates } from './review';
import { summaryForCurrency, walletBalance, type Entry, type State, type Wallet } from './finance';
import { entriesFromImport, parseZiraatWorkbook } from './importer';

const wallets: Wallet[] = [
  { id: 'bank-try', name: 'Bank TL', currency: 'TRY', kind: 'bank', openingBalance: 6_000 },
  { id: 'cash-try', name: 'Cash TL', currency: 'TRY', kind: 'cash', openingBalance: 1_000 },
  { id: 'bank-idr', name: 'Bank IDR', currency: 'IDR', kind: 'bank', openingBalance: 1_000_000 },
];
const entry = (overrides: Partial<Entry> = {}): Entry => ({
  id: 'credit', type: 'unreviewed', walletId: 'bank-try', date: '2026-10-23',
  amount: 1_000, category: 'Belum dikategorikan', note: 'Synthetic bank flow',
  sourceKey: 'opaque-source-key', toSourceKey: 'opaque-destination-key', importBatch: 'example-batch',
  ...overrides,
});
const state = (entries: Entry[] = [entry()]): State => ({ version: 1, wallets, entries });
const balances = (s: State) => s.wallets.map(wallet => walletBalance(s, wallet.id));

function syntheticStatement(): ArrayBuffer {
  const rows: Array<Array<string | number>> = [
    ['Mata uang', 'TL'],
    ['Tarih', 'Fiş No', 'Açıklama', 'İşlem Tutarı', 'Bakiye'],
    ['23.10.2026', 'EXAMPLE-A', 'POS example', -20, 180],
    ['22.10.2026', 'EXAMPLE-B', 'HAVALE example', 100, 200],
  ];
  const xml = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map(row => `<row>${row.map(value => typeof value === 'number'
    ? `<c t="n"><v>${value}</v></c>` : `<c t="str"><v>${value}</v></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const archive = zipSync({ 'xl/worksheets/sheet1.xml': strToU8(xml) });
  return archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
}

describe('bulk categories preserve financial meaning until explicitly confirmed', () => {
  it('allows categories only for income, expense, and unreviewed records', () => {
    expect(canCategorize(entry())).toBe(true);
    expect(canCategorize(entry({ type: 'income' }))).toBe(true);
    expect(canCategorize(entry({ type: 'expense' }))).toBe(true);
    expect(canCategorize(entry({ type: 'transfer' }))).toBe(false);
    expect(canCategorize(entry({ type: 'adjustment' }))).toBe(false);
  });

  it('changes only categories on confirmed income and expense records', () => {
    const income = entry({ type: 'income' });
    const expense = entry({ id: 'expense', type: 'expense', amount: 300 });
    const original = state([income, expense]);
    const result = categorizeEntries(original, ['credit', 'expense'], 'Belanja');
    expect(result.entries).toEqual([{ ...income, category: 'Belanja' }, { ...expense, category: 'Belanja' }]);
    expect(balances(result)).toEqual(balances(original));
    expect(summaryForCurrency(result, 'TRY', '2026-10')).toMatchObject({ income: 1_000, expense: 300 });
  });

  it('keeps positive credits and negative debits signed and unreviewed by default', () => {
    const original = state([entry(), entry({ id: 'debit', amount: -300 })]);
    const result = categorizeEntries(original, ['credit', 'debit'], 'Transportasi');
    expect(result.entries.map(e => [e.type, e.amount, e.category])).toEqual([
      ['unreviewed', 1_000, 'Transportasi'], ['unreviewed', -300, 'Transportasi'],
    ]);
    expect(balances(result)).toEqual(balances(original));
    expect(summaryForCurrency(result, 'TRY', '2026-10')).toMatchObject({ income: 0, expense: 0, uncategorized: 2 });
  });

  it('changes pending flow types only with explicit confirmation, preserving every balance', () => {
    const original = state([entry(), entry({ id: 'debit', amount: -300 })]);
    const result = categorizeEntries(original, ['credit', 'debit'], 'Lainnya', true);
    expect(result.entries.map(e => [e.type, e.amount])).toEqual([['income', 1_000], ['expense', 300]]);
    expect(balances(result)).toEqual(balances(original));
    expect(summaryForCurrency(original, 'TRY', '2026-10')).toMatchObject({ income: 0, expense: 0 });
    expect(summaryForCurrency(result, 'TRY', '2026-10')).toMatchObject({ income: 1_000, expense: 300, uncategorized: 0 });
    expect(result.entries[0]).toEqual({ ...original.entries[0], category: 'Lainnya', type: 'income' });
    expect(result.entries[1]).toEqual({ ...original.entries[1], category: 'Lainnya', type: 'expense', amount: 300 });
  });

  it('keeps multiple currencies separate with no conversion', () => {
    const original = state([entry({ amount: -300 }), entry({ id: 'rupiah', walletId: 'bank-idr', amount: 150_000 })]);
    const result = categorizeEntries(original, ['credit', 'rupiah'], 'Lainnya', true);
    expect(balances(result)).toEqual(balances(original));
    expect(summaryForCurrency(result, 'TRY', '2026-10').expense).toBe(300);
    expect(summaryForCurrency(result, 'IDR', '2026-10').income).toBe(150_000);
    expect(result.entries[1].walletId).toBe('bank-idr');
    expect(result.wallets).toBe(original.wallets);
  });

  it('preserves import fingerprints so the same workbook stays deduplicated', () => {
    const bytes = syntheticStatement();
    const wallet = wallets[0];
    const initial = parseZiraatWorkbook(bytes, wallet, []);
    const imported = entriesFromImport(initial.rows, wallet.id, 'batch-1');
    const original = state(imported);
    const cleaned = categorizeEntries(original, imported.map(e => e.id), 'Belanja', true);
    expect(cleaned.entries.map(e => e.sourceKey)).toEqual(imported.map(e => e.sourceKey));
    expect(cleaned.entries.map(e => e.importBatch)).toEqual(['batch-1', 'batch-1']);
    expect(cleaned.entries.map(e => e.id)).toEqual(imported.map(e => e.id));
    const repeated = parseZiraatWorkbook(bytes, wallet, cleaned.entries);
    expect(repeated.rows.every(row => row.duplicate && !row.selected)).toBe(true);
    expect(entriesFromImport(repeated.rows, wallet.id, 'batch-2')).toEqual([]);
  });

  it('does not mutate old state and reuses unaffected records and wallet references', () => {
    const untouched = entry({ id: 'untouched', type: 'expense', amount: 100 });
    const original = state([entry(), untouched]);
    const snapshot = structuredClone(original);
    Object.freeze(original.entries[0]); Object.freeze(original.entries[1]); Object.freeze(original.entries);
    Object.freeze(original);
    const result = categorizeEntries(original, ['credit'], 'Pemasukan');
    expect(original).toEqual(snapshot);
    expect(result).not.toBe(original);
    expect(result.entries).not.toBe(original.entries);
    expect(result.entries[1]).toBe(untouched);
    expect(result.wallets).toBe(original.wallets);
    expect(result.entries[0].toSourceKey).toBe('opaque-destination-key');
  });

  it('keeps already-equal records and entry arrays when only the state wrapper needs cloning', () => {
    const original = state();
    const result = categorizeEntries(original, ['credit', 'credit'], 'Belum dikategorikan');
    expect(result).not.toBe(original);
    expect(result.entries).toBe(original.entries);
    expect(result.entries[0]).toBe(original.entries[0]);
  });

  it('rejects a missing ID atomically without changing any valid selected record', () => {
    const original = state();
    const snapshot = structuredClone(original);
    expect(() => categorizeEntries(original, ['credit', 'missing'], 'Belanja', true)).toThrow(/tidak ditemukan/);
    expect(original).toEqual(snapshot);
  });

  it.each(['transfer', 'adjustment'] as const)('rejects a mixed selection containing %s atomically', (type) => {
    const original = state([entry(), entry({ id: 'unsupported', type })]);
    const snapshot = structuredClone(original);
    expect(() => categorizeEntries(original, ['credit', 'unsupported'], 'Belanja')).toThrow(/Transfer dan penyesuaian/);
    expect(original).toEqual(snapshot);
  });

  it('rejects empty selection, unsupported category, and invalid selected entries', () => {
    expect(() => categorizeEntries(state(), [], 'Belanja')).toThrow(/setidaknya satu/);
    expect(() => categorizeEntries(state(), ['credit'], 'Unknown category')).toThrow(/kategori yang tersedia/);
    expect(() => categorizeEntries(state([entry({ amount: 0 })]), ['credit'], 'Belanja', true)).toThrow(/lebih besar dari nol/);
    expect(() => categorizeEntries(state([entry({ walletId: 'missing' })]), ['credit'], 'Belanja')).toThrow(/dompet asal/);
  });
});

describe('conservative transfer candidate suggestions', () => {
  it('offers confirmed movement legs symmetrically without changing either signed posting or balance', () => {
    const original = state([
      entry({ id: 'bank-debit', type: 'movement', amount: -1_000, date: '2026-10-31' }),
      entry({ id: 'wallet-credit', type: 'movement', walletId: 'tracked-ewallet', amount: 1_000, date: '2026-11-02' }),
    ]);
    original.wallets = [...wallets, { id: 'tracked-ewallet', name: 'Synthetic e-wallet', currency: 'TRY', kind: 'ewallet', openingBalance: 0 }];
    const before = structuredClone(original), beforeBalances = balances(original);
    expect(transferCandidates(original, 'bank-debit')).toEqual([{ id: 'wallet-credit', daysApart: 2 }]);
    expect(transferCandidates(original, 'wallet-credit')).toEqual([{ id: 'bank-debit', daysApart: 2 }]);
    expect(original).toEqual(before); expect(balances(original)).toEqual(beforeBalances);
    expect(original.entries.map(row => [row.type, row.amount])).toEqual([['movement', -1_000], ['movement', 1_000]]);
  });

  it.each([
    ['movement', 'unreviewed'], ['unreviewed', 'movement'],
  ] as const)('allows an explicit candidate between %s debit and %s credit', (debitType, creditType) => {
    const original = state([
      entry({ id: 'debit', type: debitType, amount: -1_000 }),
      entry({ id: 'credit', type: creditType, walletId: 'tracked-bank', amount: 1_000 }),
    ]);
    original.wallets = [...wallets, { id: 'tracked-bank', name: 'Synthetic second bank', currency: 'TRY', kind: 'bank', openingBalance: 0 }];
    expect(transferCandidates(original, 'credit')).toEqual([{ id: 'debit', daysApart: 0 }]);
    expect(transferCandidates(original, 'debit')).toEqual([{ id: 'credit', daysApart: 0 }]);
  });

  it('does not turn ordinary confirmed income, expense, adjustment, or existing transfer into movement pairing candidates', () => {
    const original = state([
      entry({ id: 'debit', type: 'movement', amount: -1_000 }),
      ...(['income', 'expense', 'adjustment', 'transfer'] as const).map(type => entry({ id: type, type, walletId: 'tracked-bank', amount: 1_000 })),
    ]);
    original.wallets = [...wallets, { id: 'tracked-bank', name: 'Synthetic second bank', currency: 'TRY', kind: 'bank', openingBalance: 0 }];
    expect(transferCandidates(original, 'debit')).toEqual([]);
  });

  it('matches opposite signed pending flows in another wallet, closest date first', () => {
    const original = state([
      entry({ amount: -1_000 }),
      entry({ id: 'three-days', walletId: 'cash-try', amount: 1_000, date: '2026-10-26' }),
      entry({ id: 'same-day', walletId: 'cash-try', amount: 1_000 }),
      entry({ id: 'one-day', walletId: 'cash-try', amount: 1_000, date: '2026-10-22' }),
    ]);
    expect(transferCandidates(original, 'credit')).toEqual([
      { id: 'same-day', daysApart: 0 }, { id: 'one-day', daysApart: 1 }, { id: 'three-days', daysApart: 3 },
    ]);
  });

  it('works symmetrically when reviewing the incoming side', () => {
    const original = state([entry(), entry({ id: 'outgoing', walletId: 'cash-try', amount: -1_000 })]);
    expect(transferCandidates(original, 'credit')).toEqual([{ id: 'outgoing', daysApart: 0 }]);
  });

  it('does not infer currency conversions, fee aggregation, or confirmed transaction ownership', () => {
    const original = state([
      entry({ amount: -1_000 }),
      entry({ id: 'other-currency', walletId: 'bank-idr', amount: 1_000 }),
      entry({ id: 'different-amount', walletId: 'cash-try', amount: 900 }),
      entry({ id: 'fee-split', walletId: 'cash-try', amount: 1_100, fee: 100 }),
      entry({ id: 'same-sign', walletId: 'cash-try', amount: -1_000 }),
      entry({ id: 'same-wallet', amount: 1_000 }),
      entry({ id: 'confirmed-income', type: 'income', walletId: 'cash-try', amount: 1_000 }),
      entry({ id: 'too-old', walletId: 'cash-try', amount: 1_000, date: '2026-10-19' }),
      entry({ id: 'missing-wallet', walletId: 'missing', amount: 1_000 }),
    ]);
    expect(transferCandidates(original, 'credit')).toEqual([]);
  });

  it('retains all ambiguous matching candidates without confirming or mutating any', () => {
    const original = state([entry({ amount: -1_000 }),
      entry({ id: 'option-a', walletId: 'cash-try' }), entry({ id: 'option-b', walletId: 'cash-try' })]);
    const snapshot = structuredClone(original);
    expect(transferCandidates(original, 'credit')).toEqual([{ id: 'option-a', daysApart: 0 }, { id: 'option-b', daysApart: 0 }]);
    expect(original).toEqual(snapshot);
    expect(original.entries.every(e => e.type === 'unreviewed')).toBe(true);
  });

  it('uses calendar days across month boundaries', () => {
    const original = state([entry({ date: '2026-10-31', amount: -1_000 }),
      entry({ id: 'november', date: '2026-11-03', walletId: 'cash-try' })]);
    expect(transferCandidates(original, 'credit')).toEqual([{ id: 'november', daysApart: 3 }]);
  });

  it('returns no suggestions for a missing, confirmed, zero, or invalid-date source', () => {
    expect(transferCandidates(state(), 'missing')).toEqual([]);
    expect(transferCandidates(state([entry({ type: 'income' })]), 'credit')).toEqual([]);
    expect(transferCandidates(state([entry({ amount: 0 })]), 'credit')).toEqual([]);
    expect(transferCandidates(state([entry({ date: '2026-02-30' })]), 'credit')).toEqual([]);
    expect(transferCandidates(state([entry(), entry({ id: 'invalid-date', date: '2026-02-30', walletId: 'cash-try', amount: -1_000 })]), 'credit')).toEqual([]);
  });
});
