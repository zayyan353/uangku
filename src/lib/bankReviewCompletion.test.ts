import { describe, expect, it } from 'vitest';
import { interpretBankDescription, confirmedBankEntryType } from './bankDescription';
import { defaultCategorySettings, validateCategorySettings, type CategorySettings } from './categorySettings';
import { categorySuggestion, entryCategorySuggestions } from './categorySuggestions';
import { upgradeCategorySettings } from './categorySettingsUpgrade';
import { BANK_REVIEW_COMPLETION_RULES } from './categoryBankMappings';
import { applyBankDecisions } from './bankDecisions';
import { entrySignedAmount, walletBalance } from './finance';
import { SOURCE_POLICY, type SourceDocument } from './sourceModel';
import { serializeBackup, parseBackupText } from './storage';

const refund = 'FACR00-0000ATMS26000000 re nolu tam atm sorunlu işlem iadesi';
const pos = 'POS ALIŞVERİŞ (YURTİÇİ) KART NO: 0000 **** **** 0000 İŞYERİ: SENTETIK KISI MUTABAKAT: 123';
const settings = () => defaultCategorySettings();
const match = (text: string, amount: number, value = settings()) => categorySuggestion(text, amount < 0 ? 'expense' : 'unreviewed', value, amount);
function v4(): CategorySettings {
  const value = settings();
  return { ...value, keywordPackVersion: 4, rules: value.rules.filter(rule => !rule.id.startsWith('bank-v5-')) };
}
function document(description = refund): SourceDocument {
  return { app: 'uangku', version: 1, demo: false, state: { version: 1,
    wallets: [{ id: 'bank', name: 'Synthetic bank', currency: 'TRY', kind: 'bank', openingBalance: 10000 }],
    entries: [{ id: 'refund', type: 'unreviewed', amount: 1000, date: '2026-08-27', walletId: 'bank', category: 'Belum dikategorikan', note: 'Personal memo kept' }] },
    metadata: { policy: SOURCE_POLICY,
      facts: [{ id: 'fact', walletId: 'bank', currency: 'TRY', postedOn: '2026-08-27', signedAmount: 1000, balanceAfter: 11000, description,
        fingerprintVersion: 'ziraat-v1', fingerprint: 'ziraat:0000000000000001' }],
      links: [{ entryId: 'refund', source: 'fact' }], statements: [{ id: 'statement', walletId: 'bank', currency: 'TRY', periodStart: '2026-08-27', periodEnd: '2026-08-27', openingBalance: 10000, closingBalance: 11000, rowIds: ['fact'] }] } };
}

describe('explicit failed ATM operation refund', () => {
  it.each([refund, 'TAM ATM SORUNLU ISLEM IADESI', 'ref 123 tam   atm sorunlu işlem iadesi'])('confirms only the positive bank operation: %s', text => {
    expect(interpretBankDescription(text, { signedAmount: 1000 })).toMatchObject({ kind: 'atm-refund', category: 'Pengembalian dana', pending: false });
    expect(confirmedBankEntryType(text, 1000)).toBe('income');
    expect(match(text, 1000)).toMatchObject({ kind: 'auto', suggestions: [{ category: 'Pengembalian dana' }] });
  });
  it.each([undefined, 0, -1000, NaN, Infinity, 1.5])('does not confirm absent or invalid credit direction %s', amount => {
    expect(interpretBankDescription(refund, { signedAmount: amount }).pending).toBe(true);
    expect(confirmedBankEntryType(refund, amount as number)).toBeUndefined();
  });
  it.each(['HAVALE', 'EFT', 'POS ALISVERIS', 'ATM PARA CEKME', 'ATM YATAN', 'REVERSAL', 'IPTAL'])('does not bypass conflicting operation %s', suffix => {
    expect(confirmedBankEntryType(`${refund} ${suffix}`, 1000)).toBeUndefined();
    expect(match(`${refund} ${suffix}`, 1000).kind).not.toBe('auto');
  });
  it.each(['ATM IADE', 'TAM ATM SORUNLU ISLEM', 'SORUNLU ISLEM IADESI', 'HAVALE IADE', 'ISYERI IADE'])('keeps unsupported partial/general refunds unresolved: %s', text => {
    expect(confirmedBankEntryType(text, 1000)).toBeUndefined();
  });
});

describe('physical card operation fallback with unknown purpose', () => {
  it.each([pos, 'POS HARCAMA ISYERI SENTETIK KISI', 'POS ALISVERIS ISYERI HAVALE FAST FOOD'])('uses a generic card payment without inferring goods/person-transfer: %s', text => {
    expect(interpretBankDescription(text, { signedAmount: -1000 })).toMatchObject({ kind: 'card-purchase', category: 'Belanja', pending: false });
    expect(confirmedBankEntryType(text, -1000)).toBe('expense');
    expect(match(text, -1000)).toMatchObject({ kind: 'auto', suggestions: [{ category: 'Belanja' }] });
  });
  it.each([1000, 0, NaN])('never turns contradictory POS credit/zero into purchase or movement %s', amount => {
    expect(confirmedBankEntryType(pos, amount)).toBeUndefined();
    expect(match(pos, amount).kind).not.toBe('auto');
  });
  it.each(['IADE', 'REVERSAL', 'IPTAL', 'ATM PARA CEKME', 'ATM YATAN'])('blocks the generic fallback on contradiction %s', suffix => {
    expect(confirmedBankEntryType(`${pos} ${suffix}`, -1000)).toBeUndefined();
    expect(match(`${pos} ${suffix}`, -1000).kind).not.toBe('auto');
  });
  it('keeps merchant and online-specific rules ahead of the generic fallback', () => {
    expect(match('POS ALISVERIS ISYERI BIM', -1000).suggestions.map(row => row.category)).toEqual(['Bahan makanan']);
    expect(match('SANAL POS ALISVERIS ISYERI UNKNOWN', -1000).suggestions.map(row => row.category)).toEqual(['Belanja online']);
    expect(match('SANAL POS ALISVERIS ISYERI TRENDYOL YEMEK', -1000).suggestions.map(row => row.category)).toEqual(['Makan & minum']);
  });
  it('retains personal merchant modes and personal fallback targets', () => {
    const value = settings(); value.names.push('Pribadi');
    value.rules.push({ id: 'my-merchant', keyword: 'SENTETIK KISI', category: 'Pribadi', mode: 'suggest' });
    expect(match(pos, -1000, value)).toMatchObject({ kind: 'suggestions', suggestions: [{ category: 'Pribadi' }] });
    const custom = settings(); custom.names.push('Pribadi');
    custom.rules = custom.rules.map(rule => rule.id === 'bank-v5-card-purchase' ? { ...rule, category: 'Pribadi', mode: 'suggest' } : rule);
    expect(match(pos, -1000, custom)).toMatchObject({ kind: 'suggestions', suggestions: [{ category: 'Pribadi' }] });
  });
  it('does not revive inactive generic or refund categories', () => {
    const value = settings(); value.names = value.names.filter(name => !['Belanja', 'Pengembalian dana'].includes(name));
    expect(match(pos, -1000, value).kind).toBe('none');
    expect(match(refund, 1000, value).kind).toBe('none');
  });
});

describe('v5 non-destructive review completion pack', () => {
  it('adds only three new rules to a v4 catalog, retaining old deleted rules and names', () => {
    const source = v4(); source.rules = source.rules.filter(rule => !['bank-v4-prepaid-credit', 'bank-v3-atm-deposit'].includes(rule.id));
    const before = JSON.stringify(source), result = upgradeCategorySettings(source);
    expect(result.added).toBe(3); expect(result.updated ?? 0).toBe(0); expect(result.settings.keywordPackVersion).toBe(5);
    expect(result.settings.names).toEqual(source.names);
    expect(result.settings.rules.slice(0, source.rules.length)).toEqual(source.rules);
    expect(result.settings.rules.slice(source.rules.length)).toEqual(BANK_REVIEW_COMPLETION_RULES);
    expect(result.settings.rules.some(rule => rule.id === 'bank-v4-prepaid-credit')).toBe(false);
    expect(result.settings.rules.some(rule => rule.id === 'bank-v3-atm-deposit')).toBe(false);
    expect(JSON.stringify(source)).toBe(before);
  });
  it('retains v5 deletions, mode edits and all names on every later reload', () => {
    const source = settings(); source.rules = source.rules.filter(rule => rule.id !== 'bank-v5-atm-problem-refund');
    source.rules.find(rule => rule.id === 'bank-v5-card-purchase')!.mode = 'suggest';
    expect(upgradeCategorySettings(source).settings).toBe(source);
    expect(upgradeCategorySettings(source).added).toBe(0);
  });
  it('respects occupied IDs/keywords and inactive targets during upgrade', () => {
    const source = v4(); source.rules.push({ id: 'my-card', keyword: 'POS ALISVERIS', category: 'Belanja', mode: 'suggest' });
    source.rules.push({ id: 'bank-v5-card-harcama', keyword: 'PERSONAL DIFFERENT', category: 'Belanja', mode: 'suggest' });
    source.names = source.names.filter(name => name !== 'Pengembalian dana');
    const before = JSON.stringify(source.rules), result = upgradeCategorySettings(source);
    expect(result.added).toBe(0); expect(JSON.stringify(result.settings.rules)).toBe(before);
    expect(result.settings.names).toEqual(source.names);
  });
  it('rolls back the entire proposal if the rule limit cannot admit it', () => {
    const source = v4();
    while(source.rules.length < 200) source.rules.push({ id: `personal-${source.rules.length}`, keyword: `PERSONAL ${source.rules.length}`, category: 'Belanja', mode: 'suggest' });
    const before = JSON.stringify(source), result = upgradeCategorySettings(source);
    expect(result.error).toMatch(/200/); expect(result.settings).toBe(source); expect(JSON.stringify(source)).toBe(before);
  });
  it('preserves all historical markers in the strict schema and rejects a future version', () => {
    for(const marker of [1,2,3,4,5] as const) expect(validateCategorySettings({ ...v4(), keywordPackVersion: marker }).keywordPackVersion).toBe(marker);
    expect(() => validateCategorySettings({ ...v4(), keywordPackVersion: 6 })).toThrow();
  });
});

describe('reviewed old-data application preserves facts and money', () => {
  it('proposes a known ATM refund from original source and preserves immutable bank facts/postings/manual note', () => {
    const source = document(), raw = serializeBackup(source);
    const proposal = entryCategorySuggestions(source, settings());
    expect(proposal).toHaveLength(1); expect(proposal[0]).toMatchObject({ confirmation: 'income', match: { kind: 'auto' } });
    const next = applyBankDecisions(source, [{ entryId: 'refund', category: 'Pengembalian dana', confirmBankType: true }]);
    expect(next.state.entries[0]).toMatchObject({ type: 'income', amount: 1000, category: 'Pengembalian dana', note: 'Personal memo kept' });
    expect(next.metadata!.facts).toEqual(source.metadata!.facts); expect(next.metadata!.links).toEqual(source.metadata!.links);
    expect(next.state.entries.map(entrySignedAmount)).toEqual(source.state.entries.map(entrySignedAmount));
    expect(walletBalance(next.state, 'bank')).toBe(11000); expect(next.state.entries).toHaveLength(1);
    expect(serializeBackup(source)).toBe(raw); expect(parseBackupText(serializeBackup(next))).toEqual(next);
  });
  it('retains a manually filled category and never confirms an edited memo over a different source', () => {
    const source = document(); source.state.entries[0].category = 'Kategori pribadi';
    expect(entryCategorySuggestions(source, settings())[0].match.suggestions[0].category).toBe('Kategori pribadi');
    const next = applyBankDecisions(source, [{ entryId: 'refund', category: 'Kategori pribadi', confirmBankType: true }]);
    expect(next.state.entries[0].category).toBe('Kategori pribadi');
    const ambiguous = document('UNKNOWN SOURCE'); ambiguous.state.entries[0].note = refund;
    expect(entryCategorySuggestions(ambiguous, settings())).toHaveLength(0);
    expect(() => applyBankDecisions(ambiguous, [{ entryId: 'refund', category: 'Pengembalian dana', confirmBankType: true }])).toThrow(/dipastikan/);
  });
});
