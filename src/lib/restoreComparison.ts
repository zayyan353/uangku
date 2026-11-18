/** What a restore would replace: the browser's records set against the chosen file. Reads only. */
import { createPostingDateIndex, entryPostings, formatDate, type Entry } from './finance';
import { reviewDemo } from './demoTransition';
import type { SourceDocument, SourceLink } from './sourceModel';

export interface RestoreComparison {
  /** Whose records were counted: the user's ledger, a sample ledger (sample rows the user never
   * touched are left out), or stored data this version could not read. */
  browser: 'own' | 'demo' | 'unreadable';
  browserCount: number;
  /** Latest known posting date; null when there are no records or none has a known date. */
  browserLatest: string | null;
  fileCount: number;
  fileLatest: string | null;
  /** Counted browser entries that have no counterpart in the file. */
  onlyInBrowser: number;
}

/** Fingerprints of the bank rows behind an entry: its linked facts plus the aliases kept on the entry. */
function bankFingerprints(data: SourceDocument): (entry: Entry) => string[] {
  const facts = new Map<string, string>(), links = new Map<string, SourceLink>();
  for (const fact of data.metadata?.facts ?? []) facts.set(fact.id, fact.fingerprint);
  for (const link of data.metadata?.links ?? []) links.set(link.entryId, link);
  return entry => {
    const found: string[] = [], link = links.get(entry.id);
    for (const fingerprint of [entry.sourceKey, entry.toSourceKey, link?.source && facts.get(link.source), link?.destination && facts.get(link.destination)]) {
      if (fingerprint && !found.includes(fingerprint)) found.push(fingerprint);
    }
    return found;
  };
}

/** Latest posting date the ledger itself asserts. A transfer side whose date is recorded as unknown is not guessed from the entry. */
function latestDate(data: SourceDocument, entries: readonly Entry[]): string | null {
  let index: ReturnType<typeof createPostingDateIndex>;
  try { index = createPostingDateIndex(data.metadata); } catch { return null; }
  let latest: string | null = null;
  for (const entry of entries) for (const posting of entryPostings(entry, index)) if (posting.date !== null && (latest === null || posting.date > latest)) latest = posting.date;
  return latest;
}

/**
 * An entry counts as present in the file when the file has the same entry id, or, for a bank row,
 * when the file still has unmatched entries carrying all of its bank fingerprints. Import ids embed
 * a UUID per import, so the same statement imported on two devices differs by id but not by fingerprint.
 * A file entry whose id the browser also has still offers the fingerprints its browser twin does not
 * carry: a transfer paired in the file and split again in the browser keeps one id for two bank rows.
 * Only presence is compared: an entry edited after the file was made still counts as present.
 * Pass null for the browser when its stored data could not be read. One pass over each side.
 */
export function compareRestore(browser: SourceDocument | null, file: SourceDocument): RestoreComparison {
  const fileSide = { fileCount: file.state.entries.length, fileLatest: latestDate(file, file.state.entries) };
  if (!browser) return { browser: 'unreadable', browserCount: 0, browserLatest: null, onlyInBrowser: 0, ...fileSide };
  const untouchedSamples = browser.demo ? new Set(reviewDemo(browser).samples.filter(row => !row.selected).map(row => row.entry.id)) : null;
  const counted = untouchedSamples ? browser.state.entries.filter(entry => !untouchedSamples.has(entry.id)) : browser.state.entries;
  const browserById = new Map(counted.map(entry => [entry.id, entry]));
  const browserFingerprints = bankFingerprints(browser);
  const fileIds = new Set<string>();
  // Each fingerprint in the file can stand for one browser entry, so a row the browser holds twice is not hidden.
  const unmatched = new Map<string, number>();
  const fileFingerprints = bankFingerprints(file);
  for (const entry of file.state.entries) {
    fileIds.add(entry.id);
    const twin = browserById.get(entry.id), taken = twin ? browserFingerprints(twin) : [];
    for (const fingerprint of fileFingerprints(entry)) if (!taken.includes(fingerprint)) unmatched.set(fingerprint, (unmatched.get(fingerprint) ?? 0) + 1);
  }
  let onlyInBrowser = 0;
  for (const entry of counted) {
    if (fileIds.has(entry.id)) continue;
    const fingerprints = browserFingerprints(entry);
    if (fingerprints.length && fingerprints.every(fingerprint => (unmatched.get(fingerprint) ?? 0) > 0)) {
      for (const fingerprint of fingerprints) unmatched.set(fingerprint, unmatched.get(fingerprint)! - 1);
    } else onlyInBrowser += 1;
  }
  return { browser: untouchedSamples ? 'demo' : 'own', browserCount: counted.length, browserLatest: latestDate(browser, counted), onlyInBrowser, ...fileSide };
}

/** Whether the dialog should put "Cadangkan dulu" forward: records would be lost, or it cannot be told. */
export function restoreNeedsBackupFirst(comparison: RestoreComparison): boolean {
  return comparison.onlyInBrowser > 0 || comparison.browser === 'unreadable';
}

/**
 * Sentences for the restore dialog. `difference` is empty when there is nothing of the user's to compare.
 * The zero case states only what was checked: presence, not whether a record both sides have was edited.
 */
export function restoreComparisonCopy(comparison: RestoreComparison): { counts: string; difference: string } {
  const { browser, browserCount, browserLatest, fileCount, fileLatest, onlyInBrowser } = comparison;
  const side = (count: number, latest: string | null) => `${count} transaksi, ${latest ? `terbaru ${formatDate(latest)}` : 'tanggal terbaru belum diketahui'}.`;
  const inFile = fileCount ? `Di file: ${side(fileCount, fileLatest)}` : 'Di file tidak ada transaksi.';
  if (browser === 'unreadable') return { counts: inFile, difference: 'Catatan yang tersimpan di browser ini tidak dapat dibaca, jadi tidak bisa dibandingkan dengan file. Cadangkan dulu: sesudah dipulihkan, data yang tersimpan sekarang tidak bisa diambil lagi.' };
  if (!browserCount) return { counts: `${browser === 'demo' ? 'Di browser ini hanya ada data contoh.' : 'Di browser ini belum ada transaksi.'} ${inFile}`, difference: '' };
  if (browser === 'demo') return {
    counts: `Di browser ini: data contoh dan ${browserCount} transaksi buatanmu, ${browserLatest ? `terbaru ${formatDate(browserLatest)}` : 'tanggal terbaru belum diketahui'}. ${inFile}`,
    difference: onlyInBrowser ? `${onlyInBrowser} transaksi buatanmu tidak ada di file.` : 'Tidak ada transaksi buatanmu yang hanya ada di browser ini. Perubahan pada transaksi yang sama tidak dibandingkan.',
  };
  return {
    counts: `Di browser ini: ${side(browserCount, browserLatest)} ${inFile}`,
    difference: onlyInBrowser ? `${onlyInBrowser} catatan di browser ini tidak ada di file.` : 'Tidak ada catatan yang hanya ada di browser ini. Perubahan pada catatan yang sama tidak dibandingkan.',
  };
}
