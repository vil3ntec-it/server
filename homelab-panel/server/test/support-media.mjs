// ---------------------------------------------------------------------------
//  رسانهٔ پشتیبانیِ پمپ از پنل — عکس، ویدیو، پیامِ صوتی
//      node test/support-media.mjs
//
//  خواستهٔ صاحب سامانه (۱۴۰۵/۰۷/۱۵): «در چتِ پشتیبانیِ برنامهٔ پمپ عکس، صدا و
//  ویدیو نمی‌رود… ولی روی سرور نماند — سرور فقط به طرفِ دیگر می‌رساند و هر
//  طرف روی دستگاهِ خودش نگه می‌دارد.»
//
//  سرورِ حسابِ ساختگی مو‌به‌مو قاعدهٔ ‎shop/server‎ را دارد: رسانه‌ای که پمپ
//  فرستاده، همان لحظه که مدیر کاملش را گرفت **پاک** می‌شود. پس پنل باید:
//    ۱) پیش از هر درخواست، نسخهٔ خودش را روی دیسک بگردد
//    ۲) دو درخواستِ هم‌زمانِ یک رسانه را یک دانلود کند (تگِ ‎<video>‎)
//    ۳) رسانهٔ خودِ مدیر را هم نگه دارد
//    ۴) بدنهٔ خام و پاسخِ دودویی را دست‌نخورده برساند، و فقط عکس/ویدیو/صدا
//    ۵) پوشه‌اش را کوچک نگه دارد (۱۵ روز و سقفِ حجم)
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PANEL = Number(process.env.TEST_PORT || 4896);
const PUBLIC = PANEL + 1;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'support-media-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 260)}`);
};

// ── ۰) پاک‌سازیِ پوشه — بی سرور ───────────────────────────────────────────
console.log('\n── پوشهٔ رسانه بایگانی نیست ──');
{
  process.env.HLP_DATA_DIR = path.join(tmp, 'unit');
  process.env.HLP_ACCOUNT_API = '0';
  const cache = await import('../src/support-media-cache.js');
  const DAY = 86400e3;
  await cache.writeCached('smd_old', Buffer.alloc(10, 1), 'image/png');
  await cache.writeCached('smd_mid', Buffer.alloc(20, 2), 'audio/webm;codecs=opus');
  await cache.writeCached('smd_new', Buffer.alloc(30, 3), 'video/mp4');
  //  «کهنه» را با خودِ فراداده کهنه می‌کنیم
  const meta = path.join(cache.cacheDir(), 'smd_old.json');
  const m0 = JSON.parse(fs.readFileSync(meta, 'utf8'));
  fs.writeFileSync(meta, JSON.stringify({ ...m0, at: Date.now() - 16 * DAY }));
  const hit = await cache.readCached('smd_mid');
  check('mime بی پارامتر نشست (audio/webm)', hit?.mime === 'audio/webm' && hit?.size === 20, JSON.stringify(hit));
  check('شناسهٔ ناامن هیچ‌وقت مسیر نمی‌شود', (await cache.readCached('../x')) === null && (await cache.writeCached('a/b', Buffer.from('x'), 'image/png')) === null);
  const s1 = await cache.sweepCache();
  check('کهنه‌تر از ۱۵ روز رفت، بقیه ماندند', s1.removed === 1 && !(await cache.readCached('smd_old')) && !!(await cache.readCached('smd_new')), JSON.stringify(s1));
  const s2 = await cache.sweepCache({ maxBytes: 35 });
  check('بالای سقفِ حجم ⇒ کهنه‌ترها اول', s2.removed === 1 && !(await cache.readCached('smd_mid')) && !!(await cache.readCached('smd_new')) && s2.bytes === 30, JSON.stringify(s2));
  check('فایلِ فراداده هم رفت', !fs.existsSync(path.join(cache.cacheDir(), 'smd_mid.json')));
}

// ── ۱) سرورِ حسابِ ساختگی — قاعدهٔ رلهٔ ‎shop/server‎ ─────────────────────
const media = new Map();       // mid ⇒ { thread, uploader, mime, data }
const fetches = new Map();     // mid ⇒ شمارِ GET
const posts = [];              // پیام‌هایی که رسید
const uploads = [];            // { thread, mime, size }
let seq = 0;
media.set('smd_user1', { thread: 'th2', uploader: 'user', mime: 'image/jpeg', data: Buffer.from('jpeg-from-the-pump-computer') });
media.set('smd_vid1', { thread: 'th2', uploader: 'user', mime: 'video/mp4', data: Buffer.alloc(4096, 7) });

const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, version: '9.9.9' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: Date.now() + 12 * 3600e3 });
    if (String(req.headers.authorization || '') !== 'Bearer tok-1') return j(401, { error: { code: 'unauthorized', message: 'x' } });
    let m;
    if ((m = /^\/api\/admin\/support\/threads\/([^/]+)\/media$/.exec(p)) && req.method === 'POST') {
      const mime = String(req.headers['content-type'] || '');
      uploads.push({ thread: m[1], mime, size: raw.length });
      if (!/^(image|video|audio)\//.test(mime)) return j(400, { error: { code: 'bad_media', message: 'فقط عکس، ویدیو و صدا' } });
      const mid = `smd_adm${++seq}`;
      media.set(mid, { thread: m[1], uploader: 'admin', mime: mime.split(';')[0], data: raw });
      return j(201, { ok: true, mediaId: mid, kind: mime.split('/')[0], mime: mime.split(';')[0], size: raw.length });
    }
    if ((m = /^\/api\/admin\/support\/media\/([^/]+)$/.exec(p)) && req.method === 'GET') {
      fetches.set(m[1], (fetches.get(m[1]) || 0) + 1);
      const row = media.get(m[1]);
      if (!row) return j(404, { error: { code: 'media_gone', message: 'رسانه منقضی شد' } });
      res.setHeader('content-type', row.mime);
      res.setHeader('content-length', String(row.data.length));
      //  ⛔ همان قاعده: مدیر گیرندهٔ رسانهٔ پمپ است ⇒ پس از رسیدن پاک
      res.on('finish', () => { if (row.uploader === 'user') media.delete(m[1]); });
      //  کمی دیر، تا دو درخواستِ هم‌زمانِ پنل واقعاً هم‌زمان باشند
      return setTimeout(() => res.end(row.data), 120);
    }
    if ((m = /^\/api\/admin\/support\/threads\/([^/]+)\/messages$/.exec(p)) && req.method === 'POST') {
      const body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
      posts.push({ thread: m[1], body });
      return j(201, { message: { id: `msg${posts.length}`, threadId: m[1], sender: 'admin', body: body.body || '', kind: body.kind || 'text', mediaId: body.mediaId || null, createdAt: Date.now() } });
    }
    return j(404, { error: { code: 'not_found', message: 'این مسیر وجود ندارد' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const FAKE_URL = `http://127.0.0.1:${fake.address().port}`;

// ── ۲) خودِ پنل ─────────────────────────────────────────────────────────────
const DATA = path.join(tmp, 'data');
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: DATA, HLP_SITES_ROOT: path.join(tmp, 'sites'),
         HLP_SITESYNC: '1', HLP_SITESYNC_PORT: String(PUBLIC),
         HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_ACCOUNT_AUTOSTART: '0',
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
  try { json = await res.json(); } catch { /* نه JSON */ }
  return { status: res.status, json };
}
async function bytes(p, headers = {}) {
  const res = await fetch(BASE + p, { headers });
  return { status: res.status, type: res.headers.get('content-type'), buf: Buffer.from(await res.arrayBuffer()), headers: res.headers };
}

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await api('POST', '/api/auth/setup', { username: 'admin', password: 'Media-1405-test' });
  const login = await api('POST', '/api/auth/login', { username: 'admin', password: 'Media-1405-test' });
  const token = login.json?.token;
  const auth = { Authorization: `Bearer ${token}` };
  check('ورود به پنل', Boolean(token));
  const cacheFile = (mid) => path.join(DATA, 'support-media', mid);

  console.log('\n── رسانهٔ پمپ ⇒ مدیر: یک دانلود، بعد از دیسکِ خودِ پنل ──');
  const [a, b] = await Promise.all([
    bytes('/api/account-admin/support/media/smd_user1', auth),
    bytes('/api/account-admin/support/media/smd_user1', auth),
  ]);
  const want = Buffer.from('jpeg-from-the-pump-computer');
  check('هر دو درخواستِ هم‌زمان همان بایت‌ها', a.status === 200 && b.status === 200 && a.buf.equals(want) && b.buf.equals(want), `${a.status} ${b.status}`);
  check('Content-Type همان mimeِ رسانه', a.type === 'image/jpeg', a.type);
  check('⛔ از سرورِ حساب فقط **یک** بار گرفته شد', fetches.get('smd_user1') === 1, String(fetches.get('smd_user1')));
  check('روی سرورِ حساب دیگر نیست (رله)', !media.has('smd_user1'));
  check('روی دیسکِ پنل نشست', fs.existsSync(cacheFile('smd_user1')) && fs.readFileSync(cacheFile('smd_user1')).equals(want));
  const again = await bytes('/api/account-admin/support/media/smd_user1', auth);
  check('بارِ سوم از دیسک — سرورِ حساب دوباره پرسیده نشد', again.status === 200 && again.buf.equals(want) && fetches.get('smd_user1') === 1);

  const viaQuery = await bytes(`/api/account-admin/support/media/smd_user1?token=${encodeURIComponent(token)}`);
  check('با ‎?token=‎ هم (برای ‎<img>‎ و ‎<video>‎)', viaQuery.status === 200 && viaQuery.buf.equals(want), String(viaQuery.status));
  const anon = await bytes('/api/account-admin/support/media/smd_user1');
  check('بی ورود ⇒ ۴۰۱', anon.status === 401);

  const vid = await bytes('/api/account-admin/support/media/smd_vid1', { ...auth, Range: 'bytes=0-99' });
  check('ویدیو با Range ⇒ ۲۰۶ و فقط همان تکه (پخش و جلو زدن در ‎<video>‎)', vid.status === 206 && vid.buf.length === 100 && vid.headers.get('content-range') === 'bytes 0-99/4096', `${vid.status} ${vid.buf.length} ${vid.headers.get('content-range')}`);
  check('و همان یک دانلود از سرورِ حساب', fetches.get('smd_vid1') === 1);

  const gone = await api('GET', '/api/account-admin/support/media/smd_nothere', undefined, auth);
  check('رسانه‌ای که نه این‌جاست نه آن‌جا ⇒ ۴۰۴ِ media_gone', gone.status === 404 && gone.json?.error === 'media_gone', `${gone.status} ${JSON.stringify(gone.json)}`);
  const badId = await api('GET', '/api/account-admin/support/media/..%2Fetc', undefined, auth);
  check('شناسهٔ ناامن ⇒ ۴۰۰، بی درخواست به سرورِ حساب', badId.status === 400 && !fetches.has('../etc'), String(badId.status));

  console.log('\n── مدیر ⇒ پمپ: بدنهٔ خام، و نسخهٔ خودِ مدیر ──');
  const voice = Buffer.from('OggS-voice-of-the-admin');
  const up = await fetch(`${BASE}/api/account-admin/support/threads/th2/media`, {
    method: 'POST', headers: { ...auth, 'content-type': 'audio/webm;codecs=opus' }, body: voice,
  });
  const upJson = await up.json();
  check('بارگذاری ⇒ ۲۰۱ با mediaId', up.status === 201 && /^smd_adm/.test(upJson?.mediaId || ''), `${up.status} ${JSON.stringify(upJson)}`);
  check('بایت‌ها دست‌نخورده و با همان Content-Type به سرورِ حساب رسید',
    uploads.at(-1)?.size === voice.length && uploads.at(-1)?.mime === 'audio/webm' && media.get(upJson.mediaId)?.data.equals(voice), JSON.stringify(uploads.at(-1)));
  check('نسخهٔ مدیر روی دیسکِ پنل هم هست', fs.existsSync(cacheFile(upJson.mediaId)));
  const own = await bytes(`/api/account-admin/support/media/${upJson.mediaId}`, auth);
  check('حبابِ «من» رسانه‌اش را از دیسک می‌گیرد — نه از سرورِ حساب', own.status === 200 && own.buf.equals(voice) && !fetches.has(upJson.mediaId));

  const msg = await api('POST', '/api/account-admin/support/threads/th2/messages', { kind: 'audio', mediaId: upJson.mediaId, body: '' }, auth);
  check('پیامِ رسانه‌ای ⇒ body · kind · mediaId به سرورِ حساب', msg.status === 200 && posts.at(-1)?.body?.kind === 'audio' && posts.at(-1)?.body?.mediaId === upJson.mediaId, JSON.stringify(posts.at(-1)));
  const txt = await api('POST', '/api/account-admin/support/threads/th2/messages', { body: 'سلام', kind: 'text', mediaId: 'x' }, auth);
  check('پیامِ متنی فقط body می‌برد', txt.status === 200 && JSON.stringify(posts.at(-1)?.body) === JSON.stringify({ body: 'سلام' }), JSON.stringify(posts.at(-1)));
  const badMid = await api('POST', '/api/account-admin/support/threads/th2/messages', { kind: 'image', mediaId: '../x' }, auth);
  check('شناسهٔ رسانهٔ ناامن ⇒ ۴۰۰', badMid.status === 400);

  const before = uploads.length;
  const pdf = await fetch(`${BASE}/api/account-admin/support/threads/th2/media`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/pdf' }, body: Buffer.from('%PDF'),
  });
  const pdfJson = await pdf.json();
  check('⛔ فقط عکس/ویدیو/صدا — PDF ⇒ ۴۰۰ِ bad_media و به سرورِ حساب نرسید', pdf.status === 400 && pdfJson.error === 'bad_media' && uploads.length === before, `${pdf.status} ${JSON.stringify(pdfJson)}`);
  const big = await fetch(`${BASE}/api/account-admin/support/threads/th2/media`, {
    method: 'POST', headers: { ...auth, 'content-type': 'video/mp4' }, body: Buffer.alloc(25 * 1024 * 1024 + 1),
  });
  const bigJson = await big.json().catch(() => ({}));
  check('بزرگ‌تر از ۲۵ مگابایت ⇒ ۴۱۳ِ too_large', big.status === 413 && bigJson.error === 'too_large' && uploads.length === before, `${big.status} ${JSON.stringify(bigJson)}`);

  //  ⛔ نقش: بینندهٔ پنل رسانه نمی‌فرستد
  await api('POST', '/api/auth/users', { username: 'viewer1', password: 'Viewer-1405-test', role: 'viewer' }, auth);
  const vLogin = await api('POST', '/api/auth/login', { username: 'viewer1', password: 'Viewer-1405-test' });
  const vAuth = { Authorization: `Bearer ${vLogin.json?.token}` };
  const vUp = await fetch(`${BASE}/api/account-admin/support/threads/th2/media`, {
    method: 'POST', headers: { ...vAuth, 'content-type': 'image/png' }, body: Buffer.from('png'),
  });
  check('⛔ بیننده (viewer) نمی‌تواند رسانه بفرستد (۴۰۳)', vUp.status === 403 && uploads.length === before, String(vUp.status));
  const vGet = await bytes('/api/account-admin/support/media/smd_user1', vAuth);
  check('ولی دیدن برایش باز است', vGet.status === 200);
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  server.kill('SIGTERM');
  try { fake.close(); } catch { /* بسته */ }
  await new Promise((r) => setTimeout(r, 400));
  await fsp.rm(tmp, { recursive: true, force: true });
}

if (fail) console.log('\n' + out.slice(-1500));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
