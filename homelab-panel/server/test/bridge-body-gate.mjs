// ---------------------------------------------------------------------------
//  سقفِ هم‌زمانیِ بدنه‌های بزرگِ پل (۱.۵۰.۷۹، ممیزی §۹: «بی سقفِ سراسری روی خواندنِ هم‌زمانِ بدنه‌های بزرگ»)
//      node test/bridge-body-gate.mjs
//
//  `readCapped` هر بدنه را تا ۳۲ مگابایت نگه می‌داشت ولی **چند** بدنهٔ بزرگِ هم‌زمان سقف نداشت. حالا (`stations/body-gate.js`):
//    • تا ۱ مگابایت آزاد؛ بیش از آن یک «جا» (پیش‌فرض ۴)؛ نبودِ جا ⇒ **صف**، نه شکست؛ فقط صفِ پر ⇒ ‎503 account_server_busy‎؛
//    • مهلت در صف ⇒ همان ‎504 account_server_timeout‎ و بیرون از صف (جا یا صف «نشت» نمی‌کند)؛
//    • ⛔ نوشتن و رسانهٔ یک‌بارمصرفِ پشتیبانی هرگز پشتِ این سقف نمی‌روند (حتی وقتی همه‌چیز پر است).
//  بخشِ ۱ خودِ دروازه (بی پنل)؛ بخشِ ۲ پنلِ واقعی با ‎HLP_BRIDGE_BODY_SLOTS=1‎ و ‎HLP_BRIDGE_BODY_QUEUE=1‎.
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PANEL = Number(process.env.TEST_PORT || 4969);
const MiB = 1024 * 1024;
const BIG = 3 * MiB;          //  بالای ۱ مگابایتِ آزاد، زیرِ سقفِ ۳۲
const TIMEOUT = 4000;         //  ‎HLP_BRIDGE_TIMEOUT_MS‎ ِ پنلِ آزمون
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'bridge-gate-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 400)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settledSoon = (p, ms) => Promise.race([p.then(() => true, () => true), sleep(ms).then(() => false)]);

/* ───────────── بخشِ ۱: خودِ دروازه ───────────── */
console.log('── دروازه (بی پنل) ──');
const mod = await import('../src/stations/body-gate.js').catch(() => null);
check('پروندهٔ دروازه هست (`stations/body-gate.js`)', !!mod);
if (mod) {
  const { makeBodyGate, bodyGateConfig, BODY_FREE_BYTES, BODY_SLOTS, BODY_QUEUE } = mod;
  check('پیش‌فرض‌ها: ۱ مگابایت آزاد، ۴ جا، صفِ ۱۲۸', BODY_FREE_BYTES === MiB && BODY_SLOTS === 4 && BODY_QUEUE === 128);
  const g = makeBodyGate({ slots: 2, queue: 2 });
  const r1 = await g.acquire();
  const r2 = await g.acquire();
  const order = [];
  const p3 = g.acquire().then((r) => { order.push(3); return r; });
  const p4 = g.acquire().then((r) => { order.push(4); return r; });
  const e5 = await g.acquire().then(() => null, (e) => e);
  check('دو جا همان دم؛ سوم و چهارم در صف (منتظر، نه رد)؛ پنجم ⇒ `busy`',
    g.stats().inUse === 2 && g.stats().waiting === 2 && e5?.busy === true && !(await settledSoon(p3, 30)), JSON.stringify(g.stats()));
  r1();
  const r3 = await p3;
  check('رها کردن ⇒ جا مستقیم به نخستینِ صف (به ترتیب)', order.join() === '3' && g.stats().inUse === 2 && g.stats().waiting === 1, `${order} ${JSON.stringify(g.stats())}`);
  r1();
  check('رها کردنِ دوباره بی‌اثر است (جای دوم نمی‌سازد)', order.join() === '3' && g.stats().inUse === 2 && g.stats().waiting === 1, JSON.stringify(g.stats()));
  r2();
  const r4 = await p4;
  //  منتظرِ بریده ⇒ بیرون از صف، با دلیلِ همان signal
  const ac = new AbortController();
  const p6 = g.acquire(ac.signal).then(() => null, (e) => e);
  const p7 = g.acquire().then((r) => r);
  ac.abort(Object.assign(new Error('t'), { name: 'TimeoutError' }));
  const e6 = await p6;
  check('منتظری که مهلتش رسید از صف بیرون می‌رود (خطای همان signal، نه busy)', e6?.name === 'TimeoutError' && !e6?.busy && g.stats().waiting === 1, JSON.stringify(g.stats()));
  r3();
  const r7 = await p7;
  check('…و جایش به منتظرِ بعدی رسید، نه به بریده', g.stats().inUse === 2 && g.stats().waiting === 0);
  const pre = new AbortController();
  pre.abort(Object.assign(new Error('x'), { name: 'AbortError' }));
  const e8 = await g.acquire(pre.signal).then(() => null, (e) => e);
  check('signal ِ از پیش بریده ⇒ همان دم رد، بی جا و بی صف', e8?.name === 'AbortError' && g.stats().inUse === 2 && g.stats().waiting === 0);
  r4(); r7();
  check('همه رها ⇒ صفر جا، صفر صف', g.stats().inUse === 0 && g.stats().waiting === 0, JSON.stringify(g.stats()));
  //  ‎ctx‎ ِ پیش‌فرضِ `readBody` ‎signal‎ ِ ساده دارد (‎{ aborted: false }‎) — نه خطا، همان جا/صف
  const q1 = await g.acquire({ aborted: false });
  const q2 = await g.acquire({ aborted: false });
  const pq = g.acquire({ aborted: false });
  q1();
  const q3 = await pq.catch((e) => e);
  check('‎signal‎ ِ سادهٔ بی ‎addEventListener‎ ⇒ همان جا و صف، بی خطا', typeof q3 === 'function' && g.stats().inUse === 2, String(q3?.message || ''));
  q2();
  if (typeof q3 === 'function') q3();
  const z = makeBodyGate({ slots: 1, queue: 0 });
  const z1 = await z.acquire();
  const ze = await z.acquire().then(() => null, (e) => e);
  z1();
  check('صفِ صفر ⇒ بیش از جاها همان دم `busy`', ze?.busy === true && z.stats().inUse === 0);
  const env = (s, q) => { process.env.HLP_BRIDGE_BODY_SLOTS = s; process.env.HLP_BRIDGE_BODY_QUEUE = q; return bodyGateConfig(); };
  const c1 = env('0', '-1'), c2 = env('65', '5000'), c3 = env('2.5', 'x'), c4 = env('8', '0'), c5 = env('64', '4096');
  delete process.env.HLP_BRIDGE_BODY_SLOTS; delete process.env.HLP_BRIDGE_BODY_QUEUE;
  check('محیط: بیرونِ بازه یا ناعدد ⇒ پیش‌فرض؛ ‎1..64‎ و ‎0..4096‎ پذیرفته',
    c1.slots === 4 && c1.queue === 128 && c2.slots === 4 && c2.queue === 128 && c3.slots === 4 && c3.queue === 128
      && c4.slots === 8 && c4.queue === 0 && c5.slots === 64 && c5.queue === 4096, JSON.stringify([c1, c2, c3, c4, c5]));
}

/* ───────────── بخشِ ۲: پنلِ واقعی، سرورِ حسابِ ساختگی ───────────── */
const NOW = Date.now();
const seen = [];
const held = new Map();        //  نام ⇒ res ِ بدنهٔ نیمه‌کاره
const open = new Set();
let overviewBig = false;
const PNG = Buffer.alloc(BIG, 0x50);

const fake = http.createServer((req, res) => {
  open.add(res);
  res.on('close', () => open.delete(res));
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', async () => {
    const p = new URL(req.url, 'http://x').pathname;
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, version: '9.9.9' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: ['actor.v1'], serverTime: NOW });
    seen.push({ method: req.method, path: p, at: Date.now() });
    if (p === '/api/admin/overview') {
      //  JSON ِ بزرگِ بی‌طول (۲ مگابایت) ⇒ راهِ «گذشتن از آزاد» ِ JSON
      if (overviewBig) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ shops: 4, users: 6, pad: 'x'.repeat(2 * MiB) })); }
      return j(200, { shops: 3, users: 5 });
    }
    const f = /^\/api\/admin\/image-bank\/file\/([A-Za-z0-9_-]+)\/1\/original$/.exec(p);
    if (f) {
      const id = f[1];
      if (id.startsWith('slow')) await sleep(1000);     //  سرآیندِ دیرکرده ⇒ دیرتر به صف می‌رسد
      if (id.startsWith('chunk')) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(BIG) });
      if (id.startsWith('hold')) { res.write(PNG.subarray(0, MiB + MiB / 2)); held.set(id, res); return; }
      return res.end(PNG);
    }
    const md = /^\/api\/admin\/support\/media\/([^/]+)$/.exec(p);
    if (md) { res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(BIG) }); return res.end(PNG); }
    const st = /^\/api\/admin\/support\/threads\/([^/]+)\/status$/.exec(p);
    if (st && req.method === 'POST') return j(200, { ok: true, id: st[1], status: 'closed', pad: 'y'.repeat(2 * MiB) });
    return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const finish = (id) => { const r = held.get(id); held.delete(id); r?.end(PNG.subarray(MiB + MiB / 2)); };

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_SITESYNC: '0',
         HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_AUTOMATION: '0', HLP_STATIONS: '0',
         HLP_ACCOUNT_API: `http://127.0.0.1:${fake.address().port}`, HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret',
         HLP_AUTH_RATE_LIMIT: '100000', HLP_TG_WATCH_MS: '0', HLP_TG_LONGPOLL: '0',
         HLP_BRIDGE_BODY_SLOTS: '1', HLP_BRIDGE_BODY_QUEUE: '1', HLP_BRIDGE_TIMEOUT_MS: String(TIMEOUT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const BASE = `http://127.0.0.1:${PANEL}`;
async function api(method, p, body, headers = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const buf = Buffer.from(await res.arrayBuffer());
    let json = null;
    try { json = JSON.parse(buf.toString()); } catch { json = null; }
    return { status: res.status, json, text: buf.length < 4096 ? buf.toString() : `<${buf.length} bytes>`, bytes: buf.length, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, json: null, text: String(e?.name || e), bytes: 0, ms: Date.now() - t0 };
  }
}
const sawPath = async (suffix, ms = 3000) => {
  for (let t = 0; t < ms; t += 20) { if (seen.some((s) => s.path.endsWith(suffix))) return true; await sleep(20); }
  return false;
};
const FILE = (id) => `/api/account-admin/console/image-bank/file/${id}/1/original`;

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await sleep(250);
  }
  await api('POST', '/api/auth/setup', { username: 'owner', password: 'Gate-1405-owner' });
  const login = async (u, pw) => (await api('POST', '/api/auth/login', { username: u, password: pw })).json?.token;
  const owner = await login('owner', 'Gate-1405-owner');
  const H = (t) => ({ Authorization: `Bearer ${t}` });
  await api('POST', '/api/auth/users', { username: 'view1', password: 'Gate-viewer-1405', role: 'viewer' }, H(owner));
  const view = await login('view1', 'Gate-viewer-1405');

  const warm = await api('GET', FILE('warm1'), undefined, H(view));
  check('پیش‌زمینه: عکسِ ۳ مگابایتیِ بانک تنها و کامل می‌رسد', warm.status === 200 && warm.bytes === BIG, `${warm.status} ${warm.text.slice(0, 200)}`);

  console.log('\n── یک جا، یک صف: صبر، نه شکست ──');
  const pA = api('GET', FILE('holdA'), undefined, H(view));
  await sawPath('/holdA/1/original');
  await sleep(150);
  const pB = api('GET', FILE('imgB'), undefined, H(view));
  await sawPath('/imgB/1/original');
  const bDone = await settledSoon(pB, 400);
  check('⛔ دومین بدنهٔ بزرگ (جا پُر) منتظر می‌ماند — نه شکست، نه گذشتن از سقف', !bDone);
  const c = await api('GET', FILE('imgC'), undefined, H(view));
  check('⛔ صفِ پر ⇒ ‎503 account_server_busy‎ همان دم، با «دوباره بخوانید» — نه ۵۰۲، نه «نامعلوم»',
    c.status === 503 && c.json?.error === 'account_server_busy' && c.json?.outcome === undefined && /دوباره/.test(c.json?.message || '') && c.ms < 2000,
    `${c.status} ${c.ms}ms ${c.text.slice(0, 200)}`);
  const d = await api('GET', FILE('chunkD'), undefined, H(view));
  check('⛔ بدنهٔ بی‌طول که از ۱ مگابایت گذشت هم همان ‎503‎ (راهِ «در میانهٔ خواندن»)', d.status === 503 && d.json?.error === 'account_server_busy', `${d.status} ${d.text.slice(0, 200)}`);
  overviewBig = true;
  const jb = await api('GET', '/api/account-admin/overview', undefined, H(view));
  overviewBig = false;
  check('⛔ JSON ِ ۲ مگابایتی ِ خواندن هم همان ‎503‎', jb.status === 503 && jb.json?.error === 'account_server_busy', `${jb.status} ${jb.text.slice(0, 200)}`);
  const small = await api('GET', '/api/account-admin/overview', undefined, H(view));
  check('JSON ِ کوچک (زیرِ ۱ مگابایت) با دروازهٔ پر هم همان دم می‌رسد', small.status === 200 && small.json?.shops === 3, `${small.status} ${small.text.slice(0, 200)}`);
  const media = await api('GET', '/api/account-admin/support/media/m1', undefined, H(view));
  check('⛔ رسانهٔ یک‌بارمصرفِ پشتیبانی (۳ مگابایت) با دروازهٔ پر هم کامل می‌رسد — نه صف، نه ‎503‎ (سرورِ حساب پس از فرستادن پاکش می‌کند)',
    media.status === 200 && media.bytes === BIG, `${media.status} ${media.text.slice(0, 200)}`);
  const w = await api('POST', '/api/account-admin/support/threads/t1/status', { status: 'closed' }, H(owner));
  check('⛔ نوشتن با پاسخِ ۲ مگابایتی با دروازهٔ پر هم «انجام شد» — نه ‎503‎، نه «نامعلوم» ِ خودساخته',
    w.status === 200 && w.json?.ok === true && w.json?.pad?.length === 2 * MiB, `${w.status} ${w.text.slice(0, 200)}`);
  check('…و تا این‌جا دومی هنوز در صف است', !(await settledSoon(pB, 10)));
  finish('holdA');
  const [a, b] = await Promise.all([pA, pB]);
  check('رها شدنِ جا ⇒ اولی و سپس دومیِ در صف هر دو کامل (۲۰۰، ۳ مگابایت)', a.status === 200 && a.bytes === BIG && b.status === 200 && b.bytes === BIG,
    `${a.status}/${a.bytes} ${b.status}/${b.bytes} ${b.text.slice(0, 160)}`);
  const [e1, e2] = await Promise.all([api('GET', FILE('imgE1'), undefined, H(view)), api('GET', FILE('imgE2'), undefined, H(view))]);
  overviewBig = true;
  const jb2 = await api('GET', '/api/account-admin/overview', undefined, H(view));
  overviewBig = false;
  check('پس از آن: دو بدنهٔ بزرگِ هم‌زمان (یکی در صف) و JSON ِ بزرگ همه ۲۰۰ — جا نشت نکرد',
    e1.status === 200 && e1.bytes === BIG && e2.status === 200 && e2.bytes === BIG && jb2.status === 200 && jb2.json?.shops === 4,
    `${e1.status} ${e2.status} ${jb2.status}`);

  console.log('\n── مهلت در صف ──');
  const t0 = Date.now();
  const pW = api('GET', FILE('slowW'), undefined, H(view));        //  سرآیندش یک ثانیه دیر ⇒ پس از H به صف می‌رسد
  await sleep(300);
  const pH = api('GET', FILE('holdH'), undefined, H(view));        //  جا را می‌گیرد و تا مهلتِ خودش نگه می‌دارد
  await sawPath('/holdH/1/original');
  await sleep(1200);
  const x = await api('GET', FILE('imgX'), undefined, H(view));
  check('صف با منتظرِ دیررسیده پر است ⇒ سومی ‎503‎', x.status === 503 && x.json?.error === 'account_server_busy', `${x.status} ${x.text.slice(0, 160)}`);
  const wr = await pW;
  const wAt = Date.now() - t0;
  check(`⛔ منتظری که مهلتش (${TIMEOUT / 1000} ثانیه) در صف رسید ⇒ ‎504 account_server_timeout‎ (تکرارپذیر) — نه آویزان، نه ‎503‎`,
    wr.status === 504 && wr.json?.error === 'account_server_timeout' && wAt >= TIMEOUT - 300 && wAt < TIMEOUT + 2500, `${wr.status} ${wAt}ms ${wr.text.slice(0, 160)}`);
  const hr = await pH;
  check('دارندهٔ جا که بدنه‌اش نیمه ماند ⇒ همان مهلتِ خودش (۵۰۴)', hr.status === 504 && hr.json?.error === 'account_server_timeout', `${hr.status} ${hr.text.slice(0, 160)}`);
  const [y1, y2] = await Promise.all([api('GET', FILE('imgY1'), undefined, H(view)), api('GET', FILE('imgY2'), undefined, H(view))]);
  check('پس از مهلت‌ها: جا و صف آزاد شدند (دو بدنهٔ بزرگِ تازه هر دو ۲۰۰)', y1.status === 200 && y1.bytes === BIG && y2.status === 200 && y2.bytes === BIG,
    `${y1.status} ${y2.status}`);
  check('پنل یک بار (نه سیل) در گزارش گفت صف پر است', (out.match(/صفِ بدنه‌های بزرگِ پل پر است/g) || []).length === 1, (out.match(/\[bridge\][^\n]*/g) || []).join(' | '));
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  server.kill('SIGTERM');
  for (const r of open) r.destroy();
  fake.close();
  await sleep(400);
  await fsp.rm(tmp, { recursive: true, force: true });
}

if (fail) console.log('\n' + out.slice(-1500));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
