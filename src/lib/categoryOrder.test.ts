import { describe, expect, it } from 'vitest';
import { orderCategories } from './categoryOrder';

const choices = ['Belum dikategorikan', 'Makanan', 'Transportasi', 'Gaji', 'Belanja'];
const entries = [
  { type: 'expense', category: 'Transportasi' }, { type: 'expense', category: 'Transportasi' },
  { type: 'expense', category: 'Makanan' }, { type: 'income', category: 'Gaji' },
  { type: 'expense', category: 'Belum dikategorikan' }, { type: 'expense', category: 'Sudah dihapus' },
];

describe('orderCategories', () => {
  it('puts categories used for the same kind first, most used first', () => {
    expect(orderCategories(choices, entries, 'expense')).toEqual({ frequent: ['Transportasi', 'Makanan'], rest: ['Belum dikategorikan', 'Gaji', 'Belanja'] });
    expect(orderCategories(choices, entries, 'income')).toEqual({ frequent: ['Gaji'], rest: ['Belum dikategorikan', 'Makanan', 'Transportasi', 'Belanja'] });
  });
  it('keeps the settings order without history and offers each choice once', () => {
    expect(orderCategories(choices, [], 'expense')).toEqual({ frequent: [], rest: choices });
    const { frequent, rest } = orderCategories(choices, entries, 'expense', 1);
    expect(frequent).toEqual(['Transportasi']);
    expect([...frequent, ...rest].sort()).toEqual([...choices].sort());
  });
  it('breaks ties by the settings order', () => {
    const tied = [{ type: 'expense', category: 'Belanja' }, { type: 'expense', category: 'Makanan' }];
    expect(orderCategories(choices, tied, 'expense').frequent).toEqual(['Makanan', 'Belanja']);
  });
});
