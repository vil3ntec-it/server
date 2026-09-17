// ---------------------------------------------------------------------------
//  ══ بخشِ پمپ‌بنزین‌ها ══════════════════════════════════════════════════════
//
//  این بخش خانهٔ «برنامهٔ نیتیوِ کامپیوتر»ِ هر پمپ بنزین است، و هر پمپ بنزین
//  پوشه و رمزِ کاملاً جدا دارد. یعنی فردا که پمپ دوم و سوم اضافه شود، هیچ
//  عددی از هیچ پمپی به پمپِ دیگر نشت نمی‌کند — نه با اشتباهِ آدرس، نه با
//  رمزِ لو رفته، نه با یک خطای برنامه‌نویسی.
//
//      data/stations/                     ← ریشهٔ همهٔ پمپ‌بنزین‌ها
//        <کد پمپ>/                        ← پوشهٔ اختصاصیِ همان پمپ
//          token.txt                      رمزِ همان پمپ و بس
//          station.json                   نام و کدِ همان پمپ (شاخهٔ station)
//          live.json                      عکسِ زندهٔ برنامه (شاخهٔ live)
//          inbox.json                     چیزی که از گوشی‌ها بالا آمده
//
//  ── راهِ داده ──────────────────────────────────────────────────────────────
//
//      برنامهٔ نیتیو ──set live──▶ پوشهٔ همان پمپ ──sub live──▶ اپِ کارمندان
//                    ◀─sub inbox──                ◀─post inbox─ اندروید/آیفون
//
//  «اصلِ اطلاعات» همان برنامهٔ نیتیو است و می‌ماند: تنها اوست که ‎live‎ را
//  می‌نویسد. راهِ برگشت ‎inbox‎ است — گوشی‌ها درخواست/پیام می‌گذارند و برنامه
//  می‌خواندشان. پس داده هم می‌رود و هم می‌آید، بی این‌که دو نفر هم‌زمان یک
//  دفتر را بنویسند و حسابِ کسی خراب شود.
//
//  ── چرا همان ‎createStore‎ی site-sync ───────────────────────────────────────
//  پروتکلِ وب‌سوکتِ آن دفترها را برنامهٔ نیتیو (‎HomeSync‎) و اپِ کارمندان
//  (‎kar/‎) همین حالا بلدند. پس این‌جا پروتکلِ تازه‌ای اختراع نمی‌شود؛ فقط هر
//  پمپ یک دفترِ خودش می‌گیرد به‌جای این‌که همه در یک دفتر بنویسند.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { clientIp } from '../platform/security.js';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { attachHeartbeat } from '../lib/ws-heartbeat.js';
import { createStore } from '../sitesync/store.js';

/** شاخه‌ای که برنامهٔ نیتیو می‌نویسد و بقیه فقط می‌خوانند */
export const LIVE_BRANCH = 'live';
/** شاخه‌ای که گوشی‌ها در آن می‌نویسند و برنامهٔ نیتیو می‌خواند */
export const INBOX_BRANCH = 'inbox';
/** شاخهٔ نام و کدِ پمپ */
export const META_BRANCH = 'station';

/**
 * کدِ امنِ پمپ. نامِ پوشه از همین ساخته می‌شود، پس هیچ‌وقت نباید ‎/‎ یا ‎..‎
 * داشته باشد — وگرنه یک کدِ ساختگی می‌تواند بیرونِ ریشه بنویسد.
 */
export function safeCode(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * آیا این درخواست از خودِ همین کامپیوتر یا شبکهٔ خانگی آمده؟
 *
 * ⚠️ «ثبتِ خودکارِ پمپِ تازه» تنها در همین حالت باز است. از اینترنت (تونل)
 * هیچ‌کس نمی‌تواند پمپِ جدید بسازد، حتی اگر آدرسِ عمومی را بداند.
 */
export function isLocalRequest(req) {
  /*
   *  ⚠️ این‌جا تا امروز اول x-forwarded-for خوانده می‌شد و بعد نشانیِ
   *  واقعیِ اتصال. یعنی هر کسی از اینترنت می‌توانست هدرِ
   *  «X-Forwarded-For: 192.168.1.5» بگذارد و همین نگهبان را رد کند —
   *  و پمپِ تازه ثبت کند. درست همان کاری که این تابع قرار بود جلویش را
   *  بگیرد.
   *
   *  حالا از همان محاسبه‌ای می‌آید که بقیهٔ سرور استفاده می‌کند: هدر فقط
   *  وقتی باور می‌شود که خودِ اتصال از لوکال‌هاست آمده باشد یا
   *  HLP_TRUST_PROXY گفته باشد. با تونل، هدرِ کلودفلر نشانیِ *واقعیِ*
   *  اینترنتی را می‌دهد — که خصوصی نیست و درست رد می‌شود.
   */
  const ip = clientIp(req);
  if (!ip) return false;
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true; // fc00::/7 — شبکهٔ محلیِ IPv6
  return false;
}

/**
 * @param {object} opts
 * @param {string} opts.dataDir ریشه‌ای که پوشهٔ هر پمپ زیرش ساخته می‌شود
 * @param {'lan'|'open'|'off'} [opts.enroll]
 *   چه کسی می‌تواند پمپِ تازه ثبت کند: فقط شبکهٔ خانگی (پیش‌فرض)، هر کسی
 *   (فقط برای آزمون)، یا هیچ‌کس جز پنل.
 */
export function createStations({ dataDir, enroll = 'lan' } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });

  /** کدِ پمپ → دفترِ همان پمپ */
  const stores = new Map();
  /** کدهای یک‌بارمصرفِ جفت‌شدن که پنل ساخته: کد → {code, name, expires} */
  const pairings = new Map();

  const dirFor = (code) => path.join(dataDir, code);
  /** کدِ پمپ → رمزِ فقط‌خواندنیِ همان پمپ */
  const readKeys = new Map();

  /* ── دو رمز، نه یکی ────────────────────────────────────────────────────────
     • رمزِ برنامه (‎token.txt‎): فقط برنامهٔ نیتیوِ کامپیوتر. می‌نویسد.
     • رمزِ خواندن (‎readkey.txt‎): همانی که در کیو‌آرِ کارمند و اپِ گوشی
       می‌نشیند. هرگز نمی‌نویسد.
     چرا: کیو‌آر روی کاغذ چاپ می‌شود و دستِ چند نفر می‌گردد. با یک رمزِ
     مشترک، همان کاغذ اجازهٔ پاک کردنِ دفترِ پمپ را هم می‌داد. */
  const readKeyFile = (code) => path.join(dirFor(code), 'readkey.txt');

  async function ensureReadKey(code) {
    const key = safeCode(code);
    const cached = readKeys.get(key);
    if (cached) return cached;
    let value = '';
    try {
      value = (await fsp.readFile(readKeyFile(key), 'utf8')).trim();
    } catch { /* هنوز ساخته نشده */ }
    if (!value) {
      value = crypto.randomBytes(18).toString('hex');
      await fsp.writeFile(readKeyFile(key), value, 'utf8');
    }
    readKeys.set(key, value);
    return value;
  }

  const readKeyOf = (code) => readKeys.get(safeCode(code)) || '';

  async function rotateReadKey(code) {
    const key = safeCode(code);
    if (!stores.has(key)) return null;
    const value = crypto.randomBytes(18).toString('hex');
    await fsp.writeFile(readKeyFile(key), value, 'utf8');
    readKeys.set(key, value);
    // هر گوشی‌ای که با رمزِ قدیمی وصل است باید دوباره اجازه بگیرد
    stores.get(key).closeClients();
    return value;
  }

  /**
   * این رمز چه اجازه‌ای دارد: ‎'owner'‎ (برنامهٔ نیتیو)، ‎'read'‎ (گوشی‌ها)
   * یا ‎null‎ (هیچ).
   */
  function accessOf(code, token) {
    const store = get(code);
    const clean = String(token || '');
    if (!store || !clean) return null;
    if (store.acceptsToken(clean)) return 'owner';
    const rk = readKeyOf(code);
    if (rk && timingEqual(clean, rk)) return 'read';
    return null;
  }

  function timingEqual(a, b) {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) return false;
    try {
      return crypto.timingSafeEqual(ba, bb);
    } catch {
      return false;
    }
  }

  // --------------------------- ساخت و خواندن ------------------------------

  /** دفترِ یک پمپ را می‌سازد (اگر نبود) و برمی‌گرداند. */
  async function ensure(code, { name = '' } = {}) {
    const key = safeCode(code);
    if (!key) throw new Error('bad_station_code');

    const existing = stores.get(key);
    if (existing) {
      if (name.trim()) await setName(key, name);
      return existing;
    }

    const store = createStore({ key, label: name.trim() || key, dataDir: dirFor(key) });
    stores.set(key, store);
    await store.ensureToken();
    await ensureReadKey(key);
    await store.loadFromDisk();

    // نام و کد همیشه باید داخلِ خودِ دفتر باشد: اپِ کارمندان از همین‌جا
    // عنوانِ صفحه را می‌گیرد و بی آن، کارمند نمی‌داند دارد کدام پمپ را
    // نگاه می‌کند.
    const meta = store.read(META_BRANCH);
    if (!meta || typeof meta !== 'object') {
      store.write(META_BRANCH, {
        code: key,
        name: name.trim() || key,
        createdAt: Date.now(),
      });
    } else if (name.trim() && meta.name !== name.trim()) {
      await setName(key, name);
    }
    return store;
  }

  async function setName(code, name) {
    const store = stores.get(safeCode(code));
    if (!store) return false;
    const meta = store.read(META_BRANCH);
    store.write(META_BRANCH, {
      ...(meta && typeof meta === 'object' ? meta : {}),
      code: store.key,
      name: String(name || '').trim() || store.key,
    });
    return true;
  }

  const get = (code) => stores.get(safeCode(code)) || null;
  const has = (code) => stores.has(safeCode(code));

  /** پوشهٔ پمپ را با هر چه داخلش هست پاک می‌کند. */
  async function remove(code) {
    const key = safeCode(code);
    const store = stores.get(key);
    if (!store) return false;
    await store.flush().catch(() => {});
    store.closeClients();
    store.stop?.();
    stores.delete(key);
    readKeys.delete(key);
    await fsp.rm(dirFor(key), { recursive: true, force: true });
    return true;
  }

  /** پوشه‌هایی که از قبل روی دیسک هستند را بازمی‌خواند. */
  async function loadAll() {
    let entries = [];
    try {
      entries = await fsp.readdir(dataDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const loaded = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const key = safeCode(entry.name);
      if (!key || stores.has(key)) continue;
      await ensure(key);
      loaded.push(key);
    }
    return loaded;
  }

  const nameOf = (store) => {
    const meta = store.read(META_BRANCH);
    return (meta && typeof meta === 'object' && meta.name) || store.key;
  };

  /** فهرستِ پمپ‌ها برای پنل — بی رمز. */
  function list() {
    return [...stores.values()].map((store) => {
      const snap = store.snapshot();
      const live = store.read(LIVE_BRANCH);
      const inbox = store.read(INBOX_BRANCH);
      return {
        code: store.key,
        name: nameOf(store),
        dataDir: store.dataDir,
        branches: store.branches(),
        diskBytes: store.diskBytes(),
        liveConnections: snap.liveConnections,
        lastActivity: snap.lastActivity,
        reads: snap.reads,
        writes: snap.writes,
        // «آخرین بار کِی برنامهٔ کامپیوتر چیزی فرستاد» — کاربر با همین
        // می‌فهمد پمپ زنده است یا برنامه‌اش خاموش
        liveAt: live && typeof live === 'object' ? Number(live.at) || null : null,
        liveSeq: live && typeof live === 'object' ? Number(live.seq) || null : null,
        inboxCount: inbox && typeof inbox === 'object' ? Object.keys(inbox).length : 0,
      };
    });
  }

  /** فهرستِ کوتاه برای اپ‌ها — فقط کد و نام. */
  const directory = () =>
    [...stores.values()].map((store) => ({ code: store.key, name: nameOf(store) }));

  // ------------------------------ کدِ جفت‌شدن ------------------------------
  //
  //  برای وقتی که برنامهٔ نیتیو از شبکهٔ خانگی نیست (مثلاً از راهِ تونل):
  //  پنل یک کدِ شش‌رقمیِ ده‌دقیقه‌ای می‌سازد، صاحب سرور آن را در برنامه
  //  می‌زند و برنامه رمزِ پمپِ خودش را می‌گیرد.

  const PAIR_TTL_MS = 10 * 60 * 1000;

  function createPairing({ code, name = '' } = {}) {
    const key = safeCode(code);
    if (!key) throw new Error('bad_station_code');
    prunePairings();
    const pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    pairings.set(pin, { code: key, name: String(name || '').trim(), expires: Date.now() + PAIR_TTL_MS });
    return { pin, code: key, expiresIn: Math.round(PAIR_TTL_MS / 1000) };
  }

  function prunePairings() {
    const now = Date.now();
    for (const [pin, entry] of pairings) if (entry.expires <= now) pairings.delete(pin);
  }

  function takePairing(pin) {
    prunePairings();
    const clean = String(pin || '').trim();
    if (!clean) return null;
    const entry = pairings.get(clean);
    if (!entry) return null;
    pairings.delete(clean); // یک‌بار مصرف
    return entry;
  }

  const pendingPairings = () => {
    prunePairings();
    return [...pairings.entries()].map(([pin, e]) => ({ pin, code: e.code, name: e.name, expires: e.expires }));
  };

  /**
   * ثبتِ برنامهٔ نیتیو — همان «اگر آدرس نداشت، برایش بساز».
   *
   * سه راه، به همین ترتیب:
   *   ۱) کدِ جفت‌شدنِ درست  → همیشه، حتی از اینترنت
   *   ۲) رمزِ درستِ همان پمپ → همان رمز دوباره برگردانده می‌شود (نصبِ دوباره)
   *   ۳) پمپ هنوز نیست و درخواست از شبکهٔ خانگی است → ساخته می‌شود
   *
   * @returns {Promise<{ok:true,code:string,name:string,token:string,created:boolean}
   *                  | {ok:false,error:string}>}
   */
  async function enrollStation({ code, name = '', token = '', pin = '', local = false }) {
    const pinGiven = String(pin || '').trim().length > 0;
    const paired = pinGiven ? takePairing(pin) : null;
    /* ⚠️ کدِ جفت‌شدنِ غلط نباید بی‌صدا از راهِ «شبکهٔ خانگی» رد شود: کاربر
       کدی زده و منتظرِ جوابِ همان کد است. اگر این‌جا رد می‌شد، یک اشتباهِ
       تایپی به‌جای خطا یک پمپِ تازه و خالی می‌ساخت و کاربر ساعت‌ها دنبالِ
       دادهٔ گم‌شده می‌گشت. */
    if (pinGiven && !paired) return { ok: false, error: 'bad_pin' };
    const key = safeCode(paired?.code || code);
    if (!key) return { ok: false, error: 'bad_station_code' };

    const wanted = String(name || paired?.name || '').trim();
    const existing = stores.get(key);

    if (existing) {
      const allowed = Boolean(paired) || existing.acceptsToken(String(token || ''));
      if (!allowed) return { ok: false, error: 'already_taken' };
      if (wanted) await setName(key, wanted);
      return {
        ok: true,
        code: key,
        name: nameOf(existing),
        token: existing.getToken(),
        readKey: readKeyOf(key),
        created: false,
      };
    }

    if (!paired) {
      if (enroll === 'off') return { ok: false, error: 'enroll_closed' };
      if (enroll === 'lan' && !local) return { ok: false, error: 'enroll_lan_only' };
    }

    const store = await ensure(key, { name: wanted });
    return {
      ok: true,
      code: key,
      name: nameOf(store),
      token: store.getToken(),
      readKey: readKeyOf(key),
      created: true,
    };
  }

  // ------------------------------ وب‌سوکت ---------------------------------
  //
  //  ‎wss://<میزبان>/station?station=<کد>&token=<رمز>‎
  //  و از آن به بعد دقیقاً همان پروتکلِ دفترهای site-sync (‎sub/get/set/…‎)،
  //  ولی مسیرها داخلِ پوشهٔ همان پمپ‌اند: ‎live‎، ‎inbox‎، ‎station‎.

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
  attachHeartbeat(wss);

  function route(req) {
    let url = null;
    try {
      url = new URL(req.url, 'http://x');
    } catch { /* مسیر خراب */ }

    const code =
      url?.searchParams.get('station') || url?.searchParams.get('code') || url?.searchParams.get('pump') || '';
    const token =
      url?.searchParams.get('token') ||
      String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');

    if (!code) return { store: null, reason: 'no_station' };
    const store = get(code);
    if (!store) return { store: null, reason: 'unknown_station' };
    // ⚠️ رمزِ خالی هرگز پذیرفته نمی‌شود: هر پمپ رمزِ خودش را دارد و بی آن،
    // هر کسی که کدِ پمپ را حدس بزند دفترِ همان پمپ را می‌خواند.
    const access = accessOf(code, token);
    if (!access) return { store, reason: 'auth_failed' };
    return { store, readOnly: access === 'read' };
  }

  function handleUpgrade(req, socket, head) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      const { store, reason, readOnly } = route(req);
      if (reason || !store) {
        // دفتری در کار نیست که پیام خطا را بفرستد، پس دستی می‌فرستیم
        try {
          ws.send(JSON.stringify({ op: 'error', msg: reason || 'auth_failed' }));
          ws.close();
        } catch { /* بسته شد */ }
        return;
      }
      store.handleConnection(ws, req, { readOnly: Boolean(readOnly) });
    });
  }

  /** آیا این مسیرِ ارتقا مالِ همین بخش است؟ */
  const ownsPath = (pathname) => /^\/(station|stations|pump)(\/|$)/.test(String(pathname || ''));

  // -------------------------------- عمومی ---------------------------------
  async function flush() {
    for (const store of stores.values()) await store.flush().catch(() => {});
  }

  function snapshot() {
    let connections = 0;
    let writes = 0;
    let reads = 0;
    let bytes = 0;
    for (const store of stores.values()) {
      const s = store.snapshot();
      connections += s.liveConnections;
      writes += s.writes;
      reads += s.reads;
      bytes += store.diskBytes();
    }
    return { stations: stores.size, connections, writes, reads, diskBytes: bytes };
  }

  return {
    wss,
    dataDir,
    enrollMode: enroll,
    dirFor,
    ownsPath,
    handleUpgrade,
    ensure,
    get,
    has,
    remove,
    setName,
    loadAll,
    list,
    directory,
    codes: () => [...stores.keys()],
    enroll: enrollStation,
    accessOf,
    readKeyOf,
    rotateReadKey,
    createPairing,
    pendingPairings,
    flush,
    snapshot,
  };
}
