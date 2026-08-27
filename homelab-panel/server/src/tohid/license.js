// ---------------------------------------------------------------------------
//  صدورِ License برای یک دستگاه
//
//  برنامه بدونِ امضای معتبر هیچ چیزی را قبول نمی‌کند، و محتوا را هم می‌سنجد:
//  فرستنده، مخاطب و شناسهٔ دستگاه باید بخوانند. اینجا همان چیزی ساخته می‌شود
//  که آن‌طرف انتظار دارد.
// ---------------------------------------------------------------------------
import { db } from '../db.js';
import { signLicense, ISSUER, AUDIENCE } from './keys.js';
import { entitlementFor, activeSubscription, CORE } from './subscriptions.js';
import { touchDevice, listDevices } from './accounts.js';

const DAY = 24 * 60 * 60 * 1000;
/** وقتی اشتراکی نیست، License کوتاه‌مدتِ رایگان صادر می‌شود تا برنامه بداند
 *  سرور زنده است و فقط قابلیت‌های پولی بسته‌اند — نه اینکه «سرور نیست». */
const FREE_LICENSE_MS = 7 * DAY;

export class LicenseError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/**
 * ثبتِ دستگاه و ساختِ License.
 * @param account ردیفِ حساب
 * @param device  { uid, name, platform, fingerprint }
 */
export function issueLicense(account, device, { requireSubscription = false } = {}) {
  if (account.disabled) throw new LicenseError('این حساب غیرفعال شده است', 'account_disabled');

  const known = db.prepare('SELECT * FROM th_devices WHERE account_id = ? AND uid = ?')
    .get(account.account_id, device?.uid || '');
  if (known?.revoked) throw new LicenseError('این دستگاه لغو شده است', 'device_revoked');

  const sub = activeSubscription(account.account_id);

  // سقفِ دستگاه فقط وقتی اشتراک هست معنی دارد
  if (sub && !known) {
    const active = listDevices(account.account_id).filter((d) => !d.revoked).length;
    if (active >= (sub.max_devices || 1)) {
      throw new LicenseError(
        `اشتراک شما برای ${sub.max_devices} دستگاه است. یکی از دستگاه‌ها را از پنل حذف کنید.`,
        'device_limit',
      );
    }
  }

  if (requireSubscription && !sub) {
    throw new LicenseError('اشتراک فعالی روی این حساب نیست', 'no_subscription');
  }

  const row = touchDevice(account.account_id, device);
  const ent = entitlementFor(account.account_id);
  const now = Date.now();

  const subEnds = sub ? sub.ends_at : now + FREE_LICENSE_MS;
  const exp = sub
    ? sub.ends_at + (sub.grace_days || 0) * DAY
    : now + FREE_LICENSE_MS;

  const license = signLicense({
    iss: ISSUER,
    aud: AUDIENCE,
    duid: row.uid,
    sub: account.account_id,
    iat: now,
    nbf: now - 60_000,          // کمی عقب‌تر، تا اختلافِ ساعت کار را خراب نکند
    exp,
    sub_ends: subEnds,
    feat: ent.features.slice(),
    core: CORE.slice(),
    plan: ent.plan || null,
    plan_title: ent.planTitle || null,
  });

  return {
    license,
    serverTime: now,
    entitlement: ent,
    device: { uid: row.uid, name: row.name },
  };
}
