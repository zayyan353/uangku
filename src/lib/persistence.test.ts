import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitCandidate, isQuotaError, LEDGER_LOCK, LedgerPersistenceController, prepareCandidate, STORAGE_FULL_MESSAGE, type PersistenceLocks, type PersistencePorts, type PersistenceStorage } from './persistence';
import { STORAGE_KEY, makeDemoData, serializeBackup, validateBackup, type StoredData, type StoredRead } from './storage';
import { CATEGORY_LOCK, finishInterruptedRestore, RESTORE_JOURNAL } from './fullRestoreStorage';
import { CATEGORY_SETTINGS_KEY, type CategorySettings } from './categorySettings';
import { BUDGETS_KEY, type BudgetMap } from './budgets';
import { TEMPLATES_KEY, type TransactionTemplate } from './transactionTemplates';

function data(ids: string[] = []): StoredData {
  return { app: 'uangku', version: 1, demo: false, state: {
    version: 1,
    wallets: [{ id: 'bank', name: 'Bank', currency: 'TRY', kind: 'bank', openingBalance: 100_000 }],
    entries: ids.map(id => ({ id, date: '2026-10-30', type: 'expense', walletId: 'bank', amount: 100, category: '', note: id })),
  } };
}
class MemoryStorage implements PersistenceStorage {
  raw: string | null = null;
  journal: string | null = null;
  writes = 0;
  failWrites = false;
  failReads = false;
  getItem(key: string) { if (this.failReads) throw new Error('unavailable'); if (key === RESTORE_JOURNAL) return this.journal; expect(key).toBe(STORAGE_KEY); return this.raw; }
  removeItem(_key: string) { throw new Error('Ledger-only saves must not remove stored records'); }
  setItem(key: string, value: string) {
    expect(key).toBe(STORAGE_KEY);
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.raw = value; this.writes += 1;
  }
}
class SerialLocks implements PersistenceLocks {
  private tail: Promise<void> = Promise.resolve();
  names: string[] = [];
  async runExclusive<T>(name: string, task: () => T | Promise<T>): Promise<T> {
    this.names.push(name);
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await task(); } finally { release(); }
  }
}
function environment(raw: string | null = null) {
  const storage = new MemoryStorage(); storage.raw = raw;
  const locks = new SerialLocks();
  const read = (): StoredRead => {
    let token: string | null = null;
    try {
      token = storage.getItem(STORAGE_KEY);
      return { data: token === null ? data() : validateBackup(JSON.parse(token)), token, persisted: token !== null, blocked: false, error: null };
    } catch { return { data: data(), token, persisted: false, blocked: true, error: 'Data lama tidak terbaca.' }; }
  };
  const ports: PersistencePorts = { read, storage: () => storage, locks: () => locks };
  return { storage, locks, read, ports, controller: () => new LedgerPersistenceController(read(), ports) };
}

describe('coordinated persistence: fresh minimum reconstruction', () => {
  it('does not write initial/demo data while mounting or observing storage', () => {
    const env = environment();
    const controller = env.controller();
    controller.checkRemote();
    expect(controller.getSnapshot().status).toBe('unsaved');
    expect(env.storage.writes).toBe(0);
  });

  it('serializes simultaneous writers and preserves the losing draft', async () => {
    const env = environment(JSON.stringify(data()));
    const a = env.controller(), b = env.controller();
    const outcomes = await Promise.all([a.setCandidate(data(['a'])), b.setCandidate(data(['b']))]);
    expect(outcomes).toEqual([true, false]);
    expect(JSON.parse(env.storage.raw!).state.entries.map((x: { id: string }) => x.id)).toEqual(['a']);
    expect(b.getSnapshot()).toMatchObject({ dirty: true, pending: false, status: 'conflict' });
    expect(JSON.parse(b.recoveryText()).state.entries[0].id).toBe('b');
    expect(env.locks.names).toHaveLength(2);
    expect(new Set(env.locks.names).size).toBe(1);
  });

  it('rejects a sequential stale writer even when no storage event was delivered', async () => {
    const env = environment(JSON.stringify(data()));
    const a = env.controller(), b = env.controller();
    await a.setCandidate(data(['a']));
    const durable = env.storage.raw;
    expect(await b.setCandidate(data(['b']))).toBe(false);
    expect(env.storage.raw).toBe(durable);
  });

  it('retains one quota-failed candidate and retries without adding an entry', async () => {
    const env = environment(JSON.stringify(data()));
    const controller = env.controller(); const durable = env.storage.raw;
    env.storage.failWrites = true;
    expect(await controller.setCandidate(data(['draft']))).toBe(false);
    expect(env.storage.raw).toBe(durable);
    expect(controller.getSnapshot()).toMatchObject({ dirty: true, pending: false, status: 'failed' });
    expect(JSON.parse(controller.recoveryText()).state.entries).toHaveLength(1);
    env.storage.failWrites = false;
    expect(await controller.retry()).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ dirty: false, status: 'saved' });
    expect(JSON.parse(env.storage.raw!).state.entries).toHaveLength(1);
    expect(env.storage.writes).toBe(1);
  });

  it('retry of a failed candidate cannot overwrite a subsequent remote change', async () => {
    const env = environment(JSON.stringify(data()));
    const a = env.controller(), b = env.controller();
    env.storage.failWrites = true;
    await a.setCandidate(data(['draft']));
    env.storage.failWrites = false;
    await b.setCandidate(data(['remote']));
    const durable = env.storage.raw;
    expect(await a.retry()).toBe(false);
    expect(a.getSnapshot().status).toBe('conflict');
    expect(env.storage.raw).toBe(durable);
    expect(JSON.parse(a.recoveryText()).state.entries[0].id).toBe('draft');
  });

  it('rejects another local command before a pending save can rerender', async () => {
    const env = environment(); const controller = env.controller();
    const first = controller.setCandidate(data(['one']));
    expect(controller.getSnapshot().pending).toBe(true);
    expect(await controller.setCandidate(data(['two']))).toBe(false);
    expect(await first).toBe(true);
    expect(JSON.parse(env.storage.raw!).state.entries[0].id).toBe('one');
  });

  it('does not replace an existing failed draft with a second command', async () => {
    const env = environment(); const controller = env.controller();
    env.storage.failWrites = true;
    await controller.setCandidate(data(['one']));
    expect(await controller.setCandidate(data(['two']))).toBe(false);
    expect(JSON.parse(controller.recoveryText()).state.entries[0].id).toBe('one');
  });

  it('detaches command input before asynchronous lock acquisition', async () => {
    const env = environment(); const candidate = data(['one']);
    const promise = env.controller().setCandidate(candidate);
    candidate.state.entries[0].amount = 999;
    candidate.state.entries.push(data(['two']).state.entries[0]);
    expect(await promise).toBe(true);
    const persisted = JSON.parse(env.storage.raw!);
    expect(persisted.state.entries).toHaveLength(1);
    expect(persisted.state.entries[0].amount).toBe(100);
  });

  it('never writes without Web Locks and keeps the staged candidate recoverable', async () => {
    const env = environment(); const ports = { ...env.ports, locks: () => undefined };
    const controller = new LedgerPersistenceController(env.read(), ports);
    expect(controller.getSnapshot().status).toBe('unsupported');
    expect(await controller.setCandidate(data(['one']))).toBe(false);
    expect(env.storage.writes).toBe(0);
    expect(controller.getSnapshot()).toMatchObject({ dirty: true, status: 'unsupported' });
    expect(JSON.parse(controller.recoveryText()).state.entries[0].id).toBe('one');
  });

  it('synchronizes clean views without writing', async () => {
    const env = environment(JSON.stringify(data()));
    const a = env.controller(), b = env.controller();
    await a.setCandidate(data(['a']));
    b.checkRemote();
    expect(b.getSnapshot().data.state.entries[0].id).toBe('a');
    expect(b.getSnapshot()).toMatchObject({ dirty: false, status: 'saved', revisionToken: env.storage.raw });
    expect(env.storage.writes).toBe(1);
  });

  it('reuses an immutable clean snapshot for identical durable bytes without parsing again', async () => {
    const env = environment(JSON.stringify(data()));
    let fullReads = 0;
    const read = () => { fullReads++; return env.read(); };
    const controller = new LedgerPersistenceController(read(), { ...env.ports, read });
    const initial = controller.getSnapshot().data;
    controller.checkRemote();
    expect(fullReads).toBe(1);
    expect(controller.getSnapshot().data).toBe(initial);
    expect(await controller.setCandidate(data(['one']))).toBe(true);
    expect(fullReads).toBe(1);
    expect(env.storage.writes).toBe(1);
    expect(controller.getSnapshot().data.state.entries[0].id).toBe('one');
  });

  it('a raw-token peek cannot associate old data with a newer token when a tab writes between reads', () => {
    const env = environment(JSON.stringify(data()));
    const controller = env.controller();
    env.storage.raw = JSON.stringify(data(['first-remote']));
    const original = env.storage.getItem.bind(env.storage);
    let intervened = false;
    env.storage.getItem = (key: string) => {
      const raw = original(key);
      if (!intervened) { intervened = true; env.storage.raw = JSON.stringify(data(['newest-remote'])); }
      return raw;
    };
    controller.checkRemote();
    expect(controller.getSnapshot().data.state.entries[0].id).toBe('newest-remote');
    expect(controller.getSnapshot().revisionToken).toBe(env.storage.raw);
    expect(env.storage.writes).toBe(0);
  });

  it('keeps dirty drafts intact when a remote event arrives', async () => {
    const env = environment(); const a = env.controller();
    env.storage.failWrites = true; await a.setCandidate(data(['draft']));
    env.storage.failWrites = false; env.storage.raw = JSON.stringify(data(['remote']));
    a.checkRemote();
    expect(a.getSnapshot()).toMatchObject({ dirty: true, status: 'conflict', remoteChanged: true });
    expect(a.getSnapshot().data.state.entries[0].id).toBe('draft');
  });

  it('rejects an editor built from an old render after a clean sync', async () => {
    const env = environment(JSON.stringify(data())); const controller = env.controller();
    const oldData = controller.getSnapshot().data;
    const oldToken = controller.getSnapshot().revisionToken;
    env.storage.raw = JSON.stringify(data(['remote'])); controller.checkRemote();
    const durable = env.storage.raw;
    expect(await controller.setCandidate(data(['stale-editor']), '', { expectedData: oldData, expectedToken: oldToken })).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ dirty: true, status: 'conflict' });
    expect(await controller.retry()).toBe(false);
    expect(env.storage.raw).toBe(durable);
    expect(JSON.parse(controller.recoveryText()).state.entries[0].id).toBe('stale-editor');
  });

  it('supports the explicit null token guard for a formerly empty ledger', async () => {
    const env = environment(); const controller = env.controller();
    env.storage.raw = JSON.stringify(data(['remote'])); controller.checkRemote();
    expect(await controller.setCandidate(data(['old']), '', { expectedToken: null })).toBe(false);
    expect(await controller.retry()).toBe(false);
    expect(JSON.parse(env.storage.raw!).state.entries[0].id).toBe('remote');
  });

  it('treats an undefined optional token as absent, while null remains meaningful', async () => {
    const env = environment(JSON.stringify(data())); const controller = env.controller();
    expect(await controller.setCandidate(data(['one']), '', { expectedToken: undefined })).toBe(true);
    expect(JSON.parse(env.storage.raw!).state.entries[0].id).toBe('one');
  });

  it('protects corrupted storage until an explicitly confirmed replacement', async () => {
    const env = environment('{broken'); const controller = env.controller();
    expect(controller.recoveryText()).toBe('{broken');
    expect(await controller.setCandidate(data(['one']))).toBe(false);
    expect(env.storage.raw).toBe('{broken');
    expect(await controller.setCandidate(data(['one']), '', { replaceBlocked: true })).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ status: 'saved', dirty: false });
  });

  it.each([true, false])('never exports the display demo from unreadable storage (Web Locks available: %s)', async supported => {
    const original = JSON.stringify(data(['personal']));
    const env = environment(original);
    env.storage.failReads = true;
    const controller = new LedgerPersistenceController({ ...env.read(), data: makeDemoData() }, {
      ...env.ports, locks: () => supported ? env.locks : undefined,
    });
    expect(controller.getSnapshot()).toMatchObject({ blocked: true, data: { demo: true } });
    expect(() => controller.recoveryText()).toThrow(/Data asli belum bisa dibaca/);
    await expect(controller.exportFullBackup(null)).rejects.toThrow(/Data asli belum bisa dibaca/);
    expect(env.storage.raw).toBe(original);
    env.storage.failReads = false;
    expect(controller.reloadLatest()).toBe(true);
    expect(controller.getSnapshot().blocked).toBe(false);
    expect(JSON.parse(controller.recoveryText())).toEqual(JSON.parse(original));
    expect(env.storage.writes).toBe(0);
  });

  it('checks a clean demo against storage at download time, even without a focus or storage event', () => {
    const env = environment();
    const controller = new LedgerPersistenceController({ ...env.read(), data: makeDemoData() }, env.ports);
    expect(JSON.parse(controller.recoveryText()).demo).toBe(true);
    env.storage.journal = 'pending';
    expect(() => controller.recoveryText()).toThrow(/Pemulihan lengkap sedang diperiksa/);
    env.storage.journal = null;
    env.storage.raw = JSON.stringify(data(['personal']));
    expect(() => controller.recoveryText()).toThrow(/Catatan tersimpan sudah berubah/);
    env.storage.failReads = true;
    expect(() => controller.recoveryText()).toThrow(/Data asli belum bisa dibaca/);
    expect(env.storage.writes).toBe(0);
  });

  it('still exports a genuine pending edit when the original is inaccessible during a reload', async () => {
    const original = JSON.stringify(data(['stored']));
    const env = environment(original);
    const controller = env.controller();
    env.storage.failReads = true;
    expect(await controller.setCandidate(data(['stored', 'draft']))).toBe(false);
    expect(controller.reloadLatest()).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ blocked: true, dirty: true });
    expect(controller.recoveryText()).toBe(serializeBackup(data(['stored', 'draft'])));
    expect(env.storage.raw).toBe(original);
  });

  it('compares the corrupted original bytes before confirmed replacement', async () => {
    const env = environment('{broken'); const controller = env.controller();
    env.storage.raw = JSON.stringify(data(['remote']));
    expect(await controller.setCandidate(data(['restore']), '', { replaceBlocked: true })).toBe(false);
    expect(JSON.parse(env.storage.raw!).state.entries[0].id).toBe('remote');
    expect(controller.getSnapshot().status).toBe('conflict');
  });

  it('can explicitly recover corruption observed after a formerly clean read', async () => {
    const env = environment(JSON.stringify(data(['old']))); const controller = env.controller();
    env.storage.raw = '{new-corruption';
    controller.checkRemote();
    expect(controller.getSnapshot().status).toBe('blocked');
    expect(controller.recoveryText()).toBe('{new-corruption');
    expect(await controller.setCandidate(data(['restore']), '', { replaceBlocked: true })).toBe(true);
    expect(JSON.parse(env.storage.raw!).state.entries[0].id).toBe('restore');
  });

  it('unblocks an initially inaccessible empty storage after a clean focus read', async () => {
    const env = environment(); env.storage.failReads = true;
    const controller = env.controller();
    expect(controller.getSnapshot().status).toBe('blocked');
    expect(controller.getSnapshot().revisionToken).toBeNull();
    env.storage.failReads = false;
    controller.checkRemote();
    expect(controller.getSnapshot()).toMatchObject({ status: 'unsaved', error: '', dirty: false });
    expect(env.storage.writes).toBe(0);
    expect(await controller.setCandidate(data(['one']))).toBe(true);
  });

  it('explicit reload replaces a dirty view only with a valid current ledger', async () => {
    const env = environment(); const controller = env.controller();
    env.storage.failWrites = true; await controller.setCandidate(data(['draft']));
    env.storage.failWrites = false; env.storage.raw = '{bad';
    expect(controller.reloadLatest()).toBe(false);
    expect(JSON.parse(controller.recoveryText()).state.entries[0].id).toBe('draft');
    env.storage.raw = JSON.stringify(data(['remote']));
    expect(controller.reloadLatest()).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ dirty: false, status: 'saved' });
    expect(controller.getSnapshot().data.state.entries[0].id).toBe('remote');
  });

  it('rejects invalid commands before writing or replacing the current view', async () => {
    const env = environment(JSON.stringify(data())); const controller = env.controller();
    const invalid = data(['bad']); invalid.state.entries[0].amount = 0;
    expect(await controller.setCandidate(invalid)).toBe(false);
    expect(env.storage.writes).toBe(0);
    expect(controller.getSnapshot().dirty).toBe(false);
    expect(controller.getSnapshot().data.state.entries).toHaveLength(0);
  });

  it('standalone writer reports lock/read failure without a write', async () => {
    const env = environment(); env.storage.failReads = true;
    expect((await commitCandidate(data(['one']), null, env.storage, env.locks)).status).toBe('failed');
    expect(env.storage.writes).toBe(0);
    const throwingLocks: PersistenceLocks = { runExclusive: async () => { throw new Error('lock error'); } };
    expect((await commitCandidate(data(['one']), null, env.storage, throwingLocks)).status).toBe('failed');
  });

  it('MW-97: names a full browser store and keeps the generic message for other failures', async () => {
    const refusing = (reason: unknown): PersistenceStorage => ({ getItem: () => null, removeItem: () => undefined, setItem: () => { throw reason; } });
    const locks = environment().locks;
    const full = 'Penyimpanan browser penuh, jadi perubahan ini belum tersimpan. Catatan yang sudah tersimpan tetap utuh. Unduh pekerjaan yang belum tersimpan: file itu memuat seluruh transaksi termasuk perubahan ini.';
    const generic = 'Penyimpanan gagal. Perubahan lokal belum tersimpan; unduh pemulihan atau coba lagi.';
    expect(STORAGE_FULL_MESSAGE).toBe(full);
    // Chromium and WebKit, Firefox's legacy name, and the legacy numeric codes on an object without a usable name.
    for (const reason of [new DOMException('The quota has been exceeded.', 'QuotaExceededError'), { name: 'NS_ERROR_DOM_QUOTA_REACHED', code: 1014 }, { name: 'Error', code: 22 }]) {
      expect(isQuotaError(reason)).toBe(true);
      expect(await commitCandidate(data(['one']), null, refusing(reason), locks)).toEqual({ status: 'failed', message: full });
    }
    for (const reason of [new Error('QuotaExceededError'), new DOMException('Denied', 'SecurityError'), 'QuotaExceededError', null, undefined]) {
      expect(isQuotaError(reason)).toBe(false);
      expect(await commitCandidate(data(['one']), null, refusing(reason), locks)).toEqual({ status: 'failed', message: generic });
    }
    // The advice never includes deleting records to make room.
    expect(full).not.toMatch(/hapus/i);
  });

  it('MW-97: a refused write leaves the stored ledger and the unsaved draft as they were', async () => {
    const env = environment();
    expect((await commitCandidate(data(['kept']), null, env.storage, env.locks)).status).toBe('saved');
    const before = env.storage.raw;
    const controller = env.controller();
    const original = env.storage.setItem.bind(env.storage);
    env.storage.setItem = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); };
    expect(await controller.setCandidate(data(['kept', 'new']))).toBe(false);
    expect(env.storage.raw).toBe(before);
    expect(controller.getSnapshot()).toMatchObject({ status: 'failed', dirty: true, error: STORAGE_FULL_MESSAGE });
    expect(controller.getSnapshot().data.state.entries.map(entry => entry.id)).toEqual(['kept', 'new']);
    env.storage.setItem = original;
  });

  it('uses compact JSON without changing Unicode or the v1 envelope', async () => {
    const env = environment(); const candidate = data(['one']);
    candidate.state.entries[0].note = 'İstanbul • uang 👛';
    expect((await commitCandidate(candidate, null, env.storage, env.locks)).status).toBe('saved');
    expect(env.storage.raw).toBe(JSON.stringify(validateBackup(candidate)));
    expect(JSON.parse(env.storage.raw!).version).toBe(1);
    expect(JSON.parse(env.storage.raw!).state.entries[0].note).toBe(candidate.state.entries[0].note);
  });

  it('detaches and recursively freezes source metadata before lock acquisition', async () => {
    const env = environment();
    const candidate: StoredData = { ...data(['one']), metadata: {
      policy: 'unverified-unless-linked', facts: [], links: [], statements: [],
      creationOrigins: [{ entryId: 'one', origin: 'manual' }],
    } };
    const prepared = prepareCandidate(candidate);
    expect(Object.isFrozen(prepared.data.metadata)).toBe(true);
    expect(Object.isFrozen(prepared.data.metadata!.creationOrigins)).toBe(true);
    expect(Object.isFrozen(prepared.data.metadata!.creationOrigins![0])).toBe(true);
    expect(() => { prepared.data.metadata!.creationOrigins![0].origin = 'bank'; }).toThrow();
    const saving = env.controller().setCandidate(candidate);
    candidate.metadata!.creationOrigins![0].origin = 'bank';
    candidate.metadata!.creationOrigins!.push({ entryId: 'not-persisted', origin: 'manual' });
    expect(await saving).toBe(true);
    expect(validateBackup(JSON.parse(env.storage.raw!)).metadata!.creationOrigins)
      .toEqual([{ entryId: 'one', origin: 'manual' }]);
  });

  it('retains source metadata in quota recovery and retry without downgrading to v1', async () => {
    const env = environment(); const controller = env.controller();
    const candidate: StoredData = { ...data(['one']), metadata: {
      policy: 'unverified-unless-linked', facts: [], links: [], statements: [],
      creationOrigins: [{ entryId: 'one', origin: 'manual' }],
    } };
    env.storage.failWrites = true;
    expect(await controller.setCandidate(candidate)).toBe(false);
    const recovery = controller.recoveryText();
    expect(JSON.parse(recovery).version).toBe(2);
    expect(validateBackup(JSON.parse(recovery))).toEqual(candidate);
    env.storage.failWrites = false;
    expect(await controller.retry()).toBe(true);
    expect(env.storage.raw).toBe(recovery);
    expect(env.storage.raw).toBe(serializeBackup(candidate));
    expect(validateBackup(JSON.parse(env.storage.raw!)).state.entries).toHaveLength(1);
  });
});

const text = (ids: string[] = []) => serializeBackup(data(ids));
const notes = (raw: string | null) => raw === null ? [] : JSON.parse(raw).state.entries.map((entry: { note: string }) => entry.note);
/** Written out here, not imported: the name is what tabs of different releases must agree on. */
const claimName = (token: string | null, namespace = LEDGER_LOCK) => `${namespace}:base:${token === null ? 'kosong' : createHash('sha256').update(token).digest('hex')}`;

/**
 * One origin with several tabs. Each tab reads its own copy of storage, which shows another tab's write only
 * after deliver(): the storage event that arrives some milliseconds after the write, as measured in Firefox,
 * Chromium and WebKit. A tab sees its own writes at once.
 */
class Origin {
  readonly durable = new Map<string, string>();
  /** Which tab wrote the ledger, in order. */
  readonly ledgerWriters: string[] = [];
  /** One lock manager per origin; unlike the views it does not trail. */
  readonly locks = new OriginLocks();
  private readonly views: TabStorage[] = [];
  constructor(ledger: string | null, other: Record<string, string> = {}) {
    if (ledger !== null) this.durable.set(STORAGE_KEY, ledger);
    for (const [key, value] of Object.entries(other)) this.durable.set(key, value);
  }
  get ledger() { return this.durable.get(STORAGE_KEY) ?? null; }
  tab(name: string, locks: PersistenceLocks = this.locks) {
    const storage = new TabStorage(this, name);
    this.views.push(storage);
    const read = (): StoredRead => {
      const token = storage.getItem(STORAGE_KEY);
      return { data: token === null ? data() : validateBackup(JSON.parse(token)), token, persisted: token !== null, blocked: false, error: null };
    };
    const ports: PersistencePorts = { read, storage: () => storage, locks: () => locks };
    return { storage, controller: new LedgerPersistenceController(read(), ports) };
  }
  /** The storage events arrive: every tab now reads what is stored. */
  deliver() { for (const view of this.views) view.catchUp(); }
}
class TabStorage implements PersistenceStorage {
  private view: Map<string, string>;
  reads: string[] = [];
  /** Makes this tab's matching writes fail the way a full browser store does. */
  refuse: ((key: string, value: string) => boolean) | null = null;
  unreadable: string | null = null;
  constructor(private readonly origin: Origin, private readonly name: string) { this.view = new Map(origin.durable); }
  getItem(key: string) {
    this.reads.push(key);
    if (key === this.unreadable) throw new DOMException('Synthetic denial', 'SecurityError');
    return this.view.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.refuse?.(key, value)) throw new DOMException('Synthetic quota', 'QuotaExceededError');
    this.view.set(key, value); this.origin.durable.set(key, value);
    if (key === STORAGE_KEY) this.origin.ledgerWriters.push(this.name);
  }
  removeItem(key: string) { this.view.delete(key); this.origin.durable.delete(key); }
  catchUp() { this.view = new Map(this.origin.durable); }
}
/** Exclusive locks per name plus the two optional members: a claim lasts until its holder releases it or another writer revokes it. */
class OriginLocks implements PersistenceLocks {
  private queues = new Map<string, Promise<void>>();
  private inside = new Set<string>();
  private claims = new Map<string, symbol>();
  requested: Array<{ name: string; insideLedgerLock: boolean }> = [];
  revoked: string[] = [];
  failClaim: unknown = null;
  failRevoke: unknown = null;
  async runExclusive<T>(name: string, task: () => T | Promise<T>): Promise<T> {
    const previous = this.queues.get(name);
    let release!: () => void;
    this.queues.set(name, new Promise<void>(resolve => { release = resolve; }));
    await previous;
    this.inside.add(name);
    try { return await task(); } finally { this.inside.delete(name); release(); }
  }
  async claim(name: string): Promise<(() => void) | null> {
    this.requested.push({ name, insideLedgerLock: this.inside.has(LEDGER_LOCK) });
    if (this.failClaim) throw this.failClaim;
    if (this.claims.has(name)) return null;
    const holder = Symbol(name);
    this.claims.set(name, holder);
    // As measured in the three engines: a release by a holder whose claim was revoked does not free a later claim on that name.
    return () => { if (this.claims.get(name) === holder) this.claims.delete(name); };
  }
  async revoke(name: string): Promise<void> {
    this.revoked.push(name);
    if (this.failRevoke) throw this.failRevoke;
    this.claims.delete(name);
  }
  held() { return [...this.claims.keys()].sort(); }
  isInside(name: string) { return this.inside.has(name); }
}

describe('MW-164b: full backup from a tab that has not seen a save yet', () => {
  it.each([null, text(['before'])])('refuses the displaced base and exports the winner once delivered', async base => {
    const origin = new Origin(base);
    const writer = origin.tab('writer'), reader = origin.tab('reader');
    expect(await writer.controller.setCandidate(data(['winner']))).toBe(true);
    expect(reader.storage.getItem(STORAGE_KEY)).toBe(base);
    expect(reader.storage.getItem(RESTORE_JOURNAL)).toBeNull();
    await expect(reader.controller.exportFullBackup(null)).rejects.toThrow(/muat catatan serta kategori terbaru/);
    expect(origin.locks.held()).toEqual([claimName(base)]);

    origin.deliver();
    reader.controller.checkRemote();
    const backup = JSON.parse(await reader.controller.exportFullBackup(null));
    expect(backup.ledger).toEqual(data(['winner']));
    expect(origin.locks.held()).toEqual([claimName(base)]);
    expect(origin.ledgerWriters).toEqual(['writer']);
  });

  it('returns the claim even when backup contents cannot be read', async () => {
    const base = text(['kept']), origin = new Origin(base);
    const reader = origin.tab('reader');
    reader.storage.unreadable = BUDGETS_KEY;
    await expect(reader.controller.exportFullBackup(null)).rejects.toThrow();
    expect(origin.locks.requested).toEqual([{ name: claimName(base), insideLedgerLock: true }]);
    expect(origin.locks.held()).toEqual([]);
    reader.storage.unreadable = null;
    expect(await reader.controller.setCandidate(data(['next']))).toBe(true);
  });
});

describe('MW-164a: conflict during automatic cash wallet cleanup', () => {
  function setup() {
    const legacy = data(['kept']);
    legacy.state.wallets.push({ id: 'cash', name: 'Cash', currency: 'TRY', kind: 'cash', openingBalance: 0 });
    const origin = new Origin(serializeBackup(legacy));
    const a = origin.tab('winner'), b = origin.tab('observer');
    const base = b.controller.getSnapshot();
    const cleanup = () => b.controller.setCandidate(data(['kept']), '', {
      automaticCashCleanup: true, expectedData: base.data, expectedToken: base.revisionToken,
    });
    const statuses: string[] = [];
    b.controller.subscribe(() => statuses.push(b.controller.getSnapshot().status));
    return { origin, a, b, base, cleanup, statuses };
  }

  it('discards only the losing cleanup and adopts the winner once the stale view catches up', async () => {
    const { origin, a, b, base, cleanup, statuses } = setup();
    expect(await a.controller.setCandidate(data(['kept', 'new']))).toBe(true);
    const saving = cleanup();
    expect(b.controller.getSnapshot()).toMatchObject({ status: 'saving', dirty: false, pending: true });
    expect(await saving).toBe(false);
    expect(b.controller.getSnapshot()).toMatchObject({ status: 'saved', dirty: false, pending: false });
    // Preserve the identity the effect already attempted while the browser still reads the old bytes.
    expect(b.controller.getSnapshot().data).toBe(base.data);
    expect(await b.controller.retry()).toBe(false);
    origin.deliver(); b.controller.checkRemote();
    expect(notes(b.controller.recoveryText())).toEqual(['kept', 'new']);
    expect(statuses).not.toContain('conflict');
    expect(origin.ledgerWriters).toEqual(['winner']);
  });

  it('leaves the newest clean snapshot alone if the cleanup was calculated before a refresh', async () => {
    const { origin, a, b, cleanup, statuses } = setup();
    expect(await a.controller.setCandidate(data(['kept', 'new']))).toBe(true);
    origin.deliver(); b.controller.checkRemote();
    const latest = b.controller.getSnapshot();
    expect(await cleanup()).toBe(false);
    expect(b.controller.getSnapshot()).toBe(latest);
    expect(statuses).not.toContain('conflict');
    expect(origin.ledgerWriters).toEqual(['winner']);
  });

  it.each(['storage event', 'retry'])('preserves a quota-failed cleanup until a %s detects a competing write', async path => {
    const { origin, a, b, cleanup, statuses } = setup();
    b.storage.refuse = key => key === STORAGE_KEY;
    expect(await cleanup()).toBe(false);
    expect(b.controller.getSnapshot()).toMatchObject({ status: 'failed', dirty: true, error: STORAGE_FULL_MESSAGE });
    expect(await a.controller.setCandidate(data(['kept', 'new']))).toBe(true);
    origin.deliver();
    if (path === 'storage event') b.controller.checkRemote();
    else expect(await b.controller.retry()).toBe(false);
    expect(b.controller.getSnapshot()).toMatchObject({ status: 'saved', dirty: false });
    expect(notes(b.controller.recoveryText())).toEqual(['kept', 'new']);
    expect(statuses).not.toContain('conflict');
  });

  it('keeps a pending or failed manual draft even when cleanup is requested', async () => {
    const { b, cleanup } = setup();
    b.storage.refuse = key => key === STORAGE_KEY;
    const saving = b.controller.setCandidate(data(['manual']));
    expect(await cleanup()).toBe(false);
    expect(await saving).toBe(false);
    expect(await cleanup()).toBe(false);
    expect(notes(b.controller.recoveryText())).toEqual(['manual']);
    b.storage.refuse = null;
    expect(await b.controller.retry()).toBe(true);
    expect(notes(b.controller.recoveryText())).toEqual(['manual']);
  });
});

describe('MW-162: a save claims the text it was built on', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("refuses a save from a tab whose view of storage trails another tab's save", async () => {
    const origin = new Origin(text());
    const a = origin.tab('A'), b = origin.tab('B');
    expect(await a.controller.setCandidate(data(['a']))).toBe(true);
    // No storage event has arrived: also inside the ledger lock B reads the text both tabs started from.
    expect(b.storage.getItem(STORAGE_KEY)).toBe(text());
    expect(await b.controller.setCandidate(data(['b']))).toBe(false);
    expect(notes(origin.ledger)).toEqual(['a']);
    expect(origin.ledgerWriters).toEqual(['A']);
    expect(a.controller.getSnapshot()).toMatchObject({ dirty: false, status: 'saved' });
    expect(b.controller.getSnapshot()).toMatchObject({ dirty: true, pending: false, status: 'conflict', remoteChanged: true });
    expect(notes(b.controller.recoveryText())).toEqual(['b']);
    // The loser cannot write its stale draft later either, before or after the event arrives.
    expect(await b.controller.retry()).toBe(false);
    origin.deliver(); b.controller.checkRemote();
    expect(await b.controller.retry()).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(await b.controller.retry()).toBe(false);
    expect(notes(origin.ledger)).toEqual(['a']);
    expect(origin.ledgerWriters).toEqual(['A']);
  });

  it('lets exactly one of two saves that queue behind the ledger lock succeed', async () => {
    const origin = new Origin(text());
    const tabs = [origin.tab('A'), origin.tab('B')];
    const outcomes = await Promise.all([tabs[0].controller.setCandidate(data(['a'])), tabs[1].controller.setCandidate(data(['b']))]);
    // Which of the two enters the lock first is not fixed; exactly one may write.
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(origin.ledgerWriters).toHaveLength(1);
    const winner = outcomes[0] ? 0 : 1;
    expect(notes(origin.ledger)).toEqual([['a'], ['b']][winner]);
    expect(tabs[1 - winner].controller.getSnapshot()).toMatchObject({ dirty: true, pending: false, status: 'conflict' });
    expect(notes(tabs[1 - winner].controller.recoveryText())).toEqual([['a'], ['b']][1 - winner]);
  });

  it('refuses a no-change save from a trailing view, which would put the old text back', async () => {
    const origin = new Origin(text());
    const a = origin.tab('A'), b = origin.tab('B');
    expect(await a.controller.setCandidate(data(['a']))).toBe(true);
    expect(await b.controller.setCandidate(data())).toBe(false);
    expect(notes(origin.ledger)).toEqual(['a']);
    expect(b.controller.getSnapshot().status).toBe('conflict');
  });

  it('takes the claim first inside the ledger lock, for 30 seconds, under the SHA-256 of the exact base text', async () => {
    const origin = new Origin(text());
    const a = origin.tab('A');
    expect(await a.controller.setCandidate(data(['a']))).toBe(true);
    expect(origin.locks.requested).toEqual([{ name: claimName(text()), insideLedgerLock: true }]);
    expect(claimName(text())).toMatch(/^uangku:v1:coordinated-write:base:[a-f0-9]{64}$/);
    // The claim outlives the ledger lock and ends by itself.
    expect(origin.locks.held()).toEqual([claimName(text())]);
    vi.advanceTimersByTime(29_999);
    expect(origin.locks.held()).toEqual([claimName(text())]);
    vi.advanceTimersByTime(1);
    expect(origin.locks.held()).toEqual([]);
  });

  it('keeps the base claimed for 30 seconds after a write that waited longer than that for journal recovery', async () => {
    const journal = JSON.stringify({ beforeLedger: null, afterLedger: '0'.repeat(64), beforeCategories: null, afterCategories: '{}' });
    const origin = new Origin(text(), { [RESTORE_JOURNAL]: journal });
    const a = origin.tab('A'), b = origin.tab('B');

    let releaseCategory!: () => void, sawJournal!: () => void;
    const categoryGate = new Promise<void>(resolve => { releaseCategory = resolve; });
    const recoveryStarted = new Promise<void>(resolve => { sawJournal = resolve; });
    const get = a.storage.getItem.bind(a.storage);
    vi.spyOn(a.storage, 'getItem').mockImplementation(key => {
      if (key === RESTORE_JOURNAL) sawJournal();
      return get(key);
    });
    const categoryHolder = origin.locks.runExclusive(CATEGORY_LOCK, () => categoryGate);
    const saving = a.controller.setCandidate(data(['first']));
    await recoveryStarted;
    await vi.advanceTimersByTimeAsync(45_000);
    expect(origin.ledgerWriters).toEqual([]);
    releaseCategory();
    await categoryHolder;
    expect(await saving).toBe(true);
    vi.advanceTimersByTime(29_999);
    expect(await b.controller.setCandidate(data(['stale']))).toBe(false);
    expect(b.controller.getSnapshot().status).toBe('conflict');
    expect(notes(origin.ledger)).toEqual(['first']);
    vi.advanceTimersByTime(1);
    expect(origin.locks.held()).toEqual([]);
  });

  it('claims an empty store under a fixed name', async () => {
    const origin = new Origin(null);
    const a = origin.tab('A'), b = origin.tab('B');
    expect(await a.controller.setCandidate(data(['a']))).toBe(true);
    expect(origin.locks.requested.map(request => request.name)).toEqual(['uangku:v1:coordinated-write:base:kosong']);
    expect(await b.controller.setCandidate(data(['b']))).toBe(false);
    expect(notes(origin.ledger)).toEqual(['a']);
  });

  it('a refused claim ends in a conflict before anything is read or written', async () => {
    // An interrupted restore's journal is in B's view: recovering it from a trailing view would write.
    const origin = new Origin(text(), { [RESTORE_JOURNAL]: 'not a journal' });
    const a = origin.tab('A'), b = origin.tab('B');
    origin.durable.delete(RESTORE_JOURNAL); a.storage.catchUp();
    expect((await commitCandidate(data(['a']), text(), a.storage, origin.locks)).status).toBe('saved');
    b.storage.reads = [];
    expect(await commitCandidate(data(['b']), text(), b.storage, origin.locks)).toEqual({ status: 'conflict',
      message: 'Data berubah di tab lain atau sejak formulir dibuka. Perubahan lokal belum tersimpan. Unduh pemulihan sebelum memuat data terbaru.' });
    expect(b.storage.reads).toEqual([]);
    expect(origin.ledgerWriters).toEqual(['A']);
    expect(b.storage.getItem(RESTORE_JOURNAL)).toBe('not a journal');
  });

  it("a tab that has caught up saves on top of another tab's save, and one tab saves again and again", async () => {
    const origin = new Origin(text());
    const a = origin.tab('A'), b = origin.tab('B');
    expect(await a.controller.setCandidate(data(['a']))).toBe(true);
    expect(await a.controller.setCandidate(data(['a', 'a2']))).toBe(true);
    origin.deliver(); b.controller.checkRemote();
    expect(await b.controller.setCandidate(data(['a', 'a2', 'b']))).toBe(true);
    origin.deliver(); a.controller.checkRemote();
    expect(await a.controller.setCandidate(data(['a', 'a2', 'b', 'a3']))).toBe(true);
    expect(notes(origin.ledger)).toEqual(['a', 'a2', 'b', 'a3']);
    expect(origin.ledgerWriters).toEqual(['A', 'A', 'B', 'A']);
  });

  it('gives the claim back when the compare fails, so the same draft is saved once the view has caught up', async () => {
    const origin = new Origin(text());
    const a = origin.tab('A'), b = origin.tab('B');
    expect(await a.controller.setCandidate(data(['a']))).toBe(true);
    origin.deliver();                                              // B reads ['a']; its controller has not looked yet.
    expect(await a.controller.setCandidate(data())).toBe(true);    // Back to the first text; B's view trails again.
    // B saves on the first text. Nobody claims that text any more, but B reads ['a']: the compare refuses.
    expect(await b.controller.setCandidate(data(['b']))).toBe(false);
    expect(b.controller.getSnapshot().status).toBe('conflict');
    expect(origin.locks.held()).toEqual([claimName(text(['a']))]);
    origin.deliver();
    expect(await b.controller.retry()).toBe(true);
    expect(notes(origin.ledger)).toEqual(['b']);
  });

  it('gives the claim back when the browser refuses the write, so the retry is not refused by its own claim', async () => {
    const origin = new Origin(text());
    const a = origin.tab('A');
    a.storage.refuse = key => key === STORAGE_KEY;
    expect(await a.controller.setCandidate(data(['a']))).toBe(false);
    expect(a.controller.getSnapshot()).toMatchObject({ status: 'failed', dirty: true, pending: false, error: STORAGE_FULL_MESSAGE });
    expect(origin.locks.held()).toEqual([]);
    expect(origin.ledger).toBe(text());
    a.storage.refuse = null;
    expect(await a.controller.retry()).toBe(true);
    expect(notes(origin.ledger)).toEqual(['a']);
    expect(origin.locks.held()).toEqual([claimName(text())]);
  });

  it('gives the claim back when an unreadable restore journal stops the save', async () => {
    const origin = new Origin(text(), { [RESTORE_JOURNAL]: '{' });
    const a = origin.tab('A');
    expect((await commitCandidate(data(['a']), text(), a.storage, origin.locks)).status).toBe('failed');
    expect(origin.locks.requested).toHaveLength(1);
    expect(origin.locks.held()).toEqual([]);
    expect(origin.ledger).toBe(text());
  });

  it.each(['the tab that put the text back', 'a third tab'])('A, B, A: when the stored text returns to an earlier one, %s saves on it inside the 30 seconds', async who => {
    const origin = new Origin(text());
    const one = origin.tab('1'), two = origin.tab('2'), three = origin.tab('3');
    expect(await one.controller.setCandidate(data(['x']))).toBe(true);     // E to X: tab 1 claims E.
    two.storage.catchUp(); two.controller.checkRemote();
    expect(await two.controller.setCandidate(data())).toBe(true);          // X to E: E is stored again, so tab 1's claim on it ends.
    expect(origin.ledger).toBe(text());
    expect(origin.locks.revoked).toEqual([claimName(text(['x'])), claimName(text())]);
    expect(origin.locks.held()).toEqual([claimName(text(['x']))]);
    const next = who === 'a third tab' ? three : two;
    next.storage.catchUp(); next.controller.checkRemote();
    expect(await next.controller.setCandidate(data(['y']))).toBe(true);    // E to Y.
    expect(notes(origin.ledger)).toEqual(['y']);
    // Tab 1 has received nothing since its own save. It reads X, which tab 2 moved away from: refused.
    expect(one.storage.getItem(STORAGE_KEY)).toBe(text(['x']));
    expect(await one.controller.setCandidate(data(['x', 'late']))).toBe(false);
    expect(notes(origin.ledger)).toEqual(['y']);
  });

  it('a save that changes no byte leaves no claim behind', async () => {
    const origin = new Origin(text(['a']));
    const a = origin.tab('A'), b = origin.tab('B');
    expect(await a.controller.setCandidate(data(['a']))).toBe(true);
    expect(origin.ledgerWriters).toEqual(['A']);
    expect(origin.locks.held()).toEqual([]);
    expect(origin.locks.revoked).toEqual([]);
    expect(await b.controller.setCandidate(data(['a', 'b']))).toBe(true);
    expect(notes(origin.ledger)).toEqual(['a', 'b']);
  });

  it('a revoke that fails does not turn a stored save into a failure', async () => {
    const origin = new Origin(text());
    const a = origin.tab('A');
    origin.locks.failRevoke = new DOMException('Synthetic', 'InvalidStateError');
    expect(await a.controller.setCandidate(data(['a']))).toBe(true);
    expect(a.controller.getSnapshot()).toMatchObject({ status: 'saved', dirty: false, pending: false, error: '' });
    expect(notes(origin.ledger)).toEqual(['a']);
    expect(origin.locks.revoked).toEqual([claimName(text(['a']))]);
  });

  it('a claim request that fails is a failed save with nothing written', async () => {
    const origin = new Origin(text());
    const a = origin.tab('A');
    origin.locks.failClaim = new DOMException('Synthetic', 'InvalidStateError');
    expect(await a.controller.setCandidate(data(['a']))).toBe(false);
    expect(a.controller.getSnapshot()).toMatchObject({ status: 'failed', dirty: true, pending: false,
      error: 'Penyimpanan gagal. Perubahan lokal belum tersimpan; unduh pemulihan atau coba lagi.' });
    expect(origin.ledger).toBe(text());
    expect(origin.ledgerWriters).toEqual([]);
    origin.locks.failClaim = null;
    expect(await a.controller.retry()).toBe(true);
    expect(notes(origin.ledger)).toEqual(['a']);
  });

  it('without claim and revoke in the port a save is the compare-and-set it was', async () => {
    const origin = new Origin(text());
    const plain: PersistenceLocks = { runExclusive: (name, task) => origin.locks.runExclusive(name, task) };
    const a = origin.tab('A', plain), b = origin.tab('B', plain);
    const digest = vi.spyOn(crypto.subtle, 'digest');
    try {
      expect(await a.controller.setCandidate(data(['a']))).toBe(true);
      origin.deliver();
      expect(await b.controller.setCandidate(data(['b']))).toBe(false);
      expect(b.controller.getSnapshot().status).toBe('conflict');
      b.controller.reloadLatest();
      expect(await b.controller.setCandidate(data(['a', 'b']))).toBe(true);
      expect(notes(origin.ledger)).toEqual(['a', 'b']);
      expect(origin.locks.requested).toEqual([]);
      expect(origin.locks.revoked).toEqual([]);
      expect(digest).not.toHaveBeenCalled();
    } finally { digest.mockRestore(); }
  });

  it('hashes before it asks for the ledger lock, and one text per save once a tab saves on its own last save', async () => {
    const origin = new Origin(text(['hash']));
    const a = origin.tab('A');
    const hash = crypto.subtle.digest.bind(crypto.subtle);
    const insideLedgerLock: boolean[] = [];
    const digest = vi.spyOn(crypto.subtle, 'digest').mockImplementation((...input) => {
      insideLedgerLock.push(origin.locks.isInside(LEDGER_LOCK));
      return hash(...input);
    });
    try {
      expect(await a.controller.setCandidate(data(['hash', 'one']))).toBe(true);
      expect(digest).toHaveBeenCalledTimes(2);
      expect(await a.controller.setCandidate(data(['hash', 'one', 'two']))).toBe(true);
      expect(await a.controller.setCandidate(data(['hash', 'one', 'two', 'three']))).toBe(true);
      expect(digest).toHaveBeenCalledTimes(4);
      // The other tabs' saves wait for this lock; a ledger of megabytes is not hashed while it is held.
      expect(insideLedgerLock).toEqual([false, false, false, false]);
    } finally { digest.mockRestore(); }
  });
});

describe('coordinated full restore', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const settings: CategorySettings = { version: 1, names: ['Belum dikategorikan', 'Unused'], rules: [
    { id: 'personal', keyword: 'synthetic', category: 'Unused', mode: 'suggest' },
  ], keywordPackVersion: 7 };
  const after = JSON.stringify(settings), before = JSON.stringify({ ...settings, rules: [] });
  const oldCategoryClaim = claimName(before, CATEGORY_SETTINGS_KEY), newCategoryClaim = claimName(after, CATEGORY_SETTINGS_KEY);
  const changed = 'Catatan atau kategori berubah sejak pratinjau dibuka. Buka kembali cadangan untuk memeriksa ulang.';
  const profile = (ids: string[]) => new Origin(text(ids), { [CATEGORY_SETTINGS_KEY]: before });
  type Tab = ReturnType<Origin['tab']>;
  const restore = (tab: Tab, ids: string[], categories: { expectedRaw?: string; budgets?: BudgetMap } = {}) =>
    tab.controller.setCandidate(data(ids), '', { restoreCategories: { settings, expectedRaw: before, ...categories } });

  it.each(['export', 'restore'])('MW-164c: detects a stale category-only restore before %s', async operation => {
    const origin = profile(['kept']);
    const writer = origin.tab('writer'), reader = origin.tab('reader');
    expect(await restore(writer, ['kept'])).toBe(true);
    expect(reader.storage.getItem(CATEGORY_SETTINGS_KEY)).toBe(before);
    const durable = new Map(origin.durable);
    if (operation === 'export') await expect(reader.controller.exportFullBackup(before)).rejects.toThrow();
    else expect(await restore(reader, ['replacement'])).toBe(false);
    expect(origin.durable).toEqual(durable);
    origin.deliver();
    expect(JSON.parse(await reader.controller.exportFullBackup(after)).categorySettings).toEqual(settings);
  });

  it('MW-164c: preserves a journal that arrives during metadata claims', async () => {
    const origin = profile(['old']), reader = origin.tab('reader');
    const journal = JSON.stringify({ beforeLedger: createHash('sha256').update(text(['old'])).digest('hex'),
      afterLedger: 'a'.repeat(64), beforeCategories: before, afterCategories: after });
    origin.durable.set(RESTORE_JOURNAL, journal);
    expect(reader.storage.getItem(RESTORE_JOURNAL)).toBeNull();
    const claim = origin.locks.claim.bind(origin.locks);
    vi.spyOn(origin.locks, 'claim').mockImplementation(name => {
      if (name === oldCategoryClaim) reader.storage.catchUp();
      return claim(name);
    });
    const write = vi.spyOn(reader.storage, 'setItem');
    expect(await restore(reader, ['replacement'])).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(origin.durable.get(RESTORE_JOURNAL)).toBe(journal);
    expect(origin.locks.held()).toEqual([]);
  });

  const template: TransactionTemplate = { id: 't1', name: 'Kopi', type: 'expense', walletId: 'bank', currency: 'TRY', category: 'Belanja', note: '' };
  describe.each([
    { key: TEMPLATES_KEY, section: { templates: [template] }, replacement: { templates: [] } },
    { key: BUDGETS_KEY, section: { budgets: { TRY: { Belanja: 300 } } }, replacement: { budgets: {} } },
  ])('MW-164c: stale $key after a restore changed that section alone', ({ key, section, replacement }) => {
    async function setup() {
      const origin = new Origin(text(['kept']), { [CATEGORY_SETTINGS_KEY]: after });
      const writer = origin.tab('writer'), reader = origin.tab('reader');
      expect(await writer.controller.setCandidate(data(['kept']), '', { restoreCategories: { settings, expectedRaw: after, ...section } })).toBe(true);
      expect(origin.durable.has(key)).toBe(true);
      expect(reader.storage.getItem(key)).toBeNull();
      return { origin, reader };
    }

    it('rejects a stale export until its view catches up', async () => {
      const { origin, reader } = await setup();
      await expect(reader.controller.exportFullBackup(after)).rejects.toThrow();
      origin.deliver();
      expect(JSON.parse(await reader.controller.exportFullBackup(after))).toMatchObject(section);
    });

    it('rejects a stale included section before writing any of the profile', async () => {
      const { origin, reader } = await setup();
      const durable = new Map(origin.durable);
      const write = vi.spyOn(reader.storage, 'setItem');
      const options = { restoreCategories: { settings, expectedRaw: after, ...replacement } };
      expect(await reader.controller.setCandidate(data(['replacement']), '', options)).toBe(false);
      expect(write).not.toHaveBeenCalled();
      expect(origin.durable).toEqual(durable);
      origin.deliver();
      expect(await reader.controller.setCandidate(data(['replacement']), '', options)).toBe(true);
      expect(origin.durable.get(key)).not.toBe(durable.get(key));
    });

    it('preserves the stored section when a backup omits it', async () => {
      const { origin, reader } = await setup();
      const durable = origin.durable.get(key);
      reader.storage.unreadable = key;
      expect(await reader.controller.setCandidate(data(['new']), '', { restoreCategories: { settings, expectedRaw: after } })).toBe(true);
      expect(origin.durable.get(key)).toBe(durable);
    });
  });

  it.each(['refresh', 'export'])('MW-163: %s from a trailing tab preserves a completed restore', async operation => {
    const origin = profile(['old']);
    const writer = origin.tab('A'), reader = origin.tab('B');
    // Deliver the journal and staged categories to B, then withhold the two
    // remaining changes (ledger replacement and journal removal).
    const write = writer.storage.setItem.bind(writer.storage);
    writer.storage.setItem = (key, value) => {
      write(key, value);
      if (key === CATEGORY_SETTINGS_KEY) reader.storage.catchUp();
    };
    expect(await restore(writer, ['restored'])).toBe(true);
    expect(reader.storage.getItem(RESTORE_JOURNAL)).not.toBeNull();
    expect(reader.storage.getItem(CATEGORY_SETTINGS_KEY)).toBe(after);
    expect(reader.storage.getItem(STORAGE_KEY)).toBe(text(['old']));
    const set = vi.spyOn(reader.storage, 'setItem'), remove = vi.spyOn(reader.storage, 'removeItem');

    if (operation === 'refresh') await finishInterruptedRestore(reader.storage, origin.locks);
    else await expect(reader.controller.exportFullBackup(after)).rejects.toThrow();

    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(origin.durable.get(CATEGORY_SETTINGS_KEY)).toBe(after);
    expect(origin.ledger).toBe(text(['restored']));
    expect(origin.locks.held()).toEqual([oldCategoryClaim, claimName(text(['old']))]);

    origin.deliver();
    await finishInterruptedRestore(reader.storage, origin.locks);
    reader.controller.checkRemote();
    const backup = JSON.parse(await reader.controller.exportFullBackup(after));
    expect(backup.ledger).toEqual(data(['restored']));
    expect(backup.categorySettings).toEqual(settings);
  });

  it('MW-163: leaves a newer journal untouched when it arrives during the ledger hash', async () => {
    const ledger = text(['same-ledger']);
    const journal = { beforeLedger: createHash('sha256').update(ledger).digest('hex'),
      afterLedger: 'a'.repeat(64), beforeCategories: before, afterCategories: after };
    const origin = new Origin(ledger, { [RESTORE_JOURNAL]: JSON.stringify(journal), [CATEGORY_SETTINGS_KEY]: after });
    const reader = origin.tab('B');
    // A later interrupted restore still has the same ledger and staged categories,
    // but only the newer journal knows which categories to put back.
    const newer = JSON.stringify({ ...journal, beforeCategories: null });
    origin.durable.set(RESTORE_JOURNAL, newer);
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    const hashing = vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => {
      const result = await digest(...args);
      reader.storage.catchUp();
      return result;
    });
    try { await finishInterruptedRestore(reader.storage, origin.locks); }
    finally { hashing.mockRestore(); }
    expect(origin.durable.get(CATEGORY_SETTINGS_KEY)).toBe(after);
    expect(origin.durable.get(RESTORE_JOURNAL)).toBe(newer);

    await finishInterruptedRestore(reader.storage, origin.locks);
    expect(origin.durable.has(CATEGORY_SETTINGS_KEY)).toBe(false);
    expect(origin.durable.has(RESTORE_JOURNAL)).toBe(false);
  });

  it.each([true, false])('MW-163: recovers a genuinely interrupted restore (claim support: %s)', async hasClaims => {
    const origin = profile(['old']);
    const writer = origin.tab('A');
    writer.storage.refuse = (key, value) => key === STORAGE_KEY || (key === CATEGORY_SETTINGS_KEY && value === before);
    expect(await restore(writer, ['restored'])).toBe(false);
    expect(origin.durable.has(RESTORE_JOURNAL)).toBe(true);
    expect(origin.durable.get(CATEGORY_SETTINGS_KEY)).toBe(after);
    expect(origin.locks.held()).toEqual([oldCategoryClaim]);

    const locks = hasClaims ? origin.locks : { runExclusive: origin.locks.runExclusive.bind(origin.locks) };
    const reader = origin.tab('B', locks);
    await finishInterruptedRestore(reader.storage, locks);
    expect(origin.ledger).toBe(text(['old']));
    expect(origin.durable.get(CATEGORY_SETTINGS_KEY)).toBe(before);
    expect(origin.durable.has(RESTORE_JOURNAL)).toBe(false);
    expect(origin.locks.held()).toEqual([hasClaims ? newCategoryClaim : oldCategoryClaim]);
  });

  it.each(['save', 'restore', 'export', 'refresh'])('MW-164c: %s leaves an interrupted journal for a tab that can see its staged categories', async operation => {
    const origin = profile(['old']);
    const writer = origin.tab('writer'), reader = origin.tab('reader');
    const write = writer.storage.setItem.bind(writer.storage);
    writer.storage.setItem = (key, value) => {
      write(key, value);
      if (key === RESTORE_JOURNAL) reader.storage.catchUp();
    };
    writer.storage.refuse = (key, value) => key === STORAGE_KEY || (key === CATEGORY_SETTINGS_KEY && value === before);
    expect(await restore(writer, ['failed'])).toBe(false);
    expect(origin.durable.get(CATEGORY_SETTINGS_KEY)).toBe(after);
    expect(reader.storage.getItem(CATEGORY_SETTINGS_KEY)).toBe(before);
    expect(reader.storage.getItem(RESTORE_JOURNAL)).not.toBeNull();
    const durable = new Map(origin.durable);
    const set = vi.spyOn(reader.storage, 'setItem'), remove = vi.spyOn(reader.storage, 'removeItem');
    if (operation === 'save') expect(await reader.controller.setCandidate(data(['new']))).toBe(false);
    if (operation === 'restore') expect(await restore(reader, ['new'])).toBe(false);
    if (operation === 'export') await expect(reader.controller.exportFullBackup(before)).rejects.toThrow();
    if (operation === 'refresh') await finishInterruptedRestore(reader.storage, origin.locks);
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(origin.durable).toEqual(durable);
    origin.deliver();
    await finishInterruptedRestore(reader.storage, origin.locks);
    expect(origin.durable.get(CATEGORY_SETTINGS_KEY)).toBe(before);
    expect(origin.durable.has(RESTORE_JOURNAL)).toBe(false);
  });

  it('a trailing tab cannot save over the ledger another tab just restored', async () => {
    const origin = profile(['old']);
    const a = origin.tab('A'), b = origin.tab('B');
    expect(await restore(a, ['restored'])).toBe(true);
    expect(origin.locks.requested).toEqual([
      { name: claimName(text(['old'])), insideLedgerLock: true }, { name: oldCategoryClaim, insideLedgerLock: true },
    ]);
    expect(origin.locks.held()).toEqual([oldCategoryClaim, claimName(text(['old']))]);
    expect(await b.controller.setCandidate(data(['old', 'b']))).toBe(false);
    expect(b.controller.getSnapshot()).toMatchObject({ dirty: true, status: 'conflict' });
    expect(notes(origin.ledger)).toEqual(['restored']);
    expect(origin.durable.get(CATEGORY_SETTINGS_KEY)).toBe(after);
    expect(origin.ledgerWriters).toEqual(['A']);
  });

  it('a restore from a trailing view is refused before anything is read or written', async () => {
    const origin = profile(['old']);
    const a = origin.tab('A'), b = origin.tab('B');
    expect(await a.controller.setCandidate(data(['old', 'a']))).toBe(true);
    const stored = new Map(origin.durable);
    b.storage.reads = [];
    expect(await restore(b, ['restored'])).toBe(false);
    expect(b.storage.reads).toEqual([]);
    expect(origin.durable).toEqual(stored);
    expect(notes(origin.ledger)).toEqual(['old', 'a']);
    expect(b.controller.getSnapshot()).toMatchObject({ pending: false, dirty: false, status: 'failed', error: changed });
  });

  it.each([RESTORE_JOURNAL, CATEGORY_SETTINGS_KEY, STORAGE_KEY])('gives the claim back when the restore cannot write %s, so it can be repeated', async key => {
    const origin = profile(['old']);
    const a = origin.tab('A');
    a.storage.refuse = name => name === key;
    expect(await restore(a, ['restored'])).toBe(false);
    expect(origin.locks.requested.map(request => request.name)).toEqual([claimName(text(['old'])), oldCategoryClaim]);
    expect(origin.locks.held()).toEqual([]);
    expect(origin.ledger).toBe(text(['old']));
    expect(origin.durable.get(CATEGORY_SETTINGS_KEY)).toBe(before);
    a.storage.refuse = null;
    expect(await restore(a, ['restored'])).toBe(true);
    expect(notes(origin.ledger)).toEqual(['restored']);
    expect(origin.locks.held()).toEqual([oldCategoryClaim, claimName(text(['old']))]);
  });

  it('gives the claim back when a restore is interrupted before the ledger is written, and when the compare fails', async () => {
    const origin = profile(['old']);
    const a = origin.tab('A');
    // The ledger write fails and so does putting the staged categories back: the journal stays for the next opener.
    a.storage.refuse = (key, value) => key === STORAGE_KEY || (key === CATEGORY_SETTINGS_KEY && value === before);
    expect(await restore(a, ['restored'])).toBe(false);
    expect(origin.durable.has(RESTORE_JOURNAL)).toBe(true);
    expect(origin.ledger).toBe(text(['old']));
    expect(origin.locks.held()).toEqual([oldCategoryClaim]);
    // Categories that changed since the preview: refused by the compare, claim returned.
    const other = profile(['old']);
    const b = other.tab('B');
    expect(await restore(b, ['restored'], { expectedRaw: after })).toBe(false);
    expect(b.controller.getSnapshot().error).toBe(changed);
    expect(other.locks.requested).toHaveLength(1);
    expect(other.locks.held()).toEqual([]);
    expect(other.ledgerWriters).toEqual([]);
  });

  it.each([true, false])('handles unreadable optional keys at the point they are checked (claim support: %s)', async hasClaims => {
    const origin = profile(['old']);
    const locks = hasClaims ? origin.locks : { runExclusive: origin.locks.runExclusive.bind(origin.locks) };
    const a = origin.tab('A', locks);
    a.storage.unreadable = BUDGETS_KEY;
    expect(await restore(a, ['restored'], { budgets: { IDR: { Belanja: 5_000_000 } } })).toBe(false);
    // With claims the key must be readable before the first write. Legacy ports discover read errors after the commit.
    expect(notes(origin.ledger)).toEqual(hasClaims ? ['old'] : ['restored']);
    expect(origin.durable.get(CATEGORY_SETTINGS_KEY)).toBe(hasClaims ? before : after);
    expect(origin.locks.held()).toEqual([]);
  });

  it('keeps the ledger claim and reports the failed optional write after commit', async () => {
    const origin = profile(['old']);
    const a = origin.tab('A'), b = origin.tab('B');
    a.storage.refuse = key => key === BUDGETS_KEY;
    expect(await restore(a, ['restored'], { budgets: { IDR: { Belanja: 5_000_000 } } })).toBe(true);
    expect(a.controller.getSnapshot().error).toMatch(/anggaran dari cadangan belum tersimpan/);
    expect(origin.locks.held()).toEqual([oldCategoryClaim, claimName(text(['old']))]);
    expect(await b.controller.setCandidate(data(['old', 'b']))).toBe(false);
    expect(notes(origin.ledger)).toEqual(['restored']);
  });

  it('keeps the claim when a ledger write that reported a failure had landed after all', async () => {
    const origin = profile(['old']);
    const a = origin.tab('A'), b = origin.tab('B');
    const write = a.storage.setItem.bind(a.storage);
    a.storage.setItem = (key, value) => { write(key, value); if (key === STORAGE_KEY) throw new DOMException('Synthetic late failure', 'UnknownError'); };
    expect(await restore(a, ['restored'])).toBe(false);
    expect(notes(origin.ledger)).toEqual(['restored']);
    expect(origin.locks.held()).toEqual([claimName(text(['old']))]);
    expect(await b.controller.setCandidate(data(['old', 'b']))).toBe(false);
    expect(notes(origin.ledger)).toEqual(['restored']);
  });

  it('releases a claim when the restore fails before attempting to write the ledger', async () => {
    const origin = profile(['old']);
    const a = origin.tab('A'), b = origin.tab('B');
    expect(await a.controller.setCandidate(data(['new']))).toBe(true);
    b.storage.catchUp(); // B now reads ['new'], but its controller still expects ['old'].
    expect(await a.controller.setCandidate(data(['old']))).toBe(true);
    expect(await restore(b, ['restored'])).toBe(false);
    expect(b.controller.getSnapshot().error).toBe(changed);
    expect(await a.controller.setCandidate(data(['old', 'next']))).toBe(true);
    expect(notes(origin.ledger)).toEqual(['old', 'next']);

    // A read error during the preview check also precedes any attempt to write.
    const denied = profile(['old']);
    const c = denied.tab('C');
    c.storage.unreadable = STORAGE_KEY;
    expect(await restore(c, ['restored'])).toBe(false);
    expect(c.controller.getSnapshot()).toMatchObject({ pending: false, error: 'Pemulihan lengkap gagal. Periksa ruang penyimpanan lalu buka kembali file cadangan.' });
    expect(denied.ledger).toBe(text(['old']));
    expect(denied.locks.held()).toEqual([]);
  });

  it('a restore that leaves the ledger bytes alone releases its claim', async () => {
    const origin = profile(['old']);
    const a = origin.tab('A'), b = origin.tab('B');
    expect(await restore(a, ['old'])).toBe(true);
    expect(origin.durable.get(CATEGORY_SETTINGS_KEY)).toBe(after);
    expect(origin.ledgerWriters).toEqual([]);
    expect(origin.locks.held()).toEqual([oldCategoryClaim]);
    expect(origin.locks.revoked).toEqual([newCategoryClaim]);
    expect(await b.controller.setCandidate(data(['old', 'b']))).toBe(true);
  });

  it('rejects a settings-only restore whose ledger still appears to match in a stale tab', async () => {
    const origin = profile(['old']);
    const a = origin.tab('A'), b = origin.tab('B');
    expect(await a.controller.setCandidate(data(['old', 'new']))).toBe(true);
    const durable = new Map(origin.durable);
    b.storage.reads = [];
    expect(await restore(b, ['old'], { budgets: { IDR: { Belanja: 5_000_000 } } })).toBe(false);
    expect(b.controller.getSnapshot().error).toBe(changed);
    expect(b.storage.reads).toEqual([]);
    expect(origin.durable).toEqual(durable);
  });

  it('a restore that puts an earlier text back frees that text for the next save', async () => {
    const origin = profile(['old']);
    const a = origin.tab('A'), b = origin.tab('B');
    expect(await a.controller.setCandidate(data(['old', 'new']))).toBe(true);   // A claims the ['old'] text.
    origin.deliver(); b.controller.checkRemote();
    expect(await restore(b, ['old'])).toBe(true);                               // The ['old'] text is stored again.
    expect(origin.ledger).toBe(text(['old']));
    expect(origin.locks.held()).toEqual([oldCategoryClaim, claimName(text(['old', 'new']))]);
    origin.deliver(); a.controller.checkRemote();
    expect(await a.controller.setCandidate(data(['old', 'again']))).toBe(true);
    expect(notes(origin.ledger)).toEqual(['old', 'again']);
  });

  it('without claim and revoke in the port a restore is the compare-and-set it was', async () => {
    const origin = profile(['old']);
    const plain: PersistenceLocks = { runExclusive: (name, task) => origin.locks.runExclusive(name, task) };
    const a = origin.tab('A', plain);
    expect(await restore(a, ['restored'])).toBe(true);
    expect(notes(origin.ledger)).toEqual(['restored']);
    expect(origin.locks.requested).toEqual([]);
    expect(origin.locks.revoked).toEqual([]);
  });
});
