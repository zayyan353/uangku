# Status Uangku

Diperbarui: 9 November 2026 (MW-02). Status terkini yang pasti ada di GitHub Actions.

## Versi live

- Situs: <https://zayyan353.github.io/uangku/>, diterbitkan otomatis dari `main`
  lewat workflow **Publikasikan Uangku** setelah gate **Periksa Uangku** hijau.
- Saat ditulis: publikasi terakhir yang selesai sukses adalah `6b59091` (run #16);
  run untuk `eb87114` (MW-01) masih berjalan. Cek Actions untuk versi sekarang.

## Tes (dijalankan pada `eb87114`)

- `npm test`: 48 file, 1.533 tes unit lulus, 0 gagal.
- `npm run build`: lulus (cek TypeScript + build satu `index.html`).
- Tes browser Playwright (`tests/*_browser.py`) hanya jalan di CI, tidak di `npm test`.
  `full_backup_browser.py` belum masuk CI (MW-03b).

## Batasan utama

- Data hanya di browser (`localStorage`); tidak ada akun, server, atau sinkronisasi.
  Cadangkan lewat tombol **Cadangkan semuanya**.
- Impor: XLSX Ziraat TRY/TL, PDF riwayat transaksi Bank Jago (IDR), dan
  CSV/TSV/XLSX umum dengan kolom saldo berjalan. PDF bank lain, XLS lama, dan
  file tanpa saldo belum didukung. Impor tidak menukar mata uang.
- Batas: file impor 8 MiB, data keuangan 8 MiB, pengaturan kategori 128 KiB.
- Fakta sumber, tanggal, dan asosiasi legacy yang hilang tidak ditebak.
- Belum diuji di Safari/iOS/Android fisik maupun screen reader manual.

Catatan pemulihan lama: [docs/archive/RECOVERY_STATUS.json](docs/archive/RECOVERY_STATUS.json)
(historis, mencatat branch `local-rebuild`; bukan bukti kondisi sekarang).
