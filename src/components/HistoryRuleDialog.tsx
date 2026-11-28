import { useRef, useState } from 'react';
import { createCategoryMatcher, normalizeCategoryKeyword, type CategoryRule } from '../lib/categorization';
import { normalizeBankDescription } from '../lib/bankDescription';
import type { CategorySettings } from '../lib/categorySettings';
import { makeId } from '../lib/finance';
import { FailureText } from './FailureText';
import Modal from './Modal';
import { usePrivacyAmounts } from './PrivacyAmounts';

export interface HistoryRuleSource { merchant: string; description: string; category: string }

function initialKeyword({ merchant, description }: HistoryRuleSource) {
  const wording = ` ${normalizeBankDescription(description)} `;
  // Jago sometimes joins GO-FOOD to the first word of the merchant name.
  return [merchant, `food${merchant}`].find(phrase =>
    phrase.length >= 3 && phrase.length <= 100 && wording.includes(` ${phrase} `)) ?? '';
}

export default function HistoryRuleDialog({ source, settings, blocked, onSave, onClose }: {
  source: HistoryRuleSource; settings: CategorySettings; blocked: string;
  onSave: (rule: CategoryRule) => Promise<void>; onClose: () => void;
}) {
  const { hidden } = usePrivacyAmounts();
  const [keyword, setKeyword] = useState(() => initialKeyword(source));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);

  async function save() {
    if (blocked || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      const rule: CategoryRule = { id: makeId(), keyword: keyword.trim(), category: source.category, mode: 'suggest' };
      const phrase = normalizeCategoryKeyword(rule.keyword);
      if (settings.rules.some(existing => normalizeCategoryKeyword(existing.keyword) === phrase)) throw Error('Kata kunci ini sudah dipakai dalam aturan.');
      if (createCategoryMatcher([rule], settings.names)(source.description).kind !== 'suggestions') throw Error('Pilih kata atau frasa utuh yang cocok dengan keterangan transaksi ini.');
      await onSave(rule);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Aturan saran belum tersimpan.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return <Modal title="Jadikan aturan" onClose={() => { if (!saving.current) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="modal-body">
        <p>Gunakan kata kunci ini untuk menyarankan kategori <strong>{source.category}</strong>.</p>
        <p className="field-help">{hidden ? 'Keterangan transaksi disamarkan.' : source.description}</p>
        <label className="field"><span className="field-label">Kata kunci</span>
          <input className="field-input" required minLength={3} maxLength={100} value={keyword}
            disabled={busy} onChange={event => { setKeyword(event.target.value); setError(''); }} />
        </label>
        {(error || blocked) && <div className="notice error" role="alert"><FailureText text={error || blocked} /></div>}
      </div>
      <div className="modal-footer">
        <button type="button" className="button secondary" disabled={busy} onClick={onClose}>Batal</button>
        <button className="button primary" disabled={busy || !!blocked}>Simpan aturan saran</button>
      </div>
    </form>
  </Modal>;
}
