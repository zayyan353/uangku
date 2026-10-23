import { describe, expect, it } from 'vitest';
import {
  buildDemoState, formatDate, formatMoney, parseMoney, summaryForCurrency,
  validateEntry, validateWallet, walletBalance,
  type Entry, type State, type Wallet,
} from './finance';

const wallets: Wallet[] = [
  { id: 'bank-idr', name: 'Bank', kind: 'bank', currency: 'IDR', openingBalance: 100_000_000 },
  { id: 'cash-idr', name: 'Cash', kind: 'cash', currency: 'IDR', openingBalance: 0 },
  { id: 'bank-try', name: 'Lira', kind: 'bank', currency: 'TRY', openingBalance: 10_000 },
];
const state = (entries: Entry[] = []): State => ({ version: 1, wallets, entries });
const entry = (overrides: Partial<Entry> = {}): Entry => ({
  id: 'test-1', date: '2026-10-23', type: 'expense', walletId: 'bank-idr',
  amount: 5_000, category: 'Belanja', note: '', ...overrides,
});

describe('monetary input preserves exact minor units', () => {
  it.each([
    ['1234', 123_400], ['1.234,56', 123_456], ['1,234.56', 123_456],
    ['1.000', 100_000], ['1,000', 100_000], ['1.234.567', 123_456_700],
    ['1,234,567', 123_456_700], ['12,5', 1_250], ['12.50', 1_250],
    ['0,01', 1], ['.50', 50], ['-1.234,50', -123_450],
    [' 1 234,56 ', 123_456], ['-0', 0],
  ])('parses %s', (input, expected) => expect(parseMoney(input)).toBe(expected));

  it.each(['', ' ', 'abc', 'Rp100', 'NaN', 'Infinity', '1e3', '1.2345',
    '1,23,456', '1.23.456', '1,234,56', '1.234,', '1.234,567', '--1', '1-1',
    '9007199254740991', '90.071.992.547.409,92'])('rejects malformed or unsafe %s', (input) => {
    expect(parseMoney(input)).toBeNull();
  });

  it('accepts the exact safe integer boundary but not a cent more', () => {
    expect(parseMoney('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseMoney('90071992547409.92')).toBeNull();
  });
});

describe('balances and expense classification', () => {
  it('counts a cash withdrawal once as a transfer and does not create expenses', () => {
    const s = state([entry({ type: 'transfer', amount: 20_000_000, toWalletId: 'cash-idr', toAmount: 20_000_000 })]);
    expect(validateEntry(state(), s.entries[0])).toBeNull();
    expect(walletBalance(s, 'bank-idr')).toBe(80_000_000);
    expect(walletBalance(s, 'cash-idr')).toBe(20_000_000);
    expect(summaryForCurrency(s, 'IDR', '2026-10')).toEqual({
      balance: 100_000_000, income: 0, expense: 0, uncategorized: 0,
    });
  });

  it('keeps the chosen FX rate and both native balances while expensing only the fee', () => {
    const transfer = entry({ type: 'transfer', amount: 1_000_000, toWalletId: 'bank-try',
      toAmount: 2_500, rate: 0.0025, fee: 1_500 });
    const s = state([transfer]);
    expect(validateEntry(state(), transfer)).toBeNull();
    expect(walletBalance(s, 'bank-idr')).toBe(98_998_500);
    expect(walletBalance(s, 'bank-try')).toBe(12_500);
    expect(summaryForCurrency(s, 'IDR', '2026-10').expense).toBe(1_500);
    expect(summaryForCurrency(s, 'TRY', '2026-10').income).toBe(0);
    expect(s.entries[0].rate).toBe(0.0025);
  });

  it('applies signed balance adjustments without inventing income or spending', () => {
    const s = state([entry({ type: 'adjustment', walletId: 'cash-idr', amount: -1_500 })]);
    expect(validateEntry(state(), s.entries[0])).toBeNull();
    expect(walletBalance(s, 'cash-idr')).toBe(-1_500);
    expect(summaryForCurrency(s, 'IDR', '2026-10')).toMatchObject({ income: 0, expense: 0 });
  });

  it('limits monthly flows while balances retain previous months', () => {
    const s = state([
      entry({ id: 'older', date: '2026-09-30', type: 'income', amount: 10_000 }),
      entry({ id: 'uncat', category: 'Belum dikategorikan', amount: 2_000 }),
      entry({ id: 'income', type: 'income', amount: 3_000, category: 'Pemasukan' }),
    ]);
    expect(summaryForCurrency(s, 'IDR', '2026-10')).toEqual({
      balance: 100_011_000, income: 3_000, expense: 2_000, uncategorized: 1,
    });
  });

  it('allows a real overdraft instead of hiding an expense', () => {
    const expense = entry({ walletId: 'cash-idr', amount: 10_000 });
    expect(validateEntry(state(), expense)).toBeNull();
    expect(walletBalance(state([expense]), 'cash-idr')).toBe(-10_000);
  });

  it('preserves signed unreviewed bank flows without asserting income or expenses', () => {
    const credit = entry({ id: 'import-credit', type: 'unreviewed', amount: 50_000,
      category: 'Belum dikategorikan', sourceKey: 'opaque-source-credit' });
    const debit = entry({ id: 'import-debit', type: 'unreviewed', amount: -15_000,
      category: 'Belum dikategorikan', sourceKey: 'opaque-source-debit' });
    expect(validateEntry(state(), credit)).toBeNull();
    expect(validateEntry(state(), debit)).toBeNull();
    expect(walletBalance(state([credit, debit]), 'bank-idr')).toBe(100_035_000);
    expect(summaryForCurrency(state([credit, debit]), 'IDR', '2026-10')).toEqual({
      balance: 100_035_000, income: 0, expense: 0, uncategorized: 2,
    });
    expect(validateEntry(state(), { ...credit, amount: 0 })).not.toBeNull();
  });
});

describe('entry validation protects bookkeeping', () => {
  it.each([
    { amount: 0 }, { amount: -1 }, { amount: 0.5 }, { amount: Infinity },
    { amount: NaN }, { amount: Number.MAX_SAFE_INTEGER + 1 },
    { date: '2026-02-30' }, { date: '23.10.2026' }, { walletId: 'missing' },
  ])('rejects invalid values %j', (overrides) => {
    expect(validateEntry(state(), entry(overrides))).not.toBeNull();
  });

  it('rejects an existing ID, same-wallet transfer and unequal same-currency transfer', () => {
    expect(validateEntry(state([entry()]), entry())).not.toBeNull();
    expect(validateEntry(state(), entry({ type: 'transfer', toWalletId: 'bank-idr', toAmount: 5_000 }))).not.toBeNull();
    expect(validateEntry(state(), entry({ type: 'transfer', toWalletId: 'cash-idr', toAmount: 4_000 }))).not.toBeNull();
  });

  it('requires explicit valid FX rate and a matching destination amount', () => {
    const transfer = entry({ type: 'transfer', toWalletId: 'bank-try', toAmount: 1_000 });
    expect(validateEntry(state(), transfer)).not.toBeNull();
    expect(validateEntry(state(), { ...transfer, rate: 0 })).not.toBeNull();
    expect(validateEntry(state(), { ...transfer, rate: Infinity })).not.toBeNull();
    expect(validateEntry(state(), { ...transfer, rate: 0.2 })).toBeNull();
    expect(validateEntry(state(), { ...transfer, rate: 0.3 })).not.toBeNull();
  });

  it('accepts at most one minor unit of FX rounding difference', () => {
    const transfer = entry({ type: 'transfer', amount: 101, toWalletId: 'bank-try', rate: 0.5, toAmount: 50 });
    expect(validateEntry(state(), transfer)).toBeNull();
    expect(validateEntry(state(), { ...transfer, toAmount: 49 })).not.toBeNull();
  });

  it('rejects negative, fractional or unsafe transfer fees', () => {
    const transfer = entry({ type: 'transfer', toWalletId: 'cash-idr', toAmount: 5_000 });
    expect(validateEntry(state(), { ...transfer, fee: -1 })).not.toBeNull();
    expect(validateEntry(state(), { ...transfer, fee: 0.1 })).not.toBeNull();
    expect(validateEntry(state(), { ...transfer, amount: Number.MAX_SAFE_INTEGER, toAmount: Number.MAX_SAFE_INTEGER, fee: 1 })).not.toBeNull();
  });
});

describe('wallet validation and display', () => {
  it('validates empty names and noninteger starting balances', () => {
    expect(validateWallet(wallets[0])).toBeNull();
    expect(validateWallet({ ...wallets[0], name: ' ' })).not.toBeNull();
    expect(validateWallet({ ...wallets[0], openingBalance: 1.1 })).not.toBeNull();
  });

  it('formats integer money and date-only values for Indonesian readers', () => {
    expect(formatMoney(125_000, 'IDR')).toContain('1.250');
    expect(formatMoney(125, 'TRY')).toContain('1,25');
    expect(formatDate('2026-10-23')).toContain('23');
    expect(formatDate('invalid')).toBe('invalid');
  });

  it('creates a valid fictional demo in the current month with no future entries', () => {
    const s = buildDemoState(new Date('2026-10-05T12:00:00Z'));
    expect(s.wallets).toHaveLength(7);
    for (const wallet of s.wallets) expect(validateWallet(wallet)).toBeNull();
    const incremental: State = { ...s, entries: [] };
    for (const transaction of s.entries) {
      expect(transaction.date <= '2026-10-05').toBe(true);
      expect(validateEntry(incremental, transaction)).toBeNull();
      incremental.entries.push(transaction);
    }
    expect(s.entries.some((e) => e.type === 'transfer' && e.rate && e.rate !== 1)).toBe(true);
  });
});
