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
//     + ردیفِ دفترِ پنل.
//  ⛔ (۱.۵۰.۸۸، تصمیمِ ۳-۹ «الف») بارگذاری، ورودِ گروهی (CSV) و ویرایشِ کالای بانک هم این‌جا — همان درهای موجودِ shop،
//     تا همهٔ کارِ مدیر در پنل بماند و ‎/admin/‎ (۲-۱۸) بسته‌شدنی شود:
//       POST  /console/image-bank/products · PATCH /console/image-bank/products/:id      ⇐ همان (کالای بانک)
//       POST  /console/image-bank/images?role&bankProductId&license…  (بایتِ خام)         ⇐ POST /api/admin/image-bank/images
//       PATCH /console/image-bank/images/:id                                               ⇐ همان (نقش، کالا، مجوزِ pending)
//       GET   /console/image-bank/batches · POST /console/image-bank/batches               ⇐ همان (دسته)
//       PUT   /console/image-bank/batches/:id/files/:name   (بایتِ خام) · GET …/files     ⇐ همان
//       POST  /console/image-bank/batches/:id/rows {csv|rows, dryRun} · POST …/status       ⇐ همان
//       GET   /console/image-bank/batches/:id/report[?format=csv]                         ⇐ همان
//     هر نوشتن: admin ِ پنل + سقفِ نرخِ هر کاربر + ردیفِ دفترِ پنل. بایت: فقط عکسِ رسترِ شناخته از روی **بایت‌های نخست**
//     (JPEG/PNG/WebP/GIF/AVIF — نه SVG/HTML) و تا همان سقفِ ۲ مگابایتِ سرورِ حساب، با ‎X-Content-SHA256‎ ِ پل (درستی پس از تونل؛
//     ‎X-Content-SHA256‎ ِ نادرستِ مرورگر ⇒ ‎400 digest_mismatch‎). ساختِ کالا و بارگذاریِ تک‌عکس کلیدِ یکتاییِ رابط می‌خواهند
//     (`makeIdemOnce`؛ کلیکِ دوم کالای دوم/عکسِ دوم نمی‌سازد)؛ فایلِ دسته و ردیف‌ها آن‌جا خودشان تکرارپذیرند. لغو/پایانِ دسته
//     تأیید و لغو دلیل هم می‌خواهد (عکس‌های بررسی‌نشدهٔ دسته رد می‌شوند). سنجشِ بارکد، تطبیق و مجوز همان سرورِ حساب است.
//     کلید (۱.۵۰.۷۷): سرورِ حسابِ با `idempotent-writes.v1` ⇒ کلیدِ پنجره بسته به کاربرِ پنل بالا می‌رود (`makeUpstreamOnce`)؛
//     بی آن همان یادِ حافظهٔ پل. راهِ هر کلید ثابت است (۱.۵۰.۷۸، `serverPathFor`).
// ---------------------------------------------------------------------------
import * as panelRoles from '../control/roles.js';
import { audit } from '../control/audit.js';
import crypto from 'node:crypto';
import express from 'express';
import { cloudRaw, cloudRawBytes, cloudRawText } from '../stations/cloud.js';
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
const ROLES = ['main', 'back', 'label', 'variant', 'promo', 'detail'];
const LICENSES = ['unknown', 'licensed', 'restricted', 'denied'];
const BATCH_STATUSES = ['open', 'paused', 'cancelled', 'done'];
const ROW_FIELDS = ['product_id', 'barcode', 'sku', 'name', 'brand', 'category', 'variant', 'size', 'unit', 'pack_count', 'packaging',
  'image_path', 'image_filename', 'image_role', 'license_source', 'license_status', 'alt_names', 'row_no'];
export const BANK_UPLOAD_MAX = 2 * 1024 * 1024;     //  همان ‎INBOX_MAX_BYTES‎ ِ سرورِ حساب (اصلِ عکسِ بانک)
export const BANK_ROWS_MAX = 1000;                  //  همان ‎ROWS_MAX‎
export const BANK_CSV_MAX = 2 * 1024 * 1024;        //  همان ‎CSV_MAX_CHARS‎

/** نوعِ عکس از روی بایت‌های نخست — نه از سرآیندِ مرورگر */
export function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return '';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (/^GIF8[79]a/.test(buf.toString('latin1', 0, 6))) return 'image/gif';
  if (buf.toString('latin1', 4, 8) === 'ftyp' && /^avi[fs]$/.test(buf.toString('latin1', 8, 12))) return 'image/avif';
  return '';
}

/** نامِ فایلِ دسته: یک تکه، بی جداکنندهٔ مسیر/نویسهٔ کنترلی، تا ۲۰۰ نویسه (همان ‎baseName‎ ِ سرورِ حساب) */
export function batchFileName(v) {
  const s = String(v ?? '');
  // eslint-disable-next-line no-control-regex
  if (!s || s.length > 200 || /[\\/\u0000-\u001f\u007f]/.test(s) || s === '.' || s === '..' || s.includes('..')) return '';
  return s;
}

const str = (v, max = 120) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '');
const numOr = (v) => (v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);
const list = (v, max = 20, each = (x) => str(x, 60)) => (Array.isArray(v) ? v.slice(0, max).map(each).filter((x) => x !== '' && x !== null) : []);

/** نشانیِ فایلِ بالادست ⇒ درِ همین پل؛ هر چیزِ دیگر ⇒ null */
export function fileLink(u) {
  const m = /^\/api\/admin\/image-bank\/file\/([A-Za-z0-9_-]{1,40})\/(\d{1,6})\/([a-z]{1,12})$/.exec(String(u || ''));
  return m && SIZES.includes(m[3]) ? `${PANEL}/file/${m[1]}/${m[2]}/${m[3]}` : null;
}
const urls = (o) => Object.fromEntries(SIZES.map((s) => [s, fileLink(o?.[s])]));

/** ورودیِ کالای بانک ⇒ همان نام‌های سرورِ حساب (‎productInput‎)؛ فقط فیلدهای شناخته و کوتاه‌شده */
function productBody(b, badInput, { partial = false } = {}) {
  const name = str(b?.name, 200).trim();
  if (!partial && !name) throw badInput('name_required', 'نامِ کالا لازم است');
  const out = {};
  const put = (k, v) => { if (v !== undefined && v !== null && v !== '') out[k] = v; };
  put('name', name);
  const gtin = str(b?.gtin ?? b?.barcode, 32).trim();
  if (gtin && !/^\d{8,14}$/.test(gtin.replace(/[\s-]/g, ''))) throw badInput('bad_gtin', 'بارکد فقط رقم است (۸ تا ۱۴ رقم)');
  put('gtin', gtin.replace(/[\s-]/g, ''));
  put('sku', str(b?.sku, 64).trim());
  const alt = Array.isArray(b?.altNames) ? b.altNames : Array.isArray(b?.alt_names) ? b.alt_names : [];
  const altNames = alt.slice(0, 20).map((x) => str(x, 200).trim()).filter(Boolean);
  if (altNames.length) out.alt_names = altNames;
  for (const [k, from, max] of [['brand', 'brand', 100], ['category', 'category', 100], ['variant', 'variant', 100],
    ['size_value', 'sizeValue', 20], ['size_unit', 'sizeUnit', 20], ['packaging', 'packaging', 100]]) {
    put(k, str(b?.[from] ?? b?.[k], max).trim());
  }
  const pc = b?.packCount ?? b?.pack_count;
  if (pc !== undefined && pc !== null && pc !== '') {
    if (!Number.isInteger(pc) || pc < 0 || pc > 100000) throw badInput('bad_pack_count', 'شمارِ بسته عددِ ۰ تا ۱۰۰٬۰۰۰ است');
    out.pack_count = pc;
  }
  return out;
}

/** مجوز و نقش (بارگذاری، ویرایشِ pending، دسته) ⇒ نام‌های سرورِ حساب؛ مقدارِ ناشناخته ⇒ ‎400‎ */
function licenseFields(b, badInput) {
  const out = {};
  const role = b?.role;
  if (role !== undefined && role !== null && role !== '') {
    if (!ROLES.includes(role)) throw badInput('bad_role', 'نقشِ عکس درست نیست');
    out.role = role;
  }
  for (const [k, from, max] of [['license_source', 'licenseSource', 120], ['license_holder', 'licenseHolder', 120], ['license_type', 'licenseType', 64]]) {
    const v = b?.[from];
    if (v !== undefined && v !== null) out[k] = str(String(v), max).trim();
  }
  const ls = b?.licenseStatus;
  if (ls !== undefined && ls !== null && ls !== '') {
    if (!LICENSES.includes(ls)) throw badInput('bad_license', 'وضعیتِ مجوز درست نیست');
    out.license_status = ls;
  }
  const cu = b?.commercialUse;
  if (cu !== undefined && cu !== null && cu !== '') {
    const v = cu === true || cu === 'true' || cu === '1' ? true : cu === false || cu === 'false' || cu === '0' ? false : null;
    if (v === null) throw badInput('bad_commercial_use', 'استفادهٔ تجاری بله یا نه است');
    out.commercial_use = v;
  }
  return out;
}

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

  mountImageBankWrites(router, { guard, badInput, actorOf, read, imgId, once });
}

/* ════════════════ ۳-۹ (۱.۵۰.۸۸): بارگذاری، ورودِ گروهی و ویرایشِ کالای بانک ════════════════ */

/** بدنهٔ خامِ عکس تا سقفِ بانک (پیش از بافر کردن ⇒ ‎413‎) */
function rawImage(req, res, next) {
  const len = Number(req.headers['content-length']);
  if (Number.isFinite(len) && len > BANK_UPLOAD_MAX) return res.status(413).json({ error: 'too_large', message: 'عکس بزرگ‌تر از ۲ مگابایت است' });
  express.raw({ type: () => true, limit: BANK_UPLOAD_MAX })(req, res, (err) => {
    if (err) {
      const big = err.type === 'entity.too.large';
      return res.status(big ? 413 : 400).json({ error: big ? 'too_large' : 'bad_media', message: big ? 'عکس بزرگ‌تر از ۲ مگابایت است' : 'فایل درست نرسید' });
    }
    next();
  });
}

function imageBytes(req, badInput) {
  const buf = Buffer.isBuffer(req.body) ? req.body : null;
  const mime = sniffImage(buf);
  if (!mime) throw badInput('bad_media', 'فقط عکسِ JPEG، PNG، WebP، GIF یا AVIF (از روی خودِ فایل سنجیده شد)');
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const claimed = String(req.headers['x-content-sha256'] || '').trim().toLowerCase();
  if (claimed && claimed !== sha256) throw badInput('digest_mismatch', 'فایل درست نرسید (sha256 جور نیست) — دوباره بفرستید');
  return { buf, mime, sha256 };
}

const batchShape = (b) => ({
  id: str(b?.id, 40), status: BATCH_STATUSES.includes(b?.status) ? b.status : str(b?.status, 20), note: str(b?.note, 500),
  licenseSource: str(b?.license_source, 120), licenseStatus: str(b?.license_status, 20),
  commercialUse: typeof b?.commercial_use === 'boolean' ? b.commercial_use : null,
  files: numOr(b?.files), filesFailed: numOr(b?.files_failed), rows: numOr(b?.rows), rowsFailed: numOr(b?.rows_failed), rowsAmbiguous: numOr(b?.rows_ambiguous),
  createdAt: numOr(b?.created_at), updatedAt: numOr(b?.updated_at),
});
const rowShape = (r) => ({
  rowNo: numOr(r?.row_no), status: str(r?.status, 20), error: str(r?.error, 60), imageId: str(r?.image_id, 40), productId: str(r?.product_id, 40),
  candidates: (Array.isArray(r?.candidates) ? r.candidates : []).slice(0, 10).map((c) => str(typeof c === 'object' ? c?.id : c, 40)).filter(Boolean),
  ...(r?.replay === true ? { replay: true } : {}),
});
const BATCH_ID = /^[A-Za-z0-9_-]{1,40}$/;

function mountImageBankWrites(router, { guard, badInput, actorOf, read, imgId, once }) {
  const upLimit = rateLimit({ name: 'console-image-bank-upload', max: 600, windowMs: 10 * 60_000, key: (req) => `u${req.user?.id ?? 'x'}` });
  const editLimit = rateLimit({ name: 'console-image-bank-edit', max: 120, windowMs: 10 * 60_000, key: (req) => `u${req.user?.id ?? 'x'}` });
  const batchOf = (v) => {
    const s = String(v ?? '');
    if (!BATCH_ID.test(s)) throw badInput('bad_batch_id', 'شناسهٔ دسته معتبر نیست');
    return s;
  };
  const rec = (req, action, entityId, detail) => audit({ actor: actorOf(req), action: `account.image_bank.${action}`, entity: 'bank_image', entityId, detail });

  /* ── کالای بانک ── */
  router.post('/console/image-bank/products', requireRole('admin'), editLimit, guard(async (req, res) => {
    const body = productBody(req.body, badInput);
    const key = checkIdemKey(req.body?.idempotencyKey);
    res.json(await once(req, key, `product|${JSON.stringify(body)}`, 'bank:product:new', async () => {
      const r = await cloudRaw('POST', `${BASE}/products`, { body });
      const id = str(r?.id, 40);
      rec(req, 'product_created', id, { name: body.name, gtin: body.gtin || '' });
      return { ok: true, id, confirmedAt: Date.now() };
    }));
  }));

  router.patch('/console/image-bank/products/:id', requireRole('admin'), editLimit, guard(async (req, res) => {
    const id = imgId(req.params.id);
    const body = productBody(req.body, badInput);
    await cloudRaw('PATCH', `${BASE}/products/${id}`, { body });
    rec(req, 'product_updated', id, { name: body.name, gtin: body.gtin || '' });
    res.json({ ok: true, id, confirmedAt: Date.now() });
  }));

  /* ── تک‌عکس ── */
  router.post('/console/image-bank/images', requireRole('admin'), upLimit, rawImage, guard(async (req, res) => {
    const { buf, mime, sha256 } = imageBytes(req, badInput);
    const fields = licenseFields(req.query, badInput);
    const bp = req.query?.bankProductId;
    if (bp !== undefined && bp !== '') fields.bank_product_id = imgId(bp);
    const key = checkIdemKey(req.query?.idempotencyKey);
    res.json(await once(req, key, `upload|${sha256}|${JSON.stringify(fields)}`, `bank:upload:${sha256}`, async () => {
      const r = await cloudRawBytes('POST', `${BASE}/images`, { body: buf, contentType: mime, query: fields, sha256, timeout: 'normal' });
      const id = str(r?.id, 40);
      rec(req, 'uploaded', id, { sha256, bytes: buf.length, role: fields.role || '', product: fields.bank_product_id || '',
        duplicateOf: (Array.isArray(r?.duplicate_of) ? r.duplicate_of : []).slice(0, 5).map((x) => str(typeof x === 'object' ? x?.id : x, 40)) });
      return {
        ok: true, id, status: str(r?.status, 20), width: numOr(r?.width), height: numOr(r?.height), sha256,
        qualityFlags: list(r?.quality_flags), duplicateOf: list(r?.duplicate_of, 20, (x) => str(typeof x === 'object' ? x?.id : x, 40)), confirmedAt: Date.now(),
      };
    }));
  }));

  router.patch('/console/image-bank/images/:id', requireRole('admin'), editLimit, guard(async (req, res) => {
    const id = imgId(req.params.id);
    const body = licenseFields(req.body, badInput);
    const bp = req.body?.bankProductId;
    if (bp !== undefined && bp !== null) body.bank_product_id = bp === '' ? '' : imgId(bp);
    if (!Object.keys(body).length) throw badInput('nothing_to_change', 'چیزی برای تغییر نیامد');
    const r = await cloudRaw('PATCH', `${BASE}/images/${id}`, { body });
    rec(req, 'edited', id, body);
    res.json({ ok: true, id, bankProductId: str(r?.bank_product_id, 40), matchStatus: str(r?.match_status, 40), licenseStatus: str(r?.license_status, 20),
      commercialUse: typeof r?.commercial_use === 'boolean' ? r.commercial_use : null, confirmedAt: Date.now() });
  }));

  /* ── ورودِ گروهی ── */
  router.get('/console/image-bank/batches', read, guard(async (req, res) => {
    const out = await cloudRaw('GET', `${BASE}/batches`);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ available: true, fetchedAt: Date.now(), items: (Array.isArray(out?.items) ? out.items : []).slice(0, 30).map(batchShape) });
  }));

  router.post('/console/image-bank/batches', requireRole('admin'), editLimit, guard(async (req, res) => {
    const body = licenseFields(req.body, badInput);
    delete body.role;
    const note = str(req.body?.note, 500).trim();
    if (note) body.note = note;
    const key = checkIdemKey(req.body?.idempotencyKey);
    res.json(await once(req, key, `batch|${JSON.stringify(body)}`, 'bank:batch:new', async () => {
      const r = await cloudRaw('POST', `${BASE}/batches`, { body });
      const id = str(r?.id, 40);
      audit({ actor: actorOf(req), action: 'account.image_bank.batch_created', entity: 'image_batch', entityId: id, detail: body });
      return { ok: true, id, status: str(r?.status, 20) || 'open', confirmedAt: Date.now() };
    }));
  }));

  router.get('/console/image-bank/batches/:id/files', read, guard(async (req, res) => {
    const id = batchOf(req.params.id);
    const q = pick(req.query, ['after', 'limit']);
    const out = await cloudRaw('GET', `${BASE}/batches/${id}/files`, { query: q });
    res.setHeader('Cache-Control', 'no-store');
    const items = (Array.isArray(out?.items) ? out.items : []).slice(0, 1000).map((f) => ({
      name: str(f?.name, 200), status: str(f?.status, 20), error: str(f?.error, 60),
      sha256: /^[0-9a-f]{64}$/.test(String(f?.sha256 || '')) ? String(f.sha256) : '', qualityFlags: list(f?.quality_flags),
    }));
    res.json({ available: true, fetchedAt: Date.now(), items, nextAfter: typeof out?.next_after === 'string' ? str(out.next_after, 200) : null });
  }));

  router.put('/console/image-bank/batches/:id/files/:name', requireRole('admin'), upLimit, rawImage, guard(async (req, res) => {
    const id = batchOf(req.params.id);
    const name = batchFileName(req.params.name);
    if (!name) throw badInput('bad_name', 'نامِ فایل درست نیست');
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buf || !buf.length) throw badInput('bad_media', 'فایل خالی است');
    //  ⛔ نوعِ نادرست را خودِ سرورِ حساب «ناموفق» ِ همان فایل می‌کند (یک فایلِ خراب کلِ دسته را نمی‌خواباند)؛ پل فقط HTML/SVG را نمی‌فرستد
    const mime = sniffImage(buf) || 'application/octet-stream';
    if (/^\s*</.test(buf.toString('utf8', 0, 64))) throw badInput('bad_media', 'این فایل عکس نیست');
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const claimed = String(req.headers['x-content-sha256'] || '').trim().toLowerCase();
    if (claimed && claimed !== sha256) throw badInput('digest_mismatch', 'فایل درست نرسید (sha256 جور نیست) — دوباره بفرستید');
    const r = await cloudRawBytes('PUT', `${BASE}/batches/${id}/files/${encodeURIComponent(name)}`, { body: buf, contentType: mime, sha256, timeout: 'normal' });
    res.json({ ok: true, name: str(r?.name, 200) || name, status: str(r?.status, 20), error: str(r?.error, 60), sha256, qualityFlags: list(r?.quality_flags) });
  }));

  router.post('/console/image-bank/batches/:id/rows', requireRole('admin'), editLimit, guard(async (req, res) => {
    const id = batchOf(req.params.id);
    const dryRun = req.body?.dryRun === true;
    let body;
    if (typeof req.body?.csv === 'string') {
      if (!req.body.csv.trim()) throw badInput('rows_required', 'ردیفی نیامد');
      if (req.body.csv.length > BANK_CSV_MAX) throw badInput('csv_too_large', 'CSV بزرگ‌تر از ۲ مگابایت است');
      body = { csv: req.body.csv, dry_run: dryRun };
    } else if (Array.isArray(req.body?.rows)) {
      if (!req.body.rows.length) throw badInput('rows_required', 'ردیفی نیامد');
      if (req.body.rows.length > BANK_ROWS_MAX) throw badInput('too_many_rows', `حداکثر ${BANK_ROWS_MAX} ردیف در هر درخواست`);
      const rows = req.body.rows.map((r) => {
        const o = {};
        if (r && typeof r === 'object' && !Array.isArray(r)) {
          for (const k of ROW_FIELDS) if (r[k] !== undefined && r[k] !== null && r[k] !== '') o[k] = k === 'row_no' && Number.isInteger(r[k]) ? r[k] : str(String(r[k]), 200);
        }
        return o;
      });
      body = { rows, dry_run: dryRun };
    } else throw badInput('rows_required', 'CSV یا فهرستِ ردیف‌ها لازم است');
    const r = await cloudRaw('POST', `${BASE}/batches/${id}/rows`, { body });
    const counts = {};
    if (r?.counts && typeof r.counts === 'object') for (const [k, v] of Object.entries(r.counts).slice(0, 10)) if (/^[a-z_]{1,20}$/.test(k) && Number.isFinite(Number(v))) counts[k] = Number(v);
    if (!dryRun) audit({ actor: actorOf(req), action: 'account.image_bank.batch_rows', entity: 'image_batch', entityId: id, detail: counts });
    res.json({ ok: true, batchId: str(r?.batch_id, 40) || id, dryRun: r?.dry_run === true, counts,
      rows: (Array.isArray(r?.rows) ? r.rows : []).slice(0, BANK_ROWS_MAX).map(rowShape) });
  }));

  router.post('/console/image-bank/batches/:id/status', requireRole('admin'), editLimit, guard(async (req, res) => {
    const id = batchOf(req.params.id);
    const status = req.body?.status;
    if (!BATCH_STATUSES.includes(status)) throw badInput('bad_status', 'وضعیت: open، paused، cancelled یا done');
    if (req.body?.confirm !== true) throw badInput('confirm_required', 'این کار پیش از فرستادن تأیید می‌خواهد');
    const reason = str(req.body?.reason, 400).trim();
    if (status === 'cancelled' && (reason.length < 3 || reason.length > 200)) {
      throw badInput('reason_required', 'دلیلِ لغو را بنویسید (۳ تا ۲۰۰ نویسه) — عکس‌های بررسی‌نشدهٔ همین دسته رد می‌شوند');
    }
    const r = await cloudRaw('POST', `${BASE}/batches/${id}/status`, { body: { status } });
    audit({ actor: actorOf(req), action: 'account.image_bank.batch_status', entity: 'image_batch', entityId: id,
      detail: { status, ...(reason ? { reason } : {}), rejected: numOr(r?.rejected) ?? 0, ...(r?.unchanged ? { unchanged: true } : {}) } });
    res.json({ ok: true, id, status: str(r?.status, 20) || status, rejected: numOr(r?.rejected) ?? 0, unchanged: r?.unchanged === true, confirmedAt: Date.now() });
  }));

  router.get('/console/image-bank/batches/:id/report', read, guard(async (req, res) => {
    const id = batchOf(req.params.id);
    res.setHeader('Cache-Control', 'no-store');
    if (req.query?.format === 'csv') {
      const { text } = await cloudRawText('GET', `${BASE}/batches/${id}/report`, { query: { format: 'csv' } });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `attachment; filename="batch-${id}-errors.csv"`);
      return res.send(text);
    }
    const r = await cloudRaw('GET', `${BASE}/batches/${id}/report`);
    res.json({ available: true, fetchedAt: Date.now(), id: str(r?.id, 40) || id, status: str(r?.status, 20),
      counts: r?.counts && typeof r.counts === 'object' ? Object.fromEntries(Object.entries(r.counts).slice(0, 10).filter(([k, v]) => /^[a-z_]{1,20}$/.test(k) && Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)])) : {},
      rows: (Array.isArray(r?.rows) ? r.rows : []).slice(0, 2000).map(rowShape),
      files: {
        counts: Object.fromEntries(Object.entries(r?.files?.counts && typeof r.files.counts === 'object' ? r.files.counts : {}).slice(0, 10)
          .filter(([k, v]) => /^[a-z_]{1,20}$/.test(k) && Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)])),
        failed: (Array.isArray(r?.files?.failed) ? r.files.failed : []).slice(0, 2000).map((f) => ({ name: str(f?.name, 200), error: str(f?.error, 60) })),
      } });
  }));
}
