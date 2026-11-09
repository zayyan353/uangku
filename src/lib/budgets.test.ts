import { describe, expect, it } from 'vitest';
import { BUDGETS_LIMIT, isEmptyBudgets, parseStoredBudgets, serializeBudgets, validateBudgets } from './budgets';

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
