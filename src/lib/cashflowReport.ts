import type { Currency, Entry } from './finance';
import { isCurrencyCode } from './currencyCatalog';
import type { SourceDocument } from './sourceModel';
import { interpretBankDescription, normalizeBankDescription } from './bankDescription';
import { actualBalanceProblem, createPostingDateIndex, entryPostings, type EntryPosting } from './transferPostings';

export interface CashflowQuery {
  currency: Currency;
  month: string;
  today: string;
  period: 'month' | 'all';
  walletId?: string;
}
export interface CashflowBreakdown {
  id: string;
  label: string;
  inflow: number;
  outflow: number;
  /** Distinct entries in this operation group, not an additional money total. */
  entryCount: number;
}
export interface CashflowReport {
  inflow: number;
  outflow: number;
  openingBalance: number | null;
  closingBalance: number | null;
  allRecordsBalance: number;
  internalInflow: number;
  internalOutflow: number;
  internalNet: number;
  adjustment: number;
  difference: number | null;
  /** Book arithmetic and dates are available; this does not certify bank history. */
  isComplete: boolean;
  balanceWarning: string | null;
  unknownDatePostings: number;
  periodStart: string | null;
  periodEnd: string;
  notStarted: boolean;
  scopeWalletIds: string[];
  breakdown: CashflowBreakdown[];
  /** Confirmed expense purpose only; deliberately narrower than all bank debits. */
  categoryTotals: Array<[string, number]>;
  categoryExpenseTotal: number;
}

const MAX = BigInt(Number.MAX_SAFE_INTEGER);
function safeNumber(value: bigint): number {
  if (value > MAX || value < -MAX) throw new RangeError('Total laporan arus rekening melewati batas nominal aman.');
  return Number(value);
}
function money(value: number): bigint {
  if (!Number.isSafeInteger(value)) throw new RangeError('Nominal laporan arus rekening harus berupa safe integer.');
  return BigInt(value);
}
function calendar(value: string): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function monthEnd(month: string): string {
  const year = Number(month.slice(0, 4)), number = Number(month.slice(5));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = number === 2 ? leap ? 29 : 28 : [4, 6, 9, 11].includes(number) ? 30 : 31;
  return `${month}-${days}`;
}
function previousDay(value: string): string {
  const parsed = new Date(`${value}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  const previous = parsed.toISOString().slice(0, 10);
  if (!calendar(previous)) throw new RangeError('Batas awal periode tidak dapat dihitung.');
  return previous;
}
const GROUPS = [
  ['payments', 'Belanja & pembayaran'], ['transfer', 'Transfer bank'],
  ['atm-deposit', 'Setor tunai'], ['atm-withdrawal', 'Tarik tunai'],
  ['fees', 'Biaya bank'], ['refund', 'Refund & Cashback'], ['other', 'Mutasi lain'],
] as const;
type GroupId = typeof GROUPS[number][0];
const contains = (text: string, phrase: string): boolean => (` ${text} `).includes(` ${phrase} `);

/** Operation wording describes bank flow, independently of its spending category. */
function operationGroup(entry: Entry, posting: EntryPosting, wording: string): GroupId {
  if (posting.role === 'fee') return 'fees';
  if (entry.type === 'transfer') return 'transfer';
  const text = normalizeBankDescription(wording), amount = posting.signedAmount;
  const refund = ['iade', 'iadesi', 'refund', 'reversal', 'iptal', 'iptali'].some(word => contains(text, word));
  if (amount > 0 && (contains(text, 'prepaid') || refund)) return 'refund';
  // A reversal or contradictory direction must not masquerade as a new ATM/fee operation.
  if (refund) return 'other';
  const operation = interpretBankDescription(wording, { signedAmount: amount });
  if (operation.kind === 'atm-deposit' || operation.kind === 'atm-withdrawal') {
    return operation.pending ? 'other' : operation.kind;
  }
  const purchase = contains(text, 'pos alisveris') || contains(text, 'pos harcama');
  const fee = operation.kind === 'transfer-fee' || ['komisyon tutari', 'bsmv tutari', 'mesaj ucreti tutari']
    .some(phrase => contains(text, phrase));
  if (!purchase && fee) return amount < 0 ? 'fees' : 'other';
  if (operation.kind === 'bank-transfer') return operation.pending ? 'other' : 'transfer';
  if (purchase || operation.kind === 'online-purchase') return amount < 0 ? 'payments' : 'other';
  if (entry.type === 'expense') return 'payments';
  return 'other';
}

/**
 * Read-only account-flow projection. One posting pass retains full transfer
 * context, exact sums, and the same cutoff/baseline rules as walletBalanceAt.
 * It does not infer ownership, create pairs, or rewrite financial entries.
 */
export function buildCashflowReport(data: SourceDocument, query: CashflowQuery): CashflowReport {
  if (!isCurrencyCode(query.currency) || !['month', 'all'].includes(query.period)
    || typeof query.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(query.month)
    || !calendar(query.today)) throw new RangeError('Cakupan atau tanggal laporan arus rekening tidak valid.');
  const walletById = new Map(data.state.wallets.map(wallet => [wallet.id, wallet]));
  if (walletById.size !== data.state.wallets.length) throw new RangeError('Identitas dompet laporan berulang.');
  if (query.walletId !== undefined) {
    const wallet = walletById.get(query.walletId);
    if (!wallet || wallet.kind === 'cash' || wallet.currency !== query.currency) {
      throw new RangeError('Dompet laporan harus rekening aktif dengan mata uang yang dipilih.');
    }
  }
  const wallets = data.state.wallets.filter(wallet => wallet.kind !== 'cash' && wallet.currency === query.currency
    && (query.walletId === undefined || wallet.id === query.walletId));
  const scopeWalletIds = wallets.map(wallet => wallet.id), scope = new Set(scopeWalletIds);
  const index = createPostingDateIndex(data.metadata);
  const periodStart = query.period === 'month' ? `${query.month}-01` : null;
  const notStarted = periodStart !== null && periodStart > query.today;
  const end = query.period === 'month' ? monthEnd(query.month) : query.today;
  const periodEnd = end < query.today ? end : query.today;
  const openingThrough = periodStart === null || notStarted ? null : previousDay(periodStart);
  const warnings = new Set<string>();
  let opening = 0n, closing = 0n, all = 0n;
  let inflow = 0n, outflow = 0n, internalInflow = 0n, internalOutflow = 0n, adjustment = 0n;
  let unknownDatePostings = 0, openingUnavailable = false, closingUnavailable = false;
  const groups = new Map<GroupId, { inflow: bigint; outflow: bigint; entries: Set<string> }>();
  const categories = new Map<string, bigint>();
  const sourceDescriptions = new Map<string, string>();
  const facts = new Map(data.metadata?.facts.map(fact => [fact.id, fact.description]) ?? []);
  for (const link of data.metadata?.links ?? []) {
    // A captured blank description remains evidence; never substitute an edited note.
    if (link.source !== undefined && facts.has(link.source)) sourceDescriptions.set(link.entryId, facts.get(link.source)!);
  }
  for (const wallet of wallets) {
    const initial = money(wallet.openingBalance);
    opening += initial; closing += initial; all += initial;
    if (!notStarted) {
      const closingProblem = actualBalanceProblem(index, wallet.id, periodEnd);
      if (closingProblem) { closingUnavailable = true; warnings.add(closingProblem); }
      if (openingThrough !== null) {
        const openingProblem = actualBalanceProblem(index, wallet.id, openingThrough);
        if (openingProblem) { openingUnavailable = true; warnings.add(openingProblem); }
      }
    }
  }
  for (const entry of data.state.entries) {
    if (!scope.has(entry.walletId) && !(entry.type === 'transfer' && scope.has(entry.toWalletId!))) continue;
    money(entry.amount);
    if (entry.fee !== undefined && money(entry.fee) < 0n) throw new RangeError('Biaya laporan tidak boleh negatif.');
    if (entry.type === 'transfer' && (!walletById.has(entry.walletId) || !walletById.has(entry.toWalletId!)
      || entry.walletId === entry.toWalletId || money(entry.toAmount ?? 0) < 0n || entry.amount < 0)) {
      throw new RangeError('Pasangan transfer laporan tidak valid.');
    }
    if ((entry.type === 'income' || entry.type === 'expense') && entry.amount < 0) throw new RangeError('Arah nominal transaksi laporan tidak valid.');
    const internal = entry.type === 'transfer' && scope.has(entry.walletId) && scope.has(entry.toWalletId!);
    const wording = sourceDescriptions.has(entry.id) ? sourceDescriptions.get(entry.id)! : entry.note;
    for (const posting of entryPostings(entry, index)) {
      if (!scope.has(posting.walletId)) continue;
      const amount = money(posting.signedAmount);
      all += amount;
      if (posting.date === null) { unknownDatePostings++; continue; }
      if (!calendar(posting.date)) throw new RangeError('Tanggal posting laporan tidak valid.');
      if (openingThrough !== null && posting.date <= openingThrough) opening += amount;
      if (posting.date <= periodEnd) closing += amount;
      if (notStarted || posting.date > periodEnd || (periodStart !== null && posting.date < periodStart)) continue;
      if (entry.type === 'adjustment') { adjustment += amount; continue; }
      if (internal && posting.role !== 'fee') {
        if (amount > 0n) internalInflow += amount;
        if (amount < 0n) internalOutflow -= amount;
        continue;
      }
      if (amount === 0n) continue;
      if (amount > 0n) inflow += amount; else outflow -= amount;
      const id = operationGroup(entry, posting, wording);
      const group = groups.get(id) ?? { inflow: 0n, outflow: 0n, entries: new Set<string>() };
      if (amount > 0n) group.inflow += amount; else group.outflow -= amount;
      group.entries.add(entry.id); groups.set(id, group);
      if (amount < 0n && (posting.role === 'fee' || (posting.role === 'ordinary' && entry.type === 'expense'))) {
        const category = posting.role === 'fee' ? 'Biaya transfer' : entry.category.trim() || 'Belum dikategorikan';
        categories.set(category, (categories.get(category) ?? 0n) - amount);
      }
    }
  }
  if (unknownDatePostings && !notStarted) {
    openingUnavailable = closingUnavailable = true;
    warnings.add(`${unknownDatePostings} posting belum memiliki tanggal. Arus bertanggal tetap ditampilkan; saldo periode belum dapat direkonsiliasi.`);
  }
  const openingBalance = notStarted || openingUnavailable ? null : safeNumber(opening);
  const closingBalance = notStarted || closingUnavailable ? null : safeNumber(closing);
  const internalNet = internalInflow - internalOutflow;
  const difference = openingBalance === null || closingBalance === null ? null
    : safeNumber(closing - (opening + inflow - outflow + internalNet + adjustment));
  return {
    inflow: safeNumber(inflow), outflow: safeNumber(outflow), openingBalance, closingBalance,
    allRecordsBalance: safeNumber(all), internalInflow: safeNumber(internalInflow), internalOutflow: safeNumber(internalOutflow),
    internalNet: safeNumber(internalNet), adjustment: safeNumber(adjustment), difference,
    isComplete: difference === 0, balanceWarning: warnings.size ? [...warnings].join(' ') : null,
    unknownDatePostings, periodStart, periodEnd, notStarted, scopeWalletIds,
    breakdown: GROUPS.flatMap(([id, label]) => {
      const group = groups.get(id);
      return group ? [{ id, label, inflow: safeNumber(group.inflow), outflow: safeNumber(group.outflow), entryCount: group.entries.size }] : [];
    }),
    categoryTotals: [...categories].map(([name, amount]): [string, number] => [name, safeNumber(amount)])
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    categoryExpenseTotal: safeNumber([...categories.values()].reduce((sum, amount) => sum + amount, 0n)),
  };
}
