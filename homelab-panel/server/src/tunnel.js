// ---------------------------------------------------------------------------
//  تونل اینترنتی — تا سایت از هر دستگاهی، هر جای دنیا، به همین سرور وصل شود
//
//  چرا لازم است: صفحه‌ای که با https باز می‌شود اجازهٔ اتصال به ws:// ندارد، و
//  آی‌پی خانگی (192.168.x.x) هم از بیرون خانه پیدا نمی‌شود. تونل هر دو را حل
//  می‌کند: یک آدرس https/wss عمومی می‌دهد که به همین کامپیوتر می‌رسد.
//
//  اینجا cloudflared (ابزار رسمی و رایگان Cloudflare) خودکار دانلود و اجرا
//  می‌شود؛ خروجی‌اش خوانده می‌شود تا آدرس عمومی پیدا شود.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import os from 'node:os';
import { config } from './config.js';
import { db, logEvent, getSetting, setSetting } from './db.js';
import { isProtectedHost } from './protected-hosts.js';
import { apiHostFor } from './platform/domain.js';

export const tunnelEvents = new EventEmitter();

/** دامنه‌های قُرقی که گزارششان یک‌بار نوشته شده (تا هر sync دوباره ننویسد) */
const protectedLogged = new Set();

const BIN_DIR = path.join(config.dataDir, 'bin');

function binaryName() {
  return process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
}

/**
 * معماری واقعی ویندوز — نه معماری خودِ Node.
 * اگر Node سی‌ودو بیتی روی ویندوز ۶۴ بیتی اجرا شود، process.arch می‌گوید ia32
 * ولی ویندوز ۶۴ بیتی است. متغیر PROCESSOR_ARCHITEW6432 دقیقاً همین را می‌گوید.
 */
function windowsArch() {
  const real = (process.env.PROCESSOR_ARCHITEW6432 || process.env.PROCESSOR_ARCHITECTURE || '').toUpperCase();
  if (real === 'ARM64') return 'arm64';
  if (real === 'AMD64') return 'amd64';
  if (real === 'X86') return '386';
  // اگر متغیر نبود، از خودِ Node بپرس
  if (process.arch === 'arm64') return 'arm64';
  if (process.arch === 'ia32') return '386';
  return 'amd64';
}

function downloadUrl() {
  const base = 'https://github.com/cloudflare/cloudflared/releases/latest/download/';
  if (process.platform === 'win32') return `${base}cloudflared-windows-${windowsArch()}.exe`;
  if (process.platform === 'darwin') {
    return `${base}cloudflared-darwin-${process.arch === 'arm64' ? 'arm64' : 'amd64'}.tgz`;
  }
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'arm' ? 'arm' : 'amd64';
  return `${base}cloudflared-linux-${arch}`;
}

const state = {
  status: 'stopped', // stopped | installing | starting | running | error
  url: null, // https://xxx.trycloudflare.com
  error: null,
  startedAt: null,
  restarts: 0,
  binary: null,
  lastLines: [],
};

let child = null;
// هر بار که تونل از نو اجرا می‌شود این عدد بالا می‌رود. پروسهٔ قدیمی که دارد
// می‌میرد نباید وضعیتِ پروسهٔ تازه را خراب کند — وگرنه پنل «مشکل در تونل»
// نشان می‌دهد در حالی که تونل واقعاً بالاست.
let generation = 0;
let stopping = false;
let restartTimer = null;

function pushLine(line) {
  state.lastLines.push(line.slice(0, 300));
  if (state.lastLines.length > 40) state.lastLines.shift();
}

function setStatus(status, extra = {}) {
  Object.assign(state, { status, ...extra });
  tunnelEvents.emit('change', publicState());
}

export function publicState() {
  return {
    status: state.status,
    url: state.url,
    wss: state.url ? state.url.replace(/^https:/, 'wss:') : null,
    error: state.error,
    startedAt: state.startedAt,
    restarts: state.restarts,
    mode: getSetting('tunnel_mode', 'quick'),
    hostname: getSetting('tunnel_hostname', null),
    permanent: ['named', 'token'].includes(getSetting('tunnel_mode', 'quick')),
    installed: Boolean(state.binary),
    binary: state.binary,
    diagnosis: state.diagnosis || null,
    log: state.lastLines.slice(-12),
  };
}

// ---------------------------------------------------------------------------
// پیدا کردن یا دانلود cloudflared
// ---------------------------------------------------------------------------
function existingBinary() {
  const local = path.join(BIN_DIR, binaryName());
  if (fs.existsSync(local)) return local;

  // شاید کاربر خودش نصب کرده و در PATH است
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, binaryName());
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch { /* اینجا نبود */ }
  }
  return null;
}

function download(url, dest, { redirects = 0 } = {}) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too_many_redirects'));
    const req = https.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(res.headers.location, dest, { redirects: redirects + 1 }));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`http_${res.statusCode}`));
      }
      const tmp = `${dest}.part`;
      const file = fs.createWriteStream(tmp);
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          try {
            fs.renameSync(tmp, dest);
            if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
            resolve(dest);
          } catch (e) {
            reject(e);
          }
        });
      });
      file.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/** مسیر cloudflaredِ آماده — تونل‌های هر سایت هم از همین یکی استفاده می‌کنند */
export function binaryPath() {
  return state.binary;
}

export async function ensureBinary() {
  const found = existingBinary();
  if (found) {
    state.binary = found;
    return found;
  }

  if (process.platform === 'darwin') {
    // نسخهٔ مک فشرده است؛ باز کردنش وابستگی می‌خواهد — از کاربر می‌خواهیم خودش نصب کند
    throw new Error('macos_manual_install');
  }

  await fsp.mkdir(BIN_DIR, { recursive: true });
  const dest = path.join(BIN_DIR, binaryName());
  setStatus('installing');
  console.log('[tunnel] در حال دانلود cloudflared (فقط همین یک‌بار)…');
  logEvent('info', 'panel', 'دانلود cloudflared برای تونل اینترنتی آغاز شد');
  await download(downloadUrl(), dest);
  state.binary = dest;
  console.log(`[tunnel] cloudflared آماده شد: ${dest}`);
  logEvent('info', 'panel', 'cloudflared با موفقیت دانلود شد');
  return dest;
}

// ---------------------------------------------------------------------------
// اجرا
// ---------------------------------------------------------------------------
// آدرس تونل باید از بین چند آدرسی که cloudflared چاپ می‌کند درست انتخاب شود.
// بنرِ خودش لینکِ قوانین و مستندات دارد؛ آن‌ها نباید به‌جای تونل برداشته شوند.
const QUICK_TUNNEL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
// هر آدرس https؛ درستی‌اش با new URL بررسی می‌شود (دامنه یا IP، با یا بدون پورت)
const ANY_URL_RE = /https:\/\/[^\s"'<>|]+/gi;

// دامنه‌هایی که در بنر و پیام‌های راهنما می‌آیند و آدرس تونل نیستند
const NOT_A_TUNNEL = /^(?:www\.)?cloudflare\.com$|^developers\.cloudflare\.com$|^github\.com$|^dash\.cloudflare\.com$/i;

function extractTunnelUrl(line, custom) {
  if (!custom) {
    const quick = line.match(QUICK_TUNNEL_RE);
    return quick ? quick[0] : null;
  }
  // دستور سفارشی: هر آدرس https به‌جز دامنه‌های راهنما
  for (const candidate of line.match(ANY_URL_RE) || []) {
    let host;
    try {
      host = new URL(candidate).host.replace(/:\d+$/, '');
    } catch {
      continue;
    }
    if (NOT_A_TUNNEL.test(host)) continue;
    return candidate.replace(/[.,)\]]+$/, '');
  }
  return null;
}

// ---------------------------------------------------------------------------
//  آدرس ثابت (تونل نام‌دار) — مدل فایربیس
//
//  تونل رایگانِ سریع هر بار آدرس تازه می‌دهد، پس نمی‌شود آن را یک‌بار در سایت
//  گذاشت. با «تونل نام‌دار» یک زیردامنهٔ خودتان (مثل sync.example.com) برای همیشه
//  به همین سرور وصل می‌شود؛ آن وقت آدرس یک‌بار در سایت می‌نشیند و دیگر عوض نمی‌شود.
//
//  راه‌اندازی یک‌بار است: ورود به حساب Cloudflare ← ساخت تونل ← وصل کردن زیردامنه.
// ---------------------------------------------------------------------------
const CF_DIR = path.join(config.dataDir, 'cloudflared');
const CERT_FILE = path.join(CF_DIR, 'cert.pem');
const CONFIG_FILE = path.join(CF_DIR, 'config.yml');
// اگر کاربر خودش در ترمینال «cloudflared tunnel login» زده باشد، گواهی اینجاست
const HOME_CERT = path.join(os.homedir(), '.cloudflared', 'cert.pem');

/** گواهی ورود را از هر جا که باشد پیدا می‌کند و در پوشهٔ پنل کپی می‌گیرد */
function findCert() {
  if (fs.existsSync(CERT_FILE)) return CERT_FILE;
  if (fs.existsSync(HOME_CERT)) {
    try {
      fs.mkdirSync(CF_DIR, { recursive: true });
      fs.copyFileSync(HOME_CERT, CERT_FILE);
      return CERT_FILE;
    } catch {
      return HOME_CERT;
    }
  }
  return null;
}

function runCf(args, { timeout = 120000, onLine } = {}) {
  return new Promise((resolve) => {
    const proc = spawn(state.binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, TUNNEL_ORIGIN_CERT: CERT_FILE },
    });
    let output = '';
    const onData = (chunk) => {
      const text = chunk.toString();
      output += text;
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) onLine?.(line.trim());
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch { /* بسته شده */ }
    }, timeout);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, output });
    });
    proc.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, code: -1, output: output + e.message });
    });
  });
}

/**
 * فایلِ اعتبارِ تونل را هرجا که cloudflared گذاشته باشد پیدا می‌کند و در پوشهٔ
 * پنل کپی می‌گیرد. اگر این فایل نباشد، cloudflared فوراً با کد ۱ می‌میرد و
 * هیچ توضیحی هم در پنل دیده نمی‌شد.
 */
async function ensureCredFile(uuid, name = null) {
  const target = path.join(CF_DIR, `${uuid}.json`);
  if (fs.existsSync(target)) return target;

  // ۱) شاید cloudflared آن را جای دیگری گذاشته باشد
  const candidates = [
    path.join(os.homedir(), '.cloudflared', `${uuid}.json`),
    path.join(process.cwd(), `${uuid}.json`),
    path.join(config.dataDir, `${uuid}.json`),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      await fsp.mkdir(CF_DIR, { recursive: true });
      await fsp.copyFile(candidate, target);
      return target;
    } catch {
      return candidate; // کپی نشد، ولی خودش هست
    }
  }

  // ۲) تونل از قبل ساخته شده بود؟ آن وقت «tunnel create» فایل اعتبار را دوباره
  //    نمی‌نویسد و اگر فایل قبلی گم شده باشد هیچ‌جا پیدا نمی‌شود. اینجا آن را
  //    برای همان تونلِ موجود دوباره می‌گیریم — بدون ساختن تونل تازه.
  const tunnelRef = name || uuid;
  try {
    await fsp.mkdir(CF_DIR, { recursive: true });
    const got = await runCf(['tunnel', 'token', '--cred-file', target, tunnelRef], { timeout: 60000 });
    if (fs.existsSync(target)) {
      logEvent('info', 'panel', 'فایل اعتبارِ تونل دوباره از Cloudflare گرفته شد');
      return target;
    }
    if (got.output) pushLine(`tunnel token: ${got.output.trim().slice(-200)}`);
  } catch { /* پایین‌تر جواب می‌دهیم */ }

  return null;
}

/**
 * چرا تونل بالا نمی‌آید؟ — بررسی واقعیِ پیش‌نیازها.
 * به‌جای «کد ۱»، همان چیزی را می‌گوید که باید درست شود.
 */
export function tunnelDiagnosis() {
  const mode = getSetting('tunnel_mode', 'quick');
  const problems = [];

  if (mode === 'named') {
    if (!findCert()) {
      problems.push({
        code: 'not_logged_in',
        message: 'به حساب Cloudflare وارد نشده‌اید (فایل cert.pem نیست).',
      });
    }
    if (!fs.existsSync(CONFIG_FILE)) {
      problems.push({ code: 'no_config', message: 'فایل پیکربندی تونل ساخته نشده است.' });
    } else {
      const cred = readCredFromConfig();
      if (!cred) {
        problems.push({ code: 'no_credentials_line', message: 'در پیکربندی، مسیر فایل اعتبار نوشته نشده.' });
      } else if (!fs.existsSync(cred)) {
        problems.push({
          code: 'credentials_missing',
          message: `فایل اعتبارِ تونل سرِ جایش نیست: ${cred}`,
          fixable: true,
        });
      }
    }
  }

  if (mode === 'token' && !getSetting('tunnel_token', null)) {
    problems.push({ code: 'no_token', message: 'توکن تونل ذخیره نشده است.' });
  }

  // آخرین خطی که خودِ cloudflared به‌عنوان خطا چاپ کرده
  const cfError = [...state.lastLines]
    .reverse()
    .find((line) => /error|failed|cannot|unable|no such file|not found/i.test(line));

  return { mode, ok: problems.length === 0, problems, lastError: cfError || null };
}

/**
 * تلاش برای درست کردنِ خودکارِ خرابیِ رایج: فایل اعتبار جابه‌جا شده.
 * مسیرش را دوباره پیدا می‌کند و پیکربندی را بازنویسی می‌کند.
 */
export async function repairTunnel() {
  const uuid = readTunnelIdFromConfig();
  if (!uuid) return { ok: false, error: 'no_permanent_tunnel' };

  const cred = await ensureCredFile(uuid, getSetting('tunnel_name', DEFAULT_TUNNEL_NAME));
  if (!cred) {
    return {
      ok: false,
      error: 'credentials_not_found',
      detail: `فایل ${uuid}.json پیدا نشد — تونل باید دوباره ساخته شود.`,
    };
  }

  await writeIngress(uuid, cred);
  logEvent('info', 'panel', 'پیکربندی تونل بازسازی شد');
  stopTunnel();
  await startTunnel({});
  return { ok: true, credentialsFile: cred };
}

export function namedConfig() {
  return {
    loggedIn: Boolean(findCert()),
    configured: fs.existsSync(CONFIG_FILE),
    hostname: getSetting('tunnel_hostname', null),
    tunnelName: getSetting('tunnel_name', null),
    mode: getSetting('tunnel_mode', 'quick'),
    // خودِ توکن هرگز بیرون نمی‌رود — فقط اینکه تنظیم شده یا نه
    hasToken: Boolean(getSetting('tunnel_token', null)),
  };
}

/** گام ۱: ورود به حساب Cloudflare — آدرسی برمی‌گرداند که کاربر باید باز کند */
export async function namedLoginStart() {
  await ensureBinary();
  await fsp.mkdir(CF_DIR, { recursive: true });
  if (findCert()) return { alreadyLoggedIn: true, url: null };

  return new Promise((resolve) => {
    let settled = false;
    const proc = spawn(state.binary, ['tunnel', 'login'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, TUNNEL_ORIGIN_CERT: CERT_FILE },
    });
    loginProc = proc;

    const onData = (chunk) => {
      const text = chunk.toString();
      pushLine(text.trim().slice(0, 200));
      // cloudflared ممکن است آدرس را با قالب‌های مختلف چاپ کند
      const match =
        text.match(/https:\/\/dash\.cloudflare\.com\/\S+/) ||
        text.match(/https:\/\/[a-z0-9.-]*cloudflare[a-z0-9.-]*\/\S*argotunnel\S*/i);
      if (match && !settled) {
        settled = true;
        resolve({ alreadyLoggedIn: false, url: match[0].replace(/[.,)\]]+$/, '') });
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', () => {
      loginProc = null;
      if (!settled) {
        settled = true;
        resolve({ alreadyLoggedIn: fs.existsSync(CERT_FILE), url: null });
      }
    });
    setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({
          alreadyLoggedIn: Boolean(findCert()),
          url: null,
          error: 'cloudflared آدرس ورود را چاپ نکرد',
          log: state.lastLines.slice(-8),
          manualCommand: `"${state.binary}" tunnel login`,
        });
      }
    }, 60000).unref?.();
  });
}

export function namedLoginDone() {
  return Boolean(findCert());
}

/** گام ۲: ساخت تونل و وصل کردن زیردامنه — بعد از آن آدرس برای همیشه ثابت است */
/** نامِ پیش‌فرضِ تونل در حسابِ Cloudflare — نامِ همین برنامه، نه پروژهٔ دیگری */
export const DEFAULT_TUNNEL_NAME = 'control-center';

/**
 * ساختِ تونلِ نام‌دار.
 *
 * `name` همان اسمی است که در حسابِ Cloudflare دیده می‌شود. اگر از قبل تونلی
 * برای برنامهٔ دیگرتان دارید، این یکی کنارش ساخته می‌شود و کاری به آن ندارد؛
 * فقط نامش نباید همان باشد.
 */
/**
 * نامی که آدم می‌نویسد را به نامِ خالصِ میزبان تبدیل می‌کند.
 *
 * ⚠️ چرا لازم شد: قاعدهٔ سنجش فقط حرف و رقم و خط‌تیره را می‌پذیرد، پس
 * «https://api.example.com/» — همان چیزی که آدم از نوارِ مرورگر کپی می‌کند —
 * رد می‌شد و تنها چیزی که می‌دید «invalid_hostname» بود. حالا پیشوندِ نشانی،
 * مسیر، پورت، فاصله و نقطهٔ پایانی برداشته می‌شود و اگر چیزِ سالمی ماند،
 * همان به کار می‌رود.
 */
export function normalizeHostname(value) {
  return String(value ?? '')
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')  // https:// و مانندش
    .replace(/[/?#].*$/, '')                  // مسیر و پرس‌وجو
    .replace(/:\d+$/, '')                     // پورت
    .replace(/\.+$/, '')                      // نقطهٔ آخرِ نامِ مطلق
    .trim()
    .toLowerCase();
}

export async function namedSetup({ hostname, name = DEFAULT_TUNNEL_NAME }) {
  const host = normalizeHostname(hostname);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return { ok: false, error: 'invalid_hostname' };
  if (isProtectedHost(host)) {
    logEvent('warn', 'panel', `دامنهٔ ${host} قُرق است و به تونل وصل نشد (رکورد DNS سایت عمومی دست‌نخورده ماند)`);
    return { ok: false, error: 'protected_hostname' };
  }
  if (!findCert()) return { ok: false, error: 'not_logged_in' };

  await ensureBinary();

  // اگر تونل با همین نام از قبل هست، دوباره ساخته نمی‌شود
  const created = await runCf(['tunnel', 'create', name]);
  const already = /already exists/i.test(created.output);
  if (!created.ok && !already) {
    return { ok: false, error: 'create_failed', detail: created.output.slice(-400) };
  }

  const listed = await runCf(['tunnel', 'list', '--output', 'json']);
  let uuid = null;
  try {
    uuid = (JSON.parse(listed.output.slice(listed.output.indexOf('[')))?.find((t) => t.name === name) || {}).id;
  } catch { /* از خروجی ساخت می‌خوانیم */ }
  if (!uuid) {
    const m = created.output.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    uuid = m ? m[0] : null;
  }
  if (!uuid) return { ok: false, error: 'tunnel_id_not_found', detail: created.output.slice(-400) };

  const routed = await runCf(['tunnel', 'route', 'dns', '--overwrite-dns', name, host]);
  if (!routed.ok && !/already exists|record with the same/i.test(routed.output)) {
    return { ok: false, error: 'dns_failed', detail: routed.output.slice(-400) };
  }

  // فایلِ اعتبارِ تونل — اگر پیدا نشود، cloudflared بی‌صدا با کد ۱ می‌میرد
  let credFile = await ensureCredFile(uuid, name);

  // آخرین راه: تونلِ قدیمی را دور می‌ریزیم و از نو می‌سازیم تا فایل اعتبار
  // تازه نوشته شود. تونل مالِ خودِ پنل است، پس چیزی از دست نمی‌رود.
  if (!credFile && already) {
    logEvent('warn', 'panel', `تونل «${name}» بدون فایل اعتبار بود — از نو ساخته می‌شود`);
    await runCf(['tunnel', 'cleanup', name]);
    const removed = await runCf(['tunnel', 'delete', '-f', name]);
    if (removed.ok || /deleted/i.test(removed.output)) {
      const rebuilt = await runCf(['tunnel', 'create', name]);
      const m = rebuilt.output.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (m) {
        uuid = m[0];
        credFile = await ensureCredFile(uuid, name);
        // تونل تازه است، پس رکورد DNS باید دوباره به آن اشاره کند
        if (credFile) await runCf(['tunnel', 'route', 'dns', '--overwrite-dns', name, host]);
      }
    }
  }

  if (!credFile) {
    return {
      ok: false,
      error: 'credentials_not_found',
      detail:
        `فایلِ اعتبارِ تونل (${uuid}.json) نه پیدا شد و نه ساخته شد. ` +
        `در ترمینال این دو را بزنید: "${state.binary}" tunnel delete -f ${name}  و بعد  ` +
        `"${state.binary}" tunnel create ${name}`,
    };
  }

  setSetting('tunnel_mode', 'named');
  setSetting('tunnel_hostname', host);
  setSetting('tunnel_name', name);
  await writeIngress(uuid, credFile);
  logEvent('info', 'panel', `آدرس ثابت ساخته شد: ${host}`);

  stopTunnel();
  await startTunnel({});
  return { ok: true, hostname: host, tunnelId: uuid };
}

/**
 * راهِ ساده‌تر: توکنِ تونل را از داشبورد Cloudflare بردارید و اینجا بچسبانید.
 * (Zero Trust ← Networks ← Tunnels ← Create a tunnel ← Cloudflared)
 * زیردامنه هم در همان داشبورد به این تونل وصل می‌شود (Public Hostname).
 */
export async function tokenSetup({ token, hostname }) {
  const clean = String(token || '').trim();
  const host = normalizeHostname(hostname);
  // توکن تونل یک رشتهٔ base64 بلند است
  if (clean.length < 40 || /\s/.test(clean)) return { ok: false, error: 'invalid_token' };
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return { ok: false, error: 'invalid_hostname' };

  try {
    await ensureBinary();
  } catch (e) {
    return { ok: false, error: 'cloudflared_missing', detail: e.message };
  }

  setSetting('tunnel_token', clean);
  setSetting('tunnel_hostname', host);
  setSetting('tunnel_mode', 'token');
  logEvent('info', 'panel', `تونل با توکن تنظیم شد — آدرس ثابت: ${host}`);

  stopTunnel();
  const st = await startTunnel({});
  return { ok: true, hostname: host, status: st.status };
}

/**
 * دامنه‌هایی که در بخش «دامنه‌ها» به یک سایت وصل شده‌اند.
 * همین جدول تعیین می‌کند هر دامنه به کدام سایت برود؛ پس اگر دامنه را به سایتِ
 * دیگری وصل کنید، فقط کافی است همین فهرست دوباره نوشته شود.
 */
function domainRoutes() {
  try {
    return db
      .prepare(
        `SELECT d.name AS hostname, s.port AS port, s.name AS siteName, s.slug AS slug
           FROM domains d JOIN sites s ON s.id = d.site_id
          WHERE s.port IS NOT NULL AND s.enabled = 1
          ORDER BY d.name COLLATE NOCASE`
      )
      .all();
  } catch {
    return []; // جدول هنوز ساخته نشده
  }
}

/**
 * پورتی که APIِ عمومی رویش نشسته.
 *
 * همان پورتِ دومِ سرورِ سایت است، نه پورتِ پنل: پنل و فایل‌منیجر و ترمینال
 * نباید از اینترنت دیده شوند. اگر پورتِ دوم نباشد، چیزی جز پورتِ پنل
 * نمی‌ماند و همان استفاده می‌شود — همان قاعده‌ای که میزبانِ اصلیِ تونل هم
 * از آن پیروی می‌کند.
 */
function publicApiPort() {
  return config.siteSync.port || config.port;
}

/**
 * آدرسِ APIِ هر دامنه: `api.<دامنه>`.
 *
 *      📱 برنامه → https://api.yaqobipump.top → ☁️ Cloudflare → 🏠 سرور
 *
 *  کاربر فقط دامنه‌اش را در بخشِ «دامنه‌ها» می‌نویسد؛ آدرسِ API خودش ساخته
 *  می‌شود و به پورتِ عمومی وصل می‌شود. رکوردِ DNS‌اش هم مثلِ بقیهٔ مسیرها
 *  در syncTunnelRoutes ساخته می‌شود، چون این‌ها هم main نیستند.
 *
 *  ریشه‌ها از سه جا می‌آیند: جدولِ دامنه‌ها، میزبانِ اصلیِ تونل، و
 *  HLP_DOMAIN. هرکدام که باشد کافی است؛ تکراری‌ها یک‌بار حساب می‌شوند.
 */
export function apiHostnames() {
  const roots = [];
  try {
    for (const row of db.prepare('SELECT name FROM domains').all()) roots.push(row.name);
  } catch { /* جدول هنوز ساخته نشده */ }
  roots.push(getSetting('tunnel_hostname', null), config.domains?.root);

  const hosts = new Set();
  for (const root of roots) {
    const host = apiHostFor(root);
    if (host) hosts.add(host);
  }
  return [...hosts].sort();
}

/** همهٔ نامزدهای مسیر — پیش از کنار گذاشتنِ دامنه‌های قُرق */
function candidateHostnames() {
  const main = getSetting('tunnel_hostname', null);
  const extra = getSetting('tunnel_hostnames', []) || [];
  const list = [];
  const seen = new Set();

  if (main) {
    list.push({ hostname: main, port: config.siteSync.port || config.port, main: true, source: 'main' });
    seen.add(main);
  }

  // دامنه‌های وصل‌شده به سایت‌ها — خودکار، بدون این که کاربر پورت را دستی بنویسد
  for (const row of domainRoutes()) {
    const host = String(row.hostname || '').toLowerCase();
    if (!host || seen.has(host)) continue;
    seen.add(host);
    list.push({
      hostname: host,
      port: Number(row.port),
      main: false,
      source: 'site',
      site: row.siteName,
      slug: row.slug,
    });
  }

  // آدرسِ APIِ هر دامنه — خودکار، به پورتِ عمومی
  for (const host of apiHostnames()) {
    if (seen.has(host)) continue;
    seen.add(host);
    list.push({ hostname: host, port: publicApiPort(), main: false, source: 'api' });
  }

  // زیردامنه‌هایی که دستی اضافه شده‌اند
  for (const item of extra) {
    const host = String(item?.hostname || '').toLowerCase();
    if (!host || seen.has(host)) continue;
    seen.add(host);
    list.push({ hostname: host, port: Number(item.port) || config.port, main: false, source: 'manual' });
  }

  return list;
}

/**
 * همهٔ زیردامنه‌هایی که به این تونل وصل‌اند.
 * دامنه‌های قُرق (protected-hosts.js) بیرون می‌مانند: نه رکورد DNS‌شان بازنویسی
 * می‌شود و نه در ingress تونل می‌نشینند — تا سایتِ عمومی روی GitHub Pages
 * دست‌نخورده بماند.
 */
export function routedHostnames() {
  return candidateHostnames().filter((r) => !isProtectedHost(r.hostname));
}

/** دامنه‌های قُرقی که با وجودِ وصل بودن به سایت، عمداً به تونل نرفته‌اند */
export function skippedProtectedHostnames() {
  return candidateHostnames()
    .filter((r) => isProtectedHost(r.hostname))
    .map((r) => r.hostname);
}

/**
 * بعد از هر تغییر در دامنه‌ها: فایلِ مسیرها دوباره نوشته و تونل تازه می‌شود.
 * اگر دامنه‌ای تازه است، رکورد DNS‌اش هم یک‌بار ساخته می‌شود.
 */
export async function syncTunnelRoutes({ restart = true } = {}) {
  const uuid = readTunnelIdFromConfig();
  const credFile = readCredFromConfig();
  const mode = getSetting('tunnel_mode', 'quick');
  if (mode !== 'named' || !uuid || !credFile) {
    // حالت سریع یا توکنی: مسیرها اینجا نگه‌داری نمی‌شوند
    return { ok: true, applied: false, hostnames: routedHostnames() };
  }

  const name = getSetting('tunnel_name', DEFAULT_TUNNEL_NAME);
  const alreadyRouted = new Set(getSetting('tunnel_routed_dns', []) || []);
  const failures = [];

  // دامنه‌های قُرق: یک‌بار در گزارش بنویس تا معلوم باشد چرا به تونل نرفته‌اند
  const skipped = skippedProtectedHostnames();
  for (const host of skipped) {
    if (protectedLogged.has(host)) continue;
    protectedLogged.add(host);
    logEvent(
      'warn',
      'panel',
      `دامنهٔ ${host} قُرق است: رکورد DNS آن بازنویسی نشد تا سایت عمومی روی GitHub Pages نخوابد`
    );
  }

  if (findCert()) {
    try {
      await ensureBinary();
      for (const route of routedHostnames()) {
        if (route.main || alreadyRouted.has(route.hostname)) continue;
        const routed = await runCf(['tunnel', 'route', 'dns', '--overwrite-dns', name, route.hostname]);
        if (routed.ok || /already exists|record with the same/i.test(routed.output)) {
          alreadyRouted.add(route.hostname);
        } else {
          failures.push({ hostname: route.hostname, detail: routed.output.slice(-200) });
        }
      }
      setSetting('tunnel_routed_dns', [...alreadyRouted]);
    } catch (e) {
      failures.push({ hostname: '*', detail: e.message });
    }
  }

  await writeIngress(uuid, credFile);
  if (restart) {
    stopTunnel();
    await startTunnel({});
  }
  return { ok: !failures.length, applied: true, failures, skippedProtected: skipped, hostnames: routedHostnames() };
}

/** فایل config.yml را با همهٔ زیردامنه‌ها بازنویسی می‌کند */
async function writeIngress(uuid, credFile) {
  const lines = [`tunnel: ${uuid}`, `credentials-file: ${credFile.replaceAll('\\', '/')}`, 'ingress:'];
  for (const r of routedHostnames()) {
    lines.push(`  - hostname: ${r.hostname}`);
    lines.push(`    service: http://127.0.0.1:${r.port}`);
  }
  lines.push('  - service: http_status:404', '');
  await fsp.writeFile(CONFIG_FILE, lines.join('\n'), 'utf8');
}

function readTunnelIdFromConfig() {
  try {
    const m = fs.readFileSync(CONFIG_FILE, 'utf8').match(/^tunnel:\s*(\S+)/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function readCredFromConfig() {
  try {
    const m = fs.readFileSync(CONFIG_FILE, 'utf8').match(/^credentials-file:\s*(.+)$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * یک زیردامنهٔ دیگر به همین تونل وصل می‌کند — برای سایت‌های بعدی.
 * نه دانلود دوباره، نه ورود دوباره؛ فقط یک رکورد DNS و یک خط در config.
 */
export async function addHostname({ hostname, port }) {
  const host = normalizeHostname(hostname);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return { ok: false, error: 'invalid_hostname' };
  if (isProtectedHost(host)) {
    logEvent('warn', 'panel', `دامنهٔ ${host} قُرق است و به تونل وصل نشد (رکورد DNS سایت عمومی دست‌نخورده ماند)`);
    return { ok: false, error: 'protected_hostname' };
  }
  const targetPort = Number(port) || config.port;

  const name = getSetting('tunnel_name', DEFAULT_TUNNEL_NAME);
  const uuid = readTunnelIdFromConfig();
  const credFile = readCredFromConfig();
  if (!uuid || !credFile) return { ok: false, error: 'no_permanent_tunnel' };
  if (!findCert()) return { ok: false, error: 'not_logged_in' };

  await ensureBinary();

  const routed = await runCf(['tunnel', 'route', 'dns', '--overwrite-dns', name, host]);
  if (!routed.ok && !/already exists|record with the same/i.test(routed.output)) {
    return { ok: false, error: 'dns_failed', detail: routed.output.slice(-400) };
  }

  const extra = (getSetting('tunnel_hostnames', []) || []).filter((x) => x?.hostname !== host);
  extra.push({ hostname: host, port: targetPort });
  setSetting('tunnel_hostnames', extra);

  await writeIngress(uuid, credFile);
  logEvent('info', 'panel', `زیردامنهٔ ${host} به تونل وصل شد (پورت ${targetPort})`);

  stopTunnel();
  await startTunnel({});
  return { ok: true, hostname: host, port: targetPort, hostnames: routedHostnames() };
}

export async function removeHostname(hostname) {
  const host = normalizeHostname(hostname);
  const extra = (getSetting('tunnel_hostnames', []) || []).filter((x) => x?.hostname !== host);
  setSetting('tunnel_hostnames', extra);
  const uuid = readTunnelIdFromConfig();
  const credFile = readCredFromConfig();
  if (uuid && credFile) {
    await writeIngress(uuid, credFile);
    stopTunnel();
    await startTunnel({});
  }
  return { ok: true, hostnames: routedHostnames() };
}

/**
 * عوض کردنِ آدرسِ اصلیِ سرور — بدونِ بازنشانیِ همه‌چیز.
 *
 * ⚠️ چرا این تابع لازم شد: تا امروز تنها راهِ عوض کردنِ دامنهٔ اصلی،
 * «بازنشانی» بود؛ یعنی tunnel_mode به quick برمی‌گشت، فایلِ پیکربندی پاک
 * می‌شد و کاربر باید کلِ مراحلِ ورود به Cloudflare و ساختِ تونل را از نو
 * می‌رفت. کسی که فقط یک حرف را اشتباه تایپ کرده بود، همه‌چیز را از دست
 * می‌داد.
 *
 * حالا تونل، حسابِ Cloudflare و بقیهٔ زیردامنه‌ها سرِ جای‌شان می‌مانند و فقط
 * نامِ اصلی عوض می‌شود.
 *
 * نکته‌ای که به کاربر هم گفته می‌شود: رکوردِ DNS دامنهٔ قبلی در Cloudflare
 * باقی می‌ماند. cloudflared دستوری برای حذفِ رکورد ندارد؛ اگر لازم است،
 * باید از داشبوردِ Cloudflare پاک شود. ماندنش ضرری ندارد — فقط یک نامِ
 * اضافه است که به همین تونل می‌رسد.
 */
export async function setMainHostname({ hostname }) {
  const host = normalizeHostname(hostname);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return { ok: false, error: 'invalid_hostname' };
  if (isProtectedHost(host)) return { ok: false, error: 'protected_hostname' };

  const mode = getSetting('tunnel_mode', 'quick');
  if (mode !== 'named') return { ok: false, error: 'not_named_mode' };

  const previous = getSetting('tunnel_hostname', null);
  if (previous === host) return { ok: true, hostname: host, unchanged: true };

  if (!findCert()) return { ok: false, error: 'not_logged_in' };

  const name = getSetting('tunnel_name', DEFAULT_TUNNEL_NAME);
  await ensureBinary();

  // رکوردِ DNS نامِ تازه باید همین‌جا ساخته شود: syncTunnelRoutes عمداً از
  // روی دامنهٔ اصلی رد می‌شود (route.main) چون فرض می‌کند namedSetup آن را
  // ساخته است.
  const routed = await runCf(['tunnel', 'route', 'dns', '--overwrite-dns', name, host]);
  if (!routed.ok && !/already exists|record with the same/i.test(routed.output)) {
    return { ok: false, error: 'dns_failed', detail: routed.output.slice(-400) };
  }

  setSetting('tunnel_hostname', host);

  const known = new Set(getSetting('tunnel_routed_dns', []) || []);
  known.add(host);
  setSetting('tunnel_routed_dns', [...known]);

  logEvent('info', 'panel', `آدرسِ اصلیِ سرور از ${previous || '—'} به ${host} عوض شد`);

  // مسیرها و فایلِ ingress دوباره نوشته و تونل تازه می‌شود
  const synced = await syncTunnelRoutes({ restart: true });

  return { ok: true, hostname: host, previous, hostnames: synced.hostnames };
}

/**
 * نمای هر دامنه، یک‌جا.
 *
 * تا امروز صفحهٔ «آدرس اینترنتی» فقط دامنهٔ اصلی را کامل نشان می‌داد و بقیه
 * یک سطرِ ساده در گوشهٔ همان کارت بودند — بدونِ اینکه معلوم باشد رکوردِ DNS
 * ساخته شده یا نه، به کدام پورت می‌رود، و از کجا آمده. این تابع همان
 * چیزهایی را که برای دامنهٔ اصلی نشان داده می‌شد، برای همهٔ دامنه‌ها می‌دهد.
 */
export function domainOverview() {
  const mode = getSetting('tunnel_mode', 'quick');
  const main = getSetting('tunnel_hostname', null);
  const routedDns = new Set(getSetting('tunnel_routed_dns', []) || []);
  const protectedHosts = new Set(skippedProtectedHostnames());

  const items = candidateHostnames().map((row) => {
    const isProtected = protectedHosts.has(row.hostname);
    return {
      ...row,
      url: `https://${row.hostname}`,
      // دامنهٔ اصلی را namedSetup مسیریابی کرده، پس همیشه ثبت‌شده است
      dnsRouted: row.main ? Boolean(main) : routedDns.has(row.hostname),
      protected: isProtected,
      // در حالتِ سریع هیچ دامنه‌ای واقعاً از راهِ تونل سرو نمی‌شود
      servedByTunnel: mode === 'named' && !isProtected,
    };
  });

  return {
    ok: true,
    mode,
    main,
    tunnelName: getSetting('tunnel_name', DEFAULT_TUNNEL_NAME),
    items,
  };
}

export async function namedReset() {
  setSetting('tunnel_hostnames', []);
  setSetting('tunnel_token', null);
  setSetting('tunnel_mode', 'quick');
  setSetting('tunnel_hostname', null);
  stopTunnel();
  await fsp.rm(CONFIG_FILE, { force: true });
  return startTunnel({});
}

let loginProc = null;

export async function startTunnel({ port } = {}) {
  if (child) return publicState();
  stopping = false;
  clearTimeout(restartTimer);

  const targetPort = port || config.siteSync.port || config.port;

  try {
    if (!process.env.HLP_TUNNEL_CMD) await ensureBinary();
  } catch (e) {
    setStatus('error', {
      error:
        e.message === 'macos_manual_install'
          ? 'روی مک، cloudflared را دستی نصب کنید: brew install cloudflared'
          : `دانلود cloudflared ناموفق بود: ${e.message}`,
    });
    logEvent('error', 'panel', `تونل: ${state.error}`);
    return publicState();
  }

  setStatus('starting', { url: null, error: null });

  // HLP_TUNNEL_CMD برای حالت‌های خاص: اگر کسی تونل دیگری دارد یا در آزمون‌ها.
  // مقدارش با کاما جدا می‌شود و {port} با پورت مقصد جایگزین می‌شود.
  const custom = process.env.HLP_TUNNEL_CMD;
  const mode = getSetting('tunnel_mode', 'quick');
  const tunnelToken = mode === 'token' ? getSetting('tunnel_token', null) : null;
  const named = !custom && mode === 'named' && fs.existsSync(CONFIG_FILE);
  // در هر دو حالتِ آدرسِ ثابت، زیردامنه از قبل معلوم است
  const namedHost = custom ? null : named || tunnelToken ? getSetting('tunnel_hostname', null) : null;

  const [command, args] = custom
    ? (() => {
        const parts = custom.split(',').map((p) => p.trim().replaceAll('{port}', String(targetPort)));
        return [parts[0], parts.slice(1)];
      })()
    : tunnelToken
      ? [state.binary, ['tunnel', '--no-autoupdate', 'run', '--token', tunnelToken]]
      : named
        ? [state.binary, ['tunnel', '--no-autoupdate', '--config', CONFIG_FILE, 'run']]
        : [
          state.binary,
          ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${targetPort}`, '--loglevel', 'info'],
        ];

  const myGeneration = ++generation;
  const isCurrent = () => myGeneration === generation;

  child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, TUNNEL_ORIGIN_CERT: CERT_FILE },
  });
  const myChild = child;

  // در حالت آدرس ثابت، آدرس از قبل معلوم است — فقط منتظر برقراری اتصال می‌مانیم
  if (namedHost) {
    setStatus('starting', { url: null, error: null });
  }

  const onData = (chunk) => {
    if (!isCurrent()) return;
    const text = chunk.toString();
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      pushLine(line);
      // حالت آدرس ثابت: به‌محض ثبت اتصال، همان زیردامنه آدرس ماست
      if (namedHost && !state.url && /Registered tunnel connection|Connection .* registered/i.test(line)) {
        state.repairTried = false;
        setStatus('running', { url: `https://${namedHost}`, startedAt: Date.now(), error: null });
        console.log(`[tunnel] آدرس ثابت فعال شد: https://${namedHost}`);
        logEvent('info', 'panel', `تونل با آدرس ثابت فعال شد: ${namedHost}`);
        continue;
      }

      const found = namedHost ? null : extractTunnelUrl(line, Boolean(custom));
      if (found && !state.url) {
        setStatus('running', { url: found, startedAt: Date.now(), error: null });
        console.log(`[tunnel] آدرس عمومی آماده شد: ${found}`);
        logEvent('info', 'panel', `تونل اینترنتی فعال شد: ${found}`);
      }
    }
  };

  child.stdout.on('data', onData);
  child.stderr.on('data', onData); // cloudflared بیشتر روی stderr می‌نویسد

  child.on('error', (e) => {
    if (!isCurrent()) return; // مالِ اجرای قبلی است
    setStatus('error', { error: e.message });
    logEvent('error', 'panel', `تونل اجرا نشد: ${e.message}`);
    child = null;
  });

  child.on('exit', (code) => {
    if (!isCurrent()) return; // اجرای تازه‌تری جایش را گرفته
    if (child === myChild) child = null;
    if (stopping) {
      setStatus('stopped', { url: null });
      return;
    }
    state.restarts++;
    // «کد ۱» به کسی نمی‌گوید چه شده — دلیل واقعی را از خروجی cloudflared و از
    // بررسیِ پیش‌نیازها بیرون می‌کشیم.
    const diag = tunnelDiagnosis();
    const reason = diag.problems[0]?.message || diag.lastError || null;
    setStatus('error', {
      url: null,
      error: reason
        ? `تونل بالا نیامد: ${reason}`
        : `تونل بسته شد (کد ${code ?? '-'}) — دوباره تلاش می‌شود`,
      diagnosis: diag,
    });
    logEvent('warn', 'panel', `تونل بسته شد (کد ${code})${reason ? ` — ${reason}` : ''}`);

    // خرابیِ رایج: فایل اعتبار جابه‌جا شده — یک‌بار خودکار درستش می‌کنیم
    if (diag.problems.some((p) => p.fixable) && !state.repairTried) {
      state.repairTried = true;
      logEvent('info', 'panel', 'تلاش خودکار برای بازسازی پیکربندی تونل');
      repairTunnel().catch(() => {});
      return;
    }
    restartTimer = setTimeout(() => startTunnel({ port: targetPort }), 10000);
    restartTimer.unref?.();
  });

  return publicState();
}

export function stopTunnel() {
  stopping = true;
  generation++; // هر چه از این به بعد از پروسهٔ قبلی برسد، نادیده گرفته می‌شود
  clearTimeout(restartTimer);
  if (child) {
    try {
      child.kill();
    } catch { /* بسته شده */ }
    child = null;
  }
  setStatus('stopped', { url: null, error: null });
  return publicState();
}

export function tunnelRunning() {
  return Boolean(child) && state.status === 'running';
}

// آدرس عمومیِ آمادهٔ استفاده در سایت
export function tunnelWss() {
  return state.url ? state.url.replace(/^https:/, 'wss:') : null;
}

export function localHint() {
  const iface = Object.values(os.networkInterfaces())
    .flat()
    .find((ni) => ni && !ni.internal && (ni.family === 'IPv4' || ni.family === 4));
  return iface?.address || null;
}
