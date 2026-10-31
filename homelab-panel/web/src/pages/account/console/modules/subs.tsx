//  ۴.۴ — اشتراک و مجوزِ دکان (همهٔ کارهای بخشِ کهنهٔ «اشتراک‌ها»، با بخشِ ثابتِ دکان) + سه گروه.
import { BadgeCheck } from 'lucide-react';
import { ShopSubs } from '../../ShopDesk';
import { defineModule } from '../contract';

export default defineModule({
  id: 'subs',
  icon: BadgeCheck,
  component: ({ params }) => <ShopSubs params={params} />,
  crumb: (p) => p.get('view'),
});
