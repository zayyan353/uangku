/**
 * How far each wallet's records reach: the date of its latest record, and the end of its latest
 * stored bank statement. Only dates that are stored are read; nothing is estimated.
 */
import { previousMonth } from './historyView';
import type { SourceDocument } from './sourceModel';
import { createPostingDateIndex, entryPostings } from './transferPostings';

export interface WalletFreshness {
  /** Includes records with a future or unknown posting date. */
  hasRecords: boolean;
  /** Latest date, up to `today`, on which a record is posted to the wallet; null when it has none with a known date. */
  lastRecordOn: string | null;
  /** End of the latest bank statement period stored for the wallet; null when none is stored. */
  statementThrough: string | null;
}

/**
 * One row per wallet of the document, in the document's order.
 *
 * A record dated after `today` has not happened yet and is not the latest record. A transfer counts
 * on each wallet at that side's own date; a side whose date is recorded as unknown is skipped. A
 * transfer from before per-side dates has one stored date, used for both wallets as the balances do.
 */
export function walletFreshness(data: SourceDocument, today: string): Map<string, WalletFreshness> {
  const result = new Map<string, WalletFreshness>(
    data.state.wallets.map(wallet => [wallet.id, { hasRecords: false, lastRecordOn: null, statementThrough: null }]),
  );
  const index = createPostingDateIndex(data.metadata);
  for (const entry of data.state.entries) {
    for (const posting of entryPostings(entry, index)) {
      const row = result.get(posting.walletId);
      if (!row) continue;
      row.hasRecords = true;
      if (posting.date === null || posting.date > today) continue;
      if (row.lastRecordOn === null || posting.date > row.lastRecordOn) row.lastRecordOn = posting.date;
    }
  }
  // The stored period end is independent of the date of the latest posting.
  for (const [walletId, through] of statementReach(data)) {
    const row = result.get(walletId);
    if (row) row.statementThrough = through;
  }
  return result;
}

/** Per wallet that has a stored bank statement: the end of its latest period. Reads the statements only. */
export function statementReach(data: SourceDocument): Map<string, string> {
  const reach = new Map<string, string>();
  for (const statement of data.metadata?.statements ?? []) {
    const known = reach.get(statement.walletId);
    if (known === undefined || statement.periodEnd > known) reach.set(statement.walletId, statement.periodEnd);
  }
  return reach;
}

/**
 * Wallets whose stored statements end before last month began, oldest first: at least one whole month of
 * bank rows has not been imported. A wallet without any stored statement is not in the list, because
 * nothing says it is kept from statements at all.
 */
export function staleStatements(data: SourceDocument, today: string): Array<{ walletId: string; statementThrough: string }> {
  const lastMonth = previousMonth(today.slice(0, 7));
  if (!lastMonth) return [];
  const known = new Set(data.state.wallets.map(wallet => wallet.id));
  return [...statementReach(data)].filter(([walletId, through]) => known.has(walletId) && through < `${lastMonth}-01`)
    .map(([walletId, statementThrough]) => ({ walletId, statementThrough }))
    .sort((a, b) => a.statementThrough.localeCompare(b.statementThrough) || a.walletId.localeCompare(b.walletId));
}
