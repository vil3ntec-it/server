// ═══════════════════════════════════════════════════════════════════════════
//  رجیستریِ ابزارها — همه فقط‌خواندنی
//
//  هر ابزار **باید** این فیلدها را داشته باشد:
//      name        نامِ یکتا
//      readOnly    باید دقیقاً true باشد؛ router هر چیزِ دیگری را رد می‌کند
//      minLevel    کمترین سطحِ دسترسیِ لازم
//      schema      طرحِ آرگومان‌ها (چون آرگومان‌ها را **مدل** می‌سازد، نه آدم)
//      handler     پیاده‌سازی
//
//  اضافه کردنِ ابزارِ تازه به این فایل **کافی نیست**: نامش باید در
//  config.tools.whitelist هم بیاید. یعنی فراموشکاری به «باز شدنِ ناخواسته»
//  منجر نمی‌شود، به «کار نکردن» منجر می‌شود — خطا در جهتِ امن.
// ═══════════════════════════════════════════════════════════════════════════

import { canAccess } from '../../security/auth.js';

/** آدرس‌هایی که اجازهٔ خروج دارند — از خودِ Knowledge Base خوانده می‌شود */
function allowedLinks(ctx) {
  const out = [];
  for (const doc of ctx.index.docs || []) {
    if (!canAccess(ctx.level, doc.access)) continue;
    for (const l of doc.links || []) {
      if (l?.url) out.push({ text: l.text, url: l.url, source: doc.title });
    }
  }
  return out;
}

async function retrieve(ctx, query, { limit = 5, filter = null } = {}) {
  const { results } = await ctx.retriever.search(query, { level: ctx.level, topK: limit * 2 });
  const filtered = filter ? results.filter(filter) : results;
  return filtered.slice(0, limit).map(r => ({
    title: r.title,
    section: r.heading || '',
    feature: r.feature || '',
    version: r.version || '',
    updated: r.updated || '',
    text: r.text,
    source: `${r.title}${r.heading ? ' ← ' + r.heading : ''}`,
  }));
}

export const TOOLS = [
  // ───────────────────────────────────────────────────────────────────────
  {
    name: 'search_knowledge_base',
    description: 'جست‌وجوی معنایی در کلِ دانشِ برنامه. وقتی سؤال کلی است یا نمی‌دانی در کدام دسته می‌گنجد، از این استفاده کن.',
    readOnly: true,
    minLevel: 'PUBLIC',
    schema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', maxLength: 300, minLength: 2 },
        limit: { type: 'integer', minimum: 1, maximum: 8, default: 5 },
      },
    },
    handler: (args, ctx) => retrieve(ctx, args.query, { limit: args.limit || 5 }),
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    name: 'search_documentation',
    description: 'جست‌وجو فقط در مستنداتِ راهنما (نه پرسش‌های پرتکرار). برای «چطور فلان کار را بکنم» مناسب است.',
    readOnly: true,
    minLevel: 'PUBLIC',
    schema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', maxLength: 300, minLength: 2 },
        feature: { type: 'string', maxLength: 60 },
      },
    },
    handler: (args, ctx) => retrieve(ctx, args.feature ? `${args.feature} ${args.query}` : args.query, {
      limit: 5,
      filter: r => r.kind !== 'faq',
    }),
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    name: 'search_faq',
    description: 'جست‌وجو در پرسش‌های پرتکرار. برای سؤال‌های کوتاه و رایج سریع‌ترین راه است.',
    readOnly: true,
    minLevel: 'PUBLIC',
    schema: {
      type: 'object',
      required: ['query'],
      properties: { query: { type: 'string', maxLength: 300, minLength: 2 } },
    },
    handler: (args, ctx) => retrieve(ctx, args.query, { limit: 4, filter: r => r.kind === 'faq' }),
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    name: 'get_feature_info',
    description: 'اطلاعاتِ کاملِ یک قابلیتِ مشخص — نسخه، توضیح، مراحل و لینک‌هایش.',
    readOnly: true,
    minLevel: 'PUBLIC',
    schema: {
      type: 'object',
      required: ['feature'],
      properties: { feature: { type: 'string', maxLength: 80, minLength: 2 } },
    },
    handler: async (args, ctx) => {
      const needle = args.feature.toLowerCase();
      const docs = (ctx.index.docs || [])
        .filter(d => canAccess(ctx.level, d.access))
        .filter(d =>
          String(d.feature).toLowerCase().includes(needle) ||
          String(d.title).toLowerCase().includes(needle) ||
          (d.tags || []).some(t => String(t).toLowerCase().includes(needle)));

      if (!docs.length) return { found: false, hint: 'قابلیتی با این نام در مستندات نبود؛ با search_knowledge_base جست‌وجو کن.' };

      return docs.slice(0, 3).map(d => ({
        feature: d.feature || d.title,
        title: d.title,
        version: d.version,
        updated: d.updated,
        permissions: d.permissions || [],
        shortcuts: d.shortcuts || [],
        links: d.links || [],
        qr: d.qr || '',
        source: d.title,
      }));
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    name: 'get_shortcuts',
    description: 'فهرستِ کلیدهای میانبرِ مستندشده. اگر context بدهی، فقط میانبرهای مربوط به آن بخش برمی‌گردد.',
    readOnly: true,
    minLevel: 'PUBLIC',
    schema: {
      type: 'object',
      properties: { context: { type: 'string', maxLength: 60 } },
    },
    handler: async (args, ctx) => {
      const all = [];
      for (const doc of ctx.index.docs || []) {
        if (!canAccess(ctx.level, doc.access)) continue;
        for (const s of doc.shortcuts || []) {
          if (!s?.keys) continue;
          all.push({ keys: s.keys, does: s.does || '', version: doc.version, source: doc.title });
        }
      }
      if (!args.context) return all;
      const needle = args.context.toLowerCase();
      const hit = all.filter(s => `${s.keys} ${s.does}`.toLowerCase().includes(needle));
      return hit.length ? hit : all;
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    name: 'get_supported_links',
    description: 'لینک‌های رسمیِ برنامه. **فقط** از این فهرست لینک بده؛ هرگز آدرس از خودت نساز.',
    readOnly: true,
    minLevel: 'PUBLIC',
    schema: {
      type: 'object',
      properties: { topic: { type: 'string', maxLength: 60 } },
    },
    handler: async (args, ctx) => {
      const links = allowedLinks(ctx);
      if (!args.topic) return links;
      const needle = args.topic.toLowerCase();
      const hit = links.filter(l => `${l.text} ${l.url}`.toLowerCase().includes(needle));
      return hit.length ? hit : links;
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    name: 'get_account_help',
    description: 'راهنمای کارِ با حساب کاربری: ورود، خروج، بازیابیِ دسترسی، نقش‌ها و مشکلاتِ ورود. فقط آموزش می‌دهد.',
    readOnly: true,
    minLevel: 'PUBLIC',
    schema: {
      type: 'object',
      properties: { topic: { type: 'string', maxLength: 80 } },
    },
    handler: async (args, ctx) => {
      const q = args.topic ? `حساب کاربری ورود ${args.topic}` : 'ورود به حساب رمز نقش دسترسی';
      const found = await retrieve(ctx, q, { limit: 5 });
      return {
        help: found,
        // این یادآوری همیشه همراهِ جواب می‌رود تا مدل وسوسه نشود قول بدهد
        note: 'این ابزار فقط آموزش می‌دهد. ساخت، تغییر، حذفِ حساب یا بازیابیِ رمز از راهِ دستیار ممکن نیست.',
      };
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    name: 'generate_qr',
    description: 'ساختِ QR برای یکی از لینک‌های رسمی. فقط لینکِ موجود در فهرستِ رسمی پذیرفته می‌شود.',
    readOnly: true,
    minLevel: 'PUBLIC',
    schema: {
      type: 'object',
      required: ['target'],
      properties: {
        target: { type: 'string', maxLength: 200, minLength: 2 },
        label: { type: 'string', maxLength: 60 },
      },
    },
    handler: async (args, ctx) => {
      const links = allowedLinks(ctx);
      const needle = args.target.toLowerCase().trim();

      // یا خودِ آدرس است یا نامش — هر دو باید در فهرستِ رسمی باشند
      const match = links.find(l => l.url.toLowerCase() === needle)
        || links.find(l => l.text.toLowerCase().includes(needle))
        || links.find(l => l.url.toLowerCase().includes(needle));

      if (!match) {
        return {
          ok: false,
          reason: 'این آدرس در فهرستِ لینک‌های رسمی نیست، پس برایش QR ساخته نمی‌شود.',
          available: links.map(l => l.text),
        };
      }

      // خودِ تصویر این‌جا ساخته نمی‌شود: مرورگرِ کاربر کتابخانهٔ QR را از قبل
      // دارد. هم سرور کاری نمی‌کند، هم عکس از شبکه رد نمی‌شود.
      return {
        ok: true,
        render: 'qr',
        payload: match.url,
        label: args.label || match.text,
        source: match.source,
      };
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
//  ابزارهای «سمتِ دستگاه» — خواندنِ اعدادِ واقعیِ حساب‌ها
//
//  این‌ها handler ندارند و **روی سرور اجرا نمی‌شوند**. وقتی مدل یکی‌شان را صدا
//  بزند، سرویس فقط می‌گوید «این را از دستگاه بپرس» و مرورگرِ خودِ کاربر آن را
//  با توابعِ خودِ برنامه (_splitTotals، _allRows، _fuelStock …) حساب می‌کند.
//
//  چرا این‌طور، نه اتصالِ سرویس به دیتابیس:
//    • دادهٔ مالی از دستگاهِ کاربر بیرون نمی‌رود. سرویس فقط نتیجهٔ نهایی را
//      می‌بیند، آن هم چون خودِ کاربر پرسیده.
//    • مرزِ امنیتی دست‌نخورده می‌ماند: سرویس هنوز هیچ راهی به server/data ندارد.
//    • محاسبهٔ حساس (الباقی، فیصدی، دو دفترِ تیل و پول) دوباره نوشته نمی‌شود —
//      همان کدی اجرا می‌شود که خودِ برنامه سال‌هاست استفاده می‌کند.
//    • آفلاین هم کار می‌کند.
//
//  همچنان فقط‌خواندنی‌اند: هیچ‌کدام چیزی را عوض نمی‌کنند.
// ═══════════════════════════════════════════════════════════════════════════
export const CLIENT_TOOLS = [
  {
    name: 'get_account_balance',
    description: 'الباقی، بردگی، رسید و تیلِ باقی‌ماندهٔ یک قرض‌دار یا شرکت را با نامش می‌گیرد. برای «حساب فلانی چند است؟» یا «الباقی فلانی».',
    readOnly: true,
    clientSide: true,
    minLevel: 'USER',
    schema: {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string', maxLength: 80, minLength: 2 } },
    },
  },
  {
    name: 'list_accounts',
    description: 'فهرستِ نامِ قرض‌داران و شرکت‌ها. اگر query بدهی، فقط آن‌هایی که نامشان می‌خورد.',
    readOnly: true,
    clientSide: true,
    minLevel: 'USER',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 60 },
        kind: { type: 'string', enum: ['debt', 'company', 'all'], default: 'all' },
      },
    },
  },
  {
    name: 'get_fuel_stock',
    description: 'باقی‌ماندهٔ مخزنِ پطرول و دیزل به لیتر.',
    readOnly: true,
    clientSide: true,
    minLevel: 'USER',
    schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_app_totals',
    description: 'جمع‌های کلی: تعدادِ قرض‌داران، قرضِ کل، مصارفِ امروز.',
    readOnly: true,
    clientSide: true,
    minLevel: 'USER',
    schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_app_data',
    description: 'جست‌وجوی یک نام، عدد، حواله یا توضیح در همهٔ بخش‌های برنامه. فقط برای مدیر.',
    readOnly: true,
    clientSide: true,
    minLevel: 'ADMIN',
    schema: {
      type: 'object',
      required: ['query'],
      properties: { query: { type: 'string', maxLength: 80, minLength: 2 } },
    },
  },
];

export const TOOL_BY_NAME = new Map([...TOOLS, ...CLIENT_TOOLS].map(t => [t.name, t]));

/** طرحی که به مدل داده می‌شود (قالبِ tool-calling) */
export function toolSchemasFor(level, whitelist, { withClientTools = true } = {}) {
  return [...TOOLS, ...(withClientTools ? CLIENT_TOOLS : [])]
    .filter(t => whitelist.includes(t.name))
    .filter(t => t.readOnly === true)
    .filter(t => canAccess(level, t.minLevel))
    .map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.schema },
    }));
}
