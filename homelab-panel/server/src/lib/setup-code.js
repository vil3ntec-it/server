// ---------------------------------------------------------------------------
//  ══ کدِ یک‌بارِ ساختِ نخستین مدیر (۱.۵۰.۸۵) ══
//
//  یافته (تصمیمِ ۱.۵۰.۸۴): تا نخستین مدیر نیست، ‎POST /api/auth/setup‎ از **هر**
//  همتای شبکهٔ خانه پذیرفته می‌شد — برنامهٔ ویندوز پیش‌فرض روی ‎0.0.0.0‎ گوش می‌دهد،
//  `service-linux.sh` هم — پس هر که زودتر می‌رسید (گوشیِ مهمان، دستگاهِ آلوده) مالک
//  می‌شد و صاحبِ کامپیوتر بیرون می‌ماند.
//
//  ⛔ قاعده:
//    • از **همین کامپیوتر** (`isDirectLocal`: اتصالِ لوپ‌بک، بی سرآیندِ پراکسی، و
//      Host/Origin ِ لوپ‌بک) مثلِ امروز، بی کد — برنامهٔ ویندوز ‎http://127.0.0.1:پورت‎
//      را باز می‌کند، مرورگرِ همین کامپیوتر ‎localhost‎، تونلِ SSH هم همین است.
//      Host/Origin جلوی بازپیوندِ DNS و صفحهٔ بیگانه در مرورگرِ همین کامپیوتر را می‌گیرد.
//    • از هر جای دیگر فقط با **کدِ یک‌بار**: سرور در بالا آمدن (تا مدیری نیست) می‌سازدش،
//      ۱۲ نویسهٔ base32 ِ کراکفورد = ۶۰ بیتِ تصادفیِ رمزنگاری، و فقط **یک جا** نشانش
//      می‌دهد: کنسول/لاگِ خودِ سرور (همان که ترمینالِ برنامهٔ ویندوز، ‎journalctl‎ یا
//      ‎docker logs‎ نشان می‌دهد). نه در دفترِ رخداد، نه در `events`، نه در پایگاه و نه
//      روی دیسک — فقط HMAC ِ نمک‌دارش در حافظهٔ همین پروسه. با ساختِ مدیر (از هر راه)
//      باطل می‌شود؛ با هر بالا آمدنِ دوباره تازه.
//    • حدس سقف دارد: سقفِ هر IP ِ درِ setup (index.js) و جدا از آن سقفِ **همه با هم**
//      (`SETUP_CODE_MAX_FAILS`) — پس از آن کد می‌سوزد و کدِ تازه فقط در کنسول می‌آید
//      (دستگاه‌های پرشمارِ IPv6 هم بیش از این بخت ندارند)؛ مالک هرگز بیرون نمی‌ماند:
//      همین کامپیوتر همیشه بی کد، و کدِ تازه همان‌جا که نگاه می‌کند.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { viaProxy } from '../deploy.js';

/** نمادهای کراکفورد — بی ‎I L O U‎ تا خواندن از صفحه و نوشتن روی گوشی گیج نکند */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LENGTH = 12;
export const SETUP_CODE_MAX_FAILS = 10;

/** @type {{ salt: Buffer, mac: Buffer, fails: number, announce: Function } | null} */
let current = null;

function newCode() {
  let s = '';
  for (let i = 0; i < LENGTH; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

/** نوشتنِ آزاد ⇒ شکلِ یکتا: حروفِ کوچک، فاصله و خط‌تیره، رقمِ فارسی/عربی، ‎I/L ⇒ 1‎ و ‎O ⇒ 0‎ */
export function normalizeCode(raw) {
  return String(raw ?? '')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .toUpperCase()
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, 64);
}

const mac = (salt, normalized) => crypto.createHmac('sha256', salt).update(normalized).digest();

/** همان یک جایی که کد دیده می‌شود: کنسولِ خودِ سرور */
export function announceToConsole(code, why = 'boot') {
  const head = why === 'rotated'
    ? `  ⚠️  کدِ پیشینِ راه‌اندازی پس از ${SETUP_CODE_MAX_FAILS} حدسِ نادرست باطل شد — کدِ تازه:`
    : '  🔑 هنوز هیچ مدیری نیست.';
  console.log(head);
  console.log(`  🔑 کدِ یک‌بارِ راه‌اندازی (setup code): ${code}`);
  console.log('     فقط برای ساختِ نخستین مدیر از دستگاهِ دیگرِ شبکه (گوشی، کامپیوترِ دیگر) لازم است؛');
  console.log('     روی همین کامپیوتر (برنامهٔ ویندوز یا http://localhost) لازم نیست. با ساختِ مدیر باطل می‌شود.');
  console.log('');
}

/**
 * کدِ تازه — کدِ پیشین (اگر بود) همان لحظه باطل. فقط درهمِ نمک‌دار نگه داشته می‌شود؛
 * خودِ کد یک بار به اعلان‌گر داده و برگردانده می‌شود (برای آزمون).
 */
export function issueSetupCode({ announce = announceToConsole, why = 'boot' } = {}) {
  const code = newCode();
  const salt = crypto.randomBytes(16);
  current = { salt, mac: mac(salt, normalizeCode(code)), fails: 0, announce };
  announce(code, why);
  return code;
}

export function hasSetupCode() {
  return current !== null;
}

/** با ساختِ نخستین مدیر (از هر راه) — هیچ کدی دیگر معتبر نیست */
export function clearSetupCode() {
  const had = current !== null;
  current = null;
  if (had) console.log('  ✅ نخستین مدیر ساخته شد — کدِ راه‌اندازی باطل شد.');
}

/**
 * ‎{ ok: true }‎ یا ‎{ ok: false, reason: 'missing' | 'invalid' | 'none', rotated? }‎ — هرگز خودِ کد.
 * درست مصرفش نمی‌کند: مصرف با ساختِ مدیر است (`clearSetupCode`)، تا رمزِ کوتاه کد را نسوزاند.
 */
export function checkSetupCode(raw) {
  if (!current) return { ok: false, reason: 'none' };
  const given = normalizeCode(raw);
  if (!given) return { ok: false, reason: 'missing' };
  if (crypto.timingSafeEqual(mac(current.salt, given), current.mac)) return { ok: true };
  current.fails += 1;
  if (current.fails >= SETUP_CODE_MAX_FAILS) {
    issueSetupCode({ announce: current.announce, why: 'rotated' });
    return { ok: false, reason: 'invalid', rotated: true };
  }
  return { ok: false, reason: 'invalid' };
}

const LOOPBACK_PEER = /^(::1|::ffff:127\.\d+\.\d+\.\d+|127\.\d+\.\d+\.\d+)$/;

/**
 * نامِ میزبانِ لوپ‌بک: ‎localhost‎ (و ‎*.localhost‎ که مرورگر خودش به لوپ‌بک می‌برد)، ‎127.x‎، ‎::1‎.
 * ⚠️ نامِ خودِ کامپیوتر عمداً نه: آن را DNS ِ شبکه می‌گرداند، و صاحبِ همین کامپیوتر با آن نام
 * کد را از همان کنسولِ جلوی چشمش می‌خواند.
 */
function loopbackName(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h);
}

function hostOf(hostHeader) {
  try { return new URL(`http://${String(hostHeader)}`).hostname; } catch { return ''; }
}

/**
 * آیا این درخواست واقعاً از خودِ همین کامپیوتر است؟
 *   • اتصالِ لوپ‌بک (نه همتای شبکه)
 *   • بی سرآیندِ پراکسی — Caddy و تونلِ همین کامپیوتر هم از لوپ‌بک می‌رسند ولی برای
 *     دیگری‌اند (`viaProxy`)
 *   • Host ِ لوپ‌بک (بازپیوندِ DNS: صفحهٔ ‎evil.example‎ که به ‎127.0.0.1‎ برگردانده شود)
 *   • و اگر Origin هست، آن هم لوپ‌بک (صفحهٔ بیگانه در مرورگرِ همین کامپیوتر؛ ‎null‎ هم نه)
 */
export function isDirectLocal(req) {
  if (!LOOPBACK_PEER.test(String(req?.socket?.remoteAddress || ''))) return false;
  if (viaProxy(req)) return false;
  const h = req.headers || {};
  if (h.host != null && !loopbackName(hostOf(h.host))) return false;
  if (h.origin != null) {
    let o;
    try { o = new URL(String(h.origin)); } catch { return false; }
    if (!/^https?:$/.test(o.protocol) || !loopbackName(o.hostname)) return false;
  }
  return true;
}
