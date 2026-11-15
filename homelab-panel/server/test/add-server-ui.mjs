// ---------------------------------------------------------------------------
//  «افزودنِ سرور» (۱.۵۱.۱) در کرومیومِ واقعی — جادوگرِ «چه خریده‌اید؟»
//      CHROME_PATH=… node test/add-server-ui.mjs     (SHOTS=<پوشه> ⇒ wizard-{choose,vps,host,connected}.png و add-server.png)
//
//    ⛔ سه گزینه (VPS · هاستِ اشتراکی · کامپیوترِ دیگرِ خانه) + «سرورِ پنل‌دار» + یک خطِ «cPanel سرورِ کامل نمی‌شود»
//    ⛔ VPS: یک خطِ ‎curl … | sudo VILL3N_DEPLOY=vps VILL3N_JOIN_CENTER=<https ِ مرکز> VILL3N_JOIN_CODE=<کد> bash‎ با «کپیِ دستور»،
//       کمینهٔ سخت‌افزار، راهِ SSH، شمارشِ ۱۰ دقیقه، «کدِ تازه»، و «منتظرِ وصل شدن…»
//    ⛔ هاست: دانلودِ ‎vill3n-host.zip‎ (بلیتِ یک‌بارمصرف، بی توکن در نشانی)، گام‌های cPanel، محدودیت‌ها
//    ⛔ نمایندهٔ واقعی از همان zip با همان کد ⇒ پنجره خودش «وصل شد ✓» می‌گوید
//    ⛔ سرورِ پنل‌دار: نشانیِ مرکز + کد با دکمهٔ کپی
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SERVER_DIR = path.join(import.meta.dirname, '..');
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'add-server-ui-'));
const ACCT = path.join(tmp, 'acct');
fs.mkdirSync(path.join(ACCT, 'src'), { recursive: true });
fs.writeFileSync(path.join(ACCT, 'package.json'), JSON.stringify({ name: 'fake-account', version: '9.9.9' }));
fs.writeFileSync(path.join(ACCT, 'src', 'index.js'), `'use strict';
require('node:http').createServer((q, s) => { s.setHeader('content-type', 'application/json'); s.end('{"ok":true}'); }).listen(Number(process.env.PORT || 0), '127.0.0.1');
`);
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

const PORT = Number(process.env.TEST_PORT || 4975);
const BASE = `http://127.0.0.1:${PORT}`;
const API_URL = 'https://api.example.af';
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(SERVER_DIR, 'src', 'index.js')], {
  env: { ...process.env, HLP_PORT: String(PORT), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
    HLP_SITESYNC_PORT: String(PORT + 1), HLP_DISCOVERY: '0', HLP_AI_ENABLED: '0', HLP_TUNNEL: '0', HLP_AUTOMATION: '0', HLP_ACCOUNT_AUTOSTART: '0',
    HLP_ACCOUNT_DIR: ACCT, HLP_API_URL: API_URL, HLP_STATIONS: '0', HLP_UPDATE_AUTO: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));
let agent = null;
let agentOut = '';

let browser;
const jsErrors = [];
const shot = async (page, name, el) => { if (process.env.SHOTS) await (el || page).screenshot({ path: path.join(process.env.SHOTS, `${name}.png`) }); };
try {
  for (let i = 0; i < 160; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* */ } await wait(250); }
  if (!CHROME) throw new Error('کرومیوم پیدا نشد — CHROME_PATH را بگذارید');
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true, colorScheme: 'light' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => jsErrors.push(String(e.message)));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('input[autocomplete="username"]', 'admin');
  await page.fill('input[type="password"]', 'AddServer!2026');
  await page.locator('form button.btn-primary').click();
  await page.waitForSelector('aside nav', { timeout: 20000 });
  await page.goto(`${BASE}/my-servers`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'افزودنِ سرور' }).click();
  const wiz = page.locator('[data-testid="wizard-choose"]');
  await wiz.waitFor();
  const card = page.locator('main .card', { has: page.locator('[data-testid="wizard-choose"]') });

  console.log('\n── «چه خریده‌اید؟» ──');
  const text = await wiz.innerText();
  check('سه گزینه + «سرورِ پنل‌دار» + یک خطِ cPanel', text.includes('چه خریده‌اید؟') && text.includes('VPS / سرورِ لینوکسی') && text.includes('هاستِ اشتراکی (cPanel)')
    && text.includes('کامپیوترِ دیگر در خانه') && text.includes('سرورِ پنل‌دار') && text.includes('سرورِ کامل نمی‌شود'), text);
  await shot(page, 'wizard-choose', card);
  let codes = 0;
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/fleet/codes')) codes++; });
  check('⛔ با باز شدنِ پنجره کدی ساخته نشد (فقط پس از انتخاب)', codes === 0);

  console.log('\n── VPS ──');
  await page.locator('[data-choice="vps"]').click();
  const vps = page.locator('[data-testid="wizard-vps"]');
  await vps.waitFor({ timeout: 10000 });
  const cmd = await page.locator('[data-testid="wizard-command"]').innerText();
  const m = /VILL3N_JOIN_CODE=([0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}) bash$/.exec(cmd.trim());
  check('⛔ یک خطِ آماده: install.sh از main + VILL3N_DEPLOY=vps + مرکزِ https + کد', cmd.startsWith('curl -fsSL https://raw.githubusercontent.com/vil3ntec-it/server/main/install.sh | sudo VILL3N_DEPLOY=vps')
    && cmd.includes(`VILL3N_JOIN_CENTER=${API_URL} `) && Boolean(m), cmd);
  const vtext = await vps.innerText();
  check('کمینهٔ سخت‌افزار و راهِ SSH (ویندوز و گوشی)', /Ubuntu 22\.04 یا 24\.04/.test(vtext) && /۲ هستهٔ CPU/.test(vtext) && /۴۰ گیگ/.test(vtext) && /ssh root@/.test(vtext) && /Termius/.test(vtext), vtext.slice(0, 600));
  const cd = await page.locator('[data-testid="wizard-countdown"]').innerText();
  check('شمارشِ ۱۰ دقیقه (۹:۵x)', /^(10:00|9:5\d)$/.test(cd.trim()), cd);
  check('متنِ «فقط یک بار و تا ۱۰ دقیقه…»', vtext.includes('این کد فقط یک بار و تا ۱۰ دقیقه کار می‌کند و فقط برای وصل کردنِ سرورِ تازه به همین پنل است؛ بعد از وصل شدن دیگر لازم نیست'));
  check('«منتظرِ وصل شدن…»', (await page.locator('[data-testid="wizard-live"]').innerText()).includes('منتظرِ وصل شدن'));
  await page.locator('[data-testid="wizard-copy"]').click();
  check('⛔ «کپیِ دستور» همان یک خط را در حافظه می‌گذارد', (await page.evaluate(() => navigator.clipboard.readText())) === cmd.trim());
  await shot(page, 'wizard-vps', page.locator('main .card', { has: vps }));
  await shot(page, 'add-server', page.locator('main .card', { has: vps }));
  await page.getByRole('button', { name: 'کدِ تازه' }).click();
  await page.waitForTimeout(800);
  const cmd2 = await page.locator('[data-testid="wizard-command"]').innerText();
  check('«کدِ تازه» ⇒ دستور با کدِ دیگر', cmd2 !== cmd && /VILL3N_JOIN_CODE=[0-9A-Z-]{14} bash$/.test(cmd2.trim()), cmd2);

  console.log('\n── سرورِ پنل‌دار ──');
  await page.getByRole('button', { name: 'گزینهٔ دیگر' }).click();
  await page.locator('[data-choice="panel"]').click();
  const pnl = page.locator('[data-testid="wizard-panel"]');
  await pnl.waitFor();
  const ptext = await pnl.innerText();
  check('نشانیِ مرکز + کد با دکمهٔ کپی؛ «سرورهای من ⇐ وصل به مرکز»', ptext.includes(API_URL) && /[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/.test(ptext) && ptext.includes('وصل به مرکز')
    && (await pnl.getByRole('button', { name: 'کپی' }).count()) >= 2, ptext);

  console.log('\n── هاستِ اشتراکی ──');
  await page.getByRole('button', { name: 'گزینهٔ دیگر' }).click();
  await page.locator('[data-choice="host"]').click();
  const host = page.locator('[data-testid="wizard-host"]');
  await host.waitFor();
  const htext = await host.innerText();
  check('گام‌های cPanel (File Manager · Setup Node.js App · startup file · متغیر) و محدودیت‌ها', htext.includes('File Manager') && htext.includes('Setup Node.js App')
    && htext.includes('vill3n-agent/start.cjs') && htext.includes('VILL3N_JOIN_CODE') && htext.includes('فقط سرورِ حساب') && htext.includes('هیچ درِ ورودی ندارد'), htext);
  await shot(page, 'wizard-host', page.locator('main .card', { has: host }));
  const tickets = [];
  page.on('request', (r) => { if (r.url().includes('/api/fleet/host-bundle')) tickets.push(r.url()); });
  const responses = [];
  page.on('response', (r) => { if (r.url().includes('/api/fleet/host-bundle') || r.url().includes('/api/auth/ticket')) responses.push(`${r.status()} ${r.url().replace(/ticket=[^&]+/, 'ticket=…')}`); });
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }).catch(async (e) => { throw new Error(`${e.message} | ${responses.join(' ; ')} | ${page.url()} | ${(await page.content()).slice(0, 300)}`); }),
    page.locator('[data-testid="wizard-bundle"]').click(),
  ]);
  const zipPath = path.join(tmp, 'vill3n-host.zip');
  await dl.saveAs(zipPath);
  check('⛔ دانلودِ vill3n-host.zip با بلیتِ یک‌بارمصرف (بی توکن در نشانی)', dl.suggestedFilename() === 'vill3n-host.zip' && fs.statSync(zipPath).size > 500
    && tickets.length >= 1 && tickets.every((u) => /[?&]ticket=/.test(u) && !/token=/.test(u)), tickets.join(' '));
  const hostCode = (await host.locator('code', { hasText: /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/ }).first().innerText()).trim();
  const { extractZip } = await import('../src/control/zip.js');
  await extractZip(zipPath, path.join(tmp, 'bundle'));
  const ROOT = path.join(tmp, 'bundle', 'vill3n-host');
  const appPort = await freePort();
  //  همان کدی که پنجره نشان می‌دهد؛ مرکز از همین کامپیوتر (نشانیِ اینترنتیِ آزمون ساختگی است)
  agent = spawn(process.execPath, [path.join(ROOT, 'vill3n-agent', 'start.cjs')], {
    cwd: ROOT, env: { ...process.env, PORT: String(appPort), VILL3N_JOIN_CODE: hostCode, VILL3N_JOIN_CENTER: BASE, VILL3N_AGENT_DIR: path.join(tmp, 'agent'), VILL3N_AGENT_NAME: 'هاستِ cPanel' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  agent.stdout.on('data', (d) => (agentOut += d));
  agent.stderr.on('data', (d) => (agentOut += d));
  const live = page.locator('[data-testid="wizard-live"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="wizard-live"]')?.textContent?.includes('وصل شد ✓'), null, { timeout: 20000 }).catch(() => {});
  const ltext = await live.innerText();
  check('⛔ نمایندهٔ واقعی با همان کد ⇒ پنجره خودش «وصل شد ✓» با نامِ هاست', ltext.includes('وصل شد ✓') && ltext.includes('هاستِ cPanel'), `${ltext} | ${agentOut.slice(-300)}`);
  await shot(page, 'wizard-connected', page.locator('main .card', { has: host }));
  await page.getByRole('button', { name: 'بستن' }).first().click();
  await page.waitForTimeout(800);
  check('فهرستِ «سرورهای من»: همان هاست با گونهٔ «هاستِ اشتراکی (فقط سرورِ حساب)»', (await page.locator('main').innerText()).includes('هاستِ اشتراکی (فقط سرورِ حساب)'));
  check('هیچ خطای جاوااسکریپت', jsErrors.length === 0, jsErrors.join(' | '));
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
  console.log(out.slice(-1500));
} finally {
  await browser?.close().catch(() => {});
  agent?.kill('SIGTERM');
  server.kill('SIGTERM');
  await wait(400);
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
