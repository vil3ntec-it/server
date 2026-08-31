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
         HLP_TUNNEL: '0', HLP_AI_ENABLED: '0' },
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

  console.log('\n── از راهِ تونل، برنامه‌ها می‌رسند ──');

  // ۴۰۴ یعنی «این مسیر اینجا نیست» — همان چیزی که قبلاً می‌آمد و برنامه را
  // از کار می‌انداخت. ۴۰۱ یعنی مسیر هست و فقط رمز می‌خواهد.
  const custLogin = await hit(PUBLIC, '/api/v1/auth/login', {
    method: 'POST', body: { identifier: 'kasi@example.com', password: 'x' },
  });
  check('ورودِ مشتری از تونل پیدا می‌شود', custLogin.status !== 404, `${custLogin.status} ${custLogin.text.slice(0, 60)}`);

  const admLogin = await hit(PUBLIC, '/api/v1/admin/login', {
    method: 'POST', body: { username: 'admin', password: 'غلط' },
  });
  check('ورودِ مدیر از تونل پیدا می‌شود', admLogin.status !== 404, `${admLogin.status} ${admLogin.text.slice(0, 60)}`);

  const real = await hit(PUBLIC, '/api/v1/admin/login', {
    method: 'POST', body: { username: 'admin', password: ADMIN_PASSWORD },
  });
  const token = JSON.parse(real.text || '{}').token;
  check('مدیر از راهِ تونل واقعاً وارد می‌شود', Boolean(token), real.text.slice(0, 140));

  const stats = await hit(PUBLIC, '/api/v1/admin/stats', { token });
  check('و کارش را هم می‌کند', stats.status === 200, `${stats.status} ${stats.text.slice(0, 80)}`);

  const register = await hit(PUBLIC, '/api/v1/auth/register', {
    method: 'POST', body: { name: 'کریم', email: 'karim@example.com', phone: '0700999888', password: 'shop-pass-1' },
  });
  check('مشتری از راهِ تونل ثبت‌نام می‌کند', register.status === 200, register.text.slice(0, 120));

  console.log('\n── ولی پنل از اینترنت دیده نمی‌شود ──');
  for (const [label, p] of [
    ['مرکز فرمان', '/api/control/tohid/overview'],
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
  const overview = await hit(PANEL, '/api/control/tohid/overview', { token: panelToken });
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
