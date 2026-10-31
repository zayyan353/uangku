# Alur kerja Uangku lokal

- Folder ini adalah satu salinan pengembangan aktif; branch kerja `local-rebuild`.
- Website online tidak boleh diubah, dan tidak boleh push, merge, atau deploy tanpa instruksi publikasi pengguna yang terpisah.
- Pertahankan checkpoint/cadangan lama. Jangan menghapus file lama hanya karena tidak dapat dibaca atau belum lengkap.
- Perubahan dilakukan per kelompok kecil sesuai dependensi. Jalankan pengujian terkait sebelum menyimpan checkpoint Git lokal.
- Gunakan data sintetis dan profil browser pengujian baru. Jangan membaca cadangan keuangan asli atau kredensial tanpa kebutuhan dan izin yang jelas dari pengguna.
- Fakta bank dipertahankan terpisah dari anotasi/koreksi pengguna. Tanggal/asosiasi legacy yang tidak diketahui tidak boleh ditebak.
- Setiap penulisan melalui controller dengan Web Locks dan pemeriksaan token. UI sukses hanya sesudah penyimpanan berhasil. Pertahankan draft pemulihan saat gagal.
- Uji batas kapasitas dan overflow; penolakan tidak boleh menimpa data tersimpan. Pertahankan format v1 dan roundtrip format metadata yang dikenali.
- Pengujian browser harus memakai build produksi dengan hash yang sesuai. Simpan kegagalan, batas pengujian, dan hasil per kandidat secara jujur.
- Hasil tes historis A–H bukan bukti tes pada kode sekarang. Laporkan angka aktual dan masalah yang belum terbukti selesai.
- Setelah tahap terverifikasi, simpan source ringkas, checksum, dan cadangan riwayat Git di luar folder aktif; uji bahwa cadangan dapat dipulihkan. Jangan sertakan node_modules, cache, kredensial, atau data pribadi.
- Cadangan kode tidak menggantikan cadangan transaksi browser. Cadangan luar PC memerlukan lokasi terpisah yang dipilih pengguna.
