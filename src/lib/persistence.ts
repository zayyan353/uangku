/** Fresh minimum reconstruction. This is not a byte-for-byte restore of cloud Package B. */
import { STORAGE_KEY, prepareBackup, serializeBackup, type StoredData, type StoredRead } from './storage';

export const LEDGER_LOCK = `${STORAGE_KEY}:coordinated-write`;
export const PERSISTENCE_BYTES = 8 * 1024 * 1024;
export type PersistenceStatus = 'unsaved' | 'saving' | 'saved' | 'failed' | 'conflict' | 'unsupported' | 'blocked';
export interface PersistenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface PersistenceLocks {
  runExclusive<T>(name: string, task: () => T | Promise<T>): Promise<T>;
}
export interface PersistencePorts {
  read(): StoredRead;
  storage(): PersistenceStorage | undefined;
  locks(): PersistenceLocks | undefined;
}
export interface CandidateOptions {
  replaceBlocked?: boolean;
  expectedData?: StoredData;
  expectedToken?: string | null;
}
export interface PersistenceSnapshot {
  data: StoredData;
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

async function commitPrepared(
  prepared: PreparedCandidate, expectedToken: string | null,
  storage: PersistenceStorage | undefined, locks: PersistenceLocks | undefined,
): Promise<CommitResult> {
  if (!locks) return { status: 'unsupported', message: unsupportedMessage };
  if (!storage) return { status: 'failed', message: 'Penyimpanan browser tidak tersedia. Perubahan lokal belum tersimpan.' };
  try {
    // Every cooperating tab uses this same lock. Comparison and setItem occur in
    // one exclusive section; a storage listener alone would not prevent races.
    return await locks.runExclusive(LEDGER_LOCK, () => {
      if (storage.getItem(STORAGE_KEY) !== expectedToken) {
        return { status: 'conflict' as const, message: conflictMessage };
      }
      storage.setItem(STORAGE_KEY, prepared.raw);
      return { status: 'saved' as const, data: prepared.data, token: prepared.raw };
    });
  } catch {
    return { status: 'failed', message: 'Penyimpanan gagal atau penuh. Perubahan lokal belum tersimpan; unduh pemulihan atau coba lagi.' };
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
  private blocked: boolean;
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
    this.blocked = initial.blocked;
    this.blockedRaw = initial.blocked ? initial.token : null;
    this.knownTokens.set(data, initial.token);
    this.snapshot = {
      data, supported, dirty: false, pending: false, remoteChanged: false,
      revisionToken: initial.token,
      status: !supported ? 'unsupported' : initial.blocked ? 'blocked' : initial.persisted ? 'saved' : 'unsaved',
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
    if (this.blocked && !options.replaceBlocked) {
      this.update({ status: 'blocked', error: 'Data tersimpan belum dapat dibaca. Gunakan pemulihan atau mulai ulang yang dikonfirmasi; data lama belum diubah.' });
      return false;
    }
    let prepared: PreparedCandidate;
    try { prepared = prepareCandidate(value); }
    catch (reason) {
      this.update({ error: reason instanceof Error ? reason.message : 'Data tidak valid.' });
      return false;
    }
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

  private async writeDraft(): Promise<boolean> {
    const draft = this.draft;
    if (!draft || this.snapshot.pending || this.draftRetryBlocked) return false;
    const locks = this.ports.locks();
    this.update({ pending: true, status: 'saving', error: '', supported: Boolean(locks) });
    const result = await commitPrepared(draft, this.draftToken, this.ports.storage(), locks);
    if (result.status === 'saved') {
      this.baseToken = result.token;
      this.blocked = false;
      this.blockedRaw = null;
      this.knownTokens.set(result.data, result.token);
      this.draft = null;
      this.update({ data: result.data, pending: false, dirty: false, status: 'saved', error: '', remoteChanged: false });
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
    if (this.blocked && this.blockedRaw !== null) return this.blockedRaw;
    return serializeBackup(this.snapshot.data);
  };

  /** The caller must confirm discarding a dirty draft before invoking this. */
  reloadLatest = (): boolean => {
    if (this.snapshot.pending) return false;
    const latest = this.ports.read();
    if (latest.blocked) {
      this.blocked = true;
      this.blockedRaw = latest.token;
      if (!this.snapshot.dirty) this.baseToken = latest.token;
      this.update({ status: 'blocked', error: latest.error ?? 'Data terbaru tidak dapat dibaca.', remoteChanged: true });
      return false;
    }
    const data = freezeData(latest.data);
    this.baseToken = latest.token;
    this.blocked = false;
    this.blockedRaw = null;
    this.draft = null;
    this.draftRetryBlocked = false;
    this.knownTokens.set(data, latest.token);
    const supported = Boolean(this.ports.locks());
    this.update({ data, supported, dirty: false, pending: false, remoteChanged: false,
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
        if (!this.blocked && storage && storage.getItem(STORAGE_KEY) === this.baseToken) return;
      } catch { /* readStored supplies the protected error state below. */ }
      // readStored returns ledger+token from one getItem, avoiding a mismatched
      // data/token pair if a different tab writes while this callback runs.
      const latest = this.ports.read();
      if (latest.token === this.baseToken && !latest.blocked && !this.blocked) return;
      if (latest.blocked) {
        this.blocked = true;
        this.blockedRaw = latest.token;
        this.baseToken = latest.token;
        this.update({ status: 'blocked', error: latest.error ?? 'Data terbaru tidak dapat dibaca.', remoteChanged: true });
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
