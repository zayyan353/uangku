import type { PersistenceLocks, PersistenceStorage } from './persistence';

/** Time from a successful write during which other tabs may still see the displaced bytes. */
export const BASE_CLAIM_MS = 30_000;

export async function digestStorageText(raw: string | null) {
  if (raw === null) return null;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The two texts hashed last for a claim name. A save's base is normally the text the previous save stored. */
const claimDigests: Array<{ text: string; digest: string }> = [];

/**
 * Name of the lock by which one write claims the bytes it replaces under one storage key.
 * The name exists in the lock manager only and goes away with the claim: nothing is added to localStorage.
 */
export async function storageClaimName(token: string | null, namespace: string): Promise<string> {
  if (token === null) return `${namespace}:base:kosong`;
  let known = claimDigests.find(entry => entry.text === token)?.digest;
  if (known === undefined) {
    // TextEncoder replaces lone UTF-16 surrogates with U+FFFD. A legacy or damaged raw
    // token can contain one, so give that case its own namespace and a lossless encoding.
    known = /[\uD800-\uDFFF]/u.test(token)
      ? `escaped:${await digestStorageText(JSON.stringify(token))}`
      : (await digestStorageText(token))!;
    claimDigests.push({ text: token, digest: known });
    if (claimDigests.length > 2) claimDigests.shift();
  }
  return `${namespace}:base:${known}`;
}

interface MetadataBase {
  key: string;
  raw: string | null;
  message: string;
}
interface HeldBase extends MetadataBase {
  release: () => void;
  current: string | null | undefined;
}

export class MetadataConflict extends Error {}

/** Caller holds CATEGORY_LOCK. Only bytes actually displaced by the action keep their claim. */
export async function withMetadataClaims<T>(storage: PersistenceStorage, locks: PersistenceLocks | undefined,
  bases: MetadataBase[], action: (storage: PersistenceStorage) => T | Promise<T>): Promise<T> {
  const held = new Map<string, HeldBase>();
  function write(key: string, value: string | null) {
    const base = held.get(key);
    try {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
      if (base) base.current = value;
    } catch (error) {
      // A failed rollback may have left its staged bytes in place.
      if (base) {
        try { base.current = storage.getItem(key); } catch { base.current = undefined; }
      }
      throw error;
    }
  }

  try {
    for (const base of bases) {
      if (!locks?.claim) break;
      const release = await locks.claim(await storageClaimName(base.raw, base.key));
      if (release === null) throw new MetadataConflict(base.message);
      held.set(base.key, { ...base, release, current: base.raw });
    }
    for (const base of bases) {
      if (storage.getItem(base.key) !== base.raw) throw new MetadataConflict(base.message);
    }
    return await action(held.size ? {
      getItem: key => storage.getItem(key),
      setItem: write,
      removeItem: key => write(key, null),
    } : storage);
  } finally {
    for (const base of held.values()) {
      if (base.current === base.raw) {
        base.release();
      } else {
        setTimeout(base.release, BASE_CLAIM_MS);
        // The restored value can be used again, including a removed key (A → B → A).
        try {
          if (base.current !== undefined) await locks?.revoke?.(await storageClaimName(base.current, base.key));
        } catch { /* Already stored. An older claim expires on its own. */ }
      }
    }
  }
}
