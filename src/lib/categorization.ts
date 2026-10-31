import { BUNDLED_GOOGLE_YOUTUBE_RULE, BUNDLED_GRATIS_RULE, BUNDLED_TRENDYOL_SERVICE_RULES, CONFIRMED_CATEGORY_RULES, KEYWORD_EXPANSION_RULES, equivalentConfirmedCategory } from './categoryKeywordDefinitions';
import { interpretBankDescription, normalizeBankDescription, type BankDescriptionKind, type BankDescriptionContext } from './bankDescription';
import { BANK_ATM_DEPOSIT_RULES, BANK_ATM_WITHDRAWAL_RULE, BANK_AUTOMATIC_RULE_UPDATES, BANK_CASHBACK_RULES, BANK_PREPAID_CREDIT_RULE, BANK_ONLINE_FALLBACK_RULE, BANK_TRANSFER_FEE_RULES, BANK_TRANSFER_RULES, BANK_CARD_FALLBACK_RULES, BANK_ATM_REFUND_RULE, isBundledBankRule } from './categoryBankMappings';
export { BUNDLED_GOOGLE_YOUTUBE_RULE, BUNDLED_GRATIS_RULE, BUNDLED_TRENDYOL_SERVICE_RULES } from './categoryKeywordDefinitions';

/** Optional local text rules. A match never changes a transaction's financial type. */
export interface CategoryRule {
  id: string;
  keyword: string;
  category: string;
  mode: 'auto' | 'suggest';
}

export interface CategoryMatch {
  kind: 'auto' | 'suggestions' | 'none';
  suggestions: Array<{ category: string; reason: string; ruleId: string }>;
}

/** These editable examples describe a typical purchase, not every merchant's goods. */
export const DEFAULT_CATEGORY_RULES: readonly CategoryRule[] = [
  { id: 'grocery-bim', keyword: 'BİM', category: 'Bahan makanan', mode: 'auto' },
  { id: 'grocery-a101', keyword: 'A101', category: 'Bahan makanan', mode: 'auto' },
  { id: 'grocery-sok', keyword: 'ŞOK', category: 'Bahan makanan', mode: 'auto' },
  { id: 'grocery-migros', keyword: 'MİGROS', category: 'Bahan makanan', mode: 'auto' },
  { id: 'grocery-carrefoursa', keyword: 'CARREFOURSA', category: 'Bahan makanan', mode: 'auto' },
  { id: 'grocery-alfamart', keyword: 'ALFAMART', category: 'Bahan makanan', mode: 'auto' },
  { id: 'grocery-indomaret', keyword: 'INDOMARET', category: 'Bahan makanan', mode: 'auto' },
  { id: 'food-starbucks', keyword: 'STARBUCKS', category: 'Makan & minum', mode: 'auto' },
  { id: 'food-kahve-dunyasi', keyword: 'KAHVE DÜNYASI', category: 'Makan & minum', mode: 'auto' },
  { id: 'food-burger-king', keyword: 'BURGER KING', category: 'Makan & minum', mode: 'auto' },
  { id: 'food-mcdonalds', keyword: 'MCDONALDS', category: 'Makan & minum', mode: 'auto' },
  { id: 'transit-eskart', keyword: 'ESKART', category: 'Transportasi', mode: 'auto' },
  { id: 'transit-istanbulkart', keyword: 'İSTANBULKART', category: 'Transportasi', mode: 'auto' },
  { id: 'transit-uber', keyword: 'UBER', category: 'Transportasi', mode: 'suggest' },
  { id: 'transit-gojek', keyword: 'GOJEK', category: 'Transportasi', mode: 'suggest' },
  { id: 'transit-grab', keyword: 'GRAB', category: 'Transportasi', mode: 'suggest' },
  { id: 'health-eczane', keyword: 'ECZANESİ', category: 'Kesehatan', mode: 'auto' },
  { id: 'health-apotek', keyword: 'APOTEK', category: 'Kesehatan', mode: 'auto' },
  { id: 'subscription-netflix', keyword: 'NETFLIX', category: 'Langganan', mode: 'auto' },
  { id: 'subscription-spotify', keyword: 'SPOTIFY', category: 'Langganan', mode: 'auto' },
  { id: 'subscription-youtube', keyword: 'YOUTUBE PREMIUM', category: 'Langganan', mode: 'auto' },
  { id: 'subscription-apple', keyword: 'APPLE.COM/BILL', category: 'Langganan', mode: 'suggest' },
  { id: 'telecom-turkcell', keyword: 'TURKCELL', category: 'Internet & pulsa', mode: 'suggest' },
  { id: 'telecom-vodafone', keyword: 'VODAFONE', category: 'Internet & pulsa', mode: 'suggest' },
  { id: 'telecom-turk-telekom', keyword: 'TÜRK TELEKOM', category: 'Internet & pulsa', mode: 'suggest' },
  { id: 'telecom-telkomsel', keyword: 'TELKOMSEL', category: 'Internet & pulsa', mode: 'suggest' },
  { id: 'shopping-trendyol', keyword: 'TRENDYOL', category: 'Belanja', mode: 'suggest' },
  { id: 'shopping-hepsiburada', keyword: 'HEPSİBURADA', category: 'Belanja', mode: 'suggest' },
  { id: 'shopping-tokopedia', keyword: 'TOKOPEDIA', category: 'Belanja', mode: 'suggest' },
  { id: 'shopping-shopee', keyword: 'SHOPEE', category: 'Belanja', mode: 'suggest' },
];

/** Shared literal normalization for matching and non-destructive pack merging. */
export function normalizeCategoryKeyword(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase('tr-TR').replace(/ı/g, 'i')
    .replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

const originalTrendyolRule = { id: 'shopping-trendyol', keyword: 'TRENDYOL', category: 'Belanja', mode: 'suggest' } as const;
const originalYouTubePremiumRule = { id: 'subscription-youtube', keyword: 'YOUTUBE PREMIUM', category: 'Langganan', mode: 'auto' } as const;
const originalUberRule = { id: 'transit-uber', keyword: 'UBER', category: 'Transportasi', mode: 'suggest' } as const;
const confirmedTrendyolRule = CONFIRMED_CATEGORY_RULES.find(rule => rule.id === 'shopping-trendyol')!;
const exactRule = (rule: CategoryRule, original: CategoryRule): boolean =>
  rule.id === original.id && rule.keyword === original.keyword && rule.category === original.category && rule.mode === original.mode;
const bundledRule = (rule: CategoryRule, original: CategoryRule): boolean =>
  CONFIRMED_CATEGORY_RULES.includes(original)
    ? rule.id === original.id && rule.keyword === original.keyword && equivalentConfirmedCategory(rule.category, original.category) && rule.mode === original.mode
    : exactRule(rule, original);
const expansionById = new Map<string, CategoryRule[]>();
for (const rule of [...KEYWORD_EXPANSION_RULES, ...CONFIRMED_CATEGORY_RULES]) {
  const originals = expansionById.get(rule.id) ?? [];
  originals.push(rule); expansionById.set(rule.id, originals);
}

// A payment rail, return or cash movement says too little about spending purpose.
const AMBIGUOUS_PHRASES = [
  'fast', 'havale', 'eft', 'transfer', 'virman', 'nakit', 'atm', 'bankamatik', 'doviz', 'kambiyo',
  'para cek', 'para cekme', 'para yatirma', 'cash withdrawal', 'cash deposit',
  'tarik tunai', 'setor tunai', 'top up', 'topup', 'withdrawal',
  'iade', 'iadesi', 'refund', 'reversal', 'iptal', 'iptali',
];

const AMBIGUOUS_MATCHES = AMBIGUOUS_PHRASES.map(phrase => ` ${phrase} `);
const BANK_RAIL_PHRASES = new Set(['fast', 'havale', 'eft', 'transfer', 'virman']);
const REFUND_PHRASES = new Set(['iade', 'iadesi', 'refund', 'reversal', 'iptal', 'iptali']);
function bundledBankKind(rule: CategoryRule): BankDescriptionKind | undefined {
  const currentOrPrevious = (original: CategoryRule): boolean => isBundledBankRule(rule, original)
    || BANK_AUTOMATIC_RULE_UPDATES.some(update => update.previous.id === original.id && isBundledBankRule(rule, update.current));
  if (currentOrPrevious(BANK_ATM_WITHDRAWAL_RULE)) return 'atm-withdrawal';
  if (BANK_ATM_DEPOSIT_RULES.some(currentOrPrevious)) return 'atm-deposit';
  if (BANK_TRANSFER_RULES.some(currentOrPrevious)) return 'bank-transfer';
  if (BANK_TRANSFER_FEE_RULES.some(original => isBundledBankRule(rule, original))) return 'transfer-fee';
  if (BANK_CASHBACK_RULES.some(original => isBundledBankRule(rule, original)) || isBundledBankRule(rule, BANK_PREPAID_CREDIT_RULE)) return 'cashback';
  if (isBundledBankRule(rule, BANK_ONLINE_FALLBACK_RULE)) return 'online-purchase';
  if (BANK_CARD_FALLBACK_RULES.some(original => isBundledBankRule(rule, original))) return 'card-purchase';
  if (isBundledBankRule(rule, BANK_ATM_REFUND_RULE)) return 'atm-refund';
  return undefined;
}

/**
 * Pure literal matcher: source selection, existing-category preservation and
 * transfer/adjustment guards belong to the caller. No storage or ledger writes.
 */
export function createCategoryMatcher(rules: readonly CategoryRule[], activeCategories: readonly string[]): (text: string, context?: BankDescriptionContext) => CategoryMatch {
  const active = new Set(activeCategories);
  const compiled = rules.flatMap(rule => {
    if (!active.has(rule.category) || rule.category === 'Belum dikategorikan') return [];
    const phrase = normalizeCategoryKeyword(rule.keyword);
    const expansionOriginals = expansionById.get(rule.id) ?? [];
    const bankKind = bundledBankKind(rule);
    return !phrase || phrase === 'pos' || phrase === 'kart' ? [] : [{ ...rule, phrase: ` ${phrase} `,
      untouchedExpansion: expansionOriginals.some(original => bundledRule(rule, original)) || isBundledBankRule(rule),
      bankKind,
      originalDefault: DEFAULT_CATEGORY_RULES.some(original => exactRule(rule, original)),
      prepaidCreditOnly: isBundledBankRule(rule, BANK_PREPAID_CREDIT_RULE),
      originalTrendyol: exactRule(rule, originalTrendyolRule) || bundledRule(rule, confirmedTrendyolRule),
      trendyolService: BUNDLED_TRENDYOL_SERVICE_RULES.some(original => exactRule(rule, original)),
      gratisMerchantOnly: exactRule(rule, BUNDLED_GRATIS_RULE),
      genericGoogleYouTube: exactRule(rule, BUNDLED_GOOGLE_YOUTUBE_RULE),
      originalYouTubePremium: exactRule(rule, originalYouTubePremiumRule),
      originalUber: exactRule(rule, originalUberRule),
      confirmedUberFood: CONFIRMED_CATEGORY_RULES.some(original => original.keyword.startsWith('UBER') && original.category === 'Makan & minum' && exactRule(rule, original)),
    }];
  });
  return (text, context = {}) => {
    const normalizedText = normalizeBankDescription(text);
    if (!normalizedText) return { kind: 'none', suggestions: [] };
    const bank = interpretBankDescription(text, context);
    const input = ` ${normalizedText} `;
    let matched = compiled.filter(rule => input.includes(rule.phrase)
      // Indonesian "gratis" means free. Only this untouched bundled rule
      // requires the bank's merchant label; explicit user rules stay literal.
      && (!rule.gratisMerchantOnly || input.includes(' isyeri gratis '))
      && (!rule.bankKind || rule.bankKind === bank.kind)
      && (!rule.prepaidCreditOnly || Number.isSafeInteger(context.signedAmount) && context.signedAmount! > 0)
      && (!['card-purchase', 'atm-refund'].includes(rule.bankKind ?? '') || !bank.pending));
    if (matched.some(rule => rule.trendyolService)) matched = matched.filter(rule => !rule.originalTrendyol);
    if (matched.some(rule => rule.confirmedUberFood)) matched = matched.filter(rule => !rule.originalUber);
    if (matched.some(rule => rule.originalYouTubePremium)) matched = matched.filter(rule => !rule.genericGoogleYouTube);
    const confirmedPrepaidCredit = bank.kind === 'cashback' && Number.isSafeInteger(context.signedAmount) && context.signedAmount! > 0;
    if (confirmedPrepaidCredit) {
      matched = matched.filter(rule => rule.bankKind === 'cashback' || !rule.untouchedExpansion && !rule.originalDefault);
    }
    // Only the untouched builtin is a fallback. A personal rule using the same
    // phrase remains an ordinary literal rule and is never silently discarded.
    const isFallback = (rule: typeof compiled[number]) => rule.bankKind === 'online-purchase' || rule.bankKind === 'card-purchase';
    if (matched.some(rule => !isFallback(rule))) matched = matched.filter(rule => !isFallback(rule));
    if (!matched.length) return { kind: 'none', suggestions: [] };
    const purchase = input.includes(' pos alisveris ') || input.includes(' pos harcama ');
    const bankFee = bank.kind === 'transfer-fee' && matched.some(rule => rule.bankKind === 'transfer-fee');
    const cashback = bank.kind === 'cashback' && matched.some(rule => rule.bankKind === 'cashback')
      && (context.signedAmount === undefined || Number.isSafeInteger(context.signedAmount) && context.signedAmount > 0);
    const correctDirection = context.signedAmount === undefined || Number.isSafeInteger(context.signedAmount)
      && (bank.kind === 'atm-withdrawal' ? context.signedAmount < 0 : bank.kind === 'atm-deposit' ? context.signedAmount > 0 : context.signedAmount !== 0);
    const confirmedMovement = correctDirection && ['atm-withdrawal', 'atm-deposit', 'bank-transfer'].includes(bank.kind)
      && matched.some(rule => rule.bankKind === bank.kind && rule.mode === 'auto');
    const movementWords = bank.kind === 'bank-transfer' ? BANK_RAIL_PHRASES
      : new Set(bank.kind === 'atm-withdrawal'
        ? ['atm', 'bankamatik', 'nakit', 'para cek', 'para cekme', 'cash withdrawal', 'tarik tunai', 'withdrawal']
        : ['atm', 'bankamatik', 'nakit', 'para yatirma', 'cash deposit', 'setor tunai']);
    const atmRefund = bank.kind === 'atm-refund' && !bank.pending && matched.some(rule => rule.bankKind === 'atm-refund');
    const ambiguous = bank.pending && context.signedAmount !== undefined && matched.some(rule => rule.bankKind === bank.kind) || AMBIGUOUS_PHRASES.some((phrase, index) => {
      if (!input.includes(AMBIGUOUS_MATCHES[index])) return false;
      // The user explicitly defines every incoming whole-word PREPAID as
      // Cashback, including statement wording about reversals or bank rails.
      if (confirmedPrepaidCredit && cashback) return false;
      if (atmRefund && (phrase === 'atm' || phrase === 'iade' || phrase === 'iadesi')) return false;
      if (purchase && !REFUND_PHRASES.has(phrase)) return false;
      if (bankFee && BANK_RAIL_PHRASES.has(phrase)) return false;
      if (confirmedMovement && movementWords.has(phrase)) return false;
      if (cashback && (phrase === 'iade' || phrase === 'iadesi')) return false;
      return true;
    });
    const grouped = new Map<string, { ruleId: string; keywords: Set<string> }>();
    for (const rule of matched) {
      const previous = grouped.get(rule.category);
      if (previous) previous.keywords.add(rule.keyword);
      else grouped.set(rule.category, { ruleId: rule.id, keywords: new Set([rule.keyword]) });
    }
    const existing = matched.filter(rule => !rule.untouchedExpansion);
    const protectExistingSuggestion = matched.some(rule => rule.untouchedExpansion && rule.mode === 'auto')
      && existing.some(rule => rule.mode === 'suggest') && !existing.some(rule => rule.mode === 'auto');
    const automatic = grouped.size === 1 && !ambiguous && !protectExistingSuggestion && matched.some(rule => rule.mode === 'auto');
    return {
      kind: automatic ? 'auto' : 'suggestions',
      suggestions: [...grouped].map(([category, group]) => ({
        category, ruleId: group.ruleId,
        reason: `Cocok dengan aturan ${[...group.keywords].map(keyword => `“${keyword}”`).join(', ')}.${ambiguous ? ' Ada penanda transfer, tunai, atau pengembalian; perlu diperiksa.' : ''}${protectExistingSuggestion ? ' Pilihan saran pada aturan yang sudah ada dipertahankan.' : ''}`,
      })),
    };
  };
}

/** Compatibility entry point for one-off matches; compile once for a whole batch. */
export function matchCategory(text: string, rules: readonly CategoryRule[], activeCategories: readonly string[], context?: BankDescriptionContext): CategoryMatch {
  return createCategoryMatcher(rules, activeCategories)(text, context);
}
