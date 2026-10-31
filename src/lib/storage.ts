import {
  buildDemoState,
  type Currency, type State, type Wallet, type WalletKind,
} from './finance';

export const STORAGE_KEY = 'uangku:v1';
export const MAX_BACKUP_BYTES = 8 * 1024 * 1024;
/** Raw legacy pretty JSON has a separate bounded parsing budget. */
export const MAX_RESTORE_BYTES = 32 * 1024 * 1024;

import { sourceDocumentUsesMovement, sourceDocumentUsesCurrencyFeatures, sourceKeys, validateSourceDocument, type SourceDocument } from './sourceModel';
import { decodeSourceWire, prepareSourceBackup } from './sourceCodec';
export type StoredData = SourceDocument;

export interface StoredRead {
  data: StoredData;
  error: string | null;
  /** Exact bytes read with data, used for compare-and-save under a writer lock. */
  token: string | null;
  persisted: boolean;
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
      wallet('ziraat-try', 'Ziraat', 'TRY', 'bank'),
      wallet('papara-try', 'Papara', 'TRY', 'ewallet'),
    ],
    entries: [],
  };
}

export function makeDemoData(): StoredData {
  return { app: 'uangku', version: 1, demo: true, state: buildDemoState() };
}

/** Validate and detach every financial/source field; unsupported data fails closed. */
export function prepareBackup(value: unknown): {data:StoredData;raw:string} {
  const version=value&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,'version')?.value:undefined;
  if(version===2)return prepareSourceBackup(decodeSourceWire(value));
  if(version===3)return prepareBackup(decodePlainMovement(value));
  if(value&&typeof value==='object'&&Object.hasOwn(value,'metadata'))return prepareSourceBackup(value);
  const data=validateSourceDocument(value);
  if (sourceDocumentUsesCurrencyFeatures(data)) return prepareSourceBackup({ ...data, metadata: { policy: 'unverified-unless-linked', facts: [], links: [], statements: [] } });
  return{data,raw:JSON.stringify(sourceDocumentUsesMovement(data)?{...data,version:3}:data)};
}
/** Version 3 is a plain ledger feature gate; semantic state remains version 1. */
function decodePlainMovement(value: unknown): StoredData {
  // Closed schema validation happens before projecting the internal version.
  const source = sourceKeys(value,['app','version','demo','state'],['app','version','demo','state'],'cadangan versi 3');
  if (source.version !== 3) throw new Error('Versi cadangan perpindahan belum didukung.');
  return validateSourceDocument({...source,version:1},{allowExtendedCurrencies:false,allowGenericFacts:false,allowCurrencyConfiguration:false});
}
/** Untrusted persisted/exported input: old formats never imply movement support. */
export function validateBackup(value: unknown): StoredData {
  const version=value&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,'version')?.value:undefined;
  if (version === 2) return decodeSourceWire(value);
  if (version === 3) return decodePlainMovement(value);
  const data = validateSourceDocument(value,{allowMovement:false,allowWalletArchives:false,allowExtendedCurrencies:false,allowGenericFacts:false,allowCurrencyConfiguration:false});
  if (data.metadata) return prepareSourceBackup(data).data;
  return data;
}
/** Persisted representation and export use exactly the same bounded format. */
export function serializeBackup(data: StoredData): string {
  return prepareBackup(data).raw;
}
export function parseBackupText(text: string): StoredData {
  if (new TextEncoder().encode(text).byteLength > MAX_RESTORE_BYTES) {
    throw new Error('Ukuran mentah file pemulihan maksimal 32 MiB; data logis tetap maksimal 8 MiB.');
  }
  return validateBackup(JSON.parse(text));
}
export function readStored(): StoredRead {
  let text: string | null = null;
  try {
    const storage = globalThis.localStorage;
    if (!storage || typeof storage.getItem !== 'function') throw new Error('Storage unavailable');
    text = storage.getItem(STORAGE_KEY);
  } catch {
    return {
      data: makeDemoData(), blocked: true, token: null, persisted: false,
      error: 'Penyimpanan browser tidak tersedia. Perubahan belum bisa disimpan di perangkat ini.',
    };
  }
  if (text === null) return { data: makeDemoData(), error: null, blocked: false, token: null, persisted: false };
  try {
    if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('Ukuran data tersimpan melebihi 8 MB.');
    return { data: validateBackup(JSON.parse(text)), error: null, blocked: false, token: text, persisted: true };
  } catch (error) {
    const detail = error instanceof SyntaxError ? 'Format data tersimpan tidak terbaca.'
      : error instanceof Error ? error.message : 'Data tersimpan tidak valid.';
    return {
      data: makeDemoData(), blocked: true, token: text, persisted: false,
      error: `${detail} Data lama belum diubah. Pulihkan cadangan atau mulai ulang secara manual.`,
    };
  }
}
