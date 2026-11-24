/**
 * The month a saved transaction went to when the month on screen does not show it, or null when
 * the row is on screen (or its place cannot be told).
 *
 * A wallet filter uses only the postings in that wallet, just like the monthly list.
 * If the saved entry did not touch the selected wallet, Lihat clears that filter:
 * the postings in the displayed currency can still tell us which month to open.
 */
export function monthOutsideView(postings: readonly { walletId: string; date: string | null }[], shownMonth: string, walletId?: string): string | null {
  if (postings.length === 0) return null;
  const inWallet = postings.filter(posting => posting.walletId === walletId);
  const scoped = inWallet.length ? inWallet : postings;
  const months: string[] = [];
  for (const { date } of scoped) {
    if (date === null || !/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(date)) return null;
    months.push(date.slice(0, 7));
  }
  return months.includes(shownMonth) ? null : months[0];
}
