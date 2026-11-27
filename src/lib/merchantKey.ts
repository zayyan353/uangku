import { normalizeBankDescription } from './bankDescription';
import { explicitMerchant } from './bankEntryHints';

/** A comparison key for suggestions and reports. Bank descriptions and source IDs stay intact. */
export function merchantKey(description: string): string {
  const [operation, party, ...details] = description.split(' · ');
  const bankMerchant = explicitMerchant(description);
  let text = bankMerchant ?? description;
  if (!bankMerchant && /\b(?:isyeri|işyeri)\b/u.test(normalizeBankDescription(description))) return '';
  if (operation === 'Transaksi POS') text = party ?? '';
  if (operation === 'Pembayaran dengan Jago Pay') {
    if (normalizeBankDescription(party ?? '') === 'gopay') {
      const food = details.find(part => /\bgo-food/i.test(part));
      text = food?.replace(/^.*?\bgo-food\s*/i, '') ?? '';
    } else text = party ?? '';
  }

  // Strip the punctuation-dependent fields before the ordinary bank wording normalizer.
  text = text.replace(/#F-\d+\b/gi, ' ')
    .replace(/(?:[•*]{2,}\s*)+\d{2,4}\b/gu, ' ')
    .replace(/\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/g, ' ')
    .replace(/\b\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\b/g, ' ')
    .replace(/\b\d{5,}\b/g, ' ');
  const key = normalizeBankDescription(text);
  return /\p{L}/u.test(key) ? key : '';
}
