// ---------------------------------------------------------------------------
//  داشبورد — کارِ صاحبِ سامانه، نه حالِ سرور
//
//  خواستهٔ صاحب سامانه (۱۴۰۵/۰۷/۱۳، بارِ دوم): «داشبورد متفاوت باشه؛ توی
//  برنامه یک مانیتورینگ است، چرا باید دوباره توی داشبورد ببینم؟ داشبورد برای
//  دیدنِ درآمد و فروشِ من از اشتراک‌های هر برنامه و دیدنِ اشتراک‌های مردم و
//  پشتیبانی و غیره است، نه این‌ها.»
//
//  پس CPU و RAM و دیسک و دما از این صفحه رفتند — همه در «مانیتورینگ» بودند و
//  هستند (`/monitoring`). این‌جا فقط چیزهایی است که هر روز صبح پرسیده می‌شود:
//
//    · هر برنامه چند اشتراکِ فعال دارد، چندتا رو به پایان، این ماه چقدر فروخت
//    · درآمدِ امروز / این ماه / امسال، و نمودارِ دوازده ماه
//    · کدام اشتراک‌ها تا سی روزِ دیگر تمام می‌شوند
//    · چه گفت‌وگوهای پشتیبانی بازند
//    · کدهای شش‌رقمیِ امروز رفتند یا نه
//
//  ⛔ **هیچ عددی این‌جا حساب نمی‌شود** — همه از سرورِ حساب می‌آید
//     (`/api/account-admin/*`)، همان قاعدهٔ همهٔ صفحه‌های مشتری و پول.
//  ⛔ **هیچ نبضی ندارد**: هر بخش با موضوعِ زندهٔ خودش تازه می‌شود
//     (`sales` · `customers` · `support` · `codes`)، همان `useLive`.
//  ⚠️ نیامده «—» است، نه صفر: صفرِ دروغ بدتر از خالی است.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Clock, CreditCard, Fuel, Hash, MessagesSquare, Store, Wallet } from 'lucide-react';
import { api } from '../api';
import { useLive } from '../useLive';
import { Badge, Card, Empty, Skeleton } from '../components/ui';
import { Cell, Notice, Row, Stat, Table } from '../control/ui';
import {
  APP_LABEL, CURRENCY_LABEL, CloudProblem, PageHead, day, daysTone, fa, moment, money, useLoad, type AppId,
} from './account/shared';
import Revenue from './account/Revenue';
import type { Expiring, SalesSummary, Thread } from './account/types';

type CodeLite = { app: string; status: string; createdAt: number; sendState: string; logOnly?: boolean };

const APPS: AppId[] = ['pump', 'shop'];
const ICON: Record<AppId, typeof Fuel> = { pump: Fuel, shop: Store };

/** جمعِ یک بخش از پاسخِ فروش، به ازای هر ارز — شکلِ بالادست فرض نمی‌شود. */
function sumOf(rev: SalesSummary['revenue'] | undefined, period: string, app?: AppId): Record<string, number> {
  const out: Record<string, number> = {};
  const bucket = rev?.[period] || {};
  for (const a of app ? [app] : APPS) {
    for (const [cur, n] of Object.entries(bucket[a] || {})) out[cur] = (out[cur] || 0) + Number(n || 0);
  }
  return out;
}

/** «۱۲٬۰۰۰ افغانی · ۳۰۰ دالر» — و «—» وقتی هیچ. */
function moneyList(sums: Record<string, number>): string {
  const parts = Object.entries(sums).filter(([, n]) => n > 0).map(([cur, n]) => money(n, cur));
  return parts.length ? parts.join(' · ') : '—';
}

export default function Dashboard() {
  const summary = useLoad<SalesSummary>('/api/account-admin/sales/summary', [], 'sales');
  const expiring = useLoad<{ expiring: Expiring[]; days: number }>('/api/account-admin/sales/expiring?days=30', [], 'customers');
  const threads = useLoad<{ threads: Thread[]; unread: number }>('/api/account-admin/support/threads?limit=100', [], 'support');

  /*
   *  کدها از دفترِ خودِ پنل و دفترِ سرورِ حساب، همان `/api/codes-admin/live`
   *  که صفحهٔ «کدهای شش‌رقمی» می‌خواند — یک منبع، یک حقیقت.
   */
  const [codes, setCodes] = useState<CodeLite[] | null>(null);
  const loadCodes = useCallback(() => {
    api<{ items: CodeLite[] }>('/api/codes-admin/live')
      .then((r) => setCodes(Array.isArray(r.items) ? r.items : []))
      .catch(() => setCodes([]));
  }, []);
  useEffect(loadCodes, [loadCodes]);
  useLive('codes', loadCodes);

  const s = summary.data;
  const counts = s?.counts || {};
  const exp = Array.isArray(expiring.data?.expiring) ? expiring.data!.expiring : [];
  const open = useMemo(
    () => (Array.isArray(threads.data?.threads) ? threads.data!.threads : [])
      .filter((t) => t.status !== 'closed')
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)),
    [threads.data]
  );
  const codeStats = useMemo(() => {
    const since = Date.now() - 24 * 3600 * 1000;
    const all = codes || [];
    const today = all.filter((c) => Number(c.createdAt || 0) >= since);
    return {
      live: all.filter((c) => c.status === 'live').length,
      today: today.length,
      failed: today.filter((c) => c.sendState === 'failed' || c.logOnly).length,
    };
  }, [codes]);

  /** ارزهایی که واقعاً در دوازده ماهِ اخیر دیده شده‌اند — نمودار برای هر کدام. */
  const currencies = useMemo(() => Array.from(new Set(
    (s?.series || []).flatMap((b) => [...Object.keys(b.shop || {}), ...Object.keys(b.pump || {})])
  )), [s]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <PageHead
        title="داشبورد"
        sub="فروش و اشتراک‌های هر برنامه، از سرورِ حساب — حالِ خودِ سرور در «مانیتورینگ» است"
        actions={(
          <>
            <Link to="/subscriptions" className="btn btn-sm btn-primary"><CreditCard className="h-4 w-4" /> اشتراک‌ها</Link>
            <Link to="/monitoring" className="btn btn-sm"><Activity className="h-4 w-4" /> مانیتورینگِ سرور</Link>
          </>
        )}
      />

      {summary.error && <CloudProblem code={summary.code} message={summary.error} onRetry={summary.reload} />}

      {/* ── هر برنامه، یک کارت: اشتراک‌ها و فروشِ این ماه ───────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {APPS.map((app) => {
          const Icon = ICON[app];
          const c = counts[app];
          const soon = exp.filter((e) => e.app === app).length;
          return (
            <Card
              key={app}
              title={APP_LABEL[app]}
              icon={<Icon className="h-4 w-4" />}
              action={<Link className="btn btn-sm" to={`/subscriptions?app=${app}`}>اشتراک‌های {APP_LABEL[app]}</Link>}
            >
              {summary.busy && !s ? <Skeleton rows={2} /> : (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat label="فعال" value={fa(c?.active)} tone="good" />
                    <Stat label="رو به پایان (۳۰ روز)" value={expiring.data ? fa(soon) : '—'} tone={soon > 0 ? 'warn' : undefined} />
                    <Stat label="تعلیق / منقضی" value={c ? fa((c.suspended || 0) + (c.expired || 0)) : '—'} tone={c && (c.suspended || c.expired) ? 'bad' : undefined} />
                    <Stat label="حساب‌ها" value={fa(c?.tenants)} />
                  </div>
                  <p className="mt-3 text-sm">
                    <span className="text-ink-muted">فروشِ این ماه: </span>
                    <span className="tnum font-semibold">{moneyList(sumOf(s?.revenue, 'month', app))}</span>
                    <span className="text-ink-muted"> · امسال: </span>
                    <span className="tnum">{moneyList(sumOf(s?.revenue, 'year', app))}</span>
                  </p>
                </>
              )}
            </Card>
          );
        })}
      </div>

      {/* ── درآمد — امروز، این ماه، امسال، و دوازده ماه ────────────────────── */}
      <Card title="درآمد" icon={<Wallet className="h-4 w-4" />} action={<Link className="btn btn-sm" to="/sales">فروش و پرداخت‌ها</Link>}>
        {summary.busy && !s ? <Skeleton rows={3} /> : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Stat label="امروز" value={moneyList(sumOf(s?.revenue, 'today'))} />
              <Stat label="این ماه" value={moneyList(sumOf(s?.revenue, 'month'))} tone="good" />
              <Stat label="امسال" value={moneyList(sumOf(s?.revenue, 'year'))} />
            </div>
            {currencies.length === 0 ? (
              <Empty title="هنوز پرداختی ثبت نشده" hint="با ثبتِ اولین پرداخت در «فروش»، نمودارِ دوازده ماه این‌جا می‌آید." />
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {currencies.map((cur) => (
                  <div key={cur} className="rounded-xl border border-line p-3">
                    <Revenue series={s?.series || []} currency={cur} />
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-ink-muted">
              ارزها جمع نمی‌شوند: {Object.entries(CURRENCY_LABEL).map(([k, v]) => `${v} (${k})`).join(' · ')} هر کدام عددِ خودش را دارد.
            </p>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ── رو به پایان ───────────────────────────────────────────────── */}
        <Card
          className="lg:col-span-2"
          title={`رو به پایان — ${fa(expiring.data?.days || 30)} روزِ آینده`}
          icon={<Clock className="h-4 w-4" />}
          action={<Link className="btn btn-sm" to="/subscriptions">همه</Link>}
        >
          {expiring.error ? <CloudProblem code={expiring.code} message={expiring.error} onRetry={expiring.reload} />
            : expiring.busy && !expiring.data ? <Skeleton rows={4} />
            : exp.length === 0 ? <Notice tone="good">هیچ اشتراکی تا سی روزِ آینده تمام نمی‌شود.</Notice> : (
              <Table head={['مشتری', 'بخش', 'پلن', 'مانده', 'پایان']}>
                {exp.slice(0, 8).map((e) => {
                  const tone = daysTone(e.daysLeft, false, e.status);
                  return (
                    <Row key={`${e.app}-${e.subscriptionId}`}>
                      <Cell>
                        <p className="font-medium text-ink">{e.tenantName || e.ownerName || '—'}</p>
                        <p className="text-[11px] text-ink-muted">{e.ownerEmail || e.ownerPhone || '—'}</p>
                      </Cell>
                      <Cell><Badge tone={e.app === 'pump' ? 'info' : 'neutral'}>{APP_LABEL[e.app]}</Badge></Cell>
                      <Cell>{e.plan || '—'}</Cell>
                      <Cell><Badge tone={tone.tone}>{tone.text}</Badge></Cell>
                      <Cell className="tnum">{day(e.endsAt)}</Cell>
                    </Row>
                  );
                })}
              </Table>
            )}
          {exp.length > 8 && <p className="mt-2 text-[11px] text-ink-muted">و {fa(exp.length - 8)} تای دیگر — در «اشتراک‌ها».</p>}
        </Card>

        {/* ── پشتیبانی ─────────────────────────────────────────────────── */}
        <Card
          title="پشتیبانی — گفت‌وگوهای باز"
          icon={<MessagesSquare className="h-4 w-4" />}
          action={<Link className="btn btn-sm" to="/support">صندوق</Link>}
        >
          {threads.error ? <CloudProblem code={threads.code} message={threads.error} onRetry={threads.reload} />
            : threads.busy && !threads.data ? <Skeleton rows={4} />
            : open.length === 0 ? <Notice tone="good">گفت‌وگوی بازی نیست.</Notice> : (
              <ul className="space-y-2">
                {open.slice(0, 6).map((t) => (
                  <li key={t.id} className="rounded-xl border border-line p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-ink">{t.accountName || t.shopName || t.stationName || t.who || '—'}</p>
                      <div className="flex items-center gap-1.5">
                        {Number(t.unreadAdmin) > 0 && <Badge tone="warn">{fa(t.unreadAdmin)} نخوانده</Badge>}
                        <Badge tone={t.app === 'pump' ? 'info' : 'neutral'}>{APP_LABEL[(t.app === 'pump' ? 'pump' : 'shop') as AppId]}</Badge>
                      </div>
                    </div>
                    <p className="mt-1 truncate text-xs text-ink-muted" dir="auto">{t.lastMessage || '—'}</p>
                    <p className="text-[11px] text-ink-muted">{moment(t.updatedAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          {Number(threads.data?.unread) > 0 && (
            <p className="mt-2 text-[11px]" style={{ color: 'var(--status-warning)' }}>{fa(threads.data!.unread)} پیامِ نخوانده در کل</p>
          )}
        </Card>
      </div>

      {/* ── کدهای شش‌رقمی ─────────────────────────────────────────────────── */}
      <Card title="کدهای شش‌رقمی" icon={<Hash className="h-4 w-4" />} action={<Link className="btn btn-sm" to="/codes">همهٔ کدها</Link>}>
        {codes === null ? <Skeleton rows={1} /> : (
          <div className="grid grid-cols-3 gap-3">
            <Stat label="زندهٔ همین حالا" value={fa(codeStats.live)} />
            <Stat label="ساخته‌شده در ۲۴ ساعت" value={fa(codeStats.today)} />
            <Stat label="نرفته در ۲۴ ساعت" value={fa(codeStats.failed)} tone={codeStats.failed > 0 ? 'bad' : undefined} />
          </div>
        )}
      </Card>
    </div>
  );
}
