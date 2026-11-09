import Modal from './components/Modal';
import StartOwnModal from './components/StartOwnModal';
import TransactionModal, { type TxMode, type EntrySaveOptions } from './components/TransactionModal';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownToLine, ArrowLeftRight, ArrowRight, Check, CheckCheck, CheckCircle2, ChevronDown, ChevronRight, CircleHelp,
  Download, FileSpreadsheet, FolderOpen, History, Leaf, Plus, ShieldCheck,
  Sparkles, Tags, Wallet as WalletIcon, X,
} from 'lucide-react';
import {
  CATEGORY_NAMES, formatMoney, makeId,
  validateEntry, walletBalanceAt,
  type Currency, type Entry, type State, type Wallet,
} from './lib/finance';
import { createEmptyState, MAX_RESTORE_BYTES, prepareBackup, serializeBackup, type StoredData } from './lib/storage';
import { parseRestoreFile } from './lib/fullBackup';
import { carryDemo } from './lib/demoTransition';
import type { CandidateOptions } from './lib/persistence';
import { categoryBudgetRows, type BudgetMap } from './lib/budgets';
import { useLedgerStorage } from './hooks/useLedgerStorage';
import { useTransactionTemplates } from './hooks/useTransactionTemplates';
import RecoveryImportView from './components/RecoveryImportView';
import { preferredWallet, readPreferences, writePreferences } from './lib/preferences';
import { canCategorize, categorizeEntries, transferCandidates } from './lib/review';
import BulkReviewPanel from './components/BulkReviewPanel';
import { createHistoryIndex, queryHistory, paginateHistory, monthLabel, type HistoryPeriod } from './lib/historyView';
import { createPostingDateIndex, entryPostings } from './lib/transferPostings';
import { applySourcedEntryEdit, applySourcedBulkCategory, deleteSourcedEntry, saveTransferEntry } from './lib/sourceCommands';
import { executeTransferCommand } from './lib/transferCommands';
import StatementReview from './components/StatementReview';
import { buildCashflowReport, type CashflowReport } from './lib/cashflowReport';
import CashflowOverview, { CashflowBalance, useMobileOverview } from './components/CashflowOverview';
import WalletEditor from './components/WalletEditor';
import CurrencyManager from './components/CurrencyManager';
import { currencyInfo } from './lib/currencyCatalog';
import { visibleCurrencyCodes, setVisibleCurrencies } from './lib/currencySettings';
import { archiveWallet, restoreWallet, createWallet, editWallet, deleteUnusedWallet, walletUsage, isWalletArchived, isArchivedLinkedEntry, archivedReadOnlyEntryIds, assertArchivedWalletsUnchanged } from './lib/walletLifecycle';
import { PrivacyNotice } from './components/PrivacyNotice';
import { AppSidebar, MobileFooter, MobileNav, NAVIGATION, type Page } from './components/AppNavigation';
import { HistoryFilters } from './components/HistoryFilters';
import TransactionTable from './components/TransactionTable';
import AmountDetailModal from './components/AmountDetailModal';
import WalletsPage, { WalletSymbol, kindLabel } from './components/WalletsPage';
import { typeLabels } from './lib/entryTypeLabels';
import { historyCsv, type HistoryCsvRow } from './lib/csvExport';
import { requestPersistentStorage, type PersistenceStatus } from './lib/storagePersistence';
import { LAST_BACKUP_KEY, REMINDER_DISMISSED_KEY, backupReminderReason, dismissReminder, lastBackupLabel, ledgerFingerprint, readLastBackup, readReminderDismissed, recordBackup } from './lib/backupReminder';
import ThemePicker from './components/ThemePicker';
import CategoryManager from './components/CategoryManager';
import CategoryAutomation from './components/CategoryAutomation';
import { CategorySettingsContext, useCategorySettings } from './hooks/useCategorySettings';
import type { CategorySettings } from './lib/categorySettings';
import { applyBankDecisions, type BankCategoryAssignment as CategoryAssignment } from './lib/bankDecisions';
import { activeAccountState, isCashLinkedEntry, removeUnusedCashWallets } from './lib/cashScope';
import CashArchive from './components/CashArchive';
import { createBankEntryPresentationLookup } from './lib/bankEntryHints';
import { reviewCounts, type ReviewReason } from './lib/reviewStatus';

const DATE_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' });
const today = () => DATE_FORMAT.format(new Date());
const currencyFlag = (code: Currency) => code === 'IDR' ? '🇮🇩' : code === 'TRY' ? '🇹🇷' : code === 'USD' ? '🇺🇸' : code === 'EUR' ? '🇪🇺' : '¤';
const currencyLabel = (code: Currency) => currencyInfo(code).label;
const COLORS = ['#e4a06a', '#7da69b', '#a2b96c', '#a0a5d4', '#d7b568', '#d58e9f', '#8db8c9', '#b1b8ae'];

function downloadText(content: string, name: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const ledger = useLedgerStorage();
  const categoryPreferences = useCategorySettings();
  const [categoryManager, setCategoryManager] = useState<{ settings: CategorySettings; budgets: BudgetMap; budgetsError: string } | null>(null);
  const categorySettingsBase = useRef<string | null>(null);
  const categoryBudgetsBase = useRef<string | null>(null);
  const [categoryAutomation, setCategoryAutomation] = useState<{ data: StoredData; token: string | null } | null>(null);
  const [preferences, setPreferences] = useState(readPreferences);
  const data = ledger.data;
  const transactionTemplates = useTransactionTemplates();
  const visibleCurrencies = useMemo(() => visibleCurrencyCodes(data), [data.metadata, data.state.wallets]);
  const [currencyManager, setCurrencyManager] = useState<{ data: StoredData; token: string | null } | null>(null);
  const storageError = ledger.error;
  const blocked = ledger.blocked;
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
  const [lastHistoryScope, setLastHistoryScope] = useState<{ currency: Currency; month: string } | null>(null);
  const historyScrollY = useRef(0);
  const historyCurrency = page === 'transactions' ? currency : lastHistoryScope?.currency ?? currency;
  const historyMonth = page === 'transactions' ? month : lastHistoryScope?.month ?? month;
  useLayoutEffect(() => {
    window.scrollTo(0, page === 'transactions' ? historyScrollY.current : 0);
  }, [page]);
  const [amountDetail, setAmountDetail] = useState<Entry | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [persistence, setPersistence] = useState<PersistenceStatus>('not-requested');
  const persistenceRequested = useRef(false);
  useEffect(() => {
    // Ask once per session, only for the user's own data (never for the demo).
    if (data.demo || persistenceRequested.current) return;
    persistenceRequested.current = true;
    setPersistence('checking');
    void requestPersistentStorage().then(setPersistence);
  }, [data.demo]);
  const [cashArchiveOpen, setCashArchiveOpen] = useState(false);
  const cashCleanupAttempt = useRef<StoredData | null>(null);
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [walletModal, setWalletModal] = useState<Wallet | 'new' | null>(null);
  const [demoReview, setDemoReview] = useState<{ data: StoredData; token: string | null } | null>(null);
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
  useEffect(() => { setHistoryPage(1); }, [query, filter, historyPeriod, historyCurrency, historyMonth, reviewReason, historyWallet]);
  useEffect(() => { setAmountDetail(null); }, [state]);
  async function persistCandidate(next: StoredData, options?: CandidateOptions & { replaceLedger?: boolean }): Promise<boolean> {
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
  function backupCurrent(recovery = false) {
    try {
      const text = ledger.recoveryText();
      if (blocked && !ledger.dirty) {
        downloadText(text, `uangku-data-asli-${today()}.json`);
        notify('Salinan mentah data asli diunduh. Simpan file ini untuk pemulihan.');
      } else if (recovery) {
        downloadText(text, 'uangku-pekerjaan-belum-tersimpan.json');
        notify('Pekerjaan yang belum tersimpan sudah diunduh.');
      } else {
        downloadText(text, `uangku-cadangan-${today()}.json`);
        notify('Cadangan diunduh. Uji pemulihannya di salinan terpisah.');
      }
    }
    catch (reason) { notify(reason instanceof Error ? reason.message : 'Cadangan belum dapat dibuat.'); }
  }
  const [lastBackup, setLastBackup] = useState(() => readLastBackup());
  const [reminderDismissedOn, setReminderDismissedOn] = useState(() => readReminderDismissed());
  useEffect(() => {
    // Another tab may record a newer backup.
    const sync = (event: StorageEvent) => {
      if (event.key === LAST_BACKUP_KEY || event.key === null) setLastBackup(readLastBackup());
      if (event.key === REMINDER_DISMISSED_KEY || event.key === null) setReminderDismissedOn(readReminderDismissed());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const lastBackupText = lastBackupLabel(lastBackup);
  const currentFingerprint = useMemo(() => ledger.revisionToken === null ? null : ledgerFingerprint(ledger.revisionToken), [ledger.revisionToken]);
  const reminderReason = data.demo || blocked ? null : backupReminderReason({ lastBackup, currentFingerprint, now: Date.now(), today: clockDay, dismissedOn: reminderDismissedOn });
  function closeReminder() {
    dismissReminder(clockDay);
    setReminderDismissedOn(clockDay);
  }
  async function backupAll() {
    // A successful full export proves the stored ledger equals this token. If the
    // token is stale, the fingerprint just differs later and errs toward reminding.
    const exportedToken = ledger.revisionToken;
    try {
      const text = await ledger.exportFullBackup(categoryPreferences.raw);
      downloadText(text, `uangku-lengkap-${today()}.json`);
      if (exportedToken !== null && recordBackup(exportedToken)) setLastBackup(readLastBackup());
      notify('Cadangan lengkap diunduh. Dompet, transaksi, dan pengaturan kategori ada dalam satu file.');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Cadangan lengkap belum dapat dibuat.');
    }
  }
  const currencyWallets = useMemo(() => activeState.wallets.filter(w => w.currency === currency), [activeState.wallets, currency]);
  const dashboardWallet = currencyWallets.find(wallet => wallet.id === cashflowWallet);
  const cashflowScope = dashboardWallet?.id ?? 'all';
  useEffect(() => { if (cashflowScope !== cashflowWallet) setCashflowWallet('all'); }, [cashflowScope, cashflowWallet]);
  const cashflowResult = useMemo<{ report?: CashflowReport; error?: string }>(() => {
    if (page !== 'overview') return {};
    try { return { report: buildCashflowReport(data, { currency, month, today: clockDay, period: cashflowPeriod, walletId: cashflowScope === 'all' ? undefined : cashflowScope }) }; }
    catch (error) { return { error: error instanceof Error ? error.message : 'Laporan arus rekening belum dapat dihitung dengan tepat.' }; }
  }, [data, currency, month, clockDay, cashflowPeriod, cashflowScope, page]);
  const mobileOverview = useMobileOverview();
  const balanceCard = page === 'overview' && <CashflowBalance report={cashflowResult.report} currency={currency} month={month} period={cashflowPeriod}
    scope={dashboardWallet?.name ?? `Semua rekening & e-wallet ${currency}`} mobile={mobileOverview} demo={data.demo} />;
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
  const validHistoryWallet = activeState.wallets.find(wallet => wallet.id === historyWallet && (filter === 'pending' ? !isWalletArchived(data, wallet.id) : wallet.currency === historyCurrency))?.id;
  useEffect(() => { if (historyWallet !== 'all' && !validHistoryWallet) setHistoryWallet('all'); }, [historyWallet, validHistoryWallet]);
  const historyIndex = useMemo(() => createHistoryIndex(activeState, postingContext), [activeState, postingContext]);
  const activityWalletId = page === 'overview' ? dashboardWallet?.id : page === 'transactions' ? validHistoryWallet : undefined;
  const activityPeriod = page === 'overview' ? cashflowPeriod : historyPeriod;
  const activityQuery = page === 'transactions' ? query : '';
  const activityType = page === 'transactions' ? filter : 'all';
  const allTransactions = useMemo(() => queryHistory(historyIndex, {
    currency, month, query: activityQuery, type: activityType, period: activityPeriod, walletId: activityWalletId,
    reviewQueue: isReviewQueue, reviewReason, reviewExcludedWalletIds: archivedWalletIds, reviewExcludedEntryIds: readOnlyEntryIds,
  }), [historyIndex, currency, month, activityQuery, activityType, activityPeriod, activityWalletId, isReviewQueue, reviewReason, archivedWalletIds, readOnlyEntryIds]);
  const historySlice = paginateHistory(allTransactions, historyPage);
  function downloadHistoryCsv() {
    // Every row matching the current filters, not only the visible page.
    const presentation = createBankEntryPresentationLookup(data);
    const walletName = (id?: string) => state.wallets.find(wallet => wallet.id === id)?.name ?? '';
    const rows: HistoryCsvRow[] = allTransactions.map(entry => ({
      date: entry.date,
      wallet: entry.type === 'transfer' ? `${walletName(entry.walletId)} → ${walletName(entry.toWalletId)}` : walletName(entry.walletId),
      type: typeLabels[entry.type],
      category: entry.category,
      // Expenses are stored positive; income and transfers stay positive; other kinds are already signed.
      amountMinor: entry.type === 'expense' ? -entry.amount : entry.amount,
      currency: state.wallets.find(wallet => wallet.id === entry.walletId)?.currency ?? currency,
      note: presentation(entry).title,
    }));
    const scope = isReviewQueue ? 'perlu-dirapikan' : `${currency}-${historyPeriod === 'all' ? 'semua' : reportMonth.replace(/\s+/g, '-').toLowerCase()}`;
    downloadText(`\ufeff${historyCsv(rows)}`, `uangku-riwayat-${scope}-${today()}.csv`, 'text/csv;charset=utf-8');
    notify(`${rows.length} transaksi diunduh sebagai CSV.`);
  }
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
    if (mutationInFlight.current || categoryPreferences.recovering) return;
    categorySettingsBase.current = categoryPreferences.raw;
    categoryBudgetsBase.current = categoryPreferences.budgetsRaw;
    setCategoryManager({ settings: categoryPreferences.settings, budgets: categoryPreferences.budgets, budgetsError: categoryPreferences.budgetsError });
  }
  async function saveCategorySettings(next: CategorySettings, budgets?: BudgetMap): Promise<boolean> {
    try {
      await categoryPreferences.save(next, categorySettingsBase.current, budgets ? { budgets, expectedRaw: categoryBudgetsBase.current } : undefined);
      setCategoryManager(null); notify(budgets ? 'Kategori, aturan, dan anggaran berhasil disimpan di browser ini.' : 'Kategori dan aturan berhasil disimpan di browser ini.'); return true;
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
  const categoryTools = <div className="category-toolbar"><button className="button secondary small" disabled={categoryPreferences.recovering} onClick={openCategoryManager}><Tags size={16} /> Kelola kategori</button><button className="button secondary small" disabled={ledger.pending || ledger.dirty || !ledger.supported || blocked || categoryPreferences.recovering} onClick={() => { if (!mutationInFlight.current) setCategoryAutomation({ data, token: ledger.revisionToken }); }}><CheckCheck size={16} /> Isi kategori otomatis</button><span className="field-help">Kategori kosong & konfirmasi mutasi bank · semua periode</span>{categoryPreferences.error && <p className="notice warning">{categoryPreferences.error}</p>}</div>;
  const categoryTotals = cashflowResult.report?.categoryTotals ?? [];
  const categoryExpenseTotal = cashflowResult.report?.categoryExpenseTotal ?? 0;
  // Budgets are monthly limits across all wallets, so progress is shown only for that view.
  const monthlyBudgets = categoryPreferences.budgets[currency];
  const budgetsShown = cashflowPeriod === 'month' && cashflowScope === 'all';
  const budgetsHidden = !budgetsShown && !!monthlyBudgets && Object.keys(monthlyBudgets).length > 0;
  const categoryRows = categoryBudgetRows(categoryTotals, budgetsShown ? monthlyBudgets : undefined);
  function startOwn() {
    if (mutationInFlight.current || ledger.dirty || !data.demo) return;
    const base = { data, token: ledger.revisionToken };
    if (!blocked) { setDemoReview(base); return; }
    if (base.token === null) {
      notify('Izinkan penyimpanan untuk situs ini lalu muat ulang agar data asli bisa dibaca.');
      return;
    }
    setConfirm({ title: 'Ganti data tersimpan yang tidak dapat dibaca?', text: 'Data asli di penyimpanan browser tidak dapat dibaca oleh versi ini. Yang terlihat hanyalah contoh sementara. Unduh data asli melalui tombol pemulihan terlebih dahulu. Jika dikonfirmasi, data tersimpan tersebut akan diganti dengan dompet kosong.', label: 'Ganti data tersimpan dengan dompet kosong', action: () => finishStartOwn(base, undefined, true) });
  }
  async function finishStartOwn(base: { data: StoredData; token: string | null }, included?: ReadonlySet<string>, replaceBlocked = false) {
    if (mutationInFlight.current) return;
    if (data !== base.data || base.token !== ledger.revisionToken || blocked !== replaceBlocked) {
      setDemoReview(null);
      notify('Catatan berubah sejak pilihan dibuka. Periksa kembali catatan terbaru.');
      return;
    }
    try {
      const next: StoredData = included ? carryDemo(base.data, included) : { app: 'uangku', version: 1, demo: false, state: createEmptyState() };
      const ok = await persistCandidate(next, { replaceBlocked, replaceLedger: true, expectedData: base.data, expectedToken: base.token });
      if (ok) notify(included ? `${next.state.entries.length} transaksi dibawa ke catatan pribadi.` : 'Dompet kosong berhasil tersimpan.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Catatan belum dapat disimpan.'); }
    finally { setDemoReview(null); }
  }
  function openTx(type: TxMode, walletId = activityWalletId) {
    if (mutationInFlight.current) return;
    if (walletId && isWalletArchived(data, walletId)) { notify('Dompet diarsipkan. Pulihkan sebelum mencatat transaksi baru.'); return; }
    if (!availableWallets.length) { openWallet('new'); notify('Tambahkan satu dompet terlebih dahulu.'); return; }
    if (type === 'transfer' && availableWallets.length < 2) { openWallet('new'); notify('Transfer membutuhkan dua dompet.'); return; }
    if (type === 'adjustment' && walletId) {
      try { if (undatedWallets.has(walletId)) throw new Error('Tanggal posting belum diketahui.'); walletBalanceAt(state, walletId, today(), postingContext); }
    catch (error) { notify(error instanceof Error ? error.message : 'Saldo aktual belum dapat dipastikan.'); return; }
    }
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
      if (ledger.pending || ledger.dirty || mutationInFlight.current) {
        throw new Error('Selesaikan penyimpanan atau unduh pekerjaan yang belum tersimpan sebelum memulihkan cadangan.');
      }
      if (file.size > MAX_RESTORE_BYTES) throw new Error('Ukuran mentah file pemulihan maksimal 32 MiB.');
      const backup = parseRestoreFile(await file.text());
      const { ledger: restored } = backup;
      const counts = `${restored.state.wallets.length} dompet, ${restored.state.entries.length} transaksi`;
      const options = { replaceBlocked: true, replaceLedger: true, expectedData: data, expectedToken: ledger.revisionToken };
      if (backup.kind === 'full') {
        const settings = backup.categorySettings;
        setConfirm({
          title: 'Pulihkan cadangan lengkap?',
          text: `${counts}, ${settings.names.length} kategori, dan ${settings.rules.length} aturan dari file akan menggantikan catatan dan pengaturan kategori di browser ini. Cadangkan isi saat ini dulu jika masih diperlukan.`,
          label: 'Pulihkan semuanya',
          action: async () => {
            const saved = await persistCandidate(restored, {
              ...options, restoreCategories: { settings, expectedRaw: categoryPreferences.raw, ...(backup.budgets ? { budgets: backup.budgets } : {}), ...(backup.templates ? { templates: backup.templates } : {}) },
            });
            if (saved) notify('Cadangan lengkap dipulihkan. Transaksi dan pengaturan kategori sudah tersimpan.');
            else notify('Cadangan lengkap belum dipulihkan. Periksa status penyimpanan sebelum mencoba lagi.');
          },
        });
      } else {
        setConfirm({
          title: 'Pulihkan cadangan?',
          text: `${counts} akan menggantikan catatan di browser ini. Pengaturan kategori dan aturan pribadi tetap dipakai. Cadangkan catatan saat ini dulu jika masih diperlukan.`,
          label: 'Pulihkan data',
          action: async () => {
            if (await persistCandidate(restored, options)) notify('Cadangan berhasil dipulihkan dan tersimpan.');
          },
        });
      }
    } catch (err) { notify(err instanceof Error ? err.message : 'File cadangan tidak valid.'); }
    finally { if (restoreRef.current) restoreRef.current.value = ''; }
  }
  const titles = { overview: ['Halo, Zayyan.', 'Uangmu di mana-mana. Catatannya cukup di sini.'], wallets: ['Semua dompetmu.', 'Rekening dan e-wallet. Cash tidak dibukukan.'], transactions: ['Catatan kecil, lebih tenang.', 'Lihat uang yang masuk, keluar, dan berpindah.'], import: ['Biar file yang bantu.', 'Kurangi ketik satu-satu. Mulai dari mutasi rekening.'] };
  function navigate(next: Page) {
    if (mutationInFlight.current || next === page) return;
    if (page === 'transactions') {
      setLastHistoryScope({ currency, month });
      historyScrollY.current = window.scrollY;
    }
    if (next === 'transactions' && lastHistoryScope) {
      if (visibleCurrencies.includes(lastHistoryScope.currency) || activeState.wallets.some(wallet => wallet.currency === lastHistoryScope.currency)) {
        setCurrency(lastHistoryScope.currency);
      }
      setMonth(lastHistoryScope.month);
    }
    setPage(next);
  }
  function openHistory(walletId: string, period: HistoryPeriod, type = 'all') {
    if (mutationInFlight.current) return;
    historyScrollY.current = 0;
    setPage('transactions'); setQuery(''); setHistoryWallet(walletId); setFilter(type); setReviewReason('all');
    setHistoryPeriod(period); setHistoryPage(1); setSelectedEntryIds([]);
  }
  return <CategorySettingsContext.Provider value={categoryPreferences.settings}><div className="app-shell">
    <AppSidebar page={page} pendingCount={pendingCount} statusLabel={ledger.label} lastBackupText={lastBackupText} onNavigate={navigate} onBackupAll={() => void backupAll()} onBackupCurrent={() => backupCurrent()} onRestore={() => restoreRef.current?.click()} />
    <main className="main-content"><header className="topbar"><div className="breadcrumb">Ruang pribadi <ChevronRight size={13} /><strong>{NAVIGATION.find(n => n.page === page)?.label}</strong></div><div className="topbar-tools"><ThemePicker onNotice={notify} /><span className="local-indicator"><span className="status-dot" /> Lokal & pribadi</span><button className="icon-button" aria-label="Privasi dan cadangan" onClick={() => setPrivacyOpen(true)}><ShieldCheck size={18} /></button><span className="avatar small">Z</span></div></header>
      <div className="page-content"><div className="page-header"><div><div className="eyebrow">SEDIKIT DICATAT, BANYAK TERBANTU</div><h1 className="page-title">{titles[page][0]} {page === 'overview' && <span className="greeting-leaf">✳</span>}</h1><p className="page-subtitle">{titles[page][1]}</p></div><div className="page-actions">{page === 'wallets' ? <button className="button primary" onClick={() => openWallet('new')}><Plus size={18} /> Tambah dompet</button> : <><button className="button secondary" onClick={() => openTx('transfer')}><ArrowLeftRight size={17} /> Pindah uang</button><button className="button primary" onClick={() => openTx('expense')}><Plus size={18} /> Catat transaksi</button></>}</div></div>
      {mobileOverview && balanceCard}
      <div className="notice warning" role="note">Versi pengembangan lokal. Perbaikan digabung dan diuji bertahap; gunakan data contoh atau salinan cadangan untuk pemeriksaan.</div>
      {activeState.wallets.some(wallet => undatedWallets.has(wallet.id)) && <div className="notice warning">Ada tanggal posting yang belum diketahui. Saldo aktual dan laporan periode terkait belum dapat dianggap lengkap; nilai tersebut tetap ada pada saldo seluruh catatan.</div>}
      <div className={`notice ${ledger.dirty || storageError ? 'error' : ''}`} role="status" data-testid="save-status"><strong>{ledger.label}</strong>{storageError && <span>{storageError}</span>}
        {(ledger.dirty || blocked) && <><button className="button secondary small" onClick={() => backupCurrent(true)}>Unduh pekerjaan yang belum tersimpan</button>
          <button className="button secondary small" disabled={ledger.pending || !ledger.supported || !ledger.dirty} onClick={() => void retryDraft()}>Coba simpan lagi</button>
          <button className="button secondary small" disabled={ledger.pending} onClick={() => setConfirm({ title: 'Muat catatan terbaru?', text: ledger.dirty ? 'Unduh pekerjaan lokal terlebih dahulu jika masih diperlukan. Setelah dikonfirmasi, tampilan diganti dengan data browser terbaru.' : 'Uangku akan mencoba membaca kembali catatan di penyimpanan browser.', label: 'Muat catatan terbaru', action: () => { if (ledger.reloadLatest()) { setTxModal(null); setWalletModal(null); } } })}>Muat catatan terbaru</button></>}
      </div>
      {reminderReason && <div className="backup-reminder" role="status" data-testid="backup-reminder" data-reason={reminderReason}><span className="demo-banner-icon"><Download size={20} /></span><div className="demo-banner-copy"><strong>{reminderReason === 'never' ? 'Belum ada cadangan lengkap.' : 'Sudah lebih dari 7 hari sejak cadangan terakhir.'}</strong><span>{reminderReason === 'never' ? 'Catatan hanya tersimpan di browser ini. Unduh satu file cadangan supaya tidak hilang bila data situs terhapus.' : 'Catatan sudah berubah sejak itu. Unduh cadangan lengkap yang baru.'}</span></div><button className="button ghost small" onClick={() => void backupAll()}>Cadangkan sekarang</button><button className="button ghost small" onClick={closeReminder}>Nanti saja</button></div>}
      {data.demo && <div className="demo-banner"><span className="demo-banner-icon"><Sparkles size={20} /></span><div className="demo-banner-copy"><strong>Kenalan dulu pakai data contoh.</strong><span>{blocked ? 'Penyimpanan perlu dipulihkan. Yang tampil adalah contoh sementara.' : 'Transaksi yang kamu tambahkan di sini bisa dibawa saat mulai memakai data sendiri.'}</span></div><button className="button ghost small" disabled={ledger.pending || ledger.dirty} onClick={startOwn}>Mulai pakai data sendiri <ArrowRight size={16} /></button></div>}
      {page !== 'import' && !isReviewQueue && <div className="currency-toolbar"><div className="currency-tabs" aria-label="Mata uang">{shownCurrencyTabs.map(c => <button key={c.code} className={`currency-tab ${currency === c.code ? 'active' : ''}`} onClick={() => setCurrency(c.code)} aria-label={`${c.code === 'TRY' ? 'TL' : c.code} ${c.label}`} aria-pressed={currency === c.code}><span className="currency-flag">{currencyFlag(c.code)}</span><span className="currency-code">{c.code === 'TRY' ? 'TL' : c.code}</span><span className="currency-label">{c.label}{!visibleCurrencies.includes(c.code) ? ' · riwayat' : ''}</span></button>)}</div><button className="button secondary small currency-manage-button" onClick={openCurrencyManager}>Kelola mata uang</button>{page !== 'wallets' && (page !== 'transactions' || historyPeriod === 'month') && (page !== 'overview' || cashflowPeriod === 'month') && <label className="date-pill"><History size={15} /><input aria-label="Bulan laporan" type="month" value={month} onChange={e => { if (e.target.value) setMonth(e.target.value); }} /></label>}</div>}
      {page === 'overview' && <>
        <CashflowOverview {...cashflowResult} balanceCard={!mobileOverview && balanceCard} currency={currency} month={month} period={cashflowPeriod} walletId={cashflowScope} wallets={currencyWallets} archivedWalletIds={new Set(archivedCurrencyWallets.map(wallet => wallet.id))} onPeriodChange={setCashflowPeriod} onWalletChange={setCashflowWallet} />
        <div className="dashboard-columns"><section className="panel"><div className="panel-header"><div><h2>Dompetmu</h2><p>Uangnya ada di sini.</p></div><button className="text-link" onClick={() => navigate('wallets')}>Lihat semua <ArrowRight size={15} /></button></div><div className="wallet-list">{overviewWallets.map(w => <div className="wallet-row-wrap" key={w.id}><button className="wallet-row" onClick={() => openWallet(w)}><WalletSymbol wallet={w} /><span className="wallet-info"><strong className="wallet-name">{w.name}</strong><span className="wallet-detail">{kindLabel(w.kind)} · {w.currency}</span></span><strong className="wallet-amount">{actualText(w.id, w.currency)}</strong><ChevronRight size={16} /></button></div>)}{!availableCurrencyWallets.length && <div className="empty-state compact"><WalletIcon size={25} /><p>Belum ada dompet aktif {currency}.</p><button className="text-link" onClick={() => openWallet('new')}>Tambah dompet</button></div>}</div></section>
          <section className="panel category-panel"><div className="panel-header"><div><h2>Kategori pengeluaran terkonfirmasi</h2><p>{cashflowPeriod === 'all' ? 'Seluruh catatan hingga hari ini' : reportMonth} · cakupan rekening yang dipilih.</p></div><span className="category-heading-icon"><Tags size={18} /></span></div>{categoryRows.rows.length ? <div className="category-list">{categoryRows.rows.map((row, i) => {
            const color = COLORS[i % COLORS.length], limit = row.limit;
            const width = limit !== undefined ? Math.min(100, row.spent / limit * 100) : categoryExpenseTotal ? row.spent / categoryExpenseTotal * 100 : 0;
            const used = limit !== undefined ? `${formatMoney(row.spent, currency)} / ${formatMoney(limit, currency)}` : formatMoney(row.spent, currency);
            const status = limit === undefined ? '' : row.over ? `Lewat ${formatMoney(-(row.remaining ?? 0), currency)} dari anggaran` : `Sisa ${formatMoney(row.remaining ?? 0, currency)}`;
            return <div className={`category-row${limit !== undefined ? ' budgeted' : ''}${row.over ? ' over-budget' : ''}`} key={row.name}><div className="category-labels"><span className="category-name"><span className="category-dot" style={{ background: color }} />{row.name}</span><strong className="category-value">{used}</strong></div><div className="category-track" {...(limit !== undefined ? { role: 'progressbar', 'aria-label': `Anggaran ${row.name}`, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(width), 'aria-valuetext': `${used}. ${status}` } : {})}><span className="category-fill" style={{ width: `${width}%`, ...(row.over ? {} : { background: color }) }} /></div>{status && <span className="category-budget-note">{status}</span>}</div>;
          })}{categoryRows.hidden > 0 && <span className="field-help">+{categoryRows.hidden} kategori lainnya</span>}</div> : <div className="empty-state compact"><Leaf size={27} /><p>Belum ada pengeluaran terkonfirmasi dalam cakupan ini.</p></div>}{budgetsHidden && <p className="field-help category-budget-hint">Anggaran bulanan tampil saat periode bulanan dan semua rekening dipilih.</p>}<div className="category-legend"><span className="status-dot" /> Hanya kategori pengeluaran terkonfirmasi. Semua debit rekening tetap dihitung pada arus di atas.</div></section></div>
        {pendingCount > 0 && <button className="pending-banner" onClick={() => openHistory('all', 'all', 'pending')}><span className="pending-icon"><CircleHelp size={20} /></span><span><strong>{pendingCount} catatan bisa dirapikan nanti</strong><span>{pendingReview.type} jenis perlu dicek · {pendingReview.category} kategori belum diisi. Saldo sudah tercatat.</span></span><span className="pending-cta">Cek catatan <ArrowRight size={16} /></span></button>}
        <section className="panel transactions-panel"><div className="panel-header"><div><h2>Transaksi terbaru</h2><p>{dashboardWallet?.name ?? `Semua rekening & e-wallet ${currency}`} · {cashflowPeriod === 'all' ? 'Semua periode' : reportMonth}</p></div><button className="text-link" onClick={() => openHistory(cashflowScope, cashflowPeriod)}>Semua transaksi <ArrowRight size={15} /></button></div><TransactionTable entries={allTransactions.slice(0, 5)} state={state} data={data} onEdit={editEntry} onDelete={deleteEntry} onDetail={setAmountDetail} /></section>
      </>}
      {page === 'wallets' && <WalletsPage hasCashArchive={cashWallets.length > 0} onOpenCashArchive={() => setCashArchiveOpen(true)} walletView={walletView} onWalletViewChange={setWalletView} activeCount={availableCurrencyWallets.length} archivedCount={archivedCurrencyWallets.length} currency={currency} currencyName={currencyLabel(currency)} clockDay={clockDay} total={walletPageTotal} wallets={displayedWallets} actualText={actualText} onOpenWallet={openWallet} onRecord={walletId => openTx('expense', walletId)} onCheckBalance={walletId => openTx('adjustment', walletId)} onShowHistory={w => { setCurrency(w.currency); openHistory(w.id, 'all'); }} onRestore={w => requestWalletAction(w, 'restore')} />}
      {page === 'transactions' && <section className="panel transactions-panel">{categoryTools}{isReviewQueue && <div className="review-scope"><CircleHelp size={19} /><div><strong>Perlu dirapikan · <span data-testid="review-total" data-count={pendingCount}>{pendingCount}</span> catatan</strong><p>Semua mata uang dan semua periode. <span data-testid="review-types" data-count={pendingReview.type}>{pendingReview.type}</span> jenis perlu dicek · <span data-testid="review-categories" data-count={pendingReview.category}>{pendingReview.category}</span> kategori belum diisi. Satu catatan bisa memiliki dua alasan; total tidak dihitung ganda. Saldo mutasi sudah tercatat.</p></div></div>}<HistoryFilters isReviewQueue={isReviewQueue} query={query} onQueryChange={value => { setQuery(value); if (value.trim() && !query.trim()) setHistoryPeriod('all'); }} period={historyPeriod} periodMonthLabel={reportMonth} onPeriodChange={setHistoryPeriod} walletId={validHistoryWallet ?? 'all'} walletOptions={activeState.wallets.filter(wallet => isReviewQueue ? !isWalletArchived(data, wallet.id) : wallet.currency === currency).map(wallet => ({ id: wallet.id, name: wallet.name, archived: isWalletArchived(data, wallet.id) }))} onWalletChange={setHistoryWallet} typeFilter={filter} onTypeFilterChange={setFilter} reviewReason={reviewReason} onReviewReasonChange={setReviewReason} onReset={() => { openHistory('all', 'month'); setMonth(clockDay.slice(0, 7)); }} onDownloadCsv={downloadHistoryCsv} transactionCount={allTransactions.length} pendingCount={pendingCount} />{selectedEntries.length > 0 && <BulkReviewPanel entries={selectedEntries} onApply={applyBulkCategory} onClear={() => setSelectedEntryIds([])} />}<p className="field-help history-scope" role="status">{isReviewQueue ? 'Semua mata uang · semua periode' : `${currency} · ${historyPeriod === 'all' ? 'Semua periode' : reportMonth}`} · {allTransactions.length} transaksi. Pilih catatan di halaman ini untuk kategori massal.</p><TransactionTable entries={historySlice.entries} state={state} data={data} onEdit={editEntry} onDelete={deleteEntry} onDetail={setAmountDetail} selection={selection} /><nav className="history-pagination" aria-label="Halaman riwayat"><span role="status">{historySlice.start}–{historySlice.end} dari {historySlice.total} · Halaman {historySlice.page} dari {historySlice.pageCount}</span><div><button className="button secondary small" disabled={historySlice.page <= 1} onClick={() => setHistoryPage(historySlice.page - 1)}>Halaman sebelumnya</button><button className="button secondary small" disabled={historySlice.page >= historySlice.pageCount} onClick={() => setHistoryPage(historySlice.page + 1)}>Halaman berikutnya</button></div></nav></section>}
      {page === 'import' && <><div className="currency-import-toolbar"><button className="button secondary small" onClick={openCurrencyManager}>Kelola mata uang</button></div>{categoryTools}<StatementReview data={data} onCommit={saveDocument} disabled={ledger.pending || ledger.dirty || !ledger.supported || blocked} /><RecoveryImportView data={data} key={data.demo ? 'demo' : 'own'} state={state} demo={data.demo} onStart={startOwn} onImport={importState} notify={notify} disabled={ledger.pending || ledger.dirty || !ledger.supported || blocked} preferredCurrency={currency} onAddWallet={(requested) => { if (requested) setCurrency(requested); openWallet('new'); }} /></>}
      <MobileFooter statusLabel={ledger.label} lastBackupText={lastBackupText} onBackupAll={() => void backupAll()} onBackupCurrent={() => backupCurrent()} onRestore={() => restoreRef.current?.click()} onPrivacy={() => setPrivacyOpen(true)} />
      </div>
    </main>
    <MobileNav page={page} onNavigate={navigate} />
    <input ref={restoreRef} type="file" accept=".json,application/json" aria-label="File cadangan Uangku" hidden onChange={e => void restore(e.target.files?.[0])} />
    {walletModal && <WalletEditor key={walletModal === 'new' ? 'new' : walletModal.id} existing={walletModal === 'new' ? undefined : walletModal} defaultCurrency={visibleCurrencies.includes(currency) ? currency : visibleCurrencies[0]} currencies={visibleCurrencies} usage={walletModal === 'new' || !state.wallets.some(wallet => wallet.id === walletModal.id) ? undefined : walletUsage(data, walletModal.id)} disabled={ledger.pending || ledger.dirty || blocked || !ledger.supported || walletModal !== 'new' && (!state.wallets.some(wallet => wallet.id === walletModal.id) || isWalletArchived(data, walletModal.id))} disabledReason={ledger.dirty || blocked || !ledger.supported ? 'Penyimpanan belum siap. Selesaikan pemulihan atau konflik pada status penyimpanan dahulu; isian tetap dipertahankan.' : walletModal !== 'new' && (!state.wallets.some(wallet => wallet.id === walletModal.id) || isWalletArchived(data, walletModal.id)) ? 'Dompet berubah, dihapus, atau diarsipkan di tab lain. Tutup untuk membuka daftar terbaru.' : ''} onSave={saveWallet} onClose={() => { if (!mutationInFlight.current) setWalletModal(null); }} onArchive={walletModal === 'new' ? undefined : () => requestWalletAction(walletModal, 'archive', walletEditorBase.current!)} onDelete={walletModal === 'new' ? undefined : () => requestWalletAction(walletModal, 'delete', walletEditorBase.current!)} />}
    {txModal && <TransactionModal data={data} state={state} onSaveTemplate={transactionTemplates.add} templates={transactionTemplates.templates} templatesError={transactionTemplates.error} undatedWallets={undatedWallets} initialMode={txModal.type} initialWallet={txModal.walletId} existing={txModal.existing} disabled={ledger.pending} onUnpair={txModal.existing?.type === 'transfer' ? () => unpairTransfer(txModal.existing!) : undefined} onSave={saveEntry} onClose={() => { if (!mutationInFlight.current) setTxModal(null); }} onDelete={txModal.existing ? () => { if (mutationInFlight.current) return; const entry = txModal.existing!; const token = editorBaseToken.current; setTxModal(null); deleteEntry(entry, token); } : undefined} />}
    {amountDetail && <AmountDetailModal entry={amountDetail} state={state} data={data} onClose={() => setAmountDetail(null)} />}
    {currencyManager && <CurrencyManager data={currencyManager.data} disabled={ledger.pending || ledger.dirty || blocked || !ledger.supported} onSave={saveCurrencyList} onView={code => { setCurrency(code); setCurrencyManager(null); navigate('overview'); }} onClose={() => { if (!mutationInFlight.current) setCurrencyManager(null); }} />}
    {categoryManager && <CategoryManager settings={categoryManager.settings} budgets={categoryManager.budgets} budgetsError={categoryManager.budgetsError} currencies={visibleCurrencies} currency={currency} notice={categoryPreferences.error || (categoryPreferences.packAdded || categoryPreferences.packUpdated ? `${categoryPreferences.packAdded} kata kunci tambahan aktif dan ${categoryPreferences.packUpdated} pemetaan bawaan disesuaikan. Kategori dan aturan pribadi dipertahankan.` : undefined)} onSave={saveCategorySettings} onClose={() => setCategoryManager(null)} />}
    {categoryAutomation && <CategoryAutomation data={categoryAutomation.data} disabled={ledger.dirty || blocked || !ledger.supported} onApply={applyAutomaticCategories} onClose={() => { if (!mutationInFlight.current) setCategoryAutomation(null); }} />}
    {cashArchiveOpen && <CashArchive data={data} onClose={() => setCashArchiveOpen(false)} />}
    {privacyOpen && <PrivacyNotice persistence={persistence} onClose={() => setPrivacyOpen(false)} />}
    {demoReview && <StartOwnModal data={demoReview.data} persisted={demoReview.token !== null} busy={ledger.pending} onClose={() => { if (!mutationInFlight.current) setDemoReview(null); }} onCarry={ids => void finishStartOwn(demoReview, ids)} onEmpty={() => void finishStartOwn(demoReview)} />}
    {confirm && <Modal title={confirm.title} onClose={() => { if (!mutationInFlight.current) setConfirm(null); }}><div className="modal-body"><p className="confirm-copy">{confirm.text}</p>{confirm.requireReason && <label className="field"><span className="field-label">Alasan tindakan</span><input aria-label="Alasan tindakan" className="field-input" maxLength={2000} value={confirmReason} onChange={event => setConfirmReason(event.target.value)} /></label>}{confirm.allowBankAnnotations && <label className="checkbox-row"><input type="checkbox" checked={confirmBankAnnotations} onChange={event => setConfirmBankAnnotations(event.target.checked)} />Bila anotasi lama tidak lengkap tetapi kedua fakta bank tersedia, gunakan anotasi bank sebagai catatan baru. Informasi lama yang hilang tidak dianggap pulih.</label>}</div><div className="modal-footer"><button className="button secondary" onClick={() => { if (!mutationInFlight.current) setConfirm(null); }}>Batal</button><button className={`button ${confirm.label.startsWith('Hapus') ? 'danger' : 'primary'}`} disabled={ledger.pending || !!confirm.requireReason && !confirmReason.trim()} onClick={() => void runConfirmation()}>{confirm.label}</button></div></Modal>}
    {toast && <div className="toast" role="status"><CheckCircle2 size={19} /><span>{toast}</span><button aria-label="Tutup pemberitahuan" onClick={() => setToast('')}><X size={15} /></button></div>}
  </div></CategorySettingsContext.Provider>;
}
