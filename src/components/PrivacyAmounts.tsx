import { Eye, EyeOff } from 'lucide-react';
import {
  createContext, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  type Dispatch, type ReactNode, type SetStateAction,
} from 'react';
import { formatMoney, type Currency } from '../lib/finance';
import { readPrivacyMode, subscribePrivacyMode, writePrivacyMode } from '../lib/privacyMode';

type Peek = { id: string; text: string } | null;
const PrivacyContext = createContext<{ hidden: boolean; toggle: () => boolean } | null>(null);
const PeekContext = createContext<{ peek: Peek; setPeek: Dispatch<SetStateAction<Peek>> } | null>(null);

export function PrivacyAmountsProvider({ children }: { children: ReactNode }) {
  const stored = useSyncExternalStore(subscribePrivacyMode, readPrivacyMode);
  const [protectTab, setProtectTab] = useState(false);
  const [peek, setPeek] = useState<Peek>(null);
  const hidden = stored || protectTab;
  useEffect(() => {
    if (!peek) return;
    const conceal = () => setPeek(null);
    const onVisibility = () => { if (document.hidden) conceal(); };
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element && event.target.closest('.privacy-amount'))) conceal();
    };
    const timer = window.setTimeout(conceal, 3500);
    window.addEventListener('blur', conceal);
    window.addEventListener('pagehide', conceal);
    window.addEventListener('popstate', conceal);
    document.addEventListener('visibilitychange', onVisibility);
    // Wait for the click target to be determined before collapsing a wide amount.
    document.addEventListener('click', onClick, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('blur', conceal);
      window.removeEventListener('pagehide', conceal);
      window.removeEventListener('popstate', conceal);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('click', onClick, true);
    };
  }, [peek]);
  useEffect(() => subscribePrivacyMode(() => setPeek(null)), []);

  const preference = useMemo(() => ({
    hidden,
    toggle() {
      setPeek(null);
      const saved = writePrivacyMode(!hidden);
      // A denied write must still let someone cover their screen immediately.
      setProtectTab(!saved);
      return saved;
    },
  }), [hidden]);
  return <PrivacyContext.Provider value={preference}>
    <PeekContext.Provider value={{ peek, setPeek }}>{children}</PeekContext.Provider>
  </PrivacyContext.Provider>;
}

export function usePrivacyAmounts() {
  const state = useContext(PrivacyContext);
  if (!state) throw new Error('PrivacyAmountsProvider diperlukan.');
  return state;
}

export function maskedMoney(currency: Currency) {
  return `${currency} •••••`;
}

export function PrivacyToggle({ onNotice }: { onNotice: (message: string) => void }) {
  const { hidden, toggle } = usePrivacyAmounts();
  const Icon = hidden ? EyeOff : Eye;
  return <button type="button" className="icon-button privacy-toggle" aria-label="Mode privasi"
    aria-pressed={hidden} title={hidden ? 'Tampilkan nominal' : 'Samarkan nominal'}
    onClick={() => { if (!toggle()) onNotice('Pilihan privasi belum tersimpan. Nominal disamarkan di tab ini.'); }}>
    <Icon size={18} aria-hidden="true" />
  </button>;
}

function PeekAmount({ text, currency }: { text: string; currency: Currency }) {
  const id = useId();
  const { peek, setPeek } = useContext(PeekContext)!;
  const open = peek?.id === id && peek.text === text;
  const hold = useRef<number | undefined>(undefined);
  const held = useRef(false);
  const clearHold = () => window.clearTimeout(hold.current);
  const close = () => setPeek(current => current?.id === id ? null : current);
  useEffect(() => () => window.clearTimeout(hold.current), []);

  return <button type="button" className="privacy-amount"
    aria-label={open ? `Sembunyikan nominal ${text}` : `Intip nominal ${maskedMoney(currency)}`}
    aria-pressed={open}
    onPointerDown={event => {
      if (event.button !== 0) return;
      clearHold();
      held.current = false;
      hold.current = window.setTimeout(() => {
        held.current = true;
        setPeek({ id, text });
      }, 400);
    }}
    onPointerUp={() => { clearHold(); if (held.current) close(); }}
    onPointerCancel={() => { clearHold(); close(); }}
    onPointerLeave={() => { clearHold(); if (held.current) close(); }}
    onBlur={clearHold}
    onKeyDown={event => {
      if (event.key === 'Escape' && open) { event.stopPropagation(); close(); }
      if (event.key === 'Tab' && open) close();
    }}
    onClick={event => {
      if (event.detail > 0 && held.current) { held.current = false; return; }
      setPeek(open ? null : { id, text });
    }}>
    {open ? text : maskedMoney(currency)}
  </button>;
}

export function PrivateValue({ text, currency }: { text: string; currency: Currency }) {
  const { hidden } = usePrivacyAmounts();
  return hidden ? <PeekAmount text={text} currency={currency} /> : <>{text}</>;
}

export function PrivateAmount({ value, currency }: { value: number | bigint; currency: Currency }) {
  return <PrivateValue text={formatMoney(value, currency)} currency={currency} />;
}
