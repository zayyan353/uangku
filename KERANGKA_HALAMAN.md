# Uangku — Kerangka Halaman

Dibuat: 11 November 2026, commit `2fb3179` (main). Belum ada butir yang dikerjakan.

Peta isi aplikasi per halaman. **Bab** = halaman, **sub-bab** = bagian halaman,
**butir** (mis. 1.3.1) = bagian terkecil. Tiap butir mencatat isinya sekarang dan
apa yang bisa dibuat lebih baik. Daftar ini melengkapi `MICRO_TASKS.md` (yang
disusun per topik), tidak menggantikannya.

| Bab | Halaman | Sub-bab | Butir |
|---|---|---|---|
| 1 | Ringkasan | 10 | 25 |
| 2 | Dompet | 6 | 20 |
| 3 | Transaksi | 14 | 55 |
| 4 | Impor mutasi | 9 | 40 |
| 5 | Bagian bersama (tampil di semua halaman) | 11 | 31 |

## Dasar daftar ini

- **Dibaca:** `src/App.tsx` dan semua file di `src/components/`.
- **Dilihat:** build produksi commit di atas (`npm run preview`), desktop 1440px
  dan HP 390px, tema terang, profil browser baru. Data: contoh bawaan, lalu
  "Mulai dari kosong" + satu CSV sintetis 8 baris untuk alur impor umum.
- **Diukur:** tiga hal di alur impor HP (4.5.4, 4.5.7, 4.8.7) lewat Playwright.
- **Belum dilihat:** tema gelap, dompet arsip, arsip cash lama, transfer beda
  mata uang, impor Ziraat, impor yang tumpang tindih, masalah simpan, Firefox
  dan Safari. Butir di area itu baru berdasarkan kode dan diberi keterangan.
- **Baseline:** `npm test` 57 file / 1.753 tes lulus, `npm run build` lulus.
  Tes browser (`tests/*_browser.py`) tidak dijalankan untuk daftar ini.

## Tanda

- **[bug]** rusak atau keliru, sudah dilihat atau diukur pada build ini.
- **[cek]** dugaan dari membaca kode; pastikan dulu sebelum mengubah.
- **[keputusan]** butuh pilihan pemilik; jangan ditebak, lewati sampai diputuskan.
- **[fitur]** tambahan kecil, bukan perbaikan; boleh dilewati.
- Tanpa tanda: polesan tampilan, teks, atau alur yang arahnya sudah jelas.
- **→ 5.4.3** berarti pekerjaannya dilakukan di butir yang ditunjuk.

## Cara pakai

- Kerjakan berurutan: 1.1.1 → 1.1.2 → … → 1.2.1 → … sampai 5.11.4.
- Satu butir per branch/PR, aturannya sama dengan MW di `AGENTS.md`:
  `npm test` dan `npm run build` lulus, tes browser yang relevan dijalankan
  untuk perubahan UI, lalu centang butirnya di file ini pada commit yang sama.
- **Pemeriksaan baku** sebelum mengerjakan satu butir:
  1. lihat bagiannya di desktop 1440px dan HP 390px, tema terang dan gelap;
  2. coba dengan keyboard (Tab, Enter, Escape) dan pastikan fokus terlihat;
  3. coba keadaan kosong, teks/nominal panjang, dan keadaan galat;
  4. baru kerjakan usulnya. Usul yang ternyata tidak relevan dicoret dengan
     catatan singkat, bukan dihapus.
- Butir "Belum ada temuan" tetap dilewati dengan pemeriksaan baku; kalau
  bersih, centang tanpa perubahan kode.
- Banyak teks dan `aria-label` dipakai tes browser, mis. "Cadangkan transaksi
  saja" (8 file tes), "Cari transaksi" (7), "Rincian nominal" (3), "Tema
  tampilan" (3). Mengubah teks berarti memperbarui tesnya di PR yang sama.

Template prompt (salin, ganti nomor):

```
Repo: zayyan353/uangku. Kerjakan HANYA butir X.Y.Z dari KERANGKA_HALAMAN.md.
Lakukan pemeriksaan baku dulu, lalu kerjakan usul di butir itu.
Jangan ubah bagian lain kecuali wajib. Jalankan npm test dan npm run build,
serta tes browser yang relevan. Kalau lulus, commit dengan pesan
"X.Y.Z: <judul>", centang butirnya, lalu buka PR ke main.
```

---

## Bab 1 — Ringkasan

Bagian bersama yang ikut tampil: bar atas (5.2), banner (5.3), bilah mata uang
dan bulan (5.4).

### 1.1 Kepala halaman

- [x] **1.1.1 Sapaan**
  *Isi:* tulisan kecil "SEDIKIT DICATAT, BANYAK TERBANTU", judul "Halo, Zayyan. ✳", subjudul.
  - **[keputusan]** Nama "Zayyan" dan avatar "Z" ditulis mati di kode
    (`App.tsx:527`, `AppNavigation.tsx`), padahal situsnya publik. Pilih: nama
    panggilan jadi pengaturan (tersimpan di preferensi browser) atau sapaan netral.
  - *Dilewati 11 Nov 2026: menunggu keputusan pemilik.*
  - *Dikerjakan 11 Nov 2026 (pemilik menyetujui semua usul).* Nama "Zayyan"
    dan avatar "Z" tidak lagi ditulis mati. Menu akun punya kolom "Nama
    panggilan" (maksimal 24 karakter) yang disimpan di browser ini saja,
    terpisah dari catatan dan tidak ikut cadangan. Kosong: sapaan "Halo." dan
    avatar "U"; terisi: "Halo, Sari Dewi." dan huruf awalnya. Dicoba dengan
    keyboard, muat ulang, dikosongkan, dan nama terpanjang di desktop dan HP,
    terang dan gelap (judul kini membungkus, tidak meluber). Tes unit baru
    `nickname.test.ts` (`npm test` 1.759 lulus); `theme_browser.py` 21/21,
    `category_browser.py` 25/25, smoke 39 skenario, ux lulus. Kolom ini belum
    punya tes browser sendiri.

- [x] **1.1.2 Tombol Pindah uang dan Catat transaksi**
  *Isi:* membuka form 3.8 dan 3.7; dompet awal mengikuti cakupan di 1.2.1. Tanpa
  dompet, yang terbuka form Tambah dompet beserta pemberitahuan.
  - Belum ada temuan. Tombol catat yang selalu terlihat di HP → 5.1.3.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Desktop 1440px dan HP 390px,
    tema terang dan gelap: fokus keyboard terlihat (garis 3px), Enter membuka
    form yang benar, Escape menutup dan fokus kembali ke tombol, dompet awal
    mengikuti cakupan. Keadaan tanpa dompet hanya dibaca dari kode
    (`openTx` di `App.tsx`), belum dilihat: "Mulai dari kosong" tetap membuat
    dompet, jadi keadaan itu baru muncul bila semua dompet dihapus.
    Catatan: di HP kedua tombol setinggi 41px, di bawah target sentuh 44px.
    Ini gaya `.button` bersama, jadi tidak diubah di butir ini.

### 1.2 Kontrol laporan

- [x] **1.2.1 Cakupan arus rekening**
  *Isi:* dropdown "Semua rekening & e-wallet IDR" atau satu dompet (arsip diberi tanda).
  - Label "Cakupan arus rekening" panjang dan teknis. Coba "Dompet" dengan
    pilihan "Semua dompet IDR".
  - *Dikerjakan 11 Nov 2026.* Label dan `aria-label` jadi "Dompet", pilihan
    pertama "Semua dompet IDR"; teks yang sama di kartu saldo dan kepala
    "Transaksi terbaru" ikut diganti supaya seragam. Tes `cashflow_browser.py`
    dan `wallet_browser.py` diperbarui dan lulus (19/19 masing-masing). Belum
    disentuh: untuk lira pilihan masih menulis "TRY" sedangkan tab menulis
    "TL".

- [x] **1.2.2 Periode arus rekening**
  *Isi:* dropdown "November 2026" / "Seluruh catatan" + teks rentang "1 Nov 2026 – 11 Nov 2026".
  - Bulannya sendiri diganti lewat kontrol lain yang letaknya terpisah (pemilih
    bulan di bilah mata uang). Dua kontrol untuk satu hal → 5.4.3.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Desktop dan HP, terang dan
    gelap: "Seluruh catatan" mengganti teks rentang jadi "Seluruh catatan
    hingga 11 Nov 2026" dan menyembunyikan pemilih bulan; fokus keyboard
    terlihat. Penyatuan dua kontrol tetap dikerjakan di 5.4.3. Catatan untuk
    5.4.3: label "Periode arus rekening" kini lebih panjang daripada
    tetangganya "Dompet".

- [x] **1.2.3 Peringatan laporan**
  *Isi:* "Laporan tetap mencakup N dompet arsip", peringatan saldo atau periode
  belum dimulai, "Ada tanggal posting yang belum diketahui".
  - Belum dilihat (butuh dompet arsip atau tanggal kosong). Tinjau teks dan
    tampilannya saat giliran.
  - *Dikerjakan 11 Nov 2026.* Dilihat dengan satu dompet diarsipkan dan bulan
    Desember 2026 (belum dimulai), desktop dan HP, terang dan gelap. **[bug]**
    Catatan "Laporan tetap mencakup N dompet arsip" tampil juga saat
    cakupannya satu dompet aktif; sekarang hanya untuk "Semua dompet", dan
    dompet arsip yang dipilih mendapat "Dompet ini diarsipkan. Saldo dan
    historinya tetap dihitung." Pemeriksaan ditambah di `wallet_browser.py`
    (19/19 lulus; `cashflow_browser.py` 19/19). Belum dilihat: peringatan
    tanggal posting kosong dan `balanceWarning` (butuh data legacy). Tidak
    diubah: di HP "periode belum dimulai" tertulis tiga kali (kartu saldo,
    teks rentang, peringatan).

### 1.3 Kartu angka utama

- [x] **1.3.1 Kartu saldo akhir periode**
  *Isi:* label, lencana mata uang, angka, cakupan, baris "Seluruh catatan: … ·
  termasuk tanggal masa depan". Di HP ditambah chip "Data contoh" dan rentang tanggal.
  - Label "Saldo akhir periode" tidak menyebut tanggalnya. Tulis "Saldo per
    11 Nov 2026" (tanggal akhir periode laporan).
  - Baris "Seluruh catatan" tampil walau nilainya sama dengan saldo utama.
    Tampilkan hanya bila berbeda (ada catatan bertanggal masa depan).
  - Teks baris bawah kecil dan pudar di atas latar hijau tua. Cek kontrasnya.
  - *Dikerjakan 11 Nov 2026.* Label jadi "Saldo per 11 Nov 2026" (tanggal
    akhir periode laporan); tetap "Saldo akhir periode" bila saldonya belum
    tersedia. Baris "Seluruh catatan" kini hanya tampil bila nilainya berbeda
    dari saldo utama. Kontras baris bawah diukur dengan satu catatan
    bertanggal masa depan: 5,77:1 (teks 11px, batas 4,5:1), jadi warnanya
    tidak diubah. Tes: `cashflow_browser.py` ditambah pemeriksaan label
    (19/19), `recovery_browser.py` 16/16, `theme_browser.py` 21/21.

- [x] **1.3.2 Kartu uang masuk dan uang keluar rekening**
  *Isi:* ikon, label, angka, catatan kaki ("Termasuk transfer masuk…").
  - Di desktop kartu setinggi kartu saldo dan separuh bawahnya kosong. Rapatkan.
  - **[fitur]** Pembanding periode sebelumnya ("Oktober: Rp …").
  - *Dikerjakan 11 Nov 2026.* Di atas 760px ikon pindah ke samping label,
    sehingga ketiga kartu sama tinggi tanpa ruang kosong (diukur: 172px di
    761–900px, 192px di 1024–1440px, 210px di 1700px; sebelumnya 209px di
    1440px). Di HP tidak berubah. Dilihat di tema terang dan gelap. Tes:
    `cashflow_browser.py` 19/19, `theme_browser.py` 21/21, `ux_browser.py`
    desktop dan mobile lulus. **[fitur]** pembanding periode sebelumnya tidak
    dikerjakan.
  - *[fitur] dikerjakan 11 Nov 2026.* Di bawah tiap kartu kini ada total bulan
    sebelumnya untuk cakupan yang sama ("Oktober 2026: Rp …"), hanya saat
    periodenya bulanan dan bulan sebelumnya punya arus. Angkanya total sebulan
    penuh, sedangkan bulan berjalan baru sampai hari ini. Diuji di
    `cashflow_browser.py` (19/19) dan `historyView.test.ts`; performa tetap
    dalam batas (median 4.199 ms dari batas 6.000 ms).

### 1.4 Perhitungan saldo periode

- [x] **1.4.1 Kepala panel dan lipatan**
  *Isi:* judul, deskripsi, tombol lipat. Di HP tertutup dengan ringkasan
  "Cocok · ketuk untuk melihat hitungan".
  - Pilihan buka/tutup kembali ke bawaan tiap pindah halaman. Ingat pilihan terakhir.
  - *Dikerjakan 11 Nov 2026.* Pilihan buka/tutup kedua panel lipat kini
    bertahan saat pindah halaman dan kembali, selama aplikasi terbuka; muat
    ulang halaman mengembalikan bawaan (desktop terbuka, HP tertutup) karena
    pilihan ini tidak disimpan ke browser. Dicoba dengan keyboard (Enter dan
    Spasi) di desktop dan HP. Pemeriksaan ditambah di `cashflow_browser.py`
    (19/19 lulus).

- [x] **1.4.2 Enam kotak hitungan**
  *Isi:* Saldo awal, + Uang masuk, − Uang keluar, ± Transfer antardompet,
  ± Penyesuaian saldo, = Saldo akhir.
  - Kotak "= Saldo akhir" tampil sama dengan lima kotak lain. Tonjolkan sebagai hasil.
  - Kotak bernilai Rp 0 (transfer antardompet, penyesuaian) ikut memenuhi
    layar. Redupkan atau sembunyikan bila nol.
  - *Dikerjakan 11 Nov 2026.* Kotak "= Saldo akhir" berlatar hijau tua dengan
    angka lebih besar; kotak "± Transfer antardompet" dan "± Penyesuaian
    saldo" yang bernilai Rp 0 jadi kotak bergaris dengan angka pudar (tetap
    tampil supaya rumusnya utuh). Dilihat di desktop dan HP, terang dan gelap.
    Tes: `cashflow_browser.py` 19/19 (termasuk pemeriksaan kontras),
    `theme_browser.py` 21/21.

- [x] **1.4.3 Kalimat hasil**
  *Isi:* "Perhitungan saldo periode cocok…" atau "Saldo periode belum dapat dipastikan…".
  - **[cek]** Saat belum cocok, kalimatnya tidak menyebut selisih atau
    penyebabnya. Tampilkan selisih (`report.difference`) bila ada dan tunjuk
    penyebabnya (mis. tanggal posting kosong).
  - *Dikerjakan 11 Nov 2026.* Dugaan **[cek]** benar: kalimatnya sama untuk
    semua keadaan belum cocok. Sekarang dibedakan: periode belum dimulai; N
    posting belum bertanggal; selisih bernominal bila hitungannya tidak
    menutup; laporan gagal dihitung. Dua keadaan pertama diuji di
    `cashflow_browser.py` (19/19 lulus). Cabang "selisih" belum pernah
    terlihat: dari kode, selisih hanya bisa bukan nol bila rumus laporan
    sendiri tidak konsisten, jadi cabang itu belum terbukti lewat tes.

- [x] **1.4.4 "Cara membaca angka ini"**
  *Isi:* daftar penjelasan terlipat.
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Desktop dan HP, terang dan
    gelap: terbuka dengan Enter, fokus terlihat, empat butir penjelasan tampil
    tanpa meluber. Catatan: baris pembukanya setinggi 25px, di bawah target
    sentuh 44px di HP; tidak diubah di butir ini.

### 1.5 Rincian arus rekening

- [x] **1.5.1 Kepala panel dan lipatan**
  *Isi:* sama dengan 1.4.1; ringkasan HP "3 jenis operasi · ketuk untuk melihat".
  - Ikut hasil 1.4.1.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode tambahan.* Panel ini memakai
    penyimpan pilihan yang sama dengan 1.4.1: dibuka/ditutup lewat keyboard,
    pindah halaman, kembali, dan pilihannya bertahan (desktop dan HP).

- [x] **1.5.2 Tabel jenis operasi**
  *Isi:* kolom Jenis operasi, Uang masuk, Uang keluar; pesan kosong "Belum ada
  arus pada periode ini."
  - Tidak ada baris jumlah, jadi hubungannya dengan kartu 1.3.2 harus dihitung
    sendiri. Tambah baris "Jumlah".
  - Sel "Rp 0" berulang. Ganti "—" supaya angka yang berisi lebih menonjol.
  - **[fitur]** Klik baris membuka transaksi penyusunnya (butuh filter jenis
    operasi di 3.3; belum ada).
  - *Dikerjakan 11 Nov 2026.* Baris "Jumlah" ditambah di kaki tabel (sama
    dengan kartu uang masuk dan keluar); sel bernilai nol ditulis "—" (pembaca
    layar tetap mendengar "Rp 0"). `cashflow_browser.py` kini memeriksa bahwa
    jumlah baris sama dengan baris "Jumlah" dan dengan kedua kartu pada setiap
    kasus yang cocok (19/19 lulus); `theme_browser.py` 21/21. Dilihat di
    desktop dan HP, terang dan gelap. **[fitur]** klik baris tidak dikerjakan
    (butuh filter jenis operasi di 3.3).

### 1.6 Dompetmu

- [x] **1.6.1 Kepala panel**
  *Isi:* "Dompetmu / Uangnya ada di sini." dan tautan "Lihat semua".
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Desktop dan HP, terang dan
    gelap: "Lihat semua" terjangkau Tab, fokus terlihat, Enter membuka halaman
    Dompet. Tautannya setinggi 24px, tetapi di HP area sentuhnya sudah diperluas jadi 44px oleh aturan `.text-link::after`.

- [x] **1.6.2 Baris dompet**
  *Isi:* ikon, nama, "Rekening bank · IDR", saldo aktual, panah.
  - Hanya 4 dompet pertama yang tampil tanpa tanda ada yang tersembunyi
    (sesudah "Mulai dari kosong" ada 8 dompet IDR). Tambah "+N dompet lainnya".
  - **[keputusan]** Klik baris membuka form Atur dompet, padahal panahnya
    mengisyaratkan "lihat isi". Pilih: buka riwayat dompet itu, atau tetap form.
  - "· IDR" mengulang tab mata uang (di kartu dompet sudah dibuang lewat MW-52).
  - *Sebagian dikerjakan 11 Nov 2026; belum dicentang karena satu usul menunggu
    keputusan.* Tautan "+N dompet lainnya" ditambah (membuka halaman Dompet)
    dan "· IDR" dibuang. Dilihat dengan 8 dompet IDR di desktop dan HP, terang
    dan gelap. Tes: `wallet_browser.py` 19/19, `cashflow_browser.py` 19/19,
    `browser_smoke.py` 39 skenario lulus; tautan baru belum punya tes
    otomatis. Tujuan klik baris (riwayat atau form) tidak diubah.
  - *Diselesaikan 11 Nov 2026 (pemilik menyetujui semua usul).* Klik baris
    kini membuka Transaksi untuk dompet itu, semua periode, sesuai isyarat
    panahnya; form Atur dompet tetap terjangkau dari halaman Dompet. Baris
    diberi nama untuk pembaca layar ("Riwayat BCA, saldo …"). Dicoba dengan
    keyboard di desktop dan HP. Tes: `wallet_browser.py` 19/19,
    `cashflow_browser.py` 19/19, smoke 39 skenario; perilaku baru ini belum
    punya tes otomatis.

- [x] **1.6.3 Keadaan kosong dan tombol Tambah dompet**
  *Isi:* "Belum ada dompet aktif IDR." + tautan; tombol putus-putus di dasar panel.
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Dilihat dengan mata uang
    tanpa dompet (AED ditambah lewat Kelola mata uang), desktop dan HP, terang
    dan gelap: pesan dan tautan "Tambah dompet" tampil, tombol putus-putus
    disembunyikan, Enter membuka form dengan mata uang AED terpilih, Escape
    mengembalikan fokus ke tautan.

### 1.7 Kategori pengeluaran terkonfirmasi

- [x] **1.7.1 Kepala panel**
  *Isi:* judul, "November 2026 · cakupan rekening yang dipilih.", ikon label di kanan.
  - Ikon label tampak seperti tombol tetapi tidak bisa diklik. Jadikan tombol
    ke Kelola kategori (dari Ringkasan belum ada jalan ke anggaran), atau buang.
  - *Dikerjakan 11 Nov 2026.* Ikon label kini tombol sungguhan bernama "Kelola
    kategori" yang membuka dialog Kelola kategori (tempat anggaran diatur).
    Fokus keyboard terlihat, Enter membuka, Escape menutup dan fokus kembali;
    area sentuh 45px. Dilihat di desktop dan HP, terang dan gelap. Tes:
    `category_browser.py` 25/25, `theme_browser.py` 21/21, `ux_browser.py`
    desktop dan mobile lulus.

- [x] **1.7.2 Baris kategori**
  *Isi:* titik warna, nama, nominal, batang. Dengan anggaran: "terpakai / batas"
  serta "Sisa …" atau "Lewat …".
  - Warna mengikuti urutan baris, jadi satu kategori bisa berganti warna tiap
    bulan. Kunci warna per kategori.
  - **[fitur]** Klik baris membuka Transaksi dengan pencarian kategori itu
    (kotak cari 3.3.1 sudah mencocokkan nama kategori).
  - *Dikerjakan 11 Nov 2026.* Warna titik dan batang kini mengikuti urutan
    kategori di Kelola kategori, bukan peringkat belanja bulan itu, jadi tidak
    berganti tiap bulan; nama di luar daftar (mis. "Biaya transfer") mendapat
    warna tetap dari namanya. Batas: paletnya 8 warna, jadi dengan lebih dari
    8 kategori dua kategori bisa berbagi warna, dan warna ikut bergeser bila
    urutan daftar diubah. Tes unit baru di `dashboardView.test.ts` (`npm test`
    1.756 lulus); `category_browser.py` 25/25. Data contoh hanya berisi satu
    bulan, jadi perbandingan antarbulan di browser belum dilihat. **[fitur]**
    klik baris tidak dikerjakan.
  - *[fitur] dikerjakan 11 Nov 2026.* Nama kategori kini tombol yang membuka
    Transaksi dengan dompet dan periode yang sama serta pencarian nama kategori
    itu. Dicoba dengan keyboard di desktop dan HP, terang dan gelap; belum
    punya tes otomatis.

- [x] **1.7.3 Kaki panel**
  *Isi:* "+N kategori lainnya", petunjuk anggaran, catatan "Hanya kategori
  pengeluaran terkonfirmasi…", keadaan kosong.
  - "+N kategori lainnya" hanya teks. Buat bisa dibuka untuk melihat semuanya.
  - *Dikerjakan 11 Nov 2026.* "+N kategori lainnya" kini tombol yang
    menampilkan semua kategori dan berubah jadi "Tampilkan lebih sedikit";
    pilihannya bertahan selama aplikasi terbuka. Dicoba dengan keyboard di
    desktop dan HP, terang dan gelap. Tes: `category_browser.py` 25/25,
    `theme_browser.py` 21/21; tombol baru belum punya tes otomatis. Petunjuk
    anggaran, catatan kaki, dan keadaan kosong dilihat dan tidak diubah.

### 1.8 Pengingat rapikan

- [x] **1.8.1 Banner "N catatan bisa dirapikan nanti"**
  *Isi:* jumlah, rincian alasan, "Cek catatan" (membuka 3.6).
  - Alasan bernilai nol ikut ditulis ("0 jenis perlu dicek · 1 kategori belum
    diisi"). Tulis hanya yang lebih dari nol.
  - *Dikerjakan 11 Nov 2026.* Alasan bernilai nol tidak ditulis lagi: data
    contoh kini menampilkan "1 kategori belum diisi. Saldo sudah tercatat."
    Dua alasan tetap dipisah " · ". Fokus keyboard terlihat; dilihat di
    desktop dan HP, terang dan gelap. Tes: `bank_review_browser.py` 12/12,
    `browser_smoke.py` 39 skenario lulus. Keadaan dengan dua alasan sekaligus
    tidak dilihat di browser.

### 1.9 Transaksi terbaru

- [x] **1.9.1 Kepala panel**
  *Isi:* judul, cakupan · periode, tautan "Semua transaksi".
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Desktop dan HP, terang dan
    gelap: subjudul mengikuti dompet dan periode yang dipilih; "Semua
    transaksi" terjangkau Tab, fokus terlihat, dan membuka Transaksi dengan
    dompet serta periode yang sama.

- [x] **1.9.2 Lima transaksi terbaru**
  *Isi:* tabel yang sama dengan 3.4, tanpa kotak centang.
  - Perbaikannya dikerjakan di 3.4. Di sini cukup pastikan hasilnya ikut.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Lima baris tampil tanpa
    kotak centang dan tanpa meluber di desktop dan HP, terang dan gelap.
    Tabelnya komponen yang sama dengan 3.4 (`TransactionTable`), jadi
    perbaikan 3.4 otomatis ikut; periksa ulang di sini sesudah 3.4 dikerjakan.

- [x] **1.9.3 Keadaan kosong**
  *Isi:* "Belum ada transaksi di sini…".
  - → 3.4.6.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Dilihat dengan bulan tanpa
    transaksi (Desember 2026) di desktop dan HP, terang dan gelap: ikon,
    "Belum ada transaksi di sini", dan kalimat ajakan tampil rapi.
    Perbaikannya tetap di 3.4.6.

### 1.10 Susunan halaman

- [x] **1.10.1 Urutan bagian di HP**
  *Isi:* judul → tombol → kartu saldo → banner → tab mata uang → bulan →
  cakupan → periode → masuk/keluar → dua panel lipat → pengingat rapikan →
  transaksi terbaru → dompet → kategori.
  - **[keputusan]** Kartu saldo berada di atas tab mata uang dan filter yang
    menentukan isinya, dan banner menyela di antaranya. Usul: mata uang →
    saldo → masuk/keluar, dengan cakupan + periode diringkas jadi satu baris.
  - *Dilewati 11 Nov 2026: menunggu keputusan pemilik.*
  - *Dikerjakan 11 Nov 2026 (pemilik menyetujui semua usul).* Urutan di HP
    kini: judul → tombol → tab mata uang → kartu saldo → Dompet + Periode
    dalam satu baris → rentang tanggal, "Kelola mata uang", bulan →
    masuk/keluar → banner data contoh dan pengingat cadangan → panel lain.
    Peringatan penyimpanan dan tanggal posting tetap di atas. Label "Periode
    arus rekening" jadi "Periode" (`aria-label` tidak berubah); lencana mata
    uang di kartu saldo HP dibuang karena tab mata uang kini tepat di atasnya.
    Di lebar ≤360px kedua pilihan ditumpuk dan tulisan kecil di atas judul
    disembunyikan supaya kartu saldo tetap di layar pertama 320×568. Desktop
    tidak berubah. Dilihat di 320px dan 390px, terang dan gelap. Seluruh tes
    browser CI lulus pada build ini (termasuk `first-fold` 320×568, 375×667,
    390×844) dan `npm test` 1.759 lulus. Batas: di 320×568 kartu saldo pas di
    tepi layar pertama, tanpa sisa ruang.

- [x] **1.10.2 Tampilan saat belum ada transaksi**
  *Isi:* semua panel tetap tampil berisi Rp 0, termasuk kalimat "Perhitungan
  saldo periode cocok".
  - Ganti dengan panduan mulai: isi saldo awal dompet, lalu catat transaksi
    pertama atau impor mutasi. Panel hitungan muncul setelah ada data.
  - *Dikerjakan 11 Nov 2026.* Bila catatan sendiri belum berisi satu transaksi
    pun, panel "Perhitungan saldo periode", "Rincian arus rekening", dan
    "Transaksi terbaru" diganti panel "Mulai dari sini" berisi tiga langkah
    bertombol: Buka Dompet, Catat sekarang, Buka Impor mutasi. Kartu saldo,
    kartu masuk/keluar, Dompetmu, dan panel kategori tetap tampil. Dilihat
    sesudah "Mulai dari kosong" di desktop dan HP, terang dan gelap; fokus
    keyboard terlihat. Seluruh tes browser CI dijalankan: smoke 39 skenario,
    recovery 16, ux 2, theme 21, category 25, keyword_pack 13,
    confirmed_mapping 10, bank_description 9, bank_auto 18, bank_review 12,
    wallet 19, currency_import 28, cashflow 19, source 4, backfill 2,
    performance lulus (median 4.214 ms). Tujuh tes dari recovery sampai
    bank_description dijalankan pada build sebelum tombol langkah 2 diganti
    nama dari "Catat transaksi" (nama itu bentrok dengan tombol kepala halaman
    dan menggagalkan smoke). Panduan ini belum punya tes otomatis sendiri.

---

## Bab 2 — Dompet

Bagian bersama yang ikut tampil: bar atas (5.2), banner (5.3), tab mata uang (5.4.1).

### 2.1 Kepala halaman

- [x] **2.1.1 Judul**
  *Isi:* "Semua dompetmu." / "Rekening dan e-wallet. Cash tidak dibukukan."
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Judul dan subjudul dilihat
    di desktop dan HP, terang dan gelap.

- [x] **2.1.2 Tombol Tambah dompet**
  *Isi:* tombol utama di kepala halaman.
  - Di HP ada dua pintu yang sama dalam satu layar: tombol selebar layar di
    atas dan kartu putus-putus besar di bawah daftar (2.3.4). Cukup satu.
  - *Dikerjakan 11 Nov 2026.* Di HP kartu putus-putus "Tambah dompet"
    disembunyikan; tombol di kepala halaman jadi satu-satunya pintu. Desktop
    tetap menampilkan keduanya.

### 2.2 Pengantar daftar

- [x] **2.2.1 Pemberitahuan arsip cash lama**
  *Isi:* tampil bila masih ada dompet cash lama; tombol "Lihat arsip cash lama" (→ 2.6).
  - Belum dilihat. Tinjau saat giliran.
  - *Dibaca dari kode saja 11 Nov 2026, tanpa perubahan.* Pemberitahuan arsip
    cash lama butuh data dompet cash lama, yang tidak ada di data contoh;
    belum dilihat di browser.

- [x] **2.2.2 Tab Aktif / Arsip**
  *Isi:* dua tab dengan jumlah dompet.
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Tab Aktif/Arsip dicoba di
    desktop dan HP; jumlah dompet ikut berubah sesudah satu dompet diarsipkan.

- [x] **2.2.3 Judul bagian dan total**
  *Isi:* "Dompet Rupiah · Aktif", "2 dompet · saldo aktual 11 Nov 2026: Rp …", lencana "IDR".
  - Total saldo adalah angka terpenting halaman ini tetapi ditulis sebagai
    teks kecil. Besarkan.
  - Lencana "IDR" mengulang tab mata uang (sejenis MW-52).
  - *Dikerjakan 11 Nov 2026.* Total saldo kini angka besar di kanan judul
    bagian dengan label "Saldo aktual 11 Nov 2026"; jumlah dompet tetap di
    bawah judul. Lencana "IDR" dibuang.

- [x] **2.2.4 Catatan aturan dompet**
  *Isi:* kotak "Satu dompet untuk satu mata uang…" di bawah daftar.
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Kotak aturan dompet dilihat
    di desktop dan HP, terang dan gelap.

### 2.3 Kartu dompet aktif

- [x] **2.3.1 Kepala kartu**
  *Isi:* ikon (bank, atau huruf awal untuk e-wallet), nama, jenis, tombol "⋯".
  - Tombol "⋯" langsung membuka form Atur dompet, bukan menu. Pakai ikon/label
    yang sesuai ("Atur"), atau jadikan menu sungguhan (Atur, Riwayat, Arsipkan).
  - `--wallet-color` dipasang per mata uang tetapi tidak dipakai CSS (sudah
    dicatat di MW-69). Putuskan dipakai atau dibuang.
  - *Dikerjakan 11 Nov 2026.* Tombol "⋯" diganti tombol beriikon dan
    bertulisan "Atur" (nama untuk pembaca layar tetap "Atur dompet …", jadi
    tes tidak berubah). `--wallet-color` yang tidak dipakai CSS dibuang.

- [x] **2.3.2 Saldo aktual**
  *Isi:* label bertanggal dan angka besar.
  - **[cek]** Bila tanggal posting kosong, tempat angka besar diisi kalimat
    panjang ("Belum pasti: tanggal posting belum diketahui"). Pastikan tidak
    meluber dan beri gaya teks biasa.
  - *Dikerjakan 11 Nov 2026.* Dugaan **[cek]** benar dari kode: kalimat
    pengganti saldo memakai gaya angka besar. Sekarang kalimat tanpa angka
    diberi gaya teks biasa (14px), juga pada total halaman. Keadaan tanggal
    posting kosong sendiri belum dilihat di browser (butuh data legacy).

- [x] **2.3.3 Aksi kartu**
  *Isi:* "Catat" (form pengeluaran untuk dompet itu) dan "Cek saldo" (→ 3.9.2).
  - Kartu aktif tidak punya jalan ke riwayatnya; "Lihat histori" hanya ada di
    kartu arsip. Tambah "Riwayat" (fungsi `openHistory` sudah ada).
  - *Dikerjakan 11 Nov 2026.* Kartu aktif mendapat tautan "Riwayat" yang
    membuka Transaksi untuk dompet itu, semua periode. Dicoba dengan keyboard
    di desktop dan HP; belum punya tes otomatis.

- [x] **2.3.4 Kartu "Tambah dompet"**
  *Isi:* kartu putus-putus di akhir daftar.
  - → 2.1.2.
  - *Dikerjakan 11 Nov 2026.* Dikerjakan di 2.1.2.

### 2.4 Tampilan arsip

Belum dilihat di tangkapan layar (butuh dompet arsip). Ketiga butir ditinjau
saat gilirannya.

*Bab 2.1–2.4 dikerjakan dalam satu commit pada 11 Nov 2026. Tes pada build itu: `npm test` 1.760 lulus, `wallet_browser.py` 19/19, `currency_import_browser.py` 28/28, `bank_auto_browser.py` 18/18, `theme_browser.py` 21/21, smoke 39 skenario, recovery 16/16, ux lulus.*

- [x] **2.4.1 Pemberitahuan arsip**
  *Isi:* "Dompet arsip tetap masuk saldo dan laporan…".
  - *Dikerjakan 11 Nov 2026.* Dilihat dengan satu dompet diarsipkan.
    Pemberitahuan arsip kini hanya tampil bila ada dompet arsip; sebelumnya
    tampil juga di arsip yang kosong.

- [x] **2.4.2 Kartu dompet arsip**
  *Isi:* "Lihat histori" dan "Pulihkan dompet" (dengan konfirmasi).
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Kartu arsip, "Lihat
    histori", dan "Pulihkan dompet" dilihat di desktop dan HP, terang dan
    gelap; fokus keyboard terlihat. Konfirmasi pemulihan dicakup
    `wallet_browser.py`.

- [x] **2.4.3 Keadaan kosong**
  *Isi:* "Belum ada dompet arsip IDR."
  - *Dikerjakan 11 Nov 2026.* Arsip kosong kini hanya menampilkan pesan "Belum
    ada dompet arsip IDR.", tanpa total "Rp 0" dan tanpa pemberitahuan.

### 2.5 Form dompet (Tambah dompet / Atur dompet)

*Bab 2.5–2.6 dikerjakan dalam satu commit pada 11 Nov 2026. Tes pada build itu: `npm test` 1.760 lulus, `wallet_browser.py` 19/19, `currency_import_browser.py` 28/28, `cashflow_browser.py` 19/19, `theme_browser.py` 21/21, `bank_auto_browser.py` 18/18, smoke 39 skenario.*

- [x] **2.5.1 Nama dompet**
  *Isi:* wajib, maksimal 60 karakter.
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Nama kosong ditolak,
    masukan dipotong di 60 karakter, fokus awal jatuh di kolom ini (desktop
    dan HP, terang dan gelap).

- [x] **2.5.2 Mata uang**
  *Isi:* daftar mata uang yang ditampilkan; terkunci saat mengubah dompet.
  - Mata uang yang belum ditampilkan tidak bisa dipilih dari sini: form harus
    ditutup, Kelola mata uang dibuka, lalu diulang. Tambah tautan "Mata uang
    lain…" di form.
  - *Dikerjakan 11 Nov 2026.* Form Tambah dompet punya tautan "Mata uang
    lain…": form menutup, Kelola mata uang terbuka, dan sesudah disimpan atau
    dibatalkan form Tambah dompet terbuka lagi dengan daftar mata uang
    terbaru. Batas: isian yang sudah diketik di form (nama, saldo) tidak
    dibawa. Dicoba sampai dompet AED tersimpan, desktop dan HP; belum punya
    tes otomatis.

- [x] **2.5.3 Jenis dompet**
  *Isi:* Rekening bank / E-wallet.
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Dua pilihan (Rekening bank,
    E-wallet) tampil dan tersimpan.

- [x] **2.5.4 Saldo awal**
  *Isi:* kolom nominal; terkunci setelah dompet punya histori.
  - Angka tampil mentah ("2400000") tanpa pemisah ribuan → 5.11.3.
  - *Diperiksa 11 Nov 2026.* Pemisah ribuan dikerjakan di 5.11.3; tidak ada
    perubahan di sini.

- [x] **2.5.5 Arsipkan dan Hapus**
  *Isi:* kotak penjelasan dan tombol; konfirmasinya dialog terpisah.
  - **[bug]** Di desktop kotaknya hanya selebar setengah form dan sisi kanannya
    kosong. Aturan lebar penuh hanya berlaku untuk `.field.full` dan
    `.notice.full`, tidak untuk `.wallet-lifecycle-actions.full`.
  - *Dikerjakan 11 Nov 2026.* **[bug]** diperbaiki: kotak Arsipkan/Hapus kini
    selebar form di desktop (diukur 466px dari 520px lebar badan form, sisanya
    padding; sebelumnya setengah).

- [x] **2.5.6 Tombol dan pesan galat**
  *Isi:* Batal, Simpan dompet, kotak galat.
  - Menutup form (klik luar atau Escape) membuang isian tanpa bertanya → 5.9.1.
  - *Diperiksa 11 Nov 2026.* Tombol dan kotak galat dilihat; konfirmasi
    sebelum membuang isian dikerjakan di 5.9.1.

### 2.6 Arsip cash lama (jendela baca saja)

- [x] **2.6.1 Daftar catatan cash lama**
  *Isi:* saldo per dompet cash dan daftar catatan, 50 per halaman.
  - **[cek]** Tiap catatan ditulis sebagai paragraf "tanggal · keterangan ·
    dompet · nominal". Ubah jadi daftar yang sejajar. Belum dilihat (butuh
    data cash lama).
  - *Dikerjakan 11 Nov 2026.* Dugaan **[cek]** benar. Saldo per dompet cash
    kini daftar dua kolom dan catatan lama jadi tabel Tanggal / Keterangan /
    Dompet / Nominal. Dilihat lewat data sintetis `bank_auto_browser.py`
    (18/18 lulus) di desktop tema terang saja; HP dan tema gelap belum
    dilihat.

---

## Bab 3 — Transaksi

Bagian bersama yang ikut tampil: bar atas (5.2), banner (5.3), bilah mata uang
dan bulan (5.4).

*Bab 3.1–3.4 dikerjakan bersama pada 11 Nov 2026. Seluruh tes browser CI lulus pada build akhirnya (15 berkas + performance; `npm test` 1.764 lulus). Build pertama gagal tes performa (jeda frame 301–313 ms, batas 250 ms); penyebabnya hitungan kandidat kategori otomatis dan pencarian judul bank, keduanya diperbaiki (jeda frame akhir ±172 ms, median 4.360–4.570 ms; sebelum Bab 3 ±4.100–4.200 ms).*

### 3.1 Kepala halaman

- [x] **3.1.1 Judul**
  *Isi:* "Catatan kecil, lebih tenang." / "Lihat uang yang masuk, keluar, dan berpindah."
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Judul dan subjudul dilihat
    di desktop dan HP, terang dan gelap.

- [x] **3.1.2 Tombol Pindah uang dan Catat transaksi**
  *Isi:* sama dengan 1.1.2; dompet awal mengikuti filter dompet (3.3.3).
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Tombol yang sama dengan
    1.1.2; tampil dan berfungsi di halaman ini. Pemeriksaan keyboard lengkap
    tidak diulang di sini.

### 3.2 Alat kategori

- [x] **3.2.1 Tombol Kelola kategori**
  *Isi:* membuka 3.12.
  - Di HP baris alat ini beserta keterangannya memakan ±140px sebelum filter. Rapatkan.
  - *Dikerjakan 11 Nov 2026.* Di HP jarak dan teks keterangan baris alat
    dirapatkan: tingginya turun dari ±140px ke 103px (diukur di 390px).

- [x] **3.2.2 Tombol Isi kategori otomatis**
  *Isi:* membuka 3.13; keterangan "Kategori kosong & konfirmasi mutasi bank · semua periode".
  - Tombol selalu aktif walau tidak ada yang bisa diisi; jendelanya lalu kosong
    ("0 cocok"). Tampilkan jumlah kandidat di tombol atau nonaktifkan saat nol.
    **[cek]** biaya hitungnya pada data besar.
  - *Dicoba 11 Nov 2026, lalu dibatalkan.* **[cek]** terbukti: menghitung
    kandidat tiap data berubah menaikkan waktu tes performa ±800 ms per
    rangkaian (5.632 → 4.201 ms saat hitungan dibuang) dan menonaktifkan
    tombol saat nol mematahkan empat tes yang sengaja membuka jendela kosong.
    Jadi tombol dan keterangannya dibiarkan seperti semula. Menampilkan jumlah
    butuh hitungan yang ditunda atau dicicil; belum dikerjakan.

### 3.3 Filter riwayat

- [x] **3.3.1 Kotak cari**
  *Isi:* mencocokkan keterangan, nama kategori, dan nama dompet.
  - Mengetik pencarian diam-diam mengubah periode ke "Semua periode" dan tidak
    mengembalikannya saat kotak dikosongkan. Beri tahu ("mencari di semua
    periode") dan kembalikan periode semula saat dikosongkan.
  - Placeholder hanya menyebut "keterangan atau dompet", padahal nama kategori
    juga dicari.
  - **[cek]** Judul di tabel diolah dari keterangan bank (3.4.2), sedangkan
    pencarian memakai catatan mentah. Pastikan teks yang terlihat bisa ditemukan.
  - **[fitur]** Cari nominal.
  - *Dikerjakan 11 Nov 2026.* Mengetik pencarian saat periode bulanan kini
    ditandai "mencari di semua periode" di kalimat cakupan, dan periode semula
    kembali saat kotak dikosongkan. Placeholder jadi "Cari keterangan,
    kategori, nominal…". **[cek]** benar: judul hasil olahan keterangan bank
    tidak ikut dicari; sekarang ikut (hasilnya disimpan sementara supaya tidak
    memperlambat). **[fitur]** cari nominal dikerjakan: "35.000" atau "35000"
    menemukan catatan bernominal itu (minimal dua digit). Tes unit baru di
    `historyView.test.ts`; `ux_browser.py` diperbarui untuk perilaku periode.
    Pencarian judul bank belum dilihat di browser dengan data impor.

- [x] **3.3.2 Periode**
  *Isi:* "November 2026" / "Semua periode".
  - Sama dengan 1.2.2 → 5.4.3.
  - *Diperiksa 11 Nov 2026.* Penyatuan kontrol tetap di 5.4.3; tidak ada
    perubahan di sini selain perilaku periode saat mencari (3.3.1).

- [x] **3.3.3 Dompet**
  *Isi:* dompet pada mata uang terpilih; arsip diberi tanda.
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Pilihan dompet mengikuti
    mata uang dan menandai arsip.

- [x] **3.3.4 Jenis**
  *Isi:* Semua jenis, Pengeluaran, Pemasukan, Transfer, Perpindahan dana
  rekening, Perlu dirapikan, Penyesuaian.
  - **[keputusan]** "Perlu dirapikan" bukan jenis: memilihnya mengubah halaman
    ke mode antrean (semua mata uang dan periode, tab mata uang hilang).
    Keluarkan dari dropdown; pintunya sudah ada ("Rapikan N catatan"). Cek tes
    yang memilih nilai ini.
  - **[fitur]** Filter kategori belum ada.
  - *Dikerjakan 11 Nov 2026.* (pemilik menyetujui semua usul) "Perlu
    dirapikan" dikeluarkan dari dropdown Jenis pada riwayat biasa; pilihan itu
    hanya ada saat antrean sedang terbuka, supaya bisa keluar lewat dropdown.
    Tiga tes yang memilih nilai itu (`cashflow`, `bank_review`, `source`) kini
    masuk lewat tombol "Rapikan N catatan". **[fitur]** filter kategori
    ditambah ("Semua kategori" + daftar kategori).

- [x] **3.3.5 Ringkasan dan aksi**
  *Isi:* "N transaksi", "Rapikan N catatan", "Reset filter", "Unduh CSV".
  - **[fitur]** Total uang masuk dan keluar dari hasil filter.
  - *Dikerjakan 11 Nov 2026.* **[fitur]** total uang masuk dan keluar dari
    hasil filter kini tampil di kalimat cakupan. Transfer antardompet dan
    penyesuaian saldo tidak dihitung, jadi angka "keluar" bisa lebih kecil
    dari kartu Ringkasan (biaya transfer tidak ikut). Tidak tampil di antrean
    rapikan karena mata uangnya bercampur.

- [x] **3.3.6 Kalimat cakupan**
  *Isi:* "IDR · November 2026 · 6 transaksi. Pilih catatan di halaman ini untuk
  kategori massal."
  - Jumlah transaksi tertulis dua kali (di sini dan di 3.3.5). Gabungkan.
  - *Dikerjakan 11 Nov 2026.* Jumlah transaksi kini hanya ditulis sekali, di
    awal kalimat cakupan; "N transaksi" di baris tombol dibuang.

### 3.4 Tabel transaksi

- [x] **3.4.1 Kepala tabel dan pilih semua**
  *Isi:* kolom Transaksi, Dompet, Tanggal, Nominal; centang di kepala memilih
  baris yang memenuhi syarat di halaman itu.
  - **[fitur]** Urutan selalu terbaru di atas. Belum ada pilihan urut (terlama, nominal).
  - *Dikerjakan 11 Nov 2026.* **[fitur]** pilihan urutan ditambah: Terbaru
    dulu, Terlama dulu, Nominal terbesar, Nominal terkecil. Dicoba di desktop
    dan HP.

- [x] **3.4.2 Sel transaksi**
  *Isi:* ikon jenis, judul, baris kecil (kategori, "A → B", atau "Jenis belum
  dikonfirmasi"), petunjuk operasi bank, lipatan "Keterangan bank asli".
  - Ikon cangkir hanya untuk kategori "Makan & minum" (ditulis mati); kategori
    lain memakai panah. Buat peta ikon per kategori, atau samakan semuanya.
  - *Dikerjakan 11 Nov 2026.* Ikon kini dipetakan per kategori bawaan (19
    kategori, mis. Transportasi, Tagihan, Belanja); kategori buatan sendiri
    atau yang diganti namanya tetap memakai panah.

- [x] **3.4.3 Sel dompet dan tanggal**
  *Isi:* nama dompet, tanggal; transfer menampilkan "Debit: …", "Kredit: …",
  dan bila perlu "Tanggal legacy belum dibuktikan terpisah".
  - Catatan "Tanggal legacy…" muncul pada transfer di data contoh dan
    istilahnya teknis. Ganti kalimatnya, dan buat data contoh tidak memicunya.
  - Bila tanggal debit dan kredit sama, cukup satu tanggal.
  - *Dikerjakan 11 Nov 2026.* Bila tanggal debit dan kredit sama, hanya satu
    tanggal yang ditulis. Catatan "Tanggal legacy…" diganti "Satu tanggal
    untuk kedua sisi; tanggal bank tiap sisi belum dipastikan" dan tidak
    ditampilkan pada data contoh. Data contohnya sendiri tidak diubah.

- [x] **3.4.4 Sel nominal**
  *Isi:* tanda dan warna, "→ nominal diterima", "Biaya …", lencana "Perlu
  dicek". Seluruh sel adalah tombol ke 3.11.
  - Transfer semata uang mengulang angka yang sama ("Rp 1.000.000 →
    Rp 1.000.000"). Tampilkan "→" hanya bila berbeda.
  - *Dikerjakan 11 Nov 2026.* "→ nominal diterima" hanya tampil bila mata uang
    atau angkanya berbeda dari nominal keluar.

- [x] **3.4.5 Aksi baris**
  *Isi:* pensil (Ubah), tombol "Cek" untuk yang belum dikonfirmasi, "Arsip · baca saja".
  - **[keputusan]** Barisnya sendiri tidak bisa diklik, hanya nominal dan
    pensil. Pilih apakah klik judul membuka rincian.
  - *Dikerjakan 11 Nov 2026.* (pemilik menyetujui semua usul) Judul transaksi
    kini tombol yang membuka Rincian nominal. Dicoba dengan keyboard di
    desktop dan HP, terang dan gelap.

- [x] **3.4.6 Keadaan kosong**
  *Isi:* "Belum ada transaksi di sini / Mulai dari satu catatan kecil, atau
  impor mutasi rekeningmu."
  - Pesan yang sama dipakai saat filter atau pencarian tidak menemukan apa
    pun. Bedakan: "Tidak ada yang cocok" + Reset filter; untuk data yang
    memang kosong beri tombol Catat transaksi dan Impor mutasi.
  - *Dikerjakan 11 Nov 2026.* Dua keadaan kosong: bila ada catatan tetapi
    filter menyembunyikan semuanya, "Tidak ada yang cocok" + Reset filter (+
    "Lihat semua periode" bila periodenya bulanan); bila memang belum ada
    catatan, tombol "Catat transaksi pertama" dan "Impor mutasi". Keadaan
    kedua belum dilihat di browser.

- [x] **3.4.7 Paginasi**
  *Isi:* 50 per halaman, "1–6 dari 6 · Halaman 1 dari 1", tombol Sebelumnya/Berikutnya.
  - **[cek]** Ganti halaman tidak menggulir ke awal tabel, jadi pengguna
    tertinggal di dasar halaman.
  - *Dikerjakan 11 Nov 2026 dari kode, belum dicoba.* Ganti halaman kini
    menggulir ke awal daftar. Data contoh hanya 6 baris, jadi perilaku ini
    belum dilihat dengan lebih dari 50 baris dan belum punya tes.

- [x] **3.4.8 Tampilan HP**
  *Isi:* kolom Dompet dan Tanggal pindah ke baris kecil di bawah judul; judul satu baris.
  - Judul terpotong ("Pisahkan uang bula…") dan versi lengkapnya hanya ada di
    atribut `title`, yang tidak muncul di layar sentuh. Izinkan dua baris.
  - **[fitur]** Kelompokkan baris per tanggal.
  - *Dikerjakan 11 Nov 2026.* Di HP judul boleh dua baris. **[fitur]** label
    tanggal muncul di atas baris pertama tiap hari saat urutannya berdasarkan
    tanggal (bukan baris tabel tambahan, supaya hitungan baris tetap).

### 3.5 Kategori massal

*Bab 3.5–3.6 dikerjakan bersama pada 11 Nov 2026. Seluruh tes browser CI lulus lokal pada build itu (15 berkas + performance; `npm test` 1.764 lulus).*

- [x] **3.5.1 Ringkasan pilihan**
  *Isi:* "N transaksi dipilih", penjelasan, "Batal pilih".
  - Pilihan hilang saat ganti halaman atau filter, dan pilih semua hanya
    mencakup halaman yang terlihat. **[fitur]** "Pilih semua N hasil filter".
  - *Dikerjakan 11 Nov 2026.* **[fitur]** tombol "Pilih semua N hasil filter"
    ditambah di panel pilihan; ia memilih semua baris yang bisa diberi
    kategori di seluruh halaman hasil filter. Pilihan tetap sengaja dibuang
    saat filter, urutan, atau halaman berubah (tes smoke menjaga ini supaya
    catatan tersembunyi tidak ikut berubah), jadi "pilih semua" dipakai tepat
    sebelum Terapkan. Perbaikan ikutan: pilihan kini juga dibuang saat filter
    kategori atau urutan baru dari 3.3–3.4 diganti.

- [x] **3.5.2 Pilih kategori dan Terapkan**
  *Isi:* dropdown kategori dan tombol "Terapkan ke N transaksi".
  - Pilihan awalnya "Belum dikategorikan" dan tombol utama langsung aktif.
    Mulai dari "Pilih kategori…" dan nonaktifkan tombol sampai dipilih.
    **[cek]** akibat menerapkan "Belum dikategorikan" pada catatan yang sudah
    berkategori.
  - *Dikerjakan 11 Nov 2026.* Dropdown mulai dari "Pilih kategori…" dan tombol
    Terapkan nonaktif sampai kategori dipilih. **[cek]**: menerapkan "Belum
    dikategorikan" memang mengosongkan kategori catatan terpilih; sekarang itu
    hanya terjadi bila dipilih dengan sengaja.

- [x] **3.5.3 Konfirmasi jenis**
  *Isi:* centang "Saya sudah cek: uang masuk adalah pemasukan…" bila ada yang
  belum dikonfirmasi.
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Centang konfirmasi jenis
    dicakup `browser_smoke.py` (lulus).

### 3.6 Antrean "Perlu dirapikan"

- [x] **3.6.1 Kotak cakupan antrean**
  *Isi:* jumlah catatan, rincian alasan, penjelasan.
  - Empat kalimat dalam satu kotak. Ringkas dan sembunyikan angka nol.
  - Tidak ada tombol kembali ke riwayat biasa (harus lewat dropdown Jenis atau
    Reset filter).
  - *Dikerjakan 11 Nov 2026.* Kotak cakupan diringkas jadi satu kalimat,
    alasan bernilai nol disembunyikan, dan ada tombol "Semua transaksi" untuk
    kembali ke riwayat biasa.

- [x] **3.6.2 Filter alasan**
  *Isi:* Semua alasan / Jenis perlu dicek / Kategori belum diisi.
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Tiga pilihan alasan tampil
    di antrean; dicakup `bank_review_browser.py` (lulus).

- [x] **3.6.3 Merapikan satu catatan**
  *Isi:* pensil atau "Cek" membuka form; atau centang lalu kategori massal.
  - **[fitur]** Pilih kategori langsung di baris (dropdown + saran aturan)
    seperti di pratinjau impor (4.8.6), supaya antrean cepat habis.
  - Antrean yang sudah habis menampilkan pesan kosong umum. Ganti "Semua sudah rapi".
  - *Dikerjakan 11 Nov 2026.* **[fitur]** baris antrean yang kategorinya
    kosong punya dropdown "Pilih kategori…" sendiri; memilihnya langsung
    menyimpan kategori (jenisnya tetap belum dikonfirmasi). Saran dari aturan
    kata kunci belum ditampilkan di dropdown itu. Antrean yang habis
    menampilkan "Semua sudah rapi" dengan tombol kembali. Dicoba di desktop
    dan HP, terang dan gelap; belum punya tes otomatis.

### 3.7 Form transaksi (Catat / Ubah)

*Bab 3.7–3.8 dikerjakan sebagian pada 11 Nov 2026; empat butir sisanya (3.7.3, 3.7.6, 3.8.3, 3.8.6) dikerjakan pada hari yang sama di sesi berikutnya bersama 3.9–3.14. Hasil tes ditulis di catatan akhir Bab 3.*

- [x] **3.7.1 Kepala form dan tutup**
  *Isi:* judul per mode, subjudul; bila ada isian, menutup menanyakan "Buang
  isian transaksi?".
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Judul per mode tampil;
    konfirmasi "Buang isian transaksi?" dicakup `recovery_browser.py` (lulus).

- [x] **3.7.2 Pilihan jenis**
  *Isi:* Pengeluaran, Pemasukan, Perpindahan dana, Transfer, Cek saldo. Di HP
  barisnya bisa digeser.
  - **[keputusan]** "Perpindahan dana" dan "Transfer" mudah tertukar. Beri
    keterangan satu baris di bawah tab aktif, atau ganti labelnya.
  - Nama jenis berbeda antarbagian → 5.11.4.
  - *Dikerjakan 11 Nov 2026.* (pemilik menyetujui semua usul) Satu baris
    keterangan tampil di bawah tab jenis yang aktif, mis. Transfer: "Pindah
    uang antara dua dompetmu sendiri. Jumlah seluruh uangmu tidak berubah."
    Label tabnya tidak diganti; penyeragaman nama jenis tetap di 5.11.4.

- [x] **3.7.3 Isi cepat dari template**
  *Isi:* deretan tombol template di atas form baru.
  - Template tidak bisa dihapus atau diganti namanya (hanya ada fungsi tambah).
    Buat cara mengelolanya.
  - *Dikerjakan 11 Nov 2026.* Tautan "Kelola template" di atas deretan
    template membuka daftar: tiap template bisa diganti namanya atau
    dihapus. Nama yang sudah dipakai template lain ditolak dan daftar
    tersimpan tidak berubah. Penulisan memakai kunci yang sama dengan
    menyimpan template, dan transaksi yang sudah dicatat tidak tersentuh.
    `category_browser.py` ditambah untuk ganti nama (termasuk penolakan) dan
    hapus.

- [x] **3.7.4 Dompet dan tanggal**
  *Isi:* dropdown dompet aktif dan kolom tanggal.
  - Tanggal tampil mengikuti bahasa browser ("11/08/2026") → 5.11.2.
  - **[fitur]** Tombol cepat "Kemarin".
  - *Dikerjakan 11 Nov 2026.* **[fitur]** tombol cepat "Hari ini" dan
    "Kemarin" di bawah kolom tanggal (tidak pada Cek saldo dan catatan impor
    yang tanggalnya terkunci). Format tampilan tanggal tetap di 5.11.2.

- [x] **3.7.5 Nominal**
  *Isi:* kolom angka besar dengan kode mata uang.
  - Tidak ada pemisah ribuan saat mengetik → 5.11.3.
  - *Diperiksa 11 Nov 2026.* Pemisah ribuan dikerjakan di 5.11.3; tidak ada
    perubahan di sini.

- [x] **3.7.6 Kategori dan keterangan**
  *Isi:* dropdown kategori ("boleh nanti") dan kolom keterangan ("opsional").
  - Daftar kategorinya sama untuk pengeluaran dan pemasukan (±30 pilihan
    datar). Urutkan sesuai jenis atau yang sering dipakai.
  - **[fitur]** Saran kategori dari keterangan saat mencatat manual, memakai
    aturan kata kunci yang sama dengan impor.
  - *Dikerjakan 11 Nov 2026.* Dropdown kategori kini memisahkan "Sering
    dipakai untuk pengeluaran/pemasukan/perpindahan dana" (maksimal enam,
    dihitung dari catatan berjenis sama) dari "Kategori lain"; tanpa
    riwayat, urutannya tetap seperti pengaturan. **[fitur]** saat keterangan
    diisi dan kategori masih kosong, muncul "Saran kategori: …" dari aturan
    kata kunci yang sama dengan impor; saran hanya mengisi dropdown bila
    diklik, tidak pernah otomatis, dan hanya untuk catatan manual berjenis
    pengeluaran atau pemasukan.

- [x] **3.7.7 Simpan sebagai template**
  *Isi:* tombol yang membuka kolom nama template.
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Tombol "Simpan sebagai
    template" tampil pada form baru.

- [x] **3.7.8 Tombol bawah**
  *Isi:* Batal, Simpan transaksi, Simpan & catat lagi; saat mengubah: Hapus,
  Pisahkan transfer.
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Batal, Simpan transaksi,
    dan Simpan & catat lagi tampil di desktop dan HP.

- [x] **3.7.9 Peringatan dan galat**
  *Isi:* peringatan tanggal masa depan dan dompet arsip; satu kotak galat di dasar form.
  - Galat hanya muncul di dasar form. Tandai juga kolom yang salah.
  - *Dikerjakan 11 Nov 2026.* Kotak galat tetap satu, tetapi kolom yang
    dimaksud kini ikut ditandai merah (`aria-invalid`) untuk nominal, tanggal,
    atau dompet. Penentuannya dari kata di pesan galat, jadi pesan yang tidak
    menyebut kolomnya tidak menandai apa pun. Dicoba dengan nominal tidak
    valid di desktop dan HP.

### 3.8 Form pindah uang (jenis Transfer)

- [x] **3.8.1 Dari dompet dan Ke dompet**
  *Isi:* dua dropdown; tujuan terisi otomatis.
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Dua dropdown tampil dan
    tujuan terisi otomatis.

- [x] **3.8.2 Nominal keluar dan kotak jumlah masuk**
  *Isi:* kolom nominal dan kotak "Rp … masuk ke …".
  - Untuk transfer semata uang kotak itu hanya mengulang nominal. Tampilkan
    bila ada beda (kurs atau biaya).
  - *Dikerjakan 11 Nov 2026.* Pada transfer semata uang, kotak "… masuk ke …"
    kini hanya tampil bila ada biaya (atau untuk meminta dompet tujuan yang
    berbeda). `browser_smoke.py` diperbarui: tes lama mengharapkan kotak itu
    selalu tampil.

- [x] **3.8.3 Beda mata uang**
  *Isi:* "Isi kurs" / "Isi jumlah diterima", pratinjau hasil, centang konfirmasi kurs.
  - Belum dilihat. Tinjau saat giliran.
  - *Ditinjau dan dikerjakan 11 Nov 2026* (BCA IDR → Ziraat TRY, data
    contoh, desktop dan HP). Tiga hal diperbaiki: (1) galat "Konfirmasi
    kurs…" muncul di dasar form sementara centangnya di atas dan tidak
    ditandai; kini baris centang ikut ditandai dan galatnya hilang saat
    dicentang; (2) kalimat bantuan "…batas angka yang dapat disimpan tepat"
    diganti kalimat sesuai mode (isi kurs atau isi jumlah diterima); (3)
    kurs di bawah 1 sulit dibaca ("1 IDR = 0,0025 TRY"), jadi pratinjau
    menambah baris kebalikannya ("atau 1 TRY ≈ 400 IDR"). Cara menghitung
    dan pemeriksaan kurs tidak diubah. Belum dilihat: transfer beda mata
    uang dari catatan impor.

- [x] **3.8.4 Tanggal debit dan tanggal kredit**
  *Isi:* dua kolom tanggal.
  - **[keputusan]** Dua tanggal selalu tampil walau biasanya sama. Usul: satu
    tanggal sebagai bawaan + "Tanggal masuk berbeda?".
  - *Dikerjakan 11 Nov 2026.* (pemilik menyetujui semua usul) Transfer baru
    mulai dengan satu kolom "Tanggal" untuk kedua sisi dan tautan "Tanggal
    masuk berbeda?" yang membuka dua kolom. Transfer yang sudah ada selalu
    menampilkan dua kolom, karena tanggalnya bisa berbeda atau belum diketahui
    dan tidak boleh diisi tebakan. `recovery_browser.py` diperbarui untuk
    mengklik tautan itu.

- [x] **3.8.5 Biaya tambahan**
  *Isi:* kolom biaya di luar nominal transfer.
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Kolom biaya tampil dengan
    keterangannya.

- [x] **3.8.6 Pasangan transfer**
  *Isi:* saran "Mungkin pasangan transfer" dan dropdown "Catatan pasangan"
  (saat mengubah catatan impor).
  - Belum dilihat. Tinjau saat giliran.
  - *Ditinjau dan dikerjakan 11 Nov 2026* dengan dua mutasi sintetis (debit
    di satu dompet, kredit di dompet lain), desktop dan HP. Saran dan
    dropdown bekerja: memilih saran mengisi dompet tujuan, nominal, kedua
    tanggal, dan dropdown pasangan. Polesan: tombol saran yang dipilih kini
    ditandai (`aria-pressed`, ikon centang di depan) dan memuat potongan
    keterangan pasangannya supaya dua kandidat senominal bisa dibedakan;
    kalimatnya menjelaskan bahwa dua catatan digabung. Alur gabungnya
    sendiri dicakup `bank_auto_browser.py` dan `browser_smoke.py`.

- [x] **3.8.7 Alasan perubahan dan Pisahkan transfer**
  *Isi:* kolom "Alasan perubahan finansial atau tanggal"; tombol Pisahkan
  transfer dengan konfirmasi.
  - Kolom alasan tampil juga pada transfer baru yang belum punya apa pun
    untuk diubah. Sembunyikan untuk catatan baru.
  - *Dikerjakan 11 Nov 2026.* Kolom "Alasan perubahan" tidak lagi tampil pada
    transfer baru; tetap tampil saat mengubah catatan yang sudah ada.

### 3.9 Jenis lain di form

- [x] **3.9.1 Perpindahan dana**
  *Isi:* pilihan arah (keluar dari / masuk ke rekening) dan kategori.
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Pilihan arah dan kategori
    tampil di desktop dan HP (tema terang dan gelap); penjagaan tanda dan
    nominal nol dicakup `bank_auto_browser.py`.

- [x] **3.9.2 Cek saldo**
  *Isi:* "Saldo yang benar sekarang" dan saldo catatan hari ini.
  - Kolom tanggal tetap bisa diubah padahal hanya hari ini yang diterima;
    galatnya baru muncul saat simpan. Kunci atau sembunyikan.
  - Selisih tidak terlihat sebelum disimpan. Tulis langsung ("Selisih
    −Rp 20.000 akan dicatat").
  - *Dikerjakan 11 Nov 2026.* Pada Cek saldo baru, kolom tanggal dikunci ke
    hari ini dengan keterangan "Cek saldo selalu memakai tanggal hari ini"
    (berpindah ke Cek saldo dari jenis lain juga mengembalikan tanggal ke
    hari ini). Selisih ditulis langsung di bawah nominal: "Selisih −Rp …
    akan dicatat sebagai penyesuaian", atau "Sama dengan catatan…" bila nol.
    Cek saldo lama yang dibuka untuk diubah tetap memakai kolom tanggal yang
    bisa diubah, seperti sebelumnya, supaya tanggal penyesuaian lama tidak
    berpindah diam-diam.

### 3.10 Cek transaksi impor

- [x] **3.10.1 Mode cek**
  *Isi:* judul "Cek transaksi ini", pilihan jenis terbatas, dompet/tanggal/nominal terkunci.
  - Subjudulnya masih kalimat umum form catat. Jelaskan tugasnya ("Pilih jenis
    yang benar; nominal dan tanggal mengikuti bank").
  - *Dikerjakan 11 Nov 2026.* Subjudul mode cek: "Pilih jenis yang benar.
    Dompet, tanggal, dan nominal mengikuti mutasi bank."

- [x] **3.10.2 Asal dan fakta transaksi**
  *Isi:* kotak fakta bank dan keputusan perubahan.
  - Waktu keputusan ditulis mentah (format ISO). Tulis sebagai tanggal dan jam biasa.
  - *Dikerjakan 11 Nov 2026.* Waktu keputusan perubahan ditulis sebagai
    tanggal dan jam biasa ("11 Nov 2026, 18.05", zona waktu perangkat);
    nilai ISO aslinya tetap ada di atribut `datetime`. Nilai tersimpan tidak
    diubah.

- [x] **3.10.3 Alasan perubahan**
  *Isi:* kolom alasan di bawah fakta.
  - Tampil walau tidak ada nominal atau tanggal yang bisa diubah. Tampilkan
    hanya saat diperlukan.
  - *Dikerjakan 11 Nov 2026.* Kolom alasan tidak lagi tampil saat mengecek
    mutasi impor yang dompet, tanggal, dan nominalnya terkunci, dan tidak
    tampil saat dua mutasi impor hanya digabung menjadi transfer. Tetap
    tampil di tempat alasan memang bisa diminta: mengubah catatan bersumber
    bank yang sudah dikonfirmasi, mengubah transfer, dan menjadikan mutasi
    impor transfer tanpa memilih pasangan.

### 3.11 Rincian nominal

- [x] **3.11.1 Jendela rincian**
  *Isi:* jenis, tanggal, dompet, nominal, kategori, keterangan, fakta sumber; baca saja.
  - Judulnya "Rincian nominal" padahal isinya rincian transaksi lengkap. Ganti
    judul (dipakai 3 file tes).
  - Tidak ada jalan ke Ubah dari sini. Tambah tombol "Ubah".
  - *Dikerjakan 11 Nov 2026.* Judul jendela dan label tombol nominal menjadi
    "Rincian transaksi" (tiga file tes diperbarui). Tombol "Ubah"
    ditambahkan di kaki jendela; tidak tampil untuk histori baca saja (cash
    lama, dompet arsip).

### 3.12 Kelola kategori

- [ ] **3.12.1 Kategori aktif**
  *Isi:* tambah dan hapus; maksimal 100.
  - **[keputusan]** Belum bisa ganti nama: hapus + tambah membuat nama baru dan
    catatan lama tetap memakai nama lama.
  - *Dilewati 11 Nov 2026, belum dicentang.* Butir ini tidak memuat usul
    yang bisa langsung dikerjakan: ganti nama berarti memilih nasib catatan
    lama (ikut berganti nama, yang menulis ulang kategori di banyak
    transaksi sekaligus aturan, anggaran, dan template; atau tetap memakai
    nama lama). Itu perubahan data lintas dua penyimpanan dan perlu
    keputusan pemilik lebih dulu.

- [x] **3.12.2 Anggaran bulanan**
  *Isi:* satu kolom isian per kategori, per mata uang.
  - Semua kategori (±30) mendapat kolom isian. Tampilkan yang sudah
    beranggaran + "Tambah anggaran".
  - *Dikerjakan 11 Nov 2026.* Tab Anggaran hanya menampilkan kategori yang
    sudah beranggaran; yang lain ditambahkan lewat dropdown "Tambah
    anggaran". Mengosongkan kolom tetap menghapus batasnya.
    `category_browser.py` diperbarui.

- [x] **3.12.3 Aturan kata kunci**
  *Isi:* maksimal 200; tiap aturan tiga kolom dan tombol hapus.
  - Belum ada pencarian dan daftarnya bisa sangat panjang. Tambah cari dan
    tampilan satu baris per aturan.
  - *Dikerjakan 11 Nov 2026.* Kotak "Cari aturan" menyaring menurut kata
    kunci atau kategori dan menulis "N dari M aturan". Di layar lebar tiap
    aturan menjadi satu baris (kata kunci, kategori, mode, tombol hapus
    berikon); di HP tetap bertumpuk. Nomor aturan tetap nomor aslinya walau
    disaring.

- [x] **3.12.4 Ekspor dan impor pengaturan**
  *Isi:* dua tombol berkas JSON, batas 128 KiB.
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Ekspor dan impor
    pengaturan kini berada di tab Berkas; alurnya dicakup
    `category_browser.py`, `keyword_pack_browser.py`,
    `confirmed_mapping_browser.py`, dan `bank_description_browser.py`.

- [x] **3.12.5 Susunan jendela dan simpan**
  *Isi:* empat bagian dalam satu gulungan; Batal dan Simpan pengaturan.
  - Pecah jadi tab (Kategori · Anggaran · Aturan · Berkas).
  - Klik di luar jendela atau Escape membuang semua perubahan tanpa bertanya → 5.9.1.
  - *Dikerjakan 11 Nov 2026.* Jendela dipecah menjadi empat tab: Kategori ·
    Anggaran · Aturan · Berkas; isian di tab lain tetap dipertahankan sampai
    disimpan atau dibatalkan. Lima file tes diperbarui untuk membuka tabnya
    dulu. Pertanyaan sebelum membuang perubahan dikerjakan di 5.9.1.

### 3.13 Isi kategori otomatis

- [x] **3.13.1 Ringkasan dan penjelasan**
  *Isi:* kotak "N cocok dengan aturan otomatis · N perlu pilihan" dan satu
  paragraf aturan bank.
  - Saat tidak ada kecocokan tetap tampil kotak hijau "0 cocok…", paragraf
    panjang, dan tombol "Terapkan 0 kategori". Buat keadaan kosong yang ringkas.
  - Lipat paragraf aturan bank di balik "Apa yang terjadi saat Terapkan?".
  - *Dikerjakan 11 Nov 2026.* Tanpa kecocokan, jendela hanya berisi satu
    kalimat dan tombol "Tutup" (tanpa kotak hijau "0 cocok", paragraf
    aturan, dan "Terapkan 0 kategori"). Paragraf aturan bank dilipat di
    balik "Apa yang terjadi saat Terapkan?". `bank_review_browser.py`
    diperbarui.

- [x] **3.13.2 Baris saran**
  *Isi:* judul, tanggal · dompet · nominal, alasan saran, dropdown "Kategori pilihan".
  - Belum dilihat dengan data yang cocok. Tinjau saat giliran.
  - *Diperiksa 11 Nov 2026 dengan empat catatan sintetis yang cocok (desktop
    dan HP), tanpa perubahan kode.* Judul, tanggal · dompet · nominal,
    alasan saran, dan dropdown tampil utuh; di HP dropdown turun ke bawah
    teksnya.

- [x] **3.13.3 Paginasi dan Terapkan**
  *Isi:* 50 per halaman; tombol "Terapkan N kategori" berlaku untuk semua halaman.
  - Belum dilihat dengan data yang cocok. Tinjau saat giliran.
  - *Dikerjakan 11 Nov 2026.* Tombol Sebelumnya/Berikutnya disembunyikan
    bila hanya satu halaman; bila lebih, barisnya menyebut "Terapkan berlaku
    untuk semua halaman". Dilihat dengan empat kecocokan (satu halaman);
    daftar lebih dari 50 kecocokan belum dilihat.

### 3.14 Hapus transaksi

- [x] **3.14.1 Konfirmasi hapus**
  *Isi:* dialog; alasan wajib untuk catatan yang bersumber dari bank.
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Dialog hapus dan alasan
    wajib untuk catatan bersumber bank dicakup `source_browser.py` dan
    `browser_smoke.py`. Warna tombol aksinya dikerjakan di 5.9.2.

---

## Bab 4 — Impor mutasi

Bagian bersama yang ikut tampil: bar atas (5.2), banner (5.3). Tab mata uang
tidak tampil di halaman ini.

### 4.1 Kepala halaman

- [x] **4.1.1 Judul**
  *Isi:* "Biar file yang bantu." / "Kurangi ketik satu-satu. Mulai dari mutasi rekening."
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Judul dan subjudul tampil
    di desktop dan HP, tema terang dan gelap.

- [x] **4.1.2 Tombol kepala**
  *Isi:* Kelola mata uang, Kelola kategori, Catat transaksi (susunan dari MW-50).
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.* Tiga tombol kepala tampil
    dan bekerja.

### 4.2 Periksa kelengkapan mutasi

Tampil setelah ada file yang tersimpan.

- [x] **4.2.1 Kepala bagian**
  *Isi:* judul dan satu kalimat pengantar.
  - Bagian ini muncul di atas area unggah dan mendorongnya ke bawah, dan
    judulnya lebih besar dari judul panel lain (gaya inline, lihat MW-69).
    Pindah ke bawah area unggah atau lipat sebagai bawaan; samakan gayanya.
  - Kalimat pengantar penuh istilah ("backfill", "batas saldo awal",
    "pemeriksaan kapasitas"). Tulis ulang.
  - *Dikerjakan 11 Nov 2026.* Bagian ini pindah ke bawah area unggah dan
    pratinjau, memakai kepala panel biasa (gaya inline dibuang), dan
    pengantarnya ditulis ulang tanpa "backfill", "batas saldo awal", dan
    "pemeriksaan kapasitas".

- [x] **4.2.2 Baris file sumber**
  *Isi:* "Dompet · periode · N mutasi sumber"; 10 terbaru + "Tampilkan file
  sumber sebelumnya".
  - Status (cocok atau ada selisih) baru terlihat setelah baris dibuka.
    Tampilkan ringkasnya di baris. **[cek]** biaya hitungnya.
  - *Dikerjakan 11 Nov 2026.* Tiap baris file kini membawa lencana ringkas:
    "Cocok", "Selisih …", "Belum lengkap", atau "Belum terverifikasi".
    **[cek]** biaya hitungnya: satu pemeriksaan membaca seluruh tautan dan
    catatan, jadi lencana dihitung setelah halaman tampil, satu kartu per
    giliran (bukan saat render pertama); membuka kartu menghitungnya saat
    itu juga. Belum diukur pada buku besar yang sangat panjang dengan
    sepuluh file.

- [x] **4.2.3 Perbandingan saldo**
  *Isi:* saldo penutupan file dan saldo catatan; status batas saldo awal dan kelengkapan.
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026.* Dilihat setelah satu impor sintetis yang cocok.
    Hanya istilah "Batas saldo awal" diganti "Titik awal saldo"; hitungannya
    tidak diubah.

- [x] **4.2.4 Form pelengkapan**
  *Isi:* alasan, dua centang, "Pratinjau pelengkapan".
  - Form tampil walau statusnya sudah "lengkap" dan saldonya cocok. Tampilkan
    hanya bila ada yang bisa dilengkapi.
  - *Dikerjakan 11 Nov 2026.* Bila statusnya lengkap dan selisihnya nol,
    form pelengkapan diganti satu kalimat "Catatan sudah lengkap dan
    saldonya cocok dengan file ini." Pada keadaan lain form tetap tampil
    seperti sebelumnya.

- [ ] **4.2.5 Hasil pratinjau pelengkapan**
  *Isi:* jumlah transaksi yang akan ditambah, saldo usulan, "Lengkapi dan simpan".
  - Belum dilihat. Tinjau saat giliran.
  - *Belum dicentang (11 Nov 2026).* Tidak dilihat langsung di sesi ini.
    Alurnya (pratinjau "N transaksi akan ditambahkan", lalu simpan) lulus di
    `backfill_browser.py` pada build ini, tetapi tampilannya belum ditinjau.

- [ ] **4.2.6 Transfer bersumber yang dihapus**
  *Isi:* daftar, kolom alasan, "Pulihkan seluruh transfer".
  - Belum dilihat. Tinjau saat giliran.
  - *Belum dicentang (11 Nov 2026).* Tidak dilihat langsung di sesi ini.
    Pemulihan transfer lulus di `source_browser.py` pada build ini, tetapi
    tampilannya belum ditinjau.

### 4.3 Format dan dompet tujuan

- [x] **4.3.1 Tab format**
  *Isi:* "Ziraat TRY · otomatis" / "CSV / Excel umum" dan kalimat "Mengganti
  format atau dompet membatalkan pratinjau…".
  - Tab awal selalu Ziraat, juga bagi yang tidak punya dompet TRY. Pilih tab
    sesuai dompet yang ada, atau ingat pilihan terakhir.
  - Kalimat peringatannya selalu tampil. Cukup saat ada pratinjau.
  - *Dikerjakan 11 Nov 2026.* Tab awal mengikuti dompet yang ada: bila ada
    dompet aktif tetapi tidak satu pun TRY, halaman dibuka di "CSV / Excel
    umum"; selain itu tetap Ziraat. Pilihan terakhir tidak diingat. Kalimat
    "Mengganti format atau dompet membatalkan pratinjau…" hanya tampil saat
    ada pratinjau.

- [x] **4.3.2 Kepala panel**
  *Isi:* "Mutasi masuk, catatan beres." dan lencana format.
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.*

- [x] **4.3.3 Simpan ke dompet**
  *Isi:* dropdown dompet; peringatan "Belum ada dompet … aktif" dengan tombol tambah.
  - Pada mode umum, dompet yang sama ditulis lagi sebagai "Dompet tujuan" di
    dalam kotak pemetaan. Buang salah satunya.
  - *Dikerjakan 11 Nov 2026.* Tulisan "Dompet tujuan" di dalam kotak
    pemetaan dibuang; dompet hanya dipilih di "Simpan ke dompet".

### 4.4 Unggah Ziraat

- [x] **4.4.1 Area taruh file**
  *Isi:* ikon, "Taruh file Excel di sini", tombol "Pilih file .xlsx", batas 8 MB.
  - Tidak ada sorotan saat file diseret ke atasnya.
  - Di mode contoh tombolnya mati tanpa penjelasan di tempat; alasannya hanya
    ada di banner atas.
  - *Dikerjakan 11 Nov 2026.* Area taruh file disorot saat file diseret ke
    atasnya. Di mode contoh, di bawah tombol yang mati tertulis alasannya
    dengan tautan "Ganti ke data sendiri".

- [x] **4.4.2 Status dan galat**
  *Isi:* "Membaca mutasi…", "Menyimpan mutasi…", kotak galat.
  - Pesan salah ekstensi masih menyebut "versi awal". Tinjau semua pesan galat.
  - *Dikerjakan 11 Nov 2026.* Pesan salah ekstensi tidak lagi menyebut
    "versi awal" dan menunjuk ke "CSV / Excel umum"; pesan ukuran file
    menyarankan periode yang lebih pendek. Galat yang muncul saat pratinjau
    sudah tampil kini ditulis di dekat tombol simpan, bukan di atas
    pratinjau yang sudah tergulir lewat. Pesan galat dari pembaca file
    (`importer.ts`, `genericImport.ts`) dibaca dan tidak diubah.

- [x] **4.4.3 Catatan privasi**
  *Isi:* "File dibaca di browser. Tidak dikirim ke server."
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.*

### 4.5 Pemetaan CSV / Excel umum

- [x] **4.5.1 Kepala dan syarat file**
  *Isi:* judul dan paragraf syarat (satu rekening, satu mata uang, ada saldo
  setelah tiap transaksi).
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.*

- [x] **4.5.2 Pemisah CSV dan pilih file**
  *Isi:* dropdown pemisah dan tombol "Pilih file CSV/Excel".
  - **[keputusan]** Pemisah harus dipilih sendiri dan tampil juga untuk file
    Excel. Usul: tebak dari isi file sebagai saran, tampilkan hanya untuk CSV/TSV.
  - Belum bisa seret-taruh (hanya tombol), beda dengan mode Ziraat.
  - *Dikerjakan 11 Nov 2026.* (pemilik menyetujui semua usul) Dropdown
    pemisah hanya tampil setelah file CSV/TSV dipilih. Pemisah ditebak dari
    baris-baris awal file (hanya bila semua baris sepakat pada satu pemisah)
    dan ditulis sebagai tebakan yang bisa diubah; tabel contoh di bawahnya
    memperlihatkan hasilnya. Area pilih file kini juga menerima seret-taruh.
    `currency_import_browser.py` diperbarui.

- [x] **4.5.3 Worksheet dan baris judul kolom**
  *Isi:* dropdown worksheet dan nomor baris judul.
  - Dropdown Worksheet tampil walau hanya satu lembar (CSV).
  - Label menempel pada kalimat di atasnya.
  - *Dikerjakan 11 Nov 2026.* Dropdown Worksheet hanya tampil bila file
    punya lebih dari satu lembar; jarak label ke kalimat di atasnya diberi
    ruang.

- [x] **4.5.4 Tabel contoh nilai**
  *Isi:* judul kolom + tiga baris, maksimal delapan kolom.
  - **[bug]** Di HP 390px kolom ke-2 dan ke-3 hilang (`display: none`), karena
    tabel memakai kelas `transactions-table` yang menyembunyikan kolom di layar
    kecil. Terukur: dari 4 kolom CSV uji hanya Tanggal dan Saldo yang tampil.
  - *Dikerjakan 11 Nov 2026.* **[bug]** diperbaiki: tabel contoh memakai
    kelasnya sendiri, tidak lagi `transactions-table`. Diukur ulang di HP
    390px dengan CSV uji 4 kolom: keempat kolom tampil (sebelumnya dua
    hilang); tabelnya bisa digeser bila kolomnya banyak.

- [x] **4.5.5 Pemetaan kolom**
  *Isi:* tanggal, keterangan, saldo, mode nominal, nominal atau debit + kredit,
  referensi, mata uang.
  - Tombol "Buat pratinjau impor" tidak menunggu kolom wajib terisi;
    kekurangannya baru ketahuan sebagai galat setelah diklik. Tunjukkan apa
    yang belum dipilih.
  - *Dikerjakan 11 Nov 2026.* Di atas tombol tertulis "Belum lengkap: kolom
    saldo, pemisah desimal, …" dan tombol "Buat pratinjau impor" mati sampai
    daftar itu kosong. Pemeriksaan isi file oleh pembaca tetap berjalan
    seperti sebelumnya setelah tombol diklik.

- [x] **4.5.6 Format**
  *Isi:* format tanggal, pemisah desimal, urutan mutasi.
  - **[keputusan]** Desimal dan urutan wajib dipilih manual. Usul: tawarkan
    tebakan dari data (mis. tanggal naik atau turun) yang tetap harus dikonfirmasi.
  - *Dikerjakan 11 Nov 2026.* (pemilik menyetujui semua usul) Di bawah
    dropdown desimal dan urutan muncul saran dari data ("Dari data tampaknya
    koma", "…paling lama di atas") dengan tautan "Pakai saran". Saran tidak
    pernah dipilihkan otomatis, dan tidak muncul bila datanya ambigu (mis.
    hanya tiga digit di belakang tanda, atau tanggal tidak berurutan).

- [x] **4.5.7 Konfirmasi mata uang dan "Buat pratinjau impor"**
  *Isi:* centang konfirmasi dan tombol utama.
  - Pratinjau muncul jauh di bawah dan layar tidak bergerak. Terukur di HP:
    pratinjau mulai ±330px di bawah tepi bawah layar, jadi tombolnya terasa
    tidak berbuat apa-apa. Gulir ke pratinjau dan lipat kotak pemetaan.
  - **[fitur]** Ingat pemetaan terakhir per dompet.
  - *Dikerjakan 11 Nov 2026.* Setelah pratinjau dibuat, layar bergulir ke
    pratinjau dan kotak pemetaan terlipat menjadi satu baris dengan tombol
    "Ubah pemetaan". Diukur di HP 390px: tepi atas pratinjau berada di tepi
    atas layar (sebelumnya ±330px di bawah layar). Berlaku juga untuk impor
    Ziraat. **[fitur]** "ingat pemetaan terakhir per dompet" tidak
    dikerjakan.

### 4.6 Panel "Cara kerjanya"

- [x] **4.6.1 Tiga langkah dan catatan format**
  *Isi:* Pilih dompet, Cek hasil bacaan, Simpan lalu rapikan nanti; kotak catatan.
  - Di HP panel ini berada di antara area unggah dan pratinjau, menambah jarak
    ke pratinjau. Pindah ke akhir halaman atau lipat setelah file dibaca.
  - *Dikerjakan 11 Nov 2026.* Di HP panel "Cara kerjanya" disembunyikan
    selama ada pratinjau, sehingga tidak lagi menyela antara area unggah dan
    pratinjau. Di desktop tidak berubah.

### 4.7 Pratinjau "Periksa sebelum disimpan"

- [x] **4.7.1 Kepala pratinjau**
  *Isi:* nama file, periode, jumlah transaksi.
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.*

- [x] **4.7.2 Ringkasan angka**
  *Isi:* dipilih, sudah pernah diimpor, perlu dirapikan, jenis perlu dicek,
  kategori belum diisi.
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.*

- [x] **4.7.3 Peringatan**
  *Isi:* peringatan file, jenis belum dikonfirmasi, kandidat manual, tanggal
  masa depan, mutasi dilewati; ditambah dua paragraf bantuan.
  - Semuanya bertumpuk di atas tabel; di HP tabel baru mulai ±1.500px setelah
    kepala pratinjau. Jadikan satu daftar ringkas dengan detail terlipat.
  - Paragraf aturan bank ("Tarik ATM menjadi pengeluaran…") ikut tampil pada
    impor umum. Tampilkan sesuai format.
  - *Dikerjakan 11 Nov 2026.* Peringatan dan paragraf bantuan menjadi satu
    daftar: satu baris ringkas per hal dengan "Detail" yang bisa dibuka.
    Paragraf aturan bank hanya tampil pada impor Ziraat, terlipat di balik
    "Aturan bank yang dipakai". Jarak kepala pratinjau ke tabel di HP tidak
    diukur ulang dalam piksel.

- [x] **4.7.4 Saldo awal dari file**
  *Isi:* centang "Gunakan saldo sebelum transaksi pertama" (hanya untuk dompet
  yang belum punya catatan).
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.*

- [x] **4.7.5 Proyeksi saldo**
  *Isi:* proyeksi setelah impor, saldo akhir statement, selisih.
  - Cocok dan selisih tampil sama (teks polos). Beri tanda jelas: cocok ✓ atau
    selisih ⚠ dengan nominalnya.
  - *Dikerjakan 11 Nov 2026.* Kotak proyeksi kini dibuka dengan "Cocok
    dengan saldo akhir file." (hijau, ikon centang) atau "Selisih ±Rp … dari
    saldo akhir file." (kuning, ikon peringatan).

- [x] **4.7.6 Cari dan filter pratinjau**
  *Isi:* kotak cari, dropdown tampilan (7 pilihan), "N terlihat · N dipilih total".
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.*

- [x] **4.7.7 Kategori massal untuk yang terlihat**
  *Isi:* dropdown kategori dan "Terapkan kategori ke N mutasi".
  - Belum ada aksi massal untuk jenis. Pada impor umum semua baris datang
    sebagai "Perlu dicek" (8 dari 8 pada file uji) dan harus diubah satu per
    satu. Tambah "masuk = pemasukan, keluar = pengeluaran untuk yang dipilih"
    (konsepnya sudah ada di 3.5.3).
  - *Dikerjakan 11 Nov 2026.* Tombol "Tandai jenis N mutasi: masuk =
    pemasukan, keluar = pengeluaran" berlaku untuk pilihan yang terlihat dan
    hanya mengubah baris yang jenisnya masih "Perlu dicek"; perpindahan dana
    yang sudah dikenali tidak disentuh. Pada file uji 8 baris, "jenis perlu
    dicek" turun dari 8 ke 0 dengan satu klik. Nominal dan tanggal tidak
    berubah.

### 4.8 Tabel pratinjau

- [x] **4.8.1 Centang baris dan pilih semua**
  *Isi:* centang per baris; centang kepala berlaku untuk mutasi baru yang terlihat.
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.*

- [x] **4.8.2 Sel transaksi**
  *Isi:* judul, lipatan "Keterangan bank asli", tanggal, peringatan baris,
  petunjuk operasi bank.
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.*

- [x] **4.8.3 Keputusan tumpang tindih**
  *Isi:* "Lewati" / "Transaksi berbeda"; "Pulihkan fakta bank" / "Pertahankan catatan".
  - Belum dilihat (butuh impor yang tumpang tindih). Tinjau saat giliran.
  - *Ditinjau 11 Nov 2026, tanpa perubahan kode.* Dilihat dengan satu
    catatan manual sintetis yang tanggal dan nominalnya sama dengan satu
    baris file: "Mungkin sudah dicatat manual" tampil dengan kandidatnya,
    dan "Lewati" / "Transaksi berbeda" bekerja serta menandai pilihannya.
    "Pulihkan fakta bank" / "Pertahankan catatan" tidak dilihat langsung;
    alurnya lulus di `source_browser.py`.

- [x] **4.8.4 Nominal**
  *Isi:* tanda, warna, nominal.
  - Belum ada temuan.
  - *Diperiksa 11 Nov 2026, tanpa perubahan kode.*

- [x] **4.8.5 Jenis per baris**
  *Isi:* dropdown Perlu dicek / Perpindahan dana rekening / Pemasukan atau Pengeluaran.
  - Aksi massal → 4.7.7.
  - *Diperiksa 11 Nov 2026.* Aksi massal dikerjakan di 4.7.7.

- [x] **4.8.6 Kategori per baris dan saran**
  *Isi:* dropdown kategori, catatan aturan, tombol saran.
  - Dropdownnya sempit: "Belum dikategorikan" terpotong di desktop 1440px.
  - *Dikerjakan 11 Nov 2026.* Dropdown kategori per baris dilebarkan
    (minimal 172px) sehingga "Belum dikategorikan" tidak terpotong di
    desktop.

- [x] **4.8.7 Tampilan HP**
  *Isi:* tabel yang sama, bisa digeser ke samping.
  - Terukur: tabel selebar 820px di layar 390px (area terlihat 316px).
    Nominal, Jenis, dan Kategori hanya terlihat dengan menggeser ke samping,
    tanpa tanda bisa digeser. Buat tata letak kartu per mutasi.
  - *Dikerjakan 11 Nov 2026.* Di HP tiap mutasi menjadi satu kartu: centang,
    judul dan tanggal, nominal, lalu Jenis dan Kategori selebar kartu.
    Diukur di 390px: lebar isi tabel sama dengan area terlihat (316px,
    sebelumnya 820px) dan halaman tidak bergeser ke samping. Centang "pilih
    semua" tetap ada di atas daftar kartu.

- [x] **4.8.8 Paginasi pratinjau**
  *Isi:* 50 per halaman; "Mutasi sebelumnya" / "Mutasi berikutnya".
  - Kedua tombol tampil walau hanya satu halaman. Sembunyikan (seperti MW-41).
  - *Dikerjakan 11 Nov 2026.* Tombol "Mutasi sebelumnya" / "Mutasi
    berikutnya" hanya tampil bila lebih dari satu halaman.

### 4.9 Simpan impor

- [x] **4.9.1 Teks bantuan sebelum simpan**
  *Isi:* dua paragraf dan satu catatan kaki.
  - Ringkas. "Fakta file" dan "batas catatan" perlu kalimat biasa.
  - *Dikerjakan 11 Nov 2026.* Dua paragraf dan catatan kaki diringkas
    menjadi satu paragraf; "fakta file" dan "batas catatan" diganti kalimat
    biasa.

- [x] **4.9.2 Tombol simpan**
  *Isi:* Batalkan pratinjau, Simpan fakta file saja, Simpan N transaksi.
  - Di desktop tombol utama turun ke baris kedua. Rapikan barisnya.
  - "Simpan fakta file saja" adalah opsi lanjutan tetapi sejajar dengan tombol
    utama. Pindah ke "Opsi lain" (dipakai 2 file tes).
  - *Dikerjakan 11 Nov 2026.* "Batalkan pratinjau" dan "Simpan N transaksi"
    kini satu baris di kanan. "Simpan fakta file saja" pindah ke lipatan
    "Opsi lain" dengan penjelasannya; label tombolnya tetap, dan dua file
    tes diperbarui untuk membuka lipatan dulu.

- [x] **4.9.3 Sesudah simpan**
  *Isi:* pemberitahuan singkat; pratinjau dikosongkan.
  - Tidak ada arah berikutnya. Tampilkan ringkasan hasil dengan tombol
    "Rapikan N catatan" dan "Lihat transaksi".
  - *Dikerjakan 11 Nov 2026.* Sesudah simpan tampil ringkasan "N transaksi
    tersimpan ke <dompet>" dengan jumlah yang masih perlu dirapikan dan
    tombol "Rapikan N catatan" serta "Lihat transaksi" (riwayat dompet itu,
    semua periode). Ringkasan hilang saat file berikutnya dibaca atau
    ditutup.

---

## Bab 5 — Bagian bersama

Tampil di lebih dari satu halaman. Dikerjakan sekali di sini untuk semuanya.

### 5.1 Navigasi

- [ ] **5.1.1 Menu samping (desktop)**
  *Isi:* logo, empat menu, lencana jumlah di Transaksi.
  - Lencana jumlah tidak punya label untuk pembaca layar. Beri "N perlu dirapikan".

- [ ] **5.1.2 Bagian bawah menu samping**
  *Isi:* kartu "Nggak harus sempurna.", tiga tombol cadangan, "Cadangan
  terakhir", kartu "Ruang pribadi".
  - Dua tombol cadangan → 5.6.2.

- [ ] **5.1.3 Navigasi bawah (HP)**
  *Isi:* empat tab.
  - Lencana jumlah "perlu dirapikan" tidak ada di HP, hanya di menu samping.
  - **[keputusan]** Tombol catat yang selalu terlihat di HP (mis. "+" di
    tengah navigasi). Sekarang tombol Catat ikut tergulir.

### 5.2 Bar atas

- [ ] **5.2.1 Jejak halaman**
  *Isi:* "Ruang pribadi › Ringkasan".
  - Belum ada temuan.

- [ ] **5.2.2 Pemilih tema**
  *Isi:* Sistem / Terang / Gelap.
  - Di HP pil "Sistem ▾" jadi elemen terbesar di bar atas. Jadikan ikon saja
    atau pindah ke menu akun (tes menuntut "Tema tampilan" terlihat; 3 file).

- [ ] **5.2.3 Status simpan**
  *Isi:* pil teks di desktop, titik warna di HP.
  - Di mode contoh tertulis "Belum tersimpan", terbaca seperti masalah. Tulis
    "Data contoh".
  - **[cek]** Di HP hanya titik tanpa teks. Pastikan artinya jelas, juga bagi
    pembaca layar.

- [ ] **5.2.4 "Lokal & pribadi" dan tombol perisai**
  *Isi:* teks kecil dan tombol ikon ke jendela Privasi.
  - Tiga elemen berdampingan untuk hal yang sama (teks, perisai, menu akun
    yang berisi Privasi). Jadikan teksnya tombol ke Privasi dan buang perisai.

- [ ] **5.2.5 Menu akun**
  *Isi:* avatar "Z"; Cadangkan semuanya, Cadangkan transaksi saja, Pulihkan
  cadangan, Privasi, cadangan terakhir.
  - Avatar "Z" ditulis mati → 1.1.1.

### 5.3 Banner

- [ ] **5.3.1 Banner data contoh**
  *Isi:* "Kenalan dulu pakai data contoh." dan "Mulai pakai data sendiri" (→ 5.7).
  - Belum ada temuan.

- [ ] **5.3.2 Pengingat cadangan**
  *Isi:* "Belum ada cadangan lengkap." atau "Sudah lebih dari 7 hari…";
  Cadangkan sekarang, Nanti saja.
  - Muncul langsung setelah "Mulai dari kosong", saat belum ada satu pun
    transaksi. Tunda sampai ada catatan.

- [ ] **5.3.3 Masalah simpan**
  *Isi:* Unduh pekerjaan yang belum tersimpan, Coba simpan lagi, Muat catatan terbaru.
  - Belum dilihat. Tinjau saat giliran.

### 5.4 Bilah mata uang dan bulan

- [ ] **5.4.1 Tab mata uang**
  *Isi:* bendera, kode, nama (nama disembunyikan di HP).
  - Bendera hanya ada untuk IDR, TRY, USD, EUR; mata uang lain memakai "¤".
    Lengkapi atau buang bendera.

- [ ] **5.4.2 Tombol Kelola mata uang**
  *Isi:* membuka 5.5.
  - Belum ada temuan.

- [ ] **5.4.3 Pemilih bulan dan periode**
  *Isi:* kolom bulan di kanan bilah; pilihan "bulan ini / seluruh catatan" ada
  di dropdown terpisah (1.2.2, 3.3.2).
  - Satukan jadi satu kontrol: ‹ November 2026 › + "Seluruh catatan".
  - **[cek]** Kolom bulan memakai `input type="month"`, yang di Firefox dan
    Safari desktop tidak punya pemilih (jadi kotak teks). Kontrol baru
    sekaligus menghapus ketergantungan itu.

### 5.5 Kelola mata uang

- [ ] **5.5.1 Cari dan tambah**
  *Isi:* kotak cari menyaring isi dropdown "Mata uang tambahan"; tombol tambah.
  - Cari → dropdown → tombol terasa berbelit. Tampilkan hasil cari sebagai
    daftar yang bisa langsung ditambah.

- [ ] **5.5.2 Daftar tampil**
  *Isi:* tiap mata uang dengan Sembunyikan dan Buka laporan.
  - Tertulis "Urutan ini dipakai pada tab mata uang" tetapi urutannya tidak
    bisa diubah. Tambah naik/turun.

- [ ] **5.5.3 Tercatat tetapi disembunyikan**
  *Isi:* mata uang yang punya dompet tetapi tidak ditampilkan.
  - Belum dilihat. Tinjau saat giliran.

### 5.6 Cadangan dan pemulihan

- [ ] **5.6.1 Cadangkan semuanya**
  *Isi:* mengunduh satu file berisi dompet, transaksi, dan pengaturan kategori.
  - Belum ada temuan.

- [ ] **5.6.2 Cadangkan transaksi saja**
  *Isi:* mengunduh catatan tanpa pengaturan kategori.
  - **[keputusan]** Dua tombol cadangan berdampingan tanpa penjelasan bedanya,
    dan hanya "semuanya" yang dihitung sebagai cadangan terakhir. Usul:
    jadikan "transaksi saja" opsi sekunder (dipakai 8 file tes).

- [ ] **5.6.3 Pulihkan cadangan**
  *Isi:* pilih file → dialog berisi jumlah dompet, transaksi, kategori, aturan.
  - Dialog hanya menyarankan mencadangkan isi sekarang. Tambah tombol
    "Cadangkan dulu" di dialog itu.

### 5.7 Mulai pakai data sendiri

- [ ] **5.7.1 Dialog pilihan**
  *Isi:* Batal, Mulai dari kosong, Bawa transaksi saya; lipatan tinjau transaksi contoh.
  - Tanpa transaksi buatan sendiri kalimatnya "0 transaksi akan dibawa. Semua
    0 transaksi tambahan…" dan tombol utama mati tanpa alasan. Buat teks
    khusus dan jadikan "Mulai dari kosong" tombol utama pada keadaan itu.

- [ ] **5.7.2 Mulai dari kosong**
  *Isi:* mengganti data contoh dengan catatan baru.
  - **[keputusan]** "Kosong" ternyata berisi 10 dompet bawaan (BCA, BCA
    Digital, BRI, GoPay, DANA, Bank Jago, SeaBank, ShopeePay, Ziraat, Papara)
    yang harus dihapus satu per satu bila tidak dipakai. Usul: langkah memilih
    dompet awal, atau mulai tanpa dompet.

### 5.8 Privasi dan cadangan

- [ ] **5.8.1 Isi penjelasan**
  *Isi:* tujuh paragraf (penyimpanan persisten, origin, cadangan JSON, Layar Utama).
  - Padat dan teknis ("origin", "script"). Susun jadi beberapa subjudul pendek
    dan taruh detail teknis di lipatan.

### 5.9 Jendela, konfirmasi, pemberitahuan

- [ ] **5.9.1 Kerangka jendela**
  *Isi:* fokus terkunci di dalam jendela; Escape dan klik luar menutup.
  - Hanya form transaksi yang bertanya sebelum membuang isian. Kelola
    kategori, form dompet, dan Kelola mata uang langsung tertutup dan
    perubahannya hilang. Samakan.
  - Bentuk lembar bawah di HP sudah dicatat sebagai MW-81.

- [ ] **5.9.2 Dialog konfirmasi**
  *Isi:* judul, teks, kolom alasan (bila wajib), Batal dan tombol aksi.
  - Tombol merah ditentukan dari label yang diawali "Hapus", sehingga "Ganti
    data tersimpan dengan dompet kosong" tampil hijau. Pakai penanda bahaya
    yang eksplisit.

- [ ] **5.9.3 Pemberitahuan**
  *Isi:* satu pesan di bawah layar, hilang setelah 5,5 detik.
  - Pesan gagal ("Perubahan belum tersimpan…") memakai ikon centang dan gaya
    yang sama dengan pesan berhasil. Buat varian galat yang tidak hilang sendiri.
  - Pesan bisa menutupi tombol di dasar jendela (terlihat di form Cek transaksi).

### 5.10 Kaki halaman

- [ ] **5.10.1 Kalimat penutup**
  *Isi:* "Nggak harus rapi sekaligus. Yang penting mulai." dan "Cadangkan secara berkala".
  - "Cadangkan secara berkala" hanya teks. Jadikan tautan ke Cadangkan
    semuanya, atau buang.
  - **[fitur]** Tampilkan versi atau commit build.

### 5.11 Lintas halaman

- [ ] **5.11.1 Zona waktu "hari ini"**
  *Isi:* batas hari untuk saldo aktual, laporan, dan tanggal bawaan form.
  - **[keputusan]** "Hari ini" dikunci ke Europe/Istanbul di lima tempat
    (`App.tsx:59`, `TransactionModal.tsx:18`, `RecoveryImportView.tsx:101`,
    `finance.ts:320`, `backupReminder.ts:85`). Di zona lain batas harinya
    bergeser (di WIB, pukul 00.00–04.00 masih dihitung kemarin). Pilih: zona
    perangkat, pengaturan, atau tetap; lalu satukan ke satu fungsi.

- [ ] **5.11.2 Format tanggal di form**
  *Isi:* kolom tanggal bawaan browser.
  - Tampilannya mengikuti bahasa browser (terlihat "11/08/2026" untuk
    8 Nov 2026), beda dengan "8 Nov 2026" di tempat lain. Sudah dicatat di
    `MICRO_TASKS.md` (tahap UX) dan belum dikerjakan.

- [ ] **5.11.3 Format nominal di kolom isian**
  *Isi:* kolom nominal di form transaksi, saldo awal dompet, anggaran.
  - Nominal diketik dan tampil tanpa pemisah ribuan ("2400000"). Format saat
    mengetik, atau tampilkan "Rp 2.400.000" di bawah kolom. Aturan `parseMoney`
    tidak boleh berubah.

- [ ] **5.11.4 Istilah**
  *Isi:* nama jenis, status, dan konsep sumber di seluruh aplikasi.
  - Satu hal punya beberapa nama: "Cek saldo" / "Penyesuaian" / "Cocokkan
    saldo"; "Perpindahan dana" / "Perpindahan dana rekening"; "Perlu dicek" /
    "Perlu dirapikan".
  - Istilah teknis tampil ke pengguna: "legacy", "backfill", "fakta sumber",
    "batas saldo awal". Buat daftar istilah, lalu seragamkan.

---

## Keputusan yang ditunggu

Butir **[keputusan]**, dikumpulkan supaya bisa diputuskan lebih dulu:

| Butir | Yang perlu dipilih |
|---|---|
| 1.1.1 | Nama sapaan dan avatar: pengaturan, atau sapaan netral |
| 1.6.2 | Klik baris dompet di Ringkasan: riwayat atau form |
| 1.10.1 | Urutan bagian Ringkasan di HP |
| 3.3.4 | "Perlu dirapikan" keluar dari dropdown Jenis |
| 3.4.5 | Klik baris transaksi membuka rincian |
| 3.7.2 | Label "Perpindahan dana" dan "Transfer" |
| 3.8.4 | Satu tanggal bawaan untuk transfer |
| 3.12.1 | Ganti nama kategori dan nasib catatan lama |
| 4.5.2 | Tebak pemisah CSV dari isi file |
| 4.5.6 | Tebak desimal dan urutan mutasi sebagai saran |
| 5.1.3 | Tombol catat yang selalu terlihat di HP |
| 5.6.2 | Posisi "Cadangkan transaksi saja" |
| 5.7.2 | Dompet bawaan saat "Mulai dari kosong" |
| 5.11.1 | Zona waktu untuk "hari ini" |

## Kalau mau menyimpang dari urutan

Urutan bawaan tetap 1.1.1 dan seterusnya. Enam butir ini paling terasa oleh
pengguna dan tidak bergantung pada butir lain, jadi boleh didahulukan:

1. **4.5.4** tabel contoh kehilangan kolom di HP.
2. **4.8.7** tabel pratinjau impor di HP harus digeser untuk melihat nominal.
3. **4.5.7** pratinjau impor muncul di luar layar.
4. **5.9.1** jendela membuang perubahan tanpa bertanya.
5. **4.7.7** jenis transaksi impor umum harus diisi satu per satu.
6. **2.5.5** kotak Arsipkan setengah lebar.
