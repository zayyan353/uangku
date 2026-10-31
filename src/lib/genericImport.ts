import { readStatementWorkbook, type ImportPreview, type ImportRow } from './importer';
import { confirmedBankEntryType } from './bankDescription';
import { currencyDigits, isCurrencyCode } from './currencyCatalog';
import type { Currency, Entry, Wallet } from './finance';

export interface GenericTable {
  id: string; name: string; values: unknown[][]; formulas: ReadonlySet<number>;
  numericCells?: ReadonlySet<string>; date1904?: boolean;
}
export interface GenericMapping {
  /** Zero-based row and column positions, selected by the user. */
  headerRow: number; dateColumn: number; descriptionColumn: number; balanceColumn: number;
  amountMode: 'signed' | 'debit-credit'; amountColumn?: number; debitColumn?: number; creditColumn?: number;
  referenceColumn?: number; currencyColumn?: number;
  dateFormat: 'iso' | 'dmy' | 'mdy' | 'excel';
  decimalSeparator: '.' | ','; order: 'oldest' | 'newest';
  confirmedCurrency: Currency;
}
const MAX_FILE = 8 * 1024 * 1024, MAX_ROWS = 50_000, MAX_COLUMNS = 512;
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const fail = (text: string): never => { throw new Error(text); };
const safe = (value: bigint): number => value > MAX || value < -MAX ? fail('Nominal melewati batas angka tepat.') : Number(value);

/** RFC-style quoted fields; never evaluates formulas or converts identifiers. */
export function parseStatementCsv(text: string, separator: ',' | ';' | '\t'): string[][] {
  if (![',', ';', '\t'].includes(separator)) fail('Pilih pemisah CSV yang didukung.');
  if (new TextEncoder().encode(text).length > MAX_FILE) fail('Ukuran file maksimal 8 MiB.');
  const input = text.replace(/^\uFEFF/, ''), rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, endedQuote = false;
  const field = () => { row.push(cell); cell = ''; endedQuote = false; if (row.length > MAX_COLUMNS) fail('CSV maksimal 512 kolom.'); };
  const line = () => { field(); rows.push(row); row = []; if (rows.length > MAX_ROWS + 101) fail('Terlalu banyak baris CSV. Maksimal 50.000 transaksi.'); };
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') { cell += '"'; index++; }
        else { quoted = false; endedQuote = true; }
      } else cell += char;
    } else if (char === separator) field();
    else if (char === '\r' || char === '\n') { if (char === '\r' && input[index + 1] === '\n') index++; line(); }
    else if (char === '"') { if (cell || endedQuote) fail('Tanda kutip CSV tidak valid.'); quoted = true; }
    else { if (endedQuote) fail('Ada karakter setelah penutup kutipan CSV.'); cell += char; }
    if (cell.length > 65_536) fail('Satu sel CSV terlalu panjang.');
  }
  if (quoted) fail('Kutipan CSV belum ditutup.');
  if (cell || row.length || endedQuote) line();
  return rows;
}

export function readGenericTables(bytes: ArrayBuffer, filename: string, separator: ',' | ';' | '\t' = ','): GenericTable[] {
  if (!bytes.byteLength || bytes.byteLength > MAX_FILE) fail('Pilih file CSV/XLSX berisi data, maksimal 8 MiB.');
  const extension = filename.split('.').at(-1)?.toLowerCase();
  if (extension === 'xlsx') {
    const workbook = readStatementWorkbook(bytes, true);
    return workbook.sheets.map((sheet, index) => ({ ...sheet, id: `sheet-${index}`, date1904: workbook.date1904 }));
  }
  if (extension !== 'csv' && extension !== 'tsv') fail('Impor umum mendukung .csv, .tsv, atau .xlsx.');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return fail('CSV harus memakai UTF-8. Ekspor ulang sebagai CSV UTF-8.'); }
  return [{ id: 'csv', name: filename, values: parseStatementCsv(text, extension === 'tsv' ? '\t' : separator), formulas: new Set() }];
}

/** Currency-aware exact conversion; decimal/grouping conventions are explicit. */
export function parseStatementMoney(value: unknown, currency: Currency, decimal: '.' | ','): number {
  if (!['.', ','].includes(decimal)) fail('Pilih pemisah desimal yang valid.');
  if (!isCurrencyCode(currency)) fail('Mata uang belum didukung.');
  let text = String(value ?? '').trim().replace(/\u2212/g, '-').replace(/[\u00a0\u202f]/g, ' ');
  if (!text) fail('Nominal kosong.');
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1); }
  if (/^[+-]/.test(text)) { if (negative) fail('Tanda nominal ganda.'); negative = text[0] === '-'; text = text.slice(1); }
  const pieces = text.split(decimal);
  if (pieces.length > 2 || pieces.length === 2 && !/^\d+$/.test(pieces[1])) fail('Pemisah desimal atau nominal tidak valid.');
  const grouping = decimal === '.' ? ',' : '.';
  const whole = pieces[0];
  let digits: string;
  if (/^\d+$/.test(whole)) digits = whole;
  else {
    const groups = whole.includes(grouping) ? whole.split(grouping) : whole.split(' ');
    if (!/^\d{1,3}$/.test(groups[0]) || groups.length < 2 || groups.slice(1).some(group => !/^\d{3}$/.test(group))) fail('Pengelompokan ribuan tidak valid.');
    digits = groups.join('');
  }
  digits = digits.replace(/^0+(?=\d)/, '');
  if (digits.length > 16) fail('Nominal melewati batas angka tepat.');
  const precision = currencyDigits(currency), fraction = pieces[1] ?? '';
  if (fraction.length > precision && /[1-9]/.test(fraction.slice(precision))) fail(`Nominal ${currency} melebihi ${precision} digit desimal.`);
  const minor = BigInt(digits) * 10n ** BigInt(precision) + BigInt(fraction.slice(0, precision).padEnd(precision, '0') || '0');
  return safe(negative ? -minor : minor);
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function parseStatementDate(value: unknown, format: GenericMapping['dateFormat'], date1904 = false): string {
  const text = String(value ?? '').trim();
  if (format === 'excel') {
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) fail('Tanggal serial Excel harus berupa bilangan bulat.');
    const serial = Number(text);
    if (!date1904 && serial === 60) fail('Tanggal Excel 29 Februari 1900 tidak valid.');
    if (serial < (date1904 ? 0 : 1) || serial > 2_958_465) fail('Tanggal serial Excel di luar batas.');
    const base = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 31);
    const date = new Date(base + (serial - (!date1904 && serial > 60 ? 1 : 0)) * 86_400_000).toISOString().slice(0, 10);
    return validDate(date) ? date : fail('Tanggal serial Excel tidak valid.');
  }
  if (format === 'iso') return validDate(text) ? text : fail('Tanggal harus YYYY-MM-DD.');
  const parts = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(text);
  if (!parts) fail('Tanggal tidak sesuai format yang dipilih.');
  const first = Number(parts![1]), second = Number(parts![2]);
  const date = `${parts![3]}-${String(format === 'dmy' ? second : first).padStart(2, '0')}-${String(format === 'dmy' ? first : second).padStart(2, '0')}`;
  return validDate(date) ? date : fail('Tanggal kalender tidak valid.');
}
function expandNumeric(value: unknown): string {
  const text = String(value ?? '');
  if (!/[eE]/.test(text)) return text;
  const parts = /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d{1,2})$/.exec(text);
  if (!parts) fail('Angka ilmiah Excel tidak valid.');
  const raw = parts![2] + (parts![3] ?? ''), point = parts![2].length + Number(parts![4]);
  return parts![1] + (point <= 0 ? `0.${'0'.repeat(-point)}${raw}` : point >= raw.length ? raw + '0'.repeat(point - raw.length) : `${raw.slice(0, point)}.${raw.slice(point)}`);
}
/** Stable scheme-specific identity. The old Ziraat scheme is never rewritten. */
function fingerprint(input: string): string {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let index = 0; index < input.length; index++) { const code = input.charCodeAt(index); a = Math.imul(a ^ code, 0x01000193); b = Math.imul(b ^ code, 0x85ebca6b); }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}

export function parseGenericStatement(table: GenericTable, mapping: GenericMapping, wallet: Wallet, existing: readonly Entry[]): ImportPreview {
  if (wallet.kind === 'cash' || !isCurrencyCode(wallet.currency) || mapping.confirmedCurrency !== wallet.currency) fail('Mata uang file harus dikonfirmasi sama dengan dompet. Nominal tidak dikonversi.');
  if (!Number.isInteger(mapping.headerRow) || mapping.headerRow < 0 || mapping.headerRow > 100 || !table.values[mapping.headerRow]) fail('Pilih baris judul kolom yang valid (1–101).');
  if (!['signed', 'debit-credit'].includes(mapping.amountMode) || !['oldest', 'newest'].includes(mapping.order) || !['iso', 'dmy', 'mdy', 'excel'].includes(mapping.dateFormat) || !['.', ','].includes(mapping.decimalSeparator)) fail('Pengaturan format impor tidak valid.');
  const currencyHeaders = (table.values[mapping.headerRow] ?? []).flatMap((value, column) => ['currency', 'mata uang', 'doviz', 'para birimi', 'ccy'].includes(String(value ?? '').normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').trim()) ? [column] : []);
  if (currencyHeaders.length > 1) fail('Ada beberapa kolom mata uang. Gunakan ekspor satu rekening dengan satu kolom mata uang yang jelas.');
  if (currencyHeaders.length && mapping.currencyColumn !== currencyHeaders[0]) fail('Kolom mata uang ditemukan. Petakan kolom itu agar mata uang file ikut divalidasi.');
  const required = [mapping.dateColumn, mapping.descriptionColumn, mapping.balanceColumn, ...(mapping.amountMode === 'signed' ? [mapping.amountColumn] : [mapping.debitColumn, mapping.creditColumn])];
  const columns = [...required, mapping.referenceColumn, mapping.currencyColumn].filter((column): column is number => column !== undefined);
  if (required.some(column => !Number.isInteger(column) || column! < 0) || columns.some(column => !Number.isInteger(column) || column < 0 || column >= MAX_COLUMNS) || new Set(columns).size !== columns.length) fail('Setiap kolom harus dipetakan ke posisi berbeda; saldo berjalan wajib ada.');
  const known = new Set(existing.flatMap(entry => [entry.sourceKey, entry.toSourceKey]).filter(Boolean)), seen = new Set<string>();
  const rows: ImportRow[] = [];
  const money = (row: unknown[], index: number, column: number) => parseStatementMoney(table.numericCells?.has(`${index}:${column}`) ? expandNumeric(row[column]) : row[column], wallet.currency, table.numericCells?.has(`${index}:${column}`) ? '.' : mapping.decimalSeparator);
  for (let index = mapping.headerRow + 1; index < table.values.length; index++) {
    const values = table.values[index];
    if (!values?.some(value => String(value ?? '').trim())) continue;
    if (rows.length >= MAX_ROWS) fail('Maksimal 50.000 transaksi per file.');
    try {
      if (table.formulas.has(index)) fail('Baris mengandung rumus. Gunakan ekspor bank berisi nilai asli.');
      if (mapping.currencyColumn !== undefined) {
        const code = String(values[mapping.currencyColumn] ?? '').trim().toUpperCase();
        if (code !== wallet.currency && !(wallet.currency === 'TRY' && code === 'TL')) fail('Mata uang baris berbeda atau kosong. Gunakan satu mata uang per file.');
      }
      const date = parseStatementDate(table.numericCells?.has(`${index}:${mapping.dateColumn}`) ? expandNumeric(values[mapping.dateColumn]) : values[mapping.dateColumn], mapping.dateFormat, table.date1904);
      const originalDescription = String(values[mapping.descriptionColumn] ?? ''), originalReference = mapping.referenceColumn === undefined ? '' : String(values[mapping.referenceColumn] ?? '');
      if (!originalDescription.trim() || originalDescription.length > 4000 || originalReference.length > 4000) fail('Keterangan wajib diisi dan keterangan/referensi maksimal 4.000 karakter.');
      const balance = money(values, index, mapping.balanceColumn);
      let amount: number;
      if (mapping.amountMode === 'signed') amount = money(values, index, mapping.amountColumn!);
      else {
        const debit = String(values[mapping.debitColumn!] ?? '').trim() ? money(values, index, mapping.debitColumn!) : 0;
        const credit = String(values[mapping.creditColumn!] ?? '').trim() ? money(values, index, mapping.creditColumn!) : 0;
        if (debit < 0 || credit < 0 || debit > 0 && credit > 0) fail('Debit/kredit harus positif dan hanya salah satunya terisi.');
        amount = credit - debit;
      }
      if (!amount) fail('Nominal nol tidak dapat diimpor.');
      const sourceKey = `generic:${fingerprint(JSON.stringify([wallet.id, wallet.currency, date, amount, balance, originalDescription.normalize('NFC').trim(), originalReference.normalize('NFC').trim()]))}`;
      if (seen.has(sourceKey)) fail('Identitas dua baris sama. Sertakan kolom referensi unik dan periksa ekspor asli.');
      seen.add(sourceKey);
      const duplicate = known.has(sourceKey);
      rows.push({ id: `${sourceKey}:${index}`, date, amount, balance, description: originalDescription.trim(), originalDescription,
        reference: originalReference.trim(), originalReference, sourceKey, fingerprintVersion: 'generic-v1',
        classification: confirmedBankEntryType(originalDescription, amount) ?? 'unreviewed', category: 'Belum dikategorikan',
        selected: !duplicate, duplicate, warning: duplicate ? 'Sudah ada atau identik dengan baris lain. Tidak dipilih.' : undefined });
    } catch (error) { fail(`Baris ${index + 1}: ${error instanceof Error ? error.message : 'Data tidak valid.'}`); }
  }
  if (!rows.length) fail('Tidak ada transaksi setelah baris judul kolom.');
  const ordered = mapping.order === 'oldest' ? rows : [...rows].reverse();
  for (let index = 1; index < ordered.length; index++) if (ordered[index].date < ordered[index - 1].date || BigInt(ordered[index - 1].balance) + BigInt(ordered[index].amount) !== BigInt(ordered[index].balance)) fail('Urutan tanggal atau saldo antarbaris tidak cocok. Periksa arah urutan, pemetaan, serta baris yang hilang.');
  const first = ordered[0], last = ordered[ordered.length - 1];
  return { rows, sourceOrder: mapping.order, currency: wallet.currency, openingBalance: safe(BigInt(first.balance) - BigInt(first.amount)), closingBalance: last.balance,
    period: { start: first.date, end: last.date }, warnings: ['Impor umum memakai pemetaan dan mata uang yang dikonfirmasi pengguna. Nominal tidak dikonversi. Jenis yang belum terbukti tetap Perlu dicek; saldo tetap tercatat.'] };
}
