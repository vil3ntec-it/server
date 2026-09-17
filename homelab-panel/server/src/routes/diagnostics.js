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
router.get('/', (req, res) => {
  const codes = codeSettings();
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
