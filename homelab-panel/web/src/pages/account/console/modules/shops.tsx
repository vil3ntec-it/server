//  ۴.۲ — فروشگاه‌های عضو: جست‌وجو و صفحه‌بندیِ سمتِ سرور، پروندهٔ دکان (سلامت، حالت‌ها). ‎?shop=<id>‎ ⇒ پرونده باز.
import { Store } from 'lucide-react';
import { ShopsTab } from '../../ShopConsole';
import { defineModule } from '../contract';

export default defineModule({
  id: 'shops',
  icon: Store,
  component: ({ params, setParams }) => <ShopsTab params={params} setParams={setParams} />,
  crumb: (p) => p.get('shop'),
});
