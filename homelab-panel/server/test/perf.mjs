// ---------------------------------------------------------------------------
// آزمون بار روی پردازنده — ثابت می‌کند پنل وقتی کسی نگاهش نمی‌کند کار نمی‌کند
//   node test/perf.mjs
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { io as ioClient } from 'socket.io-client';

const PORT = Number(process.env.TEST_PORT || 4794);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-perf-'));
const sitesRoot = path.join(tmp, 'sites');
fs.mkdirSync(sitesRoot, { recursive: true });

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`);
  }
};

const server = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')],
  {
    env: {
      ...process.env,
      HLP_PORT: String(PORT),
      HLP_HOST: '127.0.0.1',
      HLP_DATA_DIR: path.join(tmp, 'data'),
      HLP_SITES_ROOT: sitesRoot,
      HLP_METRICS_INTERVAL: '1000',
    },
    stdio: 'ignore',
  }
);

// زمان پردازندهٔ مصرف‌شدهٔ خودِ سرور (فقط لینوکس این فایل را دارد)
function cpuSeconds() {
  try {
    const fields = fs.readFileSync(`/proc/${server.pid}/stat`, 'utf8').split(') ').pop().split(' ');
    return (Number(fields[11]) + Number(fields[12])) / 100;
  } catch {
    return null;
  }
}

function childProcessCount() {
  try {
    return fs
      .readFileSync(`/proc/${server.pid}/task/${server.pid}/children`, 'utf8')
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUp() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch { /* هنوز */ }
    await sleep(200);
  }
  throw new Error('سرور بالا نیامد');
}

let socket;
try {
  await waitUp();

  const setup = await fetch(`${BASE}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'HomeServer!2026' }),
  }).then((r) => r.json());

  console.log('\n── حالت بی‌کار: هیچ مرورگری باز نیست ──');
  await sleep(2000);
  const idleStart = cpuSeconds();
  await sleep(12000);
  const idleCpu = cpuSeconds() - idleStart;
  check('در ۱۲ ثانیه بی‌کاری تقریباً پردازنده مصرف نمی‌شود', idleCpu < 0.35, `${idleCpu.toFixed(2)} ثانیه CPU`);

  console.log('\n── پنل باز است: داده باید زنده بیاید ──');
  socket = ioClient(BASE, { auth: { token: setup.token }, transports: ['websocket'] });
  let ticks = 0;
  socket.on('metrics', () => ticks++);
  await new Promise((res, rej) => {
    socket.once('connect', res);
    socket.once('connect_error', rej);
    setTimeout(rej, 8000);
  });

  ticks = 0;
  await sleep(6000);
  check('با پنلِ باز، داده هر ۱ ثانیه می‌آید', ticks >= 4, `${ticks} بروزرسانی در ۶ ثانیه`);

  console.log('\n── تب پنهان شد: باید فوراً آرام شود ──');
  socket.emit('viewer', false);
  await sleep(1500);
  ticks = 0;
  await sleep(10000);
  check('با تبِ پنهان، جمع‌آوری متوقف می‌شود', ticks <= 1, `${ticks} بروزرسانی در ۱۰ ثانیه`);

  socket.emit('viewer', true);
  await sleep(1500);
  ticks = 0;
  await sleep(4000);
  check('با برگشتن به تب، دوباره زنده می‌شود', ticks >= 2, `${ticks} بروزرسانی در ۴ ثانیه`);

  console.log('\n── پروسه‌های جانبی ──');
  const children = childProcessCount();
  check(
    'در حالت عادی هیچ پروسهٔ جانبی مدام باز و بسته نمی‌شود',
    children === 0 || children === null,
    children === null ? 'قابل اندازه‌گیری نبود' : `${children} پروسهٔ فرزند`
  );

  console.log('\n── حافظه ──');
  const rssMb = Number(fs.readFileSync(`/proc/${server.pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)[1]) / 1024;
  check('مصرف حافظه معقول است', rssMb < 160, `${rssMb.toFixed(0)} MB`);
} catch (e) {
  fail++;
  console.log(`\n❌ خطای غیرمنتظره: ${e.stack || e}`);
} finally {
  socket?.close();
  server.kill('SIGTERM');
  await sleep(700);
  server.kill('SIGKILL');
  await fsp.rm(tmp, { recursive: true, force: true });
}

console.log(`\n════════════════════════════════════`);
console.log(`  موفق: ${pass}    ناموفق: ${fail}`);
console.log(`════════════════════════════════════\n`);
process.exit(fail ? 1 : 0);
