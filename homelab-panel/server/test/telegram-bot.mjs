// ---------------------------------------------------------------------------
//  رباتِ مالک، نسخهٔ کامل (1.50.53) — منو، پیشنهادِ دستورها، صندوق، «✍️ جواب»،
//  جوابِ آماده، رسانه در هر دو سو، بستنِ گفت‌وگو، پیامِ همگانی، هشدار و گزارش.
//  سرورِ حسابِ ساختگی + تلگرامِ ساختگی (با offset و getFile مثلِ واقعی) + پنلِ واقعی.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 400) : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-tgbot-'));
const TOKEN = '987654321:AAHfakeOwnerBotTokenForTests_abcdefghi';
const OWNER = 7770002;
const PASS = 'Owner-Bot-1405-ok';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 0xff, 0xd9]);

// ── سرورِ حسابِ ساختگی ──
const now = Date.now();
let cloudDown = false;
const threads = new Map();
const posts = [];
const uploads = [];
const statuses = [];
const broadcasts = [];
const media = new Map([['md1', { mime: 'image/jpeg', buf: JPEG }]]);
const fake = http.createServer((req, res) => {
  const chunks = []; req.on('data', (d) => chunks.push(d)); req.on('end', () => {
    const raw = Buffer.concat(chunks);
    const u = new URL(req.url, 'http://x'); const p = u.pathname;
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: Date.now() + 12 * 3600e3 });
    if (String(req.headers.authorization || '') !== 'Bearer tok-1') return j(401, { error: { code: 'unauthorized', message: 'x' } });
    if (cloudDown) return j(503, { error: { code: 'down', message: 'سرور در دسترس نیست' } });
    const body = () => JSON.parse(raw.toString() || '{}');
    let m;
    if (p === '/api/admin/telegram') return j(200, { telegram: { username: 'PumpStationBot' } });
    if (p === '/api/admin/support/threads' && req.method === 'GET') {
      const st = u.searchParams.get('status');
      return j(200, { threads: [...threads.values()].filter((t) => !st || t.status === st).map(({ messages, ...t }) => ({ ...t, lastMessage: messages.at(-1)?.body || '' })), unread: 0 });
    }
    if ((m = /^\/api\/admin\/support\/threads\/([^/]+)$/.exec(p)) && req.method === 'GET') {
      const t = threads.get(m[1]); if (!t) return j(404, { error: { code: 'thread_not_found', message: 'x' } });
      const { messages, ...thread } = t; return j(200, { thread, messages });
    }
    if ((m = /^\/api\/admin\/support\/threads\/([^/]+)\/messages$/.exec(p)) && req.method === 'POST') {
      const b = body(); posts.push({ thread: m[1], ...b });
      const t = threads.get(m[1]); const msg = { id: `a${posts.length}`, sender: 'admin', body: b.body || '', kind: b.kind || 'text', mediaId: b.mediaId || null, createdAt: Date.now() };
      if (t) { t.messages.push(msg); t.lastSender = 'admin'; t.updatedAt = msg.createdAt; }
      return j(201, { message: msg });
    }
    if ((m = /^\/api\/admin\/support\/threads\/([^/]+)\/media$/.exec(p)) && req.method === 'POST') {
      const t = threads.get(m[1]);
      if (!t || t.app !== 'pump') return j(400, { error: { code: 'media_not_supported', message: 'رسانه فقط در پشتیبانیِ پمپ' } });
      uploads.push({ thread: m[1], mime: req.headers['content-type'], size: raw.length, same: raw.equals(JPEG) });
      return j(201, { ok: true, mediaId: `up${uploads.length}`, kind: 'image', mime: req.headers['content-type'], size: raw.length });
    }
    if ((m = /^\/api\/admin\/support\/media\/([^/]+)$/.exec(p))) {
      const md = media.get(m[1]); if (!md) return j(404, { error: { code: 'media_gone', message: 'x' } });
      media.delete(m[1]); // ⛔ فقط در عبور
      res.setHeader('content-type', md.mime); return res.end(md.buf);
    }
    if ((m = /^\/api\/admin\/support\/threads\/([^/]+)\/status$/.exec(p)) && req.method === 'POST') {
      const b = body(); statuses.push({ thread: m[1], status: b.status }); const t = threads.get(m[1]); if (t) t.status = b.status;
      return j(200, { thread: t });
    }
    if (p === '/api/admin/support/broadcast' && req.method === 'POST') { const b = body(); broadcasts.push(b); return j(200, { sent: 12, targets: 13, failed: 1, app: b.app, target: b.target }); }
    if (p === '/api/admin/pump/stations') return j(200, { stations: [{ id: 'st1', code: 'P-1', name: 'پمپ یعقوبی', owner_name: 'احمد', owner_email: 'a@x.af', subscription_id: 'sub1', plan: 'pro', sub_status: 'active', ends_at: now + 3 * 864e5, created_at: now - 3600e3 }], total: 1 });
    if (p === '/api/admin/shops') return j(200, { shops: [], total: 0 });
    return j(404, { error: { code: 'not_found', message: p } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

// ── تلگرامِ ساختگی ──
const sent = []; // { method, body }
const answers = [];
let updates = [];
let nextUpdate = 1;
let confirmed = 0;
let nextMsg = 100;
const tg = http.createServer((req, res) => {
  const chunks = []; req.on('data', (d) => chunks.push(d)); req.on('end', () => {
    const raw = Buffer.concat(chunks);
    res.setHeader('content-type', 'application/json');
    const f = /^\/file\/bot([^/]+)\/(.+)$/.exec(req.url);
    if (f) { if (f[1] !== TOKEN) { res.statusCode = 404; return res.end('{}'); } res.setHeader('content-type', 'image/jpeg'); return res.end(JPEG); }
    const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url);
    if (!m || m[1] !== TOKEN) return res.end(JSON.stringify({ ok: false, description: 'Unauthorized' }));
    let body = {}; try { body = JSON.parse(raw.toString() || '{}'); } catch { body = { multipart: raw.toString('latin1') }; }
    const ok = (result) => res.end(JSON.stringify({ ok: true, result }));
    switch (m[2]) {
      case 'getUpdates': confirmed = Math.max(confirmed, body.offset || 0); return ok(updates.filter((x) => x.update_id >= confirmed));
      case 'getMe': return ok({ id: 1, is_bot: true, username: 'OwnerControlBot' });
      case 'getFile': return ok({ file_id: body.file_id, file_size: JPEG.length, file_path: 'photos/file_1.jpg' });
      case 'answerCallbackQuery': answers.push(body); return ok(true);
      default: { const id = ++nextMsg; sent.push({ method: m[2], body, id }); return ok(m[2] === 'editMessageText' ? { message_id: body.message_id } : { message_id: id }); }
    }
  });
});
await new Promise((r) => tg.listen(0, '127.0.0.1', r));
const msgs = () => sent.filter((x) => x.method === 'sendMessage' || x.method === 'editMessageText');
const lastText = () => msgs().at(-1)?.body.text || '';
const say = (text, extra = {}) => updates.push({ update_id: nextUpdate++, message: { message_id: 5000 + nextUpdate, chat: { id: OWNER, type: 'private' }, text, ...extra } });
const btnOf = (re) => {
  const all = sent.filter((x) => x.body && (x.body.reply_markup || (x.body.multipart && /inline_keyboard/.test(x.body.multipart))));
  for (let i = all.length - 1; i >= 0; i--) {
    let rm = all[i].body.reply_markup;
    if (!rm && all[i].body.multipart) { const mm = /name="reply_markup"\r\n\r\n(\{.*?\})\r\n--/s.exec(all[i].body.multipart); rm = mm ? JSON.parse(Buffer.from(mm[1], 'latin1').toString('utf8')) : null; }
    for (const row of (rm && rm.inline_keyboard) || []) for (const b of row) if (re.test(b.text)) return { b, id: all[i].method === 'editMessageText' ? all[i].body.message_id : all[i].id };
  }
  return null;
};
let cq = 0;
const press = (hit) => updates.push({ update_id: nextUpdate++, callback_query: { id: `cq${++cq}`, from: { id: OWNER }, data: hit.b.callback_data, message: { message_id: hit.id, chat: { id: OWNER } } } });

// ── پنل ──
const PORT = 5100 + Math.floor(Math.random() * 60);
const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
  env: { ...process.env, HLP_PORT: String(PORT), HLP_SITESYNC_PORT: String(PORT + 1), HLP_HOST: '127.0.0.1',
    HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_TUNNEL: '0', HLP_AI_ENABLED: '0',
    HLP_ACCOUNT_AUTOSTART: '0', HLP_PUMP_MIRROR: '0', HLP_SITE_MIRROR: '0',
    HLP_ACCOUNT_API: `http://127.0.0.1:${fake.address().port}`, HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret',
    HLP_TG_HEARTBEAT_MS: '0', HLP_TG_WATCH_MS: '1', HLP_GITHUB_API: `http://127.0.0.1:${fake.address().port}/gh`,
    HLP_TG_LONGPOLL: '0', HLP_TELEGRAM_API: `http://127.0.0.1:${tg.address().port}` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
let token = null;
const call = async (method, url, b) => {
  const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const run = async () => {
  for (let i = 0; i < 100; i++) {
    const r = await call('POST', '/api/automation/jobs/support-telegram/run', {});
    if (r.body?.error !== 'already_running') return r;
    await wait(100);
  }
  throw new Error('کار آزاد نشد');
};
const step = async (text, extra) => { say(text, extra); await run(); };

try {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* */ } await wait(250); }
  await call('POST', '/api/auth/setup', { username: 'admin', password: PASS });
  token = (await call('POST', '/api/auth/login', { username: 'admin', password: PASS })).body?.token;
  let r = await call('PUT', '/api/support-telegram', { token: TOKEN, chatId: String(OWNER), enabled: true, apps: ['pump', 'shop'] });
  check('تنظیم', r.status === 200 && r.body.enabled, JSON.stringify(r.body));

  console.log('\n── ۱) ورود، منوی ثابت و پیشنهادِ دستورها ──');
  await step('/login'); await step('admin'); await step(PASS);
  const welcome = msgs().find((x) => /خوش آمدید/.test(x.body.text || ''));
  check('پس از ورود منوی ثابتِ پایینِ صفحه می‌آید', !!welcome?.body.reply_markup?.keyboard && welcome.body.reply_markup.is_persistent === true, JSON.stringify(welcome?.body.reply_markup));
  const cmds = sent.find((x) => x.method === 'setMyCommands');
  check('پیشنهادِ دستورها («/») فقط برای گفت‌وگوی مالک', !!cmds && cmds.body.scope?.type === 'chat' && String(cmds.body.scope.chat_id) === String(OWNER) && cmds.body.commands.some((c) => c.command === 'inbox'), JSON.stringify(cmds?.body).slice(0, 300));
  check('گزارشِ روزانه/هشدار پیش از ورود نیامد', !sent.slice(0, sent.indexOf(welcome)).some((x) => /گزارشِ کنترول سنتر/.test(x.body.text || '')));
  await step('/start');
  check('/start راهنما با منو', /رباتِ کنترول سنتر/.test(lastText()) && !!msgs().at(-1).body.reply_markup?.keyboard);
  await step('📊 گزارش');
  check('دکمهٔ «📊 گزارش» از منو', /گزارشِ کنترول سنتر/.test(lastText()) && /حسابِ تازه/.test(lastText()), lastText());
  await step('/nothing');
  check('دستورِ ناشناخته ⇒ راهنما، نه جست‌وجو', /نمی‌شناسم/.test(lastText()));

  console.log('\n── ۲) پیامِ کاربر با عکس ⇒ خودِ عکس در تلگرام، با دکمه‌ها ──');
  const t1 = Date.now() + 10;
  threads.set('th1', { id: 'th1', app: 'pump', who: 'احمد', stationName: 'پمپ یعقوبی', stationId: 'st1', accountEmail: 'a@x.af', status: 'open', lastSender: 'user', unreadAdmin: 2, updatedAt: t1, messages: [{ id: 'u1', sender: 'user', body: 'این خطا را می‌دهد', kind: 'image', mediaId: 'md1', createdAt: t1 }] });
  threads.set('th2', { id: 'th2', app: 'shop', who: 'کریم', shopName: 'دکان کریم', shopId: 'sh1', status: 'open', lastSender: 'user', unreadAdmin: 1, updatedAt: t1, messages: [{ id: 'u2', sender: 'user', body: 'سلام، کمک', kind: 'text', createdAt: t1 }] });
  await wait(20);
  await run();
  const photo = sent.find((x) => x.method === 'sendPhoto');
  const cap = photo ? Buffer.from(photo.body.multipart, 'latin1').toString('utf8') : '';
  check('عکسِ کاربر خودش با sendPhoto آمد (با نامِ پمپ و متن)', !!photo && cap.includes('پمپ یعقوبی') && cap.includes('این خطا را می‌دهد') && cap.includes('filename="image.jpg"'), photo ? cap.slice(0, 300) : JSON.stringify(sent.map((x) => x.method)));
  check('رسانه از سرورِ حساب گرفته و همان‌جا پاک شد (کشِ پنل دارد)', !media.has('md1'));
  check('زیرِ عکس دکمه‌های ✍️ ⚡ 💬 👤 ✅', !!btnOf(/✍️ جواب/) && !!btnOf(/⚡ آماده/) && !!btnOf(/💬 گفت‌وگو/) && !!btnOf(/👤 حساب/) && !!btnOf(/✅ بستن/));
  const shopMsg = msgs().find((x) => /دکان کریم/.test(x.body.text || ''));
  check('پیامِ متنیِ فروشگاه با ایمیل/نام و دکمه‌ها', !!shopMsg && !!shopMsg.body.reply_markup?.inline_keyboard);

  console.log('\n── ۳) صندوق و کلِ گفت‌وگو ──');
  await step('💬 همهٔ پیام‌ها');
  check('صندوق: ۲ گفت‌وگوی منتظر', /۲ گفت‌وگو منتظر/.test(lastText()) && /پمپ یعقوبی/.test(lastText()) && /دکان کریم/.test(lastText()), lastText());
  press(btnOf(/پمپ یعقوبی/)); await run();
  check('باز کردنِ گفت‌وگو: پیام‌ها و ایمیلِ حساب', /💬/.test(lastText()) && /a@x\.af/.test(lastText()) && /عکس/.test(lastText()), lastText());

  console.log('\n── ۴) «✍️ جواب» — بی Reply، چند پیام پشتِ هم، با عکس ──');
  press(btnOf(/✍️ جواب/)); await run();
  check('حالتِ «در حالِ نوشتن» با نامِ کاربر', /در حالِ نوشتن به 🛢 پمپ · پمپ یعقوبی/.test(lastText()), lastText());
  await step('سلام احمد، الان بررسی می‌کنم');
  await step('یک لحظه');
  check('دو پیام به همان گفت‌وگو رفت', posts.filter((x) => x.thread === 'th1' && x.body).length === 2, JSON.stringify(posts));
  updates.push({ update_id: nextUpdate++, message: { message_id: 6001, chat: { id: OWNER, type: 'private' }, caption: 'این‌جا را بزنید', photo: [{ file_id: 'small', file_size: 10 }, { file_id: 'big', file_size: JPEG.length }] } });
  await run();
  check('عکسِ مالک به سرورِ حساب بار شد (همان بایت‌ها، image/jpeg)', uploads.length === 1 && uploads[0].same && uploads[0].mime === 'image/jpeg', JSON.stringify(uploads));
  check('و پیامِ رسانه با mediaId و caption ثبت شد', posts.some((x) => x.mediaId === 'up1' && x.kind === 'image' && x.body === 'این‌جا را بزنید'), JSON.stringify(posts.at(-1)));
  check('«✅ عکس به … رسید»', /عکس به 🛢 پمپ · پمپ یعقوبی رسید/.test(lastText()), lastText());
  await step('/status');
  check('⛔ دستور در حالِ نوشتن به کاربر نرفت', !posts.some((x) => /status/.test(x.body || '')) && /وضعیتِ سرور/.test(lastText()));
  await step('🔎 جست‌وجو');
  await step('یعقوبی');
  check('⛔ دکمهٔ منو حالتِ نوشتن را بست ⇒ متنِ بعدی جست‌وجو است، نه پیام به کاربر', !posts.some((x) => x.body === 'یعقوبی') && /پمپ یعقوبی/.test(lastText()), lastText());

  console.log('\n── ۵) رسانه برای فروشگاه ⇒ پیغامِ روشن، نه گم شدن ──');
  const shopCompose = shopMsg.body.reply_markup.inline_keyboard[0].find((b) => /✍️/.test(b.text));
  updates.push({ update_id: nextUpdate++, callback_query: { id: 'cq-shop', from: { id: OWNER }, data: shopCompose.callback_data, message: { message_id: 1, chat: { id: OWNER } } } });
  await run();
  updates.push({ update_id: nextUpdate++, message: { message_id: 6002, chat: { id: OWNER, type: 'private' }, photo: [{ file_id: 'big', file_size: JPEG.length }] } });
  await run();
  check('عکس به فروشگاه ⇒ «فقط پمپ»، چیزی بار نشد', uploads.length === 1 && /فقط در پشتیبانیِ پمپ/.test(lastText()), lastText());
  await step('/done');
  check('/done پایانِ نوشتن', /تمام شد/.test(lastText()));

  console.log('\n── ۶) جوابِ آماده ──');
  press(btnOf(/⚡ آماده/)); await run();
  check('فهرستِ جواب‌های آماده', !!btnOf(/پیامتان رسید/), lastText());
  const nPosts = posts.length;
  press(btnOf(/پیامتان رسید/)); await run();
  check('پیش از تأیید چیزی نرفت', posts.length === nPosts && /برود؟/.test(lastText()));
  press(btnOf(/بله، انجام بده/)); await run();
  check('جوابِ آماده رسید', posts.length === nPosts + 1 && /پیامتان رسید/.test(posts.at(-1).body), JSON.stringify(posts.at(-1)));
  await step('/quick');
  press(btnOf(/➕ افزودن/)); await run();
  await step('فردا ساعت ۹ تماس می‌گیرم.');
  check('افزودنِ جوابِ آماده', /فردا ساعت ۹/.test(lastText()) && !posts.some((x) => /فردا ساعت/.test(x.body || '')), lastText());
  press(btnOf(/🗑 .*فردا ساعت/)); await run();
  press(btnOf(/بله، انجام بده/)); await run();
  check('پاک کردنِ جوابِ آماده', !/فردا ساعت/.test(lastText()) && /جواب‌های آماده/.test(lastText()), lastText());

  console.log('\n── ۷) بستن و باز کردنِ گفت‌وگو ──');
  press(btnOf(/✅ بستن/)); await run();
  check('بستنِ گفت‌وگو روی سرورِ حساب', statuses.some((x) => x.status === 'closed'), JSON.stringify(statuses));

  console.log('\n── ۸) پیامِ همگانی ──');
  await step('⛽ پمپ بنزین');
  await step('📣 پیام به همهٔ پمپ‌ها');
  press(btnOf(/رو به پایان/)); await run();
  await step('اشتراکتان رو به پایان است؛ برای تمدید پیام بدهید.');
  check('پیش‌نمایش پیش از فرستادن', /پیش‌نمایش/.test(lastText()) && broadcasts.length === 0, lastText());
  press(btnOf(/بله، بفرست/)); await run();
  check('پیامِ همگانی رفت (پمپ، رو به پایان)', broadcasts.length === 1 && broadcasts[0].app === 'pump' && broadcasts[0].target === 'expiring' && /تمدید/.test(broadcasts[0].body), JSON.stringify(broadcasts));
  check('«به ۱۲ نفر رسید (۱ نرسید)»', /۱۲ نفر رسید/.test(lastText()) && /۱ نرسید/.test(lastText()), lastText());
  press(btnOf(/بله، بفرست/)); await run();
  check('همان تأیید دو بار نمی‌فرستد', broadcasts.length === 1);

  console.log('\n── ۹) تنظیمات ──');
  await step('⚙️ تنظیمات');
  press(btnOf(/خاموش کردنِ گزارشِ روزانه/)); await run();
  check('خاموش کردنِ گزارشِ روزانه', /گزارشِ روزانه: ⛔ خاموش/.test(lastText()), lastText());
  press(btnOf(/^• ?۹$|^۱۰$/)); await run();
  check('ساعتِ گزارش ⇒ روشن و ساعتِ تازه', /گزارشِ روزانه: ✅ ساعتِ/.test(lastText()), lastText());

  console.log('\n── ۱۰) هشدارِ سرورِ حساب، و دورِ بی‌سرورِ حساب نمی‌افتد ──');
  cloudDown = true;
  for (let i = 0; i < 3; i++) { await run(); await wait(5); }
  check('۳ دور بی‌جواب ⇒ 🚨 سرورِ حساب', msgs().some((x) => /🚨 سرورِ حساب جواب نمی‌دهد/.test(x.body.text || '')));
  r = await run();
  check('کار با سرورِ حسابِ خاموش هم «ok» می‌ماند', r.body.status === 'ok', JSON.stringify(r.body).slice(0, 200));
  cloudDown = false;
  await run();
  check('برگشت ⇒ 🟢', /سرورِ حساب برگشت/.test(lastText()), lastText());

  console.log('\n── ۱۱) 🛠 منوی سرور ──');
  const kb = () => (msgs().at(-1)?.body.reply_markup?.keyboard || []).flat().map((x) => x.text);
  await step('🛠 سرور');
  check('منوی پایینِ صفحه به منوی سرور عوض شد', ['⬆️ آپدیتِ کنترول سنتر', '🗄 سرورِ حساب', '💾 پشتیبان‌ها', '⚙️ کارهای خودکار', '🌍 تونل و دامنه', '📜 خطاهای اخیر', '🔄 ری‌استارتِ کنترول سنتر', '🏠 منوی اصلی'].every((t) => kb().includes(t)) && /وضعیتِ سرور/.test(lastText()), JSON.stringify(kb()));
  await step('⬆️ آپدیتِ کنترول سنتر');
  check('آپدیتِ کنترول سنتر: نسخهٔ نصب‌شده و پیغامِ گیت‌هاب', /نسخهٔ نصب‌شده/.test(lastText()) && /گیت‌هاب/.test(lastText()) && /نصبِ خودکار/.test(lastText()), lastText());
  await step('/update');
  check('/update همان صفحه', /آپدیتِ کنترول سنتر/.test(lastText()));
  press(btnOf(/نصبِ خودکار (روشن|خاموش)/)); await run();
  check('روشن/خاموش کردنِ نصبِ خودکار', /نصبِ خودکار \(هر ساعت\): (✅ روشن|⛔ خاموش)/.test(lastText()), lastText());
  await step('🔄 ری‌استارتِ کنترول سنتر');
  check('ری‌استارت فقط با تأیید (این‌جا زده نمی‌شود)', /ری‌استارت شود؟/.test(lastText()) && !!btnOf(/بله، انجام بده/));
  await step('💾 پشتیبان‌ها');
  press(btnOf(/پشتیبانِ تازه/)); await run();
  check('پشتیبانِ تازه از تلگرام', /پشتیبان ساخته شد/.test(lastText()), lastText());
  await step('⚙️ کارهای خودکار');
  check('فهرستِ کارهای خودکار', /کارهای خودکار/.test(lastText()) && !!btnOf(/^▶ /), lastText());
  press(btnOf(/^▶ .*پشتیبان/) || btnOf(/^▶ /)); await run();
  for (let i = 0; i < 40 && !msgs().slice(-3).some((x) => /^(✅|⚠️) «/.test(x.body.text || '')); i++) await wait(250);
  check('اجرای یک کارِ خودکار و نتیجه‌اش', msgs().slice(-4).some((x) => /^(✅|⚠️) «/.test(x.body.text || '')), msgs().slice(-3).map((x) => x.body.text).join(' | '));
  await step('📜 خطاهای اخیر');
  check('خطاهای اخیر', /📜/.test(lastText()), lastText());
  await step('🗄 سرورِ حساب');
  check('سرورِ حساب: روشن/خاموش و نسخه', /سرورِ حساب/.test(lastText()) && /(🟢 روشن|🔴 خاموش)/.test(lastText()), lastText());

  console.log('\n── ۱۲) هر برنامه منوی خودش ──');
  await step('🏠 منوی اصلی');
  check('منوی اصلی: پمپ، فروشگاه، سایت‌ها، سرور', ['⛽ پمپ بنزین', '🛒 فروشگاه', '🌐 سایت‌ها', '🛠 سرور'].every((t) => kb().includes(t)), JSON.stringify(kb()));
  await step('⛽ پمپ بنزین');
  check('منوی پمپ: پیام‌ها، جست‌وجو، اشتراک‌ها، کدِ آفلاین، آپدیت، همگانی، گزارش', ['💬 پیام‌های پمپ', '🔎 جست‌وجوی پمپ', '⏳ اشتراک‌های پمپ', '🔑 کدِ آفلاین', '📋 کدهای آفلاین', '⬆️ آپدیتِ برنامهٔ پمپ', '📣 پیام به همهٔ پمپ‌ها', '📊 گزارشِ پمپ', '🏠 منوی اصلی'].every((t) => kb().includes(t)) && /پمپ بنزین/.test(lastText()), JSON.stringify(kb()));
  threads.get('th2').status = 'open'; threads.get('th2').lastSender = 'user';
  threads.get('th1').status = 'open'; threads.get('th1').lastSender = 'user';
  await step('💬 پیام‌های پمپ');
  check('پیام‌های پمپ فقط پمپ', /پمپ یعقوبی/.test(lastText()) && !/دکان کریم/.test(lastText()), lastText());
  await step('یعقوبی');
  check('جست‌وجو در منوی پمپ ⇒ کارتِ پمپ', /پمپ یعقوبی/.test(lastText()) && /فعال/.test(lastText()), lastText());
  await step('🛒 فروشگاه');
  await step('💬 پیام‌های فروشگاه');
  check('پیام‌های فروشگاه فقط فروشگاه', /دکان کریم/.test(lastText()) && !/پمپ یعقوبی/.test(lastText()), lastText());
  await step('🌐 سایت‌ها');
  check('منوی سایت‌ها', /سایت/.test(lastText()) && kb().includes('⬆️ آپدیتِ سایت‌ها') && kb().includes('💬 پیام‌های سایت‌ها'), JSON.stringify(kb()));
  await step('/pump');
  check('/pump همان منوی پمپ', kb().includes('💬 پیام‌های پمپ'));
  const nPosts12 = posts.length;
  {
    // ⛔ برچسبِ منو حتی با Reply روی پیامِ کاربر هرگز به کاربر نمی‌رود
    updates.push({ update_id: nextUpdate++, message: { message_id: 7001, chat: { id: OWNER, type: 'private' }, text: '🏠 منوی اصلی', reply_to_message: { message_id: photo ? photo.id : 1 } } });
    await run();
  }
  check('⛔ برچسبِ منو با Reply هم به کاربر نرفت', posts.length === nPosts12 && kb().includes('⛽ پمپ بنزین'), JSON.stringify(posts.slice(nPosts12)));
} catch (e) {
  failed++; console.error('\n❌ آزمون شکست:', e.stack); console.error(out.slice(-2500));
} finally {
  child.kill('SIGTERM'); fake.close(); tg.close();
  await wait(300);
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}
console.log(`\n${passed} موفق، ${failed} ناموفق`);
process.exit(failed ? 1 : 0);
