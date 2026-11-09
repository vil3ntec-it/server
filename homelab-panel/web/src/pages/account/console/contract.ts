// ---------------------------------------------------------------------------
//  قراردادِ ماژول‌های بخشِ «فروشگاه»: نوع‌ها، `defineModule` و نشانیِ درهای پوسته.
//
//  ⛔ عمداً جدا از `registry.ts`: فایل‌های ‎./modules/*‎ فقط همین را وارد می‌کنند. اگر `defineModule` در خودِ
//     `registry.ts` بود (که ماژول‌ها را با ‎import.meta.glob‎ می‌خواند)، حلقهٔ وارد کردن ساخته می‌شد و بسته پیش از
//     آماده شدنِ آن ثابت به آن می‌رسید (‎Cannot access … before initialization‎ — کلِ پنل سفید).
// ---------------------------------------------------------------------------
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

export type Tri = { fa: string; en: string; ps: string };

/** آن‌چه سرور برای هر ماژول می‌گوید (شکلِ ‎/console/modules‎). */
export type ServerModule = {
  id: string; spec: string; group: string; order: number; minRole: 'viewer' | 'operator' | 'admin';
  label: Tri; built: boolean;
};
export type ServerGroup = { id: string; label: Tri };
export type ModulesResponse = { role: string; owner: boolean; groups: ServerGroup[]; modules: ServerModule[]; at: number };

/** آن‌چه پوسته به هر ماژول می‌دهد. */
export type ModuleProps = {
  /** پارامترهای نشانی (‎?tab=<id>&…‎) — لینکِ مستقیم و برگشتِ مرورگر */
  params: URLSearchParams;
  /** عوض کردنِ پارامترهای همین ماژول (‎tab‎ خودش می‌ماند) */
  setParams: (next: Record<string, string>) => void;
  info: ServerModule;
  /** نقش و مالک بودنِ همین نشست — فقط برای نشان دادن؛ مرز در سرور است */
  role: string;
  owner: boolean;
};

export type ConsoleModuleDef = {
  /** همان شناسهٔ سرور و ‎?tab=‎ */
  id: string;
  icon: LucideIcon;
  component: ComponentType<ModuleProps>;
  /** تکهٔ آخرِ «ردِ نان» از پارامترهای نشانی (مثلاً شناسهٔ دکانِ باز) — اختیاری */
  crumb?: (params: URLSearchParams) => string | null;
};

export function defineModule(def: ConsoleModuleDef): ConsoleModuleDef {
  return def;
}

export const SHELL_API = {
  modules: '/api/account-admin/console/modules',
  summary: '/api/account-admin/console/summary',
  search: (q: string) => `/api/account-admin/console/search?q=${encodeURIComponent(q)}`,
  admins: '/api/account-admin/console/admins',
  adminUpdate: (id: string) => `/api/account-admin/console/admins/${encodeURIComponent(id)}/update`,
  adminSessions: (id: string) => `/api/account-admin/console/admins/${encodeURIComponent(id)}/sessions`,
  adminSessionsRevoke: (id: string) => `/api/account-admin/console/admins/${encodeURIComponent(id)}/sessions/revoke`,
  flags: '/api/account-admin/console/flags',
  flagsReset: '/api/account-admin/console/flags/reset',
};
