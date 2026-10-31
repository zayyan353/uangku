import { ArrowDownLeft, ArrowUpRight, Wallet as WalletIcon } from 'lucide-react';
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
}

export default function CashflowOverview({ report, error, currency, month, period, walletId, wallets, archivedWalletIds, onPeriodChange, onWalletChange }: Props) {
  const scope = walletId === 'all' ? `Semua rekening & e-wallet ${currency}` : wallets.find(wallet => wallet.id === walletId)?.name ?? 'Rekening';
  const warning = error || report?.balanceWarning || (report?.notStarted ? 'Periode belum dimulai. Transaksi bertanggal masa depan tidak masuk arus rekening aktual.' : '');
  const amount = (value: number | null | undefined, id?: string) => <span data-testid={id ? `cashflow-${id}` : undefined} data-amount={value ?? undefined}>{value === null || value === undefined ? '—' : formatMoney(value, currency)}</span>;
  const caption = report?.notStarted ? `${monthLabel(month)} · periode belum dimulai` : report ? period === 'all' ? `Seluruh catatan hingga ${formatDate(report.periodEnd)}` : `${formatDate(report.periodStart!)} – ${formatDate(report.periodEnd)}` : 'Laporan belum dapat dihitung';
  return <div className="cashflow-overview">
    <div className="cashflow-controls">
      <label><span className="field-label">Cakupan arus rekening</span><select className="select-input" aria-label="Cakupan arus rekening" value={walletId} onChange={event => onWalletChange(event.target.value)}><option value="all">Semua rekening & e-wallet {currency}</option>{wallets.map(wallet => <option key={wallet.id} value={wallet.id}>{wallet.name}{archivedWalletIds?.has(wallet.id) ? ' (arsip)' : ''}</option>)}</select></label>
      <label><span className="field-label">Periode arus rekening</span><select className="select-input" aria-label="Periode arus rekening" value={period} onChange={event => onPeriodChange(event.target.value as 'month' | 'all')}><option value="month">{monthLabel(month)}</option><option value="all">Seluruh catatan</option></select></label>
      <p className="cashflow-period" data-testid="cashflow-period">{caption}</p>
    </div>
    {!!archivedWalletIds?.size && <p className="cashflow-explanation">Laporan tetap mencakup {archivedWalletIds.size} dompet arsip. Pengarsipan tidak menghapus saldo atau histori.</p>}
    {warning && <div className="notice warning" data-testid="cashflow-warning" role="status">{warning}</div>}
    <div className="overview-grid">
      <section className="balance-card"><div className="balance-card-top"><span className="balance-label">Saldo akhir periode</span><span className="balance-currency">{currency === 'TRY' ? 'TL' : currency}</span></div><div className="balance-number">{amount(report?.closingBalance, 'closing')}</div><div className="balance-meta"><WalletIcon size={15} /><span>{scope}</span></div><span className="balance-orbit orbit-one" /><span className="balance-orbit orbit-two" /><div className="balance-bottom"><span>Seluruh catatan: {amount(report?.allRecordsBalance)} · termasuk tanggal masa depan</span></div></section>
      <div className="stats-stack"><section className="stat-card"><span className="stat-icon income"><ArrowDownLeft size={22} /></span><div><span className="stat-label">Uang masuk rekening</span><strong className="stat-value">{amount(report?.inflow, 'inflow')}</strong><span className="stat-foot">Termasuk transfer masuk dan catatan belum dikategorikan</span></div></section><section className="stat-card"><span className="stat-icon expense"><ArrowUpRight size={22} /></span><div><span className="stat-label">Uang keluar rekening</span><strong className="stat-value">{amount(report?.outflow, 'outflow')}</strong><span className="stat-foot">Termasuk transfer keluar, tarik tunai, dan biaya</span></div></section></div>
    </div>
    <section className="panel cashflow-reconciliation" data-testid="cashflow-reconciliation" data-complete={report?.isComplete ? 'true' : 'false'} aria-label="Perhitungan saldo periode">
      <div className="panel-header"><div><h2>Perhitungan saldo periode</h2><p>{period === 'all' ? 'Saldo awal catatan, bukan bukti kelengkapan seluruh histori bank.' : 'Saldo awal sebelum periode dipilih, hingga batas tanggal laporan.'}</p></div></div>
      <dl className="cashflow-equation"><div><dt>Saldo awal{period === 'all' ? ' catatan' : ' periode'}</dt><dd>{amount(report?.openingBalance, 'opening')}</dd></div><div><dt>+ Uang masuk</dt><dd>{amount(report?.inflow)}</dd></div><div><dt>− Uang keluar</dt><dd>{amount(report?.outflow)}</dd></div><div><dt>± Transfer antardompet</dt><dd>{amount(report?.internalNet, 'internal-net')}</dd></div><div><dt>± Penyesuaian saldo</dt><dd>{amount(report?.adjustment, 'adjustment')}</dd></div><div><dt>= Saldo akhir</dt><dd>{amount(report?.closingBalance)}</dd></div></dl>
      <p className="cashflow-explanation">{report?.isComplete && report.difference === 0 ? 'Perhitungan saldo periode cocok. Ini mencocokkan catatan aplikasi, belum membuktikan mutasi bank sudah lengkap.' : 'Saldo periode belum dapat dipastikan. Angka arus hanya mencakup posting dengan tanggal yang diketahui.'}</p>
      <p className="cashflow-explanation">Uang masuk belum tentu penghasilan baru; uang keluar belum tentu belanja. Transfer yang sudah dipasangkan antara dua dompet dalam cakupan ini dipisahkan dari arus utama; biaya tetap dihitung. Selisih tanggal debit dan kredit masuk pada dampak transfer antardompet.</p>
      {report && (report.internalInflow !== 0 || report.internalOutflow !== 0) && <p className="cashflow-explanation">Transfer antardompet: masuk {amount(report.internalInflow)}, keluar {amount(report.internalOutflow)}. Penyesuaian saldo bukan transaksi bank.</p>}
    </section>
    <section className="panel cashflow-breakdown-panel"><div className="panel-header"><div><h2>Rincian arus rekening</h2><p>Jenis operasi mengikuti keterangan mutasi; tujuan belanjanya bisa tetap belum diketahui.</p></div></div><div className="cashflow-table-wrap"><table className="cashflow-table" data-testid="cashflow-breakdown"><thead><tr><th>Jenis operasi</th><th>Uang masuk</th><th>Uang keluar</th></tr></thead><tbody>{report?.breakdown.map(row => <tr key={row.id}><th scope="row">{row.label}</th><td>{amount(row.inflow)}</td><td>{amount(row.outflow)}</td></tr>)}</tbody></table></div></section>
  </div>;
}
