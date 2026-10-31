import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBankEntryHintLookup, createBankEntryPresentationLookup, presentBankDescription } from './bankEntryHints';
import type { Entry } from './finance';
import type { SourceDocument } from './sourceModel';
import { serializeBackup } from './storage';

const entry = (patch: Partial<Entry> = {}): Entry => ({ id: 'synthetic-entry', date: '2026-10-31', type: 'unreviewed',
  walletId: 'bank', amount: -1200, category: 'My preserved category', note: 'SANAL POS ALIŞVERİŞ / synthetic merchant', ...patch });
const legacy = (entries: Entry[]): SourceDocument => ({ app: 'uangku', version: 1, demo: false, state: {
  version: 1, wallets: [{ id: 'bank', name: 'Synthetic bank', currency: 'TRY', kind: 'bank', openingBalance: 10000 }], entries,
} });

function sourced(description: string): SourceDocument {
  const data = legacy([entry({ sourceKey: 'ziraat:0000000000000001' })]);
  data.metadata = { policy: 'unverified-unless-linked', facts: [
    { id: 'synthetic-fact', walletId: 'bank', currency: 'TRY', postedOn: '2026-10-31', signedAmount: -1200,
      balanceAfter: 8800, description, fingerprintVersion: 'ziraat-v1', fingerprint: 'ziraat:0000000000000001' },
  ], links: [{ entryId: 'synthetic-entry', source: 'synthetic-fact' }], statements: [
    { id: 'synthetic-statement', walletId: 'bank', currency: 'TRY', periodStart: '2026-10-31', periodEnd: '2026-10-31',
      openingBalance: 10000, closingBalance: 8800, rowIds: ['synthetic-fact'] },
  ], annotations: [{ sourceId: 'synthetic-fact', category: 'My preserved category',
    note: 'SANAL POS ALIŞVERİŞ / synthetic merchant', confirmedType: 'unreviewed' }] };
  return data;
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

afterEach(() => vi.unstubAllGlobals());

describe('view-only bank entry interpretations', () => {
  it('prefers the linked original bank description over an edited memo and annotation', () => {
    const data = sourced('ATM PARA ÇEKME / synthetic bank');
    const hint = createBankEntryHintLookup(data)(data.state.entries[0]);
    expect(hint).toMatchObject({ kind: 'atm-withdrawal', pending: false });
    expect(hint.warning).toContain('pengeluaran kategori Tarik tunai');
    expect(hint.warning).not.toContain('tanpa pengeluaran');
  });

  it('does not fall back to a matching memo when the linked source has no known interpretation', () => {
    const data = sourced('UNKNOWN ORIGINAL BANK MOVEMENT');
    data.state.entries[0].note = 'ATM PARA ÇEKME';
    expect(createBankEntryHintLookup(data)(data.state.entries[0])).toEqual({ kind: 'none', label: '', warning: '', pending: false });
  });

  it('reads a destination-only source link rather than guessing from a debit-style note', () => {
    const data = sourced('YURTİÇİ ATM P.Y. / synthetic bank');
    data.state.entries[0].amount = 1200;
    data.state.entries[0].note = 'ATM PARA ÇEKME';
    data.metadata!.facts[0].signedAmount = 1200;
    data.metadata!.facts[0].balanceAfter = 11200;
    data.metadata!.statements[0].closingBalance = 11200;
    data.metadata!.links[0] = { entryId: 'synthetic-entry', destination: 'synthetic-fact' };
    const hint = createBankEntryHintLookup(data)(data.state.entries[0]);
    expect(hint).toMatchObject({ kind: 'atm-deposit', pending: false });
    expect(hint.warning).toContain('pemasukan kategori Setor tunai');
    expect(hint.warning).not.toContain('tanpa pemasukan');
  });

  it.each(['transfer', 'adjustment'] as const)('suppresses misleading pending hints on an already classified %s', type => {
    const data = sourced('ATM PARA ÇEKME / synthetic bank');
    const classified = { ...data.state.entries[0], type };
    expect(createBankEntryHintLookup(data)(classified)).toEqual({ kind: 'none', label: '', warning: '', pending: false });
  });

  it.each([
    ['ATM PARA ÇEKME', 'atm-withdrawal', false],
    ['PREPAID İADE', 'cashback', true],
    ['123 Referanslı Havale / BSMV Tahsilatı', 'transfer-fee', false],
    ['SANAL POS ALIŞVERİŞ / unknown merchant', 'online-purchase', false],
  ] as const)('supports a v1 note without fabricating source metadata: %s', (note, kind, pending) => {
    const data = legacy([entry({ note, sourceKey: 'ziraat:0000000000000001' })]);
    expect(createBankEntryHintLookup(data)(data.state.entries[0])).toMatchObject({ kind, pending });
    expect(data.metadata).toBeUndefined();
  });

  it('uses a legacy note for an unlinked entry even when unrelated source facts exist', () => {
    const data = sourced('ATM PARA ÇEKME');
    const unlinked = entry({ id: 'unlinked', note: 'PREPAID İADE', amount: 1200 });
    data.state.entries.push(unlinked);
    expect(createBankEntryHintLookup(data)(unlinked)).toMatchObject({ kind: 'cashback', pending: false });
  });

  it('keeps source facts, annotations, amounts, categories and backup bytes unchanged without storage calls', () => {
    const data = sourced('ATM PARA ÇEKME / synthetic bank'), before = serializeBackup(data);
    const getItem = vi.fn(), setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem, setItem });
    freezeDeep(data);
    const hint = createBankEntryHintLookup(data);
    for (let i = 0; i < 3; i += 1) expect(hint(data.state.entries[0]).kind).toBe('atm-withdrawal');
    expect(serializeBackup(data)).toBe(before);
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('does not share mutable hint decisions between reads', () => {
    const data = sourced('ATM PARA ÇEKME'), hint = createBankEntryHintLookup(data);
    const first = hint(data.state.entries[0]);
    first.warning = 'Changed by a consumer';
    expect(hint(data.state.entries[0]).warning).not.toBe(first.warning);
  });
});

describe('source-first bank entry presentation', () => {
  const raw = 'SANAL POS ALIŞVERİŞ KART NO: 0000 **** **** 0000 İŞYERİ: SYNTHETIC MERCHANT MUTABAKAT: 123';
  function withMemo(description: string, note = description.trim()) {
    const data = sourced(description);
    data.state.entries[0].note = note;
    data.metadata!.annotations![0].note = note;
    return data;
  }

  it('puts the known operation and explicitly labelled merchant ahead of bank boilerplate', () => {
    const data = withMemo(raw), view = createBankEntryPresentationLookup(data)(data.state.entries[0]);
    expect(view).toMatchObject({ title: 'Belanja online · SYNTHETIC MERCHANT', merchant: 'SYNTHETIC MERCHANT',
      description: raw, noteIsCustom: false, bank: { kind: 'online-purchase' } });
    expect(view.title).not.toContain('KART NO');
    expect(view.description).toContain('KART NO: 0000 **** **** 0000');
    expect(view.description).toContain('MUTABAKAT: 123');
  });

  it('presents a preview directly from its unchanged original source string', () => {
    const description = ` \n${raw} \t`, before = description;
    const view = presentBankDescription(description, -1200);
    expect(view).toMatchObject({ title: 'Belanja online · SYNTHETIC MERCHANT', description,
      merchant: 'SYNTHETIC MERCHANT', noteIsCustom: false, bank: { kind: 'online-purchase' } });
    expect(description).toBe(before);
    view.bank.warning = 'Consumer change';
    expect(presentBankDescription(description, -1200).bank.warning).not.toBe('Consumer change');
  });

  it('shows a physical card merchant without guessing what the merchant sold', () => {
    const description = 'POS ALIŞVERİŞ (YURTİÇİ) KART NO: 0000 **** **** 0000 İŞYERİ: SYNTHETIC PERSON NAME MUTABAKAT: 123';
    const data = withMemo(description), view = createBankEntryPresentationLookup(data)(data.state.entries[0]);
    expect(view).toMatchObject({ title: 'Pembayaran kartu · SYNTHETIC PERSON NAME', merchant: 'SYNTHETIC PERSON NAME',
      description, bank: { kind: 'card-purchase' } });
    expect(data.state.entries[0].category).toBe('My preserved category');
  });

  it('names an ATM problem refund without presenting it as a cash deposit', () => {
    const description = 'SYNTHETIC-REF tam atm sorunlu işlem iadesi', data = withMemo(description);
    data.state.entries[0].amount = 1000;
    const view = createBankEntryPresentationLookup(data)(data.state.entries[0]);
    expect(view).toMatchObject({ title: 'Pengembalian transaksi ATM bermasalah', description,
      bank: { kind: 'atm-refund', pending: false } });
    expect(view.title).not.toContain('Setor');
    expect(data.state.entries[0].type).toBe('unreviewed');
  });

  it.each(['İŞYERİ', 'ISYERI', 'işyeri', 'isyeri', 'İşyeri', 'ısyerı'])('reads an explicit %s label without changing merchant casing', marker => {
    const description = `SANAL POS ALISVERIS ${marker}: Synthetic Merchant mutabakat: 456`;
    const data = withMemo(description), view = createBankEntryPresentationLookup(data)(data.state.entries[0]);
    expect(view.merchant).toBe('Synthetic Merchant');
    expect(view.title).toBe('Belanja online · Synthetic Merchant');
    expect(view.description).toBe(description);
  });

  it('retains leading/trailing source whitespace without mistaking importer trim for a custom memo', () => {
    const description = ` \n${raw} \t`, data = withMemo(description);
    const view = createBankEntryPresentationLookup(data)(data.state.entries[0]);
    expect(view.noteIsCustom).toBe(false);
    expect(view.title).toBe('Belanja online · SYNTHETIC MERCHANT');
    expect(view.description).toBe(description);
  });

  it('keeps an edited user memo as the primary title and source facts as its description', () => {
    const data = withMemo(raw, 'My own meaningful memo'), view = createBankEntryPresentationLookup(data)(data.state.entries[0]);
    expect(view).toMatchObject({ title: 'My own meaningful memo', description: raw,
      merchant: 'SYNTHETIC MERCHANT', noteIsCustom: true, bank: { kind: 'online-purchase' } });
  });

  it('does not reinterpret a known blank source using a matching edited memo', () => {
    const data = withMemo('', 'ATM PARA ÇEKME');
    expect(createBankEntryPresentationLookup(data)(data.state.entries[0])).toMatchObject({ title: 'ATM PARA ÇEKME',
      description: '', noteIsCustom: true, bank: { kind: 'none' } });
  });

  it('does not reinterpret an unknown source using a matching edited memo', () => {
    const data = withMemo('Unknown original source', raw), view = createBankEntryPresentationLookup(data)(data.state.entries[0]);
    expect(view).toMatchObject({ title: raw, description: 'Unknown original source', noteIsCustom: true,
      bank: { kind: 'none' } });
    expect(view.merchant).toBeUndefined();
  });

  it('supports an unlinked v1 raw memo without fabricating bank facts', () => {
    const data = legacy([entry({ note: raw })]);
    expect(createBankEntryPresentationLookup(data)(data.state.entries[0])).toMatchObject({
      title: 'Belanja online · SYNTHETIC MERCHANT', merchant: 'SYNTHETIC MERCHANT', description: raw,
      noteIsCustom: false, bank: { kind: 'online-purchase' } });
    expect(data.metadata).toBeUndefined();
  });

  it('uses a destination-only source link while preserving its raw source wording', () => {
    const description = 'YURTİÇİ ATM P.Y. synthetic bank', data = withMemo(description);
    data.state.entries[0].amount = 1200;
    data.metadata!.links[0] = { entryId: 'synthetic-entry', destination: 'synthetic-fact' };
    const view = createBankEntryPresentationLookup(data)(data.state.entries[0]);
    expect(view).toMatchObject({ description, title: 'Setor tunai ATM', bank: { kind: 'atm-deposit' } });
  });

  it.each(['SYNTHETIC PERSON NAME', 'FAST HAVALE SYNTHETIC', 'SYNTHETIC MALL'])('treats the labelled merchant %s as a name, without inferring goods or transfer ownership', merchant => {
    const description = `SANAL POS ALIŞVERİŞ İŞYERİ: ${merchant} MUTABAKAT: 123`, data = withMemo(description);
    const view = createBankEntryPresentationLookup(data)(data.state.entries[0]);
    expect(view).toMatchObject({ title: `Belanja online · ${merchant}`, merchant, bank: { kind: 'online-purchase' } });
    expect(data.state.entries[0].category).toBe('My preserved category');
    expect(data.state.entries[0].type).toBe('unreviewed');
  });

  it.each(['SANAL POS ALIŞVERİŞ UNKNOWN MERCHANT', 'SANAL POS ALIŞVERİŞ İŞYERİ: MUTABAKAT: 123',
    'SANAL POS ALIŞVERİŞ İŞYERİ: A İŞYERİ: B MUTABAKAT: 123'])('does not invent a merchant from an absent, empty or repeated merchant field: %s', description => {
    const data = withMemo(description), view = createBankEntryPresentationLookup(data)(data.state.entries[0]);
    expect(view.merchant).toBeUndefined();
    expect(view.title).toBe('Belanja online');
    expect(view.description).toBe(description);
  });

  it.each(['transfer', 'adjustment'] as const)('keeps an existing %s memo without relabelling it as a merchant operation', type => {
    const data = withMemo(raw, 'My existing book interpretation'), row = { ...data.state.entries[0], type };
    expect(createBankEntryPresentationLookup(data)(row)).toMatchObject({ title: 'My existing book interpretation',
      description: raw, noteIsCustom: true, bank: { kind: 'none' } });
  });

  it('retains all words in both original sides of a paired transfer', () => {
    const data = withMemo('Original debit wording', 'My paired transfer');
    data.metadata!.facts.push({ ...data.metadata!.facts[0], id: 'second-fact', description: 'Original credit wording' });
    data.metadata!.links[0].destination = 'second-fact';
    const row = { ...data.state.entries[0], type: 'transfer' as const };
    expect(createBankEntryPresentationLookup(data)(row)).toMatchObject({ title: 'My paired transfer',
      description: 'Original debit wording\n\nOriginal credit wording', bank: { kind: 'none' } });
  });

  it('keeps an unknown manual memo and supplies a neutral title only when both memo and source are blank', () => {
    const data = legacy([entry({ note: 'My ordinary memo' }), entry({ id: 'empty', note: '' })]);
    const present = createBankEntryPresentationLookup(data);
    expect(present(data.state.entries[0])).toMatchObject({ title: 'My ordinary memo', description: 'My ordinary memo',
      noteIsCustom: false, bank: { kind: 'none' } });
    expect(present(data.state.entries[1])).toMatchObject({ title: 'Mutasi belum dikonfirmasi', description: '',
      noteIsCustom: false, bank: { kind: 'none' } });
  });

  it('is immutable, storage-free, and returns fresh consumer objects on every read', () => {
    const data = withMemo(raw), before = serializeBackup(data), getItem = vi.fn(), setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem, setItem });
    freezeDeep(data);
    const present = createBankEntryPresentationLookup(data), first = present(data.state.entries[0]);
    first.bank.warning = 'Consumer change';
    first.title = 'Consumer title';
    expect(present(data.state.entries[0]).title).toBe('Belanja online · SYNTHETIC MERCHANT');
    expect(present(data.state.entries[0]).bank.warning).not.toBe('Consumer change');
    expect(serializeBackup(data)).toBe(before);
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
});
