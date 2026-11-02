import { CATEGORY_SETTINGS_LIMIT, validateCategorySettings, type CategorySettings } from './categorySettings';
import { assertJsonBudget, utf8Bytes } from './jsonBudget';
import { sourceKeys } from './sourceModel';
import { MAX_RESTORE_BYTES, serializeBackup, validateBackup, type StoredData } from './storage';

const FULL_BACKUP_APP = 'uangku-full-backup';
const FULL_BACKUP_FIELDS = ['app', 'version', 'ledger', 'categorySettings'] as const;

export type RestoreFile =
  | { kind: 'ledger'; ledger: StoredData }
  | { kind: 'full'; ledger: StoredData; categorySettings: CategorySettings };

export function serializeFullBackup(ledger: StoredData, categorySettings: CategorySettings): string {
  const settings = validateCategorySettings(categorySettings);
  // Embed the existing financial wire JSON directly, including its codec version.
  return `{"app":"${FULL_BACKUP_APP}","version":1,"ledger":${serializeBackup(ledger)},"categorySettings":${JSON.stringify(settings)}}`;
}

/** Decode both sections before any caller can offer to apply the restore. */
export function parseRestoreFile(text: string): RestoreFile {
  if (text.length > MAX_RESTORE_BYTES || utf8Bytes(text) > MAX_RESTORE_BYTES) {
    throw new Error('Ukuran mentah file pemulihan maksimal 32 MiB.');
  }
  const file = JSON.parse(text);
  if (file?.app !== FULL_BACKUP_APP) return { kind: 'ledger', ledger: validateBackup(file) };

  const full = sourceKeys(file, FULL_BACKUP_FIELDS, FULL_BACKUP_FIELDS, 'cadangan lengkap');
  if (full.version !== 1) throw new Error('Versi cadangan lengkap belum didukung.');
  assertJsonBudget(full.categorySettings, CATEGORY_SETTINGS_LIMIT, 'pengaturan kategori cadangan');
  const categorySettings = validateCategorySettings(full.categorySettings);
  return { kind: 'full', ledger: validateBackup(full.ledger), categorySettings };
}
