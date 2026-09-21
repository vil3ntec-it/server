// ---------------------------------------------------------------------------
//  ══ درِ ورودیِ بخشِ پمپ‌بنزین‌ها ═════════════════════════════════════════════
//
//  دو روتر در یک فایل، چون دو مخاطبِ کاملاً جدا دارند:
//
//   ۱) روترِ عمومی (‎/api/stations‎) — برنامهٔ نیتیو، اپِ کارمندان، اندروید و
//      شورت‌کاتِ آیفون. احرازِ هویتش رمزِ خودِ همان پمپ است، نه ورودِ پنل.
//      همین یکی هم از راهِ تونل (پورتِ عمومی) در دسترس است.
//
//   ۲) روترِ پنل (‎adminRouter‎ روی ‎/api/stations-admin‎) — ساخت و حذفِ پمپ،
//      دیدنِ رمزها، کیو‌آرها. فقط پشتِ ورودِ پنل و هرگز روی پورتِ عمومی.
//
//  ⚠️ چرا وب‌سوکت هست ولی این هم هست: گوشی و شورت‌کاتِ آیفون همیشه وب‌سوکت
//  ندارند. یک ‎GET‎ی ساده کارِ همه‌شان را راه می‌اندازد، و ‎POST‎ی ‎inbox‎ راهِ
//  برگشتِ داده است.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import express, { Router } from 'express';
import QRCode from 'qrcode';
import { requireAuth, requireWriteRole } from '../auth.js';
import { getStations, getMirror } from '../state.js';
import { config } from '../config.js';
import { readMirrorStatus, mirrorDir } from '../stations/cloud-mirror.js';
import { logEvent } from '../db.js';
import { isLocalRequest, safeCode, LIVE_BRANCH, INBOX_BRANCH, META_BRANCH } from '../stations/index.js';
import { listBackups, saveBackup, KEEP_DAYS, MAX_BYTES } from '../stations/backups.js';
import { describeFolder } from '../stations/layout.js';
import { cloudStatus, cloudLogin, cloudForget, cloudCall } from '../stations/cloud.js';
import { noticesFor } from '../announce/store.js';

/** شاخهٔ حساب‌های کیو‌آردار — ‎acct/<شناسه>‎ (برنامهٔ نیتیو می‌نویسد) */
const ACCT_BRANCH = 'acct';

/** مقایسهٔ زمان‌ثابتِ دو رشته — تا درازای پاسخ چیزی دربارهٔ رمز نگوید */
function timingEqual(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/** بلندترین درخواستی که یک گوشی می‌تواند در صندوقِ ورودی بگذارد */
const INBOX_TEXT_LIMIT = 4000;
/** بیشتر از این پیام در صندوق نمی‌ماند — قدیمی‌ترین‌ها می‌روند */
const INBOX_KEEP = 200;

// ═══════════════════════════════ روترِ عمومی ═══════════════════════════════

const router = Router();

/** رمزی که کلاینت فرستاده — هر جوری که فرستاده باشد */
function tokenOf(req) {
  return String(
    req.get('x-station-token') ||
      req.get('x-read-key') ||
      String(req.get('authorization') || '').replace(/^Bearer\s+/i, '') ||
      req.query.token ||
      ''
  ).trim();
}

/**
 * «این درخواست به کدام پمپ و با چه اجازه‌ای؟»
 *
 * ⚠️ جوابِ «پمپ نیست» و «رمز غلط» عمداً یکی است (‎404‎): وگرنه هر کسی
 * می‌توانست با آزمون‌وخطا بفهمد چند پمپ هست و کدشان چیست.
 */
function open(req, res, need = 'read') {
  const stations = getStations();
  if (!stations) {
    res.status(503).json({ error: 'stations_disabled' });
    return null;
  }
  const code = safeCode(req.params.code);
  const access = stations.accessOf(code, tokenOf(req));
  if (!access) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  if (need === 'owner' && access !== 'owner') {
    res.status(403).json({ error: 'read_only' });
    return null;
  }
  return { stations, code, access, store: stations.get(code) };
}

/**
 * ثبتِ برنامهٔ نیتیو — «اگر آدرس نداشت، برایش بساز».
 *
 * برنامهٔ کامپیوتر سرور را در شبکهٔ خانگی پیدا می‌کند و همین را صدا می‌زند؛
 * پوشه و دو رمزِ همان پمپ ساخته می‌شود و برمی‌گردد. از آن به بعد کاربر هیچ
 * آدرسی تایپ نمی‌کند.
 */
router.post('/enroll', async (req, res) => {
  const stations = getStations();
  if (!stations) return res.status(503).json({ error: 'stations_disabled' });

  const body = req.body || {};
  try {
    const result = await stations.enroll({
      code: body.code || body.station,
      name: body.name,
      token: body.token,
      pin: body.pin,
      local: isLocalRequest(req),
    });
    if (!result.ok) return res.status(result.error === 'already_taken' ? 409 : 403).json(result);

    if (result.created) {
      logEvent('info', 'panel', `پمپ بنزینِ تازه ثبت شد: ${result.name} (${result.code})`);
    }
    res.json({ ...result, ws: '/station', paths: { live: LIVE_BRANCH, inbox: INBOX_BRANCH } });
  } catch (e) {
    res.status(400).json({ ok: false, error: 'enroll_failed', detail: e.message });
  }
});

/** عکسِ زندهٔ پمپ — همانی که شورت‌کاتِ آیفون و هر کلاینتِ سادهٔ دیگری می‌خواهد */
router.get('/:code/live', (req, res) => {
  const ctx = open(req, res, 'read');
  if (!ctx) return;
  /*
   *  ⚠️ اطلاعیه‌ها روی همین پاسخ سوار می‌شوند.
   *
   *  برنامهٔ پمپ همین حالا این مسیر را هر چند ثانیه می‌زند. اگر اطلاعیه
   *  مسیرِ خودش را می‌خواست، تا روزی که آن برنامه به‌روز شود پیامِ شما به
   *  هیچ پمپی نمی‌رسید. این‌طور همان تپشِ همیشگی اطلاعیه را هم می‌آورد.
   */
  const notices = noticesFor('station', ctx.code);
  const live = ctx.store.read(LIVE_BRANCH);
  if (live === undefined) {
    return res.json({ ok: true, code: ctx.code, live: null, empty: true, notices });
  }
  res.json({ ok: true, code: ctx.code, live, notices });
});

/**
 * ══ کیو‌آرِ زندهٔ مشتری — بی رمزِ پمپ ═══════════════════════════════════════
 *
 * برنامهٔ نیتیو هر حسابی را که کیو‌آر دارد در ‎acct/<شناسه>‎ی همین پمپ
 * می‌نویسد: ‎{v, k, at, d}‎. ‎k‎ رمزِ **همان یک حساب** است که داخلِ کیو‌آرِ
 * مشتری چاپ شده. این‌جا فقط با همان رمز باز می‌شود — نه رمزِ برنامه، نه
 * رمزِ خواندن — و فقط ‎{at, d}‎ پس می‌دهد؛ خودِ ‎k‎ هرگز برنمی‌گردد.
 *
 * ⚠️ «پمپ نیست»، «حساب نیست» و «رمز غلط» عمداً یکی‌اند (‎404‎)، تا کسی با
 * آزمون‌وخطا نفهمد کدام شناسه‌ها هست. مقایسهٔ رمز زمان‌ثابت است.
 *
 * ⚠️ CORS باز است: صفحهٔ مشتری روی دامنهٔ خودِ پمپ (‎yaqobipump.top/view‎)
 * است و از این‌جا می‌پرسد. داده‌ای که پشتِ رمزِ همان حساب است، برای همان
 * حساب عمومی است.
 */
router.get('/:code/acct/:id', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cache-Control', 'no-store');
  const stations = getStations();
  if (!stations) return res.status(503).json({ error: 'stations_disabled' });

  const code = safeCode(req.params.code);
  const id = String(req.params.id || '').trim();
  const key = String(req.query.k || '').trim();
  if (!/^[a-z][0-9]{1,18}$/.test(id) || !/^[A-Za-z0-9]{8,64}$/.test(key) || !stations.has(code)) {
    return res.status(404).json({ error: 'not_found' });
  }
  const env = stations.get(code).read(ACCT_BRANCH + '/' + id);
  if (!env || typeof env !== 'object' || !timingEqual(String(env.k || ''), key)) {
    return res.status(404).json({ error: 'not_found' });
  }
  res.json({ ok: true, at: Number(env.at) || 0, d: env.d === undefined ? null : env.d });
});

/** نام و کدِ پمپ — کم‌هزینه‌ترین راهِ «این رمز به کجا می‌خورد؟» */
router.get('/:code', (req, res) => {
  const ctx = open(req, res, 'read');
  if (!ctx) return;
  const meta = ctx.store.read(META_BRANCH);
  const live = ctx.store.read(LIVE_BRANCH);
  res.json({
    ok: true,
    code: ctx.code,
    name: (meta && meta.name) || ctx.code,
    access: ctx.access,
    liveAt: live && typeof live === 'object' ? Number(live.at) || null : null,
    liveSeq: live && typeof live === 'object' ? Number(live.seq) || null : null,
  });
});

/** هر شاخه‌ای از دفترِ همان پمپ — برای کلاینتی که همه‌چیز را نمی‌خواهد */
router.get('/:code/data/*', (req, res) => {
  const ctx = open(req, res, 'read');
  if (!ctx) return;
  const value = ctx.store.read(String(req.params[0] || ''));
  res.json({ ok: true, code: ctx.code, path: req.params[0], value: value === undefined ? null : value });
});

/**
 * نوشتن — فقط برنامهٔ نیتیو، و فقط وقتی وب‌سوکت در دسترس نیست.
 * (راهِ اصلی همان وب‌سوکت است؛ این پشتیبان است، نه جایگزین.)
 */
router.put('/:code/data/*', (req, res) => {
  const ctx = open(req, res, 'owner');
  if (!ctx) return;
  const path = String(req.params[0] || '');
  if (!path) return res.status(400).json({ error: 'no_path' });
  const value = req.body && Object.prototype.hasOwnProperty.call(req.body, 'value') ? req.body.value : req.body;
  ctx.store.write(path, value);
  res.json({ ok: true, code: ctx.code, path });
});

/**
 * ══ پشتیبانِ برنامهٔ نیتیو ═══════════════════════════════════════════════════
 *
 * خواستهٔ صاحب ریپو: «هر ۶ ساعت بک‌آپ برود به سرور و تا سه روز بماند.»
 * بدنه **خام** است (فایلِ SQLite)، پس این مسیر از میان‌افزارِ JSON رد نمی‌شود
 * و ‎express.raw‎ی خودش را دارد. فقط رمزِ برنامه (‎owner‎) می‌تواند بفرستد.
 */
router.post(
  '/:code/backup',
  (req, res, next) => express.raw({ type: '*/*', limit: MAX_BYTES })(req, res, next),
  async (req, res) => {
    const ctx = open(req, res, 'owner');
    if (!ctx) return;
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (body.length === 0) return res.status(400).json({ error: 'empty' });
    try {
      const saved = await saveBackup(config.stations.dataDir, ctx.code, req.get('x-backup-name') || '', body);
      logEvent('station_backup', `پشتیبانِ پمپ ${ctx.code}: ${saved.name} (${saved.bytes} بایت)`);
      res.json({ ok: true, code: ctx.code, ...saved, keepDays: KEEP_DAYS });
    } catch (err) {
      res.status(500).json({ error: 'save_failed', message: String(err?.message || err) });
    }
  }
);

/** فهرستِ پشتیبان‌های همین پمپ — برنامه با آن می‌فهمد آخرین بک‌آپ کِی رفته. */
router.get('/:code/backups', (req, res) => {
  const ctx = open(req, res, 'read');
  if (!ctx) return;
  res.json({ ok: true, code: ctx.code, keepDays: KEEP_DAYS, items: listBackups(config.stations.dataDir, ctx.code) });
});

/**
 * راهِ برگشتِ داده: گوشیِ کارمند/مشتری یک درخواست یا یادداشت بالا می‌فرستد و
 * برنامهٔ نیتیو (که به همین شاخه ‎sub‎ کرده) همان لحظه می‌بیندش.
 *
 * ⚠️ تنها جایی است که رمزِ فقط‌خواندنی هم اجازهٔ نوشتن دارد، و عمداً فقط
 * همین‌جا: هیچ‌کدام از این پیام‌ها روی حسابِ کسی اثر نمی‌گذارد.
 */
router.post('/:code/inbox', (req, res) => {
  const ctx = open(req, res, 'read');
  if (!ctx) return;

  const body = req.body || {};
  const text = String(body.text || body.message || '').slice(0, INBOX_TEXT_LIMIT);
  if (!text.trim()) return res.status(400).json({ error: 'empty' });

  const key = ctx.store.append(INBOX_BRANCH, {
    text,
    kind: String(body.kind || 'note').slice(0, 32),
    from: String(body.from || '').slice(0, 80),
    at: Date.now(),
  });

  // صندوقِ ورودی نباید بی‌مرز رشد کند — کسی هرگز پاکش نمی‌کند
  const box = ctx.store.read(INBOX_BRANCH);
  if (box && typeof box === 'object') {
    const keys = Object.keys(box).sort();
    for (const old of keys.slice(0, Math.max(0, keys.length - INBOX_KEEP))) {
      ctx.store.erase(`${INBOX_BRANCH}/${old}`);
    }
  }
  res.json({ ok: true, id: key });
});

/** خواندنِ صندوقِ ورودی — برنامهٔ نیتیو و خودِ فرستنده هر دو می‌بینند */
router.get('/:code/inbox', (req, res) => {
  const ctx = open(req, res, 'read');
  if (!ctx) return;
  const box = ctx.store.read(INBOX_BRANCH);
  res.json({ ok: true, code: ctx.code, inbox: box && typeof box === 'object' ? box : {} });
});

/** پاک کردنِ یک پیامِ خوانده‌شده — فقط برنامهٔ نیتیو */
router.delete('/:code/inbox/:id', (req, res) => {
  const ctx = open(req, res, 'owner');
  if (!ctx) return;
  const id = String(req.params.id || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!id) return res.status(400).json({ error: 'bad_id' });
  ctx.store.erase(`${INBOX_BRANCH}/${id}`);
  res.json({ ok: true });
});

export default router;

// ═══════════════════════════════ روترِ پنل ═════════════════════════════════

export const adminRouter = Router();
adminRouter.use(requireAuth);

async function qrFor(text) {
  if (!text) return null;
  try {
    return await QRCode.toString(text, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch {
    return null;
  }
}

const preview = (secret) =>
  secret ? `${secret.slice(0, 4)}${'•'.repeat(Math.max(0, secret.length - 8))}${secret.slice(-4)}` : null;

adminRouter.get('/', (req, res) => {
  const stations = getStations();
  if (!stations) return res.json({ enabled: false });
  res.json({
    enabled: true,
    dataDir: stations.dataDir,
    enrollMode: stations.enrollMode,
    stats: stations.snapshot(),
    pairings: stations.pendingPairings(),
    stations: stations.list().map((s) => ({
      ...s,
      tokenPreview: preview(stations.get(s.code)?.getToken()),
      readKeyPreview: preview(stations.readKeyOf(s.code)),
    })),
    branches: { live: LIVE_BRANCH, inbox: INBOX_BRANCH, meta: META_BRANCH },
  });
});

adminRouter.post('/', requireWriteRole('operator'), async (req, res) => {
  const stations = getStations();
  if (!stations) return res.status(404).json({ error: 'disabled' });
  const code = safeCode(req.body?.code);
  if (!code) return res.status(400).json({ error: 'bad_code' });
  if (stations.has(code)) return res.status(409).json({ error: 'exists' });
  const store = await stations.ensure(code, { name: String(req.body?.name || '').trim() });
  logEvent('info', 'panel', `پمپ بنزین ساخته شد: ${code}`);
  res.json({ ok: true, code, token: store.getToken(), readKey: stations.readKeyOf(code) });
});

adminRouter.put('/:code', requireWriteRole('operator'), async (req, res) => {
  const stations = getStations();
  if (!stations?.has(req.params.code)) return res.status(404).json({ error: 'not_found' });
  await stations.setName(req.params.code, String(req.body?.name || ''));
  res.json({ ok: true });
});

/**
 * حذفِ پمپ — با پوشه و دادهٔ داخلش.
 * عمداً ‎admin‎ می‌خواهد و عمداً نامِ پمپ را برای تایید می‌گیرد: این کار
 * برگشت ندارد.
 */
adminRouter.delete('/:code', requireWriteRole('admin'), async (req, res) => {
  const stations = getStations();
  if (!stations?.has(req.params.code)) return res.status(404).json({ error: 'not_found' });
  const code = safeCode(req.params.code);
  if (safeCode(req.query.confirm) !== code) return res.status(400).json({ error: 'confirm_mismatch' });
  await stations.remove(code);
  logEvent('warn', 'panel', `پمپ بنزین و همهٔ دادهٔ آن پاک شد: ${code}`);
  res.json({ ok: true });
});

/** رمزهای کامل — عمداً جدا و ثبت‌شونده در لاگ */
adminRouter.get('/:code/keys', (req, res) => {
  const stations = getStations();
  const store = stations?.get(req.params.code);
  if (!store) return res.status(404).json({ error: 'not_found' });
  logEvent('warn', 'panel', `رمزهای پمپ «${store.key}» توسط «${req.user.username}» دیده شد`);
  res.json({ ok: true, code: store.key, token: store.getToken(), readKey: stations.readKeyOf(store.key) });
});

adminRouter.post('/:code/rotate-token', requireWriteRole('admin'), async (req, res) => {
  const stations = getStations();
  const store = stations?.get(req.params.code);
  if (!store) return res.status(404).json({ error: 'not_found' });
  const token = await store.rotateToken();
  logEvent('warn', 'panel', `رمزِ برنامهٔ پمپ «${store.key}» عوض شد — باید در خودِ برنامه هم تازه شود`);
  res.json({ ok: true, token });
});

adminRouter.post('/:code/rotate-read-key', requireWriteRole('operator'), async (req, res) => {
  const stations = getStations();
  if (!stations?.has(req.params.code)) return res.status(404).json({ error: 'not_found' });
  const readKey = await stations.rotateReadKey(req.params.code);
  logEvent('warn', 'panel', `رمزِ خواندنِ پمپ «${safeCode(req.params.code)}» عوض شد — کیو‌آرهای قبلی باطل شدند`);
  res.json({ ok: true, readKey });
});

/** کدِ شش‌رقمیِ ده‌دقیقه‌ایِ جفت‌شدن — برای برنامه‌ای که در شبکهٔ خانگی نیست */
adminRouter.post('/pair', requireWriteRole('operator'), (req, res) => {
  const stations = getStations();
  if (!stations) return res.status(404).json({ error: 'disabled' });
  try {
    res.json({ ok: true, ...stations.createPairing({ code: req.body?.code, name: req.body?.name }) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * ══ جزئیاتِ یک پمپ — همان چیزی که تا امروز فقط داخلِ اپِ کارمندان دیده می‌شد ══
 *
 * گزارشِ صاحب ریپو: «برنامهٔ سرور بخشِ پمپ رو خیلی بدون محتوا درست کردی؛
 * برنامهٔ فروشگاه خیلی بخش‌های مختلف داره اما بخشِ پمپ هیچی نداره.»
 *
 * از روی همان ‎live.json‎ که برنامهٔ کامپیوتر هر بیست ثانیه می‌فرستد —
 * هیچ حسابی این‌جا دوباره حساب نمی‌شود، فقط شمرده و خلاصه می‌شود:
 *   • قرض‌داران: چند نفر، چند نفر تمام‌شده/کم‌مانده/موجودی‌دار
 *   • خبرها (‎alerts‎): همان فهرستی که گوشیِ کارمند زنگ می‌زند
 *   • مخزن: پطرول و دیزل، وارد/فروش/موجودی، و کم بودن
 *   • بخش‌ها: نام و شمارِ ردیف‌های هر دفتر
 *   • صندوقِ ورودی: پیام‌هایی که گوشی‌ها گذاشته‌اند و برنامه هنوز پاک نکرده
 *   • حساب‌های کیو‌آردار (‎acct/…‎) و لینکِ اپِ کارمندان
 *
 * ⚠️ رمزها این‌جا نمی‌آیند — همان ‎/:code/keys‎ی ثبت‌شونده در لاگ.
 */
adminRouter.get('/:code/detail', async (req, res) => {
  const stations = getStations();
  const store = stations?.get(req.params.code);
  if (!store) return res.status(404).json({ error: 'not_found' });

  const live = store.read(LIVE_BRANCH);
  const inbox = store.read(INBOX_BRANCH);
  const meta = store.read(META_BRANCH);
  const snap = store.snapshot();
  const ok = live && typeof live === 'object' ? live : null;

  const debtors = Array.isArray(ok?.debtors) ? ok.debtors : [];
  const byStatus = { ok: 0, low: 0, out: 0, none: 0 };
  for (const d of debtors) byStatus[d?.status in byStatus ? d.status : 'none']++;

  const sections = ok?.sections && typeof ok.sections === 'object'
    ? Object.entries(ok.sections).map(([id, sec]) => ({
        id,
        title: sec?.t || id,
        rows: Array.isArray(sec?.rows) ? sec.rows.length : 0,
        months: Array.isArray(sec?.m) ? [...new Set(sec.m.filter(Boolean))].length : 0,
      }))
    : [];

  const inboxList = inbox && typeof inbox === 'object'
    ? Object.entries(inbox)
        .map(([id, m]) => ({ id, ...(m && typeof m === 'object' ? m : { text: String(m) }) }))
        .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
        .slice(0, 50)
    : [];

  const accts = store.read(ACCT_BRANCH);
  const acctCount = accts && typeof accts === 'object' ? Object.keys(accts).length : 0;

  res.json({
    ok: true,
    code: store.key,
    name: (meta && meta.name) || store.key,
    dataDir: store.dataDir,
    diskBytes: store.diskBytes(),
    liveConnections: snap.liveConnections,
    reads: snap.reads,
    writes: snap.writes,
    lastActivity: snap.lastActivity,
    live: ok
      ? {
          at: ok.at || null,
          atUtc: ok.atUtc || null,
          seq: Number(ok.seq) || null,
          version: ok.v ?? null,
          hasGate: Boolean(ok.gate),
          detail: ok.detail !== false,
          station: ok.station && typeof ok.station === 'object'
            ? { name: ok.station.name || '', address: ok.station.address || '', phone: ok.station.phone || '',
                ratePetrol: ok.station.ratePetrol ?? null, rateDiesel: ok.station.rateDiesel ?? null }
            : null,
          tank: ok.tank && typeof ok.tank === 'object' ? ok.tank : null,
          debtors: { total: debtors.length, ...byStatus },
          alerts: Array.isArray(ok.alerts) ? ok.alerts.slice(0, 50) : [],
          sections,
        }
      : null,
    inbox: inboxList,
    inboxCount: inbox && typeof inbox === 'object' ? Object.keys(inbox).length : 0,
    qrAccounts: acctCount,
    //  «فایل‌ها»ی صفحهٔ پروفایلِ پمپ — هر شاخهٔ دفتر با حجمش
    files: store.branches().map((b) => ({ key: b.key, bytes: b.bytes, children: b.children })),
    //  پشتیبان‌های همین پمپ — سه روزِ آخر (‎stations/backups.js‎)
    backups: listBackups(config.stations.dataDir, store.key),
    /*
     *  ⚠️ «پوشهٔ این حساب» — چیدمانِ ثابت از ‎stations/layout.js‎، تنها جایی
     *  که آن فهرست نوشته شده. درِ دومی ساخته نشد: همین مسیر از قبل ‎files‎ و
     *  ‎backups‎ را می‌داد و دو مسیر برای یک صفحه همان سردرگمی است.
     *  ⛔ محتوای ‎token.txt‎/‎readkey.txt‎ خوانده نمی‌شود — فقط «هست یا نیست».
     */
    folder: describeFolder(config.stations.dataDir, store.key),
  });
});

/**
 * «این پمپ را چطور به همه وصل کنم؟» — یک جواب، آمادهٔ کپی.
 *
 * سه لینک برمی‌گردد و هر سه از یک جا می‌آیند تا هیچ‌وقت با هم نخوانند نباشند:
 *   • برنامهٔ نیتیوِ کامپیوتر (رمزِ کامل)
 *   • اپِ کارمندان / اندروید / آیفون (رمزِ فقط‌خواندنی)
 *   • آدرسِ ‎GET‎ی سادهٔ شورت‌کاتِ آیفون
 */
adminRouter.get('/:code/connect', async (req, res) => {
  const stations = getStations();
  const store = stations?.get(req.params.code);
  if (!store) return res.status(404).json({ error: 'not_found' });

  const { publicState, tunnelWss } = await import('../tunnel.js');
  const wsBase = tunnelWss() || '';
  const httpBase = publicState().url || '';
  const code = store.key;
  const readKey = stations.readKeyOf(code);

  const karBase = String(req.query.karBase || '').trim().replace(/\/+$/, '');
  const staffLink =
    karBase && httpBase
      ? `${karBase}/?server=${encodeURIComponent(httpBase)}&token=${encodeURIComponent(readKey)}&station=${encodeURIComponent(code)}`
      : null;

  res.json({
    ok: true,
    code,
    name: store.read(META_BRANCH)?.name || code,
    app: wsBase ? { ws: `${wsBase}/station?station=${encodeURIComponent(code)}`, token: store.getToken() } : null,
    staff: { link: staffLink, qr: await qrFor(staffLink), readKey },
    shortcut: httpBase
      ? `${httpBase}/api/stations/${encodeURIComponent(code)}/live?token=${encodeURIComponent(readKey)}`
      : null,
  });
});


// ═══════════════ حساب‌ها و اشتراکِ پمپ — از سرورِ ابر ═══════════════
//
//  خواستهٔ صاحب ریپو: «اشتراک بدم به اپ و ببینم افراد رو، اشتراک‌هاشون
//  و غیره؛ بخشِ فروشگاه خیلی تکمیل است، شبیه همون باشه.»
//
//  ⚠️ این‌جا هیچ دفترِ اشتراکی ساخته نمی‌شود. اشتراکِ پمپ روی ابر
//  زندگی می‌کند — همان‌جا که برنامه مجوزش را می‌گیرد. اگر این‌جا هم
//  دفتری می‌بود، روزی یکی می‌گفت «فعال» و آن یکی «تمام شده».

/** کمکی: خطای پل را با همان کدِ خودش برگردان، نه ۵۰۰ی گنگ. */
function cloudFail(res, err) {
  return res.status(err.status || 502).json({
    error: err.code || 'cloud_error',
    message: err.message || 'سرورِ حساب جواب نداد',
  });
}

adminRouter.get('/cloud/status', (req, res) => res.json(cloudStatus()));

adminRouter.post('/cloud/login', requireWriteRole('admin'), async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password) {
    return res.status(400).json({ error: 'bad_request', message: 'نام کاربری و رمز لازم است' });
  }
  try {
    const out = await cloudLogin(username, password, req.user?.username || 'admin');
    logEvent('stations', 'cloud_linked', { username });
    res.json(out);
  } catch (err) { cloudFail(res, err); }
});

adminRouter.post('/cloud/forget', requireWriteRole('admin'), (req, res) => {
  const gone = cloudForget(req.user?.username || 'admin');
  if (gone) logEvent('stations', 'cloud_unlinked', {});
  res.json({ ok: true, forgotten: gone });
});

/**
 * خواندنی‌ها — همان چیزی که پنلِ ابر نشان می‌دهد، این‌جا هم.
 *
 * ⚠️ `name` از فهرستِ سفیدِ `cloud.js` می‌آید؛ مسیرِ دلخواه پذیرفته
 * نمی‌شود، وگرنه پنل یک پروکسیِ باز به همهٔ مسیرهای مدیریتیِ ابر
 * می‌شد — از جمله بخشِ دکان.
 */
for (const name of ['stats', 'stations', 'users', 'subscriptions', 'expiring', 'vipCodes', 'plans', 'pumpPlans']) {
  adminRouter.get(`/cloud/${name}`, async (req, res) => {
    try {
      res.json(await cloudCall(name, { query: req.query }));
    } catch (err) { cloudFail(res, err); }
  });
}

/**
 * آینهٔ ابر در پوشهٔ داده — «حساب‌ها از سرور به فولدرِ خودِ سرور ثبت می‌شه؟»
 * حالا بله: هر نیم ساعت خودکار، و با این دکمه همین حالا.
 */
adminRouter.get('/cloud/mirror', (req, res) => {
  res.json({ ok: true, dir: mirrorDir(config.dataDir), last: readMirrorStatus(config.dataDir) });
});
adminRouter.post('/cloud/mirror', requireWriteRole('operator'), async (req, res) => {
  const mirror = getMirror();
  if (!mirror) return res.status(503).json({ error: 'stations_disabled' });
  const rep = await mirror.now();
  if (rep?.skipped === 'not_linked') return res.status(409).json({ error: 'not_linked', report: rep });
  logEvent('stations', 'cloud_mirrored', { ok: rep?.ok?.length || 0, failed: rep?.failed?.length || 0 });
  res.json({ ok: true, report: rep, dir: mirrorDir(config.dataDir) });
});

/** اشتراک دادن یا تمدید — همان کاری که در بخشِ دکان می‌شود. */
adminRouter.post('/cloud/grant', requireWriteRole('operator'), async (req, res) => {
  try {
    const out = await cloudCall('grant', { body: req.body || {} });
    logEvent('stations', 'cloud_subscription_granted', { stationId: req.body?.stationId });
    res.json(out);
  } catch (err) { cloudFail(res, err); }
});

/** کدِ شش‌رقمی برای دادن به یک پمپ. */
/** جزئیاتِ یک پمپ روی سرورِ حساب — اعضا، اشتراک، پوشهٔ ابری و کدِ اپِ کارمندان. */
adminRouter.get('/cloud/station/:id', async (req, res) => {
  try {
    res.json(await cloudCall('stationDetail', { params: { id: req.params.id } }));
  } catch (err) { cloudFail(res, err); }
});

adminRouter.post('/cloud/vip-codes/:id/revoke', requireWriteRole('operator'), async (req, res) => {
  try {
    const out = await cloudCall('revokeCode', { params: { id: req.params.id } });
    logEvent('stations', 'cloud_code_revoked', { id: req.params.id });
    res.json(out);
  } catch (err) { cloudFail(res, err); }
});

adminRouter.post('/cloud/subscriptions/:id/status', requireWriteRole('operator'), async (req, res) => {
  try {
    const out = await cloudCall('subStatus', { params: { id: req.params.id }, body: req.body || {} });
    logEvent('stations', 'cloud_subscription_status', { id: req.params.id, status: req.body?.status });
    res.json(out);
  } catch (err) { cloudFail(res, err); }
});

adminRouter.post('/cloud/vip-codes', requireWriteRole('operator'), async (req, res) => {
  try {
    const out = await cloudCall('makeCode', { body: req.body || {} });
    logEvent('stations', 'cloud_code_made', {});
    res.json(out);
  } catch (err) { cloudFail(res, err); }
});
