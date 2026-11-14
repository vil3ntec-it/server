//  دفترِ رخداد — **تنها نمای دفتر** در پنل (ممیزی ۶-۷، از ۱.۵۰.۷۴):
//    • admin ⇒ دفترِ یکپارچه (هر سه دفتر، صفحه‌بندی و پالایشِ سمتِ سرور، ‎GET /api/audit‎ که فقط admin است)؛
//    • نقش‌های دیگر ⇒ همان دو کارتِ پیشین (دفترِ سرورِ حساب + کارهای پلِ پنل) که درهایشان برایشان باز است.
//  ‎?shop=<id>‎ ⇒ همان دکان؛ ‎?source=panel|account‎ ⇒ یک دفتر. نقش فقط برای انتخابِ نما است؛ مرز در سرور است.
import { FileClock } from 'lucide-react';
import { AuditTab } from '../../ShopConsole';
import UnifiedAudit from '../UnifiedAudit';
import { defineModule } from '../contract';

export default defineModule({
  id: 'audit',
  icon: FileClock,
  component: ({ params, setParams, role }) => (role === 'admin'
    ? <UnifiedAudit params={params} setParams={setParams} />
    : <AuditTab shop={params.get('shop') || ''} />),
  crumb: (p) => p.get('shop'),
});
