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
  logEvent('info', 'panel', `حساب مدیر «${user.username}» ساخته شد`);
  res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role }, ...session });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = findUser(String(username || ''));
  if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
    logEvent('warn', 'panel', `ورود ناموفق با نام کاربری «${String(username || '').slice(0, 40)}»`);
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  if (user.disabled) {
    logEvent('warn', 'panel', `ورودِ حسابِ بسته‌شدهٔ «${user.username}» رد شد`);
    return res.status(403).json({ error: 'account_disabled' });
  }
  const session = createSession(user, req);
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), user.id);
  logEvent('info', 'panel', `کاربر «${user.username}» وارد شد`);
  res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role }, ...session });
});

router.post('/logout', requireAuth, (req, res) => {
  destroySession(req.user.sessionId);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({
    user: { id: req.user.id, username: req.user.username, role: req.user.role },
    sessions: listSessions(req.user.id),
  });
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
