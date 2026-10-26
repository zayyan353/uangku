import { CURRENCIES, type Currency, type Wallet } from './finance';

export interface Preferences {
  currency: Currency;
  lastWallets: Partial<Record<Currency, string>>;
}

export const PREFERENCES_KEY = 'uangku:preferences:v1';

function defaults(): Preferences {
  return { currency: 'IDR', lastWallets: {} };
}

function sanitize(value: unknown): Preferences {
  const result = defaults();
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return result;
  const source = value as Record<string, unknown>;
  if (CURRENCIES.some(c => c.code === source.currency)) result.currency = source.currency as Currency;
  if (source.lastWallets === null || typeof source.lastWallets !== 'object' || Array.isArray(source.lastWallets)) return result;
  const lastWallets = source.lastWallets as Record<string, unknown>;
  for (const { code } of CURRENCIES) {
    const id = lastWallets[code];
    if (typeof id === 'string' && id.trim() && id.length <= 120) result.lastWallets[code] = id;
  }
  return result;
}

/** Optional UI hints only: never reads or changes the financial ledger. */
export function readPreferences(): Preferences {
  try {
    const text = globalThis.localStorage?.getItem(PREFERENCES_KEY);
    if (!text || text.length > 8_192) return defaults();
    return sanitize(JSON.parse(text));
  } catch {
    return defaults();
  }
}

/** Preference failures must never interrupt saving a financial transaction. */
export function writePreferences(prefs: Preferences): void {
  try {
    globalThis.localStorage?.setItem(PREFERENCES_KEY, JSON.stringify(sanitize(prefs)));
  } catch {
    // Browser storage may be unavailable or full. These hints are optional.
  }
}

/** Revalidate wallet identity/currency each time; restored or removed IDs may be stale. */
export function preferredWallet(wallets: Wallet[], currency: Currency, prefs: Preferences): string | undefined {
  const lastId = prefs.lastWallets?.[currency];
  return wallets.find(wallet => wallet.id === lastId && wallet.currency === currency)?.id
    ?? wallets.find(wallet => wallet.currency === currency)?.id
    ?? wallets[0]?.id;
}

/** Common cash ↔ bank flow first, then another wallet in the same currency. */
export function preferredDestination(wallets: Wallet[], fromId: string): string {
  const source = wallets.find(wallet => wallet.id === fromId);
  const others = wallets.filter(wallet => wallet.id !== fromId);
  if (!source) return others[0]?.id ?? '';
  const sameCurrency = others.filter(wallet => wallet.currency === source.currency);
  const desiredKind = source.kind === 'cash' ? 'bank' : 'cash';
  return sameCurrency.find(wallet => wallet.kind === desiredKind)?.id
    ?? sameCurrency[0]?.id
    ?? others[0]?.id
    ?? '';
}
