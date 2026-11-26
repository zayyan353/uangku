import { describe, expect, it } from 'vitest';
import { ageOfMoney } from './ageOfMoney';
import type { Entry } from './finance';
import { SOURCE_POLICY, type SourceDocument } from './sourceModel';

const cutoff = '2026-02-28';
function row(id: string, type: Entry['type'], amount: number, day: string, patch: Partial<Entry> = {}): Entry {
  return { id, type, amount, date: day, category: '', note: '', walletId: 'bank', ...patch };
}
function source(entries: Entry[], openingBalance = 0): SourceDocument {
  return { app: 'uangku', version: 1, demo: false, state: { version: 1, entries, wallets: [
    { id: 'bank', name: 'Bank', kind: 'bank', currency: 'IDR', openingBalance },
    { id: 'other', name: 'Lain', kind: 'ewallet', currency: 'IDR', openingBalance: 0 },
    { id: 'usd', name: 'Dolar', kind: 'bank', currency: 'USD', openingBalance: 0 },
    { id: 'cash', name: 'Kas', kind: 'cash', currency: 'IDR', openingBalance: 0 },
  ] } };
}
const purchases = (count: number, day: string, amount = 1, walletId = 'bank') =>
  Array.from({ length: count }, (_, i) => row('buy-' + i, 'expense', amount, day, { walletId }));
const age = (data: SourceDocument) => ageOfMoney(data, 'IDR', cutoff);

describe('age of money', () => {
  it('needs ten eligible purchases, uses their latest ten and respects the cutoff day', () => {
    const data = source([row('salary', 'income', 20, '2026-01-01'),
      row('old', 'expense', 1, '2026-01-02'), ...purchases(10, '2026-02-01'),
      row('future', 'expense', 1, '2026-03-01')].reverse());
    expect(age(data)).toBe(31);
    expect(ageOfMoney(data, 'IDR', '2026-01-31')).toBeNull();
    expect(ageOfMoney(data, 'USD', cutoff)).toBeNull();
  });

  it('weights the FIFO lots by amount for each purchase, then gives each purchase equal weight', () => {
    // Nine purchases use lots aged 8 and 2 days. The much larger tenth uses lots aged 10 and 4 days.
    const data = source([]);
    for (let i = 0; i < 10; i++) {
      const base = Date.UTC(2024, 0, 1) + i * 10 * 86400000;
      const day = (offset: number) => new Date(base + offset * 86400000).toISOString().slice(0, 10);
      const amount = i === 9 ? 300 : 2;
      data.state.entries.push(row('old-' + i, 'income', amount, day(0)), row('refund-' + i, 'income', amount, day(6)),
        row('buy-' + i, 'expense', amount, day(i === 9 ? 10 : 8), { fee: amount }));
    }
    expect(age(data)).toBe(5);
    data.state.entries.pop();
    expect(age(data)).toBeNull(); // Fees on a purchase do not become a second sample.
  });

  it('skips an entire expense when even part is from an undated opening balance', () => {
    const data = source([row('salary', 'income', 100, '2026-01-01'), row('mixed', 'expense', 11, '2026-01-02'),
      ...purchases(9, '2026-02-01')], 10);
    expect(age(data)).toBeNull();
    data.state.entries.push(row('tenth', 'expense', 1, '2026-02-01'));
    expect(age(data)).toBe(31);
  });

  it('does not learn ages from cash, movements, unresolved rows, adjustments or an internal transfer principal', () => {
    const data = source([row('salary', 'income', 100, '2026-01-05'), row('large', 'transfer', 100, '2026-01-06', { toWalletId:'other', toAmount:100 }),
      ...(['unreviewed', 'movement', 'adjustment'] as const).map(type => row(type, type, -300, '2026-01-06')),
      row('cash', 'expense', 100, '2026-01-06', { walletId:'cash' }), ...purchases(9, '2026-01-15'),
      row('fee', 'transfer', 100, '2026-01-15', { toWalletId:'other', toAmount:100, fee:1 })]);
    expect(age(data)).toBe(10);
  });

  it('spends FX principal without adding a purchase and ages the received currency from its own posting day', () => {
    const data = source([row('old', 'income', 50, '2026-01-01'), row('new', 'income', 50, '2026-01-07'),
      row('fx', 'transfer', 50, '2026-01-31', { toWalletId:'usd', toAmount:100 }),
      ...purchases(10, '2026-01-10'), ...purchases(10, '2026-01-14', 2, 'usd').map(e => ({...e, id: 'usd-' + e.id}))]);
    data.metadata = { policy: SOURCE_POLICY, facts: [], links: [], statements: [], transfers: [
      { entryId:'fx', sourceDate:'2026-01-08', destinationDate:'2026-01-12' },
    ] };
    expect(age(data)).toBe(3);
    expect(ageOfMoney(data, 'USD', cutoff)).toBe(2);
    data.metadata.transfers![0].sourceDate = null;
    expect(age(data)).toBeNull();
    expect(ageOfMoney(data, 'USD', cutoff)).toBe(2);
  });

  it('uses receipts before debits on a shared day and a stable ID tie-break for the latest ten', () => {
    const debits = purchases(11, '2026-02-01');
    debits[0].amount = 10;
    const data = source([row('yesterday', 'income', 10, '2026-01-01'),
      row('today', 'income', 10, '2026-02-01'), ...debits]);
    // The first purchase by ID consumes all old units and falls outside the last ten.
    // Reordering stored entries cannot move an old unit into the sample.
    expect(age(data)).toBe(0);
    data.state.entries.reverse();
    expect(age(data)).toBe(0);
    // At the ten-purchase boundary that first, 31-day-old unit is still counted.
    data.state.entries = data.state.entries.filter(entry => entry.id !== 'buy-9');
    expect(age(data)).toBe(3);
  });

  it('repays an unfunded debit before using later receipts as dated money', () => {
    const data = source([row('deficit', 'expense', 100, '2026-01-01'), row('partial', 'income', 99, '2026-01-02'),
      ...purchases(10, '2026-01-10')]);
    expect(age(data)).toBeNull();
  });

  it('keeps exact minor units above the safe integer limit across lots and excludes unsafe inputs', () => {
    const max = Number.MAX_SAFE_INTEGER;
    const data = source([row('first', 'income', max, '2026-01-01'), row('second', 'income', max, '2026-01-03'),
      row('use-first', 'expense', max, '2026-01-04'), ...purchases(10, '2026-01-10')]);
    expect(age(data)).toBe(7);
    data.state.entries[0].amount = max + 1;
    expect(() => age(data)).toThrow(RangeError);
  });
});
