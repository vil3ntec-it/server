// ---------------------------------------------------------------------------
//  پنل خودش سرورِ حساب را بالا می‌آورد — با shop/server واقعی روی PGlite
//      node test/account-supervisor.mjs
//
//  چرا این آزمون هست: روی کامپیوترِ خانگی (ویندوز، بی داکر و بی PostgreSQL)
//  برنامهٔ پمپ، برنامهٔ دکان و اپِ مدیریت همه یک جمله می‌دیدند: «سرورِ حساب
//  روی سرورِ خانگی روشن نیست… docker compose up -d». این‌جا خودِ پنل بالا
//  می‌آید، سرورِ حسابِ واقعی را به عنوانِ فرزند روشن می‌کند (PGlite در پوشهٔ
//  داده)، و از راهِ پورتِ عمومی — همان چیزی که تونل می‌بیند — ثبت‌نام و ورود و
//  پلِ «پمپ‌ها» با مدیرِ خودساخته سنجیده می‌شود.
//
//  ⚠️ کدِ سرورِ حساب از ACCOUNT_SERVER_DIR (فقط همین سنجه می‌خواندش — CI آن را
//  می‌دهد) یا HLP_ACCOUNT_DIR می‌آید، یا از ریپوی خواهرِ shop کنارِ این ریپو
//  (../shop/server با node_modules). نبودش سنجه را «رد» می‌کند، نه قرمز.
//  ⚠️ خودِ ناظر ریپوی خواهر را خودکار پیدا نمی‌کند (وگرنه هر آزمونی که پنل را
//  بالا می‌آورد یک سرورِ حساب هم روشن می‌کرد)؛ این‌جا صریح داده می‌شود.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const candidates = [
  process.env.ACCOUNT_SERVER_DIR,
  process.env.HLP_ACCOUNT_DIR,
  path.resolve(here, '..', '..', 'account-server'),
  path.resolve(here, '..', '..', '..', '..', 'shop', 'server'),
].filter(Boolean);
const ACCOUNT_DIR = candidates.find((d) => fs.existsSync(path.join(d, 'src', 'index.js')) && fs.existsSync(path.join(d, 'node_modules')));

if (!ACCOUNT_DIR) {
  console.log('⚠️  کدِ سرورِ حساب پیدا نشد (HLP_ACCOUNT_DIR یا ../shop/server با node_modules) — این سنجه رد شد.');
  process.exit(0);
}

const PANEL = Number(process.env.TEST_PORT || 4891);
const PUBLIC = PANEL + 1;
const ACCOUNT_PORT = PANEL + 2;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'acct-sup-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 260)}`);
};

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
         HLP_SITESYNC: '1', HLP_SITESYNC_PORT: String(PUBLIC),
         HLP_TUNNEL: '0', HLP_AI_ENABLED: '0',
         HLP_ACCOUNT_API: `http://127.0.0.1:${ACCOUNT_PORT}`,
         HLP_ACCOUNT_DIR: ACCOUNT_DIR, HLP_ACCOUNT_AUTOSTART: '1',
         HLP_ACCOUNT_ADMIN_USER: '', HLP_ACCOUNT_ADMIN_PASSWORD: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const hit = async (port, p, { method = 'GET', body, headers = {} } = {}) => {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* غیرِ JSON */ }
  return { status: res.status, json, text };
};

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PANEL}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await hit(PANEL, '/api/auth/setup', { method: 'POST', body: { username: 'admin', password: 'Sup-1405-test' } });
  const login = await hit(PANEL, '/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'Sup-1405-test' } });
  const auth = { Authorization: `Bearer ${login.json?.token}` };
  check('ورود به پنل', Boolean(login.json?.token));

  console.log('\n── سرورِ حساب با پنل بالا می‌آید ──');
  let health = null;
  for (let i = 0; i < 160; i++) {
    const h = await hit(PUBLIC, '/api/health').catch(() => null);
    if (h?.status === 200 && h.json?.server === 'online') { health = h; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  check('از پورتِ عمومی، /api/health سرورِ حسابِ واقعی را می‌دهد', !!health, out.slice(-1200));
  check('و نسخهٔ سرورِ حساب همان package.jsonِ آن است',
    health?.json?.version === JSON.parse(fs.readFileSync(path.join(ACCOUNT_DIR, 'package.json'), 'utf8')).version, JSON.stringify(health?.json));
  check('دیتابیسش وصل است (PGlite)', health?.json?.database === 'connected');
  check('پوشهٔ دیتابیس داخلِ پوشهٔ دادهٔ پنل ساخته شد', fs.existsSync(path.join(tmp, 'data', 'account-server', 'pg')));
  const secrets = path.join(tmp, 'data', 'account-server', 'secrets.json');
  check('رازها یک‌جا و فقط‌خواندنیِ صاحبِ سرور', fs.existsSync(secrets) && (process.platform === 'win32' || (fs.statSync(secrets).mode & 0o077) === 0));

  console.log('\n── وضعیت از پنل ──');
  const st = await hit(PANEL, '/api/account-server/status', { headers: auth });
  check('ناظر می‌گوید نصب هست، روشن است و بالاست', st.json?.installed && st.json?.running && st.json?.up, JSON.stringify(st.json));
  check('راه‌انداز PGlite است', st.json?.driver === 'pglite');
  const noAuth = await hit(PANEL, '/api/account-server/status');
  check('بی ورود بسته است', noAuth.status === 401);
  const pub = await hit(PUBLIC, '/api/account-server/status');
  check('روی پورتِ عمومی نیست', pub.status === 404 || pub.status === 401, String(pub.status));

  console.log('\n── همان راهی که برنامه‌ها می‌روند: ثبت‌نام و ورود از راهِ درگاه ──');
  const start = await hit(PUBLIC, '/api/auth/register/start', {
    method: 'POST', body: { email: 'sup-test@example.com', password: 'Sup!12345', name: 'سنجه', app: 'pump' },
    headers: { 'X-App-Id': 'tohid-pump-app' },
  });
  check('register/start از راهِ درگاه به سرورِ حسابِ واقعی رسید', start.status === 201 || start.status === 200, `${start.status} ${start.text.slice(0, 200)}`);
  const bad = await hit(PUBLIC, '/api/auth/login', { method: 'POST', body: { email: 'nobody@example.com', password: 'Wrong!12345', app: 'pump' } });
  check('ورودِ غلط ۴۰۱ِ خودِ سرورِ حساب است، نه ۵۰۳ِ درگاه', bad.status === 401 && bad.json?.error?.code, `${bad.status} ${bad.text.slice(0, 200)}`);

  console.log('\n── پلِ «پمپ‌ها» با مدیرِ خودساخته وارد می‌شود ──');
  const cs = await hit(PANEL, '/api/stations-admin/cloud/status', { headers: auth });
  check('linked و auto بی هیچ تنظیمِ دستی', cs.json?.linked === true && cs.json?.auto === true && cs.json?.local === true, JSON.stringify(cs.json));
  const stats = await hit(PANEL, '/api/stations-admin/cloud/stats', { headers: auth });
  check('آمارِ پمپ‌ها از سرورِ حسابِ واقعی آمد', stats.status === 200 && typeof stats.json?.stats?.stations === 'number', `${stats.status} ${stats.text.slice(0, 200)}`);
  const users = await hit(PANEL, '/api/stations-admin/cloud/users?limit=5', { headers: auth });
  check('حساب‌های پمپ هم', users.status === 200, `${users.status} ${users.text.slice(0, 200)}`);
  const adminPanel = await hit(PUBLIC, '/admin/');
  check('پنلِ مدیریتِ سرورِ حساب از پورتِ عمومی می‌آید', adminPanel.status === 200 && /<html/i.test(adminPanel.text), String(adminPanel.status));

  console.log('\n── عیب‌یابی ──');
  const diag = await hit(PANEL, '/api/diagnostics', { headers: auth });
  const row = (diag.json?.checks || []).find((c) => c.key === 'accountServer');
  check('ردیفِ سرورِ حساب سبز است، با نسخه', row?.state === 'good' && /نسخهٔ/.test(row?.value || ''), JSON.stringify(row));

  console.log('\n── سرورِ حساب می‌افتد و پنل برش می‌گرداند ──');
  const pid = st.json?.pid;
  process.kill(pid, 'SIGKILL');
  let back = null;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const s2 = await hit(PANEL, '/api/account-server/status', { headers: auth });
    if (s2.json?.running && s2.json?.up && s2.json?.pid !== pid) { back = s2.json; break; }
  }
  check('پروسهٔ تازه با pidِ تازه بالا آمد و جواب می‌دهد', !!back, out.slice(-600));
  check('شمارِ افتادن‌ها ثبت شد', (back?.restarts || 0) >= 1);
  const again = await hit(PUBLIC, '/api/health');
  check('و درگاه دوباره به آن می‌رسد', again.status === 200 && again.json?.server === 'online');
  const still = await hit(PANEL, '/api/stations-admin/cloud/stats', { headers: auth });
  check('پل هم بی دخالت دوباره وارد می‌شود (همان رازها، همان مدیر)', still.status === 200, `${still.status} ${still.text.slice(0, 200)}`);

  console.log('\n── حالتِ «سرورِ حساب هنوز بالا نیامده» پیامِ درست دارد ──');
  const stop = await hit(PANEL, '/api/account-server/stop', { method: 'POST', headers: auth });
  check('خاموش شد', stop.json?.ok === true);
  await new Promise((r) => setTimeout(r, 1500));
  const down = await hit(PUBLIC, '/api/auth/login', { method: 'POST', body: { email: 'x@example.com', password: 'Wrong!12345' } });
  check('۵۰۳ِ account_server_down — بی «docker compose»', down.status === 503 && down.json?.error?.code === 'account_server_down' && !/docker/.test(down.json?.error?.message || ''), `${down.status} ${down.text.slice(0, 260)}`);
  const restart = await hit(PANEL, '/api/account-server/start', { method: 'POST', headers: auth });
  check('دوباره روشن می‌شود', restart.json?.ok === true, JSON.stringify(restart.json));
} finally {
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1500));
  await fsp.rm(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} سبز، ${fail} سرخ`);
if (fail) { console.log(out.slice(-4000)); process.exit(1); }
