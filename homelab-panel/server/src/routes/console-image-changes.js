// ---------------------------------------------------------------------------
//  IMG-PRO-17 در پنلِ مرکزی — «تغییرهای دسته‌ایِ عکس و برگرداندن» ِ یک دکان (۱.۵۰.۹۶؛ shop ‎claude/e-rows-13x‎، توانایی
//  ‎image-changes.v1‎؛ رابط: `ImageChangesCard.tsx` در ماژولِ «بانکِ عکس»)
//
//    GET  /console/shops/:id/images/changes[?limit=1..50]       ⇐ GET  /api/admin/shops/:id/images/changes
//    GET  /console/shops/:id/images/changes/:cid                ⇐ GET  /api/admin/shops/:id/images/changes/:cid
//    POST /console/shops/:id/images/changes/:cid/rollback       ⇐ POST /api/admin/shops/:id/images/changes/:cid/rollback
//
//  ⛔ دسته را خودِ دکان در برنامه‌اش می‌سازد؛ این‌جا فقط دیدن و برگرداندن (اعمالِ دسته از پنل نیست).
//  ⛔ بی `image-changes.v1` (سرورِ حسابِ کهنه) ⇒ خواندن `unavailable`، نوشتن ‎501 capability_missing‎ — هیچ دستهٔ ساختگی.
//  ⛔ خواندن با ماژولِ «بانکِ عکس» (بیننده هم)؛ جزئیات وقتی پرچمِ ‎security / admin.support_grant‎ ِ سرورِ حساب روشن است اجازهٔ
//     `read_private` می‌خواهد (‎403 grant_required‎ همان‌طور بالا می‌رود).
//  ⛔ برگرداندن: admin ِ پنل (آن‌جا ارشد) + دلیلِ ۳ تا ۲۰۰ + تأیید + کلیدِ پنجره ⇒ ‎Idempotency-Key‎ ِ خودِ سرورِ حساب (بسته به کاربرِ
//     پنل، `makeUpstreamOnce`؛ این توانایی همیشه کلید را می‌شناسد، پس راهِ دوم نیست) + سقفِ نرخِ هر کاربر + ردیفِ دفترِ پنل
//     (`account.image_changes.rolled_back`). سرورِ حساب **همیشه** اجازهٔ زندهٔ `restore` ِ همین آدم روی همین دکان را می‌خواهد
//     (کارتِ «دسترسیِ پشتیبانی» در پروندهٔ دکان). ‎409 changed_since‎ ⇒ نامِ کالاهایی که پس از دسته دوباره عوض شده‌اند، و هیچ.
//  ⛔ پاسخ فقط فیلدهای شناخته؛ شناسهٔ کالا و یادداشت متنِ ساده‌اند و رابط هرگز از آن‌ها HTML نمی‌سازد.
// ---------------------------------------------------------------------------
import * as panelRoles from '../control/roles.js';
import { audit } from '../control/audit.js';
import { cloudRaw } from '../stations/cloud.js';
import { rateLimit } from '../platform/rate-limit.js';
import { requireModule } from '../console/modules.js';
import { checkIdemKey, makeUpstreamOnce } from '../account/idem-once.js';

const { requireRole } = panelRoles;
const CAP = 'image-changes.v1';
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const CID_RE = /^[A-Za-z0-9_-]{1,40}$/;
export const CHANGES_LIST_MAX = 50;
export const CHANGE_ITEMS_MAX = 100;
const STATUSES = ['applied', 'rolled_back'];

// eslint-disable-next-line no-control-regex
const str = (v, max = 120) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '');
const numOr = (v) => (v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);

/** وضعِ عکسِ یک کالا (پیش یا پس از دسته) ⇒ فقط ستون‌های تصمیم؛ نبود ⇒ null («بی ردیف»: عکسِ همگام‌شده یا بی عکس) */
export function shapeSelection(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  return {
    source: str(s.source, 16), imageId: str(s.image_id, 60), version: numOr(s.version),
    matchStatus: str(s.match_status, 30), centralImageId: str(s.central_image_id, 60), centralVersion: numOr(s.central_version),
    bankProductId: str(s.bank_product_id, 60),
  };
}

export function shapeChange(c, { items = false } = {}) {
  const out = {
    id: CID_RE.test(String(c?.id || '')) ? String(c.id) : '',
    note: str(c?.note, 200),
    status: STATUSES.includes(c?.status) ? c.status : '',
    itemCount: numOr(c?.item_count) ?? 0,
    createdBy: str(c?.created_by, 80), createdAt: numOr(c?.created_at),
    rolledBackBy: str(c?.rolled_back_by, 80), rolledBackAt: numOr(c?.rolled_back_at), rollbackReason: str(c?.rollback_reason, 200),
  };
  if (items) {
    out.items = (Array.isArray(c?.items) ? c.items : []).slice(0, CHANGE_ITEMS_MAX)
      .map((x) => ({ productId: str(x?.product_id, 80), before: shapeSelection(x?.before), after: shapeSelection(x?.after) }))
      .filter((x) => x.productId);
  }
  return out;
}

/** فهرستِ کالاهای ‎409 changed_since‎ ِ سرورِ حساب — فقط شناسه‌های متنی، تا ۱۰۰ */
export function changedProducts(upstream) {
  const list = Array.isArray(upstream?.products) ? upstream.products : [];
  return list.filter((p) => typeof p === 'string').slice(0, CHANGE_ITEMS_MAX).map((p) => str(p, 80)).filter(Boolean);
}

/**
 * @param {import('express').Router} router  همان روترِ ‎account-admin.js‎ (همان «انجام‌دهنده»، فهرستِ سفید و ‎bridge-roles.mjs‎)
 */
export function mountConsoleImageChanges(router, { guard, badInput, actorOf, capListed, missingErr, unavailable }) {
  const viaServer = makeUpstreamOnce();
  const writeLimit = rateLimit({ name: 'console-image-changes-write', max: 30, windowMs: 10 * 60_000, key: (req) => `u${req.user?.id ?? 'x'}` });
  const read = requireModule('imagebank');
  const shopOf = (v) => {
    const s = String(v ?? '');
    if (!ID_RE.test(s)) throw badInput('bad_id', 'شناسهٔ دکان معتبر نیست');
    return s;
  };
  const cidOf = (v) => {
    const s = String(v ?? '');
    if (!CID_RE.test(s)) throw badInput('bad_change_id', 'شناسهٔ دسته معتبر نیست');
    return s;
  };

  router.get('/console/shops/:id/images/changes', read, guard(async (req, res) => {
    const id = shopOf(req.params.id);
    const raw = req.query?.limit;
    let limit = null;
    if (raw !== undefined) {
      if (typeof raw !== 'string' || !/^\d{1,3}$/.test(raw) || +raw < 1 || +raw > CHANGES_LIST_MAX) {
        throw badInput('bad_limit', `limit باید عددِ ۱ تا ${CHANGES_LIST_MAX} باشد`);
      }
      limit = +raw;
    }
    res.setHeader('Cache-Control', 'no-store');
    if (!(await capListed(CAP))) return res.json(unavailable(CAP));
    const out = await cloudRaw('GET', `/api/admin/shops/${id}/images/changes`, { query: limit ? { limit: String(limit) } : {} });
    res.json({
      available: true, fetchedAt: Date.now(), shopId: id, enabled: out?.enabled === true,
      changes: (Array.isArray(out?.changes) ? out.changes : []).slice(0, CHANGES_LIST_MAX).map((c) => shapeChange(c)).filter((c) => c.id),
    });
  }));

  router.get('/console/shops/:id/images/changes/:cid', read, guard(async (req, res) => {
    const id = shopOf(req.params.id);
    const cid = cidOf(req.params.cid);
    res.setHeader('Cache-Control', 'no-store');
    if (!(await capListed(CAP))) return res.json(unavailable(CAP));
    const out = await cloudRaw('GET', `/api/admin/shops/${id}/images/changes/${cid}`);
    res.json({ available: true, fetchedAt: Date.now(), shopId: id, change: shapeChange(out?.change, { items: true }) });
  }));

  router.post('/console/shops/:id/images/changes/:cid/rollback', read, requireRole('admin'), writeLimit, guard(async (req, res) => {
    //  همهٔ ورودی پیش از هر پرسش از سرورِ حساب
    const id = shopOf(req.params.id);
    const cid = cidOf(req.params.cid);
    if (req.body?.confirm !== true) throw badInput('confirm_required', 'این کار پیش از فرستادن تأیید می‌خواهد');
    const reason = str(req.body?.reason, 400).trim();
    if (reason.length < 3 || reason.length > 200) throw badInput('reason_required', 'دلیل را بنویسید (۳ تا ۲۰۰ نویسه) — در دفترِ پنل و سرورِ حساب می‌ماند');
    const key = checkIdemKey(req.body?.idempotencyKey);
    if (!(await capListed(CAP))) throw missingErr(CAP);
    const finish = (r, { record, resolved }) => {
      const change = shapeChange(r?.change, { items: true });
      const already = r?.already === true;
      if (record) {
        audit({ actor: actorOf(req), action: 'account.image_changes.rolled_back', entity: 'shop', entityId: id,
          detail: { change: cid, reason, items: change.items.length, already, ...(resolved ? { resolved: true } : {}) } });
      }
      return { ok: true, already, change, confirmedAt: Date.now() };
    };
    try {
      res.json(await viaServer(req, key,
        (headers) => cloudRaw('POST', `/api/admin/shops/${id}/images/changes/${cid}/rollback`, { body: { reason }, headers, replayFlag: true }), finish));
    } catch (err) {
      if (err?.code !== 'changed_since') throw err;
      //  ⛔ هیچ چیز برنگشت: کالاهایی که پس از این دسته دوباره عوض شده‌اند ⇒ اول همان تغییرِ تازه‌تر
      const products = changedProducts(err.upstream);
      res.status(409).json({
        error: 'changed_since', products,
        message: `${err.message || 'عکسِ بعضی کالاها پس از این دسته دوباره عوض شده است'}${products.length ? ` — ${products.join('، ')}` : ''}`,
      });
    }
  }));
}
