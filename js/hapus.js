/* ==========================================================================
   hapus.js — hapus PERMANEN trip beserta seluruh turunannya. Hanya dipakai admin.
   Keamanan sebenarnya ada di firestore.rules (delete = isAdmin()), bukan di sini.
   Dimuat sebelum rekap.js & admin.js.
   Catatan: foto di Cloudinary TIDAK ikut terhapus (preset unsigned tidak bisa
   menghapus dari browser) — yang hilang hanya URL-nya.
   ========================================================================== */

// Konfirmasi 2 langkah: harus mengetik HAPUS.
function konfirmasiHapus(pesan){
  const jawab = prompt(pesan + '\n\nTindakan ini PERMANEN dan tidak bisa dibatalkan.\nKetik HAPUS untuk melanjutkan.');
  return !!jawab && jawab.trim().toUpperCase() === 'HAPUS';
}

// Hapus trip + checkpoints + transaksi_keuangan + jejak + routes. Dokumen trip dihapus paling akhir,
// jadi kalau gagal di tengah jalan, trip masih terlihat dan bisa dicoba hapus lagi.
// Pemanggil wajib memastikan trip tidak berstatus 'berjalan'.
async function hapusTripPermanen(tripIds, onProgress){
  let selesai = 0;
  for(const tripId of tripIds){
    const [cp, trx] = await Promise.all([
      db.collection('checkpoints').where('trip_id','==',tripId).get(),
      db.collection('transaksi_keuangan').where('trip_id','==',tripId).get()
    ]);
    const refs = [...cp.docs, ...trx.docs].map(d => d.ref);
    refs.push(db.collection('jejak').doc(tripId), db.collection('routes').doc(tripId), db.collection('trips').doc(tripId));
    for(let i = 0; i < refs.length; i += 400){ // batas Firestore 500 operasi/batch
      const batch = db.batch();
      refs.slice(i, i + 400).forEach(r => batch.delete(r));
      await batch.commit();
    }
    selesai++;
    if(onProgress) onProgress(selesai, tripIds.length);
  }
}
