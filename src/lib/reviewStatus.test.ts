import { describe, expect, it } from 'vitest';
import { entryReviewStatus, needsEntryReview, reviewCounts } from './reviewStatus';
import type { Entry } from './finance';

describe('consistent import and saved review reasons', () => {
  it('counts overlapping reasons once and keeps each reason inspectable', () => {
    const rows = [
      { type: 'unreviewed' as const, category: 'Belum dikategorikan' },
      { type: 'unreviewed' as const, category: 'Pilihan manual' },
      { type: 'expense' as const, category: '' },
      { type: 'expense' as const, category: 'Belanja' },
    ];
    const before = JSON.stringify(rows);
    expect(reviewCounts(rows)).toEqual({ total: 3, type: 2, category: 2, both: 1 });
    expect(rows.filter(row => needsEntryReview(row, 'type'))).toHaveLength(2);
    expect(rows.filter(row => needsEntryReview(row, 'category'))).toHaveLength(2);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it.each(['transfer', 'adjustment', 'movement'] as const)('does not force spending categories on %s', type => {
    expect(entryReviewStatus({ type, category: '' })).toEqual({ type: false, category: false, pending: false });
  });
  it.each(['income', 'expense'] as const)('recognizes empty and uncategorized %s while retaining manual labels', type => {
    for (const category of ['', '   ', 'Belum dikategorikan']) expect(needsEntryReview({ type, category })).toBe(true);
    expect(needsEntryReview({ type, category: 'Kategori manual' })).toBe(false);
  });
  it('explains the old one-type vs fifteen-category discrepancy without changing entries', () => {
    const rows: Array<Pick<Entry, 'type' | 'category'>> = Array.from({ length: 14 }, () => ({ type: 'expense', category: 'Belum dikategorikan' }));
    rows.push({ type: 'unreviewed', category: 'Belum dikategorikan' });
    expect(reviewCounts(rows)).toEqual({ total: 15, type: 1, category: 15, both: 1 });
  });
});
