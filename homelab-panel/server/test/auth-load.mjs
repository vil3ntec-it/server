// ---------------------------------------------------------------------------
//  آزمونِ فشار — عدد، نه ادعا
//      node test/auth-load.mjs
//
//  ⚠️ چرا این فایل هست: «سرور برای هزار کاربر آماده است» بدونِ اندازه‌گیری
//  یک حرف است. این‌جا درخواستِ واقعیِ هم‌زمان زده می‌شود و عددِ واقعی چاپ.
//
//  ⚠️ و چه چیزی را نمی‌سنجد، که مهم‌تر است: این آزمون روی همین کامپیوتر و
//  روی loopback اجرا می‌شود. یعنی شبکه، کلودفلر، تونل و سرورِ ایمیلِ واقعی
//  در آن نیستند. پس عددش سقفِ *خودِ سرور* است، نه سقفِ سامانه در دنیای
//  واقعی. هر ادعایی فراتر از این، حدس است.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4801);
const BASE = `http://127.0.0.1:${PORT}`;

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-load-'));
fs.mkdirSync(path.join(tmp, 'sites'), { recursive: true });

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`); }
};

const child = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')],
  {
    env: {
      ...process.env,
      HLP_PORT: String(PORT), HLP_SITESYNC_PORT: String(PORT + 1), HLP_HOST: '127.0.0.1',
      HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
      HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_SITESYNC: '0',
      /*
       *  ⚠️ سقف‌ها برداشته می‌شوند، عمداً. این‌جا *ظرفیتِ سرور* سنجیده
       *  می‌شود نه محدودیت‌ها. اولین اجرا با سقف‌های روشن، ۴۰۰ تا از
       *  ۱۰۰۰ درخواست ۴۲۹ گرفت و عددِ به‌دست‌آمده سقفِ نرخ بود نه سقفِ
       *  سرور.
       *
       *  خودِ کار کردنِ سقف‌ها در test/auth-abuse.mjs سنجیده می‌شود.
       */
      CODES_RESEND_SECONDS: '0',
      CODES_MAX_PER_EMAIL_HOUR: '0',
      CODES_MAX_PER_IP_HOUR: '0',
      OTP_MAX_PER_HOUR: '0',
      HLP_RATE_CODES: '0',
      HLP_RATE_API: '0',
      HLP_RATE_LOGIN: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));

const J = (h = {}) => ({ 'content-type': 'application/json', ...h });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** N کار با همزمانیِ محدود — و زمانِ هر کدام */
async function run(label, total, concurrency, task) {
  const times = [];
  let errors = 0;
  let next = 0;
  const started = Date.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const i = next++;
        if (i >= total) return;
        const t0 = Date.now();
        try {
          const ok = await task(i);
          if (!ok) errors++;
        } catch { errors++; }
        times.push(Date.now() - t0);
      }
    })
  );
  const wall = Date.now() - started;
  times.sort((a, b) => a - b);
  const at = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))] ?? 0;
  const rps = Math.round((total / wall) * 1000);
  console.log(
    `   ${label.padEnd(22)} ${String(total).padStart(5)} کار · ${String(concurrency).padStart(3)} هم‌زمان`
    + ` → ${String(wall).padStart(6)}ms · ${String(rps).padStart(5)}/ثانیه`
    + ` · میانه ${String(at(0.5)).padStart(4)}ms · ۹۵٪ ${String(at(0.95)).padStart(5)}ms`
    + (errors ? ` · ${errors} خطا` : '')
  );
  return { wall, rps, p50: at(0.5), p95: at(0.95), errors };
}

try {
  const started = Date.now();
  let up = false;
  while (Date.now() - started < 25000) {
    try { if ((await fetch(`${BASE}/health`)).ok) { up = true; break; } } catch { /* هنوز */ }
    await wait(200);
  }
  if (!up) throw new Error(`سرور بالا نیامد:\n${out}`);

  const token = (await fetch(`${BASE}/api/auth/setup`, { method: 'POST', headers: J(),
    body: JSON.stringify({ username: 'admin', password: 'ControlCenter!2026' }) }).then((r) => r.json())).token;
  const admin = { authorization: `Bearer ${token}` };
  const made = await fetch(`${BASE}/api/codes-admin/apps`, { method: 'POST', headers: J(admin),
    body: JSON.stringify({ slug: 'load-app', name: 'بار', kind: 'app' }) }).then((r) => r.json());
  const key = made.app?.apiKey;

  console.log('\n── ظرفیتِ خودِ سرور (روی loopback، بی شبکه و بی ایمیلِ واقعی) ──\n');

  const health = await run('سلامت', 2000, 50, async () => (await fetch(`${BASE}/health`)).ok);
  check('مسیرِ سلامت بی‌خطا ماند', health.errors === 0, `${health.errors} خطا`);

  const issue = await run('ساختِ کد', 1000, 50, async (i) => {
    const r = await fetch(`${BASE}/api/codes/request`, { method: 'POST', headers: J({ 'x-api-key': key }),
      body: JSON.stringify({ app: 'load-app', email: `u${i}@example.com` }) });
    return r.ok;
  });
  check('هزار کد بی‌خطا ساخته شد', issue.errors === 0, `${issue.errors} خطا`);
  check('۹۵٪ ساختِ کد زیرِ یک ثانیه', issue.p95 < 1000, `${issue.p95}ms`);

  /*
   *  ⚠️ هزار کدِ غلط — مسیرِ سنجش سنگین‌ترین کارِ رمزنگاری را دارد
   *  (HMAC + مقایسهٔ ثابت‌زمان) و باید زیرِ فشار هم درست بماند.
   */
  const verify = await run('سنجشِ کدِ غلط', 1000, 50, async (i) => {
    const r = await fetch(`${BASE}/api/codes/verify`, { method: 'POST', headers: J({ 'x-api-key': key }),
      body: JSON.stringify({ app: 'load-app', email: `u${i}@example.com`, code: '000000' }) });
    const b = await r.json();
    return b.error === 'wrong_code' || b.error === 'too_many_tries';
  });
  check('هزار سنجش، همه با پاسخِ درست', verify.errors === 0, `${verify.errors} پاسخِ نامنتظر`);

  /*
   *  ⚠️ ورودِ ناموفق سنگین‌ترین کارِ سرور است: scrypt با N=16384 عمداً کُند
   *  است تا حدسِ رمز گران شود. پس این عدد باید *پایین* باشد — اگر بالا
   *  بود یعنی هشِ رمز ضعیف شده.
   */
  const login = await run('ورودِ ناموفقِ مدیر', 300, 30, async () => {
    const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: J(),
      body: JSON.stringify({ username: 'admin', password: 'غلط' }) });
    return r.status === 401 || r.status === 429;
  });
  check('حدسِ رمز گران مانده (scrypt)', login.rps < 400, `${login.rps}/ثانیه — اگر بالا رفت یعنی هش ضعیف شده`);
  check('ورودِ ناموفق سرور را نمی‌خواباند', login.errors === 0, `${login.errors} خطا`);

  console.log('\n── سرور بعد از فشار هنوز سالم است ──');
  const after = await fetch(`${BASE}/health`).then((r) => r.json());
  check('سلامت هنوز جواب می‌دهد', after.ok === true);
  const live = await fetch(`${BASE}/api/codes-admin/live?limit=5`, { headers: admin }).then((r) => r.json());
  check('فهرستِ کدها هنوز خوانده می‌شود', Array.isArray(live.items), JSON.stringify(live).slice(0, 120));
  check('صفِ ارسال گیر نکرده', live.queue?.sending < 5, JSON.stringify(live.queue));

  console.log('\n   ⚠️ این اعداد سقفِ خودِ سرورند، نه سقفِ سامانه: شبکه، کلودفلر');
  console.log('      و سرورِ ایمیلِ واقعی در این آزمون نیستند. سقفِ واقعیِ');
  console.log('      ارسالِ ایمیل را جیمیل تعیین می‌کند (حدود ۵۰۰ در روز)،');
  console.log('      نه این سرور.\n');
} finally {
  child.kill('SIGTERM');
  await wait(500);
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`${failed === 0 ? '✅' : '❌'} ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed === 0 ? 0 : 1);
