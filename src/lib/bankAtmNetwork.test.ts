import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { applyBankDecisions } from './bankDecisions';
import { confirmedBankEntryType, interpretBankDescription } from './bankDescription';
import { mergeCurrentAutomaticBankMappings } from './bankAutoMappings';
import { buildCashflowReport } from './cashflowReport';
import {
  BANK_ATM_FEE_RULES, BANK_ATM_NETWORK_RULES, BANK_ATM_NETWORK_WITHDRAWAL_RULES, BANK_OPERATION_FEE_RULE,
} from './categoryBankMappings';
import { defaultCategorySettings, validateCategorySettings, type CategorySettings } from './categorySettings';
import { upgradeCategorySettings } from './categorySettingsUpgrade';
import { categorySuggestion, entryCategorySuggestions } from './categorySuggestions';
import { entrySignedAmount, walletBalance, type Entry, type Wallet } from './finance';
import { entriesFromImport, parseZiraatWorkbook } from './importer';
import type { SourceDocument } from './sourceModel';

/** Synthetic wording in the bank's layout. No personal statement is read. */
const card = 'KART NO:0000 **** **** 0000';
const withdrawal = `YURTİÇİ ATM P.Ç. ${card} BANKA : 0000000000 PROVIZYON KODU: 000000 MUTABAKAT: 0000000`;
const withdrawalCompact = `YURTİÇİ ATM P.Ç. ${card} BANKA: 0000000000 PROVİZYON KODU:000000 MUTABAKAT:000000000000 `;
const withdrawalCommission = `${withdrawal} KOMİSYON: 6,30`;
const withdrawalTax = 'YURTİÇİ ATM P.Ç. BSMV';
const qr = 'ATM QR ILE PARA ÇEKME HESAP NO:0000 **** **** 0000 ATM: Z0000000 JOURNAL NO:00';
const deposit = `YURTİÇİ ATM P.Y. ${card} BANKA : 0000000000 MUTABAKAT: 0000000 KOMİSYON: 18,90`;
const depositTax = 'YURTİÇİ ATM P.Y. BSMV';
const operationFee = 'İşlem Toplam Masrafı';

const settings = () => defaultCategorySettings();
const match = (text: string, amount: number, value = settings()) =>
  categorySuggestion(text, amount < 0 ? 'expense' : 'unreviewed', value, amount);
function v5(): CategorySettings {
  const value = settings();
  return { ...value, keywordPackVersion: 5, rules: value.rules.filter(rule => !rule.id.startsWith('bank-v6-')) };
}

describe('withdrawals at another bank\'s ATM and by QR', () => {
  it.each([withdrawal, withdrawalCompact, 'yurtici atm p.c.', 'YURTİÇİ ATM P. Ç. REF 123', qr,
    'ATM QR İLE PARA ÇEKME HESAP NO:0000000000000000 ATM: Z0000000 JOURNAL NO:0000'])('confirms a debit as the approved ATM expense: %s', text => {
    expect(interpretBankDescription(text, { signedAmount: -20000 })).toMatchObject({ kind: 'atm-withdrawal', label: 'Tarik tunai ATM', category: 'Tarik tunai', pending: false });
    expect(confirmedBankEntryType(text, -20000)).toBe('expense');
    expect(match(text, -20000)).toMatchObject({ kind: 'auto', suggestions: [{ category: 'Tarik tunai' }] });
  });
  it.each([withdrawal, qr])('stays pending without a debit direction: %s', text => {
    expect(interpretBankDescription(text)).toMatchObject({ kind: 'atm-withdrawal', pending: true });
    for (const amount of [20000, 0, NaN, 1.5]) {
      expect(interpretBankDescription(text, { signedAmount: amount })).toMatchObject({ kind: 'atm-withdrawal', pending: true });
      expect(confirmedBankEntryType(text, amount)).toBeUndefined();
    }
    expect(match(text, 20000).kind).not.toBe('auto');
  });
  it.each(['IADE', 'İPTAL', 'REVERSAL', 'ATM YATAN', 'YURTİÇİ ATM P.Y.'])('does not confirm a reversal or contradicting operation: %s', suffix => {
    for (const text of [`${withdrawal} ${suffix}`, `${qr} ${suffix}`]) {
      expect(confirmedBankEntryType(text, -20000)).toBeUndefined();
      expect(match(text, -20000).kind).not.toBe('auto');
    }
  });
  it.each(['YURTİÇİ ATM P.ÇEKİM', 'YURTİÇİ ATM PÇ', 'ATM QR PARA ÇEKME', 'ATM QR ILE PARA ÇEKMEK', 'QR ILE PARA ÇEKME'])('requires the exact bank phrase: %s', text => {
    expect(interpretBankDescription(text, { signedAmount: -20000 }).kind).toBe('none');
    expect(match(text, -20000).kind).toBe('none');
  });
  it('leaves a mapped generic statement to its own complete-memo rule', () => {
    for (const text of [withdrawal, qr, withdrawalTax, 'YURTİÇİ ATM P.Ç.']) {
      expect(interpretBankDescription(text, { signedAmount: -20000, fingerprintVersion: 'generic-v1' }).kind).toBe('none');
      expect(confirmedBankEntryType(text, -20000, 'generic-v1')).toBeUndefined();
    }
  });
});

describe('separate commission and BSMV rows of another bank\'s ATM', () => {
  it.each([
    [withdrawalTax, -5], [depositTax, -15],
    [withdrawalCommission, -625], // 6,25 commission + 0,05 BSMV = the stated 6,30
    [withdrawalCommission, -630], [deposit, -1875], [deposit, -1890],
    [`${withdrawal} KOMİSYON: 7`, -700], [`${withdrawal} KOMİSYON: 6,5`, -650], [`${withdrawal} KOMİSYON: 1.234,56`, -123400],
    [`${withdrawal} komisyon : 6,30.`, -625],
  ] as const)('records a debit fee as a Biaya bank expense: %s (%s)', (text, amount) => {
    expect(interpretBankDescription(text, { signedAmount: amount })).toMatchObject({ kind: 'atm-fee', label: 'Biaya ATM', category: 'Biaya bank', pending: false });
    expect(confirmedBankEntryType(text, amount)).toBe('expense');
    expect(match(text, amount)).toMatchObject({ kind: 'auto', suggestions: [{ category: 'Biaya bank' }] });
  });
  it('keeps the principal apart from its commission row although both carry the same wording', () => {
    expect(interpretBankDescription(withdrawalCommission, { signedAmount: -40000 })).toMatchObject({ kind: 'atm-withdrawal', pending: false });
    expect(match(withdrawalCommission, -40000)).toMatchObject({ kind: 'auto', suggestions: [{ category: 'Tarik tunai' }] });
    expect(interpretBankDescription(deposit, { signedAmount: 150000 })).toMatchObject({ kind: 'atm-deposit', pending: false });
    expect(confirmedBankEntryType(deposit, 150000)).toBe('income');
    expect(categorySuggestion(deposit, 'income', settings(), 150000)).toMatchObject({ kind: 'auto', suggestions: [{ category: 'Setor tunai' }] });
  });
  it('does not turn a deposit-side debit above the stated commission into a fee or income', () => {
    expect(interpretBankDescription(deposit, { signedAmount: -150000 })).toMatchObject({ kind: 'atm-deposit', pending: true });
    expect(confirmedBankEntryType(deposit, -150000)).toBeUndefined();
    expect(match(deposit, -150000).kind).not.toBe('auto');
  });
  it.each(['KOMİSYON: 6,299', 'KOMİSYON: 6.5', 'KOMİSYON: 0', 'KOMİSYON:', 'KOMİSYON 6,30', 'KOMİSYONU: 6,30'])('does not read a fee from malformed wording: %s', label => {
    expect(interpretBankDescription(`${withdrawal} ${label}`, { signedAmount: -600 })).toMatchObject({ kind: 'atm-withdrawal', pending: false });
  });
  it('needs the debited amount to tell a commission row from its principal', () => {
    expect(interpretBankDescription(withdrawalCommission)).toMatchObject({ kind: 'atm-withdrawal', pending: true });
    expect(interpretBankDescription(withdrawalTax)).toMatchObject({ kind: 'atm-fee', pending: false });
  });
  it.each([withdrawalTax, depositTax])('keeps a credit bearing fee wording unresolved: %s', text => {
    expect(confirmedBankEntryType(text, 15)).toBeUndefined();
    expect(match(text, 15).kind).not.toBe('auto');
  });
  it.each(['IADE', 'İPTAL'])('does not confirm a reversed fee: %s', suffix => {
    expect(confirmedBankEntryType(`${withdrawalTax} ${suffix}`, -5)).toBeUndefined();
    expect(match(`${withdrawalTax} ${suffix}`, -5).kind).not.toBe('auto');
  });
  it('does not mistake a card merchant or another operation for an ATM fee', () => {
    expect(interpretBankDescription(`POS ALIŞVERİŞ ${card} İŞYERİ: YURTİÇİ ATM P.Ç. BSMV`, { signedAmount: -5 }).kind).not.toBe('atm-fee');
    expect(interpretBankDescription('ATM PARA ÇEKME KOMİSYON: 6,30', { signedAmount: -625 })).toMatchObject({ kind: 'atm-withdrawal' });
    expect(interpretBankDescription('BSMV', { signedAmount: -5 }).kind).toBe('none');
  });
  it('records the bank\'s total transaction charge as a bank fee', () => {
    expect(match(operationFee, -7500)).toMatchObject({ kind: 'auto', suggestions: [{ category: 'Biaya bank' }] });
    expect(match('İŞLEM TOPLAM MASRAFI', -7500)).toMatchObject({ kind: 'auto', suggestions: [{ category: 'Biaya bank' }] });
    expect(match('İşlem Toplam', -7500).kind).toBe('none');
  });
});

describe('bundled ATM rules stay literal and personal choices win', () => {
  it('applies the bundled commission keyword to ATM fee rows only', () => {
    expect(match('KOMİSYON', -625).kind).toBe('none');
    expect(match('SENTETIK KOMİSYON: 6,30', -625).kind).toBe('none');
    expect(match('KOMİSYON TUTARI', -625).suggestions.map(row => row.reason)).toEqual(['Cocok dengan aturan “KOMISYON TUTARI”.']);
    expect(match('EFT KOMİSYON TAHSİLATI', -625).suggestions.map(row => row.reason)).toEqual(['Cocok dengan aturan “KOMİSYON TAHSİLATI”.']);
  });
  it('turns an edited rule into an ordinary personal rule without discarding it', () => {
    const value = settings(); value.names.push('Pribadi');
    value.rules = value.rules.map(rule => rule.id === 'bank-v6-atm-domestic-withdrawal' ? { ...rule, category: 'Pribadi', mode: 'suggest' } : rule);
    expect(match(withdrawal, -20000, value)).toMatchObject({ kind: 'suggestions', suggestions: [{ category: 'Pribadi' }] });
    expect(match(withdrawalTax, -5, value).suggestions.map(row => row.category).sort()).toEqual(['Biaya bank', 'Pribadi']);
    expect(match(withdrawalTax, -5, value).kind).toBe('suggestions');
  });
  it('keeps a personal merchant suggestion from being overridden', () => {
    const value = settings(); value.names.push('Pribadi');
    value.rules.push({ id: 'my-atm', keyword: 'ATM', category: 'Pribadi', mode: 'suggest' });
    expect(match(withdrawal, -20000, value).kind).toBe('suggestions');
    expect(match(withdrawalTax, -5, value).kind).toBe('suggestions');
  });
  it('does not revive an inactive target category', () => {
    const value = settings(); value.names = value.names.filter(name => !['Tarik tunai', 'Biaya bank'].includes(name));
    for (const [text, amount] of [[withdrawal, -20000], [qr, -20000], [withdrawalTax, -5], [operationFee, -7500]] as const) {
      expect(match(text, amount, value).kind).toBe('none');
    }
  });
});

describe('v6 non-destructive ATM pack', () => {
  it('defines six bundled identities for active default categories', () => {
    expect(BANK_ATM_NETWORK_RULES).toEqual([...BANK_ATM_NETWORK_WITHDRAWAL_RULES, ...BANK_ATM_FEE_RULES, BANK_OPERATION_FEE_RULE]);
    expect(BANK_ATM_NETWORK_RULES).toHaveLength(6);
    expect(BANK_ATM_NETWORK_RULES.every(rule => rule.id.startsWith('bank-v6-') && rule.mode === 'auto')).toBe(true);
    expect(settings().rules.slice(-6)).toEqual(BANK_ATM_NETWORK_RULES);
    expect(settings().keywordPackVersion).toBe(6);
  });
  it('adds only the six rules to a v5 catalog, retaining v5 deletions, edits, names and order', () => {
    const source = v5(); source.rules = source.rules.filter(rule => rule.id !== 'bank-v5-atm-problem-refund');
    source.rules.find(rule => rule.id === 'bank-v5-card-purchase')!.mode = 'suggest';
    const before = JSON.stringify(source), result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.added).toBe(6); expect(result.updated ?? 0).toBe(0);
    expect(result.settings.keywordPackVersion).toBe(6); expect(result.settings.names).toEqual(source.names);
    expect(result.settings.rules.slice(0, source.rules.length)).toEqual(source.rules);
    expect(result.settings.rules.slice(source.rules.length)).toEqual(BANK_ATM_NETWORK_RULES);
    expect(result.settings.rules.some(rule => rule.id === 'bank-v5-atm-problem-refund')).toBe(false);
    expect(JSON.stringify(source)).toBe(before);
  });
  it('retains v6 deletions and mode edits on every later reload', () => {
    const source = settings(); source.rules = source.rules.filter(rule => rule.id !== 'bank-v6-atm-commission');
    source.rules.find(rule => rule.id === 'bank-v6-atm-qr-withdrawal')!.mode = 'suggest';
    expect(upgradeCategorySettings(source).settings).toBe(source);
    expect(upgradeCategorySettings(source).added).toBe(0);
  });
  it('respects occupied IDs, personal keywords and inactive targets', () => {
    const source = v5(); source.names = source.names.filter(name => name !== 'Tarik tunai');
    source.rules.push({ id: 'my-commission', keyword: 'komisyon', category: 'Biaya bank', mode: 'suggest' });
    source.rules.push({ id: 'bank-v6-operation-fee', keyword: 'PERSONAL DIFFERENT', category: 'Biaya bank', mode: 'suggest' });
    const before = JSON.stringify(source.rules), result = upgradeCategorySettings(source);
    expect(result.error).toBe(''); expect(result.added).toBe(2);
    expect(JSON.stringify(result.settings.rules.slice(0, source.rules.length))).toBe(before);
    expect(result.settings.rules.slice(source.rules.length).map(rule => rule.id)).toEqual(['bank-v6-atm-withdrawal-tax', 'bank-v6-atm-deposit-tax']);
    expect(result.settings.names).toEqual(source.names);
  });
  it('uses a personal display-case label as the rule target', () => {
    const source = v5(); source.names = source.names.map(name => name === 'Tarik tunai' ? 'TARIK TUNAI' : name);
    source.rules = source.rules.map(rule => rule.category === 'Tarik tunai' ? { ...rule, category: 'TARIK TUNAI' } : rule);
    const result = upgradeCategorySettings(source);
    expect(result.settings.names).toEqual(source.names);
    expect(result.settings.rules.filter(rule => rule.id.startsWith('bank-v6-atm-') && rule.id.endsWith('-withdrawal')).map(rule => rule.category)).toEqual(['TARIK TUNAI', 'TARIK TUNAI']);
    expect(match(withdrawal, -20000, result.settings)).toMatchObject({ kind: 'auto', suggestions: [{ category: 'TARIK TUNAI' }] });
  });
  it('rolls back the entire proposal if the rule limit cannot admit it', () => {
    const source = v5();
    while (source.rules.length < 196) source.rules.push({ id: `personal-${source.rules.length}`, keyword: `PERSONAL ${source.rules.length}`, category: 'Belanja', mode: 'suggest' });
    const before = JSON.stringify(source), result = upgradeCategorySettings(source);
    expect(result.error).toMatch(/200/); expect(result.settings).toBe(source); expect(result.added).toBe(0);
    expect(JSON.stringify(source)).toBe(before); expect(source.keywordPackVersion).toBe(5);
  });
  it('marks a v5 catalog current without adding rules for categories it does not have', () => {
    const source: CategorySettings = { version: 1, keywordPackVersion: 5, names: ['Belum dikategorikan', 'Kategori pribadi'], rules: [] };
    const result = upgradeCategorySettings(source);
    expect(result).toMatchObject({ added: 0, error: '' });
    expect(result.settings).toEqual({ ...source, keywordPackVersion: 6 });
  });
  it('re-adds missing ATM defaults only on the explicit action, keeping personal edits', () => {
    const source = settings(); source.rules = source.rules.filter(rule => rule.id !== 'bank-v6-atm-qr-withdrawal');
    source.rules.find(rule => rule.id === 'bank-v6-atm-domestic-withdrawal')!.mode = 'suggest';
    const before = JSON.stringify(source.rules), result = mergeCurrentAutomaticBankMappings(source);
    expect(result).toMatchObject({ added: 1, updated: 0 });
    expect(JSON.stringify(result.settings.rules.slice(0, source.rules.length))).toBe(before);
    expect(result.settings.rules.at(-1)).toEqual(BANK_ATM_NETWORK_WITHDRAWAL_RULES[1]);
  });
  it('accepts every historical marker and rejects a future one', () => {
    for (const marker of [1, 2, 3, 4, 5, 6] as const) expect(validateCategorySettings({ ...v5(), keywordPackVersion: marker }).keywordPackVersion).toBe(marker);
    expect(() => validateCategorySettings({ ...v5(), keywordPackVersion: 7 })).toThrow(/paket/);
  });
});

describe('Ziraat import of another bank\'s ATM operations', () => {
  const wallet: Wallet = { id: 'bank-atm', name: 'Synthetic bank', currency: 'TRY', kind: 'bank', openingBalance: 0 };
  // Newest first, as the bank exports it; balances are in minor units.
  const rows: [string, number, string, string][] = [
    ['05.11.2026', -25000, qr, 'Tarik tunai'],
    ['04.11.2026', -7500, operationFee, 'Biaya bank'],
    ['03.11.2026', -15, depositTax, 'Biaya bank'],
    ['03.11.2026', -1875, deposit, 'Biaya bank'],
    ['03.11.2026', 150000, deposit, 'Setor tunai'],
    ['02.11.2026', -5, withdrawalTax, 'Biaya bank'],
    ['02.11.2026', -625, withdrawalCommission, 'Biaya bank'],
    ['02.11.2026', -40000, withdrawal, 'Tarik tunai'],
  ];
  const net = rows.reduce((sum, row) => sum + row[1], 0);
  function workbook(): ArrayBuffer {
    let balance = 50000 + net;
    const data: unknown[][] = [['Synthetic statement'], ['Mata uang', 'TL'], ['Tarih', 'Fiş No', 'Açıklama', 'İşlem Tutarı', 'Bakiye'],
      ...rows.map(([date, amount, description], index) => {
        const row = [date, `F0000${index}`, description, amount / 100, balance / 100];
        balance -= amount;
        return row;
      })];
    const escape = (value: unknown) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const xml = data.map(row => `<row>${row.map(value => `<c t="${typeof value === 'number' ? 'n' : 'str'}"><v>${escape(value)}</v></c>`).join('')}</row>`).join('');
    const bytes = zipSync({ 'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${xml}</sheetData></worksheet>`) });
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  it('confirms every row without leaving a type to review and keeps the bank balance', () => {
    const preview = parseZiraatWorkbook(workbook(), wallet, []);
    expect(preview.rows.map(row => row.classification)).toEqual(['expense', 'expense', 'expense', 'expense', 'income', 'expense', 'expense', 'expense']);
    expect(preview.rows.map(row => row.amount)).toEqual(rows.map(row => row[1]));
    expect(preview.warnings.some(warning => warning.includes('Perlu ditinjau'))).toBe(false);
    expect(net).toBe(74980);
    expect(preview).toMatchObject({ openingBalance: 50000, closingBalance: 124980, period: { start: '2026-11-02', end: '2026-11-05' } });
    const entries = entriesFromImport(preview.rows, wallet.id, 'atm-network');
    expect(entries.map(entry => entry.type)).toEqual(preview.rows.map(row => row.classification));
    expect(entries.every(entry => entry.amount > 0 && entry.toWalletId === undefined)).toBe(true);
    expect(walletBalance({ version: 1, wallets: [{ ...wallet, openingBalance: preview.openingBalance }], entries }, wallet.id)).toBe(preview.closingBalance);
  });
  it('fills each category from the bundled rules and words the fee rows as fees', () => {
    const preview = parseZiraatWorkbook(workbook(), wallet, []);
    const categories = preview.rows.map(row => {
      const result = categorySuggestion(row.originalDescription!, row.classification as Entry['type'], settings(), row.amount, row.fingerprintVersion);
      return result.kind === 'auto' ? result.suggestions[0].category : result.kind;
    });
    expect(categories).toEqual(rows.map(row => row[3]));
    expect(preview.rows[0].warning).toContain('Tarik tunai');
    expect(preview.rows[7].warning).toContain('Tarik tunai');
    expect(preview.rows[4].warning).toContain('Setor tunai');
    for (const index of [1, 2, 3, 5, 6]) expect(preview.rows[index].warning).toBeUndefined();
  });
  it('still detects a repeated import of the same rows', () => {
    const first = parseZiraatWorkbook(workbook(), wallet, []);
    const again = parseZiraatWorkbook(workbook(), wallet, entriesFromImport(first.rows, wallet.id, 'first'));
    expect(again.rows.every(row => row.duplicate && !row.selected)).toBe(true);
  });
});

describe('saved history and the account cashflow breakdown', () => {
  const entry = (id: string, amount: number, type: Entry['type'], note: string): Entry =>
    ({ id, amount, type, note, date: '2026-10-10', walletId: 'bank', category: 'Belum dikategorikan' });
  const document = (entries: Entry[]): SourceDocument => ({ app: 'uangku', version: 1, demo: false, state: { version: 1,
    wallets: [{ id: 'bank', name: 'Synthetic bank', currency: 'TRY', kind: 'bank', openingBalance: 500000 }], entries } });

  it.each([
    [withdrawal, -20000, 'atm-withdrawal'], [qr, -20000, 'atm-withdrawal'], [withdrawal, 20000, 'other'],
    [`${qr} İPTAL`, -20000, 'other'], [withdrawalTax, -5, 'fees'], [depositTax, -15, 'fees'],
    [withdrawalCommission, -625, 'fees'], [deposit, -1875, 'fees'], [deposit, 150000, 'atm-deposit'],
    [operationFee, -7500, 'fees'], [withdrawalTax, 5, 'other'], [operationFee, 7500, 'other'],
  ] as const)('groups %s (%s) as %s', (description, amount, id) => {
    const report = buildCashflowReport(document([entry('row', amount, 'unreviewed', description)]),
      { currency: 'TRY', month: '2026-10', today: '2026-10-31', period: 'month' });
    expect(report.breakdown).toEqual([{ id, label: expect.any(String), inflow: amount > 0 ? amount : 0, outflow: amount < 0 ? -amount : 0, entryCount: 1 }]);
    expect(report.difference).toBe(0);
  });

  it('proposes the type and category of an old unresolved QR withdrawal and applies them without moving money', () => {
    const source = document([entry('qr', -25000, 'unreviewed', qr), entry('fee', 625, 'expense', withdrawalCommission),
      entry('manual', 40000, 'expense', withdrawal)]);
    source.state.entries[2].category = 'Kategori pribadi';
    const proposal = entryCategorySuggestions(source, settings());
    expect(proposal.map(row => [row.entry.id, row.confirmation, row.match.kind, row.match.suggestions[0].category])).toEqual([
      ['qr', 'expense', 'auto', 'Tarik tunai'], ['fee', undefined, 'auto', 'Biaya bank']]);
    const next = applyBankDecisions(source, [
      { entryId: 'qr', category: 'Tarik tunai', confirmBankType: true }, { entryId: 'fee', category: 'Biaya bank' }]);
    expect(next.state.entries).toMatchObject([
      { id: 'qr', type: 'expense', amount: 25000, category: 'Tarik tunai', note: qr },
      { id: 'fee', type: 'expense', amount: 625, category: 'Biaya bank' },
      { id: 'manual', type: 'expense', amount: 40000, category: 'Kategori pribadi' }]);
    expect(next.state.entries.map(entrySignedAmount)).toEqual(source.state.entries.map(entrySignedAmount));
    expect(walletBalance(next.state, 'bank')).toBe(walletBalance(source.state, 'bank'));
  });
});
