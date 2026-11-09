import { describe, expect, it } from 'vitest';
import { LAST_BACKUP_KEY, ledgerFingerprint, readLastBackup, recordBackup } from './backupReminder';

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); },
  };
}

const LEDGER = '{"app":"uangku","version":1,"demo":false,"state":{"wallets":[],"entries":[]}}';

describe('ledgerFingerprint', () => {
  it('is stable for the same text and includes the length', () => {
    expect(ledgerFingerprint(LEDGER)).toBe(ledgerFingerprint(String(LEDGER)));
    expect(ledgerFingerprint(LEDGER)).toMatch(new RegExp(`^${LEDGER.length}:[0-9a-f]{14}$`));
    expect(ledgerFingerprint('')).toMatch(/^0:[0-9a-f]{14}$/);
  });

  it('changes when one character changes, even at the same length', () => {
    const edited = LEDGER.replace('"entries":[]', '"entries":[1]');
    const sameLength = LEDGER.replace('uangku', 'uangkU');
    expect(ledgerFingerprint(edited)).not.toBe(ledgerFingerprint(LEDGER));
    expect(sameLength.length).toBe(LEDGER.length);
    expect(ledgerFingerprint(sameLength)).not.toBe(ledgerFingerprint(LEDGER));
  });

  it('handles non-ASCII text and large input', () => {
    expect(ledgerFingerprint('Café ₺')).not.toBe(ledgerFingerprint('Cafe ₺'));
    const big = 'x'.repeat(1_000_000);
    expect(ledgerFingerprint(big)).toMatch(/^1000000:[0-9a-f]{14}$/);
  });
});

describe('recordBackup / readLastBackup', () => {
  it('stores only { at, fingerprint } under its own key', () => {
    const storage = memoryStorage({ 'uangku:v1': LEDGER });
    const at = new Date('2026-11-09T17:30:00.000Z');
    expect(recordBackup(LEDGER, at, storage)).toBe(true);
    expect(JSON.parse(storage.items.get(LAST_BACKUP_KEY)!)).toEqual({ at: '2026-11-09T17:30:00.000Z', fingerprint: ledgerFingerprint(LEDGER) });
    expect(storage.items.get('uangku:v1')).toBe(LEDGER);
    expect([...storage.items.keys()].sort()).toEqual(['uangku:last-backup:v1', 'uangku:v1']);
    expect(readLastBackup(storage)).toEqual({ at: '2026-11-09T17:30:00.000Z', fingerprint: ledgerFingerprint(LEDGER) });
  });

  it('overwrites the previous record with the latest backup', () => {
    const storage = memoryStorage();
    recordBackup(LEDGER, new Date('2026-11-01T00:00:00.000Z'), storage);
    recordBackup(`${LEDGER} `, new Date('2026-11-09T00:00:00.000Z'), storage);
    expect(readLastBackup(storage)).toEqual({ at: '2026-11-09T00:00:00.000Z', fingerprint: ledgerFingerprint(`${LEDGER} `) });
  });

  it('reports failure without throwing when storage is missing or full', () => {
    expect(recordBackup(LEDGER, new Date(), undefined)).toBe(false);
    const full = { getItem: () => null, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } };
    expect(recordBackup(LEDGER, new Date(), full)).toBe(false);
    expect(recordBackup(LEDGER, new Date(Number.NaN), memoryStorage())).toBe(false);
  });

  it('returns null for absent, unreadable or malformed records', () => {
    expect(readLastBackup(undefined)).toBeNull();
    expect(readLastBackup(memoryStorage())).toBeNull();
    const fingerprint = ledgerFingerprint(LEDGER);
    const cases = [
      'not json',
      'null',
      '[]',
      JSON.stringify({ at: 'yesterday', fingerprint }),
      JSON.stringify({ at: '2026-11-09', fingerprint }),
      JSON.stringify({ at: '2026-11-09T00:00:00.000Z' }),
      JSON.stringify({ at: '2026-11-09T00:00:00.000Z', fingerprint: 'abc' }),
      JSON.stringify({ at: '2026-11-09T00:00:00.000Z', fingerprint: 42 }),
      JSON.stringify({ at: '2026-11-09T00:00:00.000Z', fingerprint, pad: 'x'.repeat(600) }),
    ];
    for (const text of cases) expect(readLastBackup(memoryStorage({ [LAST_BACKUP_KEY]: text }))).toBeNull();
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => undefined };
    expect(readLastBackup(throwing)).toBeNull();
  });

  it('drops unknown fields when reading', () => {
    const storage = memoryStorage({ [LAST_BACKUP_KEY]: JSON.stringify({ at: '2026-11-09T00:00:00.000Z', fingerprint: ledgerFingerprint(LEDGER), extra: true }) });
    expect(readLastBackup(storage)).toEqual({ at: '2026-11-09T00:00:00.000Z', fingerprint: ledgerFingerprint(LEDGER) });
  });
});
