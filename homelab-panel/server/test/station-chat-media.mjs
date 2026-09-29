// ---------------------------------------------------------------------------
//  رسانهٔ «گروهِ کارکنان»: عکس، ویدیو و صدا — فقط در عبور (۴۸ ساعت)
//      node test/station-chat-media.mjs
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4951);
const SYNC_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const PUBLIC = `http://127.0.0.1:${SYNC_PORT}`;
const KEEP = 60;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-station-chat-media-'));
const dataDir = path.join(tmp, 'data');
const root = path.join(dataDir, 'stations');

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
let child = null;
let serverOut = '';

function boot(extraEnv = {}) {
  serverOut = '';
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', serverPath], {
    env: {
      ...process.env,
      HLP_PORT: String(PORT),
      HLP_SITESYNC_PORT: String(SYNC_PORT),
      HLP_HOST: '127.0.0.1',
      HLP_DATA_DIR: dataDir,
      HLP_SITES_ROOT: path.join(tmp, 'sites'),
      HLP_TUNNEL: '0',
      HLP_ACCOUNT_AUTOSTART: '0',
      HLP_METRICS_INTERVAL: '5000',
      HLP_CHAT_KEEP: String(KEEP),
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => (serverOut += d));
  child.stderr.on('data', (d) => (serverOut += d));
}

async function stop() {
  if (!child) return;
  const c = child;
  child = null;
  const gone = new Promise((r) => c.once('exit', r));
  c.kill('SIGTERM');
  await Promise.race([gone, new Promise((r) => setTimeout(r, 3000))]);
  if (c.exitCode === null && c.signalCode === null) {
    c.kill('SIGKILL');
    await Promise.race([gone, new Promise((r) => setTimeout(r, 2000))]);
  }
}

async function waitForServer(timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await fetch(`${BASE}/health`)).ok && (await fetch(`${PUBLIC}/health`)).ok) return true;
    } catch { /* هنوز بالا نیامده */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function api(method, url, body, headers = {}) {
  const res = await fetch(url.startsWith('http') ? url : BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch { /* بدنهٔ غیرِ JSON */ }
  return { status: res.status, json, headers: res.headers };
}

const bearer = (k) => ({ Authorization: `Bearer ${k}` });
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
async function up(base, code, key, mime, buf) {
  const r = await fetch(`${base}/api/stations/${code}/chat/media`, { method: 'POST', headers: { 'Content-Type': mime, ...bearer(key) }, body: buf });
  let j = null; try { j = await r.json(); } catch { /* */ }
  return { status: r.status, json: j };
}
const get = (base, code, key, mid) => fetch(`${base}/api/stations/${code}/chat/media/${mid}`, { headers: bearer(key) });

try {
  boot();
  if (!(await waitForServer())) throw new Error('سرور بالا نیامد:\n' + serverOut);
  const one = await api('POST', '/api/stations/enroll', { code: 'med1', name: 'پمپ یک' });
  const two = await api('POST', '/api/stations/enroll', { code: 'med2', name: 'پمپ دو' });
  const T1 = one.json.token, R1 = one.json.readKey, R2 = two.json.readKey;

  console.log('\n۱) عکس و صدا از هر دو رمز، و پیامِ رسانه');
  const img = await up(BASE, 'med1', R1, 'image/png', PNG);
  check('گوشیِ کارمند (رمزِ خواندن) عکس می‌فرستد', img.status === 201 && img.json?.kind === 'image' && /^m[\w-]{10,}$/.test(img.json.mediaId), JSON.stringify(img.json));
  check('سرور می‌گوید فقط ۴۸ ساعت می‌ماند', img.json?.keepHours === 48);
  const voice = await up(PUBLIC, 'med1', T1, 'audio/webm;codecs=opus', Buffer.alloc(900, 5));
  check('برنامهٔ کامپیوتر از پورتِ عمومی صدا می‌فرستد', voice.status === 201 && voice.json?.kind === 'audio', JSON.stringify(voice.json));
  const msg = await api('POST', `/api/stations/med1/chat`, { cid: 'img-1', from: 'کریم', kind: 'image', mediaId: img.json.mediaId }, bearer(R1));
  check('پیامِ عکس بی متن پذیرفته است', msg.status === 200 && msg.json?.message?.kind === 'image' && msg.json.message.mediaId === img.json.mediaId, JSON.stringify(msg.json));
  const list = await api('GET', `/api/stations/med1/chat`, undefined, bearer(T1));
  check('در فهرست همان kind و mediaId می‌آید', list.json?.messages?.[0]?.kind === 'image' && list.json.messages[0].mediaId === img.json.mediaId);
  const g = await get(BASE, 'med1', T1, img.json.mediaId);
  const gb = Buffer.from(await g.arrayBuffer());
  check('برنامهٔ کامپیوتر همان بایت‌ها را می‌گیرد', g.status === 200 && gb.equals(PNG) && g.headers.get('content-type') === 'image/png');
  check('no-store و nosniff', g.headers.get('cache-control') === 'no-store' && g.headers.get('x-content-type-options') === 'nosniff');
  const g2 = await get(BASE, 'med1', R1, img.json.mediaId);
  check('گوشیِ دیگرِ همان گروه هم می‌گیرد (گروه چند گیرنده دارد)', g2.status === 200);

  console.log('\n۲) ⛔ جداسازی و سنجشِ ورودی');
  const cross = await get(BASE, 'med1', R2, img.json.mediaId);
  check('⛔ رمزِ پمپِ دیگر ⇒ ۴۰۴', cross.status === 404);
  const cross2 = await get(BASE, 'med2', R2, img.json.mediaId);
  check('⛔ همان شناسه زیرِ پمپِ دیگر ⇒ ۴۰۴', cross2.status === 404);
  const noKey = await fetch(`${BASE}/api/stations/med1/chat/media/${img.json.mediaId}`);
  check('بی‌رمز ⇒ ۴۰۱', noKey.status === 401);
  const pdf = await up(BASE, 'med1', R1, 'application/pdf', Buffer.alloc(10, 1));
  check('فقط عکس/ویدیو/صدا', pdf.status === 400 && pdf.json?.error === 'bad_type');
  const html = await up(BASE, 'med1', R1, 'text/html', Buffer.from('<script>1</script>'));
  check('HTML رد می‌شود', html.status === 400);
  const emp = await up(BASE, 'med1', R1, 'image/png', Buffer.alloc(0));
  check('فایلِ خالی رد می‌شود', emp.status === 400);
  const bogus = await api('POST', `/api/stations/med1/chat`, { from: 'کریم', kind: 'image', mediaId: 'mAAAAAAAAAAAAAAAAAAAA' }, bearer(R1));
  check('پیام با رسانهٔ نبوده رد می‌شود', bogus.status === 400 && bogus.json?.error === 'media_gone', JSON.stringify(bogus.json));
  const other = await api('POST', `/api/stations/med2/chat`, { from: 'نفوذی', kind: 'image', mediaId: img.json.mediaId }, bearer(R2));
  check('⛔ پمپِ دیگر نمی‌تواند رسانهٔ این پمپ را در پیامش بگذارد', other.status === 400 && other.json?.error === 'media_gone');
  const trav = await get(BASE, 'med1', R1, '..%2Fchat.json');
  check('⛔ نامِ ساختگی (..) هیچ فایلی نمی‌دهد', trav.status === 404);
  check('فایل روی دیسک ۰۶۰۰', process.platform === 'win32' || (fs.statSync(path.join(root, 'med1', 'chat-media', img.json.mediaId)).mode & 0o777) === 0o600);
  await stop();

  console.log('\n۳) ⛔ پس از مهلت از سرور پاک می‌شود');
  boot({ HLP_CHAT_MEDIA_HOURS: '0.0004' });
  if (!(await waitForServer())) throw new Error('بارِ دوم بالا نیامد:\n' + serverOut);
  const fresh = await up(BASE, 'med1', T1, 'video/mp4', Buffer.alloc(3000, 2));
  check('ویدیو بالا رفت', fresh.status === 201 && fresh.json?.kind === 'video');
  await new Promise((r) => setTimeout(r, 1800));
  const late = await get(BASE, 'med1', T1, fresh.json.mediaId);
  check('پس از مهلت ⇒ ۴۰۴ِ media_gone', late.status === 404 && (await late.json()).error === 'media_gone');
  await up(BASE, 'med1', T1, 'image/png', PNG); // هرسِ تنبل با بارگذاریِ بعدی
  const left = fs.readdirSync(path.join(root, 'med1', 'chat-media'));
  check('فایل‌های کهنه واقعاً از دیسک رفتند', !left.some((n) => n.startsWith(fresh.json.mediaId)) && !left.some((n) => n.startsWith(img.json.mediaId)), left.join(','));
} catch (err) {
  failed++;
  console.log('  ❌ ' + (err?.stack || err));
} finally {
  await stop();
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}
console.log(`\n${failed ? '❌' : '✅'} ${passed} موفق، ${failed} ناموفق`);
process.exit(failed ? 1 : 0);
