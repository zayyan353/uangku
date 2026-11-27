import { createContext, useEffect, useState } from 'react';
import { NewerVersionError, newerVersionMessage } from '../lib/newerVersion';
import { STORAGE_KEY } from '../lib/storage';
import { CATEGORY_SETTINGS_KEY, defaultCategorySettings, KEYWORD_PACK_VERSION, validateCategorySettings, type CategorySettings } from '../lib/categorySettings';
import { effectiveCategorySettings } from '../lib/categorySettingsUpgrade';
import { BUDGETS_KEY, isEmptyBudgets, parseStoredBudgets, serializeBudgets, type BudgetMap } from '../lib/budgets';
import { browserLocks, CATEGORY_LOCK, finishInterruptedRestore, PROFILE_CHANGED, RESTORE_JOURNAL, restorePending } from '../lib/fullRestoreStorage';
import { withMetadataClaims } from '../lib/metadataClaims';

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
  } catch (reason) { return { raw, settings: { ...defaultCategorySettings(), rules: [] }, packAdded: 0, packUpdated: 0, error: reason instanceof NewerVersionError ? newerVersionMessage : 'Pengaturan kategori belum dapat dibaca. Pencocokan otomatis dihentikan sementara. Menyimpan formulir akan mengganti pengaturan yang tidak terbaca.' }; }
}
export function useCategorySettings() {
  const [snapshot, setSnapshot] = useState(load);
  const recovering = snapshot.error === restorePending;
  useEffect(() => {
    let active = true;
    async function refresh() {
      try { await finishInterruptedRestore(localStorage, browserLocks()); } catch { /* load reports a protected state */ }
      if (active) setSnapshot(load());
    }
    const changed = (event: StorageEvent) => {
      if (event.key === CATEGORY_SETTINGS_KEY || event.key === BUDGETS_KEY || event.key === RESTORE_JOURNAL || event.key === null ||
          (recovering && event.key === STORAGE_KEY)) void refresh();
    };
    window.addEventListener('storage', changed);
    window.addEventListener(PROFILE_CHANGED, refresh);
    if (recovering) window.addEventListener('focus', refresh);
    try { if (recovering || localStorage.getItem(RESTORE_JOURNAL) !== null) void refresh(); } catch { /* initial load reported the error */ }
    return () => {
      active = false;
      window.removeEventListener('storage', changed);
      window.removeEventListener(PROFILE_CHANGED, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [recovering]);
  async function save(next: CategorySettings, expectedRaw: string | null, budgetChange?: BudgetChange): Promise<void> {
    if (snapshot.error === newerVersionMessage) throw new NewerVersionError();
    if (recovering) throw Error(restorePending);
    const checked = validateCategorySettings(next);
    const settings = validateCategorySettings({ ...checked, keywordPackVersion: KEYWORD_PACK_VERSION }), raw = JSON.stringify(settings);
    // Validate before the lock; an empty map removes the key instead of storing "{}".
    const budgets = budgetChange ? parseStoredBudgets(serializeBudgets(budgetChange.budgets)) : undefined;
    const budgetsRaw = budgets && !isEmptyBudgets(budgets) ? serializeBudgets(budgets) : null;
    const locks = browserLocks();
    if (!locks) throw Error('Browser ini belum mendukung koordinasi pengaturan. Coba browser yang mendukung Web Locks.');
    await finishInterruptedRestore(localStorage, locks);
    const bases = [{ key: CATEGORY_SETTINGS_KEY, raw: expectedRaw, message: 'Pengaturan berubah di tab lain. Tutup lalu buka kembali pengelola kategori sebelum menyimpan.' }];
    if (budgetChange) bases.push({ key: BUDGETS_KEY, raw: budgetChange.expectedRaw, message: 'Anggaran berubah di tab lain. Tutup lalu buka kembali pengelola kategori sebelum menyimpan.' });
    try {
      await locks.runExclusive(CATEGORY_LOCK, () => withMetadataClaims(localStorage, locks, bases, storage => {
        if (storage.getItem(RESTORE_JOURNAL) !== null) throw Error(restorePending);
        const writeBudgets = budgetChange !== undefined && budgetsRaw !== budgetChange.expectedRaw;
        if (writeBudgets) {
          if (budgetsRaw === null) storage.removeItem(BUDGETS_KEY); else storage.setItem(BUDGETS_KEY, budgetsRaw);
        }
        try { storage.setItem(CATEGORY_SETTINGS_KEY, raw); }
        catch (error) {
          // Restore the previous budget if the accompanying settings write fails.
          if (writeBudgets) {
            try {
              if (budgetChange.expectedRaw === null) storage.removeItem(BUDGETS_KEY); else storage.setItem(BUDGETS_KEY, budgetChange.expectedRaw);
            } catch { /* The snapshot below reloads the actual stored limits. */ }
          }
          throw error;
        }
        setSnapshot({ raw, settings, packAdded: 0, packUpdated: 0, error: '', ...(budgets ? { budgetsRaw, budgets, budgetsError: '' } : loadBudgets()) });
      }));
    } catch (error) {
      setSnapshot(load());
      throw error;
    }
  }
  return { ...snapshot, recovering, newerVersion: snapshot.error === newerVersionMessage, save };
}
