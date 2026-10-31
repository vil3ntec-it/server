//  ۴.۹ — سلامتِ سیستم: سنجه‌های خودِ پنل + سرورِ حساب، خطای برنامه‌ها، وارسیِ زنجیرهٔ سابقه.
import { HeartPulse } from 'lucide-react';
import { OpsHealthTab } from '../../ConsoleOps';
import { defineModule } from '../contract';

export default defineModule({ id: 'health', icon: HeartPulse, component: () => <OpsHealthTab /> });
