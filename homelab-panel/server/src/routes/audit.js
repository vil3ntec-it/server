// ---------------------------------------------------------------------------
//  دفترِ رخدادِ یکپارچه — «چه کسی، کِی، چه کاری، روی چه، با چه نتیجه‌ای»
//  (فاز ۱ ِ ممیزی، ۶-۷ / S9 — ۱۴۰۵/۰۸/۰۹)
//
//  ⛔ مسئله: سه دفترِ جدا بود و هیچ‌کدام همه را نشان نمی‌داد:
//     • `audit_log`  (lib/audit.js)     کارهای حساسِ پنل: ورود، دوعاملی، احرازِ دوباره، پلتفرم
//     • `cc_audit`   (control/audit.js) کاربرانِ پنل، مرکز فرمان، پلِ سرورِ حساب، بازیابیِ مالک
//     • `audit_logs` ِ سرورِ حساب        کارهایی که روی خودِ سرورِ حساب شده (از جمله `/admin/`)
//  این‌جا یک فهرست با صفحه‌بندیِ **سمتِ سرور**، فقط‌خواندنی: هیچ درِ نوشتن یا
//  پاک کردنی ندارد (همان قاعدهٔ برنامه: «همان حساب نتواند پاکش کند»).
//
//  ⚠️ دو دفترِ پنل در یک SQLite‌اند، پس با `UNION ALL` و `LIMIT/OFFSET` ِ واقعی
//  صفحه می‌خورند. دفترِ سرورِ حساب فقط «۵۰۰ ردیفِ آخر» می‌دهد (`/api/admin/audit`
//  نه offset دارد نه شمارِ کل)؛ پس از آن ۵۰۰ ردیف صفحه‌بندی می‌شود و پاسخ
//  `capped: true` می‌گوید — نه عددِ ساختگی. سرورِ حسابِ در دسترس‌نبوده
//  `sources.account.ok=false` با دلیل است، نه فهرستِ خالیِ بی‌صدا.
//
//  فقط `admin`: دفتر IP و کارِ همهٔ آدم‌ها را دارد.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { requireRole } from '../control/roles.js';
import { db } from '../db.js';
import { cloudRaw } from '../stations/cloud.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

const SOURCES = ['all', 'panel', 'account'];
const MAX_WINDOW = 5000;
const ACCOUNT_CAP = 500;

const int = (v, d, min, max) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};

function hasTable(name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

/** دو دفترِ پنل، یک شکل */
function panelUnion() {
  const parts = [];
  if (hasTable('audit_log')) {
    parts.push(`SELECT 'sensitive' AS book, id, at, actor, action, target,
        CASE WHEN ok = 1 THEN 'ok' ELSE 'failed' END AS result, ip, detail FROM audit_log`);
  }
  if (hasTable('cc_audit')) {
    parts.push(`SELECT 'control' AS book, id, at, actor, action,
        CASE WHEN entity IS NOT NULL AND entity_id IS NOT NULL THEN entity || ':' || entity_id
             ELSE COALESCE(entity, entity_id) END AS target,
        result, ip, detail FROM cc_audit`);
  }
  return parts.length ? parts.join(' UNION ALL ') : null;
}

function panelWhere({ q, result, actor }) {
  const where = [];
  const args = [];
  if (q) {
    where.push('(action LIKE ? OR actor LIKE ? OR target LIKE ? OR detail LIKE ?)');
    const like = `%${q}%`;
    args.push(like, like, like, like);
  }
  if (result === 'ok') where.push("result = 'ok'");
  if (result === 'failed') where.push("result <> 'ok'");
  if (actor) {
    where.push('actor LIKE ?');
    args.push(`%${actor}%`);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}

function panelPage(filters, limit, offset) {
  const union = panelUnion();
  if (!union) return { rows: [], total: 0 };
  const { sql, args } = panelWhere(filters);
  const rows = db
    .prepare(`SELECT * FROM (${union}) ${sql} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset)
    .map((r) => ({
      source: 'panel',
      book: r.book,
      id: `${r.book === 'sensitive' ? 'a' : 'c'}${r.id}`,
      at: Number(r.at),
      actor: r.actor,
      action: r.action,
      target: r.target ?? null,
      result: r.result,
      ip: r.ip ?? null,
      detail: r.detail ?? null,
    }));
  const total = db.prepare(`SELECT COUNT(*) AS n FROM (${union}) ${sql}`).get(...args).n;
  return { rows, total };
}

function accountRow(r) {
  const at = Number(r.created_at ?? r.createdAt ?? 0);
  const detail = r.detail == null ? null : typeof r.detail === 'string' ? r.detail : JSON.stringify(r.detail);
  const actor = [r.actor_type ?? r.actorType, r.user_id ?? r.userId].filter((x) => x != null && x !== '').join(':');
  const target = [r.target_type ?? r.targetType, r.target_id ?? r.targetId].filter((x) => x != null && x !== '').join(':');
  return {
    source: 'account',
    book: 'account',
    id: `s${r.id}`,
    at: Number.isFinite(at) ? at : 0,
    actor: actor || 'account',
    action: String(r.action ?? ''),
    target: target || null,
    result: 'ok',
    ip: r.ip ?? null,
    detail: detail ? detail.slice(0, 2000) : null,
    shopId: r.shop_id ?? r.shopId ?? null,
  };
}

async function accountWindow(filters, n) {
  const want = Math.min(ACCOUNT_CAP, Math.max(1, n));
  try {
    const out = await cloudRaw('GET', '/api/admin/audit', { query: { limit: want } });
    const raw = Array.isArray(out?.entries) ? out.entries : Array.isArray(out?.audit) ? out.audit : [];
    const q = (filters.q || '').toLowerCase();
    const rows = raw.map(accountRow).filter((r) => {
      if (filters.result === 'failed') return false;
      if (filters.actor && !r.actor.toLowerCase().includes(filters.actor.toLowerCase())) return false;
      if (!q) return true;
      return [r.action, r.actor, r.target, r.detail].some((x) => String(x || '').toLowerCase().includes(q));
    });
    return { ok: true, rows, capped: raw.length >= want };
  } catch (e) {
    return { ok: false, rows: [], error: e.code || 'unavailable', message: String(e.message || '').slice(0, 300) };
  }
}

router.get('/', async (req, res) => {
  const source = SOURCES.includes(String(req.query.source)) ? String(req.query.source) : 'all';
  const limit = int(req.query.limit, 50, 1, 200);
  const offset = int(req.query.offset, 0, 0, MAX_WINDOW);
  const filters = {
    q: req.query.q ? String(req.query.q).slice(0, 80) : '',
    result: ['ok', 'failed'].includes(String(req.query.result)) ? String(req.query.result) : '',
    actor: req.query.actor ? String(req.query.actor).slice(0, 60) : '',
  };
  const sources = {};
  let rows = [];
  let total = 0;

  if (source === 'panel') {
    const p = panelPage(filters, limit, offset);
    sources.panel = { ok: true, total: p.total };
    rows = p.rows;
    total = p.total;
  } else if (source === 'account') {
    const a = await accountWindow(filters, offset + limit);
    sources.account = a.ok ? { ok: true, total: a.rows.length, capped: a.capped } : { ok: false, error: a.error, message: a.message };
    rows = a.rows.slice(offset, offset + limit);
    total = a.rows.length;
  } else {
    //  «همه»: از هر دفتر همان `offset + limit` ِ تازه‌ترین، ادغام به ترتیبِ زمان، و برش
    const n = Math.min(MAX_WINDOW, offset + limit);
    const p = panelPage(filters, n, 0);
    const a = await accountWindow(filters, n);
    sources.panel = { ok: true, total: p.total };
    sources.account = a.ok ? { ok: true, total: a.rows.length, capped: a.capped } : { ok: false, error: a.error, message: a.message };
    rows = [...p.rows, ...a.rows].sort((x, y) => y.at - x.at).slice(offset, offset + limit);
    total = p.total + a.rows.length;
  }

  res.setHeader('Cache-Control', 'no-store');
  res.json({ rows, total, limit, offset, source, sources, generatedAt: Date.now() });
});

/* ⛔ فقط‌خواندنی: هیچ نوشتن، ویرایش یا پاک کردنی از این در نیست */
router.all('*', (req, res) => res.status(405).json({ error: 'read_only' }));

export default router;
