// ---------------------------------------------------------------------------
//  «از پشتیبانی بخواه» در پل — صفِ درخواست‌های ساخت‌یافته و «درستش کن» ِ یک‌کلیکی (۱.۵۲.۰؛ shop ‎support-requests.v1‎)
//      node test/console-support-requests.mjs
//
//  سرورِ حسابِ ساختگی به شکلِ قراردادِ `routes/console-support-requests.js`. سنجیده می‌شود:
//    • بی توانایی ⇒ «در دسترس نیست» و هر نوشتن ‎501‎ بی درخواست
//    • خواندن (بیننده هم): پالایه‌ها بی‌کم‌وکاست به سرورِ حساب، پاسخ فقط فیلدهای شناخته (نه راز، نه واقعیتِ ناجور)
//    • ردِ پیش از پل: حال/کد/دکان/سنِ نادرست، بی کلید، پول بی تأیید، روزِ بد
//    • نقش: viewer هیچ نوشتنی؛ operator «حل شد» و «کد را دوباره بفرست» آری، پرچم و پول نه (۴۰۳ بی درخواست)
//    • نوشتن: `shopId` ِ همان کارت، ‎Idempotency-Key‎ ِ بسته به کاربر به سرورِ حساب، بازپخشِ همان کلید ⇒ یک درخواست و یک ردیفِ دفتر
//    • خطای سرورِ حساب (دکانِ دیگر ⇒ ۴۰۴، «غیرفعال کردنِ سرویس» ⇒ ۴۰۹) همان‌طور بالا می‌رود
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PANEL = Number(process.env.TEST_PORT || 4971);
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'support-requests-'));
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 400)}`);
};

const NOW = Date.now();
let caps = ['actor.v1'];
const seen = [];
const replies = new Map();
const REQ = {
  id: 'srq_1', threadId: 'thr_1', shopId: 's1', shopName: 'دکانِ الف', who: 'احمد', code: 'flag_off:shop.orders', problem: 'flag_off',
  param: 'shop.orders', title: 'سفارشِ آنلاین برای این دکان خاموش است', fix: 'enable_flag', needsShop: true, lang: 'fa',
  context: { appVersion: '2.14.5', screen: 'orders:setup', email: 'leak@x.af', token: 'SECRET-TOKEN-1234567890' },
  status: 'open', unreadAdmin: 1, createdAt: NOW - 60_000, updatedAt: NOW, fixes: [], secret: 'SECRET-FIELD',
};
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    let body = null;
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null; } catch { body = null; }
    const j = (code, obj, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, version: '9.9.9' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: caps, serverTime: NOW });
    seen.push({ method: req.method, path: p, query: Object.fromEntries(u.searchParams), body, idem: req.headers['idempotency-key'] || '', actor: req.headers['x-actor-role'] || '' });
    if (!caps.includes('support-requests.v1')) return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
    if (p === '/api/admin/support-requests' && req.method === 'GET') return j(200, { requests: [REQ], open: 1, unread: 1 });
    if (p === '/api/admin/support-requests/srq_1' && req.method === 'GET') {
      return j(200, { request: REQ, messages: [{ id: 'msg_1', sender: 'user', body: 'لطفاً سفارشِ آنلاین را برای دکانِ من روشن کنید.', createdAt: NOW, token: 'x' }],
        state: { flag: { key: 'shop.orders', effective: false, explicit: false, hold: false, secret: 'S' } } });
    }
    if (p === '/api/admin/support-requests/srq_1/sync-error') return j(200, { available: true, restricted: true, weekCount: 2, errors: [{ id: 'cer_1', message: '۴ تغییر پذیرفته نشد', at: NOW }] });
    const fx = /^\/api\/admin\/support-requests\/(srq_1|srq_held)\/(resolve|fix\/[a-z-]+)$/.exec(p);
    //  همان `admin-write-once` ِ سرورِ حساب: همان کلید ⇒ همان پاسخ با ‎Idempotent-Replayed‎
    const idem = req.headers['idempotency-key'];
    if (fx && req.method === 'POST' && idem && replies.has(idem)) return j(200, replies.get(idem), { 'Idempotent-Replayed': 'true' });
    const jr = (code, obj) => { if (idem && code === 200) replies.set(idem, obj); return j(code, obj); };
    if (fx && req.method === 'POST') {
      if (body?.shopId && body.shopId !== 's1') return j(404, { error: { code: 'request_not_found', message: 'این درخواست پیدا نشد' } });
      if (fx[1] === 'srq_held') return j(409, { error: { code: 'shop_hold_active', message: 'این سرویس با «غیرفعال کردنِ سرویس» بسته شده' } });
      if (fx[2] === 'resolve') return jr(200, { ok: true, request: { ...REQ, status: 'resolved', resolvedAt: NOW }, unchanged: false });
      return jr(200, { ok: true, already: false, fix: { action: fx[2].slice(4).replace(/-/g, '_'), result: 'done', by: 'boss', at: NOW,
        before: { effective: false }, after: { effective: true, token: 'NO' } }, request: REQ, state: {}, reply: { messageId: 'msg_2', pushed: 2 } });
    }
    return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const FAKE_URL = `http://127.0.0.1:${fake.address().port}`;
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
    HLP_SITESYNC: '0', HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_AUTOMATION: '0', HLP_STATIONS: '0',
    HLP_ACCOUNT_API: FAKE_URL, HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret',
    HLP_AUTH_RATE_LIMIT: '100000', HLP_TG_WATCH_MS: '0', HLP_TG_LONGPOLL: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));
const BASE = `http://127.0.0.1:${PANEL}`;
async function api(method, p, body, token) {
  const res = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}
const posts = (re) => seen.filter((s) => s.method === 'POST' && re.test(s.path)).length;
const lastPost = (re) => seen.filter((s) => s.method === 'POST' && re.test(s.path)).at(-1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SR = '/api/account-admin/console/support-requests';

try {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ } await sleep(250); }
  await api('POST', '/api/auth/setup', { username: 'owner', password: 'Acc-1405-owner' });
  const login = async (u, pw) => (await api('POST', '/api/auth/login', { username: u, password: pw })).json?.token;
  const owner = await login('owner', 'Acc-1405-owner');
  for (const [u, role] of [['op1', 'operator'], ['view1', 'viewer']]) await api('POST', '/api/auth/users', { username: u, password: `Acc-${role}-1405`, role }, owner);
  const op = await login('op1', 'Acc-operator-1405');
  const viewer = await login('view1', 'Acc-viewer-1405');
  check('سه نشست', Boolean(owner && op && viewer));
  const K = (over = {}) => ({ shopId: 's1', idempotencyKey: `srq-${Math.random().toString(36).slice(2, 12)}`, ...over });

  console.log('\n── بی `support-requests.v1` ──');
  const old = await api('GET', SR, undefined, viewer);
  check('⛔ صف ⇒ ‎available: false‎ با نامِ توانایی (نه فهرستِ ساختگی)', old.status === 200 && old.json?.available === false && old.json?.capability === 'support-requests.v1', old.text.slice(0, 200));
  const oldW = await api('POST', `${SR}/srq_1/fix/enable-flag`, K(), owner);
  const oldR = await api('POST', `${SR}/srq_1/resolve`, K(), owner);
  check('⛔ «درستش کن» و «حل شد» ⇒ ‎501 capability_missing‎ و هیچ درخواستی', oldW.status === 501 && oldR.status === 501 && posts(/support-requests/) === 0, `${oldW.status} ${oldR.status}`);

  caps = ['actor.v1', 'support-requests.v1'];
  console.log('\n── خواندن ──');
  const list = await api('GET', `${SR}?status=all&problem=flag_off:shop.orders&shop=s1&minAgeHours=2&maxAgeHours=48`, undefined, viewer);
  const lq = seen.filter((s) => s.method === 'GET' && s.path === '/api/admin/support-requests').at(-1)?.query || {};
  check('viewer صف را می‌بیند؛ پالایه‌ها همان‌طور به سرورِ حساب', list.status === 200 && list.json?.available === true && list.json.requests?.[0]?.id === 'srq_1'
    && lq.status === 'all' && lq.problem === 'flag_off:shop.orders' && lq.shop === 's1' && lq.minAgeHours === '2' && lq.maxAgeHours === '48', `${list.text.slice(0, 200)} ${JSON.stringify(lq)}`);
  const r0 = list.json?.requests?.[0] || {};
  check('⛔ پاسخ فقط فیلدهای شناخته — نه رازِ ردیف، نه واقعیتِ ناجور (ایمیل/توکن)', !list.text.includes('SECRET') && !list.text.includes('leak@x.af')
    && r0.context?.appVersion === '2.14.5' && r0.context?.screen === 'orders:setup' && r0.title === REQ.title && r0.fix === 'enable_flag', JSON.stringify(r0));
  const det = await api('GET', `${SR}/srq_1`, undefined, viewer);
  check('پرونده: درخواست، پیام‌ها و حالِ زندهٔ پرچم (فقط فیلدهای شناخته)', det.status === 200 && det.json?.messages?.[0]?.body?.includes('روشن کنید') && det.json.state?.flag?.effective === false
    && !det.text.includes('"secret"') && !('token' in (det.json.messages[0] || {})), det.text.slice(0, 200));
  const se = await api('GET', `${SR}/srq_1/sync-error?shopId=s1`, undefined, viewer);
  check('خطای همگام‌سازی: محدود و بی Stack وقتی سرورِ حساب نگفت', se.status === 200 && se.json?.restricted === true && se.json.errors?.[0]?.message === '۴ تغییر پذیرفته نشد' && !('stack' in (se.json.errors[0] || {})), se.text.slice(0, 200));

  console.log('\n── ردِ پیش از پل ──');
  const n0 = seen.length;
  const bads = [
    await api('GET', `${SR}?status=weird`, undefined, viewer),
    await api('GET', `${SR}?problem=DROP%20TABLE`, undefined, viewer),
    await api('GET', `${SR}?minAgeHours=-1`, undefined, viewer),
    await api('POST', `${SR}/srq_1/fix/enable-flag`, K({ shopId: 'bad id' }), owner),
    await api('POST', `${SR}/srq_1/fix/enable-flag`, { shopId: 's1' }, owner),
    await api('POST', `${SR}/srq_1/fix/grant-subscription`, K(), owner),
    await api('POST', `${SR}/srq_1/fix/grant-subscription`, K({ confirm: true, days: 9999 }), owner),
    await api('POST', `${SR}/srq_1/fix/raise-device-limit`, K(), owner),
  ];
  check('⛔ حال/کد/سن/دکان، بی کلید، پول بی تأیید، روزِ بد ⇒ ۴۰۰ و هیچ درخواستی', bads.every((b) => b.status === 400) && seen.length === n0
    && bads[5].json?.error === 'confirm_required' && bads[7].json?.error === 'confirm_required' && bads[6].json?.error === 'bad_days', bads.map((b) => `${b.status}:${b.json?.error}`).join(' '));

  console.log('\n── نقش ──');
  const p0 = posts(/support-requests/);
  const vR = await api('POST', `${SR}/srq_1/resolve`, K(), viewer);
  const vF = await api('POST', `${SR}/srq_1/fix/resend-email-code`, K(), viewer);
  const oF = await api('POST', `${SR}/srq_1/fix/enable-flag`, K(), op);
  const oG = await api('POST', `${SR}/srq_1/fix/grant-subscription`, K({ confirm: true }), op);
  const oD = await api('POST', `${SR}/srq_1/fix/raise-device-limit`, K({ confirm: true }), op);
  check('⛔ viewer هیچ نوشتنی؛ operator پرچم و پول نه — ۴۰۳ و هیچ درخواستی', [vR, vF, oF, oG, oD].every((r) => r.status === 403) && posts(/support-requests/) === p0,
    [vR, vF, oF, oG, oD].map((r) => r.status).join(' '));
  const oRes = await api('POST', `${SR}/srq_1/resolve`, K({ note: 'تلفنی گفت حل شد' }), op);
  check('operator «حل شد» می‌زند ⇒ همان دکان و یادداشت به سرورِ حساب', oRes.status === 200 && oRes.json?.request?.status === 'resolved'
    && lastPost(/resolve$/)?.body?.shopId === 's1' && lastPost(/resolve$/)?.body?.note === 'تلفنی گفت حل شد', oRes.text.slice(0, 160));
  const oMail = await api('POST', `${SR}/srq_1/fix/resend-email-code`, K({ shopId: '' }), op);
  check('operator «کد را دوباره بفرست» (درخواستِ بی‌دکان: shopId خالی)', oMail.status === 404 || oMail.status === 200, oMail.text.slice(0, 160));

  console.log('\n── «روشن کن» با کلیدِ یکتایی ──');
  const key = 'srq-enable-0001';
  const f1 = await api('POST', `${SR}/srq_1/fix/enable-flag`, K({ idempotencyKey: key, resolve: true }), owner);
  const up1 = lastPost(/fix\/enable-flag$/);
  check('admin ⇒ همان دکان، `resolve` و کلیدِ بسته به کاربرِ پنل (‎u<id>.<کلید>‎)', f1.status === 200 && f1.json?.fix?.result === 'done' && f1.json.replied === true
    && f1.json.pushed === 2 && up1?.body?.shopId === 's1' && up1.body.resolve === true && /^u\d+\.srq-enable-0001$/.test(up1.idem), `${f1.text.slice(0, 160)} ${JSON.stringify(up1)}`);
  check('⛔ «پس» فقط فیلدهای شناخته', f1.json?.fix?.after?.effective === true && !('token' in (f1.json?.fix?.after || {})), JSON.stringify(f1.json?.fix));
  const n1 = posts(/fix\/enable-flag$/);
  const f2 = await api('POST', `${SR}/srq_1/fix/enable-flag`, K({ idempotencyKey: key, resolve: true }), owner);
  check('⛔ همان کلید ⇒ همان پاسخ از سرورِ حساب (‎Idempotent-Replayed‎)، بی ردیفِ دومِ دفتر', f2.status === 200 && f2.json?.fix?.result === 'done' && f2.json?.replayed === true, f2.text.slice(0, 160));
  const g = await api('POST', `${SR}/srq_1/fix/grant-subscription`, K({ confirm: true, days: 30 }), owner);
  const gu = lastPost(/fix\/grant-subscription$/);
  check('تمدید با تأیید ⇒ ‎confirm: true‎ و ‎days: 30‎ به سرورِ حساب', g.status === 200 && gu?.body?.confirm === true && gu.body.days === 30, `${g.text.slice(0, 120)} ${JSON.stringify(gu?.body)}`);
  const dv = await api('POST', `${SR}/srq_1/fix/raise-device-limit`, K({ confirm: true, devices: 4 }), owner);
  check('سقفِ دستگاه ⇒ ‎devices: 4‎', dv.status === 200 && lastPost(/raise-device-limit$/)?.body?.devices === 4, dv.text.slice(0, 120));

  console.log('\n── خطای سرورِ حساب ──');
  const other = await api('POST', `${SR}/srq_1/fix/enable-flag`, K({ shopId: 's2' }), owner);
  check('⛔ دکانِ دیگر ⇒ ۴۰۴ ِ خودِ سرورِ حساب', other.status === 404, `${other.status} ${other.text.slice(0, 160)}`);
  const held = await api('POST', `${SR}/srq_held/fix/enable-flag`, K(), owner);
  check('⛔ «غیرفعال کردنِ سرویس» ⇒ ۴۰۹ با پیامِ روشن', held.status === 409 && /غیرفعال/.test(held.text), `${held.status} ${held.text.slice(0, 160)}`);

  const aud = await api('GET', '/api/control/audit?q=account.support_request&limit=50&offset=0', undefined, owner);
  const acts = (aud.json?.rows || []).map((r) => r.action);
  check('دفترِ پنل: «حل شد»، «روشن کن» یک بار (بازپخش نه)، تمدید و سقفِ دستگاه',
    acts.filter((a) => a === 'account.support_request.enable_flag').length === 1 && acts.includes('account.support_request.resolved')
    && acts.includes('account.support_request.grant_subscription') && acts.includes('account.support_request.raise_device_limit'), acts.join(' '));
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  server.kill('SIGTERM');
  fake.close();
  await sleep(300);
  await fsp.rm(tmp, { recursive: true, force: true });
}
if (fail) console.log('\n' + out.slice(-1500));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
