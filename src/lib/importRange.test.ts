import { describe, expect, it } from 'vitest';
import { validateImportRange } from './importRange';
import type { Entry, State, Wallet } from './finance';
import type { ImportPreview, ImportRow } from './importer';

const wallet: Wallet = { id: 'ziraat', name: 'Ziraat', currency: 'TRY', kind: 'bank', openingBalance: 1_000 };
const otherWallet: Wallet = { ...wallet, id: 'other', name: 'Other' };
const movement = (overrides: Partial<Entry> = {}): Entry => ({
  id: 'known-b', date: '2026-10-01', type: 'unreviewed', walletId: wallet.id,
  amount: -20, category: '', note: '', sourceKey: 'key-b', ...overrides,
});
const state = (entries: Entry[] = [movement()]): State => ({ version: 1, wallets: [wallet, otherWallet], entries });

const row = (id: string, date: string, amount: number, balance: number, duplicate = false): ImportRow => ({
  id, sourceKey: `key-${id}`, date, amount, balance, description: 'Synthetic movement', reference: id,
  classification: 'unreviewed', category: 'Belum dikategorikan', duplicate, selected: !duplicate,
});
const a = () => row('a', '2026-10-01', 100, 1_000);
const b = () => row('b', '2026-10-01', -20, 980, true);
const c = () => row('c', '2026-10-01', 30, 1_010);
const d = () => row('d', '2026-10-02', -10, 1_000);
const preview = (rows: ImportRow[]): ImportPreview => ({
  rows, currency: 'TRY', openingBalance: 900, closingBalance: 1_000,
  period: { start: '2026-10-01', end: '2026-10-02' }, warnings: [],
});

describe('import range protects the existing opening balance', () => {
  it('allows the first import into a wallet without activity', () => {
    expect(validateImportRange(state([]), wallet.id, preview([d(), c(), b(), a()]))).toBeNull();
  });

  it('ignores activity in unrelated wallets', () => {
    expect(validateImportRange(state([movement({ walletId: otherWallet.id })]), wallet.id, preview([a(), b()]))).toBeNull();
  });

  it('allows exact reimports when all rows are duplicates', () => {
    const duplicate = { ...a(), duplicate: true, selected: true };
    expect(validateImportRange(state(), wallet.id, preview([duplicate, b()]))).toBeNull();
  });

  it('blocks an earlier date regardless of whether activity was imported or manual', () => {
    const previous = row('previous', '2026-09-30', 100, 900);
    expect(validateImportRange(state(), wallet.id, preview([previous, b()]))).toMatch(/saldo dua kali/);
    expect(validateImportRange(state([movement({ sourceKey: undefined })]), wallet.id, preview([previous]))).toMatch(/dompet kosong/);
  });

  it('allows a strictly newer period even without an overlapping anchor', () => {
    expect(validateImportRange(state(), wallet.id, preview([d()]))).toBeNull();
  });

  it('allows same-day manual activity when no imported baseline anchor exists', () => {
    expect(validateImportRange(state([movement({ sourceKey: undefined })]), wallet.id, preview([c()]))).toBeNull();
  });

  it('blocks a new same-day movement before the anchor in an oldest-first export', () => {
    expect(validateImportRange(state(), wallet.id, preview([a(), b(), c(), d()]))).toMatch(/sebelum batas awal/);
  });

  it('blocks a new same-day movement before the anchor in a newest-first export', () => {
    expect(validateImportRange(state(), wallet.id, preview([d(), c(), b(), a()]))).toMatch(/sebelum batas awal/);
  });

  it('allows overlapping history after the anchor in either source order', () => {
    const oldest = [b(), c(), d()];
    expect(validateImportRange(state(), wallet.id, preview(oldest))).toBeNull();
    expect(validateImportRange(state(), wallet.id, preview([...oldest].reverse()))).toBeNull();
  });

  it('does not block an unselected earlier row that will not be imported', () => {
    const earlier = { ...a(), selected: false };
    expect(validateImportRange(state(), wallet.id, preview([earlier, b(), c(), d()]))).toBeNull();
  });

  it('blocks ambiguous same-day overlap when the original anchor is absent', () => {
    expect(validateImportRange(state(), wallet.id, preview([c()]))).toMatch(/ekspor bertumpang tindih/);
  });

  it('finds the original earliest imported anchor using date then stable state-array order', () => {
    // The first same-day imported row is b, even when its ID sorts after c.
    const existing = state([
      movement({ id: 'z-first' }),
      movement({ id: 'a-second', sourceKey: 'key-c', amount: 30 }),
    ]);
    expect(validateImportRange(existing, wallet.id, preview([{ ...b(), selected: true, duplicate: false }, { ...c(), selected: false, duplicate: true }, d()]))).toBeNull();
  });

  it('uses the transfer destination key when imported credit was paired into a transfer', () => {
    const paired = movement({ type: 'transfer', walletId: otherWallet.id,
      toWalletId: wallet.id, amount: 20, toAmount: 20, sourceKey: 'other-source', toSourceKey: 'key-b' });
    expect(validateImportRange(state([paired]), wallet.id, preview([c()]))).toMatch(/ekspor bertumpang tindih/);
    expect(validateImportRange(state([paired]), wallet.id, preview([b(), c(), d()]))).toBeNull();
    expect(validateImportRange(state([paired]), wallet.id, preview([a(), b(), c(), d()]))).toMatch(/sebelum batas awal/);
  });

  it('uses wallet-involving transfer activity for the earliest recorded date', () => {
    const paired = movement({ date: '2026-10-02', type: 'transfer', walletId: otherWallet.id,
      toWalletId: wallet.id, amount: 20, toAmount: 20, sourceKey: undefined });
    expect(validateImportRange(state([paired]), wallet.id, preview([c()]))).toMatch(/sebelum batas awal/);
  });

  it('rejects same-day ordering that balances equally well in both directions', () => {
    const first = row('b', '2026-10-01', 100, 1_000, true);
    const second = row('opposite', '2026-10-01', -100, 900);
    expect(validateImportRange(state(), wallet.id, preview([first, second]))).toMatch(/belum bisa dipastikan/);
  });
});
