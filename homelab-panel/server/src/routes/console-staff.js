// ---------------------------------------------------------------------------
//  👥 کارکنان، مجوزها و دستگاه‌های **یک** دکان — در پروندهٔ دکان (۱.۵۰.۷۵، ممیزی §۳-۴ «مجوزِ کارکنان»)
//
//  تا امروز فقط در کنسولِ وبِ سرورِ حساب (‎/admin/‎). پل فقط درهای موجودِ shop را می‌زند
//  (‎routes/admin-staff-perms.js‎ ِ shop، STF-01..03 و STF-10)؛ هیچ داده‌ای این‌جا ساخته نمی‌شود.
//
//    GET  /console/shops/:id/staff                         ⇐ GET  /api/admin/shops/:id/staff-perms
//    POST /console/shops/:id/staff/devices/:did/disable    ⇐ POST /api/admin/shops/:id/staff-perms/devices/:did/disable
//
//  ⛔ خواندن: همان `minRole` ِ «فروشگاه‌های عضو» (پرونده) — سرورِ حساب هر نگاه را در سابقهٔ دکان می‌نویسد (TEN-04).
//  ⛔ پاسخ فقط فیلدهای شناخته (نه هر چه بالادست فرستاد): نام و نقشِ عضو، لایه و مجوزِ مؤثر، و از دستگاه فقط نام،
//     سکو، وضعیت و زمان‌ها — نه توکن، نه نشانیِ پوش، نه ایمیل/تلفن.
//  ⛔ ازکارانداختنِ دستگاه: admin ِ پنل (آن‌جا ارشد) + دلیلِ ۳ تا ۲۰۰ + تأیید + کلیدِ یکتاییِ رابط (‎account/idem-once.js‎،
//     چون بالادست کلید ندارد) + سقفِ نرخِ هر کاربر + ردیفِ دفترِ پنل. «این دستگاه مالِ اعضای همین دکان است» را
//     **سرورِ حساب** می‌سنجد (‎deviceOfShop‎ ⇒ ‎404 device_not_found‎) — پل شناسهٔ دکان را از مسیر می‌دهد، نه از بدنه.
//  ⛔ برگرداندنِ دستگاه در سرورِ حساب فقط برای صاحبِ دکان هست (برنامهٔ دکان)؛ درِ مدیرش نیست ⇒ رابط همین را می‌گوید.
// ---------------------------------------------------------------------------
import * as panelRoles from '../control/roles.js';
import { audit } from '../control/audit.js';
import { cloudRaw } from '../stations/cloud.js';
import { rateLimit } from '../platform/rate-limit.js';
import { requireModule } from '../console/modules.js';
import { makeIdemOnce } from '../account/idem-once.js';

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

/**
 * @param {import('express').Router} router  همان روترِ ‎account-admin.js‎ (همان «انجام‌دهنده»، فهرستِ سفید و ‎bridge-roles.mjs‎)
 * @param {{ guard: Function, badInput: Function, actorOf: Function }} d
 */
export function mountConsoleStaff(router, { guard, badInput, actorOf }) {
  const idOf = (v, code = 'bad_id') => {
    const s = String(v ?? '');
    if (!ID_RE.test(s)) throw badInput(code, 'شناسه معتبر نیست');
    return s;
  };
  const once = makeIdemOnce();
  //  ⛔ سقفِ هر کاربر روی کارِ حساس (سطلِ عمومیِ IP ِ ‎/api‎ پیش از ورود هم هست)
  const writeLimit = rateLimit({ name: 'console-staff-write', max: 30, windowMs: 10 * 60_000, key: (req) => `u${req.user?.id ?? 'x'}` });

  router.get('/console/shops/:id/staff', requireModule('shops'), guard(async (req, res) => {
    const id = idOf(req.params.id);
    const out = await cloudRaw('GET', `/api/admin/shops/${id}/staff-perms`);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      available: true, fetchedAt: Date.now(), ...shapeStaff(out),
      //  ⛔ صادقانه: کاری که سرورِ حساب برای مدیر ندارد (گزارشِ ۱.۵۰.۷۵ برای ریپوی shop)
      notSupported: ['POST /api/admin/shops/:id/staff-perms/devices/:did/enable'],
    });
  }));

  router.post('/console/shops/:id/staff/devices/:did/disable', requireRole('admin'), writeLimit, guard(async (req, res) => {
    const id = idOf(req.params.id);
    const did = idOf(req.params.did, 'bad_device_id');
    if (req.body?.confirm !== true) throw badInput('confirm_required', 'این کار پیش از فرستادن تأیید می‌خواهد');
    const reason = str(req.body?.reason, 400).trim();
    if (reason.length < 3 || reason.length > 200) throw badInput('reason_required', 'دلیل را بنویسید (۳ تا ۲۰۰ نویسه) — در دفترِ پنل و سرورِ حساب می‌ماند');
    const out = await once(req, req.body?.idempotencyKey, `${id}|${did}|${reason}`, `device:${id}:${did}`, async () => {
      const r = await cloudRaw('POST', `/api/admin/shops/${id}/staff-perms/devices/${did}/disable`, { body: { reason } });
      const result = { ok: true, deviceId: str(r?.id, 80) || did, disabledAt: numOr(r?.disabledAt), sessionsRevoked: numOr(r?.sessionsRevoked), confirmedAt: Date.now() };
      audit({ actor: actorOf(req), action: 'account.shop_device.disabled', entity: 'shop', entityId: id,
        detail: { device: did, reason, sessionsRevoked: result.sessionsRevoked } });
      return result;
    });
    res.json(out);
  }));
}
