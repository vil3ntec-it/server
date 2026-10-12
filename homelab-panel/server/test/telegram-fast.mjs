// ---------------------------------------------------------------------------
//  رباتِ مالک، سریع (1.50.53) — شنوندهٔ همیشگی (long-poll): جوابِ دستور و دکمه زیرِ
//  یک ثانیه، بی هیچ «اجرا»ی دستیِ کار؛ و هرگز دو getUpdatesِ هم‌زمان (۴۰۹).
//  تلگرامِ ساختگی مثلِ واقعی نگه می‌دارد: getUpdates با timeout تا رسیدنِ پیام باز می‌ماند.
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
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-tgfast-'));
const TOKEN = '987654321:AAHfakeFastBotTokenForTests_abcdefghijk';
const OWNER = 7770003;
const PASS = 'Fast-Bot-1405-ok';

// ── سرورِ حسابِ ساختگیِ حداقلی ──
const fake = http.createServer((req, res) => {
  req.resume(); req.on('end', () => {
    const p = new URL(req.url, 'http://x').pathname;
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: Date.now() + 12 * 3600e3 });
    if (p === '/api/admin/telegram') return j(200, { telegram: { username: 'PumpStationBot' } });
    if (p === '/api/admin/support/threads') return j(200, { threads: [], unread: 0 });
    return j(404, { error: { code: 'not_found', message: p } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

// ── تلگرامِ ساختگی با long-poll ──
const sent = [];
const answers = [];
const updates = [];
let nextUpdate = 1;
let confirmed = 0;
let concurrent = 0;
let maxConcurrent = 0;
let polls = 0;
let pending = []; // getUpdatesهای باز
const flush = () => {
  const ready = updates.filter((u) => u.update_id >= confirmed);
  if (!ready.length) return;
  for (const w of pending.splice(0)) w(ready.filter((u) => u.update_id >= w.offset));
};
const tg = http.createServer((req, res) => {
  const chunks = []; req.on('data', (d) => chunks.push(d)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url);
    if (!m || m[1] !== TOKEN) return res.end(JSON.stringify({ ok: false, description: 'Unauthorized' }));
    let body = {}; try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { /* */ }
    const ok = (result) => res.end(JSON.stringify({ ok: true, result }));
    if (m[2] === 'getUpdates') {
      polls++;
      concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
      confirmed = Math.max(confirmed, body.offset || 0);
      const done = (list) => { concurrent--; clearTimeout(timer); ok(list); };
      const ready = updates.filter((u) => u.update_id >= confirmed);
      if (ready.length || !body.timeout) return done(ready);
      const w = (list) => done(list); w.offset = confirmed;
      pending.push(w);
      const timer = setTimeout(() => { pending = pending.filter((x) => x !== w); done([]); }, Math.min(body.timeout, 3) * 1000);
      res.on('close', () => { if (!res.writableEnded) { pending = pending.filter((x) => x !== w); concurrent--; clearTimeout(timer); } });
      return;
    }
    if (m[2] === 'getMe') return ok({ id: 1, is_bot: true, username: 'OwnerFastBot' });
    if (m[2] === 'answerCallbackQuery') { answers.push({ ...body, at: Date.now() }); return ok(true); }
    sent.push({ method: m[2], body, at: Date.now() });
    return ok({ message_id: 100 + sent.length });
  });
});
await new Promise((r) => tg.listen(0, '127.0.0.1', r));
const say = (text) => { updates.push({ update_id: nextUpdate++, message: { message_id: 9000 + nextUpdate, chat: { id: OWNER, type: 'private' }, text } }); flush(); return Date.now(); };
const replyAfter = async (t0, re, ms = 4000) => {
  for (let i = 0; i < ms / 25; i++) {
    const hit = sent.find((x) => x.at >= t0 && re.test(x.body.text || ''));
    if (hit) return hit.at - t0;
    await wait(25);
  }
  return null;
};

// ── پنل (کارِ ۳ ثانیه‌ای هم روشن است — مثلِ واقعی) ──
const PORT = 5200 + Math.floor(Math.random() * 60);
const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
  env: { ...process.env, HLP_PORT: String(PORT), HLP_SITESYNC_PORT: String(PORT + 1), HLP_HOST: '127.0.0.1',
    HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_TUNNEL: '0', HLP_AI_ENABLED: '0',
    HLP_ACCOUNT_AUTOSTART: '0', HLP_PUMP_MIRROR: '0', HLP_SITE_MIRROR: '0',
    HLP_ACCOUNT_API: `http://127.0.0.1:${fake.address().port}`, HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret',
    HLP_TG_HEARTBEAT_MS: '0', HLP_TG_WATCH_MS: '0',
    HLP_TELEGRAM_API: `http://127.0.0.1:${tg.address().port}` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
let token = null;
const call = async (method, url, b) => {
  const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

try {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* */ } await wait(250); }
  await call('POST', '/api/auth/setup', { username: 'admin', password: PASS });
  token = (await call('POST', '/api/auth/login', { username: 'admin', password: PASS })).body?.token;
  const r = await call('PUT', '/api/support-telegram', { token: TOKEN, chatId: String(OWNER), enabled: true, apps: ['pump', 'shop'] });
  check('تنظیم', r.status === 200 && r.body.enabled);
  for (let i = 0; i < 80 && polls === 0; i++) await wait(100);
  check('شنوندهٔ همیشگی خودش شروع کرد (بی «اجرا»ی دستی)', polls > 0, polls);

  console.log('\n── سرعت ──');
  let t = say('/login');
  const dLogin = await replyAfter(t, /نامِ کاربری/);
  check('جوابِ /login زیرِ یک ثانیه', dLogin !== null && dLogin < 1000, dLogin);
  t = say('admin'); await replyAfter(t, /رمز/);
  t = say(PASS);
  const dPass = await replyAfter(t, /خوش آمدید/);
  check('ورود زیرِ یک ثانیه', dPass !== null && dPass < 1000, dPass);
  t = say('/status');
  const dStatus = await replyAfter(t, /وضعیتِ سرور/);
  check('/status زیرِ یک ثانیه', dStatus !== null && dStatus < 1000, dStatus);
  t = say('⛽ پمپ بنزین');
  const dMenu = await replyAfter(t, /پمپ بنزین/);
  check('عوض شدنِ منو (پمپ) زیرِ یک ثانیه', dMenu !== null && dMenu < 1000, dMenu);
  t = say('💾 پشتیبان‌ها');
  await replyAfter(t, /پشتیبان‌های کنترول سنتر/);
  const menu = sent.filter((x) => x.body.reply_markup?.inline_keyboard).at(-1);
  const b = menu.body.reply_markup.inline_keyboard.flat().find((x) => /پشتیبانِ تازه/.test(x.text));
  t = Date.now();
  updates.push({ update_id: nextUpdate++, callback_query: { id: 'cq1', from: { id: OWNER }, data: b.callback_data, message: { message_id: 1, chat: { id: OWNER } } } }); flush();
  const dBtn = await replyAfter(t, /پشتیبان ساخته شد/);
  const ans = answers.find((a) => a.callback_query_id === 'cq1');
  check('دکمه زیرِ یک ثانیه (و چرخکِ دکمه همان لحظه بسته شد)', dBtn !== null && dBtn < 1000 && ans && ans.at - t < 1000, `${dBtn} ${ans && ans.at - t}`);

  console.log('\n── ⛔ هرگز دو getUpdatesِ هم‌زمان (۴۰۹) ──');
  const rr = await call('POST', '/api/automation/jobs/support-telegram/run', {});
  await wait(300);
  check('کارِ ۳ ثانیه‌ای با شنوندهٔ روشن getUpdates نمی‌زند', maxConcurrent === 1, `maxConcurrent=${maxConcurrent} ${JSON.stringify(rr.body).slice(0, 120)}`);
  const fc = await call('POST', '/api/support-telegram/find-chat', {});
  check('«پیدا کردن» با شنوندهٔ روشن هم getUpdatesِ دوم نمی‌زند', maxConcurrent === 1, `${maxConcurrent} ${fc.status}`);

  console.log('\n── خاموش کردن ⇒ شنونده می‌ایستد ──');
  await call('PUT', '/api/support-telegram', { enabled: false });
  await wait(3500);
  const before = sent.length;
  say('/status');
  await wait(1500);
  check('پلِ خاموش ⇒ جوابی نمی‌دهد', sent.length === before, sent.length - before);
} catch (e) {
  failed++; console.error('\n❌ آزمون شکست:', e.stack); console.error(out.slice(-2000));
} finally {
  child.kill('SIGTERM'); fake.close(); tg.closeAllConnections?.(); tg.close();
  await wait(300);
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}
console.log(`\n${passed} موفق، ${failed} ناموفق`);
process.exit(failed ? 1 : 0);
