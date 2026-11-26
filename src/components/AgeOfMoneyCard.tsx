import { useMemo } from 'react';
import { ageOfMoney } from '../lib/ageOfMoney';
import type { Currency } from '../lib/finance';
import type { SourceDocument } from '../lib/sourceModel';

export default function AgeOfMoneyCard({ data, currency, today }: { data: SourceDocument; currency: Currency; today: string }) {
  const value = useMemo(() => {
    try {
      const age = ageOfMoney(data, currency, today);
      return age === null ? 'Belum cukup data' : `${age} hari`;
    } catch {
      return 'Umur uang belum dapat dihitung';
    }
  }, [data, currency, today]);

  return <section className="panel age-of-money" aria-labelledby="age-of-money-title">
    <h2 className="stat-label" id="age-of-money-title">Umur uang</h2>
    <strong className="stat-value">{value}</strong>
    <p className="stat-foot">Rata-rata waktu dari uang diterima sampai dipakai untuk sepuluh pengeluaran terakhir yang dapat ditelusuri di semua rekening {currency}.</p>
  </section>;
}
