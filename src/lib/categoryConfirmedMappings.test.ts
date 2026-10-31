import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORY_RULES, matchCategory, type CategoryRule } from './categorization';
import { mergeCategoryKeywordPack } from './categoryKeywordPack';
import { mergeConfirmedCategoryMappings, mergeCurrentCategoryKeywordPack } from './categoryConfirmedMappings';
import { CONFIRMED_ADDITIONAL_RULES, CONFIRMED_CATEGORY_NAMES, CONFIRMED_RULE_UPDATES, CURRENT_KEYWORD_EXPANSION_RULES } from './categoryKeywordDefinitions';
import { DEFAULT_CATEGORY_NAMES, type CategorySettings } from './categorySettings';
import { categorySuggestion } from './categorySuggestions';

const names = () => [...new Set([...DEFAULT_CATEGORY_NAMES, ...CONFIRMED_CATEGORY_NAMES, 'Pilihan pribadi'])];
const old = (): CategorySettings => mergeCategoryKeywordPack({ version: 1, names: names(), rules: DEFAULT_CATEGORY_RULES.map(rule => ({ ...rule })) }).settings;
const current = () => mergeConfirmedCategoryMappings(old()).settings;
const match = (text: string, settings = current()) => matchCategory(text, settings.rules, settings.names);

describe('confirmed mappings preserve settings edits', () => {
  it('updates only7exactoldrules andadds7newaliases without changing theinput orcategorynames', () => {
    const initial = old(), before = JSON.stringify(initial), result = mergeConfirmedCategoryMappings(initial);
    expect(result).toMatchObject({ added: 7, updated: 7, skipped: 0 });
    expect(result.settings.rules).toHaveLength(63);
    expect(result.settings.names).toBe(initial.names);
    expect(JSON.stringify(initial)).toBe(before);
    expect(DEFAULT_CATEGORY_RULES).toHaveLength(30);
  });

  it('isidempotent and doesnotresurrectdeletedoldrules', () => {
    const initial = current();
    expect(mergeConfirmedCategoryMappings(initial)).toEqual({ settings: initial, added: 0, updated: 0, skipped: 14 });
    const deleted = old(); deleted.rules = deleted.rules.filter(rule => !CONFIRMED_RULE_UPDATES.some(update => update.previous.id === rule.id));
    const result = mergeConfirmedCategoryMappings(deleted);
    expect(result.updated).toBe(0);
    expect(result.settings.rules.some(rule => CONFIRMED_RULE_UPDATES.some(update => update.previous.id === rule.id))).toBe(false);
  });

  it.each(['keyword', 'category', 'mode'] as const)('preservespersonaledits tooldbundled%s', field => {
    const initial = old();
    const modified = initial.rules.filter(rule => CONFIRMED_RULE_UPDATES.some(update => update.previous.id === rule.id));
    for (const rule of modified) {
      if (field === 'keyword') rule.keyword += ' PERSONAL';
      if (field === 'category') rule.category = 'Pilihan pribadi';
      if (field === 'mode') rule.mode = rule.mode === 'auto' ? 'suggest' : 'auto';
    }
    const result = mergeConfirmedCategoryMappings(initial);
    expect(result.updated).toBe(0);
    for (const rule of modified) expect(result.settings.rules.find(row => row.id === rule.id)).toBe(rule);
  });

  it('preservesexistingnormalizedalias choices andcollidingIDs', () => {
    const initial = old();
    const byKeyword: CategoryRule = { id: 'my-apple', keyword: 'apple-com', category: 'Pilihan pribadi', mode: 'suggest' };
    const byId: CategoryRule = { ...CONFIRMED_ADDITIONAL_RULES[1], keyword: 'MY UBER FOOD', category: 'Pilihan pribadi', mode: 'suggest' };
    initial.rules.push(byKeyword, byId);
    const result = mergeConfirmedCategoryMappings(initial);
    expect(result.added).toBe(5);
    expect(result.settings.rules.find(rule => rule.id === byKeyword.id)).toBe(byKeyword);
    expect(result.settings.rules.filter(rule => rule.id === byId.id)).toEqual([byId]);
    expect(result.settings.rules.some(rule => rule.id === 'confirmed-apple-domain')).toBe(false);
  });

  it('requiresactivetargetsanddoesnotaddorrenamecategories', () => {
    const initial = old(); initial.names = initial.names.filter(name => !CONFIRMED_CATEGORY_NAMES.includes(name as typeof CONFIRMED_CATEGORY_NAMES[number]));
    const result = mergeConfirmedCategoryMappings(initial);
    expect(result.settings.names).toEqual(initial.names);
    for (const id of ['shopping-trendyol', 'subscription-apple', 'keyword-pack-hop-scooter', 'keyword-pack-hop-scoot']) {
      expect(result.settings.rules.find(rule => rule.id === id)).toBe(initial.rules.find(rule => rule.id === id));
    }
    expect(result.settings.rules.some(rule => rule.id === 'confirmed-apple-domain')).toBe(false);
  });

  it('returnsdetachedupdatesandadditions', () => {
    const first = current(); first.rules.find(rule => rule.id === 'shopping-trendyol')!.category = 'Pilihan pribadi';
    first.rules.find(rule => rule.id === 'confirmed-apple-domain')!.keyword = 'DIFFERENT';
    expect(current().rules.find(rule => rule.id === 'shopping-trendyol')!.category).toBe('Belanja online');
    expect(current().rules.find(rule => rule.id === 'confirmed-apple-domain')!.keyword).toBe('APPLE.COM');
  });

  it('explicitcurrentpackactionneverbypassesremovednewcategorieswithv1labels', () => {
    const initial = current();
    initial.names = initial.names.filter(name => !['Scooter', 'Pembayaran Apple'].includes(name));
    initial.rules = initial.rules.filter(rule => !['Scooter', 'Pembayaran Apple'].includes(rule.category));
    const result = mergeCurrentCategoryKeywordPack(initial);
    expect(result.settings.names).toEqual(initial.names);
    expect(result.settings.rules.some(rule => rule.keyword.startsWith('HOP') || rule.keyword.startsWith('APPLE'))).toBe(false);
    expect(CURRENT_KEYWORD_EXPANSION_RULES).toHaveLength(33);
  });

  it('explicitcurrentpackactioncanreaddmissingcurrentrulebutpreservesmanualchoices', () => {
    const initial = current(); initial.rules = initial.rules.filter(rule => rule.id !== 'keyword-pack-hop-scooter');
    const result = mergeCurrentCategoryKeywordPack(initial);
    expect(result.added).toBe(1);
    expect(result.settings.rules.find(rule => rule.id === 'keyword-pack-hop-scooter')).toMatchObject({ category: 'Scooter' });
    expect(mergeCurrentCategoryKeywordPack(result.settings).settings).toBe(result.settings);
  });

  it('uses existing case-variant new category labels without renaming or adding names', () => {
    const initial = old();
    const labels: Record<string, string> = { 'Scooter': 'scooter', 'Belanja online': 'BELANJA ONLINE', 'Pembayaran Apple': 'pembayaran apple' };
    initial.names = initial.names.map(name => labels[name] ?? name);
    const before = JSON.stringify(initial.names), result = mergeConfirmedCategoryMappings(initial);
    expect(result).toMatchObject({ updated: 7, added: 7 });
    expect(JSON.stringify(result.settings.names)).toBe(before);
    expect(result.settings.rules.find(rule => rule.id === 'shopping-trendyol')!.category).toBe('BELANJA ONLINE');
    expect(result.settings.rules.find(rule => rule.id === 'subscription-apple')!.category).toBe('pembayaran apple');
    expect(result.settings.rules.find(rule => rule.id === 'keyword-pack-hop-scooter')!.category).toBe('scooter');
    expect(match('TRENDYOL YEMEK', result.settings)).toMatchObject({ kind: 'auto', suggestions: [{ category: 'Makan & minum' }] });
    expect(match('APPLE.COM/BILL', result.settings)).toMatchObject({ kind: 'auto', suggestions: [{ category: 'pembayaran apple' }] });
    expect(match('HOP SCOOTER', result.settings)).toMatchObject({ kind: 'auto', suggestions: [{ category: 'scooter' }] });
  });

  it('keeps broad manual suggestion protection for a resolved case-variant target', () => {
    const initial = old(); initial.names = initial.names.map(name => name === 'Scooter' ? 'scooter' : name);
    initial.rules.push({ id: 'my-hop-suggestion', keyword: 'HOP', category: 'scooter', mode: 'suggest' });
    const result = mergeConfirmedCategoryMappings(initial);
    expect(match('HOP SCOOTER', result.settings).kind).toBe('suggestions');
    expect(result.settings.rules.find(rule => rule.id === 'my-hop-suggestion')).toBe(initial.rules.at(-1));
  });

  it('does not loosen the raw legacy identity guard for a personally case-edited old category', () => {
    const initial = old(), rule = initial.rules.find(rule => rule.id === 'keyword-pack-hop-scooter')!;
    rule.category = 'TRANSPORTASI'; initial.names = initial.names.map(name => name === 'Transportasi' ? 'TRANSPORTASI' : name);
    const result = mergeConfirmedCategoryMappings(initial);
    expect(result.settings.rules.find(item => item.id === rule.id)).toBe(rule);
    expect(rule.category).toBe('TRANSPORTASI');
  });

  it('explicit current defaults resolve case variants and stay absent when the category is removed', () => {
    const initial = current(); initial.names = initial.names.map(name => name === 'Scooter' ? 'scooter' : name);
    initial.rules = initial.rules.filter(rule => !rule.keyword.startsWith('HOP'));
    const result = mergeCurrentCategoryKeywordPack(initial);
    expect(result.settings.rules.find(rule => rule.id === 'keyword-pack-hop-scooter')!.category).toBe('scooter');
    initial.names = initial.names.filter(name => name !== 'scooter');
    expect(mergeCurrentCategoryKeywordPack(initial).settings.rules.some(rule => rule.keyword.startsWith('HOP'))).toBe(false);
  });
});

describe('userconfirmedcategoryinterpretations', () => {
  it.each([
    ['TRENDYOL', 'Belanja online'], ['APPLE.COM', 'Pembayaran Apple'], ['APPLE.COM/BILL', 'Pembayaran Apple'],
    ['HOP SCOOTER', 'Scooter'], ['HOP SCOOT', 'Scooter'], ['UBERTRENDYOLGOGETIRY', 'Makan & minum'],
    ['UBERTRENYOLGOGETIR', 'Makan & minum'], ['UBERTRENYOLGOGETIRY', 'Makan & minum'],
    ['UBER EATS YEMEK', 'Makan & minum'], ['UBER EAT YEMEK', 'Makan & minum'],
    ['GOOGLE YOUTUBE', 'Langganan'], ['GOOGLE YOUTUBEPREMI', 'Langganan'], ['GOOGLE YOUTUBE PREMIUM', 'Langganan'],
    ['YEMEK SEPET', 'Makan & minum'], ['YEMEKSEPETI', 'Makan & minum'], ['YEMEK SEPETI', 'Makan & minum'],
  ])('maps%s to%s', (text, category) => {
    expect(match(`POS ${text}`)).toMatchObject({ kind: 'auto', suggestions: [{ category }] });
    expect(match(`POS ${text}`).suggestions).toHaveLength(1);
  });

  it.each([['TRENDYOL YEMEK','Makan & minum'], ['TRENDYOL MARKET','Bahan makanan'], ['TRENDYOL PLUS','Langganan']])('retainsnarrowTrendyolservice%s', (text, category) => {
    expect(match(text)).toMatchObject({ kind: 'auto', suggestions: [{ category }] });
  });

  it('keepsmultipleTrendyolservicesambiguousandbareUbernotfood', () => {
    expect(match('TRENDYOL YEMEK TRENDYOL MARKET').kind).toBe('suggestions');
    expect(match('UBER').kind).toBe('suggestions');
    expect(match('UBER').suggestions[0].category).toBe('Transportasi');
    expect(match('YEMEKPAY').kind).toBe('suggestions');
    expect(match('HOP').kind).toBe('none');
  });

  it.each(['REFUND APPLE.COM', 'HAVALE HOP SCOOTER', 'IADE TRENDYOL', 'ATM GOOGLE YOUTUBE'])('keepsrailorreturn%sasasuggestion', text => {
    expect(match(text).kind).toBe('suggestions');
  });

  it('keepsunreviewedtypesunconfirmedandskipsactualtransferrecords', () => {
    for (const text of ['TRENDYOL', 'APPLE.COM', 'YEMEKSEPETI', 'HOP SCOOTER', 'UBER EATS YEMEK']) {
      expect(categorySuggestion(text, 'unreviewed', current()).kind).toBe('suggestions');
      expect(categorySuggestion(text, 'transfer', current()).kind).toBe('none');
    }
  });

  it('keepsmanualgenericsuggestionsandconflictingtargetsactive', () => {
    for (const rule of [
      { id: 'my-hop', keyword: 'HOP', category: 'Scooter', mode: 'suggest' },
      { id: 'my-uber', keyword: 'UBER', category: 'Makan & minum', mode: 'suggest' },
      { id: 'my-trendyol', keyword: 'TRENDYOL', category: 'Makan & minum', mode: 'suggest' },
      { id: 'my-apple', keyword: 'APPLE', category: 'Pembayaran Apple', mode: 'suggest' },
      { id: 'my-google', keyword: 'GOOGLE', category: 'Langganan', mode: 'suggest' },
    ] satisfies CategoryRule[]) {
      const settings = current(); settings.rules.push(rule);
      const text = { 'my-hop': 'HOP SCOOTER', 'my-uber': 'UBER EATS YEMEK', 'my-trendyol': 'TRENDYOL YEMEK', 'my-apple': 'APPLE.COM', 'my-google': 'GOOGLE YOUTUBE' }[rule.id]!;
      expect(match(text, settings).kind).toBe('suggestions');
    }
  });

  it('doesnotbypassaneditedoriginalUberorTrendyolrule', () => {
    const uber = current(); uber.rules.find(rule => rule.id === 'transit-uber')!.category = 'Pilihan pribadi';
    expect(match('UBER EATS YEMEK', uber).kind).toBe('suggestions');
    const trendyol = current(); trendyol.rules.find(rule => rule.id === 'shopping-trendyol')!.category = 'Pilihan pribadi';
    expect(match('TRENDYOL YEMEK', trendyol).kind).toBe('suggestions');
  });

  it.each(['APPLE.COMMERCE', 'HOP SCOOTERX', 'YEMEKSEPETIX', 'UBERTRENYOLGOGETIRYX'])('doesnotloosenliteralboundariesfor%s', text => {
    expect(match(text).kind).toBe('none');
  });
});
