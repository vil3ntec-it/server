// ═══════════════════════════════════════════════════════════════════════════
//  دروازهٔ فقط‌خواندنیِ منابع داده
//
//  همهٔ منابعی که دستیار می‌تواند بخواند این‌جا ثبت می‌شوند و **فقط با GET**.
//  ثبت کردنِ یک منبع با هر متدِ دیگری، در لحظهٔ راه‌اندازی خطا می‌دهد و سرویس
//  بالا نمی‌آید (assertGatewayIsReadOnly).
//
//  چرا یک لایهٔ جدا برای چیزی که می‌شد مستقیم در مسیرها نوشت: چون آن‌وقت
//  «فقط‌خواندنی بودن» به دقتِ نویسندهٔ هر مسیر وابسته می‌شد. این‌طوری یک فهرست
//  هست و یک بررسیِ خودکار روی همان فهرست.
//
//  ⚠️ مسیرهای حافظهٔ کاربر (`/memory`) عمداً **بیرون از این دروازه‌اند**. آن‌ها
//     دادهٔ برنامه نیستند، دادهٔ خودِ کاربر در پوشهٔ خودِ سرویس‌اند، و طبقِ خواستهٔ
//     پروژه کاربر باید بتواند پاکشان کند. هیچ ابزارِ AI هم به آن‌ها دست ندارد.
// ═══════════════════════════════════════════════════════════════════════════

import { canAccess } from '../security/auth.js';

/** متدهایی که هیچ منبعی حق ندارد داشته باشد */
const FORBIDDEN_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD_WRITE'];

/**
 * @typedef {{name: string, method: 'GET', minLevel: string, handler: Function}} Source
 */

/** @type {Map<string, Source>} */
const sources = new Map();

/**
 * ثبتِ یک منبعِ خواندنی.
 * @param {string} name مسیر، مثلاً 'search'
 * @param {{minLevel?: string, handler: Function, method?: string}} def
 */
export function registerSource(name, def) {
  const method = (def.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    throw new Error(`دروازهٔ فقط‌خواندنی: منبعِ «${name}» با متدِ ${method} ثبت شد. فقط GET مجاز است.`);
  }
  if (sources.has(name)) throw new Error(`منبعِ «${name}» دوبار ثبت شد`);
  sources.set(name, { name, method: 'GET', minLevel: def.minLevel || 'PUBLIC', handler: def.handler });
}

/**
 * خواندنِ یک منبع.
 * @returns {Promise<{ok: boolean, status: number, data?: any, error?: string}>}
 */
export async function readSource(name, { level, query, ctx }) {
  const src = sources.get(name);
  if (!src) return { ok: false, status: 404, error: `منبعِ «${name}» وجود ندارد` };
  if (!canAccess(level, src.minLevel)) return { ok: false, status: 403, error: 'سطحِ دسترسیِ شما برای این منبع کافی نیست' };

  try {
    const data = await src.handler({ query, level, ctx });
    return { ok: true, status: 200, data };
  } catch (e) {
    return { ok: false, status: 500, error: e.message };
  }
}

export function listSources() {
  return [...sources.values()].map(s => ({ name: s.name, method: s.method, minLevel: s.minLevel }));
}

/**
 * بررسیِ لحظهٔ راه‌اندازی: هیچ منبعی نباید متدِ نوشتنی داشته باشد.
 * @throws {Error}
 */
export function assertGatewayIsReadOnly() {
  const bad = [];
  for (const s of sources.values()) {
    if (s.method !== 'GET') bad.push(`${s.name} → ${s.method}`);
    if (FORBIDDEN_METHODS.includes(s.method)) bad.push(`${s.name} → ${s.method}`);
  }
  if (bad.length) throw new Error('دروازه فقط‌خواندنی نیست: ' + bad.join('، '));
  return true;
}

/** فقط برای تست‌ها */
export function _clearSources() { sources.clear(); }
