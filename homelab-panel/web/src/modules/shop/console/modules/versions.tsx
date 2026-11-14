//  ۴.۸ — نسخه‌ها و انتشار: کارت‌های نسخهٔ دستگاه‌ها و کانالِ آزمایشی + انتشار، سازگاری و انتشارِ مرحله‌ای (OPS-01).
import { Boxes } from 'lucide-react';
import { ReleasesTab } from '../../ConsoleOps';
import { defineModule } from '../contract';

export default defineModule({ id: 'versions', icon: Boxes, component: () => <ReleasesTab /> });
