import { normalizeCategoryKeyword, type CategoryRule } from './categorization';
import { CONFIRMED_ADDITIONAL_RULES, CONFIRMED_RULE_UPDATES, CURRENT_KEYWORD_EXPANSION_RULES, resolveConfirmedCategoryName } from './categoryKeywordDefinitions';
import type { CategorySettings } from './categorySettings';

const exactRule = (value: CategoryRule, original: CategoryRule): boolean =>
  value.id === original.id && value.keyword === original.keyword && value.category === original.category && value.mode === original.mode;

/** Root owns category creation, versioning and final validation/capacity. This
 * layer never re-adds deleted v1 rules or changes any personally edited rule.
 */
export function mergeConfirmedCategoryMappings(settings: CategorySettings): { settings: CategorySettings; added: number; updated: number; skipped: number } {
  const updates = new Map(CONFIRMED_RULE_UPDATES.map(update => [update.previous.id, update]));
  let updated = 0;
  const rules = settings.rules.map(rule => {
    const update = updates.get(rule.id);
    const category = update && resolveConfirmedCategoryName(settings.names, update.current.category);
    if (!update || !category || !exactRule(rule, update.previous)) return rule;
    updated++; return { ...update.current, category };
  });
  const ids = new Set(rules.map(rule => rule.id));
  const keywords = new Set(rules.map(rule => normalizeCategoryKeyword(rule.keyword)));
  let added = 0;
  for (const rule of CONFIRMED_ADDITIONAL_RULES) {
    const keyword = normalizeCategoryKeyword(rule.keyword);
    const category = resolveConfirmedCategoryName(settings.names, rule.category);
    if (!category || ids.has(rule.id) || keywords.has(keyword)) continue;
    rules.push({ ...rule, category }); ids.add(rule.id); keywords.add(keyword); added++;
  }
  return { settings: updated || added ? { ...settings, rules } : settings, added, updated,
    skipped: CONFIRMED_RULE_UPDATES.length + CONFIRMED_ADDITIONAL_RULES.length - added - updated };
}

/** Explicit manager action: re-add only the current active-target defaults,
 * never obsolete HOP/Google/etc. identities after the user removed a target.
 */
export function mergeCurrentCategoryKeywordPack(settings: CategorySettings): { settings: CategorySettings; added: number; updated: number; skipped: number } {
  const confirmed = settings.keywordPackVersion && settings.keywordPackVersion >= 2
    ? { settings, added: 0, updated: 0 } : mergeConfirmedCategoryMappings(settings);
  const ids = new Set(confirmed.settings.rules.map(rule => rule.id));
  const keywords = new Set(confirmed.settings.rules.map(rule => normalizeCategoryKeyword(rule.keyword)));
  const additions: CategoryRule[] = [];
  for (const rule of CURRENT_KEYWORD_EXPANSION_RULES) {
    const keyword = normalizeCategoryKeyword(rule.keyword);
    const category = resolveConfirmedCategoryName(confirmed.settings.names, rule.category);
    if (!category || ids.has(rule.id) || keywords.has(keyword)) continue;
    additions.push({ ...rule, category }); ids.add(rule.id); keywords.add(keyword);
  }
  const added = confirmed.added + additions.length;
  return { settings: additions.length ? { ...confirmed.settings, rules: [...confirmed.settings.rules, ...additions] } : confirmed.settings,
    added, updated: confirmed.updated, skipped: CURRENT_KEYWORD_EXPANSION_RULES.length - added };
}
