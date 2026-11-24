import { useEffect, useRef } from 'react';

/**
 * Has the browser ask before the tab is closed or reloaded while a form holds something typed.
 * `filled` is read at that moment only, so typing costs nothing. Nothing is written here; the
 * warning for work that failed to save lives in `useLedgerStorage`.
 */
export function useUnloadWarning(filled: () => boolean) {
  const check = useRef(filled);
  check.current = filled;
  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (!check.current()) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
}
