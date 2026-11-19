/**
 * How much of the browser's localStorage this origin is using. Reads only.
 *
 * The quota is Chromium's, measured: 5,242,880 UTF-16 code units for every key name and value of the
 * origin together. That is not the 8 MiB the app allows per key, and it is shared with any other page
 * on the same origin. Other engines are unmeasured and may allow less.
 */
export const STORAGE_QUOTA_CHARS = 5_242_880;
/**
 * The early warning starts here, as a percentage of the quota. At 60% about 2.1 million characters are
 * left, which still fits one 5,000-row import (1.5 to 1.9 million as measured). At 70% it would not: a
 * 10,000-row ledger sits at 64-69%, and the import after it is the one that was seen to fail.
 */
export const STORAGE_WARNING_PERCENT = 60;

export interface StorageUsage {
  usedChars: number;
  quotaChars: number;
  /** Whole percent, rounded down so the warning never shows a number below its threshold; at most 100. */
  percent: number;
  level: 'ok' | 'warning';
}

type ReadableStorage = Pick<Storage, 'length' | 'key' | 'getItem'>;

function browserStorage(): ReadableStorage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

export function storageUsage(usedChars: number, quotaChars = STORAGE_QUOTA_CHARS): StorageUsage {
  return {
    usedChars, quotaChars,
    percent: Math.min(100, Math.floor(usedChars * 100 / quotaChars)),
    level: usedChars * 100 >= quotaChars * STORAGE_WARNING_PERCENT ? 'warning' : 'ok',
  };
}

/** Sum of the lengths of all key names and values, or null when storage cannot be read. */
export function measureStorageUsage(storage: ReadableStorage | undefined = browserStorage()): StorageUsage | null {
  if (!storage) return null;
  try {
    let used = 0;
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key !== null) used += key.length + (storage.getItem(key)?.length ?? 0);
    }
    return storageUsage(used);
  } catch {
    return null;
  }
}

const characters = new Intl.NumberFormat('id-ID');

/** "3.380.910 dari 5.242.880 karakter" */
export function storageUsageText(usage: StorageUsage): string {
  return `${characters.format(usage.usedChars)} dari ${characters.format(usage.quotaChars)} karakter`;
}
