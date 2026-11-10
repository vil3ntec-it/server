// ---------------------------------------------------------------------------
//  🖼 بانکِ عکسِ مرکزی — مرور، جست‌وجو و بازبینی (۱.۵۰.۷۵، ممیزی §۳-۴ «بانکِ عکس»)
//
//  تا امروز فقط در کنسولِ وبِ سرورِ حساب (‎/admin/‎). پل فقط درهای موجودِ shop را می‌زند
//  (‎routes/admin-image-bank.js‎ ِ shop، v3 ۳۷.۳، IMG-BANK)؛ پنل نه عکس نگه می‌دارد نه چیزی می‌سازد.
//
//    GET  /console/image-bank/status                    ⇐ GET  /api/admin/image-bank/status   (بی ۴۰۳ حتی با پرچمِ خاموش)
//    GET  /console/image-bank/review                    ⇐ GET  /api/admin/image-bank/review   (صفِ بازبینی با جزئیات)
//    GET  /console/image-bank/search                    ⇐ GET  /api/admin/image-bank/search
//    GET  /console/image-bank/images/:id                ⇐ GET  /api/admin/image-bank/images/:id
//    GET  /console/image-bank/reports                   ⇐ GET  /api/admin/image-bank/reports
//    GET  /console/image-bank/file/:id/:version/:size   ⇐ GET  /api/admin/image-bank/file/…   (بایت؛ فقط عکسِ رسترِ شناخته)
//    POST /console/image-bank/images/:id/(approve|reject|archive|search)  ⇐ همان درِ «فقط ارشد» ِ بالادست
//
//  ⛔ پرچمِ خاموشِ ‎image_bank.central‎ ⇒ بالادست ‎403 image_bank_disabled‎؛ رابط اول ‎/status‎ را می‌پرسد و «بانک روشن
//     نیست» می‌گوید — هیچ فهرستِ خالیِ ساختگی.
//  ⛔ نشانیِ فایلِ بالادست (‎/api/admin/image-bank/file/…‎) به درِ همین پل بازنویسی می‌شود؛ هر نشانیِ دیگر ⇒ null.
//     عکسِ اختصاصیِ دکان را خودِ بالادست هرگز نمی‌دهد (‎space <> 'shop'‎).
//  ⛔ پاسخِ فایل: فقط ‎image/(jpeg|png|webp|avif|gif)‎ با ‎nosniff‎ و ‎CSP: default-src 'none'‎ — نه SVG، نه HTML.
//  ⛔ بازبینی: admin ِ پنل (آن‌جا ارشد) + دلیلِ ۳ تا ۲۰۰ + تأیید + کلیدِ یکتاییِ رابط (‎account/idem-once.js‎) + سقفِ نرخ
//     + ردیفِ دفترِ پنل. بارگذاری، ورودِ گروهی و ویرایشِ کالای بانک این‌جا نیست (کارِ ابزارِ بارگذاری، نه بازبینی).
//     کلید (۱.۵۰.۷۷): سرورِ حسابِ با `idempotent-writes.v1` ⇒ کلیدِ پنجره بسته به کاربرِ پنل بالا می‌رود (`makeUpstreamOnce`)؛
//     بی آن همان یادِ حافظهٔ پل. راهِ هر کلید ثابت است (۱.۵۰.۷۸، `serverPathFor`).
// ---------------------------------------------------------------------------
import * as panelRoles from '../control/roles.js';
import { audit } from '../control/audit.js';
import { cloudRaw, cloudRawBytes } from '../stations/cloud.js';
import { rateLimit } from '../platform/rate-limit.js';
import { requireModule } from '../console/modules.js';
import { checkIdemKey, makeIdemOnce, makeUpstreamOnce, serverPathFor } from '../account/idem-once.js';

const { requireRole } = panelRoles;
const BASE = '/api/admin/image-bank';
const PANEL = '/api/account-admin/console/image-bank';
const IMG_ID = /^[A-Za-z0-9_-]{1,40}$/;
const SIZES = ['original', 'thumb', 'display', 'zoom'];
const MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];
const STATUSES = ['DRAFT', 'PROCESSING', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED'];

const str = (v, max = 120) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '');
const numOr = (v) => (v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);
const list = (v, max = 20, each = (x) => str(x, 60)) => (Array.isArray(v) ? v.slice(0, max).map(each).filter((x) => x !== '' && x !== null) : []);

/** نشانیِ فایلِ بالادست ⇒ درِ همین پل؛ هر چیزِ دیگر ⇒ null */
export function fileLink(u) {
  const m = /^\/api\/admin\/image-bank\/file\/([A-Za-z0-9_-]{1,40})\/(\d{1,6})\/([a-z]{1,12})$/.exec(String(u || ''));
  return m && SIZES.includes(m[3]) ? `${PANEL}/file/${m[1]}/${m[2]}/${m[3]}` : null;
}
const urls = (o) => Object.fromEntries(SIZES.map((s) => [s, fileLink(o?.[s])]));

const product = (p) => (p && typeof p === 'object' ? {
  id: str(p.id, 40), gtin: str(p.gtin, 20), sku: str(p.sku, 64), name: str(p.name, 200), brand: str(p.brand, 120),
  category: str(p.category, 120), variant: str(p.variant, 120), sizeValue: numOr(p.size_value), sizeUnit: str(p.size_unit, 20),
  packCount: numOr(p.pack_count), packaging: str(p.packaging, 40), status: str(p.status, 20), ...(p.missing === true ? { missing: true } : {}),
} : null);
const license = (l) => (l && typeof l === 'object' ? {
  source: str(l.source, 120), holder: str(l.holder, 120), type: str(l.type, 60), status: str(l.status, 20),
  commercialUse: typeof l.commercial_use === 'boolean' ? l.commercial_use : null, checkedAt: numOr(l.checked_at),
} : null);

export function shapeReviewItem(i) {
  return {
    id: str(i?.id, 40), status: str(i?.status, 20), space: str(i?.space, 20), role: str(i?.role, 20), fromShop: i?.from_shop === true,
    batchId: str(i?.batch_id, 40), createdAt: numOr(i?.created_at), matchStatus: str(i?.match_status, 40), matchReasons: list(i?.match_reasons),
    qualityFlags: list(i?.quality_flags), duplicateOf: list(i?.duplicate_of, 20, (x) => str(typeof x === 'object' ? x?.id : x, 40)),
    license: license(i?.license), product: product(i?.product), candidates: (Array.isArray(i?.candidates) ? i.candidates : []).slice(0, 20).map(product),
    version: numOr(i?.version), versionsPending: numOr(i?.versions_pending) ?? 0,
    file: i?.file && typeof i.file === 'object' ? { url: fileLink(i.file.url), mime: MIMES.includes(i.file.mime) ? i.file.mime : '', width: numOr(i.file.width), height: numOr(i.file.height) } : null,
  };
}

export function shapeDetail(d) {
  return {
    id: str(d?.id, 40), space: str(d?.space, 20), status: str(d?.status, 20), role: str(d?.role, 20), currentVersion: numOr(d?.current_version),
    searchEnabled: d?.search_enabled === true, matchStatus: str(d?.match_status, 40), matchReasons: list(d?.match_reasons),
    license: license(d?.license), qualityFlags: list(d?.quality_flags), duplicateOf: list(d?.duplicate_of, 20, (x) => str(typeof x === 'object' ? x?.id : x, 40)),
    //  ⛔ از «مبدأ» فقط شناسهٔ دکان و زمانِ اجازه — شناسهٔ کسی که اجازه داد نه
    origin: d?.origin && typeof d.origin === 'object' ? { shopId: str(d.origin.shop_id, 80), consentAt: numOr(d.origin.consent_at) } : null,
    product: product(d?.product), batchId: str(d?.batch_id, 40), reviewNote: str(d?.review_note, 500),
    versions: (Array.isArray(d?.versions) ? d.versions : []).slice(0, 50).map((v) => ({
      version: numOr(v?.version), kind: str(v?.kind, 20), review: str(v?.review, 20), mime: MIMES.includes(v?.mime) ? v.mime : '',
      size: numOr(v?.size), width: numOr(v?.width), height: numOr(v?.height), orientation: numOr(v?.orientation),
      hash: /^[0-9a-f]{64}$/.test(String(v?.hash || '')) ? v.hash : '', urls: urls(v?.urls),
    })),
  };
}

export function shapeSearchItem(it) {
  return {
    product: product(it?.product),
    match: it?.match && typeof it.match === 'object' ? { kind: str(it.match.kind, 30), certain: it.match.certain === true, reasons: list(it.match.reasons) } : null,
    ambiguous: it?.ambiguous === true, distinguish: list(it?.distinguish),
    images: (Array.isArray(it?.images) ? it.images : []).slice(0, 6).map((im) => ({
      id: str(im?.id, 40), role: str(im?.role, 20), version: numOr(im?.version), space: str(im?.space, 20), status: str(im?.status, 20),
      licenseStatus: str(im?.license_status, 20), urls: urls(im?.urls),
    })),
  };
}

/** فقط پارامترهای شناخته، کوتاه‌شده — نه querystring ِ دلخواه */
function pick(q, keys) {
  const out = {};
  for (const k of keys) {
    const v = q?.[k];
    if (v === undefined || v === null || v === '' || typeof v !== 'string') continue;
    out[k] = v.slice(0, 100);
  }
  return out;
}

/**
 * @param {import('express').Router} router  همان روترِ ‎account-admin.js‎
 * @param {{ guard: Function, badInput: Function, actorOf: Function }} d
 */
export function mountConsoleImageBank(router, { guard, badInput, actorOf, capListed }) {
  const once = makeIdemOnce();
  const viaServer = makeUpstreamOnce();
  const writeLimit = rateLimit({ name: 'console-image-bank-write', max: 120, windowMs: 10 * 60_000, key: (req) => `u${req.user?.id ?? 'x'}` });
  const read = requireModule('imagebank');
  const imgId = (v) => {
    const s = String(v ?? '');
    if (!IMG_ID.test(s)) throw badInput('bad_id', 'شناسهٔ عکس معتبر نیست');
    return s;
  };

  router.get('/console/image-bank/status', read, guard(async (req, res) => {
    const s = await cloudRaw('GET', `${BASE}/status`);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      available: true, fetchedAt: Date.now(), enabled: s?.enabled === true,
      roles: list(s?.roles, 20, (x) => str(x, 20)), licenses: list(s?.licenses, 20, (x) => str(x, 20)),
      rowsMax: numOr(s?.rows_max), resume: s?.resume === true,
    });
  }));

  router.get('/console/image-bank/review', read, guard(async (req, res) => {
    const q = pick(req.query, ['status', 'space', 'cursor', 'limit']);
    if (q.status && !STATUSES.includes(q.status)) throw badInput('bad_status', 'وضعیت درست نیست');
    if (q.space && !['pending', 'central'].includes(q.space)) throw badInput('bad_space', 'فضا درست نیست');
    const out = await cloudRaw('GET', `${BASE}/review`, { query: q });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ available: true, fetchedAt: Date.now(), items: (Array.isArray(out?.items) ? out.items : []).slice(0, 50).map(shapeReviewItem),
      nextCursor: IMG_ID.test(String(out?.next_cursor || '')) ? out.next_cursor : null });
  }));

  router.get('/console/image-bank/search', read, guard(async (req, res) => {
    const q = pick(req.query, ['q', 'barcode', 'sku', 'brand', 'category', 'packaging', 'has_image', 'cursor', 'limit']);
    const out = await cloudRaw('GET', `${BASE}/search`, { query: q });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ available: true, fetchedAt: Date.now(), items: (Array.isArray(out?.items) ? out.items : []).slice(0, 50).map(shapeSearchItem),
      nextCursor: /^[A-Za-z0-9_-]{1,200}$/.test(String(out?.next_cursor || '')) ? out.next_cursor : null,
      asOf: numOr(out?.as_of), barcodeValid: typeof out?.barcode_valid === 'boolean' ? out.barcode_valid : null });
  }));

  router.get('/console/image-bank/images/:id', read, guard(async (req, res) => {
    const id = imgId(req.params.id);
    const out = await cloudRaw('GET', `${BASE}/images/${id}`);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ available: true, fetchedAt: Date.now(), image: shapeDetail(out) });
  }));

  router.get('/console/image-bank/reports', read, guard(async (req, res) => {
    const q = pick(req.query, ['status', 'limit']);
    if (q.status && !['open', 'resolved', 'dismissed'].includes(q.status)) throw badInput('bad_status', 'وضعیت درست نیست');
    const out = await cloudRaw('GET', `${BASE}/reports`, { query: q });
    res.json({ available: true, fetchedAt: Date.now(), items: (Array.isArray(out?.items) ? out.items : []).slice(0, 50).map((r) => ({
      id: str(r?.id, 40), imageId: str(r?.image_id, 40), kind: str(r?.kind, 30), note: str(r?.note, 500), status: str(r?.status, 20), createdAt: numOr(r?.created_at),
    })) });
  }));

  router.get('/console/image-bank/file/:id/:version/:size', read, guard(async (req, res) => {
    const id = imgId(req.params.id);
    const version = String(req.params.version || '');
    const size = String(req.params.size || '');
    if (!/^\d{1,6}$/.test(version) || Number(version) < 1) throw badInput('bad_version', 'نسخه درست نیست');
    if (!SIZES.includes(size)) throw badInput('bad_size', 'اندازه درست نیست');
    //  ⏱️ مهلتِ عادی: عکسِ بانک چند مگابایت بیشتر نیست و بندانگشتیِ گیرکرده نباید صفحه را نگه دارد
    const { buffer, contentType } = await cloudRawBytes('GET', `${BASE}/file/${id}/${version}/${size}`, { timeout: 'normal' });
    const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
    if (!MIMES.includes(mime)) throw Object.assign(new Error('این پرونده عکسِ شناخته نیست'), { code: 'unsupported_media', status: 415 });
    res.setHeader('Content-Type', mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.end(buffer);
  }));

  for (const act of ['approve', 'reject', 'archive', 'search']) {
    router.post(`/console/image-bank/images/:id/${act}`, requireRole('admin'), writeLimit, guard(async (req, res) => {
      const id = imgId(req.params.id);
      if (req.body?.confirm !== true) throw badInput('confirm_required', 'این کار پیش از فرستادن تأیید می‌خواهد');
      const reason = str(req.body?.reason, 400).trim();
      if (reason.length < 3 || reason.length > 200) throw badInput('reason_required', 'دلیل را بنویسید (۳ تا ۲۰۰ نویسه) — در دفترِ پنل و سرورِ حساب می‌ماند');
      const v = req.body?.version;
      if (v !== undefined && v !== null && !(Number.isInteger(v) && v >= 1 && v <= 100000)) throw badInput('bad_version', 'نسخه درست نیست');
      if (act === 'search' && typeof req.body?.enabled !== 'boolean') throw badInput('enabled_required', 'روشن یا خاموش را بگویید');
      const body = { reason, ...(act === 'search' ? { enabled: req.body.enabled } : {}), ...(Number.isInteger(v) && act !== 'archive' && act !== 'search' ? { version: v } : {}) };
      const key = checkIdemKey(req.body?.idempotencyKey);
      const finish = (r, { record, resolved }) => {
        if (record) {
          audit({ actor: actorOf(req), action: `account.image_bank.${act}`, entity: 'bank_image', entityId: id,
            detail: { reason, ...(act === 'search' ? { enabled: body.enabled } : {}), ...(body.version ? { version: body.version } : {}), ...(resolved ? { resolved: true } : {}) } });
        }
        return {
          ok: true, act, id: str(r?.id, 40) || id, status: str(r?.status, 20) || null, version: numOr(r?.version ?? r?.current_version),
          ...(act === 'search' ? { searchEnabled: typeof r?.search_enabled === 'boolean' ? r.search_enabled : null } : {}), confirmedAt: Date.now(),
        };
      };
      const out = (await serverPathFor(req, key, { once, viaServer, capable: () => capListed('idempotent-writes.v1') }))
        ? await viaServer(req, key, (headers) => cloudRaw('POST', `${BASE}/images/${id}/${act}`, { body, headers, replayFlag: true }), finish)
        : await once(req, key, `${act}|${id}|${JSON.stringify(body)}`, `image:${id}`,
          async () => finish(await cloudRaw('POST', `${BASE}/images/${id}/${act}`, { body }), { record: true }));
      res.json(out);
    }));
  }
}
