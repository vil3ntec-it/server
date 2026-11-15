// ---------------------------------------------------------------------------
//  منوی کناریِ پنل، ۱.۵۱.۱ — یک جای منو (drill-in)، نوارِ باریک و خوانایی، در کرومیومِ واقعی
//      CHROME_PATH=… node test/nav-drill-ui.mjs        (SHOTS=<پوشه> ⇒ menu-main/shop/collapsed.png)
//
//  دستورِ صاحب سامانه: «این منوی فروشگاه بیاد جای اون منوی بزرگ؛ روی فروشگاه کلیک می‌کنم این منو باز بشه، با برگشت دوباره
//  بره روی منوی قبلی؛ منوی اصلی هم قابلِ جمع شدن بشه.»
//    ⛔ کلیک روی «فروشگاه» ⇒ منوی فروشگاه **جای** منوی اصلی (یک ستون؛ ستونِ دومِ درونِ صفحه نیست)
//    ⛔ «منوی اصلی» ⇒ همان منوی پنل؛ زدنِ دوبارهٔ «فروشگاه» ⇒ دوباره منوی فروشگاه
//    ⛔ برگشت/جلوی مرورگر و بارگذاریِ دوبارهٔ لینکِ مستقیم: نشانی می‌گوید کدام منو
//    ⛔ نوارِ باریک (~۶۴px) با راهنمای کوچک روی ماوس و فوکوس؛ پس از بارگذاری می‌ماند (حافظهٔ مرورگر)
//    ⛔ ردیف‌ها ~۴۰px و متنِ ۱۴px؛ شمارهٔ بند (۴.۱…) دیگر کنارِ ردیف نیست؛ کیبورد کار می‌کند؛ پنجرهٔ باریک ⇒ کشو
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const { chromium } = await (async () => {
  for (const spec of ['playwright-core', '../../../node_modules/playwright-core/index.mjs']) {
    try { return await import(spec.startsWith('.') ? new URL(spec, import.meta.url).href : spec); } catch { /* بعدی */ }
  }
  throw new Error('playwright-core نصب نیست: در پوشهٔ server دستور «npm install --include=dev» را بزنید');
})();
const CHROME = process.env.CHROME_PATH
  || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome', '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome']
    .find((p) => fs.existsSync(p));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 400)}`);
};

const NOW = Date.now();
const fake = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
  req.resume();
  if (p === '/api/health') return j(200, { ok: true, server: 'online', version: '2.14.5' });
  if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
  if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: ['flags.v1'], serverTime: NOW });
  if (p === '/api/admin/shops') return j(200, { total: 1, shops: [{ id: 'shp-1', name: 'دکانِ یک', status: 'active' }] });
  if (p === '/api/admin/flags') return j(200, { scope: 'all', items: [], known: [{ key: 'shop.chat', scope: 'shop', default: false, what: 'گفت‌وگو با مشتری' }] });
  return j(404, { error: { code: 'not_found', message: 'این مسیر وجود ندارد' } });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

const PORT = Number(process.env.TEST_PORT || 4961);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'nav-drill-ui-'));
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

const SHOP_NAV = 'aside nav[aria-label="ماژول‌های فروشگاه"]';
const MAIN_NAV = 'aside nav[aria-label="منوی اصلی"]';
const shot = async (page, name) => { if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `${name}.png`) }); };

let browser;
const jsErrors = [];
try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!CHROME) throw new Error('کرومیوم پیدا نشد — CHROME_PATH را بگذارید');
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => jsErrors.push(String(e.message)));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('input[autocomplete="username"]', 'admin');
  await page.fill('input[type="password"]', 'NavDrill!2026');
  await page.locator('form button.btn-primary').click();
  await page.waitForSelector(MAIN_NAV, { timeout: 20000 });
  await page.waitForTimeout(500);

  console.log('\n── منوی اصلی و خوانایی ──');
  const rowBox = await page.locator(`${MAIN_NAV} a.nav-item`).first().boundingBox();
  const rowFont = await page.locator(`${MAIN_NAV} a.nav-item`).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  check('ردیفِ منو ~۴۰px و متنِ ۱۴–۱۵px', rowBox && rowBox.height >= 36 && rowBox.height <= 42 && rowFont >= 14 && rowFont <= 15, `${rowBox?.height} ${rowFont}`);
  const fits = await page.evaluate(() => { const box = document.querySelector('aside nav')?.parentElement; return box ? box.scrollHeight <= box.clientHeight : false; });
  check('منوی پیش‌فرض هنوز بی اسکرول در قاب جا می‌شود (۹۵۰px)', fits);
  const asideW = async () => (await page.locator('aside[data-rail]').boundingBox())?.width || 0;
  check('نوارِ پهن ~۲۴۰px', Math.abs((await asideW()) - 240) <= 2, String(await asideW()));
  await shot(page, 'menu-main');

  console.log('\n── drill-in: فروشگاه جای منوی اصلی ──');
  await page.locator(`${MAIN_NAV} a[href="/shop"]`).click();
  await page.waitForSelector(SHOP_NAV, { timeout: 10000 });
  await page.waitForTimeout(400);
  check('⛔ کلیک روی «فروشگاه» ⇒ منوی فروشگاه جای منوی اصلی (منوی اصلی در DOM نیست)', (await page.locator(MAIN_NAV).count()) === 0 && (await page.locator(SHOP_NAV).count()) === 1);
  check('⛔ ستونِ دوم درونِ صفحه نیست', (await page.locator('main aside').count()) === 0 && (await page.locator('main nav[aria-label="ماژول‌های فروشگاه"]').count()) === 0);
  const back = page.locator('[data-testid="nav-back"]');
  check('ردیفِ «منوی اصلی» بالای منو، با نام و نشانهٔ «فروشگاه‌ها»', (await back.innerText()).includes('منوی اصلی')
    && (await page.locator('aside .nav-module-title').innerText()).includes('فروشگاه'));
  const shopText = await page.locator(SHOP_NAV).innerText();
  check('⛔ شمارهٔ بندها (۴.۱، ۴.۸…) کنارِ ردیف نیست', !/\b4\.\d+\b/.test(shopText) && shopText.includes('داشبورد'), shopText.slice(0, 200));
  check('…فقط در راهنمای کوچکِ همان ردیف', /4\.1/.test(await page.locator(`${SHOP_NAV} a[href="/shop"]`).getAttribute('title') || ''));
  check('ردیفِ جاری با aria-current و رنگِ پُر', (await page.locator(`${SHOP_NAV} a[aria-current="page"]`).count()) === 1);
  await shot(page, 'menu-shop');
  await page.locator(`${SHOP_NAV} a[href="/shop?tab=settings"]`).click();
  await page.waitForTimeout(500);
  check('ماژولِ دیگر ⇒ همان منو، ردیفِ جاریِ تازه', (await page.locator(`${SHOP_NAV} a[aria-current="page"]`).innerText()).includes('تنظیماتِ مرکزی'));

  await back.click();
  await page.waitForSelector(MAIN_NAV, { timeout: 5000 });
  check('⛔ «منوی اصلی» ⇒ منوی پنل برگشت (صفحه همان‌جا ماند)', (await page.locator(SHOP_NAV).count()) === 0 && page.url().endsWith('/shop?tab=settings'));
  await page.locator(`${MAIN_NAV} a[href="/shop"]`).click();
  await page.waitForSelector(SHOP_NAV, { timeout: 5000 });
  check('زدنِ دوبارهٔ «فروشگاه» ⇒ دوباره منوی فروشگاه', (await page.locator(SHOP_NAV).count()) === 1);

  console.log('\n── نشانی می‌گوید کدام منو ──');
  await page.locator(`${MAIN_NAV}, ${SHOP_NAV}`).first().waitFor();
  await page.goto(`${BASE}/sites`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  check('صفحهٔ دیگر ⇒ منوی اصلی', (await page.locator(MAIN_NAV).count()) === 1);
  await page.goBack({ waitUntil: 'networkidle' });
  await page.goBack({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  check('⛔ برگشتِ مرورگر به ‎/shop‎ ⇒ منوی فروشگاه', (await page.locator(SHOP_NAV).count()) === 1, page.url());
  await page.goForward({ waitUntil: 'networkidle' });
  await page.goForward({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  check('⛔ جلوی مرورگر به ‎/‎ ⇒ منوی اصلی', (await page.locator(MAIN_NAV).count()) === 1, page.url());
  await page.goto(`${BASE}/shop?tab=versions`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector(SHOP_NAV, { timeout: 10000 });
  check('⛔ بارگذاریِ دوبارهٔ لینکِ مستقیم ⇒ منوی فروشگاه با ردیفِ جاریِ درست', (await page.locator(`${SHOP_NAV} a[aria-current="page"]`).innerText()).includes('نسخه‌ها'));

  console.log('\n── کیبورد ──');
  await page.locator('[data-testid="nav-back"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector(MAIN_NAV, { timeout: 5000 });
  check('«منوی اصلی» با Enter', (await page.locator(MAIN_NAV).count()) === 1);
  await page.locator(`${MAIN_NAV} a[href="/shop"]`).focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector(SHOP_NAV, { timeout: 5000 });
  check('و «فروشگاه» با Enter', (await page.locator(SHOP_NAV).count()) === 1);

  console.log('\n── نوارِ باریک ──');
  await page.locator('[data-testid="nav-rail-toggle"]').click();
  await page.waitForTimeout(350);
  check('⛔ جمع کردن ⇒ ~۶۴px', Math.abs((await asideW()) - 64) <= 2, String(await asideW()));
  const firstItem = page.locator(`${SHOP_NAV} a.nav-item`).first();
  check('در نوارِ باریک برچسب فقط برای صفحه‌خوان (sr-only)', (await firstItem.locator('span.sr-only').count()) === 1);
  await firstItem.hover();
  await page.waitForTimeout(150);
  check('⛔ راهنمای کوچک روی ماوس', (await page.locator('[role="tooltip"]').innerText().catch(() => '')).includes('داشبورد'));
  await page.mouse.move(900, 500);
  await page.locator(`${SHOP_NAV} a.nav-item`).nth(1).focus();
  await page.waitForTimeout(150);
  check('⛔ و روی فوکوسِ کیبورد', (await page.locator('[role="tooltip"]').count()) === 1);
  await shot(page, 'menu-collapsed');
  check('حالتِ باریک در حافظهٔ مرورگر', (await page.evaluate(() => localStorage.getItem('hlp.nav.rail'))) === '1');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  check('⛔ پس از بارگذاریِ دوباره هنوز باریک', Math.abs((await asideW()) - 64) <= 2 && (await page.locator('aside[data-rail="1"]').count()) === 1);
  await page.locator('[data-testid="nav-back"]').click();
  await page.waitForSelector(MAIN_NAV);
  check('منوی اصلی در نوارِ باریک هم فقط نشانه', (await page.locator(`${MAIN_NAV} a.nav-item span.sr-only`).count()) >= 5);
  await page.locator('[data-testid="nav-rail-toggle"]').click();
  await page.waitForTimeout(350);
  check('باز کردن ⇒ پهن، و در حافظه «۰»', Math.abs((await asideW()) - 240) <= 2 && (await page.evaluate(() => localStorage.getItem('hlp.nav.rail'))) === '0');

  console.log('\n── پنجرهٔ باریک ⇒ کشو ──');
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  check('کناره پنهان است', !(await page.locator('aside[data-rail]').isVisible()));
  await page.locator('header button[aria-label="menu"]').click();
  await page.waitForTimeout(250);
  const drawer = page.locator('div.fixed.inset-0 aside');
  check('کشو با منوی اصلی', await drawer.isVisible() && (await drawer.locator('nav[aria-label="منوی اصلی"]').count()) === 1);
  await drawer.locator('a[href="/shop"]').click();
  await page.waitForTimeout(500);
  check('⛔ «فروشگاه» در کشو ⇒ کشو باز می‌ماند و منوی فروشگاه را نشان می‌دهد', await drawer.isVisible() && (await drawer.locator('nav[aria-label="ماژول‌های فروشگاه"]').count()) === 1);
  await drawer.locator('a[href="/shop?tab=settings"]').click();
  await page.waitForTimeout(400);
  check('انتخابِ ماژول ⇒ کشو بسته', !(await drawer.isVisible().catch(() => false)));
  check('صفحه افقی نمی‌لغزد', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  check('هیچ خطای جاوااسکریپت', jsErrors.length === 0, jsErrors.join(' | '));
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
  console.log(out.slice(-1500));
} finally {
  await browser?.close().catch(() => {});
  server.kill('SIGTERM');
  fake.close();
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
