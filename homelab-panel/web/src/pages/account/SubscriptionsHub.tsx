// ---------------------------------------------------------------------------
//  💳 اشتراک‌ها — یک بخش برای همهٔ اشتراک‌ها، از هر برنامه
//
//  خواستهٔ صاحب سامانه (۱۴۰۵/۰۷/۱۳): «همهٔ اشتراک‌ها داخلِ یک بخش داده بشه؛
//  توی بخش‌های دیگه وقتی بزنی مستقیم بیاد توی همین بخش؛ هر برنامه سیستمِ
//  خودشو داشته باشه؛ دیدنِ اشتراک‌ها، تغییرِ قیمت، لغو یا تمدید یا دلخواه
//  چند وقته به طرف داد.»
//
//  ⛔ پس «مشتری‌ها و اشتراک‌ها» (/customers) و «پلن‌ها و تخفیف‌ها» (/plans)
//     یکی شدند: همان صفحه‌ها، دست‌نخورده، داخلِ تب‌های همین صفحه. نشانی‌های
//     قدیمی به همان تب می‌روند (App.tsx). دو درِ منو برای یک موضوع، همان
//     سردرگمیِ گامِ ۴ی ریمیک بود.
//  ⛔ **هیچ عددی این‌جا حساب نمی‌شود** — همه از سرورِ حساب (`/api/account-admin/*`).
//
//  `?app=pump|shop` از نشانی می‌آید (پمپ‌بنزین‌ها و فروشگاه‌ها با آن می‌رسند)
//  و به هر تب داده می‌شود؛ `?tab=` هم برای لینکِ مستقیم و برگشتِ مرورگر.
// ---------------------------------------------------------------------------
import { useSearchParams } from 'react-router-dom';
import { Tabs } from '../../control/ui';
import { APP_LABEL, PageHead, type AppId } from './shared';
import Customers from './Customers';
import Plans from './Plans';
import Discounts from './Discounts';
import VipCodes from './VipCodes';
import PurchaseRequests from './PurchaseRequests';
import Visitors from './Visitors';

const TABS = [
  { id: 'subs', label: 'اشتراک‌ها' },
  { id: 'plans', label: 'پلن‌ها و قیمت‌ها' },
  { id: 'discounts', label: 'تخفیف‌ها و کمپین' },
  { id: 'codes', label: 'کدهای اشتراک' },
  { id: 'requests', label: 'درخواست‌های خرید' },
  { id: 'visitors', label: 'بازدیدکننده‌ها' },
];

export default function SubscriptionsHub() {
  const [params, setParams] = useSearchParams();
  const wanted = params.get('tab') || 'subs';
  const active = TABS.some((t) => t.id === wanted) ? wanted : 'subs';
  const app = params.get('app');
  const appLabel = app === 'pump' || app === 'shop' ? APP_LABEL[app as AppId] : '';

  const go = (id: string) => {
    //  ⚠️ بخش (`app`) با عوض شدنِ تب نمی‌رود: کسی که از «پمپ‌بنزین‌ها» آمده
    //  در «پلن‌ها» هم پلنِ پمپ را می‌خواهد، نه پلنِ دکان.
    const next = new URLSearchParams();
    if (id !== 'subs') next.set('tab', id);
    if (app) next.set('app', app);
    setParams(next);
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3">
      <PageHead
        title={appLabel ? `اشتراک‌ها — ${appLabel}` : 'اشتراک‌ها'}
        sub="همهٔ اشتراک‌های دکان و پمپ در یک جا: دیدن، دادن با مدتِ دلخواه، تمدید، لغو، قیمتِ پلن‌ها، کدها و درخواست‌ها"
      />
      <Tabs tabs={TABS} active={active} onChange={go} />
      {active === 'subs' && <Customers key={app || 'both'} />}
      {active === 'plans' && <Plans />}
      {active === 'discounts' && <Discounts />}
      {active === 'codes' && <VipCodes />}
      {active === 'requests' && <PurchaseRequests />}
      {active === 'visitors' && <Visitors />}
    </div>
  );
}
