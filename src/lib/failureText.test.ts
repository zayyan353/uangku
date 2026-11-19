import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { describeFailure, failureClause, LEDGER_TOO_LARGE, VALIDATION_REFUSED } from './failureText';
import { SOURCE_ERROR_PREFIX, SOURCE_POLICY, validateSourceDocument } from './sourceModel';
import { assertJsonBudget } from './jsonBudget';
import type { Wallet } from './finance';

const wallet = (index: number): Wallet => ({ id: `w${index}`, name: `Synthetic wallet ${index}`, kind: 'bank', currency: 'IDR', openingBalance: 0 });
const thrown = (run: () => unknown): string => { try { run(); } catch (reason) { return (reason as Error).message; } throw new Error('Expected a refusal'); };

describe('MW-88b plain wording for validator refusals', () => {
  it('leaves text that already speaks to the user as it is', () => {
    for (const text of ['Transaksi tidak ditemukan.', 'Saldo sudah cocok; tidak perlu penyesuaian.', '', 'Ukuran data maksimal 8 MiB. Data lama belum diubah.']) {
      expect(describeFailure(text)).toEqual({ message: text, detail: '' });
    }
    // Only a text that starts with the validator's prefix is the validator's; a sentence that carries a cause
    // inside it uses failureClause for that cause (below).
    expect(describeFailure(`Sudah tersimpan, tetapi: ${SOURCE_ERROR_PREFIX}x`).detail).toBe('');
  });

  it('turns a validator refusal into one plain sentence and keeps its reason as a detail', () => {
    expect(VALIDATION_REFUSED).toBe('Tindakan ini ditolak oleh pemeriksaan data, jadi tidak ada yang disimpan atau diubah.');
    // The text the MW-87 bug showed as a red toast.
    expect(describeFailure('Metadata sumber tidak valid: Entry creation origin tidak ditemukan.')).toEqual({ message: VALIDATION_REFUSED, detail: 'Entry creation origin tidak ditemukan.' });
    // The same refusal as the validator really produces it: an origin row for an entry that does not exist.
    const orphan = thrown(() => validateSourceDocument({ app: 'uangku', version: 1, demo: false, state: { version: 1, wallets: [wallet(1)], entries: [] },
      metadata: { policy: SOURCE_POLICY, facts: [], links: [], statements: [], creationOrigins: [{ entryId: 'gone', origin: 'manual' }] } }));
    expect(orphan.startsWith(SOURCE_ERROR_PREFIX)).toBe(true);
    expect(describeFailure(orphan)).toEqual({ message: VALIDATION_REFUSED, detail: 'Entry creation origin tidak ditemukan.' });
    // The size checker writes the same prefix on its own.
    const nested = thrown(() => assertJsonBudget(JSON.parse('['.repeat(200) + ']'.repeat(200)), 1_000, 'uji'));
    expect(nested.startsWith(SOURCE_ERROR_PREFIX)).toBe(true);
    expect(describeFailure(nested).message).toBe(VALIDATION_REFUSED);
    expect(describeFailure(nested).detail).toMatch(/^uji: /);
  });

  it('gives the limits a user can reach their own sentence, taken from what the validator really says', () => {
    const tooMany = thrown(() => validateSourceDocument({ app: 'uangku', version: 1, demo: false, state: { version: 1, wallets: Array.from({ length: 101 }, (_, index) => wallet(index)), entries: [] } }));
    expect(tooMany).toBe('Metadata sumber tidak valid: Daftar dompet maksimal 100 dompet.');
    expect(describeFailure(tooMany)).toEqual({ message: 'Jumlah dompet sudah mencapai batas 100, jadi dompet baru tidak disimpan.', detail: '' });
    expect(describeFailure('Metadata sumber tidak valid: Daftar transaksi maksimal 100.000 transaksi.')).toEqual({ message: 'Jumlah transaksi sudah mencapai batas 100.000, jadi perubahan ini tidak disimpan.', detail: '' });
    // The size limit is the one ordinary use reaches first: a ledger of the smallest possible transactions hits 8 MiB
    // well before 100.000 rows. The sentence says so instead of hiding it under "Detail teknis".
    const tooLarge = thrown(() => validateSourceDocument({ app: 'uangku', version: 1, demo: false, state: { version: 1, wallets: [wallet(1)],
      entries: [{ id: 'e', date: '2026-10-01', type: 'expense', walletId: 'w1', amount: 1, category: 'Belanja', note: 'x'.repeat(9_000_000) }] } }));
    expect(tooLarge).toBe('Metadata sumber tidak valid: Proyeksi finansial v1 (maksimal 8 MB): batas ukuran UTF-8 terlampaui sebelum materialisasi.');
    expect(describeFailure(tooLarge)).toEqual({ message: LEDGER_TOO_LARGE, detail: '' });
    expect(LEDGER_TOO_LARGE).toBe('Catatan sudah mencapai batas ukuran 8 MB, jadi perubahan ini tidak disimpan. Catatan yang sudah tersimpan tetap utuh.');
    // The codec's two size refusals need a ledger of several megabytes with metadata to throw; their wording is
    // read from the codec instead, so a reworded refusal cannot slip back to the generic sentence unnoticed.
    const codec = readFileSync(fileURLToPath(new URL('./sourceCodec.ts', import.meta.url)), 'utf8');
    for (const reason of ['Proyeksi finansial melebihi 8 MiB sebelum materialisasi.', 'Ukuran format sumber melebihi 8 MiB (8.388.608 byte UTF-8).']) {
      expect(codec).toContain(`'${reason}'`);
      expect(describeFailure(`${SOURCE_ERROR_PREFIX}${reason}`)).toEqual({ message: LEDGER_TOO_LARGE, detail: '' });
    }
    // A reason that merely matches an object member name is not treated as a known one.
    expect(describeFailure('Metadata sumber tidak valid: constructor')).toEqual({ message: VALIDATION_REFUSED, detail: 'constructor' });
  });

  it('gives the cause as a clause for the middle of a sentence, without validator wording', () => {
    // The category-rename toast: "… belum ikut berganti: <clause>. Catatan itu tetap memakai nama lama …".
    const tooLarge = thrown(() => validateSourceDocument({ app: 'uangku', version: 1, demo: false, state: { version: 1, wallets: [wallet(1)],
      entries: [{ id: 'e', date: '2026-10-01', type: 'expense', walletId: 'w1', amount: 1, category: 'Belanja', note: 'x'.repeat(9_000_000) }] } }));
    expect(failureClause(tooLarge)).toEqual({ clause: 'catatan sudah mencapai batas ukuran 8 MB', detail: '' });
    expect(failureClause('Metadata sumber tidak valid: Daftar dompet maksimal 100 dompet.')).toEqual({ clause: 'jumlah dompet sudah mencapai batas 100', detail: '' });
    // Any other refusal: a plain clause, with the validator's reason kept for "Detail teknis".
    expect(failureClause('Metadata sumber tidak valid: Entry creation origin tidak ditemukan.')).toEqual({ clause: 'perubahan itu ditolak oleh pemeriksaan data', detail: 'Entry creation origin tidak ditemukan.' });
    // Text that is not the validator's passes through, without a full stop of its own to double the sentence's.
    expect(failureClause('penyimpanan catatan belum berhasil')).toEqual({ clause: 'penyimpanan catatan belum berhasil', detail: '' });
    expect(failureClause('Template belum bisa disimpan.')).toEqual({ clause: 'Template belum bisa disimpan', detail: '' });
    for (const text of ['Metadata sumber tidak valid: x', 'Metadata sumber tidak valid: Daftar transaksi maksimal 100.000 transaksi.', tooLarge]) {
      expect(failureClause(text).clause).not.toMatch(/Metadata sumber|[.]$|^[A-Z]/);
    }
  });
});
