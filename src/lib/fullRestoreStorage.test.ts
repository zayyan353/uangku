import { describe, expect, it } from 'vitest';
import { CATEGORY_SETTINGS_KEY, defaultCategorySettings, type CategorySettings } from './categorySettings';
import { CATEGORY_LOCK, finishInterruptedRestore, requestExclusive, RESTORE_JOURNAL } from './fullRestoreStorage';
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
    expect(store.getItem(STORAGE_KEY)).toBe(serializeBackup(updated));
    expect(store.getItem(CATEGORY_SETTINGS_KEY)).toBe(nextRaw);
    expect(store.getItem(RESTORE_JOURNAL)).toBeNull();
    expect(JSON.parse(await controller.exportFullBackup(nextRaw)).categorySettings).toEqual(settings);
  });

  it('preserves a pretty-encoded ledger byte for byte when restoring only categories', async () => {
    const pretty = JSON.stringify(initial, null, 2);
    const { store, restore, controller } = environment(previousRaw, true, pretty);
    expect(await restore(initial)).toBe(true);
    expect(store.writes).toEqual([CATEGORY_SETTINGS_KEY]);
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
});
