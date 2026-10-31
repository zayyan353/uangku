# Uangku

Pencatat keuangan pribadi untuk rekening dan e-wallet, dengan saldo, pemasukan,
pengeluaran, transfer, impor mutasi, serta kategori yang bisa disesuaikan.

- **Alamat publik:** <https://zayyan353.github.io/uangku/>
- **Alamat pengembangan lokal:** <http://127.0.0.1:4180>

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
- **Impor:** pembaca otomatis XLSX Ziraat TRY/TL dan pemetaan kolom CSV, TSV,
  atau XLSX umum untuk dompet aktif dalam mata uang yang didukung.
- **Fakta sumber:** keterangan, tanggal, nominal, dan saldo bank disimpan
  terpisah dari anotasi pengguna. Pratinjau memeriksa saldo antarbaris, impor
  berulang, dan kemungkinan tumpang tindih dengan catatan yang sudah ada.
  Pelengkapan histori dan backfill memerlukan peninjauan bukti serta saldo awal.
- **Penyimpanan:** tab usang ditolak agar tidak menimpa data terbaru. Kegagalan
  menyimpan menyediakan pemulihan draft dan percobaan ulang. Cadangkan dan
  pulihkan catatan melalui JSON.

Aplikasi belum terhubung ke API bank dan tidak menyinkronkan rekening otomatis.
PDF dan XLS lama belum didukung. Pembacaan format umum memakai pilihan kolom
yang dikonfirmasi pengguna, bukan janji mendukung seluruh format ekspor bank.

## Mulai memakai

1. Tampilan awal memakai data contoh fiktif. Pilih **Mulai pakai data sendiri**
   lalu konfirmasi **Mulai dari kosong** untuk menggunakan catatan pribadi.
2. Buka **Kelola mata uang** bila mata uang yang dibutuhkan belum terlihat.
   Buka **Dompet** untuk menambah atau menyesuaikan rekening dan e-wallet.
3. Isi saldo awal sebelum transaksi pertama yang ingin dicatat. Jika mulai
   mencatat dari hari ini, gunakan saldo hari ini dan catat transaksi berikutnya.
4. Gunakan **Catat transaksi**, **Pindah uang**, atau **Impor mutasi**.
5. Unduh **Cadangkan data** sebelum mengganti browser, perangkat, atau alamat
   aplikasi, serta sebelum mengganti catatan lewat **Pulihkan cadangan**.

### Impor mutasi

Pilih dompet aktif dengan mata uang yang sesuai. File maksimal 8 MiB dan harus
mewakili satu rekening dalam satu mata uang; impor tidak menukar mata uang.

**Ziraat otomatis:** pilih mode Ziraat untuk XLSX rekening TRY/TL dengan kolom
`Tarih`, `Fiş No`, `Açıklama`, `İşlem Tutarı`, dan `Bakiye`.

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

Jenis yang belum mempunyai bukti cukup disimpan sebagai **Perlu dicek**:
nominalnya tetap memengaruhi saldo, tetapi belum dihitung sebagai pemasukan
atau pengeluaran. Penanda bank yang sudah dikenali mengikuti pemetaan yang
ditetapkan: setor ATM menjadi pemasukan, tarik ATM menjadi pengeluaran,
PREPAID masuk menjadi Cashback, dan pokok transfer tetap perpindahan dana.
Pembayaran kartu yang tujuannya belum diketahui memakai kategori Belanja
umum, tanpa menebak barang atau layanan yang dibeli.

Filter dan kategori massal pada pratinjau berlaku untuk baris yang terlihat.
Tombol **Simpan** menyertakan semua baris yang masih dipilih, termasuk yang
tersembunyi oleh filter atau halaman lain. Kesamaan saldo akhir saja belum
membuktikan bahwa seluruh histori rekening sudah lengkap.

### Merapikan kategori

Buka **Transaksi → Isi kategori otomatis** untuk meninjau kategori kosong
lintas periode dan mata uang. Kecocokan jelas dipilih otomatis; saran ambigu
menunggu pilihan. Kategori manual, nominal, tanggal, dan fakta bank dipertahankan.
Konfirmasi jenis transaksi tetap merupakan keputusan tersendiri.

Gunakan **Kelola kategori** untuk mengubah pilihan dan aturan kata kunci.
Menghapus kategori dari pilihan tidak menghapus nama kategori pada histori.
Pengaturan kategori mempunyai **Ekspor/Impor pengaturan kategori** tersendiri;
cadangan transaksi membawa kategori yang digunakan pada catatannya.

## Penyimpanan dan cadangan

Catatan tersimpan di `localStorage` browser dan perangkat yang sedang dipakai.
Aplikasi tidak memiliki akun pengguna, penyimpanan server, atau sinkronisasi
antarperangkat. File mutasi dibaca di browser, tanpa dikirim ke server aplikasi.

- Browser, perangkat, mode privat, protokol, domain, dan port yang berbeda
  mempunyai penyimpanan terpisah.
- Menghapus data situs dapat menghilangkan catatan. Cadangan JSON menyertakan
  transaksi, dompet, fakta sumber, dan pengaturan mata uang yang tersimpan.
- **Pulihkan cadangan** mengganti catatan setelah konfirmasi. Cadangkan catatan
  yang masih diperlukan sebelum melanjutkan.
- Batas data logis tetap **8 MiB**; kuota penyimpanan browser merupakan batas
  terpisah. Penolakan kapasitas tidak mengganti data lama.
- Pembaruan situs tidak memindahkan catatan dari alamat lokal ke alamat publik.
  ZIP source aplikasi juga tidak otomatis menyertakan data browser.

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
