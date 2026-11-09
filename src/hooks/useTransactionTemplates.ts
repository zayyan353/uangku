import { useEffect, useState } from 'react';
import { appendTemplate, parseStoredTemplates, TEMPLATES_KEY, type TransactionTemplate } from '../lib/transactionTemplates';
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
  async function add(template: TransactionTemplate): Promise<void> {
    if (!navigator.locks?.request) throw Error('Browser ini belum mendukung koordinasi penyimpanan. Coba browser yang mendukung Web Locks.');
    await finishInterruptedRestore(localStorage, browserLocks());
    await navigator.locks.request(CATEGORY_LOCK, () => {
      if (localStorage.getItem(RESTORE_JOURNAL) !== null) throw Error(restorePending);
      const current = localStorage.getItem(TEMPLATES_KEY);
      let next: ReturnType<typeof appendTemplate>;
      try { next = appendTemplate(current, template); }
      catch (error) { setSnapshot(load()); throw error; }
      localStorage.setItem(TEMPLATES_KEY, next.raw);
      setSnapshot({ raw: next.raw, templates: next.templates, error: '' });
    });
  }
  return { ...snapshot, add };
}
