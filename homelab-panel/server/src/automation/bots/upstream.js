// ---------------------------------------------------------------------------
//  ══ `login-watch` — رباتی که «یک سر و گردن بالاتر» است ══════════════════
//
//  خواستهٔ صاحب سامانه: «یک رباتِ اختصاصی که از همه یک سر و گردن بالاتر
//  باشد و ورودهای هر دو برنامه را چک کند که ایمیل‌ها می‌روند یا نه.»
//
//  ⛔ **و چرا واقعاً بالاتر است**: بقیهٔ ربات‌ها حالِ **حساب‌ها** را
//  می‌سنجند؛ این یکی خودِ **راهِ رسیدن** را. یک پمپ می‌تواند اشتراک و
//  پشتیبانِ کاملاً سالم داشته باشد و باز هم هیچ‌کس نتواند وارد شود —
//  همان بن‌بستی که ۱۴۰۵/۰۷/۰۷ ثبت شد: رباتِ ایمیلِ تنظیم‌نشده، کدی که
//  ساخته می‌شود و به دستِ هیچ‌کس نمی‌رسد، و `register/start`ی که عمداً
//  همیشه ۲۰۰ است. هیچ‌کدام از آن چهار قاعده خراب نبودند و با هم یک تله
//  می‌ساختند.
//
//  ⛔ **دفترِ دوم ساخته نمی‌شود**: هر دو دفترِ کد از همان یک خوانندهٔ
//  موجود می‌آیند (`routes/codes.js` ⇒ `accountCodes` · `accountOtpCodes`).
//  خواندنِ مستقیمِ `cloudRaw` این‌جا یعنی نسخهٔ دومِ همان منطق، و روزی
//  یکی‌شان اصلاح می‌شود و دیگری نه.
// ---------------------------------------------------------------------------
import { cloudRaw } from '../../stations/cloud.js';
import { accountCodes, accountOtpCodes } from '../../routes/codes.js';
import { isDown, isRateLimited } from './watch.js';

/** پنجرهٔ سنجشِ «چند تا نرفت» — نیم ساعت. */
export const WINDOW_MS = 30 * 60_000;
/** از چه نسبتی به بالا هشدار است. */
export const FAIL_RATIO = 0.2;

/** ردیفِ نرفته: یا سرور گفت نشد، یا فقط در لاگ چاپ شد. */
export const isUndelivered = (r) => r.sendState === 'failed' || r.logOnly === true;

export async function runUpstream(ctx, now = Date.now()) {
  const out = { mail: null, codes: { total: 0, failed: 0, ratio: 0 }, unchecked: [] };

  /* ── ۱) رباتِ ایمیلِ سرورِ حساب اصلاً تنظیم است؟ ─────────────────────── */
  try {
    const mail = await cloudRaw('GET', '/api/admin/email');
    /*
     *  ⛔ **شکلِ واقعی `{ email: { provider } }` است، نه `{ provider }`.**
     *
     *  `admin-platform.js` در سرورِ حساب `res.json({ email: await
     *  mailer.masked() })` می‌دهد. این خط آن لایه را نمی‌دید، پس
     *  `provider` همیشه رشتهٔ خالی می‌شد و ربات **همیشه** می‌گفت «رباتِ
     *  ایمیل تنظیم نیست» — حتی وقتی SMTP کاملاً درست بود. یعنی هر پنج
     *  دقیقه یک هشدارِ **دروغِ** «بحرانی‌ترین یافتهٔ سامانه»، برای همیشه.
     *  و زیانش «یک خطِ اضافه» نیست: هشداری که همیشه هست، دیگر هشدار
     *  نیست — صاحبِ سامانه یاد می‌گیرد ردش کند، و روزی که واقعاً SMTP
     *  خراب شود همان خط را هم نمی‌بیند.
     *
     *  ⚠️ و `code-rescue` از این خبر تصمیم نمی‌گیرد؛ آن از `logOnly`ِ
     *  خودِ همان کد می‌فهمد. پس این باگ کارِ نجات را نمی‌خواباند —
     *  فقط دفترِ هشدارها را بی‌معنا می‌کند.
     *
     *  ⚠️ و ساختگیِ `test/bots.mjs` شکلِ صاف می‌داد، پس هیچ بندی این را
     *  نمی‌دید — همان درسِ دفترِ ورود، در همان روز و از همان جنس.
     *
     *  ⛔ هر سه شکل خوانده می‌شود تا سرورِ حسابِ کهنه یا صافِ فردا هم
     *  بی‌صدا نخوابد.
     */
    const provider = String(
      mail?.email?.provider || mail?.provider || mail?.settings?.provider || ''
    ).toLowerCase();
    out.mail = { provider, ready: provider !== '' && provider !== 'log' };
    if (!out.mail.ready) {
      /*
       *  ⛔ **این بحرانی‌ترین یافتهٔ کلِ سامانه است**: با رباتِ `log`، کد
       *  نه به ایمیل می‌رود، نه در پاسخ برمی‌گردد، نه حتی در لاگ نوشته
       *  می‌شود — و برنامه می‌گوید «کد فرستاده شد». ورودِ **هر سه
       *  برنامه** بن‌بستِ کامل است و هیچ‌جا نمی‌گوید چرا.
       */
      ctx.emit('bot.mail_not_configured', { provider });
      await ctx.notify('error',
        'رباتِ ایمیلِ سرورِ حساب تنظیم نیست — کدِ ورود به دستِ هیچ‌کس نمی‌رسد. '
        + 'SMTP را در «کدهای شش‌رقمی ← ربات و تنظیمات» بنویسید.');
    }
  } catch (err) {
    //  ⛔ سکوت نه: «نتوانستم بپرسم» با «تنظیم است» یکی نیست
    const why = isRateLimited(err) ? 'rate_limited' : (isDown(err) ? 'account_server_down' : (err?.code || 'error'));
    out.unchecked.push({ what: 'mail', why });
    await ctx.notify('warn', `رباتِ بالادست: حالِ رباتِ ایمیل خوانده نشد (${why})`);
    //  ⚠️ روی ۴۲۹ همین‌جا تمام؛ ادامه یعنی پر کردنِ همان سقف
    if (isRateLimited(err)) return { ...out, rateLimited: true };
  }

  /* ── ۲) کدهای نیم‌ساعتِ گذشته: چند تا نرفت؟ ─────────────────────────── */
  const rows = [];
  //  ⛔ هر دو دفتر، و با `allSettled` — افتادنِ یکی نباید دیگری را ببرد
  const both = await Promise.allSettled([accountCodes('', 200), accountOtpCodes('', 200)]);
  for (const [i, r] of both.entries()) {
    if (r.status === 'fulfilled') rows.push(...r.value);
    else out.unchecked.push({ what: i === 0 ? 'logins' : 'otp', why: r.reason?.code || 'error' });
  }

  const fresh = rows.filter((r) => Number(r.createdAt || 0) >= now - WINDOW_MS);
  const failed = fresh.filter(isUndelivered);
  out.codes = {
    total: fresh.length,
    failed: failed.length,
    ratio: fresh.length ? failed.length / fresh.length : 0,
    //  ⚠️ چرایش گفته می‌شود، نه فقط عدد: «۳ تا نرفت» خالی کسی را به کار نمی‌اندازد
    reasons: [...new Set(failed.map((r) => (r.logOnly ? 'فقط در لاگ ماند' : (r.sendError || 'دلیلِ ناگفته'))))].slice(0, 3),
  };

  if (fresh.length && out.codes.ratio > FAIL_RATIO) {
    ctx.emit('bot.codes_failing', out.codes);
    await ctx.notify('warn',
      `از ${fresh.length} کدِ نیم‌ساعتِ گذشته، ${failed.length} تا نرفت (${out.codes.reasons.join(' · ')})`);
  }

  /*  ── ۳) کدهای نرفته ⇒ **یک** رویداد ⇒ بندِ ۵.۵ (`code-rescue`) ────────
   *
   *  ⛔ رویدادی، نه دوره‌ای: کدی که نرفت همان لحظه شناخته می‌شود.
   *
   *  ⛔ **ولی یک رویداد برای همهٔ کدهای این دور، نه یکی برای هر کد** — و
   *  این با سنجه پیدا شد، نه با حدس: قفلِ هر کار (قاعدهٔ ۱۴۰۵/۰۷/۰۲،
   *  «یک کار هرگز هم‌زمان دو بار اجرا نمی‌شود») کاملاً درست است، ولی سه
   *  رویدادِ پشتِ سرِ هم یعنی اولی می‌دود و دو تای دیگر
   *  `skipped: already_running` می‌گیرند — یعنی **دو کد برای همیشه گم
   *  می‌شوند**، با دفترِ کاملاً سبز.
   *
   *  ⚠️ نه قفل ضعیف شد و نه صف‌سازیِ تازه‌ای ساخته شد: خودِ رویداد
   *  دسته‌ای شد. هر کد جزئیاتِ کاملش را دارد و در `automation_events`
   *  می‌نشیند، پس هیچ ردی هم گم نمی‌شود.
   */
  if (failed.length) {
    ctx.emit('code.delivery_failed', {
      count: failed.length,
      codes: failed.map((r) => ({
        id: r.id, source: r.source, app: r.app, email: r.emailMasked || r.email,
        logOnly: Boolean(r.logOnly), error: r.sendError || '',
      })),
    });
  }

  ctx.log(`ایمیل: ${out.mail?.ready ? 'تنظیم است' : 'تنظیم نیست'} · کدهای نیم‌ساعت: ${out.codes.total}، نرفته: ${out.codes.failed}`);
  return out;
}
