// ---------------------------------------------------------------------------
//  ⛔ سنجهٔ ‎tsc‎: میزبانِ ساختِ جدا (‎./host.tsx‎) همان نام‌ها و همان نوع‌های میزبانِ پنل (‎../host.ts‎) را دارد.
//  نامی که در یکی باشد و در دیگری نه، یا نوعی که نخواند ⇒ ‎npm run build‎ ِ پنل سرخ (همان ‎tsc -b‎).
//  این فایل هیچ کدی به هیچ بسته‌ای نمی‌آورد (فقط ‎import type‎).
// ---------------------------------------------------------------------------
import type * as PanelHost from '../host';
import type * as StandaloneHost from './host';

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** همان نام‌های مقدار */
export const sameNames: Same<keyof typeof PanelHost, keyof typeof StandaloneHost> = true;
/** و هر مقدارِ این‌جا به جای همان نامِ پنل می‌نشیند */
export const sameTypes: typeof StandaloneHost extends typeof PanelHost ? true : false = true;
/** و نوع‌های هم‌نام (‎Load‎، ‎Tx‎ …) یکی‌اند */
export const sameTypeExports: Same<
  [PanelHost.HostApp, PanelHost.Load<unknown>, PanelHost.Tx, PanelHost.SensitiveSubmit, PanelHost.PanelModule, PanelHost.Dict, PanelHost.PanelSubNavProps],
  [StandaloneHost.HostApp, StandaloneHost.Load<unknown>, StandaloneHost.Tx, StandaloneHost.SensitiveSubmit, StandaloneHost.PanelModule, StandaloneHost.Dict, StandaloneHost.PanelSubNavProps]
> = true;
