// ---------------------------------------------------------------------------
//  آزمونِ رابطِ «دامنه‌های هر برنامه» (۱.۵۰.۹۹) — کرومیوم، روی بیلدِ واقعیِ ‎server/public‎
//      node test/app-domains-ui.mjs
//
//  مالک: «سرورهای من» ⇐ کارتِ «دامنه‌های هر برنامه» ⇐ نامِ فارسی برای پمپ‌ها (نمای فارسی + punycode، «اصلی»)، گامِ دستیِ مسیر
//  (این سرور تونلِ نام‌دار ندارد)، نامِ ستاره‌دار ⇒ پیامِ خودِ سرور، «بردار» با تأیید. مدیرِ دوم: صفحه «فقط مالک» و هیچ درخواستی
//  به ‎/api/app-domains‎. بی خطای جاوااسکریپت.
// ---------------------------------------------------------------------------
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

const PORT = Number(process.env.TEST_PORT || 4979);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'app-domains-ui-'));
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
  env: { ...process.env, HLP_PORT: String(PORT), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: path.join(tmp, 'data'),
         HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_SITESYNC_PORT: String(PORT + 1), HLP_DISCOVERY_PORT: String(PORT + 2), HLP_AI_ENABLED: '0',
         HLP_TUNNEL: '0', HLP_AUTOMATION: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_DISCOVERY: '0', HLP_AGENT: '0', HLP_UPDATE_AUTO: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

let browser;
const jsErrors = [];
const PW = 'Domains!UI2026';
const PW2 = 'Admin2!UI2026';
const watch = (pg) => {
  pg.on('pageerror', (e) => jsErrors.push(String(e.message)));
  //  ‎400/403/409‎ ِ ردهای همین آزمون خطای صفحه نیستند
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*\b(400|403|409)\b/.test(m.text())) jsErrors.push(m.text()); });
};
async function signIn(pg, u, pw) {
  await pg.goto(BASE, { waitUntil: 'networkidle' });
  await pg.fill('input[autocomplete="username"]', u);
  await pg.fill('input[type="password"]', pw);
  await pg.locator('form button').last().click();
  await pg.waitForFunction(() => !document.querySelector('input[type="password"]'), null, { timeout: 20000 });
  await pg.waitForLoadState('networkidle');
}

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!CHROME) throw new Error('کرومیوم پیدا نشد — CHROME_PATH را بگذارید');
  const owner = (await (await fetch(`${BASE}/api/auth/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'owner', password: PW }) })).json()).token;
  await fetch(`${BASE}/api/auth/users`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${owner}` }, body: JSON.stringify({ username: 'admin2', password: PW2, role: 'admin' }) });
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

  /* ── مالک ── */
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  watch(page);
  await signIn(page, 'owner', PW);
  await page.goto(`${BASE}/my-servers`, { waitUntil: 'networkidle' });
  const card = page.locator('.card', { hasText: 'دامنه‌های هر برنامه' }).first();
  await card.waitFor({ timeout: 15000 });
  check('کارتِ «دامنه‌های هر برنامه» در «سرورهای من»', await card.isVisible());
  check('… پمپ‌ها با «فقط داده» و گامِ دستیِ مسیر (این سرور تونلِ نام‌دار ندارد)', (await card.innerText()).includes('پمپ‌ها (تانک‌تیل)') && (await card.innerText()).includes('فقط داده') && (await card.innerText()).includes('مسیرِ Cloudflare را خودش نمی‌نویسد'));
  const row = card.locator('div.rounded-xl', { hasText: 'پمپ‌ها (تانک‌تیل)' }).first();
  await row.locator('input.input').fill('پمپ.ui-test.example');
  await row.getByRole('button', { name: 'افزودن' }).click();
  await row.locator('li', { hasText: 'پمپ.ui-test.example' }).first().waitFor({ timeout: 15000 });
  const li = row.locator('li', { hasText: 'پمپ.ui-test.example' }).first();
  const liText = await li.innerText();
  check('نامِ فارسی افزوده شد: نمای فارسی + punycode، «اصلی»', /xn--/.test(liText) && liText.includes('اصلی'), liText);
  check('… گامِ دستی (رکوردِ A/CNAME) زیرِ همان برنامه', (await row.innerText()).includes('گامِ دستی'), await row.innerText());
  await row.locator('input.input').fill('*.ui-test.example');
  await row.getByRole('button', { name: 'افزودن' }).click();
  const toastBad = page.locator('text=ستاره‌دار').first();
  await toastBad.waitFor({ timeout: 10000 }).catch(() => {});
  check('نامِ ستاره‌دار ⇒ پیامِ خودِ سرور (فارسی)', await toastBad.isVisible().catch(() => false));
  await li.getByRole('button', { name: 'بردار' }).click();
  const dlg = page.getByRole('dialog').last();
  await dlg.waitFor({ timeout: 10000 });
  check('برداشتن پنجرهٔ تأیید دارد (DNS پاک نمی‌شود)', (await dlg.innerText()).includes('DNS'), await dlg.innerText());
  await dlg.getByRole('button').last().click();
  await row.locator('li', { hasText: 'پمپ.ui-test.example' }).first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  check('… برداشته شد', !(await row.innerText()).includes('پمپ.ui-test.example'), await row.innerText());

  /* ── مدیرِ دوم ── */
  const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const p2 = await ctx2.newPage();
  watch(p2);
  const hits = [];
  p2.on('request', (rq) => { if (rq.url().includes('/api/app-domains')) hits.push(rq.url()); });
  await signIn(p2, 'admin2', PW2);
  await p2.goto(`${BASE}/my-servers`, { waitUntil: 'networkidle' });
  check('مدیرِ دوم: کارت نیست و هیچ درخواستی به ‎/api/app-domains‎ نرفت', !(await p2.locator('text=دامنه‌های هر برنامه').count()) && hits.length === 0, hits.join(' '));

  check('بی خطای جاوااسکریپت', jsErrors.length === 0, jsErrors.join(' | '));
} catch (e) {
  check('بی خطای پیش‌بینی‌نشده', false, e.stack);
} finally {
  await browser?.close().catch(() => {});
  server.kill('SIGTERM');
  await new Promise((r) => { server.once('exit', r); setTimeout(r, 8000); });
  if (fail && process.env.KEEP_LOGS) fs.writeFileSync(path.join(os.tmpdir(), 'app-domains-ui.log'), out);
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}
console.log(`\n${fail ? '❌' : '✅'} رابطِ دامنه‌های هر برنامه: ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
