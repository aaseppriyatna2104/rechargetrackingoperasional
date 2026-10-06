/* ==========================================================================
   rekap.js — Tab "Rekap" admin: rekap harian/mingguan/per driver, riwayat per mesin,
   ekspor CSV, dan notifikasi admin (aktif selama halaman admin terbuka).
   Dipanggil dari initAdminApp() di admin.js. Dimuat sebelum admin.js.
   ========================================================================== */
function initRekapApp({ driverNames, map }){
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2,'0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const nm = id => driverNames[id] || id || '—';
  const num = n => Number(n || 0).toLocaleString('id-ID');
  const KATS = ['BBM','Flazz','Parkir','Tak Terduga'];
  const tsDate = t => (t && t.toDate) ? t.toDate() : null;
  const fmtDT = t => { const d = tsDate(t); return d ? `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : ''; };

  // ---------- Tab ----------
  const tabOps = $('tabOperasional'), tabRekap = $('tabRekap');
  const rkDari = $('rkDari'), rkSampai = $('rkSampai'), rkDriver = $('rkDriver'), rkGroup = $('rkGroup'), rkError = $('rkError');
  function fillDrivers(){
    const prev = rkDriver.value;
    rkDriver.innerHTML = '<option value="">Semua driver</option>' + Object.keys(driverNames).map(id => `<option value="${esc(id)}">${esc(driverNames[id])}</option>`).join('');
    rkDriver.value = driverNames[prev] ? prev : '';
  }
  document.querySelectorAll('.tab[data-tab]').forEach(b => b.addEventListener('click', () => {
    const rekap = b.dataset.tab === 'rekap';
    document.querySelectorAll('.tab[data-tab]').forEach(x => x.classList.toggle('active', x === b));
    tabOps.classList.toggle('hidden', rekap);
    tabRekap.classList.toggle('hidden', !rekap);
    if(rekap){ fillDrivers(); muat(DATA.loaded); } else { setTimeout(() => map.resize(), 50); }
  }));

  // ---------- CSV ----------
  function csv(rows, filename){
    const body = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['\ufeff' + body], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---------- Rekap ----------
  let DATA = { loaded:false, trips:[], cps:[], trx:[] };
  let rekapRows = [];
  const today = new Date();
  rkDari.value = rkSampai.value = ymd(today);

  async function muat(silent){
    rkError.textContent = '';
    if(!rkDari.value || !rkSampai.value || rkDari.value > rkSampai.value){ rkError.textContent = 'Rentang tanggal tidak valid.'; return; }
    if(!silent) $('rkSummary').innerHTML = '<div class="empty-note">Memuat…</div>';
    try{
      const [y1,m1,d1] = rkDari.value.split('-').map(Number), [y2,m2,d2] = rkSampai.value.split('-').map(Number);
      const snap = await db.collection('trips').where('waktu_checkin','>=',new Date(y1,m1-1,d1)).where('waktu_checkin','<',new Date(y2,m2-1,d2+1)).orderBy('waktu_checkin').get();
      let trips = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      if(rkDriver.value) trips = trips.filter(t => t.driver_id === rkDriver.value);
      const ids = trips.map(t => t.id), cps = [], trx = [];
      for(let i = 0; i < ids.length; i += 30){
        const ch = ids.slice(i, i+30);
        const [a, b] = await Promise.all([
          db.collection('checkpoints').where('trip_id','in',ch).get(),
          db.collection('transaksi_keuangan').where('trip_id','in',ch).get()
        ]);
        a.forEach(d => cps.push(d.data())); b.forEach(d => trx.push(d.data()));
      }
      DATA = { loaded:true, trips, cps, trx };
      render();
    }catch(err){
      $('rkSummary').innerHTML = '';
      rkError.textContent = 'Gagal memuat: ' + err.message; console.error(err);
    }
  }

  function render(){
    const { trips, cps, trx } = DATA, tm = new Map(trips.map(t => [t.id, t])), mode = rkGroup.value, rows = new Map();
    const get = k => { if(!rows.has(k)) rows.set(k, { trip:0, ber:0, gag:0, tun:0, kat:{}, total:0, menit:0 }); return rows.get(k); };
    const keyOf = t => {
      const d = tsDate(t.waktu_checkin);
      if(mode === 'driver') return nm(t.driver_id);
      if(!d) return '—';
      if(mode === 'hari') return ymd(d);
      const m = new Date(d); m.setDate(d.getDate() - ((d.getDay()+6) % 7)); return 'Minggu ' + ymd(m);
    };
    trips.forEach(t => { const r = get(keyOf(t)); r.trip++; if(t.waktu_checkin && t.waktu_selesai) r.menit += (t.waktu_selesai.toMillis() - t.waktu_checkin.toMillis()) / 60000; });
    cps.forEach(c => { const t = tm.get(c.trip_id); if(!t) return; const r = get(keyOf(t)); if(c.status_kunjungan === 'berhasil') r.ber++; else if(c.status_kunjungan === 'gagal') r.gag++; else r.tun++; });
    trx.forEach(x => { const t = tm.get(x.trip_id); if(!t) return; const r = get(keyOf(t)); const n = Number(x.nominal) || 0; r.kat[x.kategori] = (r.kat[x.kategori] || 0) + n; r.total += n; });

    const head = ['Kelompok','Trip','Berhasil','Gagal','Ditunda',...KATS,'Total (Rp)','Jam kerja'];
    const line = (k, r) => [k, r.trip, r.ber, r.gag, r.tun, ...KATS.map(c => r.kat[c] || 0), r.total, Math.round(r.menit / 6) / 10];
    const keys = [...rows.keys()].sort((a, b) => a.localeCompare(b, 'id'));
    const sum = { trip:0, ber:0, gag:0, tun:0, kat:{}, total:0, menit:0 };
    keys.forEach(k => { const r = rows.get(k); ['trip','ber','gag','tun','total','menit'].forEach(f => sum[f] += r[f]); KATS.forEach(c => sum.kat[c] = (sum.kat[c] || 0) + (r.kat[c] || 0)); });
    rekapRows = [head, ...keys.map(k => line(k, rows.get(k))), line('TOTAL', sum)];

    const titik = sum.ber + sum.gag + sum.tun;
    $('rkSummary').innerHTML = trips.length === 0 ? '<div class="empty-note">Tidak ada trip pada rentang ini.</div>' : `
      <div class="rk-tiles">
        <div class="rk-tile"><b>${sum.trip}</b><span>Trip</span></div>
        <div class="rk-tile"><b>${titik}</b><span>Titik (${titik ? Math.round(sum.ber / titik * 100) : 0}% berhasil)</span></div>
        <div class="rk-tile"><b>Rp ${num(sum.total)}</b><span>Keuangan</span></div>
        <div class="rk-tile"><b>${Math.round(sum.menit / 6) / 10}</b><span>Jam kerja</span></div>
      </div>`;
    $('rkTable').innerHTML = trips.length === 0 ? '' :
      '<thead><tr>' + head.map(h => `<th>${esc(h)}</th>`).join('') + '</tr></thead><tbody>' +
      rekapRows.slice(1).map((r, i, a) => `<tr class="${i === a.length-1 ? 'rk-total' : ''}">` + r.map((v, j) => `<td>${j === 0 ? esc(v) : (j >= 5 && j <= 9 ? num(v) : v)}</td>`).join('') + '</tr>').join('') + '</tbody>';
  }

  $('rkTampil').addEventListener('click', () => muat());
  rkGroup.addEventListener('change', () => DATA.loaded && render());
  document.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => {
    const t = new Date(), r = b.dataset.range;
    rkSampai.value = ymd(t);
    if(r === 'today') rkDari.value = ymd(t);
    else if(r === '7') { const s = new Date(t); s.setDate(t.getDate() - 6); rkDari.value = ymd(s); }
    else rkDari.value = ymd(new Date(t.getFullYear(), t.getMonth(), 1));
    muat();
  }));

  $('rkExpRekap').addEventListener('click', () => rekapRows.length ? csv(rekapRows, `rekap_${rkDari.value}_${rkSampai.value}.csv`) : (rkError.textContent = 'Tampilkan rekap dulu.'));
  $('rkExpCp').addEventListener('click', () => {
    if(!DATA.loaded) { rkError.textContent = 'Tampilkan rekap dulu.'; return; }
    const tm = new Map(DATA.trips.map(t => [t.id, t]));
    const rows = [['Tanggal','Driver','Urutan','Lokasi','Status','Aksi','Machine ID','Catatan','Jarak ke titik (m)','Validasi GPS','Waktu','Foto']];
    DATA.cps.slice().sort((a,b) => (a.trip_id+String(a.urutan_titik).padStart(3,'0')).localeCompare(b.trip_id+String(b.urutan_titik).padStart(3,'0')))
      .forEach(c => { const t = tm.get(c.trip_id) || {}; const d = tsDate(t.waktu_checkin);
        rows.push([d ? ymd(d) : '', nm(t.driver_id), c.urutan_titik, c.nama_lokasi, c.status_kunjungan, c.jenis_aksi, c.machine_id, c.catatan, c.jarak_ke_titik_m, c.validasi_gps, fmtDT(c.timestamp_selesai), c.foto_url]); });
    csv(rows, `checkpoint_${rkDari.value}_${rkSampai.value}.csv`);
  });
  $('rkExpTrx').addEventListener('click', () => {
    if(!DATA.loaded) { rkError.textContent = 'Tampilkan rekap dulu.'; return; }
    const tm = new Map(DATA.trips.map(t => [t.id, t]));
    const rows = [['Tanggal','Driver','Kategori','Nominal','Catatan','Waktu','Foto struk']];
    DATA.trx.forEach(x => { const t = tm.get(x.trip_id) || {}; const d = tsDate(t.waktu_checkin);
      rows.push([d ? ymd(d) : '', nm(x.driver_id || t.driver_id), x.kategori, x.nominal, x.catatan, fmtDT(x.timestamp), x.foto_struk]); });
    csv(rows, `keuangan_${rkDari.value}_${rkSampai.value}.csv`);
  });

  // ---------- Riwayat per mesin ----------
  let mesinRows = [];
  async function cariMesin(){
    const q = $('rkMesin').value.trim(), info = $('rkMesinInfo'), tbl = $('rkMesinTable');
    if(!q){ info.textContent = 'Isi Machine ID dulu.'; return; }
    info.textContent = 'Mencari…'; tbl.innerHTML = '';
    try{
      const variants = [...new Set([q, q.toUpperCase()])];
      const snaps = await Promise.all(variants.map(v => db.collection('checkpoints').where('machine_id','==',v).get()));
      const cps = [], seen = new Set();
      snaps.forEach(s => s.forEach(d => { if(!seen.has(d.id)){ seen.add(d.id); cps.push(d.data()); } }));
      const tripIds = [...new Set(cps.map(c => c.trip_id))], tm = new Map();
      for(let i = 0; i < tripIds.length; i += 30){
        const s = await db.collection('trips').where(firebase.firestore.FieldPath.documentId(),'in',tripIds.slice(i, i+30)).get();
        s.forEach(d => tm.set(d.id, d.data()));
      }
      cps.sort((a,b) => (tsDate(b.timestamp_selesai)?.getTime() || 0) - (tsDate(a.timestamp_selesai)?.getTime() || 0));
      mesinRows = [['Waktu','Driver','Lokasi','Aksi','Status','Catatan','Foto'],
        ...cps.map(c => [fmtDT(c.timestamp_selesai), nm((tm.get(c.trip_id) || {}).driver_id), c.nama_lokasi, c.jenis_aksi, c.status_kunjungan, c.catatan, c.foto_url])];
      info.textContent = cps.length ? `${cps.length} catatan untuk mesin ${q}` : `Tidak ada riwayat untuk "${q}" (harus persis sama dengan yang diisi driver).`;
      tbl.innerHTML = cps.length ? '<thead><tr>' + mesinRows[0].map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>' +
        mesinRows.slice(1).map(r => '<tr>' + r.slice(0,6).map(v => `<td>${esc(v)}</td>`).join('') + `<td>${r[6] ? `<a href="${esc(r[6])}" target="_blank" rel="noopener">Foto</a>` : ''}</td></tr>`).join('') + '</tbody>' : '';
    }catch(err){ info.textContent = 'Gagal mencari: ' + err.message; console.error(err); }
  }
  $('rkCariMesin').addEventListener('click', cariMesin);
  $('rkMesin').addEventListener('keydown', e => { if(e.key === 'Enter') cariMesin(); });
  $('rkExpMesin').addEventListener('click', () => mesinRows.length > 1 ? csv(mesinRows, `mesin_${$('rkMesin').value.trim()}.csv`) : ($('rkMesinInfo').textContent = 'Cari mesin dulu.'));

  // Auto-refresh rekap: hanya kalau rentangnya "hari ini" saja (hemat kuota baca), ditunda 3 detik
  let refreshTimer = null;
  function refreshSoon(){
    if(!DATA.loaded || tabRekap.classList.contains('hidden')) return;
    if(rkDari.value !== ymd(new Date()) || rkSampai.value !== rkDari.value) return;
    clearTimeout(refreshTimer); refreshTimer = setTimeout(() => muat(true), 3000);
  }

  // ---------- Notifikasi (hanya selama halaman admin terbuka) ----------
  const btnNotif = $('btnNotif');
  let notifOn = localStorage.getItem('notif_on') !== '0', audioCtx = null;
  const syncBtn = () => { btnNotif.textContent = notifOn ? '🔔' : '🔕'; };
  syncBtn();
  btnNotif.addEventListener('click', () => {
    notifOn = !notifOn; localStorage.setItem('notif_on', notifOn ? '1' : '0'); syncBtn();
    if(notifOn){ if('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); beep(); }
  });
  function beep(){
    try{
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + 0.18);
    }catch(e){}
  }
  const box = document.createElement('div'); box.id = 'toastBox'; document.body.appendChild(box);
  function notify(msg, level){
    if(!notifOn) return;
    const el = document.createElement('div'); el.className = 'toast ' + (level || ''); el.textContent = msg;
    el.addEventListener('click', () => el.remove()); box.appendChild(el);
    setTimeout(() => el.remove(), 12000); beep();
    if(document.hidden && 'Notification' in window && Notification.permission === 'granted'){ try{ new Notification('Recharge Tracking', { body: msg }); }catch(e){} }
  }
  const startToday = new Date(); startToday.setHours(0,0,0,0);
  function watch(query, handler){
    let first = true;
    query.onSnapshot(s => { if(first){ first = false; return; } s.docChanges().forEach(handler); }, e => console.error('Notif listener:', e));
  }
  const tripDriver = new Map();
  async function driverOfTrip(id){
    if(!tripDriver.has(id)){ try{ tripDriver.set(id, (await db.collection('trips').doc(id).get()).data().driver_id); }catch(e){ return null; } }
    return tripDriver.get(id);
  }
  watch(db.collection('trips').where('waktu_checkin','>=',startToday), c => {
    refreshSoon();
    const t = c.doc.data(); tripDriver.set(c.doc.id, t.driver_id);
    if(c.type === 'added' && t.status === 'berjalan') notify(`${nm(t.driver_id)} checkin`, 'ok');
    if(c.type === 'modified' && t.status === 'selesai') notify(`${nm(t.driver_id)} menutup tugas`, 'ok');
  });
  watch(db.collection('checkpoints').where('timestamp_selesai','>=',startToday), async c => {
    refreshSoon();
    if(c.type !== 'added') return;
    const x = c.doc.data();
    if(x.status_kunjungan === 'berhasil' || String(x.catatan || '').startsWith('Tidak dikunjungi')) return;
    notify(`${nm(await driverOfTrip(x.trip_id))}: titik ${x.urutan_titik} ${x.nama_lokasi} → ${x.status_kunjungan.toUpperCase()}${x.catatan ? ' — ' + x.catatan : ''}`, 'warn');
  });
  watch(db.collection('transaksi_keuangan').where('timestamp','>=',startToday), c => {
    refreshSoon();
    const x = c.doc.data();
    if(c.type === 'added' && x.kategori === 'Tak Terduga') notify(`${nm(x.driver_id)}: biaya Tak Terduga Rp ${num(x.nominal)}${x.catatan ? ' — ' + x.catatan : ''}`, 'warn');
  });
  // Posisi driver basi (>4 menit) saat masih bertugas
  const STALE_MS = 4 * 60 * 1000, staleSet = new Set(); let live = {};
  function checkStale(){
    Object.keys(live).forEach(id => {
      const d = live[id], t = tsDate(d.last_updated), stale = d.status === 'aktif' && t && Date.now() - t.getTime() > STALE_MS;
      if(stale && !staleSet.has(id)){ staleSet.add(id); notify(`Posisi ${nm(id)} tidak update > 4 menit (cek sinyal/baterai/app)`, 'warn'); }
      if(!stale) staleSet.delete(id);
    });
  }
  let firstLive = true;
  db.collection('drivers_live').onSnapshot(s => {
    live = {}; s.forEach(d => live[d.id] = d.data());
    if(firstLive){ firstLive = false; Object.keys(live).forEach(id => { const t = tsDate(live[id].last_updated); if(live[id].status === 'aktif' && t && Date.now() - t.getTime() > STALE_MS) staleSet.add(id); }); return; }
    checkStale();
  }, e => console.error(e));
  setInterval(checkStale, 30000);
}
