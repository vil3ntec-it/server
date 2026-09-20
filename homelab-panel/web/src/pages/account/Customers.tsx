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
import { useMemo, useState } from 'react';
import { CreditCard, Search, Smartphone, Users } from 'lucide-react';

import { api } from '../../api';
import { Badge, Card, ConfirmDialog, Empty, Modal, Skeleton, toast } from '../../components/ui';
import { ActionButton, Cell, KV, Notice, Row, Select, Stat, Table, Tabs } from '../../control/ui';
import {
  APP_LABEL, AppPicker, CloudProblem, PageHead, STATUS_LABEL,
  day, daysTone, fa, moment, money, useLoad, type AppId, type Scope,
} from './shared';
import type { Addon, Payment, PumpProfile, ShopProfile, SubRow } from './types';

type ListOut = { subscriptions: SubRow[]; serverTime: number };

/** کارهایی که روی یک اشتراک می‌شود کرد — هر کدام با پیامدِ خودش. */
type Deed = {
  key: string;
  label: string;
  danger?: boolean;
  consequence: string;
  run: (row: SubRow) => Promise<unknown>;
};

export default function Customers() {
  const [app, setApp] = useState<Scope>('both');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [city, setCity] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<SubRow | null>(null);
  const [ask, setAsk] = useState<{ deed: Deed; row: SubRow } | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (app !== 'both') p.set('app', app);
    if (status) p.set('status', status);
    if (kind) p.set('kind', kind);
    if (city.trim()) p.set('city', city.trim());
    p.set('limit', '500');
    return p.toString();
  }, [app, status, kind, city]);

  const list = useLoad<ListOut>(`/api/account-admin/customers?${query}`, [query]);
  const rows = useMemo(() => {
    const all = list.data?.subscriptions || [];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((r) =>
      [r.tenantName, r.ownerName, r.ownerEmail, r.ownerPhone, r.city, r.planTitle]
        .some((v) => String(v || '').toLowerCase().includes(needle)));
  }, [list.data, q]);

  const counts = useMemo(() => {
    const out = { active: 0, expiring: 0, expired: 0, permanent: 0 };
    for (const r of rows) {
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
      key: 'extend',
      label: 'تمدید یک ماه',
      consequence: 'تاریخِ پایانِ این اشتراک یک ماهِ تقویمی جلو می‌رود. برنامهٔ مشتری در اولین اتصال آن را می‌گیرد؛ کلیدِ تازه‌ای لازم نیست.',
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
      label: 'لغو',
      danger: true,
      consequence: 'اشتراک لغو می‌شود و قابلیت‌های پولی بسته می‌شوند. دادهٔ مشتری دست نمی‌خورد و با اشتراکِ تازه همه‌چیز برمی‌گردد.',
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
    <div className="mx-auto max-w-6xl">
      <PageHead
        title="مشتری‌ها و اشتراک‌ها"
        sub="همهٔ اشتراک‌های دکان و پمپ، از سرورِ حساب — با فیلترِ بخش، وضعیت، شهر و نوعِ پلن"
        actions={<AppPicker value={app} onChange={setApp} withBoth />}
      />

      {list.error && <CloudProblem code={list.code} message={list.error} />}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="فعال" value={fa(counts.active)} tone="good" icon={<Users className="h-4 w-4" />} />
        <Stat label="رو به پایان (≤۳۰ روز)" value={fa(counts.expiring)} tone="warn" />
        <Stat label="منقضی یا لغوشده" value={fa(counts.expired)} tone="bad" />
        <Stat label="دائمی" value={fa(counts.permanent)} tone="info" />
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
        </div>

        {list.busy && !list.data ? (
          <Skeleton rows={6} />
        ) : rows.length === 0 ? (
          <Empty title="هیچ اشتراکی با این فیلتر نیست" hint="فیلترها را بردارید یا بخشِ دیگری را ببینید." />
        ) : (
          <Table head={['مشتری', 'بخش', 'پلن', 'وضعیت', 'مانده', 'قیمت', 'پرداخت‌شده', '']}>
            {rows.map((r) => {
              const tone = daysTone(r.daysLeft, r.permanent);
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
                  <Cell className="tnum">{r.price == null ? '—' : money(r.price, r.currency)}</Cell>
                  <Cell className="tnum">{money(r.paid, r.currency)}</Cell>
                  <Cell>
                    <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); setOpen(r); }}>پرونده</button>
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
          onDeed={(deed, row) => setAsk({ deed, row })}
          onChanged={after}
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
  const addons = useLoad<{ addons: Addon[] }>(`/api/account-admin/subs/${app}/${row.id}/addons`);
  const history = useLoad<{ history: Record<string, unknown>[] }>(`/api/account-admin/customers/${app}/${row.tenantId}/history`);

  const devices = (app === 'shop' ? shop.data?.devices : pump.data?.devices) || [];
  const owner = app === 'shop'
    ? { name: shop.data?.account.ownerName || row.ownerName, email: shop.data?.account.email || row.ownerEmail, phone: shop.data?.account.phone || row.ownerPhone }
    : { name: pump.data?.owner?.name || row.ownerName, email: pump.data?.owner?.email || row.ownerEmail, phone: pump.data?.owner?.phone || row.ownerPhone };
  const busy = (app === 'shop' ? shop.busy : pump.busy) && !shop.data && !pump.data;
  const tone = daysTone(row.daysLeft, row.permanent);

  return (
    <Modal open wide onClose={onClose} title={`${row.tenantName || owner.name || '—'} · ${APP_LABEL[app]}`}>
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'اشتراک' },
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
              {deeds.map((d) => (
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
          </div>
        )
      )}

      {tab === 'devices' && (
        <div className="flex flex-col gap-3">
          <Notice tone="info">
            آزاد کردنِ دستگاه از این‌جا ممکن نیست: سرورِ حساب مسیرِ مدیریتی برای باطل کردنِ دستگاه ندارد و
            خودِ مشتری از «حسابِ من» در برنامه یا از پورتالِ خودش دستگاه را آزاد می‌کند. این فهرست فقط
            می‌گوید چه دستگاهی و کِی وصل شده — تا وقتی مشتری زنگ می‌زند، جواب حدس نباشد.
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
