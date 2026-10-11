'use strict';
// ورود مالک: رمز با scrypt، نشست در کوکی HttpOnly، کد ۶ رقمی ایمیلی (اختیاری) و قفل ضد حدس‌زدن.
const crypto = require('crypto');
const { sha256, safeEqual, str } = require('./util');
const { HttpError } = require('./http');

const COOKIE = 'v3sid';
const IDLE_MS = 24 * 3600 * 1000;       // ۲۴ ساعت بدون فعالیت
const ABS_MS = 14 * 24 * 3600 * 1000;   // حداکثر ۱۴ روز
const OTP_MS = 5 * 60 * 1000;
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(typeof password === 'string' ? password : '', salt, 64, SCRYPT);
  return { salt: salt.toString('base64'), hash: hash.toString('base64'), n: SCRYPT.N };
}

function verifyPassword(password, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  if (typeof password !== 'string' || password.length > 400) password = '';
  try {
    const hash = crypto.scryptSync(password, Buffer.from(rec.salt, 'base64'), 64, Object.assign({}, SCRYPT, { N: rec.n || SCRYPT.N }));
    return crypto.timingSafeEqual(hash, Buffer.from(rec.hash, 'base64'));
  } catch (_) { return false; }
}

function checkPasswordRules(pw) {
  pw = typeof pw === 'string' ? pw : '';
  if (pw.length < 10) throw new HttpError(400, 'رمز باید دست‌کم ۱۰ نویسه باشد');
  if (pw.length > 200) throw new HttpError(400, 'رمز خیلی طولانی است');
  if (/^(.)\1+$/.test(pw) || /^(0123456789|1234567890|password.*|qwerty.*)$/i.test(pw)) throw new HttpError(400, 'این رمز خیلی ساده است');
}

class Auth {
  constructor(db, { dataDir }) {
    this.db = db;
    this.dataDir = dataDir;
    this.pending = new Map(); // ورودهای منتظر کد ایمیل
    this.setupCode = null;
    const t = setInterval(() => this.sweep(), 10 * 60 * 1000);
    if (t.unref) t.unref();
  }

  get owner() { return this.db.data.owner; }
  needsSetup() { return !this.owner || !this.owner.pass; }

  // کد راه‌اندازی اولیه: فقط کسی که به پوشهٔ سرور دسترسی دارد آن را می‌بیند
  ensureSetupCode() {
    if (!this.needsSetup()) return null;
    if (this.setupCode) return this.setupCode;
    const fs = require('fs'), path = require('path');
    const file = path.join(this.dataDir, 'SETUP-CODE.txt');
    let code = '';
    try { code = (fs.readFileSync(file, 'utf8').match(/\b[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}\b/) || [''])[0]; } catch (_) { /* هنوز ساخته نشده */ }
    if (!code) {
      const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const b = crypto.randomBytes(12);
      let s = '';
      for (let i = 0; i < 12; i++) s += A[b[i] % 32];
      code = `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
      fs.writeFileSync(file, `کد راه‌اندازی پنل ادمین VILL3N\n\n${code}\n\nاین کد فقط برای ساخت رمز مالک در اولین ورود است و بعد از آن پاک می‌شود.\n`, { mode: 0o600 });
    }
    this.setupCode = code;
    return code;
  }

  clearSetupCode() {
    this.setupCode = null;
    try { require('fs').unlinkSync(require('path').join(this.dataDir, 'SETUP-CODE.txt')); } catch (_) { /* نبود */ }
  }

  sweep() {
    const now = Date.now();
    const d = this.db.data;
    const before = d.sessions.length;
    d.sessions = d.sessions.filter((s) => now - s.lastAt < IDLE_MS && now - s.createdAt < ABS_MS);
    if (d.sessions.length !== before) this.db.save();
    for (const [k, p] of this.pending) if (p.exp < now) this.pending.delete(k);
  }

  createSession(ctx) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    const d = this.db.data;
    d.sessions.unshift({ id: sha256(token), createdAt: now, lastAt: now, ip: ctx.ip, ua: ctx.ua.slice(0, 160) });
    if (d.sessions.length > 8) d.sessions.length = 8;
    this.db.saveNow();
    ctx.setCookie(COOKIE, token, { maxAge: Math.floor(ABS_MS / 1000) });
  }

  session(ctx) {
    const token = ctx.cookies[COOKIE];
    if (!token || token.length > 100) return null;
    const idh = sha256(token);
    const now = Date.now();
    const s = this.db.data.sessions.find((x) => safeEqual(x.id, idh));
    if (!s) return null;
    if (now - s.lastAt > IDLE_MS || now - s.createdAt > ABS_MS) { this.dropSession(idh); return null; }
    if (now - s.lastAt > 60000) { s.lastAt = now; s.ip = ctx.ip; this.db.save(); }
    return s;
  }

  dropSession(idHash) {
    const d = this.db.data;
    const n = d.sessions.length;
    d.sessions = d.sessions.filter((x) => x.id !== idHash);
    if (d.sessions.length !== n) this.db.saveNow();
  }

  logout(ctx) {
    const token = ctx.cookies[COOKIE];
    if (token) this.dropSession(sha256(token));
    ctx.setCookie(COOKIE, '', { maxAge: 0 });
  }

  // هر درخواست تغییردهنده باید از خودِ پنل آمده باشد (ضد CSRF)
  guardWrite(ctx) {
    if (ctx.method === 'GET' || ctx.method === 'HEAD') return;
    if (ctx.req.headers['x-v3'] !== '1') throw new HttpError(403, 'درخواست نامعتبر است');
    const origin = ctx.req.headers.origin;
    if (origin) {
      let host = '';
      try { host = new URL(origin).host.toLowerCase(); } catch (_) { /* نامعتبر */ }
      if (host !== ctx.host) throw new HttpError(403, 'درخواست از نشانی دیگری آمده است');
    }
    const site = ctx.req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'درخواست از نشانی دیگری آمده است');
  }

  require(ctx) {
    this.guardWrite(ctx);
    const s = this.session(ctx);
    if (!s) throw new HttpError(401, 'ابتدا وارد شوید');
    return s;
  }

  /* ───── قفل ضد حدس‌زدن ─────
     ۱) هر نشانی (IPv6: هر شبکهٔ ‎/64) بعد از ۶ تلاش غلط، ۱۵ دقیقه قفل می‌شود.
     ۲) اگر در کل تلاش‌های غلط زیاد شود (حمله از نشانی‌های گوناگون)، هیچ‌کس قفل نمی‌شود؛
        به‌جایش همهٔ تلاش‌ها یکی‌یکی و با مکث بررسی می‌شوند. این‌طور حمله‌کننده نمی‌تواند مالک را پشت در نگه دارد
        و حدس‌زدن رمز هم عملاً ناممکن می‌ماند (کمتر از یک تلاش در ثانیه). */
  throttle(ctx, scope = 'login') {
    const L = ctx.app.limiter;
    const key = `${scope}:ip:${ctx.ipKey}`;
    // تلاش‌هایی که هنوز در صف‌اند هم شمرده می‌شوند؛ وگرنه ده‌ها درخواستِ هم‌زمان از یک نشانی همه از قفل رد می‌شدند
    const e = L.m.get(key);
    const used = (e && e.reset > Date.now() ? e.n : 0) + this.inflight(key);
    if (ctx.ipKnown && (used >= 6 || this.inflight(key) >= 2)) {
      const retry = Math.max(L.retry(`${scope}:ip:${ctx.ipKey}`), 30);
      throw new HttpError(429, `تلاش‌های ناموفق زیاد بود. ${Math.ceil(retry / 60)} دقیقهٔ دیگر دوباره امتحان کنید.`, { retry });
    }
  }
  inflight(key) { return (this._pending && this._pending.get(key)) || 0; }
  hold(ctx, scope = 'login') {
    if (!ctx.ipKnown) return () => {};
    const key = `${scope}:ip:${ctx.ipKey}`;
    this._pending = this._pending || new Map();
    this._pending.set(key, this.inflight(key) + 1);
    let done = false;
    return () => { if (done) return; done = true; const n = this.inflight(key) - 1; if (n > 0) this._pending.set(key, n); else this._pending.delete(key); };
  }
  fail(ctx, scope = 'login') {
    const L = ctx.app.limiter;
    if (ctx.ipKnown) L.hit(`${scope}:ip:${ctx.ipKey}`, 6, 15 * 60 * 1000);
    L.hit('guess:all', 1e9, 15 * 60 * 1000);
  }
  // مکثِ نوبتی هنگام حمله (یا وقتی نشانی بازدیدکننده در دست نیست)
  slow(ctx) {
    const L = ctx.app.limiter;
    const e = L.m.get('guess:all');
    const fails = e && e.reset > Date.now() ? e.n : 0;
    if (fails < (ctx.ipKnown ? 20 : 5)) return Promise.resolve();
    if (this._queue > 40) throw new HttpError(429, 'سرور زیر تلاش‌های ورودِ زیاد است. یک دقیقهٔ دیگر دوباره امتحان کنید.', { retry: 60 });
    this._queue = (this._queue || 0) + 1;
    const run = (this._chain || Promise.resolve()).then(() => new Promise((r) => setTimeout(r, 1100 + Math.random() * 400)));
    this._chain = run.catch(() => {});
    return run.finally(() => { this._queue--; });
  }

  /* ───── راه‌اندازی اولیه ───── */
  setup(ctx, { username, password, email, code }) {
    if (!this.needsSetup()) throw new HttpError(409, 'پنل قبلاً راه‌اندازی شده است');
    this.throttle(ctx, 'setup');
    const expected = this.ensureSetupCode();
    if (!safeEqual(str(code, 40).toUpperCase(), expected)) {
      this.fail(ctx, 'setup');
      throw new HttpError(403, 'کد راه‌اندازی درست نیست. کد داخل فایل data/SETUP-CODE.txt روی سرور است.');
    }
    username = str(username, 32).toLowerCase() || 'owner';
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new HttpError(400, 'نام کاربری فقط حروف انگلیسی کوچک، عدد، نقطه و خط تیره (۳ تا ۳۲ نویسه)');
    checkPasswordRules(password);
    email = str(email, 120);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'ایمیل درست نیست');
    this.db.data.owner = { username, email, pass: hashPassword(password), emailCode: { enabled: false, url: '', headers: '', body: '{"to":"{{email}}","code":"{{code}}"}' }, createdAt: new Date().toISOString() };
    this.db.data.sessions = [];
    this.clearSetupCode();
    this.db.audit('setup', `مالک «${username}» ساخته شد`, ctx.ip);
    this.createSession(ctx);
  }

  /* ───── ورود ───── */
  async login(ctx, { username, password }) {
    if (this.needsSetup()) throw new HttpError(409, 'پنل هنوز راه‌اندازی نشده است');
    this.throttle(ctx);
    const release = this.hold(ctx);
    let userOk = false, passOk = false;
    const o = this.owner;
    try {
      await this.slow(ctx);
      userOk = safeEqual(str(username, 64).toLowerCase(), o.username);
      passOk = verifyPassword(password, o.pass); // همیشه محاسبه می‌شود تا زمان پاسخ یکسان بماند
      if (!userOk || !passOk) this.fail(ctx);
    } finally { release(); }
    if (!userOk || !passOk) {
      this.db.audit('login-fail', 'نام کاربری یا رمز نادرست', ctx.ip);
      throw new HttpError(401, 'نام کاربری یا رمز درست نیست');
    }
    if (o.emailCode && o.emailCode.enabled) {
      const ticket = await this.startOtp(ctx, 'login');
      return { step: 'code', ticket, hint: maskEmail(o.email) };
    }
    ctx.app.limiter.clear(`login:ip:${ctx.ipKey}`);
    this.createSession(ctx);
    this.db.audit('login', 'ورود موفق', ctx.ip);
    return { step: 'done' };
  }

  async startOtp(ctx, purpose) {
    const o = this.owner;
    if (!ctx.app.limiter.hit(`otp-send:${ctx.ipKey}`, 3, 10 * 60 * 1000) || !ctx.app.limiter.hit('otp-send:all', 12, 10 * 60 * 1000)) {
      throw new HttpError(429, 'کد زیاد درخواست شده است. چند دقیقه صبر کنید.');
    }
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const ticket = crypto.randomBytes(24).toString('base64url');
    const salt = crypto.randomBytes(8).toString('hex');
    // کد قبلیِ همین هدف باطل می‌شود
    for (const [k, p] of this.pending) if (p.purpose === purpose) this.pending.delete(k);
    this.pending.set(sha256(ticket), { purpose, salt, hash: sha256(salt + code), exp: Date.now() + OTP_MS, tries: 0, ip: ctx.ip });
    await sendEmailCode(o.emailCode, o.email, code);
    return ticket;
  }

  // برای کارهای داخل پنل (مالک وارد شده است): خطای کد، 403 می‌شود تا با «نشست تمام شد» اشتباه نشود
  verifyOtpInside(ctx, ticket, code, purpose) {
    try { return this.verifyOtp(ctx, ticket, code, purpose); } catch (e) { if (e instanceof HttpError && e.status === 401) e.status = 403; throw e; }
  }

  verifyOtp(ctx, ticket, code, purpose) {
    this.throttle(ctx, 'otp');
    const key = sha256(str(ticket, 100));
    const p = this.pending.get(key);
    if (!p || p.purpose !== purpose || p.exp < Date.now()) {
      this.pending.delete(key);
      throw new HttpError(401, 'کد منقضی شده است. دوباره وارد شوید.');
    }
    p.tries++;
    if (p.tries > 5) { this.pending.delete(key); throw new HttpError(401, 'تلاش زیاد بود. دوباره وارد شوید.'); }
    const given = require('./util').toLatinDigits(str(code, 20)).replace(/\D/g, '');
    if (given.length !== 6 || !safeEqual(sha256(p.salt + given), p.hash)) {
      this.fail(ctx, 'otp');
      throw new HttpError(401, 'کد درست نیست');
    }
    this.pending.delete(key); // یک‌بارمصرف
    return true;
  }

  completeLogin(ctx, ticket, code) {
    this.verifyOtp(ctx, ticket, code, 'login');
    ctx.app.limiter.clear(`login:ip:${ctx.ipKey}`);
    this.createSession(ctx);
    this.db.audit('login', 'ورود موفق با کد ایمیل', ctx.ip);
  }

  changePassword(ctx, session, { current, next }) {
    this.throttle(ctx, 'pw');
    // 403 (نه 401): مالک وارد شده است؛ فقط رمزِ تأیید غلط بوده
    if (!verifyPassword(current, this.owner.pass)) { this.fail(ctx, 'pw'); throw new HttpError(403, 'رمز فعلی درست نیست'); }
    checkPasswordRules(next);
    this.owner.pass = hashPassword(next);
    // همهٔ نشست‌های دیگر بسته می‌شوند
    this.db.data.sessions = this.db.data.sessions.filter((s) => s.id === session.id);
    this.db.saveNow();
    this.db.audit('password', 'رمز مالک عوض شد', ctx.ip);
  }
}

function maskEmail(e) {
  const m = /^(.)(.*)(@.*)$/.exec(String(e || ''));
  return m ? `${m[1]}${'•'.repeat(Math.min(6, m[2].length))}${m[3]}` : '';
}

// فرستادن کد از راه سرویس ایمیلِ خودِ مالک (یک درخواست HTTP قابل تنظیم)
async function sendEmailCode(cfg, email, code) {
  if (!cfg || !cfg.url) throw new HttpError(400, 'نشانی سرویس ایمیل تنظیم نشده است');
  if (!email) throw new HttpError(400, 'ایمیل مالک تنظیم نشده است');
  let url;
  try { url = new URL(cfg.url); } catch (_) { throw new HttpError(400, 'نشانی سرویس ایمیل درست نیست'); }
  if (!/^https?:$/.test(url.protocol)) throw new HttpError(400, 'نشانی سرویس ایمیل باید http یا https باشد');
  const fill = (s) => String(s || '').replace(/\{\{\s*email\s*\}\}/g, email).replace(/\{\{\s*code\s*\}\}/g, code);
  const headers = { 'Content-Type': 'application/json' };
  for (const line of String(cfg.headers || '').split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12000);
  try {
    const res = await fetch(url, { method: 'POST', headers, body: fill(cfg.body || '{"to":"{{email}}","code":"{{code}}"}'), signal: ac.signal, redirect: 'error' });
    if (!res.ok) throw new HttpError(502, `سرویس ایمیل خطا داد (کد ${res.status})`);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, 'به سرویس ایمیل وصل نشد. نشانی و روشن‌بودن سرویس را بررسی کنید.');
  } finally { clearTimeout(timer); }
}

module.exports = { Auth, hashPassword, verifyPassword, checkPasswordRules, maskEmail, COOKIE };
