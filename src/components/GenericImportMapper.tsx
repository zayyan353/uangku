import { useEffect, useRef, useState } from 'react';
import { FileSpreadsheet, FolderOpen } from 'lucide-react';
import { parseGenericStatement, readGenericTables, type GenericMapping, type GenericTable } from '../lib/genericImport';
import type { Entry, Wallet } from '../lib/finance';
import type { ImportPreview } from '../lib/importer';

interface Props {
  wallet: Wallet; entries: Entry[]; disabled?: boolean;
  onInvalidate?: () => void;
  onPreview: (preview: ImportPreview, filename: string, walletSnapshot: Wallet) => void | Promise<void>;
}
const blank = (wallet: Wallet): GenericMapping => ({ headerRow: 0, dateColumn: -1, descriptionColumn: -1, balanceColumn: -1,
  amountMode: 'signed', amountColumn: -1, dateFormat: 'iso', decimalSeparator: '.', order: 'oldest', confirmedCurrency: wallet.currency });
function suggested(table: GenericTable, headerRow: number, wallet: Wallet): GenericMapping {
  const headers = (table.values[headerRow] ?? []).map(value => String(value ?? '').normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').trim());
  const find = (names: string[]) => headers.findIndex(name => names.includes(name));
  const amountColumn = find(['amount', 'nominal', 'jumlah', 'islem tutari', 'tutar']);
  const debit = find(['debit', 'pengeluaran', 'withdrawal']), credit = find(['credit', 'kredit', 'pemasukan', 'deposit']);
  const reference = find(['reference', 'referensi', 'ref', 'id', 'fis no']), currency = find(['currency', 'mata uang', 'doviz', 'para birimi', 'ccy']);
  return { ...blank(wallet), headerRow, dateColumn: find(['date', 'tanggal', 'tarih']), descriptionColumn: find(['description', 'keterangan', 'deskripsi', 'aciklama']),
    balanceColumn: find(['balance', 'saldo', 'bakiye', 'running balance']), amountColumn,
    amountMode: amountColumn < 0 && debit >= 0 && credit >= 0 ? 'debit-credit' : 'signed', debitColumn: debit, creditColumn: credit,
    referenceColumn: reference < 0 ? undefined : reference, currencyColumn: currency < 0 ? undefined : currency };
}

/** Only creates an in-memory preview. The parent owns review and guarded saves. */
export default function GenericImportMapper({ wallet, entries, disabled = false, onPreview, onInvalidate }: Props) {
  const [tables, setTables] = useState<GenericTable[]>([]), [sheetId, setSheetId] = useState('');
  const [filename, setFilename] = useState(''), [separator, setSeparator] = useState<',' | ';' | '\t'>(',');
  const [mapping, setMapping] = useState(() => blank(wallet));
  const [decimalChoice, setDecimalChoice] = useState<'' | '.' | ','>('');
  const [orderChoice, setOrderChoice] = useState<'' | 'oldest' | 'newest'>('');
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null), generation = useRef(0), pending = useRef(false);
  const bytesRef = useRef<ArrayBuffer | null>(null), alive = useRef(true);
  const walletRef = useRef(wallet), disabledRef = useRef(disabled); walletRef.current = wallet; disabledRef.current = disabled;
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  useEffect(() => {
    onInvalidate?.(); generation.current++; bytesRef.current = null; setTables([]); setSheetId(''); setFilename('');
    setMapping(blank(wallet)); setConfirmed(false); setError(''); setDecimalChoice(''); setOrderChoice('');
  }, [wallet.id, wallet.currency, wallet.name, wallet.kind, wallet.openingBalance]);
  const table = tables.find(item => item.id === sheetId);
  const controlsDisabled = disabled || busy;
  function change(patch: Partial<GenericMapping>) { onInvalidate?.(); setMapping(current => ({ ...current, ...patch })); setConfirmed(false); setError(''); }
  function adoptTables(next: GenericTable[]) {
    if (!next.length || next.some(item => item.values.length > 50_101)) throw new Error('Worksheet kosong atau melebihi 50.000 transaksi. Pilih ekspor lebih singkat.');
    setTables(next); setSheetId(next[0].id); setMapping(suggested(next[0], 0, walletRef.current));
    setConfirmed(false); setDecimalChoice(''); setOrderChoice('');
  }
  async function load(file?: File) {
    if (!file || pending.current || disabledRef.current) return;
    onInvalidate?.(); bytesRef.current = null; setFilename(''); setTables([]); setSheetId(''); setConfirmed(false); setMapping(blank(walletRef.current)); setDecimalChoice(''); setOrderChoice('');
    if (file.size > 8 * 1024 * 1024) { setError('Ukuran file maksimal 8 MiB.'); return; }
    const attempt = ++generation.current, snapshot = { ...walletRef.current };
    pending.current = true; setBusy(true); setError(''); setTables([]); setConfirmed(false);
    try {
      const bytes = await file.arrayBuffer();
      if (!alive.current || attempt !== generation.current) return;
      if (disabledRef.current || snapshot.id !== walletRef.current.id || snapshot.currency !== walletRef.current.currency) throw new Error('Dompet atau penyimpanan berubah. Baca ulang file.');
      const parsed = readGenericTables(bytes, file.name, separator);
      bytesRef.current = bytes; setFilename(file.name); adoptTables(parsed);
    } catch (cause) { if (alive.current && attempt === generation.current) setError(cause instanceof Error ? cause.message : 'File belum dapat dibaca.'); }
    finally { pending.current = false; if (alive.current) setBusy(false); if (input.current) input.current.value = ''; }
  }
  function changeSeparator(value: ',' | ';' | '\t') {
    onInvalidate?.(); setSeparator(value); setError(''); setConfirmed(false);
    if (bytesRef.current && /\.(csv|tsv)$/i.test(filename)) {
      try { adoptTables(readGenericTables(bytesRef.current, filename, value)); }
      catch (cause) { setTables([]); setError(cause instanceof Error ? cause.message : 'CSV tidak sesuai pemisah.'); }
    }
  }
  async function preview() {
    if (!table || pending.current || disabledRef.current || !confirmed || !decimalChoice || !orderChoice) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const snapshot = { ...walletRef.current };
      const result = parseGenericStatement(table, { ...mapping, decimalSeparator: decimalChoice, order: orderChoice, confirmedCurrency: snapshot.currency }, snapshot, entries);
      await onPreview(result, filename, snapshot);
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'Pratinjau belum dapat dibuat.'); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  function column(label: string, key: keyof Pick<GenericMapping, 'dateColumn' | 'descriptionColumn' | 'balanceColumn' | 'amountColumn' | 'debitColumn' | 'creditColumn' | 'referenceColumn' | 'currencyColumn'>, optional = false) {
    const headers = table?.values[mapping.headerRow] ?? [];
    return <label className="field" key={key}><span className="field-label">{label}{optional ? ' (opsional)' : ' *'}</span><select className="select-input" aria-label={label} disabled={controlsDisabled} value={mapping[key] ?? -1} onChange={event => change({ [key]: Number(event.target.value) < 0 && optional ? undefined : Number(event.target.value) })}>
      <option value={-1}>{optional ? 'Tidak digunakan' : 'Pilih kolom'}</option>{headers.slice(0, 512).map((header, index) => <option key={index} value={index}>{index + 1} · {String(header ?? '').slice(0, 80) || '(tanpa judul)'}</option>)}
    </select></label>;
  }
  return <section className="panel" style={{ padding: 20, marginBottom: 20, minWidth: 0 }} aria-label="Pemetaan impor umum">
    <div className="panel-header"><div><h2>Impor CSV / Excel umum</h2><p>Pilih kolom file dan periksa nominal sebelum menyimpan.</p></div><FileSpreadsheet size={24} /></div>
    <p className="field-help">File harus berisi satu rekening dan satu mata uang, dengan <strong>saldo setelah setiap transaksi</strong>. Saldo yang tidak tersedia tidak akan dibuat-buat. File dibaca di browser dan tidak dikirim ke server.</p>
    <div className="form-grid">
      <label className="field"><span className="field-label">Pemisah CSV</span><select className="select-input" aria-label="Pemisah CSV" value={separator === '\t' ? 'tab' : separator} disabled={controlsDisabled} onChange={event => changeSeparator(event.target.value === 'tab' ? '\t' : event.target.value as ',' | ';')}><option value=",">Koma (,)</option><option value=";">Titik koma (;)</option><option value="tab">Tab</option></select></label>
      <div className="field"><span className="field-label">Dompet tujuan</span><strong style={{ overflowWrap: 'anywhere' }}>{wallet.name} · {wallet.currency}</strong><button type="button" className="button secondary" disabled={controlsDisabled} onClick={() => input.current?.click()}><FolderOpen size={16} />{busy ? 'Membaca…' : 'Pilih file CSV/Excel'}</button><input hidden ref={input} disabled={controlsDisabled} type="file" accept=".csv,.tsv,.xlsx" aria-label="File mutasi umum" onChange={event => void load(event.target.files?.[0])} /></div>
    </div>
    {table && <>
      <p className="field-help">{filename} · {Math.max(0, table.values.length - mapping.headerRow - 1)} baris setelah judul. Pilihan kolom awal hanya bantuan; periksa semuanya.</p>
      <div className="form-grid">
        <label className="field"><span className="field-label">Worksheet</span><select className="select-input" aria-label="Worksheet" value={sheetId} disabled={controlsDisabled} onChange={event => { onInvalidate?.(); const next = tables.find(item => item.id === event.target.value)!; setSheetId(next.id); setMapping(suggested(next, 0, wallet)); setConfirmed(false); }} >{tables.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label className="field"><span className="field-label">Baris judul kolom</span><input className="field-input" aria-label="Baris judul kolom" type="number" min={1} max={Math.min(101, table.values.length)} disabled={controlsDisabled} value={mapping.headerRow + 1} onChange={event => { onInvalidate?.(); const header = Number(event.target.value) - 1; setMapping(suggested(table, header, wallet)); setConfirmed(false); }} /></label>
      </div>
      <div className="table-wrap" style={{ maxWidth: '100%', margin: '12px 0' }}><table className="transactions-table"><caption className="field-help">Contoh nilai asli: judul dan tiga baris berikutnya, maksimal delapan kolom ditampilkan.</caption><tbody>{table.values.slice(mapping.headerRow, mapping.headerRow + 4).map((row, index) => <tr key={index}>{row.slice(0, 8).map((value, column) => <td key={column} style={{ maxWidth: 180, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{String(value ?? '').slice(0, 180)}</td>)}</tr>)}</tbody></table></div>
      <div className="form-grid">
        {column('Kolom tanggal', 'dateColumn')}{column('Kolom keterangan', 'descriptionColumn')}{column('Kolom saldo', 'balanceColumn')}
        <label className="field"><span className="field-label">Mode nominal</span><select className="select-input" aria-label="Mode nominal" value={mapping.amountMode} disabled={controlsDisabled} onChange={event => change({ amountMode: event.target.value as GenericMapping['amountMode'] })}><option value="signed">Satu kolom bertanda +/−</option><option value="debit-credit">Kolom debit dan kredit terpisah</option></select></label>
        {mapping.amountMode === 'signed' ? column('Kolom nominal', 'amountColumn') : <>{column('Kolom debit', 'debitColumn')}{column('Kolom kredit', 'creditColumn')}</>}
        {column('Kolom referensi', 'referenceColumn', true)}{column('Kolom mata uang', 'currencyColumn', true)}
        <label className="field"><span className="field-label">Format tanggal</span><select className="select-input" aria-label="Format tanggal" value={mapping.dateFormat} disabled={controlsDisabled} onChange={event => change({ dateFormat: event.target.value as GenericMapping['dateFormat'] })}><option value="iso">YYYY-MM-DD</option><option value="dmy">DD/MM/YYYY</option><option value="mdy">MM/DD/YYYY</option><option value="excel">Serial tanggal Excel</option></select></label>
        <label className="field"><span className="field-label">Pemisah desimal pada teks</span><select className="select-input" aria-label="Pemisah desimal" value={decimalChoice} disabled={controlsDisabled} onChange={event => { onInvalidate?.(); setDecimalChoice(event.target.value as '' | '.' | ','); setConfirmed(false); }}><option value="">Pilih format angka</option><option value=".">Titik: 1,234.56</option><option value=",">Koma: 1.234,56</option></select></label>
        <label className="field"><span className="field-label">Urutan mutasi</span><select className="select-input" aria-label="Urutan mutasi" value={orderChoice} disabled={controlsDisabled} onChange={event => { onInvalidate?.(); setOrderChoice(event.target.value as '' | 'oldest' | 'newest'); setConfirmed(false); }}><option value="">Pilih arah urutan file</option><option value="oldest">Paling lama di atas</option><option value="newest">Paling baru di atas</option></select></label>
      </div>
      <p className="field-help">Angka numerik Excel dibaca dari nilai sel asli; pemisah desimal mengatur angka yang disimpan sebagai teks. Debit/kredit terpisah harus berisi nilai positif di salah satu kolom saja.</p>
      <label className="checkbox-row"><input type="checkbox" aria-label="Konfirmasi mata uang file" disabled={controlsDisabled} checked={confirmed} onChange={event => { onInvalidate?.(); setConfirmed(event.target.checked); }} /><span>Saya memastikan file ini memakai {wallet.currency}. Nominal tidak dikonversi; pilihan format dan kolom sudah diperiksa.</span></label>
      <button type="button" className="button primary" disabled={controlsDisabled || !confirmed || !decimalChoice || !orderChoice} onClick={() => void preview()}>Buat pratinjau impor</button>
    </>}
    {error && <div className="notice error" role="alert" style={{ marginTop: 14 }}>{error}</div>}
  </section>;
}
