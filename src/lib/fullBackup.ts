import { CATEGORY_SETTINGS_LIMIT, readCategorySettings, validateCategorySettings, type CategorySettings } from './categorySettings';
import { assertJsonBudget, utf8Bytes } from './jsonBudget';
import { BUDGETS_LIMIT, isEmptyBudgets, validateBudgets, type BudgetMap } from './budgets';
import { TEMPLATES_LIMIT, validateTemplates, type TransactionTemplate } from './transactionTemplates';
import { NewerVersionError, rejectNewerVersion } from './newerVersion';
import { MULTICURRENCY_SOURCE_CODEC } from './sourceCodec';
import { sourceKeys } from './sourceModel';
import { MAX_RESTORE_BYTES, serializeBackup, validateBackup, type StoredData } from './storage';

const FULL_BACKUP_APP = 'uangku-full-backup';
const FULL_BACKUP_FIELDS = ['app', 'version', 'ledger', 'categorySettings'] as const;
// Optional and written only when non-empty, so files without budgets or
// templates stay byte-identical to earlier backups.
const FULL_BACKUP_OPTIONAL = ['budgets', 'templates'] as const;

export type RestoreFile =
  | { kind: 'ledger'; ledger: StoredData }
  /** budgets/templates are undefined when the file has no such section (older backups). */
  | { kind: 'full'; ledger: StoredData; categorySettings: CategorySettings; budgets?: BudgetMap; templates?: TransactionTemplate[] };

export function serializeFullBackup(ledger: StoredData, categorySettings: CategorySettings, budgets: BudgetMap = {},
  templates: readonly TransactionTemplate[] = []): string {
  const settings = validateCategorySettings(categorySettings);
  const validBudgets = validateBudgets(budgets);
  const budgetSection = isEmptyBudgets(validBudgets) ? '' : `,"budgets":${JSON.stringify(validBudgets)}`;
  const validTemplates = validateTemplates(templates);
  const templateSection = validTemplates.length ? `,"templates":${JSON.stringify(validTemplates)}` : '';
  // Embed the existing financial wire JSON directly, including its codec version.
  return `{"app":"${FULL_BACKUP_APP}","version":1,"ledger":${serializeBackup(ledger)},"categorySettings":${JSON.stringify(settings)}${budgetSection}${templateSection}}`;
}

/** A refusal whose own text already tells the user what is wrong; it is shown as it is. */
export class RestoreRefusal extends Error {}

export const UNREADABLE_RESTORE_FILE = 'File ini bukan cadangan Uangku yang bisa dibaca. Pilih file uangku-lengkap-….json atau uangku-cadangan-….json.';

/**
 * What to show when a chosen restore file was refused. Parser and validator text is internal wording,
 * often English: it is kept as a detail the user can open, never shown as the message.
 */
export function restoreFailure(reason: unknown): { message: string; detail: string } {
  if (reason instanceof RestoreRefusal || reason instanceof NewerVersionError) return { message: reason.message, detail: '' };
  return { message: UNREADABLE_RESTORE_FILE, detail: reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '' };
}

/** Check the version on either a standalone ledger or the ledger inside a full file. */
function readLedgerFile(value: unknown): StoredData {
  if (value && typeof value === 'object' && 'app' in value && value.app === 'uangku' && 'version' in value) {
    rejectNewerVersion(value.version, 3);
    if (value.version === 2 && 'codec' in value && typeof value.codec === 'string') {
      const version = /^table-tuples-v([1-9]\d*)$/.exec(value.codec);
      if (version) rejectNewerVersion(Number(version[1]), Number(MULTICURRENCY_SOURCE_CODEC.split('-v')[1]));
    }
    if ((value.version === 1 || value.version === 3) && 'state' in value) {
      const state = value.state;
      if (state && typeof state === 'object' && 'version' in state) rejectNewerVersion(state.version, 1);
    }
  }
  return validateBackup(value);
}

/** Decode both sections before any caller can offer to apply the restore. */
export function parseRestoreFile(text: string): RestoreFile {
  if (text.length > MAX_RESTORE_BYTES || utf8Bytes(text) > MAX_RESTORE_BYTES) {
    throw new RestoreRefusal('Ukuran mentah file pemulihan maksimal 32 MiB.');
  }
  const file = JSON.parse(text);
  if (file?.app !== FULL_BACKUP_APP) return { kind: 'ledger', ledger: readLedgerFile(file) };
  rejectNewerVersion(file.version, 1);

  const full = sourceKeys(file, [...FULL_BACKUP_FIELDS, ...FULL_BACKUP_OPTIONAL], FULL_BACKUP_FIELDS, 'cadangan lengkap');
  if (full.version !== 1) throw new Error('Versi cadangan lengkap tidak valid.');
  assertJsonBudget(full.categorySettings, CATEGORY_SETTINGS_LIMIT, 'pengaturan kategori cadangan');
  const categorySettings = readCategorySettings(full.categorySettings);
  let budgets: BudgetMap | undefined;
  if (Object.hasOwn(full, 'budgets')) {
    assertJsonBudget(full.budgets, BUDGETS_LIMIT, 'anggaran cadangan');
    budgets = validateBudgets(full.budgets);
  }
  let templates: TransactionTemplate[] | undefined;
  if (Object.hasOwn(full, 'templates')) {
    assertJsonBudget(full.templates, TEMPLATES_LIMIT, 'template cadangan');
    templates = validateTemplates(full.templates);
  }
  return { kind: 'full', ledger: readLedgerFile(full.ledger), categorySettings, ...(budgets ? { budgets } : {}), ...(templates ? { templates } : {}) };
}
