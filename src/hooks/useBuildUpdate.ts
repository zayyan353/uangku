import { useEffect, useState } from 'react';

/** Pages adds the release manifest after building. Local previews may return HTML or 404. */
export function useBuildUpdate() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const current = typeof __UANGKU_BUILD__ === 'string' ? __UANGKU_BUILD__ : '';
    if (!/^[a-f0-9]{7,40}$/.test(current) || !['https:', 'http:'].includes(location.protocol)) return;
    const manifest = new URL('BUILD_INFO.json', location.href);
    const controller = new AbortController();
    let checking = false;
    async function check() {
      if (checking || !navigator.onLine) return;
      checking = true;
      try {
        const response = await fetch(manifest, {
          signal: controller.signal, cache: 'no-store', mode: 'same-origin',
          credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
        });
        if (!response.ok) return;
        const release = await response.json();
        if (!controller.signal.aborted && typeof release?.commit === 'string' && /^[a-f0-9]{40}$/.test(release.commit)) {
          setAvailable(!release.commit.startsWith(current));
        }
      } catch {
        // Offline, preview HTML, and rejected redirects cannot announce a release.
      } finally {
        checking = false;
      }
    }
    window.addEventListener('focus', check);
    return () => {
      window.removeEventListener('focus', check);
      controller.abort();
    };
  }, []);
  return available;
}
