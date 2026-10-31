// ---------------------------------------------------------------------------
//  کنسولِ فروشگاه (فاز ۲) در کرومیومِ واقعی — «نیامده = —، نه صفر»
//      CHROME_PATH=… node test/shop-console-ui.mjs
//
//  پنلِ واقعی + سرورِ حسابِ ساختگی که عمداً **نیمه** جواب می‌دهد: فیلدهای جاافتاده، صفرِ واقعی،
//  خطای بالادست با کدِ خودش، و فاز ۳ ِ نیامده. هر زبانه با کلیکِ واقعی باز می‌شود و سنجیده می‌شود که:
//    ⛔ عددِ نیامده «—» است و صفرِ واقعی «۰» — هیچ‌کدام جای دیگری را نمی‌گیرد؛
//    ⛔ زیرِ کارت منبع و زمان هست؛ خطای بالادست کدِ خودش را نشان می‌دهد؛
//    ⛔ فاز ۳ ِ نیامده «داده در دسترس نیست» با نامِ توانایی است، نه جدولِ خالی یا عدد؛
//    ⛔ کارِ پرهزینه (وارسیِ زنجیره) تأیید می‌خواهد و نتیجه «تأییدشده از سرورِ حساب» است؛
//    ⛔ هیچ خطای جاوااسکریپت، و صفحه راست‌چین.
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
const DAY = 86400e3;
let chainCalls = 0;
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, server: 'online', version: '2.14.4' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', role: 'superadmin' }, serverTime: NOW });   // بی capabilities ⇒ فاز ۳ نیامده
    if (p === '/api/admin/shop-desk/overview') {
      //  ⚠️ `online` عمداً نیامده و `supportUnread` صفرِ واقعی است
      return j(200, { serverTime: NOW - 120e3, onlineWithinMs: 600000, days: 7, expiring: [], support: [],
        counts: { shops: 3, customers: 3, subscribed: 0, expiring: 0, supportOpen: 0, supportUnread: 0 } });
    }
    if (p === '/api/admin/system/health') {
      //  ⚠️ `sync.clientErrors24h` نیامده، `conflicts24h` صفرِ واقعی؛ پشتیبان هیچ‌وقت گرفته نشده (`last: null`)
      return j(200, { status: 'warn', checkedAt: NOW - 180e3, api: { status: 'ok', version: '2.14.4' },
        database: { status: 'ok', latencyMs: 0, driver: 'pglite' },
        queues: { email: { status: 'warn', worker: 'down', queued: 0, failed24h: 2 }, telegram: { status: 'ok' } },
        sync: { status: 'ok', conflicts24h: 0 }, storage: { status: 'unknown' },
        backups: { status: 'warn', enabled: true, count: 0, last: null, ageMs: null } });
    }
    if (p === '/api/admin/system/versions') {
      return j(200, { checkedAt: NOW - 60e3, activeDays: 30, status: 'ok',
        apps: [{ app: 'shop', latest: '', minVersion: '', devices: 5, unknown: 0, belowMin: 0, outdated: null, status: 'ok',
                 versions: [{ version: '2.14.4', devices: 5, lastSeenAt: NOW - 60e3, state: 'current' }] }] });
    }
    if (p === '/api/admin/system/providers') {
      return j(200, { checkedAt: NOW - 30e3, production: true, counts: {},
        providers: [{ id: 'sms', mode: 'log', state: 'mock', missing: [] }, { id: 'email', mode: 'smtp', state: 'incomplete', missing: ['email_pass'] }] });
    }
    if (p === '/api/admin/system/chain-verify') { chainCalls++; return j(200, { ok: true, checkedAt: NOW, total: 4, okCount: 4, brokenCount: 0, broken: [] }); }
    if (p === '/api/admin/release/beta') return j(200, { shops: { ids: ['shop-beta-1'], updatedAt: NOW - DAY, updatedBy: 'boss' }, devices: { ids: [] }, version: 1 });
    if (p === '/api/admin/sync/version-health') return j(200, { app: 'shop', version: u.searchParams.get('version'), installs: 5, crashes: 0 });
    if (p === '/api/admin/sync/errors') return j(503, { error: { code: 'db_unavailable', message: 'دیتابیس در دسترس نیست' } });
    if (p === '/api/admin/sync/status') return j(200, { app: 'shop', devices: [{ device_id: 'dev-1', app_version: '2.14.4', last_seen_at: NOW - 60e3, last_push_at: null, queued_count: 0, behind: 0, conflicts: 0 }] });
    if (p === '/api/admin/shops') {
      return j(200, { total: 3, limit: 25, offset: 0, shops: [
        { id: 'shp-1', name: 'دکانِ یک', status: 'active', owner_email: 'a@x.af', members: 2, sub_status: 'active', plan: 'm1', ends_at: NOW + 9 * DAY },
        { id: 'shp-2', name: 'دکانِ دو', status: 'active', owner_email: 'b@x.af', sub_status: 'trial', ends_at: String(NOW + 3 * DAY) },
      ] });
    }
    if (p === '/api/admin/audit') return j(200, { entries: [{ id: 'aud1', shop_id: 'shp-1', actor_type: 'admin', user_id: 'adm1', action: 'admin.subscription_set', target_type: 'subscription', target_id: 's9', created_at: String(NOW - 3600e3) }] });
    if (p === '/api/admin/plans') return j(200, { plans: [], config: { trial_days: '14' } });
    if (p === '/api/admin/support/threads') return j(200, { threads: [], unread: 0 });
    if (p === '/api/admin/apps') return j(200, { apps: [{ id: 'a1', slug: 'shop', title: 'دکان', status: 'active', keySet: true, keyHint: '••1234', lastCheckAt: NOW, lastOk: true }] });
    if (p.startsWith('/api/admin/sales/') || p === '/api/admin/payments') return j(200, { series: [], payments: [], debts: [], expiring: [], totals: {}, total: 0 });
    return j(404, { error: { code: 'not_found', message: 'این مسیر وجود ندارد' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

const PORT = Number(process.env.TEST_PORT || 4951);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'shop-console-ui-'));
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

let browser;
const jsErrors = [];
try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!CHROME) throw new Error('کرومیوم پیدا نشد — CHROME_PATH را بگذارید');
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', (e) => jsErrors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*\b503\b/.test(m.text())) jsErrors.push(m.text()); });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('input[autocomplete="username"]', 'admin');
  await page.fill('input[type="password"]', 'ShopConsole!2026');
  await page.locator('form button').last().click();
  await page.waitForSelector('aside nav', { timeout: 20000 });

  const main = async () => page.locator('main').innerText();
  const open = async (tab) => {
    await page.goto(`${BASE}/shop${tab ? `?tab=${tab}` : ''}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    //  ‎SHOTS=<پوشه>‎ ⇒ عکسِ هر زبانه، برای دیدنِ چشمی (پیش‌فرض خاموش)
    if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `shop-${tab || 'dash'}.png`), fullPage: true });
    return main();
  };

  console.log('\n── داشبورد ──');
  let body = await open('');
  check('صفحه راست‌چین است', (await page.evaluate(() => document.documentElement.dir)) === 'rtl');
  check('ده زبانهٔ فروشگاه', ['داشبورد', 'فروشگاه‌ها', 'اشتراک‌ها', 'مالی', 'نسخه‌ها', 'سلامت و خطاها', 'تنظیمات و پرچم‌ها', 'یکپارچه‌سازی', 'دفترِ رخداد', 'کدِ شاگرد']
    .every((x) => body.includes(x)), body.slice(0, 300));
  //  ⛔ آنلاین نیامده ⇒ «—»؛ پیامِ نخوانده صفرِ واقعی ⇒ «۰»
  const onlineCard = await page.locator('main .card', { hasText: 'آنلاین' }).first().innerText();
  check('⛔ «آنلاین» ِ نیامده «—» است، نه ۰', /—/.test(onlineCard) && !/(^|\s)۰(\s|$)/.test(onlineCard.split('\n')[1] || ''), onlineCard);
  const unreadCard = await page.locator('main .card', { hasText: 'پیامِ نخوانده' }).first().innerText();
  check('و صفرِ واقعی «۰» است، نه «—»', /۰/.test(unreadCard), unreadCard);
  check('⛔ زیرِ آمارِ داشبورد منبع و زمانِ سرورِ حساب هست',
    body.includes('/api/admin/shop-desk/overview') && body.includes('سنجیدهٔ سرورِ حساب') && body.includes('دقیقه پیش'), body.slice(0, 600));
  const healthCard = await page.locator('main .card', { hasText: 'سلامتِ سرورِ حساب' }).first().innerText();
  check('⛔ کارتِ سلامت: خطای برنامه‌ها نیامده «—»، تعارض صفرِ واقعی «۰»',
    /خطای برنامه‌ها \(۲۴ ساعت\): —/.test(healthCard) && /تعارض \(۲۴ ساعت\): ۰/.test(healthCard), healthCard);
  check('و منبعش ‎/api/admin/system/health‎ با «۳ دقیقه پیش»', healthCard.includes('/api/admin/system/health') && healthCard.includes('۳ دقیقه پیش'), healthCard);

  console.log('\n── فروشگاه‌ها ──');
  body = await open('shops');
  check('فهرستِ دکان‌ها از سرورِ حساب، با «کلِ دکان‌ها»', body.includes('دکانِ یک') && body.includes('کلِ دکان‌های سرورِ حساب: ۳'), body.slice(0, 400));
  const row2 = await page.locator('main tr', { hasText: 'دکانِ دو' }).first().innerText();
  check('⛔ عضوِ نیامده «—»', /—\s*$/.test(row2.trim()), row2);
  await page.locator('main tr', { hasText: 'دکانِ یک' }).first().click();
  await page.waitForTimeout(700);
  body = await main();
  check('پروندهٔ دکان: دستگاهِ همگام‌سازی با نسخه', body.includes('dev-1') && body.includes('2.14.4'), body.slice(0, 500));
  check('⛔ سلامت و تعلیقِ دکان (فاز ۳) «داده در دسترس نیست» با نامِ توانایی',
    (body.match(/داده در دسترس نیست/g) || []).length >= 2 && body.includes('shop-health.v1') && body.includes('shop-suspension.v1'), body.slice(0, 900));

  console.log('\n── نسخه‌ها ──');
  body = await open('versions');
  const outdated = await page.locator('main .card', { hasText: 'کهنه' }).first().innerText();
  check('⛔ «کهنه» وقتی آخرین نسخه ثبت نشده «—» است، نه ۰', /کهنه\s*—/.test(outdated), outdated);
  check('کانالِ آزمایشی برای admin', body.includes('shop-beta-1'), body.slice(0, 400));
  await page.locator('main button', { hasText: 'نصب و خرابی' }).first().click();
  await page.waitForTimeout(500);
  check('سلامتِ یک نسخه با کلیک: نصب ۵ و خرابی ۰', /نصب: ۵ · خرابی: ۰/.test(await main()), (await main()).slice(0, 600));

  console.log('\n── سلامت و خطاها ──');
  body = await open('health');
  check('⛔ خطای بالادست کدِ خودش را نشان می‌دهد (db_unavailable)', body.includes('db_unavailable') && body.includes('دیتابیس در دسترس نیست'), body.slice(0, 900));
  check('⛔ پشتیبانِ هیچ‌وقت‌گرفته «آخرین: —»', body.includes('آخرین: —'), body.slice(0, 900));
  await page.locator('main button', { hasText: 'وارسیِ زنجیرهٔ سابقه' }).first().click();
  await page.waitForTimeout(300);
  check('⛔ کارِ پرهزینه پیش از رفتن تأیید می‌خواهد (هنوز چیزی نرفته)', chainCalls === 0 && (await page.locator('text=ادامه می‌دهید؟').count()) > 0, String(chainCalls));
  await page.getByRole('button', { name: 'تایید' }).click();
  await page.waitForTimeout(700);
  body = await main();
  check('و نتیجه «تأییدشده از سرورِ حساب» است', chainCalls === 1 && body.includes('تأییدشده از سرورِ حساب') && body.includes('همهٔ زنجیره‌ها سالم‌اند'), body.slice(0, 900));

  console.log('\n── تنظیمات، یکپارچه‌سازی، دفتر، مالی ──');
  body = await open('settings');
  check('⛔ پرچم‌ها (فاز ۳) «داده در دسترس نیست» با flags.v1', body.includes('داده در دسترس نیست') && body.includes('flags.v1'), body.slice(0, 600));
  check('روزهای آزمایشی از سرورِ حساب', body.includes('۱۴'), body.slice(0, 900));
  body = await open('integrations');
  check('سرویس‌ها با حالتِ واقعی و فیلدِ کم (بی مقدار)', body.includes('mock') && body.includes('incomplete') && body.includes('email_pass'), body.slice(0, 600));
  check('⛔ کلیدِ برنامه فقط پوشیده', body.includes('••1234') && !/KEY-|secret/i.test(body), body.slice(0, 900));
  body = await open('audit');
  check('دفترِ سرورِ حساب و دفترِ پنل، هر دو با منبع', body.includes('admin.subscription_set') && body.includes('/api/admin/audit') && body.includes('/api/control/audit'), body.slice(0, 900));
  check('و یادداشتِ «انجام‌دهنده» (فاز ۳)', body.includes('actor.v1'));
  body = await open('finance');
  check('مالی: همان «فروش و درآمد» + فاز ۴ «داده در دسترس نیست»', body.includes('داده در دسترس نیست') && body.includes('#411'), body.slice(0, 900));
  await page.goto(`${BASE}/shop?tab=subs&view=sales`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  check('⛔ یک موضوع یک در: ‎?tab=subs&view=sales‎ ⇒ ‎?tab=finance‎', page.url().endsWith('/shop?tab=finance'), page.url());

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
