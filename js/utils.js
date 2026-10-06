/* ==========================================================================
   utils.js — fungsi bantu yang dipakai bersama oleh driver.js dan admin.js.
   Dimuat setelah config.js, sebelum driver.js/admin.js.
   ========================================================================== */

// Hash PIN dengan SHA-256 (dipakai saat login driver & saat admin membuat/edit akun driver)
async function hashPin(pin){
  const enc = new TextEncoder().encode(pin);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// Jarak dua koordinat dalam meter (rumus Haversine)
function jarakMeter(lat1, lng1, lat2, lng2){
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const h = Math.sin(dLat/2)**2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
