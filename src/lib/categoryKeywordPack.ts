import { normalizeCategoryKeyword, type CategoryRule } from "./categorization";
import { KEYWORD_EXPANSION_RULES } from "./categoryKeywordDefinitions";
export { KEYWORD_EXPANSION_RULES } from "./categoryKeywordDefinitions";
import type { CategorySettings } from "./categorySettings";

/** Caller validates the final envelope/capacity before making this effective. */
export function mergeCategoryKeywordPack(settings: CategorySettings): { settings: CategorySettings; added: number; skipped: number } {
  const ids = new Set(settings.rules.map(rule => rule.id));
  const keywords = new Set(settings.rules.map(rule => normalizeCategoryKeyword(rule.keyword)));
  const names = new Set(settings.names);
  const additions: CategoryRule[] = [];
  for (const rule of KEYWORD_EXPANSION_RULES) {
    const keyword = normalizeCategoryKeyword(rule.keyword);
    if (!names.has(rule.category) || ids.has(rule.id) || keywords.has(keyword)) continue;
    additions.push({ ...rule }); ids.add(rule.id); keywords.add(keyword);
  }
  return { settings: additions.length ? { ...settings, rules: [...settings.rules, ...additions] } : settings,
    added: additions.length, skipped: KEYWORD_EXPANSION_RULES.length - additions.length };
}
