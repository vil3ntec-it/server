// ---------------------------------------------------------------------------
// «سرور سایت» — همان سرور شخصیِ برنامهٔ پمپ یعقوبی که روی همین پنل است.
// این صفحه دقیقاً همان چیزی را می‌دهد که در سایت لازم است:
//     آدرس سرور  +  رمز سرور  +  یک «لینک یک‌کلیکی» برای همهٔ دستگاه‌ها
// ---------------------------------------------------------------------------
import { Router } from 'express';
import QRCode from 'qrcode';
import { requireAuth } from '../auth.js';
import { getSiteSync } from '../state.js';
import { config } from '../config.js';
import { readInterfaces, readPublicIp } from '../metrics/network.js';
import { getSetting, setSetting, logEvent } from '../db.js';
import { ensureMainSite } from '../sites/registry.js';
import { pendingCodes, snapshot as messengerSnapshot } from '../messenger/index.js';
import {
  publicState,
  startTunnel,
  stopTunnel,
  tunnelWss,
  namedConfig,
  namedLoginStart,
  namedLoginDone,
  namedSetup,
  namedReset,
  tokenSetup,
  addHostname,
  removeHostname,
  routedHostnames,
  tunnelDiagnosis,
  repairTunnel,
  DEFAULT_TUNNEL_NAME,
} from '../tunnel.js';

const router = Router();
router.use(requireAuth);

// بدونِ پیش‌فرض: نشانیِ سایتِ کسِ دیگری، حدسِ درستی برای هیچ‌کس نیست
const DEFAULT_SITE_URL = '';

function siteUrl() {
  return String(getSetting('site_url', DEFAULT_SITE_URL) || DEFAULT_SITE_URL).replace(/\/+$/, '');
}

function addresses(req) {
  const port = config.siteSync.port || config.port;
  const list = [];
  list.push({
    label: 'همین کامپیوتر',
    host: 'localhost',
    ws: `ws://localhost:${port}`,
    http: `http://localhost:${port}`,
    scope: 'local',
  });
  for (const iface of readInterfaces()) {
    list.push({
      label: `شبکهٔ خانگی (${iface.name})`,
      host: iface.address,
      ws: `ws://${iface.address}:${port}`,
      http: `http://${iface.address}:${port}`,
      scope: 'lan',
    });
  }
  const hostHeader = String(req.headers.host || '').split(':')[0];
  if (hostHeader && !list.some((a) => a.host === hostHeader)) {
    list.unshift({
      label: 'آدرسی که همین حالا با آن وصل شده‌اید',
      host: hostHeader,
      ws: `ws://${hostHeader}:${port}`,
      http: `http://${hostHeader}:${port}`,
      scope: 'lan',
    });
  }
  return list;
}

/** لینکی که هر دستگاهی باز کند، سایت خودش را به این سرور وصل می‌کند */
function buildSiteLink(token) {
  const wss = tunnelWss();
  if (!wss || !token) return null;
  return `${siteUrl()}/?server=${encodeURIComponent(wss)}&token=${encodeURIComponent(token)}`;
}

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

router.get('/', async (req, res) => {
  const sync = getSiteSync();
  if (!sync) return res.json({ enabled: false });

  const token = sync.getToken();
  const tunnel = publicState();
  const link = buildSiteLink(token);

  res.json({
    enabled: true,
    // پوشهٔ دادهٔ هر سایت، جدا از بقیه
    stores: sync.list ? sync.list() : [],
    port: config.port,
    addresses: addresses(req),
    tokenPreview: token ? `${token.slice(0, 4)}${'•'.repeat(Math.max(0, token.length - 8))}${token.slice(-4)}` : null,
    stats: sync.snapshot(),
    branches: sync.branches(),
    dataDir: config.siteSync.dataDir,
    publicIp: await readPublicIp(),
    dedicatedPort: config.siteSync.port || null,
    tunnel,
    named: namedConfig(),
    hostnames: routedHostnames(),
    tunnelAutostart: getSetting('tunnel_autostart', true) !== false,
    siteUrl: siteUrl(),
    siteLink: link,
    siteLinkQr: await qrFor(link),
    howTo: {
      fa: 'در سایت: تنظیمات ← هم‌زمان‌سازی ← سرور شخصی. «آدرس سرور» و «رمز سرور» زیر را وارد کنید.',
    },
  });
});

// نمایش رمز کامل — عمداً جدا و ثبت‌شونده در لاگ
router.get('/token', (req, res) => {
  const sync = getSiteSync();
  if (!sync) return res.status(404).json({ error: 'disabled' });
  logEvent('warn', 'panel', `رمز سرور سایت توسط «${req.user.username}» نمایش داده شد`);
  res.json({ token: sync.getToken() });
});

router.post('/rotate-token', async (req, res) => {
  const sync = getSiteSync();
  if (!sync) return res.status(404).json({ error: 'disabled' });
  const token = await sync.rotateToken();
  logEvent('warn', 'panel', 'رمز سرور سایت عوض شد — باید در خودِ سایت هم بروزرسانی شود');
  res.json({ ok: true, token, siteLink: buildSiteLink(token) });
});

// ------------------------------ تونل اینترنتی ------------------------------
router.post('/tunnel/start', async (req, res) => {
  setSetting('tunnel_autostart', true);
  const result = await startTunnel({});
  res.json(result);
});

router.post('/tunnel/stop', (req, res) => {
  setSetting('tunnel_autostart', false);
  res.json(stopTunnel());
});

router.get('/tunnel', (req, res) => {
  res.json({ ...publicState(), autostart: getSetting('tunnel_autostart', true) !== false });
});

// چرا تونل بالا نمی‌آید؟ — به‌جای «کد ۱»، دلیل واقعی
router.get('/tunnel/diagnosis', (req, res) => {
  res.json(tunnelDiagnosis());
});

// تلاش برای درست کردنِ خودکارِ خرابیِ رایج
router.post('/tunnel/repair', async (req, res) => {
  try {
    const result = await repairTunnel();
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ------------------ آدرس ثابت (مدل فایربیس) — راه‌اندازی یک‌باره ------------------
router.get('/tunnel/named', (req, res) => {
  res.json(namedConfig());
});

// دستورهای دستی — همیشه کار می‌کنند، حتی اگر دکمه‌ها به مشکل بخورند
router.get('/tunnel/named/commands', (req, res) => {
  const bin = publicState().binary || 'cloudflared';
  const host = getSetting('tunnel_hostname', null) || 'sync.example.com';
  const tunnelName = getSetting('tunnel_name', DEFAULT_TUNNEL_NAME);
  res.json({
    binary: bin,
    commands: [
      `"${bin}" tunnel login`,
      `"${bin}" tunnel create ${tunnelName}`,
      `"${bin}" tunnel route dns ${tunnelName} ${host}`,
    ],
  });
});

// گام ۱: ورود به حساب Cloudflare — آدرسی برمی‌گردد که کاربر باید در مرورگر باز کند
router.post('/tunnel/named/login', async (req, res) => {
  try {
    const result = await namedLoginStart();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/tunnel/named/login-status', (req, res) => {
  res.json({ loggedIn: namedLoginDone() });
});

// گام ۲: ساخت تونل و وصل کردن زیردامنه — بعد از این، آدرس برای همیشه ثابت است
router.post('/tunnel/named/setup', async (req, res) => {
  const hostname = String(req.body?.hostname || '').trim();
  // نامِ تونل در حسابِ Cloudflare — اگر تونلِ دیگری دارید، این کنارش
  // ساخته می‌شود و کاری به آن ندارد
  const name = String(req.body?.name || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
    || DEFAULT_TUNNEL_NAME;
  try {
    const result = await namedSetup({ hostname, name });
    if (!result.ok) return res.status(400).json(result);
    logEvent('info', 'panel', `آدرس ثابت سرور: ${result.hostname}`);
    // زیردامنهٔ تونل هم خودکار در بخش دامنه‌ها ثبت می‌شود
    await ensureMainSite({ tunnelHostname: result.hostname }).catch(() => {});
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ساده‌ترین راه: توکنِ تونل از داشبورد Cloudflare
router.post('/tunnel/token', async (req, res) => {
  const { token, hostname } = req.body || {};
  try {
    const result = await tokenSetup({ token, hostname });
    if (!result.ok) return res.status(400).json(result);
    await ensureMainSite({ tunnelHostname: result.hostname }).catch(() => {});
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// افزودن زیردامنهٔ تازه به همان تونل — برای سایت‌های بعدی
router.post('/tunnel/hostname', async (req, res) => {
  const { hostname, port } = req.body || {};
  try {
    const result = await addHostname({ hostname, port });
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/tunnel/hostname', async (req, res) => {
  res.json(await removeHostname(req.query.hostname));
});

router.post('/tunnel/named/reset', async (req, res) => {
  res.json(await namedReset());
});

// آدرس سایتی که لینک یک‌کلیکی با آن ساخته می‌شود
router.put('/site-url', async (req, res) => {
  const url = String(req.body?.siteUrl || '').trim();
  if (!/^https?:\/\/[^\s/]+/i.test(url)) return res.status(400).json({ error: 'invalid_url' });
  setSetting('site_url', url.replace(/\/+$/, ''));
  // همین که آدرس سایت را دادید، خودِ سایت و دامنه‌اش در پنل ثبت می‌شوند
  let registered = null;
  try {
    registered = await ensureMainSite({ siteUrl: siteUrl() });
  } catch (e) {
    logEvent('error', 'panel', `ثبت خودکار سایت ناموفق بود: ${e.message}`);
  }
  res.json({ ok: true, siteUrl: siteUrl(), registered });
});

// ------------------------------- پیام‌رسان --------------------------------
// سرور خانگی پیامک نمی‌فرستد، پس کدِ ورود اینجا به صاحبِ سرور نشان داده
// می‌شود تا خودش به کاربر بدهد. فقط روی پنل است، نه روی پورتِ عمومی.
router.get('/messenger/codes', (req, res) => {
  res.json({ codes: pendingCodes(), stats: messengerSnapshot() });
});

export default router;
