// ---------------------------------------------------------------------------
//  بدنهٔ پاسخِ پلِ پنل ⇒ سرورِ حساب: سقفِ اندازه، و بدنهٔ بریده/خراب (۱.۵۰.۷۷، بازبینیِ ۱.۵۰.۷۶)
//      node test/bridge-body.mjs
//
//  دو شکافِ `stations/cloud.js` ⇒ `readBody`:
//    ۱) سقف نبود: هر بدنهٔ بالادست (`cloudRawBytes` ِ رسانه/عکس، و JSON) تا هر اندازه در حافظهٔ پنل جمع می‌شد —
//       یک viewer با بازکردنِ یک رسانه می‌توانست پنل را به بافر کردنِ بدنهٔ بی‌سقف وادارد.
//       حالا: جریان با شمارشِ بایت، سقفِ ‎BRIDGE_MAX_BODY_BYTES‎ (۳۲ مگابایت، بالای ۲۵ مگابایتِ رسانهٔ پشتیبانی)؛
//       از سقف گذشت ⇒ خواندن بریده می‌شود و ‎502 account_server_too_large‎.
//    ۲) بدنهٔ ۲xx که با افتادنِ اتصال نیمه ماند یا JSON نبود «‎{}‎ ِ موفق» خوانده می‌شد. حالا:
//       خواندن ⇒ ‎502 account_server_bad_response‎؛ نوشتن ⇒ ‎502 outcome_unknown‎ (`outcome: 'unknown'`، ردیفِ دفتر) —
//       همان قاعدهٔ مهلتِ پل. پاسخِ غیرِ ۲xx همچنان با «وضعیتِ خودش» (۴۰۴ ِ HTML نامعلوم نیست)، و ۲۰۴ همان «انجام شد».
//    ۳) (۱.۵۰.۷۸، بازبینیِ ۱.۵۰.۷۷) بدنهٔ فشرده: ‎content-length‎ اندازهٔ **فشرده** است و ‎fetch‎ خودش ‎gzip/br‎ را باز می‌کند —
//       سقف روی بایتِ بازشده است، پس «بمبِ» چند ده کیلوبایتی هم پیش از گذشتن از سقف بریده می‌شود (شکاف نبود؛ شاهدِ ماندگار).
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const PANEL = Number(process.env.TEST_PORT || 4979);
const MiB = 1024 * 1024;
const CAP = 32 * MiB;   //  همان ‎BRIDGE_MAX_BODY_BYTES‎ ِ cloud.js
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'bridge-body-'));
//  «بمبِ» فشرده: چند ده کیلوبایت که به سقف + ۸ مگابایت باز می‌شود
const BOMB_RAW = Buffer.alloc(CAP + 8 * MiB, 0x20);
const BOMB_GZ = zlib.gzipSync(BOMB_RAW, { level: 9 });
const BOMB_BR = zlib.brotliCompressSync(BOMB_RAW);

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 400)}`);
};

/* ───────────── سرورِ حسابِ ساختگی که بدنهٔ بد می‌فرستد ───────────── */
const NOW = Date.now();
const seen = [];
const sent = {};          //  نام ⇒ بایتی که واقعاً پیش از بسته‌شدنِ اتصال نوشته شد
let overview = 'ok';
const held = new Set();

/** بدنهٔ بزرگ با رعایتِ فشارِ پشتی — اگر پنل خواندن را ببُرد، نوشتن همان‌جا می‌ایستد */
function stream(res, name, total, { length = false, type = 'application/octet-stream' } = {}) {
  res.writeHead(200, { 'content-type': type, ...(length ? { 'content-length': String(total) } : {}) });
  const chunk = Buffer.alloc(256 * 1024, 0x61);
  let written = 0;
  let closed = false;
  sent[name] = 0;
  res.on('close', () => { closed = true; sent[name] = written; });
  const pump = () => {
    while (!closed && written < total) {
      const n = Math.min(chunk.length, total - written);
      written += n;
      if (!res.write(n === chunk.length ? chunk : chunk.subarray(0, n))) return void res.once('drain', pump);
    }
    if (!closed) { res.end(); sent[name] = written; }
  };
  pump();
}
/** سرآیندِ ۲۰۰ و تکه‌ای از بدنه، بعد اتصال می‌افتد */
function cut(res, type, part, length = 4096) {
  res.writeHead(200, { 'content-type': type, 'content-length': String(length) });
  res.write(part);
  setTimeout(() => res.socket?.destroy(), 30);
}

const fake = http.createServer((req, res) => {
  held.add(res);
  res.on('close', () => held.delete(res));
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, version: '9.9.9' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: ['actor.v1'], serverTime: NOW });
    seen.push({ method: req.method, path: p });
    if (p === '/api/admin/overview') {
      if (overview === 'cut') return cut(res, 'application/json', '{"shops":12,"users":');
      if (overview === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html><body>proxy login</body></html>'); }
      if (overview === 'empty') { res.writeHead(200, { 'content-type': 'application/json', 'content-length': '0' }); return res.end(); }
      if (overview === 'big') return stream(res, 'jsonBig', CAP + 4 * MiB, { length: true, type: 'application/json' });
      if (overview === 'bigChunked') return stream(res, 'jsonChunked', CAP * 3, { type: 'application/json' });
      //  ۱.۵۰.۷۸: بدنهٔ فشرده — ‎content-length‎ اندازهٔ فشرده است و ‎fetch‎ خودش باز می‌کند؛ سقف روی بایتِ بازشده
      if (overview === 'gzipOk') { res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }); return res.end(zlib.gzipSync(JSON.stringify({ shops: 7, users: 9 }))); }
      if (overview === 'gzipBomb' || overview === 'brBomb') {
        const z = overview === 'gzipBomb' ? BOMB_GZ : BOMB_BR;
        res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': overview === 'gzipBomb' ? 'gzip' : 'br', 'content-length': String(z.length) });
        return res.end(z);
      }
      if (overview === 'nf') { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<pre>Cannot GET /api/admin/overview</pre>'); }
      return j(200, { shops: 3, users: 5 });
    }
    const st = /^\/api\/admin\/support\/threads\/([^/]+)\/status$/.exec(p);
    if (st && req.method === 'POST') {
      if (st[1] === 'tcut') return cut(res, 'application/json', '{"ok":tr');
      if (st[1] === 'thtml') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>ok?</html>'); }
      if (st[1] === 'tnf') { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<pre>Cannot POST</pre>'); }
      if (st[1] === 'tnone') { res.writeHead(204); return res.end(); }
      return j(200, { ok: true, id: st[1], status: 'closed' });
    }
    const md = /^\/api\/admin\/support\/media\/([^/]+)$/.exec(p);
    if (md) {
      if (md[1] === 'm25') return stream(res, 'm25', 25 * MiB, { length: true, type: 'image/png' });
      if (md[1] === 'mbig') return stream(res, 'mbig', CAP * 3, { type: 'image/png' });
      if (md[1] === 'mdecl') return stream(res, 'mdecl', CAP + MiB, { length: true, type: 'video/mp4' });
      if (md[1] === 'mcut') return cut(res, 'image/png', Buffer.alloc(64 * 1024, 1), MiB);
    }
    if (p === '/api/admin/payments/pcut/receipt') return cut(res, 'text/html; charset=utf-8', '<html><body>رسیدِ نیمه');
    return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

/* ───────────── پنلِ واقعی ───────────── */
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_SITESYNC: '0',
         HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_AUTOMATION: '0', HLP_STATIONS: '0',
         HLP_ACCOUNT_API: `http://127.0.0.1:${fake.address().port}`, HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret',
         HLP_AUTH_RATE_LIMIT: '100000', HLP_TG_WATCH_MS: '0', HLP_TG_LONGPOLL: '0' },
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
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    const buf = Buffer.from(await res.arrayBuffer());
    let json = null;
    try { json = JSON.parse(buf.toString()); } catch { json = null; }
    return { status: res.status, json, text: buf.length < 4096 ? buf.toString() : `<${buf.length} bytes>`, bytes: buf.length, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, json: null, text: String(e?.name || e), bytes: 0, ms: Date.now() - t0 };
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await sleep(250);
  }
  await api('POST', '/api/auth/setup', { username: 'owner', password: 'Body-1405-owner' });
  const login = async (u, pw) => (await api('POST', '/api/auth/login', { username: u, password: pw })).json?.token;
  const owner = await login('owner', 'Body-1405-owner');
  const H = (t) => ({ Authorization: `Bearer ${t}` });
  await api('POST', '/api/auth/users', { username: 'view1', password: 'Body-viewer-1405', role: 'viewer' }, H(owner));
  const view = await login('view1', 'Body-viewer-1405');

  const warm = await api('GET', '/api/account-admin/overview', undefined, H(view));
  check('پیش‌زمینه: پل سالم کار می‌کند', warm.status === 200 && warm.json?.shops === 3, `${warm.status} ${warm.text.slice(0, 200)}`);

  console.log('\n── بدنهٔ بریده یا خراب (۲xx) ──');
  overview = 'cut';
  const rc = await api('GET', '/api/account-admin/overview', undefined, H(view));
  check('⛔ خواندن با بدنهٔ بریده (اتصال وسطِ بدنه افتاد) ⇒ ‎502 account_server_bad_response‎، نه ‎200 {}‎',
    rc.status === 502 && rc.json?.error === 'account_server_bad_response' && rc.json?.outcome === undefined, `${rc.status} ${rc.text.slice(0, 200)}`);
  overview = 'html';
  const rh = await api('GET', '/api/account-admin/overview', undefined, H(view));
  check('⛔ خواندن با ۲۰۰ ِ غیرِ JSON (صفحهٔ HTML ِ واسط) ⇒ ‎502 account_server_bad_response‎', rh.status === 502 && rh.json?.error === 'account_server_bad_response',
    `${rh.status} ${rh.text.slice(0, 200)}`);
  overview = 'empty';
  const re = await api('GET', '/api/account-admin/overview', undefined, H(view));
  check('⛔ خواندن با ۲۰۰ ِ بی‌بدنه ⇒ ‎502‎، نه ‎{}‎ ِ موفق', re.status === 502 && re.json?.error === 'account_server_bad_response', `${re.status} ${re.text.slice(0, 200)}`);
  overview = 'nf';
  const r404 = await api('GET', '/api/account-admin/overview', undefined, H(view));
  check('پاسخِ غیرِ ۲xx با بدنهٔ HTML همان وضعیتِ خودش را نگه می‌دارد (۴۰۴، نه ۵۰۲)', r404.status === 404 && r404.json?.error === 'cloud_error', `${r404.status} ${r404.text.slice(0, 200)}`);
  overview = 'ok';

  const wc = await api('POST', '/api/account-admin/support/threads/tcut/status', { status: 'closed' }, H(owner));
  check('⛔ نوشتن با بدنهٔ بریده ⇒ ‎502 outcome_unknown‎ با ‎outcome: "unknown"‎ — نه «انجام شد» با ‎{}‎',
    wc.status === 502 && wc.json?.error === 'outcome_unknown' && wc.json?.outcome === 'unknown' && /معلوم نیست/.test(wc.json?.message || '') && !/شکست/.test(wc.json?.message || ''),
    `${wc.status} ${wc.text.slice(0, 200)}`);
  const wh = await api('POST', '/api/account-admin/support/threads/thtml/status', { status: 'closed' }, H(owner));
  check('⛔ نوشتن با ۲۰۰ ِ غیرِ JSON ⇒ نامعلوم', wh.status === 502 && wh.json?.error === 'outcome_unknown' && wh.json?.outcome === 'unknown', `${wh.status} ${wh.text.slice(0, 200)}`);
  const wn = await api('POST', '/api/account-admin/support/threads/tnf/status', { status: 'closed' }, H(owner));
  check('نوشتن با ۴۰۴ ِ HTML ⇒ همان ۴۰۴ (رد شده، نه نامعلوم)', wn.status === 404 && wn.json?.outcome === undefined, `${wn.status} ${wn.text.slice(0, 200)}`);
  const w204 = await api('POST', '/api/account-admin/support/threads/tnone/status', { status: 'closed' }, H(owner));
  check('نوشتن با ۲۰۴ (بی‌بدنهٔ قراردادی) ⇒ همچنان «انجام شد»', w204.status === 200, `${w204.status} ${w204.text.slice(0, 200)}`);
  const aud = await api('GET', '/api/control/audit?q=outcome_unknown&limit=20&offset=0', undefined, H(owner));
  const rows = (aud.json?.rows || []).filter((r) => r.action === 'account.bridge.outcome_unknown');
  check('هر نوشتنِ نامعلوم یک ردیف در دفترِ پنل', rows.length === 2 && rows.every((r) => String(r.detail).includes('/status')), JSON.stringify(aud.json?.rows || []).slice(0, 300));

  const rcpt = await api('GET', '/api/account-admin/payments/pcut/receipt', undefined, H(view));
  check('⛔ رسیدِ بریده (متن) ⇒ ‎502‎، نه رسیدِ نیمه‌کارهٔ «موفق»', rcpt.status === 502 && rcpt.json?.error === 'account_server_bad_response', `${rcpt.status} ${rcpt.text.slice(0, 200)}`);
  const mc = await api('GET', '/api/account-admin/support/media/mcut', undefined, H(view));
  check('⛔ رسانهٔ بریده ⇒ ‎502 account_server_bad_response‎ (نه پروندهٔ نیمه روی دیسک)', mc.status === 502 && mc.json?.error === 'account_server_bad_response', `${mc.status} ${mc.text.slice(0, 200)}`);
  const mc2 = await api('GET', '/api/account-admin/support/media/mcut', undefined, H(view));
  check('و چیزی از آن نگه داشته نشد (بارِ دوم دوباره از سرورِ حساب)', mc2.status === 502 && seen.filter((s) => s.path.endsWith('/mcut')).length === 2, `${seen.filter((s) => s.path.endsWith('/mcut')).length}`);

  console.log('\n── سقفِ اندازه ──');
  const m25 = await api('GET', '/api/account-admin/support/media/m25', undefined, H(view));
  check('رسانهٔ ۲۵ مگابایتی (بزرگ‌ترین بارِ درست) هنوز کامل می‌رسد', m25.status === 200 && m25.bytes === 25 * MiB, `${m25.status} ${m25.bytes} ${m25.text.slice(0, 120)}`);
  const mb = await api('GET', '/api/account-admin/support/media/mbig', undefined, H(view));
  await sleep(300);
  check('⛔ رسانهٔ بی‌سقف (۹۶ مگابایت، بی content-length) ⇒ ‎502 account_server_too_large‎', mb.status === 502 && mb.json?.error === 'account_server_too_large' && /مگابایت/.test(mb.json?.message || ''),
    `${mb.status} ${mb.text.slice(0, 200)}`);
  //  شاهدِ بریدن: بایتی که سرورِ حساب پیش از بسته‌شدنِ اتصال واقعاً نوشت (سقف + بافرهای سوکت، نه کلِ ۹۶ مگابایت)
  check('⛔ و پنل خواندن را همان‌جا بُرید (سرورِ حساب کم‌تر از نیمه را نوشت)', sent.mbig > 0 && sent.mbig < CAP * 1.5, `${(sent.mbig / MiB).toFixed(1)} MiB`);
  const md = await api('GET', '/api/account-admin/support/media/mdecl', undefined, H(view));
  check('⛔ ‎content-length‎ ِ بیش از سقف ⇒ همان ۵۰۲، پیش از خواندنِ بدنه', md.status === 502 && md.json?.error === 'account_server_too_large', `${md.status} ${md.text.slice(0, 200)}`);
  overview = 'big';
  const jb = await api('GET', '/api/account-admin/overview', undefined, H(view));
  overview = 'bigChunked';
  const jc = await api('GET', '/api/account-admin/overview', undefined, H(view));
  overview = 'ok';
  await sleep(300);
  check('⛔ JSON ِ بیش از سقف (با و بی content-length) ⇒ ‎502 account_server_too_large‎', jb.status === 502 && jb.json?.error === 'account_server_too_large'
    && jc.status === 502 && jc.json?.error === 'account_server_too_large' && sent.jsonChunked < CAP * 1.5, `${jb.status} ${jc.status} ${(sent.jsonChunked / MiB).toFixed(1)} MiB`);
  console.log('\n── بدنهٔ فشرده (۱.۵۰.۷۸) ──');
  overview = 'gzipOk';
  const gz = await api('GET', '/api/account-admin/overview', undefined, H(view));
  check('بدنهٔ ‎gzip‎ ِ درست همان JSON است', gz.status === 200 && gz.json?.shops === 7, `${gz.status} ${gz.text.slice(0, 160)}`);
  overview = 'gzipBomb';
  const gb = await api('GET', '/api/account-admin/overview', undefined, H(view));
  overview = 'brBomb';
  const bb = await api('GET', '/api/account-admin/overview', undefined, H(view));
  overview = 'ok';
  check(`⛔ بدنهٔ فشردهٔ کوچک (${BOMB_GZ.length} بایتِ ‎gzip‎ · ${BOMB_BR.length} بایتِ ‎br‎) که از سقف بزرگ‌تر باز می‌شود ⇒ ‎502 account_server_too_large‎ — سقف روی بایتِ بازشده است، نه ‎content-length‎`,
    gb.status === 502 && gb.json?.error === 'account_server_too_large' && bb.status === 502 && bb.json?.error === 'account_server_too_large', `${gb.status} ${gb.json?.error} ${bb.status} ${bb.json?.error}`);
  const after = await api('GET', '/api/account-admin/overview', undefined, H(view));
  check('پس از همهٔ این‌ها پل سالم است', after.status === 200 && after.json?.shops === 3, `${after.status}`);
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  server.kill('SIGTERM');
  for (const r of held) r.destroy();
  fake.close();
  await sleep(400);
  await fsp.rm(tmp, { recursive: true, force: true });
}

if (fail) console.log('\n' + out.slice(-1500));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
