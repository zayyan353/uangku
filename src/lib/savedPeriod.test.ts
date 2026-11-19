import { describe, expect, it } from 'vitest';
import { monthOutsideView } from './savedPeriod';

describe('MW-115 monthOutsideView', () => {
  it('is null for a transaction dated in the month on screen', () => {
    expect(monthOutsideView(['2026-10-01'], '2026-10')).toBeNull();
    expect(monthOutsideView(['2026-10-31'], '2026-10')).toBeNull();
  });
  it('names the month of a transaction dated outside it, earlier or later', () => {
    expect(monthOutsideView(['2026-09-30'], '2026-10')).toBe('2026-09');
    expect(monthOutsideView(['2026-11-01'], '2026-10')).toBe('2026-11');
    expect(monthOutsideView(['2025-10-15'], '2026-10')).toBe('2025-10');
  });
  it('keeps a transfer on screen when either side falls in the month, and names the debit month otherwise', () => {
    expect(monthOutsideView(['2026-09-30', '2026-10-01'], '2026-10')).toBeNull();
    expect(monthOutsideView(['2026-10-31', '2026-11-02'], '2026-10')).toBeNull();
    expect(monthOutsideView(['2026-08-30', '2026-09-01'], '2026-10')).toBe('2026-08');
  });
  it('does not guess a month for an unknown or malformed date, or when no posting is in the currency on screen', () => {
    expect(monthOutsideView([null], '2026-10')).toBeNull();
    expect(monthOutsideView(['2026-09-30', null], '2026-10')).toBeNull();
    expect(monthOutsideView(['30/09/2026'], '2026-10')).toBeNull();
    expect(monthOutsideView([''], '2026-10')).toBeNull();
    expect(monthOutsideView([], '2026-10')).toBeNull();
  });
});
