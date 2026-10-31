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
  hashPassword,
  issueUrlTicket,
  markFresh,
  freshUntil,
  requireRecentAuth,
} from '../auth.js';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { newSecret, verifyTotp, otpauthUrl, newRecoveryCodes, hashRecovery, useRecoveryCode } from '../lib/totp.js';
import { getSetting } from '../db.js';
import { db, logEvent } from '../db.js';
import {
  roleOf, listPanelUsers, ROLES, ROLE_ABILITIES, requireRole, isOwner,
  createPanelUser, updatePanelUser, resetPanelUserPassword, deletePanelUser,
} from '../control/roles.js';
import { audit } from '../lib/audit.js';
import { auditFromReq } from '../control/audit.js';
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
  res.json({
    ok: true,
    user: { id: user.id, username: user.username, role: user.role || 'admin' },
    //  رمزِ یک‌بارمصرفِ `vill3n owner-reset` ⇒ اول رمزِ تازه (سرور اجبار می‌کند)
    mustChangePassword: Boolean(user.must_change_password),
    ...session,
  });
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
    //  مالکِ اصلی (قدیمی‌ترین مدیرِ فعال) — رابط با این نشانش می‌دهد؛ مجوز در سرور است
    owner: isOwner(req.user.id),
    mustChangePassword: Boolean(req.user.mustChangePassword),
    //  تا کِی این نشست برای کارِ حساس تازه است (میلی‌ثانیه؛ صفر = نیست)
    freshUntil: freshUntil(req.user.sessionId),
    abilities: ROLE_ABILITIES[role] || [],
    sessions: listSessions(req.user.id),
  });
});

/* ---------------------- احرازِ دوباره (۶-۵) ------------------------
 *  رمز — و اگر دوعاملی روشن است، کدِ اپ هم. نشستِ همین درخواست ده دقیقه
 *  برای کارِ حساس تازه می‌شود. سقفِ نرخِ ورود (فقط ناموفق‌ها) رویش هست.
 */
router.post('/reauth', requireAuth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const okPass = Boolean(u) && verifyPassword(String(req.body?.password || ''), u.password_hash);
  const okCode = !u?.totp_enabled || verifyTotp(u.totp_secret, req.body?.code);
  if (!okPass || !okCode) {
    audit(req, 'panel.reauth', { target: req.user.username, ok: false, detail: { step: okPass ? 'totp' : 'password' } });
    //  ۴۰۰ نه ۴۰۱: نشست سالم است، فقط رمز غلط بود — رابط نباید بیرونش بیندازد
    return res.status(400).json({
      error: okPass ? 'totp_invalid' : 'wrong_password',
      totpRequired: Boolean(u?.totp_enabled),
    });
  }
  markFresh(req.user.sessionId);
  audit(req, 'panel.reauth', { target: req.user.username });
  res.json({ ok: true, freshUntil: freshUntil(req.user.sessionId) });
});

/* ---------------------- بلیتِ نشانی (۶-۶) ------------------------
 *  پیوندِ دانلود سرآیندِ Authorization ندارد؛ به‌جای توکنِ ۱۲ساعته در نشانی،
 *  یک بلیتِ ۶۰ثانیه‌ایِ یک‌بارمصرف که به همین نشست و همین مسیر بسته است.
 */
router.post('/ticket', requireAuth, (req, res) => {
  const t = issueUrlTicket(req.user, req.body?.path);
  if (!t) return res.status(400).json({ error: 'invalid_path' });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, ...t });
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

/*
 *  ⛔ دوعاملیِ روشن با یک نشست عوض نمی‌شود (۱۴۰۵/۰۸/۰۹): تا امروز `setup` و
 *  `enable` رازِ تازه را روی رازِ روشن می‌نشاندند — نشستِ دزدیده‌شده رازِ خودش
 *  را جا می‌زد و صاحبِ حساب دیگر نمی‌توانست وارد شود. حالا اول باید خاموش شود،
 *  و خاموش کردن رمز + کدِ فعلی می‌خواهد.
 */
/*
 *  ⛔ روشن کردن هم احرازِ دوباره می‌خواهد (۱۴۰۵/۰۸/۰۹): نشستِ دزدیده‌شده با
 *  اپِ خودش دوعاملی را روی حسابِ بی‌دوعاملیِ مالک روشن می‌کرد و صاحبِ سامانه
 *  دیگر وارد نمی‌شد. نشستی که همین حالا وارد شده تازه است؛ وگرنه یک بار رمز.
 */
router.post('/totp/setup', requireAuth, requireRecentAuth, async (req, res) => {
  const cur = db.prepare('SELECT totp_enabled FROM users WHERE id = ?').get(req.user.id);
  if (cur?.totp_enabled) return res.status(409).json({ error: 'totp_already_enabled' });
  const secret = newSecret();
  db.prepare('UPDATE users SET totp_pending = ? WHERE id = ?').run(secret, req.user.id);
  const issuer = String(getSetting('server_name', '') || 'VILL3N').slice(0, 40);
  const url = otpauthUrl({ issuer, account: req.user.username, secret });
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 220 });
  res.json({ secret, url, qr });
});

router.post('/totp/enable', requireAuth, requireRecentAuth, (req, res) => {
  const u = db.prepare('SELECT totp_pending, totp_enabled, username FROM users WHERE id = ?').get(req.user.id);
  if (u?.totp_enabled) return res.status(409).json({ error: 'totp_already_enabled' });
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

/* ---------------------- کاربرانِ پنل (فقط مدیر) ------------------------
 *  ⛔ همان قاعده‌های `/api/panel/v1/users` — هر دو از `control/roles.js`
 *  (۶-۲ / S17). نوشتن پشتِ احرازِ دوباره (۶-۵).
 */
function usersError(res, e) {
  if (e?.code && e?.status) return res.status(e.status).json({ error: e.code });
  throw e;
}

router.get('/users', requireAuth, requireRole('admin'), (req, res) => {
  res.json({ users: listPanelUsers(), roles: ROLES, abilities: ROLE_ABILITIES });
});

router.post('/users', requireAuth, requireRole('admin'), requireRecentAuth, (req, res) => {
  try {
    const user = createPanelUser(req, req.body || {}, createUser);
    logEvent('info', 'panel', `کاربر «${user.username}» با نقشِ ${user.role} ساخته شد`);
    res.status(201).json({ user });
  } catch (e) {
    usersError(res, e);
  }
});

router.patch('/users/:id', requireAuth, requireRole('admin'), requireRecentAuth, (req, res) => {
  try {
    const u = updatePanelUser(req, req.params.id, { role: req.body?.role, disabled: req.body?.disabled });
    logEvent('warn', 'panel', `کاربر «${u.username}»: نقش ${u.role}${u.disabled ? ' — حساب بسته است' : ''}`);
    res.json({ users: listPanelUsers() });
  } catch (e) {
    usersError(res, e);
  }
});

router.put('/users/:id/password', requireAuth, requireRole('admin'), requireRecentAuth, (req, res) => {
  try {
    resetPanelUserPassword(req, req.params.id, req.body?.password, hashPassword);
    res.json({ ok: true });
  } catch (e) {
    usersError(res, e);
  }
});

router.delete('/users/:id', requireAuth, requireRole('admin'), requireRecentAuth, (req, res) => {
  try {
    deletePanelUser(req, req.params.id);
    res.json({ ok: true, users: listPanelUsers() });
  } catch (e) {
    usersError(res, e);
  }
});

router.post('/change-password', requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ error: 'password_too_short' });
  }
  if (String(newPassword).length > 200) return res.status(400).json({ error: 'password_too_long' });
  const result = changePassword(req.user.id, String(oldPassword || ''), String(newPassword));
  auditFromReq(req, 'panel.password.change', { entity: 'user', entityId: req.user.username, result: result.ok ? 'ok' : result.error });
  if (!result.ok) return res.status(400).json(result);
  res.json({ ok: true });
});

// برای بررسی اعتبار توکن از سمت Socket.IO
export { verifyToken };
export default router;
