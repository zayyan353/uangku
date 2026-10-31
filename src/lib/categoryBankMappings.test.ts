import { describe, expect, it, vi } from 'vitest';
import { normalizeCategoryKeyword, type CategoryRule } from './categorization';
import type { CategorySettings } from './categorySettings';
import {
  BANK_ATM_DEPOSIT_RULES, BANK_ATM_WITHDRAWAL_RULE, BANK_CASHBACK_RULE, BANK_CATEGORY_NAMES,
  BANK_CATEGORY_RULES, BANK_ONLINE_FALLBACK_RULE, BANK_TRANSFER_FEE_RULES, BANK_TRANSFER_RULES,
  equivalentBankCategory, isBundledBankRule, mergeBankCategoryMappings, resolveBankCategoryName,
} from './categoryBankMappings';

const initial = (): CategorySettings => ({ version: 1, keywordPackVersion: 2,
  names: ['Belum dikategorikan', 'Biaya bank', 'Belanja online', ...BANK_CATEGORY_NAMES, 'Kategori pribadi'],
  rules: [{ id: 'mine', keyword: 'TOKO SAYA', category: 'Kategori pribadi', mode: 'suggest' }],
});

describe('bank category pack preserves configuration choices', () => {
  it('adds14annotational rules without changing category names, order, prior rules or the input', () => {
    const settings = initial(), before = JSON.stringify(settings);
    const result = mergeBankCategoryMappings(settings);
    expect(result).toMatchObject({ added: 14, updated: 0, skipped: 0 });
    expect(result.settings.names).toBe(settings.names);
    expect(result.settings.rules).toHaveLength(15);
    expect(result.settings.rules[0]).toBe(settings.rules[0]);
    expect(JSON.stringify(settings)).toBe(before);
    expect(result.settings.keywordPackVersion).toBe(2);
    expect(new Set(BANK_CATEGORY_RULES.map(rule => rule.id)).size).toBe(14);
  });

  it('works with frozen inputs and returns a fresh copy of every added rule', () => {
    const settings = initial();
    Object.freeze(settings.names); Object.freeze(settings.rules[0]); Object.freeze(settings.rules); Object.freeze(settings);
    const first = mergeBankCategoryMappings(settings), second = mergeBankCategoryMappings(settings);
    first.settings.rules[1].keyword = 'Changed only first detached output';
    expect(second.settings.rules[1].keyword).toBe(BANK_CATEGORY_RULES[0].keyword);
    expect(BANK_CATEGORY_RULES[0].keyword).toBe('ATM PARA ÇEKME');
  });

  it('isidempotent and preserves the applied settings object when nothing is added', () => {
    const settings = mergeBankCategoryMappings(initial()).settings;
    expect(mergeBankCategoryMappings(settings)).toEqual({ settings, added: 0, updated: 0, skipped: 14 });
  });

  it.each(BANK_CATEGORY_RULES)('preserves a personal rule for normalized keyword $keyword', builtin => {
    const settings = initial();
    const manual: CategoryRule = { id: 'personal-rule', keyword: normalizeCategoryKeyword(builtin.keyword).toUpperCase(),
      category: 'Kategori pribadi', mode: builtin.mode === 'auto' ? 'suggest' : 'auto' };
    settings.rules.push(manual);
    const result = mergeBankCategoryMappings(settings);
    expect(result.added).toBe(13);
    expect(result.settings.rules.find(rule => rule.id === manual.id)).toBe(manual);
    expect(result.settings.rules.some(rule => rule.id === builtin.id)).toBe(false);
  });

  it('does not replace colliding IDs even when their keyword and target were edited', () => {
    const settings = initial();
    const collision = { ...BANK_CASHBACK_RULE, keyword: 'MY CASHBACK', category: 'Kategori pribadi', mode: 'suggest' as const };
    settings.rules.push(collision);
    const result = mergeBankCategoryMappings(settings);
    expect(result.added).toBe(13);
    expect(result.settings.rules.filter(rule => rule.id === collision.id)).toEqual([collision]);
    expect(result.settings.rules.find(rule => rule.id === collision.id)).toBe(collision);
  });

  it.each(BANK_CATEGORY_NAMES)('doesnotresurrect removed category %s', removed => {
    const settings = initial(); settings.names = settings.names.filter(name => name !== removed);
    const before = JSON.stringify(settings.names), result = mergeBankCategoryMappings(settings);
    expect(JSON.stringify(result.settings.names)).toBe(before);
    expect(result.settings.rules.some(rule => rule.category === removed)).toBe(false);
    expect(result.skipped).toBe(BANK_CATEGORY_RULES.filter(rule => rule.category === removed).length);
  });

  it('keeps old targets inactive while reusing an approved online display-case label', () => {
    const settings = initial(); settings.names = settings.names.filter(name => !['Biaya bank', 'Belanja online'].includes(name));
    settings.names.push('biaya bank', 'BELANJA ONLINE');
    const result = mergeBankCategoryMappings(settings);
    expect(result.settings.names).toBe(settings.names);
    expect(result.skipped).toBe(3);
    expect(result.settings.rules.some(rule => rule.category === 'Biaya bank' || rule.category === 'Belanja online')).toBe(false);
  });

  it('reuses existing display labels for the four newly introduced categories', () => {
    const settings = initial(); settings.names = settings.names.map(name => BANK_CATEGORY_NAMES.includes(name as typeof BANK_CATEGORY_NAMES[number]) ? name.toLocaleUpperCase('id-ID') : name);
    const result = mergeBankCategoryMappings(settings);
    expect(result.added).toBe(14);
    for (const rule of result.settings.rules.slice(1)) {
      expect(settings.names).toContain(rule.category);
      if (BANK_CATEGORY_NAMES.some(name => equivalentBankCategory(rule.category, name))) expect(isBundledBankRule(rule)).toBe(true);
    }
    expect(result.settings.names).toBe(settings.names);
    expect(resolveBankCategoryName(settings.names, 'Cashback')).toBe('CASHBACK');
  });

  it('does not itself read or write browser storage or mutate a financial payload', () => {
    const getItem = vi.fn(), setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem, setItem });
    try {
      const financial = { version: 1, entries: [{ id: 'synthetic', amount: -100, type: 'unreviewed', category: '' }] };
      const before = JSON.stringify(financial);
      mergeBankCategoryMappings(initial());
      expect(getItem).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled();
      expect(JSON.stringify(financial)).toBe(before);
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('bank builtin identities expose only narrow priority exceptions', () => {
  it('keeps ATM and transfer annotations suggestions and fee/cashback/fallback modes explicit', () => {
    expect([BANK_ATM_WITHDRAWAL_RULE, ...BANK_ATM_DEPOSIT_RULES, ...BANK_TRANSFER_RULES].every(rule => rule.mode === 'suggest')).toBe(true);
    expect([...BANK_TRANSFER_FEE_RULES, BANK_CASHBACK_RULE, BANK_ONLINE_FALLBACK_RULE].every(rule => rule.mode === 'auto')).toBe(true);
    expect(BANK_TRANSFER_FEE_RULES.map(rule => rule.category)).toEqual(['Biaya bank', 'Biaya bank', 'Biaya bank']);
    expect(BANK_CASHBACK_RULE.category).toBe('Cashback');
    expect(BANK_ONLINE_FALLBACK_RULE.keyword).toBe('SANAL POS ALIŞVERİŞ');
  });

  it.each(['id', 'keyword', 'category', 'mode'] as const)('doesnotmistake a personally edited %s for an untouched builtin', field => {
    const rule = { ...BANK_ONLINE_FALLBACK_RULE };
    if (field === 'id') rule.id = 'my-fallback';
    if (field === 'keyword') rule.keyword = 'POS ALISVERIS';
    if (field === 'category') rule.category = 'Kategori pribadi';
    if (field === 'mode') rule.mode = 'suggest';
    expect(isBundledBankRule(rule)).toBe(false);
    expect(isBundledBankRule(rule, BANK_ONLINE_FALLBACK_RULE)).toBe(false);
  });

  it('recognizes exact identities and only the explicitly supported category display-case variants', () => {
    expect(BANK_CATEGORY_RULES.every(rule => isBundledBankRule({ ...rule }))).toBe(true);
    expect(isBundledBankRule({ ...BANK_CASHBACK_RULE, category: 'CASHBACK' }, BANK_CASHBACK_RULE)).toBe(true);
    expect(isBundledBankRule({ ...BANK_ONLINE_FALLBACK_RULE, category: 'BELANJA ONLINE' })).toBe(true);
    expect(equivalentBankCategory('TRANSFER', 'Transfer')).toBe(true);
    expect(equivalentBankCategory('biaya bank', 'Biaya bank')).toBe(false);
  });
});
