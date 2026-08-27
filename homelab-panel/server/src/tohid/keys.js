// ---------------------------------------------------------------------------
//  کلیدِ امضای اشتراک — ES256 (P-256)
//
//  برنامهٔ توحید هر License را با WebCrypto بررسی می‌کند و بدونِ امضای معتبر
//  هیچ چیزی را قبول نمی‌کند. پس قالبِ توکن دقیقاً همان چیزی است که برنامه
//  انتظار دارد:
//
//      base64url(header) . base64url(payload) . base64url(signature)
//      header  = { alg: 'ES256', typ: 'TLIC' }
//      امضا    = ECDSA/SHA-256 روی «header.payload» به شکلِ خامِ r||s
//
//  نکتهٔ ریز و مهم: Node به‌طور پیش‌فرض امضای ECDSA را DER می‌دهد، ولی
//  WebCrypto فقط r||s (۶۴ بایت) را می‌پذیرد. با dsaEncoding: 'ieee-p1363'
//  همان چیزی ساخته می‌شود که مرورگر می‌فهمد.
//
//  کلیدِ خصوصی داخلِ گاوصندوق می‌ماند و هیچ‌وقت از سرور بیرون نمی‌رود.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { getSetting, setSetting } from '../db.js';
import { putSecret, readSecret, listSecrets } from '../control/vault.js';

const SECRET_NAME = 'tohid_license_private_key';
const KEY_ID_SETTING = 'tohid_license_key_id';
const PUBLIC_SETTING = 'tohid_license_public_key';

export const ISSUER = 'tohid-license-server';
export const AUDIENCE = 'tohid-shop-app';

function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** کلیدِ امضا را می‌سازد یا همان قبلی را برمی‌گرداند */
export function ensureLicenseKey() {
  const existing = listSecrets({ scope: 'global' }).find((s) => s.name === SECRET_NAME);
  if (existing) {
    const pem = readSecret(existing.id);
    if (pem) {
      return {
        keyId: getSetting(KEY_ID_SETTING, null),
        publicKey: getSetting(PUBLIC_SETTING, null),
        privatePem: pem,
      };
    }
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  // برنامه کلید را به شکلِ SPKI با base64 معمولی می‌خواهد
  const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const keyId = `k_${crypto.randomBytes(6).toString('hex')}`;

  putSecret({
    name: SECRET_NAME,
    kind: 'other',
    scope: 'global',
    value: privatePem,
    note: 'کلید امضای اشتراک برنامهٔ توحید — هرگز نمایش داده نمی‌شود',
    actor: 'system',
  });
  setSetting(KEY_ID_SETTING, keyId);
  setSetting(PUBLIC_SETTING, spki);

  return { keyId, publicKey: spki, privatePem };
}

/** فقط کلید عمومی — همان چیزی که به برنامه داده می‌شود */
export function licensePublicKey() {
  const k = ensureLicenseKey();
  return { publicKey: k.publicKey, keyId: k.keyId };
}

/**
 * ساختِ License امضاشده.
 * @param payload بدنهٔ توکن — duid، nbf، exp، sub_ends، feat، core و…
 */
export function signLicense(payload) {
  const { privatePem } = ensureLicenseKey();
  const header = { alg: 'ES256', typ: 'TLIC' };
  const signingInput = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;

  const signature = crypto.sign('sha256', Buffer.from(signingInput, 'utf8'), {
    key: crypto.createPrivateKey(privatePem),
    dsaEncoding: 'ieee-p1363', // خام r||s — چیزی که WebCrypto می‌پذیرد
  });

  return `${signingInput}.${b64u(signature)}`;
}
