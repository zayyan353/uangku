import fc from 'fast-check';
import type { SourceDocument } from '../sourceModel';

const bankRow = fc.record({
  income: fc.boolean(),
  amount: fc.integer({ min: 1, max: 1_000_000 }),
  description: fc.constantFrom('Kafe İstanbul', 'Transfer sintetis', 'Warung contoh'),
  hasReference: fc.boolean(),
});

/** Synthetic rows share a wallet and statement. Derive balances, fingerprints and links together so shrinking keeps the document valid. */
export const sourceDocumentArbitrary = fc.record({
  openingBalance: fc.integer({ min: 0, max: 1_000_000 }),
  note: fc.constantFrom('', 'Catatan yang sama', 'Ödeme di warung'),
  rows: fc.array(bankRow, { minLength: 2, maxLength: 12 }),
}).map(({ openingBalance, note, rows }): SourceDocument => {
  let balance = openingBalance;
  const facts = rows.map((row, index) => {
    const signedAmount = row.income ? row.amount : -row.amount;
    balance += signedAmount;
    return {
      id: `f${index}`, walletId: 'bank', currency: 'TRY' as const, postedOn: '2026-10-31',
      signedAmount, balanceAfter: balance, description: row.description,
      fingerprintVersion: 'ziraat-v1' as const, fingerprint: `ziraat:${index.toString(16).padStart(16, '0')}`,
      ...(row.hasReference ? { reference: `REF${index}` } : {}),
    };
  });
  const entries = facts.map(fact => ({
    id: `tx-${fact.id}`, walletId: fact.walletId, date: fact.postedOn, note, category: 'Contoh',
    type: fact.signedAmount > 0 ? 'income' as const : 'expense' as const,
    amount: Math.abs(fact.signedAmount), sourceKey: fact.fingerprint,
  }));
  return {
    app: 'uangku', version: 1, demo: false,
    state: { version: 1, wallets: [{ id: 'bank', name: 'Bank sintetis', currency: 'TRY', kind: 'bank', openingBalance }], entries },
    metadata: {
      policy: 'unverified-unless-linked', facts,
      links: facts.map((fact, i) => ({ entryId: entries[i].id, source: fact.id })),
      statements: [{ id: 's1', walletId: 'bank', currency: 'TRY', periodStart: '2026-10-31', periodEnd: '2026-10-31',
        openingBalance, closingBalance: balance, rowIds: facts.map(fact => fact.id) }],
    },
  };
});
