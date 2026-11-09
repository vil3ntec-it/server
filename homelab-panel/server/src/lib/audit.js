// ---------------------------------------------------------------------------
//  دفترِ کارهای حساس
//
//  «چه کسی، کِی، چه کرد» — برای وقتی که چیزی پاک شده و کسی یادش نیست چرا.
//  فقط کارهای حساس ثبت می‌شوند، نه هر درخواستِ خواندن.
// ---------------------------------------------------------------------------
import { clientIp } from '../platform/security.js';
import { db } from '../db.js';
import { scrub } from '../control/audit.js';

/* ⚠️ دستور را همان اول آماده نمی‌کنیم: ماژول‌ها پیش از اجرای مهاجرت‌ها
   بارگذاری می‌شوند، و آن موقع هنوز جدول ساخته نشده. پس تنبل و بارِ اول. */
let insert = null;
function statement() {
  if (insert) return insert;
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      at     INTEGER NOT NULL,
      actor  TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      ip     TEXT,
      ok     INTEGER NOT NULL DEFAULT 1,
      detail TEXT
    );
  `);
  insert = db.prepare('INSERT INTO audit_log(at, actor, action, target, ip, ok, detail) VALUES(?,?,?,?,?,?,?)');
  return insert;
}

/** چه کسی این درخواست را زده؟ */
export function actorOf(req) {
  if (req?.user?.local) return 'local-app';
  if (req?.user?.username) return `panel:${req.user.username}`;
  if (req?.appUser) return `app:${req.appUser.app}:${req.appUser.id}`;
  return 'anonymous';
}

export function audit(req, action, { target = null, ok = true, detail = null } = {}) {
  try {
    // IPِ دروغ در دفترِ حسابرسی از نبودش بدتر است — از تنها محاسبهٔ معتبر
    const ip = clientIp(req);
    statement().run(
      Date.now(),
      actorOf(req),
      String(action).slice(0, 60),
      target ? String(target).slice(0, 400) : null,
      ip,
      ok ? 1 : 0,
      detailText(detail)
    );
  } catch { /* دفتر نباید کار را بخواباند */ }
}

/*
 *  ⛔ (فاز ۱ ِ ممیزی، ۶-۷ / S9) تا ۱.۵۰.۶۱ این‌جا `String(detail)` بود و هر
 *  جزئیاتِ شیء — «چند کدِ بازیابی مانده»، «از چند دستگاه خارج شد»، «گامِ
 *  دوعاملی» — در دفتر `"[object Object]"` می‌نشست. حالا شیء JSON می‌شود و
 *  کلیدهای راز (`password`، `token`، `secret`، …) پوشانده؛ متن همان متن.
 */
export function detailText(detail) {
  if (detail == null || detail === '') return null;
  if (typeof detail === 'string') return detail.slice(0, 1000);
  try {
    return JSON.stringify(scrub(detail)).slice(0, 1000);
  } catch {
    return null;
  }
}

export function recentAudit({ limit = 100, action = null } = {}) {
  const rows = action
    ? db.prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT ?').all(action, Math.min(500, limit))
    : db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(Math.min(500, limit));
  return rows.map((r) => ({ ...r, ok: Boolean(r.ok) }));
}

/** دفتر بی‌نهایت بزرگ نشود */
export function pruneAudit(keep = 20000) {
  try {
    db.exec(`DELETE FROM audit_log WHERE id NOT IN (SELECT id FROM audit_log ORDER BY id DESC LIMIT ${Number(keep)})`);
  } catch { /* بی‌خیال */ }
}
