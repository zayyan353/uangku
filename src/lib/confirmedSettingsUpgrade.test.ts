import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORY_RULES, matchCategory, type CategoryRule } from './categorization';
import { mergeCategoryKeywordPack } from './categoryKeywordPack';
import {
  CONFIRMED_ADDITIONAL_RULES, CONFIRMED_CATEGORY_NAMES, CONFIRMED_RULE_UPDATES, KEYWORD_EXPANSION_RULES,
} from './categoryKeywordDefinitions';
import {
  DEFAULT_CATEGORY_NAMES, UNCATEGORIZED, categorySettingsExport,
  parseCategorySettingsExport, validateCategorySettings, type CategorySettings,
} from './categorySettings';
import { upgradeCategorySettings } from './categorySettingsUpgrade';
import { BANK_CATEGORY_NAMES, BANK_CATEGORY_RULES, BANK_REVIEW_COMPLETION_RULES, mergeBankCategoryMappings } from './categoryBankMappings';
import { mergeConfirmedCategoryMappings } from './categoryConfirmedMappings';

const oldNames = () => DEFAULT_CATEGORY_NAMES.filter(name => !([...CONFIRMED_CATEGORY_NAMES, ...BANK_CATEGORY_NAMES] as readonly string[]).includes(name));
function firstPack(): CategorySettings {
  return { ...mergeCategoryKeywordPack({ version: 1, names: oldNames(), rules: DEFAULT_CATEGORY_RULES.map(rule => ({ ...rule })) }).settings,
    keywordPackVersion: 1 };
}
const copy = <T,>(value: T): T => structuredClone(value);
function secondPack(): CategorySettings {
  return { ...mergeConfirmedCategoryMappings({ ...firstPack(), names: [...oldNames(), ...CONFIRMED_CATEGORY_NAMES] }).settings, keywordPackVersion: 2 };
}
function thirdPack(): CategorySettings {
  return { ...mergeBankCategoryMappings({ ...secondPack(), names: [...secondPack().names, ...BANK_CATEGORY_NAMES] }).settings, keywordPackVersion: 3 };
}
const confirmedAndBankAdded = CONFIRMED_ADDITIONAL_RULES.length + BANK_CATEGORY_RULES.length + 1 + BANK_REVIEW_COMPLETION_RULES.length;

describe('user-confirmed mapping version2 migration', () => {
  it('upgrades exactly the seven untouched bundled mappings and adds the seven confirmed aliases', () => {
    const source = firstPack(), before = categorySettingsExport(source);
    const result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.settings.keywordPackVersion).toBe(5);
    expect(result.added).toBe(confirmedAndBankAdded); expect(result.updated).toBe(15);
    const byId = new Map(result.settings.rules.map(rule => [rule.id, rule]));
    expect(byId.get('shopping-trendyol')).toEqual({ id: 'shopping-trendyol', keyword: 'TRENDYOL', category: 'Belanja online', mode: 'auto' });
    expect(byId.get('subscription-apple')).toEqual({ id: 'subscription-apple', keyword: 'APPLE.COM/BILL', category: 'Pembayaran Apple', mode: 'auto' });
    for (const id of ['keyword-pack-hop-scooter', 'keyword-pack-hop-scoot']) expect(byId.get(id)?.category).toBe('Scooter');
    expect(byId.get('keyword-pack-yemek-sepet')?.mode).toBe('auto');
    expect(byId.get('keyword-pack-composite-delivery')?.mode).toBe('auto');
    expect(byId.get('keyword-pack-youtube-generic')).toEqual({ id: 'keyword-pack-youtube-generic', keyword: 'GOOGLE YOUTUBE', category: 'Langganan', mode: 'auto' });
    for (const rule of CONFIRMED_ADDITIONAL_RULES) expect(byId.get(rule.id)).toEqual(rule);
    expect(result.settings.rules).toHaveLength(81);
    expect(categorySettingsExport(source)).toBe(before);
  });

  it('does not re-add old expansion rules that a marker1 user deliberately removed', () => {
    const source = firstPack();
    const deleted = ['keyword-pack-hop-scoot', 'keyword-pack-a101-alias', 'keyword-pack-avea-bill'];
    source.rules = source.rules.filter(rule => !deleted.includes(rule.id));
    const before = categorySettingsExport(source), result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.settings.keywordPackVersion).toBe(5);
    expect(result.added).toBe(confirmedAndBankAdded); expect(result.updated).toBe(14);
    for (const id of deleted) expect(result.settings.rules.some(rule => rule.id === id)).toBe(false);
    expect(categorySettingsExport(source)).toBe(before);
  });

  const personalEdits = CONFIRMED_RULE_UPDATES.flatMap(update =>
    (['id', 'keyword', 'category', 'mode'] as const).map(field => ({ previous: update.previous, field })));
  it.each(personalEdits)('preserves personal $field edits to bundled $previous.id', ({ previous, field }) => {
    const source = firstPack(); source.names.push('Pilihan pribadi');
    const edited = { ...previous };
    if (field === 'id') edited.id = `personal-${previous.id}`;
    if (field === 'keyword') edited.keyword += ' KHUSUS';
    if (field === 'category') edited.category = 'Pilihan pribadi';
    if (field === 'mode') edited.mode = previous.mode === 'auto' ? 'suggest' : 'auto';
    source.rules = source.rules.map(rule => rule.id === previous.id ? edited : rule);
    const before = JSON.stringify(edited), result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.updated).toBe(14);
    expect(JSON.stringify(result.settings.rules.find(rule => rule.id === edited.id))).toBe(before);
    expect(JSON.stringify(source.rules.find(rule => rule.id === edited.id))).toBe(before);
  });

  it('never changes user-created copies merely because their phrase matches an old bundled rule', () => {
    const source = firstPack();
    const replace = new Map(CONFIRMED_RULE_UPDATES.map(update => [update.previous.id, { ...update.previous, id: `personal-${update.previous.id}` }]));
    source.rules = source.rules.map(rule => replace.get(rule.id) ?? rule);
    const originals = source.rules.filter(rule => rule.id.startsWith('personal-'));
    const result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.updated ?? 0).toBe(8);
    expect(result.settings.rules.filter(rule => rule.id.startsWith('personal-'))).toEqual(originals);
  });

  it('reuses existing case-variant category labels without duplicates or silently inactive new mappings', () => {
    const source = firstPack();
    const labels = ['scooter', 'BELANJA ONLINE', 'pembayaran apple'];
    source.names.splice(1, 0, ...labels);
    const namesBefore = copy(source.names), result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.updated).toBe(15);
    expect(result.settings.names).toEqual([...namesBefore, ...BANK_CATEGORY_NAMES]);
    expect(result.settings.rules.find(rule => rule.id === 'keyword-pack-hop-scooter')?.category).toBe('scooter');
    expect(result.settings.rules.find(rule => rule.id === 'shopping-trendyol')?.category).toBe('BELANJA ONLINE');
    expect(result.settings.rules.find(rule => rule.id === 'subscription-apple')?.category).toBe('pembayaran apple');
    expect(result.settings.rules.find(rule => rule.id === 'confirmed-apple-domain')?.category).toBe('pembayaran apple');
    expect(result.settings.names).not.toContain('Scooter');
    const food = matchCategory('SANAL POS ALISVERIS ISYERI: TRENDYOL YEMEK', result.settings.rules, result.settings.names);
    expect(food.kind).toBe('auto'); expect(food.suggestions.map(row => row.category)).toEqual(['Makan & minum']);
    const apple = matchCategory('SANAL POS ALISVERIS ISYERI: APPLE.COM/BILL', result.settings.rules, result.settings.names);
    expect(apple.kind).toBe('auto'); expect(apple.suggestions.map(row => row.category)).toEqual(['pembayaran apple']);
  });

  it('keeps manually removed new categories and aliases removed after current marker4 activation', () => {
    const activated = upgradeCategorySettings(firstPack()).settings;
    const edited = { ...activated,
      names: activated.names.filter(name => name !== 'Scooter'),
      rules: activated.rules.filter(rule => rule.id !== 'confirmed-apple-domain') };
    const imported = parseCategorySettingsExport(categorySettingsExport(edited));
    const result = upgradeCategorySettings(imported);
    expect(result.settings).toBe(imported); expect(result.added).toBe(0); expect(result.error).toBe('');
    expect(result.settings.names).not.toContain('Scooter');
    expect(result.settings.rules.some(rule => rule.id === 'confirmed-apple-domain')).toBe(false);
  });

  it('preserves all four supported marker versions through ordinary export/import', () => {
    const one = firstPack(), two = secondPack(), three = thirdPack(), four = upgradeCategorySettings(three).settings;
    for (const source of [one, two, three, four]) {
      const imported = parseCategorySettingsExport(categorySettingsExport(source));
      expect(imported).toEqual(source);
      expect(imported.keywordPackVersion).toBe(source.keywordPackVersion);
    }
  });

  it('does not fill absent v1 rules after an imported old configuration is explicitly declared current', () => {
    const imported = parseCategorySettingsExport(categorySettingsExport({ version: 1, names: oldNames(), rules: [] }));
    const saved = validateCategorySettings({ ...imported, keywordPackVersion: 5 });
    const result = upgradeCategorySettings(saved);
    expect(result.settings).toBe(saved); expect(result.added).toBe(0);
    expect(result.settings.rules).toEqual([]);
  });

  it('refuses the entire version2 migration if new category names would exceed100', () => {
    const source = firstPack();
    source.names = [UNCATEGORIZED, ...Array.from({ length: 99 }, (_, index) => `Kategori pribadi ${index}`)];
    source.rules = [];
    expect(validateCategorySettings(source)).toEqual(source);
    const before = categorySettingsExport(source), result = upgradeCategorySettings(source);
    expect(result.settings).toBe(source); expect(result.added).toBe(0);
    expect(result.error).toMatch(/100/); expect(categorySettingsExport(source)).toBe(before);
    expect(source.keywordPackVersion).toBe(1);
  });

  it('refuses the complete v2 rule additions at200 without partially relabeling bundled rules', () => {
    const source = firstPack(); source.names.push('Kategori pribadi');
    const fillers: CategoryRule[] = Array.from({ length: 200 - source.rules.length }, (_, index) => ({
      id: `manual-capacity-${index}`, keyword: `MANUAL CAPACITY ${index}`, category: 'Kategori pribadi', mode: 'suggest',
    }));
    source.rules.push(...fillers);
    expect(source.rules).toHaveLength(200);
    const before = categorySettingsExport(source), result = upgradeCategorySettings(source);
    expect(result.settings).toBe(source); expect(result.added).toBe(0);
    expect(result.error).toMatch(/200/); expect(categorySettingsExport(source)).toBe(before);
    expect(source.rules.find(rule => rule.id === 'shopping-trendyol')?.category).toBe('Belanja');
    expect(source.names.some(name => (CONFIRMED_CATEGORY_NAMES as readonly string[]).includes(name))).toBe(false);
  });

  it('does not treat a v1 configuration as unmarked even when every expansion rule was removed', () => {
    const source = firstPack();
    const oldExpansionIds = new Set(KEYWORD_EXPANSION_RULES.map(rule => rule.id));
    source.rules = source.rules.filter(rule => !oldExpansionIds.has(rule.id));
    const result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.settings.keywordPackVersion).toBe(5);
    expect(result.settings.rules.some(rule => oldExpansionIds.has(rule.id))).toBe(false);
    expect(result.added).toBe(confirmedAndBankAdded); expect(result.updated).toBe(10);
  });
});
