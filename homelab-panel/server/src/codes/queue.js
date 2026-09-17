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
import { mailReady, sendCodeEmail } from './mail.js';
import { autoResend, revealCode } from './service.js';
import {
  claimNext,
  dueForAutoResend,
  markSendFailed,
  markSent,
  pruneRequests,
  queueDepth,
  requeueStuck,
} from './store.js';

/** هر تلاشِ ناموفق کمی دیرتر از قبلی: ۵ ثانیه، ۱۵، ۴۵… */
const backoffMs = (tries) => Math.min(5 * 60_000, 5000 * 3 ** tries);

const state = {
  running: false,
  workers: 0,
  timer: null,
  sweeper: null,
  /** برای آزمون: هر ارسالِ موفق این‌جا هم خبر می‌دهد */
  onSent: null,
};

/* ----------------------------- یک ارسال ---------------------------------- */

async function sendOne(row, settings) {
  const app = getApp(row.app);
  const code = revealCode(row);

  if (!code) {
    // کدِ بازنشدنی یعنی کلیدِ گاوصندوق عوض شده — تلاشِ دوباره کمکی نمی‌کند
    markSendFailed(row.id, 'کد باز نشد (کلیدِ گاوصندوق عوض شده؟)');
    return false;
  }

  try {
    await sendCodeEmail({
      to: row.email,
      code,
      appName: app?.name || row.app,
      subject: app?.subject || null,
      minutes: Math.max(1, Math.round((row.expires_at - row.created_at) / 60000)),
      settings,
    });
    markSent(row.id);
    state.onSent?.(row);
    return true;
  } catch (e) {
    const tries = (row.send_tries || 0) + 1;
    const canRetry = tries <= settings.sendRetries && e.code !== 'mail_not_configured';
    markSendFailed(row.id, e.message, { retryAt: canRetry ? Date.now() + backoffMs(tries) : null });
    if (!canRetry) {
      logEvent('warn', 'panel', `کد به ${row.email} نرفت: ${String(e.message).slice(0, 200)}`);
    }
    return false;
  }
}

/* ------------------------------ کارگرها ---------------------------------- */

async function worker(settings) {
  state.workers++;
  try {
    for (;;) {
      const row = claimNext();
      if (!row) return;
      await sendOne(row, settings);
    }
  } finally {
    state.workers--;
  }
}

/**
 * یک دور: تا سقفِ کارگرها هم‌زمان می‌فرستد و تا خالی‌شدنِ صف ادامه می‌دهد.
 *
 * صدا زدنش از بیرون هم امن است (آزمون‌ها همین کار را می‌کنند) — اگر سرورِ
 * ایمیل تنظیم نشده باشد، اصلاً شروع نمی‌کند تا ردیف‌ها بی‌خود «شکست‌خورده»
 * نشوند؛ کد در پنل هست و صاحبِ سرور می‌بیندش.
 */
export async function drainQueue(settings = codeSettings()) {
  if (!mailReady(settings)) return { skipped: 'mail_not_configured' };
  const workers = Array.from({ length: settings.workers }, () => worker(settings));
  await Promise.all(workers);
  return { ok: true };
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
