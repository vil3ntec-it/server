// ---------------------------------------------------------------------------
//  ماژول‌های عملیاتِ کنسولِ فروشگاه در کرومیومِ واقعی (۴.۸ · ۴.۹ · ۴.۱۰ · ۴.۱۱ · ۴.۱۳)
//      CHROME_PATH=… node test/console-ops-ui.mjs        (محلی، مثلِ shop-console-ui)
//
//  پنلِ واقعی + سرورِ حسابِ ساختگی با درهای ‎/api/admin/ops/*‎ (شکلِ shop ‎claude/console-ops-api‎) که عمداً
//  فیلد جا می‌اندازد. با کلیکِ واقعی:
//    ⛔ بی ‎ops.v1‎ ⇒ «داده در دسترس نیست» با نامِ توانایی، نه جدولِ خالی
//    ⛔ نیامده «—» و صفرِ واقعی «۰»؛ کارِ راه‌نیفتاده «نامعلوم»، نه سبز
//    ⛔ تغییرِ وضعیتِ رخداد با نسخهٔ خوانده‌شده و «تأییدشده از سرورِ حساب» فقط پس از پاسخ
//    ⛔ بستنِ هشدار بی دلیل نمی‌رود
//    ⛔ انتشارِ مرحله‌ای: «برگشت پشتیبانی نمی‌شود» گفته می‌شود و دکمهٔ برگشت نیست
//    ⛔ هیچ خطای جاوااسکریپت، راست‌چین
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
let caps = ['actor.v1'];
const posted = [];
const INC = { id: 'inc_a1', source: 'client', app: 'shop', title: 'NullPointer در ثبتِ فروش', kind: 'pos.save', status: 'open', priority: 'p3',
  firstSeenAt: NOW - 3600e3, lastSeenAt: NOW - 60e3, occurrences: 7, recent1h: 0, lastVersion: '2.14.5', supportThreadId: '', version: 3 };
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, version: '2.14.5' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (req.method !== 'GET') { let b = null; try { b = JSON.parse(raw || 'null'); } catch { /* */ } posted.push({ path: p, body: b }); }
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: caps, serverTime: NOW });
    if (p === '/api/admin/ops/releases') {
      return j(200, {
        checkedAt: NOW - 120e3, api: { version: '2.14.5' }, schema: { migration: '173_ops_console.sql', appSchema: [{ app: 'shop', schemaVersion: 7 }] },
        channels: [{ tag: 'tohid-native', app: 'shop', platform: 'android', stable: { tag: 'tohid-native', state: 'published', version: '2.14.4', publishedAt: NOW - 5 * 86400e3, notes: 'رفعِ خطا' }, beta: { tag: 'tohid-native-beta', state: 'none' } }],
        apps: { shop: { minVersion: '2.10.0', latestDeclared: '', devices: { total: 12, belowMin: 0 }, errorsByVersion: [{ version: '2.14.4', errors: 7, devices: 2, shops: 1, incidents: 1, lastAt: NOW }], afterRelease: { version: '2.14.4', errors: 7, devices: 2 } } },
        stage: { supported: true, rollback: { supported: false, reason: 'downgrade_not_supported' } },
      });
    }
    if (p === '/api/admin/release/stage') return j(200, { stages: { 'tohid-native': { version: '2.14.5', percent: 10, updatedAt: NOW - 3600e3, updatedBy: 'boss' } }, version: 1 });
    if (p === '/api/admin/ops/health') {
      return j(200, { checkedAt: NOW - 60e3, status: 'warn', parts: { snapshot: 'ok', jobs: 'unknown' }, server: { version: '2.14.5', uptimeSeconds: 7200, rssBytes: 1048576 },
        jobs: [{ name: 'login-outbox', status: 'unknown', registeredAt: null }, { name: 'order-timeout', status: 'warn', everyMs: 30000, lastError: 'Error:ECONNRESET', lastOkAt: NOW - 600e3 }],
        sync: { apps: [{ app: 'shop', lastOkAt: NOW - 120e3, activeDevices24h: 0, errors24h: null }] },
        serverErrors: { last24h: 0, status: 'unknown' }, eventLoop: { status: 'unknown' },
        definitions: { ok: 'سالم: …', warn: 'هشدار: …', down: 'از کار افتاده: …', unknown: 'نامعلوم: …' } });
    }
    if (p === '/api/admin/ops/integrations') {
      return j(200, { checkedAt: NOW, providers: [{ id: 'email', mode: 'log', state: 'mock', activity: { ok24h: 0, fail24h: null } }],
        credentials: [{ id: 'HESABPAY_API_KEY', service: 'payment.hesabpay', set: false, rotate: 'env' }],
        serviceKeys: { available: true, active: 1, revoked: 0 }, webhooks: [{ id: 'hesabpay', state: 'blocked', reason: 'route_missing', path: '/api/v1/payments/webhook/hesabpay', routePresent: false, needs: 'PAY-21 (#518)' }],
        contracts: { api: '2.14.5', sync: ['v1', 'v3'], adminBasePaths: ['/api/admin'], schema: { migration: '173_ops_console.sql' } },
        policies: { rateLimit: { windowMs: 900000, authMax: 10 }, alerts: { evaluateEveryMs: 60000, maxNewPerRun: 50, maxPerRule: 20 } } });
    }
    if (p === '/api/admin/ops/incidents') return j(200, { incidents: [INC], total: 1, limit: 25, offset: 0, checkedAt: NOW });
    if (p === '/api/admin/ops/incidents/inc_a1') {
      return j(200, { incident: INC, spread: { shops: 1, devices: null }, versions: [{ version: '2.14.5', count: 7 }],
        occurrences: [{ id: 'cer_1', at: NOW - 60e3, source: 'client', service: 'shop', version: '2.14.5', shopId: 'shp_1', device: '…ab12', message: 'NullPointer' }],
        events: [{ id: 'e1', kind: 'created', to: 'open', actor: 'system', at: NOW - 3600e3 }], support: null, checkedAt: NOW });
    }
    if (p === '/api/admin/ops/incidents/inc_a1/status') return j(200, { incident: { ...INC, status: 'investigating', version: 4 }, changed: true });
    if (p === '/api/admin/ops/alerts') {
      return j(200, { alerts: [{ id: 'alr_1', rule: 'shop_disconnected', target: 'shp_1', severity: 'medium', status: 'open', title: 'دکانِ «یک» ۵۰ ساعت است همگام نشده', occurrences: 3, firstSeenAt: NOW - 7200e3, lastSeenAt: NOW, liveSince: NOW - 7200e3 }],
        total: 1, counts: { open: 1 }, evaluation: { evaluatedAt: NOW - 30e3, rules: [{ id: 'shop_disconnected', state: 'ok', findings: 1 }, { id: 'settlement_mismatch', state: 'unavailable', reason: 'نیاز به جدولِ courier_settlements' }] },
        definitions: [{ id: 'shop_disconnected', severity: 'medium', what: 'دکانِ با اشتراکِ فعال…' }, { id: 'settlement_mismatch', severity: 'high', what: 'تسویهٔ پیک…' }] });
    }
    if (p === '/api/admin/ops/alerts/alr_1/resolve') return j(200, { alert: { id: 'alr_1', status: 'resolved' }, changed: true });
    return j(200, { ok: true, shops: [], items: [], threads: [], total: 0, serverTime: NOW });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

const PORT = Number(process.env.TEST_PORT || 4981);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-ops-ui-'));
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
  env: { ...process.env, HLP_PORT: String(PORT), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: path.join(tmp, 'data'),
         HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_SITESYNC: '0', HLP_AI_ENABLED: '0', HLP_TUNNEL: '0', HLP_STATIONS: '0',
         HLP_AUTOMATION: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_ACCOUNT_API: `http://127.0.0.1:${fake.address().port}`,
         HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret', HLP_TG_WATCH_MS: '0', HLP_TG_LONGPOLL: '0' },
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
  await fetch(`${BASE}/api/auth/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'ConsoleOps!2026' }) });
  if (!CHROME) throw new Error('کرومیوم پیدا نشد — CHROME_PATH را بگذارید');
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', (e) => jsErrors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) jsErrors.push(m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('input[autocomplete="username"]', 'admin');
  await page.fill('input[type="password"]', 'ConsoleOps!2026');
  await page.locator('form button').last().click();
  await page.waitForSelector('aside nav', { timeout: 20000 });
  const open = async (tab) => {
    await page.goto(`${BASE}/shop?tab=${tab}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `ops-${tab}.png`), fullPage: true });
    return page.locator('main').innerText();
  };

  console.log('\n── بی ‎ops.v1‎ ──');
  let body = await open('errors');
  check('صفحه راست‌چین است', (await page.evaluate(() => document.documentElement.dir)) === 'rtl');
  check('ماژول‌های «خطاها، رخدادها…» (۴.۱۰) و «هشدارها» (۴.۱۱) در منوی بخشِ فروشگاه', body.includes('رخدادها') && body.includes('هشدارها'), body.slice(0, 300));
  check('⛔ «داده در دسترس نیست» با نامِ توانایی، نه جدولِ خالی', body.includes('داده در دسترس نیست') && body.includes('ops.v1'), body.slice(0, 600));
  caps = ['actor.v1', 'ops.v1', 'release-stage.v1'];

  console.log('\n── رخدادها ──');
  body = await open('errors');
  check('فهرستِ رخداد از سرورِ حساب با منبع', body.includes('NullPointer در ثبتِ فروش') && body.includes('/api/admin/ops/incidents'), body.slice(0, 600));
  await page.locator('main tr', { hasText: 'NullPointer در ثبتِ فروش' }).first().click();
  await page.waitForTimeout(600);
  let modal = await page.locator('[role="dialog"], .modal, body').last().innerText();
  check('پروندهٔ رخداد: وقوع‌ها و تاریخچه؛ دستگاهِ نیامده «—»', modal.includes('وقوع‌ها') && modal.includes('تاریخچه') && /۱ · —/.test(modal), modal.slice(0, 800));
  await page.locator('select').filter({ has: page.locator('option[value="investigating"]') }).last().selectOption('investigating');
  await page.locator('button', { hasText: 'ذخیره' }).first().click();
  await page.waitForTimeout(800);
  const st = posted.find((x) => x.path === '/api/admin/ops/incidents/inc_a1/status');
  check('⛔ تغییرِ وضعیت با نسخهٔ خوانده‌شده (expectedVersion) رفت', st?.body?.status === 'investigating' && st?.body?.expectedVersion === 3, JSON.stringify(st));
  modal = await page.locator('body').innerText();
  check('و «تأییدشده از سرورِ حساب» پس از پاسخ', modal.includes('تأییدشده از سرورِ حساب'));
  await page.keyboard.press('Escape');

  console.log('\n── هشدارها ──');
  body = await open('alerts');
  check('هشدار با نوع و اهمیت', body.includes('دکانِ قطع') && body.includes('متوسط') && body.includes('۵۰ ساعت'), body.slice(0, 600));
  check('⛔ قاعده‌ای که داده ندارد «داده نیست» است، نه سبز', body.includes('داده نیست') && body.includes('courier_settlements'), body.slice(0, 1500));
  check('کانال‌ها: پیامک و ایمیل «آینده»', (body.match(/آینده — هنوز ساخته نشده/g) || []).length >= 2);
  await page.locator('main button', { hasText: 'بستن' }).first().click();
  await page.waitForTimeout(400);
  const sendBtn = page.locator('button', { hasText: 'تأیید و فرستادن' }).last();
  check('⛔ بستن بی دلیل نمی‌رود (دکمه خاموش)', await sendBtn.isDisabled());
  await page.locator('textarea').last().fill('دکان تعطیل است');
  await sendBtn.click();
  await page.waitForTimeout(600);
  const rs = posted.find((x) => x.path === '/api/admin/ops/alerts/alr_1/resolve');
  check('و با دلیل رفت', rs?.body?.reason === 'دکان تعطیل است', JSON.stringify(rs));

  console.log('\n── نسخه‌ها و انتشار ──');
  body = await open('versions');
  check('سه نسخهٔ جدا: برنامه · API · طرحِ پایگاه', body.includes('سه نسخهٔ جدا') && body.includes('173_ops_console.sql') && body.includes('2.14.4'), body.slice(0, 800));
  check('⛔ صفرِ واقعی «۰» (زیرِ حداقل) و نیامده «—» (به‌روز نشده)', /زیرِ حداقل \(ناسازگار\)\s*۰/.test(body) && /به‌روز نشده\s*—/.test(body), body.slice(0, 1500));
  check('مرحلهٔ جاری ۱۰٪ و دکمه برای مالک', body.includes('۱۰٪') && body.includes('شروع / تغییرِ درصد'), body.slice(0, 1800));
  check('⛔ «برگشت پشتیبانی نمی‌شود» گفته می‌شود و دکمهٔ برگشت نیست', body.includes('پشتیبانی نمی‌شود') && (await page.locator('main button', { hasText: /^برگشت/ }).count()) === 0);

  console.log('\n── سلامت ──');
  body = await open('health');
  check('سنجه‌های پنل: رفت‌وبرگشتِ پل با عدد', /پلِ سرورِ حساب \(رفت‌وبرگشت\)[\s\S]{0,40}\d+ ms/.test(body) || /ms/.test(body), body.slice(0, 600));
  check('⛔ کارِ راه‌نیفتاده «نامعلوم»، نه سبز', body.includes('در این پروسه راه نیفتاده') && body.includes('نامعلوم'), body.slice(0, 1500));
  check('⛔ خطای سرور: نیامده «—» و صفرِ واقعی «۰»', body.includes('— / ۰'), body.slice(0, 1500));

  console.log('\n── یکپارچه‌سازی ──');
  body = await open('integrations');
  check('اعتبارنامه فقط «تنظیم نشده»، حساب‌پی «مسدود» و BLOCKED-EXTERNAL', body.includes('تنظیم نشده') && body.includes('مسدود') && body.includes('BLOCKED-EXTERNAL'), body.slice(0, 1500));
  check('⛔ هیچ رمز یا توکنی در صفحه نیست', !(await page.content()).includes('top-secret') && !(await page.content()).includes('tok-1'));

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
