//  ۴.۳ — کاربران و نقش‌های مرکزی (جدا از کارکنانِ دکان): مدیرانِ سرورِ حساب، کاربرانِ پنل، نشست‌ها، دفتر.
import { UserCog } from 'lucide-react';
import UsersModule from '../UsersModule';
import { defineModule } from '../contract';

export default defineModule({ id: 'users', icon: UserCog, component: UsersModule, crumb: (p) => p.get('admin') });
