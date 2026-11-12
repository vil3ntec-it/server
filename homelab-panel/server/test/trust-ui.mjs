// ---------------------------------------------------------------------------
//  ABUSE-01 (۱.۵۰.۹۷) در کرومیومِ واقعی: «فروشگاه ← مدیریتِ بازار ← گزارش‌ها و جریمه‌ها»
//      CHROME_PATH=… node test/trust-ui.mjs        (محلی، مثلِ image-changes-ui)
//
//  پنلِ واقعی + سرورِ حسابِ ساختگی به شکلِ ‎routes/admin-trust.js‎ ِ shop. با کلیکِ واقعی:
//    ⛔ صف با وضعیتِ فارسی و ستونِ «مسئول»؛ پالایشِ دکان: شناسهٔ نادرست ⇒ دکمه بسته، درست ⇒ همان دکان به سرورِ حساب
//    ⛔ پرونده: متنِ شاکی و HTML فقط متن (هیچ ‎<img>‎/اسکریپت)، تاریخچه با برچسب
//    ⛔ «مسئولش من» با دوکلیک ⇒ یک POST؛ پس از آن «admin (شما)»
//    ⛔ تصمیم: بی دلیل و رمز بسته؛ دوکلیک ⇒ یک POST با فقط ‎{outcome, reason}‎؛ تصمیم و دلیل در پرونده
//    ⛔ پاسخِ گم‌شده ⇒ «نتیجه معلوم نیست» (نه سرخ)، پرونده دوباره خوانده و «تصمیم گرفته شد»؛ تکرارِ همان پنجره ⇒ هیچ POST ِ دوم
//    ⛔ رأیِ اعتراض «برگشت» و برداشتنِ جریمه (هر کدام یک POST)؛ «فقط فعال» خاموش ⇒ «برداشته شد»
//    ⛔ viewer فقط پیامِ «فقط admin» و هیچ درخواستِ پرونده؛ گوشی (۳۹۰px) افقی نمی‌لغزد؛ هیچ خطای جاوااسکریپت
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
const KEY_ID = 'svk_bridge01';
const XSS = '<img src=x onerror="window.__xss=1">';
const reads = [];
const posts = [];
let hangNext = false;
let caps = ['actor.v1'];          //  + ‎trust-read.v1‎ ⇒ بیننده هم می‌خواند (shop ‎claude/e-rows-25s‎)
const mk = (id, status, extra = {}) => ({
  id, shopId: 'shpA', shopName: 'دکانِ کریم', kind: 'report', subject: 'product', orderNo: null, productId: 'rice', category: 'counterfeit',
  status, createdAt: NOW - 90000, updatedAt: NOW - 90000, severity: 'high', assignee: '', outcome: null, appealOutcome: null,
  flags: ['same_ip'], duplicateOf: null, evidenceCount: 1, ...extra,
});
const cases = {
  tc_1: mk('tc_1', 'open'),
  tc_2: mk('tc_2', 'open', { severity: 'medium', category: 'misleading' }),
  tc_4: mk('tc_4', 'appealed', { outcome: 'upheld', kind: 'complaint', subject: 'order', productId: null, category: 'not_delivered' }),
  tc_5: mk('tc_5', 'open', { shopId: 'shpB', shopName: 'دکانِ نادر' }),
};
const sanctions = {
  tsn_4: { id: 'tsn_4', caseId: 'tc_4', shopId: 'shpA', kind: 'suspend_storefront', productId: null, reason: 'بار سوم', createdAt: NOW - 50000, active: true, liftedAt: null },
  tsn_9: { id: 'tsn_9', caseId: 'tc_9', shopId: 'shpA', kind: 'warning', productId: null, reason: 'هشدارِ قبلی', createdAt: NOW - 70000, active: true, liftedAt: null },
};
const hist = { tc_1: [{ type: 'filed', at: NOW - 90000, actor: 'customer', actorId: '', body: '', data: {} },
  { type: 'flagged', at: NOW - 89000, actor: 'system', actorId: '', body: '', data: { flags: ['same_ip'] } }] };
const full = (c) => ({
  ...c, body: `این کالا تقلبی است ${XSS}`, reporterHint: '07•••12', reporterStats: { total: 2, upheld: 1, dismissed: 0, shops: 1 }, sameText: [],
  decision: c.outcome ? { outcome: c.outcome, reason: c.decisionReason || 'تقلبی بود', by: KEY_ID, at: c.decidedAt || NOW - 60000 } : null,
  appeal: c.id === 'tc_4' ? { body: 'ما کالا را فرستادیم', by: 'usr_1', at: NOW - 40000, outcome: c.appealOutcome, reason: c.appealReason || '', decidedAt: c.appealOutcome ? Date.now() : null } : null,
  evidence: [], sanctions: Object.values(sanctions).filter((s) => s.caseId === c.id), history: hist[c.id] || [],
});

const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const j = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    let b = null;
    try { b = JSON.parse(raw || 'null'); } catch { /* */ }
    if (p === '/api/health') return j(200, { ok: true, server: 'online', version: '2.14.5' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: caps, serverTime: NOW });
    if (p.startsWith('/api/admin/trust/')) {
      if (req.method === 'GET') reads.push({ path: p, query: Object.fromEntries(u.searchParams) });
      else posts.push({ path: p, body: b });
    }
    if (p === '/api/admin/trust/cases') {
      const st = u.searchParams.get('status') || 'pending';
      const shop = u.searchParams.get('shopId') || '';
      return j(200, { cases: Object.values(cases).filter((c) => (st === 'all' || (st === 'pending' ? ['open', 'in_review', 'appealed'].includes(c.status) : c.status === st))
        && (!shop || c.shopId === shop)) });
    }
    const m = /^\/api\/admin\/trust\/cases\/([^/]+)(?:\/(assign|decide|appeal-decision))?$/.exec(p);
    if (m) {
      const c = cases[m[1]];
      if (!c) return j(404, { error: { code: 'not_found', message: 'پرونده پیدا نشد' } });
      if (!m[2]) return j(200, { case: full(c) });
      const done = (obj) => (hangNext ? (hangNext = false, undefined) : setTimeout(() => j(200, obj), 250));
      if (m[2] === 'assign') {
        if (c.status === 'open') c.status = 'in_review';
        c.assignee = KEY_ID;
        (hist[c.id] ||= []).push({ type: 'assigned', at: Date.now(), actor: 'admin', actorId: KEY_ID, body: '', data: { assignee: KEY_ID } });
        return done({ id: c.id, shopId: c.shopId, status: c.status, assignee: KEY_ID });
      }
      if (m[2] === 'decide') {
        if (c.status !== 'open' && c.status !== 'in_review') return j(409, { error: { code: 'already_decided', message: 'این پرونده پیش‌تر تصمیم گرفته است' } });
        Object.assign(c, { status: 'decided', outcome: b.outcome, decisionReason: b.reason, decidedAt: Date.now() });
        (hist[c.id] ||= []).push({ type: 'decided', at: Date.now(), actor: 'admin', actorId: KEY_ID, body: b.reason, data: { outcome: b.outcome } });
        return done({ id: c.id, shopId: c.shopId, outcome: b.outcome, sanction: null });
      }
      if (c.status !== 'appealed') return j(409, { error: { code: 'no_pending_appeal', message: 'این پرونده اعتراضِ در انتظار ندارد' } });
      Object.assign(c, { status: 'closed', appealOutcome: b.outcome, appealReason: b.reason });
      const lifted = b.outcome === 'reversed' ? Object.values(sanctions).filter((s) => s.caseId === c.id && s.active)
        .map((s) => (Object.assign(s, { active: false, liftedAt: Date.now(), liftReason: b.reason }), s.id)) : [];
      return done({ id: c.id, shopId: c.shopId, outcome: b.outcome, lifted });
    }
    if (p === '/api/admin/trust/sanctions') {
      const act = u.searchParams.get('active') === '1';
      return j(200, { sanctions: Object.values(sanctions).filter((s) => !act || s.active) });
    }
    const sm = /^\/api\/admin\/trust\/sanctions\/([^/]+)\/lift$/.exec(p);
    if (sm) {
      const s = sanctions[sm[1]];
      if (!s) return j(404, { error: { code: 'sanction_not_found', message: 'این جریمه پیدا نشد' } });
      if (!s.active) return j(409, { error: { code: 'already_lifted', message: 'این جریمه پیش‌تر برداشته شده است' } });
      Object.assign(s, { active: false, liftedAt: Date.now(), liftReason: b?.reason || '' });
      return void setTimeout(() => j(200, { id: s.id, shopId: s.shopId, caseId: s.caseId, kind: s.kind }), 250);
    }
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

const PORT = Number(process.env.TEST_PORT || 4945);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'trust-ui-'));
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
  env: { ...process.env, HLP_PORT: String(PORT), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: path.join(tmp, 'data'),
         HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_SITESYNC: '0', HLP_AI_ENABLED: '0', HLP_TUNNEL: '0', HLP_STATIONS: '0',
         HLP_AUTOMATION: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_ACCOUNT_API: `http://127.0.0.1:${fake.address().port}`,
         HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret', HLP_BRIDGE_TIMEOUT_MS: '1500',
         HLP_TG_WATCH_MS: '0', HLP_TG_LONGPOLL: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

let browser;
const jsErrors = [];
const PW = 'Trust!UI2026';
async function signIn(pg, u, pw) {
  await pg.goto(BASE, { waitUntil: 'networkidle' });
  await pg.fill('input[autocomplete="username"]', u);
  await pg.fill('input[type="password"]', pw);
  await pg.locator('form button').last().click();
  await pg.waitForFunction(() => !document.querySelector('input[type="password"]'), null, { timeout: 20000 });
  await pg.waitForLoadState('networkidle');
}
const casePosts = (re) => posts.filter((x) => re.test(x.path));
try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!CHROME) throw new Error('کرومیوم پیدا نشد — CHROME_PATH را بگذارید');
  await fetch(`${BASE}/api/auth/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: PW }) });
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', (e) => jsErrors.push(String(e.message)));
  //  ‎504‎ ِ «نامعلوم» خطای خودِ همین آزمون است (رابط باید بگویدش)، نه خطای صفحه
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*\b504\b/.test(m.text())) jsErrors.push(m.text()); });
  await signIn(page, 'admin', PW);

  console.log('\n── صف و پالایش ──');
  await page.goto(`${BASE}/shop?tab=market&view=reports`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-case-row="tc_1"]', { timeout: 15000 });
  let body = await page.locator('main').innerText();
  check('صفِ «در انتظارِ رسیدگی»: چهار پرونده با وضعیتِ فارسی و ستونِ «مسئول» («بی مسئول»)',
    (await page.locator('[data-case-row]').count()) === 4 && body.includes('در انتظارِ رسیدگی') && body.includes('اعتراض شده') && body.includes('بی مسئول'), body.slice(0, 300));
  await page.locator('[data-trust-shop]').fill('bad id!');
  const filterBtn = page.getByRole('button', { name: 'پالایش' });
  check('⛔ شناسهٔ دکانِ نادرست ⇒ «پالایش» بسته و راهنمای نویسه‌ها', await filterBtn.isDisabled() && (await page.locator('main').innerText()).includes('فقط حرف'));
  await page.locator('[data-trust-shop]').fill('shpB');
  await filterBtn.click();
  await page.waitForTimeout(700);
  const lastQ = reads.filter((r) => r.path === '/api/admin/trust/cases').at(-1)?.query;
  check('پالایشِ دکان ⇒ همان دکان به سرورِ حساب و فقط پروندهٔ همان', lastQ?.shopId === 'shpB' && (await page.locator('[data-case-row]').count()) === 1
    && (await page.locator('[data-case-row="tc_5"]').count()) === 1, JSON.stringify(lastQ));
  await page.getByRole('button', { name: 'همهٔ دکان‌ها' }).click();
  await page.waitForSelector('[data-case-row="tc_1"]', { timeout: 10000 });

  console.log('\n── پرونده، مسئول و تصمیم ──');
  await page.locator('[data-case-open="tc_1"]').click();
  await page.waitForSelector('[data-case-detail="tc_1"]', { timeout: 10000 });
  const det = page.locator('[data-case-detail="tc_1"]');
  let text = await det.innerText();
  check('پرونده: متنِ شاکی، تاریخچه با برچسبِ فارسی («ثبتِ پرونده»، «نشانهٔ خودکار»، «شاکی»)',
    text.includes('این کالا تقلبی است') && text.includes('ثبتِ پرونده') && text.includes('نشانهٔ خودکار') && text.includes('شاکی'), text.slice(0, 400));
  check('⛔ HTML ِ متنِ شاکی متن می‌ماند: هیچ ‎<img>‎ ساخته نشد و ‎onerror‎ نَدَوید',
    text.includes('<img src=x') && (await det.locator('img').count()) === 0 && (await page.evaluate(() => window.__xss)) === undefined);
  await det.locator('[data-case-assign]').dblclick();
  await page.waitForSelector('[data-case-assignee="admin"]', { timeout: 10000 });
  text = await det.innerText();
  check('«مسئولش من» با دوکلیک ⇒ یک POST؛ «مسئول: admin (شما)» و «در بررسی»؛ تاریخچهٔ «مسئول تعیین شد»',
    casePosts(/tc_1\/assign$/).length === 1 && text.includes('admin (شما)') && text.includes('در بررسی') && text.includes('مسئول تعیین شد'),
    `${casePosts(/assign/).length} ${text.slice(0, 300)}`);
  check('صف هم «admin (شما)» را می‌گوید', (await page.locator('[data-case-assignee="admin"]').count()) >= 2);
  check('⛔ کلیکِ دومِ دوکلیک روی دکمهٔ کناری («تصمیم») نیفتاد: هیچ پنجره‌ای باز نیست', (await page.locator('[role="dialog"]').count()) === 0);

  await det.locator('[data-case-decide]').click();
  const send = page.getByRole('button', { name: 'تأیید و فرستادن' });
  await page.waitForTimeout(300);
  check('پنجرهٔ تصمیم: اثر پیش از تأیید و بی دلیل و رمز بسته', await send.isDisabled() && (await page.locator('[role="dialog"]').innerText()).includes('فقط یک بار'));
  await page.locator('[role="dialog"] select[aria-label="نتیجه"]').selectOption('dismissed');
  await page.locator('[role="dialog"] textarea').fill('گزارش درست نبود');
  await page.locator('[role="dialog"] input[type="password"]').fill(PW);
  await send.dblclick();
  await page.waitForSelector('[data-case-decision]', { timeout: 10000 });
  await page.waitForTimeout(400);
  text = await det.innerText();
  const dp = casePosts(/tc_1\/decide$/);
  check('⛔ دوکلیک ⇒ یک POST با فقط ‎{outcome, reason}‎ (بی رمز و کلید)؛ «تصمیم ثبت شد»، «رد» و دلیل در پرونده، «تصمیم گرفته شد»',
    dp.length === 1 && JSON.stringify(dp[0].body) === JSON.stringify({ outcome: 'dismissed', reason: 'گزارش درست نبود' })
      && (await page.locator('main').innerText()).includes('تصمیم ثبت شد') && text.includes('گزارش درست نبود') && text.includes('تصمیم گرفته شد')
      && (await det.locator('[data-case-decide]').count()) === 0, `${JSON.stringify(dp)} ${text.slice(0, 300)}`);
  await page.locator('[data-case-close]').click();
  await page.waitForTimeout(300);

  console.log('\n── نامعلوم ──');
  await page.locator('[data-case-open="tc_2"]').click();
  await page.waitForSelector('[data-case-detail="tc_2"]', { timeout: 10000 });
  const det2 = page.locator('[data-case-detail="tc_2"]');
  await det2.locator('[data-case-decide]').click();
  await page.waitForTimeout(300);
  await page.locator('[role="dialog"] textarea').fill('ادعای گمراه‌کننده ثابت شد');
  await page.locator('[role="dialog"] input[type="password"]').fill(PW);
  hangNext = true;
  await page.getByRole('button', { name: 'تأیید و فرستادن' }).click();
  await page.waitForSelector('[role="dialog"] [data-outcome="unknown"]', { timeout: 15000 });
  await page.waitForTimeout(800);
  const dlg = await page.locator('[role="dialog"]').innerText();
  check('⛔ پاسخِ گم‌شده ⇒ «نتیجه معلوم نیست» در همان پنجره (نه سرخِ «نشد») و پرونده دوباره خوانده شد: «تصمیم گرفته شد»',
    dlg.includes('نتیجه معلوم نیست') && casePosts(/tc_2\/decide$/).length === 1 && (await det2.innerText()).includes('تصمیم گرفته شد'), dlg.slice(0, 300));
  await page.locator('[role="dialog"] input[type="password"]').fill(PW);
  await page.getByRole('button', { name: 'تأیید و فرستادن' }).click();
  await page.waitForTimeout(1200);
  check('⛔ تکرارِ همان پنجره (همان کلید) ⇒ باز «نامعلوم» و هیچ POST ِ دوم به سرورِ حساب', casePosts(/tc_2\/decide$/).length === 1
    && (await page.locator('[role="dialog"] [data-outcome="unknown"]').count()) === 1, String(casePosts(/tc_2\/decide$/).length));
  await page.getByRole('button', { name: 'انصراف' }).click();
  await page.locator('[data-case-close]').click();
  await page.waitForTimeout(300);

  console.log('\n── رأیِ اعتراض و جریمه ──');
  await page.locator('[data-case-open="tc_4"]').click();
  await page.waitForSelector('[data-case-detail="tc_4"]', { timeout: 10000 });
  const det4 = page.locator('[data-case-detail="tc_4"]');
  check('پروندهٔ اعتراض‌شده: تصمیمِ نخست، متنِ اعتراضِ دکان و جریمهٔ فعال', (await det4.innerText()).includes('ما کالا را فرستادیم')
    && (await det4.innerText()).includes('تعلیقِ ویترین') && (await det4.locator('[data-case-decision]').count()) === 1);
  await det4.locator('[data-case-appeal]').click();
  await page.waitForTimeout(300);
  await page.locator('[role="dialog"] select[aria-label="رأی"]').selectOption('reversed');
  await page.locator('[role="dialog"] textarea').fill('رسیدِ تحویل آمد');
  await page.locator('[role="dialog"] input[type="password"]').fill(PW);
  await page.getByRole('button', { name: 'تأیید و فرستادن' }).dblclick();
  await page.waitForFunction(() => document.querySelector('[data-case-detail="tc_4"]')?.textContent?.includes('رسیدِ تحویل آمد'), null, { timeout: 10000 });
  await page.waitForTimeout(500);
  text = await det4.innerText();
  check('«برگشت» با دوکلیک ⇒ یک POST؛ رأی و دلیل در پرونده، جریمه «برداشته شد»، «بسته»',
    casePosts(/tc_4\/appeal-decision$/).length === 1 && text.includes('برگشت') && text.includes('برداشته شد') && text.includes('بسته'), text.slice(0, 400));
  await page.locator('[data-case-close]').click();
  await page.waitForTimeout(300);

  await page.waitForSelector('[data-sanction-lift="tsn_9"]', { timeout: 10000 });
  check('جریمه‌های فعال: جریمهٔ برگشته دیگر نیست', (await page.locator('[data-sanction-lift="tsn_4"]').count()) === 0);
  await page.locator('[data-sanction-lift="tsn_9"]').click();
  await page.waitForTimeout(300);
  await page.locator('[role="dialog"] textarea').fill('هشدار کهنه است');
  await page.locator('[role="dialog"] input[type="password"]').fill(PW);
  await page.getByRole('button', { name: 'تأیید و فرستادن' }).dblclick();
  await page.waitForFunction(() => !document.querySelector('[data-sanction-lift="tsn_9"]'), null, { timeout: 10000 });
  await page.locator('[data-trust-active]').uncheck();
  await page.waitForTimeout(700);
  body = await page.locator('main').innerText();
  check('برداشتن با دوکلیک ⇒ یک POST با ‎{reason}‎؛ «فقط فعال» خاموش ⇒ همهٔ جریمه‌ها با «برداشته شد»',
    casePosts(/tsn_9\/lift$/).length === 1 && JSON.stringify(casePosts(/tsn_9\/lift$/)[0].body) === JSON.stringify({ reason: 'هشدار کهنه است' })
      && body.includes('همهٔ جریمه‌ها') && (body.match(/برداشته شد/g) || []).length >= 2, body.slice(-400));

  //  viewer و گوشی
  const adminTok = await page.evaluate(() => localStorage.getItem('hlp.token'));
  await fetch(`${BASE}/api/auth/users`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${adminTok}` },
    body: JSON.stringify({ username: 'view1', password: 'TrustViewer!2026', role: 'viewer' }) });
  const vctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const vpage = await vctx.newPage();
  vpage.on('pageerror', (e) => jsErrors.push(String(e.message)));
  await signIn(vpage, 'view1', 'TrustViewer!2026');
  const nReads = reads.length;
  await vpage.goto(`${BASE}/shop?tab=market&view=reports`, { waitUntil: 'networkidle' });
  await vpage.waitForTimeout(800);
  let vtext = await vpage.locator('main').innerText();
  check('viewer با سرورِ حسابِ کهنه (بی ‎trust-read.v1‎): فقط پیامِ «trust-read.v1 … فقط admin»، بی جدول و بی هیچ درخواستِ پرونده',
    vtext.includes('trust-read.v1') && vtext.includes('فقط admin') && (await vpage.locator('[data-case-row]').count()) === 0 && reads.length === nReads, vtext.slice(0, 300));
  caps = ['actor.v1', 'trust-read.v1'];
  await vpage.reload({ waitUntil: 'networkidle' });
  await vpage.waitForSelector('[data-case-row="tc_5"]', { timeout: 15000 });
  await vpage.locator('[data-case-open="tc_5"]').click();
  await vpage.waitForSelector('[data-case-detail="tc_5"]', { timeout: 10000 });
  vtext = await vpage.locator('main').innerText();
  check('viewer با ‎trust-read.v1‎: صف و پرونده (متنِ شاکی، تاریخچه) — بی سابقهٔ شاکی، بی دکمهٔ مسئول/تصمیم و بی «برداشتن»؛ افقی نمی‌لغزد',
    vtext.includes('این کالا تقلبی است') && !vtext.includes('سابقهٔ همین گزارش‌دهنده') && (await vpage.locator('[data-case-assign], [data-case-decide], [data-sanction-lift]').count()) === 0
      && (await vpage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)), vtext.slice(0, 400));
  caps = ['actor.v1'];
  await vctx.close();

  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mpage = await mctx.newPage();
  mpage.on('pageerror', (e) => jsErrors.push(String(e.message)));
  await signIn(mpage, 'admin', PW);
  await mpage.goto(`${BASE}/shop?tab=market&view=reports`, { waitUntil: 'networkidle' });
  await mpage.waitForSelector('[data-case-row]', { timeout: 15000 });
  await mpage.locator('[data-case-open="tc_5"]').click();
  await mpage.waitForSelector('[data-case-detail="tc_5"]', { timeout: 10000 });
  check('گوشی (۳۹۰px): صف و پرونده، صفحه افقی نمی‌لغزد', await mpage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await mctx.close();

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
