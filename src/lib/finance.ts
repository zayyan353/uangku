import { actualBalanceProblem, ActualBalanceUnavailableError, createPostingDateIndex, entryPostings, type PostingContext } from './transferPostings';
export * from './transferPostings';
import { formatMinorMoney } from './moneyFormatting';
import { currencyDigits, currencyScale, isCurrencyCode, isCurrencyConversionConsistent, type Currency } from './currencyCatalog';
export { CURRENCY_CATALOG, LEGACY_CURRENCY_CODES, currencyInfo, currencyDigits, currencyScale, isCurrencyCode, convertMinorCurrency, deriveCurrencyRate, isCurrencyConversionConsistent } from './currencyCatalog';
export type { Currency } from './currencyCatalog';

/** Money is an integer in the currency's catalog-defined smallest unit. */
export type WalletKind = 'bank' | 'cash' | 'ewallet';
export type EntryType = 'expense' | 'income' | 'transfer' | 'adjustment' | 'unreviewed' | 'movement';

export interface Wallet {
  id: string;
  name: string;
  currency: Currency;
  kind: WalletKind;
  openingBalance: number;
}

export interface Entry {
  id: string;
  date: string;
  type: EntryType;
  walletId: string;
  /** Positive for income/expense/transfer; signed for adjustments, movements and unreviewed flows. */
  amount: number;
  category: string;
  note: string;
  toWalletId?: string;
  toAmount?: number;
  /** Destination major units per one source major unit, fixed at transaction time. */
  rate?: number;
  /** Source-currency minor units charged in addition to the transferred amount. */
  fee?: number;
  sourceKey?: string;
  toSourceKey?: string;
  importBatch?: string;
}

export interface State {
  version: 1;
  wallets: Wallet[];
  entries: Entry[];
}

export type AppState = State;
export type FinanceState = State;

export const CURRENCIES: ReadonlyArray<{ code: Currency; label: string; symbol: string }> = [
  { code: 'IDR', label: 'Rupiah', symbol: 'Rp' },
  { code: 'TRY', label: 'Lira Turki', symbol: '₺' },
  { code: 'USD', label: 'Dolar AS', symbol: '$' },
];

export const CATEGORY_NAMES = [
  'Belum dikategorikan',
  'Makan & minum',
  'Belanja',
  'Transportasi',
  'Tagihan',
  'Kesehatan',
  'Hiburan',
  'Pendidikan',
  'Pemasukan',
  'Lainnya',
];

export function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Two-decimal currencies retain the original Indonesian/Turkish/English input
 * grammar, including 1.234,56 and 1,234.56. For currencies with other precision,
 * the explicit Indonesian decimal-comma grammar below refuses ambiguous input.
 * Every branch returns exact minor units or null; no float scaling is used.
 */
export function parseMoney(input: string, currency: Currency = 'IDR'): number | null {
  const digits = currencyDigits(currency);
  if (digits !== 2) return parseScaledMoney(input, currency);
  let text = input.trim().replace(/[\s\u00a0\u202f]/g, '');
  if (!text || !/^-?[\d.,]+$/.test(text)) return null;
  const negative = text.startsWith('-');
  if (negative) text = text.slice(1);
  if (!text || !/\d/.test(text)) return null;

  let whole = text;
  let fraction = '';
  const commas = (text.match(/,/g) ?? []).length;
  const dots = (text.match(/\./g) ?? []).length;
  if (commas && dots) {
    const decimal = text.lastIndexOf(',') > text.lastIndexOf('.') ? ',' : '.';
    const grouping = decimal === ',' ? '.' : ',';
    const parts = text.split(decimal);
    if (parts.length !== 2 || !/^\d{1,2}$/.test(parts[1])) return null;
    if (!validGroupedInteger(parts[0], grouping)) return null;
    whole = parts[0].split(grouping).join('');
    fraction = parts[1];
  } else if (commas || dots) {
    const separator = commas ? ',' : '.';
    const parts = text.split(separator);
    if (parts.length === 2 && /^\d{1,2}$/.test(parts[1])) {
      if (parts[0] && !/^\d+$/.test(parts[0])) return null;
      whole = parts[0] || '0';
      fraction = parts[1];
    } else {
      if (!validGroupedInteger(text, separator)) return null;
      whole = parts.join('');
    }
  }
  if (!/^\d+$/.test(whole)) return null;
  // BigInt prevents a rounded floating-point number passing the safe-integer check.
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const result = Number(minor) * (negative ? -1 : 1);
  return result === 0 ? 0 : result;
}

/** New non-two-decimal currencies use explicit Indonesian decimal commas.
 * A single dotted three-digit suffix is ambiguous for 3/4-digit money and is
 * refused rather than silently changing a decimal into a thousand separator.
 */
function parseScaledMoney(input: string, currency: Currency): number | null {
  const digits = currencyDigits(currency);
  let text = input.trim().replace(/[\s\u00a0\u202f]/g, '');
  if (!text || !/^-?[\d.,]+$/.test(text)) return null;
  const negative = text.startsWith('-');
  if (negative) text = text.slice(1);
  if (!text || !/\d/.test(text)) return null;
  let whole = text, fraction = '';
  if (digits === 0) {
    if (text.includes('.') && text.includes(',')) return null;
    if (text.includes('.') || text.includes(',')) {
      const separator = text.includes('.') ? '.' : ',';
      if (!validGroupedInteger(text, separator)) return null;
      whole = text.split(separator).join('');
    }
  } else if (text.includes(',')) {
    const parts = text.split(',');
    if (parts.length !== 2 || !new RegExp(`^\\d{1,${digits}}$`).test(parts[1])) return null;
    whole = parts[0] || '0'; fraction = parts[1];
    if (whole.includes('.')) {
      if (!validGroupedInteger(whole, '.')) return null;
      whole = whole.split('.').join('');
    }
  } else if (text.includes('.')) {
    if (text.split('.').length < 3 || !validGroupedInteger(text, '.')) return null;
    whole = text.split('.').join('');
  }
  if (!/^\d+$/.test(whole)) return null;
  const minor = BigInt(whole) * BigInt(currencyScale(currency)) + BigInt(fraction.padEnd(digits, '0') || '0');
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const value = Number(minor) * (negative ? -1 : 1);
  return value === 0 ? 0 : value;
}

function validGroupedInteger(text: string, separator: string): boolean {
  const parts = text.split(separator);
  return parts.length > 1
    && /^\d{1,3}$/.test(parts[0])
    && parts.slice(1).every((part) => /^\d{3}$/.test(part));
}

export function formatMoney(minor: number, currency: Currency): string {
  return formatMinorMoney(minor, currency);
}

export function formatDate(date: string): string {
  if (!isValidDate(date)) return date;
  // Explicit UTC keeps date-only values stable across the browser's time zone.
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00Z`));
}

function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function checkedSum(values: Iterable<number>): number {
  // Sum exactly before checking the final result: intermediate positive and
  // negative amounts may cancel. An iterable also avoids engine argument limits.
  let total = 0n;
  for (const value of values) total += BigInt(value);
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError('Jumlah uang melebihi batas angka yang dapat disimpan dengan tepat.');
  }
  return Number(total);
}

export function validateWallet(wallet: Wallet): string | null {
  if (!wallet.id?.trim()) return 'ID dompet belum tersedia.';
  if (!wallet.name?.trim()) return 'Isi nama dompet terlebih dahulu.';
  if (wallet.name.trim().length > 60) return 'Nama dompet maksimal 60 karakter.';
  if (!isCurrencyCode(wallet.currency)) return 'Pilih mata uang yang tersedia.';
  if (!['bank', 'cash', 'ewallet'].includes(wallet.kind)) return 'Pilih jenis dompet yang tersedia.';
  if (!Number.isSafeInteger(wallet.openingBalance)) return 'Saldo awal harus berupa nominal yang valid.';
  return null;
}

export function validateEntry(state: State, entry: Entry): string | null {
  if (!entry.id?.trim()) return 'ID transaksi belum tersedia.';
  if (state.entries.some((existing) => existing.id === entry.id)) return 'Transaksi dengan ID ini sudah tersimpan.';
  if (!isValidDate(entry.date)) return 'Isi tanggal transaksi yang valid.';
  if (!['expense', 'income', 'transfer', 'adjustment', 'unreviewed', 'movement'].includes(entry.type)) return 'Jenis transaksi tidak dikenal.';
  const source = state.wallets.find((wallet) => wallet.id === entry.walletId);
  if (!source) return 'Pilih dompet asal yang tersedia.';
  if (!Number.isSafeInteger(entry.amount)) return `Nominal harus berupa integer satuan terkecil yang valid (${currencyDigits(source.currency)} desimal untuk ${source.currency}).`;
  if (entry.type === 'movement') {
    if (source.kind === 'cash') return 'Perpindahan tercatat hanya tersedia untuk rekening bank atau e-wallet.';
    if (['toWalletId','toAmount','rate','fee'].some(key => Object.hasOwn(entry,key))) return 'Perpindahan tercatat hanya memiliki satu rekening tanpa nominal pasangan, kurs, atau biaya.';
  }
  if (entry.type === 'adjustment' || entry.type === 'unreviewed' || entry.type === 'movement') {
    if (entry.amount === 0) return entry.type === 'adjustment'
      ? 'Saldo sudah cocok; tidak perlu penyesuaian.'
      : 'Transaksi tanpa perubahan nominal tidak perlu disimpan.';
  } else if (entry.amount <= 0) return 'Nominal harus lebih besar dari nol.';
  if (entry.fee !== undefined && (!Number.isSafeInteger(entry.fee) || entry.fee < 0)) {
    return 'Biaya harus berupa nominal nol atau lebih.';
  }
  if (entry.type !== 'transfer') {
    if (entry.fee) return 'Catat biaya sebagai pengeluaran terpisah.';
    return null;
  }

  const destination = state.wallets.find((wallet) => wallet.id === entry.toWalletId);
  if (!destination) return 'Pilih dompet tujuan yang tersedia.';
  if (source.id === destination.id) return 'Dompet asal dan tujuan harus berbeda.';
  if (!Number.isSafeInteger(entry.toAmount) || entry.toAmount! <= 0) return 'Isi nominal yang diterima dompet tujuan.';
  if (!Number.isSafeInteger(entry.amount + (entry.fee ?? 0))) return 'Nominal dan biaya terlalu besar.';
  if (source.currency === destination.currency) {
    if (entry.toAmount !== entry.amount) return 'Transfer satu mata uang harus memiliki nominal keluar dan masuk yang sama.';
    if (entry.rate !== undefined && entry.rate !== 1) return 'Kurs transfer satu mata uang harus 1.';
  } else {
    if (entry.rate === undefined || !Number.isFinite(entry.rate) || entry.rate <= 0) {
      return 'Isi atau konfirmasi kurs untuk transfer beda mata uang.';
    }
    if (!isCurrencyConversionConsistent(entry.amount, source.currency, destination.currency, entry.rate, entry.toAmount!)) {
      return 'Nominal diterima belum cocok dengan kurs. Periksa kembali nominal atau kursnya.';
    }
  }
  return null;
}

/** Signed change to the entry's own wallet; never invent a counterpart wallet. */
export function entrySignedAmount(entry: Entry): number {
  return entry.type === 'expense' || entry.type === 'transfer' ? -entry.amount - (entry.fee ?? 0) : entry.amount;
}

export function walletBalance(state: State, walletId: string, context?: PostingContext): number {
  return walletBalanceThrough(state, walletId, undefined, context);
}

/** Unknown transfer dates do not enter cutoff balances; approved baseline bounds remain explicit. */
export function walletBalanceAt(state: State, walletId: string, cutoffISO: string, context?: PostingContext): number {
  if (!isValidDate(cutoffISO)) throw new RangeError('Batas tanggal saldo belum valid.');
  const problem = actualBalanceProblem(context, walletId, cutoffISO);
  if (problem) {
    const boundary = createPostingDateIndex(context).approvedBaselineDatesByWallet!.get(walletId)!;
    throw new ActualBalanceUnavailableError(walletId,cutoffISO,boundary);
  }
  return walletBalanceThrough(state, walletId, cutoffISO, context);
}
export const actualWalletBalance = walletBalanceAt;

function walletBalanceThrough(state: State, walletId: string, cutoffISO?: string, context?: PostingContext): number {
  const wallet = state.wallets.find(item => item.id === walletId);
  if (!wallet) return 0;
  const index = createPostingDateIndex(context);
  function* amounts(): Generator<number> {
    yield wallet!.openingBalance;
    for (const entry of state.entries) for (const posting of entryPostings(entry,index)) {
      if (posting.walletId === walletId && (cutoffISO === undefined || posting.date !== null && posting.date <= cutoffISO)) yield posting.signedAmount;
    }
  }
  return checkedSum(amounts());
}

export function summaryForCurrency(state: State, currency: Currency, month: string, cutoffISO?: string, context?: PostingContext): {
  balance: number; income: number; expense: number; uncategorized: number;
} {
  if (cutoffISO !== undefined && !isValidDate(cutoffISO)) throw new RangeError('Batas tanggal ringkasan belum valid.');
  const ids = new Set(state.wallets.filter(wallet => wallet.currency === currency).map(wallet => wallet.id));
  const index = createPostingDateIndex(context);
  const balances = [...ids].map(id => cutoffISO === undefined ? walletBalance(state,id,index) : walletBalanceAt(state,id,cutoffISO,index));
  const income: number[] = [], expenses: number[] = [];
  let uncategorized = 0;
  for (const entry of state.entries) {
    let countedUncategorized = false;
    for (const posting of entryPostings(entry,index)) {
      if (!ids.has(posting.walletId) || posting.date === null || posting.date.slice(0,7) !== month || cutoffISO !== undefined && posting.date > cutoffISO) continue;
      if (entry.type === 'income' && posting.role === 'ordinary') income.push(posting.signedAmount);
      if (entry.type === 'expense' || posting.role === 'fee') expenses.push(-posting.signedAmount);
      if (!countedUncategorized && posting.role === 'ordinary' && (entry.type === 'unreviewed' || (entry.type === 'expense' || entry.type === 'income') && (!entry.category?.trim() || entry.category === 'Belum dikategorikan'))) { uncategorized++; countedUncategorized = true; }
    }
  }
  return {balance:checkedSum(balances),income:checkedSum(income),expense:checkedSum(expenses),uncategorized};
}

/** Final effective posting-month totals, using exact BigInt aggregation. */
export function assertPostingMonthTotals(state: State, context?: PostingContext): void {
  const currencyByWallet = new Map(state.wallets.map(wallet => [wallet.id,wallet.currency]));
  const totals = new Map<string,bigint>();
  const index = createPostingDateIndex(context);
  for (const entry of state.entries) for (const posting of entryPostings(entry,index)) {
    if (posting.date === null) continue;
    const kind = entry.type === 'income' && posting.role === 'ordinary' ? 'income' : entry.type === 'expense' || posting.role === 'fee' ? 'expense' : null;
    if (!kind) continue;
    const key = `${currencyByWallet.get(posting.walletId)}:${posting.date.slice(0,7)}:${kind}`;
    const amount = kind === 'expense' ? -posting.signedAmount : posting.signedAmount;
    totals.set(key,(totals.get(key) ?? 0n)+BigInt(amount));
  }
  for (const total of totals.values()) if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError('Total posting bulanan melebihi batas angka tepat.');
}

/** Deliberately fictional data. No uploaded statement or personal information. */
export function buildDemoState(today = new Date()): State {
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(today);
  const month = local.slice(0, 7);
  const currentDay = Number(local.slice(8, 10));
  const dateOn = (day: number) => `${month}-${String(Math.min(day, currentDay)).padStart(2, '0')}`;
  const wallets: Wallet[] = [
    { id: 'demo-bca', name: 'BCA', currency: 'IDR', kind: 'bank', openingBalance: 240_000_000 },
    { id: 'demo-jago', name: 'Bank Jago', currency: 'IDR', kind: 'bank', openingBalance: 120_000_000 },
    { id: 'demo-ziraat', name: 'Ziraat', currency: 'TRY', kind: 'bank', openingBalance: 1_100_000 },
    { id: 'demo-papara', name: 'Papara', currency: 'TRY', kind: 'ewallet', openingBalance: 45_000 },
    { id: 'demo-usd', name: 'Tabungan USD', currency: 'USD', kind: 'bank', openingBalance: 25_000 },
  ];
  const entries: Entry[] = [
    { id: 'demo-entry-1', date: dateOn(1), type: 'income', walletId: 'demo-bca', amount: 800_000_000, category: 'Pemasukan', note: 'Pemasukan bulanan · contoh' },
    { id: 'demo-entry-2', date: dateOn(3), type: 'expense', walletId: 'demo-bca', amount: 29_500_000, category: 'Belanja', note: 'Belanja kebutuhan rumah' },
    { id: 'demo-entry-3', date: dateOn(5), type: 'transfer', walletId: 'demo-bca', amount: 100_000_000, toWalletId: 'demo-jago', toAmount: 100_000_000, fee: 250_000, category: '', note: 'Pisahkan uang bulanan' },
    { id: 'demo-entry-4', date: dateOn(7), type: 'expense', walletId: 'demo-bca', amount: 2_800_000, category: 'Makan & minum', note: 'Kopi sore' },
    { id: 'demo-entry-5', date: dateOn(9), type: 'income', walletId: 'demo-ziraat', amount: 1_000_000, category: 'Pemasukan', note: 'Pemasukan contoh' },
    { id: 'demo-entry-6', date: dateOn(11), type: 'expense', walletId: 'demo-jago', amount: 15_000_000, category: 'Tagihan', note: 'Internet bulanan' },
    { id: 'demo-entry-7', date: dateOn(13), type: 'expense', walletId: 'demo-ziraat', amount: 150_000, category: 'Tarik tunai', note: 'Tarik tunai ATM · contoh' },
    { id: 'demo-entry-8', date: dateOn(15), type: 'expense', walletId: 'demo-ziraat', amount: 28_500, category: 'Makan & minum', note: 'Makan siang' },
    { id: 'demo-entry-9', date: dateOn(17), type: 'expense', walletId: 'demo-papara', amount: 9_000, category: 'Transportasi', note: 'Perjalanan dalam kota' },
    { id: 'demo-entry-10', date: dateOn(19), type: 'transfer', walletId: 'demo-usd', amount: 5_000, toWalletId: 'demo-ziraat', toAmount: 220_000, rate: 44, fee: 175, category: '', note: 'Contoh penukaran dengan kurs pilihan' },
    { id: 'demo-entry-11', date: dateOn(21), type: 'expense', walletId: 'demo-ziraat', amount: 18_500, category: 'Belum dikategorikan', note: 'Belanja kecil, rapikan nanti' },
    { id: 'demo-entry-12', date: dateOn(23), type: 'expense', walletId: 'demo-bca', amount: 3_500_000, category: 'Transportasi', note: 'Ongkos perjalanan' },
  ];
  return { version: 1, wallets, entries };
}
