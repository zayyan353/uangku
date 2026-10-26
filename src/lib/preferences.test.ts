import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PREFERENCES_KEY, preferredDestination, preferredWallet, readPreferences, writePreferences,
  type Preferences,
} from './preferences';
import type { Wallet } from './finance';

const wallets: Wallet[] = [
  { id: 'bca', name: 'BCA', currency: 'IDR', kind: 'bank', openingBalance: 0 },
  { id: 'ziraat', name: 'Ziraat', currency: 'TRY', kind: 'bank', openingBalance: 0 },
  { id: 'papara', name: 'Papara', currency: 'TRY', kind: 'ewallet', openingBalance: 0 },
  { id: 'cash-try', name: 'Cash TL', currency: 'TRY', kind: 'cash', openingBalance: 0 },
  { id: 'cash-idr', name: 'Cash IDR', currency: 'IDR', kind: 'cash', openingBalance: 0 },
];

afterEach(() => vi.unstubAllGlobals());

describe('optional UI preferences stay separate from financial data', () => {
  it('reads sanitized currency and wallet hints without writing or reading the ledger', () => {
    const raw = JSON.stringify({ currency: 'TRY', lastWallets: { TRY: 'cash-try', IDR: 'bca', EUR: 'discard' }, balance: 999 });
    const getItem = vi.fn(() => raw), setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem, setItem });
    expect(readPreferences()).toEqual({ currency: 'TRY', lastWallets: { TRY: 'cash-try', IDR: 'bca' } });
    expect(getItem).toHaveBeenCalledExactlyOnceWith(PREFERENCES_KEY);
    expect(setItem).not.toHaveBeenCalled();
  });

  it.each([null, '{bad', 'null', '[]', JSON.stringify({ currency: 'EUR', lastWallets: null })])('falls back safely for missing or invalid preferences', (text) => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem: () => text, setItem });
    expect(readPreferences()).toEqual({ currency: 'IDR', lastWallets: {} });
    expect(setItem).not.toHaveBeenCalled();
  });

  it('discards malformed wallet hints while preserving valid hints', () => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ currency: 'USD',
      lastWallets: { IDR: 123, TRY: ' ', USD: 'dollars' } }) });
    expect(readPreferences()).toEqual({ currency: 'USD', lastWallets: { USD: 'dollars' } });
  });

  it('does not throw when browser storage cannot be read or written', () => {
    vi.stubGlobal('localStorage', { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } });
    expect(readPreferences()).toEqual({ currency: 'IDR', lastWallets: {} });
    expect(() => writePreferences({ currency: 'TRY', lastWallets: { TRY: 'ziraat' } })).not.toThrow();
    vi.stubGlobal('localStorage', undefined);
    expect(readPreferences()).toEqual({ currency: 'IDR', lastWallets: {} });
    expect(() => writePreferences({ currency: 'IDR', lastWallets: {} })).not.toThrow();
  });

  it('writes only the preference key with documented fields', () => {
    const setItem = vi.fn(), getItem = vi.fn();
    vi.stubGlobal('localStorage', { setItem, getItem });
    writePreferences({ currency: 'TRY', lastWallets: { TRY: 'cash-try' }, state: 'discard' } as Preferences);
    expect(setItem).toHaveBeenCalledExactlyOnceWith(PREFERENCES_KEY, JSON.stringify({ currency: 'TRY', lastWallets: { TRY: 'cash-try' } }));
    expect(getItem).not.toHaveBeenCalled();
  });
});

describe('last wallet selection follows the requested currency', () => {
  it('prefers a valid cash wallet remembered for the currency', () => {
    expect(preferredWallet(wallets, 'TRY', { currency: 'IDR', lastWallets: { TRY: 'cash-try' } })).toBe('cash-try');
  });

  it('ignores stale or cross-currency IDs rather than debiting the wrong wallet', () => {
    expect(preferredWallet(wallets, 'TRY', { currency: 'TRY', lastWallets: { TRY: 'removed' } })).toBe('ziraat');
    expect(preferredWallet(wallets, 'TRY', { currency: 'TRY', lastWallets: { TRY: 'bca' } })).toBe('ziraat');
  });

  it('falls back to the first wallet only when the requested currency has none', () => {
    expect(preferredWallet(wallets, 'USD', { currency: 'USD', lastWallets: {} })).toBe('bca');
    expect(preferredWallet([], 'USD', { currency: 'USD', lastWallets: {} })).toBeUndefined();
  });
});

describe('transfer destination defaults reduce accidental currency changes', () => {
  it('prefers cash of the same currency from a bank or e-wallet', () => {
    expect(preferredDestination(wallets, 'ziraat')).toBe('cash-try');
    expect(preferredDestination(wallets, 'papara')).toBe('cash-try');
  });

  it('prefers a bank of the same currency from cash', () => {
    expect(preferredDestination(wallets, 'cash-try')).toBe('ziraat');
  });

  it('uses another same-currency wallet before suggesting cross-currency transfer', () => {
    const withoutCash = wallets.filter(wallet => wallet.id !== 'cash-try');
    expect(preferredDestination(withoutCash, 'ziraat')).toBe('papara');
    const withoutBank = wallets.filter(wallet => wallet.id !== 'ziraat');
    expect(preferredDestination(withoutBank, 'cash-try')).toBe('papara');
  });

  it('handles missing source or destination wallets without returning the source', () => {
    expect(preferredDestination(wallets.filter(wallet => wallet.currency !== 'TRY' || wallet.id === 'ziraat'), 'ziraat')).toBe('bca');
    expect(preferredDestination([wallets[0]], 'bca')).toBe('');
    expect(preferredDestination([], 'missing')).toBe('');
    expect(preferredDestination(wallets, 'removed')).toBe('bca');
  });
});
