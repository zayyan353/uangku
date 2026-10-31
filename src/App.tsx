import Modal from './components/Modal';
import TransactionModal, { type TxMode, type EntrySaveOptions } from './components/TransactionModal';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownLeft, ArrowDownToLine, ArrowLeftRight, ArrowRight, ArrowUpRight,
  Check, CheckCheck, CheckCircle2, ChevronDown, ChevronRight, CircleHelp,
  Coffee, Download, FileSpreadsheet, FolderOpen, History, Landmark,
  LayoutDashboard, Leaf, MoreHorizontal, Plus, Search, ShieldCheck,
  SlidersHorizontal, Sparkles, Tags, Trash2, Upload, Wallet as WalletIcon, X,
} from 'lucide-react';
import {
  CATEGORY_NAMES, formatDate, formatMoney, makeId,
  validateEntry, walletBalanceAt,
  type Currency, type Entry, type State, type Wallet,
} from './lib/finance';
import { createEmptyState, MAX_RESTORE_BYTES, parseBackupText, prepareBackup, serializeBackup, type StoredData } from './lib/storage';
import { useLedgerStorage } from './hooks/useLedgerStorage';
import RecoveryImportView from './components/RecoveryImportView';
import { preferredWallet, readPreferences, writePreferences } from './lib/preferences';
import { canCategorize, categorizeEntries, transferCandidates } from './lib/review';
import BulkReviewPanel from './components/BulkReviewPanel';
import { createHistoryIndex, queryHistory, paginateHistory, monthLabel, type HistoryPeriod } from './lib/historyView';
import { createPostingDateIndex, entryPostings, transferPostingDates } from './lib/transferPostings';
import { applySourcedEntryEdit, applySourcedBulkCategory, deleteSourcedEntry, saveTransferEntry } from './lib/sourceCommands';
import { executeTransferCommand } from './lib/transferCommands';
import SourceDetails from './components/SourceDetails';
import StatementReview from './components/StatementReview';
import { buildCashflowReport, type CashflowReport } from './lib/cashflowReport';
import CashflowOverview from './components/CashflowOverview';
import WalletEditor from './components/WalletEditor';
import CurrencyManager from './components/CurrencyManager';
import { currencyInfo } from './lib/currencyCatalog';
import { visibleCurrencyCodes, setVisibleCurrencies } from './lib/currencySettings';
import { archiveWallet, restoreWallet, createWallet, editWallet, deleteUnusedWallet, walletUsage, isWalletArchived, isArchivedLinkedEntry, archivedReadOnlyEntryIds, assertArchivedWalletsUnchanged } from './lib/walletLifecycle';
import { PrivacyNotice } from './components/PrivacyNotice';
import ThemePicker from './components/ThemePicker';
import CategoryManager from './components/CategoryManager';
import CategoryAutomation from './components/CategoryAutomation';
import { CategorySettingsContext, useCategorySettings } from './hooks/useCategorySettings';
import type { CategorySettings } from './lib/categorySettings';
import { applyBankDecisions, type BankCategoryAssignment as CategoryAssignment } from './lib/bankDecisions';
import { activeAccountState, isCashLinkedEntry, removeUnusedCashWallets } from './lib/cashScope';
import CashArchive from './components/CashArchive';
import { createBankEntryPresentationLookup } from './lib/bankEntryHints';
import { entryReviewStatus, reviewCounts, type ReviewReason } from './lib/reviewStatus';

type Page = 'overview' | 'wallets' | 'transactions' | 'import';
const DATE_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' });
const today = () => DATE_FORMAT.format(new Date());
const currencyFlag = (code: Currency) => code === 'IDR' ? '🇮🇩' : code === 'TRY' ? '🇹🇷' : code === 'USD' ? '🇺🇸' : code === 'EUR' ? '🇪🇺' : '¤';
const currencyLabel = (code: Currency) => currencyInfo(code).label;
const kindLabel = (kind: Wallet['kind']) => kind === 'cash' ? 'Uang tunai' : kind === 'ewallet' ? 'E-wallet' : 'Rekening bank';
const typeLabels = { expense: 'Pengeluaran', income: 'Pemasukan', transfer: 'Transfer', movement: 'Perpindahan dana', adjustment: 'Penyesuaian', unreviewed: 'Perlu dicek' };
const COLORS = ['#e4a06a', '#7da69b', '#a2b96c', '#a0a5d4', '#d7b568', '#d58e9f', '#8db8c9', '#b1b8ae'];

function downloadText(content: string, name: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


function WalletSymbol({ wallet, small = false }: { wallet: Wallet; small?: boolean }) {
  return <span className={`wallet-icon ${wallet.kind} ${small ? 'small' : ''}`} style={{ '--wallet-color': wallet.currency === 'TRY' ? '#a36c51' : wallet.currency === 'USD' ? '#6576a4' : '#3d7368' } as React.CSSProperties}>
    {wallet.kind === 'cash' ? <WalletIcon size={small ? 17 : 21} /> : wallet.kind === 'bank' ? <Landmark size={small ? 17 : 21} /> : <span>{wallet.name.slice(0, 1)}</span>}
  </span>;
}

function TransactionTable({ entries, state, data, onEdit, onDelete, onDetail, selection }: {
  entries: Entry[]; state: State; data: StoredData; onEdit: (entry: Entry) => void; onDelete: (entry: Entry) => void; onDetail: (entry: Entry) => void;
  selection?: { ids: Set<string>; toggle: (id: string) => void; toggleAll: () => void };
}) {
  const readOnlyEntryIds = useMemo(() => archivedReadOnlyEntryIds(data), [data]);
  const bankPresentation = useMemo(() => createBankEntryPresentationLookup(data), [data.metadata]);
  if (!entries.length) return <div className="empty-state"><History size={30} /><h3>Belum ada transaksi di sini</h3><p>Mulai dari satu catatan kecil, atau impor mutasi rekeningmu.</p></div>;
  const eligible = entries.filter(entry => canCategorize(entry) && !isCashLinkedEntry(state, entry) && !readOnlyEntryIds.has(entry.id));
  const selectedCount = eligible.filter(e => selection?.ids.has(e.id)).length;
  return <div className="table-wrap"><table className="transactions-table"><thead><tr>
    <th>{selection && <input className="selection-checkbox" type="checkbox" aria-label="Pilih semua transaksi yang terlihat" disabled={!eligible.length} checked={eligible.length > 0 && selectedCount === eligible.length} ref={input => { if (input) input.indeterminate = selectedCount > 0 && selectedCount < eligible.length; }} onChange={selection.toggleAll} />}Transaksi</th><th>Dompet</th><th>Tanggal</th><th>Nominal</th><th><span className="screen-reader-only">Aksi</span></th>
  </tr></thead><tbody>{entries.map(entry => {
    const wallet = state.wallets.find(w => w.id === entry.walletId)!;
    const destination = state.wallets.find(w => w.id === entry.toWalletId);
    const positive = entry.type === 'income' || ((entry.type === 'adjustment' || entry.type === 'unreviewed' || entry.type === 'movement') && entry.amount > 0);
    const dates = entry.type === 'transfer' ? transferPostingDates(entry, data.metadata) : null;
    const presentation = bankPresentation(entry);
    const bank = presentation.bank;
    const review = entryReviewStatus(entry);
    const archived = isCashLinkedEntry(state, entry) || readOnlyEntryIds.has(entry.id);
    const Icon = entry.type === 'transfer' ? ArrowLeftRight : entry.type === 'adjustment' ? SlidersHorizontal : positive ? ArrowDownLeft : entry.category === 'Makan & minum' ? Coffee : ArrowUpRight;
    return <tr key={entry.id}>
      <td><div className={`transaction-cell ${selection ? 'selectable' : ''}`}>
        {selection && <input className="selection-checkbox" type="checkbox" aria-label={`Pilih ${entry.note || typeLabels[entry.type]} untuk kategori`} title={canCategorize(entry) ? 'Pilih untuk kategori massal' : 'Transfer dan penyesuaian tidak memakai kategori belanja'} disabled={!canCategorize(entry) || archived} checked={canCategorize(entry) && !archived && selection.ids.has(entry.id)} onChange={() => selection.toggle(entry.id)} />}
        <span className={`transaction-icon ${entry.type}`}><Icon size={18} /></span><div><span className="transaction-title" title={presentation.title}>{presentation.title}</span><span className="transaction-note">{entry.type === 'transfer' ? `${wallet.name} → ${destination?.name}` : entry.type === 'unreviewed' ? `${entry.category && entry.category !== 'Belum dikategorikan' ? entry.category + ' · ' : ''}Jenis belum dikonfirmasi` : entry.category || typeLabels[entry.type]}</span>{review.category && !review.type && <span className="field-help review-reason">Kategori belum diisi; jenis pengeluaran/pemasukan sudah diketahui.</span>}{bank.kind !== "none" && <span className="field-help bank-operation-hint" data-bank-operation={bank.kind}>{bank.label}{bank.kind === 'card-purchase' && (review.category || entry.category === 'Belanja') ? ' · tujuan belanja belum spesifik' : ''}</span>}{presentation.description && presentation.title !== presentation.description && <details className="bank-wording"><summary>Keterangan bank asli</summary><p>{presentation.description}</p></details>}<span className="transaction-mobile-meta">{wallet.name} · {formatDate(entry.date)}</span></div>
      </div></td>
      <td><span className="wallet-table-name">{wallet.name}</span><span className="transaction-note">{wallet.currency}</span></td><td className="date-cell">{dates ? <><span>Debit: {dates.source ? formatDate(dates.source) : 'Belum diketahui'}</span><span className="transaction-note">Kredit: {dates.destination ? formatDate(dates.destination) : 'Belum diketahui'}</span>{dates.basis === 'legacy-assumed' && <small className="field-help">Tanggal legacy belum dibuktikan terpisah</small>}</> : formatDate(entry.date)}</td>
      <td className="amount-cell"><button type="button" className="amount-detail-button" aria-label={`Rincian nominal ${entry.note || typeLabels[entry.type]}`} onClick={() => onDetail(entry)}><strong className={entry.type === 'transfer' ? '' : positive ? 'amount-positive' : 'amount-negative'}>{entry.type === 'transfer' ? '' : positive ? '+' : '−'}{formatMoney(Math.abs(entry.amount), wallet.currency)}</strong>{entry.type === 'transfer' && destination && <span className="transaction-note">→ {formatMoney(entry.toAmount ?? 0, destination.currency)}</span>}{entry.fee ? <span className="transaction-note">Biaya {formatMoney(entry.fee, wallet.currency)}</span> : null}<span className="amount-detail-hint">Rincian nominal</span></button>{entry.type === 'unreviewed' && <span className="badge unreviewed">Perlu dicek</span>}</td>
      <td>{archived ? <span className="field-help">Arsip · baca saja</span> : <div className="row-actions"><button className={entry.type === 'unreviewed' ? 'button secondary small' : 'icon-button'} aria-label={`${entry.type === 'unreviewed' ? 'Cek' : 'Ubah'} ${entry.note || 'transaksi'}`} onClick={() => onEdit(entry)}>{entry.type === 'unreviewed' ? 'Cek' : <MoreHorizontal size={18} />}</button><button className="icon-button delete-action" aria-label={`Hapus ${entry.note || 'transaksi'}`} onClick={() => onDelete(entry)}><Trash2 size={15} /></button></div>}</td>
    </tr>;
  })}</tbody></table></div>;
}

function AmountDetailModal({ entry, state, data, onClose }: { entry: Entry; state: State; data: StoredData; onClose: () => void }) {
  const source = state.wallets.find(wallet => wallet.id === entry.walletId)!;
  const destination = state.wallets.find(wallet => wallet.id === entry.toWalletId);
  const outgoing = entry.type === 'expense' || entry.type === 'transfer' || entry.amount < 0;
  const presentation = useMemo(() => createBankEntryPresentationLookup(data)(entry), [data, entry]);
  const hasSource = !!data.metadata?.links.some(link => link.entryId === entry.id && (link.source || link.destination));
  const review = entryReviewStatus(entry);
  return <Modal title="Rincian nominal" subtitle="Baca saja. Membuka rincian tidak mengubah catatan atau saldo." onClose={onClose}>
    <div className="modal-body amount-detail"><h3>{presentation.title}</h3><dl>
      <dt>Jenis catatan</dt><dd>{typeLabels[entry.type]}</dd>{presentation.bank.kind !== 'none' && <><dt>Operasi pada mutasi</dt><dd data-bank-operation={presentation.bank.kind}>{presentation.bank.label}</dd></>}{presentation.merchant && <><dt>Merchant pada mutasi</dt><dd>{presentation.merchant}</dd></>}{review.pending && <><dt>Perlu dirapikan</dt><dd>{[review.type ? 'Jenis belum dikonfirmasi' : '', review.category ? 'Kategori belum diisi' : ''].filter(Boolean).join(' · ')}</dd></>}<dt>Tanggal catatan</dt><dd>{formatDate(entry.date)}</dd>
      <dt>{entry.type === 'transfer' ? 'Dompet asal' : 'Dompet'}</dt><dd>{source.name} · {source.currency}</dd>
      <dt>{outgoing ? 'Nominal keluar' : 'Nominal masuk'}</dt><dd>{formatMoney(Math.abs(entry.amount), source.currency)}</dd>
      {entry.type === 'transfer' && <><dt>Biaya tambahan</dt><dd>{formatMoney(entry.fee ?? 0, source.currency)}</dd><dt>Total debit dompet asal</dt><dd>{formatMoney(entry.amount + (entry.fee ?? 0), source.currency)}</dd>{destination && <><dt>Dompet tujuan</dt><dd>{destination.name} · {destination.currency}</dd><dt>Nominal diterima</dt><dd>{formatMoney(entry.toAmount ?? 0, destination.currency)}</dd></>}{entry.rate !== undefined && <><dt>Kurs transaksi tersimpan</dt><dd>1 {source.currency} = {new Intl.NumberFormat('id-ID', { maximumFractionDigits: 20 }).format(entry.rate)} {destination?.currency}</dd></>}</>}
      <dt>Kategori</dt><dd>{entry.category || '—'}</dd>{presentation.noteIsCustom && <><dt>Catatanmu</dt><dd>{entry.note || '—'}</dd></>}{!hasSource && <><dt>Keterangan lengkap</dt><dd>{presentation.description || '—'}</dd></>}
    </dl>{presentation.bank.kind !== 'none' && <p className="field-help">{presentation.bank.warning}</p>}<SourceDetails data={data} entry={entry} /></div><div className="modal-footer"><button className="button secondary" onClick={onClose}>Tutup rincian</button></div>
  </Modal>;
}

export default function App() {
  const ledger = useLedgerStorage();
  const categoryPreferences = useCategorySettings();
  const [categoryManager, setCategoryManager] = useState<CategorySettings | null>(null);
  const categorySettingsBase = useRef<string | null>(null);
  const [categoryAutomation, setCategoryAutomation] = useState<{ data: StoredData; token: string | null } | null>(null);
  const [preferences, setPreferences] = useState(readPreferences);
  const data = ledger.data;
  const visibleCurrencies = useMemo(() => visibleCurrencyCodes(data), [data.metadata, data.state.wallets]);
  const [currencyManager, setCurrencyManager] = useState<{ data: StoredData; token: string | null } | null>(null);
  const storageError = ledger.error;
  const blocked = ledger.status === 'blocked';
  const editorBaseToken = useRef<string | null>(ledger.revisionToken);
  const mutationInFlight = useRef(false);
  const [clockDay, setClockDay] = useState(today);
  useEffect(() => {
    const check = () => setClockDay(today());
    const timer = window.setInterval(check, 30_000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, []);
  const [page, setPage] = useState<Page>('overview');
  const [currency, setCurrency] = useState<Currency>(() => visibleCurrencies.includes(preferences.currency) ? preferences.currency : visibleCurrencies[0]);
  const shownCurrencyTabs = [...new Set([...visibleCurrencies, currency])].map(currencyInfo);
  const [month, setMonth] = useState(today().slice(0, 7));
  const [cashflowWallet, setCashflowWallet] = useState('all');
  const [cashflowPeriod, setCashflowPeriod] = useState<'month' | 'all'>('month');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [reviewReason, setReviewReason] = useState<ReviewReason>('all');
  const [historyWallet, setHistoryWallet] = useState('all');
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>('month');
  const [historyPage, setHistoryPage] = useState(1);
  const [amountDetail, setAmountDetail] = useState<Entry | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [cashArchiveOpen, setCashArchiveOpen] = useState(false);
  const cashCleanupAttempt = useRef<StoredData | null>(null);
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [walletModal, setWalletModal] = useState<Wallet | 'new' | null>(null);
  const [walletView, setWalletView] = useState<'active' | 'archive'>('active');
  const walletEditorBase = useRef<{ data: StoredData; token: string | null; editingId?: string } | null>(null);
  const [txModal, setTxModal] = useState<{ type: TxMode; walletId?: string; existing?: Entry } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; text: string; label: string; requireReason?: boolean; allowBankAnnotations?: boolean; action: (reason?: string, useBankAnnotations?: boolean) => void | Promise<void> } | null>(null);
  const [confirmReason, setConfirmReason] = useState('');
  const [confirmBankAnnotations, setConfirmBankAnnotations] = useState(false);
  useEffect(() => { setConfirmReason(''); setConfirmBankAnnotations(false); }, [confirm]);
  const [toast, setToast] = useState('');
  const restoreRef = useRef<HTMLInputElement>(null);
  const state = data.state;
  const activeState = useMemo(() => activeAccountState(state), [state]);
  const readOnlyEntryIds = useMemo(() => archivedReadOnlyEntryIds(data), [data]);
  const availableWallets = useMemo(() => activeState.wallets.filter(wallet => !isWalletArchived(data, wallet.id)), [activeState.wallets, data.metadata]);
  const cashWallets = useMemo(() => state.wallets.filter(wallet => wallet.kind === 'cash'), [state.wallets]);
  const postingContext = useMemo(() => createPostingDateIndex(data.metadata), [data.metadata]);
  const undatedWallets = useMemo(() => new Set(state.entries.flatMap(entry => entryPostings(entry, postingContext).filter(posting => posting.date === null).map(posting => posting.walletId))), [state, postingContext]);
  const notify = (text: string) => setToast(text);
  useEffect(() => { if (toast) { const id = setTimeout(() => setToast(''), 5500); return () => clearTimeout(id); } }, [toast]);
  useEffect(() => { writePreferences({ ...preferences, currency }); }, [preferences, currency]);
  useEffect(() => { setSelectedEntryIds([]); }, [state, page, currency, month, query, filter, historyPeriod, historyPage, reviewReason, historyWallet]);
  useEffect(() => { setHistoryPage(1); }, [state, page, currency, month, query, filter, historyPeriod, reviewReason, historyWallet]);
  useEffect(() => { setAmountDetail(null); }, [state]);
  async function persistCandidate(next: StoredData, options?: { expectedData?: StoredData; expectedToken?: string | null; replaceBlocked?: boolean; replaceLedger?: boolean }): Promise<boolean> {
    if (mutationInFlight.current) return false;
    mutationInFlight.current = true;
    try {
      const { replaceLedger, ...writeOptions } = options ?? {};
      if (!replaceLedger) assertArchivedWalletsUnchanged(writeOptions.expectedData ?? data, next);
      return await ledger.setCandidate(next, undefined, writeOptions);
    }
    finally { mutationInFlight.current = false; }
  }
  useEffect(() => {
    if (data.demo || blocked || ledger.dirty || ledger.pending || !ledger.supported || cashCleanupAttempt.current === data) return;
    const next = removeUnusedCashWallets(data);
    if (next === data) return;
    cashCleanupAttempt.current = data;
    void persistCandidate(next, { expectedData: data, expectedToken: ledger.revisionToken });
  }, [data, blocked, ledger.dirty, ledger.pending, ledger.supported, ledger.revisionToken]);
  async function retryDraft() {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    try { if (await ledger.retry()) { setTxModal(null); setWalletModal(null); setCategoryAutomation(null); notify('Pekerjaan berhasil tersimpan.'); } }
    finally { mutationInFlight.current = false; }
  }
  const update = async (next: State, expectedToken = ledger.revisionToken): Promise<boolean> => {
    try {
      const checked = prepareBackup({ ...data, state: next }).data;
      const ok = await persistCandidate(checked, { expectedData: data, expectedToken });
      if (!ok) notify('Perubahan belum tersimpan. Periksa status penyimpanan dan unduh pekerjaan bila diperlukan.');
      return ok;
    } catch (reason) { notify(reason instanceof Error ? reason.message : 'Perubahan belum bisa disimpan.'); return false; }
  };
  async function saveDocument(next: StoredData, expectedToken = ledger.revisionToken): Promise<boolean> {
    try {
      const ok = await persistCandidate(next, { expectedData: data, expectedToken });
      if (!ok) notify('Perubahan belum tersimpan. Periksa status penyimpanan dan unduh pekerjaan bila diperlukan.');
      return ok;
    } catch (error) { notify(error instanceof Error ? error.message : 'Perubahan belum dapat disimpan.'); return false; }
  }
  async function runConfirmation() {
    if (!confirm || mutationInFlight.current || confirm.requireReason && !confirmReason.trim()) return;
    const request = confirm; setConfirm(null);
    try { await request.action(confirmReason.trim(), confirmBankAnnotations); }
    catch (error) { notify(error instanceof Error ? error.message : 'Perubahan ditolak; catatan lama dipertahankan.'); }
  }
  function openWallet(value: Wallet | 'new') {
    if (mutationInFlight.current || value !== 'new' && (value.kind === 'cash' || isWalletArchived(data, value.id))) return;
    walletEditorBase.current = { data, token: ledger.revisionToken, ...(value !== 'new' ? { editingId: value.id } : {}) };
    setWalletModal(value);
  }
  function actualText(walletId: string, code: Currency): string {
    if (undatedWallets.has(walletId)) return 'Belum pasti: tanggal posting belum diketahui';
    try { return formatMoney(walletBalanceAt(state, walletId, clockDay, postingContext), code); }
    catch (error) { return error instanceof Error ? error.message : 'Saldo aktual belum tersedia'; }
  }
  function backupCurrent() {
    try { downloadText(blocked ? ledger.recoveryText() : serializeBackup(data), `uangku-cadangan-${today()}.json`); notify('Cadangan diunduh. Uji pemulihannya di salinan terpisah.'); }
    catch (reason) { notify(reason instanceof Error ? reason.message : 'Cadangan belum dapat dibuat.'); }
  }
  const currencyWallets = useMemo(() => activeState.wallets.filter(w => w.currency === currency), [activeState.wallets, currency]);
  const cashflowScope = currencyWallets.some(wallet => wallet.id === cashflowWallet) ? cashflowWallet : 'all';
  useEffect(() => { if (cashflowScope !== cashflowWallet) setCashflowWallet('all'); }, [cashflowScope, cashflowWallet]);
  const cashflowResult = useMemo<{ report?: CashflowReport; error?: string }>(() => {
    if (page !== 'overview') return {};
    try { return { report: buildCashflowReport(data, { currency, month, today: clockDay, period: cashflowPeriod, walletId: cashflowScope === 'all' ? undefined : cashflowScope }) }; }
    catch (error) { return { error: error instanceof Error ? error.message : 'Laporan arus rekening belum dapat dihitung dengan tepat.' }; }
  }, [data, currency, month, clockDay, cashflowPeriod, cashflowScope, page]);
  const walletPageTotal = useMemo<{ value: number | null; text: string }>(() => {
    if (page !== 'wallets') return { value: null, text: '' };
    try {
      const selected = currencyWallets.filter(wallet => isWalletArchived(data, wallet.id) === (walletView === 'archive'));
      if (selected.some(wallet => undatedWallets.has(wallet.id))) throw new Error('Tanggal posting belum diketahui');
      const total = selected.reduce((sum, wallet) => sum + BigInt(walletBalanceAt(state, wallet.id, clockDay, postingContext)), 0n);
      if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError('overflow');
      return { value: Number(total), text: formatMoney(Number(total), currency) };
    } catch { return { value: null, text: 'Belum dapat dipastikan; periksa tanggal atau baseline' }; }
  }, [page, currencyWallets, data.metadata, walletView, state, postingContext, currency, clockDay, undatedWallets]);
  const availableCurrencyWallets = currencyWallets.filter(wallet => !isWalletArchived(data, wallet.id));
  const archivedCurrencyWallets = currencyWallets.filter(wallet => isWalletArchived(data, wallet.id));
  const displayedWallets = walletView === 'active' ? availableCurrencyWallets : archivedCurrencyWallets;
  const overviewWallets = availableCurrencyWallets.slice(0, 4);
  const archivedWalletIds = useMemo(() => new Set(data.metadata?.walletArchives?.map(row => row.walletId) ?? []), [data.metadata]);
  const pendingReview = useMemo(() => reviewCounts(activeState.entries.filter(entry => !readOnlyEntryIds.has(entry.id))), [activeState.entries, data.metadata, readOnlyEntryIds]);
  const pendingCount = pendingReview.total;
  const isReviewQueue = page === 'transactions' && filter === 'pending';
  const validHistoryWallet = activeState.wallets.find(wallet => wallet.id === historyWallet && (isReviewQueue ? !isWalletArchived(data, wallet.id) : wallet.currency === currency))?.id;
  useEffect(() => { if (historyWallet !== 'all' && !validHistoryWallet) setHistoryWallet('all'); }, [historyWallet, validHistoryWallet]);
  const historyIndex = useMemo(() => createHistoryIndex(activeState, postingContext), [activeState, postingContext]);
  const allTransactions = useMemo(() => queryHistory(historyIndex, {
    currency, month, query, type: filter, period: page === 'transactions' ? historyPeriod : 'month', reviewQueue: isReviewQueue, reviewReason, reviewExcludedWalletIds: archivedWalletIds, reviewExcludedEntryIds: readOnlyEntryIds, walletId: page === 'transactions' ? validHistoryWallet : undefined,
  }), [historyIndex, currency, month, query, filter, historyPeriod, page, isReviewQueue, reviewReason, archivedWalletIds, readOnlyEntryIds, validHistoryWallet]);
  const historySlice = paginateHistory(allTransactions, historyPage);
  const selectedSet = useMemo(() => new Set(selectedEntryIds), [selectedEntryIds]);
  const selectedEntries = allTransactions.filter(e => selectedSet.has(e.id) && canCategorize(e) && !isCashLinkedEntry(state, e) && !readOnlyEntryIds.has(e.id));
  const selection = {
    ids: selectedSet,
    toggle: (id: string) => setSelectedEntryIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]),
    toggleAll: () => {
      const eligible = historySlice.entries.filter(entry => canCategorize(entry) && !isCashLinkedEntry(state, entry) && !readOnlyEntryIds.has(entry.id)).map(e => e.id);
      setSelectedEntryIds(eligible.every(id => selectedSet.has(id)) ? [] : eligible);
    },
  };
  const reportMonth = monthLabel(month);
  async function applyBulkCategory(category: string, confirmUnreviewed: boolean) {
    try {
      if (selectedEntries.some(entry => isCashLinkedEntry(state, entry) || readOnlyEntryIds.has(entry.id))) throw Error('Histori cash lama atau dompet arsip bersifat baca saja. Pulihkan dompet bank/e-wallet untuk mengubahnya.');
      const next = applySourcedBulkCategory(data, selectedEntries.map(e => e.id), category, confirmUnreviewed);
      if (!await saveDocument(next)) return;
      notify(`${selectedEntries.length} transaksi dirapikan.${confirmUnreviewed ? ' Jenis yang dipilih sudah dikonfirmasi.' : ' Jenis yang belum dicek tetap ditandai.'}`);
      setSelectedEntryIds([]);
    } catch (err) { notify(err instanceof Error ? err.message : 'Transaksi belum bisa dirapikan.'); }
  }
  function openCategoryManager() {
    if (mutationInFlight.current) return;
    categorySettingsBase.current = categoryPreferences.raw;
    setCategoryManager(categoryPreferences.settings);
  }
  async function saveCategorySettings(next: CategorySettings): Promise<boolean> {
    try {
      await categoryPreferences.save(next, categorySettingsBase.current);
      setCategoryManager(null); notify('Kategori dan aturan berhasil disimpan di browser ini.'); return true;
    } catch (error) { notify(error instanceof Error ? error.message : 'Pengaturan kategori belum tersimpan.'); return false; }
  }
  async function applyAutomaticCategories(assignments: CategoryAssignment[]): Promise<boolean> {
    if (!categoryAutomation || mutationInFlight.current) return false;
    try {
      const base = categoryAutomation;
      const next = applyBankDecisions(base.data, assignments);
      const ok = await persistCandidate(next, { expectedData: base.data, expectedToken: base.token });
      if (ok) { setCategoryAutomation(null); notify(`${assignments.length} kategori tersimpan.${assignments.some(item => item.confirmBankType) ? ' Mutasi bank yang dikenali sudah dikonfirmasi; saldo rekening tetap.' : ' Nominal dan jenis transaksi tetap.'}`); }
      return ok;
    } catch (error) { notify(error instanceof Error ? error.message : 'Kategori belum tersimpan.'); return false; }
  }
  const categoryTools = <div className="category-toolbar"><button className="button secondary small" onClick={openCategoryManager}><Tags size={16} /> Kelola kategori</button><button className="button secondary small" disabled={ledger.pending || ledger.dirty || !ledger.supported || blocked} onClick={() => { if (!mutationInFlight.current) setCategoryAutomation({ data, token: ledger.revisionToken }); }}><CheckCheck size={16} /> Isi kategori otomatis</button><span className="field-help">Kategori kosong & konfirmasi mutasi bank · semua periode</span>{categoryPreferences.error && <p className="notice warning">{categoryPreferences.error}</p>}</div>;
  const categoryTotals = cashflowResult.report?.categoryTotals ?? [];
  const categoryExpenseTotal = cashflowResult.report?.categoryExpenseTotal ?? 0;
  function startOwn() {
    if (mutationInFlight.current) return;
    setConfirm({ title: blocked ? 'Ganti data tersimpan yang tidak dapat dibaca?' : 'Mulai dengan uangmu sendiri?', text: blocked ? 'Data asli di penyimpanan browser tidak dapat dibaca oleh versi ini. Yang terlihat hanyalah contoh sementara. Unduh data asli melalui tombol pemulihan terlebih dahulu. Jika dikonfirmasi, data tersimpan tersebut akan diganti dengan dompet kosong; ini bukan sekadar menghapus contoh.' : 'Data contoh akan diganti dengan dompet kosong. Isi saldo awalmu atau impor mutasi untuk mulai mencatat.', label: blocked ? 'Ganti data tersimpan dengan dompet kosong' : 'Mulai dari kosong', action: async () => { const ok = await persistCandidate({ app: 'uangku', version: 1, demo: false, state: createEmptyState() }, { replaceBlocked: true, replaceLedger: true, expectedData: data, expectedToken: ledger.revisionToken }); if (ok) notify('Dompet kosong berhasil tersimpan.'); } });
  }
  function openTx(type: TxMode, walletId?: string) {
    if (mutationInFlight.current) return;
    if (!availableWallets.length) { openWallet('new'); notify('Tambahkan satu dompet terlebih dahulu.'); return; }
    if (type === 'transfer' && availableWallets.length < 2) { openWallet('new'); notify('Transfer membutuhkan dua dompet.'); return; }
    if (type === 'adjustment' && walletId) {
      try { if (undatedWallets.has(walletId)) throw new Error('Tanggal posting belum diketahui.'); walletBalanceAt(state, walletId, today(), postingContext); }
    catch (error) { notify(error instanceof Error ? error.message : 'Saldo aktual belum dapat dipastikan.'); return; }
    }
    if (walletId && isWalletArchived(data, walletId)) { notify('Pulihkan dompet dari arsip sebelum mencatat transaksi baru.'); return; }
    editorBaseToken.current = ledger.revisionToken;
    setTxModal({ type, walletId: walletId ?? preferredWallet(availableWallets, currency, preferences) });
  }
  function openCurrencyManager() {
    if (mutationInFlight.current) return;
    setCurrencyManager({ data, token: ledger.revisionToken });
  }
  async function saveCurrencyList(codes: Currency[]): Promise<boolean> {
    if (!currencyManager) return false;
    const base = currencyManager;
    const next = setVisibleCurrencies(base.data, codes);
    if (!await persistCandidate(next, { expectedData: base.data, expectedToken: base.token })) return false;
    if (!codes.includes(currency)) setCurrency(codes[0]);
    setCurrencyManager(null); notify('Daftar mata uang tersimpan. Dompet dan histori tetap utuh.'); return true;
  }
  async function saveWallet(wallet: Wallet): Promise<boolean> {
    const base = walletEditorBase.current;
    if (!base) throw new Error('Buka kembali formulir dompet.');
    if (base.editingId && !state.wallets.some(item => item.id === base.editingId)) throw new Error('Dompet sudah dihapus di tab lain. Isian belum disimpan; buka daftar terbaru.');
    if (base.editingId && isWalletArchived(data, base.editingId)) throw new Error('Dompet sudah diarsipkan. Pulihkan sebelum mengubahnya.');
    const next = base.editingId ? editWallet(base.data, wallet) : createWallet(base.data, wallet);
    if (!await persistCandidate(next, { expectedData: base.data, expectedToken: base.token })) return false;
    setWalletModal(null); setCurrency(wallet.currency); setWalletView('active'); notify('Dompet tersimpan.'); return true;
  }
  function requestWalletAction(wallet: Wallet, kind: 'archive' | 'restore' | 'delete', base = { data, token: ledger.revisionToken }) {
    if (mutationInFlight.current || ledger.pending || ledger.dirty || blocked || !ledger.supported) { notify('Selesaikan status penyimpanan sebelum mengubah dompet.'); return; }
    const usage = walletUsage(base.data, wallet.id);
    const details = kind === 'archive'
      ? `Dompet ${wallet.name} akan disimpan di Arsip. ${usage.entryCount} transaksi dan bukti sumber tetap utuh; saldo tetap masuk laporan. Pulihkan untuk mencatat atau mengubah histori lagi.`
      : kind === 'restore' ? `Dompet ${wallet.name} akan kembali tersedia untuk transaksi dan impor. Histori dan saldo tetap sama.`
      : `Hapus dompet kosong ${wallet.name}? Penghapusan hanya diizinkan jika saldo awal nol dan tidak ada transaksi, fakta bank, atau referensi histori.`;
    setWalletModal(null);
    setConfirm({ title: kind === 'archive' ? 'Arsipkan dompet?' : kind === 'restore' ? 'Pulihkan dompet?' : 'Hapus dompet kosong?', text: details, label: kind === 'archive' ? 'Arsipkan dompet' : kind === 'restore' ? 'Pulihkan dompet' : 'Hapus dompet', action: async () => {
      const next = kind === 'archive' ? archiveWallet(base.data, wallet.id, new Date().toISOString()) : kind === 'restore' ? restoreWallet(base.data, wallet.id) : deleteUnusedWallet(base.data, wallet.id);
      if (await persistCandidate(next, { expectedData: base.data, expectedToken: base.token })) { setWalletView(kind === 'archive' ? 'archive' : 'active'); notify(kind === 'archive' ? 'Dompet diarsipkan. Histori dan saldo tetap tersimpan.' : kind === 'restore' ? 'Dompet dipulihkan.' : 'Dompet kosong dihapus.'); }
    } });
  }
  async function saveEntry(entry: Entry, removeIds: string[], keepOpen = false, options?: EntrySaveOptions): Promise<boolean> {
    if (isCashLinkedEntry(state, entry) || readOnlyEntryIds.has(entry.id) || isWalletArchived(data, entry.walletId) || !!entry.toWalletId && isWalletArchived(data, entry.toWalletId) || state.entries.some(item => removeIds.includes(item.id) && (isCashLinkedEntry(state, item) || readOnlyEntryIds.has(item.id)))) { notify('Histori cash lama atau dompet arsip bersifat baca saja. Pulihkan dompet bank/e-wallet untuk mengubahnya.'); return false; }
    const at = new Date().toISOString();
    let next: StoredData;
    try {
      next = entry.type === 'transfer'
        ? saveTransferEntry(data, entry, removeIds, { sourceDate: options?.sourceDate ?? entry.date, destinationDate: options?.destinationDate ?? entry.date, ...options, reason: options?.reason || 'Pengguna mencatat atau mencocokkan transfer.', at })
        : applySourcedEntryEdit(data, entry, removeIds, { reason: options?.reason ?? '', at });
    } catch (error) { notify(error instanceof Error ? error.message : 'Transaksi belum bisa disimpan.'); return false; }
    if (!await saveDocument(next, editorBaseToken.current)) return false;
    editorBaseToken.current = serializeBackup(next);
    if (!txModal?.existing && !entry.sourceKey) {
      const usedWallet = state.wallets.find(w => w.id === entry.walletId);
      if (usedWallet) {
        setPreferences(p => ({ ...p, lastWallets: { ...p.lastWallets, [usedWallet.currency]: usedWallet.id } }));
        setCurrency(usedWallet.currency);
      }
    }
    if (!keepOpen) setTxModal(null);
    notify(entry.type === 'transfer' ? 'Transfer tersimpan. Kedua saldo sudah diperbarui.' : keepOpen ? 'Tersimpan. Lanjut catat berikutnya.' : 'Transaksi tersimpan.');
    return true;
  }
  function editEntry(entry: Entry) {
    if (mutationInFlight.current) return;
    if (isCashLinkedEntry(state, entry) || readOnlyEntryIds.has(entry.id)) { setAmountDetail(entry); return; }
    if (entry.type === 'adjustment') {
      try { if (undatedWallets.has(entry.walletId)) throw new Error('Tanggal posting belum diketahui.'); walletBalanceAt(state, entry.walletId, today(), postingContext); }
      catch (error) { notify(error instanceof Error ? error.message : 'Saldo aktual belum dapat dipastikan.'); return; }
    }
    editorBaseToken.current = ledger.revisionToken; setTxModal({ type: entry.type === 'unreviewed' ? (entry.amount > 0 ? 'income' : 'expense') : entry.type, existing: entry });
  }
  function deleteEntry(entry: Entry, expectedToken = ledger.revisionToken) {
    if (mutationInFlight.current) return;
    if (isCashLinkedEntry(state, entry) || readOnlyEntryIds.has(entry.id)) { notify('Histori cash lama atau dompet arsip bersifat baca saja. Pulihkan dompet bank/e-wallet untuk mengubahnya.'); return; }
    const sourced = !!data.metadata?.links.some(link => link.entryId === entry.id);
    setConfirm({ title: 'Hapus transaksi ini?', text: sourced ? 'Interpretasi transaksi akan dihapus dari saldo. Fakta bank tetap disimpan, dan impor ulang memerlukan keputusan eksplisit agar tidak menggandakan transaksi.' : 'Saldo dompet akan dihitung ulang. Unduh cadangan bila catatan ini masih diperlukan.', label: 'Hapus transaksi', requireReason: sourced, action: async (reason = '') => {
      const next = entry.type === 'transfer' ? executeTransferCommand(data, { kind: 'delete', entryId: entry.id, reason: reason || 'Pengguna menghapus transfer.', at: new Date().toISOString() }) : deleteSourcedEntry(data, entry.id, { reason: reason || 'Pengguna menghapus transaksi.', at: new Date().toISOString() });
      if (await saveDocument(next, expectedToken)) notify('Transaksi dihapus; fakta sumber yang tersedia tetap dipertahankan.');
    } });
  }
  function unpairTransfer(entry: Entry) {
    if (mutationInFlight.current || isCashLinkedEntry(state, entry) || readOnlyEntryIds.has(entry.id)) return;
    const token = editorBaseToken.current;
    setTxModal(null);
    setConfirm({ title: 'Pisahkan transfer menjadi dua mutasi?', text: 'Tanggal dan anotasi tiap sisi dipertahankan jika buktinya tersedia. Transfer lama tanpa bukti yang cukup akan ditolak; informasi yang hilang tidak akan ditebak.', label: 'Pisahkan transfer', requireReason: true, allowBankAnnotations: true, action: async (reason = '', useBankAnnotations = false) => {
      const next = executeTransferCommand(data, { kind: 'unpair', entryId: entry.id, destinationEntryId: makeId(), reason, at: new Date().toISOString(), ...(useBankAnnotations ? { useBankAnnotations: true } : {}) });
      if (await saveDocument(next, token)) notify('Transfer dipisahkan menjadi dua mutasi yang perlu ditinjau.');
    } });
  }
  async function importState(next: State, sourceDocument?: StoredData, walletId?: string): Promise<boolean> {
    const saved = sourceDocument ? await saveDocument(sourceDocument) : await update(next);
    if (saved) { const wallet = next.wallets.find(item => item.id === walletId); if (wallet) setCurrency(wallet.currency); }
    return saved;
  }
  async function restore(file?: File) {
    if (!file) return;
    try {
      if (file.size > MAX_RESTORE_BYTES) throw new Error('File pemulihan mentah maksimal 32 MiB; data logis tetap maksimal 8 MiB.');
      const restored = parseBackupText(await file.text());
      setConfirm({ title: 'Pulihkan cadangan?', text: `${restored.state.wallets.length} dompet dan ${restored.state.entries.length} transaksi akan menggantikan catatan di browser ini. Unduh cadangan sekarang dulu jika catatan lama masih dibutuhkan.`, label: 'Pulihkan data', action: async () => { if (await persistCandidate(restored, { replaceBlocked: true, replaceLedger: true, expectedData: data, expectedToken: ledger.revisionToken })) notify('Cadangan berhasil dipulihkan dan tersimpan.'); } });
    } catch (err) { notify(err instanceof Error ? err.message : 'File cadangan tidak valid.'); }
    finally { if (restoreRef.current) restoreRef.current.value = ''; }
  }
  const navigation: { page: Page; label: string; icon: typeof WalletIcon }[] = [{ page: 'overview', label: 'Ringkasan', icon: LayoutDashboard }, { page: 'wallets', label: 'Dompet', icon: WalletIcon }, { page: 'transactions', label: 'Transaksi', icon: ArrowLeftRight }, { page: 'import', label: 'Impor mutasi', icon: Upload }];
  const titles = { overview: ['Halo, Zayyan.', 'Uangmu di mana-mana. Catatannya cukup di sini.'], wallets: ['Semua dompetmu.', 'Rekening dan e-wallet. Cash tidak dibukukan.'], transactions: ['Catatan kecil, lebih tenang.', 'Lihat uang yang masuk, keluar, dan berpindah.'], import: ['Biar file yang bantu.', 'Kurangi ketik satu-satu. Mulai dari mutasi rekening.'] };
  function navigate(next: Page) { if (mutationInFlight.current) return; setPage(next); setQuery(''); setHistoryWallet('all'); setFilter('all'); setHistoryPeriod('month'); setHistoryPage(1); }
  return <CategorySettingsContext.Provider value={categoryPreferences.settings}><div className="app-shell">
    <aside className="sidebar"><a className="brand" href="#" onClick={e => { e.preventDefault(); navigate('overview'); }} aria-label="Uangku beranda"><span className="brand-mark">u<span /></span><span className="brand-copy">uangku<span>uangmu, lebih rapi.</span></span></a><span className="nav-caption">RUANG UANGMU</span><nav>{navigation.map(({ page: p, label, icon: Icon }) => <button key={p} className={`nav-item ${page === p ? 'active' : ''}`} onClick={() => navigate(p)} aria-current={page === p ? 'page' : undefined}><Icon size={20} /><span>{label}</span>{p === 'transactions' && pendingCount > 0 && <span className="nav-count">{pendingCount}</span>}{page === p && <ChevronRight className="nav-chevron" size={15} />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-tip"><Leaf size={23} /><strong>Nggak harus sempurna.</strong><p>Satu catatan hari ini lebih baik daripada menunggu lengkap.</p></div><div className="backup-tools"><button onClick={backupCurrent}><Download size={16} /> Cadangkan data</button><button onClick={() => restoreRef.current?.click()}><History size={16} /> Pulihkan cadangan</button></div><div className="sidebar-user"><span className="avatar">Z</span><div><strong>Ruang pribadi</strong><span><span className="status-dot" /> {ledger.label}</span></div><ShieldCheck size={18} /></div></div>
    </aside>
    <main className="main-content"><header className="topbar"><div className="breadcrumb">Ruang pribadi <ChevronRight size={13} /><strong>{navigation.find(n => n.page === page)?.label}</strong></div><div className="topbar-tools"><ThemePicker onNotice={notify} /><span className="local-indicator"><span className="status-dot" /> Lokal & pribadi</span><button className="icon-button" aria-label="Privasi dan cadangan" onClick={() => setPrivacyOpen(true)}><ShieldCheck size={18} /></button><span className="avatar small">Z</span></div></header>
      <div className="page-content"><div className="page-header"><div><div className="eyebrow">SEDIKIT DICATAT, BANYAK TERBANTU</div><h1 className="page-title">{titles[page][0]} {page === 'overview' && <span className="greeting-leaf">✳</span>}</h1><p className="page-subtitle">{titles[page][1]}</p></div><div className="page-actions">{page === 'wallets' ? <button className="button primary" onClick={() => openWallet('new')}><Plus size={18} /> Tambah dompet</button> : <><button className="button secondary" onClick={() => openTx('transfer')}><ArrowLeftRight size={17} /> Pindah uang</button><button className="button primary" onClick={() => openTx('expense')}><Plus size={18} /> Catat transaksi</button></>}</div></div>
      <div className="notice warning" role="note">Versi pengembangan lokal. Perbaikan digabung dan diuji bertahap; gunakan data contoh atau salinan cadangan untuk pemeriksaan.</div>
      {activeState.wallets.some(wallet => undatedWallets.has(wallet.id)) && <div className="notice warning">Ada tanggal posting yang belum diketahui. Saldo aktual dan laporan periode terkait belum dapat dianggap lengkap; nilai tersebut tetap ada pada saldo seluruh catatan.</div>}
      <div className={`notice ${ledger.dirty || storageError ? 'error' : ''}`} role="status" data-testid="save-status"><strong>{ledger.label}</strong>{storageError && <span>{storageError}</span>}
        {(ledger.dirty || blocked) && <><button className="button secondary small" onClick={() => downloadText(ledger.recoveryText(), 'uangku-pekerjaan-belum-tersimpan.json')}>Unduh pekerjaan yang belum tersimpan</button>
          <button className="button secondary small" disabled={ledger.pending || !ledger.supported || blocked} onClick={() => void retryDraft()}>Coba simpan lagi</button>
          <button className="button secondary small" disabled={ledger.pending} onClick={() => setConfirm({ title: 'Muat catatan terbaru?', text: 'Unduh pekerjaan lokal terlebih dahulu jika masih diperlukan. Setelah dikonfirmasi, tampilan diganti dengan data browser terbaru.', label: 'Muat catatan terbaru', action: () => { if (ledger.reloadLatest()) { setTxModal(null); setWalletModal(null); } } })}>Muat catatan terbaru</button></>}
      </div>
      {data.demo && <div className="demo-banner"><span className="demo-banner-icon"><Sparkles size={20} /></span><div className="demo-banner-copy"><strong>Kenalan dulu pakai data contoh.</strong><span>Semua angka di sini fiktif. Coba fiturnya, lalu mulai dengan uangmu sendiri.</span></div><button className="button ghost small" onClick={startOwn}>Mulai pakai data sendiri <ArrowRight size={16} /></button></div>}
      {page !== 'import' && !isReviewQueue && <div className="currency-toolbar"><div className="currency-tabs" aria-label="Mata uang">{shownCurrencyTabs.map(c => <button key={c.code} className={`currency-tab ${currency === c.code ? 'active' : ''}`} onClick={() => setCurrency(c.code)} aria-label={`${c.code === 'TRY' ? 'TL' : c.code} ${c.label}`} aria-pressed={currency === c.code}><span className="currency-flag">{currencyFlag(c.code)}</span><span className="currency-code">{c.code === 'TRY' ? 'TL' : c.code}</span><span className="currency-label">{c.label}{!visibleCurrencies.includes(c.code) ? ' · riwayat' : ''}</span></button>)}</div><button className="button secondary small currency-manage-button" onClick={openCurrencyManager}>Kelola mata uang</button>{page !== 'wallets' && (page !== 'transactions' || historyPeriod === 'month') && (page !== 'overview' || cashflowPeriod === 'month') && <label className="date-pill"><History size={15} /><input aria-label="Bulan laporan" type="month" value={month} onChange={e => { if (e.target.value) setMonth(e.target.value); }} /></label>}</div>}
      {page === 'overview' && <>
        <CashflowOverview {...cashflowResult} currency={currency} month={month} period={cashflowPeriod} walletId={cashflowScope} wallets={currencyWallets} archivedWalletIds={new Set(archivedCurrencyWallets.map(wallet => wallet.id))} onPeriodChange={setCashflowPeriod} onWalletChange={setCashflowWallet} />
        <div className="dashboard-columns"><section className="panel"><div className="panel-header"><div><h2>Dompetmu</h2><p>Uangnya ada di sini.</p></div><button className="text-link" onClick={() => navigate('wallets')}>Lihat semua <ArrowRight size={15} /></button></div><div className="wallet-list">{overviewWallets.map(w => <div className="wallet-row-wrap" key={w.id}><button className="wallet-row" onClick={() => openWallet(w)}><WalletSymbol wallet={w} /><span className="wallet-info"><strong className="wallet-name">{w.name}</strong><span className="wallet-detail">{kindLabel(w.kind)} · {w.currency}</span></span><strong className="wallet-amount">{actualText(w.id, w.currency)}</strong><ChevronRight size={16} /></button></div>)}{!availableCurrencyWallets.length && <div className="empty-state compact"><WalletIcon size={25} /><p>Belum ada dompet aktif {currency}.</p><button className="text-link" onClick={() => openWallet('new')}>Tambah dompet</button></div>}</div></section>
          <section className="panel category-panel"><div className="panel-header"><div><h2>Kategori pengeluaran terkonfirmasi</h2><p>{cashflowPeriod === 'all' ? 'Seluruh catatan hingga hari ini' : reportMonth} · cakupan rekening yang dipilih.</p></div><span className="category-heading-icon"><Tags size={18} /></span></div>{categoryTotals.length ? <div className="category-list">{categoryTotals.slice(0, 4).map(([name, amount], i) => <div className="category-row" key={name}><div className="category-labels"><span className="category-name"><span className="category-dot" style={{ background: COLORS[i] }} />{name}</span><strong className="category-value">{formatMoney(amount, currency)}</strong></div><div className="category-track"><span className="category-fill" style={{ width: `${categoryExpenseTotal ? amount / categoryExpenseTotal * 100 : 0}%`, background: COLORS[i] }} /></div></div>)}{categoryTotals.length > 4 && <span className="field-help">+{categoryTotals.length - 4} kategori lainnya</span>}</div> : <div className="empty-state compact"><Leaf size={27} /><p>Belum ada pengeluaran terkonfirmasi dalam cakupan ini.</p></div>}<div className="category-legend"><span className="status-dot" /> Hanya kategori pengeluaran terkonfirmasi. Semua debit rekening tetap dihitung pada arus di atas.</div></section></div>
        {pendingCount > 0 && <button className="pending-banner" onClick={() => { setPage('transactions'); setFilter('pending'); setReviewReason('all'); }}><span className="pending-icon"><CircleHelp size={20} /></span><span><strong>{pendingCount} catatan bisa dirapikan nanti</strong><span>{pendingReview.type} jenis perlu dicek · {pendingReview.category} kategori belum diisi. Saldo sudah tercatat.</span></span><span className="pending-cta">Cek catatan <ArrowRight size={16} /></span></button>}
        <section className="panel transactions-panel"><div className="panel-header"><div><h2>Transaksi terbaru</h2><p>Langkah kecil yang sudah kamu catat.</p></div><button className="text-link" onClick={() => navigate('transactions')}>Semua transaksi <ArrowRight size={15} /></button></div><TransactionTable entries={allTransactions.slice(0, 5)} state={state} data={data} onEdit={editEntry} onDelete={deleteEntry} onDetail={setAmountDetail} /></section>
      </>}
      {page === 'wallets' && <>
        {cashWallets.length > 0 && <div className="notice"><span>Histori cash lama disimpan sebagai arsip baca saja dan tidak masuk total aktif.</span><button className="button secondary small" onClick={() => setCashArchiveOpen(true)}>Lihat arsip cash lama</button></div>}
        <div className="wallet-view-tabs" role="group" aria-label="Status dompet"><button className={`button ${walletView === 'active' ? 'primary' : 'secondary'}`} data-testid="wallet-active-tab" aria-pressed={walletView === 'active'} onClick={() => setWalletView('active')}>Aktif ({availableCurrencyWallets.length})</button><button className={`button ${walletView === 'archive' ? 'primary' : 'secondary'}`} data-testid="wallet-archive-tab" aria-pressed={walletView === 'archive'} onClick={() => setWalletView('archive')}>Arsip ({archivedCurrencyWallets.length})</button></div>
        <div className="section-heading"><div><h2 className="section-title">Dompet {currencyLabel(currency)} · {walletView === 'archive' ? 'Arsip' : 'Aktif'}</h2><p className="section-description">{displayedWallets.length} dompet · saldo aktual {formatDate(clockDay)}: <strong data-testid="wallet-current-total" data-amount={walletPageTotal.value ?? undefined}>{walletPageTotal.text}</strong></p></div><span className="badge neutral">{currency === 'TRY' ? 'TL / TRY' : currency}</span></div>
        {walletView === 'archive' && <div className="notice">Dompet arsip tetap masuk saldo dan laporan. Histori dapat dibaca; pulihkan dompet untuk mencatat, mengimpor, atau mengubah transaksi.</div>}
        <div className="wallet-grid">{displayedWallets.map(w => <section key={w.id} className="wallet-card" data-wallet-id={w.id}><div className="wallet-card-top"><WalletSymbol wallet={w} /><span className="wallet-info"><strong>{w.name}</strong><span>{kindLabel(w.kind)}{walletView === 'archive' ? ' · Arsip' : ''}</span></span>{walletView === 'active' && <button className="icon-button" aria-label={`Atur dompet ${w.name}`} onClick={() => openWallet(w)}><MoreHorizontal size={20} /></button>}</div><span className="wallet-card-label">Saldo aktual {formatDate(clockDay)}</span><strong className="wallet-card-balance">{actualText(w.id, w.currency)}</strong><div className="wallet-card-footer"><span className="badge neutral">{w.currency}</span><div className="wallet-card-actions">{walletView === 'active' ? <><button className="text-link" onClick={() => openTx('expense', w.id)}><Plus size={14} /> Catat</button><button className="text-link" onClick={() => openTx('adjustment', w.id)}>Cek saldo <ArrowRight size={14} /></button></> : <><button className="text-link" aria-label={`Lihat histori ${w.name}`} onClick={() => { navigate('transactions'); setCurrency(w.currency); setHistoryPeriod('all'); setHistoryWallet(w.id); }}>Lihat histori</button><button className="text-link" aria-label={`Pulihkan dompet ${w.name}`} onClick={() => requestWalletAction(w, 'restore')}>Pulihkan dompet</button></>}</div></div></section>)}
          {walletView === 'active' && <button className="wallet-card add-wallet-card" onClick={() => openWallet('new')}><span className="add-wallet-icon"><Plus size={24} /></span><strong>Tambah dompet</strong><span>Rekening bank atau e-wallet baru.</span></button>}
        </div>
        {walletView === 'archive' && !displayedWallets.length && <div className="empty-state compact"><WalletIcon size={28} /><p>Belum ada dompet arsip {currency}.</p></div>}
        <div className="notice"><CircleHelp size={18} /><span>Satu dompet untuk satu mata uang. Dompet kosong dapat dihapus lewat Atur dompet; dompet dengan saldo atau histori dapat diarsipkan.</span></div>
      </>}
      {page === 'transactions' && <section className="panel transactions-panel">{categoryTools}{isReviewQueue && <div className="review-scope"><CircleHelp size={19} /><div><strong>Perlu dirapikan · <span data-testid="review-total" data-count={pendingCount}>{pendingCount}</span> catatan</strong><p>Semua mata uang dan semua periode. <span data-testid="review-types" data-count={pendingReview.type}>{pendingReview.type}</span> jenis perlu dicek · <span data-testid="review-categories" data-count={pendingReview.category}>{pendingReview.category}</span> kategori belum diisi. Satu catatan bisa memiliki dua alasan; total tidak dihitung ganda. Saldo mutasi sudah tercatat.</p></div></div>}<div className="filter-bar"><label className="search-input"><Search size={18} /><input placeholder="Cari keterangan atau dompet…" aria-label="Cari transaksi" value={query} onChange={e => { setQuery(e.target.value); if (e.target.value.trim() && !query.trim()) setHistoryPeriod('all'); }} /></label>{!isReviewQueue && <label className="history-period"><span className="field-label">Periode</span><select aria-label="Periode transaksi" className="select-input" value={historyPeriod} onChange={e => setHistoryPeriod(e.target.value as HistoryPeriod)}><option value="month">{reportMonth}</option><option value="all">Semua periode</option></select></label>}<select aria-label="Dompet riwayat" className="select-input" value={validHistoryWallet ?? 'all'} onChange={event => setHistoryWallet(event.target.value)}><option value="all">Semua dompet</option>{activeState.wallets.filter(wallet => isReviewQueue ? !isWalletArchived(data, wallet.id) : wallet.currency === currency).map(wallet => <option key={wallet.id} value={wallet.id}>{wallet.name}{isWalletArchived(data, wallet.id) ? ' (arsip)' : ''}</option>)}</select><select aria-label="Filter jenis transaksi" className="select-input" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Semua jenis</option><option value="expense">Pengeluaran</option><option value="income">Pemasukan</option><option value="transfer">Transfer</option><option value="movement">Perpindahan dana rekening</option><option value="pending">Perlu dirapikan</option><option value="adjustment">Penyesuaian</option></select>{isReviewQueue && <select aria-label="Alasan perlu dirapikan" className="select-input" value={reviewReason} onChange={event => setReviewReason(event.target.value as ReviewReason)}><option value="all">Semua alasan</option><option value="type">Jenis perlu dicek</option><option value="category">Kategori belum diisi</option></select>}<span className="transaction-count">{allTransactions.length} transaksi</span>{!isReviewQueue && pendingCount > 0 && <button className="button secondary small" onClick={() => setFilter('pending')}>Rapikan {pendingCount} catatan</button>}</div>{selectedEntries.length > 0 && <BulkReviewPanel entries={selectedEntries} onApply={applyBulkCategory} onClear={() => setSelectedEntryIds([])} />}<p className="field-help history-scope" role="status">{isReviewQueue ? 'Semua mata uang · semua periode' : `${currency} · ${historyPeriod === 'all' ? 'Semua periode' : reportMonth}`} · {allTransactions.length} transaksi. Pilih catatan di halaman ini untuk kategori massal.</p><TransactionTable entries={historySlice.entries} state={state} data={data} onEdit={editEntry} onDelete={deleteEntry} onDetail={setAmountDetail} selection={selection} /><nav className="history-pagination" aria-label="Halaman riwayat"><span role="status">{historySlice.start}–{historySlice.end} dari {historySlice.total} · Halaman {historySlice.page} dari {historySlice.pageCount}</span><div><button className="button secondary small" disabled={historySlice.page <= 1} onClick={() => setHistoryPage(historySlice.page - 1)}>Halaman sebelumnya</button><button className="button secondary small" disabled={historySlice.page >= historySlice.pageCount} onClick={() => setHistoryPage(historySlice.page + 1)}>Halaman berikutnya</button></div></nav></section>}
      {page === 'import' && <><div className="currency-import-toolbar"><button className="button secondary small" onClick={openCurrencyManager}>Kelola mata uang</button></div>{categoryTools}<StatementReview data={data} onCommit={saveDocument} disabled={ledger.pending || ledger.dirty || !ledger.supported || blocked} /><RecoveryImportView data={data} key={data.demo ? 'demo' : 'own'} state={state} demo={data.demo} onStart={startOwn} onImport={importState} notify={notify} disabled={ledger.pending || ledger.dirty || !ledger.supported || blocked} preferredCurrency={currency} onAddWallet={(requested) => { if (requested) setCurrency(requested); openWallet('new'); }} /></>}
      <footer className="bottom-note"><span><Leaf size={14} /> Nggak harus rapi sekaligus. Yang penting mulai.</span><span>{ledger.label} · cadangkan secara berkala</span><div className="mobile-backup"><button className="text-link" onClick={backupCurrent}><Download size={14} /> Cadangkan</button><button className="text-link" onClick={() => restoreRef.current?.click()}><History size={14} /> Pulihkan</button><button className="text-link" onClick={() => setPrivacyOpen(true)}><ShieldCheck size={14} /> Privasi</button></div></footer>
      </div>
    </main>
    <nav className="mobile-nav" aria-label="Navigasi seluler">{navigation.map(({ page: p, label, icon: Icon }) => <button key={p} className={page === p ? 'active' : ''} aria-current={page === p ? 'page' : undefined} onClick={() => navigate(p)}><Icon size={20} /><span>{label}</span></button>)}</nav>
    <input ref={restoreRef} type="file" accept=".json,application/json" aria-label="File cadangan Uangku" hidden onChange={e => void restore(e.target.files?.[0])} />
    {walletModal && <WalletEditor key={walletModal === 'new' ? 'new' : walletModal.id} existing={walletModal === 'new' ? undefined : walletModal} defaultCurrency={visibleCurrencies.includes(currency) ? currency : visibleCurrencies[0]} currencies={visibleCurrencies} usage={walletModal === 'new' || !state.wallets.some(wallet => wallet.id === walletModal.id) ? undefined : walletUsage(data, walletModal.id)} disabled={ledger.pending || ledger.dirty || blocked || !ledger.supported || walletModal !== 'new' && (!state.wallets.some(wallet => wallet.id === walletModal.id) || isWalletArchived(data, walletModal.id))} disabledReason={ledger.dirty || blocked || !ledger.supported ? 'Penyimpanan belum siap. Selesaikan pemulihan atau konflik pada status penyimpanan dahulu; isian tetap dipertahankan.' : walletModal !== 'new' && (!state.wallets.some(wallet => wallet.id === walletModal.id) || isWalletArchived(data, walletModal.id)) ? 'Dompet berubah, dihapus, atau diarsipkan di tab lain. Tutup untuk membuka daftar terbaru.' : ''} onSave={saveWallet} onClose={() => { if (!mutationInFlight.current) setWalletModal(null); }} onArchive={walletModal === 'new' ? undefined : () => requestWalletAction(walletModal, 'archive', walletEditorBase.current!)} onDelete={walletModal === 'new' ? undefined : () => requestWalletAction(walletModal, 'delete', walletEditorBase.current!)} />}
    {txModal && <TransactionModal data={data} state={state} initialMode={txModal.type} initialWallet={txModal.walletId} existing={txModal.existing} disabled={ledger.pending} onUnpair={txModal.existing?.type === 'transfer' ? () => unpairTransfer(txModal.existing!) : undefined} onSave={saveEntry} onClose={() => { if (!mutationInFlight.current) setTxModal(null); }} onDelete={txModal.existing ? () => { if (mutationInFlight.current) return; const entry = txModal.existing!; const token = editorBaseToken.current; setTxModal(null); deleteEntry(entry, token); } : undefined} />}
    {amountDetail && <AmountDetailModal entry={amountDetail} state={state} data={data} onClose={() => setAmountDetail(null)} />}
    {currencyManager && <CurrencyManager data={currencyManager.data} disabled={ledger.pending || ledger.dirty || blocked || !ledger.supported} onSave={saveCurrencyList} onView={code => { setCurrency(code); setCurrencyManager(null); setPage('overview'); }} onClose={() => { if (!mutationInFlight.current) setCurrencyManager(null); }} />}
    {categoryManager && <CategoryManager settings={categoryManager} notice={categoryPreferences.error || (categoryPreferences.packAdded || categoryPreferences.packUpdated ? `${categoryPreferences.packAdded} kata kunci tambahan aktif dan ${categoryPreferences.packUpdated} pemetaan bawaan disesuaikan. Kategori dan aturan pribadi dipertahankan.` : undefined)} onSave={saveCategorySettings} onClose={() => setCategoryManager(null)} />}
    {categoryAutomation && <CategoryAutomation data={categoryAutomation.data} disabled={ledger.dirty || blocked || !ledger.supported} onApply={applyAutomaticCategories} onClose={() => { if (!mutationInFlight.current) setCategoryAutomation(null); }} />}
    {cashArchiveOpen && <CashArchive data={data} onClose={() => setCashArchiveOpen(false)} />}
    {privacyOpen && <PrivacyNotice onClose={() => setPrivacyOpen(false)} />}
    {confirm && <Modal title={confirm.title} onClose={() => { if (!mutationInFlight.current) setConfirm(null); }}><div className="modal-body"><p className="confirm-copy">{confirm.text}</p>{confirm.requireReason && <label className="field"><span className="field-label">Alasan tindakan</span><input aria-label="Alasan tindakan" className="field-input" maxLength={2000} value={confirmReason} onChange={event => setConfirmReason(event.target.value)} /></label>}{confirm.allowBankAnnotations && <label className="checkbox-row"><input type="checkbox" checked={confirmBankAnnotations} onChange={event => setConfirmBankAnnotations(event.target.checked)} />Bila anotasi lama tidak lengkap tetapi kedua fakta bank tersedia, gunakan anotasi bank sebagai catatan baru. Informasi lama yang hilang tidak dianggap pulih.</label>}</div><div className="modal-footer"><button className="button secondary" onClick={() => { if (!mutationInFlight.current) setConfirm(null); }}>Batal</button><button className={`button ${confirm.label.startsWith('Hapus') ? 'danger' : 'primary'}`} disabled={ledger.pending || !!confirm.requireReason && !confirmReason.trim()} onClick={() => void runConfirmation()}>{confirm.label}</button></div></Modal>}
    {toast && <div className="toast" role="status"><CheckCircle2 size={19} /><span>{toast}</span><button aria-label="Tutup pemberitahuan" onClick={() => setToast('')}><X size={15} /></button></div>}
  </div></CategorySettingsContext.Provider>;
}
