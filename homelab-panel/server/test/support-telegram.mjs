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
const offline = [];
let pumpBot = 'controlcenterbot';
const acct = { status: 'active', endsAt: now + 3 * 864e5, grants: [], statuses: [] };
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
    // ── رباتِ مالک: حساب‌ها، اشتراک‌ها، پلن‌ها ──
    const st = () => ({ id: 'st1', code: 'P-100', name: 'پمپ یعقوبی', owner_name: 'احمد', owner_email: 'ahmad@x.af', owner_phone: '0700', subscription_id: 'sub1', plan: 'pro', sub_status: acct.status, ends_at: acct.endsAt });
    if (p === '/api/admin/pump/stations' && req.method === 'GET') {
      const q = String(u.searchParams.get('q') || '').toLowerCase();
      const s = st(); const hit = !q || [s.name, s.code, s.owner_email].some((x) => x.toLowerCase().includes(q));
      return j(200, { stations: hit ? [s] : [], total: 1 });
    }
    if (p === '/api/admin/pump/stations/st1') return j(200, { station: { id: 'st1', code: 'P-100', name: 'پمپ یعقوبی' } });
    if (p === '/api/admin/shops' && req.method === 'GET') return j(200, { shops: [], total: 0 });
    if (p === '/api/admin/pump/subscriptions' && req.method === 'GET') return j(200, { subscriptions: [{ id: 'sub1', station_id: 'st1', plan: 'pro', status: acct.status, ends_at: acct.endsAt, max_devices: 5, grace_days: 0, note: '' }] });
    if (p === '/api/admin/pump/subscriptions' && req.method === 'POST') {
      const body = JSON.parse(raw || '{}'); acct.grants.push(body);
      acct.status = 'active'; acct.endsAt = body.endsAt || Date.now() + 30 * 864e5;
      return j(200, { subscription: { id: 'sub1' } });
    }
    if (p === '/api/admin/pump/subscriptions/sub1/status' && req.method === 'POST') {
      const body = JSON.parse(raw || '{}'); acct.statuses.push(body.status); acct.status = body.status;
      return j(200, { subscription: { id: 'sub1' } });
    }
    if (p === '/api/admin/telegram') return j(200, { telegram: { username: pumpBot } });
    if (p === '/api/admin/pump/offline-codes' && req.method === 'GET') return j(200, { codes: offline });
    if (p === '/api/admin/pump/offline-codes' && req.method === 'POST') {
      const body = JSON.parse(raw || '{}');
      const o = { id: `oc${offline.length + 1}`, plan: body.plan, planTitle: body.plan === 'vip' ? 'وی‌آی‌پی' : body.plan, computer: body.computer, accountEmail: body.account, issuedAt: Date.now(), endsAt: Date.now() + (body.days || 0) * 864e5, permanent: body.days == null, note: body.note, status: 'active', body };
      offline.unshift(o);
      return j(200, { code: 'PUMP1-SECRET-CODE-XYZ', offline: o, file: { v: 2, code: 'PUMP1-SECRET-CODE-XYZ' } });
    }
    if ((m = /^\/api\/admin\/pump\/offline-codes\/([^/]+)\/revoke$/.exec(p)) && req.method === 'POST') {
      const o = offline.find((x) => x.id === m[1]); if (o) o.status = 'revoked'; return j(200, { ok: true });
    }
    if (p === '/api/admin/plans') return j(200, { plans: [{ code: 'pro', name: 'حرفه‌ای', amount: 1, unit: 'month', active: 1 }, { code: 'free', name: 'رایگان', active: true }], config: {} });
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
const tgDeleted = [];
const tgDocs = [];
const tgAnswers = [];
const tgEdits = [];
let updates = [];
let nextUpdate = 1;
const tg = http.createServer((req, res) => {
  let raw = ''; req.on('data', (d) => (raw += d)); req.on('end', () => {
    const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url); let body = {}; try { body = JSON.parse(raw || '{}'); } catch { body = { raw }; }
    res.setHeader('content-type', 'application/json');
    if (!m || m[1] !== TOKEN) return res.end(JSON.stringify({ ok: false, description: 'Unauthorized' }));
    if (m[2] === 'getUpdates') return res.end(JSON.stringify({ ok: true, result: updates.filter((u) => u.update_id >= (body.offset || 0)) }));
    if (m[2] === 'sendMessage') { tgSent.push(body); return res.end(JSON.stringify({ ok: true, result: { message_id: 1000 + tgSent.length } })); }
    if (m[2] === 'getMe') return res.end(JSON.stringify({ ok: true, result: { id: 1, is_bot: true, username: 'ControlCenterBot' } }));
    if (m[2] === 'deleteMessage') { tgDeleted.push(body.message_id); return res.end(JSON.stringify({ ok: true, result: true })); }
    if (m[2] === 'sendDocument') { tgDocs.push(body.raw || ''); return res.end(JSON.stringify({ ok: true, result: { message_id: 5000 + tgDocs.length } })); }
    if (m[2] === 'answerCallbackQuery') { tgAnswers.push(body); return res.end(JSON.stringify({ ok: true, result: true })); }
    if (m[2] === 'editMessageText') { tgEdits.push(body); return res.end(JSON.stringify({ ok: true, result: { message_id: body.message_id } })); }
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
//  ⚠️ کار هر ۵ ثانیه خودش هم می‌چرخد؛ اگر همان لحظه در حالِ اجرا بود («already_running») دوباره بزن
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
  await call('POST', '/api/auth/setup', { username: 'admin', password: 'Support-1405-tg' });
  token = (await call('POST', '/api/auth/login', { username: 'admin', password: 'Support-1405-tg' })).body?.token;
  check('ورود', Boolean(token));

  console.log('\n── ۱) تنظیم ──');
  let r = await run();
  check('خاموش ⇒ کاری نمی‌کند', r.status === 200 && (r.body.status === 'skipped' || /disabled/.test(JSON.stringify(r.body))), JSON.stringify(r.body).slice(0, 200));
  r = await call('PUT', '/api/support-telegram', { token: 'bad' });
  check('توکنِ نادرست رد می‌شود', r.status === 400, r.status);
  r = await call('PUT', '/api/support-telegram', { token: TOKEN });
  check('⛔ توکنِ رباتِ پمپ بنزین پذیرفته نمی‌شود', r.status === 409 && /پمپ بنزین/.test(r.body.error || '') && !r.body.hasToken, r.status + JSON.stringify(r.body));
  r = await call('POST', '/api/support-telegram/find-chat', { token: TOKEN });
  check('⛔ find-chat هم با رباتِ پمپ کار نمی‌کند', r.status === 409, r.status);
  pumpBot = 'PumpYaqobiBot';
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
  threads.set('th_pump', { id: 'th_pump', app: 'pump', who: 'احمد', stationName: 'پمپ یعقوبی', stationId: 'st1', status: 'open', lastSender: 'user', updatedAt: t1, messages: [{ id: 'u1', sender: 'user', body: 'برنامه باز نمی‌شود', kind: 'text', createdAt: t1 }] });
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

  console.log('\n── ۲ب) قفلِ ورود: نام و رمزِ پنل ──');
  const say = (message_id, text, chat = OWNER) => pushUpdate({ message_id, chat: { id: chat }, text });
  let n0 = tgSent.length;
  say(40, '/status');
  await run();
  check('بی ورود: /status جواب نمی‌دهد، فقط «/login»', !tgSent.slice(n0).some((x) => /وضعیتِ سرور/.test(x.text || '')) && tgSent.slice(n0).some((x) => /قفل/.test(x.text || '') && /login/.test(x.text)), JSON.stringify(tgSent.slice(n0)));
  pushUpdate({ message_id: 41, chat: { id: OWNER }, text: 'بی ورود جواب', reply_to_message: { message_id: pumpMsgId } });
  await run();
  check('بی ورود: Reply به کاربر نمی‌رود', posts.length === 0, JSON.stringify(posts));
  updates.push({ update_id: nextUpdate++, callback_query: { id: 'cq-locked', from: { id: OWNER }, data: 'a:AAAAAAAA', message: { message_id: 1, chat: { id: OWNER } } } });
  await run();
  check('بی ورود: دکمه «🔒»', tgAnswers.some((a) => a.callback_query_id === 'cq-locked' && /login/.test(a.text || '')));
  say(42, '/login'); await run(); say(43, 'admin'); await run(); say(44, 'wrong-pass-1'); await run();
  check('رمزِ غلط ⇒ رد و پیامِ رمز پاک شد', tgDeleted.includes(44) && /درست نیست/.test(tgSent.at(-1)?.text || ''), JSON.stringify(tgSent.at(-1)));
  say(45, '/login'); await run(); say(46, 'ghost'); await run(); say(47, 'Support-1405-tg'); await run();
  check('کاربرِ ناموجود با همان رمز رد شد', /درست نیست/.test(tgSent.at(-1)?.text || ''));
  say(48, '/login'); await run(); say(49, 'admin'); await run(); say(50, 'Support-1405-tg'); await run();
  check('ورود با نام و رمزِ درست', /خوش آمدید admin/.test(tgSent.at(-1)?.text || '') && tgDeleted.includes(50), JSON.stringify(tgSent.at(-1)));
  r = await call('GET', '/api/support-telegram');
  check('پنل می‌بیند ربات وارد شده', r.body.bot?.loggedIn === true && r.body.bot.username === 'admin', JSON.stringify(r.body.bot));
  check('رمز هیچ‌جا در پیام‌های ربات نیامد', !tgSent.some((x) => /Support-1405-tg|wrong-pass-1/.test(x.text || '')));

  console.log('\n── ۳) Replyِ مالک ⇒ همان کاربر ──');
  pushUpdate({ message_id: 150, chat: { id: OWNER }, text: 'سلام احمد، برنامه را دوباره نصب کنید', reply_to_message: { message_id: pumpMsgId } });
  pushUpdate({ message_id: 151, chat: { id: 1234567 }, text: 'من غریبه‌ام', reply_to_message: { message_id: pumpMsgId } });
  pushUpdate({ message_id: 152, chat: { id: OWNER }, text: 'بی Reply' });
  r = await run();
  check('جوابِ مالک به گفت‌وگوی درست رسید', posts.length === 1 && posts[0].thread === 'th_pump' && /دوباره نصب/.test(posts[0].body.body), JSON.stringify(posts));
  check('پیامِ غریبه به هیچ کاربری نرفت', !posts.some((p) => /غریبه/.test(p.body.body)));
  check('«✅ رسید» برای مالک', tgSent.some((x) => x.reply_to_message_id === 150 && /رسید/.test(x.text)));
  check('پیامِ بی Reply راهنما گرفت', tgSent.some((x) => x.reply_to_message_id === 152 && /Reply/.test(x.text)));
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

  console.log('\n── ۵) رباتِ مالک: دستورها و دکمه‌ها ──');
  let cqN = 0;
  const btnOf = (re) => {
    const all = [...tgSent.map((x, i) => ({ ...x, message_id: 1000 + i + 1 })), ...tgEdits];
    for (let i = all.length - 1; i >= 0; i--) {
      for (const row of all[i].reply_markup?.inline_keyboard || []) for (const b of row) if (re.test(b.text)) return { msg: all[i], b };
    }
    return null;
  };
  const press = (hit, from = OWNER) => updates.push({ update_id: nextUpdate++, callback_query: { id: `cq${++cqN}`, from: { id: from }, data: hit.b.callback_data, message: { message_id: hit.msg.message_id, chat: { id: from } } } });
  const pumpMsg = tgSent.find((x) => /باز نمی‌شود/.test(x.text || ''));
  check('زیرِ پیامِ کاربرِ پمپ دکمهٔ «حساب» هست', /حساب/.test(JSON.stringify(pumpMsg?.reply_markup || {})), JSON.stringify(pumpMsg?.reply_markup));
  pushUpdate({ message_id: 60, chat: { id: OWNER }, text: '/status' });
  await run();
  check('/status وضعیتِ سرور و سرورِ حساب', tgSent.some((x) => /وضعیتِ سرور/.test(x.text || '') && /سرورِ حساب: ✅/.test(x.text)), JSON.stringify(tgSent.at(-1)));
  pushUpdate({ message_id: 61, chat: { id: OWNER }, text: '/expiring' });
  await run();
  check('/expiring پمپی که ۳ روزِ دیگر تمام می‌شود', !!btnOf(/پمپ یعقوبی — ۳ روز/), JSON.stringify(tgSent.at(-1)));
  pushUpdate({ message_id: 62, chat: { id: OWNER }, text: 'ahmad@x' });
  await run();
  const card = tgSent.at(-1);
  check('جست‌وجو با ایمیل ⇒ کارتِ حساب', /پمپ یعقوبی/.test(card?.text || '') && /احمد/.test(card.text) && /۳ روز مانده/.test(card.text), card?.text);
  check('شناسهٔ حساب در دکمه نیست', !JSON.stringify(card?.reply_markup || {}).includes('st1') && !JSON.stringify(card?.reply_markup || {}).includes('sub1'));
  const before5 = Date.now();
  press(btnOf(/➕ ۳ ماه/));
  await run();
  check('دکمهٔ تمدید فقط تأیید می‌خواهد', acct.grants.length === 0 && /۳ ماه به این اشتراک/.test(tgSent.at(-1)?.text || ''), tgSent.at(-1)?.text);
  const yes = btnOf(/بله، انجام بده/);
  press(yes, 1234567);
  await run();
  check('دکمهٔ غریبه کاری نمی‌کند', acct.grants.length === 0 && tgAnswers.some((a) => /اجازه/.test(a.text || '')));
  press(yes);
  await run();
  const g = acct.grants[0] || {};
  const months3 = new Date(now + 3 * 864e5); months3.setUTCMonth(months3.getUTCMonth() + 3);
  check('تمدیدِ ۳ ماه از پایانِ فعلی، برای همان پمپ', acct.grants.length === 1 && g.stationId === 'st1' && Math.abs(g.endsAt - months3.getTime()) < 60e3 && g.maxDevices === 5, JSON.stringify(g));
  check('پیام به «✅ انجام شد» و کارتِ تازه عوض شد', tgEdits.some((e) => /انجام شد/.test(e.text) && /پمپ یعقوبی/.test(e.text)));
  press(yes);
  await run();
  check('همان تأیید دو بار تمدید نمی‌کند', acct.grants.length === 1, acct.grants.length);
  updates.push({ update_id: nextUpdate++, callback_query: { id: 'cqx', from: { id: OWNER }, data: 'y:AAAAAAAA', message: { message_id: 1, chat: { id: OWNER } } } });
  await run();
  check('دکمهٔ جعلی کاری نمی‌کند', acct.grants.length === 1 && acct.statuses.length === 0);
  press(btnOf(/تعلیق/));
  await run();
  press(btnOf(/بله، انجام بده/));
  await run();
  check('تعلیق از تلگرام', acct.statuses.at(-1) === 'suspended', JSON.stringify(acct.statuses));
  press(btnOf(/اشتراکِ تازه با پلن/));
  await run();
  check('پلنِ رایگان در فهرست نیست', !!btnOf(/حرفه‌ای/) && !btnOf(/رایگان/));
  press(btnOf(/حرفه‌ای/));
  await run();
  press(btnOf(/بله، انجام بده/));
  await run();
  check('اشتراک با پلن از تلگرام', acct.grants.length === 2 && acct.grants[1].plan === 'pro' && acct.grants[1].stationId === 'st1', JSON.stringify(acct.grants));
  press(btnOf(/حساب و اشتراک/));
  await run();
  check('دکمهٔ «حساب» زیرِ پیامِ کاربر کارتِ همان پمپ را می‌آورد', /پمپ یعقوبی/.test(tgSent.at(-1)?.text || '') && /فعال/.test(tgSent.at(-1).text), tgSent.at(-1)?.text);
  pushUpdate({ message_id: 63, chat: { id: 1234567 }, text: '/status' });
  const n63 = tgSent.length;
  await run();
  check('دستورِ غریبه جواب نمی‌گیرد', tgSent.length === n63);
  pushUpdate({ message_id: 64, chat: { id: OWNER }, text: '/sites' });
  await run();
  check('/sites', /سایتی ثبت نشده|سایت‌ها/.test(tgSent.at(-1)?.text || ''), tgSent.at(-1)?.text);
  check('پیام‌های تحتِ دستور هیچ‌وقت به کاربر نرفت', posts.length === 1, posts.length);

  console.log('\n── ۶) کدِ اشتراکِ آفلاینِ پمپ ──');
  say(70, '/offline'); await run();
  check('/offline کدِ کامپیوتر می‌خواهد', /کدِ کامپیوترِ مشتری/.test(tgSent.at(-1)?.text || ''));
  say(71, 'bad code!'); await run();
  check('کدِ کامپیوترِ نادرست رد شد', /❌/.test(tgSent.at(-1)?.text || '') && offline.length === 0);
  say(72, 'ab12-cd34'); await run();
  check('ایمیلِ حساب پرسیده شد', /AB12-CD34/.test(tgSent.at(-1)?.text || '') && /ایمیل/.test(tgSent.at(-1).text));
  say(73, 'Ahmad@X.af'); await run();
  check('سه پلن', !!btnOf(/استاندارد/) && !!btnOf(/وی‌آی‌پی/) && !!btnOf(/دائمی/));
  press(btnOf(/وی‌آی‌پی/)); await run();
  check('پیش از تأیید کدی ساخته نشد', offline.length === 0 && /ساخته شود/.test(tgSent.at(-1)?.text || ''));
  press(btnOf(/بله، انجام بده/)); await run();
  const oc = offline[0]?.body || {};
  check('کد برای همان کامپیوتر، حساب و پلن', oc.computer === 'AB12-CD34' && oc.account === 'ahmad@x.af' && oc.plan === 'vip' && oc.days === 365, JSON.stringify(oc));
  check('پیامِ آمادهٔ مشتری با خودِ کد', tgSent.some((x) => /PUMP1-SECRET-CODE-XYZ/.test(x.text || '') && /AB12-CD34/.test(x.text)));
  check('فایلِ ‎.pumpkey‎ فرستاده شد', tgDocs.some((d) => /pump-AB12-CD34\.pumpkey/.test(d) && /PUMP1-SECRET-CODE-XYZ/.test(d)), tgDocs.length);
  r = await call('GET', '/api/control/audit?limit=50');
  check('خودِ کد در دفترِ ممیزی نیست', r.status === 200 && /offline_code/.test(JSON.stringify(r.body)) && !JSON.stringify(r.body).includes('PUMP1-SECRET-CODE-XYZ'));
  say(74, '/codes'); await run();
  check('/codes فهرست با «باطل کن»', /AB12-CD34/.test(tgSent.at(-1)?.text || '') && !!btnOf(/باطل کن: AB12-CD34/));
  press(btnOf(/باطل کن: AB12-CD34/)); await run();
  press(btnOf(/بله، انجام بده/)); await run();
  check('باطل از تلگرام', offline[0].status === 'revoked');
  say(75, '/offline'); await run(); say(76, '/cancel'); await run(); say(77, 'XYZ-9999'); await run();
  check('/cancel ⇒ متنِ بعدی دیگر کدِ کامپیوتر نیست', offline.length === 1 && !/ایمیلِ حسابِ مشتری/.test(tgSent.at(-1)?.text || ''));

  console.log('\n── ۷) خروج، عوض شدنِ رمز، و قفلِ ۵ بار ──');
  say(80, '/logout'); await run();
  n0 = tgSent.length;
  say(81, '/status'); await run();
  check('پس از /logout قفل', !tgSent.slice(n0).some((x) => /وضعیتِ سرور/.test(x.text || '')));
  say(82, '/login'); await run(); say(83, 'admin'); await run(); say(84, 'Support-1405-tg'); await run();
  check('ورودِ دوباره', /خوش آمدید/.test(tgSent.at(-1)?.text || ''));
  r = await call('POST', '/api/auth/change-password', { oldPassword: 'Support-1405-tg', newPassword: 'Support-1405-new' });
  //  عوض کردنِ رمز نشست‌های پنل را هم می‌بندد ⇒ آزمون دوباره وارد می‌شود
  const pwStatus = r.status;
  token = (await call('POST', '/api/auth/login', { username: 'admin', password: 'Support-1405-new' })).body?.token;
  n0 = tgSent.length;
  say(85, '/status'); await run();
  check('رمزِ پنل عوض شد ⇒ نشستِ ربات باطل', pwStatus === 200 && !!token && !tgSent.slice(n0).some((x) => /وضعیتِ سرور/.test(x.text || '')), pwStatus + JSON.stringify(tgSent.slice(n0)));
  for (let i = 0; i < 5; i++) { say(90 + i * 3, '/login'); await run(); say(91 + i * 3, 'admin'); await run(); say(92 + i * 3, `nope-${i}`); await run(); }
  check('۵ رمزِ غلط ⇒ قفلِ ۱۵ دقیقه', /۱۵ دقیقه/.test(tgSent.at(-1)?.text || ''), tgSent.at(-1)?.text);
  say(110, '/login'); await run(); say(111, 'admin'); await run(); say(112, 'Support-1405-new'); await run();
  check('در قفل حتی رمزِ درست هم راه نمی‌دهد', !tgSent.slice(-3).some((x) => /خوش آمدید/.test(x.text || '')) && tgDeleted.includes(112), JSON.stringify(tgSent.slice(-3)));
  r = await call('PUT', '/api/support-telegram', { chatId: '999' });
  await call('PUT', '/api/support-telegram', { chatId: String(OWNER) });
  r = await call('GET', '/api/support-telegram');
  check('عوض شدنِ chat id ⇒ قفل و نشست پاک', r.body.bot?.loggedIn === false);
  void before5;
} catch (e) {
  failed++; console.error('\n❌ آزمون شکست:', e.message); console.error(out.slice(-2000));
} finally {
  child.kill('SIGTERM'); fake.close(); tg.close();
  await wait(300);
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}
console.log(`\n${passed} موفق، ${failed} ناموفق`);
process.exit(failed ? 1 : 0);
