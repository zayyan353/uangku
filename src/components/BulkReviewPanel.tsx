import { useContext, useEffect, useState } from 'react';
import { CheckCheck, X } from 'lucide-react';
import type { Entry } from '../lib/finance';
import { CategorySettingsContext } from '../hooks/useCategorySettings';
import { categoryChoices } from '../lib/categorySettings';

export default function BulkReviewPanel({ entries, onApply, onClear, selectableCount, onSelectAll }: {
  entries: Entry[];
  onApply: (category: string, confirmUnreviewed: boolean) => void;
  onClear: () => void;
  /** Rows across every page of the current filter that can take a category. */
  selectableCount: number;
  onSelectAll: () => void;
}) {
  const [category, setCategory] = useState('');
  const categorySettings = useContext(CategorySettingsContext);
  const [confirmed, setConfirmed] = useState(false);
  const pending = entries.filter(e => e.type === 'unreviewed');
  const selectionKey = entries.map(e => e.id).join('|');
  useEffect(() => { setConfirmed(false); }, [selectionKey]);
  return <section className="bulk-review-panel" aria-label="Rapikan transaksi terpilih">
    <div className="bulk-review-summary"><div><strong>{entries.length} transaksi dipilih</strong><p>Kategori diterapkan sekaligus. Nominal, dompet, dan referensi impor tetap disimpan.</p></div><div className="bulk-review-links">{selectableCount > entries.length && <button className="text-link" data-testid="bulk-select-all" onClick={onSelectAll}>Pilih semua {selectableCount} hasil filter</button>}<button className="text-link" onClick={onClear}><X size={15} /> Batal pilih</button></div></div>
    <div className="bulk-review-controls"><label className="field"><span className="field-label">Kategori untuk pilihan ini</span><select className="select-input" aria-label="Kategori transaksi terpilih" value={category} onChange={e => setCategory(e.target.value)}><option value="" disabled>Pilih kategori…</option>{categoryChoices(categorySettings, category).map(name => <option key={name}>{name}</option>)}</select></label><button className="button primary" disabled={!category} onClick={() => { if (category) onApply(category, confirmed); }}><CheckCheck size={17} /> Terapkan ke {entries.length} transaksi</button></div>
    {pending.length > 0 && <div className="bulk-review-confirm"><p>{pending.length} transaksi belum dikonfirmasi jenisnya. Mengisi kategori saja tetap membiarkannya “Perlu dicek”.</p><label className="checkbox-row"><input type="checkbox" aria-label="Konfirmasi jenis transaksi yang belum dicek" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>Saya sudah cek: uang masuk adalah pemasukan dan uang keluar adalah pengeluaran.</span></label><p className="field-help">Untuk pindah uang antar dompet sendiri, gunakan tombol Cek lalu pilih Transfer.</p></div>}
  </section>;
}
