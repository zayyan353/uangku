import { describe, expect, it } from 'vitest';
import { CATEGORY_SETTINGS_LIMIT, UNCATEGORIZED, type CategorySettings } from './categorySettings';
import { parseRestoreFile, serializeFullBackup } from './fullBackup';
import { MAX_RESTORE_BYTES, parseBackupText, serializeBackup, type StoredData } from './storage';

const categories: CategorySettings = {
  version: 1, keywordPackVersion: 5,
  names: [UNCATEGORIZED, 'Langganan pribadi', 'Belum pernah dipakai'],
  rules: [
    { id: 'second-id', keyword: 'TOKO DETAIL', category: 'Belum pernah dipakai', mode: 'suggest' },
    { id: 'first-id', keyword: 'TOKO', category: 'Langganan pribadi', mode: 'auto' },
  ],
};

function ledger(): StoredData {
  return {
    app: 'uangku', version: 1, demo: false,
    state: {
      version: 1,
      wallets: [{ id: 'bank', name: 'Bank sintetis', kind: 'bank', currency: 'TRY', openingBalance: 5000 }],
      entries: [{ id: 'tx', date: '2026-10-16', type: 'expense', walletId: 'bank',
        amount: 250, category: 'Belanja manual', note: 'Ürün sintetis' }],
    },
  };
}

function bankLedger(): StoredData {
  const data = ledger();
  const fingerprint = 'ziraat:0000000000000001';
  data.state.entries[0].sourceKey = fingerprint;
  data.metadata = {
    policy: 'unverified-unless-linked',
    facts: [{ id: 'fact', walletId: 'bank', currency: 'TRY', postedOn: '2026-10-16',
      signedAmount: -250, balanceAfter: 4750, description: 'Mutasi asli sintetis',
      fingerprintVersion: 'ziraat-v1', fingerprint, reference: '000000009' }],
    links: [{ entryId: 'tx', source: 'fact' }],
    statements: [{ id: 'statement', walletId: 'bank', currency: 'TRY', periodStart: '2026-10-16',
      periodEnd: '2026-10-16', openingBalance: 5000, closingBalance: 4750, rowIds: ['fact'] }],
    annotations: [{ sourceId: 'fact', category: 'Belanja manual', note: 'Ürün sintetis', confirmedType: 'expense' }],
    walletArchives: [{ walletId: 'bank', at: '2026-10-30T12:00:00.000Z' }],
  };
  return data;
}

describe('full and legacy backup files', () => {
  it('preserves the exact ledger wire and all category choices, rules, order, IDs and pack version', () => {
    const data = bankLedger();
    const raw = serializeFullBackup(data, categories);
    const wire = JSON.parse(raw);
    expect(wire.ledger.version).toBe(2);
    expect(JSON.stringify(wire.ledger)).toBe(serializeBackup(data));
    expect(wire.categorySettings).toEqual(categories);
    expect(parseRestoreFile(raw)).toEqual({ kind: 'full', ledger: data, categorySettings: categories });
  });

  it('does not fill absent legacy pack markers or replace custom rules with defaults', () => {
    const minimal: CategorySettings = { version: 1, names: [UNCATEGORIZED, 'Lama'], rules: [] };
    expect(parseRestoreFile(serializeFullBackup(ledger(), minimal))).toEqual({
      kind: 'full', ledger: ledger(), categorySettings: minimal,
    });
  });

  it('accepts plain, compact, and signed-movement financial files without inventing settings', () => {
    const movement = ledger();
    movement.state.entries[0] = { ...movement.state.entries[0], type: 'movement', amount: -250 };
    for (const data of [ledger(), bankLedger(), movement]) {
      const wire = serializeBackup(data);
      expect(parseRestoreFile(wire)).toEqual({ kind: 'ledger', ledger: parseBackupText(wire) });
      expect(parseRestoreFile(serializeFullBackup(data, categories))).toEqual({
        kind: 'full', ledger: data, categorySettings: categories,
      });
    }
  });

  it('rejects the entire file for unknown versions, fields, missing sections, or corrupt component data', () => {
    const full = JSON.parse(serializeFullBackup(ledger(), categories));
    const compact = JSON.parse(serializeFullBackup(bankLedger(), categories));
    for (const payload of [
      { ...full, version: 2 }, { ...full, added: true }, { ...full, ledger: undefined },
      { ...full, categorySettings: undefined }, { ...full, ledger: { ...full.ledger, state: null } },
      { ...compact, ledger: { ...compact.ledger, codec: 'future-codec' } },
      { ...full, categorySettings: { ...categories, keywordPackVersion: 42 } },
      { ...full, categorySettings: { ...categories, rules: [{ ...categories.rules[0], mode: 'unknown' }] } },
      { ...full, categorySettings: { ...categories, extra: true } },
    ]) expect(() => parseRestoreFile(JSON.stringify(payload))).toThrow();
    expect(() => parseRestoreFile('{"app":')).toThrow();
  });

  it('enforces raw-file, nested category-byte and nesting limits before applying any restore', () => {
    const full = JSON.parse(serializeFullBackup(ledger(), categories));
    expect(() => parseRestoreFile(' '.repeat(MAX_RESTORE_BYTES + 1))).toThrow(/32 MiB/);
    const padded = ' '.repeat(CATEGORY_SETTINGS_LIMIT) + 'Kafe';
    expect(() => parseRestoreFile(JSON.stringify({ ...full,
      categorySettings: { version: 1, names: [UNCATEGORIZED, padded], rules: [] },
    }))).toThrow(/ukuran/i);
    const nested = '['.repeat(70) + 'null' + ']'.repeat(70);
    expect(() => parseRestoreFile(JSON.stringify(full).replace('"rules":[', '"rules":[' + nested + ','))).toThrow(/kedalaman/i);
  });
});
