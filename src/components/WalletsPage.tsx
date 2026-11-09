import type { CSSProperties } from 'react';
import { ArrowRight, CircleHelp, Landmark, MoreHorizontal, Plus, Wallet as WalletIcon } from 'lucide-react';
import { formatDate, type Currency, type Wallet } from '../lib/finance';

export const kindLabel = (kind: Wallet['kind']) => kind === 'cash' ? 'Uang tunai' : kind === 'ewallet' ? 'E-wallet' : 'Rekening bank';

export function WalletSymbol({ wallet, small = false }: { wallet: Wallet; small?: boolean }) {
  return <span className={`wallet-icon ${wallet.kind} ${small ? 'small' : ''}`} style={{ '--wallet-color': wallet.currency === 'TRY' ? '#a36c51' : wallet.currency === 'USD' ? '#6576a4' : '#3d7368' } as CSSProperties}>
    {wallet.kind === 'cash' ? <WalletIcon size={small ? 17 : 21} /> : wallet.kind === 'bank' ? <Landmark size={small ? 17 : 21} /> : <span>{wallet.name.slice(0, 1)}</span>}
  </span>;
}

/** Wallets page: active/archive tabs, total, and the grid of wallet cards. */
export default function WalletsPage({
  hasCashArchive, onOpenCashArchive, walletView, onWalletViewChange, activeCount, archivedCount,
  currency, currencyName, clockDay, total, wallets, actualText,
  onOpenWallet, onRecord, onCheckBalance, onShowHistory, onRestore,
}: {
  hasCashArchive: boolean;
  onOpenCashArchive: () => void;
  walletView: 'active' | 'archive';
  onWalletViewChange: (view: 'active' | 'archive') => void;
  activeCount: number;
  archivedCount: number;
  currency: Currency;
  currencyName: string;
  clockDay: string;
  total: { value: number | null; text: string };
  /** Wallets shown in the current tab. */
  wallets: Wallet[];
  actualText: (walletId: string, currency: Currency) => string;
  onOpenWallet: (wallet: Wallet | 'new') => void;
  onRecord: (walletId: string) => void;
  onCheckBalance: (walletId: string) => void;
  onShowHistory: (wallet: Wallet) => void;
  onRestore: (wallet: Wallet) => void;
}) {
  return <>
        {hasCashArchive && <div className="notice"><span>Histori cash lama disimpan sebagai arsip baca saja dan tidak masuk total aktif.</span><button className="button secondary small" onClick={onOpenCashArchive}>Lihat arsip cash lama</button></div>}
        <div className="wallet-view-tabs" role="group" aria-label="Status dompet"><button className={`button ${walletView === 'active' ? 'primary' : 'secondary'}`} data-testid="wallet-active-tab" aria-pressed={walletView === 'active'} onClick={() => onWalletViewChange('active')}>Aktif ({activeCount})</button><button className={`button ${walletView === 'archive' ? 'primary' : 'secondary'}`} data-testid="wallet-archive-tab" aria-pressed={walletView === 'archive'} onClick={() => onWalletViewChange('archive')}>Arsip ({archivedCount})</button></div>
        <div className="section-heading"><div><h2 className="section-title">Dompet {currencyName} · {walletView === 'archive' ? 'Arsip' : 'Aktif'}</h2><p className="section-description">{wallets.length} dompet · saldo aktual {formatDate(clockDay)}: <strong data-testid="wallet-current-total" data-amount={total.value ?? undefined}>{total.text}</strong></p></div><span className="badge neutral">{currency === 'TRY' ? 'TL / TRY' : currency}</span></div>
        {walletView === 'archive' && <div className="notice">Dompet arsip tetap masuk saldo dan laporan. Histori dapat dibaca; pulihkan dompet untuk mencatat, mengimpor, atau mengubah transaksi.</div>}
        <div className="wallet-grid">{wallets.map(w => <section key={w.id} className="wallet-card" data-wallet-id={w.id}><div className="wallet-card-top"><WalletSymbol wallet={w} /><span className="wallet-info"><strong>{w.name}</strong><span>{kindLabel(w.kind)}{walletView === 'archive' ? ' · Arsip' : ''}</span></span>{walletView === 'active' && <button className="icon-button" aria-label={`Atur dompet ${w.name}`} onClick={() => onOpenWallet(w)}><MoreHorizontal size={20} /></button>}</div><span className="wallet-card-label">Saldo aktual {formatDate(clockDay)}</span><strong className="wallet-card-balance">{actualText(w.id, w.currency)}</strong><div className="wallet-card-footer"><span className="badge neutral">{w.currency}</span><div className="wallet-card-actions">{walletView === 'active' ? <><button className="text-link" onClick={() => onRecord(w.id)}><Plus size={14} /> Catat</button><button className="text-link" onClick={() => onCheckBalance(w.id)}>Cek saldo <ArrowRight size={14} /></button></> : <><button className="text-link" aria-label={`Lihat histori ${w.name}`} onClick={() => onShowHistory(w)}>Lihat histori</button><button className="text-link" aria-label={`Pulihkan dompet ${w.name}`} onClick={() => onRestore(w)}>Pulihkan dompet</button></>}</div></div></section>)}
          {walletView === 'active' && <button className="wallet-card add-wallet-card" onClick={() => onOpenWallet('new')}><span className="add-wallet-icon"><Plus size={24} /></span><strong>Tambah dompet</strong><span>Rekening bank atau e-wallet baru.</span></button>}
        </div>
        {walletView === 'archive' && !wallets.length && <div className="empty-state compact"><WalletIcon size={28} /><p>Belum ada dompet arsip {currency}.</p></div>}
        <div className="notice"><CircleHelp size={18} /><span>Satu dompet untuk satu mata uang. Dompet kosong dapat dihapus lewat Atur dompet; dompet dengan saldo atau histori dapat diarsipkan.</span></div>
  </>;
}
