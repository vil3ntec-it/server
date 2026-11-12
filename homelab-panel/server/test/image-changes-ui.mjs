// ---------------------------------------------------------------------------
//  IMG-PRO-17 (۱.۵۰.۹۶) در کرومیومِ واقعی: «تغییرهای دسته‌ایِ عکسِ یک دکان و برگرداندن» در «فروشگاه ← بانکِ عکس»
//      CHROME_PATH=… node test/image-changes-ui.mjs        (محلی، مثلِ holidays-ui)
//
//  پنلِ واقعی + سرورِ حسابِ ساختگی به شکلِ ‎routes/admin-image-changes.js‎ ِ shop ‎claude/e-rows-13x‎. با کلیکِ واقعی:
//    ⛔ بی `image-changes.v1` ⇒ «سرورِ حساب کهنه است» با نامِ درِ لازم، بی جدول
//    ⛔ شناسهٔ دکانِ نادرست ⇒ «نشان بده» بسته؛ بانکِ خاموشِ دکان ⇒ هشدار، نه جدول؛ دکانِ بی دسته ⇒ «هنوز … نکرده است»
//    ⛔ فهرست و جزئیات از سرور؛ شناسهٔ کالای HTML متن می‌ماند (هیچ ‎<img>‎، هیچ اسکریپت)
//    ⛔ برگرداندن: اثر پیش از تأیید؛ ‎409 changed_since‎ ⇒ نامِ کالاها در پنجره و هیچ؛ دوکلیک ⇒ یک POST با ‎{reason}‎ و کلید؛
//       «تأییدشده از سرورِ حساب» و وضعِ «برگشته»
//    ⛔ viewer فهرست و جزئیات را می‌بیند و دکمهٔ برگرداندن نه؛ گوشی (۳۹۰px) افقی نمی‌لغزد؛ هیچ خطای جاوااسکریپت
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
const posts = [];
const XSS = '<img src=x onerror="window.__xss=1">';
const sel = (id) => ({ source: 'shop', image_id: id, version: 1, match_status: 'confirmed', central_image_id: '', central_version: 0 });
const changes = {
  c1: { id: 'c1', note: 'قفسهٔ چای', status: 'applied', item_count: 2, created_by: 'usr_1', created_at: NOW - 90000,
    rolled_back_by: '', rolled_back_at: null, rollback_reason: '', items: [
      { product_id: 'p1', before: sel('img_old'), after: sel('img_new') }, { product_id: XSS, before: null, after: { source: 'none', image_id: '' } }] },
  c2: { id: 'c2', note: 'قفسهٔ نوشابه', status: 'applied', item_count: 1, created_by: 'usr_1', created_at: NOW - 50000,
    rolled_back_by: '', rolled_back_at: null, rollback_reason: '', items: [{ product_id: 'p1', before: sel('img_new'), after: sel('img_x') }] },
};
const strip = ({ items, ...c }) => c;
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const j = (code, obj, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, server: 'online', version: '2.14.5' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: caps, serverTime: NOW });
    const m = /^\/api\/admin\/shops\/([^/]+)\/images\/changes(?:\/([^/]+))?(\/rollback)?$/.exec(p);
    if (m) {
      if (!caps.includes('image-changes.v1')) return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
      const [, shop, cid, rb] = m;
      if (shop === 'shpOff') return j(200, { shopId: shop, enabled: false, changes: [] });
      if (shop === 'shpNone') return j(200, { shopId: shop, enabled: true, changes: [] });
      if (!cid) return j(200, { shopId: shop, enabled: true, changes: [strip(changes.c2), strip(changes.c1)] });
      const ch = changes[cid];
      if (!ch) return j(404, { error: { code: 'change_not_found', message: 'این دسته در این دکان پیدا نشد' } });
      if (!rb) return j(200, { shopId: shop, change: ch });
      let b = null;
      try { b = JSON.parse(raw || 'null'); } catch { /* */ }
      posts.push({ cid, body: b, idem: String(req.headers['idempotency-key'] || '') });
      if (cid === 'c1' && changes.c2.status === 'applied') {
        return j(409, { error: { code: 'changed_since', message: 'عکسِ بعضی کالاها پس از این دسته دوباره عوض شده است — اول همان تغییرِ تازه‌تر را برگردانید', products: ['p1'] } });
      }
      Object.assign(ch, { status: 'rolled_back', rolled_back_by: 'admin:a1', rolled_back_at: Date.now(), rollback_reason: b?.reason || '' });
      return void setTimeout(() => j(200, { change: ch, already: false }), 300);
    }
    if (p === '/api/admin/image-bank/status') return j(200, { enabled: false });
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
    if (p === '/api/admin/shops') return j(200, { shops: [], total: 0 });
    return j(404, { error: { code: 'not_found', message: 'این مسیر وجود ندارد' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

const PORT = Number(process.env.TEST_PORT || 4965);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'image-changes-ui-'));
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
const card = (pg) => pg.locator('[data-card="image-changes"]');
async function showShop(pg, id) {
  await card(pg).locator('[data-changes-shop]').fill(id);
  await card(pg).locator('form button').click();
  await pg.waitForTimeout(700);
}
async function signIn(pg, u, pw) {
  await pg.goto(BASE, { waitUntil: 'networkidle' });
  await pg.fill('input[autocomplete="username"]', u);
  await pg.fill('input[type="password"]', pw);
  await pg.locator('form button').last().click();
  //  (گوشی منوی کناری ندارد) ⇒ نشانِ ورود: فرمِ رمز رفت
  await pg.waitForFunction(() => !document.querySelector('input[type="password"]'), null, { timeout: 20000 });
  await pg.waitForLoadState('networkidle');
}
try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!CHROME) throw new Error('کرومیوم پیدا نشد — CHROME_PATH را بگذارید');
  await fetch(`${BASE}/api/auth/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'ImgChg!2026' }) });
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', (e) => jsErrors.push(String(e.message)));
  //  ‎409‎ ِ «پس از دسته عوض شده» خطای خودِ همین آزمون است (رابط باید بگویدش)، نه خطای صفحه
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*\b409\b/.test(m.text())) jsErrors.push(m.text()); });
  await signIn(page, 'admin', 'ImgChg!2026');

  console.log('\n── بی `image-changes.v1` ──');
  await page.goto(`${BASE}/shop?tab=imagebank`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-card="image-changes"]', { timeout: 15000 });
  let text = await card(page).innerText();
  check('کارت در «بانکِ عکس» دیده می‌شود (حتی با بانکِ مرکزیِ خاموش) و پیش از شناسه فقط راهنما', text.includes('شناسهٔ دکان را بنویسید') && (await card(page).locator('table').count()) === 0, text.slice(0, 300));
  await card(page).locator('[data-changes-shop]').fill('bad id!');
  check('⛔ شناسهٔ نادرست ⇒ «نشان بده» بسته و راهنمای نویسه‌ها', await card(page).locator('form button').isDisabled() && (await card(page).innerText()).includes('فقط حرف'));
  await showShop(page, 'shpA');
  text = await card(page).innerText();
  check('⛔ «سرورِ حساب کهنه است» با نامِ درِ لازم — بی جدول و بی دستهٔ ساختگی',
    (await card(page).locator('[data-changes-old]').count()) === 1 && text.includes('images/changes') && (await card(page).locator('table').count()) === 0, text.slice(0, 400));

  caps = ['actor.v1', 'image-changes.v1'];
  console.log('\n── با `image-changes.v1` ──');
  await showShop(page, 'shpOff');
  check('بانکِ خاموشِ دکان ⇒ هشدار، نه جدول', (await card(page).locator('[data-changes-off]').count()) === 1 && (await card(page).locator('table').count()) === 0);
  await showShop(page, 'shpNone');
  check('دکانِ بی دسته ⇒ «هنوز تغییرِ دسته‌ای نکرده است»', (await card(page).innerText()).includes('هنوز تغییرِ دسته‌ای نکرده است'));
  await showShop(page, 'shpA');
  text = await card(page).innerText();
  check('فهرست از سرورِ حساب: دو دسته با یادداشت، شمارِ کالا و وضعِ «اعمال‌شده»',
    text.includes('قفسهٔ چای') && text.includes('قفسهٔ نوشابه') && (await card(page).locator('[data-change-status="applied"]').count()) === 2, text.slice(0, 400));

  await card(page).locator('[data-change-open="c1"]').click();
  await page.waitForSelector('[data-change-detail="c1"] table', { timeout: 10000 });
  const det = page.locator('[data-change-detail="c1"]');
  text = await det.innerText();
  check('جزئیات: پیش و پسِ هر کالا به زبانِ آدم («عکسِ پیش‌فرضِ کالا»، «بی عکس»، شناسهٔ عکس)',
    text.includes('img_old') && text.includes('img_new') && text.includes('عکسِ پیش‌فرضِ کالا') && text.includes('بی عکس'), text.slice(0, 400));
  check('⛔ شناسهٔ کالای HTML متن می‌ماند: هیچ ‎<img>‎ ساخته نشد و ‎onerror‎ نَدَوید',
    text.includes('<img src=x') && (await card(page).locator('img').count()) === 0 && (await page.evaluate(() => window.__xss)) === undefined);

  //  اولی پیش از دومی ⇒ ‎409 changed_since‎: پیام با نامِ کالا، هیچ چیز برنگشت
  await det.locator('[data-change-rollback]').click();
  const send = page.getByRole('button', { name: 'تأیید و فرستادن' });
  await page.waitForTimeout(300);
  check('پنجرهٔ حساس: اثر پیش از تأیید (دو کالا، «یا هیچ‌کدام»، اجازهٔ «بازگرداندن») و بی دلیل بسته',
    await send.isDisabled() && (await page.locator('text=یا هیچ‌کدام').count()) > 0 && (await page.locator('text=بازگرداندن').count()) > 0);
  await page.locator('textarea').fill('دستهٔ اشتباه');
  await send.click();
  await page.waitForTimeout(1000);
  const dlg = await page.locator('[role="dialog"]').innerText().catch(() => '');
  check('⛔ ‎409 changed_since‎ ⇒ پنجره باز می‌ماند و نامِ کالای عوض‌شده (p1) را می‌گوید؛ دسته همان «اعمال‌شده»',
    posts.length === 1 && dlg.includes('p1') && dlg.includes('changed_since') && changes.c1.status === 'applied', dlg.slice(0, 300));
  await page.getByRole('button', { name: 'انصراف' }).click();
  await det.locator('button', { hasText: 'بستن' }).click();

  //  دومی ⇒ دوکلیک ⇒ یک POST و «برگشته»
  await card(page).locator('[data-change-open="c2"]').click();
  await page.waitForSelector('[data-change-detail="c2"] table', { timeout: 10000 });
  const det2 = page.locator('[data-change-detail="c2"]');
  await det2.locator('[data-change-rollback]').click();
  await page.waitForTimeout(300);
  await page.locator('textarea').fill('عکس‌های نوشابه اشتباه بود');
  await page.getByRole('button', { name: 'تأیید و فرستادن' }).dblclick();
  await page.waitForSelector('[data-change-done]', { timeout: 10000 });
  await page.waitForTimeout(600);
  text = await card(page).innerText();
  check('⛔ دوکلیک ⇒ یک POST با ‎{reason}‎ و کلیدِ پنجره (بسته به کاربرِ پنل)؛ «تأییدشده از سرورِ حساب» و وضعِ «برگشته» در فهرست و جزئیات',
    posts.length === 2 && posts[1].cid === 'c2' && JSON.stringify(posts[1].body) === JSON.stringify({ reason: 'عکس‌های نوشابه اشتباه بود' }) && /^u\d+\./.test(posts[1].idem)
      && text.includes('تأییدشده از سرورِ حساب') && (await card(page).locator('[data-change-status="rolled_back"]').count()) === 1
      && (await det2.locator('[data-change-rollback]').count()) === 0 && (await det2.innerText()).includes('admin:a1'), `${JSON.stringify(posts).slice(0, 300)} ${text.slice(0, 300)}`);

  //  viewer: می‌بیند، برنمی‌گرداند (مرز در سرور است — console-image-changes.mjs)
  const adminTok = await page.evaluate(() => localStorage.getItem('hlp.token'));
  await fetch(`${BASE}/api/auth/users`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${adminTok}` },
    body: JSON.stringify({ username: 'view1', password: 'ImgViewer!2026', role: 'viewer' }) });
  const vctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const vpage = await vctx.newPage();
  vpage.on('pageerror', (e) => jsErrors.push(String(e.message)));
  await signIn(vpage, 'view1', 'ImgViewer!2026');
  await vpage.goto(`${BASE}/shop?tab=imagebank`, { waitUntil: 'networkidle' });
  await vpage.waitForSelector('[data-card="image-changes"]', { timeout: 15000 });
  await showShop(vpage, 'shpA');
  await card(vpage).locator('[data-change-open="c1"]').click();
  await vpage.waitForSelector('[data-change-detail="c1"] table', { timeout: 10000 });
  const vtext = await card(vpage).innerText();
  check('viewer: فهرست و جزئیات و «فقط مدیرِ پنل…»، بی دکمهٔ برگرداندن؛ گوشی (۳۹۰px) افقی نمی‌لغزد',
    vtext.includes('قفسهٔ چای') && vtext.includes('فقط مدیرِ پنل') && (await card(vpage).locator('[data-change-rollback]').count()) === 0
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
