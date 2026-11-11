import { ArrowLeftRight, ChevronRight, Download, History, LayoutDashboard, Leaf, ShieldCheck, Upload, Wallet as WalletIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { NICKNAME_MAX } from '../lib/nickname';

export type Page = 'overview' | 'wallets' | 'transactions' | 'import';

export const NAVIGATION: { page: Page; label: string; icon: typeof WalletIcon }[] = [{ page: 'overview', label: 'Ringkasan', icon: LayoutDashboard }, { page: 'wallets', label: 'Dompet', icon: WalletIcon }, { page: 'transactions', label: 'Transaksi', icon: ArrowLeftRight }, { page: 'import', label: 'Impor mutasi', icon: Upload }];

interface BackupActions {
  /** Ready-made "Cadangan terakhir: …" text. */
  lastBackupText: string;
  onBackupAll: () => void;
  onBackupCurrent: () => void;
  onRestore: () => void;
}

/** Desktop sidebar: brand, page navigation and backup tools. */
export function AppSidebar({ page, pendingCount, lastBackupText, initial, onNavigate, onBackupAll, onBackupCurrent, onRestore }: BackupActions & {
  page: Page;
  /** Avatar letter from the nickname. */
  initial: string;
  pendingCount: number;
  onNavigate: (page: Page) => void;
}) {
  return <aside className="sidebar"><a className="brand" href="#" onClick={e => { e.preventDefault(); onNavigate('overview'); }} aria-label="Uangku beranda"><span className="brand-mark">u<span /></span><span className="brand-copy">uangku<span>uangmu, lebih rapi.</span></span></a><span className="nav-caption">RUANG UANGMU</span><nav>{NAVIGATION.map(({ page: p, label, icon: Icon }) => <button key={p} className={`nav-item ${page === p ? 'active' : ''}`} onClick={() => onNavigate(p)} aria-current={page === p ? 'page' : undefined}><Icon size={20} /><span>{label}</span>{p === 'transactions' && pendingCount > 0 && <span className="nav-count">{pendingCount}</span>}{page === p && <ChevronRight className="nav-chevron" size={15} />}</button>)}</nav>
    <div className="sidebar-bottom"><div className="sidebar-tip"><Leaf size={23} /><strong>Nggak harus sempurna.</strong><p>Satu catatan hari ini lebih baik daripada menunggu lengkap.</p></div><div className="backup-tools"><button onClick={onBackupAll}><Download size={16} /> Cadangkan semuanya</button><button onClick={onBackupCurrent}><Download size={16} /> Cadangkan transaksi saja</button><button onClick={onRestore}><History size={16} /> Pulihkan cadangan</button><p className="backup-last" data-testid="last-backup">{lastBackupText}</p></div><div className="sidebar-user"><span className="avatar">{initial}</span><div><strong>Ruang pribadi</strong><span>Data di browser ini</span></div><ShieldCheck size={18} /></div></div>
  </aside>;
}

/** Mobile footer note. Backup and privacy live in the account menu. */
export function MobileFooter() {
  return <footer className="bottom-note"><span><Leaf size={14} /> Nggak harus rapi sekaligus. Yang penting mulai.</span><span>Cadangkan secara berkala</span></footer>;
}

/** Avatar button in the topbar that opens backup, restore and privacy actions. */
export function AccountMenu({ lastBackupText, nickname, initial, onNicknameChange, onBackupAll, onBackupCurrent, onRestore, onPrivacy }: BackupActions & { onPrivacy: () => void; nickname: string; initial: string; onNicknameChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const run = (action: () => void) => () => { setOpen(false); action(); };
  return <div className="account-menu" ref={root}>
    <button ref={trigger} type="button" className="avatar small account-trigger" aria-label="Menu akun" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>{initial}</button>
    {open && <div className="account-panel" id={panelId}>
      <p className="account-heading"><strong>Ruang pribadi</strong><span>Data di browser ini</span></p>
      <label className="account-nickname"><span>Nama panggilan</span><input className="field-input" aria-label="Nama panggilan" placeholder="Belum diisi" maxLength={NICKNAME_MAX} autoComplete="off" value={nickname} onChange={event => onNicknameChange(event.target.value)} /><small>Untuk sapaan di Ringkasan. Hanya tersimpan di browser ini.</small></label>
      <button type="button" onClick={run(onBackupAll)}><Download size={16} /> Cadangkan semuanya</button>
      <button type="button" onClick={run(onBackupCurrent)}><Download size={16} /> Cadangkan transaksi saja</button>
      <button type="button" onClick={run(onRestore)}><History size={16} /> Pulihkan cadangan</button>
      <button type="button" onClick={run(onPrivacy)}><ShieldCheck size={16} /> Privasi</button>
      <p className="backup-last" data-testid="last-backup-menu">{lastBackupText}</p>
    </div>}
  </div>;
}

/** Bottom tab bar on small screens. */
export function MobileNav({ page, onNavigate }: { page: Page; onNavigate: (page: Page) => void }) {
  return <nav className="mobile-nav" aria-label="Navigasi seluler">{NAVIGATION.map(({ page: p, label, icon: Icon }) => <button key={p} className={page === p ? 'active' : ''} aria-current={page === p ? 'page' : undefined} onClick={() => onNavigate(p)}><Icon size={20} /><span>{label}</span></button>)}</nav>;
}
