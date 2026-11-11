import { useMemo, type ReactNode } from 'react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, Bike, Bus, Clapperboard, Coffee, Gift, GraduationCap, HeartPulse, History, House, Landmark, Pencil, Plane, ReceiptText, Repeat, Shirt, ShoppingBag, ShoppingBasket, SlidersHorizontal, Wifi, type LucideIcon } from 'lucide-react';
import { formatDate, formatMoney, type Entry, type State } from '../lib/finance';
import type { StoredData } from '../lib/storage';
import { canCategorize } from '../lib/review';
import { transferPostingDates } from '../lib/transferPostings';
import { archivedReadOnlyEntryIds } from '../lib/walletLifecycle';
import { isCashLinkedEntry } from '../lib/cashScope';
import { createBankEntryPresentationLookup } from '../lib/bankEntryHints';
import { entryReviewStatus } from '../lib/reviewStatus';
import { typeLabels } from '../lib/entryTypeLabels';

/** Icons for the built-in expense categories; a renamed or personal category keeps the plain arrow. */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  'Makan & minum': Coffee, 'Bahan makanan': ShoppingBasket, 'Belanja': ShoppingBag, 'Belanja online': ShoppingBag,
  'Transportasi': Bus, 'Scooter': Bike, 'Perjalanan': Plane, 'Tagihan': ReceiptText, 'Internet & pulsa': Wifi,
  'Langganan': Repeat, 'Kesehatan': HeartPulse, 'Pendidikan': GraduationCap, 'Hiburan': Clapperboard,
  'Rumah & sewa': House, 'Kebutuhan rumah': House, 'Pakaian': Shirt, 'Hadiah & donasi': Gift,
  'Biaya bank': Landmark, 'Tarik tunai': Banknote,
};

/** Transaction rows for the overview and history pages. */
export default function TransactionTable({ entries, state, data, onEdit, onDetail, selection, empty, groupByDate = false, quickCategory }: {
  entries: Entry[]; state: State; data: StoredData; onEdit: (entry: Entry) => void; onDetail: (entry: Entry) => void;
  selection?: { ids: Set<string>; toggle: (id: string) => void; toggleAll: () => void };
  /** Shown in place of the table when there are no rows; the caller knows whether filters hid them. */
  empty?: ReactNode;
  /** Phones: a date label above the first row of each day. Only for lists ordered by date. */
  groupByDate?: boolean;
  /** Review queue: rows still without a category get a category picker of their own. */
  quickCategory?: { names: readonly string[]; apply: (entry: Entry, category: string) => void };
}) {
  const readOnlyEntryIds = useMemo(() => archivedReadOnlyEntryIds(data), [data]);
  const bankPresentation = useMemo(() => createBankEntryPresentationLookup(data), [data.metadata]);
  if (!entries.length) return empty ?? <div className="empty-state"><History size={30} /><h3>Belum ada transaksi di sini</h3><p>Mulai dari satu catatan kecil, atau impor mutasi rekeningmu.</p></div>;
  const eligible = entries.filter(entry => canCategorize(entry) && !isCashLinkedEntry(state, entry) && !readOnlyEntryIds.has(entry.id));
  const selectedCount = eligible.filter(e => selection?.ids.has(e.id)).length;
  // Kode mata uang di kolom Dompet hanya berguna bila tabel mencampur beberapa mata uang (mis. antrean rapikan).
  const mixedCurrencies = new Set(entries.map(entry => state.wallets.find(w => w.id === entry.walletId)?.currency)).size > 1;
  return <div className="table-wrap"><table className="transactions-table"><thead><tr>
    <th>{selection && <label className="selection-hit"><input className="selection-checkbox" type="checkbox" aria-label="Pilih semua transaksi yang terlihat" disabled={!eligible.length} checked={eligible.length > 0 && selectedCount === eligible.length} ref={input => { if (input) input.indeterminate = selectedCount > 0 && selectedCount < eligible.length; }} onChange={selection.toggleAll} /></label>}Transaksi</th><th>Dompet</th><th>Tanggal</th><th>Nominal</th><th><span className="screen-reader-only">Aksi</span></th>
  </tr></thead><tbody>{entries.map((entry, position) => {
    const wallet = state.wallets.find(w => w.id === entry.walletId)!;
    const destination = state.wallets.find(w => w.id === entry.toWalletId);
    const positive = entry.type === 'income' || ((entry.type === 'adjustment' || entry.type === 'unreviewed' || entry.type === 'movement') && entry.amount > 0);
    const dates = entry.type === 'transfer' ? transferPostingDates(entry, data.metadata) : null;
    const presentation = bankPresentation(entry);
    const bank = presentation.bank;
    const review = entryReviewStatus(entry);
    const archived = isCashLinkedEntry(state, entry) || readOnlyEntryIds.has(entry.id);
    const Icon = entry.type === 'transfer' ? ArrowLeftRight : entry.type === 'adjustment' ? SlidersHorizontal : positive ? ArrowDownLeft : CATEGORY_ICONS[entry.category] ?? ArrowUpRight;
    const sameDay = !!dates?.source && dates.source === dates.destination;
    const legacyNote = dates?.basis === 'legacy-assumed' && !data.demo && <small className="field-help">Satu tanggal untuk kedua sisi; tanggal bank tiap sisi belum dipastikan</small>;
    const received = entry.type === 'transfer' && destination && (destination.currency !== wallet.currency || (entry.toAmount ?? 0) !== Math.abs(entry.amount));
    const dateLabel = groupByDate && entry.date !== entries[position - 1]?.date ? formatDate(entry.date) : null;
    return <tr key={entry.id}>
      <td>{dateLabel && <div className="date-group-label">{dateLabel}</div>}<div className={`transaction-cell ${selection ? 'selectable' : ''}`}>
        {selection && <label className="selection-hit"><input className="selection-checkbox" type="checkbox" aria-label={`Pilih ${entry.note || typeLabels[entry.type]} untuk kategori`} title={canCategorize(entry) ? 'Pilih untuk kategori massal' : 'Transfer dan penyesuaian tidak memakai kategori belanja'} disabled={!canCategorize(entry) || archived} checked={canCategorize(entry) && !archived && selection.ids.has(entry.id)} onChange={() => selection.toggle(entry.id)} /></label>}
        <span className={`transaction-icon ${entry.type}`}><Icon size={18} /></span><div><button type="button" className="transaction-title transaction-open" title="Lihat rincian" onClick={() => onDetail(entry)}>{presentation.title}</button><span className="transaction-note">{entry.type === 'transfer' ? `${wallet.name} → ${destination?.name}` : entry.type === 'unreviewed' ? `${entry.category && entry.category !== 'Belum dikategorikan' ? entry.category + ' · ' : ''}Jenis belum dikonfirmasi` : entry.category || typeLabels[entry.type]}</span>{review.category && !review.type && <span className="field-help review-reason">Kategori belum diisi; jenis pengeluaran/pemasukan sudah diketahui.</span>}{bank.kind !== "none" && <span className="field-help bank-operation-hint" data-bank-operation={bank.kind}>{bank.label}{bank.kind === 'card-purchase' && (review.category || entry.category === 'Belanja') ? ' · tujuan belanja belum spesifik' : ''}</span>}{presentation.description && presentation.title !== presentation.description && <details className="bank-wording"><summary>Keterangan bank asli</summary><p>{presentation.description}</p></details>}{quickCategory && review.category && !archived && canCategorize(entry) && <select className="select-input quick-category" aria-label={`Kategori untuk ${entry.note || typeLabels[entry.type]}`} value="" onChange={event => { if (event.target.value) quickCategory.apply(entry, event.target.value); }}><option value="" disabled>Pilih kategori…</option>{quickCategory.names.filter(name => name !== 'Belum dikategorikan').map(name => <option key={name}>{name}</option>)}</select>}<span className="transaction-mobile-meta">{wallet.name} · {formatDate(entry.date)}</span></div>
      </div></td>
      <td><span className="wallet-table-name">{wallet.name}</span>{mixedCurrencies && <span className="transaction-note">{wallet.currency}</span>}</td><td className="date-cell">{dates ? sameDay ? <>{formatDate(dates.source!)}{legacyNote}</> : <><span>Debit: {dates.source ? formatDate(dates.source) : 'Belum diketahui'}</span><span className="transaction-note">Kredit: {dates.destination ? formatDate(dates.destination) : 'Belum diketahui'}</span>{legacyNote}</> : formatDate(entry.date)}</td>
      <td className="amount-cell"><button type="button" className="amount-detail-button" aria-label={`Rincian transaksi ${entry.note || typeLabels[entry.type]}`} onClick={() => onDetail(entry)}><strong className={entry.type === 'transfer' ? '' : positive ? 'amount-positive' : 'amount-negative'}>{entry.type === 'transfer' ? '' : positive ? '+' : '−'}{formatMoney(Math.abs(entry.amount), wallet.currency)}</strong>{received && <span className="transaction-note">→ {formatMoney(entry.toAmount ?? 0, destination.currency)}</span>}{entry.fee ? <span className="transaction-note">Biaya {formatMoney(entry.fee, wallet.currency)}</span> : null}<span className="amount-detail-hint">Rincian transaksi</span></button>{entry.type === 'unreviewed' && <span className="badge unreviewed">Perlu dicek</span>}</td>
      <td>{archived ? <span className="field-help">Arsip · baca saja</span> : <div className="row-actions"><button className={entry.type === 'unreviewed' ? 'button secondary small' : 'icon-button'} aria-label={`${entry.type === 'unreviewed' ? 'Cek' : 'Ubah'} ${entry.note || 'transaksi'}`} onClick={() => onEdit(entry)}>{entry.type === 'unreviewed' ? 'Cek' : <Pencil size={16} />}</button></div>}</td>
    </tr>;
  })}</tbody></table></div>;
}
