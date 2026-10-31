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
//  ⛔ «هشدار» فقط خلاصهٔ همان عددهای واقعی است با پیوند به جایش — موتورِ هشدار (۴.۱۱) جدا ساخته می‌شود و
//     روزی که آمد، تابعِ خودش را این‌جا می‌گذارد.
//  افزودن: یک کلید با شناسهٔ همان ماژول (`console/modules.js`). ماژولِ بی تابع کارتِ «خلاصه‌ای ندارد» می‌گیرد.
// ---------------------------------------------------------------------------
import { db } from '../db.js';

const L = (fa, en, ps) => ({ fa, en, ps });
const n = (x) => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
const at = (x) => n(x?.serverTime) ?? n(x?.checkedAt) ?? null;

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
