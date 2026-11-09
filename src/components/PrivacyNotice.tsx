import { Modal } from './Modal';
import { persistenceLabel, type PersistenceStatus } from '../lib/storagePersistence';
/** Plain-language boundary disclosure. This component performs no storage writes. */
export function PrivacyNotice({ onClose, persistence = 'not-requested' }: { onClose: () => void; persistence?: PersistenceStatus }) {
  const persistenceText = persistenceLabel(persistence);
  return <Modal title="Privasi dan cadangan" subtitle="Pahami tempat catatanmu disimpan" onClose={onClose}>
    <div className="modal-body privacy-notice">
      <p data-testid="storage-persistence" data-status={persistence}><strong>Penyimpanan persisten: {persistenceText.answer}.</strong> {persistenceText.detail}</p>
      <p><strong>Catatan lokal mengikuti origin dan profil browser.</strong> Origin adalah gabungan protokol, nama host, dan port. Path berbeda pada origin yang sama berbagi penyimpanan; misalnya dua halaman di zayyan353.github.io tidak otomatis terpisah.</p>
      <p>Gunakan profil browser dan situs yang kamu percayai. Script lain pada origin yang sama dapat mengakses penyimpanan yang sama. Aplikasi ini tidak menyediakan pemisahan dengan akun atau enkripsi data lokal.</p>
      <p><strong>Cadangan JSON dapat dibaca.</strong> File berisi transaksi dan fakta sumber keuangan. Simpan di tempat pribadi; jangan unggah ke repository publik atau bagikan sembarangan.</p>
      <p>Setiap profil browser dan alamat situs menyimpan catatannya sendiri. Menghapus data situs dapat menghapus catatan lokal. Untuk pindah tempat, pilih Cadangkan semuanya. Gunakan Pulihkan cadangan di tujuan, periksa jumlah dompet, transaksi, kategori, dan aturan, lalu pilih Pulihkan semuanya.</p>
      <p data-testid="home-screen-help"><strong>Tambah ke Layar Utama.</strong> Di iPhone: Safari → Bagikan → Tambah ke Layar Utama. Di Android: Chrome → menu ⋮ → Instal aplikasi. <strong>Di iPhone, aplikasi dari Layar Utama punya penyimpanan terpisah dari Safari</strong>, jadi catatan di Safari tidak ikut pindah dan aplikasinya akan tampak kosong; datamu tidak hilang. Pindahkan dengan: Cadangkan semuanya di Safari → buka Uangku dari Layar Utama → Pulihkan cadangan → Pulihkan semuanya. Setelah itu, catat di satu tempat saja supaya catatan tidak terpecah.</p>
      <p>Jika beberapa project pada origin yang sama memiliki pengelola atau script yang tidak kamu percayai bersama, gunakan origin tersendiri. Perpindahan origin belum dilakukan oleh aplikasi ini.</p>
    </div>
    <div className="modal-footer"><button className="button secondary" onClick={onClose}>Tutup penjelasan privasi</button></div>
  </Modal>;
}
