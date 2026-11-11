import { isUncategorized } from './categorySettings';

export interface OrderedCategories {
  /** Categories already used for this kind of entry, most used first. Empty when there is no history yet. */
  frequent: string[];
  /** Every other choice, in the order of the settings. */
  rest: string[];
}

/**
 * Splits the category choices for one entry kind into those the ledger already
 * uses for that kind and the rest. Only the order changes: every choice is
 * still offered exactly once, and "Belum dikategorikan" is never promoted.
 */
export function orderCategories(choices: readonly string[], entries: ReadonlyArray<{ type: string; category: string }>, type: string, limit = 6): OrderedCategories {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.type !== type || isUncategorized(entry.category)) continue;
    counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  }
  const frequent = choices.filter(name => counts.has(name))
    .map((name, index) => ({ name, index, count: counts.get(name)! }))
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .slice(0, limit).map(item => item.name);
  const promoted = new Set(frequent);
  return { frequent, rest: choices.filter(name => !promoted.has(name)) };
}
