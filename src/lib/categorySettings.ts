import { CATEGORY_NAMES } from './finance';
import { DEFAULT_CATEGORY_RULES, type CategoryRule } from './categorization';
import { mergeCategoryKeywordPack } from './categoryKeywordPack';
import { mergeConfirmedCategoryMappings } from './categoryConfirmedMappings';
import { CONFIRMED_CATEGORY_NAMES } from './categoryKeywordDefinitions';
import { BANK_CATEGORY_NAMES, mergeBankCategoryMappings } from './categoryBankMappings';
import { mergeAutomaticBankMappings, mergeReviewCompletionMappings } from './bankAutoMappings';

export const CATEGORY_SETTINGS_KEY = 'uangku:categories:v1';
export const UNCATEGORIZED = 'Belum dikategorikan';
export const CATEGORY_SETTINGS_LIMIT = 128 * 1024;
export interface CategorySettings { version: 1; names: string[]; rules: CategoryRule[]; keywordPackVersion?: 1 | 2 | 3 | 4 | 5 }
export const DEFAULT_CATEGORY_NAMES = [...CATEGORY_NAMES, 'Bahan makanan', 'Rumah & sewa',
  'Internet & pulsa', 'Langganan', 'Biaya bank', 'Perawatan diri', 'Perjalanan',
  'Hadiah & donasi', 'Kebutuhan rumah', 'Pakaian', 'Gaji', 'Beasiswa', 'Pengembalian dana', ...CONFIRMED_CATEGORY_NAMES, ...BANK_CATEGORY_NAMES];
export function defaultCategorySettings(): CategorySettings {
  const base: CategorySettings = { version: 1, names: [...DEFAULT_CATEGORY_NAMES], rules: DEFAULT_CATEGORY_RULES.map(rule => ({ ...rule })) };
  const expanded = mergeCategoryKeywordPack(base).settings;
  const confirmed = mergeConfirmedCategoryMappings(expanded).settings;
  const bank = mergeBankCategoryMappings(confirmed).settings;
  return { ...mergeReviewCompletionMappings(mergeAutomaticBankMappings(bank).settings).settings, keywordPackVersion: 5 };
}
function object(value: unknown, fields: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('Format pengaturan kategori tidak valid.');
  const record = value as Record<string, unknown>;
  if (fields.some(key => !Object.hasOwn(record, key)) || Reflect.ownKeys(record).some(key => typeof key !== 'string' || ![...fields, ...optional].includes(key))) throw Error('Field pengaturan kategori tidak didukung.');
  for (const key of Object.getOwnPropertyNames(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key)!;
    if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw Error('Pengaturan kategori harus berisi nilai JSON.');
  }
  return record;
}
function text(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) throw Error(`${label}: gunakan ${min}–${max} karakter tanpa karakter kontrol.`);
  return value.trim().normalize('NFC');
}
export function validateCategorySettings(value: unknown): CategorySettings {
  const source = object(value, ['version', 'names', 'rules'], ['keywordPackVersion']);
  if (Object.hasOwn(source, 'keywordPackVersion') && source.keywordPackVersion !== 1 && source.keywordPackVersion !== 2 && source.keywordPackVersion !== 3 && source.keywordPackVersion !== 4 && source.keywordPackVersion !== 5) throw Error('Versi paket kata kunci belum didukung.');
  if (source.version !== 1 || !Array.isArray(source.names) || source.names.length < 1 || source.names.length > 100 || !Array.isArray(source.rules) || source.rules.length > 200) throw Error('Pengaturan maksimal 100 kategori dan 200 aturan, versi 1.');
  const names = source.names.map(name => text(name, 'Nama kategori', 1, 80));
  if (!names.includes(UNCATEGORIZED) || new Set(names.map(name => name.toLocaleLowerCase('id-ID'))).size !== names.length) throw Error('Kategori harus unik dan tetap menyertakan Belum dikategorikan.');
  const rules = source.rules.map(value => {
    const row = object(value, ['id', 'keyword', 'category', 'mode']);
    if (row.mode !== 'auto' && row.mode !== 'suggest') throw Error('Mode aturan kategori tidak valid.');
    return { id: text(row.id, 'ID aturan', 1, 120), keyword: text(row.keyword, 'Kata/frasa aturan', 3, 100),
      category: text(row.category, 'Kategori aturan', 1, 80), mode: row.mode } as CategoryRule;
  });
  if (new Set(rules.map(rule => rule.id)).size !== rules.length || rules.some(rule => rule.category === UNCATEGORIZED)) throw Error('ID aturan harus unik dan tujuannya harus kategori tertentu.');
  const result: CategorySettings = { version: 1, names, rules, ...((source.keywordPackVersion === 1 || source.keywordPackVersion === 2 || source.keywordPackVersion === 3 || source.keywordPackVersion === 4 || source.keywordPackVersion === 5) ? { keywordPackVersion: source.keywordPackVersion } : {}) };
  if (new TextEncoder().encode(JSON.stringify({ app: 'uangku-category-settings', version: 1, settings: result })).length > CATEGORY_SETTINGS_LIMIT) throw Error('Pengaturan kategori melewati batas 128 KiB.');
  return result;
}
export function categoryChoices(settings: CategorySettings, current = ''): string[] {
  return current && !settings.names.includes(current) ? [...settings.names, current] : settings.names;
}
export function isUncategorized(category: string): boolean { return !category.trim() || category.trim() === UNCATEGORIZED; }
export function categorySettingsExport(settings: CategorySettings): string {
  return JSON.stringify({ app: 'uangku-category-settings', version: 1, settings: validateCategorySettings(settings) });
}
export function parseCategorySettingsExport(raw: string): CategorySettings {
  if (new TextEncoder().encode(raw).length > CATEGORY_SETTINGS_LIMIT) throw Error('File pengaturan kategori maksimal 128 KiB.');
  const wrapper = object(JSON.parse(raw), ['app', 'version', 'settings']);
  if (wrapper.app !== 'uangku-category-settings' || wrapper.version !== 1) throw Error('File ini bukan pengaturan kategori Uangku.');
  return validateCategorySettings(wrapper.settings);
}
