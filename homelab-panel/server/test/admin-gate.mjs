// ---------------------------------------------------------------------------
//  آزمونِ «درِ مدیر»
//
//      node test/admin-gate.mjs
//
//  دو سؤال را می‌سنجد و هر دو مهم‌اند:
//
//    ۱) آیا برنامهٔ مدیر با کلیدِ درست، از راهِ پورتِ عمومی به کلِ سرور
//       می‌رسد؟ (وگرنه این کار بی‌فایده است)
//    ۲) آیا بدونِ کلید، هیچ چیزی درز نمی‌کند؟ (وگرنه این کار خطرناک است)
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4781);
const PUBLIC_PORT = PORT + 1;
const PANEL = `http://127.0.0.1:${PORT}`;
const PUBLIC = `http://127.0.0.1:${PUBLIC_PORT}`;

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-gate-'));
const dataDir = path.join(tmp, 'data');
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

const child = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')],
  {
    env: {
      ...process.env,
      HLP_PORT: String(PORT),
      HLP_SITESYNC_PORT: String(PUBLIC_PORT),
      HLP_HOST: '127.0.0.1',
      HLP_DATA_DIR: dataDir,
      HLP_SITES_ROOT: sitesRoot,
      HLP_TUNNEL: '0',
      HLP_AI_ENABLED: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(base, url, { method = 'GET', body, token, gate } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (gate) headers['X-Admin-Gate'] = gate;
  const res = await fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch { /* متنِ ساده */ }
  return { status: res.status, body: parsed, text };
}

try {
  const started = Date.now();
  let up = false;
  while (Date.now() - started < 25_000) {
    try {
      if ((await fetch(`${PANEL}/health`)).ok) {
        up = true;
        break;
      }
    } catch { /* هنوز */ }
    await wait(200);
  }
  if (!up) throw new Error(`سرور بالا نیامد:\n${out}`);

  console.log('\n── ورودِ مدیر (از داخلِ خانه) ──');
  const setup = await call(PANEL, '/api/auth/setup', {
    method: 'POST',
    body: { username: 'admin', password: 'ControlCenter!2026' },
  });
  const token = setup.body?.token;
  check('مدیر وارد شد', Boolean(token), JSON.stringify(setup.body));

  console.log('\n── پنل از پورتِ عمومی دیده نمی‌شود ──');
  const bare = await call(PUBLIC, '/api/dashboard', { token });
  check('داشبورد روی پورتِ عمومی نیست', bare.status === 404, `status ${bare.status}`);
  const control = await call(PUBLIC, '/api/control/tohid/accounts', { token });
  check('مرکز فرمان روی پورتِ عمومی نیست', control.status === 404, `status ${control.status}`);

  console.log('\n── درِ بسته، از بیرون ──');
  const noKey = await call(PUBLIC, '/api/admin-gate/api/dashboard', { token });
  check('بدونِ کلید: not found', noKey.status === 404, `status ${noKey.status}`);
  check('هیچ نشانه‌ای از وجودِ در نمی‌دهد', !/gate|admin|unauthorized/i.test(noKey.text), noKey.text);

  const wrongKey = await call(PUBLIC, '/api/admin-gate/api/dashboard', {
    token,
    gate: 'this-is-not-the-key-but-is-long-enough-to-pass',
  });
  check('کلیدِ غلط: not found', wrongKey.status === 404, `status ${wrongKey.status}`);
  check('جوابِ کلیدِ غلط با جوابِ بی‌کلید یکی است', wrongKey.text === noKey.text);

  console.log('\n── گرفتنِ کلید (فقط از داخل) ──');
  const denied = await call(PUBLIC, '/api/settings/remote/device', {
    method: 'POST',
    token,
    body: { deviceId: 'phone-1' },
  });
  check('از بیرون نمی‌شود کلید گرفت', denied.status === 404, `status ${denied.status}`);

  const issued = await call(PANEL, '/api/settings/remote/device', {
    method: 'POST',
    token,
    body: { deviceId: 'phone-1', name: 'گوشیِ من' },
  });
  const key = issued.body?.key;
  check('از داخل کلید صادر شد', Boolean(key) && key.length >= 40, JSON.stringify(issued.body));
  check('مسیر و نامِ هدر هم گفته می‌شود',
    issued.body?.gatePath === '/api/admin-gate' && issued.body?.gateHeader === 'x-admin-gate',
    JSON.stringify(issued.body));

  console.log('\n── با کلیدِ درست، کلِ سرور از راهِ دامنه ──');
  const dash = await call(PUBLIC, '/api/admin-gate/api/dashboard', { token, gate: key });
  check('داشبورد از راهِ در می‌آید', dash.status === 200 && Boolean(dash.body?.server),
    `status ${dash.status}`);

  const codes = await call(PUBLIC, '/api/admin-gate/api/codes-admin/live', { token, gate: key });
  check('کدهای شش‌رقمی هم می‌آیند', codes.status === 200 && Array.isArray(codes.body?.items),
    `status ${codes.status}`);

  const stations = await call(PUBLIC, '/api/admin-gate/api/stations-admin/', { token, gate: key });
  check('پمپ‌ها هم می‌آیند', stations.status === 200, `status ${stations.status}`);

  console.log('\n── کلید جای ورودِ مدیر را نمی‌گیرد ──');
  const keyOnly = await call(PUBLIC, '/api/admin-gate/api/dashboard', { gate: key });
  check('با کلید ولی بدونِ ورود، بسته است', keyOnly.status === 401, `status ${keyOnly.status}`);

  console.log('\n── باطل کردنِ گوشیِ گم‌شده ──');
  const listed = await call(PANEL, '/api/settings/remote', { token });
  check('دستگاه در فهرست دیده می‌شود',
    listed.body?.devices?.some((d) => d.id === 'phone-1'), JSON.stringify(listed.body?.devices));

  const revoked = await call(PANEL, '/api/settings/remote/device/phone-1', { method: 'DELETE', token });
  check('باطل شد', revoked.body?.ok === true, JSON.stringify(revoked.body));

  const afterRevoke = await call(PUBLIC, '/api/admin-gate/api/dashboard', { token, gate: key });
  check('کلیدِ باطل‌شده همان لحظه از کار افتاد', afterRevoke.status === 404,
    `status ${afterRevoke.status}`);

  console.log('\n── کلید در جای دیگری درز نمی‌کند ──');
  const index = await call(PUBLIC, '/');
  check('فهرستِ عمومی نامی از در نمی‌برد', !/admin-gate/i.test(index.text), index.text.slice(0, 200));
  const health = await call(PUBLIC, '/health');
  check('health هم چیزی نمی‌گوید', !/admin-gate/i.test(health.text), health.text.slice(0, 200));
} finally {
  child.kill('SIGTERM');
  await wait(400);
  await fsp.rm(tmp, { recursive: true, force: true });
}

console.log(`\n${failed ? '❌' : '✅'} ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed ? 1 : 0);
