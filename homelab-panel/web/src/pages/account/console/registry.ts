/// <reference types="vite/client" />
// ---------------------------------------------------------------------------
//  🏪 فهرستِ ماژول‌های بخشِ «فروشگاه» — سمتِ وب (نقطهٔ گسترش؛ شرح: ‎docs/CONSOLE-SHELL-fa.md‎)
//
//  هر ماژول **یک فایل** است در ‎./modules/<id>.tsx‎ که `export default defineModule({ … })` می‌کند؛ این‌جا
//  خودکار جمع می‌شوند (‎import.meta.glob‎) — نه فهرستِ دستی، نه ویرایشِ فایلِ مشترک، نه دست زدن به `App.tsx`.
//
//  ⛔ **این‌جا قاعدهٔ دسترسی نیست.** کدام ماژول برای کدام نقش، عنوان، گروه و ترتیب از سرورِ پنل می‌آید
//     (‎GET /api/account-admin/console/modules‎ ⇐ ‎server/src/console/modules.js‎) و همان‌جا هم سنجیده می‌شود.
//     ماژولِ وبی که سرور برای این نقش نگفته دیده نمی‌شود؛ ماژولِ سروری که فایلِ وب ندارد هم (صادقانه «ساخته نشده»).
//  ⛔ شناسه (`id`) همان ‎?tab=‎ ِ نشانی و همان شناسهٔ سرور است — عوضش نکنید (لینک‌های کهنه و نقش‌ها به آن بسته‌اند).
// ---------------------------------------------------------------------------
import type { ConsoleModuleDef } from './contract';

export type { ConsoleModuleDef, ModuleProps, ModulesResponse, ServerGroup, ServerModule, Tri } from './contract';
export { SHELL_API, defineModule } from './contract';

const files = import.meta.glob<{ default: ConsoleModuleDef }>('./modules/*.tsx', { eager: true });

/** همهٔ ماژول‌های وب، بر اساسِ شناسه. شناسهٔ تکراری ⇒ دومی کنار می‌رود و در کنسول گفته می‌شود. */
export const WEB_MODULES: ReadonlyMap<string, ConsoleModuleDef> = (() => {
  const out = new Map<string, ConsoleModuleDef>();
  for (const [file, mod] of Object.entries(files)) {
    const def = mod?.default;
    if (!def || typeof def.id !== 'string' || !def.component) {
      console.error('[پوستهٔ فروشگاه] ماژولِ بی تعریف:', file);
      continue;
    }
    if (out.has(def.id)) {
      console.error('[پوستهٔ فروشگاه] شناسهٔ تکراری:', def.id, file);
      continue;
    }
    out.set(def.id, def);
  }
  return out;
})();
