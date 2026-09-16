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
import { findUser, verifyPassword } from '../auth.js';

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

/**
 * تنها مسیری که بی کلید هم جواب می‌دهد — و آن هم فقط با نام و رمزِ خودِ مدیر.
 *
 * ⚠️ چرا لازم شد: کلید تا دیروز فقط از داخلِ خانه صادر می‌شد، و این یعنی
 * برنامه‌ای که بارِ اول بیرونِ خانه باز می‌شد هیچ راهی نداشت — درِ دامنه بی
 * کلید بسته بود و کلید هم بی بودنِ داخلِ خانه صادر نمی‌شد. همان گرهی که در
 * گوشی دیده شد: آدرس درست بود، سرور روشن بود، و باز هم «این آدرس روی سرور
 * نیست».
 *
 * ⚠️ و چرا باز کردنش در را باز نمی‌کند: پشتِ این مسیر همان نام و رمزِ مدیر
 * است، جوابِ اشتباه دقیقاً همان «not found»ِ همیشگی است (پس از بیرون هیچ
 * فرقی با یک مسیرِ نبوده ندارد و کسی نمی‌فهمد این‌جا چیزی هست)، و شمارندهٔ
 * سختِ خودش را دارد.
 */
export const GATE_ENROLL = `${GATE_PREFIX}/enroll`;

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

/**
 * گرفتنِ کلید با نام و رمزِ مدیر — راهِ بارِ اول، از هر جای دنیا.
 *
 * ⚠️ فقط مدیر. کاربرِ «viewer» یا «operator» هم اگر رمزش درست باشد از این
 * در رد نمی‌شود: پشتِ این در کلِ سرور است، نه بخشی از آن.
 *
 * @returns {{deviceId:string, key:string}|null} — null یعنی «نه»، بدونِ
 *   اینکه معلوم شود کدام‌یک غلط بوده: نام، رمز، یا نقش.
 */
export function enrollDevice({ username, password, deviceId, name, ip = '' }) {
  const who = String(username || '').trim();
  const user = who ? findUser(who) : null;

  if (!user || user.disabled || !verifyPassword(String(password || ''), user.password_hash)) {
    logEvent('warn', 'panel', `تلاشِ ناموفق برای گرفتنِ کلیدِ درِ مدیر با نامِ «${who.slice(0, 40)}»`);
    return null;
  }
  if ((user.role || 'admin') !== 'admin') {
    logEvent('warn', 'panel', `کاربرِ «${user.username}» مدیر نیست و کلیدِ درِ مدیر نگرفت`);
    return null;
  }

  const issued = issueGateKey({ deviceId, name: name || 'ویلن ادمین', actor: user.username });
  logEvent(
    'warn',
    'panel',
    `کلیدِ درِ مدیر از راهِ دامنه برای دستگاهِ «${issued.deviceId}» صادر شد (${user.username}${ip ? ` از ${ip}` : ''})`,
  );
  return issued;
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
 *  آیا این درخواست روی زیردامنهٔ برنامهٔ مدیر آمده؟
 *
 *  ⚠️ روی `admin.<دامنه>` خودِ ریشه همان در است، پس برنامه با آدرسِ ساده
 *  کار می‌کند: https://admin.example.com/api/dashboard — نه مسیرِ درازِ
 *  اضافه. برای کسی که آدرس را نمی‌داند هم فرقی نمی‌کند: بی کلید، همان
 *  «not found» را می‌گیرد.
 */
export function isAdminHost(req) {
  const host = String(req.headers.host || '').toLowerCase().split(':')[0];
  return host.startsWith('admin.');
}

/**
 * مسیرِ ثبتِ بارِ اول.
 *
 * ⚠️ جوابِ «نه» همان ۴۰۴ِ خالیِ بقیهٔ در است، نه ۴۰۱. کسی که رمز را حدس
 * می‌زند نباید بفهمد اصلاً جایی برای حدس زدن هست.
 */
export function adminEnrollRoute(req, res) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress || '';

  const issued = enrollDevice({
    username: req.body?.username,
    password: req.body?.password,
    deviceId: req.body?.deviceId,
    name: req.body?.name,
    ip,
  });
  if (!issued) return notFound(res);

  res.json({ ok: true, ...issued, gateHeader: GATE_HEADER, gatePath: '' });
}

/**
 * میان‌افزارِ زیردامنهٔ مدیر — روی ریشه می‌نشیند.
 *
 * فرقش با `adminGate` فقط در این است که مسیر را نمی‌برد: آن‌جا پیشوندِ
 * `/api/admin-gate` باید کنده شود، این‌جا کلِ مسیر همان است که هست.
 */
export function adminHostGate(req, res, next) {
  if (!isAdminHost(req)) return next();
  return adminGate(req, res, { stripPrefix: false });
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
export function adminGate(req, res, { stripPrefix = true } = {}) {
  const key = String(req.headers[GATE_HEADER] || '').trim();
  const device = deviceFor(key);

  if (!device) {
    // نه پیام، نه لاگِ پرسروصدا — این مسیر از بیرون باید «نبوده» باشد
    return notFound(res);
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress || '';
  touch(device, ip);

  /*
   *  مسیرِ داخلی.
   *
   *  روی مسیرِ `/api/admin-gate/...` باید پیشوند کنده شود؛ روی زیردامنهٔ
   *  `admin.<دامنه>` کلِ مسیر همان است که هست.
   */
  const full = String(req.originalUrl || req.url || '');

  /*
   *  ⚠️ روی زیردامنهٔ admin هم اگر پیشوند آمده باشد، کنده می‌شود — و همین
   *  یک خط، برنامه را از «کار نمی‌کند» به «کار می‌کند» برد.
   *
   *  برنامه آدرسِ درش را از خودِ سرور می‌گیرد و پیشوند را به آن می‌چسباند:
   *
   *      https://admin.<دامنه>  +  /api/admin-gate  +  /api/dashboard
   *
   *  ولی روی زیردامنهٔ admin *کلِ میزبان* همان در است، پس این‌جا پیشوند
   *  کنده نمی‌شد و همان‌طور به پنل می‌رفت — و پنل مسیری به نامِ
   *  «/api/admin-gate/api/dashboard» ندارد. یعنی هر درخواستی که برنامه از
   *  بیرونِ خانه می‌زد، با کلیدِ درست، ۴۰۴ می‌گرفت. همان «این آدرس روی
   *  سرور نیست»ی که در گوشی دیده شد.
   *
   *  آزمونش پایینِ test/admin-gate.mjs است تا دوباره برنگردد.
   */
  const bare = full === GATE_PREFIX || full.startsWith(`${GATE_PREFIX}/`) || full.startsWith(`${GATE_PREFIX}?`)
    ? full.slice(GATE_PREFIX.length)
    : full;
  const inner = (stripPrefix ? full.slice(GATE_PREFIX.length) : bare) || '/';
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
