import { describe, expect, it, vi } from 'vitest';
import { persistenceLabel, requestPersistentStorage, type PersistenceStatus } from './storagePersistence';

describe('requestPersistentStorage', () => {
  it('is unsupported without a storage manager', async () => {
    expect(await requestPersistentStorage(undefined)).toBe('unsupported');
  });

  it('is unsupported when persist is missing and nothing is persisted', async () => {
    expect(await requestPersistentStorage({})).toBe('unsupported');
    expect(await requestPersistentStorage({ persisted: async () => false })).toBe('unsupported');
  });

  it('reports granted without asking again when already persisted', async () => {
    const persist = vi.fn(async () => false);
    expect(await requestPersistentStorage({ persisted: async () => true, persist })).toBe('granted');
    expect(persist).not.toHaveBeenCalled();
  });

  it('asks once and maps the browser answer', async () => {
    const yes = vi.fn(async () => true);
    expect(await requestPersistentStorage({ persisted: async () => false, persist: yes })).toBe('granted');
    expect(yes).toHaveBeenCalledTimes(1);
    const no = vi.fn(async () => false);
    expect(await requestPersistentStorage({ persisted: async () => false, persist: no })).toBe('denied');
    expect(no).toHaveBeenCalledTimes(1);
  });

  it('asks when only persist exists', async () => {
    expect(await requestPersistentStorage({ persist: async () => true })).toBe('granted');
  });

  it('treats failures as denied, never throwing', async () => {
    expect(await requestPersistentStorage({ persist: async () => { throw new Error('blocked'); } })).toBe('denied');
    expect(await requestPersistentStorage({
      persisted: async () => { throw new Error('check failed'); },
      persist: async () => true,
    })).toBe('granted');
  });

  it('treats a non-boolean answer as denied', async () => {
    expect(await requestPersistentStorage({ persist: async () => 'yes' as unknown as boolean })).toBe('denied');
  });

  it('keeps the storage manager as this', async () => {
    const manager = {
      granted: true,
      async persist(this: { granted: boolean }) { return this.granted; },
    };
    expect(await requestPersistentStorage(manager)).toBe('granted');
  });
});

describe('persistenceLabel', () => {
  it('answers ya/tidak and explains every status', () => {
    const statuses: PersistenceStatus[] = ['not-requested', 'checking', 'granted', 'denied', 'unsupported'];
    for (const status of statuses) {
      const label = persistenceLabel(status);
      expect(label.answer.length).toBeGreaterThan(0);
      expect(label.detail.length).toBeGreaterThan(0);
    }
    expect(persistenceLabel('granted').answer).toBe('ya');
    expect(persistenceLabel('denied').answer).toBe('tidak');
    expect(persistenceLabel('denied').detail).toContain('bukan error');
  });
});
