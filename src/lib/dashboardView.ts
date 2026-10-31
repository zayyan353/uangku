import type { Currency, State } from './finance';
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
