import { useRef, useState, type FormEvent } from 'react';
import { Archive, Check, Trash2 } from 'lucide-react';
import Modal from './Modal';
import { makeId, parseMoney, validateWallet, type Currency, type Wallet } from '../lib/finance';
import { currencyInfo, LEGACY_CURRENCY_CODES } from '../lib/currencyCatalog';
import { formatMoneyInput } from '../lib/moneyFormatting';
import type { WalletUsage } from '../lib/walletLifecycle';

export default function WalletEditor({ existing, defaultCurrency, usage, onSave, onClose, onDelete, onArchive, disabled = false, disabledReason = '', currencies = LEGACY_CURRENCY_CODES }: {
  existing?: Wallet; defaultCurrency: Currency; usage?: WalletUsage; currencies?: readonly Currency[];
  onSave: (wallet: Wallet) => Promise<boolean>; onClose: () => void;
  onDelete?: () => void; onArchive?: () => void; disabled?: boolean; disabledReason?: string;
}) {
  const [id] = useState(() => existing?.id ?? makeId());
  const [name, setName] = useState(existing?.name ?? '');
  const [currency, setCurrency] = useState<Currency>(existing?.currency ?? defaultCurrency);
  const [kind, setKind] = useState<Wallet['kind']>(existing?.kind ?? 'bank');
  const [balance, setBalance] = useState(existing ? formatMoneyInput(existing.openingBalance, existing.currency) : '0');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const changed = !!existing && (name !== existing.name || currency !== existing.currency || kind !== existing.kind || balance !== formatMoneyInput(existing.openingBalance, existing.currency));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving.current || disabled) return;
    if (!existing && !currencies.includes(currency)) return setError('Mata uang pilihan sedang disembunyikan. Pilih mata uang aktif atau tampilkan kembali lewat Kelola mata uang.');
    const openingBalance = parseMoney(balance, currency);
    if (openingBalance === null) return setError('Saldo awal belum valid untuk mata uang ini. Gunakan koma untuk desimal dan angka tanpa pengelompokan agar jelas.');
    const wallet: Wallet = { id, name: name.trim(), currency, kind, openingBalance };
    const problem = validateWallet(wallet);
    if (problem) return setError(problem);
    saving.current = true; setBusy(true); setError('');
    try {
      if (!await onSave(wallet)) setError('Dompet belum tersimpan. Isian tetap ada; periksa status penyimpanan lalu coba lagi.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Dompet belum dapat disimpan.'); }
    finally { saving.current = false; setBusy(false); }
  }
  return <Modal title={existing ? 'Atur dompet' : 'Tambah dompet'} subtitle="Satu dompet untuk satu tempat uang dan mata uang." onClose={() => { if (!saving.current && !busy) onClose(); }}>
    <form onSubmit={submit}><fieldset disabled={disabled || busy} style={{ display: 'contents' }}><div className="modal-body form-grid">
      {disabledReason && <div className="notice warning full" role="status">{disabledReason}</div>}
      <label className="field full"><span className="field-label">Nama dompet</span><input required maxLength={60} className="field-input" value={name} onChange={event => setName(event.target.value)} placeholder="Contoh: Ziraat utama, Papara" /></label>
      <label className="field"><span className="field-label">Mata uang</span><select className="select-input" value={currency} disabled={!!existing} onChange={event => setCurrency(event.target.value as Currency)}>{[...new Set([...currencies, currency])].map(code => <option key={code} value={code}>{code} · {currencyInfo(code).label}{!currencies.includes(code) ? existing ? ' (riwayat)' : ' (disembunyikan)' : ''}</option>)}</select>{existing && <span className="field-help">Mata uang tetap agar histori nominal tidak berubah.</span>}</label>
      <label className="field"><span className="field-label">Jenis dompet</span><select className="select-input" value={kind} onChange={event => setKind(event.target.value as Wallet['kind'])}><option value="bank">Rekening bank</option><option value="ewallet">E-wallet</option></select></label>
      <label className="field full"><span className="field-label">Saldo awal ({currency})</span><input required disabled={usage?.openingLocked} className="field-input amount-input" inputMode="decimal" value={balance} onChange={event => setBalance(event.target.value)} /><span className="field-help">{usage?.openingLocked ? 'Saldo awal terkunci karena sudah ada histori atau bukti sumber. Gunakan Cek saldo untuk mencocokkan saldo saat ini.' : `Saldo sebelum transaksi pertama. ${currencyInfo(currency).digits} digit desimal; gunakan koma untuk desimal. Setelah ada histori, saldo awal dikunci.`}</span></label>
      {existing && <div className="wallet-lifecycle-actions full"><p className="field-help">{usage?.canDelete ? 'Dompet kosong tanpa saldo atau referensi histori dapat dihapus.' : 'Dompet ini memiliki saldo atau histori. Arsipkan untuk menghentikan input baru; histori dan saldo tetap masuk laporan.'}</p>{changed && <p className="field-help">Simpan atau batalkan perubahan formulir sebelum mengarsipkan atau menghapus.</p>}{onArchive && <button disabled={changed} type="button" className="button secondary small" onClick={onArchive}><Archive size={16} /> Arsipkan dompet</button>}{usage?.canDelete && onDelete && <button disabled={changed} type="button" className="button danger small" onClick={onDelete}><Trash2 size={16} /> Hapus dompet</button>}</div>}
      {error && <div className="notice error full" role="alert">{error}</div>}
    </div></fieldset><div className="modal-footer"><button disabled={busy} type="button" className="button secondary" onClick={onClose}>Batal</button><button disabled={disabled || busy} className="button primary" type="submit"><Check size={17} /> {busy ? 'Menyimpan…' : 'Simpan dompet'}</button></div></form>
  </Modal>;
}
