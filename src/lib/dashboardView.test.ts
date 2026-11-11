import { describe, expect, it } from 'vitest';
import { categoryColorIndex, monthlyCategoryTotals } from './dashboardView';
import type { State } from './finance';
const state: State = { version: 1, wallets: [{ id: 'a', name: 'A', currency: 'TRY', kind: 'bank', openingBalance: 0 }, { id: 'b', name: 'B', currency: 'USD', kind: 'bank', openingBalance: 0 }], entries: [{ id: 'transfer', type: 'transfer', date: '2026-11-01', walletId: 'a', toWalletId: 'b', amount: 1000, toAmount: 100, rate: .1, fee: 50, category: '', note: '' }] };
describe('monthly category projection', () => {
  it('assigns fees to the debit date and never counts transfer principal as spending', () => {
    const context = { transfers: [{ entryId: 'transfer', sourceDate: '2026-10-31', destinationDate: '2026-11-01' }] };
    const before = JSON.stringify(state);
    expect(monthlyCategoryTotals(state, 'TRY', '2026-10', context)).toEqual([['Biaya transfer', 50]]);
    expect(monthlyCategoryTotals(state, 'TRY', '2026-11', context)).toEqual([]);
    expect(monthlyCategoryTotals(state, 'USD', '2026-11', context)).toEqual([]);
    expect(JSON.stringify(state)).toBe(before);
  });
  it('does not invent a category month for an undated debit', () => {
    expect(monthlyCategoryTotals(state, 'TRY', '2026-11', { transfers: [{ entryId: 'transfer', sourceDate: null, destinationDate: '2026-11-01' }] })).toEqual([]);
  });
});

describe('categoryColorIndex', () => {
  const names = ['Makan & minum', 'Transportasi', 'Belanja', 'Tagihan'];
  it('follows the settings order, whatever the spending rank', () => {
    expect(names.map(name => categoryColorIndex(name, names, 8))).toEqual([0, 1, 2, 3]);
    expect(categoryColorIndex('Belanja', names, 8)).toBe(categoryColorIndex('Belanja', [...names, 'Hiburan'], 8));
  });
  it('wraps within the palette', () => {
    expect(categoryColorIndex('Tagihan', names, 3)).toBe(0);
  });
  it('gives an unlisted name a stable slot inside the palette', () => {
    const slot = categoryColorIndex('Biaya transfer', names, 8);
    expect(slot).toBe(categoryColorIndex('Biaya transfer', [], 8));
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slot).toBeLessThan(8);
  });
});
