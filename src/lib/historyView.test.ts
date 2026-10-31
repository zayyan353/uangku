import { describe, expect, it } from 'vitest';
import { createHistoryIndex, HISTORY_PAGE_SIZE, historyPostingInfo, monthLabel, paginateHistory, queryHistory, type HistoryQuery } from './historyView';
import type { Entry, State } from './finance';

const entry = (id: string, date: string, extra: Partial<Entry> = {}): Entry => ({ id, date, walletId: 'try', type: 'expense', amount: 500, category: 'Belanja', note: 'Kopi', ...extra });
const makeState = (entries: Entry[]): State => ({ version: 1, wallets: [
  { id: 'try', name: 'Dompet Lira', currency: 'TRY', kind: 'cash', openingBalance: 0 },
  { id: 'idr', name: 'Bank Rupiah', currency: 'IDR', kind: 'bank', openingBalance: 0 },
], entries });
const query = (extra: Partial<HistoryQuery> = {}): HistoryQuery => ({ currency: 'TRY', month: '2026-10', period: 'month', query: '', type: 'all', ...extra });

describe('read-only transaction history', () => {
  it('uses selected-wallet dates for same-currency split-month filtering and ordering', () => {
    const state = makeState([entry('split', '2026-10-31', { type: 'transfer', toWalletId: 'second', toAmount: 500, category: '' }), entry('ordinary', '2026-10-30')]);
    state.wallets.push({ id: 'second', name: 'Second TRY', currency: 'TRY', kind: 'bank', openingBalance: 0 });
    const context = { transfers: [{ entryId: 'split', sourceDate: '2026-10-31', destinationDate: '2026-11-02' }] };
    const index = createHistoryIndex(state, context);
    expect(queryHistory(index, query({ walletId: 'second', month: '2026-10' }))).toEqual([]);
    expect(queryHistory(index, query({ walletId: 'second', month: '2026-11' })).map(row => row.id)).toEqual(['split']);
    expect(queryHistory(index, query({ walletId: 'try', month: '2026-10' })).map(row => row.id)).toEqual(['split', 'ordinary']);
    const unknown = createHistoryIndex(state, { transfers: [{ ...context.transfers[0], destinationDate: null }] });
    expect(queryHistory(unknown, query({ walletId: 'second', month: '2026-09' })).map(row => row.id)).toEqual(['split']);
    expect(queryHistory(unknown, query({ walletId: 'try', month: '2026-09' }))).toEqual([]);
  });

  it('reads one exact wallet including transfer legs, while archived review rows stay excluded', () => {
    const state = makeState([
      entry('a', '2026-10-01', { category: '', walletId: 'try' }),
      entry('b', '2026-10-01', { category: '', walletId: 'idr' }),
      entry('paired', '2026-10-01', { type: 'transfer', walletId: 'idr', toWalletId: 'try', toAmount: 500, category: '' }),
    ]);
    const before = JSON.stringify(state), index = createHistoryIndex(state);
    expect(new Set(queryHistory(index, query({ walletId: 'try', period: 'all' })).map(row => row.id))).toEqual(new Set(['a', 'paired']));
    expect(queryHistory(index, query({ type: 'pending', reviewQueue: true, reviewExcludedWalletIds: new Set(['try']) })).map(row => row.id)).toEqual(['b']);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('filters independent review reasons without losing the union or changing the ledger', () => {
    const state = makeState([
      entry('type-only', '2025-01-01', { type: 'unreviewed', amount: -500, category: 'Pilihan manual', walletId: 'idr' }),
      entry('category-only', '2026-10-01', { category: 'Belum dikategorikan' }),
      entry('both', '2025-01-02', { type: 'unreviewed', amount: 100, category: '' }),
      entry('done', '2026-10-01'),
    ]);
    const before = JSON.stringify(state), index = createHistoryIndex(state);
    const selected = (reviewReason: 'all' | 'type' | 'category') => queryHistory(index, query({ type: 'pending', reviewQueue: true, reviewReason })).map(row => row.id);
    expect(new Set(selected('all'))).toEqual(new Set(['type-only', 'category-only', 'both']));
    expect(new Set(selected('type'))).toEqual(new Set(['type-only', 'both']));
    expect(new Set(selected('category'))).toEqual(new Set(['category-only', 'both']));
    expect(JSON.stringify(state)).toBe(before);
  });

  it('finds matching notes in all periods while month remains an explicit restriction', () => {
    const index = createHistoryIndex(makeState([entry('old', '2025-01-03'), entry('current', '2026-10-04')]));
    expect(queryHistory(index, query({ query: 'kopi', period: 'all' })).map(e => e.id)).toEqual(['current', 'old']);
    expect(queryHistory(index, query({ query: 'kopi' })).map(e => e.id)).toEqual(['current']);
  });
  it('includes both currencies of a transfer and searches both wallet names', () => {
    const index = createHistoryIndex(makeState([entry('fx', '2026-10-04', { type: 'transfer', toWalletId: 'idr', toAmount: 250000, category: '' })]));
    expect(queryHistory(index, query({ currency: 'IDR', query: 'DOMPET LIRA' })).map(e => e.id)).toEqual(['fx']);
    expect(queryHistory(index, query({ query: 'bank rupiah' })).map(e => e.id)).toEqual(['fx']);
  });
  it('keeps review queue across dates and currencies without converting unreviewed flows', () => {
    const state = makeState([entry('pending', '2025-01-01', { walletId: 'idr', type: 'unreviewed', amount: -500 }), entry('done', '2026-10-01')]);
    const found = queryHistory(createHistoryIndex(state), query({ type: 'pending', reviewQueue: true }));
    expect(found.map(e => e.id)).toEqual(['pending']);
    expect(found[0].type).toBe('unreviewed'); expect(found[0].amount).toBe(-500);
  });
  it('sorts equal dates in reverse insertion order with stable IDs, without indexOf scans', () => {
    const state = makeState([entry('first', '2026-10-01'), entry('second', '2026-10-01'), entry('newest', '2026-10-02')]);
    expect(queryHistory(createHistoryIndex(state), query()).map(e => e.id)).toEqual(['newest', 'second', 'first']);
  });
  it('does not mutate frozen financial data during indexing/filtering/paging', () => {
    const state = makeState([entry('a', '2026-10-01'), entry('b', '2025-01-01')]);
    const before = JSON.stringify(state);
    Object.freeze(state.entries); state.entries.forEach(Object.freeze); state.wallets.forEach(Object.freeze); Object.freeze(state.wallets); Object.freeze(state);
    const index = createHistoryIndex(state);
    for (const period of ['all', 'month'] as const) for (const type of ['all', 'expense', 'pending']) paginateHistory(queryHistory(index, query({ period, type, query: 'kopi' })), 1);
    expect(JSON.stringify(state)).toBe(before);
  });
  it('bounds a 10000 row ledger to fifty visible rows, including last and stale pages', () => {
    const entries = Array.from({ length: 10003 }, (_, i) => entry(String(i), '2026-10-01'));
    const first = paginateHistory(entries, 1), last = paginateHistory(entries, 9999);
    expect(HISTORY_PAGE_SIZE).toBe(50); expect(first.entries).toHaveLength(50); expect(first.pageCount).toBe(201);
    expect(last.page).toBe(201); expect(last.entries).toHaveLength(3); expect(last.start).toBe(10001); expect(last.end).toBe(10003);
    expect(paginateHistory([], 100).start).toBe(0); expect(paginateHistory([], 100).page).toBe(1);
    expect(paginateHistory(entries, NaN).page).toBe(1); expect(() => paginateHistory(entries, 1, 10000)).toThrow();
  });
  it('labels selected year as well as month, preserving invalid input', () => {
    expect(monthLabel('2025-12')).toBe('Desember 2025'); expect(monthLabel('2026-01')).toBe('Januari 2026'); expect(monthLabel('2026-13')).toBe('2026-13');
  });
  it('filters a cross-currency transfer using each wallet posting month', () => {
    const state = makeState([entry('fx', '2026-10-01', { type: 'transfer', toWalletId: 'idr', toAmount: 250000, category: '' })]);
    const context = { transfers: [{ entryId: 'fx', sourceDate: '2026-09-30', destinationDate: '2026-10-02' }] };
    const index = createHistoryIndex(state, context);
    expect(queryHistory(index, query({ currency: 'TRY', month: '2026-09' })).map(e => e.id)).toEqual(['fx']);
    expect(queryHistory(index, query({ currency: 'TRY', month: '2026-10' }))).toEqual([]);
    expect(queryHistory(index, query({ currency: 'IDR', month: '2026-10' })).map(e => e.id)).toEqual(['fx']);
    expect(queryHistory(index, query({ currency: 'IDR', month: '2026-09' }))).toEqual([]);
  });
  it('sorts by latest relevant currency leg and keeps each transfer group once', () => {
    const state = makeState([
      entry('fx', '2026-01-01', { type: 'transfer', toWalletId: 'idr', toAmount: 250000, category: '' }),
      entry('cash', '2026-10-10'),
      entry('bank', '2026-10-10', { walletId: 'idr' }),
    ]);
    const index = createHistoryIndex(state, { transfers: [{ entryId: 'fx', sourceDate: '2026-09-30', destinationDate: '2026-12-02' }] });
    expect(queryHistory(index, query({ period: 'all' })).map(e => e.id)).toEqual(['cash', 'fx']);
    expect(queryHistory(index, query({ period: 'all', currency: 'IDR' })).map(e => e.id)).toEqual(['fx', 'bank']);
  });
  it('keeps unknown-date legs visible and exposes their unknown status without guessing dates', () => {
    const state = makeState([entry('unknown', '2020-01-01', { type: 'transfer', toWalletId: 'idr', toAmount: 250000, category: '' })]);
    const index = createHistoryIndex(state, { transfers: [{ entryId: 'unknown', sourceDate: '2026-09-30', destinationDate: null }] });
    expect(queryHistory(index, query({ currency: 'IDR', month: '2026-10' })).map(e => e.id)).toEqual(['unknown']);
    expect(historyPostingInfo(index, 'unknown', 'IDR')).toEqual({ dates: [], undated: true });
    expect(historyPostingInfo(index, 'unknown', 'TRY')).toEqual({ dates: ['2026-09-30'], undated: false });
    expect(historyPostingInfo(index, 'unknown')).toEqual({ dates: ['2026-09-30'], undated: true });
    expect(state.entries[0].date).toBe('2020-01-01');
  });
  it('a same-currency group spans both posting months without duplicate rows', () => {
    const state = makeState([entry('between', '2026-10-02', { type: 'transfer', toWalletId: 'second', toAmount: 500, category: '' })]);
    state.wallets.push({ id: 'second', name: 'Second lira', currency: 'TRY', kind: 'bank', openingBalance: 0 });
    const index = createHistoryIndex(state, { transfers: [{ entryId: 'between', sourceDate: '2026-09-30', destinationDate: '2026-10-02' }] });
    expect(queryHistory(index, query({ month: '2026-09' })).map(e => e.id)).toEqual(['between']);
    expect(queryHistory(index, query({ month: '2026-10' })).map(e => e.id)).toEqual(['between']);
    expect(queryHistory(index, query({ period: 'all' }))).toHaveLength(1);
  });
});
