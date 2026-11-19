/**
 * The month a saved transaction went to when the month on screen does not show it, or null when
 * the row is on screen (or its place cannot be told).
 *
 * `dates` are the posting dates of the saved entry in the currency on screen: one for an ordinary
 * transaction, two for a transfer. A posting in the month on screen keeps the row in the list. A
 * posting whose date is unknown is never guessed into a month.
 */
export function monthOutsideView(dates: readonly (string | null)[], shownMonth: string): string | null {
  if (dates.length === 0) return null;
  const months: string[] = [];
  for (const date of dates) {
    if (date === null || !/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(date)) return null;
    months.push(date.slice(0, 7));
  }
  return months.includes(shownMonth) ? null : months[0];
}
