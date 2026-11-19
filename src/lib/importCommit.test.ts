/** New local recovery regressions. Runtime module is restored byte-for-byte from E2 history. */
import { describe, expect, it } from 'vitest';
import { inspectImport, MANUAL_MATCH_DAYS, nearbyDates, prepareImport, type ImportDecisions } from './importCommit';
import { walletBalance, type Entry, type State, type Wallet } from './finance';
import type { ImportPreview, ImportRow } from './importer';

const wallet: Wallet = { id: 'bank', name: 'Synthetic bank', kind: 'bank', currency: 'TRY', openingBalance: 12000 };
const cash: Wallet = { id: 'cash', name: 'Synthetic cash', kind: 'cash', currency: 'TRY', openingBalance: 0 };
const manual = (overrides: Partial<Entry> = {}): Entry => ({
  id: 'manual', date: '2026-10-21', type: 'expense', walletId: wallet.id,
  amount: 2000, category: 'Belanja', note: 'Manual debit', ...overrides,
});
const state = (entries: Entry[] = []): State => ({ version: 1, wallets: [{ ...wallet }, { ...cash }], entries });
const preview = (): ImportPreview => ({
  currency: 'TRY', openingBalance: 12000, closingBalance: 17450, warnings: [],
  period: { start: '2026-10-21', end: '2026-10-23' },
  rows: [
    { id: 'newest', date: '2026-10-23', amount: -2550, balance: 17450, classification: 'expense' },
    { id: 'credit', date: '2026-10-22', amount: 10000, balance: 20000, classification: 'unreviewed' },
    { id: 'oldest', date: '2026-10-21', amount: -2000, balance: 10000, classification: 'expense' },
  ].map(row => ({ description: 'Synthetic bank movement', reference: row.id,
    sourceKey: `bank:${row.id}`, category: 'Belum dikategorikan', selected: true, duplicate: false, ...row } as ImportRow)),
});

function choose(input: State, p: ImportPreview, id: string, resolution: 'skip' | 'distinct'): ImportDecisions {
  const inspection = inspectImport(input, wallet, p);
  const signature = inspection.overlaps[id]?.signature;
  if (!signature) throw new Error('Fixture did not expose overlap');
  p.rows = p.rows.map(row => row.id === id ? { ...row, selected: resolution === 'distinct' } : row);
  return { [id]: { signature, resolution } };
}

describe('recovered import commit: current-ledger decisions', () => {
  it('imports the complete audit fixture with the exact 174.50 balance and stable chronological append', () => {
    const input = state(), p = preview();
    const before = JSON.stringify({ input, p });
    const result = prepareImport(input, wallet, p, {}, false, 'full');
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.state.entries.map(entry => entry.date)).toEqual(['2026-10-21', '2026-10-22', '2026-10-23']);
    expect(walletBalance(result.state, wallet.id)).toBe(17450);
    expect(JSON.stringify({ input, p })).toBe(before);
  });

  it.each(['before-preview', 'after-preview'])('requires the same review for a manual match %s', timing => {
    const input = state(), p = preview();
    if (timing === 'after-preview') expect(inspectImport(input, wallet, p).needsReview).toBe(false);
    input.entries.push(manual());
    const before = JSON.stringify({ input, p });
    const result = prepareImport(input, wallet, p, {}, false, 'overlap');
    expect(result.status).toBe('review');
    expect(result.inspection.overlaps.oldest.candidates.map(entry => entry.id)).toEqual(['manual']);
    expect(JSON.stringify({ input, p })).toBe(before);
  });

  it('skips an explicitly matched bank row and leaves three entries / 174.50 after serialization', () => {
    const input = state([manual()]), p = preview();
    const decisions = choose(input, p, 'oldest', 'skip');
    const result = prepareImport(input, wallet, p, decisions, false, 'skip');
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    const refreshed = JSON.parse(JSON.stringify(result.state)) as State;
    expect(refreshed.entries).toHaveLength(3);
    expect(walletBalance(refreshed, wallet.id)).toBe(17450);
    expect(refreshed.entries[0]).toEqual(manual());
    expect(refreshed.entries.filter(entry => entry.sourceKey === 'bank:oldest')).toHaveLength(0);
  });

  it('allows an explicitly different transaction of the same date and amount', () => {
    const input = state([manual()]), p = preview();
    const decisions = choose(input, p, 'oldest', 'distinct');
    const result = prepareImport(input, wallet, p, decisions, false, 'distinct');
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.state.entries).toHaveLength(4);
    expect(walletBalance(result.state, wallet.id)).toBe(15450);
  });

  it('does not reselect a distinct row that the user subsequently unchecked', () => {
    const input = state([manual()]), p = preview();
    const decisions = choose(input, p, 'oldest', 'distinct');
    p.rows.find(row => row.id === 'oldest')!.selected = false;
    const result = prepareImport(input, wallet, p, decisions, false, 'unchecked');
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.entries).toHaveLength(2);
    expect(walletBalance(result.state, wallet.id)).toBe(17450);
  });

  it('invalidates a decision after the candidate facts change', () => {
    const input = state([manual()]), p = preview();
    const decisions = choose(input, p, 'oldest', 'distinct');
    input.entries[0].note = 'Changed after decision';
    expect(prepareImport(input, wallet, p, decisions, false, 'stale-choice').status).toBe('review');
  });

  it('invalidates a decision after the statement row facts change', () => {
    const input = state([manual()]), p = preview();
    const decisions = choose(input, p, 'oldest', 'distinct');
    p.rows.find(row => row.id === 'oldest')!.reference = 'Changed reference';
    expect(prepareImport(input, wallet, p, decisions, false, 'stale-row').status).toBe('review');
  });

  it('requires renewed review after a previously confirmed candidate disappears', () => {
    const input = state([manual()]), p = preview();
    const decisions = choose(input, p, 'oldest', 'distinct');
    input.entries = [];
    expect(prepareImport(input, wallet, p, decisions, false, 'removed').status).toBe('review');
  });

  it('requires review when an imported fingerprint appeared after preview', () => {
    const input = state([manual({ id: 'imported', sourceKey: 'bank:oldest' })]), p = preview();
    const result = prepareImport(input, wallet, p, {}, false, 'new-fingerprint');
    expect(result.status).toBe('review');
    expect(result.inspection.changedFingerprintIds).toEqual(['oldest']);
    expect(result.inspection.rows.find(row => row.id === 'oldest')).toMatchObject({ selected: false, duplicate: true });
  });

  it('preserves an unrelated latest-ledger entry when preparing the import', () => {
    const unrelated = manual({ id: 'other-wallet', walletId: cash.id, amount: 123 });
    const input = state([unrelated]), p = preview();
    const result = prepareImport(input, wallet, p, {}, false, 'latest');
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.state.entries[0]).toEqual(unrelated);
    expect(result.state.entries).toHaveLength(4);
    expect(walletBalance(result.state, wallet.id)).toBe(17450);
  });

  it.each(['opening', 'currency', 'missing-wallet', 'duplicate-row-id'])('rejects changed preview assumptions: %s', change => {
    const input = state(), p = preview();
    if (change === 'opening') input.wallets[0].openingBalance += 1;
    if (change === 'currency') input.wallets[0].currency = 'USD';
    if (change === 'missing-wallet') input.wallets = [input.wallets[1]];
    if (change === 'duplicate-row-id') p.rows[1].id = p.rows[0].id;
    const before = JSON.stringify({ input, p });
    expect(prepareImport(input, wallet, p, {}, true, 'invalid').status).toBe('invalid');
    expect(JSON.stringify({ input, p })).toBe(before);
  });

  it('does not mutate input when a later appended row fails validation', () => {
    const input = state(), p = preview();
    p.rows[0].amount = Number.NaN;
    const before = structuredClone({ input, p });
    const result = prepareImport(input, wallet, p, {}, true, 'invalid-row');
    expect(result.status).toBe('invalid');
    expect({ input, p }).toEqual(before);
    expect(input.entries).toHaveLength(0);
    expect(input.wallets[0].openingBalance).toBe(12000);
  });

  it('keeps cancelled review isolated even if the caller edits display candidate copies', () => {
    const input = state([manual()]), p = preview();
    const before = JSON.stringify({ input, p });
    const result = prepareImport(input, wallet, p, {}, false, 'cancelled');
    expect(result.status).toBe('review');
    result.inspection.overlaps.oldest.candidates[0].amount = 777;
    result.inspection.rows[0].selected = false;
    expect(JSON.stringify({ input, p })).toBe(before);
  });
});

describe('manual transfer legs use the target wallet movement', () => {
  it('matches source principal plus fee to a debit row', () => {
    const input = state([manual({ type: 'transfer', amount: 1900, toWalletId: cash.id, toAmount: 1900, fee: 100 })]);
    expect(inspectImport(input, wallet, preview()).overlaps.oldest.candidates).toHaveLength(1);
  });

  it('matches an incoming transfer leg to the credit amount', () => {
    const input = state([manual({ type: 'transfer', walletId: cash.id, toWalletId: wallet.id, amount: 10000, toAmount: 10000, date: '2026-10-22', fee: 100 })]);
    expect(inspectImport(input, wallet, preview()).overlaps.credit.candidates).toHaveLength(1);
  });

  it('does not treat a sourced source leg as a manual movement', () => {
    const input = state([manual({ type: 'transfer', amount: 1900, toWalletId: cash.id, toAmount: 1900, fee: 100, sourceKey: 'other-source' })]);
    expect(inspectImport(input, wallet, preview()).overlaps.oldest).toBeUndefined();
  });

  it('still checks an unsourced destination when the source leg has a fingerprint', () => {
    const input = state([manual({ type: 'transfer', walletId: cash.id, toWalletId: wallet.id, amount: 10000, toAmount: 10000, date: '2026-10-22', sourceKey: 'cash-source' })]);
    expect(inspectImport(input, wallet, preview()).overlaps.credit.candidates).toHaveLength(1);
  });
});

describe('MW-90 manual records near a bank row are offered as possible duplicates', () => {
  const overlapIds = (input: State) => Object.fromEntries(Object.entries(inspectImport(input, wallet, preview()).overlaps).map(([id, overlap]) => [id, overlap.candidates.map(entry => entry.id)]));

  it('lists the dates around a day, closest first, across month and leap-year ends', () => {
    expect(MANUAL_MATCH_DAYS).toBe(3);
    expect(nearbyDates('2026-10-21')).toEqual(['2026-10-21', '2026-10-20', '2026-10-22', '2026-10-19', '2026-10-23', '2026-10-18', '2026-10-24']);
    expect(nearbyDates('2026-03-01', 1)).toEqual(['2026-03-01', '2026-02-28', '2026-03-02']);
    expect(nearbyDates('2028-03-01', 1)).toEqual(['2028-03-01', '2028-02-29', '2028-03-02']);
    expect(nearbyDates('2026-12-31', 1)).toEqual(['2026-12-31', '2026-12-30', '2027-01-01']);
    expect(nearbyDates('2026-10-21', 0)).toEqual(['2026-10-21']);
    expect(nearbyDates('bukan tanggal')).toEqual(['bukan tanggal']);
  });

  it.each([
    ['one day earlier', '2026-10-20', true], ['three days earlier', '2026-10-18', true], ['four days earlier', '2026-10-17', false],
    ['three days later', '2026-10-24', true], ['four days later', '2026-10-25', false],
  ] as const)('a manual record %s: offered = %s', (_label, date, offered) => {
    // The bank row is the 20.00 debit of 21 October.
    expect(overlapIds(state([manual({ date })]))).toEqual(offered ? { oldest: ['manual'] } : {});
  });

  it('still needs the same signed amount: one minor unit apart is not offered, on any day', () => {
    expect(overlapIds(state([manual({ amount: 2001 })]))).toEqual({});
    expect(overlapIds(state([manual({ amount: 1999, date: '2026-10-20' })]))).toEqual({});
    // An income of the same size is the opposite movement.
    expect(overlapIds(state([manual({ type: 'income', date: '2026-10-20' })]))).toEqual({});
    // A record already tied to a bank row is not a manual one.
    expect(overlapIds(state([manual({ date: '2026-10-20', sourceKey: 'bank:other' })]))).toEqual({});
    // Another wallet's record is not offered.
    expect(overlapIds(state([manual({ date: '2026-10-20', walletId: cash.id })]))).toEqual({});
  });

  it('puts the closest date first when several manual records qualify', () => {
    const input = state([manual({ id: 'two-after', date: '2026-10-23' }), manual({ id: 'day-before', date: '2026-10-20' }), manual({ id: 'same-day' })]);
    expect(overlapIds(input)).toEqual({ oldest: ['same-day', 'day-before', 'two-after'] });
  });

  it('never skips the row on its own: it stays selected and the import waits for an explicit choice', () => {
    const input = state([manual({ date: '2026-10-19' })]), p = preview();
    const before = JSON.stringify({ input, p });
    const waiting = prepareImport(input, wallet, p, {}, false, 'near');
    expect(waiting.status).toBe('review');
    expect(waiting.inspection.rows.find(row => row.id === 'oldest')).toMatchObject({ selected: true, duplicate: false });
    expect(JSON.stringify({ input, p })).toBe(before);
    // "Transaksi berbeda": both the manual record and the bank row are kept.
    const distinct = prepareImport(input, wallet, p, choose(input, p, 'oldest', 'distinct'), false, 'near-distinct');
    expect(distinct.status).toBe('ready');
    if (distinct.status === 'ready') expect(distinct.state.entries.filter(entry => entry.amount === 2000).map(entry => entry.date).sort()).toEqual(['2026-10-19', '2026-10-21']);
    // "Lewati": only the manual record remains for that movement.
    const q = preview(), skipped = prepareImport(input, wallet, q, choose(input, q, 'oldest', 'skip'), false, 'near-skip');
    expect(skipped.status).toBe('ready');
    if (skipped.status === 'ready') expect(skipped.state.entries.filter(entry => entry.amount === 2000).map(entry => entry.id)).toEqual(['manual']);
  });

  it('asks again when the nearby manual record changed after the choice was made', () => {
    const input = state([manual({ date: '2026-10-19' })]), p = preview();
    const decisions = choose(input, p, 'oldest', 'distinct');
    input.entries[0] = manual({ date: '2026-10-19', note: 'Diubah sesudah memilih' });
    expect(prepareImport(input, wallet, p, decisions, false, 'near-stale').status).toBe('review');
  });
});
