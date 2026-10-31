import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CATEGORY_RULES, normalizeCategoryKeyword, type CategoryRule } from './categorization';
import { BANK_CATEGORY_NAMES, BANK_CATEGORY_RULES, CURRENT_BANK_CATEGORY_RULES, BANK_REVIEW_COMPLETION_RULES } from './categoryBankMappings';
import { mergeCategoryKeywordPack } from './categoryKeywordPack';
import { mergeConfirmedCategoryMappings, mergeCurrentCategoryKeywordPack } from './categoryConfirmedMappings';
import { CONFIRMED_ADDITIONAL_RULES, CONFIRMED_CATEGORY_NAMES, CONFIRMED_RULE_UPDATES, KEYWORD_EXPANSION_RULES } from './categoryKeywordDefinitions';
import {
  CATEGORY_SETTINGS_LIMIT, DEFAULT_CATEGORY_NAMES, UNCATEGORIZED, categorySettingsExport,
  defaultCategorySettings, parseCategorySettingsExport, validateCategorySettings, type CategorySettings,
} from './categorySettings';
import { upgradeCategorySettings } from './categorySettingsUpgrade';

afterEach(() => vi.unstubAllGlobals());

function historicalV2(): CategorySettings {
  const names = DEFAULT_CATEGORY_NAMES.filter(name => !(BANK_CATEGORY_NAMES as readonly string[]).includes(name));
  const previous = mergeCategoryKeywordPack({ version: 1, names, rules: DEFAULT_CATEGORY_RULES.map(rule => ({ ...rule })) }).settings;
  return { ...mergeConfirmedCategoryMappings({ ...previous, keywordPackVersion: 1 }).settings, keywordPackVersion: 2 };
}
const envelopeBytes = (settings: CategorySettings) => new TextEncoder().encode(JSON.stringify({ app: 'uangku-category-settings', version: 1, settings })).length;

describe('bank category settings version3 upgrade', () => {
  it('creates current defaults with30 categories/81 rules and18 bank annotation rules', () => {
    const current = defaultCategorySettings();
    expect(current.keywordPackVersion).toBe(5);
    expect(current.names).toHaveLength(30); expect(current.rules).toHaveLength(81);
    expect(BANK_CATEGORY_RULES).toHaveLength(14);
    expect(validateCategorySettings(current)).toEqual(current);
    for (const rule of CURRENT_BANK_CATEGORY_RULES) expect(current.rules.find(candidate => candidate.id === rule.id)).toEqual(rule);
    expect(current.rules.every(rule => current.names.includes(rule.category))).toBe(true);
  });

  it('adds only the18 current bank rules and4 labels to a genuine v2 profile, preserving its entire existing array order', () => {
    const source = historicalV2(); expect(source.names).toHaveLength(26); expect(source.rules).toHaveLength(63);
    const before = categorySettingsExport(source), rulesBefore = JSON.stringify(source.rules);
    Object.freeze(source.names); source.rules.forEach(Object.freeze); Object.freeze(source.rules); Object.freeze(source);
    const result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.settings.keywordPackVersion).toBe(5);
    expect(result.added).toBe(18); expect(result.updated ?? 0).toBe(8);
    expect(result.settings.names).toEqual([...source.names, ...BANK_CATEGORY_NAMES]);
    expect(JSON.stringify(result.settings.rules.slice(0, source.rules.length))).toBe(rulesBefore);
    expect(result.settings.rules.slice(source.rules.length)).toEqual([...CURRENT_BANK_CATEGORY_RULES, ...BANK_REVIEW_COMPLETION_RULES]);
    expect(categorySettingsExport(source)).toBe(before);
  });

  it('does not reapply confirmed v2 label changes to a v2 user who manually reverted all seven original rules', () => {
    const source = historicalV2();
    const reverted = new Map(CONFIRMED_RULE_UPDATES.map(update => [update.previous.id, { ...update.previous }]));
    source.rules = source.rules.map(rule => reverted.get(rule.id) ?? rule);
    const before = JSON.stringify(source.rules), result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.updated ?? 0).toBe(8);
    expect(JSON.stringify(result.settings.rules.slice(0, source.rules.length))).toBe(before);
    for (const previous of reverted.values()) expect(result.settings.rules.find(rule => rule.id === previous.id)).toEqual(previous);
  });

  it('does not revive deleted v2 categories or deleted confirmed/older rules while applying the bank pack', () => {
    const source = historicalV2();
    const deletedIds = ['confirmed-apple-domain', 'keyword-pack-hop-scoot', 'keyword-pack-avea-bill', 'subscription-apple'];
    source.rules = source.rules.filter(rule => !deletedIds.includes(rule.id));
    source.names = source.names.filter(name => !(CONFIRMED_CATEGORY_NAMES as readonly string[]).includes(name));
    const before = categorySettingsExport(source), result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.added).toBe(17); // online fallback target deliberately inactive
    expect(result.settings.names).toEqual([...source.names, ...BANK_CATEGORY_NAMES]);
    for (const name of CONFIRMED_CATEGORY_NAMES) expect(result.settings.names).not.toContain(name);
    for (const id of deletedIds) expect(result.settings.rules.some(rule => rule.id === id)).toBe(false);
    expect(result.settings.rules.some(rule => rule.id === 'bank-v3-online-fallback')).toBe(false);
    expect(categorySettingsExport(source)).toBe(before);
  });

  it.each(BANK_CATEGORY_RULES)('preserves a personal rule for $keyword including mode/category/ID instead of inserting a new competing bank rule', original => {
    const source = historicalV2(); source.names.push('Pilihan pribadi');
    const personal: CategoryRule = { id: `personal-${original.id}`, keyword: original.keyword.toLocaleLowerCase('tr-TR'), category: 'Pilihan pribadi', mode: original.mode === 'auto' ? 'suggest' : 'auto' };
    source.rules.splice(3, 0, personal);
    const before = JSON.stringify(source.rules), result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.added).toBe(17);
    expect(JSON.stringify(result.settings.rules.slice(0, source.rules.length))).toBe(before);
    expect(result.settings.rules.filter(rule => normalizeCategoryKeyword(rule.keyword) === normalizeCategoryKeyword(original.keyword))).toEqual([personal]);
  });

  it('keeps a custom rule whose ID occupies a bank-default ID even if its keyword is unrelated', () => {
    const source = historicalV2();
    const personal: CategoryRule = { id: BANK_CATEGORY_RULES[0].id, keyword: 'PERSONAL CASH LABEL', category: 'Lainnya', mode: 'auto' };
    source.rules.push(personal);
    const result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.added).toBe(17);
    expect(result.settings.rules.filter(rule => rule.id === personal.id)).toEqual([personal]);
  });

  it('keeps case-variant existing bank category labels and uses their exact display text as rule targets', () => {
    const source = historicalV2();
    const labels = ['tarik TUNAI', 'SETOR TUNAI', 'transfer', 'cashback'];
    source.names.splice(2, 0, ...labels);
    const before = [...source.names], result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.added).toBe(18);
    expect(result.settings.names).toEqual(before);
    for (const original of BANK_CATEGORY_RULES) {
      const labelIndex = (BANK_CATEGORY_NAMES as readonly string[]).indexOf(original.category);
      expect(result.settings.rules.find(rule => rule.id === original.id)?.category).toBe(labelIndex < 0 ? original.category : labels[labelIndex]);
    }
  });

  it('reuses a previously supported case-variant online-shopping label for the new bank fallback', () => {
    const source = historicalV2();
    source.names = source.names.map(name => name === 'Belanja online' ? 'BELANJA ONLINE' : name);
    source.rules = source.rules.map(rule => rule.category === 'Belanja online' ? { ...rule, category: 'BELANJA ONLINE' } : rule);
    const before = JSON.stringify(source.rules), result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.added).toBe(18);
    expect(result.settings.names).not.toContain('Belanja online');
    expect(result.settings.rules.find(rule => rule.id === 'bank-v3-online-fallback')?.category).toBe('BELANJA ONLINE');
    expect(JSON.stringify(result.settings.rules.slice(0, source.rules.length))).toBe(before);
  });

  it('does not resurrect bank rules or labels manually removed after current marker4 activation', () => {
    const current = upgradeCategorySettings(historicalV2()).settings;
    const edited = { ...current,
      names: current.names.filter(name => name !== 'Tarik tunai' && name !== 'Cashback'),
      rules: current.rules.filter(rule => rule.id !== 'bank-v3-atm-withdrawal' && rule.id !== 'bank-v3-prepaid-cashback') };
    const restored = parseCategorySettingsExport(categorySettingsExport(edited));
    const result = upgradeCategorySettings(restored);
    expect(result.settings).toBe(restored); expect(result.added).toBe(0); expect(result.error).toBe('');
    expect(result.settings.names).not.toContain('Tarik tunai'); expect(result.settings.names).not.toContain('Cashback');
    expect(result.settings.rules.some(rule => rule.id === 'bank-v3-atm-withdrawal')).toBe(false);
  });

  it('preserves an explicitly current empty rule list without silently restoring any older pack', () => {
    const current: CategorySettings = { version: 1, names: [UNCATEGORIZED, 'Kategori pribadi'], rules: [], keywordPackVersion: 5 };
    const result = upgradeCategorySettings(current);
    expect(result.settings).toBe(current); expect(result.settings.rules).toEqual([]);
    expect(result.settings.names).toEqual(current.names); expect(result.added).toBe(0);
  });

  it.each([2, 3, 4] as const)('explicit add-missing-current-keywords action keeps intentionally reverted rule fields for marker%s', marker => {
    const source = historicalV2(); source.keywordPackVersion = marker;
    const previous = CONFIRMED_RULE_UPDATES.find(update => update.previous.id === 'shopping-trendyol')!.previous;
    source.rules = source.rules.map(rule => rule.id === previous.id ? { ...previous } : rule);
    source.rules = source.rules.filter(rule => rule.id !== 'confirmed-apple-domain');
    const before = JSON.stringify(source.rules), result = mergeCurrentCategoryKeywordPack(source);
    expect(result.updated).toBe(0); expect(result.added).toBe(1);
    expect(JSON.stringify(result.settings.rules.slice(0, source.rules.length))).toBe(before);
    expect(result.settings.rules.find(rule => rule.id === previous.id)).toEqual(previous);
    expect(result.settings.rules.at(-1)).toEqual(CONFIRMED_ADDITIONAL_RULES.find(rule => rule.id === 'confirmed-apple-domain'));
  });

  it('keeps all200 rules and the old marker unchanged when bank additions exceed the count limit', () => {
    const source = historicalV2(); source.names.push('Pilihan pribadi');
    for (let i = source.rules.length; i < 200; i++) source.rules.push({ id: `manual-${i}`, keyword: `PRIVATE RULE ${i}`, category: 'Pilihan pribadi', mode: 'suggest' });
    const before = categorySettingsExport(source), result = upgradeCategorySettings(source);
    expect(result.settings).toBe(source); expect(result.added).toBe(0); expect(result.error).toMatch(/200/);
    expect(categorySettingsExport(source)).toBe(before); expect(source.keywordPackVersion).toBe(2);
    expect(source.names.some(name => (BANK_CATEGORY_NAMES as readonly string[]).includes(name))).toBe(false);
  });

  it('keeps a full100-category catalog unchanged if four bank labels cannot be appended atomically', () => {
    const source: CategorySettings = { version: 1, names: [UNCATEGORIZED, ...Array.from({ length: 99 }, (_, i) => `Kategori ${i}`)], rules: [], keywordPackVersion: 2 };
    const before = categorySettingsExport(source), result = upgradeCategorySettings(source);
    expect(result.settings).toBe(source); expect(result.added).toBe(0); expect(result.error).toMatch(/100/);
    expect(categorySettingsExport(source)).toBe(before);
  });

  it('refuses a bank expansion crossing128KiB without partial labels, rules, or marker changes', () => {
    const source = historicalV2(); source.names.push('界'.repeat(80)); source.rules = [];
    for (let i = 0; i < 186; i++) {
      const rule: CategoryRule = { id: `private-${i}-`.padEnd(120, '界'), keyword: `${i}-`.padEnd(100, '界'), category: '界'.repeat(80), mode: 'suggest' };
      if (envelopeBytes({ ...source, rules: [...source.rules, rule] }) > CATEGORY_SETTINGS_LIMIT) break;
      source.rules.push(rule);
    }
    expect(source.rules.length).toBeLessThan(186);
    expect(envelopeBytes(source)).toBeGreaterThan(CATEGORY_SETTINGS_LIMIT - 1_024);
    expect(validateCategorySettings(source)).toEqual(source);
    const before = categorySettingsExport(source), result = upgradeCategorySettings(source);
    expect(result.settings).toBe(source); expect(result.added).toBe(0); expect(result.error).toMatch(/128/);
    expect(categorySettingsExport(source)).toBe(before); expect(source.keywordPackVersion).toBe(2);
  });

  it('preserves each supported historical marker in export/import and rejects marker6', () => {
    for (const marker of [1, 2, 3, 4, 5] as const) {
      const source = { ...historicalV2(), keywordPackVersion: marker };
      expect(parseCategorySettingsExport(categorySettingsExport(source))).toEqual(source);
    }
    expect(() => validateCategorySettings({ ...historicalV2(), keywordPackVersion: 6 })).toThrow(/paket/);
  });

  it('never reads or writes local storage while proposing a bank settings upgrade', () => {
    const getItem = vi.fn(() => { throw Error('Unexpected personal ledger access'); });
    const setItem = vi.fn(() => { throw Error('Unexpected storage mutation'); });
    vi.stubGlobal('localStorage', { getItem, setItem });
    const result = upgradeCategorySettings(historicalV2());
    expect(result.error).toBe(''); expect(result.added).toBe(18);
    expect(getItem).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled();
  });

  it('does not refill a marker2 profile from either older defaults collection before adding bank rules', () => {
    const source = historicalV2();
    const deletedIds = new Set([...KEYWORD_EXPANSION_RULES, ...CONFIRMED_ADDITIONAL_RULES].map(rule => rule.id));
    source.rules = source.rules.filter(rule => !deletedIds.has(rule.id));
    const before = JSON.stringify(source.rules), result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.added).toBe(18);
    expect(result.settings.rules.some(rule => deletedIds.has(rule.id))).toBe(false);
    expect(JSON.stringify(result.settings.rules.slice(0, source.rules.length))).toBe(before);
  });
});
