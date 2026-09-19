// ---------------------------------------------------------------------------
//  پلِ «پمپ‌ها» به سرورِ حساب — از همین کامپیوتر، با ورودِ خودکار
//      node test/account-link.mjs
//
//  چرا این آزمون هست: اپِ مدیریت روی گوشی «از ابر جواب نگرفتیم — هنوز به
//  سرورِ ابر وصل نشده‌اید» نشان می‌داد، در حالی که سرورِ حساب روی همان
//  کامپیوترِ خانگی روشن بود. دو ریشه داشت: پل از راهِ اینترنت و تونل به
//  خودش برمی‌گشت، و توکنِ مدیر دوازده‌ساعته بود و کسی نبود دوباره وارد شود.
//
//  این‌جا خودِ پنل بالا می‌آید با یک سرورِ حسابِ ساختگی که ورودِ مدیر، توکنِ
//  منقضی، رمزِ غلط و خاموش بودن را بازی می‌کند.
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PANEL = Number(process.env.TEST_PORT || 4881);
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'acct-link-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 240)}`);
};

// ── ۰) قاعدهٔ نشانی — بی سرور ───────────────────────────────────────────────
console.log('\n── نشانی‌ای که پل می‌زند ──');
{
  process.env.HLP_DATA_DIR = path.join(tmp, 'unit');
  process.env.HLP_ACCOUNT_API = '0';
  const { cloudTarget, CLOUD_BASE } = await import('../src/stations/cloud.js');
  check('درگاه خاموش ⇒ راهِ تونل، همان نشانیِ قفل', cloudTarget() === CLOUD_BASE, cloudTarget());
  check('نشانیِ عمومی همچنان قفل است', CLOUD_BASE === 'https://api.vill3n.top');
}

// ── ۱) سرورِ حسابِ ساختگی ───────────────────────────────────────────────────
const seen = { logins: [], calls: [] };
let valid = new Set();     // توکن‌های زنده
let rejectLogin = false;   // رمز را رد کن
let n = 0;
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const p = req.url.split('?')[0];
    res.setHeader('content-type', 'application/json');
    if (p === '/api/health') return res.end(JSON.stringify({ ok: true, server: 'online', version: '9.9.9' }));
    if (p === '/api/admin/login' && req.method === 'POST') {
      const b = JSON.parse(body || '{}');
      seen.logins.push(b);
      if (rejectLogin || b.username !== 'boss' || b.password !== 'top-secret') {
        res.statusCode = 401;
        return res.end(JSON.stringify({ error: { code: 'bad_credentials', message: 'نام کاربری یا رمز درست نیست' } }));
      }
      const token = `tok-${++n}`;
      valid.add(token);
      return res.end(JSON.stringify({ token, expiresAt: Date.now() + 12 * 3600e3, admin: { username: 'boss' } }));
    }
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    seen.calls.push({ path: p, bearer });
    if (!valid.has(bearer)) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: { code: 'unauthorized', message: 'احراز هویت لازم است' } }));
    }
    if (p === '/api/admin/pump/stats') return res.end(JSON.stringify({ stations: 3, users: 5, files: 7 }));
    if (p === '/api/admin/pump/users') return res.end(JSON.stringify({ users: [{ id: 'u1', name: 'کریم' }] }));
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { code: 'not_found', message: 'این مسیر وجود ندارد' } }));
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const FAKE_URL = `http://127.0.0.1:${fake.address().port}`;

// ── ۲) خودِ پنل، با ورودِ خودکار ────────────────────────────────────────────
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
         HLP_SITESYNC: '1', HLP_SITESYNC_PORT: String(PANEL + 1),
         HLP_TUNNEL: '0', HLP_AI_ENABLED: '0',
         HLP_ACCOUNT_API: FAKE_URL,
         HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const BASE = `http://127.0.0.1:${PANEL}`;
async function api(method, p, body, headers = {}) {
  const res = await fetch(BASE + p, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* بدنهٔ غیرِ JSON */ }
  return { status: res.status, json };
}

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await api('POST', '/api/auth/setup', { username: 'admin', password: 'Link-1405-test' });
  const login = await api('POST', '/api/auth/login', { username: 'admin', password: 'Link-1405-test' });
  const auth = { Authorization: `Bearer ${login.json?.token}` };
  check('ورود به پنل', Boolean(login.json?.token), JSON.stringify(login.json));

  console.log('\n── حالِ پل ──');
  const st = await api('GET', '/api/stations-admin/cloud/status', undefined, auth);
  check('linked بی هیچ ورودِ دستی راست است (ورودِ خودکار)', st.json?.linked === true && st.json?.auto === true, JSON.stringify(st.json));
  check('پل از همین کامپیوتر می‌زند، نه از تونل', st.json?.local === true && st.json?.target === FAKE_URL, JSON.stringify(st.json));
  check('نشانیِ عمومی همچنان قفل است', st.json?.base === 'https://api.vill3n.top');
  check('هیچ توکنی در گاوصندوق ننشسته — ورودِ خودکار فقط در حافظه است', !st.json?.updatedAt, JSON.stringify(st.json));

  console.log('\n── خواندن با ورودِ خودکار ──');
  const stats = await api('GET', '/api/stations-admin/cloud/stats', undefined, auth);
  check('آمار از سرورِ حساب آمد', stats.status === 200 && stats.json?.stations === 3, `${stats.status} ${JSON.stringify(stats.json)}`);
  check('پل خودش یک بار وارد شد، با همان نام و رمزِ .env',
    seen.logins.length === 1 && seen.logins[0].username === 'boss' && seen.logins[0].password === 'top-secret');
  check('و درخواست با همان توکن رفت', seen.calls.at(-1)?.bearer === 'tok-1' && seen.calls.at(-1)?.path === '/api/admin/pump/stats');
  const users = await api('GET', '/api/stations-admin/cloud/users?limit=5', undefined, auth);
  check('بارِ دوم دوباره وارد نمی‌شود — توکن در حافظه است', users.status === 200 && seen.logins.length === 1, `${seen.logins.length} ورود`);

  console.log('\n── توکنِ مدیر مرد (دوازده ساعت گذشت) ──');
  valid.clear();
  const again = await api('GET', '/api/stations-admin/cloud/stats', undefined, auth);
  check('۴۰۱ ⇒ یک بار دوباره وارد می‌شود و جواب می‌آید', again.status === 200 && again.json?.users === 5, `${again.status} ${JSON.stringify(again.json)}`);
  check('دقیقاً یک ورودِ تازه، نه حلقه', seen.logins.length === 2, `${seen.logins.length} ورود`);
  check('و با توکنِ تازه', seen.calls.at(-1)?.bearer === 'tok-2');

  console.log('\n── رمزِ .env غلط است ──');
  valid.clear();
  rejectLogin = true;
  const bad = await api('GET', '/api/stations-admin/cloud/stats', undefined, auth);
  check('«ورودِ خودکار رد شد» با راهِ درست کردن، نه ۴۰۱ِ گنگ',
    bad.status === 409 && bad.json?.error === 'auto_login_rejected' && /HLP_ACCOUNT_ADMIN/.test(bad.json?.message || ''),
    `${bad.status} ${JSON.stringify(bad.json)}`);
  check('پیام نمی‌گوید «ابر»', !/ابر/.test(bad.json?.message || ''), bad.json?.message);
  rejectLogin = false;
  const back = await api('GET', '/api/stations-admin/cloud/stats', undefined, auth);
  check('رمز که درست شد، بی راه‌اندازیِ دوباره وصل می‌شود', back.status === 200, String(back.status));

  console.log('\n── سنجهٔ «چرا کار نمی‌کند» ──');
  const diag = await api('GET', '/api/diagnostics', undefined, auth);
  const acct = (diag.json?.checks || []).find((c) => c.key === 'accountServer');
  check('سرورِ حساب یک ردیف در عیب‌یابی دارد', Boolean(acct), JSON.stringify(diag.json?.checks?.map((c) => c.key)));
  check('و سبز است، با نسخهٔ واقعیِ سرور', acct?.state === 'good' && /9\.9\.9/.test(acct?.value || ''), JSON.stringify(acct));

  console.log('\n── سرورِ حساب خاموش شد ──');
  await new Promise((r) => fake.close(r));
  const down = await api('GET', '/api/stations-admin/cloud/stats', undefined, auth);
  //  ⚠️ «docker compose» دیگر در پیام نیست (۱.۳۸.۰): ناظرِ سرورِ حساب می‌گوید
  //  چرا — این‌جا «نصب نیست»، چون HLP_ACCOUNT_DIR داده نشده.
  check('۵۰۳ِ account_server_down با راهِ درست کردنش',
    down.status === 503 && down.json?.error === 'account_server_down' && /سرورِ حساب/.test(down.json?.message || '') && !/docker/.test(down.json?.message || ''),
    `${down.status} ${JSON.stringify(down.json)}`);
  const diag2 = await api('GET', '/api/diagnostics', undefined, auth);
  const acct2 = (diag2.json?.checks || []).find((c) => c.key === 'accountServer');
  check('عیب‌یابی هم سرخ می‌شود و همان راه را می‌گوید', acct2?.state === 'bad' && /نصب نیست/.test(acct2?.hint || ''), JSON.stringify(acct2));
} finally {
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 400));
  await fsp.rm(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} سبز، ${fail} سرخ`);
if (fail) { console.log(out.slice(-3000)); process.exit(1); }
