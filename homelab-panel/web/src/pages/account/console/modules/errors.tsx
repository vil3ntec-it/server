//  ۴.۱۰ — خطاها، رخدادها و پشتیبانی: پرونده‌های رخداد (وضعیت، اولویت، یادداشت، پیوند به گفت‌وگوی پشتیبانی، CSV).
//  ‎?shop=<id>‎ ⇒ پالایشِ همان دکان.
import { FileWarning } from 'lucide-react';
import { IncidentsTab } from '../../ConsoleOps';
import { defineModule } from '../contract';

export default defineModule({
  id: 'errors',
  icon: FileWarning,
  component: ({ params }) => <IncidentsTab shop={params.get('shop') || ''} />,
  crumb: (p) => p.get('shop'),
});
