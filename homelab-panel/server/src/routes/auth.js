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
  verifyReauth,
  recoveryExpired,
  consumeTotp,
  consumeRecoveryCode,
} from '../auth.js';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { newSecret, matchTotpStep, otpauthUrl, newRecoveryCodes, hashRecovery } from '../lib/totp.js';
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
import { deploy } from '../config.js';
import { deploySummary, viaProxy } from '../deploy.js';
import { shellOwnerOnly } from '../lib/shell-owner.js';
import { isDirectLocal, checkSetupCode, hasSetupCode, issueSetupCode, clearSetupCode } from '../lib/setup-code.js';

/*
 *  ⛔ «پنلِ عمومی» (HLP_PANEL_PUBLIC=1، پشتِ Caddy با TLS — src/deploy.js).
 *
 *  رمز به‌تنهایی برای پنلی که از اینترنت دیده می‌شود کافی نیست. پس از راهِ
 *  پراکسی (هر درخواستی که X-Forwarded-For دارد) فقط کسی وارد می‌شود که کدِ
 *  دومرحله‌ای (TOTP) را روشن کرده، و «ساختنِ نخستین مدیر» اصلاً از آن راه نیست.
 *  راهِ خصوصی (تونلِ SSH یا Tailscale، مستقیم به پورتِ پنل) همیشه باز می‌ماند —
 *  صاحب سامانه هرگز بیرون نمی‌ماند و TOTP را همان‌جا روشن می‌کند.
 */
function publicPath(req) {
  return deploy.panel.public && viaProxy(req);
}

const router = Router();

// آیا پنل هنوز راه‌اندازی نشده؟ (ساخت اولین حساب مدیر)
//  `setupCode`: آیا ساختن **از همین دستگاه** کدِ یک‌بارِ کنسول را می‌خواهد (۱.۵۰.۸۵) — هرگز خودِ کد
router.get('/status', (req, res) => {
  const initialized = isInitialized();
  res.json({ initialized, setupCode: !initialized && !isDirectLocal(req) });
});

const SETUP_CODE_MESSAGE =
  'نخستین مدیر از دستگاهی جز خودِ سرور فقط با «کدِ یک‌بارِ راه‌اندازی» ساخته می‌شود — همان که سرور هنگامِ بالا آمدن در کنسول/لاگِ خودش چاپ کرده (برنامهٔ ویندوز: ترمینالِ پایینِ برنامه؛ لینوکس: ./service-linux.sh setup-code؛ داکر: docker compose logs panel). یا پنل را روی خودِ همان کامپیوتر باز کنید.';

router.post('/setup', (req, res) => {
  if (isInitialized()) return res.status(409).json({ error: 'already_initialized' });
  if (publicPath(req)) {
    audit(req, 'panel.setup', { ok: false, detail: { reason: 'public_path' } });
    return res.status(403).json({
      error: 'setup_private_only',
      message: 'نخستین مدیر از راهِ عمومی ساخته نمی‌شود — HLP_ADMIN_USER/HLP_ADMIN_PASSWORD را در محیط بگذارید یا از تونلِ SSH/Tailscale وارد شوید.',
    });
  }
  /*
   *  ⛔ (۱.۵۰.۸۵) تا امروز هر همتای شبکهٔ خانه که زودتر می‌رسید مالک می‌شد. حالا از همین
   *  کامپیوتر (لوپ‌بک، بی پراکسی، Host/Origin ِ لوپ‌بک) مثلِ پیش؛ از هر جای دیگر فقط با کدِ
   *  یک‌باری که فقط در کنسولِ خودِ سرور چاپ شده (`lib/setup-code.js`). کد پیش از سنجشِ نام/رمز
   *  سنجیده می‌شود ولی تنها با ساختِ مدیر مصرف می‌شود.
   */
  const local = isDirectLocal(req);
  if (!local) {
    //  کدی نیست ولی مدیری هم نیست (مثلاً کاربران پس از بالا آمدن خالی شدند) ⇒ کدِ تازه در کنسول؛ مالک بیرون نمی‌ماند
    if (!hasSetupCode()) issueSetupCode();
    const r = checkSetupCode(req.body?.setupCode);
    if (!r.ok) {
      const error = r.reason === 'missing' ? 'setup_code_required' : 'setup_code_invalid';
      audit(req, 'panel.setup', { ok: false, detail: { reason: error, ...(r.rotated ? { rotated: true } : {}) } });
      return res.status(403).json({ error, message: SETUP_CODE_MESSAGE });
    }
  }
  const { username, password } = req.body || {};
  if (!username || String(username).trim().length < 3) {
    return res.status(400).json({ error: 'username_too_short' });
  }
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: 'password_too_short' });
  }
  const user = createUser(String(username).trim(), String(password));
  clearSetupCode();
  const session = createSession(user, req);
  audit(req, 'panel.setup', { target: user.username, detail: { via: local ? 'this_computer' : 'setup_code' } });
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
  //  ⛔ رمزِ یک‌بارمصرفِ بازیابی پس از مهلتش در نیست (۱.۵۰.۷۱، مهاجرتِ ۰۰۸) — دوباره `vill3n owner-reset`
  if (recoveryExpired(user)) {
    audit(req, 'panel.login', { target: user.username, ok: false, detail: { step: 'recovery_expired' } });
    logEvent('warn', 'panel', `رمزِ یک‌بارمصرفِ بازیابیِ «${user.username}» منقضی بود — ورود رد شد`);
    return res.status(401).json({
      error: 'recovery_expired',
      message: 'رمزِ یک‌بارمصرفِ بازیابی منقضی شده است؛ روی خودِ سرور دوباره «vill3n owner-reset» بزنید.',
    });
  }
  /*
   *  ورودِ دوعاملی: رمز درست بود ولی نشست هنوز ساخته نمی‌شود. یک بلیتِ
   *  پنج‌دقیقه‌ای برمی‌گردد و کاربر باید کدِ اپِ Authenticator (یا یک کدِ
   *  بازیابی) را بدهد. بلیت با `typ: 'totp'` مهر می‌خورد و `verifyToken`
   *  آن را نشست نمی‌شمارد.
   */
  if (!user.totp_enabled && publicPath(req)) {
    audit(req, 'panel.login', { target: user.username, ok: false, detail: { step: 'totp_required_public' } });
    return res.status(403).json({
      error: 'totp_required_public',
      message: 'پنل از اینترنت فقط با کدِ دومرحله‌ای باز می‌شود. یک بار از تونلِ SSH یا Tailscale وارد شوید و ورودِ دومرحله‌ای را روشن کنید.',
    });
  }
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
  //  `owner-reset --keep-2fa`: مهلتِ رمزِ یک‌بارمصرف در گامِ دوم هم (۱.۵۰.۷۱)
  if (recoveryExpired(user)) return res.status(401).json({ error: 'recovery_expired' });

  //  ⛔ S13: هر کد یک بار — همان کد (یا کدِ گامِ کهنه‌تر) با بلیتِ تازه یا از درِ دیگر دوباره نمی‌گذرد
  const t = consumeTotp(user.id, code);
  if (t.ok) return finishLogin(req, res, user);

  // کدِ بازیابی — یک‌بارمصرف
  const recovery = consumeRecoveryCode(user.id, code);
  if (recovery.ok) {
    logEvent('warn', 'panel', `کاربر «${user.username}» با کدِ بازیابی وارد شد (${recovery.remaining} کد مانده)`);
    audit(req, 'panel.totp.recovery_used', { target: user.username, detail: { remaining: recovery.remaining } });
    return finishLogin(req, res, user);
  }
  logEvent('warn', 'panel', t.reused
    ? `کدِ دوعاملیِ ازپیش‌مصرف‌شده برای «${user.username}» (بازپخش؟)`
    : `کدِ دوعاملیِ غلط برای «${user.username}»`);
  audit(req, 'panel.login', { target: user.username, ok: false, detail: { step: 'totp', ...(t.reused ? { reused: true } : {}) } });
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
    //  S19: `HLP_SHELL_OWNER_ONLY=1` ⇒ ترمینال/فرمانِ اجرا/ریشه‌ها فقط مالک — رابط با این پیامِ درست نشان می‌دهد؛ مجوز در سرور است
    shellOwnerOnly: shellOwnerOnly(),
    sessions: listSessions(req.user.id),
    //  کدام بخش‌ها روی این میزبان هستند (src/deploy.js) — رابط همان‌ها را نشان می‌دهد
    deploy: deploySummary(deploy),
  });
});

/* ---------------------- احرازِ دوباره (۶-۵) ------------------------
 *  رمز — و اگر دوعاملی روشن است، کدِ اپ هم. نشستِ همین درخواست ده دقیقه
 *  برای کارِ حساس تازه می‌شود. سقفِ نرخِ ورود (فقط ناموفق‌ها) رویش هست.
 */
router.post('/reauth', requireAuth, (req, res) => {
  //  همان یک قاعده‌ای که درهای کنسول هم صدا می‌زنند (`verifyReauth`، auth.js)
  const r = verifyReauth(req.user.id, String(req.body?.password || ''), req.body?.code);
  if (!r.ok) {
    const okPass = r.error !== 'wrong_password';
    audit(req, 'panel.reauth', { target: req.user.username, ok: false, detail: { step: okPass ? 'totp' : 'password', ...(r.reused ? { reused: true } : {}) } });
    //  ۴۰۰ نه ۴۰۱: نشست سالم است، فقط رمز غلط بود — رابط نباید بیرونش بیندازد
    return res.status(400).json({
      error: okPass ? 'totp_invalid' : 'wrong_password',
      totpRequired: Boolean(r.totpRequired),
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
  //  ⛔ S13: گامِ همین کد از همین حالا «مصرف‌شده» است — کدی که دوعاملی را روشن کرد ورود نمی‌دهد
  const step = matchTotpStep(u.totp_pending, req.body?.code);
  if (step < 0) return res.status(400).json({ error: 'totp_invalid' });
  const codes = newRecoveryCodes();
  const won = db.prepare('UPDATE users SET totp_secret = ?, totp_pending = NULL, totp_enabled = 1, totp_recovery = ?, totp_last_step = ? WHERE id = ? AND totp_enabled = 0 AND totp_pending = ?')
    .run(u.totp_pending, JSON.stringify(codes.map(hashRecovery)), step, req.user.id, u.totp_pending);
  if (Number(won.changes) !== 1) return res.status(409).json({ error: 'totp_already_enabled' });
  logEvent('info', 'panel', `ورودِ دوعاملی برای «${u.username}» روشن شد`);
  audit(req, 'panel.totp.enable', { target: u.username });
  res.json({ ok: true, recoveryCodes: codes });
});

router.post('/totp/disable', requireAuth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!u?.totp_enabled) return res.status(400).json({ error: 'totp_not_enabled' });
  // خاموش کردن هم رمز می‌خواهد هم کد — وگرنه نشستِ دزدیده‌شده خودش قفل را برمی‌داشت
  if (!verifyPassword(String(req.body?.password || ''), u.password_hash)) return res.status(400).json({ error: 'wrong_password' });
  if (!consumeTotp(u.id, req.body?.code).ok) return res.status(400).json({ error: 'totp_invalid' });
  //  رازِ بعدی گام‌های خودش را دارد؛ «آخرین گام» ِ این راز با خودش می‌رود
  db.prepare('UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled = 0, totp_recovery = NULL, totp_last_step = NULL WHERE id = ?').run(u.id);
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
