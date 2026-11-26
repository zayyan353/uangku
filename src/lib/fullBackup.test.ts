import { describe, expect, it } from 'vitest';
import { CATEGORY_SETTINGS_LIMIT, UNCATEGORIZED, validateCategorySettings, type CategorySettings } from './categorySettings';
import { parseRestoreFile, restoreFailure, RestoreRefusal, serializeFullBackup, UNREADABLE_RESTORE_FILE } from './fullBackup';
import { BUDGETS_LIMIT } from './budgets';
import { TEMPLATES_LIMIT } from './transactionTemplates';
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

  it('MW-88a: a file that is not a readable Uangku backup gets one plain message, with the parser text only as a detail', () => {
    const failure = (text: string) => { try { parseRestoreFile(text); } catch (reason) { return restoreFailure(reason); } throw new Error('Expected a refusal'); };
    const plain = 'File ini bukan cadangan Uangku yang bisa dibaca. Pilih file uangku-lengkap-….json atau uangku-cadangan-….json.';
    expect(UNREADABLE_RESTORE_FILE).toBe(plain);
    const whole = serializeFullBackup(ledger(), categories);
    // Not JSON, a backup cut off mid-file, JSON of another kind, and an Uangku file whose content fails validation.
    for (const text of ['Ini bukan cadangan', whole.slice(0, Math.floor(whole.length / 2)), '{"halo":"dunia"}', '[]', 'null', '42', '"teks"',
      JSON.stringify({ ...JSON.parse(whole), added: true }), JSON.stringify({ app: 'uangku', version: 1, demo: false, state: null })]) {
      const shown = failure(text);
      expect(shown.message, text.slice(0, 40)).toBe(plain);
      expect(shown.detail.length, text.slice(0, 40)).toBeGreaterThan(0);
      expect(shown.message).not.toMatch(/JSON|Unexpected|Unterminated|position/);
    }
    expect(failure(whole.slice(0, Math.floor(whole.length / 2))).detail).toMatch(/JSON/);
    // Refusals that already say what is wrong are shown as they are, with nothing to open.
    expect(failure(' '.repeat(MAX_RESTORE_BYTES + 1))).toEqual({ message: 'Ukuran mentah file pemulihan maksimal 32 MiB.', detail: '' });
    const parsed = JSON.parse(whole);
    const newer = 'Data ini dibuat oleh Uangku versi lebih baru. Muat ulang halaman.';
    for (const value of [
      { ...parsed, version: 2, extra: true },
      { ...parsed, categorySettings: { version: 2, extra: true } },
      { ...parsed, categorySettings: { ...parsed.categorySettings, keywordPackVersion: 999 } },
      { ...parsed, ledger: { app: 'uangku', version: 4 } },
      { app: 'uangku', version: 2, codec: 'table-tuples-v7', extra: true },
      { app: 'uangku', version: 1, demo: false, state: { version: 2, wallets: [], entries: [] } },
    ]) expect(failure(JSON.stringify(value))).toEqual({ message: newer, detail: '' });
    for (const value of [
      { ...parsed, version: '2' }, { ...parsed, version: 0 }, { ...parsed, version: 1.5 },
      { ...parsed, categorySettings: { ...parsed.categorySettings, keywordPackVersion: '8' } },
      { app: 'lain', version: 9 }, { app: 'uangku', version: 2, codec: 'future-codec' },
      { app: 'uangku', version: 1, demo: false, state: { version: -1, wallets: [], entries: [] } },
    ]) expect(failure(JSON.stringify(value)).message).toBe(plain);
    // The rule is the whole sentence, not the words inside a longer validator text.
    expect(restoreFailure(new Error('Metadata sumber tidak valid: Versi fingerprint sumber belum didukung.')).message).toBe(plain);
    expect(restoreFailure(new RestoreRefusal('Selesaikan penyimpanan dulu.'))).toEqual({ message: 'Selesaikan penyimpanan dulu.', detail: '' });
    // Anything else thrown on the way is treated as unreadable, never passed through.
    expect(restoreFailure(new TypeError('Cannot read properties of null'))).toEqual({ message: plain, detail: 'Cannot read properties of null' });
    expect(restoreFailure(undefined)).toEqual({ message: plain, detail: '' });
    expect(() => parseRestoreFile(whole)).not.toThrow();
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

describe('optional budgets in full backups (MW-12a)', () => {
  const budgets = { IDR: { 'Makan & minum': 150000000 }, TRY: { 'Langganan pribadi': 9999 } };

  it('keeps files without budgets byte-identical to the earlier format', () => {
    const legacy = `{"app":"uangku-full-backup","version":1,"ledger":${serializeBackup(ledger())},"categorySettings":${JSON.stringify(validateCategorySettings(categories))}}`;
    expect(serializeFullBackup(ledger(), categories)).toBe(legacy);
    expect(serializeFullBackup(ledger(), categories, {})).toBe(legacy);
    expect(serializeFullBackup(ledger(), categories, { IDR: {} })).toBe(legacy);
    expect(Object.keys(JSON.parse(legacy))).toEqual(['app', 'version', 'ledger', 'categorySettings']);
  });

  it('restores older full backups that have no budget section', () => {
    const legacy = `{"app":"uangku-full-backup","version":1,"ledger":${serializeBackup(ledger())},"categorySettings":${JSON.stringify(validateCategorySettings(categories))}}`;
    const restored = parseRestoreFile(legacy);
    expect(restored.kind).toBe('full');
    if (restored.kind !== 'full') return;
    expect(restored.budgets).toBeUndefined();
    expect('budgets' in restored).toBe(false);
    expect(restored.categorySettings).toEqual(categories);
  });

  it('round-trips budgets after the existing sections, leaving ledger and categories unchanged', () => {
    const text = serializeFullBackup(bankLedger(), categories, budgets);
    const file = JSON.parse(text);
    expect(Object.keys(file)).toEqual(['app', 'version', 'ledger', 'categorySettings', 'budgets']);
    expect(file.version).toBe(1);
    expect(text.startsWith(serializeFullBackup(bankLedger(), categories).slice(0, -1))).toBe(true);
    const restored = parseRestoreFile(text);
    if (restored.kind !== 'full') throw new Error('expected full backup');
    expect(restored.budgets).toEqual(budgets);
    expect(restored.categorySettings).toEqual(categories);
    expect(serializeBackup(restored.ledger)).toBe(serializeBackup(parseBackupText(serializeBackup(bankLedger()))));
  });

  it('rejects the whole file when the budget section is invalid', () => {
    const base = JSON.parse(serializeFullBackup(ledger(), categories));
    for (const bad of [null, [], { XYZ: { A: 1 } }, { IDR: { Belanja: -1 } }, { IDR: { Belanja: 1.5 } }, { IDR: { [UNCATEGORIZED]: 1 } }]) {
      expect(() => parseRestoreFile(JSON.stringify({ ...base, budgets: bad })), JSON.stringify(bad)).toThrow();
    }
    expect(() => parseRestoreFile(JSON.stringify({ ...base, budgets: { IDR: { A: 1 } }, extra: 1 }))).toThrow(/extra/);
  });

  it('bounds the budget section before validating it', () => {
    const base = JSON.parse(serializeFullBackup(ledger(), categories));
    const huge = { IDR: Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`${'x'.repeat(60)}${i}`, 1])) };
    expect(JSON.stringify(huge).length).toBeGreaterThan(BUDGETS_LIMIT);
    expect(() => parseRestoreFile(JSON.stringify({ ...base, budgets: huge }))).toThrow();
  });
});

describe('optional templates in full backups (MW-13a)', () => {
  const templates = [{ id: 't1', name: 'Kopi pagi', type: 'expense' as const, walletId: 'w1', currency: 'TRY' as const, category: 'Makan & minum', amount: 4500, note: 'Kopi' }];
  const budgets = { IDR: { 'Makan & minum': 150000000 } };

  it('keeps files without templates identical to the earlier format', () => {
    expect(serializeFullBackup(ledger(), categories, {}, [])).toBe(serializeFullBackup(ledger(), categories));
    expect(serializeFullBackup(ledger(), categories, budgets, [])).toBe(serializeFullBackup(ledger(), categories, budgets));
  });

  it('restores backups without a template section and leaves templates undefined', () => {
    const restored = parseRestoreFile(serializeFullBackup(ledger(), categories, budgets));
    if (restored.kind !== 'full') throw new Error('expected full backup');
    expect('templates' in restored).toBe(false);
    expect(restored.budgets).toEqual(budgets);
  });

  it('round-trips templates after the other sections', () => {
    const text = serializeFullBackup(ledger(), categories, budgets, templates);
    expect(Object.keys(JSON.parse(text))).toEqual(['app', 'version', 'ledger', 'categorySettings', 'budgets', 'templates']);
    expect(Object.keys(JSON.parse(serializeFullBackup(ledger(), categories, {}, templates)))).toEqual(['app', 'version', 'ledger', 'categorySettings', 'templates']);
    const restored = parseRestoreFile(text);
    if (restored.kind !== 'full') throw new Error('expected full backup');
    expect(restored.templates).toEqual(templates);
    expect(restored.budgets).toEqual(budgets);
  });

  it('rejects the whole file when the template section is invalid or oversized', () => {
    const base = JSON.parse(serializeFullBackup(ledger(), categories));
    for (const bad of [null, {}, [{ ...templates[0], amount: -1 }], [{ ...templates[0], type: 'transfer' }], [templates[0], templates[0]]]) {
      expect(() => parseRestoreFile(JSON.stringify({ ...base, templates: bad })), JSON.stringify(bad)).toThrow();
    }
    const huge = Array.from({ length: 40 }, (_, i) => ({ ...templates[0], id: `t${i}`, name: `T${i}`, note: 'x'.repeat(2000) }));
    expect(JSON.stringify(huge).length).toBeGreaterThan(TEMPLATES_LIMIT);
    expect(() => parseRestoreFile(JSON.stringify({ ...base, templates: huge }))).toThrow();
  });
});
