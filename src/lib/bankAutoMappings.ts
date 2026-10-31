import type { CategorySettings } from './categorySettings';
import type { CategoryRule } from './categorization';
import {
  BANK_AUTOMATIC_RULE_UPDATES, BANK_PREPAID_CREDIT_RULE, CURRENT_BANK_CATEGORY_RULES,
  isBundledBankRule, resolveBankCategoryName, BANK_REVIEW_COMPLETION_RULES,
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
  for (const rule of [...CURRENT_BANK_CATEGORY_RULES, ...BANK_REVIEW_COMPLETION_RULES]) {
    const category = resolveBankCategoryName(automatic.settings.names, rule.category);
    const keyword = normalizeBankDescription(rule.keyword);
    if (!category || ids.has(rule.id) || keywords.has(keyword)) continue;
    additions.push({ ...rule, category }); ids.add(rule.id); keywords.add(keyword);
  }
  const added = automatic.added + additions.length;
  return { settings: additions.length ? { ...automatic.settings, rules: [...rules, ...additions] } : automatic.settings,
    added, updated: automatic.updated, skipped: CURRENT_BANK_CATEGORY_RULES.length + BANK_REVIEW_COMPLETION_RULES.length - added };
}

/** Add only the new v5 identities to profiles predating v5. Existing IDs,
 * keywords, inactive targets and all earlier pack removals remain authoritative.
 */
export function mergeReviewCompletionMappings(settings: CategorySettings): { settings: CategorySettings; added: number; updated: 0 } {
  const ids = new Set(settings.rules.map(rule => rule.id));
  const keywords = new Set(settings.rules.map(rule => normalizeBankDescription(rule.keyword)));
  const additions: CategoryRule[] = [];
  for (const rule of BANK_REVIEW_COMPLETION_RULES) {
    const category = resolveBankCategoryName(settings.names, rule.category);
    const keyword = normalizeBankDescription(rule.keyword);
    if (!category || ids.has(rule.id) || keywords.has(keyword)) continue;
    additions.push({ ...rule, category }); ids.add(rule.id); keywords.add(keyword);
  }
  return { settings: additions.length ? { ...settings, rules: [...settings.rules, ...additions] } : settings, added: additions.length, updated: 0 };
}
