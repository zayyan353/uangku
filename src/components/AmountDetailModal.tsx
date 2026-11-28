import { useMemo } from 'react';
import { Pencil } from 'lucide-react';
import Modal from './Modal';
import SourceDetails from './SourceDetails';
import { PrivateAmount, PrivateValue, usePrivacyAmounts } from './PrivacyAmounts';
import { formatDate, type Entry, type State } from '../lib/finance';
import type { StoredData } from '../lib/storage';
import { createBankEntryPresentationLookup } from '../lib/bankEntryHints';
import { entryReviewStatus } from '../lib/reviewStatus';
import { typeLabels } from '../lib/entryTypeLabels';

/** Read-only view of one entry: kind, dates, wallets, amounts, category and bank source. */
export default function AmountDetailModal({ entry, state, data, onClose, onEdit }: { entry: Entry; state: State; data: StoredData; onClose: () => void;
  /** Opens the edit form for this entry. Omitted for read-only history (old cash, archived wallets). */
  onEdit?: () => void }) {
  const { hidden } = usePrivacyAmounts();
  const source = state.wallets.find(wallet => wallet.id === entry.walletId)!;
  const destination = state.wallets.find(wallet => wallet.id === entry.toWalletId);
  const outgoing = entry.type === 'expense' || entry.type === 'transfer' || entry.amount < 0;
  const presentation = useMemo(() => createBankEntryPresentationLookup(data)(entry), [data, entry]);
  const hasSource = !!data.metadata?.links.some(link => link.entryId === entry.id && (link.source || link.destination));
  const review = entryReviewStatus(entry);
  return <Modal title="Rincian transaksi" subtitle="Baca saja. Membuka rincian tidak mengubah catatan atau saldo." onClose={onClose}>
    <div className="modal-body amount-detail"><h3>{hidden ? typeLabels[entry.type] : presentation.title}</h3><dl>
      <dt>Jenis catatan</dt><dd>{typeLabels[entry.type]}</dd>{presentation.bank.kind !== 'none' && <><dt>Operasi pada mutasi</dt><dd data-bank-operation={presentation.bank.kind}>{presentation.bank.label}</dd></>}{presentation.merchant && <><dt>Merchant pada mutasi</dt><dd>{hidden ? 'Disamarkan' : presentation.merchant}</dd></>}{review.pending && <><dt>Perlu dirapikan</dt><dd>{[review.type ? 'Jenis belum dikonfirmasi' : '', review.category ? 'Kategori belum diisi' : ''].filter(Boolean).join(' · ')}</dd></>}<dt>Tanggal catatan</dt><dd>{formatDate(entry.date)}</dd>
      <dt>{entry.type === 'transfer' ? 'Dompet asal' : 'Dompet'}</dt><dd>{source.name} · {source.currency}</dd>
      <dt>{outgoing ? 'Nominal keluar' : 'Nominal masuk'}</dt><dd><PrivateAmount value={Math.abs(entry.amount)} currency={source.currency} /></dd>
      {entry.type === 'transfer' && <><dt>Biaya tambahan</dt><dd><PrivateAmount value={entry.fee ?? 0} currency={source.currency} /></dd><dt>Total debit dompet asal</dt><dd><PrivateAmount value={entry.amount + (entry.fee ?? 0)} currency={source.currency} /></dd>{destination && <><dt>Dompet tujuan</dt><dd>{destination.name} · {destination.currency}</dd><dt>Nominal diterima</dt><dd><PrivateAmount value={entry.toAmount ?? 0} currency={destination.currency} /></dd></>}{entry.rate !== undefined && <><dt>Kurs transaksi tersimpan</dt><dd>1 {source.currency} = <PrivateValue text={`${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 20 }).format(entry.rate)} ${destination?.currency ?? ''}`.trim()} currency={destination?.currency ?? source.currency} /></dd></>}</>}
      <dt>Kategori</dt><dd>{entry.category || '—'}</dd>{presentation.noteIsCustom && <><dt>Catatanmu</dt><dd>{hidden ? 'Disamarkan' : entry.note || '—'}</dd></>}{!hasSource && <><dt>Keterangan lengkap</dt><dd>{hidden ? 'Disamarkan' : presentation.description || '—'}</dd></>}
    </dl>{presentation.bank.kind !== 'none' && <p className="field-help">{presentation.bank.warning}</p>}<SourceDetails data={data} entry={entry} /></div><div className="modal-footer"><button className="button secondary" onClick={onClose}>Tutup rincian</button>{onEdit && <button className="button primary" onClick={onEdit}><Pencil size={16} /> Ubah</button>}</div>
  </Modal>;
}
