// ---------------------------------------------------------------------------
//  🔐 دسترسیِ پشتیبانی به دادهٔ خصوصیِ **یک** دکان — G1 ِ پنلِ مرکزی (ACP-03، TEN-04؛ ۱.۵۰.۹۰)
//
//  تصمیمِ صاحب محصول ۱۴۰۵/۰۸/۲۰ (۲-۹): **ACP-D1 الف** — اجازهٔ موقت پیش‌فرض ۶۰ دقیقه، سقفِ ۲۴ ساعت؛ تمدید = اجازهٔ تازه
//  با دلیلِ تازه. **ACP-D2 الف** — «شکستنِ شیشه» (بی رضایتِ دکان) فقط با دلیلِ نوشته و خبرِ فوری به صاحبِ دکان؛ و فقط
//  صاحبِ پلتفرم (مالکِ پنل) با رمزِ دوباره.
//
//    GET  /console/shops/:id/access-grants                 ⇐ GET  /api/admin/shops/:id/access-grants
//    POST /console/shops/:id/access-grants                 ⇐ POST /api/admin/shops/:id/access-grants                (درخواست؛ دکان در برنامه می‌پذیرد)
//    POST /console/shops/:id/access-grants/break-glass     ⇐ POST /api/admin/shops/:id/access-grants/break-glass    (مالک + رمز + دلیل)
//    POST /console/shops/:id/access-grants/:gid/revoke     ⇐ POST /api/admin/shops/:id/access-grants/:gid/revoke
//
//  ⛔ قرارداد با سرورِ حساب (ریپوی shop، `docs/spec/ADMIN-CONTROL-PLANE.md` §۸.۱، مهاجرتِ رزروِ ‎079‎) پشتِ توانایی
//     ‎support-access.v1‎. آن‌جا: جدولِ `admin_access_grants`، زمان فقط از ساعتِ سرور، `requireGrant(scope)` روی هر مسیرِ محتوای
//     خصوصی، نوارِ «پشتیبانی در حالِ مشاهده» در برنامهٔ دکان، و **خبرِ همان دم** به صاحبِ دکان برای «شکستنِ شیشه». بی آن
//     (سرورِ حسابِ امروز) ⇒ خواندن `unavailable`، نوشتن ‎501 capability_missing‎ — هیچ اجازهٔ ساختگی، هیچ پرسشِ بی‌نتیجه.
//  ⛔ پنل همان قاعده‌های ACP-D1/D2 را **پیش از پل** می‌سنجد (دفاعِ دولایه؛ سرورِ حساب دوباره می‌سنجد):
//       • مدت: عددِ صحیحِ ۵ تا ۱۴۴۰ دقیقه، پیش‌فرض ۶۰ — بیش از سقف ⇒ ‎400 bad_minutes‎ (هرگز بریدنِ بی‌صدا)؛
//       • دامنه: یکی از ‎read_private | export | restore | view_as‎ (پیش‌فرض ‎read_private‎)؛
//       • درخواست: admin ِ پنل + دلیلِ ۳ تا ۲۰۰ + تأیید + کلیدِ یکتاییِ رابط؛
//       • شکستنِ شیشه: **مالکِ پنل** + رمزِ دوبارهٔ همان درخواست (`bodyStepUp`، با دوعاملی) + دلیلِ ۱۰ تا ۳۰۰ + تأیید + کلید؛
//         پاسخِ سرورِ حساب باید ‎notified: true‎ بگوید، وگرنه رابط «خبر رفت؟ معلوم نیست» نشان می‌دهد و دفترِ پنل همان را می‌نویسد؛
//       • لغو: admin + دلیل + تأیید + کلید.
//     هر نوشتن یک ردیفِ دفترِ پنل (`account.support_access.*`). پاسخ فقط فیلدهای شناخته — هرگز رمز، توکن یا محتوای دکان.
// ---------------------------------------------------------------------------
import * as panelRoles from '../control/roles.js';
import { audit } from '../control/audit.js';
import { cloudRaw } from '../stations/cloud.js';
import { rateLimit } from '../platform/rate-limit.js';
import { requireModule } from '../console/modules.js';
import { checkIdemKey, makeIdemOnce } from '../account/idem-once.js';

const { requireRole } = panelRoles;
const CAP = 'support-access.v1';
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
export const ACCESS_SCOPES = ['read_private', 'export', 'restore', 'view_as'];
export const ACCESS_DEFAULT_MINUTES = 60;          //  ACP-D1 الف
export const ACCESS_MAX_MINUTES = 24 * 60;         //  ACP-D1 الف: سقفِ ۲۴ ساعت
export const ACCESS_MIN_MINUTES = 5;
const STATUSES = ['pending', 'active', 'expired', 'revoked', 'denied'];
const CONSENTS = ['tenant', 'break_glass'];

// eslint-disable-next-line no-control-regex
const str = (v, max = 120) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '');
const numOr = (v) => (v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);

export function shapeGrant(g) {
  return {
    id: ID_RE.test(String(g?.id || '')) ? String(g.id) : '',
    scope: ACCESS_SCOPES.includes(g?.scope) ? g.scope : '',
    consent: CONSENTS.includes(g?.consent) ? g.consent : '',
    status: STATUSES.includes(g?.status) ? g.status : '',
    reason: str(g?.reason, 300),
    ticketId: str(g?.ticket_id ?? g?.ticketId, 80),
    requestedBy: str(g?.requested_by ?? g?.requestedBy, 120),
    grantedBy: str(g?.granted_by ?? g?.grantedBy, 120),
    revokedBy: str(g?.revoked_by ?? g?.revokedBy, 120),
    startsAt: numOr(g?.starts_at ?? g?.startsAt),
    expiresAt: numOr(g?.expires_at ?? g?.expiresAt),
    revokedAt: numOr(g?.revoked_at ?? g?.revokedAt),
    notifiedAt: numOr(g?.notified_at ?? g?.notifiedAt),
    uses: numOr(g?.uses) ?? 0,
  };
}

/** مدت: نبود ⇒ ۶۰؛ عددِ صحیحِ ۵ تا ۱۴۴۰ وگرنه ‎400 bad_minutes‎ (ACP-D1) */
export function minutesOf(v, badInput) {
  if (v === undefined || v === null || v === '') return ACCESS_DEFAULT_MINUTES;
  if (!Number.isInteger(v) || v < ACCESS_MIN_MINUTES || v > ACCESS_MAX_MINUTES) {
    throw badInput('bad_minutes', `مدت باید ${ACCESS_MIN_MINUTES} تا ${ACCESS_MAX_MINUTES} دقیقه باشد (سقفِ ۲۴ ساعت؛ تمدید = اجازهٔ تازه با دلیلِ تازه)`);
  }
  return v;
}

/**
 * @param {import('express').Router} router  همان روترِ ‎account-admin.js‎ (همان «انجام‌دهنده»، فهرستِ سفید و ‎bridge-roles.mjs‎)
 */
export function mountConsoleSupportAccess(router, { guard, badInput, actorOf, capListed, missingErr, unavailable, isPanelOwner, reauthLimit, reauth }) {
  const once = makeIdemOnce();
  const writeLimit = rateLimit({ name: 'console-support-access-write', max: 30, windowMs: 10 * 60_000, key: (req) => `u${req.user?.id ?? 'x'}` });
  const idOf = (v, code = 'bad_id') => {
    const s = String(v ?? '');
    if (!ID_RE.test(s)) throw badInput(code, 'شناسه معتبر نیست');
    return s;
  };
  const common = (req, { reasonMin = 3, reasonMax = 200 } = {}) => {
    if (req.body?.confirm !== true) throw badInput('confirm_required', 'این کار پیش از فرستادن تأیید می‌خواهد');
    const reason = str(req.body?.reason, 600).trim();
    if (reason.length < reasonMin || reason.length > reasonMax) {
      throw badInput('reason_required', `دلیل را بنویسید (${reasonMin} تا ${reasonMax} نویسه) — در دفترِ پنل و سرورِ حساب می‌ماند و صاحبِ دکان هم می‌بیند`);
    }
    return { reason, key: checkIdemKey(req.body?.idempotencyKey) };
  };
  const scopeOf = (v) => {
    if (v === undefined || v === null || v === '') return 'read_private';
    if (!ACCESS_SCOPES.includes(v)) throw badInput('bad_scope', 'دامنهٔ دسترسی درست نیست');
    return v;
  };
  //  ⛔ شکستنِ شیشه فقط صاحبِ پلتفرم — پیش از رمز، تا مدیرِ دوم «رمز بزن» هم نبیند
  const ownerOnly = (req, res, next) => {
    if (isPanelOwner(req)) return next();
    audit({ actor: actorOf(req), action: 'account.support_access.denied', entity: 'shop', entityId: String(req.params?.id || '').slice(0, 60), result: 'forbidden', detail: { why: 'not_owner', what: 'break_glass' } });
    return res.status(403).json({ error: 'owner_only', message: '«شکستنِ شیشه» (دسترسی بی رضایتِ دکان) فقط کارِ مالکِ پنل است' });
  };

  router.get('/console/shops/:id/access-grants', requireModule('shops'), guard(async (req, res) => {
    const id = idOf(req.params.id);
    res.setHeader('Cache-Control', 'no-store');
    if (!(await capListed(CAP))) return res.json(unavailable(CAP));
    const out = await cloudRaw('GET', `/api/admin/shops/${id}/access-grants`);
    res.json({
      available: true, fetchedAt: Date.now(),
      grants: (Array.isArray(out?.grants) ? out.grants : []).slice(0, 200).map(shapeGrant).filter((g) => g.id),
      policy: { defaultMinutes: ACCESS_DEFAULT_MINUTES, maxMinutes: ACCESS_MAX_MINUTES, minMinutes: ACCESS_MIN_MINUTES, scopes: ACCESS_SCOPES },
      owner: isPanelOwner(req),
    });
  }));

  router.post('/console/shops/:id/access-grants', requireRole('admin'), writeLimit, guard(async (req, res) => {
    const id = idOf(req.params.id);
    const { reason, key } = common(req);
    const minutes = minutesOf(req.body?.minutes, badInput);
    const scope = scopeOf(req.body?.scope);
    const ticketId = str(req.body?.ticketId, 80).trim();
    if (!(await capListed(CAP))) throw missingErr(CAP);
    const body = { scope, minutes, reason, consent: 'tenant', ...(ticketId ? { ticket_id: ticketId } : {}) };
    res.json(await once(req, key, `request|${id}|${JSON.stringify(body)}`, `access:${id}`, async () => {
      const r = await cloudRaw('POST', `/api/admin/shops/${id}/access-grants`, { body });
      const grant = shapeGrant(r?.grant ?? r);
      audit({ actor: actorOf(req), action: 'account.support_access.requested', entity: 'shop', entityId: id,
        detail: { grant: grant.id, scope, minutes, reason, status: grant.status } });
      return { ok: true, grant, confirmedAt: Date.now() };
    }));
  }));

  router.post('/console/shops/:id/access-grants/break-glass', requireRole('admin'), ownerOnly, writeLimit, reauthLimit, reauth, guard(async (req, res) => {
    const id = idOf(req.params.id);
    const { reason, key } = common(req, { reasonMin: 10, reasonMax: 300 });
    const minutes = minutesOf(req.body?.minutes, badInput);
    const scope = scopeOf(req.body?.scope);
    if (!(await capListed(CAP))) throw missingErr(CAP);
    const body = { scope, minutes, reason, consent: 'break_glass', notify_owner: true };
    res.json(await once(req, key, `break|${id}|${JSON.stringify(body)}`, `access:${id}`, async () => {
      const r = await cloudRaw('POST', `/api/admin/shops/${id}/access-grants/break-glass`, { body });
      const grant = shapeGrant(r?.grant ?? r);
      //  ⛔ ACP-D2: خبرِ فوری به صاحبِ دکان کارِ سرورِ حساب است؛ پنل فقط آن‌چه را آن‌جا تأیید شد می‌گوید
      const notified = r?.notified === true;
      audit({ actor: actorOf(req), action: 'account.support_access.break_glass', entity: 'shop', entityId: id,
        detail: { grant: grant.id, scope, minutes, reason, notified } });
      return { ok: true, grant, notified, confirmedAt: Date.now() };
    }));
  }));

  router.post('/console/shops/:id/access-grants/:gid/revoke', requireRole('admin'), writeLimit, guard(async (req, res) => {
    const id = idOf(req.params.id);
    const gid = idOf(req.params.gid, 'bad_grant_id');
    const { reason, key } = common(req);
    if (!(await capListed(CAP))) throw missingErr(CAP);
    res.json(await once(req, key, `revoke|${id}|${gid}|${reason}`, `access:${id}:${gid}`, async () => {
      const r = await cloudRaw('POST', `/api/admin/shops/${id}/access-grants/${gid}/revoke`, { body: { reason } });
      const grant = shapeGrant(r?.grant ?? r);
      audit({ actor: actorOf(req), action: 'account.support_access.revoked', entity: 'shop', entityId: id, detail: { grant: gid, reason } });
      return { ok: true, grant, confirmedAt: Date.now() };
    }));
  }));
}
