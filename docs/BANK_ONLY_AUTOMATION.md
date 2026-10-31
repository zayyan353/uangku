# Pembukuan rekening dan e-wallet

Fitur ini mengikuti keputusan pengguna: cash tidak dibukukan. Website online belum diubah.

- Dompet baru, pilihan transaksi/impor, total saldo aktif, laporan dan antrean perapihan hanya memakai rekening bank dan e-wallet, dalam semua mata uang.
- Definisi cash kosong tanpa rujukan dihapus melalui penyimpanan terkoordinasi. Histori cash yang masih memiliki saldo, transaksi atau rujukan sumber disimpan di **Dompet → Lihat arsip cash lama**, baca saja, dan tetap ikut cadangan.
- Saat impor, **tarik ATM menjadi pengeluaran** dan **setor ATM menjadi pemasukan**, sesuai keputusan pengguna untuk mengikuti arus uang rekening. Pokok transfer bank tetap **Perpindahan dana rekening**, di luar pemasukan/belanja. Tidak ada dompet/pasangan cash yang dibuat.
- PREPAID yang masuk langsung menjadi pemasukan kategori **Cashback**. Biaya transfer negatif yang dikenali tetap pengeluaran **Biaya bank**. Nominal berlawanan atau bukti ambigu lainnya tidak dipastikan secara paksa.
- Catatan lama tidak diubah jenisnya saat aplikasi dibuka. Gunakan **Transaksi → Isi kategori otomatis → Terapkan** untuk mengisi kategori kosong dan mengonfirmasi mutasi bank lama yang masih Perlu dicek. Pratinjau menjelaskan perubahan jenis. Kategori manual dipertahankan. Interpretasi lama berupa movement yang secara jelas merupakan tarik/setor ATM dapat diubah melalui Apply; jenis manual income/expense dan transfer berpasangan dipertahankan.
- Jika kedua sisi transfer sudah diimpor di rekening yang sama-sama dipantau, pilih pasangan yang benar di formulir transfer. Pasangan memerlukan keputusan pengguna; kepemilikan penerima tidak ditebak.

Aturan kategori tetap dapat disunting, ditambah, dihapus atau diubah menjadi saran. Pembaruan paket v4 melindungi aturan pribadi serta kategori yang telah diarsipkan. Fakta bank dan fingerprint tetap terpisah dari anotasi pengguna.

Backup polos yang memakai movement menggunakan versi 3. Backup sumber dengan movement memakai versi 2 codec table-tuples-v4. Backup lama tetap didukung; versi aplikasi lama yang belum mengenali format baru tidak boleh digunakan untuk memulihkan backup baru ini. Kapasitas logis tetap 8 MiB dan file restore mentah 32 MiB; batas kuota browser terpisah.

Verifikasi kandidat ATM terbaru: 1.110 tes unit pada 37 file, 77 skenario browser terkait, typecheck dan build lulus. Browser: Chromium 156 pada Windows dengan emulasi mobile. Identitas build dan bukti terbaru ada di ATM_CASHFLOW_REPORT.json. BANK_ONLY_AUTOMATION_REPORT.json menyimpan hasil checkpoint sebelumnya. Hasil awal yang gagal tetap disimpan bersama alasan koreksi fixture; tiga masalah yang ditemukan saat review telah diperbaiki dan diuji.

Simulasi cadangan pengguna pada checkpoint 14139db dilakukan hanya di memori (hasil historis): 378 transaksi tetap utuh, 363 kecocokan otomatis, 187 jenis mutasi yang dikenali dapat dikonfirmasi, dan tiga definisi cash kosong dapat dihapus. Seluruh saldo rekening, fakta/link sumber, nominal bertanda, ID, tanggal, catatan dan fingerprint tetap sama. File asli serta data browser pengguna tidak ditulis.

Belum ada push, deployment, migrasi data asli atau ZIP source baru. Checkpoint Git lokal dipakai untuk tahap ini, sesuai keputusan pengguna untuk menunda pengemasan.

Penerapan kategori dan aturan ATM terbaru ke catatan browser asli belum dilakukan. Computer Use dihentikan karena URL browser Windows tidak dapat diverifikasi dengan aman. Tidak ada bypass atau penyimpanan transaksi asli; seluruh perbandingan saldo/duplikasi terbaru berasal dari data sintetis.
