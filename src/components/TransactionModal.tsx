import { useContext, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeftRight, Check, Trash2 } from 'lucide-react';
import { entrySignedAmount, formatDate, formatMoney, makeId, parseMoney, validateEntry, walletBalance, walletBalanceAt, type Entry, type State } from '../lib/finance';
import { CategorySettingsContext } from '../hooks/useCategorySettings';
import { categoryChoices } from '../lib/categorySettings';
import { createBankEntryHintLookup } from '../lib/bankEntryHints';
import { transferPostingDates } from '../lib/transferPostings';
import { formatMoneyInput } from '../lib/moneyFormatting';
import { preferredDestination } from '../lib/preferences';
import { convertMinorCurrency, deriveCurrencyRate, currencyDigits, isCurrencyConversionConsistent } from '../lib/currencyCatalog';
import { transferCandidates } from '../lib/review';
import type { StoredData } from '../lib/storage';
import { isWalletArchived, archivedReadOnlyEntryIds } from '../lib/walletLifecycle';
import Modal from './Modal';
import SourceDetails from './SourceDetails';
export type TxMode = 'expense' | 'income' | 'transfer' | 'adjustment' | 'movement';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const moneyInput = formatMoneyInput;
const typeLabels = { expense: 'Pengeluaran', income: 'Pemasukan', transfer: 'Transfer', movement: 'Perpindahan dana', adjustment: 'Penyesuaian', unreviewed: 'Perlu dicek' };
export interface EntrySaveOptions { reason: string; sourceDate: string | null; destinationDate: string | null; declareDates?: true }

export default function TransactionModal({ data, state, initialMode, initialWallet, existing, onSave, onClose, onDelete, onUnpair, disabled = false }: {
  data: StoredData; state: State; initialMode: TxMode; initialWallet?: string; existing?: Entry;
  onSave: (entry: Entry, removeIds: string[], keepOpen?: boolean, options?: EntrySaveOptions) => Promise<boolean>; onClose: () => void; onDelete?: () => void; onUnpair?: () => void; disabled?: boolean;
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
  const [toWalletId, setToWallet] = useState(existing?.toWalletId ?? preferredDestination(activeWallets, walletId));
  const [movementDirection, setMovementDirection] = useState<'in' | 'out'>(existing && entrySignedAmount(existing) > 0 ? 'in' : 'out');
  const [amount, setAmount] = useState(existing ? moneyInput(existing.type === 'adjustment' ? walletBalanceAt(state, existing.walletId, today(), data.metadata) : Math.abs(existing.amount), state.wallets.find(wallet => wallet.id === existing.walletId)?.currency ?? 'IDR') : '');
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
  const [error, setError] = useState('');
  useEffect(() => { if (error) { validationRef.current?.scrollIntoView({ block: 'nearest' }); validationRef.current?.focus({ preventScroll: true }); } }, [error]);
  const amountRef = useRef<HTMLInputElement>(null);
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
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
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
      if (date !== today()) return setError('Cek saldo membandingkan saldo aktual hari ini. Gunakan tanggal hari ini; transaksi masa depan tetap bisa dicatat sebagai pemasukan, pengeluaran, atau transfer.');
      try { entry.amount = minor - walletBalanceAt(cleanState, walletId, today(), data.metadata); }
      catch { return setError('Saldo aktual melewati batas angka. Periksa transaksi bertanggal masa depan sebelum melakukan penyesuaian.'); }
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
    if (hasFacts && changedMoney && !reason.trim() && !pair) return setError('Isi alasan perubahan agar perbedaan dari fakta bank dapat ditelusuri.');
    const options: EntrySaveOptions = { reason: reason.trim(), sourceDate: type === 'transfer' ? sourceDate || null : null, destinationDate: type === 'transfer' ? destinationDate || null : null, ...(declareDates || !existing || existing.type !== 'transfer' ? { declareDates: true } : {}) };
    if (await onSave(entry, removeIds, repeat, options) && repeat) {
      setAmount(''); setNote(''); setError('');
      requestAnimationFrame(() => amountRef.current?.focus());
    }
  }
  const options: TxMode[] = importedPending ? (incomingPending ? ['income', 'movement', 'transfer'] : ['expense', 'movement', 'transfer']) : ['expense', 'income', 'movement', 'transfer', 'adjustment'];
  return <Modal title={importedPending ? 'Cek transaksi ini' : type === 'adjustment' ? 'Cocokkan saldo' : existing ? 'Ubah transaksi' : type === 'transfer' ? 'Pindah uang' : 'Catat transaksi'} subtitle={type === 'movement' ? 'Satu sisi rekening. Tidak dihitung sebagai belanja atau pemasukan; cash tidak dibukukan.' : type === 'transfer' ? 'Uangnya berpindah. Total belanja tetap sama.' : 'Catat secukupnya. Kategori bisa dibereskan nanti.'} onClose={onClose}>
    <form onSubmit={submit}><fieldset disabled={disabled || !!existing && readOnlyEntryIds.has(existing.id)} style={{ display: 'contents' }}><div className="modal-body">
      {(isWalletArchived(data, walletId) || type === 'transfer' && isWalletArchived(data, toWalletId) || existing && readOnlyEntryIds.has(existing.id)) && <div className="notice warning">Dompet terkait sudah diarsipkan. Pulihkan di menu Dompet sebelum menyimpan; isian tetap dipertahankan.</div>}
      {bankHint && bankHint.kind !== 'none' && <div className={`notice ${bankHint.pending ? 'warning' : ''} bank-operation-hint`} data-bank-operation={bankHint.kind}><strong>{bankHint.label}.</strong> {bankHint.warning}</div>}
      {(type === 'transfer' ? sourceDate > today() || destinationDate > today() : date > today()) && <div className="notice warning" role="note">Tanggal masa depan: catatan ini belum masuk saldo aktual sampai tanggal posting masing-masing tiba.</div>}
      <div className="segmented-control" aria-label="Jenis transaksi">{options.map(t => <button key={t} type="button" className={type === t ? 'active' : ''} onClick={() => changeType(t)}>{t === 'adjustment' ? 'Cek saldo' : typeLabels[t]}</button>)}</div>
      {suggestedPairs.length > 0 && <div className="transfer-suggestion"><strong>Mungkin pasangan transfer</strong><p>Nominal sama, arah berlawanan, di dompet lain. Pilih pasangan yang benar lalu simpan hasil cek.</p>{suggestedPairs.map(candidate => {
        const pair = state.entries.find(e => e.id === candidate.id)!;
        const pairWallet = state.wallets.find(w => w.id === pair.walletId)!;
        return <button key={pair.id} className="button secondary small" type="button" aria-label={`Cocokkan transfer ${pairWallet.name} pada ${formatDate(pair.date)}`} onClick={() => useSuggestedPair(pair.id)}><ArrowLeftRight size={15} />{pairWallet.name} · {formatDate(pair.date)} · {formatMoney(Math.abs(pair.amount), pairWallet.currency)}{pairId === pair.id && <Check size={15} />}</button>;
      })}</div>}
      <div className="form-grid">
        <label className="field"><span className="field-label">{type === 'transfer' ? 'Dari dompet' : 'Dompet'}</span><select required aria-label="Dompet asal" className="select-input" value={walletId} disabled={importedPending && (!incomingPending || type !== 'transfer')} onChange={e => { setWallet(e.target.value); if (type === 'transfer' && !incomingPending) setToWallet(preferredDestination(activeWallets, e.target.value)); setPairId(''); setConfirmed(false); }}>{walletId && !activeWallets.some(wallet => wallet.id === walletId) && <option value={walletId} disabled>{source?.name ?? 'Dompet tidak tersedia'} (tidak aktif)</option>}{activeWallets.filter(w => !(incomingPending && type === 'transfer' && w.id === existing.walletId)).map(w => <option key={w.id} value={w.id}>{w.name} · {w.currency}</option>)}</select></label>
        {type === 'transfer' ? <label className="field"><span className="field-label">Ke dompet</span><select required aria-label="Dompet tujuan" className="select-input" value={toWalletId} disabled={!!incomingPending} onChange={e => { setToWallet(e.target.value); setPairId(''); setConfirmed(false); }}>{toWalletId && !activeWallets.some(wallet => wallet.id === toWalletId) && <option value={toWalletId} disabled>{destination?.name ?? 'Dompet tidak tersedia'} (tidak aktif)</option>}{activeWallets.filter(w => w.id !== walletId).map(w => <option key={w.id} value={w.id}>{w.name} · {w.currency}</option>)}</select></label> : <label className="field"><span className="field-label">Tanggal</span><input required type="date" className="field-input" value={date} disabled={!!importedPending} onChange={e => setDate(e.target.value)} /></label>}
        {type === 'movement' && <label className="field full"><span className="field-label">Arah perpindahan dana</span><select aria-label="Arah perpindahan dana" className="select-input" value={movementDirection} disabled={!!importedPending} onChange={e => setMovementDirection(e.target.value as 'in' | 'out')}><option value="out">Keluar dari rekening</option><option value="in">Masuk ke rekening</option></select></label>}
        <label className="field full"><span className="field-label">{type === 'adjustment' ? 'Saldo yang benar sekarang' : type === 'transfer' ? 'Nominal yang keluar' : 'Nominal'} <span className="field-currency">{source?.currency}</span></span><input ref={amountRef} data-autofocus required autoComplete="off" className="field-input amount-input" inputMode="decimal" aria-label="Nominal" placeholder="0" value={amount} disabled={importedPending && (!incomingPending || type !== 'transfer')} onChange={e => { setAmount(e.target.value); setConfirmed(false); }} />{source && currencyDigits(source.currency) !== 2 && <span className="field-help">{source.currency} memakai {currencyDigits(source.currency)} desimal.{currencyDigits(source.currency) > 0 ? ' Gunakan koma untuk desimal; titik tunggal dengan tiga digit ditolak karena ambigu.' : ' Isi nominal bulat tanpa pecahan.'}</span>}{type === 'adjustment' && source && <span className="field-help">Saldo catatan: {formatMoney(walletBalance(state, source.id), source.currency)}. Selisih dicatat sebagai penyesuaian, tanpa mengubah total pemasukan atau belanja.</span>}</label>
        {crossCurrency && <div className="field full fx-section">
          <div className="segmented-control compact"><button type="button" className={fxMode === 'rate' ? 'active' : ''} disabled={!!incomingPending} onClick={() => { setFxMode('rate'); setConfirmed(false); }}>Isi kurs</button><button type="button" className={fxMode === 'received' ? 'active' : ''} onClick={() => { setFxMode('received'); setConfirmed(false); }}>Isi jumlah diterima</button></div>
          {fxMode === 'rate' ? <label className="field"><span className="field-label">1 {source.currency} = berapa {destination.currency}?</span><input required aria-label="Kurs transaksi" aria-invalid={invalidFx} aria-describedby="fx-input-help fx-input-feedback" inputMode="decimal" className="field-input" placeholder="Contoh: 400,5" value={rateText} onChange={e => { setRate(e.target.value); setConfirmed(false); }} /><span className="field-help">Tanpa pemisah ribuan. Contoh: 16000 atau 16000,5.</span></label> : <label className="field"><span className="field-label">Nominal yang diterima ({destination.currency})</span><input required aria-label="Nominal diterima" aria-invalid={invalidFx} aria-describedby="fx-input-help fx-input-feedback" className="field-input" inputMode="decimal" placeholder="0" value={received} disabled={!!incomingPending} onChange={e => { setReceived(e.target.value); setConfirmed(false); }} /></label>}
          <p id="fx-input-help" className="field-help">Isi nominal dan kurs positif. Hasil harus berada dalam batas angka yang dapat disimpan tepat.</p>{invalidFx && <p id="fx-input-feedback" className="notice error" role="alert">Kurs atau nominal diterima belum valid. Gunakan angka positif tanpa pemisah ribuan untuk kurs.</p>}<div className="rate-preview"><ArrowLeftRight size={18} /><div><strong>{toMinor !== null && Number.isSafeInteger(toMinor) ? formatMoney(toMinor, destination.currency) : '—'} diterima</strong><span>1 {source.currency} = {Number.isFinite(effectiveRate) ? new Intl.NumberFormat('id-ID', { maximumFractionDigits: 8 }).format(effectiveRate) : '…'} {destination.currency}</span></div></div>
          <label className="checkbox-row"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Kurs ini sesuai transaksi saya</label><p className="field-help">Kurs ini disimpan untuk transaksi ini. Tidak mengikuti perubahan kurs harian.</p>
        </div>}
        {type === 'transfer' && <>
          {!crossCurrency && <div className="notice full"><ArrowLeftRight size={16} />{toMinor !== null && destination ? `${formatMoney(toMinor, destination.currency)} masuk ke ${destination.name}.` : 'Pilih dompet tujuan yang berbeda.'}</div>}
          <label className="field"><span className="field-label">Biaya tambahan ({source?.currency})</span><input inputMode="decimal" className="field-input" placeholder="0" value={fee} disabled={importedPending && !incomingPending} onChange={e => setFee(e.target.value)} /><span className="field-help">{importedPending && !incomingPending ? 'Biaya bank yang ada di mutasi dicatat dari barisnya sendiri.' : 'Biaya dibebankan di luar nominal transfer.'}</span></label>
          <label className="field"><span className="field-label">Tanggal debit</span><input aria-label="Tanggal debit" required={!existing || existing.type !== 'transfer' || declareDates} type="date" className="field-input" value={sourceDate} disabled={!!pairId} onChange={e => { setSourceDate(e.target.value); setDeclareDates(true); }} /></label>
          <label className="field"><span className="field-label">Tanggal kredit</span><input aria-label="Tanggal kredit" required={!existing || existing.type !== 'transfer' || declareDates} type="date" className="field-input" value={destinationDate} disabled={!!pairId} onChange={e => { setDestinationDate(e.target.value); setDeclareDates(true); }} /></label>
          {originalDates?.basis === 'legacy-assumed' && <p className="field-help full">Transfer lama memakai satu tanggal untuk pencatatan. Tanggal bank kedua sisi belum terbukti. Mengubah tanggal menyatakan keputusan baru berdasarkan informasi yang kamu miliki.</p>}
          {existing && <label className="field full"><span className="field-label">Catatan pasangan di dompet {incomingPending ? 'asal' : 'tujuan'}</span><select className="select-input" value={pairId} onChange={e => selectPair(e.target.value)}><option value="">Belum tercatat — buat sisi pasangannya</option>{pairCandidates.map(e => <option key={e.id} value={e.id}>{formatDate(e.date)} · {formatMoney(Math.abs(e.amount), state.wallets.find(w => w.id === e.walletId)!.currency)} · {e.note.slice(0, 45)}</option>)}</select><span className="field-help">Pilih jika sisi transfer ini sudah diimpor. Dua catatan akan digabung supaya saldo tidak dihitung dua kali.</span></label>}
        </>}
        {(type === 'expense' || type === 'income' || type === 'movement') && <label className="field full"><span className="field-label">Kategori <span className="optional">boleh nanti</span></span><select className="select-input" value={category} onChange={e => setCategory(e.target.value)}>{categoryChoices(categorySettings, category).map(c => <option key={c}>{c}</option>)}</select></label>}
        <label className="field full"><span className="field-label">Keterangan <span className="optional">opsional</span></span><input className="field-input" maxLength={2000} value={note} placeholder="Contoh: makan siang, pembayaran tagihan…" onChange={e => setNote(e.target.value)} /></label>
        {existing && <SourceDetails data={data} entry={existing} />}
        {(existing?.sourceKey || existing?.toSourceKey || type === 'transfer') && <label className="field full"><span className="field-label">Alasan perubahan finansial atau tanggal</span><input aria-label="Alasan perubahan" className="field-input" maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} placeholder="Contoh: koreksi nominal sesuai bukti pembayaran" /><span className="field-help">Kategori dan keterangan dapat dirapikan; fakta bank asli tetap disimpan terpisah.</span></label>}
        {error && <div ref={validationRef} tabIndex={-1} className="notice error full" role="alert">{error}</div>}
      </div>
    </div><div className={`modal-footer ${!existing && (type === 'expense' || type === 'income') ? 'repeat-entry-footer' : ''}`}>{existing && onDelete && <button type="button" className="button danger small" style={{ marginRight: 'auto' }} onClick={onDelete}><Trash2 size={15} /> Hapus</button>}{existing?.type === 'transfer' && onUnpair && <button type="button" className="button secondary small" onClick={onUnpair}>Pisahkan transfer</button>}<button type="button" className="button secondary" onClick={onClose}>Batal</button><button className="button primary" type="submit"><Check size={17} /> {importedPending ? 'Simpan hasil cek' : 'Simpan transaksi'}</button>{!existing && (type === 'expense' || type === 'income') && <button className="button secondary" type="submit" data-repeat="true">Simpan &amp; catat lagi</button>}</div></fieldset></form>
  </Modal>;
}

