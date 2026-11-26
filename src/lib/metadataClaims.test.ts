import { describe, expect, it } from 'vitest';
import { CATEGORY_SETTINGS_KEY } from './categorySettings';
import { recoverProfile, RESTORE_JOURNAL } from './fullRestoreStorage';
import { STORAGE_KEY } from './storage';
import { digestStorageText, withMetadataClaims } from './metadataClaims';
import type { PersistenceLocks, PersistenceStorage } from './persistence';

function origin() {
  const held = new Set<string>();
  const locks: PersistenceLocks = {
    runExclusive: async (_, task) => task(),
    claim: async name => {
      if (held.has(name)) return null;
      held.add(name);
      return () => { held.delete(name); };
    },
    revoke: async name => { held.delete(name); },
  };
  function view(): PersistenceStorage {
    const values = new Map<string, string>();
    return {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: key => { values.delete(key); },
    };
  }
  return { held, locks, view };
}
const base = (key: string, raw: string | null) => ({ key, raw, message: key + ' berubah' });

describe('claims for the settings, budget and template storage keys', () => {
  it('rejects a stale reader without leaking a claim acquired for another key with identical bytes', async () => {
    const { view, locks } = origin();
    const writer = view(), reader = view();
    await withMetadataClaims(writer, locks, [base('A', null)], s => s.setItem('A', 'baru'));
    const probe = (key: string) => withMetadataClaims(reader, locks, [base(key, null)], () => true);
    await expect(withMetadataClaims(reader, locks, [base('B', null), base('A', null)],
      () => { throw Error('Stale write accepted'); })).rejects.toThrow('A berubah');
    expect(await probe('B')).toBe(true);
    await expect(probe('A')).rejects.toThrow('A berubah');
  });

  it('releases a rolled-back base and permits editing a value restored by a later write', async () => {
    const { view, locks, held } = origin(), store = view();
    await expect(withMetadataClaims(store, locks, [base('A', null)], s => {
      s.setItem('A', 'baru');
      s.removeItem('A');
      throw Error('kuota');
    })).rejects.toThrow('kuota');
    expect(held.size).toBe(0);
    await withMetadataClaims(store, locks, [base('A', null)], s => s.setItem('A', 'baru'));
    await withMetadataClaims(store, locks, [base('A', 'baru')], s => s.removeItem('A'));
    await withMetadataClaims(store, locks, [base('A', null)], s => s.setItem('A', 'lagi'));
    expect(store.getItem('A')).toBe('lagi');
  });

  it('protects a landed write if the storage port throws after updating the key', async () => {
    const { view, locks } = origin(), writer = view(), reader = view();
    const write = writer.setItem;
    writer.setItem = (key, value) => { write(key, value); throw Error('port'); };
    await expect(withMetadataClaims(writer, locks, [base('A', null)], s => s.setItem('A', 'baru'))).rejects.toThrow('port');
    await expect(withMetadataClaims(reader, locks, [base('A', null)], () => true)).rejects.toThrow('A berubah');
  });
});

describe('claims during rollback of an interrupted restore', () => {
  async function stage(view: () => PersistenceStorage) {
    const store = view();
    store.setItem(STORAGE_KEY, 'old ledger');
    store.setItem(CATEGORY_SETTINGS_KEY, 'staged');
    store.setItem(RESTORE_JOURNAL, JSON.stringify({
      beforeLedger: await digestStorageText('old ledger'), afterLedger: await digestStorageText('next ledger'),
      beforeCategories: null, afterCategories: 'staged',
    }));
    return store;
  }

  it('leaves the journal and category untouched when the visible staged bytes have already been replaced', async () => {
    const { view, locks } = origin(), writer = await stage(view), reader = await stage(view);
    const staged = base(CATEGORY_SETTINGS_KEY, 'staged');
    await withMetadataClaims(writer, locks, [staged], s => s.setItem(staged.key, 'later edit'));
    expect(await recoverProfile(reader, locks)).toBe(false);
    expect(reader.getItem(RESTORE_JOURNAL)).not.toBeNull();
    expect(reader.getItem(staged.key)).toBe('staged');
    reader.setItem(staged.key, 'later edit');
    expect(await recoverProfile(reader, locks)).toBe(true);
    expect(reader.getItem(RESTORE_JOURNAL)).toBeNull();
    expect(reader.getItem(staged.key)).toBe('later edit');
  });

  it('rolls back a real interrupted restore and protects the displaced staged category until other tabs catch up', async () => {
    const { view, locks } = origin(), reader = await stage(view), behind = await stage(view);
    expect(await recoverProfile(reader, locks)).toBe(true);
    expect(reader.getItem(RESTORE_JOURNAL)).toBeNull();
    expect(reader.getItem(CATEGORY_SETTINGS_KEY)).toBeNull();
    await expect(withMetadataClaims(behind, locks, [base(CATEGORY_SETTINGS_KEY, 'staged')], () => true)).rejects.toThrow();
    await withMetadataClaims(reader, locks, [base(CATEGORY_SETTINGS_KEY, null)], s => s.setItem(CATEGORY_SETTINGS_KEY, 'new edit'));
  });
});
