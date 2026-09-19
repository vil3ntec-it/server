// ---------------------------------------------------------------------------
//  قراردادِ برنامهٔ «ویلن ادمین» با سرور
//
//      node test/admin-app-contract.mjs
//
//  ⚠️ این آزمون از یک کِرَشِ واقعی درآمد و کارش فقط یک چیز است: مطمئن شود
//  نامِ فیلدهایی که برنامهٔ اندروید می‌خواند، همان‌هایی‌اند که سرور
//  می‌فرستد.
//
//  ماجرا: سرور شناسهٔ گفت‌وگو را در `id` می‌فرستاد و برنامه دنبالِ
//  `threadId` می‌گشت. نتیجه‌اش «خالی» نبود — شناسهٔ همهٔ ردیف‌ها یکی
//  می‌شد و فهرستِ Compose با کلیدِ تکراری *کلِ برنامه* را می‌انداخت. یعنی
//  یک تغییرِ بی‌خطر در نامِ یک فیلد، برنامه را روی گوشی از کار انداخت و
//  هیچ آزمونی هم نگرفتش.
//
//  پس از این به بعد هر فیلدی که برنامه به آن تکیه دارد، این‌جا صریح
//  سنجیده می‌شود.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4795);
const BASE = `http://127.0.0.1:${PORT}`;

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-contract-'));
const sitesRoot = path.join(tmp, 'sites');
fs.mkdirSync(sitesRoot, { recursive: true });

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

/**
 * هر ردیفِ یک فهرست باید شناسه‌ای داشته باشد که هم پر باشد هم یکتا.
 *
 * ⚠️ دقیقاً همان چیزی که فهرستِ Compose لازم دارد و نبودنش برنامه را
 * می‌اندازد — نه اینکه فقط بد دیده شود.
 */
function keysAreSafe(rows, field) {
  const keys = rows.map((r) => r?.[field]);
  if (keys.some((k) => k === undefined || k === null || String(k).trim() === '')) {
    return { ok: false, why: `«${field}» در بعضی ردیف‌ها خالی است` };
  }
  const unique = new Set(keys.map(String));
  if (unique.size !== keys.length) {
    return { ok: false, why: `«${field}» تکراری است (${keys.length} ردیف، ${unique.size} کلید)` };
  }
  return { ok: true };
}

const child = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')],
  {
    env: {
      ...process.env,
      HLP_PORT: String(PORT),
      HLP_SITESYNC_PORT: String(PORT + 1),
      HLP_HOST: '127.0.0.1',
      HLP_DATA_DIR: path.join(tmp, 'data'),
      HLP_SITES_ROOT: sitesRoot,
      HLP_TUNNEL: '0',
      HLP_AI_ENABLED: '0',
      HLP_SITESYNC: '0',
      // بخشِ پمپ باید روشن باشد، وگرنه مسیرهایش اصلاً سوار نمی‌شوند
      HLP_STATIONS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));

let token = null;
const call = async (method, url, body, extra = {}) => {
  const headers = { 'Content-Type': 'application/json', ...extra };
  if (token && !extra.noAuth) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const started = Date.now();
  let up = false;
  while (Date.now() - started < 25_000) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) {
        up = true;
        break;
      }
    } catch { /* هنوز */ }
    await wait(200);
  }
  if (!up) throw new Error(`سرور بالا نیامد:\n${out}`);

  const setup = await call('POST', '/api/auth/setup', { username: 'admin', password: 'ControlCenter!2026' });
  token = setup.body?.token
    || (await call('POST', '/api/auth/login', { username: 'admin', password: 'ControlCenter!2026' })).body?.token;
  check('مدیر وارد شد', Boolean(token));

  /*
   *  پشتیبانی، حساب‌های دکان و نرخ‌ها از سرورِ حساب می‌آیند (پلِ
   *  ‎/api/account-admin‎) و قراردادشان با اپ در ‎test/account-admin.mjs‎
   *  با یک سرورِ حسابِ ساختگی سنجیده می‌شود. این‌جا فقط چیزهای خودِ پنل.
   */
  console.log('\n── فهرست‌هایی که برنامه از خودِ پنل می‌خواند ──');

  const codes = await call('GET', '/api/codes-admin/live');
  check('کدهای شش‌رقمی «id» دارند',
    (codes.body?.items || []).every((r) => r.id !== undefined), JSON.stringify(codes.body).slice(0, 160));

  const notices = await call('GET', '/api/announce-admin');
  check('اطلاعیه‌ها «id» دارند',
    (notices.body?.items || []).every((r) => r.id !== undefined));

  console.log('\n── بخشِ پمپ: هر پنج زیربخش باید مسیرش زنده باشد ──');
  /*
   *  ⚠️ این آزمون از یک گزارشِ واقعی درآمد: «چرا بخشِ پمپ بنزین هیچ چیزی
   *  توش اضافه نشده؟»
   *
   *  علتش این نبود که کد نوشته نشده — نوشته شده بود. علتش این بود که
   *  هر زیربخش به یک مسیرِ سرور تکیه دارد، و اگر یکی از آن‌ها ۴۰۴ بدهد
   *  یا خاموش باشد، همان زیربخش *خالی* دیده می‌شود، نه «خراب». پنج
   *  کارتِ خالی هم از دور یعنی «هیچی اضافه نشده».
   *
   *  پس این‌جا فقط یک چیز را می‌سنجیم و همان کافی است: هیچ‌کدام از این
   *  مسیرها «نیست» نباشند. ۴۰۹ (به ابر وصل نیستیم) پاسخِ درستی است؛
   *  ۴۰۴ و ۵۰۰ نه.
   */
  const pumpRoutes = [
    ['حساب‌ها و کاربرها', '/api/stations-admin/cloud/users?limit=5'],
    ['حساب‌ها و کاربرها — پمپ‌های ابر', '/api/stations-admin/cloud/stations?limit=5'],
    ['حساب‌ها و کاربرها — اشتراک‌ها', '/api/stations-admin/cloud/subscriptions?limit=5'],
    ['حساب‌ها و کاربرها — کدهای اشتراک', '/api/stations-admin/cloud/vipCodes?limit=5'],
    ['وصل بودن', '/api/stations-admin/'],
    ['نرخ‌ها', '/api/stations-admin/cloud/pumpPlans'],
    ['کد و ربات', '/api/codes-admin/live?app=pump-station'],
    ['تنظیمات — وضعیتِ ابر', '/api/stations-admin/cloud/status'],
    ['تنظیمات — آینه', '/api/stations-admin/cloud/mirror'],
    ['تنظیمات — بررسیِ سلامت', '/api/diagnostics'],
  ];
  for (const [label, url] of pumpRoutes) {
    const res = await call('GET', url);
    check(`${label} — مسیرش هست (${res.status})`, res.status !== 404 && res.status < 500,
      `${url} → ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
  }

  const diag = await call('GET', '/api/diagnostics');
  check('بررسیِ سلامت فهرستِ سنجه‌ها می‌دهد', Array.isArray(diag.body?.checks) && diag.body.checks.length > 0,
    JSON.stringify(diag.body).slice(0, 160));
  check('هر سنجه عنوان و وضعیت دارد',
    (diag.body?.checks || []).every((c) => c.title && ['good', 'warn', 'bad'].includes(c.state)),
    JSON.stringify(diag.body?.checks?.[0]));
  check('و صفِ کدها در آن هست',
    (diag.body?.checks || []).some((c) => c.key === 'codeQueue'));

  const pumpCodes = await call('GET', '/api/codes-admin/live?app=pump-station');
  check('کدهای پمپ فهرست و وضعیتِ صف می‌دهند',
    Array.isArray(pumpCodes.body?.items) && pumpCodes.body?.queue !== undefined,
    JSON.stringify(pumpCodes.body).slice(0, 160));

  const users = await call('GET', '/api/auth/users');
  const userRows = users.body?.users || [];
  check('کاربرانِ پنل «id» دارند', userRows.every((u) => u.id !== undefined),
    JSON.stringify(userRows.slice(0, 2)));
  if (userRows.length) {
    const safeUsers = keysAreSafe(userRows, 'id');
    check('شناسهٔ کاربران یکتاست', safeUsers.ok, safeUsers.why);
  }
} finally {
  child.kill('SIGTERM');
  await wait(400);
  await fsp.rm(tmp, { recursive: true, force: true });
}

console.log(`\n${failed ? '❌' : '✅'} ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed ? 1 : 0);
