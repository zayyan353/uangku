import { isCurrencyCode, type Currency } from './currencyCatalog';

/**
 * A reusable starting point for a new expense or income entry. A template
 * never creates a transaction by itself; it only fills the form. Amounts are
 * minor units of `currency`, the wallet's currency when the template was saved.
 */
export interface TransactionTemplate {
  id: string;
  name: string;
  type: 'expense' | 'income';
  walletId: string;
  currency: Currency;
  category: string;
  /** Omitted when the amount varies each time. */
  amount?: number;
  note: string;
}

export const TEMPLATES_KEY = 'uangku:templates:v1';
export const TEMPLATES_LIMIT = 64 * 1024;
export const MAX_TEMPLATES = 50;
const FIELDS = ['id', 'name', 'type', 'walletId', 'currency', 'category', 'note'];
const OPTIONAL = ['amount'];

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error(`${label}: format template tidak valid.`);
  }
  const record = value as Record<string, unknown>;
  if (Object.getOwnPropertySymbols(record).length) throw new Error(`${label}: field symbol tidak didukung.`);
  for (const key of Object.getOwnPropertyNames(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key)!;
    if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new Error(`${label}: template harus berisi nilai JSON.`);
  }
  return record;
}

function text(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label}: gunakan teks tanpa karakter kontrol.`);
  const trimmed = value.trim().normalize('NFC');
  if (trimmed.length < min || trimmed.length > max) throw new Error(`${label}: gunakan ${min}–${max} karakter.`);
  return trimmed;
}

/** Validates one template; unknown fields and invalid values throw. */
export function validateTemplate(value: unknown, label = 'Template'): TransactionTemplate {
  const source = plainRecord(value, label);
  const keys = Object.keys(source);
  const unknown = keys.find(key => !FIELDS.includes(key) && !OPTIONAL.includes(key));
  if (unknown) throw new Error(`${label}: field ${unknown} tidak didukung.`);
  const missing = FIELDS.find(key => !Object.hasOwn(source, key));
  if (missing) throw new Error(`${label}: field ${missing} wajib ada.`);
  const name = text(source.name, `${label} · nama`, 1, 60);
  if (source.type !== 'expense' && source.type !== 'income') throw new Error(`${name}: jenis template harus pengeluaran atau pemasukan.`);
  if (!isCurrencyCode(source.currency)) throw new Error(`${name}: mata uang belum didukung.`);
  const template: TransactionTemplate = {
    id: text(source.id, `${name} · id`, 1, 64),
    name,
    type: source.type,
    walletId: text(source.walletId, `${name} · dompet`, 1, 200),
    currency: source.currency,
    category: text(source.category, `${name} · kategori`, 1, 80),
    note: text(source.note, `${name} · keterangan`, 0, 2000),
  };
  if (Object.hasOwn(source, 'amount')) {
    if (typeof source.amount !== 'number' || !Number.isSafeInteger(source.amount) || source.amount <= 0) {
      throw new Error(`${name}: nominal template harus bilangan bulat positif dalam satuan terkecil.`);
    }
    template.amount = source.amount;
  }
  return template;
}

/**
 * Validates a template list. Ids and names (case-insensitive) must be unique,
 * at most 50 templates and 64 KiB. Order is kept: it is the user's order.
 */
export function validateTemplates(value: unknown): TransactionTemplate[] {
  if (!Array.isArray(value)) throw new Error('Template transaksi: format daftar tidak valid.');
  if (value.length > MAX_TEMPLATES) throw new Error(`Template transaksi: maksimal ${MAX_TEMPLATES} template.`);
  const ids = new Set<string>(), names = new Set<string>();
  const result = value.map((item, index) => {
    const template = validateTemplate(item, `Template ${index + 1}`);
    if (ids.has(template.id)) throw new Error(`Template ${template.name}: id tercatat lebih dari sekali.`);
    const folded = template.name.toLocaleLowerCase('id-ID');
    if (names.has(folded)) throw new Error(`Nama template “${template.name}” sudah dipakai.`);
    ids.add(template.id); names.add(folded);
    return template;
  });
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > TEMPLATES_LIMIT) {
    throw new Error('Template transaksi melewati batas 64 KiB.');
  }
  return result;
}

export function serializeTemplates(templates: readonly TransactionTemplate[]): string {
  return JSON.stringify(validateTemplates(templates));
}

/**
 * Reads the stored value. A missing key is an empty list; a corrupt or
 * oversized value throws so callers never back up or overwrite it unseen.
 */
export function parseStoredTemplates(raw: string | null): TransactionTemplate[] {
  if (raw === null) return [];
  if (raw.length > TEMPLATES_LIMIT) throw new Error('Template tersimpan melewati batas 64 KiB.');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Template tersimpan tidak dapat dibaca.'); }
  return validateTemplates(value);
}

/**
 * Appends a template to the stored raw value. Refuses an unreadable store, a
 * duplicate name, and the count and size limits, leaving storage unchanged.
 */
export function appendTemplate(raw: string | null, template: TransactionTemplate): { raw: string; templates: TransactionTemplate[] } {
  const templates = validateTemplates([...parseStoredTemplates(raw), template]);
  return { raw: JSON.stringify(templates), templates };
}

/** Removes one template from the stored raw value. An unreadable store or an unknown id throws; storage stays as it was. */
export function removeTemplate(raw: string | null, id: string): { raw: string; templates: TransactionTemplate[] } {
  const current = parseStoredTemplates(raw);
  if (!current.some(template => template.id === id)) throw new Error('Template sudah tidak ada. Daftar terbaru dimuat.');
  const templates = current.filter(template => template.id !== id);
  return { raw: JSON.stringify(templates), templates };
}

/** Renames one template in place, keeping its position. A name another template uses is refused. */
export function renameTemplate(raw: string | null, id: string, name: string): { raw: string; templates: TransactionTemplate[] } {
  const current = parseStoredTemplates(raw);
  if (!current.some(template => template.id === id)) throw new Error('Template sudah tidak ada. Daftar terbaru dimuat.');
  const templates = validateTemplates(current.map(template => template.id === id ? { ...template, name } : template));
  return { raw: JSON.stringify(templates), templates };
}

export interface TemplateFill {
  type: TransactionTemplate['type'];
  /** '' when the template's wallet is no longer active; the form keeps its own choice. */
  walletId: string;
  /** Minor units, or null when the template has no amount or the currency no longer matches. */
  amount: number | null;
  category: string;
  note: string;
  date: string;
  warnings: string[];
}

/**
 * What a template puts into a new transaction form. The date is always the
 * given day. Nothing is guessed: an archived or missing wallet, a changed
 * currency or a removed category is left for the user and reported.
 */
export function templateFill(template: TransactionTemplate, wallets: ReadonlyArray<{ id: string; currency: Currency }>,
  categories: readonly string[], day: string, uncategorized = 'Belum dikategorikan'): TemplateFill {
  const warnings: string[] = [];
  const wallet = wallets.find(item => item.id === template.walletId);
  if (!wallet) warnings.push('Dompet template sudah tidak aktif. Pilih dompet sebelum menyimpan.');
  let amount = template.amount ?? null;
  if (amount !== null && wallet && wallet.currency !== template.currency) {
    amount = null;
    warnings.push(`Mata uang dompet berubah dari ${template.currency} ke ${wallet.currency}. Isi nominal lagi.`);
  }
  if (amount !== null && !wallet) amount = null;
  const category = categories.includes(template.category) ? template.category : uncategorized;
  if (category !== template.category) warnings.push(`Kategori “${template.category}” sudah tidak aktif, jadi kategori dikosongkan.`);
  return { type: template.type, walletId: wallet?.id ?? '', amount, category, note: template.note, date: day, warnings };
}
