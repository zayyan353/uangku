import { CATEGORY_SETTINGS_LIMIT, validateCategorySettings, type CategorySettings } from './categorySettings';
import { assertJsonBudget, utf8Bytes } from './jsonBudget';
import { BUDGETS_LIMIT, isEmptyBudgets, validateBudgets, type BudgetMap } from './budgets';
import { sourceKeys } from './sourceModel';
import { MAX_RESTORE_BYTES, serializeBackup, validateBackup, type StoredData } from './storage';

const FULL_BACKUP_APP = 'uangku-full-backup';
const FULL_BACKUP_FIELDS = ['app', 'version', 'ledger', 'categorySettings'] as const;
// Optional and written only when non-empty, so files without budgets stay
// byte-identical to earlier backups and readable by earlier app versions.
const FULL_BACKUP_OPTIONAL = ['budgets'] as const;

export type RestoreFile =
  | { kind: 'ledger'; ledger: StoredData }
  /** budgets is undefined when the file has no budget section (older backups). */
  | { kind: 'full'; ledger: StoredData; categorySettings: CategorySettings; budgets?: BudgetMap };

export function serializeFullBackup(ledger: StoredData, categorySettings: CategorySettings, budgets: BudgetMap = {}): string {
  const settings = validateCategorySettings(categorySettings);
  const validBudgets = validateBudgets(budgets);
  const budgetSection = isEmptyBudgets(validBudgets) ? '' : `,"budgets":${JSON.stringify(validBudgets)}`;
  // Embed the existing financial wire JSON directly, including its codec version.
  return `{"app":"${FULL_BACKUP_APP}","version":1,"ledger":${serializeBackup(ledger)},"categorySettings":${JSON.stringify(settings)}${budgetSection}}`;
}

/** Decode both sections before any caller can offer to apply the restore. */
export function parseRestoreFile(text: string): RestoreFile {
  if (text.length > MAX_RESTORE_BYTES || utf8Bytes(text) > MAX_RESTORE_BYTES) {
    throw new Error('Ukuran mentah file pemulihan maksimal 32 MiB.');
  }
  const file = JSON.parse(text);
  if (file?.app !== FULL_BACKUP_APP) return { kind: 'ledger', ledger: validateBackup(file) };

  const full = sourceKeys(file, [...FULL_BACKUP_FIELDS, ...FULL_BACKUP_OPTIONAL], FULL_BACKUP_FIELDS, 'cadangan lengkap');
  if (full.version !== 1) throw new Error('Versi cadangan lengkap belum didukung.');
  assertJsonBudget(full.categorySettings, CATEGORY_SETTINGS_LIMIT, 'pengaturan kategori cadangan');
  const categorySettings = validateCategorySettings(full.categorySettings);
  let budgets: BudgetMap | undefined;
  if (Object.hasOwn(full, 'budgets')) {
    assertJsonBudget(full.budgets, BUDGETS_LIMIT, 'anggaran cadangan');
    budgets = validateBudgets(full.budgets);
  }
  return { kind: 'full', ledger: validateBackup(full.ledger), categorySettings, ...(budgets ? { budgets } : {}) };
}
