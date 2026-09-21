// ---------------------------------------------------------------------------
//  «چرا کار نمی‌کند؟» — یک جا، به‌جای گشتن در ده صفحه
//
//  ⚠️ چرا لازم شد: هر بار که چیزی کار نمی‌کرد، جوابِ «چرا» در چند جای
//  متفاوت پخش بود — تونل یک‌جا، ایمیل جای دیگر، ابر جای سوم. کسی که با
//  گوشی‌اش وسطِ کار گیر می‌کند نمی‌تواند سه صفحه را کنار هم بگذارد.
//
//  این مسیر یک فهرستِ ساده می‌دهد: هر چیزی که برنامه‌ها به آن تکیه دارند،
//  با یک وضعیت (خوب / هشدار / خراب) و یک جملهٔ فارسی که می‌گوید چه کار
//  باید کرد.
//
//  ⚠️ و هیچ‌وقت خطا نمی‌دهد. صفحه‌ای که قرار است بگوید «چه چیزی خراب
//  است»، خودش نباید جزو خراب‌ها باشد؛ هر سنجه در try خودش است و اگر
//  نشد، همان را می‌گوید.
// ---------------------------------------------------------------------------
import os from 'node:os';
import { Router } from 'express';
import { config } from '../config.js';
import { requireAuth } from '../auth.js';
import { versionInfo } from '../version.js';
import { publicState as tunnelState } from '../tunnel.js';
import { codeSettings } from '../codes/settings.js';
import { mailReady } from '../codes/mail.js';
import { queueStatus } from '../codes/queue.js';
import { adminHostFor } from '../platform/domain.js';
import { probeAccountServer } from '../api/account-proxy.js';
import { cloudStatus, cloudLimitState } from '../stations/cloud.js';
import { downHint, mailEnvForChild } from '../account/supervisor.js';

const router = Router();
router.use(requireAuth);

const GOOD = 'good';
const WARN = 'warn';
const BAD = 'bad';

/** یک سنجه — هیچ‌وقت پرتاب نمی‌کند */
function probe(key, title, fn) {
  try {
    const out = fn();
    return { key, title, ...out };
  } catch (e) {
    return { key, title, state: BAD, value: '', hint: `سنجیده نشد: ${e.message}` };
  }
}

/** آدرس‌های محلیِ این کامپیوتر — همان‌هایی که برنامه‌ها در خانه می‌زنند */
function localAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces() || {})) {
    for (const nic of list || []) {
      if (nic.family === 'IPv4' && !nic.internal) out.push(nic.address);
    }
  }
  return out;
}

/**
 *   GET /api/diagnostics
 *
 *   { ok, checks: [ { key, title, state, value, hint } ], summary }
 */
router.get('/', async (req, res) => {
  const codes = codeSettings();
  //  سرورِ حساب واقعاً زده می‌شود (سه ثانیه سقف) — نه از روی تنظیمات حدس زده شود
  const account = await probeAccountServer().catch((e) => ({ enabled: true, up: false, error: e.message }));
  //  رباتِ ایمیلی که پنل به فرزندش می‌دهد — بی آن هیچ کدی به دستِ کسی
  //  نمی‌رسد. چرایی‌اش پایین، در ردیفِ «سرورِ حساب».
  const accountMail = (() => { try { return Object.keys(mailEnvForChild()).length > 0; } catch { return false; } })();
  const tunnel = tunnelState();
  const ips = localAddresses();

  const checks = [
    probe('server', 'خودِ سرور', () => ({
      state: GOOD,
      value: `نسخهٔ ${versionInfo.version}`,
      hint: 'سرور بالاست — همین جواب از خودش آمده.',
    })),

    probe('lan', 'آدرس در شبکهٔ خانه', () => {
      if (!ips.length) {
        return {
          state: BAD,
          value: '—',
          hint: 'این کامپیوتر آدرسِ شبکه ندارد. کابل یا وای‌فای وصل است؟',
        };
      }
      return {
        state: GOOD,
        value: `http://${ips[0]}:${config.port}`,
        hint: 'برنامه‌هایی که روی همین وای‌فای‌اند، با این آدرس وصل می‌شوند.',
      };
    }),

    probe('publicPort', 'درگاهِ عمومی', () => {
      const on = config.siteSync.enabled !== false;
      return {
        state: on ? GOOD : WARN,
        value: on ? String(config.siteSync.port) : 'خاموش',
        hint: on
          ? 'برنامه‌ها و سایت‌ها از این درگاه به سرور می‌رسند.'
          : 'خاموش است؛ از بیرونِ خانه هیچ برنامه‌ای وصل نمی‌شود.',
      };
    }),

    probe('tunnel', 'راهِ اینترنت (تونل)', () => {
      const running = tunnel.status === 'running';
      return {
        state: running ? GOOD : WARN,
        value: tunnel.url || (running ? 'بالا' : 'خاموش'),
        hint: running
          ? 'از بیرونِ خانه هم به سرور می‌رسند.'
          : 'تا تونل بالا نیاید، فقط داخلِ خانه کار می‌کند.',
      };
    }),

    probe('adminDoor', 'درِ برنامهٔ مدیر', () => {
      const host = tunnel.hostname ? adminHostFor(tunnel.hostname) : null;
      if (!host) {
        return {
          state: WARN,
          value: '—',
          hint: 'دامنه‌ای ثبت نشده. تا آن نباشد، برنامهٔ مدیر فقط در خانه کار می‌کند.',
        };
      }
      return {
        state: GOOD,
        value: `https://${host}`,
        hint: 'آدرسی که برنامهٔ مدیر از هر جای دنیا می‌زند.',
      };
    }),

    probe('mail', 'رباتِ ایمیل', () => {
      const ready = mailReady(codes);
      return {
        state: ready ? GOOD : BAD,
        value: ready ? codes.email.host : 'تنظیم نشده',
        hint: ready
          ? 'کدهای شش‌رقمی از همین‌جا فرستاده می‌شوند.'
          : 'کدها ساخته می‌شوند ولی فرستاده نمی‌شوند. پنل ← کدهای شش‌رقمی ← تنظیمات.',
      };
    }),

    probe('codeQueue', 'صفِ کدها', () => {
      const q = queueStatus();
      const waiting = Number(q?.waiting) || 0;
      const failed = Number(q?.failed) || 0;
      if (failed > 0) {
        return {
          state: WARN,
          value: `${waiting} در صف · ${failed} نرفته`,
          hint: q.lastError
            ? `آخرین دلیل: ${String(q.lastError).slice(0, 180)}`
            : 'چند کد نرفته‌اند. معمولاً یعنی سرورِ ایمیل جواب نمی‌دهد.',
        };
      }
      return {
        state: GOOD,
        value: waiting > 0 ? `${waiting} در صف` : 'خالی',
        hint: 'کدها به‌محضِ ساخته شدن فرستاده می‌شوند.',
      };
    }),

    probe('stations', 'پمپ‌ها', () => {
      const on = config.stations?.enabled !== false;
      return {
        state: on ? GOOD : WARN,
        value: on ? 'روشن' : 'خاموش',
        hint: on
          ? 'برنامهٔ پمپ می‌تواند داده‌اش را این‌جا بنویسد.'
          : 'بخشِ پمپ خاموش است و هیچ پمپی وصل نمی‌شود.',
      };
    }),

    /*
     *  ⚠️ سرورِ حساب — همان که تا دیروز «ابر» می‌گفتیم. حساب، اشتراک و نرخِ
     *  پمپ‌ها روی آن است و اپِ مدیریت هر سه را از همین‌جا می‌خواند. تا پیش از
     *  این هیچ سنجه‌ای نبود و کاربر فقط «از ابر جواب نگرفتیم» را می‌دید، بی
     *  این‌که بداند سرور خاموش است یا فقط وارد نشده.
     */
    probe('accountServer', 'سرورِ حساب', () => {
      if (account.enabled === false) {
        return { state: WARN, value: 'خاموش (HLP_ACCOUNT_API=0)', hint: 'ورودِ برنامه‌ها از این‌جا رد نمی‌شود.' };
      }
      if (!account.up) {
        //  چرا روشن نیست را ناظرِ خودش می‌داند (نصب نیست / دارد بالا می‌آید / افتاده)
        let hint = 'سرورِ حساب روی همین کامپیوتر روشن نیست.';
        try { hint = downHint(); } catch { /* پیامِ پیش‌فرض */ }
        return { state: BAD, value: account.url || '—', hint };
      }
      const st = cloudStatus();
      if (!st.linked) {
        return {
          state: WARN,
          value: account.version ? `نسخهٔ ${account.version} — وارد نشده‌اید` : 'وارد نشده‌اید',
          hint: 'سرور بالاست ولی مدیر هنوز واردش نشده. از پنل ← پمپ‌ها ← تنظیمات و داده‌ها، یا HLP_ACCOUNT_ADMIN_USER/PASSWORD در .env تا خودش وارد شود.',
        };
      }
      /*
       *  ⛔ **سقفِ نرخ ساکت نمی‌ماند.**
       *
       *  گزارشِ صاحب سامانه با عکس (۱۴۰۵/۰۷/۱۱): روی هر صفحه نوارِ «تعداد
       *  درخواست بیش از حد مجاز است» و هیچ ردیفی نمی‌آمد — و عیب‌یابی در
       *  همان حال **سبز** بود، چون `/api/health` سرورِ حساب از سقف رد
       *  می‌شود. همان «کلکِ دروغ»: سرور بالاست، ولی پنل هیچ چیزی از آن
       *  نمی‌تواند بخواند.
       *
       *  ⚠️ و این ردیف **زرد** است نه سرخ، و می‌گوید چند ثانیهٔ دیگر
       *  خودش باز می‌شود: کارِ آدمی لازم نیست، فقط دانستن.
       */
      const lim = cloudLimitState();
      if (lim.limited) {
        return {
          state: WARN,
          value: `سقفِ نرخ پر شده — ${lim.secondsLeft} ثانیه تا تلاشِ بعدی`,
          hint: 'سرورِ حساب بالاست ولی سقفِ نرخش پر شده، پس پنل عمداً چیزی از آن '
              + 'نمی‌پرسد تا پنجره خودش خالی شود. کدها، میزِ فروشگاه و مشتری‌ها تا '
              + 'آن لحظه خالی می‌مانند و بعد خودشان برمی‌گردند — کاری لازم نیست.',
        };
      }

      /*
       *  ⛔ «روشن است» با «کار می‌کند» یکی نیست ═══════════════════════════
       *
       *  سنجیده شد، حدس زده نشد (‎test/pump-e2e.mjs‎، ۱۴۰۵/۰۷/۰۷): با
       *  رباتِ ایمیلِ تنظیم‌نشده، زنجیرهٔ ورودِ **هر سه برنامه** بن‌بستِ
       *  کامل است و هیچ‌جا هم نمی‌گوید چرا:
       *
       *    • ناظر فرزند را با ‎NODE_ENV=production‎ بالا می‌آورد (درست)
       *    • پس کد در پاسخِ HTTP برنمی‌گردد (درست — از تونل درز می‌کرد)
       *    • و رباتِ ایمیلِ سرورِ حساب روی ‎log‎ می‌ماند، که در production
       *      کد را **حتی در لاگ هم نمی‌نویسد** («لاگ جای راز نیست»)
       *    • ولی ‎register/start‎ همچنان ۲۰۰ می‌دهد (عمدی: وجودِ حساب لو نرود)
       *
       *  یعنی کاربر «کد فرستاده شد» می‌بیند و هیچ کدی هیچ‌وقت نمی‌رسد. و
       *  این ردیف تا امروز در همان حال **سبز** بود — همان «کلکِ دروغ»ی که
       *  در این ریپو قدغن است.
       *
       *  ⚠️ سرورِ حساب می‌تواند SMTPِ خودش را هم در دیتابیسش داشته باشد و
       *  آن جلوتر است، پس این هشدار است نه حکم — و خودش همین را می‌گوید.
       */
      if (!accountMail) {
        return {
          state: WARN,
          value: account.version ? `نسخهٔ ${account.version} — رباتِ ایمیل تنظیم نیست` : 'رباتِ ایمیل تنظیم نیست',
          hint: 'سرورِ حساب بالاست ولی هیچ راهِ ارسالی ندارد: کدِ شش‌رقمیِ ثبت‌نام و ورود '
              + 'ساخته می‌شود و به دستِ هیچ‌کس نمی‌رسد — نه ایمیل، نه در پاسخ، نه در لاگ. '
              + 'SMTP را در «کدهای شش‌رقمی ← ربات و تنظیمات» بنویسید. '
              + '(اگر خودِ سرورِ حساب SMTPِ جداگانه‌ای در پنلِ مدیریتش دارد، همان جلوتر است.)',
        };
      }
      return {
        state: GOOD,
        value: account.version ? `نسخهٔ ${account.version}` : 'وصل',
        hint: st.auto
          ? 'حساب‌ها، اشتراک‌ها و نرخ‌های پمپ از همین‌جا می‌آیند؛ پنل خودش وارد می‌شود.'
          : 'حساب‌ها، اشتراک‌ها و نرخ‌های پمپ از همین‌جا می‌آیند.',
      };
    }),

    probe('dataDir', 'پوشهٔ داده', () => ({
      state: GOOD,
      value: config.dataDir,
      hint: 'همه‌چیزِ سرور همین‌جاست — این پوشه را ببرید، سرور با شما می‌آید.',
    })),
  ];

  const bad = checks.filter((c) => c.state === BAD).length;
  const warn = checks.filter((c) => c.state === WARN).length;

  res.json({
    ok: true,
    checks,
    bad,
    warn,
    summary: bad
      ? `${bad} چیز خراب است و باید درست شود.`
      : warn
        ? `${warn} چیز روشن نیست، ولی سرور کار می‌کند.`
        : 'همه‌چیز سرِ جایش است.',
    at: Date.now(),
  });
});

export default router;
