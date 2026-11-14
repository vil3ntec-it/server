//  ۴.۱ — داشبوردِ بخش: کارتِ هر ماژول (منبع، زمان، «—»)، خلاصهٔ هشدارها، پیوندِ سریع + نمای امروزِ میز.
import { LayoutDashboard } from 'lucide-react';
import ConsoleDashboard from '../Dashboard';
import { defineModule } from '../contract';

export default defineModule({ id: 'dash', icon: LayoutDashboard, component: ConsoleDashboard });
