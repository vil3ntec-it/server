// ---------------------------------------------------------------------------
//  برنامه‌ها و سایت‌های دیگر
//
//  ── قرارِ صاحب سامانه ─────────────────────────────────────────────────
//  «این پنل فقط برای شاپ نباشد؛ برنامه‌ها و سایت‌های دیگرم را هم از
//  همین‌جا اداره کنم.»
//
//  از هر برنامه سه چیز دیده می‌شود: بالا هست یا نه، چند نفر آمده‌اند (چند
//  تایشان مهمان)، و چند گفت‌وگوی پشتیبانیِ باز دارد.
//
//  ── چرا سلامت را سرور می‌سنجد ─────────────────────────────────────────
//  اگر گوشیِ مدیر به سایت وصل می‌شد، سایتِ سالمی که پشتِ فیلتر یا روی نتِ
//  ضعیف بود «خراب» نشان داده می‌شد. سرور همیشه همان‌جاست و جوابش یکی است.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { db, getSetting, setSetting } from '../db.js';

const KINDS = ['app', 'site', 'service'];
const STATUSES = ['active', 'paused', 'archived'];

const fail = (message, code) => {
  const e = new Error(message);
  e.code = code;
  return e;
};

function shape(r) {
  return {
    id: String(r.id),
    slug: r.slug,
    title: r.title || '',
    kind: r.kind,
    url: r.url || '',
    healthUrl: r.health_url || '',
    note: r.note || '',
    status: r.status,
    lastCheckAt: r.last_check_at || null,
    //  SQLite بولین ندارد؛ NULL یعنی «هنوز سنجیده نشده»، نه «خراب»
    lastOk: r.last_ok === null || r.last_ok === undefined ? null : Boolean(r.last_ok),
    lastStatus: r.last_status === null ? null : Number(r.last_status),
    lastMs: r.last_ms === null ? null : Number(r.last_ms),
    lastError: r.last_error || '',
    keySet: Boolean(r.api_key_hash),
    keyHint: r.api_key_hint || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(r.visitors !== undefined ? { visitors: Number(r.visitors) } : {}),
    ...(r.guests !== undefined ? { guests: Number(r.guests) } : {}),
    ...(r.threads !== undefined ? { openThreads: Number(r.threads) } : {}),
  };
}

/** slug فقط حروف کوچکِ انگلیسی، رقم و خط تیره — چون در URL و تپشِ بازدید می‌آید */
export function cleanSlug(raw) {
  const s = String(raw || '').trim().toLowerCase()
    .replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (s.length < 2 || s.length > 40) {
    throw fail('نام کوتاه باید بین ۲ تا ۴۰ حرف انگلیسی باشد', 'bad_slug');
  }
  return s;
}

export function listApps({ includeArchived = false } = {}) {
  return db.prepare(`
    SELECT a.*,
           (SELECT COUNT(*) FROM th_visitors v WHERE v.app = a.slug) AS visitors,
           (SELECT COUNT(*) FROM th_visitors v WHERE v.app = a.slug AND v.account_id = '') AS guests,
           (SELECT COUNT(*) FROM th_support_threads t
             WHERE t.app = a.slug AND t.status <> 'closed') AS threads
      FROM th_managed_apps a
     WHERE (? = 1 OR a.status <> 'archived')
     ORDER BY a.status, a.slug
  `).all(includeArchived ? 1 : 0).map(shape);
}

const rowById = (id) => db.prepare('SELECT * FROM th_managed_apps WHERE id = ?').get(Number(id)) || null;

export function createApp(patch = {}) {
  const slug = cleanSlug(patch.slug);
  if (db.prepare('SELECT 1 AS x FROM th_managed_apps WHERE slug = ?').get(slug)) {
    throw fail('این نام کوتاه قبلاً گرفته شده است', 'slug_taken');
  }
  const now = Date.now();
  db.prepare(`
    INSERT INTO th_managed_apps (slug, title, kind, url, health_url, note, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(slug,
    String(patch.title || slug).slice(0, 80),
    KINDS.includes(patch.kind) ? patch.kind : 'app',
    String(patch.url || '').slice(0, 300),
    String(patch.healthUrl || '').slice(0, 300),
    String(patch.note || '').slice(0, 500),
    STATUSES.includes(patch.status) ? patch.status : 'active',
    now, now);
  return shape(db.prepare('SELECT * FROM th_managed_apps WHERE slug = ?').get(slug));
}

export function updateApp(id, patch = {}) {
  const cur = rowById(id);
  if (!cur) throw fail('این برنامه پیدا نشد', 'not_found');
  db.prepare(`
    UPDATE th_managed_apps
       SET title = ?, kind = ?, url = ?, health_url = ?, note = ?, status = ?, updated_at = ?
     WHERE id = ?
  `).run(
    patch.title === undefined ? cur.title : String(patch.title).slice(0, 80),
    patch.kind === undefined || !KINDS.includes(patch.kind) ? cur.kind : patch.kind,
    patch.url === undefined ? cur.url : String(patch.url).slice(0, 300),
    patch.healthUrl === undefined ? cur.health_url : String(patch.healthUrl).slice(0, 300),
    patch.note === undefined ? cur.note : String(patch.note).slice(0, 500),
    patch.status === undefined || !STATUSES.includes(patch.status) ? cur.status : patch.status,
    Date.now(), Number(id),
  );
  return shape(rowById(id));
}

/**
 * بایگانی، نه پاک کردن.
 *
 * بازدیدها و گفت‌وگوهای هر برنامه به slugش بسته‌اند؛ با پاک کردنِ ردیف
 * بی‌صاحب می‌شدند.
 */
export function archiveApp(id) {
  const cur = rowById(id);
  if (!cur) throw fail('این برنامه پیدا نشد', 'not_found');
  db.prepare(`UPDATE th_managed_apps SET status='archived', updated_at=? WHERE id=?`)
    .run(Date.now(), Number(id));
  return shape(rowById(id));
}

/**
 * سنجیدنِ سلامتِ همهٔ برنامه‌هایی که نشانیِ سلامت دارند.
 *
 * نتیجه در همان ردیف می‌نشیند تا برنامهٔ مدیریت لازم نباشد خودش به
 * سایت‌ها وصل شود.
 */
export async function checkAppHealth({ timeoutMs = 8000 } = {}) {
  const rows = db.prepare(`SELECT * FROM th_managed_apps WHERE status='active' AND health_url <> ''`).all();
  const out = [];
  for (const r of rows) {
    const started = Date.now();
    let ok = false; let status = null; let error = '';
    try {
      const res = await fetch(r.health_url, { signal: AbortSignal.timeout(timeoutMs) });
      status = res.status;
      ok = res.ok;
      if (!ok) error = `پاسخ ${res.status}`;
    } catch (e) {
      error = String(e.message || e).slice(0, 200);
    }
    db.prepare(`
      UPDATE th_managed_apps
         SET last_check_at = ?, last_ok = ?, last_status = ?, last_ms = ?, last_error = ?
       WHERE id = ?
    `).run(Date.now(), ok ? 1 : 0, status, Date.now() - started, error, r.id);
    out.push({ slug: r.slug, ok, status, error });
  }
  return out;
}

/* ------------------------------- کلید ------------------------------- */

/** رازِ HMACِ کلیدها — یک بار ساخته و نگه داشته می‌شود */
function pepper() {
  let s = getSetting('tohid_appkey_pepper', null);
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    setSetting('tohid_appkey_pepper', s);
  }
  return s;
}

const hashKey = (raw) => crypto.createHmac('sha256', pepper()).update(String(raw || '')).digest('hex');

/**
 * کلیدِ تازه برای یک برنامه.
 *
 * خام فقط همین یک بار برمی‌گردد؛ بعد از آن حتی سرور هم نمی‌تواند نشانش
 * بدهد. کلیدِ قبلی همان لحظه می‌میرد.
 */
export function rotateAppKey(id) {
  const cur = rowById(id);
  if (!cur) throw fail('این برنامه پیدا نشد', 'not_found');
  const raw = `ak_${crypto.randomBytes(24).toString('base64url')}`;
  db.prepare('UPDATE th_managed_apps SET api_key_hash = ?, api_key_hint = ?, updated_at = ? WHERE id = ?')
    .run(hashKey(raw), raw.slice(-4), Date.now(), Number(id));
  return { key: raw, app: shape(rowById(id)) };
}

/** برنامه‌ای که این کلید مالِ اوست — یا null */
export function appBySecret(rawKey) {
  const clean = String(rawKey || '').trim();
  if (!clean) return null;
  const hash = hashKey(clean);
  const rows = db.prepare(`SELECT * FROM th_managed_apps WHERE api_key_hash <> '' AND status='active'`).all();
  for (const r of rows) {
    const a = Buffer.from(r.api_key_hash, 'hex');
    const b = Buffer.from(hash, 'hex');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return shape(r);
  }
  return null;
}
