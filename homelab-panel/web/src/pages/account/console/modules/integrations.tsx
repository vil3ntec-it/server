//  ۴.۱۳ — یکپارچه‌سازی و API: سرویس‌های بیرونی، برنامه‌های زیرِ مدیریت، کلیدِ سرویسِ پل.
import { Plug } from 'lucide-react';
import { IntegrationsTab } from '../../ShopConsole';
import { defineModule } from '../contract';

export default defineModule({ id: 'integrations', icon: Plug, component: () => <IntegrationsTab /> });
