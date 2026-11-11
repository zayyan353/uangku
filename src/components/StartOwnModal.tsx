import { useMemo, useState } from 'react';
import Modal from './Modal';
import { formatDate, formatMoney } from '../lib/finance';
import { reviewDemo } from '../lib/demoTransition';
import { createEmptyState, type StoredData } from '../lib/storage';

interface Props {
  data: StoredData;
  persisted: boolean;
  busy: boolean;
  onClose: () => void;
  onCarry: (included: ReadonlySet<string>) => void;
  /** Starts an empty ledger with the chosen starting wallets (ids from the built-in list). */
  onEmpty: (walletIds: readonly string[]) => void;
}

export default function StartOwnModal({ data, persisted, busy, onClose, onCarry, onEmpty }: Props) {
  const { samples, additional } = useMemo(() => reviewDemo(data), [data]);
  const [included, setIncluded] = useState(() => new Set(samples.filter(row => row.selected).map(row => row.entry.id)));
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // The built-in starting wallets; all are kept unless the user unticks the ones they do not use.
  const starters = useMemo(() => createEmptyState().wallets, []);
  const [walletIds, setWalletIds] = useState(() => starters.map(wallet => wallet.id));
  const startEmpty = () => onEmpty(starters.filter(wallet => walletIds.includes(wallet.id)).map(wallet => wallet.id));
  const count = additional + included.size;
  const savingStatus = busy && <span className="field-help" role="status">Sedang menyimpan…</span>;
  function toggle(id: string, checked: boolean) {
    const next = new Set(included);
    if (checked) next.add(id); else next.delete(id);
    setIncluded(next);
  }
  if (confirmDiscard) return <Modal key="discard" title="Hapus catatan demo dan mulai dari kosong?" onClose={onClose}>
    <div className="modal-body"><p className="confirm-copy">Seluruh {data.state.entries.length} transaksi di mode contoh akan dihapus, termasuk yang kamu catat sendiri. Rekening juga akan diganti dengan dompet kosong. Untuk menyimpan salinan lebih dulu, batalkan lalu pilih Cadangkan semuanya.</p></div>
    <div className="modal-footer demo-transition-actions">{savingStatus}<button className="button secondary" data-autofocus disabled={busy} onClick={() => setConfirmDiscard(false)}>Kembali</button><button className="button danger" disabled={busy || !walletIds.length} onClick={startEmpty}>Hapus dan mulai dari kosong</button></div>
  </Modal>;
  return <Modal key="review" title="Mulai dengan uangmu sendiri?" onClose={onClose}>
    <div className="modal-body">
      {count === 0 ? <p className="confirm-copy" data-testid="start-own-nothing"><strong>Belum ada transaksi buatanmu di mode contoh,</strong> jadi tidak ada yang perlu dibawa. Catatan pribadimu dimulai dari dompet kosong; transaksi contoh tidak ikut.</p>
        : <p className="confirm-copy"><strong>{count} transaksi akan dibawa.</strong> {additional > 0 ? `Semua ${additional} transaksi yang kamu tambahkan ikut bersama rekeningnya. ` : ''}Saldo awal bawaan contoh kembali ke nol. Saldo awal yang kamu ubah, saldo awal rekening buatanmu, dan saldo awal yang terkait mutasi tetap disimpan.</p>}
      <details className="demo-sample-review start-wallets"><summary>Dompet awal untuk “Mulai dari kosong” · {walletIds.length} dari {starters.length}</summary>
        <p className="field-help">Hilangkan centang dompet yang tidak kamu pakai. Dompet lain bisa ditambah kapan saja dari halaman Dompet. Semua mulai dengan saldo nol.</p>
        <div className="start-wallet-grid">{starters.map(wallet => <label key={wallet.id} className="checkbox-row"><input type="checkbox" disabled={busy} checked={walletIds.includes(wallet.id)} onChange={event => setWalletIds(current => event.target.checked ? [...current, wallet.id] : current.filter(id => id !== wallet.id))} /><span>{wallet.name} · {wallet.currency}</span></label>)}</div>
        {!walletIds.length && <p className="notice warning">Pilih setidaknya satu dompet awal.</p>}
      </details>
      {samples.length > 0 && <details className="demo-sample-review">
        <summary>Tinjau {samples.length} transaksi dari contoh</summary>
        <p className="field-help">Centang catatan contoh yang ingin kamu bawa. Perubahan yang terdeteksi sudah dicentang. Catatan dengan riwayat terkait selalu ikut.</p>
        {samples.map(({ entry, required }) => {
          const wallet = data.state.wallets.find(item => item.id === entry.walletId)!;
          return <label key={entry.id} className="checkbox-row">
            <input type="checkbox" disabled={required || busy} checked={included.has(entry.id)} onChange={event => toggle(entry.id, event.target.checked)} />
            <span>{entry.note || entry.category || 'Transaksi'} · {wallet.name} · {formatDate(entry.date)} · {formatMoney(entry.amount, wallet.currency)}{required && ' · riwayat terkait'}</span>
          </label>;
        })}
      </details>}
    </div>
    <div className="modal-footer demo-transition-actions">
      {savingStatus}
      <button className="button secondary" data-autofocus disabled={busy} onClick={onClose}>Batal</button>
      <button className={`button ${count === 0 ? 'primary' : 'secondary'}`} disabled={busy || !walletIds.length} onClick={() => persisted || count ? setConfirmDiscard(true) : startEmpty()}>Mulai dari kosong</button>
      {count > 0 && <button className="button primary" disabled={busy} onClick={() => onCarry(included)}>Bawa transaksi saya</button>}
    </div>
  </Modal>;
}
