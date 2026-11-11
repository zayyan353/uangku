import { useEffect, useRef, useState } from 'react';
import { FileSpreadsheet, FolderOpen } from 'lucide-react';
import { parseGenericStatement, readGenericTables, type GenericMapping, type GenericTable } from '../lib/genericImport';
import { guessCsvSeparator, guessDecimalSeparator, guessStatementOrder } from '../lib/genericImportHints';
import type { Entry, Wallet } from '../lib/finance';
import type { ImportPreview } from '../lib/importer';

interface Props {
  wallet: Wallet; entries: Entry[]; disabled?: boolean;
  /** A preview made from this mapping is on screen; the mapping folds away until the user reopens it. */
  hasPreview?: boolean;
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
const SEPARATOR_NAMES = { ',': 'koma', ';': 'titik koma', '\t': 'tab' } as const;
const isCsvName = (name: string) => /\.(csv|tsv)$/i.test(name);

export default function GenericImportMapper({ wallet, entries, disabled = false, hasPreview = false, onPreview, onInvalidate }: Props) {
  const [tables, setTables] = useState<GenericTable[]>([]), [sheetId, setSheetId] = useState('');
  const [filename, setFilename] = useState(''), [separator, setSeparator] = useState<',' | ';' | '\t'>(',');
  const [mapping, setMapping] = useState(() => blank(wallet));
  const [decimalChoice, setDecimalChoice] = useState<'' | '.' | ','>('');
  const [orderChoice, setOrderChoice] = useState<'' | 'oldest' | 'newest'>('');
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  /** The last file picked was CSV/TSV (even if it could not be read), so the separator still matters. */
  const [csvChosen, setCsvChosen] = useState(false), [separatorGuessed, setSeparatorGuessed] = useState(false);
  const [dragging, setDragging] = useState(false), [reopened, setReopened] = useState(false);
  useEffect(() => { if (!hasPreview) setReopened(false); }, [hasPreview]);
  const input = useRef<HTMLInputElement>(null), generation = useRef(0), pending = useRef(false);
  const bytesRef = useRef<ArrayBuffer | null>(null), alive = useRef(true);
  const walletRef = useRef(wallet), disabledRef = useRef(disabled); walletRef.current = wallet; disabledRef.current = disabled;
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  useEffect(() => {
    onInvalidate?.(); generation.current++; bytesRef.current = null; setTables([]); setSheetId(''); setFilename('');
    setMapping(blank(wallet)); setConfirmed(false); setError(''); setDecimalChoice(''); setOrderChoice(''); setCsvChosen(false); setSeparatorGuessed(false);
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
    setCsvChosen(isCsvName(file.name)); setSeparatorGuessed(false);
    if (file.size > 8 * 1024 * 1024) { setError('Ukuran file maksimal 8 MiB.'); return; }
    const attempt = ++generation.current, snapshot = { ...walletRef.current };
    pending.current = true; setBusy(true); setError(''); setTables([]); setConfirmed(false);
    try {
      const bytes = await file.arrayBuffer();
      if (!alive.current || attempt !== generation.current) return;
      if (disabledRef.current || snapshot.id !== walletRef.current.id || snapshot.currency !== walletRef.current.currency) throw new Error('Dompet atau penyimpanan berubah. Baca ulang file.');
      // The separator is suggested from the first lines; the sample table below shows the result and the choice stays editable.
      const guess = isCsvName(file.name) ? guessCsvSeparator(new TextDecoder().decode(bytes.slice(0, 16 * 1024))) : null;
      if (guess) { setSeparator(guess); setSeparatorGuessed(true); }
      const parsed = readGenericTables(bytes, file.name, guess ?? separator);
      bytesRef.current = bytes; setFilename(file.name); adoptTables(parsed);
    } catch (cause) { if (alive.current && attempt === generation.current) setError(cause instanceof Error ? cause.message : 'File belum dapat dibaca.'); }
    finally { pending.current = false; if (alive.current) setBusy(false); if (input.current) input.current.value = ''; }
  }
  function changeSeparator(value: ',' | ';' | '\t') {
    onInvalidate?.(); setSeparator(value); setSeparatorGuessed(false); setError(''); setConfirmed(false);
    if (bytesRef.current && /\.(csv|tsv)$/i.test(filename)) {
      try { adoptTables(readGenericTables(bytesRef.current, filename, value)); }
      catch (cause) { setTables([]); setError(cause instanceof Error ? cause.message : 'CSV tidak sesuai pemisah.'); }
    }
  }
  async function preview() {
    if (!table || pending.current || disabledRef.current || missing.length || !decimalChoice || !orderChoice) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const snapshot = { ...walletRef.current };
      const result = parseGenericStatement(table, { ...mapping, decimalSeparator: decimalChoice, order: orderChoice, confirmedCurrency: snapshot.currency }, snapshot, entries);
      await onPreview(result, filename, snapshot);
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'Pratinjau belum dapat dibuat.'); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  const headers = table?.values[mapping.headerRow] ?? [];
  const dataRows = table ? table.values.slice(mapping.headerRow + 1, mapping.headerRow + 201) : [];
  const amountColumns = mapping.amountMode === 'signed' ? [mapping.amountColumn ?? -1] : [mapping.debitColumn ?? -1, mapping.creditColumn ?? -1];
  // Suggestions read the first rows only; nothing is selected until the user takes or overrides them.
  const decimalHint = table ? guessDecimalSeparator(dataRows.flatMap(row => [...amountColumns, mapping.balanceColumn].filter(index => index >= 0).map(index => row[index]))) : null;
  const orderHint = table && mapping.dateColumn >= 0 ? guessStatementOrder(dataRows.map(row => row[mapping.dateColumn]), mapping.dateFormat) : null;
  const missing = !table ? [] : [
    mapping.dateColumn < 0 && 'kolom tanggal', mapping.descriptionColumn < 0 && 'kolom keterangan', mapping.balanceColumn < 0 && 'kolom saldo',
    mapping.amountMode === 'signed' ? (mapping.amountColumn ?? -1) < 0 && 'kolom nominal' : (mapping.debitColumn ?? -1) < 0 && 'kolom debit',
    mapping.amountMode === 'debit-credit' && (mapping.creditColumn ?? -1) < 0 && 'kolom kredit',
    !decimalChoice && 'pemisah desimal', !orderChoice && 'urutan mutasi', !confirmed && 'konfirmasi mata uang',
  ].filter((item): item is string => !!item);
  const folded = hasPreview && !reopened;
  function column(label: string, key: keyof Pick<GenericMapping, 'dateColumn' | 'descriptionColumn' | 'balanceColumn' | 'amountColumn' | 'debitColumn' | 'creditColumn' | 'referenceColumn' | 'currencyColumn'>, optional = false) {
    return <label className="field" key={key}><span className="field-label">{label}{optional ? ' (opsional)' : ' *'}</span><select className="select-input" aria-label={label} disabled={controlsDisabled} value={mapping[key] ?? -1} onChange={event => change({ [key]: Number(event.target.value) < 0 && optional ? undefined : Number(event.target.value) })}>
      <option value={-1}>{optional ? 'Tidak digunakan' : 'Pilih kolom'}</option>{headers.slice(0, 512).map((header, index) => <option key={index} value={index}>{index + 1} · {String(header ?? '').slice(0, 80) || '(tanpa judul)'}</option>)}
    </select></label>;
  }
  return <section className="panel generic-import" aria-label="Pemetaan impor umum">
    <div className="panel-header"><div><h2>Impor CSV / Excel umum</h2><p>Pilih kolom file dan periksa nominal sebelum menyimpan.</p></div><FileSpreadsheet size={24} /></div>
    {folded && <div className="notice generic-import-folded" data-testid="mapping-folded"><span><strong>{filename}</strong> sudah dibaca dengan pemetaan ini. Pratinjaunya ada di bawah.</span><button type="button" className="button secondary small" disabled={controlsDisabled} onClick={() => setReopened(true)}>Ubah pemetaan</button></div>}
    <div hidden={folded}>
    <p className="field-help generic-import-intro">File harus berisi satu rekening dan satu mata uang, dengan <strong>saldo setelah setiap transaksi</strong>. Saldo yang tidak tersedia tidak akan dibuat-buat. File dibaca di browser dan tidak dikirim ke server.</p>
    <div className={`generic-import-file${dragging ? ' dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!controlsDisabled) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!controlsDisabled) void load(event.dataTransfer.files[0]); }}>
      <button type="button" className="button secondary" disabled={controlsDisabled} onClick={() => input.current?.click()}><FolderOpen size={16} />{busy ? 'Membaca…' : 'Pilih file CSV/Excel'}</button><span className="field-help">atau taruh file .csv, .tsv, atau .xlsx di sini · maksimal 8 MB</span>
      <input hidden ref={input} disabled={controlsDisabled} type="file" accept=".csv,.tsv,.xlsx" aria-label="File mutasi umum" onChange={event => void load(event.target.files?.[0])} />
    </div>
    {csvChosen && <label className="field generic-import-separator"><span className="field-label">Pemisah CSV</span><select className="select-input" aria-label="Pemisah CSV" value={separator === '\t' ? 'tab' : separator} disabled={controlsDisabled} onChange={event => changeSeparator(event.target.value === 'tab' ? '\t' : event.target.value as ',' | ';')}><option value=",">Koma (,)</option><option value=";">Titik koma (;)</option><option value="tab">Tab</option></select>{separatorGuessed && <span className="field-help" data-testid="separator-guess">Ditebak dari isi file: {SEPARATOR_NAMES[separator]}. Ubah bila tabel contoh di bawah tampak salah.</span>}</label>}
    {table && <>
      <p className="field-help generic-import-loaded">{filename} · {Math.max(0, table.values.length - mapping.headerRow - 1)} baris setelah judul. Pilihan kolom awal hanya bantuan; periksa semuanya.</p>
      <div className="form-grid">
        {tables.length > 1 && <label className="field"><span className="field-label">Worksheet</span><select className="select-input" aria-label="Worksheet" value={sheetId} disabled={controlsDisabled} onChange={event => { onInvalidate?.(); const next = tables.find(item => item.id === event.target.value)!; setSheetId(next.id); setMapping(suggested(next, 0, wallet)); setConfirmed(false); }} >{tables.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}
        <label className="field"><span className="field-label">Baris judul kolom</span><input className="field-input" aria-label="Baris judul kolom" type="number" min={1} max={Math.min(101, table.values.length)} disabled={controlsDisabled} value={mapping.headerRow + 1} onChange={event => { onInvalidate?.(); const header = Number(event.target.value) - 1; setMapping(suggested(table, header, wallet)); setConfirmed(false); }} /></label>
      </div>
      <div className="table-wrap generic-sample-wrap"><table className="generic-sample-table"><caption className="field-help">Contoh nilai asli: judul dan tiga baris berikutnya, maksimal delapan kolom ditampilkan.</caption><tbody>{table.values.slice(mapping.headerRow, mapping.headerRow + 4).map((row, index) => <tr key={index}>{row.slice(0, 8).map((value, column) => <td key={column} style={{ maxWidth: 180, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{String(value ?? '').slice(0, 180)}</td>)}</tr>)}</tbody></table></div>
      <div className="form-grid">
        {column('Kolom tanggal', 'dateColumn')}{column('Kolom keterangan', 'descriptionColumn')}{column('Kolom saldo', 'balanceColumn')}
        <label className="field"><span className="field-label">Mode nominal</span><select className="select-input" aria-label="Mode nominal" value={mapping.amountMode} disabled={controlsDisabled} onChange={event => change({ amountMode: event.target.value as GenericMapping['amountMode'] })}><option value="signed">Satu kolom bertanda +/−</option><option value="debit-credit">Kolom debit dan kredit terpisah</option></select></label>
        {mapping.amountMode === 'signed' ? column('Kolom nominal', 'amountColumn') : <>{column('Kolom debit', 'debitColumn')}{column('Kolom kredit', 'creditColumn')}</>}
        {column('Kolom referensi', 'referenceColumn', true)}{column('Kolom mata uang', 'currencyColumn', true)}
        <label className="field"><span className="field-label">Format tanggal</span><select className="select-input" aria-label="Format tanggal" value={mapping.dateFormat} disabled={controlsDisabled} onChange={event => change({ dateFormat: event.target.value as GenericMapping['dateFormat'] })}><option value="iso">YYYY-MM-DD</option><option value="dmy">DD/MM/YYYY</option><option value="mdy">MM/DD/YYYY</option><option value="excel">Serial tanggal Excel</option></select></label>
        <label className="field"><span className="field-label">Pemisah desimal pada teks</span><select className="select-input" aria-label="Pemisah desimal" value={decimalChoice} disabled={controlsDisabled} onChange={event => { onInvalidate?.(); setDecimalChoice(event.target.value as '' | '.' | ','); setConfirmed(false); }}><option value="">Pilih format angka</option><option value=".">Titik: 1,234.56</option><option value=",">Koma: 1.234,56</option></select>{decimalHint && decimalChoice !== decimalHint && <span className="field-help generic-hint" data-testid="decimal-hint">Dari data tampaknya {decimalHint === ',' ? 'koma' : 'titik'}. <button type="button" className="text-link" disabled={controlsDisabled} onClick={() => { onInvalidate?.(); setDecimalChoice(decimalHint); setConfirmed(false); }}>Pakai saran</button></span>}</label>
        <label className="field"><span className="field-label">Urutan mutasi</span><select className="select-input" aria-label="Urutan mutasi" value={orderChoice} disabled={controlsDisabled} onChange={event => { onInvalidate?.(); setOrderChoice(event.target.value as '' | 'oldest' | 'newest'); setConfirmed(false); }}><option value="">Pilih arah urutan file</option><option value="oldest">Paling lama di atas</option><option value="newest">Paling baru di atas</option></select>{orderHint && orderChoice !== orderHint && <span className="field-help generic-hint" data-testid="order-hint">Dari tanggalnya tampaknya paling {orderHint === 'oldest' ? 'lama' : 'baru'} di atas. <button type="button" className="text-link" disabled={controlsDisabled} onClick={() => { onInvalidate?.(); setOrderChoice(orderHint); setConfirmed(false); }}>Pakai saran</button></span>}</label>
      </div>
      <p className="field-help">Angka numerik Excel dibaca dari nilai sel asli; pemisah desimal mengatur angka yang disimpan sebagai teks. Debit/kredit terpisah harus berisi nilai positif di salah satu kolom saja.</p>
      <label className="checkbox-row"><input type="checkbox" aria-label="Konfirmasi mata uang file" disabled={controlsDisabled} checked={confirmed} onChange={event => { onInvalidate?.(); setConfirmed(event.target.checked); }} /><span>Saya memastikan file ini memakai {wallet.currency}. Nominal tidak dikonversi; pilihan format dan kolom sudah diperiksa.</span></label>
      {missing.length > 0 && <p className="field-help generic-missing" role="status" data-testid="mapping-missing">Belum lengkap: {missing.join(', ')}.</p>}
      <button type="button" className="button primary" disabled={controlsDisabled || missing.length > 0} onClick={() => void preview()}>Buat pratinjau impor</button>
    </>}
    </div>
    {error && <div className="notice error" role="alert" style={{ marginTop: 14 }}>{error}</div>}
  </section>;
}
