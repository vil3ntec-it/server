// ---------------------------------------------------------------------------
//  «از پشتیبانی بخواه» در رابطِ پنل، کرومیوم (۱.۵۲.۰) — صندوقِ پشتیبانی: نشانِ «درخواست»، برگهٔ «درخواست‌ها»، کارتِ مشکل و
//  «درستش کن» ِ یک‌کلیکی
//      node test/support-requests-ui.mjs          (SUPPORT_SHOTS=<پوشه> ⇒ عکسِ روشن و تیرهٔ صندوق و کارت)
//
//  سنجیده می‌شود: رشتهٔ دارای درخواست نشانِ «درخواست» دارد؛ برگهٔ «درخواست‌ها» صف را با شمارِ باز نشان می‌دهد و زدنِ ردیف همان
//  گفت‌وگو + کارتِ مشکل را باز می‌کند؛ «روشن کن برای همین دکان» پنجرهٔ تأیید دارد و پس از تأیید **یک** درخواست با همان دکان و
//  کلیدِ یکتایی می‌رود؛ «تمدیدِ اشتراک…» پنجرهٔ عدد و تأیید دارد (‎confirm: true‎، روزها)؛ «حل شد» با تأیید؛ هیچ نامِ درونیِ پرچم
//  و هیچ خطای صفحه.
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
const SHOTS = process.env.SUPPORT_SHOTS || '';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 400)}`);
};

const NOW = Date.now();
const posts = [];
const flag = { key: 'shop.orders', effective: false, explicit: false, hold: false };
const fixes = { r1: [], r2: [] };
const status = { r1: 'open', r2: 'open' };
const THREADS = [
  { id: 'thr_1', app: 'shop', who: 'احمد', status: 'open', unreadAdmin: 1, lastMessage: 'لطفاً سفارشِ آنلاین را برای دکانِ من روشن کنید.', lastSender: 'user',
    createdAt: NOW - 3600e3, updatedAt: NOW - 120e3, shopName: 'دکانِ احمد', shopId: 's1', accountName: 'احمد', accountEmail: 'ahmad@x.af' },
  { id: 'thr_2', app: 'shop', who: 'کریم', status: 'open', unreadAdmin: 0, lastMessage: 'لطفاً اشتراکِ دکانِ من را تمدید کنید.', lastSender: 'user',
    createdAt: NOW - 7200e3, updatedAt: NOW - 3000e3, shopName: 'دکانِ کریم', shopId: 's2' },
];
const req = (id) => (id === 'r1' ? {
  id: 'r1', threadId: 'thr_1', shopId: 's1', shopName: 'دکانِ احمد', who: 'احمد', code: 'flag_off:shop.orders', problem: 'flag_off', param: 'shop.orders',
  title: 'سفارشِ آنلاین برای این دکان خاموش است', fix: 'enable_flag', needsShop: true, lang: 'fa',
  context: { appVersion: '2.14.5', platform: 'android', screen: 'orders:setup' }, status: status.r1, unreadAdmin: 1, createdAt: NOW - 120e3, updatedAt: NOW - 120e3, fixes: fixes.r1,
} : {
  id: 'r2', threadId: 'thr_2', shopId: 's2', shopName: 'دکانِ کریم', who: 'کریم', code: 'subscription_expired', problem: 'subscription_expired', param: '',
  title: 'اشتراکِ این دکان تمام شده است', fix: 'grant_subscription', needsShop: true, lang: 'fa',
  context: { appVersion: '2.14.5', platform: 'desktop', screen: 'locked' }, status: status.r2, unreadAdmin: 0, createdAt: NOW - 3000e3, updatedAt: NOW - 3000e3, fixes: fixes.r2,
});
const msgs = { thr_1: [{ id: 'm1', threadId: 'thr_1', sender: 'user', senderName: 'احمد', body: 'لطفاً سفارشِ آنلاین را برای دکانِ من روشن کنید.', kind: 'text', createdAt: NOW - 120e3 }],
  thr_2: [{ id: 'm2', threadId: 'thr_2', sender: 'user', senderName: 'کریم', body: 'لطفاً اشتراکِ دکانِ من را تمدید کنید.', kind: 'text', createdAt: NOW - 3000e3 }] };
const unknown = new Set();

const fake = http.createServer((rq, res) => {
  const chunks = [];
  rq.on('data', (d) => chunks.push(d));
  rq.on('end', () => {
    const u = new URL(rq.url, 'http://x');
    const p = u.pathname;
    let body = null;
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null; } catch { body = null; }
    const j = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, server: 'online', version: '2.14.5' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: ['actor.v1', 'support-requests.v1'], serverTime: NOW });
    if (p === '/api/admin/support/threads') return j(200, { threads: THREADS, unread: 1 });
    const th = /^\/api\/admin\/support\/threads\/(thr_[12])$/.exec(p);
    if (th) return j(200, { thread: THREADS.find((t) => t.id === th[1]), messages: msgs[th[1]], serverTime: NOW });
    if (p === '/api/admin/support-requests') {
      const st = u.searchParams.get('status') || 'open';
      const all = [req('r1'), req('r2')].filter((r) => st === 'all' || r.status === st);
      return j(200, { requests: all, open: [req('r1'), req('r2')].filter((r) => r.status === 'open').length, unread: 1 });
    }
    const d = /^\/api\/admin\/support-requests\/(r[12])$/.exec(p);
    if (d) {
      return j(200, { request: req(d[1]), messages: msgs[req(d[1]).threadId],
        state: d[1] === 'r1' ? { flag } : { subscription: { status: fixes.r2.length ? 'active' : 'expired', plan: 'm1', daysLeft: fixes.r2.length ? 30 : 0, maxDevices: 3 } } });
    }
    const f = /^\/api\/admin\/support-requests\/(r[12])\/(fix\/[a-z-]+|resolve)$/.exec(rq.method === 'POST' ? p : '');
    if (f) {
      posts.push({ path: p, body, idem: rq.headers['idempotency-key'] || '' });
      const id = f[1];
      if (f[2] === 'resolve') { status[id] = 'resolved'; return j(200, { ok: true, request: req(id), unchanged: false }); }
      if (f[2] === 'fix/enable-flag') {
        flag.effective = true; flag.explicit = true;
        msgs.thr_1.push({ id: 'm3', threadId: 'thr_1', sender: 'admin', senderName: 'پشتیبانی', body: 'پشتیبانی سفارشِ آنلاین را برای دکانِ شما روشن کرد.', kind: 'text', createdAt: Date.now() });
      }
      const fx = { action: f[2].slice(4).replace(/-/g, '_'), result: 'done', by: 'admin', at: Date.now(), before: {}, after: {} };
      fixes[id].push(fx);
      if (body?.resolve) status[id] = 'resolved';
      return j(200, { ok: true, already: false, fix: fx, request: req(id), state: {}, reply: { messageId: 'm3', pushed: 2 } });
    }
    unknown.add(`${rq.method} ${p}`);
    return j(404, { error: { code: 'route_not_found', message: 'این مسیر وجود ندارد' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

const PORT = Number(process.env.TEST_PORT || 4952);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'support-requests-ui-'));
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
const PW = 'Support!UI2026';
const watch = (pg) => {
  pg.on('pageerror', (e) => jsErrors.push(String(e.message)));
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
const shot = async (pg, name) => {
  if (!SHOTS) return;
  await fsp.mkdir(SHOTS, { recursive: true });
  await pg.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!CHROME) throw new Error('کرومیوم پیدا نشد — CHROME_PATH را بگذارید');
  await fetch(`${BASE}/api/auth/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: PW }) });
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(page);
  await page.addInitScript(() => { try { if (!localStorage.getItem('hlp.theme')) localStorage.setItem('hlp.theme', 'light'); } catch { /* */ } });
  await signIn(page, 'admin', PW);

  console.log('\n── ۱) صندوق: نشانِ «درخواست» و برگهٔ «درخواست‌ها» ──');
  await page.goto(`${BASE}/support`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-thread="thr_1"]', { timeout: 15000 });
  check('رشتهٔ دارای درخواستِ باز نشانِ «درخواست» دارد', (await page.locator('[data-thread="thr_1"] [data-sr-badge]').count()) === 1
    && (await page.locator('[data-thread="thr_2"] [data-sr-badge]').count()) === 1);
  const tab = page.locator('[data-sr="mode"] button', { hasText: 'درخواست‌ها' });
  check('برگهٔ «درخواست‌ها» با شمارِ باز (۲)', (await tab.innerText()).includes('۲'), await tab.innerText());
  await tab.click();
  await page.waitForSelector('[data-request="r1"]', { timeout: 15000 });
  const order = await page.locator('[data-request]').evaluateAll((els) => els.map((e) => e.getAttribute('data-request')));
  check('صف: تازه‌ترین بالا، با سرخطِ خواندنی و نامِ دکان', order.join(',') === 'r1,r2'
    && (await page.locator('[data-request="r1"]').innerText()).includes('سفارشِ آنلاین برای این دکان خاموش است')
    && (await page.locator('[data-request="r1"]').innerText()).includes('دکانِ احمد'), order.join(','));

  console.log('\n── ۲) کارتِ مشکل و «روشن کن برای همین دکان» ──');
  await page.locator('[data-request="r1"]').click();
  await page.waitForSelector('[data-problem-card="r1"] [data-sr="state"]', { timeout: 15000 });
  const card = page.locator('[data-problem-card="r1"]');
  let text = await card.innerText();
  check('کارت: سرخط، حالِ زنده («خاموش»)، واقعیت‌ها (نسخه، سکو) و دکمهٔ همان کار', text.includes('سفارشِ آنلاین برای این دکان خاموش است')
    && text.includes('برای همین دکان خاموش است') && text.includes('2.14.5') && text.includes('گوشیِ اندروید') && text.includes('روشن کن برای همین دکان'), text);
  check('گفت‌وگوی همان مشتری کنارِ کارت (پیامِ درخواست)', (await page.locator('[data-chat="conversation"]').innerText()).includes('لطفاً سفارشِ آنلاین را برای دکانِ من روشن کنید.'));
  await shot(page, 'control-center-inbox-card-light');
  await card.locator('[data-fix="enable_flag"]').click();
  await page.waitForSelector('text=روشن کردن برای همین دکان', { timeout: 5000 });
  check('⛔ پیش از تأیید هیچ درخواستی نرفت', posts.length === 0);
  await page.locator('[role="dialog"] button.btn-primary').last().click();
  await page.waitForFunction(() => document.querySelector('[data-problem-card="r1"] [data-sr="state"]')?.textContent?.includes('روشن است'), null, { timeout: 15000 });
  const p1 = posts.find((x) => x.path.endsWith('/fix/enable-flag'));
  check('تأیید ⇒ یک درخواست با همان دکان، `resolve` و کلیدِ یکتایی (بسته به کاربرِ پنل)', posts.length === 1 && p1?.body?.shopId === 's1' && p1.body.resolve === true
    && /^u\d+\.pnl-[0-9a-f]{32}$/.test(p1.idem), JSON.stringify(posts));
  await page.waitForFunction(() => document.querySelector('[data-chat="conversation"]')?.textContent?.includes('پشتیبانی سفارشِ آنلاین را برای دکانِ شما روشن کرد.'), null, { timeout: 15000 });
  check('پاسخِ خودکار همان دم در گفت‌وگو نشست', true);
  await shot(page, 'control-center-fixed-light');

  console.log('\n── ۳) «تمدیدِ اشتراک…» (پول ⇒ پنجرهٔ عدد و تأیید) و «حل شد» ──');
  //  حل‌شده‌ها از صفِ «باز» بیرون رفته‌اند؛ r2 هنوز باز است
  await page.waitForSelector('[data-request="r2"]', { timeout: 15000 });
  await page.locator('[data-request="r2"]').click();
  await page.waitForSelector('[data-problem-card="r2"] [data-fix="grant_subscription"]', { timeout: 15000 });
  text = await page.locator('[data-problem-card="r2"]').innerText();
  check('کارتِ اشتراک: «اکنون: اشتراک تمام شده» و دکمهٔ «تمدیدِ اشتراک…»', text.includes('تمام شده') && text.includes('تمدیدِ اشتراک'), text);
  await page.locator('[data-problem-card="r2"] [data-fix="grant_subscription"]').click();
  await page.waitForSelector('[data-sr="days"]', { timeout: 5000 });
  check('⛔ پنجره هشدارِ پول دارد و پیش از «تأیید و انجام» هیچ درخواستی نرفت',
    (await page.locator('text=این کار پول و اشتراکِ').count()) >= 1 && posts.length === 1);
  await page.locator('[data-sr="days"]').fill('45');
  if (SHOTS) await shot(page, 'control-center-money-confirm-light');
  await page.getByRole('button', { name: 'تأیید و انجام' }).click();
  await page.waitForFunction(() => document.querySelector('[data-problem-card="r2"]')?.textContent?.includes('روزِ مانده'), null, { timeout: 15000 });
  const p2 = posts.find((x) => x.path.endsWith('/fix/grant-subscription'));
  check('تمدید ⇒ ‎confirm: true‎، ‎days: 45‎ و همان دکان', p2?.body?.confirm === true && p2.body.days === 45 && p2.body.shopId === 's2', JSON.stringify(p2));

  //  «حل شد» با تأیید (درخواستِ دوباره‌بازشده)
  status.r1 = 'open';
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-sr="mode"] button', { hasText: 'درخواست‌ها' }).click();
  await page.waitForSelector('[data-request="r1"]', { timeout: 15000 });
  await page.locator('[data-request="r1"]').click();
  await page.waitForSelector('[data-problem-card="r1"] [data-sr="resolve"]', { timeout: 15000 });
  const before = posts.length;
  await page.locator('[data-problem-card="r1"] [data-sr="resolve"]').click();
  await page.locator('[role="dialog"] button.btn-primary').last().click();
  await page.waitForFunction(() => !document.querySelector('[data-problem-card="r1"] [data-sr="resolve"]'), null, { timeout: 15000 });
  const p3 = posts.slice(before).find((x) => x.path.endsWith('/resolve'));
  check('«حل شد» با تأیید ⇒ یک درخواست با همان دکان و کلید؛ دکمه می‌رود', posts.length === before + 1 && p3?.body?.shopId === 's1' && /^u\d+\.pnl-/.test(p3.idem), JSON.stringify(posts.slice(before)));

  check('هیچ نامِ درونیِ پرچم روی صفحه نیست', !(await page.locator('body').innerText()).includes('shop.orders'));
  //  داشبوردِ پس از ورود درهای دیگری را می‌پرسد که این سرورِ ساختگی ندارد — فقط درهای پشتیبانی سنجیده می‌شوند
  const missing = [...unknown].filter((x) => /support/.test(x));
  check('هیچ خطای صفحه و هیچ درِ پشتیبانیِ ناشناخته', jsErrors.length === 0 && missing.length === 0, `${jsErrors.join(' | ')} ${missing.join(' ')}`);

  if (SHOTS) {
    const dark = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await dark.addInitScript(() => { try { localStorage.setItem('hlp.theme', 'dark'); } catch { /* */ } });
    await signIn(dark, 'admin', PW);
    await dark.goto(`${BASE}/support`, { waitUntil: 'networkidle' });
    await dark.locator('[data-sr="mode"] button', { hasText: 'درخواست‌ها' }).click();
    await dark.locator('[data-sr="filters"]').waitFor();
    //  همهٔ درخواست‌ها (حل‌شده هم) تا کارتِ «درست شد» دیده شود
    status.r1 = 'open';
    await dark.reload({ waitUntil: 'networkidle' });
    await dark.locator('[data-sr="mode"] button', { hasText: 'درخواست‌ها' }).click();
    await dark.waitForSelector('[data-request="r1"]', { timeout: 15000 });
    await dark.locator('[data-request="r1"]').click();
    await dark.waitForSelector('[data-problem-card="r1"] [data-sr="state"]', { timeout: 15000 });
    await shot(dark, 'control-center-inbox-card-dark');
  }
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  await browser?.close().catch(() => {});
  server.kill('SIGTERM');
  fake.close();
  await new Promise((r) => setTimeout(r, 300));
  await fsp.rm(tmp, { recursive: true, force: true });
}
if (fail) console.log('\n' + out.slice(-1500));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
