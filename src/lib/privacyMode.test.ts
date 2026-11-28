import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRIVACY_KEY, readPrivacyMode, subscribePrivacyMode, writePrivacyMode } from './privacyMode';

afterEach(() => vi.unstubAllGlobals());

function preferenceBrowser() {
  const values = new Map<string, string>();
  const getItem = vi.fn((key: string) => values.get(key) ?? null);
  const setItem = vi.fn((key: string, value: string) => { values.set(key, value); });
  const tab = new EventTarget();
  vi.stubGlobal('window', tab);
  vi.stubGlobal('localStorage', { getItem, setItem });
  return { values, getItem, setItem, tab };
}

describe('browser privacy preference', () => {
  it.each([
    [null, false], ['off', false], ['false', false], ['0', false],
    ['on', true], ['true', true], ['1', true], ['', true], ['future-mode', true],
  ] as const)('reads %j synchronously as %s without changing storage', (value, expected) => {
    const { values, setItem } = preferenceBrowser();
    if (value !== null) values.set(PRIVACY_KEY, value);
    expect(readPrivacyMode()).toBe(expected);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('updates only the browser preference and immediately notifies subscribers in this tab', () => {
    const { values, setItem } = preferenceBrowser();
    values.set('uangku:v1', 'synthetic ledger bytes');
    values.set('uangku:preferences:v1', 'synthetic wallet settings');
    const observed: boolean[] = [];
    const unsubscribe = subscribePrivacyMode(() => observed.push(readPrivacyMode()));
    try {
      expect(writePrivacyMode(true)).toBe(true);
      expect(writePrivacyMode(false)).toBe(true);
      expect(observed).toEqual([true, false]);
      expect(setItem.mock.calls).toEqual([['uangku:privacy:v1', 'on'], ['uangku:privacy:v1', 'off']]);
      expect([...values]).toEqual([
        ['uangku:v1', 'synthetic ledger bytes'], ['uangku:preferences:v1', 'synthetic wallet settings'],
        ['uangku:privacy:v1', 'off'],
      ]);
    } finally { unsubscribe(); }
    writePrivacyMode(true);
    expect(observed).toEqual([true, false]);
  });

  it('reads current storage on another tab’s preference change, removal and clear', () => {
    const { values, tab } = preferenceBrowser();
    const change = (key: string | null) => tab.dispatchEvent(Object.assign(new Event('storage'), { key }));
    const observed: boolean[] = [];
    const unsubscribe = subscribePrivacyMode(() => observed.push(readPrivacyMode()));
    values.set(PRIVACY_KEY, 'on');
    change('uangku:v1');
    change(PRIVACY_KEY);
    values.delete(PRIVACY_KEY);
    change(PRIVACY_KEY);
    values.set(PRIVACY_KEY, 'on');
    change(PRIVACY_KEY);
    values.clear();
    change(null);
    unsubscribe();
    change(PRIVACY_KEY);
    expect(observed).toEqual([true, false, true, false]);
  });

  it('keeps amounts hidden when storage is unavailable or access is denied', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readPrivacyMode()).toBe(true);
    expect(writePrivacyMode(false)).toBe(false);
    vi.stubGlobal('localStorage', { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Denied'); } });
    expect(readPrivacyMode()).toBe(true);
    expect(writePrivacyMode(false)).toBe(false);
  });

  it('preserves the stored choice and reports a failed write without notifying subscribers', () => {
    const { values, setItem } = preferenceBrowser();
    values.set(PRIVACY_KEY, 'on');
    setItem.mockImplementation(() => { throw new Error('Quota exceeded'); });
    const refresh = vi.fn();
    const unsubscribe = subscribePrivacyMode(refresh);
    expect(writePrivacyMode(false)).toBe(false);
    expect(readPrivacyMode()).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
    unsubscribe();
  });
});
