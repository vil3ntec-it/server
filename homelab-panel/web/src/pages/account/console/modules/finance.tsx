//  ۴.۵ — مالیِ مرکزی (امروز: «فروش و درآمد» ِ دکان + آن‌چه هنوز نیست، صادقانه).
import { Wallet } from 'lucide-react';
import { FinanceTab } from '../../ShopConsole';
import { defineModule } from '../contract';

export default defineModule({ id: 'finance', icon: Wallet, component: () => <FinanceTab /> });
