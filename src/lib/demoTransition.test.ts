import { describe, expect, it } from 'vitest';
import { carryDemo, reviewDemo } from './demoTransition';
import { buildDemoState, walletBalance, type Entry, type Wallet } from './finance';
import { parseBackupText, serializeBackup, type StoredData } from './storage';
import { saveTransferEntry } from './sourceCommands';
import { SOURCE_POLICY } from './sourceModel';

const demo = (day = '2026-11-02'): StoredData => ({
  app: 'uangku', version: 1, demo: true, state: buildDemoState(new Date(day + 'T12:00:00Z')),
});
const defaults = (data: StoredData) => new Set(reviewDemo(data).samples.filter(row => row.selected).map(row => row.entry.id));
const roundtrip = (data: StoredData) => parseBackupText(serializeBackup(data));

describe('memindahkan catatan demo ke data sendiri', () => {
  it.each(['2024-02-01', '2024-02-29', '2026-10-12', '2026-11-02'])('recognizes the original seed for %s after reload', date => {
    const data = roundtrip(demo(date));
    expect(defaults(data).size).toBe(0);
    expect(reviewDemo(data).additional).toBe(0);
    const own = carryDemo(data, defaults(data));
    expect(own.state.entries).toEqual([]);
    expect(own.state.wallets.every(wallet => wallet.openingBalance === 0)).toBe(true);
    expect(own.demo).toBe(false);
  });
  it('keeps unknown IDs even with identical notes or a demo-like prefix, and preserves custom opening balances', () => {
    const data = demo();
    const wallet: Wallet = { id: 'custom', name: 'Mijn rekening', currency: 'IDR', kind: 'bank', openingBalance: 800_000 };
    const manual: Entry = { ...data.state.entries[1], id: 'demo-entry-13', walletId: wallet.id, amount: 55_000 };
    data.state.wallets.push(wallet);
    data.state.wallets[0].openingBalance = 40_000;
    data.state.entries.push(manual);
    const previous = serializeBackup(data);
    const own = roundtrip(carryDemo(data, defaults(data)));
    expect(own.state.entries).toEqual([manual]);
    expect(own.state.wallets.find(item => item.id === wallet.id)).toEqual(wallet);
    expect(own.state.wallets[0].openingBalance).toBe(40_000);
    expect(walletBalance(own.state, wallet.id)).toBe(745_000);
    expect(serializeBackup(data)).toBe(previous);
  });
  it('preselects changed dated or annotated samples, allowing individual legacy choices', () => {
    const data = demo();
    const [first, second, third] = data.state.entries;
    first.note = 'Catatan yang saya ubah';
    second.date = '2023-07-12';
    expect(defaults(data)).toEqual(new Set([first.id, second.id]));
    expect(carryDemo(data, new Set([second.id, third.id])).state.entries).toEqual([second, third]);
  });
  it('does not automatically discard contradictory legacy samples when neither matching snapshot wins', () => {
    const data = demo('2026-11-27');
    data.state.entries = [data.state.entries[0], demo('2024-04-23').state.entries[1]];
    expect(defaults(data)).toEqual(new Set(data.state.entries.map(row => row.id)));
  });
  it('carries a manual FX transfer, IDs, separate posting dates, and both wallet currencies', () => {
    const data = demo();
    const entry = { ...data.state.entries[9], id: 'synthetic-transfer' };
    const withTransfer = saveTransferEntry(data, entry, [], {
      sourceDate: entry.date, destinationDate: '2026-11-04', declareDates: true, reason: 'Transfer sendiri', at: '2026-11-02T12:00:00Z',
    });
    const own = roundtrip(carryDemo(withTransfer, defaults(withTransfer)));
    expect(own.state.entries).toEqual([entry]);
    expect(own.metadata).toEqual(withTransfer.metadata);
    expect(walletBalance(own.state, entry.walletId, own.metadata)).toBe(-entry.amount - entry.fee!);
    expect(walletBalance(own.state, entry.toWalletId!, own.metadata)).toBe(entry.toAmount);
  });
  it('keeps source-linked seed IDs even if unchecked by a caller, preserving facts and evidenced opening', () => {
    const data = demo(), entry = data.state.entries[7], wallet = data.state.wallets.find(item => item.id === entry.walletId)!;
    const closing = wallet.openingBalance - entry.amount;
    data.metadata = { policy: SOURCE_POLICY,
      facts: [{ id: 'fact', walletId: wallet.id, currency: wallet.currency, postedOn: entry.date, signedAmount: -entry.amount,
        balanceAfter: closing, description: entry.note, fingerprintVersion: 'ziraat-v1', fingerprint: 'ziraat:0000000000000001' }],
      statements: [{ id: 'statement', walletId: wallet.id, currency: wallet.currency, periodStart: entry.date, periodEnd: entry.date,
        openingBalance: wallet.openingBalance, closingBalance: closing, rowIds: ['fact'] }],
      links: [{ entryId: entry.id, source: 'fact' }],
      baselines: [{ id: 'baseline', walletId: wallet.id, boundary: { kind: 'before-source', date: entry.date, sourceId: 'fact' },
        origin: 'bank', status: 'confirmed' }],
    };
    const original = roundtrip(data);
    expect(reviewDemo(original).samples.find(row => row.entry.id === entry.id)).toMatchObject({ required: true, selected: true });
    const own = roundtrip(carryDemo(original, new Set()));
    expect(own.metadata).toEqual(original.metadata);
    expect(own.state.entries).toEqual([original.state.entries[7]]);
    expect(walletBalance(own.state, wallet.id, own.metadata)).toBe(closing);
  });
  it('rejects personal ledgers', () => expect(() => carryDemo({ ...demo(), demo: false }, new Set())).toThrow('sudah memakai data sendiri'));
});
