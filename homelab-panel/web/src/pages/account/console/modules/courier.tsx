//  ۴.۷ — نظارتِ پیک (نه جایگزینِ میزِ تحویلِ دکان): صفِ کار، رویدادها، اتصال، گزارشِ کارکرد، آستانه‌ها.
import { Bike } from 'lucide-react';
import CourierModule from '../../market/CourierConsole';
import { defineModule } from '../contract';

export default defineModule({
  id: 'courier',
  icon: Bike,
  component: ({ params, setParams }) => <CourierModule params={params} setParams={setParams} />,
  crumb: (p) => p.get('shop'),
});
