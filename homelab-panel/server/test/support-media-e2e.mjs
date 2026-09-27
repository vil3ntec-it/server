// ---------------------------------------------------------------------------
//  رسانهٔ پشتیبانیِ پمپ — روی پشتهٔ واقعی
//      node test/support-media-e2e.mjs          (ریپوی ‎shop‎ کنارِ این ریپو)
//
//  پنلِ خانگیِ واقعی + سرورِ حسابِ واقعی (PGlite) + صندوقِ ایمیلِ ساختگی —
//  همان ‎signup-stack.mjs‎. کامپیوترِ پمپ از **پورتِ عمومی** (همان که تونل
//  می‌بیند) می‌آید و مدیر از پلِ پنل. سنجیده می‌شود:
//
//    ۱) پمپ عکس می‌فرستد ⇒ مدیر می‌گیرد ⇒ **از سرورِ حساب پاک** ⇒ روی دیسکِ پنل
//    ۲) مدیر پیامِ صوتی می‌فرستد ⇒ پمپ می‌گیرد ⇒ از سرورِ حساب پاک؛ نسخهٔ
//       مدیر همچنان از دیسکِ پنل
//    ۳) ویدیوی سه‌مگابایتی از هر دو راه، بایت‌به‌بایت
//
//  ⚠️ در ‎npm test‎ نیست: کدِ سرورِ حساب را از ریپوی کناری می‌خواهد.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = import.meta.dirname;
const live = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'smedia-e2e-')), 'live.json');
const PORT = Number(process.env.TEST_PORT || 4961);

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 300)}`);
};

const stack = spawn(process.execPath, [path.join(here, 'signup-stack.mjs'), live], {
  env: { ...process.env, TEST_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
});
let stackOut = '';
stack.stdout.on('data', (d) => (stackOut += d));
stack.stderr.on('data', (d) => (stackOut += d));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 240 && !fs.existsSync(live); i++) await wait(500);
if (!fs.existsSync(live)) { console.log(stackOut.slice(-2000)); process.exit(1); }
const L = JSON.parse(fs.readFileSync(live, 'utf8'));
console.log(`پشته: سرورِ حساب ${L.accountVersion}`);

async function call(base, method, p, { token = '', body, raw, type } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(raw ? { 'content-type': type } : body !== undefined ? { 'content-type': 'application/json' } : {}),
      'x-app-id': 'tohid-pump-app',
    },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString('utf8')); } catch { /* دودویی */ }
  return { status: res.status, json, buf, type: res.headers.get('content-type') || '' };
}
const pub = (m, p, o) => call(L.public, m, p, o);
const panel = (m, p, o) => call(L.panel, m, p, { token: L.panelToken, ...o });

async function codeFor(email) {
  for (let i = 0; i < 60; i++) {
    const lines = fs.existsSync(L.mailCodes) ? fs.readFileSync(L.mailCodes, 'utf8').trim().split('\n').filter(Boolean) : [];
    const hit = lines.map((l) => JSON.parse(l)).reverse().find((x) => x.to.includes(email) && x.code);
    if (hit) return hit.code;
    await wait(250);
  }
  return '';
}

try {
  // ── کامپیوترِ پمپ: حساب، پمپ، توکنِ دستگاه ─────────────────────────────
  console.log('\n── کامپیوترِ پمپ ──');
  const email = `media-${Date.now()}@example.com`;
  const password = 'Media!1405test';
  const uid = `pc-media-${crypto.randomUUID().slice(0, 8)}`;
  await pub('POST', '/api/auth/register/start', { body: { name: 'پمپِ رسانه', email, password, passwordConfirm: password, app: 'pump' } });
  const code = await codeFor(email);
  const verify = await pub('POST', '/api/auth/register/verify', { body: { email, code, app: 'pump' } });
  const done = await pub('POST', '/api/auth/register/complete', { body: {
    ticket: verify.json?.ticket, name: 'پمپِ رسانه', password,
    terms: { accepted: true, version: verify.json?.terms?.version || '' },
    device: { uid, name: 'E2E', platform: 'windows' }, app: 'pump',
  } });
  const access = done.json?.accessToken || '';
  await pub('POST', '/api/pump', { token: access, body: { name: 'پمپِ رسانه‌ای' } });
  const bind = await pub('POST', '/api/pump/device/bind', { token: access, body: { device: { uid, name: 'E2E', platform: 'windows' } } });
  const dev = bind.json?.deviceToken || bind.json?.token || '';
  check('حساب، پمپ و توکنِ دستگاه از پورتِ عمومی', dev.length > 0, `${bind.status} ${JSON.stringify(bind.json).slice(0, 200)}`);

  // ── ۱) پمپ ⇒ مدیر ───────────────────────────────────────────────────────
  console.log('\n── ۱) عکسِ پمپ ⇒ مدیر ──');
  const photo = crypto.randomBytes(180 * 1024);
  const up = await pub('POST', '/api/pump/device/support/media', { token: dev, raw: photo, type: 'image/jpeg' });
  check('POST /api/pump/device/support/media ⇒ ۲۰۱ {ok, mediaId}', up.status === 201 && up.json?.ok && /^smd/.test(up.json?.mediaId || ''), `${up.status} ${JSON.stringify(up.json)}`);
  const photoId = up.json?.mediaId;
  const sent = await pub('POST', '/api/pump/device/support/messages', { token: dev, body: { kind: 'image', mediaId: photoId, body: 'خطای چاپ' } });
  check('پیامِ عکس ⇒ kind و mediaId', sent.status === 201 && sent.json?.message?.kind === 'image' && sent.json?.message?.mediaId === photoId, `${sent.status} ${JSON.stringify(sent.json).slice(0, 200)}`);

  const threads = await panel('GET', '/api/account-admin/support/threads?app=pump');
  const th = (threads.json?.threads || []).find((t) => t.stationName === 'پمپِ رسانه‌ای');
  check('مدیر گفت‌وگو را در پنل می‌بیند، با پیش‌نمایشِ عکس', !!th && th.lastMessage === '📷 عکس · خطای چاپ', `${threads.status} ${JSON.stringify(threads.json).slice(0, 300)}`);
  const conv = await panel('GET', `/api/account-admin/support/threads/${th?.id}?after=0`);
  check('پیام در پنل mediaId دارد', (conv.json?.messages || []).some((m) => m.mediaId === photoId && m.kind === 'image'));

  const ownBefore = await pub('GET', `/api/pump/device/support/media/${photoId}`, { token: dev });
  check('فرستنده رسانهٔ خودش را می‌گیرد و چیزی پاک نمی‌شود', ownBefore.status === 200 && ownBefore.buf.equals(photo));
  const adminGot = await panel('GET', `/api/account-admin/support/media/${photoId}`);
  check('مدیر از پنل همان بایت‌ها را می‌گیرد', adminGot.status === 200 && adminGot.buf.equals(photo) && adminGot.type.startsWith('image/jpeg'), `${adminGot.status} ${adminGot.type}`);
  await wait(300);
  const goneOnServer = await pub('GET', `/api/pump/device/support/media/${photoId}`, { token: dev });
  check('⛔ روی سرورِ حساب دیگر نیست (۴۰۴ِ media_gone)', goneOnServer.status === 404 && goneOnServer.json?.error?.code === 'media_gone', `${goneOnServer.status} ${JSON.stringify(goneOnServer.json)}`);
  const cacheFile = path.join(L.tmp, 'data', 'support-media', photoId);
  check('نسخهٔ مدیر روی دیسکِ پنل', fs.existsSync(cacheFile) && fs.readFileSync(cacheFile).equals(photo));
  const adminAgain = await panel('GET', `/api/account-admin/support/media/${photoId}`);
  check('بارِ دوم هم از پنل — از دیسک', adminAgain.status === 200 && adminAgain.buf.equals(photo));

  // ── ۲) مدیر ⇒ پمپ ───────────────────────────────────────────────────────
  console.log('\n── ۲) پیامِ صوتیِ مدیر ⇒ پمپ ──');
  const voice = crypto.randomBytes(64 * 1024);
  const aup = await panel('POST', `/api/account-admin/support/threads/${th?.id}/media`, { raw: voice, type: 'audio/webm;codecs=opus' });
  check('مدیر از پنل بارگذاری کرد', aup.status === 201 && /^smd/.test(aup.json?.mediaId || ''), `${aup.status} ${JSON.stringify(aup.json)}`);
  const voiceId = aup.json?.mediaId;
  const amsg = await panel('POST', `/api/account-admin/support/threads/${th?.id}/messages`, { body: { kind: 'audio', mediaId: voiceId, body: '' } });
  check('پیامِ صوتی رفت', amsg.status === 200 && amsg.json?.message?.kind === 'audio', `${amsg.status} ${JSON.stringify(amsg.json).slice(0, 200)}`);
  const devThread = await pub('GET', '/api/pump/device/support/thread', { token: dev });
  const dm = (devThread.json?.messages || []).find((m) => m.mediaId === voiceId);
  check('پمپ پیام را با kind=audio و mediaId می‌بیند', dm?.kind === 'audio' && dm?.sender === 'admin' && devThread.json?.thread?.lastMessage === '🎤 پیامِ صوتی', JSON.stringify(dm));
  const devGot = await pub('GET', `/api/pump/device/support/media/${voiceId}`, { token: dev });
  check('پمپ همان بایت‌ها را گرفت', devGot.status === 200 && devGot.buf.equals(voice) && devGot.type === 'audio/webm', `${devGot.status} ${devGot.type}`);
  await wait(300);
  const devAgain = await pub('GET', `/api/pump/device/support/media/${voiceId}`, { token: dev });
  check('⛔ و روی سرورِ حساب دیگر نیست', devAgain.status === 404 && devAgain.json?.error?.code === 'media_gone', `${devAgain.status}`);
  const adminOwn = await panel('GET', `/api/account-admin/support/media/${voiceId}`);
  check('نسخهٔ مدیر همچنان از دیسکِ پنل', adminOwn.status === 200 && adminOwn.buf.equals(voice));

  // ── ۳) ویدیوی بزرگ‌تر، از هر دو راه ───────────────────────────────────
  console.log('\n── ۳) ویدیوی سه‌مگابایتی ──');
  const video = crypto.randomBytes(3 * 1024 * 1024);
  const vup = await pub('POST', '/api/pump/device/support/media', { token: dev, raw: video, type: 'video/mp4' });
  await pub('POST', '/api/pump/device/support/messages', { token: dev, body: { kind: 'video', mediaId: vup.json?.mediaId } });
  const vgot = await panel('GET', `/api/account-admin/support/media/${vup.json?.mediaId}`);
  check('پمپ ⇒ مدیر: سه مگابایت، بایت‌به‌بایت', vgot.status === 200 && vgot.buf.equals(video), `${vgot.status} ${vgot.buf.length}`);
  const vadm = await panel('POST', `/api/account-admin/support/threads/${th?.id}/media`, { raw: video, type: 'video/mp4' });
  await panel('POST', `/api/account-admin/support/threads/${th?.id}/messages`, { body: { kind: 'video', mediaId: vadm.json?.mediaId, body: 'راهنما' } });
  const vdev = await pub('GET', `/api/pump/device/support/media/${vadm.json?.mediaId}`, { token: dev });
  check('مدیر ⇒ پمپ: سه مگابایت، بایت‌به‌بایت', vdev.status === 200 && vdev.buf.equals(video), `${vdev.status} ${vdev.buf.length}`);
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  try { process.kill(-stack.pid, 'SIGTERM'); } catch { /* */ }
  await wait(800);
  try { process.kill(-stack.pid, 'SIGKILL'); } catch { /* */ }
}

if (fail) console.log('\n' + stackOut.slice(-1500));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
