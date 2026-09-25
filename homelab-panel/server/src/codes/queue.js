// ---------------------------------------------------------------------------
//  صفِ ارسال
//
//      درخواست → کد ساخته و ثبت می‌شود (همان میلی‌ثانیه) → جواب برمی‌گردد
//                                    ↓
//                            این صف، پشتِ سر، ایمیل را می‌فرستد
//
//  چرا صف: اگر پانصد نفر با هم کد بخواهند و هر درخواست منتظرِ گفت‌وگوی SMTP
//  بماند، پانصد درخواست روی هم می‌مانند و سرورِ ایمیل هم در را می‌بندد. با
//  صف، سرعتِ جوابِ API به سرعتِ سرورِ ایمیل گره نمی‌خورد.
//
//  چند کارگرِ محدود (پیش‌فرض ۴) هم‌زمان می‌فرستند — نه یکی، که کند شود؛ نه
//  همه با هم، که سرورِ ایمیل خفه شود.
//
//  ⚠️ صف روی دیسک است نه در حافظه: اگر سرور وسطِ کار خاموش شود، هیچ کدی گم
//  نمی‌شود و بالا که آمد، همان‌جا ادامه می‌دهد.
// ---------------------------------------------------------------------------
import { logEvent } from '../db.js';
import { getApp } from './store.js';
import { codeSettings } from './settings.js';
import { mailReady, openCodeMailer, sendCodeEmail } from './mail.js';
import { autoResend, revealCode } from './service.js';
import {
  claimNext,
  deliveryOf,
  dueForAutoResend,
  markSendFailed,
  markSent,
  pruneRequests,
  queueDepth,
  requeueStuck,
} from './store.js';

/**
 * هر تلاشِ ناموفق کمی دیرتر از قبلی: ۵ ثانیه، ۱۵، ۴۵…
 *
 * ⚠️ نماد از tries-1 شروع می‌شود، وگرنه اولین تلاشِ دوباره ۱۵ ثانیه بعد
 * می‌افتاد — نه ۵ ثانیه‌ای که این بالا نوشته بود.
 */
const backoffMs = (tries) => Math.min(5 * 60_000, 5000 * 3 ** Math.max(0, tries - 1));

/**
 * قطعِ اتصال فرق دارد: سرور نگفته «یواش‌تر»، فقط در بسته شده.
 *
 * حالا که کلِ صف از یک اتصال می‌رود، قطع‌شدن یعنی یک اتفاقِ گذرا — پس
 * تقریباً همان لحظه دوباره امتحان می‌کنیم: ۱ ثانیه، ۳، ۹…
 */
const reconnectMs = (tries) => Math.min(30_000, 1000 * 3 ** Math.max(0, tries - 1));

const state = {
  running: false,
  workers: 0,
  timer: null,
  sweeper: null,
  /*
   *  ⚠️ نگهبانِ «یک دور در یک زمان».
   *
   *  drainQueue هم از تیکِ هر ۱٫۵ ثانیه صدا زده می‌شود و هم از هر
   *  درخواستِ تازه. بی این نگهبان، دورها روی هم می‌افتادند و هر دور
   *  کارگرهای خودش را می‌ساخت — یعنی برای چند ایمیل، ده‌ها اتصالِ
   *  هم‌زمان به سرورِ ایمیل. جیمیل از یک جایی به بعد در را می‌بندد و
   *  همان‌جا بود که بعضی کدها می‌رفتند و بعضی نه.
   */
  draining: false,
  /** برای آزمون: هر ارسالِ موفق این‌جا هم خبر می‌دهد */
  onSent: null,
};

/* ----------------------------- یک ارسال ---------------------------------- */

async function sendOne(row, settings, mailer = null) {
  const app = getApp(row.app);
  const code = revealCode(row);

  if (!code) {
    // کدِ بازنشدنی یعنی کلیدِ گاوصندوق عوض شده — تلاشِ دوباره کمکی نمی‌کند
    markSendFailed(row.id, 'کد باز نشد (کلیدِ گاوصندوق عوض شده؟)');
    return { ok: false, connectionLost: false };
  }

  try {
    const receipt = await sendCodeEmail({
      to: row.email,
      code,
      name: row.subject_name || '',
      app: row.app,
      appName: app?.name || row.app,
      subject: app?.subject || null,
      minutes: Math.max(1, Math.round((row.expires_at - row.created_at) / 60000)),
      settings,
      mailer,
    });
    markSent(row.id, Date.now(), receipt?.response || '');
    state.onSent?.(row);
    return { ok: true, connectionLost: false };
  } catch (e) {
    /*
     *  ⚠️ سه جور شکست داریم و هر کدام رفتارِ خودش را می‌خواهد:
     *
     *    • ۵xx  — «این گیرنده هیچ‌وقت» → تلاشِ دوباره بی‌فایده است
     *    • ۴xx  — «الان نه» → حتماً دوباره، با فاصله
     *    • قطعِ اتصال → دوباره، و اتصال هم باید نو شود
     *
     *  پیش از این هر سه یکی حساب می‌شدند: ایمیلِ اشتباه سه بار بی‌خود
     *  تکرار می‌شد و در عوض قطعِ اتصال — که با یک تلاشِ دیگر درست
     *  می‌شد — گاهی بی‌جواب می‌ماند.
     */
    const connectionLost = !e.smtpCode && e.code !== 'mail_not_configured';
    const permanent = e.smtpCode >= 500 && e.smtpCode < 600;
    const tries = (row.send_tries || 0) + 1;
    const canRetry = !permanent && tries <= settings.sendRetries && e.code !== 'mail_not_configured';

    const delay = connectionLost ? reconnectMs(tries) : backoffMs(tries);
    markSendFailed(row.id, e.message, { retryAt: canRetry ? Date.now() + delay : null });
    if (!canRetry) {
      logEvent('warn', 'panel', `کد به ${row.email} نرفت: ${String(e.message).slice(0, 200)}`);
    }
    return { ok: false, connectionLost };
  }
}

/* ------------------------------- یک دور ---------------------------------- */

/**
 * یک دور: صف را تا خالی‌شدن می‌فرستد — همه از یک اتصالِ SMTP.
 *
 * ⚠️ این تابع دو بار بازنویسی شد و دلیلش را این‌جا می‌گذارم تا کسی
 * دوباره به حالتِ اول برنگرداند:
 *
 * نسخهٔ اول چهار «کارگر» می‌ساخت که هم‌زمان می‌فرستادند، و هر کارگر برای
 * هر ایمیل یک اتصالِ تازه به سرورِ ایمیل باز می‌کرد. بدتر، خودِ این تابع
 * هم از دو جا صدا زده می‌شد (تیکِ هر ۱٫۵ ثانیه و هر درخواستِ تازه) بی
 * آن‌که کسی جلوی روی‌هم‌افتادنشان را بگیرد. برای پنج ایمیل، ده‌ها اتصالِ
 * هم‌زمان.
 *
 * جیمیل از یک جایی به بعد یا «421 Try again later» می‌دهد یا بی‌حرف در
 * را می‌بندد. نتیجه: چند کد می‌رفت، چند تا نه — با همان تنظیمات، همان
 * لحظه، بی‌آنکه چیزی عوض شده باشد.
 *
 * حالا: یک دور در یک زمان، یک اتصال، یکی‌یکی. کندتر است و درست کار
 * می‌کند. اگر روزی واقعاً به سرعت نیاز شد، راهش بالا بردنِ تعدادِ
 * ایمیل روی *همین یک اتصال* است، نه باز کردنِ اتصالِ بیشتر.
 *
 * صدا زدنش از بیرون امن است (آزمون‌ها همین کار را می‌کنند) — اگر سرورِ
 * ایمیل تنظیم نشده باشد، اصلاً شروع نمی‌کند تا ردیف‌ها بی‌خود «شکست‌خورده»
 * نشوند؛ کد در پنل هست و صاحبِ سرور می‌بیندش.
 */
export async function drainQueue(settings = codeSettings()) {
  if (!mailReady(settings)) return { skipped: 'mail_not_configured' };
  // دورِ قبلی هنوز تمام نشده — ردیفِ تازه را خودش برمی‌دارد
  if (state.draining) return { skipped: 'busy' };

  state.draining = true;
  state.workers = 1;
  let mailer = null;
  let sent = 0;
  let failed = 0;

  const dropMailer = () => {
    try { mailer?.close(); } catch { /* بسته شده */ }
    mailer = null;
  };

  try {
    for (;;) {
      const row = claimNext();
      if (!row) break;

      if (mailer && !mailer.usable) dropMailer();
      if (!mailer) {
        try {
          mailer = await openCodeMailer(settings);
        } catch (e) {
          /*
           *  در باز نشد. این مشکلِ *این ردیف* نیست، مشکلِ سرورِ ایمیل
           *  است — پس ردیف را دوباره در صف می‌گذاریم تا دورِ بعد برود،
           *  نه اینکه «شکست‌خورده» علامتش بزنیم.
           */
          markSendFailed(row.id, e.message, { retryAt: Date.now() + reconnectMs((row.send_tries || 0) + 1) });
          logEvent('warn', 'panel', `اتصال به سرورِ ایمیل نشد: ${String(e.message).slice(0, 200)}`);
          failed++;
          break;
        }
      }

      const result = await sendOne(row, settings, mailer);
      if (result.ok) sent++;
      else failed++;
      // اتصال مُرد؟ ردیفِ بعدی با اتصالِ نو
      if (result.connectionLost) dropMailer();
    }
  } finally {
    dropMailer();
    state.workers = 0;
    state.draining = false;
  }

  return { ok: true, sent, failed };
}

/* ------------------------ منتظرِ نتیجهٔ واقعی ------------------------------ */

/**
 * می‌ماند تا معلوم شود این ردیف واقعاً رفت یا نه.
 *
 * ⚠️ چرا لازم شد: پنل تا دیروز همان میلی‌ثانیه‌ای که *کد* ساخته می‌شد
 * می‌گفت «فرستاده شد»، چون پاسخِ API پیش از خودِ ارسال برمی‌گشت. اگر سرورِ
 * ایمیل بعداً نه می‌گفت — ایمیلِ اشتباه، سقفِ روزانه، در بسته — آن پیامِ
 * سبز همان‌جا روی صفحه می‌ماند و کسی خبردار نمی‌شد.
 *
 * این فقط برای دکمه‌ای است که خودِ صاحبِ سرور می‌زند و منتظر می‌ماند.
 * مسیرِ برنامه‌ها همچنان بی‌معطلی جواب می‌گیرد، چون آن‌جا صدها نفرند.
 *
 * @returns {{state:'sent'|'failed'|'pending'|'unknown', error?:string|null, response?:string|null}}
 */
export async function awaitDelivery(id, { timeoutMs = 15_000, stepMs = 120 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = deliveryOf(id);
    if (!row) return { state: 'unknown', error: null, response: null };
    if (row.state === 'sent' || row.state === 'failed') return row;
    // هنوز در صف یا وسطِ گفت‌وگو با سرورِ ایمیل
    if (Date.now() >= deadline) return { ...row, state: 'pending' };
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

/* --------------------- ارسالِ خودکارِ کدِ تازه ----------------------------- */

/**
 * کدی که نگرفته‌اند: پس از مدتِ تعیین‌شده، کدِ تازه ساخته و در صف گذاشته
 * می‌شود — بدونِ اینکه کاربر چیزی بزند و بدونِ اینکه کسی از ما بخواهد.
 */
export function sweepAutoResend(settings = codeSettings()) {
  if (!settings.autoResendSeconds || !settings.autoResendMax) return { made: 0 };
  const due = dueForAutoResend({
    afterMs: settings.autoResendSeconds * 1000,
    maxChain: settings.autoResendMax,
  });
  let made = 0;
  for (const row of due) {
    if (autoResend(row, settings).ok) made++;
  }
  return { made };
}

/* ------------------------------ چرخاندن ---------------------------------- */

/**
 * صف را روشن می‌کند: هر چند ثانیه یک دور می‌زند، کدهای جامانده را دوباره
 * می‌فرستد و ردیف‌های کهنه را جمع می‌کند.
 */
export function startQueue({ tickMs = 1500, sweepMs = 10_000 } = {}) {
  if (state.running) return;
  state.running = true;

  // سرور که خاموش شده بود، ردیف‌های «در حالِ ارسال» نیمه‌کاره مانده‌اند
  const stuck = requeueStuck();
  if (stuck) logEvent('info', 'panel', `${stuck} کد که وسطِ ارسال مانده بود، دوباره در صف رفت`);

  state.timer = setInterval(() => {
    drainQueue().catch(() => { /* هر خطا روی ردیفِ خودش ثبت شده */ });
  }, tickMs);
  state.timer.unref?.();

  state.sweeper = setInterval(() => {
    const settings = codeSettings();
    try {
      sweepAutoResend(settings);
      pruneRequests({ keepMs: settings.keepMinutes * 60_000 });
    } catch { /* دورِ بعد */ }
  }, sweepMs);
  state.sweeper.unref?.();
}

export function stopQueue() {
  if (state.timer) clearInterval(state.timer);
  if (state.sweeper) clearInterval(state.sweeper);
  state.timer = null;
  state.sweeper = null;
  state.running = false;
}

/** وضعیتِ صف برای صفحهٔ پنل */
export function queueStatus() {
  const settings = codeSettings();
  return {
    running: state.running,
    busyWorkers: state.workers,
    workers: settings.workers,
    mailReady: mailReady(settings),
    ...queueDepth(),
  };
}

/** فقط برای آزمون‌ها */
export function onSent(handler) {
  state.onSent = handler;
}
