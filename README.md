# Uangku

Pencatat uang pribadi untuk cash, rekening, dan e-wallet dalam rupiah, lira Turki, dan dolar AS. Mulai dari saldo hari ini, catat secukupnya, lalu rapikan kategorinya belakangan.

## Yang bisa dipakai

- **Dompet terpisah:** saldo cash dan rekening tetap jelas; setiap dompet punya satu mata uang.
- **Ringkasan per mata uang:** saldo, pemasukan, dan pengeluaran IDR, TRY/TL, serta USD ditampilkan terpisah.
- **Catat cepat:** pemasukan, pengeluaran, dan kategori “Belum dikategorikan”.
- **Pindah uang:** transfer antar dompet, termasuk tarik tunai. Transfer tidak dihitung sebagai belanja; biaya transfer dicatat sebagai pengeluaran.
- **Kurs per transaksi:** isi kurs manual atau nominal yang benar-benar diterima, lalu konfirmasi kursnya. Kurs historis disimpan bersama transaksi.
- **Impor mutasi Ziraat XLSX:** pratinjau transaksi, pemeriksaan saldo antarbaris, dan pemeriksaan impor berulang.
- **Perlu dicek:** transaksi yang jenisnya belum jelas tetap memengaruhi saldo, tetapi belum dihitung sebagai pemasukan atau pengeluaran. Hasil cek dapat disimpan setelah jenis atau tujuan transfer dipastikan.
- **Cek saldo:** catat penyesuaian yang terlihat jika uang fisik atau saldo sebenarnya berbeda dari catatan.
- **Cadangkan dan pulihkan:** unduh catatan sebagai JSON dan pulihkan lewat aplikasi.

Versi awal belum terhubung ke API bank dan belum melakukan sinkronisasi rekening otomatis. Impor saat ini khusus **XLSX Ziraat rekening TL** dengan kolom `Tarih`, `Fiş No`, `Açıklama`, `İşlem Tutarı`, dan `Bakiye`. CSV, PDF, serta format bank lain belum didukung; dompet lainnya bisa dicatat manual.

## Mulai pakai

1. Buka aplikasi. Tampilan awal memakai **data contoh fiktif**, sehingga fiturnya bisa dicoba tanpa memasukkan data keuangan asli.
2. Pilih **Mulai pakai data sendiri**, lalu konfirmasi **Mulai dari kosong**. Data contoh akan diganti dengan dompet tanpa transaksi.
3. Buka **Dompet**. Dompet awal mencakup BCA, BCA Digital, BRI, GoPay, DANA, Bank Jago, SeaBank, ShopeePay, Ziraat, Papara, dan cash IDR/TRY/USD. Tambah atau sesuaikan dompet sesuai kebutuhan.
4. Isi saldo awal sebelum transaksi pertama yang ingin dicatat. Untuk memulai dari hari ini, gunakan saldo hari ini dan catat transaksi berikutnya. Untuk mengimpor riwayat mutasi, gunakan saldo sebelum transaksi pertama dalam file.
5. Gunakan **Catat transaksi** untuk belanja atau pemasukan, dan **Pindah uang** untuk transfer, top up, tarik tunai, atau penukaran mata uang.
6. Unduh **Cadangkan data** secara berkala, terutama sebelum mengganti perangkat, browser, alamat aplikasi, atau menghapus data browser.

### Impor Excel Ziraat

1. Pastikan mode contoh sudah diganti dengan data sendiri.
2. Buka **Impor mutasi**, pilih dompet Ziraat dengan mata uang TRY/TL, lalu pilih file `.xlsx` dari bank. Ukuran maksimal 8 MB.
3. Periksa periode, nominal, dan baris yang dipilih. Kemungkinan transaksi yang sudah diimpor tidak dipilih ulang.
4. Untuk dompet yang belum memiliki aktivitas, tersedia pilihan memakai saldo awal yang dihitung dari file. Ini mengganti saldo awal dompet, bukan menambahkan pemasukan.
5. Simpan hasil impor. Uang masuk dan kemungkinan transfer disimpan sebagai **Perlu dicek** sampai jenisnya dikonfirmasi.
6. Buka **Transaksi**, lalu gunakan **Cek** untuk menyelesaikan transaksi yang belum jelas. Cocokkan perpindahan ke dompet sendiri agar dua sisi transfer tidak dihitung dua kali.

Kategori boleh dibereskan belakangan. Pemeriksaan saldo file memastikan konsistensi antarbaris; hasilnya tidak membuktikan bahwa seluruh riwayat rekening sudah tercakup. Untuk saldo akhir yang sesuai mutasi, pastikan periode, saldo awal, dan seluruh transaksi yang relevan ikut dicatat.

Impor berikutnya dapat menambahkan transaksi baru dan melewati transaksi yang sudah ada. Riwayat sebelum batas awal catatan akan ditolak agar saldo awal tidak terhitung dua kali. Untuk memperluas riwayat ke masa yang lebih lama, buat dompet kosong dan impor periode lengkap yang diinginkan. Simpan cadangan sebelum mengganti dompet; hindari menghitung kedua dompet sebagai rekening yang sama.

## Penyimpanan dan cadangan

Catatan tersimpan di `localStorage` **browser dan perangkat yang sedang dipakai**. Aplikasi tidak memiliki akun pengguna, penyimpanan server, atau sinkronisasi antarperangkat.

- Browser lain, perangkat lain, mode privat, dan alamat situs yang berbeda mempunyai penyimpanan terpisah. Perubahan protokol atau port juga dapat membuat catatan yang berbeda.
- Menghapus data situs atau memakai browser yang membatasi penyimpanan bisa menghilangkan catatan. Simpan cadangan JSON di tempat pribadi.
- **Pulihkan cadangan** menggantikan catatan saat ini setelah konfirmasi. Cadangkan catatan lama terlebih dahulu jika masih diperlukan.
- Pembaruan kode dan publikasi GitHub Pages tidak memindahkan catatan dari browser lama ke browser baru. Gunakan cadangan untuk memindahkan data.
- File mutasi dibaca di browser; isinya tidak dikirim ke bank atau server aplikasi. Nominal dan keterangannya menjadi bagian dari catatan lokal setelah impor.

**Jangan masukkan mutasi bank asli, cadangan pribadi, nomor rekening, atau data keuangan nyata ke repository publik.** Data contoh dan fixture pengujian di proyek ini bersifat fiktif. Berkas mutasi dan cadangan sudah dicakup `.gitignore`; tetap periksa daftar file sebelum commit.

## Menjalankan proyek

Prasyarat: **Node.js 22.12 atau lebih baru** dan npm. Workflow GitHub memakai Node.js 24.

```sh
npm ci
npm run dev
```

Jalankan perintah dari direktori proyek. Di environment cloud `/workspace`, cache npm dapat diarahkan ke direktori yang bisa ditulis:

```sh
npm ci --cache /workspace/.npm-cache
```

Perintah lain:

```sh
npm test
npm run build
npm run preview
```

`npm test` menjalankan pengujian pembukuan, penyimpanan, dan impor menggunakan data sintetis. `npm run build` menjalankan pemeriksaan TypeScript dan membuat keluaran produksi di `dist/`. Hasil build disiapkan sebagai halaman mandiri; gunakan server preview atau hosting untuk penyimpanan browser yang konsisten. Salinan HTML yang dibuka sebagai file lokal dapat memiliki perilaku penyimpanan berbeda antarbrowser. Cadangkan data sebelum berpindah alamat atau salinan file.

### Pemeriksaan browser opsional

Tersedia pemeriksaan desktop dan ponsel di `tests/browser_smoke.py`. Pemeriksaan ini memerlukan Python, paket Python Playwright, dan Chromium. Jalankan server pengembangan terlebih dahulu, lalu dari terminal lain:

```sh
python tests/browser_smoke.py
```

Gunakan `UANGKU_TEST_URL` untuk menguji alamat server yang berbeda. Skrip membuat transaksi dan file mutasi sintetis; mutasi asli tidak digunakan atau dimasukkan ke repository.

## Publikasi dengan GitHub Pages

Proyek menyediakan workflow untuk publikasi otomatis; keberadaan workflow ini tidak berarti repository remote atau situs sudah dibuat.

1. Simpan proyek dalam repository GitHub terpisah dengan branch utama `main`.
2. Di repository tersebut, buka **Settings → Pages → Build and deployment**, lalu pilih **GitHub Actions** sebagai Source.
3. Push kode ke `main`, atau jalankan workflow **Publikasikan Uangku** secara manual dari tab **Actions**.
4. Workflow memasang dependency dari lockfile, menjalankan tes dan build, lalu mengirim folder `dist/` ke GitHub Pages.
5. Tunggu deployment berhasil. GitHub menampilkan alamat situs pada hasil deployment dan halaman Settings → Pages.

Workflow **Periksa Uangku** juga menjalankan tes dan build pada push ke `main` serta pull request. Izin atau ketersediaan Pages mengikuti pengaturan dan paket repository GitHub.

Kode aplikasi dapat dipublikasikan tanpa menyertakan catatan pribadi. Data keuangan tetap berada di browser masing-masing pengguna, termasuk saat aplikasinya dihosting di GitHub Pages.
