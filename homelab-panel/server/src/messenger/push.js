// ---------------------------------------------------------------------------
//  نوتیفیکیشن وقتی برنامه بسته است — Web Push با کلیدِ خودتان (VAPID)
//
//  هیچ فایربیس و هیچ حساب گوگلی لازم نیست: کلیدها همین‌جا یک‌بار ساخته و در
//  پوشهٔ دادهٔ سرور نگه داشته می‌شوند. مرورگر (یا PWAِ نصب‌شده) اشتراک می‌گیرد،
//  و سرور شما مستقیم به سرویسِ پوشِ همان مرورگر پیام می‌فرستد. Service Worker
//  بیدار می‌شود و نوتیفیکیشن را نشان می‌دهد — حتی وقتی برنامه بسته است.
//
//  محدودیت‌هایی که باید بدانید:
//    • اگر این کامپیوتر خاموش باشد، چیزی فرستاده نمی‌شود (پیام‌ها می‌مانند).
//    • روی آیفون فقط وقتی کار می‌کند که سایت «Add to Home Screen» شده باشد.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logEvent } from '../db.js';
import { removeDevice } from './store.js';

const KEY_FILE = path.join(config.dataDir, 'push-keys.json');

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** کلیدهای VAPID — بار اول ساخته و برای همیشه ذخیره می‌شوند */
function loadKeys() {
  try {
    const saved = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
    if (saved?.publicKey && saved?.privateKey) return saved;
  } catch { /* هنوز ساخته نشده */ }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const keys = {
    publicKey: b64url(publicKey.export({ type: 'spki', format: 'der' }).subarray(-65)),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    createdAt: Date.now(),
  };
  try {
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
    fs.writeFileSync(KEY_FILE, JSON.stringify(keys, null, 2), 'utf8');
    logEvent('info', 'panel', 'کلیدهای نوتیفیکیشن (VAPID) ساخته شد');
  } catch (e) {
    logEvent('error', 'panel', `کلید نوتیفیکیشن ذخیره نشد: ${e.message}`);
  }
  return keys;
}

let keys = null;
export function vapidPublicKey() {
  keys = keys || loadKeys();
  return keys.publicKey;
}

/** امضای JWT با ES256 — همان چیزی که سرویس‌های پوش می‌خواهند */
function signJwt(payload) {
  keys = keys || loadKeys();
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const der = crypto.sign('sha256', Buffer.from(data), {
    key: keys.privateKey,
    dsaEncoding: 'ieee-p1363', // امضای ۶۴ بایتیِ خام، نه DER
  });
  return `${data}.${b64url(der)}`;
}

/** رمزگذاری بدنه طبق aes128gcm (RFC 8291) */
function encrypt(payload, p256dhB64, authB64) {
  const clientPub = Buffer.from(p256dhB64, 'base64url');
  const authSecret = Buffer.from(authB64, 'base64url');

  const local = crypto.createECDH('prime256v1');
  local.generateKeys();
  const shared = local.computeSecret(clientPub);
  const localPub = local.getPublicKey();

  const salt = crypto.randomBytes(16);
  const hkdf = (ikm, saltBuf, info, len) => {
    const prk = crypto.createHmac('sha256', saltBuf).update(ikm).digest();
    return crypto.createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, len);
  };

  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    clientPub,
    localPub,
  ]);
  const ikm = hkdf(shared, authSecret, keyInfo, 32);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);

  const plaintext = Buffer.concat([Buffer.from(payload, 'utf8'), Buffer.from([0x02])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(localPub.length, 20);

  return Buffer.concat([header, localPub, body]);
}

/**
 * یک نوتیفیکیشن به یک دستگاه می‌فرستد.
 * @returns {Promise<{ok:boolean, status?:number, gone?:boolean}>}
 */
export async function sendPush(device, payload, { ttl = 86400 } = {}) {
  if (!device?.push_endpoint || !device.push_p256dh || !device.push_auth) {
    return { ok: false, status: 0 };
  }

  let origin;
  try {
    const u = new URL(device.push_endpoint);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    return { ok: false, status: 0 };
  }

  const jwt = signJwt({
    aud: origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: 'mailto:admin@localhost',
  });

  let bodyBuf;
  try {
    bodyBuf = encrypt(JSON.stringify(payload), device.push_p256dh, device.push_auth);
  } catch {
    return { ok: false, status: 0 };
  }

  try {
    const res = await fetch(device.push_endpoint, {
      method: 'POST',
      headers: {
        TTL: String(ttl),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        Authorization: `vapid t=${jwt}, k=${vapidPublicKey()}`,
      },
      body: bodyBuf,
      signal: AbortSignal.timeout(10000),
    });

    // ۴۰۴/۴۱۰ یعنی این اشتراک دیگر معتبر نیست — پاکش می‌کنیم
    if (res.status === 404 || res.status === 410) {
      removeDevice(device.push_endpoint);
      return { ok: false, status: res.status, gone: true };
    }
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}

/** به همهٔ دستگاه‌های چند نفر — بدون اینکه یک خرابی بقیه را متوقف کند */
export async function pushToDevices(devices, payload) {
  const results = await Promise.all((devices || []).map((d) => sendPush(d, payload).catch(() => ({ ok: false }))));
  return { sent: results.filter((r) => r.ok).length, total: results.length };
}
