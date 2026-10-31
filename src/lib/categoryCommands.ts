import { prepareBackup } from './storage';
import type { SourceAnnotation, SourceDocument } from './sourceModel';

export interface CategoryAssignment { entryId: string; category: string }

const UNCATEGORIZED = 'Belum dikategorikan';

/**
 * Apply one reviewed proposal atomically, without interpreting financial type.
 * The caller must still save through the coordinated ledger writer and its
 * captured revision token. A category chosen since the preview is protected.
 */
export function applyCategoryAssignments(data: SourceDocument, assignments: readonly CategoryAssignment[]): SourceDocument {
  if (!assignments.length || assignments.length > 100_000) throw new Error('Pilih setidaknya satu kategori; maksimal 100.000 transaksi per penerapan.');
  const wanted = new Map<string, string>();
  for (const assignment of assignments) {
    if (typeof assignment.entryId !== 'string' || !assignment.entryId.trim()) throw new Error('ID transaksi untuk kategori tidak valid.');
    if (wanted.has(assignment.entryId)) throw new Error('Ada ID transaksi berulang pada usulan kategori.');
    if (typeof assignment.category !== 'string' || !assignment.category.trim() || assignment.category.trim() === UNCATEGORIZED || assignment.category.length > 80) {
      throw new Error('Pilih kategori yang tidak kosong, berbeda dari Belum dikategorikan, dan maksimal 80 karakter.');
    }
    wanted.set(assignment.entryId, assignment.category.trim());
  }

  const next = structuredClone(data);
  const annotations = new Map<string, SourceAnnotation>((next.metadata?.annotations ?? []).map(row => [row.sourceId, row]));
  const sourcesByEntry = new Map((next.metadata?.links ?? []).map(link => [link.entryId, [link.source, link.destination].filter((id): id is string => !!id)]));
  let found = 0;
  for (const entry of next.state.entries) {
    const category = wanted.get(entry.id);
    if (category === undefined) continue;
    found++;
    if (!['expense', 'income', 'unreviewed', 'movement'].includes(entry.type)) throw new Error('Transfer dan penyesuaian saldo tidak dapat diberi kategori otomatis.');
    if (entry.category.trim() && entry.category.trim() !== UNCATEGORIZED) throw new Error('Kategori transaksi sudah diisi. Tinjau ulang usulan tanpa menimpa pilihan manual.');
    entry.category = category;
    for (const sourceId of sourcesByEntry.get(entry.id) ?? []) {
      // Preserve every other annotation field. A category alone never asserts a
      // confirmed type or overwrites the user's saved note/import association.
      annotations.set(sourceId, { ...annotations.get(sourceId), sourceId, category });
    }
  }
  if (found !== wanted.size) throw new Error('Sebagian transaksi sudah berubah atau dihapus. Buat ulang usulan kategori.');
  if (next.metadata) next.metadata.annotations = [...annotations.values()];
  // Exactly one validation/encoding boundary for the whole varied-category
  // batch, including the persisted v1/v2 capacity limit. No storage write here.
  return prepareBackup(next).data;
}
