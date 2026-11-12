// ---------------------------------------------------------------------------
//  🏪 بخشِ «فروشگاه» — ماژول‌های ۴.۶ (مدیریتِ بازار، فقط سمتِ مدیریت) و ۴.۷ (نظارت بر پیک)
//  درهای پنل زیرِ ‎/api/account-admin/console/{market,delivery}/…‎، روی **همان** روترِ پل (`account-admin.js`) تا
//  فهرستِ سفید، «انجام‌دهنده» و ‎test/bridge-roles.mjs‎ یکی بمانند.
//
//    پنل ‎/console/…‎                              ⇐ سرورِ حساب                               نقشِ پنل   نقشِ آن‌جا
//    market/overview|sellers|orders|commission|history ⇐ ‎/api/admin/market/*‎ (`market-admin.v1`)   viewer     مدیر/فقط‌خواندن
//    market/orders.csv                            ⇐ همان ‎orders‎، صفحه‌به‌صفحه (سقفِ ۵۰۰۰)      admin      —
//    market/trust/cases · cases/:id · sanctions    ⇐ ‎/api/admin/trust/*‎ (از پیش، ABUSE-01)        admin      ارشد
//                                                   (+ ‎trust-read.v1‎: operator/viewer با نمای کم‌تر)  viewer     هر خواننده
//    market/trust/cases/:id/evidence/:eid         ⇐ ‎…/cases/:id/evidence/:evidenceId‎ (بایتِ عکس، ۱.۵۰.۹۸)  admin      ارشد
//    market/trust/cases/:id/assign (POST)         ⇐ همان، تأیید + کلید                              admin      ارشد
//    market/trust/cases/:id/decide · appeal-decision · sanctions/:id/lift (POST)
//                                                 ⇐ همان، با دلیل + تأیید + کلید + احرازِ دوباره     admin      ارشد + دلیل
//    market/regions                               ⇐ ‎/api/admin/market/regions‎ (`market-regions.v1`، S109)  viewer     مدیر
//    market/census/:id (PUT)                      ⇐ ‎/api/admin/shops/:id/census‎ (همان)، دلیل + تأیید    admin      مدیر + دلیل
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
//  ⛔ ۱.۵۰.۹۷ (ABUSE-01): نوشتن‌های پرونده/جریمه کلیدِ پنجره هم می‌خواهند (همان کلید ⇒ همان پاسخ با ‎replayed‎ و بی درخواست و
//     ردیفِ دوم؛ همان پرونده هم‌زمان ⇒ ‎409 action_in_progress‎) و سقفِ ‎TRUST_WRITES_MAX‎ در ده دقیقه برای هر کاربر.
//  ⛔ ۱.۵۰.۹۸: سرورِ حسابِ `idempotent-writes.v1` کلید را روی همین چهار نوشتن خودش نگه می‌دارد ⇒ کلیدِ پنجره (بسته به کاربرِ
//     پنل) در ‎Idempotency-Key‎ (`makeUpstreamOnce`)؛ سرورِ کهنه ⇒ همان یادِ پل. مدرکِ پیوست (بایتِ عکس) فقط admin، سنجیده و ‎no-store‎.
// ---------------------------------------------------------------------------
import { cloudRaw, cloudRawBytes } from '../stations/cloud.js';
import { bridgeFail } from '../account/bridge-fail.js';
import * as panelRoles from '../control/roles.js';
import * as panelAuth from '../auth.js';
import { audit } from '../control/audit.js';
import { rateLimit } from '../platform/rate-limit.js';
import { requireModule } from '../console/modules.js';
import { checkIdemKey, makeIdemOnce, makeUpstreamOnce, serverPathFor } from '../account/idem-once.js';
import { db } from '../db.js';

const { requireRole } = panelRoles;
const actorOf = (req) => req.user?.username || 'admin';

export const MARKET_CAPABILITIES = Object.freeze({
  'market-admin.v1': 'GET /api/admin/market/overview|sellers|orders|commission|history (shop: claude/console-market-api)',
  'delivery-watch.v1': 'GET /api/admin/delivery/overview|queue|events|connectivity|report|thresholds · PUT …/thresholds',
  'market-regions.v1': 'GET /api/admin/market/regions · PUT /api/admin/shops/:id/census (shop S109)',
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
    try { await handler(req, res); } catch (err) { bridgeFail(res, err); }
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
const CENSUS_KINDS = ['test', 'duplicate', 'none'];
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
  //  ⛔ قاعده یکی است و در `auth.js` (`bodyStepUp`): رمز، و اگر دوعاملی روشن است کد هم (۱.۵۰.۷۱)
  const r = panelAuth.bodyStepUp(req);
  if (r.pass) return next();
  if (r.failed) {
    res.locals.reauthFailed = true;
    audit({ actor: actorOf(req), action: 'account.market.reauth_failed', entity: 'console', result: 'forbidden', detail: { path: req.path, step: r.error } });
    return res.status(403).json({ error: 'reauth_failed', message: 'رمزِ پنل یا کدِ دوعاملی درست نیست' });
  }
  return res.status(403).json({ error: 'reauth_required', totpRequired: r.totpRequired || undefined, message: 'برای این کار رمزِ پنلِ خودتان را دوباره بزنید' });
}

/* ───────────── ABUSE-01: «مسئول» به نامِ کاربرِ پنل ───────────── */

/** سقفِ نوشتنِ پرونده‌ها/جریمه‌ها برای هر کاربرِ پنل در ده دقیقه (ردِ ۴۰۰ هم شمرده می‌شود) */
export const TRUST_WRITES_MAX = 30;

/**
 * «مسئول» ِ سرورِ حساب از راهِ پل همان شناسهٔ کلیدِ سرویس (یا ارشدِ مشترکِ راهِ پیشین) است — برای همهٔ کاربرانِ پنل یکی.
 * پس نامِ کاربرِ پنل از ردیفِ دفترِ **همین پنل** (آخرین ‎account.market.case_assigned‎ ِ همان پرونده) کنارش می‌نشیند:
 * `panelAssignee: {by, at}` — **فقط** وقتی مسئولِ امروزِ سرورِ حساب همان مقداری است که سرور آن روز برگرداند؛ مسئولِ دیگری
 * (کنسولِ خودِ سرورِ حساب، یا ردیفِ کهنهٔ بی مقدار) ⇒ هیچ، نه نامِ کهنه. ⛔ فیلدهای بالادست دست نمی‌خورند.
 */
export function withPanelAssignee(cases) {
  const list = Array.isArray(cases) ? cases : [];
  const ids = [...new Set(list.map((c) => (typeof c?.id === 'string' && ID_RE.test(c.id) ? c.id : '')).filter(Boolean))].slice(0, 500);
  if (!ids.length) return list;
  let rows = [];
  try {
    rows = db.prepare(`SELECT actor, entity_id, detail, at FROM cc_audit
                        WHERE action = 'account.market.case_assigned' AND entity = 'trust_case' AND entity_id IN (${ids.map(() => '?').join(',')})
                        ORDER BY at DESC, id DESC`).all(...ids);
  } catch { return list; }
  const last = new Map();
  for (const r of rows) {
    if (last.has(r.entity_id)) continue;
    let d = null;
    try { d = JSON.parse(r.detail || 'null'); } catch { d = null; }
    last.set(r.entity_id, { by: String(r.actor), at: Number(r.at), assignee: typeof d?.assignee === 'string' ? d.assignee : '' });
  }
  return list.map((c) => {
    const m = typeof c?.id === 'string' ? last.get(c.id) : null;
    return m && m.assignee && m.assignee === c.assignee ? { ...c, panelAssignee: { by: m.by, at: m.at } } : c;
  });
}

/**
 * `trust-read.v1` (shop ‎claude/e-rows-25s‎): سرورِ حساب صف، پرونده و جریمه‌ها را به نقشِ زیرِ ارشد هم می‌دهد — با نمای کم‌تر.
 * پنل همان را **خودش هم** برای نقشِ زیرِ admin ِ پنل می‌بُرد: راهِ پیشینِ پل (رمزِ ارشدِ مشترک، بی «انجام‌دهنده») نمای کامل
 * می‌گیرد و نباید به بیننده برسد. همان فهرستِ ‎lib/trust-admin-view.js‎ ِ shop.
 */
export const TRUST_READ = 'trust-read.v1';
const omit = (o, keys) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k))) : o);
export const trustSanctionLess = (s) => omit(s, ['createdBy', 'liftedBy']);
export function trustCaseLess(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return c;
  const out = omit(c, ['reporterHint', 'reporterStats', 'sameText', 'evidence']);
  if (c.decision) out.decision = omit(c.decision, ['by']);
  if (c.appeal) out.appeal = omit(c.appeal, ['by', 'decidedBy']);
  if (Array.isArray(c.sanctions)) out.sanctions = c.sanctions.map(trustSanctionLess);
  if (Array.isArray(c.history)) out.history = c.history.map((e) => ({ ...omit(e, ['actorId']), ...(e?.data ? { data: omit(e.data, ['assignee']) } : {}) }));
  return out;
}

/* ───────────── ABUSE-01: مدرکِ پیوستِ پرونده (بایتِ عکس) — ۱.۵۰.۹۸ ───────────── */

/**
 * سقفِ پاسخِ مدرک در پل. سرورِ حساب هنگامِ بارگذاری فقط عکس و تا ‎TRUST_IMAGE_MAX_KB‎ (پیش‌فرض ۱٫۵ مگابایت) می‌پذیرد؛
 * پل تا چهار مگابایت را می‌خواند و بیش از آن را پیش از نگه داشتن می‌بُرد (‎cloudRawBytes({ maxBytes })‎) — نه ۳۲ ِ پل.
 */
export const EVIDENCE_MAX_BYTES = 4 * 1024 * 1024;
export const EVIDENCE_MIMES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** نوعِ عکس فقط از روی بایت‌های آغاز (همان سه نوعِ ‎chat-media.sniff‎ ِ shop) — وگرنه ''. */
export function evidenceMime(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return '';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(PNG_MAGIC)) return 'image/png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return '';
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

/**
 * @param {import('express').Router} router  همان روترِ ‎account-admin.js‎
 * @param {{ capListed?: (cap: string) => Promise<boolean> }} [deps]  «توانایی هست؟» ِ همان روتر (پرسشِ ناموفق ⇒ «نه»)
 */
export function mountConsoleMarket(router, { capListed } = {}) {
  const capOk = capListed || ((cap) => hasCap(cap).catch(() => false));
  const MARKET = 'market-admin.v1';
  const DELIVERY = 'delivery-watch.v1';
  const REGIONS = 'market-regions.v1';
  //  خواندن: همان `minRole` ِ ردیفِ ماژول در ‎console/modules.js‎ (منو و سرور یکی)
  const read = (cap, localPath, remotePath, queryOf) => {
    router.get(localPath, requireModule(cap === DELIVERY ? 'courier' : 'market'), guard(async (req, res) => {
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

  /*  S109 — شمارشِ منطقه‌ای (۳۴ ولایت و ولسوالی، سه وضعیتِ جدا، `onlineNow: null`) همان‌طور که سرورِ حساب می‌شمارد؛
   *  نشانِ «آزمایشی/تکراری» ِ دکان (بیرون از شمارش) فقط admin، با دلیل و تأیید — سابقه‌اش در سرورِ حساب (مهاجرتِ ۲۰۶).
   *  ⛔ کم‌خطر است (نه پول، نه دسترسی، فقط شمردن) ⇒ احرازِ دوباره نمی‌خواهد؛ همان مرزِ «حالت‌های دکان». */
  read(REGIONS, '/console/market/regions', '/api/admin/market/regions', () => ({}));
  router.put('/console/market/census/:id', requireModule('market'), requireRole('admin'), guard(async (req, res) => {
    const id = idOf(req.params.id, 'شناسهٔ دکان');
    const kind = oneOf(req.body?.kind, CENSUS_KINDS, 'نوعِ نشان');
    if (!kind) throw fail('bad_kind', 400, 'نوعِ نشان: آزمایشی، تکراری یا برداشتن');
    const duplicateOf = kind === 'duplicate' ? idOf(req.body?.duplicateOf, 'دکانِ اصل') : '';
    if (duplicateOf === id) throw fail('bad_duplicate_of', 400, 'دکانِ اصل نمی‌تواند همین دکان باشد');
    const reason = reasonOf(req);
    requireConfirm(req);
    if (!(await hasCap(REGIONS))) throw fail('capability_missing', 501, `این کار روی نسخهٔ فعلیِ سرورِ حساب نیست (${REGIONS})`);
    const out = await cloudRaw('PUT', `/api/admin/shops/${id}/census`, { body: { kind, ...(duplicateOf ? { duplicateOf } : {}), reason } });
    audit({ actor: actorOf(req), action: 'account.market.census_marked', entity: 'shop', entityId: id, detail: { kind, duplicateOf: duplicateOf || null, reason } });
    res.json({ ...stamped(out), confirmedByServer: true });
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

  /*  ABUSE-01 — پرونده‌های اعتماد (گزارشِ کالا، شکایت) و جریمه‌ها: درهای از پیشِ سرورِ حساب (‎routes/admin-trust.js‎)، **فقط
   *  ارشد** — حتی خواندن (متنِ شاکی، شمارهٔ پوشیده، سابقهٔ گزارش‌دهنده) ⇒ این‌جا فقط admin؛ viewer/operator ۴۰۳ پیش از پل.
   *  ۱.۵۰.۹۷: هر نوشتن (مسئول، تصمیم، رأیِ اعتراض، برداشتنِ جریمه) «یک پنجره = یک کار» با کلیدِ رابط (`makeIdemOnce` روی سرورِ
   *  کهنه؛ ۱.۵۰.۹۸: با `idempotent-writes.v1` همان کلید در ‎Idempotency-Key‎ به خودِ سرورِ حساب. پشتِ این، ماشینِ وضعیتِ سرورِ حساب
   *  است: تصمیمِ دوم ⇒ ‎409 already_decided‎) +
   *  سقفِ نرخِ هر کاربر + یک ردیفِ دفتر برای هر کارِ تأییدشده (بازپخش ⇒ بی ردیفِ دوم؛ کلید در دفتر نیست). */
  const once = makeIdemOnce();
  //  ۱.۵۰.۹۸: `idempotent-writes.v1` ⇒ «یک بار» را خودِ سرورِ حساب نگه می‌دارد (پس از راه‌اندازیِ دوبارهٔ پنل هم)؛ راهِ هر کلید
  //  عوض نمی‌شود (`serverPathFor`). قفلِ «همان پرونده هم‌زمان» ِ پل روی همین راه هم می‌ماند (`busy`).
  const viaServer = makeUpstreamOnce();
  const busy = new Set();
  /**
   * یک نوشتنِ پرونده/جریمه. `post(opts)` همان ‎cloudRaw('POST', '/api/admin/trust/…', opts)‎ ِ نوشته‌شدهٔ هر در است (تا
   * «فهرستِ سفید» ِ ‎bridge-contract.js‎ بشماردش)؛ `finish(r, { record, resolved })` پاسخ را می‌سازد و ردیفِ دفتر را فقط با ‎record‎.
   */
  const trustAct = async (req, key, fp, target, body, post, finish) => {
    if (await serverPathFor(req, key, { once, viaServer, capable: () => capOk('idempotent-writes.v1') })) {
      if (busy.has(target)) throw fail('action_in_progress', 409, 'همین کار روی همین مورد همین حالا در راه است');
      busy.add(target);
      try {
        return await viaServer(req, key, (headers) => post({ body, headers, replayFlag: true }), finish);
      } finally { busy.delete(target); }
    }
    return once(req, key, fp, target, async () => finish(await post({ body }), { record: true }));
  };
  const trustWriteLimit = rateLimit({ name: 'console-trust-write', max: TRUST_WRITES_MAX, windowMs: 10 * 60_000, key: (req) => `u${req.user?.id ?? 'x'}` });
  const caseIdOf = (v) => idOf(v, 'شناسهٔ پرونده');
  const noStore = (res) => res.setHeader('Cache-Control', 'no-store');
  const fullTrust = (req) => panelRoles.atLeast(panelRoles.roleOf(req), 'admin');
  /*  خواندن: admin ِ پنل مثلِ پیش؛ operator و viewer فقط وقتی سرورِ حساب `trust-read.v1` دارد (آن‌جا نقشِ خودشان نمای کم‌تر
   *  می‌گیرد) — وگرنه ۴۰۳ پیش از هر درِ پرونده (تنها پرسش همان ‎GET /api/admin/me‎ ِ توانایی است). */
  const trustRead = (req, res, next) => {
    if (fullTrust(req)) return next();
    capOk(TRUST_READ).then((ok) => {
      if (ok) return next();
      audit({ actor: actorOf(req), action: 'access.denied', entity: req.baseUrl + req.path, result: 'forbidden', detail: { capability: TRUST_READ } });
      return res.status(403).json({ error: 'forbidden', reason: 'capability_missing', capability: TRUST_READ,
        message: 'پرونده‌های شکایت برای این نقش فقط با سرورِ حسابِ تازه (trust-read.v1) دیده می‌شوند؛ تا آن روز فقط admin ِ پنل' });
    });
  };

  router.get('/console/market/trust/cases', requireModule('market'), trustRead, guard(async (req, res) => {
    const q = req.query || {};
    const query = clean({ status: oneOf(q.status, CASE_STATUSES, 'وضعیت'), shopId: optId(q.shopId), limit: intOf(q.limit, 1, 200, 'تعداد') });
    noStore(res);
    const out = await cloudRaw('GET', '/api/admin/trust/cases', { query });
    res.json(stamped({ ...(out && typeof out === 'object' ? out : {}), cases: withPanelAssignee(out?.cases) }));
  }));
  router.get('/console/market/trust/cases/:id', requireModule('market'), trustRead, guard(async (req, res) => {
    const id = caseIdOf(req.params.id);
    noStore(res);
    const out = await cloudRaw('GET', `/api/admin/trust/cases/${id}`);
    let c = out?.case && typeof out.case === 'object' && !Array.isArray(out.case) ? withPanelAssignee([out.case])[0] : out?.case;
    if (!fullTrust(req)) c = trustCaseLess(c);
    res.json(stamped({ ...(out && typeof out === 'object' ? out : {}), case: c }));
  }));
  router.get('/console/market/trust/sanctions', requireModule('market'), trustRead, guard(async (req, res) => {
    const q = req.query || {};
    const query = clean({ shopId: optId(q.shopId), active: q.active === '1' || q.active === 'true' ? '1' : '', limit: intOf(q.limit, 1, 500, 'تعداد') });
    noStore(res);
    const out = await cloudRaw('GET', '/api/admin/trust/sanctions', { query });
    const list = Array.isArray(out?.sanctions) ? out.sanctions : [];
    res.json(stamped({ ...(out && typeof out === 'object' ? out : {}), sanctions: fullTrust(req) ? list : list.map(trustSanctionLess) }));
  }));
  /*  ۱.۵۰.۹۸ — مدرکِ پیوست (عکسِ شاکی): همان قاعدهٔ «مدرک فقط ارشد» ِ shop (حتی با `trust-read.v1`) ⇒ فقط admin ِ پنل، ۴۰۳ ِ
   *  viewer/operator پیش از هر درخواست. پاسخ سنجیده می‌شود (نوع از روی بایت = نوعِ اعلام‌شده و یکی از سه عکس؛ اندازه تا
   *  ‎EVIDENCE_MAX_BYTES‎) و هر چیزِ دیگر هیچ بایتی به مرورگر نمی‌دهد؛ ‎no-store‎ + ‎nosniff‎ + CSP ِ بسته؛ هر دیدن یک ردیفِ دفتر. */
  const evidenceLimit = rateLimit({ name: 'console-trust-evidence', max: 120, windowMs: 10 * 60_000, key: (req) => `u${req.user?.id ?? 'x'}` });
  router.get('/console/market/trust/cases/:id/evidence/:eid', requireModule('market'), requireRole('admin'), evidenceLimit, guard(async (req, res) => {
    const id = caseIdOf(req.params.id);
    const eid = idOf(req.params.eid, 'شناسهٔ مدرک');
    noStore(res);
    const reject = (code, why, message) => {
      audit({ actor: actorOf(req), action: 'account.market.evidence_rejected', entity: 'trust_case', entityId: id, result: 'rejected', detail: { evidence: eid, why } });
      return fail(code, 502, message);
    };
    let got;
    try {
      got = await cloudRawBytes('GET', `/api/admin/trust/cases/${id}/evidence/${eid}`, { timeout: 'normal', maxBytes: EVIDENCE_MAX_BYTES });
    } catch (err) {
      if (err?.unreadable === 'too_large') throw reject('evidence_too_large', 'too_large', `مدرک از سقفِ ${EVIDENCE_MAX_BYTES / (1024 * 1024)} مگابایتِ پل بزرگ‌تر بود و نشان داده نشد`);
      throw err;
    }
    const buf = got?.buffer;
    const declared = String(got?.contentType || '').split(';')[0].trim().toLowerCase();
    const mime = evidenceMime(buf);
    if (!Buffer.isBuffer(buf) || buf.length > EVIDENCE_MAX_BYTES) throw reject('evidence_too_large', 'too_large', 'مدرک از سقفِ پل بزرگ‌تر بود و نشان داده نشد');
    if (!mime || !EVIDENCE_MIMES.includes(declared) || declared !== mime) {
      throw reject('evidence_not_image', declared ? `type:${declared.slice(0, 40)}` : 'type:none',
        'پاسخِ سرورِ حساب عکسِ شناخته (JPG، PNG، WebP) نبود — نشان داده نشد');
    }
    audit({ actor: actorOf(req), action: 'account.market.evidence_viewed', entity: 'trust_case', entityId: id, detail: { evidence: eid, mime, bytes: buf.length } });
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Disposition', 'inline');
    res.end(buf);
  }));
  router.post('/console/market/trust/cases/:id/assign', requireRole('admin'), trustWriteLimit, guard(async (req, res) => {
    const id = caseIdOf(req.params.id);
    requireConfirm(req);
    const key = checkIdemKey(req.body?.idempotencyKey);
    res.json(await trustAct(req, key, `assign|${id}`, `trust:${id}`, {}, (o) => cloudRaw('POST', `/api/admin/trust/cases/${id}/assign`, o),
      (out, { record, resolved }) => {
        if (record) {
          audit({ actor: actorOf(req), action: 'account.market.case_assigned', entity: 'trust_case', entityId: id,
            detail: { status: out?.status || null, assignee: typeof out?.assignee === 'string' ? out.assignee.slice(0, 80) : null, ...(resolved ? { resolved: true } : {}) } });
        }
        return stamped(out);
      }));
  }));
  router.post('/console/market/trust/cases/:id/decide', requireRole('admin'), trustWriteLimit, reauthLimit, reauth, guard(async (req, res) => {
    const id = caseIdOf(req.params.id);
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
    const key = checkIdemKey(b.idempotencyKey);
    //  ⚠️ بدنهٔ بالادست فقط همین فیلدها — رمز، تأیید و کلیدِ رابط به سرورِ حساب نمی‌روند
    const body = { outcome, ...(severity ? { severity } : {}), ...(sanction ? { sanction } : {}), reason };
    res.json(await trustAct(req, key, `decide|${id}|${JSON.stringify(body)}`, `trust:${id}`, body, (o) => cloudRaw('POST', `/api/admin/trust/cases/${id}/decide`, o),
      (out, { record, resolved }) => {
        if (record) {
          audit({
            actor: actorOf(req), action: 'account.market.case_decided', entity: 'trust_case', entityId: id,
            detail: { outcome, severity: severity || null, sanction, reason, sanctionId: out?.sanction?.id || null, ...(resolved ? { resolved: true } : {}) },
          });
        }
        return stamped(out);
      }));
  }));
  router.post('/console/market/trust/cases/:id/appeal-decision', requireRole('admin'), trustWriteLimit, reauthLimit, reauth, guard(async (req, res) => {
    const id = caseIdOf(req.params.id);
    const reason = reasonOf(req);
    requireConfirm(req);
    const outcome = oneOf(req.body?.outcome, APPEAL_OUTCOMES, 'نتیجهٔ اعتراض');
    if (!outcome) throw fail('bad_outcome', 400, 'نتیجهٔ اعتراض: «تصمیم می‌ماند» یا «برگشت»');
    const key = checkIdemKey(req.body?.idempotencyKey);
    res.json(await trustAct(req, key, `appeal|${id}|${outcome}|${reason}`, `trust:${id}`, { outcome, reason },
      (o) => cloudRaw('POST', `/api/admin/trust/cases/${id}/appeal-decision`, o),
      (out, { record, resolved }) => {
        if (record) {
          audit({ actor: actorOf(req), action: 'account.market.appeal_decided', entity: 'trust_case', entityId: id,
            detail: { outcome, reason, lifted: out?.lifted ?? null, ...(resolved ? { resolved: true } : {}) } });
        }
        return stamped(out);
      }));
  }));
  router.post('/console/market/trust/sanctions/:id/lift', requireRole('admin'), trustWriteLimit, reauthLimit, reauth, guard(async (req, res) => {
    const id = idOf(req.params.id, 'شناسهٔ جریمه');
    const reason = reasonOf(req);
    requireConfirm(req);
    const key = checkIdemKey(req.body?.idempotencyKey);
    res.json(await trustAct(req, key, `lift|${id}|${reason}`, `trust-sanction:${id}`, { reason }, (o) => cloudRaw('POST', `/api/admin/trust/sanctions/${id}/lift`, o),
      (out, { record, resolved }) => {
        if (record) {
          audit({ actor: actorOf(req), action: 'account.market.sanction_lifted', entity: 'trust_sanction', entityId: id,
            detail: { reason, kind: out?.kind || null, shopId: out?.shopId || null, ...(resolved ? { resolved: true } : {}) } });
        }
        return stamped(out);
      }));
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
