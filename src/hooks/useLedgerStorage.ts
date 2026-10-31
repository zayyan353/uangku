/** Fresh minimum reconstruction; no persistence writes occur in effects. */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { readStored } from '../lib/storage';
import { LedgerPersistenceController, type CandidateOptions, type PersistenceLocks, type PersistencePorts, type PersistenceStatus } from '../lib/persistence';
import type { StoredData } from '../lib/storage';

function browserLocks(): PersistenceLocks | undefined {
  const manager = globalThis.navigator?.locks;
  if (!manager || typeof manager.request !== 'function') return undefined;
  return {
    async runExclusive<T>(name: string, task: () => T | Promise<T>): Promise<T> {
      const result = await manager.request(name, { mode: 'exclusive' }, async () => await task());
      return await result;
    },
  };
}
function browserPorts(): PersistencePorts {
  return {
    read: readStored,
    storage: () => { try { return globalThis.localStorage; } catch { return undefined; } },
    locks: browserLocks,
  };
}

export const PERSISTENCE_LABELS: Record<PersistenceStatus, string> = {
  unsaved: 'Belum tersimpan', saving: 'Sedang menyimpan…', saved: 'Tersimpan di browser',
  failed: 'Belum tersimpan · penyimpanan gagal', conflict: 'Belum tersimpan · konflik perubahan',
  unsupported: 'Penyimpanan aman tidak didukung', blocked: 'Data lama dilindungi · pemulihan diperlukan',
};

export function useLedgerStorage() {
  const [controller] = useState(() => new LedgerPersistenceController(readStored(), browserPorts()));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    function storageChanged(event: StorageEvent) {
      if (event.key === null || event.key === 'uangku:v1') controller.checkRemote();
    }
    function beforeUnload(event: BeforeUnloadEvent) {
      const current = controller.getSnapshot();
      if (!current.dirty && !current.pending) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('storage', storageChanged);
    window.addEventListener('focus', controller.checkRemote);
    window.addEventListener('beforeunload', beforeUnload);
    controller.checkRemote();
    return () => {
      window.removeEventListener('storage', storageChanged);
      window.removeEventListener('focus', controller.checkRemote);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [controller]);
  return {
    ...state,
    label: PERSISTENCE_LABELS[state.status],
    setCandidate: (next: StoredData, message?: string, options?: CandidateOptions) => controller.setCandidate(next, message, options),
    recoveryText: controller.recoveryText,
    retry: controller.retry,
    reloadLatest: controller.reloadLatest,
  };
}
