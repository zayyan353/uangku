import { describe, expect, it, vi } from 'vitest';
import { addVisibleCurrency, removeVisibleCurrency, setVisibleCurrencies, visibleCurrencyCodes } from './currencySettings';
import { type Currency } from './currencyCatalog';
import { type SourceDocument } from './sourceModel';
import { decodeSourceWire, encodeSourceWire, MULTICURRENCY_SOURCE_CODEC } from './sourceCodec';
import { MAX_BACKUP_BYTES, parseBackupText, prepareBackup, readStored, serializeBackup, validateBackup } from './storage';
import { entryPostings, walletBalance } from './finance';
import { assertArchivedWalletsUnchanged } from './walletLifecycle';

const at = '2026-10-31T12:00:00.000Z';
function ordinary(currency: Currency = 'TRY'): SourceDocument {
  return { app: 'uangku', version: 1, demo: false, state: { version: 1,
    wallets: [{ id: 'a', name: 'Synthetic bank', currency, kind: 'bank', openingBalance: 10000 }],
    entries: [{ id: 'row', date: '2026-10-30', type: 'expense', walletId: 'a', amount: 100, category: 'Pilihan manual', note: 'Synthetic note' }],
  } };
}
function sourced(currency: Currency = 'TRY', generic = false): SourceDocument {
  const data = ordinary(currency), prefix = generic ? 'generic' : 'ziraat';
  data.state.entries[0].sourceKey = `${prefix}:0000000000000001`;
  data.metadata = { policy: 'unverified-unless-linked',
    facts: [{ id: 'fact', walletId: 'a', currency, postedOn: '2026-10-30', signedAmount: -100,
      balanceAfter: 9900, description: 'Original synthetic source', reference: '000000000000000000001',
      fingerprintVersion: generic ? 'generic-v1' : 'ziraat-v1', fingerprint: `${prefix}:0000000000000001` }],
    links: [{ entryId: 'row', source: 'fact' }],
    statements: [{ id: 'statement', walletId: 'a', currency, periodStart: '2026-10-30', periodEnd: '2026-10-30', openingBalance: 10000, closingBalance: 9900, rowIds: ['fact'] }],
    annotations: [{ sourceId: 'fact', category: 'Pilihan manual', note: 'Synthetic note', confirmedType: 'expense' }],
  };
  return data;
}
const oldCodecs = ['table-tuples-v1','table-tuples-v2','table-tuples-v3','table-tuples-v4','table-tuples-v5'];

describe('portable visible-currency settings', () => {
  it('returns detached legacy defaults without changing the legacy financial format', () => {
    const data = ordinary(), before = JSON.stringify(data), visible = visibleCurrencyCodes(data);
    expect(visible).toEqual(['IDR','TRY','USD']);
    visible.pop();
    expect(visibleCurrencyCodes(data)).toEqual(['IDR','TRY','USD']);
    expect(serializeBackup(data)).toBe(before);
    expect(setVisibleCurrencies(data, ['IDR','TRY','USD'])).toBe(data);
    expect(addVisibleCurrency(data, 'TRY')).toBe(data);
  });

  it('reveals used extended currencies when restoring a document without an explicit visible list', () => {
    const data = ordinary('EUR');
    expect(visibleCurrencyCodes(data)).toEqual(['IDR','TRY','USD','EUR']);
    const restored = parseBackupText(serializeBackup(data));
    expect(visibleCurrencyCodes(restored)).toEqual(['IDR','TRY','USD','EUR']);
    const hidden = setVisibleCurrencies(restored, ['TRY']);
    expect(visibleCurrencyCodes(parseBackupText(serializeBackup(hidden)))).toEqual(['TRY']);
    expect(hidden.state.wallets[0].currency).toBe('EUR');
  });

  it('adds and hides used currencies without changing any financial or source data', () => {
    const data = sourced(), before = structuredClone(data);
    const added = addVisibleCurrency(data, 'EUR');
    const hidden = removeVisibleCurrency(added, 'TRY');
    expect(visibleCurrencyCodes(hidden)).toEqual(['IDR','USD','EUR']);
    expect(hidden.state).toEqual(data.state);
    expect(hidden.metadata!.facts).toEqual(data.metadata!.facts);
    expect(hidden.metadata!.annotations).toEqual(data.metadata!.annotations);
    expect(hidden.metadata!.statements).toEqual(data.metadata!.statements);
    expect(walletBalance(hidden.state, 'a', hidden.metadata)).toBe(9900);
    expect(data).toEqual(before);
    const raw = serializeBackup(hidden);
    expect(JSON.parse(raw).codec).toBe(MULTICURRENCY_SOURCE_CODEC);
    expect(parseBackupText(raw)).toEqual(hidden);
  });

  it('keeps archive availability independent of currency visibility, even when wallet ID equals a code', () => {
    const data = ordinary();
    data.state.wallets[0].id = 'TRY'; data.state.entries[0].walletId = 'TRY';
    data.metadata = { policy: 'unverified-unless-linked', facts: [], links: [], statements: [], walletArchives: [{ walletId: 'TRY', at }] };
    const changed = removeVisibleCurrency(data, 'TRY');
    expect(changed.state).toEqual(data.state);
    expect(changed.metadata!.walletArchives).toEqual(data.metadata.walletArchives);
    expect(() => assertArchivedWalletsUnchanged(data, changed)).not.toThrow();
    expect(parseBackupText(serializeBackup(changed))).toEqual(changed);
  });

  it.each([[], ['EUR','EUR'], ['eur'], ['ZZZ'], ['constructor'], ['EUR',''], Array.from({ length: 201 }, () => 'EUR')].map(codes => ({ codes })))('rejects malformed availability lists atomically: $codes', ({ codes }) => {
    const data = ordinary(), before = JSON.stringify(data);
    expect(() => setVisibleCurrencies(data, codes)).toThrow();
    expect(JSON.stringify(data)).toBe(before);
  });

  it('refuses removing the final visible code and rejects unknown add/remove requests', () => {
    const data = setVisibleCurrencies(ordinary(), ['JPY']), before = serializeBackup(data);
    expect(() => removeVisibleCurrency(data, 'JPY')).toThrow(/setidaknya satu/);
    expect(() => addVisibleCurrency(data, 'XYZ')).toThrow(/Kode/);
    expect(() => removeVisibleCurrency(data, 'XYZ')).toThrow(/Kode/);
    expect(serializeBackup(data)).toBe(before);
  });

  it('does not write storage when preparing settings or restoring them', () => {
    const setItem = vi.fn(); vi.stubGlobal('localStorage', { setItem, getItem: () => serializeBackup(addVisibleCurrency(ordinary(), 'KWD')) });
    try {
      const read = readStored();
      expect(read.blocked).toBe(false);
      expect(visibleCurrencyCodes(read.data)).toContain('KWD');
      expect(setItem).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('strict multicurrency and generic-source codec feature gate', () => {
  it.each(['EUR','JPY','KWD','CLF'] as const)('auto-wraps a plain internal %s ledger in v6 without rescaling any amount', currency => {
    const data = ordinary(currency), before = structuredClone(data);
    const prepared = prepareBackup(data);
    expect(JSON.parse(prepared.raw).codec).toBe(MULTICURRENCY_SOURCE_CODEC);
    expect(prepared.data.state).toEqual(data.state);
    expect(parseBackupText(prepared.raw)).toEqual(prepared.data);
    expect(data).toEqual(before);
    expect(() => validateBackup(data)).toThrow(/multi|mata uang|format/i);
    expect(() => validateBackup({ ...data, version: 3 })).toThrow(/multi|mata uang|format/i);
  });

  it.each(['TRY','EUR','JPY','KWD'] as const)('roundtrips generic %s evidence and manual annotations without conversion', currency => {
    const data = sourced(currency, true), before = structuredClone(data);
    const prepared = prepareBackup(data), wire = JSON.parse(prepared.raw);
    expect(wire.codec).toBe(MULTICURRENCY_SOURCE_CODEC);
    expect(decodeSourceWire(wire)).toEqual(data);
    expect(parseBackupText(prepared.raw)).toEqual(data);
    expect(prepared.data.state.entries.flatMap(entry => entryPostings(entry, prepared.data.metadata)))
      .toEqual(data.state.entries.flatMap(entry => entryPostings(entry, data.metadata)));
    expect(data).toEqual(before);
  });

  it.each(oldCodecs)('rejects currency settings mislabeled as %s', codec => {
    const wire = encodeSourceWire(addVisibleCurrency(ordinary(), 'EUR'));
    expect(() => decodeSourceWire({ ...wire, codec })).toThrow(/table-tuples-v6/);
  });

  it.each(oldCodecs)('rejects extended currency and generic evidence smuggled under %s', codec => {
    const extended = JSON.parse(serializeBackup(ordinary('JPY')));
    expect(() => decodeSourceWire({ ...extended, codec })).toThrow(/multi|mata uang|format/i);
    const generic = encodeSourceWire(sourced('TRY', true));
    expect(() => decodeSourceWire({ ...generic, codec })).toThrow(/table-tuples-v6/);
  });

  it('rejects new metadata inside external plain v1 rather than silently upgrading unknown evidence', () => {
    expect(() => validateBackup(sourced('TRY', true))).toThrow(/table-tuples-v6/);
    expect(() => validateBackup(addVisibleCurrency(ordinary(), 'EUR'))).toThrow(/table-tuples-v6/);
    expect(() => validateBackup({ ...sourced('TRY', true), version: 3 })).toThrow(/metadata/);
  });

  it.each([
    ['generic-v1','ziraat:0000000000000001'],
    ['ziraat-v1','generic:0000000000000001'],
    ['generic-v2','generic:0000000000000001'],
    ['generic-v1','generic:000000000000000G'],
  ])('rejects inconsistent source identity %s/%s', (version, fingerprint) => {
    const data = sourced('TRY', true);
    Object.assign(data.metadata!.facts[0], { fingerprintVersion: version, fingerprint });
    expect(() => prepareBackup(data)).toThrow(/fingerprint/i);
  });

  it('rejects malformed currency table values and canonical data loss', () => {
    const data = addVisibleCurrency(ordinary(), 'EUR');
    for (const currencies of [[], [{ code: 'EUR' },{ code: 'EUR' }], [{ code: 'EUR', unexpected: true }], [{ code: 'XYZ' }]]) {
      expect(() => prepareBackup({ ...data, metadata: { ...data.metadata!, currencies } })).toThrow();
    }
    const wire = encodeSourceWire(data), broken = structuredClone(wire) as unknown as { t: { currencies: { k: string[] } } };
    broken.t.currencies.k.push('unexpected');
    expect(() => decodeSourceWire(broken)).toThrow(/Kolom/);
  });

  it('retains archive, signed movement, and E5 metadata in the new superset codec', () => {
    const data = addVisibleCurrency(ordinary('JPY'), 'KWD');
    data.state.entries[0].type = 'movement'; data.state.entries[0].amount = -100;
    data.metadata!.walletArchives = [{ walletId: 'a', at }]; data.metadata!.baselineDecisions = [];
    const raw = serializeBackup(data);
    expect(JSON.parse(raw).codec).toBe(MULTICURRENCY_SOURCE_CODEC);
    expect(parseBackupText(raw)).toEqual(data);
    expect(walletBalance(data.state, 'a', data.metadata)).toBe(9900);
  });

  it('validates retained unpair witness rate in major units across 0 and 3 digit currencies', () => {
    const data = ordinary('JPY');
    data.state.wallets.push({ id: 'b', name: 'Synthetic KWD', currency: 'KWD', kind: 'bank', openingBalance: 0 });
    data.state.entries = [{ id: 'debit', date: '2026-10-30', type: 'unreviewed', walletId: 'a', amount: -100, category: '', note: 'Synthetic debit' },
      { id: 'credit', date: '2026-10-30', type: 'unreviewed', walletId: 'b', amount: 200, category: '', note: 'Synthetic credit' }];
    data.metadata = { policy: 'unverified-unless-linked', facts: [], links: [], statements: [], unpairings: [{ id: 'witness',
      sourceEntryId: 'debit', destinationEntryId: 'credit', sourceWalletId: 'a', destinationWalletId: 'b', sourceDate: '2026-10-30', destinationDate: '2026-10-30',
      principal: 100, toAmount: 200, rate: 0.002, fee: 0, reason: 'Explicit synthetic split', at, groupNote: 'Synthetic transfer' }] };
    expect(parseBackupText(serializeBackup(data))).toEqual(data);
    const bad = structuredClone(data); bad.metadata!.unpairings![0].rate = 2;
    expect(() => prepareBackup(bad)).toThrow(/witness unpair/);
  });

  it('retains old safe boundary transfers within the established one-minor-unit rate tolerance', () => {
    const data = ordinary();
    data.state.wallets[0].openingBalance = 8575606148499318;
    data.state.wallets.push({ id: 'b', name: 'Synthetic USD', currency: 'USD', kind: 'bank', openingBalance: 0 });
    data.state.entries = [{ id: 'legacy', date: '2026-10-30', type: 'transfer', walletId: 'a', toWalletId: 'b', amount: 8575606148499318,
      toAmount: Number.MAX_SAFE_INTEGER, rate: 1.050328, fee: 0, category: '', note: 'Synthetic safe legacy boundary' }];
    expect(Math.round(data.state.entries[0].amount * data.state.entries[0].rate!)).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseBackupText(JSON.stringify(data))).toEqual(data);
  });

  it('retains old source unpair witnesses at the same safe transfer boundary', () => {
    const data = ordinary();
    data.state.wallets[0].openingBalance = 8575606148499318;
    data.state.wallets.push({ id: 'b', name: 'Synthetic USD', currency: 'USD', kind: 'bank', openingBalance: 0 });
    data.state.entries = [{ id: 'debit', date: '2026-10-30', type: 'unreviewed', walletId: 'a', amount: -8575606148499318, category: '', note: 'Synthetic debit' },
      { id: 'credit', date: '2026-10-30', type: 'unreviewed', walletId: 'b', amount: Number.MAX_SAFE_INTEGER, category: '', note: 'Synthetic credit' }];
    data.metadata = { policy: 'unverified-unless-linked', facts: [], links: [], statements: [], unpairings: [{ id: 'legacy-witness',
      sourceEntryId: 'debit', destinationEntryId: 'credit', sourceWalletId: 'a', destinationWalletId: 'b', sourceDate: '2026-10-30', destinationDate: '2026-10-30',
      principal: 8575606148499318, toAmount: Number.MAX_SAFE_INTEGER, rate: 1.050328, fee: 0, reason: 'Synthetic legacy boundary', at, groupNote: 'Synthetic transfer' }] };
    expect(parseBackupText(serializeBackup(data))).toEqual(data);
  });

  it('keeps the original wire choices and bytes when new currency features are absent', () => {
    const plain = ordinary(); expect(serializeBackup(plain)).toBe(JSON.stringify(plain));
    const source = sourced(); expect(JSON.parse(serializeBackup(source)).codec).toBe('table-tuples-v1');
    const archived = sourced(); archived.metadata!.walletArchives = [{ walletId: 'a', at }];
    expect(JSON.parse(serializeBackup(archived)).codec).toBe('table-tuples-v5');
    expect(parseBackupText(serializeBackup(archived))).toEqual(archived);
  });

  it('refuses configuration overhead near8MiB without changing the previous valid snapshot', () => {
    const data = ordinary();
    const facts = Array.from({ length: 2200 }, (_, index) => ({ id: `capacity-fact-${index}`, walletId: 'a', currency: 'TRY' as const,
      postedOn: '2026-10-30', signedAmount: -1, balanceAfter: 9999 - index, description: `Synthetic ${index}: ` + 'x'.repeat(3900),
      fingerprintVersion: 'ziraat-v1' as const, fingerprint: `ziraat:${index.toString(16).padStart(16, '0')}` }));
    data.metadata = { policy: 'unverified-unless-linked', facts: [], links: [], statements: [] };
    const size = () => {
      data.metadata!.statements = [{ id: 'capacity-statement', walletId: 'a', currency: 'TRY', periodStart: '2026-10-30', periodEnd: '2026-10-30',
        openingBalance: 10000, closingBalance: 10000 - data.metadata!.facts.length, rowIds: data.metadata!.facts.map(fact => fact.id) }];
      return new TextEncoder().encode(JSON.stringify(encodeSourceWire(data))).length;
    };
    let low = 0, high = facts.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2); data.metadata.facts = facts.slice(0, middle);
      if (size() <= MAX_BACKUP_BYTES - 32) low = middle; else high = middle - 1;
    }
    data.metadata.facts = facts.slice(0, low);
    let padding = MAX_BACKUP_BYTES - 32 - size();
    for (const fact of data.metadata.facts) {
      const count = Math.min(4000 - fact.description.length, padding); fact.description += 'z'.repeat(count); padding -= count;
      if (padding === 0) break;
    }
    expect(padding).toBe(0);
    const durable = serializeBackup(data); expect(new TextEncoder().encode(durable).length).toBe(MAX_BACKUP_BYTES - 32);
    expect(() => addVisibleCurrency(data, 'EUR')).toThrow(/8 MiB/);
    expect(serializeBackup(data)).toBe(durable);
    expect(parseBackupText(durable)).toEqual(data);
    expect(data.metadata.currencies).toBeUndefined();
  });
});
