/* ==========================================================================
   replay.js — replay jalur aktual trip (dari koleksi jejak) di modal Riwayat admin.
   Dipanggil dari openRiwayatDetail() di admin.js. Dimuat sebelum admin.js.
   ========================================================================== */
let _replay = null; // { map, raf }

function closeReplay(){
  if(!_replay) return;
  if(_replay.raf) cancelAnimationFrame(_replay.raf);
  try{ _replay.map.remove(); }catch(e){}
  _replay = null;
}

async function renderReplay(box, tripId, checkpoints){
  closeReplay();
  box.innerHTML = '<div class="empty-note">Memuat jalur…</div>';
  try{
    const [jd, rd] = await Promise.all([db.collection('jejak').doc(tripId).get(), db.collection('routes').doc(tripId).get()]);
    const pts = jd.exists ? (jd.data().titik || []).slice().sort((a, b) => a.t - b.t) : [];
    if(pts.length < 2){ box.innerHTML = '<div class="empty-note">Jejak tidak tercatat untuk trip ini (trip sebelum fitur jejak aktif, atau driver tidak bergerak).</div>'; return; }

    let km = 0; for(let i = 1; i < pts.length; i++) km += jarakMeter(pts[i-1].lat, pts[i-1].lng, pts[i].lat, pts[i].lng) / 1000;
    const hm = t => { const d = new Date(t * 1000); return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); };
    const t0 = pts[0].t, t1 = pts[pts.length-1].t;
    box.innerHTML = `
      <div class="status-value" style="margin-bottom:6px;">Jalur aktual ±${km.toFixed(1)} km · ${hm(t0)}–${hm(t1)} · ${pts.length} titik GPS</div>
      <div class="rp-map"></div>
      <div class="rp-ctl">
        <button class="btn-secondary rp-play">▶</button>
        <input type="range" class="rp-seek" min="0" max="1000" value="0">
        <span class="rp-time">${hm(t0)}</span>
        <select class="field rp-speed"><option value="60">60×</option><option value="300" selected>300×</option><option value="900">900×</option></select>
      </div>`;
    const map = new mapboxgl.Map({ container: box.querySelector('.rp-map'), style:'mapbox://styles/mapbox/dark-v11', center:[pts[0].lng, pts[0].lat], zoom:13 });
    _replay = { map, raf:null };
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    setTimeout(() => map.resize(), 100);

    const line = c => ({ type:'Feature', properties:{}, geometry:{ type:'LineString', coordinates:c } });
    const allC = pts.map(p => [p.lng, p.lat]);
    const route = rd.exists ? rd.data() : null;
    const st = { berhasil:'#22C55E', gagal:'#EF4444', ditunda:'#F59E0B' };
    const el = document.createElement('div'); el.className = 'rp-dot';
    const mover = new mapboxgl.Marker({ element: el }).setLngLat(allC[0]);

    map.on('load', () => {
      if(route && route.geometri) {
        map.addSource('rp-plan', { type:'geojson', data: line(decodePolyline(route.geometri)) });
        map.addLayer({ id:'rp-plan', type:'line', source:'rp-plan', paint:{ 'line-color':'#8B93A1', 'line-width':3, 'line-dasharray':[2,2] } });
      }
      map.addSource('rp-all', { type:'geojson', data: line(allC) });
      map.addLayer({ id:'rp-all', type:'line', source:'rp-all', paint:{ 'line-color':'#FFFFFF', 'line-width':2, 'line-opacity':0.3 } });
      map.addSource('rp-done', { type:'geojson', data: line([allC[0], allC[0]]) });
      map.addLayer({ id:'rp-done', type:'line', source:'rp-done', layout:{ 'line-cap':'round', 'line-join':'round' }, paint:{ 'line-color':'#2DD4BF', 'line-width':4 } });
      if(route && Array.isArray(route.titik)) route.titik.forEach(t => {
        const c = (checkpoints || []).find(x => x.urutan_titik === t.urutan_titik);
        const pin = document.createElement('div'); pin.className = 'rt-pin'; pin.textContent = t.urutan_titik;
        pin.style.background = c ? (st[c.status_kunjungan] || '#8B93A1') : '#8B93A1'; pin.style.borderColor = '#0B0F14';
        new mapboxgl.Marker({ element: pin }).setLngLat([t.lng, t.lat]).setPopup(new mapboxgl.Popup({ offset:14 }).setHTML(`<strong>${t.urutan_titik}. ${t.nama_lokasi}</strong><br>${c ? c.status_kunjungan : 'Belum dikunjungi'}`)).addTo(map);
      });
      mover.addTo(map);
      const b = new mapboxgl.LngLatBounds(); allC.forEach(c => b.extend(c)); map.fitBounds(b, { padding:40, duration:0 });
      show(t0);
    });

    // Interpolasi posisi pada waktu t (detik epoch)
    function at(t){
      if(t <= t0) return { i:0, c:allC[0] };
      if(t >= t1) return { i:pts.length-1, c:allC[allC.length-1] };
      let i = 0; while(i < pts.length - 2 && pts[i+1].t <= t) i++;
      const a = pts[i], b = pts[i+1], f = (t - a.t) / Math.max(1, b.t - a.t);
      return { i, c:[a.lng + (b.lng - a.lng) * f, a.lat + (b.lat - a.lat) * f] };
    }
    const seek = box.querySelector('.rp-seek'), timeEl = box.querySelector('.rp-time'), playBtn = box.querySelector('.rp-play'), speedEl = box.querySelector('.rp-speed');
    let cur = t0, playing = false, last = 0;
    function show(t){
      cur = t; const p = at(t);
      mover.setLngLat(p.c);
      const s = map.getSource('rp-done'); if(s) s.setData(line([...allC.slice(0, p.i + 1), p.c]));
      timeEl.textContent = hm(t); seek.value = Math.round((t - t0) / Math.max(1, t1 - t0) * 1000);
    }
    function tick(ts){
      if(!playing) return;
      if(last){ cur += (ts - last) / 1000 * Number(speedEl.value); }
      last = ts;
      if(cur >= t1){ cur = t1; playing = false; playBtn.textContent = '▶'; show(cur); return; }
      show(cur); _replay.raf = requestAnimationFrame(tick);
    }
    playBtn.addEventListener('click', () => {
      playing = !playing; playBtn.textContent = playing ? '⏸' : '▶';
      if(playing){ if(cur >= t1) cur = t0; last = 0; _replay.raf = requestAnimationFrame(tick); }
    });
    seek.addEventListener('input', () => { show(t0 + (t1 - t0) * seek.value / 1000); last = 0; });
  }catch(err){
    box.innerHTML = '<div class="empty-note">Gagal memuat jalur: ' + err.message + '</div>';
    console.error(err);
  }
}
