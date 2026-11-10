// ---------------------------------------------------------------------------
//  👥 کارکنان، مجوزها و دستگاه‌های **یک** دکان — در پروندهٔ دکان (۱.۵۰.۷۵، ممیزی §۳-۴ «مجوزِ کارکنان»)
//
//  تا امروز فقط در کنسولِ وبِ سرورِ حساب (‎/admin/‎). پل فقط درهای موجودِ shop را می‌زند
//  (‎routes/admin-staff-perms.js‎ ِ shop، STF-01..03 و STF-10)؛ هیچ داده‌ای این‌جا ساخته نمی‌شود.
//
//    GET  /console/shops/:id/staff[?offset=&limit=]        ⇐ GET  /api/admin/shops/:id/staff-perms?limit=&offset=
//    POST /console/shops/:id/staff/devices/:did/disable    ⇐ POST /api/admin/shops/:id/staff-perms/devices/:did/disable
//    POST /console/shops/:id/staff/devices/:did/enable     ⇐ POST /api/admin/shops/:id/staff-perms/devices/:did/enable  (`staff-perms.v1`)
//
//  ⛔ خواندن: همان `minRole` ِ «فروشگاه‌های عضو» (پرونده) — سرورِ حساب هر نگاه را در سابقهٔ دکان می‌نویسد (TEN-04).
//  ⛔ پاسخ فقط فیلدهای شناخته (نه هر چه بالادست فرستاد): نام و نقشِ عضو، لایه و مجوزِ مؤثر، و از دستگاه فقط نام،
//     سکو، وضعیت و زمان‌ها — نه توکن، نه نشانیِ پوش، نه ایمیل/تلفن.
//  ⛔ ازکارانداختنِ دستگاه: admin ِ پنل (آن‌جا ارشد) + دلیلِ ۳ تا ۲۰۰ + تأیید + کلیدِ یکتاییِ رابط (‎account/idem-once.js‎،
//     چون بالادست کلید ندارد) + سقفِ نرخِ هر کاربر + ردیفِ دفترِ پنل. «این دستگاه مالِ اعضای همین دکان است» را
//     **سرورِ حساب** می‌سنجد (‎deviceOfShop‎ ⇒ ‎404 device_not_found‎) — پل شناسهٔ دکان را از مسیر می‌دهد، نه از بدنه.
//  ⛔ برگرداندنِ دستگاه (۱.۵۰.۷۷، shop #1025): فقط وقتی سرورِ حساب `staff-perms.v1` را اعلام کرده — همان مرزها (admin +
//     دلیل + تأیید + کلید + سقفِ نرخ + ردیفِ دفتر)، و «مالِ همین دکان است / دکانِ دیگری انداخته» را باز **سرورِ حساب** می‌سنجد
//     (‎404 device_not_found‎ · ‎409 disabled_by_other_shop‎ · ‎400 device_not_disabled‎). سرورِ کهنه ⇒ ‎501 capability_missing‎ و
//     رابط همان «پشتیبانی نمی‌شود» ِ پیشین.
//  ⛔ کلیدِ یکتایی: سرورِ حسابِ با `idempotent-writes.v1` کلید را خودش نگه می‌دارد ⇒ کلیدِ پنجره بسته به کاربرِ پنل بالا
//     می‌رود (`makeUpstreamOnce`)؛ بی آن همان یادِ حافظهٔ پل (`makeIdemOnce`).
//  ⛔ صفحه‌بندی: پل همیشه ‎limit/offset‎ می‌فرستد؛ سرورِ تازه ‎page‎ می‌دهد (هر دو فهرست با همان دو عدد) و کارت ورق می‌خورد؛
//     سرورِ کهنه همان پاسخِ کامل را می‌دهد و پل ۵۰۰ تا را نشان می‌دهد با `truncated`، نه بریدنِ بی‌صدا.
// ---------------------------------------------------------------------------
import * as panelRoles from '../control/roles.js';
import { audit } from '../control/audit.js';
import { cloudRaw } from '../stations/cloud.js';
import { rateLimit } from '../platform/rate-limit.js';
import { requireModule } from '../console/modules.js';
import { checkIdemKey, makeIdemOnce, makeUpstreamOnce } from '../account/idem-once.js';

const { requireRole } = panelRoles;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const KEY_RE = /^[a-z][a-z0-9_.]{0,60}$/;
const MODES = ['allow', 'approve', 'deny'];

const str = (v, max = 120) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '');
const numOr = (v) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

function capsOf(c) {
  const out = {};
  if (!c || typeof c !== 'object' || Array.isArray(c)) return out;
  for (const [k, v] of Object.entries(c).slice(0, 10)) if (/^[A-Za-z]{1,30}$/.test(k) && Number.isFinite(Number(v))) out[k] = Number(v);
  return out;
}
/** ‎{ "sales.discount": { mode, caps } }‎ — فقط کلید و حالتِ شناخته */
function permMap(o) {
  const out = {};
  if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
  for (const [k, v] of Object.entries(o).slice(0, 200)) {
    if (!KEY_RE.test(k) || !v || typeof v !== 'object') continue;
    out[k] = { ...(MODES.includes(v.mode) ? { mode: v.mode } : {}), ...(v.caps ? { caps: capsOf(v.caps) } : {}) };
  }
  return out;
}
const role = (r) => (/^[a-z_]{1,20}$/.test(String(r || '')) ? String(r) : '');

export function shapeStaff(out) {
  const p = out?.perms && typeof out.perms === 'object' ? out.perms : {};
  const roles = {};
  if (p.roles && typeof p.roles === 'object') for (const [r, layer] of Object.entries(p.roles).slice(0, 20)) if (role(r)) roles[r] = permMap(layer);
  return {
    shop: { id: str(out?.shop?.id, 80), name: str(out?.shop?.name, 200) },
    version: numOr(p.v),
    catalog: (Array.isArray(p.catalog) ? p.catalog : []).slice(0, 200).filter((c) => KEY_RE.test(String(c?.key || ''))).map((c) => ({
      key: String(c.key), edit: ['none', 'restrict', 'full'].includes(c.edit) ? c.edit : 'none', approvable: c.approvable === true,
      display: c.display === true, caps: (Array.isArray(c.caps) ? c.caps : []).filter((x) => /^[A-Za-z]{1,30}$/.test(String(x))).slice(0, 10),
      defaults: Object.fromEntries(Object.entries(c.defaults && typeof c.defaults === 'object' ? c.defaults : {}).filter(([r, m]) => role(r) && MODES.includes(m)).slice(0, 20)),
    })),
    roles,
    members: (Array.isArray(p.members) ? p.members : []).slice(0, 500).map((m) => ({
      id: str(m?.id, 80), userId: str(m?.userId, 80), name: str(m?.name, 200), role: role(m?.role), status: str(m?.status, 20),
      layer: permMap(m?.layer), effective: permMap(m?.effective),
      ...(m?.customRole && typeof m.customRole === 'object' ? { customRole: { id: str(m.customRole.id, 80), name: str(m.customRole.name, 120) } } : {}),
    })),
    devices: (Array.isArray(out?.devices) ? out.devices : []).slice(0, 500).map((d) => ({
      id: str(d?.id, 80), name: str(d?.name, 120), platform: str(d?.platform, 40), status: str(d?.status, 20),
      createdAt: numOr(d?.createdAt), lastSeenAt: numOr(d?.lastSeenAt), disabledAt: numOr(d?.disabledAt),
      blockedAttempts: numOr(d?.blockedAttempts), lastBlockedAt: numOr(d?.lastBlockedAt),
      member: { userId: str(d?.member?.userId, 80), role: role(d?.member?.role), name: str(d?.member?.name, 200) },
    })),
  };
}

/** ‎page‎ ِ سرورِ حسابِ تازه — فقط عدد؛ نبود ⇒ null (سرورِ کهنه) */
function pageOf(pg) {
  if (!pg || typeof pg !== 'object' || Array.isArray(pg)) return null;
  //  ⛔ ‎null‎ (صفحهٔ آخر) همان null می‌ماند — ‎Number(null)‎ صفر است و «بعدی» را به صفحهٔ نخست می‌برد
  const n = (v) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);
  const limit = n(pg.limit), offset = n(pg.offset);
  if (limit === null || offset === null) return null;
  return { limit, offset, membersTotal: n(pg.membersTotal), devicesTotal: n(pg.devicesTotal), nextOffset: n(pg.nextOffset) };
}

/**
 * @param {import('express').Router} router  همان روترِ ‎account-admin.js‎ (همان «انجام‌دهنده»، فهرستِ سفید و ‎bridge-roles.mjs‎)
 * @param {{ guard: Function, badInput: Function, actorOf: Function, capListed: (cap: string) => Promise<boolean>, missingErr: Function }} d
 */
export function mountConsoleStaff(router, { guard, badInput, actorOf, capListed, missingErr }) {
  const idOf = (v, code = 'bad_id') => {
    const s = String(v ?? '');
    if (!ID_RE.test(s)) throw badInput(code, 'شناسه معتبر نیست');
    return s;
  };
  //  ‎?offset=&limit=‎ ِ رابط: فقط رقمِ ساده و در بازهٔ همان سرورِ حساب (۱ تا ۲۰۰، ۰ تا یک میلیون) — بیرون ⇒ ‎400 bad_page‎
  const intOf = (v, def, min, max) => {
    if (v === undefined || v === '') return def;
    const n = typeof v === 'string' && /^\d{1,7}$/.test(v) ? Number(v) : NaN;
    if (!(n >= min && n <= max)) throw badInput('bad_page', `صفحه درست نیست (${min} تا ${max})`);
    return n;
  };
  const once = makeIdemOnce();
  const viaServer = makeUpstreamOnce();
  //  ⛔ سقفِ هر کاربر روی کارِ حساس (سطلِ عمومیِ IP ِ ‎/api‎ پیش از ورود هم هست)
  const writeLimit = rateLimit({ name: 'console-staff-write', max: 30, windowMs: 10 * 60_000, key: (req) => `u${req.user?.id ?? 'x'}` });

  router.get('/console/shops/:id/staff', requireModule('shops'), guard(async (req, res) => {
    const id = idOf(req.params.id);
    const limit = intOf(req.query.limit, 50, 1, 200);
    const offset = intOf(req.query.offset, 0, 0, 1_000_000);
    const [out, canEnable] = await Promise.all([
      cloudRaw('GET', `/api/admin/shops/${id}/staff-perms`, { query: { limit: String(limit), offset: String(offset) } }),
      capListed('staff-perms.v1'),
    ]);
    const page = pageOf(out?.page);
    const listed = (x) => (Array.isArray(x) ? x.length : 0);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      available: true, fetchedAt: Date.now(), ...shapeStaff(out), page,
      //  سرورِ کهنه (بی صفحه): پل بیش از ۵۰۰ تا را نشان نمی‌دهد — گفته می‌شود، نه بریدنِ بی‌صدا
      truncated: !page && (listed(out?.perms?.members) > 500 || listed(out?.devices) > 500),
      canEnable,
      //  ⛔ صادقانه: کاری که سرورِ حساب برای مدیر ندارد (سرورِ پیش از `staff-perms.v1`)
      notSupported: canEnable ? [] : ['POST /api/admin/shops/:id/staff-perms/devices/:did/enable'],
    });
  }));

  /** ورودیِ مشترکِ دو کارِ دستگاه — همه پیش از هر پرسش از سرورِ حساب */
  const deviceInput = (req) => {
    const id = idOf(req.params.id);
    const did = idOf(req.params.did, 'bad_device_id');
    if (req.body?.confirm !== true) throw badInput('confirm_required', 'این کار پیش از فرستادن تأیید می‌خواهد');
    const reason = str(req.body?.reason, 400).trim();
    if (reason.length < 3 || reason.length > 200) throw badInput('reason_required', 'دلیل را بنویسید (۳ تا ۲۰۰ نویسه) — در دفترِ پنل و سرورِ حساب می‌ماند');
    const key = checkIdemKey(req.body?.idempotencyKey);
    return { id, did, reason, key };
  };

  /**
   * یک کارِ دستگاه: با `idempotent-writes.v1` کلید به سرورِ حساب، وگرنه یادِ پل (هدفِ قفل برای هر دو کار یکی است).
   * `post(opts)` همان ‎cloudRaw('POST', '/api/admin/…')‎ ِ نوشته‌شدهٔ هر در است (تا «فهرستِ سفید» ِ ‎bridge-contract.js‎ بشماردش).
   */
  const deviceAct = async (req, act, { id, did, reason, key }, post, shape) => {
    const finish = (r, { record, resolved }) => {
      const result = shape(r);
      if (record) {
        audit({ actor: actorOf(req), action: `account.shop_device.${act}d`, entity: 'shop', entityId: id,
          detail: { device: did, reason, ...(result.sessionsRevoked !== undefined ? { sessionsRevoked: result.sessionsRevoked } : {}), ...(resolved ? { resolved: true } : {}) } });
      }
      return result;
    };
    if (await capListed('idempotent-writes.v1')) {
      return viaServer(req, key, (headers) => post({ body: { reason }, headers, replayFlag: true }), finish);
    }
    return once(req, key, `${act}|${id}|${did}|${reason}`, `device:${id}:${did}`, async () => finish(await post({ body: { reason } }), { record: true }));
  };

  router.post('/console/shops/:id/staff/devices/:did/disable', requireRole('admin'), writeLimit, guard(async (req, res) => {
    const input = deviceInput(req);
    const { id, did } = input;
    res.json(await deviceAct(req, 'disable', input, (o) => cloudRaw('POST', `/api/admin/shops/${id}/staff-perms/devices/${did}/disable`, o), (r) => ({
      ok: true, deviceId: str(r?.id, 80) || input.did, disabledAt: numOr(r?.disabledAt), sessionsRevoked: numOr(r?.sessionsRevoked), confirmedAt: Date.now(),
    })));
  }));

  router.post('/console/shops/:id/staff/devices/:did/enable', requireRole('admin'), writeLimit, guard(async (req, res) => {
    const input = deviceInput(req);
    //  ⛔ سرورِ کهنه این در را ندارد ⇒ ۵۰۱، نه «انجام شد» و نه پرسشِ بی‌نتیجه
    if (!(await capListed('staff-perms.v1'))) throw missingErr('staff-perms.v1');
    const { id, did } = input;
    res.json(await deviceAct(req, 'enable', input, (o) => cloudRaw('POST', `/api/admin/shops/${id}/staff-perms/devices/${did}/enable`, o),
      (r) => ({ ok: true, deviceId: str(r?.id, 80) || did, confirmedAt: Date.now() })));
  }));
}
