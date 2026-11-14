// ---------------------------------------------------------------------------
//  🏪 بخشِ «فروشگاه» — شناسنامهٔ ماژول (مسیر، منو، نقش). شرح: ‎docs/SHOP-MODULE-fa.md‎
//
//  پنل این را از ‎modules/registry.ts‎ می‌خواند؛ ساختِ جدا (‎standalone/‎) هم همین را. درونِ بخش (۱۵ زیرماژولِ
//  ‎?tab=‎) را پوسته از سرور می‌گیرد — ‎console/registry.ts‎ و ‎server/src/modules/shop/console/modules.js‎.
// ---------------------------------------------------------------------------
import { Store } from 'lucide-react';
import ConsoleShell from './console/Shell';
import { SHOP_HOME, type PanelModule } from './host';

const shop: PanelModule = {
  id: 'shop',
  routes: [{ path: SHOP_HOME, component: ConsoleShell }],
  //  همان آیتمِ پیشینِ «هر روز» (بینِ پمپ‌بنزین‌ها و کدها)، همان کلید و نشانه
  menu: [{ group: 'daily', to: SHOP_HOME, key: 'navShops', icon: Store }],
  minRole: 'viewer',
  apiPrefixes: ['/api/account-admin'],
};

export default shop;
