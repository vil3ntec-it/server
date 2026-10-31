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
/*
 *  ══ چسبِ فاز ۳ ══ نیمهٔ دوم: سرورِ حسابی که `capabilities` را می‌گوید (همان شکل‌های #597): حالت‌های دکان،
 *  سلامتِ واقعی (با فیلدِ نیامده و صفرِ واقعی)، پرچم‌ها با تاریخچه، و کلیدِ سرویس.
 */
let caps = [];
const posted = [];          // { path, body, idem, bearer }
const holds = [];
let svcKey = '';
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, server: 'online', version: '2.14.4' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (req.method === 'POST') {
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { /* نه JSON */ }
      posted.push({ path: p, body, idem: req.headers['idempotency-key'] || '', bearer, actor: req.headers['x-actor-id'] || '' });
    }
    //  بی capabilities ⇒ فاز ۳ نیامده؛ کلیدِ سرویس فقط وقتی همان کلیدِ ساخته‌شده است
    if (p === '/api/admin/me') {
      if (bearer.startsWith('vsk_') && bearer !== svcKey) return j(401, { error: { code: 'invalid_service_key', message: 'کلید' } });
      return j(200, { admin: { id: 'a1', role: 'superadmin' }, serverTime: NOW, ...(caps.length ? { capabilities: caps } : {}) });
    }
    if (caps.length) {
      let m;
      if ((m = /^\/api\/admin\/shops\/([^/]+)\/health$/.exec(p))) {
        //  ⚠️ `errors.lastAt` و `sync.v1.behindMax` نیامده‌اند (null)؛ `errors.last24h` صفرِ واقعی
        return j(200, { shop: { id: m[1], name: 'دکانِ یک', status: 'active' }, at: NOW - 240e3,
          state: { access: holds.some((h) => h.active && h.kind === 'archived') ? 'blocked' : 'open', blockedBy: [], servicesDisabled: [] },
          subscription: { status: 'active', phase: 'active', plan: 'm1', endsAt: NOW + 9 * DAY, daysLeft: 9 },
          sync: { lastSyncAt: NOW - 600e3, v1: { devices: 1, queued: 0, behindMax: null, openConflicts: 0 } },
          devices: [{ engine: 'v1', deviceId: 'dev-h1', appVersion: null, lastSeenAt: NOW - 60e3, lastPushAt: null, queued: 0, behind: 0 }],
          versions: [{ appVersion: null, devices: 1 }], errors: { last24h: 0, last7d: 3, lastAt: null, lastAppVersion: null } });
      }
      if ((m = /^\/api\/admin\/shops\/([^/]+)\/holds$/.exec(p))) {
        if (req.method === 'POST') {
          const b = posted.at(-1).body || {};
          const hold = { id: `shh${holds.length + 1}`, shopId: m[1], kind: b.kind, service: b.service || null, reason: b.reason,
            placedBy: 'svk1', placedActor: { kind: 'panel', id: 'panel:1', name: 'admin' }, placedAt: Date.now(), active: true };
          holds.push(hold);
          return j(201, { hold, state: { access: 'blocked', blockedBy: [b.kind], servicesDisabled: [] }, replayed: false });
        }
        return j(200, { shopId: m[1], state: { access: holds.some((h) => h.active) ? 'blocked' : 'open', blockedBy: holds.filter((h) => h.active).map((h) => h.kind), servicesDisabled: [] },
          open: holds.filter((h) => h.active), history: [...holds].reverse() });
      }
      if ((m = /^\/api\/admin\/shops\/([^/]+)\/holds\/([^/]+)\/lift$/.exec(p))) {
        const h = holds.find((x) => x.id === m[2]);
        Object.assign(h, { active: false, liftedAt: Date.now(), liftReason: posted.at(-1).body?.reason });
        return j(200, { hold: h, state: { access: 'open', blockedBy: [], servicesDisabled: [] }, replayed: false });
      }
      if (p === '/api/admin/flags') {
        return j(200, { scope: 'all', version: 2, items: [{ key: 'shop.orders', value: false, updatedAt: NOW - DAY, updatedBy: 'boss' }],
          known: [{ key: 'shop.orders', scope: 'shop', default: false, what: 'سفارشِ آنلاین' }, { key: 'shop.chat', scope: 'shop', default: false, what: 'گفت‌وگو با مشتری' }] });
      }
      if (p === '/api/admin/flags/history') {
        return j(200, { entries: [{ id: 'l1', scope: 'all', key: 'shop.orders', action: 'set', oldValue: null, newValue: false, changedBy: 'boss',
          actor: { kind: 'panel', id: 'panel:1', name: 'مالکِ پنل' }, reason: 'هنوز نه', at: NOW - DAY }] });
      }
      if (p === '/api/admin/service-keys' && req.method === 'POST') {
        svcKey = `vsk_${'Q'.repeat(43)}`;
        return j(201, { key: svcKey, serviceKey: { id: 'svk1', name: 'پلِ پنلِ خانه', roleCap: 'superadmin', status: 'active', createdAt: NOW }, shownOnce: true });
      }
    }
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
      if (caps.length && u.searchParams.get('q')) {
        return j(200, { total: 1, limit: 25, offset: 0, shops: [
          { id: 'shp-1', name: 'دکانِ یک', status: 'active', owner_email: 'a@x.af', members: 2, sub_status: 'active', plan: 'm1', ends_at: NOW + 9 * DAY, holds: [] }] });
      }
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
  check('⛔ سلامت و حالت‌های دکان (فاز ۳) «داده در دسترس نیست» با نامِ توانایی',
    (body.match(/داده در دسترس نیست/g) || []).length >= 2 && body.includes('shop-health.v1') && body.includes('shop-holds.v1')
      && !body.includes('shop-suspension.v1'), body.slice(0, 900));
  check('⛔ ستونِ «حالت‌های مدیریتی» روی سرورِ کهنه «—» است، نه «بی حالت»', !body.includes('بی حالت'), body.slice(0, 600));

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

  /* ══════════ چسبِ فاز ۳: سرورِ حساب `capabilities` را می‌گوید ══════════ */
  console.log('\n── چسبِ فاز ۳: حالت‌ها، سلامت، پرچم‌ها، کلیدِ سرویس ──');
  caps = ['shop-health.v1', 'shop-holds.v1', 'flags.v1', 'actor.v1', 'service-key.v1'];
  body = await open('shops');
  await page.fill('main input.input', 'یک');
  await page.waitForTimeout(800);
  body = await main();
  check('⛔ با جست‌وجو «شمارِ همین جست‌وجو: ۱» (سرورِ حسابِ تازه total را همان جست‌وجو می‌شمارد)',
    body.includes('شمارِ همین جست‌وجو: ۱') && !body.includes('کلِ دکان‌های سرورِ حساب: ۱'), body.slice(0, 600));
  check('و پالایشِ «حالت» سمتِ سرور دیده می‌شود', (await page.locator('main select', { hasText: 'بایگانی' }).count()) > 0);
  await page.locator('main tr', { hasText: 'دکانِ یک' }).first().click();
  await page.waitForTimeout(800);
  body = await main();
  check('سلامتِ دکان: دستگاه و موتور از شکلِ واقعی', body.includes('dev-h1') && body.includes('v1'), body.slice(0, 900));
  const hc = await page.locator('main .card', { hasText: 'سلامتِ دکان' }).first().innerText();
  check('⛔ خطای ۲۴ساعت صفرِ واقعی «۰»، زمانِ آخرین خطا و «عقب» ِ نیامده «—»',
    /خطا \(۲۴ ساعت\)\s*۰ · ۷ روز: ۳ · —/.test(hc) && /عقب: —/.test(hc), hc.slice(0, 900));
  check('⛔ زمانِ سنجش همان `at` ِ سرورِ حساب: «سنجیدهٔ سرورِ حساب … (۴ دقیقه پیش)»', hc.includes('/api/admin/shops/:id/health') && hc.includes('۴ دقیقه پیش'), hc.slice(-300));

  await page.locator('main button', { hasText: 'گذاشتنِ حالت' }).first().click();
  await page.waitForTimeout(300);
  await page.locator('select[aria-label="نوع"]').selectOption('archived');
  const sendBtn = page.getByRole('button', { name: 'تأیید و فرستادن' });
  check('⛔ بی دلیل دکمهٔ فرستادن بسته است و اثرِ همان حالت پیش از تأیید دیده می‌شود',
    await sendBtn.isDisabled() && (await page.locator('text=بایگانی و دسترسی بسته می‌شود').count()) > 0);
  await page.locator('textarea').fill('ab');
  check('دلیلِ دو نویسه هم نه', await sendBtn.isDisabled());
  const before = posted.length;
  await page.locator('textarea').fill('دکان بسته شد');
  await sendBtn.dblclick();
  await page.waitForTimeout(900);
  const sent = posted.slice(before).filter((x) => x.path === '/api/admin/shops/shp-1/holds');
  check('⛔ دو کلیک ⇒ یک درخواست، بدنهٔ بالادست {kind, reason} و کلیدِ یکتایی در سرآیند',
    sent.length === 1 && JSON.stringify(sent[0].body) === JSON.stringify({ kind: 'archived', reason: 'دکان بسته شد' }) && /^pnl-[0-9a-f]{32}$/.test(sent[0].idem),
    JSON.stringify(sent));
  body = await main();
  check('و نتیجه «تأییدشده از سرورِ حساب» با حالتِ باز در جدول', body.includes('تأییدشده از سرورِ حساب') && body.includes('بایگانی') && body.includes('دکان بسته شد'), body.slice(0, 900));
  await page.locator('main button', { hasText: 'برداشتن' }).first().click();
  await page.waitForTimeout(300);
  await page.locator('textarea').fill('دوباره باز شد');
  await page.getByRole('button', { name: 'تأیید و فرستادن' }).click();
  await page.waitForTimeout(900);
  const lifted = posted.filter((x) => x.path === '/api/admin/shops/shp-1/holds/shh1/lift');
  check('برداشتن: همان حالت، با دلیل و کلیدِ یکتایی', lifted.length === 1 && lifted[0].body?.reason === 'دوباره باز شد' && lifted[0].idem.startsWith('pnl-'),
    JSON.stringify(lifted));

  body = await open('settings');
  check('پرچم‌ها: نوشته‌شده با مقدار، شناختهٔ نانوشته «نوشته نشده» با پیش‌فرض', body.includes('shop.orders') && body.includes('shop.chat') && body.includes('نوشته نشده'), body.slice(0, 900));
  check('تاریخچهٔ پرچم: پیشین ⇒ تازه، «انجام‌دهنده» و دلیل', body.includes('مالکِ پنل') && body.includes('هنوز نه') && body.includes('null'), body.slice(0, 1200));

  body = await open('integrations');
  check('کلیدِ سرویس: راهِ امروز «رمزِ ارشدِ مشترک» و دلیل no_key', body.includes('رمزِ ارشدِ مشترک') && body.includes('no_key'), body.slice(0, 900));
  await page.locator('main button', { hasText: 'ساختنِ کلید' }).first().click();
  await page.waitForTimeout(300);
  const mk = page.getByRole('button', { name: 'تأیید و فرستادن' });
  await page.locator('textarea').fill('جای رمزِ مشترک');
  check('⛔ بی رمزِ پنل (احرازِ دوباره) دکمه بسته است', await mk.isDisabled());
  await page.locator('.modal input[type="password"], [role="dialog"] input[type="password"], input[autocomplete="current-password"]').last().fill('ShopConsole!2026');
  await mk.click();
  await page.waitForTimeout(1200);
  body = await main();
  check('ساخته شد: «کلیدِ سرویس + انجام‌دهنده» و شناسهٔ کلید', body.includes('کلیدِ سرویس + انجام‌دهنده') && body.includes('svk1') && body.includes('تأییدشده از سرورِ حساب'), body.slice(0, 900));
  const html = await page.content();
  check('⛔ خودِ کلید هیچ‌جای صفحه نیست', !html.includes('vsk_') && !html.includes('Q'.repeat(20)));
  const made = posted.find((x) => x.path === '/api/admin/service-keys');
  check('⛔ کلید از راهِ پیشین (ارشد) ساخته شد و دلیل رفت', made?.bearer === 'tok-1' && made?.body?.reason === 'جای رمزِ مشترک' && made?.body?.roleCap === 'superadmin', JSON.stringify(made));
  body = await open('health');
  const viaKey = posted.filter((x) => x.path === '/api/admin/system/chain-verify');
  await page.locator('main button', { hasText: 'وارسیِ زنجیرهٔ سابقه' }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'تایید' }).click();
  await page.waitForTimeout(800);
  const viaKey2 = posted.filter((x) => x.path === '/api/admin/system/chain-verify').slice(viaKey.length);
  check('و از آن پس پل با کلید و «انجام‌دهنده»ِ همین کاربر', viaKey2.length === 1 && viaKey2[0].bearer === svcKey && /^panel:\d+$/.test(viaKey2[0].actor), JSON.stringify(viaKey2));

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
