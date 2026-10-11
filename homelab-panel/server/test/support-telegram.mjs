// ---------------------------------------------------------------------------
//  پلِ تلگرامِ پشتیبانی (src/support/telegram.js) — سرورِ حسابِ ساختگی + تلگرامِ ساختگی
//  + پنلِ واقعی. پیامِ کاربر ⇒ تلگرامِ مالک؛ Replyِ مالک ⇒ همان گفت‌وگو.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-suptg-'));
const TOKEN = '987654321:AAHfakeSupportBotTokenForTests_abcdefg';
const OWNER = 7770001;

// ── سرورِ حسابِ ساختگی ──
const now = Date.now();
const threads = new Map([
  ['th_old', { id: 'th_old', app: 'pump', who: 'قدیمی', stationName: 'پمپ قدیمی', status: 'open', lastSender: 'user', updatedAt: now - 3600e3, messages: [{ id: 'm0', sender: 'user', body: 'پیامِ قدیمی', kind: 'text', createdAt: now - 3600e3 }] }],
]);
const posts = [];
const fake = http.createServer((req, res) => {
  let raw = ''; req.on('data', (d) => (raw += d)); req.on('end', () => {
    const u = new URL(req.url, 'http://x'); const p = u.pathname;
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, version: '9.9.9' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: Date.now() + 12 * 3600e3 });
    if (String(req.headers.authorization || '') !== 'Bearer tok-1') return j(401, { error: { code: 'unauthorized', message: 'x' } });
    if (p === '/api/admin/support/threads' && req.method === 'GET') {
      return j(200, { threads: [...threads.values()].map(({ messages, ...t }) => ({ ...t, lastMessage: messages.at(-1)?.body || '' })), unread: 0 });
    }
    let m;
    if ((m = /^\/api\/admin\/support\/threads\/([^/]+)$/.exec(p)) && req.method === 'GET') {
      const t = threads.get(m[1]); if (!t) return j(404, { error: { code: 'not_found', message: 'x' } });
      const { messages, ...thread } = t; return j(200, { thread, messages });
    }
    if ((m = /^\/api\/admin\/support\/threads\/([^/]+)\/messages$/.exec(p)) && req.method === 'POST') {
      const body = JSON.parse(raw || '{}'); posts.push({ thread: m[1], body });
      const t = threads.get(m[1]); const msg = { id: `a${posts.length}`, sender: 'admin', body: body.body, kind: 'text', createdAt: Date.now() };
      if (t) { t.messages.push(msg); t.lastSender = 'admin'; t.updatedAt = msg.createdAt; }
      return j(201, { message: msg });
    }
    return j(404, { error: { code: 'not_found', message: 'x' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

// ── تلگرامِ ساختگی ──
const tgSent = [];
let updates = [];
let nextUpdate = 1;
const tg = http.createServer((req, res) => {
  let raw = ''; req.on('data', (d) => (raw += d)); req.on('end', () => {
    const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url); const body = JSON.parse(raw || '{}');
    res.setHeader('content-type', 'application/json');
    if (!m || m[1] !== TOKEN) return res.end(JSON.stringify({ ok: false, description: 'Unauthorized' }));
    if (m[2] === 'getUpdates') return res.end(JSON.stringify({ ok: true, result: updates.filter((u) => u.update_id >= (body.offset || 0)) }));
    if (m[2] === 'sendMessage') { tgSent.push(body); return res.end(JSON.stringify({ ok: true, result: { message_id: 1000 + tgSent.length } })); }
    res.end(JSON.stringify({ ok: false, description: 'unknown' }));
  });
});
await new Promise((r) => tg.listen(0, '127.0.0.1', r));
const pushUpdate = (message) => updates.push({ update_id: nextUpdate++, message });

// ── پنل ──
const PORT = 4900 + Math.floor(Math.random() * 60);
const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
  env: { ...process.env, HLP_PORT: String(PORT), HLP_SITESYNC_PORT: String(PORT + 1), HLP_HOST: '127.0.0.1',
    HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_TUNNEL: '0', HLP_AI_ENABLED: '0',
    HLP_ACCOUNT_AUTOSTART: '0', HLP_PUMP_MIRROR: '0', HLP_SITE_MIRROR: '0',
    HLP_ACCOUNT_API: `http://127.0.0.1:${fake.address().port}`, HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret',
    HLP_TELEGRAM_API: `http://127.0.0.1:${tg.address().port}` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
let token = null;
const call = async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const run = () => call('POST', '/api/automation/jobs/support-telegram/run', {});

try {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* */ } await wait(250); }
  await call('POST', '/api/auth/setup', { username: 'admin', password: 'Support-1405-tg' });
  token = (await call('POST', '/api/auth/login', { username: 'admin', password: 'Support-1405-tg' })).body?.token;
  check('ورود', Boolean(token));

  console.log('\n── ۱) تنظیم ──');
  let r = await run();
  check('خاموش ⇒ کاری نمی‌کند', r.status === 200 && (r.body.status === 'skipped' || /disabled/.test(JSON.stringify(r.body))), JSON.stringify(r.body).slice(0, 200));
  r = await call('PUT', '/api/support-telegram', { token: 'bad' });
  check('توکنِ نادرست رد می‌شود', r.status === 400, r.status);
  r = await call('PUT', '/api/support-telegram', { token: TOKEN });
  check('توکن در گاوصندوق، فقط چهار نویسهٔ آخر', r.status === 200 && r.body.hasToken && r.body.tokenHint === `••••${TOKEN.slice(-4)}` && !JSON.stringify(r.body).includes(TOKEN), JSON.stringify(r.body));
  pushUpdate({ message_id: 1, chat: { id: OWNER, first_name: 'Owner' }, text: '/start' });
  r = await call('POST', '/api/support-telegram/find-chat', {});
  check('chat idِ مالک پیدا شد', r.status === 200 && r.body.chat.id === String(OWNER), JSON.stringify(r.body));
  r = await call('PUT', '/api/support-telegram', { enabled: true, chatId: String(OWNER), apps: ['pump', 'shop'] });
  check('روشن شد', r.status === 200 && r.body.enabled, JSON.stringify(r.body));
  r = await call('POST', '/api/support-telegram/test', {});
  check('پیامِ آزمایشی', r.status === 200 && tgSent.at(-1)?.chat_id === String(OWNER));

  console.log('\n── ۲) پیامِ کاربر ⇒ تلگرام ──');
  const before = tgSent.length;
  await wait(20);
  const t1 = Date.now();
  threads.set('th_pump', { id: 'th_pump', app: 'pump', who: 'احمد', stationName: 'پمپ یعقوبی', status: 'open', lastSender: 'user', updatedAt: t1, messages: [{ id: 'u1', sender: 'user', body: 'برنامه باز نمی‌شود', kind: 'text', createdAt: t1 }] });
  threads.set('th_shop', { id: 'th_shop', app: 'shop', who: 'کریم', shopName: 'دکان کریم', status: 'open', lastSender: 'user', updatedAt: t1, messages: [{ id: 'u2', sender: 'user', body: '', kind: 'image', createdAt: t1 }] });
  r = await run();
  const fresh = tgSent.slice(before).filter((x) => !x.reply_to_message_id);
  check('دو پیامِ تازه به تلگرام رفت', fresh.length === 2, JSON.stringify(r.body) + ' ' + JSON.stringify(fresh));
  check('پیامِ قدیمی (پیش از روشن شدن) نرفت', !tgSent.some((x) => /پیامِ قدیمی/.test(x.text)));
  check('نامِ پمپ و متن در پیام', fresh.some((x) => /پمپ یعقوبی/.test(x.text) && /باز نمی‌شود/.test(x.text)));
  check('عکس به‌شکلِ «🖼 عکس»', fresh.some((x) => /دکان کریم/.test(x.text) && /عکس/.test(x.text)));
  const pumpMsgId = 1000 + tgSent.indexOf(fresh.find((x) => /پمپ یعقوبی/.test(x.text))) + 1;
  r = await run();
  check('دورِ دوم چیزی را دوباره نمی‌فرستد', tgSent.filter((x) => /باز نمی‌شود/.test(x.text || '')).length === 1);

  console.log('\n── ۳) Replyِ مالک ⇒ همان کاربر ──');
  pushUpdate({ message_id: 50, chat: { id: OWNER }, text: 'سلام احمد، برنامه را دوباره نصب کنید', reply_to_message: { message_id: pumpMsgId } });
  pushUpdate({ message_id: 51, chat: { id: 1234567 }, text: 'من غریبه‌ام', reply_to_message: { message_id: pumpMsgId } });
  pushUpdate({ message_id: 52, chat: { id: OWNER }, text: 'بی Reply' });
  r = await run();
  check('جوابِ مالک به گفت‌وگوی درست رسید', posts.length === 1 && posts[0].thread === 'th_pump' && /دوباره نصب/.test(posts[0].body.body), JSON.stringify(posts));
  check('پیامِ غریبه به هیچ کاربری نرفت', !posts.some((p) => /غریبه/.test(p.body.body)));
  check('«✅ رسید» برای مالک', tgSent.some((x) => x.reply_to_message_id === 50 && /رسید/.test(x.text)));
  check('پیامِ بی Reply راهنما گرفت', tgSent.some((x) => x.reply_to_message_id === 52 && /Reply/.test(x.text)));
  check('جوابِ خودِ مالک دوباره به تلگرام برنمی‌گردد', !tgSent.some((x) => !x.reply_to_message_id && /دوباره نصب/.test(x.text)));
  r = await run();
  check('همان Reply دو بار نمی‌رود', posts.length === 1, posts.length);

  console.log('\n── ۴) فقط برنامه‌های برگزیده ──');
  await call('PUT', '/api/support-telegram', { apps: ['pump'] });
  const t2 = Date.now() + 5;
  threads.get('th_shop').messages.push({ id: 'u3', sender: 'user', body: 'فروشگاه دوباره', kind: 'text', createdAt: t2 });
  threads.get('th_shop').updatedAt = t2; threads.get('th_shop').lastSender = 'user';
  await run();
  check('فروشگاه خاموش ⇒ نرفت', !tgSent.some((x) => /فروشگاه دوباره/.test(x.text || '')));
} catch (e) {
  failed++; console.error('\n❌ آزمون شکست:', e.message); console.error(out.slice(-2000));
} finally {
  child.kill('SIGTERM'); fake.close(); tg.close();
  await wait(300);
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}
console.log(`\n${passed} موفق، ${failed} ناموفق`);
process.exit(failed ? 1 : 0);
