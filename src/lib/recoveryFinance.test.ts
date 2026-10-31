import { describe, expect, it } from 'vitest';
import { summaryForCurrency, walletBalance, walletBalanceAt, type Entry, type State } from './finance';

function fixture(entries: Entry[] = [], openingBalance = 100_000): State {
  return {
    version: 1,
    wallets: [
      { id: 'a', name: 'A', currency: 'TRY', kind: 'bank', openingBalance },
      { id: 'b', name: 'B', currency: 'TRY', kind: 'cash', openingBalance: 0 },
      { id: 'usd', name: 'USD', currency: 'USD', kind: 'bank', openingBalance: 10_000 },
    ],
    entries,
  };
}

const entry = (id: string, amount: number, type: Entry['type'] = 'expense', date = '2026-10-30'): Entry => ({
  id, walletId: 'a', type, date, amount, category: 'Belanja', note: 'Synthetic recovery verification',
});

describe('recovered finance safeguards', () => {
  it.each([60_000, 65_000])('computes a %i-entry ledger without function-argument overflow', count => {
    const state = fixture(Array.from({ length: count }, (_, i) => entry(String(i), 1)), 10_000_000);
    expect(walletBalance(state, 'a')).toBe(10_000_000 - count);
    expect(walletBalanceAt(state, 'a', '2026-10-30')).toBe(10_000_000 - count);
    expect(summaryForCurrency(state, 'TRY', '2026-10')).toMatchObject({ balance: 10_000_000 - count, expense: count });
  });

  it('retains exact cancellation even when an intermediate total exceeds the safe bound', () => {
    const max = Number.MAX_SAFE_INTEGER;
    const state = fixture([entry('credit', max, 'income'), entry('debit', max)], max);
    expect(walletBalance(state, 'a')).toBe(max);
    expect(walletBalanceAt(state, 'a', '2026-10-30')).toBe(max);
  });

  it('still rejects positive and negative final overflow', () => {
    expect(() => walletBalance(fixture([entry('extra', 1, 'income')], Number.MAX_SAFE_INTEGER), 'a')).toThrow(RangeError);
    expect(() => walletBalance(fixture([entry('extra', 1)], Number.MIN_SAFE_INTEGER), 'a')).toThrow(RangeError);
    expect(() => summaryForCurrency(fixture([entry('one', Number.MAX_SAFE_INTEGER, 'income'), entry('two', 1, 'income')], 0), 'TRY', '2026-10')).toThrow(RangeError);
  });

  it('separates future entries from actual balances while preserving all-record balances', () => {
    const state = fixture([entry('future', 50_000, 'income', '2026-11-30')]);
    const before = structuredClone(state);
    expect(walletBalanceAt(state, 'a', '2026-10-30')).toBe(100_000);
    expect(walletBalance(state, 'a')).toBe(150_000);
    expect(walletBalanceAt(state, 'a', '2026-11-30')).toBe(150_000);
    expect(state).toEqual(before);
  });

  it('applies the same date to transfer debit, credit, and fee in legacy single-date data', () => {
    const transfer: Entry = { ...entry('transfer', 10_000, 'transfer', '2026-11-01'), toWalletId: 'b', toAmount: 10_000, fee: 250 };
    const state = fixture([transfer, entry('adjustment', -100, 'adjustment'), entry('pending', 75, 'unreviewed')]);
    expect(walletBalanceAt(state, 'a', '2026-10-31')).toBe(99_975);
    expect(walletBalanceAt(state, 'b', '2026-10-31')).toBe(0);
    expect(walletBalanceAt(state, 'a', '2026-11-01')).toBe(89_725);
    expect(walletBalanceAt(state, 'b', '2026-11-01')).toBe(10_000);
    expect(summaryForCurrency(state, 'TRY', '2026-11', '2026-11-01')).toMatchObject({ balance: 99_725, income: 0, expense: 250 });
    expect(summaryForCurrency(state, 'TRY', '2026-11', '2026-10-31')).toMatchObject({ balance: 99_975, income: 0, expense: 0 });
  });

  it('keeps the prior three-argument summary and provides explicit cutoff summaries', () => {
    const state = fixture([entry('today', 500, 'income'), entry('future', 1_000, 'income', '2026-10-31')]);
    expect(summaryForCurrency(state, 'TRY', '2026-10').income).toBe(1_500);
    expect(summaryForCurrency(state, 'TRY', '2026-10', '2026-10-30')).toMatchObject({ balance: 100_500, income: 500 });
    expect(summaryForCurrency(state, 'USD', '2026-10', '2026-10-30')).toEqual({ balance: 10_000, income: 0, expense: 0, uncategorized: 0 });
  });

  it.each(['2026-02-30', '2026-13-01', '30-10-2026', ''])('rejects invalid cutoff %s', cutoff => {
    expect(() => walletBalanceAt(fixture(), 'a', cutoff)).toThrow(RangeError);
    expect(() => summaryForCurrency(fixture(), 'TRY', '2026-10', cutoff)).toThrow(RangeError);
  });
});
