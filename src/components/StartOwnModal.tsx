import { useMemo, useState } from 'react';
import Modal from './Modal';
import { formatDate, formatMoney } from '../lib/finance';
import { reviewDemo } from '../lib/demoTransition';
import type { StoredData } from '../lib/storage';

interface Props {
  data: StoredData;
  persisted: boolean;
  busy: boolean;
  onClose: () => void;
  onCarry: (included: ReadonlySet<string>) => void;
  onEmpty: () => void;
}

export default function StartOwnModal({ data, persisted, busy, onClose, onCarry, onEmpty }: Props) {
  const { samples, additional } = useMemo(() => reviewDemo(data), [data]);
  const [included, setIncluded] = useState(() => new Set(samples.filter(row => row.selected).map(row => row.entry.id)));
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const count = additional + included.size;
  const savingStatus = busy && <span className="field-help" role="status">Sedang menyimpan…</span>;
  function toggle(id: string, checked: boolean) {
    const next = new Set(included);
    if (checked) next.add(id); else next.delete(id);
    setIncluded(next);
  }
  if (confirmDiscard) return <Modal key="discard" title="Hapus catatan demo dan mulai dari kosong?" onClose={onClose}>
    <div className="modal-body"><p className="confirm-copy">Seluruh {data.state.entries.length} transaksi di mode contoh akan dihapus, termasuk yang kamu catat sendiri. Rekening juga akan diganti dengan dompet kosong. Untuk menyimpan salinan lebih dulu, batalkan lalu pilih Cadangkan semuanya.</p></div>
    <div className="modal-footer demo-transition-actions">{savingStatus}<button className="button secondary" data-autofocus disabled={busy} onClick={() => setConfirmDiscard(false)}>Kembali</button><button className="button danger" disabled={busy} onClick={onEmpty}>Hapus dan mulai dari kosong</button></div>
  </Modal>;
  return <Modal key="review" title="Mulai dengan uangmu sendiri?" onClose={onClose}>
    <div className="modal-body">
      <p className="confirm-copy"><strong>{count} transaksi akan dibawa.</strong> Semua {additional} transaksi tambahan ikut bersama rekeningnya. Saldo awal bawaan contoh kembali ke nol. Saldo awal yang kamu ubah, saldo awal rekening buatanmu, dan saldo awal yang terkait mutasi tetap disimpan.</p>
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
      <button className="button secondary" disabled={busy} onClick={() => persisted || count ? setConfirmDiscard(true) : onEmpty()}>Mulai dari kosong</button>
      <button className="button primary" disabled={busy || !persisted && count === 0} onClick={() => onCarry(included)}>Bawa transaksi saya</button>
    </div>
  </Modal>;
}
