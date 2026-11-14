//  کدِ شاگردِ هر دکان (نمایشِ کدِ ثابت با یک کلیکِ جدا و ثبت‌شده).
import { KeyRound } from 'lucide-react';
import { Codes } from '../../ShopDesk';
import { defineModule } from '../contract';

export default defineModule({ id: 'codes', icon: KeyRound, component: () => <Codes /> });
