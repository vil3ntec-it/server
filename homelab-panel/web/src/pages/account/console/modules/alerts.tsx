//  ۴.۱۱ — هشدارها (بی سیلِ اعلان): فهرست، بررسیِ دوباره، دیدم/بستن با دلیل، و انتخابِ نوع‌ها برای رباتِ تلگرامِ مالک.
import { BellRing } from 'lucide-react';
import { AlertsTab } from '../../ConsoleOps';
import { defineModule } from '../contract';

export default defineModule({ id: 'alerts', icon: BellRing, component: () => <AlertsTab /> });
