# Recharge Tracking

Dashboard tracking armada &amp; operasional untuk **Recharge Indonesia** (rental power bank, area Jabodetabek). Pure frontend — tanpa server backend — langsung konek ke Firebase, Mapbox, dan Cloudinary.

Dua halaman terpisah:

- **`driver.html`** — dipakai driver di HP saat bertugas: login PIN, checkin GPS, live tracking, lihat rute, isi checkpoint per titik (foto + status), catat transaksi keuangan, tutup tugas.
- **`admin.html`** — dipakai admin di HP/laptop (sekarang juga dilindungi login PIN admin sendiri, terpisah dari PIN driver): peta live posisi semua driver, bikin & edit rute (cari lokasi via Mapbox, hitung estimasi jarak/waktu, pilih tol/non-tol), kelola akun driver (tambah/hapus), riwayat & arsip trip per tanggal (lihat detail checkpoint & transaksi keuangan tiap trip yang sudah lewat).

## Struktur folder

```
.
├── index.html           # Landing page — 2 tombol pintasan ke Driver / Admin
├── driver.html          # Halaman driver
├── admin.html           # Halaman admin
├── css/
│   ├── base.css          # Token warna & komponen bersama (dipakai 2 halaman)
│   ├── driver.css        # Style khusus driver.html
│   └── admin.css         # Style khusus admin.html
├── js/
│   ├── config.js         # Kredensial Firebase/Cloudinary/Mapbox + init
│   ├── utils.js           # Fungsi bersama (hashPin)
│   ├── hapus.js           # Hapus permanen trip + turunannya (khusus admin)
│   ├── driver.js          # Logika driver.html
│   └── admin.js           # Logika admin.html
├── firestore.rules      # Security Rules — WAJIB di-deploy ke Firebase Console
└── README.md
```

Setiap halaman memuat file dalam urutan ini:

```html
<!-- CSS -->
<link rel="stylesheet" href="css/base.css">
<link rel="stylesheet" href="css/driver.css"> <!-- atau css/admin.css -->

<!-- SDK pihak ketiga -->
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js"></script>
<!-- admin.html juga memuat mapbox-gl.js & mapbox-gl.css -->

<!-- Kode sendiri -->
<script src="js/config.js"></script>
<script src="js/utils.js"></script>
<script src="js/driver.js"></script> <!-- atau js/admin.js -->
```

## Arsitektur singkat

- **Database & auth**: Firebase Firestore (realtime listener `onSnapshot`, bukan push notification) + Firebase Anonymous Auth. PIN driver *dan* PIN admin (dua PIN terpisah) di-hash SHA-256 di browser; akses sesungguhnya dibatasi lewat Firestore Security Rules (`firestore.rules`) — driver hanya bisa baca/tulis data miliknya sendiri, admin punya akses lebih luas (kelola driver, rute, data historis).
- **Peta & rute**: Mapbox GL JS untuk render peta, Mapbox **Search Box API** (bukan Geocoding API) untuk pencarian lokasi karena mencakup POI (gedung, hotel, apartemen), dibatasi `bbox` cakupan Jabodetabek (bukan cuma `proximity` ke titik tengah Jakarta) biar lokasi di Bogor/Depok/Tangerang/Bekasi ikut terangkat, dan Mapbox Directions API untuk estimasi jarak/waktu tempuh (opsi lewat tol / non-tol). Untuk nama tempat yang memang tidak ada di database Mapbox (toko kecil, gedung baru, dll), ada tombol 📍 di tiap titik rute buat pilih lokasi manual langsung di peta.
- **Foto checkpoint & struk**: dikompres di browser (canvas, max 1280px, JPEG kualitas 0.72) lalu diupload ke **Cloudinary** (unsigned upload preset) — dipilih supaya tidak perlu upgrade Firebase ke paket Blaze/berbayar hanya untuk Storage.
- **GPS live tracking**: `navigator.geolocation` dipush ke Firestore setiap ~75 detik selama driver checkin, dengan Wake Lock API supaya layar HP tidak mati saat bertugas.

## Setup

1. **Firebase**: buat project, aktifkan Firestore (mode production) dan Authentication → Anonymous. Isi kredensial di `js/config.js` (`firebaseConfig`).
2. **Cloudinary**: buat akun gratis, buat *Upload Preset* bertipe **Unsigned**, isi `CLOUDINARY_CLOUD_NAME` dan `CLOUDINARY_UPLOAD_PRESET` di `js/config.js`.
3. **Mapbox**: buat token akses publik, isi `MAPBOX_TOKEN` di `js/config.js`.
4. **Deploy Security Rules** — buka Firebase Console → Firestore Database → tab **Rules** → tempel seluruh isi `firestore.rules` → **Publish**. (Atau via Firebase CLI: `firebase deploy --only firestore:rules`.)
5. **Set PIN admin SEGERA setelah rules di-publish** — buka `admin.html`, masukkan PIN pilihanmu (4-6 digit) di layar login. **PIN yang kamu masukkan pertama kali itulah yang otomatis jadi PIN admin permanen** (mekanisme bootstrap tanpa backend). Jangan tunda, dan jangan bagikan link `admin.html` ke siapa pun sebelum langkah ini selesai — siapa pun yang berhasil submit PIN duluan di admin.html setelah rules aktif akan jadi admin.
6. Buka `admin.html` untuk menambahkan akun driver (nama + PIN 4-6 digit, beda dari PIN admin), lalu driver login lewat `driver.html` di HP masing-masing.
7. Deploy ke hosting statis apa saja (GitHub Pages, Netlify, Vercel, Firebase Hosting, dll) — tidak butuh server/backend. Setelah deploy, domain root (`/`) otomatis menampilkan `index.html` dengan 2 tombol pintasan ke Driver dan Admin — tidak perlu hafal `/driver.html` atau `/admin.html`.

> **Catatan keamanan**: `js/config.js` berisi kredensial yang memang aman untuk terekspos di frontend (API key Firebase, cloud name Cloudinary, token Mapbox) karena akses sesungguhnya dibatasi lewat Firestore Security Rules, Cloudinary unsigned-preset, dan scope token Mapbox. **Jangan pernah** menambahkan Cloudinary API Secret ke file ini atau file manapun di repo.
>
> **Soal kekuatan PIN**: PIN 4-6 digit (driver maupun admin) secara matematis mudah ditebak lewat brute-force kalau diserang langsung (ruang kemungkinan cuma 10.000–1.000.000 kombinasi). Keamanan sistem ini mengandalkan Firestore rate-limiting + link admin.html yang tidak disebar, bukan kekuatan kriptografis PIN itu sendiri — cukup untuk skala tim kecil internal, tapi bukan pengganti password kuat kalau suatu saat sistem ini dibuka untuk banyak orang luar.

## Status pembangunan

Dibangun bertahap (step-by-step), tahap yang sudah selesai:

1. Fondasi — koneksi Firestore & Auth
2. Login PIN driver + link ke Anonymous Auth
3. Checkin + GPS live tracking
4. Peta live tracking di admin (+ kelola/hapus akun driver)
5. Buat & edit rute (pencarian lokasi, estimasi jarak/waktu, pilihan tol)
6. Lihat rute & isi checkpoint per titik (foto, status, machine ID)
7. Transaksi keuangan per trip + tombol "Selesai" (tutup tugas harian)
8. Riwayat & arsip trip di admin — filter tanggal, lihat detail checkpoint (foto, status, machine ID, catatan) & transaksi keuangan tiap trip yang sudah lewat
9. Pengerasan (hardening) — `firestore.rules` membatasi driver hanya bisa baca/tulis data miliknya sendiri; `admin.html` sekarang dilindungi login PIN admin (skema bootstrap tanpa backend, lihat langkah Setup #5); cache offline Firestore diaktifkan (`enablePersistence`) supaya checkpoint/transaksi yang dibuat saat koneksi putus tetap tersimpan lokal dan otomatis sinkron saat online kembali

Sistem sudah lengkap untuk skala 1 driver/1 kendaraan sesuai kebutuhan awal. Pengembangan lanjutan (multi-driver, multi-kendaraan, laporan otomatis, dll) bisa dibangun di atas fondasi ini.

## Pembaruan: multi-trip & rencana rute

- Admin bisa membuat/mengedit rute untuk **banyak driver sekaligus**: pilih driver + tanggal di kartu "Buat & Edit Rute". Driver yang sedang bertugas ditandai "• bertugas".
- Rute bisa dibuat **sebelum checkin** (koleksi `rencana_rute/{driverId}_{YYYY-MM-DD}`). Driver membacanya otomatis; kalau admin mengedit saat trip berjalan, perubahan masuk ke `routes/{tripId}` dan menimpa rencana.
- **Titik awal** rute dipilih admin lewat 📍 di peta (diingat untuk rute berikutnya). Untuk trip yang sedang berjalan, otomatis memakai lokasi checkin.
- **Deploy ulang `firestore.rules`** (ada aturan baru untuk `rencana_rute`).

## Pembaruan: validasi GPS checkpoint

- Status **Berhasil** hanya bisa disimpan kalau posisi driver ≤ `CHECKPOINT_RADIUS_M` (default 100 m, atur di `js/config.js`) dari titik rute. Jarak dikurangi akurasi GPS (maks 150 m) supaya di dalam gedung driver tidak terblokir tanpa alasan.
- Status **Gagal / Ditunda** boleh dari mana saja, tapi **catatan wajib**.
- Tiap checkpoint menyimpan `validasi_gps`, `posisi_driver`, `akurasi_m`, `jarak_ke_titik_m`; jaraknya tampil di riwayat admin.
- Validasi berjalan di browser (tanpa backend), jadi bukan pengaman mutlak — fungsinya mencegah isi dari sembarang tempat dan menyisakan jejak audit.

## Pembaruan: tab Rekap, ekspor CSV, notifikasi

- `admin.html` kini punya 2 tab: **Operasional** (peta, rute, driver, riwayat) dan **Rekap** (`js/rekap.js`).
- **Rekap**: filter rentang tanggal + driver, dikelompokkan per hari / minggu (Senin–Minggu) / driver. Isi: jumlah trip, titik berhasil/gagal/ditunda, keuangan per kategori, jam kerja. Ekspor CSV: rekap, detail checkpoint, detail keuangan.
- **Riwayat per mesin**: cari Machine ID (harus persis seperti yang diisi driver) → semua kunjungan, driver, aksi, status, foto. Ekspor CSV tersedia.
- **Notifikasi admin** (tombol 🔔): toast + bunyi + notifikasi browser (jika diizinkan) untuk driver checkin/selesai, checkpoint gagal/ditunda, biaya "Tak Terduga", dan posisi driver basi >4 menit. **Hanya aktif selama halaman admin terbuka** — push saat app ditutup butuh Cloud Functions.
- Tidak butuh perubahan `firestore.rules` atau index baru.

## Pembaruan: rute live di peta admin

- `js/livemap.js`: tiap driver yang bertugas digambar **garis rute** (warna per driver), **marker titik bernomor** (abu = belum, hijau = berhasil, merah = gagal, kuning = ditunda; berubah realtime saat driver isi checkpoint), dan **panel progres** (n/total titik, titik berikutnya, sisa jarak garis lurus). Tap baris panel untuk zoom ke rute driver.
- Saat admin klik **Simpan & Kirim ke Driver**, geometri rute (polyline Mapbox Directions) ikut disimpan di dokumen rute. Rute yang disimpan sebelum pembaruan ini belum punya geometri → ditampilkan garis lurus putus-putus sampai disimpan ulang.
- Tidak ada perubahan `firestore.rules`. Maksimum 25 titik per rute (batas Directions API).

## Pembaruan: jejak aktual & replay jalur

- Driver menyimpan titik GPS ke `jejak/{tripId}` (satu dokumen, array `titik` berisi `{lat,lng,t}`) **hanya kalau bergerak ≥ 15 m atau sudah 5 menit diam** (atur di `js/config.js`: `JEJAK_MIN_GERAK_M`, `JEJAK_MAX_DIAM_S`).
- Peta live admin menggambar **jejak aktual** (garis putih) di atas garis rute rencana, jadi penyimpangan langsung kelihatan.
- **Riwayat → detail trip → "Jalur Trip"**: replay animasi (play/pause, seek, kecepatan 60×/300×/900×) dengan rute rencana, marker checkpoint berstatus, dan total jarak aktual. Trip sebelum pembaruan ini tidak punya jejak.
- **Deploy ulang `firestore.rules`** (ada aturan baru untuk `jejak`). Catatan biaya: tiap tulis ke `jejak` memicu 2 pembacaan dokumen oleh rules (trip + driver_pins).

## Pembaruan: sinkron otomatis (tanpa refresh)

- Admin kini memakai listener realtime (`onSnapshot`) untuk: **daftar driver** (status "Terhubung" berubah sendiri), **daftar riwayat trip** pada tanggal terpilih (trip baru/selesai langsung muncul), dan **detail trip** yang sedang dibuka (checkpoint, transaksi, jam selesai).
- **Rekap** auto-refresh (jeda 3 detik) saat tab terbuka dan rentangnya hanya "hari ini"; rentang lebih panjang tetap manual lewat tombol Tampilkan supaya hemat kuota baca.
- Peta live, rute live, notifikasi, dan form rute sudah realtime sejak sebelumnya.

## Pembaruan: kartu Ringkasan Hari Ini (admin)

Kartu "Ringkasan" yang sebelumnya hanya teks placeholder kini realtime (`js/ringkasan.js`): driver bertugas, trip hari ini (berjalan/selesai), progres titik rute aktif, hitungan berhasil/gagal/ditunda/tidak dikunjungi, keuangan hari ini per kategori, dan daftar peringatan (posisi basi, titik gagal/ditunda, biaya Tak Terduga). Dihitung per **trip**, bukan per jam: trip yang checkin hari ini **atau masih berjalan** (termasuk shift yang lewat tengah malam) beserta checkpoint & transaksinya tetap tampil sampai driver tekan Selesai; setelah itu trip dari hari sebelumnya keluar dari kartu (tetap ada di Rekap & Riwayat).

## Pembaruan: tombol Keluar & hapus data permanen

- **Keluar (admin & driver)**: tombol "Keluar" kini benar-benar `auth.signOut()` lalu reload, jadi sesi lama tidak bisa dipakai lagi dan harus login PIN ulang. Driver: ada peringatan kalau trip masih berjalan (GPS berhenti) atau masih ada data offline yang belum terkirim.
- **Hapus permanen (khusus admin)**, `js/hapus.js`:
  - Per trip: **Riwayat → detail trip → "Hapus Trip Ini Permanen"**.
  - Per rentang: tab **Rekap → "Hapus Data Rentang Ini"** (mengikuti filter tanggal & driver yang tampil).
  - Yang terhapus: `trips`, `checkpoints`, `transaksi_keuangan`, `jejak`, `routes` milik trip itu. Trip berstatus **berjalan tidak bisa dihapus**. Wajib ketik **HAPUS** untuk konfirmasi.
  - Foto di Cloudinary **tidak ikut terhapus** (hanya URL-nya yang hilang).
  - Tidak perlu deploy ulang `firestore.rules` — aturan `delete` khusus admin sudah ada.

## Pembaruan: kendaraan, master mesin, dwell time, rencana vs aktual, PDF

- **Kendaraan + odometer**: koleksi `kendaraan` (dikelola admin di kartu *Master Data*). Driver pilih kendaraan + isi odometer awal saat checkin, odometer akhir saat tutup tugas (tidak boleh lebih kecil dari awal). Tersimpan di `trips`: `kendaraan_id`, `kendaraan_plat`, `odometer_awal`, `odometer_akhir`, `km_odometer`. Kalau master kendaraan masih kosong, checkin tetap jalan tanpa kendaraan.
- **Master mesin**: koleksi `mesin` (id = Machine ID huruf besar). Form checkpoint driver memberi saran otomatis (datalist) dan memperingatkan kalau ID tidak ada di master. Machine ID kini disimpan huruf besar.
- **Dwell time**: `checkpoints.durasi_detik` = lama dari form checkpoint dibuka sampai disimpan (pendekatan; bukan deteksi geofence).
- **Rencana vs aktual** (`js/laporan.js`): di detail trip — jarak rencana vs jarak GPS aktual (jumlah jarak antar titik jejak), waktu tempuh rencana vs durasi trip, jumlah titik berhasil/gagal/ditunda, kesesuaian urutan, rata-rata waktu di titik, dan km odometer.
- **Laporan PDF**: tombol di detail trip (jsPDF dari cdnjs). Foto dicantumkan sebagai link, belum disematkan.
- **Wajib deploy ulang `firestore.rules`** (ada koleksi `kendaraan` & `mesin`).
