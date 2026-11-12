# Uangku

Pencatat keuangan pribadi untuk rekening dan e-wallet, dengan saldo, pemasukan,
pengeluaran, transfer, impor mutasi, serta kategori yang bisa disesuaikan.

- **Alamat publik:** <https://zayyan353.github.io/uangku/>
- **Alamat pengembangan lokal:** <http://127.0.0.1:4180>
- **Status versi, tes, dan batasan:** [STATUS.md](STATUS.md)

Catatan keuangan disimpan di browser masing-masing. Alamat lokal dan alamat
publik mempunyai penyimpanan terpisah; publikasi kode tidak memindahkan data.
Gunakan cadangan JSON untuk memindahkan catatan secara sengaja.

## Fitur

- **Tema:** Sistem, Terang, atau Gelap; pilihan diingat per browser.
- **Dompet:** tambah rekening atau e-wallet dengan satu mata uang. Dompet yang
  sudah mempunyai histori dapat diarsipkan dan diaktifkan kembali. Penghapusan
  permanen hanya tersedia bila saldo awal nol dan tidak ada catatan atau fakta sumber.
  Dompet cash tidak digunakan dalam pembukuan aktif.
- **Mata uang:** Kelola mata uang menyediakan 165 kode dari katalog ISO 4217
  yang didukung. Tambah atau sembunyikan pilihan tanpa menghapus histori;
  laporan mata uang tersembunyi yang sudah dipakai tetap dapat dibuka.
  Nominal mengikuti jumlah digit pecahan mata uang, termasuk 0, 2, 3, atau 4 digit.
- **Ringkasan:** saldo aktual memakai batas tanggal hari ini. Transaksi masa
  depan diizinkan dengan peringatan dan ditampilkan terpisah. Setiap mata uang
  mempunyai laporan sendiri; nominal berbeda mata uang tidak dijumlahkan langsung.
- **Transaksi dan transfer:** catat pemasukan, pengeluaran, perpindahan antar
  dompet, biaya transfer, dan kurs manual. Tanggal debit dan kredit transfer
  dipertahankan. Pencarian seluruh periode, filter, kategori massal, dan rincian
  nominal membantu memeriksa histori.
- **Kategori:** tambah atau kurangi pilihan dan kelola aturan kata kunci sendiri.
  Kecocokan yang jelas dapat diisi otomatis, sedangkan yang ambigu menjadi saran.
  Kategori dan aturan pribadi tidak ditimpa oleh pembaruan aturan bawaan.
- **Impor:** pembaca otomatis XLSX Ziraat TRY/TL, pembaca otomatis PDF riwayat
  transaksi Bank Jago (IDR), dan pemetaan kolom CSV, TSV, atau XLSX umum untuk
  dompet aktif dalam mata uang yang didukung.
- **Fakta sumber:** keterangan, tanggal, nominal, dan saldo bank disimpan
  terpisah dari anotasi pengguna. Pratinjau memeriksa saldo antarbaris, impor
  berulang, dan kemungkinan tumpang tindih dengan catatan yang sudah ada.
  Pelengkapan histori dan backfill memerlukan peninjauan bukti serta saldo awal.
- **Penyimpanan:** tab usang ditolak agar tidak menimpa data terbaru. Kegagalan
  menyimpan menyediakan pemulihan draft dan percobaan ulang. Cadangkan dan
  pulihkan catatan melalui JSON.

Aplikasi belum terhubung ke API bank dan tidak menyinkronkan rekening otomatis.
PDF bank lain dan XLS lama belum didukung. Pembacaan format umum memakai pilihan kolom
yang dikonfirmasi pengguna, bukan janji mendukung seluruh format ekspor bank.

## Mulai memakai

1. Tampilan awal memakai data contoh fiktif. Pilih **Mulai pakai data sendiri**
   lalu **Bawa transaksi saya** untuk menyimpan transaksi yang kamu tambahkan beserta
   rekeningnya. Kamu juga bisa meninjau transaksi contoh yang ingin dibawa atau
   memilih **Mulai dari kosong**.
2. Buka **Kelola mata uang** bila mata uang yang dibutuhkan belum terlihat.
   Buka **Dompet** untuk menambah atau menyesuaikan rekening dan e-wallet.
3. Isi saldo awal sebelum transaksi pertama yang ingin dicatat. Jika mulai
   mencatat dari hari ini, gunakan saldo hari ini dan catat transaksi berikutnya.
4. Gunakan **Catat transaksi**, **Pindah uang**, atau **Impor mutasi**.
5. Pilih **Cadangkan semuanya** sebelum mengganti browser, perangkat, atau alamat
   aplikasi, serta sebelum mengganti catatan lewat **Pulihkan cadangan**.

### Impor mutasi

Pilih dompet aktif dengan mata uang yang sesuai. File maksimal 8 MiB dan harus
mewakili satu rekening dalam satu mata uang; impor tidak menukar mata uang.

**Ziraat otomatis:** pilih mode Ziraat untuk XLSX rekening TRY/TL dengan kolom
`Tarih`, `Fiş No`, `Açıklama`, `İşlem Tutarı`, dan `Bakiye`.

**Bank Jago otomatis:** pilih mode Bank Jago untuk PDF "Riwayat Transaksi"
(*Pocket Transactions History*) yang diunduh dari aplikasi Jago, satu Kantong
per file, ke dompet IDR. PDF dibaca di browser; teksnya harus asli dari aplikasi
(bukan hasil pindai atau foto) dan tidak terkunci kata sandi. Unduh tanpa filter:
saldo setiap baris harus sama dengan saldo baris sebelumnya ditambah jumlahnya,
jadi PDF yang hanya berisi uang masuk, atau yang halamannya hilang, ditolak.
Jenis transaksi diambil dari kolom Rincian Transaksi:

- *Tambah/Tarik Uang Kantong* (pindah uang antar Kantong), *Pemindahan dari Akun
  Lama*, *Isi Saldo Dompet Digital*, dan *Transfer Masuk/Keluar* dari/ke
  rekening atas nama pemilik (nama di bagian atas PDF) menjadi perpindahan dana.
- *Transfer Keluar* ke nama orang lain menjadi pengeluaran, dan *Transfer Masuk*
  dari nama orang lain menjadi pemasukan.
- Uang masuk dari e-wallet atau marketplace (mis. ShopeePay, Tokopedia) bisa
  berupa penarikan saldo sendiri, jadi tetap **Perlu dicek**. Begitu juga nama
  yang disamarkan bank (mis. `ZXXXXXXXXX3`) bila sisa hurufnya tidak cocok
  dengan nama pemilik.
- *Pembayaran dengan Jago Pay* dan *Transaksi POS* (kartu) menjadi pengeluaran.
  GO-FOOD masuk Makan & minum; merchant lain mengikuti aturan kategori.
- *Transaksi POS* yang masuk dengan ID dan nominal sama dengan pembelian di file
  yang sama menjadi pemasukan Pengembalian dana. *Bonus* menjadi Cashback.
- Jenis lain, atau arah nominal yang bertentangan dengan jenisnya, tetap
  **Perlu dicek**.

Baris Jago disimpan sebagai fakta bank format umum, jadi format cadangan tidak
berubah. Mengimpor PDF yang sama atau periode yang tumpang tindih menandai baris
yang sudah ada sebagai duplikat.

**CSV / Excel umum:**

1. Pilih file CSV, TSV, atau XLSX. Sesuaikan pemisah CSV, worksheet, dan baris
   judul kolom bila diperlukan.
2. Petakan tanggal, keterangan, nominal bertanda positif/negatif **atau** kolom
   debit dan kredit terpisah, serta **saldo setelah setiap mutasi**. Saldo bank
   yang sebenarnya wajib tersedia; aplikasi tidak mengarangnya.
3. Pilih format tanggal, pemisah desimal, dan urutan transaksi. Referensi dan
   kolom mata uang dapat dipetakan bila tersedia. Konfirmasi bahwa mata uang
   file sama dengan dompet tujuan.
4. Buat pratinjau. Tanggal atau nominal tidak valid, mata uang berbeda,
   pecahan berlebih, formula, atau rangkaian saldo yang tidak konsisten ditolak.
5. Tinjau pilihan transaksi, kategori, kemungkinan duplikasi, saldo awal, dan
   proyeksi saldo sebelum menekan **Simpan**. Mengubah pemetaan membatalkan
   pratinjau lama. Memilih file saja belum menyimpan transaksi.

Pada impor umum, debit dan kredit langsung masuk ke saldo. Keterangan yang
belum memastikan jenis transaksi ditandai **Perlu dicek**. Misalnya, kamu
bisa menandai `FAST FOOD RESTAURANT` sebagai pengeluaran jika itu memang
pembelian makanan. Keterangan operasi yang dikenali secara utuh, seperti
`GIDEN HAVALE` pada debit, tetap bisa dikenali otomatis.

Pada pembaca Ziraat otomatis, penanda bank yang dikenali mengikuti pemetaan
yang ditetapkan. Setor ATM menjadi pemasukan, tarik ATM menjadi pengeluaran,
PREPAID masuk menjadi Cashback, dan pokok transfer menjadi perpindahan dana.
Pembayaran kartu yang tujuannya belum diketahui memakai kategori Belanja.
Tarik tunai di ATM bank lain (`YURTİÇİ ATM P.Ç.`) dan tanpa kartu lewat QR
(`ATM QR ILE PARA ÇEKME`) ikut dikenali. Komisi dan BSMV ATM bank lain, yang
dicatat bank sebagai baris terpisah, menjadi pengeluaran Biaya bank.
Refund pembelian kartu (`SATIŞ IADE` bersama nomor kartu) yang masuk menjadi
pemasukan Pengembalian dana; refund lain tetap perlu dicek. Pokok transfer
yang keterangannya terpotong bank dikenali dari baris biaya transfer bernomor
fiş dan bertanggal sama, lalu dicatat sebagai perpindahan dana.

Filter dan kategori massal pada pratinjau berlaku untuk baris yang terlihat.
Tombol **Simpan** menyertakan semua baris yang masih dipilih, termasuk yang
tersembunyi oleh filter atau halaman lain. Kesamaan saldo akhir saja belum
membuktikan bahwa seluruh histori rekening sudah lengkap.

Jika impor Excel lama menyimpan `Caf&#233;` dan file asli menampilkan `Café`,
bandingkan tanggal, nominal, saldo setelah mutasi, dan referensinya. Saat Uangku
meminta keputusan untuk baris yang sama, pilih **Pertahankan catatan** agar
mutasi tersebut hanya dihitung sekali.

### Merapikan kategori

Buka **Transaksi → Isi kategori otomatis** untuk meninjau kategori kosong
lintas periode dan mata uang. Kecocokan jelas dipilih otomatis; saran ambigu
menunggu pilihan. Kategori manual, nominal, tanggal, dan fakta bank dipertahankan.
Konfirmasi jenis transaksi tetap merupakan keputusan tersendiri.

Gunakan **Kelola kategori** untuk mengubah pilihan dan aturan kata kunci.
Menghapus kategori dari pilihan tidak menghapus nama kategori pada histori.
**Cadangkan semuanya** menyertakan kategori yang belum dipakai dan aturan dalam
urutan tersimpan. **Kelola kategori** juga menyediakan ekspor dan impor khusus
pengaturan kategori.

## Penyimpanan dan cadangan

Catatan tersimpan di `localStorage` browser dan perangkat yang sedang dipakai.
Aplikasi tidak memiliki akun pengguna, penyimpanan server, atau sinkronisasi
antarperangkat. File mutasi dibaca di browser, tanpa dikirim ke server aplikasi.

- Browser, perangkat, mode privat, protokol, domain, dan port yang berbeda
  mempunyai penyimpanan terpisah.
- **Cadangkan semuanya** mengunduh satu file JSON berisi dompet, transaksi,
  fakta sumber, pengaturan mata uang, daftar kategori, dan aturan kategori.
- Untuk memulihkannya, pilih **Pulihkan cadangan**, periksa jumlah tiap jenis
  data, lalu pilih **Pulihkan semuanya**. Catatan dan pengaturan kategori di
  browser tujuan akan diganti bersama.
- **Cadangkan transaksi saja** memakai format keuangan sebelumnya. Memulihkan
  file lama ini mengganti catatan keuangan dan mempertahankan pengaturan
  kategori di browser tujuan.
- Batas data keuangan adalah **8 MiB** dan batas pengaturan kategori **128 KiB**.
  Ruang yang tersedia untuk pemulihan juga mengikuti kuota penyimpanan browser.
- Pembaruan situs tidak memindahkan catatan dari alamat lokal ke alamat publik.
  ZIP source aplikasi juga tidak otomatis menyertakan data browser.

### Tambah ke Layar Utama

Uangku bisa dipasang seperti aplikasi. Di iPhone, buka situsnya di Safari, pilih
**Bagikan → Tambah ke Layar Utama**. Di Android, buka di Chrome, pilih menu
**⋮ → Instal aplikasi** (atau **Tambahkan ke layar utama**).

**Penting untuk iPhone:** aplikasi yang dibuka dari Layar Utama punya
penyimpanan **terpisah dari Safari**. Catatan yang sudah ada di Safari tidak ikut
pindah, jadi aplikasinya akan tampak kosong; datamu tidak hilang. Untuk
memindahkannya:

1. Di Safari, pilih **Cadangkan semuanya** dan simpan file JSON-nya.
2. Buka Uangku dari ikon di Layar Utama.
3. Pilih **Pulihkan cadangan**, pilih file tadi, periksa jumlahnya, lalu
   **Pulihkan semuanya**.

Setelah itu, catat di salah satu tempat saja (Safari atau Layar Utama) supaya
catatan tidak terpecah di dua penyimpanan.

Jangan masukkan mutasi bank asli, cadangan pribadi, kredensial, atau data
keuangan nyata ke repository publik. Pengujian menggunakan fixture sintetis.

## Pengembangan lokal

Prasyarat: **Node.js 22.12 atau lebih baru** dan npm. Workflow memakai Node.js 24.
Jalankan dari direktori proyek:

```sh
npm ci
npm run dev
```

Buka <http://127.0.0.1:4180>. Pada PC yang menyertakan launcher lokal,
`Jalankan-Uangku.cmd` menyediakan cara lain untuk menjalankan aplikasi.
Catatan prosedur lokal ada di [LOCAL_WORKFLOW.md](LOCAL_WORKFLOW.md).

```sh
npm test
npm run build
npm run preview
```

`npm test` menjalankan tes unit. Build mencakup pemeriksaan TypeScript dan
menghasilkan situs statis di `dist/`; preview juga memakai port 4180.
Gunakan server HTTP untuk perilaku penyimpanan browser yang konsisten.

Pengujian browser di `tests/` memerlukan Python, Playwright, dan Chromium.
Setiap skrip menerima direktori bukti, misalnya:

```sh
python tests/browser_smoke.py --output ../work/browser-smoke
```

Gunakan `UANGKU_TEST_URL` untuk server pengujian selain alamat lokal bawaan.
Fixture pengujian tidak memakai data keuangan pengguna.

## Publikasi dengan GitHub Pages

Workflow **Periksa Uangku** menjalankan tes unit, build, regresi browser,
pemeriksaan sumber/backfill, UX, dan performa. Workflow **Publikasikan Uangku**
memakai gate tersebut sebelum membangun dan menerbitkan `dist/` ke Pages.
Publikasi dipicu oleh push ke `main` atau pemicu manual dengan konfirmasi
rilis. Job deployment hanya berjalan setelah pemeriksaan berhasil.

Situs memakai base relatif agar dapat dihosting pada subpath `/uangku/`.
Lihat hasil workflow pada GitHub Actions untuk status pemeriksaan dan
deployment yang sebenarnya; hasil lokal saja tidak membuktikan CI eksternal
atau publikasi sudah berhasil. Data pribadi tetap berada di browser pengguna.
