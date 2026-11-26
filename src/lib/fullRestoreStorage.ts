import { CATEGORY_SETTINGS_KEY } from './categorySettings';
import { STORAGE_KEY } from './storage';
import { digestStorageText, MetadataConflict, storageClaimName, withMetadataClaims } from './metadataClaims';
import type { PersistenceLocks, PersistenceStorage } from './persistence';

export const LEDGER_LOCK = `${STORAGE_KEY}:coordinated-write`;
export { BASE_CLAIM_MS } from './metadataClaims';
export const CATEGORY_LOCK = 'uangku:category-settings';
export const RESTORE_JOURNAL = 'uangku:full-restore:v1';
export const PROFILE_CHANGED = 'uangku:profile-changed';
export const restorePending = 'Pemulihan lengkap sedang diperiksa. Tunggu sebelum mengubah atau mencadangkan data.';
const journalLimit = 2 * 1024 * 1024;

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Runs a task while holding an exclusive Web Lock and gives back its result or its error.
 * The lock callback itself never rejects: Firefox reports a rejected lock callback as an
 * unhandled rejection even when the caller handles the request. The task's error is thrown
 * here instead, once the lock is released, which is when a rejected callback surfaced too.
 */
export async function requestExclusive<T>(manager: Pick<LockManager, 'request'>, name: string,
  task: () => T | Promise<T>): Promise<T> {
  const outcome: Settled<T> = await manager.request(name, { mode: 'exclusive' }, async (): Promise<Settled<T>> => {
    try { return { ok: true, value: await task() }; }
    catch (error) { return { ok: false, error }; }
  });
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

/**
 * Takes `name` if no tab holds it and keeps it until the returned release function is called or the name is stolen.
 * Resolves to null when the name is already held. As in requestExclusive, the lock callback never rejects.
 * The request's own promise is handled here: a refusal before the lock is held rejects the claim; a rejection
 * afterwards is the AbortError of a claim that revokeLock ended, and is ignored.
 */
export function claimLock(manager: Pick<LockManager, 'request'>, name: string): Promise<(() => void) | null> {
  return new Promise<(() => void) | null>((resolve, reject) => {
    let answered = false;
    manager.request(name, { mode: 'exclusive', ifAvailable: true }, lock => {
      answered = true;
      if (lock === null) { resolve(null); return undefined; }
      return new Promise<void>(free => resolve(free));
    }).catch(error => { if (!answered) reject(error); });
  });
}

/** Ends every hold on `name`, whichever tab has it. The stolen lock is given up at once. */
export async function revokeLock(manager: Pick<LockManager, 'request'>, name: string): Promise<void> {
  await manager.request(name, { steal: true }, () => undefined);
}

export function browserLocks(): PersistenceLocks | undefined {
  const manager = globalThis.navigator?.locks;
  if (!manager?.request) return undefined;
  return {
    runExclusive: <T>(name: string, task: () => T | Promise<T>) => requestExclusive(manager, name, task),
    claim: (name: string) => claimLock(manager, name),
    revoke: (name: string) => revokeLock(manager, name),
  };
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

/** Ledger base claim shared by readers and writers of the original ledger key. */
export const baseClaimName = (token: string | null) => storageClaimName(token, LEDGER_LOCK);

function parseJournal(raw: string): Journal {
  const fail = () => { throw new Error('Catatan pemulihan lengkap tidak dapat dibaca. Data tersimpan belum diubah.'); };
  if (raw.length > journalLimit) return fail();
  // A journal that is not JSON gets the same message as one of the wrong shape, not the parser's own text.
  let j;
  try { j = JSON.parse(raw); } catch { return fail(); }
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

/**
 * Both writer locks must be held. Writers already guard their ledger base. A
 * reader supplies its lock manager to check whether another tab has displaced
 * the ledger it sees. False means the reader must wait for a fresher view.
 */
export async function recoverProfile(storage: PersistenceStorage, readerLocks?: PersistenceLocks, categoryLocks = readerLocks): Promise<boolean> {
  const raw = storage.getItem(RESTORE_JOURNAL);
  if (raw === null) return true;
  const ledger = storage.getItem(STORAGE_KEY);
  if (readerLocks?.claim) {
    const release = await readerLocks.claim(await baseClaimName(ledger));
    if (release === null) return false;
    release();
  }
  const journal = parseJournal(raw);
  const current = await digestStorageText(ledger);
  function finish(guarded: PersistenceStorage) {
    // A different view may arrive during the digest or the category claim.
    if (categoryLocks?.claim && (guarded.getItem(RESTORE_JOURNAL) !== raw || guarded.getItem(STORAGE_KEY) !== ledger)) return false;
    if (current === journal.beforeLedger) undoStagedCategories(guarded, journal);
    // A committed restore or a later ledger needs no rollback.
    guarded.removeItem(RESTORE_JOURNAL);
    return true;
  }
  if (current !== journal.beforeLedger || !categoryLocks?.claim) return finish(storage);
  // Even skipping rollback based on a mismatch would discard the journal.
  // Establish that the visible categories are current before making that decision.
  const base = { key: CATEGORY_SETTINGS_KEY, raw: storage.getItem(CATEGORY_SETTINGS_KEY), message: restorePending };
  try { return await withMetadataClaims(storage, categoryLocks, [base], finish); }
  catch (error) {
    if (error instanceof MetadataConflict) return false;
    throw error;
  }
}

export async function finishInterruptedRestore(storage: PersistenceStorage, locks: PersistenceLocks | undefined) {
  if (storage.getItem(RESTORE_JOURNAL) === null) return;
  if (!locks) throw new Error(restorePending);
  await withProfileLocks(locks, () => recoverProfile(storage, locks));
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
  const journal: Journal = { beforeLedger: await digestStorageText(previousLedger), afterLedger: (await digestStorageText(nextLedger))!,
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
