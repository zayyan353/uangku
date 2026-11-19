import { describe, expect, it } from 'vitest';
import { measureStorageUsage, storageUsage, storageUsageText, STORAGE_QUOTA_CHARS, STORAGE_WARNING_PERCENT } from './storageUsage';

function fakeStorage(items: Record<string, string>): Pick<Storage, 'length' | 'key' | 'getItem'> {
  const keys = Object.keys(items);
  return { length: keys.length, key: index => keys[index] ?? null, getItem: key => items[key] ?? null };
}

describe('MW-96 storage usage', () => {
  it('counts every key name and value of the origin, in UTF-16 code units', () => {
    expect(measureStorageUsage(fakeStorage({}))).toEqual({ usedChars: 0, quotaChars: 5_242_880, percent: 0, level: 'ok' });
    // 9 + 5, 2 + 0, and a key of another page on the same origin: 5 + 3. The emoji is two code units.
    expect(measureStorageUsage(fakeStorage({ 'uangku:v1': '{"a":', ab: '', other: 'x😀' }))!.usedChars).toBe(9 + 5 + 2 + 0 + 5 + 3);
  });

  it('warns from 60% of the Chromium quota and never shows a percentage below the threshold', () => {
    const threshold = STORAGE_QUOTA_CHARS * STORAGE_WARNING_PERCENT / 100;
    expect(threshold).toBe(3_145_728);
    expect(storageUsage(threshold - 1)).toMatchObject({ percent: 59, level: 'ok' });
    expect(storageUsage(threshold)).toMatchObject({ percent: 60, level: 'warning' });
    expect(storageUsage(STORAGE_QUOTA_CHARS - 1)).toMatchObject({ percent: 99, level: 'warning' });
    // An engine with a larger quota can hold more than the Chromium limit; the number stays a percentage.
    expect(storageUsage(STORAGE_QUOTA_CHARS * 2)).toMatchObject({ percent: 100, level: 'warning' });
  });

  it('warns for a ledger the size the review recorded for 10,000 imported rows, before the import that failed', () => {
    const usage = measureStorageUsage(fakeStorage({ 'uangku:v1': 'x'.repeat(3_380_910 - 'uangku:v1'.length) }))!;
    expect(usage).toMatchObject({ usedChars: 3_380_910, percent: 64, level: 'warning' });
    // What is left when the warning starts still holds one 5,000-row import at the largest measured row size.
    expect(STORAGE_QUOTA_CHARS - STORAGE_QUOTA_CHARS * STORAGE_WARNING_PERCENT / 100).toBeGreaterThanOrEqual(5_000 * 370);
    expect(storageUsageText(usage).replace(/ /g, ' ')).toBe('3.380.910 dari 5.242.880 karakter');
  });

  it('returns null instead of guessing when storage is missing or cannot be read', () => {
    expect(measureStorageUsage(undefined)).toBeNull();
    expect(measureStorageUsage({ length: 1, key: () => { throw new Error('blocked'); }, getItem: () => null })).toBeNull();
    expect(measureStorageUsage({ get length(): number { throw new Error('blocked'); }, key: () => null, getItem: () => null })).toBeNull();
  });
});
