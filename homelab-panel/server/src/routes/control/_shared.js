// ---------------------------------------------------------------------------
//  ابزارهای مشترکِ مسیرهای مرکز فرمان
// ---------------------------------------------------------------------------
import { getProject } from '../../control/models.js';
import { auditFromReq } from '../../control/audit.js';

/** خطای تمیز و یکدست به سمت رابط کاربری */
export function fail(res, status, error, detail = null) {
  return res.status(status).json({ error, ...(detail ? { detail } : {}) });
}

/** بدنهٔ درخواست را با یک تابعِ سنجش پاس می‌دهد؛ خطاها با پیامِ روشن برمی‌گردند */
export function guard(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (e) {
      const known = {
        name_required: 400,
        value_required: 400,
        project_required: 400,
        version_required: 400,
        invalid_type: 400,
        invalid_kind: 400,
        invalid_scope: 400,
        invalid_platform: 400,
        invalid_environment: 400,
        invalid_path: 400,
        confirmation_required: 400,
        config_must_be_object: 400,
        not_found: 404,
        target_server_not_found: 404,
        same_server: 409,
        port_conflict: 409,
        hostname_taken: 409,
        file_outside_project: 400,
        file_not_found: 404,
      };
      const status = known[e.message] || 500;
      if (status === 500) {
        // خطاهای غیرمنتظره در دفترِ رخداد می‌مانند تا بعداً پیدا شوند
        auditFromReq(req, 'error', { entity: req.path, result: 'error', detail: { message: e.message } });
      }
      return fail(res, status, e.message, e.detail || null);
    }
  };
}

/** پروژه را از مسیر برمی‌دارد و در req می‌گذارد — مرزِ همهٔ کارهای پروژه‌ای */
export function withProject(req, res, next) {
  const project = getProject(req.params.projectId ?? req.params.id);
  if (!project) return fail(res, 404, 'project_not_found');
  req.project = project;
  next();
}

export function actorOf(req) {
  return req?.user?.username || 'admin';
}

/**
 * عددِ درست یا fallback.
 * ⚠️ Number(null) و Number('') هر دو صفر می‌دهند؛ اگر جلویشان را نگیریم،
 * یک server_id خالی به صفر تبدیل می‌شود و کلیدِ خارجی می‌شکند.
 */
export function num(v, fallback = null) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function bool(v, fallback = false) {
  if (v === true || v === 'true' || v === 1 || v === '1') return true;
  if (v === false || v === 'false' || v === 0 || v === '0') return false;
  return fallback;
}

export function str(v, max = 500) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

/* ------------------------- محدودکنندهٔ نرخِ درخواست ---------------------- */

const buckets = new Map();

/**
 * سقفِ ساده و در حافظه. برای پنلِ تک‌کاربره کافی است و جلوی حلقه‌های خراب و
 * تلاشِ پی‌درپی روی مسیرهای حساس را می‌گیرد.
 */
export function rateLimit({ windowMs = 60000, max = 60, key = (req) => req.ip } = {}) {
  return (req, res, next) => {
    const id = `${req.baseUrl}${req.path}:${key(req)}`;
    const now = Date.now();
    let bucket = buckets.get(id);
    if (!bucket || now - bucket.start > windowMs) {
      bucket = { start: now, count: 0 };
      buckets.set(id, bucket);
    }
    bucket.count++;
    if (bucket.count > max) {
      res.setHeader('Retry-After', Math.ceil((bucket.start + windowMs - now) / 1000));
      return fail(res, 429, 'too_many_requests');
    }
    // نگه‌داشتنِ اندازهٔ نقشه در حدِ معقول
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (now - v.start > windowMs) buckets.delete(k);
    }
    next();
  };
}

/** IP واقعیِ درخواست (پشتِ تونل هم درست است) */
export function clientIp(req) {
  return (
    String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '')
      .split(',')[0]
      .trim() || req.socket?.remoteAddress || null
  );
}
