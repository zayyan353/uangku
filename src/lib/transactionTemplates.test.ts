import { describe, expect, it } from 'vitest';
import { appendTemplate, MAX_TEMPLATES, parseStoredTemplates, serializeTemplates, TEMPLATES_LIMIT, validateTemplates, type TransactionTemplate } from './transactionTemplates';

const coffee: TransactionTemplate = { id: 't1', name: 'Kopi pagi', type: 'expense', walletId: 'bank', currency: 'TRY', category: 'Makan & minum', amount: 4500, note: 'Kopi dekat kampus' };
const salary: TransactionTemplate = { id: 't2', name: 'Gaji', type: 'income', walletId: 'bank', currency: 'IDR', category: 'Gaji', note: '' };

describe('validateTemplates (MW-13a)', () => {
  it('accepts templates with and without an amount and keeps their order', () => {
    expect(validateTemplates([coffee, salary])).toEqual([coffee, salary]);
    expect('amount' in validateTemplates([salary])[0]).toBe(false);
  });

  it('trims and normalises text fields', () => {
    expect(validateTemplates([{ ...coffee, name: '  Kopi  ', note: ' x ' }])[0]).toMatchObject({ name: 'Kopi', note: 'x' });
  });

  it('rejects invalid fields instead of dropping them', () => {
    const bad: unknown[] = [
      { ...coffee, type: 'transfer' }, { ...coffee, currency: 'XYZ' }, { ...coffee, amount: 0 },
      { ...coffee, amount: -1 }, { ...coffee, amount: 1.5 }, { ...coffee, amount: '10' },
      { ...coffee, name: '' }, { ...coffee, name: 'x'.repeat(61) }, { ...coffee, note: 'a\u0000b' },
      { ...coffee, category: '' }, { ...coffee, walletId: '' }, { ...coffee, extra: 1 },
      (({ note, ...rest }) => rest)(coffee), null, [], 'x',
    ];
    for (const item of bad) expect(() => validateTemplates([item]), JSON.stringify(item)).toThrow();
    expect(() => validateTemplates({})).toThrow(/daftar/);
  });

  it('rejects duplicate ids and case-insensitive duplicate names', () => {
    expect(() => validateTemplates([coffee, { ...salary, id: 't1' }])).toThrow(/id/);
    expect(() => validateTemplates([coffee, { ...salary, name: 'KOPI PAGI' }])).toThrow(/sudah dipakai/);
  });

  it('enforces the count and size limits', () => {
    const many = Array.from({ length: MAX_TEMPLATES + 1 }, (_, i) => ({ ...salary, id: `t${i}`, name: `T${i}` }));
    expect(() => validateTemplates(many)).toThrow(/maksimal 50/);
    const big = Array.from({ length: 40 }, (_, i) => ({ ...salary, id: `t${i}`, name: `T${i}`, note: 'x'.repeat(2000) }));
    expect(() => validateTemplates(big)).toThrow(/64 KiB/);
  });
});

describe('stored templates', () => {
  it('treats a missing key as empty and throws on unreadable data', () => {
    expect(parseStoredTemplates(null)).toEqual([]);
    expect(parseStoredTemplates(serializeTemplates([coffee]))).toEqual([coffee]);
    expect(() => parseStoredTemplates('{bad')).toThrow(/tidak dapat dibaca/);
    expect(() => parseStoredTemplates('[{"id":1}]')).toThrow();
    expect(() => parseStoredTemplates(' '.repeat(TEMPLATES_LIMIT + 1))).toThrow(/64 KiB/);
  });

  it('appends to the stored list and refuses to replace an unreadable one', () => {
    const first = appendTemplate(null, coffee);
    expect(JSON.parse(first.raw)).toEqual([coffee]);
    expect(appendTemplate(first.raw, salary).templates).toEqual([coffee, salary]);
    expect(() => appendTemplate('{bad', salary)).toThrow(/tidak dapat dibaca/);
    expect(() => appendTemplate(first.raw, { ...salary, name: 'kopi pagi' })).toThrow(/sudah dipakai/);
  });
});
