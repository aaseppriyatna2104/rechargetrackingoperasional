/* laporan.js — Rencana vs aktual per trip + laporan PDF (jsPDF dari cdnjs). Khusus admin. */
const _rad = x => x * Math.PI / 180;
function _hav(a, b){
  const dLat = _rad(b.lat - a.lat), dLng = _rad(b.lng - a.lng);
  const h = Math.sin(dLat/2)**2 + Math.cos(_rad(a.lat)) * Math.cos(_rad(b.lat)) * Math.sin(dLng/2)**2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}
function fmtDurasi(s){ s = Math.round(s); const m = Math.floor(s/60); return m >= 60 ? `${Math.floor(m/60)}j ${m%60}m` : m ? `${m}m ${s%60}d` : `${s}d`; }
const _dt = d => d ? d.toDate().toLocaleString('id-ID') : '-';
const _sel = (a, r, u) => `${a - r >= 0 ? '+' : ''}${(a - r).toFixed(1)} ${u}`;

async function ambilBanding(tripId, trip, cps){
  let plan = null;
  const r = await db.collection('routes').doc(tripId).get();
  if(r.exists && (r.data().titik || []).length) plan = r.data();
  else if(trip.waktu_checkin){
    const d = trip.waktu_checkin.toDate();
    const tgl = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const p = await db.collection('rencana_rute').doc(`${trip.driver_id}_${tgl}`).get();
    if(p.exists) plan = p.data();
  }
  const j = await db.collection('jejak').doc(tripId).get();
  const pts = j.exists ? (j.data().titik || []) : [];
  let m = 0; for(let i = 1; i < pts.length; i++) m += _hav(pts[i-1], pts[i]);
  const urut = [...cps].sort((a, b) => (a.timestamp_selesai ? a.timestamp_selesai.toMillis() : 0) - (b.timestamp_selesai ? b.timestamp_selesai.toMillis() : 0));
  const dw = cps.filter(c => c.status_kunjungan === 'berhasil' && c.durasi_detik != null).map(c => c.durasi_detik);
  return {
    adaRencana: !!plan,
    rencanaKm: plan && plan.jarak_m ? plan.jarak_m / 1000 : null,
    rencanaMenit: plan && plan.durasi_s ? plan.durasi_s / 60 : null,
    aktualKm: pts.length > 1 ? m / 1000 : null,
    aktualMenit: trip.waktu_checkin && trip.waktu_selesai ? (trip.waktu_selesai.toMillis() - trip.waktu_checkin.toMillis()) / 60000 : null,
    titikRencana: plan ? (plan.titik || []).length : null,
    berhasil: cps.filter(c => c.status_kunjungan === 'berhasil').length,
    gagal: cps.filter(c => c.status_kunjungan === 'gagal').length,
    ditunda: cps.filter(c => c.status_kunjungan === 'ditunda').length,
    berurutan: !urut.some((c, i) => i > 0 && c.urutan_titik < urut[i-1].urutan_titik),
    dwellRata: dw.length ? dw.reduce((a, b) => a + b, 0) / dw.length : null
  };
}

function ringkasBanding(b, trip){
  const L = [];
  if(trip.kendaraan_plat){
    const odo = trip.odometer_awal != null ? ` | Odometer ${trip.odometer_awal} -> ${trip.odometer_akhir != null ? trip.odometer_akhir : '...'}${trip.km_odometer != null ? ` (${trip.km_odometer} km)` : ''}` : '';
    L.push(`Kendaraan: ${trip.kendaraan_plat}${odo}`);
  }
  if(!b.adaRencana) L.push('Rencana rute untuk trip ini tidak ditemukan.');
  else{
    if(b.rencanaKm != null) L.push(`Jarak: rencana ${b.rencanaKm.toFixed(1)} km | GPS aktual ${b.aktualKm != null ? b.aktualKm.toFixed(1) + ' km (' + _sel(b.aktualKm, b.rencanaKm, 'km') + ')' : '-'}`);
    if(b.rencanaMenit != null) L.push(`Waktu: rencana tempuh ${Math.round(b.rencanaMenit)} mnt | aktual trip ${b.aktualMenit != null ? Math.round(b.aktualMenit) + ' mnt (termasuk waktu di titik)' : 'masih berjalan'}`);
    L.push(`Titik: rencana ${b.titikRencana} | berhasil ${b.berhasil}, gagal ${b.gagal}, ditunda ${b.ditunda} | urutan ${b.berurutan ? 'sesuai rencana' : 'BERBEDA dari rencana'}`);
  }
  if(b.dwellRata != null) L.push(`Rata-rata waktu di titik (berhasil): ${fmtDurasi(b.dwellRata)}`);
  return L;
}
const htmlBanding = (b, trip) => '<div class="sheet-title" style="font-size:13px; margin-top:14px;">Rencana vs Aktual</div><div class="status-value">' + ringkasBanding(b, trip).join('<br>') + '</div>';

function buatPdfTrip({ trip, nama, cps, trx, banding }){
  if(!window.jspdf){ alert('Library PDF belum termuat. Cek koneksi lalu coba lagi.'); return; }
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
  let y = 16;
  const line = (txt, s = 10, bold = false, gap = 0) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(s);
    doc.splitTextToSize(String(txt), 180).forEach(l => { if(y > 282){ doc.addPage(); y = 16; } doc.text(l, 15, y); y += s * 0.45; });
    y += gap;
  };
  line('Laporan Trip - Recharge Tracking', 15, true, 3);
  line(`Driver: ${nama}`, 11, true);
  line(`Checkin: ${_dt(trip.waktu_checkin)}   |   Selesai: ${trip.waktu_selesai ? _dt(trip.waktu_selesai) : 'masih berjalan'}`, 10, false, 3);
  ringkasBanding(banding, trip).forEach(t => line(t));
  y += 3; line('Checkpoint', 12, true, 1);
  if(!cps.length) line('Tidak ada checkpoint.');
  cps.forEach(c => {
    line(`${c.urutan_titik}. ${c.nama_lokasi} [${c.status_kunjungan}]${c.jenis_aksi ? ' ' + c.jenis_aksi : ''}${c.machine_id ? ' | ' + c.machine_id : ''}`, 10, true);
    line(`${_dt(c.timestamp_selesai)}${c.durasi_detik != null ? ' | di titik ' + fmtDurasi(c.durasi_detik) : ''}${c.jarak_ke_titik_m != null ? ' | ' + c.jarak_ke_titik_m + ' m dari titik' : ''}`);
    if(c.catatan) line('Catatan: ' + c.catatan);
    if(c.foto_url) line('Foto: ' + c.foto_url, 8, false, 1);
  });
  y += 3; line('Transaksi Keuangan', 12, true, 1);
  let total = 0;
  if(!trx.length) line('Tidak ada transaksi.');
  trx.forEach(t => { total += Number(t.nominal) || 0; line(`${t.kategori}${t.catatan ? ' - ' + t.catatan : ''}: Rp ${Number(t.nominal).toLocaleString('id-ID')}`); });
  if(trx.length) line(`Total: Rp ${total.toLocaleString('id-ID')}`, 10, true);
  const d = trip.waktu_checkin ? trip.waktu_checkin.toDate() : new Date();
  doc.save(`trip_${nama.replace(/\s+/g, '-')}_${d.toISOString().slice(0, 10)}.pdf`);
}
