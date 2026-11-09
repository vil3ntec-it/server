// ---------------------------------------------------------------------------
//  مدیریت کاربران و نقش‌ها — فقط برای admin (قراردادِ نسخه‌دارِ ‎/api/panel/v1/users‎)
//
//  ⛔ قاعده‌ها این‌جا نوشته **نمی‌شوند** (۱۴۰۵/۰۸/۰۹، ۶-۲ / S17): همان تابع‌های
//  `control/roles.js` که `/api/auth/users` هم صدا می‌زند. تا ۱.۵۰.۶۱ دو درِ
//  کاربران دو دسته قاعدهٔ نابرابر داشتند. این فایل فقط شکلِ پاسخِ قراردادِ v1
//  را نگه می‌دارد (ورودیِ بد ⇒ ۴۰۰ ِ `invalid_input` با `field`):
//    • هرگز password_hash بیرون نمی‌رود
//    • خودت: نه تنزل، نه بستن، نه حذف؛ رمزِ خودت فقط با رمزِ فعلی
//    • آخرین مدیر و مالکِ اصلی (`ownerId()`) دست نمی‌خورند
//    • تغییرِ نقش یا بستن ⇒ همهٔ نشست‌های آن کاربر باطل
//    • همهٔ نوشتن‌ها پشتِ احرازِ دوباره (رمز در ده دقیقهٔ گذشته)
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { requireAuth, requireRole, requireRecentAuth, createUser, hashPassword, ROLES } from '../auth.js';
import { db, logEvent } from '../db.js';
import { v } from '../platform/validate.js';
import {
  ownerId, USERNAME_RE, createPanelUser, updatePanelUser, resetPanelUserPassword, deletePanelUser,
} from '../control/roles.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));
router.use((req, res, next) => (req.method === 'GET' || req.method === 'HEAD' ? next() : requireRecentAuth(req, res, next)));

const PUBLIC_COLUMNS = 'id, username, role, disabled, created_at, last_login_at';

/** خطای قاعده ⇒ همان کد؛ بقیه به `handleValidation`/۵۰۰ */
function fail(res, next, e) {
  if (e?.code && e?.status) {
    // نامِ تکراری در قراردادِ v1 از روزِ اول `already_exists` بوده
    return res.status(e.status).json({ error: e.code === 'username_taken' ? 'already_exists' : e.code });
  }
  return next(e);
}

router.get('/', (req, res) => {
  const owner = ownerId();
  const users = db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY id`).all()
    .map((u) => ({ ...u, owner: u.id === owner }));
  res.json({ users, roles: ROLES });
});

router.post('/', (req, res, next) => {
  try {
    const username = v.string(req.body?.username, 'username', { min: 3, max: 40, pattern: USERNAME_RE });
    const password = v.password(req.body?.password);
    const role = v.oneOf(req.body?.role ?? 'viewer', 'role', ROLES);
    const user = createPanelUser(req, { username, password, role }, createUser);
    logEvent('info', 'panel', `کاربر «${username}» با نقشِ ${user.role} ساخته شد`);
    res.json({ ok: true, user });
  } catch (e) {
    fail(res, next, e);
  }
});

router.put('/:id', (req, res, next) => {
  try {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const body = {};
    if ('role' in (req.body || {})) body.role = v.oneOf(req.body.role, 'role', ROLES);
    if ('disabled' in (req.body || {})) body.disabled = v.bool(req.body.disabled, 'disabled');
    const u = updatePanelUser(req, id, body);
    logEvent('warn', 'panel', `کاربر «${u.username}»: نقش ${u.role}${u.disabled ? ' — حساب بسته است' : ''}`);
    res.json({ ok: true, user: db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`).get(id) });
  } catch (e) {
    fail(res, next, e);
  }
});

// بازنشانیِ رمزِ کاربرِ دیگر — رمزِ قبلی لازم نیست چون مدیر است که می‌زند
router.put('/:id/password', (req, res, next) => {
  try {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const password = v.password(req.body?.password);
    resetPanelUserPassword(req, id, password, hashPassword);
    logEvent('warn', 'panel', `رمزِ کاربرِ #${id} توسط مدیر بازنشانی شد`);
    res.json({ ok: true });
  } catch (e) {
    fail(res, next, e);
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    const id = v.int(req.params.id, 'id', { min: 1 });
    deletePanelUser(req, id);
    logEvent('warn', 'panel', `کاربرِ #${id} حذف شد`);
    res.json({ ok: true });
  } catch (e) {
    fail(res, next, e);
  }
});

export default router;
