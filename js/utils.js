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
