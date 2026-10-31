import { describe, expect, it } from 'vitest';
import { applyBankDecisions, type BankCategoryAssignment } from './bankDecisions';
import { entrySignedAmount, summaryForCurrency, walletBalance, type Entry } from './finance';
import { SOURCE_POLICY, type SourceDocument } from './sourceModel';
import { MAX_BACKUP_BYTES, parseBackupText, serializeBackup } from './storage';

const DATE = '2026-10-01';
function entry(id: string, note: string, amount = -100, category = 'Belum dikategorikan'): Entry {
  return { id, date: DATE, type: 'unreviewed', walletId: 'bank', amount, category, note };
}
function plain(entries: Entry[]): SourceDocument {
  return { app: 'uangku', version: 1, demo: false, state: { version: 1,
    wallets: [{ id: 'bank', name: 'Synthetic bank', currency: 'TRY', kind: 'bank', openingBalance: 10000 }], entries } };
}
function sourced(): SourceDocument {
  const rows = [entry('withdraw', 'ATM PARA CEKME', -100), entry('fee', 'GIDEN HAVALE KOMISYON TAHSILATI', -20), entry('cashback', 'PREPAID CREDIT', 30)];
  const data = plain(rows); let balance = 10000;
  data.metadata = { policy: SOURCE_POLICY, facts: rows.map((row, i) => {
    balance += row.amount; const fingerprint = `ziraat:${String(i + 1).padStart(16, '0')}`; row.sourceKey = fingerprint; row.importBatch = 'synthetic-batch';
    return { id: `fact-${i}`, walletId: 'bank', currency: 'TRY', postedOn: DATE, signedAmount: row.amount, balanceAfter: balance,
      description: row.note, fingerprintVersion: 'ziraat-v1', fingerprint };
  }), links: rows.map((row, i) => ({ entryId: row.id, source: `fact-${i}` })),
    statements: [{ id: 'statement', walletId: 'bank', currency: 'TRY', periodStart: DATE, periodEnd: DATE, openingBalance: 10000, closingBalance: balance, rowIds: rows.map((_, i) => `fact-${i}`) }],
    annotations: rows.map((row, i) => ({ sourceId: `fact-${i}`, category: row.category, note: row.note, confirmedType: 'unreviewed', importBatch: 'synthetic-batch' })),
  };
  return data;
}

describe('explicit bank decisions command', () => {
  it('confirms ATM expense, bank fee and cashback in one source-aware atomic batch without changing bank facts or signed postings', () => {
    const source = sourced(), before = serializeBackup(source), facts = JSON.stringify(source.metadata!.facts);
    const next = applyBankDecisions(source, [
      { entryId: 'withdraw', category: 'Tarik tunai', confirmBankType: true },
      { entryId: 'fee', category: 'Biaya bank', confirmBankType: true },
      { entryId: 'cashback', category: 'Cashback', confirmBankType: true },
    ]);
    expect(next.state.entries.map(row => [row.id, row.type, row.amount, row.category])).toEqual([
      ['withdraw', 'expense', 100, 'Tarik tunai'], ['fee', 'expense', 20, 'Biaya bank'], ['cashback', 'income', 30, 'Cashback'],
    ]);
    expect(JSON.stringify(next.metadata!.facts)).toBe(facts);
    expect(next.metadata!.statements).toEqual(source.metadata!.statements); expect(next.metadata!.links).toEqual(source.metadata!.links);
    expect(next.state.entries.map(entrySignedAmount)).toEqual(source.state.entries.map(entrySignedAmount));
    expect(walletBalance(next.state, 'bank')).toBe(walletBalance(source.state, 'bank'));
    expect(next.state.wallets).toEqual(source.state.wallets);
    for (let i = 0; i < source.state.entries.length; i++) {
      const original = source.state.entries[i], actual = next.state.entries[i];
      expect([actual.id, actual.date, actual.note, actual.sourceKey, actual.importBatch]).toEqual([original.id, original.date, original.note, original.sourceKey, original.importBatch]);
    }
    expect(next.metadata!.annotations!.map(row => row.confirmedType)).toEqual(['expense', 'expense', 'income']);
    expect(next.metadata!.annotations!.map(row => row.note)).toEqual(source.metadata!.annotations!.map(row => row.note));
    expect(serializeBackup(source)).toBe(before);
    const raw = serializeBackup(next), wire = JSON.parse(raw);
    expect(wire.version).toBe(2); expect(wire.codec).toBe('table-tuples-v1');
    expect(parseBackupText(raw)).toEqual(next);
  });

  it('emits gated plain version3 for a confirmed single-account movement without creating cash or counterpart fields', () => {
    const source = plain([entry('outside', 'GIDEN HAVALE', -100)]), next = applyBankDecisions(source, [{ entryId: 'outside', category: 'Transfer', confirmBankType: true }]);
    expect(next.state.entries[0].type).toBe('movement'); expect(next.state.entries[0].amount).toBe(-100);
    for (const key of ['toWalletId', 'toAmount', 'fee', 'rate']) expect(next.state.entries[0]).not.toHaveProperty(key);
    expect(next.state.wallets).toEqual(source.state.wallets);
    const summary = summaryForCurrency(next.state, 'TRY', '2026-10', '2026-10-31');
    expect(summary.balance).toBe(9900); expect(summary.income).toBe(0); expect(summary.expense).toBe(0);
    expect(JSON.parse(serializeBackup(next)).version).toBe(3);
    expect(parseBackupText(serializeBackup(next))).toEqual(next);
  });

  it('does not confirm a financial type when only a category was requested', () => {
    const source = plain([entry('unknown', 'ATM PARA CEKME')]), next = applyBankDecisions(source, [{ entryId: 'unknown', category: 'Tarik tunai' }]);
    expect(next.state.entries[0]).toEqual({ ...source.state.entries[0], category: 'Tarik tunai' });
    expect(JSON.parse(serializeBackup(next)).version).toBe(1);
  });

  it('retains a manual category during explicit type confirmation if the caller requests the same category', () => {
    const source = plain([entry('manual', 'ATM PARA CEKME', -100, 'Kategori manual saya')]);
    const next = applyBankDecisions(source, [{ entryId: 'manual', category: 'Kategori manual saya', confirmBankType: true }]);
    expect(next.state.entries[0].category).toBe('Kategori manual saya'); expect(next.state.entries[0].type).toBe('expense');
  });

  it('rejects a stale category proposal that would replace a manually filled category', () => {
    const source = plain([entry('manual', 'ATM PARA CEKME', -100, 'Kategori manual saya')]), before = serializeBackup(source);
    for (const confirmBankType of [undefined, true] as const) {
      expect(() => applyBankDecisions(source, [{ entryId: 'manual', category: 'Tarik tunai', ...(confirmBankType ? { confirmBankType } : {}) }])).toThrow(/manual/);
    }
    expect(serializeBackup(source)).toBe(before);
  });

  it.each(['UNCLEAR ORIGINAL', ''])('prefers immutable source text%s over an edited note that falsely suggests a bank operation', description => {
    const source = sourced(); source.metadata!.facts[0].description = description; source.state.entries[0].note = 'ATM PARA CEKME';
    const before = serializeBackup(source);
    expect(() => applyBankDecisions(source, [{ entryId: 'withdraw', category: 'Tarik tunai', confirmBankType: true }])).toThrow(/belum dapat dipastikan/);
    expect(serializeBackup(source)).toBe(before);
  });

  it('uses known immutable source wording even if the editable note describes something else', () => {
    const source = sourced(); source.state.entries[0].note = 'Memo edited: POS MIGROS';
    const next = applyBankDecisions(source, [{ entryId: 'withdraw', category: 'Tarik tunai', confirmBankType: true }]);
    expect(next.state.entries[0].type).toBe('expense'); expect(next.state.entries[0].note).toBe(source.state.entries[0].note);
    expect(next.metadata!.facts).toEqual(source.metadata!.facts);
  });

  it.each([
    ['POS MIGROS', -100], ['TRANSFER UNKNOWN REFUND', -100], ['ATM PARA CEKME', 100],
    ['ATM PARA YATIRMA', -100], ['PREPAID CARD', -100], ['GIDEN HAVALE KOMISYON TAHSILATI', 100],
  ] as const)('does not confirm unsafe wording/direction%s (%s)', (note, amount) => {
    const source = plain([entry('uncertain', note, amount)]), before = serializeBackup(source);
    expect(() => applyBankDecisions(source, [{ entryId: 'uncertain', category: 'Lainnya', confirmBankType: true }])).toThrow(/belum dapat dipastikan/);
    expect(serializeBackup(source)).toBe(before);
  });

  it('rejects a whole batch if one row cannot be confirmed, leaving earlier eligible rows unapplied', () => {
    const source = plain([entry('eligible', 'ATM PARA CEKME'), entry('uncertain', 'Unknown merchant')]), before = serializeBackup(source);
    expect(() => applyBankDecisions(source, [{ entryId: 'eligible', category: 'Tarik tunai', confirmBankType: true }, { entryId: 'uncertain', category: 'Lainnya', confirmBankType: true }])).toThrow();
    expect(serializeBackup(source)).toBe(before);
  });

  it.each([
    ['ATM PARA CEKME', -100, 'expense'], ['ATM YATAN', 100, 'income'],
  ] as const)('explicitly reclassifies an old plain ATM movement%s as%s while retaining category, signed delta and identity', (note, amount, type) => {
    const source = plain([{ ...entry('old-atm', note, amount, 'Kategori ATM manual'), type: 'movement' }]);
    const before = serializeBackup(source), balance = walletBalance(source.state, 'bank');
    expect(JSON.parse(before).version).toBe(3);
    const next = applyBankDecisions(source, [{ entryId: 'old-atm', category: 'Kategori ATM manual', confirmBankType: true }]);
    expect(next.state.entries).toHaveLength(1);
    expect(next.state.entries[0]).toEqual({ ...source.state.entries[0], type, amount: Math.abs(amount) });
    expect(entrySignedAmount(next.state.entries[0])).toBe(amount); expect(walletBalance(next.state, 'bank')).toBe(balance);
    expect(next.state.wallets).toEqual(source.state.wallets);
    expect(JSON.parse(serializeBackup(next)).version).toBe(1);
    expect(parseBackupText(serializeBackup(next))).toEqual(next);
    expect(serializeBackup(source)).toBe(before);
  });

  it('reclassifies an old sourced ATM movement with only its effective type and annotation changed', () => {
    const source = sourced();
    source.state.entries[0].type = 'movement'; source.state.entries[0].category = 'Tarikan pribadi';
    source.metadata!.annotations![0].confirmedType = 'movement'; source.metadata!.annotations![0].category = 'Tarikan pribadi';
    const before = serializeBackup(source), facts = JSON.stringify(source.metadata!.facts), balance = walletBalance(source.state, 'bank');
    expect(JSON.parse(before).codec).toBe('table-tuples-v4');
    const next = applyBankDecisions(source, [{ entryId: 'withdraw', category: 'Tarikan pribadi', confirmBankType: true }]);
    expect(next.state.entries[0]).toEqual({ ...source.state.entries[0], type: 'expense', amount: 100 });
    expect(next.state.entries.slice(1)).toEqual(source.state.entries.slice(1));
    expect(next.metadata!.annotations![0]).toEqual({ ...source.metadata!.annotations![0], confirmedType: 'expense' });
    expect(next.metadata!.annotations!.slice(1)).toEqual(source.metadata!.annotations!.slice(1));
    expect(JSON.stringify(next.metadata!.facts)).toBe(facts); expect(next.metadata!.links).toEqual(source.metadata!.links);
    expect(next.metadata!.statements).toEqual(source.metadata!.statements); expect(next.state.wallets).toEqual(source.state.wallets);
    expect(walletBalance(next.state, 'bank')).toBe(balance); expect(next.state.entries.map(row => row.id)).toEqual(source.state.entries.map(row => row.id));
    expect(parseBackupText(serializeBackup(next))).toEqual(next); expect(serializeBackup(source)).toBe(before);
  });

  it('does not reclassify an old ATM movement without an explicit reviewed confirmation flag', () => {
    const source = plain([{ ...entry('old-atm', 'ATM PARA CEKME'), type: 'movement' }]);
    const next = applyBankDecisions(source, [{ entryId: 'old-atm', category: 'Tarik tunai' }]);
    expect(next.state.entries[0]).toEqual({ ...source.state.entries[0], category: 'Tarik tunai' });
    expect(JSON.parse(serializeBackup(next)).version).toBe(3);
  });

  it('reclassifies an old sourced ATM deposit as income while retaining source balances and the manual category', () => {
    const source = sourced(), first = source.state.entries[0];
    first.type = 'movement'; first.amount = 100; first.note = 'ATM YATAN'; first.category = 'Setoran pribadi';
    source.metadata!.facts[0].description = 'ATM YATAN'; source.metadata!.facts[0].signedAmount = 100;
    let balance = 10000;
    for (const fact of source.metadata!.facts) { balance += fact.signedAmount; fact.balanceAfter = balance; }
    source.metadata!.statements[0].closingBalance = balance;
    source.metadata!.annotations![0] = { ...source.metadata!.annotations![0], note: 'ATM YATAN', category: first.category, confirmedType: 'movement' };
    const before = serializeBackup(source), facts = JSON.stringify(source.metadata!.facts), bankBalance = walletBalance(source.state, 'bank');
    const next = applyBankDecisions(source, [{ entryId: first.id, category: first.category, confirmBankType: true }]);
    expect(next.state.entries[0]).toEqual({ ...first, type: 'income' });
    expect(next.metadata!.annotations![0]).toEqual({ ...source.metadata!.annotations![0], confirmedType: 'income' });
    expect(next.metadata!.statements).toEqual(source.metadata!.statements); expect(JSON.stringify(next.metadata!.facts)).toBe(facts);
    expect(walletBalance(next.state, 'bank')).toBe(bankBalance); expect(next.state.entries).toHaveLength(source.state.entries.length);
    expect(next.state.entries.map(row => row.id)).toEqual(source.state.entries.map(row => row.id));
    expect(parseBackupText(serializeBackup(next))).toEqual(next); expect(serializeBackup(source)).toBe(before);
  });

  it.each([
    ['GIDEN HAVALE', -100], ['UNKNOWN MOVEMENT', -100], ['PREPAID CREDIT', 100],
    ['GIDEN HAVALE KOMISYON TAHSILATI', -100], ['ATM PARA CEKME', 100], ['ATM PARA YATIRMA', -100], ['ATM PARA CEKME IPTAL', -100],
  ] as const)('does not reclassify a noneligible existing movement%s (%s)', (note, amount) => {
    const source = plain([{ ...entry('unchanged', note, amount), type: 'movement' }]), before = serializeBackup(source);
    expect(() => applyBankDecisions(source, [{ entryId: 'unchanged', category: 'Lainnya', confirmBankType: true }])).toThrow(/bukan ATM/);
    expect(serializeBackup(source)).toBe(before);
  });

  it('rejects a mixed old-movement batch atomically when one proposal is not eligible for ATM policy conversion', () => {
    const source = plain([{ ...entry('eligible', 'ATM PARA CEKME'), type: 'movement' }, { ...entry('transfer', 'GIDEN HAVALE'), type: 'movement' }]);
    const before = serializeBackup(source);
    expect(() => applyBankDecisions(source, [{ entryId: 'eligible', category: 'Tarik tunai', confirmBankType: true }, { entryId: 'transfer', category: 'Transfer', confirmBankType: true }])).toThrow();
    expect(serializeBackup(source)).toBe(before);
    expect(source.state.entries.map(row => row.type)).toEqual(['movement', 'movement']);
  });

  it.each([
    [], [{ entryId: 'missing', category: 'Lainnya' }], [{ entryId: 'known', category: 'Lainnya' }, { entryId: 'known', category: 'Lainnya' }],
    [{ entryId: 'known', category: 'Belum dikategorikan' }], [{ entryId: 'known', category: 'x'.repeat(81) }],
    [{ entryId: 'known', category: 'Lainnya', confirmBankType: false }],
  ].map(assignments => [assignments] as const))('rejects malformed, missing and duplicated decisions without changes', assignments => {
    const source = plain([entry('known', 'GIDEN HAVALE')]), before = serializeBackup(source);
    expect(() => applyBankDecisions(source, assignments as unknown as BankCategoryAssignment[])).toThrow();
    expect(serializeBackup(source)).toBe(before);
  });

  it('rejects repeated type confirmation once the entry has already been confirmed', () => {
    const source = plain([entry('known', 'GIDEN HAVALE')]);
    const next = applyBankDecisions(source, [{ entryId: 'known', category: 'Transfer', confirmBankType: true }]);
    const before = serializeBackup(next);
    expect(() => applyBankDecisions(next, [{ entryId: 'known', category: 'Transfer', confirmBankType: true }])).toThrow(/sudah dikonfirmasi/);
    expect(serializeBackup(next)).toBe(before);
  });

  it('rejects edits to archived cash entries, paired transfers and balance adjustments', () => {
    const source = plain([entry('cash', 'ATM PARA CEKME'), entry('paired', 'Old paired transfer'), entry('adjust', 'Old adjustment')]);
    source.state.wallets.push({ id: 'cash-wallet', name: 'Synthetic archived cash', currency: 'TRY', kind: 'cash', openingBalance: 0 });
    source.state.entries[0].walletId = 'cash-wallet';
    source.state.entries[1] = { ...source.state.entries[1], type: 'transfer', amount: 100, toAmount: 100, toWalletId: 'cash-wallet' };
    source.state.entries[2].type = 'adjustment';
    const before = serializeBackup(source);
    for (const entryId of ['cash', 'paired', 'adjust']) expect(() => applyBankDecisions(source, [{ entryId, category: 'Lainnya' }])).toThrow(/arsip cash|penyesuaian/);
    expect(serializeBackup(source)).toBe(before);
  });

  it('rejects capacity overflow atomically even when every bank confirmation is otherwise eligible', () => {
    const source = plain([]); let bytes = new TextEncoder().encode(JSON.stringify(source)).length;
    for (let i = 0; i < 3000; i++) {
      const row = entry(`large-${i}`, 'ATM PARA CEKME ' + 'x'.repeat(3880), -1, '');
      const cost = new TextEncoder().encode(JSON.stringify(row)).length + (i ? 1 : 0);
      if (bytes + cost > MAX_BACKUP_BYTES - 64) break;
      bytes += cost; source.state.entries.push(row);
    }
    const before = serializeBackup(source);
    expect(new TextEncoder().encode(before).length).toBeLessThanOrEqual(MAX_BACKUP_BYTES);
    const assignments = source.state.entries.map(row => ({ entryId: row.id, category: 'Tarik tunai outside bookkeeping '.padEnd(80, 'x'), confirmBankType: true as const }));
    expect(() => applyBankDecisions(source, assignments)).toThrow(/8 MB|8 MiB|batas/);
    expect(serializeBackup(source)).toBe(before);
  }, 20_000);
});
