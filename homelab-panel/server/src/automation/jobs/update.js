// ---------------------------------------------------------------------------
//  به‌روزرسانیِ خودکارِ خودِ پنل — بی حضورِ صاحبِ سامانه
//
//  خواستهٔ صاحب سامانه (۱۴۰۵/۰۷/۱۵): «آپدیتی که میاد درجا دانلود کنه و برنامه
//  رو دوباره اجرا کنه، دیگه لازم نباشه من وایسم… حتی در نبودِ من.»
//
//  ⛔ کار فقط صدا می‌زند (`autoUpdateOnce` در update/github.js) — همان مسیرِ
//     دکمهٔ «نصب» با بکاپِ کد و داده؛ رونوشتِ منطق نیست.
//  ⛔ هر ساعت فقط **یک پرسش** از GitHub است؛ تا نسخهٔ تازه‌ای نباشد یک بایت هم
//     دانلود نمی‌شود. و سه دقیقه پس از بالا آمدنِ پنل (روشن شدنِ کامپیوتر)
//     یک بار، تا خاموشیِ شبانه به‌روزرسانی را یک ساعت عقب نیندازد.
//  ⛔ پس از نصب، پنل خودش بیرون می‌رود و برنامهٔ ویندوز همان لحظه کلِ برنامه را
//     دوباره باز می‌کند (desktop/app/main-impl.js ⇒ `autoRelaunch`).
// ---------------------------------------------------------------------------
import { defineJob } from '../engine.js';
import { autoUpdateOnce } from '../../update/github.js';
import { syncOnce as pumpMirrorOnce, mirrorEnabled } from '../../pumpupdates/mirror.js';
import { syncOnce as siteMirrorOnce, siteMirrorEnabled } from '../../siteupdates/mirror.js';
import { syncOnce as supportTelegramOnce } from '../../support/telegram.js';

export const panelUpdate = defineJob({
  name: 'panel-update',
  title: 'به‌روزرسانیِ خودکارِ پنل',
  description: 'هر ساعت (و سه دقیقه پس از روشن شدن) — نسخهٔ تازهٔ مرکز فرمان را می‌گیرد، با بکاپ نصب می‌کند و برنامه را دوباره باز می‌کند',
  every: 60 * 60_000,
  runOnStart: 3 * 60_000,
  timeout: 20 * 60_000,
  //  ⚠️ یک تلاش: دورِ بعد یک ساعت دیگر است، و بستهٔ ناموفق ۲۴ ساعت کنار می‌ماند.
  attempts: 1,
  quiet: true,
  async run(ctx) {
    const out = await autoUpdateOnce();
    if (out.skipped) return out;
    if (out.ok) await ctx.notify('info', `مرکز فرمان از ${out.from || '؟'} به ${out.to || '؟'} به‌روز شد — برنامه خودش دوباره باز می‌شود`);
    return { ok: out.ok, from: out.from, to: out.to, reason: out.reason || null };
  },
  async onFail(ctx, err) {
    await ctx.notify('warn', `مرکز فرمان خودکار به‌روز نشد: ${err.message}`);
  },
});

/*
 *  آینهٔ به‌روزرسانیِ برنامهٔ پمپ (۱۴۰۵/۰۷/۱۹): «درجا که توی گیت‌هاب آپدیت رو
 *  گذاشتم سرور ببینه و به برنامه بگه.»
 *
 *  ⛔ هر دو دقیقه **یک پرسش با ETag** — تا چیزی عوض نشده، گیت‌هاب ۳۰۴ می‌دهد
 *  و هیچ سهمی از سقفش نمی‌رود و هیچ بایتی دانلود نمی‌شود.
 *  ⛔ یک تلاش: دورِ بعد دو دقیقهٔ دیگر است؛ نسخهٔ سالمِ قبلی همیشه سرِ جایش.
 */
export const pumpUpdateMirror = defineJob({
  name: 'pump-update-mirror',
  title: 'آینهٔ به‌روزرسانیِ برنامهٔ پمپ',
  description: 'هر دو دقیقه از گیت‌هاب می‌پرسد؛ نسخهٔ تازهٔ برنامهٔ پمپ را می‌گیرد، با چک‌سام می‌سنجد و برای برنامه‌ها سرو می‌کند',
  every: 2 * 60_000,
  runOnStart: 30_000,
  timeout: 30 * 60_000,
  attempts: 1,
  quiet: true,
  async run(ctx) {
    if (!mirrorEnabled()) return { skipped: 'disabled' };
    const out = await pumpMirrorOnce({ log: (m) => ctx.log(m) });
    if (out.changed) {
      await ctx.notify('info', out.held
        ? `نسخهٔ ${out.version} برنامهٔ پمپ روی سرور آماده است — پخش خاموش است؛ در «به‌روزرسانی» آزمایشش کنید و «انتشار» را بزنید`
        : `نسخهٔ ${out.version} برنامهٔ پمپ روی سرور آماده شد — برنامه‌ها خودشان می‌گیرند`);
    }
    return out;
  },
});

/*
 *  آینهٔ به‌روزرسانیِ سایت‌ها (۱۴۰۵/۰۷/۱۹): «اپدیت رو از سرور بگیره … گیت هاب
 *  دیده نشه توی سایت.» سرور از گیت‌هاب می‌گیرد؛ سایت فقط از همین سرور.
 */
export const siteUpdateMirror = defineJob({
  name: 'site-update-mirror',
  title: 'آینهٔ به‌روزرسانیِ سایت‌ها',
  description: 'هر ده دقیقه نسخهٔ تازهٔ سایت‌ها (مثلِ vill3n.top) را از گیت‌هاب می‌گیرد، با sha256 می‌سنجد و فقط به سایت‌های همین کامپیوتر می‌دهد',
  every: 10 * 60_000,
  runOnStart: 45_000,
  timeout: 10 * 60_000,
  attempts: 1,
  quiet: true,
  async run(ctx) {
    if (!siteMirrorEnabled()) return { skipped: 'disabled' };
    const out = await siteMirrorOnce({ log: (m) => ctx.log(m) });
    for (const s of out.sites.filter((x) => x.changed)) {
      await ctx.notify('info', `نسخهٔ ${s.version} سایتِ ${s.id} روی سرور آماده شد — سایت خودش می‌گیرد`);
    }
    return out;
  },
});

/*
 *  پلِ تلگرامِ پشتیبانی (۱۴۰۵/۰۷/۲۰): پیامِ کاربرانِ پمپ و فروشگاه به تلگرامِ مالک،
 *  و Reply در تلگرام به خودِ کاربر. خاموش تا مالک در «پشتیبانی» روشنش کند.
 */
export const supportTelegram = defineJob({
  name: 'support-telegram',
  title: 'پلِ تلگرامِ پشتیبانی',
  description: 'هر ۲۰ ثانیه — پیامِ تازهٔ کاربرانِ پمپ و فروشگاه به تلگرامِ مالک، و جوابِ مالک (Reply) به خودِ کاربر',
  every: 20_000,
  runOnStart: 20_000,
  timeout: 60_000,
  attempts: 1,
  quiet: true,
  async run(ctx) {
    return supportTelegramOnce({ log: (m) => ctx.log(m) });
  },
});

export default [panelUpdate, pumpUpdateMirror, siteUpdateMirror, supportTelegram];
