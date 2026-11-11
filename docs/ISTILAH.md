# Uangku — Daftar istilah

Dibuat 11 November 2026 untuk butir 5.11.4 `KERANGKA_HALAMAN.md`. Satu hal,
satu nama. Teks baru di aplikasi memakai kolom "Dipakai"; kolom "Tidak dipakai
lagi" adalah nama lama yang sudah diganti di teks yang tampil ke pengguna.

## Jenis catatan

| Dipakai | Artinya | Tidak dipakai lagi |
|---|---|---|
| Pengeluaran | Uang keluar untuk belanja atau tagihan | |
| Pemasukan | Uang masuk sebagai penghasilan | |
| Transfer | Pindah uang antara dua dompet sendiri | |
| Perpindahan dana | Uang masuk atau keluar satu rekening yang bukan belanja maupun penghasilan | Perpindahan dana rekening |
| Penyesuaian | Catatan selisih yang dibuat oleh Cek saldo | |
| Cek saldo | Tindakan mencocokkan catatan dengan saldo sebenarnya hari ini (tab, tombol, dan judul form) | Cocokkan saldo |

## Status

| Dipakai | Artinya |
|---|---|
| Perlu dicek | Jenis satu catatan impor belum dikonfirmasi |
| Perlu dirapikan | Antrean catatan yang jenisnya perlu dicek **atau** kategorinya belum diisi |

Keduanya sengaja dibedakan: "Perlu dicek" adalah keadaan satu catatan,
"Perlu dirapikan" adalah daftar kerjanya.

## Sumber dari bank

| Dipakai | Artinya | Tidak dipakai lagi |
|---|---|---|
| Mutasi bank / data bank | Baris asli dari file bank, disimpan terpisah dari catatan yang bisa diubah | fakta bank, fakta sumber |
| Isi file | Seluruh baris sebuah file mutasi yang disimpan | fakta file |
| Catatan impor lama | Catatan dari impor versi lama yang mutasi aslinya tidak tersimpan | legacy |
| Melengkapi mutasi lama | Menambahkan mutasi yang lebih tua dari catatan dompet | backfill |
| Titik awal saldo | Saldo dan tanggal tempat hitungan dompet berangkat | batas saldo awal, baseline, anchor, rebase |
| Kode pengenal mutasi | Penanda untuk mengenali mutasi yang sama saat diimpor ulang | fingerprint |
| Hari ini | Hari menurut jam dan zona waktu perangkat | |

## Yang belum diseragamkan

- Pesan pemeriksaan integritas di `src/lib/sourceModel.ts`,
  `transferPostings.ts`, dan `sourceCodec.ts` masih memakai "baseline",
  "anchor", "witness", dan "fingerprint". Pesan itu muncul hanya bila data
  tersimpan rusak atau tidak konsisten, dan ditujukan untuk penelusuran.
- Nama kode (variabel, kunci JSON, `data-testid`) tidak diubah.
- Lencana "Perlu dicek" pada baris dan antrean "Perlu dirapikan" tetap dua
  nama, seperti dijelaskan di atas.
