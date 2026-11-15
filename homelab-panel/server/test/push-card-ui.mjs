// ---------------------------------------------------------------------------
//  «اعلانِ گوشی (Firebase)» و «پنلِ مدیرِ سرور»، ۱.۵۱.۲ — در کرومیومِ واقعی
//      CHROME_PATH=… node test/push-card-ui.mjs        (SHOTS=<پوشه> ⇒ push-card-{light,dark}.png، admin-web-*.png، push-*-en.png)
//
//    ⛔ کادرِ متن: dir=ltr، تک‌فاصله، autocomplete/spellcheck خاموش؛ «انتخابِ فایل» فقط در حافظه (هیچ درخواستی جز ذخیره)
//    ⛔ کلیدِ بد ⇒ پیامِ فارسیِ «این فایلِ کلید نیست…» و «ذخیره» خاموش؛ کلیدِ درست ⇒ «✓ کلیدِ پروژهٔ …»
//    ⛔ ذخیره با «حالتِ تغییر» ِ بسته ⇒ پنجرهٔ رمز ⇒ ذخیره ⇒ کادر خالی، حالِ تازه (روشن · n دستگاه · پروژه)
//    ⛔ کلید پس از ذخیره نه در DOM، نه در localStorage/sessionStorage، نه در نشانیِ هیچ درخواستی، نه در کنسول
//    ⛔ دو کلیدِ ‎shop.device_push‎/‎shop.order_notify‎ زیرِ همان کارت؛ «پنلِ مدیرِ سرور» با نشانیِ تنظیم و دلیلِ «باز نمی‌شود»
//    ⛔ میان‌بُرها: منوی کناری (زبانهٔ تازه) و جست‌وجوی بخش
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
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
const SHOTS = process.env.SHOTS || '';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 400)}`);
};

const MARK = `pkmark${crypto.randomBytes(10).toString('hex')}`;
const KEY = JSON.stringify({
  type: 'service_account', project_id: 'karim-shop-push', private_key_id: crypto.randomBytes(8).toString('hex'),
  private_key: `TEST-ONLY-NOT-A-KEY-${MARK}`, client_email: 'firebase-adminsdk@karim-shop-push.example', client_id: '0',
}, null, 2);

const NOW = Date.now();
const known = [
  { key: 'shop.order_notify', scope: 'shop', default: false, what: 'اعلانِ سفارشِ تازه، پرداخت و لغوِ مشتری به گوشی‌های دکان (صفِ پایدار و یادآوری)' },
  { key: 'shop.device_push', scope: 'shop', default: false, what: 'پوشِ گوشی با Firebase: ثبتِ توکنِ دستگاه‌های دکان (برنامهٔ بسته هم زنگ می‌زند)' },
  { key: 'shop.chat', scope: 'shop', default: false, what: 'گفت‌وگو با مشتری' },
];
const flags = new Map([['all', new Map()], ['shp-1', new Map()]]);
const state = { enabled: false, configured: false, project: '', account: '' };
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    let body = null;
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null; } catch { body = null; }
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, server: 'online' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: ['flags.v1'], serverTime: NOW });
    if (p === '/api/admin/shops') return j(200, { total: 1, shops: [{ id: 'shp-1', name: 'دکانِ کریم', status: 'active' }] });
    if (p === '/api/admin/flags' && req.method === 'GET') {
      const scope = u.searchParams.get('scope') || 'all';
      const m = flags.get(scope) || new Map();
      return j(200, { scope, version: 1, known, items: [...m].map(([key, value]) => ({ key, value, updatedAt: NOW, updatedBy: 'boss' })) });
    }
    if (p === '/api/admin/flags' && req.method === 'PUT') { (flags.get(body.scope) || flags.set(body.scope, new Map()).get(body.scope)).set(body.key, body.value); return j(200, { ok: true, scope: body.scope, key: body.key }); }
    const masked = () => ({ push: { ...state, source: state.configured ? 'panel' : '', devices: state.configured ? 7 : 0, apns: { configured: false, env: '', reason: 'off' } } });
    if (p === '/api/admin/push' && req.method === 'GET') return j(200, masked());
    if (p === '/api/admin/push' && req.method === 'PUT') {
      if (typeof body?.enabled === 'boolean') state.enabled = body.enabled;
      if (typeof body?.serviceAccount === 'string') { const sa = JSON.parse(body.serviceAccount); Object.assign(state, { configured: true, project: sa.project_id, account: sa.client_email }); }
      return j(200, masked());
    }
    return j(404, { error: { code: 'not_found', message: 'این مسیر وجود ندارد' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

const PORT = Number(process.env.TEST_PORT || 4967);
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'PushUi!2026';
const DOMAIN = 'karim-shop.invalid';
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'push-card-ui-'));
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
  env: { ...process.env, HLP_PORT: String(PORT), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: path.join(tmp, 'data'),
         HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_SITESYNC: '0', HLP_AI_ENABLED: '0', HLP_TUNNEL: '0',
         HLP_AUTOMATION: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_ACCOUNT_API: `http://127.0.0.1:${fake.address().port}`,
         HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret', HLP_DOMAIN: DOMAIN },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

let browser;
const jsErrors = [];
const consoleText = [];
try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!CHROME) throw new Error('کرومیوم پیدا نشد — CHROME_PATH را بگذارید');
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, colorScheme: 'light' });
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('hlp.theme')) localStorage.setItem('hlp.theme', 'light'); } catch { /* */ } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => jsErrors.push(String(e.message)));
  page.on('console', (m) => consoleText.push(m.text()));
  const requests = [];
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), body: r.postData() || '' }));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await fetch(`${BASE}/api/auth/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'owner', password: PW }) });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('input[autocomplete="username"]', 'owner');
  await page.fill('input[type="password"]', PW);
  await page.locator('form button.btn-primary').click();
  await page.waitForSelector('aside nav', { timeout: 20000 });

  console.log('\n── کارت ──');
  await page.goto(`${BASE}/shop?tab=settings&card=push`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="push-card"]', { timeout: 15000 });
  const card = page.locator('main .card', { has: page.locator('[data-testid="push-card"]') });
  check('عنوانِ «اعلانِ گوشی (Firebase)»', (await card.locator('h2').innerText()).includes('اعلانِ گوشی (Firebase)'));
  const st = page.locator('[data-testid="push-state"]');
  check('حال: «فایلِ کلید داده نشده»', (await st.getAttribute('data-state')) === 'unset' && (await st.innerText()).includes('فایلِ کلید داده نشده'), await st.innerText());
  check('راهنما: یک بند و چهار گامِ شماره‌دار (Project settings ← Service accounts ← Generate new private key)',
    (await page.locator('[data-testid="push-help"] ol li').count()) === 4 && /Project settings[\s\S]*Service accounts[\s\S]*Generate new private key/.test(await page.locator('[data-testid="push-help"]').innerText()));
  const ta = page.locator('[data-testid="push-sa"]');
  const attrs = await ta.evaluate((el) => ({ dir: el.getAttribute('dir'), ac: el.getAttribute('autocomplete'), sc: el.getAttribute('spellcheck'),
    font: getComputedStyle(el).fontFamily, label: document.querySelector('label[for="push-sa"]')?.textContent || '' }));
  check('⛔ کادر: dir=ltr، تک‌فاصله، autocomplete و spellcheck خاموش، برچسبِ «متنِ فایلِ کلید (Service account JSON)»',
    attrs.dir === 'ltr' && attrs.ac === 'off' && attrs.sc === 'false' && /mono/i.test(attrs.font) && attrs.label.includes('متنِ فایلِ کلید (Service account JSON)'), JSON.stringify(attrs));
  check('بی کلید «روشن» ⇒ «ذخیره» خاموش با هشدار', await (async () => { await page.locator('[data-testid="push-enabled"]').click(); const d = await page.locator('[data-testid="push-save"]').isDisabled(); await page.locator('[data-testid="push-enabled"]').click(); return d; })());

  await ta.fill('{"project_info":{"project_id":"x"},"client":[]}');
  check('⛔ فایلِ اشتباه (google-services.json) ⇒ «این فایلِ کلید نیست…» و ذخیره خاموش',
    (await page.locator('[data-testid="push-problem"]').innerText()).includes('این فایلِ کلید نیست؛ فایلی را بزنید که از Service accounts ← Generate new private key گرفتید') && await page.locator('[data-testid="push-save"]').isDisabled());
  await ta.fill('');

  const before = requests.length;
  await page.locator('#push-file').setInputFiles({ name: 'karim-shop-push-firebase-adminsdk.json', mimeType: 'application/json', buffer: Buffer.from(KEY) });
  await page.waitForFunction(() => document.querySelector('[data-testid="push-sa"]')?.value.includes('service_account'));
  check('«انتخابِ فایل» ⇒ متن در کادر، فقط در حافظه (هیچ درخواستی)', requests.slice(before).length === 0, JSON.stringify(requests.slice(before).map((r) => r.url)));
  check('کلیدِ درست ⇒ «✓ کلیدِ پروژهٔ karim-shop-push»', (await page.locator('[data-testid="push-summary"]').innerText()).includes('karim-shop-push'));
  await page.locator('[data-testid="push-enabled"]').click();
  check('«روشن» روشن شد', (await page.locator('[data-testid="push-enabled"]').getAttribute('aria-checked')) === 'true');
  if (SHOTS) await card.screenshot({ path: path.join(SHOTS, 'push-card-filled-light.png') });

  await page.locator('[data-testid="push-save"]').click();
  await page.waitForSelector('[data-testid="push-confirm"]', { timeout: 5000 });
  check('«حالتِ تغییر» بسته ⇒ پنجرهٔ رمز', await page.locator('[data-testid="push-confirm"]').isVisible());
  await page.locator('.modal input[type="password"], [role="dialog"] input[type="password"]').first().fill(PW);
  await page.locator('[data-testid="push-confirm"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="push-state"]')?.getAttribute('data-state') === 'on', null, { timeout: 10000 });
  const after = await st.innerText();
  check('ذخیره ⇒ «✅ روشن · ۷ دستگاه · karim-shop-push»', /روشن/.test(after) && /۷|7/.test(after) && after.includes('karim-shop-push'), after);
  check('⛔ پس از ذخیره کادر خالی است', (await ta.inputValue()) === '');
  const html = await page.content();
  check('⛔ کلید در DOM نمانده', !html.includes(MARK));
  const stores = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  check('⛔ کلید در localStorage/sessionStorage نیست', !stores.includes(MARK));
  const put = requests.filter((r) => r.url.includes('/api/account-admin/console/push') && r.method === 'PUT');
  check('⛔ یک ‎PUT‎ به درِ پنل؛ کلید فقط در بدنه، هرگز در نشانیِ هیچ درخواستی', put.length === 1 && requests.every((r) => !r.url.includes(MARK)) && requests.filter((r) => r.body.includes(MARK)).length === 1,
    JSON.stringify(put.map((r) => r.url)));
  check('⛔ کلید در کنسولِ مرورگر نیست', consoleText.every((t) => !t.includes(MARK)));
  check('پنجرهٔ «حالتِ تغییر» باز شد (نوارِ سبزِ «رمز لازم نیست»)', (await card.innerText()).includes('حالتِ تغییر باز است'));
  if (SHOTS) await card.screenshot({ path: path.join(SHOTS, 'push-card-light.png') });

  console.log('\n── کلیدهای دکان ──');
  const list = page.locator('[data-testid="pushflags-list"] li');
  check('دو کلیدِ «اعلانِ سفارش» و «ثبتِ دستگاه» زیرِ همان کارت، کلیدها از اول فعال', (await list.count()) === 2
    && (await page.locator('[data-testid="pushflags-list"] [role="switch"]').count()) === 2, String(await list.count()));
  check('دامنهٔ پیش‌فرض یک دکان (تنها دکان)', (await page.locator('select[data-testid="pushflags-scope"]').inputValue()) === 'shp-1');
  check('ترتیب همان ‎PUSH_FLAG_KEYS‎: اول «ثبتِ دستگاه»، بعد «اعلانِ سفارش»', (await list.nth(0).innerText()).includes('shop.device_push') && (await list.nth(1).innerText()).includes('shop.order_notify'));
  await page.locator('[data-testid="pushflags-list"] [role="switch"]').nth(0).click();
  await page.locator('[data-testid="pushflags-pending"] .btn-primary').click();
  await page.locator('textarea[maxlength="200"]').fill('روشن کردنِ اعلانِ گوشی');
  await page.locator('[data-testid="pushflags-save"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="pushflags-save"]'), null, { timeout: 10000 });
  check('یک کلیک + دلیل ⇒ ‎shop.device_push‎ برای «دکانِ کریم» روشن (همان درِ دسته‌ای)', flags.get('shp-1')?.get('shop.device_push') === true, JSON.stringify([...(flags.get('shp-1') || [])]));
  check('کارتِ بزرگِ «پرچم‌ها» سرِ جایش (جدا از این دو)', (await page.locator('[data-testid="flags-list"]').count()) === 1);

  console.log('\n── پنلِ مدیرِ سرور ──');
  const open = page.locator('[data-testid="admin-web-open"]');
  check('دکمهٔ «باز کردنِ پنلِ مدیرِ سرور» با نشانیِ تنظیمِ همین پنل، در زبانهٔ تازه',
    (await open.getAttribute('href')) === `https://api.${DOMAIN}/admin/` && (await open.getAttribute('target')) === '_blank' && /noopener/.test(await open.getAttribute('rel') || ''));
  await page.waitForFunction(() => document.querySelector('[data-testid="admin-web-check"]')?.getAttribute('data-code'), null, { timeout: 15000 });
  const code = await page.locator('[data-testid="admin-web-check"]').getAttribute('data-code');
  const why = await page.locator('[data-testid="admin-web-check"]').innerText();
  check('«باز می‌شود؟» ⇒ دلیلِ فارسیِ روشن (نامِ ناموجود ⇒ DNS) و راهِ درست کردن', ['dns', 'network', 'timeout'].includes(code) && (code !== 'dns' || (why.includes('DNS') && why.includes('دامنه‌ها و تونل'))), `${code} ${why}`);
  const adminCard = page.locator('main .card', { has: page.locator('[data-testid="admin-web"]') });
  check('نامِ کاربری با «کپی»، رمز با «نمایشِ یک‌باره» (مالک)', (await adminCard.innerText()).includes('boss') && (await page.locator('[data-testid="admin-web-reveal"]').count()) === 1);
  if (SHOTS) { await page.waitForTimeout(4500); await adminCard.screenshot({ path: path.join(SHOTS, 'admin-web-light.png') }); }

  console.log('\n── میان‌بُرها ──');
  const navAdmin = page.locator('aside [data-testid="nav-admin-web"]');
  check('منوی کناری: «پنلِ مدیرِ سرور» یک کلیک، زبانهٔ تازه', (await navAdmin.getAttribute('href')) === `https://api.${DOMAIN}/admin/` && (await navAdmin.getAttribute('target')) === '_blank');
  const order = await page.evaluate(() => [...document.querySelectorAll('aside nav[aria-label="ماژول‌های فروشگاه"] a.nav-item')].map((a) => a.getAttribute('data-testid') || a.getAttribute('href')));
  check('میان‌بُرها بالای منو، پس از «داشبورد» (داشبورد همچنان نخستین ردیف)', order[0] === '/shop' && order[1] === 'nav-admin-web' && order[2] === 'nav-push', order.slice(0, 4).join(' '));
  if (SHOTS) await page.locator('aside').screenshot({ path: path.join(SHOTS, 'shop-menu-shortcuts-light.png') });
  check('منوی کناری: «اعلانِ گوشی (Firebase)»', (await page.locator('aside [data-testid="nav-push"]').getAttribute('href')) === '/shop?tab=settings&card=push');
  await page.goto(`${BASE}/shop`, { waitUntil: 'networkidle' });
  await page.fill('#shop-console-search', 'firebase');
  await page.waitForSelector('[data-testid="search-shortcuts"] a', { timeout: 5000 });
  check('جست‌وجوی بخش: «firebase» ⇒ میان‌بُرِ «اعلانِ گوشی»', (await page.locator('[data-testid="search-shortcuts"]').innerText()).includes('اعلانِ گوشی'));
  await page.locator('[data-testid="search-shortcuts"] a').first().click();
  await page.waitForSelector('[data-testid="push-card"]', { timeout: 10000 });
  check('… و یک کلیک تا همان کارت', page.url().includes('card=push'));

  console.log('\n── تاریک و انگلیسی ──');
  await page.evaluate(() => localStorage.setItem('hlp.theme', 'dark'));
  await page.goto(`${BASE}/shop?tab=settings&card=push`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="push-card"]');
  check('قالبِ تاریک', (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark');
  await page.waitForFunction(() => document.querySelector('[data-testid="admin-web-check"]')?.getAttribute('data-code'), null, { timeout: 15000 });
  if (SHOTS) {
    await page.locator('main .card', { has: page.locator('[data-testid="push-card"]') }).screenshot({ path: path.join(SHOTS, 'push-card-dark.png') });
    await page.locator('main .card', { has: page.locator('[data-testid="admin-web"]') }).screenshot({ path: path.join(SHOTS, 'admin-web-dark.png') });
    await page.screenshot({ path: path.join(SHOTS, 'settings-page-dark.png') });
  }
  await page.evaluate(() => { localStorage.setItem('hlp.theme', 'light'); localStorage.setItem('hlp.lang', 'en'); });
  await page.goto(`${BASE}/shop?tab=settings&card=push`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="push-card"]');
  const enTitle = await page.locator('main .card', { has: page.locator('[data-testid="push-card"]') }).locator('h2').innerText();
  check('انگلیسی: «Phone notifications (Firebase)» (سه زبان با tx)', enTitle.includes('Phone notifications (Firebase)') || (await page.evaluate(() => document.documentElement.lang)) !== 'en', enTitle);
  if (SHOTS) await page.locator('main .card', { has: page.locator('[data-testid="push-card"]') }).screenshot({ path: path.join(SHOTS, 'push-card-en-light.png') });
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

if (fail) console.log('\n' + out.slice(-1500));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
