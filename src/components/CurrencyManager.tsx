import { useMemo, useRef, useState } from 'react';
import { Check, Eye, EyeOff, Plus, Search } from 'lucide-react';
import Modal from './Modal';
import { CURRENCY_CATALOG, currencyInfo, type Currency } from '../lib/currencyCatalog';
import { visibleCurrencyCodes } from '../lib/currencySettings';
import type { StoredData } from '../lib/storage';

export default function CurrencyManager({ data, onSave, onView, onClose, disabled = false }: {
  data: StoredData; onSave: (codes: Currency[]) => Promise<boolean>;
  onView: (code: Currency) => void; onClose: () => void; disabled?: boolean;
}) {
  const [initial] = useState(() => visibleCurrencyCodes(data));
  const [codes, setCodes] = useState<Currency[]>(initial);
  const [query, setQuery] = useState('');
  const [choice, setChoice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const changed = JSON.stringify(codes) !== JSON.stringify(initial);
  const used = useMemo(() => new Map<Currency, number>([...new Set(data.state.wallets.map(wallet => wallet.currency))].map(code => [code, data.state.wallets.filter(wallet => wallet.currency === code).length])), [data.state.wallets]);
  const available = CURRENCY_CATALOG.filter(info => !codes.includes(info.code) && `${info.code} ${info.label}`.toLocaleLowerCase('id-ID').includes(query.trim().toLocaleLowerCase('id-ID')));
  const selected = available.some(info => info.code === choice) ? choice as Currency : available[0]?.code;
  async function save() {
    if (saving.current || disabled) return;
    saving.current = true; setBusy(true); setError('');
    try { if (!await onSave(codes)) setError('Daftar mata uang belum tersimpan. Pilihan tetap ada; periksa status penyimpanan.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Daftar mata uang belum dapat disimpan.'); }
    finally { saving.current = false; setBusy(false); }
  }
  const row = (code: Currency, visible: boolean) => {
    const info = currencyInfo(code);
    return <li key={code}><div><strong>{code} · {info.label}</strong><span className="field-help">{info.digits} digit desimal{used.has(code) ? ` · ${used.get(code)} dompet tetap tersimpan` : ''}</span></div><div className="currency-manager-row-actions">{visible ? <button className="button secondary small" disabled={busy || codes.length <= 1} aria-label={`Sembunyikan ${code}`} onClick={() => setCodes(current => current.filter(value => value !== code))}><EyeOff size={15} /> Sembunyikan</button> : <button className="button secondary small" disabled={busy} aria-label={`Tampilkan ${code}`} onClick={() => setCodes(current => [...current, code])}><Eye size={15} /> Tampilkan</button>}{used.has(code) && <button className="button secondary small" disabled={busy || changed} aria-label={`Buka laporan ${code}`} onClick={() => onView(code)}>Buka laporan</button>}</div></li>;
  };
  return <Modal title="Kelola mata uang" subtitle="Atur mata uang yang tampil dan tersedia saat menambah dompet." onClose={() => { if (!saving.current) onClose(); }}>
    <div className="modal-body currency-manager">
      {disabled && <p className="notice warning">Penyimpanan belum siap. Selesaikan pemulihan atau konflik pada status penyimpanan sebelum menyimpan daftar ini.</p>}
      <p className="notice">Menyembunyikan mata uang hanya mengubah daftar pilihan. Dompet, histori, saldo, dan kurs transaksi tetap tersimpan. Mata uang yang sudah tercatat tetap dapat dibuka laporannya.</p>
      <label className="search-input"><Search size={17} /><input aria-label="Cari mata uang" placeholder="Cari kode atau nama: EUR, JPY…" value={query} disabled={busy} onChange={event => setQuery(event.target.value)} /></label>
      <div className="currency-manager-add"><label className="field"><span className="field-label">Mata uang tambahan</span><select className="select-input" aria-label="Mata uang tambahan" value={selected ?? ''} disabled={busy || !selected} onChange={event => setChoice(event.target.value)}>{!available.length && <option value="">Tidak ada hasil</option>}{available.map(info => <option key={info.code} value={info.code}>{info.code} · {info.label} · {info.digits} desimal</option>)}</select></label><button className="button secondary" disabled={busy || !selected} onClick={() => { if (selected) setCodes(current => [...current, selected]); }}><Plus size={16} /> Tambah mata uang</button></div>
      <h3>Daftar tampil · {codes.length}</h3><p className="field-help">Sisakan setidaknya satu mata uang. Urutan ini dipakai pada tab mata uang.</p><ul className="currency-manager-list">{codes.map(code => row(code, true))}</ul>
      {[...used.keys()].some(code => !codes.includes(code)) && <><h3>Tercatat tetapi disembunyikan</h3><ul className="currency-manager-list">{[...used.keys()].filter(code => !codes.includes(code)).map(code => row(code, false))}</ul></>}
      {changed && <p className="field-help">Simpan atau batalkan perubahan sebelum membuka laporan.</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
    </div><div className="modal-footer"><button className="button secondary" disabled={busy} onClick={onClose}>Batal</button><button className="button primary" disabled={busy || disabled} onClick={save}><Check size={16} /> {busy ? 'Menyimpan…' : 'Simpan mata uang'}</button></div>
  </Modal>;
}
