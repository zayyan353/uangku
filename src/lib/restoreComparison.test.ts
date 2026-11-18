import { describe, expect, it } from 'vitest';
import { compareRestore, restoreComparisonCopy, restoreNeedsBackupFirst, type RestoreComparison } from './restoreComparison';
import { parseRestoreFile, serializeFullBackup } from './fullBackup';
import { UNCATEGORIZED, type CategorySettings } from './categorySettings';
import { deleteSourcedEntry, prepareSourcedImport } from './sourceCommands';
import { executeTransferCommand } from './transferCommands';
import { makeDemoData, serializeBackup, type StoredData } from './storage';
import { SOURCE_POLICY } from './sourceModel';
import { formatDate, type Entry, type Wallet } from './finance';
import type { ImportPreview, ImportRow } from './importer';

const at = '2026-10-31T10:00:00.000Z';
const wallets: Wallet[] = [
  { id: 'a', name: 'Synthetic bank A', kind: 'bank', currency: 'TRY', openingBalance: 0 },
  { id: 'b', name: 'Synthetic bank B', kind: 'bank', currency: 'TRY', openingBalance: 0 },
];
const settings: CategorySettings = { version: 1, keywordPackVersion: 5, names: [UNCATEGORIZED], rules: [] };
const fingerprint = (index: number) => `ziraat:${index.toString(16).padStart(16, '0')}`;

function ledger(entries: Entry[] = []): StoredData {
  return { app: 'uangku', version: 1, demo: false, state: { version: 1, wallets: structuredClone(wallets), entries } };
}
function manual(id: string, date: string, amount = 1_000): Entry {
  return { id, date, type: 'expense', walletId: 'a', amount, category: UNCATEGORIZED, note: `Synthetic ${id}` };
}
/** A statement as the importer hands it over; row n carries fingerprint `first + n`. */
function statement(amounts: number[], opening: number, first: number, start = '2026-10-01'): ImportPreview {
  let running = opening;
  const rows: ImportRow[] = amounts.map((amount, index) => ({
    id: `r${first + index}`, date: `${start.slice(0, 8)}${String(Number(start.slice(8)) + index).padStart(2, '0')}`, amount, balance: running += amount,
    description: `Synthetic row ${first + index}`, reference: `REF${first + index}`, sourceKey: fingerprint(first + index),
    classification: 'unreviewed', category: UNCATEGORIZED, selected: true, duplicate: false,
  }));
  return { currency: 'TRY', openingBalance: opening, closingBalance: running, rows, period: { start: rows[0].date, end: rows.at(-1)!.date }, warnings: [] };
}
/** The real import command; the batch id is what differs between two devices. */
function imported(data: StoredData, walletId: string, preview: ImportPreview, batch: string, selected = preview.rows.map((_, index) => index)): StoredData {
  const chosen = { ...preview, rows: preview.rows.map((row, index) => ({ ...row, selected: selected.includes(index) })) };
  const result = prepareSourcedImport(data, data.state.wallets.find(wallet => wallet.id === walletId)!, chosen, {}, true, batch, at);
  if (result.status !== 'ready') throw new Error(result.status === 'invalid' ? result.message : 'Unexpected review');
  return result.data;
}
const rows = () => statement([10_000, -2_000, -550], 10_000, 1);
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}

describe('MW-93 restore comparison', () => {
  it('reports the reviewed case: ten against ten, one record only in the browser', () => {
    const browser = ledger(Array.from({ length: 10 }, (_, index) => manual(`m${index + 1}`, `2026-10-${String(index + 1).padStart(2, '0')}`)));
    const file = ledger([...browser.state.entries.slice(0, 9), manual('other-device', '2026-10-20')]);
    expect(compareRestore(browser, file)).toEqual({
      browser: 'own', browserCount: 10, browserLatest: '2026-10-10', fileCount: 10, fileLatest: '2026-10-20', onlyInBrowser: 1,
    });
    expect(compareRestore(browser, browser).onlyInBrowser).toBe(0);
    expect(compareRestore(ledger(), file)).toEqual({ browser: 'own', browserCount: 0, browserLatest: null, fileCount: 10, fileLatest: '2026-10-20', onlyInBrowser: 0 });
    expect(compareRestore(browser, ledger())).toMatchObject({ fileCount: 0, fileLatest: null, onlyInBrowser: 10 });
  });

  it('compares manual records by id only, so an edit to a record both sides have is not counted', () => {
    const browser = ledger([manual('m1', '2026-10-05', 9_999)]);
    expect(compareRestore(browser, ledger([manual('m1', '2026-10-01', 1_000)])).onlyInBrowser).toBe(0);
    expect(compareRestore(browser, ledger([manual('m2', '2026-10-05', 9_999)])).onlyInBrowser).toBe(1);
  });

  it('matches bank rows by fingerprint when the same statement was imported separately on two devices', () => {
    const here = imported(ledger(), 'a', rows(), 'device-a'), there = imported(ledger(), 'a', rows(), 'device-b');
    const ids = new Set(there.state.entries.map(entry => entry.id));
    expect(here.state.entries.some(entry => ids.has(entry.id))).toBe(false); // Comparing ids alone would report all three.
    expect(compareRestore(here, there)).toMatchObject({ browserCount: 3, fileCount: 3, onlyInBrowser: 0 });
    // Both file kinds reach the dialog through the same parser, including the packed metadata format.
    const fromLedgerFile = parseRestoreFile(serializeBackup(there)), fromFullFile = parseRestoreFile(serializeFullBackup(there, settings));
    expect([fromLedgerFile.kind, fromFullFile.kind]).toEqual(['ledger', 'full']);
    expect(compareRestore(here, fromLedgerFile.ledger)).toEqual(compareRestore(here, there));
    expect(compareRestore(here, fromFullFile.ledger)).toEqual(compareRestore(here, there));
    // A manual record next to the bank rows is still found by id.
    const withManual: StoredData = { ...here, state: { ...here.state, entries: [...here.state.entries, manual('only-here', '2026-10-09')] } };
    expect(compareRestore(withManual, there)).toMatchObject({ browserCount: 4, browserLatest: '2026-10-09', onlyInBrowser: 1 });
  });

  it('reads the fingerprint from the linked bank row when the entry carries no alias, and from the alias when there is no metadata', () => {
    const here = imported(ledger(), 'a', rows(), 'device-a'), there = imported(ledger(), 'a', rows(), 'device-b');
    const withoutAlias = (data: StoredData): StoredData => ({ ...data, state: { ...data.state, entries: data.state.entries.map(({ sourceKey: _alias, ...entry }) => entry) } });
    expect(compareRestore(withoutAlias(here), there).onlyInBrowser).toBe(0);
    expect(compareRestore(here, withoutAlias(there)).onlyInBrowser).toBe(0);
    const legacy = (prefix: string, keys: number[]) => ledger(keys.map(key => ({ ...manual(`${prefix}-${key}`, '2026-10-01'), sourceKey: fingerprint(key) })));
    expect(compareRestore(legacy('old', [1, 2, 3]), legacy('new', [1, 2, 3])).onlyInBrowser).toBe(0);
    expect(compareRestore(legacy('old', [1, 2, 3]), legacy('new', [1, 2, 4])).onlyInBrowser).toBe(1);
    expect(compareRestore(legacy('old', [1, 2, 3]), there).onlyInBrowser).toBe(0);
  });

  it('counts a bank row whose record the file does not have, even when the file kept the bank data', () => {
    const here = imported(ledger(), 'a', rows(), 'device-a');
    const partial = imported(ledger(), 'a', rows(), 'device-b', [0, 1]);
    expect(partial.metadata!.facts).toHaveLength(3);
    expect(compareRestore(here, partial)).toMatchObject({ browserCount: 3, fileCount: 2, onlyInBrowser: 1 });
    const there = imported(ledger(), 'a', rows(), 'device-b');
    const removed = deleteSourcedEntry(there, there.state.entries[0].id, { reason: 'Synthetic removal', at });
    expect(removed.metadata!.facts).toHaveLength(3);
    expect(compareRestore(here, removed).onlyInBrowser).toBe(1);
  });

  it('treats a paired transfer and its two separate bank rows as the same records', () => {
    const twoRows = (batch: string) => imported(imported(ledger(), 'a', statement([-10_000], 50_000, 1, '2026-10-30'), `${batch}-debit`), 'b', statement([10_000], 0, 2, '2026-10-30'), `${batch}-credit`);
    const pair = (data: StoredData) => executeTransferCommand(data, {
      kind: 'pair', debitId: data.state.entries.find(entry => entry.walletId === 'a')!.id, creditId: data.state.entries.find(entry => entry.walletId === 'b')!.id, fee: 0, reason: 'Synthetic pair', at,
    });
    const separate = twoRows('device-b'), paired = pair(twoRows('device-a'));
    expect(paired.state.entries).toHaveLength(1);
    expect(compareRestore(paired, separate)).toMatchObject({ browserCount: 1, fileCount: 2, onlyInBrowser: 0 });
    expect(compareRestore(separate, paired)).toMatchObject({ browserCount: 2, fileCount: 1, onlyInBrowser: 0 });
    const debitOnly = imported(ledger(), 'a', statement([-10_000], 50_000, 1, '2026-10-30'), 'device-c');
    expect(compareRestore(paired, debitOnly).onlyInBrowser).toBe(1);
  });

  it('matches both bank rows when one device paired a transfer and later split it again', () => {
    // The pair keeps the debit row's id, so the file's transfer shares an id with one browser row and
    // carries the fingerprint of the other; an id match must not hide that second fingerprint.
    const separate = imported(imported(ledger(), 'a', statement([-10_000], 50_000, 1, '2026-10-30'), 'same-debit'), 'b', statement([10_000], 0, 2, '2026-10-30'), 'same-credit');
    const debitId = separate.state.entries.find(entry => entry.walletId === 'a')!.id, creditId = separate.state.entries.find(entry => entry.walletId === 'b')!.id;
    const paired = executeTransferCommand(separate, { kind: 'pair', debitId, creditId, fee: 0, reason: 'Synthetic pair', at });
    expect(paired.state.entries.map(entry => entry.id)).toEqual([debitId]);
    const split = executeTransferCommand(paired, { kind: 'unpair', entryId: debitId, reason: 'Synthetic split', at });
    expect(split.state.entries.map(entry => entry.id).sort()).toEqual([debitId, creditId].sort());
    expect(compareRestore(split, paired)).toMatchObject({ browserCount: 2, fileCount: 1, onlyInBrowser: 0 });
    expect(compareRestore(paired, split)).toMatchObject({ browserCount: 1, fileCount: 2, onlyInBrowser: 0 });
    expect(compareRestore(separate, paired).onlyInBrowser).toBe(0);
  });

  it('takes the latest date from known posting dates and does not guess a transfer side recorded as unknown', () => {
    const transfer: Entry = { id: 't1', date: '2026-10-20', type: 'transfer', walletId: 'a', amount: 5_000, category: '', note: 'Synthetic transfer', toWalletId: 'b', toAmount: 5_000 };
    const withDates = (sourceDate: string | null, destinationDate: string | null): StoredData => ({
      ...ledger([manual('m1', '2026-10-05'), transfer]), metadata: { policy: SOURCE_POLICY, facts: [], links: [], statements: [], transfers: [{ entryId: 't1', sourceDate, destinationDate }] },
    });
    // No dates recorded for the transfer: the app's own v1 meaning applies, the entry date.
    expect(compareRestore(ledger([manual('m1', '2026-10-05'), transfer]), ledger()).browserLatest).toBe('2026-10-20');
    // Debited 30 Sep, credited 2 Nov: the later side counts.
    expect(compareRestore(withDates('2026-09-30', '2026-11-02'), ledger()).browserLatest).toBe('2026-11-02');
    // Both sides unknown: the retained entry date is not presented as a known date.
    expect(compareRestore(withDates(null, null), ledger()).browserLatest).toBe('2026-10-05');
    const onlyUnknown: StoredData = { ...withDates(null, null), state: { ...ledger([transfer]).state } };
    expect(compareRestore(onlyUnknown, onlyUnknown)).toMatchObject({ browserCount: 1, browserLatest: null, fileCount: 1, fileLatest: null, onlyInBrowser: 0 });
  });

  it('lets one bank row in the file stand for one record only, and trusts a shared id before fingerprints', () => {
    const twice = ledger([{ ...manual('x1', '2026-10-01'), sourceKey: fingerprint(1) }, { ...manual('x2', '2026-10-01'), sourceKey: fingerprint(1) }]);
    expect(compareRestore(twice, ledger([{ ...manual('y1', '2026-10-01'), sourceKey: fingerprint(1) }])).onlyInBrowser).toBe(1);
    expect(compareRestore(twice, ledger([{ ...manual('y1', '2026-10-01'), sourceKey: fingerprint(1) }, { ...manual('y2', '2026-10-01'), sourceKey: fingerprint(1) }])).onlyInBrowser).toBe(0);
    // The file's copy of x1 is used by x1 itself, so it cannot also stand for x2.
    expect(compareRestore(twice, ledger([{ ...manual('x1', '2026-10-01'), sourceKey: fingerprint(1) }])).onlyInBrowser).toBe(1);
    // A hand-typed record that was later tied to a bank row keeps its id.
    expect(compareRestore(ledger([{ ...manual('m1', '2026-10-01'), sourceKey: fingerprint(7) }]), ledger([manual('m1', '2026-10-01')])).onlyInBrowser).toBe(0);
  });

  it('leaves untouched sample rows out of a demo ledger and counts what the user added or changed', () => {
    const file = ledger([manual('m1', '2026-10-01')]);
    const sample = makeDemoData();
    expect(sample.state.entries.length).toBeGreaterThan(0);
    expect(compareRestore(sample, file)).toEqual({ browser: 'demo', browserCount: 0, browserLatest: null, fileCount: 1, fileLatest: '2026-10-01', onlyInBrowser: 0 });
    const added: StoredData = { ...sample, state: { ...sample.state, entries: [...sample.state.entries, { ...manual('typed-in-demo', '2026-10-02'), walletId: sample.state.wallets[0].id }] } };
    expect(compareRestore(added, file)).toMatchObject({ browser: 'demo', browserCount: 1, browserLatest: '2026-10-02', onlyInBrowser: 1 });
    expect(compareRestore(added, added)).toMatchObject({ browser: 'demo', browserCount: 1, fileCount: added.state.entries.length, onlyInBrowser: 0 });
    const first = sample.state.entries[0];
    const changed: StoredData = { ...sample, state: { ...sample.state, entries: [{ ...first, note: 'Diubah pengguna' }, ...sample.state.entries.slice(1)] } };
    expect(compareRestore(changed, file)).toMatchObject({ browser: 'demo', browserCount: 1, browserLatest: first.date, onlyInBrowser: 1 });
  });

  it('does not compare when the stored data could not be read, and puts the backup forward because the loss is unknown', () => {
    const unreadable = compareRestore(null, ledger([manual('m1', '2026-10-01')]));
    expect(unreadable).toEqual({ browser: 'unreadable', browserCount: 0, browserLatest: null, fileCount: 1, fileLatest: '2026-10-01', onlyInBrowser: 0 });
    expect(restoreNeedsBackupFirst(unreadable)).toBe(true);
    const same = ledger([manual('m1', '2026-10-01')]);
    expect(restoreNeedsBackupFirst(compareRestore(same, same))).toBe(false);
    expect(restoreNeedsBackupFirst(compareRestore(same, ledger()))).toBe(true);
    expect(restoreNeedsBackupFirst(compareRestore(ledger(), same))).toBe(false);
    expect(restoreNeedsBackupFirst(compareRestore(makeDemoData(), same))).toBe(false);
  });

  it('handles a 10,000-row ledger in one pass without touching its frozen inputs', () => {
    const build = (device: string, extra: Entry[]): StoredData => {
      const data = ledger(extra);
      data.metadata = { policy: SOURCE_POLICY, facts: [], links: [], statements: [] };
      for (let index = 0; index < 10_000; index += 1) {
        const date = `2026-${String(index % 9 + 1).padStart(2, '0')}-${String(index % 28 + 1).padStart(2, '0')}`;
        data.state.entries.push({ id: `entry:${fingerprint(index + 1)}:${device}`, date, type: 'unreviewed', walletId: 'a', amount: -1, category: UNCATEGORIZED, note: `Synthetic ${index}`, sourceKey: fingerprint(index + 1), importBatch: device });
        data.metadata.facts.push({ id: `sf:${device}:${index}`, walletId: 'a', currency: 'TRY', postedOn: date, signedAmount: -1, balanceAfter: -index - 1, description: `Synthetic ${index}`, fingerprintVersion: 'ziraat-v1', fingerprint: fingerprint(index + 1) });
        data.metadata.links.push({ entryId: `entry:${fingerprint(index + 1)}:${device}`, source: `sf:${device}:${index}` });
      }
      return deepFreeze(data);
    };
    const browser = build('device-a', [manual('m1', '2026-11-01'), manual('m2', '2026-11-02'), manual('m3', '2026-11-03')]);
    const file = build('device-b', [manual('m1', '2026-11-01')]);
    const before = JSON.stringify([browser, file]);
    expect(compareRestore(browser, file)).toEqual({ browser: 'own', browserCount: 10_003, browserLatest: '2026-11-03', fileCount: 10_001, fileLatest: '2026-11-01', onlyInBrowser: 2 });
    expect(JSON.stringify([browser, file])).toBe(before);
  });
});

describe('MW-93 restore comparison wording', () => {
  const base: RestoreComparison = { browser: 'own', browserCount: 10, browserLatest: '2026-10-31', fileCount: 9, fileLatest: '2026-10-15', onlyInBrowser: 1 };
  const here = formatDate('2026-10-31'), there = formatDate('2026-10-15');

  it('states both sides and what only the browser has', () => {
    expect(restoreComparisonCopy(base)).toEqual({
      counts: `Di browser ini: 10 transaksi, terbaru ${here}. Di file: 9 transaksi, terbaru ${there}.`,
      difference: '1 catatan di browser ini tidak ada di file.',
    });
    // Nothing missing is not the same as nothing lost: edits to a record both sides have are not compared, and the text says so.
    expect(restoreComparisonCopy({ ...base, onlyInBrowser: 0 }).difference).toBe('Tidak ada catatan yang hanya ada di browser ini. Perubahan pada catatan yang sama tidak dibandingkan.');
    expect(restoreComparisonCopy({ ...base, fileCount: 0, fileLatest: null, onlyInBrowser: 10 })).toEqual({
      counts: `Di browser ini: 10 transaksi, terbaru ${here}. Di file tidak ada transaksi.`,
      difference: '10 catatan di browser ini tidak ada di file.',
    });
    expect(restoreComparisonCopy({ ...base, browserLatest: null, fileLatest: null }).counts)
      .toBe('Di browser ini: 10 transaksi, tanggal terbaru belum diketahui. Di file: 9 transaksi, tanggal terbaru belum diketahui.');
  });

  it('says so plainly when the browser has nothing of the user to compare', () => {
    const none = { browserCount: 0, browserLatest: null, onlyInBrowser: 0 };
    expect(restoreComparisonCopy({ ...base, ...none })).toEqual({ counts: `Di browser ini belum ada transaksi. Di file: 9 transaksi, terbaru ${there}.`, difference: '' });
    expect(restoreComparisonCopy({ ...base, ...none, browser: 'demo' })).toEqual({ counts: `Di browser ini hanya ada data contoh. Di file: 9 transaksi, terbaru ${there}.`, difference: '' });
    expect(restoreComparisonCopy({ ...base, ...none, browser: 'unreadable' })).toEqual({
      counts: `Di file: 9 transaksi, terbaru ${there}.`,
      difference: 'Catatan yang tersimpan di browser ini tidak dapat dibaca, jadi tidak bisa dibandingkan dengan file. Cadangkan dulu: sesudah dipulihkan, data yang tersimpan sekarang tidak bisa diambil lagi.',
    });
  });

  it('names the user\'s own records in a demo ledger', () => {
    expect(restoreComparisonCopy({ ...base, browser: 'demo', browserCount: 2, onlyInBrowser: 2 })).toEqual({
      counts: `Di browser ini: data contoh dan 2 transaksi buatanmu, terbaru ${here}. Di file: 9 transaksi, terbaru ${there}.`,
      difference: '2 transaksi buatanmu tidak ada di file.',
    });
    expect(restoreComparisonCopy({ ...base, browser: 'demo', browserCount: 2, onlyInBrowser: 0 }).difference).toBe('Tidak ada transaksi buatanmu yang hanya ada di browser ini. Perubahan pada transaksi yang sama tidak dibandingkan.');
  });
});
