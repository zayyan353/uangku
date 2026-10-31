/** New local recovery regressions. Runtime module is restored byte-for-byte from E2 history. */
import { describe, expect, it } from 'vitest';
import { inspectImport, prepareImport, type ImportDecisions } from './importCommit';
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
