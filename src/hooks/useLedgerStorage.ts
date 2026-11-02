/** Fresh minimum reconstruction; no persistence writes occur in effects. */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { makeDemoData, readStored, STORAGE_KEY } from '../lib/storage';
import { LedgerPersistenceController, type CandidateOptions, type PersistencePorts, type PersistenceStatus } from '../lib/persistence';
import { browserLocks, finishInterruptedRestore, PROFILE_CHANGED, RESTORE_JOURNAL, restorePending } from '../lib/fullRestoreStorage';
import type { StoredData } from '../lib/storage';

function readLedger() {
  const stored = readStored();
  try {
    if (localStorage.getItem(RESTORE_JOURNAL) !== null) {
      return { ...stored, data: makeDemoData(), blocked: true, error: restorePending };
    }
  } catch { /* readStored supplies the protected state for inaccessible storage. */ }
  return stored;
}
function browserPorts(): PersistencePorts {
  return {
    read: readLedger,
    storage: () => { try { return globalThis.localStorage; } catch { return undefined; } },
    locks: browserLocks,
    profileChanged: () => window.dispatchEvent(new Event(PROFILE_CHANGED)),
  };
}

export const PERSISTENCE_LABELS: Record<PersistenceStatus, string> = {
  unsaved: 'Belum tersimpan', saving: 'Sedang menyimpan…', saved: 'Tersimpan di browser',
  failed: 'Belum tersimpan · penyimpanan gagal', conflict: 'Belum tersimpan · konflik perubahan',
  unsupported: 'Penyimpanan aman tidak didukung', blocked: 'Data lama dilindungi · pemulihan diperlukan',
};

export function useLedgerStorage() {
  const [controller] = useState(() => new LedgerPersistenceController(readLedger(), browserPorts()));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    let active = true;
    async function refresh() {
      try { await finishInterruptedRestore(localStorage, browserLocks()); }
      catch { /* Keep interrupted records protected; retry on focus or the next change. */ }
      if (active) controller.checkRemote();
    }
    function storageChanged(event: StorageEvent) {
      if (event.key === null || event.key === STORAGE_KEY || event.key === RESTORE_JOURNAL) void refresh();
    }
    function beforeUnload(event: BeforeUnloadEvent) {
      const current = controller.getSnapshot();
      if (!current.dirty && !current.pending) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('storage', storageChanged);
    window.addEventListener('focus', refresh);
    window.addEventListener(PROFILE_CHANGED, refresh);
    window.addEventListener('beforeunload', beforeUnload);
    void refresh();
    return () => {
      active = false;
      window.removeEventListener('storage', storageChanged);
      window.removeEventListener('focus', refresh);
      window.removeEventListener(PROFILE_CHANGED, refresh);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [controller]);
  return {
    ...state,
    label: PERSISTENCE_LABELS[state.status],
    setCandidate: (next: StoredData, message?: string, options?: CandidateOptions) => controller.setCandidate(next, message, options),
    recoveryText: controller.recoveryText,
    exportFullBackup: controller.exportFullBackup,
    retry: controller.retry,
    reloadLatest: controller.reloadLatest,
  };
}
