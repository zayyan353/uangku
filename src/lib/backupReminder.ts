/**
 * Record of the last "Cadangkan semuanya" download, kept under its own key and
 * never inside the ledger format.
 *
 * Limits: a browser cannot confirm that the file was really kept on the device.
 * "Recorded" here means the download was triggered without an error.
 */
export const LAST_BACKUP_KEY = 'uangku:last-backup:v1';

export interface LastBackup {
  /** ISO 8601 time the download was triggered. */
  at: string;
  /** Fingerprint of the stored ledger text that was exported. */
  fingerprint: string;
}

const MAX_RECORD_CHARS = 512;
const FINGERPRINT_PATTERN = /^[0-9]+:[0-9a-f]{14}$/;

/**
 * Cheap, stable fingerprint of the stored ledger text (the exact string under
 * `uangku:v1`, also the controller's revision token). Entries have no
 * `createdAt`, so later code compares fingerprints, not dates. Not a security
 * hash: it only has to change when the ledger text changes.
 */
export function ledgerFingerprint(raw: string): string {
  // cyrb53: two 32-bit lanes folded into 53 bits.
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return `${raw.length}:${hash.toString(16).padStart(14, '0')}`;
}

function isValidRecord(value: unknown): value is LastBackup {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const { at, fingerprint } = value as Record<string, unknown>;
  return typeof at === 'string' && at.length <= 40 && !Number.isNaN(Date.parse(at)) && new Date(at).toISOString() === at
    && typeof fingerprint === 'string' && FINGERPRINT_PATTERN.test(fingerprint);
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

/** Last recorded backup, or null when absent, unreadable or malformed. */
export function readLastBackup(storage: StorageLike | undefined = browserStorage()): LastBackup | null {
  try {
    const text = storage?.getItem(LAST_BACKUP_KEY);
    if (!text || text.length > MAX_RECORD_CHARS) return null;
    const value: unknown = JSON.parse(text);
    return isValidRecord(value) ? { at: value.at, fingerprint: value.fingerprint } : null;
  } catch {
    return null;
  }
}

/**
 * Records a triggered full backup. Returns false when storage is unavailable or
 * full; a failed record must never undo or block the download itself.
 */
export function recordBackup(storedLedger: string, at: Date = new Date(), storage: StorageLike | undefined = browserStorage()): boolean {
  if (!storage || Number.isNaN(at.getTime())) return false;
  const record: LastBackup = { at: at.toISOString(), fingerprint: ledgerFingerprint(storedLedger) };
  try {
    storage.setItem(LAST_BACKUP_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}
