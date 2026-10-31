import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCheck, CircleHelp, FileSpreadsheet, FolderOpen, Leaf, Search, ShieldCheck, Tags } from 'lucide-react';
import { formatDate, formatMoney, makeId, walletBalance, type Currency, type Entry, type State, type Wallet } from '../lib/finance';
import { parseZiraatWorkbook, type ImportPreview, type ImportRow } from '../lib/importer';
import { inspectSourcedImport, prepareSourcedImport, type SourcedImportDecisions, type SourceResolution } from '../lib/sourceCommands';
import type { StoredData } from '../lib/storage';
import { CategorySettingsContext } from '../hooks/useCategorySettings';
import { categoryChoices, isUncategorized } from '../lib/categorySettings';
import { createCategorySuggester } from '../lib/categorySuggestions';
import { presentBankDescription } from '../lib/bankEntryHints';
import { entryReviewStatus, reviewCounts } from '../lib/reviewStatus';
import { isWalletArchived } from '../lib/walletLifecycle';
import GenericImportMapper from './GenericImportMapper';

export interface RecoveryImportViewProps {
  data: StoredData;
  state: State;
  demo: boolean;
  onStart: () => void;
  /** Resolves true only after the parent coordinated writer confirms a durable save. */
  onImport: (nextState: State, sourceDocument?: StoredData, walletId?: string) => Promise<boolean>;
  notify: (text: string) => void;
  disabled?: boolean;
  onAddWallet?: (currency?: Currency) => void;
  preferredCurrency?: Currency;
}

/** New local orchestration around the exactly recovered importCommit module. */
export default function RecoveryImportView({ data, state, demo, onStart, onImport, notify, disabled = false, onAddWallet, preferredCurrency = 'TRY' }: RecoveryImportViewProps) {
  const [importFormat, setImportFormat] = useState<'ziraat' | 'generic'>('ziraat');
  const eligibleWallets = useMemo(() => state.wallets.filter(wallet => (importFormat === 'generic' || wallet.currency === 'TRY') && wallet.kind !== 'cash' && !isWalletArchived(data, wallet.id)), [state.wallets, data.metadata, importFormat]);
  const [walletId, setWallet] = useState(() => eligibleWallets.find(wallet => wallet.name.toLowerCase().includes('ziraat'))?.id ?? eligibleWallets[0]?.id ?? '');
  const selectedWalletRef = useRef(walletId); selectedWalletRef.current = walletId;
  const [result, setResult] = useState<ImportPreview | null>(null);
  const [walletSnapshot, setWalletSnapshot] = useState<Wallet | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [decisions, setDecisions] = useState<SourcedImportDecisions>({});
  const [filename, setFilename] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [useOpening, setUseOpening] = useState(true);
  const [previewQuery, setPreviewQuery] = useState('');
  const [previewFilter, setPreviewFilter] = useState('all');
  const [previewPage, setPreviewPage] = useState(1);
  const [previewCategory, setPreviewCategory] = useState('Belum dikategorikan');
  const categorySettings = useContext(CategorySettingsContext);
  const suggestCategory = useMemo(() => createCategorySuggester(categorySettings), [categorySettings]);
  const settingsRef = useRef(categorySettings); settingsRef.current = categorySettings;
  const [automaticCategories, setAutomaticCategories] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const readGeneration = useRef(0);
  const reading = useRef(false);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  const dataRef = useRef(data);
  const disabledRef = useRef(disabled);
  const batchRef = useRef('');
  dataRef.current = data;
  disabledRef.current = disabled;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; readGeneration.current += 1; reading.current = false; };
  }, []);

  const controlsDisabled = disabled || busy || saving;
  const wallet = eligibleWallets.find(item => item.id === walletId);
  useEffect(() => {
    if (eligibleWallets.some(item => item.id === walletId)) return;
    resetPreview();
    setBusy(false);
    setWallet(eligibleWallets.find(item => item.name.toLowerCase().includes('ziraat'))?.id ?? eligibleWallets[0]?.id ?? '');
    if (walletId) setError('Dompet tujuan dihapus atau diarsipkan. Pratinjau dibatalkan; pilih dompet aktif yang sesuai lalu baca ulang file.');
  }, [eligibleWallets, walletId]);
  const existingActivity = state.entries.some(entry => entry.walletId === walletId || entry.toWalletId === walletId);
  const currentPreview = useMemo(() => result ? { ...result, rows } : null, [result, rows]);
  const inspection = useMemo(() => walletSnapshot && currentPreview
    ? inspectSourcedImport(data, walletSnapshot, currentPreview, decisions) : null,
  [data, walletSnapshot, currentPreview, decisions]);
  const currentRows = inspection?.rows ?? rows;
  const previewPresentations = useMemo(() => new Map(result?.rows.map(row => [row.id, presentBankDescription(row.originalDescription ?? row.description, row.amount)]) ?? []), [result]);
  const selected = currentRows.filter(row => row.selected && !row.duplicate);
  const rowReview = (row: ImportRow) => entryReviewStatus({ type: row.classification === 'transfer' ? 'unreviewed' : row.classification, category: row.category });
  const selectedReview = reviewCounts(selected.map(row => ({ type: row.classification === 'transfer' ? 'unreviewed' as const : row.classification, category: row.category })));
  const search = previewQuery.trim().toLocaleLowerCase('tr-TR');
  const filteredRows = currentRows.filter(row => {
    const matchesSearch = `${row.description} ${previewPresentations.get(row.id)?.title ?? ''} ${row.date} ${row.reference} ${row.category}`.toLocaleLowerCase('tr-TR').includes(search);
    const matchesView = previewFilter === 'all' || previewFilter === 'new' && !row.duplicate
      || previewFilter === 'pending' && !row.duplicate && rowReview(row).pending
      || previewFilter === 'type-pending' && !row.duplicate && rowReview(row).type
      || previewFilter === 'category-pending' && !row.duplicate && rowReview(row).category
      || previewFilter === 'duplicate' && row.duplicate || previewFilter === 'selected' && row.selected && !row.duplicate;
    return matchesSearch && matchesView;
  });
  const previewPages = Math.max(1, Math.ceil(filteredRows.length / 50));
  const currentPage = Math.min(previewPage, previewPages);
  const visibleRows = filteredRows.slice((currentPage - 1) * 50, currentPage * 50);
  useEffect(() => setPreviewPage(1), [previewQuery, previewFilter, result]);
  const visibleNewRows = visibleRows.filter(row => !row.duplicate);
  const visibleSelected = visibleNewRows.filter(row => row.selected);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const futureCount = selected.filter(row => row.date > today).length;
  const omittedCount = currentRows.filter(row => !row.duplicate && !row.selected).length;
  let projectedBalance: number | null = null;
  let projectedDifference: number | null = null;
  if (result && wallet) {
    try {
      const start = !existingActivity && useOpening ? result.openingBalance : walletBalance(state, wallet.id, data.metadata);
      const projection = selected.reduce((sum, row) => sum + BigInt(row.amount), BigInt(start));
      if (projection <= BigInt(Number.MAX_SAFE_INTEGER) && projection >= BigInt(Number.MIN_SAFE_INTEGER)) projectedBalance = Number(projection);
      const difference = projection - BigInt(result.closingBalance);
      if (difference <= BigInt(Number.MAX_SAFE_INTEGER) && difference >= BigInt(Number.MIN_SAFE_INTEGER)) projectedDifference = Number(difference);
    } catch { /* Domain validation supplies the actionable reason before saving. */ }
  }

  function candidateMovement(entry: Entry): number {
    if (entry.walletId !== walletId) return entry.toAmount ?? 0;
    return entry.type === 'income' || entry.type === 'adjustment' || entry.type === 'unreviewed' || entry.type === 'movement'
      ? entry.amount : -entry.amount - (entry.fee ?? 0);
  }

  function resetPreview() {
    readGeneration.current += 1;
    reading.current = false;
    setResult(null); setRows([]); setAutomaticCategories({}); setWalletSnapshot(null); setDecisions({}); setFilename('');
    setError(''); batchRef.current = '';
    if (inputRef.current) inputRef.current.value = '';
  }

  function updateRow(id: string, changes: Partial<ImportRow>) {
    if (controlsDisabled) return;
    setRows(current => current.map(row => row.id === id ? { ...row, ...changes } : row));
    setError('');
  }

  function resolveOverlap(id: string, resolution: 'skip' | 'distinct') {
    if (controlsDisabled) return;
    const overlap = inspection?.overlaps[id];
    if (!overlap) return;
    setDecisions(current => ({ ...current, [id]: { signature: overlap.signature, resolution } }));
    setRows(current => current.map(row => row.id === id ? { ...row, selected: resolution === 'distinct' } : row));
    setError('');
  }

  function resolveSource(id: string, resolution: SourceResolution) {
    const review = inspection?.sourceReviews[id];
    if (controlsDisabled || !review || !review.allowedResolutions.includes(resolution)) return;
    setDecisions(current => ({ ...current, [id]: { signature: review.signature, resolution } }));
    setRows(current => current.map(row => row.id === id ? { ...row, selected: resolution === 'restore' || resolution === 'distinct' } : row));
    setError('');
  }

  function applyPreviewCategory() {
    if (controlsDisabled) return;
    const ids = new Set(visibleSelected.map(row => row.id));
    if (!ids.size) return;
    setRows(current => current.map(row => ids.has(row.id) ? { ...row, category: previewCategory } : row));
    notify(`Kategori ${ids.size} mutasi yang terlihat diperbarui. Jenis transaksi tetap.`);
  }

  function acceptPreview(parsed: ImportPreview, fileName: string, snapshot: Wallet) {
    if (disabledRef.current || savingRef.current) throw new Error('Penyimpanan belum tersedia. Selesaikan status penyimpanan dahulu.');
    if (snapshot.id !== selectedWalletRef.current) throw new Error('Dompet tujuan berubah. Baca ulang file untuk pilihan terbaru.');
    const latest = dataRef.current;
    const currentWallet = latest.state.wallets.find(item => item.id === snapshot.id);
    if (!currentWallet || isWalletArchived(latest, snapshot.id) || currentWallet.currency !== snapshot.currency) throw new Error('Dompet tujuan berubah. Pilih dompet terbaru dan baca ulang file.');
    setResult(null); setRows([]); setAutomaticCategories({});
    setError(''); setDecisions({}); setPreviewQuery(''); setPreviewFilter('all'); setPreviewPage(1); setPreviewCategory('Belum dikategorikan');
    const checked = inspectSourcedImport(latest, snapshot, parsed);
    if (checked.error) throw new Error(checked.error);
    const automatic: Record<string, string> = {};
    const suggest = createCategorySuggester(settingsRef.current);
    const categorized = checked.rows.map(row => {
      if (row.duplicate || checked.sourceReviews[row.id] || !isUncategorized(row.category)) return row;
      const match = suggest(row.originalDescription ?? row.description, row.classification === 'transfer' ? 'unreviewed' : row.classification, row.amount);
      if (match.kind !== 'auto') return row;
      automatic[row.id] = match.suggestions[0].reason;
      return { ...row, category: match.suggestions[0].category };
    });
    setAutomaticCategories(automatic);
    setWalletSnapshot(snapshot); setResult(parsed); setRows(categorized); setFilename(fileName);
    setUseOpening(!latest.state.entries.some(entry => entry.walletId === snapshot.id || entry.toWalletId === snapshot.id));
    batchRef.current = makeId();
  }
  function changeImportFormat(next: 'ziraat' | 'generic') {
    if (controlsDisabled) return;
    resetPreview(); setImportFormat(next);
    const eligible = state.wallets.filter(item => item.kind !== 'cash' && !isWalletArchived(data, item.id) && (next === 'generic' || item.currency === 'TRY'));
    setWallet(eligible.find(item => item.currency === (next === 'ziraat' ? 'TRY' : preferredCurrency))?.id ?? eligible[0]?.id ?? '');
  }

  async function readFile(file?: File) {
    if (!file || reading.current || savingRef.current || disabledRef.current) return;
    if (demo) { setError('Mulai dengan data sendiri dulu agar mutasi asli tidak tercampur dengan contoh.'); return; }
    if (!wallet) { setError('Pilih dompet tujuan terlebih dahulu.'); return; }
    if (!file.name.toLowerCase().endsWith('.xlsx')) { setError('Untuk versi awal, gunakan file Excel Ziraat berformat .xlsx.'); return; }
    if (file.size > 8 * 1024 * 1024) { setError('Ukuran file maksimal 8 MB.'); return; }
    const generation = ++readGeneration.current;
    const snapshot = { ...wallet };
    reading.current = true;
    setBusy(true); setError(''); setResult(null); setRows([]); setWalletSnapshot(null); setDecisions({});
    setPreviewQuery(''); setPreviewFilter('all'); setPreviewCategory('Belum dikategorikan');
    try {
      const bytes = await file.arrayBuffer();
      if (!mounted.current || generation !== readGeneration.current) return;
      if (disabledRef.current) throw new Error('Penyimpanan belum tersedia. Coba baca file lagi setelah masalah diselesaikan.');
      const latest = dataRef.current;
      const parsed = parseZiraatWorkbook(bytes, snapshot, latest.state.entries);
      acceptPreview(parsed, file.name, snapshot);
    } catch (reason) {
      if (mounted.current && generation === readGeneration.current) setError(reason instanceof Error ? reason.message : 'File belum bisa dibaca. Coba ekspor ulang file Excel dari bank.');
    } finally {
      if (mounted.current && generation === readGeneration.current) {
        reading.current = false; setBusy(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    }
  }

  async function confirmImport(captureOnly = false) {
    if (controlsDisabled || savingRef.current || !result || !walletSnapshot || !selected.length && !captureOnly) return;
    if (walletId !== walletSnapshot.id) { setError('Dompet tujuan berubah. Baca ulang file untuk dompet yang dipilih.'); return; }
    const request = structuredClone({ walletSnapshot, preview: { ...result, rows: captureOnly ? rows.map(row => ({ ...row, selected: false })) : rows }, decisions, useOpening: captureOnly ? false : useOpening, batchId: batchRef.current });
    const prepared = prepareSourcedImport(dataRef.current, request.walletSnapshot, request.preview, request.decisions, request.useOpening, request.batchId, new Date().toISOString());
    if (prepared.status !== 'ready') {
      setRows(prepared.inspection.rows);
      setError(prepared.status === 'invalid' ? prepared.message
        : 'Catatan atau pilihan impor perlu ditinjau kembali. Bandingkan kandidat manual dan pilih Lewati atau Transaksi berbeda.');
      return;
    }
    savingRef.current = true; setSaving(true); setError('');
    try {
      const saved = await onImport(prepared.state, prepared.data, request.walletSnapshot.id);
      if (!mounted.current) return;
      if (saved) {
        resetPreview();
        notify(captureOnly ? 'Fakta file tersimpan tanpa menambahkan transaksi. Periksa kelengkapan untuk menyiapkan backfill atau batas saldo awal.' : `${prepared.entries.length} transaksi tersimpan. Jenis atau kategori yang belum jelas masuk daftar “Perlu dirapikan”.`);
      } else setError('Impor belum tersimpan. Pratinjau dan pilihan tetap tersedia. Periksa status penyimpanan sebelum mencoba lagi.');
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'Impor belum tersimpan. Pratinjau dipertahankan.');
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return <>
    {demo && <div className="notice warning"><CircleHelp size={19} /><div>Mode contoh masih aktif. Mulai dengan data sendiri sebelum mengimpor mutasi asli.</div><button className="button secondary small" disabled={controlsDisabled} onClick={onStart}>Mulai dari kosong</button></div>}
    <div className="import-format-picker" role="group" aria-label="Format impor"><button className={`button ${importFormat === 'ziraat' ? 'primary' : 'secondary'}`} aria-pressed={importFormat === 'ziraat'} disabled={controlsDisabled} onClick={() => changeImportFormat('ziraat')}>Ziraat TRY · otomatis</button><button className={`button ${importFormat === 'generic' ? 'primary' : 'secondary'}`} aria-pressed={importFormat === 'generic'} disabled={controlsDisabled} onClick={() => changeImportFormat('generic')}>CSV / Excel umum</button></div><p className="field-help">Mengganti format atau dompet membatalkan pratinjau yang belum disimpan.</p><div className="import-layout"><section className="panel import-main"><div className="panel-header"><div><h2>Mutasi masuk, catatan beres.</h2><p>Satu unggahan untuk banyak transaksi.</p></div><span className="badge neutral">{importFormat === 'ziraat' ? 'Ziraat · TRY · Excel' : 'CSV / Excel · pemetaan kolom'}</span></div>
      <label className="field"><span className="field-label">Simpan ke dompet</span><select aria-label="Dompet impor" className="select-input" value={walletId} disabled={controlsDisabled || !eligibleWallets.length} onChange={event => { resetPreview(); setWallet(event.target.value); }}>{!eligibleWallets.length && <option value="">Belum ada dompet {importFormat === 'ziraat' ? 'TRY ' : ''}aktif</option>}{eligibleWallets.map(item => <option key={item.id} value={item.id}>{item.name} · {item.currency}</option>)}</select></label>
      {!wallet && <div className="notice warning">Belum ada dompet {importFormat === 'ziraat' ? 'TRY ' : ''}aktif untuk format ini. Tambahkan dompet atau pulihkan dari Arsip.{onAddWallet && <button type="button" className="button secondary small" onClick={() => onAddWallet(importFormat === 'ziraat' ? 'TRY' : preferredCurrency)}>{importFormat === 'ziraat' ? 'Tambah dompet TRY' : 'Tambah dompet'}</button>}</div>}
      {importFormat === 'generic' && wallet && <GenericImportMapper key={`${wallet.id}:${wallet.currency}`} wallet={wallet} entries={state.entries} disabled={controlsDisabled || demo} onPreview={acceptPreview} onInvalidate={resetPreview} />}
      {importFormat === 'ziraat' && <><div className={`import-dropzone ${busy ? 'busy' : ''}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!controlsDisabled) void readFile(event.dataTransfer.files[0]); }}>
        <span className="import-file-icon"><FileSpreadsheet size={30} /></span><h3>{busy ? 'Membaca mutasi…' : saving ? 'Menyimpan mutasi…' : 'Taruh file Excel di sini'}</h3><p>atau pilih file dari perangkatmu</p><button className="button primary" disabled={controlsDisabled || demo || !wallet} onClick={() => inputRef.current?.click()}><FolderOpen size={17} /> Pilih file .xlsx</button><span className="field-help">Ekspor mutasi Ziraat · maksimal 8 MB</span>
        <input ref={inputRef} aria-label="File mutasi Ziraat" type="file" accept=".xlsx" hidden disabled={controlsDisabled || demo} onChange={event => void readFile(event.target.files?.[0])} />
      </div></>}<p className="privacy-note"><ShieldCheck size={16} /> File dibaca di browser. Tidak dikirim ke server.</p>
    </section><aside className="panel import-info"><span className="eyebrow">CARA KERJANYA</span><h3>Lebih sedikit ketik.<br />Lebih banyak waktu.</h3><div className="import-steps">{[['Pilih dompet', 'Pastikan rekening dan mata uangnya sesuai.'], ['Cek hasil bacaan', 'Bandingkan juga mutasi yang mungkin dicatat manual.'], ['Simpan, rapikan nanti', 'Transaksi yang belum jelas tetap tercatat.']].map(([title, text], index) => <div className="import-step" key={title}><span>{index + 1}</span><div><strong>{title}</strong><p>{text}</p></div></div>)}</div><div className="notice"><Leaf size={19} /><span>{importFormat === 'ziraat' ? 'Pembacaan otomatis khusus format Excel Ziraat TRY. Untuk mata uang atau bank lain, pilih CSV / Excel umum.' : 'Petakan kolom sesuai file. Tanggal, keterangan, nominal dan saldo setelah transaksi diperlukan; satu file untuk satu rekening dan mata uang.'}</span></div></aside></div>
    {(error || inspection?.error) && <div className="notice error" role="alert">{error || inspection?.error}</div>}
    {result && wallet && <section className="panel import-preview" aria-busy={saving}><div className="panel-header"><div><h2>Periksa sebelum disimpan</h2><p>{filename} · {formatDate(result.period.start)} – {formatDate(result.period.end)}</p></div><span className="badge neutral">{currentRows.length} transaksi</span></div>
      <div className="import-summary"><span><strong>{selected.length}</strong> dipilih</span><span><strong>{currentRows.filter(row => row.duplicate).length}</strong> sudah pernah diimpor</span><span><strong data-testid="import-review-total" data-count={selectedReview.total}>{selectedReview.total}</strong> perlu dirapikan</span><span><strong data-testid="import-review-types" data-count={selectedReview.type}>{selectedReview.type}</strong> jenis perlu dicek</span><span><strong data-testid="import-review-categories" data-count={selectedReview.category}>{selectedReview.category}</strong> kategori belum diisi</span></div>
      <p className="field-help">Jumlah perlu dirapikan pada mutasi yang dipilih menghitung setiap mutasi sekali, walaupun jenis dan kategorinya sama-sama belum jelas. Kategori umum menjelaskan cara pembayaran, bukan selalu barang yang dibeli.</p>
      {result.warnings.filter(warning => !warning.includes('transaksi disimpan sebagai Perlu ditinjau')).map((warning, index) => <div key={index} className="notice warning">{warning}</div>)}
      {selectedReview.type > 0 && <div className="notice warning">{selectedReview.type} jenis transaksi yang dipilih belum dikonfirmasi. Nominal tetap dicatat agar saldo rekening utuh; pilih jenisnya bila sudah jelas.</div>}
      {inspection?.needsReview && <div className="notice warning" role="status">Ada perubahan atau kandidat transaksi manual. Kesamaan tanggal dan nominal belum membuktikan duplikasi; tinjau pilihan di setiap baris terkait.</div>}
      {futureCount > 0 && <div className="notice warning">{futureCount} transaksi terpilih bertanggal masa depan. Catatan tersebut memengaruhi saldo seluruh catatan, dan masuk saldo aktual ketika tanggalnya tiba.</div>}
      {omittedCount > 0 && <div className="notice warning">{omittedCount} mutasi baru dilewati. Impor sebagian dapat menghasilkan saldo berbeda dari bank. Aslinya disimpan sebagai fakta sumber; periksa kelengkapan dan pelengkapan histori setelah impor.</div>}
      {!existingActivity && <label className="checkbox-row opening-checkbox"><input type="checkbox" checked={useOpening} disabled={controlsDisabled} onChange={event => setUseOpening(event.target.checked)} /><span>Gunakan saldo sebelum transaksi pertama: <strong>{formatMoney(result.openingBalance, wallet.currency)}</strong><small className="field-help">Menggantikan saldo awal dompet ini. Saldo akhir pada file: {formatMoney(result.closingBalance, wallet.currency)}.</small></span></label>}
      <div className="notice"><div>Proyeksi saldo seluruh catatan setelah impor: <strong>{projectedBalance === null ? 'Belum dapat dihitung' : formatMoney(projectedBalance, wallet.currency)}</strong>.<br />Saldo akhir statement: <strong>{formatMoney(result.closingBalance, wallet.currency)}</strong>.
        {projectedDifference !== null && <span> Selisih: <strong>{formatMoney(projectedDifference, wallet.currency)}</strong>.</span>}
        <small className="field-help">Proyeksi mencakup seluruh catatan dompet, termasuk transaksi di luar periode file. Kesamaan saldo saja belum membuktikan histori lengkap.</small></div></div>
      <div className="import-filter-bar"><label className="search-input"><Search size={17} /><input aria-label="Cari mutasi" placeholder="Cari keterangan, tanggal, atau kategori…" value={previewQuery} disabled={controlsDisabled} onChange={event => setPreviewQuery(event.target.value)} /></label>
        <select className="select-input" aria-label="Tampilkan mutasi" value={previewFilter} disabled={controlsDisabled} onChange={event => setPreviewFilter(event.target.value)}><option value="all">Semua mutasi</option><option value="new">Mutasi baru</option><option value="pending">Perlu dirapikan</option><option value="type-pending">Jenis perlu dicek</option><option value="category-pending">Kategori belum diisi</option><option value="duplicate">Sudah diimpor</option><option value="selected">Yang dipilih</option></select><span className="import-filter-count">{visibleRows.length} terlihat · {selected.length} dipilih total</span></div>
      <p className="field-help category-import-summary" role="status">{Object.keys(automaticCategories).length} kategori diisi aturan saat file dibaca. Yang ambigu ditawarkan sebagai saran; pilihan manual tetap dipakai. Tarik ATM menjadi pengeluaran, setor ATM menjadi pemasukan, dan transfer bank tetap perpindahan dana rekening. PREPAID masuk menjadi pemasukan Cashback; refund masalah ATM yang jelas menjadi Pengembalian dana. Belanja pada pembayaran kartu adalah kategori umum, bukan tebakan barang yang dibeli.</p>
      <div className="import-bulk-category"><label className="field"><span className="field-label">Kategori untuk pilihan yang terlihat</span><select className="select-input" aria-label="Kategori mutasi terpilih" value={previewCategory} disabled={controlsDisabled} onChange={event => setPreviewCategory(event.target.value)}>{categoryChoices(categorySettings, previewCategory).map(name => <option key={name}>{name}</option>)}</select></label><button className="button secondary" disabled={controlsDisabled || !visibleSelected.length} onClick={applyPreviewCategory}><Tags size={16} /> Terapkan kategori ke {visibleSelected.length} mutasi</button></div>
      <div className="table-wrap"><table className="transactions-table import-table"><thead><tr><th><input type="checkbox" aria-label="Pilih semua transaksi baru" title="Pilih atau batalkan hanya mutasi baru yang terlihat" disabled={controlsDisabled || !visibleNewRows.length} checked={visibleNewRows.length > 0 && visibleNewRows.every(row => row.selected)} ref={input => { if (input) input.indeterminate = visibleSelected.length > 0 && visibleSelected.length < visibleNewRows.length; }} onChange={event => { const ids = new Set(visibleNewRows.map(row => row.id)); const checked = event.target.checked; setRows(current => current.map(row => ids.has(row.id) ? { ...row, selected: checked } : row)); }} /></th><th>Transaksi</th><th>Nominal</th><th>Jenis</th><th>Kategori</th></tr></thead>
        <tbody>{visibleRows.map(row => {
          const view = previewPresentations.get(row.id) ?? presentBankDescription(row.originalDescription ?? row.description, row.amount);
          const bank = view.bank;
          const match = suggestCategory(row.originalDescription ?? row.description, row.classification === 'transfer' ? 'unreviewed' : row.classification, row.amount);
          const overlap = inspection?.overlaps[row.id];
          const sourceReview = inspection?.sourceReviews[row.id];
          const decision = decisions[row.id];
          const chosen = overlap && decision?.signature === overlap.signature ? decision.resolution : undefined;
          return <tr key={row.id} className={row.duplicate ? 'duplicate-row' : ''}>
            <td><input type="checkbox" aria-label={`Pilih transaksi ${formatDate(row.date)} ${row.id}`} checked={row.selected} disabled={controlsDisabled || row.duplicate} onChange={event => updateRow(row.id, { selected: event.target.checked })} /></td>
            <td><span className="transaction-title">{view.title}</span>{view.title !== view.description && <details className="bank-wording"><summary>Keterangan bank asli</summary><p>{view.description}</p></details>}<span className="transaction-note">{formatDate(row.date)}{row.duplicate ? ' · Sudah diimpor' : row.date > today ? ' · Masa depan' : ''}</span>{row.warning && (row.duplicate || rowReview(row).type) && <span className="import-row-warning">{row.warning}</span>}{bank.kind !== 'none' && <span className="field-help bank-operation-hint" data-bank-operation={bank.kind}>{bank.label}. {bank.warning}</span>}
              {sourceReview && <div className="import-overlap"><p className="import-row-warning">{sourceReview.message}</p><div role="group" aria-label={`Keputusan sumber ${row.id}`}>{sourceReview.allowedResolutions.map(resolution => <button key={resolution} type="button" className="button secondary small" aria-pressed={decisions[row.id]?.signature === sourceReview.signature && decisions[row.id]?.resolution === resolution} disabled={controlsDisabled} onClick={() => resolveSource(row.id, resolution)}>{resolution === 'restore' ? 'Pulihkan fakta bank' : resolution === 'distinct' ? 'Transaksi berbeda' : 'Pertahankan catatan'}</button>)}</div></div>}
              {overlap && <div className="import-overlap"><p className="import-row-warning">{overlap.candidates.length ? 'Mungkin sudah dicatat manual:' : 'Kandidat manual sebelumnya berubah atau sudah tidak ada. Tinjau ulang keputusan.'}</p>
                {overlap.candidates.map(candidate => <p className="field-help" key={candidate.id}>{formatDate(candidate.date)} · {candidate.note || 'Tanpa keterangan'} · {candidate.type === 'transfer' ? 'Transfer' : candidate.type === 'expense' ? 'Pengeluaran' : candidate.type === 'income' ? 'Pemasukan' : 'Catatan'} · {formatMoney(candidateMovement(candidate), wallet.currency)}</p>)}
                <div role="group" aria-label={`Keputusan mutasi ${row.id}`}><button type="button" className="button secondary small" aria-pressed={chosen === 'skip'} disabled={controlsDisabled} onClick={() => resolveOverlap(row.id, 'skip')}>Lewati</button>{' '}<button type="button" className="button secondary small" aria-pressed={chosen === 'distinct'} disabled={controlsDisabled} onClick={() => resolveOverlap(row.id, 'distinct')}>Transaksi berbeda</button></div>
              </div>}
            </td>
            <td className={row.amount > 0 ? 'amount-positive' : 'amount-negative'}>{row.amount > 0 ? '+' : '−'}{formatMoney(Math.abs(row.amount), wallet.currency)}</td>
            <td><select className="select-input compact" aria-label={`Jenis transaksi ${row.id}`} disabled={controlsDisabled || row.duplicate} value={row.classification} onChange={event => updateRow(row.id, { classification: event.target.value as ImportRow['classification'] })}><option value="unreviewed">Perlu dicek</option><option value="movement">Perpindahan dana rekening</option>{row.amount > 0 ? <option value="income">Pemasukan</option> : <option value="expense">Pengeluaran</option>}</select></td>
            <td><select className="select-input compact import-row-category" aria-label={`Kategori mutasi ${row.id}`} disabled={controlsDisabled || row.duplicate} value={row.category} onChange={event => updateRow(row.id, { category: event.target.value })}>{categoryChoices(categorySettings, row.category).map(name => <option key={name}>{name}</option>)}</select>
              {automaticCategories[row.id] && <span className="field-help">Aturan saat dibaca: {automaticCategories[row.id]}. Pilihan tetap bisa diubah.</span>}
              {!row.duplicate && !sourceReview && isUncategorized(row.category) && match.suggestions.length > 0 && <div className="category-row-suggestions"><span className="field-help">Saran (jenis tetap):</span>{match.suggestions.map(suggestion => <button key={suggestion.category} type="button" className="button secondary small" title={suggestion.reason} disabled={controlsDisabled} onClick={() => updateRow(row.id, { category: suggestion.category })}>{suggestion.category}</button>)}</div>}
            </td>
          </tr>;
        })}</tbody></table></div>
      {!visibleRows.length && <div className="empty-state compact"><Search size={24} /><p>Tidak ada mutasi yang cocok dengan pencarian atau filter ini.</p></div>}
      <div className="import-actions" aria-label="Halaman pratinjau"><span>Halaman {currentPage} dari {previewPages} · {filteredRows.length} hasil</span><div><button className="button secondary small" disabled={controlsDisabled || currentPage <= 1} onClick={() => setPreviewPage(currentPage - 1)}>Mutasi sebelumnya</button>{' '}<button className="button secondary small" disabled={controlsDisabled || currentPage >= previewPages} onClick={() => setPreviewPage(currentPage + 1)}>Mutasi berikutnya</button></div></div>
      <p className="field-help">Pilih semua dan kategori massal berlaku untuk baris pada halaman yang terlihat. Tombol Simpan menyertakan semua {selected.length} mutasi yang dipilih, termasuk pada halaman lain atau yang tersembunyi oleh filter.</p>
      <p className="field-help">Untuk histori sebelum batas catatan, simpan fakta file saja lalu periksa pelengkapan di atas. Langkah ini mempertahankan fakta bank tanpa menambahkan transaksi atau mengganti saldo awal.</p>
      <div className="import-actions"><p>Perpindahan dana rekening tidak dihitung sebagai belanja atau pemasukan; cash tidak dibukukan.</p><div><button className="button secondary" disabled={controlsDisabled} onClick={resetPreview}>Batalkan pratinjau</button>{' '}<button className="button secondary" disabled={controlsDisabled || !!inspection?.error} onClick={() => void confirmImport(true)}>Simpan fakta file saja</button>{' '}<button className="button primary" disabled={controlsDisabled || !selected.length || !!inspection?.error} onClick={() => void confirmImport()}><CheckCheck size={18} /> {saving ? 'Menyimpan…' : `Simpan ${selected.length} transaksi`}</button></div></div>
    </section>}
  </>;
}
