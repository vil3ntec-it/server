// ---------------------------------------------------------------------------
//  کدِ ورودِ فروشگاه — حالا روی موتورِ «کدهای شش‌رقمی»
//
//  ⚠️ این فایل دیگر موتور نیست، یک مترجم است.
//
//  تا پیش از این، فروشگاه موتورِ کدِ خودش را داشت (جدولِ th_otp) و برنامه‌ها
//  یکی دیگر را. دو موتور برای یک کار یعنی دو جا برای خراب شدن، دو جای
//  تنظیم، و کدی که در هیچ‌کدام از صفحه‌های پنل دیده نمی‌شد. حالا هر دو به
//  server/src/codes/ می‌روند: یک موتور، یک صف، و یک فهرست که همه‌چیز در آن
//  دیده می‌شود.
//
//  ⚠️ پیامک برداشته شد. خواستهٔ صاحبِ سرور این بود که کدها فقط ایمیلی باشند.
//  درخواستِ شماره بی‌صدا رد نمی‌شود؛ خطایی برمی‌گردد که خودِ برنامه بتواند
//  به کاربر بگوید ایمیلش را بزند.
// ---------------------------------------------------------------------------
import { db } from '../db.js';
import { readTohidSettings } from './settings.js';
import { codeSettings } from '../codes/settings.js';
import { drainQueue } from '../codes/queue.js';
import { ensureApp, liveRequest } from '../codes/store.js';
import {
  issueCode,
  normalizeEmail,
  revealCode,
  verifyCode as verifyWithEngine,
} from '../codes/service.js';

/** شناسهٔ فروشگاه در دفترِ برنامه‌ها */
export const SHOP_APP = 'shop';

function shopApp() {
  // کلید لازم نیست: این مسیر از قبل ورودِ خودش را دارد و از بیرونِ پنل
  // با توکنِ خودِ فروشگاه محافظت می‌شود
  const row = ensureApp(SHOP_APP, { name: 'فروشگاه', kind: 'app' });
  return row;
}

const smsGone = () =>
  Object.assign(new Error('ورود با پیامک برداشته شد — ایمیلتان را وارد کنید'), { code: 'sms_removed' });

export function normalizeContact(method, value) {
  if (method !== 'email') throw smsGone();
  const email = normalizeEmail(value);
  if (!email) throw Object.assign(new Error('ایمیل درست نیست'), { code: 'bad_email' });
  return email;
}

/**
 * ساخت و فرستادنِ کد.
 *
 * `deliver = false` یعنی «فقط بساز، نفرست» — همان چیزی که صفحهٔ «فرستادنِ
 * دستی» لازم دارد: کد به مدیر برمی‌گردد تا خودش برای مشتری بفرستد.
 */
export async function sendCode({ method, value, name, deliver = true, force = false }) {
  if (method !== 'email') throw smsGone();

  const app = shopApp();
  const result = issueCode({
    app: app.slug,
    email: value,
    subjectId: name ? String(name).slice(0, 80) : null,
    purpose: 'login',
    force,
  });

  if (!result.ok) {
    throw Object.assign(new Error(result.message || 'کد فرستاده نشد'), {
      code: result.error,
      wait: result.retryAfter,
    });
  }

  const minutes = Math.max(1, Math.round((codeSettings().ttlSeconds || 120) / 60));

  if (!deliver) {
    /*
     *  کد باید برگردد، ولی نباید در صف بماند و خودش هم برود — وگرنه مشتری
     *  دو کد می‌گیرد و آن که مدیر خوانده، کارِ کدِ دوم را خراب می‌کند.
     */
    const row = liveRequest(app.slug, normalizeContact('email', value));
    markHandled(result.id);
    return { ok: true, code: revealCode(row), minutes, contact: row?.email || value };
  }

  // صف را هل می‌دهیم تا در بارِ کم منتظرِ تیکِ بعدی نماند
  drainQueue().catch(() => { /* خطا روی ردیفِ خودش ثبت می‌شود */ });
  return { ok: true };
}

/** ردیفی که خودِ مدیر دستی می‌فرستد، نباید صف هم بفرستدش */
function markHandled(id) {
  db.prepare("UPDATE code_requests SET send_state = 'sent', sent_at = ? WHERE id = ?").run(Date.now(), id);
}

/** بررسیِ کد. کدِ درست همان لحظه مصرف و باطل می‌شود. */
export function verifyCode({ method, value, code }) {
  if (method !== 'email') throw smsGone();

  const result = verifyWithEngine({ app: SHOP_APP, email: value, code });
  if (!result.ok) {
    throw Object.assign(new Error(result.message || 'کد درست نیست'), { code: result.error });
  }
  return { ok: true, contact: result.email, name: result.subjectId || null };
}

/** کدهای منقضی را موتورِ خودش جمع می‌کند — این‌جا فقط برای سازگاری مانده */
export function pruneCodes() {
  return 0;
}

/** تنظیماتِ فروشگاه هنوز مدتِ اعتبار را نشان می‌دهد */
export function otpTtlSeconds() {
  return readTohidSettings().otpTtlSeconds || codeSettings().ttlSeconds;
}
