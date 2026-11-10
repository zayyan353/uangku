import { Download, Search } from 'lucide-react';
import type { HistoryPeriod } from '../lib/historyView';
import type { ReviewReason } from '../lib/reviewStatus';

export interface HistoryWalletOption {
  id: string;
  name: string;
  archived: boolean;
}

/** Filter bar above the transaction history and the review queue. */
export function HistoryFilters({
  isReviewQueue, query, onQueryChange, period, periodMonthLabel, onPeriodChange,
  walletId, walletOptions, onWalletChange, typeFilter, onTypeFilterChange,
  reviewReason, onReviewReasonChange, onReset, onDownloadCsv, transactionCount, pendingCount,
}: {
  isReviewQueue: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  period: HistoryPeriod;
  periodMonthLabel: string;
  onPeriodChange: (period: HistoryPeriod) => void;
  walletId: string;
  walletOptions: HistoryWalletOption[];
  onWalletChange: (walletId: string) => void;
  typeFilter: string;
  onTypeFilterChange: (filter: string) => void;
  reviewReason: ReviewReason;
  onReviewReasonChange: (reason: ReviewReason) => void;
  onReset: () => void;
  /** Downloads every row matching the current filters (all pages). */
  onDownloadCsv: () => void;
  transactionCount: number;
  pendingCount: number;
}) {
  return <div className="filter-bar"><div className="filter-fields"><label className="search-input"><Search size={18} /><input placeholder="Cari keterangan atau dompet…" aria-label="Cari transaksi" value={query} onChange={e => onQueryChange(e.target.value)} /></label>{!isReviewQueue && <label className="history-period"><span className="field-label">Periode</span><select aria-label="Periode transaksi" className="select-input" value={period} onChange={e => onPeriodChange(e.target.value as HistoryPeriod)}><option value="month">{periodMonthLabel}</option><option value="all">Semua periode</option></select></label>}<select aria-label="Dompet riwayat" className="select-input" value={walletId} onChange={event => onWalletChange(event.target.value)}><option value="all">Semua dompet</option>{walletOptions.map(wallet => <option key={wallet.id} value={wallet.id}>{wallet.name}{wallet.archived ? ' (arsip)' : ''}</option>)}</select><select aria-label="Filter jenis transaksi" className="select-input" value={typeFilter} onChange={e => onTypeFilterChange(e.target.value)}><option value="all">Semua jenis</option><option value="expense">Pengeluaran</option><option value="income">Pemasukan</option><option value="transfer">Transfer</option><option value="movement">Perpindahan dana rekening</option><option value="pending">Perlu dirapikan</option><option value="adjustment">Penyesuaian</option></select>{isReviewQueue && <select aria-label="Alasan perlu dirapikan" className="select-input" value={reviewReason} onChange={event => onReviewReasonChange(event.target.value as ReviewReason)}><option value="all">Semua alasan</option><option value="type">Jenis perlu dicek</option><option value="category">Kategori belum diisi</option></select>}</div>
    <div className="filter-summary"><div className="filter-summary-count"><span className="transaction-count">{transactionCount} transaksi</span>{!isReviewQueue && pendingCount > 0 && <button className="button secondary small" onClick={() => onTypeFilterChange('pending')}>Rapikan {pendingCount} catatan</button>}</div><div className="filter-actions"><button type="button" className="button secondary small" onClick={onReset}>Reset filter</button><button type="button" className="button secondary small" disabled={transactionCount === 0} onClick={onDownloadCsv}><Download size={14} /> Unduh CSV</button></div></div></div>;
}
