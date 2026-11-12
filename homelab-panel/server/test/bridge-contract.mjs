// ---------------------------------------------------------------------------
//  ممیزی §۹ (۱.۵۰.۷۵) — سه «توانایی» ِ تازهٔ سرورِ حساب (shop ‎claude/acct-console‎)، هر کدام **با و بی** توانایی:
//      node test/bridge-contract.mjs
//
//    sync-restore-once.v1   بازگرداندنِ تعارض: کلیدِ پنجره (بسته به کاربرِ پنل) در ‎Idempotency-Key‎ ⇒ «یک بار» در سرورِ حساب،
//                           ‎Idempotent-Replayed‎ ⇒ ‎replayed‎، ۴۰۹ ِ آن‌جا همان‌طور؛ بی آن ⇒ همان یادِ پل (بی سرآیند)
//                           (۱.۵۰.۷۸: بازپخشی که «نامعلوم» ِ پل را روشن کرد ⇒ ردیفِ دفتر با ‎resolved‎)
//    subscription-period.v1 S15: پایانِ دوره از ‎GET /api/admin/subscriptions/period-end‎ برای هر سه درِ اعطا/تمدید (دکان و پمپ)؛
//                           خطای آن‌جا بی‌صدا به حسابِ پنل برنمی‌گردد؛ بی آن ⇒ همان ‎addPeriod‎
//    admin-contract.v1      S18: ‎GET /api/admin/contract‎ (کش به ‎routesHash‎) ⇒ ‎{apiVersion, compatible, missing}‎ در
//                           ‎/console/capabilities‎؛ نسخهٔ تازه‌تر ⇒ ناسازگار؛ بی آن ⇒ «پشتیبانی نمی‌شود»
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PANEL = Number(process.env.TEST_PORT || 4997);
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'bridge-contract-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 400)}`);
};

/* ───────────── سرورِ حسابِ ساختگی ───────────── */
const NOW = Date.now();
const DAY = 86400e3;
//  همان ‎addPeriod‎ ِ پنل برای «ماه» (تقویمیِ UTC) — بی وارد کردنِ روترِ پنل در این پروسه
const plusMonths = (ms, n) => { const d = new Date(ms); d.setUTCMonth(d.getUTCMonth() + n); return d.getTime(); };
const SERVER_END = 4000000000000;   //  عددی که پنل هرگز خودش نمی‌سازد
let caps = ['actor.v1'];
let contract = null;
let contractCalls = 0;
const seen = [];
const restored = new Set();
const idem = new Map();             //  کلید ⇒ { body, response }
let hangRestore = false;            //  ۱.۵۰.۷۸: بازگرداندن انجام می‌شود ولی پاسخ گم می‌شود
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    let body = null;
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null; } catch { body = null; }
    const j = (code, obj, headers = {}) => {
      res.statusCode = code;
      res.setHeader('content-type', 'application/json');
      if (caps.includes('admin-contract.v1')) res.setHeader('X-Admin-API-Version', String(contract?.version ?? 1));
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      res.end(JSON.stringify(obj));
    };
    if (p === '/api/health') return j(200, { ok: true, version: '9.9.9' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: caps, serverTime: NOW });
    seen.push({ method: req.method, path: p, query: Object.fromEntries(u.searchParams), body, idem: req.headers['idempotency-key'] || '' });
    const m = /^\/api\/admin\/sync\/conflicts\/(\d+)\/restore$/.exec(p);
    if (m && req.method === 'POST') {
      const key = req.headers['idempotency-key'];
      if (key && caps.includes('sync-restore-once.v1')) {
        const prev = idem.get(key);
        if (prev) {
          if (JSON.stringify(prev.body) !== JSON.stringify(body)) return j(409, { error: { code: 'idempotency_key_reused', message: 'کلید برای درخواستِ دیگر' } });
          return j(200, prev.response, { 'Idempotent-Replayed': 'true' });
        }
      }
      if (caps.includes('sync-restore-once.v1') && restored.has(m[1])) return j(409, { error: { code: 'already_restored', message: 'پیش‌تر برگردانده شد' } });
      restored.add(m[1]);
      const response = { ok: true, opId: `op-${m[1]}-${restored.size}` };
      if (key) idem.set(key, { body, response });
      if (hangRestore) { hangRestore = false; return void setTimeout(() => res.socket?.destroy(), 4000); }
      return j(200, response);
    }
    if (p === '/api/admin/subscriptions/period-end') {
      if (u.searchParams.get('amount') === '1.5') return j(400, { error: { code: 'bad_amount', message: 'مقدار عددِ درست است' } });
      return j(200, { app: u.searchParams.get('app'), amount: Number(u.searchParams.get('amount')), unit: u.searchParams.get('unit'),
        base: Number(u.searchParams.get('from')), endsAt: SERVER_END, rule: 'calendar_local', zone: 'Asia/Kabul', serverTime: NOW });
    }
    if (p === '/api/admin/subscriptions' && req.method === 'GET') return j(200, { subscriptions: [{ id: 'sub1', shop_id: 's1', plan: 'm1', status: 'active', ends_at: NOW + 20 * DAY }] });
    if (p === '/api/admin/pump/subscriptions' && req.method === 'GET') return j(200, { subscriptions: [{ id: 'psub1', station_id: 'st1', plan: 'p1', status: 'active', ends_at: NOW + 5 * DAY, max_devices: 4 }] });
    if (/^\/api\/admin\/(pump\/)?subscriptions(\/[^/]+)?$/.test(p)) return j(200, { subscription: { id: 'x', ends_at: body?.endsAt }, state: { active: true } });
    if (p === '/api/admin/contract') { contractCalls++; return j(200, contract); }
    return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const FAKE_URL = `http://127.0.0.1:${fake.address().port}`;

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_SITESYNC: '0',
         HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_AUTOMATION: '0', HLP_STATIONS: '0',
         HLP_ACCOUNT_API: FAKE_URL, HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret',
         HLP_AUTH_RATE_LIMIT: '100000', HLP_TG_WATCH_MS: '0', HLP_TG_LONGPOLL: '0', HLP_BRIDGE_TIMEOUT_MS: '1500' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const BASE = `http://127.0.0.1:${PANEL}`;
async function api(method, p, body, headers = {}) {
  const res = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}
const ups = (re, method = 'POST') => seen.filter((s) => s.method === method && re.test(s.path));
const last = (re, method) => ups(re, method).at(-1);

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await api('POST', '/api/auth/setup', { username: 'owner', password: 'Ctr-1405-owner' });
  const login = async (u, pw) => (await api('POST', '/api/auth/login', { username: u, password: pw })).json?.token;
  const owner = await login('owner', 'Ctr-1405-owner');
  const H = (t) => ({ Authorization: `Bearer ${t}` });
  await api('POST', '/api/auth/users', { username: 'admin2', password: 'Ctr-admin-1405', role: 'admin' }, H(owner));
  const admin2 = await login('admin2', 'Ctr-admin-1405');
  const R = (id, k, reason = 'مقدارِ درست همان قبلی بود') => api('POST', `/api/account-admin/sync/conflicts/${id}/restore`,
    { reason, confirm: true, idempotencyKey: `ctr-restore-${k}-0001` }, H(owner));

  console.log('\n── ۱) بازگرداندنِ تعارض: sync-restore-once.v1 ──');
  caps = ['actor.v1'];
  const a1 = await R(11, 'a');
  const a2 = await R(11, 'a');
  check('بی توانایی: همان یادِ پل — تکرار ⇒ ‎replayed‎ بی درخواستِ دوم، و ⛔ بی ‎Idempotency-Key‎ به سرورِ کهنه',
    a1.status === 200 && a2.json?.replayed === true && ups(/conflicts\/11\/restore$/).length === 1 && last(/conflicts\/11\/restore$/)?.idem === '',
    `${a1.status} ${a2.text.slice(0, 120)} n=${ups(/conflicts\/11\/restore$/).length}`);
  const a3 = await R(11, 'b');
  check('بی توانایی: پنجرهٔ دیگر برای همان تعارض ⇒ ‎409 already_restored‎ از یادِ پل (بی رفتن به سرورِ حساب)',
    a3.status === 409 && a3.json?.error === 'already_restored' && ups(/conflicts\/11\/restore$/).length === 1, `${a3.status} ${a3.json?.error}`);

  caps = ['actor.v1', 'sync-restore-once.v1'];
  const b1 = await R(12, 'c');
  const sent = last(/conflicts\/12\/restore$/);
  check('با توانایی: کلیدِ همان پنجره در ‎Idempotency-Key‎، بسته به کاربرِ پنل (‎u<id>.‎) و بدنهٔ ‎{reason}‎',
    b1.status === 200 && /^u\d+\.ctr-restore-c-0001$/.test(sent?.idem || '') && JSON.stringify(sent?.body) === JSON.stringify({ reason: 'مقدارِ درست همان قبلی بود' }), `${b1.status} ${JSON.stringify(sent)}`);
  const b2 = await R(12, 'c');
  check('با توانایی: تکرار به سرورِ حساب می‌رود و ‎Idempotent-Replayed‎ ⇒ ‎replayed: true‎ با همان پاسخ',
    b2.status === 200 && b2.json?.replayed === true && b2.json?.opId === b1.json?.opId && ups(/conflicts\/12\/restore$/).length === 2, `${b2.text.slice(0, 160)}`);
  const b3 = await R(12, 'd');
  check('با توانایی: پنجرهٔ دیگر ⇒ ‎409 already_restored‎ ِ **سرورِ حساب** (یادِ پل کنار است، پس پس از راه‌اندازیِ دوباره هم)',
    b3.status === 409 && b3.json?.error === 'already_restored' && ups(/conflicts\/12\/restore$/).length === 3, `${b3.status} ${b3.json?.error} n=${ups(/conflicts\/12\/restore$/).length}`);
  const b4 = await R(12, 'c', 'دلیلِ دیگری برای همین کلید');
  check('با توانایی: همان کلید با دلیلِ دیگر ⇒ ‎409 idempotency_key_reused‎ ِ آن‌جا', b4.status === 409 && b4.json?.error === 'idempotency_key_reused', `${b4.status} ${b4.json?.error}`);
  const b5 = await api('POST', '/api/account-admin/sync/conflicts/12/restore', { reason: 'مقدارِ درست همان قبلی بود', confirm: true, idempotencyKey: 'ctr-restore-c-0001' }, H(admin2));
  check('⛔ همان کلید از کاربرِ دیگرِ پنل پاسخِ او را بازپخش نمی‌کند (کلیدِ بالادست فرق دارد)',
    b5.status === 409 && b5.json?.error === 'already_restored' && last(/conflicts\/12\/restore$/)?.idem !== sent?.idem, `${b5.status} ${b5.json?.error} ${last(/conflicts\/12\/restore$/)?.idem}`);
  //  ۱.۵۰.۷۸: بازگرداندنی که پاسخش گم شد و همان کلید بازپخشش کرد **انجام شده بود** — دفترِ پنل آن را می‌نویسد (`resolved`)،
  //  همان قاعدهٔ دستگاه/بانکِ عکس/پشتیبان (`makeUpstreamOnce`)؛ تا ۱.۵۰.۷۷ فقط ردیفِ «نامعلوم» می‌ماند
  hangRestore = true;
  const h1 = await R(13, 'h');
  const h2 = await R(13, 'h');
  const h3 = await R(13, 'h');
  const rows13 = ((await api('GET', '/api/control/audit?q=account.sync.restore&limit=20&offset=0', undefined, H(owner))).json?.rows || [])
    .filter((r) => r.action === 'account.sync.restore' && r.entity_id === '13');
  check('⛔ بازگرداندنِ «نامعلوم» که همان کلید بازپخشش کرد ⇒ یک ردیفِ «بازگردانده شد» با ‎resolved‎ (بازپخشِ سوم بی ردیف)',
    h1.status === 504 && h1.json?.outcome === 'unknown' && h2.status === 200 && h2.json?.replayed === true && h3.json?.replayed === true
      && rows13.length === 1 && String(rows13[0].detail).includes('resolved'), `${h1.status} ${h2.status} ${JSON.stringify(rows13).slice(0, 300)}`);
  const aud = await api('GET', '/api/control/audit?q=account.sync.restore&limit=20&offset=0', undefined, H(owner));
  const rows = (aud.json?.rows || []).filter((r) => r.action === 'account.sync.restore' && r.entity_id === '12');
  check('دفترِ پنل: یک ردیف برای بازگرداندنِ واقعی، نه برای بازپخش و ردها', rows.length === 1 && String(rows[0].detail).includes('server'), JSON.stringify(rows).slice(0, 300));

  console.log('\n── ۲) S15: subscription-period.v1 ──');
  caps = ['actor.v1'];
  const e0 = await api('POST', '/api/account-admin/subs/shop/sub1/extend', { amount: 2, unit: 'month' }, H(owner));
  const put0 = last(/^\/api\/admin\/subscriptions\/sub1$/, 'PUT');
  check('بی توانایی: همان ‎addPeriod‎ ِ پنل (و سرورِ کهنه ‎period-end‎ را نمی‌بیند)',
    e0.status === 200 && Math.abs(put0?.body?.endsAt - plusMonths(NOW + 20 * DAY, 2)) < 5000 && ups(/period-end$/, 'GET').length === 0, `${e0.status} ${JSON.stringify(put0)}`);
  caps = ['actor.v1', 'subscription-period.v1'];
  const e1 = await api('POST', '/api/account-admin/subs/shop/sub1/extend', { amount: 2, unit: 'month' }, H(owner));
  const q1 = last(/period-end$/, 'GET');
  check('با توانایی: تمدیدِ دکان ⇒ پایانِ دوره از سرورِ حساب (همان عددِ آن‌جا، نه حسابِ پنل)',
    e1.status === 200 && last(/^\/api\/admin\/subscriptions\/sub1$/, 'PUT')?.body?.endsAt === SERVER_END, `${e1.status} ${JSON.stringify(last(/^\/api\/admin\/subscriptions\/sub1$/, 'PUT'))}`);
  check('پرسش: ‎app=shop‎، مقدار، واحد و «از» = پایانِ فعلی', q1?.query?.app === 'shop' && q1?.query?.amount === '2' && q1?.query?.unit === 'month'
    && Math.abs(Number(q1?.query?.from) - (NOW + 20 * DAY)) < 5000, JSON.stringify(q1?.query));
  const e2 = await api('POST', '/api/account-admin/subs/pump/psub1/extend', { amount: 1, unit: 'year' }, H(owner));
  check('با توانایی: تمدیدِ پمپ (‎grant‎ با ‎endsAt‎) ⇒ ‎app=pump‎ و همان عددِ سرورِ حساب',
    e2.status === 200 && last(/period-end$/, 'GET')?.query?.app === 'pump' && last(/^\/api\/admin\/pump\/subscriptions$/, 'POST')?.body?.endsAt === SERVER_END,
    `${e2.status} ${JSON.stringify(last(/^\/api\/admin\/pump\/subscriptions$/, 'POST'))}`);
  const e3 = await api('POST', '/api/account-admin/subscriptions/sub1/extend', { amount: 3, unit: 'week' }, H(owner));
  check('با توانایی: درِ قدیمیِ ‎/subscriptions/:id/extend‎ هم', e3.status === 200 && last(/^\/api\/admin\/subscriptions\/sub1$/, 'PUT')?.body?.endsAt === SERVER_END
    && last(/period-end$/, 'GET')?.query?.unit === 'week', `${e3.status}`);
  const e4 = await api('POST', '/api/account-admin/subs/shop/sub1/extend', { amount: 1.5, unit: 'month' }, H(owner));
  const puts = ups(/^\/api\/admin\/subscriptions\/sub1$/, 'PUT').length;
  check('⛔ خطای سرورِ حساب (‎bad_amount‎) همان‌طور بالا می‌رود — بی بازگشتِ بی‌صدا به حسابِ پنل و بی نوشتن',
    e4.status === 400 && e4.json?.error === 'bad_amount' && puts === 3, `${e4.status} ${e4.json?.error} puts=${puts}`);
  const eAud = await api('GET', '/api/control/audit?q=account.subscription.extend&limit=20&offset=0', undefined, H(owner));
  const er = (eAud.json?.rows || []).filter((r) => r.action === 'account.subscription.extend');
  check('دفترِ پنل می‌گوید پایانِ دوره را چه کسی حساب کرد (‎period: server | panel‎)',
    er.some((r) => String(r.detail).includes('"period":"server"')) && er.some((r) => String(r.detail).includes('"period":"panel"')), JSON.stringify(er.map((r) => r.detail)));

  console.log('\n── ۳) S18: admin-contract.v1 ──');
  caps = ['actor.v1'];
  const c0 = await api('GET', '/api/account-admin/console/capabilities', undefined, H(owner));
  check('بی توانایی: ‎contract.available: false‎ با نامِ توانایی، بی پرسشِ ‎/contract‎',
    c0.status === 200 && c0.json?.contract?.available === false && c0.json?.contract?.capability === 'admin-contract.v1' && contractCalls === 0, c0.text.slice(0, 300));
  caps = ['actor.v1', 'admin-contract.v1'];
  contract = { version: 1, routesHash: 'h-aaaa', count: 3, capabilities: caps, serverVersion: '2.14.6',
    routes: [{ method: 'GET', path: '/api/admin/me', superadmin: false }, { method: 'GET', path: '/api/admin/shops', superadmin: false },
      { method: 'POST', path: '/api/admin/sync/conflicts/:id/restore', superadmin: true }] };
  const c1 = await api('GET', '/api/account-admin/console/capabilities', undefined, H(owner));
  const k1 = c1.json?.contract;
  check('با توانایی: نسخه ۱ ⇒ سازگار، با اثرِ انگشت و شمار', k1?.available === true && k1?.apiVersion === 1 && k1?.compatible === true && k1?.routesHash === 'h-aaaa' && k1?.count === 3,
    String(JSON.stringify(k1)).slice(0, 300));
  check('«کدام درِ پل آن‌جا نیست» از سورسِ خودِ پل: بازگرداندن هست، پشتیبانِ دستی نیست',
    Array.isArray(k1?.missing) && k1.missing.includes('POST /api/admin/backups') && !k1.missing.includes('POST /api/admin/sync/conflicts/:p/restore')
      && !k1.missing.includes('GET /api/admin/shops') && k1.checked > 100, `checked=${k1?.checked} unresolved=${k1?.unresolved} ${JSON.stringify(k1?.missing?.slice(0, 5))}`);
  check('نسخهٔ سرآیندِ ‎X-Admin-API-Version‎ دیده شد', k1?.apiVersionSeen === 1, JSON.stringify(k1?.apiVersionSeen));
  await api('GET', '/api/account-admin/console/capabilities', undefined, H(owner));
  check('کش: درخواستِ دوم ‎/contract‎ را دوباره نمی‌پرسد', contractCalls === 1, `${contractCalls}`);
  contract = { ...contract, version: 2, routesHash: 'h-bbbb', routes: [...contract.routes, { method: 'POST', path: '/api/admin/backups', superadmin: true }] };
  const c2 = await api('GET', '/api/account-admin/console/capabilities?refresh=1', undefined, H(owner));
  const k2 = c2.json?.contract;
  check('⛔ نسخهٔ ۲ ⇒ «ناسازگار»؛ اثرِ انگشتِ تازه ⇒ سنجشِ تازه (پشتیبان دیگر «نیست» نیست)',
    k2?.compatible === false && k2?.apiVersion === 2 && k2?.routesHash === 'h-bbbb' && !k2?.missing?.includes('POST /api/admin/backups') && contractCalls === 2, String(JSON.stringify(k2)).slice(0, 300));
  //  ۱.۵۰.۹۶ (IMG-PRO-17، `image-changes.v1`): سه درِ تازهٔ پل از سورس دیده می‌شوند — سرورِ حسابی که ندارد ⇒ «نیست»، که دارد ⇒ نه
  const IMGCHG = ['GET /api/admin/shops/:p/images/changes', 'GET /api/admin/shops/:p/images/changes/:p', 'POST /api/admin/shops/:p/images/changes/:p/rollback'];
  check('درهای «تغییرِ دسته‌ایِ عکس» ِ پل در «نیست» ِ سرورِ حسابی که ندارد', IMGCHG.every((x) => k2?.missing?.includes(x)), JSON.stringify(k2?.missing?.filter((x) => x.includes('images'))));
  contract = { ...contract, version: 1, routesHash: 'h-cccc', routes: [...contract.routes,
    { method: 'GET', path: '/api/admin/shops/:id/images/changes', superadmin: false }, { method: 'GET', path: '/api/admin/shops/:id/images/changes/:cid', superadmin: false },
    { method: 'POST', path: '/api/admin/shops/:id/images/changes/:cid/rollback', superadmin: true }] };
  const c3 = await api('GET', '/api/account-admin/console/capabilities?refresh=1', undefined, H(owner));
  const k3 = c3.json?.contract;
  check('قراردادِ shop ‎claude/e-rows-13x‎ (سه درِ ‎image-changes.v1‎) ⇒ سازگار و هیچ‌کدام «نیست» نیست',
    k3?.compatible === true && k3?.routesHash === 'h-cccc' && IMGCHG.every((x) => !k3?.missing?.includes(x)), String(JSON.stringify(k3)).slice(0, 300));
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  server.kill('SIGTERM');
  fake.close();
  await new Promise((r) => setTimeout(r, 400));
  await fsp.rm(tmp, { recursive: true, force: true });
}

if (fail) console.log('\n' + out.slice(-1500));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
