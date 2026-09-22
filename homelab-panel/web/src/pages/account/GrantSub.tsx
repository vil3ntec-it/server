// ---------------------------------------------------------------------------
//  💳 «اشتراک بده» — یک دکمه، سه قدم
//
//  خواستهٔ صریحِ صاحب سامانه (۱۴۰۵/۰۷/۰۸): «از سرورِ سری به حسابِ مورد نظر
//  یا ایمیلِ مد نظر اشتراک بدم و ثبت هم بشه، و با آسانی دکمهٔ دادنِ اشتراک
//  داشته باشه که بزنم، اشتراک‌ها رو نشونم بده، و یکی رو بزنم و برای حساب
//  بفرستم و برنامه اونو دریافت کنه و قفل‌ها باز بشه.»
//
//  ── چرا این صفحه لازم بود ────────────────────────────────────────────
//  پنل از قبل **تمدید · تعلیق · لغو · دائمی · تخفیف · افزونه** را داشت —
//  همه روی اشتراکی که **از قبل بود**. راهی برای دادنِ اشتراکِ **اول** نبود:
//  فهرستِ «مشتری‌ها» از `sales/subscriptions` می‌آید، یعنی فقط حساب‌هایی که
//  ردیفِ اشتراک دارند. پس حسابِ تازه — همان کسی که می‌خواهیم اشتراک بدهیم
//  — در هیچ فهرستی دیده نمی‌شد.
//
//  ── قاعده‌ها ──────────────────────────────────────────────────────────
//  ⛔ هیچ عددِ قیمتی و هیچ نامِ پلنی این‌جا نوشته نشده. فهرستِ پلن از
//     `/api/account-admin/plans?app=…` می‌آید و همان کدِ پلن به سرورِ حساب
//     برمی‌گردد.
//  ⛔ **مدت و قابلیت‌ها هم فرستاده نمی‌شوند.** `subs.grant` روی سرورِ حساب
//     با داشتنِ `plan` خودش مدت را از `amount`/`unit`ِ همان پلن و فهرستِ
//     قابلیت‌ها را از خودِ پلن برمی‌دارد. فرستادنِ `days`ِ دستی همان باگی
//     بود که «استاندارد دادم، وی‌آی‌پی گرفت» می‌ساخت.
//  ⛔ پیش از انجام، **پیامدش** گفته می‌شود، نه «مطمئنید؟» — بندِ ۱۶ پرامپت.
// ---------------------------------------------------------------------------
import { useMemo, useState } from 'react';
import { CreditCard, Search } from 'lucide-react';

import { api } from '../../api';
import { Badge, Empty, Modal, Skeleton, toast } from '../../components/ui';
import { Cell, Notice, Row, Table } from '../../control/ui';
import {
  APP_LABEL, AppPicker, CloudProblem, STATUS_LABEL, day, fa, money, useLoad, type AppId,
} from './shared';
import type { Plan } from './types';

/** یک گیرندهٔ ممکن — پمپ یا دکان، با یا بی اشتراکِ فعلی. */
type Target = {
  app: AppId;
  tenantId: string;
  tenantName: string;
  code: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  createdAt: number;
  subscriptionId: string;
  plan: string;
  status: string;
  endsAt: number;
};

type TargetsOut = { app: AppId; items: Target[]; total: number };
type PlansOut = { plans: Plan[]; app: string; config: Record<string, string> };

const UNIT_LABEL: Record<string, string> = { day: 'روز', week: 'هفته', month: 'ماه', year: 'سال' };

/** «۱ ماه» · «۶ ماه» — از خودِ پلن، نه از حدس. */
function spanOf(p: Plan): string {
  if (!p.amount || !p.unit) return '—';
  return `${fa(p.amount)} ${UNIT_LABEL[p.unit] || p.unit}`;
}

export default function GrantSub({ open, onClose, onDone, startApp, startQuery }: {
  open: boolean;
  onClose: () => void;
  onDone: () => Promise<void> | void;
  startApp?: AppId;
  /**
   *  جست‌وجوی آماده — وقتی از ردیفِ یک حسابِ بی‌اشتراک باز می‌شود، همان
   *  ایمیل این‌جا می‌نشیند تا مدیر دوباره دنبالش نگردد.
   *
   *  ⚠️ فقط مقدارِ **آغازین** است: صفحه با `key` از نو ساخته می‌شود، پس
   *  هیچ `useEffect`ی لازم نیست و تایپِ خودِ کاربر هیچ‌وقت زیرِ دستش عوض
   *  نمی‌شود.
   */
  startQuery?: string;
}) {
  const [app, setApp] = useState<AppId>(startApp === 'pump' ? 'pump' : 'shop');
  const [q, setQ] = useState(startQuery || '');
  const [picked, setPicked] = useState<Target | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  /*
   *  ⚠️ جست‌وجو دستِ **سرورِ حساب** است، نه فیلترِ محلی: فهرستِ کاملِ
   *  پمپ‌ها و دکان‌ها می‌تواند هزاران ردیف باشد و آوردنِ همه‌اش برای یک
   *  کادرِ جست‌وجو همان «همهٔ ردیف‌ها را بخوان» است.
   *
   *  ⚠️ و `q` در کلیدِ `useLoad` هست، پس هر حرف یک درخواست می‌زند — که
   *  برای فهرستِ کوتاهِ مدیر درست است، ولی اگر روزی سنگین شد این‌جا
   *  جای گذاشتنِ ترمز است، نه سمتِ سرور.
   */
  const targets = useLoad<TargetsOut>(
    open ? `/api/account-admin/grant-targets?app=${app}&q=${encodeURIComponent(q.trim())}` : null,
    [open, app, q]);

  const plans = useLoad<PlansOut>(
    open ? `/api/account-admin/plans?app=${app}` : null, [open, app]);

  const currency = app === 'pump'
    ? (plans.data?.config?.pump_currency || 'USD')
    : (plans.data?.config?.currency || 'AFN');

  //  ⛔ «رایگان» جایی نشان داده نمی‌شود — قاعدهٔ ۱۴۰۵/۰۶/۳۰.
  const sellable = useMemo(
    () => (plans.data?.plans || []).filter((p) => p.active && !/^free$/i.test(p.code)),
    [plans.data]);

  const reset = () => { setPicked(null); setPlan(null); setNote(''); setQ(''); };

  const close = () => { reset(); onClose(); };

  const send = async () => {
    if (!picked || !plan) return;
    setBusy(true);
    try {
      /*
       *  ⛔ فقط `tenantId` و `plan` — نه `days`، نه `features`.
       *  مدت از `amount`/`unit`ِ همان پلن و قابلیت‌ها از خودِ پلن
       *  درمی‌آیند (`subs.grant`). فرستادنِ `days`ِ دستی فهرستِ قابلیت‌ها
       *  را خالی می‌گذاشت و خالی یعنی «پلنِ کامل».
       */
      await api(`/api/account-admin/subs/${picked.app}/grant`, {
        body: { tenantId: picked.tenantId, plan: plan.code, note: note.trim() || undefined },
      });
      toast(`اشتراکِ «${plan.title}» برای ${picked.tenantName || picked.ownerName} ثبت شد`);
      reset();
      onClose();
      await onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'نشد', 'bad');
    } finally {
      setBusy(false);
    }
  };

  const who = picked ? (picked.tenantName || picked.ownerName || picked.tenantId) : '';

  return (
    <Modal
      open={open}
      onClose={close}
      wide
      title={<span className="inline-flex items-center gap-2"><CreditCard className="h-4 w-4" /> دادنِ اشتراک</span>}
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-ink-muted">
            {picked && plan
              ? 'با زدنِ «ثبت»، اشتراک همان لحظه روی سرورِ حساب می‌نشیند.'
              : 'اول حساب را پیدا کنید، بعد پلن را بزنید.'}
          </p>
          <div className="flex gap-2">
            <button className="btn" onClick={close}>بستن</button>
            <button
              className="btn btn-primary"
              disabled={!picked || !plan || busy}
              onClick={send}
            >
              {busy ? 'در حال ثبت…' : 'ثبت اشتراک'}
            </button>
          </div>
        </div>
      )}
    >
      <div className="flex flex-col gap-4">
        {/* ── قدمِ ۱: کدام حساب ───────────────────────────────────── */}
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-ink">۱) حساب</span>
            <span className="grow" />
            <AppPicker value={app} onChange={(v) => { setApp(v as AppId); reset(); }} />
          </div>

          <label className="relative mb-2 block">
            <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted ltr:left-3 rtl:right-3" />
            <input
              className="input w-full ltr:pl-9 rtl:pr-9"
              placeholder="ایمیل، نام، یا کدِ پمپ…"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPicked(null); }}
            />
          </label>

          {targets.error && <CloudProblem code={targets.code} message={targets.error} onRetry={targets.reload} />}

          {targets.busy && !targets.data ? (
            <Skeleton rows={3} />
          ) : (targets.data?.items.length || 0) === 0 ? (
            <Empty
              title="حسابی با این جست‌وجو نیست"
              hint="بخشِ دیگری را ببینید، یا بخشی از ایمیل را بزنید."
            />
          ) : (
            <div className="max-h-56 overflow-auto rounded-xl border border-line">
              <Table head={['حساب', 'صاحب', 'اشتراکِ فعلی', '']}>
                {targets.data!.items.map((t) => {
                  const mine = picked?.tenantId === t.tenantId;
                  return (
                    <Row key={`${t.app}-${t.tenantId}`} onClick={() => setPicked(t)}>
                      <Cell>
                        <p className="font-medium text-ink">{t.tenantName || '—'}</p>
                        <p className="text-[11px] text-ink-muted">
                          {[APP_LABEL[t.app], t.code].filter(Boolean).join(' · ')}
                        </p>
                      </Cell>
                      <Cell>
                        <p className="text-ink">{t.ownerName || '—'}</p>
                        {/* ⚠️ ایمیل همان چیزی است که صاحبِ سامانه با آن می‌گردد */}
                        <p className="text-[11px] text-ink-muted">{t.ownerEmail || 'بی ایمیل'}</p>
                      </Cell>
                      <Cell>
                        <Badge tone={t.status === 'active' ? 'good' : t.status === 'trial' ? 'info' : 'neutral'}>
                          {STATUS_LABEL[t.status] || t.status}
                        </Badge>
                        {t.endsAt > 0 && (
                          <p className="text-[11px] text-ink-muted">تا {day(t.endsAt)}</p>
                        )}
                      </Cell>
                      <Cell>
                        {mine
                          ? <Badge tone="good">برگزیده ✓</Badge>
                          : <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); setPicked(t); }}>انتخاب</button>}
                      </Cell>
                    </Row>
                  );
                })}
              </Table>
            </div>
          )}
        </div>

        {/* ── قدمِ ۲: کدام پلن ────────────────────────────────────── */}
        <div>
          <p className="mb-2 text-xs font-medium text-ink">۲) پلن</p>

          {plans.error && <CloudProblem code={plans.code} message={plans.error} onRetry={plans.reload} />}

          {plans.busy && !plans.data ? (
            <Skeleton rows={2} />
          ) : sellable.length === 0 ? (
            <Empty title="پلنِ فعالی برای این بخش ثبت نشده" hint="در «پلن‌ها و قیمت‌ها» یکی را فعال کنید." />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {sellable.map((p) => {
                const mine = plan?.code === p.code;
                return (
                  <button
                    key={p.code}
                    onClick={() => setPlan(p)}
                    className={`rounded-xl border p-3 text-start transition ${
                      mine ? 'border-accent bg-accent/10' : 'border-line hover:border-accent/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink">{p.title || p.code}</span>
                      {p.badge && <Badge tone="info">{p.badge}</Badge>}
                    </div>
                    <p className="mt-1 text-sm tnum text-ink">{money(p.price, currency)}</p>
                    <p className="text-[11px] text-ink-muted">مدت: {spanOf(p)}</p>
                    {/* ⚠️ فهرستِ قابلیت‌ها از خودِ پلن — نه از این صفحه */}
                    <p className="mt-1 text-[11px] text-ink-muted">
                      {p.features.length > 0
                        ? `${fa(p.features.length)} قابلیت`
                        : 'پلنِ کامل (فهرستی ندارد)'}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── قدمِ ۳: پیامد، و یادداشت ───────────────────────────── */}
        {picked && plan && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-ink">۳) چه می‌شود</p>
            <Notice tone="info">
              اشتراکِ «{plan.title || plan.code}» به نامِ <b>{who}</b> ثبت می‌شود
              {picked.ownerEmail ? <> (ایمیلِ صاحب: {picked.ownerEmail})</> : null}.
              مدت — {spanOf(plan)} — و فهرستِ قابلیت‌ها از خودِ همان پلن برداشته می‌شود، نه از این صفحه.
              {picked.endsAt > 0 && picked.status === 'active' && (
                <> اشتراکِ فعلی تا {day(picked.endsAt)} اعتبار دارد، پس این مدت <b>از همان تاریخ</b> جلو می‌رود، نه از امروز.</>
              )}
              {' '}برنامهٔ مشتری آن را در همان یک‌دو دقیقهٔ بعد خودش می‌گیرد و قفل‌ها باز می‌شوند — کدی لازم نیست.
            </Notice>
            <input
              className="input w-full"
              placeholder="یادداشت (اختیاری) — مثلاً «نقدی گرفته شد»"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
