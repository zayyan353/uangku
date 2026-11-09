# Alur kerja Uangku

## Rilis

- Branch utama adalah `main`. Push ke `main` otomatis menerbitkan situs
  (`zayyan353.github.io/uangku`) lewat workflow **Publikasikan Uangku**.
- Jangan push langsung ke `main`. Kerjakan perubahan di branch sendiri, lalu buka
  pull request ke `main`. Merge hanya setelah CI (**Periksa Uangku**, termasuk tes
  browser) hijau.
- Kerjakan satu micro-work (MW) dari `MICRO_TASKS.md` per branch/PR. Jangan
  gabungkan beberapa MW, dan jangan ubah file di luar lingkup MW kecuali wajib.
- Sebelum push: `npm test` dan `npm run build` harus lulus. Untuk perubahan UI,
  jalankan juga tes browser yang relevan di `tests/*_browser.py` terhadap
  `npm run preview` bila memungkinkan.
- Centang MW di `MICRO_TASKS.md` dalam commit yang sama dengan pekerjaannya.

## Data dan keamanan

- Pertahankan checkpoint/cadangan lama. Jangan menghapus file lama hanya karena
  tidak dapat dibaca atau belum lengkap; pindahkan ke `docs/archive/` bila perlu.
- Gunakan data sintetis dan profil browser pengujian baru. Jangan membaca cadangan
  keuangan asli atau kredensial tanpa kebutuhan dan izin yang jelas dari pengguna.
- Fakta bank dipertahankan terpisah dari anotasi/koreksi pengguna. Tanggal/asosiasi
  legacy yang tidak diketahui tidak boleh ditebak.
- Setiap penulisan melalui controller dengan Web Locks dan pemeriksaan token. UI
  sukses hanya sesudah penyimpanan berhasil. Pertahankan draft pemulihan saat gagal.
- Uji batas kapasitas dan overflow; penolakan tidak boleh menimpa data tersimpan.
  Pertahankan format v1 dan roundtrip format metadata yang dikenali.

## Pengujian dan laporan

- Pengujian browser harus memakai build produksi dengan hash yang sesuai. Simpan
  kegagalan, batas pengujian, dan hasil per kandidat secara jujur.
- Hasil tes historis bukan bukti tes pada kode sekarang. Laporkan angka aktual dan
  masalah yang belum terbukti selesai.

## Cadangan

- Riwayat source tersimpan di GitHub. Cadangan source tambahan di luar GitHub
  hanya dibuat atas permintaan pengguna; jangan sertakan `node_modules`, cache,
  kredensial, atau data pribadi.
- Cadangan kode tidak menggantikan cadangan transaksi browser. Data transaksi
  hanya ada di browser pengguna dan dicadangkan lewat tombol Cadangkan di aplikasi.
