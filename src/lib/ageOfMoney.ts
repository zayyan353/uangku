import { isValidDate, type Currency, type Entry } from './finance';
import type { SourceDocument } from './sourceModel';
import { deviceDay } from './today';
import { createPostingDateIndex, transferPostingDates } from './transferPostings';

const SAMPLE_SIZE = 10;
type EventKind = 'receipt' | 'exchange' | 'purchase';
interface PoolEvent { day: number; id: string; kind: EventKind; amount: bigint }
interface Lot { day: number | null; remaining: bigint }
interface Sample { weightedDays: bigint; amount: bigint }

function minor(amount: number): bigint {
  if (!Number.isSafeInteger(amount)) throw new RangeError('Nominal umur uang harus berupa bilangan bulat aman.');
  return BigInt(amount);
}

function meanAge(samples: Sample[]): number | null {
  if (samples.length < SAMPLE_SIZE) return null;
  // Add just the last ten fractions exactly; round once, after taking the mean.
  let numerator = 0n, denominator = 1n;
  for (const sample of samples) {
    numerator = numerator * sample.amount + sample.weightedDays * denominator;
    denominator *= sample.amount;
  }
  denominator *= BigInt(SAMPLE_SIZE);
  return Number((2n * numerator + denominator) / (2n * denominator));
}

/** Average age in whole days of the last ten fully dated purchases, or null when unknown. */
export function ageOfMoney(data: SourceDocument, currency: Currency, through = deviceDay()): number | null {
  if (!isValidDate(through)) throw new RangeError('Tanggal acuan umur uang tidak valid.');
  const wallets = new Map(data.state.wallets.map(wallet => [wallet.id, wallet]));
  const inPool = new Set(data.state.wallets.filter(wallet => wallet.kind !== 'cash' && wallet.currency === currency).map(wallet => wallet.id));
  const opening = data.state.wallets.reduce((sum, wallet) => inPool.has(wallet.id) ? sum + minor(wallet.openingBalance) : sum, 0n);
  const dates = createPostingDateIndex(data.metadata);
  const events: PoolEvent[] = [];
  let undated = false;
  function add(entry: Entry, date: string | null, kind: EventKind, amount: bigint) {
    if (amount < 0n) throw new RangeError('Nominal pemasukan, pengeluaran, atau biaya tidak boleh negatif.');
    if (amount === 0n) return;
    if (date === null) { undated = true; return; }
    if (!isValidDate(date)) throw new RangeError('Tanggal posting umur uang tidak valid.');
    if (date <= through) events.push({ id: entry.id, day: Date.parse(date) / 86_400_000, kind, amount });
  }
  for (const entry of data.state.entries) {
    const from = inPool.has(entry.walletId);
    if (entry.type === 'transfer') {
      const to = inPool.has(entry.toWalletId!);
      if (!from && !to) continue;
      const fx = wallets.get(entry.walletId)?.currency !== wallets.get(entry.toWalletId!)?.currency;
      const posting = transferPostingDates(entry, dates);
      if (from) {
        if (fx) add(entry, posting.source, 'exchange', minor(entry.amount));
        add(entry, posting.source, 'purchase', minor(entry.fee ?? 0));
      }
      if (to && fx) add(entry, posting.destination, 'receipt', minor(entry.toAmount!));
    } else if (from && entry.type === 'income') {
      add(entry, entry.date, 'receipt', minor(entry.amount));
    } else if (from && entry.type === 'expense') {
      add(entry, entry.date, 'purchase', minor(entry.amount) + minor(entry.fee ?? 0));
    }
  }
  // An undated leg that affects this pool cannot be placed on either side of the cutoff.
  if (undated) return null;
  events.sort((a, b) => a.day - b.day || Number(b.kind === 'receipt') - Number(a.kind === 'receipt')
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const lots: Lot[] = opening > 0n ? [{ day: null, remaining: opening }] : [];
  let deficit = opening < 0n ? -opening : 0n;
  let oldest = 0;
  const samples: Sample[] = [];
  for (const event of events) {
    if (event.kind === 'receipt') {
      const repaid = deficit < event.amount ? deficit : event.amount;
      deficit -= repaid;
      if (event.amount > repaid) lots.push({ day: event.day, remaining: event.amount - repaid });
      continue;
    }
    let needed = event.amount, weightedDays = 0n;
    let dated = true;
    while (needed > 0n && oldest < lots.length) {
      const lot = lots[oldest];
      const used = lot.remaining < needed ? lot.remaining : needed;
      if (lot.day === null) dated = false;
      else weightedDays += used * BigInt(event.day - lot.day);
      lot.remaining -= used;
      needed -= used;
      if (lot.remaining === 0n) oldest++;
    }
    deficit += needed;
    if (event.kind === 'purchase' && dated && needed === 0n) {
      samples.push({ amount: event.amount, weightedDays });
      if (samples.length > SAMPLE_SIZE) samples.shift();
    }
  }
  return meanAge(samples);
}
