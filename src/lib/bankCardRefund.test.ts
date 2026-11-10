import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { applyBankDecisions } from './bankDecisions';
import { confirmedBankEntryType, interpretBankDescription } from './bankDescription';
import { buildCashflowReport } from './cashflowReport';
import { BANK_CARD_REFUND_RULES, BANK_KEYWORD_PACK_7_RULES } from './categoryBankMappings';
import { defaultCategorySettings } from './categorySettings';
import { categorySuggestion, entryCategorySuggestions } from './categorySuggestions';
import { entrySignedAmount, walletBalance, type Entry, type Wallet } from './finance';
import { entriesFromImport, parseZiraatWorkbook } from './importer';
import type { SourceDocument } from './sourceModel';

/** Synthetic wording in the bank's layout. No personal statement is read. */
const card = 'KARTNO:0000 **** **** 0000';
const domestic = `SATIŞ IADE ${card} UYEISYERI:TCDD TASIMACILIK A.S PROVIZYON:000000`;
const foreign = `${card} SATIŞ YD IADE BANKA:000000  MUTABAKAT:0000000`;
const settings = () => defaultCategorySettings();
const match = (text: string, amount: number, value = settings()) =>
  categorySuggestion(text, amount < 0 ? 'expense' : 'unreviewed', value, amount);

describe('card sale refunded by its merchant', () => {
  it.each([domestic, foreign, `satış iade kart no: 0000 **** **** 0000`, `SATIŞ İADE ${card}`,
    `SATIŞ IADE ${card} UYEISYERI:FAST FOOD TRANSFER ATM SENTETIK PROVIZYON:000000`])('confirms a credit as returned money: %s', text => {
    expect(interpretBankDescription(text, { signedAmount: 2500 })).toMatchObject({ kind: 'card-refund', label: 'Pengembalian pembelian kartu', category: 'Pengembalian dana', pending: false });
    expect(confirmedBankEntryType(text, 2500)).toBe('income');
    expect(match(text, 2500)).toMatchObject({ kind: 'auto', suggestions: [{ category: 'Pengembalian dana' }] });
    expect(match(text, 2500).suggestions).toHaveLength(1);
  });
  it.each([undefined, 0, -2500, NaN, Infinity, 1.5])('does not confirm an absent or invalid credit direction %s', amount => {
    expect(interpretBankDescription(domestic, { signedAmount: amount })).toMatchObject({ kind: 'card-refund', pending: true });
    expect(confirmedBankEntryType(domestic, amount as number)).toBeUndefined();
    if (amount !== undefined) expect(match(domestic, amount).kind).not.toBe('auto');
  });
  it.each(['İPTAL', 'IPTALI', 'REVERSAL', 'POS ALIŞVERİŞ', 'POS HARCAMA'])('does not confirm a cancelled or contradicting refund: %s', suffix => {
    expect(confirmedBankEntryType(`${domestic} ${suffix}`, 2500)).toBeUndefined();
    expect(match(`${domestic} ${suffix}`, 2500).kind).not.toBe('auto');
  });
  it.each(['SATIŞ IADE', 'SATIŞ IADE UYEISYERI:SENTETIK', `IADE ${card}`, `SATIŞ IADESİ ${card}`, `SATIŞ YURTDIŞI IADE ${card}`,
    `HAVALE IADE ${card}`, 'ISYERI IADE', `SATIŞ ${card} IADE`])('keeps any other refund wording unresolved: %s', text => {
    expect(interpretBankDescription(text, { signedAmount: 2500 }).kind).not.toBe('card-refund');
    expect(confirmedBankEntryType(text, 2500)).toBeUndefined();
    expect(match(text, 2500).kind).not.toBe('auto');
  });
  it('keeps the earlier conventions ahead of it and leaves a mapped generic statement alone', () => {
    expect(interpretBankDescription(`PREPAID İADE ${domestic}`, { signedAmount: 2500 }).kind).toBe('cashback');
    expect(interpretBankDescription(`ATM PARA ÇEKME ${domestic}`, { signedAmount: 2500 }).kind).toBe('atm-withdrawal');
    expect(interpretBankDescription(domestic, { signedAmount: 2500, fingerprintVersion: 'generic-v1' }).kind).toBe('none');
    expect(confirmedBankEntryType(domestic, 2500, 'generic-v1')).toBeUndefined();
  });
});

describe('refund category rules', () => {
  it('ships two bundled v7 identities gated to the confirmed refund', () => {
    expect(BANK_CARD_REFUND_RULES.map(rule => [rule.id, rule.keyword, rule.category, rule.mode])).toEqual([
      ['bank-v7-card-refund', 'SATIŞ IADE', 'Pengembalian dana', 'auto'], ['bank-v7-card-refund-foreign', 'SATIŞ YD IADE', 'Pengembalian dana', 'auto']]);
    expect(BANK_KEYWORD_PACK_7_RULES).toEqual(expect.arrayContaining([...BANK_CARD_REFUND_RULES]));
    expect(match('SATIŞ IADE', 2500).kind).toBe('none');
    expect(match(domestic, -2500).suggestions.map(row => row.category)).toEqual(['Transportasi']);
  });
  it('lets the refund outrank an untouched merchant default but not a personal rule', () => {
    expect(match(domestic, 2500).suggestions.map(row => row.category)).toEqual(['Pengembalian dana']);
    const value = settings(); value.names.push('Pribadi');
    value.rules.push({ id: 'my-train', keyword: 'TCDD', category: 'Pribadi', mode: 'auto' });
    expect(match(domestic, 2500, value).kind).toBe('suggestions');
    expect(match(domestic, 2500, value).suggestions.map(row => row.category).sort()).toEqual(['Pengembalian dana', 'Pribadi']);
    const edited = settings(); edited.names.push('Pribadi');
    edited.rules = edited.rules.map(rule => rule.id === 'bank-v7-card-refund' ? { ...rule, category: 'Pribadi', mode: 'suggest' } : rule);
    expect(match(domestic, 2500, edited).kind).toBe('suggestions');
  });
  it('does not revive an inactive target category', () => {
    const value = settings(); value.names = value.names.filter(name => name !== 'Pengembalian dana');
    expect(match(foreign, 2500, value).kind).toBe('none');
    expect(match(domestic, 2500, value).kind).not.toBe('auto');
  });
});

describe('import, saved history and cashflow', () => {
  const wallet: Wallet = { id: 'bank-refund', name: 'Synthetic bank', currency: 'TRY', kind: 'bank', openingBalance: 0 };
  function workbook(rows: [string, number, number][]): ArrayBuffer {
    const data: unknown[][] = [['Synthetic statement'], ['Mata uang', 'TL'], ['Tarih', 'Fiş No', 'Açıklama', 'İşlem Tutarı', 'Bakiye'],
      ...rows.map(([description, amount, balance], index) => ['02.11.2026', `F0000${index}`, description, amount, balance])];
    const xml = data.map(row => `<row>${row.map(value => `<c t="${typeof value === 'number' ? 'n' : 'str'}"><v>${value}</v></c>`).join('')}</row>`).join('');
    const bytes = zipSync({ 'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${xml}</sheetData></worksheet>`) });
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
  it('imports a refund credit as income and keeps a debit with the same wording unresolved', () => {
    const preview = parseZiraatWorkbook(workbook([[foreign, 120, 645], [domestic, 25, 525], [domestic, -40, 500]]), wallet, []);
    expect(preview.rows.map(row => row.classification)).toEqual(['income', 'income', 'unreviewed']);
    expect(preview.rows[0].warning).toContain('Pengembalian dana');
    expect(preview.rows[2].warning).toContain('Periksa');
    expect(preview).toMatchObject({ openingBalance: 54000, closingBalance: 64500 });
    const entries = entriesFromImport(preview.rows, wallet.id, 'refund');
    expect(entries.map(entry => [entry.type, entry.amount])).toEqual([['income', 12000], ['income', 2500], ['unreviewed', -4000]]);
    expect(walletBalance({ version: 1, wallets: [{ ...wallet, openingBalance: preview.openingBalance }], entries }, wallet.id)).toBe(preview.closingBalance);
  });

  const entry = (id: string, amount: number, type: Entry['type'], note: string): Entry =>
    ({ id, amount, type, note, date: '2026-10-10', walletId: 'bank', category: 'Belum dikategorikan' });
  const document = (entries: Entry[]): SourceDocument => ({ app: 'uangku', version: 1, demo: false, state: { version: 1,
    wallets: [{ id: 'bank', name: 'Synthetic bank', currency: 'TRY', kind: 'bank', openingBalance: 500000 }], entries } });
  it.each([[domestic, 2500, 'refund'], [foreign, 12000, 'refund'], [domestic, -2500, 'other']] as const)('groups %s (%s) as %s', (description, amount, id) => {
    const report = buildCashflowReport(document([entry('row', amount, 'unreviewed', description)]),
      { currency: 'TRY', month: '2026-10', today: '2026-10-31', period: 'month' });
    expect(report.breakdown).toEqual([{ id, label: expect.any(String), inflow: amount > 0 ? amount : 0, outflow: amount < 0 ? -amount : 0, entryCount: 1 }]);
  });
  it('proposes an old unresolved refund and applies it without moving money', () => {
    const source = document([entry('refund', 2500, 'unreviewed', domestic), entry('manual', 12000, 'unreviewed', foreign)]);
    source.state.entries[1].category = 'Kategori pribadi';
    const proposal = entryCategorySuggestions(source, settings());
    expect(proposal.map(row => [row.entry.id, row.confirmation, row.match.suggestions[0].category])).toEqual([
      ['refund', 'income', 'Pengembalian dana'], ['manual', 'income', 'Kategori pribadi']]);
    const next = applyBankDecisions(source, [{ entryId: 'refund', category: 'Pengembalian dana', confirmBankType: true }]);
    expect(next.state.entries).toMatchObject([{ id: 'refund', type: 'income', amount: 2500, category: 'Pengembalian dana', note: domestic },
      { id: 'manual', type: 'unreviewed', amount: 12000, category: 'Kategori pribadi' }]);
    expect(next.state.entries.map(entrySignedAmount)).toEqual(source.state.entries.map(entrySignedAmount));
    expect(walletBalance(next.state, 'bank')).toBe(walletBalance(source.state, 'bank'));
  });
});
