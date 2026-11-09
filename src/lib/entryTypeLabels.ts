import type { EntryType } from './finance';

/** Indonesian label for each entry type, shared by the table, detail modal and CSV export. */
export const typeLabels: Record<EntryType, string> = { expense: 'Pengeluaran', income: 'Pemasukan', transfer: 'Transfer', movement: 'Perpindahan dana', adjustment: 'Penyesuaian', unreviewed: 'Perlu dicek' };
