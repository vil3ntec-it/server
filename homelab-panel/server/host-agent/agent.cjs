'use strict';
// ---------------------------------------------------------------------------
//  🛰️ نمایندهٔ هاست (۱.۵۱.۱) — گرهٔ «هاستِ اشتراکی» در «سرورهای من» ِ مرکز، بی پنلِ کامل
//
//  روی cPanel کنارِ سرورِ حساب اجرا می‌شود (‎start.cjs‎) و فقط دو کار می‌کند:
//    ۱) **وصل** — یک بار، با کدِ ۱۰ دقیقه‌ایِ «افزودنِ سرور» از متغیرِ ‎VILL3N_JOIN_CODE‎ (صفحهٔ «Setup Node.js App»):
//       کلیدِ Ed25519 ِ تازه، پیامِ «join» ِ امضاشده به ‎/api/fleet/hub/join‎، پاسخِ امضاشدهٔ مرکز با کلیدِ عمومیِ سنجاق‌شده
//       (‎center.json‎ ِ بسته) سنجیده می‌شود.
//    ۲) **تپش** — هر ۳۰ ثانیه پیامِ «heartbeat» ِ امضاشده (‎ts‎ و nonce؛ همان قالبِ ‎src/fleet/crypto.js‎) با گزارشِ کوچک:
//       نام، گونهٔ ‎host‎، نسخه، حافظه و «سرورِ حساب روشن است». پاسخِ مرکز امضاشده است؛ ‎node_revoked‎ ⇒ می‌ایستد.
//
//  ⛔ هیچ درِ ورودی نیست (نه ‎createServer‎، نه ‎listen‎) — فقط درخواستِ بیرون‌رو به مرکز. تنها درِ این برنامه همان سرورِ حساب است.
//  ⛔ کدِ وصل هرگز روی دیسک یا در لاگ نمی‌آید؛ فقط کلیدِ خصوصی (۶۰۰) و پیوند در ‎~/.vill3n-agent‎ (یا ‎VILL3N_AGENT_DIR‎).
//  ⛔ https اجباری مگر نشانیِ همین شبکه/کامپیوتر (همان قاعدهٔ ‎normalizeCenterUrl‎ ِ پنل).
//  ⚠️ قالبِ پاکت **کپیِ** ‎server/src/fleet/crypto.js‎ است (این فایل CommonJS و بی وابستگی است)؛ ‎test/host-agent.mjs‎ با مرکزِ
//     واقعی می‌سنجد که هر دو یکی‌اند.
// ---------------------------------------------------------------------------
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROTO = 'vill3n-fleet-v1';
const HEARTBEAT_MS = Math.max(1000, Number(process.env.VILL3N_AGENT_HEARTBEAT_MS) || 30_000);
const LOCAL_OR_LAN = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+)$/i;

const MESSAGES = {
  code_invalid: 'این کدِ وصل درست نیست — در پنل «سرورهای من» ⇐ «افزودنِ سرور» کدِ تازه بسازید.',
  code_expired: 'این کدِ وصل کهنه شده (بیش از ۱۰ دقیقه) — در پنل کدِ تازه بسازید و برنامه را دوباره راه بیندازید.',
  code_used: 'این کدِ وصل یک بار مصرف شده — در پنل کدِ تازه بسازید.',
  code_missing: 'کدِ وصل نیامده.',
  stale_ts: 'ساعتِ این هاست با مرکز بیش از ۵ دقیقه فرق دارد.',
};

function log(msg) { console.log(`[vill3n-agent] ${msg}`); }

/* ───────────────────────── پاکتِ امضاشده (همان ‎src/fleet/crypto.js‎) ───────────────────────── */

const messageBytes = ({ purpose, node, ts, nonce, payload }) => Buffer.from([PROTO, purpose, node, String(ts), nonce, payload].join('\n'), 'utf8');

function generateKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}
function parsePublicKey(b64) {
  if (typeof b64 !== 'string' || b64.length > 200) return null;
  try {
    const der = Buffer.from(b64, 'base64');
    if (der.length !== 44) return null;
    const k = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    return k.asymmetricKeyType === 'ed25519' ? k : null;
  } catch { return null; }
}
function signEnvelope({ purpose, node = '', payload = {}, privateKey }) {
  const text = JSON.stringify(payload);
  const ts = Date.now();
  const nonce = crypto.randomBytes(18).toString('base64url');
  const sig = crypto.sign(null, messageBytes({ purpose, node, ts, nonce, payload: text }), crypto.createPrivateKey(privateKey)).toString('base64url');
  return { v: 1, purpose, node, ts, nonce, payload: text, sig };
}
/** پاسخِ مرکز: شکل، امضا با کلیدِ سنجاق‌شده، همان گره و همان nonce ِ درخواست ⇒ بدنه؛ وگرنه null */
function readReply(raw, centerKey, nodeId, nonce) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1 || raw.purpose !== 'reply' || typeof raw.payload !== 'string' || typeof raw.sig !== 'string') return null;
  const key = parsePublicKey(centerKey);
  if (!key) return null;
  let ok = false;
  try { ok = crypto.verify(null, messageBytes(raw), key, Buffer.from(raw.sig, 'base64url')); } catch { ok = false; }
  if (!ok) return null;
  let body = null;
  try { body = JSON.parse(raw.payload); } catch { return null; }
  if (!body || body.nonce !== nonce || (nodeId && (raw.node !== nodeId || body.node !== nodeId))) return null;
  if (Math.abs(Date.now() - Number(raw.ts)) > 5 * 60 * 1000) return null;
  return body;
}

/* ───────────────────────── جا و پیکربندی ───────────────────────── */

function stateDir() {
  return path.resolve(process.env.VILL3N_AGENT_DIR || path.join(os.homedir(), '.vill3n-agent'));
}
function writeSecret(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* ویندوز */ }
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function centerConfig(agentDir) {
  const c = readJson(path.join(agentDir, 'center.json')) || {};
  const url = String(process.env.VILL3N_JOIN_CENTER || c.centerUrl || '').trim().replace(/\/+$/, '');
  return { url, pinnedKey: typeof c.centerKey === 'string' ? c.centerKey : null, version: c.agentVersion || null };
}
function checkCenterUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  if (u.protocol === 'http:' && !LOCAL_OR_LAN.test(u.hostname)) return null;
  return u.origin;
}

async function post(url, body, timeoutMs = 15_000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal });
    let json = null;
    try { json = await r.json(); } catch { json = null; }
    return { status: r.status, json };
  } finally { clearTimeout(t); }
}

/* ───────────────────────── گزارش ───────────────────────── */

function report(name, version, accountRunning) {
  const total = os.totalmem();
  const used = total - os.freemem();
  return {
    name, kind: 'host', agent: 'host', version: version || null, platform: process.platform,
    metrics: { cpu: null, cores: os.cpus().length || null, memory: { usage: total ? Math.round((used / total) * 1000) / 10 : null, total, used }, disk: { usage: null, total: null, used: null } },
    apps: [{ id: 'account-server', type: 'account', name: 'سرورِ حساب', dataful: true, running: Boolean(accountRunning()) }],
    tunnel: { running: false, status: null, mode: 'none', auto: false },
    maintenance: { active: false, source: null, since: null, pumpsKeepRunning: false },
    caps: [],
    at: Date.now(),
  };
}

/* ───────────────────────── وصل و تپش ───────────────────────── */

/**
 * یک بار وصل می‌شود (اگر هنوز نشده و کد آمده). ⇐ ‎{ ok, link?, error? }‎ — هرگز پرتاب نمی‌کند و کد را جایی نمی‌نویسد.
 */
async function join({ agentDir, dir = stateDir(), code = process.env.VILL3N_JOIN_CODE, name } = {}) {
  const linkFile = path.join(dir, 'link.json');
  const existing = readJson(linkFile);
  if (existing && existing.status === 'active') return { ok: true, link: existing, already: true };
  const cfg = centerConfig(agentDir);
  const origin = checkCenterUrl(cfg.url);
  if (!origin) return { ok: false, error: 'bad_center', message: 'نشانیِ مرکز نیست یا https نیست (center.json یا VILL3N_JOIN_CENTER).' };
  if (!String(code || '').trim()) return { ok: false, error: 'code_missing', message: 'کدِ وصل نیامده — VILL3N_JOIN_CODE را در «Setup Node.js App» بگذارید و برنامه را دوباره راه بیندازید.' };
  const keys = generateKeys();
  const nodeName = String(name || process.env.VILL3N_AGENT_NAME || os.hostname() || 'host').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80);
  const env = signEnvelope({ purpose: 'join', payload: { code: String(code), publicKey: keys.publicKey, name: nodeName, kind: 'host', agent: 'host', version: cfg.version }, privateKey: keys.privateKeyPem });
  let res;
  try { res = await post(`${origin}/api/fleet/hub/join`, env); } catch (e) {
    return { ok: false, error: 'center_unreachable', message: `مرکز جواب نداد (${e?.name === 'AbortError' ? 'زمان گذشت' : e?.cause?.code || e?.message || 'شبکه'}).` };
  }
  if (res.status !== 200) {
    const err = String(res.json?.error || `http_${res.status}`);
    return { ok: false, error: err, message: MESSAGES[err] || res.json?.message || `مرکز نپذیرفت (${res.status}).` };
  }
  //  پاسخ: کلیدِ مرکز همان کلیدِ سنجاق‌شدهٔ بسته باشد (اگر بسته داشت)
  const reply = res.json?.reply;
  let probe = null;
  try { probe = JSON.parse(reply?.payload || 'null'); } catch { probe = null; }
  const centerKey = probe?.centerKey;
  if (!parsePublicKey(centerKey) || (cfg.pinnedKey && centerKey !== cfg.pinnedKey)) return { ok: false, error: 'bad_reply', message: 'کلیدِ مرکز با بسته نمی‌خواند — وصل نشد.' };
  const body = readReply(reply, centerKey, reply?.node, env.nonce);
  if (!body || !/^[A-Za-z0-9_-]{8,64}$/.test(String(reply.node || ''))) return { ok: false, error: 'bad_reply', message: 'پاسخِ مرکز امضای درست نداشت — وصل نشد.' };
  writeSecret(path.join(dir, 'node.key'), keys.privateKeyPem);
  const link = { status: 'active', centerUrl: origin, nodeId: reply.node, centerKey, centerName: body.centerName || null, name: nodeName, joinedAt: Date.now() };
  writeSecret(linkFile, `${JSON.stringify(link, null, 2)}\n`);
  return { ok: true, link };
}

/** یک تپش. ⇐ ‎{ ok, revoked? }‎ */
async function beat({ dir = stateDir(), agentDir, accountRunning = () => true } = {}) {
  const link = readJson(path.join(dir, 'link.json'));
  if (!link || link.status !== 'active') return { ok: false, error: 'not_linked' };
  let key;
  try { key = fs.readFileSync(path.join(dir, 'node.key'), 'utf8'); } catch { return { ok: false, error: 'no_key' }; }
  const cfg = centerConfig(agentDir);
  const env = signEnvelope({ purpose: 'heartbeat', node: link.nodeId, payload: { report: report(link.name, cfg.version, accountRunning) }, privateKey: key });
  let res;
  try { res = await post(`${link.centerUrl}/api/fleet/hub/heartbeat`, env); } catch (e) { return { ok: false, error: 'center_unreachable' }; }
  const body = readReply(res.json?.reply, link.centerKey, link.nodeId, env.nonce);
  if (res.status === 403 && res.json?.error === 'node_revoked' && body?.revoked) {
    writeSecret(path.join(dir, 'link.json'), `${JSON.stringify({ ...link, status: 'revoked', endedAt: Date.now() }, null, 2)}\n`);
    return { ok: false, revoked: true };
  }
  if (res.status !== 200 || !body) return { ok: false, error: res.json?.error || `http_${res.status}` };
  return { ok: true, maintenance: body.maintenance === true };
}

/** وصل (اگر لازم است) و تپشِ دوره‌ای. هرگز پرتاب نمی‌کند — سرورِ حساب کارِ خودش را می‌کند حتی اگر مرکز در دسترس نباشد. */
async function start({ agentDir = __dirname, accountRunning = () => true } = {}) {
  const dir = stateDir();
  const j = await join({ agentDir, dir });
  if (!j.ok) {
    log(`❌ ${j.message}`);
    return { ok: false, error: j.error };
  }
  if (!j.already) log(`✅ به مرکزِ ${j.link.centerUrl}${j.link.centerName ? ` («${j.link.centerName}»)` : ''} وصل شد — VILL3N_JOIN_CODE را از «Setup Node.js App» پاک کنید؛ دیگر لازم نیست.`);
  let stopped = false;
  let warned = '';
  const loop = async () => {
    if (stopped) return;
    const r = await beat({ dir, agentDir, accountRunning }).catch(() => ({ ok: false, error: 'beat_failed' }));
    if (r.revoked) { log('⛔ مرکز این هاست را جدا کرده است — تپش ایستاد.'); stopped = true; return; }
    if (!r.ok && r.error !== warned) { warned = r.error; log(`⚠️ تپش نرسید (${r.error}) — دوباره امتحان می‌شود.`); }
    if (r.ok) warned = '';
    setTimeout(loop, HEARTBEAT_MS).unref?.();
  };
  setTimeout(loop, 50).unref?.();
  return { ok: true, link: j.link, stop: () => { stopped = true; } };
}

module.exports = { start, join, beat, stateDir, PROTO };
