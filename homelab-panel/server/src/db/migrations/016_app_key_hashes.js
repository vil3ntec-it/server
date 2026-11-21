// ---------------------------------------------------------------------------
//  ۰۱۶ — کلیدِ برنامه‌ها روی دیسک فقط هش (C-04، ۱.۵۳.۳)
//
//  ‎code_apps.api_key‎ و ‎app_clients.api_key‎ ِ خام در جا ‎sha256:‎ ِ برچسب‌دار می‌شوند (‎lib/app-key.js‎) و نشانه‌شان
//  (‎api_key_hint‎، پیشوند و چهار نویسه) برای فهرست می‌ماند. همان کلید کار می‌کند — هیچ برنامه‌ای کلیدِ تازه لازم ندارد —
//  فقط دیگر در پنل دیده نمی‌شود (کلیدِ گم‌شده ⇐ «چرخاندن»). ردیفِ هش‌شده دست نمی‌خورد.
//  جدول‌ها را ماژول‌هایشان می‌سازند؛ روی نصبِ تازه هنوز نیستند ⇒ هیچ کاری (ردیفِ تازه از همان آغاز هش است).
//  برگشت: بکاپِ خودکارِ پیش از مهاجرت (‎data/backups/‎). هش برگشت‌ناپذیر است؛ نسخهٔ پیشین با این ردیف‌ها کلیدها را نمی‌پذیرد.
// ---------------------------------------------------------------------------
import { hashAppKey, appKeyHint, HASH_PREFIX } from '../../lib/app-key.js';

export function up(db) {
  for (const table of ['code_apps', 'app_clients']) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.length || !cols.includes('api_key')) continue;
    if (!cols.includes('api_key_hint')) db.exec(`ALTER TABLE ${table} ADD COLUMN api_key_hint TEXT`);
    const rows = db.prepare(`SELECT slug, api_key FROM ${table}
      WHERE api_key IS NOT NULL AND api_key <> '' AND api_key NOT LIKE '${HASH_PREFIX}%'`).all();
    const upd = db.prepare(`UPDATE ${table} SET api_key = ?, api_key_hint = ? WHERE slug = ? AND api_key = ?`);
    for (const r of rows) upd.run(hashAppKey(r.api_key), appKeyHint(r.api_key), r.slug, r.api_key);
  }
}
