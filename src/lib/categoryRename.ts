import { UNCATEGORIZED, validateCategorySettings, type CategorySettings } from './categorySettings';
import { validateBudgets, type BudgetMap } from './budgets';
import { parseStoredTemplates, validateTemplates, type TransactionTemplate } from './transactionTemplates';
import { canCategorize } from './review';
import { isCashLinkedEntry } from './cashScope';
import { archivedReadOnlyEntryIds } from './walletLifecycle';
import type { Currency } from './currencyCatalog';
import type { StoredData } from './storage';

/** One rename made in Kelola kategori. `updateEntries` is the user's choice for existing records. */
export interface CategoryRename { from: string; to: string; updateEntries: boolean }

/**
 * Renames a category in the settings: the name keeps its place in the list and
 * rules that pointed at the old name point at the new one. The base category
 * cannot be renamed, and a name already in use is refused by validation.
 */
export function renameCategoryInSettings(settings: CategorySettings, from: string, to: string): CategorySettings {
  const name = to.trim().normalize('NFC');
  if (from === UNCATEGORIZED) throw new Error('Kategori dasar tidak dapat diganti namanya.');
  if (!settings.names.includes(from)) throw new Error(`Kategori “${from}” sudah tidak ada di daftar.`);
  if (!name) throw new Error('Isi nama kategori yang baru.');
  if (name === from) throw new Error('Nama baru sama dengan nama lama.');
  if (settings.names.some(item => item !== from && item.toLocaleLowerCase('id-ID') === name.toLocaleLowerCase('id-ID'))) throw new Error(`Kategori “${name}” sudah ada. Pilih nama lain.`);
  return validateCategorySettings({ ...settings, names: settings.names.map(item => item === from ? name : item),
    rules: settings.rules.map(rule => rule.category === from ? { ...rule, category: name } : rule) });
}

/** Moves each currency's monthly limit from the old name to the new one. A limit already set under the new name is kept. */
export function renameCategoryInBudgets(budgets: BudgetMap, from: string, to: string): BudgetMap {
  const next: BudgetMap = {};
  for (const [code, limits] of Object.entries(budgets) as [Currency, Record<string, number>][]) {
    const moved: Record<string, number> = {};
    for (const [name, limit] of Object.entries(limits)) {
      if (name !== from) moved[name] = limit; else if (!Object.hasOwn(limits, to)) moved[to] = limit;
    }
    next[code] = moved;
  }
  return validateBudgets(next);
}

/** Templates that fill the old name fill the new one instead. Returns null when nothing changes. */
export function renameCategoryInTemplates(raw: string | null, from: string, to: string): { raw: string; templates: TransactionTemplate[] } | null {
  const current = parseStoredTemplates(raw);
  if (!current.some(template => template.category === from)) return null;
  const templates = validateTemplates(current.map(template => template.category === from ? { ...template, category: to } : template));
  return { raw: JSON.stringify(templates), templates };
}

/**
 * Records that carry the old name and may be edited: income, expense,
 * movement and unreviewed entries outside old cash history and archived
 * wallets. Read-only history keeps its old name and is counted separately.
 */
export function categoryRenameTargets(data: StoredData, from: string): { ids: string[]; readOnly: number } {
  const locked = archivedReadOnlyEntryIds(data);
  const ids: string[] = [];
  let readOnly = 0;
  for (const entry of data.state.entries) {
    if (entry.category !== from || !canCategorize(entry)) continue;
    if (locked.has(entry.id) || isCashLinkedEntry(data.state, entry)) readOnly++; else ids.push(entry.id);
  }
  return { ids, readOnly };
}

/** How many editable records each category name has, for the choice shown before renaming. */
export function categoryUsage(data: StoredData): Record<string, number> {
  const locked = archivedReadOnlyEntryIds(data);
  const usage: Record<string, number> = {};
  for (const entry of data.state.entries) {
    if (!entry.category || !canCategorize(entry) || locked.has(entry.id) || isCashLinkedEntry(data.state, entry)) continue;
    usage[entry.category] = (usage[entry.category] ?? 0) + 1;
  }
  return usage;
}
