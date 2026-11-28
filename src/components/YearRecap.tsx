import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CalendarDays } from 'lucide-react';
import { formatDate, formatMoney, type Currency } from '../lib/finance';
import { monthLabel } from '../lib/historyView';
import { readPrivacyMode, subscribePrivacyMode } from '../lib/privacyMode';
import type { SourceDocument } from '../lib/sourceModel';
import { buildYearRecap, type YearRecap as Recap } from '../lib/yearRecap';
import Modal from './Modal';

interface Props { data: SourceDocument; currency: Currency; today: string }

function RecapDialog({ data, currency, today, onClose }: Props & { onClose: () => void }) {
  const result = useMemo(() => {
    try { return { recap: buildYearRecap(data, currency, today) }; }
    catch (error) { return { error: error instanceof Error ? error.message : 'Rekap belum dapat dihitung.' }; }
  }, [data, currency, today]);
  const hidden = useSyncExternalStore(subscribePrivacyMode, readPrivacyMode);
  const [index, setIndex] = useState(0);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const recap = result.recap;
  if (!recap) return <Modal title="Rekap 2026" onClose={onClose}><div className="modal-body">
    <p className="notice warning" role="alert">{result.error}</p>
  </div></Modal>;

  const money = (value: number) => hidden ? `${currency} •••••` : formatMoney(value, currency);
  function ranked(rows: Recap['topCategories'], empty: string) {
    if (!rows.length) return <p>{empty}</p>;
    if (hidden) return <p>Rincian disamarkan.</p>;
    return <ol className="recap-ranks">{rows.map(row => <li key={row.name}><span>{row.name}</span> <strong>{money(row.total)}</strong></li>)}</ol>;
  }
  const cards = [
    { title: 'Arus uangmu', body: <dl><dt>Pemasukan terkonfirmasi</dt><dd>{money(recap.income)}</dd><dt>Pengeluaran terkonfirmasi</dt><dd>{money(recap.spending)}</dd></dl> },
    { title: 'Kategori teratas', body: ranked(recap.topCategories, 'Belum ada pengeluaran terkonfirmasi.') },
    { title: 'Merchant teratas', body: ranked(recap.topMerchants, 'Belum ada merchant yang dikenali.') },
    { title: 'Pengeluaran tertinggi', body: recap.peakMonth && recap.peakDay ? <dl><dt>{monthLabel(recap.peakMonth.period)}</dt><dd>{money(recap.peakMonth.total)}</dd><dt>{formatDate(recap.peakDay.period)}</dt><dd>{money(recap.peakDay.total)}</dd></dl> : <p>Belum ada pengeluaran terkonfirmasi.</p> },
    { title: 'Hari tanpa pengeluaran tercatat', body: recap.longestNoSpend ? <><p><strong>{recap.longestNoSpend.days} hari berturut-turut</strong></p><p>{formatDate(recap.longestNoSpend.start)} – {formatDate(recap.longestNoSpend.end)}</p></> : <p>Ada pengeluaran tercatat setiap hari.</p> },
    { title: 'Umur uang', body: recap.ageDays === null ? <p>Belum cukup data untuk menghitung umur uang.</p> : <p><strong>{recap.ageDays} hari</strong> rata-rata umur uang saat dipakai pada sepuluh pengeluaran terakhir yang dapat ditelusuri.</p> },
  ];
  const move = (step: number) => setIndex(current => Math.max(0, Math.min(cards.length - 1, current + step)));
  return <Modal title="Rekap 2026" subtitle={`Semua rekening ${currency} · sampai ${formatDate(recap.through)}`} onClose={onClose}>
    <div className="modal-body">
      <section className="recap-card" aria-live="polite" aria-atomic="true"
        onPointerDown={event => {
          if (!event.isPrimary || event.button !== 0) return;
          drag.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { drag.current = null; }}
        onPointerUp={event => {
          if (!drag.current || !event.isPrimary) return;
          const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y;
          drag.current = null;
          if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy)) move(dx < 0 ? 1 : -1);
        }}>
        <h3>{cards[index].title}</h3>{cards[index].body}
      </section>
    </div>
    <div className="modal-footer recap-controls">
      <button type="button" className="button secondary small" disabled={index === 0} onClick={() => move(-1)}>Sebelumnya</button>
      <span>{index + 1} / {cards.length}</span>
      <button type="button" className="button secondary small" disabled={index === cards.length - 1} onClick={() => move(1)}>Berikutnya</button>
    </div>
  </Modal>;
}

export default function YearRecap(props: Props) {
  const [open, setOpen] = useState(false);
  return <><div className="recap-entry"><button type="button" className="button secondary" onClick={() => setOpen(true)}><CalendarDays size={18} /> Rekap 2026</button></div>
    {open && <RecapDialog {...props} onClose={() => setOpen(false)} />}
  </>;
}
