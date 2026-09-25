// ---------------------------------------------------------------------------
//  👤 مشتری‌ها و اشتراک‌ها — بندهای ۱۱.۱ · ۱۱.۳.۱ · ۱۱.۴ · ۱۱.۵
//
//  یک فهرست برای هر دو بخش، چون «یک نفر هم دکان دارد هم پمپ» (سناریوی ۱۳)
//  و صاحبِ سامانه باید هر دو را کنارِ هم ببیند.
//
//  ⛔ هیچ چیزی این‌جا ذخیره نمی‌شود: فهرست، حال، قیمت و تاریخِ پایان همه از
//     سرورِ حساب می‌آیند (`/api/account-admin/*`). «یک دفترِ حساب، نه دو.»
//  ⛔ هر کارِ اثرگذار پشتِ یک پنجرهٔ تأیید است که **پیامدش** را می‌گوید، نه
//     فقط «مطمئنید؟» — بندِ ۱۶ پرامپت.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CreditCard, Search, Smartphone, Users } from 'lucide-react';

import { api } from '../../api';
import { Badge, Card, ConfirmDialog, Empty, Modal, Skeleton, toast } from '../../components/ui';
import { ActionButton, Cell, KV, Notice, Row, Select, Stat, Table, Tabs } from '../../control/ui';
import {
  APP_LABEL, AppPicker, CloudProblem, PageHead, STATUS_LABEL,
  day, daysTone, fa, moment, money, periodEnd, useLoad, type AppId, type Scope,
} from './shared';
import GrantSub from './GrantSub';
import type { Addon, Payment, PumpProfile, ShopProfile, SubRow } from './types';
import DeleteAccount from './DeleteAccount';

type ListOut = { subscriptions: SubRow[]; serverTime: number };

/** کارهایی که روی یک اشتراک می‌شود کرد — هر کدام با پیامدِ خودش. */
type Deed = {
  key: string;
  label: string;
  danger?: boolean;
  consequence: string;
  run: (row: SubRow) => Promise<unknown>;
};

/**
 *  ⚠️ `fixedApp` و `embedded`: همین صفحه داخلِ بخشِ خودِ هر برنامه هم
 *  می‌نشیند («پمپ‌بنزین‌ها ← اشتراک‌ها» و «فروشگاه‌ها ← اشتراک‌ها») — خواستهٔ
 *  صاحبِ سامانه (۱۴۰۵/۰۷/۱۳): «اشتراک‌ها رو توی بخشِ مربوطه‌شون بذار که راحت
 *  بشه دید و پیدا کرد». ⛔ رونوشتِ دومی ساخته نشد: همان فهرست، همان کارها،
 *  همان پنجره‌های تأیید — فقط بخش ثابت است و سربرگِ صفحه نیست.
 */
export default function Customers({ fixedApp, embedded = false }: { fixedApp?: AppId; embedded?: boolean } = {}) {
  /*
   *  دامنه از خودِ نشانی می‌آید تا منو بتواند مستقیم به «فروشگاه‌ها» یا
   *  «پمپ‌بنزین‌ها» باز کند.
   *
   *  ⚠️ چرا لازم شد: در منو «پمپ‌بنزین‌ها» بود ولی هیچ دری به نامِ فروشگاه
   *  نبود، و صاحبِ سامانه پرسید «کو بخشِ فروشگاه؟». حسابِ فروشگاه از روزِ
   *  اول همین‌جا بود — فقط دیده نمی‌شد. پس صفحهٔ تازه‌ای ساخته نشد و همین
   *  صفحه از نشانی فیلترِ اولش را می‌گیرد.
   *
   *  ⚠️ و `setApp` همچنان آزاد است: کاربری که کادر را عوض کند، نشانی
   *  جلویش را نمی‌گیرد.
   */
  const [params] = useSearchParams();
  const fromUrl = params.get('app');
  const [app, setApp] = useState<Scope>(fixedApp || (fromUrl === 'shop' || fromUrl === 'pump' ? fromUrl : 'both'));

  //  رفتن از «فروشگاه‌ها» به «پمپ‌بنزین‌ها» همان صفحه است؛ بی این، فیلتر عوض نمی‌شد
  useEffect(() => {
    if (fixedApp) { setApp(fixedApp); return; }
    if (fromUrl === 'shop' || fromUrl === 'pump') setApp(fromUrl);
  }, [fromUrl, fixedApp]);

  /*
   *  ⛔ «فقط آخرین اشتراکِ هر حساب» — پیش‌فرض روشن.
   *
   *  حسابی که یک بار لغو و دوباره خریده دو ردیف داشت (یکی «لغو · ۰ روز»، یکی
   *  «فعال · ۳۶۵ روز») و صاحبِ سامانه نمی‌فهمید حالِ **امروزِ** آن حساب
   *  کدام است. ردیف‌های کهنه پاک نمی‌شوند — با برداشتنِ تیک برمی‌گردند، چون
   *  تاریخچه و پرداخت‌ها به آن‌ها بند است.
   */
  const [latestOnly, setLatestOnly] = useState(true);

  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [city, setCity] = useState('');
  //  ⚠️ جست‌وجو هم از نشانی می‌آید (`?q=`) تا صفحهٔ «پمپ‌بنزین‌ها» بتواند
  //  با یک کلیک به پروندهٔ همان حساب برسد — کارهای اشتراک فقط همین‌جاست.
  const [q, setQ] = useState(params.get('q') || '');
  const [open, setOpen] = useState<SubRow | null>(null);
  const [ask, setAsk] = useState<{ deed: Deed; row: SubRow } | null>(null);
  //  تمدید با مدتِ دلخواه — پنجرهٔ خودش، نه پرسشِ «مطمئنید؟»
  const [extend, setExtend] = useState<SubRow | null>(null);
  //  ⛔ «اشتراک بده» — تا ۱۴۰۵/۰۷/۰۸ این صفحه فقط کارهای روی اشتراکِ
  //  **موجود** را داشت (تمدید، تعلیق، لغو…). دادنِ اشتراکِ **اول** هیچ دری
  //  نداشت، چون این فهرست از `sales/subscriptions` می‌آید و حسابِ تازه‌ای
  //  که چیزی نخریده در آن نیست. شرحش در `GrantSub.tsx`.
  //  ⚠️ حالِ «دادنِ اشتراک» خودش می‌گوید برای **کدام** حساب باز شده، تا
  //  ردیفِ یک حسابِ بی‌اشتراک بتواند همان‌جا ایمیلش را جلو ببرد.
  const [grant, setGrant] = useState<{ app: AppId; q: string } | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (app !== 'both') p.set('app', app);
    if (status) p.set('status', status);
    if (kind) p.set('kind', kind);
    if (city.trim()) p.set('city', city.trim());
    p.set('limit', '500');
    return p.toString();
  }, [app, status, kind, city]);

  const list = useLoad<ListOut>(`/api/account-admin/customers?${query}`, [query], 'customers');
  const { rows, older } = useMemo(() => {
    let all = list.data?.subscriptions || [];
    let hidden = 0;
    if (latestOnly) {
      const best = new Map<string, SubRow>();
      for (const r of all) {
        const k = `${r.app}:${r.tenantId}`;
        const at = (x: SubRow) => Number(x.createdAt || x.startsAt || 0);
        const cur = best.get(k);
        if (!cur || at(r) > at(cur)) best.set(k, r);
      }
      hidden = all.length - best.size;
      all = all.filter((r) => best.get(`${r.app}:${r.tenantId}`) === r);
    }
    const needle = q.trim().toLowerCase();
    if (!needle) return { rows: all, older: hidden };
    return {
      rows: all.filter((r) =>
        [r.tenantName, r.ownerName, r.ownerEmail, r.ownerPhone, r.city, r.planTitle]
          .some((v) => String(v || '').toLowerCase().includes(needle))),
      older: hidden,
    };
  }, [list.data, q, latestOnly]);

  const counts = useMemo(() => {
    const out = { active: 0, expiring: 0, expired: 0, permanent: 0, never: 0 };
    for (const r of rows) {
      //  ⛔ حسابِ بی‌اشتراک در هیچ‌کدام از چهار شمارندهٔ دیگر نمی‌نشیند —
      //  نه «فعال» است، نه «منقضی». شمردنش در آن‌ها یعنی عددی که دروغ
      //  می‌گوید.
      if (r.neverSubscribed) { out.never++; continue; }
      if (r.permanent) out.permanent++;
      if (r.status === 'active') out.active++;
      if (r.status === 'expired' || r.status === 'cancelled') out.expired++;
      if (!r.permanent && r.status === 'active' && r.daysLeft <= 30 && r.daysLeft >= 0) out.expiring++;
    }
    return out;
  }, [rows]);

  const after = async () => { await list.reload(); };

  const deeds: Deed[] = [
    {
      //  ⛔ «تمدید یا دلخواه چند وقته» (۱۴۰۵/۰۷/۱۳): مدت را مدیر می‌گوید، نه
      //  یک ماهِ ثابت. این کار پنجرهٔ خودش را دارد (`ExtendDialog`) و `run`ش
      //  فقط برای شکلِ یکدست است — از آن‌جا صدا زده می‌شود، با مدتِ برگزیده.
      key: 'extend',
      label: 'تمدید…',
      consequence: 'تاریخِ پایانِ این اشتراک به اندازهٔ مدتِ برگزیده جلو می‌رود. برنامهٔ مشتری در اولین اتصال آن را می‌گیرد؛ کلیدِ تازه‌ای لازم نیست.',
      run: (r) => api(`/api/account-admin/subs/${r.app}/${r.id}/extend`, { body: { amount: 1, unit: 'month' } }),
    },
    {
      key: 'suspend',
      label: 'تعلیق',
      danger: true,
      consequence: 'اشتراک تعلیق می‌شود و برنامهٔ مشتری به قفلِ نرم می‌رود: فقط‌خواندنی، با پیامِ «برای ادامه با پشتیبانی تماس بگیرید». هیچ داده‌ای پاک نمی‌شود.',
      run: (r) => api(`/api/account-admin/subs/${r.app}/${r.id}/status`, { body: { status: 'suspended' } }),
    },
    {
      key: 'activate',
      label: 'برگرداندن به فعال',
      consequence: 'اشتراک دوباره فعال می‌شود و قفلِ نرم برداشته می‌شود.',
      run: (r) => api(`/api/account-admin/subs/${r.app}/${r.id}/status`, { body: { status: 'active' } }),
    },
    {
      key: 'cancel',
      //  ⚠️ «حذفِ اشتراک» همین است: صاحبِ سامانه دنبالِ «حذف» می‌گشت و
      //  «لغو» را نمی‌دید. ردیفِ اشتراک برای تاریخچه و پرداخت‌ها می‌ماند.
      label: 'لغو / حذفِ اشتراک',
      danger: true,
      consequence: 'اشتراک همین حالا برداشته می‌شود و قابلیت‌های پولی بسته می‌شوند — دورهٔ آزمایشی هم برنمی‌گردد. برنامهٔ مشتری در یک دقیقهٔ بعد خودش می‌فهمد. دادهٔ مشتری دست نمی‌خورد، ردیفِ اشتراک برای تاریخچه و پرداخت‌ها می‌ماند، و با اشتراکِ تازه همه‌چیز برمی‌گردد.',
      run: (r) => api(`/api/account-admin/subs/${r.app}/${r.id}/status`, { body: { status: 'cancelled' } }),
    },
    {
      key: 'permanent',
      label: 'تبدیل به دائمی',
      consequence: 'اشتراک بی تاریخِ پایان می‌شود و در برنامه «دائمی ✓» دیده می‌شود، بی شمارشِ روز. تپش و پشتیبانی سرِ جایشان می‌مانند.',
      run: (r) => api(`/api/account-admin/subs/${r.app}/${r.id}/permanent`, { body: {} }),
    },
  ];

  return (
    <div className={embedded ? '' : 'mx-auto max-w-6xl'}>
      {embedded ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-muted">
            اشتراکِ {APP_LABEL[(fixedApp || 'pump') as AppId]}‌ها — روزِ مانده، تاریخِ پایان و همهٔ کارها همین‌جا
          </p>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setGrant({ app: fixedApp || 'pump', q: '' })}
          >
            <CreditCard className="h-4 w-4" /> دادنِ اشتراک
          </button>
        </div>
      ) : (
        <PageHead
          title="مشتری‌ها و اشتراک‌ها"
          sub="همهٔ اشتراک‌های دکان و پمپ، از سرورِ حساب — با فیلترِ بخش، وضعیت، شهر و نوعِ پلن"
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setGrant({ app: app === 'both' ? 'pump' : app, q: '' })}
              >
                <CreditCard className="h-4 w-4" /> دادنِ اشتراک
              </button>
              {!fixedApp && <AppPicker value={app} onChange={setApp} withBoth />}
            </div>
          )}
        />
      )}

      {list.error && <CloudProblem code={list.code} message={list.error} onRetry={list.reload} />}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="فعال" value={fa(counts.active)} tone="good" icon={<Users className="h-4 w-4" />} />
        <Stat label="رو به پایان (≤۳۰ روز)" value={fa(counts.expiring)} tone="warn" />
        <Stat label="منقضی یا لغوشده" value={fa(counts.expired)} tone="bad" />
        <Stat label="دائمی" value={fa(counts.permanent)} tone="info" />
        <Stat label="ثبت‌شده، بی اشتراک" value={fa(counts.never)} />
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted ltr:left-3 rtl:right-3" />
            <input
              className="input w-full ltr:pl-9 rtl:pr-9"
              placeholder="نام، ایمیل، شماره…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <div className="w-36">
            <Select
              value={status}
              onChange={setStatus}
              placeholder="هر وضعیتی"
              options={['active', 'suspended', 'expired', 'cancelled'].map((s) => ({ value: s, label: STATUS_LABEL[s] || s }))}
            />
          </div>
          <div className="w-36">
            <Select
              value={kind}
              onChange={setKind}
              placeholder="هر نوعی"
              options={[{ value: 'permanent', label: 'دائمی' }]}
            />
          </div>
          <input className="input w-32" placeholder="شهر" value={city} onChange={(e) => setCity(e.target.value)} />
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            <input type="checkbox" checked={latestOnly} onChange={(e) => setLatestOnly(e.target.checked)} />
            فقط آخرین اشتراکِ هر حساب{latestOnly && older > 0 ? ` (${fa(older)} ردیفِ کهنه پنهان)` : ''}
          </label>
        </div>

        {list.busy && !list.data ? (
          <Skeleton rows={6} />
        ) : rows.length === 0 ? (
          <Empty title="هیچ اشتراکی با این فیلتر نیست" hint="فیلترها را بردارید یا بخشِ دیگری را ببینید." />
        ) : (
          <Table head={['مشتری', 'بخش', 'پلن', 'وضعیت', 'مانده', 'پایان', 'قیمت', 'پرداخت‌شده', '']}>
            {rows.map((r) => {
              //  ⚠️ حسابِ بی‌اشتراک «۰ روز مانده» نیست — هیچ روزی ندارد.
              //  ⚠️ حسابِ بی‌اشتراک «۰ روز مانده» نیست — مگر در دورهٔ
              //  آزمایشی باشد، که روزهای خودش را دارد.
              const tone = r.neverSubscribed && r.status !== 'trial'
                ? { tone: 'neutral' as const, text: '—' }
                : daysTone(r.daysLeft, r.permanent, r.status);
              /*
               *  ⛔ روی حسابِ بی‌اشتراک هیچ‌کدام از کارهای اشتراک (تمدید،
               *  تعلیق، لغو…) معنا ندارد و شناسه‌اش هم شناسهٔ اشتراک نیست —
               *  زدنشان فقط یک ۴۰۰ِ گنگ می‌گیرد. و «دکمه‌ای که زده شود و
               *  هیچ اتفاقی نیفتد باگ است، نه قفل.» پس ردیفش مستقیم به
               *  «دادنِ اشتراک» می‌رود، با ایمیلِ خودش از پیش نوشته‌شده.
               */
              const sell = () => setGrant({ app: r.app, q: r.ownerEmail || r.tenantName || '' });
              return (
                <Row key={`${r.app}-${r.id}`} onClick={() => setOpen(r)}>
                  <Cell>
                    <p className="font-medium text-ink">{r.tenantName || r.ownerName || '—'}</p>
                    <p className="text-[11px] text-ink-muted">
                      {[r.ownerName, r.ownerEmail, r.city].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </Cell>
                  <Cell><Badge tone={r.app === 'pump' ? 'info' : 'neutral'}>{APP_LABEL[r.app]}</Badge></Cell>
                  <Cell>{r.planTitle || r.plan || '—'}</Cell>
                  <Cell><Badge tone={r.status === 'active' ? 'good' : r.status === 'suspended' ? 'warn' : 'bad'}>{STATUS_LABEL[r.status] || r.status}</Badge></Cell>
                  <Cell><Badge tone={tone.tone}>{tone.text}</Badge></Cell>
                  <Cell className="tnum">{r.permanent ? 'دائمی' : r.endsAt ? day(r.endsAt) : '—'}</Cell>
                  <Cell className="tnum">{r.price == null ? '—' : money(r.price, r.currency)}</Cell>
                  <Cell className="tnum">{money(r.paid, r.currency)}</Cell>
                  <Cell>
                    {/*  ⛔ پرونده برای **هر** ردیف (۱۴۰۵/۰۷/۱۳): حسابِ تازه‌ای که
                         هنوز چیزی نخریده (همهٔ ثبت‌نام‌های تازه، در دورهٔ آزمایشی)
                         پرونده نداشت — پس نه کامپیوترهایش دیده می‌شد، نه «حذفِ
                         کاملِ حساب» به آن می‌رسید. */}
                    <div className="flex gap-1.5">
                      {r.neverSubscribed && (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={(e) => { e.stopPropagation(); sell(); }}
                        >
                          دادنِ اشتراک
                        </button>
                      )}
                      <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); setOpen(r); }}>پرونده</button>
                    </div>
                  </Cell>
                </Row>
              );
            })}
          </Table>
        )}
      </Card>

      {open && (
        <Profile
          row={open}
          deeds={deeds}
          onClose={() => setOpen(null)}
          onDeed={(deed, row) => (deed.key === 'extend' ? setExtend(row) : setAsk({ deed, row }))}
          onChanged={after}
        />
      )}

      {/*
        *  ⚠️ `key` عمدی است: با آن، پنجره برای هر حساب از نو ساخته می‌شود و
        *  `startQuery` بی هیچ `useEffect`ی می‌نشیند. بی آن، جست‌وجوی حسابِ
        *  قبلی در پنجرهٔ بعدی می‌ماند.
        */}
      <GrantSub
        key={grant ? `${grant.app}:${grant.q}` : 'idle'}
        open={Boolean(grant)}
        onClose={() => setGrant(null)}
        onDone={after}
        startApp={grant?.app}
        startQuery={grant?.q}
      />

      {extend && (
        <ExtendDialog
          row={extend}
          onClose={() => setExtend(null)}
          onDone={async () => { setExtend(null); await after(); setOpen(null); }}
        />
      )}

      <ConfirmDialog
        open={Boolean(ask)}
        danger={ask?.deed.danger}
        title={ask ? `${ask.deed.label} — ${ask.row.tenantName || ask.row.ownerName}` : ''}
        message={ask?.deed.consequence || ''}
        onCancel={() => setAsk(null)}
        onConfirm={async () => {
          if (!ask) return;
          const { deed, row } = ask;
          setAsk(null);
          try {
            await deed.run(row);
            toast(`${deed.label} انجام شد`);
            await after();
            setOpen(null);
          } catch (e) {
            toast(e instanceof Error ? e.message : 'نشد', 'bad');
          }
        }}
      />
    </div>
  );
}

/* ------------------------ تمدید با مدتِ دلخواه --------------------------- */

const UNIT_FA: Record<string, string> = { day: 'روز', week: 'هفته', month: 'ماه', year: 'سال' };
const PRESETS: { amount: number; unit: string; label: string }[] = [
  { amount: 1, unit: 'month', label: '۱ ماه' },
  { amount: 3, unit: 'month', label: '۳ ماه' },
  { amount: 6, unit: 'month', label: '۶ ماه' },
  { amount: 1, unit: 'year', label: '۱ سال' },
];

/**
 *  «تمدید یا دلخواه چند وقته به طرف داد» — چهار دکمهٔ آماده و یک مدتِ دستی.
 *  ⛔ عدد را سرورِ حساب حساب می‌کند (`/extend` با `amount`/`unit`)؛ تاریخِ
 *  روی این پنجره فقط پیش‌نمایشِ همان قاعده است تا مدیر پیش از زدن ببیند.
 */
function ExtendDialog({ row, onClose, onDone }: { row: SubRow; onClose: () => void; onDone: () => Promise<void> }) {
  const [amount, setAmount] = useState('1');
  const [unit, setUnit] = useState('month');
  const n = Math.max(1, Math.floor(Number(amount) || 0));
  const preview = periodEnd(row.endsAt, n, unit);
  return (
    <Modal
      open
      onClose={onClose}
      title={`تمدیدِ اشتراک — ${row.tenantName || row.ownerName || '—'}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>انصراف</button>
          <ActionButton
            className="btn btn-primary"
            busyLabel="…"
            onClick={async () => {
              try {
                await api(`/api/account-admin/subs/${row.app}/${row.id}/extend`, { body: { amount: n, unit } });
                toast(`تمدید شد — ${fa(n)} ${UNIT_FA[unit] || unit}`);
                await onDone();
              } catch (e) {
                toast(e instanceof Error ? e.message : 'نشد', 'bad');
              }
            }}
          >
            تمدید کن
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => {
            const on = n === p.amount && unit === p.unit;
            return (
              <button
                key={p.label}
                className={on ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
                onClick={() => { setAmount(String(p.amount)); setUnit(p.unit); }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-end gap-2">
          <div className="w-28">
            <label className="label">مدتِ دلخواه</label>
            <input className="input w-full" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="w-32">
            <Select value={unit} onChange={setUnit} options={Object.entries(UNIT_FA).map(([value, label]) => ({ value, label }))} />
          </div>
        </div>
        <Notice tone="info">
          پایانِ فعلی: <b>{row.permanent ? 'دائمی' : row.endsAt ? day(row.endsAt) : '—'}</b>
          {' '}⇒ پایانِ تازه: <b>{day(preview)}</b>. مدت از پایانِ فعلی جلو می‌رود (و اگر تمام شده، از امروز).
          برنامهٔ مشتری در اولین اتصال آن را می‌گیرد؛ کلیدِ تازه‌ای لازم نیست.
        </Notice>
      </div>
    </Modal>
  );
}

/* --------------------------- پروندهٔ یک مشتری --------------------------- */

function Profile({
  row, deeds, onClose, onDeed, onChanged,
}: {
  row: SubRow;
  deeds: Deed[];
  onClose: () => void;
  onDeed: (deed: Deed, row: SubRow) => void;
  onChanged: () => Promise<void>;
}) {
  const [tab, setTab] = useState('overview');
  const app: AppId = row.app;
  const shop = useLoad<ShopProfile>(app === 'shop' ? `/api/account-admin/shop-accounts/${row.tenantId}` : null);
  const pump = useLoad<PumpProfile>(app === 'pump' ? `/api/account-admin/pump-accounts/${row.tenantId}` : null);
  const pays = useLoad<{ payments: Payment[] }>(`/api/account-admin/payments?app=${app}&tenantId=${encodeURIComponent(row.tenantId)}`);
  //  حسابی که هنوز اشتراکی نخریده، اشتراکی ندارد که افزونه یا تمدید داشته باشد
  const addons = useLoad<{ addons: Addon[] }>(row.neverSubscribed ? null : `/api/account-admin/subs/${app}/${row.id}/addons`);
  const history = useLoad<{ history: Record<string, unknown>[] }>(`/api/account-admin/customers/${app}/${row.tenantId}/history`);

  const devices = (app === 'shop' ? shop.data?.devices : pump.data?.devices) || [];
  const computers = pump.data?.computers || [];
  const owner = app === 'shop'
    ? { name: shop.data?.account.ownerName || row.ownerName, email: shop.data?.account.email || row.ownerEmail, phone: shop.data?.account.phone || row.ownerPhone }
    : { name: pump.data?.owner?.name || row.ownerName, email: pump.data?.owner?.email || row.ownerEmail, phone: pump.data?.owner?.phone || row.ownerPhone };
  const busy = (app === 'shop' ? shop.busy : pump.busy) && !shop.data && !pump.data;
  const tone = daysTone(row.daysLeft, row.permanent, row.status);
  const [deleting, setDeleting] = useState(false);

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`${row.tenantName || owner.name || '—'} · ${APP_LABEL[app]}`}
      footer={row.ownerUserId ? (
        <div className="flex justify-start">
          <button className="btn btn-sm" style={{ color: 'var(--status-critical)' }} onClick={() => setDeleting(true)}>
            حذفِ کاملِ حساب…
          </button>
        </div>
      ) : undefined}
    >
      {deleting && row.ownerUserId && (
        <DeleteAccount userId={row.ownerUserId} onClose={() => setDeleting(false)}
                       onDone={async () => { await onChanged(); onClose(); }} />
      )}
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'اشتراک' },
          ...(app === 'pump' ? [{ id: 'computers', label: 'کامپیوترهای پمپ', badge: computers.length }] : []),
          { id: 'devices', label: 'دستگاه‌ها', badge: devices.length },
          { id: 'payments', label: 'پرداخت‌ها', badge: pays.data?.payments.length },
          { id: 'notes', label: 'یادداشت و تاریخچه' },
        ]}
      />

      {tab === 'overview' && (
        busy ? <Skeleton rows={5} /> : (
          <div className="flex flex-col gap-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <KV label="صاحبِ حساب">{owner.name || '—'}</KV>
              <KV label="ایمیل" mono>{owner.email || '—'}</KV>
              <KV label="تلفن" mono>{owner.phone || '—'}</KV>
              <KV label="شهر">{row.city || '—'}</KV>
              <KV label="پلن">{row.planTitle || row.plan || '—'}</KV>
              <KV label="وضعیت"><Badge tone={row.status === 'active' ? 'good' : row.status === 'suspended' ? 'warn' : 'bad'}>{STATUS_LABEL[row.status] || row.status}</Badge></KV>
              <KV label="از">{day(row.startsAt)}</KV>
              <KV label="تا">{row.permanent ? 'دائمی ✓' : day(row.endsAt)}</KV>
              <KV label="مانده"><Badge tone={tone.tone}>{tone.text}</Badge></KV>
              <KV label="قیمتِ روزِ خرید">{row.price == null ? '—' : money(row.price, row.currency)}</KV>
              <KV label="پرداخت‌شده">{money(row.paid, row.currency)}</KV>
              {app === 'pump' && <KV label="کدِ اپِ کارمندان" mono>{pump.data?.accessCode || '—'}</KV>}
            </div>

            {row.features?.length > 0 && (
              <p className="text-xs text-ink-muted">قابلیت‌های پلن: {row.features.join(' · ')}</p>
            )}

            {row.neverSubscribed ? (
              <Notice tone="info">این حساب هنوز اشتراکی نخریده؛ برای فروش، «دادنِ اشتراک» را در فهرست بزنید.</Notice>
            ) : (<>
            <div>
              <p className="label">افزونه‌ها (قابلیتِ فروخته‌شدهٔ جدا)</p>
              {addons.busy && !addons.data ? <Skeleton rows={1} /> : (addons.data?.addons.length ? (
                <ul className="flex flex-wrap gap-1.5">
                  {addons.data.addons.map((a) => (
                    <li key={a.id}><Badge tone="info">{a.feature}{a.price ? ` · ${money(a.price, a.currency)}` : ''}</Badge></li>
                  ))}
                </ul>
              ) : <p className="text-xs text-ink-muted">افزونه‌ای روی این اشتراک نیست.</p>)}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              {deeds.filter((d) => applies(d.key, row.status)).map((d) => (
                <button
                  key={d.key}
                  className={d.danger ? 'btn btn-sm btn-danger' : 'btn btn-sm'}
                  onClick={() => onDeed(d, row)}
                >
                  {d.label}
                </button>
              ))}
              <DiscountButton row={row} onDone={onChanged} />
            </div>
            </>)}
          </div>
        )
      )}

      {tab === 'computers' && app === 'pump' && (
        <div className="flex flex-col gap-3">
          <Notice tone="info">
            کامپیوترهایی که برنامهٔ پمپ رویشان به همین پمپ ثبت شده
            {pump.data?.deviceLimit ? <> — سقف: <b>{fa(pump.data.deviceLimit)}</b></> : null}.
            «جدا کردن» فقط راهِ آن کامپیوتر به سرور را می‌بندد و <b>هیچ داده‌ای پاک نمی‌شود</b>؛
            کامپیوترِ جداشده خودش دوباره ثبت نمی‌شود و فقط «برگرداندن» بازش می‌کند.
          </Notice>
          {computers.length === 0 ? (
            <Empty icon={<Smartphone className="h-6 w-6" />} title="هیچ کامپیوتری به این پمپ ثبت نشده"
              hint="برنامهٔ پمپ با ورود به همین حساب و زدنِ نامِ پمپ خودش ثبت می‌شود." />
          ) : (
            <Table head={['کامپیوتر', 'ثبت', 'آخرین اتصال', 'حال', '']}>
              {computers.map((c) => (
                <Row key={c.id}>
                  <Cell>{c.name || '—'}</Cell>
                  <Cell>{day(c.createdAt)}</Cell>
                  <Cell>{moment(c.lastSeenAt)}</Cell>
                  <Cell><Badge tone={c.revoked ? 'bad' : 'good'}>{c.revoked ? 'جدا شده' : 'فعال'}</Badge></Cell>
                  <Cell>
                    <ActionButton
                      className={c.revoked ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
                      busyLabel="…"
                      onClick={async () => {
                        try {
                          await api(`/api/account-admin/pump-accounts/${row.tenantId}/computers/${c.id}/${c.revoked ? 'restore' : 'revoke'}`, { body: {} });
                          toast(c.revoked ? 'کامپیوتر برگشت — برنامه در اولین اتصال خودش دوباره ثبت می‌شود' : 'کامپیوتر از پمپ جدا شد');
                          await pump.reload();
                        } catch (e) { toast(e instanceof Error ? e.message : 'نشد', 'bad'); }
                      }}
                    >
                      {c.revoked ? 'برگرداندن' : 'جدا کردن'}
                    </ActionButton>
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </div>
      )}

      {tab === 'devices' && (
        <div className="flex flex-col gap-3">
          <Notice tone="info">
            دستگاه‌هایی که صاحبِ حساب با آن‌ها <b>وارد شده</b> (ورود با ایمیل). خودِ مشتری از «حسابِ من» در
            برنامه یا از پورتالش آزادشان می‌کند.{app === 'pump' ? ' کامپیوترهای ثبت‌شده به پمپ در زبانهٔ «کامپیوترهای پمپ» هستند.' : ''}
          </Notice>
          {devices.length === 0 ? (
            <Empty icon={<Smartphone className="h-6 w-6" />} title="هیچ دستگاهی ثبت نشده" />
          ) : (
            <Table head={['دستگاه', 'شناسه', 'آخرین اتصال', 'حال']}>
              {devices.map((d) => (
                <Row key={d.id}>
                  <Cell>{d.name || '—'}</Cell>
                  <Cell mono>{d.uid || '—'}</Cell>
                  <Cell>{moment(d.lastSeenAt)}</Cell>
                  <Cell><Badge tone={d.revoked ? 'bad' : 'good'}>{d.revoked ? 'باطل‌شده' : 'فعال'}</Badge></Cell>
                </Row>
              ))}
            </Table>
          )}
        </div>
      )}

      {tab === 'payments' && (
        pays.busy && !pays.data ? <Skeleton rows={4} /> : (
          (pays.data?.payments.length || 0) === 0 ? (
            <Empty icon={<CreditCard className="h-6 w-6" />} title="پرداختی ثبت نشده" hint="پرداخت‌ها از صفحهٔ «فروش» ثبت می‌شوند." />
          ) : (
            <Table head={['تاریخ', 'مبلغ', 'روش', 'شمارهٔ رسید', 'یادداشت']}>
              {(pays.data?.payments || []).map((p) => (
                <Row key={p.id}>
                  <Cell>{day(p.paidAt)}</Cell>
                  <Cell className="tnum">{money(p.amount, p.currency)}</Cell>
                  <Cell>{p.method}</Cell>
                  <Cell mono>{p.receiptNo || '—'}</Cell>
                  <Cell>{p.note || '—'}</Cell>
                </Row>
              ))}
            </Table>
          )
        )
      )}

      {tab === 'notes' && (
        <div className="flex flex-col gap-3">
          <KV label="یادداشتِ روی اشتراک">{row.note || '—'}</KV>
          <p className="text-[11px] text-ink-muted">
            یادداشت هنگامِ دادنِ اشتراک نوشته می‌شود و روی همان ردیف می‌ماند.
          </p>
          <div>
            <p className="label">تاریخچهٔ اشتراک</p>
            {history.busy && !history.data ? <Skeleton rows={3} /> : (
              (history.data?.history?.length || 0) === 0
                ? <p className="text-xs text-ink-muted">تاریخچه‌ای ثبت نشده.</p>
                : (
                  <Table head={['کار', 'از', 'به', 'چه کسی', 'کِی']}>
                    {(history.data?.history || []).map((h, i) => (
                      <Row key={i}>
                        <Cell>{String(h.action ?? '—')}</Cell>
                        <Cell>{String(h.prev_status ?? '—')}</Cell>
                        <Cell>{String(h.new_status ?? '—')}</Cell>
                        <Cell mono>{String(h.actor ?? '—')}</Cell>
                        <Cell>{moment(Number(h.created_at) || 0)}</Cell>
                      </Row>
                    ))}
                  </Table>
                )
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * کدام کار روی کدام حال معنا دارد — «دکمه‌ای که زده شود و هیچ اتفاقی
 * نیفتد باگ است». لغوِ اشتراکِ لغوشده یا تعلیقِ اشتراکِ تمام‌شده فقط یک
 * پیامِ گنگ از سرورِ حساب می‌گرفت.
 */
function applies(key: string, status: string): boolean {
  if (key === 'activate') return status === 'suspended';
  if (key === 'suspend') return status === 'active';
  if (key === 'cancel') return status === 'active' || status === 'suspended';
  return true;
}

/** تخفیفِ مستقیم روی همین اشتراک، با دلیل — سناریوی ۱۰ پرامپت. */
function DiscountButton({ row, onDone }: { row: SubRow; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [percent, setPercent] = useState('');
  const [reason, setReason] = useState('');

  return (
    <>
      <button className="btn btn-sm" onClick={() => setOpen(true)}>تخفیفِ مستقیم</button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="تخفیف روی همین اشتراک"
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>انصراف</button>
            <ActionButton
              className="btn btn-primary"
              busyLabel="…"
              onClick={async () => {
                try {
                  await api(`/api/account-admin/subs/${row.app}/${row.id}/discount`, {
                    body: { percent: Number(percent) || 0, reason },
                  });
                  toast('تخفیف روی اشتراک نشست');
                  setOpen(false);
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
          قیمتِ همین اشتراک کم می‌شود و دلیلش در تاریخچه می‌نشیند. قیمتِ پلن و اشتراکِ بقیه دست نمی‌خورد.
        </p>
        <label className="label">درصد</label>
        <input className="input mb-3 w-full" inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value)} />
        <label className="label">دلیل</label>
        <input className="input w-full" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً: مشتریِ قدیمی" />
      </Modal>
    </>
  );
}
