import { CATEGORY_SETTINGS_KEY } from './categorySettings';
import { STORAGE_KEY } from './storage';
import type { PersistenceLocks, PersistenceStorage } from './persistence';

export const LEDGER_LOCK = `${STORAGE_KEY}:coordinated-write`;
export const CATEGORY_LOCK = 'uangku:category-settings';
export const RESTORE_JOURNAL = 'uangku:full-restore:v1';
export const PROFILE_CHANGED = 'uangku:profile-changed';
export const restorePending = 'Pemulihan lengkap sedang diperiksa. Tunggu sebelum mengubah atau mencadangkan data.';
const journalLimit = 2 * 1024 * 1024;

export function browserLocks(): PersistenceLocks | undefined {
  const manager = globalThis.navigator?.locks;
  if (!manager?.request) return undefined;
  return { async runExclusive<T>(name: string, task: () => T | Promise<T>) {
    return await manager.request(name, { mode: 'exclusive' }, async () => await task());
  } };
}

export function withProfileLocks<T>(locks: PersistenceLocks, action: () => Promise<T> | T): Promise<T> {
  return locks.runExclusive(LEDGER_LOCK, () => locks.runExclusive(CATEGORY_LOCK, action));
}

interface Journal {
  beforeLedger: string | null;
  afterLedger: string;
  beforeCategories: string | null;
  afterCategories: string;
}

async function digest(raw: string | null) {
  if (raw === null) return null;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

function parseJournal(raw: string): Journal {
  const fail = () => { throw new Error('Catatan pemulihan lengkap tidak dapat dibaca. Data tersimpan belum diubah.'); };
  if (raw.length > journalLimit) return fail();
  const j = JSON.parse(raw);
  const isDigest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (!j || Object.keys(j).length !== 4 || !isDigest(j.afterLedger) ||
      (j.beforeLedger !== null && !isDigest(j.beforeLedger)) || typeof j.afterCategories !== 'string' ||
      (j.beforeCategories !== null && typeof j.beforeCategories !== 'string')) return fail();
  return j;
}

function undoStagedCategories(storage: PersistenceStorage, journal: Journal) {
  // An older tab may have performed a new edit after an interrupted restore.
  // Only undo this restore's own staged bytes.
  if (storage.getItem(CATEGORY_SETTINGS_KEY) !== journal.afterCategories) return;
  if (journal.beforeCategories === null) storage.removeItem(CATEGORY_SETTINGS_KEY);
  else storage.setItem(CATEGORY_SETTINGS_KEY, journal.beforeCategories);
}

/** Both legacy writer locks must already be held. The ledger write is the commit point. */
export async function recoverProfile(storage: PersistenceStorage) {
  const raw = storage.getItem(RESTORE_JOURNAL);
  if (raw === null) return;
  const journal = parseJournal(raw);
  const current = await digest(storage.getItem(STORAGE_KEY));
  if (current === journal.beforeLedger) undoStagedCategories(storage, journal);
  // The target ledger means the restore committed. An unrelated ledger belongs
  // to a later writer. Neither permits undoing financial or category edits.
  storage.removeItem(RESTORE_JOURNAL);
}

export async function finishInterruptedRestore(storage: PersistenceStorage, locks: PersistenceLocks | undefined) {
  if (storage.getItem(RESTORE_JOURNAL) === null) return;
  if (!locks) throw new Error(restorePending);
  await withProfileLocks(locks, () => recoverProfile(storage));
}

/** Caller has checked both exact tokens under both writer locks. No normal write changes formats. */
export async function writeRestoredProfile(storage: PersistenceStorage, previousLedger: string | null,
  nextLedger: string, previousCategories: string | null, nextCategories: string) {
  if (previousLedger === nextLedger) {
    if (previousCategories !== nextCategories) storage.setItem(CATEGORY_SETTINGS_KEY, nextCategories);
    return;
  }
  if (previousCategories === nextCategories) {
    storage.setItem(STORAGE_KEY, nextLedger);
    return;
  }
  const journal: Journal = { beforeLedger: await digest(previousLedger), afterLedger: (await digest(nextLedger))!,
    beforeCategories: previousCategories, afterCategories: nextCategories };
  const raw = JSON.stringify(journal);
  if (raw.length > journalLimit) throw new Error('Pengaturan kategori lama terlalu besar untuk dipulihkan dengan aman.');
  storage.setItem(RESTORE_JOURNAL, raw);
  try {
    storage.setItem(CATEGORY_SETTINGS_KEY, nextCategories);
    storage.setItem(STORAGE_KEY, nextLedger);
  } catch (error) {
    undoStagedCategories(storage, journal);
    storage.removeItem(RESTORE_JOURNAL);
    throw error;
  }
  // Both payloads are durable. If cleanup is interrupted, the stored target
  // digest lets the next opener finish without writing either payload again.
  try { storage.removeItem(RESTORE_JOURNAL); } catch { /* recover on next read */ }
}
