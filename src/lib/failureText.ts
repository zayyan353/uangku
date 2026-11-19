/**
 * Turns an error text into what the user is shown. Text from the data validator is internal wording:
 * it becomes one plain sentence, with the validator's own reason kept as a detail that can be opened.
 * Every other text already speaks to the user and passes through unchanged.
 */
import { SOURCE_ERROR_PREFIX } from './sourceModel';

export const VALIDATION_REFUSED = 'Tindakan ini ditolak oleh pemeriksaan data, jadi tidak ada yang disimpan atau diubah.';

/** Validator reasons a user can reach on their own and act on; these get their own sentence instead of a detail. */
const PLAIN_REASONS: Readonly<Record<string, string>> = {
  'Daftar dompet maksimal 100 dompet.': 'Jumlah dompet sudah mencapai batas 100, jadi dompet baru tidak disimpan.',
  'Daftar transaksi maksimal 100.000 transaksi.': 'Jumlah transaksi sudah mencapai batas 100.000, jadi perubahan ini tidak disimpan.',
};

export function describeFailure(text: string): { message: string; detail: string } {
  if (!text.startsWith(SOURCE_ERROR_PREFIX)) return { message: text, detail: '' };
  const reason = text.slice(SOURCE_ERROR_PREFIX.length).trim();
  const plain = Object.hasOwn(PLAIN_REASONS, reason) ? PLAIN_REASONS[reason] : undefined;
  return plain ? { message: plain, detail: '' } : { message: VALIDATION_REFUSED, detail: reason };
}
