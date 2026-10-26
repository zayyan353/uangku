import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDownLeft, ArrowDownToLine, ArrowLeftRight, ArrowRight, ArrowUpRight,
  Check, CheckCheck, CheckCircle2, ChevronDown, ChevronRight, CircleHelp,
  Coffee, Download, FileSpreadsheet, FolderOpen, History, Landmark,
  LayoutDashboard, Leaf, MoreHorizontal, Plus, Search, ShieldCheck,
  SlidersHorizontal, Sparkles, Tags, Trash2, Upload, Wallet as WalletIcon, X,
} from 'lucide-react';
import {
  CURRENCIES, CATEGORY_NAMES, formatDate, formatMoney, makeId, parseMoney,
  summaryForCurrency, validateEntry, validateWallet, walletBalance,
  type Currency, type Entry, type State, type Wallet,
} from './lib/finance';
import { createEmptyState, makeDemoData, readStored, STORAGE_KEY, validateBackup, type StoredData } from './lib/storage';
import { entriesFromImport, parseZiraatWorkbook, type ImportRow } from './lib/importer';
import { validateImportRange } from './lib/importRange';
import { preferredDestination, preferredWallet, readPreferences, writePreferences } from './lib/preferences';

type Page = 'overview' | 'wallets' | 'transactions' | 'import';
type TxMode = 'expense' | 'income' | 'transfer' | 'adjustment';
const DATE_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' });
const today = () => DATE_FORMAT.format(new Date());
const moneyInput = (minor: number) => (minor / 100).toFixed(minor % 100 ? 2 : 0).replace('.', ',');
const currencyFlag = (code: Currency) => code === 'IDR' ? '🇮🇩' : code === 'TRY' ? '🇹🇷' : '🇺🇸';
const currencyLabel = (code: Currency) => CURRENCIES.find(c => c.code === code)!.label;
const kindLabel = (kind: Wallet['kind']) => kind === 'cash' ? 'Uang tunai' : kind === 'ewallet' ? 'E-wallet' : 'Rekening bank';
const typeLabels = { expense: 'Pengeluaran', income: 'Pemasukan', transfer: 'Transfer', adjustment: 'Penyesuaian', unreviewed: 'Perlu dicek' };
const needsReview = (entry: Entry) => entry.type === 'unreviewed' || ((entry.type === 'expense' || entry.type === 'income') && (!entry.category.trim() || entry.category === 'Belum dikategorikan'));
const COLORS = ['#e4a06a', '#7da69b', '#a2b96c', '#a0a5d4', '#d7b568', '#d58e9f', '#8db8c9', '#b1b8ae'];

function downloadText(content: string, name: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Modal({ title, subtitle, children, onClose }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const target = ref.current?.querySelector<HTMLElement>('[data-autofocus]:not([disabled])')
      ?? ref.current?.querySelector<HTMLElement>('.modal-body input:not([disabled])')
      ?? ref.current?.querySelector<HTMLElement>('.modal-body select:not([disabled])')
      ?? ref.current?.querySelector<HTMLElement>('button');
    target?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={ref} className="modal" role="dialog" aria-modal="true" aria-label={title} onKeyDown={e => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab') return;
      const focusables = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') ?? []);
      const first = focusables[0], last = focusables.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }}>
      <div className="modal-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button modal-close" aria-label="Tutup" onClick={onClose}><X size={20} /></button></div>
      {children}
    </div>
  </div>;
}

function WalletSymbol({ wallet, small = false }: { wallet: Wallet; small?: boolean }) {
  return <span className={`wallet-icon ${wallet.kind} ${small ? 'small' : ''}`} style={{ '--wallet-color': wallet.currency === 'TRY' ? '#a36c51' : wallet.currency === 'USD' ? '#6576a4' : '#3d7368' } as React.CSSProperties}>
    {wallet.kind === 'cash' ? <WalletIcon size={small ? 17 : 21} /> : wallet.kind === 'bank' ? <Landmark size={small ? 17 : 21} /> : <span>{wallet.name.slice(0, 1)}</span>}
  </span>;
}

function WalletModal({ existing, defaultCurrency, onSave, onClose }: { existing?: Wallet; defaultCurrency: Currency; onSave: (wallet: Wallet) => void; onClose: () => void }) {
  const [name, setName] = useState(existing?.name ?? '');
  const [currency, setCurrency] = useState<Currency>(existing?.currency ?? defaultCurrency);
  const [kind, setKind] = useState<Wallet['kind']>(existing?.kind ?? 'bank');
  const [balance, setBalance] = useState(existing ? moneyInput(existing.openingBalance) : '0');
  const [error, setError] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    const openingBalance = parseMoney(balance);
    if (openingBalance === null) return setError('Saldo awal belum valid. Contoh: 150000 atau 1.500,50.');
    const wallet: Wallet = { id: existing?.id ?? makeId(), name: name.trim(), currency, kind, openingBalance };
    const problem = validateWallet(wallet);
    if (problem) return setError(problem);
    onSave(wallet);
  }
  return <Modal title={existing ? 'Atur dompet' : 'Tambah dompet'} subtitle="Pisahkan tempat uang dan mata uangnya." onClose={onClose}>
    <form onSubmit={submit}><div className="modal-body form-grid">
      <label className="field full"><span className="field-label">Nama dompet</span><input required maxLength={60} className="field-input" value={name} onChange={e => setName(e.target.value)} placeholder="Contoh: BCA, Cash Lira" /></label>
      <label className="field"><span className="field-label">Mata uang</span><select className="select-input" value={currency} disabled={!!existing} onChange={e => setCurrency(e.target.value as Currency)}>{CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} · {c.label}</option>)}</select></label>
      <label className="field"><span className="field-label">Jenis dompet</span><select className="select-input" value={kind} onChange={e => setKind(e.target.value as Wallet['kind'])}><option value="bank">Rekening bank</option><option value="cash">Uang tunai</option><option value="ewallet">E-wallet</option></select></label>
      <label className="field full"><span className="field-label">Saldo awal ({currency})</span><input required className="field-input amount-input" inputMode="decimal" value={balance} onChange={e => setBalance(e.target.value)} /><span className="field-help">Saldo sebelum transaksi pertama yang dicatat. Untuk mencocokkan saldo hari ini, gunakan “Cek saldo”.</span></label>
      {error && <div className="notice error full" role="alert">{error}</div>}
    </div><div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>Batal</button><button className="button primary" type="submit"><Check size={17} /> Simpan dompet</button></div></form>
  </Modal>;
}

function TransactionModal({ state, initialMode, initialWallet, existing, onSave, onClose, onDelete }: {
  state: State; initialMode: TxMode; initialWallet?: string; existing?: Entry;
  onSave: (entry: Entry, removeIds: string[], keepOpen?: boolean) => boolean; onClose: () => void; onDelete?: () => void;
}) {
  const importedPending = existing?.type === 'unreviewed';
  const incomingPending = importedPending && existing.amount > 0;
  const [type, setType] = useState<TxMode>(existing?.type === 'unreviewed' ? (existing.amount > 0 ? 'income' : 'expense') : existing?.type ?? initialMode);
  const [walletId, setWallet] = useState(existing?.walletId ?? initialWallet ?? state.wallets[0]?.id ?? '');
  const [toWalletId, setToWallet] = useState(existing?.toWalletId ?? preferredDestination(state.wallets, walletId));
  const [amount, setAmount] = useState(existing ? moneyInput(existing.type === 'adjustment' ? walletBalance(state, existing.walletId) : Math.abs(existing.amount)) : '');
  const [received, setReceived] = useState(existing?.toAmount ? moneyInput(existing.toAmount) : '');
  const [rateText, setRate] = useState(existing?.rate?.toString().replace('.', ',') ?? '');
  const [fxMode, setFxMode] = useState<'rate' | 'received'>('rate');
  const [fee, setFee] = useState(existing?.fee ? moneyInput(existing.fee) : '');
  const [date, setDate] = useState(existing?.date ?? today());
  const [note, setNote] = useState(existing?.note ?? '');
  const [category, setCategory] = useState(existing?.category || 'Belum dikategorikan');
  const [confirmed, setConfirmed] = useState(false);
  const [pairId, setPairId] = useState('');
  const [error, setError] = useState('');
  const amountRef = useRef<HTMLInputElement>(null);
  const source = state.wallets.find(w => w.id === walletId);
  const destination = state.wallets.find(w => w.id === toWalletId);
  const crossCurrency = type === 'transfer' && source && destination && source.currency !== destination.currency;
  const minor = parseMoney(amount);
  const rateNumber = /^\d+(?:[.,]\d+)?$/.test(rateText.trim()) ? Number(rateText.replace(',', '.')) : NaN;
  const toMinor = !crossCurrency ? minor : fxMode === 'received' ? parseMoney(received) : minor !== null && Number.isFinite(rateNumber) ? Math.round(minor * rateNumber) : null;
  const effectiveRate = crossCurrency && fxMode === 'received' ? (minor && toMinor ? toMinor / minor : NaN) : crossCurrency ? rateNumber : 1;
  const pairCandidates = type === 'transfer' && existing ? state.entries.filter(e =>
    e.id !== existing.id && e.type === 'unreviewed' && e.walletId === (incomingPending ? walletId : toWalletId)
    && (incomingPending ? e.amount < 0 : e.amount > 0)
    && Math.abs(new Date(e.date).getTime() - new Date(date).getTime()) <= 3 * 86400000,
  ) : [];
  function changeType(next: TxMode) {
    setType(next); setError(''); setPairId(''); setConfirmed(false);
    if (next === 'transfer' && importedPending && incomingPending) {
      setToWallet(existing.walletId);
      const from = state.wallets.find(w => w.id !== existing.walletId);
      setWallet(from?.id ?? '');
      setReceived(moneyInput(existing.amount)); setFxMode('received');
      setAmount(from?.currency === state.wallets.find(w => w.id === existing.walletId)?.currency ? moneyInput(existing.amount) : '');
    } else if (next === 'transfer') {
      setToWallet(preferredDestination(state.wallets, walletId));
    } else if (existing) { setWallet(existing.walletId); setAmount(moneyInput(Math.abs(existing.amount))); }
  }
  function selectPair(id: string) {
    setPairId(id); setConfirmed(false);
    const pair = state.entries.find(e => e.id === id);
    if (!pair) return;
    if (incomingPending) setAmount(moneyInput(Math.abs(pair.amount)));
    else setReceived(moneyInput(pair.amount));
    setFxMode('received');
  }
  function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    if (minor === null || !source) return setError('Isi dompet dan nominal yang valid.');
    if (crossCurrency && !confirmed) return setError('Konfirmasi kurs transaksi ini terlebih dahulu.');
    const feeMinor = fee.trim() ? parseMoney(fee) : 0;
    if (feeMinor === null || feeMinor < 0) return setError('Biaya transfer belum valid.');
    if (importedPending) {
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
      if (pair.type !== 'unreviewed' || pair.walletId !== (incomingPending ? walletId : toWalletId)
        || Math.abs(pair.amount) !== (incomingPending ? minor : toMinor)) return setError('Transaksi pasangan belum cocok dengan nominal transfer.');
      removeIds.push(pair.id);
    }
    const cleanState = { ...state, entries: state.entries.filter(e => !removeIds.includes(e.id)) };
    const entry: Entry = {
      id: existing?.id ?? makeId(), type, walletId, amount: minor, date,
      category: type === 'expense' || type === 'income' ? category : '', note: note.trim(),
      ...(existing?.sourceKey && !(type === 'transfer' && incomingPending) ? { sourceKey: existing.sourceKey } : {}),
      ...(existing?.importBatch ? { importBatch: existing.importBatch } : {}),
    };
    if (type === 'adjustment') entry.amount = minor - walletBalance(cleanState, walletId);
    if (type === 'transfer') {
      entry.toWalletId = toWalletId; entry.toAmount = toMinor ?? 0; entry.rate = effectiveRate; entry.fee = feeMinor;
      if (incomingPending) { entry.toSourceKey = existing?.sourceKey; entry.sourceKey = pair?.sourceKey; }
      else if (pair) entry.toSourceKey = pair.sourceKey;
      else if (existing?.toSourceKey) entry.toSourceKey = existing.toSourceKey;
    }
    const problem = validateEntry(cleanState, entry);
    if (problem) return setError(problem);
    try { state.wallets.forEach(w => walletBalance({ ...cleanState, entries: [...cleanState.entries, entry] }, w.id)); }
    catch { return setError('Nominal terlalu besar untuk disimpan dengan tepat.'); }
    const repeat = !existing && (type === 'expense' || type === 'income')
      && (e.nativeEvent as SubmitEvent).submitter?.getAttribute('data-repeat') === 'true';
    if (onSave(entry, removeIds, repeat) && repeat) {
      setAmount(''); setNote(''); setError('');
      requestAnimationFrame(() => amountRef.current?.focus());
    }
  }
  const options: TxMode[] = importedPending ? (incomingPending ? ['income', 'transfer'] : ['expense', 'transfer']) : ['expense', 'income', 'transfer', 'adjustment'];
  return <Modal title={importedPending ? 'Cek transaksi ini' : type === 'adjustment' ? 'Cocokkan saldo' : existing ? 'Ubah transaksi' : type === 'transfer' ? 'Pindah uang' : 'Catat transaksi'} subtitle={type === 'transfer' ? 'Uangnya berpindah. Total belanja tetap sama.' : 'Catat secukupnya. Kategori bisa dibereskan nanti.'} onClose={onClose}>
    <form onSubmit={submit}><div className="modal-body">
      <div className="segmented-control" aria-label="Jenis transaksi">{options.map(t => <button key={t} type="button" className={type === t ? 'active' : ''} onClick={() => changeType(t)}>{t === 'adjustment' ? 'Cek saldo' : typeLabels[t]}</button>)}</div>
      <div className="form-grid">
        <label className="field"><span className="field-label">{type === 'transfer' ? 'Dari dompet' : 'Dompet'}</span><select required aria-label="Dompet asal" className="select-input" value={walletId} disabled={importedPending && (!incomingPending || type !== 'transfer')} onChange={e => { setWallet(e.target.value); if (type === 'transfer' && !incomingPending) setToWallet(preferredDestination(state.wallets, e.target.value)); setPairId(''); setConfirmed(false); }}>{state.wallets.filter(w => !(incomingPending && type === 'transfer' && w.id === existing.walletId)).map(w => <option key={w.id} value={w.id}>{w.name} · {w.currency}</option>)}</select></label>
        {type === 'transfer' ? <label className="field"><span className="field-label">Ke dompet</span><select required aria-label="Dompet tujuan" className="select-input" value={toWalletId} disabled={!!incomingPending} onChange={e => { setToWallet(e.target.value); setPairId(''); setConfirmed(false); }}>{state.wallets.filter(w => w.id !== walletId).map(w => <option key={w.id} value={w.id}>{w.name} · {w.currency}</option>)}</select></label> : <label className="field"><span className="field-label">Tanggal</span><input required type="date" className="field-input" value={date} disabled={!!importedPending} onChange={e => setDate(e.target.value)} /></label>}
        <label className="field full"><span className="field-label">{type === 'adjustment' ? 'Saldo yang benar sekarang' : type === 'transfer' ? 'Nominal yang keluar' : 'Nominal'} <span className="field-currency">{source?.currency}</span></span><input ref={amountRef} data-autofocus required autoComplete="off" className="field-input amount-input" inputMode="decimal" aria-label="Nominal" placeholder="0" value={amount} disabled={importedPending && (!incomingPending || type !== 'transfer')} onChange={e => { setAmount(e.target.value); setConfirmed(false); }} />{type === 'adjustment' && source && <span className="field-help">Saldo catatan: {formatMoney(walletBalance(state, source.id), source.currency)}. Selisih dicatat sebagai penyesuaian, tanpa mengubah total pemasukan atau belanja.</span>}</label>
        {crossCurrency && <div className="field full fx-section">
          <div className="segmented-control compact"><button type="button" className={fxMode === 'rate' ? 'active' : ''} disabled={!!incomingPending} onClick={() => { setFxMode('rate'); setConfirmed(false); }}>Isi kurs</button><button type="button" className={fxMode === 'received' ? 'active' : ''} onClick={() => { setFxMode('received'); setConfirmed(false); }}>Isi jumlah diterima</button></div>
          {fxMode === 'rate' ? <label className="field"><span className="field-label">1 {source.currency} = berapa {destination.currency}?</span><input required aria-label="Kurs transaksi" inputMode="decimal" className="field-input" placeholder="Contoh: 400,5" value={rateText} onChange={e => { setRate(e.target.value); setConfirmed(false); }} /><span className="field-help">Tanpa pemisah ribuan. Contoh: 16000 atau 16000,5.</span></label> : <label className="field"><span className="field-label">Nominal yang diterima ({destination.currency})</span><input required aria-label="Nominal diterima" className="field-input" inputMode="decimal" placeholder="0" value={received} disabled={!!incomingPending} onChange={e => { setReceived(e.target.value); setConfirmed(false); }} /></label>}
          <div className="rate-preview"><ArrowLeftRight size={18} /><div><strong>{toMinor !== null && Number.isSafeInteger(toMinor) ? formatMoney(toMinor, destination.currency) : '—'} diterima</strong><span>1 {source.currency} = {Number.isFinite(effectiveRate) ? new Intl.NumberFormat('id-ID', { maximumFractionDigits: 8 }).format(effectiveRate) : '…'} {destination.currency}</span></div></div>
          <label className="checkbox-row"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Kurs ini sesuai transaksi saya</label><p className="field-help">Kurs ini disimpan untuk transaksi ini. Tidak mengikuti perubahan kurs harian.</p>
        </div>}
        {type === 'transfer' && <>
          {!crossCurrency && <div className="notice full"><ArrowLeftRight size={16} />{toMinor !== null && destination ? `${formatMoney(toMinor, destination.currency)} masuk ke ${destination.name}.` : 'Pilih dompet tujuan yang berbeda.'}</div>}
          <label className="field"><span className="field-label">Biaya tambahan ({source?.currency})</span><input inputMode="decimal" className="field-input" placeholder="0" value={fee} disabled={importedPending && !incomingPending} onChange={e => setFee(e.target.value)} /><span className="field-help">{importedPending && !incomingPending ? 'Biaya bank yang ada di mutasi dicatat dari barisnya sendiri.' : 'Biaya dibebankan di luar nominal transfer.'}</span></label>
          <label className="field"><span className="field-label">Tanggal</span><input required type="date" className="field-input" value={date} disabled={!!importedPending} onChange={e => setDate(e.target.value)} /></label>
          {existing && <label className="field full"><span className="field-label">Catatan pasangan di dompet {incomingPending ? 'asal' : 'tujuan'}</span><select className="select-input" value={pairId} onChange={e => selectPair(e.target.value)}><option value="">Belum tercatat — buat sisi pasangannya</option>{pairCandidates.map(e => <option key={e.id} value={e.id}>{formatDate(e.date)} · {formatMoney(Math.abs(e.amount), state.wallets.find(w => w.id === e.walletId)!.currency)} · {e.note.slice(0, 45)}</option>)}</select><span className="field-help">Pilih jika sisi transfer ini sudah diimpor. Dua catatan akan digabung supaya saldo tidak dihitung dua kali.</span></label>}
        </>}
        {(type === 'expense' || type === 'income') && <label className="field full"><span className="field-label">Kategori <span className="optional">boleh nanti</span></span><select className="select-input" value={category} onChange={e => setCategory(e.target.value)}>{CATEGORY_NAMES.map(c => <option key={c}>{c}</option>)}</select></label>}
        <label className="field full"><span className="field-label">Keterangan <span className="optional">opsional</span></span><input className="field-input" maxLength={2000} value={note} placeholder="Contoh: makan siang, tarik tunai…" onChange={e => setNote(e.target.value)} /></label>
        {error && <div className="notice error full" role="alert">{error}</div>}
      </div>
    </div><div className={`modal-footer ${!existing && (type === 'expense' || type === 'income') ? 'repeat-entry-footer' : ''}`}>{existing && onDelete && <button type="button" className="button danger small" style={{ marginRight: 'auto' }} onClick={onDelete}><Trash2 size={15} /> Hapus</button>}<button type="button" className="button secondary" onClick={onClose}>Batal</button><button className="button primary" type="submit"><Check size={17} /> {importedPending ? 'Simpan hasil cek' : 'Simpan transaksi'}</button>{!existing && (type === 'expense' || type === 'income') && <button className="button secondary" type="submit" data-repeat="true">Simpan &amp; catat lagi</button>}</div></form>
  </Modal>;
}

function TransactionTable({ entries, state, onEdit, onDelete }: { entries: Entry[]; state: State; onEdit: (entry: Entry) => void; onDelete: (entry: Entry) => void }) {
  if (!entries.length) return <div className="empty-state"><History size={30} /><h3>Belum ada transaksi di sini</h3><p>Mulai dari satu catatan kecil, atau impor mutasi rekeningmu.</p></div>;
  return <div className="table-wrap"><table className="transactions-table"><thead><tr><th>Transaksi</th><th>Dompet</th><th>Tanggal</th><th>Nominal</th><th><span className="screen-reader-only">Aksi</span></th></tr></thead><tbody>{entries.map(entry => {
    const wallet = state.wallets.find(w => w.id === entry.walletId)!;
    const destination = state.wallets.find(w => w.id === entry.toWalletId);
    const positive = entry.type === 'income' || ((entry.type === 'adjustment' || entry.type === 'unreviewed') && entry.amount > 0);
    const Icon = entry.type === 'transfer' ? ArrowLeftRight : entry.type === 'adjustment' ? SlidersHorizontal : positive ? ArrowDownLeft : entry.category === 'Makan & minum' ? Coffee : ArrowUpRight;
    return <tr key={entry.id}><td><div className="transaction-cell"><span className={`transaction-icon ${entry.type}`}><Icon size={18} /></span><div><span className="transaction-title">{entry.note || typeLabels[entry.type]}</span><span className="transaction-note">{entry.type === 'transfer' ? `${wallet.name} → ${destination?.name}` : entry.type === 'unreviewed' ? 'Jenis transaksi belum dikonfirmasi' : entry.category || typeLabels[entry.type]}</span><span className="transaction-mobile-meta">{wallet.name} · {formatDate(entry.date)}</span></div></div></td><td><span className="wallet-table-name">{wallet.name}</span><span className="transaction-note">{wallet.currency}</span></td><td className="date-cell">{formatDate(entry.date)}</td><td className="amount-cell"><strong className={entry.type === 'transfer' ? '' : positive ? 'amount-positive' : 'amount-negative'}>{entry.type === 'transfer' ? '' : positive ? '+' : '−'}{formatMoney(Math.abs(entry.amount), wallet.currency)}</strong>{entry.type === 'transfer' && destination && <span className="transaction-note">→ {formatMoney(entry.toAmount ?? 0, destination.currency)}</span>}{entry.fee ? <span className="transaction-note">Biaya {formatMoney(entry.fee, wallet.currency)}</span> : null}{entry.type === 'unreviewed' && <span className="badge unreviewed">Perlu dicek</span>}</td><td><div className="row-actions"><button className={entry.type === 'unreviewed' ? 'button secondary small' : 'icon-button'} aria-label={`${entry.type === 'unreviewed' ? 'Cek' : 'Ubah'} ${entry.note || 'transaksi'}`} onClick={() => onEdit(entry)}>{entry.type === 'unreviewed' ? 'Cek' : <MoreHorizontal size={18} />}</button><button className="icon-button delete-action" aria-label={`Hapus ${entry.note || 'transaksi'}`} onClick={() => onDelete(entry)}><Trash2 size={15} /></button></div></td></tr>;
  })}</tbody></table></div>;
}

function ImportView({ state, demo, onStart, onImport, notify }: { state: State; demo: boolean; onStart: () => void; onImport: (entries: Entry[], walletId: string, opening?: number) => void; notify: (text: string) => void }) {
  const [walletId, setWallet] = useState(state.wallets.find(w => w.name.toLowerCase().includes('ziraat'))?.id ?? state.wallets.find(w => w.currency === 'TRY')?.id ?? '');
  const [result, setResult] = useState<ReturnType<typeof parseZiraatWorkbook> | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [filename, setFilename] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [useOpening, setUseOpening] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const readGeneration = useRef(0);
  const reading = useRef(false);
  const previewWalletId = useRef('');
  useEffect(() => () => { readGeneration.current += 1; reading.current = false; }, []);
  const wallet = state.wallets.find(w => w.id === walletId);
  const existingActivity = state.entries.some(e => e.walletId === walletId || e.toWalletId === walletId);
  const selected = rows.filter(r => r.selected && !r.duplicate);
  async function readFile(file?: File) {
    if (!file || reading.current) return;
    if (demo) { setError('Mulai dengan data sendiri dulu agar mutasi asli tidak tercampur dengan contoh.'); return; }
    if (!wallet) { setError('Pilih dompet tujuan terlebih dahulu.'); return; }
    if (!file.name.toLowerCase().endsWith('.xlsx')) { setError('Untuk versi awal, gunakan file Excel Ziraat berformat .xlsx.'); return; }
    if (file.size > 8 * 1024 * 1024) { setError('Ukuran file maksimal 8 MB.'); return; }
    const generation = ++readGeneration.current;
    reading.current = true;
    previewWalletId.current = '';
    setBusy(true); setError(''); setResult(null); setRows([]);
    try {
      const bytes = await file.arrayBuffer();
      if (generation !== readGeneration.current) return;
      const parsed = parseZiraatWorkbook(bytes, wallet, state.entries);
      // A manually recorded transaction can overlap an import without sharing its bank source key.
      const reviewed = parsed.rows.map(row => {
        if (row.duplicate) return row;
        const possible = state.entries.some(e => !e.sourceKey && e.date === row.date && (
          e.walletId === wallet.id && (e.type === 'income' || e.type === 'adjustment' || e.type === 'unreviewed' ? e.amount : -e.amount - (e.fee ?? 0)) === row.amount
          || e.type === 'transfer' && e.toWalletId === wallet.id && e.toAmount === row.amount
        ));
        return possible ? { ...row, selected: false, warning: 'Mungkin sudah dicatat manual. Bandingkan di Transaksi sebelum memilih baris ini.' } : row;
      });
      const rangeProblem = validateImportRange(state, wallet.id, { ...parsed, rows: reviewed });
      if (rangeProblem) throw new Error(rangeProblem);
      if (generation !== readGeneration.current) return;
      previewWalletId.current = wallet.id;
      setResult(parsed); setRows(reviewed); setFilename(file.name); setUseOpening(!existingActivity);
    } catch (err) { if (generation === readGeneration.current) setError(err instanceof Error ? err.message : 'File belum bisa dibaca. Coba ekspor ulang file Excel dari bank.'); }
    finally { if (generation === readGeneration.current) { reading.current = false; setBusy(false); if (inputRef.current) inputRef.current.value = ''; } }
  }
  function confirmImport() {
    if (!wallet || !result || !selected.length) return;
    if (previewWalletId.current !== wallet.id) { setError('Dompet tujuan berubah. Baca ulang file untuk dompet yang dipilih.'); return; }
    try {
      const rangeProblem = validateImportRange(state, wallet.id, { ...result, rows });
      if (rangeProblem) throw new Error(rangeProblem);
      const knownKeys = new Set(state.entries.flatMap(e => [e.sourceKey, e.toSourceKey]).filter(Boolean));
      if (rows.some(row => row.selected && !row.duplicate && knownKeys.has(row.sourceKey))) {
        setRows(rows.map(row => knownKeys.has(row.sourceKey) ? { ...row, duplicate: true, selected: false } : row));
        setError('Ada transaksi yang sudah tersimpan sejak file dibaca. Pilih ulang transaksi baru sebelum menyimpan.'); return;
      }
      const entries = entriesFromImport(rows, wallet.id, makeId());
      if (!entries.length) { setError('Pilih setidaknya satu transaksi yang belum diimpor.'); return; }
      onImport(entries, wallet.id, useOpening && !existingActivity ? result.openingBalance : undefined);
      setRows([]); setResult(null); setFilename('');
      notify(`${entries.length} transaksi tersimpan. Yang belum jelas ditandai “Perlu dicek”.`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Transaksi belum bisa disimpan.'); }
  }
  return <>
    {demo && <div className="notice warning"><CircleHelp size={19} /><div>Mode contoh masih aktif. Mulai dengan data sendiri sebelum mengimpor mutasi asli.</div><button className="button secondary small" onClick={onStart}>Mulai dari kosong</button></div>}
    <div className="import-layout"><section className="panel import-main"><div className="panel-header"><div><h2>Mutasi masuk, catatan beres.</h2><p>Satu unggahan untuk banyak transaksi.</p></div><span className="badge neutral">Ziraat · Excel</span></div>
      <label className="field"><span className="field-label">Simpan ke dompet</span><select aria-label="Dompet impor" className="select-input" value={walletId} disabled={busy} onChange={e => { readGeneration.current += 1; reading.current = false; previewWalletId.current = ''; setWallet(e.target.value); setResult(null); setRows([]); setError(''); }}>{state.wallets.filter(w => w.currency === 'TRY').map(w => <option key={w.id} value={w.id}>{w.name} · {w.currency}</option>)}</select></label>
      {!wallet && <div className="notice warning">Tambahkan dompet TL/TRY di menu Dompet terlebih dahulu.</div>}
      <div className={`import-dropzone ${busy ? 'busy' : ''}`} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) void readFile(e.dataTransfer.files[0]); }}>
        <span className="import-file-icon"><FileSpreadsheet size={30} /></span><h3>{busy ? 'Membaca mutasi…' : 'Taruh file Excel di sini'}</h3><p>atau pilih file dari perangkatmu</p><button className="button primary" disabled={busy || !wallet} onClick={() => inputRef.current?.click()}><FolderOpen size={17} /> Pilih file .xlsx</button><span className="field-help">Ekspor mutasi Ziraat · maksimal 8 MB</span>
        <input ref={inputRef} aria-label="File mutasi Ziraat" type="file" accept=".xlsx" hidden disabled={busy} onChange={e => void readFile(e.target.files?.[0])} />
      </div><p className="privacy-note"><ShieldCheck size={16} /> File dibaca di browser. Tidak dikirim ke server.</p>
    </section><aside className="panel import-info"><span className="eyebrow">CARA KERJANYA</span><h3>Lebih sedikit ketik.<br />Lebih banyak waktu.</h3><div className="import-steps">{[['Pilih dompet', 'Pastikan rekening dan mata uangnya sesuai.'], ['Cek hasil bacaan', 'Tanggal, nominal, dan saldo terisi dari file.'], ['Simpan, rapikan nanti', 'Transaksi yang belum jelas tetap tercatat.']].map(([title, text], i) => <div className="import-step" key={title}><span>{i + 1}</span><div><strong>{title}</strong><p>{text}</p></div></div>)}</div><div className="notice"><Leaf size={19} /><span>Format bank lainnya menyusul. Versi ini sudah mendukung contoh Excel Ziraat yang kita cek.</span></div></aside></div>
    {error && <div className="notice error" role="alert">{error}</div>}
    {result && wallet && <section className="panel import-preview"><div className="panel-header"><div><h2>Periksa sebelum disimpan</h2><p>{filename} · {formatDate(result.period.start)} – {formatDate(result.period.end)}</p></div><span className="badge neutral">{rows.length} transaksi</span></div>
      <div className="import-summary"><span><strong>{selected.length}</strong> dipilih</span><span><strong>{rows.filter(r => r.duplicate).length}</strong> sudah pernah diimpor</span><span><strong>{selected.filter(r => r.classification === 'unreviewed').length}</strong> perlu dicek nanti</span></div>
      {result.warnings.map((w, i) => <div key={i} className="notice warning">{w}</div>)}
      {!existingActivity && <label className="checkbox-row opening-checkbox"><input type="checkbox" checked={useOpening} onChange={e => setUseOpening(e.target.checked)} /><span>Gunakan saldo sebelum transaksi pertama: <strong>{formatMoney(result.openingBalance, wallet.currency)}</strong><small className="field-help">Menggantikan saldo awal dompet ini. Saldo akhir pada file: {formatMoney(result.closingBalance, wallet.currency)}.</small></span></label>}
      <div className="table-wrap"><table className="transactions-table import-table"><thead><tr><th><input type="checkbox" aria-label="Pilih semua transaksi baru" checked={rows.some(r => !r.duplicate) && rows.filter(r => !r.duplicate).every(r => r.selected)} onChange={e => setRows(rows.map(r => ({ ...r, selected: !r.duplicate && e.target.checked })))} /></th><th>Transaksi</th><th>Nominal</th><th>Jenis</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className={row.duplicate ? 'duplicate-row' : ''}><td><input type="checkbox" aria-label={`Pilih transaksi ${formatDate(row.date)} ${row.id}`} checked={row.selected} disabled={row.duplicate} onChange={e => setRows(rows.map(r => r.id === row.id ? { ...r, selected: e.target.checked } : r))} /></td><td><span className="transaction-title">{row.description}</span><span className="transaction-note">{formatDate(row.date)}{row.duplicate ? ' · Sudah diimpor' : ''}</span>{row.warning && <span className="import-row-warning">{row.warning}</span>}</td><td className={row.amount > 0 ? 'amount-positive' : 'amount-negative'}>{row.amount > 0 ? '+' : '−'}{formatMoney(Math.abs(row.amount), wallet.currency)}</td><td><select className="select-input compact" aria-label={`Jenis transaksi ${row.id}`} disabled={row.duplicate} value={row.classification} onChange={e => setRows(rows.map(r => r.id === row.id ? { ...r, classification: e.target.value as ImportRow['classification'] } : r))}><option value="unreviewed">Perlu dicek</option>{row.amount > 0 ? <option value="income">Pemasukan</option> : <option value="expense">Pengeluaran</option>}</select></td></tr>)}</tbody></table></div>
      <div className="import-actions"><p>Transfer antar dompet bisa disambungkan dari menu Transaksi setelah impor.</p><button className="button primary" disabled={!selected.length} onClick={confirmImport}><CheckCheck size={18} /> Simpan {selected.length} transaksi</button></div>
    </section>}
  </>;
}

export default function App() {
  const [initial] = useState(readStored);
  const [preferences, setPreferences] = useState(readPreferences);
  const [data, setData] = useState<StoredData>(initial.data);
  const [storageError, setStorageError] = useState(initial.error ?? '');
  const [blocked, setBlocked] = useState(initial.blocked);
  const [page, setPage] = useState<Page>('overview');
  const [currency, setCurrency] = useState<Currency>(preferences.currency);
  const [month, setMonth] = useState(today().slice(0, 7));
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [walletModal, setWalletModal] = useState<Wallet | 'new' | null>(null);
  const [txModal, setTxModal] = useState<{ type: TxMode; walletId?: string; existing?: Entry } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; text: string; label: string; action: () => void } | null>(null);
  const [toast, setToast] = useState('');
  const restoreRef = useRef<HTMLInputElement>(null);
  const state = data.state;
  const notify = (text: string) => setToast(text);
  useEffect(() => {
    if (blocked) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); setStorageError(''); }
    catch { setStorageError('Penyimpanan browser tidak tersedia atau penuh. Unduh cadangan sebelum menutup halaman ini.'); }
  }, [data, blocked]);
  useEffect(() => { if (toast) { const id = setTimeout(() => setToast(''), 5500); return () => clearTimeout(id); } }, [toast]);
  useEffect(() => { writePreferences({ ...preferences, currency }); }, [preferences, currency]);
  const update = (next: State): boolean => {
    try { const checked = validateBackup({ ...data, state: next }); setData(checked); return true; }
    catch (err) { notify(err instanceof Error ? err.message : 'Perubahan belum bisa disimpan.'); return false; }
  };
  const summary = summaryForCurrency(state, currency, month);
  const currencyWallets = state.wallets.filter(w => w.currency === currency);
  const overviewWallets = [...currencyWallets.filter(w => w.kind === 'cash'), ...currencyWallets.filter(w => w.kind !== 'cash')].slice(0, 4);
  const pendingCount = state.entries.filter(needsReview).length;
  const isReviewQueue = page === 'transactions' && filter === 'pending';
  const allTransactions = useMemo(() => state.entries.filter(e => {
    const w = state.wallets.find(w => w.id === e.walletId), to = state.wallets.find(w => w.id === e.toWalletId);
    const inCurrency = w?.currency === currency || to?.currency === currency;
    const inMonth = e.date.startsWith(month);
    const matchesQuery = `${e.note} ${e.category} ${w?.name} ${to?.name ?? ''}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === 'all' || filter === 'pending' && needsReview(e) || e.type === filter;
    return (isReviewQueue || (inCurrency && inMonth)) && matchesQuery && matchesFilter;
  }).sort((a, b) => b.date.localeCompare(a.date) || state.entries.indexOf(b) - state.entries.indexOf(a)), [state, currency, month, query, filter, isReviewQueue]);
  const categoryTotals = useMemo(() => {
    const totals = new Map<string, number>();
    state.entries.filter(e => e.type === 'expense' && e.date.startsWith(month) && currencyWallets.some(w => w.id === e.walletId)).forEach(e => totals.set(e.category || 'Belum dikategorikan', (totals.get(e.category || 'Belum dikategorikan') ?? 0) + e.amount));
    const fees = state.entries.filter(e => e.type === 'transfer' && e.date.startsWith(month) && currencyWallets.some(w => w.id === e.walletId)).reduce((sum, e) => sum + (e.fee ?? 0), 0);
    if (fees) totals.set('Biaya transfer', (totals.get('Biaya transfer') ?? 0) + fees);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [state, currency, month]);
  function startOwn() {
    setConfirm({ title: 'Mulai dengan uangmu sendiri?', text: 'Data contoh akan diganti dengan dompet kosong. Isi saldo awalmu atau impor mutasi untuk mulai mencatat.', label: 'Mulai dari kosong', action: () => { setBlocked(false); setData({ app: 'uangku', version: 1, demo: false, state: createEmptyState() }); notify('Dompetmu siap. Mulai dari saldo hari ini.'); } });
  }
  function openTx(type: TxMode, walletId?: string) {
    if (!state.wallets.length) { setWalletModal('new'); notify('Tambahkan satu dompet terlebih dahulu.'); return; }
    if (type === 'transfer' && state.wallets.length < 2) { setWalletModal('new'); notify('Transfer membutuhkan dua dompet.'); return; }
    setTxModal({ type, walletId: walletId ?? preferredWallet(state.wallets, currency, preferences) });
  }
  function saveWallet(wallet: Wallet) {
    const exists = state.wallets.some(w => w.id === wallet.id);
    const next = { ...state, wallets: exists ? state.wallets.map(w => w.id === wallet.id ? wallet : w) : [...state.wallets, wallet] };
    try { next.wallets.forEach(w => walletBalance(next, w.id)); }
    catch { notify('Saldo terlalu besar untuk disimpan dengan tepat.'); return; }
    if (!update(next)) return;
    setWalletModal(null); setCurrency(wallet.currency); notify('Dompet tersimpan.');
  }
  function saveEntry(entry: Entry, removeIds: string[], keepOpen = false): boolean {
    const originalIndex = state.entries.findIndex(e => e.id === entry.id);
    const nextEntries = state.entries.filter(e => !removeIds.includes(e.id));
    if (originalIndex >= 0) {
      const insertionIndex = state.entries.slice(0, originalIndex).filter(e => !removeIds.includes(e.id)).length;
      nextEntries.splice(insertionIndex, 0, entry);
    } else nextEntries.push(entry);
    if (!update({ ...state, entries: nextEntries })) return false;
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
  function editEntry(entry: Entry) { setTxModal({ type: entry.type === 'unreviewed' ? (entry.amount > 0 ? 'income' : 'expense') : entry.type, existing: entry }); }
  function deleteEntry(entry: Entry) {
    setConfirm({ title: 'Hapus transaksi ini?', text: entry.type === 'transfer' ? 'Saldo dompet asal dan tujuan akan dihitung ulang. Kalau ini hasil impor, transaksi bisa muncul lagi saat file yang sama diimpor.' : 'Saldo dompet akan dihitung ulang. Tindakan ini tidak bisa dibatalkan.', label: 'Hapus transaksi', action: () => { if (update({ ...state, entries: state.entries.filter(e => e.id !== entry.id) })) notify('Transaksi dihapus.'); } });
  }
  function importEntries(entries: Entry[], walletId: string, opening?: number) {
    const next: State = { ...state, wallets: state.wallets.map(w => w.id === walletId && opening !== undefined ? { ...w, openingBalance: opening } : w), entries: [...state.entries] };
    for (const entry of [...entries].reverse()) {
      const problem = validateEntry(next, entry);
      if (problem) throw new Error(problem);
      next.entries.push(entry);
    }
    next.wallets.forEach(w => walletBalance(next, w.id));
    if (!update(next)) throw new Error('Impor belum bisa disimpan. Periksa pemberitahuan validasi data.');
    setCurrency(state.wallets.find(w => w.id === walletId)!.currency);
  }
  async function restore(file?: File) {
    if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('Ukuran cadangan maksimal 8 MB.');
      const restored = validateBackup(JSON.parse(await file.text()));
      setConfirm({ title: 'Pulihkan cadangan?', text: `${restored.state.wallets.length} dompet dan ${restored.state.entries.length} transaksi akan menggantikan catatan di browser ini. Unduh cadangan sekarang dulu jika catatan lama masih dibutuhkan.`, label: 'Pulihkan data', action: () => { setBlocked(false); setData(restored); notify('Cadangan berhasil dipulihkan.'); } });
    } catch (err) { notify(err instanceof Error ? err.message : 'File cadangan tidak valid.'); }
    finally { if (restoreRef.current) restoreRef.current.value = ''; }
  }
  const navigation: { page: Page; label: string; icon: typeof WalletIcon }[] = [{ page: 'overview', label: 'Ringkasan', icon: LayoutDashboard }, { page: 'wallets', label: 'Dompet', icon: WalletIcon }, { page: 'transactions', label: 'Transaksi', icon: ArrowLeftRight }, { page: 'import', label: 'Impor mutasi', icon: Upload }];
  const titles = { overview: ['Halo, Zayyan.', 'Uangmu di mana-mana. Catatannya cukup di sini.'], wallets: ['Semua dompetmu.', 'Cash, rekening, dan e-wallet. Masing-masing tetap jelas.'], transactions: ['Catatan kecil, lebih tenang.', 'Lihat uang yang masuk, keluar, dan berpindah.'], import: ['Biar file yang bantu.', 'Kurangi ketik satu-satu. Mulai dari mutasi rekening.'] };
  function navigate(next: Page) { setPage(next); setQuery(''); setFilter('all'); }
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="#" onClick={e => { e.preventDefault(); navigate('overview'); }} aria-label="Uangku beranda"><span className="brand-mark">u<span /></span><span className="brand-copy">uangku<span>uangmu, lebih rapi.</span></span></a><span className="nav-caption">RUANG UANGMU</span><nav>{navigation.map(({ page: p, label, icon: Icon }) => <button key={p} className={`nav-item ${page === p ? 'active' : ''}`} onClick={() => navigate(p)} aria-current={page === p ? 'page' : undefined}><Icon size={20} /><span>{label}</span>{p === 'transactions' && pendingCount > 0 && <span className="nav-count">{pendingCount}</span>}{page === p && <ChevronRight className="nav-chevron" size={15} />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-tip"><Leaf size={23} /><strong>Nggak harus sempurna.</strong><p>Satu catatan hari ini lebih baik daripada menunggu lengkap.</p></div><div className="backup-tools"><button onClick={() => { downloadText(JSON.stringify(data, null, 2), `uangku-cadangan-${today()}.json`); notify('Cadangan diunduh. Simpan di tempat pribadimu.'); }}><Download size={16} /> Cadangkan data</button><button onClick={() => restoreRef.current?.click()}><History size={16} /> Pulihkan cadangan</button></div><div className="sidebar-user"><span className="avatar">Z</span><div><strong>Ruang pribadi</strong><span><span className="status-dot" /> Tersimpan di browser</span></div><ShieldCheck size={18} /></div></div>
    </aside>
    <main className="main-content"><header className="topbar"><div className="breadcrumb">Ruang pribadi <ChevronRight size={13} /><strong>{navigation.find(n => n.page === page)?.label}</strong></div><div className="topbar-tools"><span className="local-indicator"><span className="status-dot" /> Lokal & pribadi</span><span className="avatar small">Z</span></div></header>
      <div className="page-content"><div className="page-header"><div><div className="eyebrow">SEDIKIT DICATAT, BANYAK TERBANTU</div><h1 className="page-title">{titles[page][0]} {page === 'overview' && <span className="greeting-leaf">✳</span>}</h1><p className="page-subtitle">{titles[page][1]}</p></div><div className="page-actions">{page === 'wallets' ? <button className="button primary" onClick={() => setWalletModal('new')}><Plus size={18} /> Tambah dompet</button> : <><button className="button secondary" onClick={() => openTx('transfer')}><ArrowLeftRight size={17} /> Pindah uang</button><button className="button primary" onClick={() => openTx('expense')}><Plus size={18} /> Catat transaksi</button></>}</div></div>
      {storageError && <div className="notice error" role="alert"><div>{storageError}</div><button className="button secondary small" onClick={() => { let text = JSON.stringify(data); if (blocked) { try { text = localStorage.getItem(STORAGE_KEY) ?? text; } catch { /* Keep the current recoverable data. */ } } downloadText(text, 'uangku-cadangan-pemulihan.json'); }}>Unduh data yang ada</button>{blocked && <button className="button secondary small" onClick={startOwn}>Mulai ulang</button>}</div>}
      {data.demo && <div className="demo-banner"><span className="demo-banner-icon"><Sparkles size={20} /></span><div className="demo-banner-copy"><strong>Kenalan dulu pakai data contoh.</strong><span>Semua angka di sini fiktif. Coba fiturnya, lalu mulai dengan uangmu sendiri.</span></div><button className="button ghost small" onClick={startOwn}>Mulai pakai data sendiri <ArrowRight size={16} /></button></div>}
      {page !== 'import' && !isReviewQueue && <div className="currency-toolbar"><div className="currency-tabs" aria-label="Mata uang">{CURRENCIES.map(c => <button key={c.code} className={`currency-tab ${currency === c.code ? 'active' : ''}`} onClick={() => setCurrency(c.code)} aria-pressed={currency === c.code}><span className="currency-flag">{currencyFlag(c.code)}</span><span className="currency-code">{c.code === 'TRY' ? 'TL' : c.code}</span><span className="currency-label">{c.label}</span></button>)}</div>{page !== 'wallets' && <label className="date-pill"><History size={15} /><input aria-label="Bulan laporan" type="month" value={month} onChange={e => { if (e.target.value) setMonth(e.target.value); }} /></label>}</div>}
      {page === 'overview' && <>
        <div className="overview-grid"><section className="balance-card"><div className="balance-card-top"><span className="balance-label">Total saldo {currencyLabel(currency)}</span><span className="balance-currency">{currency === 'TRY' ? 'TL' : currency}</span></div><div className="balance-number">{formatMoney(summary.balance, currency)}</div><div className="balance-meta"><WalletIcon size={15} /><span>Tersebar di {currencyWallets.length} dompet</span><span className="balance-separator">·</span><span>Saldo saat ini</span></div><span className="balance-orbit orbit-one" /><span className="balance-orbit orbit-two" /><div className="balance-bottom"><ShieldCheck size={15} /><span>Saldo mata uang lain tetap terpisah</span></div></section>
          <div className="stats-stack"><section className="stat-card"><span className="stat-icon income"><ArrowDownLeft size={22} /></span><div><span className="stat-label">Pemasukan bulan ini</span><strong className="stat-value">{formatMoney(summary.income, currency)}</strong><span className="stat-foot">Uang masuk yang sudah dikonfirmasi</span></div></section><section className="stat-card"><span className="stat-icon expense"><ArrowUpRight size={22} /></span><div><span className="stat-label">Pengeluaran bulan ini</span><strong className="stat-value">{formatMoney(summary.expense, currency)}</strong><span className="stat-foot">Termasuk biaya transfer</span></div></section></div>
        </div>
        <div className="dashboard-columns"><section className="panel"><div className="panel-header"><div><h2>Dompetmu</h2><p>Uangnya ada di sini.</p></div><button className="text-link" onClick={() => navigate('wallets')}>Lihat semua <ArrowRight size={15} /></button></div><div className="wallet-list">{overviewWallets.map(w => <div className="wallet-row-wrap" key={w.id}><button className="wallet-row" onClick={() => setWalletModal(w)}><WalletSymbol wallet={w} /><span className="wallet-info"><strong className="wallet-name">{w.name}</strong><span className="wallet-detail">{kindLabel(w.kind)} · {w.currency}</span></span><strong className="wallet-amount">{formatMoney(walletBalance(state, w.id), w.currency)}</strong><ChevronRight size={16} /></button>{w.kind === 'cash' && <button className="quick-wallet-action" aria-label={`Catat dari ${w.name}`} title="Catat pengeluaran cash" onClick={() => openTx('expense', w.id)}><Plus size={17} /></button>}</div>)}{!currencyWallets.length && <div className="empty-state compact"><WalletIcon size={25} /><p>Belum ada dompet {currency}.</p><button className="text-link" onClick={() => setWalletModal('new')}>Tambah dompet</button></div>}</div></section>
          <section className="panel category-panel"><div className="panel-header"><div><h2>Ke mana uangmu?</h2><p>Pengeluaran bulan ini.</p></div><span className="category-heading-icon"><Tags size={18} /></span></div>{categoryTotals.length ? <div className="category-list">{categoryTotals.slice(0, 4).map(([name, amount], i) => <div className="category-row" key={name}><div className="category-labels"><span className="category-name"><span className="category-dot" style={{ background: COLORS[i] }} />{name}</span><strong className="category-value">{formatMoney(amount, currency)}</strong></div><div className="category-track"><span className="category-fill" style={{ width: `${summary.expense ? amount / summary.expense * 100 : 0}%`, background: COLORS[i] }} /></div></div>)}{categoryTotals.length > 4 && <span className="field-help">+{categoryTotals.length - 4} kategori lainnya</span>}</div> : <div className="empty-state compact"><Leaf size={27} /><p>Belum ada pengeluaran yang dikonfirmasi.</p></div>}<div className="category-legend"><span className="status-dot" /> Transfer antar dompet tidak dihitung sebagai belanja.</div></section></div>
        {pendingCount > 0 && <button className="pending-banner" onClick={() => { setPage('transactions'); setFilter('pending'); }}><span className="pending-icon"><CircleHelp size={20} /></span><span><strong>{pendingCount} catatan bisa dirapikan nanti</strong><span>Semua mata uang dan semua periode. Saldo sudah tercatat; rapikan saat sempat.</span></span><span className="pending-cta">Cek catatan <ArrowRight size={16} /></span></button>}
        <section className="panel transactions-panel"><div className="panel-header"><div><h2>Transaksi terbaru</h2><p>Langkah kecil yang sudah kamu catat.</p></div><button className="text-link" onClick={() => navigate('transactions')}>Semua transaksi <ArrowRight size={15} /></button></div><TransactionTable entries={allTransactions.slice(0, 5)} state={state} onEdit={editEntry} onDelete={deleteEntry} /></section>
      </>}
      {page === 'wallets' && <><div className="section-heading"><div><h2 className="section-title">Dompet {currencyLabel(currency)}</h2><p className="section-description">{currencyWallets.length} dompet · total {formatMoney(summary.balance, currency)}</p></div><span className="badge neutral">{currency === 'TRY' ? 'TL / TRY' : currency}</span></div><div className="wallet-grid">{currencyWallets.map(w => <section key={w.id} className="wallet-card"><div className="wallet-card-top"><WalletSymbol wallet={w} /><span className="wallet-info"><strong>{w.name}</strong><span>{kindLabel(w.kind)}</span></span><button className="icon-button" aria-label={`Atur dompet ${w.name}`} onClick={() => setWalletModal(w)}><MoreHorizontal size={20} /></button></div><span className="wallet-card-label">Saldo saat ini</span><strong className="wallet-card-balance">{formatMoney(walletBalance(state, w.id), w.currency)}</strong><div className="wallet-card-footer"><span className="badge neutral">{w.currency}</span><div className="wallet-card-actions"><button className="text-link" onClick={() => openTx('expense', w.id)}><Plus size={14} /> Catat</button><button className="text-link" onClick={() => openTx('adjustment', w.id)}>Cek saldo <ArrowRight size={14} /></button></div></div></section>)}<button className="wallet-card add-wallet-card" onClick={() => setWalletModal('new')}><span className="add-wallet-icon"><Plus size={24} /></span><strong>Tambah dompet</strong><span>Tempat uangmu yang lain.</span></button></div><div className="notice"><CircleHelp size={18} /><span>Satu dompet untuk satu mata uang. Punya TL dan USD di bank yang sama? Buat dua dompet terpisah.</span></div></>}
      {page === 'transactions' && <section className="panel transactions-panel">{isReviewQueue && <div className="review-scope"><CircleHelp size={19} /><div><strong>Perlu dirapikan · {pendingCount} catatan</strong><p>Semua mata uang dan semua periode. Saldo mutasi sudah tercatat; cek jenis atau kategori yang belum jelas.</p></div></div>}<div className="filter-bar"><label className="search-input"><Search size={18} /><input placeholder="Cari keterangan atau dompet…" aria-label="Cari transaksi" value={query} onChange={e => setQuery(e.target.value)} /></label><select aria-label="Filter jenis transaksi" className="select-input" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Semua jenis</option><option value="expense">Pengeluaran</option><option value="income">Pemasukan</option><option value="transfer">Transfer</option><option value="pending">Perlu dirapikan</option><option value="adjustment">Penyesuaian</option></select><span className="transaction-count">{allTransactions.length} transaksi</span>{!isReviewQueue && pendingCount > 0 && <button className="button secondary small" onClick={() => setFilter('pending')}>Rapikan {pendingCount} catatan</button>}</div><TransactionTable entries={allTransactions} state={state} onEdit={editEntry} onDelete={deleteEntry} /></section>}
      {page === 'import' && <ImportView key={data.demo ? 'demo' : 'own'} state={state} demo={data.demo} onStart={startOwn} onImport={importEntries} notify={notify} />}
      <footer className="bottom-note"><span><Leaf size={14} /> Nggak harus rapi sekaligus. Yang penting mulai.</span><span>Data tersimpan di browser ini · cadangkan secara berkala</span><div className="mobile-backup"><button className="text-link" onClick={() => downloadText(JSON.stringify(data, null, 2), `uangku-cadangan-${today()}.json`)}><Download size={14} /> Cadangkan</button><button className="text-link" onClick={() => restoreRef.current?.click()}><History size={14} /> Pulihkan</button></div></footer>
      </div>
    </main>
    <nav className="mobile-nav" aria-label="Navigasi seluler">{navigation.map(({ page: p, label, icon: Icon }) => <button key={p} className={page === p ? 'active' : ''} aria-current={page === p ? 'page' : undefined} onClick={() => navigate(p)}><Icon size={20} /><span>{label}</span></button>)}</nav>
    <input ref={restoreRef} type="file" accept=".json,application/json" aria-label="File cadangan Uangku" hidden onChange={e => void restore(e.target.files?.[0])} />
    {walletModal && <WalletModal existing={walletModal === 'new' ? undefined : walletModal} defaultCurrency={currency} onSave={saveWallet} onClose={() => setWalletModal(null)} />}
    {txModal && <TransactionModal state={state} initialMode={txModal.type} initialWallet={txModal.walletId} existing={txModal.existing} onSave={saveEntry} onClose={() => setTxModal(null)} onDelete={txModal.existing ? () => { const entry = txModal.existing!; setTxModal(null); deleteEntry(entry); } : undefined} />}
    {confirm && <Modal title={confirm.title} onClose={() => setConfirm(null)}><div className="modal-body"><p className="confirm-copy">{confirm.text}</p></div><div className="modal-footer"><button className="button secondary" onClick={() => setConfirm(null)}>Batal</button><button className={`button ${confirm.label.startsWith('Hapus') ? 'danger' : 'primary'}`} onClick={() => { confirm.action(); setConfirm(null); }}>{confirm.label}</button></div></Modal>}
    {toast && <div className="toast" role="status"><CheckCircle2 size={19} /><span>{toast}</span><button aria-label="Tutup pemberitahuan" onClick={() => setToast('')}><X size={15} /></button></div>}
  </div>;
}
