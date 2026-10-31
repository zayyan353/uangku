import { validateEntry, validateWallet, walletBalance, type Entry, type State, type Wallet } from './finance';
import { entriesFromImport, type ImportPreview, type ImportRow } from './importer';
import { validateImportRange } from './importRange';

export interface ImportDecision {
  /** Exact row/candidate facts that were shown when the user made this choice. */
  signature: string;
  resolution: 'skip' | 'distinct';
}
export type ImportDecisions = Record<string, ImportDecision | undefined>;

export interface ManualOverlap {
  signature: string;
  /** Copies for display only; matching values are hints, not proof of a duplicate. */
  candidates: Entry[];
}

export interface ImportInspection {
  rows: ImportRow[];
  overlaps: Record<string, ManualOverlap>;
  needsReview: boolean;
  changedFingerprintIds: string[];
  error: string | null;
}

export type ImportPreparation =
  | { status: 'ready'; state: State; entries: Entry[]; inspection: ImportInspection }
  | { status: 'review'; inspection: ImportInspection }
  | { status: 'invalid'; inspection: ImportInspection; message: string };

const duplicateWarning = 'Sudah ada atau identik dengan baris lain. Tidak dipilih.';

function movementKey(date: string, amount: number): string {
  return `${date}:${amount}`;
}

/** Only the target wallet's posting determines whether a transfer leg was imported. */
function manualMovements(state: State, walletId: string): Map<string, Entry[]> {
  const index = new Map<string, Entry[]>();
  const add = (entry: Entry, amount: number) => {
    const key = movementKey(entry.date, amount);
    const candidates = index.get(key) ?? [];
    candidates.push(entry);
    index.set(key, candidates);
  };
  for (const entry of state.entries) {
    if (entry.walletId === walletId && !entry.sourceKey) {
      const amount = entry.type === 'income' || entry.type === 'adjustment' || entry.type === 'unreviewed' || entry.type === 'movement'
        ? entry.amount : -entry.amount - (entry.fee ?? 0);
      add(entry, amount);
    }
    if (entry.type === 'transfer' && entry.toWalletId === walletId && !entry.toSourceKey) {
      add(entry, entry.toAmount ?? 0);
    }
  }
  return index;
}

/** Explicit field order makes signatures independent of JSON property insertion order. */
function decisionSignature(row: ImportRow, candidates: Entry[]): string {
  return JSON.stringify([
    [row.id, row.sourceKey, row.date, row.amount, row.balance, row.description, row.reference],
    [...candidates].sort((a, b) => a.id.localeCompare(b.id)).map(entry => [
      entry.id, entry.date, entry.type, entry.walletId, entry.amount, entry.category, entry.note,
      entry.toWalletId ?? null, entry.toAmount ?? null, entry.rate ?? null, entry.fee ?? null,
      entry.sourceKey ?? null, entry.toSourceKey ?? null, entry.importBatch ?? null,
    ]),
  ]);
}

/**
 * Recheck a preview against the exact ledger supplied by the coordinated caller.
 * This function neither mutates the ledger nor infers that a manual match is a
 * duplicate. Only affected selected rows require a current explicit decision.
 */
export function inspectImport(
  state: State, walletSnapshot: Wallet, preview: ImportPreview, decisions: ImportDecisions = {},
): ImportInspection {
  const wallet = state.wallets.find(item => item.id === walletSnapshot.id);
  let error: string | null = null;
  if (state.version !== 1) error = 'Versi catatan berubah. Muat ulang data sebelum mengimpor.';
  else if (!wallet || wallet.currency !== walletSnapshot.currency || wallet.currency !== preview.currency) {
    error = 'Dompet tujuan atau mata uang berubah. Baca ulang file untuk dompet yang dipilih.';
  } else if (wallet.openingBalance !== walletSnapshot.openingBalance) {
    error = 'Saldo awal dompet berubah sejak file dibaca. Baca ulang file dan periksa kembali pilihan impor.';
  } else if (new Set(preview.rows.map(row => row.id)).size !== preview.rows.length) {
    error = 'Identitas baris pratinjau berulang. Baca ulang file sebelum menyimpan.';
  }
  const knownKeys = new Set(state.entries.flatMap(entry => [entry.sourceKey, entry.toSourceKey]).filter(Boolean));
  const seen = new Set<string>();
  const manual = manualMovements(state, walletSnapshot.id);
  const overlaps: Record<string, ManualOverlap> = {};
  const changedFingerprintIds: string[] = [];
  let needsReview = false;
  const rows = preview.rows.map(original => {
    const duplicate = knownKeys.has(original.sourceKey) || seen.has(original.sourceKey);
    seen.add(original.sourceKey);
    if (duplicate && !original.duplicate && original.selected) {
      changedFingerprintIds.push(original.id);
      needsReview = true;
    }
    const row: ImportRow = {
      ...original, duplicate, selected: original.selected && !duplicate,
      warning: duplicate ? duplicateWarning : original.warning === duplicateWarning ? undefined : original.warning,
    };
    if (duplicate) return row;
    const candidates = manual.get(movementKey(row.date, row.amount)) ?? [];
    const decision = decisions[row.id];
    if (!candidates.length && !decision) return row;
    const signature = decisionSignature(row, candidates);
    overlaps[row.id] = { signature, candidates: candidates.map(entry => ({ ...entry })) };
    // Selection remains the user's current choice. A prior 'distinct' decision
    // does not reselect a row the user subsequently unchecked, nor vice versa.
    const validDecision = decision?.signature === signature
      && (row.selected ? decision.resolution === 'distinct' : decision.resolution === 'skip');
    if (row.selected && !validDecision) needsReview = true;
    return row;
  });
  return { rows, overlaps, needsReview, changedFingerprintIds, error };
}

/**
 * Build all-or-nothing import state. Invoke again inside the writer's exclusive
 * critical section immediately before committing; do not hold the lock for UI.
 */
export function prepareImport(
  state: State, walletSnapshot: Wallet, preview: ImportPreview, decisions: ImportDecisions,
  useOpening: boolean, batchId: string,
): ImportPreparation {
  const inspection = inspectImport(state, walletSnapshot, preview, decisions);
  if (inspection.error) return { status: 'invalid', inspection, message: inspection.error };
  if (inspection.needsReview) return { status: 'review', inspection };
  const rangeProblem = validateImportRange(state, walletSnapshot.id, { ...preview, rows: inspection.rows });
  if (rangeProblem) return { status: 'invalid', inspection, message: rangeProblem };
  try {
    const entries = entriesFromImport(inspection.rows, walletSnapshot.id, batchId);
    if (!entries.length) return { status: 'invalid', inspection, message: 'Pilih setidaknya satu transaksi yang belum diimpor.' };
    const existingActivity = state.entries.some(entry => entry.walletId === walletSnapshot.id || entry.toWalletId === walletSnapshot.id);
    const next: State = {
      version: 1,
      wallets: state.wallets.map(wallet => ({
        ...wallet,
        openingBalance: wallet.id === walletSnapshot.id && useOpening && !existingActivity
          ? preview.openingBalance : wallet.openingBalance,
      })),
      entries: state.entries.map(entry => ({ ...entry })),
    };
    for (const wallet of next.wallets) {
      const problem = validateWallet(wallet);
      if (problem) throw new Error(problem);
    }
    // Keep the established chronological append order from the existing importer.
    for (const entry of [...entries].reverse()) {
      const problem = validateEntry(next, entry);
      if (problem) throw new Error(problem);
      next.entries.push(entry);
    }
    next.wallets.forEach(wallet => walletBalance(next, wallet.id));
    return { status: 'ready', state: next, entries, inspection };
  } catch (reason) {
    return { status: 'invalid', inspection, message: reason instanceof Error ? reason.message : 'Impor belum bisa disimpan.' };
  }
}
