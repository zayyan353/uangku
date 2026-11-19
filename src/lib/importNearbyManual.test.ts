import { describe, expect, it } from 'vitest';
import { applySourcedEntryEdit, inspectSourcedImport, prepareSourcedImport, saveTransferEntry, type SourcedImportDecisions } from './sourceCommands';
import { prepareStatementCompletion } from './reconciliation';
import { serializeBackup, parseBackupText, type StoredData } from './storage';
import { UNCATEGORIZED } from './categorySettings';
import type { Entry, Wallet } from './finance';
import type { ImportPreview, ImportRow } from './importer';

/** MW-90 through the path the import screen uses: the sourced inspection and the commit behind it. */
const at = '2026-10-31T10:00:00.000Z';
const wallets: Wallet[] = [
  { id: 'a', name: 'Synthetic bank A', kind: 'bank', currency: 'TRY', openingBalance: 50_000 },
  { id: 'b', name: 'Synthetic bank B', kind: 'bank', currency: 'TRY', openingBalance: 0 },
];
const empty = (): StoredData => ({ app: 'uangku', version: 1, demo: false, state: { version: 1, wallets: structuredClone(wallets), entries: [] } });
const expense = (id: string, date: string, amount = 2_000): Entry => ({ id, date, type: 'expense', walletId: 'a', amount, category: UNCATEGORIZED, note: `Synthetic ${id}` });
/** An older record of another size comes first: bank rows older than a wallet's first activity are refused by a separate rule. */
const anchor = expense('anchor', '2026-10-01', 111);
const withManual = (...entries: Entry[]): StoredData => [anchor, ...entries].reduce((data, entry) => applySourcedEntryEdit(data, entry, [], { reason: '', at }), empty());

/** Fingerprints must have the bank reader's shape to be stored. */
const fingerprint = (walletId: string, index: number, file = 0) => `ziraat:${((walletId === 'a' ? 1 : 101) + index + file * 1_000).toString(16).padStart(16, '0')}`;

/** One bank debit of 20.00 on 21 October in wallet A, and a second unrelated row so the file has a period. */
function statement(walletId = 'a', opening = 50_000, amounts: [string, number][] = [['2026-10-21', -2_000], ['2026-10-22', -1_234]], file = 0): ImportPreview {
  let running = opening;
  const rows: ImportRow[] = amounts.map(([date, amount], index) => ({
    id: `row-${walletId}-${index}`, date, amount, balance: running += amount, description: `Synthetic bank row ${file}-${index}`, reference: `REF-${walletId}-${file}-${index}`,
    sourceKey: fingerprint(walletId, index, file), classification: 'unreviewed', category: UNCATEGORIZED, selected: true, duplicate: false,
  }));
  return { currency: 'TRY', openingBalance: opening, closingBalance: running, rows, period: { start: rows[0].date, end: rows.at(-1)!.date }, warnings: [], sourceOrder: 'oldest' };
}
const wallet = (id: string) => wallets.find(item => item.id === id)!;
const prepare = (data: StoredData, preview: ImportPreview, decisions: SourcedImportDecisions, batch: string, walletId = 'a') =>
  prepareSourcedImport(data, wallet(walletId), preview, decisions, false, batch, at);

describe('MW-90 nearby manual records in the sourced import', () => {
  it.each([['the day before', '2026-10-20', true], ['three days before', '2026-10-18', true], ['four days before', '2026-10-17', false], ['three days after', '2026-10-24', true], ['four days after', '2026-10-25', false]] as const)(
    'a manual expense %s the bank row: offered = %s', (_label, date, offered) => {
      const data = withManual(expense('manual', date)), preview = statement();
      const inspection = inspectSourcedImport(data, wallet('a'), preview);
      expect(Object.keys(inspection.overlaps)).toEqual(offered ? ['row-a-0'] : []);
      expect(inspection.needsReview).toBe(offered);
      // Offered or not, nothing is deselected for the user.
      expect(inspection.rows.every(row => row.selected && !row.duplicate)).toBe(true);
      expect(prepare(data, preview, {}, 'plain').status).toBe(offered ? 'review' : 'ready');
    });

  it('keeps both when the user says "Transaksi berbeda", and the stored result reads back', () => {
    const data = withManual(expense('manual', '2026-10-19')), preview = statement(), before = structuredClone(data);
    const inspection = inspectSourcedImport(data, wallet('a'), preview);
    expect(inspection.overlaps['row-a-0'].candidates.map(entry => entry.id)).toEqual(['manual']);
    const decisions: SourcedImportDecisions = { 'row-a-0': { signature: inspection.overlaps['row-a-0'].signature, resolution: 'distinct' } };
    const result = prepare(data, preview, decisions, 'distinct');
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(data).toEqual(before);
    expect(result.data.state.entries.filter(entry => entry.id !== 'anchor').map(entry => [entry.date, entry.amount]).sort()).toEqual([['2026-10-19', 2_000], ['2026-10-21', -2_000], ['2026-10-22', -1_234]].sort());
    expect(result.data.metadata!.facts).toHaveLength(2);
    expect(parseBackupText(serializeBackup(result.data))).toEqual(result.data);
  });

  it('keeps only the manual record when the user says "Lewati", and still stores the bank fact', () => {
    const data = withManual(expense('manual', '2026-10-23')), preview = statement();
    const signature = inspectSourcedImport(data, wallet('a'), preview).overlaps['row-a-0'].signature;
    const unselected = { ...preview, rows: preview.rows.map(row => row.id === 'row-a-0' ? { ...row, selected: false } : row) };
    const result = prepare(data, unselected, { 'row-a-0': { signature, resolution: 'skip' } }, 'skip');
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.data.state.entries.filter(entry => Math.abs(entry.amount) === 2_000).map(entry => entry.id)).toEqual(['manual']);
    const fact = result.data.metadata!.facts.find(row => row.fingerprint === fingerprint('a', 0))!;
    expect(result.data.metadata!.dispositions).toContainEqual(expect.objectContaining({ sourceId: fact.id, kind: 'excluded' }));
    expect(result.data.metadata!.links.some(link => link.source === fact.id)).toBe(false);
  });

  it('asks again when the choice no longer describes the candidates', () => {
    const data = withManual(expense('manual', '2026-10-20')), preview = statement();
    const signature = inspectSourcedImport(data, wallet('a'), preview).overlaps['row-a-0'].signature;
    const more = applySourcedEntryEdit(data, expense('second', '2026-10-22'), [], { reason: '', at });
    expect(inspectSourcedImport(more, wallet('a'), preview).overlaps['row-a-0'].candidates.map(entry => entry.id).sort()).toEqual(['manual', 'second']);
    expect(prepare(more, preview, { 'row-a-0': { signature, resolution: 'distinct' } }, 'stale').status).toBe('review');
  });

  it('uses the date the money reached this wallet for a manual transfer, not the date it was sent', () => {
    // Sent from A on the 20th and declared to reach B on the 28th.
    const transfer: Entry = { id: 'transfer', date: '2026-10-20', type: 'transfer', walletId: 'a', amount: 7_500, category: '', note: 'Synthetic transfer', toWalletId: 'b', toAmount: 7_500 };
    const data = saveTransferEntry(empty(), transfer, [], { sourceDate: '2026-10-20', destinationDate: '2026-10-28', reason: 'Synthetic manual transfer', at });
    // A credit two days after the arrival date is offered and can be kept as a different transaction.
    const near = statement('b', 0, [['2026-10-30', 7_500], ['2026-10-31', -100]]);
    const inspection = inspectSourcedImport(data, wallet('b'), near);
    expect(inspection.overlaps['row-b-0'].candidates.map(entry => entry.id)).toEqual(['transfer']);
    expect(prepare(data, near, {}, 'near', 'b').status).toBe('review');
    expect(prepare(data, near, { 'row-b-0': { signature: inspection.overlaps['row-b-0'].signature, resolution: 'distinct' } }, 'near-distinct', 'b').status).toBe('ready');
    // A credit one day after the sending date is seven days before the arrival: not offered.
    const early = statement('b', 0, [['2026-10-21', 7_500], ['2026-10-22', -100]], 1);
    expect(inspectSourcedImport(data, wallet('b'), early)).toMatchObject({ overlaps: {}, needsReview: false });
    // Four days after the arrival is outside the window too, and that file saves without a choice.
    const late = statement('b', 0, [['2026-11-01', 7_500], ['2026-11-02', -100]], 2);
    expect(inspectSourcedImport(data, wallet('b'), late)).toMatchObject({ overlaps: {}, needsReview: false });
    expect(prepare(data, late, {}, 'late', 'b').status).toBe('ready');
  });

  it('never asks for a choice the screen does not offer: a corrected bank record near a new row of the same amount', () => {
    // A bank row of 20.00 on 5 October is imported, then the user corrects that record's date to the 4th.
    const first = prepare(empty(), statement('a', 50_000, [['2026-10-05', -2_000], ['2026-10-06', -1_234]]), {}, 'first');
    if (first.status !== 'ready') throw new Error('Fixture import failed');
    const record = first.data.state.entries.find(entry => entry.amount === -2_000 || entry.amount === 2_000)!;
    const corrected = applySourcedEntryEdit(first.data, { ...record, date: '2026-10-04' }, [], { reason: 'Koreksi tanggal sintetis', at });
    expect(corrected.metadata!.links.some(link => link.entryId === record.id)).toBe(true);
    // A later file has another 20.00 three days after the corrected date. It is a different bank row, not a manual record.
    const second = statement('a', 46_766, [['2026-10-07', -2_000], ['2026-10-08', -100]], 1);
    expect(inspectSourcedImport(corrected, wallet('a'), second)).toMatchObject({ overlaps: {}, sourceReviews: {}, needsReview: false });
    const saved = prepare(corrected, second, {}, 'second');
    expect(saved.status).toBe('ready');
    if (saved.status === 'ready') expect(saved.data.metadata!.facts).toHaveLength(4);
    // The same holds for a corrected amount.
    const repriced = applySourcedEntryEdit(first.data, { ...record, amount: 1_500 }, [], { reason: 'Koreksi nominal sintetis', at });
    const third = statement('a', 46_766, [['2026-10-07', -1_500], ['2026-10-08', -100]], 2);
    expect(inspectSourcedImport(repriced, wallet('a'), third).needsReview).toBe(false);
    expect(prepare(repriced, third, {}, 'third').status).toBe('ready');
  });

  it('keeps offering the nearby manual record when the file is read again after "Lewati"', () => {
    const data = withManual(expense('manual', '2026-10-19')), preview = statement();
    const signature = inspectSourcedImport(data, wallet('a'), preview).overlaps['row-a-0'].signature;
    const unselected = { ...preview, rows: preview.rows.map(row => row.id === 'row-a-0' ? { ...row, selected: false } : row) };
    const skipped = prepare(data, unselected, { 'row-a-0': { signature, resolution: 'skip' } }, 'skip');
    if (skipped.status !== 'ready') throw new Error('Fixture import failed');
    // The row is now a bank fact the app knows. Reading the file again must not offer "Pulihkan data bank" without the hint.
    const again = inspectSourcedImport(skipped.data, wallet('a'), statement());
    expect(again.sourceReviews['row-a-0']).toMatchObject({ status: 'known-excluded', allowedResolutions: ['keep', 'distinct'] });
    expect(again.sourceReviews['row-a-0'].message).toContain('Ada 1 kandidat catatan manual dengan nominal yang sama pada tanggal yang sama atau berdekatan.');
    // Four days away it is not a candidate, and the usual choices return.
    const far = withManual(expense('manual', '2026-10-17'));
    const stored = prepare(far, unselected, { 'row-a-0': { signature: inspectSourcedImport(far, wallet('a'), unselected).overlaps['row-a-0']?.signature ?? '', resolution: 'skip' } }, 'far');
    if (stored.status !== 'ready') throw new Error('Fixture import failed');
    expect(inspectSourcedImport(stored.data, wallet('a'), statement()).sourceReviews['row-a-0'].allowedResolutions).toEqual(['keep', 'restore']);
  });

  it('does not let statement completion add a bank row beside a manual record a day away', () => {
    // First import into an empty wallet with the file's opening balance, the 20.00 row left unticked:
    // its bank fact is stored, its record is not. A manual 20.00 is then typed in for the next day.
    const preview = statement(), unticked = { ...preview, rows: preview.rows.map(row => row.id === 'row-a-0' ? { ...row, selected: false } : row) };
    const stored = prepareSourcedImport(empty(), wallet('a'), unticked, {}, true, 'unticked', at);
    if (stored.status !== 'ready') throw new Error(`Fixture import failed: ${stored.status}`);
    const statementId = stored.data.metadata!.statements[0].id;
    const decision = { reason: 'Lengkapi sintetis', at };
    const near = applySourcedEntryEdit(stored.data, expense('manual', '2026-10-22'), [], { reason: '', at });
    expect(() => prepareStatementCompletion(near, statementId, decision))
      .toThrow('Ada kandidat catatan manual dengan nominal sumber yang sama pada tanggal yang sama atau berdekatan');
    // With the manual record four days away the completion goes through and both are kept.
    const far = applySourcedEntryEdit(stored.data, expense('manual', '2026-10-25'), [], { reason: '', at });
    const completed = prepareStatementCompletion(far, statementId, decision);
    expect(completed.state.entries.filter(entry => Math.abs(entry.amount) === 2_000)).toHaveLength(2);
    // Without any manual record it goes through as before.
    expect(prepareStatementCompletion(stored.data, statementId, decision).state.entries.filter(entry => Math.abs(entry.amount) === 2_000)).toHaveLength(1);
  });

  it('does not offer a different amount, however close the date', () => {
    const data = withManual(expense('manual', '2026-10-21', 2_001));
    expect(inspectSourcedImport(data, wallet('a'), statement()).overlaps).toEqual({});
    expect(prepare(data, statement(), {}, 'amount').status).toBe('ready');
  });
});
