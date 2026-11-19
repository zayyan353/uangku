import { describe, expect, it } from 'vitest';
import type { Entry, Wallet } from './finance';
import { SOURCE_POLICY, type SourceDocument, type SourceMetadata } from './sourceModel';
import { walletFreshness } from './walletFreshness';

const TODAY = '2026-11-19';
const wallet = (id: string): Wallet => ({ id, name: `Synthetic ${id}`, currency: 'TRY', kind: 'bank', openingBalance: 0 });
const entry = (id: string, date: string, walletId = 'a', type: Entry['type'] = 'expense', amount = 100): Entry =>
  ({ id, date, walletId, type, amount, category: '', note: '' });
const transfer = (id: string, date: string, from = 'a', to = 'b'): Entry =>
  ({ ...entry(id, date, from, 'transfer', 500), toWalletId: to, toAmount: 500, fee: 5 });
const metadata = (extra: Partial<SourceMetadata> = {}): SourceMetadata => ({ policy: SOURCE_POLICY, facts: [], links: [], statements: [], ...extra });
const document = (entries: Entry[], extra?: Partial<SourceMetadata>, wallets = [wallet('a'), wallet('b'), wallet('c')]): SourceDocument =>
  ({ app: 'uangku', version: 1, demo: false, state: { version: 1, wallets, entries }, ...(extra ? { metadata: metadata(extra) } : {}) });
const statement = (id: string, walletId: string, periodStart: string, periodEnd: string) =>
  ({ id, walletId, currency: 'TRY' as const, periodStart, periodEnd, openingBalance: 0, closingBalance: 0, rowIds: [] });
const rows = (data: SourceDocument, today = TODAY) => Object.fromEntries(walletFreshness(data, today));

describe('MW-129a wallet freshness', () => {
  it('gives every wallet a row, empty when nothing is recorded for it', () => {
    expect(rows(document([]))).toEqual({
      a: { lastRecordOn: null, statementThrough: null }, b: { lastRecordOn: null, statementThrough: null }, c: { lastRecordOn: null, statementThrough: null } });
    expect([...walletFreshness(document([]), TODAY).keys()]).toEqual(['a', 'b', 'c']);
  });
  it('takes the latest record per wallet, whatever the order or kind of the records', () => {
    const data = document([entry('new', '2026-11-12'), entry('old', '2026-10-01'), entry('income', '2026-11-03', 'b', 'income'),
      entry('check', '2026-11-15', 'b', 'adjustment', -20), entry('pending', '2026-11-16', 'a', 'unreviewed', -30)]);
    expect(rows(data)).toMatchObject({ a: { lastRecordOn: '2026-11-16' }, b: { lastRecordOn: '2026-11-15' }, c: { lastRecordOn: null } });
  });
  it('does not take a record dated after today as the latest record', () => {
    const data = document([entry('past', '2026-11-10'), entry('today', TODAY, 'b'), entry('future', '2026-11-20'), entry('far', '2027-01-01', 'c')]);
    expect(rows(data)).toMatchObject({ a: { lastRecordOn: '2026-11-10' }, b: { lastRecordOn: TODAY }, c: { lastRecordOn: null } });
    expect(rows(data, '2026-11-20')).toMatchObject({ a: { lastRecordOn: '2026-11-20' } });
  });
  it('counts a transfer on each wallet at that side\'s own date', () => {
    const data = document([transfer('pair', '2026-11-01')], { transfers: [{ entryId: 'pair', sourceDate: '2026-11-01', destinationDate: '2026-11-04' }] });
    expect(rows(data)).toMatchObject({ a: { lastRecordOn: '2026-11-01' }, b: { lastRecordOn: '2026-11-04' }, c: { lastRecordOn: null } });
  });
  it('skips a transfer side whose date is recorded as unknown instead of filling it in', () => {
    const data = document([entry('known', '2026-10-20', 'b'), transfer('pair', '2026-11-01')],
      { transfers: [{ entryId: 'pair', sourceDate: '2026-11-01', destinationDate: null }] });
    expect(rows(data)).toMatchObject({ a: { lastRecordOn: '2026-11-01' }, b: { lastRecordOn: '2026-10-20' } });
    const neither = document([transfer('pair', '2026-11-01')], { transfers: [{ entryId: 'pair', sourceDate: null, destinationDate: null }] });
    expect(rows(neither)).toMatchObject({ a: { lastRecordOn: null }, b: { lastRecordOn: null } });
  });
  it('uses the one stored date of a transfer from before per-side dates for both wallets', () => {
    expect(rows(document([transfer('legacy', '2026-11-02')]))).toMatchObject({ a: { lastRecordOn: '2026-11-02' }, b: { lastRecordOn: '2026-11-02' } });
  });
  it('reads how far the stored statements reach, per wallet', () => {
    const data = document([entry('late', '2026-11-12')], { statements: [statement('s2', 'a', '2026-10-01', '2026-10-19'),
      statement('s1', 'a', '2026-09-01', '2026-09-30'), statement('s3', 'b', '2026-08-01', '2026-08-31')] });
    expect(rows(data)).toEqual({ a: { lastRecordOn: '2026-11-12', statementThrough: '2026-10-19' },
      b: { lastRecordOn: null, statementThrough: '2026-08-31' }, c: { lastRecordOn: null, statementThrough: null } });
  });
  it('ignores records and statements of a wallet the document does not hold', () => {
    const data = document([entry('gone', '2026-11-01', 'missing')], { statements: [statement('s', 'missing', '2026-10-01', '2026-10-31')] }, [wallet('a')]);
    expect(rows(data)).toEqual({ a: { lastRecordOn: null, statementThrough: null } });
  });
});
