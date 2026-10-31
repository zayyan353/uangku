import { useContext, useMemo, useRef, useState } from 'react';
import { CheckCheck } from 'lucide-react';
import Modal from './Modal';
import { CategorySettingsContext } from '../hooks/useCategorySettings';
import { entryCategorySuggestions } from '../lib/categorySuggestions';
import { UNCATEGORIZED, isUncategorized } from '../lib/categorySettings';
import { formatDate, formatMoney } from '../lib/finance';
import type { SourceDocument } from '../lib/sourceModel';
import { createBankEntryPresentationLookup } from '../lib/bankEntryHints';

import type { BankCategoryAssignment } from '../lib/bankDecisions';
export type CategoryAssignment = BankCategoryAssignment;
export default function CategoryAutomation({ data, onApply, onClose, disabled = false }: {
  data: SourceDocument; onApply: (assignments: CategoryAssignment[]) => Promise<boolean>; onClose: () => void; disabled?: boolean;
}) {
  const settings = useContext(CategorySettingsContext);
  const [basis] = useState(() => ({ settings, rows: entryCategorySuggestions(data, settings) }));
  const rows = basis.rows;
  const presentation = useMemo(() => createBankEntryPresentationLookup(data), [data]);
  const [choices, setChoices] = useState(() => Object.fromEntries(rows.map(row => [row.entry.id,
    !isUncategorized(row.entry.category) ? row.entry.category : row.match.kind === 'auto' ? row.match.suggestions[0]?.category ?? '' : ''])));
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState('');
  const wallets = useMemo(() => new Map(data.state.wallets.map(wallet => [wallet.id, wallet])), [data.state.wallets]);
  const assignments = rows.flatMap(row => choices[row.entry.id] ? [{ entryId: row.entry.id, category: choices[row.entry.id], ...(row.confirmation ? { confirmBankType: true as const } : {}) }] : []);
  const auto = rows.filter(row => row.match.kind === 'auto').length;
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  async function apply() {
    if (saving.current || disabled || !assignments.length || settings !== basis.settings) return;
    saving.current = true; setBusy(true); setError('');
    try { if (!await onApply(assignments)) setError('Kategori belum tersimpan; pilihan tetap ada di sini. Tutup pratinjau untuk memeriksa status penyimpanan: unduh pekerjaan atau gunakan Coba simpan lagi. Jika ada konflik, buka data terbaru lalu buat ulang pratinjau.'); }
    catch (error) { setError(error instanceof Error ? error.message : 'Kategori belum tersimpan.'); }
    finally { saving.current = false; setBusy(false); }
  }
  return <Modal title="Isi kategori otomatis" subtitle="Tinjau kategori dan konfirmasi mutasi bank yang dikenali." onClose={() => { if (!saving.current) onClose(); }}>
    <div className="modal-body">
    <div className="notice success">{auto} cocok dengan aturan otomatis · {rows.length - auto} perlu pilihan. Catatan tanpa kecocokan tetap belum dikategorikan.</div>
    <p className="field-help">Semua periode dan mata uang. Kategori manual dipertahankan. Saat Terapkan, mutasi bank yang dikenali juga dikonfirmasi: tarik ATM menjadi pengeluaran, setor ATM menjadi pemasukan, dan transfer bank tetap perpindahan dana rekening; PREPAID masuk menjadi pemasukan Cashback; refund masalah ATM yang jelas menjadi Pengembalian dana. Pembayaran kartu tanpa kecocokan merchant memakai Belanja sebagai kategori umum, tanpa menebak barang yang dibeli. Nominal, saldo rekening, tanggal, dan fakta bank tetap. Mutasi lainnya tetap perlu dicek.</p>
    {settings !== basis.settings && <div className="notice warning">Pengaturan kategori berubah. Tutup lalu buka kembali pratinjau agar memakai aturan terbaru.</div>}
    {error && <div className="notice error" role="alert">{error}</div>}
    {!rows.length ? <div className="empty-state"><p>Belum ada aturan yang cocok. Tambahkan kata atau frasa merchant lewat Kelola kategori.</p></div> : <>
      <div className="category-automation-list">{rows.slice((page - 1) * 50, page * 50).map((row, index) => {
        const wallet = wallets.get(row.entry.walletId);
        const view = presentation(row.entry);
        return <section className="category-automation-row" key={row.entry.id}>
          <div><strong>{view.title}</strong>{view.description && view.title !== view.description && <details className="bank-wording"><summary>Keterangan bank asli</summary><p>{view.description}</p></details>}<span className="field-help">{formatDate(row.entry.date)} · {wallet?.name} · {wallet ? formatMoney(row.entry.amount, wallet.currency) : ''}</span>
            <span className="field-help">{row.match.kind === 'auto' ? 'Otomatis' : 'Saran — pilih sendiri'}: {row.match.suggestions.map(suggestion => `${suggestion.category} (${suggestion.reason})`).join(' · ')}</span>
            {row.bank.kind !== 'none' && <span className="field-help bank-operation-hint" data-bank-operation={row.bank.kind}>{row.bank.label}. {row.bank.warning}</span>}
            {row.confirmation ? <span className="field-help bank-type-confirmation">Saat diterapkan: {row.confirmation === 'movement' ? 'Perpindahan dana rekening; tidak termasuk belanja/pemasukan' : row.confirmation === 'income' ? row.bank.kind === 'atm-deposit' ? 'Pemasukan setor tunai' : row.bank.kind === 'atm-refund' ? 'Pemasukan pengembalian dana' : 'Pemasukan Cashback' : row.bank.kind === 'atm-withdrawal' ? 'Pengeluaran tarik tunai' : row.bank.kind === 'card-purchase' || row.bank.kind === 'online-purchase' ? 'Pengeluaran pembayaran kartu' : 'Pengeluaran biaya bank'}.</span> : row.entry.type === 'unreviewed' && <span className="field-help">Jenis transaksi belum dikonfirmasi.</span>}
          </div>
          <label className="field"><span className="field-label">Kategori pilihan</span><select className="select-input" aria-label={`Kategori otomatis ${(page - 1) * 50 + index + 1}`} disabled={busy || settings !== basis.settings} value={choices[row.entry.id]} onChange={event => setChoices(current => ({ ...current, [row.entry.id]: event.target.value }))}>
            <option value="">Lewati</option>{!isUncategorized(row.entry.category) ? <option value={row.entry.category}>{row.entry.category} (manual; dipertahankan)</option> : basis.settings.names.filter(name => name !== UNCATEGORIZED).map(name => <option key={name}>{name}</option>)}
          </select></label>
        </section>;
      })}</div>
      <nav className="history-pagination" aria-label="Halaman saran kategori"><span>Halaman {page} dari {pages} · {rows.length} kecocokan</span><div><button className="button secondary small" disabled={busy || page <= 1} onClick={() => setPage(value => value - 1)}>Sebelumnya</button><button className="button secondary small" disabled={busy || page >= pages} onClick={() => setPage(value => value + 1)}>Berikutnya</button></div></nav>
    </>}
    </div><div className="modal-footer"><button className="button secondary" disabled={busy} onClick={onClose}>Batal</button><button className="button primary" disabled={disabled || busy || !assignments.length || settings !== basis.settings} onClick={apply}><CheckCheck size={16} /> {busy ? 'Menyimpan…' : `Terapkan ${assignments.length} kategori`}</button></div>
  </Modal>;
}
