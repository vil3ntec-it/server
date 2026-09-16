// ---------------------------------------------------------------------------
//  درِ مدیر — تنها راهی که «ویلن ادمین» از اینترنت به کلِ سرور می‌رسد
//
//  مسئله: تونل عمداً روی پورتِ عمومی باز است و آن‌جا فقط چیزهای عمومی سرو
//  می‌شوند — پنل، فایل‌منیجر، ترمینال و /api/control هرگز به اینترنت درز
//  نمی‌کنند. آن تصمیم درست است و سرِ جایش می‌ماند.
//
//  ولی برنامهٔ مدیر باید از بیرونِ خانه به همه‌چیز برسد. پس به‌جای باز کردنِ
//  آن مسیرها برای همه، یک درِ جداگانه ساخته می‌شود که:
//
//    ۱) پشتِ یک کلیدِ بلندِ تصادفی است که فقط روی همان گوشی می‌نشیند
//    ۲) کلید به یک دستگاهِ مشخص بسته است و از پنل قابلِ باطل کردن
//    ۳) کلید فقط از داخلِ خانه (با ورودِ مدیر) صادر می‌شود — هیچ‌وقت از بیرون
//    ۴) بدونِ کلیدِ درست، جواب دقیقاً «not found» است؛ نه ۴۰۱، نه ۴۰۳
//
//  ⚠️ بندِ چهارم عمدی است. اگر «اجازه ندارید» برمی‌گرداندیم، هر کسی که
//  آدرسِ دامنه را داشت می‌فهمید این‌جا دری هست و شروع می‌کرد به کوبیدنش.
//  حالا از بیرون هیچ فرقی با یک مسیرِ نبوده ندارد.
//
//  ⚠️ و کلیدِ در، جای ورودِ مدیر را نمی‌گیرد: پشتِ این در، همان توکنِ پنل
//  لازم است. دو قفلِ مستقل — یکی می‌گوید «تو همان برنامه‌ای»، دیگری
//  می‌گوید «تو همان آدمی».
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import http from 'node:http';
import { config } from '../config.js';
import { db, logEvent } from '../db.js';
import { audit } from '../control/audit.js';

db.exec(`
CREATE TABLE IF NOT EXISTS admin_gate_devices (
  id           TEXT PRIMARY KEY,   -- شناسه‌ای که خودِ برنامه می‌سازد
  name         TEXT NOT NULL,      -- «گوشیِ من» — تا در پنل شناخته شود
  key_hash     TEXT NOT NULL,      -- فقط hash؛ خودِ کلید هیچ‌جا نمی‌ماند
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER,
  last_ip      TEXT,
  revoked      INTEGER NOT NULL DEFAULT 0
);
`);

/** نامِ هدری که کلید با آن می‌آید */
export const GATE_HEADER = 'x-admin-gate';

/** مسیرِ در روی پورتِ عمومی */
export const GATE_PREFIX = '/api/admin-gate';

const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

const cleanId = (value) =>
  String(value ?? '').trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);

/* --------------------------- صدور و باطل کردن ---------------------------- */

/**
 * کلیدِ تازه برای یک دستگاه.
 *
 * ⚠️ خودِ کلید فقط همین یک بار برمی‌گردد و هیچ‌جا ذخیره نمی‌شود. اگر گم شد،
 * کلیدِ تازه صادر می‌شود — بازخوانی‌اش ممکن نیست و همین درست است.
 */
export function issueGateKey({ deviceId, name = '', actor = 'admin' }) {
  const id = cleanId(deviceId) || crypto.randomBytes(8).toString('hex');
  const key = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();

  db.prepare(`
    INSERT INTO admin_gate_devices (id, name, key_hash, created_at, revoked)
    VALUES (?,?,?,?,0)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, key_hash = excluded.key_hash,
      created_at = excluded.created_at, revoked = 0
  `).run(id, String(name || 'دستگاه').slice(0, 60), hash(key), now);

  audit({ actor, action: 'admin-gate.issue', entity: 'admin-gate', entityId: id });
  logEvent('info', 'panel', `کلیدِ درِ مدیر برای دستگاهِ «${id}» صادر شد`);

  return { deviceId: id, key };
}

export function listGateDevices() {
  return db.prepare('SELECT id, name, created_at, last_seen_at, last_ip, revoked FROM admin_gate_devices ORDER BY created_at DESC')
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      lastIp: row.last_ip,
      revoked: Boolean(row.revoked),
    }));
}

export function revokeGateDevice(deviceId, actor = 'admin') {
  const id = cleanId(deviceId);
  const info = db.prepare('UPDATE admin_gate_devices SET revoked = 1 WHERE id = ?').run(id);
  if (info.changes) {
    audit({ actor, action: 'admin-gate.revoke', entity: 'admin-gate', entityId: id });
    logEvent('warn', 'panel', `کلیدِ درِ مدیر برای دستگاهِ «${id}» باطل شد`);
  }
  return info.changes > 0;
}

/* ------------------------------ سنجشِ کلید ------------------------------- */

/**
 * دستگاهی که این کلید مالِ اوست — یا null.
 *
 * ⚠️ مقایسه روی hash و ثابت‌زمان است: از روی مدتِ پاسخ نباید بشود فهمید
 * چند نویسهٔ اول درست بوده.
 */
function deviceFor(key) {
  if (!key || key.length < 20 || key.length > 200) return null;
  const digest = Buffer.from(hash(key), 'hex');

  for (const row of db.prepare('SELECT * FROM admin_gate_devices WHERE revoked = 0').all()) {
    const known = Buffer.from(row.key_hash, 'hex');
    if (known.length === digest.length && crypto.timingSafeEqual(known, digest)) return row;
  }
  return null;
}

function touch(row, ip) {
  try {
    db.prepare('UPDATE admin_gate_devices SET last_seen_at = ?, last_ip = ? WHERE id = ?')
      .run(Date.now(), String(ip || '').slice(0, 64), row.id);
  } catch { /* اهمیتی ندارد */ }
}

/* -------------------------------- خودِ در -------------------------------- */

/** هر چیزی که رد نشود، همین را می‌گیرد — دقیقاً مثلِ یک مسیرِ نبوده */
function notFound(res) {
  res.status(404).type('text/plain; charset=utf-8').send('not found');
}

/**
 * میان‌افزارِ در.
 *
 * درخواستی که کلیدِ درست داشته باشد، همان‌طور که هست به پنلِ محلی
 * (127.0.0.1:port) لوله می‌شود. یعنی هر چیزی که در خانه کار می‌کند، از
 * بیرون هم کار می‌کند — بی‌آنکه لازم باشد فهرستِ مسیرها دو جا نگه داشته شود
 * و بی‌آنکه مسیرِ تازه‌ای فراموش شود.
 *
 * ⚠️ خودِ کلید به آن‌طرف نمی‌رود: کارش همین‌جا تمام شد. آن‌طرف فقط
 * Authorization را می‌بیند، مثلِ هر درخواستِ داخلِ خانه.
 */
export function adminGate(req, res) {
  const key = String(req.headers[GATE_HEADER] || '').trim();
  const device = deviceFor(key);

  if (!device) {
    // نه پیام، نه لاگِ پرسروصدا — این مسیر از بیرون باید «نبوده» باشد
    return notFound(res);
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress || '';
  touch(device, ip);

  // مسیرِ داخلی: /api/admin-gate/api/dashboard → /api/dashboard
  const full = String(req.originalUrl || req.url || '');
  const inner = full.slice(GATE_PREFIX.length) || '/';
  if (!inner.startsWith('/')) return notFound(res);

  const headers = { host: `127.0.0.1:${config.port}` };
  for (const name of ['content-type', 'authorization', 'accept', 'accept-language', 'content-length']) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  // پنل باید IPِ واقعی را ببیند، نه لوکال‌هاست
  if (ip) headers['x-forwarded-for'] = ip;
  headers['x-admin-gate-device'] = device.id;

  const upstream = http.request(
    { host: '127.0.0.1', port: config.port, method: req.method, path: inner, headers, timeout: 60_000 },
    (answer) => {
      res.status(answer.statusCode || 502);
      for (const [name, value] of Object.entries(answer.headers)) {
        // هدرهای اتصال به دردِ این طرف نمی‌خورند
        if (['connection', 'transfer-encoding', 'keep-alive'].includes(name)) continue;
        res.setHeader(name, value);
      }
      answer.pipe(res);
    },
  );

  upstream.on('timeout', () => upstream.destroy(new Error('gate_timeout')));
  upstream.on('error', () => {
    if (!res.headersSent) res.status(502).json({ error: 'gate_upstream' });
    else res.end();
  });

  req.pipe(upstream);
}
