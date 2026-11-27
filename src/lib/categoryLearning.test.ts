import { describe, expect, it } from 'vitest';
import { defaultCategorySettings, UNCATEGORIZED } from './categorySettings';
import { entryCategorySuggestions } from './categorySuggestions';
import { type Entry } from './finance';
import { type SourceDocument } from './sourceModel';

const merchant = 'Warung Contoh';
const food = 'Makan & minum';
const shopping = 'Belanja';
const settings = defaultCategorySettings();
const target: Entry = { id: 'target', type: 'expense', date: '2026-07-01', walletId: 'active',
  amount: 1200, category: UNCATEGORIZED, note: merchant };
function past(id: string, category = food, patch: Partial<Entry> = {}): Entry {
  return { ...target, id, category, date: '2026-06-30', ...patch };
}
function document(entries: Entry[]): SourceDocument {
  return { app: 'uangku', version: 1, demo: false, state: { version: 1, entries, wallets: [
    { id: 'active', kind: 'bank', currency: 'IDR', name: 'Aktif', openingBalance: 0 },
    { id: 'cash', kind: 'cash', currency: 'IDR', name: 'Kas', openingBalance: 0 },
  ] } };
}
describe('category suggestions learned from transaction history', () => {
  it('takes at most five recent confirmed categories for the same merchant, as a suggestion only', () => {
    const history = [food, shopping, food, shopping, food, shopping, shopping, shopping].map((category, i) =>
      past(String(i), category, { date: '2026-06-' + (30 - i), note: merchant + ' #F-00000' + i }));
    const data = document([history[7], history[4], target, history[1], history[0], history[6], history[2], history[5], history[3]]);
    const before = structuredClone(data);
    const rows = entryCategorySuggestions(data, settings);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entry: target, historyMerchant: 'warung contoh', match: {
      kind: 'suggestions', suggestions: [{ category: food, reason: '3 dari 5 transaksi terakhir “warung contoh” memakai Makan & minum.' }],
    } });
    expect(data).toEqual(before);
  });

  it('includes exactly 180 days ago and disregards transactions after the target date', () => {
    const dates = ['2026-01-02', '2026-01-02', '2026-07-01'];
    const entries = dates.map((date, i) => past(String(i), food, { date, type: 'income' }));
    entries.push(past('old', shopping, { date: '2026-01-01' }), past('future', shopping, { date: '2026-07-02' }));
    const rows = entryCategorySuggestions(document([target, ...entries]), settings);
    expect(rows[0]?.match.suggestions[0]?.reason).toContain('3 dari 3');
    entries[0].date = '2026-01-01';
    expect(entryCategorySuggestions(document([target, ...entries]), settings)).toEqual([]);
  });

  it('excludes cash, archived wallets, transfer, adjustment, unreviewed and movement as evidence', () => {
    const omitted = ['transfer', 'adjustment', 'unreviewed', 'movement'].map(type => past(type, food, { type: type as Entry['type'] }));
    const data = document([target, past('a'), past('b'), ...omitted,
      past('cash', food, { walletId: 'cash' }), past('archived', food, { walletId: 'archived' }),
      past('other', food, { note: 'Warung Lain' })]);
    data.state.wallets.push({ ...data.state.wallets[0], id: 'archived' });
    data.metadata = { policy: 'unverified-unless-linked', facts: [], links: [], statements: [], annotations: [],
      walletArchives: [{ walletId: 'archived', at: '2026-07-01T00:00:00Z' }] };
    expect(entryCategorySuggestions(data, settings)).toEqual([]);
  });

  it('does not propose removed categories or group blank merchant names', () => {
    const rows = [target, ...['a', 'b', 'c'].map(id => past(id, 'Nama lama'))];
    expect(entryCategorySuggestions(document(rows), settings)).toEqual([]);
    expect(entryCategorySuggestions(document(rows.map(e => ({ ...e, note: '#F-000001', category: e === target ? UNCATEGORIZED : food }))), settings)).toEqual([]);
  });

  it('gives existing rules and bank confirmation priority', () => {
    for (const note of ['MIGROS', 'GIDEN HAVALE']) {
      const data = document([{ ...target, note, type: 'unreviewed', amount: -1200 }, ...['a', 'b', 'c'].map(id => past(id, food, { note }))]);
      const [row] = entryCategorySuggestions(data, settings);
      expect(row).toBeDefined();
      expect(row).not.toHaveProperty('historyMerchant');
      expect(row.match.suggestions.some(suggestion => suggestion.category === food)).toBe(false);
    }
  });
});
