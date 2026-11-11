import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeftRight, BookmarkPlus, Check, ChevronLeft, ChevronRight, Lightbulb, Pencil, Trash2, Zap } from 'lucide-react';
import { entrySignedAmount, formatDate, formatMoney, makeId, parseMoney, validateEntry, walletBalanceAt, type Entry, type State } from '../lib/finance';
import { CategorySettingsContext } from '../hooks/useCategorySettings';
import { categoryChoices, isUncategorized } from '../lib/categorySettings';
import { orderCategories } from '../lib/categoryOrder';
import { createCategorySuggester } from '../lib/categorySuggestions';
import { createBankEntryHintLookup } from '../lib/bankEntryHints';
import { transferPostingDates } from '../lib/transferPostings';
import { formatMoneyInput } from '../lib/moneyFormatting';
import { preferredDestination } from '../lib/preferences';
import { convertMinorCurrency, deriveCurrencyRate, currencyDigits, isCurrencyConversionConsistent } from '../lib/currencyCatalog';
import { transferCandidates } from '../lib/review';
import type { StoredData } from '../lib/storage';
import { isWalletArchived, archivedReadOnlyEntryIds } from '../lib/walletLifecycle';
import { templateFill, type TransactionTemplate } from '../lib/transactionTemplates';
import { dayBefore, deviceDay } from '../lib/today';
import Modal from './Modal';
import MoneyEcho from './MoneyEcho';
import SourceDetails from './SourceDetails';
export type TxMode = 'expense' | 'income' | 'transfer' | 'adjustment' | 'movement';
const today = () => deviceDay();
const yesterday = () => dayBefore(today());
const moneyInput = formatMoneyInput;
const typeLabels = { expense: 'Pengeluaran', income: 'Pemasukan', transfer: 'Transfer', movement: 'Perpindahan dana', adjustment: 'Penyesuaian', unreviewed: 'Perlu dicek' };
/** One line under the type tabs; "Perpindahan dana" and "Transfer" are otherwise easy to mix up. */
const TYPE_HINTS: Record<TxMode, string> = {
  expense: 'Uang keluar untuk belanja atau tagihan.',
  income: 'Uang masuk sebagai penghasilan, mis. gaji atau kiriman.',
  movement: 'Uang masuk atau keluar rekening yang bukan belanja maupun penghasilan, mis. kiriman ke rekening orang lain.',
  transfer: 'Pindah uang antara dua dompetmu sendiri. Jumlah seluruh uangmu tidak berubah.',
  adjustment: 'Cocokkan catatan dengan saldo yang sebenarnya ada hari ini.',
};
export interface EntrySaveOptions { reason: string; sourceDate: string | null; destinationDate: string | null; declareDates?: true }

export default function TransactionModal({ data, state, undatedWallets, initialMode, initialWallet, existing, onSave, onSaveTemplate, onRemoveTemplate, onRenameTemplate, templates = [], templatesError = '', onClose, onDelete, onUnpair, disabled = false }: {
  data: StoredData; state: State; undatedWallets: ReadonlySet<string>; initialMode: TxMode; initialWallet?: string; existing?: Entry;
  onSave: (entry: Entry, removeIds: string[], keepOpen?: boolean, options?: EntrySaveOptions) => Promise<boolean>; onClose: () => void; onDelete?: () => void; onUnpair?: () => void; disabled?: boolean;
  /** Saves a template only; it never records a transaction. Rejects with a message on failure. */
  onSaveTemplate?: (template: TransactionTemplate) => Promise<void>;
  /** Template upkeep. Both reject with a message and leave the stored list as it was. */
  onRemoveTemplate?: (id: string) => Promise<void>;
  onRenameTemplate?: (id: string, name: string) => Promise<void>;
  /** Saved templates offered as quick fills above a new expense or income form. */
  templates?: readonly TransactionTemplate[];
  templatesError?: string;
}) {
  const validationRef = useRef<HTMLDivElement>(null);
  const categorySettings = useContext(CategorySettingsContext);
  const bankHint = useMemo(() => existing ? createBankEntryHintLookup(data)(existing) : null, [data, existing]);
  const readOnlyEntryIds = useMemo(() => archivedReadOnlyEntryIds(data), [data]);
  const activeWallets = state.wallets.filter(wallet => wallet.kind !== 'cash' && !isWalletArchived(data, wallet.id));
  const importedPending = existing?.type === 'unreviewed';
  const importedFlow = importedPending || existing?.type === 'movement';
  const incomingPending = importedFlow && existing.amount > 0;
  const [type, setType] = useState<TxMode>(existing?.type === 'unreviewed' ? (existing.amount > 0 ? 'income' : 'expense') : existing?.type ?? initialMode);
  const [walletId, setWallet] = useState(existing?.walletId ?? initialWallet ?? activeWallets[0]?.id ?? '');
  const balanceDay = today();
  const adjustment = useMemo(() => {
    if (type !== 'adjustment' || !walletId) return null;
    try {
      if (undatedWallets.has(walletId)) throw new Error('Tanggal posting belum diketahui.');
      const current = walletBalanceAt(state, walletId, balanceDay, data.metadata);
      const beforeEdit = existing
        ? walletBalanceAt({ ...state, entries: state.entries.filter(entry => entry.id !== existing.id) }, walletId, balanceDay, data.metadata)
        : current;
      return { current, beforeEdit, error: '' };
    } catch (reason) {
      return { current: null, beforeEdit: null, error: reason instanceof Error ? reason.message : 'Saldo aktual belum tersedia.' };
    }
  }, [type, walletId, balanceDay, state, data.metadata, existing, undatedWallets]);
  const [toWalletId, setToWallet] = useState(existing?.toWalletId ?? preferredDestination(activeWallets, walletId));
  const [movementDirection, setMovementDirection] = useState<'in' | 'out'>(existing && entrySignedAmount(existing) > 0 ? 'in' : 'out');
  const [amount, setAmount] = useState(() => {
    if (!existing) return '';
    const initial = existing.type === 'adjustment' ? adjustment?.current : Math.abs(existing.amount);
    return initial == null ? '' : moneyInput(initial, state.wallets.find(wallet => wallet.id === existing.walletId)?.currency ?? 'IDR');
  });
  const [received, setReceived] = useState(existing?.toAmount ? moneyInput(existing.toAmount, state.wallets.find(wallet => wallet.id === existing.toWalletId)?.currency ?? 'IDR') : '');
  const [rateText, setRate] = useState(existing?.rate?.toString().replace('.', ',') ?? '');
  const [fxMode, setFxMode] = useState<'rate' | 'received'>('rate');
  const [fee, setFee] = useState(existing?.fee ? moneyInput(existing.fee, state.wallets.find(wallet => wallet.id === existing.walletId)?.currency ?? 'IDR') : '');
  const [date, setDate] = useState(existing?.date ?? today());
  const originalDates = existing?.type === 'transfer' ? transferPostingDates(existing, data.metadata) : null;
  const [destinationDate, setDestinationDate] = useState(originalDates?.destination ?? (existing ? '' : today()));
  const [sourceDate, setSourceDate] = useState(originalDates?.source ?? (existing && existing.amount > 0 ? '' : existing?.date ?? today()));
  const [declareDates, setDeclareDates] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState(existing?.note ?? '');
  const [category, setCategory] = useState(existing?.category || 'Belum dikategorikan');
  const [confirmed, setConfirmed] = useState(false);
  const [pairId, setPairId] = useState('');
  // A new transfer starts with one date for both sides. An existing one always shows both: its dates can be
  // unknown or differ, and that must stay visible rather than be filled in by a guess.
  const [datesSplit, setDatesSplit] = useState(false);
  const splitDates = datesSplit || !!existing || !!pairId || sourceDate !== destinationDate;
  const [error, setError] = useState('');
  useEffect(() => { if (error) { validationRef.current?.scrollIntoView({ block: 'nearest' }); validationRef.current?.focus({ preventScroll: true }); } }, [error]);
  const amountRef = useRef<HTMLInputElement>(null);
  const draft = { type, walletId, toWalletId, movementDirection, amount, received, rateText, fxMode, fee,
    date, destinationDate, sourceDate, declareDates, reason, note, category, confirmed, pairId };
  const cleanDraft = useRef(draft);
  const saving = useRef(false);
  const [askDiscard, setAskDiscard] = useState(false);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState('');
  const [templateNotice, setTemplateNotice] = useState('');
  const [templateSaving, setTemplateSaving] = useState(false);
  const [fillNotice, setFillNotice] = useState<{ name: string; warnings: string[] } | null>(null);
  const [manageTemplates, setManageTemplates] = useState(false);
  const [templateEdit, setTemplateEdit] = useState<{ id: string; name: string } | null>(null);
  const [templateManageError, setTemplateManageError] = useState('');
  const [templateBusy, setTemplateBusy] = useState(false);
  async function changeTemplates(action: () => Promise<void>) {
    if (templateBusy || saving.current || disabled) return;
    setTemplateBusy(true); setTemplateManageError('');
    try { await action(); setTemplateEdit(null); setFillNotice(null); }
    catch (reason) { setTemplateManageError(reason instanceof Error ? reason.message : 'Template belum berubah.'); }
    finally { setTemplateBusy(false); }
  }
  const canManageTemplates = !!onRemoveTemplate && !!onRenameTemplate && !templatesError && templates.length > 0;
  // Categories this kind of entry already uses come first; the rest keep the order of the settings.
  const categoryOrder = useMemo(() => orderCategories(categoryChoices(categorySettings, category), state.entries, type), [categorySettings, category, state.entries, type]);
  const suggestCategory = useMemo(() => createCategorySuggester(categorySettings), [categorySettings]);
  // Manual entries only: imported rows get their suggestions from the bank wording in the review tools.
  const noteSuggestions = useMemo(() => existing?.sourceKey || !note.trim() || !isUncategorized(category) || type !== 'expense' && type !== 'income' ? []
    : [...new Set(suggestCategory(note, type).suggestions.map(item => item.category))].filter(name => categorySettings.names.includes(name)).slice(0, 3),
  [existing, note, category, type, suggestCategory, categorySettings.names]);
  const continueButton = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (askDiscard) continueButton.current?.focus();
    else if (previousFocus.current) {
      previousFocus.current.focus();
      previousFocus.current = null;
    }
  }, [askDiscard]);

  function requestClose() {
    if (disabled || saving.current) return;
    if (JSON.stringify(draft) === JSON.stringify(cleanDraft.current)) return onClose();
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : amountRef.current;
    setAskDiscard(true);
  }
  const source = state.wallets.find(w => w.id === walletId);
  const destination = state.wallets.find(w => w.id === toWalletId);
  const crossCurrency = type === 'transfer' && source && destination && source.currency !== destination.currency;
  const minor = parseMoney(amount, source?.currency ?? 'IDR');
  const rateNumber = /^\d+(?:[.,]\d+)?$/.test(rateText.trim()) ? Number(rateText.replace(',', '.')) : NaN;
  let toMinor: number | null = !crossCurrency ? minor : null;
  let effectiveRate = crossCurrency ? rateNumber : 1;
  let conversionFailed = false;
  if (crossCurrency && source && destination) {
    // A stored target may differ by one minor unit from exact rate rounding.
    // Preserve that accepted historical tuple when only annotations change;
    // newly entered conversion fields still use strict overflow checking.
    if (existing?.type === 'transfer' && walletId === existing.walletId && toWalletId === existing.toWalletId
      && minor === existing.amount && rateNumber === existing.rate && typeof existing.toAmount === 'number'
      && typeof existing.rate === 'number' && parseMoney(received, destination.currency) === existing.toAmount
      && isCurrencyConversionConsistent(existing.amount, source.currency, destination.currency, existing.rate, existing.toAmount)) {
      toMinor = existing.toAmount; effectiveRate = existing.rate;
    } else {
      try {
        toMinor = fxMode === 'received' ? parseMoney(received, destination.currency)
          : minor !== null && Number.isFinite(rateNumber) ? convertMinorCurrency(minor, source.currency, destination.currency, rateNumber) : null;
        if (fxMode === 'received') effectiveRate = minor && toMinor ? deriveCurrencyRate(minor, source.currency, toMinor, destination.currency) : NaN;
      } catch { toMinor = null; effectiveRate = NaN; conversionFailed = true; }
    }
  }
  // A new balance check is always about today; an existing one keeps its own editable date.
  const lockedToday = type === 'adjustment' && !existing;
  const adjustmentDifference = type === 'adjustment' && amount.trim() && minor !== null && adjustment?.beforeEdit != null ? minor - adjustment.beforeEdit : null;
  const invalidFx = !!crossCurrency && (conversionFailed || (fxMode === 'rate' && !!rateText.trim() && (!Number.isFinite(rateNumber) || rateNumber <= 0 || minor !== null && toMinor === null)) || (fxMode === 'received' && !!received.trim() && (toMinor === null || toMinor <= 0)) || (toMinor !== null && !Number.isSafeInteger(toMinor)));
  const pairCandidates = type === 'transfer' && existing ? state.entries.filter(e =>
    e.id !== existing.id && !readOnlyEntryIds.has(e.id) && !state.wallets.some(w => w.kind === 'cash' && w.id === e.walletId) && (e.type === 'unreviewed' || e.type === 'movement') && e.walletId === (incomingPending ? walletId : toWalletId)
    && (incomingPending ? e.amount < 0 : e.amount > 0)
    && Math.abs(new Date(e.date).getTime() - new Date(date).getTime()) <= 3 * 86400000,
  ) : [];
  const suggestedPairs = importedFlow && existing ? transferCandidates({ ...state, wallets: activeWallets, entries: state.entries.filter(e => activeWallets.some(w => w.id === e.walletId)) }, existing.id).slice(0, 4) : [];
  function useSuggestedPair(id: string) {
    const pair = state.entries.find(e => e.id === id);
    if (!pair || !existing || !suggestedPairs.some(candidate => candidate.id === id)) return;
    setType('transfer'); setPairId(pair.id); setConfirmed(false); setError(''); setFee(''); setFxMode('received');
    if (incomingPending) {
      setWallet(pair.walletId); setToWallet(existing.walletId);
      setAmount(moneyInput(Math.abs(pair.amount), state.wallets.find(wallet => wallet.id === pair.walletId)?.currency ?? 'IDR')); setReceived(moneyInput(existing.amount, state.wallets.find(wallet => wallet.id === existing.walletId)?.currency ?? 'IDR'));
      setSourceDate(pair.date); setDestinationDate(existing.date);
    } else {
      setWallet(existing.walletId); setToWallet(pair.walletId);
      setAmount(moneyInput(Math.abs(existing.amount), state.wallets.find(wallet => wallet.id === existing.walletId)?.currency ?? 'IDR')); setReceived(moneyInput(pair.amount, state.wallets.find(wallet => wallet.id === pair.walletId)?.currency ?? 'IDR'));
      setSourceDate(existing.date); setDestinationDate(pair.date);
    }
  }
  function changeType(next: TxMode) {
    if (next === type) return;
    setType(next); setError(''); setPairId(''); setConfirmed(false);
    if (next === 'transfer' && importedFlow && incomingPending) {
      setToWallet(existing.walletId);
      const from = activeWallets.find(w => w.id !== existing.walletId);
      setWallet(from?.id ?? '');
      setReceived(moneyInput(existing.amount, state.wallets.find(wallet => wallet.id === existing.walletId)?.currency ?? 'IDR')); setFxMode('received');
      setSourceDate(''); setDestinationDate(existing.date);
      setAmount(from?.currency === state.wallets.find(w => w.id === existing.walletId)?.currency ? moneyInput(existing.amount, state.wallets.find(wallet => wallet.id === existing.walletId)?.currency ?? 'IDR') : '');
    } else if (next === 'transfer') {
      setToWallet(preferredDestination(activeWallets, walletId));
    } else if (next === 'adjustment') {
      if (existing) setWallet(existing.walletId); else setDate(today());
      setAmount('');
    } else if (existing) { setWallet(existing.walletId); setAmount(moneyInput(Math.abs(existing.amount), state.wallets.find(wallet => wallet.id === existing.walletId)?.currency ?? 'IDR')); }
  }
  function selectPair(id: string) {
    setPairId(id); setConfirmed(false);
    const pair = state.entries.find(e => e.id === id);
    if (!pair) return;
    if (incomingPending) setAmount(moneyInput(Math.abs(pair.amount), state.wallets.find(wallet => wallet.id === pair.walletId)?.currency ?? 'IDR'));
    else setReceived(moneyInput(pair.amount, state.wallets.find(wallet => wallet.id === pair.walletId)?.currency ?? 'IDR'));
    setSourceDate(incomingPending ? pair.date : existing?.date ?? date);
    setDestinationDate(incomingPending ? existing?.date ?? date : pair.date);
    setFxMode('received');
  }
  const canTemplate = !existing && !!onSaveTemplate && (type === 'expense' || type === 'income');
  const showTemplates = !existing && (initialMode === 'expense' || initialMode === 'income') && (templates.length > 0 || !!templatesError);
  function useTemplate(template: TransactionTemplate) {
    if (saving.current || disabled) return;
    const fill = templateFill(template, activeWallets, categorySettings.names, today());
    setType(fill.type); setPairId(''); setConfirmed(false); setError('');
    if (fill.walletId) setWallet(fill.walletId);
    const currency = state.wallets.find(wallet => wallet.id === (fill.walletId || walletId))?.currency ?? template.currency;
    setAmount(fill.amount !== null ? moneyInput(fill.amount, currency) : '');
    setCategory(fill.category); setNote(fill.note); setDate(fill.date);
    setTemplateName(null); setTemplateError(''); setTemplateNotice('');
    setFillNotice({ name: template.name, warnings: fill.warnings });
    requestAnimationFrame(() => amountRef.current?.focus());
  }
  function openTemplate() {
    setTemplateError(''); setTemplateNotice('');
    setTemplateName((note.trim() || (category !== 'Belum dikategorikan' ? category : typeLabels[type])).slice(0, 60));
  }
  async function saveTemplate() {
    if (!onSaveTemplate || templateName === null || templateSaving || saving.current || disabled) return;
    if (type !== 'expense' && type !== 'income') return;
    setTemplateError(''); setTemplateNotice('');
    if (!source) return setTemplateError('Pilih dompet untuk template ini.');
    const name = templateName.trim();
    if (!name) return setTemplateError('Isi nama template.');
    const templateAmount = amount.trim() ? parseMoney(amount, source.currency) : null;
    if (amount.trim() && (templateAmount === null || templateAmount <= 0)) return setTemplateError('Nominal template harus lebih besar dari nol, atau kosongkan nominal bila berubah-ubah.');
    const template: TransactionTemplate = { id: makeId(), name, type, walletId: source.id, currency: source.currency, category, note: note.trim(), ...(templateAmount ? { amount: templateAmount } : {}) };
    setTemplateSaving(true);
    try {
      await onSaveTemplate(template);
      setTemplateName(null);
      setTemplateNotice(`Template “${name}” tersimpan. Transaksi belum dicatat; klik Simpan transaksi bila ingin mencatatnya sekarang.`);
    } catch (reason) {
      setTemplateError(reason instanceof Error ? reason.message : 'Template belum tersimpan.');
    } finally { setTemplateSaving(false); }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving.current || disabled || askDiscard || templateSaving) return;
    setError('');
    if (isWalletArchived(data, walletId) || type === 'transfer' && isWalletArchived(data, toWalletId) || existing && readOnlyEntryIds.has(existing.id)) return setError('Dompet diarsipkan. Pulihkan sebelum mengubah atau mencatat transaksi.');
    if (minor === null || !source) return setError('Isi dompet dan nominal yang valid.');
    if (type === 'movement' && minor <= 0) return setError('Isi nominal perpindahan lebih besar dari nol; gunakan pilihan arah untuk masuk atau keluar rekening.');
    if (crossCurrency && (!Number.isFinite(effectiveRate) || effectiveRate <= 0 || toMinor === null || !Number.isSafeInteger(toMinor) || toMinor <= 0)) return setError('Kurs dan nominal diterima harus valid dan lebih besar dari nol. Periksa kolom kurs atau jumlah diterima.');
    if (crossCurrency && !confirmed) return setError('Konfirmasi kurs transaksi ini terlebih dahulu.');
    const feeMinor = fee.trim() ? parseMoney(fee, source.currency) : 0;
    if (feeMinor === null || feeMinor < 0) return setError('Biaya transfer belum valid.');
    if (importedPending || existing?.type === 'movement' && type === 'transfer') {
      if (type === 'transfer' && incomingPending && (toWalletId !== existing.walletId || walletId === existing.walletId)) return setError('Dompet penerima harus tetap sama dengan rekening pada mutasi.');
      if ((!incomingPending || type !== 'transfer') && walletId !== existing.walletId) return setError('Dompet harus tetap sama dengan rekening pada mutasi.');
      if (type === 'transfer' && incomingPending && toMinor !== existing.amount) return setError('Nominal diterima harus sama dengan nominal masuk pada mutasi.');
      if ((!incomingPending || type !== 'transfer') && minor !== Math.abs(existing.amount)) return setError('Nominal harus tetap sesuai dengan mutasi yang diimpor.');
      if (type === 'transfer' && !incomingPending && feeMinor) return setError('Nominal keluar sudah sesuai mutasi. Catat biaya dari baris biaya bank yang terpisah.');
    }
    const removeIds = existing ? [existing.id] : [];
    const pair = pairId ? state.entries.find(e => e.id === pairId) : undefined;
    if (pair && type === 'transfer') {
      if (incomingPending && feeMinor) return setError('Nominal pasangan sudah sesuai mutasi. Catat biaya bank dari barisnya sendiri.');
      if (!['unreviewed', 'movement'].includes(pair.type) || pair.walletId !== (incomingPending ? walletId : toWalletId)
        || Math.abs(pair.amount) !== (incomingPending ? minor : toMinor)) return setError('Transaksi pasangan belum cocok dengan nominal transfer.');
      removeIds.push(pair.id);
    }
    if (type === 'transfer' && (!existing || existing.type !== 'transfer' || declareDates) && (!sourceDate || !destinationDate)) return setError('Isi tanggal debit dan tanggal kredit masing-masing. Tanggal yang belum diketahui tidak akan ditebak.');
    const cleanState = { ...state, entries: state.entries.filter(e => !removeIds.includes(e.id)) };
    const entry: Entry = {
      id: existing?.id ?? makeId(), type, walletId, amount: minor, date: type === 'transfer' ? sourceDate || date : date,
      category: type === 'expense' || type === 'income' || type === 'movement' ? category : '', note: note.trim(),
      ...(existing?.sourceKey && !(type === 'transfer' && incomingPending) ? { sourceKey: existing.sourceKey } : {}),
      ...(existing?.importBatch ? { importBatch: existing.importBatch } : {}),
    };
    if (type === 'movement') entry.amount = movementDirection === 'out' ? -minor : minor;
    if (type === 'adjustment') {
      if (date !== today() || date !== balanceDay) return setError('Cek saldo membandingkan saldo aktual hari ini. Gunakan tanggal hari ini; transaksi masa depan tetap bisa dicatat sebagai pemasukan, pengeluaran, atau transfer.');
      if (adjustment?.beforeEdit == null) return setError(adjustment?.error || 'Saldo aktual belum tersedia.');
      entry.amount = minor - adjustment.beforeEdit;
    }
    if (type === 'transfer') {
      entry.toWalletId = toWalletId; entry.toAmount = toMinor ?? 0; entry.rate = effectiveRate; entry.fee = feeMinor;
      if (incomingPending) { if (existing?.sourceKey) entry.toSourceKey = existing.sourceKey; if (pair?.sourceKey) entry.sourceKey = pair.sourceKey; }
      else if (pair?.sourceKey) entry.toSourceKey = pair.sourceKey;
      else if (existing?.toSourceKey) entry.toSourceKey = existing.toSourceKey;
    }
    const problem = validateEntry(cleanState, entry);
    if (problem) return setError(problem);
    // The domain command and guarded storage validate all balances atomically.
    // Keep field checks here without scanning every wallet a second time.
    const repeat = !existing && (type === 'expense' || type === 'income')
      && (e.nativeEvent as SubmitEvent).submitter?.getAttribute('data-repeat') === 'true';
    const hasFacts = data.metadata?.links.some(link => link.entryId === existing?.id);
    const signed = entrySignedAmount;
    const changedMoney = existing && (existing.walletId !== entry.walletId || existing.date !== entry.date || signed(existing) !== signed(entry) || existing.toAmount !== entry.toAmount || existing.toWalletId !== entry.toWalletId || (existing.fee ?? 0) !== (entry.fee ?? 0));
    if (hasFacts && changedMoney && !reason.trim() && !pair) return setError('Isi alasan perubahan agar perbedaan dari data bank dapat ditelusuri.');
    const options: EntrySaveOptions = { reason: reason.trim(), sourceDate: type === 'transfer' ? sourceDate || null : null, destinationDate: type === 'transfer' ? destinationDate || null : null, ...(declareDates || !existing || existing.type !== 'transfer' ? { declareDates: true } : {}) };
    saving.current = true;
    try {
      if (await onSave(entry, removeIds, repeat, options) && repeat) {
        cleanDraft.current = { ...draft, amount: '', note: '' };
        setAmount(''); setNote(''); setError('');
        requestAnimationFrame(() => amountRef.current?.focus());
      }
    } finally {
      saving.current = false;
    }
  }
  // The reason matters only where money, wallet or date can move away from the bank's facts: not while checking an
  // imported row whose fields are locked, and not when two imported rows are merely joined into one transfer.
  const showReason = !!existing && (type === 'transfer' ? existing.type === 'transfer' || !pairId : !!(existing.sourceKey || existing.toSourceKey) && !importedPending);
  // The message stays in one box; the field it is about is also marked.
  const invalid = { amount: /nominal|saldo yang/i.test(error), date: /tanggal/i.test(error), wallet: /dompet/i.test(error) && !/nominal/i.test(error), confirm: /^Konfirmasi kurs/.test(error) };
  const options: TxMode[] = importedPending ? (incomingPending ? ['income', 'movement', 'transfer'] : ['expense', 'movement', 'transfer']) : ['expense', 'income', 'movement', 'transfer', 'adjustment'];
  const title = importedPending ? 'Cek transaksi ini' : type === 'adjustment' ? 'Cek saldo' : existing ? 'Ubah transaksi' : type === 'transfer' ? 'Pindah uang' : 'Catat transaksi';
  const subtitle = importedPending ? 'Pilih jenis yang benar. Dompet, tanggal, dan nominal mengikuti mutasi bank.' : type === 'movement' ? 'Satu sisi rekening. Tidak dihitung sebagai belanja atau pemasukan; cash tidak dibukukan.' : type === 'transfer' ? 'Uangnya berpindah. Total belanja tetap sama.' : 'Catat secukupnya. Kategori bisa dibereskan nanti.';
  return <Modal title={askDiscard ? 'Buang isian transaksi?' : title} subtitle={askDiscard ? undefined : subtitle} onClose={askDiscard ? () => setAskDiscard(false) : requestClose}>
    {askDiscard && <>
      <div className="modal-body"><p className="confirm-copy" id="discard-draft-help">Perubahan di formulir ini belum disimpan.</p></div>
      <div className="modal-footer">
        <button type="button" className="button primary" ref={continueButton} aria-describedby="discard-draft-help" onClick={() => setAskDiscard(false)}>Lanjut mengisi</button>
        <button type="button" className="button danger" disabled={disabled} onClick={onClose}>Buang isian</button>
      </div>
    </>}
    <form onSubmit={submit} hidden={askDiscard} style={askDiscard ? { display: 'none' } : undefined}><fieldset disabled={disabled || !!existing && readOnlyEntryIds.has(existing.id)} style={{ display: 'contents' }}><div className="modal-body">
      {(isWalletArchived(data, walletId) || type === 'transfer' && isWalletArchived(data, toWalletId) || existing && readOnlyEntryIds.has(existing.id)) && <div className="notice warning">Dompet terkait sudah diarsipkan. Pulihkan di menu Dompet sebelum menyimpan; isian tetap dipertahankan.</div>}
      {bankHint && bankHint.kind !== 'none' && <div className={`notice ${bankHint.pending ? 'warning' : ''} bank-operation-hint`} data-bank-operation={bankHint.kind}><strong>{bankHint.label}.</strong> {bankHint.warning}</div>}
      {(type === 'transfer' ? sourceDate > today() || destinationDate > today() : date > today()) && <div className="notice warning" role="note">Tanggal masa depan: catatan ini belum masuk saldo aktual sampai tanggal posting masing-masing tiba.</div>}
      {showTemplates && <div className="template-quick" role="group" aria-label="Template transaksi">
        <div className="template-quick-head"><span className="field-label"><Zap size={14} /> Isi cepat dari template</span>{canManageTemplates && <button type="button" className="text-link" aria-pressed={manageTemplates} onClick={() => { setManageTemplates(open => !open); setTemplateEdit(null); setTemplateManageError(''); }}>{manageTemplates ? 'Selesai' : 'Kelola template'}</button>}</div>
        {templatesError ? <p className="notice warning">{templatesError}</p> : manageTemplates && canManageTemplates ? <ul className="template-manage-list" aria-busy={templateBusy}>{templates.map(template => <li key={template.id}>{templateEdit?.id === template.id
          ? <><input className="field-input" aria-label={`Nama baru untuk template ${template.name}`} maxLength={60} autoFocus value={templateEdit.name} disabled={templateBusy} onChange={e => { setTemplateEdit({ id: template.id, name: e.target.value }); setTemplateManageError(''); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void changeTemplates(() => onRenameTemplate!(template.id, templateEdit.name)); } else if (e.key === 'Escape') { e.stopPropagation(); setTemplateEdit(null); setTemplateManageError(''); } }} /><button type="button" className="button primary small" disabled={templateBusy || !templateEdit.name.trim()} onClick={() => void changeTemplates(() => onRenameTemplate!(template.id, templateEdit.name))}>Simpan nama</button><button type="button" className="button secondary small" disabled={templateBusy} onClick={() => { setTemplateEdit(null); setTemplateManageError(''); }}>Batal</button></>
          : <><span className="template-manage-name"><strong>{template.name}</strong><span>{template.type === 'income' ? 'Pemasukan' : 'Pengeluaran'} · {template.category}{template.amount ? ` · ${formatMoney(template.amount, template.currency)}` : ''}</span></span><button type="button" className="icon-button" aria-label={`Ganti nama template ${template.name}`} title="Ganti nama" disabled={templateBusy} onClick={() => { setTemplateEdit({ id: template.id, name: template.name }); setTemplateManageError(''); }}><Pencil size={15} /></button><button type="button" className="icon-button danger" aria-label={`Hapus template ${template.name}`} title="Hapus template" disabled={templateBusy} onClick={() => void changeTemplates(() => onRemoveTemplate!(template.id))}><Trash2 size={15} /></button></>}</li>)}</ul>
          : <div className="template-quick-list">{templates.map(template => <button key={template.id} type="button" className={`button secondary small${template.type === 'income' ? ' template-income' : ''}`} aria-label={`Isi dari template ${template.name}`} title={`${template.type === 'income' ? 'Pemasukan' : 'Pengeluaran'} · ${template.category}${template.amount ? ` · ${formatMoney(template.amount, template.currency)}` : ''}`} onClick={() => useTemplate(template)}>{template.name}</button>)}</div>}
        {manageTemplates && templateManageError && <p className="notice error" role="alert">{templateManageError}</p>}
        {manageTemplates && canManageTemplates && <p className="field-help">Menghapus atau mengganti nama template tidak mengubah transaksi yang sudah dicatat.</p>}
        {fillNotice && <div className={`notice ${fillNotice.warnings.length ? 'warning' : 'success'}`} role="status">Formulir diisi dari template “{fillNotice.name}” dengan tanggal hari ini. Periksa lalu simpan.{fillNotice.warnings.map(warning => <span key={warning} className="template-fill-warning">{warning}</span>)}</div>}
      </div>}
      <TypeChoices options={options} type={type} onChange={changeType} />
      <p className="field-help type-hint" data-testid="type-hint">{TYPE_HINTS[type]}</p>
      {suggestedPairs.length > 0 && <div className="transfer-suggestion"><strong>Mungkin pasangan transfer</strong><p>Nominal sama, arah berlawanan, di dompet lain. Pilih pasangan yang benar, lalu simpan. Dua catatan itu digabung jadi satu transfer.</p>{suggestedPairs.map(candidate => {
        const pair = state.entries.find(e => e.id === candidate.id)!;
        const pairWallet = state.wallets.find(w => w.id === pair.walletId)!;
        return <button key={pair.id} className={`button secondary small${pairId === pair.id ? ' chosen' : ''}`} type="button" aria-pressed={pairId === pair.id} aria-label={`Cocokkan transfer ${pairWallet.name} pada ${formatDate(pair.date)}`} title={pair.note || undefined} onClick={() => useSuggestedPair(pair.id)}>{pairId === pair.id ? <Check size={15} /> : <ArrowLeftRight size={15} />}<span className="pair-text">{pairWallet.name} · {formatDate(pair.date)} · {formatMoney(Math.abs(pair.amount), pairWallet.currency)}{pair.note && <span className="pair-note"> · {pair.note.slice(0, 45)}</span>}</span></button>;
      })}</div>}
      <div className="form-grid">
        <label className="field"><span className="field-label">{type === 'transfer' ? 'Dari dompet' : 'Dompet'}</span><select required aria-label="Dompet asal" aria-invalid={invalid.wallet || undefined} className="select-input" value={walletId} disabled={importedPending && (!incomingPending || type !== 'transfer')} onChange={e => { setWallet(e.target.value); if (type === 'transfer' && !incomingPending) setToWallet(preferredDestination(activeWallets, e.target.value)); setPairId(''); setConfirmed(false); }}>{walletId && !activeWallets.some(wallet => wallet.id === walletId) && <option value={walletId} disabled>{source?.name ?? 'Dompet tidak tersedia'} (tidak aktif)</option>}{activeWallets.filter(w => !(incomingPending && type === 'transfer' && w.id === existing.walletId)).map(w => <option key={w.id} value={w.id}>{w.name} · {w.currency}</option>)}</select></label>
        {type === 'transfer' ? <label className="field"><span className="field-label">Ke dompet</span><select required aria-label="Dompet tujuan" className="select-input" value={toWalletId} disabled={!!incomingPending} onChange={e => { setToWallet(e.target.value); setPairId(''); setConfirmed(false); }}>{toWalletId && !activeWallets.some(wallet => wallet.id === toWalletId) && <option value={toWalletId} disabled>{destination?.name ?? 'Dompet tidak tersedia'} (tidak aktif)</option>}{activeWallets.filter(w => w.id !== walletId).map(w => <option key={w.id} value={w.id}>{w.name} · {w.currency}</option>)}</select></label> : <div className="field"><label className="field"><span className="field-label">Tanggal</span><input required type="date" className="field-input" aria-invalid={invalid.date || undefined} value={date} disabled={!!importedPending || lockedToday} onChange={e => setDate(e.target.value)} />{lockedToday && <span className="field-help">Cek saldo selalu memakai tanggal hari ini.</span>}</label>{!importedPending && type !== 'adjustment' && <div className="date-shortcuts" role="group" aria-label="Tanggal cepat"><span className="field-help date-echo" data-testid="date-echo">{date ? formatDate(date) : ''}</span><button type="button" className="text-link" aria-pressed={date === today()} onClick={() => setDate(today())}>Hari ini</button><button type="button" className="text-link" aria-pressed={date === yesterday()} onClick={() => setDate(yesterday())}>Kemarin</button></div>}</div>}
        {type === 'movement' && <label className="field full"><span className="field-label">Arah perpindahan dana</span><select aria-label="Arah perpindahan dana" className="select-input" value={movementDirection} disabled={!!importedPending} onChange={e => setMovementDirection(e.target.value as 'in' | 'out')}><option value="out">Keluar dari rekening</option><option value="in">Masuk ke rekening</option></select></label>}
        <label className="field full"><span className="field-label">{type === 'adjustment' ? 'Saldo yang benar sekarang' : type === 'transfer' ? 'Nominal yang keluar' : 'Nominal'} <span className="field-currency">{source?.currency}</span></span><input ref={amountRef} data-autofocus required autoComplete="off" className="field-input amount-input" inputMode="decimal" aria-label="Nominal" aria-invalid={invalid.amount || undefined} placeholder="0" value={amount} disabled={importedPending && (!incomingPending || type !== 'transfer')} onChange={e => { setAmount(e.target.value); setConfirmed(false); }} /><MoneyEcho text={amount} currency={source?.currency} />{source && currencyDigits(source.currency) !== 2 && <span className="field-help">{source.currency} memakai {currencyDigits(source.currency)} desimal.{currencyDigits(source.currency) > 0 ? ' Gunakan koma untuk desimal; titik tunggal dengan tiga digit ditolak karena ambigu.' : ' Isi nominal bulat tanpa pecahan.'}</span>}{type === 'adjustment' && source && <span className="field-help">{adjustment?.current != null ? <>Saldo catatan hari ini ({formatDate(balanceDay)}) {formatMoney(adjustment.current, source.currency)}. <span data-testid="adjustment-difference" data-difference={adjustmentDifference ?? ''}>{adjustmentDifference === null ? 'Isi saldo yang benar untuk melihat selisihnya.' : adjustmentDifference === 0 ? 'Sama dengan catatan, jadi tidak ada selisih untuk dicatat.' : `Selisih ${adjustmentDifference > 0 ? '+' : '−'}${formatMoney(Math.abs(adjustmentDifference), source.currency)} akan dicatat sebagai penyesuaian.`}</span></> : adjustment?.error}</span>}</label>
        {crossCurrency && <div className="field full fx-section">
          <div className="segmented-control compact"><button type="button" className={fxMode === 'rate' ? 'active' : ''} disabled={!!incomingPending} onClick={() => { setFxMode('rate'); setConfirmed(false); }}>Isi kurs</button><button type="button" className={fxMode === 'received' ? 'active' : ''} onClick={() => { setFxMode('received'); setConfirmed(false); }}>Isi jumlah diterima</button></div>
          {fxMode === 'rate' ? <label className="field"><span className="field-label">1 {source.currency} = berapa {destination.currency}?</span><input required aria-label="Kurs transaksi" aria-invalid={invalidFx} aria-describedby="fx-input-help fx-input-feedback" inputMode="decimal" className="field-input" placeholder="Contoh: 400,5" value={rateText} onChange={e => { setRate(e.target.value); setConfirmed(false); }} /><span className="field-help">Tanpa pemisah ribuan. Contoh: 16000 atau 16000,5.</span></label> : <label className="field"><span className="field-label">Nominal yang diterima ({destination.currency})</span><input required aria-label="Nominal diterima" aria-invalid={invalidFx} aria-describedby="fx-input-help fx-input-feedback" className="field-input" inputMode="decimal" placeholder="0" value={received} disabled={!!incomingPending} onChange={e => { setReceived(e.target.value); setConfirmed(false); }} /><MoneyEcho text={received} currency={destination.currency} /></label>}
          <p id="fx-input-help" className="field-help">{fxMode === 'rate' ? `Isi kurs yang kamu dapat; jumlah ${destination.currency} dihitung dari nominal di atas.` : `Isi jumlah ${destination.currency} yang benar-benar masuk; kursnya dihitung sendiri.`}</p>{invalidFx && <p id="fx-input-feedback" className="notice error" role="alert">Kurs atau nominal diterima belum valid. Gunakan angka positif tanpa pemisah ribuan untuk kurs.</p>}<div className="rate-preview"><ArrowLeftRight size={18} /><div><strong>{toMinor !== null && Number.isSafeInteger(toMinor) ? formatMoney(toMinor, destination.currency) : '—'} diterima</strong><span>1 {source.currency} = {Number.isFinite(effectiveRate) ? new Intl.NumberFormat('id-ID', { maximumFractionDigits: 8 }).format(effectiveRate) : '…'} {destination.currency}</span>{Number.isFinite(effectiveRate) && effectiveRate > 0 && effectiveRate < 1 && <span data-testid="rate-inverse">atau 1 {destination.currency} ≈ {new Intl.NumberFormat('id-ID', { maximumFractionDigits: 4 }).format(1 / effectiveRate)} {source.currency}</span>}</div></div>
          <label className={`checkbox-row${invalid.confirm ? ' invalid' : ''}`}><input type="checkbox" aria-invalid={invalid.confirm || undefined} checked={confirmed} onChange={e => { setConfirmed(e.target.checked); if (e.target.checked && invalid.confirm) setError(''); }} />Kurs ini sesuai transaksi saya</label><p className="field-help">Kurs ini disimpan untuk transaksi ini. Tidak mengikuti perubahan kurs harian.</p>
        </div>}
        {type === 'transfer' && <>
          {!crossCurrency && (!destination || destination.id === walletId || !!(parseMoney(fee || '0', source?.currency ?? 'IDR'))) && <div className="notice full"><ArrowLeftRight size={16} />{!destination || destination.id === walletId ? 'Pilih dompet tujuan yang berbeda.' : toMinor === null || toMinor <= 0 ? `Isi nominal untuk melihat jumlah yang masuk ke ${destination.name}.` : `${formatMoney(toMinor, destination.currency)} masuk ke ${destination.name}.`}</div>}
          {splitDates ? <>
          <label className="field"><span className="field-label">Tanggal debit</span><input aria-label="Tanggal debit" aria-invalid={invalid.date || undefined} required={!existing || existing.type !== 'transfer' || declareDates} type="date" className="field-input" value={sourceDate} disabled={!!pairId} onChange={e => { setSourceDate(e.target.value); setDeclareDates(true); }} />{sourceDate && <span className="field-help date-echo">{formatDate(sourceDate)}</span>}</label>
          <label className="field"><span className="field-label">Tanggal kredit</span><input aria-label="Tanggal kredit" aria-invalid={invalid.date || undefined} required={!existing || existing.type !== 'transfer' || declareDates} type="date" className="field-input" value={destinationDate} disabled={!!pairId} onChange={e => { setDestinationDate(e.target.value); setDeclareDates(true); }} />{destinationDate && <span className="field-help date-echo">{formatDate(destinationDate)}</span>}</label>
          </> : <div className="field full"><label className="field"><span className="field-label">Tanggal</span><input aria-label="Tanggal debit" aria-invalid={invalid.date || undefined} required type="date" className="field-input" value={sourceDate} onChange={e => { setSourceDate(e.target.value); setDestinationDate(e.target.value); setDeclareDates(true); }} /></label><div className="date-shortcuts"><span className="field-help"><span className="date-echo" data-testid="date-echo">{sourceDate ? `${formatDate(sourceDate)}. ` : ''}</span>Uang keluar dan masuk di tanggal yang sama.</span><button type="button" className="text-link" onClick={() => setDatesSplit(true)}>Tanggal masuk berbeda?</button></div></div>}
          {originalDates?.basis === 'legacy-assumed' && <p className="field-help full">Transfer lama memakai satu tanggal untuk pencatatan. Tanggal bank kedua sisi belum terbukti. Mengubah tanggal menyatakan keputusan baru berdasarkan informasi yang kamu miliki.</p>}
          <label className="field full"><span className="field-label">Biaya tambahan ({source?.currency})</span><input inputMode="decimal" className="field-input" placeholder="0" value={fee} disabled={importedPending && !incomingPending} onChange={e => setFee(e.target.value)} /><MoneyEcho text={fee} currency={source?.currency} /><span className="field-help">{importedPending && !incomingPending ? 'Biaya bank yang ada di mutasi dicatat dari barisnya sendiri.' : 'Biaya dibebankan di luar nominal transfer.'}</span></label>
          {existing && <label className="field full"><span className="field-label">Catatan pasangan di dompet {incomingPending ? 'asal' : 'tujuan'}</span><select className="select-input" value={pairId} onChange={e => selectPair(e.target.value)}><option value="">Belum tercatat — buat sisi pasangannya</option>{pairCandidates.map(e => <option key={e.id} value={e.id}>{formatDate(e.date)} · {formatMoney(Math.abs(e.amount), state.wallets.find(w => w.id === e.walletId)!.currency)} · {e.note.slice(0, 45)}</option>)}</select><span className="field-help">Pilih jika sisi transfer ini sudah diimpor. Dua catatan akan digabung supaya saldo tidak dihitung dua kali.</span></label>}
        </>}
        {(type === 'expense' || type === 'income' || type === 'movement') && <label className="field full"><span className="field-label">Kategori <span className="optional">boleh nanti</span></span><select className="select-input" aria-label="Kategori" value={category} onChange={e => setCategory(e.target.value)}>{categoryOrder.frequent.length === 0 ? categoryOrder.rest.map(c => <option key={c}>{c}</option>) : <>{categoryOrder.rest.filter(isUncategorized).map(c => <option key={c}>{c}</option>)}<optgroup label={`Sering dipakai untuk ${type === 'income' ? 'pemasukan' : type === 'movement' ? 'perpindahan dana' : 'pengeluaran'}`}>{categoryOrder.frequent.map(c => <option key={c}>{c}</option>)}</optgroup><optgroup label="Kategori lain">{categoryOrder.rest.filter(c => !isUncategorized(c)).map(c => <option key={c}>{c}</option>)}</optgroup></>}</select></label>}
        <label className="field full"><span className="field-label">Keterangan <span className="optional">opsional</span></span><input className="field-input" maxLength={2000} value={note} placeholder="Contoh: makan siang, pembayaran tagihan…" onChange={e => setNote(e.target.value)} />{noteSuggestions.length > 0 && <span className="category-suggest" role="group" aria-label="Saran kategori dari keterangan"><Lightbulb size={14} aria-hidden="true" /> Saran kategori:{noteSuggestions.map(name => <button key={name} type="button" className="text-link" onClick={e => { e.preventDefault(); setCategory(name); }}>{name}</button>)}</span>}</label>
        {canTemplate && <div className="field full template-save">
          {templateName === null ? <button type="button" className="button secondary small" onClick={openTemplate}><BookmarkPlus size={15} /> Simpan sebagai template</button> : <div className="template-save-panel" aria-busy={templateSaving}>
            <label className="field"><span className="field-label">Nama template</span><input className="field-input" aria-label="Nama template" maxLength={60} value={templateName} disabled={templateSaving} onChange={e => { setTemplateName(e.target.value); setTemplateError(''); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void saveTemplate(); } }} /><span className="field-help">Menyimpan jenis, dompet, kategori, nominal, dan keterangan di atas. Kosongkan nominal bila jumlahnya berubah-ubah. Tidak mencatat transaksi.</span></label>
            <div className="template-save-actions"><button type="button" className="button secondary small" disabled={templateSaving} onClick={() => { setTemplateName(null); setTemplateError(''); }}>Batal</button><button type="button" className="button primary small" disabled={templateSaving} onClick={() => void saveTemplate()}><BookmarkPlus size={15} /> {templateSaving ? 'Menyimpan…' : 'Simpan template'}</button></div>
          </div>}
          {templateError && <p className="notice error" role="alert">{templateError}</p>}
          {templateNotice && <p className="notice success" role="status">{templateNotice}</p>}
        </div>}
        {existing && <SourceDetails data={data} entry={existing} />}
        {showReason && <label className="field full"><span className="field-label">Alasan perubahan finansial atau tanggal</span><input aria-label="Alasan perubahan" className="field-input" maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} placeholder="Contoh: koreksi nominal sesuai bukti pembayaran" /><span className="field-help">Kategori dan keterangan dapat dirapikan; data bank asli tetap disimpan terpisah.</span></label>}
        {error && <div ref={validationRef} tabIndex={-1} className="notice error full" role="alert">{error}</div>}
      </div>
    </div><div className={`modal-footer ${!existing && (type === 'expense' || type === 'income') ? 'repeat-entry-footer' : ''}`}>{existing && onDelete && <button type="button" className="button danger small" style={{ marginRight: 'auto' }} onClick={onDelete}><Trash2 size={15} /> Hapus</button>}{existing?.type === 'transfer' && onUnpair && <button type="button" className="button secondary small" onClick={onUnpair}>Pisahkan transfer</button>}<button type="button" className="button secondary" onClick={requestClose}>Batal</button><button className="button primary" type="submit"><Check size={17} /> {importedPending ? 'Simpan hasil cek' : 'Simpan transaksi'}</button>{!existing && (type === 'expense' || type === 'income') && <button className="button secondary" type="submit" data-repeat="true">Simpan &amp; catat lagi</button>}</div></fieldset></form>
  </Modal>;
}

/** Jenis transaksi dalam satu baris; bila tidak muat, baris bisa digeser dan pilihan aktif selalu terlihat. */
function TypeChoices({ options, type, onChange }: { options: TxMode[]; type: TxMode; onChange: (type: TxMode) => void }) {
  const row = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ before: false, after: false });
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>('button.active');
    if (active) {
      const start = active.offsetLeft, end = start + active.offsetWidth;
      // Keep the active choice clear of the edge fade and the scroll arrows (MW-40).
      const edge = el.scrollWidth > el.clientWidth ? 34 : 4;
      if (start - edge < el.scrollLeft) el.scrollLeft = start - edge;
      else if (end + edge > el.scrollLeft + el.clientWidth) el.scrollLeft = end - el.clientWidth + edge;
    }
    const update = () => setEdges(current => {
      const before = el.scrollLeft > 2, after = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      return current.before === before && current.after === after ? current : { before, after };
    });
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { el.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [type, options.length]);
  const nudge = (direction: 1 | -1) => { const el = row.current; if (el) el.scrollBy({ left: direction * el.clientWidth * 0.6, behavior: 'smooth' }); };
  return <div className="type-choices">
    {edges.before && <button type="button" className="type-scroll before" tabIndex={-1} aria-hidden="true" onClick={() => nudge(-1)}><ChevronLeft size={16} /></button>}
    <div ref={row} className="segmented-control" aria-label="Jenis transaksi" data-more-before={edges.before || undefined} data-more-after={edges.after || undefined}>{options.map(t => <button key={t} type="button" className={type === t ? 'active' : ''} onClick={() => onChange(t)}>{t === 'adjustment' ? 'Cek saldo' : typeLabels[t]}</button>)}</div>
    {edges.after && <button type="button" className="type-scroll after" tabIndex={-1} aria-hidden="true" onClick={() => nudge(1)}><ChevronRight size={16} /></button>}
  </div>;
}
