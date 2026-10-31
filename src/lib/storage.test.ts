import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyState, makeDemoData, readStored, serializeBackup, STORAGE_KEY, validateBackup, type StoredData } from './storage';
import { walletBalance, type Entry } from './finance';

function empty(): StoredData {
  return { app: 'uangku', version: 1, demo: false, state: createEmptyState() };
}

function transaction(overrides: Partial<Entry> = {}): Entry {
  return { id: 't-1', date: '2026-10-23', type: 'expense', walletId: 'bca-idr',
    amount: 500, category: 'Belanja', note: '', ...overrides };
}

afterEach(() => vi.unstubAllGlobals());

describe('empty and demonstration state', () => {
  it('starts with ten zero-balance bank/e-wallet accounts and no cash bookkeeping', () => {
    const state = createEmptyState();
    expect(state.wallets).toHaveLength(10);
    expect(state.wallets.filter((wallet) => wallet.currency === 'IDR')).toHaveLength(8);
    expect(state.wallets.filter((wallet) => wallet.currency === 'TRY')).toHaveLength(2);
    expect(state.wallets.filter((wallet) => wallet.currency === 'USD')).toHaveLength(0);
    expect(state.wallets.some((wallet) => wallet.kind === 'cash')).toBe(false);
    expect(state.wallets.every((wallet) => wallet.openingBalance === 0)).toBe(true);
    expect(state.entries).toEqual([]);
    expect(new Set(state.wallets.map((wallet) => wallet.id)).size).toBe(10);
  });

  it('validates a complete demo without reusing mutable input objects', () => {
    const input = makeDemoData();
    const output = validateBackup(JSON.parse(serializeBackup(input)));
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
    expect(output.state.wallets[0]).not.toBe(input.state.wallets[0]);
    expect(output.state.entries[0]).not.toBe(input.state.entries[0]);
  });

  it('allows empty wallets when there are no transactions', () => {
    expect(validateBackup({ ...empty(), state: { version: 1, wallets: [], entries: [] } }).state.wallets).toEqual([]);
  });
});

describe('backup validation', () => {
  it('preserves documented transfer fields and rejects unsupported fields rather than dropping source data', () => {
    const data = empty();
    data.state.entries = [transaction({ type: 'transfer', toWalletId: 'ziraat-try', amount: 1_000,
      toAmount: 2, rate: 0.002, fee: 100, sourceKey: 'source', toSourceKey: 'destination', importBatch: 'batch' })];
    const source = { ...data, external: 'discard', state: { ...data.state, unknown: 'discard',
      wallets: data.state.wallets.map((wallet) => ({ ...wallet, extra: true })),
      entries: data.state.entries.map((entry) => ({ ...entry, extra: true })),
    } };
    expect(() => validateBackup(source)).toThrow(/tidak didukung/);
    expect(validateBackup(data)).toEqual(data);
    expect(validateBackup(data).state.entries[0].toSourceKey).toBe('destination');
  });

  it('validates signed unreviewed entries without asserting income', () => {
    const data = empty();
    data.state.entries = [transaction({ type: 'unreviewed', amount: -500, sourceKey: 'source' })];
    const restored = validateBackup(data);
    expect(restored.state.entries[0].type).toBe('unreviewed');
    expect(walletBalance(restored.state, 'bca-idr')).toBe(-500);
  });

  it.each([null, [], {}, { app: 'other', version: 1 }, { ...empty(), version: 2 },
    { ...empty(), demo: 'false' }, { ...empty(), state: null },
    { ...empty(), state: { version: 2, wallets: [], entries: [] } },
    { ...empty(), state: { version: 1, wallets: 'wrong', entries: [] } },
  ])('rejects a malformed envelope', (input) => expect(() => validateBackup(input)).toThrow(Error));

  it('rejects duplicate wallet and transaction IDs', () => {
    const data = empty();
    data.state.wallets.push({ ...data.state.wallets[0] });
    expect(() => validateBackup(data)).toThrow(/dompet.*berulang/);
    const entries = empty();
    entries.state.entries = [transaction(), transaction()];
    expect(() => validateBackup(entries)).toThrow(/transaksi.*berulang/);
  });

  it('rejects unknown currencies and wrong wallet types', () => {
    const data = empty();
    const wallet = data.state.wallets[0] as unknown as Record<string, unknown>;
    wallet.currency = 'ZZZ';
    expect(() => validateBackup(data)).toThrow(/mata uang/);
    wallet.currency = 'IDR';
    wallet.kind = 'credit-card';
    expect(() => validateBackup(data)).toThrow(/jenis dompet/);
  });

  it.each([
    { walletId: 'unknown' }, { amount: 0.5 }, { amount: NaN }, { amount: Infinity },
    { amount: Number.MAX_SAFE_INTEGER + 1 }, { date: '2026-02-30' },
    { type: 'unknown' }, { note: 123 }, { category: null },
    { note: 'x'.repeat(4_001) }, { sourceKey: 'x'.repeat(201) },
    { fee: -1 }, { rate: 0 }, { toAmount: 0 },
  ])('rejects malformed transaction fields %j', (override) => {
    const data = empty();
    data.state.entries = [{ ...transaction(), ...override } as Entry];
    expect(() => validateBackup(data)).toThrow(Error);
  });

  it('rejects missing required transaction fields', () => {
    const data = empty();
    const malformed = transaction() as unknown as Record<string, unknown>;
    delete malformed.note;
    data.state.entries = [malformed as unknown as Entry];
    expect(() => validateBackup(data)).toThrow(/Keterangan/);
  });

  it('rejects unknown destination wallets even on non-transfer entries', () => {
    const data = empty();
    data.state.entries = [transaction({ toWalletId: 'unknown' })];
    expect(() => validateBackup(data)).toThrow(/tujuan/);
  });

  it('rejects invalid FX transfers and same-wallet transfers', () => {
    const data = empty();
    data.state.entries = [transaction({ type: 'transfer', toWalletId: 'ziraat-try', toAmount: 100 })];
    expect(() => validateBackup(data)).toThrow(/kurs/);
    data.state.entries = [transaction({ type: 'transfer', toWalletId: 'bca-idr', toAmount: 500 })];
    expect(() => validateBackup(data)).toThrow(/harus berbeda/);
  });

  it('rejects wallet balances that would overflow exact integer arithmetic', () => {
    const data = empty();
    data.state.wallets[0].openingBalance = Number.MAX_SAFE_INTEGER;
    data.state.entries = [transaction({ type: 'income', amount: 1 })];
    expect(() => validateBackup(data)).toThrow(/Total saldo/);
  });

  it('rejects combined same-currency balances that overflow despite valid individual wallets', () => {
    const data = empty();
    data.state.wallets[0].openingBalance = Number.MAX_SAFE_INTEGER;
    data.state.wallets[1].openingBalance = 1;
    expect(() => validateBackup(data)).toThrow(/Total saldo/);
  });

  it('rejects monthly income totals that overflow despite an offsetting expense', () => {
    const data = empty();
    data.state.entries = [
      transaction({ id: 'in-1', type: 'income', amount: Number.MAX_SAFE_INTEGER }),
      transaction({ id: 'out-1', type: 'expense', amount: Number.MAX_SAFE_INTEGER }),
      transaction({ id: 'in-2', type: 'income', amount: 1 }),
    ];
    expect(() => validateBackup(data)).toThrow(/Total saldo atau transaksi/);
  });

  it('enforces wallet and transaction count limits before inspecting content', () => {
    const data = empty();
    const excessiveWallets = { ...data, state: { ...data.state, wallets: Array(101).fill(data.state.wallets[0]) } };
    expect(() => validateBackup(excessiveWallets)).toThrow(/100 dompet/);
    const excessiveEntries = { ...data, state: { ...data.state, entries: Array(100_001).fill(transaction()) } };
    expect(() => validateBackup(excessiveEntries)).toThrow(/100.000 transaksi/);
  });

  it('rejects a structurally valid backup larger than 8 MB', () => {
    const data = empty();
    data.state.entries = Array.from({ length: 2_100 }, (_, index) => transaction({
      id: `large-${index}`, amount: 1, note: 'x'.repeat(4_000),
    }));
    expect(() => validateBackup(data)).toThrow(/maksimal 8 MB/);
  });
});

describe('reading browser storage is non-destructive', () => {
  it('returns demo when the key has not been saved, without writing it', () => {
    const getItem = vi.fn(() => null);
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem, setItem });
    const result = readStored();
    expect(getItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect(result.data.demo).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.error).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('restores a valid backup without changing storage', () => {
    const data = empty();
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => JSON.stringify(data)), setItem });
    expect(readStored()).toEqual({ data, error: null, blocked: false, token: JSON.stringify(data), persisted: true });
    expect(setItem).not.toHaveBeenCalled();
  });

  it.each(['{broken json', JSON.stringify({ app: 'other' }), 'null'])('blocks malformed saved data without overwriting it', (text) => {
    const setItem = vi.fn();
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => text), setItem, removeItem });
    const result = readStored();
    expect(result.blocked).toBe(true);
    expect(result.data.demo).toBe(true);
    expect(result.error).toContain('Data lama belum diubah');
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('blocks persistence when browser storage access is denied', () => {
    vi.stubGlobal('localStorage', { getItem() { throw new Error('SecurityError'); } });
    expect(readStored()).toMatchObject({ blocked: true, error: expect.stringContaining('tidak tersedia') });
    vi.stubGlobal('localStorage', undefined);
    expect(readStored().blocked).toBe(true);
  });
});
