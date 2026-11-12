// ---------------------------------------------------------------------------
//  «سرورهای من» — قالبِ پیامِ امضاشده (۱.۵۰.۹۴)
//
//  هر پیامِ گره ⇒ مرکز (و هر پاسخِ مرکز ⇒ گره) یک «پاکت» است:
//      { v: 1, purpose, node, ts, nonce, payload: "<JSON به‌صورتِ متن>", sig }
//  امضای Ed25519 روی همین بایت‌هاست:
//      vill3n-fleet-v1 \n purpose \n node \n ts \n nonce \n payload
//  ⛔ `payload` متن است، نه شیء: امضا روی همان بایت‌هایی است که رفته — هیچ «JSON ِ مرتب‌شده»ای لازم نیست که دو طرف
//     جورِ دیگری بسازندش. `purpose` در امضاست ⇒ پیامِ «تپش» جای «جدا شدن» یا پاسخِ مرکز نمی‌نشیند.
//  ⛔ این فایل هیچ چیزی از پنل import نمی‌کند (نه دیتابیس، نه تنظیم) — آزمون و ابزارِ خطِ فرمان هم همین را می‌خوانند.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';

export const PROTO = 'vill3n-fleet-v1';
//  ۱.۵۰.۹۵: ‎task‎ (گره کار می‌گیرد و نتیجه می‌دهد)، ‎chunk‎ (تکهٔ بسته ⇒ مرکز)، ‎chunk-get‎ (مرکز ⇒ تکه) — گامِ ۳
export const PURPOSES = Object.freeze(['join', 'heartbeat', 'leave', 'reply', 'task', 'chunk', 'chunk-get']);
export const MAX_PAYLOAD = 256 * 1024;
const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** کلیدِ تازه: عمومی = SPKI/DER به base64 (۴۴ بایت)، خصوصی = PEM ِ PKCS8 (فقط روی دیسکِ همان نصب) */
export function generateKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

/** کلیدِ عمومیِ base64 ⇒ KeyObject، یا null اگر Ed25519 ِ درست نیست */
export function parsePublicKey(b64) {
  if (typeof b64 !== 'string' || b64.length > 200) return null;
  try {
    const der = Buffer.from(b64, 'base64');
    if (der.length !== 44) return null;
    const k = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    return k.asymmetricKeyType === 'ed25519' ? k : null;
  } catch {
    return null;
  }
}

export function publicKeyOf(privateKeyPem) {
  return crypto.createPublicKey(crypto.createPrivateKey(privateKeyPem)).export({ type: 'spki', format: 'der' }).toString('base64');
}

export function newNonce() {
  return crypto.randomBytes(18).toString('base64url');
}

function messageBytes({ purpose, node, ts, nonce, payload }) {
  return Buffer.from([PROTO, purpose, node, String(ts), nonce, payload].join('\n'), 'utf8');
}

/** پاکتِ امضاشده. `payload` شیء است و همین‌جا یک بار به متن تبدیل می‌شود. */
export function signEnvelope({ purpose, node = '', payload = {}, privateKey, ts = Date.now(), nonce = newNonce() }) {
  const text = JSON.stringify(payload);
  const key = typeof privateKey === 'string' ? crypto.createPrivateKey(privateKey) : privateKey;
  const sig = crypto.sign(null, messageBytes({ purpose, node, ts, nonce, payload: text }), key).toString('base64url');
  return { v: 1, purpose, node, ts, nonce, payload: text, sig };
}

/**
 * شکلِ پاکت را می‌سنجد (نه امضا را). ‎{ ok: true, env }‎ یا ‎{ ok: false, error }‎.
 * ⛔ اندازه، نوع و شکلِ هر خانه پیش از هر کارِ دیگری — بدنهٔ ناشناس است.
 */
export function readEnvelope(raw, purpose) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'bad_envelope' };
  const { v, node, ts, nonce, payload, sig } = raw;
  if (v !== 1 || raw.purpose !== purpose) return { ok: false, error: 'bad_envelope' };
  if (typeof node !== 'string' || node.length > 64 || (purpose !== 'join' && !/^[A-Za-z0-9_-]{8,64}$/.test(node))) return { ok: false, error: 'bad_envelope' };
  if (!Number.isSafeInteger(ts) || ts <= 0) return { ok: false, error: 'bad_envelope' };
  if (typeof nonce !== 'string' || !NONCE_RE.test(nonce)) return { ok: false, error: 'bad_envelope' };
  if (typeof payload !== 'string' || payload.length > MAX_PAYLOAD) return { ok: false, error: 'bad_envelope' };
  if (typeof sig !== 'string' || sig.length > 200) return { ok: false, error: 'bad_envelope' };
  let body;
  try { body = JSON.parse(payload); } catch { return { ok: false, error: 'bad_envelope' }; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'bad_envelope' };
  return { ok: true, env: { purpose, node, ts, nonce, payload, sig, body } };
}

/** امضای پاکتِ خوانده‌شده با کلیدِ عمومی (KeyObject یا base64) */
export function verifyEnvelope(env, publicKey) {
  const key = typeof publicKey === 'string' ? parsePublicKey(publicKey) : publicKey;
  if (!key) return false;
  try {
    return crypto.verify(null, messageBytes(env), key, Buffer.from(env.sig, 'base64url'));
  } catch {
    return false;
  }
}

/* ───────────── کلیدِ بستهٔ هر کارِ جابه‌جایی: X25519 ⇒ HKDF ⇒ AES-256-GCM (۱.۵۰.۹۵) ─────────────
 *  ⛔ کلیدِ تصادفیِ هر کار هرگز بی‌رمز از سیم نمی‌گذرد (حتی روی http ِ شبکهٔ خانه): گره در هر درخواستِ «کار» یک کلیدِ
 *     عمومیِ X25519 ِ یک‌بارمصرف می‌فرستد (خصوصی‌اش فقط در حافظهٔ همان درخواست)، مرکز کلید را برای همان می‌پیچد.
 *     `info` (شناسهٔ کار و گره) در AAD است ⇒ پیچیدهٔ یک کار/گره جای دیگری باز نمی‌شود. هیچ‌جا ذخیره نمی‌شود.
 */
const WRAP_INFO = 'vill3n-fleet-wrap-v1';

export function ephemeralKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return { publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), privateKey };
}

function x25519Public(b64) {
  if (typeof b64 !== 'string' || b64.length > 200) return null;
  try {
    const k = crypto.createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
    return k.asymmetricKeyType === 'x25519' ? k : null;
  } catch { return null; }
}

const wrapKey = (shared, info) => Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.from(`${WRAP_INFO}|${info}`), 32));

/** `secret` (Buffer) برای کلیدِ عمومیِ X25519 ِ گره ⇒ ‎{ epk, iv, ct, tag }‎ (همه base64)؛ کلیدِ نادرست ⇒ null */
export function wrapSecret(secret, peerPublicKey, info) {
  const peer = x25519Public(peerPublicKey);
  if (!peer) return null;
  const eph = crypto.generateKeyPairSync('x25519');
  const k = wrapKey(crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: peer }), info);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  c.setAAD(Buffer.from(info));
  const ct = Buffer.concat([c.update(secret), c.final()]);
  k.fill(0);
  return { epk: eph.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64'), tag: c.getAuthTag().toString('base64') };
}

/** باز کردن با کلیدِ خصوصیِ یک‌بارمصرفِ همان درخواست ⇒ Buffer، یا null اگر دست خورده/مالِ دیگری است */
export function unwrapSecret(w, privateKey, info) {
  try {
    const epk = x25519Public(w?.epk);
    if (!epk) return null;
    const k = wrapKey(crypto.diffieHellman({ privateKey, publicKey: epk }), info);
    const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(w.iv, 'base64'));
    d.setAAD(Buffer.from(info));
    d.setAuthTag(Buffer.from(w.tag, 'base64'));
    const out = Buffer.concat([d.update(Buffer.from(w.ct, 'base64')), d.final()]);
    k.fill(0);
    return out;
  } catch { return null; }
}
