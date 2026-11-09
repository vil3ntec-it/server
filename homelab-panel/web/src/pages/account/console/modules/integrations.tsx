//  ۴.۱۳ — یکپارچه‌سازی و API: سرویس‌های بیرونی، کلیدِ سرویسِ پل + فعالیت، اعتبارنامه‌ها (فقط «هست/نیست»)، وب‌هوک، قرارداد.
import { Plug } from 'lucide-react';
import { IntegrationsOpsTab } from '../../ConsoleOps';
import { defineModule } from '../contract';

export default defineModule({ id: 'integrations', icon: Plug, component: () => <IntegrationsOpsTab /> });
