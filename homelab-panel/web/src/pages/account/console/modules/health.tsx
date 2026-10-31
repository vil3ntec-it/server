//  ۴.۹ و ۴.۱۰ — سلامتِ سرورِ حساب، خطای برنامه‌ها، وارسیِ زنجیرهٔ سابقه.
import { HeartPulse } from 'lucide-react';
import { HealthTab } from '../../ShopConsole';
import { defineModule } from '../contract';

export default defineModule({ id: 'health', icon: HeartPulse, component: () => <HealthTab /> });
