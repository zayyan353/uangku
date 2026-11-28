import type { CashflowReport } from './cashflowReport';
import { formatMoney, type Currency, type State } from './finance';
import { createPostingDateIndex, entryPostings, type PostingContext } from './transferPostings';

/** Read-only monthly categories; transfer fees follow the debit's own date. */
export function monthlyCategoryTotals(state: State, currency: Currency, month: string, context?: PostingContext): Array<[string, number]> {
  const wallets = new Set(state.wallets.filter(wallet => wallet.currency === currency).map(wallet => wallet.id));
  const dates = createPostingDateIndex(context);
  const sums = new Map<string, bigint>();
  for (const entry of state.entries) for (const posting of entryPostings(entry, dates)) {
    if (!wallets.has(posting.walletId) || !posting.date?.startsWith(month)) continue;
    const category = posting.role === 'fee' ? 'Biaya transfer' : entry.type === 'expense' && posting.role === 'ordinary' ? entry.category || 'Belum dikategorikan' : null;
    if (category) sums.set(category, (sums.get(category) ?? 0n) - BigInt(posting.signedAmount));
  }
  return [...sums].map(([category, value]): [string, number] => {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError('Total kategori melebihi batas angka tepat.');
    return [category, Number(value)];
  }).sort((a, b) => b[1] - a[1]);
}

/**
 * A category's slot in a palette of `paletteSize` colours. It follows the category's place in the
 * settings list, not its rank in this month's spending, so a category keeps its colour between months.
 * Names missing from the list (e.g. "Biaya transfer") get a slot from their own text.
 */
export function categoryColorIndex(name: string, names: readonly string[], paletteSize: number): number {
  const position = names.indexOf(name);
  if (position >= 0) return position % paletteSize;
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) % 2147483647;
  return hash % paletteSize;
}

/**
 * The line under the folded category panel's title. Without a report the spending has no total;
 * that is said as it is, because it is not the same as a period with no spending.
 */
export function categoryFoldSummary(report: Pick<CashflowReport, 'categoryTotals' | 'categoryExpenseTotal'> | undefined, currency: Currency, displayMoney = formatMoney): string {
  if (!report) return 'Total pengeluaran belum dapat dihitung · ketuk untuk melihat';
  const count = report.categoryTotals.length;
  return count ? `${count} kategori · ${displayMoney(report.categoryExpenseTotal, currency)} · ketuk untuk melihat` : 'Belum ada pengeluaran terkonfirmasi · ketuk untuk melihat';
}
