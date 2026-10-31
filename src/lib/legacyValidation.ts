import { validateEntry, validateWallet, type Currency, type Entry, type EntryType, type State, type Wallet, type WalletKind } from './finance';
import { assertJsonBudget } from './jsonBudget';
import { LEGACY_CURRENCY_CODES } from './currencyCatalog';
export interface LegacyData { app: 'uangku'; version: 1; demo: boolean; state: State }
const MAX_BACKUP_BYTES=8*1024*1024;
const MAX_WALLETS=100;
const MAX_ENTRIES=100_000;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) {
    throw new Error(`${label} harus berupa objek yang valid.`);
  }
  return value as Record<string, unknown>;
}

const DOCUMENT_KEYS=new Set(['app','version','demo','state']);
const STATE_KEYS=new Set(['version','wallets','entries']);
const WALLET_KEYS=new Set(['id','name','currency','kind','openingBalance']);
const ENTRY_REQUIRED=['id','date','type','walletId','amount','category','note'] as const;
const ENTRY_KEYS=new Set([...ENTRY_REQUIRED,'toWalletId','toAmount','rate','fee','sourceKey','toSourceKey','importBatch']);
/** Closed financial schema replaces sorting/stringifying both whole documents. */
function keys(source:Record<string,unknown>,allowed:ReadonlySet<string>,required:readonly string[],label:string):void{
  const own=Object.keys(source);
  if(Object.getOwnPropertySymbols(source).length||Object.getOwnPropertyNames(source).length!==own.length)throw new Error(`${label}: field tersembunyi atau symbol tidak didukung.`);
  for(const key of own){
    if(!allowed.has(key))throw new Error(`${label}: field ${key} tidak didukung; data tidak boleh dibuang.`);
    const field=Object.getOwnPropertyDescriptor(source,key);
    if(!field||!Object.hasOwn(field,'value'))throw new Error(`${label}: accessor ${key} tidak didukung; field harus berupa nilai JSON tetap.`);
    if(field.value===undefined)throw new Error(`${label}: field ${key} bernilai undefined; nilai JSON tidak didukung.`);
  }
  for(const key of required)if(!Object.hasOwn(source,key))throw new Error(`${label}: field ${key==='note'?'Keterangan transaksi':key} tidak ada.`);
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
  keys(source,WALLET_KEYS,[...WALLET_KEYS],`Dompet ke-${index+1}`);
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
  keys(source,ENTRY_KEYS,ENTRY_REQUIRED,`Transaksi ke-${index+1}`);
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
export function validateLegacyBackup(value: unknown, options: { skipMonthlyTotals?: boolean; allowMovement?: boolean; allowExtendedCurrencies?: boolean } = {}): LegacyData {
  const source = record(value, 'Cadangan');
  keys(source,DOCUMENT_KEYS,[...DOCUMENT_KEYS],'Cadangan');
  if (source.app !== 'uangku' || source.version !== 1) {
    throw new Error('File ini bukan cadangan Uangku versi 1.');
  }
  if (typeof source.demo !== 'boolean') throw new Error('Penanda data contoh dalam cadangan tidak valid.');
  const stateSource = record(source.state, 'Isi cadangan');
  keys(stateSource,STATE_KEYS,[...STATE_KEYS],'Isi cadangan');
  if (stateSource.version !== 1) throw new Error('Versi data dalam cadangan belum didukung.');
  if (!Array.isArray(stateSource.wallets) || stateSource.wallets.length > MAX_WALLETS) {
    throw new Error(`Daftar dompet harus berupa daftar dengan maksimal ${MAX_WALLETS} dompet.`);
  }
  if (!Array.isArray(stateSource.entries) || stateSource.entries.length > MAX_ENTRIES) {
    throw new Error(`Daftar transaksi harus berupa daftar dengan maksimal ${MAX_ENTRIES.toLocaleString('id-ID')} transaksi.`);
  }
  // Exactly one bounded financial walk, before allocating a detached projection.
  // Strict field/type checks below guarantee no field or JSON value is dropped.
  assertJsonBudget(source,MAX_BACKUP_BYTES,'Proyeksi finansial v1 (maksimal 8 MB)');
  const wallets = stateSource.wallets.map(readWallet);
  if (!options.allowExtendedCurrencies && wallets.some(wallet => !(LEGACY_CURRENCY_CODES as readonly string[]).includes(wallet.currency))) throw new Error('Mata uang tambahan memerlukan format cadangan multi-mata-uang terbaru.');
  const walletIds = new Set(wallets.map((wallet) => wallet.id));
  if (walletIds.size !== wallets.length) throw new Error('Ada ID dompet yang berulang dalam cadangan.');
  const entries = stateSource.entries.map(readEntry);
  const entryIds = new Set<string>();
  const validationState: State = { version: 1, wallets, entries: [] };
  for (const [index, entry] of entries.entries()) {
    if (entry.type === 'movement' && !options.allowMovement) throw new Error('Perpindahan tercatat memerlukan format cadangan versi 3 atau codec sumber table-tuples-v4.');
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
  // Aggregate once, retaining exact cancellation and checking final wallet totals.
  const balances = new Map(wallets.map(wallet => [wallet.id, BigInt(wallet.openingBalance)]));
  for (const entry of entries) {
    const source = entry.type === 'income' || entry.type === 'adjustment' || entry.type === 'unreviewed' || entry.type === 'movement'
      ? BigInt(entry.amount) : -BigInt(entry.amount)-BigInt(entry.fee ?? 0);
    balances.set(entry.walletId,balances.get(entry.walletId)!+source);
    if(entry.type==='transfer')balances.set(entry.toWalletId!,balances.get(entry.toWalletId!)!+BigInt(entry.toAmount!));
  }
  for(const wallet of wallets){
    const value=balances.get(wallet.id)!;
    try{assertSafeTotal(value);}catch{throw new Error('Total saldo dompet terlalu besar untuk disimpan dengan tepat.');}
    currencyBalances.set(wallet.currency,(currencyBalances.get(wallet.currency)??0n)+value);
  }
  for (const total of currencyBalances.values()) assertSafeTotal(total);

  // Monthly totals can overflow even when opposing flows leave a valid balance.
  const currencyByWallet = new Map(wallets.map((wallet) => [wallet.id, wallet.currency]));
  const monthly = new Map<string, bigint>();
  for (const entry of options.skipMonthlyTotals ? [] : entries) {
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
  const result: LegacyData = { app: 'uangku', version: 1, demo: source.demo, state };
  return result;
}

