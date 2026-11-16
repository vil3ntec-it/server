// ---------------------------------------------------------------------------
//  🛟 «از پشتیبانی بخواه» در پنل — صفِ درخواست‌های ساخت‌یافتهٔ پشتیبانی و «درستش کن» ِ یک‌کلیکی (۱.۵۲.۰؛ shop ‎claude/e-support‎،
//  توانایی ‎support-requests.v1‎، مهاجرتِ ۹۶۰ ِ سرورِ حساب؛ رابط: کارتِ «درخواست» در `pages/account/Support.tsx`)
//
//    GET  /console/support-requests                     ⇐ GET  /api/admin/support-requests  (status, problem, shop, minAgeHours, maxAgeHours, limit, offset)
//    GET  /console/support-requests/:id                 ⇐ GET  /api/admin/support-requests/:id
//    GET  /console/support-requests/:id/sync-error      ⇐ GET  /api/admin/support-requests/:id/sync-error?shopId=
//    POST /console/support-requests/:id/resolve         ⇐ POST /api/admin/support-requests/:id/resolve
//    POST /console/support-requests/:id/fix/<کار>       ⇐ POST /api/admin/support-requests/:id/fix/<کار> (enable-flag | grant-subscription | raise-device-limit | resend-email-code)
//
//  ⛔ برنامهٔ دکان درخواست را با یک لمس در **همان** رشتهٔ پشتیبانی می‌فرستد (چتِ دوم نیست)؛ این‌جا فقط دیدن، «حل شد» و همان
//     چهار کارِ سرورِ حساب — هیچ منطقِ پرچم یا اشتراکی در پنل نیست (پرچم: ردیفِ صریحِ همان دکان با تاریخچه؛ اشتراک: `grantOnce`).
//  ⛔ بی توانایی (سرورِ حسابِ کهنه) ⇒ خواندن `unavailable`، نوشتن ‎501 capability_missing‎ — هیچ درخواستِ ساختگی.
//  ⛔ نقش پیش از پل: خواندن ماژولِ «پشتیبانی/دکان‌ها» (بیننده هم)؛ «حل شد» و «کد را دوباره بفرست» operator؛ پرچم، تمدید و سقفِ
//     دستگاه admin ِ پنل (آن‌جا ارشد). پول (تمدید، سقفِ دستگاه) ⇒ `confirm: true` ِ پنجرهٔ تأییدِ رابط، وگرنه ‎400 confirm_required‎.
//  ⛔ هر نوشتن: `shopId` ِ همان کارت (سرورِ حساب: دکانِ دیگر ⇒ ۴۰۴)، کلیدِ پنجره ⇒ ‎Idempotency-Key‎ ِ خودِ سرورِ حساب (بسته به کاربرِ
//     پنل، `makeUpstreamOnce`)، سقفِ نرخِ هر کاربر و ردیفِ دفترِ پنل `account.support_request.*` — بازپخش ردیفِ دوم ندارد.
//  ⛔ پاسخ فقط فیلدهای شناخته؛ متن‌ها متنِ ساده‌اند و رابط هرگز از آن‌ها HTML نمی‌سازد.
// ---------------------------------------------------------------------------
import { audit, checkIdemKey, cloudRaw, makeUpstreamOnce, panelRoles, rateLimit } from '../host.js';
import { requireModule } from '../console/modules.js';

const { requireRole } = panelRoles;
export const CAP = 'support-requests.v1';
export const SUPPORT_REQUEST_CAPABILITIES = Object.freeze({
  [CAP]: 'GET /api/admin/support-requests[/:id[/sync-error]] · POST …/:id/resolve · POST …/:id/fix/(enable-flag|grant-subscription|raise-device-limit|resend-email-code) (shop: claude/e-support، مهاجرتِ ۹۶۰)',
});
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const CODE_RE = /^[a-z][a-z0-9_]{1,40}(:[a-z0-9_.]{1,64})?$/;
const STATUSES = ['open', 'resolved', 'all'];
export const FIX_KINDS = Object.freeze(['enable-flag', 'grant-subscription', 'raise-device-limit', 'resend-email-code']);
/** کارهایی که پول/اشتراک را عوض می‌کنند ⇒ پنجرهٔ تأیید (`confirm: true`) */
export const MONEY_FIXES = Object.freeze(['grant-subscription', 'raise-device-limit']);
const FIX_ROLE = { 'enable-flag': 'admin', 'grant-subscription': 'admin', 'raise-device-limit': 'admin', 'resend-email-code': 'operator' };
const FIXES = ['enable_flag', 'grant_subscription', 'raise_device_limit', 'resend_email_code', 'show_sync_error', 'none'];

// eslint-disable-next-line no-control-regex
const str = (v, max = 120) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '');
const numOr = (v) => (v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);
const FACT_RE = /^[A-Za-z0-9_.:+-]{0,40}$/;
/** همان فهرستِ واقعیت‌های `support-problems.json` ِ سرورِ حساب — کلیدِ دیگر (حتی اگر بیاید) نشان داده نمی‌شود */
export const FACT_KEYS = Object.freeze(['appVersion', 'platform', 'screen', 'syncError', 'rejected', 'devices', 'maxDevices']);

/** واقعیت‌های درخواست — فقط کلیدهای شناخته با مقدارِ کوتاهِ ساده؛ چیزِ دیگر می‌افتد */
function shapeContext(c) {
  const out = {};
  if (!c || typeof c !== 'object' || Array.isArray(c)) return out;
  for (const [k, v] of Object.entries(c).slice(0, 12)) {
    if (!FACT_KEYS.includes(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string' && FACT_RE.test(v)) out[k] = v;
  }
  return out;
}

function shapeFix(f) {
  return {
    action: FIXES.includes(f?.action) ? f.action : '', result: str(f?.result, 20), by: str(f?.by, 120), at: numOr(f?.at),
    before: shapeState(f?.before), after: shapeState(f?.after),
  };
}

/** حالِ پرچم/اشتراک/ایمیلِ پیش و پس — فقط فیلدهای شناخته */
function shapeState(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return {};
  const out = {};
  for (const k of ['effective', 'explicit', 'hold', 'active']) if (typeof s[k] === 'boolean' || s[k] === null) out[k] = s[k];
  for (const k of ['key', 'status', 'phase', 'plan', 'state', 'book', 'email', 'sent', 'via']) if (typeof s[k] === 'string') out[k] = str(s[k], 80);
  for (const k of ['endsAt', 'daysLeft', 'maxDevices', 'days']) if (numOr(s[k]) !== null) out[k] = numOr(s[k]);
  if (Array.isArray(s.features)) out.features = s.features.filter((x) => typeof x === 'string').slice(0, 30).map((x) => str(x, 40));
  return out;
}

export function shapeRequest(r) {
  return {
    id: ID_RE.test(String(r?.id || '')) ? String(r.id) : '',
    threadId: ID_RE.test(String(r?.threadId || '')) ? String(r.threadId) : '',
    shopId: ID_RE.test(String(r?.shopId || '')) ? String(r.shopId) : '',
    shopName: str(r?.shopName, 120), who: str(r?.who, 80),
    code: CODE_RE.test(String(r?.code || '')) ? String(r.code) : '',
    problem: str(r?.problem, 40), param: str(r?.param, 64), title: str(r?.title, 200),
    fix: FIXES.includes(r?.fix) ? r.fix : 'none', needsShop: r?.needsShop === true, lang: str(r?.lang, 4),
    context: shapeContext(r?.context),
    status: r?.status === 'resolved' ? 'resolved' : 'open', threadStatus: str(r?.threadStatus, 20),
    unreadAdmin: numOr(r?.unreadAdmin) ?? 0,
    createdAt: numOr(r?.createdAt), updatedAt: numOr(r?.updatedAt), resolvedAt: numOr(r?.resolvedAt), resolvedBy: str(r?.resolvedBy, 120),
    fixes: (Array.isArray(r?.fixes) ? r.fixes : []).slice(0, 10).map(shapeFix).filter((f) => f.action),
  };
}

function shapeMessage(m) {
  return {
    id: ID_RE.test(String(m?.id || '')) ? String(m.id) : '', sender: ['user', 'admin', 'system'].includes(m?.sender) ? m.sender : 'user',
    senderName: str(m?.senderName, 80), body: str(m?.body, 4000), kind: str(m?.kind, 20), createdAt: numOr(m?.createdAt),
  };
}

function shapeLive(s) {
  const out = {};
  if (s?.flag) out.flag = shapeState(s.flag);
  if (s?.subscription) out.subscription = shapeState(s.subscription);
  return out;
}

/**
 * @param {import('express').Router} router  همان روترِ ‎account-admin.js‎ (همان «انجام‌دهنده»، فهرستِ سفید و ‎bridge-roles.mjs‎)
 */
export function mountConsoleSupportRequests(router, { guard, badInput, actorOf, capListed, missingErr, unavailable }) {
  const viaServer = makeUpstreamOnce();
  const writeLimit = rateLimit({ name: 'console-support-requests-write', max: 60, windowMs: 10 * 60_000, key: (req) => `u${req.user?.id ?? 'x'}` });
  const read = requireModule('shops');
  const idOf = (v) => {
    const s = String(v ?? '');
    if (!ID_RE.test(s)) throw badInput('bad_id', 'شناسه معتبر نیست');
    return s;
  };
  //  '' = درخواستِ بی‌دکان (مهمان)
  const shopOf = (v) => {
    if (typeof v !== 'string' || (v !== '' && !ID_RE.test(v))) throw badInput('bad_shop', 'شناسهٔ دکانِ همین درخواست لازم است');
    return v;
  };
  const hours = (v) => {
    if (v === undefined || v === '') return '';
    if (typeof v !== 'string' || !/^\d{1,4}$/.test(v) || +v > 24 * 365) throw badInput('bad_age', 'سن باید عددِ ساعت باشد');
    return v;
  };

  router.get('/console/support-requests', read, guard(async (req, res) => {
    const q = req.query || {};
    const status = q.status === undefined || q.status === '' ? 'open' : String(q.status);
    if (!STATUSES.includes(status)) throw badInput('bad_status', 'حالِ درخواست شناخته نیست');
    const problem = q.problem === undefined || q.problem === '' ? '' : String(q.problem);
    if (problem && !CODE_RE.test(problem)) throw badInput('bad_problem', 'کدِ درخواست شناخته نیست');
    const shop = q.shop === undefined || q.shop === '' ? '' : idOf(q.shop);
    const query = { status, limit: '200' };
    if (problem) query.problem = problem;
    if (shop) query.shop = shop;
    const minAge = hours(q.minAgeHours);
    const maxAge = hours(q.maxAgeHours);
    if (minAge) query.minAgeHours = minAge;
    if (maxAge) query.maxAgeHours = maxAge;
    res.setHeader('Cache-Control', 'no-store');
    if (!(await capListed(CAP))) return res.json(unavailable(CAP));
    const out = await cloudRaw('GET', '/api/admin/support-requests', { query });
    res.json({
      available: true, fetchedAt: Date.now(),
      requests: (Array.isArray(out?.requests) ? out.requests : []).slice(0, 200).map(shapeRequest).filter((r) => r.id),
      open: numOr(out?.open) ?? 0, unread: numOr(out?.unread) ?? 0,
    });
  }));

  router.get('/console/support-requests/:id', read, guard(async (req, res) => {
    const id = idOf(req.params.id);
    res.setHeader('Cache-Control', 'no-store');
    if (!(await capListed(CAP))) return res.json(unavailable(CAP));
    const out = await cloudRaw('GET', `/api/admin/support-requests/${id}`);
    res.json({
      available: true, fetchedAt: Date.now(), request: shapeRequest(out?.request),
      messages: (Array.isArray(out?.messages) ? out.messages : []).slice(-300).map(shapeMessage).filter((m) => m.id),
      state: shapeLive(out?.state),
    });
  }));

  router.get('/console/support-requests/:id/sync-error', read, guard(async (req, res) => {
    const id = idOf(req.params.id);
    const shopId = shopOf(String(req.query?.shopId ?? ''));
    res.setHeader('Cache-Control', 'no-store');
    if (!(await capListed(CAP))) return res.json(unavailable(CAP));
    const out = await cloudRaw('GET', `/api/admin/support-requests/${id}/sync-error`, { query: { shopId } });
    res.json({
      available: out?.available !== false, restricted: out?.restricted !== false, weekCount: numOr(out?.weekCount) ?? 0,
      errors: (Array.isArray(out?.errors) ? out.errors : []).slice(0, 5).map((e) => ({
        id: str(e?.id, 60), appVersion: str(e?.appVersion, 32), message: str(e?.message, 500), at: numOr(e?.at),
        ...(typeof e?.stack === 'string' ? { stack: str(e.stack, 4000), logTail: str(e?.logTail, 4000), device: str(e?.device, 64) } : {}),
      })),
    });
  }));

  router.post('/console/support-requests/:id/resolve', read, requireRole('operator'), writeLimit, guard(async (req, res) => {
    const id = idOf(req.params.id);
    const shopId = shopOf(req.body?.shopId);
    const note = str(req.body?.note, 200).trim();
    const key = checkIdemKey(req.body?.idempotencyKey);
    if (!(await capListed(CAP))) throw missingErr(CAP);
    const finish = (r, { record, resolved }) => {
      const request = shapeRequest(r?.request);
      if (record && r?.unchanged !== true) {
        audit({ actor: actorOf(req), action: 'account.support_request.resolved', entity: 'shop', entityId: shopId || id,
          detail: { request: id, code: request.code, ...(note ? { note } : {}), ...(resolved ? { resolved: true } : {}) } });
      }
      return { ok: true, request, unchanged: r?.unchanged === true, confirmedAt: Date.now() };
    };
    res.json(await viaServer(req, key,
      (headers) => cloudRaw('POST', `/api/admin/support-requests/${id}/resolve`, { body: { shopId, ...(note ? { note } : {}) }, headers, replayFlag: true }), finish));
  }));

  /** یک درِ «درستش کن»: نقش پیش از هر چیز (viewer/operator برای پرچم و پول هیچ درخواستی بالا نمی‌فرستند)، بعد ورودی، بعد پل */
  const fixDoor = (kind, send) => [read, requireRole(FIX_ROLE[kind]), writeLimit, guard(async (req, res) => {
    const id = idOf(req.params.id);
    const shopId = shopOf(req.body?.shopId);
    if (MONEY_FIXES.includes(kind) && req.body?.confirm !== true) {
      throw badInput('confirm_required', 'این کار پول و اشتراک را عوض می‌کند و تأیید می‌خواهد');
    }
    const body = { shopId, resolve: req.body?.resolve === true };
    if (MONEY_FIXES.includes(kind)) body.confirm = true;
    if (kind === 'grant-subscription' && req.body?.days !== undefined) {
      if (!Number.isInteger(req.body.days) || req.body.days < 1 || req.body.days > 366) throw badInput('bad_days', 'روزها باید ۱ تا ۳۶۶ باشد');
      body.days = req.body.days;
    }
    if (kind === 'raise-device-limit' && req.body?.devices !== undefined) {
      if (!Number.isInteger(req.body.devices) || req.body.devices < 2 || req.body.devices > 100) throw badInput('bad_devices', 'شمارِ دستگاه ۲ تا ۱۰۰');
      body.devices = req.body.devices;
    }
    const note = str(req.body?.note, 120).trim();
    if (note) body.note = note;
    const key = checkIdemKey(req.body?.idempotencyKey);
    if (!(await capListed(CAP))) throw missingErr(CAP);
    const finish = (r, { record, resolved }) => {
      const fix = shapeFix(r?.fix);
      const already = r?.already === true;
      if (record && !already) {
        audit({ actor: actorOf(req), action: `account.support_request.${kind.replace(/-/g, '_')}`, entity: 'shop', entityId: shopId || id,
          detail: { request: id, result: fix.result, before: fix.before, after: fix.after, ...(body.days ? { days: body.days } : {}),
            ...(body.devices ? { devices: body.devices } : {}), ...(resolved ? { resolved: true } : {}) } });
      }
      return {
        ok: true, already, fix, request: shapeRequest(r?.request), state: shapeLive(r?.state),
        replied: Boolean(r?.reply?.messageId), pushed: numOr(r?.reply?.pushed) ?? 0, confirmedAt: Date.now(),
      };
    };
    res.json(await viaServer(req, key, (headers) => send(id, { body, headers, replayFlag: true }), finish));
  })];

  //  ⛔ هر مقصد به شکلِ ثابتِ خودش (فهرستِ سفیدِ `bridge-contract.js` و `bridge-roles.mjs` از سورس می‌شمرند)
  router.post('/console/support-requests/:id/fix/enable-flag', ...fixDoor('enable-flag',
    (id, o) => cloudRaw('POST', `/api/admin/support-requests/${id}/fix/enable-flag`, o)));
  router.post('/console/support-requests/:id/fix/grant-subscription', ...fixDoor('grant-subscription',
    (id, o) => cloudRaw('POST', `/api/admin/support-requests/${id}/fix/grant-subscription`, o)));
  router.post('/console/support-requests/:id/fix/raise-device-limit', ...fixDoor('raise-device-limit',
    (id, o) => cloudRaw('POST', `/api/admin/support-requests/${id}/fix/raise-device-limit`, o)));
  router.post('/console/support-requests/:id/fix/resend-email-code', ...fixDoor('resend-email-code',
    (id, o) => cloudRaw('POST', `/api/admin/support-requests/${id}/fix/resend-email-code`, o)));
}
