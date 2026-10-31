import { describe, expect, it, vi } from 'vitest';
import { validateSourceDocument, type SourceDocument } from './sourceModel';
import { decodeSourceWire, encodeSourceWire, WALLET_ARCHIVE_SOURCE_CODEC } from './sourceCodec';
import { MAX_BACKUP_BYTES, parseBackupText, prepareBackup, readStored, serializeBackup, validateBackup } from './storage';
import { buildCashflowReport } from './cashflowReport';
import { entryPostings, walletBalance } from './finance';
import { executeTransferCommand } from './transferCommands';

const at = '2026-10-31T12:00:00.000Z';
function ordinary(): SourceDocument {
  return { app: 'uangku', version: 1, demo: false, state: { version: 1,
    wallets: [{ id: 'a', name: 'Synthetic bank A', currency: 'TRY', kind: 'bank', openingBalance: 10000 },
      { id: 'b', name: 'Synthetic wallet B', currency: 'TRY', kind: 'ewallet', openingBalance: 2000 },
      { id: 'old-cash', name: 'Synthetic historical cash', currency: 'TRY', kind: 'cash', openingBalance: 0 }],
    entries: [{ id: 'row', date: '2026-10-30', type: 'expense', walletId: 'a', amount: 100, category: 'Pilihan manual', note: 'Synthetic purchase' }],
  } };
}
function sourced(): SourceDocument {
  const data = ordinary();
  data.state.entries[0].sourceKey = 'ziraat:0000000000000001';
  data.metadata = { policy: 'unverified-unless-linked',
    facts: [{ id: 'fact', walletId: 'a', currency: 'TRY', postedOn: '2026-10-30', signedAmount: -100,
      balanceAfter: 9900, description: 'Original synthetic bank description', reference: 'SYNTHETIC-REF',
      fingerprintVersion: 'ziraat-v1', fingerprint: 'ziraat:0000000000000001' }],
    links: [{ entryId: 'row', source: 'fact' }],
    statements: [{ id: 'statement', walletId: 'a', currency: 'TRY', periodStart: '2026-10-30', periodEnd: '2026-10-30', openingBalance: 10000, closingBalance: 9900, rowIds: ['fact'] }],
    annotations: [{ sourceId: 'fact', category: 'Pilihan manual', note: 'Synthetic purchase', confirmedType: 'expense' }],
    baselines: [{ id: 'baseline', walletId: 'a', boundary: { kind: 'before-source', date: '2026-10-30', sourceId: 'fact' }, origin: 'bank', status: 'confirmed' }],
    baselineDecisions: [{ baselineId: 'baseline', reason: 'Explicit synthetic baseline adoption', at }],
    completions: [{ baselineId: 'baseline', statementId: 'statement', sourceIds: ['fact'], at }],
    creationOrigins: [{ entryId: 'row', origin: 'bank' }],
  };
  return validateSourceDocument(data);
}
function archive(data: SourceDocument = ordinary(), walletId = 'a'): SourceDocument {
  const result = structuredClone(data);
  result.metadata ??= { policy: 'unverified-unless-linked', facts: [], links: [], statements: [] };
  result.metadata.walletArchives = [{ walletId, at }];
  return result;
}
const wireClone = (data: SourceDocument) => structuredClone(encodeSourceWire(data));

describe('persisted wallet archives and strict codec compatibility', () => {
  it.each(['a', 'b'])('roundtrips a noncash wallet archive without altering its ledger: %s', walletId => {
    const data = archive(sourced(), walletId), before = structuredClone(data);
    const prepared = prepareBackup(data), wire = JSON.parse(prepared.raw);
    expect(wire.codec).toBe(WALLET_ARCHIVE_SOURCE_CODEC);
    expect(parseBackupText(prepared.raw)).toEqual(data);
    expect(prepared.data).toEqual(data);
    expect(prepared.raw).toBe(serializeBackup(data));
    expect(data).toEqual(before);
    expect(walletBalance(prepared.data.state, 'a', prepared.data.metadata)).toBe(9900);
    expect(prepared.data.metadata!.facts).toEqual(before.metadata!.facts);
    expect(prepared.data.metadata!.statements).toEqual(before.metadata!.statements);
    expect(prepared.data.metadata!.annotations).toEqual(before.metadata!.annotations);
  });

  it('uses archive metadata as availability only, preserving all account cashflow and postings', () => {
    const data = sourced(), archived = archive(data);
    const query = { currency: 'TRY' as const, month: '2026-10', today: '2026-10-31', period: 'all' as const };
    expect(buildCashflowReport(archived, query)).toEqual(buildCashflowReport(data, query));
    expect(archived.state).toEqual(data.state);
    expect(archived.state.entries.flatMap(entry => entryPostings(entry, archived.metadata)))
      .toEqual(data.state.entries.flatMap(entry => entryPostings(entry, data.metadata)));
  });

  it('retains signed movements under codec5 while rejecting old source codecs', () => {
    const data = ordinary(); data.state.entries[0] = { ...data.state.entries[0], type: 'movement', amount: -100 };
    const archived = archive(data), wire = encodeSourceWire(archived);
    expect(wire.codec).toBe(WALLET_ARCHIVE_SOURCE_CODEC);
    expect(decodeSourceWire(wire)).toEqual(archived);
    expect(parseBackupText(serializeBackup(archived))).toEqual(archived);
  });

  it('retains E4 split dates and E5 deleted transfer evidence under codec5', () => {
    const data = ordinary();
    data.state.entries = [{ id: 'transfer', date: '2026-10-30', type: 'transfer', walletId: 'a', toWalletId: 'b', amount: 1000, toAmount: 1000, fee: 25, category: '', note: 'Synthetic split-date transfer' }];
    data.metadata = { policy: 'unverified-unless-linked', facts: [], links: [], statements: [],
      transfers: [{ entryId: 'transfer', sourceDate: '2026-10-30', destinationDate: '2026-10-31', decision: { reason: 'Explicit synthetic dates', at } }] };
    const split = archive(data), splitWire = encodeSourceWire(split);
    expect(decodeSourceWire(splitWire)).toEqual(split);
    const evidence = sourced();
    evidence.state.entries[0] = { ...evidence.state.entries[0], type: 'transfer', amount: 100, toWalletId: 'b', toAmount: 100, toSourceKey: 'ziraat:0000000000000002' };
    evidence.metadata!.facts.push({ id: 'destination-fact', walletId: 'b', currency: 'TRY', postedOn: '2026-10-31', signedAmount: 100,
      balanceAfter: 2100, description: 'Original synthetic credit', fingerprintVersion: 'ziraat-v1', fingerprint: 'ziraat:0000000000000002' });
    evidence.metadata!.links[0].destination = 'destination-fact';
    evidence.metadata!.statements.push({ id: 'destination-statement', walletId: 'b', currency: 'TRY', periodStart: '2026-10-31', periodEnd: '2026-10-31', openingBalance: 2000, closingBalance: 2100, rowIds: ['destination-fact'] });
    evidence.metadata!.transfers = [{ entryId: 'row', sourceDate: '2026-10-30', destinationDate: '2026-10-31' }];
    const deleted = executeTransferCommand(evidence, { kind: 'delete', entryId: 'row', reason: 'Delete synthetic transfer explicitly', at });
    const archivedDeleted = archive(deleted);
    expect(parseBackupText(serializeBackup(archivedDeleted))).toEqual(archivedDeleted);
    expect(archivedDeleted.metadata!.deletedTransfers).toHaveLength(1);
    expect(archivedDeleted.state.entries).toHaveLength(0);
  });

  it.each(['table-tuples-v1', 'table-tuples-v2', 'table-tuples-v3', 'table-tuples-v4'])('rejects an archive table mislabeled as %s', codec => {
    const wire = wireClone(archive());
    expect(() => decodeSourceWire({ ...wire, codec })).toThrow(/table-tuples-v5/);
  });

  it('keeps an empty archive table feature gated instead of silently dropping it', () => {
    const data = archive(); data.metadata!.walletArchives = [];
    const wire = encodeSourceWire(data);
    expect(wire.codec).toBe(WALLET_ARCHIVE_SOURCE_CODEC);
    expect(decodeSourceWire(wire).metadata!.walletArchives).toEqual([]);
    expect(() => decodeSourceWire({ ...wire, codec: 'table-tuples-v4' })).toThrow(/table-tuples-v5/);
  });

  it('rejects archive metadata in external v1 and plain v3 while internal admission accepts it', () => {
    const data = archive();
    expect(() => validateBackup(data)).toThrow(/table-tuples-v5/);
    expect(() => parseBackupText(JSON.stringify(data))).toThrow(/table-tuples-v5/);
    expect(() => validateSourceDocument(data, { allowWalletArchives: false })).toThrow(/table-tuples-v5/);
    expect(() => validateBackup({ ...data, version: 3 })).toThrow(/metadata/);
    expect(prepareBackup(data).data).toEqual(data);
  });

  it('preserves existing wire choices and byte serialization when archive metadata is absent', () => {
    const plain = ordinary();
    expect(serializeBackup(plain)).toBe(JSON.stringify(plain));
    const movement = ordinary(); movement.state.entries[0] = { ...movement.state.entries[0], type: 'movement', amount: -100 };
    expect(JSON.parse(serializeBackup(movement)).version).toBe(3);
    const variants: Array<[string, SourceDocument]> = [];
    const v1 = ordinary(); v1.metadata = { policy: 'unverified-unless-linked', facts: [], links: [], statements: [] }; variants.push(['table-tuples-v1', v1]);
    const v2 = structuredClone(v1); v2.metadata!.transfers = []; variants.push(['table-tuples-v2', v2]);
    const v3 = structuredClone(v1); v3.metadata!.baselineDecisions = []; variants.push(['table-tuples-v3', v3]);
    const v4 = structuredClone(v1); v4.state.entries[0] = { ...v4.state.entries[0], type: 'movement', amount: -100 }; variants.push(['table-tuples-v4', v4]);
    for (const [codec, data] of variants) {
      const wire = encodeSourceWire(data);
      expect(wire.codec).toBe(codec);
      expect(decodeSourceWire(wire)).toEqual(data);
      expect(serializeBackup(data)).toBe(serializeBackup(decodeSourceWire(wire)));
    }
  });

  it.each(['missing', 'old-cash'])('rejects nonexistent or historical cash archive references: %s', walletId => {
    expect(() => prepareBackup(archive(ordinary(), walletId))).toThrow(/Arsip dompet/);
  });

  it('rejects duplicate wallet IDs and bounded archive lists before serialization', () => {
    const repeated = archive(); repeated.metadata!.walletArchives!.push({ walletId: 'a', at });
    expect(() => prepareBackup(repeated)).toThrow(/berulang/);
    const oversized = archive(); oversized.metadata!.walletArchives = Array.from({ length: 101 }, () => ({ walletId: 'a', at }));
    expect(() => prepareBackup(oversized)).toThrow(/100/);
  });

  it.each(['', '2026-02-30T12:00:00Z', '2026-10-31', '2026-10-31T24:00:00Z', '2026-10-31T25:00:00Z',
    '2026-10-31T12:61:00Z', '2026-10-31T12:00:61Z', '2026-10-31T12:00:00', 'yesterday'])('rejects malformed archive timestamps: %s', invalid => {
    const data = archive(); data.metadata!.walletArchives![0].at = invalid;
    expect(() => prepareBackup(data)).toThrow(/waktu|tanggal|teks/);
  });

  it.each(['2026-10-31T12:00:00Z', '2026-10-31T12:00:00.1Z', '2026-10-31T12:00:00.12+03:00', '2026-10-31T12:00:00.123-03:00'])('retains valid archive timestamps exactly: %s', valid => {
    const data = archive(); data.metadata!.walletArchives![0].at = valid;
    expect(parseBackupText(serializeBackup(data)).metadata!.walletArchives![0].at).toBe(valid);
  });

  it('rejects unknown fields and missing required fields instead of dropping archive decisions', () => {
    for (const value of [{ walletId: 'a' }, { at }, { walletId: 'a', at, hidden: 'unsupported' }, null]) {
      const data = archive(); data.metadata!.walletArchives = [value as never];
      expect(() => prepareBackup(data)).toThrow();
    }
  });

  it('rejects malformed archive table references, extra columns and duplicate rows', () => {
    const wire = wireClone(archive());
    const broken = structuredClone(wire) as unknown as { t: { walletArchives: { d: Record<string, unknown> } } };
    broken.t.walletArchives.d.walletId = 999;
    expect(() => decodeSourceWire(broken)).toThrow(/referensi/);
    const columns = structuredClone(wire) as unknown as { t: { walletArchives: { k: string[] } } };
    columns.t.walletArchives.k.push('unexpected');
    expect(() => decodeSourceWire(columns)).toThrow(/Kolom/);
    const repeated = structuredClone(wire) as unknown as { t: { walletArchives: { r: unknown[][] } } };
    repeated.t.walletArchives.r.push(structuredClone(repeated.t.walletArchives.r[0]));
    expect(() => decodeSourceWire(repeated)).toThrow(/berulang/);
  });

  it('restores archived wallets through readStored with no persistence side effects', () => {
    const data = archive(sourced()), raw = serializeBackup(data), setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem: () => raw, setItem });
    try {
      const stored = readStored();
      expect(stored).toMatchObject({ data, blocked: false, persisted: true, token: raw });
      expect(setItem).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('refuses over-capacity archive documents without changing the caller or durable storage', () => {
    const data = archive();
    data.state.entries = Array.from({ length: 12000 }, (_, index) => ({ id: `large-${index}`, date: '2026-10-30', type: 'expense', walletId: 'a', amount: 1, category: 'Belanja', note: 'Synthetic ' + 'x'.repeat(650) }));
    const original = JSON.stringify(data);
    const storage = { raw: 'durable-untouched', setItem: vi.fn() };
    vi.stubGlobal('localStorage', storage);
    try {
      expect(new TextEncoder().encode(original).length).toBeGreaterThan(MAX_BACKUP_BYTES);
      expect(() => prepareBackup(data)).toThrow(/8 MB|8 MiB|batas/);
      expect(JSON.stringify(data)).toBe(original);
      expect(storage.raw).toBe('durable-untouched');
      expect(storage.setItem).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('refuses archive wire overhead near8MiB while the previous valid source remains restorable', () => {
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
      const middle = Math.ceil((low + high) / 2);
      data.metadata.facts = facts.slice(0, middle);
      if (size() <= MAX_BACKUP_BYTES - 32) low = middle; else high = middle - 1;
    }
    data.metadata.facts = facts.slice(0, low);
    let padding = MAX_BACKUP_BYTES - 32 - size();
    for (const fact of data.metadata.facts) {
      const count = Math.min(4000 - fact.description.length, padding);
      fact.description += 'z'.repeat(count); padding -= count;
      if (padding === 0) break;
    }
    expect(padding).toBe(0);
    const durable = serializeBackup(data);
    expect(new TextEncoder().encode(durable).length).toBe(MAX_BACKUP_BYTES - 32);
    const candidate = archive(data);
    expect(() => prepareBackup(candidate)).toThrow(/8 MiB/);
    expect(serializeBackup(data)).toBe(durable);
    expect(parseBackupText(durable)).toEqual(data);
    expect(data.metadata.walletArchives).toBeUndefined();
  });
});
