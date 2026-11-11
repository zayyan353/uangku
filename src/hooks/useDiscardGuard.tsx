import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Asks before a form with unsaved changes is closed, the way the transaction
 * form does. `request` is what Escape, the backdrop, the close button and
 * Batal call; `prompt` is rendered inside the window. Nothing is written here.
 */
export function useDiscardGuard(dirty: boolean, onClose: () => void, busy = false) {
  const [asking, setAsking] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  const before = useRef<HTMLElement | null>(null);
  // Focus goes to "Lanjut mengisi" while asking and back to where it was afterwards, so Escape and Tab keep working.
  useLayoutEffect(() => {
    if (asking) keep.current?.focus();
    else if (before.current) { if (before.current.isConnected) before.current.focus(); before.current = null; }
  }, [asking]);
  function request() {
    if (busy) return;
    if (asking) { setAsking(false); return; }
    if (dirty) { before.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setAsking(true); } else onClose();
  }
  const prompt = asking ? <div className="discard-guard" role="alertdialog" aria-label="Buang perubahan?" data-testid="discard-guard">
    <p><strong>Buang perubahan?</strong> Perubahan di jendela ini belum disimpan.</p>
    <div><button type="button" ref={keep} className="button primary small" onClick={() => setAsking(false)}>Lanjut mengisi</button><button type="button" className="button danger small" onClick={() => { setAsking(false); onClose(); }}>Buang perubahan</button></div>
  </div> : null;
  return { request, prompt, asking };
}
