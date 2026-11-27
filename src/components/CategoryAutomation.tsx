import { useContext, useMemo, useRef, useState } from 'react';
import { FailureText } from './FailureText';
import { CheckCheck } from 'lucide-react';
import Modal from './Modal';
import HistoryRuleDialog, { type HistoryRuleSource } from './HistoryRuleDialog';
import { CategorySettingsContext } from '../hooks/useCategorySettings';
import { entryCategorySuggestions } from '../lib/categorySuggestions';
import { UNCATEGORIZED, isUncategorized, type CategorySettings } from '../lib/categorySettings';
import { formatDate, formatMoney } from '../lib/finance';
import type { SourceDocument } from '../lib/sourceModel';
import { createBankEntryPresentationLookup } from '../lib/bankEntryHints';

import type { BankCategoryAssignment } from '../lib/bankDecisions';
export type CategoryAssignment = BankCategoryAssignment;
export default function CategoryAutomation({ data, settingsRaw, settingsError, onSaveSettings, onApply, onClose, disabled = false }: {
  settingsRaw: string | null; settingsError: string;
  onSaveSettings: (settings: CategorySettings, expectedRaw: string | null) => Promise<{ raw: string; settings: CategorySettings }>;
  data: SourceDocument; onApply: (assignments: CategoryAssignment[]) => Promise<boolean>; onClose: () => void; disabled?: boolean;
}) {
  const settings = useContext(CategorySettingsContext);
  const [basis, setBasis] = useState(() => ({ settings, raw: settingsRaw, error: settingsError }));
  const stale = settingsRaw !== basis.raw || settingsError !== basis.error;
  const changed = stale ? 'Pengaturan kategori berubah. Tutup lalu buka kembali pratinjau agar memakai aturan terbaru.' : '';
  const ruleBlocked = changed || (settingsError ? 'Pengaturan kategori belum dapat digunakan untuk menyimpan aturan baru.' : '');
  const rows = useMemo(() => entryCategorySuggestions(data, basis.settings), [data, basis.settings]);
  const [ruleSource, setRuleSource] = useState<HistoryRuleSource | null>(null);
  const [ruleNotice, setRuleNotice] = useState('');
  const ruleReturnFocus = useRef<HTMLSelectElement | null>(null);
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
    if (saving.current || disabled || !assignments.length || stale) return;
    saving.current = true; setBusy(true); setError('');
    try { if (!await onApply(assignments)) setError('Kategori belum tersimpan; pilihan tetap ada di sini. Periksa pemberitahuan penyimpanan. Bila ada konflik, unduh pekerjaan sebelum memuat catatan terbaru lalu buat ulang pratinjau.'); }
    catch (error) { setError(error instanceof Error ? error.message : 'Kategori belum tersimpan.'); }
    finally { saving.current = false; setBusy(false); }
  }
  return <><Modal title="Isi kategori otomatis" subtitle="Tinjau kategori dan konfirmasi mutasi bank yang dikenali dari semua periode." onClose={() => { if (!saving.current) onClose(); }}>
    <div className="modal-body">
    {rows.length > 0 && <><div className="notice success">{auto} cocok dengan aturan otomatis · {rows.length - auto} perlu pilihan. Catatan tanpa kecocokan tetap belum dikategorikan.</div>
    <details className="automation-rules"><summary>Apa yang terjadi saat Terapkan?</summary><p className="field-help">Semua periode dan mata uang. Kategori manual dipertahankan. Saat Terapkan, mutasi bank yang dikenali juga dikonfirmasi: tarik ATM menjadi pengeluaran, setor ATM menjadi pemasukan, dan transfer bank tetap perpindahan dana; PREPAID masuk menjadi pemasukan Cashback; refund masalah ATM yang jelas menjadi Pengembalian dana. Pembayaran kartu tanpa kecocokan merchant memakai Belanja sebagai kategori umum, tanpa menebak barang yang dibeli. Nominal, saldo rekening, tanggal, dan data bank tetap. Mutasi lainnya tetap perlu dicek.</p></details></>}
    {ruleBlocked && <div className="notice warning">{ruleBlocked}</div>}
    {ruleNotice && <div className="notice success" role="status">{ruleNotice}</div>}
    {error && <div className="notice error" role="alert"><FailureText text={error} /></div>}
    {!rows.length ? <div className="empty-state compact" data-testid="automation-empty"><CheckCheck size={26} /><p>Belum ada kategori yang disarankan oleh aturan atau riwayat transaksi. Tambahkan kata atau frasa merchant lewat Kelola kategori bila ada yang ingin diisi otomatis.</p></div> : <>
      <div className="category-automation-list">{rows.slice((page - 1) * 50, page * 50).map((row, index) => {
        const wallet = wallets.get(row.entry.walletId);
        const view = presentation(row.entry);
        const merchant = row.historyMerchant;
        return <section className="category-automation-row" key={row.entry.id}>
          <div><strong>{view.title}</strong>{view.description && view.title !== view.description && <details className="bank-wording"><summary>Keterangan bank asli</summary><p>{view.description}</p></details>}<span className="field-help">{formatDate(row.entry.date)} · {wallet?.name} · {wallet ? formatMoney(row.entry.amount, wallet.currency) : ''}</span>
            <span className="field-help">{row.historyMerchant
              ? <>Saran dari riwayat: {row.match.suggestions[0].reason}</>
              : <>{row.match.kind === 'auto' ? 'Otomatis' : 'Saran — pilih sendiri'}: {row.match.suggestions.map(suggestion => `${suggestion.category} (${suggestion.reason})`).join(' · ')}</>}</span>
            {merchant && <button type="button" className="button secondary small" disabled={busy || disabled || !!ruleBlocked} onClick={event => {
              ruleReturnFocus.current = event.currentTarget.closest('section')?.querySelector('select') ?? null;
              setRuleNotice('');
              setRuleSource({ merchant, description: view.description, category: row.match.suggestions[0].category });
            }}>Jadikan aturan</button>}
            {row.bank.kind !== 'none' && <span className="field-help bank-operation-hint" data-bank-operation={row.bank.kind}>{row.bank.label}. {row.bank.warning}</span>}
            {row.confirmation ? <span className="field-help bank-type-confirmation">Saat diterapkan: {row.confirmation === 'movement' ? 'Perpindahan dana; tidak termasuk belanja/pemasukan' : row.confirmation === 'income' ? row.bank.kind === 'atm-deposit' ? 'Pemasukan setor tunai' : row.bank.kind === 'atm-refund' || row.bank.kind === 'card-refund' ? 'Pemasukan pengembalian dana' : 'Pemasukan Cashback' : row.bank.kind === 'atm-withdrawal' ? 'Pengeluaran tarik tunai' : row.bank.kind === 'card-purchase' || row.bank.kind === 'online-purchase' ? 'Pengeluaran pembayaran kartu' : 'Pengeluaran biaya bank'}.</span> : row.entry.type === 'unreviewed' && <span className="field-help">Jenis transaksi belum dikonfirmasi.</span>}
          </div>
          <label className="field"><span className="field-label">Kategori pilihan</span><select className="select-input" aria-label={`Kategori otomatis ${(page - 1) * 50 + index + 1}`} disabled={busy || stale} value={choices[row.entry.id] ?? ''} onChange={event => setChoices(current => ({ ...current, [row.entry.id]: event.target.value }))}>
            <option value="">Lewati</option>{!isUncategorized(row.entry.category) ? <option value={row.entry.category}>{row.entry.category} (manual; dipertahankan)</option> : basis.settings.names.filter(name => name !== UNCATEGORIZED).map(name => <option key={name}>{name}</option>)}
          </select></label>
        </section>;
      })}</div>
      <nav className="history-pagination" aria-label="Halaman saran kategori"><span>{pages > 1 ? `Halaman ${page} dari ${pages} · ` : ''}{rows.length} kecocokan{pages > 1 ? ' · Terapkan berlaku untuk semua halaman' : ''}</span>{pages > 1 && <div><button className="button secondary small" disabled={busy || page <= 1} onClick={() => setPage(value => value - 1)}>Sebelumnya</button><button className="button secondary small" disabled={busy || page >= pages} onClick={() => setPage(value => value + 1)}>Berikutnya</button></div>}</nav>
    </>}
    </div><div className="modal-footer"><button className="button secondary" disabled={busy} onClick={onClose}>{rows.length ? 'Batal' : 'Tutup'}</button>{rows.length > 0 && <button className="button primary" disabled={disabled || busy || !assignments.length || stale} onClick={apply}><CheckCheck size={16} /> {busy ? 'Menyimpan…' : `Terapkan ${assignments.length} kategori`}</button>}</div>
  </Modal>
  {ruleSource && <HistoryRuleDialog source={ruleSource} settings={basis.settings}
    blocked={ruleBlocked || (disabled ? 'Penyimpanan belum tersedia.' : '')}
    onClose={() => setRuleSource(null)} onSave={async rule => {
      const saved = await onSaveSettings({ ...basis.settings, rules: [...basis.settings.rules, rule] }, basis.raw);
      setBasis({ ...saved, error: '' });
      setRuleSource(null);
      setRuleNotice('Aturan saran tersimpan.');
      requestAnimationFrame(() => ruleReturnFocus.current?.focus());
    }} />}
  </>;
}
