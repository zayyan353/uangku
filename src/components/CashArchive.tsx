import { useState } from 'react';
import { formatDate, formatMoney, walletBalance } from '../lib/finance';
import type { StoredData } from '../lib/storage';
import { isCashLinkedEntry } from '../lib/cashScope';
import Modal from './Modal';

export default function CashArchive({ data, onClose }: { data: StoredData; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const wallets = data.state.wallets.filter(wallet => wallet.kind === 'cash');
  const entries = data.state.entries.filter(entry => isCashLinkedEntry(data.state, entry)).slice().sort((a, b) => b.date.localeCompare(a.date));
  const pages = Math.max(1, Math.ceil(entries.length / 50));
  return <Modal title="Arsip cash lama" subtitle="Baca saja. Histori dipertahankan dalam cadangan; cash tidak masuk pembukuan aktif." onClose={onClose}>
    <div className="modal-body"><p>Catatan lama yang masih memiliki saldo atau rujukan tetap disimpan agar histori rekening tidak rusak. Tidak ada dompet cash baru atau transaksi cash baru.</p>
      {wallets.map(wallet => <p key={wallet.id}><strong>{wallet.name} · {wallet.currency}</strong> · saldo seluruh catatan lama: {formatMoney(walletBalance(data.state, wallet.id, data.metadata), wallet.currency)}</p>)}
      <p>{entries.length} catatan lama terkait cash.</p>
      {entries.slice((page - 1) * 50, page * 50).map(entry => { const wallet = data.state.wallets.find(w => w.id === entry.walletId)!; return <p key={entry.id}>{formatDate(entry.date)} · {entry.note || entry.category || 'Catatan lama'} · {wallet.name} · {formatMoney(entry.amount, wallet.currency)}</p>; })}
      <nav className="history-pagination" aria-label="Halaman arsip cash"><span>Halaman {page} dari {pages}</span><div><button className="button secondary small" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Sebelumnya</button><button className="button secondary small" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>Berikutnya</button></div></nav>
    </div><div className="modal-footer"><button className="button secondary" onClick={onClose}>Tutup arsip</button></div>
  </Modal>;
}
