import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORY_RULES, createCategoryMatcher, matchCategory, type CategoryRule } from './categorization';

const categories = ['Bahan makanan', 'Makan & minum', 'Transportasi', 'Kesehatan', 'Langganan', 'Internet & pulsa', 'Belanja', 'Kategori sendiri'];
const rule = (keyword: string, category = 'Kategori sendiri', mode: CategoryRule['mode'] = 'auto'): CategoryRule => ({ id: `custom:${keyword}:${category}`, keyword, category, mode });

describe('literal local categorization', () => {
  it.each(['POS HARCAMA BİM ŞUBE 123', 'pos harcama bim sube 123', 'POS/BIM*SUBE', 'BıM', 'BİM\u00a0MAĞAZA'])('recognizes Turkish case, accents and punctuation: %s', text => {
    const result = matchCategory(text, DEFAULT_CATEGORY_RULES, categories);
    expect(result.kind).toBe('auto');
    expect(result.suggestions.map(item => item.category)).toEqual(['Bahan makanan']);
  });

  it.each(['POS A1010 MARKET', 'STARBUCKSCOFFEE', 'KAHVE DUNYASINDA', 'ESKARTAL', 'BIMBINGAN', 'CARREFOURSAX'])('does not match inside longer words or reference numbers: %s', text => {
    expect(matchCategory(text, DEFAULT_CATEGORY_RULES, categories)).toEqual({ kind: 'none', suggestions: [] });
  });

  it.each([
    ['MİGROS', 'Bahan makanan'], ['ŞOK', 'Bahan makanan'], ['A101', 'Bahan makanan'],
    ['ALFAMART', 'Bahan makanan'], ['INDOMARET', 'Bahan makanan'],
    ['KAHVE DÜNYASI', 'Makan & minum'], ['BURGER KING', 'Makan & minum'],
    ['İSTANBULKART', 'Transportasi'], ['ESKART', 'Transportasi'],
    ['DENEME ECZANESİ', 'Kesehatan'], ['APOTEK CONTOH', 'Kesehatan'],
    ['NETFLIX', 'Langganan'], ['SPOTIFY', 'Langganan'], ['YOUTUBE PREMIUM', 'Langganan'],
  ])('uses explicit merchant rules for %s', (text, category) => {
    const result = matchCategory(`POS ${text} 12345`, DEFAULT_CATEGORY_RULES, categories);
    expect(result.kind).toBe('auto');
    expect(result.suggestions.every(item => item.category === category)).toBe(true);
  });

  it.each(['TRENDYOL', 'TOKOPEDIA', 'SHOPEE', 'HEPSİBURADA', 'UBER', 'GOJEK', 'GRAB', 'TURKCELL', 'VODAFONE', 'TÜRK TELEKOM', 'TELKOMSEL', 'APPLE.COM/BILL'])('leaves multi-purpose merchant %s as a suggestion', text => {
    const result = matchCategory(text, DEFAULT_CATEGORY_RULES, categories);
    expect(result.kind).toBe('suggestions');
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it.each(['FAST', 'HAVALE', 'EFT', 'TRANSFER', 'VİRMAN', 'NAKİT', 'ATM', 'BANKAMATİK', 'DÖVİZ', 'PARA ÇEKME', 'İADE', 'İADESİ', 'REFUND', 'REVERSAL', 'TOP-UP', 'TARIK TUNAI'])('downgrades otherwise strong matches in ambiguous %s text', rail => {
    const result = matchCategory(`${rail} MİGROS`, DEFAULT_CATEGORY_RULES, categories);
    expect(result.kind).toBe('suggestions');
    expect(result.suggestions[0].reason).toContain('perlu diperiksa');
  });

  it('does not block a merchant merely containing a rail substring', () => {
    expect(matchCategory('BREAKFAST CAFE', [rule('BREAKFAST CAFE')], categories).kind).toBe('auto');
    expect(matchCategory('LEFT SHOP', [rule('LEFT SHOP')], categories).kind).toBe('auto');
  });

  it('never invents categories from generic bank/card/payment text', () => {
    for (const text of ['POS', 'KART', 'ZİRAAT', 'ÖDEME', 'ONLINE ÖDEME', 'FAST 123456', '']) {
      expect(matchCategory(text, DEFAULT_CATEGORY_RULES, categories).kind).toBe('none');
    }
    expect(matchCategory('POS KART', [rule('POS'), rule('KART')], categories).kind).toBe('none');
  });

  it('treats punctuation in custom keywords literally, with normalized separators, not as regex', () => {
    expect(matchCategory('CONTOH TOKO', [rule('.*')], categories).kind).toBe('none');
    expect(matchCategory('TOKO X Y', [rule('X|Y')], categories).kind).toBe('auto');
    expect(matchCategory('TOKO X', [rule('X|Y')], categories).kind).toBe('none');
    expect(matchCategory('TOKO [LANGGANAN]', [rule('[LANGGANAN]')], categories).kind).toBe('auto');
  });

  it('requires a complete phrase and tolerates repeated whitespace', () => {
    const rules = [rule('Toko\t\n Sendiri')];
    expect(matchCategory('TOKO   SENDIRI CABANG', rules, categories).kind).toBe('auto');
    expect(matchCategory('TOKO YANG SENDIRI', rules, categories).kind).toBe('none');
  });

  it('returns suggestions for conflicting categories, including auto plus suggest', () => {
    const rules = [rule('TOKO', 'Belanja'), rule('TOKO SENDIRI', 'Kategori sendiri', 'suggest')];
    const result = matchCategory('TOKO SENDIRI', rules, categories);
    expect(result.kind).toBe('suggestions');
    expect(result.suggestions.map(item => item.category)).toEqual(['Belanja', 'Kategori sendiri']);
    expect(matchCategory('TOKO SENDIRI', [...rules].reverse(), categories).kind).toBe('suggestions');
  });

  it('does not create a category conflict from two rules agreeing on the same category', () => {
    const first = rule('TOKO'), second = rule('TOKO SENDIRI', 'Kategori sendiri', 'suggest');
    const result = matchCategory('TOKO SENDIRI', [first, second], categories);
    expect(result.kind).toBe('auto');
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toMatchObject({ category: 'Kategori sendiri', ruleId: first.id });
    expect(result.suggestions[0].reason).toContain('“TOKO”');
    expect(result.suggestions[0].reason).toContain('“TOKO SENDIRI”');
  });

  it('ignores inactive category targets and placeholder category rules', () => {
    expect(matchCategory('MIGROS', DEFAULT_CATEGORY_RULES, categories.filter(value => value !== 'Bahan makanan')).kind).toBe('none');
    expect(matchCategory('TOKO', [rule('TOKO', 'Belum dikategorikan')], ['Belum dikategorikan']).kind).toBe('none');
    expect(matchCategory('TOKO', [rule('TOKO')], []).kind).toBe('none');
  });

  it('supports an explicit user auto rule without bypassing transfer/return ambiguity', () => {
    const rules = [rule('WARUNG CONTOH')];
    expect(matchCategory('WARUNG CONTOH', rules, categories).kind).toBe('auto');
    expect(matchCategory('REFUND WARUNG CONTOH', rules, categories).kind).toBe('suggestions');
  });

  it('is deterministic, preserves source inputs and does not add transaction fields', () => {
    const text = ' POS HARCAMA MİGROS — 12345 ';
    const rules = Object.freeze(DEFAULT_CATEGORY_RULES.map(item => Object.freeze({ ...item })));
    const active = Object.freeze([...categories]);
    const before = JSON.stringify({ text, rules, active });
    const first = matchCategory(text, rules, active);
    expect(matchCategory(text, rules, active)).toEqual(first);
    expect(JSON.stringify({ text, rules, active })).toBe(before);
    expect(Object.keys(first).sort()).toEqual(['kind', 'suggestions']);
    expect(Object.keys(first.suggestions[0]).sort()).toEqual(['category', 'reason', 'ruleId']);
  });

  it('keeps all default rule IDs unique and avoids generic card/rail-only defaults', () => {
    expect(new Set(DEFAULT_CATEGORY_RULES.map(item => item.id)).size).toBe(DEFAULT_CATEGORY_RULES.length);
    expect(DEFAULT_CATEGORY_RULES.every(item => item.keyword.trim() && item.category.trim())).toBe(true);
    expect(matchCategory('POS KART FAST HAVALE EFT TRANSFER IADE REFUND', DEFAULT_CATEGORY_RULES, categories).kind).toBe('none');
  });
});

describe('compiled matching for a whole import/history batch', () => {
  it.each(['POS MİGROS', 'POS A1010', 'NETFLIX', 'EFT MİGROS', 'ATM MİGROS',
    'TÜRK TELEKOM', 'TOKO SENDIRI', 'TOKO SENDIRI MIGROS', '', 'UNKNOWN MERCHANT'])('agrees with one-off matching for %j', text => {
    const rules = [...DEFAULT_CATEGORY_RULES, rule('TOKO SENDIRI')];
    const matcher = createCategoryMatcher(rules, categories);
    expect(matcher(text)).toEqual(matchCategory(text, rules, categories));
  });

  it('captures normalized rules and active targets once rather than re-reading them per row', () => {
    let reads = 0;
    const custom: CategoryRule = { id: 'custom', get keyword() { reads++; return 'TOKO SENDIRI'; }, category: 'Kategori sendiri', mode: 'auto' };
    const matcher = createCategoryMatcher([custom], categories);
    const initialReads = reads;
    expect(initialReads).toBeGreaterThan(0);
    for (let index = 0; index < 1000; index++) {
      expect(matcher(`TOKO SENDIRI REF ${index}`).kind).toBe('auto');
    }
    expect(reads).toBe(initialReads);
  });

  it('keeps its settings snapshot stable and returns fresh results for each row', () => {
    const custom = rule('TOKO SENDIRI'), active = [...categories], rules = [custom];
    const matcher = createCategoryMatcher(rules, active);
    custom.keyword = 'CHANGED STORE';
    custom.category = 'Belanja';
    active.length = 0;
    rules.length = 0;
    const first = matcher('TOKO SENDIRI');
    expect(first.kind).toBe('auto');
    expect(first.suggestions[0].category).toBe('Kategori sendiri');
    first.suggestions[0].category = 'Mutated output';
    expect(matcher('TOKO SENDIRI').suggestions[0].category).toBe('Kategori sendiri');
    expect(matcher('CHANGED STORE').kind).toBe('none');
  });

  it('deduplicates categories while retaining all matched reasons and original first rule identity', () => {
    const rules = [rule('TOKO', 'Belanja', 'suggest'), rule('TOKO SENDIRI', 'Belanja'), rule('SENDIRI')];
    const result = createCategoryMatcher(rules, categories)('TOKO SENDIRI');
    expect(result.kind).toBe('suggestions');
    expect(result.suggestions.map(item => item.category)).toEqual(['Belanja', 'Kategori sendiri']);
    expect(result.suggestions[0].ruleId).toBe(rules[0].id);
    expect(result.suggestions[0].reason).toContain('“TOKO”');
    expect(result.suggestions[0].reason).toContain('“TOKO SENDIRI”');
  });
});
