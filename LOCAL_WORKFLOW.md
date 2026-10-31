# Uangku lokal

Folder ini menjadi satu tempat pengembangan aktif. Dasarnya adalah source repository
`zayyan353/uangku` pada commit `716229dba1928965bf971325b503eb9dfe0f341d`,
ditambah rekonstruksi minimum yang hash-nya telah diverifikasi, file historis yang
dapat dipakai, dan perbaikan lokal yang diuji ulang. Ini rekonstruksi; source cloud
G/H utuh belum berhasil diselamatkan.

## Menjalankan

Gunakan Node.js 24. Di Windows, buka `Jalankan-Uangku.cmd`, kemudian buka
<http://127.0.0.1:4180> pada browser PC. Alternatif dari terminal:

```sh
npm ci
npm test
npm run build
npm run preview
```

Server hanya mendengarkan loopback PC. Port 4180 dipakai secara tetap agar origin
penyimpanan tidak berubah tanpa sengaja. Mode pengembangan tersedia lewat `npm run dev`.
Hindari menjalankan dua versi aplikasi bersamaan pada origin yang sama.

## Menyimpan pekerjaan

Gunakan branch `local-rebuild`. Buat checkpoint Git setelah kelompok perubahan
lulus pemeriksaan terkait. Remote baca menunjuk repository asli, tetapi push URL
sengaja dinonaktifkan pada salinan kerja ini. Tidak ada push atau deployment yang
diperlukan untuk menjalankan lokal. Publikasi memerlukan keputusan pengguna terpisah.

Sesuai keputusan pengguna, paket ZIP/folder gabungan baru dan cadangan luar PC
ditunda sampai aplikasi lebih matang. Selama pengembangan, simpan checkpoint Git
lokal dan pertahankan seluruh cadangan lama. Arsip lama merepresentasikan
checkpoint saat dibuat, bukan otomatis versi fitur terbaru.

Simpan source dan riwayat Git dalam cadangan yang berbeda dari folder kerja aktif.
Periksa checksum dan uji pemulihan cadangan. Salinan pada disk PC yang sama belum
melindungi dari kerusakan atau kehilangan seluruh PC; cadangan luar PC perlu lokasi
terpisah yang dipilih pengguna.

## Data transaksi

Data keuangan tersimpan di browser, bukan otomatis di Git atau source ZIP. Gunakan
tombol Cadangkan, simpan JSON di tempat pribadi, lalu uji pemulihannya di profil
browser terpisah sebelum menghapus salinan lama. `private-data/`, XLSX, CSV, serta
nama backup/cadangan diabaikan Git; jangan memasukkan data asli ke source repository.

Saat berganti versi, cadangkan dahulu dan tutup/muat ulang tab versi lama. Data
bermetadata menggunakan format backup v2; pembaca lama tidak boleh dipakai menulis
di atasnya. Catatan v1 tanpa metadata tetap didukung. Fakta dan tanggal legacy yang
tidak tersedia tetap ditandai belum terverifikasi, tidak dibuat-buat.

## Pengujian

Tes unit: `npm test`. Tipe dan build: `npm run build`.
Pengujian browser memakai Python 3.12+, Playwright 1.64.1, Chrome/Chromium dan
context sintetis baru; tidak memakai profil browser atau rekening pribadi.
Jalankan preview produksi sebelum harness, kemudian:

```sh
python tests/browser_smoke.py
python tests/recovery_browser.py
python tests/ux_browser.py
python tests/theme_browser.py --output ../work/theme-browser
python tests/category_browser.py --output ../work/category-browser
python tests/keyword_pack_browser.py --output ../work/keyword-pack-browser
python tests/confirmed_mapping_browser.py --output ../work/confirmed-mapping-browser
python tests/bank_description_browser.py --output ../work/bank-description-browser
python tests/source_browser.py
python tests/source_browser.py --mobile
python tests/performance_browser.py
```

Di PC ini, runtime Python dan dependency Playwright juga tersedia dari task induk;
lihat laporan lokal untuk perintah dan bukti eksekusi yang sebenarnya. Harness
memeriksa hash HTML agar tidak menguji server lama atau development secara keliru.

CI browser dikonfigurasi pada salinan lokal, belum membuktikan CI GitHub pernah
berjalan. Workflow Pages lokal hanya dapat dipicu manual dengan persetujuan
publikasi dan menjalankan gate CI sebelum build/deployment.
