/**
 * How far each wallet's records reach: the date of its latest record, and the end of its latest
 * stored bank statement. Only dates that are stored are read; nothing is estimated.
 */
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
  // A statement describes a stored period. Its end is independent of the date of its latest posting.
  for (const statement of data.metadata?.statements ?? []) {
    const row = result.get(statement.walletId);
    if (row && (row.statementThrough === null || statement.periodEnd > row.statementThrough)) {
      row.statementThrough = statement.periodEnd;
    }
  }
  return result;
}
