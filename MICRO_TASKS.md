# Uangku — Daftar Micro-Work

Dicek: 9 November 2026, commit `b0ddda1` (main). Revisi 2: keputusan alur, lingkup MW-03, dan urutan sudah diambil.

**Kondisi sekarang:** sehat menurut catatan terakhir (48 file tes / 1.533 tes unit,
build lulus, situs publik melayani `b0ddda1`). Angka tes belum dijalankan ulang
sejak revisi ini; jalankan `npm test` sebagai baseline sebelum MW pertama.

## Keputusan (9 November 2026)

1. **Alur rilis:** satu PR per MW. Tidak ada push langsung ke `main`.
2. **Lingkup MW-03:** versi diperluas (hapus run CI ganda, plus MW-03b).
3. **Urutan:** refactor dulu. MW-16 sebelum MW-07/08, MW-17 sebelum MW-11.

## Cara pakai daftar ini

- Kerjakan **satu MW per sesi AI**. Jangan gabung.
- Setiap MW: branch baru → ubah → `npm test` → `npm run build` → commit → PR ke `main`.
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
```

---

## A. Rapikan repo & CI (murah, mulai dari sini)

- [x] **MW-00 — Longgarkan batas median performa CI** (ditambahkan belakangan, zayyan353/uangku#2)
  Di runner GitHub, median batch tes performa konsisten ~5,05 detik, jadi batas
  5000 ms membuat CI gagal acak tanpa perubahan kode. `ci.yml` sekarang memberi
  `--median-budget-ms 6000`; default lokal, p95 (8000 ms), dan frame budget tetap.
  Menyelidiki kenapa batch-nya ~5 detik bisa jadi MW terpisah.

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

- [ ] **MW-77 — Target sentuh ≥ 44px di HP**
  `.button.small` 32px, `.icon-button` 34px, `.modal-close` 30px, tombol baris
  27px (desktop) / 40×35px (HP), tab 36px, pemilih tema 38–40px, checkbox 15px.
  Naikkan area sentuh di ≤760px tanpa membesarkan ikon.

- [ ] **MW-78 — Angka tabular di semua nominal**
  `tabular-nums` baru ada di `.stat-value`, `.cashflow-table td`,
  `.amount-detail dd`. Tambahkan ke `.wallet-amount`, `.amount-cell`,
  `.balance-number`, `.wallet-card-balance`, `.category-value`,
  `.cashflow-equation dd` supaya digit sejajar antarbaris.

- [ ] **MW-79 — Sidebar di layar pendek + `100dvh`**
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

Dicatat dari uji yang sama, **belum dikerjakan**:

- Refund pembelian kartu (`SATIŞ IADE`, `SATIŞ YD IADE`) sengaja tetap "Perlu
  dicek". Perlu keputusan apakah kredit ini boleh otomatis menjadi
  Pengembalian dana.
- Keterangan transfer yang dipotong bank sebelum kata `Havale` (nama penerima
  panjang) tidak dikenali sebagai transfer dan jatuh ke pengeluaran tanpa
  kategori.
- Pembayaran tagihan lewat `Havale` tercatat sebagai perpindahan dana, sesuai
  kebijakan transfer sekarang; mengubahnya menjadi pengeluaran tetap manual.

## E. Butuh bahan dari kamu dulu (jangan dimulai tanpa ini)

- [ ] **MW-19 — Pembaca mutasi bank lain** (satu bank = satu MW).
  Butuh contoh file mutasi asli yang angkanya sudah disamarkan.
- [ ] **MW-20 — Impor PDF/XLS lama.** Ini makro; pecah dulu setelah ada contoh file.

---

**Urutan:**
MW-00 → 01 → 02 → 03 → 03b → 04 → 05 → 06 → 16 → 07 → 08 → 09 → 10 → 17 → 11,
lalu sisa C (12a–13b) atau D (14, 15, 18) sesuai kebutuhan.
