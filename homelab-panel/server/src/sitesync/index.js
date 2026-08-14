// ---------------------------------------------------------------------------
//  سرورِ سایت‌ها — یک پوشهٔ جدا برای دادهٔ هر سایت
//
//  قبلاً همهٔ سایت‌ها در یک درختِ داده می‌نوشتند و اطلاعاتشان با هم قاطی می‌شد.
//  حالا هر سایت «دفترِ» خودش را دارد:
//
//      data/site-sync/                ← دفترِ اصلی (سایتِ پمپ یعقوبی، مثل قبل)
//      data/site-sync/sites/<slug>/   ← دفترِ اختصاصی هر سایتِ دیگر
//          ├── token.txt              رمزِ همان سایت (فقط همین سایت با آن وصل می‌شود)
//          └── <شاخه>.json            دادهٔ همان سایت
//
//  سایت هنگام اتصال خودش را معرفی می‌کند:
//      wss://…/?site=<slug>&token=<رمزِ همان سایت>
//  اگر ?site= نداشته باشد، از روی رمز پیدا می‌شود؛ پس سایت‌های قدیمی که فقط
//  رمز می‌فرستند بدون هیچ تغییری کار می‌کنند.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { createStore } from './store.js';

export const MAIN_KEY = 'main';

/* ── رمزِ داخلیِ خودِ برنامهٔ پمپ ─────────────────────────────────────────────
   دقیقاً همان مقداری که در `index.html` زیر نامِ BUILTIN_TOKEN نشسته است. اگر
   این دو با هم فرق کنند، هیچ دستگاهی نمی‌تواند وصل شود.

   چرا دفترِ اصلی این را هم می‌پذیرد: این رمز از روزِ اول داخلِ index.html است و
   index.html روی GitHub Pages برای همه باز است — پس چیزی که تا حالا محرمانه بوده
   با این کار محرمانه‌تر یا آشکارتر نمی‌شود. در عوض، عوض شدنِ رمزِ سرور (نصبِ
   دوباره، جابه‌جا شدنِ پوشهٔ داده، چرخاندنِ رمز از پنل) دیگر همهٔ دستگاه‌ها را
   بیرون نمی‌اندازد. اگر این را نمی‌خواهید: HLP_SITESYNC_STRICT=1 بگذارید.
   دفترِ سایت‌های دیگر هرگز این رمز را نمی‌پذیرد. ── */
export const APP_BUILTIN_TOKEN = '3f25db6ea9ff8ea4e8089a66cc7492f5f017';
const STRICT = String(process.env.HLP_SITESYNC_STRICT || '') === '1';

/** نامِ پوشه‌ای امن از روی slug — تا هیچ‌کس از پوشهٔ خودش بیرون نزند */
export function safeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function createSiteSync({ dataDir, token = '' }) {
  const sitesDir = path.join(dataDir, 'sites');
  fs.mkdirSync(sitesDir, { recursive: true });

  /** key → store */
  const stores = new Map();
  const main = createStore({
    key: MAIN_KEY,
    label: 'سرور اصلی',
    dataDir,
    token,
    seedToken: STRICT ? '' : APP_BUILTIN_TOKEN,
    alsoAccept: STRICT ? [] : [APP_BUILTIN_TOKEN],
  });
  stores.set(MAIN_KEY, main);

  const dirFor = (key) => (key === MAIN_KEY ? dataDir : path.join(sitesDir, key));

  // ------------------------------ دفترها ----------------------------------
  /** پوشه و رمزِ اختصاصی یک سایت را می‌سازد (اگر نبود) و دفترش را برمی‌گرداند */
  async function ensureTenant(slug, { label } = {}) {
    const key = safeKey(slug);
    if (!key || key === MAIN_KEY) return main;
    const existing = stores.get(key);
    if (existing) return existing;

    const store = createStore({ key, label: label || key, dataDir: dirFor(key) });
    stores.set(key, store);
    await store.ensureToken();
    await store.loadFromDisk();
    return store;
  }

  function tenant(slug) {
    const key = safeKey(slug);
    return stores.get(key === MAIN_KEY || !key ? MAIN_KEY : key) || null;
  }

  /** پوشهٔ سایت را با دادهٔ داخلش پاک می‌کند — فقط وقتی خودِ سایت حذف می‌شود */
  async function removeTenant(slug) {
    const key = safeKey(slug);
    if (!key || key === MAIN_KEY) return false;
    const store = stores.get(key);
    if (store) {
      await store.flush().catch(() => {});
      store.closeClients();
      stores.delete(key);
    }
    await fsp.rm(dirFor(key), { recursive: true, force: true });
    return true;
  }

  /** همهٔ پوشه‌هایی که از قبل روی دیسک هستند را بازمی‌خواند */
  async function loadAll() {
    const loaded = [];
    let entries = [];
    try {
      entries = await fsp.readdir(sitesDir, { withFileTypes: true });
    } catch { /* هنوز هیچ سایتی نیست */ }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const key = safeKey(entry.name);
      if (!key || stores.has(key)) continue;
      await ensureTenant(key);
      loaded.push(key);
    }
    return loaded;
  }

  // ------------------------------ اتصال‌ها ---------------------------------
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });

  /** تصمیم می‌گیرد این اتصال به کدام دفتر تعلق دارد */
  function route(req) {
    let url = null;
    try {
      url = new URL(req.url, 'http://x');
    } catch { /* مسیر خراب */ }

    const token =
      url?.searchParams.get('token') ||
      String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const wanted = url?.searchParams.get('site') || url?.searchParams.get('tenant') || null;

    // ۱) سایت خودش را معرفی کرده — همان دفتر، با رمزِ همان دفتر
    if (wanted) {
      const store = tenant(wanted);
      if (!store) return { store: null, reason: 'unknown_site' };
      return store.acceptsToken(token) ? { store } : { store, reason: 'auth_failed' };
    }

    // ۲) بدون معرفی: رمز خودش می‌گوید مالِ کدام سایت است (سازگاری با نسخه‌های قبل)
    //    دفترِ «باز» (بی‌رمز) هر رمزی را می‌پذیرد، پس نباید در این جست‌وجو شرکت کند:
    //    وگرنه سایتی که رمزِ درستِ خودش را می‌فرستاد، بی‌صدا در دفترِ سایتِ دیگری
    //    می‌افتاد و حسابِ متفاوتی می‌دید — همان «روی هر دستگاه یک چیز دیگر».
    //    ترتیبِ دفترها هم به ترتیبِ خواندنِ پوشه‌ها بستگی داشت، یعنی همین دستگاه با
    //    هر بار راه‌اندازیِ سرور می‌توانست جای دیگری بیفتد.
    for (const store of stores.values()) {
      if (store.isOpen?.()) continue;
      if (store.acceptsToken(token)) return { store };
    }
    // هیچ دفترِ رمزداری این رمز را نشناخت — اگر دفترِ اصلی باز است، همان (رفتارِ قبل)
    if (main.isOpen?.()) return { store: main };
    return { store: main, reason: 'auth_failed' };
  }

  function handleUpgrade(req, socket, head) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      const { store, reason } = route(req);
      if (reason || !store) return (store || main).reject(ws, reason || 'auth_failed');
      store.handleConnection(ws, req);
    });
  }

  // ------------------------------- گزارش -----------------------------------
  function list() {
    return [...stores.values()].map((store) => {
      const snap = store.snapshot();
      return {
        key: store.key,
        label: store.label,
        main: store.key === MAIN_KEY,
        dataDir: store.dataDir,
        branches: store.branches(),
        diskBytes: store.diskBytes(),
        liveConnections: snap.liveConnections,
        lastActivity: snap.lastActivity,
        reads: snap.reads,
        writes: snap.writes,
      };
    });
  }

  return {
    wss,
    handleUpgrade,
    ensureTenant,
    removeTenant,
    tenant,
    loadAll,
    list,
    keys: () => [...stores.keys()],
    dirFor,
    sitesDir,

    // دفترِ اصلی — همان رفتار قبلی، تا هیچ‌جای پنل و خودِ سایت نشکند
    ensureToken: () => main.ensureToken(),
    rotateToken: () => main.rotateToken(),
    getToken: () => main.getToken(),
    loadFromDisk: () => main.loadFromDisk(),
    branches: () => main.branches(),
    snapshot: () => main.snapshot(),

    async flush() {
      for (const store of stores.values()) await store.flush().catch(() => {});
    },
  };
}
