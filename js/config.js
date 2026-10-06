/* ==========================================================================
   config.js — kredensial & inisialisasi Firebase/Cloudinary/Mapbox.
   Dipakai bersama oleh driver.html dan admin.html. Dimuat PALING AWAL
   (sebelum utils.js, sebelum driver.js/admin.js).

   CATATAN KEAMANAN:
   - Semua value di bawah ini AMAN untuk ditaruh di kode frontend (publik),
     karena akses sesungguhnya dibatasi lewat Firestore Security Rules,
     Cloudinary "Unsigned Upload Preset", dan scope token Mapbox.
   - JANGAN PERNAH menaruh Cloudinary API Secret atau API Key di sini.
   ========================================================================== */

// === Konfigurasi Firebase ===
const firebaseConfig = {
  apiKey: "AIzaSyD8FtBu3G0QhPFagx9uAYyMRCl3oqohaig",
  authDomain: "recharge-tracking.firebaseapp.com",
  projectId: "recharge-tracking",
  storageBucket: "recharge-tracking.firebasestorage.app",
  messagingSenderId: "818216361237",
  appId: "1:818216361237:web:641cfe31dbef82dac95d1c"
};

// === Konfigurasi Cloudinary (unsigned upload, dipakai mulai Tahap 6) ===
const CLOUDINARY_CLOUD_NAME = "fbomcdht";
const CLOUDINARY_UPLOAD_PRESET = "checkpoint-photos";

// === Konfigurasi Mapbox (dipakai mulai Tahap 3/5) ===
const MAPBOX_TOKEN = "pk.eyJ1IjoiYXRuYTEyMyIsImEiOiJjbXVwaGplM2IwMXVjMnZweW1nMmN5Nmh6In0.n_GoL1HHQQ0ij1odxlbB6w";

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// Aktifkan cache offline Firestore — perubahan yang dibuat saat koneksi putus
// (misal checkpoint/transaksi driver di lapangan) disimpan lokal dulu lalu
// otomatis disinkronkan begitu koneksi kembali. Kalau browser/tab tidak
// mendukung (misal mode private/incognito atau tab lain sudah pegang lock-nya),
// gagal diam-diam — app tetap jalan, cuma tanpa cache offline.
db.enablePersistence({ synchronizeTabs: true }).catch(err=>{
  console.warn('Firestore offline persistence tidak aktif:', err.code);
});

// === Validasi GPS checkpoint ===
// Status "berhasil" hanya bisa disimpan kalau posisi driver berada dalam radius ini dari titik rute.
const CHECKPOINT_RADIUS_M = 100;
// Akurasi GPS yang diberi toleransi (meter). Dalam gedung akurasi sering buruk, jadi jarak
// dikurangi akurasi (maks nilai ini) sebelum dibandingkan dengan radius.
const CHECKPOINT_MAX_AKURASI_TOLERANSI_M = 150;

// === Jejak aktual (replay jalur) ===
// Titik posisi disimpan ke Firestore hanya kalau driver bergerak >= JEJAK_MIN_GERAK_M dari titik
// tersimpan terakhir, atau sudah lewat JEJAK_MAX_DIAM_S detik (heartbeat saat diam). Hemat kuota tulis.
const JEJAK_MIN_GERAK_M = 15;
const JEJAK_MAX_DIAM_S = 300;
