/* ==========================================================================
   admin.js — logika khusus admin.html.
   Urutan muat di HTML: firebase SDK → mapbox-gl JS → config.js → utils.js → admin.js
   ========================================================================== */

// === Login PIN Admin (Tahap 9) ===
// Skema tanpa backend: PIN admin di-hash SHA-256 di browser lalu divalidasi
// lewat Firestore Security Rules (lihat firestore.rules), bukan dicek di JS.
// - Percobaan PERTAMA KALI yang pernah dilakukan ke admin.html akan otomatis
//   MENETAPKAN PIN itu sebagai PIN admin permanen (dokumen admin_config/main
//   dibuat sekali, tidak bisa ditimpa lagi lewat app ini).
// - Jadi begitu rules di-deploy, SEGERA buka admin.html dan set PIN admin
//   SEBELUM membagikan link admin.html ke siapa pun.
const loginScreen = document.getElementById('loginScreen');
const appContent = document.getElementById('appContent');
const pinInput = document.getElementById('pinInput');
const btnLogin = document.getElementById('btnLogin');
const loginError = document.getElementById('loginError');

let adminAppInitialized = false;

function showAdminApp(){
  loginScreen.classList.add('hidden');
  appContent.classList.remove('hidden');
  if(!adminAppInitialized){
    adminAppInitialized = true;
    initAdminApp();
  }
}

function showAdminLogin(){
  appContent.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  pinInput.value = '';
  pinInput.focus();
}

async function attemptAdminLogin(){
  loginError.textContent = '';
  const pin = pinInput.value.trim();
  if(!/^\d{4,6}$/.test(pin)){
    loginError.textContent = 'PIN harus 4-6 digit angka.';
    return;
  }
  btnLogin.disabled = true;
  try{
    const hash = await hashPin(pin);

    // Bootstrap: kalau admin_config/main belum pernah dibuat, percobaan ini
    // otomatis menetapkannya sebagai PIN admin. Kalau sudah ada & PIN yang
    // dimasukkan bukan admin yang sah, rules akan menolak — diabaikan di sini,
    // keputusan sebenarnya ada di langkah berikutnya (daftar ke /admins).
    try{
      await db.collection('admin_config').doc('main').set({
        pin_hash: hash,
        dibuat_pada: firebase.firestore.FieldValue.serverTimestamp()
      });
    }catch(e){ /* sudah ada & kita bukan admin yang sah — wajar, lanjut */ }

    // Daftarkan auth.uid sesi ini sebagai admin. Rules akan memverifikasi
    // hash yang dikirim cocok dengan admin_config/main.pin_hash.
    await db.collection('admins').doc(auth.currentUser.uid).set({
      pin_hash: hash,
      dibuat_pada: firebase.firestore.FieldValue.serverTimestamp()
    });

    showAdminApp();
  }catch(err){
    loginError.textContent = 'PIN admin salah.';
    console.error(err);
  }finally{
    btnLogin.disabled = false;
  }
}
btnLogin.addEventListener('click', attemptAdminLogin);
pinInput.addEventListener('keydown', e=>{ if(e.key === 'Enter') attemptAdminLogin(); });

// Cek status admin tiap kali Anonymous Auth siap (termasuk setelah reload —
// kalau uid ini sudah pernah berhasil login sebagai admin, langsung masuk
// tanpa minta PIN lagi, sama seperti pola auto-resume di driver.html).
auth.onAuthStateChanged(user=>{
  if(!user) return;
  db.collection('admins').doc(user.uid).get()
    .then(doc=>{
      if(doc.exists){ showAdminApp(); } else { showAdminLogin(); }
    })
    .catch(()=>{ showAdminLogin(); });
});

auth.signInAnonymously().catch(err=>{
  loginError.textContent = 'Gagal konek: ' + err.message;
  console.error('Auth error:', err);
});

// === Semua fitur admin — baru dijalankan setelah login PIN admin berhasil ===
function initAdminApp(){
  const dotFirestore = document.getElementById('dotFirestore');
  const valFirestore = document.getElementById('valFirestore');
  const dotAuth = document.getElementById('dotAuth');
  const valAuth = document.getElementById('valAuth');

  document.getElementById('dateDisplay').textContent =
    new Date().toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

  async function testFirestore(){
    try{
      const ref = db.collection('_connection_test').doc('admin_shell');
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

  dotAuth.classList.add('ok');
  valAuth.textContent = 'Admin · UID: ' + auth.currentUser.uid.slice(0,8) + '…';
  testFirestore();

  // === Manajemen Driver (Tahap 2) ===
  const driverListEl = document.getElementById('driverList');
  const btnShowAdd = document.getElementById('btnShowAdd');
  const addDriverFields = document.getElementById('addDriverFields');
  const inpNama = document.getElementById('inpNama');
  const inpPin = document.getElementById('inpPin');
  const inpPinConfirm = document.getElementById('inpPinConfirm');
  const addDriverError = document.getElementById('addDriverError');
  const btnSaveDriver = document.getElementById('btnSaveDriver');

  btnShowAdd.addEventListener('click', ()=>{
    addDriverFields.style.display = addDriverFields.style.display === 'none' ? 'flex' : 'none';
  });

  btnSaveDriver.addEventListener('click', async ()=>{
    addDriverError.textContent = '';
    const nama = inpNama.value.trim();
    const pin = inpPin.value.trim();
    const pinConfirm = inpPinConfirm.value.trim();

    if(!nama){ addDriverError.textContent = 'Nama wajib diisi.'; return; }
    if(!/^\d{4,6}$/.test(pin)){ addDriverError.textContent = 'PIN harus 4-6 digit angka.'; return; }
    if(pin !== pinConfirm){ addDriverError.textContent = 'Konfirmasi PIN tidak sama.'; return; }

    btnSaveDriver.disabled = true;
    try{
      const pinHash = await hashPin(pin);
      const driverId = nama.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || ('driver-' + Date.now());
      await db.collection('driver_pins').doc(driverId).set({
        nama: nama,
        pin_hash: pinHash,
        auth_uid: null,
        dibuat_pada: firebase.firestore.FieldValue.serverTimestamp()
      });
      inpNama.value = ''; inpPin.value = ''; inpPinConfirm.value = '';
      addDriverFields.style.display = 'none';
      loadDrivers();
    }catch(err){
      addDriverError.textContent = 'Gagal simpan: ' + err.message;
      console.error(err);
    }finally{
      btnSaveDriver.disabled = false;
    }
  });

  const driverNames = {}; // cache driver_id -> nama, dipakai juga buat popup peta

  function renderDrivers(snap){
    try{
      if(snap.empty){
        driverListEl.innerHTML = '<div class="empty-note">Belum ada driver terdaftar.</div>';
        return;
      }
      driverListEl.innerHTML = '';
      snap.forEach(doc=>{
        driverNames[doc.id] = (doc.data().nama) || doc.id;
        const d = doc.data();
        const row = document.createElement('div');
        row.className = 'driver-row';
        const linked = !!d.auth_uid;
        row.innerHTML = `
          <div class="dot ${linked ? 'linked' : ''}"></div>
          <div class="driver-name">${d.nama || doc.id}</div>
          <div class="driver-meta">${linked ? 'Terhubung' : 'Belum login'}</div>
          <button class="btn-delete" data-id="${doc.id}" data-nama="${d.nama || doc.id}">Hapus</button>
        `;
        driverListEl.appendChild(row);
      });

      populateRencanaDriver();
      driverListEl.querySelectorAll('.btn-delete').forEach(btn=>{
        btn.addEventListener('click', ()=> confirmDeleteDriver(btn.dataset.id, btn.dataset.nama));
      });
    }catch(err){
      driverListEl.innerHTML = '<div class="empty-note">Gagal memuat: ' + err.message + '</div>';
      console.error(err);
    }
  }

  // Realtime: daftar driver & status "Terhubung" ikut berubah otomatis (dipanggil sekali; panggilan lain = no-op).
  let driversListening = false;
  function loadDrivers(){
    if(driversListening) return;
    driversListening = true;
    driverListEl.innerHTML = '<div class="empty-note">Memuat…</div>';
    db.collection('driver_pins').onSnapshot(snap=>{
      renderDrivers(snap);
      if(typeof renderRiwayatList === 'function') renderRiwayatList(lastRiwayatTrips); // nama driver di riwayat ikut segar
    }, err=>{
      driverListEl.innerHTML = '<div class="empty-note">Gagal memuat: ' + err.message + '</div>';
      console.error(err);
    });
  }

  async function confirmDeleteDriver(driverId, nama){
    const sure = confirm(`Hapus akun driver "${nama}"?\n\nPIN login driver ini akan langsung tidak berlaku. Data trip/checkpoint yang sudah tercatat atas nama driver ini TIDAK ikut terhapus.`);
    if(!sure) return;
    try{
      await db.collection('driver_pins').doc(driverId).delete();
      loadDrivers();
    }catch(err){
      alert('Gagal menghapus: ' + err.message);
      console.error(err);
    }
  }

  loadDrivers();

  // === Peta Live Tracking (Tahap 4) ===
  const STALE_THRESHOLD_MS = 4 * 60 * 1000; // 4 menit (~3x interval 75 detik driver)
  const driverStatusListEl = document.getElementById('driverStatusList');
  mapboxgl.accessToken = MAPBOX_TOKEN;

  const map = new mapboxgl.Map({
    container: 'mapContainer',
    style: 'mapbox://styles/mapbox/dark-v11',
    center: [106.8272, -6.1751], // default: Jakarta
    zoom: 10
  });
  map.addControl(new mapboxgl.NavigationControl(), 'top-right');
  // Container baru kelihatan setelah login (sebelumnya display:none di balik
  // #loginScreen), jadi paksa resize supaya Mapbox menghitung ukuran dengan benar.
  setTimeout(()=> map.resize(), 100);

  const markers = {}; // driver_id -> mapboxgl.Marker
  let hasFittedOnce = false;

  function renderDriverStatusList(docs){
    if(docs.length === 0){
      driverStatusListEl.innerHTML = '<div class="empty-note">Belum ada driver yang checkin.</div>';
      return;
    }
    driverStatusListEl.innerHTML = '';
    docs.forEach(({id, data})=>{
      const lastUpdated = data.last_updated ? data.last_updated.toDate() : null;
      const isStale = !lastUpdated || (Date.now() - lastUpdated.getTime() > STALE_THRESHOLD_MS);
      const row = document.createElement('div');
      row.className = 'driver-row';
      row.innerHTML = `
        <div class="dot ${isStale ? '' : 'linked'}"></div>
        <div class="driver-name">${driverNames[id] || id}</div>
        <div class="driver-meta">${lastUpdated ? lastUpdated.toLocaleTimeString('id-ID') : '—'}${isStale ? ' · stale' : ''}</div>
      `;
      driverStatusListEl.appendChild(row);
    });
  }

  function updateMapMarkers(docs){
    const seenIds = new Set();
    docs.forEach(({id, data})=>{
      if(typeof data.lat !== 'number' || typeof data.lng !== 'number') return;
      seenIds.add(id);
      const lastUpdated = data.last_updated ? data.last_updated.toDate() : null;
      const isStale = !lastUpdated || (Date.now() - lastUpdated.getTime() > STALE_THRESHOLD_MS);
      const nama = driverNames[id] || id;
      const popupHtml = `<strong>${nama}</strong><br>${lastUpdated ? lastUpdated.toLocaleTimeString('id-ID') : '—'}${isStale ? ' (data basi)' : ''}`;

      if(markers[id]){
        markers[id].setLngLat([data.lng, data.lat]);
        markers[id].getPopup().setHTML(popupHtml);
        markers[id].getElement().classList.toggle('stale', isStale);
      }else{
        const el = document.createElement('div');
        el.className = 'driver-marker' + (isStale ? ' stale' : '');
        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([data.lng, data.lat])
          .setPopup(new mapboxgl.Popup({ offset: 16 }).setHTML(popupHtml))
          .addTo(map);
        markers[id] = marker;
      }
    });

    // Hapus marker driver yang sudah tidak ada datanya (jarang terjadi, tapi dijaga)
    Object.keys(markers).forEach(id=>{
      if(!seenIds.has(id)){
        markers[id].remove();
        delete markers[id];
      }
    });

    if(!hasFittedOnce && docs.length > 0){
      const first = docs.find(d => typeof d.data.lat === 'number');
      if(first){
        map.flyTo({ center: [first.data.lng, first.data.lat], zoom: 13 });
        hasFittedOnce = true;
      }
    }
  }

  db.collection('drivers_live').onSnapshot(snapshot=>{
    const docs = snapshot.docs.map(d => ({ id: d.id, data: d.data() }));
    renderDriverStatusList(docs);
    updateMapMarkers(docs);
  }, err=>{
    console.error('Listener drivers_live error:', err);
    driverStatusListEl.innerHTML = '<div class="empty-note">Gagal memuat posisi: ' + err.message + '</div>';
  });

  // Refresh tampilan stale/tidaknya tiap 30 detik walau tidak ada data baru
  setInterval(()=>{
    db.collection('drivers_live').get().then(snapshot=>{
      const docs = snapshot.docs.map(d => ({ id: d.id, data: d.data() }));
      renderDriverStatusList(docs);
      updateMapMarkers(docs);
    }).catch(()=>{});
  }, 30000);

  // === Buat & Edit Rute (Tahap 5) ===
  const routeTripInfo = document.getElementById('routeTripInfo');
  const routeBuilder = document.getElementById('routeBuilder');
  const titikListEl = document.getElementById('titikList');
  const btnAddTitik = document.getElementById('btnAddTitik');
  const chkLewatTol = document.getElementById('chkLewatTol');
  const btnHitungEstimasi = document.getElementById('btnHitungEstimasi');
  const btnSimpanRute = document.getElementById('btnSimpanRute');
  const estimasiResult = document.getElementById('estimasiResult');
  const routeError = document.getElementById('routeError');

  const rencanaDriver = document.getElementById('rencanaDriver');
  const rencanaTanggal = document.getElementById('rencanaTanggal');
  const titikAwalInfo = document.getElementById('titikAwalInfo');
  const btnPilihTitikAwal = document.getElementById('btnPilihTitikAwal');
  let activeTripsByDriver = {}; // driver_id -> {id, base}
  let selectedDriverId = null;
  let routeTarget = null;       // {type:'trip'|'plan', id}
  let titikAwal = null;         // {nama_lokasi, lat, lng}
  let routeTitik = []; // [{nama_lokasi, lat, lng}]

  function renderTitikList(){
    titikListEl.innerHTML = '';
    routeTitik.forEach((t, idx)=>{
      const row = document.createElement('div');
      row.className = 'titik-row';
      row.innerHTML = `
        <div class="titik-order">${idx+1}</div>
        <input type="text" placeholder="Cari nama lokasi…" value="${t.nama_lokasi ? t.nama_lokasi.replace(/"/g,'&quot;') : ''}" data-idx="${idx}">
        <button class="titik-btn" data-action="up" data-idx="${idx}" ${idx===0?'disabled style="opacity:.3"':''}>↑</button>
        <button class="titik-btn" data-action="down" data-idx="${idx}" ${idx===routeTitik.length-1?'disabled style="opacity:.3"':''}>↓</button>
        <button class="titik-btn" data-action="pin" data-idx="${idx}" title="Lokasi tidak ketemu di pencarian? Tentukan manual di peta">📍</button>
        <button class="titik-btn danger" data-action="hapus" data-idx="${idx}">✕</button>
        <div class="autocomplete-list hidden" data-list-idx="${idx}"></div>
      `;
      titikListEl.appendChild(row);
    });

    titikListEl.querySelectorAll('input[type="text"]').forEach(inp=>{
      inp.addEventListener('input', onTitikInput);
    });
    titikListEl.querySelectorAll('.titik-btn').forEach(btn=>{
      btn.addEventListener('click', onTitikBtn);
    });
  }

  function onTitikBtn(e){
    const idx = parseInt(e.currentTarget.dataset.idx, 10);
    const action = e.currentTarget.dataset.action;
    if(action === 'hapus'){
      routeTitik.splice(idx, 1);
    }else if(action === 'up' && idx > 0){
      [routeTitik[idx-1], routeTitik[idx]] = [routeTitik[idx], routeTitik[idx-1]];
    }else if(action === 'down' && idx < routeTitik.length-1){
      [routeTitik[idx+1], routeTitik[idx]] = [routeTitik[idx], routeTitik[idx+1]];
    }else if(action === 'pin'){
      openPickLocationModal(idx);
      return; // modal yang nentuin kapan render ulang, bukan di sini
    }
    renderTitikList();
  }

  // Pakai Search Box API (bukan Geocoding API) — ini yang mencakup POI
  // (nama gedung, hotel, apartemen, bisnis), bukan cuma alamat jalan.
  const titikSessionTokens = {}; // idx -> token, direset tiap mulai ngetik baru

  function newSessionToken(){
    return (crypto.randomUUID ? crypto.randomUUID() : 'tok-' + Date.now() + '-' + Math.random().toString(16).slice(2));
  }

  let debounceTimer = null;
  function onTitikInput(e){
    const idx = parseInt(e.target.dataset.idx, 10);
    const query = e.target.value.trim();
    routeTitik[idx].nama_lokasi = query;
    routeTitik[idx].lat = null; // batal lat/lng lama kalau teks diubah manual
    routeTitik[idx].lng = null;

    if(!titikSessionTokens[idx]) titikSessionTokens[idx] = newSessionToken();

    clearTimeout(debounceTimer);
    const listEl = titikListEl.querySelector(`.autocomplete-list[data-list-idx="${idx}"]`);
    if(query.length < 3){
      listEl.classList.add('hidden');
      return;
    }
    debounceTimer = setTimeout(async ()=>{
      try{
        const token = titikSessionTokens[idx];
        // bbox cover seluruh Jabodetabek (bukan cuma proximity ke titik tengah Jakarta),
        // supaya lokasi di Bogor/Depok/Tangerang/Bekasi ikut terangkat, bukan terpinggirkan.
        // proximity tetap dipasang sebagai sinyal ranking sekunder (bukan pembatas wilayah).
        const JABODETABEK_BBOX = '106.28,-6.75,107.15,-5.95';
        const url = `https://api.mapbox.com/search/searchbox/v1/suggest?q=${encodeURIComponent(query)}&access_token=${MAPBOX_TOKEN}&session_token=${token}&language=id&country=id&bbox=${JABODETABEK_BBOX}&proximity=106.8272,-6.1751&limit=10`;
        const res = await fetch(url);
        const json = await res.json();
        if(!json.suggestions || json.suggestions.length === 0){
          listEl.innerHTML = '<div class="autocomplete-item">Tidak ditemukan — coba tombol 📍 di sebelah kanan buat pilih manual di peta</div>';
          listEl.classList.remove('hidden');
          return;
        }
        listEl.innerHTML = '';
        json.suggestions.forEach(s=>{
          const item = document.createElement('div');
          item.className = 'autocomplete-item';
          const sub = s.full_address || s.place_formatted || '';
          item.innerHTML = `<div>${s.name}</div>${sub ? `<div style="color:var(--text-dim); font-size:11.5px; margin-top:2px;">${sub}</div>` : ''}`;
          item.addEventListener('click', async ()=>{
            try{
              const retrieveUrl = `https://api.mapbox.com/search/searchbox/v1/retrieve/${s.mapbox_id}?access_token=${MAPBOX_TOKEN}&session_token=${token}`;
              const r2 = await fetch(retrieveUrl);
              const j2 = await r2.json();
              const feature = j2.features && j2.features[0];
              if(!feature){ routeError.textContent = 'Gagal ambil detail lokasi.'; return; }
              routeTitik[idx].nama_lokasi = s.name + (sub ? ', ' + sub : '');
              routeTitik[idx].lat = feature.geometry.coordinates[1];
              routeTitik[idx].lng = feature.geometry.coordinates[0];
              titikSessionTokens[idx] = newSessionToken(); // sesi baru buat pencarian berikutnya
              listEl.classList.add('hidden');
              renderTitikList();
            }catch(err){
              routeError.textContent = 'Gagal ambil detail lokasi: ' + err.message;
              console.error(err);
            }
          });
          listEl.appendChild(item);
        });
        listEl.classList.remove('hidden');
      }catch(err){
        console.error('Autocomplete error:', err);
      }
    }, 350);
  }

  btnAddTitik.addEventListener('click', ()=>{
    routeTitik.push({ nama_lokasi:'', lat:null, lng:null });
    renderTitikList();
  });

  async function computeEstimate(){
    routeError.textContent = '';
    const validTitik = routeTitik.filter(t => t.lat && t.lng);
    if(validTitik.length === 0){
      routeError.textContent = 'Pilih minimal 1 lokasi dari hasil pencarian dulu.';
      return;
    }
    if(!titikAwal || !titikAwal.lat){ routeError.textContent = 'Pilih titik awal dulu (tombol 📍 Pilih).'; return; }
    const coords = [titikAwal, ...validTitik]
      .map(t => `${t.lng},${t.lat}`)
      .join(';');
    const profile = 'mapbox/driving';
    const excludeParam = chkLewatTol.checked ? '' : '&exclude=toll';
    const url = `https://api.mapbox.com/directions/v5/${profile}/${coords}?access_token=${MAPBOX_TOKEN}&overview=false${excludeParam}`;
    try{
      estimasiResult.textContent = 'Menghitung…';
      const res = await fetch(url);
      const json = await res.json();
      if(!json.routes || json.routes.length === 0){
        estimasiResult.textContent = '';
        routeError.textContent = 'Rute tidak ditemukan antar titik ini.';
        return;
      }
      const route = json.routes[0];
      const km = (route.distance / 1000).toFixed(1);
      const menit = Math.round(route.duration / 60);
      estimasiResult.textContent = `Estimasi: ${km} km · ${menit} menit (${chkLewatTol.checked ? 'boleh tol' : 'non-tol'})`;
    }catch(err){
      estimasiResult.textContent = '';
      routeError.textContent = 'Gagal menghitung rute: ' + err.message;
      console.error(err);
    }
  }
  btnHitungEstimasi.addEventListener('click', computeEstimate);

  async function saveRoute(){
    routeError.textContent = '';
    if(!routeTarget){ routeError.textContent = 'Pilih driver dulu.'; return; }
    if(!titikAwal || !titikAwal.lat){ routeError.textContent = 'Titik awal belum dipilih.'; return; }
    const incomplete = routeTitik.some(t => !t.lat || !t.lng);
    if(routeTitik.length === 0 || incomplete){
      routeError.textContent = 'Semua titik harus dipilih dari hasil pencarian (belum teks bebas).';
      return;
    }
    btnSimpanRute.disabled = true;
    try{
      // Simpan geometri rute (polyline) supaya peta live tidak perlu memanggil Directions berulang.
      // Gagal/lebih dari 25 titik -> disimpan tanpa geometri, peta memakai garis lurus putus-putus.
      let geo = {};
      try{
        const cs = [titikAwal, ...routeTitik].map(t => `${t.lng},${t.lat}`).join(';');
        const ex = chkLewatTol.checked ? '' : '&exclude=toll';
        const res = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${cs}?access_token=${MAPBOX_TOKEN}&overview=full&geometries=polyline${ex}`);
        const j = await res.json();
        if(j.routes && j.routes[0]) geo = { geometri: j.routes[0].geometry, jarak_m: Math.round(j.routes[0].distance), durasi_s: Math.round(j.routes[0].duration) };
      }catch(e){ console.warn('Geometri rute tidak tersimpan:', e); }
      const payload = {
        ...geo,
        driver_id: selectedDriverId,
        titik_awal: titikAwal,
        titik: routeTitik.map((t, i)=>({ urutan_titik: i+1, nama_lokasi: t.nama_lokasi, lat: t.lat, lng: t.lng })),
        boleh_tol: chkLewatTol.checked,
        dibuat_oleh_admin: true,
        terakhir_diedit: firebase.firestore.FieldValue.serverTimestamp()
      };
      if(routeTarget.type === 'trip'){
        payload.trip_id = routeTarget.id;
        await db.collection('routes').doc(routeTarget.id).set(payload);
      }else{
        payload.tanggal = rencanaTanggal.value;
        await db.collection('rencana_rute').doc(routeTarget.id).set(payload);
      }
      try{ localStorage.setItem('titik_awal_terakhir', JSON.stringify(titikAwal)); }catch(e){}
      estimasiResult.textContent = (estimasiResult.textContent || '') + ' · Tersimpan ✓';
    }catch(err){
      routeError.textContent = 'Gagal menyimpan: ' + err.message;
      console.error(err);
    }finally{
      btnSimpanRute.disabled = false;
    }
  }
  btnSimpanRute.addEventListener('click', saveRoute);

  // === Pilih lokasi manual di peta (fallback kalau nama tempat tidak ketemu di pencarian) ===
  const pickLocationModal = document.getElementById('pickLocationModal');
  const btnCancelPick = document.getElementById('btnCancelPick');
  const btnConfirmPick = document.getElementById('btnConfirmPick');

  let pickMap = null;
  let pickMarker = null;
  let pickTargetIdx = null;
  let pickedCoord = null;

  function openPickLocationModal(idx){
    pickTargetIdx = idx;
    pickLocationModal.classList.remove('hidden');

    const existing = idx === -1 ? (titikAwal || {}) : routeTitik[idx];
    pickedCoord = (existing.lat && existing.lng) ? { lat: existing.lat, lng: existing.lng } : null;
    btnConfirmPick.disabled = !pickedCoord;

    const startCenter = pickedCoord ? [pickedCoord.lng, pickedCoord.lat] : [106.8272, -6.1751];
    const startZoom = pickedCoord ? 15 : 10;

    if(!pickMap){
      pickMap = new mapboxgl.Map({
        container: 'pickLocationMap',
        style: 'mapbox://styles/mapbox/dark-v11',
        center: startCenter,
        zoom: startZoom
      });
      pickMap.addControl(new mapboxgl.NavigationControl(), 'top-right');
      pickMap.on('click', (e)=>{
        const { lng, lat } = e.lngLat;
        pickedCoord = { lat, lng };
        if(pickMarker){
          pickMarker.setLngLat([lng, lat]);
        }else{
          pickMarker = new mapboxgl.Marker({ color: '#2DD4BF' }).setLngLat([lng, lat]).addTo(pickMap);
        }
        btnConfirmPick.disabled = false;
      });
    }else{
      pickMap.jumpTo({ center: startCenter, zoom: startZoom });
    }

    if(pickedCoord){
      if(pickMarker) pickMarker.setLngLat([pickedCoord.lng, pickedCoord.lat]);
      else pickMarker = new mapboxgl.Marker({ color: '#2DD4BF' }).setLngLat([pickedCoord.lng, pickedCoord.lat]).addTo(pickMap);
    }else if(pickMarker){
      pickMarker.remove();
      pickMarker = null;
    }

    // Modal baru kelihatan sekarang, container peta sebelumnya display:none — paksa resize.
    setTimeout(()=> pickMap.resize(), 100);
  }

  function closePickLocationModal(){
    pickLocationModal.classList.add('hidden');
    pickTargetIdx = null;
  }
  btnCancelPick.addEventListener('click', closePickLocationModal);

  btnConfirmPick.addEventListener('click', ()=>{
    if(pickTargetIdx === null || !pickedCoord) return;
    if(pickTargetIdx === -1){
      titikAwal = { nama_lokasi: `Titik awal (${pickedCoord.lat.toFixed(5)}, ${pickedCoord.lng.toFixed(5)})`, lat: pickedCoord.lat, lng: pickedCoord.lng };
      closePickLocationModal();
      renderTitikAwal();
      return;
    }
    routeTitik[pickTargetIdx].lat = pickedCoord.lat;
    routeTitik[pickTargetIdx].lng = pickedCoord.lng;
    // Kalau admin belum ketik nama apa-apa, beri label default biar jelas ini pin manual.
    if(!routeTitik[pickTargetIdx].nama_lokasi){
      routeTitik[pickTargetIdx].nama_lokasi = `Titik manual (${pickedCoord.lat.toFixed(5)}, ${pickedCoord.lng.toFixed(5)})`;
    }
    closePickLocationModal();
    renderTitikList();
  });

  // === Multi-trip & rencana rute (tanpa harus menunggu checkin) ===
  // routes/{tripId}            -> rute untuk trip yang sedang berjalan (dibaca driver)
  // rencana_rute/{driver}_{tgl} -> rencana dibuat duluan; driver membacanya otomatis saat checkin
  function todayStr(){
    const d = new Date(), p = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
  }
  rencanaTanggal.value = todayStr();

  function populateRencanaDriver(){
    const prev = rencanaDriver.value;
    rencanaDriver.innerHTML = '<option value="">— Pilih driver —</option>' +
      Object.keys(driverNames).map(id=>`<option value="${id}">${driverNames[id]}${activeTripsByDriver[id] ? ' • bertugas' : ''}</option>`).join('');
    rencanaDriver.value = driverNames[prev] ? prev : '';
  }

  function renderTitikAwal(){
    titikAwalInfo.textContent = titikAwal && titikAwal.lat ? titikAwal.nama_lokasi : 'belum dipilih';
  }
  btnPilihTitikAwal.addEventListener('click', ()=> openPickLocationModal(-1));

  async function loadRouteTarget(){
    routeError.textContent = ''; estimasiResult.textContent = '';
    selectedDriverId = rencanaDriver.value || null;
    if(!selectedDriverId || !rencanaTanggal.value){
      routeTarget = null; routeBuilder.classList.add('hidden');
      routeTripInfo.textContent = 'Pilih driver dan tanggal dulu.';
      return;
    }
    const tgl = rencanaTanggal.value;
    const trip = tgl === todayStr() ? activeTripsByDriver[selectedDriverId] : null;
    routeTarget = trip ? { type:'trip', id: trip.id } : { type:'plan', id: `${selectedDriverId}_${tgl}` };
    const nama = driverNames[selectedDriverId] || selectedDriverId;
    routeTripInfo.textContent = trip
      ? `${nama} sedang bertugas — perubahan rute langsung terkirim ke driver.`
      : `Rencana rute ${nama} untuk ${tgl} — otomatis dipakai saat driver checkin.`;
    routeBuilder.classList.remove('hidden');

    let data = null;
    try{
      const main = await (trip ? db.collection('routes').doc(trip.id) : db.collection('rencana_rute').doc(routeTarget.id)).get();
      if(main.exists) data = main.data();
      else if(trip){ // trip jalan tapi belum ada routes: pakai rencana yang sudah dibuat
        const pd = await db.collection('rencana_rute').doc(`${selectedDriverId}_${tgl}`).get();
        if(pd.exists) data = pd.data();
      }
    }catch(err){ routeError.textContent = 'Gagal memuat rute: ' + err.message; }

    routeTitik = data && Array.isArray(data.titik)
      ? data.titik.slice().sort((a,b)=>a.urutan_titik-b.urutan_titik).map(t=>({ nama_lokasi:t.nama_lokasi, lat:t.lat, lng:t.lng }))
      : [];
    chkLewatTol.checked = data ? data.boleh_tol !== false : true;
    if(data && data.titik_awal) titikAwal = data.titik_awal;
    else if(trip && trip.base) titikAwal = { nama_lokasi:'Lokasi checkin', lat:trip.base.lat, lng:trip.base.lng };
    else { try{ titikAwal = JSON.parse(localStorage.getItem('titik_awal_terakhir')); }catch(e){ titikAwal = null; } }
    renderTitikAwal();
    renderTitikList();
  }
  rencanaDriver.addEventListener('change', loadRouteTarget);
  rencanaTanggal.addEventListener('change', loadRouteTarget);

  // Semua trip berjalan, realtime. Muat ulang editor hanya kalau targetnya berubah
  // (misal rencana -> trip saat driver checkin), supaya edit admin yang sedang jalan tidak tertimpa.
  db.collection('trips').where('status','==','berjalan').onSnapshot(snap=>{
    activeTripsByDriver = {};
    snap.forEach(d=>{ const x = d.data(); activeTripsByDriver[x.driver_id] = { id:d.id, base:x.lokasi_checkin }; });
    populateRencanaDriver();
    if(!selectedDriverId) return;
    const trip = rencanaTanggal.value === todayStr() ? activeTripsByDriver[selectedDriverId] : null;
    const wantKey = trip ? 'trip:'+trip.id : 'plan:'+selectedDriverId+'_'+rencanaTanggal.value;
    const haveKey = routeTarget ? routeTarget.type+':'+routeTarget.id : null;
    if(wantKey !== haveKey) loadRouteTarget();
  }, err=> console.error('Listener trips aktif error:', err));

  // === Riwayat & Arsip Trip (Tahap 8) ===
  const riwayatTanggal = document.getElementById('riwayatTanggal');
  const btnMuatRiwayat = document.getElementById('btnMuatRiwayat');
  const riwayatListEl = document.getElementById('riwayatListEl');
  const riwayatModal = document.getElementById('riwayatModal');
  const riwayatModalTitle = document.getElementById('riwayatModalTitle');
  const riwayatDetailBody = document.getElementById('riwayatDetailBody');
  const btnCloseRiwayat = document.getElementById('btnCloseRiwayat');

  function todayDateInputValue(){
    const d = new Date();
    const pad = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }
  riwayatTanggal.value = todayDateInputValue();

  function renderRiwayatList(trips){
    if(trips.length === 0){
      riwayatListEl.innerHTML = '<div class="empty-note">Tidak ada trip pada tanggal ini.</div>';
      return;
    }
    riwayatListEl.innerHTML = '';
    trips.forEach(t=>{
      const nama = driverNames[t.driver_id] || t.driver_id;
      const waktuMulai = t.waktu_checkin ? t.waktu_checkin.toDate() : null;
      const waktuSelesai = t.waktu_selesai ? t.waktu_selesai.toDate() : null;
      const row = document.createElement('div');
      row.className = 'riwayat-row';
      row.innerHTML = `
        <div class="dot ${t.status === 'selesai' ? 'linked' : ''}"></div>
        <div class="driver-name">${nama}</div>
        <div class="driver-meta">
          ${waktuMulai ? waktuMulai.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}) : '—'}
          –
          ${waktuSelesai ? waktuSelesai.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}) : (t.status === 'berjalan' ? 'Berjalan' : '—')}
        </div>
      `;
      row.addEventListener('click', ()=> openRiwayatDetail(t.id, nama, waktuMulai, waktuSelesai));
      riwayatListEl.appendChild(row);
    });
  }

  let riwayatUnsub = null;
  let lastRiwayatTrips = [];
  function loadRiwayat(){
    if(riwayatUnsub){ riwayatUnsub(); riwayatUnsub = null; }
    const tanggalStr = riwayatTanggal.value;
    if(!tanggalStr){
      riwayatListEl.innerHTML = '<div class="empty-note">Pilih tanggal dulu.</div>';
      return;
    }
    riwayatListEl.innerHTML = '<div class="empty-note">Memuat…</div>';
    const [y, m, d] = tanggalStr.split('-').map(Number);
    const startOfDay = new Date(y, m-1, d, 0, 0, 0, 0);
    const endOfDay = new Date(y, m-1, d+1, 0, 0, 0, 0);
    // Realtime: trip baru / trip selesai langsung muncul tanpa refresh
    riwayatUnsub = db.collection('trips')
      .where('waktu_checkin', '>=', startOfDay)
      .where('waktu_checkin', '<', endOfDay)
      .orderBy('waktu_checkin', 'desc')
      .onSnapshot(snap=>{
        lastRiwayatTrips = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderRiwayatList(lastRiwayatTrips);
      }, err=>{
        riwayatListEl.innerHTML = '<div class="empty-note">Gagal memuat: ' + err.message + '</div>';
        console.error(err);
      });
  }
  btnMuatRiwayat.addEventListener('click', loadRiwayat);
  riwayatTanggal.addEventListener('change', loadRiwayat);

  let detailUnsubs = [];
  function stopDetail(){ detailUnsubs.forEach(u=>u()); detailUnsubs = []; }

  function buildDetailHtml(checkpoints, transaksi){
    let html = '';
      html += '<div class="sheet-title" style="font-size:13px; margin-top:14px;">Checkpoint</div>';
      if(checkpoints.length === 0){
        html += '<div class="empty-note">Tidak ada checkpoint tercatat.</div>';
      }else{
        checkpoints.forEach(cp=>{
          const waktu = cp.timestamp_selesai ? cp.timestamp_selesai.toDate().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}) : '—';
          html += `
            <div class="riwayat-cp-item">
              <div class="titik-badge done">${cp.urutan_titik}</div>
              <div class="titik-info">
                <div class="titik-nama">${cp.nama_lokasi}</div>
                <div class="titik-status ${cp.status_kunjungan}">${cp.status_kunjungan}${cp.jenis_aksi ? ' · ' + cp.jenis_aksi : ''}${cp.machine_id ? ' · ' + cp.machine_id : ''} · ${waktu}${cp.jarak_ke_titik_m != null ? ' · ' + cp.jarak_ke_titik_m + ' m dari titik' : ''}</div>
                ${cp.catatan ? `<div class="status-value" style="margin-top:2px;">${cp.catatan}</div>` : ''}
              </div>
              ${cp.foto_url ? `<a href="${cp.foto_url}" target="_blank" rel="noopener"><img src="${cp.foto_url}" class="riwayat-thumb" alt="Foto checkpoint"></a>` : ''}
            </div>
          `;
        });
      }

      html += '<div class="sheet-title" style="font-size:13px; margin-top:14px;">Transaksi Keuangan</div>';
      if(transaksi.length === 0){
        html += '<div class="empty-note">Tidak ada transaksi tercatat.</div>';
      }else{
        let total = 0;
        transaksi.forEach(t=>{
          total += Number(t.nominal) || 0;
          const waktu = t.timestamp ? t.timestamp.toDate().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}) : '—';
          html += `
            <div class="finance-item">
              <div class="finance-kategori">${t.kategori}${t.catatan ? ' — ' + t.catatan : ''}</div>
              <div class="finance-nominal">Rp ${Number(t.nominal).toLocaleString('id-ID')}</div>
              <div class="finance-time">${waktu}</div>
            </div>
          `;
        });
        html += `<div class="status-value" style="margin-top:8px; text-align:right;">Total: Rp ${total.toLocaleString('id-ID')}</div>`;
      }

      return html;
  }

  // Realtime selama modal terbuka: checkpoint, transaksi, dan status trip ikut update otomatis.
  // (Replay jalur diambil sekali saat modal dibuka; tutup & buka lagi untuk memuat jejak terbaru.)
  function openRiwayatDetail(tripId, nama, waktuMulai, waktuSelesai){
    stopDetail();
    riwayatModalTitle.textContent = nama;
    riwayatModal.classList.remove('hidden');
    riwayatDetailBody.innerHTML = `<div class="status-value" id="detailWaktu" style="margin-bottom:10px;"></div>
      <div class="sheet-title" style="font-size:13px; margin-top:14px;">Jalur Trip</div><div id="replayBox"></div>
      <div id="detailLive"><div class="empty-note">Memuat detail…</div></div>`;
    const setWaktu = (mulai, selesai) => {
      const el = document.getElementById('detailWaktu');
      if(el) el.innerHTML = `Checkin: ${mulai ? mulai.toLocaleString('id-ID') : '—'}<br>Selesai: ${selesai ? selesai.toLocaleString('id-ID') : 'Masih berjalan'}`;
    };
    setWaktu(waktuMulai, waktuSelesai);

    let cps = [], trx = [], gotC = false, gotT = false, replayDone = false;
    const paint = () => {
      if(!gotC || !gotT) return;
      document.getElementById('detailLive').innerHTML = buildDetailHtml(cps, trx);
      if(!replayDone){ replayDone = true; renderReplay(document.getElementById('replayBox'), tripId, cps); }
    };
    const fail = err => { document.getElementById('detailLive').innerHTML = '<div class="empty-note">Gagal memuat detail: ' + err.message + '</div>'; console.error(err); };
    detailUnsubs.push(db.collection('trips').doc(tripId).onSnapshot(d=>{
      if(d.exists){ const t = d.data(); setWaktu(t.waktu_checkin ? t.waktu_checkin.toDate() : null, t.waktu_selesai ? t.waktu_selesai.toDate() : null); }
    }, fail));
    detailUnsubs.push(db.collection('checkpoints').where('trip_id','==',tripId).onSnapshot(s=>{
      cps = s.docs.map(d=>d.data()).sort((a,b)=>a.urutan_titik - b.urutan_titik); gotC = true; paint();
    }, fail));
    detailUnsubs.push(db.collection('transaksi_keuangan').where('trip_id','==',tripId).onSnapshot(s=>{
      trx = s.docs.map(d=>d.data()); gotT = true; paint();
    }, fail));
  }

  function closeRiwayatDetail(){
    stopDetail();
    closeReplay();
    riwayatModal.classList.add('hidden');
  }
  btnCloseRiwayat.addEventListener('click', closeRiwayatDetail);

  loadRiwayat();
  initRekapApp({ driverNames, map });
  initLiveRoutes({ map, driverNames });
  initRingkasan({ driverNames });
}
