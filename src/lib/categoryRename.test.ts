import { describe, expect, it } from 'vitest';
import { categoryRenameTargets, categoryUsage, renameCategoryInBudgets, renameCategoryInSettings, renameCategoryInTemplates } from './categoryRename';
import type { CategorySettings } from './categorySettings';
import type { StoredData } from './storage';

const settings: CategorySettings = { version: 1, names: ['Belum dikategorikan', 'Makanan', 'Transportasi'],
  rules: [{ id: 'r1', keyword: 'WARUNG', category: 'Makanan', mode: 'auto' }, { id: 'r2', keyword: 'OJEK', category: 'Transportasi', mode: 'suggest' }] };

describe('renameCategoryInSettings', () => {
  it('keeps the position and retargets rules', () => {
    const next = renameCategoryInSettings(settings, 'Makanan', '  Makan & minum ');
    expect(next.names).toEqual(['Belum dikategorikan', 'Makan & minum', 'Transportasi']);
    expect(next.rules.map(rule => rule.category)).toEqual(['Makan & minum', 'Transportasi']);
    expect(settings.names[1]).toBe('Makanan'); // The input is not mutated.
  });
  it('refuses the base category, unknown, empty, unchanged and duplicate names', () => {
    expect(() => renameCategoryInSettings(settings, 'Belum dikategorikan', 'Lain')).toThrow(/dasar/);
    expect(() => renameCategoryInSettings(settings, 'Tidak ada', 'Lain')).toThrow(/tidak ada/);
    expect(() => renameCategoryInSettings(settings, 'Makanan', '   ')).toThrow(/Isi nama/);
    expect(() => renameCategoryInSettings(settings, 'Makanan', 'Makanan')).toThrow(/sama/);
    expect(() => renameCategoryInSettings(settings, 'Makanan', 'transportasi')).toThrow(/sudah ada/);
  });
});

describe('renameCategoryInBudgets', () => {
  it('moves the limit in every currency and keeps an existing limit under the new name', () => {
    expect(renameCategoryInBudgets({ IDR: { Makanan: 500_000, Transportasi: 100_000 }, TRY: { Makanan: 900 } }, 'Makanan', 'Makan'))
      .toEqual({ IDR: { Makan: 500_000, Transportasi: 100_000 }, TRY: { Makan: 900 } });
    expect(renameCategoryInBudgets({ IDR: { Makanan: 500_000, Makan: 700_000 } }, 'Makanan', 'Makan')).toEqual({ IDR: { Makan: 700_000 } });
  });
});

describe('renameCategoryInTemplates', () => {
  const template = { id: 't1', name: 'Kopi', type: 'expense', walletId: 'w', currency: 'IDR', category: 'Makanan', note: '' };
  it('retargets templates and reports no change otherwise', () => {
    expect(renameCategoryInTemplates(JSON.stringify([template]), 'Makanan', 'Makan')!.templates[0].category).toBe('Makan');
    expect(renameCategoryInTemplates(JSON.stringify([template]), 'Transportasi', 'Angkutan')).toBeNull();
    expect(renameCategoryInTemplates(null, 'Makanan', 'Makan')).toBeNull();
    expect(() => renameCategoryInTemplates('{rusak', 'Makanan', 'Makan')).toThrow(/tidak dapat dibaca/);
  });
});

describe('categoryRenameTargets', () => {
  const wallet = (id: string, kind: 'bank' | 'cash' = 'bank') => ({ id, name: id, currency: 'IDR' as const, kind, openingBalance: 0 });
  const entry = (id: string, walletId: string, category: string, type = 'expense') => ({ id, type, walletId, amount: 1000, date: '2026-10-01', category, note: '' });
  const data = { app: 'uangku', version: 1, demo: false, state: { version: 1, wallets: [wallet('bank'), wallet('tunai', 'cash')], entries: [
    entry('a', 'bank', 'Makanan'), entry('b', 'bank', 'Makanan', 'income'), entry('c', 'bank', 'Transportasi'),
    entry('d', 'tunai', 'Makanan'), entry('e', 'bank', 'Makanan', 'adjustment'),
  ] } } as unknown as StoredData;
  it('lists editable records with the old name and counts read-only ones', () => {
    expect(categoryRenameTargets(data, 'Makanan')).toEqual({ ids: ['a', 'b'], readOnly: 1 });
    expect(categoryRenameTargets(data, 'Tidak dipakai')).toEqual({ ids: [], readOnly: 0 });
    expect(categoryUsage(data)).toEqual({ Makanan: 2, Transportasi: 1 });
  });
});
