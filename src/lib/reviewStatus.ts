import type { Entry } from './finance';
import { isUncategorized } from './categorySettings';

export type ReviewReason = 'all' | 'type' | 'category';
type ReviewEntry = Pick<Entry, 'type' | 'category'>;

/** Independent reasons: one record can need both, but is counted once. */
export function entryReviewStatus(entry: ReviewEntry) {
  const type = entry.type === 'unreviewed';
  const category = (type || entry.type === 'expense' || entry.type === 'income') && isUncategorized(entry.category);
  return { type, category, pending: type || category };
}
export function needsEntryReview(entry: ReviewEntry, reason: ReviewReason = 'all'): boolean {
  const status = entryReviewStatus(entry);
  return reason === 'all' ? status.pending : status[reason];
}
export function reviewCounts(entries: readonly ReviewEntry[]) {
  let total = 0, type = 0, category = 0, both = 0;
  for (const entry of entries) {
    const status = entryReviewStatus(entry);
    if (status.pending) total++;
    if (status.type) type++;
    if (status.category) category++;
    if (status.type && status.category) both++;
  }
  return { total, type, category, both };
}
