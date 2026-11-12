// ---------------------------------------------------------------------------
//  TEN-04 (۱.۵۰.۹۸) در کرومیومِ واقعی: «اجازهٔ دسترسیِ پشتیبانی لازم است» در همهٔ جاهای دادهٔ خصوصیِ دکان
//      CHROME_PATH=… node test/grant-ui.mjs        (محلی، مثلِ trust-ui)
//
//  پنلِ واقعی + سرورِ حسابِ ساختگی به شکلِ shop ‎claude/batch-55‎ (`support-grant-read.v1` + پرچمِ ‎admin.support_grant‎). با کلیکِ واقعی،
//  هر دو حالت (اجازه لازم / اجازه هست) و سرورِ کهنه:
//    ⛔ پروندهٔ دکان ← «کارکنان، مجوزها و دستگاه‌ها»: پیامِ روشن، نه خطای خام (کدِ ‎grant_required‎ یا «خطا»)؛ پیوندِ همان صفحه ⇒ کارتِ
//       «دسترسیِ پشتیبانی» (فوکوس و دیده)
//    ⛔ بانکِ عکس ← جزئیاتِ دسته: همان پیام؛ پیوند ⇒ پروندهٔ همان دکان و کارتِ «دسترسیِ پشتیبانی»
//    ⛔ وضعیتِ Sync ← تعارض‌ها: همان پیام، نه «تعارضی نیست»
//    ⛔ اشتراک‌ها ← پروندهٔ مشتری ← دستگاه‌ها: «پنهان»، نه «هیچ دستگاهی ثبت نشده»؛ پیوند ⇒ همان کارت
//    ⛔ بیننده: همان پیام با «فقط مدیرِ پنل درخواست می‌کند»؛ گوشی (۳۹۰px) افقی نمی‌لغزد؛ اجازه ⇒ همه همان امروز؛ هیچ خطای جاوااسکریپت
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
let caps = ['actor.v1', 'staff-perms.v1', 'image-changes.v1', 'support-access.v1'];
let enforced = false;
let granted = false;
const unknown = new Set();
const needGrant = () => caps.includes('support-grant-read.v1') && enforced && !granted;
const GRANT_ERR = { error: { code: 'grant_required', message: 'برای این کار اجازهٔ زندهٔ دسترسیِ پشتیبانی به همین دکان لازم است' } };
const SHOP = { id: 'shpA', name: 'دکانِ کریم', owner_name: 'کریم', owner_email: 'k@x.af', owner_user_id: 'usr_1', status: 'active', created_at: NOW - 9e8, members: 1, sub_status: 'none' };

const fake = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const j = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, server: 'online', version: '2.14.5' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: caps, serverTime: NOW });
    if (p === '/api/admin/shops') return j(200, { shops: [SHOP], total: 1 });
    if (p === '/api/admin/shops/shpA/staff-perms') {
      if (needGrant()) return j(403, GRANT_ERR);
      return j(200, { shop: { id: 'shpA', name: 'دکانِ کریم' }, perms: { v: 1, catalog: [], roles: {}, members: [{ id: 'm1', userId: 'usr_1', name: 'کریمِ صاحب', role: 'owner', status: 'active' }] },
        devices: [{ id: 'dev_1', name: 'گوشیِ کریم', platform: 'android', status: 'active', member: { userId: 'usr_1', role: 'owner', name: 'کریمِ صاحب' } }] });
    }
    if (p === '/api/admin/shops/shpA/access-grants') return j(200, { grants: [] });
    if (p === '/api/admin/shops/shpA/images/changes') {
      return j(200, { enabled: true, changes: [{ id: 'chg_1', note: 'عکس‌های تازه', status: 'applied', item_count: 1, created_by: 'usr_1', created_at: NOW - 5000 }] });
    }
    if (p === '/api/admin/shops/shpA/images/changes/chg_1') {
      if (needGrant()) return j(403, GRANT_ERR);
      return j(200, { change: { id: 'chg_1', note: 'عکس‌های تازه', status: 'applied', item_count: 1, created_at: NOW - 5000,
        items: [{ product_id: 'rice-sela', before: null, after: { source: 'bank', image_id: 'img_1', version: 1 } }] } });
    }
    if (p === '/api/admin/sync/conflicts') {
      if (u.searchParams.get('app') !== 'pump' && needGrant()) return j(403, GRANT_ERR);
      return j(200, { conflicts: [{ id: 5, table: 'products', row_id: 'rice', field: 'price', winner_device: 'dev-win', loser_device: 'dev-lose', created_at: NOW }] });
    }
    if (p === '/api/admin/sync/status') return j(200, { app: 'shop', devices: [] });
    if (p === '/api/admin/sync/errors') return j(200, { errors: [] });
    if (p === '/api/admin/shops/shpA') {
      const r = needGrant();
      return j(200, { shop: { id: 'shpA', name: 'دکانِ کریم', status: 'active', createdAt: NOW - 9e8, ownerUserId: 'usr_1' },
        location: r ? null : { lat: 34.5, lng: 69.2, at: NOW }, members: [], entitlement: { source: 'none' }, subscriptions: [], counts: {},
        ...(r ? { restricted: { code: 'grant_required', hidden: ['location'] } } : {}) });
    }
    if (p === '/api/admin/users/usr_1') {
      const r = needGrant();
      return j(200, { user: { id: 'usr_1', name: 'کریم', email: 'k@x.af', phone: '0700', status: 'active', lastLoginAt: NOW },
        memberships: [{ shop_id: 'shpA', shop_name: 'دکانِ کریم', role: 'owner' }],
        devices: r ? [] : [{ id: 'dev_1', device_uid: 'uid-karim-1', name: 'گوشیِ کریم', last_seen_at: NOW }], locations: [],
        ...(r ? { restricted: { code: 'grant_required', hidden: ['devices', 'locations', 'lastLocation'] } } : {}) });
    }
    if (p === '/api/admin/sales/subscriptions') return j(200, { subscriptions: [] });
    if (p === '/api/admin/payments') return j(200, { payments: [] });
    if (p === '/api/admin/shops/shpA/history') return j(200, { history: [] });
    if (p === '/api/admin/plans') return j(200, { plans: [], config: {} });
    //  داشبورد (صفحهٔ نخستِ پس از ورود) — همان شکلِ ‎admin-sales.js‎ ِ shop
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
    if (p === '/api/admin/support/threads') return j(200, { threads: [], unread: 0 });
    unknown.add(`${req.method} ${p}`);
    return j(404, { error: { code: 'route_not_found', message: 'این مسیر وجود ندارد' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

const PORT = Number(process.env.TEST_PORT || 4949);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'grant-ui-'));
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
  env: { ...process.env, HLP_PORT: String(PORT), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: path.join(tmp, 'data'),
         HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_SITESYNC: '0', HLP_AI_ENABLED: '0', HLP_TUNNEL: '0', HLP_STATIONS: '0',
         HLP_AUTOMATION: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_ACCOUNT_API: `http://127.0.0.1:${fake.address().port}`,
         HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret', HLP_BRIDGE_TIMEOUT_MS: '2000',
         HLP_TG_WATCH_MS: '0', HLP_TG_LONGPOLL: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

let browser;
const jsErrors = [];
const PW = 'Grant!UI2026';
const watch = (pg) => {
  pg.on('pageerror', (e) => jsErrors.push(String(e.message)));
  //  ‎403‎ ِ «اجازه لازم است» خودِ همین آزمون است (رابط باید بگویدش)، و ‎404‎ ِ درهای نبوده در سرورِ حسابِ ساختگی — نه خطای صفحه
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*\b(403|404)\b/.test(m.text())) jsErrors.push(m.text()); });
};
async function signIn(pg, u, pw) {
  await pg.goto(BASE, { waitUntil: 'networkidle' });
  await pg.fill('input[autocomplete="username"]', u);
  await pg.fill('input[type="password"]', pw);
  await pg.locator('form button').last().click();
  await pg.waitForFunction(() => !document.querySelector('input[type="password"]'), null, { timeout: 20000 });
  await pg.waitForLoadState('networkidle');
}
/** کارتِ «دسترسیِ پشتیبانی» ِ همین دکان فوکوس دارد و در دیدِ صفحه است */
const cardInView = (pg) => pg.evaluate(() => {
  const el = document.getElementById('support-access');
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return document.activeElement === el && el.dataset.shop === 'shpA' && r.top < window.innerHeight && r.bottom > 0;
});
const STAFF = '[data-card="shop-staff"]';

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!CHROME) throw new Error('کرومیوم پیدا نشد — CHROME_PATH را بگذارید');
  await fetch(`${BASE}/api/auth/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: PW }) });
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  watch(page);
  await signIn(page, 'admin', PW);

  console.log('\n── ۱) سرورِ حسابِ کهنه (بی ‎support-grant-read.v1‎): همان امروز ──');
  await page.goto(`${BASE}/shop?tab=shops&shop=shpA`, { waitUntil: 'networkidle' });
  await page.waitForFunction((s) => document.querySelector(s)?.textContent?.includes('گوشیِ کریم'), STAFF, { timeout: 15000 });
  check('پروندهٔ دکان: اعضا و دستگاه‌های کارکنان، بی پیامِ اجازه', (await page.locator('[data-grant-required]').count()) === 0
    && (await page.locator(STAFF).innerText()).includes('کریمِ صاحب'));

  console.log('\n── ۲) ‎support-grant-read.v1‎ + پرچمِ روشن، بی اجازه ──');
  caps = [...caps, 'support-grant-read.v1'];
  enforced = true;
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector(`${STAFF} [data-grant-required]`, { timeout: 15000 });
  let text = await page.locator(STAFF).innerText();
  check('کارکنان: «اجازهٔ دسترسیِ پشتیبانی لازم است» با نامِ بخش و راهِ درخواست — نه کدِ خام، نه «خطا»، نه دستگاهِ کهنه',
    text.includes('اجازهٔ دسترسیِ پشتیبانی لازم است') && text.includes('اجازه‌ها و دستگاه‌های کارکنانِ این دکان') && text.includes('کارتِ «دسترسیِ پشتیبانی»')
      && text.includes('پنهان') && !text.includes('grant_required') && !text.includes('کدِ خطا') && !text.includes('گوشیِ کریم'), text.slice(0, 400));
  await page.evaluate(() => window.scrollTo(0, 0));
  const url0 = page.url();
  await page.locator(`${STAFF} [data-grant-link="shpA"]`).click();
  await page.waitForTimeout(900);
  check('پیوند در همان پرونده ⇒ کارتِ «دسترسیِ پشتیبانی» ِ همین دکان فوکوس و دیده (بی بارگذاری و بی رفتن)', await cardInView(page) && page.url() === url0,
    `${page.url()} ${await page.evaluate(() => document.activeElement?.id)}`);

  await page.goto(`${BASE}/shop?tab=imagebank`, { waitUntil: 'networkidle' });
  await page.locator('[data-changes-shop]').fill('shpA');
  await page.getByRole('button', { name: 'نشان بده' }).click();
  await page.waitForSelector('[data-change-open="chg_1"]', { timeout: 15000 });
  await page.locator('[data-change-open="chg_1"]').click();
  await page.waitForSelector('[data-change-detail="chg_1"] [data-grant-required]', { timeout: 15000 });
  text = await page.locator('[data-change-detail="chg_1"]').innerText();
  check('بانکِ عکس ← جزئیاتِ دسته: همان پیام با نامِ بخش؛ فهرستِ دسته‌ها سر جایش', text.includes('اجازهٔ دسترسیِ پشتیبانی لازم است')
    && text.includes('جزئیاتِ این دسته') && !text.includes('grant_required') && (await page.locator('[data-change-open="chg_1"]').count()) === 1, text.slice(0, 300));
  await page.locator('[data-change-detail="chg_1"] [data-grant-link="shpA"]').click();
  await page.waitForSelector('#support-access', { timeout: 15000 });
  await page.waitForTimeout(900);
  check('پیوند ⇒ پروندهٔ همان دکان (‎tab=shops&shop=shpA‎) و کارتِ «دسترسیِ پشتیبانی» فوکوس و دیده',
    /tab=shops/.test(page.url()) && /shop=shpA/.test(page.url()) && await cardInView(page), `${page.url()} ${await page.evaluate(() => document.activeElement?.id)}`);

  await page.goto(`${BASE}/sync`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /تعارض‌ها/ }).first().click();
  await page.locator('input[placeholder^="شناسهٔ حساب"]').fill('shpA');
  await page.waitForSelector('[data-grant-required]', { timeout: 15000 });
  text = await page.locator('main').innerText();
  check('وضعیتِ Sync ← تعارض‌ها: همان پیام (تعارض‌های همین دکان) — نه «تعارضی نیست»', text.includes('اجازهٔ دسترسیِ پشتیبانی لازم است')
    && text.includes('تعارض‌های همگام‌سازیِ این دکان') && !text.includes('تعارضی نیست') && (await page.locator('[data-grant-link="shpA"]').count()) === 1, text.slice(0, 400));

  await page.goto(`${BASE}/shop?tab=subs`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('main')?.textContent?.includes('دکانِ کریم'), null, { timeout: 15000 });
  await page.getByRole('button', { name: 'پرونده' }).first().click();
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await page.locator('[role="dialog"]').getByRole('button', { name: /دستگاه‌ها/ }).click();
  await page.waitForSelector('[role="dialog"] [data-grant-required]', { timeout: 15000 });
  text = await page.locator('[role="dialog"]').innerText();
  check('اشتراک‌ها ← پروندهٔ دکان ← دستگاه‌ها: «پنهان»، نه «هیچ دستگاهی ثبت نشده»؛ پیوند به کارتِ همان دکان',
    text.includes('اجازهٔ دسترسیِ پشتیبانی لازم است') && text.includes('دستگاه‌ها و جای دقیقِ این دکان و صاحبش') && !text.includes('هیچ دستگاهی ثبت نشده')
      && (await page.locator('[role="dialog"] [data-grant-link="shpA"]').count()) === 1, text.slice(0, 400));
  await page.locator('[role="dialog"] [data-grant-link="shpA"]').click();
  await page.waitForSelector('#support-access', { timeout: 15000 });
  await page.waitForTimeout(900);
  check('پیوند ⇒ پنجره بسته، پروندهٔ همان دکان و کارتِ «دسترسیِ پشتیبانی» فوکوس و دیده', (await page.locator('[role="dialog"]').count()) === 0
    && /shop=shpA/.test(page.url()) && await cardInView(page) && await page.evaluate(() => document.body.style.overflow !== 'hidden'), page.url());

  //  بیننده و گوشی
  const adminTok = await page.evaluate(() => localStorage.getItem('hlp.token'));
  await fetch(`${BASE}/api/auth/users`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${adminTok}` },
    body: JSON.stringify({ username: 'view1', password: 'GrantViewer!2026', role: 'viewer' }) });
  const vctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const vpage = await vctx.newPage();
  watch(vpage);
  await signIn(vpage, 'view1', 'GrantViewer!2026');
  await vpage.goto(`${BASE}/shop?tab=shops&shop=shpA`, { waitUntil: 'networkidle' });
  await vpage.waitForSelector(`${STAFF} [data-grant-required]`, { timeout: 15000 });
  text = await vpage.locator(STAFF).innerText();
  check('بیننده (گوشیِ ۳۹۰px): همان پیام با «فقط مدیرِ پنل درخواستش می‌کند»؛ صفحه افقی نمی‌لغزد',
    text.includes('فقط مدیرِ پنل درخواستش می‌کند') && !text.includes('grant_required')
      && await vpage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), text.slice(0, 300));
  await vctx.close();

  console.log('\n── ۳) اجازهٔ زنده ──');
  granted = true;
  await page.goto(`${BASE}/shop?tab=shops&shop=shpA`, { waitUntil: 'networkidle' });
  await page.waitForFunction((s) => document.querySelector(s)?.textContent?.includes('گوشیِ کریم'), STAFF, { timeout: 15000 });
  check('با اجازه: کارکنان و دستگاه‌ها همان امروز، بی پیام', (await page.locator('[data-grant-required]').count()) === 0);
  await page.goto(`${BASE}/sync`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /تعارض‌ها/ }).first().click();
  await page.locator('input[placeholder^="شناسهٔ حساب"]').fill('shpA');
  await page.waitForFunction(() => document.querySelector('main')?.textContent?.includes('dev-lose'), null, { timeout: 15000 });
  check('با اجازه: جدولِ تعارض‌ها', (await page.locator('[data-grant-required]').count()) === 0);
  await page.goto(`${BASE}/shop?tab=subs`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('main')?.textContent?.includes('دکانِ کریم'), null, { timeout: 15000 });
  await page.getByRole('button', { name: 'پرونده' }).first().click();
  await page.locator('[role="dialog"]').getByRole('button', { name: /دستگاه‌ها/ }).click();
  await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent?.includes('uid-karim-1'), null, { timeout: 15000 });
  check('با اجازه: دستگاه‌های صاحبِ دکان در پرونده', (await page.locator('[role="dialog"] [data-grant-required]').count()) === 0);

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
if (unknown.size) console.log(`\n(درهای ناشناختهٔ سرورِ ساختگی: ${[...unknown].join(' · ')})`);
if (fail) console.log('\n' + out.slice(-1200));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
