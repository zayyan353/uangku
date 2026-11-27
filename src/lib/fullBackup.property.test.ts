import { fc, test } from '@fast-check/vitest';
import { expect } from 'vitest';
import { UNCATEGORIZED, type CategorySettings } from './categorySettings';
import { parseRestoreFile, serializeFullBackup } from './fullBackup';
import { sourceDocumentArbitrary } from './testing/sourceDocumentArbitrary';
import type { TransactionTemplate } from './transactionTemplates';

test.prop({
  source: sourceDocumentArbitrary,
  category: fc.constantFrom('Makan siang', 'Transportasi', 'Kopi İstanbul'),
  mode: fc.constantFrom('auto' as const, 'suggest' as const),
  budget: fc.option(fc.integer({ min: 1, max: 1_000_000 })),
  templateAmount: fc.option(fc.integer({ min: 1, max: 100_000 })),
})('full backups preserve the ledger and every supplied settings section', ({ source, category, mode, budget, templateAmount }) => {
  const settings: CategorySettings = {
    version: 1, names: [UNCATEGORIZED, category],
    rules: [{ id: 'merchant', keyword: 'Warung', category, mode }],
  };
  const budgets = budget === null ? {} : { TRY: { [category]: budget } };
  const templates: TransactionTemplate[] = templateAmount === null ? [] : [{
    id: 't1', name: 'Pembayaran contoh', type: 'expense', walletId: 'bank', currency: 'TRY',
    category, amount: templateAmount, note: 'Catatan contoh',
  }];
  const legacy = { app: source.app, version: source.version, demo: source.demo, state: source.state };
  for (const ledger of [legacy, source]) {
    const file = serializeFullBackup(ledger, settings, budgets, templates);
    expect(parseRestoreFile(file)).toEqual({
      kind: 'full', ledger, categorySettings: settings,
      ...(budget === null ? {} : { budgets }), ...(templates.length ? { templates } : {}),
    });
  }
});
