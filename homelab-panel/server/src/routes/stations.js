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
import { Router } from 'express';
import QRCode from 'qrcode';
import { requireAuth, requireWriteRole } from '../auth.js';
import { getStations } from '../state.js';
import { logEvent } from '../db.js';
import { isLocalRequest, safeCode, LIVE_BRANCH, INBOX_BRANCH, META_BRANCH } from '../stations/index.js';

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
  const live = ctx.store.read(LIVE_BRANCH);
  if (live === undefined) return res.json({ ok: true, code: ctx.code, live: null, empty: true });
  res.json({ ok: true, code: ctx.code, live });
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
