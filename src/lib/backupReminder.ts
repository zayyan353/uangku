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

const BACKUP_TIME_FORMAT = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul',
});

/** Short text for the sidebar and mobile footer, in the app's reporting time zone. */
export function lastBackupLabel(record: LastBackup | null): string {
  if (!record) return 'Cadangan terakhir: belum ada';
  const at = new Date(record.at);
  if (Number.isNaN(at.getTime())) return 'Cadangan terakhir: belum ada';
  return `Cadangan terakhir: ${BACKUP_TIME_FORMAT.format(at)}`;
}

/** Day (YYYY-MM-DD, app time zone) on which the reminder was closed "until tomorrow". */
export const REMINDER_DISMISSED_KEY = 'uangku:backup-reminder-dismissed:v1';
export const BACKUP_REMINDER_DAYS = 7;
const DAY_MS = 86_400_000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type BackupReminderReason = 'never' | 'stale';

/**
 * Why the reminder should show, or null. Shows when there is no recorded full
 * backup, or when the last one is older than seven days and the stored ledger
 * changed since (fingerprints differ; entries have no createdAt). Closing it
 * hides it for the rest of that calendar day.
 */
export function backupReminderReason(input: {
  lastBackup: LastBackup | null;
  /** Fingerprint of the stored ledger now; null when nothing is stored. */
  currentFingerprint: string | null;
  now: number;
  today: string;
  dismissedOn: string | null;
}): BackupReminderReason | null {
  if (input.dismissedOn !== null && input.dismissedOn === input.today) return null;
  if (!input.lastBackup) return 'never';
  const age = input.now - Date.parse(input.lastBackup.at);
  if (!(age > BACKUP_REMINDER_DAYS * DAY_MS)) return null;
  return input.currentFingerprint === input.lastBackup.fingerprint ? null : 'stale';
}

export function readReminderDismissed(storage: StorageLike | undefined = browserStorage()): string | null {
  try {
    const value = storage?.getItem(REMINDER_DISMISSED_KEY);
    return value && DAY_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

/** Optional UI hint: a failed write only means the reminder may show again. */
export function dismissReminder(today: string, storage: StorageLike | undefined = browserStorage()): boolean {
  if (!storage || !DAY_PATTERN.test(today)) return false;
  try {
    storage.setItem(REMINDER_DISMISSED_KEY, today);
    return true;
  } catch {
    return false;
  }
}
