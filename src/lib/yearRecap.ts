import { ageOfMoney } from './ageOfMoney';
import { indexBankWording } from './bankWording';
import { UNCATEGORIZED } from './categorySettings';
import { isValidDate, type Currency } from './finance';
import { merchantKey } from './merchantKey';
import type { SourceDocument } from './sourceModel';
import { dailySpending } from './spendingCalendar';
import { deviceDay } from './today';

const START = '2026-01-01';
const END = '2026-12-31';

interface RankedTotal { name: string; total: number }
interface Peak { period: string; total: number }
interface Streak { start: string; end: string; days: number }
export interface YearRecap {
  currency: Currency;
  through: string;
  income: number;
  spending: number;
  topCategories: RankedTotal[];
  topMerchants: RankedTotal[];
  peakMonth: Peak | null;
  peakDay: Peak | null;
  longestNoSpend: Streak | null;
  ageDays: number | null;
}

export function isYearRecapVisible(today = deviceDay()): boolean {
  return isValidDate(today) && today >= '2026-12-01' && today <= '2027-01-31';
}

function sum(left: number, right: number): number {
  if (!Number.isSafeInteger(right) || right < 0 || right > Number.MAX_SAFE_INTEGER - left) {
    throw new RangeError('Total rekap melewati batas nominal aman.');
  }
  return left + right;
}
function add(totals: Map<string, number>, key: string, amount: number) {
  if (amount) totals.set(key, sum(totals.get(key) ?? 0, amount));
}
function topFive(totals: Map<string, number>): RankedTotal[] {
  return [...totals].map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).slice(0, 5);
}

export function buildYearRecap(data: SourceDocument, currency: Currency, today = deviceDay()): YearRecap {
  if (!isValidDate(today)) throw new RangeError('Tanggal acuan rekap tidak valid.');
  const through = today < END ? today : END;
  const result: YearRecap = { currency, through, income: 0, spending: 0, topCategories: [], topMerchants: [],
    peakMonth: null, peakDay: null, longestNoSpend: null, ageDays: null };
  if (through < START) return result;

  const daily = dailySpending(data, currency, START, through);
  const wallets = new Set(data.state.wallets.filter(w => w.kind !== 'cash' && w.currency === currency).map(w => w.id));
  const entries = new Map(data.state.entries.map(entry => [entry.id, entry]));
  const wording = indexBankWording(data);
  for (const entry of data.state.entries) {
    if (entry.type === 'income' && wallets.has(entry.walletId) && entry.date >= START && entry.date <= through) {
      result.income = sum(result.income, entry.amount);
    }
  }

  const categories = new Map<string, number>(), merchants = new Map<string, number>(), months = new Map<string, number>();
  let streakStart = START, streakDays = 0;
  const last = Date.parse(through);
  for (let time = Date.parse(START); time <= last; time += 86_400_000) {
    const date = new Date(time).toISOString().slice(0, 10);
    const day = daily.get(date);
    if (!day) {
      if (streakDays === 0) streakStart = date;
      streakDays++;
      if (streakDays > (result.longestNoSpend?.days ?? 0)) {
        result.longestNoSpend = { start: streakStart, end: date, days: streakDays };
      }
      continue;
    }
    streakDays = 0;
    result.spending = sum(result.spending, day.total);
    add(months, date.slice(0, 7), day.total);
    if (day.total > (result.peakDay?.total ?? 0)) result.peakDay = { period: date, total: day.total };
    // dailySpending lists each counted entry once, on its expense or fee posting day.
    for (const id of day.entryIds) {
      const entry = entries.get(id)!;
      add(categories, 'Biaya transfer', entry.fee ?? 0);
      if (entry.type !== 'expense') continue;
      add(categories, entry.category.trim() || UNCATEGORIZED, entry.amount);
      const merchant = merchantKey(wording.get(id)?.description ?? entry.note);
      if (merchant) add(merchants, merchant, entry.amount);
    }
  }
  for (const [period, total] of months) {
    if (total > (result.peakMonth?.total ?? 0)) result.peakMonth = { period, total };
  }
  result.topCategories = topFive(categories);
  result.topMerchants = topFive(merchants);
  result.ageDays = ageOfMoney(data, currency, through);
  return result;
}
