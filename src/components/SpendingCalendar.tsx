import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { maskedMoney, PrivateAmount, usePrivacyAmounts } from './PrivacyAmounts';
import { FoldHeader } from './CashflowOverview';
import { formatDate, formatMoney, type Currency, type Entry } from '../lib/finance';
import { buildSpendingCalendar, type CalendarDay } from '../lib/spendingCalendar';
import type { SourceDocument } from '../lib/sourceModel';

interface Props { data: SourceDocument; currency: Currency; today: string; onOpenMonth: (month: string) => void }
const weekdays = new Intl.DateTimeFormat('id-ID', { weekday: 'short', timeZone: 'UTC' });
const months = new Intl.DateTimeFormat('id-ID', { month: 'short', timeZone: 'UTC' });

function DayDetails({ day, entries, currency, onOpenMonth }: {
  day: CalendarDay; entries: Map<string, Entry>; currency: Currency; onOpenMonth: Props['onOpenMonth'];
}) {
  const { hidden } = usePrivacyAmounts();
  const [limit, setLimit] = useState(10);
  const title = `Pengeluaran ${formatDate(day.date)}`;
  return <section className="spending-details" aria-label={title}>
    <h3>{title} · <PrivateAmount value={day.total} currency={currency} /></h3>
    {day.entryIds.length ? <ul>{day.entryIds.slice(0, limit).map(id => {
      const entry = entries.get(id)!;
      const fee = entry.fee ?? 0;
      const amount = (entry.type === 'transfer' ? 0n : BigInt(entry.amount)) + BigInt(fee);
      const typeLabel = entry.type === 'transfer' ? 'Transfer' : 'Pengeluaran';
      return <li key={id}><span>{hidden ? typeLabel : entry.note || typeLabel}<small>
        {entry.type === 'transfer' ? 'Biaya transfer' : entry.category || 'Belum dikategorikan'}
        {entry.type === 'expense' && fee > 0 && <> · termasuk biaya <PrivateAmount value={fee} currency={currency} /></>}
      </small></span><strong><PrivateAmount value={amount} currency={currency} /></strong></li>;
    })}</ul> : <p>Tidak ada pengeluaran tercatat.</p>}
    {limit < day.entryIds.length && <button type="button" className="text-link" onClick={() => setLimit(limit + 10)}>Tampilkan lebih banyak</button>}
    <button type="button" className="text-link" onClick={() => onOpenMonth(day.date.slice(0, 7))}>Lihat bulan ini di Transaksi</button>
  </section>;
}

function CalendarBody({ data, currency, today, onOpenMonth }: Props) {
  const { hidden } = usePrivacyAmounts();
  const model = useMemo(() => {
    try {
      const days = buildSpendingCalendar(data, currency, today);
      return { days, entries: new Map(data.state.entries.map(entry => [entry.id, entry])) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Pengeluaran harian belum dapat dihitung.' };
    }
  }, [data, currency, today]);
  const labels = useMemo(() => model.days?.map(day =>
    `${formatDate(day.date)}: ${hidden ? maskedMoney(currency) : formatMoney(day.total, currency)}`) ?? [], [model.days, hidden, currency]);
  const scroll = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState((model.days?.length ?? 1) - 1);
  const [selected, setSelected] = useState<number | null>(null);
  useLayoutEffect(() => { if (scroll.current) scroll.current.scrollLeft = scroll.current.scrollWidth; }, [today]);
  if (!model.days) return <p className="notice warning" role="alert">{model.error}</p>;
  const { days, entries } = model;
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const offsets: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7, Home: -index, End: days.length - 1 - index };
    const offset = offsets[event.key];
    if (offset === undefined) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(days.length - 1, index + offset));
    (grid.current?.children[next] as HTMLButtonElement | undefined)?.focus();
  }
  const weeks = days.filter((_, i) => i % 7 === 0);
  return <>
    <div className="spending-track">
      <div className="spending-weekdays" aria-hidden="true">{days.slice(0, 7).map(day => <span key={day.date}>{weekdays.format(new Date(day.date))}</span>)}</div>
      <div className="spending-scroll" ref={scroll} tabIndex={-1}>
        <div className="spending-months" aria-hidden="true">{weeks.map((day, i) =>
          <span key={day.date}>{(!i || weeks[i - 1].date.slice(0, 7) !== day.date.slice(0, 7)) && months.format(new Date(day.date))}</span>)}</div>
        <div className="spending-grid" ref={grid} role="group" aria-label="Pengeluaran per hari">
          {days.map((day, i) => <button key={day.date} type="button" className="spending-day"
            data-level={hidden ? 0 : day.level} title={labels[i]} aria-label={labels[i]} aria-pressed={selected === i}
            tabIndex={i === active ? 0 : -1} onFocus={() => setActive(i)} onKeyDown={event => move(event, i)}
            onClick={() => { setActive(i); setSelected(i); }} />)}
        </div>
      </div>
    </div>
    <p className="field-help spending-caption">{formatDate(days[0].date)} – {formatDate(today)} · {!hidden && 'Hijau lebih gelap berarti pengeluaran lebih besar. '}Pilih hari untuk melihat transaksi.</p>
    {selected !== null && <DayDetails key={days[selected].date} day={days[selected]} entries={entries} currency={currency} onOpenMonth={onOpenMonth} />}
  </>;
}

export default function SpendingCalendar(props: Props) {
  const [open, setOpen] = useState(false);
  const controls = useId();
  return <section className="panel spending-calendar">
    <FoldHeader mark="calendar" title="Kalender pengeluaran" description={`53 minggu · semua rekening ${props.currency}`}
      open={open} controls={controls} onToggle={() => setOpen(value => !value)} />
    <div id={controls} hidden={!open}>{open && <CalendarBody key={`${props.currency}-${props.today}`} {...props} />}</div>
  </section>;
}
