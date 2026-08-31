// ---------------------------------------------------------------------------
//  یک سرور، سه جور برنامه
//
//  سایت، اپِ اندروید و برنامهٔ کامپیوتری هر سه باید از **یک** آدرس به همین
//  سرور برسند — همان آدرسی که پنل در کادرِ «برنامه‌ها» کپی می‌کند. این آزمون
//  دقیقاً همان آدرس را می‌زند: مسیرهای ورودِ اپ‌ها، صفحهٔ اتصال، و ارتقای
//  وب‌سوکتِ سایت.
//
//  و آن روی دیگر که مهم‌تر است: چیزی که نباید از این آدرس بیرون برود —
//  پنل، فایل‌منیجر و کنترلِ پروسه‌ها — نرود.
//
//      node test/clients.mjs
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

const PORT = Number(process.env.TEST_PORT || 4797);
const SYNC = PORT + 1;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-clients-'));
fs.mkdirSync(path.join(tmp, 'sites'), { recursive: true });

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`);
  }
};

const serverPath = path.join(import.meta.dirname, '..', 'src', 'index.js');
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', serverPath], {
  env: {
    ...process.env,
    HLP_PORT: String(PORT),
    HLP_HOST: '127.0.0.1',
    HLP_DATA_DIR: path.join(tmp, 'data'),
    HLP_SITES_ROOT: path.join(tmp, 'sites'),
    HLP_TUNNEL: '0',
    HLP_SITESYNC: '1',
    HLP_SITESYNC_PORT: String(SYNC),
    HLP_AI_ENABLED: '0',
    HLP_DISCOVERY: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOut = '';
child.stdout.on('data', (d) => (serverOut += d));
child.stderr.on('data', (d) => (serverOut += d));

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (r.ok) return true;
    } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function stop() {
  child.kill('SIGTERM');
}

try {
  console.log('\n▶ راه‌اندازی سرور آزمایشی...');
  if (!(await waitForServer())) {
    console.log(serverOut.slice(-1500));
    throw new Error('سرور بالا نیامد');
  }

  // همان آدرسی که پنل به برنامه‌ها می‌دهد: پورتِ عمومی، نه پورتِ پنل
  const BASE = `http://127.0.0.1:${SYNC}`;

  console.log('\n── اپِ اندروید و برنامهٔ کامپیوتری ──');
  const cfgRes = await fetch(`${BASE}/api/app/config`);
  const cfg = await cfgRes.json();
  check('شناسنامهٔ سرور از آدرسِ عمومی خوانده می‌شود', cfg.ok === true);
  check('آدرسِ اینترنتی در شناسنامه اعلام شده', 'internet' in (cfg.server || {}));
  check('مسیرِ ورود در شناسنامه اعلام شده', cfg.endpoints?.requestCode === '/api/app/auth/request-code');
  check('نبضِ سرور جواب می‌دهد', (await fetch(`${BASE}/api/app/ping`)).status === 200);

  const rc = await fetch(`${BASE}/api/app/auth/request-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '09121234567' }),
  });
  check('درخواستِ کدِ ورود از همین آدرس کار می‌کند', rc.status === 200, `status ${rc.status}`);

  console.log('\n── صفحهٔ اتصال ──');
  const conn = await fetch(`${BASE}/connect`);
  const html = await conn.text();
  check('صفحهٔ اتصال از آدرسِ عمومی باز می‌شود', conn.status === 200);
  check('انتخابگرِ «کدام آدرس» در صفحه هست', html.includes('whereTabs'));
  check('آدرسِ وب‌سوکتِ سایت هم در همان صفحه هست', html.includes('wsBase') && html.includes('SELF_HOST_URL'));

  console.log('\n── سایت: همان آدرس، فقط با ws ──');
  const ws = new WebSocket(`ws://127.0.0.1:${SYNC}/`);
  const wsOk = await new Promise((res) => {
    const t = setTimeout(() => res(false), 5000);
    ws.on('open', () => { clearTimeout(t); ws.close(); res(true); });
    ws.on('error', () => { clearTimeout(t); res(false); });
  });
  check('همان آدرس ارتقای وب‌سوکت را می‌پذیرد', wsOk);

  console.log('\n── اپِ توحید ──');
  check('APIِ نسخهٔ ۱ روی همان آدرس هست', (await fetch(`${BASE}/api/v1/health`)).status === 200);

  console.log('\n── آنچه نباید از این آدرس بیرون برود ──');
  for (const p of ['/api/control', '/api/files/list', '/api/sites', '/api/logs']) {
    const r = await fetch(BASE + p);
    check(`${p} بسته است`, r.status === 404, `status ${r.status}`);
  }
} finally {
  stop();
  await new Promise((r) => setTimeout(r, 600));
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log('\n════════════════════════════════════');
console.log(`  موفق: ${passed}    ناموفق: ${failed}`);
console.log('════════════════════════════════════\n');
process.exit(failed ? 1 : 0);
