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
import { setSiteSync, setIo, getIo } from './state.js';
import { createSiteSync } from './sitesync/index.js';
import { attachRealtime, broadcastMetrics } from './realtime.js';
import { startCollector, stopCollector } from './metrics/index.js';
import { startWinSampler, stopWinSampler } from './metrics/win-sampler.js';
import { readInterfaces } from './metrics/network.js';
import { autostartAll, ensureAllSiteWorkspaces, ensureMainSite } from './sites/registry.js';
import { sitesRoot, ensureSitesRoot } from './sites/root.js';
import { stopAll } from './sites/process.js';
import { startTunnel, stopTunnel, tunnelEvents, publicState as tunnelState } from './tunnel.js';
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
import messengerRoutes from './routes/messenger.js';
import notifyRoutes, { adminRouter as notifyAdminRoutes } from './routes/notify.js';
import appRoutes, { adminRouter as appAdminRoutes } from './routes/app.js';
import storageRoutes from './routes/storage.js';
import aiRoutes from './routes/ai.js';
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
import { rateLimit, pruneRateLimits } from './lib/rate-limit.js';
import { otpSettings } from './appauth/settings.js';
import { readyPayload } from './platform/health.js';
import { createBackup } from './backup/index.js';
import * as notify from './notify/index.js';
import * as messenger from './messenger/index.js';
import { aiProxy, AI_PREFIX } from './ai/proxy.js';
import { autostartAi, stopAi } from './ai/supervisor.js';

// ── مرکز فرمان ────────────────────────────────────────────────────────────
import { ensureControlSchema } from './control/schema.js';
import { ensureTohidSchema } from './tohid/schema.js';
import tohidPublicRoutes from './routes/tohid.js';
import tohidAdminRoutes from './routes/control/tohid.js';
import tohidAdminApiRoutes from './routes/tohid-admin.js';
import { createTohidWs } from './tohid/ws.js';
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
ensureTohidSchema();
// کلیدِ محلی همین اول ساخته می‌شود تا «برنامهٔ سرور خانگی» روی همین کامپیوتر
// بتواند بدونِ ورودِ دستی، برنامه‌ها و تنظیمات را اداره کند.
localKey();

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
  const openApi = req.path.startsWith('/api/app/');

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
   ورود و کدِ یک‌بارمصرف سخت‌گیرانه‌تر است، چون هدفِ حدس‌زدن‌اند. */
app.use('/api/auth/login', rateLimit('login', 10, 5 * 60 * 1000));
app.use('/api/auth/setup', rateLimit('setup', 5, 60 * 60 * 1000));
app.use('/api/app/auth', rateLimit('app-auth', 60, 10 * 60 * 1000));
app.use('/api/notify', rateLimit('notify', 240, 60 * 1000));
app.use('/api/messenger', rateLimit('messenger', 600, 60 * 1000));
app.use('/api', rateLimit('api', 1200, 60 * 1000));

// دستیارِ پشتیبانی — پیش از میان‌افزارِ JSON، به همان دلیلِ بالا
app.use(AI_PREFIX, aiProxy);

// بدنهٔ JSON فقط برای مسیرهایی که JSON می‌گیرند (آپلود فایل خام است)
const MSG_LIMIT = `${Math.max(1, Math.round(config.messengerMaxBytes / (1024 * 1024)))}mb`;
app.use((req, res, next) => {
  if (req.path === '/api/files/upload' || req.path === '/api/settings/logo') return next();
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
app.use('/api/messenger', messengerRoutes);
app.use('/api/notify', notifyRoutes);
app.use('/api/notify-admin', notifyAdminRoutes);
// ورودِ کاربرانِ برنامه‌ها (اپِ اندروید، برنامهٔ ویندوز، سایت‌ها) با کدِ شش‌رقمی
app.use('/api/app', appRoutes);
app.use('/api/app-admin', appAdminRoutes);
// کتابخانه: یک جای مرتب برای سایت‌ها، برنامه‌ها، پشتیبان‌ها و فایل‌های موقت
app.use('/api/storage', storageRoutes);
app.use('/api/ai', aiRoutes);
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
// API برنامهٔ توحید — احرازِ هویتش مالِ خودش است، نه ورودِ پنل
// برنامهٔ مدیریتِ گوشی. پیش از مسیرهای عمومی می‌نشیند تا هیچ مسیرِ
// عمومی‌ای نتواند /admin را بدزدد.
app.use('/api/v1/admin', tohidAdminApiRoutes);
app.use('/api/v1', tohidPublicRoutes);

app.use('/api/control/agent', agentRouter);
app.use('/api/app-config', appConfigRouter);
// بقیهٔ مرکز فرمان فقط برای مدیرِ واردشده
// خواندن برای همه، نوشتن دستِ‌کم برای operator، و کارهای حساس فقط برای admin
app.use('/api/control/tohid', requireAuth, writeNeedsOperator, tohidAdminRoutes);
app.use('/api/control', requireAuth, writeNeedsOperator, controlRoutes);

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

const tohidWs = createTohidWs();

// ۲) سرورِ سایت روی همان پورت — هر ارتقای WebSocket که مسیرش /socket.io نباشد
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
    if (pathname.startsWith('/tohid')) return tohidWs.handleUpgrade(req, socket, head);
    siteSync.handleUpgrade(req, socket, head);
  });
}

// ورودِ با کدِ برنامهٔ توحید. اگر سرورِ سایت خاموش باشد هیچ شنوندهٔ upgrade ای
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
    if (pathname.startsWith('/tohid')) return tohidWs.handleUpgrade(req, socket, head);
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key, X-Read-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
  publicApp.use('/api/app/auth', rateLimit('pub-app-auth', 60, 10 * 60 * 1000));
  publicApp.use('/api/notify', rateLimit('pub-notify', 240, 60 * 1000));
  publicApp.use('/api', rateLimit('pub-api', 1200, 60 * 1000));
  // ⚠️ پراکسیِ دستیار **پیش از** express.json می‌نشیند: آن میان‌افزار جریانِ
  //    بدنه را می‌خورد و بعدش دیگر چیزی برای لوله کردن نمی‌ماند.
  publicApp.use(AI_PREFIX, aiProxy);
  publicApp.use(express.json({ limit: MSG_LIMIT }));
  publicApp.get('/health', (req, res) => res.json(publicHealth()));
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
  } catch (e) {
    console.warn(`⚠️  مرکز فرمان کامل بالا نیامد: ${e.message}`);
    logEvent('error', 'panel', `راه‌اندازی مرکز فرمان: ${e.message}`);
  }

  // دستیارِ پشتیبانی هم با پنل بالا می‌آید. اگر پوشه‌اش نبود یا خاموش بود،
  // فقط یک سطر لاگ می‌شود و بقیهٔ پنل عادی کار می‌کند.
  try {
    autostartAi();
  } catch (e) {
    console.warn(`⚠️  دستیارِ پشتیبانی بالا نیامد: ${e.message}`);
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
    // ---- ورودِ برنامه‌ها: همان چیزی که باید در اپِ اندروید/ویندوز/سایت بگذارید ----
    const otp = otpSettings();
    const smsOn = otp.sms.provider !== 'none';
    const mailOn = otp.email.provider !== 'none' && Boolean(otp.email.host);
    console.log('  📱 ورودِ برنامه‌ها با شماره یا ایمیل (کدِ شش‌رقمی):');
    console.log(`     آدرسی که در برنامه می‌گذارید:  http://${ips[0] || 'localhost'}:${config.port}`);
    console.log(`     راهنما و تستِ زنده:            http://${ips[0] || 'localhost'}:${config.port}/connect`);
    console.log(`     فرستادنِ کد:  POST /api/app/auth/request-code   {"phone":"09121234567"}`);
    console.log(`     تأییدِ کد:     POST /api/app/auth/verify-code    {"phone":"...","code":"123456"}`);
    console.log(`     پیامک: ${smsOn ? `روشن (${otp.sms.provider})` : 'خاموش'}   ·   ایمیل: ${mailOn ? `روشن (${otp.email.host})` : 'خاموش'}`);
    console.log('     برنامهٔ ویندوزیِ همین کارها:  homelab-panel\\desktop\\برنامه-سرور.bat');
    if (!smsOn && !mailOn) {
      console.log('     ⚠️  تا وقتی پیامک/ایمیل تنظیم نشده، کد در همین پنجره و در «لاگ‌ها» نوشته می‌شود.');
      console.log('        روشن کردنش: صفحهٔ /connect را باز کنید، بخشِ ۴.');
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
      startTunnel({}).then((st) => {
        if (st.status === 'error') {
          console.log(`  ⚠️  تونل اینترنتی بالا نیامد: ${st.error}`);
        }
      });
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
  } catch { /* بسته شده */ }
  try {
    syncOnlyServer?.close();
    redirectServer?.close();
  } catch { /* بسته شده */ }
  try {
    stopAi();
  } catch { /* بی‌خیال */ }
  try {
    await stopAll();
  } catch { /* بی‌خیال */ }
  try {
    if (siteSync) await siteSync.flush();
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
