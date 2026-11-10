// ---------------------------------------------------------------------------
//  ممیزی §۳-۴ (۱.۵۰.۷۵) در کرومیومِ واقعی: کارکنان/دستگاه‌ها در پروندهٔ دکان و ماژولِ «بانکِ عکس»
//      CHROME_PATH=… node test/staff-bank-ui.mjs        (محلی، مثلِ shop-console-ui)
//
//  پنلِ واقعی + سرورِ حسابِ ساختگی به شکلِ ‎admin-staff-perms.js‎ و ‎admin-image-bank.js‎ ِ shop. با کلیکِ واقعی:
//    ⛔ پرونده: اعضا با نقش و مجوزِ مؤثرِ سرورِ حساب، دستگاه‌ها، «برگرداندن پشتیبانی نمی‌شود» (نه دکمهٔ بی‌عمل)
//    ⛔ ازکارانداختن: بی دلیل بسته، دوکلیک ⇒ یک درخواست با دلیل، «تأییدشده از سرورِ حساب» فقط پس از پاسخ
//    ⛔ مهلتِ پل روی ازکارانداختن ⇒ «نتیجه معلوم نیست» (زرد)، نه «شکست»
//    ⛔ بانکِ عکس: پرچمِ خاموش ⇒ «روشن نیست»؛ روشن ⇒ صف با بندانگشتی (با سرآیندِ نشست، بی توکن در نشانی)، جزئیات،
//       و «تأیید و انتشار» با دلیل؛ viewer دکمهٔ بازبینی و ازکارانداختن نمی‌بیند
//    ⛔ هیچ خطای جاوااسکریپت، بی راز در صفحه
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
const posted = [];
const fileHits = [];
let bankOn = false;
let slowDisable = false;
const disabled = new Set();
//  ۱.۵۰.۷۷: سرورِ حسابِ تازه (shop #1025) — برگرداندنِ دستگاه، صفحه‌بندی و کلیدِ یکتاییِ خودش
let caps = ['actor.v1'];
const enabled = [];
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a0f1b8a10000000049454e44ae426082', 'hex');
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, server: 'online', version: '2.14.5' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (req.method !== 'GET') { let b = null; try { b = JSON.parse(raw || 'null'); } catch { /* */ } posted.push({ path: p, body: b }); }
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: caps, serverTime: NOW });
    if (p === '/api/admin/shops') return j(200, { shops: [{ id: 'shp-1', name: 'دکانِ یک', owner_name: 'احمد', owner_email: 'a@b.af', status: 'active', created_at: NOW - 9e8, members: 2 }], total: 1 });
    if (p === '/api/admin/sync/status') return j(200, { app: 'shop', devices: [] });
    if (p === '/api/admin/shops/shp-1/staff-perms') {
      const off = Number(u.searchParams.get('offset')) || 0;
      const page = caps.includes('staff-perms.v1') ? { limit: 50, offset: off, membersTotal: 60, devicesTotal: 2, nextOffset: off ? null : 50 } : undefined;
      return j(200, { shop: { id: 'shp-1', name: 'دکانِ یک' }, ...(page ? { page } : {}), perms: { v: 1,
        catalog: [{ key: 'sales.discount', edit: 'restrict', caps: ['maxPct'], approvable: true, display: false, defaults: {} }],
        roles: { cashier: { 'sales.discount': { mode: 'approve' } } },
        members: [
          { id: 'm1', userId: 'u1', name: 'احمد', role: 'owner', status: 'active', layer: {}, effective: { 'sales.discount': { mode: 'allow', caps: {} } } },
          { id: 'm2', userId: 'u2', name: 'کریم', role: 'cashier', status: 'active', layer: { 'sales.discount': { mode: 'allow', caps: { maxPct: 5 } } },
            effective: { 'sales.discount': { mode: 'approve', caps: { maxPct: 5 } } } },
        ] },
        devices: [
          { id: 'dev-a', name: 'گوشیِ کریم', platform: 'android', status: disabled.has('dev-a') ? 'revoked' : 'active', createdAt: NOW - 9e8, lastSeenAt: NOW - 6e4,
            disabledAt: disabled.has('dev-a') ? NOW : null, blockedAttempts: 0, lastBlockedAt: null, push_token: 'SECRET-PUSH', member: { userId: 'u2', role: 'cashier', name: 'کریم' } },
          { id: 'dev-b', name: 'تبلتِ دخل', platform: 'android', status: 'active', createdAt: NOW - 9e8, lastSeenAt: NOW - 6e4, disabledAt: null, blockedAttempts: 0,
            lastBlockedAt: null, member: { userId: 'u2', role: 'cashier', name: 'کریم' } },
        ] });
    }
    const en = /^\/api\/admin\/shops\/shp-1\/staff-perms\/devices\/([^/]+)\/enable$/.exec(p);
    if (en && req.method === 'POST') {
      enabled.push({ id: en[1], idem: String(req.headers['idempotency-key'] || '') });
      disabled.delete(en[1]);
      return j(200, { ok: true, id: en[1] });
    }
    const dm = /^\/api\/admin\/shops\/shp-1\/staff-perms\/devices\/([^/]+)\/disable$/.exec(p);
    if (dm) {
      if (slowDisable) return;   //  مهلتِ پل می‌گذرد
      disabled.add(dm[1]);
      return void setTimeout(() => j(200, { ok: true, id: dm[1], disabledAt: Date.now(), sessionsRevoked: 3 }), 300);
    }
    if (p === '/api/admin/image-bank/status') return j(200, { enabled: bankOn, rows_max: 1000, roles: ['main'], licenses: ['licensed'], resume: false });
    if (p.startsWith('/api/admin/image-bank/') && !bankOn) return j(403, { error: { code: 'image_bank_disabled', message: 'بانکِ مرکزیِ تصاویر روشن نیست' } });
    if (p === '/api/admin/image-bank/review') {
      return j(200, { items: [{ id: 'img_1', status: 'NEEDS_REVIEW', space: 'pending', role: 'main', from_shop: true, created_at: NOW - 6e4, match_status: 'exact',
        quality_flags: [], duplicate_of: [], license: { status: 'licensed', source: 'shop', commercial_use: true },
        product: { id: 'bp1', name: 'روغنِ آفتاب‌گردان', gtin: '6260000000001', status: 'active' }, candidates: [], version: 1, versions_pending: 0,
        file: { url: '/api/admin/image-bank/file/img_1/1/thumb', mime: 'image/png', width: 1, height: 1 } }], next_cursor: null });
    }
    if (p === '/api/admin/image-bank/images/img_1') {
      return j(200, { id: 'img_1', space: 'pending', status: 'NEEDS_REVIEW', role: 'main', current_version: 1, search_enabled: false, match_status: 'exact',
        license: { source: 'shop', status: 'licensed', commercial_use: true }, origin: { shop_id: 'shp-1', consent_by: 'u_secret', consent_at: NOW - 1e5 },
        duplicate_of: [], quality_flags: [], product: { id: 'bp1', name: 'روغنِ آفتاب‌گردان', gtin: '6260000000001' },
        versions: [{ version: 1, review: 'needs_review', mime: 'image/png', width: 1, height: 1, urls: { original: '/api/admin/image-bank/file/img_1/1/original', thumb: '/api/admin/image-bank/file/img_1/1/thumb' } }] });
    }
    if (p === '/api/admin/image-bank/reports') return j(200, { items: [] });
    if (p === '/api/admin/image-bank/search') return j(200, { items: [], next_cursor: null, as_of: NOW });
    if (/^\/api\/admin\/image-bank\/file\//.test(p)) { fileHits.push(p); res.setHeader('content-type', 'image/png'); return res.end(PNG); }
    if (p === '/api/admin/image-bank/images/img_1/approve') return j(200, { id: 'img_1', space: 'central', status: 'APPROVED', version: 1 });
    //  داشبورد (صفحهٔ نخستِ پس از ورود) — همان شکلِ ‎GET /api/admin/sales/summary|expiring‎ ِ shop (‎routes/admin-sales.js‎):
    //  درآمد به تفکیکِ دوره/بخش/ارز، ۱۲ ماه، شمارِ اشتراک‌ها؛ و فهرستِ رو به پایان با ‎days‎ ِ همان پرسش
    if (p === '/api/admin/sales/summary') {
      const empty = { shop: {}, pump: {} };
      const series = Array.from({ length: 12 }, (_, i) => {
        const d = new Date(NOW); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); d.setUTCMonth(d.getUTCMonth() - (11 - i));
        const to = new Date(d); to.setUTCMonth(to.getUTCMonth() + 1);
        return { month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, from: d.getTime(), to: to.getTime(), shop: {}, pump: {}, payments: 0 };
      });
      return j(200, { revenue: { today: empty, month: empty, year: empty }, series,
        counts: { shop: { active: 1, expired: 0, suspended: 0, tenants: 1 }, pump: { active: 0, expired: 0, suspended: 0, tenants: 0 } }, serverTime: NOW });
    }
    if (p === '/api/admin/sales/expiring') {
      const days = Math.min(90, Math.max(1, Number(u.searchParams.get('days')) || 7));
      return j(200, { expiring: [], days, serverTime: NOW });
    }
    if (p === '/api/admin/plans') return j(200, { plans: [], config: {} });
    if (p === '/api/admin/support/threads') return j(200, { threads: [], unread: 0 });
    return j(404, { error: { code: 'not_found', message: 'این مسیر وجود ندارد' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

const PORT = Number(process.env.TEST_PORT || 4995);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'staff-bank-ui-'));
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
  env: { ...process.env, HLP_PORT: String(PORT), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: path.join(tmp, 'data'),
         HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_SITESYNC: '0', HLP_AI_ENABLED: '0', HLP_TUNNEL: '0', HLP_STATIONS: '0',
         HLP_AUTOMATION: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_ACCOUNT_API: `http://127.0.0.1:${fake.address().port}`,
         HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret', HLP_TG_WATCH_MS: '0', HLP_TG_LONGPOLL: '0',
         //  مهلتِ عادیِ پل کوتاه برای آزمونِ «نامعلوم» — بیش از ۳۰۰ms ِ ازکارانداختنِ عادیِ همین آزمون
         HLP_BRIDGE_TIMEOUT_MS: '1500' },
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
  await fetch(`${BASE}/api/auth/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'StaffBank!2026' }) });
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', (e) => jsErrors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*\b(403|504)\b/.test(m.text())) jsErrors.push(m.text()); });
  const urls = [];
  page.on('request', (r) => urls.push(r.url()));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('input[autocomplete="username"]', 'admin');
  await page.fill('input[type="password"]', 'StaffBank!2026');
  /*
   *  ⛔ ۱.۵۰.۷۷ (ریشهٔ ناپایداریِ «۱ در ۴»): پس از ورود صفحهٔ نخست «داشبورد» است و همان لحظه ‎/sales/summary‎ و
   *  ‎/sales/expiring‎ را می‌خواند (و سرِ وصل شدنِ سوکت یک بارِ دیگر، `useLive`). پیش‌تر آزمون بی‌درنگ به ‎/shop‎ می‌رفت:
   *  اگر پاسخِ آن دو پیش از «جاافتادنِ» ناوبریِ تازه می‌رسید، خطای کنسولِ مرورگر ثبت می‌شد و اگر نه، درخواست بریده
   *  (‎net::ERR_ABORTED‎) و بی‌صدا بود — یعنی نتیجه به زمان‌بندی بسته بود، نه به کد. حالا آزمون صبر می‌کند تا داشبورد
   *  هر دو را بخواند، پس هر پاسخِ بدِ آن‌ها **همیشه** دیده می‌شود.
   */
  const dash = Promise.all(['/api/account-admin/sales/summary', '/api/account-admin/sales/expiring'].map((s) =>
    page.waitForResponse((r) => r.url().startsWith(BASE + s), { timeout: 20000 })));
  await page.locator('form button').last().click();
  await page.waitForSelector('aside nav', { timeout: 20000 });
  const [dSum, dExp] = await dash;
  await page.waitForLoadState('networkidle');
  check('داشبوردِ پس از ورود: فروش و «رو به پایان» از سرورِ حساب ۲۰۰ (شکلِ ‎admin-sales.js‎ ِ shop)',
    dSum.status() === 200 && dExp.status() === 200, `${dSum.status()} ${dExp.status()}`);

  console.log('\n── پروندهٔ دکان: کارکنان و دستگاه‌ها ──');
  await page.goto(`${BASE}/shop?tab=shops&shop=shp-1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  let card = await page.locator('[data-card="shop-staff"]').innerText();
  check('اعضا با نقش و «نیازمندِ تأیید» ِ مؤثرِ سرورِ حساب، و صاحب «همه‌کاره»', card.includes('کریم') && card.includes('صندوق‌دار') && card.includes('همه‌کاره'), card.slice(0, 600));
  check('دستگاه‌ها با نامِ عضو، و «برگرداندن از پنل ممکن نیست» با نامِ درِ لازم', card.includes('گوشیِ کریم') && card.includes('تبلتِ دخل')
    && card.includes('پشتیبانی نمی‌شود') && card.includes('devices/:did/enable'), card.slice(0, 900));
  check('⛔ توکنِ پوش هیچ‌جای صفحه نیست', !(await page.content()).includes('SECRET-PUSH'));
  await page.locator('[data-card="shop-staff"] button[data-device="dev-a"]').click();
  await page.waitForTimeout(300);
  const send = page.getByRole('button', { name: 'تأیید و فرستادن' });
  check('⛔ ازکارانداختن: بی دلیل دکمه بسته است و اثر پیش از تأیید گفته می‌شود', await send.isDisabled() && (await page.locator('text=همهٔ نشست‌هایش باطل می‌شود').count()) > 0);
  await page.locator('textarea').fill('گوشی گم شده');
  const b0 = posted.length;
  await send.dblclick();
  await page.waitForTimeout(1200);
  const dp = posted.slice(b0).filter((x) => x.path.endsWith('/disable'));
  check('⛔ دوکلیک ⇒ یک درخواست، بدنهٔ بالادست فقط دلیل', dp.length === 1 && JSON.stringify(dp[0].body) === JSON.stringify({ reason: 'گوشی گم شده' }), JSON.stringify(dp));
  card = await page.locator('[data-card="shop-staff"]').innerText();
  check('و «تأییدشده از سرورِ حساب… ۳ نشست باطل شد»، دستگاه «از کار افتاده» و دکمه‌اش رفت',
    card.includes('تأییدشده از سرورِ حساب') && card.includes('۳ نشست') && card.includes('از کار افتاده')
      && (await page.locator('[data-card="shop-staff"] button[data-device="dev-a"]').count()) === 0, card.slice(0, 900));
  slowDisable = true;
  await page.locator('[data-card="shop-staff"] button[data-device="dev-b"]').click();
  await page.waitForTimeout(300);
  await page.locator('textarea').fill('آزمونِ مهلت');
  await page.getByRole('button', { name: 'تأیید و فرستادن' }).click();
  await page.waitForTimeout(2600);
  const dlg = await page.locator('div.fixed.inset-0').last().innerText().catch(() => '');
  check('⛔ مهلتِ پل ⇒ «نتیجه معلوم نیست… پیش از تکرار ببینید» (زرد)، نه «شکست»',
    (await page.locator('[data-outcome="unknown"]').count()) === 1 && dlg.includes('نتیجه معلوم نیست') && dlg.includes('outcome_unknown') && !/شکست|ناموفق/.test(dlg), dlg);
  await page.getByRole('button', { name: 'انصراف' }).click();
  slowDisable = false;

  console.log('\n── سرورِ حسابِ تازه: برگرداندنِ دستگاه و صفحه‌بندی (۱.۵۰.۷۷) ──');
  check('سرورِ کهنه: دستگاهِ از کار افتاده دکمهٔ «برگرداندن» ندارد', (await page.locator('[data-card="shop-staff"] button[data-enable]').count()) === 0);
  caps = ['actor.v1', 'staff-perms.v1', 'idempotent-writes.v1'];
  await page.goto(`${BASE}/shop?tab=shops&shop=shp-1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  card = await page.locator('[data-card="shop-staff"]').innerText();
  check('با `staff-perms.v1`: «برگرداندن» برای دستگاهِ از کار افتاده، و یادداشتِ «پشتیبانی نمی‌شود» رفت',
    (await page.locator('[data-card="shop-staff"] button[data-enable="dev-a"]').count()) === 1 && !card.includes('پشتیبانی نمی‌شود'), card.slice(0, 600));
  check('صفحه‌بندی: «اعضا ۱–۲ / ۶۰»، «قبلی» بسته، «بعدی» باز', (await page.locator('[data-staff-page]').innerText()).includes('۶۰')
    && await page.locator('[data-page="prev"]').isDisabled() && !(await page.locator('[data-page="next"]').isDisabled()), await page.locator('[data-staff-page]').innerText().catch(() => ''));
  const u0 = urls.length;
  await page.locator('[data-page="next"]').click();
  await page.waitForTimeout(700);
  check('«بعدی» ⇒ ‎?offset=50‎ و «قبلی» باز، «بعدی» بسته (‎nextOffset: null‎)', urls.slice(u0).some((x) => /\/staff\?offset=50$/.test(x))
    && !(await page.locator('[data-page="prev"]').isDisabled()) && await page.locator('[data-page="next"]').isDisabled(), urls.slice(u0).join(' '));
  await page.locator('[data-page="prev"]').click();
  await page.waitForTimeout(700);
  await page.locator('[data-card="shop-staff"] button[data-enable="dev-a"]').click();
  await page.waitForTimeout(300);
  const en = page.getByRole('button', { name: 'تأیید و فرستادن' });
  check('برگرداندن: بی دلیل بسته، و اثر («دوباره وارد شود») پیش از تأیید گفته می‌شود', await en.isDisabled() && (await page.locator('text=باید دوباره وارد شود').count()) > 0);
  await page.locator('textarea').fill('گوشی پیدا شد');
  await en.dblclick();
  await page.waitForTimeout(1200);
  card = await page.locator('[data-card="shop-staff"]').innerText();
  check('⛔ دوکلیک ⇒ یک درخواست با کلیدِ ‎u<کاربر>.‎ به سرورِ حساب، و «تأییدشده… برگشت»؛ دکمهٔ «از کار انداختن» برگشت',
    enabled.length === 1 && /^u\d+\.[A-Za-z0-9_.:-]{8,}$/.test(enabled[0].idem) && card.includes('برگشت')
      && (await page.locator('[data-card="shop-staff"] button[data-device="dev-a"]').count()) === 1, `${JSON.stringify(enabled)} ${card.slice(0, 400)}`);

  console.log('\n── بانکِ عکس ──');
  await page.goto(`${BASE}/shop?tab=imagebank`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  let body = await page.locator('main').innerText();
  check('⛔ پرچمِ خاموش ⇒ «بانکِ مرکزیِ عکس روشن نیست» با نامِ پرچم، نه فهرستِ خالی', body.includes('روشن نیست') && body.includes('image_bank.central') && !body.includes('در این صف عکسی نیست'), body.slice(0, 500));
  bankOn = true;
  await page.goto(`${BASE}/shop?tab=imagebank`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  body = await page.locator('main').innerText();
  check('صفِ بازبینی: عکس، کالا، تطبیق و مجوز', body.includes('img_1') && body.includes('روغنِ آفتاب‌گردان') && body.includes('exact') && body.includes('licensed'), body.slice(0, 700));
  check('بندانگشتی از درِ پل با سرآیندِ نشست — ⛔ بی توکن در نشانی',
    fileHits.length >= 1 && (await page.locator('[data-card="bank-review"] img').count()) >= 1 && !urls.some((x) => /[?&]token=/.test(x)), `${fileHits.length} ${urls.filter((x) => x.includes('image-bank/file')).join(' ')}`);
  await page.locator('[data-card="bank-review"] button[data-image="img_1"]').click();
  await page.waitForTimeout(900);
  const det = await page.locator('[data-card="bank-image"]').innerText();
  check('جزئیات: مجوز، دکانِ مبدأ، نسخه', det.includes('shp-1') && det.includes('licensed') && (det.includes('v۱') || det.includes('v1')), det.slice(0, 500));
  check('⛔ شناسهٔ اجازه‌دهنده هیچ‌جای صفحه نیست', !(await page.content()).includes('u_secret'));
  await page.locator('[data-card="bank-image"] button', { hasText: 'تأیید و انتشار' }).click();
  await page.waitForTimeout(300);
  const ap = page.getByRole('button', { name: 'تأیید و فرستادن' });
  check('تأیید و انتشار: بی دلیل بسته، و اثر (مجوز/کالا/تطبیق را سرورِ حساب می‌سنجد) گفته می‌شود', await ap.isDisabled() && (await page.locator('text=تطبیقِ قطعی').count()) > 0);
  await page.locator('textarea').fill('مجوز و کالا درست است');
  const a0 = posted.length;
  await ap.click();
  await page.waitForTimeout(1000);
  const apost = posted.slice(a0).filter((x) => x.path.endsWith('/approve'));
  check('یک درخواست با ‎{reason, version: 1}‎ و «تأییدشده از سرورِ حساب»', apost.length === 1 && JSON.stringify(apost[0].body) === JSON.stringify({ reason: 'مجوز و کالا درست است', version: 1 })
    && (await page.locator('[data-card="bank-image"]').innerText()).includes('تأییدشده از سرورِ حساب'), JSON.stringify(apost));

  //  viewer: می‌بیند، دکمهٔ بازبینی و ازکارانداختن نه (مرز در سرور است؛ این فقط برای درخواستِ بی‌نتیجه نزدن)
  const adminTok = await page.evaluate(() => localStorage.getItem('hlp.token'));
  await fetch(`${BASE}/api/auth/users`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${adminTok}` },
    body: JSON.stringify({ username: 'view1', password: 'StaffViewer!2026', role: 'viewer' }) });
  const vctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const vpage = await vctx.newPage();
  vpage.on('pageerror', (e) => jsErrors.push(String(e.message)));
  await vpage.goto(BASE, { waitUntil: 'networkidle' });
  await vpage.fill('input[autocomplete="username"]', 'view1');
  await vpage.fill('input[type="password"]', 'StaffViewer!2026');
  await vpage.locator('form button').last().click();
  await vpage.waitForTimeout(1500);
  await vpage.goto(`${BASE}/shop?tab=shops&shop=shp-1`, { waitUntil: 'networkidle' });
  await vpage.waitForTimeout(900);
  check('viewer: کارکنان را می‌بیند، دکمهٔ «از کار انداختن» و «برگرداندن» نه', (await vpage.locator('[data-card="shop-staff"]').innerText()).includes('کریم')
    && (await vpage.locator('[data-card="shop-staff"] button[data-device]').count()) === 0 && (await vpage.locator('[data-card="shop-staff"] button[data-enable]').count()) === 0);
  await vpage.goto(`${BASE}/shop?tab=imagebank`, { waitUntil: 'networkidle' });
  await vpage.waitForTimeout(900);
  await vpage.locator('[data-card="bank-review"] button[data-image="img_1"]').click();
  await vpage.waitForTimeout(900);
  check('viewer: جزئیاتِ عکس بی دکمهٔ بازبینی، و گوشی (۳۹۰px) افقی نمی‌لغزد',
    (await vpage.locator('[data-card="bank-image"]').count()) === 1 && (await vpage.locator('[data-card="bank-image"] button', { hasText: 'تأیید و انتشار' }).count()) === 0
      && (await vpage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)));
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
