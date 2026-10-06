/* ==========================================================================
   ringkasan.js — kartu "Ringkasan Hari Ini" di admin (realtime).
   Dipanggil dari initAdminApp() di admin.js. Dimuat sebelum admin.js.
   ========================================================================== */
function initRingkasan({ driverNames }){
  const el = document.getElementById('ringkasanBody');
  const STALE_MS = 4 * 60 * 1000;
  const num = n => Number(n || 0).toLocaleString('id-ID');
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const KATS = ['BBM','Flazz','Parkir','Tak Terduga'];
  let trips = [], cps = [], trx = [], live = {}, unsubs = [], dayKey = '';
  const dayStr = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

  function render(){
    const berjalan = trips.filter(t => t.status === 'berjalan').length, selesai = trips.length - berjalan;
    const auto = c => String(c.catatan || '').startsWith('Tidak dikunjungi');
    const ber = cps.filter(c => c.status_kunjungan === 'berhasil').length;
    const gag = cps.filter(c => c.status_kunjungan === 'gagal').length;
    const tdk = cps.filter(c => c.status_kunjungan === 'ditunda' && auto(c)).length;
    const tun = cps.filter(c => c.status_kunjungan === 'ditunda' && !auto(c)).length;
    const kat = {}; let total = 0;
    trx.forEach(x => { const n = Number(x.nominal) || 0; kat[x.kategori] = (kat[x.kategori] || 0) + n; total += n; });

    const aktif = Object.keys(live).filter(id => live[id].status === 'aktif');
    const stale = aktif.filter(id => { const t = live[id].last_updated && live[id].last_updated.toDate(); return !t || Date.now() - t.getTime() > STALE_MS; });
    const st = window.rtLiveStats ? window.rtLiveStats() : { total:0, done:0 };
    const nDriver = Object.keys(driverNames).length;
    const nama = id => driverNames[id] || id;

    const warn = [];
    if(stale.length) warn.push(`Posisi tidak update >4 menit: ${stale.map(nama).map(esc).join(', ')}`);
    if(gag) warn.push(`${gag} titik berstatus GAGAL`);
    if(tun) warn.push(`${tun} titik DITUNDA`);
    if(kat['Tak Terduga']) warn.push(`Biaya Tak Terduga Rp ${num(kat['Tak Terduga'])}`);

    el.innerHTML = `
      <div class="rk-tiles">
        <div class="rk-tile"><b>${aktif.length}/${nDriver}</b><span>Driver bertugas</span></div>
        <div class="rk-tile"><b>${trips.length}</b><span>Trip hari ini/berjalan · ${berjalan} jalan · ${selesai} selesai</span></div>
        <div class="rk-tile"><b>${st.total ? st.done + '/' + st.total : (ber + gag + tun + tdk)}</b><span>${st.total ? 'Titik rute aktif' : 'Titik tercatat'}</span></div>
        <div class="rk-tile"><b>Rp ${num(total)}</b><span>Keuangan trip tsb</span></div>
      </div>
      <div class="rg-line">✓ ${ber} berhasil · ✗ ${gag} gagal · ⏸ ${tun} ditunda · ∅ ${tdk} tidak dikunjungi</div>
      <div class="rg-line">${KATS.map(k => `${k} Rp ${num(kat[k])}`).join(' · ')}</div>
      ${warn.length ? '<div class="rg-warn">' + warn.map(w => '⚠ ' + w).join('<br>') + '</div>' : '<div class="rg-ok">Tidak ada peringatan.</div>'}`;
  }

  // Ringkasan berbasis TRIP, bukan jam: trip yang checkin hari ini ATAU masih berjalan
  // (termasuk shift yang lewat tengah malam), lengkap dengan checkpoint & transaksinya.
  // Setelah driver tekan Selesai, trip dari hari sebelumnya otomatis keluar dari kartu ini.
  const err = e => console.error('Ringkasan:', e);
  let tripsA = [], tripsB = [], childUnsubs = [], cpChunks = {}, trxChunks = {}, idsKey = null, unsubA = null;
  const withId = s => s.docs.map(d => ({ id: d.id, ...d.data() }));
  const flat = o => [].concat(...Object.values(o));

  function subscribeChildren(ids){
    childUnsubs.forEach(u => u()); childUnsubs = []; cpChunks = {}; trxChunks = {}; cps = []; trx = [];
    for(let i = 0; i < ids.length; i += 30){ // batas operator 'in' Firestore = 30
      const ch = ids.slice(i, i + 30), k = i;
      childUnsubs.push(db.collection('checkpoints').where('trip_id','in',ch).onSnapshot(s => { cpChunks[k] = s.docs.map(d => d.data()); cps = flat(cpChunks); render(); }, err));
      childUnsubs.push(db.collection('transaksi_keuangan').where('trip_id','in',ch).onSnapshot(s => { trxChunks[k] = s.docs.map(d => d.data()); trx = flat(trxChunks); render(); }, err));
    }
  }
  function mergeTrips(){
    const m = new Map(); [...tripsA, ...tripsB].forEach(t => m.set(t.id, t));
    trips = [...m.values()];
    const ids = [...m.keys()].sort(), key = ids.join(',');
    if(key !== idsKey){ idsKey = key; subscribeChildren(ids); }
    render();
  }
  function subscribeToday(){
    if(unsubA) unsubA();
    dayKey = dayStr();
    const start = new Date(); start.setHours(0,0,0,0);
    unsubA = db.collection('trips').where('waktu_checkin','>=',start).onSnapshot(s => { tripsA = withId(s); mergeTrips(); }, err);
  }

  db.collection('trips').where('status','==','berjalan').onSnapshot(s => { tripsB = withId(s); mergeTrips(); }, err);
  db.collection('drivers_live').onSnapshot(s => { live = {}; s.forEach(d => live[d.id] = d.data()); render(); }, err);
  document.addEventListener('rt-live-update', render);
  setInterval(() => { if(dayStr() !== dayKey){ tripsA = []; subscribeToday(); mergeTrips(); } render(); }, 30000); // ganti hari & segarkan status "basi"
  subscribeToday(); render();
}
