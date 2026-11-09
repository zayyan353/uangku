import { ArrowLeftRight, ChevronRight, Download, History, LayoutDashboard, Leaf, ShieldCheck, Upload, Wallet as WalletIcon } from 'lucide-react';

export type Page = 'overview' | 'wallets' | 'transactions' | 'import';

export const NAVIGATION: { page: Page; label: string; icon: typeof WalletIcon }[] = [{ page: 'overview', label: 'Ringkasan', icon: LayoutDashboard }, { page: 'wallets', label: 'Dompet', icon: WalletIcon }, { page: 'transactions', label: 'Transaksi', icon: ArrowLeftRight }, { page: 'import', label: 'Impor mutasi', icon: Upload }];

interface BackupActions {
  onBackupAll: () => void;
  onBackupCurrent: () => void;
  onRestore: () => void;
}

/** Desktop sidebar: brand, page navigation and backup tools. */
export function AppSidebar({ page, pendingCount, statusLabel, onNavigate, onBackupAll, onBackupCurrent, onRestore }: BackupActions & {
  page: Page;
  pendingCount: number;
  statusLabel: string;
  onNavigate: (page: Page) => void;
}) {
  return <aside className="sidebar"><a className="brand" href="#" onClick={e => { e.preventDefault(); onNavigate('overview'); }} aria-label="Uangku beranda"><span className="brand-mark">u<span /></span><span className="brand-copy">uangku<span>uangmu, lebih rapi.</span></span></a><span className="nav-caption">RUANG UANGMU</span><nav>{NAVIGATION.map(({ page: p, label, icon: Icon }) => <button key={p} className={`nav-item ${page === p ? 'active' : ''}`} onClick={() => onNavigate(p)} aria-current={page === p ? 'page' : undefined}><Icon size={20} /><span>{label}</span>{p === 'transactions' && pendingCount > 0 && <span className="nav-count">{pendingCount}</span>}{page === p && <ChevronRight className="nav-chevron" size={15} />}</button>)}</nav>
    <div className="sidebar-bottom"><div className="sidebar-tip"><Leaf size={23} /><strong>Nggak harus sempurna.</strong><p>Satu catatan hari ini lebih baik daripada menunggu lengkap.</p></div><div className="backup-tools"><button onClick={onBackupAll}><Download size={16} /> Cadangkan semuanya</button><button onClick={onBackupCurrent}><Download size={16} /> Cadangkan transaksi saja</button><button onClick={onRestore}><History size={16} /> Pulihkan cadangan</button></div><div className="sidebar-user"><span className="avatar">Z</span><div><strong>Ruang pribadi</strong><span><span className="status-dot" /> {statusLabel}</span></div><ShieldCheck size={18} /></div></div>
  </aside>;
}

/** Mobile footer note with backup, restore and privacy links. */
export function MobileFooter({ statusLabel, onBackupAll, onBackupCurrent, onRestore, onPrivacy }: BackupActions & {
  statusLabel: string;
  onPrivacy: () => void;
}) {
  return <footer className="bottom-note"><span><Leaf size={14} /> Nggak harus rapi sekaligus. Yang penting mulai.</span><span>{statusLabel} · cadangkan secara berkala</span><div className="mobile-backup"><button className="text-link" onClick={onBackupAll}><Download size={14} /> Cadangkan semuanya</button><button className="text-link" onClick={onBackupCurrent}><Download size={14} /> Cadangkan transaksi saja</button><button className="text-link" onClick={onRestore}><History size={14} /> Pulihkan</button><button className="text-link" onClick={onPrivacy}><ShieldCheck size={14} /> Privasi</button></div></footer>;
}

/** Bottom tab bar on small screens. */
export function MobileNav({ page, onNavigate }: { page: Page; onNavigate: (page: Page) => void }) {
  return <nav className="mobile-nav" aria-label="Navigasi seluler">{NAVIGATION.map(({ page: p, label, icon: Icon }) => <button key={p} className={page === p ? 'active' : ''} aria-current={page === p ? 'page' : undefined} onClick={() => onNavigate(p)}><Icon size={20} /><span>{label}</span></button>)}</nav>;
}
