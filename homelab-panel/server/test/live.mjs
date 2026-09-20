// ---------------------------------------------------------------------------
//  آزمونِ گذرگاهِ زنده — روی سرورِ واقعی
//
//      node test/live.mjs
//
//  گزارشِ صاحب ریپو: «توی همون بخش مد نظر استم و هیچی نمیاد؛ باید از اون
//  بخش بیرون بشم یا از برنامه تا دوباره بیام و ببینم.»
//
//  پس سه سؤال سنجیده می‌شود، و هر سه مهم‌اند:
//
//    ۱) چیزی که همین حالا عوض شد، **بی رفتن و برگشتن** به مشتری می‌رسد؟
//    ۲) وقتی هیچ چیزی عوض نشده، هیچ پیامی هم نمی‌رود؟
//       (وگرنه فقط جای شانزده `setInterval` را گرفته‌ایم)
//    ۳) در از بیرون بسته است؟
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4797);
const PUBLIC_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const PUBLIC = `http://127.0.0.1:${PUBLIC_PORT}`;

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-live-'));
const sitesRoot = path.join(tmp, 'sites');
fs.mkdirSync(sitesRoot, { recursive: true });

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
      HLP_PORT: String(PORT),
      HLP_SITESYNC_PORT: String(PUBLIC_PORT),
      HLP_HOST: '127.0.0.1',
      HLP_DATA_DIR: path.join(tmp, 'data'),
      HLP_SITES_ROOT: sitesRoot,
      HLP_TUNNEL: '0',
      HLP_AI_ENABLED: '0',
      HLP_ACCOUNT_API: '0',
      HLP_ACCOUNT_AUTOSTART: '0',
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
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 *  یک مشتریِ SSEی واقعی — همان چیزی که اپِ اندروید خواهد بود.
 *
 *  ⚠️ عمداً `EventSource` نیست: می‌خواهیم دقیقاً همان کاری را بکنیم که
 *  `HttpURLConnection` در کاتلین می‌کند — خواندنِ خطبه‌خطِ خامِ جریان.
 *  اگر شکلِ پیام برای آن قابلِ خواندن نباشد، این‌جا هم نیست.
 */
function openStream(url) {
  const box = { events: [], closed: false, ctrl: new AbortController() };
  box.ready = (async () => {
    const res = await fetch(url, { signal: box.ctrl.signal });
    if (!res.ok) throw new Error(`stream ${res.status}`);
    box.status = res.status;
    (async () => {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = /^event: (.+)$/m.exec(frame)?.[1];
            const data = /^data: (.+)$/m.exec(frame)?.[1];
            if (ev) box.events.push({ event: ev, data: data ? JSON.parse(data) : null });
          }
        }
      } catch { /* بسته شد */ }
      box.closed = true;
    })();
    return box;
  })();
  return box;
}

/** منتظرِ یک موضوع می‌ماند و می‌گوید چند میلی‌ثانیه طول کشید */
async function waitFor(box, topic, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const hit = box.events.find((e) => e.event === 'changed' && e.data?.topic === topic);
    if (hit) return Date.now() - t0;
    await wait(25);
  }
  return null;
}

try {
  const started = Date.now();
  let up = false;
  while (Date.now() - started < 25_000) {
    try { if ((await fetch(`${BASE}/health`)).ok) { up = true; break; } } catch { /* هنوز */ }
    await wait(200);
  }
  if (!up) throw new Error(`سرور بالا نیامد:\n${out}`);

  console.log('\n── ورودِ مدیر ──');
  const setup = await call('POST', '/api/auth/setup', { username: 'admin', password: 'ControlCenter!2026' });
  token = setup.body?.token
    || (await call('POST', '/api/auth/login', { username: 'admin', password: 'ControlCenter!2026' })).body?.token;
  check('مدیر وارد شد', Boolean(token));

  console.log('\n── در، از بیرون بسته است ──');
  const noAuth = await fetch(`${BASE}/api/live/stream`);
  check('بی توکن ۴۰۱', noAuth.status === 401, String(noAuth.status));
  await noAuth.body?.cancel?.().catch(() => {});

  const onPublic = await fetch(`${PUBLIC}/api/live/stream?token=${token}`);
  check('⛔ روی پورتِ عمومی اصلاً نیست', onPublic.status === 404, String(onPublic.status));
  await onPublic.body?.cancel?.().catch(() => {});

  console.log('\n── جریانِ زنده باز می‌شود ──');
  const box = openStream(`${BASE}/api/live/stream?token=${token}`);
  await box.ready;
  await wait(300);
  check('جریان باز شد و «hello» آمد',
    box.events.some((e) => e.event === 'hello'), JSON.stringify(box.events.slice(0, 2)));

  console.log('\n── ۱) تغییر، بی رفتن و برگشتن می‌رسد ──');
  /*
   *  هر `logEvent`ِ سرور موضوعِ «logs» را بیدار می‌کند. یک کارِ واقعی
   *  می‌کنیم که لاگ بنویسد و می‌سنجیم که خبرش رسید — نه این‌که خودمان
   *  `bump` را صدا بزنیم، چون آن‌وقت فقط خودِ گذرگاه سنجیده می‌شد.
   */
  box.events.length = 0;
  await call('POST', '/api/auth/users', { username: 'watcher-live', password: 'Watcher!2026', role: 'viewer' });
  const logsMs = await waitFor(box, 'logs');
  check('«logs» رسید', logsMs !== null, JSON.stringify(box.events));
  check('و زیرِ دو ثانیه', logsMs !== null && logsMs < 2000, `${logsMs}ms`);

  console.log('\n── ۲) بی تغییر، هیچ پیامی نمی‌رود ──');
  /*
   *  ⛔ مهم‌ترین بندِ این فایل. اگر گذرگاه در سکوت هم پیام بفرستد، فقط
   *  جای شانزده `setInterval`ِ قدیمی را گرفته‌ایم و خواستهٔ «روی کامپیوتر
   *  فشاری نیاره» زیرِ پا مانده.
   */
  box.events.length = 0;
  await wait(2500);
  const noise = box.events.filter((e) => e.event === 'changed');
  check('⛔ در سکوت، صفر پیام', noise.length === 0, JSON.stringify(noise));

  console.log('\n── ۳) pushِ سرورِ حساب ──');
  const badKey = await fetch(`${BASE}/api/live/bump`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-live-key': 'ghalat-ghalat-ghalat' },
    body: JSON.stringify({ topic: 'codes' }),
  });
  check('⛔ بی رازِ درست: not found', badKey.status === 404, String(badKey.status));

  const noKey = await fetch(`${BASE}/api/live/bump`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic: 'codes' }),
  });
  check('⛔ بی راز هم همان', noKey.status === 404, String(noKey.status));

  console.log('\n── ۴) رگبار یک پیام می‌شود ──');
  /*
   *  ⚠️ صد سطرِ لاگ نباید صد بار صفحه را به خواندن بیندازد — وگرنه
   *  همان فشاری را ساخته‌ایم که می‌خواستیم برداریم، فقط از سمتِ سرور.
   */
  box.events.length = 0;
  for (let i = 0; i < 12; i++) {
    await call('GET', `/api/logs?limit=1&level=all&x=${i}`);
    await call('POST', '/api/auth/users', { username: `burst-${i}`, password: 'Burst!2026-xx', role: 'viewer' });
  }
  await wait(2000);
  const bursts = box.events.filter((e) => e.event === 'changed' && e.data?.topic === 'logs');
  check('دوازده نوشتن ⇒ حداکثر سه پیام', bursts.length > 0 && bursts.length <= 3, `${bursts.length} پیام`);

  console.log('\n── ۵) فهرستِ موضوع‌ها بسته است ──');
  const marks = await call('GET', '/api/live/marks');
  check('مهرها خوانده می‌شوند', marks.status === 200 && Array.isArray(marks.body.topics),
    JSON.stringify(marks.body).slice(0, 200));
  check('و «logs» مهر خورده', Number(marks.body.marks?.logs || 0) > 0, JSON.stringify(marks.body.marks));

  const { bump } = await import('../src/live/bus.js');
  let threw = false;
  try { bump('yek-chize-nabude'); } catch { threw = true; }
  check('⛔ موضوعِ ناشناس خطا می‌دهد، نه سکوت', threw);

  box.ctrl.abort();
  await wait(200);
} finally {
  child.kill('SIGTERM');
  await wait(400);
  await fsp.rm(tmp, { recursive: true, force: true });
}

console.log(`\n${failed ? '❌' : '✅'} ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed ? 1 : 0);
