# Uangku — Daftar Micro-Work

Dicek: 9 November 2026, commit `b0ddda1` (main). Revisi 2: keputusan alur, lingkup MW-03, dan urutan sudah diambil.

**Kondisi sekarang:** sehat menurut catatan terakhir (48 file tes / 1.533 tes unit,
build lulus, situs publik melayani `b0ddda1`). Angka tes belum dijalankan ulang
sejak revisi ini; jalankan `npm test` sebagai baseline sebelum MW pertama.

**Tinjauan 18 November 2026** (commit `67efddf`; 65 file tes / 1.807 tes unit
lulus, build lulus): temuan dan MW baru (MW-87 sampai MW-144) ada di bagian F.

## Keputusan (9 November 2026)

1. **Alur rilis:** satu PR per MW. Tidak ada push langsung ke `main`.
2. **Lingkup MW-03:** versi diperluas (hapus run CI ganda, plus MW-03b).
3. **Urutan:** refactor dulu. MW-16 sebelum MW-07/08, MW-17 sebelum MW-11.

## Keputusan (18 November 2026)

1. **Merge oleh agen:** agen me-merge PR-nya sendiri setelah CI hijau, lalu
   melapor. Pemilik meninjau dari laporan, bukan dari PR.
2. **Keputusan kecil oleh agen:** entri **butuh keputusan** yang pilihannya mudah
   dibatalkan boleh diputuskan agen dan dicatat di entrinya. Batasnya ada di
   `AGENTS.md`, bagian "Wewenang agen".

## Cara pakai daftar ini

- Kerjakan **satu MW per sesi AI**. Jangan gabung.
- Setiap MW: branch baru → ubah → `npm test` → `npm run build` → commit → PR ke
  `main` → CI hijau → merge → laporan ke pemilik.
- **Masuk ke `main` lewat PR**, bukan push langsung. Alasannya: push ke
  `main` = auto-deploy, dan CI menjalankan 16 tes browser Playwright yang tidak
  ikut di `npm test`. `ci.yml` jalan di `pull_request`, jadi kegagalan ketahuan
  sebelum masuk `main`. Merge hanya kalau CI hijau.
- MW yang mengubah UI (07, 08, 11, 12b, 12c, 13a, 13b) bisa lolos tes lokal tapi
  gagal di tes browser. Kalau bisa, jalankan juga tes browser yang relevan di
  `tests/*_browser.py` terhadap `npm run preview`.
- Kalau tes merah dan nggak beres dalam 1–2 percobaan: `git checkout .` dan
  pecah MW itu jadi lebih kecil, jangan dipaksa.
- Centang `[x]` di file ini di commit yang sama.

Template prompt (salin, ganti ID):

```
Repo: zayyan353/uangku. Kerjakan HANYA MW-XX dari MICRO_TASKS.md.
Jangan ubah file lain di luar yang disebut kecuali wajib.
Jalankan npm test dan npm run build. Kalau lulus, commit dengan pesan
"MW-XX: <judul>", centang MW-XX di MICRO_TASKS.md, lalu buka PR ke main.
Merge setelah CI hijau, pastikan publikasi selesai, lalu laporkan hasilnya.
```

---

## A. Rapikan repo & CI (murah, mulai dari sini)

- [x] **MW-00 — Longgarkan batas median performa CI** (ditambahkan belakangan, zayyan353/uangku#2)
  Di runner GitHub, median batch tes performa konsisten ~5,05 detik, jadi batas
  5000 ms membuat CI gagal acak tanpa perubahan kode. `ci.yml` sekarang memberi
  `--median-budget-ms 6000`; default lokal, p95 (8000 ms), dan frame budget tetap.
  Menyelidiki kenapa batch-nya ~5 detik bisa jadi MW terpisah.
  *11 Nov 2026:* atas permintaan pemilik batasnya dilonggarkan lagi di `ci.yml`:
  median 7000 ms dan jeda frame 350 ms (`--frame-budget-ms 350`); p95 tetap 8000 ms.
  Di luar runner GitHub, jeda frame terukur 271–298 ms pada kode yang sama, jadi
  batas 250 ms gagal tanpa perubahan kode. Default lokal skrip tidak diubah.

- [x] **MW-01 — Perbarui aturan kerja (prasyarat semua MW lain)**
  `AGENTS.md` masih bilang branch `local-rebuild` dan "tidak boleh push, merge,
  atau deploy". Selama belum diganti, agen AI yang membaca repo akan menolak push.
  `LOCAL_WORKFLOW.md` (baris 27–29) dan `README_LOCAL.txt` (baris 10) juga masih
  bilang push dinonaktifkan. Tulis ulang aturannya: kerja per micro-work, masuk
  ke `main` hanya setelah `npm test` + `npm run build` lulus (dan CI hijau kalau
  lewat PR). Pertahankan aturan lain di `AGENTS.md` yang masih berlaku (data
  sintetis, Web Locks, format v1, laporan jujur).
  *File:* `AGENTS.md`, `LOCAL_WORKFLOW.md`, `README_LOCAL.txt`.
  *Selesai kalau:* tidak ada lagi instruksi yang bertentangan dengan alur di atas.
  *Catatan:* butuh izin eksplisit pemilik repo, karena MW ini mengubah aturan publikasi.

- [x] **MW-02 — Ganti status lama dengan STATUS.md singkat**
  `RECOVERY_STATUS.json` (19 KB) masih mencatat `branch: local-rebuild` dan
  `deployment_performed: false`. Buat `STATUS.md` ≤ 30 baris (versi live, jumlah
  tes, batasan utama), lalu pindahkan `RECOVERY_STATUS.json` ke `docs/archive/`.
  Pastikan tidak ada skrip/tes yang membaca path lama.
  *Selesai kalau:* README menautkan STATUS.md, tidak ada file yang dihapus.

- [x] **MW-03 — Rapikan duplikasi CI**
  Kondisi sekarang, setiap push ke `main`:
  - `ci.yml` jalan **dua kali**: sekali dari trigger `push`, sekali lagi sebagai
    job `verify` di `pages.yml`. Keduanya menjalankan semua tes browser.
  - Job `build` di `pages.yml` menjalankan `npm test` sekali lagi.

  Langkah:
  1. Hapus langkah "Jalankan tes" di job `build` (`pages.yml`).
  2. Hapus trigger `push` di `ci.yml` (sisakan `pull_request`, `workflow_dispatch`,
     `workflow_call`). Push ke `main` tetap diperiksa lewat `verify`.

  *File:* `.github/workflows/pages.yml`, `.github/workflows/ci.yml`.
  *Selesai kalau:* push ke `main` hanya menjalankan satu set tes browser, run hijau.

- [x] **MW-03b — Masukkan `full_backup_browser.py` ke CI**
  `tests/full_backup_browser.py` ada di repo tapi tidak dipanggil di `ci.yml`,
  padahal ini tes untuk fitur cadangan yang akan disentuh MW-06/07/08/12a.
  Jalankan dulu secara lokal terhadap `npm run preview`. Kalau lulus, tambahkan ke
  langkah tes browser dan daftar `upload-artifact`. Kalau gagal, laporkan dan
  jangan dipaksa; perbaikannya jadi MW terpisah.
  *File:* `.github/workflows/ci.yml`.
  *Hasil (9 November 2026):* premisnya keliru, `ci.yml` tidak diubah. File ini
  modul tanpa `main`/`--output`; `tests/category_browser.py` mengimpornya
  (`category_suite_case`) dan menjalankannya sebagai kasus `full-backup-desktop`
  dan `full-backup-mobile`, dan `category_browser.py` sudah ada di CI. Kedua kasus
  lulus di CI (run PR zayyan353/uangku#5) dan lokal terhadap `npm run preview`
  (`category_browser.py --only full-backup`: 2 lulus, 0 gagal). Menambah
  `python tests/full_backup_browser.py` ke CI tidak akan menjalankan tes apa pun.

- [x] **MW-04 — Betulkan deskripsi meta**
  `index.html` baris 24 menyebut "Dompet, cash, dan mata uangmu", padahal dompet
  cash tidak dipakai di pembukuan aktif. Ubah kalimatnya jadi rekening & e-wallet.
  *File:* `index.html`.

## B. Keamanan data (paling penting — data cuma ada di browser)

- [x] **MW-05 — Minta penyimpanan persisten**
  Panggil `navigator.storage.persist()` sekali setelah pengguna mulai pakai data
  sendiri (bukan demo). Aman kalau API tidak ada. Tampilkan hasilnya (ya/tidak)
  di jendela Privasi. Di Safari hasilnya ditentukan heuristik browser, jadi
  "tidak" bukan error.
  *File:* modul baru `src/lib/storagePersistence.ts` + test, `PrivacyNotice.tsx`.

- [x] **MW-06 — Catat cadangan terakhir**
  Setelah "Cadangkan semuanya" dipicu (`backupAll` di `App.tsx`), simpan catatan
  di key terpisah (`uangku:last-backup:v1`). Jangan masuk ke format ledger.

  Isi catatan: `{ at: <ISO timestamp>, fingerprint: <string> }`.
  - `fingerprint` dibutuhkan MW-08, karena **transaksi tidak punya `createdAt`**,
    jadi "ada transaksi baru setelah backup" tidak bisa dicek dari tanggal.
    Pakai sidik jari ledger yang murah (misalnya jumlah entri + hash isi entri,
    atau `revisionToken` dari `persistence.ts` kalau stabil antar sesi).
  - Batasan yang harus diterima: browser tidak bisa memastikan file benar-benar
    tersimpan di perangkat. "Berhasil" di sini berarti unduhan sudah dipicu
    tanpa error.

  *File:* modul baru `src/lib/backupReminder.ts` + test, `App.tsx` (fungsi `backupAll`).

- [x] **MW-07 — Tampilkan "Cadangan terakhir: …"**
  Teks kecil di sidebar & footer HP, di dekat tombol cadangan.
  Butuh MW-06 dan MW-16 (sidebar sudah di komponen sendiri).
  *File:* `src/components/AppNavigation.tsx`, plus `App.tsx` kalau footer HP
  (`bottom-note`) tidak ikut dipindah di MW-16.

- [x] **MW-08 — Banner pengingat cadangan**
  Muncul kalau belum pernah backup, atau backup > 7 hari **dan** `fingerprint`
  ledger sekarang beda dengan yang dicatat MW-06. Bisa ditutup sampai besok.
  Butuh MW-06. Logika di `backupReminder.ts` (dites), UI di `App.tsx`.

- [x] **MW-09 — Manifest PWA + ikon**
  Tambah `public/manifest.webmanifest`, ikon 192/512 PNG, `apple-touch-icon`,
  dan `<link rel="manifest">` di `index.html` (ingat `base: './'`, path relatif).
  File di `public/` dikopi apa adanya ke `dist/`, jadi aman dengan `viteSingleFile`.
  *Selesai kalau:* build tetap satu `index.html` + aset di `dist/`, dan bisa "Tambah ke Layar Utama".

- [x] **MW-10 — Petunjuk "Tambah ke Layar Utama" + pindah data**
  Satu paragraf di `PrivacyNotice.tsx` dan README (iPhone: Bagikan → Tambah ke
  Layar Utama; Android: menu ⋮ → Instal aplikasi). Butuh MW-09.

  **Wajib ada:** di iPhone, aplikasi dari Layar Utama punya **penyimpanan terpisah
  dari Safari**. Data yang sudah ada di Safari tidak ikut pindah. Langkahnya:
  cadangkan semuanya di Safari → buka dari Layar Utama → pulihkan cadangan.
  Tanpa petunjuk ini pengguna akan mengira datanya hilang.

## C. Fitur kecil yang berguna

- [x] **MW-11 — Ekspor CSV riwayat yang sedang terfilter**
  Tombol "Unduh CSV" di halaman Transaksi; isi = baris yang cocok dengan filter
  sekarang (tanggal, dompet, jenis, kategori, nominal, keterangan).
  Butuh MW-17, supaya tombolnya masuk ke `HistoryFilters.tsx`.
  *File:* modul baru `src/lib/csvExport.ts` + test (escape koma/kutip/baris baru,
  digit pecahan per mata uang), tombol di `HistoryFilters.tsx`
  (pakai `downloadText` yang sudah ada, dengan type `text/csv`).

- [x] **MW-12a — Anggaran: model & penyimpanan**
  Peta `{ mataUang → { kategori → batasBulanan } }`, disimpan di key sendiri,
  divalidasi, ikut "Cadangkan semuanya". Cek kompatibilitas dua arah di `fullBackup`:
  - cadangan lama (tanpa anggaran) tetap bisa dipulihkan;
  - cadangan baru tidak membuat format v1 rusak (field baru opsional).
  Hanya logika + test, belum ada UI.

- [x] **MW-12b — Anggaran: atur batas di Kelola kategori**
  Input nominal per kategori pengeluaran di `CategoryManager.tsx`. Butuh MW-12a.

- [x] **MW-12c — Anggaran: progress di Ringkasan**
  Di panel "Kategori pengeluaran terkonfirmasi", tampilkan terpakai / batas dan warna
  kalau lewat. Butuh MW-12b.

- [x] **MW-13a — Template transaksi: simpan**
  "Simpan sebagai template" di `TransactionModal.tsx` (jenis, dompet, kategori,
  nominal, catatan). Hanya template, **tidak** otomatis membuat transaksi.
  Tentukan juga apakah template ikut "Cadangkan semuanya" (sebaiknya ya, dengan
  aturan kompatibilitas yang sama seperti MW-12a).
  *Keputusan:* ya, field opsional `templates` di cadangan lengkap, hanya ditulis
  bila ada template (aturan sama dengan `budgets`).

- [x] **MW-13b — Template transaksi: isi cepat**
  Daftar template di atas form transaksi baru; klik = form terisi, tanggal = hari ini. Butuh MW-13a.

## D. Pemeliharaan (pecah App.tsx 597 baris, satu potong per MW)

Aturan: hanya memindahkan kode, perilaku tidak berubah, semua tes tetap hijau
(termasuk tes browser di CI).

- [x] **MW-14 — Pindahkan `TransactionTable`** ke `src/components/TransactionTable.tsx`.
- [x] **MW-15 — Pindahkan `AmountDetailModal`** ke `src/components/AmountDetailModal.tsx`.
- [x] **MW-16 — Pindahkan sidebar + navigasi HP** ke `src/components/AppNavigation.tsx`.
  Kerjakan sebelum MW-07/08.
- [x] **MW-17 — Pindahkan filter bar riwayat** ke `src/components/HistoryFilters.tsx`.
  Kerjakan sebelum MW-11.
- [x] **MW-18 — Pindahkan halaman Dompet** (grid kartu) ke `src/components/WalletsPage.tsx`.

## D2. Tampilan

- [x] **MW-21 — Keterbacaan: skala teks & tata letak angka di HP**
  Banyak teks memakai 7–11px sehingga sulit dibaca. Skala dinaikkan merata di
  `styles.css` (≤9px→11, 10→12, 11→13, 12→14, 13→14, 14→15); judul dan angka
  besar (`clamp`, ≥15px) tidak berubah. Di HP ≤420px, kartu "Uang masuk/keluar"
  jadi satu kolom supaya nominal tidak terpotong di tengah angka; input bulan
  di toolbar mata uang dilebarkan; tombol cadangan di sidebar dirapatkan agar
  tetap satu baris. Hanya CSS, perilaku tidak berubah.
  *File:* `src/styles.css`.

Audit UI (9 November 2026, build `f243309`, 1440px & 390px, terang & gelap).
Fokus tampilan dulu; perilaku/alur (UX) menyusul. Kerjakan berurutan, satu MW
per PR, perilaku tidak berubah kecuali disebut.

- [x] **MW-22 — Rapikan tumpukan banner di atas halaman**
  Tiap halaman diawali tiga kotak: "Versi pengembangan lokal", "Belum
  tersimpan", dan "Kenalan dulu pakai data contoh" (±200px). Di HP layar
  pertama halaman Dompet tidak menampilkan dompet sama sekali. Gabungkan jadi
  satu banner ringkas; status simpan jadi label kecil di topbar, bukan kotak.
  Teks status dan tombol "Mulai pakai data sendiri" tetap ada (dipakai tes).
- [x] **MW-23 — Pilihan jenis di modal transaksi tidak pecah baris**
  Lima pilihan (Pengeluaran … Cek saldo) pecah dua baris: "Perpindahan dana"
  terlipat, "Cek saldo" sendirian di baris kedua, di desktop maupun HP.
  Jadikan satu baris yang bisa digeser, atau grid rata.
- [x] **MW-24 — Satu gaya tab**
  Tab mata uang (pill putih), Aktif/Arsip (pill hijau gelap), dan
  Ziraat/CSV (blok) berbeda-beda. Samakan jadi satu komponen gaya.
- [x] **MW-25 — Filter halaman Transaksi**
  Placeholder pencarian terpotong ("Cari keterangan atau d…"), tombol Kelola
  kategori bercampur dengan filter, "6 transaksi" + "Rapikan 1 catatan"
  mengambang di kanan. Susun ulang jadi dua baris yang jelas.
- [x] **MW-26 — Tabel transaksi lebih bersih**
  Kolom Dompet mengulang "IDR" di setiap baris; "Rincian nominal" di setiap
  baris; jarak ⋯ dan 🗑 terlalu jauh; di HP judul transaksi terlipat dua baris.
- [x] **MW-27 — Halaman Impor mutasi**
  "Kelola mata uang" mengambang sendiri, toolbar kategori tampil padahal tidak
  relevan, tombol header "Pindah uang/Catat transaksi" tidak nyambung.
- [x] **MW-28 — Ringkasan desktop**
  Kolom tabel "Rincian arus rekening" terlalu lebar, panel Dompetmu kosong di
  bawah, penjelasan "Perhitungan saldo" berupa tiga paragraf panjang.
- [x] **MW-29 — Topbar**
  Pemilih tema masih `<select>` bawaan, "Lokal & pribadi" terlalu kecil,
  breadcrumb di HP tanpa pemisah ("Ruang pribadi Dompet").
- [x] **MW-30 — Eyebrow halaman** "SEDIKIT DICATAT, BANYAK TERBANTU" sama di
  semua halaman; ganti per halaman atau hapus.
- [x] **MW-31 — Modal Pindah uang** "Tanggal kredit" sendirian di satu baris.
- [x] **MW-32 — Footer** teks "Nggak harus rapi sekaligus…" kecil dan pudar.

Dicatat untuk tahap UX (belum dikerjakan): format tanggal form mengikuti bahasa
browser. (Pesan "Pilih dompet tujuan yang berbeda" sudah dibereskan di MW-34.)

## D3. Tindak lanjut (10 November 2026)

Sisa catatan dari MW-26, MW-27, dan tahap UX. Satu MW per commit.

- [x] **MW-33 — Tes kapasitas 8 MiB tidak timeout saat CPU penuh**
  Dua tes "near8MiB" (`currencySettings.test.ts`, `walletArchiveCodec.test.ts`)
  butuh ~3 detik tanpa beban dan 7–8 detik saat CPU penuh, sehingga melewati
  batas bawaan 5 detik. Diberi batas 20 detik seperti tes berat lain
  (`bankDecisions`, `categoryCommands`). Isi tes tidak berubah.

- [x] **MW-34 — Pesan modal Pindah uang saat nominal kosong**
  Bug logika, bukan pesan: kotak info memakai satu syarat (`nominal valid &&
  tujuan ada`), jadi nominal kosong jatuh ke "Pilih dompet tujuan yang
  berbeda" walau BCA → Bank Jago sudah berbeda. Sekarang tujuan sama/kosong →
  "Pilih dompet tujuan yang berbeda"; nominal kosong/nol → "Isi nominal untuk
  melihat jumlah yang masuk ke …"; selain itu "Rp … masuk ke …". Tes di
  `browser_smoke.py` (gagal di kode lama, lulus sekarang).

- [x] **MW-35 — Judul transaksi di HP mendapat sisa lebar baris**
  Lanjutan MW-26. Kolom tabel HP sebelumnya persentase tetap (judul 47%,
  nominal 39%), jadi judul hanya ±100px di layar 360px walau nominalnya pendek.
  Sekarang kolom nominal dan aksi selebar isinya (nominal tetap utuh, tanpa
  pemotongan) dan judul mengambil sisanya: 100→116px di 360px, 115→146px di
  390px (data contoh). Judul tetap satu baris dengan "…"; judul lengkap tetap di
  atribut `title` dan modal ubah. Hanya CSS.

- [x] **MW-36 — Halaman Impor tanpa toolbar kategori**
  Lanjutan MW-27. Keputusan alur: kategori per baris diatur langsung di tabel
  pratinjau impor (sudah ada). "Kelola kategori" (tambah kategori/aturan saat
  meninjau) pindah ke header halaman Impor, di samping "Kelola mata uang" dan
  "Catat transaksi". "Isi kategori otomatis" bekerja pada catatan yang sudah
  tersimpan di semua periode, jadi hanya di halaman Transaksi. Pesan galat
  pengaturan kategori tetap tampil di halaman Impor.

- [x] **MW-37 — Ikon app lebih bersih**
  Di ikon PWA (MW-09), titik "koin" ditempel tepat di ujung kaki kanan huruf u,
  jadi terlihat seperti benjolan di layar utama HP. Dari tiga alternatif,
  pemilik memilih opsi C: latar hijau tua, huruf u hijau muda lebih tebal,
  tanpa titik, tetap di dalam zona aman maskable. `icon-192/512.png`,
  `apple-touch-icon.png`, `favicon.svg`, dan favicon tab di `index.html`
  diperbarui. Logo sidebar tidak diubah.

## D4. Polesan UI (10 November 2026)

Dari tinjauan tampilan build produksi (desktop 1440px, HP 390px, data contoh).
Pemilik minta semua dikerjakan dalam satu sesi; tiap MW tetap satu commit.

- [x] **MW-38 — Titik nyasar di kartu Kategori pengeluaran**
  Catatan kaki kartu "Kategori pengeluaran terkonfirmasi" menampilkan "•" kosong di atasnya (desktop dan HP). Buang penanda kosong itu.

- [x] **MW-39 — Angka tabel Rincian arus tidak pecah baris di HP**
  Di 390px "Rp 8.000.000" terbelah jadi "Rp 8.000.00 / 0". Nominal harus utuh satu baris.

- [x] **MW-40 — Tab jenis di modal transaksi terlihat bisa digeser di HP**
  "Transfer" dan "Cek saldo" terpotong tanpa tanda. Beri tanda geser/fade dan pastikan tab aktif terlihat.

- [x] **MW-41 — Paginasi Transaksi lebih ringkas**
  Tombol halaman disembunyikan bila hanya 1 halaman; label tidak pecah dua baris di HP.

- [x] **MW-42 — Ringkasan HP lebih pendek**
  Uang masuk/keluar sebelahan di HP; Perhitungan saldo dan Rincian arus bisa dilipat (tertutup bawaan di HP).

- [x] **MW-43 — Panel Ringkasan desktop tanpa ruang kosong**
  Isi Perhitungan saldo & Rincian arus memakai lebar penuh; kartu Dompetmu dan Kategori sama tinggi.

- [x] **MW-44 — Filter Transaksi di HP lebih padat**
  Rencana awal (melipat filter di balik tombol "Filter") batal: banyak tes browser HP memilih filter langsung dan `ux_browser.py` menuntut tiap filter utuh di layar. Gantinya grid dua kolom: cari selebar penuh, periode + dompet sebaris, jenis (dan alasan) di bawahnya, label "Periode" hanya untuk pembaca layar.

- [x] **MW-45 — Hapus transaksi lewat form ubah**
  Ikon hapus per baris dibuang; tombol baris (ikon pensil) membuka form ubah yang sudah punya tombol "Hapus" dengan konfirmasi. Menu "…" tidak dibuat karena "Ubah …" dipakai banyak alur dan tes sebagai pembuka form langsung.

- [x] **MW-46 — Nominal tanpa garis putus-putus**
  Garis bawah putus-putus di nominal diganti tanda yang lebih halus; nominal tetap bisa diklik.

- [x] **MW-47 — Banner data contoh ringkas**
  Teks "Versi pengembangan lokal…" dibuang, banner jadi satu baris. Di Impor tidak dobel dengan banner "Mode contoh masih aktif".

- [x] **MW-48 — Status simpan cukup di topbar**
  Status simpan di bawah sidebar dan footer dihapus; topbar tetap.

- [x] **MW-49 — Menu akun: cadangan, privasi, tema**
  Avatar jadi tombol "Menu akun" berisi Cadangkan semuanya, Cadangkan transaksi saja, Pulihkan cadangan, Privasi, dan catatan cadangan terakhir. Link cadangan di footer HP dibuang. Pemilih tema tetap di topbar (tes browser menuntut "Tema tampilan" terlihat); sidebar desktop tetap punya tombol cadangan.

- [x] **MW-50 — Tombol header Impor punya hierarki**
  "Catat transaksi" jadi tombol utama; Kelola mata uang & Kelola kategori sekunder kecil.

- [x] **MW-51 — Dropdown bergaya seragam**
  `select` memakai panah, tinggi, dan radius yang sama dengan input lain.

- [x] **MW-52 — Chip mata uang ganda di kartu dompet**
  Chip "IDR" di kaki kartu dompet dibuang karena tab mata uang sudah menyebutnya.

## D5. Polesan UI lanjutan (10 November 2026)

Dari tinjauan modal, antrean rapikan, pratinjau impor, dan tampilan data kosong
(desktop 1440px, HP 390px). Tiap MW satu commit.

- [x] **MW-53 — Transaksi terbaru lebih atas di Ringkasan HP**
  Di HP "Transaksi terbaru" ada di paling bawah, setelah Dompetmu dan Kategori. Naikkan tepat setelah kartu arus dan panel lipat; urutan desktop tetap.

- [x] **MW-54 — Tab aktif tidak tertutup panah geser**
  Di modal Pindah uang (HP) tab aktif "Transfer" tertutup tombol panah MW-40. Gulir tab aktif ke dalam area yang tidak tertutup panah.

- [x] **MW-55 — Tombol footer modal tidak terpotong di HP**
  Di Kelola kategori, "Simpan pengaturan" mepet sampai tepi tombol pada 390px. Tombol footer modal boleh membungkus/menyesuaikan lebar.

- [x] **MW-56 — Modal Privasi selaras tipografi**
  Isi modal Privasi 16px dan padat, beda dari modal lain. Samakan ukuran, warna, dan jarak paragraf.

- [x] **MW-57 — Tombol modal "Mulai dengan uangmu sendiri" rapi di HP**
  Tiga tombol pecah dua baris tidak rata. Di HP susun penuh-lebar dengan aksi utama di atas.

- [x] **MW-58 — Impor CSV umum: jarak paragraf ke field**
  Label "Pemisah CSV" menempel pada paragraf di atasnya. Beri jarak.

- [x] **MW-59 — Rincian arus kosong punya pesan**
  Tanpa arus, tabel hanya menampilkan header. Tampilkan baris "Belum ada arus pada periode ini".

- [x] **MW-60 — Paginasi disembunyikan saat 0 transaksi**
  "0–0 dari 0 · Halaman 1 dari 1" tampil di riwayat kosong. Sembunyikan baris paginasi bila total 0.

## D6. Penyempurnaan CSS (10 November 2026) — daftar saja, belum dikerjakan

Dari audit `src/styles.css` (1.371 baris, commit `b0ddda1` + D5). Angka di bawah
hasil hitung langsung di file: 243 warna hex unik (430 pemakaian; `#52634f`
ditulis literal 120 kali), 97 aturan `html[data-theme="dark"]`, 30 blok `@media`
(760px muncul 9 kali), 18 nilai radius, 17 nilai `font-weight`, 7 `!important`,
16 `style={}` inline di TSX.

Aturan main bagian ini: satu MW per PR. MW "fondasi" tidak boleh mengubah
tampilan (bandingkan tangkapan layar 1440px & 390px, terang & gelap, sebelum dan
sesudah). Setiap MW wajib menjalankan `tests/theme_browser.py` dan
`tests/ux_browser.py` (keduanya memeriksa kontras) terhadap `npm run preview`.

### Fondasi (tampilan tidak berubah)

- [ ] **MW-61 — Warna literal → token yang sudah ada**
  Ganti hex yang nilainya sama persis dengan token yang ada (`#52634f` →
  `var(--text-muted)`, `#fff` → `var(--surface)`, `#173b31` → `var(--forest)`,
  `#d5ee96` → `var(--lime)`, dst.). Murni cari-ganti nilai identik.
  *Selesai kalau:* nilai terhitung (computed) tidak berubah di kedua tema.

- [ ] **MW-62 — Token status untuk tema terang**
  `--success-*`, `--warning-*`, `--error-*`, `--info-*`, `--purple-*`, dan
  `--surface-hover` hanya didefinisikan di tema gelap; tema terang menulis
  hex langsung di tiap komponen (notice, badge, save-pill, banner). Definisikan
  token yang sama di `:root` dengan nilai terang yang sekarang dipakai.
  Prasyarat MW-63.

- [ ] **MW-63 — Tema gelap lewat token, bukan daftar override**
  Tema gelap sekarang 97 aturan dengan daftar `:is(...)` panjang; komponen baru
  yang lupa didaftarkan otomatis rusak di gelap. Setelah MW-61/62, aturan dasar
  memakai token sehingga tema gelap cukup mengganti nilai variabel. Kerjakan
  bertahap, satu kelompok per PR: (a) permukaan & garis, (b) teks,
  (c) kontrol form, (d) status/badge/banner.
  *Selesai kalau:* blok override gelap tinggal pengecualian yang memang beda
  struktur (mis. tombol utama lime), dan kontras tetap lulus.

- [ ] **MW-64 — Satu definisi per selektor**
  Blok "Application-specific structure", "Local F", dan blok MW lama menimpa
  aturan di atasnya (`.breadcrumb`, `.button`, `.stat-label`, `.category-row`,
  `.wallet-row`, `.search-input input`, `.notice`, `.bottom-note`,
  `.theme-picker`, `.transactions-table:not(.import-table) …`). Gabungkan jadi
  satu definisi akhir per selektor dan satu blok per breakpoint. Pecah per area
  (topbar, ringkasan, tabel, impor) bila diff terlalu besar.

- [ ] **MW-65 — Buang CSS mati**
  Kandidat (tidak ditemukan di `src/`, verifikasi ulang sebelum menghapus):
  `.balance-separator`, `.description-cell`, `.fee-row`, `.nav-icon`,
  `.toast-icon`, `.selected-row`, `.quick-wallet-action` (+ `.wallet-row-wrap`),
  `.wallet-icon.blue/.green/.orange`, `.form-grid .full-width`. Cek juga token
  yang tidak dipakai (`--forest-light`, `--readable-*`).

- [ ] **MW-66 — Skala radius, ukuran teks, dan z-index**
  18 nilai radius (3–23px), ukuran teks 11–35px tersebar, z-index 30/40/60/100/150
  ditulis langsung. Jadikan token (`--radius-sm/md/lg`, `--text-xs…`, `--z-nav`,
  `--z-modal`, `--z-toast`) dan bulatkan nilai yang selisih 1px. Lebar sidebar
  (232/205px) juga jadi `--sidebar-width` supaya posisi toast
  (`left: calc(50% + 116px)`) tidak lagi angka ajaib.

- [ ] **MW-67 — Breakpoint konsisten**
  Dipakai 370/420/540/600/760/1000/1190/1550px. Tetapkan set resmi (usul:
  420, 600, 760, 1000, 1190), lebur 540 → 600, dan tulis di komentar atas file.

- [ ] **MW-68 — Selektor rapuh → class**
  `.segmented-control[aria-label="Jenis transaksi"]` (gaya ikut teks label),
  `.pending-banner > span:nth-child(2)`, dan penyembunyian kolom tabel HP lewat
  `th/td:nth-child(2|3|4|5)`. Beri class sendiri di TSX. Menyentuh
  `TransactionModal.tsx`, `TransactionTable.tsx`, `App.tsx`.

- [ ] **MW-69 — Inline style → class**
  16 `style={}` di `GenericImportMapper.tsx`, `StatementReview.tsx`,
  `SourceDetails.tsx`, `WalletEditor.tsx`, `TransactionModal.tsx`. Juga
  `--wallet-color` di `WalletsPage.tsx:8` diset tapi tidak dipakai CSS mana pun:
  putuskan dipakai (ikon dompet berwarna per mata uang) atau dibuang.

- [ ] **MW-70 — Hilangkan `!important` pada nominal**
  `.amount-positive/.amount-negative` memakai `!important` (terang & gelap)
  untuk mengalahkan `.amount-cell strong`. Perbaiki lewat urutan/spesifisitas.
  Sisakan hanya di `prefers-reduced-motion`.

- [ ] **MW-71 — Pecah `styles.css` per area**
  Setelah MW-64/65: `base.css`, `layout.css`, `components.css`, halaman
  (ringkasan, transaksi, impor, dompet), `theme.css`; aturan panjang satu baris
  diformat multi-baris. Urutan impor menjaga cascade. Kerjakan paling akhir di
  kelompok fondasi.

### Polesan yang terlihat

- [ ] **MW-72 — Putuskan font: muat Inter atau rapikan berat**
  `font-family: Inter` dideklarasikan tapi font tidak pernah dimuat, jadi yang
  tampil font sistem; berat seperti 550/560/590/620/630/670 dibulatkan beda-beda
  per OS. Pilih: (a) self-host Inter variable (woff2, tetap offline) atau
  (b) pakai 400/500/600/700 saja. *Butuh keputusan pemilik.*

- [ ] **MW-73 — Warna semantik badge & ikon di tema terang**
  Di terang, teks semua badge/ikon (masuk, keluar, transfer, penyesuaian, belum
  dirapikan) sama `#52634f`; hanya latar pucatnya yang beda, sulit dibedakan
  sekilas. Tema gelap sudah punya warna berbeda. Beri warna teks semantik di
  terang (kontras ≥ 4,5:1).

- [ ] **MW-74 — Satukan warna teks tema terang**
  ±20 hijau tua yang hampir sama untuk judul/nilai (`#203c2f`, `#2e4534`,
  `#334b38`, `#3a5138`, `#41543f`, `#43563f`, `#48613c`, `#4a5d43`, `#4c6540`…).
  Ringkas jadi `--text` dan `--text-strong`. Ada pergeseran warna kecil.

- [ ] **MW-75 — State hover/aktif tombol**
  Hover global hanya `filter: brightness(.985)` (nyaris tak terlihat);
  `.button.secondary/.ghost/.danger`, `.icon-button`, `.text-link` tidak punya
  hover sendiri di terang; `.nav-item` hanya mentransisikan `transform` sehingga
  warna latar berganti mendadak.

- [ ] **MW-76 — Cincin fokus seragam**
  Campuran 3px/offset 3px, 2px/offset 2px, 2px/offset −2px, dan
  `:focus-within` di pemilih tema. Satu gaya lewat token `--focus`.

- [x] **MW-77 — Target sentuh ≥ 44px di HP**
  `.button.small` 32px, `.icon-button` 34px, `.modal-close` 30px, tombol baris
  27px (desktop) / 40×35px (HP), tab 36px, pemilih tema 38–40px, checkbox 15px.
  Naikkan area sentuh di ≤760px tanpa membesarkan ikon.

- [x] **MW-78 — Angka tabular di semua nominal**
  `tabular-nums` baru ada di `.stat-value`, `.cashflow-table td`,
  `.amount-detail dd`. Tambahkan ke `.wallet-amount`, `.amount-cell`,
  `.balance-number`, `.wallet-card-balance`, `.category-value`,
  `.cashflow-equation dd` supaya digit sejajar antarbaris.

- [x] **MW-79 — Sidebar di layar pendek + `100dvh`**
  `.sidebar` `position: fixed` tanpa `overflow-y`: di jendela pendek tombol
  cadangan di bawah terpotong dan tidak bisa digulir. `.app-shell` memakai
  `100vh` (melompat di browser HP); ganti `100dvh` dengan fallback.

- [ ] **MW-80 — Irama jarak**
  Padding/gap ganjil (17, 19, 21, 23, 27px) antar kartu dan panel. Rapikan ke
  kelipatan 4px lewat token jarak. Mengubah tata letak beberapa piksel; kerjakan
  per halaman dan cek tangkapan layar.

- [ ] **MW-81 — Modal di HP** *(opsional, butuh keputusan)*
  Animasi buka 0,08–0,1 detik nyaris tak terasa; di ≤600px modal tetap kotak
  tengah. Opsi: lembar bawah (bottom sheet) dengan footer menempel, animasi
  ±0,18 detik, tetap hormati `prefers-reduced-motion`.

- [ ] **MW-82 — Cetak & kontras tinggi** *(opsional)*
  Belum ada `@media print` (sidebar/nav ikut tercetak, tabel terpotong) dan
  belum ada penyesuaian `forced-colors`/`prefers-contrast` (badge dan cincin
  fokus bergantung warna latar).

**Urutan usul:** 61 → 62 → 63a–d → 65 → 64 → 66 → 67 → 70 → 68 → 69 → 71, lalu
polesan 72 (setelah keputusan) → 73 → 74 → 75 → 76 → 77 → 78 → 79 → 80; 81–82
bila diinginkan. MW-78 dan MW-79 kecil dan mandiri, boleh didahulukan.

## D7. Pembaca Ziraat (10 November 2026)

Dari uji baca mutasi Ziraat satu tahun milik pemilik (dibaca di memori dan di
profil browser sementara; file, nama, nomor rekening, dan nominalnya tidak
disalin ke repo). File terbaca tanpa galat dan saldo akhirnya cocok dengan
statement. Yang belum otomatis mengelompok pada beberapa pola keterangan bank.

- [x] **MW-83 — Kenali tarik tunai ATM bank lain/QR dan biaya ATM**
  Tiga pola belum dikenali, jadi barisnya masuk "Perlu dirapikan" dan salah
  kelompok di Rincian arus rekening:
  - `YURTİÇİ ATM P.Ç.` (tarik tunai di ATM bank lain; pasangan `P.Y.` yang
    sudah dikenali) dan `ATM QR ILE PARA ÇEKME` (tarik tunai tanpa kartu).
    Sekarang mengikuti kebijakan ATM yang sudah disetujui: debit → pengeluaran
    **Tarik tunai**; arah berlawanan atau keterangan pembatalan tetap ditinjau.
  - Baris komisi dan BSMV ATM bank lain yang dicatat bank terpisah
    (`… P.Ç. BSMV`, `… P.Y. BSMV`, dan baris `KOMİSYON: x,xx`). Baris komisi
    memakai keterangan yang sama dengan pokoknya, jadi dibedakan dari nominal:
    angka `KOMİSYON:` adalah total komisi **termasuk** BSMV, sehingga debit
    yang tidak melebihi angka itu adalah biayanya. Sekarang → pengeluaran
    **Biaya bank** (jenis operasi baru `atm-fee`, label "Biaya ATM").
  - `İşlem Toplam Masrafı` → **Biaya bank**.

  Enam aturan bawaan baru (`bank-v6-…`) dan penanda paket kata kunci naik 5 → 6.
  Upgrade tetap aditif: aturan pribadi, aturan yang dihapus, dan kategori
  nonaktif tidak disentuh; profil v5 hanya menerima enam aturan baru. Catatan
  lama tidak diubah saat aplikasi dibuka; pakai **Transaksi → Isi kategori
  otomatis**. Impor CSV/Excel umum tidak berubah.
  *Konsekuensi:* cadangan lengkap yang dibuat versi ini memuat penanda paket 6
  dan ditolak versi aplikasi yang lebih lama (sama seperti kenaikan sebelumnya).
  *File:* `src/lib/bankDescription.ts`, `categoryBankMappings.ts`,
  `bankAutoMappings.ts`, `categorization.ts`, `categorySettings.ts`,
  `categorySettingsUpgrade.ts`, `cashflowReport.ts`, `useCategorySettings.tsx`,
  `CategoryManager.tsx`, tes unit terkait, `tests/*_browser.py`, `README.md`.
  *Hasil pada file uji (952 baris):* kategori terisi otomatis 918 → 941, jenis
  perlu dicek 9 → 4, perlu dirapikan 34 → 11.

Sisa dari uji yang sama. Pemilik menyerahkan keputusannya ke pelaksana
(10 November 2026); tiap MW satu commit.

- [x] **MW-84 — Tagihan utilitas masuk kategori Tagihan**
  Pembayaran tagihan gas dan listrik lewat bank (`ESGAZ/Abone No …`,
  `OSMANGAZİ Sözleşme No …`) tercatat sebagai pengeluaran tanpa kategori.
  Keputusan: kategori **Tagihan** (sudah ada di bawaan). Dua aturan literal
  bawaan, nama publik saja: `ESGAZ` dan `OSMANGAZİ SÖZLEŞME NO` (frasa lengkap,
  karena "Osmangazi" sendiri juga nama kampus dan daerah). Penanda paket kata
  kunci naik 6 → 7; upgrade tetap aditif seperti MW-83.
  *File:* `categoryBankMappings.ts`, `bankAutoMappings.ts`,
  `categorySettings.ts`, `categorySettingsUpgrade.ts`, tes unit terkait,
  `tests/*_browser.py`.

- [x] **MW-85 — Refund pembelian kartu menjadi Pengembalian dana**
  Kredit `SATIŞ IADE` / `SATIŞ YD IADE` (merchant mengembalikan pembelian
  kartu; YD = merchant luar negeri) tetap "Perlu dicek". Keputusan: ikuti
  preseden refund ATM, yaitu pemasukan kategori **Pengembalian dana**, bukan
  penghasilan baru. Hanya berlaku bila frasa itu muncul bersama nomor kartu
  (`KARTNO`) dan nominalnya kredit; debit, pembatalan (`IPTAL`, `REVERSAL`),
  atau keterangan pembelian tetap ditinjau, dan `IADE` lain tetap belum
  dipastikan. Nama merchant boleh memuat kata apa pun. Aturan merchant bawaan
  (mis. tiket kereta → Transportasi) mengalah pada kategori refund; aturan
  pribadi tetap berlaku dan menjadi saran bila berbeda. Dua aturan bawaan
  ditambahkan ke paket v7 dari MW-84 (dirilis bersamaan, jadi penanda tidak
  naik lagi). Catatan lama: **Transaksi → Isi kategori otomatis**.
  *File:* `bankDescription.ts`, `categorization.ts`, `categoryBankMappings.ts`,
  `CategoryAutomation.tsx`, tes unit terkait, `tests/*_browser.py`, `README.md`.

- [x] **MW-86 — Pokok transfer yang keterangannya terpotong bank**
  Bila nama pengirim/penerima panjang, bank memotong keterangan sebelum
  `Ziraat Mobil Havale`, sehingga pokok transfer terbaca sebagai debit tak
  dikenal dan dihitung sebagai pengeluaran. Panjang potongannya tidak tetap,
  jadi sisa teks tidak bisa diandalkan. Keputusan: pakai bukti dari bank
  sendiri. Baris biaya transfer (`… Havale Komisyonu/BSMV Tahsilatı`) memakai
  nomor fiş dan tanggal yang sama dengan pokoknya; bila pada fiş dan tanggal
  itu tepat satu baris lain, baris itu debit, dan keterangannya tidak dikenali,
  ia dicatat sebagai **perpindahan dana**. Pratinjau impor menampilkan
  alasannya dan jenisnya tetap bisa diubah. Tanpa baris biaya, lebih dari satu
  kandidat, kredit, atau baris yang sudah "Perlu dicek" tidak disentuh.
  Batasan: hanya berlaku saat impor; di Rincian arus baris ini masuk "Mutasi
  lain" (sama seperti perpindahan dana lain yang keterangannya tak dikenali)
  dan kategorinya dibiarkan kosong karena perpindahan dana tidak wajib
  berkategori.
  *File:* `importer.ts`, `RecoveryImportView.tsx`, tes unit baru,
  `tests/bank_auto_browser.py`, `README.md`.
  *Hasil pada file uji (952 baris) setelah MW-84–86:* kategori terisi otomatis
  941 → 951 dan tidak ada lagi yang perlu dirapikan (11 → 0).

Dicatat dari uji yang sama, **belum dikerjakan**:

- Pembayaran tagihan lewat `Havale` tercatat sebagai perpindahan dana, sesuai
  kebijakan transfer sekarang; mengubahnya menjadi pengeluaran tetap manual.

## E. Butuh bahan dari kamu dulu (jangan dimulai tanpa ini)

- [ ] **MW-19 — Pembaca mutasi bank lain** (satu bank = satu MW).
  Butuh contoh file mutasi asli yang angkanya sudah disamarkan.

- [x] **MW-19a — Bank Jago (PDF riwayat transaksi)** (12 November 2026)
  Pemilik memberi PDF "Pocket Transactions History" satu Kantong (98 transaksi,
  2022–2026) dan meminta pembacaannya otomatis seperti Ziraat. File asli hanya
  dibaca di memori dan profil sementara; isinya tidak disalin ke repo, tes
  memakai PDF sintetis dengan tata letak yang sama.
  - Pembaca teks PDF kecil tanpa dependency baru (`pdfText.ts`, memakai `fflate`
    yang sudah ada): objek dicari tanpa xref, object stream dibuka, FlateDecode
    dibatasi 48 MiB hasil buka, teks dipetakan lewat ToUnicode. PDF terenkripsi,
    kompresi lain, atau huruf tanpa peta teks ditolak. Producer Jago tidak
    memetakan glyph ligatur `ft`/`fh` huruf TT Commons; dua glyph itu dipetakan
    khusus untuk keluarga huruf tersebut (dicek terhadap halaman cetak), glyph
    lain tetap terlihat sebagai karakter tak dikenal.
  - Pembaca tabel Jago (`jagoStatement.ts`): kolom dicari dari judulnya per
    halaman, baris dikelompokkan dari tanggal, nama/ID yang terbungkus disambung,
    jumlah dan saldo dibedakan dari tandanya, mata uang dicocokkan dengan dompet.
    Rantai saldo antarbaris wajib cocok (urutan lama→baru atau sebaliknya).
  - Fakta disimpan sebagai `generic-v1` (`generic:` + 16 hex) sehingga format
    cadangan dan codec tidak berubah.
  - Jenis (keputusan pemilik, 13 Nov 2026): uang dari dan ke orang lain →
    pemasukan dan pengeluaran. Pindah Kantong, transfer dari atau ke rekening
    milik sendiri, dan isi saldo e-wallet → perpindahan (hanya saldo, tidak
    dihitung). Rekening milik sendiri dikenali dari nama pemilik di bagian atas
    PDF yang tercetak di rekening lawan, termasuk nama yang disamarkan (3 huruf
    terlihat berurutan cocok dengan nama pemilik). Nomor rekening saja tidak
    cukup. Shopee dan ShopeePay selalu mengikuti arah uang (keluar =
    pengeluaran, masuk = pemasukan), karena mutasinya tidak bisa diekspor
    (keputusan 13 Nov 2026). Kategori dari kata bank: GO-FOOD → Makan & minum;
    POS masuk dengan ID+nominal sama → Pengembalian dana; Bonus → Cashback.
  - Tab **Bank Jago PDF · otomatis** di halaman Impor (dompet IDR; dompet bernama
    "jago" dipilih lebih dulu).
  *Hasil pada file pemilik:* 98 dari 98 baris terbaca, saldo akhir sama dengan
  PDF; 17 pemasukan (Rp19,97 juta) dan 31 pengeluaran (Rp19,09 juta); 50
  perpindahan (hanya saldo); impor ulang → 98 duplikat. Termasuk di pemasukan:
  Rp4,49 juta dari ShopeePay pemilik (2026) dan Rp0,73 juta dari ShopeePay-Seabank
  (2022), karena ShopeePay tidak bisa diekspor. Termasuk di pengeluaran: Rp14,69
  juta ke Shopee (Jun dan Agt 2022, termasuk Rp13,80 juta untuk laptop) dan
  Rp0,70 juta ke Mandiri dengan nama `ZXXXXXXXXXXX3`. Tokopedia Rp0,69 juta
  menjadi pemasukan.
  *Batasan:* hanya tata letak PDF Jago ini (bahasa Indonesia, IDR). Kantong
  lain diimpor per file. Rekening milik sendiri dikenali dari PDF itu saja; dua
  file dari dua rekening sendiri mencatat perpindahannya sebagai perpindahan di
  kedua dompet, bukan pemasukan atau pengeluaran.
  Pembelian reksa dana lewat Bibit tetap pengeluaran tanpa kategori.
  - **Kategori umum untuk baris tanpa kata kunci** (keputusan pemilik, 14 Nov
    2026, setelah pratinjau file pemilik menyisakan 36 baris perlu dirapikan):
    uang masuk dari pihak lain (termasuk ShopeePay dan Tokopedia) → **Pemasukan**;
    uang keluar ke Shopee/ShopeePay → **Belanja**; pembelian reksa dana (Bibit)
    → **Investasi**; uang keluar lain → **Lainnya**. Ini cadangan saja: aturan
    kata kunci (bawaan dan pribadi) didahulukan, alasannya tampil di baris
    pratinjau, dan kategorinya tetap bisa diubah. Hanya berlaku saat impor PDF
    Jago; catatan yang sudah tersimpan tidak diubah. "Investasi" tidak ditambahkan
    ke daftar kategori bawaan (penanda paket kata kunci tetap 7); ia muncul di
    pilihan begitu dipakai. Menggantikan batasan Bibit di atas.
    *Belum dibuktikan pada file pemilik* (file asli tidak ada di sesi ini); pada
    PDF sintetis pratinjau menunjukkan 0 perlu dirapikan.
    *File:* `jagoStatement.ts`, `importer.ts` (field pratinjau
    `fallbackCategory`), `RecoveryImportView.tsx`, `jagoStatement.test.ts`,
    `tests/jago_browser.py`, `README.md`.
  *File:* `src/lib/pdfText.ts`, `src/lib/jagoStatement.ts`,
  `src/lib/testing/syntheticPdf.ts`, tes unit, `genericImport.ts` (ekspor
  fungsi fingerprint), `RecoveryImportView.tsx`, `tests/jago_browser.py`,
  `.github/workflows/ci.yml`, `README.md`, `STATUS.md`.
- [ ] **MW-20 — Impor PDF/XLS lama.** Ini makro; pecah dulu setelah ada contoh file.

## F. Tinjauan menyeluruh (18 November 2026) — daftar saja, belum dikerjakan

Dicek pada commit `67efddf` (main). Baseline yang dijalankan saat tinjauan:
`npm test` 65 file / 1.807 tes lulus; `npm run build` lulus (satu `index.html`;
vite melaporkan 893,64 kB, gzip 259,05 kB).

**Cara tinjauan:** empat peninjau (keamanan data, pemakaian langsung di browser,
produk, kode/CI). Setiap temuan lalu diperiksa ulang oleh peninjau kedua yang
berusaha membantahnya dengan membaca kode dan mengulang reproduksi. Di bawah,
"pemeriksa" berarti peninjau kedua itu dan "peninjau pertama" berarti peninjau
asal temuan. Dari 51
temuan: 41 terkonfirmasi, 10 benar sebagian, 0 terbantah. Yang benar sebagian
ditandai *(sebagian)* dan disebut bagian mana yang belum terbukti.

Peninjau kedua juga menambahkan 10 temuan sendiri yang tidak diperiksa ulang
oleh pihak lain. Yang hanya bersumber dari situ: MW-90, MW-92, MW-98, MW-125,
bagian nama kolom di MW-121, angka codec di MW-109, dan proteksi branch di F2.

**Batas tinjauan** (berlaku untuk semua angka di bagian ini):

- Hanya Chromium headless (Playwright Node) terhadap `npm run preview`, dengan
  data sintetis. Firefox, WebKit, Safari, iPhone/Android fisik, aplikasi Layar
  Utama, dan pembaca layar tidak diuji.
- `tests/*_browser.py` tidak dijalankan di sesi tinjauan (Python Playwright
  tidak terpasang di sana); angka CI diambil dari riwayat GitHub Actions.
- "CPU 4×" berarti perlambatan CPU di Chrome, bukan HP sungguhan.
- Baris impor dibuat dari file CSV lewat **CSV / Excel umum** (file Excel umum
  tidak diuji), bukan pembaca Jago atau Ziraat; biaya per baris pada file asli
  bisa berbeda.
- Sebagian angka diukur di Node terhadap pustaka aplikasi, bukan di tab
  browser: pemeriksaan MW-90, waktu pembaca file di MW-106, dan biaya pustaka di
  MW-111. Semua waktu berasal dari CPU kontainer tinjauan.
- Situs terbit (GitHub Pages) tidak dibuka: header cache dan `BUILD_INFO.json`
  yang terbit tidak diperiksa (berlaku untuk MW-103 dan MW-114).
- Audit tema gelap hanya mencakup 4 halaman dan 5 dialog dengan data contoh.
- Tidak diuji: apakah menghapus baris bank melegakan ruang saat kuota penuh.
- Usul perbaikan belum dibuat, kecuali disebut "prototipe".

**Aturan bagian ini:** satu MW per PR; sub-huruf (a, b, c) juga PR terpisah,
kecuali entrinya menyebut lain. Tiap sub-huruf punya kotak centang sendiri;
kotak MW induk dicentang setelah semua sub-hurufnya selesai atau dibatalkan
pemilik. Ukuran: **S** kurang dari ±1 jam, **M** satu sesi, **L** beberapa
sesi. **Butuh keputusan** berarti ada pilihan yang harus diambil dulu. Sejak 18
November 2026 agen boleh mengambilnya sendiri bila mudah dibatalkan, dan
mencatatnya di entri; selain itu menunggu pemilik. Kolom "Siapa" di tabel
keputusan menyebut yang mana.

Banner dan pengingat baru (MW-96, MW-103, MW-129c, MW-130b, dan teks tambahan
MW-100a) mengikuti MW-22 dan MW-47: tidak menumpuk kotak di atas halaman. Bila
lebih dari satu berlaku, hanya satu yang tampil dan sisanya menunggu.

### F1. Bug dan pesan yang salah

- [x] **MW-87 — Transaksi manual dan "Cek saldo" bisa dihapus lagi** (S)
  Transaksi manual (pengeluaran maupun penyesuaian "Cek saldo") yang dibuat
  **setelah** catatan mempunyai metadata sumber tidak bisa dihapus: toast merah
  "Metadata sumber tidak valid: Entry creation origin tidak ditemukan.", baris
  tetap ada, penyimpanan tidak berubah, sama setelah muat ulang (desktop dan
  HP). Transaksi manual yang dibuat sebelum ada metadata masih bisa dihapus, dan
  mengubah transaksi tetap bisa. Pemicu yang direproduksi: satu transfer manual
  lebih dulu. Impor mutasi dan arsip dompet melewati jalur kode yang sama tetapi
  tidak diulang.
  *Penyebab:* `deleteSourcedEntry` (`src/lib/sourceCommands.ts:139-148`)
  membuang baris `creationOrigins` dan `overrides` hanya di dalam cabang
  `if (link && metadata)`. Untuk entri tanpa tautan bank baris asalnya
  tertinggal, lalu ditolak validator (`src/lib/sourceModel.ts:427`).
  *Perbaikan:* buang baris `creationOrigins` dan `overrides` milik entri yang
  dihapus walau tanpa tautan bank. Fakta bank, tautan, dan disposisi tidak
  disentuh.
  *File:* `src/lib/sourceCommands.ts`, tes unit (pengeluaran manual dan
  penyesuaian pada dokumen yang sudah punya metadata), `tests/source_browser.py`
  atau `tests/browser_smoke.py` (transfer → pengeluaran manual → hapus → baris
  hilang dan tetap hilang setelah muat ulang).
  *Selesai 18 Nov 2026:* baris `creationOrigins` dan `overrides` milik entri
  dibuang di luar cabang tautan bank. Tes unit baru `src/lib/manualDelete.test.ts`
  (3 tes) dan skenario `manual-delete-after-metadata` di `tests/source_browser.py`
  (transfer → pengeluaran → Cek saldo → hapus keduanya, dengan muat ulang);
  keduanya gagal tanpa perbaikan dengan pesan yang dilaporkan. Tes browser hanya
  dijalankan di Chromium (desktop dan emulasi HP). Belum terbukti: pemicu lewat
  impor mutasi dan arsip dompet tidak diulang di browser.

- [x] **MW-88 — Pesan berbahasa Indonesia untuk file cadangan yang salah atau rusak** (S)
  Memilih file yang bukan cadangan di **Pulihkan cadangan** menampilkan pesan
  parser mentah berbahasa Inggris; cadangan yang terpotong menampilkan
  "Unterminated string in JSON at position 900 (line 1 column 901)"; JSON lain
  menampilkan teks validator internal. Tidak ada yang ditimpa.
  `src/App.tsx:630` meneruskan `err.message` apa adanya.
  - [x] **a.** Tangkap `SyntaxError` (`JSON.parse` di `parseRestoreFile`,
    `src/lib/fullBackup.ts:35`) dan JSON sah yang bukan cadangan Uangku, lalu
    tampilkan "File ini bukan cadangan Uangku yang bisa dibaca. Pilih file
    `uangku-lengkap-….json` atau `uangku-cadangan-….json`."; rincian teknis
    tetap tersedia di baris yang bisa dibuka. Petakan juga pesan parser mentah
    dari **Cadangkan semuanya** saat jurnal pemulihan rusak (lihat MW-104).
    Tambah kasusnya ke tes browser.
    *Selesai 19 Nov 2026:* file yang ditolak di **Pulihkan cadangan** kini
    menampilkan "File ini bukan cadangan Uangku yang bisa dibaca. Pilih file
    uangku-lengkap-….json atau uangku-cadangan-….json." Teks parser atau
    validator tetap ada di toast itu, tertutup, di bawah **Detail teknis**
    (label yang sama dengan jendela Privasi). Pemetaannya di lapisan tampilan
    (`restoreFailure` di `src/lib/fullBackup.ts`); `parseRestoreFile` tetap
    melempar pesan aslinya, jadi tes lama tidak berubah. Penolakan yang sudah
    jelas ditampilkan apa adanya tanpa rincian: ukuran di atas 32 MiB,
    "Selesaikan penyimpanan … sebelum memulihkan", dan semua "Versi … belum
    didukung." (cadangan lengkap, paket kata kunci, data dalam cadangan),
    supaya cadangan dari Uangku yang lebih baru tidak dijawab "pilih file
    lain". Memilih file berikutnya menutup toast penolakan sebelumnya. Jurnal
    pemulihan yang bukan JSON kini ditolak dengan pesan jurnal yang sudah ada
    ("Catatan pemulihan lengkap tidak dapat dibaca. Data tersimpan belum
    diubah."), jadi pada keadaan itu **Cadangkan semuanya** tidak lagi
    menampilkan teks parser; penguncian aplikasinya tetap urusan MW-104.
    *Keputusan agen (mudah dibatalkan):* cadangan Uangku yang isinya gagal
    divalidasi mendapat kalimat yang sama dengan file asing, karena keduanya
    "bukan cadangan yang bisa dibaca"; bedanya terlihat di detail teknis.
    *Dari tinjauan (dua peninjau):* penolakan versi paket kata kunci sempat
    berubah menjadi "bukan cadangan Uangku"; toast penolakan lama tetap tampil
    di atas dialog pemulihan dan detailnya tetap terbuka untuk file
    berikutnya; cincin fokus di toast galat nyaris tak terlihat di tema
    terang; dan dua penolakan yang dilempar di `App.tsx` tidak punya tes.
    Semuanya diperbaiki.
    *Tes:* `npm test` 68 file / 1.833 tes (2 baru: `fullBackup.test.ts`,
    `fullRestoreStorage.test.ts`), `npm run build` lulus. Chromium:
    `category_browser.py` 27/27 (kasus `full-backup-desktop` dan `-mobile`
    memeriksa empat file tak terbaca, detail yang bisa dibuka dan tertutup
    lagi untuk file berikutnya, dua penolakan versi, toast yang hilang saat
    file baik dipilih, dan **Cadangkan semuanya** pada jurnal rusak; kasus
    `financial-quota-draft-and-retry` memeriksa penolakan saat ada pekerjaan
    belum tersimpan), `recovery_browser.py` 16/16, `browser_smoke.py` 39
    skenario, `theme_browser.py` 21/21. Kasus cadangan-lengkap gagal pada kode
    lama.
    *Belum terbukti:* Firefox dan WebKit (lokal hanya Chromium). Detail teknis
    tetap berbahasa Inggris atau memakai istilah validator. Masih menampilkan
    teks parser mentah: **Cadangkan semuanya** bila pengaturan kategori yang
    tersimpan bukan JSON (di luar butir a dan b; belum ada MW-nya). Cadangan
    transaksi-saja dari codec yang lebih baru masih dijawab "bukan cadangan
    yang bisa dibaca" dengan alasannya di detail (bagian MW-102b). Pesan mentah
    di jalur lain (misalnya impor mutasi) tidak disentuh; itu butir b.
  - [x] **b.** Pesan yang bisa dipahami saat aksi pengguna gagal di validasi
    metadata (contohnya galat pada MW-87), bukan teks validator mentah.
    *Selesai 19 Nov 2026:* teks yang diawali "Metadata sumber tidak valid: "
    (awalan semua penolakan validator) kini tampil sebagai "Tindakan ini
    ditolak oleh pemeriksaan data, jadi tidak ada yang disimpan atau diubah."
    dengan alasan validatornya tertutup di bawah **Detail teknis**. Berlaku
    untuk semua toast galat di `src/App.tsx` dan untuk kotak galat di jendela
    dompet, impor mutasi, pelengkapan mutasi, kelola mata uang, dan isi
    kategori otomatis (`src/lib/failureText.ts`, komponen `FailureText`). Teks
    lain tidak diubah.
    Batas yang benar-benar dicapai catatan yang terus tumbuh adalah ukuran
    8 MB, jadi penolakan ukuran mendapat kalimatnya sendiri tanpa rincian:
    "Catatan sudah mencapai batas ukuran 8 MB, jadi perubahan ini tidak
    disimpan. Catatan yang sudah tersimpan tetap utuh." Toast sesudah ganti
    nama kategori menyelipkan penyebab di tengah kalimatnya; penyebab itu kini
    ditulis sebagai anak kalimat ("… belum ikut berganti: catatan sudah
    mencapai batas ukuran 8 MB. …"), dan titik gandanya hilang.
    *Keputusan agen (mudah dibatalkan):* batas 100 dompet juga mendapat
    kalimatnya sendiri ("Jumlah dompet sudah mencapai batas 100, jadi dompet
    baru tidak disimpan."). Kalimat untuk batas 100.000 transaksi dibiarkan
    ada, tetapi batas itu tidak bisa dicapai: catatan dengan transaksi
    terkecil sudah ditolak karena ukuran pada sekitar 84 ribu transaksi
    (diukur peninjau: 84.364 dan 84.771 menurut bentuk transaksinya).
    *Dari tinjauan (dua peninjau, tiap temuan dibuktikan di browser):*
    (1) penolakan ukuran 8 MB sebelumnya hanya mendapat kalimat umum,
    sedangkan sebelum MW ini kata "8 MB" masih terlihat; (2) di lebar desktop
    **Detail teknis** tampil sebagai kolom kedua di samping kalimat, terjepit
    58 px; (3) toast ganti nama kategori masih menampilkan teks validator
    mentah, dan satu tes unit justru mengunci perilaku itu; (4) dari delapan
    tempat yang dipasangi, hanya jendela dompet yang dijaga tes; (5) kotak
    galat di kartu file mutasi berubah ukuran huruf dan jaraknya untuk semua
    galat; (6) teks alasan di kotak galat tema terang hanya 3,98:1 karena
    `opacity: .9`. Semuanya diperbaiki. Klaim lama di catatan ini bahwa jalur
    umum "tidak bisa dipicu lewat layar" keliru: catatan di dekat batas 8 MB
    memicunya dari pemakaian biasa.
    *Tes:* `npm test` 70 file / 1.839 tes (6 baru di `failureText.test.ts` dan
    `FailureText.test.tsx`), `npm run build` lulus. Tes unit memakai
    penolakan yang sungguh dilempar validator untuk batas dompet dan batas
    ukuran; dua kalimat ukuran dari codec dicocokkan dengan teks di
    `sourceCodec.ts`. Chromium: `wallet_browser.py` 21/21 dengan kasus
    `wallet-limit-plain-message` (kalimat batas dompet; di kotak galat itu
    juga diukur letak **Detail teknis** di bawah kalimat dan `opacity` teks
    alasannya) dan kasus baru `validator-refusal-plain-everywhere` (catatan
    sintetis 40 byte di bawah batas: jendela dompet, toast transaksi, kotak
    simpan impor, dan toast ganti nama kategori semuanya menampilkan kalimat
    batas ukuran, tanpa teks validator di layar, dan byte tersimpan tidak
    berubah). Enam mutan (kalimat ukuran dicabut, toast tidak dipetakan, kotak
    impor tidak dipasangi, toast ganti nama seperti semula, tanpa elemen
    pembungkus, aturan `opacity` dicabut) masing-masing menggagalkan kasus
    yang menjaganya.
    *WebKit (run CI pertama PR #66 merah):* catatan sintetis itu, ±2,85 juta
    karakter, ditolak kuota `localStorage` WebKit (`QuotaExceededError`)
    saat Playwright mengisi `storage_state`, jadi kasusnya gagal sebelum
    halaman dibuka. Salahnya di tes. Catatan itu kini ditulis oleh skrip awal
    halaman saja. Di mesin yang menolaknya kasus melaporkan
    `size_limit_checked: false` dan nama galat mesinnya, tanpa menjalankan
    langkahnya; Chromium dan Firefox wajib menyimpan catatan itu dan
    menjalankan semua langkah. Pengukuran letak **Detail teknis** dipindah ke
    `wallet-limit-plain-message` supaya berjalan di ketiga mesin; mutan
    `opacity` dan mutan tanpa-pembungkus diulang di tempat barunya dan
    keduanya gagal. Cabang "mesin menolak" dibuktikan di Chromium dengan
    penolakan buatan: kasusnya gagal selama penjaga Chromium ada, dan melapor
    seperti di atas bila penjaga itu dicabut.
    Juga lulus: `currency_import_browser.py` 28/28, `category_browser.py`
    27/27, `bank_review_browser.py` 12/12, `source_browser.py` 5/5,
    `recovery_browser.py` 16/16, `browser_smoke.py` 39 skenario,
    `theme_browser.py` 21/21.
    *Belum terbukti:* Firefox dan WebKit hanya lewat CI (lokal hanya
    Chromium). Di WebKit empat tempat penolakan ukuran tidak diuji: kuotanya
    menolak catatan sintetis itu, jadi batas 8 MB validator tidak terjangkau
    di sana dengan catatan ini; apakah catatan berbentuk lain bisa
    menjangkaunya di WebKit tidak diperiksa. Kalimat umum
    dengan rincian tidak lagi bisa dipicu lewat layar sesudah batas ukuran
    mendapat kalimatnya sendiri, jadi letak rinciannya diuji dengan markup
    `FailureText` yang disisipkan ke kotak galat jendela dompet, bukan lewat
    penolakan sungguhan. Kotak galat di kelola mata uang, pelengkapan mutasi,
    dan isi kategori otomatis tidak dipicu di browser (yang terakhir tidak
    pernah menerima teks validator karena galatnya ditangkap menjadi toast).
    Saat sebuah dialog terbuka, **Detail teknis** di toast tidak bisa dicapai
    dengan Tab (perangkap fokus dialog sudah ada sebelumnya), dan pada lebar
    320 toast menutupi judul dialog. Bila catatan yang tersimpan sendiri
    ditolak saat dimuat, kotak status masih menampilkan teks validator mentah
    (bukan aksi pengguna; belum ada MW-nya). Kotak galat di formulir
    transaksi, kelola kategori, dan pemeta CSV tidak diubah karena galatnya
    berasal dari pemeriksaan formulir, bukan validator.

- [ ] **MW-89 — Unduh CSV: transfer bertanda benar, berbiaya, dan bermata uang tujuan** (S) — **butuh keputusan**
  Transfer Bank Jago → Ziraat (Rp 1.000.000 → ₺2.500, biaya Rp 6.500) diekspor
  sebagai satu baris `1000000.00,IDR` bertanda positif tanpa biaya di file IDR,
  dan file TL berisi baris IDR yang sama, bukan +2500.00 TRY. Transfer dalam
  mata uang yang sama juga satu baris positif. Akibatnya jumlah kolom Nominal
  tidak sama dengan saldo dompet, dan file TL memuat angka rupiah.
  *Keputusan:* dua baris bertanda per transfer (satu per dompet), atau satu
  baris dengan kolom tambahan (Biaya, Diterima, Mata uang tujuan). Daftar kolom
  sekarang ditetapkan di MW-11.
  *File:* `src/lib/csvExport.ts` + tes, `src/App.tsx:349-357`, satu pemeriksaan
  di tes browser. Hanya ekspor; format tersimpan tidak disentuh.

- [x] **MW-90 — Impor: catatan manual yang mirip ditawarkan sebagai kemungkinan duplikat** (M)
  Impor menandai catatan manual hanya bila tanggal **dan** nominal sama persis
  (`src/lib/importCommit.ts:33-35`, `:107`). Catatan manual sehari lebih awal,
  atau beda 0,01, tidak memberi tanda apa pun dan keduanya tersimpan. Diperiksa
  di tingkat pustaka, belum lewat layar impor.
  *Perbaikan:* tawarkan catatan manual di dompet yang sama dengan nominal
  bertanda sama dalam ±3 hari sebagai kandidat (tanggal kandidat sudah tampil di
  petunjuk, `src/components/RecoveryImportView.tsx:346`), dan pertahankan
  pilihan eksplisit yang sudah ada ("Lewati" / "Transaksi
  berbeda"). Tidak pernah melewati baris secara otomatis. Konsekuensi: lebih
  banyak baris minta keputusan bila nominal yang sama sering berulang.
  *File:* `src/lib/importCommit.ts` + tes, `tests/currency_import_browser.py`.
  *Selesai 19 Nov 2026:* catatan manual di dompet yang sama dengan nominal
  bertanda sama dalam ±3 hari (`MANUAL_MATCH_DAYS`) kini ditawarkan sebagai
  kandidat, tanggal terdekat lebih dulu. Barisnya tetap terpilih dan impor
  menunggu **Lewati** atau **Transaksi berbeda**; tidak ada yang dilewati
  otomatis. Untuk transfer manual yang dipakai dan ditampilkan adalah tanggal
  posting di dompet itu. Ringkasan di layar impor kini menyebut "tanggal yang
  sama atau berdekatan".
  *Lebih luas dari daftar file di atas, karena perlu:* layar impor memakai
  jalur bersumber (`inspectSourcedImport` di `src/lib/sourceCommands.ts`),
  bukan `importCommit.ts` saja. Jendela yang sama juga dipakai untuk baris yang
  sudah dikenal aplikasi (sesudah **Lewati**, tidak dicentang, atau "Simpan isi
  file saja") dan untuk pelengkapan mutasi (`src/lib/reconciliation.ts`), yang
  kini menolak menambah baris bila ada catatan manual bernominal sama di
  tanggal berdekatan. Tanpa itu, baris yang tidak dicentang berakhir kembar
  lewat pelengkapan tanpa tanda apa pun.
  *Keputusan agen (mudah dibatalkan):* saat menyimpan, kandidat manual
  ditentukan oleh pemeriksaan yang tampil di layar. Pemeriksaan lama di
  `importCommit.ts` juga menghitung yang bukan catatan manual di sana (catatan
  bank yang tanggal atau nominalnya dikoreksi); temuan seperti itu mengikuti
  pilihan baris saat ini dan tidak lagi meminta keputusan yang tombolnya tidak
  ada di layar.
  *Dari tinjauan (dua peninjau):* temuan memblokir: sesudah catatan bank
  dikoreksi, baris baru bernominal sama dalam 3 hari membuat impor menolak
  menyimpan sambil menunjuk pilihan yang tidak tampil (jalan buntu yang sudah
  ada untuk tanggal yang sama, dan melebar karena jendela ini). Juga: baris
  yang sudah dikenal dan pelengkapan mutasi masih memeriksa tanggal yang sama
  saja; petunjuk kandidat transfer menampilkan tanggal kirim, bukan tanggal
  yang dicocokkan; tes transfer tidak bisa membedakan keduanya. Semuanya
  diperbaiki dan tiap perbaikan punya tes yang gagal bila perbaikannya dicabut.
  *Tes:* `npm test` 71 file / 1.862 tes (23 baru: 10 di `importCommit.test.ts`,
  13 di `importNearbyManual.test.ts` lewat jalur yang dipakai layar; 14 dari
  20 yang pertama gagal pada kode lama, 7 di tiap file), `npm run build`
  lulus. Chromium: `currency_import_browser.py` 29/29 dengan kasus baru
  `manual-nearby-offered-not-skipped` (catatan manual dua hari sebelum mutasi;
  gagal bila jendelanya 0 hari), `bank_review_browser.py` 12/12,
  `jago_browser.py` 3/3, `backfill_browser.py` 2/2, `source_browser.py` 5/5,
  `recovery_browser.py` 16/16, `browser_smoke.py` 39 skenario. Angka ini dari
  pengulangan sesudah pekerjaan ini dipindah ke atas MW-88b, termasuk bukti
  "gagal bila jendelanya 0 hari"; bukti "gagal pada kode lama" untuk tes unit
  berasal dari sebelum pemindahan dan tidak diulang.
  *Belum terbukti:* Firefox dan WebKit (lokal hanya Chromium). Nominal tetap
  harus sama persis: beda 0,01 tidak ditawarkan (di luar perbaikan yang
  diminta). Baris yang sudah dikenal dan penolakan pelengkapan mutasi hanya
  diuji di tingkat unit, belum lewat layar. Seberapa sering jendela ±3 hari
  menambah permintaan keputusan pada data asli belum diukur.

- [ ] **MW-91 — Ikon transaksi dan dompet di tema gelap mendapat warna semantiknya** (S) *(sebagian)*
  Di tema gelap semua varian `.transaction-icon`, `.stat-icon`, dan
  `.wallet-icon` berwarna sama (rgb(175,194,175) di atas rgb(38,58,45)).
  Daftar `:is()` di `src/styles.css:1004-1008` memuat
  `.import-step > span:first-child`, sehingga spesifisitasnya mengalahkan aturan
  semantik di baris 1009-1028. Mengeluarkan anggota itu dari daftar memulihkan
  warnanya untuk varian yang punya aturan gelap; ikon pengeluaran di tabel
  (`.transaction-icon.expense`) tidak punya aturan sendiri di 1009-1028 dan
  tetap netral. Dampaknya kosmetik: baris tetap terbedakan dari bentuk ikon dan
  warna nominal. Catatan MW-73 "tema gelap sudah punya warna berbeda" saat ini
  tidak benar untuk ikon, jadi kerjakan ini sebelum MW-73.
  *File:* `src/styles.css`, `tests/theme_browser.py` (ikon pemasukan, transfer,
  dan pengeluaran di gelap harus berbeda satu sama lain).

- [ ] **MW-92 — Contoh "Perpindahan dana" di form mengikuti keputusan 13 November** (S) — **butuh keputusan**
  Petunjuk di `src/components/TransactionModal.tsx:30` memberi contoh "kiriman
  ke rekening orang lain". Keputusan 13 Nov 2026 (MW-19a) untuk pembaca Bank
  Jago: uang dari dan ke orang lain adalah pemasukan/pengeluaran, dan
  perpindahan hanya untuk rekening sendiri dan isi saldo e-wallet. Keputusan itu
  tercatat untuk impor Jago saja; pembaca Ziraat masih mencatat pokok transfer
  (Havale, termasuk ke orang lain) sebagai perpindahan dana (`README.md:123`,
  catatan penutup D7), jadi contoh di form sekarang cocok dengan Ziraat.
  *Keputusan:* apakah aturan 13 Nov berlaku umum. Bila ya, ganti contohnya
  dengan kasus rekening sendiri dan perbarui tes yang memeriksa teks petunjuk;
  penyesuaian pembaca Ziraat menjadi MW tersendiri.

### F2. Keamanan data

- [x] **MW-93 — Dialog Pulihkan membandingkan file dengan catatan di browser** (S)
  Pemulihan mengganti semuanya, dan teks konfirmasi dibangun dari file saja
  (`src/App.tsx:602-611`): jumlah dompet, transaksi, kategori, aturan. Tidak ada
  jumlah di browser, tanggal transaksi terbaru di kedua sisi, atau berapa
  catatan yang hanya ada di browser. Direproduksi: browser 10 transaksi, file 10
  transaksi, satu catatan yang hanya ada di browser hilang. Dialog menyebut
  "akan menggantikan" dan sudah punya tombol **Cadangkan dulu**, tetapi tidak
  menunjukkan bahwa ada catatan yang tidak ada di file.
  *Perbaikan:* tambahkan "Di browser ini: N transaksi, terbaru `<tanggal>`. Di
  file: M transaksi, terbaru `<tanggal>`. K catatan di browser ini tidak ada di
  file." Bila K > 0, **Cadangkan dulu** menjadi tombol utama. Bandingkan catatan
  manual lewat id entri dan baris bank lewat sidik jari sumbernya: id baris
  impor memuat UUID per impor, jadi perbandingan id saja melebih-lebihkan bila
  mutasi yang sama diimpor terpisah di dua perangkat. Format file tidak berubah.
  *File:* `src/App.tsx`, pembantu murni baru + tes, `tests/full_backup_browser.py`.
  *Selesai 19 Nov 2026:* dialog pulihkan (cadangan lengkap dan transaksi saja)
  memuat kotak "Di browser ini: N transaksi, terbaru … Di file: M transaksi,
  terbaru …" dan "K catatan di browser ini tidak ada di file." Bila K > 0
  kotaknya kuning, kalimat K ditaruh paling depan, dan **Cadangkan dulu**
  menjadi tombol utama yang langsung terfokus. Bila K = 0 tertulis "Tidak ada
  catatan yang hanya ada di browser ini. Perubahan pada catatan yang sama tidak
  dibandingkan." dan tombol tidak berubah. Pembantu murni
  `src/lib/restoreComparison.ts`, dihitung sekali saat file dipilih: catatan
  ada di file bila id-nya sama, atau (baris bank) bila sidik jarinya ada pada
  catatan di file. Format file tidak diubah.
  *Keputusan agen (mudah dibatalkan):*
  - Tombol utama **Cadangkan dulu** pindah ke urutan terakhir supaya di HP
    selebar dialog tanpa mengubah CSS.
  - Data contoh yang tidak disentuh tidak dihitung ("Di browser ini hanya ada
    data contoh.").
  - Bila data tersimpan tidak terbaca, K tidak diketahui dan pemulihan menimpa
    satu-satunya salinan; dialog memperlakukannya seperti K > 0 (kotak kuning,
    **Cadangkan dulu** utama, yang mengunduh `uangku-data-asli-…`).
  - "Terbaru" memakai tanggal posting yang tercatat; sisi transfer yang
    tanggalnya tercatat belum diketahui tidak ditebak dari tanggal entri, dan
    bila tidak ada tanggal yang diketahui tertulis "tanggal terbaru belum
    diketahui".
  - Satu baris bank di file mewakili satu catatan saja.
  *Dari tinjauan (empat lensa, lalu diperiksa ulang):* transfer yang dipasangkan
  lalu dipisah lagi di perangkat yang sama sempat terhitung "tidak ada di file"
  (diperbaiki, ada tesnya); kalimat K = 0 semula "Semua catatan … juga ada di
  file", yang menjanjikan lebih dari yang diperiksa; data tak terbaca semula
  tidak mengedepankan cadangan. Peninjau lensa tes dan pemeriksaan ulang lensa
  tampilan tidak sempat berjalan (batas pemakaian); temuan lensa tampilan
  diperiksa sendiri oleh agen.
  *Tes:* `npm test` 67 file / 1.825 tes (15 baru; tes pasang-pisah gagal bila
  perbaikannya dicabut), `npm run build` lulus. Chromium: `category_browser.py`
  27/27 (kasus `full-backup-desktop` dan `-mobile` diperluas, termasuk unduhan
  data asli pada profil tak terbaca), `browser_smoke.py` 39 skenario,
  `recovery_browser.py` 16/16. Sebelum perbaikan tinjauan juga dijalankan
  `source_browser.py` 5/5 dan 5/5 `--mobile`, `wallet_browser.py` 19/19,
  `currency_import_browser.py` 28/28. 10.000 baris bank di kedua sisi: ±20 ms
  di Node pada kontainer ini (panggilan pertama ±80 ms), diukur sebelum
  "terbaru" memakai tanggal posting.
  *Belum terbukti:* Firefox dan WebKit (hanya Chromium yang dijalankan lokal).
  Hanya keberadaan catatan yang dibandingkan: catatan yang sama tetapi diubah
  sesudah file dibuat tidak terhitung (dialog kini mengatakannya), dompet tidak
  dibandingkan, dan mutasi yang diimpor ke dompet ber-id lain tetap terhitung
  karena sidik jari memuat id dompet. Pada 320 px dengan layar sangat pendek
  sebagian kotak masih di bawah lipatan dialog. Deteksi data contoh memakai
  aturan `reviewDemo` yang sudah ada, yang di zona waktu UTC+12 ke atas bisa
  menganggap baris contoh sebagai buatan pengguna.

- [ ] **MW-94 — Nama file cadangan memuat jam** (S)
  Nama sekarang hanya bertanggal (`src/App.tsx:222,228,258`), jadi dua cadangan
  di hari yang sama hanya dibedakan akhiran " (1)" dari browser. Jadikan
  `uangku-lengkap-YYYY-MM-DD-HHmm.json` (dan padanannya), lalu sebut nama file di
  toast sukses. Periksa tes yang mencocokkan nama file. Isi file tidak diubah:
  skema cadangan tertutup dan menolak field tambahan.

- [x] **MW-95 — `.gitignore` menutup semua nama unduhan aplikasi** (S)
  Pola sekarang (`*backup*.json`, `*cadangan*.json`) tidak mengenai
  `uangku-lengkap-<tanggal>.json`, `uangku-data-asli-<tanggal>.json`,
  `uangku-pekerjaan-belum-tersimpan.json`, dan
  `uangku-pengaturan-kategori-<tanggal>.json`. Repo ini publik. Belum ada file
  seperti itu yang terlacak, dan risikonya baru muncul bila file disalin ke
  folder repo. Tambahkan `uangku-*.json`.
  *File:* `.gitignore`. Kalimat tambahan di `AGENTS.md` hanya atas persetujuan
  pemilik.
  *Selesai 18 Nov 2026:* `uangku-*.json` ditambahkan. Diperiksa dengan
  `git check-ignore` terhadap kelima nama unduhan JSON aplikasi
  (`uangku-lengkap-…`, `uangku-data-asli-…`, `uangku-cadangan-…`,
  `uangku-pekerjaan-belum-tersimpan.json`, `uangku-pengaturan-kategori-…`);
  unduhan CSV (`uangku-riwayat-…csv`) sudah tertutup pola `*.csv`. Tidak ada
  file terlacak yang cocok dengan pola baru. `AGENTS.md` tidak diubah.

- [x] **MW-96 — Meter penyimpanan dan peringatan dini** (S)
  Batas nyata di Chromium adalah 5.242.880 karakter UTF-16 untuk **semua** kunci
  dan nama kunci di satu origin, bukan 8 MiB. Aplikasi membatasi per kunci dalam
  byte UTF-8 (`src/lib/persistence.ts:11,72-73`, `src/lib/storage.ts:7,101`).
  Terukur oleh pemeriksa: 302–354 karakter per baris impor (peninjau pertama:
  335–363; untuk catatan campuran pakai ±370); 10.000 baris = 3.380.910 karakter
  (peninjau pertama: 3.605.968); impor 5.000 baris yang ketiga (15.000 baris)
  gagal. Kegagalannya aman (data
  lama utuh, draft bisa diunduh), tetapi tidak ada tampilan pemakaian di mana
  pun. Belum terbukti: perkiraan "berapa tahun sampai penuh" dan batas Safari.
  *Perbaikan:* meter di jendela **Privasi dan cadangan** dan banner mulai ±70%,
  dihitung dari jumlah panjang kunci dan nilai di `localStorage` terhadap batas
  5.242.880 karakter (Chromium). Batas browser lain belum diukur. Opsional
  (usul peninjau): uji tulis-lalu-hapus pada kunci sementara tersendiri (bukan
  kunci data) sambil memegang Web Lock catatan, supaya sisa ruang benar di
  browser mana pun; kunci sementara itu selalu dihapus lagi, juga bila uji
  gagal.
  *File:* modul kecil baru + tes, `src/components/PrivacyNotice.tsx`, `src/App.tsx`.
  *Selesai 19 Nov 2026:* `src/lib/storageUsage.ts` menjumlahkan panjang semua
  nama kunci dan nilai di `localStorage` (hanya membaca) terhadap 5.242.880
  karakter. Jendela **Privasi dan cadangan** menampilkan "Ruang penyimpanan: N%
  terpakai", batang meter, dan angkanya ("3.145.800 dari 5.242.880 karakter"),
  dengan keterangan bahwa batas itu berlaku di Chrome dan Edge. Mulai 60%
  muncul banner "Ruang penyimpanan browser terpakai N%." dengan **Cadangkan
  sekarang** dan **Nanti saja**. Dihitung ulang sesudah tiap simpan dan tiap
  kali jendela Privasi dibuka.
  *Keputusan agen (mudah dibatalkan):*
  - Ambang 60%, bukan 70%. Catatan 10.000 baris impor terukur 64–69%, dan impor
    5.000 baris sesudahnya yang ditolak; pada 70% sisa ruang (±1,57 juta
    karakter) tidak cukup untuk satu impor 5.000 baris (1,5–1,9 juta), pada 60%
    (±2,1 juta) cukup. Satu konstanta di `storageUsage.ts`.
  - Satu kotak saja di atas halaman (MW-22): peringatan penyimpanan tampil lebih
    dulu dan pengingat cadangan menunggu. **Nanti saja** menutup keduanya sampai
    besok, memakai kunci pengingat yang sudah ada (tidak ada kunci baru).
  - **Cadangkan sekarang** memenuhi peringatan itu: banner hilang selama catatan
    yang tersimpan sama dengan yang terakhir dicadangkan, dan kembali sesudah
    simpan berikutnya.
  - Banner tidak tampil pada data contoh, saat penyimpanan perlu dipulihkan,
    atau saat ada simpan yang gagal (kotak merahnya sudah memuat unduhan yang
    bisa dipakai saat itu).
  - Persen dibulatkan ke bawah dan paling tinggi 100. Uji tulis-lalu-hapus
    (opsional) tidak dikerjakan.
  *Dari tinjauan (dua peninjau):* **Cadangkan sekarang** semula tidak menutup
  banner; ambang 70% tidak memperingatkan pada kasus yang memicu MW ini; banner
  semula menumpuk di bawah kotak "Belum tersimpan"; dan tes semula tidak
  mencakup munculnya banner sesudah simpan. Keempatnya diperbaiki.
  *Tes:* `npm test` 68 file / 1.829 tes (4 baru di
  `src/lib/storageUsage.test.ts`), `npm run build` lulus. Chromium:
  `ux_browser.py` 5/5 dengan kasus baru `storage-desktop`, `storage-mobile`,
  dan `storage-gating`: meter cocok dengan jumlah yang dihitung di halaman;
  origin diisi sampai 20 karakter di bawah ambang lewat kunci milik halaman
  lain (meter 59%, tanpa banner), lalu satu simpan lewat aplikasi memunculkan
  banner tanpa muat ulang; banner menunggu di belakang simpan yang gagal;
  **Nanti saja** bertahan sesudah muat ulang; **Cadangkan sekarang**
  menutupnya; data contoh dan data tak terbaca menampilkan meter tanpa banner.
  Empat perilaku itu dicabut satu per satu dan tiap kali kasusnya gagal.
  `theme_browser.py` 21/21 dan `browser_smoke.py` 39 skenario; sebelum
  perbaikan tinjauan juga `kerangka_browser.py`.
  *Belum terbukti:* Firefox dan WebKit (lokal hanya Chromium). Batas browser
  lain tidak diukur, jadi di sana persennya bisa terlalu rendah; WebKit
  menghitung kuota dalam byte, sehingga catatan berisi huruf di luar Latin-1
  (misalnya keterangan mutasi Ziraat) bisa penuh jauh sebelum meter mencapai
  100%. Bila mesin lain menolak pengisi ±3,1 juta karakter, kasus browser
  melaporkan `warning_checked: false` dan tidak menguji banner di mesin itu.
  Banner mencerminkan yang sudah tersimpan, bukan ukuran impor berikutnya:
  impor yang lebih besar dari sisa ruang tetap ditolak. Banner menambah ±180 px
  di layar pertama HP saat tampil.

- [x] **MW-97 — Pesan yang jelas saat penyimpanan penuh, dan angka kapasitas di dokumen** (S)
  Galat kuota dilebur menjadi satu pesan umum "Penyimpanan gagal atau penuh…"
  (`src/lib/persistence.ts:95-97`). Kenali `QuotaExceededError` dan katakan apa
  yang terjadi serta apa yang harus dilakukan (unduh cadangan lengkap). Jangan
  menyarankan menghapus baris bank untuk melegakan ruang: itu bertentangan
  dengan `AGENTS.md` (fakta bank dipertahankan) dan belum diuji apakah
  penghapusan melegakan ruang. Koreksi
  kalimat 8 MiB di `README.md:172` dan `STATUS.md:26`: batas yang lebih dulu
  tercapai adalah kuota browser (`README.md:173` sudah menyinggungnya).
  *Selesai 19 Nov 2026:* `commitPrepared` (`src/lib/persistence.ts`) mengenali
  galat kuota (`QuotaExceededError`, `NS_ERROR_DOM_QUOTA_REACHED`, kode 22 dan
  1014) dan menampilkan "Penyimpanan browser penuh, jadi perubahan ini belum
  tersimpan. Catatan yang sudah tersimpan tetap utuh. Unduh pekerjaan yang
  belum tersimpan: file itu memuat seluruh transaksi termasuk perubahan ini."
  Galat lain tetap "Penyimpanan gagal. …" tanpa kata "penuh". Tidak ada saran
  menghapus baris bank. `README.md` dan `STATUS.md` kini menyebut kuota browser
  sebagai batas yang lebih dulu tercapai, dengan angka Chromium dari MW-96.
  *Menyimpang dari usul:* pesan tidak menyuruh "unduh cadangan lengkap". Selama
  ada simpan yang gagal, **Cadangkan semuanya** ditolak aplikasi
  (`exportFullBackup` menuntut tidak ada pekerjaan yang belum tersimpan), jadi
  yang disarankan adalah satu-satunya unduhan yang berfungsi saat itu, tombol
  **Unduh pekerjaan yang belum tersimpan** di kotak yang sama. File itu memuat
  seluruh transaksi, tetapi tidak memuat pengaturan kategori.
  *Tes:* `npm test` 68 file / 1.831 tes (2 baru di
  `src/lib/persistence.test.ts`; keduanya gagal pada kode lama), `npm run
  build` lulus. Chromium: `recovery_browser.py` 16/16 (kasus
  `quota-recovery-retry` kini memeriksa kalimat barunya), `browser_smoke.py`
  39 skenario, `source_browser.py` 5/5.
  *Belum terbukti:* Firefox dan WebKit (lokal hanya Chromium); nama galat
  Firefox diambil dari dokumentasi, bukan dari uji di Firefox. Kuota sungguhan
  tidak diuji di sini (galatnya buatan; itu MW-98). Hanya jalur simpan catatan
  yang diubah: pemulihan lengkap dan penyimpanan pengaturan kategori masih
  memakai pesannya sendiri.

- [ ] **MW-98 — Tes browser pada kuota penyimpanan sungguhan** (S–M)
  Semua tes kuota sekarang memalsukan galatnya (`tests/browser_smoke.py:370`,
  `tests/category_browser.py:524,566`, `tests/bank_description_browser.py:352`,
  `tests/recovery_browser.py:180-214`), dan tes "mendekati 8 MiB" hanya tes
  unit. Tambah satu tes pada build produksi yang mengisi `localStorage` sungguhan
  sampai simpan berikutnya gagal, lalu memeriksa: label dan pesan gagal, data
  tersimpan sama persis, unduhan pekerjaan-belum-tersimpan sama dengan draft,
  dan pemulihan file di atas kuota tidak mengubah catatan, kategori, anggaran,
  maupun template.

- [ ] **MW-99 — Pengingat cadangan menurut jumlah perubahan** (S) *(sebagian)* — **butuh keputusan**
  Setelah cadangan lengkap, pengingat diam 7 hari apa pun yang berubah
  (`src/lib/backupReminder.ts:98,119-122`), termasuk setelah impor satu bulan
  mutasi. Seberapa mungkin data terhapus browser dalam jeda itu tidak terbukti
  (tidak ada penghapusan yang teramati).
  *Usul:* simpan jumlah entri di samping sidik jari pada `uangku:last-backup:v1`
  (pembaca sekarang hanya memeriksa `at` dan `fingerprint`), munculkan pengingat
  bila bertambah N entri, dan tawarkan **Cadangkan sekarang** di pesan sukses
  impor. Ini mengubah aturan MW-08 dan memperluas catatan MW-06, jadi dicatat
  sebagai MW baru.
  *Keputusan:* ambang (mis. 25 entri baru, atau setiap impor).

- [ ] **MW-100 — Penyimpanan kosong menawarkan "Pulihkan cadangan"; status persisten terlihat** (S) *(sebagian)*
  Profil yang terhapus dibuka sebagai data contoh tanpa petunjuk pemulihan di
  area utama (pemulihan tetap ada di sidebar dan menu akun). Jawaban
  `navigator.storage.persist()` hanya tampil di jendela Privasi
  (`src/App.tsx:741`, `src/lib/storagePersistence.ts:47-58`).
  - [ ] **a.** Banner data contoh menambah "Punya file cadangan? Pulihkan cadangan".
  - [ ] **b.** Status "penyimpanan persisten: tidak" terlihat di dekat label simpan,
    dengan tautan ke penjelasannya. Jawaban `persist()` di perangkat pemilik
    belum diuji; di browser uji hasilnya "tidak".
  - [ ] **c.** Kalimat di Privasi tentang Safari yang dapat menghapus data setelah 7
    hari tidak dibuka. Sesi AI tidak bisa mengeceknya: tulis sebagai kemungkinan
    ("dapat"), dan jadikan pernyataan pasti hanya sesudah pemilik mengeceknya
    di iPhone asli (bersama MW-105b).
  - [ ] **d.** (M, opsional) — **butuh keputusan** Cadangan otomatis di Chromium
    desktop: pemilik memilih satu file sekali (File System Access API); setiap
    simpan yang berhasil menulis ulang cadangan lengkap ke file itu; kegagalan
    dilaporkan dan tidak pernah menghalangi simpan. Tidak tersedia di HP.

- [ ] **MW-101 — Sesudah memulihkan, tidak muncul "Belum ada cadangan lengkap"** (S) — **butuh keputusan**
  Tepat setelah pemulihan lengkap di browser baru, banner "Belum ada cadangan
  lengkap." dan baris "Cadangan terakhir: belum ada" tampil, karena hanya unduhan
  **Cadangkan semuanya** yang menulis catatan cadangan. Petunjuk iPhone (MW-10)
  justru menyuruh mencadangkan di Safari lalu memulihkan di Layar Utama.
  *Keputusan:* apakah pemulihan yang berhasil dihitung sebagai "punya cadangan"
  sampai data berubah. Ini mengubah arti catatan yang ditetapkan MW-06.
  *File:* `src/lib/backupReminder.ts` + tes, `src/App.tsx`.

- [ ] **MW-102 — Pengaturan kategori yang tidak terbaca tidak bisa ditimpa sekali klik** (S)
  Pengaturan kategori dengan `keywordPackVersion` lebih baru dari yang dikenal
  dianggap tidak terbaca: tidak ada peringatan di Ringkasan, **Cadangkan
  semuanya** menolak dengan "Versi paket kata kunci belum didukung.", dan
  **Kelola kategori** terbuka dengan bawaan lalu menimpa pengaturan tersimpan
  dengan satu klik tanpa menyimpan salinan. Pemicunya sempit: tab atau aplikasi
  Layar Utama versi lama yang berbagi penyimpanan dengan versi baru, dan
  pengguna tetap menyimpan walau ada peringatan. Catatan keuangan tidak
  tersentuh.
  - [ ] **a.** Simpan teks lama ke kunci samping sebelum mengganti, dan sediakan
    "Unduh pengaturan lama (mentah)"; **Simpan pengaturan** dinonaktifkan sampai
    tombol unduh itu dipakai.
  - [ ] **b.** Kenali versi yang lebih baru: "dibuat oleh Uangku versi lebih baru,
    muat ulang halaman", tanpa tawaran menimpa. Kalimat yang sama untuk cadangan
    versi lebih baru saat pemulihan.

  *File:* `src/lib/categorySettings.ts`, `src/hooks/useCategorySettings.tsx`,
  `src/components/CategoryManager.tsx`; untuk butir b juga asal pesan penolakan
  cadangan versi lebih baru (`src/lib/fullBackup.ts:39`,
  `src/lib/sourceCodec.ts:125`); tes terkait.

- [ ] **MW-103 — Pemberitahuan "versi baru tersedia"** (S)
  Aplikasi tidak pernah memeriksa versi baru; `BUILD_INFO.json` yang ditulis
  `pages.yml` tidak dibaca. Saat jendela mendapat fokus, ambil `BUILD_INFO.json`
  tanpa cache dan bandingkan dengan commit build; bila berbeda tampilkan "Versi
  baru tersedia · Muat ulang". Aplikasi menyimpan hash pendek sedangkan
  `BUILD_INFO.json` memuat 40 karakter, jadi bandingkan awalannya. File itu
  hanya dibuat di `pages.yml`: di `npm run preview` dan tes browser
  permintaannya gagal dan harus diabaikan tanpa pesan. Tidak pernah memuat
  ulang sendiri saat form
  terbuka atau ada perubahan belum tersimpan. Ini menjadi permintaan jaringan
  pertama selain halaman, jadi sebutkan di Privasi; bila MW-107 dipakai,
  `connect-src` menjadi `'self'`.

- [ ] **MW-104 — Jurnal pemulihan yang tidak terbaca disisihkan, bukan mengunci aplikasi** (S)
  Bila `uangku:full-restore:v1` tidak bisa dibaca, aplikasi tetap di "Data lama
  dilindungi · pemulihan diperlukan" selamanya. Muat ulang, cadangan lengkap,
  pemulihan, dan "Ganti data tersimpan dengan dompet kosong" semuanya gagal
  (dengan aman: catatan sama persis); hanya unduhan salinan mentah yang jalan.
  Kemungkinannya sangat kecil karena jurnal ditulis dalam satu langkah; bentuk
  jurnal dari versi aplikasi yang lebih baru akan terkunci dengan cara yang sama.
  *Perbaikan:* pindahkan teks jurnal ke kunci samping (tidak dihapus), lepaskan
  status terkunci aplikasi, dan tampilkan pemberitahuan bahwa data tersimpan
  tidak diubah dan pengaturan kategori mungkin berasal dari pemulihan yang
  terputus.
  *File:* `src/lib/fullRestoreStorage.ts:53-62,73-82`,
  `src/hooks/useLedgerStorage.ts`, tes terkait.

- [ ] **MW-105 — Unduhan cadangan di HP** *(sebagian)*
  Tautan blob dicabut 1 detik setelah klik (`src/App.tsx:69-74`), dan cadangan
  dicatat berhasil tanpa syarat (`src/App.tsx:252-260`). Apakah HP benar-benar
  gagal menyimpan file **belum terbukti**: di Chromium desktop (juga dengan
  emulasi HP dan file 3,5 MB) unduhan selalu selesai.
  - [ ] **a.** (S) Biarkan tautan blob hidup 60 detik, di `downloadText` dan di
    unduhan pengaturan kategori yang memakai pola sama
    (`src/components/CategoryManager.tsx:175-178`).
  - [ ] **b.** (pemilik) Jalankan cadangkan → pulihkan sekali di iPhone (Safari dan
    Layar Utama) dan Android; catat hasilnya di `STATUS.md`.
  - [ ] **c.** (S–M) Bila `navigator.canShare({files})` tersedia, tawarkan "Bagikan /
    simpan ke Files"; unduhan biasa tetap ada.
  - [ ] **d.** (S) — **butuh keputusan** "Uji file cadangan": pilih file yang sudah
    disimpan, validasi tanpa menulis, bandingkan dengan catatan tersimpan.
    Mengubah batasan yang diterima di MW-06.

- [ ] **MW-106 — Batas pembaca PDF dan XLSX agar file rusak tidak membekukan tab** (S)
  File impor tidak bisa menjalankan kode atau merusak data menurut peninjau
  pertama (bom zip ditolak sebelum dibuka, tidak ada jalur XSS; dua pemeriksaan
  itu tidak diulang pemeriksa), tetapi pembacaan berjalan di thread utama.
  Diukur pemeriksa di Node pada pembaca milik aplikasi, bukan di tab browser:
  PDF 1,3 KB dengan 1.600 rentang peta karakter menahan pembacaan 15,9 detik
  (`src/lib/pdfText.ts:482-502`, ±10 ms per rentang), dan XLSX 49,6 KB berisi
  28,8 MiB sel kosong diterima setelah 11,2 detik. Di browser, peninjau pertama
  mengukur 2,9 detik untuk PDF 400 rentang dan 8,6 detik untuk XLSX 53 KB
  berisi 31 MiB sel kosong. Hanya terjadi pada file yang rusak atau sengaja
  dibuat jahat.
  - [ ] **a.** Batasi jumlah kode yang dipetakan per font dan per dokumen; gagal
    dengan "Peta karakter PDF tidak valid."; tes unit dengan banyak rentang.
  - [ ] **b.** Batasi jumlah sel worksheet sebelum baris dibangun; gagal dengan
    pesan yang jelas, isi tidak pernah ditebak.
  - [ ] **c.** (M, opsional) Pembacaan file di Web Worker.

- [ ] **MW-107 — Content-Security-Policy** (S, opsional) *(sebagian)*
  Halaman tidak punya CSP. CSP meta berbasis hash terbukti jalan dengan build
  sekarang tanpa pelanggaran (disuntikkan di browser uji). Perlindungannya lebih
  kecil dari kesan pertama: tidak menahan skrip di path lain pada origin yang
  sama (`zayyan353.github.io`), dan tidak menahan navigasi yang membawa data di
  URL. Hanya origin terpisah (domain sendiri atau akun lain) yang menghapus
  risiko origin bersama; itu butuh pindah data lewat cadangan dan pemulihan,
  dan keputusan pemilik. Hash harus dihitung setelah `vite-plugin-singlefile`
  menyisipkan skrip. Bila MW-103 atau MW-114 dipakai, `connect-src` menjadi
  `'self'`.
  *File:* langkah pasca-build di `vite.config.ts`, tes browser (tidak ada
  pelanggaran selama alur dasar; `fetch` ke host lain diblokir).

- [ ] **MW-108 — Cadangan berfrasa sandi** (M, opsional) — **butuh keputusan**
  Cadangan lengkap adalah JSON yang bisa dibaca siapa pun yang memegang filenya
  (sudah disebut di Privasi). Enkripsi dengan WebCrypto murah (PBKDF2 600.000
  putaran 119–176 ms; AES-GCM 17–24 ms pada catatan ±3,5 juta karakter, dua
  pengukuran) dan tanpa
  dependensi baru. Risikonya: frasa sandi yang terlupa membuat cadangan tidak
  bisa dibuka. Ekspor polos tetap bawaan; versi aplikasi lama menolak amplop
  terenkripsi.

- [ ] **MW-109 — Kapasitas jangka panjang** — **butuh keputusan**
  30,7% karakter catatan 10.000 baris adalah id entri dan fakta yang membawa
  UUID impor (±111 karakter per baris); deflate mengecilkannya 4,08× menurut
  peninjau pertama dan 5,33× pada pengulangan pemeriksa. Codec juga
  membuang nilai bawaan kolom begitu satu baris berbeda
  (`src/lib/sourceCodec.ts:60,147`): satu transaksi manual pada catatan 10.000
  baris satu dompet menambah 150.057 karakter.
  - [ ] **a.** (M) Id lebih pendek untuk impor **baru**; id lama tidak disentuh.
  - [ ] **b.** (L) Pindah ke IndexedDB atau simpan terkompresi, dengan migrasi dan
    aturan Web Locks serta token yang sama.

  Keduanya menyentuh aturan "pertahankan format v1 dan roundtrip metadata".
  *Keputusan:* cukup `localStorage` dengan meter (MW-96), atau investasi
  sekarang. Kerjakan MW-96 sebelum MW-19/MW-20 menambah baris secara massal, dan
  MW-109a sebelum impor tahun-tahun lama dalam jumlah besar. Bila codec
  direvisi: nilai terbanyak menjadi bawaan dengan pengecualian per baris di
  versi codec baru, pembaca versi lama tetap ada.

**Tindakan pemilik (bukan kode):**

- `main` belum dilindungi di GitHub (`protected: false`, tanpa ruleset), jadi
  aturan "merge hanya setelah CI hijau" tidak dipaksakan. Job verifikasi di
  `pages.yml` tetap menahan deploy commit yang merah, tetapi `main` yang merah
  menahan semua deploy berikutnya. Dari 40 run PR
  terakhir, 5 gagal dan 2 dibatalkan. Usul: ruleset yang mewajibkan pull request
  dan tiga pemeriksaan (`Tes dan build`, `Tes browser firefox`,
  `Tes browser webkit`). Lakukan sebelum MW-139.
- Periksa apakah ada repo lain di akun yang menerbitkan Pages di host yang sama
  (`zayyan353.github.io`), karena semua path di origin itu berbagi penyimpanan.

### F3. Kecepatan

- [x] **MW-110 — Tes performa mengukur catatan yang berisi baris impor** (S)
  Menyimpan satu transaksi manual pada catatan berisi baris impor (dokumen
  versi 2):

  | Baris impor | Tanpa perlambatan | CPU 4× |
  |---|---|---|
  | 1.000 | 0,32–0,52 dtk | 1,1–1,3 dtk |
  | 2.500 | 0,65–0,67 dtk | 2,2–2,6 dtk |
  | 5.000 | 1,23–1,61 dtk | 6,4–7,3 dtk |
  | 10.000 | 2,6–3,0 dtk | 10,9–11,8 dtk |

  Baris 1.000–5.000 diukur dari klik **Simpan transaksi** sampai dialog
  tertutup; baris 10.000 diukur pemeriksa lain sampai `localStorage` berubah,
  pada catatan satu dompet, jadi keduanya bukan satu seri. Catatan versi 1
  berisi 5.000 baris: 0,49 dtk / 1,15 dtk. Gate performa CI
  hanya memakai fixture versi 1 (`make_fixture` di `tests/performance_browser.py`), jadi
  perlambatan ini tidak terlihat oleh CI. Tambah sampel versi 2 (impor CSV
  sintetis 2.000 baris, lalu ukur satu simpan) dan laporkan milidetiknya.
  *Selesai 19 Nov 2026:* sesudah lima sampel versi 1 yang beranggaran,
  `tests/performance_browser.py` menjalankan satu sampel versi 2: catatan kosong
  → impor CSV sintetis 2.000 baris lewat **CSV / Excel umum** → **Transaksi**
  → **Catat transaksi** → satu simpan. `summary.json` (kunci `version2`) dan
  baris terakhir keluaran, yang terbaca di log CI, memuat `save_ms` (klik
  **Simpan transaksi** sampai dialog hilang, seperti baris 1.000–5.000 di
  tabel) dan `stored_ms` (sampai `localStorage` berisi dokumen baru); keduanya
  memakai jam halaman. Tanpa anggaran waktu: pemeriksaan baru
  `version2_samples_passed` hanya menuntut sampelnya selesai dan datanya benar.
  Gate versi 1, anggarannya, perintah CI, dan kode aplikasi tidak diubah. Opsi
  baru: `--import-rows` (bawaan 2000, paling banyak 15.000 karena kuota
  `localStorage` Chromium tercapai di antara 16.500 dan 17.000 baris CSV ini),
  `--import-samples` (bawaan 1; 0 melewati).
  *Dijalankan* (hanya Chromium, kontainer 4 CPU yang dipakai bersama pekerjaan
  lain; bukan angka CI): `npm test` 66 file / 1.810 tes lulus; `npm run build`
  lulus; `performance_browser.py` dengan flag CI dua kali, 6/6 pemeriksaan
  lulus (versi 1: median 5.174 dan 5.649 ms, jeda frame 236 dan 310 ms). Sampel
  versi 2: `save_ms` 422,5 dan 470,2; `stored_ms` 287,3 dan 302,8; menambah
  ±4,3 detik. Sembilan sampel lokal pada 2.000 baris: 416,5–473,7 ms; dengan
  `--import-rows` 1.000 / 2.500 / 5.000 (tiga sampel masing-masing): 272–352 /
  468–512 / 854–886 ms.
  *Uji kepekaan* (kode aplikasi tidak berubah, jadi tidak ada "gagal di kode
  lama"): dengan jeda buatan 300 ms di `prepareBackup` hanya untuk dokumen
  bermetadata, gate versi 1 tetap lulus sedangkan `save_ms` naik ke
  1.033–1.035 ms dan `stored_ms` ke 596–616 ms; jeda itu sudah dibuang. Jeda
  terhitung dua kali sebelum dialog tertutup karena `saveEntry` (`src/App.tsx`)
  mengemas ulang seluruh catatan lewat `serializeBackup` sesudah penyimpanan:
  bahan MW-111, belum diubah.
  *Keputusan:* satu sampel saja supaya waktu CI kecil; sampel yang tidak bisa
  dijalankan menggagalkan tes supaya angkanya tidak hilang diam-diam.
  *Belum terbukti:* angka di runner CI (baru ada setelah run CI pertama);
  Firefox dan WebKit (tes ini hanya ada di job Chromium); CPU 4× dan HP
  sungguhan. Satu sampel tidak cukup untuk membandingkan dua run: sembilan
  sampel di atas berada dalam ±7% dari mediannya, tetapi saat pekerjaan browser
  lain berjalan di kontainer yang sama peninjau mengukur 457–580 ms pada 2.000
  baris dan 902–1.169 ms pada 5.000 baris (sampai ±30% lebih tinggi). Angka
  tunggal di log CI hanya indikatif; untuk MW-111 bandingkan median atau
  minimum beberapa sampel (`--import-samples N`) di host yang sama. Angka
  sampel ini juga tidak sebanding dengan tabel di atas (host, isi CSV, dan sesi
  ukur berbeda): pada 2.500 dan 5.000 baris hasilnya ±20–47% lebih rendah dan
  sebabnya belum diketahui, jadi baseline dan target MW-111 harus diukur dengan
  sampel ini.

- [ ] **MW-111 — Percepat jalur simpan** (M–L) — **butuh keputusan**
  Setiap simpan memvalidasi dan mengemas ulang seluruh catatan
  (`src/lib/persistence.ts:70-76`). Pada 10.000 baris, biaya pustakanya saja
  (diukur di Node, di luar browser) 569–592 ms per simpan dan 1.140–1.149 ms
  saat memuat. Butuh MW-110 lebih dulu
  supaya hasilnya terukur.
  - [ ] **a.** (S–M) Penghematan codec tanpa mengubah format
    (`src/lib/sourceCodec.ts:42,60`). Hasilnya bisa lebih kecil dari perkiraan
    awal: `every` di baris 60 berhenti di baris pertama yang berbeda, dan
    `src/lib/jsonBudget.ts:11` sudah menyimpan hasil per string serta melewati
    `TextEncoder` untuk ASCII. Profil CPU tidak diulang pemeriksa; ukur dengan
    MW-110.
  - [ ] **b.** (M) Lewati validasi dan pengemasan ulang bagian yang identik dengan
    snapshot yang sudah tervalidasi. Hitungan ukuran dan penolakan overflow
    wajib tetap; tes kapasitas harus hijau.
  - [ ] **c.** (S–M) Jalan pintas yang sama saat memuat.

  *Keputusan:* target, mis. 5.000 baris impor tersimpan di bawah 1 detik di
  HP-mu; angka itu menjadi anggaran CI. Kerjakan sebelum MW-19/MW-20.

- [ ] **MW-112 — Kotak cari tidak me-render ulang seluruh aplikasi per ketikan** (M) *(sebagian)*
  Satu ketikan di "Cari transaksi" memakan median 32 ms (maks 72) tanpa
  perlambatan dan median 160 ms (maks 448) pada CPU 4×. Median pada CPU 4× sama
  pada 1.000 dan 5.000 baris (maksimum 208 ms lawan 448 ms): biayanya render
  ulang penuh `App` dua kali per ketikan
  (`src/App.tsx:107`, `:161`), bukan jumlah baris. Besar perbaikannya belum
  diukur.
  - [ ] **a.** Pembaruan di `src/App.tsx:161` tidak membuat array baru bila sudah
    kosong. Memindahkan state pencarian keluar dari `App` bukan bagian butir
    ini; itu dikerjakan sebagai MW-144a–b. Kerjakan butir c lebih dulu supaya
    hasil a dan b terukur.
  - [ ] **b.** Simpan judul huruf kecil di dalam indeks, bukan dihitung per baris per
    ketikan (`src/lib/historyView.ts:91-92`).
  - [ ] **c.** Sampel ketikan (median dan maksimum) di `tests/performance_browser.py`.

### F4. Pemakaian di HP dan alur

- [x] **MW-113 — Halaman ada di URL; Back dan muat ulang berperilaku wajar**
  Navigasi dan dialog tidak membuat entri riwayat dan URL tidak pernah berubah
  (`src/App.tsx:101`; tidak ada `pushState`, `popstate`, `hashchange`, atau
  `location.hash` di `src`). Muat ulang
  selalu kembali ke Ringkasan, Back dari halaman mana pun keluar dari aplikasi,
  dan form yang sedang diisi hilang tanpa peringatan. Back diuji lewat History
  API, bukan gestur di HP sungguhan.
  - [x] **a.** (S–M) Rute hash per halaman (`#/dompet`, `#/transaksi`, `#/impor`),
    dibaca saat mulai dan mengikuti `popstate`.
    *Selesai 19 Nov 2026:* halaman kini ada di alamat: Ringkasan tanpa hash,
    lalu `#/dompet`, `#/transaksi`, `#/impor` (`src/lib/pageRoute.ts`). Alamat
    dibaca saat mulai, jadi muat ulang tetap di halaman yang sama. Berpindah
    halaman menambah satu entri riwayat; Back dan Forward berpindah antarhalaman
    dan tidak lagi langsung keluar dari aplikasi. Hash yang diketik di tab yang
    sama juga diikuti. Hash kosong atau tidak dikenal membuka Ringkasan.
    Alamat baru dibangun dari alamat utuh (`addressForPage`), bukan dari path.
    Bila browser menolak tulisan ke riwayat, halamannya tetap berganti dan
    hanya alamatnya yang tertinggal; tidak ada galat.
    *Keputusan agen (mudah dibatalkan):* saat ada penyimpanan yang sedang
    berjalan, Back tidak memindahkan halaman dan alamatnya dikembalikan, sama
    seperti tombol navigasi yang sudah menolak pindah pada keadaan itu. Posisi
    gulir diatur aplikasi sendiri (`history.scrollRestoration = 'manual'`).
    Periode, dompet, dan pencarian tidak ikut masuk alamat.
    *Dari tinjauan (dua lensa, satu peninjau per lensa, tanpa pemeriksaan
    ulang oleh pihak kedua; tiap temuan dibuktikan di browser):* lensa
    benar/aman: path yang diawali `//` dibaca sebagai host lain, `pushState`
    melempar `SecurityError`, dan halaman menjadi kosong; penjaga Back saat
    simpan berjalan tidak punya tes. Lensa tes/tampilan: tidak ada tes yang
    menjaga bahwa Back dan Forward mengembalikan bulan dan posisi gulir
    Transaksi seperti tombol navigasi, dan penolakan tulisan riwayat tidak
    diuji. Keempatnya diperbaiki. Lima mutan masing-masing menggagalkan
    `routes-desktop` dan `routes-mobile`: alamat dari path dan tanpa penjaga
    (sesi sebelumnya), lalu Back/Forward tanpa `showPage`, tanpa
    `scrollRestoration = 'manual'`, dan tanpa `try/catch` (sesi ini).
    *Tes:* `npm test` 72 file / 1.866 tes (4 di `pageRoute.test.ts`),
    `npm run build` lulus. Chromium: `ux_browser.py` 7/7 dengan kasus baru
    `routes-desktop` dan `routes-mobile`: muat ulang, Back, Forward, hash yang
    diketik, alamat langsung, alamat tak dikenal sebagai muat pertama, path
    `//`, tulisan riwayat yang ditolak, bulan dan posisi gulir Transaksi
    sesudah Back dan Forward, serta Back dan alamat yang diketik saat simpan
    berjalan (tab kedua memegang kunci catatan). Karena perilaku muat ulang
    berubah, ke-18 suite browser yang dipakai CI dijalankan dan lulus
    (`performance_browser.py`: median 4.769 ms, celah frame 182,7 ms; batas
    7.000 dan 350). Itu sebelum dua tes terakhir ditambahkan; kode aplikasi
    tidak berubah sesudahnya dan hanya `ux_browser.py` yang diulang.
    `performance_browser.py` semula mengharapkan Ringkasan sesudah muat ulang
    dari Transaksi dan disesuaikan di dua tempat.
    *WebKit (run CI pertama PR #69 merah):* `routes-desktop` dan
    `routes-mobile` gagal saat membuka tab kedua, karena pembantu tes memasang
    jam tetap sekali lagi pada konteks yang sama; WebKit menolaknya bila
    catatan diisi lewat skrip awal. Salahnya di tes: tab tambahan kini dibuka
    tanpa memasang jam lagi (jam milik konteks dan berlaku untuk semua tab),
    seperti di `recovery_browser.py`.
    *WebKit (run CI kedua PR #69, `44635843848` pada `fee9293`):* bulan
    dan alamat Transaksi sudah benar sesudah Back, tetapi dua kasus rute
    kehabisan waktu saat menunggu posisi 600 piksel. Mode gulir berlaku per
    entri. Mengetik hash dapat membuat entri WebKit dengan mode otomatis,
    lalu entri berikutnya mewarisi mode itu. Aplikasi kini memilih `manual`
    juga saat menerima `popstate` atau `hashchange`, sebelum mengikuti alamat.
    *Dari pengujian 23 Nov 2026:* pada Chromium, memberi entri hash Impor
    mode `auto` mereproduksi kegagalan 600 piksel di desktop pada kode lama.
    Dengan perbaikan, kasus yang sama lulus. Tes tambahan kembali ke entri
    Dompet yang sebelumnya diberi mode otomatis. Tanpa perbaikan, tes itu
    gagal di desktop dan HP karena modenya tetap `auto`. Pemeriksaan Back
    dan Forward tetap menuntut 600 ±2 piksel. Bila gagal, laporan kini berisi
    posisi aktual, mode, tinggi dokumen dan tinggi viewport.
    *Tes lokal pada perbaikan:* `npm test` 72 file / 1.866 tes, build produksi
    dan 18/18 suite Chromium 154 lulus, termasuk `ux_browser.py` 7/7.
    Performa: median 4.864,4 ms, celah frame terbesar 207,8 ms.
    *Belum terbukti:* posisi aktual dan mode pada kegagalan WebKit di CI
    lama tidak terekam. Unduhan WebKit dan Firefox lokal ditolak HTTP 403.
    Back diuji lewat History API, bukan gestur di HP sungguhan. Dialog yang terbuka tidak
    ditutup oleh Back dan tetap tampil di atas halaman yang berganti; itu butir
    b. Aplikasi Layar Utama (tanpa tombol Back browser) tidak diuji.
    *Diketahui dari tinjauan, tidak dikerjakan di sini (belum ada MW-nya):*
    alamat yang ditolak saat simpan berjalan tertinggal sebagai entri
    riwayat; hash tak dikenal tetap tampil di address bar; keempat halaman
    berjudul dokumen sama, jadi entri riwayatnya tidak terbedakan di daftar
    Back; sesudah Back atau Forward fokus papan ketik jatuh ke `body` atau
    tertinggal di tombol halaman sebelumnya (aplikasi belum memindahkan fokus
    pada pergantian halaman mana pun).
  - [x] **b.** (M) Membuka dialog menambah satu entri riwayat; Back menutupnya lewat
    penjaga buang-isian yang sudah ada (`src/hooks/useDiscardGuard.tsx`).
    *Selesai 19 Nov 2026:* dialog pertama yang dibuka di sebuah halaman
    menambah satu entri riwayat beralamat sama; dialog berikutnya di halaman
    itu memakai entri yang sama (`src/lib/dialogHistory.ts`, dipasang di
    `Modal`, jadi berlaku untuk semua dialog). Back saat dialog terbuka
    meminta dialog paling atas menutup seperti Esc: form yang belum diisi
    langsung tertutup, form berisi menampilkan pertanyaan buang-isian dan
    isinya utuh. Dialog yang tetap terbuka kembali ke entrinya lewat
    Forward. Bila browser melaporkan Forward dibatalkan, dialog mendapat
    entri pengganti. Back saat tidak ada dialog terbuka
    tetap meninggalkan halaman dengan satu tekanan. Pindah halaman mengubah
    entri dialog menjadi entri halaman baru. Muat ulang saat dialog terbuka:
    halaman tetap dan dialog hilang.
    *Keputusan agen (mudah dibatalkan):* (1) membuka atau menutup dialog lewat
    tombolnya sendiri tidak pernah bergerak di riwayat. Rancangan pertama
    melepas entri dengan `history.back()` begitu dialog ditutup; langkah itu
    selesai belakangan, sehingga muat ulang yang datang tepat sesudahnya
    dibatalkan (`wallet_browser.py` gagal dengan `ERR_ABORTED`). Sekarang entri
    dialog dibiarkan dan baru dilewati saat Back ditekan. (2) Saat pertanyaan
    buang-isian tampil, Back berarti "lanjut mengisi", sama seperti Esc.
    (3) Bila browser menolak tulisan ke riwayat (Safari membatasi 100 per 30
    detik), dialog itu tidak punya entri dan Back berperilaku seperti sebelum
    MW ini; tidak ada galat.
    (4) Bila dua Back sudah mendarat di dalam aplikasi sebelum dialog sempat
    kembali ke entrinya, halaman mengikuti tujuan kedua. Pertanyaan hanya
    diajukan sekali dan isian tetap utuh. Entri dialog di halaman tujuan
    dapat menggantikan riwayat Forward ke halaman asal.
    *Dari tinjauan 23 Nov 2026 (dua lensa, diuji dengan mutan dan Chromium):*
    klik halaman saat Back tambahan masih berjalan bisa hilang. Mesin kini
    membedakan Back yang buntu di awal tab dari Back yang belum mendarat.
    Saat dua Back berlomba dengan Forward, alamat bisa tertinggal sesudah
    form dibuang atau selesai disimpan. Mesin kini melepas pengembalian yang
    tertunda ketika semua dialog ditutup. Bila tersedia, `navigation.forward()`
    memberi tahu bila gerakan dibatalkan selagi form masih terbuka. Pada
    Chromium, Back berikutnya kembali ke isian meski ada dokumen lain sebelum
    aplikasi. Dalam percobaan simpan yang ditahan kunci, hanya satu catatan
    tersimpan setelah kunci dilepas. Back juga menutup dialog saat toast
    sukses tampil, dan toast tetap terlihat.
    *Tes:* `npm test` 73 file / 1.886 tes lulus, termasuk 20 tes
    `dialogHistory.test.ts`. Build produksi lulus. Pada kode sebelum MW,
    kedua kasus dialog gagal karena entri tambahan tidak ada. Pada kode
    parkir, dua Back lalu pindah ke Dompet menyisakan hash Transaksi di
    desktop dan HP. Delapan mutan unit gagal pada penjagaan alamat, urutan
    Back, awal tab dan pengembalian yang dibatalkan. Empat mutan browser
    masing-masing menggagalkan kedua ukuran layar. Tes membedakan
    `pushState` baru dari Forward, menguji fokus pembuka dan form dompet,
    pilihan saat pertanyaan tampil, dan pindah halaman sesudah Back buntu.
    Chromium 154 lulus 18/18 suite CI, termasuk UX 9/9. Performa lima
    sampel: median 4.873,5 ms dan celah frame terbesar 264,1 ms.
    *Belum terbukti:* Firefox dan WebKit (lokal hanya Chromium). Back diuji
    lewat History API (`history.back()`), bukan tombol atau gestur browser.
    Chrome melewati entri yang dibuat tanpa interaksi pengguna saat tombol
    Back ditekan; entri dialog dibuat sesudah klik dan dialog yang tetap
    terbuka tidak membuat entri baru, tetapi tombol Back sungguhan di Chrome,
    Android, dan iOS tidak diuji. Bila tab langsung dibuka di aplikasi (tidak
    ada halaman sebelumnya) dan sebuah dialog pernah dibuka lalu ditutup,
    Back kembali ke entri pertama. Tombol navigasi tetap dapat mengganti
    halaman beserta alamatnya. Forward ke
    entri dialog tidak membuka dialog lagi. Pada mesin tanpa Navigation API,
    Forward yang dibatalkan diam-diam masih bisa membiarkan form terbuka
    tanpa entri pelindung. Aplikasi Layar Utama tidak diuji.
  - [x] **c.** (S) Peringatan `beforeunload` saat form terbuka berisi isian. Penjaga
    untuk perubahan belum tersimpan sudah ada
    (`src/hooks/useLedgerStorage.ts:45-54`).
    *Selesai 24 Nov 2026:* saat tab ditutup atau dimuat ulang, aplikasi
    meminta browser memperingatkan pengguna bila form masih berisi perubahan.
    Form transaksi dan penjaga bersama untuk dompet, mata uang dan kategori
    memakai `src/hooks/useUnloadWarning.ts`. Peringatan mengikuti isian
    terbaru dan pendengarnya dilepas saat form ditutup. Tombol untuk tetap
    di halaman pada pertanyaan browser mempertahankan isian.
    Browser memilih teks peringatannya. Aplikasi tidak menulis draf ke
    penyimpanan saat tab hendak ditutup.
    *Keputusan agen (mudah dibatalkan):* nama template baru dibandingkan dengan usulan saat panel dibuka. Nama
    template yang diedit dibandingkan dengan nama tersimpan. Pada dompet
    baru, form dianggap mulai diisi setelah ada nama atau saldo selain nilai
    awal, mengikuti penjaga form yang sudah ada.
    *Dari tinjauan 24 Nov 2026:* pada kode parkir, mengetik nama kategori,
    nama pengganti atau kata kunci sebelum menekan Tambah/Terapkan tidak
    memicu peringatan. Begitu pula dengan nama template pada transaksi
    yang belum diubah. Kini teks tersebut ikut dijaga. Pencarian aturan
    dan mata uang serta usulan nama template yang belum diubah tetap hening.
    *Tes:* `npm test` 73 file / 1.886 tes, build produksi dan 18/18 suite
    Chromium 154 lulus. Smoke 39 skenario, recovery 16/16, UX 11/11, dompet
    21/21, kategori 28/28, impor mata uang 29/29. Median performa 4.838,7 ms,
    celah frame terbesar 195,3 ms. Pada kode sebelum MW, kedua kasus unload
    gagal saat form berisi. Dua mutan yang mencabut masing-masing pemasangan
    hook juga menggagalkan kedua kasus. Dua mutan nama template masing-masing
    menggagalkan kedua ukuran layar. Tiga mutan kategori gagal pada kolomnya
    sendiri. Di Chromium, membatalkan penutupan tab menjaga isian transaksi.
    *Belum terbukti:* prompt asli hanya diuji di Chromium. Firefox dan WebKit
    di CI memeriksa peristiwa yang dibatalkan. HP fisik, penutupan paksa oleh
    sistem operasi dan aplikasi Layar Utama tidak diuji.

  Tes ikut di PR masing-masing butir, di `tests/ux_browser.py`: butir a menambah
  kasus muat ulang dan Back antarhalaman, butir b kasus Back dengan dialog
  berisi, dan butir c kasus peringatan saat form berisi.

- [ ] **MW-114 — Aplikasi bisa dibuka tanpa internet** (M) — **butuh keputusan**
  Tidak ada service worker dan tidak ada cache: muat ulang, atau membuka lagi
  aplikasi yang sudah ditutup, tanpa jaringan gagal
  (`ERR_INTERNET_DISCONNECTED`), walau manifestnya membuat aplikasi bisa
  dipasang dan datanya ada di perangkat. Prototipe 25 baris
  (network-first) di browser uji: muat ulang offline berhasil, catatan utuh,
  transaksi yang disimpan saat offline bertahan. Prototipe ini tidak diulang
  oleh pemeriksa kedua. Kegagalan offline diuji terhadap `npm run preview`
  saja; belum terbukti berapa lama cache HTTP browser di GitHub Pages atau
  aplikasi terpasang di iOS/Android menjembatani jeda singkat.
  - [ ] **a.** `public/sw.js`: halaman network-first dengan cadangan salinan
    terakhir; manifest dan ikon dari cache. Daftarkan hanya di alamat publik;
    untuk tes butir b sediakan cara eksplisit mendaftarkannya di
    `npm run preview`, sementara tes lain tetap memblokir service worker. Saat
    halaman dilayani dari cache, tampilkan "Offline · versi `<commit>`" di
    footer.
  - [ ] **b.** Tes browser baru (muat, offline, muat ulang, simpan, buka lagi
    setelah ditutup).
    Tes yang ada memblokir service worker (`tests/full_backup_browser.py:33`).
  - [ ] **c.** Satu kalimat di Privasi dan README.

  Butir a–c dikerjakan dalam satu PR (pengecualian dari aturan sub-huruf):
  service worker tidak boleh terbit ke situs sebelum tes butir b lulus di CI.

  *Keputusan:* terima satu file statis tambahan di samping `index.html`, dan
  bahwa sesi offline menjalankan build terakhir yang pernah dimuat perangkat itu.
  Jalur pembaruan harus benar supaya tes browser tidak pernah menerima halaman
  lama (aturan hash build di `AGENTS.md`).

- [x] **MW-115 — Transaksi yang tersimpan di luar periode yang tampil tidak "hilang"** (S)
  Menyimpan transaksi bertanggal di luar bulan yang tampil hanya memunculkan
  "Transaksi tersimpan." dan barisnya tidak terlihat sampai periode diganti.
  Mengubah tanggal baris ke luar bulan menghapusnya dari tampilan dan fokus
  jatuh ke `body`.
  *Perbaikan:* toast menyebut bulannya ("Tersimpan di Oktober 2026") dan
  menawarkan **Lihat**; sesudah ubah tanggal yang mengeluarkan baris dari
  tampilan, fokus dipindahkan ke baris status daftar.
  *File:* `src/App.tsx:558` dan toast di `src/App.tsx:156-159,744` (sekarang
  hanya teks dan tombol tutup, belum punya tombol aksi; MW-126b butuh hal yang
  sama), tes browser.
  *Selesai 24 Nov 2026:* setelah transaksi berhasil disimpan di luar bulan
  yang sedang tampil, toast menyebut bulan tujuannya. Tombol **Lihat**
  membuka halaman Transaksi di bulan itu. Bila tanggal yang diedit membuat
  baris keluar dari daftar, fokus beralih ke status daftar. Bulan dihitung
  dari tanggal posting tersimpan (`src/lib/savedPeriod.ts` dan `src/App.tsx`).
  *Keputusan agen (mudah dibatalkan):* toast bertombol bertahan 10 detik.
  **Lihat** membersihkan filter agar transaksi dapat ditemukan. **Simpan &
  catat lagi** menyebut bulan di toast dan mempertahankan form untuk isian
  berikutnya. Pada daftar semua periode tidak ada bulan yang perlu dituju.
  *Dari tinjauan (benar/aman dan tes/tampilan):* pada kode parkir, transfer
  IDR yang didebit 31 Oktober dan dikredit 1 November tidak menawarkan
  **Lihat** di daftar Oktober dompet penerima. Bulan kini mengikuti tanggal
  posting pada dompet yang dipilih. Bila kedua dompet terlihat, kedua sisi
  diperiksa. Tanggal yang tidak diketahui tidak ditebak. Mutan yang tidak
  menghapus filter masih lulus tes parkir. Tes kini memasang filter
  Pemasukan sebelum menyimpan pengeluaran dan memastikan **Lihat**
  menampilkan pengeluaran itu. Pada simpan yang ditolak karena kuota,
  form tetap terbuka dan tombol **Lihat** tidak muncul.
  *Tes:* `npm test` 74 file / 1.891 tes, termasuk 5 tes bulan tujuan. Build
  produksi dan 18/18 suite Chromium 154 lulus: UX 13/13, smoke 39 skenario,
  kerangka 4/4, recovery 16/16, cashflow 19/19. Median performa 4.894,5 ms,
  celah frame terbesar 219 ms. Sebelum MW, kedua kasus baru gagal karena
  toast hanya menyebut bahwa transaksi tersimpan. Empat mutan browser
  menggagalkan kedua kasus: salah bulan, tanpa fokus, tanpa aksi atau tanpa
  reset filter. Satu mutan unit gagal saat filter dompet diabaikan. **Lihat**
  dapat diklik pada 1440 terang, 390 gelap, serta 320 terang dan gelap.
  *Belum terbukti:* HP fisik dan pembaca layar. **Lihat** membuka halaman
  pertama bulan tujuan. Pada bulan dengan 68 baris, transaksi tertua baru
  terlihat pada halaman kedua. Ditindaklanjuti di MW-147: **Lihat** kini
  membuka halaman yang memuat barisnya.

- [x] **MW-147 — **Lihat** membuka halaman yang memuat transaksinya** (S) (ditambahkan 24 November 2026, tindak lanjut MW-115)
  Tombol **Lihat** di toast "Tersimpan di <bulan>" membuka halaman pertama
  bulan tujuan, padahal daftar memuat 50 baris per halaman. Pada bulan dengan
  68 baris, transaksi tertua yang baru disimpan ada di halaman kedua: pengguna
  menekan **Lihat** dan tetap tidak melihat barisnya. Direproduksi pada build
  produksi sebelum MW: sesudah **Lihat**, paginasi menampilkan "1–50 dari 68 ·
  Halaman 1 dari 2" dan barisnya tidak ada di halaman itu.
  *Perbaikan:* sesudah **Lihat**, daftar membuka halaman yang memuat baris
  itu, dan barisnya dibawa ke layar.
  *File:* `src/lib/historyView.ts`, `src/App.tsx`,
  `src/components/TransactionTable.tsx`, tes unit dan `tests/ux_browser.py`.
  *Selesai 24 Nov 2026:* **Lihat** kini membawa id transaksi yang baru
  disimpan. Sesudah filter dibersihkan dan bulan tujuan terbuka, daftar
  membuka halaman yang memuat baris itu pada urutan yang sedang berlaku
  (`pageOfEntry` di `src/lib/historyView.ts`). Barisnya lalu digulir ke
  layar. Efek ini diletakkan di bawah efek yang mengembalikan daftar ke
  halaman 1 saat bulan atau filter berubah, supaya halaman tujuan tidak
  tertimpa. Transfer dengan dua tanggal posting dicari lewat id yang sama di
  bulan yang dibuka. Id yang tidak ada di daftar tujuan tidak ditebak: daftar
  tetap di halaman 1 dan tidak digulir. **Simpan & catat lagi** tetap tanpa
  **Lihat**. Format dan isi data tersimpan tidak berubah.
  *Keputusan agen (mudah dibatalkan):* baris digulir ke tengah layar, bukan
  ke tepi terdekat, supaya tidak tertutup navigasi bawah di HP. Fokus tidak
  dipindahkan dan baris tidak diberi sorotan. Baris tabel mendapat atribut
  `data-entry-id` supaya bisa ditemukan.
  *Tes:* `npm test` 76 file / 1.916 tes, termasuk 6 tes halaman baris. Build
  produksi dan 18/18 suite Chromium lulus: UX 18/18, smoke 39 skenario,
  kerangka 4/4, recovery 17/17, cashflow 21/21. Median performa 5.931,2 ms,
  celah frame terbesar 264,9 ms. Sesudah itu dua baris tes ditukar, lalu
  `npm test`, build, UX 18/18, kerangka 4/4 dan smoke 39 skenario diulang dan
  lulus. Pada kode sebelum MW, kedua kasus baru gagal dengan "1–50 dari 68 ·
  Halaman 1 dari 2", dan 6 tes unit gagal karena fungsinya belum ada. Kasus
  browser baru (1440 dan 390) memeriksa baris tertua di halaman 2, baris
  terbaru di halaman 1 sesudah urutan "Terlama dulu", **Lihat** dari
  Ringkasan, transfer yang didebit 30 September dan dikredit 1 Oktober, baris
  yang dihapus tab lain sebelum **Lihat**, serta **Simpan & catat lagi**.
  Tiap baris harus berada di layar dan tidak tertutup navigasi. Delapan
  mutan gagal: tanpa gulir, gulir ke tepi terdekat, urutan efek dibalik,
  selalu halaman terakhir, id yang hilang ditebak ke halaman 2, urutan tidak
  dikembalikan ke terbaru, permintaan **Lihat** tidak dibersihkan, dan batas
  halaman bergeser satu baris. Mutan terakhir hanya tertangkap tes unit.
  Di luar suite, di Chromium: baris TRY di halaman 2 terlihat pada 1440
  terang dan 320 gelap, dan simpan yang ditolak kuota tidak memunculkan
  **Lihat**.
  *Belum terbukti:* Firefox dan WebKit baru diuji di CI. HP fisik dan
  pembaca layar belum diuji. Sesudah **Lihat**, fokus keyboard tidak berada
  di baris itu. Baris tidak disorot, jadi pengguna mengenalinya dari
  keterangannya. Pengaruh pada performa tidak terukur bersih: mesin sedang
  dipakai agen lain. Dalam 9 putaran sebelum/sesudah, median sebelum
  6.394–8.633 ms dan sesudah 6.619–9.116 ms. Sesudah lebih lambat di 6
  putaran dan lebih cepat di 3, rata-rata selisih +190 ms. Beberapa putaran
  melewati batas lokal pada kedua kode.

- [ ] **MW-116 — "Cek saldo" yang cocok berakhir sebagai keberhasilan** (S)
  Bila saldo sama dengan catatan, petunjuk sudah berkata "Sama dengan catatan,
  jadi tidak ada selisih untuk dicatat.", tetapi **Simpan transaksi** memunculkan
  galat merah "Saldo sudah cocok; tidak perlu penyesuaian."
  (`src/lib/finance.ts:223-225`) dan Esc membuka "Buang isian transaksi?".
  - [x] **a.** Saat selisih 0, tombol utama menjadi "Saldo cocok · tutup", menutup
    tanpa pertanyaan buang-isian, dengan toast sukses.
    *Selesai 24 Nov 2026:* pada cek saldo baru, bila nominal yang diisi
    sama dengan saldo dompet hari ini, tombol utama berubah menjadi **Saldo
    cocok · tutup** (`TransactionModal.tsx`). Tombol itu dan Enter menutup
    form. Toast menyebut nama dompet dan menjelaskan tidak ada yang perlu
    dicatat. Esc dan Batal menutup tanpa toast bila hanya angka cocok yang
    diisi. Bila ada keterangan, Esc dan Batal meminta keputusan.
    *Keputusan agen (mudah dibatalkan):* cek saldo lama yang diedit sampai
    selisih nol tetap menampilkan galat lama karena catatan itu mungkin perlu
    dihapus secara sengaja. **Simpan & catat lagi** tetap tersedia seperti
    sebelumnya pada pemasukan dan pengeluaran. Butir b menunggu pemilik.
    *Dari tinjauan (benar/aman dan tes/tampilan):* pada kode parkir,
    cek baru bisa memberi toast cocok memakai saldo dari draf gagal simpan,
    dari dompet yang sudah hilang, atau dari catatan lama ketika dokumen
    terbaru tak terbaca. Cek yang melewati tengah malam juga memakai
    perbandingan kemarin. Keempatnya direproduksi di Chromium. Aplikasi
    kini memeriksa sumber saldo dan tanggal sebelum menutup form. Dalam
    profil sehat, saldo nol dan saldo TRY −12,34 sama-sama dapat dikonfirmasi.
    Dua mutan semula masih lulus: menulis ulang byte yang sama dan meminta
    peringatan tab untuk angka cocok saja. Tes kini menghitung operasi tulis
    dan memeriksa peristiwa `beforeunload` pada tiga keadaan isian.
    *Tes:* `npm test` 74 file / 1.891 tes dan build produksi lulus. Chromium
    lulus 18/18 suite termasuk recovery 17/17 dan UX 13/13. Median performa
    5.061,4 ms, celah frame terbesar 209,2 ms. Kasus cek saldo gagal pada
    kode sebelum MW. Tujuh mutan gagal pada kandidat dengan tes diperkuat:
    cek lama diperlakukan seperti cek baru, pengecualian buang-isian
    dicabut, keterangan diabaikan, byte yang sama ditulis lagi, dan tiga
    pemicu peringatan tab diubah. Tombol dapat diklik di 320, 390 dan 1440.
    *Belum terbukti:* HP fisik dan pembaca layar belum diuji. Tanggal
    terakhir diperiksa tidak disimpan.
  - [ ] **b.** — **butuh keputusan** Tanggal "terakhir dicek" per dompet. Bila
    disetujui, simpan di kunci terpisah, bukan di format catatan.

- [ ] **MW-117 — Kurs: contoh mengikuti arah pasangan mata uang**
  Untuk IDR → TRY kolomnya bertanya "1 IDR = berapa TRY?" dengan contoh statis
  "400,5" dan "16000" (`src/components/TransactionModal.tsx:371`), yang hanya
  cocok untuk arah sebaliknya. Mengetik 400 menghasilkan "₺400.000.000
  diterima" tanpa peringatan. Tidak sepenuhnya diam-diam: pratinjau ada tepat di
  bawah kolom dan simpan terkunci sampai "Kurs ini sesuai transaksi saya"
  dicentang.
  - [ ] **a.** (S) Contoh bergantung pasangan, atau tanpa angka statis.
  - [ ] **b.** (M) — **butuh keputusan** Tombol "balik arah" (kurs diketik sebagai
    "1 TRY = … IDR") dan peringatan bila kurs berbeda lebih dari 100× dari kurs
    terakhir pasangan itu. Arti kurs yang tersimpan tidak berubah.

- [ ] **MW-118 — Esc selalu menutup dialog** (S)
  Setelah klik pada teks yang bukan kontrol (judul dialog, paragraf petunjuk)
  fokus jatuh ke `body` dan Esc tidak lagi menutup dialog
  (`src/components/Modal.tsx:18-19`). Klik pada label kolom tidak terdampak, dan
  satu kali Tab memulihkannya. `KERANGKA_HALAMAN.md` 5.9.1 menyatakan Escape
  menutup jendela. Dengarkan Escape di `document` untuk dialog teratas dan
  kembalikan fokus ke dialog. Tambah kasus di tes browser.

- [ ] **MW-119 — Catatan transfer lama tidak melebarkan kolom tanggal** (S)
  Transfer tanpa tanggal per sisi yang tersimpan (data v1 tanpa metadata
  transfer; bukan data contoh) menempelkan kalimat catatan ke tanggal dalam satu
  sel tanpa bungkus (`src/components/TransactionTable.tsx:53`,
  `src/styles.css:417`). Di 1440px kolom tanggal memakan 574px; di 1100px dan
  900px tabel selebar 936px sehingga Nominal dan tombol ubah berada di luar area
  yang terlihat. Tidak diketahui apakah catatan pemilik masih memuat transfer
  seperti itu. Ubah tata letaknya saja (catatan di baris sendiri yang
  membungkus); kalimatnya ditetapkan 11 Nov dan penandanya harus tetap terlihat.

- [ ] **MW-120 — Konflik dua tab saat form terbuka**
  Form yang dibuka di tab B sebelum tab A menyimpan selalu gagal disimpan; kotak
  pemulihan yang ditunjuk toast berada di bawah latar dialog; setelah dialog
  ditutup, **Coba simpan lagi** aktif tetapi tidak mengubah apa pun dan tanpa
  pesan. Tidak ada data yang tertimpa dan unduhan pemulihan ditawarkan.
  - [ ] **a.** (S) Tampilkan pemberitahuan konflik dan aksinya di dalam dialog.
  - [ ] **b.** (S) Pada status konflik, ganti **Coba simpan lagi** dengan penjelasan.
  - [ ] **c.** (M) — **butuh keputusan** Untuk entri baru, terapkan ulang perintah
    tambah ke data terbaru lewat Web Lock dan validasi yang sama. Perilaku sekarang
    (berhenti dan simpan draft) mengikuti aturan token di `AGENTS.md`.

- [ ] **MW-121 — Pilihan jenis dan nama kolom terbaca oleh pembaca layar** (S)
  Lima tombol "Jenis transaksi" dan sakelar "Isi kurs / Isi jumlah diterima"
  tidak membawa status terpilih (`src/components/TransactionModal.tsx:370`,
  `:430`). Nama yang diumumkan juga berbeda dari label yang terlihat: di "Cek
  saldo" kolom saldo bernama "Nominal" dan "Dompet" bernama "Dompet asal"
  (`:365`, `:368`); di Transfer kolom "Tanggal" bernama "Tanggal debit"
  (`:380`). Tambahkan `role="group"` dan `aria-pressed`, dan buat nama
  mengikuti label per mode. MW-68 mengganti selektor CSS yang bergantung pada
  `aria-label` yang sama; kerjakan MW-68 tepat sebelum ini (satu MW per PR).
  Tes browser memakai nama sekarang: `get_by_label` dengan "Nominal" 42 kali
  dan "Dompet asal" 30 kali, masing-masing di 10 file `tests/*.py`, serta
  "Tanggal debit" 2 kali. Pertahankan nama untuk mode lain atau perbarui tesnya
  di PR yang sama.

- [ ] **MW-122 — Di antrean "Perlu dirapikan", filter jenis tidak keluar diam-diam** (S)
  Memilih jenis lain di dalam antrean menghapus judul antrean dan menampilkan
  riwayat biasa tanpa pemberitahuan. Ini perubahan desain, bukan regresi:
  `KERANGKA_HALAMAN.md` 3.6.1 mencatat dropdown Jenis sebagai salah satu jalan
  keluar dari antrean. Usul: jenis yang dipilih berlaku di dalam antrean; keluar
  lewat "Semua transaksi" dan "Reset filter". Tes yang keluar lewat dropdown
  perlu diperbarui.

- [ ] **MW-123 — Toast lama tidak menutupi dialog berikutnya** (S) *(sebagian)*
  Hanya terjadi bila dialognya tinggi: di 1440×900 pada dialog Pindah uang
  lintas mata uang toast menutupi bagian atas tombol X (bagian tengahnya tetap
  bisa diklik); di 390×844 toast menutupi judul dialog. Dialog Catat transaksi
  biasa tidak tertutup. Tutup toast sukses saat dialog dibuka; toast galat
  tetap.

- [ ] **MW-124 — Halaman Transaksi di HP: baris pertama lebih dekat ke atas** (M)
  Di 390×844 baris transaksi pertama berada di y=1112 (dengan pengingat
  cadangan tampil), dan periode diatur oleh dua kontrol ("Bulan laporan" dan
  "Periode transaksi"). Melipat filter di balik tombol sudah direncanakan dan
  dibatalkan di MW-44, jadi **tidak** diusulkan lagi.
  - [ ] **a.** "Kelola kategori" dan "Isi kategori otomatis" dalam satu baris ringkas
    atau menu.
  - [ ] **b.** Di antrean rapikan, lencana pendek menggantikan kalimat per baris.
  - [ ] **c.** — **butuh keputusan** Hapus salah satu dari dua kontrol periode. Tes
    browser memilih kontrol lewat label "Periode transaksi".

- [ ] **MW-125 — Kontrol form 16px di HP** (S)
  Di 390×844 ukuran huruf kolom form 12–14px (`src/styles.css:222`, `:225`,
  `:436`, `:612`); hanya Nominal yang lebih besar. Safari iOS memperbesar
  halaman saat kolom di bawah 16px mendapat fokus; efek itu **tidak**
  direproduksi di sini (Chromium tidak melakukannya). Di ≤760px jadikan input,
  select, dan textarea 16px, lalu periksa ulang grid filter dua kolom MW-44 di
  360px dan 390px. Konfirmasi di iPhone asli sebelum dan sesudah.

- [ ] **MW-126 — Hapus transaksi: pesan yang benar dan "Urungkan"**
  Menghapus transaksi manual bersifat permanen, dan toastnya menyebut data bank
  yang tidak ada (`src/App.tsx:570-578`). Penghapusan butuh tiga langkah sengaja
  (ubah, Hapus, konfirmasi).
  - [ ] **a.** (S) Toast "Transaksi dihapus." bila entri tidak punya data bank.
  - [ ] **b.** (M) Aksi **Urungkan** di toast untuk entri tanpa tautan bank: tulis
    kembali lewat controller hanya bila token tersimpan masih token
    setelah-hapus; selain itu katakan catatan sudah berubah.

- [ ] **MW-127 — Pencarian memberi tahu hasil di mata uang lain** (S)
  Pencarian meluas ke semua periode tetapi tetap di mata uang yang aktif, dan
  keadaan kosong tidak menyebut ada hasil di mata uang lain. Tampilkan jumlah
  hasil per mata uang lain sebagai tombol ("6 hasil di TL") yang berpindah tab
  dan mempertahankan kata cari.
  *File:* `src/lib/historyView.ts` + tes, `src/App.tsx:719-722` (pelebaran
  periode saat mencari) dan `:726` (keadaan kosong),
  `tests/kerangka_browser.py`.

### F5. Fitur

- [x] **MW-128 — Ringkasan menyebut total pemasukan, pengeluaran, dan selisih**
  Kartu "Uang masuk/keluar" adalah arus rekening (termasuk transfer keluar,
  tarik tunai, dan biaya) sesuai keputusan pemilik, jadi bukan angka "berapa
  pengeluaranku bulan ini". Total pengeluaran berkategori hanya tampil di judul
  panel saat panel dilipat, dan pemasukan tidak pernah dijumlahkan. Kedua kartu
  dan labelnya tetap.
  - [x] **a.** (S) Total pengeluaran tampil juga saat panel kategori terbuka.
    *Selesai 24 Nov 2026:* Ringkasan menampilkan “Total pengeluaran · N
    kategori” beserta jumlahnya di atas daftar kategori yang dibuka. Saat
    panel dilipat, jumlah yang sama tetap tersedia di judul. `src/App.tsx`
    menggunakan total pengeluaran terkonfirmasi dari laporan yang sudah ada.
    *Keputusan agen (mudah dibatalkan):* N menghitung kategori yang memiliki
    pengeluaran dalam cakupan laporan. Anggaran saja tidak menambah N. Bila
    sebagian kategori diringkas, total tetap mencakup seluruh kategori.
    *Dari tinjauan:* profil sintetis yang valid dengan dua arus besar dan
    anggaran Pendidikan membuat laporan gagal karena batas nominal aman.
    Pada kode parkir, panel terbuka menampilkan ₺0, padahal ada pengeluaran
    Pendidikan ₺1. Kini tertulis “Total pengeluaran belum dapat dihitung.”
    tanpa menampilkan angka pengganti. Delapan pemeriksaan tampilan mencakup
    1440 terang, 390 gelap, serta 320 terang/gelap dengan dan tanpa anggaran.
    Dua pengeluaran ₺21 dan ₺12,90 berjumlah ₺33,90 saat dibuka dan dilipat.
    *Tes:* `npm test` 74 file / 1.891 tes dan build produksi lulus. Chromium
    154: cashflow 20/20, kategori 28/28, kerangka 4/4. Tes baris total gagal
    pada kode sebelum MW dan pada dua mutan (salah hitungan atau nominal).
    Tes profil yang melampaui batas gagal pada kode parkir.
    *Belum terbukti:* HP fisik dan pembaca layar belum diuji. Pada galat
    perhitungan, judul panel lipat masih memakai pesan kosong lama.
  - [x] **b.** (S–M) `incomeTotal` di `buildCashflowReport`
    (`src/lib/cashflowReport.ts`) dan satu baris ringkas "Pemasukan · Pengeluaran
    · Selisih (tanpa pindah uang antar dompetmu)". Baris "Perlu dicek" belum
    ikut sampai ditinjau.
    *Selesai 24 Nov 2026:* Ringkasan menampilkan Pemasukan, Pengeluaran,
    dan Selisih di bawah kartu arus rekening. Ketiganya mengikuti dompet,
    mata uang, dan periode yang dipilih. Saat panduan awal tampil atau laporan
    gagal dihitung, baris ini disembunyikan (`CashflowOverview.tsx`).
    *Keputusan agen (mudah dibatalkan):* `buildCashflowReport` menjumlahkan
    posting biasa positif yang sudah berjenis `income`. Perlu dicek,
    perpindahan dana, transfer, dan penyesuaian tidak ikut pemasukan.
    Pengeluaran memakai `categoryExpenseTotal`, termasuk biaya transfer.
    Ringkasan hanya membaca jenis dan kategori yang sudah tersimpan.
    *Dari tinjauan (benar/aman dan tes/tampilan):* transfer TRY ke USD
    menampilkan pengeluaran biaya ₺2 di sisi pengirim dan pemasukan $0 di
    penerima. Di batas nominal aman, selisih satu kuruş tampil +₺0,01 pada
    lebar 320 gelap. Byte catatan tetap identik. Tes membaca nominal dan
    tanda di layar, termasuk nol tanpa tanda.
    *Tes:* `npm test` 74 file / 1.893 tes dan build produksi lulus.
    Chromium: cashflow 20/20, kategori 28/28, kerangka 4/4. Kasus pada kode lama gagal di tiga tes unit dan tiga
    kasus browser. Mutan semua kredit gagal di dua tes unit dan ketiga kasus
    browser. Tiga mutan tampilan gagal saat label pemasukan salah, baris
    muncul bersama panduan awal, atau angka nol muncul saat laporan gagal.
    Delapan pemeriksaan tambahan mencakup 1440 terang dan 320 gelap.
    *Belum terbukti:* HP fisik dan pembaca layar belum diuji.
  - [x] **c.** (S) Angka bulan sebelumnya di baris itu. Catatan: perbandingannya
    bulan penuh lawan bulan berjalan (`KERANGKA_HALAMAN.md` 1.3.2).
    *Selesai 24 Nov 2026:* Ringkasan menyebut pemasukan, pengeluaran dan
    selisih untuk bulan kalender sebelumnya pada baris pembanding. Nama
    bulan, tahun, dan “sebulan penuh” tertulis di situ. `src/App.tsx` dan
    `CashflowOverview.tsx` memakai cakupan laporan yang dipilih.
    *Keputusan agen (mudah dibatalkan):* bulan berjalan hanya sampai hari
    ini. Bulan sebelumnya mencakup tanggal pertama sampai terakhir.
    Pembanding tersembunyi bila periode seluruh catatan, bulan pilihan belum
    dimulai, atau kedua total terkonfirmasi bulan sebelumnya nol.
    *Dari tinjauan (benar/aman dan tes/tampilan):* pada 15 Januari, transaksi
    31 Desember ikut pembanding, sedangkan 16 Januari belum masuk baris
    sekarang. Saat total Desember melampaui batas aman, ringkasan Januari
    tetap berfungsi. Tes awal belum membedakan arus rekening dari pengeluaran
    dan pemasukan terkonfirmasi. Kasus lintas tahun kini memeriksa keduanya
    pada tiga dompet, termasuk penerima kredit yang masih perlu dicek.
    *Tes:* `npm test` 74 file / 1.893 tes dan build produksi lulus.
    Chromium: cashflow 21/21 dan kerangka 4/4. Dua kasus gagal pada kode
    sebelum MW. Empat mutan gagal (bulan, tanda selisih, kredit tertunda
    ikut, atau pembanding nol tetap terlihat). Lebar 1440 terang dan 320
    gelap menampilkan ₺6, ₺10, dan −₺4 tanpa luapan.
    *Belum terbukti:* HP fisik dan pembaca layar belum diuji. “Sebulan penuh”
    menyebut rentang tanggal kalender. Kelengkapan mutasi bank tidak diukur.

  Tidak diusulkan: menyamakan angka "keluar" halaman Transaksi dengan total
  kategori di Ringkasan lewat penambahan biaya transfer (usul awal peninjau).
  Angka itu juga menghitung baris Perpindahan dana, jadi tetap tidak akan sama,
  dan perilakunya dicatat di `KERANGKA_HALAMAN.md:751-755`; mengubahnya butuh
  keputusan tersendiri.

- [x] **MW-129 — Kesegaran catatan per dompet**
  Kartu dompet dan Ringkasan memberi label "Saldo aktual `<hari ini>`" tanpa
  menyebut sampai tanggal berapa catatan atau mutasi bank yang diimpor; periode
  mutasi tersimpan hanya tampil di halaman Impor. Memakai tanggal yang sudah
  tersimpan saja, tidak ada yang ditebak.
  - [x] **a.** (S) `src/lib/walletFreshness.ts` + tes: tanggal posting terakhir dan
    akhir periode mutasi terakhir per dompet.
    *Selesai 24 Nov 2026:* `walletFreshness(data, today)` menghitung tanggal
    posting terakhir sampai hari acuan dan akhir periode mutasi terbaru untuk
    tiap dompet. Keduanya bisa kosong secara terpisah. Fungsi hanya membaca
    dokumen dan mengembalikan hasil mengikuti urutan dompet.
    *Keputusan agen (mudah dibatalkan):* transfer memakai tanggal tiap sisi
    dari konteks transfer atau tautan sumber. Sisi tanpa tanggal dilewati.
    Transfer lama tanpa keduanya memakai tanggal transaksi untuk kedua
    dompet, mengikuti perhitungan saldo. Akhir periode mutasi mengikuti
    dokumen yang tersimpan meskipun melewati hari acuan.
    *Dari tinjauan (benar/aman dan tes):* pada data yang diterima validator,
    debit tanggal 18 sudah dihitung pada tanggal 19. Kredit tanggal 20 baru
    dihitung pada tanggal 20, meski periode mutasinya sudah tersimpan.
    Urutan catatan dan mutasi dalam dokumen tidak menentukan tanggal terbaru.
    *Tes:* `npm test` 75 file / 1.902 tes dan build produksi lulus.
    Sembilan tes fokus lulus. Pada kode sebelumnya, modul belum ada dan tes
    gagal dimuat. Sepuluh mutan gagal pada tanggal, urutan, atau periode.
    Profil sintetis Jago PDF, Ziraat XLSX, dan CSV umum diuji melalui jalur
    impor, serialisasi, dan buka ulang.
    *Belum terbukti:* fungsi belum dipakai halaman aplikasi pada butir ini.
    Tidak ada pengujian browser lokal untuk helper ini.
  - [x] **b.** (S) Satu baris di kartu dompet: "Catatan terakhir 12 Nov · mutasi
    bank sampai 19 Okt". *File:* `src/components/WalletsPage.tsx`, `src/App.tsx`,
    `tests/wallet_browser.py`.
    *Selesai 24 Nov 2026:* kartu Dompet menampilkan tanggal catatan terakhir
    dan akhir periode mutasi yang tersimpan di bawah saldo, termasuk pada
    tab Arsip. Tahun ditulis untuk tanggal di luar tahun berjalan.
    `src/App.tsx` menghitungnya saat berada di Dompet. `WalletsPage.tsx`
    menampilkan hasil dan ikut diperbarui ketika tanggal lokal berubah.
    *Keputusan agen (mudah dibatalkan):* dompet kosong bertuliskan “Belum
    ada catatan.” Dompet dengan histori yang hanya memuat tanggal mendatang
    atau yang tidak diketahui menyebut tanggal terakhir belum tersedia.
    Saat data belum berhasil disimpan atau sumber perlu dipulihkan,
    “Tanggal catatan dan mutasi belum dapat dipastikan.” menggantikan tanggal.
    *Dari tinjauan (benar/aman dan tes/tampilan):* transaksi 30 Oktober yang
    gagal karena kuota sempat ditampilkan sebagai catatan terakhir meski
    penyimpanan masih berakhir 3 Oktober. Tanggal juga sempat ditampilkan
    ketika tab lain membuat data tidak terbaca. Sesudah perbaikan, tanggal
    baru muncul setelah simpan ulang berhasil. Pada lebar 320 gelap, teks
    panjang membungkus di antara saldo dan tombol. Saat Istanbul berganti
    hari, transaksi yang tadinya di masa depan muncul tanpa muat ulang.
    *Tes:* `npm test` 76 file / 1.906 tes dan build produksi lulus.
    Chromium: dompet 24/24, pemulihan 17/17, kerangka 4/4. Sebelum MW,
    empat tes format dan kasus kartu gagal. Enam mutan tampilan gagal.
    Kedua regresi tanggal/penyimpanan gagal pada kode parkir.
    *Belum terbukti:* HP fisik dan pembaca layar belum diuji. Arsip uang
    tunai lama memakai tampilan tersendiri. Kelengkapan mutasi tidak diukur.
  - [x] **c.** (S–M) Pengingat di Ringkasan untuk dompet yang punya mutasi tersimpan
    tetapi belum menjangkau bulan lalu; bisa ditutup sampai besok.
    *Selesai 24 Nov 2026:* Ringkasan mengingatkan dompet aktif yang mutasi
    bank tersimpannya berhenti sebelum tanggal 1 bulan lalu. Dompet dengan
    akhir periode terlama disebut lebih dulu. **Impor mutasi** membuka Impor.
    `staleStatements` dan `statementReach` di `walletFreshness.ts` membaca
    akhir periode tersimpan. Pengingat dipasang di `src/App.tsx`.
    *Keputusan agen (mudah dibatalkan):* tanggal 1 bulan lalu sudah cukup.
    Dompet tanpa mutasi tersimpan, cash, dan arsip dikecualikan. Kotak hanya
    tampil pada Ringkasan data sendiri. Peringatan penyimpanan mendapat
    giliran pertama, lalu pengingat cadangan. **Nanti saja** memakai kunci
    lama `uangku:backup-reminder-dismissed:v1` dan menutup semua pengingat
    sampai besok menurut tanggal perangkat.
    *Dari tinjauan (benar/aman dan tes/tampilan):* pada kode parkir, kotak
    masih mengajak impor ketika transaksi gagal disimpan karena kuota.
    Kini kotak menunggu penyimpanan pulih. Nama dompet 60 huruf tanpa spasi
    dahulu membuat isi kotak selebar 786 piksel di layar 320. Sesudah teks
    membungkus, isi serta kotak sama-sama 286 piksel. Kasus beberapa dompet
    mengunci urutan, pengecualian cash/arsip, dan lebar isi kotak.
    *Tes:* `npm test` 76 file / 1.910 tes dan build produksi lulus.
    Seluruh 18 suite Chromium lulus, termasuk UX 16/16, pemulihan 17/17,
    dompet 24/24 dan arus kas 21/21. Median performa 5.016,48 ms dari
    batas 7.000 ms, jeda frame maksimum 238,3 ms dari batas 350 ms.
    Empat tes unit dan dua kasus browser gagal pada sumber sebelum MW.
    Tujuh mutan keputusan/tampilan terdeteksi. Regresi draf yang gagal
    disimpan dan nama panjang gagal pada kode parkir.
    *Belum terbukti:* HP fisik dan pembaca layar belum diuji. Tanggal akhir
    periode tersimpan tidak membuktikan kelengkapan mutasi bank.

- [ ] **MW-130 — Anggaran memberi peringatan**
  Status anggaran hanya terlihat di panel kategori Ringkasan (terakhir di HP)
  dan hilang saat satu dompet dipilih. Anggaran hanya menghitung pengeluaran
  terkonfirmasi, jadi tepat setelah impor angkanya terlalu rendah sampai baris
  "Perlu dicek" ditinjau.
  - [ ] **a.** (S) Pembantu murni di `src/lib/budgets.ts` + tes: porsi terpakai,
    porsi bulan berjalan, status (aman / hampir habis dari 80% / lewat).
  - [ ] **b.** (S–M) Satu banner di Ringkasan bila ada anggaran hampir habis atau
    lewat.
  - [ ] **c.** (M) Di form pengeluaran: "Sisa anggaran Makan & minum bulan ini: Rp
    40.000".
  - [ ] **d.** (M, opsional) — **butuh keputusan** Batas bulanan keseluruhan atau
    sisa yang dibawa ke bulan berikutnya; butuh entri baru di format anggaran
    yang ditolak versi aplikasi lama.

- [ ] **MW-131 — Tren 6 bulan**
  Tidak ada grafik atau tampilan multi-bulan; satu-satunya pembanding adalah
  bulan sebelumnya di bawah dua kartu.
  - [ ] **a.** (M) `src/lib/monthlyTrend.ts` + tes: per bulan dan mata uang,
    pemasukan dan pengeluaran terkonfirmasi (termasuk biaya) serta pengeluaran
    per kategori.
  - [ ] **b.** (M) Panel lipat "Tren 6 bulan" di Ringkasan dengan tabel kecil dan
    batang CSS (tanpa pustaka grafik), dihitung hanya saat dibuka supaya
    anggaran performa tidak terganggu.
  - [ ] **c.** (S) Pilih satu kategori untuk melihat barisnya selama 6 bulan.

- [ ] **MW-132 — Saldo semua mata uang berdampingan**
  Saldo dan laporan hanya tampil satu mata uang per tab.
  - [ ] **a.** (S, tanpa keputusan) Strip "Semua mata uang" di Ringkasan/Dompet:
    saldo tiap mata uang berdampingan, **tidak** dijumlahkan.
  - [ ] **b.** (L) — **butuh keputusan** Perkiraan total memakai kurs acuan yang
    diketik pemilik, berlabel jelas "perkiraan". `README.md:27` menyatakan
    nominal berbeda mata uang tidak dijumlahkan langsung, jadi aturan itu harus
    dilonggarkan dulu. Bagian opsional baru di cadangan lengkap ditolak versi
    aplikasi lama.

- [ ] **MW-133 — Rutin bulanan** (L) — **butuh keputusan**
  Template tidak punya tanggal jatuh tempo, hanya untuk pengeluaran/pemasukan,
  dan tidak ada daftar "belum dicatat bulan ini".
  - [ ] **a.** `dueDay` opsional dan `lastRecordedOn` pada template
    (`src/lib/transactionTemplates.ts`).
  - [ ] **b.** Panel "Rutin bulan ini" dengan tombol **Catat**; tidak ada yang dibuat
    otomatis (keputusan MW-13a tetap).
  - [ ] **c.** Template untuk transfer.
  - [ ] **d.** "Catat lagi seperti ini" di rincian transaksi.

  Kelemahan yang diketahui: tagihan yang masuk lewat impor bank tetap terdaftar
  "belum dicatat", karena tautannya hanya dibuat saat isi cepat dari template.
  Field template baru ditolak versi aplikasi lama saat pemulihan.

- [ ] **MW-134 — Gabungkan catatan manual dari file cadangan** (L) *(sebagian)* — **butuh keputusan**
  Pemulihan selalu mengganti seluruh catatan; catatan yang hanya ada di
  perangkat lain hilang. Dialognya memang menyebut "akan menggantikan" dan
  menawarkan **Cadangkan dulu**, dan `README.md:193-194` menyarankan mencatat di
  satu tempat. Belum terbukti bahwa pemilik mencatat di dua perangkat secara
  bersamaan. MW-93 adalah langkah yang jauh lebih kecil untuk risiko yang sama.
  *Usul:* aksi ketiga "Gabungkan catatan manual…" yang hanya mengambil
  pemasukan/pengeluaran/perpindahan ketikan tangan yang id-nya belum ada, dengan
  daftar centang; data bank dan metadata di file tidak pernah digabung; satu
  penulisan lewat controller.

- [ ] **MW-135 — Impor file tanpa kolom saldo** (L) *(sebagian)* — **butuh keputusan**
  Impor umum mewajibkan kolom saldo berjalan (`README.md:104-105`); ini batasan
  yang didokumentasikan, bukan kelalaian. Belum terbukti bahwa ekspor yang
  dipakai pemilik tidak punya kolom saldo. Mode tanpa saldo hanya aman bila
  barisnya disimpan sebagai catatan biasa, **bukan** fakta bank, dan tidak ada
  saldo awal yang diturunkan. Tunggu contoh file (MW-19) sebelum membangunnya.

### F6. CI, alat, dan dokumen

Angka CI (dari GitHub Actions): 40 run PR terakhir (#66–#105) = 33 sukses, 5
gagal, 2 dibatalkan; job pada run #105 memakan 9:14, 9:45, dan 11:39; run
Publikasikan #66 memakan 13:52, dengan build 25 detik dan deploy 13 detik; 12
run tersusul push yang lebih baru di branch yang sama.

- [ ] **MW-136 — CI: batalkan run PR yang tersusul** (S)
  `ci.yml` tidak punya blok `concurrency`. Tambahkan, dikunci pada nomor PR
  (dengan nilai cadangan seperti `github.run_id`, karena `ci.yml` juga dipanggil
  `pages.yml` lewat `workflow_call` dan bisa dipicu manual, tanpa nomor PR),
  dengan `cancel-in-progress` hanya untuk `pull_request`. Tidak mengubah aturan
  "merge hanya setelah hijau".

- [x] **MW-137 — CI: batas waktu pada langkah yang bisa macet** (S)
  Di run Publikasikan #60 semua tes lulus, lalu langkah unggah bukti macet ±11
  menit dan job dibatalkan oleh batas 20 menit; build dan deploy dilewati dan
  deploy berikutnya baru jalan 12 jam 26 menit kemudian (sekali dalam 30 run
  terakhir). Di run PR #82 langkah pasang browser macet 19 menit 40 detik.
  Beri batas waktu per langkah pada "Simpan bukti pengujian browser"
  (`ci.yml:83` dan `:184`) dan "Pasang browser pengujian" di job
  `other-browsers` (`ci.yml:136-144`, dengan satu kali coba ulang; di job
  `test-and-build` `install-deps` sudah dibatasi `timeout 240`). Bila unggah
  bukti gagal, tampilkan anotasi peringatan yang terlihat supaya tidak ada
  kandidat yang diam-diam tanpa bukti (`AGENTS.md`: hasil per kandidat dicatat
  jujur).
  *Dikerjakan 18 November 2026, dengan perbaikan yang berbeda dari usul di atas
  untuk langkah pasang browser.* Hari itu masalahnya muncul tiga kali: di run PR
  #56 langkah pasang browser WebKit memakan 26 menit 41 detik dan Firefox ±14
  menit; di run Publikasikan #67 WebKit 22 menit 56 detik, sehingga job
  dibatalkan batas 30 menit dan publikasi untuk PR #55 dilewati. Tidak ada tes
  yang gagal. Log run PR #56 menunjukkan penyebabnya: mirror Ubuntu milik runner
  (`us-east-2.ec2.archive.ubuntu.com`) hanya memberi ±100 kB/detik ("Fetched 139
  MB in 24min 1s"). Jadi ini unduhan lambat, bukan macet, dan coba ulang di job
  yang sama akan memakai mirror lambat yang sama.
  - Job `other-browsers`: percobaan pertama dibatasi 5 menit. Bila lewat atau
    gagal, sumber apt dialihkan ke `archive.ubuntu.com` dan dicoba sekali lagi
    (batas 7 menit); paket yang sudah terunduh dipakai ulang. Langkahnya
    dibatasi 17 menit dan job 35 menit (sebelumnya 30). Runner menyimpan daftar
    mirrornya di `/etc/apt/apt-mirrors.txt` (mirror regional prioritas 1, arsip
    utama prioritas 2), dan apt hanya pindah bila mirror pertama gagal, bukan
    bila lambat; karena itu file itulah yang ditulis ulang.
  - Kedua job: "Simpan bukti pengujian browser" dibatasi 5 menit dan tidak
    menggagalkan job; langkah berikutnya menulis anotasi peringatan bila bukti
    tidak terunggah. Job `test-and-build`: langkah pasang browser dibatasi 10
    menit.
  - Pemicu manual `uji_mirror_cadangan` di **Periksa Uangku** menjalankan jalur
    cadangan dengan sengaja, supaya jalur itu bisa diuji tanpa menunggu mirror
    lambat.
  *Diuji:* alur langkahnya dengan perintah tiruan di luar CI (normal, mirror
  lambat, mirror gagal, font gagal, kedua percobaan gagal, dan pemicu manual),
  lalu di runner pada commit `662db8a`, job WebKit:
  - jalur normal (run PR): 139 MB dalam 9 detik dari mirror runner, tanpa
    peringatan;
  - jalur cadangan (run manual `uji_mirror_cadangan`): daftar mirror diganti,
    139 MB dalam 28 detik dari `archive.ubuntu.com`, font Inter terpasang, semua
    tes lulus.
  Uji manual pertama (commit `29d29a5`) gagal dan menemukan kesalahan di versi
  awal: alamat mirror diganti di daftar sumber apt, padahal runner memakai
  `apt-mirrors.txt`, sehingga percobaan kedua tetap memakai mirror lambat dan
  berhenti di batas 7 menit.
  *Belum terbukti:* bahwa `archive.ubuntu.com` selalu lebih cepat dari mirror
  runner (satu pengukuran: ±4,9 MB/detik); bila keduanya lambat, langkah ini
  gagal dalam ±17 menit dengan pesan yang jelas, bukan dibatalkan diam-diam.
  Jalur "percobaan pertama lewat batas waktu lalu pindah" belum terjadi di
  runner; yang diuji di sana adalah pindah mirror lewat pemicu manual.
  *File:* `.github/workflows/ci.yml`.

- [ ] **MW-138 — CI: satu artefak `dist` diuji lalu diterbitkan; tes browser dipecah** (M)
  Situs dibangun empat kali per push ke `main`: tiga job di `ci.yml`
  masing-masing menjalankan `npm run build` untuk tesnya, lalu sekali lagi di
  `pages.yml` untuk diterbitkan, tanpa perbandingan hash.
  *Usul:* satu job build mengunggah `dist`; tes browser berjalan sebagai matriks
  terhadap artefak itu; deploy menerbitkan artefak yang sama. Ini memenuhi
  aturan "build produksi dengan hash yang sesuai" lebih baik dari sekarang.
  Perkiraan waktu (±5 menit, bukan 12) belum diukur. Nama job berubah: bila ruleset di F2 sudah mewajibkan tiga pemeriksaan
  yang sekarang, pemilik memperbarui daftar pemeriksaan wajib saat PR ini
  di-merge.

- [ ] **MW-139 — CI: lewati tes browser untuk perubahan dokumen saja** (S) — **butuh keputusan**
  Tiga dari merge yang diperiksa hanya mengubah `.md`. Melewati job browser
  untuk perubahan seperti itu, atau gate Chromium-saja saat push ke `main`,
  mengubah arti aturan "merge hanya setelah CI hijau" di `AGENTS.md`, jadi
  pemilik perlu mengubah `AGENTS.md` lebih dulu. Lakukan proteksi branch
  (lihat F2) sebelum ini. Gate Chromium-saja di `main` baru bisa dikerjakan
  sesudah MW-138.

- [ ] **MW-140 — Izin workflow dan pin action**
  - [ ] **a.** (S) `pages.yml`: `pages: write` dan `id-token: write` hanya pada job
    `deploy`; sekarang job `build` (yang menjalankan `npm ci` dan
    `npm run build`) ikut mewarisinya. Ini hanya merapikan izin: paket build
    yang jahat tetap menguasai HTML yang diterbitkan apa pun izin tokennya;
    yang benar-benar mengecilkan risiko adalah butir b dan MW-138. Job `build`
    juga menjalankan `actions/configure-pages@v5`; periksa apakah langkah itu
    butuh izin Pages sebelum izinnya dicabut. `pages.yml` tidak jalan di CI PR,
    jadi periksa run Publikasikan pertama sesudah merge.
  - [ ] **b.** (S) Pin setiap action ke SHA commit, dengan tag di komentar.

- [ ] **MW-141 — Dependensi dan pemeriksaan kompiler** *(sebagian)*
  `npm audit` saat tinjauan: 8 temuan; 7 "high" semuanya alat build/tes lewat
  `picomatch` (tidak ikut dikirim, belum ada perbaikan tanpa perubahan besar), 1
  "low" di `fast-xml-parser` ≤5.11.2. Yang "low" itu tidak terbukti bisa dipicu
  di sini: importer tidak memakai `stopNodes` dan menolak XML tidak valid
  sebelum diurai.
  - [ ] **a.** (S) Naikkan `fast-xml-parser` ke 5.12.1 dan vite/vitest ke rilis
    terbaru dalam versi mayor yang sama (saat tinjauan: vite 8.3.5 → 8.3.8,
    vitest 5.0.5 → 5.1.1; untuk vitest itu rilis minor).
  - [ ] **b.** (S) Nyalakan `noUnusedLocals` dan `noUnusedParameters`: 16 galat (11
    impor mati di `src/App.tsx`, 2 parameter di `src/lib/sourceCommands.ts`, 3 di
    file tes).
  - [ ] **c.** (S) `.github/dependabot.yml` untuk `npm` dan `github-actions`
    (supaya SHA yang dipin di MW-140b ikut diperbarui), mingguan dan
    dikelompokkan. Setiap PR Dependabot memicu gate penuh ±12 menit.
  - [ ] **d.** (S) Skrip `typecheck` dan `check` di `package.json`. Pemeriksaan tipe
    sudah berjalan di CI lewat `npm run build`; ini kemudahan lokal saja.

- [ ] **MW-142 — Tes: varian HP `source_browser.py` dan satu daftar suite**
  - [ ] **a.** (S) `python tests/source_browser.py --mobile` didokumentasikan di
    `LOCAL_WORKFLOW.md:73` tetapi tidak pernah ada di `ci.yml`. Belum diketahui
    apakah varian ini masih lulus; bisa jadi butuh perbaikan dulu. Tambahkan ke
    kedua job tes browser di `ci.yml`. Bila gagal di CI, laporkan dan jangan
    dipaksa; perbaikannya jadi MW terpisah (pola MW-03b).
  - [ ] **b.** (S) Satu file daftar suite yang dibaca CI dan `LOCAL_WORKFLOW.md`
    (sekarang `LOCAL_WORKFLOW.md` mendaftar 10 dari 18 suite CI).
  - [ ] **c.** (S–M) — **butuh keputusan** Tes browser bisa dijalankan di sesi agen:
    penyiapan lingkungan yang memasang Python Playwright 1.64.1, atau satu tes
    asap Node Playwright (muat, tambah, ubah, cadangkan).

- [ ] **MW-143 — Dokumen status selaras dengan kode**
  - [ ] **a.** (S) `STATUS.md` bertanggal 9 Nov, menyebut 48 file / 1.533 tes, dan
    berkata `full_backup_browser.py` belum masuk CI (bertentangan dengan catatan
    MW-03b). Tulis ulang tanpa angka yang cepat usang; tautkan ke Actions.
  - [ ] **b.** (S) Pindahkan `KERANGKA_HALAMAN.md` (104 KB, ditandai selesai) dan 13
    laporan JSON lama di `docs/` ke `docs/archive/`. Arsipkan, jangan hapus;
    perbarui rujukan di PR yang sama: `MICRO_TASKS.md` (MW-118, MW-122, MW-128,
    dan butir ini), `docs/ISTILAH.md:3`, `docs/BANK_ONLY_AUTOMATION.md:16`, dan
    teks di `tests/kerangka_browser.py:1,303`. `AGENTS.md`, `README.md`,
    `LOCAL_WORKFLOW.md`, dan `README_LOCAL.txt` tidak menyebut file-file ini.
    `MICRO_TASKS.md` tetap di akar.
  - [ ] **c.** (S) `LOCAL_WORKFLOW.md:11` meminta Node 24 sedangkan `README.md` dan
    `package.json` menyebut 22.12 ke atas (CI memakai 24, dan `README.md:201`
    sudah menyebut keduanya); samakan kalimat `LOCAL_WORKFLOW.md` dengan
    `README.md`, `engines` tidak diubah.
  - [ ] **d.** (S) `vite.config.ts:16` memasang host `0.0.0.0` port 5173 (hanya
    berlaku untuk `vite` polos; skrip npm menimpanya). Samakan dengan
    `127.0.0.1:4180` atau hapus bloknya.

- [ ] **MW-144 — Pecah `App.tsx` lanjutan** (L)
  `src/App.tsx` membesar lagi menjadi 746 baris (597 saat pemecahan di bagian
  D), dengan 8 baris di atas 1.000 karakter (terpanjang 2.245 di baris 723). Hanya
  memindahkan kode; perilaku tidak berubah.
  - [ ] **a.** (M) Hook `useHistoryView`: kata cari, filter, periode, dompet,
    kategori, urutan, halaman, dan pilihan beserta memo-nya.
  - [ ] **b.** (M) Komponen `TransactionsPage` yang memiliki hook itu, sehingga
    mengetik hanya me-render ulang bagian tersebut. Ini melengkapi MW-112;
    MW-112a–c tetap dikerjakan di sana.
  - [ ] **c.** (S) Pecah delapan baris di atas 1.000 karakter menjadi satu prop per
    baris.

### F7. Backlog CSS (D6): usul urutan baru *(sebagian)* — **keputusan pemilik**

Angka `src/styles.css` saat tinjauan: 1.842 baris, 276 warna hex unik (494
pemakaian; `#52634f` 122 kali), 59 blok `@media` (760px muncul 16 kali), 9
`!important`, 11 `style={}` di TSX. Hampir semua angka audit D6 bertambah sejak
10 November; hanya `style={}` yang turun (16 → 11). Satu-satunya cacat yang
terbukti adalah MW-91; selebihnya penilaian peninjau kode, bukan cacat. Tidak
ada entri D6 yang diubah atau dicentang oleh bagian ini.

- **Kerjakan:** MW-91 → MW-61 → MW-62 → MW-63 bagian (d) status/badge/banner
  (ditambah ikon) → MW-73 → MW-65 → MW-68 (tepat sebelum MW-121).
- **Tunda:** MW-63 bagian (a)–(c) sampai ada cacat tema gelap lain; MW-64
  (gabungkan per area hanya saat area itu disentuh); MW-75; MW-81.
- **Usul dibuang:** MW-66, MW-67, MW-69, MW-71, MW-74, MW-80, MW-82. Tidak ada
  cacat yang terlihat pengguna yang ditelusuri ke sana, dan MW-71/MW-80 berisiko
  konflik atau menggeser piksel yang dijaga tes. Daftar buang ini usul peninjau
  kode saja; tiga peninjau lain mengusulkan menunda atau membiarkannya
  opsional, bukan membuang.
- **Butuh keputusan:** MW-72 (font). MW-76 kecil dan opsional (klaim MW-75,
  MW-76, dan MW-81 tidak diperiksa di aplikasi).
- MW-61 dan MW-70 tetap MW tersendiri. Usul peninjau untuk meleburnya ke MW-63
  bertentangan dengan aturan satu MW per PR, kecuali pemilik menulis ulang
  entrinya. D6 menetapkan MW-63 dikerjakan setelah MW-61/62, jadi MW-61 masuk
  urutan di atas sebelum MW-63 bagian (d). MW-70 belum punya tempat di urutan
  itu; tempatnya ditentukan pemilik.

### F8. Dipertimbangkan, tidak diusulkan

- **Dompet cash, rincian tarik tunai, bagi tagihan:** keputusan pemilik "cash
  tidak dibukukan" tetap; dua catatan manual sudah cukup untuk bagi tagihan.
- **Tag:** kolom catatan dan pencarian sudah menutup kebutuhannya.
- **Pengingat terjadwal / notifikasi:** tidak mungkin tanpa server; MW-129c
  adalah pengganti lokalnya.
- **Salinan cermin di IndexedDB/OPFS sebagai pelindung penghapusan:** berada di
  wadah origin yang sama dan ikut terhapus; hanya layak sebagai penyimpanan
  utama (MW-109b).
- **Mengecilkan bundle:** JS 773,9 kB dan CSS 117,0 kB dari satu file 893 kB;
  build satu file tidak bisa memuat malas, jadi tidak ada potongan murah.
- **`isolate: false` di vitest** (hemat ±1,9 detik, berisiko state bocor
  antar-tes), **cache browser Playwright di CI** (24–57 detik dari job 9–13
  menit), **menulis ulang tes browser Python**: tidak sepadan.
- **Penjaga hitungan CSS di vitest** (gagal bila jumlah warna hex, aturan
  gelap, `!important`, atau selektor ganda naik): akan menggagalkan PR sah yang
  menambah satu warna.
- **Pemeriksaan `BUILD_INFO.json` situs terbit di `pages.yml`:** tidak akan
  menangkap insiden run #60, karena job-nya ikut dilewati saat job verifikasi
  dibatalkan.
- **Prettier seluruh repo** (satu PR format besar) dan **ESLint dengan aturan
  react-hooks** (jumlah temuannya belum dihitung): tidak sekarang; MW-144c
  merapikan baris panjang secara manual. `noUncheckedIndexedAccess` (821 galat)
  dan `exactOptionalPropertyTypes` (52 galat) juga tidak sekarang.
- **Ditunda sampai ada kebutuhan nyata:** utang/piutang (tanyakan dulu ke
  pemilik cara mencatatnya, lihat MW-92), target tabungan, laporan bulanan yang
  bisa dicetak (menunggu MW-131).

### Keputusan yang perlu diambil

Kolom **Siapa**: *agen* berarti agen boleh memilih sendiri karena pilihannya
mudah dibatalkan, lalu mencatat pilihan dan alasannya di entri itu; *pemilik*
berarti menunggu jawaban pemilik, sesuai batas di `AGENTS.md` ("Wewenang
agen"). Baris MW-105b adalah uji di perangkat pemilik, bukan keputusan, dan
tidak menahan MW-105a. Baris MW-107 pertanyaan sampingan dan tidak menahan
MW-107. Tindakan pemilik lain ada di F2.

| MW | Siapa | Pertanyaan |
|---|---|---|
| MW-89 | agen | Format transfer di CSV: dua baris bertanda, atau satu baris dengan kolom tambahan? |
| MW-92 | pemilik | Apakah aturan 13 Nov (uang dari/ke orang lain = pemasukan/pengeluaran) berlaku umum, termasuk form manual dan Ziraat, atau hanya impor Jago? |
| MW-99 | agen | Ambang pengingat cadangan: jumlah entri baru, atau setiap impor? |
| MW-100d | agen | Mau cadangan otomatis ke satu file di desktop (hanya Chromium)? |
| MW-101 | agen | Apakah pemulihan yang berhasil dihitung sebagai "punya cadangan"? |
| MW-105b | pemilik | Perangkat dan browser mana yang dipakai, dan apakah **Cadangkan semuanya** menghasilkan file di sana? (uji oleh pemilik) |
| MW-105d | agen | Mau "Uji file cadangan" (mengubah batasan MW-06)? |
| MW-107 | pemilik | Opsional: pindahkan Uangku ke origin sendiri? (tidak diperlukan untuk CSP) |
| MW-108 | pemilik | Mau cadangan berfrasa sandi? |
| MW-109 | pemilik | Tetap `localStorage` dengan meter, atau pindah/kompres sekarang? |
| MW-111 | agen | Target kecepatan simpan (jumlah baris dan perangkat)? |
| MW-114 | agen | Service worker untuk offline: ya atau tidak? |
| MW-116b | agen | Simpan tanggal "terakhir dicek" per dompet? |
| MW-117b | agen | Mau tombol "balik arah" kurs dan peringatan bila kurs berbeda lebih dari 100×? |
| MW-120c | pemilik | Boleh menerapkan ulang entri baru otomatis saat konflik dua tab? |
| MW-124c | agen | Kontrol periode mana yang dipertahankan di Transaksi? |
| MW-130d | pemilik | Batas bulanan keseluruhan atau sisa anggaran dibawa? |
| MW-132b | pemilik | Boleh ada perkiraan total lintas mata uang dengan kurs acuan? |
| MW-133 | pemilik | Mau rutin bulanan dengan kelemahan yang disebut? |
| MW-134 | pemilik | Mencatat di dua perangkat? Mau penggabungan catatan manual? |
| MW-135 | pemilik | Setujui mode impor tanpa saldo, dan kirim contoh file? |
| MW-139 | pemilik | Ubah `AGENTS.md` supaya perubahan dokumen saja boleh melewati tes browser? Terima deploy setelah gate Chromium-saja di `main`, atau pertahankan gate penuh ±13 menit? |
| MW-142c | agen | Cara menjalankan tes browser di sesi agen? |
| F7 | agen | Urutan CSS baru dipakai; entri di daftar "usul dibuang" tidak dihapus dari file, hanya tidak dikerjakan. MW-72: font? |

## G. Alur kerja (18 November 2026)

- [x] **MW-145 — Agen me-merge sendiri dan melapor**
  Keputusan pemilik (18 November 2026): pemilik tidak punya waktu menunggui PR,
  jadi agen me-merge PR-nya sendiri setelah CI hijau dan melapor; pemilik
  meninjau dari laporan. Entri **butuh keputusan** yang mudah dibatalkan boleh
  diputuskan agen. Batas wewenang (apa yang tetap menunggu pemilik) adalah
  tafsiran agen atas keputusan itu dan bisa diubah pemilik.
  *File:* `AGENTS.md` (bagian Rilis dan bagian baru "Wewenang agen"),
  `LOCAL_WORKFLOW.md`, `MICRO_TASKS.md` (keputusan, cara pakai, template prompt,
  aturan dan tabel keputusan bagian F).

- [x] **MW-146 — Tes dua tab membaca hasil dari kedua tab** (ditambahkan 19 November 2026)
  Pada PR #65 job Firefox gagal sekali di `two-tabs-sync-and-concurrent`
  (`tests/recovery_browser.py`), sedangkan Chromium dan WebKit lulus dan isi PR
  itu tidak menyentuh penyimpanan. Tes membaca catatan tersimpan lewat tab A
  saja, lalu menganggap tab yang catatannya belum terlihat di sana sebagai tab
  yang kalah dan menuntut status "konflik". Di Firefox pandangan satu tab atas
  `localStorage` bisa tertinggal dari tulisan tab lain, jadi tab yang berhasil
  menyimpan bisa dituduh kalah. Di log, status tab yang dituduh adalah
  "Tersimpan di browser".
  *Perbaikan:* pemenang dibaca dari tiap tab sendiri (form tertutup hanya
  sesudah simpan berhasil), lalu kedua tab ditunggu sampai memuat persis
  catatan dari simpanan yang berhasil; tab yang kalah harus menampilkan
  "konflik" dengan form tetap terbuka. Kode aplikasi tidak diubah.
  *Tes:* `npm test` 71 file / 1.862 tes dan `npm run build` lulus. Chromium
  lokal: `recovery_browser.py` 16/16, lalu kasus itu sendiri 5/5
  berturut-turut.
  *Belum terbukti:* penyebabnya disimpulkan dari log, tidak direproduksi
  (Firefox tidak terpasang lokal); Firefox dan WebKit hanya lewat CI.
  *File:* `tests/recovery_browser.py`.

---

**Urutan:**
MW-00 → 01 → 02 → 03 → 03b → 04 → 05 → 06 → 16 → 07 → 08 → 09 → 10 → 17 → 11,
lalu sisa C (12a–13b) atau D (14, 15, 18) sesuai kebutuhan.

**Urutan usul bagian F:** MW-87 → 93 → 95 → 96 → 97 → 88 → 90 → 110 → 113 →
115 → 116a → 128 → 129, lalu sisanya menurut kebutuhan. MW-111 menyusul sesudah
MW-110; targetnya ditetapkan agen dari hasil ukur MW-110 dan dicatat di
entrinya. MW-87 lebih dulu karena bug nyata dan kecil; F2 sebelum F5 karena
data hanya ada di browser; MW-110/111 sebelum MW-19/MW-20. Yang bertanda
**butuh keputusan** mengikuti kolom "Siapa" di tabel keputusan.
