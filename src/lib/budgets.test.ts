import { describe, expect, it } from 'vitest';
import { applyBudgetInputs, BUDGETS_LIMIT, budgetInputs, categoryBudgetRows, isEmptyBudgets, parseStoredBudgets, serializeBudgets, validateBudgets } from './budgets';

describe('validateBudgets', () => {
  it('accepts per-currency monthly limits in minor units', () => {
    const budgets = { IDR: { 'Makan & minum': 150000000, Transportasi: 50000000 }, TRY: { Belanja: 250000 } };
    expect(validateBudgets(budgets)).toEqual(budgets);
  });

  it('sorts currencies, drops empty sections and normalises names', () => {
    const result = validateBudgets({ TRY: { '  Belanja ': 1 }, EUR: {}, IDR: { 'Café': 2 } });
    expect(Object.keys(result)).toEqual(['IDR', 'TRY']);
    expect(result.TRY).toEqual({ Belanja: 1 });
    expect(Object.keys(result.IDR!)).toEqual(['Café']);
    expect(serializeBudgets({ TRY: { A: 1 }, IDR: { B: 2 } })).toBe(serializeBudgets({ IDR: { B: 2 }, TRY: { A: 1 } }));
  });

  it('treats an empty map as empty', () => {
    expect(validateBudgets({})).toEqual({});
    expect(isEmptyBudgets(validateBudgets({ IDR: {} }))).toBe(true);
    expect(isEmptyBudgets({ IDR: { A: 1 } })).toBe(false);
  });

  it('rejects non-objects, unknown currencies and bad category names', () => {
    for (const bad of [null, [], 'x', 1, { IDR: [] }, { IDR: null }, { XYZ: { A: 1 } }, { idr: { A: 1 } },
      { IDR: { '': 1 } }, { IDR: { '   ': 1 } }, { IDR: { 'a\u0007b': 1 } }, { IDR: { ['x'.repeat(81)]: 1 } },
      { IDR: { 'Belum dikategorikan': 1 } }, { IDR: { Belanja: 1, ' belanja ': 2 } }]) {
      expect(() => validateBudgets(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it('rejects limits that are not positive safe integers', () => {
    for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '100', null, true]) {
      expect(() => validateBudgets({ IDR: { Belanja: limit } }), String(limit)).toThrow();
    }
    expect(validateBudgets({ IDR: { Belanja: Number.MAX_SAFE_INTEGER } }).IDR!.Belanja).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('rejects accessors, symbols and class instances', () => {
    const accessor = Object.defineProperty({}, 'IDR', { get: () => ({ A: 1 }), enumerable: true });
    expect(() => validateBudgets(accessor)).toThrow();
    expect(() => validateBudgets({ [Symbol('x')]: 1 })).toThrow();
    expect(() => validateBudgets(new Map())).toThrow();
  });

  it('caps categories per currency and total size', () => {
    const many = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`Kategori ${i}`, 1]));
    expect(() => validateBudgets({ IDR: many })).toThrow(/100/);
    const big = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`${'k'.repeat(70)}${i}`, Number.MAX_SAFE_INTEGER]));
    expect(() => validateBudgets({ IDR: big, TRY: big })).toThrow(/16 KiB/);
    expect(BUDGETS_LIMIT).toBe(16 * 1024);
  });
});

describe('parseStoredBudgets', () => {
  it('reads a missing key as empty and round-trips stored JSON', () => {
    expect(parseStoredBudgets(null)).toEqual({});
    const raw = serializeBudgets({ IDR: { Belanja: 100 } });
    expect(parseStoredBudgets(raw)).toEqual({ IDR: { Belanja: 100 } });
  });

  it('throws on corrupt or oversized stored data instead of returning empty', () => {
    expect(() => parseStoredBudgets('{bad')).toThrow(/tidak dapat dibaca/);
    expect(() => parseStoredBudgets('{"IDR":{"Belanja":-1}}')).toThrow();
    expect(() => parseStoredBudgets(' '.repeat(BUDGETS_LIMIT + 1))).toThrow(/16 KiB/);
  });
});

describe('budget form inputs (MW-12b)', () => {
  const stored = { IDR: { 'Makan & minum': 150000000, Hapus: 5000000 }, TRY: { Belanja: 250050 } };

  it('shows stored limits as editable text and skips Belum dikategorikan', () => {
    expect(budgetInputs(stored, 'IDR', ['Belum dikategorikan', 'Makan & minum', 'Transportasi']))
      .toEqual({ 'Makan & minum': '1500000', Transportasi: '' });
    expect(budgetInputs(stored, 'TRY', ['Belanja'])).toEqual({ Belanja: '2500,50' });
    expect(budgetInputs({}, 'USD', ['Belanja'])).toEqual({ Belanja: '' });
  });

  it('round-trips the editable text without changing stored limits', () => {
    const inputs = budgetInputs(stored, 'TRY', ['Belanja']);
    expect(applyBudgetInputs(stored, 'TRY', inputs)).toEqual(stored);
  });

  it('sets, changes and clears limits for one currency only', () => {
    const next = applyBudgetInputs(stored, 'IDR', { 'Makan & minum': '2.000.000', Transportasi: '750.000,50', Hapus: ' ' });
    expect(next).toEqual({ IDR: { 'Makan & minum': 200000000, Transportasi: 75000050 }, TRY: stored.TRY });
    expect(stored.IDR).toEqual({ 'Makan & minum': 150000000, Hapus: 5000000 });
  });

  it('keeps limits for categories that are not in the form', () => {
    expect(applyBudgetInputs(stored, 'IDR', { Transportasi: '10000' }).IDR)
      .toEqual({ 'Makan & minum': 150000000, Hapus: 5000000, Transportasi: 1000000 });
  });

  it('drops a currency section once every limit is cleared', () => {
    expect(applyBudgetInputs(stored, 'TRY', { Belanja: '' })).toEqual({ IDR: stored.IDR });
    expect(isEmptyBudgets(applyBudgetInputs({ USD: { A: 1 } }, 'USD', { A: '' }))).toBe(true);
  });

  it('refuses zero, negative and malformed amounts', () => {
    for (const text of ['0', '-5', '0,00', 'abc', '1e5', '1,5,5']) {
      expect(() => applyBudgetInputs({}, 'IDR', { Belanja: text }), text).toThrow(/nominal positif/);
    }
  });

  it('still enforces the stored map limits', () => {
    const many = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`K${i}`, '1']));
    expect(() => applyBudgetInputs({}, 'IDR', many)).toThrow(/maksimal 100/);
  });
});

describe('categoryBudgetRows (MW-12c)', () => {
  const totals: Array<[string, number]> = [['A', 900], ['B', 800], ['C', 700], ['D', 600], ['E', 500], ['F', 400]];

  it('keeps the earlier top-four view when there are no budgets', () => {
    const { rows, hidden } = categoryBudgetRows(totals, undefined);
    expect(rows.map(row => row.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(rows.every(row => row.limit === undefined && !row.over)).toBe(true);
    expect(hidden).toBe(2);
  });

  it('shows used, limit, remaining and over for budgeted categories', () => {
    const { rows } = categoryBudgetRows([['A', 900], ['B', 800]], { A: 1000, B: 500 });
    expect(rows).toEqual([
      { name: 'A', spent: 900, limit: 1000, remaining: 100, over: false },
      { name: 'B', spent: 800, limit: 500, remaining: -300, over: true },
    ]);
    expect(categoryBudgetRows([['A', 1000]], { A: 1000 }).rows[0].over).toBe(false);
  });

  it('always shows budgeted categories, even outside the top four or without spending', () => {
    const { rows, hidden } = categoryBudgetRows(totals, { F: 300, Zebra: 100, Apel: 50 });
    expect(rows.map(row => row.name)).toEqual(['A', 'B', 'C', 'D', 'F', 'Apel', 'Zebra']);
    expect(rows.find(row => row.name === 'F')).toMatchObject({ over: true, remaining: -100 });
    expect(rows.find(row => row.name === 'Apel')).toMatchObject({ spent: 0, remaining: 50, over: false });
    expect(hidden).toBe(1);
  });
});
