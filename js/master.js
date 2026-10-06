/* master.js — Master data kendaraan & mesin (khusus admin). Dibaca driver untuk dropdown/validasi. */
function initMaster(){
  const $ = id => document.getElementById(id), err = $('masterError');
  const render = (el, snap, label) => {
    el.innerHTML = '';
    if(snap.empty){ el.innerHTML = '<div class="empty-note">Belum ada.</div>'; return; }
    snap.docs.forEach(d => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;';
      const t = document.createElement('span'); t.textContent = label(d.data());
      const b = document.createElement('button'); b.className = 'btn-delete'; b.textContent = 'Hapus';
      b.onclick = async () => {
        if(!confirm(`Hapus "${t.textContent}" dari master data? (Riwayat trip lama tidak berubah.)`)) return;
        try{ await d.ref.delete(); }catch(e){ err.textContent = 'Gagal hapus: ' + e.message; }
      };
      row.append(t, b); el.appendChild(row);
    });
  };
  const onErr = e => { err.textContent = e.message; console.error(e); };
  db.collection('kendaraan').orderBy('plat').onSnapshot(s => render($('kendList'), s, x => x.plat + (x.jenis ? ' - ' + x.jenis : '')), onErr);
  db.collection('mesin').orderBy('machine_id').onSnapshot(s => { $('mesinCount').textContent = s.size + ' mesin terdaftar'; render($('mesinList'), s, x => x.machine_id); }, onErr);

  $('btnAddKend').onclick = async () => {
    err.textContent = '';
    const plat = $('kendPlat').value.trim().toUpperCase().replace(/\s+/g, ' ');
    if(!plat){ err.textContent = 'Plat wajib diisi.'; return; }
    try{
      await db.collection('kendaraan').doc(plat.replace(/[\s\/]/g, '')).set({ plat, jenis: $('kendJenis').value.trim() });
      $('kendPlat').value = ''; $('kendJenis').value = '';
    }catch(e){ onErr(e); }
  };
  $('btnAddMesin').onclick = async () => {
    err.textContent = '';
    const ids = [...new Set($('mesinInput').value.split(/[\n,;]+/).map(x => x.trim().toUpperCase().replace(/\//g, '-')).filter(Boolean))];
    if(!ids.length){ err.textContent = 'Isi Machine ID (boleh banyak, satu per baris).'; return; }
    try{
      for(let i = 0; i < ids.length; i += 400){
        const b = db.batch();
        ids.slice(i, i + 400).forEach(id => b.set(db.collection('mesin').doc(id), { machine_id: id }));
        await b.commit();
      }
      $('mesinInput').value = '';
    }catch(e){ onErr(e); }
  };
}
