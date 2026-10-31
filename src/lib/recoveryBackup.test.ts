import { describe, expect, it, vi, afterEach } from 'vitest';
import { createEmptyState, MAX_BACKUP_BYTES, MAX_RESTORE_BYTES, parseBackupText, readStored, serializeBackup, type StoredData } from './storage';

function fixture(count = 0): StoredData {
  const data: StoredData = { app: 'uangku', version: 1, demo: false, state: createEmptyState() };
  data.state.wallets = [{ id: 'bank', name: 'Synthetic TRY bank', currency: 'TRY', kind: 'bank', openingBalance: 1_000_000 }];
  data.state.entries = Array.from({ length: count }, (_, i) => ({ id: `fixture-${i}`, date: '2020-01-01', type: 'expense', walletId: 'bank', amount: 1, category: '', note: '' }));
  return data;
}

afterEach(() => vi.unstubAllGlobals());
describe('minimum recovery backup compatibility and non-destructive reads', () => {
  it('roundtrips the actual compact export and legacy pretty JSON larger than 8 MiB', () => {
    const data = fixture(46_000);
    const compact = serializeBackup(data);
    const pretty = JSON.stringify(data, null, 2);
    expect(new TextEncoder().encode(compact).byteLength).toBeLessThan(MAX_BACKUP_BYTES);
    expect(new TextEncoder().encode(pretty).byteLength).toBeGreaterThan(MAX_BACKUP_BYTES);
    expect(parseBackupText(compact)).toEqual(data);
    expect(parseBackupText(pretty)).toEqual(data);
    expect(serializeBackup(parseBackupText(pretty))).toBe(compact);
  });
  it('retains Unicode in a byte-counted roundtrip', () => {
    const data = fixture(1); data.state.entries[0].note = 'Ödeme — 合成 💰';
    const text = serializeBackup(data);
    expect(new TextEncoder().encode(text).byteLength).toBeGreaterThan(text.length);
    expect(parseBackupText(text)).toEqual(data);
  });
  it('rejects oversized logical ledgers even if the input raw parsing budget is larger', () => {
    const data = fixture(27_000);
    for (const entry of data.state.entries) entry.note = 'x'.repeat(240);
    expect(() => serializeBackup(data)).toThrow(/8 MB/);
    expect(() => parseBackupText(JSON.stringify(data))).toThrow(/8 MB/);
  });
  it('bounds raw parsing and rejects invalid text without any storage writes', () => {
    const setItem = vi.fn(); vi.stubGlobal('localStorage', { getItem: () => null, setItem });
    expect(() => parseBackupText(' '.repeat(MAX_RESTORE_BYTES + 1))).toThrow(/32 MiB/);
    expect(() => parseBackupText('{broken')).toThrow();
    expect(setItem).not.toHaveBeenCalled();
  });
  it('retains valid source metadata and fails closed on unknown metadata without writing', () => {
    const raw = JSON.stringify({ ...fixture(), metadata: { policy: 'unverified-unless-linked', facts: [], links: [], statements: [] } });
    const setItem = vi.fn(); vi.stubGlobal('localStorage', { getItem: () => raw, setItem });
    const restored = parseBackupText(raw);
    expect(restored.metadata).toEqual(JSON.parse(raw).metadata);
    expect(parseBackupText(serializeBackup(restored))).toEqual(restored);
    const invalidRaw = JSON.stringify({...JSON.parse(raw), metadata: {...JSON.parse(raw).metadata, unsupported: true}});
    vi.stubGlobal('localStorage', { getItem: () => invalidRaw, setItem });
    expect(() => parseBackupText(invalidRaw)).toThrow(/metadata/);
    const read = readStored();
    expect(read.blocked).toBe(true); expect(read.token).toBe(invalidRaw); expect(read.persisted).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });
});
