import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CATEGORY_SETTINGS_KEY, defaultCategorySettings, type CategorySettings } from './categorySettings';
import { baseClaimName, browserLocks, CATEGORY_LOCK, claimLock, finishInterruptedRestore, LEDGER_LOCK, requestExclusive, RESTORE_JOURNAL, revokeLock } from './fullRestoreStorage';
import { LAST_BACKUP_KEY, ledgerFingerprint, readLastBackup } from './backupReminder';
import { BUDGETS_KEY, serializeBudgets } from './budgets';
import { serializeTemplates, TEMPLATES_KEY } from './transactionTemplates';
import { LedgerPersistenceController, type PersistenceLocks, type PersistenceStorage } from './persistence';
import { createEmptyState, parseBackupText, serializeBackup, STORAGE_KEY, type StoredData } from './storage';

const initial: StoredData = { app: 'uangku', version: 1, demo: false, state: createEmptyState() };
const updated: StoredData = { ...initial, state: { ...initial.state, entries: [{
  id: 'receipt', type: 'expense', amount: 123, date: '2026-10-30', note: 'Synthetic',
  category: 'Belanja', walletId: initial.state.wallets[0].id,
}] } };
const settings: CategorySettings = { version: 1, names: ['Belum dikategorikan', 'Unused'], rules: [
  { id: 'personal', keyword: 'synthetic', category: 'Unused', mode: 'suggest' },
], keywordPackVersion: 7 };
const nextRaw = JSON.stringify(settings);
const previousRaw = JSON.stringify({ ...settings, rules: [] });

class Store implements PersistenceStorage {
  map = new Map<string, string>();
  fault?: (key: string, value: string | null) => boolean;
  writes: string[] = [];
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.fault?.(key, value)) throw new DOMException('Synthetic quota', 'QuotaExceededError');
    this.map.set(key, value); this.writes.push(key);
  }
  removeItem(key: string) {
    if (this.fault?.(key, null)) throw new DOMException('Synthetic interruption', 'UnknownError');
    this.map.delete(key); this.writes.push(key);
  }
}

class Locks implements PersistenceLocks {
  private queues = new Map<string, Promise<void>>();
  async runExclusive<T>(name: string, task: () => Promise<T> | T) {
    const previous = this.queues.get(name);
    let release!: () => void;
    this.queues.set(name, new Promise(resolve => { release = resolve; }));
    await previous;
    try { return await task(); } finally { release(); }
  }
}

function environment(categoryRaw: string | null = previousRaw, supported = true, raw = serializeBackup(initial)) {
  const store = new Store(), locks = new Locks();
  store.map.set(STORAGE_KEY, raw);
  if (categoryRaw !== null) store.map.set(CATEGORY_SETTINGS_KEY, categoryRaw);
  const read = () => {
    const token = store.getItem(STORAGE_KEY)!;
    return { data: parseBackupText(token), token, persisted: true, blocked: false, error: null };
  };
  const ports = { read, storage: () => store, locks: () => supported ? locks : undefined };
  const controller = new LedgerPersistenceController(read(), ports);
  const restore = (data = updated) => controller.setCandidate(data, '', {
    expectedToken: raw, restoreCategories: { settings, expectedRaw: categoryRaw },
  });
  return { store, locks, controller, restore };
}

describe('full restore and export use one reviewed ledger/category pair', () => {
  it('restores both prior keys without changing their normal formats', async () => {
    const { store, restore, controller } = environment(null);
    expect(await restore()).toBe(true);
    expect(readLastBackup(store)?.fingerprint).toBe(ledgerFingerprint(serializeBackup(updated)));
    expect(store.getItem(STORAGE_KEY)).toBe(serializeBackup(updated));
    expect(store.getItem(CATEGORY_SETTINGS_KEY)).toBe(nextRaw);
    expect(store.getItem(RESTORE_JOURNAL)).toBeNull();
    expect(JSON.parse(await controller.exportFullBackup(nextRaw)).categorySettings).toEqual(settings);
  });

  it('preserves a pretty-encoded ledger byte for byte when restoring only categories', async () => {
    const pretty = JSON.stringify(initial, null, 2);
    const { store, restore, controller } = environment(previousRaw, true, pretty);
    expect(await restore(initial)).toBe(true);
    expect(store.writes).toEqual([CATEGORY_SETTINGS_KEY, LAST_BACKUP_KEY]);
    expect(readLastBackup(store)?.fingerprint).toBe(ledgerFingerprint(pretty));
    expect(controller.getSnapshot().revisionToken).toBe(pretty);
    expect(await controller.setCandidate(updated)).toBe(true);
    expect(store.getItem(CATEGORY_SETTINGS_KEY)).toBe(nextRaw);
  });

  it.each([RESTORE_JOURNAL, CATEGORY_SETTINGS_KEY, STORAGE_KEY])('keeps the previous pair on a write failure at %s', async key => {
    const { store, restore, controller } = environment(null);
    store.fault = (name, value) => name === key && value !== null;
    expect(await restore()).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ data: initial, dirty: false, pending: false });
    expect(store.getItem(STORAGE_KEY)).toBe(serializeBackup(initial));
    expect(store.getItem(CATEGORY_SETTINGS_KEY)).toBeNull();
    expect(store.getItem(RESTORE_JOURNAL)).toBeNull();
    expect(readLastBackup(store)).toBeNull();
    expect(await controller.retry()).toBe(false); // No partial ledger-only retry.
    store.fault = undefined;
    expect(await restore()).toBe(true);
  });

  it('repairs interruption before the ledger commit, but leaves subsequent independent category edits intact', async () => {
    for (const peerChanged of [false, true]) {
      const { store, locks, restore } = environment();
      store.fault = (key, value) => key === STORAGE_KEY || (key === CATEGORY_SETTINGS_KEY && value === previousRaw);
      expect(await restore()).toBe(false);
      expect(store.getItem(RESTORE_JOURNAL)).not.toBeNull();
      expect(store.getItem(CATEGORY_SETTINGS_KEY)).toBe(nextRaw);
      store.fault = undefined;
      if (peerChanged) store.setItem(CATEGORY_SETTINGS_KEY, 'newer peer bytes');
      await finishInterruptedRestore(store, locks);
      expect(store.getItem(STORAGE_KEY)).toBe(serializeBackup(initial));
      expect(store.getItem(CATEGORY_SETTINGS_KEY)).toBe(peerChanged ? 'newer peer bytes' : previousRaw);
      expect(store.getItem(RESTORE_JOURNAL)).toBeNull();
    }
  });

  it('finishes cleanup after a committed ledger without rewriting either payload', async () => {
    const { store, locks, restore } = environment();
    store.fault = (key, value) => key === RESTORE_JOURNAL && value === null;
    expect(await restore()).toBe(true);
    expect(store.getItem(RESTORE_JOURNAL)).not.toBeNull();
    store.fault = undefined;
    store.writes = [];
    await finishInterruptedRestore(store, locks);
    expect(store.writes).toEqual([RESTORE_JOURNAL]);
    expect(store.getItem(STORAGE_KEY)).toBe(serializeBackup(updated));
    expect(store.getItem(CATEGORY_SETTINGS_KEY)).toBe(nextRaw);
  });

  it('waits on an old-release category writer and rejects the stale preview', async () => {
    const { store, locks, restore } = environment();
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const peer = locks.runExclusive(CATEGORY_LOCK, async () => {
      await gate;
      store.setItem(CATEGORY_SETTINGS_KEY, 'peer edit');
    });
    const attempt = restore();
    finish();
    await peer;
    expect(await attempt).toBe(false);
    expect(store.writes).toEqual([CATEGORY_SETTINGS_KEY]);
    expect(store.getItem(STORAGE_KEY)).toBe(serializeBackup(initial));
  });

  it('keeps the fully restored profile when the optional reminder record cannot fit', async () => {
    const { store, restore, controller } = environment();
    store.fault = key => key === LAST_BACKUP_KEY;
    expect(await restore()).toBe(true);
    expect(controller.getSnapshot().error).toBe('');
    expect(readLastBackup(store)).toBeNull();
    expect(store.getItem(STORAGE_KEY)).toBe(serializeBackup(updated));
  });

  it('rejects stale financial bytes even when the category token still matches', async () => {
    const { store, restore } = environment();
    store.setItem(STORAGE_KEY, serializeBackup(updated));
    expect(await restore()).toBe(false);
    expect(store.getItem(CATEGORY_SETTINGS_KEY)).toBe(previousRaw);
    expect(store.writes).toEqual([STORAGE_KEY]);
  });

  it('exports defaults for a truly absent key without locks and rejects corrupt or stale settings', async () => {
    const empty = environment(null, false);
    expect(JSON.parse(await empty.controller.exportFullBackup(null)).categorySettings).toEqual(defaultCategorySettings());
    expect(await empty.restore()).toBe(false);
    const corrupt = environment('{bad');
    await expect(corrupt.controller.exportFullBackup('{bad')).rejects.toThrow();
    const stale = environment();
    stale.store.setItem(CATEGORY_SETTINGS_KEY, nextRaw);
    await expect(stale.controller.exportFullBackup(previousRaw)).rejects.toThrow();
    expect(corrupt.store.writes).toEqual([]);
  });
});

describe('budgets travel with full export and restore (MW-12a)', () => {
  const budgets = { IDR: { Belanja: 5000000 } };

  it('exports stored budgets and omits the section when none are stored', async () => {
    const plain = environment(nextRaw);
    expect(JSON.parse(await plain.controller.exportFullBackup(nextRaw))).not.toHaveProperty('budgets');
    const withBudgets = environment(nextRaw);
    withBudgets.store.map.set(BUDGETS_KEY, serializeBudgets(budgets));
    expect(JSON.parse(await withBudgets.controller.exportFullBackup(nextRaw)).budgets).toEqual(budgets);
  });

  it('refuses to export when stored budgets are unreadable instead of dropping them', async () => {
    const corrupt = environment(nextRaw);
    corrupt.store.map.set(BUDGETS_KEY, '{bad');
    await expect(corrupt.controller.exportFullBackup(nextRaw)).rejects.toThrow(/Anggaran/);
    expect(corrupt.store.map.get(BUDGETS_KEY)).toBe('{bad');
  });

  it('writes restored budgets after the ledger and categories', async () => {
    const { store, controller } = environment();
    const raw = store.getItem(STORAGE_KEY);
    expect(await controller.setCandidate(updated, '', { expectedToken: raw, restoreCategories: { settings, expectedRaw: previousRaw, budgets } })).toBe(true);
    expect(store.map.get(BUDGETS_KEY)).toBe(serializeBudgets(budgets));
    expect(store.map.get(CATEGORY_SETTINGS_KEY)).toBe(nextRaw);
    expect(store.writes.indexOf(BUDGETS_KEY)).toBeGreaterThan(store.writes.lastIndexOf(STORAGE_KEY));
    expect(controller.getSnapshot().error).toBe('');
  });

  it('keeps current budgets when the backup has no budget section', async () => {
    const { store, restore } = environment();
    store.map.set(BUDGETS_KEY, serializeBudgets({ TRY: { Belanja: 1 } }));
    expect(await restore()).toBe(true);
    expect(store.map.get(BUDGETS_KEY)).toBe(serializeBudgets({ TRY: { Belanja: 1 } }));
    expect(store.writes).not.toContain(BUDGETS_KEY);
  });

  it('reports a failed budget write without undoing the restore or touching old budgets', async () => {
    const { store, controller } = environment();
    const old = serializeBudgets({ TRY: { Belanja: 1 } });
    store.map.set(BUDGETS_KEY, old);
    store.fault = key => key === BUDGETS_KEY;
    const raw = store.getItem(STORAGE_KEY);
    expect(await controller.setCandidate(updated, '', { expectedToken: raw, restoreCategories: { settings, expectedRaw: previousRaw, budgets } })).toBe(true);
    expect(parseBackupText(store.getItem(STORAGE_KEY)!)).toEqual(updated);
    expect(readLastBackup(store)).toBeNull();
    expect(store.map.get(BUDGETS_KEY)).toBe(old);
    expect(controller.getSnapshot().error).toMatch(/anggaran dari cadangan belum tersimpan/);
  });

  it('rejects invalid budgets before writing anything', async () => {
    const { store, controller } = environment();
    const before = new Map(store.map);
    const raw = store.getItem(STORAGE_KEY);
    expect(await controller.setCandidate(updated, '', { expectedToken: raw,
      restoreCategories: { settings, expectedRaw: previousRaw, budgets: { IDR: { Belanja: -5 } } } })).toBe(false);
    expect(store.map).toEqual(before);
  });
});

describe('templates travel with full export and restore (MW-13a)', () => {
  const templates = [{ id: 't1', name: 'Kopi', type: 'expense' as const, walletId: 'w1', currency: 'TRY' as const, category: 'Belanja', note: '' }];

  it('exports stored templates and omits the section when none are stored', async () => {
    const plain = environment(nextRaw);
    expect(JSON.parse(await plain.controller.exportFullBackup(nextRaw))).not.toHaveProperty('templates');
    const withTemplates = environment(nextRaw);
    withTemplates.store.map.set(TEMPLATES_KEY, serializeTemplates(templates));
    expect(JSON.parse(await withTemplates.controller.exportFullBackup(nextRaw)).templates).toEqual(templates);
  });

  it('refuses to export when stored templates are unreadable instead of dropping them', async () => {
    const corrupt = environment(nextRaw);
    corrupt.store.map.set(TEMPLATES_KEY, '{bad');
    await expect(corrupt.controller.exportFullBackup(nextRaw)).rejects.toThrow(/Template/);
    expect(corrupt.store.map.get(TEMPLATES_KEY)).toBe('{bad');
  });

  it('writes restored templates after the ledger and keeps them when the backup has none', async () => {
    const { store, controller } = environment();
    const raw = store.getItem(STORAGE_KEY);
    expect(await controller.setCandidate(updated, '', { expectedToken: raw, restoreCategories: { settings, expectedRaw: previousRaw, templates } })).toBe(true);
    expect(store.map.get(TEMPLATES_KEY)).toBe(serializeTemplates(templates));
    expect(store.writes.indexOf(TEMPLATES_KEY)).toBeGreaterThan(store.writes.lastIndexOf(STORAGE_KEY));
    const other = environment();
    other.store.map.set(TEMPLATES_KEY, serializeTemplates(templates));
    expect(await other.restore()).toBe(true);
    expect(other.store.writes).not.toContain(TEMPLATES_KEY);
  });

  it('reports a failed template write without undoing the restore', async () => {
    const { store, controller } = environment();
    store.fault = key => key === TEMPLATES_KEY;
    const raw = store.getItem(STORAGE_KEY);
    expect(await controller.setCandidate(updated, '', { expectedToken: raw, restoreCategories: { settings, expectedRaw: previousRaw, templates } })).toBe(true);
    expect(parseBackupText(store.getItem(STORAGE_KEY)!)).toEqual(updated);
    expect(store.map.has(TEMPLATES_KEY)).toBe(false);
    expect(controller.getSnapshot().error).toMatch(/template dari cadangan belum tersimpan/);
  });

  it('rejects invalid templates before writing anything', async () => {
    const { store, controller } = environment();
    const before = new Map(store.map);
    const raw = store.getItem(STORAGE_KEY);
    expect(await controller.setCandidate(updated, '', { expectedToken: raw,
      restoreCategories: { settings, expectedRaw: previousRaw, templates: [{ ...templates[0], amount: -1 }] } })).toBe(false);
    expect(store.map).toEqual(before);
  });
});

describe('requestExclusive', () => {
  /** Records how each lock callback settled; Firefox reports a rejected one as unhandled. */
  function recordingManager() {
    const callbacks: Array<{ name: string; mode?: string; rejected: boolean }> = [];
    const manager = {
      async request(name: string, options: { mode?: string }, callback: () => unknown) {
        const record = { name, mode: options.mode, rejected: false };
        callbacks.push(record);
        try { return await callback(); }
        catch (error) { record.rejected = true; throw error; }
      },
    } as unknown as Pick<LockManager, 'request'>;
    return { manager, callbacks };
  }

  it('returns the task value from an exclusive lock', async () => {
    const { manager, callbacks } = recordingManager();
    await expect(requestExclusive(manager, CATEGORY_LOCK, async () => 'stored')).resolves.toBe('stored');
    expect(callbacks).toEqual([{ name: CATEGORY_LOCK, mode: 'exclusive', rejected: false }]);
  });

  it('rethrows a failure without rejecting the lock callback', async () => {
    const { manager, callbacks } = recordingManager();
    const quota = new DOMException('Synthetic quota', 'QuotaExceededError');
    await expect(requestExclusive(manager, 'sync', () => { throw quota; })).rejects.toBe(quota);
    await expect(requestExclusive(manager, 'async', async () => { throw new Error('Synthetic conflict'); }))
      .rejects.toThrow('Synthetic conflict');
    expect(callbacks.map(callback => callback.rejected)).toEqual([false, false]);
  });
  it('MW-88a: a journal that is not JSON is refused with the journal message, not the parser\'s text, and nothing is changed', async () => {
    const store = new Store(), locks = new Locks();
    store.map.set(STORAGE_KEY, serializeBackup(initial)); store.map.set(CATEGORY_SETTINGS_KEY, previousRaw);
    for (const journal of ['{', 'bukan jurnal', '{"beforeLedger":null}']) {
      store.map.set(RESTORE_JOURNAL, journal);
      const before = new Map(store.map);
      await expect(finishInterruptedRestore(store, locks)).rejects.toThrow('Catatan pemulihan lengkap tidak dapat dibaca. Data tersimpan belum diubah.');
      expect(store.map).toEqual(before);
      expect(store.writes).toEqual([]);
    }
  });
});

describe('MW-162: claim and revoke over the Web Locks API', () => {
  /** The part of a lock manager the adapter uses: an exclusive hold that is taken only if free, and steal. */
  function lockManager() {
    const holders = new Map<string, (reason: unknown) => void>();
    const calls: Array<{ name: string; options: LockOptions; callbackRejected: boolean }> = [];
    let refusal: unknown = null, thrown: unknown = null;
    const manager = {
      request(name: string, options: LockOptions, callback: (lock: Lock | null) => unknown): Promise<unknown> {
        const call = { name, options, callbackRejected: false };
        calls.push(call);
        if (thrown) throw thrown;
        if (refusal) return Promise.reject(refusal);
        const run = async (lock: Lock | null) => {
          try { return await callback(lock); }
          catch (error) { call.callbackRejected = true; throw error; }
        };
        // A grant is never synchronous.
        return Promise.resolve().then(() => {
          if (options.steal) holders.get(name)?.(new DOMException('Synthetic steal', 'AbortError'));
          else if (holders.has(name)) {
            if (!options.ifAvailable) throw new Error('This manager does not queue.');
            return run(null);
          }
          return new Promise((resolve, reject) => {
            // As in the engines, a hold ends by its own identity: a holder that lost the name cannot free its next holder.
            const abort = (reason: unknown) => { if (holders.get(name) === abort) holders.delete(name); reject(reason); };
            const free = () => { if (holders.get(name) === abort) holders.delete(name); };
            holders.set(name, abort);
            run({ name, mode: 'exclusive' } as Lock).then(value => { free(); resolve(value); }, error => { free(); reject(error); });
          });
        });
      },
    } as unknown as Pick<LockManager, 'request'>;
    return { manager, calls, held: () => [...holders.keys()],
      refuse: (reason: unknown) => { refusal = reason; }, throwOnRequest: (reason: unknown) => { thrown = reason; } };
  }
  const flush = async () => { for (let turn = 0; turn < 10; turn++) await Promise.resolve(); };

  it('takes a free name only if available, answers null for a held one, and frees it through the release function', async () => {
    const { manager, calls, held } = lockManager();
    const release = await claimLock(manager, 'claim');
    expect(release).toBeTypeOf('function');
    expect(calls).toEqual([{ name: 'claim', options: { mode: 'exclusive', ifAvailable: true }, callbackRejected: false }]);
    expect(held()).toEqual(['claim']);
    expect(await claimLock(manager, 'claim')).toBeNull();
    expect(held()).toEqual(['claim']);
    release!(); release!();
    await flush();
    expect(held()).toEqual([]);
    expect(await claimLock(manager, 'claim')).not.toBeNull();
    expect(calls.map(call => call.callbackRejected)).toEqual([false, false, false]);
  });

  it('holds the name while the writer is still preparing its commit, regardless of elapsed time', async () => {
    vi.useFakeTimers();
    try {
      const { manager, held } = lockManager();
      const release = await claimLock(manager, 'timed');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(held()).toEqual(['timed']);
      release!();
      await flush();
      expect(held()).toEqual([]);
    } finally { vi.useRealTimers(); }
  });

  it('revokes with steal, and the holder that lost its claim neither reports an unhandled rejection nor frees the next claim', async () => {
    const unhandled: unknown[] = [];
    const listen = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', listen);
    try {
      const { manager, calls, held } = lockManager();
      const release = await claimLock(manager, 'revoked');
      await revokeLock(manager, 'revoked');
      expect(calls[1]).toEqual({ name: 'revoked', options: { steal: true }, callbackRejected: false });
      expect(held()).toEqual([]);
      const next = await claimLock(manager, 'revoked');
      expect(next).not.toBeNull();
      release!();
      // A macrotask later an unhandled rejection would have been reported.
      await new Promise(resolve => { setTimeout(resolve); });
      expect(held()).toEqual(['revoked']);
      expect(unhandled).toEqual([]);
      next!();
      await flush();
      expect(held()).toEqual([]);
      expect(calls.map(call => call.callbackRejected)).toEqual([false, false, false]);
    } finally { process.off('unhandledRejection', listen); }
  });

  it('rejects when the request fails before the name is held', async () => {
    const { manager, refuse, throwOnRequest, held } = lockManager();
    const reason = new DOMException('Synthetic', 'InvalidStateError');
    refuse(reason);
    await expect(claimLock(manager, 'broken')).rejects.toBe(reason);
    await expect(revokeLock(manager, 'broken')).rejects.toBe(reason);
    refuse(null); throwOnRequest(reason);
    await expect(claimLock(manager, 'broken')).rejects.toBe(reason);
    await expect(revokeLock(manager, 'broken')).rejects.toBe(reason);
    expect(held()).toEqual([]);
  });

  it('browserLocks gives the persistence port both members', async () => {
    const { manager, calls, held } = lockManager();
    vi.stubGlobal('navigator', { locks: manager });
    try {
      const locks = browserLocks()!;
      expect(await locks.claim!('port')).toBeTypeOf('function');
      expect(await locks.claim!('port')).toBeNull();
      await locks.revoke!('port');
      expect(held()).toEqual([]);
      expect(calls.map(call => call.options)).toEqual([{ mode: 'exclusive', ifAvailable: true }, { mode: 'exclusive', ifAvailable: true }, { steal: true }]);
    } finally { vi.unstubAllGlobals(); }
  });

  it('names a claim by the SHA-256 of the exact text, and an empty store by a fixed word', async () => {
    expect(LEDGER_LOCK).toBe('uangku:v1:coordinated-write');
    expect(await baseClaimName(null)).toBe('uangku:v1:coordinated-write:base:kosong');
    expect(await baseClaimName('')).toBe('uangku:v1:coordinated-write:base:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await baseClaimName('abc')).toBe('uangku:v1:coordinated-write:base:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const unicode = serializeBackup(updated).replace('Synthetic', 'İstanbul 界 👛');
    expect(await baseClaimName(unicode)).toBe(`${LEDGER_LOCK}:base:${createHash('sha256').update(unicode, 'utf8').digest('hex')}`);
    expect(await baseClaimName(unicode + ' ')).not.toBe(await baseClaimName(unicode));
  });

  it('keeps distinct raw tokens distinct even when UTF-8 would replace a lone surrogate', async () => {
    const names = await Promise.all(['\uFFFD', '\uD800', '\uD801', '\uDFFF'].map(baseClaimName));
    expect(new Set(names).size).toBe(names.length);
  });

  it('remembers the two texts it hashed last', async () => {
    const digest = vi.spyOn(crypto.subtle, 'digest');
    try {
      const first = await baseClaimName('remembered one'), second = await baseClaimName('remembered two');
      expect(digest).toHaveBeenCalledTimes(2);
      expect(await baseClaimName('remembered two')).toBe(second);
      expect(await baseClaimName('remembered one')).toBe(first);
      expect(await baseClaimName(null)).toBe(`${LEDGER_LOCK}:base:kosong`);
      expect(digest).toHaveBeenCalledTimes(2);
    } finally { digest.mockRestore(); }
  });
});
