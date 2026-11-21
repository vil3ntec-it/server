// ═══════════════════════════════════════════════════════════════════════════
//  رازِ دوعاملیِ (TOTP) کاربرانِ پنل — رمزشده روی دیسک (C-02، ممیزیِ رازهای در حالِ سکون، ۱۴۰۵/۰۸/۲۶)
//
//  تا ۱.۵۳.۱ ‎users.totp_secret‎ و ‎users.totp_pending‎ همان base32 ِ خام بودند: هر کس فقط ‎panel.db‎ (یا
//  پشتیبانش) را داشت، کدِ شش‌رقمیِ هر کاربر — مالک هم — را می‌ساخت و مرحلهٔ دوم عملاً حذف می‌شد. راز برای
//  سنجیدنِ کد لازم است (هش‌شدنی نیست)، پس با همان جعبهٔ رازِ ‎data/vault.key‎ (‎lib/secret-box.js‎، AES-256-GCM)
//  رمز می‌شود — کلید هرگز در دیتابیس نیست. شناسهٔ کاربر درونِ متنِ رمزشده است ⇒ پاکتِ یک کاربر روی ردیفِ
//  کاربرِ دیگر باز نمی‌شود.
//
//  ⛔ پاکتِ ناخوانا (کلیدِ دیگر، دست‌خورده، کاربرِ دیگر) ⇒ ‎null‎ ⇒ هیچ کدی پذیرفته نیست (بسته، نه باز)؛ راهِ نجات
//  همان کدِ بازیابی و ‎vill3n owner-reset‎. خامِ کهنهٔ base32 فقط در پنجرهٔ مهاجرتِ ۰۱۵ پذیرفته است (همان
//  مهاجرت در بالا آمدن همه را رمز می‌کند؛ این پذیرش فقط برای نصبی است که مهاجرتش نیمه ماند).
//  ⛔ راز، پاکت یا کلید هرگز در لاگ، خطا یا دفتر نیست.
// ═══════════════════════════════════════════════════════════════════════════
import { box, unbox, isBoxed } from './secret-box.js';

const BASE32 = /^[A-Z2-7]+=*$/;
const bound = (userId) => `totp:v1:${Number(userId)}:`;

/** رازِ base32 ⇒ پاکت (تهی ⇒ همان تهی) */
export function sealTotp(userId, secret) {
  if (secret === null || secret === undefined || secret === '') return secret ?? null;
  return box(bound(userId) + String(secret));
}

/** پاکت ⇒ رازِ base32؛ تهی ⇒ ‎null‎؛ خامِ کهنهٔ base32 ⇒ همان؛ هر چیزِ دیگر ⇒ ‎null‎ */
export function openTotp(userId, stored) {
  if (stored === null || stored === undefined || stored === '') return null;
  if (!isBoxed(stored)) return BASE32.test(String(stored)) ? String(stored) : null;
  const t = unbox(stored);
  const head = bound(userId);
  if (typeof t !== 'string' || !t.startsWith(head)) return null;
  const s = t.slice(head.length);
  return BASE32.test(s) ? s : null;
}

/** هر رازِ خامِ مانده ⇒ پاکت (CAS روی مقدارِ خوانده‌شده). شمارِ ردیف‌های رمزشده را برمی‌گرداند. */
export function sealLegacyTotp(db) {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('totp_secret') || !cols.includes('totp_pending')) return 0;
  const rows = db.prepare(`SELECT id, totp_secret, totp_pending FROM users
    WHERE (totp_secret IS NOT NULL AND totp_secret <> '' AND totp_secret NOT LIKE 'enc1:%')
       OR (totp_pending IS NOT NULL AND totp_pending <> '' AND totp_pending NOT LIKE 'enc1:%')`).all();
  const upd = db.prepare('UPDATE users SET totp_secret = ?, totp_pending = ? WHERE id = ? AND totp_secret IS ? AND totp_pending IS ?');
  let n = 0;
  for (const r of rows) {
    const next = (v) => (v && !isBoxed(v) ? sealTotp(r.id, v) : v);
    n += Number(upd.run(next(r.totp_secret), next(r.totp_pending), r.id, r.totp_secret, r.totp_pending).changes);
  }
  return n;
}

/** برگشت به نسخه‌ای که پاکت را نمی‌شناسد: هر پاکتِ خوانا ⇒ خام. پاکتِ ناخوانا دست نمی‌خورد. */
export function unsealAllTotp(db) {
  const rows = db.prepare(`SELECT id, totp_secret, totp_pending FROM users
    WHERE totp_secret LIKE 'enc1:%' OR totp_pending LIKE 'enc1:%'`).all();
  const upd = db.prepare('UPDATE users SET totp_secret = ?, totp_pending = ? WHERE id = ? AND totp_secret IS ? AND totp_pending IS ?');
  let n = 0;
  for (const r of rows) {
    const back = (v) => (isBoxed(v) ? openTotp(r.id, v) : v);
    const s = back(r.totp_secret);
    const p = back(r.totp_pending);
    if ((r.totp_secret && s === null) || (r.totp_pending && p === null)) continue;
    n += Number(upd.run(s, p, r.id, r.totp_secret, r.totp_pending).changes);
  }
  return n;
}
