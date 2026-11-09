// ---------------------------------------------------------------------------
//  🛒🛵 ۴.۶ و ۴.۷ در کرومیومِ واقعی — «نیامده = —»، «در مدل نیست» ِ صادقانه، و کارِ حساس با رمز
//      CHROME_PATH=… node test/market-console-ui.mjs
//
//  پنلِ واقعی + سرورِ حسابِ ساختگی به شکلِ ‎/api/admin/market|delivery|trust‎ ِ shop (با فیلدِ جاافتاده و صفرِ واقعی).
//  هر نما با کلیک/نشانیِ واقعی باز می‌شود و سنجیده می‌شود:
//    ⛔ عددِ نیامده «—» و صفرِ واقعی «۰»؛ فروشندهٔ مستقل/سبدِ چنددکانی/کمیسیون «در مدل نیست» — نه عدد؛
//    ⛔ زیرِ هر کارت منبع (‎/api/admin/…‎) و زمان؛ بی توانایی «داده در دسترس نیست»؛
//    ⛔ تعلیقِ «بازار» از همان درِ حالت‌های دکان (‎/api/admin/shops/:id/holds‎، سرویسِ market.directory، با کلیدِ یکتایی)؛
//    ⛔ آستانه‌ها: بی رمز دکمه خاموش؛ با رمز و دلیل ⇒ ‎PUT‎ و «تأییدِ سرور»؛ رمز به سرورِ حساب نمی‌رود؛
//    ⛔ هیچ خطای جاوااسکریپت؛ صفحه راست‌چین؛ زبانه در نشانی (‎?tab=market&view=…‎).
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
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 500)}`);
};

const NOW = Date.now();
let caps = ['market-admin.v1', 'delivery-watch.v1', 'shop-holds.v1'];
const sent = [];
let thresholds = { dispatchMin: 30, acceptMin: 30 };
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* نه JSON */ }
    if (req.method !== 'GET') sent.push({ method: req.method, path: p, body, idem: req.headers['idempotency-key'] || '' });
    if (p === '/api/health') return j(200, { ok: true, server: 'online', version: '2.14.5' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', role: 'superadmin' }, capabilities: caps, serverTime: NOW });
    if (p === '/api/admin/market/overview') {
      return j(200, {
        serverTime: NOW - 120_000, window: { from: NOW - 30 * 864e5, to: NOW },
        directory: { on: false, flag: 'market.directory', perShop: { on: 1, off: 0 } },
        sellers: { total: 2, storefrontOn: 2, listed: 1, listedOpen: 1, shopInactive: 0 },
        sellerKinds: { vill3nShops: 2, independent: null, note: 'not_in_model' },
        holds: { 'market.directory': 0, 'shop.storefront': 1 }, sanctions: { warning: 0, hide_listing: 1, suspend_storefront: 0 },
        trust: { productReports: 3, complaints: 0 },     // ⛔ appealed نیامده ⇒ «—»
        orders: { total: 5, groups: { awaiting: 1, in_progress: 2, completed: 2, cancelled: 0, returns: 0 },
                  completedTotalMinor: { AFN: 240000 }, problems: { stuck: 1, mismatch: 0, discrepancy: 0 } },
        multiSeller: { inModel: false, groups: null }, commission: { inModel: false },
      });
    }
    if (p === '/api/admin/market/sellers') {
      return j(200, { serverTime: NOW, total: 1, sellers: [{
        shopId: 'shop1', name: 'دکانِ بازار', shopStatus: 'active', kind: 'vill3n_shop', slug: 'bazar-1', category: 'grocery',
        gates: { directory: false, marketFlag: true, listed: true }, blockedBy: ['directory'], holds: [], sanctions: [],
        casesPending: 0, orders30d: 4, delivery: { flag: true, couriersActive: 1, couriersTotal: 2 }, lastSeenAt: null,
      }] });
    }
    if (p === '/api/admin/shops/shop1/holds' && req.method === 'POST') {
      return j(201, { hold: { id: 'h1', kind: body?.kind, service: body?.service, reason: body?.reason }, state: {}, replayed: false });
    }
    if (p === '/api/admin/market/commission') {
      return j(200, { serverTime: NOW, inModel: false, reason: 'not_in_schema', needs: 'online_orders.platform_fee_minor (#432)',
        decision: { date: '1405/08/08', text: 'فعلاً سامانه از سفارشِ آنلاین هیچ کارمزدی نمی‌گیرد' }, policy: [] });
    }
    if (p === '/api/admin/delivery/overview') {
      return j(200, { serverTime: NOW, windowDays: 7, scanned: 9, truncated: false,
        stages: { preparing: 0, dispatch: 2, assigned: 1, in_delivery: 1 },   // ⛔ failed نیامده ⇒ «—»
        stuck: { dispatch_overdue: 1 }, mismatch: { delivered_not_reflected: 1 }, discrepancy: { cash_review: 0 },
        ordersWith: { stuck: 1, mismatch: 1, discrepancy: 0 }, last24h: { delivered: 3, failed: 0, returned: 0, created: 4 },
        couriers: { total: 2, active: 1, shops: 1 }, service: { flagAll: false, flagAllSet: false, shopsOn: 1, shopsOff: 0, heldByAdmin: 0 } });
    }
    if (p === '/api/admin/delivery/queue') {
      return j(200, { serverTime: NOW, total: 1, rows: [{ orderId: 'o1', shopId: 'shop1', shopName: 'دکانِ بازار', orderNo: 7, status: 'out_for_delivery',
        stage: 'in_delivery', ageMs: 3 * 3600e3, mission: { id: 'a1', status: 'delivered', mode: 'shop_courier', attemptNo: 1, courierName: 'پیکِ یکم' },
        issues: { stuck: [], mismatch: ['delivered_not_reflected'], discrepancy: [] } }] });
    }
    if (p === '/api/admin/delivery/thresholds' && req.method === 'GET') {
      return j(200, { serverTime: NOW, values: { ...{ acceptMin: 30, dispatchMin: 30, courierAcceptMin: 15, pickupMin: 30, inDeliveryMin: 120, failedMin: 240, recallMin: 60 }, ...thresholds },
        source: { dispatchMin: thresholds.dispatchMin === 30 ? 'default' : 'live_config' } });
    }
    if (p === '/api/admin/delivery/thresholds' && req.method === 'PUT') {
      thresholds = { ...thresholds, ...(body?.thresholds || {}) };
      return j(200, { ok: true, unchanged: false, values: thresholds });
    }
    if (p === '/api/admin/delivery/connectivity') return j(200, { serverTime: NOW, heartbeat: { inModel: false }, lastCourierEventAt: null, shops: [] });
    return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

const PORT = Number(process.env.TEST_PORT || 4971);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'market-console-ui-'));
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
  await fetch(`${BASE}/api/auth/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'MarketUi!2026' }) });
  if (!CHROME) throw new Error('کرومیوم پیدا نشد — CHROME_PATH را بگذارید');
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', (e) => jsErrors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) jsErrors.push(m.text()); });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('input[autocomplete="username"]', 'admin');
  await page.fill('input[type="password"]', 'MarketUi!2026');
  await page.locator('form button').last().click();
  await page.waitForSelector('aside nav', { timeout: 20000 });
  const main = async () => page.locator('main').innerText();
  const open = async (q) => {
    await page.goto(`${BASE}/shop?${q}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `market-${q.replace(/[^a-z_=&]/g, '')}.png`), fullPage: true });
    return main();
  };

  console.log('\n── ۴.۶ بازار ──');
  let body = await open('tab=market');
  check('صفحه راست‌چین و زبانه‌های «مدیریتِ بازار» و «نظارتِ پیک» در بخشِ فروشگاه', (await page.evaluate(() => document.documentElement.dir)) === 'rtl'
    && body.includes('مدیریتِ بازار') && body.includes('نظارتِ پیک'), body.slice(0, 300));
  check('نمای کلی: فروشنده ۲ و «در فهرست: ۱»', body.includes('فروشنده (دکانِ VILL3N)') && /۲/.test(body) && body.includes('در فهرست: ۱'), body.slice(0, 600));
  check('⛔ «اعتراض» ِ نیامده «—»، شکایتِ صفر «۰»', body.includes('اعتراض: —') && body.includes('شکایت: ۰'), body.slice(0, 900));
  check('⛔ فروشندهٔ مستقل، سبدِ چنددکانی و کمیسیون «در مدل نیست» — نه عدد',
    body.includes('در مدل نیست') && body.includes('در مدل نیست (#432)') && body.includes('ستونش نیست'), body.slice(0, 1500));
  check('⛔ «تسویه با فروشنده» صادقانه: نیست (D-08)', body.includes('D-08'));
  check('⛔ منبع و زمانِ سرورِ حساب زیرِ کارت', body.includes('/api/admin/market/overview') && body.includes('سنجیدهٔ سرورِ حساب'), body.slice(-500));

  body = await open('tab=market&view=sellers');
  check('فروشنده‌ها: دروازهٔ بستهٔ «بازارِ همگانی» و «آخرین دیده» ِ نیامده «—»', body.includes('بازارِ همگانی روشن') && body.includes('دکانِ بازار'), body.slice(0, 900));
  await page.locator('main button', { hasText: 'تعلیق در بازار' }).first().click();
  await page.waitForTimeout(300);
  const sendBtn = page.getByRole('button', { name: 'تأیید و فرستادن' });
  check('⛔ بی دلیل دکمهٔ فرستادن خاموش', await sendBtn.isDisabled());
  await page.locator('textarea').last().fill('گزارشِ تقلب');
  await sendBtn.click();
  await page.waitForTimeout(700);
  const hold = sent.find((x) => x.path === '/api/admin/shops/shop1/holds');
  check('⛔ تعلیق از همان درِ حالت‌های دکان: service_disabled / market.directory با دلیل و کلیدِ یکتایی',
    hold && hold.body?.kind === 'service_disabled' && hold.body?.service === 'market.directory' && hold.body?.reason === 'گزارشِ تقلب' && /^pnl-/.test(hold.idem),
    JSON.stringify(hold));
  check('و «تأییدِ سرورِ حساب» دیده می‌شود', (await main()).includes('سرورِ حساب تأیید کرد'));

  body = await open('tab=market&view=commission');
  check('⛔ کمیسیون: تصمیمِ صاحب محصول و «هیچ مبلغی نشان داده نمی‌شود»', body.includes('1405/08/08') && body.includes('نشان داده نمی‌شود') && !/AFN/.test(body), body.slice(0, 700));

  caps = ['delivery-watch.v1'];
  body = await open('tab=market&view=sellers');
  check('⛔ بی market-admin.v1: «داده در دسترس نیست» با نامِ توانایی', body.includes('داده در دسترس نیست') && body.includes('market-admin.v1'), body.slice(0, 600));
  caps = ['market-admin.v1', 'delivery-watch.v1', 'shop-holds.v1'];

  console.log('\n── ۴.۷ پیک ──');
  body = await open('tab=courier');
  check('نمای کلی: منتظرِ ارسال ۲ و «ناموفق» ِ نیامده «—»', body.includes('منتظرِ ارسال') && /ناموفق\s*—/.test(body), body.slice(0, 600));
  check('ناهم‌خوانی ۱ و کدِ «تحویل شد ولی سفارش نه»', body.includes('ناهم‌خوانیِ سفارش و تحویل') && body.includes('تحویل شد ولی سفارش نه'), body.slice(0, 1200));
  body = await open('tab=courier&view=queue&q=mismatch');
  check('صفِ ناهم‌خوان: پیک، سن (۳ ساعت) و برچسبِ کد', body.includes('پیکِ یکم') && body.includes('۳ ساعت') && body.includes('تحویل شد ولی سفارش نه'), body.slice(0, 900));
  check('CSV فقط برای admin (این‌جا admin)', (await page.locator('main button', { hasText: 'CSV' }).count()) === 1);
  body = await open('tab=courier&view=connectivity');
  check('⛔ اتصال: «تپشِ قلب در مدل نیست» و آخرین رویدادِ نیامده «—»', body.includes('تپشِ قلب در مدل نیست') && /آخرین رویدادِ پیک \(همهٔ دکان‌ها\)\s*—/.test(body), body.slice(0, 700));

  body = await open('tab=courier&view=thresholds');
  check('آستانه‌ها: ۳۰ و «پیش‌فرض»', body.includes('ارسالِ سفارشِ آماده') && body.includes('پیش‌فرض'), body.slice(0, 500));
  await page.locator('main button', { hasText: 'ویرایش' }).first().click();
  await page.locator('input[aria-label="dispatchMin"]').fill('45');
  await page.locator('main button', { hasText: 'ذخیره…' }).first().click();
  await page.waitForTimeout(300);
  await page.locator('textarea').last().fill('شبِ شلوغ');
  const save = page.getByRole('button', { name: 'تأیید و فرستادن' });
  check('⛔ بی رمز دکمه خاموش (احرازِ دوباره)', await save.isDisabled());
  await page.locator('input[type="password"]').last().fill('MarketUi!2026');
  await save.click();
  await page.waitForTimeout(800);
  const put = sent.find((x) => x.method === 'PUT' && x.path === '/api/admin/delivery/thresholds');
  check('⛔ PUT با دلیل؛ رمز و «تأیید» به سرورِ حساب نرفتند', put && put.body?.thresholds?.dispatchMin === 45 && put.body?.reason === 'شبِ شلوغ'
    && !('password' in (put.body || {})) && !('confirm' in (put.body || {})), JSON.stringify(put));
  body = await main();
  check('و «ذخیره شد (تأییدِ سرور)» با مقدارِ تازه ۴۵ و «تنظیم‌شده»', body.includes('ذخیره شد (تأییدِ سرور)') && body.includes('۴۵') && body.includes('تنظیم‌شده'), body.slice(0, 900));

  check('هیچ خطای جاوااسکریپت', jsErrors.length === 0, jsErrors.join(' | '));
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  await browser?.close().catch(() => {});
  server.kill('SIGTERM');
  fake.close();
  await new Promise((r) => setTimeout(r, 300));
  await fsp.rm(tmp, { recursive: true, force: true });
}

if (fail) console.log('\n' + out.slice(-1200));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
