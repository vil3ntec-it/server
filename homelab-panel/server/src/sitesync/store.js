// ---------------------------------------------------------------------------
//  یک «دفترِ داده» مستقل — همان پروتکل realtime (جایگزین فایربیس)
//
//  هر سایت یکی از این‌ها را برای خودش دارد، با پوشه و رمزِ جداگانه، تا دادهٔ
//  هیچ سایتی با سایتِ دیگر قاطی یا گم نشود. مدیریتِ چند دفتر با هم در
//  فایلِ index.js کنار همین فایل انجام می‌شود.
//
//  پروتکل ذره‌ای تغییر نکرده تا سایت بدون هیچ دست‌کاری با آن کار کند.
//
//  ── چرا برنامه یخ می‌زد ───────────────────────────────────────────────────
//  نسخهٔ قبل برای *هر* نوشتنِ کوچک (مثلاً عوض شدنِ یک عدد در یک ردیف):
//    ۱) کلِ شاخه را برای مقایسه JSON می‌کرد،
//    ۲) بعد همان مقدار را با JSON.parse(JSON.stringify()) کپیِ عمیق می‌گرفت،
//    ۳) بعد دوباره برای فرستادن JSON می‌کرد،
//    ۴) و برای اشتراک‌های child، *همهٔ* بچه‌ها را از نو JSON می‌کرد.
//  یعنی با ۶۰۰ قرض‌دار، هر بار تایپ کردن چند مگابایت به گوشی می‌فرستاد و
//  حلقهٔ رویدادِ سرور را ده‌ها میلی‌ثانیه قفل می‌کرد. گوشی هم باید همان چند
//  مگابایت را parse و از نو رسم می‌کرد → هنگ و ری‌استارت.
//
//  حالا:
//    • رویدادها در یک «تیک» جمع می‌شوند و یک‌بار فرستاده می‌شوند (نه صدبار)،
//    • کپیِ عمیق حذف شد و رشتهٔ JSON فقط یک‌بار ساخته و همان فرستاده می‌شود،
//    • اشتراکِ child فقط بچه‌های واقعاً عوض‌شده را از نو حساب می‌کند،
//    • اگر گوشی عقب بماند، به‌جای انباشتنِ پیام صبر می‌کنیم (backpressure)،
//    • اتصالِ مرده با ping/pong پیدا و بسته می‌شود.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const PERSIST_DEBOUNCE_MS = 400;
// حتی اگر یک‌ریز تایپ شود، بیشتر از این روی دیسک نوشتن عقب نمی‌افتد
const PERSIST_MAX_WAIT_MS = 2000;
// وقتی صفِ ارسالِ یک اتصال از این بیشتر شود، تا خالی شدنش چیزی نمی‌فرستیم
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const BACKPRESSURE_RETRY_MS = 120;
// اتصالِ گوشی روی شبکهٔ موبایل بی‌صدا می‌میرد؛ با این ضربان پیدایش می‌کنیم
const HEARTBEAT_MS = 30000;
// اگر تعدادِ مسیرهای عوض‌شده در یک تیک از این بیشتر شد، به‌جای ردیابیِ تک‌تک
// یک‌بار همه‌چیز را از نو حساب می‌کنیم — ارزان‌تر از نگه‌داشتنِ فهرستِ بلند
const DIRTY_PATH_LIMIT = 512;
// اشتراکِ value روی یک شاخهٔ بزرگ (مثلاً کلِ قرض‌داران) با هر تغییرِ کوچک باید
// کلِ شاخه را بفرستد — این ذاتِ پروتکل است و نمی‌شود عوضش کرد بدون دست زدن به
// خودِ سایت. ولی می‌شود جلوی «چند مگابایت در ثانیه» را گرفت: بالای این اندازه،
// بیشتر از هر ۲۵۰ میلی‌ثانیه یک‌بار فرستاده نمی‌شود و تغییرهای این فاصله با هم
// در یک پیام می‌روند. آخرین حالت همیشه می‌رسد، فقط چند صدم ثانیه دیرتر.
const BIG_VALUE_BYTES = 64 * 1024;
const BIG_VALUE_MIN_GAP_MS = 250;

export function createStore({ key = 'main', label = null, dataDir, token = '', seedToken = '', alsoAccept = [] }) {
  fs.mkdirSync(dataDir, { recursive: true });

  const ROOT = {};
  const pendingPersist = new Map();
  const subscriptions = new Set();
  const clients = new Set();
  let AUTH_TOKEN = token;
  // رمزهای همیشه‌پذیرفته کنارِ رمزِ اصلی. فقط دفترِ اصلی از این استفاده می‌کند و
  // فقط با رمزی که خودِ برنامه در سایت منتشر می‌کند — پس چیزی که تا حالا محرمانه
  // بوده، محرمانه می‌ماند و در عوض دستگاه‌ها با عوض شدنِ رمزِ سرور بیرون نمی‌مانند.
  const EXTRA_TOKENS = (Array.isArray(alsoAccept) ? alsoAccept : [alsoAccept])
    .map((t) => String(t || '').trim())
    .filter(Boolean);
  const stats = { connections: 0, messages: 0, writes: 0, reads: 0, lastActivity: null, rejected: 0 };

  // ------------------------------ درخت داده -------------------------------
  const splitPath = (p) => String(p || '').split('/').filter((s) => s.length > 0);

  function getNode(p) {
    let cur = ROOT;
    for (const s of splitPath(p)) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[s];
    }
    return cur;
  }

  /** مثل getNode ولی مسیرِ از قبل تکه‌شده می‌گیرد — در حلقه‌های داغ ارزان‌تر است */
  function getBySegs(segs) {
    let cur = ROOT;
    for (const s of segs) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[s];
    }
    return cur;
  }

  function setNode(p, value) {
    const segs = splitPath(p);
    if (!segs.length) return;
    let cur = ROOT;
    for (let i = 0; i < segs.length - 1; i++) {
      const s = segs[i];
      if (cur[s] == null || typeof cur[s] !== 'object') cur[s] = {};
      cur = cur[s];
    }
    const last = segs[segs.length - 1];
    if (value === null || value === undefined) delete cur[last];
    else cur[last] = value;
  }

  // شناسهٔ push مثل فایربیس (۲۰ کاراکتر، مرتب بر اساس زمان)
  const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
  let _lastPushTime = 0;
  const _lastRand = [];
  function genPushId(now = Date.now()) {
    const dup = now === _lastPushTime;
    _lastPushTime = now;
    const ts = new Array(8);
    for (let i = 7; i >= 0; i--) {
      ts[i] = PUSH_CHARS.charAt(now % 64);
      now = Math.floor(now / 64);
    }
    let id = ts.join('');
    if (!dup) {
      for (let i = 0; i < 12; i++) _lastRand[i] = Math.floor(Math.random() * 64);
    } else {
      let i = 11;
      for (; i >= 0 && _lastRand[i] === 63; i--) _lastRand[i] = 0;
      _lastRand[i]++;
    }
    for (let i = 0; i < 12; i++) id += PUSH_CHARS.charAt(_lastRand[i]);
    return id;
  }

  // ------------------------------- پایداری --------------------------------
  const topKeyOf = (p) => splitPath(p)[0] ?? null;
  const fileForKey = (k) => path.join(dataDir, String(k).replace(/[^a-zA-Z0-9_-]/g, '_') + '.json');

  // حجمِ هر شاخه روی دیسک؛ تا پنل برای هر بار گزارش، statSync نزند
  const sizeCache = new Map();
  // اثرِ انگشتِ آخرین چیزی که نوشتیم — نوشتنِ تکراری را کامل حذف می‌کند
  const persistedHash = new Map();
  // نوشتن‌های یک شاخه پشتِ سرِ هم صف می‌شوند، نه هم‌زمان: دو `rename` هم‌زمان
  // روی یک فایل می‌توانند نتیجهٔ قدیمی‌تر را آخر بنشانند.
  const persistChain = new Map();

  function schedulePersist(topKey) {
    if (!topKey) return;
    const existing = pendingPersist.get(topKey);
    const now = Date.now();
    if (existing) {
      // تایپِ پشت‌سرهم نباید نوشتن را تا ابد عقب بیندازد
      if (now - existing.firstAt >= PERSIST_MAX_WAIT_MS) return;
      clearTimeout(existing.timer);
    }
    const firstAt = existing ? existing.firstAt : now;
    const wait = Math.min(PERSIST_DEBOUNCE_MS, Math.max(0, firstAt + PERSIST_MAX_WAIT_MS - now));
    const timer = setTimeout(() => {
      pendingPersist.delete(topKey);
      persistNow(topKey).catch(() => {});
    }, wait);
    timer.unref?.();
    pendingPersist.set(topKey, { timer, firstAt });
  }

  async function writeBranch(topKey) {
    const file = fileForKey(topKey);
    const val = ROOT[topKey];
    if (val === undefined) {
      persistedHash.delete(topKey);
      sizeCache.delete(topKey);
      try {
        await fsp.unlink(file);
      } catch { /* شاید از قبل نبود */ }
      return;
    }
    const text = JSON.stringify(val);
    // اگر عیناً همان چیزی است که قبلاً نوشتیم، دیسک را بی‌جهت نچرخانیم
    const fingerprint = crypto.createHash('sha1').update(text).digest('base64');
    if (persistedHash.get(topKey) === fingerprint) return;
    const tmp = file + '.tmp';
    await fsp.writeFile(tmp, text, 'utf8');
    await fsp.rename(tmp, file);
    persistedHash.set(topKey, fingerprint);
    sizeCache.set(topKey, Buffer.byteLength(text));
  }

  /** نوشتن را به انتهای صفِ همین شاخه می‌چسباند و همان صف را برمی‌گرداند */
  function persistNow(topKey) {
    const queued = (persistChain.get(topKey) || Promise.resolve())
      .then(() => writeBranch(topKey))
      .catch(() => { /* یک نوشتنِ ناموفق نباید صف را بشکند */ });
    persistChain.set(topKey, queued);
    queued.finally(() => {
      if (persistChain.get(topKey) === queued) persistChain.delete(topKey);
    });
    return queued;
  }

  async function loadFromDisk() {
    let files = [];
    try {
      files = await fsp.readdir(dataDir);
    } catch {
      return [];
    }
    const loaded = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const text = await fsp.readFile(path.join(dataDir, f), 'utf8');
        const branch = f.slice(0, -5);
        ROOT[branch] = JSON.parse(text);
        persistedHash.set(branch, crypto.createHash('sha1').update(text).digest('base64'));
        sizeCache.set(branch, Buffer.byteLength(text));
        loaded.push(branch);
      } catch { /* فایل خراب — رد شو */ }
    }
    return loaded;
  }

  // ------------------------------ رویدادها --------------------------------
  const isOpenSocket = (ws) => ws && ws.readyState === ws.OPEN;

  /** رشتهٔ آمادهٔ JSON را همان‌طور که هست می‌فرستد — بدون stringify دوباره */
  function sendRaw(ws, text) {
    if (!isOpenSocket(ws)) return;
    try {
      ws.send(text);
    } catch { /* اتصال بسته شد */ }
  }

  const send = (ws, obj) => sendRaw(ws, JSON.stringify(obj));

  const serialize = (v) => (v === undefined ? ' undef' : JSON.stringify(v));
  /** همان serialize ولی خروجی همیشه JSON معتبر است (undefined → null) */
  const jsonOrNull = (v) => {
    const s = v === undefined ? undefined : JSON.stringify(v);
    return s === undefined ? 'null' : s;
  };
  const serToJson = (ser) => (ser === undefined || ser === ' undef' ? 'null' : ser);
  const lastSeg = (p) => splitPath(p).at(-1) ?? null;

  /** فریمِ رویداد را دستی می‌سازیم تا مقدارِ از قبل JSON‌شده دوباره JSON نشود */
  function eventFrame(subId, type, key, serValue) {
    return (
      '{"op":"event","subId":' + jsonOrNull(subId) +
      ',"type":"' + type +
      '","key":' + jsonOrNull(key) +
      ',"value":' + serToJson(serValue) +
      '}'
    );
  }

  /** آیا صفِ ارسالِ این اتصال پر شده؟ (گوشیِ کند یا شبکهٔ ضعیف) */
  const backedUp = (ws) => (ws.bufferedAmount || 0) > MAX_BUFFERED_BYTES;

  function childKeysSorted(p) {
    const node = getNode(p);
    if (node == null || typeof node !== 'object' || Array.isArray(node)) return [];
    return Object.keys(node).sort();
  }

  function primeSubscription(sub) {
    if (sub.event === 'value') {
      const ser = serialize(getBySegs(sub.segs));
      sub.snapValue = ser;
      sub.lastBytes = ser.length;   // برای تصمیمِ «این شاخه بزرگ است یا نه»
      sub.lastSentAt = Date.now();
      sendRaw(sub.ws, eventFrame(sub.subId, 'value', lastSeg(sub.path), ser));
    } else {
      let keys = childKeysSorted(sub.path);
      if (sub.limit && keys.length > sub.limit) keys = keys.slice(keys.length - sub.limit);
      sub.snapChildren = new Map();
      const node = getBySegs(sub.segs);
      for (const k of keys) {
        const ser = serialize(node == null ? undefined : node[k]);
        sub.snapChildren.set(k, ser);
        if (sub.event === 'child_added') {
          sendRaw(sub.ws, eventFrame(sub.subId, 'child_added', k, ser));
        }
      }
    }
  }

  function isPrefixOrEqual(a, b) {
    if (a.length > b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /**
   * اشتراکِ child را از نو حساب می‌کند.
   * `affected` = نامِ بچه‌هایی که واقعاً دست خورده‌اند (null یعنی «نمی‌دانیم، همه را
   * نگاه کن»). با آن، به‌جای JSON کردنِ هر ۶۰۰ قرض‌دار، فقط همان یکی را JSON می‌کنیم.
   */
  function reevalChildSub(sub, affected) {
    let keys = childKeysSorted(sub.path);
    const fullSet = new Set(keys);
    if (sub.limit && keys.length > sub.limit) keys = keys.slice(keys.length - sub.limit);
    const windowSet = new Set(keys);
    const prev = sub.snapChildren || new Map();
    const next = new Map();
    const node = getBySegs(sub.segs);

    for (const k of keys) {
      const cached = prev.get(k);
      // بچه‌ای که دست نخورده و از قبل حساب شده، همان مقدارِ ذخیره‌شده را نگه می‌دارد
      if (cached !== undefined && affected !== null && !affected.has(k)) {
        next.set(k, cached);
        continue;
      }
      const ser = serialize(node == null ? undefined : node[k]);
      next.set(k, ser);
      if (cached === undefined) {
        if (sub.event === 'child_added') sendRaw(sub.ws, eventFrame(sub.subId, 'child_added', k, ser));
      } else if (cached !== ser && sub.event === 'child_changed') {
        sendRaw(sub.ws, eventFrame(sub.subId, 'child_changed', k, ser));
      }
    }
    for (const k of prev.keys()) {
      if (!windowSet.has(k) && !fullSet.has(k) && sub.event === 'child_removed') {
        sendRaw(sub.ws, eventFrame(sub.subId, 'child_removed', k, 'null'));
      }
    }
    sub.snapChildren = next;
  }

  // ---------------------- جمع کردنِ رویدادها در یک تیک ----------------------
  // به‌جای اینکه هر نوشتن فوراً همه‌جا پخش شود، مسیرهای عوض‌شده را نگه می‌داریم و
  // در پایانِ همان تیک یک‌بار حساب می‌کنیم. ۱۰۰ نوشتنِ پشت‌سرهم = یک بار محاسبه.
  const dirtyPaths = [];
  let dirtyAll = false;
  let flushHandle = null;
  let flushIsTimer = false;
  /** اشتراک‌هایی که به‌خاطر پر بودنِ صفِ اتصال عقب افتاده‌اند */
  const deferredSubs = new Set();

  function scheduleFlush(delayMs = 0) {
    if (flushHandle) {
      // یک اشتراکِ سنگین که عقب افتاده نباید بقیه را هم پشتِ خودش نگه دارد:
      // اگر کارِ فوری رسید و صفِ فعلی یک تایمرِ دیرتر است، جلو می‌اندازیمش.
      if (!(flushIsTimer && delayMs === 0)) return;
      cancelFlush();
    }
    flushIsTimer = delayMs > 0;
    flushHandle = flushIsTimer ? setTimeout(runFlush, delayMs) : setImmediate(runFlush);
    flushHandle.unref?.();
  }

  function cancelFlush() {
    if (!flushHandle) return;
    if (flushIsTimer) clearTimeout(flushHandle);
    else clearImmediate(flushHandle);
    flushHandle = null;
  }

  function runFlush() {
    flushHandle = null;
    flushEvents();
  }

  function markDirty(p) {
    if (!dirtyAll) {
      if (dirtyPaths.length >= DIRTY_PATH_LIMIT) {
        dirtyAll = true;
        dirtyPaths.length = 0;
      } else {
        dirtyPaths.push(splitPath(p));
      }
    }
    scheduleFlush();
  }

  function flushEvents() {
    if (!dirtyAll && dirtyPaths.length === 0 && deferredSubs.size === 0) return;

    const changed = dirtyPaths.slice();
    const everything = dirtyAll;
    dirtyPaths.length = 0;
    dirtyAll = false;

    const now = Date.now();
    // چند اشتراک روی یک مسیر = یک بار JSON، نه چند بار
    const memo = new Map();
    let retryIn = 0;
    const askRetry = (ms) => {
      retryIn = retryIn ? Math.min(retryIn, ms) : ms;
    };

    for (const sub of subscriptions) {
      let touched = everything;
      // null یعنی «کلِ اشتراک را از نو حساب کن»
      let affected = everything ? null : new Set();

      if (deferredSubs.has(sub)) {
        touched = true;
        affected = null;
      }

      if (!touched || affected !== null) {
        for (const c of changed) {
          if (isPrefixOrEqual(sub.segs, c)) {
            touched = true;
            if (c.length > sub.segs.length) {
              affected.add(c[sub.segs.length]);
            } else {
              affected = null; // خودِ ریشهٔ اشتراک عوض شد
              break;
            }
          } else if (isPrefixOrEqual(c, sub.segs)) {
            touched = true;
            affected = null; // جایی بالاتر از اشتراک عوض شد
            break;
          }
        }
      }

      if (!touched) continue;

      // اتصال هنوز پیامِ قبلی را نفرستاده — پیام روی پیام تلنبار نکنیم
      if (!isOpenSocket(sub.ws)) continue;
      if (backedUp(sub.ws)) {
        deferredSubs.add(sub);
        askRetry(BACKPRESSURE_RETRY_MS);
        continue;
      }

      if (sub.event === 'value') {
        // شاخهٔ بزرگ: بیشتر از هر ۲۵۰ms یک‌بار نه — وگرنه هر تایپ چند مگابایت است
        if (sub.lastBytes > BIG_VALUE_BYTES) {
          const waitLeft = BIG_VALUE_MIN_GAP_MS - (now - (sub.lastSentAt || 0));
          if (waitLeft > 0) {
            deferredSubs.add(sub);
            askRetry(waitLeft);
            continue;
          }
        }
        deferredSubs.delete(sub);
        let ser = memo.get(sub.path);
        if (ser === undefined) {
          ser = serialize(getBySegs(sub.segs));
          memo.set(sub.path, ser);
        }
        if (ser !== sub.snapValue) {
          sub.snapValue = ser;
          sub.lastBytes = ser.length;
          sub.lastSentAt = now;
          sendRaw(sub.ws, eventFrame(sub.subId, 'value', lastSeg(sub.path), ser));
        }
      } else {
        deferredSubs.delete(sub);
        reevalChildSub(sub, affected);
      }
    }

    // اشتراک‌هایی که اتصالشان بسته شده در deferred نمانند
    for (const sub of deferredSubs) {
      if (!subscriptions.has(sub) || !isOpenSocket(sub.ws)) deferredSubs.delete(sub);
    }
    if (retryIn && deferredSubs.size) scheduleFlush(Math.max(1, Math.ceil(retryIn)));
  }

  function applyMutation(kind, p, value) {
    stats.writes++;
    if (kind === 'set' || kind === 'remove') {
      setNode(p, kind === 'remove' ? null : value);
      schedulePersist(topKeyOf(p));
      markDirty(p);
    } else if (kind === 'update') {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const k of Object.keys(value)) setNode(p + '/' + k, value[k]);
        schedulePersist(topKeyOf(p));
        // همهٔ کلیدهای این update در همان یک تیک با هم پخش می‌شوند
        for (const k of Object.keys(value)) markDirty(p + '/' + k);
      }
    } else if (kind === 'push') {
      const key = genPushId();
      setNode(p + '/' + key, value);
      schedulePersist(topKeyOf(p));
      markDirty(p + '/' + key);
      return key;
    }
  }

  function runOnDisconnect(ws) {
    const ops = ws._onDisc;
    if (!ops) return;
    for (const [p, spec] of ops) {
      try {
        if (spec.action === 'remove') applyMutation('remove', p, null);
        else if (spec.action === 'set') applyMutation('set', p, spec.value);
      } catch { /* بی‌خیال */ }
    }
    ws._onDisc = null;
  }

  function handleMessage(ws, m) {
    stats.messages++;
    stats.lastActivity = Date.now();
    switch (m.op) {
      case 'get':
        stats.reads++;
        // مقدار فقط یک‌بار JSON می‌شود — نه کپیِ عمیق، نه stringify دوباره
        sendRaw(ws, '{"op":"result","id":' + jsonOrNull(m.id) + ',"value":' + jsonOrNull(getNode(m.path)) + '}');
        break;
      case 'set':
        applyMutation('set', m.path, m.value);
        send(ws, { op: 'ack', id: m.id, ok: true });
        break;
      case 'update':
        applyMutation('update', m.path, m.value);
        send(ws, { op: 'ack', id: m.id, ok: true });
        break;
      case 'remove':
        applyMutation('remove', m.path, null);
        send(ws, { op: 'ack', id: m.id, ok: true });
        break;
      case 'push':
        send(ws, { op: 'ack', id: m.id, ok: true, key: applyMutation('push', m.path, m.value) });
        break;
      case 'sub': {
        // اگر همین شناسه از قبل باز است، نسخهٔ قدیمی نباید در فهرست جا بماند
        const stale = ws._subs?.get(m.subId);
        if (stale) {
          subscriptions.delete(stale);
          deferredSubs.delete(stale);
        }
        const sub = {
          ws,
          path: m.path,
          segs: splitPath(m.path),
          event: m.event,
          subId: m.subId,
          limit: m.limitToLast || 0,
          snapChildren: null,
          snapValue: undefined,
        };
        subscriptions.add(sub);
        // پیدا کردنِ اشتراک هنگام unsub نباید کلِ فهرست را بگردد
        ws._subs?.set(m.subId, sub);
        primeSubscription(sub);
        break;
      }
      case 'unsub': {
        const sub = ws._subs?.get(m.subId);
        if (sub) {
          subscriptions.delete(sub);
          deferredSubs.delete(sub);
          ws._subs.delete(m.subId);
        }
        break;
      }
      case 'onDisc':
        if (!ws._onDisc) ws._onDisc = new Map();
        ws._onDisc.set(m.path, { action: m.action, value: m.value });
        break;
      case 'onDiscCancel':
        if (ws._onDisc) ws._onDisc.delete(m.path);
        break;
      default:
        break;
    }
  }

  function safeEqual(a, b) {
    const ba = Buffer.from(String(a || ''));
    const bb = Buffer.from(String(b || ''));
    if (ba.length !== bb.length) return false;
    try {
      return crypto.timingSafeEqual(ba, bb);
    } catch {
      return false;
    }
  }

  // ------------------------------ WebSocket -------------------------------
  /** آیا این رمز به همین دفتر می‌خورد؟ (رمز خالی یعنی دفتر باز است) */
  function acceptsToken(candidate) {
    if (AUTH_TOKEN === '') return true;
    if (safeEqual(candidate, AUTH_TOKEN)) return true;
    return EXTRA_TOKENS.some((t) => safeEqual(candidate, t));
  }

  /** آیا این دفتر هر رمزی را می‌پذیرد؟ (برای پیدا کردنِ دفتر از روی رمز مهم است) */
  function isOpen() {
    return AUTH_TOKEN === '';
  }

  function reject(ws, msg = 'auth_failed') {
    stats.rejected++;
    send(ws, { op: 'error', msg });
    try {
      ws.close();
    } catch { /* بسته شده */ }
  }

  /** اتصالِ تاییدشده را به همین دفتر می‌چسباند */
  function handleConnection(ws, req) {
    ws._onDisc = null;
    ws._subs = new Map();
    ws._alive = true;
    ws._connectedAt = Date.now();
    ws._remote = req.socket.remoteAddress;
    clients.add(ws);
    stats.connections++;
    stats.lastActivity = Date.now();
    send(ws, { op: 'connected' });

    ws.on('message', (raw) => {
      ws._alive = true;
      let m;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (m && typeof m === 'object') handleMessage(ws, m);
    });

    ws.on('pong', () => {
      ws._alive = true;
    });

    ws.on('close', () => {
      runOnDisconnect(ws);
      for (const sub of ws._subs?.values() || []) {
        subscriptions.delete(sub);
        deferredSubs.delete(sub);
      }
      ws._subs = null;
      clients.delete(ws);
    });
    ws.on('error', () => {});
  }

  // گوشی که از شبکه افتاده، بدون این ضربان تا ابد در فهرست می‌ماند و سرور
  // برای همان اتصالِ مرده هم داده حساب می‌کند.
  const heartbeat = setInterval(() => {
    for (const ws of [...clients]) {
      if (ws._alive === false) {
        try {
          (ws.terminate || ws.close).call(ws);
        } catch { /* بسته شده */ }
        clients.delete(ws);
        continue;
      }
      ws._alive = false;
      try {
        ws.ping?.();
      } catch { /* بسته شده */ }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  // ------------------------------- عمومی ---------------------------------
  async function ensureToken() {
    if (AUTH_TOKEN) return AUTH_TOKEN;
    const tokenFile = path.join(dataDir, 'token.txt');
    try {
      const existing = (await fsp.readFile(tokenFile, 'utf8')).trim();
      if (existing) {
        AUTH_TOKEN = existing;
        return AUTH_TOKEN;
      }
    } catch { /* هنوز ساخته نشده */ }
    // رمزِ دفترِ اصلی از یک مقدارِ ثابت شروع می‌شود (همان رمزی که خودِ برنامه دارد)،
    // نه از یک رمزِ تصادفی. چرا: با هر بار نصبِ دوباره یا جابه‌جا شدنِ پوشهٔ داده،
    // رمزِ تصادفیِ تازه ساخته می‌شد و از آن لحظه همهٔ دستگاه‌ها پشتِ در می‌ماندند
    // بدون اینکه هیچ راهی برای فهمیدنِ رمزِ تازه داشته باشند.
    AUTH_TOKEN = seedToken || crypto.randomBytes(18).toString('hex');
    await fsp.writeFile(tokenFile, AUTH_TOKEN, 'utf8');
    return AUTH_TOKEN;
  }

  async function rotateToken() {
    AUTH_TOKEN = crypto.randomBytes(18).toString('hex');
    await fsp.writeFile(path.join(dataDir, 'token.txt'), AUTH_TOKEN, 'utf8');
    for (const ws of [...clients]) {
      try {
        ws.close();
      } catch { /* بی‌خیال */ }
    }
    return AUTH_TOKEN;
  }

  async function flush() {
    for (const [k, entry] of pendingPersist) {
      clearTimeout(entry.timer);
      persistNow(k);
    }
    pendingPersist.clear();
    // تا آخرین نوشتنِ در صف تمام نشده برنمی‌گردیم — هنگام خاموش شدنِ سرور
    // همین یک خط تفاوتِ «داده ذخیره شد» و «داده رفت» است
    await Promise.all([...persistChain.values()]).catch(() => {});
  }

  function branches() {
    return Object.keys(ROOT).map((k) => {
      let bytes = sizeCache.get(k);
      if (bytes === undefined) {
        try {
          bytes = fs.statSync(fileForKey(k)).size;
        } catch {
          bytes = 0; // هنوز روی دیسک نیست
        }
        sizeCache.set(k, bytes);
      }
      const node = ROOT[k];
      return {
        key: k,
        children: node && typeof node === 'object' ? Object.keys(node).length : 0,
        bytes,
      };
    });
  }

  return {
    key,
    label: label || key,
    dataDir,
    handleConnection,
    acceptsToken,
    isOpen,
    reject,
    ensureToken,
    rotateToken,
    getToken: () => AUTH_TOKEN,
    loadFromDisk,
    flush,
    branches,
    /** مجموع حجم فایل‌های همین دفتر روی دیسک */
    diskBytes: () => branches().reduce((sum, b) => sum + b.bytes, 0),
    closeClients: () => {
      for (const ws of [...clients]) {
        try {
          ws.close();
        } catch { /* بی‌خیال */ }
      }
    },
    /** دفترِ حذف‌شده نباید تایمرِ ضربان را زنده نگه دارد */
    stop: () => {
      clearInterval(heartbeat);
      cancelFlush();
    },
    snapshot: () => ({
      ...stats,
      liveConnections: clients.size,
      subscriptions: subscriptions.size,
      branches: Object.keys(ROOT).length,
      clients: [...clients].map((ws) => ({ since: ws._connectedAt, remote: ws._remote })),
    }),
  };
}
