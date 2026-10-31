//  ۴.۸ — نسخه‌ها و انتشار (نسخهٔ دستگاه‌ها، نصب/خرابیِ هر نسخه، کانالِ آزمایشی فقط admin).
import { Boxes } from 'lucide-react';
import { VersionsTab } from '../../ShopConsole';
import { defineModule } from '../contract';

export default defineModule({ id: 'versions', icon: Boxes, component: () => <VersionsTab /> });
