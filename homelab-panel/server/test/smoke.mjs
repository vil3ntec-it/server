// ---------------------------------------------------------------------------
// آزمون سرتاسری API — سرور واقعی بالا می‌آید و همهٔ بخش‌ها تست می‌شوند
//   node test/smoke.mjs
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

const PORT = Number(process.env.TEST_PORT || 4791);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-test-'));
const dataDir = path.join(tmp, 'data');
const sitesRoot = path.join(tmp, 'sites');
fs.mkdirSync(sitesRoot, { recursive: true });

// یک سایت استاتیک واقعی می‌سازیم تا کشف خودکار چیزی برای پیدا کردن داشته باشد
fs.mkdirSync(path.join(sitesRoot, 'shop'), { recursive: true });
fs.writeFileSync(path.join(sitesRoot, 'shop', 'index.html'), '<h1>shop</h1>', 'utf8');

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
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', serverPath], {
  env: {
    ...process.env,
    HLP_PORT: String(PORT),
    HLP_HOST: '127.0.0.1',
    HLP_DATA_DIR: dataDir,
    HLP_SITES_ROOT: sitesRoot,
    HLP_METRICS_INTERVAL: '700',
    HLP_TUNNEL: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOut = '';
child.stdout.on('data', (d) => (serverOut += d));
child.stderr.on('data', (d) => (serverOut += d));

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
  const headers = {};
  if (token && !opts.noAuth) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    if (opts.raw) {
      payload = body;
      if (opts.contentType) headers['Content-Type'] = opts.contentType;
    } else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch { /* پاسخ JSON نبود */ }
  return { status: res.status, json, text };
}

async function main() {
  console.log('\n▶ راه‌اندازی سرور آزمایشی...');
  if (!(await waitForServer())) {
    console.log(serverOut);
    throw new Error('سرور بالا نیامد');
  }

  console.log('\n── سلامت و احراز هویت ──');
  let r = await api('GET', '/health');
  check('GET /health', r.status === 200 && r.json?.ok === true);
  check('پاسخ /health برای سایت سازگار است', r.json?.service === 'pump-yaqobi-server');

  r = await api('GET', '/api/auth/status');
  check('پنل هنوز راه‌اندازی نشده', r.json?.initialized === false);

  r = await api('GET', '/api/dashboard');
  check('بدون توکن دسترسی نیست (۴۰۱)', r.status === 401);

  r = await api('POST', '/api/auth/setup', { username: 'admin', password: 'short' });
  check('رمز کوتاه رد می‌شود', r.status === 400);

  r = await api('POST', '/api/auth/setup', { username: 'admin', password: 'HomeServer!2026' });
  check('ساخت حساب مدیر', r.status === 200 && Boolean(r.json?.token));
  token = r.json?.token;

  r = await api('POST', '/api/auth/login', { username: 'admin', password: 'wrong-pass' }, { noAuth: true });
  check('ورود با رمز غلط رد می‌شود', r.status === 401);

  r = await api('POST', '/api/auth/login', { username: 'admin', password: 'HomeServer!2026' });
  check('ورود با رمز درست', r.status === 200 && Boolean(r.json?.token));
  token = r.json.token;

  r = await api('GET', '/api/auth/me');
  check('GET /api/auth/me', r.json?.user?.username === 'admin');

  console.log('\n── داشبورد و معیارهای واقعی ──');
  r = await api('GET', '/api/dashboard');
  const d = r.json;
  check('داشبورد پاسخ می‌دهد', r.status === 200);
  check('CPU واقعی خوانده شد', typeof d?.cpu?.usage === 'number' && d.cpu.count === os.cpus().length);
  check('RAM واقعی خوانده شد', d?.memory?.total === os.totalmem());
  check('دیسک واقعی خوانده شد', typeof d?.disk?.total === 'number' && d.disk.total > 0);
  check('مدت روشن بودن سرور واقعی است', Math.abs(d?.server?.uptimeSeconds - os.uptime()) < 10);
  check('نام میزبان واقعی است', d?.server?.hostname === os.hostname());
  check('وضعیت دما گزارش شده', typeof d?.temperature?.supported === 'boolean');
  check('شمارش سایت/دامنه موجود است', typeof d?.counts?.sites === 'number' && typeof d?.counts?.domains === 'number');

  console.log('\n── سایت‌ها ──');
  r = await api('POST', '/api/sites/discover');
  const found = r.json?.found || [];
  check('کشف خودکار سایت‌ها', found.some((f) => f.path.endsWith('shop')));

  r = await api('POST', '/api/sites/discover/import', {
    items: found.filter((f) => f.path.endsWith('shop')),
  });
  check('افزودن سایت کشف‌شده', r.json?.added?.length === 1);
  const siteId = r.json.added[0].id;
  const sitePort = r.json.added[0].port;

  r = await api('POST', '/api/sites/create', { name: 'blog', kind: 'static' });
  check('ساخت سایت جدید با پوشهٔ مستقل', r.status === 200 && Boolean(r.json?.site));
  const blogSlug = r.json?.site?.slug;
  check(
    'پوشهٔ مستقل سایت روی دیسک ساخته شد',
    fs.existsSync(path.join(sitesRoot, 'blog', 'index.html'))
  );
  check(
    'فضای کاری اختصاصی سایت (لاگ/بکاپ/دیتابیس) ساخته شد',
    fs.existsSync(path.join(dataDir, 'sites', blogSlug, 'logs')) &&
      fs.existsSync(path.join(dataDir, 'sites', blogSlug, 'backups')) &&
      fs.existsSync(path.join(dataDir, 'sites', blogSlug, 'db'))
  );

  r = await api('GET', '/api/sites');
  check('فهرست سایت‌ها', r.json?.sites?.length === 2);
  const shop = r.json.sites.find((s) => s.id === siteId);
  check('حجم واقعی فایل‌های سایت محاسبه شد', shop?.sizeBytes > 0);
  check('سایت قبل از اجرا آفلاین است', shop?.online === false);

  r = await api('POST', `/api/sites/${siteId}/start`);
  check('اجرای سایت (Start)', r.status === 200 && r.json?.ok === true);
  await new Promise((res) => setTimeout(res, 1200));

  const siteRes = await fetch(`http://127.0.0.1:${sitePort}/`);
  const siteBody = await siteRes.text();
  check('سایت واقعاً روی پورت خودش سرو می‌شود', siteRes.status === 200 && siteBody.includes('shop'));

  r = await api('GET', `/api/sites/${siteId}`);
  check('سایت اکنون آنلاین است', r.json?.site?.online === true);
  check('پروسه مدیریت‌شده است', Boolean(r.json?.site?.process?.pid));

  r = await api('GET', `/api/sites/${siteId}/logs`);
  check('لاگ اختصاصی سایت ثبت شده', (r.json?.lines || []).length > 0);

  r = await api('POST', `/api/sites/${siteId}/restart`);
  check('راه‌اندازی مجدد سایت (Restart)', r.json?.ok === true);
  await new Promise((res) => setTimeout(res, 1200));

  r = await api('POST', `/api/sites/${siteId}/stop`);
  check('توقف سایت (Stop)', r.json?.ok === true);
  await new Promise((res) => setTimeout(res, 400));
  const stoppedOk = await fetch(`http://127.0.0.1:${sitePort}/`).then(
    () => false,
    () => true
  );
  check('بعد از Stop پورت واقعاً بسته است', stoppedOk);

  console.log('\n── دامنه‌ها ──');
  r = await api('POST', '/api/domains', { name: 'example.com', siteId });
  check('افزودن دامنه', r.status === 200);
  r = await api('POST', '/api/domains', { name: 'not a domain' });
  check('دامنهٔ نامعتبر رد می‌شود', r.status === 400);
  r = await api('GET', '/api/domains');
  check('فهرست دامنه‌ها', r.json?.domains?.length === 1 && r.json.domains[0].siteName);

  console.log('\n── فایل‌منیجر ──');
  r = await api('GET', `/api/files/list?path=${encodeURIComponent(sitesRoot)}`);
  check('فهرست فایل‌ها', r.json?.items?.some((i) => i.name === 'shop' && i.isDir));

  r = await api('GET', `/api/files/list?path=${encodeURIComponent('/etc')}`);
  check('مسیر خارج از ریشه‌های مجاز رد می‌شود', r.status === 403);

  r = await api('GET', `/api/files/list?path=${encodeURIComponent(path.join(sitesRoot, 'shop', '..', '..', '..'))}`);
  check('حملهٔ ../ خنثی می‌شود', r.status === 403);

  r = await api('POST', '/api/files/mkdir', { path: path.join(sitesRoot, 'shop'), name: 'assets' });
  check('ساخت پوشه', r.status === 200 && fs.existsSync(path.join(sitesRoot, 'shop', 'assets')));

  r = await api(
    'PUT',
    `/api/files/upload?dir=${encodeURIComponent(path.join(sitesRoot, 'shop', 'assets'))}&name=style.css`,
    'body{margin:0}',
    { raw: true, contentType: 'text/css' }
  );
  check('آپلود فایل', r.status === 200 && fs.existsSync(path.join(sitesRoot, 'shop', 'assets', 'style.css')));

  r = await api('GET', `/api/files/read?path=${encodeURIComponent(path.join(sitesRoot, 'shop', 'assets', 'style.css'))}`);
  check('خواندن فایل', r.json?.content === 'body{margin:0}');

  r = await api('PUT', '/api/files/write', {
    path: path.join(sitesRoot, 'shop', 'assets', 'style.css'),
    content: 'body{margin:8px}',
  });
  check('ویرایش فایل', r.status === 200 && fs.readFileSync(path.join(sitesRoot, 'shop', 'assets', 'style.css'), 'utf8') === 'body{margin:8px}');

  r = await api('POST', '/api/files/rename', {
    path: path.join(sitesRoot, 'shop', 'assets', 'style.css'),
    newName: 'main.css',
  });
  check('تغییر نام', r.status === 200 && fs.existsSync(path.join(sitesRoot, 'shop', 'assets', 'main.css')));

  r = await api('POST', '/api/files/copy', {
    from: path.join(sitesRoot, 'shop', 'assets', 'main.css'),
    to: path.join(sitesRoot, 'blog'),
  });
  check('کپی', r.status === 200 && fs.existsSync(path.join(sitesRoot, 'blog', 'main.css')));

  r = await api('POST', '/api/files/move', {
    from: path.join(sitesRoot, 'blog', 'main.css'),
    to: path.join(sitesRoot, 'shop'),
  });
  check('انتقال', r.status === 200 && fs.existsSync(path.join(sitesRoot, 'shop', 'main.css')));

  r = await api('GET', `/api/files/search?path=${encodeURIComponent(sitesRoot)}&q=main`);
  check('جستجو', r.json?.results?.some((x) => x.name === 'main.css'));

  r = await api('DELETE', `/api/files?path=${encodeURIComponent(path.join(sitesRoot, 'shop', 'main.css'))}`);
  check('حذف', r.status === 200 && !fs.existsSync(path.join(sitesRoot, 'shop', 'main.css')));

  r = await api('GET', `/api/files/download?path=${encodeURIComponent(path.join(sitesRoot, 'shop', 'index.html'))}`);
  check('دانلود', r.status === 200 && r.text.includes('shop'));

  console.log('\n── شبکه ──');
  r = await api('GET', '/api/network');
  check('اطلاعات شبکه', Array.isArray(r.json?.interfaces));
  check('MAC واقعی خوانده شد', r.json?.interfaces.length === 0 || typeof r.json.interfaces[0].mac === 'string');
  check('سرعت دانلود/آپلود گزارش می‌شود', typeof r.json?.throughput?.supported === 'boolean');

  console.log('\n── تنظیمات ──');
  r = await api('PUT', '/api/settings', { serverName: 'سرور خانه', language: 'fa', theme: 'light' });
  check('ذخیرهٔ تنظیمات', r.status === 200);
  r = await api('GET', '/api/settings/public', undefined, { noAuth: true });
  check('نام سرور ذخیره شد', r.json?.serverName === 'سرور خانه');

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  r = await api('PUT', '/api/settings/logo', png, { raw: true, contentType: 'image/png' });
  check('آپلود لوگو', r.status === 200);
  const logoRes = await fetch(`${BASE}/api/settings/logo`);
  check('لوگو سرو می‌شود', logoRes.status === 200);

  console.log('\n── لاگ‌ها ──');
  r = await api('GET', '/api/logs');
  check('لاگ رویدادها ثبت می‌شود', (r.json?.events || []).length > 0);
  r = await api('GET', '/api/logs?level=error');
  check('فیلتر سطح لاگ', Array.isArray(r.json?.events));

  console.log('\n── سرورِ سایت (یکی شدن با سرور برنامهٔ پمپ) ──');
  r = await api('GET', '/api/site-server');
  check('صفحهٔ سرور سایت فعال است', r.json?.enabled === true);
  check('آدرس‌های اتصال ساخته شده', r.json?.addresses?.some((a) => a.ws.startsWith('ws://')));
  check('رمز به‌صورت پنهان نمایش داده می‌شود', typeof r.json?.tokenPreview === 'string' && r.json.tokenPreview.includes('•'));

  // آدرس سایت — قابل تغییر، چون ممکن است دامنه عوض شود
  check('آدرس سایت برگردانده می‌شود', /^https?:\/\//i.test(r.json?.siteUrl || ''));
  const oldSiteUrl = r.json.siteUrl;
  r = await api('PUT', '/api/site-server/site-url', { siteUrl: 'https://dolatipump.top/' });
  check('آدرس سایت عوض می‌شود', r.status === 200 && r.json?.siteUrl === 'https://dolatipump.top');
  r = await api('PUT', '/api/site-server/site-url', { siteUrl: 'salam' });
  check('آدرس بی‌اعتبار رد می‌شود', r.status === 400);
  r = await api('GET', '/api/site-server');
  check('آدرس تازه ذخیره مانده', r.json?.siteUrl === 'https://dolatipump.top');
  await api('PUT', '/api/site-server/site-url', { siteUrl: oldSiteUrl });

  r = await api('GET', '/api/site-server/token');
  const syncToken = r.json?.token;
  check('رمز کامل قابل دریافت است', typeof syncToken === 'string' && syncToken.length > 20);

  // اتصال واقعی با پروتکل سایت روی همان پورت پنل
  const wsOk = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${syncToken}`);
    const steps = { connected: false, ack: false, value: false, get: false };
    const timer = setTimeout(() => {
      ws.close();
      resolve(steps);
    }, 6000);
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.op === 'connected') {
        steps.connected = true;
        ws.send(JSON.stringify({ op: 'sub', path: 'testBranch', event: 'value', subId: 's1' }));
        ws.send(JSON.stringify({ op: 'set', path: 'testBranch/hello', value: 'دنیا', id: 1 }));
      }
      if (m.op === 'ack' && m.id === 1) {
        steps.ack = true;
        ws.send(JSON.stringify({ op: 'get', path: 'testBranch/hello', id: 2 }));
      }
      if (m.op === 'event' && m.type === 'value' && m.value?.hello === 'دنیا') steps.value = true;
      if (m.op === 'result' && m.id === 2 && m.value === 'دنیا') {
        steps.get = true;
        clearTimeout(timer);
        ws.close();
        resolve(steps);
      }
    });
    ws.on('error', () => {
      clearTimeout(timer);
      resolve(steps);
    });
  });
  check('سایت با همان آدرس پنل وصل می‌شود (WebSocket)', wsOk.connected);
  check('نوشتن داده از سمت سایت کار می‌کند', wsOk.ack);
  check('رویداد بلادرنگ value دریافت شد', wsOk.value);
  check('خواندن داده کار می‌کند', wsOk.get);

  const badWs = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=wrong-token`);
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.op === 'error' && m.msg === 'auth_failed') {
        ws.close();
        resolve(true);
      }
    });
    ws.on('error', () => resolve(false));
    setTimeout(() => resolve(false), 4000);
  });
  check('اتصال با رمز غلط رد می‌شود', badWs);

  r = await api('GET', '/api/site-server');
  check('دادهٔ سایت در همان پنل دیده می‌شود', r.json?.branches?.some((b) => b.key === 'testBranch'));

  console.log('\n── خروج ──');
  r = await api('POST', '/api/auth/logout');
  check('خروج', r.status === 200);
  r = await api('GET', '/api/dashboard');
  check('توکن بعد از خروج بی‌اعتبار است', r.status === 401);
}

try {
  await main();
} catch (e) {
  failed++;
  console.log(`\n❌ خطای غیرمنتظره: ${e.stack}`);
  console.log(serverOut.slice(-3000));
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 800));
  child.kill('SIGKILL');
  await fsp.rm(tmp, { recursive: true, force: true });
}

console.log(`\n════════════════════════════════════`);
console.log(`  موفق: ${passed}    ناموفق: ${failed}`);
console.log(`════════════════════════════════════\n`);
process.exit(failed ? 1 : 0);
