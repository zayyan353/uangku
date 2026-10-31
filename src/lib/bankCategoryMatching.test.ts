import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORY_RULES, matchCategory, type CategoryRule } from './categorization';
import { mergeCurrentCategoryKeywordPack } from './categoryConfirmedMappings';
import { DEFAULT_CATEGORY_NAMES, type CategorySettings } from './categorySettings';
import { categorySuggestion } from './categorySuggestions';
import {
  BANK_ATM_WITHDRAWAL_RULE, BANK_CASHBACK_RULE, BANK_CATEGORY_NAMES, BANK_ONLINE_FALLBACK_RULE,
  BANK_TRANSFER_FEE_RULES, BANK_TRANSFER_RULES, mergeBankCategoryMappings,
} from './categoryBankMappings';

function settings(): CategorySettings {
  const base: CategorySettings = { version: 1,
    names: [...new Set([...DEFAULT_CATEGORY_NAMES, ...BANK_CATEGORY_NAMES, 'Pilihan pribadi'])],
    rules: DEFAULT_CATEGORY_RULES.map(rule => ({ ...rule })),
  };
  return mergeBankCategoryMappings(mergeCurrentCategoryKeywordPack(base).settings).settings;
}
const match = (text: string, config = settings()) => matchCategory(text, config.rules, config.names);
const category = (text: string, config = settings()) => match(text, config).suggestions.map(row => row.category);
const without = (config: CategorySettings, id: string) => ({ ...config, rules: config.rules.filter(rule => rule.id !== id) });

describe('bank operation rules stay distinct from financial confirmation', () => {
  it('reuses an approved display-case online label without losing merchant precedence', () => {
    const base = settings();
    base.names = base.names.map(name => name === 'Belanja online' ? 'BELANJA ONLINE' : name);
    base.rules = base.rules.filter(rule => rule.id !== BANK_ONLINE_FALLBACK_RULE.id);
    const config = mergeBankCategoryMappings(base).settings;
    expect(config.names).toEqual(base.names);
    expect(match('SANAL POS ALISVERIS UNKNOWN SHOP', config)).toMatchObject({ kind: 'auto', suggestions: [{ category: 'BELANJA ONLINE' }] });
    expect(match('SANAL POS ALISVERIS TRENDYOL YEMEK', config)).toMatchObject({ kind: 'auto', suggestions: [{ category: 'Makan & minum' }] });
  });
  it.each([
    ['ATM PARA ÇEKME', 'Tarik tunai'],
    ['ATM YATAN', 'Setor tunai'],
    ['YURTİÇİ ATM P.Y.', 'Setor tunai'],
    ['ATM PARA YATIRMA', 'Setor tunai'],
    ['Referanslı Havale SENT TO SYNTHETIC PERSON', 'Transfer'],
    ['FAST SENT TO SYNTHETIC PERSON', 'Transfer'],
    ['EFT SENT TO SYNTHETIC PERSON', 'Transfer'],
    ['VIRMAN SENT TO SYNTHETIC PERSON', 'Transfer'],
  ])('suggests %s -> %s without converting the type', (text, expected) => {
    expect(match(text)).toMatchObject({ kind: 'suggestions' });
    expect(category(text)).toEqual([expected]);
    expect(categorySuggestion(text, 'unreviewed', settings()).kind).toBe('suggestions');
  });

  it.each([
    'Referanslı Havale BSMV Tahsilatı',
    'REFERANSLI HAVALE KOMISYONU TAHSILATI',
    'REFERANSLI HAVALE KOMISYON TAHSILATI',
    'EFT Komisyonu Tahsilatı',
    'FAST BSMV TAHSİLATI',
  ])('recognizes the fee suffix before the transfer label: %s', text => {
    expect(match(text)).toMatchObject({ kind: 'auto' });
    expect(category(text)).toEqual(['Biaya bank']);
    expect(categorySuggestion(text, 'expense', settings()).kind).toBe('auto');
    expect(categorySuggestion(text, 'unreviewed', settings()).kind).toBe('suggestions');
  });

  it('retains refund ambiguity on transfer fees and does not force a conflicting merchant category', () => {
    expect(match('Referansli Havale BSMV Tahsilati IADE').kind).toBe('suggestions');
    const result = match('MIGROS Referansli Havale BSMV Tahsilati');
    expect(result.kind).toBe('suggestions');
    expect(new Set(result.suggestions.map(row => row.category))).toEqual(new Set(['Bahan makanan', 'Biaya bank']));
  });

  it.each(['PREPAID İADE', 'PREPAID IADESI'])('uses Cashback for %s while unresolved credits still need review', text => {
    expect(match(text).kind).toBe('auto');
    expect(category(text)).toEqual(['Cashback']);
    expect(categorySuggestion(text, 'unreviewed', settings()).kind).toBe('suggestions');
    expect(categorySuggestion(text, 'income', settings()).kind).toBe('auto');
    expect(categorySuggestion(text, 'transfer', settings())).toEqual({ kind: 'none', suggestions: [] });
  });

  it('does not extend the cashback exception to generic refunds or other transfer indicators', () => {
    expect(match('IADE').kind).toBe('none');
    expect(match('PREPAID IADE REVERSAL').kind).toBe('suggestions');
    expect(match('PREPAID IADE HAVALE').kind).toBe('suggestions');
    expect(match('PREPAID IADE ATM').kind).toBe('suggestions');
  });

  it('keeps user rules literal while the bank builtins require an operation context', () => {
    expect(category('POS ALISVERIS ISYERI HAVALE CAFE')).toEqual([]);
    expect(category('POS ALISVERIS ISYERI SYNTHETIC PERSON')).toEqual([]);
    expect(category('ATM ALISVERIS SYNTHETIC SHOP')).toEqual([]);
    expect(category('BSMV TAHSILATI')).toEqual([]);
    const config = settings();
    config.rules.push({ id: 'my-havale', keyword: 'HAVALE', category: 'Pilihan pribadi', mode: 'auto' });
    expect(category('POS ALISVERIS ISYERI HAVALE CAFE', config)).toEqual(['Pilihan pribadi']);
    expect(match('POS ALISVERIS ISYERI HAVALE CAFE', config).kind).toBe('auto');
  });
});

describe('online purchase fallback respects specific and personal rules', () => {
  it.each([
    'SANAL POS ALIŞVERİŞ ISYERI UNKNOWN STORE',
    'SANAL POS ALISVERIS ISYERI S/GIB HARCLAR VERGI MUTABAKAT: SYNTHETIC',
    'SANAL POS ALISVERIS ISYERI FAST FOOD',
    'SANAL POS ALISVERIS ISYERI HAVALE CAFE',
    'SANAL POS ALISVERIS ISYERI SYNTHETIC PERSON',
    'SANAL POS ALISVERIS ISYERI ATM SHOP',
  ])('falls back to online shopping for %s', text => {
    expect(match(text).kind).toBe('auto');
    expect(category(text)).toEqual(['Belanja online']);
  });

  it.each([
    ['TRENDYOL YEMEK', 'Makan & minum'],
    ['TRENDYOL MARKET', 'Bahan makanan'],
    ['TRENDYOL PLUS', 'Langganan'],
    ['TRENDYOL', 'Belanja online'],
    ['APPLE.COM/BILL', 'Pembayaran Apple'],
    ['HOP SCOOTER', 'Scooter'],
    ['GOOGLE YOUTUBE', 'Langganan'],
    ['MIGROS', 'Bahan makanan'],
  ])('prefers specific merchant %s -> %s', (merchant, expected) => {
    const result = match(`SANAL POS ALISVERIS ISYERI ${merchant}`);
    expect(result.kind).toBe('auto');
    expect(result.suggestions.map(row => row.category)).toEqual([expected]);
    expect(result.suggestions.some(row => row.ruleId === BANK_ONLINE_FALLBACK_RULE.id)).toBe(false);
  });

  it('does not replace a known ambiguous merchant with a generic automatic fallback', () => {
    const result = match('SANAL POS ALISVERIS ISYERI YEMEKPAY');
    expect(result.kind).toBe('suggestions');
    expect(result.suggestions.map(row => row.category)).toEqual(['Makan & minum']);
    expect(result.suggestions.some(row => row.ruleId === BANK_ONLINE_FALLBACK_RULE.id)).toBe(false);
  });

  it('keeps manual matches and conflicts instead of injecting an online fallback', () => {
    const config = settings();
    config.rules.push({ id: 'my-unknown', keyword: 'UNKNOWN STORE', category: 'Pilihan pribadi', mode: 'suggest' });
    const result = match('SANAL POS ALISVERIS ISYERI UNKNOWN STORE', config);
    expect(result.kind).toBe('suggestions');
    expect(result.suggestions.map(row => row.category)).toEqual(['Pilihan pribadi']);
    config.rules.push({ id: 'my-conflict', keyword: 'UNKNOWN STORE', category: 'Kesehatan', mode: 'auto' });
    const conflict = match('SANAL POS ALISVERIS ISYERI UNKNOWN STORE', config);
    expect(conflict.kind).toBe('suggestions');
    expect(new Set(conflict.suggestions.map(row => row.category))).toEqual(new Set(['Pilihan pribadi', 'Kesehatan']));
  });

  it('does not silently discard an edited fallback rule', () => {
    const config = settings();
    config.rules = config.rules.map(rule => rule.id === BANK_ONLINE_FALLBACK_RULE.id ? { ...rule, category: 'Pilihan pribadi' } : rule);
    const result = match('SANAL POS ALISVERIS ISYERI MIGROS', config);
    expect(result.kind).toBe('suggestions');
    expect(new Set(result.suggestions.map(row => row.category))).toEqual(new Set(['Pilihan pribadi', 'Bahan makanan']));
  });

  it('keeps explicit manual fallback mode and archive/deletion choices', () => {
    const config = settings();
    config.rules = config.rules.map(rule => rule.id === BANK_ONLINE_FALLBACK_RULE.id ? { ...rule, mode: 'suggest' as const } : rule);
    expect(match('SANAL POS ALISVERIS UNKNOWN', config).kind).toBe('suggestions');
    expect(match('SANAL POS ALISVERIS UNKNOWN', without(config, BANK_ONLINE_FALLBACK_RULE.id)).kind).toBe('none');
    const archived = settings(); archived.names = archived.names.filter(name => name !== 'Belanja online');
    expect(match('SANAL POS ALISVERIS UNKNOWN', archived).kind).toBe('none');
    expect(category('SANAL POS ALISVERIS MIGROS', archived)).toEqual(['Bahan makanan']);
    const archivedMerchant = settings(); archivedMerchant.names = archivedMerchant.names.filter(name => name !== 'Bahan makanan');
    expect(category('SANAL POS ALISVERIS MIGROS', archivedMerchant)).toEqual(['Belanja online']);
  });

  it('does not apply online fallback to ordinary POS and keeps real refunds ambiguous', () => {
    expect(match('POS ALISVERIS UNKNOWN').kind).toBe('none');
    expect(match('SANAL POS ALISVERIS UNKNOWN IADE').kind).toBe('suggestions');
    expect(match('SANAL POS ALISVERIS UNKNOWN IPTAL').kind).toBe('suggestions');
    expect(match('POS HARCAMA MIGROS ATM').kind).toBe('auto');
    expect(match('POS HARCAMA MIGROS IADE').kind).toBe('suggestions');
  });
});

describe('new bank defaults never upgrade a personal suggestion', () => {
  it.each([
    ['SANAL POS ALISVERIS UNKNOWN', 'SANAL POS', 'Belanja online'],
    ['Referansli Havale BSMV Tahsilati', 'HAVALE', 'Biaya bank'],
    ['PREPAID IADE', 'PREPAID', 'Cashback'],
  ])('preserves manual suggestion mode for %s', (text, keyword, target) => {
    const config = settings();
    config.rules.push({ id: 'personal-broad', keyword, category: target, mode: 'suggest' });
    expect(match(text, config).kind).toBe('suggestions');
    expect(category(text, config)).toEqual([target]);
  });

  it('preserves explicit user automatic rules and personally edited bank identities', () => {
    const config = settings();
    const manual: CategoryRule = { ...BANK_TRANSFER_RULES[0], category: 'Pilihan pribadi', mode: 'auto' };
    config.rules = config.rules.map(rule => rule.id === manual.id ? manual : rule);
    // Transfer wording remains ambiguous even when a user selects an automatic rule.
    expect(match('REFERANSLI HAVALE PERSON', config).kind).toBe('suggestions');
    expect(category('REFERANSLI HAVALE PERSON', config)).toEqual(['Pilihan pribadi']);
    const fee = { ...BANK_TRANSFER_FEE_RULES[0], category: 'Pilihan pribadi' };
    config.rules = config.rules.map(rule => rule.id === fee.id ? fee : rule);
    expect(match('REFERANSLI HAVALE BSMV TAHSILATI', config).kind).toBe('suggestions');
    expect(config.rules.find(rule => rule.id === manual.id)).toBe(manual);
  });

  it('recognizes new bank category display-case variants without altering their labels', () => {
    const config = settings();
    config.names = config.names.map(name => name === 'Cashback' ? 'CASHBACK' : name === 'Tarik tunai' ? 'TARIK TUNAI' : name);
    config.rules = config.rules.map(rule => rule.id === BANK_CASHBACK_RULE.id ? { ...rule, category: 'CASHBACK' }
      : rule.id === BANK_ATM_WITHDRAWAL_RULE.id ? { ...rule, category: 'TARIK TUNAI' } : rule);
    expect(match('PREPAID IADE', config)).toMatchObject({ kind: 'auto' });
    expect(category('PREPAID IADE', config)).toEqual(['CASHBACK']);
    expect(category('ATM PARA CEKME', config)).toEqual(['TARIK TUNAI']);
  });
});
