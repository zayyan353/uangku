import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { BANK_BILL_PAYMENT_RULES, BANK_KEYWORD_PACK_7_RULES } from './categoryBankMappings';
import { defaultCategorySettings, type CategorySettings } from './categorySettings';
import { upgradeCategorySettings } from './categorySettingsUpgrade';
import { categorySuggestion } from './categorySuggestions';
import { parseZiraatWorkbook } from './importer';
import type { Wallet } from './finance';

/** Synthetic wording in the bank's layout. No personal statement is read. */
const gas = 'ESGAZ/Abone No: 0000000000 /Son Ödeme Tarihi: 01/01/2026';
const electricity = 'OSMANGAZİ Sözleşme No: 0000000000 Tah.No: 000000000000SYNTH';
const settings = () => defaultCategorySettings();
const match = (text: string, amount: number, value = settings()) =>
  categorySuggestion(text, amount < 0 ? 'expense' : 'unreviewed', value, amount);
function v6(): CategorySettings {
  const value = settings();
  return { ...value, keywordPackVersion: 6, rules: value.rules.filter(rule => !/^bank-v[7-9]-/.test(rule.id)) };
}

describe('utility bill collections paid through the bank', () => {
  it.each([gas, electricity, 'esgaz abone no 1', 'OSMANGAZI SOZLESME NO 1',
    'POS ALIŞVERİŞ KART NO: 0000 **** **** 0000 İŞYERİ: ESGAZ MUTABAKAT: 0000000'])('files a debit under Tagihan: %s', text => {
    expect(match(text, -50000)).toMatchObject({ kind: 'auto', suggestions: [{ category: 'Tagihan' }] });
  });
  it.each(['ESGAZI/Abone No: 1', 'OSMANGAZİ ÜNİVERSİTESİ', 'OSMANGAZİ Sözleşme', 'Sözleşme No: 0000000000', 'Abone No: 1 /Son Ödeme Tarihi: 01/01/2026'])('requires the exact public name: %s', text => {
    expect(match(text, -50000).kind).toBe('none');
  });
  it('does not confirm an unexplained credit and respects an inactive or personal choice', () => {
    expect(match(gas, 50000).kind).toBe('suggestions');
    const inactive = settings(); inactive.names = inactive.names.filter(name => name !== 'Tagihan');
    expect(match(gas, -50000, inactive).kind).toBe('none');
    const personal = settings(); personal.names.push('Pribadi');
    personal.rules.push({ id: 'my-gas', keyword: 'ESGAZ', category: 'Pribadi', mode: 'suggest' });
    expect(match(gas, -50000, personal).suggestions.map(row => row.category).sort()).toEqual(['Pribadi', 'Tagihan']);
    expect(match(gas, -50000, personal).kind).toBe('suggestions');
  });
  it('keeps the imported row an expense with its bank balance', () => {
    const rows: unknown[][] = [['Synthetic statement'], ['Mata uang', 'TL'], ['Tarih', 'Fiş No', 'Açıklama', 'İşlem Tutarı', 'Bakiye'],
      ['02.11.2026', 'F00002', electricity, -250, 250], ['02.11.2026', 'F00001', gas, -500, 500]];
    const xml = rows.map(row => `<row>${row.map(value => `<c t="${typeof value === 'number' ? 'n' : 'str'}"><v>${value}</v></c>`).join('')}</row>`).join('');
    const bytes = zipSync({ 'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${xml}</sheetData></worksheet>`) });
    const wallet: Wallet = { id: 'bank-bills', name: 'Synthetic bank', currency: 'TRY', kind: 'bank', openingBalance: 0 };
    const preview = parseZiraatWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, wallet, []);
    expect(preview.rows.map(row => [row.classification, row.amount, row.warning])).toEqual([['expense', -25000, undefined], ['expense', -50000, undefined]]);
    expect(preview).toMatchObject({ openingBalance: 100000, closingBalance: 25000 });
  });
});

describe('v7 non-destructive keyword pack', () => {
  it('ships the bill rules as bundled v7 identities', () => {
    expect(BANK_BILL_PAYMENT_RULES.map(rule => [rule.id, rule.keyword, rule.category, rule.mode])).toEqual([
      ['bank-v7-bill-esgaz', 'ESGAZ', 'Tagihan', 'auto'], ['bank-v7-bill-osmangazi-electricity', 'OSMANGAZİ SÖZLEŞME NO', 'Tagihan', 'auto']]);
    expect(BANK_KEYWORD_PACK_7_RULES).toEqual(expect.arrayContaining([...BANK_BILL_PAYMENT_RULES]));
    expect(settings().rules.slice(-BANK_KEYWORD_PACK_7_RULES.length)).toEqual(BANK_KEYWORD_PACK_7_RULES);
    expect(settings().keywordPackVersion).toBe(7);
  });
  it('adds only the v7 rules to a v6 catalog, retaining v6 deletions, edits, names and order', () => {
    const source = v6(); source.rules = source.rules.filter(rule => rule.id !== 'bank-v6-atm-commission');
    source.rules.find(rule => rule.id === 'bank-v6-atm-qr-withdrawal')!.mode = 'suggest';
    const before = JSON.stringify(source), result = upgradeCategorySettings(source);
    expect(result).toMatchObject({ error: '', added: BANK_KEYWORD_PACK_7_RULES.length });
    expect(result.settings.keywordPackVersion).toBe(7); expect(result.settings.names).toEqual(source.names);
    expect(result.settings.rules.slice(0, source.rules.length)).toEqual(source.rules);
    expect(result.settings.rules.slice(source.rules.length)).toEqual(BANK_KEYWORD_PACK_7_RULES);
    expect(JSON.stringify(source)).toBe(before);
  });
  it('retains v7 deletions on later reloads and never replaces a personal keyword or revives a category', () => {
    const current = settings(); current.rules = current.rules.filter(rule => rule.id !== 'bank-v7-bill-esgaz');
    expect(upgradeCategorySettings(current).settings).toBe(current);
    const source = v6(); source.names = source.names.filter(name => name !== 'Tagihan');
    const result = upgradeCategorySettings(source);
    expect(result.settings.names).toEqual(source.names);
    expect(result.settings.rules.some(rule => rule.category === 'Tagihan' && rule.id.startsWith('bank-v7-'))).toBe(false);
    const personal = v6(); personal.rules.push({ id: 'my-gas', keyword: 'esgaz', category: 'Tagihan', mode: 'suggest' });
    const kept = upgradeCategorySettings(personal).settings.rules;
    expect(kept.filter(rule => rule.keyword.toLowerCase() === 'esgaz')).toEqual([{ id: 'my-gas', keyword: 'esgaz', category: 'Tagihan', mode: 'suggest' }]);
  });
  it('rolls back the entire proposal if the rule limit cannot admit it', () => {
    const source = v6();
    while (source.rules.length < 200) source.rules.push({ id: `personal-${source.rules.length}`, keyword: `PERSONAL ${source.rules.length}`, category: 'Belanja', mode: 'suggest' });
    const before = JSON.stringify(source), result = upgradeCategorySettings(source);
    expect(result.error).toMatch(/200/); expect(result.settings).toBe(source); expect(JSON.stringify(source)).toBe(before);
  });
});
