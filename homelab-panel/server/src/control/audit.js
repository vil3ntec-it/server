// ---------------------------------------------------------------------------
//  دفترِ رخدادها — «چه کسی، چه کاری، کِی، روی چه چیزی، با چه نتیجه‌ای»
//  هر تغییرِ مهم اینجا می‌ماند. رمز و توکن هرگز نوشته نمی‌شود.
// ---------------------------------------------------------------------------
import { clientIp } from '../platform/security.js';
import { db } from '../db.js';
import { archiveAndPrune } from '../lib/audit-archive.js';

/** کلیدهایی که اگر در detail باشند، مقدارشان نوشته نمی‌شود */
//  ‎serviceAccount‎ (۱.۵۱.۲): کلیدِ Firebase ِ «اعلانِ گوشی» — درِ خودش آن را در دفتر نمی‌گذارد؛ این کمربندِ دوم است
const SENSITIVE = /^(password|pass|pwd|otp|token|secret|api[_-]?key|authorization|cookie|private[_-]?key|service[_-]?account|value)$/i;

export function scrub(value, depth = 0) {
  if (value == null || depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE.test(k) ? '••••••••' : scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function audit({ actor = 'system', action, entity = null, entityId = null, projectId = null, detail = null, result = 'ok', ip = null }) {
  try {
    db.prepare(
      'INSERT INTO cc_audit(actor, action, entity, entity_id, project_id, detail, result, ip, at) VALUES(?,?,?,?,?,?,?,?,?)'
    ).run(
      String(actor).slice(0, 100),
      String(action).slice(0, 80),
      entity ? String(entity).slice(0, 60) : null,
      entityId != null ? String(entityId).slice(0, 60) : null,
      projectId != null ? Number(projectId) : null,
      detail == null ? null : JSON.stringify(scrub(detail)).slice(0, 4000),
      String(result).slice(0, 40),
      ip ? String(ip).slice(0, 60) : null,
      Date.now()
    );
  } catch {
    /* دفترِ رخداد نباید کارِ اصلی را بخواباند */
  }
}

/**
 * چند ردیف با هم — **همه یا هیچ** (یک تراکنشِ SQLite). برای کارِ دسته‌ای که هر جزئش ردیفِ خودش را می‌خواهد
 * (پرچم‌های فروشگاه، ۱.۵۱.۱): دفتر هرگز نیمی از یک دسته را نشان نمی‌دهد. همان شکل و همان `scrub` ِ `audit`.
 * @returns {boolean} نوشته شد؟ (مثلِ `audit`، شکستِ دفتر کارِ اصلی را نمی‌خواباند)
 */
export function auditMany(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return true;
  const at = Date.now();
  try {
    const st = db.prepare('INSERT INTO cc_audit(actor, action, entity, entity_id, project_id, detail, result, ip, at) VALUES(?,?,?,?,?,?,?,?,?)');
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const { actor = 'system', action, entity = null, entityId = null, projectId = null, detail = null, result = 'ok', ip = null } of list) {
        st.run(
          String(actor).slice(0, 100),
          String(action).slice(0, 80),
          entity ? String(entity).slice(0, 60) : null,
          entityId != null ? String(entityId).slice(0, 60) : null,
          projectId != null ? Number(projectId) : null,
          detail == null ? null : JSON.stringify(scrub(detail)).slice(0, 4000),
          String(result).slice(0, 40),
          ip ? String(ip).slice(0, 60) : null,
          at
        );
      }
      db.exec('COMMIT');
      return true;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* تراکنش خودش بسته شد */ }
      throw e;
    }
  } catch {
    return false;
  }
}

/** میان‌افزار: از روی درخواست، کاربر و IP را برمی‌دارد */
export function auditFromReq(req, action, extra = {}) {
  audit({
    actor: req?.user?.username || 'unknown',
    ip: clientIp(req),
    action,
    ...extra,
  });
}

export function listAudit({ limit = 200, offset = 0, projectId = null, action = null, q = null } = {}) {
  const where = [];
  const args = [];
  if (projectId != null) {
    where.push('project_id = ?');
    args.push(Number(projectId));
  }
  if (action) {
    where.push('action = ?');
    args.push(action);
  }
  if (q) {
    where.push('(action LIKE ? OR entity LIKE ? OR actor LIKE ? OR detail LIKE ?)');
    const like = `%${q}%`;
    args.push(like, like, like, like);
  }
  const sql = `SELECT * FROM cc_audit ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(...args, Math.min(1000, Number(limit) || 200), Number(offset) || 0);
  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM cc_audit ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`)
    .get(...args).n;
  return { rows, total };
}

//  ⛔ هرس با بایگانیِ پیشین — همان قاعدهٔ `lib/audit.js` (۱.۵۰.۷۱، S9)
export function pruneAudit(keep = 20000) {
  try {
    archiveAndPrune(db, 'cc_audit', keep);
  } catch { /* بایگانی نشد ⇒ پاک هم نشد؛ دورِ بعد */ }
}
