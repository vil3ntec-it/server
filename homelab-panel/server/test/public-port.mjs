// ---------------------------------------------------------------------------
//  مرزِ پورتِ عمومی — چه چیزی از اینترنت دیده می‌شود و چه چیزی نه
//      node test/public-port.mjs
//
//  تونل روی پورتِ دومی باز می‌شود تا پنل هرگز به اینترنت درز نکند. این
//  آزمون هر دو طرفِ آن مرز را می‌سنجد:
//
//      • برنامه‌های توحید — مشتری و مدیریت — باید از آن‌جا برسند، وگرنه
//        آدرسِ ثابتی که با دامنهٔ خودتان می‌سازید به درد نمی‌خورد.
//      • پنل و فایل‌ها و پروسه‌ها نباید برسند، هرگز.
//
//  یک بار همین مرز اشتباه بسته بود و هر دو برنامه از راهِ تونل «not found»
//  می‌گرفتند. آزمون هست که آن اشتباه دوباره برنگردد — و مهم‌تر، که کسی
//  موقعِ باز کردنِ این در، پنل را هم با خودش باز نکند.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PANEL = Number(process.env.TEST_PORT || 4851);
const PUBLIC = PANEL + 1;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'pub-port-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 200)}`);
};

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
         HLP_SITESYNC: '1', HLP_SITESYNC_PORT: String(PUBLIC),
         HLP_TUNNEL: '0', HLP_AI_ENABLED: '0',
         //  این آزمون مرزِ خودِ پنل را می‌سنجد؛ درِ سرورِ حساب (account-proxy) عمداً بسته است
         HLP_ACCOUNT_API: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const hit = async (port, p, { method = 'GET', body, token } = {}) => {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, text: await res.text() };
};

const ADMIN_PASSWORD = 'ControlCenter!2026';

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PANEL}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const setup = await hit(PANEL, '/api/auth/setup', {
    method: 'POST', body: { username: 'admin', password: ADMIN_PASSWORD },
  });
  check('پنل بالا آمد', setup.status === 200, setup.text.slice(0, 120));

  console.log('\n── حساب فقط روی سرورِ حساب است — این پنل دفترِ دومی ندارد ──');

  /*
   *  تا ۱.۴۰.۰ این پنل خودش ‎/api/v1/auth‎ و ‎/api/v1/admin‎ را جواب می‌داد
   *  (دفترِ حسابِ دوم، ‎src/tohid/‎). حالا آن مسیرها مالِ سرورِ حساب‌اند و
   *  درگاهِ ‎account-proxy.js‎ می‌بردشان (‎test/account-gateway.mjs‎). با درگاهِ
   *  خاموش باید «نبوده» باشند — نه این‌که یک دفترِ محلی بی‌صدا جواب بدهد.
   */
  const custLogin = await hit(PUBLIC, '/api/v1/auth/login', {
    method: 'POST', body: { identifier: 'kasi@example.com', password: 'x' },
  });
  check('ورودِ مشتری با درگاهِ خاموش «نبوده» است (JSON ۴۰۴)، نه دفترِ محلی', custLogin.status === 404, `${custLogin.status} ${custLogin.text.slice(0, 60)}`);
  const admLogin = await hit(PUBLIC, '/api/v1/admin/login', {
    method: 'POST', body: { username: 'admin', password: ADMIN_PASSWORD },
  });
  check('و رمزِ مدیرِ پنل هیچ حسابی را آن‌جا باز نمی‌کند', admLogin.status === 404 && !/token/.test(admLogin.text), `${admLogin.status} ${admLogin.text.slice(0, 60)}`);
  const token = JSON.parse(setup.text || '{}').token;
  const stats = await hit(PANEL, '/api/v1/admin/stats', { token });
  check('روی پورتِ پنل هم دفترِ حسابی نیست', stats.status === 404, `${stats.status} ${stats.text.slice(0, 80)}`);

  console.log('\n── یک آدرس، یک فهرست ──');

  /*
   *  صفحهٔ اولِ API. تا امروز آدرسِ عمومی هیچ نمی‌گفت چه چیزی رویش هست؛
   *  سازندهٔ برنامه باید از کد حدس می‌زد. حالا خودِ سرور می‌گوید.
   */
  const index = await hit(PUBLIC, '/api');
  const idx = JSON.parse(index.text || '{}');
  check('فهرستِ API روی /api هست', index.status === 200 && idx.version === 'v1', index.text.slice(0, 120));
  check('آدرسِ پایه را می‌گوید', Boolean(idx.baseUrl), JSON.stringify(idx.baseUrl));
  check('مسیرها را فهرست می‌کند', Array.isArray(idx.endpoints) && idx.endpoints.length >= 5,
    JSON.stringify(idx.endpoints || []).slice(0, 120));
  check('همان فهرست روی /api/v1 هم هست',
    JSON.parse((await hit(PUBLIC, '/api/v1')).text || '{}').version === 'v1');

  const pubHealth = await hit(PUBLIC, '/api/v1/health');
  const ph = JSON.parse(pubHealth.text || '{}');
  check('سلامت زیرِ API هم هست', pubHealth.status === 200 && ph.ok === true, pubHealth.text.slice(0, 100));
  // /health داخلی مسیرِ نصب را هم می‌گوید؛ آن سرنخ نباید به اینترنت برسد
  check('سلامتِ عمومی مسیرِ نصب را لو نمی‌دهد', !('root' in ph), pubHealth.text.slice(0, 140));
  check('سلامتِ ریشه هم همان است',
    !('root' in JSON.parse((await hit(PUBLIC, '/health')).text || '{}')));

  const ready = await hit(PUBLIC, '/api/v1/ready');
  check('آمادگی زیرِ API هست', ready.status === 200 || ready.status === 503, `${ready.status}`);

  // مسیرهایی که تا حالا فقط بی‌نسخه بودند، حالا زیرِ v1 هم هستند —
  // بدونِ اینکه نامِ قدیمی‌شان بشکند.
  for (const [label, versioned, legacy, method] of [
    ['ورودِ برنامه‌ها', '/api/v1/app/ping', '/api/app/ping', 'GET'],
    ['کارتِ سرور برای برنامه‌ها', '/api/v1/app/config', '/api/app/config', 'GET'],
    ['اعلان‌ها', '/api/v1/notify/subscribe', '/api/notify/subscribe', 'POST'],
  ]) {
    const a = await hit(PUBLIC, versioned, { method, body: method === 'POST' ? {} : undefined });
    const b = await hit(PUBLIC, legacy, { method, body: method === 'POST' ? {} : undefined });
    check(`«${label}» زیرِ v1 هست`, a.status !== 404, `${a.status} ${a.text.slice(0, 60)}`);
    check(`«${label}» با نامِ قدیمی هم هست`, b.status !== 404, `${b.status} ${b.text.slice(0, 60)}`);
  }

  const unknown = await hit(PUBLIC, '/api/v1/چنین-چیزی-نیست');
  check('مسیرِ ناشناخته زیرِ API، JSONِ ۴۰۴ می‌دهد',
    unknown.status === 404, `${unknown.status} ${unknown.text.slice(0, 60)}`);

  console.log('\n── ولی پنل از اینترنت دیده نمی‌شود ──');
  for (const [label, p] of [
    ['مرکز فرمان', '/api/control/overview'],
    ['حساب‌های دکان', '/api/account-admin/shop-accounts'],
    ['فایل‌ها', '/api/files/list?path=/'],
    ['سایت‌ها', '/api/sites'],
    ['کاربرانِ پنل', '/api/auth/users'],
    ['تنظیمات', '/api/settings'],
  ]) {
    const res = await hit(PUBLIC, p, { token });
    // ۴۰۴ درست است: روی این پورت اصلاً وجود ندارد. ۲۰۰ یعنی درز کرده.
    check(`«${label}» روی پورتِ عمومی نیست`, res.status === 404, `${res.status} ${res.text.slice(0, 60)}`);
  }

  // ریشه یک «زنده‌ام» کوچک می‌دهد و باید همان بماند — نه صفحهٔ خودِ پنل
  const root = await hit(PUBLIC, '/');
  check('ریشه صفحهٔ پنل را نمی‌دهد',
    !root.text.includes('<html') && !root.text.includes('<div id="root"'), root.text.slice(0, 80));

  console.log('\n── و همان‌ها روی پنلِ خانگی سرِ جایشان هستند ──');
  const panelToken = JSON.parse(setup.text || '{}').token;
  const overview = await hit(PANEL, '/api/control/overview', { token: panelToken });
  check('مرکز فرمان روی پنل کار می‌کند', overview.status === 200, `${overview.status} ${overview.text.slice(0, 80)}`);
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  server.kill();
  await new Promise((r) => setTimeout(r, 200));
  if (fail) console.log(`\n${out.slice(-2000)}`);
  await fsp.rm(tmp, { recursive: true, force: true });
  console.log(`\n════════════════════════\n  موفق: ${pass}    ناموفق: ${fail}\n════════════════════════`);
  process.exit(fail ? 1 : 0);
}
