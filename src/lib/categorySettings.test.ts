import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CATEGORY_RULES, matchCategory } from './categorization';
import {
  CATEGORY_SETTINGS_KEY, CATEGORY_SETTINGS_LIMIT, UNCATEGORIZED, categoryChoices,
  categorySettingsExport, defaultCategorySettings, isUncategorized,
  parseCategorySettingsExport, validateCategorySettings, type CategorySettings,
} from './categorySettings';
import { serializeBackup, type StoredData } from './storage';

afterEach(() => vi.unstubAllGlobals());
const minimal = (): CategorySettings => ({ version: 1, names: [UNCATEGORIZED, 'Kategori sendiri'],
  rules: [{ id: 'rule-one', keyword: 'TOKO SENDIRI', category: 'Kategori sendiri', mode: 'auto' }] });
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

describe('closed category settings schema', () => {
  it('has editable defaults whose rule targets are all active', () => {
    const first = defaultCategorySettings(), second = defaultCategorySettings();
    expect(validateCategorySettings(first)).toEqual(first);
    expect(DEFAULT_CATEGORY_RULES.every(rule => first.names.includes(rule.category))).toBe(true);
    first.names.push('Only first copy');
    first.rules[0].keyword = 'Changed only here';
    expect(second.names).not.toContain('Only first copy');
    expect(second.rules[0].keyword).toBe(DEFAULT_CATEGORY_RULES[0].keyword);
    expect(CATEGORY_SETTINGS_KEY).toBe('uangku:categories:v1');
  });

  it.each([null, [], 'settings', { version: 2, names: [UNCATEGORIZED], rules: [] },
    { version: 1, names: [], rules: [] }, { version: 1, names: [UNCATEGORIZED], rules: {} },
    { version: 1, names: [UNCATEGORIZED], rules: [], state: {} }])('rejects malformed or unsupported settings: %j', value => {
    expect(() => validateCategorySettings(value)).toThrow();
  });

  it('requires the placeholder and rejects trimmed/case/canonical-Unicode duplicate names', () => {
    for (const names of [['Belanja'], [UNCATEGORIZED, 'Belanja', 'belanja'],
      [UNCATEGORIZED, 'Belanja', ' Belanja '], [UNCATEGORIZED, 'Café', 'Cafe\u0301']]) {
      expect(() => validateCategorySettings({ version: 1, names, rules: [] })).toThrow();
    }
  });

  it('accepts bounded Unicode names and literal phrases, trimming outer whitespace', () => {
    const value = { version: 1, names: [UNCATEGORIZED, '  Kafé & ihtiyaç 🥐  '],
      rules: [{ id: '  user-rule  ', keyword: '  KAHVE DÜNYASI  ', category: '  Kafé & ihtiyaç 🥐  ', mode: 'suggest' }] };
    const result = validateCategorySettings(value);
    expect(result.names[1]).toBe('Kafé & ihtiyaç 🥐');
    expect(result.rules[0]).toEqual({ id: 'user-rule', keyword: 'KAHVE DÜNYASI', category: 'Kafé & ihtiyaç 🥐', mode: 'suggest' });
    expect(value.names[1]).toBe('  Kafé & ihtiyaç 🥐  ');
    expect(parseCategorySettingsExport(categorySettingsExport(result))).toEqual(result);
  });

  it('allows exactly100 categories/200 rules and rejects the next entry', () => {
    const names = [UNCATEGORIZED, ...Array.from({ length: 99 }, (_, index) => `Category ${index}`)];
    const rules = Array.from({ length: 200 }, (_, index) => ({ id: `rule-${index}`, keyword: `TOKO ${index}`, category: names[1], mode: 'auto' as const }));
    expect(validateCategorySettings({ version: 1, names, rules }).rules).toHaveLength(200);
    expect(() => validateCategorySettings({ version: 1, names: [...names, 'Extra'], rules })).toThrow(/100/);
    expect(() => validateCategorySettings({ version: 1, names, rules: [...rules, { ...rules[0], id: 'extra' }] })).toThrow(/200/);
  });

  it.each(['', ' ', 'x'.repeat(81), 'bad\nname', 'bad\u0000name'])('rejects invalid category names: %j', name => {
    expect(() => validateCategorySettings({ version: 1, names: [UNCATEGORIZED, name], rules: [] })).toThrow();
  });

  it('enforces every rule field limit and supported mode', () => {
    for (const patch of [{ id: '' }, { id: 'i'.repeat(121) }, { keyword: 'ab' },
      { keyword: 'k'.repeat(101) }, { keyword: 'BAD\tVALUE' }, { category: '' },
      { category: 'c'.repeat(81) }, { category: UNCATEGORIZED }, { mode: 'certain' }, { extra: 'discard me' }]) {
      const value = minimal();
      value.rules[0] = { ...value.rules[0], ...patch } as typeof value.rules[0];
      expect(() => validateCategorySettings(value)).toThrow();
    }
    const value = minimal();
    value.rules.push({ ...value.rules[0], keyword: 'OTHER SHOP' });
    expect(() => validateCategorySettings(value)).toThrow(/ID/);
  });

  it('rejects prototype-bearing objects, symbols, unknown keys and getters without executing them', () => {
    const inherited = Object.assign(Object.create({ inherited: true }), minimal());
    expect(() => validateCategorySettings(inherited)).toThrow();
    expect(() => validateCategorySettings({ ...minimal(), [Symbol('hidden')]: true })).toThrow();
    const getter = vi.fn(() => []), object = minimal();
    Object.defineProperty(object, 'rules', { enumerable: true, get: getter });
    expect(() => validateCategorySettings(object)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const value = minimal(), keywordGetter = vi.fn(() => 'TOKO SENDIRI');
    Object.defineProperty(value.rules[0], 'keyword', { enumerable: true, get: keywordGetter });
    expect(() => validateCategorySettings(value)).toThrow();
    expect(keywordGetter).not.toHaveBeenCalled();
    const nullPrototype = Object.assign(Object.create(null), minimal());
    expect(validateCategorySettings(nullPrototype)).toEqual(minimal());
  });

  it('enforces a UTF8 byte budget independently of character counts', () => {
    const value = minimal();
    value.rules = Array.from({ length: 200 }, (_, index) => ({
      id: `rule-${index}`.padEnd(120, '界'), keyword: '界'.repeat(100), category: '界'.repeat(80), mode: 'auto',
    }));
    expect(bytes(value)).toBeGreaterThan(CATEGORY_SETTINGS_LIMIT);
    expect(() => validateCategorySettings(value)).toThrow(/128/);
  });
});

describe('category choices and archive compatibility', () => {
  it('includes an archived current label without reactivating its rules or erasing history', () => {
    const settings = minimal();
    settings.names = [UNCATEGORIZED];
    const before = JSON.stringify(settings);
    const valid = validateCategorySettings(settings);
    expect(categoryChoices(valid, 'Kategori sendiri')).toEqual([UNCATEGORIZED, 'Kategori sendiri']);
    expect(categoryChoices(valid, UNCATEGORIZED)).toEqual([UNCATEGORIZED]);
    expect(categoryChoices(valid)).toEqual([UNCATEGORIZED]);
    expect(matchCategory('TOKO SENDIRI', valid.rules, valid.names).kind).toBe('none');
    expect(valid.rules).toHaveLength(1);
    expect(JSON.stringify(settings)).toBe(before);
    expect(valid.names).toEqual([UNCATEGORIZED]);
  });

  it.each(['', '  ', UNCATEGORIZED])('recognizes the uncategorized sentinel %j', value => {
    expect(isUncategorized(value)).toBe(true);
  });

  it('preserves other active or historical category labels', () => {
    expect(isUncategorized('Kategori sendiri')).toBe(false);
    expect(isUncategorized('Kategori diarsipkan')).toBe(false);
  });
});

describe('separate category settings export', () => {
  it('roundtrips custom names, archived-rule references and both rule modes without accessing financial storage', () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() };
    vi.stubGlobal('localStorage', storage);
    const financial: StoredData = { app: 'uangku', version: 1, demo: false, state: { version: 1,
      wallets: [{ id: 'cash', name: 'Synthetic cash', currency: 'TRY', kind: 'cash', openingBalance: 10000 }],
      entries: [{ id: 'entry', date: '2026-10-01', type: 'expense', walletId: 'cash', amount: 100,
        category: 'Historical category', note: 'Synthetic only' }] } };
    const original = serializeBackup(financial), settings = minimal();
    settings.names.push('Kategori lain');
    settings.rules.push({ id: 'archived', keyword: 'OLD MERCHANT', category: 'Archived rule category', mode: 'suggest' });
    const raw = categorySettingsExport(settings);
    expect(parseCategorySettingsExport(raw)).toEqual(settings);
    expect(JSON.parse(raw)).toEqual({ app: 'uangku-category-settings', version: 1, settings });
    expect(raw).not.toContain('Synthetic only');
    expect(serializeBackup(financial)).toBe(original);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it.each(['{broken', 'null', '[]', '{}', JSON.stringify({ app: 'uangku', version: 1, state: {} }),
    JSON.stringify({ app: 'uangku-category-settings', version: 2, settings: minimal() }),
    JSON.stringify({ app: 'uangku-category-settings', version: 1, settings: minimal(), extra: true })])('rejects unrelated, malformed or future-version exports', raw => {
    expect(() => parseCategorySettingsExport(raw)).toThrow();
  });

  it('rejects oversized raw files before parsing', () => {
    expect(() => parseCategorySettingsExport(' '.repeat(CATEGORY_SETTINGS_LIMIT + 1))).toThrow(/128/);
  });

  it('does not export an envelope larger than its own importer can restore', () => {
    const value = minimal();
    value.rules = [];
    while (bytes(value) < CATEGORY_SETTINGS_LIMIT - 20) {
      const id = `rule-${value.rules.length}`.padEnd(120, '界');
      value.rules.push({ id, keyword: '界'.repeat(100), category: '界'.repeat(80), mode: 'auto' });
    }
    const last = value.rules.at(-1)!;
    for (const [field, min] of [['keyword', 3], ['id', 1], ['category', 1]] as const) {
      while (bytes(value) > CATEGORY_SETTINGS_LIMIT - 20 && last[field].length > min) last[field] = last[field].slice(0, -1);
    }
    expect(bytes(value)).toBeLessThanOrEqual(CATEGORY_SETTINGS_LIMIT);
    let raw: string;
    try { raw = categorySettingsExport(value); }
    catch (error) { expect(String(error)).toMatch(/128/); return; }
    expect(() => parseCategorySettingsExport(raw)).not.toThrow();
  });
});
