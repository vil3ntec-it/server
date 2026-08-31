// ---------------------------------------------------------------------------
//  آزمونِ زیرساخت — نسخه‌بندیِ API، سلامت، امنیت، نقش‌ها، مهاجرت و بکاپ
//
//  سرورِ واقعی بالا می‌آید و همه‌چیز از راهِ HTTP آزموده می‌شود:
//      node test/platform.mjs
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PORT = Number(process.env.TEST_PORT || 4793);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-platform-'));
const dataDir = path.join(tmp, 'data');
const sitesRoot = path.join(tmp, 'sites');
fs.mkdirSync(sitesRoot, { recursive: true });

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`);
  }
};

const serverPath = path.join(import.meta.dirname, '..', 'src', 'index.js');
const baseEnv = {
  ...process.env,
  HLP_PORT: String(PORT),
  HLP_HOST: '127.0.0.1',
  HLP_DATA_DIR: dataDir,
  HLP_SITES_ROOT: sitesRoot,
  HLP_METRICS_INTERVAL: '700',
  HLP_TUNNEL: '0',
  HLP_SITESYNC: '0',
  HLP_AI_ENABLED: '0',
  HLP_DOMAIN: 'yourdomain.com',
  HLP_AUTH_RATE_LIMIT: '4',
};

let child = null;
function startServer(extraEnv = {}) {
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', serverPath], {
    env: { ...baseEnv, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => (serverOut += d));
  child.stderr.on('data', (d) => (serverOut += d));
}
let serverOut = '';

async function stopServer() {
  if (!child) return;
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 900));
  child.kill('SIGKILL');
  child = null;
}

async function waitForServer(timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return true;
    } catch { /* هنوز بالا نیامده */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

let token = null;
async function api(method, url, body, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const auth = opts.token !== undefined ? opts.token : token;
  if (auth && !opts.noAuth) headers.Authorization = `Bearer ${auth}`;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch { /* JSON نبود */ }
  return { status: res.status, json, text, headers: res.headers };
}

async function main() {
  console.log('\n▶ راه‌اندازی سرور آزمایشی...');
  startServer();
  if (!(await waitForServer())) {
    console.log(serverOut);
    throw new Error('سرور بالا نیامد');
  }

  // ── مهاجرت ────────────────────────────────────────────────────────────
  console.log('\n── مهاجرتِ اسکیما ──');
  const dbFile = path.join(dataDir, 'panel.db');
  const probe = new DatabaseSync(dbFile, { readOnly: true });
  const versions = probe.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all();
  check('جدولِ schema_migrations ساخته شد', versions.length >= 3);
  check('مهاجرت‌ها به ترتیب ثبت شدند', versions[0]?.version === 1 && versions[0]?.name === 'initial');
  const userCols = probe.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  check('ستونِ نقش اضافه شد', userCols.includes('role') && userCols.includes('disabled'));
  probe.close();

  // ── سلامت ─────────────────────────────────────────────────────────────
  console.log('\n── سلامت و آمادگی ──');
  let r = await api('GET', '/health');
  check('GET /health بدونِ احراز هویت', r.status === 200 && r.json?.ok === true);
  check('پاسخِ /health برای سایت سازگار مانده', r.json?.service === 'pump-yaqobi-server');

  r = await api('GET', '/ready');
  check('GET /ready بدونِ احراز هویت', r.status === 200 && r.json?.ready === true);
  check('/ready دیتابیس را واقعاً می‌زند', r.json?.checks?.some((c) => c.name === 'database' && c.ok));
  check('/ready نوشتن روی دیسک را می‌زند', r.json?.checks?.some((c) => c.name === 'storage' && c.ok));
  check('/ready هیچ مسیرِ فایلی لو نمی‌دهد', !r.text.includes(dataDir));

  // ── هدرهای امن ────────────────────────────────────────────────────────
  console.log('\n── هدرهای امن ──');
  r = await api('GET', '/health');
  check('X-Content-Type-Options', r.headers.get('x-content-type-options') === 'nosniff');
  check('X-Frame-Options', r.headers.get('x-frame-options') === 'SAMEORIGIN');
  check('Referrer-Policy', r.headers.get('referrer-policy') === 'strict-origin-when-cross-origin');
  check('روی http هدرِ HSTS گذاشته نمی‌شود', !r.headers.get('strict-transport-security'));

  // ── CORS ──────────────────────────────────────────────────────────────
  console.log('\n── CORS با فهرستِ سفید ──');
  r = await api('GET', '/health', undefined, { headers: { Origin: 'https://admin.yourdomain.com' } });
  check('زیردامنهٔ خودمان مجاز است', r.headers.get('access-control-allow-origin') === 'https://admin.yourdomain.com');

  r = await api('GET', '/health', undefined, { headers: { Origin: 'http://192.168.1.50:4700' } });
  check('شبکهٔ خانگی مجاز است', r.headers.get('access-control-allow-origin') === 'http://192.168.1.50:4700');

  r = await api('GET', '/health', undefined, { headers: { Origin: 'https://evil.com' } });
  check('مبدأِ ناشناس بازتاب نمی‌شود', !r.headers.get('access-control-allow-origin'));

  r = await api('GET', '/health', undefined, { headers: { Origin: 'https://yourdomain.com.evil.com' } });
  check('دامنهٔ شبیه‌سازی‌شده رد می‌شود', !r.headers.get('access-control-allow-origin'));

  r = await api('OPTIONS', '/api/v1/auth/login', undefined, {
    headers: { Origin: 'https://evil.com', 'Access-Control-Request-Method': 'POST' },
  });
  check('preflightِ مبدأِ ناشناس ۴۰۳ می‌گیرد', r.status === 403);

  // ── نسخه‌بندی ─────────────────────────────────────────────────────────
  console.log('\n── نسخه‌بندیِ API ──');
  r = await api('POST', '/api/v1/auth/setup', { username: 'admin', password: 'HomeServer!2026' });
  check('ساخت حساب مدیر از راه v1', r.status === 200 && Boolean(r.json?.token));
  check('اولین کاربر admin است', r.json?.user?.role === 'admin');
  token = r.json.token;

  r = await api('GET', '/api/v1/dashboard');
  check('GET /api/v1/dashboard', r.status === 200);
  check('v1 هدرِ Deprecation ندارد', !r.headers.get('deprecation'));

  r = await api('GET', '/api/dashboard');
  check('مسیرِ قدیمیِ /api هنوز کار می‌کند', r.status === 200);
  check('مسیرِ قدیمی Deprecation می‌گیرد', r.headers.get('deprecation') === 'true');
  check('مسیرِ قدیمی جانشینش را معرفی می‌کند', String(r.headers.get('link')).includes('/api/v1/dashboard'));

  r = await api('GET', '/api/v1/services');
  check('نامِ services به سایت‌ها می‌رسد', r.status === 200 && Array.isArray(r.json?.sites));

  r = await api('GET', '/api/v1/no-such-route');
  check('مسیرِ ناشناس در v1 → ۴۰۴ JSON', r.status === 404 && r.json?.error === 'not_found');

  // ── وضعیتِ زیرساخت ────────────────────────────────────────────────────
  console.log('\n── /api/v1/system ──');
  r = await api('GET', '/api/v1/system');
  check('وضعیتِ زیرساخت برمی‌گردد', r.status === 200);
  check('دامنه از پیکربندی خوانده شده', r.json?.domain?.api === 'api.yourdomain.com');
  check('آدرسِ کلاینت‌ها اعلام می‌شود', r.json?.domain?.apiUrl === 'https://api.yourdomain.com');
  check('نسخهٔ اسکیما گزارش می‌شود', typeof r.json?.service?.schemaVersion === 'number');
  check('هیچ رازی بیرون نمی‌رود', !/jwt_secret|password_hash/.test(r.text));

  // ── نقش‌ها ────────────────────────────────────────────────────────────
  console.log('\n── نقش‌ها ──');
  r = await api('POST', '/api/v1/users', { username: 'viewer1', password: 'ViewerPass!1', role: 'viewer' });
  check('مدیر کاربرِ viewer می‌سازد', r.status === 200 && r.json?.user?.role === 'viewer');

  r = await api('POST', '/api/v1/users', { username: 'oper1', password: 'OperPass!12', role: 'operator' });
  check('مدیر کاربرِ operator می‌سازد', r.status === 200);

  r = await api('GET', '/api/v1/users');
  check('رمزِ هش‌شده هرگز بیرون نمی‌رود', !r.text.includes('password_hash'));

  const viewerToken = (await api('POST', '/api/v1/auth/login', { username: 'viewer1', password: 'ViewerPass!1' }, { noAuth: true })).json.token;
  const operToken = (await api('POST', '/api/v1/auth/login', { username: 'oper1', password: 'OperPass!12' }, { noAuth: true })).json.token;

  r = await api('GET', '/api/v1/dashboard', undefined, { token: viewerToken });
  check('viewer داشبورد را می‌بیند', r.status === 200);

  r = await api('POST', '/api/v1/sites/create', { name: 'x', kind: 'static' }, { token: viewerToken });
  check('viewer نمی‌تواند سایت بسازد', r.status === 403);

  r = await api('GET', '/api/v1/files/list?path=' + encodeURIComponent(sitesRoot), undefined, { token: viewerToken });
  check('viewer به فایل‌منیجر نمی‌رسد', r.status === 403);

  r = await api('GET', '/api/v1/users', undefined, { token: viewerToken });
  check('viewer کاربران را نمی‌بیند', r.status === 403);

  r = await api('PUT', '/api/v1/settings', { serverName: 'hacked' }, { token: operToken });
  check('operator تنظیمات را عوض نمی‌کند', r.status === 403);

  r = await api('GET', '/api/v1/files/list?path=' + encodeURIComponent(sitesRoot), undefined, { token: operToken });
  check('operator به فایل‌منیجر می‌رسد', r.status === 200);

  // نرده‌های محافظ
  r = await api('PUT', '/api/v1/users/1', { role: 'viewer' });
  check('مدیر نمی‌تواند خودش را تنزل بدهد', r.status === 400 && r.json?.error === 'cannot_demote_self');
  r = await api('DELETE', '/api/v1/users/1');
  check('مدیر نمی‌تواند خودش را حذف کند', r.status === 400);

  // بستنِ حساب باید فوری اثر کند
  const viewerId = (await api('GET', '/api/v1/users')).json.users.find((u) => u.username === 'viewer1').id;
  await api('PUT', `/api/v1/users/${viewerId}`, { disabled: true });
  r = await api('GET', '/api/v1/dashboard', undefined, { token: viewerToken });
  check('بستنِ حساب نشستِ فعال را همان لحظه باطل می‌کند', r.status === 401);
  r = await api('POST', '/api/v1/auth/login', { username: 'viewer1', password: 'ViewerPass!1' }, { noAuth: true });
  check('حسابِ بسته‌شده نمی‌تواند وارد شود', r.status === 403 && r.json?.error === 'account_disabled');

  // ── اعتبارسنجی ────────────────────────────────────────────────────────
  console.log('\n── اعتبارسنجیِ ورودی ──');
  r = await api('POST', '/api/v1/users', { username: 'ok', password: 'x' });
  check('رمزِ کوتاه ۴۰۰ می‌دهد نه ۵۰۰', r.status === 400 && r.json?.error === 'invalid_input');
  r = await api('POST', '/api/v1/users', { username: 'bad name!', password: 'GoodPass!123' });
  check('نامِ کاربریِ نامعتبر رد می‌شود', r.status === 400);
  r = await api('POST', '/api/v1/users', { username: 'okname', password: 'GoodPass!123', role: 'superuser' });
  check('نقشِ ناشناس رد می‌شود', r.status === 400);

  // ── بکاپ ──────────────────────────────────────────────────────────────
  console.log('\n── بکاپ ──');
  r = await api('POST', '/api/v1/backups', { note: 'آزمون' });
  check('گرفتنِ بکاپِ دستی', r.status === 200 && Boolean(r.json?.backup?.file));
  const backupFile = r.json.backup.file;
  check('فایلِ بکاپ واقعاً روی دیسک است', fs.existsSync(path.join(dataDir, 'backups', backupFile)));

  const backupDb = new DatabaseSync(path.join(dataDir, 'backups', backupFile), { readOnly: true });
  check('بکاپ یک دیتابیسِ خواندنی و کامل است',
    backupDb.prepare('SELECT COUNT(*) AS n FROM users').get().n >= 1);
  backupDb.close();

  r = await api('GET', '/api/v1/backups');
  check('فهرستِ بکاپ‌ها', r.status === 200 && r.json?.backups?.length >= 1);
  check('کهنگیِ آخرین بکاپ گزارش می‌شود', typeof r.json?.ageHours === 'number');

  r = await api('POST', '/api/v1/backups/..%2f..%2fpasswd/restore');
  check('مسیرِ ../ در نامِ بکاپ رد می‌شود', r.status === 400);

  fs.writeFileSync(path.join(dataDir, 'backups', 'panel-20200101-000000-manual.db'), 'not a database');
  r = await api('POST', '/api/v1/backups/panel-20200101-000000-manual.db/restore');
  check('فایلِ خراب بازگردانده نمی‌شود', r.status === 400 && r.json?.error === 'corrupt_backup');

  r = await api('POST', `/api/v1/backups/${backupFile}/restore`, undefined, { token: operToken });
  check('operator نمی‌تواند بازگردانی کند', r.status === 403);

  // ── بازگردانیِ واقعی ───────────────────────────────────────────────────
  console.log('\n── بازگردانیِ واقعی ──');
  await api('POST', '/api/v1/users', { username: 'after_backup', password: 'AfterPass!12', role: 'viewer' });
  r = await api('GET', '/api/v1/users');
  check('کاربرِ بعد از بکاپ ساخته شد', r.json.users.some((u) => u.username === 'after_backup'));

  r = await api('POST', `/api/v1/backups/${backupFile}/restore`);
  check('بازگردانی زمان‌بندی می‌شود', r.status === 200 && r.json?.pending === true);
  check('پیش از بازگردانی بکاپِ ایمنی گرفته می‌شود', Boolean(r.json?.safetyCopy));

  await stopServer();
  startServer();
  if (!(await waitForServer())) throw new Error('سرور بعد از بازگردانی بالا نیامد');

  token = (await api('POST', '/api/v1/auth/login', { username: 'admin', password: 'HomeServer!2026' }, { noAuth: true })).json.token;
  r = await api('GET', '/api/v1/users');
  check('بعد از راه‌اندازیِ دوباره بازگردانی اعمال شد',
    !r.json.users.some((u) => u.username === 'after_backup'));
  check('مدیر بعد از بازگردانی هست', r.json.users.some((u) => u.username === 'admin'));

  // ── محدودیتِ نرخ ──────────────────────────────────────────────────────
  console.log('\n── محدودیتِ نرخ روی ورود ──');
  let limited = null;
  for (let i = 0; i < 8; i++) {
    const res = await api('POST', '/api/v1/auth/login', { username: 'admin', password: 'wrong' }, { noAuth: true });
    if (res.status === 429) {
      limited = res;
      break;
    }
  }
  check('پس از چند رمزِ غلط ۴۲۹ می‌دهد', limited?.status === 429);
  check('Retry-After اعلام می‌شود', Boolean(limited?.headers.get('retry-after')));
}

try {
  await main();
} catch (e) {
  failed++;
  console.log(`\n❌ خطای غیرمنتظره: ${e.stack}`);
  console.log(serverOut.slice(-3000));
} finally {
  await stopServer();
  await fsp.rm(tmp, { recursive: true, force: true });
}

console.log(`\n════════════════════════════════════`);
console.log(`  موفق: ${passed}    ناموفق: ${failed}`);
console.log(`════════════════════════════════════\n`);
process.exit(failed ? 1 : 0);
