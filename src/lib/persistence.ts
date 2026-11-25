/** Fresh minimum reconstruction. This is not a byte-for-byte restore of cloud Package B. */
import { STORAGE_KEY, prepareBackup, serializeBackup, type StoredData, type StoredRead } from './storage';
import { CATEGORY_SETTINGS_KEY, validateCategorySettings, type CategorySettings } from './categorySettings';
import { effectiveCategorySettings } from './categorySettingsUpgrade';
import { serializeFullBackup } from './fullBackup';
import { BUDGETS_KEY, parseStoredBudgets, serializeBudgets, type BudgetMap } from './budgets';
import { parseStoredTemplates, serializeTemplates, TEMPLATES_KEY, type TransactionTemplate } from './transactionTemplates';
import { LEDGER_LOCK, CATEGORY_LOCK, RESTORE_JOURNAL, baseClaimName, recoverProfile, restorePending, withProfileLocks, writeRestoredProfile } from './fullRestoreStorage';

export { LEDGER_LOCK };
export const PERSISTENCE_BYTES = 8 * 1024 * 1024;
/**
 * How long a write keeps the text it replaced claimed. Other tabs' views were measured to trail a write by tens of
 * milliseconds, and in a few runs by seconds; a view that trails for longer than this is not covered.
 */
export const BASE_CLAIM_MS = 30_000;
export type PersistenceStatus = 'unsaved' | 'saving' | 'saved' | 'failed' | 'conflict' | 'unsupported' | 'blocked';
export interface PersistenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface PersistenceLocks {
  runExclusive<T>(name: string, task: () => T | Promise<T>): Promise<T>;
  /**
   * Takes `name` if no tab holds it and keeps it for `lifetimeMs` or until the returned function is called.
   * Resolves to null when another holder has it. Without this member a write is a plain compare-and-set.
   */
  claim?(name: string, lifetimeMs: number): Promise<(() => void) | null>;
  /** Ends every hold on `name`, whoever has it. */
  revoke?(name: string): Promise<void>;
}
export interface PersistencePorts {
  read(): StoredRead;
  storage(): PersistenceStorage | undefined;
  locks(): PersistenceLocks | undefined;
  profileChanged?(): void;
}
export interface CandidateOptions {
  replaceBlocked?: boolean;
  expectedData?: StoredData;
  expectedToken?: string | null;
  /** budgets/templates: from a full backup; undefined keeps the browser's current ones. */
  restoreCategories?: { settings: CategorySettings; expectedRaw: string | null; budgets?: BudgetMap; templates?: TransactionTemplate[] };
}
export interface PersistenceSnapshot {
  data: StoredData;
  blocked: boolean;
  status: PersistenceStatus;
  error: string;
  dirty: boolean;
  pending: boolean;
  supported: boolean;
  remoteChanged: boolean;
  revisionToken: string | null;
}
interface PreparedCandidate { data: StoredData; raw: string }
export type CommitResult =
  | { status: 'saved'; data: StoredData; token: string }
  | { status: 'failed' | 'conflict' | 'unsupported'; message: string };

const unsupportedMessage = 'Browser ini tidak mendukung Web Locks. Perubahan belum tersimpan; unduh pemulihan dan gunakan browser yang mendukungnya.';
const conflictMessage = 'Data berubah di tab lain atau sejak formulir dibuka. Perubahan lokal belum tersimpan. Unduh pemulihan sebelum memuat data terbaru.';
const unreadableBackupMessage = 'Data asli belum bisa dibaca. Izinkan penyimpanan untuk situs ini, lalu muat catatan terbaru.';
const profileChangedMessage = 'Catatan atau kategori berubah sejak pratinjau dibuka. Buka kembali cadangan untuk memeriksa ulang.';

function freezeData(data: StoredData): StoredData {
  // Metadata contains nested source facts, references and transfer decisions.
  // Freezing only the financial arrays would let a caller change those facts
  // after a candidate had been queued behind another tab's lock.
  const seen = new WeakSet<object>();
  function freeze(value: unknown): void {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  freeze(data);
  return data;
}

/** Validate and detach a command's input before it enters an asynchronous queue. */
export function prepareCandidate(value: unknown): PreparedCandidate {
  const { data, raw } = prepareBackup(value);
  if (new TextEncoder().encode(raw).byteLength > PERSISTENCE_BYTES) {
    throw new Error('Ukuran data maksimal 8 MiB. Data lama belum diubah.');
  }
  return { data: freezeData(data), raw };
}

/** A write the browser refused for lack of room. Chromium and WebKit name it QuotaExceededError (legacy code 22); Firefox also uses NS_ERROR_DOM_QUOTA_REACHED (code 1014). */
export function isQuotaError(reason: unknown): boolean {
  if (reason === null || typeof reason !== 'object') return false;
  const { name, code } = reason as { name?: unknown; code?: unknown };
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}
/**
 * Says what happened and what to do. The advice is the one download that works while a save is pending:
 * a full backup is refused until the unsaved work is resolved. Deleting bank rows is not suggested: bank
 * facts are kept, and it is untested whether that frees room.
 */
export const STORAGE_FULL_MESSAGE = 'Penyimpanan browser penuh, jadi perubahan ini belum tersimpan. Catatan yang sudah tersimpan tetap utuh. Unduh pekerjaan yang belum tersimpan: file itu memuat seluruh transaksi termasuk perubahan ini.';

/** Lock names for one ledger write: the claim on the text it replaces, and the name its own text is claimed under. */
interface ClaimNames { base: string; /** null when the write changes no byte. */ next: string | null }

/** Hashed before the ledger lock is requested, so the lock is not held meanwhile. null: the port has no claims. */
async function claimNames(locks: PersistenceLocks, base: string | null, next: string): Promise<ClaimNames | null> {
  if (!locks.claim) return null;
  return { base: await baseClaimName(base), next: next === base ? null : await baseClaimName(next) };
}

/**
 * Inside the ledger lock, once the ledger text has been replaced. The claim on the replaced text stays until it
 * expires, unless no byte changed. The text now stored is a valid base again, even if an earlier write that moved
 * away from that very text (A to B, then back to A) still holds its claim on it, so that claim is ended.
 * Nothing here may fail the write: it is already stored, and at worst the next save waits out the older claim.
 */
async function ledgerWritten(locks: PersistenceLocks, names: ClaimNames, release: (() => void) | undefined): Promise<void> {
  try {
    if (names.next === null) release?.();
    else await locks.revoke?.(names.next);
  } catch { /* See above. */ }
}

async function commitPrepared(
  prepared: PreparedCandidate, expectedToken: string | null,
  storage: PersistenceStorage | undefined, locks: PersistenceLocks | undefined,
): Promise<CommitResult> {
  if (!locks) return { status: 'unsupported', message: unsupportedMessage };
  if (!storage) return { status: 'failed', message: 'Penyimpanan browser tidak tersedia. Perubahan lokal belum tersimpan.' };
  try {
    const names = await claimNames(locks, expectedToken, prepared.raw);
    // Every cooperating tab uses this same lock. Comparison and setItem occur in
    // one exclusive section; a storage listener alone would not prevent races.
    return await locks.runExclusive(LEDGER_LOCK, async () => {
      // The exclusive section is not enough by itself. A tab's view of localStorage can trail another tab's
      // write by milliseconds, and the lock is handed over without waiting for it: the next tab enters, still
      // reads the old text, passes the comparison and overwrites a save that both tabs reported as stored.
      // The lock manager is the one cross-tab state that is ordered with that hand-over, so a write also claims
      // the text it replaces there, as a lock name. While the claim is held no second write can start from the
      // same text, whatever its tab reads. The claim comes first: once it is refused, this tab's view of the
      // ledger, and of a restore journal it may still show, is known to trail and must not be acted on.
      const release = names ? await locks.claim?.(names.base, BASE_CLAIM_MS) : undefined;
      if (release === null) return { status: 'conflict' as const, message: conflictMessage };
      let written = false;
      try {
        if (storage.getItem(RESTORE_JOURNAL) !== null) await locks.runExclusive(CATEGORY_LOCK, () => recoverProfile(storage));
        if (storage.getItem(STORAGE_KEY) !== expectedToken) {
          return { status: 'conflict' as const, message: conflictMessage };
        }
        storage.setItem(STORAGE_KEY, prepared.raw);
        written = true;
      } finally {
        // Nothing was written, so the text is still a valid base, also for this tab's own retry.
        if (!written) release?.();
      }
      if (names) await ledgerWritten(locks, names, release);
      return { status: 'saved' as const, data: prepared.data, token: prepared.raw };
    });
  } catch (reason) {
    return { status: 'failed', message: isQuotaError(reason) ? STORAGE_FULL_MESSAGE : 'Penyimpanan gagal. Perubahan lokal belum tersimpan; unduh pemulihan atau coba lagi.' };
  }
}

/** Standalone coordinated writer, also used for pure regression tests. */
export async function commitCandidate(
  value: unknown, expectedToken: string | null,
  storage: PersistenceStorage | undefined, locks: PersistenceLocks | undefined,
): Promise<CommitResult> {
  let prepared: PreparedCandidate;
  try { prepared = prepareCandidate(value); }
  catch (reason) { return { status: 'failed', message: reason instanceof Error ? reason.message : 'Data tidak valid.' }; }
  return commitPrepared(prepared, expectedToken, storage, locks);
}

/**
 * Pure state controller. Only explicit commands write; subscriptions/effects
 * observe storage. Dirty candidates stay available after conflicts or failure.
 */
export class LedgerPersistenceController {
  private snapshot: PersistenceSnapshot;
  private baseToken: string | null;
  private blockedRaw: string | null;
  private draft: PreparedCandidate | null = null;
  private draftToken: string | null = null;
  private draftRetryBlocked = false;
  private readonly knownTokens = new WeakMap<StoredData, string | null>();
  private readonly listeners = new Set<() => void>();

  constructor(initial: StoredRead, private readonly ports: PersistencePorts) {
    const supported = Boolean(ports.locks());
    const data = freezeData(initial.data);
    this.baseToken = initial.token;
    this.blockedRaw = initial.blocked ? initial.token : null;
    this.knownTokens.set(data, initial.token);
    this.snapshot = {
      data, blocked: initial.blocked, supported, dirty: false, pending: false, remoteChanged: false,
      revisionToken: initial.token,
      status: initial.blocked ? 'blocked' : !supported ? 'unsupported' : initial.persisted ? 'saved' : 'unsaved',
      error: initial.error ?? (!supported ? unsupportedMessage : ''),
    };
  }

  getSnapshot = (): PersistenceSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(patch: Partial<PersistenceSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch, revisionToken: this.baseToken };
    for (const listener of this.listeners) listener();
  }

  async setCandidate(value: StoredData, _message = '', options: CandidateOptions = {}): Promise<boolean> {
    // A second event cannot replace a pending or failed draft, even before React
    // has rerendered to disable its controls.
    if (this.snapshot.pending || this.snapshot.dirty) return false;
    if (this.snapshot.blocked && !options.replaceBlocked) {
      this.update({ status: 'blocked', error: 'Data tersimpan belum dapat dibaca. Gunakan pemulihan atau mulai ulang yang dikonfirmasi; data lama belum diubah.' });
      return false;
    }
    let prepared: PreparedCandidate;
    try { prepared = prepareCandidate(value); }
    catch (reason) {
      this.update({ error: reason instanceof Error ? reason.message : 'Data tidak valid.' });
      return false;
    }
    if (options.restoreCategories) return this.restoreProfile(prepared, options.restoreCategories, options);
    this.draft = prepared;
    this.draftToken = this.baseToken;
    this.draftRetryBlocked = false;
    // undefined means no optional guard; null is a real guard for empty storage.
    const hasExpectedToken = options.expectedToken !== undefined;
    const staleToken = hasExpectedToken && options.expectedToken !== this.baseToken;
    const staleData = options.expectedData !== undefined && options.expectedData !== this.snapshot.data;
    if (staleToken || staleData) {
      if (hasExpectedToken && options.expectedToken !== undefined) this.draftToken = options.expectedToken;
      else if (options.expectedData && this.knownTokens.has(options.expectedData)) this.draftToken = this.knownTokens.get(options.expectedData)!;
      else this.draftRetryBlocked = true;
      this.update({ data: prepared.data, dirty: true, status: 'conflict', error: conflictMessage, remoteChanged: true });
      return false;
    }
    this.update({ data: prepared.data, dirty: true });
    return this.writeDraft();
  }

  private async restoreProfile(candidate: PreparedCandidate, categories: NonNullable<CandidateOptions['restoreCategories']>,
    options: CandidateOptions): Promise<boolean> {
    const locks = this.ports.locks(), storage = this.ports.storage();
    if (!locks || !storage) {
      this.update({ error: !locks ? unsupportedMessage : 'Penyimpanan browser tidak tersedia.' });
      return false;
    }
    const token = options.expectedToken === undefined ? this.baseToken : options.expectedToken;
    if (token !== this.baseToken || (options.expectedData !== undefined && options.expectedData !== this.snapshot.data)) {
      this.update({ error: 'Data berubah sejak pratinjau dibuka. Buka kembali cadangan untuk memeriksa ulang.' });
      return false;
    }
    let nextSettings: string;
    try { nextSettings = JSON.stringify(validateCategorySettings(categories.settings)); }
    catch (error) { this.update({ error: error instanceof Error ? error.message : 'Pengaturan kategori tidak valid.' }); return false; }
    let nextBudgets: string | undefined;
    try { if (categories.budgets) nextBudgets = serializeBudgets(categories.budgets); }
    catch (error) { this.update({ error: error instanceof Error ? error.message : 'Anggaran pada cadangan tidak valid.' }); return false; }
    let nextTemplates: string | undefined;
    try { if (categories.templates) nextTemplates = serializeTemplates(categories.templates); }
    catch (error) { this.update({ error: error instanceof Error ? error.message : 'Template pada cadangan tidak valid.' }); return false; }
    let budgetsNotSaved = false, templatesNotSaved = false;
    const expectedSettings = categories.expectedRaw;
    this.update({ pending: true, status: 'saving', error: '' });
    try {
      // Preserve legacy whitespace/encoding when only settings were changed.
      const nextLedger = token !== null && !this.snapshot.blocked && candidate.raw === serializeBackup(this.snapshot.data) ? token : candidate.raw;
      // A restore that replaces the ledger text claims the text it replaces, exactly as a save does (see commitPrepared).
      const names = nextLedger === token ? null : await claimNames(locks, token, nextLedger);
      await withProfileLocks(locks, async () => {
        const release = names ? await locks.claim?.(names.base, BASE_CLAIM_MS) : undefined;
        if (release === null) throw new Error(profileChangedMessage);
        let written = false;
        try {
          await recoverProfile(storage);
          if (storage.getItem(STORAGE_KEY) !== token || storage.getItem(CATEGORY_SETTINGS_KEY) !== expectedSettings) {
            throw new Error(profileChangedMessage);
          }
          await writeRestoredProfile(storage, token, nextLedger, expectedSettings, nextSettings);
          written = true;
        } finally {
          // A restore can stop part-way. The claim is given back only while this tab still reads the ledger it
          // claimed; if that cannot be told, the claim is kept and ends by itself.
          if (!written && release) { try { if (storage.getItem(STORAGE_KEY) === token) release(); } catch { /* Kept. */ } }
        }
        if (names) await ledgerWritten(locks, names, release);
        // After the ledger commit point. A failed write leaves the previous
        // budgets untouched and is reported; it never undoes the restore.
        if (nextBudgets !== undefined && storage.getItem(BUDGETS_KEY) !== nextBudgets) {
          try { storage.setItem(BUDGETS_KEY, nextBudgets); } catch { budgetsNotSaved = true; }
        }
        if (nextTemplates !== undefined && storage.getItem(TEMPLATES_KEY) !== nextTemplates) {
          try { storage.setItem(TEMPLATES_KEY, nextTemplates); } catch { templatesNotSaved = true; }
        }
      });
      this.baseToken = nextLedger;
      this.blockedRaw = null;
      this.knownTokens.set(candidate.data, nextLedger);
      this.update({ data: candidate.data, blocked: false, status: 'saved', pending: false, remoteChanged: false,
        error: budgetsNotSaved || templatesNotSaved
          ? `Catatan dan kategori sudah dipulihkan, tetapi ${budgetsNotSaved && templatesNotSaved ? 'anggaran dan template' : budgetsNotSaved ? 'anggaran' : 'template'} dari cadangan belum tersimpan. Periksa ruang penyimpanan browser.` : '' });
      this.ports.profileChanged?.();
      this.checkRemote();
      return true;
    } catch (error) {
      // A full-file restore never enters the ledger-only retry or recovery path.
      this.update({ pending: false, status: this.snapshot.blocked ? 'blocked' : 'failed',
        error: error instanceof Error && error.name === 'Error' ? error.message : 'Pemulihan lengkap gagal. Periksa ruang penyimpanan lalu buka kembali file cadangan.' });
      this.ports.profileChanged?.();
      return false;
    }
  }

  exportFullBackup = async (expectedCategoryRaw: string | null): Promise<string> => {
    const storage = this.ports.storage(), locks = this.ports.locks();
    if (!storage || (this.snapshot.blocked && this.blockedRaw === null)) throw new Error(unreadableBackupMessage);
    const ledger = this.snapshot.data, token = this.baseToken;
    const verify = () => {
      if (this.snapshot.blocked || this.snapshot.dirty || this.snapshot.pending || this.snapshot.data !== ledger ||
          storage.getItem(RESTORE_JOURNAL) !== null || storage.getItem(STORAGE_KEY) !== token ||
          storage.getItem(CATEGORY_SETTINGS_KEY) !== expectedCategoryRaw) {
        throw new Error('Cadangan lengkap belum dapat dibuat. Periksa status penyimpanan dan muat catatan serta kategori terbaru.');
      }
    };
    const exportCurrent = () => {
      verify();
      const file = serializeFullBackup(ledger, effectiveCategorySettings(expectedCategoryRaw).settings, parseStoredBudgets(storage.getItem(BUDGETS_KEY)),
        parseStoredTemplates(storage.getItem(TEMPLATES_KEY)));
      verify();
      return file;
    };
    if (!locks) return exportCurrent();
    return withProfileLocks(locks, async () => { await recoverProfile(storage); return exportCurrent(); });
  };

  private async writeDraft(): Promise<boolean> {
    const draft = this.draft;
    if (!draft || this.snapshot.pending || this.draftRetryBlocked) return false;
    const locks = this.ports.locks();
    this.update({ pending: true, status: 'saving', error: '', supported: Boolean(locks) });
    const result = await commitPrepared(draft, this.draftToken, this.ports.storage(), locks);
    if (result.status === 'saved') {
      this.baseToken = result.token;
      this.blockedRaw = null;
      this.knownTokens.set(result.data, result.token);
      this.draft = null;
      this.update({ data: result.data, blocked: false, pending: false, dirty: false, status: 'saved', error: '', remoteChanged: false });
      // Another tab can acquire the lock immediately after us. This read only
      // synchronizes a clean view; it never writes a now-obsolete snapshot.
      this.checkRemote();
      return true;
    }
    this.update({ pending: false, dirty: true, status: result.status, error: result.message, remoteChanged: result.status === 'conflict' || this.snapshot.remoteChanged });
    return false;
  }

  retry = async (): Promise<boolean> => this.writeDraft();

  recoveryText = (): string => {
    if (this.draft) return this.draft.raw;
    if (this.snapshot.blocked) {
      if (this.blockedRaw !== null) return this.blockedRaw;
      throw new Error(unreadableBackupMessage);
    }
    // Permissions or another tab may change before a focus/storage event arrives.
    let current: string | null, journal: string | null;
    try {
      const storage = this.ports.storage();
      if (!storage) throw new Error();
      journal = storage.getItem(RESTORE_JOURNAL);
      current = storage.getItem(STORAGE_KEY);
    } catch { throw new Error(unreadableBackupMessage); }
    if (journal !== null) throw new Error(restorePending);
    if (current !== this.baseToken) throw new Error('Catatan tersimpan sudah berubah. Muat catatan terbaru sebelum mengunduh cadangan.');
    return serializeBackup(this.snapshot.data);
  };

  /** The caller must confirm discarding a dirty draft before invoking this. */
  reloadLatest = (): boolean => {
    if (this.snapshot.pending) return false;
    const latest = this.ports.read();
    if (latest.blocked) {
      this.blockedRaw = latest.token;
      if (!this.snapshot.dirty) this.baseToken = latest.token;
      this.update({ blocked: true, status: 'blocked', error: latest.error ?? 'Data terbaru tidak dapat dibaca.', remoteChanged: true });
      return false;
    }
    const data = freezeData(latest.data);
    this.baseToken = latest.token;
    this.blockedRaw = null;
    this.draft = null;
    this.draftRetryBlocked = false;
    this.knownTokens.set(data, latest.token);
    const supported = Boolean(this.ports.locks());
    this.update({ data, blocked: false, supported, dirty: false, pending: false, remoteChanged: false,
      status: !supported ? 'unsupported' : latest.persisted ? 'saved' : 'unsaved', error: supported ? '' : unsupportedMessage });
    return true;
  };

  checkRemote = (): void => {
    if (this.snapshot.pending) return;
    if (!this.snapshot.dirty) {
      // Identical bytes already have a validated, immutable snapshot. A local
      // successful write and a focus event should not parse and validate the
      // entire ledger again. A changed token still goes through readStored's
      // atomic data/token read below; the next write always checks CAS in-lock.
      // Blocked reads must retry even if the raw token remains null/unchanged.
      try {
        const storage = this.ports.storage();
        if (!this.snapshot.blocked && storage && storage.getItem(STORAGE_KEY) === this.baseToken) return;
      } catch { /* readStored supplies the protected error state below. */ }
      // readStored returns ledger+token from one getItem, avoiding a mismatched
      // data/token pair if a different tab writes while this callback runs.
      const latest = this.ports.read();
      if (latest.token === this.baseToken && !latest.blocked && !this.snapshot.blocked) return;
      if (latest.blocked) {
        this.blockedRaw = latest.token;
        this.baseToken = latest.token;
        this.update({ blocked: true, status: 'blocked', error: latest.error ?? 'Data terbaru tidak dapat dibaca.', remoteChanged: true });
        return;
      }
      this.reloadLatest();
      return;
    }
    try {
      const storage = this.ports.storage();
      if (!storage) throw new Error('Storage unavailable');
      if (storage.getItem(STORAGE_KEY) !== this.draftToken) {
        this.update({ status: 'conflict', error: conflictMessage, remoteChanged: true });
      }
    } catch {
      this.update({ status: 'failed', error: 'Penyimpanan tidak dapat diperiksa. Perubahan lokal tetap tersedia untuk pemulihan.' });
    }
  };
}
