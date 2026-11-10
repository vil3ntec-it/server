//  ممیزی §۳-۴ (۱.۵۰.۷۵) — بانکِ عکسِ مرکزی: صفِ بازبینی، جست‌وجو، گزارش‌ها؛ بازبینی فقط admin + دلیل + تأیید.
import { Images } from 'lucide-react';
import ImageBankModule from '../ImageBankModule';
import { defineModule } from '../contract';

export default defineModule({ id: 'imagebank', icon: Images, component: () => <ImageBankModule /> });
