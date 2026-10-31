import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CATEGORY_RULES, normalizeCategoryKeyword, type CategoryRule } from './categorization';
import {
  BANK_AUTOMATIC_RULE_UPDATES, BANK_CATEGORY_NAMES, BANK_CATEGORY_RULES,
  BANK_PREPAID_CREDIT_RULE, BANK_REVIEW_COMPLETION_RULES, mergeBankCategoryMappings,
} from './categoryBankMappings';
import { mergeCurrentAutomaticBankMappings } from './bankAutoMappings';
import { mergeCategoryKeywordPack } from './categoryKeywordPack';
import { mergeConfirmedCategoryMappings } from './categoryConfirmedMappings';
import { CONFIRMED_RULE_UPDATES, KEYWORD_EXPANSION_RULES } from './categoryKeywordDefinitions';
import {
  CATEGORY_SETTINGS_LIMIT, DEFAULT_CATEGORY_NAMES, UNCATEGORIZED,
  categorySettingsExport, defaultCategorySettings, parseCategorySettingsExport,
  validateCategorySettings, type CategorySettings,
} from './categorySettings';
import { upgradeCategorySettings } from './categorySettingsUpgrade';

afterEach(() => vi.unstubAllGlobals());

/** Build actual historical rules. Current defaults intentionally have auto modes. */
function historicalV3(): CategorySettings {
  const names = [...DEFAULT_CATEGORY_NAMES];
  const original = { version: 1 as const, names, rules: DEFAULT_CATEGORY_RULES.map(rule => ({ ...rule })) };
  const expanded = mergeCategoryKeywordPack(original).settings;
  const confirmed = mergeConfirmedCategoryMappings({ ...expanded, keywordPackVersion: 1 }).settings;
  return { ...mergeBankCategoryMappings(confirmed).settings, keywordPackVersion: 3 };
}
const envelopeBytes = (settings: CategorySettings) => new TextEncoder().encode(JSON.stringify({ app: 'uangku-category-settings', version: 1, settings })).length;

describe('version4 automatic bank mapping settings migration', () => {
  it('uses a genuine historical77-rule profile whose eight movement rules still have suggestion modes', () => {
    const source = historicalV3();
    expect(source.rules).toHaveLength(77); expect(source.names).toHaveLength(30);
    expect(BANK_AUTOMATIC_RULE_UPDATES).toHaveLength(8); expect(BANK_CATEGORY_RULES).toHaveLength(14);
    for (const update of BANK_AUTOMATIC_RULE_UPDATES) expect(source.rules.find(rule => rule.id === update.previous.id)).toEqual(update.previous);
    expect(source.rules.some(rule => rule.id === BANK_PREPAID_CREDIT_RULE.id)).toBe(false);
    const current = defaultCategorySettings();
    expect(current.keywordPackVersion).toBe(5); expect(current.rules).toHaveLength(81);
    expect(current.names).toHaveLength(30);
  });

  it('upgrades only the exact eight untouched old movement modes and adds barePREPAID, without touching existing names/order/otherfields', () => {
    const source = historicalV3(), before = categorySettingsExport(source);
    Object.freeze(source.names); source.rules.forEach(Object.freeze); Object.freeze(source.rules); Object.freeze(source);
    const result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.added).toBe(4); expect(result.updated).toBe(8);
    expect(result.settings.keywordPackVersion).toBe(5); expect(result.settings.names).toEqual(source.names);
    expect(result.settings.rules).toHaveLength(81);
    const expected = source.rules.map(rule => BANK_AUTOMATIC_RULE_UPDATES.find(update => update.previous.id === rule.id)?.current ?? rule);
    expect(result.settings.rules.slice(0, source.rules.length)).toEqual(expected);
    expect(result.settings.rules.find(rule => rule.id === BANK_PREPAID_CREDIT_RULE.id)).toEqual(BANK_PREPAID_CREDIT_RULE);
    expect(categorySettingsExport(source)).toBe(before);
  });

  const edits = BANK_AUTOMATIC_RULE_UPDATES.flatMap(update =>
    (['id', 'keyword', 'category', 'mode'] as const).map(field => ({ previous: update.previous, field })));
  it.each(edits)('preserves personal $field changes on $previous.id during v3upgrade', ({ previous, field }) => {
    const source = historicalV3(); source.names.push('Pilihan pribadi');
    const personal = { ...previous };
    if (field === 'id') personal.id = `personal-${previous.id}`;
    if (field === 'keyword') personal.keyword += ' KHUSUS';
    if (field === 'category') personal.category = 'Pilihan pribadi';
    if (field === 'mode') personal.mode = 'auto';
    source.rules = source.rules.map(rule => rule.id === previous.id ? personal : rule);
    const before = JSON.stringify(personal), result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.added).toBe(4); expect(result.updated).toBe(7);
    expect(JSON.stringify(result.settings.rules.find(rule => rule.id === personal.id))).toBe(before);
    expect(JSON.stringify(source.rules.find(rule => rule.id === personal.id))).toBe(before);
    if (field === 'id') expect(result.settings.rules.some(rule => rule.id === previous.id)).toBe(false);
  });

  it('never recreates deleted older rules or aliases when a marker3 profile receives only the new mode update', () => {
    const source = historicalV3();
    const deleted = ['bank-v3-atm-deposit', 'bank-v3-fast', 'keyword-pack-hop-scoot', 'confirmed-apple-domain', 'subscription-apple'];
    source.rules = source.rules.filter(rule => !deleted.includes(rule.id));
    const before = categorySettingsExport(source), result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.added).toBe(4); expect(result.updated).toBe(6);
    for (const id of deleted) expect(result.settings.rules.some(rule => rule.id === id)).toBe(false);
    expect(categorySettingsExport(source)).toBe(before);
  });

  it('does not reapply v2 confirmed rules to a v3 user who deliberately reverted those original definitions', () => {
    const source = historicalV3();
    const reverted = new Map(CONFIRMED_RULE_UPDATES.map(update => [update.previous.id, { ...update.previous }]));
    source.rules = source.rules.map(rule => reverted.get(rule.id) ?? rule);
    const result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.updated).toBe(8);
    for (const previous of reverted.values()) expect(result.settings.rules.find(rule => rule.id === previous.id)).toEqual(previous);
  });

  it('does not re-add missing category labels when migrating a v3 profile', () => {
    const source = historicalV3();
    source.names = source.names.filter(name => !['Cashback', 'Scooter', 'Belanja online', 'Pembayaran Apple', 'Tarik tunai'].includes(name));
    const names = [...source.names], before = categorySettingsExport(source), result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.added).toBe(3); expect(result.updated).toBe(7);
    expect(result.settings.names).toEqual(names);
    expect(result.settings.rules.some(rule => rule.id === BANK_PREPAID_CREDIT_RULE.id)).toBe(false);
    expect(categorySettingsExport(source)).toBe(before);
  });

  it('keeps approved case-variant movement labels while changing only their untouched suggestion modes', () => {
    const source = historicalV3();
    const labels = new Map([['Tarik tunai', 'TARIK TUNAI'], ['Setor tunai', 'setor tunai'], ['Transfer', 'transfer'], ['Cashback', 'cashback']]);
    source.names = source.names.map(name => labels.get(name) ?? name);
    source.rules = source.rules.map(rule => ({ ...rule, category: labels.get(rule.category) ?? rule.category }));
    const result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.updated).toBe(8); expect(result.added).toBe(4);
    expect(result.settings.names).toEqual(source.names);
    for (const previous of BANK_AUTOMATIC_RULE_UPDATES.map(update => update.previous)) {
      const actual = result.settings.rules.find(rule => rule.id === previous.id)!;
      expect(actual).toEqual({ ...previous, category: labels.get(previous.category) ?? previous.category, mode: 'auto' });
    }
    expect(result.settings.rules.find(rule => rule.id === BANK_PREPAID_CREDIT_RULE.id)).toEqual({ ...BANK_PREPAID_CREDIT_RULE, category: 'cashback' });
  });

  it.each(['auto', 'suggest'] as const)('does not insert a builtinPREPAID rule over a manual case-insensitive PREPAID keyword in mode%s', mode => {
    const source = historicalV3(); source.names.push('Pilihan pribadi');
    const personal: CategoryRule = { id: 'personal-prepaid', keyword: 'prepaid', category: 'Pilihan pribadi', mode };
    source.rules.splice(4, 0, personal);
    const result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.added).toBe(3); expect(result.updated).toBe(8);
    expect(result.settings.rules.filter(rule => normalizeCategoryKeyword(rule.keyword) === 'prepaid')).toEqual([personal]);
  });

  it('keeps a personal rule occupying the newPREPAID ID without replacing it or adding a duplicate ID', () => {
    const source = historicalV3();
    const personal: CategoryRule = { id: BANK_PREPAID_CREDIT_RULE.id, keyword: 'MY PREPAID CHOICE', category: 'Lainnya', mode: 'suggest' };
    source.rules.push(personal);
    const result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.added).toBe(3);
    expect(result.settings.rules.filter(rule => rule.id === personal.id)).toEqual([personal]);
  });

  it('preserves every historical rule deletion when the v3 user previously cleared the complete rule list', () => {
    const source = { ...historicalV3(), rules: [] };
    const result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.added).toBe(4); expect(result.updated ?? 0).toBe(0);
    expect(result.settings.rules).toEqual([BANK_PREPAID_CREDIT_RULE, ...BANK_REVIEW_COMPLETION_RULES]);
    expect(result.settings.names).toEqual(source.names);
  });

  it('does not resurrect deleted movement orPREPAID defaults after marker4 activation and export/import', () => {
    const current = upgradeCategorySettings(historicalV3()).settings;
    const edited = { ...current, rules: current.rules.filter(rule => ![BANK_PREPAID_CREDIT_RULE.id, BANK_AUTOMATIC_RULE_UPDATES[0].current.id].includes(rule.id)) };
    const imported = parseCategorySettingsExport(categorySettingsExport(edited));
    const result = upgradeCategorySettings(imported);
    expect(result.settings).toBe(imported); expect(result.added).toBe(0); expect(result.error).toBe('');
    expect(result.settings.rules).toEqual(edited.rules);
  });

  it('does not silently re-upgrade automatic rules a marker4 user changed back to suggestion', () => {
    const current = upgradeCategorySettings(historicalV3()).settings;
    const previous = new Map(BANK_AUTOMATIC_RULE_UPDATES.map(update => [update.previous.id, update.previous]));
    const edited = { ...current, rules: current.rules.map(rule => previous.get(rule.id) ?? rule) };
    const imported = parseCategorySettingsExport(categorySettingsExport(edited));
    const result = upgradeCategorySettings(imported);
    expect(result.settings).toBe(imported); expect(result.added).toBe(0);
    for (const original of previous.values()) expect(result.settings.rules.find(rule => rule.id === original.id)).toEqual(original);
  });

  it('explicit add-missing-defaults for marker4 adds the missing alias but preserves every personal mode reversion', () => {
    const current = upgradeCategorySettings(historicalV3()).settings;
    const previous = new Map(BANK_AUTOMATIC_RULE_UPDATES.map(update => [update.previous.id, update.previous]));
    const edited = { ...current, rules: current.rules.filter(rule => rule.id !== BANK_PREPAID_CREDIT_RULE.id).map(rule => previous.get(rule.id) ?? rule) };
    const before = JSON.stringify(edited.rules), result = mergeCurrentAutomaticBankMappings(edited);
    expect(result.updated).toBe(0); expect(result.added).toBe(1);
    expect(JSON.stringify(result.settings.rules.slice(0, edited.rules.length))).toBe(before);
    expect(result.settings.rules.find(rule => rule.id === BANK_PREPAID_CREDIT_RULE.id)).toEqual(BANK_PREPAID_CREDIT_RULE);
  });

  it('does not restore deleted v3 category labels merely because the personal catalog already uses all100 available slots', () => {
    const source: CategorySettings = { version: 1, keywordPackVersion: 3, names: [UNCATEGORIZED, ...Array.from({ length: 99 }, (_, i) => `Pilihan ${i}`)], rules: [] };
    const result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.added).toBe(0);
    expect(result.settings.names).toEqual(source.names); expect(result.settings.names).toHaveLength(100);
    expect(result.settings.rules).toEqual([]); expect(result.settings.keywordPackVersion).toBe(5);
  });

  it('rolls back the complete proposal including eight mode changes if the new rule exceeds200 rules', () => {
    const source = historicalV3(); source.names.push('Pilihan pribadi');
    for (let i = source.rules.length; i < 200; i++) source.rules.push({ id: `manual-${i}`, keyword: `PRIVATE KEYWORD ${i}`, category: 'Pilihan pribadi', mode: 'suggest' });
    const before = categorySettingsExport(source), result = upgradeCategorySettings(source);
    expect(result.error).toMatch(/200/); expect(result.settings).toBe(source); expect(result.added).toBe(0);
    expect(categorySettingsExport(source)).toBe(before); expect(source.keywordPackVersion).toBe(3);
    for (const previous of BANK_AUTOMATIC_RULE_UPDATES.map(update => update.previous)) expect(source.rules.find(rule => rule.id === previous.id)).toEqual(previous);
  });

  it('rolls back all mode changes if the full current export envelope would cross128KiB', () => {
    const source = historicalV3(); source.names.push('界'.repeat(80));
    source.rules = BANK_AUTOMATIC_RULE_UPDATES.map(update => ({ ...update.previous }));
    for (let i = 0; i < 190; i++) {
      const rule: CategoryRule = { id: `personal-${i}-`.padEnd(120, '界'), keyword: `${i}-`.padEnd(100, '界'), category: '界'.repeat(80), mode: 'suggest' };
      if (envelopeBytes({ ...source, rules: [...source.rules, rule] }) > CATEGORY_SETTINGS_LIMIT) break;
      source.rules.push(rule);
    }
    for (let i = 0; envelopeBytes(source) < CATEGORY_SETTINGS_LIMIT - 8 && source.names.length < 100; i++) {
      const remaining = CATEGORY_SETTINGS_LIMIT - 8 - envelopeBytes(source);
      if (remaining < 4) break;
      const length = Math.min(80, remaining - 3);
      const name = 'q'.repeat(length - 1) + String.fromCharCode(65 + i);
      source.names.push(name);
    }
    expect(source.rules.length).toBeLessThan(200);
    expect(envelopeBytes(source)).toBeGreaterThanOrEqual(CATEGORY_SETTINGS_LIMIT - 12);
    expect(validateCategorySettings(source)).toEqual(source);
    const before = categorySettingsExport(source), result = upgradeCategorySettings(source);
    expect(result.settings).toBe(source); expect(result.added).toBe(0); expect(result.error).toMatch(/128/);
    expect(categorySettingsExport(source)).toBe(before); expect(source.keywordPackVersion).toBe(3);
  });

  it('supports current and all previous markers in export/import while rejecting future marker6', () => {
    for (const marker of [1, 2, 3, 4, 5] as const) {
      const value = { ...historicalV3(), keywordPackVersion: marker };
      expect(parseCategorySettingsExport(categorySettingsExport(value))).toEqual(value);
    }
    expect(() => validateCategorySettings({ ...historicalV3(), keywordPackVersion: 6 })).toThrow(/paket/);
  });

  it('performs no browser-storage access or financial data writes while computing the current settings proposal', () => {
    const getItem = vi.fn(() => { throw Error('Unexpected browser data read'); });
    const setItem = vi.fn(() => { throw Error('Unexpected browser data write'); });
    vi.stubGlobal('localStorage', { getItem, setItem });
    const source = historicalV3(), before = JSON.stringify(source);
    expect(upgradeCategorySettings(source).error).toBe('');
    expect(JSON.stringify(source)).toBe(before); expect(getItem).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled();
  });

  it('does not merge any earlier pack back into a version3 profile with removed merchant defaults', () => {
    const source = historicalV3(), oldIds = new Set(KEYWORD_EXPANSION_RULES.map(rule => rule.id));
    source.rules = source.rules.filter(rule => !oldIds.has(rule.id));
    const before = JSON.stringify(source.rules), result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.added).toBe(4);
    expect(result.settings.rules.some(rule => oldIds.has(rule.id))).toBe(false);
    const expectedPrefix = source.rules.map(rule => BANK_AUTOMATIC_RULE_UPDATES.find(update => update.previous.id === rule.id)?.current ?? rule);
    expect(result.settings.rules.slice(0, source.rules.length)).toEqual(expectedPrefix);
    expect(JSON.stringify(source.rules)).toBe(before);
  });
});
