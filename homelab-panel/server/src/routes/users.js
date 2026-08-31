// ---------------------------------------------------------------------------
//  مدیریت کاربران و نقش‌ها — فقط برای admin
//
//  قاعده‌های محافظتی که این‌جا رعایت می‌شود:
//    • هرگز password_hash بیرون نمی‌رود
//    • مدیر نمی‌تواند نقشِ خودش را پایین بیاورد یا خودش را ببندد
//      (وگرنه پنلی می‌ماند که هیچ‌کس نمی‌تواند مدیریتش کند)
//    • آخرین admin نه حذف می‌شود، نه بسته، نه تنزل داده
//    • تغییرِ نقش یا بستنِ حساب، همهٔ نشست‌های آن کاربر را باطل می‌کند
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { requireAuth, requireRole, createUser, hashPassword, ROLES, isValidRole } from '../auth.js';
import { db, logEvent } from '../db.js';
import { v } from '../platform/validate.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

const PUBLIC_COLUMNS = 'id, username, role, disabled, created_at, last_login_at';

function countAdmins(excludeId = null) {
  return db
    .prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND id <> ?`)
    .get(excludeId ?? -1).n;
}

router.get('/', (req, res) => {
  const users = db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY id`).all();
  res.json({ users, roles: ROLES });
});

router.post('/', (req, res, next) => {
  try {
    const username = v.string(req.body?.username, 'username', {
      min: 3,
      max: 40,
      pattern: /^[a-zA-Z0-9._-]+$/,
    });
    const password = v.password(req.body?.password);
    const role = v.oneOf(req.body?.role ?? 'viewer', 'role', ROLES);

    if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
      return res.status(409).json({ error: 'already_exists' });
    }

    const user = createUser(username, password, role);
    logEvent('info', 'panel', `کاربر «${username}» با نقشِ ${user.role} ساخته شد`);
    res.json({ ok: true, user });
  } catch (e) {
    next(e);
  }
});

router.put('/:id', (req, res, next) => {
  try {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!target) return res.status(404).json({ error: 'not_found' });

    const self = id === req.user.id;
    let role = target.role;
    let disabled = target.disabled;

    if ('role' in (req.body || {})) {
      role = v.oneOf(req.body.role, 'role', ROLES);
      // مدیر نباید بتواند خودش را از مدیریت بیندازد و پنل را قفل کند
      if (self && role !== 'admin') return res.status(400).json({ error: 'cannot_demote_self' });
    }
    if ('disabled' in (req.body || {})) {
      disabled = v.bool(req.body.disabled, 'disabled') ? 1 : 0;
      if (self && disabled) return res.status(400).json({ error: 'cannot_disable_self' });
    }

    // آخرین مدیرِ فعال باید بماند
    const losingAdmin = target.role === 'admin' && !target.disabled && (role !== 'admin' || disabled);
    if (losingAdmin && countAdmins(target.id) === 0) {
      return res.status(400).json({ error: 'last_admin' });
    }

    db.prepare('UPDATE users SET role = ?, disabled = ? WHERE id = ?').run(role, disabled, id);

    // تغییرِ دسترسی باید فوری اثر کند، نه بعد از انقضای توکن
    if (role !== target.role || disabled !== target.disabled) {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      logEvent(
        'warn',
        'panel',
        `کاربر «${target.username}»: نقش ${target.role} → ${role}${disabled ? ' و حساب بسته شد' : ''}`
      );
    }

    res.json({ ok: true, user: db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`).get(id) });
  } catch (e) {
    next(e);
  }
});

// بازنشانیِ رمزِ کاربرِ دیگر — رمزِ قبلی لازم نیست چون مدیر است که می‌زند
router.put('/:id/password', (req, res, next) => {
  try {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const password = v.password(req.body?.password);
    const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(id);
    if (!target) return res.status(404).json({ error: 'not_found' });

    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    logEvent('warn', 'panel', `رمزِ کاربر «${target.username}» توسط مدیر بازنشانی شد`);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!target) return res.status(404).json({ error: 'not_found' });
    if (id === req.user.id) return res.status(400).json({ error: 'cannot_delete_self' });
    if (target.role === 'admin' && !target.disabled && countAdmins(target.id) === 0) {
      return res.status(400).json({ error: 'last_admin' });
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(id); // نشست‌ها با CASCADE می‌روند
    logEvent('warn', 'panel', `کاربر «${target.username}» حذف شد`);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
