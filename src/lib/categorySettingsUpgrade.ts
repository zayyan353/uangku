import { mergeCategoryKeywordPack } from './categoryKeywordPack';
import { validateCategorySettings, type CategorySettings } from './categorySettings';
import { CONFIRMED_CATEGORY_NAMES } from './categoryKeywordDefinitions';
import { mergeConfirmedCategoryMappings } from './categoryConfirmedMappings';
import { BANK_CATEGORY_NAMES, mergeBankCategoryMappings } from './categoryBankMappings';
import { mergeAutomaticBankMappings, mergeReviewCompletionMappings } from './bankAutoMappings';

/** Effective additions only: the caller retains the original raw CAS token.
 * An explicit settings save records the marker, making manual removal durable.
 */
export function upgradeCategorySettings(value: CategorySettings): { settings: CategorySettings; added: number; error: string; updated?: number } {
  const checked = validateCategorySettings(value);
  if (checked.keywordPackVersion === 5) return { settings: value, added: 0, error: '' };
  try {
    // A saved v1 profile may deliberately omit rules from the previous pack.
    // Only profiles predating that pack receive its original additions.
    const previous = checked.keywordPackVersion ? { settings: checked, added: 0 } : mergeCategoryKeywordPack(checked);
    const names = [...previous.settings.names];
    const version = checked.keywordPackVersion ?? 0;
    for (const name of [...(version < 2 ? CONFIRMED_CATEGORY_NAMES : []), ...(version < 3 ? BANK_CATEGORY_NAMES : [])]) {
      if (!names.some(existing => existing.normalize('NFC').toLocaleLowerCase('id-ID') === name.toLocaleLowerCase('id-ID'))) names.push(name);
    }
    const named = { ...previous.settings, names };
    const confirmed = version < 2 ? mergeConfirmedCategoryMappings(named) : { settings: named, added: 0, updated: 0 };
    const bank = version < 3 ? mergeBankCategoryMappings(confirmed.settings) : { settings: confirmed.settings, added: 0 };
    const automatic = version < 4 ? mergeAutomaticBankMappings(bank.settings) : { settings: bank.settings, added: 0, updated: 0 };
    const completion = mergeReviewCompletionMappings(automatic.settings);
    const settings = validateCategorySettings({ ...completion.settings, keywordPackVersion: 5 });
    const updated = confirmed.updated + automatic.updated;
    return { settings, added: previous.added + confirmed.added + bank.added + automatic.added + completion.added, error: '', ...(updated ? { updated } : {}) };
  } catch (error) {
    return { settings: value, added: 0, error: `Kata kunci tambahan belum diaktifkan: ${error instanceof Error ? error.message : 'batas pengaturan tercapai'}. Pengaturan lama tetap dipakai.` };
  }
}
