/* ==========================================================================
   livemap.js — rute live di peta admin: garis rute per driver, marker titik bernomor
   (warna = status kunjungan, realtime), dan panel progres per driver.
   Dipanggil dari initAdminApp() di admin.js. Dimuat sebelum admin.js.
   ========================================================================== */
function decodePolyline(str, precision){
  const f = Math.pow(10, precision || 5), out = [];
  let i = 0, lat = 0, lng = 0;
  while(i < str.length){
    let b, s = 0, r = 0;
    do{ b = str.charCodeAt(i++) - 63; r |= (b & 31) << s; s += 5; }while(b >= 32);
    lat += (r & 1) ? ~(r >> 1) : (r >> 1);
    s = 0; r = 0;
    do{ b = str.charCodeAt(i++) - 63; r |= (b & 31) << s; s += 5; }while(b >= 32);
    lng += (r & 1) ? ~(r >> 1) : (r >> 1);
    out.push([lng / f, lat / f]);
  }
  return out;
}

function initLiveRoutes({ map, driverNames }){
  const COLORS = ['#2DD4BF','#F59E0B','#60A5FA','#F472B6','#A78BFA','#34D399','#FB7185','#FACC15'];
  const ST = { berhasil:'#22C55E', gagal:'#EF4444', ditunda:'#F59E0B' }, ABU = '#8B93A1';
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const nm = id => driverNames[id] || id;
  const colorOf = id => {
    const ids = Object.keys(driverNames).sort(); let i = ids.indexOf(id);
    if(i < 0) i = [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
    return COLORS[i % COLORS.length];
  };
  const todayStr = () => { const d = new Date(), p = n => String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; };
  const panelEl = document.getElementById('liveRouteList');
  const S = {};            // driverId -> state
  let livePos = {}, styleReady = map.loaded();
  if(!styleReady) map.once('load', () => { styleReady = true; Object.keys(S).forEach(id => { draw(id); drawTrail(id); }); });

  const sourceOf = s => {
    const ok = d => d && Array.isArray(d.titik) && d.titik.length;
    return ok(s.routeDoc) ? s.routeDoc : (ok(s.planDoc) ? s.planDoc : null);
  };
  const sorted = r => r.titik.slice().sort((a, b) => a.urutan_titik - b.urutan_titik);

  function clearMap(s, id){
    s.markers.forEach(m => m.remove()); s.markers = [];
    if(map.getLayer(`rt-line-${id}`)) map.removeLayer(`rt-line-${id}`);
    if(map.getSource(`rt-src-${id}`)) map.removeSource(`rt-src-${id}`);
  }

  function draw(id){
    const s = S[id]; if(!s || !styleReady) return;
    clearMap(s, id);
    const r = sourceOf(s); if(!r) return;
    const col = colorOf(id), titik = sorted(r);
    const base = r.titik_awal || (s.base ? { lat:s.base.lat, lng:s.base.lng } : null);
    const fb = !r.geometri; // tanpa geometri tersimpan -> garis lurus putus-putus
    const coords = fb ? [...(base ? [[base.lng, base.lat]] : []), ...titik.map(t => [t.lng, t.lat])] : decodePolyline(r.geometri);
    map.addSource(`rt-src-${id}`, { type:'geojson', data:{ type:'Feature', properties:{}, geometry:{ type:'LineString', coordinates:coords } } });
    map.addLayer({
      id:`rt-line-${id}`, type:'line', source:`rt-src-${id}`,
      layout:{ 'line-cap':'round', 'line-join':'round' },
      paint: Object.assign({ 'line-color':col, 'line-width':4, 'line-opacity':0.85 }, fb ? { 'line-dasharray':[2,2] } : {})
    });
    if(map.getLayer(`rt-trail-${id}`)) map.moveLayer(`rt-trail-${id}`); // jejak aktual selalu di atas garis rencana
    if(base){
      const el = document.createElement('div'); el.className = 'rt-pin rt-base'; el.textContent = 'B'; el.style.background = col;
      s.markers.push(new mapboxgl.Marker({ element:el }).setLngLat([base.lng, base.lat]).setPopup(new mapboxgl.Popup({ offset:14 }).setHTML('<strong>Titik awal</strong>')).addTo(map));
    }
    titik.forEach(t => {
      const c = s.cps[t.urutan_titik];
      const el = document.createElement('div'); el.className = 'rt-pin'; el.textContent = t.urutan_titik;
      el.style.background = c ? (ST[c.status_kunjungan] || ABU) : ABU; el.style.borderColor = col;
      s.markers.push(new mapboxgl.Marker({ element:el }).setLngLat([t.lng, t.lat])
        .setPopup(new mapboxgl.Popup({ offset:14 }).setHTML(`<strong>${t.urutan_titik}. ${esc(t.nama_lokasi)}</strong><br>${c ? esc(c.status_kunjungan) + (c.machine_id ? ' · ' + esc(c.machine_id) : '') : 'Belum dikunjungi'}`)).addTo(map));
    });
  }

  function clearTrail(id){
    const sid = `rt-trail-${id}`;
    if(map.getLayer(sid)) map.removeLayer(sid);
    if(map.getSource(sid)) map.removeSource(sid);
  }
  function drawTrail(id){
    const s = S[id]; if(!s || !styleReady) return;
    const sid = `rt-trail-${id}`, pts = (s.trail || []).map(p => [p.lng, p.lat]);
    if(pts.length < 2){ clearTrail(id); return; }
    const data = { type:'Feature', properties:{}, geometry:{ type:'LineString', coordinates:pts } };
    if(map.getSource(sid)) map.getSource(sid).setData(data);
    else{
      map.addSource(sid, { type:'geojson', data });
      map.addLayer({ id:sid, type:'line', source:sid, layout:{ 'line-cap':'round', 'line-join':'round' }, paint:{ 'line-color':'#FFFFFF', 'line-width':2.5, 'line-opacity':0.9 } });
    }
  }

  function panel(){ panelRender(); document.dispatchEvent(new Event('rt-live-update')); }
  function panelRender(){
    const ids = Object.keys(S);
    if(!ids.length){ panelEl.innerHTML = ''; return; }
    panelEl.innerHTML = '<div class="lr-head">Rute live</div>';
    ids.forEach(id => {
      const s = S[id], r = sourceOf(s), pos = livePos[id];
      let sub = 'Belum ada rute';
      let title = esc(nm(id));
      if(r){
        const titik = sorted(r), done = titik.filter(t => s.cps[t.urutan_titik]);
        const cnt = k => done.filter(t => s.cps[t.urutan_titik].status_kunjungan === k).length;
        const next = titik.find(t => !s.cps[t.urutan_titik]);
        title += ` · ${done.length}/${titik.length} titik`;
        sub = `✓${cnt('berhasil')} ✗${cnt('gagal')} ⏸${cnt('ditunda')}`;
        if(next){
          const chain = [...(pos && typeof pos.lat === 'number' ? [pos] : []), ...titik.filter(t => t.urutan_titik >= next.urutan_titik && !s.cps[t.urutan_titik])];
          let m = 0; for(let i = 1; i < chain.length; i++) m += jarakMeter(chain[i-1].lat, chain[i-1].lng, chain[i].lat, chain[i].lng);
          sub += ` · Berikutnya: ${esc(next.nama_lokasi)}` + (chain.length > 1 ? ` · sisa ±${(m/1000).toFixed(1)} km (garis lurus)` : '');
        }else sub += ' · Semua titik selesai — kembali ke base';
      }
      const row = document.createElement('div'); row.className = 'lr-row';
      row.innerHTML = `<span class="lr-dot" style="background:${colorOf(id)}"></span><div class="lr-main"><div class="driver-name">${title}</div><div class="lr-sub">${sub}</div></div>`;
      row.addEventListener('click', () => {
        const pts = []; if(r){ if(r.titik_awal) pts.push(r.titik_awal); pts.push(...r.titik); }
        if(pos && typeof pos.lat === 'number') pts.push(pos);
        if(!pts.length) return;
        const b = new mapboxgl.LngLatBounds(); pts.forEach(p => b.extend([p.lng, p.lat]));
        map.fitBounds(b, { padding:50, maxZoom:16 });
      });
      panelEl.appendChild(row);
    });
  }

  function attach(id, trip){
    const s = S[id] = { tripId:trip.tripId, base:trip.base, routeDoc:null, planDoc:null, cps:{}, markers:[], unsubs:[], trail:[] };
    const upd = () => { draw(id); panel(); }, err = e => console.error('Live rute listener:', e);
    s.unsubs.push(db.collection('routes').doc(trip.tripId).onSnapshot(d => { s.routeDoc = d.exists ? d.data() : null; upd(); }, err));
    s.unsubs.push(db.collection('rencana_rute').doc(`${id}_${todayStr()}`).onSnapshot(d => { s.planDoc = d.exists ? d.data() : null; upd(); }, err));
    s.unsubs.push(db.collection('jejak').doc(trip.tripId).onSnapshot(d => {
      s.trail = d.exists ? (d.data().titik || []).slice().sort((a, b) => a.t - b.t) : []; drawTrail(id);
    }, err));
    s.unsubs.push(db.collection('checkpoints').where('trip_id','==',trip.tripId).onSnapshot(q => {
      s.cps = {}; q.forEach(d => { const x = d.data(); s.cps[x.urutan_titik] = x; }); upd();
    }, err));
  }
  function detach(id){
    const s = S[id]; if(!s) return;
    s.unsubs.forEach(u => u()); clearMap(s, id); clearTrail(id); delete S[id];
  }

  // Dipakai kartu Ringkasan: progres titik semua rute yang sedang aktif
  window.rtLiveStats = () => {
    let total = 0, done = 0;
    Object.values(S).forEach(s => { const r = sourceOf(s); if(r){ total += r.titik.length; done += r.titik.filter(t => s.cps[t.urutan_titik]).length; } });
    return { total, done };
  };

  db.collection('trips').where('status','==','berjalan').onSnapshot(snap => {
    const now = {};
    snap.forEach(d => { const x = d.data(); now[x.driver_id] = { tripId:d.id, base:x.lokasi_checkin }; });
    Object.keys(S).forEach(id => { if(!now[id] || S[id].tripId !== now[id].tripId) detach(id); });
    Object.keys(now).forEach(id => { if(!S[id]) attach(id, now[id]); });
    panel();
  }, e => console.error('Live rute trips:', e));

  db.collection('drivers_live').onSnapshot(q => {
    livePos = {}; q.forEach(d => livePos[d.id] = d.data()); panel();
  }, e => console.error(e));
}
