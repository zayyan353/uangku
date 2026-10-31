import { describe, expect, it } from 'vitest';
import { commitCandidate, LedgerPersistenceController, prepareCandidate, type PersistenceLocks, type PersistencePorts, type PersistenceStorage } from './persistence';
import { STORAGE_KEY, serializeBackup, validateBackup, type StoredData, type StoredRead } from './storage';

function data(ids: string[] = []): StoredData {
  return { app: 'uangku', version: 1, demo: false, state: {
    version: 1,
    wallets: [{ id: 'bank', name: 'Bank', currency: 'TRY', kind: 'bank', openingBalance: 100_000 }],
    entries: ids.map(id => ({ id, date: '2026-10-30', type: 'expense', walletId: 'bank', amount: 100, category: '', note: id })),
  } };
}
class MemoryStorage implements PersistenceStorage {
  raw: string | null = null;
  writes = 0;
  failWrites = false;
  failReads = false;
  getItem(key: string) { expect(key).toBe(STORAGE_KEY); if (this.failReads) throw new Error('unavailable'); return this.raw; }
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
