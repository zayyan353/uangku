import { describe, expect, it } from 'vitest';
import { buildCashflowReport, type CashflowQuery, type CashflowReport } from './cashflowReport';
import { walletBalanceAt, type Entry, type Wallet } from './finance';
import { SOURCE_POLICY, type SourceDocument, type SourceMetadata } from './sourceModel';
import { serializeBackup } from './storage';

const DATE = '2026-10-10', AT = '2026-10-31T12:00:00.000Z';
const wallet = (id: string, currency: Wallet['currency'] = 'TRY', kind: Wallet['kind'] = 'bank', openingBalance = 0): Wallet =>
  ({ id, name: `Synthetic ${id}`, currency, kind, openingBalance });
const ordinary = (id: string, amount: number, type: Entry['type'] = 'movement', note = '', date = DATE, walletId = 'a'): Entry =>
  ({ id, amount, type, note, date, walletId, category: '' });
const transfer = (id = 'pair', from = 'a', to = 'b', amount = 500, fee = 10): Entry =>
  ({ ...ordinary(id, amount, 'transfer', '', DATE, from), toWalletId: to, toAmount: amount, fee });
const metadata = (): SourceMetadata => ({ policy: SOURCE_POLICY, facts: [], links: [], statements: [] });
const data = (entries: Entry[] = [], wallets = [wallet('a', 'TRY', 'bank', 1_000)]): SourceDocument =>
  ({ app: 'uangku', version: 1, demo: false, state: { version: 1, entries, wallets } });
const query: CashflowQuery = { currency: 'TRY', month: '2026-10', today: '2026-10-31', period: 'month' };
const report = (source: SourceDocument, overrides: Partial<CashflowQuery> = {}) => buildCashflowReport(source, { ...query, ...overrides });
function reconciles(result: CashflowReport): void {
  expect(result.openingBalance! + result.inflow - result.outflow + result.internalNet + result.adjustment).toBe(result.closingBalance);
  expect(result.difference).toBe(0); expect(result.isComplete).toBe(true);
  expect(result.breakdown.reduce((sum, group) => sum + group.inflow, 0)).toBe(result.inflow);
  expect(result.breakdown.reduce((sum, group) => sum + group.outflow, 0)).toBe(result.outflow);
}
function capture(source: SourceDocument, entryId: string, description: string): void {
  source.metadata ??= metadata();
  const entry = source.state.entries.find(row => row.id === entryId)!;
  const id = `fact-${entryId}`;
  source.metadata.facts.push({ id, walletId: entry.walletId, currency: 'TRY', postedOn: entry.date,
    signedAmount: entry.type === 'expense' ? -entry.amount : entry.amount, balanceAfter: 0, description,
    fingerprintVersion: 'ziraat-v1', fingerprint: `synthetic:${entryId}` });
  source.metadata.links.push({ entryId, source: id });
}

describe('account cashflow reconciles every signed bank posting', () => {
  it('includes unresolved purpose and signed movements, separating confirmed categories from all cashflow', () => {
    const source = data([
      ordinary('deposit', 5_000, 'income', 'ATM YATAN'),
      ordinary('unknown-credit', 600, 'unreviewed', 'Synthetic unknown credit'),
      ordinary('incoming-transfer', 800, 'movement', 'Referansli Havale'),
      { ...ordinary('purchase', 350, 'expense', 'POS ALIŞVERİŞ'), category: 'Pilihan saya' },
      ordinary('pending-debit', -200, 'unreviewed', 'Synthetic unknown debit'),
      ordinary('outgoing-transfer', -1_500, 'movement', 'Referansli Havale'),
      { ...ordinary('fee', 25, 'expense', 'Havale Komisyonu Tahsilatı'), category: 'Biaya bank' },
      ordinary('prepaid', 75, 'income', 'PREPAID İADE'),
    ]);
    const result = report(source);
    expect(result).toMatchObject({ openingBalance: 1_000, inflow: 6_475, outflow: 2_075, closingBalance: 5_400,
      internalNet: 0, adjustment: 0, categoryExpenseTotal: 375, balanceWarning: null });
    expect(result.categoryTotals).toEqual([['Pilihan saya', 350], ['Biaya bank', 25]]);
    expect(result.breakdown.find(row => row.id === 'transfer')).toMatchObject({ inflow: 800, outflow: 1_500, entryCount: 2 });
    expect(result.breakdown.find(row => row.id === 'other')).toMatchObject({ inflow: 600, outflow: 200, entryCount: 2 });
    reconciles(result);
  });

  it('uses prior-day monthly opening and excludes prior/future postings from monthly flow', () => {
    const source = data([ordinary('prior', 300, 'income', '', '2026-09-30'), ordinary('current', -100),
      ordinary('future', -900, 'movement', '', '2026-11-01')]);
    const result = report(source);
    expect(result).toMatchObject({ openingBalance: 1_300, closingBalance: 1_200, outflow: 100, allRecordsBalance: 300 });
    expect(result.openingBalance).toBe(walletBalanceAt(source.state, 'a', '2026-09-30'));
    expect(result.closingBalance).toBe(walletBalanceAt(source.state, 'a', '2026-10-31'));
    reconciles(result);
  });

  it('cuts the current month at today including today and excluding tomorrow', () => {
    const result = report(data([ordinary('today', 100), ordinary('tomorrow', -40, 'movement', '', '2026-10-11')]), { today: DATE });
    expect(result).toMatchObject({ periodStart: '2026-10-01', periodEnd: DATE, inflow: 100, outflow: 0, closingBalance: 1_100, allRecordsBalance: 1_060 });
    reconciles(result);
  });

  it('uses stored book opening for all-period reporting without claiming prior calendar history', () => {
    const result = report(data([ordinary('prior', 300, 'income', '', '2026-09-30'), ordinary('current', -100),
      ordinary('future', 200, 'income', '', '2026-11-01')]), { period: 'all' });
    expect(result).toMatchObject({ periodStart: null, periodEnd: '2026-10-31', openingBalance: 1_000,
      inflow: 300, outflow: 100, closingBalance: 1_200, allRecordsBalance: 1_400 });
    reconciles(result);
  });

  it('does not turn adjustments into income, expense or a spending category', () => {
    const source = data([ordinary('plus', 200, 'adjustment'), ordinary('minus', -50, 'adjustment'), ordinary('regular', -25)]);
    const result = report(source);
    expect(result).toMatchObject({ inflow: 0, outflow: 25, adjustment: 150, closingBalance: 1_125, categoryExpenseTotal: 0 });
    expect(result.breakdown).toHaveLength(1); reconciles(result);
  });

  it('reports no activity and unknown balances for a future month', () => {
    const result = report(data([ordinary('future', 300, 'income', '', '2026-11-02')]), { month: '2026-11' });
    expect(result).toMatchObject({ notStarted: true, periodStart: '2026-11-01', periodEnd: '2026-10-31',
      inflow: 0, outflow: 0, openingBalance: null, closingBalance: null, difference: null, isComplete: false,
      adjustment: 0, internalNet: 0, categoryExpenseTotal: 0, allRecordsBalance: 1_300 });
    expect(result.breakdown).toEqual([]);
  });

  it('handles leap-year and completed-month cutoffs as calendar days', () => {
    expect(report(data(), { month: '2024-02' }).periodEnd).toBe('2024-02-29');
    expect(report(data(), { month: '2025-02' }).periodEnd).toBe('2025-02-28');
    expect(report(data(), { month: '2026-04' }).periodEnd).toBe('2026-04-30');
  });
});

describe('paired transfers keep principal and fees distinct', () => {
  it('excludes same-scope principal from aggregate flow but counts its fee once', () => {
    const source = data([transfer()], [wallet('a', 'TRY', 'bank', 1_000), wallet('b', 'TRY', 'ewallet', 200)]);
    const result = report(source);
    expect(result).toMatchObject({ openingBalance: 1_200, inflow: 0, outflow: 10, closingBalance: 1_190,
      internalInflow: 500, internalOutflow: 500, internalNet: 0, categoryExpenseTotal: 10 });
    expect(result.breakdown).toEqual([{ id: 'fees', label: 'Biaya bank', inflow: 0, outflow: 10, entryCount: 1 }]);
    expect(result.categoryTotals).toEqual([['Biaya transfer', 10]]); reconciles(result);
  });

  it('includes paired principal as bank inflow/outflow for the selected wallet', () => {
    const source = data([transfer()], [wallet('a', 'TRY', 'bank', 1_000), wallet('b', 'TRY', 'bank', 200)]);
    const outgoing = report(source, { walletId: 'a' }), incoming = report(source, { walletId: 'b' });
    expect(outgoing).toMatchObject({ inflow: 0, outflow: 510, closingBalance: 490, internalNet: 0, scopeWalletIds: ['a'] });
    expect(incoming).toMatchObject({ inflow: 500, outflow: 0, closingBalance: 700, internalNet: 0, categoryExpenseTotal: 0 });
    expect(outgoing.breakdown.find(row => row.id === 'transfer')?.outflow).toBe(500);
    reconciles(outgoing); reconciles(incoming);
  });

  it('bridges internal legs posted in different months instead of inventing a matched date', () => {
    const source = data([transfer()], [wallet('a', 'TRY', 'bank', 1_000), wallet('b')]);
    source.metadata = { ...metadata(), transfers: [{ entryId: 'pair', sourceDate: '2026-09-30', destinationDate: '2026-10-02' }] };
    const september = report(source, { month: '2026-09' }), october = report(source);
    expect(september).toMatchObject({ openingBalance: 1_000, closingBalance: 490, inflow: 0, outflow: 10,
      internalInflow: 0, internalOutflow: 500, internalNet: -500 });
    expect(october).toMatchObject({ openingBalance: 490, closingBalance: 990, inflow: 0, outflow: 0,
      internalInflow: 500, internalOutflow: 0, internalNet: 500 });
    expect(october.openingBalance).toBe(walletBalanceAt(source.state, 'a', '2026-09-30', source.metadata)
      + walletBalanceAt(source.state, 'b', '2026-09-30', source.metadata));
    reconciles(september); reconciles(october);
  });

  it('preserves a future destination leg in book balance while reporting the posted source leg', () => {
    const source = data([transfer()], [wallet('a', 'TRY', 'bank', 1_000), wallet('b')]);
    source.metadata = { ...metadata(), transfers: [{ entryId: 'pair', sourceDate: DATE, destinationDate: '2026-11-02' }] };
    const result = report(source);
    expect(result).toMatchObject({ closingBalance: 490, allRecordsBalance: 990, internalNet: -500, outflow: 10 });
    reconciles(result);
  });

  it('counts only the bank leg across a historical cash-wallet boundary', () => {
    const source = data([transfer('deposit', 'cash', 'a', 200, 5), transfer('withdraw', 'a', 'cash', 100, 3),
      ordinary('cash-only', 700, 'income', '', DATE, 'cash')], [wallet('a', 'TRY', 'bank', 1_000), wallet('cash', 'TRY', 'cash', 9_000)]);
    const result = report(source);
    expect(result).toMatchObject({ scopeWalletIds: ['a'], openingBalance: 1_000, inflow: 200, outflow: 103,
      closingBalance: 1_097, allRecordsBalance: 1_097, internalNet: 0, categoryExpenseTotal: 3 });
    reconciles(result);
  });

  it('never combines FX denominations or treats a cross-currency pair as same-scope internal', () => {
    const source = data([{ ...transfer('fx', 'a', 'usd', 900, 10), toAmount: 25, rate: 36 }],
      [wallet('a', 'TRY', 'bank', 1_000), wallet('usd', 'USD', 'bank', 50)]);
    const lira = report(source), dollars = report(source, { currency: 'USD' });
    expect(lira).toMatchObject({ inflow: 0, outflow: 910, closingBalance: 90, internalNet: 0 });
    expect(dollars).toMatchObject({ inflow: 25, outflow: 0, closingBalance: 75, internalNet: 0, categoryExpenseTotal: 0 });
    reconciles(lira); reconciles(dollars);
  });
});

describe('dates and approved baseline availability', () => {
  it('shows known flows while refusing a false balance equality for unknown posting dates', () => {
    const source = data([transfer(), ordinary('known', 100, 'income')], [wallet('a', 'TRY', 'bank', 1_000), wallet('b')]);
    source.metadata = { ...metadata(), transfers: [{ entryId: 'pair', sourceDate: null, destinationDate: DATE }] };
    const result = report(source);
    expect(result).toMatchObject({ inflow: 100, outflow: 0, internalInflow: 500, internalOutflow: 0,
      openingBalance: null, closingBalance: null, difference: null, isComplete: false,
      unknownDatePostings: 2, allRecordsBalance: 1_090 });
    expect(result.balanceWarning).toContain('belum memiliki tanggal');
  });

  it('does not let another wallet’s unknown date invalidate a selected known wallet', () => {
    const source = data([transfer()], [wallet('a', 'TRY', 'bank', 1_000), wallet('b')]);
    source.metadata = { ...metadata(), transfers: [{ entryId: 'pair', sourceDate: null, destinationDate: DATE }] };
    const result = report(source, { walletId: 'b' });
    expect(result).toMatchObject({ unknownDatePostings: 0, inflow: 500, openingBalance: 0, closingBalance: 500 });
    reconciles(result);
  });

  it('preserves the prior-day baseline guard even when period closing is available', () => {
    const source = data([ordinary('income', 100, 'income')]);
    source.metadata = { ...metadata(), baselines: [{ id: 'anchor', walletId: 'a', boundary: { kind: 'before-source', date: '2026-10-01' }, origin: 'bank', status: 'confirmed' }],
      baselineDecisions: [{ baselineId: 'anchor', reason: 'Synthetic approved baseline', at: AT }] };
    expect(() => walletBalanceAt(source.state, 'a', '2026-09-30', source.metadata)).toThrow('sebelum batas baseline');
    const result = report(source);
    expect(result).toMatchObject({ openingBalance: null, closingBalance: 1_100, inflow: 100, difference: null, isComplete: false });
    expect(result.balanceWarning).toContain('2026-09-30');
    // All-period starts from the stored book opening, without fabricating that prior day.
    const all = report(source, { period: 'all' });
    expect(all).toMatchObject({ openingBalance: 1_000, closingBalance: 1_100, periodStart: null }); reconciles(all);
  });

  it('blocks closing before an approved baseline instead of silently using zero', () => {
    const source = data();
    source.metadata = { ...metadata(), baselines: [{ id: 'anchor', walletId: 'a', boundary: { kind: 'before-source', date: '2026-10-15' }, origin: 'bank', status: 'confirmed' }],
      baselineDecisions: [{ baselineId: 'anchor', reason: 'Synthetic approved baseline', at: AT }] };
    const result = report(source, { today: '2026-10-10', period: 'all' });
    expect(result).toMatchObject({ openingBalance: 1_000, closingBalance: null, allRecordsBalance: 1_000, difference: null, isComplete: false });
    expect(result.balanceWarning).toContain('2026-10-15');
  });
});

describe('operation groups use source wording, not an invented category meaning', () => {
  it.each([
    ['ATM PARA ÇEKME', -100, 'atm-withdrawal'], ['ATM YATAN', 100, 'atm-deposit'],
    ['YURTİÇİ ATM P.Y.', 100, 'atm-deposit'], ['ATM PARA ÇEKME', 100, 'other'], ['ATM YATAN', -100, 'other'],
    ['ATM PARA ÇEKME İPTAL', -100, 'other'], ['TAM ATM SORUNLU İŞLEM İADESİ', 100, 'refund'],
    ['PREPAID', 100, 'refund'], ['PREPAID İADE', -100, 'other'],
    ['Referanslı Havale Komisyonu Tahsilatı', -100, 'fees'], ['BSMV TUTARI', -100, 'fees'],
    ['MESAJ ÜCRETİ TUTARI', -100, 'fees'], ['KOMİSYON TUTARI', -100, 'fees'],
    ['Referanslı Havale Komisyonu Tahsilatı', 100, 'other'], ['Referanslı Havale İADE', 100, 'refund'],
    ['Referanslı Havale', 100, 'transfer'], ['Referanslı Havale', -100, 'transfer'],
    ['SANAL POS ALIŞVERİŞ TRANSFER KOMİSYON TUTARI', -100, 'payments'],
    ['SANAL POS ALIŞVERİŞ', 100, 'other'], ['POS ALIŞVERİŞ (YURTİÇİ)', 100, 'other'],
    ['POS ALIŞVERİŞ (YURTİÇİ)', -100, 'payments'], ['Synthetic unknown operation', -100, 'other'],
  ])('groups signed description %s (%s) as %s', (description, amount, id) => {
    const source = data([{ ...ordinary('row', amount, 'unreviewed', description), category: 'Manual category must not decide operation' }]);
    const result = report(source);
    expect(result.breakdown).toEqual([{ id, label: expect.any(String), inflow: amount > 0 ? amount : 0,
      outflow: amount < 0 ? -amount : 0, entryCount: 1 }]);
    expect(result.categoryTotals).toEqual([]); reconciles(result);
  });

  it('uses immutable bank wording instead of an edited note, including a captured blank description', () => {
    const source = data([ordinary('source-atm', 100, 'expense', 'Edited note: Referanslı Havale'),
      ordinary('source-blank', 50, 'expense', 'ATM PARA ÇEKME')]);
    capture(source, 'source-atm', 'ATM PARA ÇEKME'); capture(source, 'source-blank', '');
    const result = report(source);
    expect(result.breakdown.find(row => row.id === 'atm-withdrawal')?.outflow).toBe(100);
    expect(result.breakdown.find(row => row.id === 'payments')?.outflow).toBe(50);
    expect(result.breakdown.some(row => row.id === 'transfer')).toBe(false);
    reconciles(result);
  });

  it('preserves manual category labels while operation grouping follows signed source evidence', () => {
    const source = data([{ ...ordinary('atm', 100, 'expense', 'ATM PARA ÇEKME'), category: 'Kategori pribadi' },
      { ...ordinary('older', 50, 'expense', '', '2026-09-30'), category: 'Di luar periode' },
      { ...ordinary('future', 80, 'expense', '', '2026-11-01'), category: 'Di masa depan' }]);
    const before = structuredClone(source), result = report(source);
    expect(result.categoryTotals).toEqual([['Kategori pribadi', 100]]);
    expect(result.breakdown[0].id).toBe('atm-withdrawal');
    expect(source).toEqual(before); reconciles(result);
  });
});

describe('safe immutable projection boundaries', () => {
  it('keeps frozen source and persisted backup bytes/format unchanged', () => {
    const source = data([ordinary('m', -100), transfer()], [wallet('a', 'TRY', 'bank', 1_000), wallet('b')]);
    const before = serializeBackup(source);
    function freeze(value: object): void { Object.values(value).forEach(child => { if (child && typeof child === 'object') freeze(child); }); Object.freeze(value); }
    freeze(source);
    report(source); report(source, { period: 'all', walletId: 'b' });
    expect(serializeBackup(source)).toBe(before);
  });

  it('allows exact cancellation across safe wallet balances without rounding intermediate sums', () => {
    const source = data([], [wallet('a', 'TRY', 'bank', Number.MAX_SAFE_INTEGER), wallet('b', 'TRY', 'bank', 10),
      wallet('c', 'TRY', 'bank', -Number.MAX_SAFE_INTEGER)]);
    const result = report(source);
    expect(result).toMatchObject({ openingBalance: 10, closingBalance: 10, allRecordsBalance: 10 }); reconciles(result);
  });

  it('rejects an overflowing flow even if signed credits and debits cancel in closing', () => {
    const max = Number.MAX_SAFE_INTEGER;
    const source = data([ordinary('in-max', max), ordinary('in-one', 1), ordinary('out-max', -max), ordinary('out-one', -1)], [wallet('a')]);
    expect(() => report(source)).toThrow('batas nominal aman');
  });

  it('rejects an overflowing book balance rather than publishing rounded totals', () => {
    expect(() => report(data([ordinary('one', 1)], [wallet('a', 'TRY', 'bank', Number.MAX_SAFE_INTEGER)]))).toThrow('batas nominal aman');
  });

  it.each([NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1.25])('rejects unsafe posting amount %s', amount => {
    expect(() => report(data([ordinary('invalid', amount)]))).toThrow('safe integer');
  });

  it.each([
    { today: '2026-02-30' }, { month: '2026-13' }, { month: '2026-1' }, { currency: 'ZZZ' },
    { period: 'week' }, { walletId: 'missing' }, { walletId: 'cash' }, { walletId: 'usd' },
  ])('rejects invalid query %s', changes => {
    const source = data([], [wallet('a'), wallet('cash', 'TRY', 'cash'), wallet('usd', 'USD')]);
    expect(() => report(source, changes as Partial<CashflowQuery>)).toThrow(RangeError);
  });

  it('rejects malformed transfer direction and duplicate wallet identity', () => {
    expect(() => report(data([{ ...transfer(), fee: -1 }], [wallet('a'), wallet('b')]))).toThrow('Biaya');
    expect(() => report(data([{ ...transfer(), toAmount: -1 }], [wallet('a'), wallet('b')]))).toThrow('Pasangan transfer');
    expect(() => report(data([], [wallet('a'), wallet('a')]))).toThrow('Identitas dompet');
  });

  it('supports an empty active-account scope without counting archived cash balances', () => {
    const result = report(data([ordinary('cash', 100, 'income', '', DATE, 'cash')], [wallet('cash', 'TRY', 'cash', 500)]));
    expect(result).toMatchObject({ scopeWalletIds: [], openingBalance: 0, closingBalance: 0, inflow: 0, outflow: 0, allRecordsBalance: 0 });
    reconciles(result);
  });
});
