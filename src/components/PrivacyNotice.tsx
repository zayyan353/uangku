import { Modal } from './Modal';
/** Plain-language boundary disclosure. This component performs no storage writes. */
export function PrivacyNotice({ onClose }: { onClose: () => void }) {
  return <Modal title="Privasi dan cadangan" subtitle="Pahami tempat catatanmu disimpan" onClose={onClose}>
    <div className="modal-body privacy-notice">
      <p><strong>Catatan lokal mengikuti origin dan profil browser.</strong> Origin adalah gabungan protokol, nama host, dan port. Path berbeda pada origin yang sama berbagi penyimpanan; misalnya dua halaman di zayyan353.github.io tidak otomatis terpisah.</p>
      <p>Gunakan profil browser dan situs yang kamu percayai. Script lain pada origin yang sama dapat mengakses penyimpanan yang sama. Aplikasi ini tidak menyediakan pemisahan dengan akun atau enkripsi data lokal.</p>
      <p><strong>Cadangan JSON dapat dibaca.</strong> File berisi transaksi dan fakta sumber keuangan. Simpan di tempat pribadi; jangan unggah ke repository publik atau bagikan sembarangan.</p>
      <p>Menghapus data situs/browser dapat menghapus catatan lokal. Profil, browser, atau perangkat lain memiliki penyimpanan berbeda dan tidak menerima sinkronisasi otomatis. Buat cadangan, lalu gunakan Pulihkan cadangan bila ingin memindahkan data; periksa hasilnya sebelum menghapus salinan lama.</p>
      <p>Jika beberapa project pada origin yang sama memiliki pengelola atau script yang tidak kamu percayai bersama, gunakan origin tersendiri. Perpindahan origin belum dilakukan oleh aplikasi ini.</p>
    </div>
    <div className="modal-footer"><button className="button secondary" onClick={onClose}>Tutup penjelasan privasi</button></div>
  </Modal>;
}
