import { currencyDigits } from './currencyCatalog';
import type { Currency } from './finance';

/** One history row, already resolved to display text by the caller. */
export interface HistoryCsvRow {
  date: string;
  wallet: string;
  type: string;
  category: string;
  /** Signed amount in minor units: negative leaves the wallet, positive enters it. */
  amountMinor: number;
  currency: Currency;
  note: string;
}

export const HISTORY_CSV_HEADER = ['Tanggal', 'Dompet', 'Jenis', 'Kategori', 'Nominal', 'Mata uang', 'Keterangan'];

/**
 * Plain decimal with the currency's own fraction digits and a dot separator,
 * e.g. -12500.50 (IDR has 2, JPY 0, KWD 3). Integer math: no float rounding.
 */
export function formatMinorPlain(minor: number, currency: Currency): string {
  if (!Number.isSafeInteger(minor)) throw new Error('Nominal harus bilangan bulat dalam satuan terkecil.');
  const digits = currencyDigits(currency);
  const sign = minor < 0 ? '-' : '';
  const text = Math.abs(minor).toString().padStart(digits + 1, '0');
  if (digits === 0) return `${sign}${text}`;
  return `${sign}${text.slice(0, -digits)}.${text.slice(-digits)}`;
}

/**
 * RFC 4180 quoting for commas, quotes and line breaks. Text that a spreadsheet
 * would read as a formula (=, +, -, @, tab, CR at the start) gets a leading
 * apostrophe so a bank memo can never run as a formula.
 */
export function escapeCsvText(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV text (CRLF line ends, header row first). The caller adds a BOM if wanted. */
export function historyCsv(rows: readonly HistoryCsvRow[]): string {
  const lines = [HISTORY_CSV_HEADER.map(escapeCsvText).join(',')];
  for (const row of rows) {
    lines.push([
      escapeCsvText(row.date),
      escapeCsvText(row.wallet),
      escapeCsvText(row.type),
      escapeCsvText(row.category),
      formatMinorPlain(row.amountMinor, row.currency),
      escapeCsvText(row.currency),
      escapeCsvText(row.note),
    ].join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
