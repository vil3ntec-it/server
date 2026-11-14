// ---------------------------------------------------------------------------
//  فهرستِ ماژول‌های سمتِ سرورِ پنل — هر ماژول **یک ورود** (شرح: ‎docs/SHOP-MODULE-fa.md‎).
//
//  ⛔ تنها فایلی بیرون از ‎src/modules/<id>/‎ که از درونِ ماژول وارد می‌کند همین است (سنجه: ‎test/module-boundary.mjs‎).
//  پنل (‎routes/account-admin.js‎) فقط ‎mountModules‎ و ‎MODULE_CAPABILITIES‎ را می‌شناسد، نه درونِ ماژول را.
// ---------------------------------------------------------------------------
import shop from './shop/index.js';

export const SERVER_MODULES = Object.freeze([shop]);

/** همهٔ درهای ماژول‌ها روی روترِ پلِ سرورِ حساب، به ترتیبِ همین فهرست. */
export function mountModules(router, deps) {
  for (const m of SERVER_MODULES) m.mount(router, deps);
}

/** توانایی‌های سرورِ حساب که ماژول‌ها می‌خواهند (برای ‎PHASE3‎ و ‎/console/capabilities‎). */
export const MODULE_CAPABILITIES = Object.freeze(Object.assign({}, ...SERVER_MODULES.map((m) => m.capabilities || {})));
