// ---------------------------------------------------------------------------
//  ناظرِ سرورِ حساب — پنل خودش shop/server را بالا می‌آورد
//
//  گزارشِ صاحب ریپو با عکس (۱۴۰۵/۰۷/۰۲): «سرورِ حساب روی سرورِ خانگی روشن
//  نیست… docker compose up -d» — روی برنامهٔ پمپ، برنامهٔ دکان و اپِ مدیریت،
//  همه یک جمله. کامپیوترِ خانگی ویندوز است: نه داکر دارد نه PostgreSQL، و
//  «docker compose» راهِ درستی برای صاحبِ یک پمپ نبود.
//
//  پس همان کاری که برای دستیارِ پشتیبانی می‌کنیم (ai/supervisor.js): سرورِ
//  حساب یک پروسهٔ فرزند است که با پنل بالا می‌آید، اگر افتاد برمی‌گردد، و
//  دیتابیسش PGlite است — PostgreSQL داخلِ همان Node، با پوشه‌ای در پوشهٔ داده.
//  هیچ نصبی لازم نیست؛ تونل ⇒ درگاه ⇒ همین پروسه.
//
//  ⛔ رازها (API_SECRET، OTP_SECRET، JWT_SECRET) و نام و رمزِ مدیر یک بار
//  ساخته می‌شوند و در <dataDir>/account-server/secrets.json می‌نشینند (۰۶۰۰).
//  همان مدیر برای ورودِ خودکارِ پلِ «پمپ‌ها» (stations/cloud.js) به کار می‌رود،
//  پس هیچ چیزی دستی تنظیم نمی‌شود. اگر صاحب سرور HLP_ACCOUNT_ADMIN_USER/PASSWORD
//  را خودش داده باشد، همان‌ها جلوترند.
//
//  ⚠️ این ماژول عمداً هیچ‌چیزی از shop/server را import نمی‌کند: پروسهٔ جدا،
//  پورتِ خودش روی 127.0.0.1، و تنها راهِ رسیدنِ بیرون همان درگاه است.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, SERVER_ROOT } from '../config.js';
import { logEvent } from '../db.js';
import { accountApiUrl, setDownHint } from '../api/account-proxy.js';
import { codeSettings } from '../codes/settings.js';
import { mailReady } from '../codes/mail.js';

const RING = 200;
const ring = [];

let child = null;
let startedAt = 0;
let restarts = 0;
let stopping = false;
let backoffTimer = null;
let lastError = '';

/**
 * پوشهٔ کدِ سرورِ حساب.
 * ترتیب: تنظیمِ صریح (HLP_ACCOUNT_DIR) → کنارِ پنل (بستهٔ ویندوز:
 * resources/account-server، یا homelab-panel/account-server در نصبِ گیت) →
 * داخلِ پوشهٔ داده (نصبِ دستی).
 *
 * ⚠️ ریپوی خواهرِ shop کنارِ این ریپو عمداً **خودکار** پیدا نمی‌شود: پنجاه
 * آزمونِ این ریپو خودِ پنل را بالا می‌آورند و روی ماشینی که shop کنارش است
 * هر کدام یک سرورِ حسابِ واقعی روشن می‌کردند (stations.mjs همین را گرفت).
 * روی لینوکس یا HLP_ACCOUNT_DIR بدهید یا یک symlink به نامِ account-server.
 */
export function resolveAccountDir() {
  const candidates = [
    config.accountApi?.dir,
    path.resolve(SERVER_ROOT, '..', 'account-server'),
    path.resolve(SERVER_ROOT, '..', '..', 'account-server'),
    path.join(config.dataDir, 'account-server', 'app'),
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'src', 'index.js')) && fs.existsSync(path.join(dir, 'node_modules'))) return dir;
    } catch { /* بعدی */ }
  }
  return null;
}

/** پوشهٔ دادهٔ سرورِ حساب — داخلِ پوشهٔ دادهٔ پنل، تا با آن جابه‌جا شود. */
export function accountDataDir() {
  return path.join(config.dataDir, 'account-server');
}

function push(level, text) {
  const line = `${new Date().toISOString()}\t${level}\t${text}`;
  ring.push(line);
  if (ring.length > RING) ring.shift();
  if (level === 'error' || level === 'warn') console.error(`  [سرورِ حساب] ${text}`);
}

function announce(text) {
  console.log(`  🪪 ${text}`);
  push('info', text);
}

const genSecret = () => crypto.randomBytes(32).toString('base64url');
/** رمزی که قاعدهٔ خودِ سرورِ حساب را بگذراند (دستِ‌کم ۸، نه همه‌رقم). */
const genPassword = () => `P${crypto.randomBytes(18).toString('base64url')}`;

/**
 * رازهای پایدارِ سرورِ حساب — یک بار ساخته، همیشه همان.
 *
 * ⚠️ عوض شدنِ API_SECRET یعنی همهٔ نشست‌های همهٔ برنامه‌ها بی‌اعتبار، پس
 * فایل هیچ‌وقت بازنویسی نمی‌شود؛ فقط کلیدِ نبوده اضافه می‌شود.
 */
export function ensureSecrets() {
  const dir = accountDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'secrets.json');
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { cur = {}; }
  const next = {
    apiSecret: cur.apiSecret || genSecret(),
    otpSecret: cur.otpSecret || genSecret(),
    jwtSecret: cur.jwtSecret || genSecret(),
    adminUser: cur.adminUser || 'admin',
    adminPassword: cur.adminPassword || genPassword(),
  };
  if (JSON.stringify(next) !== JSON.stringify(cur)) {
    fs.writeFileSync(file, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
  }
  return next;
}

/**
 * نام و رمزِ مدیرِ سرورِ حساب که پل باید با آن وارد شود.
 * تنظیمِ صریحِ صاحب سرور جلوتر است؛ وگرنه همانی که خودِ ناظر ساخته —
 * فقط وقتی ناظر روشن است (وگرنه سرورِ بیرونی مدیرِ خودش را دارد).
 */
export function managedAdminCreds() {
  const { adminUser, adminPassword, autostart, enabled } = config.accountApi || {};
  if (adminUser && adminPassword) return { username: adminUser, password: adminPassword };
  //  مدیرِ خودساخته فقط وقتی معنا دارد که خودِ ناظر سرورِ حساب را بالا می‌آورد:
  //  بی کدِ نصب‌شده، «وصل‌ایم» گفتن دروغ است (stations.mjs همین را گرفت).
  if (!enabled || !autostart || !resolveAccountDir()) return null;
  const s = ensureSecrets();
  return { username: s.adminUser, password: s.adminPassword };
}

/**
 * SMTPِ رباتِ ایمیلِ خودِ پنل، به شکلی که سرورِ حساب می‌فهمد.
 *
 * ⛔ چرا لازم شد (۱۴۰۵/۰۷/۰۲): ثبت‌نامِ هر سه برنامه با کدِ ایمیل است و
 * سرورِ حسابِ خودساخته هیچ ایمیلی نداشت — `register/start` همان‌جا
 * `delivery_failed` می‌داد («سرویس ایمیل سرور تنظیم نیست») و صاحبِ سامانه
 * باید یک بارِ دیگر، این بار در پنلِ مدیریتِ سرورِ حساب، همان SMTPی را
 * می‌نوشت که در «کدهای شش‌رقمی»ِ همین پنل نوشته بود. یک سرور، یک ایمیل:
 * همان تنظیمات به فرزند می‌رود.
 *
 * ⚠️ فقط پیش‌فرض است: آن‌چه در پنلِ مدیریتِ سرورِ حساب ذخیره شود (دیتابیسِ
 * خودش) جلوتر است — سرورِ حساب مقدارِ ذخیره‌شده را به محیط ترجیح می‌دهد.
 * ⚠️ رمزِ SMTP فقط در محیطِ همان پروسهٔ فرزند است؛ روی هیچ مسیری برنمی‌گردد.
 */
export function mailEnvForChild() {
  let s;
  try { s = codeSettings(); } catch { return {}; }
  if (!mailReady(s)) return {};
  const e = s.email || {};
  const port = Number(e.port) || (e.secure ? 465 : 587);
  return {
    SMTP_HOST: String(e.host),
    SMTP_PORT: String(port),
    SMTP_USER: String(e.username || ''),
    SMTP_PASS: String(e.password || ''),
    //  ssl = از همان اول TLS (۴۶۵) | starttls = ساده شروع و بعد رمز (۵۸۷)
    SMTP_SECURE: e.secure || port === 465 ? 'ssl' : 'starttls',
    EMAIL_FROM: String(e.from),
    EMAIL_FROM_NAME: String(e.fromName || ''),
  };
}

/** متغیرهای محیطیِ پروسهٔ فرزند — عمداً محدود؛ هیچ رازِ پنل رد نمی‌شود. */
export function accountChildEnv(dir = resolveAccountDir()) {
  const s = ensureSecrets();
  const url = accountApiUrl();
  const port = url?.port ? Number(url.port) : 3000;
  const data = accountDataDir();
  const creds = managedAdminCreds() || { username: s.adminUser, password: s.adminPassword };
  return {
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    //  دیتابیس داخلِ همان فرآیند — پوشه‌ای در پوشهٔ دادهٔ پنل
    DATABASE_URL: `pglite:${path.join(data, 'pg')}`,
    BACKUP_PATH: path.join(data, 'backups'),
    API_SECRET: s.apiSecret,
    OTP_SECRET: s.otpSecret,
    JWT_SECRET: s.jwtSecret,
    //  IPِ واقعی از درگاهِ همین پنل می‌آید (X-Forwarded-For)
    TRUST_PROXY: 'true',
    //  HTTPS کارِ تونل است
    DOMAIN: '',
    ADMIN_BOOTSTRAP_USER: creds.username,
    ADMIN_BOOTSTRAP_PASSWORD: creds.password,
    //  ایمیلِ کدهای ثبت‌نام — همان رباتِ ایمیلِ پنل، اگر تنظیم شده باشد
    ...mailEnvForChild(),
    //  .envِ خودِ پوشهٔ کد خوانده نشود — همه‌چیز از همین‌جا می‌آید
    ENV_FILE: path.join(data, 'env.none'),
    ...(dir ? {} : {}),
  };
}

/**
 * تنظیماتِ ایمیلِ پنل عوض شد ⇒ فرزند با محیطِ تازه دوباره بالا می‌آید.
 * فقط اگر خودِ ناظر روشنش کرده باشد؛ سرورِ بیرونی به ما ربطی ندارد.
 */
export function onPanelMailChanged() {
  if (!child) return { ok: false, reason: 'روشن نبود' };
  push('info', 'تنظیماتِ ایمیلِ پنل عوض شد — سرورِ حساب با همان دوباره بالا می‌آید');
  restartAccountServer().catch(() => {});
  return { ok: true };
}

export function accountLogs(limit = 100) {
  return ring.slice(-Math.max(1, Math.min(RING, limit)));
}

export function accountStatus() {
  const dir = resolveAccountDir();
  const url = accountApiUrl();
  return {
    enabled: !!config.accountApi?.autostart && !!config.accountApi?.enabled,
    installed: !!dir,
    dir: dir || null,
    dataDir: accountDataDir(),
    running: !!child && !child.killed,
    pid: child?.pid || null,
    port: url?.port ? Number(url.port) : null,
    startedAt: startedAt || null,
    uptimeMs: startedAt ? Date.now() - startedAt : 0,
    restarts,
    lastError: lastError || null,
    driver: 'pglite',
    //  مدیرِ سرورِ حساب — همانی که اپِ مدیریت و /admin/ با آن وارد می‌شوند.
    //  ⚠️ فقط از این مسیر (پورتِ پنل، پشتِ ورودِ مدیر) دیده می‌شود. تا پیش
    //  از این نام و رمزِ خودساخته فقط در secrets.json بود و صاحبِ سامانه
    //  هیچ راهی نداشت با اپِ مدیریت وارد سرورِ حسابِ خودش شود.
    admin: adminInfo(),
    //  کدهای ثبت‌نام از رباتِ ایمیلِ پنل می‌روند؟
    mail: Object.keys(mailEnvForChild()).length > 0,
  };
}

/** نام و رمزِ مدیرِ سرورِ حساب، و این‌که از کجا آمده — یا null اگر ناظر خاموش است. */
function adminInfo() {
  const creds = managedAdminCreds();
  if (!creds) return null;
  const explicit = !!(config.accountApi?.adminUser && config.accountApi?.adminPassword);
  return { username: creds.username, password: creds.password, source: explicit ? 'env' : 'managed' };
}

export function startAccountServer() {
  if (child) return { ok: true, reason: 'از قبل در حال اجراست' };
  if (!config.accountApi?.enabled) return { ok: false, reason: 'درگاهِ سرورِ حساب خاموش است (HLP_ACCOUNT_API=0)' };
  if (!config.accountApi?.autostart) return { ok: false, reason: 'راه‌اندازیِ خودکار خاموش است (HLP_ACCOUNT_AUTOSTART=0)' };
  const url = accountApiUrl();
  if (!url || !/^(127\.0\.0\.1|localhost|\[::1\])$/.test(url.hostname)) {
    return { ok: false, reason: 'HLP_ACCOUNT_API به سرورِ دیگری اشاره می‌کند؛ پنل فقط سرورِ محلی را بالا می‌آورد' };
  }

  const dir = resolveAccountDir();
  if (!dir) {
    lastError = 'پوشهٔ سرورِ حساب پیدا نشد';
    push('warn', `${lastError} — کنارِ پنل باید پوشهٔ account-server (یا ریپوی shop/server با node_modules) باشد.`);
    return { ok: false, reason: lastError };
  }

  stopping = false;
  const entry = path.join(dir, 'src', 'index.js');
  const env = { ...process.env, ...accountChildEnv(dir) };
  //  رازهای خودِ پنل به فرزند نروند
  for (const k of Object.keys(env)) if (/^HLP_/.test(k)) delete env[k];

  try {
    child = spawn(process.execPath, [entry], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  } catch (e) {
    lastError = e.message;
    child = null;
    push('error', `اجرا نشد: ${e.message}`);
    return { ok: false, reason: e.message };
  }

  startedAt = Date.now();
  lastError = '';
  announce(`سرورِ حساب روشن شد (پورت ${env.PORT}، دیتابیس PGlite در ${accountDataDir()}) — از api.<دامنه> رد می‌شود`);
  logEvent('info', 'account', `سرورِ حساب روشن شد روی پورت ${env.PORT}`);

  const wire = (stream, level) => {
    stream.setEncoding('utf8');
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || '';
      for (const l of lines) if (l.trim()) push(level, l.trim());
    });
  };
  wire(child.stdout, 'info');
  wire(child.stderr, 'error');

  child.on('exit', (code, signal) => {
    const was = child;
    child = null;
    startedAt = 0;
    if (stopping) { push('info', 'سرورِ حساب خاموش شد'); return; }
    lastError = `پروسه بسته شد (کد ${code ?? signal})`;
    push('warn', lastError);
    logEvent('warn', 'account', lastError);
    restarts++;
    const delay = Math.min(60_000, 2000 * Math.pow(2, Math.min(restarts, 5)));
    push('info', `${Math.round(delay / 1000)} ثانیهٔ دیگر دوباره تلاش می‌کنم…`);
    clearTimeout(backoffTimer);
    backoffTimer = setTimeout(() => { if (!stopping && was) startAccountServer(); }, delay);
    backoffTimer.unref?.();
  });
  child.on('error', (e) => { lastError = e.message; push('error', `خطای پروسه: ${e.message}`); });
  return { ok: true };
}

export function stopAccountServer() {
  stopping = true;
  clearTimeout(backoffTimer);
  if (!child) return { ok: true, reason: 'در حال اجرا نبود' };
  try {
    child.kill('SIGTERM');
    const c = child;
    setTimeout(() => { try { if (c && !c.killed) c.kill('SIGKILL'); } catch { /* رفته */ } }, 3000).unref?.();
  } catch (e) {
    return { ok: false, reason: e.message };
  }
  return { ok: true };
}

export function restartAccountServer() {
  stopAccountServer();
  restarts = 0;
  return new Promise((resolve) => setTimeout(() => resolve(startAccountServer()), 800));
}

/**
 * با بالا آمدنِ پنل. اگر سرورِ حساب از قبل روی همان پورت بالاست (داکر،
 * یا نصبِ دستی)، پنل چیزی را دوباره بالا نمی‌آورد — یک سرور، یک دفتر.
 */
export async function autostartAccountServer({ probe } = {}) {
  if (!config.accountApi?.enabled || !config.accountApi?.autostart) return { ok: false, reason: 'خاموش' };
  if (probe) {
    try {
      const p = await probe();
      if (p?.up) { announce(`سرورِ حساب از قبل بالاست (نسخهٔ ${p.version || '?'}) — پنل چیزی روشن نمی‌کند`); return { ok: true, reason: 'external' }; }
    } catch { /* پس بالا نیست */ }
  }
  const dir = resolveAccountDir();
  if (!dir) {
    announce('پوشهٔ سرورِ حساب کنارِ پنل نیست — تا نصب نشود، برنامه‌ها وارد نمی‌شوند (بقیهٔ پنل عادی کار می‌کند)');
    return { ok: false, reason: 'not_installed' };
  }
  return startAccountServer();
}

/** جملهٔ «چرا سرورِ حساب جواب نمی‌دهد» — از حالِ واقعیِ همین ناظر. */
export function downHint() {
  if (!config.accountApi?.autostart) {
    return 'سرورِ حساب روی سرورِ خانگی روشن نیست و راه‌اندازیِ خودکارش خاموش است (HLP_ACCOUNT_AUTOSTART=0) — آن را از .env بردارید تا پنل خودش بالا بیاوردش، یا سرورِ حساب را خودتان روی همان پورت روشن کنید.';
  }
  const dir = resolveAccountDir();
  if (!dir) {
    return 'سرورِ حساب روی سرورِ خانگی نصب نیست: پنلِ سرورِ خانگی را از فایلِ نصبیِ تازه (ControlCenter-Setup) دوباره نصب کنید تا سرورِ حساب همراهش بیاید — بعد دوباره امتحان کنید.';
  }
  if (child && startedAt && Date.now() - startedAt < 20_000) {
    return 'سرورِ حساب همین حالا دارد بالا می‌آید — چند ثانیهٔ دیگر دوباره امتحان کنید.';
  }
  if (lastError) {
    return `سرورِ حساب روی سرورِ خانگی افتاده (${lastError}) و پنل دارد دوباره بالا می‌آوردش — کمی بعد دوباره امتحان کنید؛ اگر ماند، لاگِ «سرورِ حساب» در پنل را ببینید.`;
  }
  return 'سرورِ حساب روی سرورِ خانگی هنوز بالا نیامده — چند ثانیهٔ دیگر دوباره امتحان کنید.';
}
setDownHint(downHint);

