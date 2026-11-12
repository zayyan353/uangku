import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCheck, CheckCircle2, FileSpreadsheet, FolderOpen, Leaf, Search, ShieldCheck, Tags, X } from 'lucide-react';
import { formatDate, formatMoney, makeId, walletBalance, type Currency, type Entry, type State, type Wallet } from '../lib/finance';
import { parseZiraatWorkbook, type ImportPreview, type ImportRow } from '../lib/importer';
import { parseJagoStatement } from '../lib/jagoStatement';
import { inspectSourcedImport, prepareSourcedImport, type SourcedImportDecisions, type SourceResolution } from '../lib/sourceCommands';
import type { StoredData } from '../lib/storage';
import { CategorySettingsContext } from '../hooks/useCategorySettings';
import { categoryChoices, isUncategorized } from '../lib/categorySettings';
import { createCategorySuggester } from '../lib/categorySuggestions';
import { presentBankDescription } from '../lib/bankEntryHints';
import { entryReviewStatus, reviewCounts } from '../lib/reviewStatus';
import { isWalletArchived } from '../lib/walletLifecycle';
import GenericImportMapper from './GenericImportMapper';
import { deviceDay } from '../lib/today';

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
  /** After a saved import: open the review queue, or the history of the wallet that was imported into. */
  onOpenReview?: () => void;
  onOpenHistory?: (walletId: string) => void;
}

/** The opening sentence of a longer message, for a one-line summary; the full text is shown on demand. */
function firstSentence(text: string): string {
  const end = text.indexOf('. ');
  return end > 0 && end < text.length - 2 ? text.slice(0, end + 1) : text;
}

type ImportFormat = 'ziraat' | 'jago' | 'generic';
/** Banks read without column mapping: one currency, one file type, the bank's own wording. */
const BANK_FORMATS = {
  ziraat: { currency: 'TRY', walletHint: 'ziraat', extension: '.xlsx', badge: 'Ziraat · TRY · Excel', fileKind: 'Excel', fileLabel: 'File mutasi Ziraat',
    help: 'Ekspor mutasi Ziraat · maksimal 8 MB', wrongFile: 'Format ini hanya membaca ekspor Excel Ziraat (.xlsx). Untuk CSV atau file bank lain, pilih “CSV / Excel umum”.',
    notice: 'Pembacaan otomatis khusus format Excel Ziraat TRY. Untuk mata uang atau bank lain, pilih CSV / Excel umum.',
    rules: 'Tarik ATM menjadi pengeluaran, setor ATM menjadi pemasukan, dan transfer bank tetap perpindahan dana. PREPAID masuk menjadi pemasukan Cashback; refund masalah ATM yang jelas menjadi Pengembalian dana. Belanja pada pembayaran kartu adalah kategori umum, bukan tebakan barang yang dibeli.' },
  jago: { currency: 'IDR', walletHint: 'jago', extension: '.pdf', badge: 'Bank Jago · IDR · PDF', fileKind: 'PDF', fileLabel: 'File mutasi Bank Jago',
    help: 'PDF “Riwayat Transaksi” satu Kantong dari aplikasi Jago · maksimal 8 MB', wrongFile: 'Format ini hanya membaca PDF riwayat transaksi Bank Jago (.pdf). Untuk file bank lain, pilih format lain.',
    notice: 'Pembacaan otomatis khusus PDF riwayat transaksi Bank Jago (IDR), satu Kantong per file. Unduh tanpa filter agar saldo antarbaris bisa diperiksa.',
    rules: 'Pindah uang antar Kantong, transfer dari/ke rekening atas nama pemilik (nama di bagian atas PDF), dan isi saldo e-wallet tetap perpindahan dana. Transfer ke orang lain menjadi pengeluaran dan transfer dari orang lain menjadi pemasukan; uang masuk dari e-wallet atau marketplace, serta nama yang disamarkan bank, tetap Perlu dicek. Pembayaran Jago Pay dan transaksi kartu (POS) menjadi pengeluaran; GO-FOOD masuk Makan & minum. Transaksi kartu yang dikembalikan dengan ID dan nominal sama menjadi Pengembalian dana, dan bonus bank menjadi Cashback. Jenis lain tetap Perlu dicek.' },
} as const satisfies Record<Exclude<ImportFormat, 'generic'>, Record<string, string>>;
const formatCurrency = (format: ImportFormat, fallback: Currency): Currency => format === 'generic' ? fallback : BANK_FORMATS[format].currency;
const preferredWallet = (wallets: readonly Wallet[], format: ImportFormat): Wallet | undefined =>
  (format === 'generic' ? undefined : wallets.find(wallet => wallet.name.toLowerCase().includes(BANK_FORMATS[format].walletHint))) ?? wallets[0];

/** New local orchestration around the exactly recovered importCommit module. */
export default function RecoveryImportView({ data, state, demo, onStart, onImport, notify, disabled = false, onAddWallet, preferredCurrency = 'TRY', onOpenReview, onOpenHistory }: RecoveryImportViewProps) {
  // The Ziraat reader needs a TRY wallet. Without one, start on the general format instead of a dead end.
  const [importFormat, setImportFormat] = useState<ImportFormat>(() => {
    const usable = state.wallets.filter(wallet => wallet.kind !== 'cash' && !isWalletArchived(data, wallet.id));
    return usable.length > 0 && !usable.some(wallet => wallet.currency === 'TRY') ? 'generic' : 'ziraat';
  });
  const [dragging, setDragging] = useState(false);
  const [lastImport, setLastImport] = useState<{ count: number; pending: number; walletId: string; walletName: string; captureOnly: boolean } | null>(null);
  const previewRef = useRef<HTMLElement>(null);
  const bankFormat = importFormat === 'generic' ? undefined : BANK_FORMATS[importFormat];
  const eligibleWallets = useMemo(() => state.wallets.filter(wallet => (importFormat === 'generic' || wallet.currency === BANK_FORMATS[importFormat].currency) && wallet.kind !== 'cash' && !isWalletArchived(data, wallet.id)), [state.wallets, data.metadata, importFormat]);
  const [walletId, setWallet] = useState(() => preferredWallet(eligibleWallets, importFormat)?.id ?? '');
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

  // The preview opens below the upload area, often outside the screen; bring it into view once per file.
  useEffect(() => { if (result) previewRef.current?.scrollIntoView({ block: 'start' }); }, [result]);
  const controlsDisabled = disabled || busy || saving;
  const wallet = eligibleWallets.find(item => item.id === walletId);
  useEffect(() => {
    if (eligibleWallets.some(item => item.id === walletId)) return;
    resetPreview();
    setBusy(false);
    setWallet(preferredWallet(eligibleWallets, importFormat)?.id ?? '');
    if (walletId) setError('Dompet tujuan dihapus atau diarsipkan. Pratinjau dibatalkan; pilih dompet aktif yang sesuai lalu baca ulang file.');
  }, [eligibleWallets, walletId]);
  const existingActivity = state.entries.some(entry => entry.walletId === walletId || entry.toWalletId === walletId);
  const currentPreview = useMemo(() => result ? { ...result, rows } : null, [result, rows]);
  const inspection = useMemo(() => walletSnapshot && currentPreview
    ? inspectSourcedImport(data, walletSnapshot, currentPreview, decisions) : null,
  [data, walletSnapshot, currentPreview, decisions]);
  const currentRows = inspection?.rows ?? rows;
  const previewPresentations = useMemo(() => new Map(result?.rows.map(row => [row.id, presentBankDescription(row.originalDescription ?? row.description, row.amount, row.fingerprintVersion)]) ?? []), [result]);
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
  const today = deviceDay();
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

  // One short line per thing to look at; the explanation opens on demand so the table stays close to the header.
  const previewNotes: Array<{ key: string; summary: string; detail: string; info?: boolean; live?: boolean }> = !result ? [] : [
    ...result.warnings.filter(warning => !warning.includes('transaksi disimpan sebagai Perlu ditinjau')).map((warning, index) => ({ key: `file-${index}`, summary: firstSentence(warning), detail: warning })),
    ...(selectedReview.type > 0 ? [{ key: 'type', summary: `${selectedReview.type} jenis transaksi yang dipilih belum dikonfirmasi.`, detail: 'Nominal tetap dicatat agar saldo rekening utuh; pilih jenisnya di kolom Jenis bila sudah jelas, atau rapikan nanti dari Transaksi.' }] : []),
    ...(inspection?.needsReview ? [{ key: 'manual', live: true, summary: 'Ada perubahan atau kandidat transaksi manual.', detail: 'Kesamaan tanggal dan nominal belum membuktikan duplikasi; tinjau pilihan di setiap baris terkait.' }] : []),
    ...(futureCount > 0 ? [{ key: 'future', summary: `${futureCount} transaksi terpilih bertanggal masa depan.`, detail: 'Catatan tersebut memengaruhi saldo seluruh catatan, dan masuk saldo aktual ketika tanggalnya tiba.' }] : []),
    ...(omittedCount > 0 ? [{ key: 'omitted', summary: `${omittedCount} mutasi baru dilewati.`, detail: 'Impor sebagian dapat menghasilkan saldo berbeda dari bank. Aslinya tetap disimpan sebagai isi file; periksa kelengkapan mutasi setelah impor.' }] : []),
    { key: 'count', info: true, summary: 'Cara membaca angka di atas', detail: 'Jumlah perlu dirapikan menghitung setiap mutasi yang dipilih sekali, walaupun jenis dan kategorinya sama-sama belum jelas. Kategori umum menjelaskan cara pembayaran, bukan selalu barang yang dibeli.' },
  ];
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

  /** Bulk type for the visible selection: only rows still marked "Perlu dicek" change; money in becomes income, money out expense. */
  const visibleUntyped = visibleSelected.filter(row => row.classification === 'unreviewed');
  function applyPreviewTypes() {
    if (controlsDisabled || !visibleUntyped.length) return;
    const ids = new Set(visibleUntyped.map(row => row.id));
    setRows(current => current.map(row => ids.has(row.id) ? { ...row, classification: row.amount > 0 ? 'income' : 'expense' } : row));
    setError('');
    notify(`Jenis ${ids.size} mutasi yang terlihat ditandai: masuk = pemasukan, keluar = pengeluaran. Nominal dan tanggal tetap.`);
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
      const match = suggest(row.originalDescription ?? row.description, row.classification === 'transfer' ? 'unreviewed' : row.classification, row.amount, row.fingerprintVersion);
      if (match.kind !== 'auto') return row;
      automatic[row.id] = match.suggestions[0].reason;
      return { ...row, category: match.suggestions[0].category };
    });
    setAutomaticCategories(automatic);
    setWalletSnapshot(snapshot); setResult(parsed); setRows(categorized); setFilename(fileName); setLastImport(null);
    setUseOpening(!latest.state.entries.some(entry => entry.walletId === snapshot.id || entry.toWalletId === snapshot.id));
    batchRef.current = makeId();
  }
  function changeImportFormat(next: ImportFormat) {
    if (controlsDisabled) return;
    resetPreview(); setImportFormat(next);
    const eligible = state.wallets.filter(item => item.kind !== 'cash' && !isWalletArchived(data, item.id) && (next === 'generic' || item.currency === BANK_FORMATS[next].currency));
    setWallet((next === 'generic' ? eligible.find(item => item.currency === preferredCurrency) ?? eligible[0] : preferredWallet(eligible, next))?.id ?? '');
  }

  async function readFile(file?: File) {
    if (!file || reading.current || savingRef.current || disabledRef.current) return;
    if (demo) { setError('Mulai dengan data sendiri dulu agar mutasi asli tidak tercampur dengan contoh.'); return; }
    if (!wallet) { setError('Pilih dompet tujuan terlebih dahulu.'); return; }
    if (!bankFormat) return;
    if (!file.name.toLowerCase().endsWith(bankFormat.extension)) { setError(bankFormat.wrongFile); return; }
    if (file.size > 8 * 1024 * 1024) { setError('Ukuran file maksimal 8 MB. Ekspor periode yang lebih pendek lalu coba lagi.'); return; }
    const generation = ++readGeneration.current;
    const snapshot = { ...wallet };
    const format = importFormat;
    reading.current = true;
    setBusy(true); setError(''); setResult(null); setRows([]); setWalletSnapshot(null); setDecisions({});
    setPreviewQuery(''); setPreviewFilter('all'); setPreviewCategory('Belum dikategorikan');
    try {
      const bytes = await file.arrayBuffer();
      if (!mounted.current || generation !== readGeneration.current) return;
      if (disabledRef.current) throw new Error('Penyimpanan belum tersedia. Coba baca file lagi setelah masalah diselesaikan.');
      const latest = dataRef.current;
      const parsed = format === 'jago' ? parseJagoStatement(bytes, snapshot, latest.state.entries) : parseZiraatWorkbook(bytes, snapshot, latest.state.entries);
      acceptPreview(parsed, file.name, snapshot);
    } catch (reason) {
      if (mounted.current && generation === readGeneration.current) setError(reason instanceof Error ? reason.message : `File belum bisa dibaca. Coba ekspor ulang file ${format === 'jago' ? 'PDF' : 'Excel'} dari bank.`);
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
        setLastImport({ count: prepared.entries.length, pending: reviewCounts(prepared.entries).total, walletId: request.walletSnapshot.id, walletName: request.walletSnapshot.name, captureOnly });
        notify(captureOnly ? 'Isi file tersimpan tanpa menambahkan transaksi. Lihat “Periksa kelengkapan mutasi” di bawah untuk melengkapinya.' : `${prepared.entries.length} transaksi tersimpan. Jenis atau kategori yang belum jelas masuk daftar “Perlu dirapikan”.`);
      } else setError('Impor belum tersimpan. Pratinjau dan pilihan tetap tersedia. Periksa status penyimpanan sebelum mencoba lagi.');
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'Impor belum tersimpan. Pratinjau dipertahankan.');
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return <>
    <div className="import-format-picker tab-group" role="group" aria-label="Format impor"><button className={importFormat === 'ziraat' ? 'active' : ''} aria-pressed={importFormat === 'ziraat'} disabled={controlsDisabled} onClick={() => changeImportFormat('ziraat')}>Ziraat TRY · otomatis</button><button className={importFormat === 'jago' ? 'active' : ''} aria-pressed={importFormat === 'jago'} disabled={controlsDisabled} onClick={() => changeImportFormat('jago')}>Bank Jago PDF · otomatis</button><button className={importFormat === 'generic' ? 'active' : ''} aria-pressed={importFormat === 'generic'} disabled={controlsDisabled} onClick={() => changeImportFormat('generic')}>CSV / Excel umum</button></div>{result && <p className="field-help" data-testid="format-change-warning">Mengganti format atau dompet membatalkan pratinjau yang belum disimpan.</p>}
    {lastImport && <section className="panel import-result" role="status" data-testid="import-result"><CheckCircle2 size={22} aria-hidden="true" /><div className="import-result-copy"><strong>{lastImport.captureOnly ? `Isi file tersimpan untuk ${lastImport.walletName}, tanpa menambah transaksi.` : `${lastImport.count} transaksi tersimpan ke ${lastImport.walletName}.`}</strong><span>{lastImport.captureOnly ? 'Catatan dan saldo tidak berubah. Lengkapi dari “Periksa kelengkapan mutasi” di bawah bila diperlukan.' : lastImport.pending > 0 ? `${lastImport.pending} di antaranya masih perlu dirapikan: jenis atau kategorinya belum jelas. Saldonya sudah tercatat.` : 'Semua sudah punya jenis dan kategori.'}</span></div><div className="import-result-actions">{!lastImport.captureOnly && lastImport.pending > 0 && onOpenReview && <button className="button primary small" onClick={onOpenReview}>Rapikan {lastImport.pending} catatan <ArrowRight size={15} /></button>}{!lastImport.captureOnly && onOpenHistory && <button className="button secondary small" onClick={() => onOpenHistory(lastImport.walletId)}>Lihat transaksi</button>}<button className="icon-button" aria-label="Tutup ringkasan impor" onClick={() => setLastImport(null)}><X size={16} /></button></div></section>}
    <div className={`import-layout${result ? ' has-preview' : ''}`}><section className="panel import-main"><div className="panel-header"><div><h2>Mutasi masuk, catatan beres.</h2><p>Satu unggahan untuk banyak transaksi.</p></div><span className="badge neutral">{bankFormat ? bankFormat.badge : 'CSV / Excel · pemetaan kolom'}</span></div>
      <label className="field"><span className="field-label">Simpan ke dompet</span><select aria-label="Dompet impor" className="select-input" value={walletId} disabled={controlsDisabled || !eligibleWallets.length} onChange={event => { resetPreview(); setWallet(event.target.value); }}>{!eligibleWallets.length && <option value="">Belum ada dompet {bankFormat ? `${bankFormat.currency} ` : ''}aktif</option>}{eligibleWallets.map(item => <option key={item.id} value={item.id}>{item.name} · {item.currency}</option>)}</select></label>
      {!wallet && <div className="notice warning">Belum ada dompet {bankFormat ? `${bankFormat.currency} ` : ''}aktif untuk format ini. Tambahkan dompet atau pulihkan dari Arsip.{onAddWallet && <button type="button" className="button secondary small" onClick={() => onAddWallet(formatCurrency(importFormat, preferredCurrency))}>{bankFormat ? `Tambah dompet ${bankFormat.currency}` : 'Tambah dompet'}</button>}</div>}
      {importFormat === 'generic' && wallet && <GenericImportMapper key={`${wallet.id}:${wallet.currency}`} wallet={wallet} entries={state.entries} disabled={controlsDisabled || demo} hasPreview={!!result} onPreview={acceptPreview} onInvalidate={resetPreview} />}
      {bankFormat && <><div className={`import-dropzone ${busy ? 'busy' : ''}${dragging ? ' dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!controlsDisabled && !demo) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!controlsDisabled) void readFile(event.dataTransfer.files[0]); }}>
        <span className="import-file-icon"><FileSpreadsheet size={30} /></span><h3>{busy ? 'Membaca mutasi…' : saving ? 'Menyimpan mutasi…' : `Taruh file ${bankFormat.fileKind} di sini`}</h3><p>atau pilih file dari perangkatmu</p><button className="button primary" disabled={controlsDisabled || demo || !wallet} onClick={() => inputRef.current?.click()}><FolderOpen size={17} /> Pilih file {bankFormat.extension}</button><span className="field-help">{bankFormat.help}</span>{demo && <span className="import-demo-note" data-testid="import-demo-note">Tombol ini aktif setelah kamu memakai data sendiri, supaya mutasi asli tidak tercampur contoh. <button type="button" className="text-link" onClick={onStart}>Ganti ke data sendiri</button></span>}
        <input key={importFormat} ref={inputRef} aria-label={bankFormat.fileLabel} type="file" accept={bankFormat.extension} hidden disabled={controlsDisabled || demo} onChange={event => void readFile(event.target.files?.[0])} />
      </div></>}<p className="privacy-note"><ShieldCheck size={16} /> File dibaca di browser. Tidak dikirim ke server.</p>
    </section><aside className="panel import-info"><span className="eyebrow">CARA KERJANYA</span><h3>Lebih sedikit ketik.<br />Lebih banyak waktu.</h3><div className="import-steps">{[['Pilih dompet', 'Pastikan rekening dan mata uangnya sesuai.'], ['Cek hasil bacaan', 'Bandingkan juga mutasi yang mungkin dicatat manual.'], ['Simpan, rapikan nanti', 'Transaksi yang belum jelas tetap tercatat.']].map(([title, text], index) => <div className="import-step" key={title}><span>{index + 1}</span><div><strong>{title}</strong><p>{text}</p></div></div>)}</div><div className="notice"><Leaf size={19} /><span>{bankFormat ? bankFormat.notice : 'Petakan kolom sesuai file. Tanggal, keterangan, nominal dan saldo setelah transaksi diperlukan; satu file untuk satu rekening dan mata uang.'}</span></div></aside></div>
    {!result && (error || inspection?.error) && <div className="notice error" role="alert">{error || inspection?.error}</div>}
    {result && wallet && <section ref={previewRef} className="panel import-preview" aria-busy={saving}><div className="panel-header"><div><h2>Periksa sebelum disimpan</h2><p>{filename} · {formatDate(result.period.start)} – {formatDate(result.period.end)}</p></div><span className="badge neutral">{currentRows.length} transaksi</span></div>
      <div className="import-summary"><span><strong>{selected.length}</strong> dipilih</span><span><strong>{currentRows.filter(row => row.duplicate).length}</strong> sudah pernah diimpor</span><span><strong data-testid="import-review-total" data-count={selectedReview.total}>{selectedReview.total}</strong> perlu dirapikan</span><span><strong data-testid="import-review-types" data-count={selectedReview.type}>{selectedReview.type}</strong> jenis perlu dicek</span><span><strong data-testid="import-review-categories" data-count={selectedReview.category}>{selectedReview.category}</strong> kategori belum diisi</span></div>
      {previewNotes.length > 0 && <ul className="import-notes" aria-label="Hal yang perlu diperhatikan">{previewNotes.map(note => <li key={note.key} className={note.info ? 'info' : ''} {...(note.live ? { role: 'status' } : {})}><details><summary>{note.info ? <CheckCircle2 size={15} aria-hidden="true" /> : <AlertTriangle size={15} aria-hidden="true" />}<span>{note.summary}</span></summary><p>{note.detail}</p></details></li>)}</ul>}
      {!existingActivity && <label className="checkbox-row opening-checkbox"><input type="checkbox" checked={useOpening} disabled={controlsDisabled} onChange={event => setUseOpening(event.target.checked)} /><span>Gunakan saldo sebelum transaksi pertama: <strong>{formatMoney(result.openingBalance, wallet.currency)}</strong><small className="field-help">Menggantikan saldo awal dompet ini. Saldo akhir pada file: {formatMoney(result.closingBalance, wallet.currency)}.</small></span></label>}
      <div className={`notice projection ${projectedDifference === 0 ? 'success' : projectedDifference === null ? '' : 'warning'}`} data-testid="import-projection" data-difference={projectedDifference ?? ''}>{projectedDifference === 0 ? <CheckCircle2 size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />}<div><strong>{projectedDifference === 0 ? 'Cocok dengan saldo akhir file.' : projectedDifference === null ? 'Selisih belum dapat dihitung.' : `Selisih ${projectedDifference > 0 ? '+' : '−'}${formatMoney(Math.abs(projectedDifference), wallet.currency)} dari saldo akhir file.`}</strong><br />Proyeksi saldo seluruh catatan setelah impor: <strong>{projectedBalance === null ? 'Belum dapat dihitung' : formatMoney(projectedBalance, wallet.currency)}</strong>. Saldo akhir statement: <strong>{formatMoney(result.closingBalance, wallet.currency)}</strong>.
        <small className="field-help">Proyeksi mencakup seluruh catatan dompet, termasuk transaksi di luar periode file. Kesamaan saldo saja belum membuktikan histori lengkap.</small></div></div>
      <div className="import-filter-bar"><label className="search-input"><Search size={17} /><input aria-label="Cari mutasi" placeholder="Cari keterangan, tanggal, atau kategori…" value={previewQuery} disabled={controlsDisabled} onChange={event => setPreviewQuery(event.target.value)} /></label>
        <select className="select-input" aria-label="Tampilkan mutasi" value={previewFilter} disabled={controlsDisabled} onChange={event => setPreviewFilter(event.target.value)}><option value="all">Semua mutasi</option><option value="new">Mutasi baru</option><option value="pending">Perlu dirapikan</option><option value="type-pending">Jenis perlu dicek</option><option value="category-pending">Kategori belum diisi</option><option value="duplicate">Sudah diimpor</option><option value="selected">Yang dipilih</option></select><span className="import-filter-count">{visibleRows.length} terlihat · {selected.length} dipilih total</span></div>
      <p className="field-help category-import-summary" role="status">{Object.keys(automaticCategories).length} kategori diisi aturan saat file dibaca. Yang ambigu ditawarkan sebagai saran; pilihan manual tetap dipakai.{bankFormat && <> <details className="inline-details"><summary>Aturan bank yang dipakai</summary>{bankFormat.rules}</details></>}</p>
      <div className="import-bulk-category"><label className="field"><span className="field-label">Kategori untuk pilihan yang terlihat</span><select className="select-input" aria-label="Kategori mutasi terpilih" value={previewCategory} disabled={controlsDisabled} onChange={event => setPreviewCategory(event.target.value)}>{categoryChoices(categorySettings, previewCategory).map(name => <option key={name}>{name}</option>)}</select></label><button className="button secondary" disabled={controlsDisabled || !visibleSelected.length} onClick={applyPreviewCategory}><Tags size={16} /> Terapkan kategori ke {visibleSelected.length} mutasi</button>{visibleUntyped.length > 0 && <div className="import-bulk-type"><button className="button secondary" disabled={controlsDisabled} data-testid="import-bulk-type" onClick={applyPreviewTypes}><CheckCheck size={16} /> Tandai jenis {visibleUntyped.length} mutasi: masuk = pemasukan, keluar = pengeluaran</button><span className="field-help">Hanya untuk pilihan terlihat yang jenisnya masih “Perlu dicek”. Perpindahan antar-rekening tetap perlu kamu tandai sendiri di barisnya.</span></div>}</div>
      <div className="table-wrap"><table className="transactions-table import-table"><thead><tr><th className="import-select-all"><input type="checkbox" aria-label="Pilih semua transaksi baru" title="Pilih atau batalkan hanya mutasi baru yang terlihat" disabled={controlsDisabled || !visibleNewRows.length} checked={visibleNewRows.length > 0 && visibleNewRows.every(row => row.selected)} ref={input => { if (input) input.indeterminate = visibleSelected.length > 0 && visibleSelected.length < visibleNewRows.length; }} onChange={event => { const ids = new Set(visibleNewRows.map(row => row.id)); const checked = event.target.checked; setRows(current => current.map(row => ids.has(row.id) ? { ...row, selected: checked } : row)); }} /><span className="import-select-all-text">Pilih semua mutasi baru yang terlihat</span></th><th>Transaksi</th><th>Nominal</th><th>Jenis</th><th>Kategori</th></tr></thead>
        <tbody>{visibleRows.map(row => {
          const view = previewPresentations.get(row.id) ?? presentBankDescription(row.originalDescription ?? row.description, row.amount, row.fingerprintVersion);
          const bank = view.bank;
          const match = suggestCategory(row.originalDescription ?? row.description, row.classification === 'transfer' ? 'unreviewed' : row.classification, row.amount, row.fingerprintVersion);
          const overlap = inspection?.overlaps[row.id];
          const sourceReview = inspection?.sourceReviews[row.id];
          const decision = decisions[row.id];
          const chosen = overlap && decision?.signature === overlap.signature ? decision.resolution : undefined;
          return <tr key={row.id} className={row.duplicate ? 'duplicate-row' : ''}>
            <td><input type="checkbox" aria-label={`Pilih transaksi ${formatDate(row.date)} ${row.id}`} checked={row.selected} disabled={controlsDisabled || row.duplicate} onChange={event => updateRow(row.id, { selected: event.target.checked })} /></td>
            <td><span className="transaction-title">{view.title}</span>{view.title !== view.description && <details className="bank-wording"><summary>Keterangan bank asli</summary><p>{view.description}</p></details>}<span className="transaction-note">{formatDate(row.date)}{row.duplicate ? ' · Sudah diimpor' : row.date > today ? ' · Masa depan' : ''}</span>{row.warning && (row.duplicate || rowReview(row).type) && <span className="import-row-warning">{row.warning}</span>}{row.inference && !row.duplicate && row.classification === 'movement' && <span className="field-help import-row-inference">{row.inference}</span>}{bank.kind !== 'none' && <span className="field-help bank-operation-hint" data-bank-operation={bank.kind}>{bank.label}. {bank.warning}</span>}
              {sourceReview && <div className="import-overlap"><p className="import-row-warning">{sourceReview.message}</p><div role="group" aria-label={`Keputusan sumber ${row.id}`}>{sourceReview.allowedResolutions.map(resolution => <button key={resolution} type="button" className="button secondary small" aria-pressed={decisions[row.id]?.signature === sourceReview.signature && decisions[row.id]?.resolution === resolution} disabled={controlsDisabled} onClick={() => resolveSource(row.id, resolution)}>{resolution === 'restore' ? 'Pulihkan data bank' : resolution === 'distinct' ? 'Transaksi berbeda' : 'Pertahankan catatan'}</button>)}</div></div>}
              {overlap && <div className="import-overlap"><p className="import-row-warning">{overlap.candidates.length ? 'Mungkin sudah dicatat manual:' : 'Kandidat manual sebelumnya berubah atau sudah tidak ada. Tinjau ulang keputusan.'}</p>
                {overlap.candidates.map(candidate => <p className="field-help" key={candidate.id}>{formatDate(candidate.date)} · {candidate.note || 'Tanpa keterangan'} · {candidate.type === 'transfer' ? 'Transfer' : candidate.type === 'expense' ? 'Pengeluaran' : candidate.type === 'income' ? 'Pemasukan' : 'Catatan'} · {formatMoney(candidateMovement(candidate), wallet.currency)}</p>)}
                <div role="group" aria-label={`Keputusan mutasi ${row.id}`}><button type="button" className="button secondary small" aria-pressed={chosen === 'skip'} disabled={controlsDisabled} onClick={() => resolveOverlap(row.id, 'skip')}>Lewati</button>{' '}<button type="button" className="button secondary small" aria-pressed={chosen === 'distinct'} disabled={controlsDisabled} onClick={() => resolveOverlap(row.id, 'distinct')}>Transaksi berbeda</button></div>
              </div>}
            </td>
            <td data-label="Nominal" className={row.amount > 0 ? 'amount-positive' : 'amount-negative'}>{row.amount > 0 ? '+' : '−'}{formatMoney(Math.abs(row.amount), wallet.currency)}</td>
            <td data-label="Jenis"><select className="select-input compact" aria-label={`Jenis transaksi ${row.id}`} disabled={controlsDisabled || row.duplicate} value={row.classification} onChange={event => updateRow(row.id, { classification: event.target.value as ImportRow['classification'] })}><option value="unreviewed">Perlu dicek</option><option value="movement">Perpindahan dana</option>{row.amount > 0 ? <option value="income">Pemasukan</option> : <option value="expense">Pengeluaran</option>}</select></td>
            <td data-label="Kategori"><select className="select-input compact import-row-category" aria-label={`Kategori mutasi ${row.id}`} disabled={controlsDisabled || row.duplicate} value={row.category} onChange={event => updateRow(row.id, { category: event.target.value })}>{categoryChoices(categorySettings, row.category).map(name => <option key={name}>{name}</option>)}</select>
              {automaticCategories[row.id] && <span className="field-help">Aturan saat dibaca: {automaticCategories[row.id]}. Pilihan tetap bisa diubah.</span>}
              {!row.duplicate && !sourceReview && isUncategorized(row.category) && match.suggestions.length > 0 && <div className="category-row-suggestions"><span className="field-help">Saran (jenis tetap):</span>{match.suggestions.map(suggestion => <button key={suggestion.category} type="button" className="button secondary small" title={suggestion.reason} disabled={controlsDisabled} onClick={() => updateRow(row.id, { category: suggestion.category })}>{suggestion.category}</button>)}</div>}
            </td>
          </tr>;
        })}</tbody></table></div>
      {!visibleRows.length && <div className="empty-state compact"><Search size={24} /><p>Tidak ada mutasi yang cocok dengan pencarian atau filter ini.</p></div>}
      <div className="import-actions import-pages" aria-label="Halaman pratinjau"><span>{previewPages > 1 ? `Halaman ${currentPage} dari ${previewPages} · ` : ''}{filteredRows.length} hasil</span>{previewPages > 1 && <div><button className="button secondary small" disabled={controlsDisabled || currentPage <= 1} onClick={() => setPreviewPage(currentPage - 1)}>Mutasi sebelumnya</button>{' '}<button className="button secondary small" disabled={controlsDisabled || currentPage >= previewPages} onClick={() => setPreviewPage(currentPage + 1)}>Mutasi berikutnya</button></div>}</div>
      <p className="field-help">Simpan menyertakan semua {selected.length} mutasi yang dipilih, juga yang ada di halaman lain atau tersembunyi oleh filter. Pilih semua dan aksi massal hanya berlaku untuk baris yang terlihat. Perpindahan dana tidak dihitung sebagai belanja atau pemasukan.</p>
      {(error || inspection?.error) && <div className="notice error import-save-error" role="alert">{error || inspection?.error}</div>}
      <div className="import-actions import-save"><details className="import-more"><summary>Opsi lain</summary><div><p className="field-help">Untuk mutasi yang lebih lama dari catatan dompet ini: simpan isi filenya saja, tanpa menambah transaksi dan tanpa mengubah saldo awal. Sesudah itu lengkapi dari “Periksa kelengkapan mutasi”.</p><button className="button secondary small" disabled={controlsDisabled || !!inspection?.error} onClick={() => void confirmImport(true)}>Simpan isi file saja</button></div></details><div className="import-save-buttons"><button className="button secondary" disabled={controlsDisabled} onClick={resetPreview}>Batalkan pratinjau</button><button className="button primary" disabled={controlsDisabled || !selected.length || !!inspection?.error} onClick={() => void confirmImport()}><CheckCheck size={18} /> {saving ? 'Menyimpan…' : `Simpan ${selected.length} transaksi`}</button></div></div>
    </section>}
  </>;
}
