// ---------------------------------------------------------------------------
//  آزمونِ واقعیِ رابطِ مرکز فرمان با کرومیومِ بی‌سر
//      node test/control-ui.mjs
//
//  هر صفحه واقعاً باز می‌شود، در هر دو تمِ روشن و تیره بررسی می‌شود و
//  یک پروژه از صفر ساخته می‌شود — نه با درخواستِ API، بلکه با کلیک روی خودِ UI.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const { chromium } = await (async () => {
  for (const spec of ['playwright-core', '../../../node_modules/playwright-core/index.mjs']) {
    try {
      return await import(spec.startsWith('.') ? new URL(spec, import.meta.url).href : spec);
    } catch { /* بعدی را امتحان کن */ }
  }
  throw new Error('playwright-core نصب نیست: در پوشهٔ server دستور «npm install --include=dev» را بزنید');
})();

const CHROME =
  process.env.CHROME_PATH ||
  ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome'].find((p) => fs.existsSync(p));

const PORT = Number(process.env.TEST_PORT || 4796);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-ui-'));
const storageRoot = path.join(tmp, 'Projects');
const shots = process.env.CC_SHOTS || path.join(tmp, 'shots');
fs.mkdirSync(shots, { recursive: true });

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`);
  }
};

const server = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')],
  {
    env: {
      ...process.env,
      HLP_PORT: String(PORT),
      HLP_HOST: '127.0.0.1',
      HLP_DATA_DIR: path.join(tmp, 'data'),
      HLP_SITES_ROOT: path.join(tmp, 'sites'),
      HLP_SITESYNC: '0',
      HLP_AI_ENABLED: '0',
      HLP_TUNNEL: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);
let serverOut = '';
server.stdout.on('data', (d) => (serverOut += d));
server.stderr.on('data', (d) => (serverOut += d));

async function waitForServer(timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return true;
    } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

let browser;
const consoleErrors = [];

try {
  if (!(await waitForServer())) {
    console.log(serverOut.slice(-3000));
    throw new Error('سرور بالا نیامد');
  }
  if (!CHROME) throw new Error('کرومیوم پیدا نشد — CHROME_PATH را بگذارید');

  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e.message)));

  console.log('\n── ورود ──');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('input[autocomplete="username"]', 'admin');
  await page.fill('input[type="password"]', 'ControlCenter!2026');
  await page.locator('form button').last().click();
  await page.waitForSelector('aside nav', { timeout: 20000 });
  check('حسابِ مدیر ساخته شد و پنل باز شد', true);

  console.log('\n── ناوبریِ مرکز فرمان ──');
  const navText = await page.locator('aside nav').first().innerText();
  for (const label of ['مرکز فرمان', 'پروژه‌ها', 'سرورها', 'شبکه', 'انبار', 'گاوصندوق', 'پایش', 'به‌روزرسانی', 'برنامه توحید']) {
    check(`«${label}» در منو هست`, navText.includes(label), navText.slice(0, 200));
  }

  console.log('\n── صفحه‌ها در تمِ تیره ──');
  const PAGES = [
    ['/control', 'مرکز فرمان'],
    ['/control/projects', 'پروژه‌ها'],
    ['/control/servers', 'سرورها'],
    ['/control/networking', 'شبکه'],
    ['/control/routing', 'مسیر دامنه‌ها'],
    ['/control/cloudflare', 'Cloudflare'],
    ['/control/storage', 'انبار'],
    ['/control/vault', 'گاوصندوق'],
    ['/control/monitoring', 'پایش'],
    ['/control/audit', 'دفتر رخدادها'],
    ['/control/updates', 'به‌روزرسانی'],
    ['/control/tohid', 'حساب‌ها'],
  ];

  for (const [route, heading] of PAGES) {
    consoleErrors.length = 0;
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const body = await page.locator('main').innerText();
    const ok = body.includes(heading) && !body.includes('undefined');
    check(`صفحهٔ ${route}`, ok, body.slice(0, 160));
    check(`${route} بدونِ خطای جاوااسکریپت`, consoleErrors.length === 0, consoleErrors.join(' | '));
  }

  console.log('\n── ساختِ پروژه از خودِ رابط ──');
  await page.goto(`${BASE}/control/storage`, { waitUntil: 'networkidle' });
  await page.fill('input[dir="ltr"]', storageRoot);
  await page.click('button:has-text("ذخیره")');
  await page.waitForTimeout(900);
  check('محلِ انبار از رابط تنظیم شد', fs.existsSync(storageRoot));

  await page.goto(`${BASE}/control/projects`, { waitUntil: 'networkidle' });
  await page.locator('header button:has-text("پروژه جدید")').click();
  await page.waitForSelector('.card input', { timeout: 8000 });
  await page.locator('.card input').first().fill('ShopApp');
  await page.locator('footer button:has-text("ساختن")').click();
  // مسیرِ SPA رویدادِ load نمی‌دهد، پس خودِ آدرس را می‌پاییم
  await page.waitForFunction(() => /\/control\/projects\/prj_/.test(location.pathname), null, { timeout: 20000 });
  check('پروژه ساخته شد و صفحهٔ اختصاصی باز شد', true);
  const detail = await page.locator('main').innerText();
  check('شناسهٔ پروژه نشان داده می‌شود', /prj_[0-9a-f]{8}/.test(detail), detail.slice(0, 200));
  check('پوشهٔ پروژه روی دیسک ساخته شد', fs.existsSync(path.join(storageRoot, 'shopapp', 'backups')));

  console.log('\n── زبانه‌های صفحهٔ پروژه ──');
  for (const tab of ['شبکه و آدرس‌ها', 'حساب‌ها', 'انبار', 'پیکربندی', 'انتقال به سرور دیگر']) {
    consoleErrors.length = 0;
    await page.click(`button:has-text("${tab}")`);
    await page.waitForTimeout(600);
    check(`زبانهٔ «${tab}»`, consoleErrors.length === 0, consoleErrors.join(' | '));
  }

  console.log('\n── تمِ روشن و تیره ──');
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => {
      localStorage.setItem('hlp.theme', JSON.stringify(value).replace(/"/g, ''));
    }, theme);
    await page.goto(`${BASE}/control`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    check(`تمِ ${theme} اعمال شد`, applied === theme, String(applied));

    // متن و پس‌زمینه باید واقعاً از هم جدا باشند (نه سفید روی سفید)
    const contrast = await page.evaluate(() => {
      const parse = (c) => (c.match(/\d+/g) || []).slice(0, 3).map(Number);
      const lum = ([r, g, b]) => {
        const f = (v) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const body = getComputedStyle(document.body);
      const a = lum(parse(body.color));
      const b = lum(parse(body.backgroundColor));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    check(`تمِ ${theme} کنتراستِ کافی دارد (${contrast.toFixed(1)}:1)`, contrast >= 7);

    await page.screenshot({ path: path.join(shots, `control-${theme}.png`), fullPage: true });
  }

  console.log('\n── تصویرِ صفحه‌های اصلی ──');
  for (const [route, name] of [['/control/projects', 'projects'], ['/control/routing', 'routing'], ['/control/monitoring', 'monitoring']]) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
  }
  await page.goto(`${BASE}/control/projects`, { waitUntil: 'networkidle' });
  await page.locator('a[href^="/control/projects/prj_"]').first().click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(shots, 'project-detail.png'), fullPage: true });
  check('صفحهٔ اختصاصیِ پروژه از فهرست باز می‌شود', /\/control\/projects\/prj_/.test(page.url()), page.url());

  console.log('\n── صفحهٔ توحید سرِ جایش می‌ماند ──');
  /*
   *  یک بار این صفحه هر ثانیه خودش را از نو می‌ساخت: زیربخش‌ها داخلِ
   *  خودِ کامپوننت تعریف شده بودند، و چون سنجه‌های زندهٔ سرور مدام از
   *  سوکت می‌رسند و در همان context‌اند، هر رسیدنشان کلِ زیردرخت را
   *  پیاده و سوار می‌کرد. نشانه‌اش این بود که متنِ داخلِ کادرِ جستجو
   *  وسطِ تایپ پاک می‌شد.
   */
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto(`${BASE}/control/tohid`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const calls = [];
  page.on('request', (r) => { if (r.url().includes('/api/control/tohid/')) calls.push(r.url()); });

  const search = page.locator('input[placeholder]').first();
  await search.fill('احمد');
  await page.waitForTimeout(6000);

  check('متنِ جستجو وسطِ کار پاک نمی‌شود', (await search.inputValue()) === 'احمد', await search.inputValue());
  check('صفحه خودش را مدام از سرور نمی‌خواند', calls.length <= 2, `${calls.length} درخواست در ۶ ثانیه`);

  console.log('\n── بخشِ کد ورود ──');
  await page.locator('button', { hasText: 'کد ورود' }).first().click();
  await page.waitForTimeout(700);
  const otpText = await page.locator('main').innerText();
  check('بخشِ کد ورود باز می‌شود', otpText.includes('دروازهٔ پیامک'), otpText.slice(0, 160));
  check('وضعیتِ ایمیل و پیامک دیده می‌شود', otpText.includes('تنظیم نشده') || otpText.includes('آماده'), otpText.slice(0, 160));
  await page.screenshot({ path: path.join(shots, 'tohid-otp.png'), fullPage: true });

  console.log('\n── موبایل ──');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/control`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('در موبایل نوار افقی نمی‌آید', overflow <= 2, String(overflow));
  await page.screenshot({ path: path.join(shots, 'control-mobile.png'), fullPage: true });

  console.log(`\n  📸 تصویرها: ${shots}`);
} catch (e) {
  fail++;
  console.log(`\n❌ خطای غیرمنتظره: ${e.stack}`);
  console.log(serverOut.slice(-2500));
} finally {
  try {
    await browser?.close();
  } catch { /* بسته شد */ }
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 800));
  server.kill('SIGKILL');
  if (!process.env.CC_SHOTS) await fsp.rm(tmp, { recursive: true, force: true });
}

console.log('\n════════════════════════════════════');
console.log(`  موفق: ${pass}    ناموفق: ${fail}`);
console.log('════════════════════════════════════\n');
process.exit(fail ? 1 : 0);
