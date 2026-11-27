import { isValidDate, type Currency } from './finance';
import type { SourceDocument } from './sourceModel';
import { deviceDay } from './today';
import { createPostingDateIndex, entryPostings, isExpensePosting } from './transferPostings';

interface SpendingDay { total: number; entryIds: string[] }
export interface CalendarDay extends SpendingDay { date: string; level: 0 | 1 | 2 | 3 | 4 }

/** Positive, dated expense postings in one currency. Both bounds are inclusive. */
export function dailySpending(data: SourceDocument, currency: Currency, from: string, through: string): Map<string, SpendingDay> {
  if (!isValidDate(from) || !isValidDate(through) || from > through) throw new RangeError('Rentang tanggal pengeluaran tidak valid.');
  const wallets = new Set(data.state.wallets.filter(w => w.kind !== 'cash' && w.currency === currency).map(w => w.id));
  const index = createPostingDateIndex(data.metadata);
  const days = new Map<string, SpendingDay>();
  for (const entry of data.state.entries) {
    // A fee is always charged to the source wallet, even for a cross-currency transfer.
    if (!wallets.has(entry.walletId) || (entry.type !== 'expense' && entry.type !== 'transfer')) continue;
    for (const posting of entryPostings(entry, index)) {
      if (!isExpensePosting(entry, posting) || posting.date === null || posting.date < from || posting.date > through) continue;
      const amount = -posting.signedAmount;
      const day = days.get(posting.date) ?? { total: 0, entryIds: [] };
      if (!Number.isSafeInteger(amount) || amount > Number.MAX_SAFE_INTEGER - day.total) {
        throw new RangeError('Total pengeluaran harian melewati batas nominal aman.');
      }
      day.total += amount;
      // An expense and its additional fee contribute two postings from the same row.
      if (day.entryIds.at(-1) !== entry.id) day.entryIds.push(entry.id);
      days.set(posting.date, day);
    }
  }
  return days;
}

const DAYS = 7 * 53;
const DAY_MS = 86_400_000;
const isoDay = (time: number) => new Date(time).toISOString().slice(0, 10);

export function buildSpendingCalendar(data: SourceDocument, currency: Currency, through = deviceDay()): CalendarDay[] {
  if (!isValidDate(through)) throw new RangeError('Tanggal akhir kalender pengeluaran tidak valid.');
  const start = Date.parse(through) - (DAYS - 1) * DAY_MS;
  const spending = dailySpending(data, currency, isoDay(start), through);
  const ordered = [...spending.values()].map(day => day.total).sort((a, b) => a - b);
  // Nearest-rank quartiles over spending days only. Ties get the same lower level.
  const quartile = (n: number) => ordered[Math.ceil(ordered.length * n / 4) - 1];
  const lower = quartile(1), median = quartile(2), upper = quartile(3);
  return Array.from({ length: DAYS }, (_, i) => {
    const date = isoDay(start + i * DAY_MS);
    const day = spending.get(date) ?? { total: 0, entryIds: [] };
    const level = day.total === 0 ? 0 : day.total <= lower ? 1 : day.total <= median ? 2 : day.total <= upper ? 3 : 4;
    return { date, ...day, level };
  });
}
