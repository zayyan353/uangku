import type { CategorySettings } from './categorySettings';
import type { CategoryRule } from './categorization';
import {
  BANK_AUTOMATIC_RULE_UPDATES, BANK_PREPAID_CREDIT_RULE, CURRENT_BANK_CATEGORY_RULES,
  isBundledBankRule, resolveBankCategoryName, BANK_REVIEW_COMPLETION_RULES, BANK_ATM_NETWORK_RULES, BANK_KEYWORD_PACK_7_RULES,
} from './categoryBankMappings';
import { normalizeBankDescription } from './bankDescription';

export { BANK_AUTOMATIC_RULE_UPDATES, BANK_PREPAID_CREDIT_RULE, CURRENT_BANK_CATEGORY_RULES } from './categoryBankMappings';

/** Only untouched previous defaults are changed. No deleted rule is revived. */
export function mergeAutomaticBankMappings(settings: CategorySettings): { settings: CategorySettings; added: number; updated: number; skipped: number } {
  const updates = new Map(BANK_AUTOMATIC_RULE_UPDATES.map(update => [update.previous.id, update]));
  let updated = 0;
  const rules = settings.rules.map(rule => {
    const update = updates.get(rule.id);
    const category = update && resolveBankCategoryName(settings.names, update.current.category);
    if (!update || !category || !isBundledBankRule(rule, update.previous)) return rule;
    updated++;
    return { ...update.current, category };
  });
  const category = resolveBankCategoryName(settings.names, BANK_PREPAID_CREDIT_RULE.category);
  const duplicate = rules.some(rule => rule.id === BANK_PREPAID_CREDIT_RULE.id
    || normalizeBankDescription(rule.keyword) === normalizeBankDescription(BANK_PREPAID_CREDIT_RULE.keyword));
  const added = category && !duplicate ? 1 : 0;
  if (added) rules.push({ ...BANK_PREPAID_CREDIT_RULE, category: category! });
  return { settings: updated || added ? { ...settings, rules } : settings, added, updated,
    skipped: BANK_AUTOMATIC_RULE_UPDATES.length + 1 - updated - added };
}

/** Explicit add-defaults action, using only current active-target definitions. */
export function mergeCurrentAutomaticBankMappings(settings: CategorySettings): { settings: CategorySettings; added: number; updated: number; skipped: number } {
  const automatic = settings.keywordPackVersion && settings.keywordPackVersion >= 4
    ? { settings, added: 0, updated: 0 } : mergeAutomaticBankMappings(settings);
  const rules = automatic.settings.rules;
  const ids = new Set(rules.map(rule => rule.id));
  const keywords = new Set(rules.map(rule => normalizeBankDescription(rule.keyword)));
  const additions: CategoryRule[] = [];
  const current = [...CURRENT_BANK_CATEGORY_RULES, ...BANK_REVIEW_COMPLETION_RULES, ...BANK_ATM_NETWORK_RULES, ...BANK_KEYWORD_PACK_7_RULES];
  for (const rule of current) {
    const category = resolveBankCategoryName(automatic.settings.names, rule.category);
    const keyword = normalizeBankDescription(rule.keyword);
    if (!category || ids.has(rule.id) || keywords.has(keyword)) continue;
    additions.push({ ...rule, category }); ids.add(rule.id); keywords.add(keyword);
  }
  const added = automatic.added + additions.length;
  return { settings: additions.length ? { ...automatic.settings, rules: [...rules, ...additions] } : automatic.settings,
    added, updated: automatic.updated, skipped: current.length - added };
}

/** Add only the new v5 identities to profiles predating v5. Existing IDs,
 * keywords, inactive targets and all earlier pack removals remain authoritative.
 */
export function mergeReviewCompletionMappings(settings: CategorySettings): { settings: CategorySettings; added: number; updated: 0 } {
  return appendMissingRules(settings, BANK_REVIEW_COMPLETION_RULES);
}

/** Add only the v6 ATM identities to profiles predating v6, under the same
 * rules: no revived v5 deletion, replaced personal keyword or inactive target.
 */
export function mergeAtmNetworkMappings(settings: CategorySettings): { settings: CategorySettings; added: number; updated: 0 } {
  return appendMissingRules(settings, BANK_ATM_NETWORK_RULES);
}

/** Add only the v7 identities to profiles predating v7, under the same rules. */
export function mergeKeywordPack7Mappings(settings: CategorySettings): { settings: CategorySettings; added: number; updated: 0 } {
  return appendMissingRules(settings, BANK_KEYWORD_PACK_7_RULES);
}

function appendMissingRules(settings: CategorySettings, rules: readonly CategoryRule[]): { settings: CategorySettings; added: number; updated: 0 } {
  const ids = new Set(settings.rules.map(rule => rule.id));
  const keywords = new Set(settings.rules.map(rule => normalizeBankDescription(rule.keyword)));
  const additions: CategoryRule[] = [];
  for (const rule of rules) {
    const category = resolveBankCategoryName(settings.names, rule.category);
    const keyword = normalizeBankDescription(rule.keyword);
    if (!category || ids.has(rule.id) || keywords.has(keyword)) continue;
    additions.push({ ...rule, category }); ids.add(rule.id); keywords.add(keyword);
  }
  return { settings: additions.length ? { ...settings, rules: [...settings.rules, ...additions] } : settings, added: additions.length, updated: 0 };
}
