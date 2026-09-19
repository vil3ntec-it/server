// ---------------------------------------------------------------------------
//  پنل مدیریت سرور خانگی — نقطهٔ ورود
//  یک پورت، سه کار:
//    ۱) رابط کاربری و API خودِ پنل            → /  و  /api/*
//    ۲) اطلاعات لحظه‌ای                        → /socket.io/
//    ۳) سرورِ سایتِ پمپ یعقوبی (پروتکل ws)     → همان آدرس، بدون مسیر اضافه
// ---------------------------------------------------------------------------
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';

import { config, ensureDirs, SERVER_ROOT } from './config.js';
import { db, logEvent, pruneEvents, getSetting, setSetting } from './db.js';
import { pruneSessions } from './auth.js';
import { setSiteSync, setStations, setIo, getIo } from './state.js';
import { createSiteSync } from './sitesync/index.js';
import { createStations } from './stations/index.js';
import { startMirror } from './stations/cloud-mirror.js';
import { setMirror } from './state.js';
import { attachRealtime, broadcastMetrics } from './realtime.js';
import { startCollector, stopCollector } from './metrics/index.js';
import { startWinSampler, stopWinSampler } from './metrics/win-sampler.js';
import { readInterfaces } from './metrics/network.js';
import { autostartAll, ensureAllSiteWorkspaces, ensureMainSite } from './sites/registry.js';
import { sitesRoot, ensureSitesRoot } from './sites/root.js';
import { stopAll } from './sites/process.js';
import {
  startTunnel, stopTunnel, tunnelEvents, publicState as tunnelState, reconcileNamedTunnel,
  syncTunnelRoutes,
} from './tunnel.js';
import { versionInfo, versionLine } from './version.js';
import { corsMiddleware, isAllowedOrigin, secureHeaders } from './platform/security.js';
import { createApiV1 } from './routes/v1.js';
import { createPublicApi, apiIndex, publicHealth } from './api/public.js';
import { rateLimit as rateLimitCfg } from './platform/rate-limit.js';
import { handleValidation } from './platform/validate.js';
import { siteTunnelEvents, stopAllSiteTunnels } from './site-tunnels.js';

import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import sitesRoutes from './routes/sites.js';
import domainsRoutes from './routes/domains.js';
import filesRoutes from './routes/files.js';
import logsRoutes from './routes/logs.js';
import networkRoutes from './routes/network.js';
import settingsRoutes from './routes/settings.js';
import siteServerRoutes from './routes/site-server.js';
import stationRoutes, { adminRouter as stationAdminRoutes } from './routes/stations.js';
import messengerRoutes from './routes/messenger.js';
import notifyRoutes, { adminRouter as notifyAdminRoutes } from './routes/notify.js';
import appRoutes, { adminRouter as appAdminRoutes } from './routes/app.js';
import codeRoutes, { adminRouter as codeAdminRoutes } from './routes/codes.js';
import storageRoutes from './routes/storage.js';
import agentRoutes from './routes/agent.js';
import dockerRoutes from './routes/docker.js';
import processRoutes from './routes/processes.js';
import databaseRoutes from './routes/databases.js';
import runtimeRoutes from './routes/runtimes.js';
import cronRoutes from './routes/cron.js';
import { tick as cronTickOnce, reschedule as cronReschedule } from './system/cron.js';
import { pruneAppAuth } from './appauth/index.js';
import { localKey } from './local-key.js';
import { runMigrations, dbVersion } from './lib/migrations.js';
import { startDiscovery, stopDiscovery, serverCard, DISCOVERY_PORT } from './discovery.js';
import { startBackupSchedule, stopBackupSchedule } from './storage/backup.js';
import { pruneAudit as pruneAppAudit } from './lib/audit.js';
import { pruneTickets } from './lib/ws-ticket.js';
import { rateLimit, pruneRateLimits, clientIp } from './lib/rate-limit.js';
import { codeSettings } from './codes/settings.js';
import { pinSitesRoot } from './sites/portable.js';
import { startQueue, stopQueue } from './codes/queue.js';
import { adminEnrollRoute, adminGate, adminHostGate, isAdminHost, GATE_ENROLL, GATE_PREFIX } from './api/admin-gate.js';
import { readyPayload } from './platform/health.js';
import { createBackup } from './backup/index.js';
import * as notify from './notify/index.js';
import * as messenger from './messenger/index.js';
import { accountProxy, probeAccountServer } from './api/account-proxy.js';
import { startAgent, stopAgent } from './agent/index.js';
import { autostartAccountServer, stopAccountServer } from './account/supervisor.js';
import accountServerRoutes from './routes/account-server.js';

// ── مرکز فرمان ────────────────────────────────────────────────────────────
import { ensureControlSchema } from './control/schema.js';
import accountAdminRoutes from './routes/account-admin.js';
import { router as announceRoutes, adminRouter as announceAdminRoutes } from './routes/announce.js';
import diagnosticsRoutes from './routes/diagnostics.js';
import controlRoutes, { agentRouter, appConfigRouter } from './routes/control/index.js';
import { ensureLocalServer } from './routes/control/servers.js';
import { startMonitor, stopMonitor, syncMonitors } from './control/monitor.js';
import { pruneAudit as pruneControlAudit } from './control/audit.js';
import { pruneAlerts, alertEvents } from './control/alerts.js';
import { monitorEvents } from './control/monitor.js';
import { startUpdateWatcher, stopUpdateWatcher } from './update/github.js';
import { requireAuth } from './auth.js';
import { writeNeedsOperator } from './control/roles.js';

const PUBLIC_DIR = path.join(SERVER_ROOT, 'public');
const PID_FILE = path.join(config.dataDir, 'panel.pid');
const CONNECT_PAGE = path.join(SERVER_ROOT, 'src', 'appauth', 'connect.html');

/** صفحهٔ راهنمای اتصال — روی هر دو پورت (پنل و پورتِ عمومی) سرو می‌شود */
function serveConnectPage(req, res) {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(CONNECT_PAGE);
}

ensureDirs();

// نسخهٔ دیتابیس اول بالا می‌آید — پیش از هر چیزی که به جدول‌ها دست بزند
const migration = runMigrations();
if (migration.ran.length) {
  console.log(`[دیتابیس] ${migration.ran.length} تغییر اعمال شد → نسخهٔ ${migration.to}`);
}
if (migration.failed) {
  console.error(`❌ تغییرِ دیتابیس شمارهٔ ${migration.failed.id} انجام نشد: ${migration.failed.error}`);
}

// جدول‌های مرکز فرمان پیش از هر پرس‌وجویی ساخته/به‌روز می‌شوند
ensureControlSchema();
// کلیدِ محلی همین اول ساخته می‌شود تا «برنامهٔ سرور خانگی» روی همین کامپیوتر
// بتواند بدونِ ورودِ دستی، برنامه‌ها و تنظیمات را اداره کند.
localKey();

// نصبِ قدیمی نباید با عوض‌شدنِ پیش‌فرضِ «ریشهٔ سایت‌ها» تکان بخورد — اگر
// سایت‌هایش بیرونِ پوشهٔ داده‌اند، همان‌جا ثبت می‌شوند و جابه‌جایی وقتی
// انجام می‌شود که خودِ صاحبِ سرور بخواهد.
pinSitesRoot();

// شمارهٔ پروسه روی دیسک می‌ماند تا اسکریپت‌های سرویس (وقتی پنجره‌ای باز نیست)
// بتوانند همین سرور را پیدا و متوقف کنند.
try {
  fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
} catch { /* اگر ننوشت، فقط توقفِ خودکار سخت‌تر می‌شود */ }

const app = express();
app.disable('x-powered-by');

// اگر پشتِ reverse proxy هستیم، Express باید بداند تا req.ip و req.secure درست باشند
if (config.trustProxy) app.set('trust proxy', true);

app.use(secureHeaders);

/* ── CORS ────────────────────────────────────────────────────────────────────
   پیش از این هر سایتی در دنیا می‌توانست با کوکی و توکنِ کاربر به این سرور
   درخواست بزند. حالا:

     • مسیرهای «برنامه‌ها» (/api/app) عمداً برای همه باز است — اپِ اندروید و
       سایتِ روی هاست باید بتوانند صدا بزنند — ولی چون با هدرِ Authorization
       کار می‌کند نه کوکی، credentials را نمی‌دهیم؛ پس مرورگرِ قربانی
       نمی‌تواند نشستِ او را سوءاستفاده کند.
     • بقیهٔ مسیرها فقط از خودِ همین کامپیوتر، شبکهٔ خانگی، یا آدرسِ تونل.
     • هر مبدأ دیگری: بدونِ هدرِ CORS، یعنی مرورگر خودش جلویش را می‌گیرد.
   ── */
const PRIVATE_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.[\d.]+|192\.168\.[\d.]+|172\.(1[6-9]|2\d|3[01])\.[\d.]+)(:\d+)?$/i;

function originAllowed(origin) {
  if (!origin) return true;                       // curl و اپِ موبایل اصلاً Origin ندارند
  if (PRIVATE_ORIGIN.test(origin)) return true;   // خودِ کامپیوتر و شبکهٔ خانگی
  try {
    const tunnel = tunnelState().url;
    if (tunnel && origin === tunnel) return true; // آدرسِ اینترنتیِ خودمان
  } catch { /* تونل هنوز بالا نیامده */ }
  const extra = getSetting('allowed_origins', []) || [];
  return Array.isArray(extra) && extra.includes(origin);
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  // فقط مسیرهای «برنامه‌ها» برای همه بازند؛ بقیه — /health هم — از فهرستِ سفید می‌گذرند
  // مسیرِ کدهای شش‌رقمی هم مثلِ «برنامه‌ها» باز است: اپِ اندروید، سایتِ روی
  // هاست و برنامهٔ ویندوز همه از بیرون صدایش می‌زنند. با کلیدِ هدر کار می‌کند
  // نه کوکی، پس credentials نمی‌گیرد و نشستِ کسی سوءاستفاده نمی‌شود.
  const openApi = req.path.startsWith('/api/app/') || req.path.startsWith('/api/codes/');

  if (openApi) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    // عمداً بدونِ credentials: توکن با هدر می‌آید، نه با کوکی
  } else if (!origin || originAllowed(origin) || isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else if (req.method === 'OPTIONS') {
    // preflightِ مبدأِ ناشناس: بدونِ هدرِ اجازه، با پاسخِ صریح
    return res.status(403).end();
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key, X-Local-Key, X-Read-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

/* ── محدودیتِ نرخ ────────────────────────────────────────────────────────────
   ورود و کدِ یک‌بارمصرف سخت‌گیرانه‌تر است، چون هدفِ حدس‌زدن‌اند.

   ⚠️ همهٔ سقف‌ها از محیط قابلِ تنظیم‌اند. دلیلش فقط انعطاف نیست: بی این،
   آزمونِ فشار نمی‌تواند *ظرفیتِ خودِ سرور* را بسنجد، چون همین سقف‌ها جلوش
   را می‌گیرند و عدد به‌دست‌آمده سقفِ نرخ می‌شود نه سقفِ سرور. (اولین باری
   که آزمونِ فشار اجرا شد، ۴۰۰ تا از ۱۰۰۰ درخواست ۴۲۹ گرفتند.) */
const cap = (name, fallback) => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
};

app.use('/api/auth/login', rateLimit('login', cap('HLP_RATE_LOGIN', 10), 5 * 60 * 1000));
app.use('/api/auth/setup', rateLimit('setup', cap('HLP_RATE_SETUP', 5), 60 * 60 * 1000));
app.use('/api/app/auth', rateLimit('app-auth', cap('HLP_RATE_APP_AUTH', 60), 10 * 60 * 1000));
/*
 *  کدهای شش‌رقمی سقفِ خودش را دارد و عمداً بلند است: خواسته این بود که اگر
 *  صدها یا هزاران نفر هم‌زمان کد خواستند، هیچ‌کس پشتِ در نماند.
 *
 *  ⚠️ ولی «بلند» یعنی بلند، نه «هیچ». پیش از این ۶۰۰۰ در دقیقه بود که
 *  عملاً سقفی نیست. جلوی سوءاستفاده را دو چیزِ دیگر می‌گیرند — فاصلهٔ
 *  اجباریِ هر ایمیل و سقفِ ساعتیِ ایمیل/IP در خودِ موتور — و این سقف
 *  فقط نمی‌گذارد یک اسکریپت کلِ سرور را بکوبد.
 *
 *  سقفِ عمومیِ /api عمداً از این مسیر رد می‌شود، وگرنه همان ۱۲۰۰ زودتر سر می‌رسد.
 */
app.use('/api/codes', rateLimit('codes', cap('HLP_RATE_CODES', 600), 60 * 1000));
app.use('/api/notify', rateLimit('notify', cap('HLP_RATE_NOTIFY', 240), 60 * 1000));
app.use('/api/messenger', rateLimit('messenger', cap('HLP_RATE_MESSENGER', 600), 60 * 1000));

/*  ══ سهمِ هر پمپ، جدا از پمپِ همسایه ══════════════════════════════════════
    یک سرور می‌تواند چند پمپ داشته باشد (‎data/stations/<کد>‎)، و برنامهٔ
    کامپیوتر و همهٔ گوشی‌های یک پمپ از **یک آی‌پیِ محلی** می‌آیند. با سطلِ
    مشترکِ آی‌پی، یک پمپِ پرکار می‌توانست سهمِ پمپ‌های دیگرِ همان سرور را
    تمام کند و آن‌ها ‎429‎ بگیرند.

    تستِ فشار (‎test/stations-load.mjs‎) همین را نشان داد: با ۲۰۰ پمپ و پنج
    دور نوشتن، خواندن‌های بعدی همه ‎429‎ شدند.

    ⚠️ **دو سطل، نه یکی.** سطلِ «هر پمپ» تنهایی یک درِ باز می‌شد: کسی که کدِ
    ساختگیِ تازه می‌سازد، هر بار سطلِ خالیِ تازه می‌گرفت و سقفِ آی‌پی را دور
    می‌زد. پس سطلِ آی‌پی هم می‌ماند، با سقفِ بلندتر — چون یک پمپِ سالم
    (برنامه + چند گوشی) از یک آی‌پی می‌آید و نباید به هم بخورد.             */
app.use('/api/stations', rateLimit('stations-ip', cap('HLP_RATE_STATIONS_IP', 3000), 60 * 1000));
app.use('/api/stations', rateLimit('stations', cap('HLP_RATE_STATIONS', 1200), 60 * 1000, {
  keyOf: (req) => {
    const code = String(req.path || '').split('/').filter(Boolean)[0] || '';
    return /^[a-z0-9_-]{1,48}$/i.test(code) ? 'stn:' + code.toLowerCase() : clientIp(req);
  },
}));

/*  سطلِ عمومیِ آی‌پی — کدها و مسیرهای پمپ سطلِ خودشان را دارند و این‌جا
    دوباره شمرده نمی‌شوند، وگرنه همان سقفِ آی‌پی اصلاحِ بالا را بی‌اثر
    می‌کرد (خودِ تستِ فشار همین را گرفت: هر دو سطل می‌دویدند).              */
const apiLimiter = rateLimit('api', cap('HLP_RATE_API', 1200), 60 * 1000);
app.use('/api', (req, res, next) =>
  req.path.startsWith('/codes/') || req.path === '/codes'
  || req.path.startsWith('/stations')
    ? next()
    : apiLimiter(req, res, next)
);

// بدنهٔ JSON فقط برای مسیرهایی که JSON می‌گیرند (آپلود فایل خام است)
const MSG_LIMIT = `${Math.max(1, Math.round(config.messengerMaxBytes / (1024 * 1024)))}mb`;
app.use((req, res, next) => {
  if (req.path === '/api/files/upload' || req.path === '/api/settings/logo') return next();
  // پشتیبانِ پمپ فایلِ خامِ SQLite است، نه JSON — مسیرِ خودش ‎express.raw‎ دارد
  if (/^\/api\/stations\/[^/]+\/backup$/.test(req.path)) return next();
  // گزارشِ Agent باید خام بماند تا امضایش قابلِ سنجش باشد
  if (req.path.startsWith('/api/control/agent')) return next();
  // پیام‌رسان سقفِ خودش را دارد تا پیام‌های بلند رد نشوند
  const limit = req.path.startsWith('/api/messenger') ? MSG_LIMIT : '5mb';
  express.json({ limit })(req, res, next);
});

// ------------------------------- سلامت -------------------------------------
// همان پاسخی که سرور قدیمیِ سایت می‌داد تا تستِ «آیا سرور بالاست؟» کار کند
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'pump-yaqobi-server',
    panel: 'homelab-panel',
    // با باز کردن همین آدرس معلوم می‌شود کدام نسخه واقعاً بالاست
    version: versionInfo.version,
    build: versionInfo.build,
    root: versionInfo.root,
    db: dbVersion(),
    time: new Date().toISOString(),
  });
});

// -------------------------------- API --------------------------------------
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/sites', sitesRoutes);
app.use('/api/domains', domainsRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/network', networkRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/site-server', siteServerRoutes);
// بخشِ پمپ‌بنزین‌ها: روترِ عمومی با رمزِ خودِ پمپ، روترِ پنل پشتِ ورودِ پنل
app.use('/api/stations', stationRoutes);
app.use('/api/stations-admin', stationAdminRoutes);
app.use('/api/messenger', messengerRoutes);
app.use('/api/notify', notifyRoutes);
app.use('/api/notify-admin', notifyAdminRoutes);
// ورودِ کاربرانِ برنامه‌ها (اپِ اندروید، برنامهٔ ویندوز، سایت‌ها) با کدِ شش‌رقمی
/*
 *  ── نشانیِ احراز هویت، با نسخه ─────────────────────────────────────────
 *
 *  ⚠️ چرا لازم شد: چند برنامهٔ نیتیو و چند سایت به این سرور وصل می‌شوند و
 *  همه با هم به‌روز نمی‌شوند. برنامه‌ای که روی گوشیِ کسی نصب است، ماه‌ها
 *  همان نسخه می‌ماند. اگر روزی شکلِ پاسخی عوض شود، بی نسخه‌بندی همهٔ آن‌ها
 *  با هم می‌شکنند و هیچ راهی جز «همه باید به‌روز شوند» نمی‌ماند.
 *
 *  ⚠️ و `/api/app` عمداً *دقیقاً همان روتر* است، نه یک نسخهٔ منجمد:
 *  برنامه‌های موجود از همان‌جا حرف می‌زنند و هیچ‌کدام نباید امروز بشکنند.
 *  یعنی امروز هر دو یک چیزند. فایدهٔ نسخه‌بندی روزی است که v2 بیاید:
 *  آن‌وقت v1 همین‌جا می‌ماند و برنامه‌های قدیمی سرِ جایشان کار می‌کنند.
 *
 *  ⚠️ و چرا /api/v1/app و نه /api/v1/auth: آن نشانی مالِ **سرورِ حساب**
 *  است (shop/server — ثبت‌نام، ورود، نشستِ برنامه‌ها) و درگاهِ
 *  api/account-proxy.js آن را از پورتِ عمومی به همان می‌برد. این پنل
 *  فقط یک سیستمِ ورود دارد: ورود با کدِ ایمیلی برای برنامه‌ها (این‌جا)
 *  و نام/رمزِ خودِ پنل برای مدیر. دفترِ حساب یکی است و این‌جا نیست.
 *
 *  برنامهٔ تازه باید /api/v1/app را بزند.
 */
app.use('/api/v1/app', appRoutes);
app.use('/api/app', appRoutes);
app.use('/api/app-admin', appAdminRoutes);
app.use('/api/diagnostics', diagnosticsRoutes);
app.use('/api/announce', announceRoutes);
app.use('/api/announce-admin', announceAdminRoutes);
app.use('/api/codes', codeRoutes);
app.use('/api/codes-admin', codeAdminRoutes);
// کتابخانه: یک جای مرتب برای سایت‌ها، برنامه‌ها، پشتیبان‌ها و فایل‌های موقت
app.use('/api/storage', storageRoutes);
// دستیارِ هوشمند — فقط پورتِ پنل؛ خواندن برای همه، گفت‌وگو و تأیید دستِ‌کم operator
app.use('/api/agent', requireAuth, writeNeedsOperator, agentRoutes);
app.use('/api/account-server', accountServerRoutes);
// مدیریتِ Docker — خواندن برای همه، کارها برای operator، حذف فقط admin
app.use('/api/docker', dockerRoutes);
// فهرستِ پروسه‌ها — دیدن برای همه، فرستادنِ سیگنال فقط admin
app.use('/api/processes', processRoutes);
// دیتابیس‌های کاربر (MySQL/MariaDB و PostgreSQL) — رمز در گاوصندوق می‌ماند
app.use('/api/databases', databaseRoutes);
// نسخه‌های Node و Python
app.use('/api/runtimes', runtimeRoutes);
// کارهای زمان‌بندی‌شده — زمان‌بندِ خودِ پنل، نه crontab سیستم
app.use('/api/cron', cronRoutes);

// ── مرکز فرمان ────────────────────────────────────────────────────────────
// Agentها و خودِ برنامه‌ها درِ ورودیِ خودشان را دارند (امضای HMAC / توکنِ پروژه)
app.use('/api/control/agent', agentRouter);
app.use('/api/app-config', appConfigRouter);
// بقیهٔ مرکز فرمان فقط برای مدیرِ واردشده
// خواندن برای همه، نوشتن دستِ‌کم برای operator، و کارهای حساس فقط برای admin
app.use('/api/control', requireAuth, writeNeedsOperator, controlRoutes);
// حساب‌ها، اشتراک‌ها، پلن‌ها و پشتیبانیِ دکان — از سرورِ حساب، با ورودِ پنل
// (پلِ routes/account-admin.js؛ هیچ دفترِ حسابی این‌جا نیست)
app.use('/api/account-admin', requireAuth, writeNeedsOperator, accountAdminRoutes);

/*
 *  قراردادِ رسمیِ پنل، نسخه‌دار.
 *
 *  عمداً روی /api/v1 ننشسته: آن مسیر مالِ APIِ برنامهٔ توحید است و اپ‌هایی
 *  که همین حالا بیرون‌اند /api/v1/auth/login را صدا می‌زنند. دو معنیِ
 *  متفاوت برای یک آدرس یعنی یکی از دو برنامه می‌شکند، پس API پنل پیشوندِ
 *  خودش را دارد. مسیرهای بی‌پیشوندِ /api هم مثل قبل سرِ جایشان‌اند.
 */
// ورود تنها درِ باز است. فقط تلاش‌های **ناموفق** شمرده می‌شوند تا کاربری که
// رمزش را درست می‌زند قفل نشود.
const authLimiter = rateLimitCfg({
  name: 'auth',
  max: Number(process.env.HLP_AUTH_RATE_LIMIT ?? 10),
  windowMs: Number(process.env.HLP_AUTH_RATE_WINDOW ?? 900) * 1000,
  skipSuccess: true,
});
for (const base of ['/api', '/api/panel/v1']) {
  app.use(`${base}/auth/login`, authLimiter);
  app.use(`${base}/auth/setup`, authLimiter);
  app.use(`${base}/auth/change-password`, authLimiter);
}

app.use('/api/panel/v1', createApiV1());

app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

// «الان می‌تواند کار کند؟» — برخلافِ /health، دیتابیس و دیسک را واقعاً می‌زند،
// تا ناظرِ سرویس پروسهٔ سالمی را که فقط کند شده نکشد.
app.get('/ready', (req, res) => {
  const payload = readyPayload();
  res.status(payload.ready ? 200 : 503).json(payload);
});

// صفحهٔ «اتصالِ برنامه‌ها» — آدرسِ سرور، تستِ زندهٔ ورود با کد، و کدِ آمادهٔ
// اندروید/ویندوز/سایت. همان چیزی که باید به سازندهٔ برنامه بدهید.
app.get(['/connect', '/اتصال'], serveConnectPage);


// ---------------------------- رابط کاربری ----------------------------------
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(
    express.static(PUBLIC_DIR, {
      index: 'index.html',
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        else if (/\.[0-9a-f]{8}\.(js|css)$/.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (filePath.endsWith('.woff2')) {
          // فونت‌ها نامِ ثابت دارند ولی هرگز عوض نمی‌شوند؛ بدونِ این هدر،
          // مرورگر هر بار یک درخواستِ ۳۰۴ می‌زند و بارِ اولِ هر صفحه کند می‌شود
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    })
  );
  // مسیرهای داخلی SPA
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res
      .status(200)
      .type('text/plain; charset=utf-8')
      .send('رابط کاربری هنوز ساخته نشده است. در پوشهٔ web دستور «npm install && npm run build» را اجرا کنید.');
  });
}

// ورودیِ بد باید ۴۰۰ بدهد نه ۵۰۰ — و ۵۰۰ نباید جزئیاتِ داخلی لو بدهد
app.use(handleValidation);

app.use((err, req, res, next) => {
  logEvent('error', 'panel', `${req.method} ${req.path} → ${err.message}`);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'internal_error', message: err.message });
});

// ------------------------------ راه‌اندازی ----------------------------------

/**
 * اگر گواهی داده شده باشد، پنل خودش https سرو می‌کند؛ وگرنه http.
 * فایل‌های گواهی همین‌جا خوانده می‌شوند تا اگر مسیرشان غلط بود، همان اول
 * با پیامِ روشن بفهمیم — نه وسطِ کار.
 */
function createServer() {
  const { cert, key } = config.tls;
  if (!cert && !key) return { server: http.createServer(app), secure: false };
  if (!cert || !key) {
    console.error('❌ برای https هم HLP_TLS_CERT و هم HLP_TLS_KEY لازم است.');
    process.exit(1);
  }
  try {
    const options = { cert: fs.readFileSync(cert), key: fs.readFileSync(key) };
    if (process.env.HLP_TLS_CA) options.ca = fs.readFileSync(process.env.HLP_TLS_CA);
    return { server: https.createServer(options, app), secure: true };
  } catch (e) {
    console.error(`❌ گواهی خوانده نشد: ${e.message}`);
    console.error(`   cert: ${cert}`);
    console.error(`   key:  ${key}`);
    process.exit(1);
  }
}

const { server: httpServer, secure: panelSecure } = createServer();

// وقتی https روشن است، یک شنوندهٔ کوچکِ http فقط آدرس را عوض می‌کند
let redirectServer = null;
if (panelSecure && config.tls.redirectHttp) {
  const redirectPort = config.tls.redirectPort || (config.port === 443 ? 80 : config.port + 1);
  redirectServer = http.createServer((req, res) => {
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    const suffix = config.port === 443 ? '' : `:${config.port}`;
    res.writeHead(301, { location: `https://${host}${suffix}${req.url}` });
    res.end();
  });
  redirectServer.on('error', (e) => {
    console.warn(`⚠️  شنوندهٔ تغییرِ مسیرِ http بالا نیامد (${e.code}) — https خودش کار می‌کند.`);
    redirectServer = null;
  });
  redirectServer.listen(redirectPort, config.host);
}
export const scheme = panelSecure ? 'https' : 'http';

// ۱) Socket.IO (روی مسیر /socket.io/)
const io = attachRealtime(httpServer);
setIo(io);

// ۲) سرورِ سایت روی همان پورت — هر ارتقای WebSocket که مسیرش /socket.io نباشد
// بخشِ پمپ‌بنزین‌ها — پیش از سرورِ سایت ساخته می‌شود چون مسیرِ ارتقایش
// باید *قبل* از دفترِ همه‌کارهٔ site-sync سنجیده شود.
let stations = null;
if (config.stations.enabled) {
  stations = createStations({ dataDir: config.stations.dataDir, enroll: config.stations.enroll });
  setStations(stations);
  //  آینهٔ ابر در پوشهٔ داده — حساب‌ها و اشتراک‌های پمپ و دکان، فقط‌خواندنی
  setMirror(startMirror({
    dataDir: config.dataDir,
    log: (m) => logEvent('info', 'stations', m),
  }));
}

let siteSync = null;
if (config.siteSync.enabled) {
  siteSync = createSiteSync({ dataDir: config.siteSync.dataDir, token: config.siteSync.token });
  setSiteSync(siteSync);

  httpServer.on('upgrade', (req, socket, head) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url, 'http://x').pathname;
    } catch { /* مسیر خراب */ }
    if (pathname.startsWith('/socket.io')) return; // مالِ Socket.IO است
    if (pathname.startsWith('/messenger')) return messenger.handleUpgrade(req, socket, head);
    if (pathname.startsWith('/notify')) return notify.handleUpgrade(req, socket, head);
    if (stations?.ownsPath(pathname)) return stations.handleUpgrade(req, socket, head);
    siteSync.handleUpgrade(req, socket, head);
  });
}

// پیام‌رسان، اعلان و پمپ‌ها. اگر سرورِ سایت خاموش باشد هیچ شنوندهٔ upgrade ای
// وجود ندارد، پس اینجا خودمان یکی می‌گذاریم — وگرنه این قابلیت فقط در یک
// پیکربندیِ خاص کار می‌کرد.
if (!config.siteSync.enabled) {
  httpServer.on('upgrade', (req, socket, head) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url, 'http://x').pathname;
    } catch { /* مسیر خراب */ }
    if (pathname.startsWith('/socket.io')) return;
    if (pathname.startsWith('/messenger')) return messenger.handleUpgrade(req, socket, head);
    if (pathname.startsWith('/notify')) return notify.handleUpgrade(req, socket, head);
    if (stations?.ownsPath(pathname)) return stations.handleUpgrade(req, socket, head);
    socket.destroy();
  });
}

// ۲.۵) پورت دومِ اختیاری — فقط سرورِ سایت، بدون پنل و بدون API
// برای وقتی که می‌خواهید از اینترنت (مثلاً Cloudflare Tunnel) وصل شوید ولی
// فایل‌منیجر و کنترل پروسه‌های پنل به بیرون درز نکند.
let syncOnlyServer = null;
if (siteSync && config.siteSync.port && config.siteSync.port !== config.port) {
  // روی پورت عمومی فقط دو چیز سرو می‌شود: سرورِ داده و پیام‌رسان.
  // پنل، فایل‌منیجر و کنترل پروسه‌ها هرگز به اینترنت درز نمی‌کنند.
  const publicApp = express();
  publicApp.disable('x-powered-by');
  if (config.trustProxy) publicApp.set('trust proxy', true);
  publicApp.use(secureHeaders);
  publicApp.use((req, res, next) => {
    // این پورت عمداً عمومی است (اپ‌ها از اینترنت می‌آیند) ولی بدونِ credentials
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Vary', 'Origin');
    //  ⚠️ X-App-* را برنامه‌ها روی هر درخواست می‌فرستند (اپِ کارمندان از مرورگر
    //  هم). بی این‌ها پیش‌پروازِ CORS رد می‌شد و ورودِ اپ بی هیچ پیامی می‌مرد.
    res.setHeader('Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Api-Key, X-Read-Key, X-App-Id, X-App-Version, X-App-Platform, X-Requested-With');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
  publicApp.use('/api/app/auth', rateLimit('pub-app-auth', 60, 10 * 60 * 1000));
  publicApp.use('/api/notify', rateLimit('pub-notify', 240, 60 * 1000));
  publicApp.use('/api', rateLimit('pub-api', 1200, 60 * 1000));

  /*
   *  درِ مدیر — تنها راهی که برنامهٔ «ویلن ادمین» از اینترنت به کلِ سرور
   *  می‌رسد. هر چیزِ دیگری روی این پورت همان‌قدر عمومی می‌ماند که بود.
   *
   *  ⚠️ سقفِ نرخ فقط شکست‌ها را می‌شمارد (skipSuccess): برنامهٔ مدیر هر چند
   *  ثانیه سر می‌زند و نباید قفل شود، ولی کسی که کلید را حدس می‌زند بعد از
   *  بیست تلاشِ ناموفق در ده دقیقه می‌ماند پشتِ در.
   *
   *  ⚠️ و **پیش از** express.json می‌نشیند: آن میان‌افزار جریانِ بدنه را
   *  می‌خورد و بعدش دیگر چیزی برای لوله کردن نمی‌ماند.
   */
  const gateLimiter = rateLimitCfg({
    name: 'admin-gate', max: 20, windowMs: 10 * 60 * 1000, skipSuccess: true,
  });

  /*
   *  دو راه به یک در:
   *
   *    admin.<دامنه>/...            ← آدرسی که در برنامه می‌نشیند
   *    <هر دامنه>/api/admin-gate/... ← همان در، وقتی زیردامنه نیست
   *
   *  اولی برای کاربر ساده‌تر است (آدرسِ کوتاه و جدا از سایت)، دومی برای
   *  وقتی که هنوز دامنه‌ای ساخته نشده و فقط آدرسِ تونل هست.
   */
  /*
   *  کلیدِ بارِ اول — و تنها چیزی که بی کلید جواب می‌دهد.
   *
   *  ⚠️ باید *پیش از* دو خطِ پایین بنشیند، وگرنه خودِ در می‌بلعدش و بی
   *  کلید ۴۰۴ می‌دهد — یعنی دقیقاً همان بن‌بستی که می‌خواهد باز کند.
   *
   *  ⚠️ و express.json مخصوصِ خودش را دارد: میان‌افزارِ عمومیِ JSON پایین‌تر
   *  است و این‌جا هنوز اجرا نشده، ولی در بی بدنه هم کار می‌کند و نباید
   *  جریانِ بقیهٔ مسیرها خورده شود. سقفِ چهار کیلوبایت برای یک نام و رمز
   *  بیش از کافی است.
   *
   *  ⚠️ شمارنده‌اش سخت‌تر از خودِ در است: ده تلاشِ ناموفق در ساعت. برنامه
   *  یک بار در عمرش این‌جا می‌آید؛ کسی که رمز حدس می‌زند، هر بار.
   */
  publicApp.post(
    GATE_ENROLL,
    rateLimitCfg({ name: 'admin-enroll', max: 10, windowMs: 60 * 60 * 1000, skipSuccess: true }),
    express.json({ limit: '4kb' }),
    adminEnrollRoute,
  );

  /*
   *  ⛔ شمارندهٔ در فقط ترافیکِ **خودِ در** را می‌شمارد (میزبانِ admin. و
   *  GATE_PREFIX) — نه هر درخواستِ این پورت را. تا پیش از این روی همه‌چیز
   *  نشسته بود و هر پاسخِ ۴۰۰ به بالا (رمزِ غلطِ یک کاربر، ۴۰۴، سرورِ حسابِ
   *  خاموش) یک شکست حساب می‌شد؛ بیست تا در ده دقیقه یعنی همان IP از کلِ
   *  api.<دامنه> — حساب، پمپ، اپِ کارمندان، همه — ۴۲۹ می‌گرفت. با درِ سرورِ
   *  حساب که ۴۰۱های واقعی می‌آورد، این تله دیگر نظری نبود. خواستهٔ صریحِ
   *  صاحب ریپو (۱۴۰۵/۰۷/۰۲): «شمارنده را به درِ مدیر محدود کن.»
   *  حدس زدنِ کلید همچنان همان بیست تلاش در ده دقیقه را دارد.
   */
  publicApp.use((req, res, next) => (isAdminHost(req) ? gateLimiter(req, res, next) : next()), adminHostGate);
  publicApp.use(GATE_PREFIX, gateLimiter, adminGate);

  /*
   *  🪪 درِ سرورِ حساب — همان حلقهٔ گم‌شده‌ای که «هیچ لاگینی کار نمی‌کند» را
   *  ساخته بود. هرچه مالِ shop/server است (حساب، پمپ، دکان، پلن، پنلِ
   *  مدیریت) از همین‌جا به آن سپرده می‌شود؛ مسیرهای خودِ این سرور دست
   *  نمی‌خورند. پیش از express.json، چون بدنه جریانی می‌رود.
   */
  publicApp.use(accountProxy);
  publicApp.use(express.json({ limit: MSG_LIMIT }));
  /*
   *  «mode» می‌گوید این جواب از کدام پورت آمده.
   *
   *  از بیرون هر دو پورت /health دارند و جوابشان شبیهِ هم است، پس وقتی تونل
   *  به پورتِ اشتباه (پورتِ پنل) وصل شده باشد هیچ راهی نبود که از خودِ جواب
   *  بفهمیم — و همین یک بار وقتِ زیادی برد. حالا پورتِ عمومی خودش را معرفی
   *  می‌کند و آزمونِ تونل هم همین را می‌سنجد.
   */
  publicApp.get('/health', (req, res) => res.json({ ...publicHealth(), mode: 'sync-only' }));
  // ریشه: همان فهرستی که /api می‌دهد — کسی که آدرسِ عمومی را باز می‌کند،
  // اول از همه باید ببیند این سرور چیست و از کجا شروع کند.
  publicApp.get('/', (req, res) => res.json(apiIndex(req)));

  /*
   *  APIِ عمومی — یک‌جا، در src/api/public.js.
   *
   *  تونل عمداً روی این پورت باز می‌شود تا پنل و فایل‌منیجر و ترمینال هرگز
   *  به اینترنت درز نکنند؛ آن تصمیم درست است و سرِ جایش می‌ماند. ولی تا
   *  حالا هر مسیرِ عمومی جداگانه این‌جا سوار می‌شد و هیچ فهرستِ واحدی از
   *  «چه چیزی عمومی است» وجود نداشت — یک بار همین باعث شد برنامهٔ مشتری و
   *  مدیریت هر دو از راهِ تونل «not found» بگیرند.
   *
   *  حالا هرچه عمومی است داخلِ همان ماژول است و هرچه آن‌جا نیست عمومی
   *  نمی‌شود: /api/control، فایل‌ها و پروسه‌ها همان‌طور خصوصی می‌مانند.
   */
  publicApp.use('/api', createPublicApi());
  publicApp.get(['/connect', '/اتصال'], serveConnectPage);
  publicApp.use((req, res) => res.status(404).type('text/plain; charset=utf-8').send('not found'));

  syncOnlyServer = http.createServer(publicApp);
  syncOnlyServer.on('upgrade', (req, socket, head) => {
    // پیام‌رسان هم باید از راه تونل در دسترس باشد
    let pathname = '/';
    try {
      pathname = new URL(req.url, 'http://x').pathname;
    } catch { /* مسیر خراب */ }
    if (pathname.startsWith('/messenger')) return messenger.handleUpgrade(req, socket, head);
    if (pathname.startsWith('/notify')) return notify.handleUpgrade(req, socket, head);
    if (stations?.ownsPath(pathname)) return stations.handleUpgrade(req, socket, head);
    siteSync.handleUpgrade(req, socket, head);
  });
  syncOnlyServer.on('error', (e) => {
    console.error(`❌ پورت سرورِ سایت (${config.siteSync.port}) بالا نیامد: ${e.message}`);
    logEvent('error', 'panel', `پورت سرورِ سایت بالا نیامد: ${e.message}`);
  });
}

// وضعیت تونل به‌صورت زنده به پنل فرستاده می‌شود
tunnelEvents.on('change', (payload) => {
  try {
    getIo()?.emit('tunnel', payload);
  } catch { /* هنوز کسی وصل نیست */ }
});

// آدرس اینترنتیِ هر سایت هم به‌محض آماده شدن در پنل دیده می‌شود
siteTunnelEvents.on('change', (payload) => {
  try {
    getIo()?.emit('site:tunnel', payload);
  } catch { /* هنوز کسی وصل نیست */ }
});

// مرکز فرمان: هشدارها و نتیجهٔ بررسی‌ها زنده به پنل می‌روند
alertEvents.on('alert', (payload) => {
  try {
    getIo()?.emit('control:alert', payload);
  } catch { /* هنوز کسی وصل نیست */ }
});
alertEvents.on('cleared', (payload) => {
  try {
    getIo()?.emit('control:alert-cleared', payload);
  } catch { /* هنوز کسی وصل نیست */ }
});
monitorEvents.on('result', ({ monitor, result }) => {
  try {
    getIo()?.emit('control:monitor', {
      id: monitor.id,
      kind: monitor.kind,
      refId: monitor.ref_id,
      projectId: monitor.project_id,
      label: monitor.label,
      status: result.status,
      code: result.code ?? null,
      latencyMs: result.latencyMs ?? null,
      at: result.checkedAt ?? Date.now(),
    });
  } catch { /* هنوز کسی وصل نیست */ }
});
// ۲.۹) کشفِ خودکار — تا اپ‌ها بدونِ دانستنِ IP سرور را پیدا کنند
if ((process.env.HLP_DISCOVERY ?? '1') !== '0') startDiscovery();

// ۲.۹۵) پشتیبانِ زمان‌بندی‌شده — اگر کاربر روشنش کرده باشد
startBackupSchedule();

// ۳) معیارهای زنده
// روی ویندوز یک پروسهٔ PowerShell دائمی به‌جای ده‌ها بار باز و بسته کردن آن
startWinSampler();
startCollector((snapshot) => {
  broadcastMetrics(getIo(), snapshot);
});

// نگهداری دوره‌ای
const housekeeping = setInterval(() => {
  pruneSessions();
  pruneAppAuth();
  pruneRateLimits();
  pruneTickets();
  pruneAppAudit();
  pruneEvents();
  pruneControlAudit();
  pruneAlerts();
}, 15 * 60 * 1000);
housekeeping.unref?.();

// بکاپِ خودکار.
//
// چرا با شمارنده و نه cron: یک سرورِ خانگی مرتب خاموش و روشن می‌شود. یک
// زمان‌بندیِ ساعتی («هر شب ۳ بامداد») روی کامپیوتری که شب‌ها خاموش است
// هرگز اجرا نمی‌شود. شمارندهٔ «هر ۲۴ ساعت از آخرین بکاپ» با هر الگوی
// روشن‌بودنی کار می‌کند.
const BACKUP_EVERY_MS = 24 * 3600 * 1000;
if (config.backupSchedule) {
  const backupTick = setInterval(() => {
    try {
      const last = getSetting('last_backup_at', 0);
      if (Date.now() - last < BACKUP_EVERY_MS) return;
      const entry = createBackup({ reason: 'scheduled' });
      setSetting('last_backup_at', Date.now());
      logEvent('info', 'panel', `بکاپِ خودکار گرفته شد: ${entry.file}`);
    } catch (e) {
      logEvent('error', 'panel', `بکاپِ خودکار ناموفق بود: ${e.message}`);
    }
  }, 30 * 60 * 1000);
  backupTick.unref?.();
}

/*
 *  زمان‌بندِ کارها.
 *
 *  هر دقیقه، چون کوچک‌ترین واحدِ cron دقیقه است. ملاکِ اجرا next_run_at
 *  ذخیره‌شده است، نه تطبیقِ دوبارهٔ الگو — پس اگر پنل چند دقیقه خواب بوده
 *  یا تازه بالا آمده، کارِ عقب‌افتاده همان بارِ اول اجرا می‌شود.
 */
cronReschedule();
const cronTick = setInterval(() => {
  cronTickOnce().catch((e) => logEvent('error', 'cron', `تیکِ زمان‌بند ناموفق بود: ${e.message}`));
}, 60 * 1000);
cronTick.unref?.();

async function main() {
  if (stations) {
    const loaded = await stations.loadAll();
    if (loaded.length) console.log(`[stations] ${loaded.length} پمپ بنزین بازخوانی شد: ${loaded.join(', ')}`);
  }

  if (siteSync) {
    await siteSync.ensureToken();
    const loaded = await siteSync.loadFromDisk();
    if (loaded.length) console.log(`[site-server] ${loaded.length} شاخهٔ داده بازخوانی شد: ${loaded.join(', ')}`);
    // پوشهٔ اختصاصی هر سایت: هم آن‌هایی که روی دیسک هستند، هم سایت‌های ثبت‌شده
    await siteSync.loadAll();
    const ensured = await ensureAllSiteWorkspaces();
    if (ensured.length) console.log(`[site-server] پوشهٔ اختصاصی ${ensured.length} سایت آماده است`);
    // خودِ سایتِ پمپ و دامنه‌هایش هم باید در پنل دیده شوند — بدون افزودن دستی
    try {
      await ensureMainSite();
    } catch (e) {
      logEvent('error', 'panel', `ثبت خودکار سایت اصلی ناموفق بود: ${e.message}`);
    }
  }

  ensureSitesRoot();
  await autostartAll();

  // ── مرکز فرمان ──────────────────────────────────────────────────────────
  // سرورِ خانگی (همین کامپیوتر) یک‌بار خودش ثبت می‌شود؛ بعد فهرستِ هدف‌های
  // مانیتورینگ از روی چیزهایی که واقعاً ثبت شده‌اند ساخته می‌شود.
  try {
    ensureLocalServer();
    syncMonitors();
    startMonitor();
    startUpdateWatcher();
    // صفِ کدهای شش‌رقمی — ایمیل‌ها پشتِ سرِ درخواست‌ها می‌روند، نه داخلشان
    startQueue();
  } catch (e) {
    console.warn(`⚠️  مرکز فرمان کامل بالا نیامد: ${e.message}`);
    logEvent('error', 'panel', `راه‌اندازی مرکز فرمان: ${e.message}`);
  }

  // دستیارِ هوشمند — نگهبانِ حرارت/بی‌کاری، گزارشِ صبحگاهی و شنوندهٔ هشدارها
  try {
    startAgent();
  } catch (e) {
    console.warn(`⚠️  دستیارِ هوشمند بالا نیامد: ${e.message}`);
  }

  if (syncOnlyServer) {
    syncOnlyServer.listen(config.siteSync.port, config.host);
  }

  httpServer.listen(config.port, config.host, () => {
    const ips = readInterfaces().map((i) => i.address);
    const name = getSetting('server_name', null);
    console.log('');
    console.log('==============================================================');
    console.log('  ✅ پنل مدیریت سرور خانگی بالا آمد' + (name ? ` — ${name}` : ''));
    console.log(`  ${versionLine()}`);
    console.log('==============================================================');
    console.log(`  پنل روی این کامپیوتر:   ${scheme}://localhost:${config.port}`);
    for (const ip of ips) console.log(`  از شبکهٔ خانگی:          ${scheme}://${ip}:${config.port}`);
    if (panelSecure) console.log('  🔒 با گواهیِ خودتان، مستقیم روی https');
    console.log('');
    if (siteSync) {
      console.log('  🔗 سرورِ سایت — این‌ها را در خودِ سایت وارد کنید:');
      console.log(`     آدرس سرور:  ws://${ips[0] || 'localhost'}:${config.port}   (فقط داخل همین شبکهٔ خانگی)`);
      console.log(`     رمز سرور:   ${siteSync.getToken()}`);
      if (syncOnlyServer) {
        console.log('');
        console.log(`     پورت جداگانهٔ سرورِ سایت (بدون پنل): ${config.siteSync.port}`);
        console.log(`     برای اتصال از اینترنت همین پورت را تونل کنید، نه پورت پنل را.`);
      }
      console.log('');
      console.log('  ℹ️  اگر سایت را با آدرس https باز می‌کنید، آدرس ws:// کار نمی‌کند؛');
      console.log('     مرورگر جلویش را می‌گیرد. آنجا باید wss:// داشته باشید (تونل).');
      console.log('');
    }
    //  سرورِ حساب — همان اول بگو هست یا نه، نه بعد از یک ساعت گشتن.
    //  اگر از قبل بالا نیست، پنل خودش بالا می‌آوردش (account/supervisor.js):
    //  روی PGlite، بی داکر و بی PostgreSQL — و بعد دوباره می‌پرسد.
    (async () => {
      let acct = await probeAccountServer().catch(() => ({ enabled: true, up: false }));
      if (acct.enabled && !acct.up) {
        const started = await autostartAccountServer({ probe: () => probeAccountServer() });
        if (started.ok && started.reason !== 'external') {
          //  چند ثانیه تا PGlite باز شود و migration بدود
          for (let i = 0; i < 40 && !acct.up; i++) {
            await new Promise((r) => setTimeout(r, 500));
            acct = await probeAccountServer().catch(() => acct);
          }
        }
      }
      if (!acct.enabled) {
        console.log('  🪪 سرورِ حساب: خاموش (HLP_ACCOUNT_API=0) — برنامه‌ها از این‌جا وارد نمی‌شوند');
      } else if (acct.up) {
        console.log(`  🪪 سرورِ حساب: وصل${acct.version ? ` (نسخهٔ ${acct.version})` : ''} — از api.<دامنه> رد می‌شود`);
      } else {
        console.log(`  ⚠️  سرورِ حساب روشن نیست (${acct.url}) — تا روشن نشود هیچ برنامه‌ای وارد نمی‌شود.`);
        console.log('     پنل ← تنظیمات ← «سرورِ حساب» را ببینید (یا /api/account-server/status)');
        logEvent('warn', 'panel', `سرورِ حساب (${acct.url}) جواب نمی‌دهد — ورودِ برنامه‌ها تا روشن شدنش کار نمی‌کند`);
      }
      console.log('');
    })().catch(() => {});
    if (stations) {
      const list = stations.list();
      console.log('  ⛽ پمپ‌بنزین‌ها — هر کدام پوشه و رمزِ خودش:');
      if (!list.length) {
        console.log('     هنوز هیچ پمپی ثبت نشده. برنامهٔ کامپیوترِ همان پمپ را در همین');
        console.log('     شبکهٔ خانگی باز کنید؛ خودش سرور را پیدا و خودش را ثبت می‌کند.');
      }
      for (const st of list) {
        console.log(`     ${st.name} (${st.code})  →  ${st.dataDir}`);
      }
      console.log(`     آدرسی که برنامهٔ نیتیو می‌گیرد: ws://${ips[0] || 'localhost'}:${config.port}/station`);
      console.log('');
    }
    // ---- ورودِ برنامه‌ها: همان چیزی که باید در اپِ اندروید/ویندوز/سایت بگذارید ----
    const codes = codeSettings();
    const mailOn = Boolean(codes.email.host && codes.email.from);
    console.log('  📧 کدهای شش‌رقمیِ ورودِ برنامه‌ها:');
    console.log(`     آدرسی که در برنامه می‌گذارید:  http://${ips[0] || 'localhost'}:${config.port}`);
    console.log(`     راهنما و تستِ زنده:            http://${ips[0] || 'localhost'}:${config.port}/connect`);
    console.log(`     گرفتنِ کد:   POST /api/codes/request   {"app":"app-fuel","email":"a@b.com"}`);
    console.log(`     سنجشِ کد:    POST /api/codes/verify    {"app":"app-fuel","email":"a@b.com","code":"123456"}`);
    console.log(`     ایمیل: ${mailOn ? `روشن (${codes.email.host})` : 'خاموش'}`);
    if (!mailOn) {
      console.log('     ⚠️  تا وقتی سرورِ ایمیل تنظیم نشده، کدها ساخته می‌شوند ولی فرستاده نمی‌شوند.');
      console.log('        دیدن و تنظیمش: پنل ← «کدهای شش‌رقمی».');
    }
    console.log('');
    console.log(`  پوشهٔ داده:  ${config.dataDir}`);
    console.log(`  ریشهٔ سایت‌ها: ${sitesRoot()}`);
    console.log('==============================================================');
    console.log('');
    logEvent('info', 'panel', `پنل روی پورت ${config.port} اجرا شد`);

    // تونل اینترنتی: به‌صورت پیش‌فرض روشن است تا سایت از هر دستگاهی وصل شود.
    // برای خاموش کردن، در پنل دکمه‌اش را بزنید یا HLP_TUNNEL=0 بگذارید.
    const tunnelWanted =
      (process.env.HLP_TUNNEL ?? '1') !== '0' && getSetting('tunnel_autostart', true) !== false;
    if (siteSync && tunnelWanted) {
      /*
       *  پیش از راه‌اندازی، شناسهٔ تونلِ داخلِ config.yml با حسابِ Cloudflare
       *  هم‌خط می‌شود. اگر شناسه کهنه باشد، پنل تونلی را اجرا می‌کند که هیچ
       *  رکوردی به آن اشاره نمی‌کند و کاربر فقط Error 1033 می‌بیند — بی‌آنکه
       *  جایی خطایی چاپ شود.
       */
      reconcileNamedTunnel()
        .catch(() => null)
        /*
         *  ⚠️ مسیرها هم پیش از راه‌اندازی همگام می‌شوند.
         *
         *  تا امروز syncTunnelRoutes فقط وقتی اجرا می‌شد که کاربر دامنه‌ای
         *  اضافه یا عوض کند. یعنی اگر به‌روزرسانی یک زیردامنهٔ تازه بیاورد
         *  — همان‌طور که admin.<دامنه> آورد — آن زیردامنه نه رکوردِ DNS
         *  می‌گرفت و نه در ingress می‌نشست، و کاربر هیچ راهی نداشت جز
         *  دست‌زدن به تنظیماتِ دامنه تا تصادفاً همگام شود.
         *
         *  restart: false چون تونل همین پایین تازه بالا می‌آید و نباید دو
         *  بار روشن و خاموش شود؛ فایلِ ingress پیش از آن نوشته شده است.
         */
        .then(() => syncTunnelRoutes({ restart: false }).catch(() => null))
        .then(() =>
          startTunnel({}).then((st) => {
            if (st.status === 'error') {
              console.log(`  ⚠️  تونل اینترنتی بالا نیامد: ${st.error}`);
            }
          })
        );
    }
  });

  httpServer.on('error', (e) => {
    console.error(`❌ اجرای سرور ناموفق بود: ${e.message}`);
    if (e.code === 'EADDRINUSE') {
      console.error(`   پورت ${config.port} در حال استفاده است. HLP_PORT را عوض کنید.`);
    }
    process.exit(1);
  });
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[خاموش‌سازی] ${signal} — ذخیرهٔ نهایی...`);
  clearInterval(housekeeping);
  stopCollector();
  stopWinSampler();
  try {
    stopTunnel();
    stopAllSiteTunnels();
    stopDiscovery();
    stopBackupSchedule();
  } catch { /* بسته شده */ }
  try {
    stopMonitor();
    stopUpdateWatcher();
    stopQueue();
  } catch { /* بسته شده */ }
  try {
    syncOnlyServer?.close();
    redirectServer?.close();
  } catch { /* بسته شده */ }
  try {
    stopAgent();
  } catch { /* بی‌خیال */ }
  try {
    stopAccountServer();
  } catch { /* بی‌خیال */ }
  try {
    await stopAll();
  } catch { /* بی‌خیال */ }
  try {
    if (siteSync) await siteSync.flush();
  } catch { /* بی‌خیال */ }
  try {
    if (stations) await stations.flush();
  } catch { /* بی‌خیال */ }
  try {
    db.close();
  } catch { /* بی‌خیال */ }
  try {
    fs.rmSync(PID_FILE, { force: true });
  } catch { /* بی‌خیال */ }
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (e) => {
  console.error('[خطای پیش‌بینی‌نشده]', e);
  logEvent('error', 'panel', `خطای پیش‌بینی‌نشده: ${e.message}`);
});
process.on('unhandledRejection', (e) => {
  logEvent('error', 'panel', `Promise رد شد: ${e?.message || e}`);
});

main().catch((err) => {
  console.error('❌ راه‌اندازی ناموفق بود:', err);
  process.exit(1);
});
