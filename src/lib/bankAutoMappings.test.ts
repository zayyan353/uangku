import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORY_RULES, matchCategory, type CategoryRule } from './categorization';
import type { CategorySettings } from './categorySettings';
import { interpretBankDescription } from './bankDescription';
import { BANK_CATEGORY_NAMES, BANK_CATEGORY_RULES, BANK_PREPAID_CREDIT_RULE, CURRENT_BANK_CATEGORY_RULES } from './categoryBankMappings';
import { mergeAutomaticBankMappings, mergeCurrentAutomaticBankMappings } from './bankAutoMappings';

function previous(): CategorySettings {
  return { version: 1, keywordPackVersion: 3,
    names: ['Belum dikategorikan', ...BANK_CATEGORY_NAMES, 'Biaya bank', 'Belanja online', 'Bahan makanan', 'Pribadi'],
    rules: BANK_CATEGORY_RULES.map(rule => ({ ...rule })) };
}
const current = () => mergeAutomaticBankMappings(previous()).settings;
const match = (text: string, amount?: number, settings = current()) => matchCategory(text, settings.rules, settings.names, { signedAmount: amount });

describe('v4 automatic operation defaults preserve personal configuration', () => {
  it('updates exactly eight untouched movement modes and adds one credit-only literal', () => {
    const source = previous(), before = JSON.stringify(source);
    const result = mergeAutomaticBankMappings(source);
    expect(result.updated).toBe(8);
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.settings.names).toBe(source.names);
    expect(result.settings.rules).toHaveLength(15);
    expect(result.settings.rules.slice(8)).toEqual([...source.rules.slice(8), BANK_PREPAID_CREDIT_RULE]);
    expect(CURRENT_BANK_CATEGORY_RULES).toHaveLength(15);
    expect(BANK_CATEGORY_RULES.slice(0, 8).every(rule => rule.mode === 'suggest')).toBe(true);
    expect(JSON.stringify(source)).toBe(before);
  });

  it.each(['id', 'keyword', 'category', 'mode'] as const)('retains a personal %s edit without replacing the record', field => {
    const source = previous();
    if (field === 'id') source.rules[0].id = 'my-atm-rule';
    if (field === 'keyword') source.rules[0].keyword = 'ATM WITHDRAWAL PERSONAL';
    if (field === 'category') source.rules[0].category = 'Pribadi';
    if (field === 'mode') source.rules[0].mode = 'auto';
    const before = JSON.stringify(source.rules[0]), result = mergeAutomaticBankMappings(source);
    expect(result.updated).toBe(7);
    expect(JSON.stringify(result.settings.rules[0])).toBe(before);
  });

  it('does not recreate deleted movement rules or an inactive Cashback target', () => {
    const source = previous();
    source.rules = source.rules.filter(rule => !rule.id.includes('atm-'));
    source.names = source.names.filter(name => name !== 'Cashback');
    const result = mergeAutomaticBankMappings(source);
    expect(result.added).toBe(0);
    expect(result.settings.rules.some(rule => rule.id.includes('atm-'))).toBe(false);
    expect(result.settings.names).toEqual(source.names);
  });

  it('does not upgrade a custom PREPAID suggestion, target or colliding ID', () => {
    for (const custom of [
      { id: 'my-prepaid', keyword: '  prepaıd  ', category: 'Cashback', mode: 'suggest' },
      { id: 'my-prepaid', keyword: 'PREPAID', category: 'Pribadi', mode: 'auto' },
      { id: BANK_PREPAID_CREDIT_RULE.id, keyword: 'OTHER CREDIT', category: 'Pribadi', mode: 'suggest' },
    ] as CategoryRule[]) {
      const source = previous(); source.rules.push(custom);
      const result = mergeAutomaticBankMappings(source);
      expect(result.added).toBe(0);
      expect(result.settings.rules.at(-1)).toBe(custom);
    }
  });

  it('uses personal display labels and keeps current-mode removals and reversions durable', () => {
    const source = previous();
    source.names = source.names.map(name => name === 'Cashback' ? 'CASHBACK' : name === 'Tarik tunai' ? 'tarik tunai' : name);
    source.rules[0].category = 'tarik tunai';
    const result = mergeAutomaticBankMappings(source);
    expect(result.settings.rules[0]).toMatchObject({ category: 'tarik tunai', mode: 'auto' });
    expect(result.settings.rules.at(-1)?.category).toBe('CASHBACK');
    const saved = { ...result.settings, keywordPackVersion: 4 } as CategorySettings;
    saved.rules[0].mode = 'suggest';
    saved.rules = saved.rules.filter(rule => rule.id !== 'bank-v3-atm-deposit');
    saved.names = saved.names.filter(name => name !== 'Setor tunai');
    const added = mergeCurrentAutomaticBankMappings(saved);
    expect(added.updated).toBe(0);
    expect(added.settings.rules[0].mode).toBe('suggest');
    expect(added.settings.rules.some(rule => rule.id === 'bank-v3-atm-deposit')).toBe(false);
  });
});

describe('known movement categories become automatic without inventing transfer legs', () => {
  it.each([
    ['ATM PARA CEKME', -1000, 'Tarik tunai'],
    ['ATM YATAN', 1000, 'Setor tunai'],
    ['YURTICI ATM P.Y.', 1000, 'Setor tunai'],
    ['ATM PARA YATIRMA', 1000, 'Setor tunai'],
    ['HAVALE SYNTHETIC RECIPIENT', -1000, 'Transfer'],
    ['FAST SYNTHETIC RECIPIENT', 1000, 'Transfer'],
    ['EFT SYNTHETIC RECIPIENT', -1000, 'Transfer'],
    ['VIRMAN', 1000, 'Transfer'],
  ])('%s is automatic for its known signed direction', (text, amount, category) => {
    expect(match(text as string, amount as number)).toMatchObject({ kind: 'auto', suggestions: [{ category }] });
    expect(interpretBankDescription(text as string, { signedAmount: amount as number }).pending).toBe(false);
  });

  it.each([
    ['ATM PARA CEKME', 1000], ['ATM YATAN', -1000],
    ['ATM PARA CEKME IADE', -1000], ['HAVALE REVERSAL', -1000],
    ['ATM PARA CEKME HAVALE', -1000], ['HAVALE ATM', -1000],
  ])('retains explicit wrong-direction or reversal checks: %s', (text, amount) => {
    expect(match(text as string, amount as number).kind).toBe('suggestions');
  });

  it('does not turn a manual broad suggestion into an automatic movement', () => {
    const settings = current();
    settings.rules.push({ id: 'my-atm', keyword: 'ATM', category: 'Tarik tunai', mode: 'suggest' });
    expect(match('ATM PARA CEKME', -1000, settings).kind).toBe('suggestions');
  });
});

describe('incoming whole-word PREPAID is the confirmed Cashback convention', () => {
  it.each(['PREPAID', 'PREPAID PROMOTION', 'PREPAID IADE', 'PREPAID IADESI', 'prepaıd reward'])('recognizes %s only with a known positive amount', text => {
    expect(interpretBankDescription(text, { signedAmount: 1200 })).toMatchObject({ kind: 'cashback', pending: false });
    expect(match(text, 1200)).toMatchObject({ kind: 'auto', suggestions: [{ category: 'Cashback' }] });
  });

  it.each(['PREPAID REVERSAL', 'PREPAID HAVALE', 'PREPAID ATM IADE'])('honors the confirmed incoming convention even for %s', text => {
    expect(match(text, 100)).toMatchObject({ kind: 'auto', suggestions: [{ category: 'Cashback' }] });
  });

  it.each([undefined, -100, 0, NaN, Infinity])('does not turn bare PREPAID into Cashback for %s', amount => {
    expect(interpretBankDescription('PREPAID CREDIT', { signedAmount: amount }).kind).toBe('none');
    expect(match('PREPAID CREDIT', amount).kind).toBe('none');
  });

  it('keeps negative IADE checks and exact token boundaries', () => {
    expect(match('PREPAID IADE', -100).kind).toBe('suggestions');
    expect(match('UNPREPAID CREDIT', 100).kind).toBe('none');
    expect(match('PREPAIDX CREDIT', 100).kind).toBe('none');
  });

  it('prioritizes Cashback over untouched merchant defaults and does not guess when it is archived', () => {
    const settings = current();
    settings.rules.push({ ...DEFAULT_CATEGORY_RULES[0] });
    expect(match('PREPAID BIM CREDIT', 100, settings)).toMatchObject({ kind: 'auto', suggestions: [{ category: 'Cashback' }] });
    settings.names = settings.names.filter(name => name !== 'Cashback');
    expect(match('PREPAID BIM CREDIT', 100, settings).kind).toBe('none');
  });

  it('preserves conflicting and same-category manual suggestion decisions', () => {
    for (const category of ['Pribadi', 'Cashback']) {
      const settings = current();
      settings.rules.push({ id: 'my-credit', keyword: 'CREDIT', category, mode: 'suggest' });
      expect(match('PREPAID CREDIT', 100, settings).kind).toBe('suggestions');
    }
  });
});
