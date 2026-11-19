import { describe, expect, it } from 'vitest';
import { describeFailure, VALIDATION_REFUSED } from './failureText';
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
    // Only a text that starts with the validator's prefix is the validator's.
    expect(describeFailure(`Nama kategori sudah tersimpan, tetapi: ${SOURCE_ERROR_PREFIX}x`).detail).toBe('');
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
    // A reason that merely matches an object member name is not treated as a known one.
    expect(describeFailure('Metadata sumber tidak valid: constructor')).toEqual({ message: VALIDATION_REFUSED, detail: 'constructor' });
  });
});
