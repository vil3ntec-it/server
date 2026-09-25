// ---------------------------------------------------------------------------
//  عکسِ چشمی از سه صفحهٔ تازهٔ ۱.۵۰.۱۶ — داشبورد، اشتراک‌ها، کدها
//
//      CC_SHOTS=/tmp/x node test/shots-new-pages.mjs
//
//  سنجه نیست؛ فقط برای دیدن. همان راهِ بالا آمدنِ control-ui.mjs (پنلِ واقعی،
//  کرومیومِ واقعی، بی سرورِ حساب — پس کارت‌ها «نرسیدیم» می‌گویند و همین
//  باید سالم و خوانا باشد).
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { chromium } = await import('playwright-core');
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome'].find((p) => fs.existsSync(p));
const PORT = Number(process.env.TEST_PORT || 4797);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-shots-'));
const shots = process.env.CC_SHOTS || path.join(tmp, 'shots');
fs.mkdirSync(shots, { recursive: true });

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
  env: { ...process.env, HLP_PORT: String(PORT), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_SITESYNC: '0', HLP_AI_ENABLED: '0', HLP_TUNNEL: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const t0 = Date.now();
while (Date.now() - t0 < 25000) {
  try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
  await new Promise((r) => setTimeout(r, 250));
}
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.fill('input[autocomplete="username"]', 'admin');
  await page.fill('input[type="password"]', 'ShotsPanel!2026');
  await page.locator('form button').last().click();
  await page.waitForSelector('aside nav', { timeout: 20000 });
  for (const [route, name] of [['/', 'dashboard'], ['/subscriptions', 'subscriptions'], ['/subscriptions?tab=plans&app=pump', 'subscriptions-plans'], ['/codes?app=pump', 'codes-pump'], ['/stations#subs', 'stations-subs']]) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
    console.log(`📸 ${name} ← ${route}`);
  }
  console.log(`\n📁 ${shots}`);
} finally {
  await browser.close();
  server.kill();
}
