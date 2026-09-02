// ---------------------------------------------------------------------------
//  آزمونِ کارهای زمان‌بندی‌شده
//      node test/cron.mjs
//
//  تجزیه‌کنندهٔ cron را خودمان نوشته‌ایم، پس باید خودمان هم ثابت کنیم درست
//  است — به‌ویژه قاعدهٔ عجیبی که همه از قلم می‌اندازند: وقتی هم روزِ‌ماه و هم
//  روزِ‌هفته مشخص باشند، «یا» است نه «و».
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4795);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cron-test-'));
const dataDir = path.join(tmp, 'data');
const sitesRoot = path.join(tmp, 'sites');
fs.mkdirSync(sitesRoot, { recursive: true });

// دیتابیس باید پیش از importِ ماژولِ cron ساخته شود
process.env.HLP_DATA_DIR = dataDir;
process.env.HLP_SITES_ROOT = sitesRoot;

const { parseSchedule, nextRunAt, isValidSchedule } = await import('../src/system/cron.js');

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`);
  }
};

/* ───────────────────────── تجزیهٔ الگو ──────────────────────────────── */

console.log('\n── الگوهای درست ──');
for (const expr of [
  '* * * * *', '0 3 * * *', '*/15 * * * *', '0 0 1 * *',
  '30 2 * * 1-5', '0 */4 * * *', '0 0 1,15 * *', '0 9 * jan mon',
  '@daily', '@hourly', '@weekly',
]) {
  check(`«${expr}» پذیرفته می‌شود`, isValidSchedule(expr), JSON.stringify(parseSchedule(expr)));
}

console.log('\n── الگوهای غلط ──');
for (const [expr, why] of [
  ['', 'خالی'],
  ['* * * *', 'چهار فیلد'],
  ['* * * * * *', 'شش فیلد'],
  ['60 * * * *', 'دقیقهٔ ۶۰'],
  ['* 24 * * *', 'ساعتِ ۲۴'],
  ['* * 32 * *', 'روزِ ۳۲'],
  ['* * * 13 *', 'ماهِ ۱۳'],
  ['abc * * * *', 'حرفِ بی‌معنی'],
  ['5-1 * * * *', 'بازهٔ برعکس'],
  ['*/0 * * * *', 'گامِ صفر'],
]) {
  check(`«${expr}» رد می‌شود (${why})`, !isValidSchedule(expr));
}

console.log('\n── محاسبهٔ اجرای بعدی ──');
// ۱۵ ژانویهٔ ۲۰۲۵، ساعت ۱۰:۳۰ — یک چهارشنبه
const base = new Date(2025, 0, 15, 10, 30, 0, 0);

let at = new Date(nextRunAt('0 3 * * *', base));
check('«هر شب ۳» فردا ۳ بامداد است', at.getHours() === 3 && at.getMinutes() === 0 && at.getDate() === 16, at.toString());

at = new Date(nextRunAt('*/15 * * * *', base));
check('«هر ۱۵ دقیقه» می‌شود ۱۰:۴۵', at.getHours() === 10 && at.getMinutes() === 45, at.toString());

at = new Date(nextRunAt('0 0 1 * *', base));
check('«اولِ هر ماه» می‌شود ۱ فوریه', at.getDate() === 1 && at.getMonth() === 1, at.toString());

at = new Date(nextRunAt('0 12 * * 0', base));
check('«یکشنبه ظهر» می‌شود ۱۹ ژانویه', at.getDate() === 19 && at.getHours() === 12, at.toString());

at = new Date(nextRunAt('0 12 * * 7', base));
check('یکشنبه با ۷ هم همان جواب را می‌دهد', at.getDate() === 19 && at.getHours() === 12, at.toString());

// قاعدهٔ «یا» — «0 0 1 * mon» یعنی اولِ ماه، و هر دوشنبه
at = new Date(nextRunAt('0 0 1 * mon', base));
check(
  'روزِ‌ماه و روزِ‌هفته با هم «یا» می‌شوند (دوشنبهٔ ۲۰ ژانویه)',
  at.getDate() === 20 && at.getDay() === 1,
  at.toString()
);

check('الگوی غلط اجرای بعدی ندارد', nextRunAt('nope') === null);

/* ──────────────────────────── سرور ───────────────────────────────────── */

const serverPath = path.join(import.meta.dirname, '..', 'src', 'index.js');
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', serverPath], {
  env: {
    ...process.env,
    HLP_PORT: String(PORT),
    HLP_HOST: '127.0.0.1',
    HLP_DATA_DIR: dataDir,
    HLP_SITES_ROOT: sitesRoot,
    HLP_SITESYNC: '0',
    HLP_AI_ENABLED: '0',
    HLP_TUNNEL: '0',
    HLP_METRICS_INTERVAL: '5000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOut = '';
child.stdout.on('data', (d) => (serverOut += d));
child.stderr.on('data', (d) => (serverOut += d));

async function waitForServer(timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

let token = null;
async function api(method, url, body, opts = {}) {
  const headers = {};
  if (opts.token !== undefined) {
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  } else if (token && !opts.noAuth) {
    headers.Authorization = `Bearer ${token}`;
  }
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* JSON نبود */ }
  return { status: res.status, json, text };
}

async function main() {
  console.log('\n▶ راه‌اندازی سرورِ آزمایشی...');
  if (!(await waitForServer())) {
    console.log(serverOut.slice(-4000));
    throw new Error('سرور بالا نیامد');
  }

  let r = await api('GET', '/api/cron', undefined, { noAuth: true });
  check('بدونِ توکن ۴۰۱ می‌دهد', r.status === 401, r.text);

  r = await api('POST', '/api/auth/setup', { username: 'admin', password: 'CronPanel!2026' });
  check('ساختِ حسابِ مدیر', r.status === 200 && Boolean(r.json?.token), r.text);
  token = r.json?.token;

  console.log('\n── پیش‌نمایشِ الگو ──');
  r = await api('POST', '/api/cron/preview', { schedule: '@daily' });
  check('میان‌بر نرمال می‌شود', r.status === 200 && r.json?.normalized === '0 0 * * *', r.text);
  check('پنج اجرای بعدی برمی‌گردد', (r.json?.next || []).length === 5, r.text);

  r = await api('POST', '/api/cron/preview', { schedule: '99 * * * *' });
  check('الگوی غلط ۴۰۰ می‌گیرد', r.status === 400, `${r.status} ${r.text}`);

  console.log('\n── ساخت و اجرا ──');
  r = await api('POST', '/api/cron', { name: 'آزمایشی', schedule: '0 3 * * *', command: 'echo cron-ok' });
  check('کار ساخته می‌شود', r.status === 200 && Boolean(r.json?.job?.id), r.text);
  const jobId = r.json?.job?.id;
  check('اجرای بعدی حساب شده', Boolean(r.json?.job?.next_run_at), r.text);

  r = await api('POST', '/api/cron', { name: 'بد', schedule: 'خراب', command: 'echo x' });
  check('الگوی غلط برای ساخت ۴۰۰ می‌گیرد', r.status === 400, `${r.status} ${r.text}`);

  r = await api('POST', '/api/cron', { name: 'بی‌فرمان', schedule: '@daily', command: '  ' });
  check('فرمانِ خالی رد می‌شود', r.status === 400 && r.json?.error === 'command_required', r.text);

  if (jobId) {
    r = await api('POST', `/api/cron/${jobId}/run`);
    check('اجرای دستی کار می‌کند', r.status === 200 && r.json?.exitCode === 0, r.text);
    check('خروجیِ فرمان ثبت شد', String(r.json?.output || '').includes('cron-ok'), r.text);

    r = await api('GET', `/api/cron/${jobId}/runs`);
    check('تاریخچهٔ اجرا ثبت شد', r.status === 200 && (r.json?.items || []).length === 1, r.text);

    r = await api('PATCH', `/api/cron/${jobId}`, { enabled: false });
    check('غیرفعال کردن کار می‌کند', r.status === 200 && r.json?.job?.enabled === false, r.text);
    check('کارِ غیرفعال اجرای بعدی ندارد', r.json?.job?.next_run_at === null, r.text);

    // کدِ خروجِ ناموفق باید ثبت شود، نه اینکه خطا حساب شود
    r = await api('POST', '/api/cron', { name: 'شکست', schedule: '@daily', command: 'exit 7' });
    const failId = r.json?.job?.id;
    r = await api('POST', `/api/cron/${failId}/run`);
    check('کدِ خروجِ ناموفق ثبت می‌شود', r.status === 200 && r.json?.exitCode === 7, r.text);

    r = await api('DELETE', `/api/cron/${jobId}`);
    check('حذف کار می‌کند', r.status === 200, r.text);
    r = await api('GET', `/api/cron/${jobId}/runs`);
    check('تاریخچهٔ کارِ حذف‌شده هم رفت', r.status === 404, `${r.status}`);
  }

  console.log('\n── مرزِ نقش‌ها ──');
  r = await api('POST', '/api/auth/users', { username: 'oper', password: 'NoCron!2026', role: 'operator' });
  const made = r.status === 200 || r.status === 201;
  check('ساختِ کاربرِ operator', made, r.text);

  if (made) {
    r = await api('POST', '/api/auth/login', { username: 'oper', password: 'NoCron!2026' }, { noAuth: true });
    const opToken = r.json?.token;

    r = await api('GET', '/api/cron', undefined, { token: opToken });
    check('operator فهرست را می‌بیند', r.status === 200, r.text);

    r = await api('POST', '/api/cron', { name: 'x', schedule: '@daily', command: 'echo x' }, { token: opToken });
    check('operator کار نمی‌سازد (۴۰۳)', r.status === 403, `${r.status} ${r.text}`);
  }

  console.log('\n── دفترِ کارها ──');
  r = await api('GET', '/api/app-admin/audit?limit=50');
  check(
    'ساختِ کار در دفتر ثبت شد',
    r.status !== 200 || r.text.includes('cron.create'),
    r.status === 200 ? 'پیدا نشد' : `دفتر در دسترس نبود (${r.status})`
  );
}

let error = null;
try {
  await main();
} catch (e) {
  error = e;
  console.log(`\n💥 ${e.message}`);
}

child.kill();
await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});

console.log(`\n${failed === 0 && !error ? '✅' : '❌'} ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed === 0 && !error ? 0 : 1);
