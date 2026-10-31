import type { CategoryRule } from './categorization';

/** Exact public identities; edited copies are treated as user rules. */
export const BUNDLED_TRENDYOL_SERVICE_RULES: readonly CategoryRule[] = [
  { id: 'keyword-pack-trendyol-food', keyword: 'TRENDYOL YEMEK', category: 'Makan & minum', mode: 'auto' },
  { id: 'keyword-pack-trendyol-market', keyword: 'TRENDYOL MARKET', category: 'Bahan makanan', mode: 'auto' },
  { id: 'keyword-pack-trendyol-plus', keyword: 'TRENDYOL PLUS', category: 'Langganan', mode: 'auto' },
];
export const BUNDLED_GRATIS_RULE: CategoryRule = { id: 'keyword-pack-gratis', keyword: 'GRATIS', category: 'Perawatan diri', mode: 'auto' };
export const BUNDLED_GOOGLE_YOUTUBE_RULE: CategoryRule = { id: 'keyword-pack-youtube-generic', keyword: 'GOOGLE YOUTUBE', category: 'Hiburan', mode: 'suggest' };

/** Public merchant aliases only; no private references, branches, or people. */
export const KEYWORD_EXPANSION_RULES: readonly CategoryRule[] = [
  { id: 'keyword-pack-hop-scooter', keyword: 'HOP SCOOTER', category: 'Transportasi', mode: 'auto' },
  { id: 'keyword-pack-hop-scoot', keyword: 'HOP SCOOT', category: 'Transportasi', mode: 'auto' },
  { id: 'keyword-pack-estram', keyword: 'ESTRAM', category: 'Transportasi', mode: 'auto' },
  { id: 'keyword-pack-tcdd', keyword: 'TCDD TASIMACILIK', category: 'Transportasi', mode: 'auto' },
  { id: 'keyword-pack-avea-topup', keyword: 'AVEA WEB SITESI KONT', category: 'Internet & pulsa', mode: 'auto' },
  { id: 'keyword-pack-avea-bill', keyword: 'AVEA COM TR FATURA', category: 'Internet & pulsa', mode: 'auto' },
  { id: 'keyword-pack-youtube-premium', keyword: 'GOOGLE YOUTUBEPREMI', category: 'Langganan', mode: 'auto' },
  { id: 'keyword-pack-a101-alias', keyword: 'A-101', category: 'Bahan makanan', mode: 'auto' },
  { id: 'keyword-pack-cagri-market', keyword: 'CAGRI MARKET', category: 'Bahan makanan', mode: 'auto' },
  { id: 'keyword-pack-file-market', keyword: 'FILE MARKET', category: 'Bahan makanan', mode: 'auto' },
  { id: 'keyword-pack-cagdas-market', keyword: 'CAGDAS MARKET', category: 'Bahan makanan', mode: 'auto' },
  { id: 'keyword-pack-makbul', keyword: 'MAKBUL', category: 'Bahan makanan', mode: 'auto' },
  { id: 'keyword-pack-bank-commission', keyword: 'KOMISYON TUTARI', category: 'Biaya bank', mode: 'auto' },
  { id: 'keyword-pack-bank-tax', keyword: 'BSMV TUTARI', category: 'Biaya bank', mode: 'auto' },
  { id: 'keyword-pack-bank-message-fee', keyword: 'MESAJ UCRETI TUTARI', category: 'Biaya bank', mode: 'auto' },
  BUNDLED_GRATIS_RULE,
  { id: 'keyword-pack-watsons', keyword: 'WATSONS', category: 'Perawatan diri', mode: 'auto' },
  { id: 'keyword-pack-lc-waikiki', keyword: 'LC WAIKIKI', category: 'Pakaian', mode: 'auto' },
  { id: 'keyword-pack-university-fee', keyword: 'UNV HARC TAHSILATLARI', category: 'Pendidikan', mode: 'auto' },
  ...BUNDLED_TRENDYOL_SERVICE_RULES,
  { id: 'keyword-pack-yemekpay', keyword: 'YEMEKPAY', category: 'Makan & minum', mode: 'suggest' },
  { id: 'keyword-pack-yemek-sepet', keyword: 'YEMEK SEPET', category: 'Makan & minum', mode: 'suggest' },
  { id: 'keyword-pack-composite-delivery', keyword: 'UBERTRENDYOLGOGETIRY', category: 'Makan & minum', mode: 'suggest' },
  BUNDLED_GOOGLE_YOUTUBE_RULE,
];

/** User-confirmed bookkeeping labels. Old identities remain available so an
 * upgrade can distinguish an untouched bundled rule from a personal edit.
 */
export const CONFIRMED_CATEGORY_NAMES = ['Belanja online', 'Pembayaran Apple', 'Scooter'] as const;
/** These three newly introduced labels may already exist with a user's casing.
 * Do not generalize this to historical rule/category identity comparisons.
 */
export function equivalentConfirmedCategory(actual: string, canonical: string): boolean {
  return (CONFIRMED_CATEGORY_NAMES as readonly string[]).includes(canonical)
    ? actual.normalize('NFC').toLocaleLowerCase('id-ID') === canonical.normalize('NFC').toLocaleLowerCase('id-ID')
    : actual === canonical;
}
export function resolveConfirmedCategoryName(names: readonly string[], canonical: string): string | undefined {
  return names.find(name => equivalentConfirmedCategory(name, canonical));
}
const oldPackRule = (id: string): CategoryRule => KEYWORD_EXPANSION_RULES.find(rule => rule.id === id)!;
export const CONFIRMED_RULE_UPDATES: readonly { previous: CategoryRule; current: CategoryRule }[] = [
  { previous: { id: 'shopping-trendyol', keyword: 'TRENDYOL', category: 'Belanja', mode: 'suggest' },
    current: { id: 'shopping-trendyol', keyword: 'TRENDYOL', category: 'Belanja online', mode: 'auto' } },
  { previous: { id: 'subscription-apple', keyword: 'APPLE.COM/BILL', category: 'Langganan', mode: 'suggest' },
    current: { id: 'subscription-apple', keyword: 'APPLE.COM/BILL', category: 'Pembayaran Apple', mode: 'auto' } },
  { previous: oldPackRule('keyword-pack-hop-scooter'),
    current: { id: 'keyword-pack-hop-scooter', keyword: 'HOP SCOOTER', category: 'Scooter', mode: 'auto' } },
  { previous: oldPackRule('keyword-pack-hop-scoot'),
    current: { id: 'keyword-pack-hop-scoot', keyword: 'HOP SCOOT', category: 'Scooter', mode: 'auto' } },
  { previous: oldPackRule('keyword-pack-yemek-sepet'),
    current: { id: 'keyword-pack-yemek-sepet', keyword: 'YEMEK SEPET', category: 'Makan & minum', mode: 'auto' } },
  { previous: oldPackRule('keyword-pack-composite-delivery'),
    current: { id: 'keyword-pack-composite-delivery', keyword: 'UBERTRENDYOLGOGETIRY', category: 'Makan & minum', mode: 'auto' } },
  { previous: oldPackRule('keyword-pack-youtube-generic'),
    current: { id: 'keyword-pack-youtube-generic', keyword: 'GOOGLE YOUTUBE', category: 'Langganan', mode: 'auto' } },
];
export const CONFIRMED_ADDITIONAL_RULES: readonly CategoryRule[] = [
  { id: 'confirmed-apple-domain', keyword: 'APPLE.COM', category: 'Pembayaran Apple', mode: 'auto' },
  { id: 'confirmed-uber-eats-food', keyword: 'UBER EATS YEMEK', category: 'Makan & minum', mode: 'auto' },
  { id: 'confirmed-uber-eat-food', keyword: 'UBER EAT YEMEK', category: 'Makan & minum', mode: 'auto' },
  { id: 'confirmed-yemeksepeti', keyword: 'YEMEKSEPETI', category: 'Makan & minum', mode: 'auto' },
  { id: 'confirmed-yemek-sepeti', keyword: 'YEMEK SEPETI', category: 'Makan & minum', mode: 'auto' },
  { id: 'confirmed-composite-short-typo', keyword: 'UBERTRENYOLGOGETIR', category: 'Makan & minum', mode: 'auto' },
  { id: 'confirmed-composite-typo', keyword: 'UBERTRENYOLGOGETIRY', category: 'Makan & minum', mode: 'auto' },
];
export const CONFIRMED_CATEGORY_RULES: readonly CategoryRule[] = [
  ...CONFIRMED_RULE_UPDATES.map(update => update.current), ...CONFIRMED_ADDITIONAL_RULES,
];
export const CURRENT_KEYWORD_EXPANSION_RULES: readonly CategoryRule[] = [
  ...KEYWORD_EXPANSION_RULES.map(rule => CONFIRMED_RULE_UPDATES.find(update => update.previous.id === rule.id)?.current ?? rule),
  ...CONFIRMED_ADDITIONAL_RULES,
];
