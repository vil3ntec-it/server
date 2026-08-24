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
import { db, logEvent, pruneEvents, getSetting } from './db.js';
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
import { pruneAppAuth } from './appauth/index.js';
import { localKey } from './local-key.js';
import { runMigrations, dbVersion } from './lib/migrations.js';
import { startDiscovery, stopDiscovery, serverCard, DISCOVERY_PORT } from './discovery.js';
import { startBackupSchedule, stopBackupSchedule } from './storage/backup.js';
import { pruneAudit } from './lib/audit.js';
import { pruneTickets } from './lib/ws-ticket.js';
import { rateLimit, pruneRateLimits } from './lib/rate-limit.js';
import { otpSettings } from './appauth/settings.js';
import * as notify from './notify/index.js';
import * as messenger from './messenger/index.js';
import { aiProxy, AI_PREFIX } from './ai/proxy.js';
import { autostartAi, stopAi } from './ai/supervisor.js';
import aiRoutes from './routes/ai.js';

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
  const openApi = req.path.startsWith('/api/app/') || req.path === '/health';

  if (openApi) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    // عمداً بدونِ credentials: توکن با هدر می‌آید، نه با کوکی
  } else if (originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
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

app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

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

app.use((err, req, res, next) => {
  logEvent('error', 'panel', `${req.method} ${req.path} → ${err.message}`);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'internal_error', message: err.message });
});

// ------------------------------ راه‌اندازی ----------------------------------
/* ── HTTPS ───────────────────────────────────────────────────────────────────
   اگر گواهی بدهید (HLP_TLS_CERT و HLP_TLS_KEY)، سرور روی همان پورت با
   https بالا می‌آید و وب‌سوکت هم خودبه‌خود wss می‌شود.

   عمداً گواهیِ خودامضا نمی‌سازیم: مرورگر و اندروید به آن اعتماد نمی‌کنند و
   کاربر با صفحهٔ «این سایت امن نیست» روبه‌رو می‌شود — بدتر از http. راهِ
   درست برای دسترسی از اینترنت همان تونل است که گواهیِ معتبرِ واقعی دارد و
   از قبل کار می‌کند. این گزینه برای کسی است که گواهیِ خودش را دارد. */
function tlsOptions() {
  const certPath = process.env.HLP_TLS_CERT;
  const keyPath = process.env.HLP_TLS_KEY;
  if (!certPath || !keyPath) return null;
  try {
    return {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
    };
  } catch (e) {
    console.error(`⚠️  گواهیِ TLS خوانده نشد (${e.code || e.message}) — سرور با http بالا می‌آید.`);
    return null;
  }
}

const tls = tlsOptions();
const httpServer = tls ? https.createServer(tls, app) : http.createServer(app);
export const scheme = tls ? 'https' : 'http';

// ۱) Socket.IO (روی مسیر /socket.io/)
const io = attachRealtime(httpServer);
setIo(io);

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
    siteSync.handleUpgrade(req, socket, head);
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
  publicApp.get(['/health', '/'], (req, res) => {
    res.json({ ok: true, service: 'pump-yaqobi-server', mode: 'sync-only', time: new Date().toISOString() });
  });
  publicApp.use('/api/messenger', messengerRoutes);
  publicApp.use('/api/notify', notifyRoutes);
  // برنامه‌ها از اینترنت هم باید بتوانند وارد شوند — پس ورودِ کاربران این‌جا هم هست.
  // (پنل و فایل‌منیجر هرگز روی این پورت نمی‌آیند.)
  publicApp.use('/api/app', appRoutes);
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
  pruneAudit();
  pruneEvents();
}, 15 * 60 * 1000);
housekeeping.unref?.();

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
    if (tls) console.log('  🔒 با گواهیِ شما روی HTTPS بالا آمد (وب‌سوکت هم wss است)');
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
    syncOnlyServer?.close();
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
