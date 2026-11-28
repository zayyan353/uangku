import { useMemo } from 'react';
import { currentCurrencyBalances, formatDate, formatMoney, type PostingDateIndex, type State } from '../lib/finance';

export default function CurrencyBalances({ state, day, postings }: { state: State; day: string; postings: PostingDateIndex }) {
  const balances = useMemo(() => currentCurrencyBalances(state, day, postings), [state, day, postings]);
  if (!balances.size) return null;
  return <section className="currency-balances" aria-labelledby="currency-balances-title">
    <h2 id="currency-balances-title">Semua mata uang</h2>
    <p>Saldo aktual {formatDate(day)} · rekening dan e-wallet, termasuk dompet arsip.</p>
    <dl>{Array.from(balances, ([currency, balance]) => <div key={currency}>
      <dt>{currency}</dt>
      <dd data-amount={balance ?? undefined}>{balance === null ? 'Belum dapat dipastikan' : formatMoney(balance, currency)}</dd>
    </div>)}</dl>
  </section>;
}
