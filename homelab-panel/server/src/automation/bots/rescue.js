// ---------------------------------------------------------------------------
//  ══ `code-rescue` — کدی که نرفت ═════════════════════════════════════════
//
//  خواستهٔ صاحب سامانه: «کدِ شش‌رقمی‌اش آمد یا نه، اگر نیامد خودش از بخشِ
//  کدها بگیرد و بفرستد.»
//
//  ⛔ **رویدادی است، نه دوره‌ای** (`event: 'code.delivery_failed'`). کدی که
//  نرفت همان لحظه شناخته می‌شود؛ پرسیدنِ هر چند دقیقه همان نبضِ کوری است
//  که گامِ ۱ برداشت.
//
//  چهار قاعده، و هر کدام دلیلِ خودش را دارد:
//
//   ⛔ **کدِ تازه نمی‌سازد** — همان کد دوباره می‌رود. کدِ تازه یعنی کدی که
//     همین حالا دستِ مشتری است باطل می‌شود؛ ربات برای کمک کردن کارِ او را
//     خراب می‌کند.
//   ⛔ **حداکثر دو تلاش**، بعد هشدار به مدیر. حلقهٔ بی‌پایان جز پنهان کردنِ
//     مشکل کاری نمی‌کند.
//   ⛔ **اگر رباتِ ایمیل اصلاً تنظیم نیست، تلاش نمی‌کند** و می‌گوید چرا.
//     فرستادنِ دوباره به رباتِ `log` یعنی سه ردیفِ «فرستادم» و صفر ایمیل —
//     همان «کلکِ دروغ»ی که در این مخزن قدغن است.
//   ⛔ **از همان موتورِ کدِ موجود می‌رود** (`/api/admin/{logins,otp}/:id/resend`)،
//     نه یک راهِ دوم. و **سه دفترِ کد، سه در**: کدِ ورود از `logins` و کدِ
//     ثبت‌نام از `otp`. یکی کردنشان یعنی ۴۰۴ برای نیمی از ردیف‌ها.
//
//  ⛔ و **کدِ خودِ پنل از این در نمی‌رود**: آن صف و موتورِ خودش را دارد
//  (`src/codes/`). دو راه برای یک کار همان سردرگمی است.
// ---------------------------------------------------------------------------
import { cloudRaw } from '../../stations/cloud.js';
import { readNotes, writeNotes } from './watch.js';

/** ⛔ بیش از این تلاش نمی‌شود. */
export const MAX_TRIES = 2;

/** سه دفتر، سه در — `door` یک جا ساخته می‌شود. */
export function doorOf(source) {
  return source === 'account-otp' ? 'otp' : 'logins';
}

/**
 * یک دسته کدِ نرفته — یا یک کدِ تکی از اجرای دستی.
 *
 * ⛔ **دسته‌ای، چون قفلِ هر کار درست است و باید بماند.** با یک رویداد
 * به‌ازای هر کد، سه کدِ نرفتهٔ هم‌زمان یعنی اولی می‌دود و دو تای دیگر
 * `skipped: already_running` می‌گیرند — دو کد برای همیشه گم می‌شوند و
 * دفتر کاملاً سبز است. سنجه‌اش این را گرفت، نه بازبینیِ چشمی.
 */
export async function rescueBatch(payload, ctx) {
  //  ⚠️ اجرای دستی یک کدِ تکی می‌دهد؛ هر دو شکل پذیرفته می‌شوند
  const codes = Array.isArray(payload?.codes) ? payload.codes : (payload?.id ? [payload] : []);
  if (!codes.length) return { skipped: true, reason: 'کدی برای فرستادن نیامد' };
  const done = [];
  for (const one of codes) done.push(await rescueOne(one, ctx));
  return { count: codes.length, results: done };
}

export async function rescueOne(payload, ctx) {
  const id = String(payload?.id || '');
  if (!id) return { skipped: true, reason: 'شناسهٔ کد نیامد' };

  /*
   *  ⛔ **رباتِ ایمیلِ تنظیم‌نشده ⇒ اصلاً تلاش نمی‌شود.** خودِ سرورِ حساب
   *  هم برای این حالت ۴۰۹ می‌دهد، ولی ربات نباید به آن تکیه کند: سه
   *  ردیفِ «تلاش کردم» در دفتر، برای کاری که از اول شدنی نبود، فقط
   *  ریشه‌یابیِ فردا را سخت می‌کند.
   */
  if (payload?.logOnly) {
    ctx.log(`کدِ ${id} فقط در لاگ ماند — رباتِ ایمیل تنظیم نیست، پس تلاشی نشد`);
    await ctx.notify('error',
      'کد فرستاده نشد چون رباتِ ایمیلِ سرورِ حساب تنظیم نیست. '
      + 'تا SMTP نوشته نشود، فرستادنِ دوباره هم بی‌فایده است.');
    return { skipped: true, reason: 'mail_not_configured' };
  }

  //  ⚠️ شمارِ تلاش‌ها در همان دفترِ خبرها می‌نشیند — دفترِ تازه‌ای ساخته نشد
  const notes = readNotes();
  const key = `rescue-${id}`;
  const tries = Number(notes[key] || 0);
  if (tries >= MAX_TRIES) {
    ctx.log(`کدِ ${id}: ${tries} تلاش شده، بیشتر نه`);
    await ctx.notify('warn', `کدِ ${payload?.email || id} بعد از ${tries} تلاش هم نرفت — خودتان بفرستید`);
    return { skipped: true, reason: 'max_tries', tries };
  }

  const door = doorOf(payload?.source);
  try {
    const out = await cloudRaw('POST', `/api/admin/${door}/${id}/resend`);
    notes[key] = tries + 1;
    writeNotes(notes);
    ctx.log(`کدِ ${id} از درِ ${door} دوباره فرستاده شد (تلاشِ ${tries + 1})`);
    return { ok: true, door, tries: tries + 1, via: out?.via || '' };
  } catch (err) {
    notes[key] = tries + 1;
    writeNotes(notes);
    /*
     *  ⛔ **و «نرفت» بی‌صدا نمی‌ماند.** دکمه‌ای که بگوید «فرستادم» و هیچ
     *  ایمیلی نرود همان کلکِ دروغ است — و یک رباتِ ساکت بدتر از آن.
     */
    await ctx.notify('warn', `فرستادنِ دوبارهٔ کدِ ${payload?.email || id} نشد: ${err?.message || err?.code || 'خطا'}`);
    return { ok: false, door, tries: tries + 1, error: err?.code || 'error' };
  }
}
