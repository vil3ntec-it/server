// ---------------------------------------------------------------------------
//  «سرورهای من» — نقشِ «مرکز» (۱.۵۰.۹۴، گامِ ۲ ِ docs/MULTI-SERVER-fa.md)
//
//  هر نصب پیش‌فرض مرکزِ خودش است (تنها). گره‌ها **فقط بیرون‌رو** به مرکز وصل می‌شوند (HTTP POST ِ تپش هر ۳۰ ثانیه)؛
//  مرکز هرگز به گره وصل نمی‌شود ⇒ سرورِ خانه پشتِ NAT بی بازکردنِ پورت گره می‌شود.
//
//  ⛔ کدِ وصل: ۱۲ نویسهٔ کراکفورد (۶۰ بیت)، ۱۰ دقیقه، یک‌بارمصرف، فقط HMAC ِ نمک‌دار در `fleet_join_codes`؛ خودِ کد فقط
//     یک بار در پاسخِ «افزودنِ سرور» به مالک برمی‌گردد. ۱۰ حدسِ نادرست (همه با هم) ⇒ همهٔ کدهای باز می‌سوزند.
//  ⛔ هر پیام: امضای Ed25519 با کلیدی که گره هنگامِ وصل ثبت کرد، ‎ts‎ در ‎±۵‎ دقیقه، nonce ِ تکراری رد (نگه‌داری ≥ ۱۰
//     دقیقه). پاسخِ تپش را مرکز با کلیدِ خودش امضا می‌کند ⇒ فرمانِ «نگه‌داری» از مسیرِ میانی جعل نمی‌شود.
//  ⛔ جدا کردن ردیف را پاک نمی‌کند (status=revoked) و کلید باطل است: تپشِ بعدی ‎403 node_revoked‎ (امضاشده).
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { db, logEvent } from '../db.js';
import { bumpSoon } from '../live/bus.js';
import { normalizeCode } from '../lib/setup-code.js';
import { signEnvelope, verifyEnvelope, readEnvelope, parsePublicKey } from './crypto.js';
import { centerKeys } from './keys.js';
import { buildReport, sanitizeReport, defaultName, NODE_KINDS } from './report.js';
import { maintenanceState } from './maintenance.js';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_MAX_FAILS = 10;
const MAX_ACTIVE_CODES = 5;
export const SKEW_MS = 5 * 60 * 1000;
//  ⛔ پیامی با ‎ts = T‎ تا ‎T+۵‎ دقیقه پذیرفته است و نخستین بار دستِ‌کم در ‎T−۵‎ دیده شده ⇒ ≥ ۱۰ دقیقه، با یک دقیقه حاشیه
export const NONCE_KEEP_MS = 2 * SKEW_MS + 60 * 1000;

const clampEnv = (name, def, min, max) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.max(min, Math.min(max, n)) : def;
};
/** عمرِ کدِ وصل — ۱۰ دقیقه؛ آزمون کوتاهش می‌کند (هرگز بلندتر) */
export const codeTtlMs = () => clampEnv('HLP_FLEET_CODE_TTL_MS', 10 * 60 * 1000, 1000, 10 * 60 * 1000);
/** بی تپش بیش از این ⇒ «آفلاین» — ۹۰ ثانیه؛ آزمون کوتاهش می‌کند */
export const offlineAfterMs = () => clampEnv('HLP_FLEET_OFFLINE_MS', 90 * 1000, 1000, 60 * 60 * 1000);

export class FleetError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message || code);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

const now = () => Date.now();
const randomId = () => crypto.randomBytes(16).toString('base64url');
const mac = (salt, normalized) => crypto.createHmac('sha256', Buffer.from(salt, 'base64')).update(normalized).digest('base64');

/** آیا همین نصب خودش گرهٔ مرکزِ دیگری است؟ */
export function isNode() {
  return Boolean(db.prepare("SELECT 1 FROM fleet_link WHERE status = 'active' LIMIT 1").get());
}

export function activeNodeCount() {
  return db.prepare("SELECT COUNT(*) AS n FROM fleet_nodes WHERE status = 'active'").get().n;
}

/* ─────────────────────────────── کدِ وصل ─────────────────────────────── */

let failsSinceIssue = 0;

function newCode() {
  let s = '';
  for (let i = 0; i < 12; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

/** کدِ تازه. خودِ کد فقط همین یک بار برمی‌گردد. */
export function issueJoinCode(by) {
  if (isNode()) throw new FleetError(409, 'is_node', 'این سرور خودش به مرکزِ دیگری وصل است؛ «افزودنِ سرور» فقط روی مرکز است.');
  const code = newCode();
  const salt = crypto.randomBytes(16).toString('base64');
  const t = now();
  const id = randomId();
  db.prepare('INSERT INTO fleet_join_codes(id, salt, mac, created_at, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, salt, mac(salt, normalizeCode(code)), t, t + codeTtlMs(), by ? String(by).slice(0, 80) : null);
  //  بیش از پنج کدِ باز با هم نه — کهنه‌ترها می‌سوزند
  const open = db.prepare('SELECT id FROM fleet_join_codes WHERE used_at IS NULL AND burned_at IS NULL AND expires_at > ? ORDER BY created_at DESC').all(t);
  for (const r of open.slice(MAX_ACTIVE_CODES)) db.prepare('UPDATE fleet_join_codes SET burned_at = ? WHERE id = ?').run(t, r.id);
  failsSinceIssue = 0;
  return { id, code, expiresAt: t + codeTtlMs(), ttlMs: codeTtlMs() };
}

export function openCodeCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM fleet_join_codes WHERE used_at IS NULL AND burned_at IS NULL AND expires_at > ?').get(now()).n;
}

/** ‎{ ok: true, id }‎ یا ‎{ ok: false, reason: missing|invalid|expired|used, burned? }‎ — مصرف نمی‌کند */
function matchCode(raw) {
  const given = normalizeCode(raw);
  if (!given) return { ok: false, reason: 'missing' };
  const t = now();
  //  ⛔ هر ردیفِ ۲۴ ساعتِ گذشته با timingSafeEqual (نمکِ هر ردیف جداست) — بی میان‌بُر روی ردیفِ نخست
  const rows = db.prepare('SELECT * FROM fleet_join_codes WHERE created_at > ? ORDER BY created_at DESC LIMIT 200').all(t - 24 * 3600 * 1000);
  let hit = null;
  for (const r of rows) {
    const a = Buffer.from(mac(r.salt, given), 'base64');
    const b = Buffer.from(r.mac, 'base64');
    if (a.length === b.length && crypto.timingSafeEqual(a, b) && !hit) hit = r;
  }
  if (!hit) {
    failsSinceIssue += 1;
    if (failsSinceIssue >= CODE_MAX_FAILS) {
      db.prepare('UPDATE fleet_join_codes SET burned_at = ? WHERE used_at IS NULL AND burned_at IS NULL').run(t);
      failsSinceIssue = 0;
      logEvent('warn', 'fleet', `${CODE_MAX_FAILS} کدِ وصلِ نادرست — همهٔ کدهای باز سوختند؛ کدِ تازه بسازید`);
      return { ok: false, reason: 'invalid', burned: true };
    }
    return { ok: false, reason: 'invalid' };
  }
  if (hit.used_at) return { ok: false, reason: 'used' };
  if (hit.burned_at || hit.expires_at <= t) return { ok: false, reason: 'expired' };
  return { ok: true, id: hit.id, by: hit.created_by || null };
}

const CODE_MESSAGES = {
  missing: 'کدِ وصل را بنویسید.',
  invalid: 'این کدِ وصل درست نیست. روی مرکز در «سرورهای من» ← «افزودنِ سرور» کدِ تازه بسازید.',
  expired: 'این کدِ وصل کهنه شده (بیش از ۱۰ دقیقه). روی مرکز کدِ تازه بسازید.',
  used: 'این کدِ وصل یک بار مصرف شده. روی مرکز کدِ تازه بسازید.',
};

/* ─────────────────────────────── پاسخِ امضاشده ─────────────────────────────── */

function reply(node, nonce, payload) {
  return signEnvelope({ purpose: 'reply', node, nonce, payload: { ...payload, node, nonce }, privateKey: centerKeys().privateKey });
}

const fresh = (ts) => Math.abs(now() - ts) <= SKEW_MS;

/* ─────────────────────────────── وصل شدن ─────────────────────────────── */

const cleanName = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) : '');

/**
 * پیامِ «وصل» ِ گره: امضا با همان کلیدی که می‌خواهد ثبت کند (اثباتِ داشتنِ کلیدِ خصوصی)، سپس کد.
 * ⛔ کد فقط پس از امضای درست سنجیده و **در همان تراکنشِ ثبتِ گره** مصرف می‌شود.
 */
export function joinNode(raw, { ip = null } = {}) {
  const r = readEnvelope(raw, 'join');
  if (!r.ok) throw new FleetError(400, r.error, 'پیامِ وصل بدشکل است.');
  const env = r.env;
  if (!fresh(env.ts)) throw new FleetError(401, 'stale_ts', 'ساعتِ این کامپیوتر با مرکز بیش از ۵ دقیقه فرق دارد.', { serverTime: now() });
  const key = parsePublicKey(env.body.publicKey);
  if (!key) throw new FleetError(400, 'bad_key', 'کلیدِ عمومیِ Ed25519 نیست.');
  if (!verifyEnvelope(env, key)) throw new FleetError(401, 'bad_signature', 'امضای پیام درست نیست.');
  if (isNode()) throw new FleetError(409, 'is_node', 'این سرور خودش گرهٔ مرکزِ دیگری است.');
  const c = matchCode(env.body.code);
  if (!c.ok) throw new FleetError(403, `code_${c.reason}`, CODE_MESSAGES[c.reason], c.burned ? { burned: true } : {});
  const id = randomId();
  const name = cleanName(env.body.name) || 'server';
  const kind = NODE_KINDS.includes(env.body.kind) ? env.body.kind : 'home';
  const t = now();
  db.exec('BEGIN IMMEDIATE');
  try {
    const used = db.prepare('UPDATE fleet_join_codes SET used_at = ?, used_node = ? WHERE id = ? AND used_at IS NULL AND burned_at IS NULL AND expires_at > ?').run(t, id, c.id, t);
    if (used.changes !== 1) throw new FleetError(403, 'code_used', CODE_MESSAGES.used);
    if (db.prepare('SELECT 1 FROM fleet_nodes WHERE public_key = ?').get(env.body.publicKey)) throw new FleetError(409, 'key_exists', 'این کلید از پیش ثبت است.');
    db.prepare(`INSERT INTO fleet_nodes(id, name, kind, public_key, status, joined_at, joined_by, join_ip, last_seen_at, last_ip, last_report)
                VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`)
      .run(id, name, kind, env.body.publicKey, t, c.by, ip, t, ip,
        JSON.stringify(sanitizeReport({ name, kind, version: env.body.version, apps: [], maintenance: {} })));
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* بسته */ }
    throw e;
  }
  logEvent('info', 'fleet', `سرورِ «${name}» به این مرکز وصل شد`);
  bumpSoon('fleet', 300);
  return { node: { id, name, kind }, reply: reply(id, env.nonce, { ok: true, centerKey: centerKeys().publicKey, centerName: defaultName(), joinedAt: t }) };
}

/* ─────────────────────────────── تپش و جدا شدن ─────────────────────────────── */

let lastPrune = 0;
function pruneNonces() {
  const t = now();
  if (t - lastPrune < 60 * 1000) return;
  lastPrune = t;
  //  ⛔ فقط nonce ِ بیرون از پنجرهٔ بازپخش — دادهٔ کسی نیست، فقط سپرِ بازپخش
  db.prepare('DELETE FROM fleet_nonces WHERE seen_at < ?').run(t - NONCE_KEEP_MS);
}

/**
 * سنجشِ مشترکِ پیامِ گره: پاکت ⇒ گرهٔ شناخته ⇒ امضا ⇒ (باطل؟) ⇒ ‎ts‎ ⇒ nonce.
 * @returns {{ env, node }} یا FleetError
 */
function authenticate(raw, purpose) {
  const r = readEnvelope(raw, purpose);
  if (!r.ok) throw new FleetError(400, r.error, 'پیامِ بدشکل.');
  const env = r.env;
  const node = db.prepare('SELECT * FROM fleet_nodes WHERE id = ?').get(env.node);
  if (!node) throw new FleetError(401, 'unknown_node', 'این سرور در فهرستِ مرکز نیست.');
  if (!verifyEnvelope(env, node.public_key)) throw new FleetError(401, 'bad_signature', 'امضای پیام درست نیست.');
  if (node.status !== 'active') {
    throw new FleetError(403, 'node_revoked', 'این سرور از مرکز جدا شده است.', { reply: reply(node.id, env.nonce, { ok: false, revoked: true }) });
  }
  if (!fresh(env.ts)) throw new FleetError(401, 'stale_ts', 'زمانِ پیام بیرون از ‎±۵‎ دقیقه است (ساعتِ کامپیوتر؟).', { serverTime: now() });
  pruneNonces();
  try {
    db.prepare('INSERT INTO fleet_nonces(node_id, nonce, seen_at) VALUES (?, ?, ?)').run(node.id, env.nonce, now());
  } catch {
    throw new FleetError(409, 'replay', 'این پیام پیشتر رسیده بود (بازپخش).');
  }
  return { env, node };
}

/** تپش: گزارش ثبت می‌شود و پاسخِ امضاشده حالتِ نگه‌داریِ خواسته‌شده را می‌گوید */
export function heartbeat(raw, { ip = null } = {}) {
  const { env, node } = authenticate(raw, 'heartbeat');
  const report = sanitizeReport(env.body.report);
  //  نام/گونه فقط اگر گزارش خودش آورده — نبودنش نام را «server» نمی‌کند
  const name = cleanName(env.body.report?.name) || node.name;
  const kind = NODE_KINDS.includes(env.body.report?.kind) ? env.body.report.kind : node.kind;
  const stored = { ...report, name, kind };
  db.prepare('UPDATE fleet_nodes SET last_seen_at = ?, last_ip = ?, last_report = ?, name = ?, kind = ? WHERE id = ?')
    .run(now(), ip, JSON.stringify(stored), name, kind, node.id);
  //  ⛔ «در سکوت، صفر پیام»: صفحه فقط وقتی بیدار می‌شود که چیزی جز درصدها عوض شد (برگشتن از آفلاین، روشن/خاموشِ
  //  برنامه‌ای، نگه‌داری، نام/نسخه). درصدها و «آفلاین شدن» با تورِ ایمنیِ ۳۰ ثانیه‌ایِ خودِ صفحه.
  let before = null;
  try { before = node.last_report ? JSON.parse(node.last_report) : null; } catch { before = null; }
  const wasOffline = !node.last_seen_at || now() - node.last_seen_at > offlineAfterMs();
  if (wasOffline || summaryOf(before) !== summaryOf(stored)) bumpSoon('fleet', 1000);
  return { reply: reply(node.id, env.nonce, { ok: true, maintenance: Boolean(node.maintenance) }) };
}

/** آن‌چه در صفحه جز درصدها دیده می‌شود */
function summaryOf(r) {
  if (!r) return '';
  return JSON.stringify([r.name, r.kind, r.version, r.tunnel?.running, r.maintenance?.active,
    (r.apps || []).map((a) => `${a.id}:${a.running ? 1 : 0}:${a.dataful ? 1 : 0}`)]);
}

/** گره خودش جدا می‌شود (امضاشده) ⇒ همان «جدا کردن» ِ مالک */
export function leave(raw) {
  const { env, node } = authenticate(raw, 'leave');
  db.prepare("UPDATE fleet_nodes SET status = 'revoked', revoked_at = ?, revoked_by = 'node' WHERE id = ?").run(now(), node.id);
  logEvent('info', 'fleet', `سرورِ «${node.name}» خودش از این مرکز جدا شد`);
  bumpSoon('fleet', 300);
  return { reply: reply(node.id, env.nonce, { ok: true, revoked: true }) };
}

/* ─────────────────────────────── کارهای مالکِ مرکز ─────────────────────────────── */

function getNode(id) {
  const n = db.prepare('SELECT * FROM fleet_nodes WHERE id = ?').get(String(id || ''));
  if (!n) throw new FleetError(404, 'node_not_found', 'این سرور در فهرست نیست.');
  return n;
}

export function setNodeMaintenance(id, on, by) {
  const n = getNode(id);
  if (n.status !== 'active') throw new FleetError(409, 'node_revoked', 'این سرور جدا شده است.');
  db.prepare('UPDATE fleet_nodes SET maintenance = ?, maintenance_at = ?, maintenance_by = ? WHERE id = ?')
    .run(on ? 1 : 0, now(), by ? String(by).slice(0, 80) : null, n.id);
  logEvent('info', 'fleet', `حالتِ نگه‌داریِ «${n.name}» ${on ? 'روشن' : 'خاموش'} شد — با تپشِ بعدی اعمال می‌شود`);
  bumpSoon('fleet', 300);
  return { id: n.id, name: n.name, maintenance: Boolean(on) };
}

export function revokeNode(id, by) {
  const n = getNode(id);
  if (n.status === 'revoked') return { id: n.id, name: n.name, already: true };
  db.prepare("UPDATE fleet_nodes SET status = 'revoked', revoked_at = ?, revoked_by = ? WHERE id = ?").run(now(), by ? String(by).slice(0, 80) : null, n.id);
  logEvent('warn', 'fleet', `سرورِ «${n.name}» از این مرکز جدا شد — کلیدش باطل است`);
  bumpSoon('fleet', 300);
  return { id: n.id, name: n.name };
}

function nodeView(n, t) {
  let report = null;
  try { report = n.last_report ? JSON.parse(n.last_report) : null; } catch { report = null; }
  const online = n.status === 'active' && Boolean(n.last_seen_at) && t - n.last_seen_at <= offlineAfterMs();
  return {
    id: n.id,
    self: false,
    name: n.name,
    kind: n.kind,
    status: n.status,
    online,
    lastSeenAt: n.last_seen_at || null,
    joinedAt: n.joined_at,
    revokedAt: n.revoked_at || null,
    maintenance: { wanted: Boolean(n.maintenance), at: n.maintenance_at || null, applied: Boolean(report?.maintenance?.active), pumpsKeepRunning: Boolean(report?.maintenance?.pumpsKeepRunning) },
    version: report?.version || null,
    metrics: report?.metrics || null,
    apps: report?.apps || [],
    tunnel: report?.tunnel || null,
  };
}

/** «یک نویسنده»: هر برنامهٔ داده‌دار که روی بیش از یک سرور روشن است ⇒ «دو دفتر» */
export function conflicts(entries) {
  const holders = new Map();
  for (const e of entries) {
    if (e.status && e.status !== 'active') continue;
    for (const a of e.apps || []) {
      if (!a.dataful || !a.running) continue;
      const k = a.id;
      if (!holders.has(k)) holders.set(k, { id: k, name: a.name, type: a.type, holders: [] });
      holders.get(k).holders.push({ id: e.id, name: e.name, online: e.online, self: Boolean(e.self) });
    }
  }
  return [...holders.values()].filter((h) => h.holders.length > 1);
}

/** فهرستِ کامل برای صفحهٔ «سرورهای من» */
export async function fleetOverview() {
  const t = now();
  const m = maintenanceState();
  const selfReport = await buildReport();
  const self = {
    id: 'self',
    self: true,
    name: selfReport.name,
    kind: selfReport.kind,
    status: 'active',
    online: true,
    lastSeenAt: t,
    joinedAt: null,
    maintenance: { wanted: m.active, at: m.since, applied: m.active, pumpsKeepRunning: selfReport.maintenance.pumpsKeepRunning },
    version: selfReport.version,
    metrics: selfReport.metrics,
    apps: selfReport.apps,
    tunnel: selfReport.tunnel,
  };
  const nodes = db.prepare("SELECT * FROM fleet_nodes ORDER BY status = 'active' DESC, joined_at ASC").all().map((n) => nodeView(n, t));
  return {
    self,
    nodes,
    conflicts: conflicts([self, ...nodes]),
    offlineAfterMs: offlineAfterMs(),
    codeTtlMs: codeTtlMs(),
    openCodes: openCodeCount(),
  };
}
