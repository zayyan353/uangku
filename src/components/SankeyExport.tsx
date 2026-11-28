import { useState } from 'react';
import type { CashflowReport } from '../lib/cashflowReport';
import type { Currency } from '../lib/finance';
import { sankeyText } from '../lib/sankeyText';
import Modal from './Modal';
import { usePrivacyAmounts } from './PrivacyAmounts';

interface Preview { text: string; status: 'copying' | 'copied' | 'manual' }
const notices = {
  copying: 'Menyalin teks…',
  copied: 'Teks disalin. Tempelkan di SankeyMATIC untuk membuat diagram.',
  manual: 'Clipboard tidak tersedia. Pilih teks diagram untuk salin manual.',
};

function DiagramText({ text }: { text: string }) {
  return <label className="field"><span className="field-label">Teks diagram</span>
    <textarea className="field-input" readOnly rows={7} value={text} data-autofocus onFocus={event => event.currentTarget.select()} />
  </label>;
}

function ManualCopy({ text }: { text: string }) {
  const [revealed, setRevealed] = useState(false);
  return <>
    <button type="button" className="button secondary small" aria-expanded={revealed} onClick={() => setRevealed(!revealed)}>
      {revealed ? 'Samarkan kembali teks diagram' : 'Tampilkan teks beserta nominal untuk salin manual'}
    </button>
    {revealed && <DiagramText text={text} />}
  </>;
}

export default function SankeyExport({ report, currency, month }: { report: CashflowReport; currency: Currency; month: string }) {
  const { hidden } = usePrivacyAmounts();
  const [preview, setPreview] = useState<Preview | null>(null);
  async function copy() {
    const opened: Preview = { text: sankeyText(report, currency, month), status: 'copying' };
    setPreview(opened);
    let status: Preview['status'];
    try {
      await navigator.clipboard.writeText(opened.text);
      status = 'copied';
    } catch {
      status = 'manual';
    }
    // A late clipboard response belongs only to the preview that requested it.
    setPreview(current => current === opened ? { ...opened, status } : current);
  }
  return <>
    <button type="button" className="button secondary small" onClick={() => void copy()}>Salin untuk SankeyMATIC</button>
    {preview && <Modal title="Ekspor untuk SankeyMATIC" onClose={() => setPreview(null)}>
      <div className="modal-body">
        <p role="status" className="field-help">{notices[preview.status]}</p>
        {hidden
          ? preview.status === 'manual' && <ManualCopy text={preview.text} />
          : <DiagramText text={preview.text} />}
      </div>
      <div className="modal-footer">
        <a className="button secondary" href="https://sankeymatic.com/build/" target="_blank" rel="noopener noreferrer">Buka SankeyMATIC</a>
        <button type="button" className="button primary" onClick={() => setPreview(null)}>Selesai</button>
      </div>
    </Modal>}
  </>;
}
