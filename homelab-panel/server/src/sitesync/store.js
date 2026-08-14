// ---------------------------------------------------------------------------
//  یک «دفترِ داده» مستقل — همان پروتکل realtime (جایگزین فایربیس)
//
//  هر سایت یکی از این‌ها را برای خودش دارد، با پوشه و رمزِ جداگانه، تا دادهٔ
//  هیچ سایتی با سایتِ دیگر قاطی یا گم نشود. مدیریتِ چند دفتر با هم در
//  فایلِ index.js کنار همین فایل انجام می‌شود.
//
//  پروتکل ذره‌ای تغییر نکرده تا سایت بدون هیچ دست‌کاری با آن کار کند.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const PERSIST_DEBOUNCE_MS = 400;

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

  const deepClone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

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

  function schedulePersist(topKey) {
    if (!topKey) return;
    if (pendingPersist.has(topKey)) clearTimeout(pendingPersist.get(topKey));
    pendingPersist.set(
      topKey,
      setTimeout(() => {
        pendingPersist.delete(topKey);
        persistNow(topKey).catch(() => {});
      }, PERSIST_DEBOUNCE_MS)
    );
  }

  async function persistNow(topKey) {
    const file = fileForKey(topKey);
    const val = ROOT[topKey];
    if (val === undefined) {
      try {
        await fsp.unlink(file);
      } catch { /* شاید از قبل نبود */ }
      return;
    }
    const tmp = file + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(val), 'utf8');
    await fsp.rename(tmp, file);
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
        ROOT[f.slice(0, -5)] = JSON.parse(await fsp.readFile(path.join(dataDir, f), 'utf8'));
        loaded.push(f.slice(0, -5));
      } catch { /* فایل خراب — رد شو */ }
    }
    return loaded;
  }

  // ------------------------------ رویدادها --------------------------------
  const send = (ws, obj) => {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(JSON.stringify(obj));
      } catch { /* اتصال بسته شد */ }
    }
  };
  const serialize = (v) => (v === undefined ? ' undef' : JSON.stringify(v));
  const lastSeg = (p) => splitPath(p).at(-1) ?? null;

  function childKeysSorted(p) {
    const node = getNode(p);
    if (node == null || typeof node !== 'object' || Array.isArray(node)) return [];
    return Object.keys(node).sort();
  }

  function primeSubscription(sub) {
    if (sub.event === 'value') {
      const v = getNode(sub.path);
      sub.snapValue = serialize(v);
      send(sub.ws, { op: 'event', subId: sub.subId, type: 'value', key: lastSeg(sub.path), value: deepClone(v) ?? null });
    } else {
      let keys = childKeysSorted(sub.path);
      if (sub.limit && keys.length > sub.limit) keys = keys.slice(keys.length - sub.limit);
      sub.snapChildren = new Map();
      for (const k of keys) {
        const cv = getNode(sub.path + '/' + k);
        sub.snapChildren.set(k, serialize(cv));
        if (sub.event === 'child_added') {
          send(sub.ws, { op: 'event', subId: sub.subId, type: 'child_added', key: k, value: deepClone(cv) ?? null });
        }
      }
    }
  }

  function isPrefixOrEqual(a, b) {
    if (a.length > b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function reevalChildSub(sub) {
    let keys = childKeysSorted(sub.path);
    const fullSet = new Set(keys);
    if (sub.limit && keys.length > sub.limit) keys = keys.slice(keys.length - sub.limit);
    const windowSet = new Set(keys);
    const prev = sub.snapChildren || new Map();
    const next = new Map();

    for (const k of keys) {
      const cv = getNode(sub.path + '/' + k);
      const ser = serialize(cv);
      next.set(k, ser);
      if (!prev.has(k)) {
        if (sub.event === 'child_added') {
          send(sub.ws, { op: 'event', subId: sub.subId, type: 'child_added', key: k, value: deepClone(cv) ?? null });
        }
      } else if (prev.get(k) !== ser && sub.event === 'child_changed') {
        send(sub.ws, { op: 'event', subId: sub.subId, type: 'child_changed', key: k, value: deepClone(cv) ?? null });
      }
    }
    for (const k of prev.keys()) {
      if (!windowSet.has(k) && !fullSet.has(k) && sub.event === 'child_removed') {
        send(sub.ws, { op: 'event', subId: sub.subId, type: 'child_removed', key: k, value: null });
      }
    }
    sub.snapChildren = next;
  }

  function dispatch(changedPath) {
    const cSegs = splitPath(changedPath);
    for (const sub of subscriptions) {
      const sSegs = splitPath(sub.path);
      if (!isPrefixOrEqual(sSegs, cSegs) && !isPrefixOrEqual(cSegs, sSegs)) continue;
      if (sub.event === 'value') {
        const v = getNode(sub.path);
        const ser = serialize(v);
        if (ser !== sub.snapValue) {
          sub.snapValue = ser;
          send(sub.ws, { op: 'event', subId: sub.subId, type: 'value', key: lastSeg(sub.path), value: deepClone(v) ?? null });
        }
      } else {
        reevalChildSub(sub);
      }
    }
  }

  function applyMutation(kind, p, value) {
    stats.writes++;
    if (kind === 'set' || kind === 'remove') {
      setNode(p, kind === 'remove' ? null : value);
      schedulePersist(topKeyOf(p));
      dispatch(p);
    } else if (kind === 'update') {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const k of Object.keys(value)) setNode(p + '/' + k, value[k]);
        schedulePersist(topKeyOf(p));
        for (const k of Object.keys(value)) dispatch(p + '/' + k);
        dispatch(p);
      }
    } else if (kind === 'push') {
      const key = genPushId();
      setNode(p + '/' + key, value);
      schedulePersist(topKeyOf(p));
      dispatch(p + '/' + key);
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
        send(ws, { op: 'result', id: m.id, value: deepClone(getNode(m.path)) ?? null });
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
        const sub = {
          ws,
          path: m.path,
          event: m.event,
          subId: m.subId,
          limit: m.limitToLast || 0,
          snapChildren: null,
          snapValue: undefined,
        };
        subscriptions.add(sub);
        primeSubscription(sub);
        break;
      }
      case 'unsub':
        for (const sub of [...subscriptions]) {
          if (sub.ws === ws && sub.subId === m.subId) subscriptions.delete(sub);
        }
        break;
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
    ws._connectedAt = Date.now();
    ws._remote = req.socket.remoteAddress;
    clients.add(ws);
    stats.connections++;
    stats.lastActivity = Date.now();
    send(ws, { op: 'connected' });

    ws.on('message', (raw) => {
      let m;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (m && typeof m === 'object') handleMessage(ws, m);
    });

    ws.on('close', () => {
      runOnDisconnect(ws);
      for (const sub of [...subscriptions]) if (sub.ws === ws) subscriptions.delete(sub);
      clients.delete(ws);
    });
    ws.on('error', () => {});
  }

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
    for (const [k, t] of pendingPersist) {
      clearTimeout(t);
      try {
        await persistNow(k);
      } catch { /* بی‌خیال */ }
    }
    pendingPersist.clear();
  }

  function branches() {
    return Object.keys(ROOT).map((key) => {
      let bytes = 0;
      try {
        bytes = fs.statSync(fileForKey(key)).size;
      } catch { /* هنوز روی دیسک نیست */ }
      const node = ROOT[key];
      return {
        key,
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
    snapshot: () => ({
      ...stats,
      liveConnections: clients.size,
      subscriptions: subscriptions.size,
      branches: Object.keys(ROOT).length,
      clients: [...clients].map((ws) => ({ since: ws._connectedAt, remote: ws._remote })),
    }),
  };
}
