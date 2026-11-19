/**
 * Turns an error text into what the user is shown. Text from the data validator is internal wording:
 * it becomes one plain sentence, with the validator's own reason kept as a detail that can be opened.
 * Every other text already speaks to the user and passes through unchanged.
 */
import { SOURCE_ERROR_PREFIX } from './sourceModel';

export const VALIDATION_REFUSED = 'Tindakan ini ditolak oleh pemeriksaan data, jadi tidak ada yang disimpan atau diubah.';

/** What stopped the action, and what that meant for it. Shown as "<cause>, jadi <effect>". */
type Plain = { cause: string; effect: string };
/** The ledger has grown to the validator's 8 MiB limit. A growing ledger gets there long before the 100.000-transaction limit. */
const TOO_LARGE: Plain = { cause: 'Catatan sudah mencapai batas ukuran 8 MB', effect: 'perubahan ini tidak disimpan. Catatan yang sudah tersimpan tetap utuh.' };

/** Validator reasons a user can reach on their own; these get their own sentence instead of a detail. */
const PLAIN_REASONS: Readonly<Record<string, Plain>> = {
  'Daftar dompet maksimal 100 dompet.': { cause: 'Jumlah dompet sudah mencapai batas 100', effect: 'dompet baru tidak disimpan.' },
  'Daftar transaksi maksimal 100.000 transaksi.': { cause: 'Jumlah transaksi sudah mencapai batas 100.000', effect: 'perubahan ini tidak disimpan.' },
  'Proyeksi finansial v1 (maksimal 8 MB): batas ukuran UTF-8 terlampaui sebelum materialisasi.': TOO_LARGE,
  'Proyeksi finansial melebihi 8 MiB sebelum materialisasi.': TOO_LARGE,
  'Ukuran format sumber melebihi 8 MiB (8.388.608 byte UTF-8).': TOO_LARGE,
};
export const LEDGER_TOO_LARGE = `${TOO_LARGE.cause}, jadi ${TOO_LARGE.effect}`;

function validatorReason(text: string): { reason: string; plain?: Plain } | undefined {
  if (!text.startsWith(SOURCE_ERROR_PREFIX)) return undefined;
  const reason = text.slice(SOURCE_ERROR_PREFIX.length).trim();
  return { reason, plain: Object.hasOwn(PLAIN_REASONS, reason) ? PLAIN_REASONS[reason] : undefined };
}

export function describeFailure(text: string): { message: string; detail: string } {
  const found = validatorReason(text);
  if (!found) return { message: text, detail: '' };
  return found.plain ? { message: `${found.plain.cause}, jadi ${found.plain.effect}`, detail: '' } : { message: VALIDATION_REFUSED, detail: found.reason };
}

/**
 * The same failure as the cause inside a longer sentence ("… belum ikut berganti: <clause>.").
 * Validator wording becomes a clause without a capital or a full stop, and says nothing about what
 * was or was not saved, because the sentence around it does. Other text only loses its full stop.
 */
export function failureClause(text: string): { clause: string; detail: string } {
  const found = validatorReason(text);
  if (!found) return { clause: text.replace(/[.\s]+$/, ''), detail: '' };
  if (!found.plain) return { clause: 'perubahan itu ditolak oleh pemeriksaan data', detail: found.reason };
  return { clause: found.plain.cause.charAt(0).toLowerCase() + found.plain.cause.slice(1), detail: '' };
}
