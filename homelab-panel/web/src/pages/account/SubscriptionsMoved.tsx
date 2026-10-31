// ---------------------------------------------------------------------------
//  ↪️ نشانی‌های کهنهٔ بخشِ جدای «اشتراک‌ها» — نه ۴۰۴، نه صفحهٔ خالی
//
//  بخشِ جدای اشتراک‌ها به دستورِ صاحب محصول برداشته شد (۱۴۰۵/۰۸/۰۹)؛ اشتراکِ
//  پمپ در «پمپ‌بنزین‌ها» و اشتراکِ فروشگاه در «فروشگاه‌ها» است
//  (`AppSubscriptions.tsx`). ولی `/subscriptions` و `/customers` و `/plans` و
//  `/vip-codes` و `/discounts` و `/visitors` در نشانک‌ها، پیام‌ها و تاریخچهٔ
//  مرورگر مانده‌اند:
//
//    برنامه معلوم (`?app=` یا زبانه‌ای که فقط مالِ یکی است) ⇒ مستقیم همان‌جا
//    برنامه نامعلوم ⇒ همین صفحهٔ کوچک: «کدام برنامه؟» — با همان زبانه و جست‌وجو
//
//  ⛔ این صفحه در منو نیست و هیچ کاری خودش نمی‌کند؛ فقط راه را نشان می‌دهد.
// ---------------------------------------------------------------------------
import { Navigate, useLocation } from 'react-router-dom';
import { Fuel, Store } from 'lucide-react';
import { PageHead } from './shared';
import GoTo from './GoTo';
import { legacySubsTarget, subsPath } from './subsPath';

export default function SubscriptionsMoved({ defaultView = 'subs' }: { defaultView?: string }) {
  const loc = useLocation();
  const target = legacySubsTarget(loc.search, defaultView);
  if (target) return <Navigate to={target} replace />;

  const p = new URLSearchParams(loc.search);
  const view = p.get('tab') || defaultView;
  const q = p.get('q') || '';

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <PageHead
        title="اشتراک‌ها حالا در بخشِ خودِ هر برنامه‌اند"
        sub="بخشِ جدای «اشتراک‌ها» برداشته شد؛ همهٔ کارهایش — دیدن، دادن، تمدید، لغو، پلن، تخفیف، کدها و فروش — در بخشِ همان برنامه است. کدام؟"
      />
      <GoTo
        icon={<Fuel size={18} />}
        title="اشتراک‌های پمپ‌بنزین"
        hint="پمپ‌بنزین‌ها ← 💳 اشتراک‌ها"
        to={subsPath('pump', view, q)}
        cta="رفتن به پمپ‌بنزین‌ها"
      />
      <GoTo
        icon={<Store size={18} />}
        title="اشتراک‌های فروشگاه"
        hint="فروشگاه‌ها ← اشتراک‌ها"
        to={subsPath('shop', view, q)}
        cta="رفتن به فروشگاه‌ها"
      />
    </div>
  );
}
