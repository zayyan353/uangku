import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { entriesFromImport, parseZiraatWorkbook } from './importer';
import { summaryForCurrency, walletBalance, type Entry, type Wallet } from './finance';
import { prepareSourcedImport } from './sourceCommands';
import type { SourceDocument } from './sourceModel';
import { parseBackupText, serializeBackup } from './storage';

const wallet: Wallet = { id: 'bank-semantics', name: 'Synthetic bank', currency: 'TRY', kind: 'bank', openingBalance: 10000 };
const date = '2026-10-31';
const at = '2026-10-31T10:00:00.000Z';

/** A synthetic one-row statement: no personal workbook is read by these tests. */
function workbook(description: string, signedMajorAmount = -12, reference = ' SYNTHETIC-REF '): ArrayBuffer {
  const rows: unknown[][] = [
    ['Synthetic statement'], ['Mata uang', 'TL'],
    ['Tarih', 'Fiş No', 'Açıklama', 'İşlem Tutarı', 'Bakiye'],
    ['31.10.2026', reference, description, signedMajorAmount, 100 + signedMajorAmount],
  ];
  const escape = (value: unknown) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const xml = rows.map((row, i) => `<row>${row.map((value, column) => {
    const coordinate = `${String.fromCharCode(65 + column)}${i + 1}`;
    return `<c r="${coordinate}" t="${typeof value === 'number' ? 'n' : 'str'}"><v>${escape(value)}</v></c>`;
  }).join('')}</row>`).join('');
  const bytes = zipSync({
    'xl/workbook.xml': strToU8('<workbook><workbookPr date1904="0"/></workbook>'),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${xml}</sheetData></worksheet>`),
  });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function preview(description: string, amount = -12, existing: Entry[] = []) {
  return parseZiraatWorkbook(workbook(description, amount), wallet, existing);
}

describe('bank operation interpretations in the Ziraat importer', () => {
  const fees = [
    '123 Referanslı Havale / BSMV Tahsilatı',
    '123 Referanslı Havale / Komisyonu Tahsilatı',
    'FAST gönderim / Komisyonu Tahsilatı',
  ];

  it.each(fees)('keeps a debit fee as expense instead of an unresolved transfer: %s', description => {
    const result = preview(description);
    expect(result.rows[0]).toMatchObject({ classification: 'expense', amount: -1200, balance: 8800 });
    expect(entriesFromImport(result.rows, wallet.id, 'fee')[0]).toMatchObject({ type: 'expense', amount: 1200 });
    expect(result.rows[0].warning).toBeUndefined();
    expect(result.openingBalance).toBe(10000);
    expect(result.closingBalance).toBe(8800);
  });

  it.each(fees)('keeps a credit bearing fee wording unresolved: %s', description => {
    const result = preview(description, 12);
    expect(result.rows[0]).toMatchObject({ classification: 'unreviewed', amount: 1200, balance: 11200 });
    expect(result.rows[0].warning).toContain('belum tentu pemasukan');
    expect(entriesFromImport(result.rows, wallet.id, 'fee-credit')[0]).toMatchObject({ type: 'unreviewed', amount: 1200 });
  });

  it.each([
    ['ATM PARA ÇEKME / **** 1234', -12, 'Tarik tunai'],
    ['ATM YATAN / **** 1234', 12, 'Setor tunai'],
    ['YURTİÇİ ATM P.Y. / **** 1234', 12, 'Setor tunai'],
    ['YURTICI ATM P. Y. / **** 1234', 12, 'Setor tunai'],
    ['ATM PARA YATIRMA / **** 1234', 12, 'Setor tunai'],
  ] as const)('counts ATM debit as expense and credit as income without creating a cash leg: %s', (description, amount, label) => {
    const result = preview(description, amount);
    expect(result.rows[0]).toMatchObject({ classification: amount < 0 ? 'expense' : 'income', amount: amount * 100 });
    expect(result.rows[0].warning).toContain(label);
    const entries = entriesFromImport(result.rows, wallet.id, 'atm');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: amount < 0 ? 'expense' : 'income', amount: Math.abs(amount * 100) });
    expect(entries[0].toWalletId).toBeUndefined();
    const summary = summaryForCurrency({ version: 1, wallets: [wallet], entries }, 'TRY', '2026-10');
    expect(summary).toMatchObject({ balance: wallet.openingBalance + amount * 100, income: amount > 0 ? amount * 100 : 0, expense: amount < 0 ? -amount * 100 : 0 });
    expect(result.closingBalance - result.openingBalance).toBe(amount * 100);
  });

  it.each([-12, 12])('confirms only positive PREPAID credits as income and keeps debit refunds unresolved: %s', amount => {
    const result = preview('PREPAID İADE / synthetic transaction', amount);
    expect(result.rows[0]).toMatchObject({ classification: amount > 0 ? 'income' : 'unreviewed', amount: amount * 100 });
    expect(result.rows[0].warning).toContain('Cashback');
    expect(entriesFromImport(result.rows, wallet.id, 'prepaid')[0]).toMatchObject({ type: amount > 0 ? 'income' : 'unreviewed', amount: amount * 100 });
  });

  it.each([
    'POS ALIŞVERİŞ / ALİ VELİ',
    'POS ALIŞVERİŞ / FAST FOOD',
    'POS HARCAMA / FAST FOOD',
    'SANAL POS ALIŞVERİŞ / FAST FOOD',
    'SANAL POS ALIŞVERİŞ / S/GIB HARCLAR VERGI MUTABAKAT: SYNTHETIC-REF',
  ])('does not infer a transfer from a POS merchant name: %s', description => {
    expect(preview(description).rows[0]).toMatchObject({ classification: 'expense', amount: -1200 });
  });

  it.each([
    '123 Referanslı Havale / ALİ VELİ',
    'FAST / ALİ VELİ',
    'EFT / ALİ VELİ',
    'VİRMAN / synthetic account',
  ])('confirms a bank movement without guessing a destination wallet: %s', description => {
    const result = preview(description);
    expect(result.rows[0]).toMatchObject({ classification: 'movement', amount: -1200 });
    expect(entriesFromImport(result.rows, wallet.id, 'bank-transfer')[0]).toMatchObject({ type: 'movement', amount: -1200 });
  });

  // Goldens captured with the pre-policy ziraat-v1 normalization/hash. In particular,
  // punctuation remains part of identity even though interpretation ignores it.
  it.each([
    ['  ATM PARA ÇEKME / BANKA **** 1234  ', 'ziraat:c04d773918664ded'],
    ['SANAL POS ALIŞVERİŞ / FAST FOOD **** 1234', 'ziraat:a6703b4eaee7b02a'],
  ])('retains the historical source fingerprint for %s', (description, sourceKey) => {
    const first = preview(description);
    expect(first.rows[0]).toMatchObject({ sourceKey, date, amount: -1200, balance: 8800 });
    const saved = entriesFromImport(first.rows, wallet.id, 'historical');
    const repeated = preview(description, -12, saved);
    expect(repeated.rows[0]).toMatchObject({ sourceKey, duplicate: true, selected: false });
    expect(entriesFromImport(repeated.rows, wallet.id, 'repeat')).toEqual([]);
  });

  it('preserves raw bank facts separately from preview annotations and survives backup roundtrip', () => {
    const rawDescription = '  ATM PARA ÇEKME / BANKA **** 1234  ';
    const data: SourceDocument = { app: 'uangku', version: 1, demo: false,
      state: { version: 1, wallets: [{ ...wallet }], entries: [] } };
    const before = structuredClone(data), result = preview(rawDescription);
    result.rows[0].description = 'My explicit editable memo';
    result.rows[0].category = 'My manual category';
    const proposed = prepareSourcedImport(data, wallet, result, {}, true, 'synthetic-semantics', at);
    if (proposed.status !== 'ready') throw new Error(proposed.status === 'invalid' ? proposed.message : 'Unexpected source review');
    expect(data).toEqual(before);
    const entry = proposed.data.state.entries[0], fact = proposed.data.metadata!.facts[0];
    expect(entry).toMatchObject({ type: 'expense', amount: 1200, date,
      category: 'My manual category', note: 'My explicit editable memo', sourceKey: 'ziraat:c04d773918664ded' });
    expect(fact).toMatchObject({ signedAmount: -1200, balanceAfter: 8800, postedOn: date,
      description: rawDescription, reference: ' SYNTHETIC-REF ', fingerprint: entry.sourceKey });
    expect(proposed.data.metadata!.annotations![0]).toMatchObject({ sourceId: fact.id,
      confirmedType: 'expense', category: 'My manual category', note: 'My explicit editable memo' });
    expect(walletBalance(proposed.data.state, wallet.id, proposed.data.metadata)).toBe(8800);
    expect(parseBackupText(serializeBackup(proposed.data))).toEqual(proposed.data);
  });
});
