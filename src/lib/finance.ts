/** Money is always an integer in the currency's minor unit (1 unit = 100). */
export type Currency = 'IDR' | 'TRY' | 'USD';
export type WalletKind = 'bank' | 'cash' | 'ewallet';
export type EntryType = 'expense' | 'income' | 'transfer' | 'adjustment' | 'unreviewed';

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
  /** Positive for ordinary entries; signed for balance adjustments and unreviewed bank flows. */
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
 * Accept common Indonesian, Turkish and English monetary input.
 * 1.234,56 and 1,234.56 both mean 1234.56. A lone separator followed by
 * three digits is a thousands separator: 1.000 means 1000, not 1.
 * Returns null for ambiguous malformed groupings, more than two decimal
 * digits, non-money text, or values outside exact integer representation.
 */
export function parseMoney(input: string): number | null {
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

function validGroupedInteger(text: string, separator: string): boolean {
  const parts = text.split(separator);
  return parts.length > 1
    && /^\d{1,3}$/.test(parts[0])
    && parts.slice(1).every((part) => /^\d{3}$/.test(part));
}

export function formatMoney(minor: number, currency: Currency): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency, currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
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

function checkedSum(...values: number[]): number {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError('Jumlah uang melebihi batas angka yang dapat disimpan dengan tepat.');
  }
  return Number(total);
}

export function validateWallet(wallet: Wallet): string | null {
  if (!wallet.id?.trim()) return 'ID dompet belum tersedia.';
  if (!wallet.name?.trim()) return 'Isi nama dompet terlebih dahulu.';
  if (wallet.name.trim().length > 60) return 'Nama dompet maksimal 60 karakter.';
  if (!CURRENCIES.some((currency) => currency.code === wallet.currency)) return 'Pilih mata uang yang tersedia.';
  if (!['bank', 'cash', 'ewallet'].includes(wallet.kind)) return 'Pilih jenis dompet yang tersedia.';
  if (!Number.isSafeInteger(wallet.openingBalance)) return 'Saldo awal harus berupa nominal yang valid.';
  return null;
}

export function validateEntry(state: State, entry: Entry): string | null {
  if (!entry.id?.trim()) return 'ID transaksi belum tersedia.';
  if (state.entries.some((existing) => existing.id === entry.id)) return 'Transaksi dengan ID ini sudah tersimpan.';
  if (!isValidDate(entry.date)) return 'Isi tanggal transaksi yang valid.';
  if (!['expense', 'income', 'transfer', 'adjustment', 'unreviewed'].includes(entry.type)) return 'Jenis transaksi tidak dikenal.';
  const source = state.wallets.find((wallet) => wallet.id === entry.walletId);
  if (!source) return 'Pilih dompet asal yang tersedia.';
  if (!Number.isSafeInteger(entry.amount)) return 'Nominal harus berupa angka yang valid dengan maksimal dua desimal.';
  if (entry.type === 'adjustment' || entry.type === 'unreviewed') {
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
    const expected = Math.round(entry.amount * entry.rate);
    if (!Number.isSafeInteger(expected) || Math.abs(expected - entry.toAmount!) > 1) {
      return 'Nominal diterima belum cocok dengan kurs. Periksa kembali nominal atau kursnya.';
    }
  }
  return null;
}

export function walletBalance(state: State, walletId: string): number {
  const wallet = state.wallets.find((item) => item.id === walletId);
  if (!wallet) return 0;
  const amounts = [wallet.openingBalance];
  for (const entry of state.entries) {
    if (entry.walletId === walletId) {
      if (entry.type === 'income' || entry.type === 'adjustment' || entry.type === 'unreviewed') amounts.push(entry.amount);
      else amounts.push(-entry.amount, -(entry.fee ?? 0));
    }
    if (entry.type === 'transfer' && entry.toWalletId === walletId) amounts.push(entry.toAmount ?? 0);
  }
  return checkedSum(...amounts);
}

export function summaryForCurrency(state: State, currency: Currency, month: string): {
  balance: number; income: number; expense: number; uncategorized: number;
} {
  const ids = new Set(state.wallets.filter((wallet) => wallet.currency === currency).map((wallet) => wallet.id));
  const balances = state.wallets.filter((wallet) => ids.has(wallet.id)).map((wallet) => walletBalance(state, wallet.id));
  const income: number[] = [];
  const expenses: number[] = [];
  let uncategorized = 0;
  for (const entry of state.entries) {
    if (!ids.has(entry.walletId) || entry.date.slice(0, 7) !== month) continue;
    if (entry.type === 'income') income.push(entry.amount);
    if (entry.type === 'expense') expenses.push(entry.amount);
    if (entry.type === 'transfer' && entry.fee) expenses.push(entry.fee);
    if (entry.type === 'unreviewed' || ((entry.type === 'expense' || entry.type === 'income')
      && (!entry.category?.trim() || entry.category === 'Belum dikategorikan'))) uncategorized += 1;
  }
  return { balance: checkedSum(...balances), income: checkedSum(...income), expense: checkedSum(...expenses), uncategorized };
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
    { id: 'demo-cash-idr', name: 'Cash Rupiah', currency: 'IDR', kind: 'cash', openingBalance: 15_000_000 },
    { id: 'demo-ziraat', name: 'Ziraat', currency: 'TRY', kind: 'bank', openingBalance: 1_100_000 },
    { id: 'demo-papara', name: 'Papara', currency: 'TRY', kind: 'ewallet', openingBalance: 45_000 },
    { id: 'demo-cash-try', name: 'Cash Lira', currency: 'TRY', kind: 'cash', openingBalance: 30_000 },
    { id: 'demo-usd', name: 'Tabungan USD', currency: 'USD', kind: 'bank', openingBalance: 25_000 },
  ];
  const entries: Entry[] = [
    { id: 'demo-entry-1', date: dateOn(1), type: 'income', walletId: 'demo-bca', amount: 800_000_000, category: 'Pemasukan', note: 'Pemasukan bulanan · contoh' },
    { id: 'demo-entry-2', date: dateOn(3), type: 'expense', walletId: 'demo-bca', amount: 29_500_000, category: 'Belanja', note: 'Belanja kebutuhan rumah' },
    { id: 'demo-entry-3', date: dateOn(5), type: 'transfer', walletId: 'demo-bca', amount: 100_000_000, toWalletId: 'demo-jago', toAmount: 100_000_000, fee: 250_000, category: '', note: 'Pisahkan uang bulanan' },
    { id: 'demo-entry-4', date: dateOn(7), type: 'expense', walletId: 'demo-cash-idr', amount: 2_800_000, category: 'Makan & minum', note: 'Kopi sore' },
    { id: 'demo-entry-5', date: dateOn(9), type: 'income', walletId: 'demo-ziraat', amount: 1_000_000, category: 'Pemasukan', note: 'Pemasukan contoh' },
    { id: 'demo-entry-6', date: dateOn(11), type: 'expense', walletId: 'demo-jago', amount: 15_000_000, category: 'Tagihan', note: 'Internet bulanan' },
    { id: 'demo-entry-7', date: dateOn(13), type: 'transfer', walletId: 'demo-ziraat', amount: 150_000, toWalletId: 'demo-cash-try', toAmount: 150_000, category: '', note: 'Tarik tunai untuk seminggu' },
    { id: 'demo-entry-8', date: dateOn(15), type: 'expense', walletId: 'demo-ziraat', amount: 28_500, category: 'Makan & minum', note: 'Makan siang' },
    { id: 'demo-entry-9', date: dateOn(17), type: 'expense', walletId: 'demo-papara', amount: 9_000, category: 'Transportasi', note: 'Perjalanan dalam kota' },
    { id: 'demo-entry-10', date: dateOn(19), type: 'transfer', walletId: 'demo-usd', amount: 5_000, toWalletId: 'demo-ziraat', toAmount: 220_000, rate: 44, fee: 175, category: '', note: 'Contoh penukaran dengan kurs pilihan' },
    { id: 'demo-entry-11', date: dateOn(21), type: 'expense', walletId: 'demo-cash-try', amount: 18_500, category: 'Belum dikategorikan', note: 'Belanja kecil, rapikan nanti' },
    { id: 'demo-entry-12', date: dateOn(23), type: 'expense', walletId: 'demo-bca', amount: 3_500_000, category: 'Transportasi', note: 'Ongkos perjalanan' },
  ];
  return { version: 1, wallets, entries };
}
