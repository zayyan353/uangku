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

Branch utama adalah `main`, dan push ke `main` otomatis menerbitkan situs. Karena
itu perubahan dikerjakan per micro-work (lihat `MICRO_TASKS.md`):

1. Buat branch baru dari `main`.
2. Ubah kode sesuai satu MW.
3. Jalankan `npm test` dan `npm run build`; keduanya harus lulus.
4. Commit, push branch, lalu buka pull request ke `main`.
5. Merge setelah CI **Periksa Uangku** hijau. Merge itulah yang menerbitkan situs.

Jangan push langsung ke `main`. Aturan lengkap ada di `AGENTS.md`.

Riwayat source tersimpan di GitHub. Arsip ZIP/folder lama tetap dipertahankan dan
merepresentasikan checkpoint saat dibuat, bukan otomatis versi fitur terbaru.

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

Di GitHub, workflow **Periksa Uangku** menjalankan tes unit, build, dan tes browser
pada setiap pull request. Workflow **Publikasikan Uangku** berjalan saat ada push
ke `main` (atau dipicu manual dengan konfirmasi rilis), menjalankan gate yang sama,
lalu menerbitkan situs. Hasil lokal saja tidak membuktikan CI GitHub lulus.
