//  ۴.۶ — مدیریتِ بازار (فقط سمتِ مدیریت): نمای کلی، فروشنده‌ها، سفارش‌ها، گزارش‌ها و جریمه‌ها، کمیسیون، سابقه.
//  ‎?view=<نما>‎ و پالایشِ سفارش‌ها در نشانی (لینکِ مستقیم و برگشتِ مرورگر).
import { ShoppingBag } from 'lucide-react';
import MarketModule from '../../market/MarketConsole';
import { defineModule } from '../contract';

export default defineModule({
  id: 'market',
  icon: ShoppingBag,
  component: ({ params, setParams }) => <MarketModule params={params} setParams={setParams} />,
  crumb: (p) => p.get('shop'),
});
