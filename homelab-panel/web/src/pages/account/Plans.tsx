// ---------------------------------------------------------------------------
//  💳 پلن‌ها و قیمت‌ها — بندِ ۱۱.۳.۲
//
//  ⛔ **هیچ عددِ قیمتی در این فایل نیست و نباید بیاید.** هر عددی که دیده
//     می‌شود از `/api/account-admin/plans?app=…` آمده و هر عددی که مدیر
//     تایپ کند مستقیم به سرورِ حساب می‌رود. اگر روزی قیمتی این‌جا نوشته
//     شود، پنل و برنامه دو عددِ جدا نشان می‌دهند — مستقیم روی پول.
//  ⛔ **هر پرس‌وجو `app` را همراه دارد.** «m1»ی دکان و «m1»ی پمپ دو ردیفِ
//     جدا با دو ارزند؛ یک بار همین شرط جا افتاد و عوض کردنِ قیمتِ دکان
//     قیمتِ پمپ را هم عوض کرد.
//  ⚠️ قیمتِ **روزِ خرید** روی خودِ اشتراک می‌نشیند، پس عوض کردنِ قیمتِ یک
//     پلن اشتراک‌های فروخته‌شده را دست نمی‌زند — و هر تغییرِ واقعی یک ردیف
//     در تاریخچهٔ قیمت می‌گذارد.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { History, Tag } from 'lucide-react';

import { api } from '../../api';
import { Badge, Card, Empty, Modal, Skeleton, toast } from '../../components/ui';
import { ActionButton, Cell, Notice, Row, Table } from '../../control/ui';
import { AppPicker, CloudProblem, PageHead, day, fa, money, toLocalInput, fromLocalInput, useLoad, type AppId } from './shared';
import type { Plan, PriceChange } from './types';

type PlansOut = { plans: Plan[]; app: string; config: Record<string, string> };

const UNIT_LABEL: Record<string, string> = { day: 'روزه', week: 'هفته‌ای', month: 'ماهه', year: 'ساله' };

export default function Plans() {
  const [app, setApp] = useState<AppId>('shop');
  const [edit, setEdit] = useState<Plan | null>(null);
  const [discount, setDiscount] = useState<Plan | null>(null);

  const plans = useLoad<PlansOut>(`/api/account-admin/plans?app=${app}`, [app], 'plans');
  const history = useLoad<{ history: PriceChange[] }>(`/api/account-admin/price-history?app=${app}`, [app]);
  const currency = app === 'pump' ? (plans.data?.config?.pump_currency || 'USD') : (plans.data?.config?.currency || 'AFN');

  const reload = async () => { await Promise.all([plans.reload(), history.reload()]); };

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title="پلن‌ها و قیمت‌ها"
        sub="قیمت‌ها فقط از سرورِ حساب — همان عددی که برنامه، پورتال و پنل می‌خوانند"
        actions={<AppPicker value={app} onChange={(v) => setApp(v as AppId)} />}
      />

      {plans.error && <CloudProblem code={plans.code} message={plans.error} />}

      <Notice tone="info">
        قیمتِ روزِ خرید روی خودِ اشتراک می‌نشیند؛ عوض کردنِ قیمتِ یک پلن روی اشتراک‌های فروخته‌شده اثری ندارد
        و مشتری‌های فعلی تا پایانِ دوره‌شان با قیمتِ قبلی می‌مانند. تخفیف کنارِ قیمت می‌نشیند، نه به‌جایش —
        با تمام شدنِ مهلت، خودِ قیمت برمی‌گردد.
      </Notice>

      <Card title="پلن‌ها" icon={<Tag className="h-4 w-4" />}>
        {plans.busy && !plans.data ? (
          <Skeleton rows={4} />
        ) : (plans.data?.plans.length || 0) === 0 ? (
          <Empty title="پلنی برای این بخش ثبت نشده" />
        ) : (
          <Table head={['کد', 'عنوان', 'مدت', 'قیمت', 'تخفیف', 'دستگاه', 'حال', '']}>
            {(plans.data?.plans || []).map((p) => (
              <Row key={p.code}>
                <Cell mono>{p.code}</Cell>
                <Cell>
                  <span className="font-medium text-ink">{p.title}</span>
                  {p.badge && <span className="ms-1.5"><Badge tone="info">{p.badge}</Badge></span>}
                </Cell>
                <Cell>{fa(p.amount)} {UNIT_LABEL[p.unit] || p.unit}</Cell>
                <Cell className="tnum">
                  {money(p.price, currency)}
                  {p.discount && <s className="ms-1.5 text-[11px] text-ink-muted">{fa(p.fullPrice)}</s>}
                </Cell>
                <Cell>
                  {p.discount
                    ? <Badge tone="good">٪{fa(p.discount.percent)}{p.discount.until ? ` تا ${day(p.discount.until)}` : ''}</Badge>
                    : <span className="text-ink-muted">—</span>}
                </Cell>
                <Cell className="tnum">{fa(p.maxDevices)}</Cell>
                <Cell><Badge tone={p.active ? 'good' : 'neutral'}>{p.active ? 'فعال' : 'خاموش'}</Badge></Cell>
                <Cell>
                  <div className="flex gap-1">
                    <button className="btn btn-sm" onClick={() => setEdit(p)}>ویرایش</button>
                    <button className="btn btn-sm" onClick={() => setDiscount(p)}>تخفیف</button>
                  </div>
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>

      <Card title="تاریخچهٔ قیمت" icon={<History className="h-4 w-4" />}>
        {history.busy && !history.data ? (
          <Skeleton rows={3} />
        ) : (history.data?.history.length || 0) === 0 ? (
          <Empty title="هنوز قیمتی عوض نشده" hint="هر بار که عددِ یک پلن واقعاً عوض شود، یک ردیف این‌جا می‌نشیند." />
        ) : (
          <Table head={['پلن', 'از', 'به', 'چه کسی', 'کِی']}>
            {(history.data?.history || []).map((h) => (
              <Row key={h.id}>
                <Cell mono>{h.plan}</Cell>
                <Cell className="tnum">{h.prevPrice == null ? '—' : money(h.prevPrice, h.currency)}</Cell>
                <Cell className="tnum">{money(h.price, h.currency)}</Cell>
                <Cell mono>{h.changedBy || '—'}</Cell>
                <Cell>{day(h.changedAt)}</Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>

      {edit && <EditPlan app={app} plan={edit} onClose={() => setEdit(null)} onDone={reload} />}
      {discount && <EditDiscount app={app} plan={discount} onClose={() => setDiscount(null)} onDone={reload} />}
    </div>
  );
}

function EditPlan({ app, plan, onClose, onDone }: { app: AppId; plan: Plan; onClose: () => void; onDone: () => Promise<void> }) {
  const [title, setTitle] = useState(plan.title);
  const [amount, setAmount] = useState(String(plan.amount));
  const [unit, setUnit] = useState(plan.unit);
  const [price, setPrice] = useState(String(plan.fullPrice));
  const [maxDevices, setMaxDevices] = useState(String(plan.maxDevices));
  const [badge, setBadge] = useState(plan.badge || '');
  const [active, setActive] = useState(plan.active);

  return (
    <Modal
      open
      onClose={onClose}
      title={`پلنِ «${plan.title}» — ${plan.code}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>انصراف</button>
          <ActionButton
            className="btn btn-primary"
            busyLabel="…"
            onClick={async () => {
              try {
                await api(`/api/account-admin/plans/${plan.code}?app=${app}`, {
                  method: 'PATCH',
                  body: { title, amount: Number(amount), unit, price: Number(price), maxDevices: Number(maxDevices), badge, active },
                });
                toast('پلن ذخیره شد');
                onClose();
                await onDone();
              } catch (e) {
                toast(e instanceof Error ? e.message : 'نشد', 'bad');
              }
            }}
          >
            ذخیره
          </ActionButton>
        </>
      }
    >
      <p className="mb-3 text-xs text-ink-soft">
        عددِ قیمت همان چیزی است که برنامه‌ها، پورتالِ مشتری و صفحهٔ خرید از سرور می‌خوانند.
        عوض کردنش اشتراک‌های فروخته‌شده را دست نمی‌زند و یک ردیف در تاریخچهٔ قیمت می‌گذارد.
      </p>
      <label className="label">عنوان</label>
      <input className="input mb-3 w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="label">مدت</label>
          <input className="input w-full" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label className="label">واحد</label>
          <select className="input w-full" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {['day', 'week', 'month', 'year'].map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
          </select>
        </div>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="label">قیمت (بی تخفیف)</label>
          <input className="input w-full" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div>
          <label className="label">بیشینهٔ دستگاه</label>
          <input className="input w-full" inputMode="numeric" value={maxDevices} onChange={(e) => setMaxDevices(e.target.value)} />
        </div>
      </div>
      <label className="label">نشان (اختیاری)</label>
      <input className="input mb-3 w-full" value={badge} onChange={(e) => setBadge(e.target.value)} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        در فهرستِ خریدِ برنامه‌ها دیده شود
      </label>
    </Modal>
  );
}

function EditDiscount({ app, plan, onClose, onDone }: { app: AppId; plan: Plan; onClose: () => void; onDone: () => Promise<void> }) {
  const [percent, setPercent] = useState(String(plan.discount?.percent ?? ''));
  const [label, setLabel] = useState(plan.discount?.label ?? '');
  const [until, setUntil] = useState(toLocalInput(plan.discount?.until ?? null));

  return (
    <Modal
      open
      onClose={onClose}
      title={`تخفیفِ پلنِ «${plan.title}»`}
      footer={
        <>
          <button className="btn" onClick={onClose}>انصراف</button>
          <ActionButton
            className="btn"
            busyLabel="…"
            onClick={async () => {
              try {
                await api(`/api/account-admin/plans/${plan.code}/discount?app=${app}`, { method: 'DELETE' });
                toast('تخفیف برداشته شد');
                onClose();
                await onDone();
              } catch (e) {
                toast(e instanceof Error ? e.message : 'نشد', 'bad');
              }
            }}
          >
            برداشتنِ تخفیف
          </ActionButton>
          <ActionButton
            className="btn btn-primary"
            busyLabel="…"
            onClick={async () => {
              try {
                await api(`/api/account-admin/plans/${plan.code}/discount?app=${app}`, {
                  method: 'PUT',
                  body: { percent: Number(percent) || 0, label, until: fromLocalInput(until) },
                });
                toast('تخفیف ثبت شد');
                onClose();
                await onDone();
              } catch (e) {
                toast(e instanceof Error ? e.message : 'نشد', 'bad');
              }
            }}
          >
            ثبت
          </ActionButton>
        </>
      }
    >
      <p className="mb-3 text-xs text-ink-soft">
        قیمتِ اصلی دست نمی‌خورد؛ تخفیف کنارش می‌نشیند و با تمام شدنِ مهلت خودبه‌خود برمی‌گردد.
      </p>
      <label className="label">درصد</label>
      <input className="input mb-3 w-full" inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value)} />
      <label className="label">برچسب (مثلاً «نوروز»)</label>
      <input className="input mb-3 w-full" value={label} onChange={(e) => setLabel(e.target.value)} />
      <label className="label">تا تاریخ (خالی = بی مهلت)</label>
      <input className="input w-full" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
    </Modal>
  );
}
