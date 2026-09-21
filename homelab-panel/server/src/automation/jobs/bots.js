// ---------------------------------------------------------------------------
//  ══ چهار ربات — گامِ ۵ سندِ ریمیک ═══════════════════════════════════════
//
//      pump-watch    هر ۱۵ دقیقه   حساب‌های پمپ
//      shop-watch    هر ۱۵ دقیقه   حساب‌های فروشگاه — همان کد، نه رونوشت
//      login-watch   هر ۵ دقیقه    رباتِ ایمیل، کدهای نرفته، ورودها
//      code-rescue   رویدادی       کدی که نرفت
//
//  ⛔ **هیچ‌کدام `setInterval` ندارند** — موتورِ اتوماسیون تنها زمان‌بندِ
//  داخلیِ این پنل است (قاعدهٔ ۱۴۰۵/۰۷/۰۲). این فایل عمداً **نازک** است:
//  همهٔ منطق در `src/automation/bots/` است، و این‌جا فقط زمان و عنوان.
//
//  ⚠️ **عددهای زمان‌بندی حدسی نیستند:**
//   · **۱۵ دقیقه** برای ربات‌های حساب — «روزِ مانده» و «بک‌آپِ شش‌ساعته» در
//     دقیقه عوض نمی‌شوند، و سقفِ ورودِ سرورِ حساب **ده در ربع ساعت** است.
//     هر دقیقه پرسیدن یعنی همان ۴۲۹ی که ۱.۴۷.۴ بستش.
//   · **۵ دقیقه** برای رباتِ بالادست — یک رباتِ ایمیلِ خراب ورودِ **همهٔ**
//     برنامه‌ها را می‌بندد، پس دیر فهمیدنش گران‌ترین خرابیِ سامانه است.
//     و این ربات فقط دو خواندن دارد، نه یکی به‌ازای هر حساب.
//   · **رویدادی** برای نجاتِ کد — پرسیدنِ دوره‌ای همان نبضِ کوری است که
//     گامِ ۱ برداشت.
//
//  ⚠️ و هر چهارتا وقتی درگاهِ سرورِ حساب خاموش است **رد می‌شوند**، نه
//  این‌که خطا بدهند: `HLP_ACCOUNT_API` خالی یعنی این پنل اصلاً سرورِ
//  حسابی ندارد و ربات کاری برای انجام دادن ندارد.
// ---------------------------------------------------------------------------
import { defineJob } from '../engine.js';
import { config } from '../../config.js';
import { runWatch } from '../bots/watch.js';
import { runUpstream } from '../bots/upstream.js';
import { rescueBatch } from '../bots/rescue.js';

/** بی سرورِ حساب، ربات‌ها کاری ندارند — و این «خطا» نیست. */
const noAccountServer = () => !config.accountApi?.enabled;

const watchJob = (app, title) => defineJob({
  name: `${app}-watch`,
  title,
  description: app === 'pump'
    ? 'هر ۱۵ دقیقه — پشتیبان، اشتراک، عکسِ زنده و کدِ هر پمپ'
    : 'هر ۱۵ دقیقه — اشتراک و حالِ هر فروشگاه',
  every: 15 * 60_000,
  timeout: 5 * 60_000,
  //  ⚠️ یک تلاش: دورِ بعد پانزده دقیقهٔ دیگر است و تلاشِ دوباره فقط
  //  سقفِ نرخ را پر می‌کند (درسِ ۱.۴۷.۴).
  attempts: 1,
  quiet: true,
  async run(ctx) {
    if (noAccountServer()) return { skipped: true, reason: 'سرورِ حساب روی این پنل تنظیم نشده' };
    return runWatch(app, ctx);
  },
  async onFail(ctx, err) {
    //  ⛔ سکوت نه: «نتوانستم بپرسم» با «همه‌چیز خوب است» یکی نیست
    await ctx.notify('warn', `${title} نتوانست حساب‌ها را بسنجد: ${err.message}`);
  },
});

export const pumpWatch = watchJob('pump', 'رباتِ پمپ‌بنزین‌ها');
export const shopWatch = watchJob('shop', 'رباتِ فروشگاه‌ها');

export const loginWatch = defineJob({
  name: 'login-watch',
  title: 'رباتِ ورود و ایمیل',
  description: 'هر ۵ دقیقه — رباتِ ایمیلِ سرورِ حساب، کدهای نرفته، و حالِ ورودِ هر دو برنامه',
  every: 5 * 60_000,
  timeout: 2 * 60_000,
  attempts: 1,
  quiet: true,
  async run(ctx) {
    if (noAccountServer()) return { skipped: true, reason: 'سرورِ حساب روی این پنل تنظیم نشده' };
    return runUpstream(ctx);
  },
  async onFail(ctx, err) {
    await ctx.notify('warn', `رباتِ ورود نتوانست بسنجد: ${err.message}`);
  },
});

export const codeRescue = defineJob({
  name: 'code-rescue',
  title: 'نجاتِ کدی که نرفت',
  description: 'رویدادی — کدهای نرفتهٔ هر دور، همان کد دوباره (حداکثر دو تلاش برای هر کد)',
  //  ⛔ رویدادی، نه دوره‌ای
  event: 'code.delivery_failed',
  timeout: 60_000,
  attempts: 1,
  quiet: true,
  async run(ctx) {
    if (noAccountServer()) return { skipped: true, reason: 'سرورِ حساب روی این پنل تنظیم نشده' };
    return rescueBatch(ctx.payload || {}, ctx);
  },
});

export default [pumpWatch, shopWatch, loginWatch, codeRescue];
