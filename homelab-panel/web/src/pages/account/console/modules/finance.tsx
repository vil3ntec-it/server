//  ۴.۵ — مالیِ مرکزی: درآمد و گزارش، دفترِ پرداخت، سندِ اصلاحی، بدهی، در انتظار، مغایرت، تاریخچه، CSV + «فروش و درآمد» ِ پیشین.
//  ‎?fin=<زیرزبانه>‎ در نشانی (‎ShopFinance‎ خودش می‌خواندش و ‎tab=finance‎ را نگه می‌دارد).
import { Wallet } from 'lucide-react';
import { FinanceTab } from '../../ShopConsole';
import { defineModule } from '../contract';

export default defineModule({ id: 'finance', icon: Wallet, component: () => <FinanceTab /> });
