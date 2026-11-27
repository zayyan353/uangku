import { isUncategorized } from './categorySettings';
import type { Entry } from './finance';
import { merchantKey } from './merchantKey';

const HISTORY_WINDOW = 180 * 86_400_000;
const SAMPLE_SIZE = 5;
const MIN_MATCHES = 3;

/** Index eligible rows once. A late import can put entries in any order. */
export function createHistorySuggester(entries: readonly Entry[], descriptionOf: (entry: Entry) => string, categories: readonly string[]) {
  const byMerchant = new Map<string, { date: number; category: string }[]>();
  const valid = new Set(categories);
  for (const entry of entries) {
    if ((entry.type !== 'income' && entry.type !== 'expense') || isUncategorized(entry.category)) continue;
    const merchant = merchantKey(descriptionOf(entry));
    if (!merchant) continue;
    const sample = { date: Date.parse(entry.date), category: entry.category };
    const rows = byMerchant.get(merchant);
    if (rows) rows.push(sample);
    else byMerchant.set(merchant, [sample]);
  }
  for (const rows of byMerchant.values()) rows.sort((a, b) => a.date - b.date);

  return (description: string, date: string) => {
    const merchant = merchantKey(description);
    const rows = byMerchant.get(merchant);
    if (!rows || rows.length < MIN_MATCHES) return;
    const target = Date.parse(date);
    // Find the end of this target's window without scanning the merchant's whole history.
    let low = 0, high = rows.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (rows[mid].date <= target) low = mid + 1;
      else high = mid;
    }
    const recent = rows.slice(Math.max(0, low - SAMPLE_SIZE), low).filter(row => row.date >= target - HISTORY_WINDOW);
    const counts = new Map<string, number>();
    for (const row of recent) counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
    for (const [category, count] of counts) {
      if (count >= MIN_MATCHES && valid.has(category)) return {
        merchant, category, reason: `${count} dari ${recent.length} transaksi terakhir “${merchant}” memakai ${category}.`,
      };
    }
  };
}
