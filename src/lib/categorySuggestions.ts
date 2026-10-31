import { createCategoryMatcher, type CategoryMatch } from './categorization';
import { isUncategorized, type CategorySettings } from './categorySettings';
import { entrySignedAmount, type Entry } from './finance';
import type { SourceDocument } from './sourceModel';
import { confirmedBankEntryType, interpretBankDescription, type BankDescriptionInterpretation } from './bankDescription';
import { archivedReadOnlyEntryIds } from './walletLifecycle';

export function createCategorySuggester(settings: CategorySettings) {
  const matcher = createCategoryMatcher(settings.rules, settings.names);
  return (text: string, type: Entry['type'], signedAmount?: number): CategoryMatch => {
    if (type === 'transfer' || type === 'adjustment') return { kind: 'none', suggestions: [] };
    const result = matcher(text, { signedAmount });
    const known = signedAmount !== undefined && confirmedBankEntryType(text, signedAmount) !== undefined;
    // Only the explicitly approved bank operations may confirm old unresolved
    // rows. A merchant name alone never proves income or expense.
    return type === 'unreviewed' && !known && result.kind === 'auto' ? { ...result, kind: 'suggestions' } : result;
  };
}
export function categorySuggestion(text: string, type: Entry['type'], settings: CategorySettings, signedAmount?: number): CategoryMatch {
  return createCategorySuggester(settings)(text, type, signedAmount);
}
export interface EntryCategorySuggestion { entry: Entry; match: CategoryMatch; bank: BankDescriptionInterpretation; confirmation?: 'movement' | 'income' | 'expense' }
/** Existing confirmed types stay authoritative. The sole reviewed exception is
 * the old ATM movement policy, now explicitly mapped to bank income/expense.
 * Callers exclude archived cash and paired entries using the full wallet state.
 */
export function bankTypeConfirmation(entry: Entry, description: string): 'movement' | 'income' | 'expense' | undefined {
  const signedAmount = entrySignedAmount(entry);
  const type = confirmedBankEntryType(description, signedAmount);
  if (entry.type === 'unreviewed') return type;
  if (entry.type !== 'movement') return undefined;
  const bank = interpretBankDescription(description, { signedAmount });
  if (bank.kind === 'atm-withdrawal' && signedAmount < 0 && type === 'expense') return 'expense';
  if (bank.kind === 'atm-deposit' && signedAmount > 0 && type === 'income') return 'income';
  return undefined;
}
/** Source wording always wins, including an intentionally blank description. */
export function entrySourceDescriptions(data: SourceDocument): Map<string, string> {
  const facts = new Map((data.metadata?.facts ?? []).map(fact => [fact.id, fact.description]));
  const descriptions = new Map<string, string>();
  for (const link of data.metadata?.links ?? []) {
    const parts = [link.source, link.destination].flatMap(id => id && facts.has(id) ? [facts.get(id)!] : []);
    if (parts.length) descriptions.set(link.entryId, parts.join(' '));
  }
  return descriptions;
}
/** Build a read-only proposal. No financial record is changed until Apply. */
export function entryCategorySuggestions(data: SourceDocument, settings: CategorySettings): EntryCategorySuggestion[] {
  const suggest = createCategorySuggester(settings), descriptions = entrySourceDescriptions(data);
  const cash = new Set(data.state.wallets.filter(wallet => wallet.kind === 'cash').map(wallet => wallet.id));
  const archivedEntries = archivedReadOnlyEntryIds(data);
  return data.state.entries.flatMap(entry => {
    if (entry.type === 'transfer' || entry.type === 'adjustment' || cash.has(entry.walletId) || !!entry.toWalletId && cash.has(entry.toWalletId) || archivedEntries.has(entry.id)) return [];
    const description = descriptions.has(entry.id) ? descriptions.get(entry.id)! : entry.note;
    const signedAmount = entrySignedAmount(entry);
    const confirmation = bankTypeConfirmation(entry, description);
    if (!isUncategorized(entry.category) && !confirmation) return [];
    const match = !isUncategorized(entry.category) ? { kind: 'auto' as const, suggestions: [{ category: entry.category, reason: 'Kategori manual dipertahankan', ruleId: 'retained-manual-category' }] }
      : suggest(description, entry.type, signedAmount);
    if (match.kind === 'none' && !confirmation) return [];
    return [{ entry, match, bank: interpretBankDescription(description, { signedAmount }), ...(confirmation ? { confirmation } : {}) }];
  });
}
