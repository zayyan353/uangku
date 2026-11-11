import { useEffect, useMemo, useState } from 'react';
import { formatDate, formatMoney } from '../lib/finance';
import { inspectStoredStatement, prepareStatementCompletion } from '../lib/reconciliation';
import { executeTransferCommand } from '../lib/transferCommands';
import type { SourceStatement } from '../lib/sourceModel';
import type { StoredData } from '../lib/storage';
import { isWalletArchived, archivedReadOnlyEntryIds } from '../lib/walletLifecycle';

type Commit = (next: StoredData) => Promise<boolean>;
function StatementCard({ data, statement, commit, disabled, order }: { data: StoredData; statement: SourceStatement; commit: Commit; disabled: boolean; order: number }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [rebase, setRebase] = useState(false);
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const [proposal, setProposal] = useState<{ base: StoredData; next: StoredData } | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setProposal(null); setError(''); }, [data, reason, rebase, includeExcluded]);
  // The status on the closed row is worked out after the page has painted, one card at a time, so a long
  // ledger does not delay the import page; opening the card computes it at once.
  const [summarised, setSummarised] = useState(false);
  useEffect(() => { setSummarised(false); const id = window.setTimeout(() => setSummarised(true), 150 + order * 60); return () => window.clearTimeout(id); }, [data, statement.id, order]);
  const inspection = useMemo(() => {
    if (!open && !summarised) return null;
    try { return inspectStoredStatement(data, statement.id); } catch { return null; }
  }, [open, summarised, data, statement.id]);
  const matched = !!inspection && inspection.quality.status === 'complete' && inspection.difference === 0;
  const after = useMemo(() => proposal ? inspectStoredStatement(proposal.next, statement.id) : null, [proposal, statement.id]);
  const wallet = data.state.wallets.find(item => item.id === statement.walletId)!;
  function preview() {
    try {
      if (!reason.trim()) throw new Error('Isi alasan pelengkapan terlebih dahulu.');
      const next = prepareStatementCompletion(data, statement.id, { reason: reason.trim(), at: new Date().toISOString(), rebase, includeExcluded });
      setProposal({ base: data, next }); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Pelengkapan belum dapat disiapkan.'); }
  }
  async function save() {
    if (!proposal || disabled || saving) return;
    if (proposal.base !== data) { setProposal(null); setError('Catatan berubah; baca ulang pratinjau.'); return; }
    setSaving(true);
    try { if (await commit(proposal.next)) setProposal(null); else setError('Pelengkapan belum tersimpan. Periksa status simpan sebelum mencoba lagi.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Pelengkapan belum tersimpan.'); }
    finally { setSaving(false); }
  }
  const status = !inspection ? null : matched ? { tone: 'positive', text: 'Cocok' }
    : inspection.difference !== null && inspection.difference !== 0 ? { tone: 'warning', text: `Selisih ${formatMoney(Math.abs(inspection.difference), wallet.currency)}` }
    : inspection.quality.status === 'incomplete' ? { tone: 'warning', text: 'Belum lengkap' } : { tone: 'neutral', text: 'Belum terverifikasi' };
  return <details onToggle={event => setOpen(event.currentTarget.open)} className="panel statement-card">
    <summary><span className="statement-card-title">{wallet.name}{isWalletArchived(data, wallet.id) ? ' · Arsip (baca saja)' : ''} · {formatDate(statement.periodStart)} – {formatDate(statement.periodEnd)} · {statement.rowIds.length} mutasi sumber</span>{status && <span className={`badge ${status.tone}`} data-testid="statement-status">{status.text}</span>}</summary>
    {open && inspection && <div className="statement-card-body">
      <p>Saldo penutupan file: <strong>{formatMoney(statement.closingBalance, wallet.currency)}</strong> · saldo catatan pada penutupan: <strong>{inspection.projectedBalance === null ? 'Belum dapat dipastikan' : formatMoney(inspection.projectedBalance, wallet.currency)}</strong>.</p>
      <p className="field-help">Titik awal saldo: {inspection.baseline.status === 'approved' ? 'disetujui' : 'belum terverifikasi'} · kelengkapan terhadap file tersimpan: {inspection.quality.status === 'complete' ? 'lengkap' : inspection.quality.status === 'incomplete' ? 'belum lengkap' : 'belum terverifikasi'}. Ini bukan klaim seluruh histori rekening sudah tersedia.</p>
      {inspection.quality.reasons.map(text => <p key={text} className="notice warning">{text}</p>)}
      {matched ? <p className="notice success" data-testid="statement-complete">Catatan sudah lengkap dan saldonya cocok dengan file ini. Tidak ada yang perlu dilengkapi.</p> : <fieldset disabled={disabled || saving} style={{ border: 0, padding: 0, margin: 0 }}>
        <label className="field"><span className="field-label">Alasan pelengkapan</span><input aria-label={`Alasan pelengkapan ${statement.id}`} className="field-input" maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <label className="checkbox-row"><input type="checkbox" checked={rebase} onChange={event => setRebase(event.target.checked)} />Saya menyetujui titik awal saldo dari file ini bila diperlukan. Saldo awal dapat berubah; kesinambungan sumber tetap diperiksa.</label>
        <label className="checkbox-row"><input type="checkbox" checked={includeExcluded} onChange={event => setIncludeExcluded(event.target.checked)} />Sertakan mutasi yang sebelumnya saya tandai dilewati. Mutasi yang dihapus tetap memerlukan pemulihan tersendiri.</label>
        <button className="button secondary small" onClick={preview}>Pratinjau pelengkapan</button>
        {after && proposal && <div className={`notice completion-preview ${after.difference === 0 ? 'success' : 'warning'}`} role="status"><strong>Hasil pratinjau, belum disimpan</strong><p>{proposal.next.state.entries.length - data.state.entries.length} transaksi akan ditambahkan. Saldo penutupan usulan: <strong>{after.projectedBalance === null ? 'Belum dapat dipastikan' : formatMoney(after.projectedBalance, wallet.currency)}</strong> · selisih dengan file: {after.difference === null ? 'belum dapat dipastikan' : formatMoney(after.difference, wallet.currency)}.</p><p className="field-help">Periksa sebelum menyimpan. Data bank dan koreksi pengguna tetap disimpan terpisah.</p><button className="button primary small" onClick={() => void save()}>{saving ? 'Menyimpan…' : 'Lengkapi dan simpan'}</button></div>}
      </fieldset>}
      {error && <p className="notice error" role="alert">{error}</p>}
    </div>}
  </details>;
}

export default function StatementReview({ data, onCommit, disabled }: { data: StoredData; onCommit: Commit; disabled: boolean }) {
  const [limit, setLimit] = useState(10);
  const readOnlyEntryIds = useMemo(() => archivedReadOnlyEntryIds(data), [data]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const active = new Set(data.state.wallets.filter(wallet => wallet.kind !== 'cash').map(wallet => wallet.id));
  const statements = (data.metadata?.statements ?? []).filter(statement => active.has(statement.walletId));
  const deleted = (data.metadata?.deletedTransfers ?? []).filter(item => active.has(item.entry.walletId) && (!item.entry.toWalletId || active.has(item.entry.toWalletId)));
  if (!statements.length && !deleted.length) return null;
  async function restore(entryId: string) {
    try {
      if (!reason.trim()) throw new Error('Isi alasan pemulihan transfer.');
      const next = executeTransferCommand(data, { kind: 'restore-deleted', entryId, reason: reason.trim(), at: new Date().toISOString() });
      if (!await onCommit(next)) throw new Error('Pemulihan belum tersimpan. Periksa status penyimpanan.');
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Transfer belum dapat dipulihkan.'); }
  }
  return <section className="panel statement-review" aria-label="Rekonsiliasi file tersimpan">
    <div className="panel-header"><div><h2>Periksa kelengkapan mutasi</h2><p>Bandingkan saldo catatan dengan saldo di file mutasi yang sudah kamu simpan. Bila ada mutasi di file yang belum menjadi transaksi, lengkapi dari sini; hasilnya selalu ditampilkan dulu sebelum disimpan.</p></div></div>
    {statements.slice(-limit).reverse().map((statement, index) => <StatementCard key={statement.id} order={index} data={data} statement={statement} commit={onCommit} disabled={disabled || isWalletArchived(data, statement.walletId)} />)}
    {statements.length > limit && <button className="button secondary small" onClick={() => setLimit(value => value + 10)}>Tampilkan file sumber sebelumnya</button>}
    {deleted.length > 0 && <div className="deleted-transfers"><h3>Transfer dari mutasi bank yang dihapus</h3><p className="field-help">Data banknya masih tersimpan. Memulihkan mengembalikan seluruh transfer: kedua sisi, kedua tanggal, biaya, dan koreksinya.</p><label className="field"><span className="field-label">Alasan pemulihan transfer</span><input className="field-input" aria-label="Alasan pemulihan transfer" maxLength={2000} value={reason} disabled={disabled} onChange={event => setReason(event.target.value)} /><span className="field-help">Isi alasan dulu; tombol Pulihkan aktif setelah itu.</span></label><ul className="deleted-transfer-list">{deleted.slice(0, 20).map(item => {
      const from = data.state.wallets.find(wallet => wallet.id === item.entry.walletId), to = data.state.wallets.find(wallet => wallet.id === item.entry.toWalletId);
      return <li key={item.entry.id}><span className="deleted-transfer-copy"><strong>{item.entry.note || 'Transfer'}</strong><span>{formatDate(item.entry.date)}{from ? ` · ${formatMoney(item.entry.amount, from.currency)} · ${from.name}${to ? ` → ${to.name}` : ''}` : ''}</span><span>Alasan dihapus: {item.reason}</span></span><button className="button secondary small" disabled={disabled || !reason.trim() || readOnlyEntryIds.has(item.entry.id) || isWalletArchived(data, item.entry.walletId) || !!item.entry.toWalletId && isWalletArchived(data, item.entry.toWalletId)} onClick={() => void restore(item.entry.id)}>Pulihkan seluruh transfer</button></li>;
    })}</ul>{deleted.length > 20 && <p className="field-help">{deleted.length - 20} transfer lain belum ditampilkan; pulihkan yang di atas dulu.</p>}</div>}
    {error && <p className="notice error" role="alert">{error}</p>}
  </section>;
}
