// ---------------------------------------------------------------------------
//  موتورِ کدِ شش‌رقمی
//
//      برنامه‌ها  →  API  →  صف  →  همین موتور  →  دیتابیس  →  ایمیل
//
//  قانون‌هایی که این‌جا رعایت می‌شود:
//
//    • کدِ هر برنامه جداست. دو برنامه می‌توانند برای یک ایمیل دو کدِ متفاوت
//      داشته باشند و هیچ‌کدام کدِ آن یکی را قبول نمی‌کند.
//    • کد مالِ همان ایمیل است و بس — با ایمیلِ دیگری کار نمی‌کند.
//    • یک‌بارمصرف: همان لحظه‌ای که درست وارد شد، می‌سوزد.
//    • انقضا دارد (پیش‌فرض دو دقیقه) و بعدش به درد نمی‌خورد.
//    • کدِ تازه، کدِ قبلیِ همان ایمیل را باطل می‌کند — همیشه فقط یکی زنده است.
//    • ساختنِ کد هیچ‌وقت منتظرِ رفتنِ ایمیل نمی‌ماند؛ ارسال کارِ صف است.
//
//  ⚠️ چرا ساخت و ارسال از هم جدا شدند: اگر پانصد نفر با هم کد بخواهند و هر
//  درخواست منتظرِ گفت‌وگوی SMTP بماند، هم درخواست‌ها روی هم می‌مانند و هم
//  سرورِ ایمیل در را می‌بندد. حالا کد همان میلی‌ثانیه ساخته و ثبت می‌شود و
//  جواب برمی‌گردد؛ ایمیل پشتِ سر می‌رود.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { logEvent } from '../db.js';
import { jwtSecret } from '../auth.js';
import { sealValue, openValue } from '../control/vault.js';
import { codeSettings } from './settings.js';
import {
  cancelLive,
  bumpTries,
  getApp,
  insertRequest,
  lastRequest,
  liveRequest,
  markUsed,
  touchApp,
} from './store.js';

/* ------------------------------ ورودی‌ها --------------------------------- */

/** ارقامِ فارسی/عربی → انگلیسی. کاربر با کیبوردِ فارسی کد را می‌زند. */
export function latinDigits(value) {
  return String(value ?? '')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

export function normalizeEmail(value) {
  const raw = latinDigits(value).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw) || raw.length > 254) return null;
  return raw;
}

export function cleanPurpose(value) {
  const raw = String(value ?? 'login').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  return raw.slice(0, 40) || 'login';
}

/** نشان‌دادنِ ایمیل بدونِ لو دادنش — در پاسخِ API و لاگ */
export function maskEmail(email) {
  const [name = '', domain = ''] = String(email || '').split('@');
  const head = name.slice(0, 2);
  return `${head}${'•'.repeat(Math.max(2, name.length - 2))}@${domain}`;
}

/* -------------------------------- کد ------------------------------------- */

/**
 * کدِ تصادفی.
 *
 * از crypto.randomInt استفاده می‌شود نه Math.random و نه «بایت به پیمانهٔ ۱۰»:
 * اولی قابلِ پیش‌بینی است و دومی رقم‌ها را ناهموار می‌کند (۰ تا ۵ کمی بیشتر
 * از ۶ تا ۹ می‌آیند). این‌جا هر کدی به یک اندازه ممکن است.
 */
export function makeCode(length = 6) {
  const min = 10 ** (length - 1);
  const max = 10 ** length;
  return String(crypto.randomInt(min, max));
}

const hashCode = (code, app, email) =>
  crypto.createHmac('sha256', jwtSecret()).update(`${app}:${email}:${code}`).digest('hex');

/** خودِ کد، برای چشمِ صاحبِ سرور در پنل */
export const revealCode = (row) => (row?.code_seal ? openValue(row.code_seal) : null);

/* ------------------------------ ساختنِ کد -------------------------------- */

/**
 * کدِ تازه می‌سازد و در صف می‌گذارد.
 *
 * @returns {{ok:boolean, id?:number, error?:string, ...}}
 */
export function issueCode({
  app,
  email,
  subjectId = null,
  /*
   *  نامِ خودِ شخص — تا ایمیل «احمد عزیز» بگوید نه یک خوش‌آمدِ خشک.
   *
   *  ⚠️ اختیاری است و باید بماند: بیشترِ برنامه‌ها فقط ایمیل دارند. اگر
   *  اجباری می‌شد، همان‌ها از کار می‌افتادند.
   */
  subjectName = null,
  purpose = 'login',
  ip = '',
  settings = codeSettings(),
  force = false,
  parentId = null,
  resendChain = 0,
}) {
  const row = getApp(app);
  if (!row) return { ok: false, error: 'unknown_app', message: 'این برنامه ثبت نشده است' };
  if (!row.enabled) return { ok: false, error: 'app_disabled', message: 'این برنامه خاموش است' };

  const target = normalizeEmail(email);
  if (!target) return { ok: false, error: 'bad_email', message: 'ایمیل درست نیست' };

  const now = Date.now();

  /*
   *  فاصلهٔ اجباری فقط برای همین یک ایمیل است.
   *
   *  ⚠️ سقفِ ساعتی عمداً نداریم: خواسته این بود که اگر صدها یا هزاران نفر
   *  هم‌زمان کد خواستند، هیچ‌کس پشتِ در نماند. چیزی که می‌ماند همین فاصلهٔ
   *  کوتاه است، و آن هم فقط جلوی کوبیدنِ دکمه توسطِ یک نفر را می‌گیرد.
   */
  if (!force && settings.resendSeconds > 0) {
    const previous = lastRequest(row.slug, target);
    if (previous && now - previous.created_at < settings.resendSeconds * 1000) {
      const wait = Math.ceil((settings.resendSeconds * 1000 - (now - previous.created_at)) / 1000);
      return {
        ok: false,
        error: 'too_soon',
        retryAfter: wait,
        message: `${wait} ثانیه صبر کنید و دوباره بزنید`,
      };
    }
  }

  // فقط یک کدِ زنده برای هر ایمیل — وگرنه کاربر کدِ اولی را می‌خواند و
  // سرور کدِ دومی را انتظار دارد
  cancelLive(row.slug, target, now);

  const length = Math.min(8, Math.max(4, Number(settings.codeLength) || 6));
  const ttl = (Number(row.code_ttl) || Number(settings.ttlSeconds) || 120) * 1000;
  const code = makeCode(length);

  const id = insertRequest({
    app: row.slug,
    subjectId: subjectId ? String(subjectId).slice(0, 80) : null,
    subjectName: subjectName ? String(subjectName).trim().slice(0, 60) : null,
    purpose: cleanPurpose(purpose),
    email: target,
    codeHash: hashCode(code, row.slug, target),
    codeSeal: sealValue(code),
    createdAt: now,
    expiresAt: now + ttl,
    ip: String(ip || '').slice(0, 64),
    resendChain,
    parentId,
  });

  touchApp(row.slug);

  return {
    ok: true,
    id,
    app: row.slug,
    appName: row.name,
    email: maskEmail(target),
    purpose: cleanPurpose(purpose),
    codeLength: length,
    expiresIn: Math.round(ttl / 1000),
    resendIn: settings.resendSeconds,
    queued: true,
    message: `کد ${length} رقمی ساخته شد و در صفِ ارسال است`,
  };
}

/* ----------------------------- سنجیدنِ کد -------------------------------- */

/**
 * کد را می‌سنجد. درست که باشد، همان لحظه می‌سوزد.
 *
 * هر شکست دلیلِ خودش را می‌گوید، چون برنامهٔ آن‌طرف باید بتواند به کاربر
 * بگوید «منقضی شده» یا «غلط است» — این دو تا برای کاربر یکی نیستند.
 */
export function verifyCode({ app, email, code, settings = codeSettings() }) {
  const row = getApp(app);
  if (!row) return { ok: false, error: 'unknown_app', message: 'این برنامه ثبت نشده است' };

  const target = normalizeEmail(email);
  if (!target) return { ok: false, error: 'bad_email', message: 'ایمیل درست نیست' };

  const given = latinDigits(code).replace(/\D/g, '');
  if (!given) return { ok: false, error: 'code_required', message: 'کد را وارد کنید' };

  const record = liveRequest(row.slug, target);
  if (!record) return { ok: false, error: 'no_code', message: 'اول درخواستِ کد بدهید' };

  const now = Date.now();
  if (record.expires_at < now) {
    markUsed(record.id, now);
    return { ok: false, error: 'expired', message: 'کد منقضی شده — کدِ تازه بگیرید' };
  }
  if (record.tries >= settings.maxTries) {
    markUsed(record.id, now);
    return { ok: false, error: 'too_many_tries', message: 'تعدادِ تلاش زیاد شد — کدِ تازه بگیرید' };
  }

  // مقایسهٔ ثابت‌زمان: از روی مدتِ پاسخ نشود فهمید چند رقمِ اول درست بوده
  const expected = Buffer.from(record.code_hash, 'hex');
  const actual = Buffer.from(hashCode(given, row.slug, target), 'hex');
  const same = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (!same) {
    bumpTries(record.id);
    const left = Math.max(0, settings.maxTries - (record.tries + 1));
    return { ok: false, error: 'wrong_code', triesLeft: left, message: `کد درست نیست (${left} تلاشِ دیگر)` };
  }

  markUsed(record.id, now);
  touchApp(row.slug);
  return {
    ok: true,
    app: row.slug,
    email: target,
    subjectId: record.subject_id || null,
    purpose: record.purpose,
    message: 'کد درست است',
  };
}

/* ------------------------- ارسالِ خودکارِ کدِ تازه ------------------------- */

/**
 * «کدش را نگرفت» — کدِ تازه برای همان ایمیل، بدونِ اینکه کسی چیزی بزند.
 *
 * کدِ قبلی همین‌جا باطل می‌شود (issueCode خودش این کار را می‌کند)، پس کاربر
 * اگر هر دو ایمیل را گرفت، تازه‌ترین کد آن است که کار می‌کند — همان که
 * جلوی چشمش است.
 */
export function autoResend(previous, settings = codeSettings()) {
  const result = issueCode({
    app: previous.app,
    email: previous.email,
    subjectId: previous.subject_id,
    subjectName: previous.subject_name,
    purpose: previous.purpose,
    ip: previous.ip,
    settings,
    force: true, // فاصلهٔ اجباری مالِ درخواستِ کاربر است، نه تلاشِ خودِ سرور
    parentId: previous.id,
    resendChain: (previous.resend_chain || 0) + 1,
  });
  if (result.ok) {
    logEvent('info', 'panel', `کدِ تازه برای ${maskEmail(previous.email)} خودکار ساخته شد (${previous.app})`);
  }
  return result;
}
