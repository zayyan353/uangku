import type { Currency, State } from './finance';

/** Look up the most recent stored quote for either direction of this currency pair.
 * Equal dates retain ledger order, with the last matching row taking precedence. */
export function latestTransferRate(state: State, from: Currency, to: Currency, excludeId?: string) {
  const currencies = new Map(state.wallets.map(wallet => [wallet.id, wallet.currency]));
  let latest: { date: string; rate: number } | undefined;
  for (const entry of state.entries) {
    if (entry.type !== 'transfer' || entry.id === excludeId || !entry.toWalletId || !entry.rate) continue;
    if (latest && entry.date < latest.date) continue;
    const source = currencies.get(entry.walletId), destination = currencies.get(entry.toWalletId);
    let rate: number;
    if (source === from && destination === to) rate = entry.rate;
    else if (source === to && destination === from) rate = 1 / entry.rate;
    else continue;
    if (Number.isFinite(rate) && rate > 0) latest = { date: entry.date, rate };
  }
  return latest;
}
