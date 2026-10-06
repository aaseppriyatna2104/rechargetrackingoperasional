/* ==========================================================================
   driver.js — logika khusus driver.html.
   Urutan muat di HTML: firebase SDK → config.js → utils.js → driver.js
   ========================================================================== */

const dotFirestore = document.getElementById('dotFirestore');
const valFirestore = document.getElementById('valFirestore');
const dotAuth = document.getElementById('dotAuth');
const valAuth = document.getElementById('valAuth');

// Tampilkan tanggal hari ini
document.getElementById('dateDisplay').textContent =
  new Date().toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

// --- Tes koneksi Firestore: tulis + baca 1 dokumen percobaan ---
async function testFirestore(){
  try{
    const ref = db.collection('_connection_test').doc('driver_shell');
    await ref.set({ pinged_at: firebase.firestore.FieldValue.serverTimestamp() });
    const snap = await ref.get();
    if(snap.exists){
      dotFirestore.classList.add('ok');
      valFirestore.textContent = 'Terhubung';
    }else{
      throw new Error('Dokumen tidak ditemukan setelah ditulis');
    }
  }catch(err){
    dotFirestore.classList.add('err');
    valFirestore.textContent = 'Gagal: ' + err.message;
    console.error('Firestore test error:', err);
  }
}

// --- Tes Anonymous Auth ---
function testAuth(){
  auth.signInAnonymously().catch(err=>{
    dotAuth.classList.add('err');
    valAuth.textContent = 'Gagal: ' + err.message;
    console.error('Auth error:', err);
  });

  auth.onAuthStateChanged(user=>{
    if(user){
      dotAuth.classList.add('ok');
      valAuth.textContent = 'UID: ' + user.uid.slice(0,8) + '…';
    }
  });
}

testFirestore();

// === Login PIN + link ke Anonymous Auth (Tahap 2) ===
const loginScreen = document.getElementById('loginScreen');
const appContent = document.getElementById('appContent');
const pinInput = document.getElementById('pinInput');
const btnLogin = document.getElementById('btnLogin');
const loginError = document.getElementById('loginError');
const driverNameDisplay = document.getElementById('driverNameDisplay');
const btnLogout = document.getElementById('btnLogout');

function showApp(driverId, nama){
  loginScreen.classList.add('hidden');
  appContent.classList.remove('hidden');
  driverNameDisplay.textContent = nama;
  dotAuth.classList.add('ok');
  valAuth.textContent = 'Login sebagai ' + nama;
}

function showLogin(){
  appContent.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  pinInput.value = '';
  pinInput.focus();
}

async function attemptLogin(){
  loginError.textContent = '';
  const pin = pinInput.value.trim();
  if(!/^\d{4,6}$/.test(pin)){
    loginError.textContent = 'PIN harus 4-6 digit angka.';
    return;
  }
  btnLogin.disabled = true;
  try{
    const pinHash = await hashPin(pin);
    const snap = await db.collection('driver_pins').where('pin_hash','==',pinHash).limit(1).get();
    if(snap.empty){
      loginError.textContent = 'PIN tidak dikenali.';
      return;
    }
    const doc = snap.docs[0];
    const driverId = doc.id;
    const nama = doc.data().nama;

    // Link auth.uid saat ini ke driver ini (overwrite, biar bisa ganti HP)
    const currentUid = auth.currentUser ? auth.currentUser.uid : null;
    if(currentUid){
      await db.collection('driver_pins').doc(driverId).update({ auth_uid: currentUid });
    }

    localStorage.setItem('driver_id', driverId);
    localStorage.setItem('driver_nama', nama);
    showApp(driverId, nama);
  }catch(err){
    loginError.textContent = 'Gagal login: ' + err.message;
    console.error(err);
  }finally{
    btnLogin.disabled = false;
  }
}

btnLogin.addEventListener('click', attemptLogin);
pinInput.addEventListener('keydown', e=>{ if(e.key === 'Enter') attemptLogin(); });

btnLogout.addEventListener('click', async ()=>{
  if(currentTripId && !confirm('Trip kamu masih berjalan. Kalau keluar, pelacakan GPS berhenti sampai kamu login lagi. Tetap keluar?')) return;
  // Pastikan checkpoint/transaksi yang dibuat saat offline sudah terkirim sebelum sesi ditutup
  try{
    await Promise.race([db.waitForPendingWrites(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
  }catch(e){
    if(!confirm('Masih ada data yang belum terkirim (sinyal lemah?). Kalau keluar sekarang, data itu bisa hilang. Tetap keluar?')) return;
  }
  localStorage.removeItem('driver_id');
  localStorage.removeItem('driver_nama');
  try{ await auth.signOut(); }catch(err){ console.error(err); }
  location.reload(); // bersihkan timer GPS & listener, dan mulai sesi anonim baru
});

// Begitu Anonymous Auth siap, cek apakah sudah pernah login (localStorage) sebelumnya
auth.onAuthStateChanged(user=>{
  if(user){
    const savedId = localStorage.getItem('driver_id');
    const savedNama = localStorage.getItem('driver_nama');
    if(savedId && savedNama){
      showApp(savedId, savedNama);
    }else{
      showLogin();
    }
  }
});

auth.signInAnonymously().catch(err=>{
  dotAuth.classList.add('err');
  valAuth.textContent = 'Gagal: ' + err.message;
  console.error('Auth error:', err);
});

// === Checkin + GPS live tracking (Tahap 3) ===
const locationGateCard = document.getElementById('locationGateCard');
const checkinCard = document.getElementById('checkinCard');
const trackingCard = document.getElementById('trackingCard');
const btnRequestLocation = document.getElementById('btnRequestLocation');
const locationGateError = document.getElementById('locationGateError');
const btnCheckin = document.getElementById('btnCheckin');
const checkinError = document.getElementById('checkinError');
const waktuCheckinDisplay = document.getElementById('waktuCheckinDisplay');
const lastPushDisplay = document.getElementById('lastPushDisplay');

const TRACKING_INTERVAL_MS = 75000; // 75 detik, di tengah rentang 60-90 detik
let currentTripId = null;
let currentDriverId = null;
let trackingTimer = null;
let wakeLockSentinel = null;

function showOnly(cardEl){
  [locationGateCard, checkinCard, trackingCard, doneCard].forEach(c=>{
    c.classList.toggle('hidden', c !== cardEl);
  });
}

function isSameLocalDay(date1, date2){
  return date1.getFullYear() === date2.getFullYear()
    && date1.getMonth() === date2.getMonth()
    && date1.getDate() === date2.getDate();
}

function getPosition(opts){
  return new Promise((resolve, reject)=>{
    navigator.geolocation.getCurrentPosition(resolve, reject, opts || {
      enableHighAccuracy: true, timeout: 15000, maximumAge: 0
    });
  });
}

async function requestWakeLock(){
  try{
    if('wakeLock' in navigator){
      wakeLockSentinel = await navigator.wakeLock.request('screen');
    }
  }catch(err){
    console.warn('Wake Lock gagal (non-fatal):', err.message);
  }
}
document.addEventListener('visibilitychange', async ()=>{
  if(document.visibilityState === 'visible' && currentTripId && !wakeLockSentinel){
    requestWakeLock();
  }
});

let lastJejak = null;
async function pushJejak(pos){
  const p = { lat: +pos.coords.latitude.toFixed(5), lng: +pos.coords.longitude.toFixed(5), t: Math.round(Date.now() / 1000) };
  if(lastJejak && jarakMeter(lastJejak.lat, lastJejak.lng, p.lat, p.lng) < JEJAK_MIN_GERAK_M && p.t - lastJejak.t < JEJAK_MAX_DIAM_S) return;
  lastJejak = p;
  try{
    await db.collection('jejak').doc(currentTripId).set({
      trip_id: currentTripId, driver_id: currentDriverId,
      titik: firebase.firestore.FieldValue.arrayUnion(p)
    }, { merge: true });
  }catch(e){ console.warn('Jejak gagal disimpan (non-fatal):', e.message); }
}

async function pushPosition(){
  try{
    const pos = await getPosition();
    await db.collection('drivers_live').doc(currentDriverId).set({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      last_updated: firebase.firestore.FieldValue.serverTimestamp(),
      status: 'aktif',
      trip_id: currentTripId
    }, { merge: true });
    lastPushDisplay.textContent = new Date().toLocaleTimeString('id-ID');
    pushJejak(pos);
  }catch(err){
    console.error('Gagal push posisi:', err);
    lastPushDisplay.textContent = 'Gagal kirim (' + err.message + ')';
  }
}

function startTracking(tripId, driverId){
  currentTripId = tripId;
  currentDriverId = driverId;
  showOnly(trackingCard);
  requestWakeLock();
  pushPosition(); // kirim posisi pertama langsung, jangan nunggu interval
  trackingTimer = setInterval(pushPosition, TRACKING_INTERVAL_MS);
}

const ckKendaraan = document.getElementById('ckKendaraan');
const ckOdoAwal = document.getElementById('ckOdoAwal');
const ckOdoAkhir = document.getElementById('ckOdoAkhir');
const mesinList = document.getElementById('mesinList');
let mesinSet = new Set(), cpOpenedAt = 0, masterListening = false;
// Master data kendaraan & mesin (dikelola admin) — dibaca realtime setelah auth siap
auth.onAuthStateChanged(user => {
  if(!user || masterListening) return;
  masterListening = true;
  db.collection('kendaraan').orderBy('plat').onSnapshot(s => {
    const pilih = ckKendaraan.value;
    ckKendaraan.innerHTML = '<option value="">Pilih kendaraan…</option>';
    s.docs.forEach(d => { const o = document.createElement('option'); o.value = d.id; o.dataset.plat = d.data().plat; o.textContent = d.data().plat + (d.data().jenis ? ' - ' + d.data().jenis : ''); ckKendaraan.appendChild(o); });
    ckKendaraan.value = pilih;
  }, e => console.error('Kendaraan:', e));
  db.collection('mesin').onSnapshot(s => {
    mesinSet = new Set(s.docs.map(d => d.id));
    mesinList.innerHTML = '';
    s.docs.forEach(d => { const o = document.createElement('option'); o.value = d.id; mesinList.appendChild(o); });
  }, e => console.error('Mesin:', e));
});

async function startCheckin(){
  checkinError.textContent = '';
  const adaKendaraan = ckKendaraan.options.length > 1;
  if(adaKendaraan && (!ckKendaraan.value || ckOdoAwal.value === '')){ checkinError.textContent = 'Pilih kendaraan dan isi odometer awal dulu.'; return; }
  btnCheckin.disabled = true;
  try{
    const pos = await getPosition();
    const driverId = localStorage.getItem('driver_id');
    const tripRef = await db.collection('trips').add({
      driver_id: driverId,
      kendaraan_id: ckKendaraan.value || null,
      kendaraan_plat: ckKendaraan.value ? ckKendaraan.selectedOptions[0].dataset.plat : null,
      odometer_awal: ckKendaraan.value ? Number(ckOdoAwal.value) : null,
      lokasi_checkin: { lat: pos.coords.latitude, lng: pos.coords.longitude },
      waktu_checkin: firebase.firestore.FieldValue.serverTimestamp(),
      waktu_selesai: null,
      status: 'berjalan'
    });
    waktuCheckinDisplay.textContent = new Date().toLocaleTimeString('id-ID');
    startTracking(tripRef.id, driverId);
  }catch(err){
    checkinError.textContent = 'Gagal checkin: ' + err.message;
    console.error(err);
  }finally{
    btnCheckin.disabled = false;
  }
}
btnCheckin.addEventListener('click', startCheckin);

async function handleLocationGranted(){
  const driverId = localStorage.getItem('driver_id');
  if(!driverId) return;
  try{
    const snap = await db.collection('trips')
      .where('driver_id','==',driverId)
      .where('status','==','berjalan')
      .limit(1).get();
    if(!snap.empty){
      const doc = snap.docs[0];
      const d = doc.data();
      const waktu = d.waktu_checkin ? d.waktu_checkin.toDate() : new Date();
      waktuCheckinDisplay.textContent = waktu.toLocaleTimeString('id-ID');
      startTracking(doc.id, driverId);
      return;
    }

    // Tidak ada trip aktif — cek apakah hari ini sudah ada trip yang DISELESAIKAN,
    // biar driver gak ditawarin checkin baru lagi di hari yang sama.
    const doneSnap = await db.collection('trips')
      .where('driver_id','==',driverId)
      .where('status','==','selesai')
      .orderBy('waktu_checkin','desc')
      .limit(1).get();
    if(!doneSnap.empty){
      const d = doneSnap.docs[0].data();
      const checkinDate = d.waktu_checkin ? d.waktu_checkin.toDate() : null;
      if(checkinDate && isSameLocalDay(checkinDate, new Date())){
        const selesaiDate = d.waktu_selesai ? d.waktu_selesai.toDate() : null;
        doneTimeDisplay.textContent = selesaiDate ? selesaiDate.toLocaleTimeString('id-ID') : '—';
        showOnly(doneCard);
        return;
      }
    }

    showOnly(checkinCard);
  }catch(err){
    console.error('Gagal cek trip aktif:', err);
    showOnly(checkinCard);
  }
}

async function checkLocationPermission(){
  if(!('geolocation' in navigator)){
    locationGateError.textContent = 'Browser HP ini tidak mendukung GPS.';
    showOnly(locationGateCard);
    return;
  }
  if('permissions' in navigator){
    try{
      const status = await navigator.permissions.query({ name:'geolocation' });
      if(status.state === 'granted'){
        handleLocationGranted();
      }else{
        showOnly(locationGateCard);
      }
      status.onchange = ()=>{
        if(status.state === 'granted') handleLocationGranted();
      };
      return;
    }catch(e){ /* lanjut ke fallback di bawah */ }
  }
  // Fallback kalau Permissions API tidak didukung: tampilkan gate, user klik tombol untuk trigger prompt
  showOnly(locationGateCard);
}

btnRequestLocation.addEventListener('click', async ()=>{
  locationGateError.textContent = '';
  btnRequestLocation.disabled = true;
  try{
    await getPosition();
    handleLocationGranted();
  }catch(err){
    if(err.code === 1){ // PERMISSION_DENIED
      locationGateError.textContent = 'Izin ditolak. Aktifkan lewat Setting HP > Apps > Chrome > Permissions > Location, lalu coba lagi.';
    }else{
      locationGateError.textContent = 'Gagal mengambil lokasi: ' + err.message;
    }
  }finally{
    btnRequestLocation.disabled = false;
  }
});

// Jalankan pengecekan izin lokasi setiap kali berhasil login/masuk app
const _origShowApp = showApp;
showApp = function(driverId, nama){
  _origShowApp(driverId, nama);
  checkLocationPermission();
};

// === Lihat rute & isi checkpoint (Tahap 6) ===
const routeCard = document.getElementById('routeCard');
const routeListEl = document.getElementById('routeListEl');
const checkpointModal = document.getElementById('checkpointModal');
const cpTitikNama = document.getElementById('cpTitikNama');
const cpFoto = document.getElementById('cpFoto');
const cpFotoPreview = document.getElementById('cpFotoPreview');
const cpStatus = document.getElementById('cpStatus');
const cpJenisAksi = document.getElementById('cpJenisAksi');
const cpMachineId = document.getElementById('cpMachineId');
const cpCatatan = document.getElementById('cpCatatan');
const cpError = document.getElementById('cpError');
const btnCancelCheckpoint = document.getElementById('btnCancelCheckpoint');
const btnSubmitCheckpoint = document.getElementById('btnSubmitCheckpoint');

let currentRouteTitik = [];      // dari routes/{tripId}, urut sesuai urutan_titik
let existingCheckpoints = {};    // urutan_titik -> data checkpoint terakhir
let routeUnsub = null;
let planUnsub = null;
let routeDocData = null, planDocData = null;
let checkpointsUnsub = null;
let activeTitikForModal = null;  // titik yang lagi dibuka di modal
let cpFotoFile = null;           // file foto terpilih (sebelum kompresi+upload)

function renderRouteList(){
  if(currentRouteTitik.length === 0){
    routeListEl.innerHTML = '<div class="placeholder" style="padding:14px 0;">Rute belum dibuat admin. Tunggu rute masuk — halaman ini otomatis update.</div>';
    return;
  }
  routeListEl.innerHTML = '';
  currentRouteTitik.forEach(t=>{
    const cp = existingCheckpoints[t.urutan_titik];
    const row = document.createElement('div');
    row.className = 'titik-item';
    row.innerHTML = `
      <div class="titik-badge ${cp ? 'done' : ''}">${t.urutan_titik}</div>
      <div class="titik-info">
        <div class="titik-nama">${t.nama_lokasi}</div>
        ${cp ? `<div class="titik-status ${cp.status_kunjungan}">${cp.status_kunjungan} · ${cp.jenis_aksi}</div>` : '<div class="titik-status">Belum dikunjungi</div>'}
      </div>
      ${cp ? '' : `<button class="btn-isi" data-urutan="${t.urutan_titik}">Isi</button>`}
    `;
    routeListEl.appendChild(row);
  });
  routeListEl.querySelectorAll('.btn-isi').forEach(btn=>{
    btn.addEventListener('click', ()=> openCheckpointModal(parseInt(btn.dataset.urutan,10)));
  });
}

function openCheckpointModal(urutanTitik){
  activeTitikForModal = currentRouteTitik.find(t=>t.urutan_titik === urutanTitik);
  if(!activeTitikForModal) return;
  cpTitikNama.textContent = activeTitikForModal.nama_lokasi;
  cpFoto.value = '';
  cpFotoPreview.classList.add('hidden');
  cpFotoFile = null;
  cpStatus.value = 'berhasil';
  cpJenisAksi.value = 'pemasangan';
  cpMachineId.value = ''; cpOpenedAt = Date.now();
  cpCatatan.value = '';
  cpError.textContent = '';
  checkpointModal.classList.remove('hidden');
}

function closeCheckpointModal(){
  checkpointModal.classList.add('hidden');
  activeTitikForModal = null;
}
btnCancelCheckpoint.addEventListener('click', closeCheckpointModal);

cpFoto.addEventListener('change', ()=>{
  const file = cpFoto.files[0];
  if(!file) return;
  cpFotoFile = file;
  cpFotoPreview.src = URL.createObjectURL(file);
  cpFotoPreview.classList.remove('hidden');
});

// Kompresi gambar di sisi browser (target ~200-500KB) sebelum diupload
function compressImage(file, maxDim, quality){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    const objUrl = URL.createObjectURL(file);
    img.onload = ()=>{
      let { width, height } = img;
      if(width > height && width > maxDim){ height = Math.round(height * maxDim / width); width = maxDim; }
      else if(height > maxDim){ width = Math.round(width * maxDim / height); height = maxDim; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob=>{
        URL.revokeObjectURL(objUrl);
        if(blob) resolve(blob); else reject(new Error('Gagal mengompres gambar'));
      }, 'image/jpeg', quality);
    };
    img.onerror = ()=>{ URL.revokeObjectURL(objUrl); reject(new Error('Gagal membaca gambar')); };
    img.src = objUrl;
  });
}

async function uploadToCloudinary(blob){
  const formData = new FormData();
  formData.append('file', blob);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: 'POST', body: formData
  });
  const json = await res.json();
  if(!json.secure_url){ throw new Error(json.error?.message || 'Upload foto gagal'); }
  return json.secure_url;
}

async function submitCheckpoint(){
  cpError.textContent = '';
  if(!activeTitikForModal){ return; }
  const durasiDetik = cpOpenedAt ? Math.round((Date.now() - cpOpenedAt) / 1000) : null;
  if(!cpFotoFile){ cpError.textContent = 'Foto wajib diisi.'; return; }
  if(!cpMachineId.value.trim()){ cpError.textContent = 'Machine ID wajib diisi.'; return; }
  const mid = cpMachineId.value.trim().toUpperCase();
  if(mesinSet.size && !mesinSet.has(mid) && !confirm(`Machine ID "${mid}" tidak ada di master data. Pastikan tidak salah ketik. Tetap simpan?`)) return;
  if((cpStatus.value === 'ditunda' || cpStatus.value === 'gagal') && !cpCatatan.value.trim()){
    cpError.textContent = 'Catatan wajib diisi kalau status "Ditunda" atau "Gagal".';
    return;
  }

  btnSubmitCheckpoint.disabled = true;
  btnSubmitCheckpoint.textContent = 'Menyimpan…';
  try{
    // --- Validasi GPS: "berhasil" hanya boleh disimpan kalau driver ada di dekat titik ---
    const t = activeTitikForModal;
    const butuhGps = cpStatus.value === 'berhasil' && typeof t.lat === 'number' && typeof t.lng === 'number';
    let gps = { validasi_gps: 'tidak_dicek' };
    btnSubmitCheckpoint.textContent = 'Mengecek lokasi…';
    try{
      const pos = await getPosition(butuhGps
        ? { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        : { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 });
      const akurasi = Math.round(pos.coords.accuracy || 0);
      const jarak = (typeof t.lat === 'number' && typeof t.lng === 'number')
        ? Math.round(jarakMeter(pos.coords.latitude, pos.coords.longitude, t.lat, t.lng)) : null;
      if(butuhGps){
        const efektif = jarak - Math.min(akurasi, CHECKPOINT_MAX_AKURASI_TOLERANSI_M);
        if(efektif > CHECKPOINT_RADIUS_M){
          cpError.textContent = `Kamu berjarak sekitar ${jarak} m dari titik (maks ${CHECKPOINT_RADIUS_M} m, akurasi GPS ±${akurasi} m). Dekati lokasi dulu, atau ubah status ke Gagal/Ditunda dengan catatan.`;
          return;
        }
      }
      gps = {
        validasi_gps: butuhGps ? 'lolos' : 'tidak_dicek',
        posisi_driver: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        akurasi_m: akurasi,
        jarak_ke_titik_m: jarak
      };
    }catch(gpsErr){
      if(butuhGps){
        cpError.textContent = 'GPS tidak bisa dibaca, jadi lokasi belum bisa divalidasi. Aktifkan lokasi HP lalu coba lagi, atau ubah status ke Gagal/Ditunda dengan catatan.';
        return;
      }
      gps = { validasi_gps: 'gps_tidak_tersedia' };
    }

    btnSubmitCheckpoint.textContent = 'Menyimpan…';
    const compressed = await compressImage(cpFotoFile, 1280, 0.72);
    const fotoUrl = await uploadToCloudinary(compressed);

    await db.collection('checkpoints').add({
      ...gps,
      trip_id: currentTripId,
      urutan_titik: activeTitikForModal.urutan_titik,
      nama_lokasi: activeTitikForModal.nama_lokasi,
      timestamp_sampai: firebase.firestore.FieldValue.serverTimestamp(),
      timestamp_selesai: firebase.firestore.FieldValue.serverTimestamp(),
      status_kunjungan: cpStatus.value,
      jenis_aksi: cpJenisAksi.value,
      machine_id: mid,
      durasi_detik: durasiDetik,
      foto_url: fotoUrl,
      catatan: cpCatatan.value.trim()
    });

    closeCheckpointModal();
  }catch(err){
    cpError.textContent = 'Gagal menyimpan: ' + err.message;
    console.error(err);
  }finally{
    btnSubmitCheckpoint.disabled = false;
    btnSubmitCheckpoint.textContent = 'Simpan Checkpoint';
  }
}
btnSubmitCheckpoint.addEventListener('click', submitCheckpoint);

function applyRoute(){
  const src = (routeDocData && Array.isArray(routeDocData.titik) && routeDocData.titik.length) ? routeDocData : planDocData;
  currentRouteTitik = src && Array.isArray(src.titik)
    ? src.titik.slice().sort((a,b)=>a.urutan_titik - b.urutan_titik) : [];
  renderRouteList();
}

function startRouteListeners(tripId){
  if(routeUnsub) routeUnsub();
  if(planUnsub) planUnsub();
  if(checkpointsUnsub) checkpointsUnsub();
  routeDocData = null; planDocData = null;

  routeCard.classList.remove('hidden');

  routeUnsub = db.collection('routes').doc(tripId).onSnapshot(doc=>{
    routeDocData = doc.exists ? doc.data() : null;
    applyRoute();
  }, err=>{
    console.error('Listener rute error:', err);
    routeListEl.innerHTML = '<div class="error-text">Gagal memuat rute: ' + err.message + '</div>';
  });

  // Rencana rute yang dibuat admin sebelum checkin (dipakai kalau routes/{tripId} belum ada)
  const d = new Date(), p = n => String(n).padStart(2,'0');
  const tgl = `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
  planUnsub = db.collection('rencana_rute').doc(`${currentDriverId}_${tgl}`).onSnapshot(doc=>{
    planDocData = doc.exists ? doc.data() : null;
    applyRoute();
  }, err=> console.error('Listener rencana rute error:', err));

  checkpointsUnsub = db.collection('checkpoints').where('trip_id','==',tripId).onSnapshot(snapshot=>{
    existingCheckpoints = {};
    snapshot.forEach(doc=>{
      const d = doc.data();
      existingCheckpoints[d.urutan_titik] = d;
    });
    renderRouteList();
  }, err=>{
    console.error('Listener checkpoints error:', err);
  });
}

// === Transaksi Keuangan & Tombol Selesai (Tahap 7) ===
const financeCard = document.getElementById('financeCard');
const financeListEl = document.getElementById('financeListEl');
const btnAddFinance = document.getElementById('btnAddFinance');
const financeModal = document.getElementById('financeModal');
const fKategori = document.getElementById('fKategori');
const fNominal = document.getElementById('fNominal');
const fFoto = document.getElementById('fFoto');
const fFotoPreview = document.getElementById('fFotoPreview');
const fCatatan = document.getElementById('fCatatan');
const fError = document.getElementById('fError');
const btnCancelFinance = document.getElementById('btnCancelFinance');
const btnSubmitFinance = document.getElementById('btnSubmitFinance');
const finishCard = document.getElementById('finishCard');
const btnSelesai = document.getElementById('btnSelesai');
const doneCard = document.getElementById('doneCard');
const doneTimeDisplay = document.getElementById('doneTimeDisplay');

let fFotoFile = null;
let financeUnsub = null;

function renderFinanceList(docs){
  if(docs.length === 0){
    financeListEl.innerHTML = '<div class="placeholder" style="padding:10px 0;">Belum ada transaksi hari ini.</div>';
    return;
  }
  financeListEl.innerHTML = '';
  docs.forEach(d=>{
    const waktu = d.timestamp ? d.timestamp.toDate() : null;
    const row = document.createElement('div');
    row.className = 'finance-item';
    row.innerHTML = `
      <div class="finance-kategori">${d.kategori}</div>
      <div class="finance-nominal">Rp ${Number(d.nominal).toLocaleString('id-ID')}</div>
      <div class="finance-time">${waktu ? waktu.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}) : ''}</div>
    `;
    financeListEl.appendChild(row);
  });
}

function openFinanceModal(){
  fKategori.value = 'BBM';
  fNominal.value = '';
  fFoto.value = '';
  fFotoPreview.classList.add('hidden');
  fFotoFile = null;
  fCatatan.value = '';
  fError.textContent = '';
  financeModal.classList.remove('hidden');
}
function closeFinanceModal(){
  financeModal.classList.add('hidden');
}
btnAddFinance.addEventListener('click', openFinanceModal);
btnCancelFinance.addEventListener('click', closeFinanceModal);

fFoto.addEventListener('change', ()=>{
  const file = fFoto.files[0];
  if(!file) return;
  fFotoFile = file;
  fFotoPreview.src = URL.createObjectURL(file);
  fFotoPreview.classList.remove('hidden');
});

async function submitFinance(){
  fError.textContent = '';
  const nominal = parseInt(fNominal.value, 10);
  if(!nominal || nominal <= 0){ fError.textContent = 'Nominal wajib diisi dengan angka lebih dari 0.'; return; }
  if(fKategori.value === 'Tak Terduga' && !fCatatan.value.trim()){
    fError.textContent = 'Catatan wajib diisi untuk kategori "Tak Terduga".';
    return;
  }

  btnSubmitFinance.disabled = true;
  btnSubmitFinance.textContent = 'Menyimpan…';
  try{
    let fotoUrl = null;
    if(fFotoFile){
      const compressed = await compressImage(fFotoFile, 1280, 0.72);
      fotoUrl = await uploadToCloudinary(compressed);
    }
    await db.collection('transaksi_keuangan').add({
      trip_id: currentTripId,
      driver_id: currentDriverId,
      kategori: fKategori.value,
      nominal: nominal,
      foto_struk: fotoUrl,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      catatan: fCatatan.value.trim()
    });
    closeFinanceModal();
  }catch(err){
    fError.textContent = 'Gagal menyimpan: ' + err.message;
    console.error(err);
  }finally{
    btnSubmitFinance.disabled = false;
    btnSubmitFinance.textContent = 'Simpan Transaksi';
  }
}
btnSubmitFinance.addEventListener('click', submitFinance);

function startFinanceListener(tripId){
  if(financeUnsub) financeUnsub();
  financeCard.classList.remove('hidden');
  financeUnsub = db.collection('transaksi_keuangan').where('trip_id','==',tripId)
    .onSnapshot(snapshot=>{
      const docs = snapshot.docs.map(d=>d.data())
        .sort((a,b)=>{
          const ta = a.timestamp ? a.timestamp.toMillis() : 0;
          const tb = b.timestamp ? b.timestamp.toMillis() : 0;
          return tb - ta; // terbaru di atas
        });
      renderFinanceList(docs);
    }, err=>{
      console.error('Listener transaksi error:', err);
    });
}

// === Tombol Selesai ===
async function handleSelesai(){
  let tripDoc = {};
  try{ tripDoc = (await db.collection('trips').doc(currentTripId).get()).data() || {}; }catch(e){ console.error(e); }
  const odoAkhir = Number(ckOdoAkhir.value);
  if(tripDoc.odometer_awal != null && (ckOdoAkhir.value === '' || odoAkhir < tripDoc.odometer_awal)){
    alert(`Isi odometer akhir dulu (harus sama atau lebih dari odometer awal: ${tripDoc.odometer_awal} km).`); ckOdoAkhir.focus(); return;
  }
  const belumDikunjungi = currentRouteTitik.filter(t => !existingCheckpoints[t.urutan_titik]);
  const pesan = belumDikunjungi.length > 0
    ? `Masih ada ${belumDikunjungi.length} titik yang belum dikunjungi. Titik tersebut akan otomatis ditandai "ditunda". Yakin mau tutup tugas sekarang?`
    : 'Semua titik sudah dikunjungi. Tutup tugas sekarang?';
  if(!confirm(pesan)) return;

  btnSelesai.disabled = true;
  btnSelesai.textContent = 'Memproses…';
  try{
    // Auto-generate checkpoint "ditunda" untuk titik yang belum dikerjain
    const batch = db.batch();
    belumDikunjungi.forEach(t=>{
      const ref = db.collection('checkpoints').doc();
      batch.set(ref, {
        trip_id: currentTripId,
        urutan_titik: t.urutan_titik,
        nama_lokasi: t.nama_lokasi,
        timestamp_sampai: firebase.firestore.FieldValue.serverTimestamp(),
        timestamp_selesai: firebase.firestore.FieldValue.serverTimestamp(),
        status_kunjungan: 'ditunda',
        jenis_aksi: null,
        machine_id: null,
        foto_url: null,
        catatan: 'Tidak dikunjungi — rute ditutup manual'
      });
    });
    await batch.commit();

    await db.collection('trips').doc(currentTripId).update({
      status: 'selesai',
      odometer_akhir: tripDoc.odometer_awal != null ? odoAkhir : null,
      km_odometer: tripDoc.odometer_awal != null ? odoAkhir - tripDoc.odometer_awal : null,
      waktu_selesai: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Hentikan semua aktivitas tracking & listener
    if(trackingTimer) clearInterval(trackingTimer);
    if(wakeLockSentinel){ wakeLockSentinel.release().catch(()=>{}); wakeLockSentinel = null; }
    if(routeUnsub) routeUnsub();
    if(planUnsub) planUnsub();
    if(checkpointsUnsub) checkpointsUnsub();
    if(financeUnsub) financeUnsub();
    await db.collection('drivers_live').doc(currentDriverId).set({ status: 'selesai' }, { merge: true });

    doneTimeDisplay.textContent = new Date().toLocaleTimeString('id-ID');
    [trackingCard, routeCard, financeCard, finishCard].forEach(c=>c.classList.add('hidden'));
    doneCard.classList.remove('hidden');
  }catch(err){
    alert('Gagal menutup tugas: ' + err.message);
    console.error(err);
  }finally{
    btnSelesai.disabled = false;
    btnSelesai.textContent = 'Selesai — Tutup Tugas';
  }
}
btnSelesai.addEventListener('click', handleSelesai);

// Panggil listener rute, transaksi, & tampilkan tombol Selesai setiap kali tracking mulai
const _origStartTracking = startTracking;
startTracking = function(tripId, driverId){
  _origStartTracking(tripId, driverId);
  startRouteListeners(tripId);
  startFinanceListener(tripId);
  finishCard.classList.remove('hidden');
};
