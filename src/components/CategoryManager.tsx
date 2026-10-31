import { useEffect, useRef, useState } from 'react';
import { Check, Download, Plus, Trash2, Upload } from 'lucide-react';
import Modal from './Modal';
import { makeId } from '../lib/finance';
import { CATEGORY_SETTINGS_LIMIT, categorySettingsExport, parseCategorySettingsExport, validateCategorySettings, type CategorySettings } from '../lib/categorySettings';
import type { CategoryRule } from '../lib/categorization';
import { mergeCurrentCategoryKeywordPack } from '../lib/categoryConfirmedMappings';
import { mergeCurrentAutomaticBankMappings } from '../lib/bankAutoMappings';

const UNCATEGORIZED = 'Belum dikategorikan';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Pengaturan belum dapat diproses.';
}

export default function CategoryManager({ settings, onSave, onClose, notice }: {
  settings: CategorySettings;
  onSave: (next: CategorySettings) => Promise<boolean>;
  onClose: () => void;
  notice?: string;
}) {
  const [draft, setDraft] = useState(() => structuredClone(settings));
  const [newName, setNewName] = useState('');
  const [keyword, setKeyword] = useState('');
  const [ruleCategory, setRuleCategory] = useState(settings.names.find(name => name !== UNCATEGORIZED) ?? '');
  const [ruleMode, setRuleMode] = useState<CategoryRule['mode']>('auto');
  const [pending, setPending] = useState<'read' | 'save' | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const busyRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const ruleNames = draft.names.filter(name => name !== UNCATEGORIZED);

  useEffect(() => {
    if (!ruleNames.includes(ruleCategory)) setRuleCategory(ruleNames[0] ?? '');
  }, [draft.names, ruleCategory]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  function close() { if (!busyRef.current) onClose(); }
  function update(next: CategorySettings, notice = ''): boolean {
    if (busyRef.current) return false;
    try {
      setDraft(validateCategorySettings(next));
      setError(''); setMessage(notice);
      return true;
    } catch (reason) { setError(errorMessage(reason)); return false; }
  }
  function addName() {
    const name = newName.trim();
    if (update({ ...draft, names: [...draft.names, name] }, 'Kategori ditambahkan ke formulir. Klik Simpan pengaturan untuk menyimpannya.')) setNewName('');
  }
  function removeName(name: string) {
    if (name === UNCATEGORIZED) return;
    update({ ...draft, names: draft.names.filter(item => item !== name) },
      `Kategori “${name}” dihapus dari pilihan. Catatan lama tetap utuh; aturan ke kategori ini tidak dijalankan.`);
  }
  function addRule() {
    const rule: CategoryRule = { id: makeId(), keyword: keyword.trim(), category: ruleCategory, mode: ruleMode };
    if (update({ ...draft, rules: [...draft.rules, rule] }, 'Aturan ditambahkan ke formulir. Klik Simpan pengaturan untuk menyimpannya.')) setKeyword('');
  }
  function changeRule(id: string, change: Partial<Pick<CategoryRule, 'keyword' | 'category' | 'mode'>>) {
    if (busyRef.current) return;
    // Keep partial keyword edits in this draft; full validation runs on save.
    setDraft(current => ({ ...current, rules: current.rules.map(rule => rule.id === id ? { ...rule, ...change } : rule) }));
    setError(''); setMessage('');
  }
  function addBundledKeywords() {
    if (busyRef.current) return;
    try {
      const merged = mergeCurrentCategoryKeywordPack(validateCategorySettings(draft));
      const bank = mergeCurrentAutomaticBankMappings(merged.settings);
      update({ ...bank.settings, keywordPackVersion: 5 }, `${merged.added + bank.added} kata kunci ditambahkan dan ${merged.updated + bank.updated} pemetaan bawaan disesuaikan di formulir. Aturan pribadi dipertahankan. Klik Simpan pengaturan untuk menyimpan.`);
    } catch (error) { setError(errorMessage(error)); }
  }
  async function save() {
    if (busyRef.current) return;
    let checked: CategorySettings;
    try { checked = validateCategorySettings(draft); }
    catch (reason) { setError(errorMessage(reason)); return; }
    busyRef.current = true; setPending('save'); setError(''); setMessage('');
    let saved = false;
    try {
      saved = await onSave(checked);
      if (!saved) setError('Pengaturan belum tersimpan. Formulir ini tetap dipertahankan; periksa pesan penyimpanan lalu coba lagi.');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { busyRef.current = false; setPending(null); }
    if (saved) onClose();
  }
  function exportSettings() {
    if (busyRef.current) return;
    try {
      const text = categorySettingsExport(draft);
      if (new TextEncoder().encode(text).byteLength > CATEGORY_SETTINGS_LIMIT) throw new Error('Ekspor pengaturan maksimal 128 KiB.');
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = `uangku-pengaturan-kategori-${new Date().toISOString().slice(0, 10)}.json`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setError(''); setMessage('Pengaturan dalam formulir diunduh. File ini terpisah dari cadangan transaksi.');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  async function importSettings(file?: File) {
    if (!file || busyRef.current) return;
    busyRef.current = true; setPending('read'); setError(''); setMessage('');
    try {
      if (file.size > CATEGORY_SETTINGS_LIMIT) throw new Error('File pengaturan maksimal 128 KiB.');
      const raw = await file.text();
      const checked = parseCategorySettingsExport(raw);
      setDraft(checked); setNewName(''); setKeyword('');
      setMessage('Pengaturan dimuat ke formulir. Belum mengganti pengaturan tersimpan; tinjau lalu klik Simpan pengaturan.');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { busyRef.current = false; setPending(null); if (fileRef.current) fileRef.current.value = ''; }
  }

  return <Modal title="Kelola kategori" subtitle="Kategori dan aturan milikmu, tersimpan di browser ini." onClose={close}>
    <div className="category-manager" aria-busy={pending !== null}>
      <div className="modal-body">
        <p className="category-manager-intro">Pengaturan ini mengatur pilihan kategori dan pencocokan keterangan. Nominal, tanggal, jenis transaksi, dan fakta bank tidak diubah di sini.</p>
        {notice && <p className="notice warning">{notice}</p>}
        {message && <p className="notice success" role="status">{message}</p>}
        <fieldset disabled={pending !== null}>
          <section className="category-manager-section" aria-label="Daftar kategori">
            <h3>Kategori aktif <span>{draft.names.length}/100</span></h3>
            <p className="field-help">Hapus untuk mengurangi pilihan. Nama pada catatan lama tetap disimpan. Tambahkan nama yang sama untuk mengaktifkannya kembali.</p>
            <div className="category-manager-add">
              <label className="field"><span className="field-label">Nama kategori baru</span><input className="field-input" aria-label="Nama kategori baru" maxLength={80} value={newName} placeholder="Contoh: Belanja kebutuhan harian" onChange={event => setNewName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addName(); } }} /></label>
              <button type="button" className="button secondary" disabled={draft.names.length >= 100 || !newName.trim()} onClick={addName}><Plus size={16} /> Tambah kategori</button>
            </div>
            <ul className="category-manager-names">{draft.names.map(name => <li key={name}><span>{name}</span>{name === UNCATEGORIZED ? <small>Kategori dasar</small> : <button type="button" className="icon-button" aria-label={`Hapus kategori ${name}`} title="Hapus dari pilihan; catatan lama tetap disimpan" onClick={() => removeName(name)}><Trash2 size={16} /></button>}</li>)}</ul>
          </section>
          <section className="category-manager-section" aria-label="Aturan kategori">
            <h3>Aturan kata kunci <span>{draft.rules.length}/200</span></h3>
            <button type="button" className="button secondary small" onClick={addBundledKeywords}>Tambahkan kata kunci bawaan</button>
            <p className="field-help">Aturan memakai kata atau frasa, bukan kode. Mode Otomatis boleh mengisi kategori jika cocok dengan jelas; kecocokan yang bertentangan tetap menjadi saran. Pilihan kategori manual dipertahankan.</p>
            <div className="category-rule-create">
              <label className="field"><span className="field-label">Kata kunci baru</span><input className="field-input" aria-label="Kata kunci aturan baru" value={keyword} maxLength={100} placeholder="Contoh: nama toko" onChange={event => setKeyword(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addRule(); } }} /><span className="field-help">3–100 karakter.</span></label>
              <label className="field"><span className="field-label">Kategori tujuan</span><select className="select-input" aria-label="Kategori aturan baru" value={ruleCategory} onChange={event => setRuleCategory(event.target.value)}>{ruleNames.map(name => <option key={name}>{name}</option>)}</select></label>
              <label className="field"><span className="field-label">Cara menerapkan</span><select className="select-input" aria-label="Mode aturan baru" value={ruleMode} onChange={event => setRuleMode(event.target.value as CategoryRule['mode'])}><option value="auto">Otomatis jika cocok jelas</option><option value="suggest">Saran saja</option></select></label>
              <button type="button" className="button secondary" disabled={draft.rules.length >= 200 || keyword.trim().length < 3 || !ruleCategory} onClick={addRule}><Plus size={16} /> Tambah aturan</button>
            </div>
            {draft.rules.length ? <ol className="category-manager-rules">{draft.rules.map((rule, index) => {
              const inactive = !draft.names.includes(rule.category);
              return <li key={rule.id}>
                <label className="field"><span className="field-label">Kata kunci {index + 1}</span><input className="field-input" aria-label={`Kata kunci aturan ${index + 1}`} maxLength={100} value={rule.keyword} onChange={event => changeRule(rule.id, { keyword: event.target.value })} /></label>
                <label className="field"><span className="field-label">Kategori</span><select className="select-input" aria-label={`Kategori aturan ${index + 1}`} value={rule.category} onChange={event => changeRule(rule.id, { category: event.target.value })}>{inactive && <option value={rule.category}>{rule.category} (tidak aktif)</option>}{ruleNames.map(name => <option key={name}>{name}</option>)}</select></label>
                <label className="field"><span className="field-label">Mode</span><select className="select-input" aria-label={`Mode aturan ${index + 1}`} value={rule.mode} onChange={event => changeRule(rule.id, { mode: event.target.value as CategoryRule['mode'] })}><option value="auto">Otomatis jika cocok jelas</option><option value="suggest">Saran saja</option></select></label>
                <button type="button" className="button danger small category-rule-delete" aria-label={`Hapus aturan ${index + 1}: ${rule.keyword}`} onClick={() => update({ ...draft, rules: draft.rules.filter(item => item.id !== rule.id) })}><Trash2 size={15} /> Hapus aturan</button>
                {inactive && <p className="field-help category-rule-inactive">Kategori tidak aktif. Aturan ini diabaikan sampai kategori diaktifkan kembali atau tujuan aturan diganti.</p>}
              </li>;
            })}</ol> : <p className="field-help">Belum ada aturan. Tambahkan kata kunci dan kategori tujuan untuk mengaktifkan pencocokan.</p>}
          </section>
          <section className="category-manager-section" aria-label="Cadangan pengaturan kategori">
            <h3>Simpan pengaturan terpisah</h3>
            <p className="field-help">Cadangan transaksi belum menyertakan daftar pilihan dan aturan kategori ini. Ekspor pengaturan agar kategori yang belum dipakai serta aturan pribadi ikut tersimpan. Nama kategori yang sudah dipakai tetap ada dalam cadangan transaksi.</p>
            <div className="category-manager-files"><button type="button" className="button secondary" onClick={exportSettings}><Download size={16} /> Ekspor pengaturan kategori</button><button type="button" className="button secondary" onClick={() => fileRef.current?.click()}><Upload size={16} /> Impor pengaturan kategori</button></div>
            <input ref={fileRef} type="file" accept=".json,application/json" className="category-settings-file" aria-label="File pengaturan kategori" onChange={event => void importSettings(event.target.files?.[0])} />
            <p className="field-help">Impor maksimal 128 KiB; hanya mengganti formulir sampai kamu menyimpan.</p>
          </section>
        </fieldset>
        {pending && <p className="notice" role="status">{pending === 'save' ? 'Sedang menyimpan pengaturan…' : 'Sedang membaca pengaturan…'}</p>}
        {error && <div ref={errorRef} tabIndex={-1} className="notice error" role="alert">{error}</div>}
      </div>
      <div className="modal-footer"><button type="button" className="button secondary" disabled={pending !== null} onClick={close}>Batal</button><button type="button" className="button primary" disabled={pending !== null} onClick={() => void save()}><Check size={16} /> Simpan pengaturan</button></div>
    </div>
  </Modal>;
}
