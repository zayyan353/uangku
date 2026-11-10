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

/** Panel header that folds its body; on phones the body starts folded. */
function FoldHeader({ title, description, summary, open, controls, onToggle }: { title: string; description: string; summary?: string; open: boolean; controls: string; onToggle: () => void }) {
  return <h2 className="fold-header"><button type="button" className="fold-toggle" aria-expanded={open} aria-controls={controls} data-cashflow-fold onClick={onToggle}><span className="fold-text"><span className="fold-title">{title}</span><span className="fold-desc">{open || !summary ? description : summary}</span></span><ChevronDown className="fold-chevron" size={18} aria-hidden="true" /></button></h2>;
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
      <span className="balance-label">Saldo akhir periode</span>
      {mobile && demo && <span className="balance-demo">Data contoh</span>}
      <span className="balance-currency">{currency === 'TRY' ? 'TL' : currency}</span>
    </div>
    <div className="balance-number"><span data-testid="cashflow-closing" data-amount={closing ?? undefined}>{closing == null ? mobile ? 'Belum tersedia' : '—' : formatMoney(closing, currency)}</span></div>
    <div className="balance-meta"><WalletIcon size={15} /><span>{scope}</span></div>
    {mobile && <p className="balance-period">{periodCaption(report, month, period)}</p>}
    <span className="balance-orbit orbit-one" /><span className="balance-orbit orbit-two" />
    <div className="balance-bottom"><span>Seluruh catatan: {report ? formatMoney(report.allRecordsBalance, currency) : '—'} · termasuk tanggal masa depan</span></div>
  </section>;
}

export default function CashflowOverview({ report, error, currency, month, period, walletId, wallets, archivedWalletIds, onPeriodChange, onWalletChange, balanceCard }: Props) {
  const warning = error || report?.balanceWarning || (report?.notStarted ? 'Periode belum dimulai. Transaksi bertanggal masa depan tidak masuk arus rekening aktual.' : '');
  const amount = (value: number | null | undefined, id?: string) => <span data-testid={id ? `cashflow-${id}` : undefined} data-amount={value ?? undefined}>{value === null || value === undefined ? '—' : formatMoney(value, currency)}</span>;
  const caption = periodCaption(report, month, period);
  const mobile = useMobileOverview();
  const [folds, setFolds] = useState<{ reconciliation?: boolean; breakdown?: boolean }>({});
  const reconciliationOpen = folds.reconciliation ?? !mobile, breakdownOpen = folds.breakdown ?? !mobile;
  const reconciliationId = useId(), breakdownId = useId();
  const matched = !!report?.isComplete && report.difference === 0;
  const breakdownCount = report?.breakdown.length ?? 0;
  return <div className="cashflow-overview">
    <div className="cashflow-controls">
      <label><span className="field-label">Cakupan arus rekening</span><select className="select-input" aria-label="Cakupan arus rekening" value={walletId} onChange={event => onWalletChange(event.target.value)}><option value="all">Semua rekening & e-wallet {currency}</option>{wallets.map(wallet => <option key={wallet.id} value={wallet.id}>{wallet.name}{archivedWalletIds?.has(wallet.id) ? ' (arsip)' : ''}</option>)}</select></label>
      <label><span className="field-label">Periode arus rekening</span><select className="select-input" aria-label="Periode arus rekening" value={period} onChange={event => onPeriodChange(event.target.value as 'month' | 'all')}><option value="month">{monthLabel(month)}</option><option value="all">Seluruh catatan</option></select></label>
      <p className="cashflow-period" data-testid="cashflow-period">{caption}</p>
    </div>
    {!!archivedWalletIds?.size && <p className="cashflow-explanation">Laporan tetap mencakup {archivedWalletIds.size} dompet arsip. Pengarsipan tidak menghapus saldo atau histori.</p>}
    {warning && <div className="notice warning" data-testid="cashflow-warning" role="status">{warning}</div>}
    <div className="overview-grid">
      {balanceCard}
      <div className="stats-stack"><section className="stat-card"><span className="stat-icon income"><ArrowDownLeft size={22} /></span><div><span className="stat-label">Uang masuk rekening</span><strong className="stat-value">{amount(report?.inflow, 'inflow')}</strong><span className="stat-foot">Termasuk transfer masuk dan catatan belum dikategorikan</span></div></section><section className="stat-card"><span className="stat-icon expense"><ArrowUpRight size={22} /></span><div><span className="stat-label">Uang keluar rekening</span><strong className="stat-value">{amount(report?.outflow, 'outflow')}</strong><span className="stat-foot">Termasuk transfer keluar, tarik tunai, dan biaya</span></div></section></div>
    </div>
    <section className="panel cashflow-reconciliation" data-testid="cashflow-reconciliation" data-complete={report?.isComplete ? 'true' : 'false'} aria-label="Perhitungan saldo periode">
      <FoldHeader title="Perhitungan saldo periode" description={period === 'all' ? 'Saldo awal catatan, bukan bukti kelengkapan seluruh histori bank.' : 'Saldo awal sebelum periode dipilih, hingga batas tanggal laporan.'} summary={matched ? 'Cocok · ketuk untuk melihat hitungan' : 'Belum dapat dipastikan · ketuk untuk detail'} open={reconciliationOpen} controls={reconciliationId} onToggle={() => setFolds(f => ({ ...f, reconciliation: !reconciliationOpen }))} />
      <div className="fold-body" id={reconciliationId} hidden={!reconciliationOpen}>
      <dl className="cashflow-equation"><div><dt>Saldo awal{period === 'all' ? ' catatan' : ' periode'}</dt><dd>{amount(report?.openingBalance, 'opening')}</dd></div><div><dt>+ Uang masuk</dt><dd>{amount(report?.inflow)}</dd></div><div><dt>− Uang keluar</dt><dd>{amount(report?.outflow)}</dd></div><div><dt>± Transfer antardompet</dt><dd>{amount(report?.internalNet, 'internal-net')}</dd></div><div><dt>± Penyesuaian saldo</dt><dd>{amount(report?.adjustment, 'adjustment')}</dd></div><div><dt>= Saldo akhir</dt><dd>{amount(report?.closingBalance)}</dd></div></dl>
      <p className="cashflow-explanation">{matched ? 'Perhitungan saldo periode cocok. Ini mencocokkan catatan aplikasi, belum membuktikan mutasi bank sudah lengkap.' : 'Saldo periode belum dapat dipastikan. Angka arus hanya mencakup posting dengan tanggal yang diketahui.'}</p>
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
    <section className="panel cashflow-breakdown-panel"><FoldHeader title="Rincian arus rekening" description="Jenis operasi mengikuti keterangan mutasi; tujuan belanjanya bisa tetap belum diketahui." summary={breakdownCount ? `${breakdownCount} jenis operasi · ketuk untuk melihat` : 'Belum ada arus · ketuk untuk melihat'} open={breakdownOpen} controls={breakdownId} onToggle={() => setFolds(f => ({ ...f, breakdown: !breakdownOpen }))} /><div className="cashflow-table-wrap fold-body" id={breakdownId} hidden={!breakdownOpen}><table className="cashflow-table" data-testid="cashflow-breakdown"><thead><tr><th>Jenis operasi</th><th>Uang masuk</th><th>Uang keluar</th></tr></thead><tbody>{report?.breakdown.map(row => <tr key={row.id}><th scope="row">{row.label}</th><td>{amount(row.inflow)}</td><td>{amount(row.outflow)}</td></tr>)}{!breakdownCount && <tr className="cashflow-empty"><td colSpan={3}>Belum ada arus pada periode ini.</td></tr>}</tbody></table></div></section>
  </div>;
}
