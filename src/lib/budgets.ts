import { isCurrencyCode } from './currencyCatalog';
import { parseMoney, type Currency } from './finance';
import { formatMoneyInput } from './moneyFormatting';
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

/**
 * Editable text per category for one currency. An empty string means the
 * category has no limit. Used by the category manager form.
 */
export function budgetInputs(budgets: BudgetMap, currency: Currency, names: readonly string[]): Record<string, string> {
  const section = budgets[currency] ?? {};
  const inputs: Record<string, string> = {};
  for (const name of names) {
    if (name === UNCATEGORIZED) continue;
    inputs[name] = Object.hasOwn(section, name) ? formatMoneyInput(section[name], currency) : '';
  }
  return inputs;
}

/**
 * Applies form text for one currency to a budget map. Blank removes that
 * category's limit; any other text must be a positive amount for the
 * currency. Categories not in inputs keep their stored limits, so limits for
 * hidden or removed categories are never dropped silently.
 */
export function applyBudgetInputs(budgets: BudgetMap, currency: Currency, inputs: Readonly<Record<string, string>>): BudgetMap {
  const section: Record<string, number> = { ...(budgets[currency] ?? {}) };
  for (const [name, text] of Object.entries(inputs)) {
    if (!text.trim()) { delete section[name]; continue; }
    const minor = parseMoney(text, currency);
    if (minor === null || minor <= 0 || !Number.isSafeInteger(minor)) {
      throw new Error(`Anggaran ${name} (${currency}): isi nominal positif, misalnya 1.500.000, atau kosongkan untuk tanpa batas.`);
    }
    section[name] = minor;
  }
  const next: BudgetMap = { ...budgets };
  if (Object.keys(section).length) next[currency] = section;
  else delete next[currency];
  return validateBudgets(next);
}

export interface CategoryBudgetRow {
  name: string;
  /** Confirmed spending in minor units for the shown month. */
  spent: number;
  /** Monthly limit in minor units; absent when the category has no budget. */
  limit?: number;
  /** limit - spent; negative when the budget is exceeded. */
  remaining?: number;
  over: boolean;
}

/**
 * Rows for the confirmed-category summary. Every budgeted category is shown,
 * including ones with no spending yet; other categories fill up to
 * `unbudgetedSlots` by spending. `hidden` counts the categories left out.
 */
export function categoryBudgetRows(totals: ReadonlyArray<readonly [string, number]>, limits: Readonly<Record<string, number>> | undefined,
  unbudgetedSlots = 4): { rows: CategoryBudgetRow[]; hidden: number } {
  const section = limits ?? {};
  const rows: CategoryBudgetRow[] = [];
  let plain = 0, hidden = 0;
  for (const [name, spent] of totals) {
    if (Object.hasOwn(section, name)) {
      const limit = section[name];
      rows.push({ name, spent, limit, remaining: limit - spent, over: spent > limit });
    } else if (plain < unbudgetedSlots) {
      plain += 1;
      rows.push({ name, spent, over: false });
    } else hidden += 1;
  }
  const listed = new Set(totals.map(([name]) => name));
  for (const name of Object.keys(section).sort((a, b) => a.localeCompare(b, 'id-ID'))) {
    if (!listed.has(name)) rows.push({ name, spent: 0, limit: section[name], remaining: section[name], over: false });
  }
  return { rows, hidden };
}
