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
//  کلیدِ «سرورِ حسابِ کهنه است و دفترِ دومِ کدها را ندارد» — فقط برای یک بند
let otpOff = false;
//  «رباتِ ارسالِ سرورِ حساب تنظیم نیست» — فقط برای یک بند
let otpSendBroken = false;
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
/*
 *  فهرستِ پمپ‌ها — برای «دادنِ اشتراک» لازم شد.
 *
 *  ⚠️ `st2` عمداً **هیچ اشتراکی ندارد**: همان حالتی که در فهرستِ
 *  «مشتری‌ها» (که از `sales/subscriptions` می‌آید) اصلاً دیده نمی‌شود، و
 *  همان کسی که می‌خواهیم اشتراک بدهیم.
 */
const stations = [
  { id: 'st1', code: 'PUMP1', name: 'پمپِ یعقوبی', status: 'active', created_at: NOW - 50 * DAY,
    owner_user_id: 'u2', owner_name: 'زهرا', owner_phone: '0711', owner_email: 'z@x.com',
    members: 1, files: 1, subscription_id: 90, plan: 'perm', sub_status: 'active',
    starts_at: NOW - 5 * DAY, ends_at: NOW + 100 * DAY },
  { id: 'st2', code: 'PUMP2', name: 'پمپِ تازه', status: 'active', created_at: NOW - 2 * DAY,
    owner_user_id: 'u3', owner_name: 'هارون', owner_phone: '0722', owner_email: 'haroon@x.com',
    members: 1, files: 0, subscription_id: null, plan: null, sub_status: null,
    starts_at: null, ends_at: null },
];
const accountConfig = { pump_trial_days: '30', trial_days: '14', currency: 'AFN', pump_currency: 'USD' };
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
const salesSubs = [
  { id: 7, app: 'shop', tenantId: 's1', tenantName: 'دکانِ کریم', ownerUserId: 'u1', ownerName: 'کریم', ownerEmail: 'karim@x.com',
    ownerPhone: '0700', city: 'کابل', plan: 'm1', planTitle: 'یک‌ماهه', status: 'active', active: true,
    startsAt: NOW - 10 * DAY, endsAt: NOW + 20 * DAY, daysLeft: 20, permanent: false, price: 500, currency: 'AFN',
    paid: 300, features: ['sync'], note: 'مشتریِ قدیمی' },
  { id: 90, app: 'pump', tenantId: 'st1', tenantName: 'پمپِ یعقوبی', ownerUserId: 'u2', ownerName: 'زهرا', ownerEmail: 'z@x.com',
    ownerPhone: '0711', city: 'هرات', plan: 'perm', planTitle: 'دائمی', status: 'active', active: true,
    startsAt: NOW - 5 * DAY, endsAt: NOW + 3650 * DAY, daysLeft: 3650, permanent: true, price: 600, currency: 'USD',
    paid: 600, features: [], note: '' },
];
const pumpSubs = [
  { id: 90, station_id: 'st1', plan: 'perm', status: 'active', starts_at: NOW - 5 * DAY, ends_at: NOW + 3650 * DAY,
    max_devices: 5, grace_days: 2, note: 'یادداشتِ پمپ' },
];
const payments = [
  { id: 'pay1', app: 'shop', tenantId: 's1', subscriptionId: '7', amount: 300, currency: 'AFN', method: 'cash',
    receiptNo: '2026-00001', note: '', paidAt: NOW - 3 * DAY, createdAt: NOW - 3 * DAY, tenantName: 'دکانِ کریم', ownerName: 'کریم' },
];
const addons = [
  { id: 'adn1', app: 'shop', subscriptionId: '7', tenantId: 's1', feature: 'cloud', price: 100, currency: 'AFN', note: '', createdBy: 'a1', createdAt: NOW, removedAt: null },
];
const priceHistory = [
  { id: 'pph1', app: 'shop', plan: 'm1', prevPrice: 400, price: 500, currency: 'AFN', changedAt: NOW - 10 * DAY, changedBy: 'a1' },
];
const codes = [
  { id: 'dsc1', code: 'NOWRUZ', app: 'shop', plan: '', kind: 'percent', value: 20, currency: 'AFN', userId: '',
    expiresAt: NOW + 30 * DAY, maxUses: 100, oncePerCustomer: true, uses: 3, note: '', status: 'active', createdBy: 'a1', createdAt: NOW - DAY },
];
const campaigns = [
  { id: 'cmp1', name: 'عید', app: 'shop', filter: { kind: 'all' }, discountCodeId: 'dsc1', noticeId: 'ntc1', status: 'active', createdBy: 'a1', createdAt: NOW - DAY },
];
const notices = [
  { id: 'ntc1', app: 'shop', audience: { kind: 'all' }, channels: ['inapp', 'email'], title: 'سلام', body: 'متن',
    templateKey: '', variables: {}, scheduleAt: null, repeat: 'none', status: 'sent', system: false,
    createdBy: 'a1', createdAt: NOW - DAY, updatedAt: NOW - DAY, sentAt: NOW - DAY, runs: 1, counts: { sent: 2 } },
];
const previewCalls = [];
const testCalls = [];
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
      //  ⚠️ **ایمیل هم**، مثلِ خودِ سرورِ حساب از ۱۴۰۵/۰۷/۰۸. بی این،
      //  سنجهٔ «دادنِ اشتراک با ایمیل» روی دکان سبزِ دروغ می‌داد.
      const hit = (x) => !q || [x.name, x.owner_name, x.owner_email, x.owner_phone]
        .some((v) => String(v || '').toLowerCase().includes(q));
      return j(200, { shops: shops.filter(hit), total: shops.length, limit: 200, offset: 0 });
    }
    //  ══ میزِ فروشگاه — بندهای ۴.۲ تا ۴.۴ ══════════════════════════════
    if (p === '/api/admin/shop-desk/overview' && req.method === 'GET') {
      return j(200, {
        app: 'shop', serverTime: NOW, onlineWithinMs: 600000,
        counts: { shops: 2, customers: 2, subscribed: 1, online: 1, expiring: 1, supportOpen: 3, supportUnread: 5 },
        expiring: [{ subscriptionId: 'sub-x', tenantId: 'shp-1', tenantName: 'دکانِ یک',
                     ownerName: 'هارون', ownerEmail: 'haroon@x.com', plan: 'm1',
                     endsAt: NOW + 2 * DAY, daysLeft: 2 }],
        support: [{ id: 'th-1', subject: 'سلام', who: 'هارون', status: 'open', unread_admin: 2 }],
        days: Number(u.searchParams.get('days')) || 7,
      });
    }
    if (p === '/api/admin/shop-desk/groups' && req.method === 'GET') {
      return j(200, {
        app: 'shop', serverTime: NOW,
        groups: {
          has: [{ tenantId: 'shp-1', tenantName: 'دکانِ یک', ownerEmail: 'haroon@x.com', ownerName: 'هارون',
                  ownerPhone: '', subscriptionId: 'sub-x', plan: 'm1', status: 'active',
                  endsAt: NOW + 2 * DAY, daysLeft: 2, createdAt: NOW }],
          none: [{ tenantId: 'shp-2', tenantName: 'دکانِ دو', ownerEmail: 'b@x.com', ownerName: '',
                   ownerPhone: '', subscriptionId: '', plan: '', status: 'none', endsAt: 0, daysLeft: 0, createdAt: NOW }],
          expired: [],
        },
        counts: { has: 1, none: 1, expired: 0 },
      });
    }
    if ((m = /^\/api\/admin\/shops\/([^/]+)\/staff-codes$/.exec(p)) && req.method === 'GET') {
      return j(200, {
        shop: { id: m[1], name: 'دکانِ یک' },
        students: { total: 2, active: 2, members: 3 },
        standing: { id: 'stc-1', role: 'staff', generation: 1, usedCount: 4 },
        codes: [{ id: 'stc-2', hint: 'PL51', role: 'staff', status: 'active', createdAt: NOW,
                  expiresAt: null, maxUses: 1, usedCount: 0 }],
      });
    }
    if ((m = /^\/api\/admin\/shops\/([^/]+)\/staff-codes\/reveal$/.exec(p)) && req.method === 'POST') {
      return j(200, { ok: true, code: 'SHG-8F29-KD72-PL51', role: 'staff', generation: 1 });
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
    //  ⚠️ `config` واقعاً همراهِ پاسخِ پلن‌ها می‌آید (‎admin.js‎، ‎allConfig()‎)
    //  و `‎/account-config‎` از همین‌جا می‌خواندش — سرورِ حساب هیچ `GET`ی
    //  برای `config` ندارد.
    if (p === '/api/admin/plans' && req.method === 'GET') return j(200, { plans, app: u.searchParams.get('app') || 'shop', config: { ...accountConfig } });
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
    /* ─── مشتری‌ها، پول و پیام — همان شکلِ shop/server ─────────────── */
    if (p === '/api/admin/sales/subscriptions' && req.method === 'GET') {
      const want = u.searchParams.get('app') || '';
      const rows = salesSubs.filter((s) => !want || s.app === want)
        .filter((s) => !u.searchParams.get('status') || s.status === u.searchParams.get('status'))
        .filter((s) => !u.searchParams.get('kind') || (u.searchParams.get('kind') === 'permanent' ? s.permanent : s.plan === u.searchParams.get('kind')))
        .filter((s) => !u.searchParams.get('city') || String(s.city).includes(u.searchParams.get('city')));
      return j(200, { subscriptions: rows, serverTime: NOW });
    }
    if (p === '/api/admin/sales/summary') {
      return j(200, {
        revenue: { today: { shop: { AFN: 500 }, pump: {} }, month: { shop: { AFN: 1500 }, pump: { USD: 120 } }, year: { shop: { AFN: 9000 }, pump: { USD: 600 } } },
        series: [{ month: '2026-08', from: NOW - 30 * DAY, to: NOW, shop: { AFN: 1500 }, pump: { USD: 120 }, payments: 2 }],
        counts: { shop: { active: 1, expired: 0, suspended: 0, tenants: 2 }, pump: { active: 1, expired: 0, suspended: 0, tenants: 1 } },
        serverTime: NOW,
      });
    }
    if (p === '/api/admin/sales/expiring') {
      return j(200, { expiring: [{ subscriptionId: 7, app: 'shop', tenantId: 's1', tenantName: 'دکانِ کریم', ownerName: 'کریم', ownerEmail: 'karim@x.com', ownerPhone: '0700', plan: 'm1', status: 'active', endsAt: NOW + 20 * DAY, graceEndsAt: NOW + 20 * DAY, daysLeft: 20, note: '' }], days: Number(u.searchParams.get('days')) || 7, serverTime: NOW });
    }
    if (p === '/api/admin/sales/expiring/remind' && req.method === 'POST') return j(200, { noticeId: 'ntc9', sent: 3, failed: 0 });
    if (p === '/api/admin/sales/debts') return j(200, { debts: [{ ...salesSubs[0], price: 500, debt: 200 }], serverTime: NOW });

    if (p === '/api/admin/payments' && req.method === 'GET') {
      const want = u.searchParams.get('app') || '';
      const tid = u.searchParams.get('tenantId') || '';
      return j(200, { payments: payments.filter((x) => (!want || x.app === want) && (!tid || x.tenantId === tid)) });
    }
    if (p === '/api/admin/payments' && req.method === 'POST') {
      const row = { id: `pay${payments.length + 1}`, app: body.app, tenantId: body.tenantId, subscriptionId: '', amount: body.amount, currency: body.currency, method: body.method, receiptNo: body.receiptNo || '2026-00002', note: body.note || '', paidAt: body.paidAt || NOW, createdAt: NOW, tenantName: 'دکانِ کریم' };
      payments.push(row);
      return j(201, { payment: row });
    }
    if ((m = /^\/api\/admin\/payments\/([^/]+)$/.exec(p)) && req.method === 'PUT') {
      const row = payments.find((x) => x.id === m[1]);
      if (!row) return j(404, { error: { code: 'payment_not_found', message: 'پرداخت پیدا نشد' } });
      Object.assign(row, { amount: body.amount ?? row.amount, note: body.note ?? row.note });
      return j(200, { payment: row });
    }
    if ((m = /^\/api\/admin\/payments\/([^/]+)$/.exec(p)) && req.method === 'DELETE') {
      const i = payments.findIndex((x) => x.id === m[1]);
      if (i < 0) return j(404, { error: { code: 'payment_not_found', message: 'پرداخت پیدا نشد' } });
      payments.splice(i, 1);
      return j(200, { ok: true });
    }
    if ((m = /^\/api\/admin\/payments\/([^/]+)\/receipt$/.exec(p))) {
      if (!payments.some((x) => x.id === m[1])) return j(404, { error: { code: 'payment_not_found', message: 'پرداخت پیدا نشد' } });
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      return res.end('<!DOCTYPE html><html lang="fa" dir="rtl"><body><h1>رسیدِ پرداخت</h1></body></html>');
    }

    //  کارهای روی یک اشتراک — دکان و پمپ، همان دو پیشوندِ سرورِ حساب
    if ((m = /^\/api\/admin(\/pump)?\/subscriptions\/([^/]+)\/permanent$/.exec(p)) && req.method === 'POST') {
      return j(200, { subscription: { id: m[2], plan: 'perm', app: m[1] ? 'pump' : 'shop' }, state: { active: true }, permanent: true });
    }
    if ((m = /^\/api\/admin(\/pump)?\/subscriptions\/([^/]+)\/discount$/.exec(p)) && req.method === 'POST') {
      return j(200, { subscription: { id: m[2] }, price: 500, finalPrice: 400, savings: 100, state: { active: true } });
    }
    if ((m = /^\/api\/admin(\/pump)?\/subscriptions\/([^/]+)\/addons$/.exec(p))) {
      if (req.method === 'GET') return j(200, { addons: addons.filter((a) => String(a.subscriptionId) === m[2]) });
      if (req.method === 'POST') {
        const row = { id: `adn${addons.length + 1}`, app: m[1] ? 'pump' : 'shop', subscriptionId: m[2], tenantId: 's1', feature: body.feature, price: body.price || 0, currency: 'AFN', note: body.note || '', createdBy: 'a1', createdAt: NOW, removedAt: null };
        addons.push(row);
        return j(201, { addon: row });
      }
    }
    if ((m = /^\/api\/admin(\/pump)?\/subscriptions\/([^/]+)\/addons\/([^/]+)$/.exec(p)) && req.method === 'DELETE') {
      const i = addons.findIndex((a) => a.id === m[3]);
      const row = i < 0 ? { id: m[3], feature: 'gone' } : addons.splice(i, 1)[0];
      return j(200, { addon: row });
    }

    //  بخشِ پمپ
    if (p === '/api/admin/pump/subscriptions' && req.method === 'GET') return j(200, { subscriptions: pumpSubs.map((s) => ({ ...s, state: { active: s.status === 'active' } })) });
    if (p === '/api/admin/pump/subscriptions' && req.method === 'POST') {
      const row = { id: 91, station_id: body.stationId, plan: body.plan, status: 'active', starts_at: NOW, ends_at: body.endsAt || NOW + 30 * DAY, max_devices: body.maxDevices || 10, grace_days: body.graceDays || 0, note: body.note || '' };
      pumpSubs.push(row);
      return j(201, { subscription: row, state: { active: true } });
    }
    if ((m = /^\/api\/admin\/pump\/subscriptions\/([^/]+)\/status$/.exec(p)) && req.method === 'POST') {
      const row = pumpSubs.find((x) => String(x.id) === m[1]);
      if (!row) return j(404, { error: { code: 'not_found', message: 'اشتراک پیدا نشد' } });
      row.status = body.status;
      return j(200, { subscription: row, state: { active: row.status === 'active' } });
    }
    if (p === '/api/admin/pump/stations' && req.method === 'GET') {
      const q = (u.searchParams.get('q') || '').toLowerCase();
      //  ⚠️ **ایمیل هم گشته می‌شود** — همان چیزی که از ۱۴۰۵/۰۷/۰۸ سمتِ
      //  سرورِ حساب اضافه شد. سنجهٔ زیر روی همین حساب می‌کند.
      const hit = (x) => !q || [x.name, x.code, x.owner_name, x.owner_email, x.owner_phone]
        .some((v) => String(v || '').toLowerCase().includes(q));
      return j(200, { stations: stations.filter(hit), total: stations.length, limit: 50, offset: 0 });
    }
    if ((m = /^\/api\/admin\/pump\/stations\/([^/]+)$/.exec(p)) && req.method === 'GET') {
      if (m[1] !== 'st1') return j(404, { error: { code: 'station_not_found', message: 'پمپ پیدا نشد' } });
      return j(200, {
        station: { id: 'st1', code: 'PUMP1', name: 'پمپِ یعقوبی', status: 'active', createdAt: NOW - 50 * DAY, ownerUserId: 'u2' },
        accessCode: 'K7PM-3XQ2',
        owner: { id: 'u2', name: 'زهرا', email: 'z@x.com', phone: '0711', status: 'active' },
        members: [], entitlement: { source: 'subscription', features: ['dashboard'] },
        subscription: { id: 90, active: true }, files: [{ path: 'acct-1', rev: 2, size: 120, updatedAt: NOW }],
        serverTime: NOW,
      });
    }
    if ((m = /^\/api\/admin\/pump\/stations\/([^/]+)\/history$/.exec(p))) return j(200, { history: [{ action: 'grant', prev_status: 'none', new_status: 'active', actor: 'a1', created_at: NOW - DAY }] });
    if ((m = /^\/api\/admin\/shops\/([^/]+)\/history$/.exec(p))) return j(200, { history: [{ action: 'renew', prev_status: 'active', new_status: 'active', actor: 'a1', created_at: NOW - DAY }] });

    //  پلن و قیمت
    if ((m = /^\/api\/admin\/plans\/([^/]+)$/.exec(p)) && req.method === 'PATCH') {
      const plan = plans.find((x) => x.code === m[1]);
      if (!plan) return j(404, { error: { code: 'not_found', message: 'پلن پیدا نشد' } });
      if (body.title) plan.title = body.title;
      if (body.price !== undefined) { plan.price = body.price; plan.fullPrice = body.price; }
      return j(200, { plan });
    }
    if (p === '/api/admin/config' && req.method === 'PATCH') {
      for (const [k, val] of Object.entries(body || {})) accountConfig[k] = String(val);
      return j(200, { config: { ...accountConfig } });
    }
    if ((m = /^\/api\/admin\/plans\/([^/]+)\/price-history$/.exec(p))) return j(200, { history: priceHistory.filter((h) => h.plan === m[1]) });
    if (p === '/api/admin/price-history') return j(200, { history: priceHistory });

    //  تخفیف و کمپین
    if (p === '/api/admin/discount-codes' && req.method === 'GET') {
      const want = u.searchParams.get('app') || '';
      return j(200, { codes: codes.filter((c) => !want || c.app === want) });
    }
    if (p === '/api/admin/discount-codes' && req.method === 'POST') {
      const row = { id: `dsc${codes.length + 1}`, code: body.code || 'AUTO-1', app: body.app, plan: body.plan || '', kind: body.kind, value: body.value, currency: body.app === 'pump' ? 'USD' : 'AFN', userId: body.userId || '', expiresAt: body.expiresAt || null, maxUses: body.maxUses, oncePerCustomer: body.oncePerCustomer, uses: 0, note: body.note || '', status: 'active', createdBy: 'a1', createdAt: NOW };
      codes.push(row);
      return j(201, { code: row });
    }
    if ((m = /^\/api\/admin\/discount-codes\/([^/]+)\/revoke$/.exec(p)) && req.method === 'POST') {
      const row = codes.find((c) => c.id === m[1]);
      if (!row) return j(404, { error: { code: 'code_not_found', message: 'کد پیدا نشد' } });
      row.status = 'revoked';
      return j(200, { code: row });
    }
    if (p === '/api/admin/discount-codes/quote' && req.method === 'POST') return j(200, { code: codes[0], currency: 'AFN', plan: body.plan, price: 500, finalPrice: 450, savings: 50, prices: [] });
    if (p === '/api/admin/campaigns' && req.method === 'GET') return j(200, { campaigns });
    if (p === '/api/admin/campaigns' && req.method === 'POST') {
      const row = { id: `cmp${campaigns.length + 1}`, name: body.name, app: body.app, filter: body.filter, discountCodeId: 'dsc1', noticeId: 'ntc1', status: 'active', createdBy: 'a1', createdAt: NOW };
      campaigns.push(row);
      return j(201, { campaign: row, codes: [codes[0]], notice: notices[0], sent: { sent: 3, failed: 0 } });
    }
    if ((m = /^\/api\/admin\/campaigns\/([^/]+)\/stats$/.exec(p))) {
      const row = campaigns.find((c) => c.id === m[1]);
      if (!row) return j(404, { error: { code: 'campaign_not_found', message: 'کمپین پیدا نشد' } });
      return j(200, { campaign: row, codes: [codes[0]], recipients: 4, sent: 4, seen: 2, codeUses: 1, renewed: 1 });
    }

    //  مرکزِ اعلان
    if (p === '/api/admin/notice-templates' && req.method === 'GET') {
      return j(200, { templates: [{ key: 'expiring', app: 'both', title: 'اشتراک رو به پایان است', body: 'سلام {نام}', channels: ['inapp', 'email'], editable: true, updatedAt: NOW }], variables: ['{نام}', '{برنامه}', '{روز-مانده}'] });
    }
    if ((m = /^\/api\/admin\/notice-templates\/([^/]+)$/.exec(p)) && req.method === 'PUT') {
      return j(200, { template: { key: m[1], app: body.app, title: body.title, body: body.body, channels: body.channels || ['inapp'] } });
    }
    if (p === '/api/admin/notices' && req.method === 'GET') return j(200, { notices });
    if (p === '/api/admin/notices' && req.method === 'POST') {
      const row = { id: `ntc${notices.length + 1}`, app: body.app, audience: body.audience, channels: body.channels, title: body.title, body: body.body, templateKey: body.templateKey || '', variables: {}, scheduleAt: null, repeat: 'none', status: 'draft', system: false, createdBy: 'a1', createdAt: NOW, updatedAt: NOW, sentAt: null, runs: 0, counts: {} };
      notices.push(row);
      return j(201, { notice: row, sent: body.send ? { sent: 2, failed: 0 } : null });
    }
    if (p === '/api/admin/notices/audience' && req.method === 'POST') {
      return j(200, { count: body.audience?.kind === 'user' ? 1 : 4, recipients: [{ app: body.app === 'pump' ? 'pump' : 'shop', userId: 'u1', tenantId: 's1', name: 'کریم', tenantName: 'دکانِ کریم', email: 'karim@x.com', city: 'کابل', plan: 'm1', status: 'active', daysLeft: 20, permanent: false }] });
    }
    if (p === '/api/admin/notices/run-system' && req.method === 'POST') return j(200, { checked: 2, created: 1 });
    if ((m = /^\/api\/admin\/notices\/([^/]+)$/.exec(p))) {
      const row = notices.find((n) => n.id === m[1]);
      if (!row) return j(404, { error: { code: 'notice_not_found', message: 'اعلان پیدا نشد' } });
      if (req.method === 'GET') return j(200, { notice: row });
      if (req.method === 'PUT') { Object.assign(row, { title: body.title, body: body.body, channels: body.channels, audience: body.audience, app: body.app }); return j(200, { notice: row }); }
      if (req.method === 'DELETE') { notices.splice(notices.indexOf(row), 1); return j(200, { ok: true }); }
    }
    if ((m = /^\/api\/admin\/notices\/([^/]+)\/preview$/.exec(p)) && req.method === 'POST') {
      previewCalls.push(m[1]);
      return j(200, { notice: notices.find((n) => n.id === m[1]) || null, recipients: 4, sample: [{ app: 'shop', userId: 'u1', tenantId: 's1', name: 'کریم', tenantName: 'دکانِ کریم', email: 'karim@x.com', daysLeft: 20, plan: 'm1', title: 'سلام کریم', body: 'بیست روز مانده' }], emailHtml: '<html></html>' });
    }
    if ((m = /^\/api\/admin\/notices\/([^/]+)\/test$/.exec(p)) && req.method === 'POST') { testCalls.push(body.to || ''); return j(200, { ok: true, to: body.to }); }
    if ((m = /^\/api\/admin\/notices\/([^/]+)\/send$/.exec(p)) && req.method === 'POST') return j(200, { ok: true, sent: 2, failed: 1, recipients: 3 });
    if ((m = /^\/api\/admin\/notices\/([^/]+)\/schedule$/.exec(p)) && req.method === 'POST') {
      const row = notices.find((n) => n.id === m[1]);
      if (row) { row.scheduleAt = body.scheduleAt; row.repeat = body.repeat; row.status = body.scheduleAt ? 'scheduled' : 'draft'; }
      return j(200, { notice: row });
    }
    if ((m = /^\/api\/admin\/notices\/([^/]+)\/report$/.exec(p))) {
      return j(200, { notice: notices.find((n) => n.id === m[1]) || null, summary: { total: 2, queued: 0, sent: 1, delivered: 0, read: 1, error: 0 },
        deliveries: [
          { id: 'dlv1', noticeId: m[1], app: 'shop', userId: 'u1', tenantId: 's1', channel: 'email', status: 'sent', who: 'کریم', address: 'karim@x.com', title: 'سلام', body: 'متن', error: null, run: 1, createdAt: NOW, sentAt: NOW, deliveredAt: null, readAt: null },
          { id: 'dlv2', noticeId: m[1], app: 'shop', userId: 'u1', tenantId: 's1', channel: 'inapp', status: 'read', who: 'کریم', address: '', title: 'سلام', body: 'متن', error: null, run: 1, createdAt: NOW, sentAt: NOW, deliveredAt: NOW, readAt: NOW },
        ] });
    }

    //  Sync
    if (p === '/api/admin/sync/status') {
      return j(200, { app: u.searchParams.get('app'), devices: [{ account: { kind: 'shop', id: 's1' }, device_id: 'dev-1', cursor: 8, last_push_at: NOW - 600e3, last_pull_at: NOW - 300e3, last_op_at: NOW - 600e3, queued_count: 2, app_version: '2.1.0', schema_version: 3, last_seen_at: NOW - 300e3, head: 10, behind: 2, conflicts: 1, deleted: 0 }] });
    }
    if (p === '/api/admin/sync/conflicts') {
      if (!u.searchParams.get('account')) return j(400, { error: { code: 'account_required', message: 'شناسهٔ حساب لازم است' } });
      return j(200, { conflicts: [{ id: 5, app: 'shop', account: { kind: 'shop', id: 's1' }, table: 'products', row_id: 'p1', field: 'price', loser_value: 1, winner_value: 2, loser_op_id: 'o1', winner_op_id: 'o2', loser_device: 'dev-1', winner_device: 'dev-2', at: NOW - 3600e3, restored_at: null }] });
    }
    if ((m = /^\/api\/admin\/sync\/conflicts\/([^/]+)\/restore$/.exec(p)) && req.method === 'POST') return j(200, { ok: true, head: 11 });
    if (p === '/api/admin/sync/errors') return j(200, { errors: [{ id: 'err1', app: 'shop', account_kind: 'shop', account_id: 's1', device_id: 'dev-1', user_id: 'u1', tenant_id: 's1', app_version: '2.1.0', version: '', platform: 'android', message: 'خطای آزمایشی', stack: '', at: NOW - 60e3, created_at: NOW - 60e3 }] });

    //  ورودها
    /*
     *  ⚠️ **ردیفِ زنده، همان‌طور که واقعی می‌دهد.** تا ۱.۵۰.۲ این ردیف نه
     *  `active` داشت نه `expires_at`، پس پنل «منقضی» می‌خواندش — و هیچ
     *  بندی هم این را نمی‌دید، چون تنها ادعای آن روزها «کد در فهرست
     *  نیست» بود که برای ردیفِ مرده هم سبز می‌شد. همان «ساختگی باید همان
     *  کاری را بکند که واقعی می‌کند».
     */
    if (p === '/api/admin/logins' && req.method === 'GET') return j(200, { requests: [{ request_id: 'req1', app: 'shop', masked_email: 'k***@x.com', state: 'sent', created_at: NOW - 120e3, expires_at: NOW + 120e3, active: true, code_attempts: 1 }], worker: { alive: true } });
    if (p === '/api/admin/email' && req.method === 'GET') return j(200, { email: { provider: 'log', from: 'a@b.c', host: '' } });
    if (p === '/api/admin/logins/stats') return j(200, { sent: 12, failed: 1, queued: 0, p50: 120, p95: 400, worker: { alive: true }, alerts: [] });
    if ((m = /^\/api\/admin\/logins\/([^/]+)\/resend$/.exec(p)) && req.method === 'POST') return j(200, { ok: true, result: 'sent', status: 'sent' });
    if (p === '/api/admin/logins/unlock' && req.method === 'POST') return j(200, { ok: true });
    if ((m = /^\/api\/admin\/logins\/([^/]+)\/reveal$/.exec(p))) return j(200, { ok: true, code: '999111' });

    /*
     *  دفترِ **دومِ** کدهای سرورِ حساب — `otp_codes` (ثبت‌نام و رمزِ
     *  فراموش‌شده). گزارشِ صاحب سامانه: کد به ایمیلش رسید و این صفحه
     *  می‌گفت «هنوز کسی کد نخواسته»، چون پنل فقط دفترِ اول را می‌خواند.
     *
     *  ⚠️ ساختگی باید همان کاری را بکند که واقعی می‌کند — همان درسِ
     *  «ایمیل را نمی‌گشت و سنجه سبزِ دروغ می‌داد».
     */
    if (p === '/api/admin/otp' && req.method === 'GET') {
      //  سرورِ حسابِ کهنه این دفتر را ندارد
      if (otpOff) return j(404, { error: { code: 'not_found', message: 'این مسیر وجود ندارد' } });
      const want = u.searchParams.get('app') || '';
      const rows = [{
        id: 'otp_reg1', purpose: 'register', app: 'pump',
        destination: 'haroon@x.com', masked_destination: 'ha***@x.com',
        attempts: 0, max_attempts: 5,
        created_at: NOW - 30e3, expires_at: NOW + 240e3, consumed_at: null,
        sent_at: NOW - 29e3, via: 'log', log_only: true,
        active: true, can_reveal: true,
      }];
      return j(200, { requests: want && want !== 'pump' ? [] : rows });
    }
    if ((m = /^\/api\/admin\/otp\/([^/]+)\/reveal$/.exec(p))) return j(200, { ok: true, code: '622186', expires_in: 210 });
    /*
     *  ⛔ فرستادنِ دوباره — و ساختگی باید همان کاری را بکند که واقعی
     *  می‌کند: با رباتِ تنظیم‌نشده ۴۰۹ می‌دهد، نه ۲۰۰. یک بار همین
     *  «ساختگیِ خوش‌بین» سنجه را سبزِ دروغ کرد.
     */
    if (p === '/api/admin/otp/password-reset' && req.method === 'POST') {
      const mail = String(body?.email || '');
      //  ⚠️ ساختگی همان کاری را می‌کند که واقعی: نشانیِ ناموجود ۴۰۴
      if (!mail.includes('@') || mail.startsWith('nobody')) {
        return j(404, { error: { code: 'user_not_found', message: 'حسابی با این ایمیل نیست' } });
      }
      return j(201, { ok: true, email: mail, expiresAt: NOW + 300e3, resendSeconds: 60 });
    }
    if ((m = /^\/api\/admin\/otp\/([^/]+)\/resend$/.exec(p))) {
      if (otpSendBroken) {
        return j(409, { error: { code: 'delivery_not_configured', message: 'رباتِ ارسال تنظیم نیست' } });
      }
      return j(200, { ok: true, via: 'smtp' });
    }

    //  ── دسترسی‌هایی که در ۱.۴۱.۰ از پنل افتادند و در ۱.۴۷.۰ برگشتند ──
    if (p === '/api/admin/vip-codes' && req.method === 'GET') {
      return j(200, { codes: [{ id: 'v1', app: 'shop', hint: 'A1••••', plan: 'm1', days: null, maxDevices: 10, note: '', email: 'k@x.com', emailStatus: 'sent', emailError: '', phone: '', smsStatus: 'none', status: 'active', createdAt: NOW - 60e3, expiresAt: NOW + 30 * 86400e3, usedAt: null, shopId: '' }] });
    }
    if (p === '/api/admin/vip-codes' && req.method === 'POST') {
      return j(201, { code: 'A1B2C3', vipCode: { id: 'v2', hint: 'A1••••', email: '', phone: '' }, emailStatus: 'none' });
    }
    if (/^\/api\/admin\/vip-codes\/[^/]+\/revoke$/.test(p)) return j(200, { vipCode: { id: 'v1', status: 'revoked' } });
    //  ⚠️ پمپ دفترِ **جدا** دارد؛ اگر پل `app` را نبرد، این هیچ‌وقت صدا نمی‌خورد
    if (p === '/api/admin/pump/vip-codes' && req.method === 'GET') return j(200, { codes: [{ id: 'pv1', app: 'pump', hint: 'P9••••', plan: 'std', status: 'active', createdAt: NOW }] });
    if (p === '/api/admin/pump/vip-codes' && req.method === 'POST') return j(201, { code: 'PUMP01', vipCode: { id: 'pv2', hint: 'PU••••' } });

    if (p === '/api/admin/purchase-requests') return j(200, { requests: [{ id: 'pr1', shop_id: 's1', user_id: 'u1', plan_code: 'm1', note: '', status: 'pending', created_at: NOW - 3600e3, shop_name: 'دکانِ یک', user_name: 'کریم', phone: '' }] });
    if (/^\/api\/admin\/purchase-requests\/[^/]+\/approve$/.test(p)) return j(200, { subscription: { id: 'sub9' } });
    if (/^\/api\/admin\/purchase-requests\/[^/]+\/reject$/.test(p)) return j(200, { ok: true });

    if (p === '/api/admin/visitors') return j(200, { visitors: [{ id: 'vi1', app: 'shop', platform: 'android', appVersion: '3.2', userId: '', name: 'مهمان', ip: '1.2.3.4', accountName: '', accountEmail: '', shopName: '', stationName: '', stationCode: '', location: null, lastSeenAt: NOW }], summary: {} });

    if (p === '/api/admin/apps' && req.method === 'GET') return j(200, { apps: [{ id: 'a1', slug: 'shop', title: 'دکان', kind: 'app', url: '', healthUrl: '', status: 'active', keySet: true, keyHint: '••1234', lastCheckAt: NOW, lastOk: true, lastStatus: 200, lastMs: 12, lastError: '' }] });
    if (/^\/api\/admin\/apps\/[^/]+\/key$/.test(p)) return j(200, { key: 'KEY-NEW-1' });
    if (p === '/api/admin/apps/health' && req.method === 'POST') return j(200, { ok: true });

    if (p === '/api/admin/email' && req.method === 'PUT') return j(200, { email: { provider: 'smtp', ready: true } });
    if (p === '/api/admin/email/test' && req.method === 'POST') return j(200, { ok: true });
    if (p === '/api/admin/push') return j(200, { push: { enabled: false, project: '', tokens: 0 } });
    if (p === '/api/admin/sms') return j(200, { sms: { provider: 'none', ready: false, keySet: false } });
    if (p === '/api/admin/audit') return j(200, { entries: [{ id: 1, action: 'admin.vip_code_created', target_id: 'v1', created_at: NOW }] });

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

  console.log('\n── مشتری‌ها: یک فهرست برای هر دو بخش ──');
  const beforeCust = seen.length;
  const cust = await api('GET', '/api/account-admin/customers', undefined, auth);
  const custRows = cust.json?.subscriptions || [];
  const custPaths = seen.slice(beforeCust).map((r) => r.path);
  //  ⚠️ `last()` این‌جا دیگر `sales/subscriptions` نیست — دفترِ حساب‌ها
  //  بعدش خوانده می‌شود. ملاک «زده شد» است، نه «آخرین بود».
  check('فهرستِ مشتری‌ها از ‎/api/admin/sales/subscriptions‎ می‌آید',
    cust.status === 200 && custPaths.includes('/api/admin/sales/subscriptions')
      && custRows.filter((r) => !r.neverSubscribed).length === 2,
    `${cust.status} ${JSON.stringify(custPaths)}`);

  /*
   *  ⛔ گزارشِ صاحب سامانه (۱۴۰۵/۰۷/۱۱): «توی سرور حساب‌های ثبت‌شده رو هم
   *  بالا نمیاره.» ریشه‌اش این بود که فهرست فقط از `sales/subscriptions`
   *  می‌آمد، یعنی **فقط حساب‌هایی که ردیفِ اشتراک دارند** — و حسابِ تازه‌ای
   *  که هنوز چیزی نخریده، دقیقاً همان کسی است که می‌خواهیم به او بفروشیم.
   */
  check('⛔ دفترِ خودِ حساب‌ها هم خوانده می‌شود، نه فقط اشتراک‌ها',
    custPaths.includes('/api/admin/pump/stations') && custPaths.includes('/api/admin/shops'),
    JSON.stringify(custPaths));
  const never = custRows.filter((r) => r.neverSubscribed);
  check('⛔ پمپِ بی‌اشتراک در فهرست هست و نشانِ صریح دارد',
    never.some((r) => r.app === 'pump' && r.tenantId === 'st2' && r.ownerEmail === 'haroon@x.com'),
    JSON.stringify(never).slice(0, 200));
  check('⛔ و شناسه‌اش هیچ‌وقت با شناسهٔ یک اشتراکِ واقعی یکی نمی‌شود',
    never.every((r) => String(r.id).startsWith('acct:')), JSON.stringify(never.map((r) => r.id)));
  check('⛔ حسابی که اشتراک دارد دوباره به‌عنوان «بی‌اشتراک» نمی‌آید',
    !never.some((r) => r.tenantId === 'st1'), JSON.stringify(never.map((r) => r.tenantId)));
  check('⚠️ و سقفِ دفترِ حساب‌ها از ۲۰۰ بالاتر نمی‌رود (وگرنه ۴۰۰ِ خاموش)',
    seen.slice(beforeCust).filter((r) => r.path === '/api/admin/shops')
      .every((r) => Number(r.query?.limit) <= 200),
    JSON.stringify(seen.slice(beforeCust).filter((r) => r.path === '/api/admin/shops').map((r) => r.query)));

  //  ⛔ فیلترِ حال دستِ سرور است؛ «بی‌اشتراک» جوابِ «فعال‌ها را بده» نیست.
  const onlyActive = await api('GET', '/api/account-admin/customers?status=active', undefined, auth);
  check('⛔ با فیلترِ حال، حسابِ بی‌اشتراک قاطی نمی‌شود',
    onlyActive.status === 200 && !(onlyActive.json?.subscriptions || []).some((r) => r.neverSubscribed),
    JSON.stringify(onlyActive.json).slice(0, 160));

  const shopRow = custRows.find((r) => r.app === 'shop' && !r.neverSubscribed);
  for (const f of ['tenantName', 'ownerEmail', 'city', 'planTitle', 'status', 'daysLeft', 'permanent', 'price', 'paid']) {
    check(`فیلدِ «${f}» در ردیفِ مشتری هست`, shopRow?.[f] !== undefined, JSON.stringify(shopRow));
  }
  const filtered = await api('GET', '/api/account-admin/customers?app=pump&status=active&kind=permanent&city=هرات', undefined, auth);
  check('چهار فیلتر یک‌به‌یک به سرورِ حساب می‌روند',
    filtered.json?.subscriptions?.length === 1 && last()?.query?.app === 'pump' && last()?.query?.status === 'active'
      && last()?.query?.kind === 'permanent' && last()?.query?.city === 'هرات', JSON.stringify(last()?.query));
  const bothQ = await api('GET', '/api/account-admin/customers?app=both', undefined, auth);
  check('«هر دو» یعنی بی فیلترِ بخش، نه app=both', bothQ.status === 200 && last()?.query?.app === undefined, JSON.stringify(last()?.query));

  const pumpProfile = await api('GET', '/api/account-admin/pump-accounts/st1', undefined, auth);
  check('پروندهٔ پمپ: نام، کدِ اپِ کارمندان، صاحب و دستگاه‌ها',
    pumpProfile.status === 200 && pumpProfile.json?.station?.name === 'پمپِ یعقوبی'
      && pumpProfile.json?.accessCode === 'K7PM-3XQ2' && pumpProfile.json?.owner?.email === 'z@x.com'
      && pumpProfile.json?.devices?.[0]?.uid === 'dev-abc', JSON.stringify(pumpProfile.json).slice(0, 260));
  const noPump = await api('GET', '/api/account-admin/pump-accounts/nope', undefined, auth);
  check('پمپِ نبوده ۴۰۴', noPump.status === 404, `${noPump.status}`);

  const hist = await api('GET', '/api/account-admin/customers/shop/s1/history', undefined, auth);
  check('تاریخچهٔ دکان', hist.status === 200 && hist.json?.history?.[0]?.action === 'renew');
  const histPump = await api('GET', '/api/account-admin/customers/pump/st1/history', undefined, auth);
  check('تاریخچهٔ پمپ از مسیرِ پمپ می‌آید', histPump.status === 200 && last()?.path === '/api/admin/pump/stations/st1/history');
  const badApp = await api('GET', '/api/account-admin/customers/site/s1/history', undefined, auth);
  check('بخشِ ناشناخته ۴۰۰ می‌گیرد و به سرورِ حساب نمی‌رسد', badApp.status === 400 && badApp.json?.error === 'bad_app', `${badApp.status}`);

  console.log('\n── «اشتراک بده» — گیرنده با ایمیل، و دورهٔ رایگان ──');
  {
    /*
     *  خواستهٔ صریحِ صاحب سامانه (۱۴۰۵/۰۷/۰۸): «به حسابِ مورد نظر یا
     *  ایمیلِ مد نظر اشتراک بدم… با آسانی دکمهٔ دادنِ اشتراک… و برای
     *  کسایی که تازه حساب افتتاح می‌کنن هم یک ماه رایگان.»
     */
    const all = await api('GET', '/api/account-admin/grant-targets?app=pump', undefined, auth);
    check('فهرستِ گیرنده‌ها از ‎/api/admin/pump/stations‎ می‌آید',
      all.status === 200 && last()?.path === '/api/admin/pump/stations', `${all.status} ${last()?.path}`);
    check('هر ردیف ایمیلِ صاحب را دارد — همان چیزی که با آن می‌گردیم',
      all.json?.items?.some((x) => x.ownerEmail === 'haroon@x.com'), JSON.stringify(all.json?.items?.[1]));

    /*
     *  ⛔ **این بندِ مرکزی است.** `st2` هیچ اشتراکی ندارد، پس در فهرستِ
     *  «مشتری‌ها» (که از `sales/subscriptions` می‌آید) **نیست** — و
     *  دقیقاً همان کسی است که می‌خواهیم اشتراک بدهیم. بی این مسیر، هیچ
     *  راهی به او نبود.
     */
    const fresh = all.json?.items?.find((x) => x.tenantId === 'st2');
    check('حسابِ بی‌اشتراک هم در فهرست است (در «مشتری‌ها» نبود)',
      Boolean(fresh) && fresh.status === 'none' && !fresh.subscriptionId, JSON.stringify(fresh));

    const byMail = await api('GET', '/api/account-admin/grant-targets?app=pump&q=haroon%40x.com', undefined, auth);
    check('جست‌وجو با ایمیلِ کامل همان یکی را می‌دهد',
      byMail.json?.items?.length === 1 && byMail.json.items[0].tenantId === 'st2', JSON.stringify(byMail.json?.items));
    const byPart = await api('GET', '/api/account-admin/grant-targets?app=pump&q=haroon', undefined, auth);
    check('و با بخشی از ایمیل هم', byPart.json?.items?.length === 1, JSON.stringify(byPart.json?.items));
    check('جست‌وجو به خودِ سرورِ حساب می‌رود، نه فیلترِ محلی', last()?.query?.q === 'haroon', JSON.stringify(last()?.query));

    const shopSide = await api('GET', '/api/account-admin/grant-targets?app=shop&q=karim%40x.com', undefined, auth);
    check('همان در برای دکان، از ‎/api/admin/shops‎',
      shopSide.status === 200 && last()?.path === '/api/admin/shops'
        && shopSide.json?.items?.[0]?.tenantId === 's1', `${last()?.path}`);

    //  ⛔ دادنِ اشتراک به همان حسابِ تازه — بی هیچ کدی
    const before = seen.length;
    const gave = await api('POST', '/api/account-admin/subs/pump/grant', { tenantId: 'st2', plan: 'std' }, auth);
    const sent = seen.slice(before).find((x) => x.method === 'POST' && x.path === '/api/admin/pump/subscriptions');
    check('اشتراک به حسابِ بی‌اشتراک می‌نشیند', gave.status === 200 && sent?.body?.stationId === 'st2');
    /*
     *  ⛔ **نه `days`، نه `features`.** `subs.grant` روی سرورِ حساب با
     *  داشتنِ `plan` خودش مدت را از `amount`/`unit`ِ پلن و فهرستِ
     *  قابلیت‌ها را از خودِ پلن برمی‌دارد. فرستادنِ `days`ِ دستی همان
     *  باگی بود که «استاندارد دادم، وی‌آی‌پی گرفت» می‌ساخت.
     */
    check('مدت و قابلیت‌ها فرستاده نمی‌شوند — از خودِ پلن درمی‌آیند',
      sent && sent.body.days === undefined && sent.body.features === undefined, JSON.stringify(sent?.body));

    //  ── دورهٔ آزمایشی: «یک ماه رایگان» ──
    const cfg = await api('GET', '/api/account-admin/account-config', undefined, auth);
    check('دورهٔ آزمایشی خوانده می‌شود، و پمپ یک ماه است',
      cfg.status === 200 && cfg.json?.config?.pump_trial_days === '30', JSON.stringify(cfg.json));
    check('و از ‎/api/admin/plans‎ خوانده شد — سرورِ حساب ‎GET /config‎ ندارد',
      last()?.path === '/api/admin/plans', `${last()?.path}`);
    check('⛔ و هیچ کلیدِ دیگری از تنظیمات درز نمی‌کند',
      Object.keys(cfg.json?.config || {}).every((k) => ['pump_trial_days', 'trial_days'].includes(k)),
      Object.keys(cfg.json?.config || {}).join(','));

    const setTrial = await api('PATCH', '/api/account-admin/account-config', { pump_trial_days: 45 }, auth);
    check('عوض کردنش ⇒ PATCH روی سرورِ حساب',
      setTrial.status === 200 && last()?.method === 'PATCH' && last()?.path === '/api/admin/config'
        && last()?.body?.pump_trial_days === '45', JSON.stringify(last()));
    check('صفر یعنی «دوره‌ای نیست» و پذیرفته می‌شود',
      (await api('PATCH', '/api/account-admin/account-config', { pump_trial_days: 0 }, auth)).status === 200);
    /*
     *  ⚠️ «به سرورِ حساب نرسید» با `last()` سنجیده نمی‌شود: وقتی چیزی
     *  فرستاده **نشود**، `last()` همان درخواستِ موفقِ قبلی را نشان
     *  می‌دهد و سنجه سرخِ دروغ می‌دهد (خودِ همین سنجه گرفتش). ملاک
     *  **شمارِ** درخواست‌هاست.
     */
    const quiet = seen.length;
    const badDays = await api('PATCH', '/api/account-admin/account-config', { pump_trial_days: -3 }, auth);
    check('روزِ منفی ۴۰۰ می‌گیرد و به سرورِ حساب نمی‌رسد',
      badDays.status === 400 && badDays.json?.error === 'bad_days' && seen.length === quiet,
      `${badDays.status} · ${seen.length - quiet} درخواست`);
    const quiet2 = seen.length;
    const emptyPatch = await api('PATCH', '/api/account-admin/account-config', { currency: 'x' }, auth);
    check('⛔ کلیدِ بیرونِ فهرستِ سفید نوشته نمی‌شود و درخواستی هم نمی‌سازد',
      emptyPatch.status === 400 && emptyPatch.json?.error === 'nothing' && seen.length === quiet2,
      `${emptyPatch.status} · ${seen.length - quiet2} درخواست`);
    await api('PATCH', '/api/account-admin/account-config', { pump_trial_days: 30 }, auth);
  }

  console.log('\n── کارها روی یک اشتراک، در هر دو بخش ──');
  const grantPump = await api('POST', '/api/account-admin/subs/pump/grant', { tenantId: 'st1', plan: 'std', maxDevices: 5 }, auth);
  check('اشتراکِ پمپ با ‎stationId‎ می‌رود، نه ‎shopId‎',
    grantPump.status === 200 && last()?.path === '/api/admin/pump/subscriptions'
      && last()?.body?.stationId === 'st1' && last()?.body?.shopId === undefined, JSON.stringify(last()?.body));
  const grantShop = await api('POST', '/api/account-admin/subs/shop/grant', { tenantId: 's2', plan: 'm1' }, auth);
  check('اشتراکِ دکان با ‎shopId‎', grantShop.status === 200 && last()?.path === '/api/admin/subscriptions' && last()?.body?.shopId === 's2');

  const { addPeriod } = await import('../src/routes/account-admin.js');
  const pumpEnd = pumpSubs.find((s) => s.id === 90).ends_at;
  const extPump = await api('POST', '/api/account-admin/subs/pump/90/extend', { amount: 2, unit: 'month' }, auth);
  check('تمدیدِ پمپ ⇒ grant با endsAtِ تقویمی، و پلن/دستگاه/مهلتِ فعلی حفظ می‌شود',
    extPump.status === 200 && last()?.path === '/api/admin/pump/subscriptions'
      && last()?.body?.endsAt === addPeriod(pumpEnd, 2, 'month')
      && last()?.body?.plan === 'perm' && last()?.body?.maxDevices === 5 && last()?.body?.graceDays === 2,
    JSON.stringify(last()?.body));
  const extShop = await api('POST', '/api/account-admin/subs/shop/7/extend', { amount: 1, unit: 'month' }, auth);
  check('تمدیدِ دکان ⇒ PUT روی همان اشتراک', extShop.status === 200 && last()?.method === 'PUT' && last()?.path === '/api/admin/subscriptions/7');
  const extGone = await api('POST', '/api/account-admin/subs/shop/999/extend', { amount: 1, unit: 'month' }, auth);
  check('اشتراکِ نبوده ۴۰۴', extGone.status === 404, `${extGone.status}`);

  const susp = await api('POST', '/api/account-admin/subs/pump/90/status', { status: 'suspended' }, auth);
  check('تعلیقِ پمپ روی مسیرِ پمپ', susp.status === 200 && last()?.path === '/api/admin/pump/subscriptions/90/status' && last()?.body?.status === 'suspended');
  await api('POST', '/api/account-admin/subs/pump/90/status', { status: 'active' }, auth);
  const perm = await api('POST', '/api/account-admin/subs/shop/7/permanent', {}, auth);
  check('دائمی', perm.status === 200 && perm.json?.permanent === true && last()?.path === '/api/admin/subscriptions/7/permanent');
  const dsc = await api('POST', '/api/account-admin/subs/shop/7/discount', { percent: 30, reason: 'مشتریِ قدیمی' }, auth);
  check('تخفیفِ مستقیم با دلیل', dsc.status === 200 && dsc.json?.finalPrice === 400 && last()?.body?.reason === 'مشتریِ قدیمی', JSON.stringify(last()?.body));

  const addonsGet = await api('GET', '/api/account-admin/subs/shop/7/addons', undefined, auth);
  check('افزونه‌ها خوانده می‌شوند', addonsGet.status === 200 && addonsGet.json?.addons?.[0]?.feature === 'cloud');
  const addonAdd = await api('POST', '/api/account-admin/subs/shop/7/addons', { feature: 'reports', price: 50 }, auth);
  check('افزونه اضافه می‌شود', addonAdd.status === 200 && addonAdd.json?.addon?.feature === 'reports');
  const addonDel = await api('DELETE', `/api/account-admin/subs/shop/7/addons/${addonAdd.json?.addon?.id}`, undefined, auth);
  check('افزونه برداشته می‌شود', addonDel.status === 200 && last()?.method === 'DELETE');

  console.log('\n── پلن، قیمت و تاریخچه ──');
  const patch = await api('PATCH', '/api/account-admin/plans/m1?app=shop', { title: 'یک‌ماههٔ تازه', price: 550 }, auth);
  check('ویرایشِ پلن ⇒ PATCH با app',
    patch.status === 200 && last()?.method === 'PATCH' && last()?.path === '/api/admin/plans/m1'
      && last()?.query?.app === 'shop' && last()?.body?.app === 'shop' && last()?.body?.price === 550, JSON.stringify(last()));
  const patchPump = await api('PATCH', '/api/account-admin/plans/m1?app=pump', { price: 120 }, auth);
  check('همان کد در بخشِ پمپ با app=pump می‌رود — دو ردیفِ جدا',
    patchPump.status === 200 && last()?.query?.app === 'pump', JSON.stringify(last()?.query));
  const ph = await api('GET', '/api/account-admin/plans/m1/price-history?app=shop', undefined, auth);
  check('تاریخچهٔ قیمتِ یک پلن', ph.status === 200 && ph.json?.history?.[0]?.prevPrice === 400);
  const phAll = await api('GET', '/api/account-admin/price-history?app=shop', undefined, auth);
  check('تاریخچهٔ قیمتِ همهٔ پلن‌ها', phAll.status === 200 && phAll.json?.history?.length === 1 && last()?.query?.app === 'shop');

  console.log('\n── تخفیف و کمپین ──');
  const codeList = await api('GET', '/api/account-admin/discount-codes?app=shop', undefined, auth);
  check('فهرستِ کدها', codeList.status === 200 && codeList.json?.codes?.[0]?.code === 'NOWRUZ' && last()?.query?.app === 'shop');
  const codeNew = await api('POST', '/api/account-admin/discount-codes', { app: 'pump', kind: 'percent', value: 15, code: 'EID', maxUses: 50 }, auth);
  check('کدِ تازه با بخشِ خودش ساخته می‌شود',
    codeNew.status === 200 && codeNew.json?.code?.app === 'pump' && last()?.body?.app === 'pump' && last()?.body?.value === 15, JSON.stringify(last()?.body));
  const quote = await api('POST', '/api/account-admin/discount-codes/quote', { code: 'NOWRUZ', app: 'shop', plan: 'm1' }, auth);
  check('سنجیدنِ کد از خودِ سرورِ حساب می‌آید — هیچ عددی در پنل حساب نمی‌شود', quote.status === 200 && quote.json?.finalPrice === 450);
  const rev = await api('POST', `/api/account-admin/discount-codes/${codeNew.json?.code?.id}/revoke`, {}, auth);
  check('باطل کردنِ کد', rev.status === 200 && rev.json?.code?.status === 'revoked');
  const campList = await api('GET', '/api/account-admin/campaigns', undefined, auth);
  check('فهرستِ کمپین‌ها', campList.status === 200 && campList.json?.campaigns?.[0]?.name === 'عید');
  const campNew = await api('POST', '/api/account-admin/campaigns', { name: 'تخفیفِ عید', app: 'both', filter: { kind: 'filter', expiring_days: 30 }, discount: { kind: 'percent', value: 20 }, notice: { title: 'سلام' } }, auth);
  check('کمپینِ تازه: فیلتر و تخفیف و اعلان با هم می‌روند',
    campNew.status === 200 && last()?.body?.name === 'تخفیفِ عید' && last()?.body?.filter?.expiring_days === 30
      && last()?.body?.discount?.value === 20, JSON.stringify(last()?.body));
  const campStats = await api('GET', `/api/account-admin/campaigns/${campNew.json?.campaign?.id}/stats`, undefined, auth);
  check('گزارشِ کمپین عدد می‌دهد، نه حدس', campStats.status === 200 && campStats.json?.codeUses === 1 && campStats.json?.renewed === 1);

  console.log('\n── مرکزِ اعلان ──');
  const tpl = await api('GET', '/api/account-admin/notice-templates', undefined, auth);
  check('قالب‌ها با فهرستِ متغیرها', tpl.status === 200 && tpl.json?.templates?.[0]?.key === 'expiring' && (tpl.json?.variables || []).includes('{نام}'));
  const tplSave = await api('PUT', '/api/account-admin/notice-templates/expiring', { app: 'both', title: 'ت', body: 'م' }, auth);
  check('ذخیرهٔ قالب', tplSave.status === 200 && last()?.method === 'PUT' && last()?.path === '/api/admin/notice-templates/expiring');
  const nList = await api('GET', '/api/account-admin/notices?limit=200', undefined, auth);
  check('فهرستِ اعلان‌ها', nList.status === 200 && nList.json?.notices?.[0]?.id === 'ntc1');
  const nNew = await api('POST', '/api/account-admin/notices', { app: 'both', audience: { kind: 'filter', expiring_days: 7 }, channels: ['inapp', 'email'], title: 'یادآوری', body: 'سلام {نام}' }, auth);
  check('ساختنِ اعلان با گیرندهٔ فیلترشده و دو کانال',
    nNew.status === 200 && last()?.body?.app === 'both' && last()?.body?.audience?.expiring_days === 7
      && JSON.stringify(last()?.body?.channels) === JSON.stringify(['inapp', 'email']), JSON.stringify(last()?.body));
  const nId = nNew.json?.notice?.id;
  const aud = await api('POST', '/api/account-admin/notices/audience', { app: 'shop', audience: { kind: 'user', user_id: 'u1' } }, auth);
  check('«چند نفر می‌شود؟» بی ساختنِ اعلان', aud.status === 200 && aud.json?.count === 1 && last()?.path === '/api/admin/notices/audience');
  const prevCount = previewCalls.length;
  const pv = await api('POST', `/api/account-admin/notices/${nId}/preview`, { limit: 10 }, auth);
  check('پیش‌نمایش متنِ پرشده می‌دهد', pv.status === 200 && pv.json?.sample?.[0]?.title === 'سلام کریم' && previewCalls.length === prevCount + 1);
  const tst = await api('POST', `/api/account-admin/notices/${nId}/test`, { to: 'me@x.com' }, auth);
  check('ارسالِ آزمایشی به نشانیِ خودِ مدیر', tst.status === 200 && testCalls.at(-1) === 'me@x.com');
  const sch = await api('POST', `/api/account-admin/notices/${nId}/schedule`, { scheduleAt: NOW + 3 * DAY, repeat: 'monthly' }, auth);
  check('زمان‌بندی با تکرار', sch.status === 200 && last()?.body?.scheduleAt === NOW + 3 * DAY && last()?.body?.repeat === 'monthly');
  const unsch = await api('POST', `/api/account-admin/notices/${nId}/schedule`, { scheduleAt: null }, auth);
  check('برداشتنِ زمان‌بندی', unsch.status === 200 && last()?.body?.scheduleAt === null);
  const snd = await api('POST', `/api/account-admin/notices/${nId}/send`, {}, auth);
  check('فرستادن — و پاسخ ناموفق‌ها را هم می‌گوید', snd.status === 200 && snd.json?.sent === 2 && snd.json?.failed === 1);
  const noticeReport = await api('GET', `/api/account-admin/notices/${nId}/report`, undefined, auth);
  check('گزارش یک ردیف برای هر گیرنده در هر کانال است، نه یک عدد',
    noticeReport.status === 200 && noticeReport.json?.deliveries?.length === 2
      && noticeReport.json.deliveries.some((d) => d.channel === 'email')
      && noticeReport.json.deliveries.some((d) => d.channel === 'inapp'),
    JSON.stringify(noticeReport.json?.summary));
  const sys = await api('POST', '/api/account-admin/notices/run-system', {}, auth);
  check('اجرای دستیِ اعلان‌های خودکار', sys.status === 200 && sys.json?.created === 1);
  const nDel = await api('DELETE', `/api/account-admin/notices/${nId}`, undefined, auth);
  check('حذفِ اعلان', nDel.status === 200 && last()?.method === 'DELETE');

  console.log('\n── فروش، پرداخت و رسید ──');
  const sum = await api('GET', '/api/account-admin/sales/summary', undefined, auth);
  check('درآمدِ امروز/ماه/سال به تفکیکِ بخش و ارز',
    sum.status === 200 && sum.json?.revenue?.month?.shop?.AFN === 1500 && sum.json?.revenue?.year?.pump?.USD === 600, JSON.stringify(sum.json?.revenue));
  check('نمودارِ دوازده ماه از سرور می‌آید', (sum.json?.series || []).length === 1 && sum.json.series[0].month === '2026-08');
  const exp = await api('GET', '/api/account-admin/sales/expiring?days=30&app=shop', undefined, auth);
  check('رو به پایان با روزِ خواسته‌شده', exp.status === 200 && last()?.query?.days === '30' && last()?.query?.app === 'shop');
  const remind = await api('POST', '/api/account-admin/sales/expiring/remind', { days: 30, app: 'both' }, auth);
  check('یادآوریِ ایمیلی از مرکزِ اعلان می‌رود', remind.status === 200 && remind.json?.sent === 3 && last()?.body?.app === 'both');
  const debts = await api('GET', '/api/account-admin/sales/debts', undefined, auth);
  check('بدهی‌ها: اشتراکِ داده‌شده، پرداخت‌نشده', debts.status === 200 && debts.json?.debts?.[0]?.debt === 200);

  const payList = await api('GET', '/api/account-admin/payments?app=shop&tenantId=s1', undefined, auth);
  check('پرداخت‌های یک حساب', payList.status === 200 && payList.json?.payments?.length === 1 && last()?.query?.tenantId === 's1');
  const payNew = await api('POST', '/api/account-admin/payments', { app: 'shop', tenantId: 's1', amount: 200, currency: 'AFN', method: 'hawala' }, auth);
  check('ثبتِ پرداخت', payNew.status === 200 && payNew.json?.payment?.amount === 200 && last()?.body?.method === 'hawala');
  const payEdit = await api('PUT', `/api/account-admin/payments/${payNew.json?.payment?.id}`, { amount: 250 }, auth);
  check('ویرایشِ پرداخت', payEdit.status === 200 && payEdit.json?.payment?.amount === 250);
  const payDel = await api('DELETE', `/api/account-admin/payments/${payNew.json?.payment?.id}`, undefined, auth);
  check('حذفِ پرداخت', payDel.status === 200 && payDel.json?.ok === true);
  const receipt = await fetch(`${BASE}/api/account-admin/payments/pay1/receipt`, { headers: auth });
  const receiptHtml = await receipt.text();
  check('رسید صفحهٔ HTMLِ فارسیِ خودِ سرورِ حساب است، نه PDF و نه JSON',
    receipt.status === 200 && (receipt.headers.get('content-type') || '').includes('text/html')
      && receiptHtml.includes('dir="rtl"') && receiptHtml.includes('رسیدِ پرداخت'), `${receipt.status} ${receiptHtml.slice(0, 120)}`);
  const noReceipt = await fetch(`${BASE}/api/account-admin/payments/nope/receipt`, { headers: auth });
  check('رسیدِ نبوده ۴۰۴', noReceipt.status === 404, `${noReceipt.status}`);

  console.log('\n── وضعیتِ Sync: فقط حال، نه محتوا ──');
  const syncSt = await api('GET', '/api/account-admin/sync/status?app=shop', undefined, auth);
  check('دستگاه‌ها با عقب‌ماندگی و صف', syncSt.status === 200 && syncSt.json?.devices?.[0]?.behind === 2 && syncSt.json?.devices?.[0]?.queued_count === 2);
  const syncNoAcc = await api('GET', '/api/account-admin/sync/conflicts?app=shop', undefined, auth);
  check('تعارض بی شناسهٔ حساب، همان ۴۰۰ی خودِ سرورِ حساب', syncNoAcc.status === 400 && syncNoAcc.json?.error === 'account_required', `${syncNoAcc.status}`);
  const syncCf = await api('GET', '/api/account-admin/sync/conflicts?app=shop&account=s1', undefined, auth);
  check('تعارض‌ها با جدول، ردیف و خانه', syncCf.status === 200 && syncCf.json?.conflicts?.[0]?.field === 'price');
  const syncRestore = await api('POST', '/api/account-admin/sync/conflicts/5/restore', {}, auth);
  check('بازگرداندنِ تعارض', syncRestore.status === 200 && last()?.path === '/api/admin/sync/conflicts/5/restore');
  const syncErr = await api('GET', '/api/account-admin/sync/errors?app=shop', undefined, auth);
  check('خطاهای گزارش‌شدهٔ برنامه', syncErr.status === 200 && syncErr.json?.errors?.[0]?.message === 'خطای آزمایشی');

  console.log('\n── ورود با کدِ ایمیلی ──');
  const lg = await api('GET', '/api/account-admin/logins?app=shop', undefined, auth);
  check('درخواست‌های ورود با ایمیلِ ماسک‌شده', lg.status === 200 && lg.json?.requests?.[0]?.masked_email === 'k***@x.com');
  check('⛔ کدِ خام در فهرست نیست', !JSON.stringify(lg.json).includes('999111'), JSON.stringify(lg.json).slice(0, 160));
  const lgStats = await api('GET', '/api/account-admin/logins/stats', undefined, auth);
  check('آمارِ بیست‌وچهار ساعت', lgStats.status === 200 && lgStats.json?.sent === 12);
  const lgRe = await api('POST', '/api/account-admin/logins/req1/resend', {}, auth);
  check('دوباره فرستادنِ همان کد', lgRe.status === 200 && last()?.path === '/api/admin/logins/req1/resend');
  const lgUn = await api('POST', '/api/account-admin/logins/unlock', { app: 'shop', email: 'k@x.com' }, auth);
  check('برداشتنِ قفلِ تلاشِ زیاد', lgUn.status === 200 && last()?.body?.email === 'k@x.com');
  /*
   *  «نشان دادنِ کد» از ۱.۴۵.۳ باز است — و پیش از آن عمداً بسته بود.
   *  خواستهٔ صریحِ صاحب سامانه آن را پس گرفت («کد ساخته می‌شه، من
   *  نمی‌بینمش»)، و وقتی رباتِ ایمیل تنظیم نشده باشد این تنها راهِ رسیدنِ
   *  کد به دستِ کاربر است. سه نگهبانش پایین سنجیده می‌شود.
   */
  const reveal = await api('POST', '/api/account-admin/logins/req1/reveal', {}, auth);
  check('مدیر می‌تواند کدِ زنده را ببیند',
    reveal.status === 200 && reveal.json?.code === '999111'
      && last()?.path === '/api/admin/logins/req1/reveal',
    `${reveal.status} ${JSON.stringify(reveal.json)}`);

  //  ⛔ و در دفترِ خودِ پنل هم می‌نشیند — نمایشِ بی‌ردپا همان چیزی است که قدغن بود
  const auditRows = await api('GET', '/api/control/audit?limit=50', undefined, auth);
  check('و نمایشِ کد در دفترِ کارهای حساس ثبت شد',
    JSON.stringify(auditRows.json || {}).includes('account.login.reveal'),
    String(auditRows.status));

  //  حالِ رباتِ ایمیلِ سرورِ حساب — «log» یعنی هیچ ایمیلی نمی‌رود
  const mail = await api('GET', '/api/account-admin/mail', undefined, auth);
  check('حالِ رباتِ ایمیلِ سرورِ حساب خوانده می‌شود',
    mail.status === 200 && mail.json?.email?.provider === 'log',
    `${mail.status} ${JSON.stringify(mail.json)}`);

  /*
   *  ⛔ کدهای سرورِ حساب باید در «کدهای زنده» دیده شوند.
   *
   *  دو دفترِ کد هست و این یک بار کاربر را کاملاً گیج کرد: روی گوشی نوشته
   *  بود «کد شش‌رقمی فرستاده شد» و این صفحه می‌گفت «هنوز کسی کد نخواسته»،
   *  چون فقط دفترِ خودِ پنل را می‌خواند.
   */
  const live = await api('GET', '/api/codes-admin/live', undefined, auth);
  const fromAccount = (live.json?.items || []).filter((r) => r.source === 'account');
  check('کدهای ورودِ سرورِ حساب در «کدهای زنده» می‌آیند',
    live.status === 200 && fromAccount.length === 1 && fromAccount[0].id === 'req1',
    `${live.status} ${JSON.stringify(live.json?.items || [])}`);
  /*
   *  ⚠️ **و خودِ کد هم می‌آید — از ۱.۵۰.۳.**
   *
   *  تا دیروز این بند وارونه بود («خودِ کد در فهرست نمی‌آید») و دلیلش
   *  خوب بود: هر نمایش در دفترِ سرورِ حساب ثبت می‌شود، پس فهرستی که
   *  هر دو‌ونیم ثانیه خودش را تازه می‌کند آن دفتر را بی‌معنا می‌کرد.
   *
   *  ⛔ **آن بند پاک نشد، از درِ تازه گرفته شد**: کد دیده می‌شود، و
   *  بندِ بعدی همان چیزی را نگه می‌دارد که این بند نگه می‌داشت —
   *  «چند بار تازه شدن، چند ردیفِ نمایش؟».
   */
  check('کدِ سرورِ حساب در همان فهرست دیده می‌شود',
    fromAccount[0]?.code === '999111', JSON.stringify(fromAccount));

  /*
   *  ⛔ و دفترِ **دومِ** سرورِ حساب — کدِ ثبت‌نام.
   *
   *  گزارشِ صاحب سامانه با عکس: «کد نمیاد توی بخش کد ها هیچ کدی نمیاد…
   *  اصلاً دیده نمی‌شود برای کدام حساب و کدام برنامه و ایمیل است.»
   *  همان درس، بارِ سوم: سرورِ حساب خودش دو دفترِ کد دارد.
   */
  const fromOtp = (live.json?.items || []).filter((r) => r.source === 'account-otp');
  check('کدِ ثبت‌نامِ سرورِ حساب هم در «کدهای زنده» می‌آید',
    fromOtp.length === 1 && fromOtp[0].id === 'otp_reg1',
    JSON.stringify(live.json?.items || []));
  check('و می‌گوید برای کدام ایمیل، کدام برنامه و چه کاری',
    fromOtp[0]?.email === 'haroon@x.com' && fromOtp[0]?.app === 'pump'
      && fromOtp[0]?.appName === 'پمپ‌بنزین' && fromOtp[0]?.purpose === 'ثبت‌نام',
    JSON.stringify(fromOtp[0] || {}));
  //  ⛔ «رفت» با «در لاگ چاپ شد» یکی نیست
  check('⛔ راهِ `log` سرخ می‌ماند، نه سبزِ «رفت»',
    fromOtp[0]?.logOnly === true, JSON.stringify(fromOtp[0] || {}));
  check('و کدِ ثبت‌نام هم در همان فهرست دیده می‌شود',
    fromOtp[0]?.code === '622186' && fromOtp[0]?.canReveal === true,
    JSON.stringify(fromOtp[0] || {}));

  /*
   *  ⛔ **و همان چیزی که بندِ قدیمی نگه می‌داشت: یک کد، یک ردیفِ نمایش.**
   *
   *  این بندْ جانِ اصلاحِ ۱.۵۰.۳ است. صفحهٔ کدها خودش را هر دو‌ونیم ثانیه
   *  تازه می‌کند؛ اگر هر تازه شدن یک `reveal` می‌زد، دفترِ ممیزیِ سرورِ
   *  حساب پر از «کد دیده شد» می‌شد و بی‌معنا. پس فهرست سه بارِ دیگر
   *  خوانده می‌شود و شمارِ درخواست‌های **بالادست** باید **صفر** بالا
   *  برود — کد از آینهٔ حافظه می‌آید، نه از یک پرسشِ تازه.
   *
   *  ⚠️ و ملاک شمارِ درخواست‌هاست، نه `last()`: وقتی چیزی فرستاده نشود
   *  `last()` همان درخواستِ موفقِ قبلی را نشان می‌دهد و سبزِ دروغ می‌دهد.
   */
  const revealsBefore = seen.filter((r) => r.path.endsWith('/reveal')).length;
  for (let i = 0; i < 3; i++) await api('GET', '/api/codes-admin/live', undefined, auth);
  const revealsAfter = seen.filter((r) => r.path.endsWith('/reveal')).length;
  const stillShown = await api('GET', '/api/codes-admin/live', undefined, auth);
  check('⛔ هر کد فقط یک بار پرسیده می‌شود — تازه شدنِ صفحه دفترِ ممیزی را پر نمی‌کند',
    revealsAfter === revealsBefore, `${revealsBefore} ⇒ ${revealsAfter}`);
  check('⚠️ و با این حال کد هنوز روی صفحه است (از آینه، نه از پرسشِ تازه)',
    (stillShown.json?.items || []).some((r) => r.source === 'account' && r.code === '999111'),
    JSON.stringify(stillShown.json?.items || []).slice(0, 200));

  /*
   *  ⛔ بندِ ۲.۶ سند — «ارسالِ خودکار نشد، خودم می‌فرستم».
   */
  const otpAgain = await api('POST', '/api/account-admin/otp/otp_reg1/resend', {}, auth);
  check('فرستادنِ دوبارهٔ کد از درِ خودش می‌رود',
    otpAgain.status === 200 && last()?.path === '/api/admin/otp/otp_reg1/resend',
    `${otpAgain.status} ${last()?.path}`);

  //  ⛔ و «نرفت» سبز نمی‌شود — پیامِ خودِ سرورِ حساب باید برسد
  otpSendBroken = true;
  const broke = await api('POST', '/api/account-admin/otp/otp_reg1/resend', {}, auth);
  /*
   *  ⚠️ قراردادِ خطای این پنل **صاف** است، نه تودرتو: `{ error, message }`.
   *  همان چیزی که `web/src/api.ts` می‌خواند (`json.error` کد است و
   *  `json.message` متن). پس هم کد به صفحه می‌رسد هم دلیلش — و سنجه هم
   *  همین شکل را می‌خواهد، نه شکلِ سرورِ حساب.
   */
  check('⛔ رباتِ تنظیم‌نشده ⇒ خطا، نه «فرستادم»',
    broke.status === 409
      && String(broke.json?.error || '') === 'delivery_not_configured'
      && String(broke.json?.message || '').length > 0,
    `${broke.status} ${JSON.stringify(broke.json)}`);
  otpSendBroken = false;

  const otpReveal = await api('POST', '/api/account-admin/otp/otp_reg1/reveal', {}, auth);
  check('نمایشِ کدِ ثبت‌نام از درِ خودش می‌رود',
    otpReveal.status === 200 && otpReveal.json?.code === '622186'
      && last()?.path === '/api/admin/otp/otp_reg1/reveal',
    `${otpReveal.status} ${last()?.path}`);

  /*
   *  ⛔ بندِ ۶.۱ سند — کدِ بازیابیِ رمز.
   */
  const reset = await api('POST', '/api/account-admin/otp/password-reset', { email: 'k@x.com', app: 'pump' }, auth);
  check('کدِ بازیابیِ رمز از میزِ کدها می‌رود',
    reset.status === 200 && last()?.path === '/api/admin/otp/password-reset'
      && last()?.body?.email === 'k@x.com',
    `${reset.status} ${last()?.path}`);
  //  ⚠️ و «حساب نیست» به مدیر گفته می‌شود، نه ۲۰۰ِ خالی
  const noOne = await api('POST', '/api/account-admin/otp/password-reset', { email: 'nobody@x.com' }, auth);
  check('⚠️ و «حساب نیست» گفته می‌شود، نه ۲۰۰ِ خالی',
    noOne.status === 404 && String(noOne.json?.error || '') === 'user_not_found',
    `${noOne.status} ${JSON.stringify(noOne.json)}`);
  /*
   *  ⛔ و هیچ راهی برای عوض کردنِ خودِ رمز از این پل نیست — مدیری که
   *  بتواند رمزِ کسی را بگذارد می‌تواند جای او وارد شود.
   */
  const beforeTry = seen.length;
  const setPw = await api('POST', '/api/account-admin/otp/password-set', { email: 'k@x.com', password: 'x' }, auth);
  check('⛔ و رمز از این پل گذاشته نمی‌شود',
    setPw.status === 404 && seen.length === beforeTry,
    `${setPw.status} ${seen.length - beforeTry}`);

  /*
   *  ⛔ **افتادنِ یک دفتر دیگری را نمی‌برد.**
   *  سرورِ حسابِ کهنه `/api/admin/otp` را ندارد و ۴۰۴ می‌دهد؛ آن یعنی
   *  «این دفتر را ندارم»، نه «خرابم» — فهرست نباید دوباره خالی شود.
   */
  otpOff = true;
  const liveOld = await api('GET', '/api/codes-admin/live', undefined, auth);
  check('سرورِ حسابِ کهنه (۴۰۴ روی دفترِ دوم) فهرست را خالی نمی‌کند',
    liveOld.status === 200
      && (liveOld.json?.items || []).some((r) => r.source === 'account')
      && !(liveOld.json?.accountError),
    `${liveOld.status} ${JSON.stringify(liveOld.json?.accountError || '')}`);
  otpOff = false;

  console.log('\n── در بسته است ──');
  const beforeSneak = seen.length;
  const sneak = await api('GET', '/api/account-admin/admins', undefined, auth);
  const sneak2 = await api('GET', '/api/account-admin/backups', undefined, auth);
  const sneak3 = await api('POST', '/api/account-admin/shops', {}, auth);
  const sneak4 = await api('GET', '/api/account-admin/sync/deleted', undefined, auth);
  const sneak5 = await api('GET', '/api/account-admin/notices/ntc1/anything', undefined, auth);
  check('مسیرِ بیرون از فهرستِ سفید ۴۰۴ است و به سرورِ حساب نمی‌رسد',
    sneak.status === 404 && sneak2.status === 404 && sneak3.status === 404 && sneak4.status === 404
      && sneak5.status === 404 && seen.length === beforeSneak,
    `${sneak.status} ${sneak2.status} ${sneak3.status} ${sneak4.status} ${sneak5.status} ${seen.slice(beforeSneak).map((s) => s.path).join(' ')}`);
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
    //  ⛔ نمایشِ کد هم فقط admin — operator با همان نشستِ سالم رد می‌شود
    const oReveal = await api('POST', '/api/account-admin/logins/req1/reveal', {}, oAuth);
    check('⛔ نمایشِ کد فقط برای admin است', oReveal.status === 403, String(oReveal.status));
    /*
     *  ⛔ و آینهٔ میزِ کدها همان مرز را دارد: فهرست برای operator باز است
     *  (شمارِ کدها راز نیست) ولی **خودِ کد** نه. بی این بند، اصلاحِ
     *  ۱.۵۰.۳ می‌توانست کد را به نقشی بدهد که دکمه‌اش ۴۰۳ می‌گیرد.
     */
    const oLive = await api('GET', '/api/codes-admin/live', undefined, oAuth);
    check('⛔ و operator فهرست را می‌بیند ولی کدِ سرورِ حساب را نه',
      oLive.status === 200
        && (oLive.json?.items || []).some((r) => r.source === 'account')
        && (oLive.json?.items || []).every((r) => r.source === 'panel' || !r.code),
      `${oLive.status} ${JSON.stringify(oLive.json?.items || []).slice(0, 200)}`);
  } else {
    check('ساختنِ کاربرِ آزمون', false, `${mk.status} ${JSON.stringify(mk.json)} / ${mk2.status}`);
  }

  /* ===================================================================
     دسترسی‌هایی که با دفترِ قدیمی افتادند — و نباید دوباره بیفتند

     ⛔ این‌ها در ۱.۴۱.۰ از پنل رفتند چون پل یک **فهرستِ سفید** است و
        خطشان نوشته نشد. سرورِ حساب همان مسیرها را داشت، ولی صاحبِ
        سامانه از پنل دیگر کدِ اشتراک نمی‌توانست بسازد و درخواست‌های
        خریدِ مشتری‌ها را اصلاً نمی‌دید. گزارشِ خودش: «اون دسترسی‌های
        قدیم رو ندارم روش».
     =================================================================== */
  console.log('\n── دسترسی‌های برگشته ──');

  const vipList = await api('GET', '/api/account-admin/vip-codes?app=shop', undefined, auth);
  check('کدهای اشتراکِ دکان از پنل دیده می‌شوند',
    vipList.status === 200 && vipList.json?.codes?.[0]?.hint === 'A1••••', `${vipList.status} ${JSON.stringify(vipList.json)}`);

  //  ⚠️ اگر پل `app` را نبرد، این به دفترِ **دکان** می‌رود و کدِ پمپ گم می‌شود
  const vipPump = await api('GET', '/api/account-admin/vip-codes?app=pump', undefined, auth);
  check('⛔ کدِ پمپ از دفترِ خودش می‌آید، نه از دفترِ دکان',
    vipPump.status === 200 && vipPump.json?.codes?.[0]?.id === 'pv1', `${vipPump.status} ${JSON.stringify(vipPump.json)}`);

  const vipMake = await api('POST', '/api/account-admin/vip-codes', { app: 'shop', plan: 'm1' }, auth);
  check('کدِ اشتراکِ تازه ساخته می‌شود و کدِ خام یک بار برمی‌گردد',
    (vipMake.status === 200 || vipMake.status === 201) && vipMake.json?.code === 'A1B2C3', `${vipMake.status} ${JSON.stringify(vipMake.json)}`);

  const vipMakePump = await api('POST', '/api/account-admin/vip-codes', { app: 'pump', plan: 'std' }, auth);
  check('کدِ پمپ هم از همان در ساخته می‌شود',
    (vipMakePump.status === 200 || vipMakePump.status === 201) && vipMakePump.json?.code === 'PUMP01', `${vipMakePump.status} ${JSON.stringify(vipMakePump.json)}`);

  const vipRevoke = await api('POST', '/api/account-admin/vip-codes/v1/revoke', { app: 'shop' }, auth);
  check('کدِ اشتراک باطل می‌شود', vipRevoke.status === 200, String(vipRevoke.status));

  const prs = await api('GET', '/api/account-admin/purchase-requests?status=pending', undefined, auth);
  check('درخواست‌های خرید دیده می‌شوند',
    prs.status === 200 && prs.json?.requests?.[0]?.shop_name === 'دکانِ یک', `${prs.status} ${JSON.stringify(prs.json)}`);

  const prOk = await api('POST', '/api/account-admin/purchase-requests/pr1/approve', { days: null }, auth);
  const prNo = await api('POST', '/api/account-admin/purchase-requests/pr1/reject', {}, auth);
  check('تایید و ردِ درخواستِ خرید کار می‌کند', prOk.status === 200 && prNo.status === 200, `${prOk.status} ${prNo.status}`);

  const vis = await api('GET', '/api/account-admin/visitors?guests=1', undefined, auth);
  check('بازدیدکننده‌ها برگشتند', vis.status === 200 && vis.json?.visitors?.[0]?.id === 'vi1', String(vis.status));

  const appsList = await api('GET', '/api/account-admin/apps', undefined, auth);
  check('برنامه‌های زیرِ مدیریت دیده می‌شوند',
    appsList.status === 200 && appsList.json?.apps?.[0]?.slug === 'shop', String(appsList.status));

  const health = await api('POST', '/api/account-admin/apps/health', {}, auth);
  check('سنجشِ سلامتِ برنامه‌ها از پنل زده می‌شود', health.status === 200, String(health.status));

  const mailPut = await api('PUT', '/api/account-admin/email', { provider: 'smtp', host: 'smtp.x.com' }, auth);
  check('تنظیماتِ ایمیلِ سرورِ حساب از پنل نوشته می‌شود', mailPut.status === 200, String(mailPut.status));

  const mailTest = await api('POST', '/api/account-admin/email/test', { to: 'k@x.com' }, auth);
  check('ارسالِ آزمایشیِ ایمیل از پنل زده می‌شود', mailTest.status === 200, String(mailTest.status));

  const pushGet = await api('GET', '/api/account-admin/push', undefined, auth);
  const smsGet = await api('GET', '/api/account-admin/sms', undefined, auth);
  check('حالِ پوش و پیامک خوانده می‌شود', pushGet.status === 200 && smsGet.status === 200, `${pushGet.status} ${smsGet.status}`);

  const accAudit = await api('GET', '/api/account-admin/account-audit', undefined, auth);
  check('دفترِ ممیزیِ خودِ سرورِ حساب دیده می‌شود',
    accAudit.status === 200 && accAudit.json?.entries?.[0]?.action === 'admin.vip_code_created', String(accAudit.status));

  // ══ میزِ فروشگاه — بندهای ۴.۲ تا ۴.۴ ════════════════════════════════
  console.log('\n── میزِ فروشگاه ──');

  const ov = await api('GET', '/api/account-admin/shop-desk/overview?days=7', undefined, auth);
  check('۴.۲ داشبوردِ فروشگاه از سرورِ حساب می‌آید',
    ov.status === 200 && ov.json?.counts?.shops === 2 && ov.json?.counts?.online === 1,
    `${ov.status} ${JSON.stringify(ov.json).slice(0, 160)}`);
  //  ⚠️ ایمیل و روزِ مانده — همان چیزی که صریح خواسته شد
  check('۴.۲ «رو به پایان» ایمیل و روزِ مانده دارد',
    ov.json?.expiring?.[0]?.ownerEmail === 'haroon@x.com' && ov.json?.expiring?.[0]?.daysLeft === 2);
  //  ⛔ تعریفِ «آنلاین» از سرور می‌آید، نه از عددی که پنل خودش بداند
  check('⛔ تعریفِ «آنلاین» از خودِ سرور می‌آید', Number(ov.json?.onlineWithinMs) > 0);
  //  ⚠️ `days` واقعاً به بالادست می‌رود، نه فیلترِ محلی
  check('⚠️ و `days` به سرورِ حساب می‌رسد', last()?.query?.days === '7', JSON.stringify(last()?.query));

  const gp = await api('GET', '/api/account-admin/shop-desk/groups?q=haroon', undefined, auth);
  check('۴.۳ سه گروهِ اشتراک از سرورِ حساب می‌آید',
    gp.status === 200 && Array.isArray(gp.json?.groups?.has)
    && Array.isArray(gp.json?.groups?.none) && Array.isArray(gp.json?.groups?.expired),
    `${gp.status} ${JSON.stringify(gp.json).slice(0, 160)}`);
  check('⚠️ و جست‌وجو دستِ سرورِ حساب است، نه فیلترِ محلی',
    last()?.query?.q === 'haroon', JSON.stringify(last()?.query));

  const sc = await api('GET', '/api/account-admin/shop-accounts/shp-1/staff-codes', undefined, auth);
  check('۴.۴ شمارِ شاگردها و فهرستِ پوشیدهٔ کدها می‌آید',
    sc.status === 200 && sc.json?.students?.total === 2 && sc.json?.codes?.[0]?.hint === 'PL51',
    `${sc.status} ${JSON.stringify(sc.json).slice(0, 160)}`);
  //  ⛔ خودِ کد در فهرست نیست — همان قاعدهٔ میزِ کدها
  check('⛔ و هیچ کدِ خامی در فهرست نیست',
    !/SHG-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/.test(JSON.stringify(sc.json)));

  const rv = await api('POST', '/api/account-admin/shop-accounts/shp-1/staff-codes/reveal', {}, auth);
  check('۴.۴ نمایشِ کدِ ثابت، با یک کلیکِ جدا',
    rv.status === 200 && rv.json?.code === 'SHG-8F29-KD72-PL51', `${rv.status} ${rv.text?.slice(0, 160)}`);
  //  ⛔ و دو بار ثبت می‌شود: دفترِ پنل، و دفترِ خودِ سرورِ حساب
  const revealLog = await api('GET', '/api/control/audit?limit=80', undefined, auth);
  check('⛔ و در دفترِ کارهای حساسِ پنل می‌نشیند',
    JSON.stringify(revealLog.json || {}).includes('account.staff_code.revealed'),
    String(revealLog.status));

  //  ⛔ `operator` نمی‌تواند کد را ببیند — همان مرزِ «نمایشِ کد»
  //  ⚠️ نشستِ خودش ساخته می‌شود: `oAuth`ی بالا داخلِ یک `if` است و
  //  تکیه کردن به متغیرِ بلوکِ دیگری یعنی روزی این بند بی‌صدا نمی‌دود.
  await api('POST', '/api/auth/users', { username: 'op-shop', password: 'Operator-1405-shop', role: 'operator' }, auth);
  const opLogin = await api('POST', '/api/auth/login', { username: 'op-shop', password: 'Operator-1405-shop' });
  const opAuth = { Authorization: `Bearer ${opLogin.json?.token}` };
  check('نشستِ operator برای این بند ساخته شد', Boolean(opLogin.json?.token), String(opLogin.status));
  const opRv = await api('POST', '/api/account-admin/shop-accounts/shp-1/staff-codes/reveal', {}, opAuth);
  check('⛔ operator کدِ شاگرد را نمی‌بیند (۴۰۳)', opRv.status === 403, String(opRv.status));
  //  ⚠️ ولی خودِ فهرست برایش باز است — شمارِ شاگردها راز نیست
  const opList = await api('GET', '/api/account-admin/shop-accounts/shp-1/staff-codes', undefined, opAuth);
  check('⚠️ ولی فهرست برایش باز است', opList.status === 200, String(opList.status));

  //  ⛔ فهرستِ سفید است، نه پروکسی: هر چیزِ دیگری زیرِ این پیشوند ۴۰۴
  const before = seen.length;
  const bogus = await api('GET', '/api/account-admin/shop-desk/anything', undefined, auth);
  check('⛔ مسیرِ نانوشته ۴۰۴ می‌گیرد و به سرورِ حساب هم نمی‌رسد',
    bogus.status === 404 && seen.length === before, `${bogus.status} ${seen.length - before}`);

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
