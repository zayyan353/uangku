import { describe, it, expect } from 'vitest';
import { applySourcedEntryEdit, deleteSourcedEntry, saveTransferEntry } from './sourceCommands';
import { validateSourceDocument, type SourceDocument } from './sourceModel';
import { serializeBackup, parseBackupText } from './storage';
import type { Entry, Wallet } from './finance';

const at = '2026-11-18T10:00:00.000Z';
const decision = { reason: '', at };
const wallets: Wallet[] = [
  { id: 'a', name: 'Synthetic A', kind: 'cash', currency: 'IDR', openingBalance: 500_000 },
  { id: 'b', name: 'Synthetic B', kind: 'cash', currency: 'IDR', openingBalance: 0 },
];
const transfer: Entry = { id: 'transfer-1', date: '2026-11-01', type: 'transfer', walletId: 'a', amount: 100_000, category: '', note: 'Synthetic transfer', toWalletId: 'b', toAmount: 100_000 };
const expense: Entry = { id: 'expense-1', date: '2026-11-02', type: 'expense', walletId: 'a', amount: 25_000, category: 'Makan', note: 'Synthetic lunch' };
const adjustment: Entry = { id: 'adjust-1', date: '2026-11-03', type: 'adjustment', walletId: 'a', amount: -5_000, category: 'Penyesuaian', note: 'Cek saldo' };

/** A manual transfer is what first gives a document source metadata. */
function withMetadata(): SourceDocument {
  const empty: SourceDocument = { app: 'uangku', version: 1, demo: false, state: { version: 1, wallets: structuredClone(wallets), entries: [] } };
  const data = saveTransferEntry(empty, transfer, [], { sourceDate: transfer.date, destinationDate: transfer.date, reason: 'Pengguna mencatat atau mencocokkan transfer.', at });
  expect(data.metadata).toBeDefined();
  return data;
}

describe('MW-87 manual entries stay deletable once the document has source metadata', () => {
  it.each([['expense', expense], ['balance-check adjustment', adjustment]] as const)('deletes a manual %s and leaves no row behind', (_label, entry) => {
    const before = withMetadata();
    const added = applySourcedEntryEdit(before, entry, [], decision);
    expect(added.metadata!.creationOrigins).toContainEqual({ entryId: entry.id, origin: 'manual' });
    const snapshot = structuredClone(added);

    const removed = deleteSourcedEntry(added, entry.id, decision);

    expect(added).toEqual(snapshot);
    expect(removed.state.entries).toEqual(before.state.entries);
    expect(removed.metadata).toEqual(before.metadata);
    expect(() => validateSourceDocument(removed, { allowMovement: true })).not.toThrow();
    expect(parseBackupText(serializeBackup(removed))).toEqual(removed);
  });

  it('removes only the deleted entry rows when several manual entries exist', () => {
    const both = applySourcedEntryEdit(applySourcedEntryEdit(withMetadata(), expense, [], decision), adjustment, [], decision);
    const removed = deleteSourcedEntry(both, expense.id, decision);
    expect(removed.state.entries.map(entry => entry.id)).toEqual([transfer.id, adjustment.id]);
    expect(removed.metadata!.creationOrigins!.map(row => row.entryId)).not.toContain(expense.id);
    expect(removed.metadata!.creationOrigins).toContainEqual({ entryId: adjustment.id, origin: 'manual' });
    expect(removed.metadata!.transfers).toEqual(both.metadata!.transfers);
  });
});
