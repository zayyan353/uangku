import { formatDate, formatDateTime, formatMoney, transferPostingDates, type Entry } from '../lib/finance';
import { sourceEntryComparison } from '../lib/sourceCommands';
import type { StoredData } from '../lib/storage';

/** Read-only facts. Mutable book annotations never stand in for bank evidence. */
export default function SourceDetails({ data, entry }: { data: StoredData; entry: Entry }) {
  if (!data.state.entries.some(item => item.id === entry.id)) return <p className="notice warning">Catatan ini sudah berubah atau dihapus di tab lain. Muat ulang data sebelum melanjutkan.</p>;
  const comparison = sourceEntryComparison(data, entry.id);
  const dates = entry.type === 'transfer' ? transferPostingDates(entry, data.metadata) : null;
  return <section className="field full" aria-label="Data bank transaksi">
    <strong>Asal dan data bank</strong>
    {!comparison.facts.length && <p className="field-help">{entry.sourceKey || entry.toSourceKey
      ? 'Catatan impor lama: mutasi aslinya dari bank tidak tersimpan, hanya kode pengenalnya. Nominal, tanggal, dan riwayat perubahan lama belum dapat dibuktikan dari catatan ini.'
      : 'Catatan manual. Tidak ada data bank untuk transaksi ini.'}</p>}
    {comparison.facts.map(({ role, fact, represented }) => <div className="notice" key={`${role}:${fact.id}`} style={{ display: 'block', overflowWrap: 'anywhere' }}>
      <strong>{role === 'destination' ? 'Mutasi bank di rekening penerima' : 'Mutasi bank di rekening asal'}</strong>
      <p>{data.state.wallets.find(wallet => wallet.id === fact.walletId)?.name} · {formatDate(fact.postedOn)} · {formatMoney(fact.signedAmount, fact.currency)}</p>
      <p>{fact.description}</p>
      <p className="field-help">Referensi: {fact.reference || 'Tidak tersedia'} · Saldo setelah mutasi: {formatMoney(fact.balanceAfter, fact.currency)}</p>
      <p className="field-help">{represented ? 'Tanggal, dompet, dan nominal catatan cocok dengan mutasi bank ini.' : 'Catatan ini sudah diubah dan berbeda dari mutasi bank; data banknya tetap disimpan.'}</p>
    </div>)}
    {comparison.override && <div className="notice warning" style={{ display: 'block' }}><strong>Keputusan perubahan</strong><p>{comparison.override.reason}</p><small><time dateTime={comparison.override.at}>{formatDateTime(comparison.override.at)}</time></small></div>}
    {dates && <p className="field-help">Tanggal debit: {dates.source ? formatDate(dates.source) : 'Belum diketahui'} · tanggal kredit: {dates.destination ? formatDate(dates.destination) : 'Belum diketahui'}. {dates.basis === 'legacy-assumed' ? 'Tanggal dua sisi lama belum dibuktikan secara terpisah.' : 'Tanggal tiap sisi dipakai untuk saldo dan laporan periodenya.'}</p>}
  </section>;
}
