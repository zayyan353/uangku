import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { Currency, Entry, Wallet } from './finance';
import { confirmedBankEntryType, interpretBankDescription, normalizeBankDescription } from './bankDescription';

export interface ImportRow {
  id: string;
  date: string;
  description: string;
  /** Immutable text from the workbook, independent of preview annotations. */
  originalDescription?: string;
  /** Signed amount in minor units. */
  amount: number;
  balance: number;
  reference: string;
  originalReference?: string;
  sourceKey: string;
  fingerprintVersion?: 'ziraat-v1' | 'generic-v1';
  classification: 'expense' | 'income' | 'transfer' | 'unreviewed' | 'movement';
  category: string;
  selected: boolean;
  duplicate: boolean;
  warning?: string;
}

export interface ImportPreview {
  rows: ImportRow[];
  sourceOrder?: 'oldest' | 'newest';
  currency: Currency;
  openingBalance: number;
  closingBalance: number;
  warnings: string[];
  period: { start: string; end: string };
}

const HEADERS = ['TARIH', 'FIS NO', 'ACIKLAMA', 'ISLEM TUTARI', 'BAKIYE'];
const UNCATEGORIZED = 'Belum dikategorikan';
const MAX_XML_BYTES = 32 * 1024 * 1024;

type XmlNode = Record<string, unknown>;

function list<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return value.map(text).join('');
  const node = value as XmlNode;
  if ('#text' in node) return text(node['#text']);
  if ('t' in node) return text(node.t);
  if ('r' in node) return text(node.r);
  return '';
}

function xml(source: Uint8Array): XmlNode {
  const input = strFromU8(source);
  if (/<!DOCTYPE|<!ENTITY/i.test(input) || XMLValidator.validate(input) !== true) {
    return error('Struktur XML di dalam file tidak didukung atau rusak. Unduh ulang XLSX dari bank.');
  }
  return new XMLParser({ ignoreAttributes: false, removeNSPrefix: true,
    parseTagValue: false, parseAttributeValue: false, trimValues: false,
    // Custom entities/DOCTYPE are rejected above; decode standard XML escapes.
    processEntities: true, ignoreDeclaration: true }).parse(input) as XmlNode;
}

export interface StatementSheet { name: string; values: unknown[][]; formulas: Set<number>; numericCells: Set<string> }
export function readStatementWorkbook(data: ArrayBuffer, preserveNumericText = false): { sheets: StatementSheet[]; date1904: boolean } {
  let files: Record<string, Uint8Array>;
  let size = 0;
  let count = 0;
  try {
    files = unzipSync(new Uint8Array(data), {
      filter: file => {
        count += 1;
        if (count > 1000) throw new Error('Terlalu banyak bagian file.');
        const needed = /^xl\/(?:sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(file.name);
        if (!needed) return false;
        size += file.originalSize;
        if (size > MAX_XML_BYTES || file.originalSize < 0) throw new Error('Isi file terlalu besar.');
        return true;
      },
    });
  } catch {
    return error('File XLSX rusak atau terlalu besar setelah dibuka. Pilih mutasi dengan periode lebih singkat.');
  }
  if (Object.values(files).reduce((sum, bytes) => sum + bytes.length, 0) > MAX_XML_BYTES) {
    return error('Isi file terlalu besar. Pilih periode mutasi yang lebih singkat.');
  }
  const sharedRoot = files['xl/sharedStrings.xml'] ? xml(files['xl/sharedStrings.xml']).sst as XmlNode : undefined;
  const shared = list(sharedRoot?.si).map(text);
  const workbook = files['xl/workbook.xml'] ? xml(files['xl/workbook.xml']).workbook as XmlNode : undefined;
  const properties = workbook?.workbookPr as XmlNode | undefined;
  const date1904 = ['1', 'true'].includes(String(properties?.['@_date1904'] ?? ''));
  const worksheetFiles = Object.entries(files).filter(([name]) => /^xl\/worksheets\/[^/]+\.xml$/.test(name));
  const sheetNames = new Map<string, { name: string; ordinal: number }>();
  const relRoot = files['xl/_rels/workbook.xml.rels'] ? xml(files['xl/_rels/workbook.xml.rels']).Relationships as XmlNode : undefined;
  const relations = new Map(list(relRoot?.Relationship as XmlNode | XmlNode[] | undefined).filter(row => row['@_TargetMode'] !== 'External').map(row => [String(row['@_Id'] ?? ''), String(row['@_Target'] ?? '')]));
  const workbookSheets = (workbook?.sheets as XmlNode | undefined)?.sheet;
  for (const [ordinal, sheet] of list(workbookSheets as XmlNode | XmlNode[] | undefined).entries()) {
    const target = relations.get(String(sheet['@_id'] ?? ''));
    if (!target) continue;
    const parts: string[] = target.startsWith('/') ? [] : ['xl'];
    for (const piece of target.replace(/\\/g, '/').split('/')) {
      if (!piece || piece === '.') continue;
      if (piece === '..') { if (!parts.length) return error('Referensi worksheet tidak valid.'); parts.pop(); }
      else parts.push(piece);
    }
    const path = parts.join('/');
    if (!/^xl\/worksheets\/[^/]+\.xml$/.test(path) || !files[path]) return error('Referensi worksheet tidak ditemukan.');
    if (sheetNames.has(path)) return error('Referensi worksheet berulang.');
    sheetNames.set(path, { name: String(sheet['@_name'] ?? `Sheet ${ordinal + 1}`), ordinal });
  }
  worksheetFiles.sort(([a], [b]) => (sheetNames.get(a)?.ordinal ?? Number.MAX_SAFE_INTEGER) - (sheetNames.get(b)?.ordinal ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b));
  const sheets = worksheetFiles.map(([path, bytes], index) => {
    const worksheet = xml(bytes).worksheet as XmlNode | undefined;
    const sheetData = worksheet?.sheetData as XmlNode | undefined;
    const formulas = new Set<number>();
    const numericCells = new Set<string>();
    const values: unknown[][] = [];
    let previousRow = -1;
    for (const [logicalIndex, row] of list(sheetData?.row as XmlNode | XmlNode[] | undefined).entries()) {
      const rowAttribute = row['@_r'];
      const rowIndex = preserveNumericText ? rowAttribute === undefined ? previousRow + 1 : Number(rowAttribute) - 1 : logicalIndex;
      if (preserveNumericText && (rowAttribute !== undefined && !/^[1-9]\d*$/.test(String(rowAttribute)) || !Number.isSafeInteger(rowIndex) || rowIndex <= previousRow || rowIndex > 50_100)) return error('Koordinat baris XLSX berulang, tidak berurutan, atau di luar batas 50.101.');
      previousRow = rowIndex;
      while (values.length < rowIndex) values.push([]);
      const seenColumns = new Set<number>();
      const result: unknown[] = [];
      let nextColumn = 0;
      for (const value of list(row.c as unknown)) {
        // Empty <c/> is parsed as a primitive by fast-xml-parser. It still
        // occupies a column; never apply object operators to that primitive.
        if (value === '' || value === null || value === undefined) {
          if (nextColumn > (preserveNumericText ? 511 : 16383)) return error('Koordinat kolom XLSX tidak valid.');
          seenColumns.add(nextColumn); result[nextColumn++] = ''; continue;
        }
        if (typeof value !== 'object' || Array.isArray(value)) return error('Struktur sel XLSX tidak valid. Gunakan nilai sel asli dari ekspor bank.');
        const cell = value as XmlNode;
        const reference = String(cell['@_r'] ?? '');
        const coordinate = /^([A-Z]+)(\d+)$/i.exec(reference);
        if (preserveNumericText && reference && (!coordinate || Number(coordinate[2]) !== rowIndex + 1)) return error('Koordinat sel dan baris XLSX tidak cocok.');
        const letters = coordinate?.[1].toUpperCase();
        let column = nextColumn;
        if (letters) {
          column = 0;
          for (const char of letters) column = column * 26 + char.charCodeAt(0) - 64;
          column -= 1;
        }
        if (column > (preserveNumericText ? 511 : 16383) || preserveNumericText && seenColumns.has(column)) return error('Koordinat kolom XLSX tidak valid atau berulang. Impor umum maksimal 512 kolom.');
        seenColumns.add(column);
        nextColumn = column + 1;
        const type = cell['@_t'];
        if ('f' in cell) formulas.add(rowIndex);
        const raw = text(cell.v);
        if (type === 's') {
          if (!raw.trim()) { result[column] = ''; continue; }
          const index = Number(raw);
          if (!Number.isInteger(index) || index < 0 || index >= shared.length) return error('Teks XLSX tidak lengkap. Unduh ulang file.');
          result[column] = shared[index];
        } else if (type === 'inlineStr') {
          result[column] = text(cell.is);
        } else if ((type === 'n' || type === undefined) && raw.trim()) {
          if (preserveNumericText) numericCells.add(`${rowIndex}:${column}`);
          result[column] = preserveNumericText ? raw : Number(raw);
        } else {
          result[column] = raw;
        }
      }
      values[rowIndex] = result;
    }
    return { name: sheetNames.get(path)?.name ?? `Worksheet ${index + 1}`, values, formulas, numericCells };
  });
  return { sheets, date1904 };
}

function normalized(value: unknown): string {
  return String(value ?? '').trim().toLocaleUpperCase('tr-TR')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

/** Display-localized text is supported; XLSX numeric cells are already numbers. */
function minorUnits(value: unknown): number | null {
  let number: number;
  if (typeof value === 'number') {
    number = value;
  } else if (typeof value === 'string') {
    let text = value.trim().replace(/\s/g, '').replace(/\u2212/g, '-');
    if (!text) return null;
    if (text.includes(',')) {
      if (!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(text)) return null;
      text = text.replace(/\./g, '').replace(',', '.');
    } else if (/^[+-]?\d{1,3}(?:\.\d{3})+$/.test(text)) {
      // Turkish grouped integers such as 1.250 or 12.345.678.
      text = text.replace(/\./g, '');
    } else if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(text)) {
      return null;
    }
    number = Number(text);
  } else {
    return null;
  }
  if (!Number.isFinite(number)) return null;
  const scaled = number * 100;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 0.00001) return null;
  return rounded;
}

function isoDate(value: unknown, date1904: boolean): string | null {
  let day: number, month: number, year: number;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value > 110000 || (!date1904 && Math.floor(value) === 60)) return null;
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    const correction = !date1904 && value < 60 ? 1 : 0;
    const parsed = new Date(epoch + (Math.floor(value) + correction) * 86400000);
    day = parsed.getUTCDate(); month = parsed.getUTCMonth() + 1; year = parsed.getUTCFullYear();
  } else {
    const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(value ?? '').trim());
    if (!match) return null;
    [, day, month, year] = match.map(Number);
  }
  if (year < 1900 || year > 2199) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Stable non-secret fingerprint; financial text is not embedded in the key. */
function fingerprint(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x85ebca6b);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

function error(message: string): never {
  throw new Error(message);
}

export function parseZiraatWorkbook(data: ArrayBuffer, wallet: Wallet, existing: Entry[]): ImportPreview {
  if (!data.byteLength) return error('File kosong. Pilih mutasi Excel Ziraat.');
  if (data.byteLength > 8 * 1024 * 1024) return error('File terlalu besar. Gunakan mutasi dengan periode yang lebih singkat.');
  if (wallet.currency !== 'TRY') return error('Mutasi ini memakai TL. Pilih dompet dengan mata uang TL / TRY.');
  if (wallet.kind === 'cash') return error('Pilih rekening bank atau e-wallet untuk impor mutasi. Pembukuan cash tidak digunakan.');

  const workbook = readStatementWorkbook(data);
  const candidates: { values: unknown[][]; header: number; columns: number[]; formulas: Set<number> }[] = [];
  for (const { values, formulas } of workbook.sheets) {
    const header = values.findIndex(row => HEADERS.every(label => row.some(cell => normalized(cell) === label)));
    if (header >= 0) candidates.push({ values, header, formulas, columns: HEADERS.map(label => values[header].findIndex(v => normalized(v) === label)) });
  }
  if (candidates.length !== 1) {
    return error(candidates.length ? 'Ada lebih dari satu tabel mutasi. Unggah satu rekening per file.' : 'Kolom Ziraat tidak ditemukan. Dibutuhkan Tarih, Fiş No, Açıklama, İşlem Tutarı, dan Bakiye.');
  }
  const { values, header, columns, formulas } = candidates[0];
  const metadata = normalized(values.slice(0, header).flat().join(' '));
  const hasTL = /\b(?:TL|TRY)\b/.test(metadata);
  if (!hasTL || /\b(?:USD|EUR|GBP|IDR)\b/.test(metadata)) {
    return error('Mata uang belum bisa dipastikan sebagai TL. Gunakan ekspor satu rekening TL yang mencantumkan mata uangnya.');
  }

  const knownKeys = new Set(existing.flatMap(entry => [entry.sourceKey, entry.toSourceKey]).filter((key): key is string => Boolean(key)));
  const seen = new Set<string>();
  const rows: ImportRow[] = [];
  const date1904 = workbook.date1904;
  const [dateColumn, referenceColumn, descriptionColumn, amountColumn, balanceColumn] = columns;

  for (let index = header + 1; index < values.length; index += 1) {
    const row = values[index];
    if (!row?.some(v => String(v ?? '').trim())) continue;
    const dateValue = row[dateColumn];
    const date = isoDate(dateValue, date1904);
    const amount = minorUnits(row[amountColumn]);
    const balance = minorUnits(row[balanceColumn]);
    const originalDescription = String(row[descriptionColumn] ?? '');
    const originalReference = String(row[referenceColumn] ?? '');
    const description = originalDescription.trim();
    const reference = originalReference.trim();

    if (!date) {
      const looksDated = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(String(dateValue ?? '').trim());
      if (looksDated || (amount !== null && balance !== null && (description || reference))) {
        return error(`Tanggal pada baris ${index + 1} tidak valid. Impor dibatalkan agar transaksi tidak terlewat.`);
      }
      // Bank report titles, totals, and footers are not transactions.
      continue;
    }
    if (formulas.has(index)) return error(`Transaksi pada baris ${index + 1} mengandung rumus. Gunakan ekspor asli bank tanpa formula.`);
    if (amount === null || balance === null || !description || !reference) {
      return error(`Data transaksi pada baris ${index + 1} belum lengkap atau nominalnya tidak valid.`);
    }
    if (amount === 0) return error(`Nominal nol pada baris ${index + 1} perlu diperiksa sebelum impor.`);
    const sourceKey = `ziraat:${fingerprint(JSON.stringify([wallet.id, date, amount, balance, normalized(description)]))}`;
    const duplicate = knownKeys.has(sourceKey) || seen.has(sourceKey);
    seen.add(sourceKey);
    const text = normalized(description);
    const operation = interpretBankDescription(originalDescription,{signedAmount:amount});
    const confirmedType = confirmedBankEntryType(originalDescription,amount);
    const policyText = ` ${normalizeBankDescription(originalDescription)} `;
    const posPurchase = policyText.includes(' pos alisveris ') || policyText.includes(' pos harcama ');
    const legacyTransferHint = /\b(?:HAVALE|EFT|FAST|TRANSFER|VIRMAN|NAKIT|DOVIZ|KAMBIYO)\b|PARA CEK/.test(text);
    const transferHint = operation.kind !== 'transfer-fee' && (operation.pending && operation.kind !== 'cashback' || !posPurchase && legacyTransferHint);
    const uncertain = amount > 0 || transferHint || operation.kind === 'cashback';
    rows.push({
      id: `${sourceKey}:${index}`,
      date,
      description,
      originalDescription,
      amount,
      balance,
      reference,
      originalReference,
      sourceKey,
      classification: confirmedType ?? (uncertain ? 'unreviewed' : 'expense'),
      category: UNCATEGORIZED,
      selected: !duplicate,
      duplicate,
      warning: duplicate ? 'Sudah ada atau identik dengan baris lain. Tidak dipilih.'
        : confirmedType === 'movement' ? `${operation.label} dikenali. Hanya perubahan saldo rekening ini dicatat; bukan pemasukan atau pengeluaran.`
        : confirmedType === 'income' || confirmedType === 'expense' && operation.kind === 'atm-withdrawal' ? operation.warning
        : operation.pending ? operation.warning
        : transferHint ? 'Kemungkinan perpindahan uang. Saldo dicatat, jenisnya perlu ditinjau.'
        : amount > 0 ? 'Uang masuk belum tentu pemasukan. Saldo dicatat, jenisnya perlu ditinjau.'
        : undefined,
    });
  }
  if (!rows.length) return error('Tidak ada transaksi yang bisa diimpor dari file ini.');
  if (rows.length > 50000) return error('Terlalu banyak transaksi. Pilih periode mutasi yang lebih singkat.');

  const newestFirstDates = rows.every((row, i) => i === 0 || rows[i - 1].date >= row.date);
  const oldestFirstDates = rows.every((row, i) => i === 0 || rows[i - 1].date <= row.date);
  if (!newestFirstDates && !oldestFirstDates) return error('Urutan tanggal mutasi tidak konsisten. Unduh ulang file tanpa mengurutkan barisnya.');
  const newestFirstBalances = rows.every((row, i) => i === rows.length - 1 || row.balance === rows[i + 1].balance + row.amount);
  const oldestFirstBalances = rows.every((row, i) => i === 0 || row.balance === rows[i - 1].balance + row.amount);
  const newestFirst = newestFirstDates && newestFirstBalances;
  const oldestFirst = oldestFirstDates && oldestFirstBalances;
  if (!newestFirst && !oldestFirst) {
    return error('Saldo antarbaris tidak cocok dengan nominal transaksi. Periksa apakah ada baris hilang atau urutan diubah.');
  }
  const first = rows[0], last = rows[rows.length - 1];
  const oldest = newestFirst ? last : first;
  const newest = newestFirst ? first : last;
  const openingBalance = oldest.balance - oldest.amount;
  if (!Number.isSafeInteger(openingBalance)) return error('Saldo awal di luar rentang angka yang didukung.');
  const warnings: string[] = [];
  const duplicateCount = rows.filter(row => row.duplicate).length;
  const pendingCount = rows.filter(row => row.classification === 'unreviewed' && !row.duplicate).length;
  if (duplicateCount) warnings.push(`${duplicateCount} transaksi kemungkinan sudah ada dan tidak dipilih.`);
  if (pendingCount) warnings.push(`${pendingCount} transaksi disimpan sebagai Perlu ditinjau agar saldo tetap benar tanpa menebak pemasukan atau transfer.`);
  warnings.push('Impor mencatat rekening ini saja. Setor tunai dihitung sebagai pemasukan dan tarik tunai sebagai pengeluaran. Pokok transfer bank tetap perpindahan dana; pasangan rekening lain dapat dicocokkan bila tersedia.');
  return { rows, currency: 'TRY', openingBalance, closingBalance: newest.balance, warnings, period: { start: oldest.date, end: newest.date } };
}

export function entriesFromImport(rows: ImportRow[], walletId: string, batchId: string): Entry[] {
  return rows.filter(row => row.selected && !row.duplicate).map(row => {
    if (row.classification === 'expense' && row.amount >= 0) return error('Uang masuk tidak bisa diubah menjadi pengeluaran. Pilih pemasukan atau Perlu ditinjau.');
    if (row.classification === 'income' && row.amount <= 0) return error('Uang keluar tidak bisa diubah menjadi pemasukan. Pilih pengeluaran atau Perlu ditinjau.');
    // A transfer hint cannot create a two-wallet transfer without a destination.
    // Retain its signed flow for reconciliation until the user links both sides.
    const type = row.classification === 'transfer' ? 'unreviewed' : row.classification;
    return {
      id: `entry:${row.sourceKey}:${batchId}`,
      date: row.date,
      type,
      walletId,
      amount: type === 'unreviewed' || type === 'movement' ? row.amount : Math.abs(row.amount),
      category: row.category || UNCATEGORIZED,
      note: row.description,
      sourceKey: row.sourceKey,
      importBatch: batchId,
    };
  });
}
