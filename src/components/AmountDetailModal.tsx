import { useMemo } from 'react';
import { Pencil } from 'lucide-react';
import Modal from './Modal';
import SourceDetails from './SourceDetails';
import { formatDate, formatMoney, type Entry, type State } from '../lib/finance';
import type { StoredData } from '../lib/storage';
import { createBankEntryPresentationLookup } from '../lib/bankEntryHints';
import { entryReviewStatus } from '../lib/reviewStatus';
import { typeLabels } from '../lib/entryTypeLabels';

/** Read-only view of one entry: kind, dates, wallets, amounts, category and bank source. */
export default function AmountDetailModal({ entry, state, data, onClose, onEdit }: { entry: Entry; state: State; data: StoredData; onClose: () => void;
  /** Opens the edit form for this entry. Omitted for read-only history (old cash, archived wallets). */
  onEdit?: () => void }) {
  const source = state.wallets.find(wallet => wallet.id === entry.walletId)!;
  const destination = state.wallets.find(wallet => wallet.id === entry.toWalletId);
  const outgoing = entry.type === 'expense' || entry.type === 'transfer' || entry.amount < 0;
  const presentation = useMemo(() => createBankEntryPresentationLookup(data)(entry), [data, entry]);
  const hasSource = !!data.metadata?.links.some(link => link.entryId === entry.id && (link.source || link.destination));
  const review = entryReviewStatus(entry);
  return <Modal title="Rincian transaksi" subtitle="Baca saja. Membuka rincian tidak mengubah catatan atau saldo." onClose={onClose}>
    <div className="modal-body amount-detail"><h3>{presentation.title}</h3><dl>
      <dt>Jenis catatan</dt><dd>{typeLabels[entry.type]}</dd>{presentation.bank.kind !== 'none' && <><dt>Operasi pada mutasi</dt><dd data-bank-operation={presentation.bank.kind}>{presentation.bank.label}</dd></>}{presentation.merchant && <><dt>Merchant pada mutasi</dt><dd>{presentation.merchant}</dd></>}{review.pending && <><dt>Perlu dirapikan</dt><dd>{[review.type ? 'Jenis belum dikonfirmasi' : '', review.category ? 'Kategori belum diisi' : ''].filter(Boolean).join(' · ')}</dd></>}<dt>Tanggal catatan</dt><dd>{formatDate(entry.date)}</dd>
      <dt>{entry.type === 'transfer' ? 'Dompet asal' : 'Dompet'}</dt><dd>{source.name} · {source.currency}</dd>
      <dt>{outgoing ? 'Nominal keluar' : 'Nominal masuk'}</dt><dd>{formatMoney(Math.abs(entry.amount), source.currency)}</dd>
      {entry.type === 'transfer' && <><dt>Biaya tambahan</dt><dd>{formatMoney(entry.fee ?? 0, source.currency)}</dd><dt>Total debit dompet asal</dt><dd>{formatMoney(entry.amount + (entry.fee ?? 0), source.currency)}</dd>{destination && <><dt>Dompet tujuan</dt><dd>{destination.name} · {destination.currency}</dd><dt>Nominal diterima</dt><dd>{formatMoney(entry.toAmount ?? 0, destination.currency)}</dd></>}{entry.rate !== undefined && <><dt>Kurs transaksi tersimpan</dt><dd>1 {source.currency} = {new Intl.NumberFormat('id-ID', { maximumFractionDigits: 20 }).format(entry.rate)} {destination?.currency}</dd></>}</>}
      <dt>Kategori</dt><dd>{entry.category || '—'}</dd>{presentation.noteIsCustom && <><dt>Catatanmu</dt><dd>{entry.note || '—'}</dd></>}{!hasSource && <><dt>Keterangan lengkap</dt><dd>{presentation.description || '—'}</dd></>}
    </dl>{presentation.bank.kind !== 'none' && <p className="field-help">{presentation.bank.warning}</p>}<SourceDetails data={data} entry={entry} /></div><div className="modal-footer"><button className="button secondary" onClick={onClose}>Tutup rincian</button>{onEdit && <button className="button primary" onClick={onEdit}><Pencil size={16} /> Ubah</button>}</div>
  </Modal>;
}
