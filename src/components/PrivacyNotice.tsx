import { Modal } from './Modal';
import { persistenceLabel, type PersistenceStatus } from '../lib/storagePersistence';
import { storageUsageText, STORAGE_WARNING_PERCENT, type StorageUsage } from '../lib/storageUsage';
/** Plain-language boundary disclosure. This component performs no storage writes. */
export function PrivacyNotice({ onClose, persistence = 'not-requested', usage = null }: { onClose: () => void; persistence?: PersistenceStatus; usage?: StorageUsage | null }) {
  const persistenceText = persistenceLabel(persistence);
  return <Modal title="Privasi dan cadangan" subtitle="Pahami tempat catatanmu disimpan" onClose={onClose}>
    <div className="modal-body privacy-notice">
      <h3>Di mana catatanmu disimpan</h3>
      <p>Hanya di browser ini, di perangkat ini. Uangku tidak memerlukan akun. Saat kamu kembali ke jendela Uangku, browser memeriksa versi terbaru di alamat situs yang sama. Permintaan itu tidak menyertakan isi catatan, file, pengaturan, atau cookie. Browser atau profil lain, juga alamat situs lain, punya catatannya sendiri.</p>
      <p data-testid="storage-persistence" data-status={persistence}><strong>Penyimpanan persisten: {persistenceText.answer}.</strong> {persistenceText.detail}</p>
      {usage && <p data-testid="storage-usage" data-level={usage.level}><strong>Ruang penyimpanan: {usage.percent}% terpakai.</strong><meter className="storage-meter" aria-label="Ruang penyimpanan terpakai" min={0} max={usage.quotaChars} low={usage.quotaChars * STORAGE_WARNING_PERCENT / 100} high={usage.quotaChars * 0.9} optimum={0} value={Math.min(usage.usedChars, usage.quotaChars)} /> {storageUsageText(usage)}, dihitung dari semua yang tersimpan di alamat situs ini. Bila penuh, simpan atau impor berikutnya ditolak dan catatan yang sudah tersimpan tetap utuh. Batas ini berlaku di Chrome dan Edge; batas browser lain belum diukur dan bisa lebih kecil.</p>}
      <h3>Supaya tidak hilang</h3>
      <p>Menghapus data situs di browser ikut menghapus catatan. Safari dapat menghapus catatan setelah 7 hari penggunaan Safari tanpa interaksi dengan Uangku. Pilih <strong>Cadangkan semuanya</strong> secara berkala dan simpan filenya di tempat pribadi. File cadangan berisi transaksi dan data mutasi bank dalam bentuk yang bisa dibaca siapa pun yang memegangnya; jangan dibagikan atau diunggah ke tempat umum.</p>
      <h3>Pindah perangkat atau browser</h3>
      <p>Di tempat lama pilih Cadangkan semuanya. Di tempat baru pilih Pulihkan cadangan, periksa jumlah dompet, transaksi, kategori, dan aturan, lalu pilih Pulihkan semuanya.</p>
      <h3>Tambah ke Layar Utama</h3>
      <p data-testid="home-screen-help">Di iPhone: Safari → Bagikan → Tambah ke Layar Utama. Di Android: Chrome → menu ⋮ → Instal aplikasi. <strong>Di iPhone, aplikasi dari Layar Utama punya penyimpanan terpisah dari Safari</strong>, jadi catatan di Safari tidak ikut pindah dan aplikasinya akan tampak kosong; datamu tidak hilang. Pindahkan dengan: Cadangkan semuanya di Safari → buka Uangku dari Layar Utama → Pulihkan cadangan → Pulihkan semuanya. Setelah itu, catat di satu tempat saja supaya catatan tidak terpecah.</p>
      <details className="privacy-technical"><summary>Detail teknis</summary>
        <p><strong>Catatan lokal mengikuti origin dan profil browser.</strong> Origin adalah gabungan protokol, nama host, dan port. Path berbeda pada origin yang sama berbagi penyimpanan; misalnya dua halaman di zayyan353.github.io tidak otomatis terpisah.</p>
        <p>Gunakan profil browser dan situs yang kamu percayai. Script lain pada origin yang sama dapat mengakses penyimpanan yang sama. Aplikasi ini tidak menyediakan pemisahan dengan akun atau enkripsi data lokal.</p>
        <p>Jika beberapa project pada origin yang sama memiliki pengelola atau script yang tidak kamu percayai bersama, gunakan origin tersendiri. Perpindahan origin belum dilakukan oleh aplikasi ini.</p>
      </details>
    </div>
    <div className="modal-footer"><button className="button secondary" onClick={onClose}>Tutup penjelasan privasi</button></div>
  </Modal>;
}
