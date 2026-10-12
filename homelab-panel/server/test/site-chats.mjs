// ---------------------------------------------------------------------------
//  گفت‌وگوهای سایت در کنترول سنتر و تلگرام (src/support/site-chats.js)
//  سایتِ ساختگی را خودِ پنل اجرا می‌کند ⇒ کلید (SITE_PANEL_KEY) واقعاً از پنل به سایت می‌رسد.
//  پیامِ بازدیدکننده ⇒ فهرستِ کنترول سنتر و تلگرامِ مالک؛ جواب از پنل یا Replyِ تلگرام ⇒ همان گفت‌وگو.
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
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-sitechat-'));
const TOKEN = '987654321:AAHfakeSupportBotTokenForTests_abcdefg';
const OWNER = 7770002;

// ── سایتِ ساختگی: همان قراردادِ /api/panel/chats در VILL3N-WEB- (src/chat.js) ──
const siteDir = path.join(tmp, 'sites', 'demo');
fs.mkdirSync(siteDir, { recursive: true });
fs.writeFileSync(path.join(siteDir, 'site.js'), `
const http = require('http');
const KEY = process.env.SITE_PANEL_KEY || '';
const chats = [];
const j = (res, code, o) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
const sum = (t) => { const l = t.messages[t.messages.length - 1]; return { id: t.id, name: t.name, contact: t.contact, page: '/', status: 'open', unread: t.unread, updatedAt: t.updatedAt, lastFrom: l.from, lastMessage: l.body, count: t.messages.length }; };
let n = 0;
http.createServer((req, res) => {
  let raw = ''; req.on('data', (d) => (raw += d)); req.on('end', () => {
    const u = new URL(req.url, 'http://x'); const p = u.pathname; let m;
    if (p === '/__key') return j(res, 200, { len: KEY.length });
    if (p === '/__visitor') { const b = JSON.parse(raw); let t = chats.find((x) => x.id === b.id);
      if (!t) { t = { id: b.id, name: b.name, contact: '0912', unread: 0, messages: [] }; chats.push(t); }
      const at = Date.now() + (n++); t.messages.push({ id: 'v' + n, from: 'visitor', body: b.text, at }); t.updatedAt = at; t.unread++; return j(res, 200, { ok: true }); }
    if (p === '/__state') return j(res, 200, { chats });
    if (!p.startsWith('/api/panel/chats')) return j(res, 404, { error: 'x' });
    if (KEY.length < 32 || req.headers['x-panel-key'] !== KEY) return j(res, 404, { error: 'پیدا نشد' });
    if (p === '/api/panel/chats') { const since = Number(u.searchParams.get('since')) || 0;
      return j(res, 200, { ok: true, chats: chats.filter((t) => t.updatedAt > since).map(sum), unread: chats.reduce((a, t) => a + t.unread, 0) }); }
    if ((m = /^\\/api\\/panel\\/chats\\/([^/]+)$/.exec(p))) { const t = chats.find((x) => x.id === m[1]); if (!t) return j(res, 404, { error: 'گفت‌وگو پیدا نشد' });
      if (req.method === 'GET') return j(res, 200, { ok: true, chat: sum(t), messages: t.messages });
      const b = JSON.parse(raw || '{}'); const at = Date.now() + (n++);
      const msg = { id: 'o' + n, from: 'owner', body: b.text, at, via: req.headers['x-panel-via'] || '' }; t.messages.push(msg); t.updatedAt = at; t.unread = 0;
      return j(res, 200, { ok: true, message: msg }); }
    j(res, 404, { error: 'x' });
  });
}).listen(Number(process.env.PORT), '127.0.0.1');
`);

// ── تلگرامِ ساختگی ──
const tgSent = [];
const updates = [];
let nextUpdate = 1;
const tg = http.createServer((req, res) => {
  let raw = ''; req.on('data', (d) => (raw += d)); req.on('end', () => {
    const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url); const body = JSON.parse(raw || '{}');
    res.setHeader('content-type', 'application/json');
    if (!m || m[1] !== TOKEN) return res.end(JSON.stringify({ ok: false, description: 'Unauthorized' }));
    if (m[2] === 'getUpdates') return res.end(JSON.stringify({ ok: true, result: updates.filter((u) => u.update_id >= (body.offset || 0)) }));
    if (m[2] === 'sendMessage') { tgSent.push(body); return res.end(JSON.stringify({ ok: true, result: { message_id: 2000 + tgSent.length } })); }
    if (m[2] === 'getMe') return res.end(JSON.stringify({ ok: true, result: { id: 1, is_bot: true, username: 'ControlCenterBot' } }));
    res.end(JSON.stringify({ ok: false, description: 'unknown' }));
  });
});
await new Promise((r) => tg.listen(0, '127.0.0.1', r));
const pushUpdate = (message) => updates.push({ update_id: nextUpdate++, message });

// ── پنل ──
const PORT = 5000 + Math.floor(Math.random() * 60);
const SITE_PORT = 8700 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const SITE = `http://127.0.0.1:${SITE_PORT}`;
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
  env: { ...process.env, HLP_PORT: String(PORT), HLP_SITESYNC_PORT: String(PORT + 1), HLP_HOST: '127.0.0.1',
    HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_TUNNEL: '0', HLP_AI_ENABLED: '0',
    HLP_ACCOUNT_AUTOSTART: '0', HLP_PUMP_MIRROR: '0', HLP_SITE_MIRROR: '0',
    HLP_ACCOUNT_API: 'http://127.0.0.1:9', HLP_TG_HEARTBEAT_MS: '0', HLP_TELEGRAM_API: `http://127.0.0.1:${tg.address().port}` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
let token = null;
const call = async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const site = async (p, body) => (await fetch(SITE + p, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined })).json();
//  ⚠️ کار هر ۵ ثانیه خودش هم می‌چرخد؛ «already_running» ⇒ دوباره
const run = async () => {
  for (let i = 0; i < 100; i++) {
    const r = await call('POST', '/api/automation/jobs/support-telegram/run', {});
    if (r.body?.error !== 'already_running') return r;
    await wait(100);
  }
  throw new Error('کارِ support-telegram آزاد نشد');
};

try {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* */ } await wait(250); }
  await call('POST', '/api/auth/setup', { username: 'admin', password: 'SiteChat-1405-ok' });
  token = (await call('POST', '/api/auth/login', { username: 'admin', password: 'SiteChat-1405-ok' })).body?.token;
  check('ورود', Boolean(token));

  console.log('\n── ۱) کلیدِ پنل به سایت ──');
  let r = await call('POST', '/api/sites', { path: siteDir, name: 'demo', port: SITE_PORT, kind: 'node', startCommand: 'node site.js' });
  const siteRow = r.body.site;
  check('سایت افزوده شد', r.status === 200 && siteRow?.slug, JSON.stringify(r.body).slice(0, 300));
  r = await call('POST', `/api/sites/${siteRow.id}/start`, {});
  let up = false;
  for (let i = 0; i < 40 && !up; i++) { try { up = (await site('/__key')).len === 64; } catch { await wait(200); } }
  check('سایت کلیدِ ۶۴ نویسه‌ای را از پنل گرفت', up, out.slice(-400));
  const keyFile = path.join(tmp, 'data', 'sites', siteRow.slug, 'panel.key');
  check('کلید در فایلِ جدا با دسترسیِ ۶۰۰', fs.existsSync(keyFile) && (process.platform === 'win32' || (fs.statSync(keyFile).mode & 0o777) === 0o600));
  r = await call('GET', `/api/sites/${siteRow.id}`);
  check('کلید در پاسخِ «سایت‌ها» نمی‌آید', !JSON.stringify(r.body).includes(fs.readFileSync(keyFile, 'utf8')));

  console.log('\n── ۲) کنترول سنتر ──');
  r = await call('GET', '/api/site-chats');
  check('سایت در فهرست، بی گفت‌وگو', r.status === 200 && r.body.sites?.length === 1 && r.body.sites[0].chats.length === 0, JSON.stringify(r.body));
  await site('/__visitor', { id: 'c1', name: 'سارا', text: 'قیمتِ سایتِ سه‌بعدی چند است؟' });
  r = await call('GET', '/api/site-chats');
  check('پیامِ بازدیدکننده در کنترول سنتر', r.body.sites[0].chats[0]?.lastMessage?.includes('سه‌بعدی') && r.body.unread === 1, JSON.stringify(r.body));
  r = await call('GET', `/api/site-chats/${siteRow.slug}/c1`);
  check('خودِ گفت‌وگو', r.status === 200 && r.body.messages?.length === 1);
  r = await call('POST', `/api/site-chats/${siteRow.slug}/c1`, { text: 'سلام سارا، از ۲۰ میلیون' });
  let st = await site('/__state');
  check('جوابِ کنترول سنتر به سایت رسید', r.status === 200 && st.chats[0].messages.at(-1).body.includes('۲۰ میلیون') && st.chats[0].messages.at(-1).via === '', JSON.stringify(st));
  r = await call('POST', `/api/site-chats/${siteRow.slug}/c1`, { text: '   ' });
  check('جوابِ خالی ⇒ ۴۰۰', r.status === 400, r.status);
  r = await call('GET', '/api/site-chats/..%2F..%2Fetc/c1');
  check('نشانیِ نادرست ⇒ رد', r.status >= 400 && r.status < 500, r.status);
  r = await call('GET', `/api/site-chats/${siteRow.slug}/nope`);
  check('گفت‌وگوی ناموجود ⇒ ۴۰۴', r.status === 404, r.status);
  const anon = await fetch(`${BASE}/api/site-chats`);
  check('بی ورود ⇒ ۴۰۱', anon.status === 401, anon.status);

  console.log('\n── ۳) تلگرام ──');
  await call('PUT', '/api/support-telegram', { token: TOKEN, chatId: String(OWNER), enabled: true });
  r = await call('GET', '/api/support-telegram');
  check('«سایت» به‌طورِ پیش‌فرض روشن است', r.body.apps?.includes('site'), JSON.stringify(r.body.apps));
  await call('PUT', '/api/support-telegram', { apps: ['site'] });
  //  ⛔ از 1.50.51 Replyِ مالک فقط پس از ورود با نام و رمزِ پنل (telegram-auth.js)
  for (const [id, text] of [[60, '/login'], [61, 'admin'], [62, 'SiteChat-1405-ok']]) { pushUpdate({ message_id: id, chat: { id: OWNER }, text }); await run(); }
  check('ربات با نام و رمزِ پنل وارد شد', /خوش آمدید/.test(tgSent.at(-1)?.text || ''), JSON.stringify(tgSent.at(-1)));
  await wait(20);
  await site('/__visitor', { id: 'c2', name: 'رضا', text: 'برنامهٔ فروشگاه را می‌خواهم' });
  r = await run();
  const sent = tgSent.filter((x) => !x.reply_to_message_id);
  check('پیامِ تازهٔ سایت به تلگرام رفت (نامِ سایت و فرستنده)', sent.length === 1 && /demo/.test(sent[0].text) && /رضا/.test(sent[0].text) && /فروشگاه/.test(sent[0].text), JSON.stringify(r.body) + JSON.stringify(tgSent) + out.slice(-500));
  check('پیامِ پیش از روشن شدن نرفت', !tgSent.some((x) => /سه‌بعدی/.test(x.text || '')));
  await run();
  check('دورِ دوم دوباره نمی‌فرستد', tgSent.filter((x) => /فروشگاه/.test(x.text || '')).length === 1);
  const msgId = 2000 + tgSent.indexOf(sent[0]) + 1;
  pushUpdate({ message_id: 70, chat: { id: OWNER }, text: 'سلام رضا، فردا تماس می‌گیرم', reply_to_message: { message_id: msgId } });
  pushUpdate({ message_id: 71, chat: { id: 999 }, text: 'غریبه', reply_to_message: { message_id: msgId } });
  await run();
  st = await site('/__state');
  const c2 = st.chats.find((c) => c.id === 'c2');
  check('Replyِ تلگرام به همان بازدیدکننده رسید', c2.messages.at(-1).body.includes('فردا تماس') && c2.messages.at(-1).via === 'telegram', JSON.stringify(c2));
  check('غریبه به سایت نرسید', !st.chats.some((c) => c.messages.some((m) => m.body === 'غریبه')));
  check('«✅ رسید» برای مالک', tgSent.some((x) => x.reply_to_message_id === 70 && /رسید/.test(x.text)));
  check('جوابِ خودِ مالک دوباره به تلگرام برنمی‌گردد', !tgSent.some((x) => !x.reply_to_message_id && /فردا تماس/.test(x.text)));
  await wait(5);
  await site('/__visitor', { id: 'c2', name: 'رضا', text: 'ممنون، منتظرم' });
  await run();
  check('پیامِ بعدیِ همان گفت‌وگو هم می‌رود', tgSent.some((x) => !x.reply_to_message_id && /منتظرم/.test(x.text)));
  await call('PUT', '/api/support-telegram', { apps: ['pump'] });
  await site('/__visitor', { id: 'c2', name: 'رضا', text: 'سایت خاموش' });
  await run();
  check('«سایت» خاموش ⇒ نرفت', !tgSent.some((x) => /سایت خاموش/.test(x.text || '')));
} catch (e) {
  failed++; console.error('\n❌ آزمون شکست:', e.message); console.error(out.slice(-2000));
} finally {
  child.kill('SIGTERM'); tg.close();
  await wait(500);
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}
console.log(`\n${passed} موفق، ${failed} ناموفق`);
process.exit(failed ? 1 : 0);
