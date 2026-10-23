import type { Entry, State } from './finance';
import type { ImportPreview, ImportRow } from './importer';

const OLDER_HISTORY = 'Ada transaksi sebelum batas awal catatan dompet ini. Menambahkannya dapat menghitung saldo dua kali. Gunakan dompet kosong lalu impor ulang seluruh periode yang ingin dicatat.';
const UNKNOWN_BOUNDARY = 'Urutan pada tanggal awal belum bisa dicocokkan dengan catatan yang ada. Unggah ekspor bertumpang tindih yang memuat transaksi awal yang sudah tercatat, atau gunakan dompet kosong lalu impor ulang seluruh periode.';
const AMBIGUOUS_ORDER = 'Urutan transaksi pada batas awal belum bisa dipastikan. Untuk memasukkan riwayat yang lebih lama, gunakan dompet kosong lalu impor ulang seluruh periode agar saldo tetap benar.';

function involvesWallet(entry: Entry, walletId: string): boolean {
  return entry.walletId === walletId || (entry.type === 'transfer' && entry.toWalletId === walletId);
}

function walletSourceKey(entry: Entry, walletId: string): string | undefined {
  return entry.walletId === walletId ? entry.sourceKey
    : entry.type === 'transfer' && entry.toWalletId === walletId ? entry.toSourceKey : undefined;
}

function orderEvidence(rows: ImportRow[]): { newestFirst: boolean; oldestFirst: boolean } {
  const newestFirst = rows.every((row, i) => i === 0 || rows[i - 1].date >= row.date)
    && rows.every((row, i) => i === rows.length - 1 || row.balance === rows[i + 1].balance + row.amount);
  const oldestFirst = rows.every((row, i) => i === 0 || rows[i - 1].date <= row.date)
    && rows.every((row, i) => i === 0 || row.balance === rows[i - 1].balance + row.amount);
  return { newestFirst, oldestFirst };
}

/**
 * Do not add pre-baseline movements to an already-established opening balance.
 * This deliberately refuses uncertain same-day backfills; the export has no
 * timestamp and an opening-balance date is not part of the current data model.
 * The input preview must already have passed the workbook importer's checks.
 */
export function validateImportRange(state: State, walletId: string, preview: ImportPreview): string | null {
  const selected = preview.rows.filter(row => row.selected && !row.duplicate);
  if (!selected.length) return null;
  const activity = state.entries.map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => involvesWallet(entry, walletId))
    .sort((a, b) => a.entry.date.localeCompare(b.entry.date) || a.index - b.index);
  if (!activity.length) return null;
  if (selected.some(row => row.date < activity[0].entry.date)) return OLDER_HISTORY;

  const earliestImported = activity.find(({ entry }) => walletSourceKey(entry, walletId));
  if (!earliestImported) return null;
  const anchorKey = walletSourceKey(earliestImported.entry, walletId)!;
  const anchorDate = earliestImported.entry.date;
  // A strictly newer period cannot change the initial transaction boundary.
  if (selected.every(row => row.date > anchorDate)) return null;
  const anchor = preview.rows.find(row => row.sourceKey === anchorKey);
  if (!anchor) return UNKNOWN_BOUNDARY;

  const { newestFirst, oldestFirst } = orderEvidence(preview.rows);
  if (!newestFirst && !oldestFirst) return AMBIGUOUS_ORDER;
  // Equal-date opposing movements can reconcile in either order. In that case
  // no new same-day row can be proven to come after the original anchor.
  if (newestFirst && oldestFirst && preview.rows.length > 1
    && selected.some(row => row.date <= anchorDate)) return AMBIGUOUS_ORDER;
  const chronological = newestFirst ? [...preview.rows].reverse() : preview.rows;
  const anchorIndex = chronological.findIndex(row => row.sourceKey === anchorKey);
  const selectedIds = new Set(selected.map(row => row.id));
  if (chronological.slice(0, anchorIndex).some(row => selectedIds.has(row.id))) return OLDER_HISTORY;
  return null;
}
