import { describe, expect, it } from 'vitest';
import type { Entry } from './finance';
import { buildCashflowReport } from './cashflowReport';
import { buildSpendingCalendar, dailySpending } from './spendingCalendar';
import { SOURCE_POLICY, type SourceDocument } from './sourceModel';
import { deviceDay } from './today';

const end = '2026-10-31';
function entry(id: string, amount: number, patch: Partial<Entry> = {}): Entry {
  return { id, amount, type: 'expense', category: '', note: '', walletId: 'bank', date: end, ...patch };
}
function source(...entries: Entry[]): SourceDocument {
  return { app: 'uangku', version: 1, demo: false, state: { version: 1, entries, wallets: [
    { id: 'bank', name: 'Sintetis', currency: 'IDR', kind: 'bank', openingBalance: 0 },
    { id: 'cash', name: 'Kas', currency: 'IDR', kind: 'cash', openingBalance: 0 },
    { id: 'usd', name: 'Dolar', currency: 'USD', kind: 'ewallet', openingBalance: 0 },
  ] } };
}

describe('daily confirmed spending', () => {
  it('agrees with category expense totals per currency and lists each entry once per day', () => {
    const data = source(entry('lunch', 100, { fee: 3 }), entry('pending', -500, { type: 'unreviewed' }),
      entry('income', 900, { type: 'income' }), entry('movement', -900, { type: 'movement' }),
      entry('correction', -10, { type: 'adjustment' }), entry('cash', 100, { walletId: 'cash' }),
      entry('snack', 200), entry('tomorrow', 44, { date: '2026-11-01' }), entry('usd', 12, { walletId: 'usd' }),
      entry('transfer', 700, { type: 'transfer', toWalletId: 'usd', toAmount: 5, fee: 7 }));
    data.metadata = { policy: SOURCE_POLICY, links: [], statements: [], facts: [],
      transfers: [{ entryId: 'transfer', sourceDate: '2026-10-30', destinationDate: '2026-11-01' }] };
    const before = structuredClone(data);
    const days = dailySpending(data, 'IDR', '2026-10-01', end);
    expect(days.get(end)).toEqual({ total: 303, entryIds: ['lunch', 'snack'] });
    expect(days.get('2026-10-30')).toEqual({ total: 7, entryIds: ['transfer'] });
    expect(days.size).toBe(2);
    for (const currency of ['USD', 'IDR'] as const) {
      const sum = [...dailySpending(data, currency, '2026-10-01', end).values()].reduce((n, day) => n + day.total, 0);
      expect(sum).toBe(buildCashflowReport(data, { currency, month: '2026-10', today: end, period: 'month' }).categoryExpenseTotal);
    }
    expect(data).toEqual(before);
  });

  it('uses a retained source date for fees and skips undated fees', () => {
    const xfer = (id: string) => entry(id, 100, { type: 'transfer', toWalletId: 'usd', toAmount: 20, fee: 5 });
    const data = source(xfer('unknown'), xfer('known'));
    data.metadata = { policy: SOURCE_POLICY, facts: [], statements: [], links: [
      { entryId: 'unknown', postingDates: { source: null, destination: end } },
      { entryId: 'known', postingDates: { source: '2026-09-30', destination: end } },
    ] };
    expect(dailySpending(data, 'IDR', '2026-10-01', end).size).toBe(0);
    expect(dailySpending(data, 'IDR', '2026-09-30', '2026-09-30').get('2026-09-30')?.total).toBe(5);
  });

  it('keeps the exact maximum and rejects unsafe inputs and overflowing daily totals', () => {
    const max = Number.MAX_SAFE_INTEGER;
    const total = (data: SourceDocument) => dailySpending(data, 'IDR', end, end).get(end)?.total;
    expect(total(source(entry('large', max - 1, { fee: 1 })))).toBe(max);
    expect(() => total(source(entry('large', max, { fee: 1 })))).toThrow(RangeError);
    expect(() => total(source(entry('large', max), entry('another', 2)))).toThrow(RangeError);
    expect(() => total(source(entry('fractional', 0.5)))).toThrow(RangeError);
  });
});

describe('53 week spending calendar', () => {
  it('returns 371 contiguous calendar days ending today by default, including leap day in a leap year', () => {
    expect(buildSpendingCalendar(source(), 'IDR').at(-1)?.date).toBe(deviceDay());
    const days = buildSpendingCalendar(source(), 'IDR', '2024-03-01');
    expect(days).toHaveLength(371);
    expect(days[0].date).toBe('2023-02-25');
    expect(days.at(-2)).toEqual({ date: '2024-02-29', level: 0, total: 0, entryIds: [] });
    expect(new Set(days.map(day => day.date)).size).toBe(371);
  });

  it('ranks only positive days, assigning equal totals the same level', () => {
    const start = '2026-10-';
    const amounts = [100, 100, 300, 300, 500, 500, 700, 900];
    const data = source(...amounts.map((amount, i) => entry(String(i), amount, { date: start + (24 + i) })));
    const days = buildSpendingCalendar(data, 'IDR', end);
    expect(days.slice(-9).map(day => day.level)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect(buildSpendingCalendar(source(entry('only', 12)), 'IDR', end).at(-1)?.level).toBe(1);
  });

  it('rejects invalid date ranges', () => {
    expect(() => dailySpending(source(), 'IDR', '2026-02-30', end)).toThrow(RangeError);
    expect(() => dailySpending(source(), 'IDR', end, '2026-10-30')).toThrow(RangeError);
    expect(() => buildSpendingCalendar(source(), 'IDR', 'bad date')).toThrow(RangeError);
  });
});
