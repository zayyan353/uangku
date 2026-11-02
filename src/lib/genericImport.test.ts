import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseGenericStatement, parseStatementCsv, parseStatementDate, parseStatementMoney, readGenericTables, type GenericMapping, type GenericTable } from './genericImport';
import type { Wallet } from './finance';
import { walletBalance } from './finance';
import { inspectSourcedImport, prepareSourcedImport, applySourcedBulkCategory } from './sourceCommands';
import type { SourceDocument } from './sourceModel';
import { readStatementWorkbook, type ImportPreview } from './importer';
import { parseBackupText, serializeBackup } from './storage';
import { defaultCategorySettings } from './categorySettings';
import { createCategorySuggester, entryCategorySuggestions } from './categorySuggestions';
import { applyBankDecisions } from './bankDecisions';

const at = '2026-10-31T12:00:00Z';
const wallet = (currency: Wallet['currency'] = 'EUR'): Wallet => ({ id: 'bank', name: 'Synthetic statement bank', currency, kind: 'bank', openingBalance: 0 });
const document = (currency: Wallet['currency'] = 'EUR'): SourceDocument => ({ app: 'uangku', version: 1, demo: false, state: { version: 1, wallets: [wallet(currency)], entries: [] } });
const mapping = (patch: Partial<GenericMapping> = {}): GenericMapping => ({ headerRow: 0, dateColumn: 0, descriptionColumn: 1,
  amountMode: 'signed', amountColumn: 2, balanceColumn: 3, referenceColumn: 4, currencyColumn: 5,
  dateFormat: 'iso', decimalSeparator: '.', order: 'oldest', confirmedCurrency: 'EUR', ...patch });
const table = (values: unknown[][] = [
  ['Date', 'Description', 'Amount', 'Balance', 'Reference', 'Currency'],
  ['2026-10-01', '  Synthetic bank credit  ', '1000.50', '1010.50', '00001', 'EUR'],
  ['2026-10-02', 'Synthetic bank debit', '-10.50', '1000.00', '00002', 'EUR'],
]): GenericTable => ({ id: 'csv', name: 'Synthetic', values, formulas: new Set() });
const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;
const ready = (data: SourceDocument, preview: ImportPreview, batch = 'batch') => {
  const result = prepareSourcedImport(data, data.state.wallets[0], preview, {}, true, batch, at);
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error(JSON.stringify(result));
  return result.data;
};
const escaped = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
function xlsx(values: unknown[][], options: { date1904?: boolean; formula?: boolean; duplicateSheet?: boolean } = {}): ArrayBuffer {
  const rows = values.map((row, i) => `<row r="${i + 1}">${row.map((value, j) => typeof value === 'number'
    ? `<c t="n"><v>${value}</v></c>` : `<c t="inlineStr"><is><t>${escaped(String(value))}</t></is>${options.formula && i === 1 && j === 2 ? '<f>1+1</f>' : ''}</c>`).join('')}</row>`).join('');
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const files = {
    'xl/workbook.xml': strToU8(`<workbook ${ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="${options.date1904 ? 1 : 0}"/><sheets><sheet name="Primary named sheet" sheetId="1" r:id="rId2"/>${options.duplicateSheet ? '<sheet name="Duplicate" sheetId="2" r:id="rId2"/>' : '<sheet name="Other named sheet" sheetId="2" r:id="rId1"/>'}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet ${ns}><sheetData><row><c t="inlineStr"><is><t>Other data</t></is></c></row></sheetData></worksheet>`),
    'xl/worksheets/sheet2.xml': strToU8(`<worksheet ${ns}><sheetData>${rows}</sheetData></worksheet>`),
  };
  const value = zipSync(files); return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

describe('generic statement CSV and explicit formats', () => {
  it('retains BOM, quoted separators/newlines/quotes and leading-zero identifiers correctly', () => {
    expect(parseStatementCsv('\uFEFFDate;Description;Ref\r\n2026-10-01;"Merchant; \"\"quoted\"\"\nline";00001\r\n', ';')).toEqual([
      ['Date', 'Description', 'Ref'], ['2026-10-01', 'Merchant; "quoted"\nline', '00001'],
    ]);
  });
  it.each(['a,"unfinished', 'a,un"quoted', '"closed"garbage,b'])('rejects malformed quoting: %s', value => expect(() => parseStatementCsv(value, ',')).toThrow(/kutip|karakter/i));
  it('supports TSV and rejects bad UTF8, unsupported formats and oversized files before parsing', () => {
    expect(readGenericTables(bytes('A\tB\n1\t2'), 'sample.tsv')[0].values[1]).toEqual(['1', '2']);
    expect(() => readGenericTables(new Uint8Array([255]).buffer, 'bad.csv')).toThrow(/UTF-8/);
    expect(() => readGenericTables(bytes('data'), 'bad.xls')).toThrow(/mendukung/);
    expect(() => readGenericTables(new ArrayBuffer(8 * 1024 * 1024 + 1), 'big.csv')).toThrow(/8 MiB/);
  });
  it.each([
    ['1,234.56', 'EUR', '.', 123456], ['1.234,56', 'TRY', ',', 123456],
    ['(1,234.50)', 'USD', '.', -123450], ['1 234,50', 'EUR', ',', 123450],
    ['123', 'JPY', '.', 123], ['123.00', 'JPY', '.', 123], ['1.234', 'KWD', '.', 1234],
    ['1,234', 'KWD', ',', 1234], ['0.001', 'KWD', '.', 1], ['0.0001', 'CLF', '.', 1],
    ['90,071,992,547,409.91', 'EUR', '.', Number.MAX_SAFE_INTEGER],
  ] as const)('parses exact currency units %s/%s', (value, currency, decimal, expected) => expect(parseStatementMoney(value, currency, decimal)).toBe(expected));
  it.each(['1,23.45', '12,34', '1.001', 'NaN', 'Infinity', '1e3', '+(1)', '1.', ''])('rejects invalid two-decimal nominal %s', value => expect(() => parseStatementMoney(value, 'EUR', '.')).toThrow());
  it('rejects nonzero extra precision and overflow', () => {
    expect(() => parseStatementMoney('1.01', 'JPY', '.')).toThrow(/0 digit/);
    expect(() => parseStatementMoney('1.2345', 'KWD', '.')).toThrow(/3 digit/);
    expect(() => parseStatementMoney('90,071,992,547,409.92', 'EUR', '.')).toThrow(/batas/);
  });
  it.each([
    ['2026-02-28', 'iso', '2026-02-28'], ['31/10/2026', 'dmy', '2026-10-31'],
    ['10/31/2026', 'mdy', '2026-10-31'], ['01/02/2026', 'dmy', '2026-02-01'], ['01/02/2026', 'mdy', '2026-01-02'],
    ['61', 'excel', '1900-03-01'], ['1', 'excel', '1900-01-01'],
  ] as const)('parses chosen date format %s/%s', (value, format, expected) => expect(parseStatementDate(value, format)).toBe(expected));
  it('handles Excel1904 explicitly and rejects impossible/fractional dates', () => {
    expect(parseStatementDate('0', 'excel', true)).toBe('1904-01-01');
    for (const [value, format] of [['60', 'excel'], ['61.5', 'excel'], ['31/02/2026', 'dmy'], ['2026-13-01', 'iso'], ['01/02/2026', 'iso']] as const) expect(() => parseStatementDate(value, format)).toThrow();
  });
});

describe('generic source preview invariants', () => {
  it('keeps FAST FOOD and a prepaid hotel refund unresolved through import, backup and category review', () => {
    const csv = 'Date,Description,Amount,Balance,Reference,Currency\n2026-10-01,FAST FOOD RESTAURANT,-25000,75000,A,IDR\n2026-10-02,PREPAID HOTEL DEPOSIT REFUND,10000,85000,B,IDR';
    const [input] = readGenericTables(bytes(csv), 'statement.csv');
    const account = wallet('IDR'), options = mapping({ confirmedCurrency: 'IDR' });
    const preview = parseGenericStatement(input, options, account, []);
    const settings = defaultCategorySettings(), suggest = createCategorySuggester(settings);
    for (const row of preview.rows) {
      expect(row.classification).toBe('unreviewed');
      expect(suggest(row.description, 'unreviewed', row.amount, row.fingerprintVersion)).toEqual({ kind: 'none', suggestions: [] });
    }
    const data = parseBackupText(serializeBackup(ready(document('IDR'), preview)));
    const [expense, credit] = [...data.state.entries].sort((a, b) => a.date.localeCompare(b.date));
    expect([expense, credit].map(entry => [entry.type, entry.category, entry.amount])).toEqual([
      ['unreviewed', 'Belum dikategorikan', -2500000], ['unreviewed', 'Belum dikategorikan', 1000000],
    ]);
    expect(walletBalance(data.state, account.id, data.metadata)).toBe(8500000);
    expect(data.metadata!.facts.map(fact => [fact.description, fact.reference, fact.signedAmount, fact.balanceAfter])).toEqual([
      ['FAST FOOD RESTAURANT', 'A', -2500000, 7500000], ['PREPAID HOTEL DEPOSIT REFUND', 'B', 1000000, 8500000],
    ]);
    expect(parseGenericStatement(input, options, account, data.state.entries).rows.every(row => row.duplicate && !row.selected)).toBe(true);
    // A valid backup may contain only a linked fact without its redundant entry alias.
    delete expense.sourceKey;
    expect(entryCategorySuggestions(data, settings)).toEqual([]);
    for (const entry of [expense, credit]) {
      expect(() => applyBankDecisions(data, [{ entryId: entry.id, category: 'Transfer', confirmBankType: true }])).toThrow(/belum dapat dipastikan/);
    }
    settings.rules.push({ id: 'personal-fast-food', keyword: 'FAST FOOD RESTAURANT', category: 'Makan & minum', mode: 'auto' });
    expect(entryCategorySuggestions(data, settings)).toMatchObject([{ entry: { id: expense.id }, match: { kind: 'suggestions', suggestions: [{ category: 'Makan & minum' }] } }]);
    const chosen = applyBankDecisions(data, [{ entryId: expense.id, category: 'Makan & minum' }]);
    expect(chosen.state.entries.find(entry => entry.id === expense.id)).toMatchObject({ category: 'Makan & minum', type: 'unreviewed' });
    expect(chosen.metadata!.facts).toEqual(data.metadata!.facts);
  });
  it('preserves raw source text, signed money, statement opening/closing and unresolved purpose', () => {
    const input = table(), before = JSON.stringify(input.values), preview = parseGenericStatement(input, mapping(), wallet(), []);
    expect(preview).toMatchObject({ currency: 'EUR', openingBalance: 1000, closingBalance: 100000 });
    expect(preview.rows.map(row => [row.amount, row.classification, row.reference, row.fingerprintVersion])).toEqual([[100050, 'unreviewed', '00001', 'generic-v1'], [-1050, 'unreviewed', '00002', 'generic-v1']]);
    expect(preview.rows[0].originalDescription).toBe('  Synthetic bank credit  ');
    expect(preview.rows[0].sourceKey).toMatch(/^generic:[a-f0-9]{16}$/);
    expect(JSON.stringify(input.values)).toBe(before);
  });
  it('uses explicit order even when same-day opposing movements can reconcile both ways', () => {
    const input = table([table().values[0], ['2026-10-01', 'Credit', '1', '2', 'a', 'EUR'], ['2026-10-01', 'Debit', '-1', '1', 'b', 'EUR']]);
    expect(parseGenericStatement(input, mapping(), wallet(), [])).toMatchObject({ openingBalance: 100, closingBalance: 100 });
    expect(parseGenericStatement(input, mapping({ order: 'newest' }), wallet(), [])).toMatchObject({ openingBalance: 200, closingBalance: 200 });
  });
  it('commits the explicitly declared newest-first same-day chain rather than choosing another valid order', () => {
    const input = table([table().values[0], ['2026-10-01', 'Credit', '1', '2', 'a', 'EUR'], ['2026-10-01', 'Debit', '-1', '1', 'b', 'EUR']]);
    const preview = parseGenericStatement(input, mapping({ order: 'newest' }), wallet(), []);
    const data = ready(document(), preview);
    expect(data.state.wallets[0].openingBalance).toBe(200);
    expect(walletBalance(data.state, 'bank', data.metadata)).toBe(200);
    expect(data.metadata!.facts.map(fact => fact.signedAmount)).toEqual([-100, 100]);
  });
  it('handles debit/credit blanks, signs and precision conservatively', () => {
    const input = table([['Date', 'Description', 'Debit', 'Credit', 'Balance'], ['2026-10-01', 'Incoming', '', '10', '110'], ['2026-10-02', 'Outgoing', '2', '', '108']]);
    const map = mapping({ amountMode: 'debit-credit', amountColumn: undefined, debitColumn: 2, creditColumn: 3, balanceColumn: 4, referenceColumn: undefined, currencyColumn: undefined });
    expect(parseGenericStatement(input, map, wallet(), []).rows.map(row => row.amount)).toEqual([1000, -200]);
    input.values[1][2] = '1'; expect(() => parseGenericStatement(input, map, wallet(), [])).toThrow(/salah satunya/);
    input.values[1][2] = '-1'; expect(() => parseGenericStatement(input, map, wallet(), [])).toThrow(/positif/);
  });
  it.each([
    { balanceColumn: -1 }, { balanceColumn: 2 }, { dateColumn: 512 }, { headerRow: -1 }, { confirmedCurrency: 'USD' },
  ] as Partial<GenericMapping>[])('rejects invalid mapping/currency %o', patch => expect(() => parseGenericStatement(table(), mapping(patch), wallet(), [])).toThrow());
  it.each([
    [1, 5, 'USD', /mata uang/i], [1, 2, '0', /nol/], [2, 3, '999', /saldo antarbaris/], [1, 3, '', /Nominal kosong/],
    [1, 1, '', /Keterangan/], [1, 0, '2026-02-30', /Tanggal/],
  ] as const)('rejects bad row cell %s:%s', (row, column, value, expected) => {
    const input = table(); input.values[row][column] = value;
    expect(() => parseGenericStatement(input, mapping(), wallet(), [])).toThrow(expected);
  });
  it('does not allow a recognized currency column to be ignored or ambiguously selected', () => {
    expect(() => parseGenericStatement(table(), mapping({ currencyColumn: undefined }), wallet(), [])).toThrow(/Petakan kolom/);
    const input = table(); input.values[0].push('Currency');
    expect(() => parseGenericStatement(input, mapping(), wallet(), [])).toThrow(/beberapa kolom/);
  });
  it('rejects formulas, duplicate source rows and archived cash target', () => {
    const input = table(); input.formulas = new Set([1]); expect(() => parseGenericStatement(input, mapping(), wallet(), [])).toThrow(/rumus/);
    input.formulas = new Set(); input.values.push([...input.values[1]]); expect(() => parseGenericStatement(input, mapping(), wallet(), [])).toThrow(/Identitas dua baris/);
    expect(() => parseGenericStatement(table(), mapping(), { ...wallet(), kind: 'cash' }, [])).toThrow(/mata uang/i);
  });
  it('only confirms exact recognized operations, without assuming ordinary credits are earnings', () => {
    const input = table([table().values[0], ['2026-10-01', 'TAM ATM SORUNLU ISLEM IADESI', '1', '1', 'a', 'EUR'], ['2026-10-02', 'GIDEN HAVALE', '-1', '0', 'b', 'EUR']]);
    expect(parseGenericStatement(input, mapping(), wallet(), []).rows.map(row => row.classification)).toEqual(['income', 'movement']);
  });
  it.each([
    ['FAST', '-1'], ['PREPAID', '1'], ['GIDEN FAST', '1'],
    ['GELEN EFT', '-1'], ['GIDEN HAVALE SHOP', '-1'], ['TAM ATM SORUNLU ISLEM IADESI', '-1'],
  ])('leaves a generic memo unresolved for insufficient or contradictory evidence: %s / %s', (memo, amount) => {
    const input = table([table().values[0], ['2026-10-01', memo, amount, '100', 'A', 'EUR']]);
    expect(parseGenericStatement(input, mapping(), wallet(), []).rows[0].classification).toBe('unreviewed');
  });
  it('rejects >50k transactions before accepting the extra row', () => {
    const input = table([table().values[0], ...Array.from({ length: 50_001 }, (_, index) => ['2026-10-01', 'Synthetic', '1', String(index + 1), String(index), 'EUR'])]);
    expect(() => parseGenericStatement(input, mapping(), wallet(), [])).toThrow(/50.000/);
  });
});

describe('XLSX source values and cross-format identity', () => {
  it('resolves actual workbook names/order and retains numeric reference text', () => {
    const tables = readGenericTables(xlsx(table().values), 'sample.xlsx');
    expect(tables.map(row => row.name)).toEqual(['Primary named sheet', 'Other named sheet']);
    expect(tables[0].values[1][4]).toBe('00001');
    expect(() => readGenericTables(xlsx(table().values, { duplicateSheet: true }), 'duplicate.xlsx')).toThrow(/berulang/);
  });
  it('deduplicates equivalent CSV and numeric XLSX values despite different money text formats', () => {
    const csv = parseGenericStatement(table(), mapping(), wallet(), []);
    const values = table().values; values[1][2] = 1000.5; values[1][3] = 1010.5; values[2][2] = -10.5; values[2][3] = 1000;
    const excel = readGenericTables(xlsx(values), 'sample.xlsx')[0];
    const preview = parseGenericStatement(excel, mapping({ decimalSeparator: ',' }), wallet(), []);
    expect(preview.rows.map(row => row.sourceKey)).toEqual(csv.rows.map(row => row.sourceKey));
    const data = ready(document(), csv);
    const repeated = parseGenericStatement(excel, mapping(), wallet(), data.state.entries);
    expect(repeated.rows.every(row => row.duplicate && !row.selected)).toBe(true);
    expect(walletBalance(data.state, 'bank', data.metadata)).toBe(100000);
    expect(parseBackupText(serializeBackup(data))).toEqual(data);
  });
  it('honors physical sparse worksheet row positions for header selection', () => {
    const values = table().values;
    const rows = values.map((row, index) => `<row r="${index + 12}">${row.map(value => `<c t="inlineStr"><is><t>${escaped(String(value))}</t></is></c>`).join('')}</row>`).join('');
    const archive = zipSync({ 'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData><row r="1"><c t="inlineStr"><is><t>Title</t></is></c></row>${rows}</sheetData></worksheet>`) });
    const input = readGenericTables(archive.buffer.slice(archive.byteOffset,archive.byteOffset+archive.byteLength) as ArrayBuffer, 'sparse.xlsx')[0];
    expect(input.values[11]).toEqual(values[0]); expect(input.values[1]).toEqual([]);
    expect(parseGenericStatement(input,mapping({headerRow:11}),wallet(),[]).closingBalance).toBe(100000);
  });
  it.each(['<row r="0"/>','<row r="2"/><row r="2"/>','<row r="3"/><row r="2"/>','<row r="50102"/>','<row r="2"><c r="A3"><v>1</v></c></row>'])('rejects malformed generic worksheet coordinates %s', rows => {
    const archive=zipSync({'xl/worksheets/sheet1.xml':strToU8(`<worksheet><sheetData>${rows}</sheetData></worksheet>`)});
    expect(()=>readGenericTables(archive.buffer.slice(archive.byteOffset,archive.byteOffset+archive.byteLength) as ArrayBuffer,'invalid.xlsx')).toThrow(/Koordinat/);
  });
  it.each(['<c/>', '<c t="s"/>', '<c t="s"><v/></c>'])('preserves blank debit/credit columns without reading shared string zero: %s', blank => {
    const headers = ['Date','Description','Debit','Credit','Balance'].map(value => `<c t="inlineStr"><is><t>${value}</t></is></c>`).join('');
    const row = (date: string, description: string, cells: string) => `<row><c t="inlineStr"><is><t>${date}</t></is></c><c t="inlineStr"><is><t>${description}</t></is></c>${cells}</row>`;
    const archive = zipSync({
      'xl/sharedStrings.xml': strToU8('<sst><si><t>999999</t></si></sst>'),
      'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData><row>${headers}</row>${row('2026-10-01','Credit',`${blank}<c t="n"><v>1.234</v></c><c t="n"><v>11.234</v></c>`)}${row('2026-10-02','Debit',`<c t="n"><v>2.001</v></c>${blank}<c t="n"><v>9.233</v></c>`)}</sheetData></worksheet>`),
    });
    const buffer = archive.buffer.slice(archive.byteOffset,archive.byteOffset+archive.byteLength) as ArrayBuffer;
    for (const preserve of [false,true]) {
      const sheet = readStatementWorkbook(buffer,preserve).sheets[0];
      expect(sheet.values[1][2]).toBe(''); expect(sheet.values[2][3]).toBe('');
    }
    const sheet = readGenericTables(buffer,'blank-columns.xlsx')[0];
    const preview = parseGenericStatement(sheet,mapping({confirmedCurrency:'KWD',amountMode:'debit-credit',amountColumn:undefined,debitColumn:2,creditColumn:3,balanceColumn:4,referenceColumn:undefined,currencyColumn:undefined}),wallet('KWD'),[]);
    expect(preview.rows.map(item => item.amount)).toEqual([1234,-2001]);
    expect(preview).toMatchObject({openingBalance:10000,closingBalance:9233});
  });
  it('rejects nonempty primitive cells clearly instead of crashing or guessing a value', () => {
    const archive=zipSync({'xl/worksheets/sheet1.xml':strToU8('<worksheet><sheetData><row><c>15</c></row></sheetData></worksheet>')});
    const buffer=archive.buffer.slice(archive.byteOffset,archive.byteOffset+archive.byteLength) as ArrayBuffer;
    expect(()=>readStatementWorkbook(buffer)).toThrow(/Struktur sel/);
    expect(()=>readStatementWorkbook(buffer,true)).toThrow(/Struktur sel/);
  });
  it('rejects numeric-row Excel formulas and never evaluates them', () => {
    const value = readGenericTables(xlsx(table().values, { formula: true }), 'formula.xlsx')[0];
    expect(() => parseGenericStatement(value, mapping(), wallet(), [])).toThrow(/rumus/);
  });
});

describe('cross-namespace source review', () => {
  it('reviews a corrected Excel row after an earlier anchor without rewriting or silently duplicating the old posting', () => {
    const account = wallet('IDR'), options = mapping({ confirmedCurrency: 'IDR' });
    const header = table().values[0];
    const oldRow = ['2026-10-02', 'Caf&#233; &#xC7;a&#287;r&#305; / literal &#233;', '-25000', '75000', '&#199;-123', 'IDR'];
    const oldFile = table([header, ['2026-10-01', 'Earlier posted row', '1000', '100000', 'R0', 'IDR'], oldRow]);
    const old = ready(document('IDR'), parseGenericStatement(oldFile, options, account, []));
    const before = serializeBackup(old);
    // Only some of these spellings came from XML. The bank genuinely wrote
    // the reference and the final five literal characters of the description.
    const fixedRow = [oldRow[0], 'Café Çağrı / literal &#233;', ...oldRow.slice(2)];
    const parse = (row: string[]) => parseGenericStatement(table([header, row]), options, account, old.state.entries);
    const preview = parse(fixedRow), id = preview.rows[0].id, savedWallet = old.state.wallets[0];
    const pending = prepareSourcedImport(old, savedWallet, preview, {}, false, 'incoming', at);
    expect(pending.status).toBe('review');
    const review = pending.inspection.sourceReviews[id];
    expect(review).toMatchObject({ status: 'alternate-source', allowedResolutions: ['keep', 'distinct'] });
    const kept = prepareSourcedImport(old, savedWallet, { ...preview, rows: [{ ...preview.rows[0], selected: false }] },
      { [id]: { resolution: 'keep', signature: review.signature } }, false, 'kept', at);
    expect(kept.status).toBe('ready');
    if (kept.status !== 'ready') throw Error('Expected a reviewed source observation');
    expect(kept.data.state).toEqual(old.state);
    expect(kept.data.metadata!.facts.slice(0, 2)).toEqual(old.metadata!.facts);
    expect(kept.data.metadata!.facts[2]).toMatchObject({ description: fixedRow[1], reference: '&#199;-123' });
    expect(kept.data.metadata!.dispositions).toContainEqual(expect.objectContaining({ sourceId: kept.data.metadata!.facts[2].id, kind: 'excluded' }));
    const again = inspectSourcedImport(kept.data, savedWallet, preview).sourceReviews[id];
    expect(again.status).toBe('known-excluded');
    expect(prepareSourcedImport(kept.data, savedWallet, preview, {}, false, 'again', at).status).toBe('review');
    const keptAgain = prepareSourcedImport(kept.data, savedWallet, { ...preview, rows: [{ ...preview.rows[0], selected: false }] },
      { [id]: { resolution: 'keep', signature: again.signature } }, false, 'again', at);
    expect(keptAgain.status).toBe('ready');
    if (keptAgain.status !== 'ready') throw Error('Expected unchanged exclusion');
    expect(keptAgain.data.state).toEqual(old.state);
    expect(keptAgain.data.metadata).toEqual(kept.data.metadata);
    const distinct = prepareSourcedImport(old, savedWallet, preview, { [id]: { resolution: 'distinct', signature: review.signature } }, false, 'distinct', at);
    expect(distinct.status).toBe('ready');
    if (distinct.status !== 'ready') throw Error('Expected the explicitly distinct posting');
    expect(distinct.data.state.entries).toHaveLength(3);
    expect(distinct.data.metadata!.facts.slice(0, 2)).toEqual(old.metadata!.facts);
    expect(serializeBackup(old)).toBe(before);
    const anotherReference = [...fixedRow]; anotherReference[4] = 'Ç-999';
    expect(inspectSourcedImport(old, savedWallet, parse(anotherReference)).needsReview).toBe(false);
  });

  it('keeps a Ziraat fingerprint collision under review when only the reference spelling changes', () => {
    const account = wallet('TRY'), options = mapping({ confirmedCurrency: 'TRY' });
    const ziraat = (reference: string): ImportPreview => {
      const preview = parseGenericStatement(table([table().values[0],
        ['2026-10-02', 'Unchanged memo', '-25', '75', reference, 'TRY']]), options, account, []);
      // Ziraat's historical fingerprint excludes the originating reference.
      return { ...preview, rows: preview.rows.map(row => ({ ...row, sourceKey: 'ziraat:0000000000000001', fingerprintVersion: 'ziraat-v1' })) };
    };
    const old = ready(document('TRY'), ziraat('&#199;-123')), before = serializeBackup(old);
    const preview = ziraat('Ç-123'), status = prepareSourcedImport(old, old.state.wallets[0], preview, {}, false, 'repeat', at);
    expect(status.status).toBe('review');
    expect(status.inspection.sourceReviews[preview.rows[0].id]).toMatchObject({ status: 'identity-ambiguous', allowedResolutions: ['keep'] });
    expect(serializeBackup(old)).toBe(before);
  });

  it('requires review of an old Ziraat alias without source facts if its date, amount and numeric-reference memo match', () => {
    const data = document('TRY'), account = data.state.wallets[0];
    data.state.entries.push({ id: 'old', walletId: account.id, date: '2026-10-02', amount: -2500, type: 'unreviewed',
      category: 'Manual', note: 'Caf&#233; &#199;', sourceKey: 'ziraat:0000000000000001' });
    const mapped = parseGenericStatement(table([table().values[0], ['2026-10-02', 'Café Ç', '-25', '75', 'Ç-123', 'TRY']]),
      mapping({ confirmedCurrency: 'TRY' }), account, []);
    const incoming: ImportPreview = { ...mapped, rows: mapped.rows.map(row => ({ ...row, sourceKey: 'ziraat:0000000000000002', fingerprintVersion: 'ziraat-v1' })) };
    const status = prepareSourcedImport(data, account, incoming, {}, false, 'after-update', at);
    expect(status.status).toBe('review');
    expect(status.inspection.sourceReviews[incoming.rows[0].id]).toMatchObject({ status: 'alternate-source', allowedResolutions: ['keep', 'distinct'] });
    expect(data.state.entries[0].category).toBe('Manual');
  });

  function base() {
    const preview = parseGenericStatement(table([table().values[0], ['2026-10-01', 'Synthetic bank credit', '100', '110', 'r', 'TRY']]), mapping({ confirmedCurrency: 'TRY' }), wallet('TRY'), []);
    const ziraat: ImportPreview = { ...preview, rows: preview.rows.map(row => ({ ...row, sourceKey: 'ziraat:0000000000000001', fingerprintVersion: 'ziraat-v1' })) };
    return { data: ready(document('TRY'), ziraat, 'ziraat'), preview };
  }
  it('requires a current explicit decision instead of adding the same bank flow in another namespace', () => {
    const { data, preview } = base(), before = serializeBackup(data);
    const inspection = inspectSourcedImport(data, data.state.wallets[0], preview);
    const review = inspection.sourceReviews[preview.rows[0].id];
    expect(review).toMatchObject({ status: 'alternate-source', allowedResolutions: ['keep', 'distinct'] });
    expect(prepareSourcedImport(data, data.state.wallets[0], preview, {}, false, 'generic', at).status).toBe('review');
    const skipped = { ...preview, rows: preview.rows.map(row => ({ ...row, selected: false })) };
    const kept = prepareSourcedImport(data, data.state.wallets[0], skipped, { [preview.rows[0].id]: { resolution: 'keep', signature: review.signature } }, false, 'generic', at);
    expect(kept.status).toBe('ready'); if (kept.status !== 'ready') return;
    expect(kept.data.state).toEqual(data.state);
    expect(kept.data.metadata!.facts.slice(0, data.metadata!.facts.length)).toEqual(data.metadata!.facts);
    const newFact = kept.data.metadata!.facts.find(fact => fact.fingerprintVersion === 'generic-v1')!;
    expect(kept.data.metadata!.dispositions).toContainEqual(expect.objectContaining({ sourceId: newFact.id, kind: 'excluded' }));
    expect(serializeBackup(data)).toBe(before);
    expect(inspectSourcedImport(kept.data, kept.data.state.wallets[0], preview).sourceReviews[preview.rows[0].id].allowedResolutions).toEqual(['keep', 'distinct']);
  });
  it('keeps original entries and honors preview annotations when user explicitly chooses a different transaction', () => {
    const { data, preview } = base(); preview.rows[0].category = 'Pilihan pengguna'; preview.rows[0].classification = 'income';
    const inspection = inspectSourcedImport(data, data.state.wallets[0], preview), id = preview.rows[0].id;
    const result = prepareSourcedImport(data, data.state.wallets[0], preview, { [id]: { resolution: 'distinct', signature: inspection.sourceReviews[id].signature } }, false, 'distinct', at);
    expect(result.status).toBe('ready'); if (result.status !== 'ready') return;
    expect(result.data.state.entries).toContainEqual(data.state.entries[0]);
    expect(result.data.state.entries).toContainEqual(expect.objectContaining({ category: 'Pilihan pengguna', type: 'income', amount: 10000 }));
    expect(result.data.state.entries).toHaveLength(2);
  });
  it('detects changed generic references and invalidates decisions after existing annotations change', () => {
    const preview = parseGenericStatement(table(), mapping(), wallet(), []), data = ready(document(), preview);
    const changed = table(); changed.values[1][4] = 'new-reference';
    const incoming = parseGenericStatement(changed, mapping(), wallet(), data.state.entries);
    const inspection = inspectSourcedImport(data, data.state.wallets[0], incoming), id = incoming.rows[0].id;
    expect(inspection.sourceReviews[id].status).toBe('alternate-source');
    const updated = applySourcedBulkCategory(data, [data.state.entries.find(entry => entry.sourceKey === preview.rows[0].sourceKey)!.id], 'Pendidikan');
    const proposed = { ...incoming, rows: incoming.rows.map(row => ({ ...row, selected: false })) };
    expect(prepareSourcedImport(updated, updated.state.wallets[0], proposed, { [id]: { resolution: 'keep', signature: inspection.sourceReviews[id].signature } }, false, 'stale', at).status).toBe('review');
  });
  it('refuses to choose between several alternate source facts', () => {
    const { data, preview } = base();
    const fact = data.metadata!.facts[0];
    data.metadata!.facts.push({ ...fact, id: 'second', fingerprint: 'ziraat:ffffffffffffffff' });
    data.metadata!.dispositions = [{ sourceId: 'second', kind: 'excluded' }];
    const review = inspectSourcedImport(data, data.state.wallets[0], preview).sourceReviews[preview.rows[0].id];
    expect(review).toMatchObject({ status: 'identity-ambiguous', allowedResolutions: ['keep'] });
  });
  it('also reviews legacy aliases without bank facts, never assuming they are unrelated', () => {
    const preview = parseGenericStatement(table(), mapping(), wallet(), []);
    const data = document(); data.state.entries.push({ id: 'old', walletId: 'bank', type: 'income', amount: 100050, date: '2026-10-01', category: 'Manual', note: 'Edited legacy note', sourceKey: 'ziraat:ffffffffffffffff' });
    const inspection = inspectSourcedImport(data, data.state.wallets[0], preview);
    expect(inspection.sourceReviews[preview.rows[0].id]).toMatchObject({ status: 'alternate-source', allowedResolutions: ['keep', 'distinct'] });
    expect(prepareSourcedImport(data, data.state.wallets[0], preview, {}, false, 'legacy', at).status).toBe('review');
    expect(data.state.entries[0].category).toBe('Manual');
  });
  it('refuses amplified source backup capacity without mutating the old document', () => {
    const old = document(), before = JSON.stringify(old);
    const input = table([table().values[0], ...Array.from({ length: 1500 }, (_, index) => ['2026-10-01', `${index} ${'🧪'.repeat(1400)}`, '1', String(index + 1), String(index), 'EUR'])]);
    const preview = parseGenericStatement(input, mapping(), wallet(), []);
    const result = prepareSourcedImport(old, old.state.wallets[0], preview, {}, true, 'large', at);
    expect(result.status).toBe('invalid');
    expect(JSON.stringify(old)).toBe(before);
  });
});
