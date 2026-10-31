import { describe, expect, it } from 'vitest';
import { bankTypeConfirmation, categorySuggestion, entryCategorySuggestions } from './categorySuggestions';
import { defaultCategorySettings, UNCATEGORIZED } from './categorySettings';
import type { Entry } from './finance';
import type { SourceDocument } from './sourceModel';
import { serializeBackup } from './storage';

const entry = (id: string, patch: Partial<Entry> = {}): Entry => ({ id, type: 'expense', date: '2026-10-01',
  walletId: 'cash', amount: 1000, category: UNCATEGORIZED, note: 'POS MIGROS', ...patch });
const document = (entries: Entry[]): SourceDocument => ({ app: 'uangku', version: 1, demo: false, state: {
  version: 1, wallets: [{ id: 'cash', name: 'Synthetic bank', currency: 'TRY', kind: 'bank', openingBalance: 10000 }], entries,
} });

function sourced(description = 'POS MİGROS'): SourceDocument {
  const fingerprint = 'ziraat:0000000000000001';
  const data = document([entry('sourced', { sourceKey: fingerprint, note: 'Edited memo: NETFLIX' })]);
  data.metadata = { policy: 'unverified-unless-linked',
    facts: [{ id: 'fact', walletId: 'cash', currency: 'TRY', postedOn: '2026-10-01', signedAmount: -1000,
      balanceAfter: 9000, description, fingerprintVersion: 'ziraat-v1', fingerprint }],
    links: [{ entryId: 'sourced', source: 'fact' }],
    statements: [{ id: 'statement', walletId: 'cash', currency: 'TRY', periodStart: '2026-10-01', periodEnd: '2026-10-01',
      openingBalance: 10000, closingBalance: 9000, rowIds: ['fact'] }],
    annotations: [{ sourceId: 'fact', note: 'Edited memo: NETFLIX', category: UNCATEGORIZED, confirmedType: 'expense' }],
  };
  return data;
}

describe('category suggestion safety boundaries', () => {
  it.each(['transfer', 'adjustment'] as const)('skips %s even when a merchant rule matches', type => {
    expect(categorySuggestion('POS MIGROS', type, defaultCategorySettings())).toEqual({ kind: 'none', suggestions: [] });
    expect(entryCategorySuggestions(document([entry('excluded', { type })]), defaultCategorySettings())).toEqual([]);
  });

  it('downgrades unreviewed bank movements without confirming income or expense', () => {
    const data = document([entry('out', { type: 'unreviewed', amount: -1000 }), entry('in', { type: 'unreviewed', amount: 1000 })]);
    const before = JSON.stringify(data), results = entryCategorySuggestions(data, defaultCategorySettings());
    expect(results).toHaveLength(2);
    expect(results.every(item => item.match.kind === 'suggestions')).toBe(true);
    expect(data.state.entries.map(item => [item.type, item.amount])).toEqual([['unreviewed', -1000], ['unreviewed', 1000]]);
    expect(JSON.stringify(data)).toBe(before);
  });

  it('keeps confirmed ordinary matches automatic and ambiguous descriptions suggestions', () => {
    expect(categorySuggestion('POS MIGROS', 'expense', defaultCategorySettings()).kind).toBe('auto');
    expect(categorySuggestion('REFUND MIGROS', 'income', defaultCategorySettings()).kind).toBe('suggestions');
    expect(categorySuggestion('UNKNOWN MERCHANT', 'expense', defaultCategorySettings()).kind).toBe('none');
  });

  it('preserves manually assigned active and archived categories', () => {
    const data = document([entry('manual', { category: 'Makan & minum' }), entry('archived', { category: 'Historical custom category' }), entry('eligible')]);
    const before = structuredClone(data);
    expect(entryCategorySuggestions(data, defaultCategorySettings()).map(item => item.entry.id)).toEqual(['eligible']);
    expect(data).toEqual(before);
  });

  it('skips archived cash records even when a merchant or approved bank operation matches', () => {
    const data = document([entry('active'), entry('cash-purchase', { walletId: 'archived-cash' }),
      entry('cash-bankword', { walletId: 'archived-cash', type: 'unreviewed', amount: -1000, note: 'ATM PARA CEKME' })]);
    data.state.wallets.push({ id: 'archived-cash', name: 'Synthetic archived cash', kind: 'cash', currency: 'TRY', openingBalance: 10000 });
    const before = serializeBackup(data);
    expect(entryCategorySuggestions(data, defaultCategorySettings()).map(row => row.entry.id)).toEqual(['active']);
    expect(serializeBackup(data)).toBe(before);
  });

  it('proposes explicit bank type confirmation while retaining an existing manual category', () => {
    const data = document([entry('old-atm', { type: 'unreviewed', amount: -1000, category: 'Pilihan manual', note: 'ATM PARA CEKME' })]);
    const before = serializeBackup(data), rows = entryCategorySuggestions(data, defaultCategorySettings());
    expect(rows).toHaveLength(1); expect(rows[0].confirmation).toBe('expense');
    expect(rows[0].match.suggestions[0].category).toBe('Pilihan manual');
    expect(data.state.entries[0].type).toBe('unreviewed'); expect(serializeBackup(data)).toBe(before);
  });

  it('uses signed context to suggest Cashback income only for positive barePREPAID credits', () => {
    const data = document([entry('credit', { type: 'unreviewed', amount: 1000, note: 'PREPAID CARD' }),
      entry('debit', { type: 'unreviewed', amount: -1000, note: 'PREPAID CARD' })]);
    const before = serializeBackup(data), rows = entryCategorySuggestions(data, defaultCategorySettings());
    expect(rows.map(row => row.entry.id)).toEqual(['credit']);
    expect(rows[0].confirmation).toBe('income'); expect(rows[0].match.suggestions[0].category).toBe('Cashback');
    expect(serializeBackup(data)).toBe(before);
  });

  it('includes a reviewed ATM policy conversion for old movements while retaining their existing manual categories', () => {
    const data = document([entry('old-withdraw', { type: 'movement', amount: -1000, category: 'ATM manual', note: 'ATM PARA CEKME' }),
      entry('old-deposit', { type: 'movement', amount: 1000, category: 'Setoran manual', note: 'ATM YATAN' }),
      entry('old-transfer', { type: 'movement', amount: -1000, category: 'Transfer manual', note: 'GIDEN HAVALE' })]);
    const before = serializeBackup(data), rows = entryCategorySuggestions(data, defaultCategorySettings());
    expect(rows.map(row => [row.entry.id, row.confirmation, row.match.suggestions[0].category])).toEqual([
      ['old-withdraw', 'expense', 'ATM manual'], ['old-deposit', 'income', 'Setoran manual'],
    ]);
    expect(serializeBackup(data)).toBe(before);
  });

  it.each([
    ['unreviewed', 'ATM PARA CEKME', -100, 'expense'], ['unreviewed', 'ATM YATAN', 100, 'income'],
    ['movement', 'ATM PARA CEKME', -100, 'expense'], ['movement', 'ATM YATAN', 100, 'income'],
    ['movement', 'GIDEN HAVALE', -100, undefined], ['movement', 'UNKNOWN', -100, undefined],
    ['movement', 'PREPAID CREDIT', 100, undefined], ['movement', 'GIDEN HAVALE KOMISYON TAHSILATI', -100, undefined],
    ['movement', 'ATM PARA CEKME', 100, undefined], ['movement', 'ATM YATAN', -100, undefined],
    ['expense', 'ATM PARA CEKME', 100, undefined], ['income', 'ATM YATAN', 100, undefined],
  ] as const)('recomputes confirmation eligibility for%s/%s with signed input%s', (type, note, amount, expected) => {
    const original = entry('candidate', { type, note, amount }), before = JSON.stringify(original);
    expect(bankTypeConfirmation(original, note)).toBe(expected);
    expect(JSON.stringify(original)).toBe(before);
  });

  it('uses linked immutable source description instead of edited notes', () => {
    const data = sourced(), result = entryCategorySuggestions(data, defaultCategorySettings());
    expect(result).toHaveLength(1);
    expect(result[0].match.kind).toBe('auto');
    expect(result[0].match.suggestions[0].category).toBe('Bahan makanan');
    expect(result[0].match.suggestions.some(item => item.category === 'Langganan')).toBe(false);
  });

  it('does not fall through a nonmatching source description to a matching edited note', () => {
    expect(entryCategorySuggestions(sourced('UNKNOWN ORIGINAL MERCHANT'), defaultCategorySettings())).toEqual([]);
  });
  it('does not infer a bank operation from an edited note when an existing source description is blank', () => {
    const data = sourced('');
    data.state.entries[0].note = 'ATM PARA CEKME';
    expect(entryCategorySuggestions(data, defaultCategorySettings())).toEqual([]);
  });

  it('uses notes for v1 legacy records without source facts', () => {
    const data = document([entry('legacy', { sourceKey: 'ziraat:0000000000000001', note: 'POS MIGROS' }),
      entry('manual', { note: 'NETFLIX' }), entry('unmatched', { note: 'Unknown store' })]);
    const results = entryCategorySuggestions(data, defaultCategorySettings());
    expect(results.map(item => [item.entry.id, item.match.suggestions[0].category])).toEqual([
      ['legacy', 'Bahan makanan'], ['manual', 'Langganan'],
    ]);
  });

  it('respects archived targets and rule conflicts without changing eligibility', () => {
    const data = document([entry('eligible')]), settings = defaultCategorySettings();
    settings.names = settings.names.filter(name => name !== 'Bahan makanan');
    expect(entryCategorySuggestions(data, settings)).toEqual([]);
    settings.names.push('Bahan makanan');
    settings.rules.push({ id: 'conflict', keyword: 'MIGROS', category: 'Belanja', mode: 'suggest' });
    const results = entryCategorySuggestions(data, settings);
    expect(results[0].match.kind).toBe('suggestions');
    expect(new Set(results[0].match.suggestions.map(item => item.category))).toEqual(new Set(['Bahan makanan', 'Belanja']));
  });

  it('leaves v1 financial export bytes identical after building suggestions', () => {
    const data = document([entry('ordinary'), entry('pending', { type: 'unreviewed', amount: -1000 })]);
    const before = serializeBackup(data);
    entryCategorySuggestions(data, defaultCategorySettings());
    expect(serializeBackup(data)).toBe(before);
  });

  it('leaves v2 source facts, annotations, postings and export bytes identical', () => {
    const data = sourced(), before = serializeBackup(data), copy = structuredClone(data);
    expect(JSON.parse(before).version).toBe(2);
    const settings = defaultCategorySettings(), settingsBefore = JSON.stringify(settings);
    entryCategorySuggestions(data, settings);
    expect(data).toEqual(copy);
    expect(JSON.stringify(settings)).toBe(settingsBefore);
    expect(serializeBackup(data)).toBe(before);
  });
});
