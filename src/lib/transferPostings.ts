import type { Entry } from './finance';

/** Financial dates are declarations, independent of immutable bank evidence. */
export interface PostingMetadata {
  transfers?: ReadonlyArray<{ entryId: string; sourceDate: string | null; destinationDate: string | null }>;
  links?: ReadonlyArray<{ entryId: string; postingDates?: { source: string | null; destination: string | null } }>;
  baselines?: ReadonlyArray<{ id: string; walletId: string; boundary: { kind: 'before-source' | 'end-of-day'; date: string; sourceId?: string }; status: 'confirmed' | 'provisional'; origin?: 'bank' | 'manual' }>;
  baselineDecisions?: ReadonlyArray<{ baselineId: string; reason?: string; at?: string }>;
}
export type PostingDateBasis = 'explicit' | 'preserved' | 'legacy-assumed';
export interface TransferPostingDates { source: string | null; destination: string | null; basis: PostingDateBasis }
export interface PostingDateIndex {
  readonly transferDatesByEntry: ReadonlyMap<string, Omit<TransferPostingDates, 'basis'>>;
  readonly retainedDatesByEntry: ReadonlyMap<string, Omit<TransferPostingDates, 'basis'>>;
  /** Optional for compatibility with callers holding an older E4 index shape. */
  readonly approvedBaselineDatesByWallet?: ReadonlyMap<string, string>;
}
export type PostingContext = PostingMetadata | PostingDateIndex;
export interface EntryPosting {
  walletId: string; date: string | null; signedAmount: number;
  role: 'ordinary' | 'source' | 'destination' | 'fee'; basis: PostingDateBasis | 'entry';
}
type WalletScope = ReadonlySet<string> | readonly string[];

function calendar(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function checkedDate(value: unknown): asserts value is string | null {
  if (value !== null && !calendar(value)) throw new RangeError('Tanggal posting harus berupa tanggal kalender yang valid atau belum diketahui.');
}
function assertToday(today: string): void {
  if (!calendar(today)) throw new RangeError('Tanggal acuan saldo harus berupa tanggal kalender yang valid.');
}
function isIndex(context: PostingContext): context is PostingDateIndex {
  return 'transferDatesByEntry' in context && 'retainedDatesByEntry' in context;
}

/** Explicit snapshot index. Do not cache mutable caller data in a global WeakMap. */
export function createPostingDateIndex(context?: PostingContext): PostingDateIndex {
  if (context && isIndex(context)) return context;
  const transfers = new Map<string, Omit<TransferPostingDates, 'basis'>>();
  const retained = new Map<string, Omit<TransferPostingDates, 'basis'>>();
  for (const row of context?.transfers ?? []) {
    if (transfers.has(row.entryId)) throw new RangeError('Tanggal transfer berulang untuk ID yang sama.');
    checkedDate(row.sourceDate); checkedDate(row.destinationDate);
    transfers.set(row.entryId, { source: row.sourceDate, destination: row.destinationDate });
  }
  for (const link of context?.links ?? []) {
    if (!link.postingDates) continue;
    if (retained.has(link.entryId)) throw new RangeError('Tanggal sumber berulang untuk ID yang sama.');
    checkedDate(link.postingDates.source); checkedDate(link.postingDates.destination);
    const row = { source: link.postingDates.source, destination: link.postingDates.destination };
    const explicit = transfers.get(link.entryId);
    if (explicit && (explicit.source !== row.source || explicit.destination !== row.destination)) {
      throw new RangeError('Tanggal transfer dan hubungan sumber bertentangan.');
    }
    retained.set(link.entryId, row);
  }
  const approved = new Map<string, string>();
  if (context?.baselineDecisions?.length) {
    const byId = new Map<string, NonNullable<PostingMetadata['baselines']>[number]>();
    for (const baseline of context.baselines ?? []) {
      if (byId.has(baseline.id)) throw new RangeError('Identitas baseline berulang.');
      byId.set(baseline.id,baseline);
    }
    const seen = new Set<string>();
    for (const decision of context.baselineDecisions) {
      if (seen.has(decision.baselineId)) throw new RangeError('Keputusan baseline berulang.'); seen.add(decision.baselineId);
      const baseline = byId.get(decision.baselineId);
      if (!baseline) throw new RangeError('Keputusan baseline kehilangan batas sumber yang dirujuk.');
      // E5 approves before-source boundaries. Older unmarked/end-of-day
      // primitives retain their E4 arithmetic and are not silently activated.
      if (baseline.status !== 'confirmed' || baseline.boundary.kind !== 'before-source') continue;
      if (!calendar(baseline.boundary.date)) throw new RangeError('Tanggal batas baseline tidak valid.');
      if (approved.has(baseline.walletId)) throw new RangeError('Baseline yang disetujui berulang untuk dompet yang sama.');
      approved.set(baseline.walletId,baseline.boundary.date);
    }
  }
  return { transferDatesByEntry: transfers, retainedDatesByEntry: retained,
    ...(approved.size ? {approvedBaselineDatesByWallet:approved} : {}) };
}

function beforeBaselineMessage(through: string, baselineDate: string): string {
  return `Saldo aktual pada ${through} belum diketahui karena berada sebelum batas baseline ${baselineDate}. Saldo awal tidak membuktikan saldo pada tanggal tersebut. Lengkapi histori dengan bukti baseline lebih awal untuk memeriksa periode itu.`;
}
export class ActualBalanceUnavailableError extends Error {
  readonly code = 'ACTUAL_BEFORE_BASELINE' as const;
  constructor(readonly walletId: string, readonly through: string, readonly baselineDate: string) {
    super(beforeBaselineMessage(through,baselineDate)); this.name = 'ActualBalanceUnavailableError';
  }
}
/** Calendar-day cutoff before an explicitly approved opening boundary is unknown. */
export function actualBalanceProblem(context: PostingContext | undefined, walletId: string, through: string): string | null {
  assertToday(through);
  const baselineDate = createPostingDateIndex(context).approvedBaselineDatesByWallet?.get(walletId);
  return baselineDate !== undefined && through < baselineDate ? beforeBaselineMessage(through,baselineDate) : null;
}

export function transferPostingDates(entry: Entry, context?: PostingContext): TransferPostingDates {
  const index = createPostingDateIndex(context);
  const explicit = index.transferDatesByEntry.get(entry.id);
  if (explicit) return { ...explicit, basis: 'explicit' };
  const retained = index.retainedDatesByEntry.get(entry.id);
  if (retained) return { ...retained, basis: 'preserved' };
  // Preserve v1's observed accounting meaning. Neither date is thereby bank-verified.
  return { source: entry.date, destination: entry.date, basis: 'legacy-assumed' };
}

/** Component terms avoid rounding principal + fee before exact BigInt aggregation. */
export function entryPostings(entry: Entry, context?: PostingContext): EntryPosting[] {
  if (entry.type === 'transfer') {
    const dates = transferPostingDates(entry, context);
    return [
      { walletId: entry.walletId, date: dates.source, signedAmount: -entry.amount, role: 'source', basis: dates.basis },
      ...(entry.fee ? [{ walletId: entry.walletId, date: dates.source, signedAmount: -entry.fee, role: 'fee' as const, basis: dates.basis }] : []),
      { walletId: entry.toWalletId!, date: dates.destination, signedAmount: entry.toAmount ?? 0, role: 'destination', basis: dates.basis },
    ];
  }
  const signed = entry.type === 'expense' ? -entry.amount : entry.amount;
  return [
    { walletId: entry.walletId, date: entry.date, signedAmount: signed, role: 'ordinary', basis: 'entry' },
    ...(entry.type === 'expense' && entry.fee ? [{ walletId: entry.walletId, date: entry.date, signedAmount: -entry.fee, role: 'fee' as const, basis: 'entry' as const }] : []),
  ];
}

export function postingDateForWallet(entry: Entry, walletId: string, context?: PostingContext): string | null {
  if (entry.type !== 'transfer') return entry.walletId === walletId ? entry.date : null;
  const dates = transferPostingDates(entry, context);
  return entry.walletId === walletId ? dates.source : entry.toWalletId === walletId ? dates.destination : null;
}
function scoped(postings: EntryPosting[], walletIds?: WalletScope): EntryPosting[] {
  if (!walletIds) return postings;
  const ids = Array.isArray(walletIds) ? new Set(walletIds) : walletIds as ReadonlySet<string>;
  return postings.filter(posting => ids.has(posting.walletId));
}
export function entryPostingDates(entry: Entry, context?: PostingContext, walletIds?: WalletScope): string[] {
  return [...new Set(scoped(entryPostings(entry, context), walletIds).flatMap(posting => posting.date === null ? [] : [posting.date]))].sort();
}
export function entryMatchesPostingMonth(entry: Entry, month: string, context?: PostingContext, walletIds?: WalletScope): boolean {
  return entryPostingDates(entry, context, walletIds).some(date => date.slice(0, 7) === month);
}
/** One group per entry ID; sort by latest known relevant leg, unknown-only groups last. */
export function entrySortPostingDate(entry: Entry, context?: PostingContext, walletIds?: WalletScope): string {
  return entryPostingDates(entry, context, walletIds).at(-1) ?? '';
}
export function entryHasFuturePosting(entry: Entry, today: string, context?: PostingContext, walletIds?: WalletScope): boolean {
  assertToday(today);
  return scoped(entryPostings(entry, context), walletIds).some(posting => posting.date !== null && posting.date > today);
}
export function entryHasUndatedPosting(entry: Entry, context?: PostingContext, walletIds?: WalletScope): boolean {
  return scoped(entryPostings(entry, context), walletIds).some(posting => posting.date === null);
}
export interface TransferPostingStatus {
  sourceDate: string | null; destinationDate: string | null; basis: PostingDateBasis;
  sourcePosted: boolean | null; destinationPosted: boolean | null;
  status: 'pending' | 'debit-only' | 'credit-only' | 'posted' | 'unknown';
  label: string;
}
export function transferPostingStatus(entry: Entry, today: string, context?: PostingContext): TransferPostingStatus {
  assertToday(today);
  const dates = transferPostingDates(entry, context);
  const sourcePosted = dates.source === null ? null : dates.source <= today;
  const destinationPosted = dates.destination === null ? null : dates.destination <= today;
  const status = sourcePosted === null || destinationPosted === null ? 'unknown' : sourcePosted && destinationPosted ? 'posted'
    : sourcePosted ? 'debit-only' : destinationPosted ? 'credit-only' : 'pending';
  const label = status === 'unknown' ? sourcePosted === null && destinationPosted === null
    ? 'Tanggal debit dan kredit belum diketahui. Kedua sisi belum masuk saldo aktual.'
    : sourcePosted === null ? 'Tanggal debit belum diketahui. Debit dan biaya belum masuk saldo aktual.'
    : 'Tanggal kredit belum diketahui. Kredit belum masuk saldo aktual.'
    : status === 'pending' ? 'Debit dan kredit belum mencapai tanggal posting.'
    : status === 'debit-only' ? 'Debit sudah masuk saldo aktual; kredit menunggu tanggal posting.'
    : status === 'credit-only' ? 'Kredit sudah masuk saldo aktual; debit belum mencapai tanggal posting.'
    : 'Kedua sisi sudah masuk saldo aktual menurut catatan.';
  return { sourceDate: dates.source, destinationDate: dates.destination, basis: dates.basis, sourcePosted, destinationPosted, status, label };
}
