import type { CategoryRule } from './categorization';
import type { CategorySettings } from './categorySettings';
import { equivalentConfirmedCategory } from './categoryKeywordDefinitions';

/** Category annotations only. These rules never choose a cash wallet, create
 * transfer legs, or confirm income/expense. The caller owns interpretation,
 * fallback precedence, financial type guards, versioning and final validation.
 */
export const BANK_CATEGORY_NAMES = ['Tarik tunai', 'Setor tunai', 'Transfer', 'Cashback'] as const;

export const BANK_ATM_WITHDRAWAL_RULE: CategoryRule = {
  id: 'bank-v3-atm-withdrawal', keyword: 'ATM PARA ÇEKME', category: 'Tarik tunai', mode: 'suggest',
};
export const BANK_ATM_DEPOSIT_RULES: readonly CategoryRule[] = [
  { id: 'bank-v3-atm-deposit', keyword: 'ATM YATAN', category: 'Setor tunai', mode: 'suggest' },
  { id: 'bank-v3-atm-domestic-deposit', keyword: 'YURTİÇİ ATM P.Y.', category: 'Setor tunai', mode: 'suggest' },
  { id: 'bank-v3-atm-cash-deposit', keyword: 'ATM PARA YATIRMA', category: 'Setor tunai', mode: 'suggest' },
];
export const BANK_TRANSFER_RULES: readonly CategoryRule[] = [
  { id: 'bank-v3-havale', keyword: 'HAVALE', category: 'Transfer', mode: 'suggest' },
  { id: 'bank-v3-eft', keyword: 'EFT', category: 'Transfer', mode: 'suggest' },
  { id: 'bank-v3-fast', keyword: 'FAST', category: 'Transfer', mode: 'suggest' },
  { id: 'bank-v3-virman', keyword: 'VIRMAN', category: 'Transfer', mode: 'suggest' },
];
export const BANK_TRANSFER_FEE_RULES: readonly CategoryRule[] = [
  { id: 'bank-v3-havale-tax', keyword: 'BSMV TAHSİLATI', category: 'Biaya bank', mode: 'auto' },
  { id: 'bank-v3-havale-commission', keyword: 'KOMİSYONU TAHSİLATI', category: 'Biaya bank', mode: 'auto' },
  { id: 'bank-v3-havale-commission-short', keyword: 'KOMİSYON TAHSİLATI', category: 'Biaya bank', mode: 'auto' },
];
export const BANK_ONLINE_FALLBACK_RULE: CategoryRule = {
  id: 'bank-v3-online-fallback', keyword: 'SANAL POS ALIŞVERİŞ', category: 'Belanja online', mode: 'auto',
};
export const BANK_CASHBACK_RULE: CategoryRule = {
  id: 'bank-v3-prepaid-cashback', keyword: 'PREPAID İADE', category: 'Cashback', mode: 'auto',
};
export const BANK_CASHBACK_RULES: readonly CategoryRule[] = [
  BANK_CASHBACK_RULE,
  { id: 'bank-v3-prepaid-cashback-full', keyword: 'PREPAID İADESİ', category: 'Cashback', mode: 'auto' },
];
export const BANK_CATEGORY_RULES: readonly CategoryRule[] = [
  BANK_ATM_WITHDRAWAL_RULE, ...BANK_ATM_DEPOSIT_RULES, ...BANK_TRANSFER_RULES,
  ...BANK_TRANSFER_FEE_RULES, BANK_ONLINE_FALLBACK_RULE, ...BANK_CASHBACK_RULES,
];

/** Historical v3 identities above stay unchanged for non-destructive upgrades. */
export const BANK_AUTOMATIC_RULE_UPDATES: readonly { previous: CategoryRule; current: CategoryRule }[] =
  [BANK_ATM_WITHDRAWAL_RULE, ...BANK_ATM_DEPOSIT_RULES, ...BANK_TRANSFER_RULES]
    .map(previous => ({ previous, current: { ...previous, mode: 'auto' as const } }));
export const BANK_PREPAID_CREDIT_RULE: CategoryRule = {
  id: 'bank-v4-prepaid-credit', keyword: 'PREPAID', category: 'Cashback', mode: 'auto',
};
export const CURRENT_BANK_CATEGORY_RULES: readonly CategoryRule[] = [
  ...BANK_CATEGORY_RULES.map(rule => BANK_AUTOMATIC_RULE_UPDATES.find(update => update.previous.id === rule.id)?.current ?? rule),
  BANK_PREPAID_CREDIT_RULE,
];

/** v5 adds only operation-level fallbacks; specific and personal rules win. */
export const BANK_CARD_FALLBACK_RULES: readonly CategoryRule[] = [
  { id: 'bank-v5-card-purchase', keyword: 'POS ALIŞVERİŞ', category: 'Belanja', mode: 'auto' },
  { id: 'bank-v5-card-harcama', keyword: 'POS HARCAMA', category: 'Belanja', mode: 'auto' },
];
export const BANK_ATM_REFUND_RULE: CategoryRule = {
  id: 'bank-v5-atm-problem-refund', keyword: 'TAM ATM SORUNLU İŞLEM İADESİ', category: 'Pengembalian dana', mode: 'auto',
};
export const BANK_REVIEW_COMPLETION_RULES: readonly CategoryRule[] = [...BANK_CARD_FALLBACK_RULES, BANK_ATM_REFUND_RULE];

// Keep this definition independent of the matcher: the matcher may import the
// exact builtin identities below. Tests compare it to the shared normalization.
const normalizedKeyword = (value: string): string => value.normalize('NFKD').toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');

/** Reuse a personal display-case variant of the four new labels. Existing
 * categories outside this explicit set keep exact matching semantics.
 */
export function equivalentBankCategory(actual: string, canonical: string): boolean {
  return (BANK_CATEGORY_NAMES as readonly string[]).includes(canonical)
    ? actual.normalize('NFC').toLocaleLowerCase('id-ID') === canonical.normalize('NFC').toLocaleLowerCase('id-ID')
    : equivalentConfirmedCategory(actual, canonical);
}
export function resolveBankCategoryName(names: readonly string[], canonical: string): string | undefined {
  return names.find(name => equivalentBankCategory(name, canonical));
}

/** Only an untouched bundled rule is eligible for builtin priority exceptions.
 * A changed keyword, mode or target is an explicit personal rule.
 */
export function isBundledBankRule(rule: CategoryRule, original?: CategoryRule): boolean {
  const matches = (expected: CategoryRule): boolean => rule.id === expected.id && rule.keyword === expected.keyword
    && rule.mode === expected.mode && equivalentBankCategory(rule.category, expected.category);
  return original ? matches(original) : [...BANK_CATEGORY_RULES, ...CURRENT_BANK_CATEGORY_RULES, ...BANK_REVIEW_COMPLETION_RULES].some(matches);
}

/** Add missing active-target rules only. Never replace a personal keyword or
 * colliding ID, change category names, or mutate the original settings object.
 * The root migration must validate count/byte capacity atomically afterwards.
 */
export function mergeBankCategoryMappings(settings: CategorySettings): {
  settings: CategorySettings; added: number; updated: 0; skipped: number;
} {
  const ids = new Set(settings.rules.map(rule => rule.id));
  const keywords = new Set(settings.rules.map(rule => normalizedKeyword(rule.keyword)));
  const additions: CategoryRule[] = [];
  for (const rule of BANK_CATEGORY_RULES) {
    const category = resolveBankCategoryName(settings.names, rule.category);
    const keyword = normalizedKeyword(rule.keyword);
    if (!category || ids.has(rule.id) || keywords.has(keyword)) continue;
    additions.push({ ...rule, category }); ids.add(rule.id); keywords.add(keyword);
  }
  return {
    settings: additions.length ? { ...settings, rules: [...settings.rules, ...additions] } : settings,
    added: additions.length, updated: 0, skipped: BANK_CATEGORY_RULES.length - additions.length,
  };
}
