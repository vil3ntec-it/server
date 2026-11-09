// ---------------------------------------------------------------------------
//  کارت‌های داشبوردِ بخشِ «فروشگاه» (۴.۱) — یک تابع برای هر ماژول، فقط دادهٔ واقعی
//
//  هر تابع: `async (ctx) => ({ source, at?, metrics: [{ id, label, value, unit? }], alerts?: [...] })`
//    ctx.get(path, query?)   ‎GET‎ به سرورِ حساب از همان پلِ فهرست‌سفید (`cloudRaw`)؛ هر مسیر در هر درخواستِ داشبورد
//                            **یک بار** (چند کارت از یک پاسخ می‌خوانند، نه چند درخواست)
//    ctx.role · ctx.req      نقش و درخواستِ همین نشستِ پنل
//
//  ⛔ عدد ساخته نمی‌شود: نیامده ⇒ `null` (کارت «—» نشان می‌دهد)، نه صفر. خطا ⇒ پرتاب کنید؛ پوسته همان کارت را
//     با کدِ خطا «—» می‌کند و بقیهٔ داشبورد سرِ جایش می‌ماند (هر کارت جدا، با سقفِ زمان).
//  ⛔ `source` همان درِ سرورِ حساب است و `at` زمانِ سنجشِ **خودِ آن‌جا** (اگر داد)؛ وگرنه زمانِ رسیدن به پنل.
//  ⛔ «هشدار» فقط خلاصهٔ همان عددهای واقعی است با پیوند به جایش؛ کارتِ «هشدارها» (۴.۱۱) شمارِ موتورِ هشدارِ
//     خودِ سرورِ حساب (‎/api/admin/ops/alerts‎) است، نه قاعدهٔ تازه‌ای در پنل.
//  افزودن: یک کلید با شناسهٔ همان ماژول (`console/modules.js`). ماژولِ بی تابع کارتِ «خلاصه‌ای ندارد» می‌گیرد.
// ---------------------------------------------------------------------------
import { db } from '../db.js';

const L = (fa, en, ps) => ({ fa, en, ps });
const n = (x) => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
const at = (x) => n(x?.serverTime) ?? n(x?.checkedAt) ?? null;
/** جمعِ چند عددِ واقعی؛ یکی نیامده ⇒ `null` (کارت «—»)، نه جمعِ ناقص. */
const sumOf = (xs) => { const v = xs.map(n); return v.some((x) => x === null) ? null : v.reduce((a, x) => a + x, 0); };

/*
 *  ⛔ درهای سنگینِ کارت‌های بازار، پیک، رخداد و هشدار (اسکنِ سفارش‌ها، جذبِ رخداد، ارزیابیِ هشدار در خودِ
 *  سرورِ حساب) برای داشبورد هر ۳۰ ثانیه حداکثر یک بار، برای همهٔ نشست‌ها: پلِ پنل از ‎127.0.0.1‎ می‌رود و در
 *  سرورِ حساب با سطلِ عمومیِ همان IP شمرده می‌شود (‎RATE_GENERAL_MAX‎، ۶۰۰ در ربع ساعت) — داشبوردِ زنده نباید آن را
 *  برای بخشِ پمپ و بقیهٔ پنل پر کند. کهنگی پنهان نیست: کارت زمانِ سنجشِ خودِ منبع (`at`) را نشان می‌دهد.
 *  فقط پاسخِ موفق می‌ماند؛ خطا همان لحظه پاک می‌شود. نقش پیش از این‌جا سنجیده شده (‎modulesFor‎ ِ پوسته).
 */
const SLOW_TTL_MS = 30_000;
const slowCache = new Map();
function slow(ctx, path, query = {}) {
  const k = `${path}?${new URLSearchParams(query)}`;
  const hit = slowCache.get(k);
  if (hit && Date.now() - hit.t < SLOW_TTL_MS) return hit.p;
  const p = Promise.resolve(ctx.get(path, query));
  slowCache.set(k, { t: Date.now(), p });
  p.catch(() => { if (slowCache.get(k)?.p === p) slowCache.delete(k); });
  return p;
}

/** «توانایی» ِ سرورِ حساب (‎/api/admin/me‎، یک بار در هر درخواستِ داشبورد)؛ نبود ⇒ پرتاب با ‎capability_missing‎. */
async function need(ctx, cap) {
  const me = await ctx.get('/api/admin/me');
  const list = Array.isArray(me?.capabilities) ? me.capabilities.map(String) : [];
  if (!list.includes(cap)) {
    throw Object.assign(new Error(`این بخش روی نسخهٔ فعلیِ سرورِ حساب نیست (${cap})`), { code: 'capability_missing' });
  }
}

/** شکلِ پاسخِ ‎/api/admin/shop-desk/overview‎ (همان که داشبوردِ میز می‌خواند) */
const OVERVIEW = ['/api/admin/shop-desk/overview', { days: 7 }];

export const SUMMARIES = {
  async shops(ctx) {
    const o = await ctx.get(...OVERVIEW);
    const c = o?.counts || {};
    return {
      source: '/api/admin/shop-desk/overview', at: at(o),
      metrics: [
        { id: 'shops', label: L('دکان', 'Shops', 'هټۍ'), value: n(c.shops) },
        { id: 'customers', label: L('مشتری', 'Customers', 'پېرودونکي'), value: n(c.customers) },
        { id: 'online', label: L('آنلاین', 'Online', 'آنلاین'), value: n(c.online) },
      ],
    };
  },

  async subs(ctx) {
    const o = await ctx.get(...OVERVIEW);
    const c = o?.counts || {};
    const expiring = n(c.expiring);
    return {
      source: '/api/admin/shop-desk/overview', at: at(o),
      metrics: [
        { id: 'subscribed', label: L('اشتراک‌دار', 'Subscribed', 'ګډون لرونکي'), value: n(c.subscribed) },
        { id: 'expiring', label: L('رو به پایان (۷ روز)', 'Ending (7 days)', 'پای ته نږدې (۷ ورځې)'), value: expiring },
      ],
      alerts: expiring > 0 ? [{
        level: 'warn', link: '/shop?tab=dash#expiring',
        text: L(`${expiring} اشتراکِ دکان تا ۷ روزِ دیگر تمام می‌شود`, `${expiring} shop subscriptions end within 7 days`,
          `${expiring} د هټۍ ګډونونه په ۷ ورځو کې پای ته رسېږي`),
      }] : [],
    };
  },

  async finance(ctx) {
    const s = await ctx.get('/api/admin/sales/summary');
    const month = s?.revenue?.month?.shop || {};
    const metrics = Object.keys(month).length
      ? Object.entries(month).map(([cur, v]) => ({ id: `month_${cur}`, label: L('درآمدِ این ماه', 'Revenue this month', 'د دې میاشتې عاید'), value: n(v), unit: cur }))
      : [{ id: 'month', label: L('درآمدِ این ماه', 'Revenue this month', 'د دې میاشتې عاید'), value: null }];
    return {
      source: '/api/admin/sales/summary', at: at(s),
      metrics: [...metrics, { id: 'active', label: L('اشتراکِ فعال', 'Active subscriptions', 'فعال ګډونونه'), value: n(s?.counts?.shop?.active) }],
    };
  },

  async versions(ctx) {
    const v = await ctx.get('/api/admin/system/versions');
    const shop = (Array.isArray(v?.apps) ? v.apps : []).find((a) => a?.app === 'shop') || {};
    const below = n(shop.belowMin);
    return {
      source: '/api/admin/system/versions', at: at(v),
      metrics: [
        { id: 'devices', label: L('دستگاهِ فعال', 'Active devices', 'فعالې وسیلې'), value: n(shop.devices) },
        { id: 'latest', label: L('تازه‌ترین نسخه', 'Latest version', 'وروستۍ نسخه'), value: shop.latest || null },
        { id: 'belowMin', label: L('زیرِ کمینه', 'Below minimum', 'له لږ تر لږه ښکته'), value: below },
      ],
      alerts: below > 0 ? [{
        level: 'warn', link: '/shop?tab=versions',
        text: L(`${below} دستگاهِ دکان زیرِ کمینهٔ نسخه است`, `${below} shop devices are below the minimum version`,
          `${below} د هټۍ وسیلې له لږ تر لږه نسخې ښکته دي`),
      }] : [],
    };
  },

  async health(ctx) {
    const h = await ctx.get('/api/admin/system/health');
    const status = typeof h?.status === 'string' ? h.status : null;
    const errors = n(h?.sync?.clientErrors24h);
    const conflicts = n(h?.sync?.conflicts24h);
    const alerts = [];
    if (status === 'down' || status === 'warn') {
      alerts.push({
        level: status === 'down' ? 'bad' : 'warn', link: '/shop?tab=health',
        text: L(`سلامتِ سرورِ حساب: ${status === 'down' ? 'از کار افتاده' : 'هشدار'}`, `Account server health: ${status}`,
          `د حساب سرور روغتیا: ${status}`),
      });
    }
    if (errors > 0) {
      alerts.push({
        level: 'info', link: '/shop?tab=health',
        text: L(`${errors} خطای برنامه در ۲۴ ساعت`, `${errors} app errors in 24h`, `${errors} د اپ تېروتنې په ۲۴ ساعتونو کې`),
      });
    }
    return {
      source: '/api/admin/system/health', at: at(h),
      metrics: [
        { id: 'status', label: L('وضعیت', 'Status', 'حالت'), value: status, kind: 'status' },
        { id: 'errors24h', label: L('خطای ۲۴ ساعت', 'Errors (24h)', 'تېروتنې (۲۴ ساعت)'), value: errors },
        { id: 'conflicts24h', label: L('تعارضِ ۲۴ ساعت', 'Conflicts (24h)', 'ټکر (۲۴ ساعت)'), value: conflicts },
      ],
      alerts,
    };
  },

  async settings(ctx) {
    const f = await ctx.get('/api/admin/flags', { scope: 'all' });
    const items = Array.isArray(f?.items) ? f.items : null;
    const last = items && items.length
      ? Math.max(...items.map((x) => n(x.updatedAt) || 0)) || null
      : null;
    return {
      source: '/api/admin/flags?scope=all', at: at(f),
      metrics: [
        { id: 'flagsSet', label: L('پرچمِ نوشته‌شده', 'Flags set', 'ټاکل شوي بیرغونه'), value: items ? items.length : null },
        { id: 'lastChange', label: L('آخرین تغییر', 'Last change', 'وروستی بدلون'), value: last, kind: 'time' },
      ],
    };
  },

  async integrations(ctx) {
    const p = await ctx.get('/api/admin/system/providers');
    const list = Array.isArray(p?.providers) ? p.providers : null;
    const notLive = list ? list.filter((x) => x?.state && x.state !== 'live').length : null;
    return {
      source: '/api/admin/system/providers', at: at(p),
      metrics: [
        { id: 'providers', label: L('سرویسِ بیرونی', 'External services', 'بهرني خدمتونه'), value: list ? list.length : null },
        { id: 'notLive', label: L('نازنده (آزمایشی/ناقص)', 'Not live (mock/incomplete)', 'ژوندي نه'), value: notLive },
      ],
      alerts: notLive > 0 && p?.production ? [{
        level: 'warn', link: '/shop?tab=integrations',
        text: L(`${notLive} سرویسِ بیرونی در تولید زنده نیست`, `${notLive} external services are not live in production`,
          `${notLive} بهرني خدمتونه په تولید کې ژوندي نه دي`),
      }] : [],
    };
  },

  /*
   *  ۴.۶ · ۴.۷ · ۴.۱۰ · ۴.۱۱ — همان درهای خواندنیِ ماژول‌های خودشان (‎routes/console-market.js‎، ‎console-ops.js‎)،
   *  پشتِ همان «توانایی»: سرورِ کهنه‌تر ⇒ پرتابِ ‎capability_missing‎ و کارتِ «—»، نه عددِ ساختگی و نه ۴۰۴ ِ گنگ.
   */
  async market(ctx) {
    await need(ctx, 'market-admin.v1');
    const o = await slow(ctx, '/api/admin/market/overview', { days: '30' });
    const t = o?.trust || {};
    const pending = sumOf([t.productReports, t.complaints, t.appealed]);
    const stuck = n(o?.orders?.problems?.stuck);
    const alerts = [];
    if (pending > 0) {
      alerts.push({
        level: 'warn', link: '/shop?tab=market',
        text: L(`${pending} پروندهٔ بازار (گزارش، شکایت، اعتراض) منتظرِ تصمیم است`, `${pending} marketplace cases (reports, complaints, appeals) await a decision`,
          `${pending} د بازار دوسیې (راپور، شکایت، اعتراض) د پرېکړې په تمه دي`),
      });
    }
    if (stuck > 0) {
      alerts.push({
        level: 'warn', link: '/shop?tab=market',
        text: L(`${stuck} سفارشِ ویترین در ۳۰ روز گیر کرده است`, `${stuck} storefront orders are stuck (30 days)`,
          `${stuck} د ویترین فرمایشونه بند پاتې دي (۳۰ ورځې)`),
      });
    }
    return {
      source: '/api/admin/market/overview?days=30', at: at(o),
      metrics: [
        { id: 'listedOpen', label: L('فروشندهٔ باز در بازار', 'Open listed sellers', 'په بازار کې پرانیستي پلورونکي'), value: n(o?.sellers?.listedOpen) },
        { id: 'orders30', label: L('سفارشِ ویترین (۳۰ روز)', 'Storefront orders (30 days)', 'د ویترین فرمایشونه (۳۰ ورځې)'), value: n(o?.orders?.total) },
        { id: 'trustPending', label: L('پروندهٔ باز', 'Open cases', 'پرانیستې دوسیې'), value: pending },
        { id: 'stuck', label: L('سفارشِ گیرکرده', 'Stuck orders', 'بند فرمایشونه'), value: stuck },
      ],
      alerts,
    };
  },

  async courier(ctx) {
    await need(ctx, 'delivery-watch.v1');
    const o = await slow(ctx, '/api/admin/delivery/overview', { days: '7' });
    const w = o?.ordersWith || {};
    const stuck = n(w.stuck);
    const discrepancy = n(w.discrepancy);
    const alerts = [];
    if (stuck > 0) {
      alerts.push({
        level: 'warn', link: '/shop?tab=courier',
        text: L(`${stuck} سفارشِ پیک در ۷ روز گیر کرده است`, `${stuck} courier orders are stuck (7 days)`, `${stuck} د پېک فرمایشونه بند پاتې دي (۷ ورځې)`),
      });
    }
    if (discrepancy > 0) {
      alerts.push({
        level: 'warn', link: '/shop?tab=courier',
        text: L(`${discrepancy} سفارش با مغایرتِ پول (نقدِ پیک یا پرداختِ تأییدنشده)`, `${discrepancy} orders with a money discrepancy (courier cash or unconfirmed payment)`,
          `${discrepancy} فرمایشونه د پیسو توپیر لري`),
      });
    }
    return {
      source: '/api/admin/delivery/overview?days=7', at: at(o),
      metrics: [
        { id: 'inDelivery', label: L('در راه', 'Out for delivery', 'په لاره کې'), value: n(o?.stages?.in_delivery) },
        { id: 'delivered24h', label: L('تحویل در ۲۴ ساعت', 'Delivered (24h)', 'سپارل شوي (۲۴ ساعت)'), value: n(o?.last24h?.delivered) },
        { id: 'failed24h', label: L('ناموفق در ۲۴ ساعت', 'Failed (24h)', 'ناکام (۲۴ ساعت)'), value: n(o?.last24h?.failed) },
        { id: 'stuck', label: L('گیرکرده (۷ روز)', 'Stuck (7 days)', 'بند (۷ ورځې)'), value: stuck },
        { id: 'discrepancy', label: L('مغایرتِ پول', 'Money discrepancy', 'د پیسو توپیر'), value: discrepancy },
        { id: 'activeCouriers', label: L('پیکِ فعال', 'Active couriers', 'فعال پېکونه'), value: n(o?.couriers?.active) },
      ],
      alerts,
    };
  },

  async errors(ctx) {
    await need(ctx, 'ops.v1');
    const o = await slow(ctx, '/api/admin/ops/incidents', { status: 'live', limit: '1' });
    const c = o?.counts && typeof o.counts === 'object' ? o.counts : null;
    const open = c ? n(c.open ?? 0) : null;
    const investigating = c ? n(c.investigating ?? 0) : null;
    return {
      source: '/api/admin/ops/incidents?status=live', at: at(o),
      metrics: [
        { id: 'live', label: L('رخدادِ باز', 'Open incidents', 'پرانیستې پېښې'), value: n(o?.total) },
        { id: 'open', label: L('بررسی‌نشده', 'Not triaged', 'نه کتل شوې'), value: open },
        { id: 'investigating', label: L('در دستِ بررسی', 'Investigating', 'د څېړنې لاندې'), value: investigating },
      ],
      alerts: open > 0 ? [{
        level: 'info', link: '/shop?tab=errors',
        text: L(`${open} رخدادِ تازه هنوز بررسی نشده`, `${open} new incidents have not been triaged`, `${open} نوې پېښې لا نه دي کتل شوې`),
      }] : [],
    };
  },

  async alerts(ctx) {
    await need(ctx, 'ops.v1');
    //  یک درخواست: `total` = بحرانی‌های باز (پالایش‌شده)، `counts` = همهٔ هشدارها به وضعیت (بی پالایش، shop ‎ops-alerts.list‎)
    const o = await slow(ctx, '/api/admin/ops/alerts', { status: 'open', severity: 'critical', limit: '1' });
    const c = o?.counts && typeof o.counts === 'object' ? o.counts : null;
    const open = c ? n(c.open ?? 0) : null;
    const critical = n(o?.total);
    const alerts = [];
    if (critical > 0) {
      alerts.push({
        level: 'bad', link: '/shop?tab=alerts',
        text: L(`${critical} هشدارِ بحرانیِ باز`, `${critical} open critical alerts`, `${critical} پرانیستې بحراني خبرتیاوې`),
      });
    } else if (open > 0) {
      alerts.push({
        level: 'warn', link: '/shop?tab=alerts',
        text: L(`${open} هشدارِ باز بی پاسخ`, `${open} open alerts not acknowledged`, `${open} پرانیستې خبرتیاوې بې ځوابه`),
      });
    }
    return {
      source: '/api/admin/ops/alerts?status=open&severity=critical', at: at(o),
      metrics: [
        { id: 'open', label: L('باز', 'Open', 'پرانیستې'), value: open },
        { id: 'acknowledged', label: L('دیده‌شده', 'Acknowledged', 'لیدل شوې'), value: c ? n(c.acknowledged ?? 0) : null },
        { id: 'critical', label: L('بحرانیِ باز', 'Open critical', 'پرانیستې بحراني'), value: critical },
      ],
      alerts,
    };
  },

  /** کاربرانِ پنل — از پایگاهِ خودِ پنل (نه سرورِ حساب)؛ مدیرانِ سرورِ حساب در خودِ ماژول (راهِ پیشین لازم است). */
  async users() {
    const r = db.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN disabled = 0 THEN 1 ELSE 0 END) AS active FROM users').get();
    return {
      source: 'panel: users', at: Date.now(),
      metrics: [
        { id: 'panelUsers', label: L('کاربرِ پنل', 'Panel users', 'د پینل کاروونکي'), value: n(r?.total) },
        { id: 'panelActive', label: L('فعال', 'Active', 'فعال'), value: n(r?.active) },
      ],
    };
  },
};
