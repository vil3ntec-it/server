// ---------------------------------------------------------------------------
//  ماژولِ «مالی» (۴.۵) در کرومیومِ واقعی
//      CHROME_PATH=… node test/shop-finance-ui.mjs
//
//  پنلِ واقعی + سرورِ حسابِ ساختگی به شکلِ ‎routes/admin-finance.js‎ ِ shop (finance.v1). سنجیده می‌شود:
//    ⛔ عددها همان پاسخِ سرورِ حساب‌اند، با «منبع و زمان»؛ ارزها جدا؛ صفحه راست‌چین؛ هیچ خطای JS
//    ⛔ سندِ اصلاحی از رابط: دلیل + رمزِ پنل + تأیید ⇒ یک درخواست (دو کلیک هم)، با کلیدِ یکتایی و زمانِ احرازِ
//       دوباره؛ نتیجه «تأییدشدهٔ سرورِ حساب» با شمارهٔ سند
//    ⛔ درگاه «BLOCKED-EXTERNAL: کلیدِ حساب‌پی نیامده»؛ «ناموفق» ِ پرداختِ دستی گفته می‌شود، نه صفر
//    ⛔ viewer: بی دکمهٔ خروجی و سند؛ تطبیقِ فروشِ آنلاین «فقط مالک»
//    ⛔ خطای بالادست با کدِ خودش
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
const DAY = 86400e3;
const posted = [];
let summaryFail = false;
const svcKeys = new Set();
const pay = (id, extra = {}) => ({
  id, app: 'shop', tenantId: 's1', tenantName: 'دکانِ مالی', subscriptionId: 'sub1', plan: 'm1', amount: 600, currency: 'AFN',
  method: 'hawala', receiptNo: `R-${id}`, note: '', paidAt: NOW - DAY, createdBy: 'a1', createdAt: NOW - DAY, deleted: false,
  net: 600, references: [], revisions: 0, adjustments: { count: 0, total: 0, refunded: 0, reversed: false }, ...extra,
});

const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, server: 'online', version: '2.14.5' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* نه JSON */ }
    if (req.method === 'POST') {
      posted.push({ path: p, body, bearer, idem: req.headers['idempotency-key'] || '', reauthAt: req.headers['x-actor-reauth-at'] || '', actor: req.headers['x-actor-id'] || '' });
    }
    if (bearer !== 'tok-1' && !svcKeys.has(bearer)) return j(401, { error: { code: 'unauthorized' } });
    if (p === '/api/admin/me') {
      return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, serverTime: NOW,
        capabilities: ['shop-health.v1', 'shop-holds.v1', 'flags.v1', 'actor.v1', 'service-key.v1', 'finance.v1'] });
    }
    if (p === '/api/admin/service-keys' && req.method === 'POST') {
      const key = `vsk_${'u'.repeat(14)}${'X'.repeat(30)}`;
      svcKeys.add(key);
      return j(201, { key, serviceKey: { id: 'svk1', roleCap: 'superadmin', status: 'active' } });
    }
    if (p === '/api/admin/finance/summary') {
      if (summaryFail) return j(503, { error: { code: 'db_unavailable', message: 'دیتابیس در دسترس نیست' } });
      return j(200, {
        window: { from: NOW - 30 * DAY, to: NOW, timezone: 'Asia/Kabul', group: 'day', calendar: 'persian', fromDate: '2026-10-02', toDate: '2026-10-31' },
        app: 'all', currencies: ['AFN', 'USD'],
        totals: {
          AFN: { payments: { count: 2, amount: 1100 }, correction: { count: 0, amount: 0 }, refund: { count: 1, amount: -100 }, reversal: { count: 0, amount: 0 }, net: 1000 },
          USD: { payments: { count: 1, amount: 120 }, correction: { count: 0, amount: 0 }, refund: { count: 0, amount: 0 }, reversal: { count: 0, amount: 0 }, net: 120 },
        },
        series: [{ key: '2026-10-30', label: '1405/08/08', from: NOW - DAY, to: NOW, currencies: { AFN: { payments: 1100, adjustments: -100, net: 1000, count: 2 } } }],
        byService: [{ app: 'pump', currency: 'USD', payments: 120, adjustments: 0, net: 120, count: 1 }, { app: 'shop', currency: 'AFN', payments: 1100, adjustments: -100, net: 1000, count: 2 }],
        byMethod: [{ method: 'hawala', currency: 'AFN', count: 2, amount: 1100 }],
        checkedAt: NOW - 3 * 60e3,
      });
    }
    if (p === '/api/admin/finance/breakdown') {
      return j(200, { by: u.searchParams.get('by'), total: 1, limit: 20, offset: 0, checkedAt: NOW,
        rows: [{ app: 'shop', key: 's1', name: 'دکانِ مالی', currency: 'AFN', payments: 1100, adjustments: -100, net: 1000, count: 2 }] });
    }
    if (p === '/api/admin/finance/payments') {
      return j(200, { payments: [pay('pay1'), pay('pay2', { deleted: true, net: 600, method: 'cash' })], nextCursor: null, checkedAt: NOW });
    }
    if (p === '/api/admin/finance/payments/pay1') {
      return j(200, { payment: pay('pay1'), adjustments: [], checkedAt: NOW,
        revisions: [{ id: 1, op: 'UPDATE', changedAt: NOW - DAY, changed: ['amount'], before: { amount: 500 }, after: { amount: 600 } }],
        audit: [{ id: 'au1', at: NOW - DAY, action: 'admin.payment_created', adminId: 'a1', actor: null, targetType: 'payment', targetId: 'pay1', shopId: 's1', detail: {} }] });
    }
    if (p === '/api/admin/finance/adjustments' && req.method === 'POST') {
      if (!svcKeys.has(bearer) || !req.headers['x-actor-reauth-at']) return j(403, { error: { code: 'reauth_required', message: 'احراز' } });
      return j(201, { adjustment: { id: 'fad1', docNo: 'ADJ-2026-00007', kind: body?.kind, amount: -100, netBefore: 600, netAfter: 500, currency: 'AFN' },
        payment: { id: 'pay1', net: 500 }, replayed: false });
    }
    if (p === '/api/admin/finance/pending') {
      return j(200, {
        purchaseRequests: { counts: { pending: 1, approved: 4, rejected: 1 }, total: 1, limit: 50, offset: 0,
          items: [{ id: 'pr1', shopId: 's2', shopName: 'دکانِ خریدار', planCode: 'm1', planTitle: 'یک‌ماهه', quotedPrice: 1200, currency: 'AFN', createdAt: NOW - 5 * DAY, ageDays: 5 }] },
        subscriptionPayments: { failed: null, reason: 'manual_only' },
        gateway: { state: 'blocked_external', code: 'payment_intents_missing', message: 'BLOCKED-EXTERNAL: کلیدِ حساب‌پی نیامده', needs: 'shop #518 + #529 + HESABPAY_*', checkedAt: NOW },
        checkedAt: NOW,
      });
    }
    if (p === '/api/admin/finance/discrepancies') {
      return j(200, {
        findings: [
          { code: 'payment_without_subscription', severity: 'warn', source: 'sub_payments', count: 1,
            items: [{ paymentId: 'pay9', app: 'shop', tenantId: 's3', tenantName: 'دکانِ بی‌اشتراک', amount: 70, currency: 'AFN', receiptNo: 'R-9', paidAt: NOW - DAY, subscriptionId: '' }] },
          { code: 'duplicate_receipt', severity: 'bad', source: 'sub_payments.receipt_no', count: 0, items: [] },
        ],
        gateway: { state: 'blocked_external', code: 'payment_intents_missing', message: 'BLOCKED-EXTERNAL: کلیدِ حساب‌پی نیامده', needs: 'shop #518 + #529 + HESABPAY_*' },
        totals: { findings: 1, items: 1 }, checkedAt: NOW,
      });
    }
    if (p === '/api/admin/system/reconciliation') {
      return j(200, { checkedAt: NOW, local: { fromDate: '2026-10-01', toDate: '2026-10-31', timezone: 'Asia/Kabul' },
        totals: { salesMinor: 1234500, refundsMinor: 10000, netMinor: 1224500, issues: 2, courierHeldMinor: 5000 }, shops: [] });
    }
    if (p === '/api/admin/finance/history') {
      return j(200, { entries: [{ id: 'au1', at: NOW - DAY, action: 'admin.finance_adjustment_created', adminId: 'svk1', actor: { kind: 'panel', id: 'panel:1', name: 'admin' }, targetType: 'payment', targetId: 'pay1', shopId: 's1', detail: { reason: 'برگشتِ حواله' } }],
        actions: ['admin.payment_created', 'admin.finance_adjustment_created'], nextCursor: null, checkedAt: NOW });
    }
    if (p.startsWith('/api/admin/finance/')) return j(200, { checkedAt: NOW, rows: [], total: 0, totals: {}, adjustments: [], nextCursor: null });
    return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

const PORT = Number(process.env.TEST_PORT || 4961);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'shop-finance-ui-'));
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
  env: { ...process.env, HLP_PORT: String(PORT), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: path.join(tmp, 'data'),
         HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_SITESYNC: '0', HLP_AI_ENABLED: '0', HLP_TUNNEL: '0',
         HLP_AUTOMATION: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_ACCOUNT_API: `http://127.0.0.1:${fake.address().port}`,
         HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret', HLP_AUTH_RATE_LIMIT: '100000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const PASS = 'Finance!2026ui';
let browser;
const jsErrors = [];
try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!CHROME) throw new Error('کرومیوم پیدا نشد — CHROME_PATH را بگذارید');
  const post = async (p, body, token) => (await fetch(`${BASE}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
  })).json();
  await post('/api/auth/setup', { username: 'admin', password: PASS });
  const adminTok = (await post('/api/auth/login', { username: 'admin', password: PASS })).token;
  await post('/api/auth/users', { username: 'view1', password: 'Viewer!2026ui', role: 'viewer' }, adminTok);
  //  کلیدِ سرویس (مالک + رمز) — سندِ اصلاحی فقط از این راه
  const key = await post('/api/account-admin/console/service-key', { reason: 'پلِ مالی', confirm: true, password: PASS }, adminTok);
  check('کلیدِ سرویس ساخته شد', key?.mode === 'service', JSON.stringify(key).slice(0, 200));

  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const login = async (username, password) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => jsErrors.push(String(e.message)));
    //  ⚠️ سرورِ حسابِ ساختگی فقط درهای مالی را دارد ⇒ ۴۰۴ ِ درهای دیگرِ پوسته (پشتیبانی، اعلان) خطای این ماژول نیست؛
    //  ولی هر خطای درهای مالی (جز ۵۰۳/۴۰۳ ِ عمدیِ آزمون) شمرده می‌شود
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const where = m.location()?.url || '';
      if (/Failed to load resource/.test(m.text()) && (!where.includes('/console/finance') || /\b(503|403)\b/.test(m.text()))) return;
      jsErrors.push(`${m.text()} @ ${where}`);
    });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.fill('input[autocomplete="username"]', username);
    await page.fill('input[type="password"]', password);
    await page.locator('form button').last().click();
    await page.waitForSelector('aside nav', { timeout: 20000 });
    return page;
  };
  const page = await login('admin', PASS);
  const main = async (pg = page) => pg.locator('main').innerText();
  const open = async (fin, pg = page) => {
    await pg.goto(`${BASE}/shop?tab=finance${fin ? `&fin=${fin}` : ''}`, { waitUntil: 'networkidle' });
    await pg.waitForTimeout(500);
    if (process.env.SHOTS) await pg.screenshot({ path: path.join(process.env.SHOTS, `finance-${fin || 'overview'}.png`), fullPage: true });
    return main(pg);
  };

  console.log('\n── درآمد و گزارش ──');
  let body = await open('');
  check('صفحه راست‌چین است', (await page.evaluate(() => document.documentElement.dir)) === 'rtl');
  check('هشت زیرزبانهٔ مالی', ['درآمد و گزارش', 'پرداخت‌ها', 'بازپرداخت و اصلاحیه', 'بدهی‌ها', 'در انتظار و ناموفق', 'مغایرت', 'تاریخچه', 'ثبتِ پرداخت و رسید']
    .every((x) => body.includes(x)), body.slice(0, 400));
  check('جمعِ هر ارز جدا: خالصِ افغانی ۱٬۰۰۰ و دالر ۱۲۰؛ بازپرداخت −۱۰۰', body.includes('۱٬۰۰۰') && body.includes('۱۲۰') && /−?-?۱۰۰/.test(body), body.slice(0, 900));
  check('⛔ منبع و زمانِ سرورِ حساب زیرِ کارت', body.includes('/api/admin/finance/summary') && body.includes('سنجیدهٔ سرورِ حساب') && body.includes('۳ دقیقه پیش'), body.slice(0, 1200));
  check('به تفکیکِ بخش (پمپ/فروشگاه) و روش، و دکان در جدولِ تفکیک', body.includes('پمپ') && body.includes('حواله') && body.includes('دکانِ مالی'), body.slice(0, 1500));
  //  ⚠️ درونِ پوستهٔ کنسول نخستین `select` ِ main فهرستِ کشوییِ منو (گوشی) است ⇒ فقط درونِ خودِ ماژول
  await page.selectOption('[data-module="finance"] select >> nth=0', 'month');
  await page.waitForTimeout(400);
  check('گروه‌بندیِ ماهانه به سرورِ حساب می‌رود (بی دکمهٔ دیگر)', (await main()).includes('ماهانه'));

  console.log('\n── پرداخت‌ها و سندِ اصلاحی ──');
  body = await open('payments');
  check('دفترِ پرداخت‌ها با رسید و وضعیتِ «حذف‌شده»', body.includes('R-pay1') && body.includes('R-pay2') && body.includes('حذف‌شده'), body.slice(0, 900));
  check('admin دکمهٔ خروجیِ CSV دارد', body.includes('خروجیِ CSV'));
  check('⛔ هیچ دکمهٔ ویرایش/حذفِ پرداخت نیست', (await page.locator('main button', { hasText: /ویرایش|حذف/ }).count()) === 0);
  await page.locator('main tr', { hasText: 'R-pay1' }).first().click();
  await page.waitForTimeout(600);
  let modal = await page.locator('[role="dialog"], .modal, body').last().innerText();
  check('پروندهٔ پرداخت: تغییرِ راهِ پیشین (amount 500 ⇐ 600) و سابقه', modal.includes('amount=500') && modal.includes('amount=600') && modal.includes('ثبتِ پرداخت'), modal.slice(0, 900));
  await page.getByRole('button', { name: 'سندِ اصلاحی' }).click();
  await page.waitForTimeout(300);
  const dlg = page.locator('text=بازپرداخت به مشتری').first();
  check('پنجرهٔ سند با اثرِ نوعِ سند', (await dlg.count()) > 0 && (await page.locator('text=پولی که به مشتری برگشت').count()) > 0);
  const sendBtn = page.getByRole('button', { name: 'ثبتِ سند' });
  check('⛔ بی دلیل/رمز/تأیید دکمه خاموش است', await sendBtn.isDisabled());
  await page.locator('input[inputmode="numeric"]').last().fill('100');
  await page.locator('textarea').last().fill('برگشتِ بخشی از حواله');
  await page.locator('input[type="password"]').last().fill(PASS);
  await page.locator('input[type="checkbox"]').last().check();
  const before = posted.filter((x) => x.path === '/api/admin/finance/adjustments').length;
  await sendBtn.dblclick();
  await page.waitForTimeout(900);
  const sent = posted.filter((x) => x.path === '/api/admin/finance/adjustments').slice(before);
  modal = await page.locator('body').innerText();
  check('⛔ دو کلیک ⇒ یک درخواست به سرورِ حساب', sent.length === 1, String(sent.length));
  check('با کلیدِ سرویس، «انجام‌دهنده»، کلیدِ یکتاییِ رابط و زمانِ احرازِ دوباره؛ بی رمز در بدنه',
    sent[0]?.bearer?.startsWith('vsk_') && /^panel:\d+$/.test(sent[0]?.actor) && /^pnl-[0-9a-f]{32}$/.test(sent[0]?.idem)
      && Number(sent[0]?.reauthAt) > NOW && !JSON.stringify(sent[0]?.body).includes(PASS)
      && sent[0]?.body?.kind === 'refund' && sent[0]?.body?.amount === 100 && sent[0]?.body?.expectedNet === 600, JSON.stringify(sent[0]));
  check('نتیجه «تأییدشدهٔ سرورِ حساب» با شمارهٔ سند', modal.includes('تأییدشدهٔ سرورِ حساب') && modal.includes('ADJ-2026-00007'), modal.slice(0, 600));
  await page.keyboard.press('Escape');

  console.log('\n── در انتظار، مغایرت، تاریخچه ──');
  body = await open('pending');
  check('درخواستِ خرید با قیمتِ برآوردی و روزهای انتظار', body.includes('دکانِ خریدار') && body.includes('۱٬۲۰۰') && body.includes('۵'), body.slice(0, 700));
  check('⛔ «ناموفق» ِ پرداختِ دستی گفته می‌شود، نه صفر', body.includes('«ناموفق» برایش ثبت نمی‌شود'));
  check('⛔ درگاه: BLOCKED-EXTERNAL: کلیدِ حساب‌پی نیامده', body.includes('BLOCKED-EXTERNAL: کلیدِ حساب‌پی نیامده'), body.slice(0, 1200));
  body = await open('recon');
  check('یافتهٔ مغایرت با برچسب و نمونه؛ یافتهٔ صفر پنهان', body.includes('پرداختِ بی اشتراک') && body.includes('دکانِ بی‌اشتراک') && !body.includes('شمارهٔ رسیدِ تکراری'), body.slice(0, 900));
  check('تطبیقِ فروشِ آنلاین (#411) برای مالک، به افغانی', body.includes('تطبیقِ فروشِ آنلاینِ دکان‌ها') && body.includes('۱۲٬۲۴۵'), body.slice(0, 1500));
  body = await open('history');
  check('تاریخچه: سندِ اصلاحی با انجام‌دهندهٔ پنل و دلیل', body.includes('سندِ اصلاحی') && body.includes('برگشتِ حواله') && body.includes('admin'), body.slice(0, 700));

  console.log('\n── خطای بالادست ──');
  summaryFail = true;
  body = await open('');
  check('⛔ خطای بالادست با کدِ خودش (db_unavailable)', body.includes('db_unavailable'), body.slice(0, 700));
  summaryFail = false;

  console.log('\n── viewer ──');
  const vpage = await login('view1', 'Viewer!2026ui');
  body = await open('payments', vpage);
  check('viewer دفتر را می‌بیند ولی دکمهٔ خروجی ندارد', body.includes('R-pay1') && !body.includes('خروجیِ CSV') && body.includes('فقط برای مالک/مالی'), body.slice(0, 600));
  await vpage.locator('main tr', { hasText: 'R-pay1' }).first().click();
  await vpage.waitForTimeout(500);
  check('⛔ viewer دکمهٔ سندِ اصلاحی ندارد', (await vpage.getByRole('button', { name: 'سندِ اصلاحی' }).count()) === 0);
  body = await open('recon', vpage);
  check('viewer: تطبیقِ فروشِ آنلاین «فقط مالک»', body.includes('فقط مالک'), body.slice(0, 900));

  console.log('\n── زبان و موبایل ──');
  await page.evaluate(() => localStorage.setItem('hlp.lang', 'en'));
  body = await open('');
  check('انگلیسی: زیرزبانه‌ها ترجمه شده‌اند', body.includes('Revenue & reports') && body.includes('Refunds & corrections'), body.slice(0, 300));
  await page.evaluate(() => localStorage.setItem('hlp.lang', 'ps'));
  body = await open('');
  check('پشتو: زیرزبانه‌ها ترجمه شده‌اند', body.includes('عاید او راپور'), body.slice(0, 300));
  await page.evaluate(() => localStorage.setItem('hlp.lang', 'fa'));
  await page.setViewportSize({ width: 390, height: 844 });
  await open('payments');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('موبایل: صفحه نوارِ افقی ندارد (جدول درونِ خودش می‌لغزد)', overflow <= 1, String(overflow));

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
