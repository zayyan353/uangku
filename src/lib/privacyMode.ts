/** Browser display preference. It is independent of the ledger, exports and backups. */
export const PRIVACY_KEY = 'uangku:privacy:v1';
const CHANGE_EVENT = 'uangku:privacy-change';

/** Preserve the recap's original spellings. Unknown or unreadable values keep amounts hidden. */
export function readPrivacyMode(): boolean {
  try {
    const value = globalThis.localStorage.getItem(PRIVACY_KEY);
    return value !== null && !['off', 'false', '0'].includes(value);
  } catch { return true; }
}

export function writePrivacyMode(hidden: boolean): boolean {
  try { globalThis.localStorage.setItem(PRIVACY_KEY, hidden ? 'on' : 'off'); }
  catch { return false; }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return true;
}

export function subscribePrivacyMode(refresh: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === PRIVACY_KEY || event.key === null) refresh();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, refresh);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, refresh);
  };
}
