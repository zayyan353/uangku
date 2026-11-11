import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Asks before a form with unsaved changes is closed, the way the transaction
 * form does. `request` is what Escape, the backdrop, the close button and
 * Batal call; `prompt` is rendered inside the window. Nothing is written here.
 */
export function useDiscardGuard(dirty: boolean, onClose: () => void, busy = false) {
  const [asking, setAsking] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { if (asking) keep.current?.focus(); }, [asking]);
  function request() {
    if (busy) return;
    if (asking) { setAsking(false); return; }
    if (dirty) setAsking(true); else onClose();
  }
  const prompt = asking ? <div className="discard-guard" role="alertdialog" aria-label="Buang perubahan?" data-testid="discard-guard">
    <p><strong>Buang perubahan?</strong> Perubahan di jendela ini belum disimpan.</p>
    <div><button type="button" ref={keep} className="button primary small" onClick={() => setAsking(false)}>Lanjut mengisi</button><button type="button" className="button danger small" onClick={() => { setAsking(false); onClose(); }}>Buang perubahan</button></div>
  </div> : null;
  return { request, prompt, asking };
}
