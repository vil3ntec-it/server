// ---------------------------------------------------------------------------
//  LOC-04 (۱.۵۰.۷۸) در کرومیومِ واقعی: جدولِ تعطیلاتِ رسمی در «فروشگاه ← تنظیماتِ مرکزی»
//      CHROME_PATH=… node test/holidays-ui.mjs        (محلی، مثلِ staff-bank-ui)
//
//  پنلِ واقعی + سرورِ حسابِ ساختگی به شکلِ ‎routes/admin-calendar.js‎ ِ shop ‎claude/loc-04‎. با کلیکِ واقعی:
//    ⛔ بی `holidays.v1` ⇒ «سرورِ حساب کهنه است» با نامِ درِ لازم، بی جدول و بی دکمه
//    ⛔ با آن: جدول از سرور؛ نامِ HTML متن می‌ماند (هیچ ‎<img>‎ ساخته نمی‌شود، هیچ اسکریپتی نمی‌دود)
//    ⛔ ویرایش: تاریخِ نادرست (۲۰۲۶-۰۲-۳۰، ۱۹۹۹-۱۲-۳۱) / تکراری / بی نامِ دری ⇒ «ذخیره» بسته؛ دلیل + تأیید + دوکلیک ⇒ یک PUT با
//       ‎{holidays, version, reason}‎ و «تأییدشده از سرورِ حساب: نسخهٔ …»
//    ⛔ ‎409 holiday_version‎ ⇒ «کسِ دیگری … عوض کرد — دوباره بخوانید»، و «دوباره بخوان» جدولِ تازهٔ سرور را می‌آورد
//    ⛔ viewer جدول را می‌بیند و دکمهٔ ویرایش نه؛ گوشی (۳۹۰px) افقی نمی‌لغزد؛ هیچ خطای جاوااسکریپت
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
    .find((p) => fs.existsSync(p) && fs.statSync(p).isFile());

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 400)}`);
};

const NOW = Date.now();
let caps = ['actor.v1'];
const puts = [];
let staleNext = false;
const XSS = '<img src=x onerror="window.__xss=1">';
let doc = { version: 7, updatedAt: NOW - 86400e3, holidays: [
  { date: '2026-03-21', name: { fa: 'نوروز', en: 'Nowruz', ps: 'نوروز' } },
  { date: '2026-03-30', name: { fa: XSS, en: 'Eid al-Fitr' } },
] };
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, server: 'online', version: '2.14.5' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: caps, serverTime: NOW });
    if (p === '/api/admin/calendar/holidays') {
      if (!caps.includes('holidays.v1')) return j(401, { error: { code: 'invalid_token', message: 'نشست' } });
      if (req.method === 'GET') return j(200, doc);
      let b = null;
      try { b = JSON.parse(raw || 'null'); } catch { /* */ }
      puts.push(b);
      if (staleNext || b?.version !== doc.version) {
        staleNext = false;
        //  «کسِ دیگری» همین حالا نوشت
        doc = { version: doc.version + 1, updatedAt: Date.now(), holidays: [...doc.holidays, { date: '2026-08-19', name: { fa: 'روزِ استقلال' } }] };
        return j(409, { error: { code: 'holiday_version', message: 'جدولِ تعطیلات در این میان عوض شده است؛ دوباره بخوانید و بنویسید' } });
      }
      doc = { version: doc.version + 1, updatedAt: Date.now(), holidays: b.holidays };
      return void setTimeout(() => j(200, { ...doc, unchanged: false }), 300);
    }
    //  داشبورد (صفحهٔ نخستِ پس از ورود) — همان شکلِ ‎admin-sales.js‎ ِ shop (درسِ ناپایداریِ ۱.۵۰.۷۷ ِ staff-bank-ui)
    if (p === '/api/admin/sales/summary') {
      const empty = { shop: {}, pump: {} };
      const series = Array.from({ length: 12 }, (_, i) => {
        const d = new Date(NOW); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); d.setUTCMonth(d.getUTCMonth() - (11 - i));
        const to = new Date(d); to.setUTCMonth(to.getUTCMonth() + 1);
        return { month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, from: d.getTime(), to: to.getTime(), shop: {}, pump: {}, payments: 0 };
      });
      return j(200, { revenue: { today: empty, month: empty, year: empty }, series,
        counts: { shop: { active: 0, expired: 0, suspended: 0, tenants: 0 }, pump: { active: 0, expired: 0, suspended: 0, tenants: 0 } }, serverTime: NOW });
    }
    if (p === '/api/admin/sales/expiring') return j(200, { expiring: [], days: Math.min(90, Math.max(1, Number(u.searchParams.get('days')) || 7)), serverTime: NOW });
    //  بقیهٔ کارت‌های «تنظیماتِ مرکزی»
    if (p === '/api/admin/plans') return j(200, { plans: [], config: { trial_days: '14' } });
    if (p === '/api/admin/release/beta') return j(200, { shops: { ids: [], updatedBy: 'boss', updatedAt: NOW }, devices: { ids: [] } });
    if (p === '/api/admin/support/threads') return j(200, { threads: [], unread: 0 });
    if (p === '/api/admin/shops') return j(200, { shops: [], total: 0 });
    return j(404, { error: { code: 'not_found', message: 'این مسیر وجود ندارد' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

const PORT = Number(process.env.TEST_PORT || 4973);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'holidays-ui-'));
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
  env: { ...process.env, HLP_PORT: String(PORT), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: path.join(tmp, 'data'),
         HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_SITESYNC: '0', HLP_AI_ENABLED: '0', HLP_TUNNEL: '0', HLP_STATIONS: '0',
         HLP_AUTOMATION: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_ACCOUNT_API: `http://127.0.0.1:${fake.address().port}`,
         HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret', HLP_TG_WATCH_MS: '0', HLP_TG_LONGPOLL: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

let browser;
const jsErrors = [];
const card = (pg) => pg.locator('[data-card="holidays"]');
try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!CHROME) throw new Error('کرومیوم پیدا نشد — CHROME_PATH را بگذارید');
  await fetch(`${BASE}/api/auth/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'Holiday!2026' }) });
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', (e) => jsErrors.push(String(e.message)));
  //  ‎409‎ ِ «نسخهٔ کهنه» خطای خودِ همین آزمون است (رابط باید زردش کند)، نه خطای صفحه
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*\b409\b/.test(m.text())) jsErrors.push(m.text()); });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('input[autocomplete="username"]', 'admin');
  await page.fill('input[type="password"]', 'Holiday!2026');
  const dash = Promise.all(['/api/account-admin/sales/summary', '/api/account-admin/sales/expiring'].map((s) =>
    page.waitForResponse((r) => r.url().startsWith(BASE + s), { timeout: 20000 })));
  await page.locator('form button').last().click();
  await page.waitForSelector('aside nav', { timeout: 20000 });
  await dash;
  await page.waitForLoadState('networkidle');

  console.log('\n── بی `holidays.v1` ──');
  await page.goto(`${BASE}/shop?tab=settings`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-card="holidays"]', { timeout: 15000 });
  await page.waitForTimeout(500);
  let text = await card(page).innerText();
  check('⛔ «سرورِ حساب کهنه است» با نامِ درِ لازم — بی جدول، بی دکمهٔ ویرایش، بی نامِ ساختگی',
    (await card(page).locator('[data-holidays-old]').count()) === 1 && text.includes('سرورِ حساب کهنه است') && text.includes('calendar/holidays')
      && (await card(page).locator('table').count()) === 0 && (await card(page).locator('[data-holidays-edit]').count()) === 0 && !text.includes('نوروز'), text.slice(0, 400));

  caps = ['actor.v1', 'holidays.v1'];
  console.log('\n── با `holidays.v1` ──');
  await page.goto(`${BASE}/shop?tab=settings`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-card="holidays"] table', { timeout: 15000 });
  text = await card(page).innerText();
  check('جدول از سرورِ حساب: نسخه، دو روز با نامِ سه‌زبانه', text.includes('نوروز') && text.includes('2026-03-21') && text.includes('Eid al-Fitr') && (text.includes('۷') || text.includes('7')), text.slice(0, 500));
  check('⛔ نامِ HTML متن می‌ماند: همان نوشته دیده می‌شود، هیچ ‎<img>‎ در کارت ساخته نشد و ‎onerror‎ نَدَوید',
    text.includes('<img src=x') && (await card(page).locator('img').count()) === 0 && (await page.evaluate(() => window.__xss)) === undefined);

  await card(page).locator('[data-holidays-edit]').click();
  await page.waitForSelector('[data-holidays-editor]');
  const save = card(page).locator('[data-holidays-save]');
  check('ویرایش بی تغییر ⇒ «ذخیره» بسته', await save.isDisabled());
  await card(page).locator('[data-holidays-add]').click();
  const row = card(page).locator('[data-holiday-row="2"]');
  const dateIn = row.locator('input').nth(0);
  const faIn = row.locator('input').nth(1);
  const verdict = async (d) => { await dateIn.fill(d); await page.waitForTimeout(80); return { err: (await row.locator('[data-holiday-error]').count()) > 0, dis: await save.isDisabled() }; };
  await faIn.fill('روزِ آزمون');
  const vBad = [];
  for (const d of ['2026-02-30', '1999-12-31', '2200-01-01', '1405-01-01', '2026-1-01', '2026-03-21']) vBad.push({ d, ...(await verdict(d)) });
  check('⛔ تاریخِ نادرست (۳۰ ِ فوریه، پیش از ۲۰۰۰، پس از ۲۱۹۹، سالِ خورشیدی، شکلِ بد) و تاریخِ تکراری ⇒ خطای ردیف و «ذخیره» بسته',
    vBad.every((x) => x.err && x.dis), JSON.stringify(vBad));
  const vOk = await verdict('2028-02-29');
  check('کبیسهٔ درست (۲۰۲۸-۰۲-۲۹) ⇒ بی خطا و «ذخیره» باز', !vOk.err && !vOk.dis, JSON.stringify(vOk));
  await faIn.fill('');
  await page.waitForTimeout(80);
  check('⛔ بی نامِ دری ⇒ «نامِ دری لازم است» و «ذخیره» بسته', (await row.innerText()).includes('نامِ دری لازم است') && await save.isDisabled());
  await faIn.fill('روزِ آزمون');
  await page.waitForTimeout(80);
  await save.click();
  const send = page.getByRole('button', { name: 'تأیید و فرستادن' });
  await page.waitForTimeout(300);
  check('پنجرهٔ حساس: اثر پیش از تأیید گفته می‌شود (نسخه ⇒ سه روز، یکی افزوده) و بی دلیل بسته',
    await send.isDisabled() && (await page.locator('text=روزِ کاریِ همهٔ دکان‌ها').count()) > 0, '');
  await page.locator('textarea').fill('اعلامِ رسمیِ امسال');
  await send.dblclick();
  await page.waitForTimeout(1500);
  text = await card(page).innerText();
  check('⛔ دوکلیک ⇒ یک PUT با ‎{holidays (مرتب), version: 7, reason}‎ و کلیدِ پنجره؛ «تأییدشده از سرورِ حساب: نسخهٔ ۸ با ۳ روز»',
    puts.length === 1 && puts[0].version === 7 && puts[0].reason === 'اعلامِ رسمیِ امسال' && puts[0].holidays.map((h) => h.date).join(',') === '2026-03-21,2026-03-30,2028-02-29'
      && puts[0].holidays[1].name.fa === XSS && !('idempotencyKey' in puts[0]) && text.includes('تأییدشده از سرورِ حساب') && (text.includes('۸') || text.includes('8')),
    `${JSON.stringify(puts).slice(0, 300)} ${text.slice(0, 300)}`);

  console.log('\n── نسخهٔ کهنه ──');
  staleNext = true;
  await card(page).locator('[data-holidays-edit]').click();
  await page.waitForSelector('[data-holidays-editor]');
  await card(page).locator('[data-holiday-row="2"] button').click();   //  برداشتنِ ۲۰۲۸-۰۲-۲۹
  await card(page).locator('[data-holidays-save]').click();
  await page.waitForTimeout(300);
  await page.locator('textarea').fill('روزِ نادرست برداشته شد');
  await page.getByRole('button', { name: 'تأیید و فرستادن' }).click();
  await page.waitForTimeout(1200);
  text = await card(page).innerText();
  check('⛔ ‎409 holiday_version‎ ⇒ پنجره بسته و «کسِ دیگری … عوض کرد — ویرایشِ شما نوشته نشد … دوباره بخوانید» (زرد، نه سرخِ گنگ)',
    puts.length === 2 && (await card(page).locator('[data-holidays-stale]').count()) === 1 && text.includes('کسِ دیگری') && text.includes('دوباره بخوانید')
      && (await page.locator('[role="dialog"]').count()) === 0, text.slice(0, 500));
  await card(page).locator('[data-holidays-reload]').click();
  await page.waitForTimeout(1000);
  text = await card(page).innerText();
  check('«دوباره بخوان» ⇒ جدولِ تازهٔ سرور (روزی که دیگری افزود)، ویرایشگر بسته، هشدار رفت',
    text.includes('روزِ استقلال') && (await card(page).locator('[data-holidays-editor]').count()) === 0 && (await card(page).locator('[data-holidays-stale]').count()) === 0, text.slice(0, 500));

  //  viewer: می‌بیند، ویرایش نه (مرز در سرور است — console-holidays.mjs)
  const adminTok = await page.evaluate(() => localStorage.getItem('hlp.token'));
  await fetch(`${BASE}/api/auth/users`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${adminTok}` },
    body: JSON.stringify({ username: 'view1', password: 'HolViewer!2026', role: 'viewer' }) });
  const vctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const vpage = await vctx.newPage();
  vpage.on('pageerror', (e) => jsErrors.push(String(e.message)));
  await vpage.goto(BASE, { waitUntil: 'networkidle' });
  await vpage.fill('input[autocomplete="username"]', 'view1');
  await vpage.fill('input[type="password"]', 'HolViewer!2026');
  await vpage.locator('form button').last().click();
  await vpage.waitForTimeout(1500);
  //  ۱.۵۰.۷۹: صفِ پرِ بدنه‌های بزرگِ پل (‎503 account_server_busy‎، `stations/body-gate.js`) گذراست ⇒ کارت می‌گوید و خودش دوباره می‌خواند
  let busyServed = 0;
  await vpage.route('**/api/account-admin/console/calendar/holidays', (route) => {
    if (busyServed++ > 0) return route.continue();
    return route.fulfill({ status: 503, contentType: 'application/json',
      body: JSON.stringify({ error: 'account_server_busy', message: 'پنل همین حالا پاسخ‌های بزرگِ زیادی از سرورِ حساب می‌خواند — چند ثانیهٔ دیگر دوباره بخوانید' }) });
  });
  await vpage.goto(`${BASE}/shop?tab=settings`, { waitUntil: 'networkidle' });
  await vpage.waitForSelector('[data-card="holidays"]', { timeout: 15000 });
  await vpage.waitForFunction(() => (document.querySelector('[data-card="holidays"]')?.textContent || '').includes('دوباره بخوانید'), null, { timeout: 5000 }).catch(() => {});
  const busyText = await card(vpage).innerText();
  const t503 = Date.now();
  const back = await vpage.waitForSelector('[data-card="holidays"] table', { timeout: 15000 }).then(() => true, () => false);
  check('⛔ ‎503 account_server_busy‎ ⇒ کارت پیام و «خودمان دوباره تلاش می‌کنیم» را می‌گوید و بی کلیک خودش دوباره می‌خواند (جدول برگشت)',
    busyText.includes('چند ثانیهٔ دیگر دوباره بخوانید') && busyText.includes('خودمان دوباره تلاش می‌کنیم') && back && busyServed >= 2,
    `${busyServed} ${Date.now() - t503}ms ${busyText.slice(0, 300)}`);
  const vtext = await card(vpage).innerText();
  check('viewer: جدول و «فقط مدیرِ پنل…»، بی دکمهٔ ویرایش؛ گوشی (۳۹۰px) افقی نمی‌لغزد',
    vtext.includes('نوروز') && vtext.includes('فقط مدیرِ پنل') && (await card(vpage).locator('[data-holidays-edit]').count()) === 0
      && (await vpage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)), vtext.slice(0, 300));
  await vctx.close();

  check('هیچ خطای جاوااسکریپت', jsErrors.length === 0, jsErrors.join(' | '));
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  fake.close();
  await new Promise((r) => setTimeout(r, 400));
  await fsp.rm(tmp, { recursive: true, force: true });
}
if (fail) console.log('\n' + out.slice(-1200));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
