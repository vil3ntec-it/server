// ---------------------------------------------------------------------------
//  پنل مدیریت سرور خانگی — نقطهٔ ورود
//  یک پورت، سه کار:
//    ۱) رابط کاربری و API خودِ پنل            → /  و  /api/*
//    ۲) اطلاعات لحظه‌ای                        → /socket.io/
//    ۳) سرورِ سایتِ پمپ یعقوبی (پروتکل ws)     → همان آدرس، بدون مسیر اضافه
// ---------------------------------------------------------------------------
import http from 'node:http';
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
import { startTunnel, stopTunnel, tunnelEvents } from './tunnel.js';
import { versionInfo, versionLine } from './version.js';
import { corsMiddleware, secureHeaders } from './platform/security.js';
import { rateLimit } from './platform/rate-limit.js';
import { handleValidation } from './platform/validate.js';
import { siteTunnelEvents, stopAllSiteTunnels } from './site-tunnels.js';

import messengerRoutes from './routes/messenger.js';
import notifyRoutes from './routes/notify.js';
import { createApiV1, deprecatedAlias } from './routes/v1.js';
import { healthPayload, readyPayload } from './platform/health.js';
import { createBackup } from './backup/index.js';
import * as notify from './notify/index.js';
import * as messenger from './messenger/index.js';
import { aiProxy, AI_PREFIX } from './ai/proxy.js';
import { autostartAi, stopAi } from './ai/supervisor.js';

const PUBLIC_DIR = path.join(SERVER_ROOT, 'public');
const PID_FILE = path.join(config.dataDir, 'panel.pid');

ensureDirs();

// شمارهٔ پروسه روی دیسک می‌ماند تا اسکریپت‌های سرویس (وقتی پنجره‌ای باز نیست)
// بتوانند همین سرور را پیدا و متوقف کنند.
try {
  fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
} catch { /* اگر ننوشت، فقط توقفِ خودکار سخت‌تر می‌شود */ }

const app = express();
app.disable('x-powered-by');

// ------------------------------ امنیت -------------------------------------
// اگر پشتِ reverse proxy هستیم، Express باید بداند تا req.ip و req.secure
// درست باشند. فقط وقتی که خودمان گفته باشیم — وگرنه هدرِ جعلی باور می‌شود.
if (config.trustProxy) app.set('trust proxy', true);

app.use(secureHeaders);

// CORS با فهرستِ سفید. تا دیروز هر مبدأیی بازتاب می‌شد و کنارش
// credentials: true هم می‌رفت؛ یعنی هر سایتی در اینترنت می‌توانست از طرفِ
// کاربرِ واردشده به پنل درخواست بزند. جزئیات در platform/security.js
app.use(corsMiddleware);

// سقفِ عمومی: جلوی اسکنرها و درخواست‌های سیل‌آسا. سخاوتمند است تا پنلِ
// واقعی که ده‌ها درخواست در دقیقه می‌زند به آن نخورد.
app.use(
  rateLimit({
    name: 'global',
    max: Number(process.env.HLP_RATE_LIMIT ?? 600),
    windowMs: Number(process.env.HLP_RATE_WINDOW ?? 60) * 1000,
  })
);

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
//  /health  «پروسه زنده است؟»       — سبک، بدونِ وابستگی، برای ناظرِ سرویس
//  /ready   «الان می‌تواند کار کند؟» — دیتابیس و دیسک را واقعاً می‌زند
//  چرا جدا: اگر /health به دیتابیس دست بزند و دیتابیس کند شود، ناظر پروسهٔ
//  سالم را می‌کشد. توضیحِ کامل در platform/health.js
app.get('/health', (req, res) => res.json(healthPayload()));

app.get('/ready', (req, res) => {
  const payload = readyPayload();
  res.status(payload.ready ? 200 : 503).json(payload);
});

// -------------------------------- API --------------------------------------
// ورود تنها درِ باز است: بقیهٔ مسیرها توکن می‌خواهند. پس سقفِ سخت‌گیرانه
// دقیقاً همین‌جا لازم است. فقط تلاش‌های **ناموفق** شمرده می‌شوند تا کاربری
// که رمزش را درست می‌زند قفل نشود.
const authLimiter = rateLimit({
  name: 'auth',
  max: Number(process.env.HLP_AUTH_RATE_LIMIT ?? 10),
  windowMs: Number(process.env.HLP_AUTH_RATE_WINDOW ?? 900) * 1000,
  skipSuccess: true,
});
for (const base of ['/api', '/api/v1']) {
  app.use(`${base}/auth/login`, authLimiter);
  app.use(`${base}/auth/setup`, authLimiter);
  app.use(`${base}/auth/change-password`, authLimiter);
}

// قراردادِ رسمی
app.use('/api/v1', createApiV1());

// نامِ مستعارِ قدیمی — رابط کاربریِ ساخته‌شدهٔ فعلی هنوز /api/... را صدا
// می‌زند. اگر همین امروز برش می‌داشتیم، پنلِ در حالِ اجرا می‌شکست. هدرِ
// Deprecation می‌گیرد تا روزی که UI مهاجرت کرد، حذفش بی‌خطر باشد.
app.use('/api', deprecatedAlias, createApiV1());


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

// ورودیِ بد باید ۴۰۰ بدهد نه ۵۰۰ — و ۵۰۰ نباید جزئیاتِ داخلی لو بدهد
app.use(handleValidation);

app.use((err, req, res, next) => {
  logEvent('error', 'panel', `${req.method} ${req.path} → ${err.message}`);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'internal_error', message: err.message });
});

// ------------------------------ راه‌اندازی ----------------------------------
const httpServer = http.createServer(app);

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
  if (config.trustProxy) publicApp.set('trust proxy', true);
  publicApp.use(secureHeaders);
  // این پورت مستقیماً رو به اینترنت است، پس همان فهرستِ سفید این‌جا هم برقرار
  publicApp.use(corsMiddleware);
  publicApp.use(
    rateLimit({
      name: 'public',
      max: Number(process.env.HLP_RATE_LIMIT ?? 600),
      windowMs: Number(process.env.HLP_RATE_WINDOW ?? 60) * 1000,
    })
  );
  // ⚠️ پراکسیِ دستیار **پیش از** express.json می‌نشیند: آن میان‌افزار جریانِ
  //    بدنه را می‌خورد و بعدش دیگر چیزی برای لوله کردن نمی‌ماند.
  publicApp.use(AI_PREFIX, aiProxy);
  publicApp.use(express.json({ limit: MSG_LIMIT }));
  publicApp.get(['/health', '/'], (req, res) => {
    res.json({ ok: true, service: 'pump-yaqobi-server', mode: 'sync-only', time: new Date().toISOString() });
  });
  // این پورت همان چیزی است که کلاینت‌ها از راهِ تونل به آن می‌رسند، پس
  // نسخهٔ ۱ هم باید این‌جا باشد. مسیرِ قدیمی برای کلاینت‌های موجود می‌ماند.
  publicApp.get(['/api/v1/health', '/health'], (req, res) => {
    res.json({ ok: true, service: 'pump-yaqobi-server', mode: 'sync-only', time: new Date().toISOString() });
  });
  publicApp.use('/api/v1/messenger', messengerRoutes);
  publicApp.use('/api/v1/notify', notifyRoutes);
  publicApp.use('/api/messenger', deprecatedAlias, messengerRoutes);
  publicApp.use('/api/notify', deprecatedAlias, notifyRoutes);
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

// ۳) معیارهای زنده
// روی ویندوز یک پروسهٔ PowerShell دائمی به‌جای ده‌ها بار باز و بسته کردن آن
startWinSampler();
startCollector((snapshot) => {
  broadcastMetrics(getIo(), snapshot);
});

// نگهداری دوره‌ای
const housekeeping = setInterval(() => {
  pruneSessions();
  pruneEvents();
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
    console.log(`  پنل روی این کامپیوتر:   http://localhost:${config.port}`);
    for (const ip of ips) console.log(`  از شبکهٔ خانگی:          http://${ip}:${config.port}`);
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
