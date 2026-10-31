// ---------------------------------------------------------------------------
//  💳 اشتراک‌های یک برنامه — داخلِ بخشِ خودِ همان برنامه
//
//  دستورِ صاحب محصول (۱۴۰۵/۰۸/۰۹): «بخشِ جدای اشتراک‌ها حذف شود. اشتراکِ
//  تانک‌تیل (پمپ) در بخشِ پمپ، اشتراکِ فروشگاه در بخشِ فروشگاه. هیچ داده یا
//  قابلیتی از دست نرود؛ فقط جای نمایش و مدیریت عوض شود.»
//
//  ⛔ همان صفحه‌های بخشِ کهنه (`SubscriptionsHub`، ۱.۵۰.۱۶) دست‌نخورده، فقط
//     با `fixedApp`: فهرست، دادن، تمدید، تعلیق، لغو، دائمی، حذفِ حساب
//     (`Customers` + `GrantSub` + `DeleteAccount`)، پلن و قیمت، تخفیف و
//     کمپین، کدِ VIP و آفلاین، درخواستِ خرید (فقط دکان)، بازدیدکننده،
//     نماینده، و فروش و درآمد. **رونوشتِ دومی ساخته نشد.**
//  ⛔ هر فهرست با `?app=` از **سرور** پالوده می‌آید، نه در رابط.
//  ⛔ هیچ عددی این‌جا حساب نمی‌شود — همه از سرورِ حساب (`/api/account-admin/*`).
//
//  زبانه در `?view=` می‌نشیند (لینکِ مستقیم و برگشتِ مرورگر)، و `#subs`ِ
//  پمپ‌بنزین‌ها با عوض شدنش نمی‌رود. نشانی‌ها فقط از `subsPath.ts`.
// ---------------------------------------------------------------------------
import type { ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Tabs } from '../../control/ui';
import type { AppId } from './shared';
import { viewsOf, type SubsView } from './subsPath';
import Customers from './Customers';
import Plans from './Plans';
import Discounts from './Discounts';
import VipCodes from './VipCodes';
import PurchaseRequests from './PurchaseRequests';
import Visitors from './Visitors';
import SalesReps from './SalesReps';
import Sales from './Sales';

const LABEL: Record<SubsView, string> = {
  subs: 'اشتراک‌ها',
  groups: 'سه گروه',
  plans: 'پلن‌ها و قیمت‌ها',
  discounts: 'تخفیف‌ها و کمپین',
  codes: 'کدهای اشتراک',
  requests: 'درخواست‌های خرید',
  visitors: 'بازدیدکننده‌ها',
  reps: 'نماینده‌ها',
  sales: 'فروش و درآمد',
};

export default function AppSubscriptions({ app, groups }: {
  app: AppId;
  /** «سه گروه»ِ میزِ فروشگاه (دارد / ندارد / تمام شده) — فقط وقتی داده شود زبانه دارد */
  groups?: ReactNode;
}) {
  const [params] = useSearchParams();
  const loc = useLocation();
  const navigate = useNavigate();
  const views = viewsOf(app).filter((v) => v !== 'groups' || Boolean(groups));
  const want = params.get('view') || 'subs';
  const active: SubsView = views.find((v) => v === want) || 'subs';

  const go = (id: string) => {
    //  ⚠️ بقیهٔ نشانی (`tab`ِ میزِ فروشگاه، `#subs`ِ پمپ‌بنزین‌ها) می‌ماند؛
    //  `q` فقط مالِ همان یک جست‌وجوی آمده از بیرون است.
    const next = new URLSearchParams(params);
    if (id === 'subs') next.delete('view'); else next.set('view', id);
    next.delete('q');
    const qs = next.toString();
    navigate({ search: qs ? `?${qs}` : '', hash: loc.hash });
  };

  return (
    <div className="flex flex-col gap-3">
      <Tabs tabs={views.map((id) => ({ id, label: LABEL[id] }))} active={active} onChange={go} />
      {active === 'subs' && <Customers fixedApp={app} embedded />}
      {active === 'groups' && groups}
      {active === 'plans' && <Plans fixedApp={app} />}
      {active === 'discounts' && <Discounts fixedApp={app} />}
      {active === 'codes' && <VipCodes fixedApp={app} />}
      {active === 'requests' && app === 'shop' && <PurchaseRequests />}
      {active === 'visitors' && <Visitors fixedApp={app} />}
      {active === 'reps' && <SalesReps fixedApp={app} />}
      {active === 'sales' && <Sales fixedApp={app} />}
    </div>
  );
}
