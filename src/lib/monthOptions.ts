import { monthLabel } from './historyView';

const shift = (month: string, by: number): string => {
  const [year, index] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, index - 1 + by, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};
export const nextMonth = (month: string): string => shift(month, 1);
export const priorMonth = (month: string): string => shift(month, -1);

/**
 * Months offered by the month picker, newest first: from three years before
 * today (or the earliest dated entry, whichever is earlier) to a year ahead
 * (or the latest entry), always including the selected month.
 */
export function monthOptions(today: string, selected: string, entryDates: Iterable<string>): Array<{ value: string; label: string }> {
  let first = shift(today.slice(0, 7), -36), last = shift(today.slice(0, 7), 12);
  for (const date of entryDates) {
    const month = date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    if (month < first) first = month;
    if (month > last) last = month;
  }
  if (/^\d{4}-\d{2}$/.test(selected)) { if (selected < first) first = selected; if (selected > last) last = selected; }
  const options: Array<{ value: string; label: string }> = [];
  // A ledger with one stray far-off date must not produce an endless list.
  for (let month = last, guard = 0; month >= first && guard < 1200; month = shift(month, -1), guard++) options.push({ value: month, label: monthLabel(month) });
  return options;
}

/** Emoji flag for a currency whose code starts with its country's letters; supranational or special codes (X…) get none. */
export function currencyFlagEmoji(code: string): string {
  if (!/^[A-Z]{3}$/.test(code) || code.startsWith('X')) return '';
  return String.fromCodePoint(...[...code.slice(0, 2)].map(letter => 0x1f1e6 + letter.charCodeAt(0) - 65));
}
