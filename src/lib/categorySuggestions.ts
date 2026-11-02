import { createCategoryMatcher, type CategoryMatch } from './categorization';
import { isUncategorized, type CategorySettings } from './categorySettings';
import { entrySignedAmount, type Entry } from './finance';
import type { SourceDocument, SourceFact } from './sourceModel';
import { entryFingerprintVersion, indexBankWording } from './bankWording';
import { confirmedBankEntryType, interpretBankDescription, type BankDescriptionInterpretation } from './bankDescription';
import { archivedReadOnlyEntryIds } from './walletLifecycle';

export function createCategorySuggester(settings: CategorySettings) {
  const matcher = createCategoryMatcher(settings.rules, settings.names);
  return (text: string, type: Entry['type'], signedAmount?: number, fingerprintVersion?: SourceFact['fingerprintVersion']): CategoryMatch => {
    if (type === 'transfer' || type === 'adjustment') return { kind: 'none', suggestions: [] };
    const result = matcher(text, { signedAmount, fingerprintVersion });
    const known = signedAmount !== undefined && confirmedBankEntryType(text, signedAmount, fingerprintVersion) !== undefined;
    // Only the explicitly approved bank operations may confirm old unresolved
    // rows. A merchant name alone never proves income or expense.
    return type === 'unreviewed' && !known && result.kind === 'auto' ? { ...result, kind: 'suggestions' } : result;
  };
}
export function categorySuggestion(text: string, type: Entry['type'], settings: CategorySettings, signedAmount?: number, fingerprintVersion?: SourceFact['fingerprintVersion']): CategoryMatch {
  return createCategorySuggester(settings)(text, type, signedAmount, fingerprintVersion);
}
export interface EntryCategorySuggestion { entry: Entry; match: CategoryMatch; bank: BankDescriptionInterpretation; confirmation?: 'movement' | 'income' | 'expense' }
/** Existing confirmed types stay authoritative. The sole reviewed exception is
 * the old ATM movement policy, now explicitly mapped to bank income/expense.
 * Callers exclude archived cash and paired entries using the full wallet state.
 */
export function bankTypeConfirmation(entry: Entry, description: string, fingerprintVersion = entryFingerprintVersion(entry)): 'movement' | 'income' | 'expense' | undefined {
  const signedAmount = entrySignedAmount(entry);
  const type = confirmedBankEntryType(description, signedAmount, fingerprintVersion);
  if (entry.type === 'unreviewed') return type;
  if (entry.type !== 'movement') return undefined;
  const bank = interpretBankDescription(description, { signedAmount, fingerprintVersion });
  if (bank.kind === 'atm-withdrawal' && signedAmount < 0 && type === 'expense') return 'expense';
  if (bank.kind === 'atm-deposit' && signedAmount > 0 && type === 'income') return 'income';
  return undefined;
}
/** Build a read-only proposal. No financial record is changed until Apply. */
export function entryCategorySuggestions(data: SourceDocument, settings: CategorySettings): EntryCategorySuggestion[] {
  const suggest = createCategorySuggester(settings), wording = indexBankWording(data);
  const cash = new Set(data.state.wallets.filter(wallet => wallet.kind === 'cash').map(wallet => wallet.id));
  const archivedEntries = archivedReadOnlyEntryIds(data);
  return data.state.entries.flatMap(entry => {
    if (entry.type === 'transfer' || entry.type === 'adjustment' || cash.has(entry.walletId) || !!entry.toWalletId && cash.has(entry.toWalletId) || archivedEntries.has(entry.id)) return [];
    const source = wording.get(entry.id), description = source?.description ?? entry.note;
    const fingerprintVersion = entryFingerprintVersion(entry, source);
    const signedAmount = entrySignedAmount(entry);
    const confirmation = bankTypeConfirmation(entry, description, fingerprintVersion);
    if (!isUncategorized(entry.category) && !confirmation) return [];
    const match = !isUncategorized(entry.category) ? { kind: 'auto' as const, suggestions: [{ category: entry.category, reason: 'Kategori manual dipertahankan', ruleId: 'retained-manual-category' }] }
      : suggest(description, entry.type, signedAmount, fingerprintVersion);
    if (match.kind === 'none' && !confirmation) return [];
    return [{ entry, match, bank: interpretBankDescription(description, { signedAmount, fingerprintVersion }), ...(confirmation ? { confirmation } : {}) }];
  });
}
