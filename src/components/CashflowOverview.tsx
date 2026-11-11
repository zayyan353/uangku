import { ArrowDownLeft, ArrowUpRight, ChevronDown, Wallet as WalletIcon } from 'lucide-react';
import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { formatDate, formatMoney, type Currency, type Wallet } from '../lib/finance';
import { monthLabel } from '../lib/historyView';
import type { CashflowReport } from '../lib/cashflowReport';

interface Props {
  report?: CashflowReport;
  error?: string;
  currency: Currency;
  month: string;
  period: 'month' | 'all';
  walletId: string;
  wallets: Wallet[];
  archivedWalletIds?: ReadonlySet<string>;
  onPeriodChange: (period: 'month' | 'all') => void;
  onWalletChange: (walletId: string) => void;
  balanceCard: ReactNode;
  /** Shown in place of the two calculation panels while the ledger has no entries at all. */
  startGuide?: ReactNode;
  /** Phone layout: the month field sits with scope and period, and banners follow the cards. */
  /** Last month's full totals for the same scope; absent when that month has no flow. */
  previous?: { label: string; inflow: number; outflow: number };
  monthControl?: ReactNode;
  afterCards?: ReactNode;
}

const phoneLayout = '(max-width: 760px)';
function subscribeLayout(listener: () => void) {
  const media = window.matchMedia(phoneLayout);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
export function useMobileOverview() {
  return useSyncExternalStore(subscribeLayout, () => window.matchMedia(phoneLayout).matches);
}

type Folds = { reconciliation?: boolean; breakdown?: boolean };
/** The last open/closed choice, kept while the app stays open so it survives a visit to another page. */
let rememberedFolds: Folds = {};

/** Panel header that folds its body; on phones the body starts folded. */
export function FoldHeader({ title, description, summary, open, controls, onToggle, mark = 'cashflow' }: { title: string; description: string; summary?: string; open: boolean; controls: string; onToggle: () => void;
  /** Which group of folding panels this header belongs to; the cashflow pair is addressed together by tests. */
  mark?: 'cashflow' | 'category' }) {
  return <h2 className="fold-header"><button type="button" className="fold-toggle" aria-expanded={open} aria-controls={controls} {...(mark === 'cashflow' ? { 'data-cashflow-fold': true } : { 'data-category-fold': true })} onClick={onToggle}><span className="fold-text"><span className="fold-title">{title}</span><span className="fold-desc">{open || !summary ? description : summary}</span></span><ChevronDown className="fold-chevron" size={18} aria-hidden="true" /></button></h2>;
}

function periodCaption(report: CashflowReport | undefined, month: string, period: Props['period']) {
  if (!report) return 'Laporan belum dapat dihitung';
  if (report.notStarted) return `${monthLabel(month)} · periode belum dimulai`;
  return period === 'all' ? `Seluruh catatan hingga ${formatDate(report.periodEnd)}` : `${formatDate(report.periodStart!)} – ${formatDate(report.periodEnd)}`;
}

export function CashflowBalance({ report, currency, month, period, scope, mobile, demo }: Pick<Props, 'report' | 'currency' | 'month' | 'period'> & {
  scope: string; mobile: boolean; demo: boolean;
}) {
  const closing = report?.closingBalance;
  return <section className={`balance-card${mobile ? ' balance-card-compact' : ''}`}>
    <div className="balance-card-top">
      <span className="balance-label">{closing == null ? 'Saldo akhir periode' : `Saldo per ${formatDate(report!.periodEnd)}`}</span>
      {mobile && demo && <span className="balance-demo">Data contoh</span>}
      {!mobile && <span className="balance-currency">{currency === 'TRY' ? 'TL' : currency}</span>}
    </div>
    <div className="balance-number"><span data-testid="cashflow-closing" data-amount={closing ?? undefined}>{closing == null ? mobile ? 'Belum tersedia' : '—' : formatMoney(closing, currency)}</span></div>
    <div className="balance-meta"><WalletIcon size={15} /><span>{scope}</span></div>
    {mobile && <p className="balance-period">{periodCaption(report, month, period)}</p>}
    <span className="balance-orbit orbit-one" /><span className="balance-orbit orbit-two" />
    {report && report.allRecordsBalance !== closing && <div className="balance-bottom"><span>Seluruh catatan: {formatMoney(report.allRecordsBalance, currency)} · termasuk tanggal masa depan</span></div>}
  </section>;
}

export default function CashflowOverview({ report, error, currency, month, period, walletId, wallets, archivedWalletIds, onPeriodChange, onWalletChange, balanceCard, startGuide, monthControl, afterCards, previous }: Props) {
  const warning = error || report?.balanceWarning || (report?.notStarted ? 'Periode belum dimulai. Transaksi bertanggal masa depan tidak masuk arus rekening aktual.' : '');
  const amount = (value: number | null | undefined, id?: string) => <span data-testid={id ? `cashflow-${id}` : undefined} data-amount={value ?? undefined}>{value === null || value === undefined ? '—' : formatMoney(value, currency)}</span>;
  /** A breakdown cell; an empty side reads as a dash so the filled amounts stand out. */
  const flow = (value: number) => value === 0 ? <span className="cashflow-none" data-amount={0}><span aria-hidden="true">—</span><span className="screen-reader-only">{formatMoney(0, currency)}</span></span> : amount(value);
  const caption = periodCaption(report, month, period);
  // The note follows the chosen scope: one active wallet's report holds no archived wallet.
  const archivedCount = archivedWalletIds?.size ?? 0;
  const archiveNote = walletId === 'all'
    ? archivedCount ? `Laporan tetap mencakup ${archivedCount} dompet arsip. Pengarsipan tidak menghapus saldo atau histori.` : ''
    : archivedWalletIds?.has(walletId) ? 'Dompet ini diarsipkan. Saldo dan historinya tetap dihitung.' : '';
  const mobile = useMobileOverview();
  const [folds, setFoldState] = useState<Folds>(rememberedFolds);
  const setFolds = (update: (current: Folds) => Folds) => setFoldState(current => rememberedFolds = update(current));
  const reconciliationOpen = folds.reconciliation ?? !mobile, breakdownOpen = folds.breakdown ?? !mobile;
  const reconciliationId = useId(), breakdownId = useId();
  const matched = !!report?.isComplete && report.difference === 0;
  const breakdownCount = report?.breakdown.length ?? 0;
  // When the sum does not close, name the cause instead of a general "not certain".
  const verdict = matched ? 'Perhitungan saldo periode cocok. Ini mencocokkan catatan aplikasi, belum membuktikan mutasi bank sudah lengkap.'
    : !report ? 'Laporan belum dapat dihitung, jadi saldo periode belum tersedia.'
    : report.notStarted ? 'Periode belum dimulai, jadi belum ada saldo periode yang dihitung.'
    : report.unknownDatePostings ? `Saldo periode belum dapat dipastikan: ${report.unknownDatePostings} posting belum memiliki tanggal. Angka arus hanya mencakup posting dengan tanggal yang diketahui.`
    : report.difference ? `Perhitungan belum cocok: selisih ${formatMoney(report.difference, currency)} antara saldo akhir dan hasil hitungan.`
    : 'Saldo periode belum dapat dipastikan. Angka arus hanya mencakup posting dengan tanggal yang diketahui.';
  return <div className="cashflow-overview">
    <div className="cashflow-controls">
      <label><span className="field-label">Dompet</span><select className="select-input" aria-label="Dompet" value={walletId} onChange={event => onWalletChange(event.target.value)}><option value="all">Semua dompet {currency}</option>{wallets.map(wallet => <option key={wallet.id} value={wallet.id}>{wallet.name}{archivedWalletIds?.has(wallet.id) ? ' (arsip)' : ''}</option>)}</select></label>
      <label><span className="field-label">Periode</span><select className="select-input" aria-label="Periode arus rekening" value={period} onChange={event => onPeriodChange(event.target.value as 'month' | 'all')}><option value="month">{monthLabel(month)}</option><option value="all">Seluruh catatan</option></select></label>
      <div className="cashflow-period-row"><p className="cashflow-period" data-testid="cashflow-period">{caption}</p>{monthControl}</div>
    </div>
    {archiveNote && <p className="cashflow-explanation" data-testid="cashflow-archive-note">{archiveNote}</p>}
    {warning && <div className="notice warning" data-testid="cashflow-warning" role="status">{warning}</div>}
    <div className="overview-grid">
      {balanceCard}
      <div className="stats-stack"><section className="stat-card"><span className="stat-icon income"><ArrowDownLeft size={22} /></span><div><span className="stat-label">Uang masuk rekening</span><strong className="stat-value">{amount(report?.inflow, 'inflow')}</strong><span className="stat-foot">Termasuk transfer masuk dan catatan belum dikategorikan</span>{previous && <span className="stat-compare" data-testid="cashflow-previous-inflow" data-amount={previous.inflow}>{previous.label}: {formatMoney(previous.inflow, currency)}</span>}</div></section><section className="stat-card"><span className="stat-icon expense"><ArrowUpRight size={22} /></span><div><span className="stat-label">Uang keluar rekening</span><strong className="stat-value">{amount(report?.outflow, 'outflow')}</strong><span className="stat-foot">Termasuk transfer keluar, tarik tunai, dan biaya</span>{previous && <span className="stat-compare" data-testid="cashflow-previous-outflow" data-amount={previous.outflow}>{previous.label}: {formatMoney(previous.outflow, currency)}</span>}</div></section></div>
    </div>
    {afterCards}
    {startGuide ?? <>
    <section className="panel cashflow-reconciliation" data-testid="cashflow-reconciliation" data-complete={report?.isComplete ? 'true' : 'false'} aria-label="Perhitungan saldo periode">
      <FoldHeader title="Perhitungan saldo periode" description={period === 'all' ? 'Saldo awal catatan, bukan bukti kelengkapan seluruh histori bank.' : 'Saldo awal sebelum periode dipilih, hingga batas tanggal laporan.'} summary={matched ? 'Cocok · ketuk untuk melihat hitungan' : 'Belum dapat dipastikan · ketuk untuk detail'} open={reconciliationOpen} controls={reconciliationId} onToggle={() => setFolds(f => ({ ...f, reconciliation: !reconciliationOpen }))} />
      <div className="fold-body" id={reconciliationId} hidden={!reconciliationOpen}>
      <dl className="cashflow-equation"><div><dt>Saldo awal{period === 'all' ? ' catatan' : ' periode'}</dt><dd>{amount(report?.openingBalance, 'opening')}</dd></div><div><dt>+ Uang masuk</dt><dd>{amount(report?.inflow)}</dd></div><div><dt>− Uang keluar</dt><dd>{amount(report?.outflow)}</dd></div><div className={report?.internalNet === 0 ? 'equation-zero' : undefined}><dt>± Transfer antardompet</dt><dd>{amount(report?.internalNet, 'internal-net')}</dd></div><div className={report?.adjustment === 0 ? 'equation-zero' : undefined}><dt>± Penyesuaian saldo</dt><dd>{amount(report?.adjustment, 'adjustment')}</dd></div><div className="equation-result"><dt>= Saldo akhir</dt><dd>{amount(report?.closingBalance)}</dd></div></dl>
      <p className="cashflow-explanation" data-testid="cashflow-verdict">{verdict}</p>
      <details className="cashflow-notes"><summary>Cara membaca angka ini</summary>
        <ul>
          <li>Uang masuk belum tentu penghasilan baru; uang keluar belum tentu belanja.</li>
          <li>Transfer yang sudah dipasangkan antara dua dompet dalam cakupan ini dipisahkan dari arus utama; biaya tetap dihitung. Selisih tanggal debit dan kredit masuk pada dampak transfer antardompet.</li>
          {report && (report.internalInflow !== 0 || report.internalOutflow !== 0) && <li>Transfer antardompet: masuk {amount(report.internalInflow)}, keluar {amount(report.internalOutflow)}.</li>}
          <li>Penyesuaian saldo bukan transaksi bank.</li>
        </ul>
      </details>
      </div>
    </section>
    <section className="panel cashflow-breakdown-panel"><FoldHeader title="Rincian arus rekening" description="Jenis operasi mengikuti keterangan mutasi; tujuan belanjanya bisa tetap belum diketahui." summary={breakdownCount ? `${breakdownCount} jenis operasi · ketuk untuk melihat` : 'Belum ada arus · ketuk untuk melihat'} open={breakdownOpen} controls={breakdownId} onToggle={() => setFolds(f => ({ ...f, breakdown: !breakdownOpen }))} /><div className="cashflow-table-wrap fold-body" id={breakdownId} hidden={!breakdownOpen}><table className="cashflow-table" data-testid="cashflow-breakdown"><thead><tr><th>Jenis operasi</th><th>Uang masuk</th><th>Uang keluar</th></tr></thead><tbody>{report?.breakdown.map(row => <tr key={row.id}><th scope="row">{row.label}</th><td>{flow(row.inflow)}</td><td>{flow(row.outflow)}</td></tr>)}{!breakdownCount && <tr className="cashflow-empty"><td colSpan={3}>Belum ada arus pada periode ini.</td></tr>}</tbody>{breakdownCount > 0 && <tfoot><tr data-testid="cashflow-breakdown-total"><th scope="row">Jumlah</th><td>{amount(report?.inflow)}</td><td>{amount(report?.outflow)}</td></tr></tfoot>}</table></div></section>
    </>}
  </div>;
}
