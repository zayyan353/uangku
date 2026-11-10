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

Dicatat untuk tahap UX (belum dikerjakan): modal Pindah uang menampilkan
"Pilih dompet tujuan yang berbeda" padahal BCA → Bank Jago sudah berbeda
(perlu dicek: bug logika atau pesan); format tanggal form mengikuti bahasa browser.

## E. Butuh bahan dari kamu dulu (jangan dimulai tanpa ini)

- [ ] **MW-19 — Pembaca mutasi bank lain** (satu bank = satu MW).
  Butuh contoh file mutasi asli yang angkanya sudah disamarkan.
- [ ] **MW-20 — Impor PDF/XLS lama.** Ini makro; pecah dulu setelah ada contoh file.

---

**Urutan:**
MW-00 → 01 → 02 → 03 → 03b → 04 → 05 → 06 → 16 → 07 → 08 → 09 → 10 → 17 → 11,
lalu sisa C (12a–13b) atau D (14, 15, 18) sesuai kebutuhan.
