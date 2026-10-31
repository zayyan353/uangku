import { validateLegacyBackup, type LegacyData } from './legacyValidation';
import { assertPostingMonthTotals, type Currency, type Entry } from './finance';
import { assertJsonBudget, utf8Bytes } from './jsonBudget';
import { isCurrencyConversionConsistent, isCurrencyCode, LEGACY_CURRENCY_CODES } from './currencyCatalog';

/** Metadata is optional in memory; persisted metadata always uses format v2. */
export interface SourceFact {
  id: string; walletId: string; currency: Currency; postedOn: string;
  signedAmount: number; balanceAfter: number; description: string;
  fingerprintVersion: 'ziraat-v1' | 'generic-v1'; fingerprint: string; reference?: string;
}
export interface SourceLink {
  entryId: string; source?: string; destination?: string;
  postingDates?: { source: string | null; destination: string | null };
  pairing?: { sourceEntryId: string; destinationEntryId: string };
}
export interface SourceStatement {
  id: string; walletId: string; currency: Currency; periodStart: string; periodEnd: string;
  openingBalance: number; closingBalance: number; rowIds: string[];
}
export interface SourceAnnotation { sourceId: string; category?: string; note?: string; confirmedType?: 'income' | 'expense' | 'unreviewed' | 'movement'; importBatch?: string }
export interface SourceOverride { entryId: string; reason: string; at: string }
export interface SourceDisposition { sourceId: string; kind: 'excluded' | 'deleted' | 'deferred'; reason?: string; at?: string }
export interface SourceBaseline { id: string; walletId: string; boundary: { kind: 'before-source' | 'end-of-day'; date: string; sourceId?: string }; origin: 'bank' | 'manual'; status: 'confirmed' | 'provisional' }
/** Explicit E5 adoption/rebase decision for a current baseline, not a sticky reconciliation result. */
export interface SourceBaselineDecision { baselineId: string; reason: string; at: string }
export interface SourceCompletion { statementId: string; baselineId: string; sourceIds: string[]; at: string }
export interface SourceCreationOrigin { entryId: string; origin: 'manual' | 'bank' }
export interface TransferLegAnnotation { type: 'income' | 'expense' | 'unreviewed' | 'movement'; category: string; note: string; importBatch?: string }
export interface TransferDecision { reason: string; at: string }
export interface TransferPairing {
  sourceEntryId: string; destinationEntryId: string;
  sourceOrigin?: 'manual' | 'bank'; destinationOrigin?: 'manual' | 'bank';
  sourceOverride?: TransferDecision; destinationOverride?: TransferDecision;
  sourceAnnotation?: TransferLegAnnotation; destinationAnnotation?: TransferLegAnnotation;
}
/** Effective book dates, independent of immutable bank facts. Null is unknown. */
export interface TransferContext {
  entryId: string; sourceDate: string | null; destinationDate: string | null; pairing?: TransferPairing; decision?: TransferDecision;
}
/** Last explicit split interpretation, not an active financial posting or unbounded log. */
export interface TransferUnpairing {
  id: string; sourceEntryId: string; destinationEntryId: string;
  sourceWalletId: string; destinationWalletId: string; sourceDate: string; destinationDate: string;
  principal: number; toAmount: number; rate?: number; fee: number; reason: string; at: string;
  groupNote: string; pairing?: TransferPairing; source?: string; destination?: string; groupOrigin?: 'manual' | 'bank'; groupDecision?: TransferDecision;
}
/** Removed effective group, moved out of active accounting rather than duplicated. */
export interface TransferTombstone {
  entry: Entry; context?: TransferContext; link?: SourceLink; override?: TransferDecision;
  origin?: 'manual' | 'bank'; reason: string; at: string;
}
/** Availability marker only: financial records and historical report postings remain intact. */
export interface WalletArchive { walletId: string; at: string }
export interface VisibleCurrency { code: Currency }
export interface SourceMetadata {
  policy: 'unverified-unless-linked'; facts: SourceFact[]; links: SourceLink[]; statements: SourceStatement[];
  annotations?: SourceAnnotation[]; overrides?: SourceOverride[]; dispositions?: SourceDisposition[];
  baselines?: SourceBaseline[]; completions?: SourceCompletion[]; creationOrigins?: SourceCreationOrigin[];
  baselineDecisions?: SourceBaselineDecision[];
  walletArchives?: WalletArchive[];
  /** Visible list only; hidden currencies remain valid in wallets and history. */
  currencies?: VisibleCurrency[];
  transfers?: TransferContext[]; unpairings?: TransferUnpairing[]; deletedTransfers?: TransferTombstone[];
}
export interface SourceDocument extends LegacyData { metadata?: SourceMetadata }
export const SOURCE_POLICY = 'unverified-unless-linked' as const;
export const SOURCE_LIMIT = 8 * 1024 * 1024;
export const SOURCE_RAW_LIMIT = 32 * 1024 * 1024;
export const SOURCE_EXPANDED_LIMIT = 64 * 1024 * 1024;
export const SOURCE_REFERENCE_LIMIT = 200_000;
export const SOURCE_TABLE_LIMIT = 200_000;
export const SOURCE_STATEMENT_LIMIT = 10_000;
export const SOURCE_STATEMENT_ROWS = 50_000;

export const hasOwn = (value: object, key: PropertyKey): boolean => Object.hasOwn(value, key);
export const utf8Size = utf8Bytes;
export function sourceError(message: string): never { throw new Error(`Metadata sumber tidak valid: ${message}`); }
export function sourceCheck(test: unknown, message: string): asserts test { if (!test) sourceError(message); }
export type JsonRecord = Record<string, unknown>;
export function sourceRecord(value: unknown, label: string): JsonRecord {
  sourceCheck(value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)), `${label} harus berupa objek.`);
  return value as JsonRecord;
}
export function sourceKeys(value: unknown, allowed: readonly string[], required: readonly string[], label: string): JsonRecord {
  const record = sourceRecord(value, label);
  const own=Object.keys(record);
  sourceCheck(!Object.getOwnPropertySymbols(record).length&&Object.getOwnPropertyNames(record).length===own.length, `${label}: field tersembunyi atau symbol tidak didukung.`);
  for (const key of own) {
    sourceCheck(allowed.includes(key), `${label}: field ${key} tidak didukung.`);
    const field=Object.getOwnPropertyDescriptor(record,key);
    sourceCheck(field&&hasOwn(field,'value'), `${label}: accessor ${key} tidak didukung; field harus berupa nilai JSON tetap.`);
  }
  for (const key of required) sourceCheck(hasOwn(record, key), `${label}: field ${key} tidak ada.`);
  return record;
}
function text(value: unknown, label: string, max = 4_000, nonempty = false): asserts value is string {
  sourceCheck(typeof value === 'string' && value.length <= max && (!nonempty || value.trim().length > 0), `${label}: teks tidak valid (maksimal ${max}).`);
}
function id(value: unknown, label: string): asserts value is string { text(value, label, 200, true); }
function money(value: unknown, label: string): asserts value is number { sourceCheck(typeof value === 'number' && Number.isSafeInteger(value), `${label}: nominal harus berupa safe integer.`); }
function date(value: unknown, label: string): asserts value is string {
  sourceCheck(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), `${label}: tanggal kalender tidak valid.`);
  let actual = ''; try { actual = new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10); } catch { sourceError(`${label}: tanggal kalender tidak valid.`); }
  sourceCheck(actual === value, `${label}: tanggal kalender tidak valid.`);
}
function timestamp(value: unknown, label: string): asserts value is string {
  text(value, label, 80, true);
  sourceCheck(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)), `${label}: waktu keputusan tidak valid.`);
  date(value.slice(0, 10), label);
}
function array(value: unknown, label: string, max = SOURCE_TABLE_LIMIT): asserts value is unknown[] {
  sourceCheck(Array.isArray(value) && value.length <= max, `${label}: daftar melebihi batas ${max}.`);
}
function indexed<T extends object>(value: T[], key: keyof T, label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of value) { const field = row[key]; id(field, `${label}.${String(key)}`); sourceCheck(!result.has(field), `${label}: ID berulang ${field}.`); result.set(field, row); }
  return result;
}
/** Bounded UTF-8 JSON counting before allocation of an amplified full string. */
export function assertSourceJsonBudget(value: unknown, limit: number, label = 'data sumber'): number {
  return assertJsonBudget(value,limit,label);
}
export function canonicalSource(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalSource);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalSource((value as JsonRecord)[key])]));
  return value;
}

/** Validate every metadata field; no unknown field is discarded. */
export function validateSourceMetadata(financial: LegacyData, value: unknown): SourceMetadata {
  const raw = sourceKeys(value, ['policy','facts','links','statements','annotations','overrides','dispositions','baselines','completions','creationOrigins','transfers','unpairings','deletedTransfers','baselineDecisions','walletArchives','currencies'], ['policy','facts','links','statements'], 'metadata');
  sourceCheck(raw.policy === SOURCE_POLICY, 'Kebijakan sumber tidak didukung.');
  for (const [key, child] of Object.entries(raw)) if (key !== 'policy') array(child, `metadata.${key}`, key === 'statements' ? SOURCE_STATEMENT_LIMIT : key === 'baselineDecisions' || key === 'walletArchives' ? 100 : key === 'currencies' ? 200 : SOURCE_TABLE_LIMIT);
  const m = raw as unknown as SourceMetadata;
  const wallets = new Map(financial.state.wallets.map(wallet => [wallet.id, wallet]));
  const entries = new Map(financial.state.entries.map(entry => [entry.id, entry]));
  if (hasOwn(m, 'currencies')) {
    sourceCheck(m.currencies!.length > 0 && m.currencies!.length <= 200, 'Daftar mata uang terlihat harus berisi 1 sampai 200 kode.');
    const visible = new Set<string>();
    for (const row of m.currencies!) {
      sourceKeys(row, ['code'], ['code'], 'currency');
      sourceCheck(isCurrencyCode(row.code), 'Kode mata uang tidak didukung.');
      sourceCheck(!visible.has(row.code), 'Kode mata uang terlihat berulang.');
      visible.add(row.code);
    }
  }
  const archivedWalletIds = new Set<string>();
  for (const archive of m.walletArchives ?? []) {
    sourceKeys(archive, ['walletId','at'], ['walletId','at'], 'walletArchive');
    id(archive.walletId, 'walletArchive.walletId');
    const wallet = wallets.get(archive.walletId);
    sourceCheck(wallet && wallet.kind !== 'cash', 'Arsip dompet harus mengacu rekening bank atau e-wallet yang tersedia.');
    sourceCheck(!archivedWalletIds.has(archive.walletId), 'Arsip dompet berulang.');
    archivedWalletIds.add(archive.walletId);
    timestamp(archive.at, 'walletArchive.at');
    const clock = archive.at.slice(11,19).split(':').map(Number);
    sourceCheck(clock[0] < 24 && clock[1] < 60 && clock[2] < 60, 'walletArchive.at: waktu keputusan tidak valid.');
  }

  for (const fact of m.facts) {
    sourceKeys(fact, ['id','walletId','currency','postedOn','signedAmount','balanceAfter','description','reference','fingerprintVersion','fingerprint'], ['id','walletId','currency','postedOn','signedAmount','balanceAfter','description','fingerprintVersion','fingerprint'], 'fact');
    id(fact.id, 'fact.id'); id(fact.walletId, 'fact.walletId');
    sourceCheck(wallets.has(fact.walletId) && wallets.get(fact.walletId)!.currency === fact.currency, 'Dompet/mata uang fakta sumber tidak cocok.');
    date(fact.postedOn, 'fact.postedOn'); money(fact.signedAmount, 'fact.signedAmount'); money(fact.balanceAfter, 'fact.balanceAfter');
    sourceCheck(fact.signedAmount !== 0, 'Nominal fakta sumber tidak boleh nol.'); text(fact.description, 'fact.description');
    if (hasOwn(fact, 'reference')) text(fact.reference, 'fact.reference');
    sourceCheck(fact.fingerprintVersion === 'ziraat-v1' || fact.fingerprintVersion === 'generic-v1', 'Versi fingerprint sumber belum didukung.');
    const fingerprintPattern = fact.fingerprintVersion === 'ziraat-v1' ? /^ziraat:[a-f0-9]{16}$/ : /^generic:[a-f0-9]{16}$/;
    sourceCheck(typeof fact.fingerprint === 'string' && fingerprintPattern.test(fact.fingerprint), 'Fingerprint sumber tidak valid atau tidak sesuai versi.');
  }
  const facts = indexed(m.facts, 'id', 'facts');
  for (const statement of m.statements) sourceKeys(statement, ['id','walletId','currency','periodStart','periodEnd','openingBalance','closingBalance','rowIds'], ['id','walletId','currency','periodStart','periodEnd','openingBalance','closingBalance','rowIds'], 'statement');
  const statements = indexed(m.statements, 'id', 'statements');
  const witnessed = new Set<string>(); const statementSources = new Map<string, Set<string>>(); let rowRefs = 0;
  for (const statement of m.statements) {
    id(statement.walletId, 'statement.walletId'); sourceCheck(wallets.has(statement.walletId) && wallets.get(statement.walletId)!.currency === statement.currency, 'Dompet/mata uang statement tidak cocok.');
    date(statement.periodStart, 'statement.periodStart'); date(statement.periodEnd, 'statement.periodEnd'); sourceCheck(statement.periodStart <= statement.periodEnd, 'Periode statement terbalik.');
    money(statement.openingBalance, 'statement.openingBalance'); money(statement.closingBalance, 'statement.closingBalance'); array(statement.rowIds, 'statement.rowIds', SOURCE_STATEMENT_ROWS);
    rowRefs += statement.rowIds.length; sourceCheck(rowRefs <= SOURCE_REFERENCE_LIMIT, 'Total referensi row statement melebihi 200.000.');
    sourceCheck(new Set(statement.rowIds).size === statement.rowIds.length, 'Referensi row statement berulang.'); statementSources.set(statement.id, new Set(statement.rowIds));
    let running = BigInt(statement.openingBalance);
    for (const ref of statement.rowIds) {
      id(ref, 'statement.rowId'); const fact = facts.get(ref); sourceCheck(fact, 'Referensi fakta pada statement tidak ditemukan.');
      sourceCheck(fact.walletId === statement.walletId && fact.currency === statement.currency, 'Kepemilikan fakta statement tidak cocok.');
      sourceCheck(fact.postedOn >= statement.periodStart && fact.postedOn <= statement.periodEnd, 'Tanggal fakta berada di luar periode statement.');
      running += BigInt(fact.signedAmount); sourceCheck(running === BigInt(fact.balanceAfter), 'Urutan/running balance statement tidak cocok.'); witnessed.add(ref);
    }
    sourceCheck(running === BigInt(statement.closingBalance), 'Saldo akhir statement tidak cocok.');
  }
  for (const fact of m.facts) sourceCheck(witnessed.has(fact.id), 'Fakta sumber tidak memiliki witness statement berurutan.');
  for (const override of m.overrides ?? []) {
    sourceKeys(override, ['entryId','reason','at'], ['entryId','reason','at'], 'override'); id(override.entryId, 'override.entryId'); sourceCheck(entries.has(override.entryId), 'Entry override tidak ditemukan.');
    text(override.reason, 'override.reason', 2_000, true); timestamp(override.at, 'override.at');
  }
  const overrides = indexed(m.overrides ?? [], 'entryId', 'overrides');
  for (const link of m.links) sourceKeys(link, ['entryId','source','destination','postingDates','pairing'], ['entryId'], 'link');
  const links = indexed(m.links, 'entryId', 'links'); const claimed = new Set<string>(); const pairIds = new Set<string>();
  const transferContexts = indexed(m.transfers ?? [], 'entryId', 'transfers');
  function validatePairing(value: TransferPairing, label: string, entryId?: string, proof?: { source?: string; destination?: string }): void {
    sourceKeys(value, ['sourceEntryId','destinationEntryId','sourceOrigin','destinationOrigin','sourceOverride','destinationOverride','sourceAnnotation','destinationAnnotation'], ['sourceEntryId','destinationEntryId'], label);
    id(value.sourceEntryId, `${label}.sourceEntryId`); id(value.destinationEntryId, `${label}.destinationEntryId`);
    sourceCheck(value.sourceEntryId !== value.destinationEntryId, 'ID entry pasangan berulang.');
    if (entryId) for (const old of [value.sourceEntryId, value.destinationEntryId]) sourceCheck(!entries.has(old) || old === entryId, 'ID entry pasangan masih aktif pada entry lain.');
    for (const role of ['source','destination'] as const) {
      const origin = `${role}Origin` as const, decision = `${role}Override` as const, annotation = `${role}Annotation` as const;
      if (hasOwn(value, origin)) {
        sourceCheck(value[origin] === 'manual' || value[origin] === 'bank', `${label}: asal pembuatan tidak didukung.`);
        if ((entryId || proof) && value[origin] === 'bank') sourceCheck(proof?.[role], `${label}: asal bank tidak memiliki sumber terverifikasi.`);
      }
      if (hasOwn(value, decision)) {
        const saved = sourceKeys(value[decision], ['reason','at'], ['reason','at'], `${label}.${decision}`);
        text(saved.reason, `${label}.${decision}.reason`, 2_000, true); timestamp(saved.at, `${label}.${decision}.at`);
        if (entryId || proof) sourceCheck(proof?.[role], `${label}: override pasangan kehilangan fakta sumber.`);
      }
      if (hasOwn(value, annotation)) {
        const saved = sourceKeys(value[annotation], ['type','category','note','importBatch'], ['type','category','note'], `${label}.${annotation}`);
        sourceCheck(['income','expense','unreviewed','movement'].includes(saved.type as string), `${label}: jenis anotasi pasangan tidak didukung.`);
        text(saved.category, `${label}.${annotation}.category`, 80); text(saved.note, `${label}.${annotation}.note`, 4_000);
        if (hasOwn(saved, 'importBatch')) text(saved.importBatch, `${label}.${annotation}.importBatch`, 200, true);
        if (entryId) sourceCheck(!proof?.[role], `${label}: anotasi sumber terverifikasi harus berada pada tabel anotasi sumber.`);
      }
    }
  }
  const activePairIds = new Map<string, string>();
  for (const transfer of m.transfers ?? []) {
    sourceKeys(transfer, ['entryId','sourceDate','destinationDate','pairing','decision'], ['entryId','sourceDate','destinationDate'], 'transfer');
    const entry = entries.get(transfer.entryId); sourceCheck(entry?.type === 'transfer', 'Konteks transfer harus mengacu transaksi transfer aktif.');
    for (const role of ['sourceDate','destinationDate'] as const) if (transfer[role] !== null) date(transfer[role], `transfer.${role}`);
    const link = links.get(transfer.entryId);
    if (hasOwn(transfer, 'decision')) {
      sourceCheck(!link, 'Keputusan transfer manual tidak boleh menggandakan override sumber.');
      const saved = sourceKeys(transfer.decision, ['reason','at'], ['reason','at'], 'transfer.decision');
      text(saved.reason, 'transfer.decision.reason', 2_000, true); timestamp(saved.at, 'transfer.decision.at');
    }
    if (link?.postingDates) sourceCheck(link.postingDates.source === transfer.sourceDate && link.postingDates.destination === transfer.destinationDate, 'Tanggal link dan konteks transfer bertentangan.');
    if (transfer.pairing) {
      validatePairing(transfer.pairing, 'transfer.pairing', transfer.entryId, link);
      if (link?.pairing) sourceCheck(link.pairing.sourceEntryId === transfer.pairing.sourceEntryId && link.pairing.destinationEntryId === transfer.pairing.destinationEntryId, 'ID pairing link dan konteks transfer bertentangan.');
      for (const consumed of [transfer.pairing.sourceEntryId, transfer.pairing.destinationEntryId]) {
        sourceCheck(!activePairIds.has(consumed), 'ID entry dipakai oleh lebih dari satu pasangan transfer.'); activePairIds.set(consumed, transfer.entryId);
      }
    }
  }
  for (const witness of m.unpairings ?? []) {
    sourceKeys(witness, ['id','sourceEntryId','destinationEntryId','sourceWalletId','destinationWalletId','sourceDate','destinationDate','principal','toAmount','rate','fee','reason','at','groupNote','pairing','source','destination','groupOrigin','groupDecision'], ['id','sourceEntryId','destinationEntryId','sourceWalletId','destinationWalletId','sourceDate','destinationDate','principal','toAmount','fee','reason','at','groupNote'], 'unpairing');
    id(witness.id, 'unpairing.id'); id(witness.sourceEntryId, 'unpairing.sourceEntryId'); id(witness.destinationEntryId, 'unpairing.destinationEntryId');
    sourceCheck(witness.sourceEntryId !== witness.destinationEntryId, 'ID hasil unpair harus berbeda.');
    id(witness.sourceWalletId, 'unpairing.sourceWalletId'); id(witness.destinationWalletId, 'unpairing.destinationWalletId');
    const from = wallets.get(witness.sourceWalletId), to = wallets.get(witness.destinationWalletId);
    sourceCheck(from && to && from.id !== to.id, 'Dompet witness unpair tidak tersedia atau sama.');
    date(witness.sourceDate, 'unpairing.sourceDate'); date(witness.destinationDate, 'unpairing.destinationDate');
    money(witness.principal, 'unpairing.principal'); money(witness.toAmount, 'unpairing.toAmount'); money(witness.fee, 'unpairing.fee');
    sourceCheck(witness.principal > 0 && witness.toAmount > 0 && witness.fee >= 0 && BigInt(witness.principal) + BigInt(witness.fee) <= BigInt(Number.MAX_SAFE_INTEGER), 'Nominal atau biaya witness unpair tidak valid.');
    if (hasOwn(witness, 'rate')) sourceCheck(typeof witness.rate === 'number' && Number.isFinite(witness.rate) && witness.rate > 0, 'Kurs witness unpair tidak valid.');
    if (from.currency === to.currency) sourceCheck(witness.principal === witness.toAmount && (witness.rate === undefined || witness.rate === 1), 'Nominal/kurs witness unpair satu mata uang tidak cocok.');
    else sourceCheck(witness.rate !== undefined && isCurrencyConversionConsistent(witness.principal, from.currency, to.currency, witness.rate, witness.toAmount), 'Nominal/kurs witness unpair lintas mata uang tidak cocok.');
    text(witness.reason, 'unpairing.reason', 2_000, true); timestamp(witness.at, 'unpairing.at'); text(witness.groupNote, 'unpairing.groupNote', 4_000);
    for (const role of ['source','destination'] as const) if (hasOwn(witness, role)) { id(witness[role], `unpairing.${role}`); sourceCheck(facts.has(witness[role]!), 'Referensi fakta witness unpair tidak ditemukan.'); }
    sourceCheck(!witness.source || !witness.destination || witness.source !== witness.destination, 'Satu fakta tidak boleh menjadi kedua sisi witness unpair.');
    if (hasOwn(witness, 'groupOrigin')) sourceCheck(witness.groupOrigin === 'manual' || witness.groupOrigin === 'bank', 'Asal grup unpair tidak didukung.');
    if (hasOwn(witness, 'groupDecision')) {
      sourceCheck(!witness.source && !witness.destination, 'Keputusan grup manual tidak boleh menggandakan override sumber historis.');
      const saved = sourceKeys(witness.groupDecision, ['reason','at'], ['reason','at'], 'unpairing.groupDecision');
      text(saved.reason, 'unpairing.groupDecision.reason', 2_000, true); timestamp(saved.at, 'unpairing.groupDecision.at');
    }
    if (witness.groupOrigin === 'bank') sourceCheck(witness.source || witness.destination, 'Asal grup bank pada witness kehilangan fakta sumber.');
    if (witness.pairing) validatePairing(witness.pairing, 'unpairing.pairing', undefined, witness);
  }
  indexed(m.unpairings ?? [], 'id', 'unpairings');
  const claim = (ref: unknown, label: string): SourceFact => { id(ref, label); const fact = facts.get(ref); sourceCheck(fact, `${label}: fakta tidak ditemukan.`); sourceCheck(!claimed.has(ref), 'Satu fakta sumber diklaim oleh lebih dari satu entry.'); claimed.add(ref); return fact; };
  for (const link of m.links) {
    const entry = entries.get(link.entryId); sourceCheck(entry, 'Entry pada link tidak ditemukan.');
    sourceCheck(hasOwn(link, 'source') || hasOwn(link, 'destination'), 'Link sumber kosong.');
    const source = hasOwn(link, 'source') ? claim(link.source, 'link.source') : null;
    const destination = hasOwn(link, 'destination') ? claim(link.destination, 'link.destination') : null;
    sourceCheck(!destination || entry.type === 'transfer', 'Sumber tujuan hanya berlaku untuk transfer.');
    if (hasOwn(link, 'postingDates')) {
      sourceCheck(entry.type === 'transfer', 'Tanggal kaki hanya berlaku untuk transfer; entry biasa memakai tanggal finansialnya.');
      const dates = sourceKeys(link.postingDates, ['source','destination'], ['source','destination'], 'postingDates');
      for (const role of ['source','destination'] as const) if (dates[role] !== null) date(dates[role], `postingDates.${role}`);
    }
    const context = transferContexts.get(entry.id);
    const effectiveDates = context ? { source: context.sourceDate, destination: context.destinationDate } : link.postingDates;
    let mismatch = entry.type === 'transfer' && !context && hasOwn(link, 'postingDates') && entry.date !== link.postingDates!.source;
    if (source) {
      if (hasOwn(entry, 'sourceKey')) sourceCheck(entry.sourceKey === source.fingerprint, 'Alias legacy asal bertentangan dengan fakta sumber.');
      const signed = ['income','adjustment','unreviewed','movement'].includes(entry.type) ? BigInt(entry.amount) : -BigInt(entry.amount) - BigInt(entry.fee ?? 0);
      const effectiveDate = entry.type === 'transfer' && effectiveDates ? effectiveDates.source : entry.date;
      mismatch ||= source.walletId !== entry.walletId || BigInt(source.signedAmount) !== signed || source.postedOn !== effectiveDate;
    }
    if (destination) {
      if (hasOwn(entry, 'toSourceKey')) sourceCheck(entry.toSourceKey === destination.fingerprint, 'Alias legacy tujuan bertentangan dengan fakta sumber.');
      const effectiveDate = effectiveDates ? effectiveDates.destination : entry.date;
      mismatch ||= destination.walletId !== entry.toWalletId || destination.signedAmount !== entry.toAmount || destination.postedOn !== effectiveDate;
    }
    sourceCheck(!mismatch || overrides.has(entry.id), 'Perubahan nominal/tanggal/dompet sumber memerlukan alasan dan waktu override eksplisit.');
    if (hasOwn(link, 'pairing')) {
      sourceKeys(link.pairing, ['sourceEntryId','destinationEntryId'], ['sourceEntryId','destinationEntryId'], 'pairing');
      sourceCheck(entry.type === 'transfer' && source && destination && hasOwn(link, 'postingDates'), 'Konteks pasangan memerlukan dua sumber dan tanggal.');
      id(link.pairing!.sourceEntryId, 'pairing.sourceEntryId'); id(link.pairing!.destinationEntryId, 'pairing.destinationEntryId');
      sourceCheck(link.pairing!.sourceEntryId !== link.pairing!.destinationEntryId, 'ID entry pasangan berulang.');
      for (const old of [link.pairing!.sourceEntryId, link.pairing!.destinationEntryId]) { sourceCheck(!pairIds.has(old) && (!activePairIds.has(old) || activePairIds.get(old) === entry.id), 'ID pasangan dipakai ulang.'); sourceCheck(!entries.has(old) || old === entry.id, 'ID entry pasangan masih aktif pada entry lain.'); pairIds.add(old); }
    }
  }
  for (const override of m.overrides ?? []) sourceCheck(links.has(override.entryId), 'Override kehilangan asosiasi sumber.');
  for (const annotation of m.annotations ?? []) {
    sourceKeys(annotation, ['sourceId','category','note','confirmedType','importBatch'], ['sourceId'], 'annotation'); id(annotation.sourceId, 'annotation.sourceId'); sourceCheck(facts.has(annotation.sourceId), 'Sumber anotasi tidak ditemukan.');
    if (hasOwn(annotation, 'category')) text(annotation.category, 'annotation.category', 80);
    if (hasOwn(annotation, 'note')) text(annotation.note, 'annotation.note');
    if (hasOwn(annotation, 'importBatch')) text(annotation.importBatch, 'annotation.importBatch', 200, true);
    if (hasOwn(annotation, 'confirmedType')) sourceCheck(['income','expense','unreviewed','movement'].includes(annotation.confirmedType!), 'Jenis anotasi tidak valid.');
  }
  indexed(m.annotations ?? [], 'sourceId', 'annotations');
  for (const decision of m.dispositions ?? []) {
    sourceKeys(decision, ['sourceId','kind','reason','at'], ['sourceId','kind'], 'disposition'); id(decision.sourceId, 'disposition.sourceId'); sourceCheck(facts.has(decision.sourceId), 'Sumber keputusan tidak ditemukan.');
    sourceCheck(['excluded','deleted','deferred'].includes(decision.kind), 'Jenis keputusan sumber tidak didukung.'); sourceCheck(!claimed.has(decision.sourceId), 'Keputusan deferred/deleted/excluded bertentangan dengan link aktif.');
    if (hasOwn(decision, 'reason')) text(decision.reason, 'disposition.reason', 2_000, true);
    if (hasOwn(decision, 'at')) timestamp(decision.at, 'disposition.at');
  }
  const dispositions = indexed(m.dispositions ?? [], 'sourceId', 'dispositions');
  const deletedIds = new Set<string>(), deletedSources = new Set<string>(), deletedPairIds = new Set<string>();
  // A saved opaque alias still belongs to the removed group. It cannot silently
  // become an independent live posting merely because that role lacked a fact.
  // This reservation exists only for new E5 tombstones, not all legacy aliases.
  const activeFingerprints = new Set(financial.state.entries.flatMap(entry => [entry.sourceKey,entry.toSourceKey]).filter((value): value is string => value !== undefined));
  for (const ref of claimed) activeFingerprints.add(facts.get(ref)!.fingerprint);
  const deletedFingerprints = new Map<string, string>();
  const reserveFingerprint = (fingerprint: string, owner: string): void => {
    sourceCheck(!activeFingerprints.has(fingerprint), 'Fingerprint grup transfer terhapus masih diwakili posting aktif lain; tinjau pemulihan seluruh grup.');
    sourceCheck(!deletedFingerprints.has(fingerprint) || deletedFingerprints.get(fingerprint) === owner, 'Fingerprint tersimpan pada lebih dari satu grup transfer terhapus.');
    deletedFingerprints.set(fingerprint,owner);
  };
  for (const tombstone of m.deletedTransfers ?? []) {
    sourceKeys(tombstone, ['entry','context','link','override','origin','reason','at'], ['entry','reason','at'], 'deletedTransfer');
    // Reuse strict financial field parsing without combining an inactive group's
    // old amounts with today's balances. It is evidence, not an active posting.
    const isolated = validateLegacyBackup({ app:'uangku',version:1,demo:financial.demo,state:{ version:1,
      wallets:financial.state.wallets.map(wallet => ({...wallet,openingBalance:0})), entries:[tombstone.entry] } });
    const entry = isolated.state.entries[0];
    sourceCheck(entry.type === 'transfer', 'Tombstone hanya boleh menyimpan grup transfer.');
    sourceCheck(JSON.stringify(canonicalSource(entry)) === JSON.stringify(canonicalSource(tombstone.entry)), 'Field transfer terhapus tidak didukung; tidak boleh dibuang saat validasi.');
    sourceCheck(!entries.has(entry.id) && !deletedIds.has(entry.id) && !deletedPairIds.has(entry.id), 'Grup transfer terhapus masih aktif atau berulang.'); deletedIds.add(entry.id);
    for (const fingerprint of [entry.sourceKey,entry.toSourceKey]) if (fingerprint !== undefined) reserveFingerprint(fingerprint,entry.id);
    text(tombstone.reason, 'deletedTransfer.reason', 2_000, true); timestamp(tombstone.at, 'deletedTransfer.at');
    const decision = (value: unknown, label: string): void => {
      const saved = sourceKeys(value, ['reason','at'], ['reason','at'], label);
      text(saved.reason, `${label}.reason`, 2_000, true); timestamp(saved.at, `${label}.at`);
    };
    const context = tombstone.context, link = tombstone.link;
    if (context !== undefined) {
      sourceKeys(context, ['entryId','sourceDate','destinationDate','pairing','decision'], ['entryId','sourceDate','destinationDate'], 'deletedTransfer.context');
      sourceCheck(context.entryId === entry.id, 'Konteks transfer terhapus mengacu grup berbeda.');
      for (const role of ['sourceDate','destinationDate'] as const) if (context[role] !== null) date(context[role], `deletedTransfer.context.${role}`);
      if (hasOwn(context, 'decision')) { sourceCheck(link === undefined, 'Keputusan manual terhapus tidak boleh menggandakan override sumber.'); decision(context.decision, 'deletedTransfer.context.decision'); }
    }
    if (link !== undefined) {
      sourceKeys(link, ['entryId','source','destination','postingDates','pairing'], ['entryId'], 'deletedTransfer.link');
      sourceCheck(link.entryId === entry.id, 'Link transfer terhapus mengacu grup berbeda.');
      sourceCheck(hasOwn(link, 'source') || hasOwn(link, 'destination'), 'Link transfer terhapus kosong.');
      if (hasOwn(link, 'postingDates')) {
        const dates = sourceKeys(link.postingDates, ['source','destination'], ['source','destination'], 'deletedTransfer.postingDates');
        for (const role of ['source','destination'] as const) if (dates[role] !== null) date(dates[role], `deletedTransfer.postingDates.${role}`);
        if (context) sourceCheck(dates.source === context.sourceDate && dates.destination === context.destinationDate, 'Tanggal link/konteks transfer terhapus bertentangan.');
      }
    }
    const pairing = context?.pairing ?? link?.pairing;
    if (context?.pairing) validatePairing(context.pairing, 'deletedTransfer.context.pairing', entry.id, link);
    if (link?.pairing) {
      sourceKeys(link.pairing, ['sourceEntryId','destinationEntryId'], ['sourceEntryId','destinationEntryId'], 'deletedTransfer.link.pairing');
      sourceCheck(link.source && link.destination && link.postingDates, 'Pasangan link terhapus memerlukan dua sumber dan tanggal.');
      id(link.pairing.sourceEntryId, 'deletedTransfer.link.pairing.sourceEntryId'); id(link.pairing.destinationEntryId, 'deletedTransfer.link.pairing.destinationEntryId');
      sourceCheck(link.pairing.sourceEntryId !== link.pairing.destinationEntryId, 'ID pasangan terhapus berulang.');
      if (context?.pairing) sourceCheck(context.pairing.sourceEntryId === link.pairing.sourceEntryId && context.pairing.destinationEntryId === link.pairing.destinationEntryId, 'ID pasangan link/konteks terhapus bertentangan.');
    }
    if (pairing) for (const consumed of [pairing.sourceEntryId,pairing.destinationEntryId]) {
      sourceCheck(!entries.has(consumed) && !activePairIds.has(consumed) && !deletedPairIds.has(consumed) && (!deletedIds.has(consumed) || consumed === entry.id), 'ID pasangan terhapus masih aktif atau dipakai tombstone lain.'); deletedPairIds.add(consumed);
    }
    if (hasOwn(tombstone, 'override')) { sourceCheck(link, 'Override transfer terhapus kehilangan sumber.'); decision(tombstone.override, 'deletedTransfer.override'); }
    if (hasOwn(tombstone, 'origin')) sourceCheck(tombstone.origin === 'manual' || tombstone.origin === 'bank', 'Asal transfer terhapus tidak didukung.');
    if (tombstone.origin === 'bank') sourceCheck(link, 'Asal bank transfer terhapus kehilangan sumber.');
    let mismatch = !context && !!link?.postingDates && entry.date !== link.postingDates.source;
    for (const role of ['source','destination'] as const) if (link && hasOwn(link, role)) {
      const ref = link[role]; id(ref, `deletedTransfer.link.${role}`); const fact = facts.get(ref);
      sourceCheck(fact, 'Fakta sumber transfer terhapus tidak ditemukan.');
      reserveFingerprint(fact.fingerprint,entry.id);
      sourceCheck(!claimed.has(ref) && !deletedSources.has(ref), 'Fakta transfer terhapus masih diklaim aktif atau tombstone lain.'); deletedSources.add(ref);
      const disposition = dispositions.get(ref);
      sourceCheck(disposition?.kind === 'deleted' && disposition.reason === tombstone.reason && disposition.at === tombstone.at, 'Fakta transfer terhapus memerlukan keputusan deleted yang sesuai.');
      const alias = role === 'source' ? entry.sourceKey : entry.toSourceKey;
      if (alias !== undefined) sourceCheck(alias === fact.fingerprint, 'Fingerprint transfer terhapus bertentangan dengan sumber.');
      const effectiveDate = context ? role === 'source' ? context.sourceDate : context.destinationDate : link.postingDates ? link.postingDates[role] : entry.date;
      const delta = role === 'source' ? -BigInt(entry.amount) - BigInt(entry.fee ?? 0) : BigInt(entry.toAmount!);
      mismatch ||= fact.walletId !== (role === 'source' ? entry.walletId : entry.toWalletId) || fact.postedOn !== effectiveDate || BigInt(fact.signedAmount) !== delta;
    }
    sourceCheck(!mismatch || tombstone.override, 'Koreksi transfer terhapus memerlukan override yang dipertahankan.');
  }
  for (const baseline of m.baselines ?? []) sourceKeys(baseline, ['id','walletId','boundary','origin','status'], ['id','walletId','boundary','origin','status'], 'baseline');
  const baselines = indexed(m.baselines ?? [], 'id', 'baselines'); const baselineWallets = new Set<string>();
  for (const baseline of m.baselines ?? []) {
    sourceCheck(wallets.has(baseline.walletId), 'Dompet baseline tidak ditemukan.'); sourceCheck(!baselineWallets.has(baseline.walletId), 'Baseline dompet berulang.'); baselineWallets.add(baseline.walletId);
    sourceCheck(['manual','bank'].includes(baseline.origin) && ['confirmed','provisional'].includes(baseline.status), 'Origin/status baseline tidak didukung.');
    sourceKeys(baseline.boundary, ['kind','date','sourceId'], ['kind','date'], 'baseline.boundary'); date(baseline.boundary.date, 'baseline.date'); sourceCheck(['before-source','end-of-day'].includes(baseline.boundary.kind), 'Batas baseline tidak didukung.');
    if (baseline.boundary.kind === 'before-source') {
      const fact = facts.get(baseline.boundary.sourceId!); sourceCheck(fact, 'Sumber anchor baseline tidak ditemukan.'); sourceCheck(fact.walletId === baseline.walletId && fact.postedOn === baseline.boundary.date, 'Anchor baseline berbeda akun/tanggal.');
      if (baseline.status === 'confirmed') sourceCheck(BigInt(wallets.get(baseline.walletId)!.openingBalance) === BigInt(fact.balanceAfter) - BigInt(fact.signedAmount), 'Saldo baseline bertentangan dengan anchor.');
    } else {
      sourceCheck(!hasOwn(baseline.boundary, 'sourceId'), 'Baseline akhir hari tidak boleh memiliki source anchor.');
      if (baseline.origin === 'bank' && baseline.status === 'confirmed') sourceCheck(m.statements.some(statement => statement.walletId === baseline.walletId && statement.periodEnd === baseline.boundary.date && statement.closingBalance === wallets.get(baseline.walletId)!.openingBalance), 'Baseline bank akhir hari tidak memiliki witness closing.');
    }
  }
  for (const decision of m.baselineDecisions ?? []) {
    sourceKeys(decision, ['baselineId','reason','at'], ['baselineId','reason','at'], 'baselineDecision');
    id(decision.baselineId, 'baselineDecision.baselineId'); sourceCheck(baselines.has(decision.baselineId), 'Keputusan baseline mengacu baseline yang tidak tersedia.');
    text(decision.reason, 'baselineDecision.reason', 2_000, true); timestamp(decision.at, 'baselineDecision.at');
  }
  indexed(m.baselineDecisions ?? [], 'baselineId', 'baselineDecisions');
  const completed = new Set<string>(); let completionRefs = 0;
  for (const completion of m.completions ?? []) {
    sourceKeys(completion, ['statementId','baselineId','sourceIds','at'], ['statementId','baselineId','sourceIds','at'], 'completion');
    sourceCheck(statements.has(completion.statementId) && baselines.has(completion.baselineId), 'Statement/baseline completion tidak ditemukan.'); sourceCheck(!completed.has(completion.statementId), 'Acknowledgement completion berulang.'); completed.add(completion.statementId);
    sourceCheck(statements.get(completion.statementId)!.walletId === baselines.get(completion.baselineId)!.walletId, 'Akun completion dan baseline berbeda.'); array(completion.sourceIds, 'completion.sourceIds'); completionRefs += completion.sourceIds.length; sourceCheck(completionRefs <= SOURCE_REFERENCE_LIMIT, 'Total referensi completion melebihi 200.000.'); sourceCheck(new Set(completion.sourceIds).size === completion.sourceIds.length, 'Referensi completion berulang.');
    for (const ref of completion.sourceIds) sourceCheck(statementSources.get(completion.statementId)!.has(ref), 'Completion mengacu sumber di luar statement.'); timestamp(completion.at, 'completion.at');
  }
  for (const origin of m.creationOrigins ?? []) {
    sourceKeys(origin, ['entryId','origin'], ['entryId','origin'], 'creationOrigin'); id(origin.entryId, 'creationOrigin.entryId'); sourceCheck(entries.has(origin.entryId), 'Entry creation origin tidak ditemukan.'); sourceCheck(['manual','bank'].includes(origin.origin), 'Creation origin tidak didukung.'); sourceCheck(origin.origin !== 'bank' || links.has(origin.entryId), 'Creation origin bank kehilangan sumber.');
  }
  indexed(m.creationOrigins ?? [], 'entryId', 'creationOrigins');
  return structuredClone(m);
}

/** Semantic in-memory validation; external callers must explicitly gate old wire formats. */
export function validateSourceDocument(value: unknown, options: { allowMovement?: boolean; allowWalletArchives?: boolean; allowExtendedCurrencies?: boolean; allowGenericFacts?: boolean; allowCurrencyConfiguration?: boolean } = {}): SourceDocument {
  const raw = sourceKeys(value, ['app','version','demo','state','metadata'], ['app','version','demo','state'], 'document');
  const state = sourceRecord(raw.state, 'state');
  sourceCheck(!Array.isArray(state.wallets) || state.wallets.length <= 100, 'Daftar dompet maksimal 100 dompet.');
  sourceCheck(!Array.isArray(state.entries) || state.entries.length <= 100_000, 'Daftar transaksi maksimal 100.000 transaksi.');
  const withMetadata=hasOwn(raw,'metadata');
  if(withMetadata)assertSourceJsonBudget(raw, SOURCE_EXPANDED_LIMIT, 'Data sumber terurai');
  const financial = { app: raw.app, version: raw.version, demo: raw.demo, state: raw.state };
  const normalized = validateLegacyBackup(financial, { skipMonthlyTotals: withMetadata, allowMovement: options.allowMovement !== false, allowExtendedCurrencies: options.allowExtendedCurrencies !== false });
  if (!withMetadata) return normalized;
  const metadata = validateSourceMetadata(normalized, raw.metadata);
  sourceCheck(options.allowWalletArchives !== false || !hasOwn(metadata,'walletArchives'), 'Arsip dompet memerlukan codec sumber table-tuples-v5.');
  sourceCheck(options.allowGenericFacts !== false || !metadata.facts.some(fact => fact.fingerprintVersion === 'generic-v1'), 'Sumber impor umum memerlukan codec sumber table-tuples-v6.');
  sourceCheck(options.allowCurrencyConfiguration !== false || !hasOwn(metadata,'currencies'), 'Pengelolaan mata uang memerlukan codec sumber table-tuples-v6.');
  // Existing E3 metadata stays readable; explicit E4 date context uses the full effective fee-month guard.
  assertPostingMonthTotals(normalized.state, metadata);
  const result = { ...normalized, metadata };
  sourceCheck(options.allowMovement !== false || !sourceDocumentUsesMovement(result), 'Perpindahan tercatat memerlukan codec sumber table-tuples-v4.');
  return result;
}

/** Feature detection on a validated document includes retained leg annotations. */
export function sourceDocumentUsesMovement(data: SourceDocument): boolean {
  const pairingUsesMovement = (pairing: TransferPairing | undefined): boolean => pairing?.sourceAnnotation?.type === 'movement' || pairing?.destinationAnnotation?.type === 'movement';
  return data.state.entries.some(entry => entry.type === 'movement')
    || !!data.metadata?.annotations?.some(annotation => annotation.confirmedType === 'movement')
    || !!data.metadata?.transfers?.some(context => pairingUsesMovement(context.pairing))
    || !!data.metadata?.unpairings?.some(witness => pairingUsesMovement(witness.pairing))
    || !!data.metadata?.deletedTransfers?.some(tombstone => tombstone.entry.type === 'movement' || pairingUsesMovement(tombstone.context?.pairing));
}

/** Feature detection never converts stored monetary values. */
export function sourceDocumentUsesCurrencyFeatures(data: SourceDocument): boolean {
  const legacy = new Set<string>(LEGACY_CURRENCY_CODES);
  return data.state.wallets.some(wallet => !legacy.has(wallet.currency))
    || !!data.metadata && (hasOwn(data.metadata, 'currencies') || data.metadata.facts.some(fact => fact.fingerprintVersion === 'generic-v1'));
}
