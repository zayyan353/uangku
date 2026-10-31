import type { Entry, State } from './finance';
import type { SourceDocument } from './sourceModel';

export function isCashLinkedEntry(state: State, entry: Entry): boolean {
  return state.wallets.some(wallet => wallet.kind === 'cash' && (wallet.id === entry.walletId || wallet.id === entry.toWalletId));
}

/** Read-only reporting scope. Never persist this partial financial projection:
 * historical bank/cash transfers retain their cash IDs in the original ledger.
 */
export function activeAccountState(state: State): State {
  const wallets = state.wallets.filter(wallet => wallet.kind !== 'cash');
  const ids = new Set(wallets.map(wallet => wallet.id));
  return { ...state, wallets, entries: state.entries.filter(entry => ids.has(entry.walletId) || !!entry.toWalletId && ids.has(entry.toWalletId)) };
}

/** Only genuinely empty cash definitions can be removed. Every retained source
 * reference, including deleted transfers, protects its wallet from deletion.
 */
export function removableCashWalletIds(data: SourceDocument): string[] {
  const cash = new Set(data.state.wallets.filter(wallet => wallet.kind === 'cash').map(wallet => wallet.id));
  const protectedIds = new Set(data.state.wallets.filter(wallet => wallet.openingBalance !== 0).map(wallet => wallet.id));
  for (const entry of data.state.entries) {
    protectedIds.add(entry.walletId);
    if (entry.toWalletId) protectedIds.add(entry.toWalletId);
  }
  const pending: unknown[] = data.metadata ? [data.metadata] : [];
  const seen = new WeakSet<object>();
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === 'string') { if (cash.has(value)) protectedIds.add(value); }
    else if (value && typeof value === 'object' && !seen.has(value)) {
      seen.add(value);
      for (const child of Object.values(value)) pending.push(child);
    }
  }
  return [...cash].filter(id => !protectedIds.has(id));
}

export function removeUnusedCashWallets(data: SourceDocument): SourceDocument {
  const ids = new Set(removableCashWalletIds(data));
  return ids.size ? { ...data, state: { ...data.state, wallets: data.state.wallets.filter(wallet => !ids.has(wallet.id)) } } : data;
}
