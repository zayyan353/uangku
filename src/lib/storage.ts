import {
  buildDemoState, validateEntry, validateWallet, walletBalance,
  type Currency, type Entry, type EntryType, type State, type Wallet, type WalletKind,
} from './finance';

export const STORAGE_KEY = 'uangku:v1';
const MAX_BACKUP_BYTES = 8 * 1024 * 1024;
const MAX_WALLETS = 100;
const MAX_ENTRIES = 100_000;

export interface StoredData {
  app: 'uangku';
  version: 1;
  demo: boolean;
  state: State;
}

export interface StoredRead {
  data: StoredData;
  error: string | null;
  /** A blocked read must never trigger an automatic persistence write. */
  blocked: boolean;
}

export function createEmptyState(): State {
  const wallet = (id: string, name: string, currency: Currency, kind: WalletKind): Wallet => ({
    id, name, currency, kind, openingBalance: 0,
  });
  return {
    version: 1,
    wallets: [
      wallet('bca-idr', 'BCA', 'IDR', 'bank'),
      wallet('bca-digital-idr', 'BCA Digital', 'IDR', 'bank'),
      wallet('bri-idr', 'BRI', 'IDR', 'bank'),
      wallet('gopay-idr', 'GoPay', 'IDR', 'ewallet'),
      wallet('dana-idr', 'DANA', 'IDR', 'ewallet'),
      wallet('jago-idr', 'Bank Jago', 'IDR', 'bank'),
      wallet('seabank-idr', 'SeaBank', 'IDR', 'bank'),
      wallet('shopeepay-idr', 'ShopeePay', 'IDR', 'ewallet'),
      wallet('cash-idr', 'Cash Rupiah', 'IDR', 'cash'),
      wallet('ziraat-try', 'Ziraat', 'TRY', 'bank'),
      wallet('papara-try', 'Papara', 'TRY', 'ewallet'),
      wallet('cash-try', 'Cash Lira', 'TRY', 'cash'),
      wallet('cash-usd', 'Cash Dolar', 'USD', 'cash'),
    ],
    entries: [],
  };
}

export function makeDemoData(): StoredData {
  return { app: 'uangku', version: 1, demo: true, state: buildDemoState() };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} harus berupa objek yang valid.`);
  }
  return value as Record<string, unknown>;
}

function stringField(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim())) {
    throw new Error(`${label} harus berupa teks ${allowEmpty ? '' : 'yang tidak kosong '}dengan maksimal ${maximum} karakter.`);
  }
  return value;
}

function moneyField(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`${label} harus berupa nominal bulat dalam satuan terkecil yang valid.`);
  }
  return value;
}

function optionalString(source: Record<string, unknown>, key: string, label: string, maximum: number): string | undefined {
  return source[key] === undefined ? undefined : stringField(source[key], label, maximum);
}

function readWallet(value: unknown, index: number): Wallet {
  const source = record(value, `Dompet ke-${index + 1}`);
  const result: Wallet = {
    id: stringField(source.id, 'ID dompet', 120),
    name: stringField(source.name, 'Nama dompet', 60),
    currency: stringField(source.currency, 'Mata uang dompet', 3) as Currency,
    kind: stringField(source.kind, 'Jenis dompet', 16) as WalletKind,
    openingBalance: moneyField(source.openingBalance, 'Saldo awal dompet'),
  };
  const error = validateWallet(result);
  if (error) throw new Error(`Dompet ke-${index + 1}: ${error}`);
  return result;
}

function readEntry(value: unknown, index: number): Entry {
  const source = record(value, `Transaksi ke-${index + 1}`);
  const result: Entry = {
    id: stringField(source.id, 'ID transaksi', 120),
    date: stringField(source.date, 'Tanggal transaksi', 10),
    type: stringField(source.type, 'Jenis transaksi', 16) as EntryType,
    walletId: stringField(source.walletId, 'ID dompet asal', 120),
    amount: moneyField(source.amount, 'Nominal transaksi'),
    category: stringField(source.category, 'Kategori transaksi', 80, true),
    note: stringField(source.note, 'Keterangan transaksi', 4_000, true),
  };
  const toWalletId = optionalString(source, 'toWalletId', 'ID dompet tujuan', 120);
  const sourceKey = optionalString(source, 'sourceKey', 'Referensi impor asal', 200);
  const toSourceKey = optionalString(source, 'toSourceKey', 'Referensi impor tujuan', 200);
  const importBatch = optionalString(source, 'importBatch', 'ID kelompok impor', 200);
  if (toWalletId !== undefined) result.toWalletId = toWalletId;
  if (sourceKey !== undefined) result.sourceKey = sourceKey;
  if (toSourceKey !== undefined) result.toSourceKey = toSourceKey;
  if (importBatch !== undefined) result.importBatch = importBatch;
  if (source.toAmount !== undefined) {
    result.toAmount = moneyField(source.toAmount, 'Nominal yang diterima');
    if (result.toAmount <= 0) throw new Error('Nominal yang diterima harus lebih besar dari nol.');
  }
  if (source.fee !== undefined) {
    result.fee = moneyField(source.fee, 'Biaya transfer');
    if (result.fee < 0) throw new Error('Biaya transfer tidak boleh negatif.');
  }
  if (source.rate !== undefined) {
    if (typeof source.rate !== 'number' || !Number.isFinite(source.rate) || source.rate <= 0) {
      throw new Error('Kurs harus berupa angka yang lebih besar dari nol.');
    }
    result.rate = source.rate;
  }
  return result;
}

function assertSafeTotal(total: bigint): void {
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error('Total saldo atau transaksi terlalu besar untuk disimpan dengan tepat.');
  }
}

/** Validate a backup and copy only documented fields; unknown properties never enter state. */
export function validateBackup(value: unknown): StoredData {
  const source = record(value, 'Cadangan');
  if (source.app !== 'uangku' || source.version !== 1) {
    throw new Error('File ini bukan cadangan Uangku versi 1.');
  }
  if (typeof source.demo !== 'boolean') throw new Error('Penanda data contoh dalam cadangan tidak valid.');
  const stateSource = record(source.state, 'Isi cadangan');
  if (stateSource.version !== 1) throw new Error('Versi data dalam cadangan belum didukung.');
  if (!Array.isArray(stateSource.wallets) || stateSource.wallets.length > MAX_WALLETS) {
    throw new Error(`Daftar dompet harus berupa daftar dengan maksimal ${MAX_WALLETS} dompet.`);
  }
  if (!Array.isArray(stateSource.entries) || stateSource.entries.length > MAX_ENTRIES) {
    throw new Error(`Daftar transaksi harus berupa daftar dengan maksimal ${MAX_ENTRIES.toLocaleString('id-ID')} transaksi.`);
  }
  const wallets = stateSource.wallets.map(readWallet);
  const walletIds = new Set(wallets.map((wallet) => wallet.id));
  if (walletIds.size !== wallets.length) throw new Error('Ada ID dompet yang berulang dalam cadangan.');
  const entries = stateSource.entries.map(readEntry);
  const entryIds = new Set<string>();
  const validationState: State = { version: 1, wallets, entries: [] };
  for (const [index, entry] of entries.entries()) {
    if (entryIds.has(entry.id)) throw new Error('Ada ID transaksi yang berulang dalam cadangan.');
    entryIds.add(entry.id);
    if (entry.toWalletId !== undefined && !walletIds.has(entry.toWalletId)) {
      throw new Error(`Transaksi ke-${index + 1}: dompet tujuan tidak ditemukan.`);
    }
    const error = validateEntry(validationState, entry);
    if (error) throw new Error(`Transaksi ke-${index + 1}: ${error}`);
  }
  const state: State = { version: 1, wallets, entries };
  const currencyBalances = new Map<Currency, bigint>();
  try {
    for (const wallet of wallets) {
      const total = (currencyBalances.get(wallet.currency) ?? 0n) + BigInt(walletBalance(state, wallet.id));
      currencyBalances.set(wallet.currency, total);
    }
  } catch {
    throw new Error('Total saldo dompet terlalu besar untuk disimpan dengan tepat.');
  }
  for (const total of currencyBalances.values()) assertSafeTotal(total);

  // Monthly totals can overflow even when opposing flows leave a valid balance.
  const currencyByWallet = new Map(wallets.map((wallet) => [wallet.id, wallet.currency]));
  const monthly = new Map<string, bigint>();
  for (const entry of entries) {
    const currency = currencyByWallet.get(entry.walletId)!;
    const month = entry.date.slice(0, 7);
    const kind = entry.type === 'income' ? 'income' : 'expense';
    const value = entry.type === 'income' || entry.type === 'expense'
      ? entry.amount : entry.type === 'transfer' ? (entry.fee ?? 0) : 0;
    if (value === 0) continue;
    const key = `${currency}:${month}:${kind}`;
    const total = (monthly.get(key) ?? 0n) + BigInt(value);
    assertSafeTotal(total);
    monthly.set(key, total);
  }
  const result: StoredData = { app: 'uangku', version: 1, demo: source.demo, state };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_BACKUP_BYTES) {
    throw new Error('Ukuran cadangan maksimal 8 MB.');
  }
  return result;
}

/** Reads only. Corrupt or inaccessible storage is never silently overwritten. */
export function readStored(): StoredRead {
  let text: string | null;
  try {
    const storage = globalThis.localStorage;
    if (!storage || typeof storage.getItem !== 'function') throw new Error('Storage unavailable');
    text = storage.getItem(STORAGE_KEY);
  } catch {
    return {
      data: makeDemoData(), blocked: true,
      error: 'Penyimpanan browser tidak tersedia. Perubahan belum bisa disimpan di perangkat ini.',
    };
  }
  if (text === null) return { data: makeDemoData(), error: null, blocked: false };
  try {
    if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('Ukuran data tersimpan melebihi 8 MB.');
    return { data: validateBackup(JSON.parse(text)), error: null, blocked: false };
  } catch (error) {
    const detail = error instanceof SyntaxError ? 'Format data tersimpan tidak terbaca.'
      : error instanceof Error ? error.message : 'Data tersimpan tidak valid.';
    return {
      data: makeDemoData(), blocked: true,
      error: `${detail} Data lama belum diubah. Pulihkan cadangan atau mulai ulang secara manual.`,
    };
  }
}
