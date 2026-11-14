// ---------------------------------------------------------------------------
//  🏪 ساختِ جدای «فروشگاه» در کرومیومِ واقعی — سایتِ ایستای جدا، با همان پل      CHROME_PATH=… node test/shop-standalone-ui.mjs
//
//  پنلِ واقعی (فقط برای ‎/api/*‎) + سرورِ حسابِ ساختگیِ کمینه + یک سرورِ ایستای جدا که فقط ‎web/dist/shop-standalone/‎ را
//  می‌دهد و ‎/api‎ را به پنل می‌فرستد (همان کاری که یک پراکسیِ معکوس یا برنامهٔ دسکتاپ می‌کند). می‌سنجد که:
//    ⛔ ساخت سبز است (‎npm run build:shop-standalone‎) و صفحه از پوشهٔ جدا می‌آید، نه از ‎server/public‎؛
//    ⛔ ورود با همان حسابِ پنل (و رمزِ غلط پیامِ خودش را دارد)، نشست با بارگذاریِ دوباره می‌ماند، خروج کار می‌کند؛
//    ⛔ پوستهٔ فروشگاه با منوی ماژول‌ها از سرور، ماژول با کلیک باز می‌شود؛
//    ⛔ هیچ منو یا پیوندی از پنل (ترمینال، فایل‌ها، پمپ‌ها…) و بی بخشِ «کاربرانِ پنل» (‎PanelUsers = null‎)؛
//    ⛔ هیچ خطای جاوااسکریپت.
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const { chromium } = await import('playwright-core').catch(() => {
  throw new Error('playwright-core نصب نیست: در پوشهٔ server دستور «npm install --include=dev» را بزنید');
});
const CHROME = process.env.CHROME_PATH
  || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome', '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome']
    .find((p) => fs.existsSync(p));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 400)}`);
};

/* ── ۱) ساختِ جدا ── */
const WEB = path.resolve(import.meta.dirname, '..', '..', 'web');
const DIST = path.join(WEB, 'dist', 'shop-standalone');
if (process.env.SHOP_STANDALONE_SKIP_BUILD !== '1') {
  console.log('\n── ساختِ جدا (npm run build:shop-standalone) ──');
  const b = spawnSync('npm', ['run', 'build:shop-standalone'], { cwd: WEB, encoding: 'utf8' });
  check('npm run build:shop-standalone سبز', b.status === 0, (b.stdout + b.stderr).slice(-600));
}
check('سایتِ ایستا در پوشهٔ جدا هست', fs.existsSync(path.join(DIST, 'index.html')));

/* ── ۲) سرورِ حسابِ ساختگیِ کمینه ── */
const NOW = Date.now();
const fake = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
  req.resume();
  req.on('end', () => {
    if (p === '/api/health') return j(200, { ok: true, server: 'online', version: '2.14.4' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { id: 'adm1', role: 'owner', capabilities: [] });
    if (p === '/api/admin/shops') return j(200, { shops: [], total: 0 });
    return j(404, { error: { code: 'not_found', message: 'این مسیر وجود ندارد' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

/* ── ۳) پنلِ واقعی (فقط به‌عنوانِ ‎/api‎) ── */
const PORT = Number(process.env.TEST_PORT || 4989);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'shop-standalone-ui-'));
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
  env: { ...process.env, HLP_PORT: String(PORT), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: path.join(tmp, 'data'),
         HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_SITESYNC: '0', HLP_AI_ENABLED: '0', HLP_TUNNEL: '0',
         HLP_AUTOMATION: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_ACCOUNT_API: `http://127.0.0.1:${fake.address().port}`,
         HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

/* ── ۴) سرورِ ایستای جدا: پوشهٔ ساخت + ‎/api‎ به پنل ── */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json' };
const served = [];
const site = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    const up = http.request(`${BASE}${req.url}`, { method: req.method, headers: { ...req.headers, host: `127.0.0.1:${PORT}` } }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on('error', () => { res.statusCode = 502; res.end(); });
    req.pipe(up);
    return;
  }
  let f = path.join(DIST, path.normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, ''));
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');   //  مسیرهای SPA
  served.push(path.relative(DIST, f));
  res.setHeader('content-type', TYPES[path.extname(f)] || 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${site.address().port}`;

let browser;
const jsErrors = [];
try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  //  نخستین مدیر از همین کامپیوتر (همان راهِ برنامهٔ ویندوز) — ورود در خودِ ساختِ جدا سنجیده می‌شود
  const setup = await fetch(`${BASE}/api/auth/setup`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Standalone!2026' }) });
  check('نخستین مدیرِ پنل ساخته شد', setup.ok, String(setup.status));

  if (!CHROME) throw new Error('کرومیوم پیدا نشد — CHROME_PATH را بگذارید');
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', (e) => jsErrors.push(String(e.message)));
  //  ۴۰۱ ِ رمزِ غلط و ۴xx/۵xx ِ سرورِ حسابِ ساختگیِ کمینه فقط پیامِ شبکهٔ مرورگرند، نه خطای JS
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*\b(4\d\d|5\d\d)\b/.test(m.text())) jsErrors.push(m.text()); });

  console.log('\n── ورود ──');
  await page.goto(SITE, { waitUntil: 'networkidle' });
  check('صفحهٔ ورودِ خودِ ساختِ جدا (نه صفحهٔ پنل)', await page.locator('form input[autocomplete="username"]').count() === 1
    && /فروشگاه/.test(await page.locator('form h1').innerText()));
  check('صفحه راست‌چین است', (await page.evaluate(() => document.documentElement.dir)) === 'rtl');
  check('⛔ صفحه از پوشهٔ جدا آمد (index.html و assets ِ dist/shop-standalone)', served.includes('index.html') && served.some((f) => f.startsWith('assets/')));

  await page.fill('input[autocomplete="username"]', 'admin');
  await page.fill('input[type="password"]', 'wrong-password');
  await page.locator('form button').first().click();
  await page.waitForSelector('[role="alert"]', { timeout: 10000 });
  check('رمزِ غلط ⇒ پیامِ خطا و هنوز صفحهٔ ورود', /\(/.test(await page.locator('[role="alert"]').innerText()) && await page.locator('form input[type="password"]').count() === 1);

  await page.fill('input[type="password"]', 'Standalone!2026');
  await page.locator('form button').first().click();
  await page.waitForSelector('nav[aria-label="ماژول‌های فروشگاه"]', { timeout: 20000 });
  check('ورود ⇒ پوستهٔ فروشگاه با منوی ماژول‌ها از سرور', await page.locator('nav[aria-label="ماژول‌های فروشگاه"] a').count() >= 5);
  check('نوارِ سادهٔ میزبان: نام و نقشِ همین نشست', /admin · admin/.test(await page.locator('[data-testid="standalone-user"]').innerText()));
  check('نشانی همان ‎/shop‎ ِ ماژول است', new URL(page.url()).pathname === '/shop', page.url());

  const panelLinks = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))
    .filter((h) => /^\/(terminal|files|stations|sites|databases|my-servers|control|settings|automation|assistant)\b/.test(h)));
  check('⛔ هیچ پیوندی به صفحه‌های پنل (ترمینال، فایل‌ها، پمپ‌ها، سایت‌ها…)', panelLinks.length === 0, panelLinks.join(' '));

  console.log('\n── ماژول با کلیک ──');
  await page.locator('nav[aria-label="ماژول‌های فروشگاه"] a[href="/shop?tab=shops"]').click();
  await page.waitForURL(/tab=shops/, { timeout: 10000 });
  await page.waitForTimeout(800);
  check('«فروشگاه‌های عضو» با کلیک باز شد (‎?tab=shops‎)', /tab=shops/.test(page.url()) && /فروشگاه‌های عضو/.test(await page.locator('main').innerText()));

  await page.goto(`${SITE}/shop?tab=users`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const usersText = await page.locator('main').innerText();
  check('«کاربران و نقش‌ها» در ساختِ جدا باز می‌شود', /مدیرانِ سرورِ حساب|کاربران و نقش‌ها/.test(usersText), usersText.slice(0, 200));
  //  کارتِ «کاربرانِ پنل» (عنوانِ ‎<h2>‎ ِ همان ‎Card‎) فقط وقتی میزبان ‎PanelUsers‎ دارد
  const panelUsersCard = (pg) => pg.evaluate(() => [...document.querySelectorAll('main h2')].filter((h) => h.textContent.trim() === 'کاربرانِ پنل').length);
  check('مدیرانِ سرورِ حساب همان کارتِ ماژول‌اند', await page.evaluate(() => [...document.querySelectorAll('main h2')].some((h) => h.textContent.trim() === 'مدیرانِ سرورِ حساب')));
  check('⛔ بخشِ «کاربرانِ پنل» نیست (‎PanelUsers = null‎ ِ میزبانِ جدا)', (await panelUsersCard(page)) === 0);

  //  و همان ماژول در خودِ پنل (همان سرور، همان حساب) آن بخش را دارد ⇒ فرق فقط از میزبان است، نه از ماژول
  const panelPage = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  panelPage.on('pageerror', (e) => jsErrors.push(`پنل: ${e.message}`));
  await panelPage.goto(BASE, { waitUntil: 'networkidle' });
  await panelPage.fill('input[autocomplete="username"]', 'admin');
  await panelPage.fill('input[type="password"]', 'Standalone!2026');
  await panelPage.locator('form button').last().click();
  await panelPage.waitForSelector('aside nav', { timeout: 20000 });
  await panelPage.goto(`${BASE}/shop?tab=users`, { waitUntil: 'networkidle' });
  await panelPage.waitForTimeout(800);
  check('و در خودِ پنل همان ماژول بخشِ «کاربرانِ پنل» را دارد (میزبانِ پنل)', (await panelUsersCard(panelPage)) === 1);
  //  منوی پنل (نه منوی پوسته): آیتمِ «فروشگاه» یک بار، بینِ «پمپ‌بنزین‌ها» و «کدها» — همان جای پیش از ۱.۵۱.۰
  const daily = await panelPage.evaluate(() => [...document.querySelectorAll('aside nav a')].map((a) => a.getAttribute('href'))
    .filter((h) => !/^\/shop\?/.test(h)));
  const at = daily.indexOf('/shop');
  check('و منوی پنل همان آیتمِ «فروشگاه» را سرِ همان جا دارد', at > 0 && daily[at - 1] === '/stations' && daily[at + 1] === '/codes', daily.join(' '));
  await panelPage.close();

  console.log('\n── نشست ──');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('nav[aria-label="ماژول‌های فروشگاه"]', { timeout: 15000 });
  check('بارگذاریِ دوباره ⇒ نشست می‌ماند (همان توکنِ ‎api.ts‎)', true);
  await page.locator('header button', { hasText: 'خروج' }).click();
  await page.waitForSelector('form input[autocomplete="username"]', { timeout: 10000 });
  check('خروج ⇒ صفحهٔ ورود و توکن پاک', (await page.evaluate(() => localStorage.getItem('hlp.token'))) === null);

  check('هیچ خطای جاوااسکریپت', jsErrors.length === 0, jsErrors.join(' | '));
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
  console.log(out.slice(-1500));
} finally {
  await browser?.close().catch(() => {});
  server.kill('SIGTERM');
  fake.close();
  site.close();
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
