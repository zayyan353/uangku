import { bankTypeConfirmation, entrySourceDescriptions } from './categorySuggestions';
import { entrySignedAmount } from './finance';
import { isUncategorized } from './categorySettings';
import { prepareBackup } from './storage';
import type { SourceAnnotation, SourceDocument } from './sourceModel';
import { archivedReadOnlyEntryIds } from './walletLifecycle';

export interface BankCategoryAssignment { entryId: string; category: string; confirmBankType?: true }

/** One explicit reviewed batch, followed by the caller's revision-guarded save.
 * Financial confirmation is recomputed from source wording, never a UI label.
 */
export function applyBankDecisions(data: SourceDocument, assignments: readonly BankCategoryAssignment[]): SourceDocument {
  if (!assignments.length || assignments.length > 100_000) throw Error('Pilih setidaknya satu catatan; maksimal 100.000 per penerapan.');
  const wanted = new Map<string, BankCategoryAssignment>();
  for (const assignment of assignments) {
    if (typeof assignment.entryId !== 'string' || !assignment.entryId.trim() || wanted.has(assignment.entryId)) throw Error('ID transaksi kosong atau berulang.');
    if (assignment.confirmBankType !== undefined && assignment.confirmBankType !== true) throw Error('Keputusan jenis transaksi tidak valid.');
    if (typeof assignment.category !== 'string' || assignment.category.length > 80 || isUncategorized(assignment.category)) throw Error('Pilih kategori yang valid, maksimal 80 karakter.');
    wanted.set(assignment.entryId, { ...assignment, category: assignment.category.trim() });
  }
  const next = structuredClone(data), descriptions = entrySourceDescriptions(data);
  const annotations = new Map<string, SourceAnnotation>((next.metadata?.annotations ?? []).map(row => [row.sourceId, row]));
  const sourceIds = new Map((next.metadata?.links ?? []).map(link => [link.entryId, [link.source, link.destination].filter((id): id is string => !!id)]));
  const cash = new Set(next.state.wallets.filter(wallet => wallet.kind === 'cash').map(wallet => wallet.id));
  const archivedEntries = archivedReadOnlyEntryIds(data);
  let found = 0;
  for (const entry of next.state.entries) {
    const assignment = wanted.get(entry.id);
    if (!assignment) continue;
    found++;
    if (archivedEntries.has(entry.id)) throw Error('Dompet arsip bersifat baca saja. Pulihkan dompet sebelum mengubah kategori atau jenis transaksi.');
    if (entry.type === 'transfer' || entry.type === 'adjustment' || cash.has(entry.walletId) || !!entry.toWalletId && cash.has(entry.toWalletId)) throw Error('Catatan transfer berpasangan, penyesuaian, dan arsip cash tidak dapat diubah di sini.');
    if (!isUncategorized(entry.category) && (!assignment.confirmBankType || entry.category !== assignment.category)) throw Error('Kategori manual sudah terisi. Buat ulang pratinjau tanpa menimpanya.');
    if (assignment.confirmBankType) {
      if (entry.type !== 'unreviewed' && entry.type !== 'movement') throw Error('Jenis transaksi sudah dikonfirmasi. Buat ulang pratinjau.');
      const signedAmount = entrySignedAmount(entry);
      const type = bankTypeConfirmation(entry, descriptions.has(entry.id) ? descriptions.get(entry.id)! : entry.note);
      if (!type && entry.type === 'movement') throw Error('Jenis perpindahan ini sudah dikonfirmasi dan bukan ATM yang memenuhi kebijakan baru. Buat ulang pratinjau.');
      if (!type) throw Error('Jenis mutasi ini belum dapat dipastikan dari keterangan dan arah nominal.');
      entry.type = type;
      entry.amount = type === 'movement' ? signedAmount : Math.abs(signedAmount);
    }
    entry.category = assignment.category;
    for (const sourceId of sourceIds.get(entry.id) ?? []) annotations.set(sourceId, {
      ...annotations.get(sourceId), sourceId, category: entry.category,
      ...(assignment.confirmBankType ? { confirmedType: entry.type as 'movement' | 'income' | 'expense' } : {}),
    });
  }
  if (found !== wanted.size) throw Error('Sebagian transaksi berubah atau dihapus. Buat ulang pratinjau.');
  if (next.metadata) next.metadata.annotations = [...annotations.values()];
  return prepareBackup(next).data;
}
