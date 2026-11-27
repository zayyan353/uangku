import { useState } from 'react';
import type { CashflowReport } from '../lib/cashflowReport';
import type { Currency } from '../lib/finance';
import { sankeyText } from '../lib/sankeyText';
import Modal from './Modal';

interface Preview { text: string; notice: string }

export default function SankeyExport({ report, currency, month }: { report: CashflowReport; currency: Currency; month: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  async function copy() {
    const opened = { text: sankeyText(report, currency, month), notice: 'Menyalin teks…' };
    setPreview(opened);
    let notice: string;
    try {
      await navigator.clipboard.writeText(opened.text);
      notice = 'Teks disalin. Tempelkan di SankeyMATIC untuk membuat diagram.';
    } catch {
      notice = 'Clipboard tidak tersedia. Pilih teks diagram untuk salin manual.';
    }
    // A late clipboard response belongs only to the preview that requested it.
    setPreview(current => current === opened ? { ...opened, notice } : current);
  }
  return <>
    <button type="button" className="button secondary small" onClick={() => void copy()}>Salin untuk SankeyMATIC</button>
    {preview && <Modal title="Ekspor untuk SankeyMATIC" onClose={() => setPreview(null)}>
      <div className="modal-body">
        <p role="status" className="field-help">{preview.notice}</p>
        <label className="field"><span className="field-label">Teks diagram</span>
          <textarea className="field-input" readOnly rows={7} value={preview.text} data-autofocus onFocus={event => event.currentTarget.select()} />
        </label>
      </div>
      <div className="modal-footer">
        <a className="button secondary" href="https://sankeymatic.com/build/" target="_blank" rel="noopener noreferrer">Buka SankeyMATIC</a>
        <button type="button" className="button primary" onClick={() => setPreview(null)}>Selesai</button>
      </div>
    </Modal>}
  </>;
}
