import { createContext, useEffect, useState } from 'react';
import { CATEGORY_SETTINGS_KEY, defaultCategorySettings, validateCategorySettings, type CategorySettings } from '../lib/categorySettings';
import { effectiveCategorySettings } from '../lib/categorySettingsUpgrade';
import { browserLocks, CATEGORY_LOCK, finishInterruptedRestore, PROFILE_CHANGED, RESTORE_JOURNAL, restorePending } from '../lib/fullRestoreStorage';

export const CategorySettingsContext = createContext<CategorySettings>(defaultCategorySettings());
function load() {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(CATEGORY_SETTINGS_KEY);
    if (localStorage.getItem(RESTORE_JOURNAL) !== null) {
      return { raw, settings: { ...defaultCategorySettings(), rules: [] }, packAdded: 0, packUpdated: 0, error: restorePending };
    }
    const effective = effectiveCategorySettings(raw);
    return { raw, settings: effective.settings, packAdded: effective.added, packUpdated: effective.updated ?? 0, error: effective.error };
  } catch { return { raw, settings: { ...defaultCategorySettings(), rules: [] }, packAdded: 0, packUpdated: 0, error: 'Pengaturan kategori belum dapat dibaca. Pencocokan otomatis dihentikan sementara. Menyimpan formulir akan mengganti pengaturan yang tidak terbaca.' }; }
}
export function useCategorySettings() {
  const [snapshot, setSnapshot] = useState(load);
  useEffect(() => {
    let active = true;
    async function refresh() {
      try { await finishInterruptedRestore(localStorage, browserLocks()); } catch { /* load reports a protected state */ }
      if (active) setSnapshot(load());
    }
    const changed = (event: StorageEvent) => {
      if (event.key === CATEGORY_SETTINGS_KEY || event.key === RESTORE_JOURNAL || event.key === null) void refresh();
    };
    window.addEventListener('storage', changed);
    window.addEventListener(PROFILE_CHANGED, refresh);
    try { if (localStorage.getItem(RESTORE_JOURNAL) !== null) void refresh(); } catch { /* initial load reported the error */ }
    return () => { active = false; window.removeEventListener('storage', changed); window.removeEventListener(PROFILE_CHANGED, refresh); };
  }, []);
  async function save(next: CategorySettings, expectedRaw: string | null): Promise<void> {
    if (snapshot.error === restorePending) throw Error(restorePending);
    const checked = validateCategorySettings(next);
    const settings = validateCategorySettings({ ...checked, keywordPackVersion: 5 }), raw = JSON.stringify(settings);
    if (!navigator.locks?.request) throw Error('Browser ini belum mendukung koordinasi pengaturan. Coba browser yang mendukung Web Locks.');
    await finishInterruptedRestore(localStorage, browserLocks());
    await navigator.locks.request(CATEGORY_LOCK, () => {
      if (localStorage.getItem(RESTORE_JOURNAL) !== null) throw Error(restorePending);
      if (localStorage.getItem(CATEGORY_SETTINGS_KEY) !== expectedRaw) { setSnapshot(load()); throw Error('Pengaturan berubah di tab lain. Tutup lalu buka kembali pengelola kategori sebelum menyimpan.'); }
      localStorage.setItem(CATEGORY_SETTINGS_KEY, raw);
      setSnapshot({ raw, settings, packAdded: 0, packUpdated: 0, error: '' });
    });
  }
  return { ...snapshot, recovering: snapshot.error === restorePending, save };
}
