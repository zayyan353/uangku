import { describe, expect, it } from 'vitest';
import { dayBefore, deviceDay } from './today';

describe('deviceDay', () => {
  it('follows the given zone across midnight', () => {
    const instant = new Date('2026-11-10T18:30:00Z');
    expect(deviceDay(instant, 'Asia/Jakarta')).toBe('2026-11-11'); // 01.30 WIB: already the 11th.
    expect(deviceDay(instant, 'Europe/Istanbul')).toBe('2026-11-10');
    expect(deviceDay(instant, 'America/Los_Angeles')).toBe('2026-11-10');
  });
  it('uses the device zone when none is given', () => {
    const now = new Date('2026-11-11T12:00:00Z');
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(deviceDay(now)).toBe(deviceDay(now, device));
    expect(deviceDay(now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('dayBefore', () => {
  it('crosses month and year boundaries', () => {
    expect(dayBefore('2026-03-01')).toBe('2026-02-28');
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
  });
});
