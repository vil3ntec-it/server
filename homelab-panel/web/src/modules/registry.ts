// ---------------------------------------------------------------------------
//  فهرستِ ماژول‌های پنل — هر ماژول **یک ورود** این‌جا (شرح: ‎docs/SHOP-MODULE-fa.md‎).
//
//  ⛔ تنها فایلی بیرون از ‎modules/<id>/‎ که از درونِ ماژول وارد می‌کند همین است (سنجه: ‎server/test/module-boundary.mjs‎).
//  برداشتنِ یک ماژول از پنل = پاک کردنِ همان ورود (و پوشه‌اش)؛ مسیر و منویش با هم می‌روند.
// ---------------------------------------------------------------------------
import type { PanelModule } from './types';
import shop from './shop';

/** ترتیب = ترتیبِ نشستن در گروهِ منو. */
export const PANEL_MODULES: readonly PanelModule[] = [shop];

/** آیتم‌های منوی ماژول‌ها برای یک گروهِ ‎Layout‎ — سرِ همان جایی که ‎Layout‎ گذاشته. */
export const moduleMenu = (group: string) => PANEL_MODULES.flatMap((m) => m.menu.filter((i) => i.group === group));
