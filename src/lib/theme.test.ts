import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, DARK_QUERY, readTheme, resolveTheme, sanitizeTheme, systemUsesDark, THEME_KEY, writeTheme } from './theme';

afterEach(() => vi.unstubAllGlobals());

function documentStub() {
  const setAttribute = vi.fn();
  const target = { documentElement: { dataset: {} as Record<string, string>, style: { colorScheme: '' } },
    querySelector: vi.fn(() => ({ setAttribute })) };
  return { target, setAttribute };
}

describe('appearance preferences', () => {
  it.each(['system', 'light', 'dark'] as const)('reads and writes %s without touching financial preferences', preference => {
    const ledger = '{"version":1,"transactions":[]}';
    const walletHints = '{"currency":"TRY","lastWallets":{"TRY":"cash"}}';
    const values = new Map([['uangku:v1', ledger], ['uangku:preferences:v1', walletHints], [THEME_KEY, preference]]);
    const getItem = vi.fn((key: string) => values.get(key) ?? null);
    const setItem = vi.fn((key: string, value: string) => values.set(key, value));
    vi.stubGlobal('localStorage', { getItem, setItem });
    expect(readTheme()).toBe(preference);
    expect(writeTheme(preference)).toBe(true);
    expect(getItem).toHaveBeenCalledExactlyOnceWith(THEME_KEY);
    expect(setItem).toHaveBeenCalledExactlyOnceWith(THEME_KEY, preference);
    expect(values.get('uangku:v1')).toBe(ledger);
    expect(values.get('uangku:preferences:v1')).toBe(walletHints);
  });

  it.each([null, undefined, '', 'DARK', '"dark"', '{bad', {}, 1])('falls back to system for invalid values (%j)', value => {
    expect(sanitizeTheme(value)).toBe('system');
    vi.stubGlobal('localStorage', { getItem: () => value });
    expect(readTheme()).toBe('system');
  });

  it('handles unavailable or throwing storage and media queries', () => {
    vi.stubGlobal('localStorage', undefined);
    vi.stubGlobal('matchMedia', undefined);
    expect(readTheme()).toBe('system');
    expect(writeTheme('dark')).toBe(false);
    expect(systemUsesDark()).toBe(false);
    vi.stubGlobal('localStorage', { getItem() { throw Error('SecurityError'); }, setItem() { throw Error('QuotaExceededError'); } });
    vi.stubGlobal('matchMedia', () => { throw Error('Unavailable'); });
    expect(readTheme()).toBe('system');
    expect(writeTheme('light')).toBe(false);
    expect(systemUsesDark()).toBe(false);
  });

  it('uses only the device dark-mode query', () => {
    const matchMedia = vi.fn(() => ({ matches: true }));
    vi.stubGlobal('matchMedia', matchMedia);
    expect(systemUsesDark()).toBe(true);
    expect(matchMedia).toHaveBeenCalledExactlyOnceWith(DARK_QUERY);
  });
});

describe('first paint agrees with mounted theme', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const bootstrap = html.match(/<script id="uangku-theme-bootstrap">([\s\S]*?)<\/script>/)?.[1];
  if (!bootstrap) throw new Error('Theme bootstrap missing');

  for (const stored of [null, 'system', 'light', 'dark', 'invalid']) {
    it.each([false, true])(`resolves stored ${stored} and system dark=%s before React`, systemDark => {
      const early = documentStub();
      const getItem = vi.fn(() => stored), setItem = vi.fn();
      runInNewContext(bootstrap, { document: early.target, localStorage: { getItem, setItem }, matchMedia: () => ({ matches: systemDark }) });
      const mounted = documentStub();
      const expected = resolveTheme(sanitizeTheme(stored), systemDark);
      expect(applyTheme(sanitizeTheme(stored), systemDark, mounted.target as unknown as Document)).toBe(expected);
      expect(early.target.documentElement).toEqual(mounted.target.documentElement);
      expect(early.setAttribute.mock.calls).toEqual(mounted.setAttribute.mock.calls);
      expect(early.target.documentElement.dataset.theme).toBe(expected);
      expect(getItem).toHaveBeenCalledExactlyOnceWith(THEME_KEY);
      expect(setItem).not.toHaveBeenCalled();
    });
  }

  it('renders safely when storage and device preference are unavailable', () => {
    const { target } = documentStub();
    runInNewContext(bootstrap, { document: target, localStorage: { getItem() { throw Error('blocked'); } } });
    expect(target.documentElement.dataset.theme).toBe('light');
    expect(applyTheme('system', false, undefined)).toBe('light');
  });
});
