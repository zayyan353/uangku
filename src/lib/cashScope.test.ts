import { describe, expect, it } from 'vitest';
import { activeAccountState, isCashLinkedEntry, removableCashWalletIds, removeUnusedCashWallets } from './cashScope';
import { summaryForCurrency, walletBalance, type Entry, type State, type Wallet } from './finance';
import { SOURCE_POLICY, type SourceDocument, type SourceMetadata } from './sourceModel';
import { parseBackupText, serializeBackup } from './storage';

const DATE = '2026-10-01', AT = '2026-10-31T12:00:00.000Z';
const wallet = (id: string, currency: Wallet['currency'], kind: Wallet['kind'], openingBalance = 0): Wallet => ({ id, currency, kind, openingBalance, name: `Synthetic ${id}` });
function empty(): SourceDocument {
  return { app: 'uangku', version: 1, demo: false, state: { version: 1,
    wallets: [wallet('bank-try', 'TRY', 'bank'), wallet('bank-idr', 'IDR', 'bank'), wallet('ewallet-usd', 'USD', 'ewallet'),
      wallet('cash-try', 'TRY', 'cash'), wallet('cash-idr', 'IDR', 'cash'), wallet('cash-usd', 'USD', 'cash')], entries: [] } };
}
const metadata = (): SourceMetadata => ({ policy: SOURCE_POLICY, facts: [], links: [], statements: [] });
const ordinary = (id: string, walletId: string, type: Entry['type'] = 'expense', amount = 100): Entry => ({ id, walletId, type, amount, category: 'Belanja', note: `Synthetic ${id}`, date: DATE });
const transfer = (id: string, from: string, to: string): Entry => ({ ...ordinary(id, from, 'transfer'), category: '', toWalletId: to, toAmount: 100 });

describe('bank-only reporting scope', () => {
  it('excludes cash wallets across all currencies while keeping bank and ewallet accounts', () => {
    const source = empty().state, before = structuredClone(source), scoped = activeAccountState(source);
    expect(scoped.wallets.map(row => row.id)).toEqual(['bank-try', 'bank-idr', 'ewallet-usd']);
    expect(scoped.entries).toEqual([]); expect(source).toEqual(before);
  });

  it('keeps historical transfers crossing the cash boundary but excludes cash-only entries and transfers', () => {
    const data = empty(); data.state.wallets.push(wallet('cash-try-2', 'TRY', 'cash'));
    data.state.entries = [ordinary('bank-expense', 'bank-try'), ordinary('cash-expense', 'cash-try'),
      transfer('bank-to-cash', 'bank-try', 'cash-try'), transfer('cash-to-bank', 'cash-try', 'bank-try'),
      transfer('cash-to-cash', 'cash-try', 'cash-try-2'), ordinary('bank-movement', 'bank-try', 'movement', -50)];
    const before = structuredClone(data.state), scoped = activeAccountState(data.state);
    expect(scoped.entries.map(row => row.id)).toEqual(['bank-expense', 'bank-to-cash', 'cash-to-bank', 'bank-movement']);
    expect(scoped.entries.find(row => row.id === 'bank-to-cash')?.toWalletId).toBe('cash-try');
    expect(scoped.entries.find(row => row.id === 'cash-to-bank')?.walletId).toBe('cash-try');
    expect(data.state).toEqual(before);
  });

  it('reports only bank-side balances and confirmed cashflow while preserving archived cash history', () => {
    const data = empty(); data.state.wallets.find(row => row.id === 'bank-try')!.openingBalance = 1_000;
    data.state.wallets.find(row => row.id === 'cash-try')!.openingBalance = 500;
    const out = { ...transfer('withdrawal-old', 'bank-try', 'cash-try'), amount: 10, toAmount: 10 };
    const incoming = { ...transfer('deposit-old', 'cash-try', 'bank-try'), amount: 15, toAmount: 15 };
    data.state.entries = [ordinary('income', 'bank-try', 'income', 200), ordinary('purchase', 'bank-try', 'expense', 50),
      out, incoming, ordinary('outside', 'bank-try', 'movement', -8), ordinary('cash-income', 'cash-try', 'income', 100), ordinary('cash-expense', 'cash-try', 'expense', 20)];
    const before = structuredClone(data), scoped = activeAccountState(data.state);
    const summary = summaryForCurrency(scoped, 'TRY', '2026-10', '2026-10-31');
    expect(summary.balance).toBe(1_147); expect(summary.income).toBe(200); expect(summary.expense).toBe(50);
    expect(walletBalance(data.state, 'bank-try')).toBe(summary.balance);
    expect(data).toEqual(before);
  });

  it('keeps the source state untouched when all wallets are cash', () => {
    const state: State = { version: 1, wallets: [wallet('only-cash', 'TRY', 'cash', 100)], entries: [ordinary('cash', 'only-cash')] };
    const before = structuredClone(state), scoped = activeAccountState(state);
    expect(scoped.wallets).toEqual([]); expect(scoped.entries).toEqual([]); expect(state).toEqual(before);
  });

  it('identifies legacy cash-linked entries in either transfer direction without marking ordinary bank movements', () => {
    const state = empty().state;
    expect(isCashLinkedEntry(state, transfer('out', 'bank-try', 'cash-try'))).toBe(true);
    expect(isCashLinkedEntry(state, transfer('in', 'cash-try', 'bank-try'))).toBe(true);
    expect(isCashLinkedEntry(state, ordinary('cash', 'cash-try'))).toBe(true);
    expect(isCashLinkedEntry(state, ordinary('bank', 'bank-try', 'movement', -100))).toBe(false);
  });
});

describe('safe removal of unused cash definitions', () => {
  it('removes only the three zero unused cash wallets without changing financial entries or the original document', () => {
    const source = empty(), before = serializeBackup(source);
    expect(removableCashWalletIds(source)).toEqual(['cash-try', 'cash-idr', 'cash-usd']);
    Object.freeze(source.state.wallets); Object.freeze(source.state.entries); Object.freeze(source.state); Object.freeze(source);
    const result = removeUnusedCashWallets(source);
    expect(result).not.toBe(source); expect(result.state).not.toBe(source.state);
    expect(result.state.wallets.map(row => row.id)).toEqual(['bank-try', 'bank-idr', 'ewallet-usd']);
    expect(result.state.entries).toEqual([]); expect(serializeBackup(source)).toBe(before);
    expect(parseBackupText(serializeBackup(result))).toEqual(result);
  });

  it.each([1, -1, 5_000])('retains a cash wallet with nonzero opening balance%s despite no recorded entries', openingBalance => {
    const source = empty(); source.state.wallets.find(row => row.id === 'cash-try')!.openingBalance = openingBalance;
    expect(removableCashWalletIds(source)).not.toContain('cash-try');
    expect(removeUnusedCashWallets(source).state.wallets.find(row => row.id === 'cash-try')?.openingBalance).toBe(openingBalance);
  });

  it.each(['expense', 'income', 'adjustment', 'unreviewed'] as const)('retains cash definitions referenced by existing%s history', type => {
    const source = empty(); source.state.entries = [ordinary('history', 'cash-try', type)];
    const before = serializeBackup(source), result = removeUnusedCashWallets(source);
    expect(removableCashWalletIds(source)).not.toContain('cash-try');
    expect(result.state.wallets.some(row => row.id === 'cash-try')).toBe(true);
    expect(result.state.entries).toEqual(source.state.entries); expect(serializeBackup(source)).toBe(before);
    expect(parseBackupText(serializeBackup(result))).toEqual(result);
  });

  it.each(['source', 'destination'] as const)('protects the%s cash wallet referenced by an active transfer', role => {
    const source = empty(); source.state.entries = [role === 'source' ? transfer('legacy', 'cash-try', 'bank-try') : transfer('legacy', 'bank-try', 'cash-try')];
    const before = serializeBackup(source), result = removeUnusedCashWallets(source);
    expect(result.state.wallets.some(row => row.id === 'cash-try')).toBe(true);
    expect(result.state.entries).toEqual(source.state.entries); expect(serializeBackup(source)).toBe(before);
    expect(parseBackupText(serializeBackup(result))).toEqual(result);
  });

  it('protects an otherwise unused cash wallet referenced by captured bank facts and their statement witness', () => {
    const source = empty(); source.metadata = metadata();
    source.metadata.facts.push({ id: 'fact-cash', walletId: 'cash-try', currency: 'TRY', postedOn: DATE,
      signedAmount: 100, balanceAfter: 100, description: 'Synthetic captured source', fingerprintVersion: 'ziraat-v1', fingerprint: 'ziraat:0000000000000001' });
    source.metadata.statements.push({ id: 'statement-cash', walletId: 'cash-try', currency: 'TRY', periodStart: DATE, periodEnd: DATE,
      openingBalance: 0, closingBalance: 100, rowIds: ['fact-cash'] });
    const before = serializeBackup(source), result = removeUnusedCashWallets(source);
    expect(removableCashWalletIds(source)).not.toContain('cash-try');
    expect(result.metadata).toEqual(source.metadata); expect(serializeBackup(source)).toBe(before);
    expect(parseBackupText(serializeBackup(result))).toEqual(result);
  });

  it('protects an empty statement-account reference even when no source facts or active entries exist', () => {
    const source = empty(); source.metadata = metadata();
    source.metadata.statements.push({ id: 'empty-statement', walletId: 'cash-try', currency: 'TRY', periodStart: DATE, periodEnd: DATE,
      openingBalance: 0, closingBalance: 0, rowIds: [] });
    const before = serializeBackup(source), result = removeUnusedCashWallets(source);
    expect(removableCashWalletIds(source)).not.toContain('cash-try');
    expect(result.metadata).toEqual(source.metadata); expect(serializeBackup(source)).toBe(before);
    expect(parseBackupText(serializeBackup(result))).toEqual(result);
  });

  it('protects a metadata baseline reference with no active cash entry or source fact', () => {
    const source = empty(); source.metadata = metadata();
    source.metadata.baselines = [{ id: 'cash-baseline', walletId: 'cash-try', boundary: { kind: 'end-of-day', date: DATE }, origin: 'manual', status: 'confirmed' }];
    const before = serializeBackup(source), result = removeUnusedCashWallets(source);
    expect(removableCashWalletIds(source)).not.toContain('cash-try');
    expect(result.metadata).toEqual(source.metadata); expect(serializeBackup(source)).toBe(before);
    expect(parseBackupText(serializeBackup(result))).toEqual(result);
  });

  it.each(['source', 'destination'] as const)('protects a%s wallet mentioned only by a prior manual unpairing witness', role => {
    const source = empty(); source.metadata = metadata();
    source.metadata.unpairings = [{ id: 'manual-unpair', sourceEntryId: 'old-source', destinationEntryId: 'old-destination',
      sourceWalletId: role === 'source' ? 'cash-try' : 'bank-try', destinationWalletId: role === 'source' ? 'bank-try' : 'cash-try',
      sourceDate: DATE, destinationDate: DATE, principal: 100, toAmount: 100, fee: 0,
      reason: 'Synthetic previous split', at: AT, groupNote: 'Synthetic group', groupOrigin: 'manual' }];
    const before = serializeBackup(source), result = removeUnusedCashWallets(source);
    expect(removableCashWalletIds(source)).not.toContain('cash-try');
    expect(result.metadata).toEqual(source.metadata); expect(serializeBackup(source)).toBe(before);
    expect(parseBackupText(serializeBackup(result))).toEqual(result);
  });

  it.each(['source', 'destination'] as const)('protects a%s wallet mentioned only inside a deleted-transfer tombstone', role => {
    const source = empty(); source.metadata = metadata();
    source.metadata.deletedTransfers = [{ entry: role === 'source' ? transfer('deleted', 'cash-try', 'bank-try') : transfer('deleted', 'bank-try', 'cash-try'),
      origin: 'manual', reason: 'Synthetic previous removal', at: AT }];
    const before = serializeBackup(source), result = removeUnusedCashWallets(source);
    expect(removableCashWalletIds(source)).not.toContain('cash-try');
    expect(result.metadata).toEqual(source.metadata); expect(serializeBackup(source)).toBe(before);
    expect(parseBackupText(serializeBackup(result))).toEqual(result);
  });

  it('keeps every existing bank/ewallet definition and does not remove wallets based on their names', () => {
    const source = empty(); source.state.wallets.find(row => row.id === 'bank-try')!.name = 'Cash-like bank account';
    const result = removeUnusedCashWallets(source);
    expect(result.state.wallets.map(row => row.id)).toEqual(['bank-try', 'bank-idr', 'ewallet-usd']);
    expect(result.state.wallets.find(row => row.id === 'bank-try')?.name).toBe('Cash-like bank account');
  });

  it('is a no-op when every cash definition has money or retained references', () => {
    const source = empty();
    for (const row of source.state.wallets) if (row.kind === 'cash') row.openingBalance = 100;
    expect(removableCashWalletIds(source)).toEqual([]);
    expect(removeUnusedCashWallets(source)).toBe(source);
  });
});
