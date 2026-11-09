// ---------------------------------------------------------------------------
//  🏪 بخشِ «فروشگاه» — ماژول‌های ۴.۶ (مدیریتِ بازار، فقط سمتِ مدیریت) و ۴.۷ (نظارت بر پیک)
//  درهای پنل زیرِ ‎/api/account-admin/console/{market,delivery}/…‎، روی **همان** روترِ پل (`account-admin.js`) تا
//  فهرستِ سفید، «انجام‌دهنده» و ‎test/bridge-roles.mjs‎ یکی بمانند.
//
//    پنل ‎/console/…‎                              ⇐ سرورِ حساب                               نقشِ پنل   نقشِ آن‌جا
//    market/overview|sellers|orders|commission|history ⇐ ‎/api/admin/market/*‎ (`market-admin.v1`)   viewer     مدیر/فقط‌خواندن
//    market/orders.csv                            ⇐ همان ‎orders‎، صفحه‌به‌صفحه (سقفِ ۵۰۰۰)      admin      —
//    market/trust/cases · cases/:id · sanctions    ⇐ ‎/api/admin/trust/*‎ (از پیش)                  admin      ارشد
//    market/trust/cases/:id/assign (POST)         ⇐ همان                                           admin      ارشد
//    market/trust/cases/:id/decide · appeal-decision · sanctions/:id/lift (POST)
//                                                 ⇐ همان، با دلیل + تأیید + احرازِ دوباره            admin      ارشد + دلیل
//    delivery/overview|queue|events|connectivity|report|thresholds ⇐ ‎/api/admin/delivery/*‎ (`delivery-watch.v1`) viewer مدیر
//    delivery/queue.csv                           ⇐ همان ‎queue‎ (سقفِ ۵۰۰۰)                        admin      —
//    delivery/thresholds (PUT)                    ⇐ همان، با دلیل + تأیید + احرازِ دوباره            admin      ارشد + دلیل
//
//  ⛔ **تعلیقِ فروشنده درِ تازه ندارد**: همان ‎console/shops/:id/holds‎ (سرویسِ `market.directory` یا `shop.storefront`)
//     — «یک موضوع، یک در»؛ رابطِ این ماژول همان در را صدا می‌زند.
//  ⛔ **هیچ عددی این‌جا ساخته نمی‌شود**؛ پاسخِ بالادست همان‌طور می‌رود + `fetchedAt`. نبودِ توانایی ⇒ خواندن:
//     ‎{available:false, reason:'capability_missing'}‎، نوشتن: ‎501 capability_missing‎ — نه «انجام شد» ِ دروغ.
//  ⛔ نه دادهٔ شخصیِ مشتری (سرورِ حساب نمی‌فرستد) و نه رمز در دفتر، پاسخ یا لاگ.
//  ⛔ کارِ حساس (تصمیمِ پرونده، جریمه، آستانه‌ها) = admin + `confirm: true` + دلیلِ ۳ تا ۲۰۰ + **احرازِ دوباره**
//     (رمزِ پنل همراهِ همان درخواست، یا `requireRecentAuth` ِ فاز ۱ اگر در پایه هست)؛ ۵ رمزِ غلط در ربع ساعت ⇒ ۴۲۹.
//     تکرار بی‌اثر است: پرونده ماشینِ وضعیت دارد (تصمیمِ دوم ⇒ ‎409 already_decided‎ ِ همان سرور)، آستانه مقدارِ
//     مطلق است (همان مقدار ⇒ `unchanged`)، و برداشتنِ جریمهٔ برداشته ⇒ ۴۰۹ ِ همان‌جا.
// ---------------------------------------------------------------------------
import { cloudRaw } from '../stations/cloud.js';
import * as panelRoles from '../control/roles.js';
import * as panelAuth from '../auth.js';
import { audit } from '../control/audit.js';
import { db } from '../db.js';
import { rateLimit } from '../platform/rate-limit.js';
import { requireModule } from '../console/modules.js';

const { requireRole } = panelRoles;
const actorOf = (req) => req.user?.username || 'admin';

export const MARKET_CAPABILITIES = Object.freeze({
  'market-admin.v1': 'GET /api/admin/market/overview|sellers|orders|commission|history (shop: claude/console-market-api)',
  'delivery-watch.v1': 'GET /api/admin/delivery/overview|queue|events|connectivity|report|thresholds · PUT …/thresholds',
});
const CAP_RE = /^[a-z][a-z0-9-]{0,40}\.v\d{1,3}$/;

function fail(code, status, message) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function guard(handler) {
  return async (req, res) => {
    try { await handler(req, res); } catch (err) {
      res.status(err.status || 502).json({ error: err.code || 'cloud_error', message: err.message || 'سرورِ حساب جواب نداد' });
    }
  };
}

const stamped = (out) => ({ ...(out && typeof out === 'object' ? out : {}), fetchedAt: Date.now() });

async function hasCap(cap) {
  const me = await cloudRaw('GET', '/api/admin/me');
  const list = Array.isArray(me?.capabilities) ? me.capabilities.map(String).filter((c) => CAP_RE.test(c)) : [];
  return list.includes(cap);
}
function unavailable(cap) {
  return {
    available: false, reason: 'capability_missing', capability: cap, needs: MARKET_CAPABILITIES[cap] || cap,
    message: 'داده در دسترس نیست — سرورِ حساب هنوز این API را ندارد (۴.۶/۴.۷ ِ پنلِ مرکزی، ریپوی shop)',
    fetchedAt: Date.now(),
  };
}

/* ───────────── ورودی: فقط پارامترهای شناخته، با مرز — پیش از رسیدن به سرورِ حساب ───────────── */

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
function idOf(v, field = 'شناسه') {
  const s = String(v ?? '');
  if (!ID_RE.test(s)) throw fail('bad_id', 400, `${field} معتبر نیست`);
  return s;
}
const optId = (v) => (v === undefined || v === '' ? '' : idOf(v, 'شناسهٔ دکان'));
function intOf(v, min, max, field) {
  if (v === undefined || v === '') return '';
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw fail('bad_query', 400, `${field} در بازهٔ مجاز نیست`);
  return String(n);
}
function oneOf(v, list, field) {
  if (v === undefined || v === '') return '';
  if (!list.includes(String(v))) throw fail('bad_query', 400, `${field} درست نیست`);
  return String(v);
}
const textOf = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const clean = (q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== '' && v !== undefined));

const windowQuery = (q) => ({
  days: intOf(q.days, 1, 400, 'روز'), from: intOf(q.from, 0, Number.MAX_SAFE_INTEGER, 'از'),
  to: intOf(q.to, 0, Number.MAX_SAFE_INTEGER, 'تا'),
});
const pageQuery = (q, maxLimit) => ({ limit: intOf(q.limit, 1, maxLimit, 'تعداد'), offset: intOf(q.offset, 0, 100_000, 'از') });

const MARKET_STATES = ['listed', 'unlisted', 'held', 'sanctioned', 'inactive'];
const ORDER_GROUPS = ['awaiting', 'in_progress', 'completed', 'cancelled', 'returns'];
const QUEUE_VIEWS = ['all', 'preparing', 'dispatch', 'assigned', 'in_delivery', 'failed', 'stuck', 'mismatch', 'discrepancy'];
const EVENT_KINDS = ['created', 'status', 'recall', 'code', 'photo'];
const CASE_STATUSES = ['pending', 'all', 'open', 'in_review', 'decided', 'appealed', 'closed'];
const OUTCOMES = ['upheld', 'dismissed'];
const APPEAL_OUTCOMES = ['upheld', 'reversed'];
const SANCTIONS = ['warning', 'hide_listing', 'suspend_storefront'];
const SEVERITIES = ['low', 'medium', 'high'];
const THRESHOLD_KEYS = ['acceptMin', 'dispatchMin', 'courierAcceptMin', 'pickupMin', 'inDeliveryMin', 'failedMin', 'recallMin'];

/* ───────────── کارِ حساس: دلیل، تأیید، احرازِ دوباره ───────────── */

function reasonOf(req) {
  const reason = String(req.body?.reason ?? '').trim();
  if (reason.length < 3 || reason.length > 200) {
    throw fail('reason_required', 400, 'دلیل را بنویسید (۳ تا ۲۰۰ نویسه) — در سابقهٔ سرورِ حساب و دفترِ پنل می‌ماند');
  }
  return reason;
}
function requireConfirm(req) {
  if (req.body?.confirm !== true) throw fail('confirm_required', 400, 'این کار پیش از فرستادن تأیید می‌خواهد');
}

const reauthLimit = rateLimit({
  name: 'console-market-reauth', max: 5, windowMs: 15 * 60_000,
  key: (req) => `u${req.user?.id ?? 'x'}`,
  skipSuccess: true, countIf: (_req, res) => res.locals?.reauthFailed === true,
});

/** رمزِ پنلِ خودِ همین کاربر همراهِ درخواست — یا اگر فاز ۱ در پایه است، نشستِ تازه (`requireRecentAuth`). */
function reauth(req, res, next) {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (password) {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(Number(req.user?.id));
    if (!row || !panelAuth.verifyPassword(password, row.password_hash)) {
      res.locals.reauthFailed = true;
      audit({ actor: actorOf(req), action: 'account.market.reauth_failed', entity: 'console', result: 'forbidden', detail: { path: req.path } });
      return res.status(403).json({ error: 'reauth_failed', message: 'رمزِ پنل درست نیست' });
    }
    if (typeof panelAuth.markFresh === 'function' && req.user?.sessionId) panelAuth.markFresh(req.user.sessionId);
    return next();
  }
  if (typeof panelAuth.requireRecentAuth === 'function') return panelAuth.requireRecentAuth(req, res, next);
  return res.status(403).json({ error: 'reauth_required', message: 'برای این کار رمزِ پنلِ خودتان را دوباره بزنید' });
}

/* ───────────── CSV — فقط admin، با یک ردیفِ دفتر ───────────── */

const CSV_CAP = 5000;
const CSV_PAGE = 200;
/** ⛔ تزریقِ فرمول در Excel: خانه‌ای که با = + - @ یا tab/CR آغاز شود، با ' آغاز می‌شود. */
export function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csvLine = (cells) => cells.map(csvCell).join(',');

async function pageAll(path, query, listKey) {
  const rows = [];
  let total = null;
  for (let offset = 0; offset < CSV_CAP; offset += CSV_PAGE) {
    const out = await cloudRaw('GET', path, { query: { ...query, limit: String(CSV_PAGE), offset: String(offset) } });
    const list = Array.isArray(out?.[listKey]) ? out[listKey] : [];
    total = Number.isFinite(Number(out?.total)) ? Number(out.total) : total;
    rows.push(...list);
    if (list.length < CSV_PAGE) break;
  }
  return { rows: rows.slice(0, CSV_CAP), total, truncated: total !== null ? total > Math.min(rows.length, CSV_CAP) : rows.length >= CSV_CAP };
}

function sendCsv(res, name, head, lines, meta) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Rows', String(lines.length));
  if (meta.truncated) res.setHeader('X-Truncated', 'true');
  //  BOM تا Excel فارسی را درست بخواند
  res.send(`\uFEFF${csvLine(head)}\n${lines.map(csvLine).join('\n')}${lines.length ? '\n' : ''}`);
}

const issuesText = (i) => (i ? [...(i.stuck || []), ...(i.mismatch || []), ...(i.discrepancy || [])].join(' ') : '');

/* ───────────────────────────── درها ───────────────────────────── */

export function mountConsoleMarket(router) {
  const MARKET = 'market-admin.v1';
  const DELIVERY = 'delivery-watch.v1';
  //  خواندن: همان `minRole` ِ ردیفِ ماژول در ‎console/modules.js‎ (منو و سرور یکی)
  const read = (cap, localPath, remotePath, queryOf) => {
    router.get(localPath, requireModule(cap === MARKET ? 'market' : 'courier'), guard(async (req, res) => {
      const query = clean(queryOf(req.query || {}));
      if (!(await hasCap(cap))) return res.json(unavailable(cap));
      res.json({ available: true, ...stamped(await cloudRaw('GET', remotePath, { query })) });
    }));
  };

  /* ── ۴.۶ بازار ── */
  read(MARKET, '/console/market/overview', '/api/admin/market/overview', (q) => windowQuery(q));
  read(MARKET, '/console/market/sellers', '/api/admin/market/sellers', (q) => ({
    q: textOf(q.q, 60), state: oneOf(q.state, MARKET_STATES, 'پالایش'), ...pageQuery(q, 50),
  }));
  const orderQuery = (q) => ({
    ...windowQuery(q), shopId: optId(q.shopId), group: oneOf(q.group, ORDER_GROUPS, 'گروه'),
    problem: q.problem === '1' || q.problem === 'true' ? '1' : '',
  });
  read(MARKET, '/console/market/orders', '/api/admin/market/orders', (q) => ({ ...orderQuery(q), ...pageQuery(q, 200) }));
  read(MARKET, '/console/market/commission', '/api/admin/market/commission', (q) => windowQuery(q));
  read(MARKET, '/console/market/history', '/api/admin/market/history', (q) => ({
    limit: intOf(q.limit, 1, 200, 'تعداد'), before: intOf(q.before, 0, Number.MAX_SAFE_INTEGER, 'پیش از'), shopId: optId(q.shopId),
  }));

  router.get('/console/market/orders.csv', requireRole('admin'), guard(async (req, res) => {
    const query = clean(orderQuery(req.query || {}));
    if (!(await hasCap(MARKET))) throw fail('capability_missing', 501, 'این کار روی نسخهٔ فعلیِ سرورِ حساب نیست (market-admin.v1)');
    const { rows, total, truncated } = await pageAll('/api/admin/market/orders', query, 'orders');
    audit({ actor: actorOf(req), action: 'account.market.orders_exported', entity: 'market', detail: { query, rows: rows.length, total, truncated } });
    sendCsv(res, 'market-orders.csv',
      ['orderId', 'shopId', 'shopName', 'orderNo', 'status', 'fulfillment', 'paymentMethod', 'paymentStatus', 'cod',
        'currency', 'totalMinor', 'createdAt', 'missionStatus', 'issues', 'complaintsOpen'],
      rows.map((o) => [o.id, o.shopId, o.shopName, o.orderNo, o.status, o.fulfillment, o.payment?.method, o.payment?.status,
        o.payment?.cod, o.currency, o.totalMinor, o.createdAt ? new Date(o.createdAt).toISOString() : '', o.mission?.status,
        issuesText(o.issues), o.complaintsOpen]),
      { truncated });
  }));

  //  پرونده‌های اعتماد (کالای گزارش‌شده، شکایت) — درهای از پیشِ سرورِ حساب، فقط ارشد ⇒ این‌جا فقط admin
  router.get('/console/market/trust/cases', requireRole('admin'), guard(async (req, res) => {
    const q = req.query || {};
    const query = clean({ status: oneOf(q.status, CASE_STATUSES, 'وضعیت'), shopId: optId(q.shopId), limit: intOf(q.limit, 1, 200, 'تعداد') });
    res.json(stamped(await cloudRaw('GET', '/api/admin/trust/cases', { query })));
  }));
  router.get('/console/market/trust/cases/:id', requireRole('admin'), guard(async (req, res) => {
    res.json(stamped(await cloudRaw('GET', `/api/admin/trust/cases/${idOf(req.params.id, 'شناسهٔ پرونده')}`)));
  }));
  router.get('/console/market/trust/sanctions', requireRole('admin'), guard(async (req, res) => {
    const q = req.query || {};
    const query = clean({ shopId: optId(q.shopId), active: q.active === '1' || q.active === 'true' ? '1' : '', limit: intOf(q.limit, 1, 500, 'تعداد') });
    res.json(stamped(await cloudRaw('GET', '/api/admin/trust/sanctions', { query })));
  }));
  router.post('/console/market/trust/cases/:id/assign', requireRole('admin'), guard(async (req, res) => {
    const id = idOf(req.params.id, 'شناسهٔ پرونده');
    requireConfirm(req);
    const out = await cloudRaw('POST', `/api/admin/trust/cases/${id}/assign`, { body: {} });
    audit({ actor: actorOf(req), action: 'account.market.case_assigned', entity: 'trust_case', entityId: id, detail: { status: out?.status || null } });
    res.json(stamped(out));
  }));
  router.post('/console/market/trust/cases/:id/decide', requireRole('admin'), reauthLimit, reauth, guard(async (req, res) => {
    const id = idOf(req.params.id, 'شناسهٔ پرونده');
    const reason = reasonOf(req);
    requireConfirm(req);
    const b = req.body || {};
    const outcome = oneOf(b.outcome, OUTCOMES, 'نتیجه');
    if (!outcome) throw fail('bad_outcome', 400, 'نتیجه: «وارد است» یا «رد»');
    const severity = oneOf(b.severity, SEVERITIES, 'شدت');
    let sanction = null;
    if (b.sanction && typeof b.sanction === 'object') {
      const kind = oneOf(b.sanction.kind, SANCTIONS, 'نوعِ جریمه');
      if (!kind) throw fail('bad_sanction', 400, 'نوعِ جریمه فقط هشدار، پنهان کردنِ کالا یا تعلیقِ ویترین');
      if (outcome !== 'upheld') throw fail('bad_sanction', 400, 'جریمه فقط با تصمیمِ «وارد است»');
      const productId = b.sanction.productId ? String(b.sanction.productId).slice(0, 80) : '';
      if (productId && !/^[A-Za-z0-9_.:-]{1,80}$/.test(productId)) throw fail('bad_product', 400, 'شناسهٔ کالا معتبر نیست');
      sanction = { kind, ...(productId ? { productId } : {}) };
    }
    //  ⚠️ بدنهٔ بالادست فقط همین فیلدها — رمز و تأییدِ رابط به سرورِ حساب نمی‌روند
    const out = await cloudRaw('POST', `/api/admin/trust/cases/${id}/decide`, {
      body: { outcome, ...(severity ? { severity } : {}), ...(sanction ? { sanction } : {}), reason },
    });
    audit({
      actor: actorOf(req), action: 'account.market.case_decided', entity: 'trust_case', entityId: id,
      detail: { outcome, severity: severity || null, sanction, reason, sanctionId: out?.sanction?.id || null },
    });
    res.json(stamped(out));
  }));
  router.post('/console/market/trust/cases/:id/appeal-decision', requireRole('admin'), reauthLimit, reauth, guard(async (req, res) => {
    const id = idOf(req.params.id, 'شناسهٔ پرونده');
    const reason = reasonOf(req);
    requireConfirm(req);
    const outcome = oneOf(req.body?.outcome, APPEAL_OUTCOMES, 'نتیجهٔ اعتراض');
    if (!outcome) throw fail('bad_outcome', 400, 'نتیجهٔ اعتراض: «تصمیم می‌ماند» یا «برگشت»');
    const out = await cloudRaw('POST', `/api/admin/trust/cases/${id}/appeal-decision`, { body: { outcome, reason } });
    audit({ actor: actorOf(req), action: 'account.market.appeal_decided', entity: 'trust_case', entityId: id, detail: { outcome, reason, lifted: out?.lifted ?? null } });
    res.json(stamped(out));
  }));
  router.post('/console/market/trust/sanctions/:id/lift', requireRole('admin'), reauthLimit, reauth, guard(async (req, res) => {
    const id = idOf(req.params.id, 'شناسهٔ جریمه');
    const reason = reasonOf(req);
    requireConfirm(req);
    const out = await cloudRaw('POST', `/api/admin/trust/sanctions/${id}/lift`, { body: { reason } });
    audit({ actor: actorOf(req), action: 'account.market.sanction_lifted', entity: 'trust_sanction', entityId: id, detail: { reason, kind: out?.kind || null, shopId: out?.shopId || null } });
    res.json(stamped(out));
  }));

  /* ── ۴.۷ پیک ── */
  read(DELIVERY, '/console/delivery/overview', '/api/admin/delivery/overview', (q) => ({ days: intOf(q.days, 1, 30, 'روز') }));
  const queueQuery = (q) => ({
    view: oneOf(q.view, QUEUE_VIEWS, 'نما'), shopId: optId(q.shopId), days: intOf(q.days, 1, 30, 'روز'),
  });
  read(DELIVERY, '/console/delivery/queue', '/api/admin/delivery/queue', (q) => ({ ...queueQuery(q), ...pageQuery(q, 200) }));
  read(DELIVERY, '/console/delivery/events', '/api/admin/delivery/events', (q) => ({
    shopId: optId(q.shopId), kind: oneOf(q.kind, EVENT_KINDS, 'نوع'), before: intOf(q.before, 0, Number.MAX_SAFE_INTEGER, 'پیش از'),
    limit: intOf(q.limit, 1, 200, 'تعداد'),
  }));
  read(DELIVERY, '/console/delivery/connectivity', '/api/admin/delivery/connectivity', () => ({}));
  read(DELIVERY, '/console/delivery/report', '/api/admin/delivery/report', (q) => windowQuery(q));
  read(DELIVERY, '/console/delivery/thresholds', '/api/admin/delivery/thresholds', () => ({}));

  router.get('/console/delivery/queue.csv', requireRole('admin'), guard(async (req, res) => {
    const query = clean(queueQuery(req.query || {}));
    if (!(await hasCap(DELIVERY))) throw fail('capability_missing', 501, 'این کار روی نسخهٔ فعلیِ سرورِ حساب نیست (delivery-watch.v1)');
    const { rows, total, truncated } = await pageAll('/api/admin/delivery/queue', query, 'rows');
    audit({ actor: actorOf(req), action: 'account.delivery.queue_exported', entity: 'delivery', detail: { query, rows: rows.length, total, truncated } });
    sendCsv(res, 'delivery-queue.csv',
      ['orderId', 'shopId', 'shopName', 'orderNo', 'status', 'stage', 'missionStatus', 'mode', 'courier', 'ageMinutes', 'issues'],
      rows.map((r) => [r.orderId, r.shopId, r.shopName, r.orderNo, r.status, r.stage, r.mission?.status, r.mission?.mode,
        r.mission?.courierName, r.ageMs === null || r.ageMs === undefined ? '' : Math.floor(r.ageMs / 60000), issuesText(r.issues)]),
      { truncated });
  }));

  router.put('/console/delivery/thresholds', requireRole('admin'), reauthLimit, reauth, guard(async (req, res) => {
    const reason = reasonOf(req);
    requireConfirm(req);
    const raw = req.body?.thresholds;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw fail('bad_thresholds', 400, 'آستانه‌ها نیامدند');
    const thresholds = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!THRESHOLD_KEYS.includes(k)) throw fail('bad_thresholds', 400, `کلیدِ ناشناخته: ${k}`);
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 10_080) throw fail('bad_thresholds', 400, `${k}: عددِ صحیحِ ۱ تا ۱۰٬۰۸۰ دقیقه`);
      thresholds[k] = v;
    }
    if (!Object.keys(thresholds).length) throw fail('bad_thresholds', 400, 'هیچ آستانه‌ای نیامد');
    if (!(await hasCap(DELIVERY))) throw fail('capability_missing', 501, 'این کار روی نسخهٔ فعلیِ سرورِ حساب نیست (delivery-watch.v1)');
    const out = await cloudRaw('PUT', '/api/admin/delivery/thresholds', { body: { thresholds, reason } });
    audit({ actor: actorOf(req), action: 'account.delivery.thresholds_set', entity: 'delivery', detail: { thresholds, reason, unchanged: out?.unchanged === true } });
    res.json(stamped(out));
  }));
}
