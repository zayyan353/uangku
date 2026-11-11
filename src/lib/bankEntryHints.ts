import { entrySignedAmount, type Entry } from './finance';
import type { SourceDocument, SourceFact } from './sourceModel';
import { interpretBankDescription, type BankDescriptionInterpretation } from './bankDescription';
import { entryFingerprintVersion, indexBankWording } from './bankWording';

export interface BankEntryPresentation {
  bank: BankDescriptionInterpretation;
  /** Friendly operation/merchant title, or the user's unchanged custom memo. */
  title: string;
  /** Original linked bank wording, including a captured blank value. */
  description: string;
  /** Only the explicitly labelled merchant; this does not identify goods sold. */
  merchant?: string;
  noteIsCustom: boolean;
}

/** Extract a bank-labelled merchant without treating its name as an operation. */
function explicitMerchant(description: string, fingerprintVersion?: SourceFact['fingerprintVersion']): string | undefined {
  if (fingerprintVersion === 'generic-v1') return undefined;
  const markers = [...description.matchAll(/(?:^|[\s;])[İIıi][ŞSsş][Yy][Ee][Rr][İIıi]\s*:\s*/gu)];
  if (markers.length !== 1) return undefined;
  const marker = markers[0];
  const rest = description.slice(marker.index! + marker[0].length);
  const end = rest.search(/(?:^|\s)MUTABAKAT\s*:/iu);
  const merchant = (end < 0 ? rest : rest.slice(0, end)).trim().replace(/\s+/g, ' ');
  return merchant || undefined;
}

const typeTitle = { expense: 'Pengeluaran', income: 'Pemasukan', transfer: 'Transfer', movement: 'Transfer bank',
  adjustment: 'Penyesuaian saldo', unreviewed: 'Mutasi belum dikonfirmasi' } as const;

/** Preview-only source presentation; no synthetic book entry is required. */
export function presentBankDescription(description: string, signedAmount: number, fingerprintVersion?: SourceFact['fingerprintVersion']): BankEntryPresentation & { noteIsCustom: false } {
  const bank = interpretBankDescription(description, { signedAmount, fingerprintVersion });
  const merchant = explicitMerchant(description, fingerprintVersion);
  const title = bank.kind !== 'none' ? `${bank.label}${merchant ? ` · ${merchant}` : ''}` : description || 'Mutasi belum dikonfirmasi';
  return { bank, title, description, ...(merchant ? { merchant } : {}), noteIsCustom: false };
}

/** A view-only index. Original source descriptions outrank editable notes. */
export function createBankEntryHintLookup(data: SourceDocument) {
  const descriptions = indexBankWording(data, '\n\n');
  return (entry: Entry) => {
    const source = descriptions.get(entry.id);
    return interpretBankDescription(entry.type === 'transfer' || entry.type === 'adjustment' ? '' : source?.description ?? entry.note,
      { signedAmount: entrySignedAmount(entry), fingerprintVersion: entryFingerprintVersion(entry, source) });
  };
}

/** Read-only presentation. Source wording and user notes remain separate. */
export function createBankEntryPresentationLookup(data: SourceDocument) {
  const descriptions = indexBankWording(data, '\n\n');
  return (entry: Entry): BankEntryPresentation => {
    const source = descriptions.get(entry.id);
    const description = source?.description ?? entry.note;
    const fingerprintVersion = entryFingerprintVersion(entry, source);
    // The importer trims leading/trailing whitespace in the book memo, while
    // the immutable source retains those characters. That is not a user edit.
    const noteIsCustom = !!source && entry.note.trim() !== description.trim();
    const bank = interpretBankDescription(entry.type === 'transfer' || entry.type === 'adjustment' ? '' : description,
      { signedAmount: entrySignedAmount(entry), fingerprintVersion });
    const merchant = explicitMerchant(description, fingerprintVersion);
    const title = noteIsCustom && entry.note.trim() ? entry.note : bank.kind !== 'none'
      ? `${bank.label}${merchant ? ` · ${merchant}` : ''}` : entry.note || description || typeTitle[entry.type];
    return { bank, title, description, ...(merchant ? { merchant } : {}), noteIsCustom };
  };
}

const TITLE_CACHE_LIMIT = 20_000;
const titleCache = new Map<string, string>();
/**
 * On-screen titles for search. Working a title out of the bank's wording is the costly part, so results are kept
 * by everything the title depends on; an edit to one entry then re-derives that entry only.
 */
export function createBankEntryTitleLookup(data: SourceDocument) {
  const descriptions = indexBankWording(data, '\n\n');
  const present = createBankEntryPresentationLookup(data);
  return (entry: Entry): string => {
    const source = descriptions.get(entry.id);
    // Without bank wording the title is the stored note, which the search index already holds.
    if (!source) return '';
    const key = [entry.type, entrySignedAmount(entry), entryFingerprintVersion(entry, source), entry.note, source.description].join('\u0001');
    let title = titleCache.get(key);
    if (title === undefined) {
      if (titleCache.size >= TITLE_CACHE_LIMIT) titleCache.clear();
      title = present(entry).title;
      titleCache.set(key, title);
    }
    return title;
  };
}
