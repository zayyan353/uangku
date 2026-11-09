/**
 * Persistent-storage request for the browser's site data (StorageManager.persist).
 *
 * The browser decides the outcome. Safari and others use their own heuristics,
 * so `denied` is a normal answer, not an error. Nothing here touches the ledger.
 */
export type PersistenceStatus = 'not-requested' | 'checking' | 'granted' | 'denied' | 'unsupported';

export interface StorageManagerLike {
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
}

function browserStorageManager(): StorageManagerLike | undefined {
  try {
    return globalThis.navigator?.storage;
  } catch {
    return undefined;
  }
}

/**
 * Asks once for persistent storage. Skips the request when the browser already
 * reports persistence. Never throws: a missing API is `unsupported`, a rejected
 * or failed request is `denied`.
 */
export async function requestPersistentStorage(storage: StorageManagerLike | undefined = browserStorageManager()): Promise<PersistenceStatus> {
  if (!storage) return 'unsupported';
  const persisted = typeof storage.persisted === 'function' ? storage.persisted.bind(storage) : undefined;
  const persist = typeof storage.persist === 'function' ? storage.persist.bind(storage) : undefined;
  if (persisted) {
    try {
      if (await persisted() === true) return 'granted';
    } catch {
      // Fall through to the request; a failed check is not a decision.
    }
  }
  if (!persist) return 'unsupported';
  try {
    return await persist() === true ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/** Short Indonesian answer plus explanation for the privacy window. */
export function persistenceLabel(status: PersistenceStatus): { answer: string; detail: string } {
  switch (status) {
    case 'granted':
      return { answer: 'ya', detail: 'Browser tidak akan menghapus catatan secara otomatis saat ruang penyimpanan menipis. Catatan tetap terhapus bila kamu menghapus data situs.' };
    case 'denied':
      return { answer: 'tidak', detail: 'Browser memutuskan sendiri, misalnya Safari memakai penilaian otomatis, jadi ini bukan error. Catatan tetap tersimpan, tetapi browser dapat menghapusnya saat ruang menipis. Cadangkan secara rutin.' };
    case 'unsupported':
      return { answer: 'tidak tersedia', detail: 'Browser ini tidak menyediakan permintaan penyimpanan persisten. Catatan tetap tersimpan seperti biasa. Cadangkan secara rutin.' };
    case 'checking':
      return { answer: 'sedang diperiksa', detail: 'Uangku sedang meminta penyimpanan persisten ke browser.' };
    case 'not-requested':
      return { answer: 'belum diminta', detail: 'Uangku memintanya sekali setelah kamu mulai memakai data sendiri, bukan saat memakai data contoh.' };
  }
}
