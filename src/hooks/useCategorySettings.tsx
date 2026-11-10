import { createContext, useEffect, useState } from 'react';
import { CATEGORY_SETTINGS_KEY, defaultCategorySettings, KEYWORD_PACK_VERSION, validateCategorySettings, type CategorySettings } from '../lib/categorySettings';
import { effectiveCategorySettings } from '../lib/categorySettingsUpgrade';
import { BUDGETS_KEY, isEmptyBudgets, parseStoredBudgets, serializeBudgets, type BudgetMap } from '../lib/budgets';
import { browserLocks, CATEGORY_LOCK, finishInterruptedRestore, PROFILE_CHANGED, RESTORE_JOURNAL, restorePending } from '../lib/fullRestoreStorage';

export const CategorySettingsContext = createContext<CategorySettings>(defaultCategorySettings());
export const unreadableBudgets = 'Anggaran tersimpan tidak dapat dibaca. Bagian anggaran dikunci agar anggaran lama tidak tertimpa.';
/** A budget change saved together with category settings, guarded by its own raw token. */
export interface BudgetChange { budgets: BudgetMap; expectedRaw: string | null }
function loadBudgets(): { budgetsRaw: string | null; budgets: BudgetMap; budgetsError: string } {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(BUDGETS_KEY);
    return { budgetsRaw: raw, budgets: parseStoredBudgets(raw), budgetsError: '' };
  } catch { return { budgetsRaw: raw, budgets: {}, budgetsError: unreadableBudgets }; }
}
function load() { return { ...loadCategories(), ...loadBudgets() }; }
function loadCategories() {
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
      if (event.key === CATEGORY_SETTINGS_KEY || event.key === BUDGETS_KEY || event.key === RESTORE_JOURNAL || event.key === null) void refresh();
    };
    window.addEventListener('storage', changed);
    window.addEventListener(PROFILE_CHANGED, refresh);
    try { if (localStorage.getItem(RESTORE_JOURNAL) !== null) void refresh(); } catch { /* initial load reported the error */ }
    return () => { active = false; window.removeEventListener('storage', changed); window.removeEventListener(PROFILE_CHANGED, refresh); };
  }, []);
  async function save(next: CategorySettings, expectedRaw: string | null, budgetChange?: BudgetChange): Promise<void> {
    if (snapshot.error === restorePending) throw Error(restorePending);
    const checked = validateCategorySettings(next);
    const settings = validateCategorySettings({ ...checked, keywordPackVersion: KEYWORD_PACK_VERSION }), raw = JSON.stringify(settings);
    // Validate before the lock; an empty map removes the key instead of storing "{}".
    const budgets = budgetChange ? parseStoredBudgets(serializeBudgets(budgetChange.budgets)) : undefined;
    const budgetsRaw = budgets && !isEmptyBudgets(budgets) ? serializeBudgets(budgets) : null;
    if (!navigator.locks?.request) throw Error('Browser ini belum mendukung koordinasi pengaturan. Coba browser yang mendukung Web Locks.');
    await finishInterruptedRestore(localStorage, browserLocks());
    await navigator.locks.request(CATEGORY_LOCK, () => {
      if (localStorage.getItem(RESTORE_JOURNAL) !== null) throw Error(restorePending);
      if (localStorage.getItem(CATEGORY_SETTINGS_KEY) !== expectedRaw) { setSnapshot(load()); throw Error('Pengaturan berubah di tab lain. Tutup lalu buka kembali pengelola kategori sebelum menyimpan.'); }
      if (budgetChange && localStorage.getItem(BUDGETS_KEY) !== budgetChange.expectedRaw) { setSnapshot(load()); throw Error('Anggaran berubah di tab lain. Tutup lalu buka kembali pengelola kategori sebelum menyimpan.'); }
      const writeBudgets = budgetChange !== undefined && budgetsRaw !== budgetChange.expectedRaw;
      if (writeBudgets) {
        if (budgetsRaw === null) localStorage.removeItem(BUDGETS_KEY); else localStorage.setItem(BUDGETS_KEY, budgetsRaw);
      }
      try { localStorage.setItem(CATEGORY_SETTINGS_KEY, raw); }
      catch (error) {
        // Settings and budgets are saved together or not at all.
        if (writeBudgets) {
          try { if (budgetChange.expectedRaw === null) localStorage.removeItem(BUDGETS_KEY); else localStorage.setItem(BUDGETS_KEY, budgetChange.expectedRaw); }
          catch { /* load() below reports what is actually stored. */ }
        }
        setSnapshot(load());
        throw error;
      }
      setSnapshot({ raw, settings, packAdded: 0, packUpdated: 0, error: '', ...(budgets ? { budgetsRaw, budgets, budgetsError: '' } : loadBudgets()) });
    });
  }
  return { ...snapshot, recovering: snapshot.error === restorePending, save };
}
