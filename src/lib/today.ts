/**
 * The calendar day (YYYY-MM-DD) "today" means throughout the app: the day on
 * the device's own clock and time zone. One function, so balances, reports,
 * default form dates and the backup reminder all turn over at the same local
 * midnight. `timeZone` is for tests; the app never passes it.
 */
export function deviceDay(now: Date = new Date(), timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', ...(timeZone ? { timeZone } : {}) }).format(now);
}

/** The day before a YYYY-MM-DD day. */
export function dayBefore(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date - 1)).toISOString().slice(0, 10);
}
