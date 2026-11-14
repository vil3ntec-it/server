// ---------------------------------------------------------------------------
//  قراردادِ «ماژولِ پنل» — هر بخشی که می‌خواهد روزی جدا شود (اولی: 🏪 فروشگاه) خودش را با همین شکل معرفی می‌کند.
//  پنل فقط همین را می‌خواند (‎App.tsx‎ مسیرها، ‎Layout.tsx‎ منو)؛ ثبت = یک خط در ‎./registry.ts‎. شرح: ‎docs/SHOP-MODULE-fa.md‎
// ---------------------------------------------------------------------------
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Dict } from '../i18n';

/** یک آیتمِ منو — همان شکلِ آیتم‌های ‎Layout.tsx‎ (همان پالایشِ نقش و قابلیت) + گروهی که در آن می‌نشیند. */
export type PanelModuleMenuItem = {
  /** شناسهٔ گروهِ منوی پنل (‎daily‎ · ‎money‎ …)؛ آیتم سرِ جای ماژول در همان گروه می‌نشیند */
  group: string;
  to: string;
  key: keyof Dict;
  icon: LucideIcon;
  end?: boolean;
  needs?: 'operator' | 'admin';
};

export type PanelModuleRoute = { path: string; component: ComponentType };

export type PanelModule = {
  /** شناسهٔ پایدار (‎shop‎) */
  id: string;
  /** مسیرهایی که ماژول زیرِ ‎Layout‎ ِ پنل می‌گیرد */
  routes: readonly PanelModuleRoute[];
  menu: readonly PanelModuleMenuItem[];
  /**
   *  کم‌ترین نقشی که بخش را می‌بیند. ⛔ فقط نمایش است — کدام زیرماژول برای کدام نقش را **سرورِ پنل** می‌گوید
   *  و همان را روی درها می‌سنجد (‎server/src/modules/shop/console/modules.js‎).
   */
  minRole: 'viewer' | 'operator' | 'admin';
  /** درهای سرور که ماژول به آن‌ها بند است (فقط برای سند و سنجه) */
  apiPrefixes: readonly string[];
};
