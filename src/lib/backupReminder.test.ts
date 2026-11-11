import { describe, expect, it } from 'vitest';
import {
  LAST_BACKUP_KEY, REMINDER_DISMISSED_KEY, backupReminderReason, dismissReminder, lastBackupLabel,
  ledgerFingerprint, readLastBackup, readReminderDismissed, recordBackup,
} from './backupReminder';

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

describe('lastBackupLabel', () => {
  it('says there is no backup yet', () => {
    expect(lastBackupLabel(null)).toBe('Cadangan terakhir: belum ada');
  });

  it('shows date and time in the given zone (the device zone in the app)', () => {
    const label = lastBackupLabel({ at: '2026-11-09T17:36:01.896Z', fingerprint: ledgerFingerprint(LEDGER) }, 'Europe/Istanbul');
    expect(label.startsWith('Cadangan terakhir: ')).toBe(true);
    expect(label).toContain('9 Nov 2026');
    expect(label).toMatch(/20[.:]36/);
  });

  it('uses the local date across UTC midnight', () => {
    expect(lastBackupLabel({ at: '2026-11-09T22:30:00.000Z', fingerprint: ledgerFingerprint(LEDGER) }, 'Europe/Istanbul')).toContain('10 Nov 2026');
    expect(lastBackupLabel({ at: '2026-11-09T22:30:00.000Z', fingerprint: ledgerFingerprint(LEDGER) }, 'America/Los_Angeles')).toContain('9 Nov 2026');
  });
});

describe('backupReminderReason', () => {
  const fingerprint = ledgerFingerprint(LEDGER);
  const changed = ledgerFingerprint(`${LEDGER} `);
  const at = '2026-11-01T10:00:00.000Z';
  const now = (iso: string) => Date.parse(iso);
  const base = { lastBackup: { at, fingerprint }, currentFingerprint: changed, today: '2026-11-09', dismissedOn: null };

  it('shows when there has never been a full backup', () => {
    expect(backupReminderReason({ ...base, lastBackup: null, now: now('2026-11-09T10:00:00Z') })).toBe('never');
    expect(backupReminderReason({ ...base, lastBackup: null, currentFingerprint: null, now: now('2026-11-09T10:00:00Z') })).toBe('never');
  });

  it('shows when older than seven days and the ledger changed', () => {
    expect(backupReminderReason({ ...base, now: now('2026-11-09T10:00:00Z') })).toBe('stale');
    expect(backupReminderReason({ ...base, currentFingerprint: null, now: now('2026-11-09T10:00:00Z') })).toBe('stale');
  });

  it('stays hidden when older than seven days but unchanged', () => {
    expect(backupReminderReason({ ...base, currentFingerprint: fingerprint, now: now('2026-11-30T10:00:00Z') })).toBeNull();
  });

  it('stays hidden within seven days even when changed, with the boundary exclusive', () => {
    expect(backupReminderReason({ ...base, now: now('2026-11-05T10:00:00Z') })).toBeNull();
    expect(backupReminderReason({ ...base, now: now('2026-11-08T10:00:00.000Z') })).toBeNull();
    expect(backupReminderReason({ ...base, now: now('2026-11-08T10:00:00.001Z') })).toBe('stale');
  });

  it('ignores a backup time in the future', () => {
    expect(backupReminderReason({ ...base, lastBackup: { at: '2026-12-01T00:00:00.000Z', fingerprint }, now: now('2026-11-09T10:00:00Z') })).toBeNull();
  });

  it('is hidden for the rest of the day it was closed, and back the next day', () => {
    expect(backupReminderReason({ ...base, lastBackup: null, dismissedOn: '2026-11-09', now: now('2026-11-09T10:00:00Z') })).toBeNull();
    expect(backupReminderReason({ ...base, dismissedOn: '2026-11-09', now: now('2026-11-09T10:00:00Z') })).toBeNull();
    expect(backupReminderReason({ ...base, lastBackup: null, dismissedOn: '2026-11-08', today: '2026-11-09', now: now('2026-11-09T10:00:00Z') })).toBe('never');
  });
});

describe('reminder dismissal storage', () => {
  it('round-trips a day and rejects malformed values', () => {
    const storage = memoryStorage();
    expect(readReminderDismissed(storage)).toBeNull();
    expect(dismissReminder('2026-11-09', storage)).toBe(true);
    expect(storage.items.get(REMINDER_DISMISSED_KEY)).toBe('2026-11-09');
    expect(readReminderDismissed(storage)).toBe('2026-11-09');
    expect(dismissReminder('besok', storage)).toBe(false);
    for (const bad of ['', 'tomorrow', '2026-11-9', '{"day":"2026-11-09"}']) {
      expect(readReminderDismissed(memoryStorage({ [REMINDER_DISMISSED_KEY]: bad }))).toBeNull();
    }
  });

  it('never throws on unavailable or full storage', () => {
    expect(readReminderDismissed(undefined)).toBeNull();
    expect(dismissReminder('2026-11-09', undefined)).toBe(false);
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
    expect(readReminderDismissed(broken)).toBeNull();
    expect(dismissReminder('2026-11-09', broken)).toBe(false);
  });
});
