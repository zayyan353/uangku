import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORY_NAMES, validateCategorySettings, type CategorySettings } from './categorySettings';
import { DEFAULT_CATEGORY_RULES, matchCategory, normalizeCategoryKeyword, type CategoryRule } from './categorization';
import { KEYWORD_EXPANSION_RULES, mergeCategoryKeywordPack } from './categoryKeywordPack';
import { categorySuggestion } from './categorySuggestions';

const legacy = (): CategorySettings => ({ version: 1, names: [...DEFAULT_CATEGORY_NAMES, 'Kategori pribadi'], rules: DEFAULT_CATEGORY_RULES.map(rule => ({ ...rule })) });
const effective = () => mergeCategoryKeywordPack(legacy()).settings;
const broad = () => ({ ...DEFAULT_CATEGORY_RULES.find(rule => rule.id === 'shopping-trendyol')! });
const matches = (text: string, settings = effective()) => matchCategory(text, settings.rules, settings.names);

describe('non-destructive keyword pack merging', () => {
  it('adds the26publicaliases without changing the30legacydefaults or existing settings', () => {
    expect(DEFAULT_CATEGORY_RULES).toHaveLength(30);
    expect(KEYWORD_EXPANSION_RULES).toHaveLength(26);
    expect(new Set(KEYWORD_EXPANSION_RULES.map(rule => rule.id)).size).toBe(26);
    const initial = legacy(), before = JSON.stringify(initial);
    const result = mergeCategoryKeywordPack(initial);
    expect(result.added).toBe(26); expect(result.skipped).toBe(0);
    expect(result.settings.rules).toHaveLength(56);
    expect(result.settings.rules.slice(0,30)).toEqual(initial.rules);
    expect(result.settings.names).toBe(initial.names);
    expect(JSON.stringify(initial)).toBe(before);
    expect(validateCategorySettings(result.settings)).toEqual(result.settings);
  });

  it('is idempotent and does not return a new settings object when nothing is added', () => {
    const first = mergeCategoryKeywordPack(legacy()).settings;
    const second = mergeCategoryKeywordPack(first);
    expect(second).toEqual({ settings: first, added: 0, skipped: 26 });
    expect(second.settings).toBe(first);
  });

  it('does not reactivate removed categories or remove rules pointing at them', () => {
    const initial = legacy(); initial.names = initial.names.filter(name => name !== 'Transportasi');
    const before = structuredClone(initial);
    const result = mergeCategoryKeywordPack(initial);
    expect(result.added).toBe(22); expect(result.skipped).toBe(4);
    expect(result.settings.names).toEqual(before.names);
    expect(result.settings.rules.slice(0,30)).toEqual(before.rules);
    expect(result.settings.rules.some(rule => rule.id.startsWith('keyword-pack-hop'))).toBe(false);
    expect(initial).toEqual(before);
  });

  it.each([
    { id: 'my-hop', keyword: 'hop   scoot', category: 'Kategori pribadi', mode: 'suggest' },
    { id: 'my-hop', keyword: 'HOP-SCOOT', category: 'Transportasi', mode: 'suggest' },
    { id: 'my-bank', keyword: 'KOMİSYON TUTARI', category: 'Kategori pribadi', mode: 'auto' },
  ] satisfies CategoryRule[])('keeps existing normalized keyword choice andmode: $keyword', custom => {
    const initial = legacy(); initial.rules.push(custom);
    const merged = mergeCategoryKeywordPack(initial);
    expect(merged.added).toBe(25);
    expect(merged.settings.rules.filter(rule => normalizeCategoryKeyword(rule.keyword) === normalizeCategoryKeyword(custom.keyword))).toEqual([custom]);
    expect(merged.settings.rules.find(rule => rule.id === custom.id)).toEqual(custom);
  });

  it('does not replace a rule whose ID collides with a new bundled rule', () => {
    const initial = legacy(), id = KEYWORD_EXPANSION_RULES[0].id;
    const custom: CategoryRule = { id, keyword: 'TOKO PILIHAN SAYA', category: 'Kategori pribadi', mode: 'suggest' };
    initial.rules.push(custom);
    const result = mergeCategoryKeywordPack(initial);
    expect(result.added).toBe(25);
    expect(result.settings.rules.filter(rule => rule.id === id)).toEqual([custom]);
  });

  it('returns detached added rules so editing effective settings cannot change future packs', () => {
    const first = effective(), original = KEYWORD_EXPANSION_RULES[0].keyword;
    first.rules.find(rule => rule.id === KEYWORD_EXPANSION_RULES[0].id)!.keyword = 'EDIT ONLY FIRST';
    expect(effective().rules.find(rule => rule.id === KEYWORD_EXPANSION_RULES[0].id)!.keyword).toBe(original);
  });

  it('lets a manual suggestion rule prevent its matching bundledautomaticupgrade', () => {
    const initial = legacy();
    initial.rules.push({ id: 'my-care', keyword: 'GRATIS', category: 'Perawatan diri', mode: 'suggest' });
    const merged = mergeCategoryKeywordPack(initial).settings;
    expect(matches('POS İŞYERİ: GRATIS STORE', merged).kind).toBe('suggestions');
    expect(merged.rules.some(rule => rule.id === 'keyword-pack-gratis')).toBe(false);
  });
});

describe('observed public merchant aliases', () => {
  it.each(KEYWORD_EXPANSION_RULES.map(rule => [rule.keyword,rule.category,rule.mode] as const))('matches %s to %s with intended %s mode', (keyword, category, mode) => {
    const text = keyword === 'GRATIS' ? 'POS İŞYERİ: GRATIS SYNTHETIC STORE' : `POS İŞYERİ: ${keyword} SYNTHETIC STORE`;
    const result = matches(text);
    expect(result.kind).toBe(mode === 'auto' ? 'auto' : 'suggestions');
    expect(result.suggestions.map(row => row.category)).toContain(category);
  });

  it.each(['POS Çağrı Market', 'pos çagri market', 'POS ÇAĞRI-MARKET'])('normalizes Turkishgroceryaliases: %s', text => {
    expect(matches(text)).toMatchObject({ kind: 'auto', suggestions: [{ category: 'Bahan makanan' }] });
  });

  it.each(['POS A-1010', 'HOP SCOOTERX', 'CAGRI MARKETLERI', 'ESTRAMAL', 'LC WAIKIKIX'])('keeps fulltokenboundariesfor %s', text => {
    expect(matches(text).kind).toBe('none');
  });

  it.each(['Kopi gratis', 'Gratis ongkir', 'Dapat bonus gratis', 'POS GRATIS'])('does not confuse Indonesianfreewordwith bundledretailer: %s', text => {
    expect(matches(text).kind).toBe('none');
  });

  it('retains explicitmanualGratisrulebehavior outsidebankmerchantcontext', () => {
    const initial = legacy();
    initial.rules.push({ id: 'manual-gratis', keyword: 'GRATIS', category: 'Kategori pribadi', mode: 'auto' });
    expect(matches('Kopi gratis', mergeCategoryKeywordPack(initial).settings)).toMatchObject({ kind: 'auto', suggestions: [{ category: 'Kategori pribadi' }] });
  });

  it.each(['REFUND HOP SCOOTER', 'HAVALE HOP SCOOT', 'ATM AVEA COM TR FATURA', 'IADE TRENDYOL PLUS'])('keeps ambiguous rails/returns as suggestions: %s', text => {
    expect(matches(text).kind).toBe('suggestions');
  });

  it('never confirms unreviewed financial type orcategorizes transfers/adjustments', () => {
    const settings = effective();
    expect(categorySuggestion('POS HOP SCOOTER', 'unreviewed', settings).kind).toBe('suggestions');
    expect(categorySuggestion('POS HOP SCOOTER', 'transfer', settings).kind).toBe('none');
    expect(categorySuggestion('POS HOP SCOOTER', 'adjustment', settings).kind).toBe('none');
  });
});

describe('narrow bundledTrendyol service precedence', () => {
  it.each([['TRENDYOL YEMEK','Makan & minum'], ['TRENDYOL MARKET','Bahan makanan'], ['TRENDYOL PLUS','Langganan']])('uses specific %s without genericshoppingconflict', (text, category) => {
    const result = matches(`POS S/${text}`);
    expect(result).toMatchObject({ kind: 'auto', suggestions: [{ category }] });
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].ruleId).not.toBe('shopping-trendyol');
  });

  it.each(['TRENDYOL', 'TRENDYOL YEMEKLERI', 'TRENDYOLGO', 'TRENDYOL MARKETLERI'])('keeps nonspecific %s shopping as a suggestion', text => {
    const result = matches(text);
    if(text === 'TRENDYOLGO') expect(result.kind).toBe('none');
    else expect(result).toMatchObject({ kind: 'suggestions', suggestions: [{ category: 'Belanja' }] });
  });

  it.each([{ mode: 'auto' }, { keyword: 'trendyol' }, { category: 'Kategori pribadi' }, { id: 'manual-trendyol' }] satisfies Partial<CategoryRule>[])('does not suppress editedgeneralrule %j', change => {
    const initial = legacy();
    initial.rules = initial.rules.filter(rule => rule.id !== 'shopping-trendyol');
    initial.rules.push({ ...broad(), ...change });
    const result = matches('TRENDYOL YEMEK', mergeCategoryKeywordPack(initial).settings);
    expect(result.kind).toBe('suggestions');
    expect(result.suggestions.map(row => row.category)).toContain(change.category ?? 'Belanja');
    expect(result.suggestions.map(row => row.category)).toContain('Makan & minum');
  });

  it('keeps an additionalmanualgeneralrule authoritative as a conflict', () => {
    const initial = legacy();
    initial.rules.push({ id: 'manual-trendyol', keyword: 'TRENDYOL', category: 'Kategori pribadi', mode: 'auto' });
    expect(matches('TRENDYOL PLUS', mergeCategoryKeywordPack(initial).settings).suggestions.map(row => row.category)).toEqual(['Kategori pribadi','Langganan']);
    expect(matches('TRENDYOL PLUS', mergeCategoryKeywordPack(initial).settings).kind).toBe('suggestions');
  });

  it('does not suppressgeneralrulefor editedspecificrule or aninactive specifictarget', () => {
    const settings = effective();
    settings.rules.find(rule => rule.id === 'keyword-pack-trendyol-food')!.mode = 'suggest';
    expect(matches('TRENDYOL YEMEK', settings).kind).toBe('suggestions');
    expect(matches('TRENDYOL YEMEK', settings).suggestions.map(row => row.category)).toEqual(['Belanja','Makan & minum']);
    settings.names = settings.names.filter(name => name !== 'Makan & minum');
    expect(matches('TRENDYOL YEMEK', settings)).toMatchObject({ kind: 'suggestions', suggestions: [{ category: 'Belanja' }] });
  });

  it('retains conflict when two specific servicesappear inonedescription', () => {
    const result = matches('TRENDYOL YEMEK TRENDYOL MARKET');
    expect(result.kind).toBe('suggestions');
    expect(result.suggestions.map(row => row.category)).toEqual(['Makan & minum','Bahan makanan']);
  });

  it('avoids regressingknownYouTubePremium because of the newgenericGooglealias', () => {
    expect(matches('GOOGLE YOUTUBE PREMIUM')).toMatchObject({ kind: 'auto', suggestions: [{ category: 'Langganan' }] });
    const settings = effective();
    settings.rules.find(rule => rule.id === 'keyword-pack-youtube-generic')!.category = 'Kategori pribadi';
    expect(matches('GOOGLE YOUTUBE PREMIUM', settings).kind).toBe('suggestions');
    expect(matches('GOOGLE YOUTUBE PREMIUM', settings).suggestions.map(row => row.category)).toEqual(['Langganan','Kategori pribadi']);
  });
});

describe('pack automatic matches respect existing suggestion choices', () => {
  it('does not upgrade a broader manual HOP suggestion in the same category', () => {
    const initial = legacy();
    const manual: CategoryRule = { id: 'my-hop', keyword: 'HOP', category: 'Transportasi', mode: 'suggest' };
    initial.rules.push(manual);
    const expanded = mergeCategoryKeywordPack(initial).settings;
    const result = matches('POS HOP SCOOTER', expanded);
    expect(result.kind).toBe('suggestions');
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].category).toBe('Transportasi');
    expect(result.suggestions[0].reason).toContain('Pilihan saran');
    expect(expanded.rules.find(rule => rule.id === manual.id)).toEqual(manual);
  });

  it('protects a broader Google suggestion from the newly observed truncated Premium alias', () => {
    const initial = legacy();
    initial.rules.push({ id: 'my-google', keyword: 'GOOGLE', category: 'Langganan', mode: 'suggest' });
    const expanded = mergeCategoryKeywordPack(initial).settings;
    expect(matches('GOOGLE YOUTUBEPREMI', expanded).kind).toBe('suggestions');
    // The spaced Premium phrase already had an automatic rule before this pack.
    expect(matches('GOOGLE YOUTUBE PREMIUM', expanded)).toMatchObject({ kind: 'auto', suggestions: [{ category: 'Langganan' }] });
  });

  it('leaves the prior same-category automatic-plus-suggestion behavior unchanged', () => {
    const initial = legacy();
    initial.rules.push({ id: 'my-hop-suggestion', keyword: 'HOP', category: 'Transportasi', mode: 'suggest' },
      { id: 'my-hop-auto', keyword: 'HOP SCOOTER', category: 'Transportasi', mode: 'auto' });
    expect(matches('HOP SCOOTER', initial).kind).toBe('auto');
    expect(matches('HOP SCOOTER', mergeCategoryKeywordPack(initial).settings).kind).toBe('auto');
  });

  it.each([
    { id: 'keyword-pack-user-hop', keyword: 'HOP', category: 'Transportasi', mode: 'suggest' },
    { id: 'keyword-pack-hop-scoot', keyword: 'HOP', category: 'Transportasi', mode: 'suggest' },
  ] satisfies CategoryRule[])('recognizes edited or prefix-only identities as user rules: $id', manual => {
    const initial = legacy(); initial.rules.push(manual);
    const expanded = mergeCategoryKeywordPack(initial).settings;
    expect(matches('HOP SCOOTER', expanded).kind).toBe('suggestions');
    expect(expanded.rules.find(rule => rule.id === manual.id)).toEqual(manual);
  });

  it('treats a user-edited bundled automatic rule as an existing automatic choice', () => {
    const settings = effective();
    settings.rules.find(rule => rule.id === 'keyword-pack-hop-scooter')!.keyword = 'hop scooter';
    settings.rules.push({ id: 'my-hop-suggestion', keyword: 'HOP', category: 'Transportasi', mode: 'suggest' });
    expect(matches('HOP SCOOTER', settings).kind).toBe('auto');
  });

  it('keeps conflicts when an edited bundled target differs from another matching service', () => {
    const settings = effective();
    settings.rules.find(rule => rule.id === 'keyword-pack-hop-scooter')!.category = 'Kategori pribadi';
    const result = matches('HOP SCOOTER ESTRAM', settings);
    expect(result.kind).toBe('suggestions');
    expect(result.suggestions.map(row => row.category)).toEqual(['Kategori pribadi', 'Transportasi']);
  });

  it('does not turn the narrow Trendyol fix into a general longest-phrase priority', () => {
    const initial = legacy();
    initial.rules.push({ id: 'my-trendyol', keyword: 'TRENDYOL', category: 'Makan & minum', mode: 'suggest' });
    const result = matches('TRENDYOL YEMEK', mergeCategoryKeywordPack(initial).settings);
    expect(result.kind).toBe('suggestions');
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].reason).toContain('Pilihan saran');
  });
});
