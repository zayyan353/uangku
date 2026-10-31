export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
export const THEME_KEY = 'uangku:theme:v1';
export const DARK_QUERY = '(prefers-color-scheme: dark)';

export function sanitizeTheme(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  return preference === 'system' ? systemDark ? 'dark' : 'light' : preference;
}

export function readTheme(): ThemePreference {
  try { return sanitizeTheme(globalThis.localStorage?.getItem(THEME_KEY)); }
  catch { return 'system'; }
}

export function systemUsesDark(): boolean {
  try { return globalThis.matchMedia?.(DARK_QUERY).matches ?? false; }
  catch { return false; }
}

/** This preference is intentionally separate from the ledger and wallet hints. */
export function writeTheme(value: ThemePreference): boolean {
  try {
    if (!globalThis.localStorage) return false;
    globalThis.localStorage.setItem(THEME_KEY, sanitizeTheme(value));
    return true;
  } catch { return false; }
}

export function applyTheme(preference: ThemePreference, systemDark: boolean, target: Document | undefined = globalThis.document): ResolvedTheme {
  const resolved = resolveTheme(preference, systemDark);
  if (target) {
    target.documentElement.dataset.theme = resolved;
    target.documentElement.style.colorScheme = resolved;
    target.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#111a16' : '#173b31');
  }
  return resolved;
}
