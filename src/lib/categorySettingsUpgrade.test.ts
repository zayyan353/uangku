import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CATEGORY_RULES, normalizeCategoryKeyword, type CategoryRule } from './categorization';
import { KEYWORD_EXPANSION_RULES } from './categoryKeywordPack';
import { CONFIRMED_ADDITIONAL_RULES, CONFIRMED_CATEGORY_NAMES, CONFIRMED_RULE_UPDATES } from './categoryKeywordDefinitions';
import { BANK_CATEGORY_NAMES, BANK_CATEGORY_RULES, BANK_REVIEW_COMPLETION_RULES } from './categoryBankMappings';
import {
  CATEGORY_SETTINGS_LIMIT, DEFAULT_CATEGORY_NAMES, UNCATEGORIZED,
  categorySettingsExport, parseCategorySettingsExport, validateCategorySettings, type CategorySettings,
} from './categorySettings';
import { upgradeCategorySettings } from './categorySettingsUpgrade';

afterEach(() => vi.unstubAllGlobals());

const newNames = [...CONFIRMED_CATEGORY_NAMES, ...BANK_CATEGORY_NAMES];
const legacy = (): CategorySettings => ({ version: 1, names: DEFAULT_CATEGORY_NAMES.filter(name => !(newNames as readonly string[]).includes(name)),
  rules: DEFAULT_CATEGORY_RULES.map(rule => ({ ...rule })) });
const addedCount = KEYWORD_EXPANSION_RULES.length + CONFIRMED_ADDITIONAL_RULES.length + BANK_CATEGORY_RULES.length + 1 + BANK_REVIEW_COMPLETION_RULES.length;
function expectedExistingRules(source: CategorySettings) {
  return source.rules.map(rule => CONFIRMED_RULE_UPDATES.find(update =>
    Object.keys(update.previous).every(key => rule[key as keyof CategoryRule] === update.previous[key as keyof CategoryRule]))?.current ?? rule);
}
const custom = (patch: Partial<CategoryRule> = {}): CategoryRule => ({
  id: 'manual-rule', keyword: 'TOKO PRIBADI', category: 'Kategori pribadi', mode: 'suggest', ...patch,
});
const envelopeBytes = (settings: CategorySettings) => new TextEncoder().encode(JSON.stringify({
  app: 'uangku-category-settings', version: 1, settings,
})).byteLength;

describe('legacy category settings keyword pack upgrade', () => {
  it('adds confirmed categories and aliases to legacy data while updating only exact bundled identities', () => {
    const source = legacy(), before = JSON.stringify(source);
    const result = upgradeCategorySettings(source);
    expect(result.error).toBe('');
    expect(result.added).toBe(addedCount);
    expect(result.settings.keywordPackVersion).toBe(5);
    expect(result.settings.names).toEqual([...source.names, ...newNames]);
    expect(result.settings.rules.slice(0, source.rules.length)).toEqual(expectedExistingRules(source));
    expect(result.settings.rules).toHaveLength(source.rules.length + addedCount);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('retains manual category names, rule IDs, modes, targets and order exactly', () => {
    const source = legacy();
    source.names = [UNCATEGORIZED, 'Kategori pribadi', ...source.names.slice(1)];
    source.rules = [custom(), ...source.rules, custom({ id: 'manual-last', keyword: 'LANGGANAN SAYA', mode: 'auto' })];
    const before = JSON.stringify(source), names = JSON.stringify(source.names), rules = JSON.stringify(source.rules);
    Object.freeze(source.names); source.rules.forEach(Object.freeze); Object.freeze(source.rules); Object.freeze(source);
    const result = upgradeCategorySettings(source);
    expect(result.error).toBe('');
    expect(JSON.stringify(result.settings.names.slice(0, source.names.length))).toBe(names);
    expect(result.settings.rules[0]).toEqual(source.rules[0]);
    expect(result.settings.rules[source.rules.length - 1]).toEqual(source.rules.at(-1));
    expect(JSON.stringify(result.settings.rules.slice(0, source.rules.length).filter(rule => rule.id.startsWith('manual-')))).toBe(
      JSON.stringify(source.rules.filter(rule => rule.id.startsWith('manual-'))));
    expect(result.settings.rules.slice(0, source.rules.length)).toEqual(expectedExistingRules(source));
    expect(JSON.stringify(source.rules)).toBe(rules);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('does not upgrade a personal suggestion rule to automatic for the same new merchant keyword', () => {
    const source = legacy(); source.names.push('Kategori pribadi');
    const manual = custom({ keyword: 'HOP SCOOTER' }); source.rules.push(manual);
    const result = upgradeCategorySettings(source);
    expect(result.error).toBe('');
    const matching = result.settings.rules.filter(rule => normalizeCategoryKeyword(rule.keyword) === normalizeCategoryKeyword(manual.keyword));
    expect(matching).toEqual([manual]);
    expect(result.settings.rules.find(rule => rule.id === manual.id)?.mode).toBe('suggest');
    expect(result.added).toBe(addedCount - 1);
  });

  it('keeps a normalized punctuation alias assigned to a different personal category', () => {
    const source = legacy(); source.names.push('Kategori pribadi');
    const manual = custom({ keyword: 'a 101', mode: 'auto' }); source.rules.push(manual);
    const result = upgradeCategorySettings(source);
    const matching = result.settings.rules.filter(rule => normalizeCategoryKeyword(rule.keyword) === normalizeCategoryKeyword('A-101'));
    expect(matching).toEqual([manual]);
    expect(result.settings.names).toEqual([...source.names, ...newNames]);
  });

  it('does not reactivate removed categories or add new rules targeting them', () => {
    const source = legacy();
    source.names = source.names.filter(name => name !== 'Transportasi' && name !== 'Pakaian');
    const before = JSON.stringify(source.rules);
    const result = upgradeCategorySettings(source);
    expect(result.error).toBe('');
    expect(result.settings.names).toEqual([...source.names, ...newNames]);
    expect(result.settings.rules.slice(0, source.rules.length)).toEqual(expectedExistingRules(source));
    expect(JSON.stringify(source.rules)).toBe(before);
    const added = result.settings.rules.slice(source.rules.length);
    expect(added.some(rule => rule.category === 'Transportasi' || rule.category === 'Pakaian')).toBe(false);
    expect(result.settings.names).not.toContain('Transportasi');
  });

  it('preserves a manually occupied bundled rule ID without replacing its contents', () => {
    const source = legacy(); source.names.push('Kategori pribadi');
    const manual = custom({ id: KEYWORD_EXPANSION_RULES[0].id }); source.rules.push(manual);
    const result = upgradeCategorySettings(source);
    expect(result.error).toBe('');
    expect(result.settings.rules.filter(rule => rule.id === manual.id)).toEqual([manual]);
    expect(result.added).toBe(addedCount - 1);
  });

  it('adds only approved new category names without recreating inactive older categories', () => {
    const source: CategorySettings = { version: 1, names: [UNCATEGORIZED, 'Kategori pribadi'], rules: [custom()] };
    const result = upgradeCategorySettings(source);
    expect(result.error).toBe('');
    expect(result.settings.keywordPackVersion).toBe(5);
    expect(result.settings.names).toEqual([...source.names, ...newNames]);
    expect(result.settings.rules[0]).toEqual(source.rules[0]);
    expect(result.settings.rules.slice(1).every(rule => (newNames as readonly string[]).includes(rule.category))).toBe(true);
    expect(source).not.toHaveProperty('keywordPackVersion');
  });

  it('is idempotent once the effective upgraded settings are passed back', () => {
    const first = upgradeCategorySettings(legacy());
    const second = upgradeCategorySettings(first.settings);
    expect(second.settings).toBe(first.settings);
    expect(second.added).toBe(0); expect(second.error).toBe('');
    expect(new Set(second.settings.rules.map(rule => rule.id)).size).toBe(second.settings.rules.length);
  });

  it('does not resurrect new default rules removed manually after pack activation', () => {
    const first = upgradeCategorySettings(legacy()).settings;
    const removedId = KEYWORD_EXPANSION_RULES[0].id;
    const edited = { ...first, rules: first.rules.filter(rule => rule.id !== removedId) };
    const restored = parseCategorySettingsExport(categorySettingsExport(edited));
    const result = upgradeCategorySettings(restored);
    expect(result.settings).toBe(restored); expect(result.added).toBe(0);
    expect(result.settings.rules.some(rule => rule.id === removedId)).toBe(false);
  });

  it('preserves intentional removal of every bundled new rule across export and restore', () => {
    const first = upgradeCategorySettings(legacy()).settings;
    const edited = { ...first, rules: [] };
    const restored = parseCategorySettingsExport(categorySettingsExport(edited));
    expect(restored.keywordPackVersion).toBe(5);
    const result = upgradeCategorySettings(restored);
    expect(result.settings.rules).toEqual([]); expect(result.added).toBe(0);
  });

  it('supports legacy settings export/import without silently upgrading during parsing', () => {
    const source = legacy(), raw = categorySettingsExport(source);
    const parsed = parseCategorySettingsExport(raw);
    expect(parsed).toEqual(source); expect(parsed).not.toHaveProperty('keywordPackVersion');
    expect(upgradeCategorySettings(parsed).settings.keywordPackVersion).toBe(5);
  });

  it.each([0, 6, '1', null])('rejects unsupported or malformed explicit pack markers: %j', marker => {
    const source = { ...legacy(), keywordPackVersion: marker };
    expect(() => validateCategorySettings(source)).toThrow(/paket|didukung/);
    expect(() => parseCategorySettingsExport(JSON.stringify({ app: 'uangku-category-settings', version: 1, settings: source }))).toThrow();
  });

  it('rejects an explicit non-JSON undefined marker while ordinary omission remains a valid legacy setting', () => {
    expect(() => validateCategorySettings({ ...legacy(), keywordPackVersion: undefined })).toThrow(/paket|didukung/);
    expect(validateCategorySettings(legacy())).not.toHaveProperty('keywordPackVersion');
  });

  it('rejects upgrade of a future marker instead of falling back to a replacement default catalog', () => {
    const source = { ...legacy(), keywordPackVersion: 6 };
    const before = JSON.stringify(source);
    expect(() => upgradeCategorySettings(source as unknown as CategorySettings)).toThrow(/paket|didukung/);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('keeps a full 200-rule personal configuration intact if the complete pack does not fit', () => {
    const source = legacy(); source.names.push('Kategori pribadi');
    source.rules = Array.from({ length: 200 }, (_, index) => custom({ id: `personal-${index}`, keyword: `TOKO PRIBADI ${index}` }));
    expect(validateCategorySettings(source)).toEqual(source);
    const before = JSON.stringify(source), result = upgradeCategorySettings(source);
    expect(result.settings).toBe(source); expect(result.added).toBe(0);
    expect(result.error).toMatch(/200|batas/);
    expect(JSON.stringify(source)).toBe(before);
    expect(source).not.toHaveProperty('keywordPackVersion');
  });

  it('refuses an oversized expanded UTF-8 envelope atomically while keeping a valid old configuration', () => {
    const source = legacy(); source.names.push('界'.repeat(80)); source.rules = [];
    for (let index = 0; index < 174; index++) {
      const rule = custom({ id: `personal-${index}-`.padEnd(120, '界'), keyword: `${index}-`.padEnd(100, '界'), category: '界'.repeat(80) });
      const candidate = { ...source, rules: [...source.rules, rule] };
      if (envelopeBytes(candidate) > CATEGORY_SETTINGS_LIMIT) break;
      source.rules.push(rule);
    }
    expect(source.rules.length).toBeLessThan(174);
    expect(envelopeBytes(source)).toBeGreaterThan(CATEGORY_SETTINGS_LIMIT - 1_024);
    expect(validateCategorySettings(source)).toEqual(source);
    const before = categorySettingsExport(source), result = upgradeCategorySettings(source);
    expect(result.settings).toBe(source); expect(result.added).toBe(0);
    expect(result.error).toMatch(/128/);
    expect(categorySettingsExport(source)).toBe(before);
    expect(source).not.toHaveProperty('keywordPackVersion');
  });

  it('never accesses browser storage or the financial ledger while computing a settings proposal', () => {
    const getItem = vi.fn(() => { throw Error('Financial storage access is forbidden in pure upgrade'); });
    const setItem = vi.fn(() => { throw Error('Financial storage writes are forbidden in pure upgrade'); });
    vi.stubGlobal('localStorage', { getItem, setItem });
    const result = upgradeCategorySettings(legacy());
    expect(result.added).toBe(addedCount);
    expect(getItem).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled();
  });
});
