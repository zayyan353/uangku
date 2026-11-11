import { useEffect, useState } from 'react';
import { appendTemplate, parseStoredTemplates, removeTemplate, renameTemplate, TEMPLATES_KEY, type TransactionTemplate } from '../lib/transactionTemplates';
import { browserLocks, CATEGORY_LOCK, finishInterruptedRestore, PROFILE_CHANGED, RESTORE_JOURNAL, restorePending } from '../lib/fullRestoreStorage';

export const unreadableTemplates = 'Template tersimpan tidak dapat dibaca. Template baru belum dapat disimpan agar daftar lama tidak tertimpa.';

function load(): { raw: string | null; templates: TransactionTemplate[]; error: string } {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(TEMPLATES_KEY);
    return { raw, templates: parseStoredTemplates(raw), error: '' };
  } catch { return { raw, templates: [], error: unreadableTemplates }; }
}

/**
 * Transaction templates live under their own key, outside the ledger. Writes
 * share the category settings lock, which full restore also holds, and read
 * the stored list inside that lock, so a template saved in another tab is
 * never overwritten.
 */
export function useTransactionTemplates() {
  const [snapshot, setSnapshot] = useState(load);
  useEffect(() => {
    const refresh = () => setSnapshot(load());
    const changed = (event: StorageEvent) => {
      if (event.key === TEMPLATES_KEY || event.key === RESTORE_JOURNAL || event.key === null) refresh();
    };
    window.addEventListener('storage', changed);
    window.addEventListener(PROFILE_CHANGED, refresh);
    return () => { window.removeEventListener('storage', changed); window.removeEventListener(PROFILE_CHANGED, refresh); };
  }, []);
  /** Reads the stored list inside the shared lock, applies one change, and writes it back. A refused change leaves storage untouched. */
  async function change(apply: (raw: string | null) => { raw: string; templates: TransactionTemplate[] }): Promise<void> {
    if (!navigator.locks?.request) throw Error('Browser ini belum mendukung koordinasi penyimpanan. Coba browser yang mendukung Web Locks.');
    await finishInterruptedRestore(localStorage, browserLocks());
    await navigator.locks.request(CATEGORY_LOCK, () => {
      if (localStorage.getItem(RESTORE_JOURNAL) !== null) throw Error(restorePending);
      const current = localStorage.getItem(TEMPLATES_KEY);
      let next: ReturnType<typeof appendTemplate>;
      try { next = apply(current); }
      catch (error) { setSnapshot(load()); throw error; }
      localStorage.setItem(TEMPLATES_KEY, next.raw);
      setSnapshot({ raw: next.raw, templates: next.templates, error: '' });
    });
  }
  const add = (template: TransactionTemplate) => change(raw => appendTemplate(raw, template));
  const remove = (id: string) => change(raw => removeTemplate(raw, id));
  const rename = (id: string, name: string) => change(raw => renameTemplate(raw, id, name));
  return { ...snapshot, add, remove, rename };
}
