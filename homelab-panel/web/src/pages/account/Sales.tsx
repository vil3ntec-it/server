// ---------------------------------------------------------------------------
//  💰 فروش — بندِ ۱۱.۴
//
//  درآمدِ امروز/ماه/سال به تفکیکِ بخش و ارز با نمودارِ دوازده ماه، فهرستِ
//  رو به پایان با دکمهٔ یادآوری، بدهی‌ها (اشتراک داده شده، پرداخت نشده) و
//  دفترِ پرداخت‌ها با رسیدِ چاپی.
//
//  ⛔ **رسید یک صفحهٔ HTMLِ چاپیِ فارسیِ خودِ سرورِ حساب است، نه PDF.**
//     مرورگر خودش «چاپ ⇒ ذخیره به PDF» دارد و هیچ کتابخانهٔ PDFی به این
//     پنل اضافه نمی‌شود. صفحه با نشستِ خودِ پنل خوانده و در تبِ تازه باز
//     می‌شود، پس هیچ توکنی در نشانی نمی‌نشیند.
//  ⛔ هیچ مبلغی این‌جا حساب نمی‌شود؛ جمع‌ها و بدهی‌ها از سرورِ حساب می‌آیند.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { AlertCircle, CalendarClock, Receipt, Wallet } from 'lucide-react';

import { api, getToken } from '../../api';
import { Badge, Card, ConfirmDialog, Empty, Modal, Skeleton, toast } from '../../components/ui';
import { ActionButton, Cell, Notice, Row, Stat, Table, Tabs } from '../../control/ui';
import {
  APP_LABEL, AppPicker, CloudProblem, METHOD_LABEL, PageHead,
  day, daysTone, fa, money, useLoad, type AppId, type Scope,
} from './shared';
import Revenue from './Revenue';
import type { Debt, Expiring, Payment, SalesSummary } from './types';

const PERIOD: { id: 'today' | 'month' | 'year'; label: string }[] = [
  { id: 'today', label: 'امروز' },
  { id: 'month', label: 'این ماه' },
  { id: 'year', label: 'امسال' },
];

export default function Sales() {
  const [tab, setTab] = useState('overview');
  const [app, setApp] = useState<Scope>('both');

  const summary = useLoad<SalesSummary>('/api/account-admin/sales/summary', [], 'sales');
  const expiring = useLoad<{ expiring: Expiring[]; days: number }>(
    `/api/account-admin/sales/expiring?days=30${app === 'both' ? '' : `&app=${app}`}`, [app]);
  const debts = useLoad<{ debts: Debt[] }>(
    `/api/account-admin/sales/debts${app === 'both' ? '' : `?app=${app}`}`, [app]);
  const payments = useLoad<{ payments: Payment[] }>(
    `/api/account-admin/payments?limit=200${app === 'both' ? '' : `&app=${app}`}`, [app]);

  const [remind, setRemind] = useState(false);
  const [newPay, setNewPay] = useState(false);

  /** ارزهایی که واقعاً در دوازده ماهِ اخیر دیده شده‌اند. */
  const currencies = Array.from(new Set(
    (summary.data?.series || []).flatMap((b) => [...Object.keys(b.shop || {}), ...Object.keys(b.pump || {})])
  ));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-2">
      <PageHead
        title="فروش"
        sub="درآمد، رو به پایان‌ها، بدهی‌ها و رسیدها — همه از سرورِ حساب"
        actions={<AppPicker value={app} onChange={setApp} withBoth />}
      />

      {summary.error && <CloudProblem code={summary.code} message={summary.error} />}

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'درآمد' },
          { id: 'expiring', label: 'رو به پایان', badge: expiring.data?.expiring.length },
          { id: 'debts', label: 'بدهی‌ها', badge: debts.data?.debts.length },
          { id: 'payments', label: 'پرداخت‌ها و رسید' },
        ]}
      />

      {tab === 'overview' && (
        summary.busy && !summary.data ? <Skeleton rows={6} /> : (
          <div className="flex flex-col gap-4">
            {PERIOD.map((p) => (
              <Card key={p.id} title={`درآمدِ ${p.label}`} icon={<Wallet className="h-4 w-4" />}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(['shop', 'pump'] as AppId[]).flatMap((a) => {
                    const box = summary.data?.revenue?.[p.id]?.[a] || {};
                    const keys = Object.keys(box);
                    if (keys.length === 0) return [<Stat key={`${a}-none`} label={APP_LABEL[a]} value="—" />];
                    return keys.map((cur) => (
                      <Stat key={`${a}-${cur}`} label={`${APP_LABEL[a]} · ${cur === 'USD' ? 'دالر' : 'افغانی'}`} value={money(box[cur], cur)} tone="info" />
                    ));
                  })}
                </div>
              </Card>
            ))}

            {currencies.length === 0 ? (
              <Card><Empty title="هنوز پرداختی ثبت نشده" hint="با ثبتِ اولین پرداخت، نمودارِ دوازده ماه این‌جا می‌آید." /></Card>
            ) : currencies.map((cur) => (
              <Card key={cur}><Revenue series={summary.data?.series || []} currency={cur} /></Card>
            ))}

            <Card title="شمارِ اشتراک‌ها">
              <Table head={['بخش', 'فعال', 'منقضی', 'تعلیق', 'حساب‌ها']}>
                {(['shop', 'pump'] as AppId[]).map((a) => (
                  <Row key={a}>
                    <Cell>{APP_LABEL[a]}</Cell>
                    <Cell className="tnum">{fa(summary.data?.counts?.[a]?.active ?? 0)}</Cell>
                    <Cell className="tnum">{fa(summary.data?.counts?.[a]?.expired ?? 0)}</Cell>
                    <Cell className="tnum">{fa(summary.data?.counts?.[a]?.suspended ?? 0)}</Cell>
                    <Cell className="tnum">{fa(summary.data?.counts?.[a]?.tenants ?? 0)}</Cell>
                  </Row>
                ))}
              </Table>
            </Card>
          </div>
        )
      )}

      {tab === 'expiring' && (
        <Card
          title="اشتراک‌های رو به پایان (۳۰ روز)"
          icon={<CalendarClock className="h-4 w-4" />}
          action={<button className="btn btn-sm btn-primary" onClick={() => setRemind(true)}>یادآوریِ ایمیلی به همه</button>}
        >
          {expiring.busy && !expiring.data ? <Skeleton rows={4} /> : (
            (expiring.data?.expiring.length || 0) === 0
              ? <Empty title="هیچ اشتراکی تا سی روزِ آینده تمام نمی‌شود" />
              : (
                <Table head={['مشتری', 'بخش', 'پلن', 'پایان', 'مانده', 'تماس']}>
                  {(expiring.data?.expiring || []).map((r) => {
                    const tone = daysTone(r.daysLeft);
                    return (
                      <Row key={`${r.app}-${r.subscriptionId}`}>
                        <Cell>
                          <p className="font-medium text-ink">{r.tenantName || r.ownerName || '—'}</p>
                          <p className="text-[11px] text-ink-muted">{r.ownerName}</p>
                        </Cell>
                        <Cell><Badge tone={r.app === 'pump' ? 'info' : 'neutral'}>{APP_LABEL[r.app]}</Badge></Cell>
                        <Cell mono>{r.plan}</Cell>
                        <Cell>{day(r.endsAt)}</Cell>
                        <Cell><Badge tone={tone.tone}>{tone.text}</Badge></Cell>
                        <Cell mono>{r.ownerEmail || r.ownerPhone || '—'}</Cell>
                      </Row>
                    );
                  })}
                </Table>
              )
          )}
        </Card>
      )}

      {tab === 'debts' && (
        <Card title="اشتراکِ داده‌شده، پرداخت‌نشده" icon={<AlertCircle className="h-4 w-4" />}>
          {debts.busy && !debts.data ? <Skeleton rows={4} /> : (
            (debts.data?.debts.length || 0) === 0
              ? <Empty title="بدهی‌ای نیست" hint="هر اشتراکِ فعالی که پرداختش کمتر از قیمتش باشد این‌جا می‌آید." />
              : (
                <Table head={['مشتری', 'بخش', 'پلن', 'قیمت', 'پرداخت‌شده', 'بدهی']}>
                  {(debts.data?.debts || []).map((r) => (
                    <Row key={`${r.app}-${r.id}`}>
                      <Cell>
                        <p className="font-medium text-ink">{r.tenantName || r.ownerName || '—'}</p>
                        <p className="text-[11px] text-ink-muted">{r.ownerEmail || r.ownerPhone || ''}</p>
                      </Cell>
                      <Cell><Badge tone={r.app === 'pump' ? 'info' : 'neutral'}>{APP_LABEL[r.app]}</Badge></Cell>
                      <Cell>{r.planTitle || r.plan}</Cell>
                      <Cell className="tnum">{money(r.price, r.currency)}</Cell>
                      <Cell className="tnum">{money(r.paid, r.currency)}</Cell>
                      <Cell className="tnum"><Badge tone="bad">{money(r.debt, r.currency)}</Badge></Cell>
                    </Row>
                  ))}
                </Table>
              )
          )}
        </Card>
      )}

      {tab === 'payments' && (
        <Card
          title="پرداخت‌ها"
          icon={<Receipt className="h-4 w-4" />}
          action={<button className="btn btn-sm btn-primary" onClick={() => setNewPay(true)}>ثبتِ پرداخت</button>}
        >
          <Notice tone="info">
            رسید و فاکتور صفحهٔ HTMLِ چاپیِ فارسی است؛ مرورگر خودش «چاپ ⇒ ذخیره به PDF» دارد.
          </Notice>
          {payments.busy && !payments.data ? <Skeleton rows={5} /> : (
            (payments.data?.payments.length || 0) === 0
              ? <Empty title="پرداختی ثبت نشده" />
              : (
                <Table head={['تاریخ', 'مشتری', 'بخش', 'مبلغ', 'روش', 'شمارهٔ رسید', '']}>
                  {(payments.data?.payments || []).map((p) => (
                    <Row key={p.id}>
                      <Cell>{day(p.paidAt)}</Cell>
                      <Cell>{p.tenantName || p.ownerName || '—'}</Cell>
                      <Cell><Badge tone={p.app === 'pump' ? 'info' : 'neutral'}>{APP_LABEL[p.app]}</Badge></Cell>
                      <Cell className="tnum">{money(p.amount, p.currency)}</Cell>
                      <Cell>{METHOD_LABEL[p.method] || p.method}</Cell>
                      <Cell mono>{p.receiptNo || '—'}</Cell>
                      <Cell><ReceiptButton id={p.id} /></Cell>
                    </Row>
                  ))}
                </Table>
              )
          )}
        </Card>
      )}

      <ConfirmDialog
        open={remind}
        title="یادآوریِ ایمیلی به همهٔ رو به پایان‌ها"
        message="برای هر مشتری‌ای که تا سی روزِ آینده اشتراکش تمام می‌شود یک اعلان با قالبِ «رو به پایان» ساخته و فرستاده می‌شود — ایمیل و پیامِ داخلِ برنامه. گزارشِ تحویلش در «مرکز اعلان» می‌نشیند."
        onCancel={() => setRemind(false)}
        onConfirm={async () => {
          setRemind(false);
          try {
            const out = await api<{ sent?: number }>('/api/account-admin/sales/expiring/remind', {
              body: { days: 30, app: app === 'both' ? 'both' : app },
            });
            toast(`یادآوری رفت: ${fa(out.sent ?? 0)}`);
          } catch (e) {
            toast(e instanceof Error ? e.message : 'نشد', 'bad');
          }
        }}
      />

      {newPay && <NewPayment onClose={() => setNewPay(false)} onDone={payments.reload} />}
    </div>
  );
}

/**
 * رسید را با نشستِ پنل می‌خواند و در تبِ تازه باز می‌کند.
 * ⛔ توکن در نشانی نمی‌رود — نشانیِ رسید قابلِ کپی و فرستادن است.
 */
function ReceiptButton({ id }: { id: string }) {
  return (
    <ActionButton
      busyLabel="…"
      onClick={async () => {
        try {
          const res = await fetch(`/api/account-admin/payments/${id}/receipt`, {
            headers: { Authorization: `Bearer ${getToken() || ''}` },
          });
          if (!res.ok) throw new Error('رسید از سرورِ حساب نیامد');
          const html = await res.text();
          const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
          const win = window.open(url, '_blank', 'noopener');
          if (!win) toast('مرورگر پنجرهٔ تازه را باز نکرد', 'bad');
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } catch (e) {
          toast(e instanceof Error ? e.message : 'نشد', 'bad');
        }
      }}
    >
      رسید
    </ActionButton>
  );
}

function NewPayment({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [app, setApp] = useState<AppId>('shop');
  const [tenantId, setTenantId] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('AFN');
  const [method, setMethod] = useState('cash');
  const [receiptNo, setReceiptNo] = useState('');
  const [note, setNote] = useState('');

  return (
    <Modal
      open
      onClose={onClose}
      title="ثبتِ پرداخت"
      footer={
        <>
          <button className="btn" onClick={onClose}>انصراف</button>
          <ActionButton
            className="btn btn-primary"
            busyLabel="…"
            onClick={async () => {
              try {
                await api('/api/account-admin/payments', {
                  body: { app, tenantId, amount: Number(amount), currency, method, receiptNo, note },
                });
                toast('پرداخت ثبت شد');
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
        پرداخت به آخرین اشتراکِ همان حساب بسته می‌شود. شمارهٔ رسیدِ خالی را خودِ سرور می‌سازد.
      </p>
      <label className="label">بخش</label>
      <div className="mb-3"><AppPicker value={app} onChange={(v) => setApp(v as AppId)} /></div>
      <label className="label">شناسهٔ دکان/پمپ</label>
      <input className="input mb-3 w-full" dir="ltr" value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="label">مبلغ</label>
          <input className="input w-full" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label className="label">ارز</label>
          <select className="input w-full" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="AFN">افغانی</option>
            <option value="USD">دالر</option>
          </select>
        </div>
      </div>
      <label className="label">روش</label>
      <select className="input mb-3 w-full" value={method} onChange={(e) => setMethod(e.target.value)}>
        {Object.entries(METHOD_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
      <label className="label">شمارهٔ رسید (خالی = خودکار)</label>
      <input className="input mb-3 w-full" dir="ltr" value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} />
      <label className="label">یادداشت</label>
      <input className="input w-full" value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}
