import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { summaryForCurrency, walletBalance, type Entry, type Wallet } from './finance';
import { entriesFromImport, parseZiraatWorkbook } from './importer';

/** Synthetic wording in the bank's layout. No personal statement is read. */
const wallet: Wallet = { id: 'bank-voucher', name: 'Synthetic bank', currency: 'TRY', kind: 'bank', openingBalance: 0 };
const cut = 'SENTETIK PENGIRIM SENTETIK PENGIRIM SENTETIK PENERIMA ELEKTRONIK ANONIM SENTETIK PENERIMA ELEKTRONIK ANONIM SIRKETI Ziraa';
const whole = ' SENTETIK PENGIRIM SENTETIK PENERIMA Ziraat Mobil Havale';
const tax = '0000SYNT00000000 Referanslı Havale - BSMV Tahsilatı ';
const commission = '0000SYNT00000000 Referanslı Havale Komisyonu Tahsilatı ';
type Row = [date: string, voucher: string, description: string, amount: number];

/** Rows are given newest first, as the bank exports them; amounts in major units. */
function preview(rows: Row[], order: 'newest' | 'oldest' = 'newest', existing: Entry[] = []) {
  let balance = 1000 + rows.reduce((sum, row) => sum + row[3], 0);
  const body = rows.map(([date, voucher, description, amount]) => {
    const line = [date, voucher, description, amount, Math.round(balance * 100) / 100];
    balance -= amount;
    return line;
  });
  const data: unknown[][] = [['Synthetic statement'], ['Mata uang', 'TL'], ['Tarih', 'Fiş No', 'Açıklama', 'İşlem Tutarı', 'Bakiye'],
    ...(order === 'newest' ? body : body.reverse())];
  const xml = data.map(row => `<row>${row.map(value => `<c t="${typeof value === 'number' ? 'n' : 'str'}"><v>${value}</v></c>`).join('')}</row>`).join('');
  const bytes = zipSync({ 'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${xml}</sheetData></worksheet>`) });
  return parseZiraatWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, wallet, existing);
}
const fees = (voucher: string, date = '02.11.2026'): Row[] => [[date, voucher, tax, -0.13], [date, voucher, commission, -2.5]];
const principal = (result: ReturnType<typeof preview>) => result.rows.find(row => row.description === cut)!;

describe('a transfer whose wording the bank cut before its operation word', () => {
  it.each(['newest', 'oldest'] as const)('is the transfer its fee rows name on the same voucher and date (%s first)', order => {
    const result = preview([...fees('F00010'), ['02.11.2026', 'F00010', cut, -300], ['01.11.2026', 'F00009', 'POS ALIŞVERİŞ İŞYERİ: SENTETIK MUTABAKAT: 0000000', -40]], order);
    expect(principal(result)).toMatchObject({ classification: 'movement', amount: -30000, warning: undefined });
    expect(principal(result).inference).toContain('pokok transfer');
    expect(result.rows.filter(row => row.inference)).toHaveLength(1);
    expect(result.rows.filter(row => row.description !== cut).map(row => row.classification)).toEqual(['expense', 'expense', 'expense']);
    const entries = entriesFromImport(result.rows, wallet.id, 'voucher');
    expect(entries.find(entry => entry.note === cut)).toMatchObject({ type: 'movement', amount: -30000 });
    const state = { version: 1 as const, wallets: [{ ...wallet, openingBalance: result.openingBalance }], entries };
    expect(walletBalance(state, wallet.id)).toBe(result.closingBalance);
    expect(result).toMatchObject({ openingBalance: 100000, closingBalance: 100000 - 34263 });
    expect(summaryForCurrency(state, 'TRY', '2026-11').expense).toBe(4263);
  });
  it('leaves a transfer the bank worded in full exactly as before', () => {
    const result = preview([...fees('F00010'), ['02.11.2026', 'F00010', whole, -300]]);
    expect(result.rows[2]).toMatchObject({ classification: 'movement', amount: -30000 });
    expect(result.rows.some(row => row.inference)).toBe(false);
    expect(result.rows[2].warning).toContain('Transfer');
  });
  it.each([
    ['no fee row names it', [['02.11.2026', 'F00010', cut, -300]]],
    ['the fee rows carry another voucher', [...fees('F00011'), ['02.11.2026', 'F00010', cut, -300]]],
    ['the fee rows carry the voucher on another date', [...fees('F00010', '03.11.2026'), ['02.11.2026', 'F00010', cut, -300]]],
    ['a second unknown row shares the voucher', [...fees('F00010'), ['02.11.2026', 'F00010', 'SENTETIK LAIN', -20], ['02.11.2026', 'F00010', cut, -300]]],
    ['a recognised operation shares the voucher', [...fees('F00010'), ['02.11.2026', 'F00010', whole, -50], ['02.11.2026', 'F00010', cut, -300]]],
    ['a fee credit shares the voucher', [['02.11.2026', 'F00010', tax, 0.13], ...fees('F00010'), ['02.11.2026', 'F00010', cut, -300]]],
  ] as [string, Row[]][])('stays an uncategorised expense when %s', (_, rows) => {
    const result = preview(rows);
    expect(principal(result)).toMatchObject({ classification: 'expense', amount: -30000 });
    expect(result.rows.some(row => row.inference)).toBe(false);
  });
  it('never turns a credit or an already doubtful row into a transfer', () => {
    const credit = preview([...fees('F00010'), ['02.11.2026', 'F00010', cut, 300]]);
    expect(principal(credit)).toMatchObject({ classification: 'unreviewed', amount: 30000 });
    const doubtful = preview([...fees('F00010'), ['02.11.2026', 'F00010', 'SENTETIK NAKIT', -300]]);
    expect(doubtful.rows[2]).toMatchObject({ classification: 'unreviewed', amount: -30000 });
    expect([...credit.rows, ...doubtful.rows].some(row => row.inference)).toBe(false);
  });
  it('keeps the bank facts unchanged and still detects a repeated import', () => {
    const rows: Row[] = [...fees('F00010'), ['02.11.2026', 'F00010', cut, -300]];
    const first = preview(rows);
    expect(principal(first)).toMatchObject({ description: cut, originalDescription: cut, reference: 'F00010', date: '2026-11-02', amount: -30000, balance: 70000 });
    const again = preview(rows, 'newest', entriesFromImport(first.rows, wallet.id, 'first'));
    expect(again.rows.map(row => row.sourceKey)).toEqual(first.rows.map(row => row.sourceKey));
    expect(again.rows.every(row => row.duplicate && !row.selected)).toBe(true);
    expect(entriesFromImport(again.rows, wallet.id, 'again')).toEqual([]);
  });
});
