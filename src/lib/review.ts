import { CATEGORY_NAMES, validateEntry, type Entry, type State } from './finance';

export function canCategorize(entry: Entry): boolean {
  return entry.type === 'expense' || entry.type === 'income' || entry.type === 'unreviewed' || entry.type === 'movement';
}

/**
 * Atomically categorize selected records. A category alone never turns an
 * imported bank credit into income or a possible transfer into an expense.
 */
export function categorizeEntries(state: State, ids: string[], category: string, confirmUnreviewed = false): State {
  const selectedIds = new Set(ids);
  if (!selectedIds.size) throw new Error('Pilih setidaknya satu transaksi untuk dirapikan.');
  if (!CATEGORY_NAMES.includes(category)) throw new Error('Pilih kategori yang tersedia.');
  const selected = state.entries.filter(entry => selectedIds.has(entry.id));
  if (selected.length !== selectedIds.size) {
    throw new Error('Ada transaksi yang tidak ditemukan atau ID yang berulang. Muat ulang daftar lalu coba lagi.');
  }
  if (selected.some(entry => !canCategorize(entry))) {
    throw new Error('Transfer dan penyesuaian saldo tidak bisa diberi kategori. Pilih pemasukan, pengeluaran, atau transaksi yang perlu dicek.');
  }

  // Each replacement retains its original, already-verified ID. Remove batch
  // targets before validation so their old records are not seen as duplicates.
  const validationState = { ...state, entries: state.entries.filter(entry => !selectedIds.has(entry.id)) };
  const replacements = new Map<string, Entry>();
  for (const entry of selected) {
    const confirm = confirmUnreviewed && entry.type === 'unreviewed';
    const next: Entry = confirm ? {
      ...entry, category,
      type: entry.amount > 0 ? 'income' : 'expense',
      amount: Math.abs(entry.amount),
    } : entry.category === category ? entry : { ...entry, category };
    const error = validateEntry(validationState, next);
    if (error) throw new Error(error);
    replacements.set(entry.id, next);
  }
  const changed = selected.some(entry => replacements.get(entry.id) !== entry);
  return {
    ...state,
    entries: changed ? state.entries.map(entry => replacements.get(entry.id) ?? entry) : state.entries,
  };
}

function calendarTime(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  return parsed.getTime();
}

/** Suggestions only: no ownership, FX rate, fee split, or confirmation is inferred. */
export function transferCandidates(state: State, entryId: string): Array<{ id: string; daysApart: number }> {
  const entry = state.entries.find(candidate => candidate.id === entryId);
  if (!entry || !['unreviewed', 'movement'].includes(entry.type) || !Number.isSafeInteger(entry.amount) || entry.amount === 0) return [];
  const source = state.wallets.find(wallet => wallet.id === entry.walletId);
  const time = calendarTime(entry.date);
  if (!source || time === null) return [];
  const currencies = new Map(state.wallets.map(wallet => [wallet.id, wallet.currency]));
  return state.entries.flatMap(candidate => {
    if (candidate.id === entry.id || !['unreviewed', 'movement'].includes(candidate.type) || candidate.walletId === entry.walletId
      || currencies.get(candidate.walletId) !== source.currency || candidate.amount !== -entry.amount) return [];
    const candidateTime = calendarTime(candidate.date);
    if (candidateTime === null) return [];
    const daysApart = Math.abs(candidateTime - time) / 86_400_000;
    return daysApart <= 3 ? [{ id: candidate.id, daysApart }] : [];
  }).sort((a, b) => a.daysApart - b.daysApart);
}
