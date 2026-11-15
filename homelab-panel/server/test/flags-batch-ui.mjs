// ---------------------------------------------------------------------------
//  کارتِ «پرچم‌ها»، ۱.۵۱.۱ — «حالتِ تغییر» و ویرایشِ دسته‌ای در کرومیومِ واقعی
//      CHROME_PATH=… node test/flags-batch-ui.mjs        (SHOTS=<پوشه> ⇒ flags-batch.png)
//
//    ⛔ دامنهٔ پیش‌فرض یک دکان است (تنها دکان / تازه‌ترین)، نه «همه»
//    ⛔ نوارِ «حالتِ تغییر باز است — n دقیقه مانده» با «بستن»
//    ⛔ ویرایش ⇒ سه کلید ⇒ «۳ تغییر در انتظار» ⇒ «ذخیرهٔ ۳ تغییر» = **یک** درخواست به پنل و سه نوشتن در سرورِ حساب
//    ⛔ یک دکان ⇒ فقط خلاصه (بی نوشتنِ تأیید، بی رمز)؛ «همهٔ دکان‌ها» ⇒ نوشتنِ «all» و (پنجرهٔ بسته) رمز ⇒ پنجره باز می‌شود
//    ⛔ شرحِ فارسی درشت، کلید کوچک؛ جست‌وجو
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
const known = [
  { key: 'shop.receipt_v2', scope: 'shop', default: false, what: 'فاکتورِ نسخهٔ ۲' },
  { key: 'shop.chat', scope: 'shop', default: false, what: 'گفت‌وگو با مشتری' },
  { key: 'shop.promo_stamp', scope: 'shop', default: false, what: 'نشانِ تخفیفِ خودکار روی فاکتور' },
  { key: 'shop.image_bank', scope: 'shop', default: false, what: 'بانکِ تصاویرِ دکان' },
  { key: 'shop.orders', scope: 'shop', default: false, what: 'سفارشِ آنلاین' },
  { key: 'shop.staff_time', scope: 'shop', default: false, what: 'ورود و خروجِ کارمند و پورسانتِ ماه' },
  { key: 'hashchain.audit', scope: 'security', default: false, what: 'زنجیرهٔ هشِ سابقه' },
];
const store = new Map([['all', new Map([['shop.receipt_v2', true]])], ['shp-1', new Map([['shop.staff_time', true]])]]);
const sm = (s) => { if (!store.has(s)) store.set(s, new Map()); return store.get(s); };
const writes = [];
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    let body = null;
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null; } catch { body = null; }
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, server: 'online', version: '2.14.5' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: ['flags.v1'], serverTime: NOW });
    if (p === '/api/admin/shops') return j(200, { total: 1, shops: [{ id: 'shp-1', name: 'دکانِ کریم', status: 'active' }] });
    if (p === '/api/admin/flags' && req.method === 'GET') {
      const scope = u.searchParams.get('scope') || 'all';
      return j(200, { scope, version: 1, known, items: [...sm(scope)].map(([key, value]) => ({ key, value, updatedAt: NOW - 3600e3, updatedBy: 'boss' })) });
    }
    if (p === '/api/admin/flags' && req.method === 'PUT') { writes.push({ m: 'PUT', ...body }); sm(body.scope).set(body.key, body.value); return j(200, { ok: true, scope: body.scope, key: body.key }); }
    if (p === '/api/admin/flags' && req.method === 'DELETE') { writes.push({ m: 'DELETE', ...body }); return j(200, { ok: true, removed: sm(body.scope).delete(body.key) }); }
    if (p === '/api/admin/flags/history') return j(200, { entries: [] });
    return j(404, { error: { code: 'not_found', message: 'این مسیر وجود ندارد' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

const PORT = Number(process.env.TEST_PORT || 4965);
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'FlagsUi!2026';
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'flags-batch-ui-'));
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
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, colorScheme: 'light' });
  page.on('pageerror', (e) => jsErrors.push(String(e.message)));
  const batchCalls = [];
  page.on('request', (r) => { if (r.url().includes('/console/flags/batch')) batchCalls.push(r.postDataJSON()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('input[autocomplete="username"]', 'admin');
  await page.fill('input[type="password"]', PW);
  await page.locator('form button.btn-primary').click();
  await page.waitForSelector('aside nav', { timeout: 20000 });
  const token = await page.evaluate(() => localStorage.getItem('hlp.token'));
  const api = (method, p, body) => fetch(BASE + p, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
  await api('POST', '/api/account-admin/console/flags/sudo', { password: PW });

  console.log('\n── کارت ──');
  await page.goto(`${BASE}/shop?tab=settings`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="flags-list"]', { timeout: 15000 });
  const card = page.locator('main .card', { has: page.locator('[data-testid="flags-list"]') });
  check('⛔ دامنهٔ پیش‌فرض = تنها دکان (نه «همه»)', (await page.locator('select[data-testid="flags-scope"]').inputValue()) === 'shp-1');
  const banner = page.locator('[data-testid="flags-sudo"]');
  check('نوارِ «حالتِ تغییر باز است — n دقیقه مانده» با «بستن»', /حالتِ تغییر باز است — [۱۴۵]+ دقیقه مانده/.test(await banner.innerText()) && (await banner.getByRole('button', { name: 'بستن' }).count()) === 1, await banner.innerText());
  const firstRow = page.locator('[data-testid="flags-list"] li').first();
  const whatSize = await firstRow.locator('p').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const keySize = await firstRow.locator('code').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  check('شرحِ فارسی درشت (۱۴px)، کلید کوچک و فرعی', whatSize >= 14 && keySize <= 11.5 && (await firstRow.innerText()).includes('فاکتورِ نسخهٔ ۲'), `${whatSize} ${keySize}`);
  await card.locator('input[type="search"]').fill('گفت');
  check('جست‌وجو در شرح', (await page.locator('[data-testid="flags-list"] li').count()) === 1 && (await page.locator('[data-testid="flags-list"]').innerText()).includes('shop.chat'));
  await card.locator('input[type="search"]').fill('promo');
  check('…و در کلید', (await page.locator('[data-testid="flags-list"] li').count()) === 1);
  await card.locator('input[type="search"]').fill('');

  console.log('\n── ویرایشِ دسته‌ای ──');
  await card.getByRole('button', { name: 'ویرایش' }).click();
  for (const k of ['shop.chat', 'shop.promo_stamp', 'shop.image_bank']) await page.locator('[data-testid="flags-list"] li', { hasText: k }).getByRole('switch').click();
  const bar = page.locator('[data-testid="flags-pending"]');
  check('⛔ «۳ تغییر در انتظار» و «ذخیرهٔ ۳ تغییر»', (await bar.innerText()).includes('۳ تغییر در انتظار') && (await bar.getByRole('button', { name: 'ذخیرهٔ ۳ تغییر' }).count()) === 1, await bar.innerText());
  check('ردیف‌های در انتظار نشان‌دار', (await page.locator('[data-testid="flags-list"] li[data-pending="1"]').count()) === 3);
  check('⛔ با تغییرِ در انتظار دامنه قفل است', await page.locator('select[data-testid="flags-scope"]').isDisabled());
  await card.scrollIntoViewIfNeeded();
  if (process.env.SHOTS) await card.screenshot({ path: path.join(process.env.SHOTS, 'flags-batch.png') });
  await page.locator('[data-testid="flags-list"] li', { hasText: 'shop.image_bank' }).getByRole('switch').click();
  check('دوباره زدنِ همان کلید ⇒ از «در انتظار» بیرون', (await bar.innerText()).includes('۲ تغییر در انتظار'));
  await page.locator('[data-testid="flags-list"] li', { hasText: 'shop.image_bank' }).getByRole('switch').click();
  await bar.getByRole('button', { name: 'ذخیرهٔ ۳ تغییر' }).click();
  const dlg = page.locator('[role="dialog"]');
  await dlg.waitFor();
  check('⛔ یک دکان ⇒ فقط خلاصهٔ سه تغییر؛ بی نوشتنِ تأیید و بی رمز', (await dlg.locator('ul li').count()) === 3 && (await dlg.locator('input[autocomplete="current-password"]').count()) === 0
    && !(await dlg.innerText()).includes('برای تأیید'), await dlg.innerText());
  await dlg.locator('textarea').fill('آماده‌سازیِ دکانِ کریم');
  let w0 = writes.length;
  await dlg.locator('[data-testid="flags-save"]').dblclick();
  await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 10000 });
  await page.waitForTimeout(400);
  check('⛔ یک درخواست به پنل (دوکلیک هم) و سه نوشتن در سرورِ حساب با همان دلیل', batchCalls.length === 1 && batchCalls[0].changes.length === 3 && writes.length - w0 === 3
    && writes.slice(w0).every((x) => x.scope === 'shp-1' && x.reason === 'آماده‌سازیِ دکانِ کریم'), JSON.stringify(batchCalls));
  check('«۳ تغییر … ذخیره شد — تأییدشده از سرورِ حساب»', (await card.innerText()).includes('تأییدشده از سرورِ حساب'));
  check('دکان در «اخیر» ِ مرورگر', (await page.evaluate(() => localStorage.getItem('hlp.flags.recentShops'))) === '["shp-1"]');

  console.log('\n── «همهٔ دکان‌ها» با پنجرهٔ بسته ──');
  await banner.getByRole('button', { name: 'بستن' }).click();
  await page.waitForTimeout(400);
  check('«بستن» ⇒ نوار رفت و سرور هم بسته می‌گوید', (await banner.count()) === 0 && (await api('GET', '/api/account-admin/console/flags/sudo')).open === false);
  await page.locator('select[data-testid="flags-scope"]').selectOption('all');
  await page.waitForTimeout(400);
  check('هشدارِ «همهٔ دکان‌ها» سرِ جایش', (await card.innerText()).includes('روی همهٔ دکان‌هایی اثر دارد'));
  await card.getByRole('button', { name: 'ویرایش' }).click();
  for (const k of ['shop.chat', 'shop.orders']) await page.locator('[data-testid="flags-list"] li', { hasText: k }).getByRole('switch').click();
  await page.locator('[data-testid="flags-pending"]').getByRole('button', { name: 'ذخیرهٔ ۲ تغییر' }).click();
  await dlg.waitFor();
  const save = dlg.locator('[data-testid="flags-save"]');
  await dlg.locator('textarea').fill('روشن برای همه');
  check('⛔ «همه» ⇒ نوشتنِ «all» و رمز (پنجره بسته)', (await dlg.innerText()).includes('برای تأیید، «all» را بنویسید') && (await dlg.locator('input[autocomplete="current-password"]').count()) === 1 && await save.isDisabled());
  await dlg.locator('input.font-mono').first().fill('all');
  check('…بی رمز هنوز بسته', await save.isDisabled());
  await dlg.locator('input[autocomplete="current-password"]').fill(PW);
  w0 = writes.length;
  await save.click();
  await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 10000 });
  await page.waitForTimeout(500);
  check('دو نوشتن با scope ِ all، و پنجره دوباره باز (نوار برگشت)', writes.length - w0 === 2 && writes.slice(w0).every((x) => x.scope === 'all')
    && (await banner.count()) === 1, JSON.stringify(writes.slice(w0)));
  check('⛔ رمز در درخواستِ بعدی لازم نیست: پنجره باز است', (await api('GET', '/api/account-admin/console/flags/sudo')).open === true);

  check('هیچ خطای جاوااسکریپت', jsErrors.length === 0, jsErrors.join(' | '));
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
  console.log(out.slice(-1500));
} finally {
  await browser?.close().catch(() => {});
  server.kill('SIGTERM');
  fake.close();
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
