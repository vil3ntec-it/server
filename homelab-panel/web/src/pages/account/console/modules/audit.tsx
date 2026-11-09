//  دفترِ رخداد: سابقهٔ سرورِ حساب (پالایشِ دکان سمتِ سرور) + دفترِ پنل با صفحه‌بندی. ‎?shop=<id>‎ ⇒ همان دکان.
import { FileClock } from 'lucide-react';
import { AuditTab } from '../../ShopConsole';
import { defineModule } from '../contract';

export default defineModule({
  id: 'audit',
  icon: FileClock,
  component: ({ params }) => <AuditTab shop={params.get('shop') || ''} />,
  crumb: (p) => p.get('shop'),
});
