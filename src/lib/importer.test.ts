import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { entriesFromImport, parseZiraatWorkbook } from './importer';
import type { Entry, Wallet } from './finance';

const wallet: Wallet = { id: 'sample-wallet', name: 'Ziraat contoh', currency: 'TRY', kind: 'bank', openingBalance: 0 };
const headers = ['Tarih', 'Fiş No', 'Açıklama', 'İşlem Tutarı', 'Bakiye'];
const transactions: unknown[][] = [
  ['23.10.2026', 'REF-REPEATED', 'POS toko contoh', -25.5, 174.5],
  ['22.10.2026', 'REF-REPEATED', 'HAVALE contoh', 100, 200],
  ['21.10.2026', 'OTHER', 'POS belanja contoh', -20, 100],
];

function workbook(rows: unknown[][] = transactions, currency = 'TL', customHeaders = headers,
  options: { coordinates?: boolean; stringType?: 'str' | 'inlineStr' | 's'; formula?: boolean } = {}): ArrayBuffer {
  const data = [
    ['Rekening contoh, bukan data pribadi'],
    ['Mata uang', currency],
    ...Array.from({ length: 9 }, () => []),
    customHeaders,
    ...rows,
    [],
    ['Catatan akhir laporan'],
  ];
  const strings: string[] = [];
  const escape = (value: unknown) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const cells = data.map((row, rowIndex) => `<row>${row.map((value, column) => {
    const coordinate = options.coordinates === false ? '' : ` r="${String.fromCharCode(65 + column)}${rowIndex + 1}"`;
    if (typeof value === 'number') return `<c${coordinate} t="n">${options.formula && rowIndex === 12 && column === 3 ? '<f>1+1</f>' : ''}<v>${value}</v></c>`;
    if (options.stringType === 'inlineStr') return `<c${coordinate} t="inlineStr"><is><t>${escape(value)}</t></is></c>`;
    if (options.stringType === 's') {
      const index = strings.push(String(value)) - 1;
      return `<c${coordinate} t="s"><v>${index}</v></c>`;
    }
    return `<c${coordinate} t="str"><v>${escape(value)}</v></c>`;
  }).join('')}</row>`).join('');
  const packed = zipSync({
    'xl/workbook.xml': strToU8('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><workbookPr date1904="0"/></workbook>'),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${cells}</sheetData></worksheet>`),
    ...(strings.length ? { 'xl/sharedStrings.xml': strToU8(`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map(value => `<si><t>${escape(value)}</t></si>`).join('')}</sst>`) } : {}),
  });
  return packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength) as ArrayBuffer;
}

describe('parseZiraatWorkbook', () => {
  it('maps dated rows, keeps same reference transactions distinct and reconciles balances', () => {
    const preview = parseZiraatWorkbook(workbook(), wallet, []);
    expect(preview.rows).toHaveLength(3);
    expect(preview.openingBalance).toBe(12000);
    expect(preview.closingBalance).toBe(17450);
    expect(preview.period).toEqual({ start: '2026-10-21', end: '2026-10-23' });
    expect(preview.currency).toBe('TRY');
    expect(preview.rows.map(row => row.amount)).toEqual([-2550, 10000, -2000]);
    expect(preview.rows.every(row => !row.duplicate && row.selected)).toBe(true);
    expect(preview.rows[0].sourceKey).not.toBe(preview.rows[1].sourceKey);
    expect(preview.rows[0].sourceKey).not.toContain('REF-REPEATED');
  });

  it('keeps credits and transfer hints pending while preserving signed cash flow', () => {
    const preview = parseZiraatWorkbook(workbook(), wallet, []);
    expect(preview.rows[1].classification).toBe('unreviewed');
    expect(preview.rows[1].warning).toContain('ditinjau');
    const entries = entriesFromImport(preview.rows, wallet.id, 'batch-example');
    expect(entries).toHaveLength(3);
    expect(entries[1]).toMatchObject({ type: 'unreviewed', amount: 10000, walletId: wallet.id });
    expect(entries.reduce((total, entry) => total + (entry.type === 'expense' ? -entry.amount : entry.amount), preview.openingBalance)).toBe(preview.closingBalance);
  });

  it('detects repeated imports from either side of an existing transfer', () => {
    const preview = parseZiraatWorkbook(workbook(), wallet, []);
    const existing = [{ sourceKey: preview.rows[0].sourceKey }, { toSourceKey: preview.rows[1].sourceKey }] as Entry[];
    const second = parseZiraatWorkbook(workbook(), wallet, existing);
    expect(second.rows.map(row => row.duplicate)).toEqual([true, true, false]);
    expect(second.rows.map(row => row.selected)).toEqual([false, false, true]);
    expect(entriesFromImport(second.rows, wallet.id, 'second')).toHaveLength(1);
  });

  it('scopes duplicate fingerprints to their wallet', () => {
    const first = parseZiraatWorkbook(workbook(), wallet, []);
    const other = parseZiraatWorkbook(workbook(), { ...wallet, id: 'another-wallet' }, entriesFromImport(first.rows, wallet.id, 'first'));
    expect(other.rows.every(row => !row.duplicate)).toBe(true);
  });

  it('reads Turkish textual money and preserves minor units', () => {
    const result = parseZiraatWorkbook(workbook([
      ['23.10.2026', 'A', 'POS contoh', '-1.234,56', '2.000,00'],
      ['22.10.2026', 'B', 'POS contoh lainnya', '-25,44', '3.234,56'],
    ]), wallet, []);
    expect(result.rows[0].amount).toBe(-123456);
    expect(result.closingBalance).toBe(200000);
    expect(result.openingBalance).toBe(326000);
  });

  it('accepts chronological exports without rearranging same-day entries', () => {
    const sameDay = [
      ['23.10.2026', 'A', 'POS pertama', -10, 90],
      ['23.10.2026', 'B', 'POS kedua', -20, 70],
    ];
    const result = parseZiraatWorkbook(workbook(sameDay), wallet, []);
    expect(result.rows.map(row => row.description)).toEqual(['POS pertama', 'POS kedua']);
    expect(result.openingBalance).toBe(10000);
    expect(result.closingBalance).toBe(7000);
  });

  it('rejects a wallet or file in an unsupported currency', () => {
    expect(() => parseZiraatWorkbook(workbook(), { ...wallet, currency: 'IDR' }, [])).toThrow('TL');
    expect(() => parseZiraatWorkbook(workbook(transactions, 'USD'), wallet, [])).toThrow('mata uang');
  });

  it('rejects unknown headers and empty files', () => {
    expect(() => parseZiraatWorkbook(workbook(transactions, 'TL', ['Date', 'No', 'Note', 'Amount', 'Balance']), wallet, [])).toThrow('Kolom Ziraat');
    expect(() => parseZiraatWorkbook(new ArrayBuffer(0), wallet, [])).toThrow('kosong');
  });

  it('fails closed on invalid dates, missing amounts and broken running balances', () => {
    const invalidDate = transactions.map(row => [...row]);
    invalidDate[0][0] = '31.02.2026';
    expect(() => parseZiraatWorkbook(workbook(invalidDate), wallet, [])).toThrow('Tanggal');
    const missingAmount = transactions.map(row => [...row]);
    missingAmount[0][3] = '';
    expect(() => parseZiraatWorkbook(workbook(missingAmount), wallet, [])).toThrow('belum lengkap');
    const broken = transactions.map(row => [...row]);
    broken[0][4] = 175;
    expect(() => parseZiraatWorkbook(workbook(broken), wallet, [])).toThrow('Saldo antarbaris');
  });

  it('does not change the bank cash flow when selecting income or expense', () => {
    const { rows } = parseZiraatWorkbook(workbook(), wallet, []);
    rows[1].classification = 'income';
    expect(entriesFromImport(rows, wallet.id, 'reviewed')[1].amount).toBe(10000);
    rows[1].classification = 'expense';
    expect(() => entriesFromImport(rows, wallet.id, 'wrong-sign')).toThrow('Uang masuk');
  });

  it('supports shared strings, inline strings and source files without cell coordinates', () => {
    for (const stringType of ['str', 'inlineStr', 's'] as const) {
      const result = parseZiraatWorkbook(workbook(transactions, 'TL', headers, { coordinates: false, stringType }), wallet, []);
      expect(result.rows).toHaveLength(3);
      expect(result.rows[0].amount).toBe(-2550);
    }
  });

  it('rejects formulas in dated transaction rows', () => {
    expect(() => parseZiraatWorkbook(workbook(transactions, 'TL', headers, { formula: true }), wallet, [])).toThrow('rumus');
  });

  it('decodes standard XML escapes in descriptions', () => {
    const result = parseZiraatWorkbook(workbook([
      ['23.10.2026', 'A', 'POS contoh & lainnya', -10, 90],
    ]), wallet, []);
    expect(result.rows[0].description).toBe('POS contoh & lainnya');
  });

  it('preserves a transfer hint as pending cash flow until both wallets can be linked', () => {
    const result = parseZiraatWorkbook(workbook(), wallet, []);
    result.rows[1].classification = 'transfer';
    expect(entriesFromImport(result.rows, wallet.id, 'pending')[1]).toMatchObject({ type: 'unreviewed', amount: 10000 });
  });

  it('rejects custom entity definitions without resolving them', () => {
    const packed = zipSync({
      'xl/worksheets/sheet1.xml': strToU8('<!DOCTYPE worksheet [<!ENTITY custom "unexpected">]><worksheet><sheetData/></worksheet>'),
    });
    const buffer = packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength) as ArrayBuffer;
    expect(() => parseZiraatWorkbook(buffer, wallet, [])).toThrow('Struktur XML');
  });

  it('bounds inflated XML size before extraction', () => {
    const packed = zipSync({
      'xl/worksheets/sheet1.xml': strToU8(' '.repeat(32 * 1024 * 1024 + 1)),
    });
    const buffer = packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength) as ArrayBuffer;
    expect(() => parseZiraatWorkbook(buffer, wallet, [])).toThrow('terlalu besar');
  });
});
