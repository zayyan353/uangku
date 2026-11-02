import { buildDemoState, type Entry } from './finance';
import { canonicalSource } from './sourceModel';
import type { StoredData } from './storage';

const template = buildDemoState(new Date('2000-01-31T12:00:00Z'));
const sampleIds = new Set(template.entries.map(entry => entry.id));
const signature = (entry: Entry) => JSON.stringify(canonicalSource(entry));

/** A saved demo can come from any month. Only compare the small set of known
 * seed IDs, using the same date clipping as the generator. On a tie, suggest
 * dropping only rows shared by both matching snapshots. */
function matchingSamples(rows: Entry[]): Set<string> {
  const stored = new Map(rows.map(entry => [entry.id, signature(entry)]));
  let best = -1;
  let matches = new Set<string>();
  for (const date of new Set(rows.map(entry => entry.date))) {
    const seed = buildDemoState(new Date(date + 'T12:00:00Z'));
    const ids = seed.entries.filter(entry => signature(entry) === stored.get(entry.id)).map(entry => entry.id);
    if (ids.length > best) { best = ids.length; matches = new Set(ids); }
    else if (ids.length === best) matches = new Set(ids.filter(id => matches.has(id)));
  }
  return matches;
}

export function reviewDemo(data: StoredData) {
  if (!data.demo) throw new Error('Catatan ini sudah memakai data sendiri.');
  const rows = data.state.entries.filter(entry => sampleIds.has(entry.id));
  const unchanged = matchingSamples(rows);
  const metadata = data.metadata;
  const referenced = new Set([
    ...(metadata?.links ?? []).map(row => row.entryId),
    ...(metadata?.creationOrigins ?? []).map(row => row.entryId),
    ...(metadata?.transfers ?? []).map(row => row.entryId),
    ...(metadata?.unpairings ?? []).flatMap(row => [row.sourceEntryId, row.destinationEntryId]),
  ]);
  const samples = rows.map(entry => {
    const required = referenced.has(entry.id) || !!(entry.sourceKey || entry.toSourceKey || entry.importBatch);
    return { entry, required, selected: required || !unchanged.has(entry.id) };
  });
  return { samples, additional: data.state.entries.length - samples.length };
}

export function carryDemo(data: StoredData, includedSamples: ReadonlySet<string>): StoredData {
  const { samples } = reviewDemo(data);
  const removed = new Set(samples.filter(row => !row.required && !includedSamples.has(row.entry.id)).map(row => row.entry.id));
  const evidencedWallets = new Set([
    ...(data.metadata?.statements ?? []).map(row => row.walletId),
    ...(data.metadata?.baselines ?? []).map(row => row.walletId),
  ]);
  const wallets = data.state.wallets.map(wallet => {
    const seed = template.wallets.find(item => item.id === wallet.id);
    if (seed && seed.currency === wallet.currency && seed.openingBalance === wallet.openingBalance && !evidencedWallets.has(wallet.id)) {
      return { ...wallet, openingBalance: 0 };
    }
    return wallet;
  });
  return { ...data, demo: false, state: { ...data.state, wallets, entries: data.state.entries.filter(entry => !removed.has(entry.id)) } };
}
