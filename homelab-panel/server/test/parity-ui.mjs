// ---------------------------------------------------------------------------
//  S11 «هم‌ترازی با ‎/admin/‎» (۱.۵۰.۸۰) در کرومیومِ واقعی — چهار کارتِ تازه
//      CHROME_PATH=… node test/parity-ui.mjs        (محلی، مثلِ holidays-ui و staff-bank-ui)
//
//  پنلِ واقعی + سرورِ حسابِ ساختگی به شکلِ main ِ shop. با کلیکِ واقعی:
//    ⛔ کانالِ آزمایشی (نسخه‌ها): شناسهٔ ناجور ⇒ «ذخیره» بسته؛ دلیل + تأیید + دوکلیک ⇒ یک PUT با فقط فهرستِ عوض‌شده و نسخهٔ دیده‌شده؛
//       نسخهٔ کهنه (کسِ دیگری نوشت) ⇒ «دوباره بخوانید» و هیچ PUT
//    ⛔ دانلود: نشانیِ ‎javascript:‎ ِ ذخیره‌شده فقط متن است (هیچ پیوند)، نشانیِ تازهٔ نادرست ⇒ «ذخیره» بسته، فقط فیلدِ عوض‌شده می‌رود
//    ⛔ مصرفِ پیام (سلامت): بازه به سرورِ حساب می‌رود؛ نامِ HTML متن
//    ⛔ پشتیبان‌های دکان (پرونده): فهرست و «دانلود و حذف از پنل نیست»؛ برچسبِ HTML متن
//    ⛔ viewer: می‌بیند، دکمهٔ نوشتن نه؛ گوشی (۳۹۰px) افقی نمی‌لغزد؛ هیچ ‎<img>‎ ِ تزریقی و هیچ خطای جاوااسکریپت
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
const DAY = 86400e3;
const xss = (n) => `<img src=x onerror="window.__xss=${n}">`;
const betaPuts = [];
const dlPuts = [];
const usageDays = [];
let beta = { shops: ['s1', 'shop-old'], devices: ['dev-1'], version: 4 };
const cfg = {
  shop: { url: 'javascript:window.__xss=2', version: '2.14.5', notes: xss(1), minVersion: '2.10.0' },
  pump: { url: 'https://dl.vill3n.top/pump-1.4.0.exe', version: '1.4.0', notes: '', minVersion: '' },
};
const dls = () => ['shop', 'pump'].map((a) => ({ app: a, title: a === 'shop' ? 'برنامهٔ دکان' : 'برنامهٔ پمپ', ...cfg[a] }));

const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    let b = null;
    try { b = JSON.parse(raw || 'null'); } catch { /* */ }
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, server: 'online', version: '2.14.5' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: ['actor.v1'], serverTime: NOW });
    if (p === '/api/admin/release/beta') {
      const cur = () => ({ shops: { ids: beta.shops, updatedAt: NOW - DAY, updatedBy: 'boss' }, devices: { ids: beta.devices, updatedAt: 0, updatedBy: '' }, version: beta.version });
      if (req.method === 'GET') return j(200, cur());
      betaPuts.push(b);
      const changed = [];
      for (const f of ['shops', 'devices']) if (b?.[f] && JSON.stringify(b[f]) !== JSON.stringify(beta[f])) { beta[f] = b[f]; beta.version += 1; changed.push(f); }
      return void setTimeout(() => j(200, { ok: true, changed, ...cur() }), 300);
    }
    if (p === '/api/downloads') return j(200, { downloads: dls(), apps: [], serverTime: NOW });
    if (p === '/api/admin/downloads' && req.method === 'PUT') {
      dlPuts.push(b);
      for (const k of ['url', 'version', 'notes', 'minVersion']) if (b?.[k] !== undefined) cfg[b.app][k] = b[k];
      return j(200, { downloads: dls().filter((d) => d.app === b.app), apps: [] });
    }
    if (p === '/api/admin/system/notify-usage') {
      usageDays.push(u.searchParams.get('days'));
      return j(200, {
        days: Number(u.searchParams.get('days')) || 7, since: NOW - 7 * DAY, checkedAt: NOW,
        channels: [{ channel: 'sms', unitMicros: 446000, capMicros: 2230000 }, { channel: 'push', unitMicros: 0, capMicros: 1000000 }],
        totals: { sent: 3, costMicros: 892000, costCap: 1, rateLimited: 0, shops: 1 },
        shops: [{ shopId: 's1', name: xss(3), sent: 3, costMicros: 892000, byChannel: { sms: { sent: 2, costMicros: 892000, last24hMicros: 892000 }, push: { sent: 1, costMicros: 0, last24hMicros: 0 } },
          costCap: 1, rateLimited: 0, nearCap: ['sms'] }],
        shopsTruncated: false, truncated: false,
        codes: { currency: 'AFN', unitCostMinor: 150, total: { attempts: 5, sent: 4, failed: 1, mock: 0, other: 0, parts: 4, costMinor: 600 }, byPurpose: [] },
      });
    }
    if (p === '/api/admin/accounts/shop/s1/backups') {
      return j(200, { app: 'shop', backups: [{ id: 'bk_1', app: 'shop', bytes: 2048, sha256: 'a'.repeat(64), label: xss(4), kind: 'auto', appVersion: '2.14.5', createdAt: NOW - 3600e3, name: 'shop-1405.vbk' }],
        stats: { app: 'shop', count: 1, usedBytes: 2048, lastAt: NOW - 3600e3, keep: 7, quotaBytes: 50e6, maxBytes: 20e6, freeBytes: 50e6 - 2048, paid: true, source: 'subscription' } });
    }
    //  پوستهٔ همان صفحه‌ها (داشبوردِ پس از ورود، پرونده‌ی دکان) — همان شکلِ shop
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
    if (p === '/api/admin/sales/expiring') return j(200, { expiring: [], days: 7, serverTime: NOW });
    if (p === '/api/admin/shops') return j(200, { shops: [{ id: 's1', name: 'دکانِ یک', owner_name: 'احمد', owner_email: 'a@b.af', status: 'active', created_at: NOW - 9e8 }], total: 1 });
    if (p === '/api/admin/sync/status') return j(200, { app: 'shop', devices: [] });
    if (p === '/api/admin/shops/s1/staff-perms') return j(200, { shop: { id: 's1', name: 'دکانِ یک' }, perms: { v: 1, catalog: [], roles: {}, members: [] }, devices: [] });
    if (p === '/api/admin/system/versions') return j(200, { checkedAt: NOW, activeDays: 30, apps: [] });
    if (p === '/api/admin/support/threads') return j(200, { threads: [], unread: 0 });
    return j(404, { error: { code: 'not_found', message: 'این مسیر وجود ندارد' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

const PORT = Number(process.env.TEST_PORT || 4985);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'parity-ui-'));
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
const card = (pg, id) => pg.locator(`[data-card="${id}"]`);
//  ‎404‎ ِ کارت‌های دیگرِ همان صفحه‌ها (سرورِ ساختگی همه را ندارد) و ‎409‎ ِ «نسخهٔ کهنه» (رابط باید زردش کند) خطای صفحه نیستند
const watch = (pg) => {
  pg.on('pageerror', (e) => jsErrors.push(String(e.message)));
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*\b(404|409)\b/.test(m.text())) jsErrors.push(m.text()); });
};
const loginAs = async (pg, user, pw) => {
  await pg.goto(BASE, { waitUntil: 'networkidle' });
  await pg.fill('input[autocomplete="username"]', user);
  await pg.fill('input[type="password"]', pw);
  const dash = Promise.all(['/api/account-admin/sales/summary', '/api/account-admin/sales/expiring'].map((s) =>
    pg.waitForResponse((r) => r.url().startsWith(BASE + s), { timeout: 20000 }))).catch(() => {});
  await pg.locator('form button').last().click();
  await pg.waitForSelector('aside nav', { timeout: 20000 }).catch(() => {});
  await dash;
  await pg.waitForLoadState('networkidle');
};
try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!CHROME) throw new Error('کرومیوم پیدا نشد — CHROME_PATH را بگذارید');
  await fetch(`${BASE}/api/auth/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'Parity!2026' }) });
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  watch(page);
  await loginAs(page, 'admin', 'Parity!2026');
  const dialogText = () => page.locator('[role="dialog"]').innerText();

  console.log('\n── کانالِ آزمایشی (نسخه‌ها و انتشار) ──');
  await page.goto(`${BASE}/shop?tab=versions`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-card="beta"] [data-beta-ids]', { timeout: 15000 });
  let text = await card(page, 'beta').innerText();
  check('فهرست‌ها و نسخه از سرورِ حساب', text.includes('s1') && text.includes('shop-old') && text.includes('dev-1') && (text.includes('۴') || text.includes('4')), text.slice(0, 300));
  await card(page, 'beta').locator('[data-beta-edit]').click();
  const shopsIn = card(page, 'beta').locator('[data-beta-input="shops"]');
  const save = card(page, 'beta').locator('[data-beta-save]');
  check('ویرایشِ بی تغییر ⇒ «ذخیره» بسته', await save.isDisabled());
  await shopsIn.fill('s1\nshop-new\nدکانِ');
  await page.waitForTimeout(80);
  check('⛔ شناسهٔ ناجور ⇒ خطای همان شناسه و «ذخیره» بسته', (await card(page, 'beta').locator('[data-beta-error]').count()) > 0 && await save.isDisabled()
    && (await card(page, 'beta').locator('[data-beta-error]').innerText()).includes('دکانِ'));
  await shopsIn.fill('s1, shop-new');
  await page.waitForTimeout(80);
  check('شناسه‌های درست (ویرگول هم) ⇒ «ذخیره» باز', !(await save.isDisabled()) && (await card(page, 'beta').locator('[data-beta-error]').count()) === 0);
  await save.click();
  await page.waitForSelector('[role="dialog"]');
  const dt = await dialogText();
  const send = page.getByRole('button', { name: 'تأیید و فرستادن' });
  check('پنجرهٔ حساس: اثر پیش از تأیید (یک افزوده، یک برداشته، «هر نسخهٔ تازهٔ main») و بی دلیل بسته',
    await send.isDisabled() && dt.includes('main') && /[۱1] افزوده/.test(dt) && /[۱1] برداشته/.test(dt), dt.slice(0, 300));
  await page.locator('[role="dialog"] textarea').fill('آزمونِ نسخهٔ بتا با دکانِ تازه');
  await send.dblclick();
  await page.waitForTimeout(1500);
  text = await card(page, 'beta').innerText();
  check('⛔ دوکلیک ⇒ یک PUT با فقط فهرستِ عوض‌شده (دکان‌ها) و نسخهٔ دیده‌شده؛ «تأییدشده از سرورِ حساب: نسخهٔ ۵»',
    betaPuts.length === 1 && JSON.stringify(betaPuts[0]) === JSON.stringify({ shops: ['s1', 'shop-new'], reason: 'آزمونِ نسخهٔ بتا با دکانِ تازه' })
      && text.includes('تأییدشده از سرورِ حساب') && (text.includes('۵') || text.includes('5')) && text.includes('shop-new') && !text.includes('shop-old'),
    `${JSON.stringify(betaPuts)} ${text.slice(0, 300)}`);

  await card(page, 'beta').locator('[data-beta-edit]').click();
  await card(page, 'beta').locator('[data-beta-input="devices"]').fill('dev-1\ndev-2');
  beta = { ...beta, shops: [...beta.shops, 'shop-other'], version: beta.version + 1 };   //  «کسِ دیگری» همین حالا نوشت
  await card(page, 'beta').locator('[data-beta-save]').click();
  await page.waitForSelector('[role="dialog"]');
  await page.locator('[role="dialog"] textarea').fill('دستگاهِ آزمونِ تازه');
  await page.getByRole('button', { name: 'تأیید و فرستادن' }).click();
  await page.waitForTimeout(1200);
  text = await card(page, 'beta').innerText();
  check('⛔ نسخهٔ کهنه ⇒ پنجره بسته، «کسِ دیگری … عوض کرد — ویرایشِ شما نوشته نشد» و **هیچ** PUT',
    betaPuts.length === 1 && (await card(page, 'beta').locator('[data-beta-stale]').count()) === 1 && text.includes('کسِ دیگری') && (await page.locator('[role="dialog"]').count()) === 0,
    text.slice(0, 400));
  await card(page, 'beta').locator('[data-beta-reload]').click();
  await page.waitForTimeout(1000);
  text = await card(page, 'beta').innerText();
  check('«دوباره بخوان» ⇒ فهرستِ تازهٔ سرور (دکانی که دیگری افزود)، ویرایشگر بسته', text.includes('shop-other') && (await card(page, 'beta').locator('[data-beta-editor]').count()) === 0, text.slice(0, 300));

  console.log('\n── نشانیِ دانلود و نسخه ──');
  await page.waitForSelector('[data-card="downloads"] [data-dl-url]', { timeout: 15000 });
  text = await card(page, 'downloads').innerText();
  check('⛔ نشانیِ ‎javascript:‎ ِ ذخیره‌شده فقط متن است — هیچ پیوندی در کارت؛ یادداشتِ HTML متن، هیچ ‎<img>‎',
    text.includes('javascript:window.__xss=2') && (await card(page, 'downloads').locator('a').count()) === 0 && (await card(page, 'downloads').locator('img').count()) === 0
      && text.includes('<img src=x') && text.includes('2.14.5') && text.includes('2.10.0'), text.slice(0, 400));
  await card(page, 'downloads').locator('[data-dl-edit]').click();
  const urlIn = card(page, 'downloads').locator('[data-dl-input="url"]');
  const dlSave = card(page, 'downloads').locator('[data-dl-save]');
  await urlIn.fill('javascript:alert(1)');
  await page.waitForTimeout(80);
  check('⛔ نشانیِ تازهٔ نادرست (‎javascript:‎) ⇒ خطا و «ذخیره» بسته', (await card(page, 'downloads').locator('[data-dl-error]').count()) > 0 && await dlSave.isDisabled());
  await urlIn.fill('https://dl.vill3n.top/shop-2.14.6.apk');
  await card(page, 'downloads').locator('[data-dl-input="version"]').fill('2.14.6');
  await page.waitForTimeout(80);
  check('نشانی و نسخهٔ درست ⇒ «ذخیره» باز', !(await dlSave.isDisabled()));
  await dlSave.click();
  await page.waitForSelector('[role="dialog"]');
  const ddt = await dialogText();
  check('پنجرهٔ حساس: فیلدهای عوض‌شده، نشانیِ تازه و «به همهٔ مشتری‌ها» پیش از تأیید', ddt.includes('shop-2.14.6.apk') && ddt.includes('همهٔ مشتری‌ها') && ddt.includes('آخرین نسخه'), ddt.slice(0, 300));
  await page.locator('[role="dialog"] textarea').fill('انتشارِ ۲.۱۴.۶');
  await page.getByRole('button', { name: 'تأیید و فرستادن' }).dblclick();
  await page.waitForTimeout(1200);
  text = await card(page, 'downloads').innerText();
  check('⛔ یک PUT با فقط نشانی و نسخه (نه یادداشت و حداقل) و «تأییدشده از سرورِ حساب»',
    dlPuts.length === 1 && JSON.stringify(dlPuts[0]) === JSON.stringify({ app: 'shop', url: 'https://dl.vill3n.top/shop-2.14.6.apk', version: '2.14.6' })
      && text.includes('تأییدشده از سرورِ حساب') && text.includes('shop-2.14.6.apk'), `${JSON.stringify(dlPuts)} ${text.slice(0, 300)}`);
  await card(page, 'downloads').locator('[data-dl-app="pump"]').click();
  await page.waitForTimeout(200);
  text = await card(page, 'downloads').innerText();
  check('برنامهٔ دوم (پمپ) همان کارت', text.includes('pump-1.4.0.exe') && text.includes('1.4.0'), text.slice(0, 300));

  console.log('\n── مصرف و هزینهٔ پیام (سلامت) ──');
  await page.goto(`${BASE}/shop?tab=health`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-card="notify-usage"] [data-usage-shop]', { timeout: 15000 });
  text = await card(page, 'notify-usage').innerText();
  check('جمع، هزینه به دلار، سقف و هشدارِ «نزدیکِ سقف»؛ نامِ HTML ِ دکان متن، هیچ ‎<img>‎',
    text.includes('<img src=x') && (await card(page, 'notify-usage').locator('img').count()) === 0 && text.includes('$') && text.includes('نزدیکِ سقفِ') && text.includes('پیامکِ کدها'),
    text.slice(0, 400));
  await card(page, 'notify-usage').locator('[data-usage-days]').selectOption('31');
  await page.waitForTimeout(800);
  check('بازه ⇒ همان ‎days‎ به سرورِ حساب (پیش‌فرض ۷، سپس ۳۱)', usageDays[0] === '7' && usageDays.at(-1) === '31', JSON.stringify(usageDays));

  console.log('\n── پشتیبان‌های همین دکان (پرونده) ──');
  await page.goto(`${BASE}/shop?tab=shops&shop=s1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-card="tenant-backups"] [data-backup-label]', { timeout: 15000 });
  text = await card(page, 'tenant-backups').innerText();
  check('فهرست و سهم؛ «دانلود و حذف از پنل نیست» (صادقانه)؛ برچسبِ HTML متن، هیچ ‎<img>‎ و هیچ دکمهٔ حذف/دانلود',
    text.includes('shop-1405.vbk') && text.includes('دانلودِ پشتیبانِ مشتری') && text.includes('<img src=x') && (await card(page, 'tenant-backups').locator('img').count()) === 0
      && (await card(page, 'tenant-backups').locator('button').count()) === 0 && text.includes('KB'), text.slice(0, 400));

  console.log('\n── viewer و گوشی ──');
  const adminTok = await page.evaluate(() => localStorage.getItem('hlp.token'));
  await fetch(`${BASE}/api/auth/users`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${adminTok}` },
    body: JSON.stringify({ username: 'view1', password: 'ParViewer!2026', role: 'viewer' }) });
  const vctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const vpage = await vctx.newPage();
  watch(vpage);
  await loginAs(vpage, 'view1', 'ParViewer!2026');
  await vpage.goto(`${BASE}/shop?tab=versions`, { waitUntil: 'networkidle' });
  await vpage.waitForSelector('[data-card="downloads"] [data-dl-url]', { timeout: 15000 });
  const vb = await card(vpage, 'beta').innerText();
  const noScroll = async () => vpage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check('viewer (نسخه‌ها): کانالِ آزمایشی «فقط مدیرِ پنل»، دانلود دیده می‌شود بی دکمهٔ ویرایش؛ ۳۹۰px افقی نمی‌لغزد',
    vb.includes('فقط مدیرِ پنل') && (await card(vpage, 'beta').locator('[data-beta-edit]').count()) === 0 && (await card(vpage, 'downloads').locator('[data-dl-edit]').count()) === 0
      && (await card(vpage, 'downloads').innerText()).includes('فقط مدیرِ پنل') && await noScroll(), vb.slice(0, 200));
  await vpage.goto(`${BASE}/shop?tab=health`, { waitUntil: 'networkidle' });
  await vpage.waitForSelector('[data-card="notify-usage"] [data-usage-shop]', { timeout: 15000 });
  check('viewer (سلامت): مصرفِ پیام دیده می‌شود؛ ۳۹۰px افقی نمی‌لغزد', await noScroll());
  await vpage.goto(`${BASE}/shop?tab=shops&shop=s1`, { waitUntil: 'networkidle' });
  await vpage.waitForSelector('[data-card="tenant-backups"] [data-backup-label]', { timeout: 15000 });
  check('viewer (پرونده): پشتیبان‌های دکان؛ ۳۹۰px افقی نمی‌لغزد', await noScroll());
  check('⛔ viewer هیچ نوشتنی نفرستاد', betaPuts.length === 1 && dlPuts.length === 1);
  const xssHit = [await page.evaluate(() => window.__xss), await vpage.evaluate(() => window.__xss)];
  await vctx.close();

  check('⛔ هیچ اسکریپتِ تزریقی ندوید (‎onerror‎ / ‎javascript:‎)', xssHit.every((x) => x === undefined), JSON.stringify(xssHit));
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
