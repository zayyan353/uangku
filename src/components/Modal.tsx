import { createContext, useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { dialogHistory } from '../lib/dialogHistory';

export const ModalConflictContext = createContext<ReactNode>(null);
export const ModalOpenedContext = createContext<(() => void) | undefined>(undefined);

export function Modal({ title, subtitle, children, onClose }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const conflict = useContext(ModalConflictContext);
  const onOpened = useContext(ModalOpenedContext);
  // The browser's Back asks for the same close as Escape, so a filled form still gets its discard question.
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    onOpened?.();
    return dialogHistory().opened(() => {
      const panel = ref.current;
      if (panel && !panel.contains(document.activeElement)) panel.focus();
      close.current();
    });
  }, [onOpened]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const target = ref.current?.querySelector<HTMLElement>('[data-autofocus]:not([disabled])')
      ?? ref.current?.querySelector<HTMLElement>('.modal-body input:not([disabled])')
      ?? ref.current?.querySelector<HTMLElement>('.modal-body select:not([disabled])')
      ?? ref.current?.querySelector<HTMLElement>('button');
    target?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) { e.preventDefault(); onClose(); } }}>
    <div ref={ref} className="modal" role="dialog" tabIndex={-1} aria-modal="true" aria-label={title} onKeyDown={e => {
      if (e.key !== 'Tab') return;
      const focusables = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:enabled, input:enabled, select:enabled, textarea:enabled, [tabindex="0"]') ?? [])
        .filter(el => el.getClientRects().length > 0);
      const first = focusables[0], last = focusables.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }}>
      <div className="modal-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button modal-close" aria-label="Tutup" onClick={onClose}><X size={20} /></button></div>
      {conflict}
      {children}
    </div>
  </div>;
}

export default Modal;
