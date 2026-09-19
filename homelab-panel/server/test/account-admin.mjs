// ---------------------------------------------------------------------------
//  پلِ حساب‌های دکان — اپِ مدیریت روی سرورِ حساب، با نشستِ پنل
//      node test/account-admin.mjs
//
//  چرا این آزمون هست: تا ۱.۴۰.۰ پنل دفترِ حسابِ دومی داشت (‎src/tohid/‎) و
//  اپِ مدیریت از همان می‌خواند. با حذفش، همهٔ آن مسیرها به سرورِ حساب
//  رفت — ولی **شکلِ پاسخ** باید همانی می‌ماند که اپِ روی گوشی می‌خواند
//  (‎data/Api.kt‎ و صفحه‌هایش)، وگرنه یک نامِ فیلد برنامه را می‌انداخت
//  (همان ماجرای ‎admin-app-contract.mjs‎).
//
//  پنلِ واقعی بالا می‌آید و یک سرورِ حسابِ ساختگی جوابِ ‎/api/admin/*‎ را
//  به شکلِ خودِ shop/server می‌دهد. سه چیز سنجیده می‌شود: فیلدهایی که اپ
//  می‌خواند، ترجمهٔ درست به مسیرهای سرورِ حساب، و بسته بودنِ در (فهرستِ
//  سفید، نقش، پورتِ عمومی).
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PANEL = Number(process.env.TEST_PORT || 4886);
const PUBLIC = PANEL + 1;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'acct-admin-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 260)}`);
};

// ── ۰) بی سرور: حسابِ تقویمی ──────────────────────────────────────────────
console.log('\n── یک ماه یعنی یک ماه ──');
{
  process.env.HLP_DATA_DIR = path.join(tmp, 'unit');
  process.env.HLP_ACCOUNT_API = '0';
  const { addPeriod } = await import('../src/routes/account-admin.js');
  const jan31 = Date.UTC(2026, 0, 31);
  check('۳۱ ژانویه + یک ماه = ۳ مارس (نه ۲ مارس، نه ۳۰ روز)',
    new Date(addPeriod(jan31, 1, 'month')).toISOString().startsWith('2026-03-03'),
    new Date(addPeriod(jan31, 1, 'month')).toISOString());
  check('یک سال', new Date(addPeriod(jan31, 1, 'year')).toISOString().startsWith('2027-01-31'));
  check('دو هفته', addPeriod(jan31, 2, 'week') - jan31 === 14 * 86400e3);
}

// ── ۱) سرورِ حسابِ ساختگی — به شکلِ shop/server ──────────────────────────
const NOW = Date.now();
const DAY = 86400e3;
const seen = [];                 // { method, path, query, body, bearer }
const users = {
  u1: { id: 'u1', name: 'کریم', email: 'karim@x.com', phone: '0700', status: 'active', created_at: NOW - 40 * DAY, last_login_at: NOW - DAY },
  u2: { id: 'u2', name: 'زهرا', email: 'z@x.com', phone: '0711', status: 'active', created_at: NOW - 3 * DAY, last_login_at: null },
};
const shops = [
  { id: 's1', name: 'دکانِ کریم', status: 'active', created_at: NOW - 40 * DAY, owner_user_id: 'u1',
    owner_name: 'کریم', owner_phone: '0700', owner_email: 'karim@x.com', members: 2,
    subscription_id: 7, plan: 'm1', sub_status: 'active', starts_at: NOW - 10 * DAY, ends_at: NOW + 20 * DAY },
  { id: 's2', name: 'دکانِ زهرا', status: 'active', created_at: NOW - 3 * DAY, owner_user_id: 'u2',
    owner_name: 'زهرا', owner_phone: '0711', owner_email: 'z@x.com', members: 1,
    subscription_id: null, plan: null, sub_status: 'trial', starts_at: null, ends_at: NOW + 11 * DAY },
];
const subs = [
  { id: 7, shop_id: 's1', plan: 'm1', status: 'active', starts_at: NOW - 10 * DAY, ends_at: NOW + 20 * DAY,
    features: [], max_devices: 10, grace_days: 0, note: '', shop_name: 'دکانِ کریم', owner_name: 'کریم' },
];
const plans = [
  { code: 'm1', title: 'یک‌ماهه', amount: 1, unit: 'month', price: 500, fullPrice: 500, discount: null, badge: '', features: ['sync'], maxDevices: 10, active: true, days: 30 },
  { code: 'y1', title: 'یک‌ساله', amount: 1, unit: 'year', price: 4000, fullPrice: 5000, discount: { percent: 20, savings: 1000, label: 'پاییز', until: NOW + 30 * DAY }, badge: 'ویژه', features: ['sync'], maxDevices: 10, active: false, days: 365 },
];
const threads = [
  { id: 'th1', app: 'shop', userId: 'u1', shopId: 's1', stationId: '', who: 'کریم', status: 'open', unreadAdmin: 1, unreadUser: 0, lastMessage: 'سلام', lastSender: 'user', createdAt: NOW - DAY, updatedAt: NOW - 3600e3, accountName: 'کریم', shopName: 'دکانِ کریم' },
  { id: 'th2', app: 'pump', userId: '', shopId: '', stationId: 'st1', who: 'پمپِ یک', status: 'open', unreadAdmin: 0, unreadUser: 0, lastMessage: 'تیل', lastSender: 'user', createdAt: NOW - 2 * DAY, updatedAt: NOW - 7200e3, stationName: 'پمپِ یک' },
];
let nextSubId = 8;
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const body = raw ? JSON.parse(raw) : null;
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, server: 'online', version: '9.9.9' });
    if (p === '/api/admin/login') {
      if (body?.username !== 'boss' || body?.password !== 'top-secret') return j(401, { error: { code: 'bad_credentials', message: 'رمز غلط' } });
      return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    }
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    seen.push({ method: req.method, path: p, query: Object.fromEntries(u.searchParams), body, bearer });
    if (bearer !== 'tok-1') return j(401, { error: { code: 'unauthorized', message: 'احراز هویت لازم است' } });
    let m;
    if (p === '/api/admin/shops' && req.method === 'GET') {
      const q = (u.searchParams.get('q') || '').toLowerCase();
      return j(200, { shops: shops.filter((s) => !q || s.name.toLowerCase().includes(q) || s.owner_name.includes(q)), total: shops.length, limit: 200, offset: 0 });
    }
    if ((m = /^\/api\/admin\/shops\/([^/]+)$/.exec(p)) && req.method === 'GET') {
      const s = shops.find((x) => x.id === m[1]);
      if (!s) return j(404, { error: { code: 'not_found', message: 'دکان پیدا نشد' } });
      const live = subs.find((x) => x.shop_id === s.id && x.status === 'active');
      const state = live
        ? { id: live.id, plan: live.plan, status: 'active', active: true, startsAt: live.starts_at, endsAt: live.ends_at, graceEndsAt: live.ends_at, daysLeft: Math.ceil((live.ends_at - NOW) / DAY), features: [], maxDevices: 10, note: '' }
        : { status: 'none', active: false, endsAt: 0, startsAt: 0, daysLeft: 0, plan: '' };
      const trial = s.sub_status === 'trial' ? { enabled: true, active: true, used: false, endsAt: s.ends_at, daysLeft: 11 } : { enabled: true, active: false, used: true, endsAt: 0, daysLeft: 0 };
      return j(200, {
        shop: { id: s.id, name: s.name, status: s.status, createdAt: s.created_at, ownerUserId: s.owner_user_id },
        location: null,
        members: [{ id: 'm1', role: 'owner', status: 'active', user_id: s.owner_user_id, name: s.owner_name }],
        entitlement: { app: 'shop', source: live ? 'subscription' : (trial.active ? 'trial' : 'free'), features: ['core', 'sync'], subscription: state, trial },
        subscriptions: subs.filter((x) => x.shop_id === s.id),
        counts: { products: 12 },
      });
    }
    if (p === '/api/admin/users' && req.method === 'GET') return j(200, { users: Object.values(users), total: 2, limit: 200, offset: 0 });
    if ((m = /^\/api\/admin\/users\/([^/]+)$/.exec(p)) && req.method === 'GET') {
      const usr = users[m[1]];
      if (!usr) return j(404, { error: { code: 'not_found', message: 'کاربر پیدا نشد' } });
      return j(200, {
        user: { id: usr.id, name: usr.name, email: usr.email, phone: usr.phone, status: usr.status, createdAt: usr.created_at, lastLoginAt: usr.last_login_at },
        memberships: [], devices: [{ id: 'd1', user_id: usr.id, device_uid: 'dev-abc', name: 'Galaxy', platform: 'android', last_seen_at: NOW - 3600e3, revoked: false }], locations: [],
      });
    }
    if ((m = /^\/api\/admin\/users\/([^/]+)\/status$/.exec(p)) && req.method === 'POST') {
      const usr = users[m[1]];
      if (!usr) return j(404, { error: { code: 'not_found', message: 'کاربر پیدا نشد' } });
      usr.status = body.status;
      return j(200, { user: { id: usr.id, status: usr.status } });
    }
    if (p === '/api/admin/subscriptions' && req.method === 'GET') return j(200, { subscriptions: subs.map((s) => ({ ...s, state: { active: s.status === 'active' } })) });
    if (p === '/api/admin/subscriptions' && req.method === 'POST') {
      const row = { id: nextSubId++, shop_id: body.shopId, plan: body.plan, status: 'active',
        starts_at: body.startsAt || NOW, ends_at: body.endsAt || (NOW + 30 * DAY), features: body.features || [], max_devices: body.maxDevices || 10, grace_days: 0, note: body.note || '' };
      subs.push(row);
      return j(201, { subscription: row, state: { active: true } });
    }
    if ((m = /^\/api\/admin\/subscriptions\/([^/]+)$/.exec(p)) && req.method === 'PUT') {
      const row = subs.find((x) => String(x.id) === m[1]);
      if (!row) return j(404, { error: { code: 'not_found', message: 'اشتراک پیدا نشد' } });
      if (body.endsAt) row.ends_at = body.endsAt;
      return j(200, { subscription: row, state: { active: true } });
    }
    if ((m = /^\/api\/admin\/subscriptions\/([^/]+)\/status$/.exec(p)) && req.method === 'POST') {
      const row = subs.find((x) => String(x.id) === m[1]);
      if (!row) return j(404, { error: { code: 'not_found', message: 'اشتراک پیدا نشد' } });
      row.status = body.status;
      return j(200, { subscription: row, state: { active: row.status === 'active' } });
    }
    if (p === '/api/admin/plans' && req.method === 'GET') return j(200, { plans, app: u.searchParams.get('app') || 'shop', config: {} });
    if ((m = /^\/api\/admin\/plans\/([^/]+)\/discount$/.exec(p))) {
      const plan = plans.find((x) => x.code === m[1]);
      if (!plan) return j(404, { error: { code: 'not_found', message: 'پلن پیدا نشد' } });
      if (req.method === 'PUT') { plan.discount = { percent: body.percent, savings: 0, label: body.label || '', until: body.until || null }; return j(200, { plan }); }
      if (req.method === 'DELETE') { plan.discount = null; return j(200, { plan }); }
    }
    if (p === '/api/admin/support/threads' && req.method === 'GET') {
      const app = u.searchParams.get('app') || '';
      if (app && !['shop', 'pump'].includes(app)) return j(400, { error: { code: 'validation', message: 'بخش معتبر نیست' } });
      return j(200, { threads: threads.filter((t) => !app || t.app === app), unread: 1 });
    }
    if ((m = /^\/api\/admin\/support\/threads\/([^/]+)$/.exec(p)) && req.method === 'GET') {
      const t = threads.find((x) => x.id === m[1]);
      if (!t) return j(404, { error: { code: 'thread_not_found', message: 'این گفت‌وگو پیدا نشد' } });
      const after = Number(u.searchParams.get('after') || 0);
      const msgs = [{ id: 'msg1', threadId: t.id, sender: 'user', senderId: 'u1', senderName: t.who, body: t.lastMessage, kind: 'text', readAt: null, createdAt: t.updatedAt }];
      return j(200, { thread: t, messages: msgs.filter((x) => x.createdAt > after), serverTime: NOW });
    }
    if ((m = /^\/api\/admin\/support\/threads\/([^/]+)\/messages$/.exec(p)) && req.method === 'POST') {
      return j(201, { message: { id: 'msg2', threadId: m[1], sender: 'admin', senderId: 'a1', senderName: 'boss', body: body.body, kind: 'text', readAt: null, createdAt: NOW } });
    }
    if ((m = /^\/api\/admin\/support\/threads\/([^/]+)\/status$/.exec(p)) && req.method === 'POST') {
      const t = threads.find((x) => x.id === m[1]);
      t.status = body.status;
      return j(200, { thread: t });
    }
    if (p === '/api/admin/support/broadcast' && req.method === 'POST') return j(200, { sent: 2, targets: 2, failed: 0, app: body.app });
    if (p === '/api/admin/subscriptions/expiring') return j(200, { expiring: [{ id: 7, shopId: 's1', daysLeft: 20 }], serverTime: NOW });
    if (p === '/api/admin/stats') return j(200, { users: 2, shops: 2 });
    if (p === '/api/admin/overview') return j(200, { expiringCount: 1, supportUnread: 1 });
    if (p === '/api/admin/admins') return j(200, { admins: ['NEVER'] });
    if (p === '/api/admin/backups') return j(200, { backups: ['NEVER'] });
    return j(404, { error: { code: 'not_found', message: 'این مسیر وجود ندارد' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const FAKE_URL = `http://127.0.0.1:${fake.address().port}`;

// ── ۲) خودِ پنل ─────────────────────────────────────────────────────────────
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
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
async function api(method, p, body, headers = {}, base = BASE) {
  const res = await fetch(base + p, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* بدنهٔ غیرِ JSON */ }
  return { status: res.status, json };
}
const last = () => seen.at(-1);

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await api('POST', '/api/auth/setup', { username: 'admin', password: 'Acct-1405-test' });
  const login = await api('POST', '/api/auth/login', { username: 'admin', password: 'Acct-1405-test' });
  const auth = { Authorization: `Bearer ${login.json?.token}` };
  check('ورود به پنل', Boolean(login.json?.token), JSON.stringify(login.json));

  console.log('\n── فهرستِ حساب‌ها: همان فیلدهایی که اپ می‌خواند ──');
  const list = await api('GET', '/api/account-admin/shop-accounts', undefined, auth);
  const items = list.json?.items || [];
  check('دو حساب می‌آید', list.status === 200 && items.length === 2, `${list.status} ${JSON.stringify(list.json).slice(0, 200)}`);
  check('از ‎/api/admin/shops‎ سرورِ حساب خوانده شد، با توکنِ خودکار', last()?.path === '/api/admin/shops' && last()?.bearer === 'tok-1');
  const karim = items.find((r) => r.accountId === 's1');
  const zahra = items.find((r) => r.accountId === 's2');
  check('accountId شناسهٔ دکان است', Boolean(karim && zahra));
  for (const f of ['accountId', 'name', 'email', 'phone', 'disabled', 'vip', 'daysLeft', 'plan', 'status', 'createdAt']) {
    check(`فیلدِ «${f}» هست`, karim?.[f] !== undefined, JSON.stringify(karim));
  }
  check('نام، ایمیل و شمارهٔ صاحبِ دکان کنارِ دکان', karim?.name === 'دکانِ کریم' && karim?.email === 'karim@x.com' && karim?.phone === '0700');
  check('اشتراکِ فعال ⇒ vip با روزهای مانده', karim?.vip === true && karim?.daysLeft === 20 && karim?.planCode === 'm1', JSON.stringify(karim));
  check('دورهٔ آزمایشی ⇒ vip با روزهای مانده و وضعیتِ trial', zahra?.vip === true && zahra?.daysLeft === 11 && zahra?.status === 'trial', JSON.stringify(zahra));
  check('disabled راست/دروغ است، نه چیزی دیگر', karim?.disabled === false);
  const q = await api('GET', '/api/account-admin/shop-accounts?q=زهرا', undefined, auth);
  check('جست‌وجو به سرورِ حساب می‌رسد', q.json?.items?.length === 1 && last()?.query?.q === 'زهرا', JSON.stringify(last()?.query));

  console.log('\n── پروندهٔ یک حساب ──');
  const det = await api('GET', '/api/account-admin/shop-accounts/s1', undefined, auth);
  const d = det.json || {};
  check('پرونده می‌آید', det.status === 200 && d.account?.accountId === 's1', JSON.stringify(d).slice(0, 200));
  check('ایمیل، شماره و آخرین ورود از صاحبِ دکان', d.account?.email === 'karim@x.com' && d.account?.phone === '0700' && d.account?.lastLoginAt === NOW - DAY, JSON.stringify(d.account));
  check('entitlement با isPaid · status · daysLeft · planTitle · maxDevices',
    d.entitlement?.isPaid === true && d.entitlement?.status === 'active' && d.entitlement?.daysLeft === 20
      && d.entitlement?.planTitle === 'یک‌ماهه' && d.entitlement?.maxDevices === 10, JSON.stringify(d.entitlement));
  const sub = d.subscriptions?.[0];
  check('اشتراک با id · plan_title · plan_code · status · starts_at · ends_at (همان‌ها که اپ می‌خواند)',
    sub && sub.id === 7 && sub.plan_title === 'یک‌ماهه' && sub.plan_code === 'm1' && sub.status === 'active'
      && typeof sub.starts_at === 'number' && typeof sub.ends_at === 'number', JSON.stringify(sub));
  check('دستگاه‌ها با name · uid · lastSeenAt · revoked', d.devices?.[0]?.name === 'Galaxy' && d.devices?.[0]?.uid === 'dev-abc'
    && d.devices?.[0]?.revoked === false && d.devices?.[0]?.lastSeenAt > 0, JSON.stringify(d.devices));
  const trial = await api('GET', '/api/account-admin/shop-accounts/s2', undefined, auth);
  check('دورهٔ آزمایشی در پرونده: isPaid و status=trial', trial.json?.entitlement?.isPaid === true && trial.json?.entitlement?.status === 'trial' && trial.json?.entitlement?.daysLeft === 11, JSON.stringify(trial.json?.entitlement));
  const missing = await api('GET', '/api/account-admin/shop-accounts/nope', undefined, auth);
  check('حسابِ نبوده ۴۰۴ با پیامِ خودِ سرورِ حساب', missing.status === 404 && missing.json?.error === 'not_found', JSON.stringify(missing.json));
  const badId = await api('GET', '/api/account-admin/shop-accounts/..%2Fadmins', undefined, auth);
  check('شناسهٔ خراب به آن‌طرف نمی‌رود', badId.status === 400 || badId.status === 404, `${badId.status}`);

  console.log('\n── اشتراک دادن ──');
  const beforeGrant = seen.length;
  const vip = await api('POST', '/api/account-admin/shop-accounts/s2/vip', { planCode: 'm1', amount: 1, unit: 'month' }, auth);
  const granted = seen.slice(beforeGrant).find((s) => s.method === 'POST' && s.path === '/api/admin/subscriptions');
  check('ok و اشتراک برمی‌گردد', vip.status === 200 && vip.json?.ok === true && vip.json?.subscription?.shop_id === 's2', `${vip.status} ${JSON.stringify(vip.json)}`);
  check('به ‎POST /api/admin/subscriptions‎ با shopId و plan رفت', granted?.body?.shopId === 's2' && granted?.body?.plan === 'm1', JSON.stringify(granted?.body));
  check('مقدار و واحدِ همانِ پلن ⇒ مدت به خودِ سرورِ حساب سپرده می‌شود (بی days و endsAt)',
    granted && granted.body.days === undefined && granted.body.endsAt === undefined, JSON.stringify(granted?.body));

  const before2 = seen.length;
  const vip3 = await api('POST', '/api/account-admin/shop-accounts/s1/vip', { planCode: 'm1', amount: 3, unit: 'month' }, auth);
  const g3 = seen.slice(before2).find((s) => s.method === 'POST' && s.path === '/api/admin/subscriptions');
  check('سه ماه روی پلنِ یک‌ماهه ⇒ endsAt از پایانِ اشتراکِ زنده، سه ماهِ تقویمی جلوتر',
    vip3.status === 200 && g3?.body?.endsAt === (await import('../src/routes/account-admin.js')).addPeriod(NOW + 20 * DAY, 3, 'month'), JSON.stringify(g3?.body));
  const custom = await api('POST', '/api/account-admin/shop-accounts/s1/vip', { planCode: 'custom' }, auth);
  check('پلنِ ناشناخته بی مدت رد می‌شود', custom.status === 400 && custom.json?.error === 'missing_duration', JSON.stringify(custom.json));

  console.log('\n── تمدید و وضعیت ──');
  const oldEnd = subs.find((s) => s.id === 7).ends_at;
  const ext = await api('POST', '/api/account-admin/subscriptions/7/extend', { amount: 1, unit: 'month' }, auth);
  check('تمدید ⇒ PUT با endsAt یک ماهِ تقویمی بعد از پایانِ فعلی',
    ext.status === 200 && last()?.method === 'PUT' && last()?.path === '/api/admin/subscriptions/7'
      && last()?.body?.endsAt === (await import('../src/routes/account-admin.js')).addPeriod(oldEnd, 1, 'month'), `${ext.status} ${JSON.stringify(last())}`);
  const gone = await api('POST', '/api/account-admin/subscriptions/999/extend', { amount: 1, unit: 'month' }, auth);
  check('اشتراکِ نبوده ۴۰۴', gone.status === 404, `${gone.status}`);
  const st = await api('POST', '/api/account-admin/subscriptions/7/status', { status: 'cancelled' }, auth);
  check('وضعیت ⇒ ‎POST …/subscriptions/7/status‎ با همان مقدار', st.status === 200 && last()?.path === '/api/admin/subscriptions/7/status' && last()?.body?.status === 'cancelled', JSON.stringify(last()));

  console.log('\n── بستن حساب ──');
  const dis = await api('POST', '/api/account-admin/shop-accounts/s1/disable', { disabled: true }, auth);
  check('بستن ⇒ صاحبِ دکان روی سرورِ حساب disabled می‌شود', dis.status === 200 && dis.json?.disabled === true
    && last()?.path === '/api/admin/users/u1/status' && last()?.body?.status === 'disabled', `${dis.status} ${JSON.stringify(last())}`);
  const again = await api('GET', '/api/account-admin/shop-accounts/s1', undefined, auth);
  check('و پرونده حالا disabled می‌گوید', again.json?.account?.disabled === true, JSON.stringify(again.json?.account));
  await api('POST', '/api/account-admin/shop-accounts/s1/disable', { disabled: false }, auth);
  check('باز کردن ⇒ active', last()?.body?.status === 'active');

  console.log('\n── پلن‌ها ──');
  const pl = await api('GET', '/api/account-admin/shop-plans', undefined, auth);
  check('items با active به شکلِ ۰/۱ (optInt اندروید boolean را نمی‌فهمد)',
    pl.json?.items?.[0]?.active === 1 && pl.json?.items?.[1]?.active === 0 && pl.json?.items?.[0]?.code === 'm1', JSON.stringify(pl.json?.items));
  check('از پلن‌های دکان خوانده شد، نه پمپ', last()?.query?.app === 'shop');
  const adm = await api('GET', '/api/account-admin/plans', undefined, auth);
  check('نرخ‌نامه با fullPrice و discount', adm.json?.plans?.[1]?.fullPrice === 5000 && adm.json?.plans?.[1]?.discount?.percent === 20, JSON.stringify(adm.json?.plans?.[1]));
  const disc = await api('PUT', '/api/account-admin/plans/m1/discount', { percent: 10, label: 'نوروز' }, auth);
  check('تخفیف ⇒ PUT روی پلنِ دکان', disc.status === 200 && last()?.method === 'PUT' && last()?.path === '/api/admin/plans/m1/discount' && last()?.query?.app === 'shop' && last()?.body?.percent === 10, JSON.stringify(last()));
  const clr = await api('DELETE', '/api/account-admin/plans/m1/discount', undefined, auth);
  check('برداشتنِ تخفیف ⇒ DELETE', clr.status === 200 && last()?.method === 'DELETE' && last()?.path === '/api/admin/plans/m1/discount');

  console.log('\n── پشتیبانی ──');
  const thr = await api('GET', '/api/account-admin/support/threads?limit=100&app=shop', undefined, auth);
  const rows = thr.json?.threads || [];
  check('گفت‌وگوهای دکان', thr.status === 200 && rows.length === 1 && thr.json?.unread === 1, JSON.stringify(thr.json).slice(0, 200));
  for (const f of ['id', 'who', 'lastMessage', 'updatedAt', 'unreadAdmin', 'status']) {
    check(`فیلدِ «${f}» در گفت‌وگو هست`, rows[0]?.[f] !== undefined, JSON.stringify(rows[0]));
  }
  const pump = await api('GET', '/api/account-admin/support/threads?app=station', undefined, auth);
  check('«station»ِ اپِ قدیمی ⇒ «pump»ِ سرورِ حساب', pump.status === 200 && last()?.query?.app === 'pump' && pump.json?.threads?.[0]?.id === 'th2', `${pump.status} ${JSON.stringify(last()?.query)}`);
  const site = await api('GET', '/api/account-admin/support/threads?app=site', undefined, auth);
  check('بخشِ ناشناخته به سرورِ حساب نمی‌رسد (همه، نه ۴۰۰)', site.status === 200 && last()?.query?.app === undefined, `${site.status} ${JSON.stringify(last()?.query)}`);
  const one = await api('GET', '/api/account-admin/support/threads/th1?after=0', undefined, auth);
  const msg = one.json?.messages?.[0];
  check('پیام‌ها با id · sender · body · createdAt · senderName', msg?.id === 'msg1' && msg?.sender === 'user' && msg?.body === 'سلام' && typeof msg?.createdAt === 'number' && msg?.senderName === 'کریم', JSON.stringify(msg));
  const nothing = await api('GET', `/api/account-admin/support/threads/th1?after=${msg?.createdAt}`, undefined, auth);
  check('after زمان است', (nothing.json?.messages || []).length === 0);
  const rep = await api('POST', '/api/account-admin/support/threads/th1/messages', { body: 'جوابِ مدیر' }, auth);
  check('جواب ⇒ message برمی‌گردد', rep.status === 200 && rep.json?.message?.body === 'جوابِ مدیر' && last()?.body?.body === 'جوابِ مدیر', JSON.stringify(rep.json));
  const cls = await api('POST', '/api/account-admin/support/threads/th1/status', { status: 'closed' }, auth);
  check('بستنِ گفت‌وگو', cls.status === 200 && cls.json?.thread?.status === 'closed');
  const bc = await api('POST', '/api/account-admin/support/broadcast', { body: 'سلام به همه', target: 'all' }, auth);
  check('پیامِ همگانی به هر دو بخش (app=both پیش‌فرض)', bc.status === 200 && bc.json?.sent === 2 && last()?.body?.app === 'both', JSON.stringify(last()?.body));

  console.log('\n── خواندنی‌های دیگر ──');
  for (const p of ['/subscriptions/expiring', '/stats', '/overview', '/users', '/shops', '/subscriptions']) {
    const r = await api('GET', `/api/account-admin${p}`, undefined, auth);
    check(`GET ${p}`, r.status === 200, `${r.status} ${JSON.stringify(r.json).slice(0, 80)}`);
  }

  console.log('\n── در بسته است ──');
  const beforeSneak = seen.length;
  const sneak = await api('GET', '/api/account-admin/admins', undefined, auth);
  const sneak2 = await api('GET', '/api/account-admin/backups', undefined, auth);
  const sneak3 = await api('POST', '/api/account-admin/shops', {}, auth);
  check('مسیرِ بیرون از فهرستِ سفید ۴۰۴ است و به سرورِ حساب نمی‌رسد',
    sneak.status === 404 && sneak2.status === 404 && sneak3.status === 404 && seen.length === beforeSneak,
    `${sneak.status} ${sneak2.status} ${sneak3.status} ${seen.slice(beforeSneak).map((s) => s.path).join(' ')}`);
  const noAuth = await api('GET', '/api/account-admin/shop-accounts');
  check('بی نشستِ پنل ۴۰۱', noAuth.status === 401, `${noAuth.status}`);
  const pub = await api('GET', '/api/account-admin/shop-accounts', undefined, auth, `http://127.0.0.1:${PUBLIC}`);
  check('روی پورتِ عمومی «نبوده» است', pub.status === 404, `${pub.status}`);

  //  نقش: viewer می‌خواند ولی نمی‌نویسد؛ operator می‌نویسد ولی حساب نمی‌بندد
  const mk = await api('POST', '/api/auth/users', { username: 'viewer1', password: 'Viewer-1405-x', role: 'viewer' }, auth);
  const mk2 = await api('POST', '/api/auth/users', { username: 'op1', password: 'Operator-1405-x', role: 'operator' }, auth);
  if (mk.status < 300 && mk2.status < 300) {
    const v = await api('POST', '/api/auth/login', { username: 'viewer1', password: 'Viewer-1405-x' });
    const vAuth = { Authorization: `Bearer ${v.json?.token}` };
    const vRead = await api('GET', '/api/account-admin/shop-accounts', undefined, vAuth);
    const vWrite = await api('POST', '/api/account-admin/subscriptions/7/status', { status: 'active' }, vAuth);
    check('viewer می‌خواند ولی نمی‌نویسد', vRead.status === 200 && vWrite.status === 403, `${vRead.status} ${vWrite.status}`);
    const o = await api('POST', '/api/auth/login', { username: 'op1', password: 'Operator-1405-x' });
    const oAuth = { Authorization: `Bearer ${o.json?.token}` };
    const oWrite = await api('POST', '/api/account-admin/subscriptions/7/status', { status: 'active' }, oAuth);
    const oDisable = await api('POST', '/api/account-admin/shop-accounts/s1/disable', { disabled: true }, oAuth);
    check('operator اشتراک می‌دهد ولی حساب نمی‌بندد (فقط admin)', oWrite.status === 200 && oDisable.status === 403, `${oWrite.status} ${oDisable.status}`);
  } else {
    check('ساختنِ کاربرِ آزمون', false, `${mk.status} ${JSON.stringify(mk.json)} / ${mk2.status}`);
  }

  console.log('\n── سرورِ حساب خاموش ──');
  fake.close();
  await new Promise((r) => setTimeout(r, 200));
  const down = await api('GET', '/api/account-admin/shop-accounts', undefined, auth);
  check('۵۰۳ِ account_server_down با راهِ درست کردن، نه ۵۰۰ی گنگ',
    down.status === 503 && down.json?.error === 'account_server_down' && !/docker/i.test(down.json?.message || ''), `${down.status} ${JSON.stringify(down.json)}`);
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
