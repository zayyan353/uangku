import { isCurrencyCode } from './currencyCatalog';
import type { Currency } from './finance';
import { UNCATEGORIZED } from './categorySettings';

/**
 * Monthly spending limits per currency and category, in each currency's
 * minor units. Kept under its own key, outside the ledger format.
 * Example: { IDR: { 'Makan & minum': 150000000 } } = Rp1.500.000 per month.
 */
export type BudgetMap = Partial<Record<Currency, Record<string, number>>>;

export const BUDGETS_KEY = 'uangku:budgets:v1';
export const BUDGETS_LIMIT = 16 * 1024;
const MAX_CATEGORIES_PER_CURRENCY = 100;

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error(`${label}: format anggaran tidak valid.`);
  }
  const record = value as Record<string, unknown>;
  if (Object.getOwnPropertySymbols(record).length) throw new Error(`${label}: field symbol tidak didukung.`);
  for (const key of Object.getOwnPropertyNames(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key)!;
    if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new Error(`${label}: anggaran harus berisi nilai JSON.`);
  }
  return record;
}

function categoryName(value: string): string {
  const name = value.trim().normalize('NFC');
  if (name.length < 1 || name.length > 80 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('Nama kategori anggaran: gunakan 1–80 karakter tanpa karakter kontrol.');
  }
  if (name === UNCATEGORIZED) throw new Error('Anggaran tidak dapat dipasang untuk Belum dikategorikan.');
  return name;
}

/**
 * Validates and normalises a budget map. Currency keys must be supported
 * codes; limits are positive safe integers in minor units. Empty currency
 * sections are dropped and currencies are sorted, so equal maps serialise
 * identically. Throws on anything else rather than silently dropping data.
 */
export function validateBudgets(value: unknown): BudgetMap {
  const source = plainRecord(value, 'Anggaran');
  const result: BudgetMap = {};
  for (const code of Object.keys(source).sort()) {
    if (!isCurrencyCode(code)) throw new Error(`Anggaran: mata uang ${code} belum didukung.`);
    const section = plainRecord(source[code], `Anggaran ${code}`);
    const names = Object.keys(section);
    if (names.length > MAX_CATEGORIES_PER_CURRENCY) throw new Error(`Anggaran ${code}: maksimal ${MAX_CATEGORIES_PER_CURRENCY} kategori.`);
    const limits: Record<string, number> = {};
    const seen = new Set<string>();
    for (const raw of names) {
      const name = categoryName(raw);
      const folded = name.toLocaleLowerCase('id-ID');
      if (seen.has(folded)) throw new Error(`Anggaran ${code}: kategori ${name} tercatat lebih dari sekali.`);
      seen.add(folded);
      const limit = section[raw];
      if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit <= 0) {
        throw new Error(`Anggaran ${code} · ${name}: batas harus bilangan bulat positif dalam satuan terkecil.`);
      }
      limits[name] = limit;
    }
    if (names.length) result[code] = limits;
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > BUDGETS_LIMIT) {
    throw new Error('Anggaran melewati batas 16 KiB.');
  }
  return result;
}

export function isEmptyBudgets(budgets: BudgetMap): boolean {
  return Object.keys(budgets).length === 0;
}

/** Canonical JSON for storage and backups. */
export function serializeBudgets(budgets: BudgetMap): string {
  return JSON.stringify(validateBudgets(budgets));
}

/**
 * Reads the stored value. A missing key is an empty map; a corrupt or
 * oversized value throws so callers never back up or overwrite it unseen.
 */
export function parseStoredBudgets(raw: string | null): BudgetMap {
  if (raw === null) return {};
  if (raw.length > BUDGETS_LIMIT) throw new Error('Anggaran tersimpan melewati batas 16 KiB.');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Anggaran tersimpan tidak dapat dibaca.'); }
  return validateBudgets(value);
}
