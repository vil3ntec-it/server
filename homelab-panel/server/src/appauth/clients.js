// ---------------------------------------------------------------------------
//  دفترِ برنامه‌ها و سایت‌ها
//
//  هر برنامه (اپِ اندروید، برنامهٔ ویندوز، سایتِ فروشگاه، …) این‌جا یک ردیف
//  دارد با نام، شناسه، و کلیدِ اختصاصیِ خودش. از روی همین ردیف است که:
//
//    • آدرسِ API آن برنامه ساخته می‌شود
//    • کاربرانش از بقیه جدا می‌مانند
//    • متنِ پیامک و طولِ کد می‌تواند برای هر برنامه فرق کند
//    • می‌شود یک برنامه را موقتاً خاموش کرد بی‌آنکه بقیه بخوابند
//
//  اگر برنامه‌ای بدونِ ثبتِ قبلی کد بخواهد، خودش این‌جا ثبت می‌شود — تا هیچ
//  برنامه‌ای پشتِ در نماند و صاحبِ سرور بعداً در پنل ببیندش.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { db, logEvent } from '../db.js';
import { otpSettings } from './settings.js';
import { cleanApp } from './identity.js';

db.exec(`
CREATE TABLE IF NOT EXISTS app_clients (
  slug          TEXT PRIMARY KEY,          -- pump / shop / site-1
  name          TEXT NOT NULL,             -- نامی که در پنل دیده می‌شود
  api_key       TEXT,                      -- کلیدِ اختصاصیِ همین برنامه
  require_key   INTEGER NOT NULL DEFAULT 0,
  enabled       INTEGER NOT NULL DEFAULT 1,
  channels      TEXT NOT NULL DEFAULT 'sms,email',
  sms_text      TEXT,                      -- متنِ پیامکِ همین برنامه
  email_subject TEXT,
  code_length   INTEGER,
  code_ttl      INTEGER,
  note          TEXT,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER
);
`);

const newKey = () => `hlp_${crypto.randomBytes(16).toString('hex')}`;

export function getClient(slug) {
  return db.prepare('SELECT * FROM app_clients WHERE slug = ?').get(cleanApp(slug)) || null;
}

/** برنامه را می‌سازد اگر نبود — همان چیزی که «ثبتِ خودکار» می‌گوید */
export function ensureClient(slug, { name = null, autoKey = true } = {}) {
  const key = cleanApp(slug);
  const found = getClient(key);
  if (found) return found;

  db.prepare(
    'INSERT INTO app_clients(slug, name, api_key, created_at) VALUES(?,?,?,?)'
  ).run(key, name || key, autoKey ? newKey() : null, Date.now());
  logEvent('info', 'panel', `برنامهٔ تازه ثبت شد: ${key}`);
  return getClient(key);
}

export function touchClient(slug) {
  try {
    db.prepare('UPDATE app_clients SET last_seen_at = ? WHERE slug = ?').run(Date.now(), cleanApp(slug));
  } catch { /* بی‌خیال */ }
}

export function listClients() {
  const rows = db.prepare('SELECT * FROM app_clients ORDER BY created_at DESC').all();
  const dayAgo = Date.now() - 24 * 3600 * 1000;

  return rows.map((row) => {
    const users = db.prepare('SELECT COUNT(*) AS n FROM app_users WHERE app = ?').get(row.slug).n;
    const codes = db
      .prepare('SELECT COUNT(*) AS n FROM app_codes WHERE app = ? AND created_at > ?')
      .get(row.slug, dayAgo).n;
    const sessions = db
      .prepare('SELECT COUNT(*) AS n FROM app_sessions WHERE app = ? AND expires_at > ?')
      .get(row.slug, Date.now()).n;
    return { ...publicClient(row), users, codesToday: codes, activeSessions: sessions };
  });
}

export const publicClient = (row) => ({
  slug: row.slug,
  name: row.name,
  apiKey: row.api_key || null,
  requireKey: Boolean(row.require_key),
  enabled: Boolean(row.enabled),
  channels: String(row.channels || 'sms,email').split(',').filter(Boolean),
  smsText: row.sms_text || null,
  emailSubject: row.email_subject || null,
  codeLength: row.code_length || null,
  codeTtl: row.code_ttl || null,
  note: row.note || null,
  createdAt: row.created_at,
  lastSeenAt: row.last_seen_at || null,
});

const FIELDS = {
  name: 'name',
  requireKey: 'require_key',
  enabled: 'enabled',
  channels: 'channels',
  smsText: 'sms_text',
  emailSubject: 'email_subject',
  codeLength: 'code_length',
  codeTtl: 'code_ttl',
  note: 'note',
};

export function updateClient(slug, patch = {}) {
  const row = getClient(slug);
  if (!row) return null;

  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(FIELDS)) {
    if (!(key in patch)) continue;
    let value = patch[key];
    if (key === 'requireKey' || key === 'enabled') value = value ? 1 : 0;
    else if (key === 'channels') value = Array.isArray(value) ? value.join(',') : String(value || '');
    else if (key === 'codeLength' || key === 'codeTtl') value = value ? Number(value) : null;
    else if (value === '' ) value = null;
    sets.push(`${column} = ?`);
    values.push(value);
  }
  if (!sets.length) return row;

  db.prepare(`UPDATE app_clients SET ${sets.join(', ')} WHERE slug = ?`).run(...values, row.slug);
  return getClient(row.slug);
}

export function rotateKey(slug) {
  const row = getClient(slug);
  if (!row) return null;
  const key = newKey();
  db.prepare('UPDATE app_clients SET api_key = ? WHERE slug = ?').run(key, row.slug);
  logEvent('info', 'panel', `کلیدِ برنامهٔ ${row.slug} عوض شد`);
  return getClient(row.slug);
}

export function removeClient(slug, { withUsers = false } = {}) {
  const row = getClient(slug);
  if (!row) return { ok: false, error: 'not_found' };
  if (withUsers) {
    db.prepare('DELETE FROM app_users WHERE app = ?').run(row.slug);
    db.prepare('DELETE FROM app_codes WHERE app = ?').run(row.slug);
  }
  db.prepare('DELETE FROM app_clients WHERE slug = ?').run(row.slug);
  logEvent('warn', 'panel', `برنامهٔ ${row.slug} حذف شد`);
  return { ok: true };
}

/**
 * تنظیماتِ نهاییِ یک برنامه: تنظیماتِ کلیِ سرور + هر چیزی که برای همین برنامه
 * جداگانه گذاشته شده. (متنِ پیامکِ فروشگاه با متنِ پمپ فرق کند، مثلاً.)
 */
export function settingsFor(slug, base = otpSettings()) {
  const row = getClient(slug);
  if (!row) return base;
  return {
    ...base,
    appName: row.name || base.appName,
    smsText: row.sms_text || base.smsText,
    emailSubject: row.email_subject || base.emailSubject,
    codeLength: row.code_length || base.codeLength,
    codeTtlSeconds: row.code_ttl || base.codeTtlSeconds,
  };
}

/**
 * آیا این درخواست اجازهٔ استفاده از این برنامه را دارد؟
 * تا وقتی «کلید لازم است» را روشن نکنید، همه‌چیز مثلِ قبل باز است.
 */
export function checkAccess(slug, { key = null, channel = null } = {}) {
  const row = getClient(slug);
  if (!row) return { ok: true, client: null };

  if (!row.enabled) {
    return { ok: false, status: 403, error: 'app_disabled', message: 'این برنامه موقتاً خاموش است' };
  }
  if (row.require_key) {
    if (!key || String(key) !== String(row.api_key || '')) {
      return { ok: false, status: 401, error: 'bad_api_key', message: 'کلیدِ برنامه درست نیست' };
    }
  }
  if (channel) {
    const allowed = String(row.channels || 'sms,email').split(',').filter(Boolean);
    if (allowed.length && !allowed.includes(channel)) {
      const what = channel === 'sms' ? 'پیامک' : 'ایمیل';
      return { ok: false, status: 400, error: 'channel_off', message: `ورود با ${what} برای این برنامه خاموش است` };
    }
  }
  return { ok: true, client: row };
}
