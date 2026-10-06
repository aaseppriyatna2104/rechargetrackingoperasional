# Recharge Tracking

Dashboard tracking armada &amp; operasional untuk **Recharge Indonesia** (rental power bank, area Jabodetabek). Pure frontend — tanpa server backend — langsung konek ke Firebase, Mapbox, dan Cloudinary.

Dua halaman terpisah:

- **`driver.html`** — dipakai driver di HP saat bertugas: login PIN, checkin GPS, live tracking, lihat rute, isi checkpoint per titik (foto + status), catat transaksi keuangan, tutup tugas.
- **`admin.html`** — dipakai admin di HP/laptop (sekarang juga dilindungi login PIN admin sendiri, terpisah dari PIN driver): peta live posisi semua driver, bikin & edit rute (cari lokasi via Mapbox, hitung estimasi jarak/waktu, pilih tol/non-tol), kelola akun driver (tambah/hapus), riwayat & arsip trip per tanggal (lihat detail checkpoint & transaksi keuangan tiap trip yang sudah lewat).

## Struktur folder

```
.
├── driver.html          # Halaman driver
├── admin.html           # Halaman admin
├── css/
│   ├── base.css          # Token warna & komponen bersama (dipakai 2 halaman)
│   ├── driver.css        # Style khusus driver.html
│   └── admin.css         # Style khusus admin.html
├── js/
│   ├── config.js         # Kredensial Firebase/Cloudinary/Mapbox + init
│   ├── utils.js           # Fungsi bersama (hashPin)
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
7. Deploy ke hosting statis apa saja (GitHub Pages, Netlify, Vercel, Firebase Hosting, dll) — tidak butuh server/backend.

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
