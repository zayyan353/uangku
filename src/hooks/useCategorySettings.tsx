import { createContext, useEffect, useState } from 'react';
import { CATEGORY_SETTINGS_KEY, defaultCategorySettings, validateCategorySettings, type CategorySettings } from '../lib/categorySettings';
import { upgradeCategorySettings } from '../lib/categorySettingsUpgrade';

export const CategorySettingsContext = createContext<CategorySettings>(defaultCategorySettings());
function load() {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(CATEGORY_SETTINGS_KEY);
    const effective = raw === null ? { settings: defaultCategorySettings(), added: 0, error: '' } : upgradeCategorySettings(validateCategorySettings(JSON.parse(raw)));
    return { raw, settings: effective.settings, packAdded: effective.added, packUpdated: 'updated' in effective ? effective.updated ?? 0 : 0, error: effective.error };
  } catch { return { raw, settings: { ...defaultCategorySettings(), rules: [] }, packAdded: 0, packUpdated: 0, error: 'Pengaturan kategori belum dapat dibaca. Pencocokan otomatis dihentikan sementara. Menyimpan formulir akan mengganti pengaturan yang tidak terbaca.' }; }
}
export function useCategorySettings() {
  const [snapshot, setSnapshot] = useState(load);
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (event.key === CATEGORY_SETTINGS_KEY || event.key === null) setSnapshot(load()); };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  async function save(next: CategorySettings, expectedRaw: string | null): Promise<void> {
    const checked = validateCategorySettings(next);
    const settings = validateCategorySettings({ ...checked, keywordPackVersion: 5 }), raw = JSON.stringify(settings);
    if (!navigator.locks?.request) throw Error('Browser ini belum mendukung koordinasi pengaturan. Coba browser yang mendukung Web Locks.');
    await navigator.locks.request('uangku:category-settings', () => {
      if (localStorage.getItem(CATEGORY_SETTINGS_KEY) !== expectedRaw) { setSnapshot(load()); throw Error('Pengaturan berubah di tab lain. Tutup lalu buka kembali pengelola kategori sebelum menyimpan.'); }
      localStorage.setItem(CATEGORY_SETTINGS_KEY, raw);
      setSnapshot({ raw, settings, packAdded: 0, packUpdated: 0, error: '' });
    });
  }
  return { ...snapshot, save };
}
