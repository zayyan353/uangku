import { useEffect, useLayoutEffect, useState } from 'react';
import { applyTheme, DARK_QUERY, readTheme, resolveTheme, sanitizeTheme, systemUsesDark, THEME_KEY, writeTheme, type ThemePreference } from '../lib/theme';

/** Lives in the appearance control so a theme change does not recompute the ledger. */
export function useTheme(onNotice?: (message: string) => void) {
  const [preference, setPreference] = useState(readTheme);
  const [systemDark, setSystemDark] = useState(systemUsesDark);
  useLayoutEffect(() => { applyTheme(preference, systemDark); }, [preference, systemDark]);
  useEffect(() => {
    let media: MediaQueryList | undefined;
    const changed = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    try {
      media = globalThis.matchMedia?.(DARK_QUERY);
      if (media) {
        setSystemDark(media.matches);
        if (media.addEventListener) media.addEventListener('change', changed);
        else media.addListener?.(changed);
      }
    } catch { /* An unavailable media query keeps the current explicit choice. */ }
    return () => {
      if (media?.removeEventListener) media.removeEventListener('change', changed);
      else media?.removeListener?.(changed);
    };
  }, []);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === THEME_KEY || event.key === null) setPreference(readTheme());
    };
    globalThis.addEventListener('storage', changed);
    return () => globalThis.removeEventListener('storage', changed);
  }, []);
  function choose(value: ThemePreference) {
    const next = sanitizeTheme(value);
    applyTheme(next, systemDark);
    setPreference(next);
    if (!writeTheme(next)) onNotice?.('Tema berlaku untuk sesi ini. Browser belum bisa menyimpan pilihan tema.');
  }
  return { preference, resolved: resolveTheme(preference, systemDark), choose };
}
