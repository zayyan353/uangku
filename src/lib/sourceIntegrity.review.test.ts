import { describe, expect, it } from 'vitest';
import { walletBalance, walletBalanceAt, type Entry, type Wallet } from './finance';
import { applySourcedEntryEdit, deleteSourcedEntry, inspectSourcedImport, prepareSourcedImport, saveTransferEntry, type SourcedImportDecisions } from './sourceCommands';
import { inspectStoredStatement, prepareStatementCompletion } from './reconciliation';
import { executeTransferCommand, getTransferUnpairProblem } from './transferCommands';
import { parseBackupText, serializeBackup, validateBackup } from './storage';
import type { SourceDocument } from './sourceModel';
import type { ImportPreview } from './importer';

const at = '2026-10-31T10:00:00.000Z';
const decision = { reason: 'Independent synthetic review decision', at };
const wallets: Wallet[] = [
  { id: 'a', name: 'Review bank', currency: 'TRY', kind: 'bank', openingBalance: 0 },
  { id: 'b', name: 'Review destination', currency: 'TRY', kind: 'cash', openingBalance: 0 },
];
function empty(): SourceDocument { return { app: 'uangku', version: 1, demo: false, state: { version: 1, wallets: structuredClone(wallets), entries: [] } }; }
function preview(): ImportPreview {
  const movements = [10000, -2000, -550]; let running = 10000;
  return { currency: 'TRY', openingBalance: 10000, closingBalance: 17450, period: { start: '2026-10-01', end: '2026-10-03' }, warnings: [],
    rows: movements.map((amount, i) => ({ id: `r${i}`, date: `2026-10-0${i + 1}`, amount, balance: running += amount,
      description: `Raw movement ${i}`, originalDescription: `  Raw movement ${i}  `, reference: `ref${i}`,
      sourceKey: `ziraat:${(i + 1).toString(16).padStart(16, '0')}`, classification: 'unreviewed', category: 'Belum dikategorikan', selected: true, duplicate: false })) };
}
function imported(data = empty(), p = preview(), selected = [0, 1, 2], batch = 'review', useOpening = true, walletId = 'a') {
  const input = { ...p, rows: p.rows.map((row, i) => ({ ...row, selected: selected.includes(i) })) };
  const result = prepareSourcedImport(data, data.state.wallets.find(w => w.id === walletId)!, input, {}, useOpening, batch, at);
  if (result.status !== 'ready') throw new Error(result.status === 'invalid' ? result.message : 'Unexpected review setup');
  return result.data;
}
function manual(id: string, date: string, amount = 73): Entry {
  return { id, date, type: 'expense', walletId: 'a', amount, category: 'Belanja', note: 'Separate manual review record' };
}
function addManual(data: SourceDocument, entry: Entry): SourceDocument {
  return applySourcedEntryEdit(data, entry, [], decision);
}
function creditPreview(date = '2026-11-02'): ImportPreview {
  return { currency: 'TRY', openingBalance: 0, closingBalance: 10000, period: { start: date, end: date }, warnings: [], rows: [
    { id: 'credit', date, amount: 10000, balance: 10000, description: 'Destination bank credit', reference: 'credit-ref', sourceKey: 'ziraat:ffffffffffffffff', classification: 'unreviewed', category: 'Belum dikategorikan', selected: true, duplicate: false },
  ] };
}
function manualTransfer(destinationDate: string | null = '2026-11-02'): SourceDocument {
  const data = empty(); data.state.wallets[0].openingBalance = 50000;
  const entry: Entry = { id: 'manual-transfer', date: '2026-10-31', type: 'transfer', walletId: 'a', toWalletId: 'b', amount: 10000, toAmount: 10000, category: '', note: 'Manual two-date transfer' };
  return saveTransferEntry(data, entry, [], { sourceDate: '2026-10-31', destinationDate, declareDates: true, ...decision });
}

describe('independent source integrity review', () => {
  it('rejects completion that would silently count an existing manual movement twice', () => {
    const partial = imported(empty(), preview(), [2]);
    const data = addManual(partial, manual('already-manual', '2026-10-02', 2000)), before = structuredClone(data);
    expect(() => prepareStatementCompletion(data, data.metadata!.statements[0].id, decision)).toThrow(/manual|kandidat|impor ulang/i);
    expect(data).toEqual(before); expect(data.state.entries).toHaveLength(2);
  });

  it('allows a genuinely separate same-value manual transaction only after an explicit current distinct decision', () => {
    const data = addManual(imported(empty(), preview(), [2]), manual('same-value-distinct', '2026-10-02', 2000));
    const p = preview(); p.rows = p.rows.map((row, i) => ({ ...row, selected: i === 1 }));
    const inspected = inspectSourcedImport(data, data.state.wallets[0], p);
    expect(inspected.sourceReviews.r1.allowedResolutions).toContain('distinct');
    const choices: SourcedImportDecisions = Object.fromEntries(Object.entries(inspected.sourceReviews).map(([id, review]) => [id, { signature: review.signature, resolution: id === 'r1' ? 'distinct' : 'keep' }]));
    const accepted = prepareSourcedImport(data, data.state.wallets[0], p, choices, false, 'explicit-distinct', at);
    expect(accepted.status).toBe('ready');
    if (accepted.status !== 'ready') throw new Error('Explicit distinct decision was not applied');
    expect(accepted.data.state.entries.filter(e => e.id === 'same-value-distinct')).toHaveLength(1);
    expect(accepted.data.state.entries.filter(e => e.sourceKey === p.rows[1].sourceKey)).toHaveLength(1);
    const completed = prepareStatementCompletion(accepted.data, accepted.data.metadata!.statements[0].id, decision);
    expect(walletBalance(completed.state, 'a', completed.metadata)).toBe(15450);
    expect(completed.state.entries).toHaveLength(4);
    expect(inspectStoredStatement(completed, completed.metadata!.statements[0].id).quality.extraEntryIds).toContain('same-value-distinct');
  });

  it('preserves genuine additional manual flows when completing deferred bank rows', () => {
    const partial = imported(empty(), preview(), [2]);
    const data = addManual(partial, manual('separate-flow', '2026-10-02', 73)), before = structuredClone(data);
    const complete = prepareStatementCompletion(data, data.metadata!.statements[0].id, decision);
    expect(data).toEqual(before); expect(complete.state.entries).toHaveLength(4);
    expect(complete.state.entries.find(e => e.id === 'separate-flow')).toEqual(before.state.entries.find(e => e.id === 'separate-flow'));
    expect(walletBalance(complete.state, 'a', complete.metadata)).toBe(17377);
    expect(inspectStoredStatement(complete, complete.metadata!.statements[0].id)).toMatchObject({ difference: -73, quality: { status: 'incomplete', comparable: false, extraEntryIds: ['separate-flow'] } });
  });

  it('does not call a bank file complete merely because unproven manual flows cancel to its balance', () => {
    let data = imported();
    data = addManual(data, manual('expense-cancel', '2026-10-02', 73));
    data = addManual(data, { ...manual('income-cancel', '2026-10-02', 73), type: 'income' });
    const quality = inspectStoredStatement(data, data.metadata!.statements[0].id);
    expect(quality.difference).toBe(0); expect(quality.quality.status).toBe('incomplete'); expect(quality.quality.comparable).toBe(false);
    expect(new Set(quality.quality.extraEntryIds)).toEqual(new Set(['expense-cancel', 'income-cancel']));
  });

  it('backfills an earlier witnessed boundary without absorbing extra manual expenses into opening balance', () => {
    const full = preview(), row = full.rows[2];
    const tail: ImportPreview = { ...full, rows: [{ ...row }], openingBalance: 18000, period: { start: row.date, end: row.date } };
    let data = imported(empty(), tail, [0], 'tail-review');
    data = addManual(data, manual('extra-between-boundaries', '2026-10-02', 73));
    const beforeBalance = walletBalance(data.state, 'a', data.metadata);
    const captured = imported(data, full, [], 'full-review', false);
    const result = prepareStatementCompletion(captured, captured.metadata!.statements.at(-1)!.id, { ...decision, rebase: true });
    expect(result.state.wallets[0].openingBalance).toBe(10000);
    expect(walletBalance(result.state, 'a', result.metadata)).toBe(beforeBalance);
    expect(result.state.entries.find(e => e.id === 'extra-between-boundaries')!.amount).toBe(73);
    expect(inspectStoredStatement(result, result.metadata!.statements.at(-1)!.id).quality.extraEntryIds).toContain('extra-between-boundaries');
  });

  it('rejects ordinary edits that request removing an unrelated manual entry', () => {
    let data = addManual(empty(), manual('first', '2026-10-01'));
    data = addManual(data, manual('unrelated', '2026-10-02'));
    const before = structuredClone(data), first = data.state.entries[0];
    expect(() => applySourcedEntryEdit(data, { ...first, note: 'Edit only first' }, ['unrelated'], decision)).toThrow(/lain|pasangan|ID|hapus/i);
    expect(data).toEqual(before);
  });

  it('restores a linked source alias to its immutable fact instead of accepting an edited alias', () => {
    const data = imported(), entry = data.state.entries.find(e => e.sourceKey === preview().rows[1].sourceKey)!;
    const changed = applySourcedEntryEdit(data, { ...entry, sourceKey: 'ziraat:aaaaaaaaaaaaaaaa', note: 'User memo' }, [entry.id], decision);
    expect(changed.state.entries.find(e => e.id === entry.id)!.sourceKey).toBe(entry.sourceKey);
    expect(changed.metadata!.facts).toEqual(data.metadata!.facts);
    expect(changed.metadata!.facts[1].description).toBe('  Raw movement 1  ');
  });

  it('keeps deletion decisions through repeated completion and exact metadata backups', () => {
    const initial = imported(), entry = initial.state.entries.find(e => e.sourceKey === preview().rows[1].sourceKey)!;
    const removed = deleteSourcedEntry(initial, entry.id, decision);
    const once = prepareStatementCompletion(removed, removed.metadata!.statements[0].id, { ...decision, includeExcluded: true });
    const twice = prepareStatementCompletion(once, once.metadata!.statements[0].id, decision);
    expect(twice.state.entries.some(e => e.sourceKey === entry.sourceKey)).toBe(false);
    expect(twice.metadata!.facts).toEqual(initial.metadata!.facts);
    expect(twice.metadata!.dispositions!.find(d => d.kind === 'deleted')).toEqual(removed.metadata!.dispositions!.find(d => d.kind === 'deleted'));
    expect(parseBackupText(serializeBackup(twice))).toEqual(twice);
  });

  it('requires an explicit manual-overlap decision for a destination bank row on its own transfer posting date', () => {
    const data = manualTransfer(), p = creditPreview();
    const inspect = inspectSourcedImport(data, data.state.wallets[1], p);
    expect(inspect.needsReview).toBe(true);
    expect(inspect.overlaps.credit?.candidates.map(e => e.id)).toContain('manual-transfer');
    const prepared = prepareSourcedImport(data, data.state.wallets[1], p, {}, false, 'credit-import', at);
    expect(prepared.status).toBe('review'); expect(data.state.entries).toHaveLength(1);
  });

  it('does not treat an unknown destination posting date as proof a matching bank row is different', () => {
    const data = manualTransfer(null), p = creditPreview();
    const result = prepareSourcedImport(data, data.state.wallets[1], p, {}, false, 'unknown-credit', at);
    expect(result.status).not.toBe('ready'); expect(data.state.entries).toHaveLength(1);
    expect(data.metadata!.transfers![0].destinationDate).toBeNull();
  });

  it('invalidates a manual transfer decision when the applicable posting date changes', () => {
    const data = manualTransfer(), p = creditPreview(), inspection = inspectSourcedImport(data, data.state.wallets[1], p);
    expect(inspection.needsReview).toBe(true);
    const signature = inspection.overlaps.credit!.signature;
    const changed = executeTransferCommand(data, { kind: 'edit', entry: data.state.entries[0], sourceDate: '2026-10-31', destinationDate: '2026-11-03', ...decision });
    const decisions: SourcedImportDecisions = { credit: { resolution: 'distinct', signature } };
    const rechecked = prepareSourcedImport(changed, changed.state.wallets[1], p, decisions, false, 'stale-date', at);
    expect(rechecked.status).toBe('review');
  });

  it('invalidates a deferred-source distinct decision when its manual counterpart date was newly declared', () => {
    const base = manualTransfer(null), p = creditPreview();
    const captured = imported(base, p, [], 'capture-destination', false, 'b');
    const inspected = inspectSourcedImport(captured, captured.state.wallets[1], p), review = inspected.sourceReviews.credit;
    expect(review.status).toBe('known-deferred'); expect(review.allowedResolutions).toContain('distinct');
    const changed = executeTransferCommand(captured, { kind: 'edit', entry: captured.state.entries[0], sourceDate: '2026-10-31', destinationDate: '2026-11-02', ...decision });
    const rechecked = prepareSourcedImport(changed, changed.state.wallets[1], p, { credit: { resolution: 'distinct', signature: review.signature } }, false, 'stale-deferred', at);
    expect(rechecked.status).toBe('review');
  });

  it('memo editing a legacy transfer keeps its old financial meaning without claiming bank dates or facts', () => {
    const data = empty(); data.state.entries.push({ id: 'legacy', date: '2026-10-01', type: 'transfer', walletId: 'a', toWalletId: 'b', amount: 100, toAmount: 100, category: '', note: 'Old memo' });
    const originalWire = serializeBackup(data);
    const edited = applySourcedEntryEdit(data, { ...data.state.entries[0], note: 'New memo' }, ['legacy'], { reason: '', at });
    expect(edited.metadata!.facts).toEqual([]); expect(edited.metadata!.transfers ?? []).toEqual([]);
    expect(getTransferUnpairProblem(edited, 'legacy')).toMatch(/tanggal|legacy|lama/i);
    expect(walletBalanceAt(edited.state, 'a', '2026-10-01', edited.metadata)).toBe(-100);
    expect(serializeBackup(data)).toBe(originalWire);
  });

  it('rejects a metadata reference mutation and keeps the previously serialized source intact', () => {
    const data = imported(), original = serializeBackup(data), bad = structuredClone(data);
    bad.metadata!.links[0].source = 'missing-source';
    expect(() => validateBackup(bad)).toThrow(); expect(serializeBackup(data)).toBe(original);
    const roundtrip = parseBackupText(original);
    roundtrip.metadata!.facts[0].description = 'Detached changed copy';
    expect(data.metadata!.facts[0].description).toBe('  Raw movement 0  ');
  });
});
