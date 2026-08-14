// ---------------------------------------------------------------------------
//  آزمونِ مرورگری: آیا خبرِ فرستاده‌شده واقعاً در «تانک تیل یعقوبی» می‌نشیند؟
//
//  سرورِ پنل بالا می‌آید، خودِ index.html در مرورگرِ واقعی باز می‌شود، و بعد با
//  همان دستورِ سادهٔ curl یک خبر فرستاده می‌شود. اگر زنگ قرمز شد و خبر در فهرست
//  آمد، یعنی زنجیره از سر تا ته کار می‌کند.
//
//      node test/pump-notify.mjs
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.TEST_PORT || 4880);
const SITE_PORT = PORT + 2;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(import.meta.dirname, '..', '..', '..'); // ریشهٔ ریپو — همان‌جا که index.html است
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-pumpntf-'));

const CHROME =
  process.env.CHROME_PATH ||
  ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(
    (p) => fs.existsSync(p)
  );

let passed = 0;
let failed = 0;
const check = (n, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${n}`); }
  else { failed++; console.log(`  ❌ ${n}${extra ? ' — ' + extra : ''}`); }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- سرورِ کوچکِ ایستا که خودِ سایت پمپ را سرو می‌کند (مثل GitHub Pages) ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const siteServer = http.createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel.replace(/^\/+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await fsp.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('نیست');
  }
});
await new Promise((r) => siteServer.listen(SITE_PORT, '127.0.0.1', r));

const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
  env: {
    ...process.env,
    HLP_PORT: String(PORT), HLP_SITESYNC_PORT: String(PORT + 1), HLP_HOST: '127.0.0.1',
    HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
    HLP_METRICS_INTERVAL: '5000', HLP_TUNNEL: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));

async function waitUp() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) return; } catch { /* هنوز */ }
    await sleep(250);
  }
  throw new Error('سرور بالا نیامد');
}

/** فرستادنِ خبر، دقیقاً همان‌طور که یک برنامهٔ بیرونی می‌فرستد */
const publish = (topic, body, headers = {}) =>
  fetch(`${BASE}/api/notify/${topic}`, { method: 'POST', headers: { 'Content-Type': 'text/plain', ...headers }, body })
    .then((r) => r.json());

let browser;
try {
  if (!CHROME) throw new Error('کرومیوم پیدا نشد (CHROME_PATH را تنظیم کنید)');
  await waitUp();
  const admin = await fetch(`${BASE}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'HomeServer!2026' }),
  }).then((r) => r.json()).then((j) => j.token);

  browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // هر درخواستی که از خانه بیرون می‌رود ثبت می‌شود — نباید چیزی به ntfy.sh برود
  const outbound = [];
  page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1:')) outbound.push(r.url()); });
  // «Failed to load resource» متنِ کلی است و آدرس ندارد؛ پس خودِ پاسخ‌های خراب را
  // جدا نگه می‌داریم تا بشود گفت کدامش واقعاً مشکلِ برنامه است
  const badUrls = [];
  page.on('response', (r) => { if (r.status() >= 400) badUrls.push(r.url()); });
  page.on('requestfailed', (r) => badUrls.push(r.url()));

  // سایت را به سرورِ آزمایشی وصل کن و قفل را رد کن (همان روشِ آزمون‌های دستی)
  await page.addInitScript((wsUrl) => {
    window.SELF_HOST_URL = wsUrl;
    window.SELF_HOST_TOKEN = '';
  }, `ws://127.0.0.1:${PORT}`);

  console.log('\n── باز شدنِ برنامهٔ پمپ ──');
  await page.goto(`http://127.0.0.1:${SITE_PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.ntfOpen === 'function', { timeout: 20000 });
  await page.evaluate(() => {
    document.getElementById('lockScreen').style.display = 'none';
    document.getElementById('app').style.display = '';
  });
  check('برنامه باز شد و زنگ اعلان در سربرگ هست', await page.locator('#ntfBellBtn').isVisible());

  console.log('\n── هر نقش، موضوعِ خودش ──');
  // برنامه ۱٫۵ ثانیه بعدِ بالا آمدن وصل می‌شود؛ به‌جای حدس زدنِ زمان، از خودِ
  // سرور می‌پرسیم تا بگوید شنونده روی کدام موضوع نشسته است
  const listeners = () =>
    fetch(`${BASE}/api/notify-admin`, { headers: { Authorization: `Bearer ${admin}` } })
      .then((r) => r.json())
      .then((j) => j.stats?.listeners || 0);
  for (let i = 0; i < 80 && !(await listeners()); i++) await sleep(250);
  check('برنامه خودش وصل شد', (await listeners()) >= 1);
  check(
    'نقشِ پیش‌فرض (کارمند) روی موضوع staff می‌نشیند',
    (await page.evaluate(() => window.__pumpNtf__.topic())) === 'staff',
    await page.evaluate(() => window.__pumpNtf__.topic())
  );

  // میرزا (مدیر) → موضوع mirza
  await page.evaluate(() => _rbSetMode('admin'));
  await page.waitForFunction(() => window.__pumpNtf__.topic() === 'mirza', { timeout: 8000 });
  check('میرزا روی موضوع mirza می‌نشیند', true);

  console.log('\n── خبری که از بیرون می‌آید ──');
  const sent = await publish('mirza', 'تیل مخزن ۲ کم شد');
  check('سرور خبر را پذیرفت', sent.ok === true, JSON.stringify(sent).slice(0, 120));
  check('و برنامهٔ باز، همان لحظه گرفتش', sent.live >= 1, `live=${sent.live}`);

  await page.waitForFunction(() => document.getElementById('ntfDot')?.style.display === 'flex', { timeout: 8000 });
  check('زنگ نشانهٔ نخوانده گرفت', (await page.locator('#ntfDot').innerText()).trim() === '1');

  console.log('\n── فهرستِ خبرها ──');
  await page.click('#ntfBellBtn');
  await sleep(500);
  check('پنجرهٔ اعلان‌ها باز شد', await page.locator('#ntfModal.open').isVisible());
  check('متنِ خبر در فهرست هست', (await page.locator('#ntfList').innerText()).includes('تیل مخزن ۲ کم شد'));
  check('و بعد از باز کردن، نشانهٔ نخوانده پاک شد', (await page.locator('#ntfDot').getAttribute('style'))?.includes('none'));

  console.log('\n── عنوان و اولویت ──');
  await publish('mirza', 'مخزن خالی شد', { 'X-Title': encodeURIComponent('هشدار'), 'X-Priority': '5' });
  await sleep(900);
  const listText = await page.locator('#ntfList').innerText();
  check('عنوانِ فارسی درست نشست', listText.includes('هشدار'), listText.slice(0, 80));
  check('خبرِ فوری کادرِ قرمز گرفت', (await page.locator('#ntfList .ntf-p5').count()) > 0);
  check('تازه‌ترین خبر بالای فهرست است', (await page.locator('#ntfList .ntf-item').first().innerText()).includes('مخزن خالی شد'));
  await page.click('#ntfModal .modal-close');

  console.log('\n── هشدارِ خودِ برنامه (تیل کم، حساب تازه) ──');
  // همان چیزی که ربات موقع کم شدنِ تیل یا ساخته شدنِ حساب صدا می‌زند
  await page.evaluate(() => _botAnnounce('مخزن دیزل تمام شده است.', true));
  const alertOn = async (topic) =>
    (await fetch(`${BASE}/api/notify/${topic}/json`).then((r) => r.json())).messages || [];
  await sleep(1200);
  const mirzaMsgs = await alertOn('mirza');
  const staffMsgs = await alertOn('staff');
  check('هشدار به میرزا رسید', mirzaMsgs.some((m) => m.body.includes('مخزن دیزل تمام شده')), '');
  check('همان هشدار به کارمندان هم رسید', staffMsgs.some((m) => m.body.includes('مخزن دیزل تمام شده')), '');
  check(
    'هشدارِ «تمام شده» اولویتِ فوری گرفت',
    mirzaMsgs.find((m) => m.body.includes('مخزن دیزل تمام شده'))?.priority === 5
  );

  await page.evaluate(() => _botAnnounce('حساب جدید «شرکت نور» ساخته شد.'));
  await sleep(1200);
  check(
    'خبرِ حسابِ تازه هم می‌رسد',
    (await alertOn('mirza')).some((m) => m.body.includes('شرکت نور'))
  );

  console.log('\n── میرزا حسابِ طرف را می‌نویسد ──');
  const wrote = await page.evaluate(() => {
    // میرزا = مدیر. بدون این، نگهبانِ «نظاره‌گر» جلوی نوشتن را می‌گیرد و
    // اصلاً چیزی در حساب عوض نمی‌شود (همان‌طور که باید)
    currentRole = 'admin';
    try { applyRole(); } catch (e) { /* مهم نیست */ }
    DB.debtPersons = DB.debtPersons || [];
    DB.debtPersons.push({
      id: 777, name: 'حاجی نظر', mode: 'fuel', subs: [],
      rows: [{ date: '', name: '', hawala: '', ftype: 'petrol', fuel: 0, priceper: 0, bardagi: 0, rasid: 0, rasidFuel: 0, albaqi: 0 }],
      moneyRows: [],
    });
    currentPersonType = 'debt';
    currentPersonId = 777;
    try { updatePersonRow(777, 0, 'fuel', 120); return 'ok'; }
    catch (e) { return 'خطا: ' + e.message; }
  });
  check('نوشتنِ ردیفِ حساب بدون خطا انجام شد', wrote === 'ok', String(wrote));

  // اعلان عمداً چند ثانیه جمع می‌شود تا با هر خانه که پر می‌شود یک اعلان نرود
  const personTopic = 'p-debt-777';
  let personMsgs = [];
  for (let i = 0; i < 60 && !personMsgs.length; i++) {
    personMsgs = await alertOn(personTopic);
    if (!personMsgs.length) await sleep(500);
  }
  check('صاحبِ حساب خبردار شد', personMsgs.some((m) => m.body.includes('حاجی نظر')), JSON.stringify(personMsgs).slice(0, 140));
  check('و فقط یک اعلان رفت، نه ده تا', personMsgs.length === 1, `تعداد=${personMsgs.length}`);

  console.log('\n── مشتریِ کیو‌آر فقط خبرِ خودش را می‌گیرد ──');
  const qr = await browser.newPage({ viewport: { width: 420, height: 860 } });
  qr.on('pageerror', (e) => errors.push(e.message));
  qr.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await qr.addInitScript((wsUrl) => { window.SELF_HOST_URL = wsUrl; window.SELF_HOST_TOKEN = ''; }, `ws://127.0.0.1:${PORT}`);
  await qr.goto(`http://127.0.0.1:${SITE_PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await qr.waitForFunction(() => typeof window.ntfOpen === 'function', { timeout: 20000 });
  await qr.evaluate(() => {
    document.getElementById('lockScreen').style.display = 'none';
    document.getElementById('app').style.display = '';
    _rbSetMode('person', { peer: 'debt-777', type: 'debt', id: 777, name: 'حاجی نظر' });
  });
  await qr.waitForFunction(() => window.__pumpNtf__.topic() === 'p-debt-777', { timeout: 10000 });
  check('مشتریِ کیو‌آر روی موضوعِ خودش می‌نشیند', true);

  await qr.evaluate(() => window.ntfOpen());
  await qr.waitForFunction(
    () => (document.getElementById('ntfList')?.innerText || '').includes('حاجی نظر'),
    { timeout: 10000 }
  );
  check('و خبرِ حسابِ خودش را می‌بیند', true);

  // حالا یک خبرِ داخلی روی موضوعِ میرزا بگذار — نباید به مشتری برسد
  await publish('mirza', 'راز داخلی: حساب شرکت الف بسته شد');
  await publish('staff', 'چت گروهی کارمندان');
  await sleep(1500);
  const qrText = await qr.locator('#ntfList').innerText();
  check('خبرِ داخلیِ میرزا به مشتری نمی‌رسد', !qrText.includes('راز داخلی'), qrText.slice(0, 100));
  check('چت کارمندان هم به مشتری نمی‌رسد', !qrText.includes('چت گروهی کارمندان'));

  console.log('\n── تاریخچه بعد از باز شدنِ دوبارهٔ برنامه ──');
  const page2 = await browser.newPage({ viewport: { width: 420, height: 860 } });
  await page2.addInitScript((wsUrl) => { window.SELF_HOST_URL = wsUrl; window.SELF_HOST_TOKEN = ''; }, `ws://127.0.0.1:${PORT}`);
  await page2.goto(`http://127.0.0.1:${SITE_PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await page2.waitForFunction(() => typeof window.ntfOpen === 'function', { timeout: 20000 });
  await page2.evaluate(() => {
    document.getElementById('lockScreen').style.display = 'none';
    document.getElementById('app').style.display = '';
    _rbSetMode('admin');
    window.ntfOpen();
  });
  await page2.waitForFunction(
    () => (document.getElementById('ntfList')?.innerText || '').includes('تیل مخزن ۲ کم شد'),
    { timeout: 12000 }
  );
  check('برنامه‌ای که تازه باز شده، خبرهای قبلی را هم می‌گیرد', true);

  console.log('\n── هیچ چیزی به سرورِ بیرونی نمی‌رود ──');
  const toNtfy = outbound.filter((u) => /ntfy\.sh/i.test(u));
  check('تا وقتی سرور خانگی کار می‌کند، هیچ پیامی به ntfy.sh نمی‌رود', toNtfy.length === 0, toNtfy.slice(0, 2).join(' | '));

  console.log('\n── خطاهای کنسول ──');
  // ۴۰۴ فایلِ version.json و آدرس‌های اینترنتی، از سرورِ ایستای همین آزمون است
  // (فایلِ نسخه را ورک‌فلوی دیپلوی می‌سازد) — خطای خودِ برنامه نیست
  // version.json را ورک‌فلوی دیپلوی می‌سازد و آدرس‌های اینترنتی از این جعبه در
  // دسترس نیستند — هیچ‌کدام ایرادِ خودِ برنامه نیست
  const benign = /favicon|manifest|icon-|version\.json|ntfy\.sh|yaqobipump\.top|github\.io/i;
  const realBad = badUrls.filter((u) => !benign.test(u));
  check('هیچ فایلی از خودِ برنامه گم نیست', realBad.length === 0, realBad.slice(0, 3).join(' | '));
  const real = errors.filter(
    (e) => !/favicon|ResizeObserver|firebase|manifest|icon-|Failed to load resource/i.test(e)
  );
  check('کنسولِ برنامه خطای واقعی ندارد', real.length === 0, real.slice(0, 2).join(' | '));

  console.log('\n════════════════════════════════════');
  console.log(`  موفق: ${passed}    ناموفق: ${failed}`);
  console.log('════════════════════════════════════\n');
} catch (e) {
  failed++;
  console.error('\n❌ آزمون شکست:', e.stack);
  console.error(out.slice(-1200));
} finally {
  await browser?.close();
  child.kill('SIGTERM');
  siteServer.close();
  await sleep(400);
  await fsp.rm(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
