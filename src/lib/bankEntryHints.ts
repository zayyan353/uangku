import { entrySignedAmount, type Entry } from './finance';
import type { SourceDocument } from './sourceModel';
import { interpretBankDescription, type BankDescriptionInterpretation } from './bankDescription';

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

function sourceDescriptions(data: SourceDocument): Map<string, string> {
  const facts = new Map((data.metadata?.facts ?? []).map(fact => [fact.id, fact.description]));
  const descriptions = new Map<string, string>();
  for (const link of data.metadata?.links ?? []) {
    const parts = [link.source, link.destination].flatMap(id => id && facts.has(id) ? [facts.get(id)!] : []);
    if (parts.length) descriptions.set(link.entryId, parts.join('\n\n'));
  }
  return descriptions;
}

/** Extract a bank-labelled merchant without treating its name as an operation. */
function explicitMerchant(description: string): string | undefined {
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
export function presentBankDescription(description: string, signedAmount: number): BankEntryPresentation & { noteIsCustom: false } {
  const bank = interpretBankDescription(description, { signedAmount });
  const merchant = explicitMerchant(description);
  const title = bank.kind !== 'none' ? `${bank.label}${merchant ? ` · ${merchant}` : ''}` : description || 'Mutasi belum dikonfirmasi';
  return { bank, title, description, ...(merchant ? { merchant } : {}), noteIsCustom: false };
}

/** A view-only index. Original source descriptions outrank editable notes. */
export function createBankEntryHintLookup(data: SourceDocument) {
  const descriptions = sourceDescriptions(data);
  return (entry: Entry) => interpretBankDescription(entry.type === 'transfer' || entry.type === 'adjustment' ? ''
    : descriptions.has(entry.id) ? descriptions.get(entry.id)! : entry.note, { signedAmount: entrySignedAmount(entry) });
}

/** Read-only presentation. Source wording and user notes remain separate. */
export function createBankEntryPresentationLookup(data: SourceDocument) {
  const descriptions = sourceDescriptions(data);
  return (entry: Entry): BankEntryPresentation => {
    const linked = descriptions.has(entry.id);
    const description = linked ? descriptions.get(entry.id)! : entry.note;
    // The importer trims leading/trailing whitespace in the book memo, while
    // the immutable source retains those characters. That is not a user edit.
    const noteIsCustom = linked && entry.note.trim() !== description.trim();
    const bank = interpretBankDescription(entry.type === 'transfer' || entry.type === 'adjustment' ? '' : description,
      { signedAmount: entrySignedAmount(entry) });
    const merchant = explicitMerchant(description);
    const title = noteIsCustom && entry.note.trim() ? entry.note : bank.kind !== 'none'
      ? `${bank.label}${merchant ? ` · ${merchant}` : ''}` : entry.note || description || typeTitle[entry.type];
    return { bank, title, description, ...(merchant ? { merchant } : {}), noteIsCustom };
  };
}
