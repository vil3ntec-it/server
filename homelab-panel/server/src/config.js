// ---------------------------------------------------------------------------
// پیکربندی سرور — همه‌چیز از متغیرهای محیطی یا فایل .env کنار همین پوشه
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildDomains } from './platform/domain.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(__dirname, '..');

// خواندن .env (اختیاری)
(function loadEnv() {
  try {
    const envPath = path.join(SERVER_ROOT, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch { /* بی‌خیال */ }
})();

const num = (v, d) => {
  const n = parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};

export const config = {
  port: num(process.env.HLP_PORT, 4700),
  host: process.env.HLP_HOST || '0.0.0.0',

  // محل نگهداری دیتابیس پنل، لاگ‌ها، بکاپ‌ها و دادهٔ سرورِ سایت
  dataDir: path.resolve(process.env.HLP_DATA_DIR || path.join(SERVER_ROOT, 'data')),

  // ریشهٔ پیش‌فرضِ سایت‌ها (هر سایت یک پوشهٔ مستقل زیر همین مسیر)
  sitesRoot: path.resolve(
    process.env.HLP_SITES_ROOT ||
      (process.platform === 'win32' ? path.join(os.homedir(), 'sites') : '/sites')
  ),

  // اندازهٔ حداکثری آپلود در فایل‌منیجر (بایت)
  maxUploadBytes: num(process.env.HLP_MAX_UPLOAD, 256 * 1024 * 1024),

  // فاصلهٔ ارسال معیارهای زنده (میلی‌ثانیه)
  metricsIntervalMs: num(process.env.HLP_METRICS_INTERVAL, 2000),

  // اعتبار توکن ورود
  tokenTtlSeconds: num(process.env.HLP_TOKEN_TTL, 12 * 3600),

  // مقصدِ اندازه‌گیری پینگ (TCP) — بدون نیاز به دستور ping سیستم‌عامل
  pingTarget: process.env.HLP_PING_TARGET || '1.1.1.1:443',

  // سرویس تشخیص IP عمومی (اگر اینترنت نبود، مقدار null برمی‌گردد — داده‌ی ساختگی نداریم)
  publicIpUrl: process.env.HLP_PUBLIC_IP_URL || 'https://api.ipify.org?format=json',

  // پیام‌رسان: سقفِ حجمِ یک پیام. عمداً بزرگ است تا پیام و پیوست بدون
  // محدودیت برسد؛ اگر خواستید کم‌ترش کنید HLP_MSG_MAX را بگذارید.
  messengerMaxBytes: num(process.env.HLP_MSG_MAX, 256 * 1024 * 1024),

  // ── زیرساخت: دامنهٔ مرکزی، لبه و امنیت ────────────────────────────────────
  // دامنه اختیاری است. اگر نباشد، سرور در «حالتِ شبکهٔ خانگی» بالا می‌آید و
  // دقیقاً مثل قبل کار می‌کند — نصبِ یک‌کلیکی نباید به دامنه گره بخورد.
  domains: buildDomains(),

  // پشتِ reverse proxy هستیم؟ فقط وقتی روشن شود که واقعاً پراکسی جلو باشد.
  // اگر بی‌جهت روشن باشد، هر کسی با جعلِ X-Forwarded-For محدودیتِ نرخ را
  // دور می‌زند و لاگ‌ها IPِ دروغ ثبت می‌کنند.
  trustProxy: (process.env.HLP_TRUST_PROXY ?? '0') !== '0',

  // مبدأهای اضافیِ مجاز برای CORS (با کاما جدا) — علاوه بر دامنه و شبکهٔ خانگی
  corsOrigins: String(process.env.HLP_CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // رازِ امضای JWT. اگر خالی بماند، مثل قبل خودکار ساخته و در دیتابیس نگه
  // داشته می‌شود. گذاشتنِ آن در محیط یعنی راز در بکاپِ دیتابیس نیست و با
  // بازسازیِ دیتابیس هم نشست‌ها نمی‌پرند.
  secretKey: process.env.HLP_SECRET_KEY || '',

  // چند نسخه بکاپ نگه داشته شود
  backupKeep: num(process.env.HLP_BACKUP_KEEP, 14),

  // بکاپِ خودکارِ روزانه — برای خاموش کردن 0
  backupSchedule: (process.env.HLP_BACKUP_SCHEDULE ?? '1') !== '0',

  // سرورِ سایتِ پمپ یعقوبی (پروتکل realtime) روی همین پورت سوار می‌شود
  siteSync: {
    enabled: (process.env.HLP_SITESYNC ?? '1') !== '0',
    // پورت دومی که **فقط** سرورِ سایت را سرو می‌کند (بدون پنل، بدون API و بدون
    // فایل‌منیجر). تونل اینترنتی همیشه روی همین پورت باز می‌شود تا خودِ پنل
    // هرگز به اینترنت درز نکند. با 0 خاموش می‌شود.
    port: num(process.env.HLP_SITESYNC_PORT, 4701),
    dataDir: path.resolve(
      process.env.HLP_SITESYNC_DATA_DIR ||
        path.join(process.env.HLP_DATA_DIR || path.join(SERVER_ROOT, 'data'), 'site-sync')
    ),
    token: process.env.HLP_SITESYNC_TOKEN || '',
  },

  // ── HTTPS مستقیم روی خودِ پنل ────────────────────────────────────────────
  // اگر گواهی و کلید بدهید، پنل خودش https سرو می‌کند. لازم نیست: وقتی از
  // راهِ تونل باز می‌شود، Cloudflare خودش https را فراهم می‌کند.
  //   HLP_TLS_CERT=/etc/letsencrypt/live/example.com/fullchain.pem
  //   HLP_TLS_KEY=/etc/letsencrypt/live/example.com/privkey.pem
  tls: {
    cert: process.env.HLP_TLS_CERT || '',
    key: process.env.HLP_TLS_KEY || '',
    // اگر روشن باشد، هر درخواستِ http به https فرستاده می‌شود
    redirectHttp: (process.env.HLP_TLS_REDIRECT ?? '1') !== '0',
    redirectPort: num(process.env.HLP_TLS_REDIRECT_PORT, 0),
  },

  // ── دستیارِ پشتیبانیِ هوشمند (پوشهٔ ai-support کنارِ همین پنل) ─────────────
  // با بالا آمدنِ پنل خودش روشن می‌شود و اگر افتاد برمی‌گردد. روی 127.0.0.1
  // گوش می‌دهد و تنها راهِ رسیدنِ سایت به آن، پراکسیِ /ai/support روی همین
  // پورتِ عمومی است — پس پورتِ تازه‌ای لازم نیست تونل شود.
  aiEnabled: (process.env.HLP_AI_ENABLED ?? '1') !== '0',
  aiPort: num(process.env.HLP_AI_PORT, 8788),
  aiDir: process.env.HLP_AI_DIR || '',
  // پوشهٔ دادهٔ دستیار. پیش‌فرض: پوشهٔ خودِ سرویس (ai-support/data) — همان
  // جایی که مرزِ امنیتیِ آن سرویس اجازه‌اش را می‌دهد. اگر جای دیگری
  // می‌خواهید، باید بیرونِ درختِ پنل باشد وگرنه سرویس بالا نمی‌آید.
  aiDataDir: process.env.HLP_AI_DATA_DIR || '',
  // اگر بگذارید، دستیار می‌تواند نشستِ سطحِ مدیر بدهد (جست‌وجوی سراسری و مصارف)
  aiAdminToken: process.env.HLP_AI_ADMIN_TOKEN || '',
  aiModel: process.env.HLP_AI_MODEL || '',
  aiOllamaUrl: process.env.HLP_AI_OLLAMA_URL || '',
};

export const paths = {
  db: path.join(config.dataDir, 'panel.db'),
  sitesData: path.join(config.dataDir, 'sites'),   // فضای کاری هر سایت (لاگ/بکاپ/دیتابیس/تنظیمات)
  uploads: path.join(config.dataDir, 'uploads'),   // لوگو و فایل‌های خود پنل
  backups: path.join(config.dataDir, 'backups'),   // بکاپ‌های دیتابیس پنل
};

export function ensureDirs() {
  for (const dir of [config.dataDir, paths.sitesData, paths.uploads, paths.backups, config.siteSync.dataDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // ریشهٔ سایت‌ها هم بار اول ساخته می‌شود تا «افزودن سایت» از همان ابتدا کار کند.
  // اگر اجازهٔ ساخت نبود (مثلاً /sites روی لینوکس بدون sudo) فقط هشدار می‌دهیم.
  try {
    fs.mkdirSync(config.sitesRoot, { recursive: true });
  } catch (e) {
    console.warn(
      `⚠️  پوشهٔ سایت‌ها ساخته نشد: ${config.sitesRoot} (${e.code})\n` +
        '   یا خودتان آن را بسازید، یا در فایل .env مسیر دیگری در HLP_SITES_ROOT بگذارید.'
    );
  }
}
