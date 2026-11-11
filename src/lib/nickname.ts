/** The greeting name. A display preference of this browser only; it is not part of the ledger or of backups. */
export const NICKNAME_KEY = 'uangku:nickname:v1';
export const NICKNAME_MAX = 24;

export function sanitizeNickname(value: unknown): string {
  if (typeof value !== 'string') return '';
  return [...value.replace(/\s+/g, ' ').trim()].slice(0, NICKNAME_MAX).join('').trim();
}

export function readNickname(): string {
  try { return sanitizeNickname(globalThis.localStorage?.getItem(NICKNAME_KEY)); }
  catch { return ''; }
}

/** An empty name removes the stored value. Returns false when the browser cannot save it. */
export function writeNickname(value: string): boolean {
  try {
    if (!globalThis.localStorage) return false;
    const name = sanitizeNickname(value);
    if (name) globalThis.localStorage.setItem(NICKNAME_KEY, name);
    else globalThis.localStorage.removeItem(NICKNAME_KEY);
    return true;
  } catch { return false; }
}

export const greeting = (name: string) => name ? `Halo, ${name}.` : 'Halo.';
/** Avatar letter: the name's first character, or the app's own "U" without a name. */
export const nicknameInitial = (name: string) => ([...name][0] ?? 'U').toLocaleUpperCase('id-ID');
