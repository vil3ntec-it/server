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
  revokeSession,
  revokeOtherSessions,
  jwtSecret,
} from '../auth.js';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { newSecret, verifyTotp, otpauthUrl, newRecoveryCodes, hashRecovery, useRecoveryCode } from '../lib/totp.js';
import { getSetting } from '../db.js';
import { db, logEvent } from '../db.js';
import { roleOf, listPanelUsers, setRole, setDisabled, deletePanelUser, ROLES, ROLE_ABILITIES, requireRole } from '../control/roles.js';
import { audit } from '../lib/audit.js';
import { noteLogin } from '../automation/sources.js';
import { clientIp } from '../platform/security.js';

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
  res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role || 'admin' }, ...session });
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
    // رگبارِ ورودِ ناموفق ⇒ رویدادِ login.suspicious برای موتورِ اتوماسیون
    noteLogin({ ok: false, username, ip: clientIp(req), userAgent: req.headers['user-agent'] });
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  if (user.disabled) {
    logEvent('warn', 'panel', `ورودِ حسابِ بسته‌شدهٔ «${user.username}» رد شد`);
    return res.status(403).json({ error: 'account_disabled' });
  }
  /*
   *  ورودِ دوعاملی: رمز درست بود ولی نشست هنوز ساخته نمی‌شود. یک بلیتِ
   *  پنج‌دقیقه‌ای برمی‌گردد و کاربر باید کدِ اپِ Authenticator (یا یک کدِ
   *  بازیابی) را بدهد. بلیت با `typ: 'totp'` مهر می‌خورد و `verifyToken`
   *  آن را نشست نمی‌شمارد.
   */
  if (user.totp_enabled) {
    const ticket = jwt.sign({ uid: user.id, typ: 'totp' }, jwtSecret(), { expiresIn: 300 });
    audit(req, 'panel.login', { target: user.username, ok: true, detail: { step: 'totp_required' } });
    return res.json({ ok: false, totpRequired: true, ticket });
  }
  finishLogin(req, res, user);
});

function finishLogin(req, res, user) {
  const session = createSession(user, req);
  // هر دو ستون خوانده می‌شوند (روزنامهٔ نقش‌ها و فهرستِ کاربران)، پس هر دو تازه می‌مانند
  const now = Date.now();
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(now, user.id);
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, user.id);
  logEvent('info', 'panel', `کاربر «${user.username}» وارد شد`);
  audit(req, 'panel.login', { target: user.username });
  // ورودِ موفق از IPِ تازه هم به موتورِ اتوماسیون گفته می‌شود
  noteLogin({ ok: true, username: user.username, userId: user.id, ip: clientIp(req), userAgent: req.headers['user-agent'] });
  res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role || 'admin' }, ...session });
}

/** گامِ دومِ ورود — کدِ TOTP یا کدِ بازیابی. همان سقفِ نرخِ /login رویش هست. */
router.post('/login/totp', (req, res) => {
  const { ticket, code } = req.body || {};
  let payload;
  try {
    payload = jwt.verify(String(ticket || ''), jwtSecret());
  } catch {
    return res.status(401).json({ error: 'ticket_invalid' });
  }
  if (payload.typ !== 'totp') return res.status(401).json({ error: 'ticket_invalid' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
  if (!user || user.disabled || !user.totp_enabled) return res.status(401).json({ error: 'ticket_invalid' });

  if (verifyTotp(user.totp_secret, code)) return finishLogin(req, res, user);

  // کدِ بازیابی — یک‌بارمصرف
  const recovery = useRecoveryCode(JSON.parse(user.totp_recovery || '[]'), String(code || ''));
  if (recovery.ok) {
    db.prepare('UPDATE users SET totp_recovery = ? WHERE id = ?').run(JSON.stringify(recovery.remaining), user.id);
    logEvent('warn', 'panel', `کاربر «${user.username}» با کدِ بازیابی وارد شد (${recovery.remaining.length} کد مانده)`);
    audit(req, 'panel.totp.recovery_used', { target: user.username, detail: { remaining: recovery.remaining.length } });
    return finishLogin(req, res, user);
  }
  logEvent('warn', 'panel', `کدِ دوعاملیِ غلط برای «${user.username}»`);
  audit(req, 'panel.login', { target: user.username, ok: false, detail: { step: 'totp' } });
  return res.status(401).json({ error: 'totp_invalid' });
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

/* ---------------------- ورودِ دوعاملی (TOTP) ------------------------
 *  بخشِ ۴ پرامپت. راز فقط بعد از این‌که کاربر یک کدِ درست از اپش داد روشن
 *  می‌شود، وگرنه کسی که اپ را درست تنظیم نکرده از پنلِ خودش بیرون می‌ماند.
 */
router.get('/totp', requireAuth, (req, res) => {
  const u = db.prepare('SELECT totp_enabled, totp_recovery FROM users WHERE id = ?').get(req.user.id);
  res.json({
    enabled: Boolean(u?.totp_enabled),
    recoveryLeft: u?.totp_recovery ? JSON.parse(u.totp_recovery).length : 0,
  });
});

router.post('/totp/setup', requireAuth, async (req, res) => {
  const secret = newSecret();
  db.prepare('UPDATE users SET totp_pending = ? WHERE id = ?').run(secret, req.user.id);
  const issuer = String(getSetting('server_name', '') || 'VILL3N').slice(0, 40);
  const url = otpauthUrl({ issuer, account: req.user.username, secret });
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 220 });
  res.json({ secret, url, qr });
});

router.post('/totp/enable', requireAuth, (req, res) => {
  const u = db.prepare('SELECT totp_pending, username FROM users WHERE id = ?').get(req.user.id);
  if (!u?.totp_pending) return res.status(400).json({ error: 'totp_not_setup' });
  if (!verifyTotp(u.totp_pending, req.body?.code)) return res.status(400).json({ error: 'totp_invalid' });
  const codes = newRecoveryCodes();
  db.prepare('UPDATE users SET totp_secret = ?, totp_pending = NULL, totp_enabled = 1, totp_recovery = ? WHERE id = ?')
    .run(u.totp_pending, JSON.stringify(codes.map(hashRecovery)), req.user.id);
  logEvent('info', 'panel', `ورودِ دوعاملی برای «${u.username}» روشن شد`);
  audit(req, 'panel.totp.enable', { target: u.username });
  res.json({ ok: true, recoveryCodes: codes });
});

router.post('/totp/disable', requireAuth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!u?.totp_enabled) return res.status(400).json({ error: 'totp_not_enabled' });
  // خاموش کردن هم رمز می‌خواهد هم کد — وگرنه نشستِ دزدیده‌شده خودش قفل را برمی‌داشت
  if (!verifyPassword(String(req.body?.password || ''), u.password_hash)) return res.status(400).json({ error: 'wrong_password' });
  if (!verifyTotp(u.totp_secret, req.body?.code)) return res.status(400).json({ error: 'totp_invalid' });
  db.prepare('UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled = 0, totp_recovery = NULL WHERE id = ?').run(u.id);
  logEvent('warn', 'panel', `ورودِ دوعاملی برای «${u.username}» خاموش شد`);
  audit(req, 'panel.totp.disable', { target: u.username });
  res.json({ ok: true });
});

/* ---------------------- دستگاه‌های واردشده ------------------------ */
router.get('/sessions', requireAuth, (req, res) => {
  res.json({
    current: req.user.sessionId,
    sessions: listSessions(req.user.id).map((s) => ({ ...s, current: s.id === req.user.sessionId })),
  });
});

router.delete('/sessions/:id', requireAuth, (req, res) => {
  if (req.params.id === req.user.sessionId) return res.status(400).json({ error: 'use_logout' });
  const ok = revokeSession(req.user.id, req.params.id);
  if (!ok) return res.status(404).json({ error: 'not_found' });
  audit(req, 'panel.session.revoke', { target: req.params.id });
  res.json({ ok: true, sessions: listSessions(req.user.id) });
});

/** خروج از همهٔ دستگاه‌های دیگر؛ همین دستگاه می‌ماند */
router.post('/logout-all', requireAuth, (req, res) => {
  const n = revokeOtherSessions(req.user.id, req.user.sessionId);
  logEvent('info', 'panel', `کاربر «${req.user.username}» از ${n} دستگاهِ دیگر خارج شد`);
  audit(req, 'panel.logout_all', { target: req.user.username, detail: { revoked: n } });
  res.json({ ok: true, revoked: n });
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
