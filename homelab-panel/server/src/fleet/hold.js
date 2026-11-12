// ---------------------------------------------------------------------------
//  «سرورهای من» — برنامه‌ای که همین حالا «نگه داشته» شده (۱.۵۰.۹۵، گامِ ۳)
//
//  دو حالت، هر دو در دیتابیسِ همین نصب (پس پنلی که وسطِ کار دوباره بالا بیاید هم همان را می‌داند):
//    • ‎moving‎ — در یک کارِ جابه‌جایی (مبدأ: «فقط‌خواندنی»/ایستاده؛ مقصد: جای‌گرفته ولی هنوز روشن‌نشده)
//    • ‎aside‎  — از این نصب رفته و کنار گذاشته شده (پاک نه)
//  ⛔ برنامهٔ نگه‌داشته‌شده **روشن نمی‌شود**: `sites/process.js` (startSite)، `account/supervisor.js` (startAccountServer) و
//     دفترِ سرورِ سایت (`sitesync`) همین را می‌پرسند — نه دکمهٔ «اجرا»، نه «اجرای خودکار»، نه «ری‌استارتِ سرویسِ افتاده».
//     فقط خودِ کارِ جابه‌جایی (src/fleet/mover.js) پیش از روشن کردن نگه را برمی‌دارد.
//  ⛔ کدِ پمپ دست نمی‌خورد: پمپ‌ها این‌جا هرگز نگه داشته نمی‌شوند (جابه‌جایی‌شان فقط با پنلِ بسته از خطِ فرمان است).
//  هیچ import ِ دیگری جز db.js — ماژول‌های سایت و سرورِ حساب بی چرخه می‌خوانندش.
// ---------------------------------------------------------------------------
import { db } from '../db.js';

const HELD_LOCAL = ['frozen', 'staged', 'placed', 'retiring'];

/** ‎{ reason: 'moving'|'aside', moveId }‎ یا null */
export function holdOf(appId) {
  try {
    const m = db.prepare(`SELECT move_id FROM fleet_move_local WHERE app_id = ? AND state IN (${HELD_LOCAL.map(() => '?').join(',')}) ORDER BY updated_at DESC LIMIT 1`)
      .get(String(appId), ...HELD_LOCAL);
    if (m) return { reason: 'moving', moveId: m.move_id };
    const a = db.prepare('SELECT move_id FROM fleet_aside WHERE app_id = ? AND restored_at IS NULL ORDER BY id DESC LIMIT 1').get(String(appId));
    if (a) return { reason: 'aside', moveId: a.move_id || null };
  } catch { /* جدول هنوز نیست (پیش از مهاجرتِ ۰۱۱) */ }
  return null;
}

export const siteHold = (slug) => holdOf(`site:${slug}`);

export const HOLD_MESSAGE = {
  moving: 'این برنامه در میانهٔ جابه‌جایی به سرورِ دیگر است («سرورهای من») — تا پایانِ کار روشن نمی‌شود.',
  aside: 'این برنامه به سرورِ دیگری رفته و این‌جا کنار گذاشته شده («سرورهای من») — روشن کردنش این‌جا «دو دفتر» می‌سازد.',
};
