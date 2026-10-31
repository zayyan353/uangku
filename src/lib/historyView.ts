import type { Currency, Entry, State } from './finance';
import { needsEntryReview, type ReviewReason } from './reviewStatus';
import { createPostingDateIndex, entryPostings, type PostingContext } from './transferPostings';

export const HISTORY_PAGE_SIZE = 50;
export type HistoryPeriod = 'month' | 'all';
export interface HistoryQuery {
  currency: Currency;
  month: string;
  period: HistoryPeriod;
  query: string;
  type: string;
  reviewQueue?: boolean;
  walletId?: string;
  reviewReason?: ReviewReason;
  reviewExcludedWalletIds?: ReadonlySet<string>;
  reviewExcludedEntryIds?: ReadonlySet<string>;
}
interface HistoryRow {
  entry: Entry;
  ordinal: number;
  text: string;
  currencies: Currency[];
  dates: Partial<Record<Currency, string[]>>;
  undatedCurrencies: ReadonlySet<Currency>;
  walletDates: Record<string, string[]>;
  undatedWalletIds: ReadonlySet<string>;
  allDates: string[];
}
export interface HistoryIndex {
  readonly rows: readonly HistoryRow[];
  readonly rowsByCurrency: ReadonlyMap<Currency, readonly HistoryRow[]>;
  readonly byId: ReadonlyMap<string, HistoryRow>;
}

/** Derived read-only index. An entry is never changed to support a filter or sort. */
export function createHistoryIndex(state: State, context?: PostingContext): HistoryIndex {
  const wallets = new Map(state.wallets.map(wallet => [wallet.id, wallet]));
  const postingIndex = createPostingDateIndex(context);
  const rows = state.entries.map((entry, ordinal) => {
    const source = wallets.get(entry.walletId), destination = wallets.get(entry.toWalletId ?? '');
    const currencies = [...new Set([source?.currency, destination?.currency].filter((code): code is Currency => code !== undefined))];
    const dates: Partial<Record<Currency, string[]>> = {};
    const undatedCurrencies = new Set<Currency>();
    const walletDates: Record<string, string[]> = {};
    const undatedWalletIds = new Set<string>();
    for (const posting of entryPostings(entry, postingIndex)) {
      const currency = wallets.get(posting.walletId)?.currency;
      if (!currency) continue;
      if (posting.date === null) { undatedCurrencies.add(currency); undatedWalletIds.add(posting.walletId); }
      else { (dates[currency] ??= []).push(posting.date); (walletDates[posting.walletId] ??= []).push(posting.date); }
    }
    for (const currency of currencies) dates[currency] = [...new Set(dates[currency] ?? [])].sort();
    for (const id of Object.keys(walletDates)) walletDates[id] = [...new Set(walletDates[id])].sort();
    const allDates = [...new Set(Object.values(dates).flat())].sort();
    return { entry, ordinal, currencies, dates, allDates, undatedCurrencies, walletDates, undatedWalletIds, text: `${entry.note} ${entry.category} ${source?.name ?? ''} ${destination?.name ?? ''}`.toLocaleLowerCase('id-ID') };
  });
  rows.sort((a, b) => (b.allDates.at(-1) ?? '').localeCompare(a.allDates.at(-1) ?? '') || b.ordinal - a.ordinal);
  const rowsByCurrency = new Map<Currency, HistoryRow[]>();
  for (const currency of new Set(state.wallets.map(wallet => wallet.currency))) {
    rowsByCurrency.set(currency, rows.filter(row => row.currencies.includes(currency))
      .sort((a, b) => (b.dates[currency]?.at(-1) ?? '').localeCompare(a.dates[currency]?.at(-1) ?? '') || b.ordinal - a.ordinal));
  }
  return { rows, rowsByCurrency, byId: new Map(rows.map(row => [row.entry.id, row])) };
}


export function queryHistory(index: HistoryIndex, options: HistoryQuery): Entry[] {
  const needle = options.query.trim().toLocaleLowerCase('id-ID');
  const rows = options.reviewQueue ? index.rows : index.rowsByCurrency.get(options.currency) ?? [];
  const found = rows.filter(row => {
    if (options.reviewQueue && options.reviewExcludedEntryIds?.has(row.entry.id)) return false;
    if (options.walletId && row.entry.walletId !== options.walletId && row.entry.toWalletId !== options.walletId) return false;
    if (options.reviewQueue && (options.reviewExcludedWalletIds?.has(row.entry.walletId) || !!row.entry.toWalletId && options.reviewExcludedWalletIds?.has(row.entry.toWalletId))) return false;
    // Unknown dates remain findable as explicitly undated records. This does
    // not assign their financial postings to the selected calendar month.
    if (!options.reviewQueue && options.period === 'month'
      && !(options.walletId ? row.walletDates[options.walletId] : row.dates[options.currency])?.some(date => date.startsWith(options.month))
      && !(options.walletId ? row.undatedWalletIds.has(options.walletId) : row.undatedCurrencies.has(options.currency))) return false;
    if (needle && !row.text.includes(needle)) return false;
    return options.type === 'all' || (options.type === 'pending' ? needsEntryReview(row.entry, options.reviewReason) : row.entry.type === options.type);
  });
  if (options.walletId) found.sort((a, b) => (b.walletDates[options.walletId!]?.at(-1) ?? '').localeCompare(a.walletDates[options.walletId!]?.at(-1) ?? '') || b.ordinal - a.ordinal);
  return found.map(row => row.entry);
}

export function historyPostingInfo(index: HistoryIndex, entryId: string, currency?: Currency) {
  const row = index.byId.get(entryId);
  return {
    dates: [...(currency ? row?.dates[currency] ?? [] : row?.allDates ?? [])],
    undated: currency ? !!row?.undatedCurrencies.has(currency) : !!row?.undatedCurrencies.size,
  };
}

export function paginateHistory(entries: readonly Entry[], requestedPage: number, pageSize = HISTORY_PAGE_SIZE) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 200) throw new RangeError('Ukuran halaman riwayat tidak valid.');
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const page = Math.max(1, Math.min(pageCount, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
  const start = (page - 1) * pageSize;
  return { entries: entries.slice(start, start + pageSize), page, pageCount, start: entries.length ? start + 1 : 0, end: Math.min(start + pageSize, entries.length), total: entries.length };
}

export function monthLabel(month: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return month;
  return new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`));
}
