// مسیرهای ورود/خروج و مدیریت حساب
import { Router } from 'express';
import {
  isInitialized,
  createUser,
  findUser,
  verifyPassword,
  createSession,
  destroySession,
  verifyToken,
  requireAuth,
  listSessions,
  changePassword,
} from '../auth.js';
import { db, logEvent } from '../db.js';
import { roleOf, listPanelUsers, setRole, setDisabled, deletePanelUser, ROLES, ROLE_ABILITIES, requireRole } from '../control/roles.js';
import { audit } from '../lib/audit.js';

const router = Router();

// آیا پنل هنوز راه‌اندازی نشده؟ (ساخت اولین حساب مدیر)
router.get('/status', (req, res) => {
  res.json({ initialized: isInitialized() });
});

router.post('/setup', (req, res) => {
  if (isInitialized()) return res.status(409).json({ error: 'already_initialized' });
  const { username, password } = req.body || {};
  if (!username || String(username).trim().length < 3) {
    return res.status(400).json({ error: 'username_too_short' });
  }
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: 'password_too_short' });
  }
  const user = createUser(String(username).trim(), String(password));
  const session = createSession(user, req);
  audit(req, 'panel.setup', { target: user.username });
  logEvent('info', 'panel', `حساب مدیر «${user.username}» ساخته شد`);
  res.json({ ok: true, user: { id: user.id, username: user.username, role: 'admin' }, ...session });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = findUser(String(username || ''));
  if (user?.disabled) {
    logEvent('warn', 'panel', `ورودِ حسابِ از کار افتاده «${user.username}» رد شد`);
    return res.status(403).json({ error: 'account_disabled' });
  }
  if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
    logEvent('warn', 'panel', `ورود ناموفق با نام کاربری «${String(username || '').slice(0, 40)}»`);
    audit(req, 'panel.login', { target: String(username || '').slice(0, 40), ok: false });
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  const session = createSession(user, req);
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(Date.now(), user.id);
  logEvent('info', 'panel', `کاربر «${user.username}» وارد شد`);
  audit(req, 'panel.login', { target: user.username });
  res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role || 'admin' }, ...session });
});

router.post('/logout', requireAuth, (req, res) => {
  destroySession(req.user.sessionId);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const role = roleOf(req);
  res.json({
    user: { id: req.user.id, username: req.user.username, role },
    abilities: ROLE_ABILITIES[role] || [],
    sessions: listSessions(req.user.id),
  });
});

/* ---------------------- کاربرانِ پنل (فقط مدیر) ------------------------ */

router.get('/users', requireAuth, requireRole('admin'), (req, res) => {
  res.json({ users: listPanelUsers(), roles: ROLES, abilities: ROLE_ABILITIES });
});

router.post('/users', requireAuth, requireRole('admin'), (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || String(username).trim().length < 3) return res.status(400).json({ error: 'username_too_short' });
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'password_too_short' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'invalid_role' });
  if (findUser(String(username).trim())) return res.status(409).json({ error: 'username_taken' });
  const user = createUser(String(username).trim(), String(password));
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
  logEvent('info', 'panel', `کاربر «${user.username}» با نقشِ ${role} ساخته شد`);
  res.status(201).json({ user: { id: user.id, username: user.username, role, disabled: false } });
});

router.patch('/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    if (req.body?.role !== undefined) setRole(req.params.id, req.body.role, req.user.username);
    if (req.body?.disabled !== undefined) setDisabled(req.params.id, Boolean(req.body.disabled), req.user.username);
    res.json({ users: listPanelUsers() });
  } catch (e) {
    const code = e.message === 'not_found' ? 404 : 400;
    res.status(code).json({ error: e.message });
  }
});

router.delete('/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  if (Number(req.params.id) === Number(req.user.id)) return res.status(400).json({ error: 'cannot_delete_self' });
  try {
    deletePanelUser(req.params.id, req.user.username);
    res.json({ ok: true, users: listPanelUsers() });
  } catch (e) {
    res.status(e.message === 'not_found' ? 404 : 400).json({ error: e.message });
  }
});

router.post('/change-password', requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ error: 'password_too_short' });
  }
  const result = changePassword(req.user.id, String(oldPassword || ''), String(newPassword));
  if (!result.ok) return res.status(400).json(result);
  res.json({ ok: true });
});

// برای بررسی اعتبار توکن از سمت Socket.IO
export { verifyToken };
export default router;
