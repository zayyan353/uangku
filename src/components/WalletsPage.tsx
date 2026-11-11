import { ArrowRight, CircleHelp, History, Landmark, Plus, Settings2, Wallet as WalletIcon } from 'lucide-react';
import { formatDate, type Currency, type Wallet } from '../lib/finance';

export const kindLabel = (kind: Wallet['kind']) => kind === 'cash' ? 'Uang tunai' : kind === 'ewallet' ? 'E-wallet' : 'Rekening bank';

export function WalletSymbol({ wallet, small = false }: { wallet: Wallet; small?: boolean }) {
  return <span className={`wallet-icon ${wallet.kind} ${small ? 'small' : ''}`}>
    {wallet.kind === 'cash' ? <WalletIcon size={small ? 17 : 21} /> : wallet.kind === 'bank' ? <Landmark size={small ? 17 : 21} /> : <span>{wallet.name.slice(0, 1)}</span>}
  </span>;
}

/** A balance, or the sentence that explains why there is none; the sentence is set as plain text. */
function WalletBalance({ text }: { text: string }) {
  return <strong className={`wallet-card-balance${/\d/.test(text) ? '' : ' wallet-card-balance-note'}`}>{text}</strong>;
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
        <div className="wallet-view-tabs tab-group" role="group" aria-label="Status dompet"><button className={walletView === 'active' ? 'active' : ''} data-testid="wallet-active-tab" aria-pressed={walletView === 'active'} onClick={() => onWalletViewChange('active')}>Aktif ({activeCount})</button><button className={walletView === 'archive' ? 'active' : ''} data-testid="wallet-archive-tab" aria-pressed={walletView === 'archive'} onClick={() => onWalletViewChange('archive')}>Arsip ({archivedCount})</button></div>
        <div className="section-heading"><div><h2 className="section-title">Dompet {currencyName} · {walletView === 'archive' ? 'Arsip' : 'Aktif'}</h2><p className="section-description">{wallets.length} dompet</p></div>{(walletView === 'active' || wallets.length > 0) && <p className="wallet-total"><span>Saldo aktual {formatDate(clockDay)}</span><strong className={/\d/.test(total.text) ? undefined : 'wallet-total-note'} data-testid="wallet-current-total" data-amount={total.value ?? undefined}>{total.text}</strong></p>}</div>
        {walletView === 'archive' && wallets.length > 0 && <div className="notice">Dompet arsip tetap masuk saldo dan laporan. Histori dapat dibaca; pulihkan dompet untuk mencatat, mengimpor, atau mengubah transaksi.</div>}
        <div className="wallet-grid">{wallets.map(w => <section key={w.id} className="wallet-card" data-wallet-id={w.id}><div className="wallet-card-top"><WalletSymbol wallet={w} /><span className="wallet-info"><strong>{w.name}</strong><span>{kindLabel(w.kind)}{walletView === 'archive' ? ' · Arsip' : ''}</span></span>{walletView === 'active' && <button className="text-link wallet-edit" aria-label={`Atur dompet ${w.name}`} onClick={() => onOpenWallet(w)}><Settings2 size={14} /> Atur</button>}</div><span className="wallet-card-label">Saldo aktual {formatDate(clockDay)}</span><WalletBalance text={actualText(w.id, w.currency)} /><div className="wallet-card-footer"><div className="wallet-card-actions">{walletView === 'active' ? <><button className="text-link" onClick={() => onRecord(w.id)}><Plus size={14} /> Catat</button><button className="text-link" aria-label={`Riwayat ${w.name}`} onClick={() => onShowHistory(w)}><History size={14} /> Riwayat</button><button className="text-link" onClick={() => onCheckBalance(w.id)}>Cek saldo <ArrowRight size={14} /></button></> : <><button className="text-link" aria-label={`Lihat histori ${w.name}`} onClick={() => onShowHistory(w)}>Lihat histori</button><button className="text-link" aria-label={`Pulihkan dompet ${w.name}`} onClick={() => onRestore(w)}>Pulihkan dompet</button></>}</div></div></section>)}
          {walletView === 'active' && <button className="wallet-card add-wallet-card" onClick={() => onOpenWallet('new')}><span className="add-wallet-icon"><Plus size={24} /></span><strong>Tambah dompet</strong><span>Rekening bank atau e-wallet baru.</span></button>}
        </div>
        {walletView === 'archive' && !wallets.length && <div className="empty-state compact"><WalletIcon size={28} /><p>Belum ada dompet arsip {currency}.</p></div>}
        <div className="notice"><CircleHelp size={18} /><span>Satu dompet untuk satu mata uang. Dompet kosong dapat dihapus lewat Atur dompet; dompet dengan saldo atau histori dapat diarsipkan.</span></div>
  </>;
}
