// ---------------------------------------------------------------------------
//  💰 «مالی» ِ بخشِ فروشگاه — ماژولِ ۴.۵ ِ پنلِ مرکزیِ مالک (مالیِ مرکزی، جدا از دفترِ دکان‌ها)
//
//  زیرزبانه‌ها (‎?tab=finance&fin=…‎): درآمد و گزارش · پرداخت‌ها · بازپرداخت و اصلاحیه · بدهی‌ها ·
//  در انتظار و ناموفق · مغایرت · تاریخچه · ثبتِ پرداخت و رسید (همان صفحهٔ «فروش» ِ پیشین، دست‌نخورده).
//
//  ⛔ هیچ عددی این‌جا ساخته نمی‌شود — همه از ‎/api/admin/finance/*‎ ِ سرورِ حساب، با «منبع و زمان» زیرِ هر کارت.
//  ⛔ سرورِ حسابِ بی ‎finance.v1‎ ⇒ «داده در دسترس نیست» با نامِ توانایی، نه صفر.
//  ⛔ اصلاح فقط با «سندِ اصلاحی» (دلیل + رمزِ پنل + کلیدِ یکتایی)؛ هیچ دکمهٔ ویرایش/حذفِ پرداخت نیست.
//  ⛔ مرز در سرور است؛ پنهان کردنِ دکمه برای غیرِ مالک فقط برای این است که درخواستِ بی‌نتیجه نزند.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, Layers, Wallet } from 'lucide-react';

import { Cell, Notice, Row, Stat, Table, Tabs } from '../../control/ui';
import { fa, money, useLoad } from './shared';
import Sales from './Sales';
import { useFinT, type FinKey } from './finance/strings';
import { finUrl, type Breakdown, type Summary, type Unavail } from './finance/data';
import { AppSelect, FinCard, Pager, appLabel } from './finance/parts';
import { AdjustmentsView, PaymentsView } from './finance/Ledger';
import { HistoryView, PendingView, ReceivablesView, ReconView } from './finance/Checks';

/* ───────────────────────────── درآمد و گزارش ───────────────────────────── */

type Period = { group: 'day' | 'week' | 'month'; custom: boolean; fromDate: string; toDate: string; app: string };

function PeriodPicker({ value, onApply }: { value: Period; onApply: (p: Period) => void }) {
  const ft = useFinT();
  const [p, setP] = useState(value);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <select className="input w-auto" value={p.group} aria-label={ft('bucket')}
              onChange={(e) => { const next = { ...p, group: e.target.value as Period['group'] }; setP(next); if (!next.custom) onApply(next); }}>
        <option value="day">{ft('groupDay')}</option>
        <option value="week">{ft('groupWeek')}</option>
        <option value="month">{ft('groupMonth')}</option>
      </select>
      <select className="input w-auto" value={p.custom ? 'custom' : 'default'} aria-label={ft('window')}
              onChange={(e) => { const next = { ...p, custom: e.target.value === 'custom' }; setP(next); if (!next.custom) onApply(next); }}>
        <option value="default">{ft('rangeDefault')}</option>
        <option value="custom">{ft('rangeCustom')}</option>
      </select>
      {p.custom && (
        <>
          <label className="text-xs">{ft('from')}
            <input type="date" className="input ms-1 w-auto" dir="ltr" value={p.fromDate} onChange={(e) => setP({ ...p, fromDate: e.target.value })} />
          </label>
          <label className="text-xs">{ft('to')}
            <input type="date" className="input ms-1 w-auto" dir="ltr" value={p.toDate} onChange={(e) => setP({ ...p, toDate: e.target.value })} />
          </label>
          <button className="btn btn-sm btn-primary" disabled={!p.fromDate || !p.toDate} onClick={() => onApply(p)}>{ft('apply')}</button>
        </>
      )}
      <AppSelect value={p.app} onChange={(app) => { const next = { ...p, app }; setP(next); onApply(next); }} />
    </div>
  );
}

const TOTAL_ROWS: { key: 'payments' | 'correction' | 'refund' | 'reversal'; label: FinKey }[] = [
  { key: 'payments', label: 'payments' }, { key: 'correction', label: 'corrections' },
  { key: 'refund', label: 'refunds' }, { key: 'reversal', label: 'reversals' },
];

function SummaryBody({ d }: { d: Summary }) {
  const ft = useFinT();
  const currencies = Array.isArray(d.currencies) ? d.currencies : [];
  const series = Array.isArray(d.series) ? d.series : [];
  if (!currencies.length) {
    return <Notice>{ft('noRevenue')} <span className="text-[11px] text-ink-muted">({d.window?.fromDate} — {d.window?.toDate})</span></Notice>;
  }
  return (
    <div className="space-y-4">
      <p className="text-[11px] text-ink-muted">
        {ft('window')}: <span dir="ltr">{d.window?.fromDate} → {d.window?.toDate}</span> · {ft('timezoneNote', { tz: d.window?.timezone || '—' })} · {ft('currencyNote')}
      </p>
      {currencies.map((cur) => {
        const tot = d.totals?.[cur];
        if (!tot) return null;
        return (
          <div key={cur} className="grid gap-3 sm:grid-cols-5">
            {TOTAL_ROWS.map((r) => (
              <Stat key={r.key} label={`${ft(r.label)} · ${cur}`} value={money(tot[r.key]?.amount ?? null, cur)}
                    sub={`${ft('count')}: ${fa(tot[r.key]?.count ?? null)}`}
                    tone={r.key === 'payments' ? 'info' : tot[r.key]?.amount ? 'warn' : undefined} />
            ))}
            <Stat label={`${ft('net')} · ${cur}`} value={money(tot.net, cur)} tone="good" />
          </div>
        );
      })}
      <p className="text-[11px] text-ink-muted">{ft('adjNote')}</p>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{ft('series')}</h3>
        <Table head={[ft('bucket'), ...currencies.flatMap((c) => [`${ft('payments')} · ${c}`, `${ft('adjustments')} · ${c}`, `${ft('net')} · ${c}`])]}
               empty={series.length === 0}>
          {series.map((b) => (
            <Row key={b.key}>
              <Cell mono>{b.label}</Cell>
              {currencies.flatMap((c) => {
                const x = b.currencies?.[c];
                return [
                  <Cell key={`${c}p`}>{x ? money(x.payments, c) : '—'}</Cell>,
                  <Cell key={`${c}a`}>{x && x.adjustments ? money(x.adjustments, c) : '—'}</Cell>,
                  <Cell key={`${c}n`}>{x ? <b>{money(x.net, c)}</b> : '—'}</Cell>,
                ];
              })}
            </Row>
          ))}
        </Table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold">{ft('byService')}</h3>
          <Table head={[ft('service'), ft('payments'), ft('adjustments'), ft('net')]} empty={!d.byService?.length}>
            {(d.byService || []).map((s) => (
              <Row key={`${s.app}${s.currency}`}>
                <Cell>{appLabel(ft, s.app)}</Cell>
                <Cell>{money(s.payments, s.currency)} <span className="text-[11px] text-ink-muted">({fa(s.count)})</span></Cell>
                <Cell>{s.adjustments ? money(s.adjustments, s.currency) : '—'}</Cell>
                <Cell><b>{money(s.net, s.currency)}</b></Cell>
              </Row>
            ))}
          </Table>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">{ft('byMethod')}</h3>
          <Table head={[ft('method'), ft('count'), ft('amount')]} empty={!d.byMethod?.length}>
            {(d.byMethod || []).map((m) => (
              <Row key={`${m.method}${m.currency}`}>
                <Cell>{({ cash: 'نقد', hawala: 'حواله', exchange: 'صرافی' } as Record<string, string>)[m.method] || m.method}</Cell>
                <Cell>{fa(m.count)}</Cell>
                <Cell>{money(m.amount, m.currency)}</Cell>
              </Row>
            ))}
          </Table>
        </div>
      </div>
    </div>
  );
}

function BreakdownCard({ period }: { period: Period }) {
  const ft = useFinT();
  const [by, setBy] = useState<'shop' | 'plan'>('shop');
  const [offset, setOffset] = useState(0);
  const limit = 20;
  const url = finUrl('/breakdown', {
    by, limit, offset, group: period.group, app: period.app,
    ...(period.custom ? { fromDate: period.fromDate, toDate: period.toDate } : {}),
  });
  const load = useLoad<Breakdown | Unavail>(url);
  return (
    <FinCard title={ft('breakdown')} icon={<Layers size={16} />} source="/api/admin/finance/breakdown" load={load}
             action={(
               <select className="input w-auto" value={by} aria-label={ft('breakdown')} onChange={(e) => { setBy(e.target.value as 'shop' | 'plan'); setOffset(0); }}>
                 <option value="shop">{ft('byShop')}</option>
                 <option value="plan">{ft('byPlan')}</option>
               </select>
             )}>
      {(d) => (
        <>
          <Table head={[by === 'shop' ? ft('byShop') : ft('byPlan'), ft('service'), ft('payments'), ft('adjustments'), ft('net')]} empty={!d.rows?.length}>
            {(d.rows || []).map((r) => (
              <Row key={`${r.app}${r.key}${r.currency}`}>
                <Cell>{by === 'plan' && !r.key ? ft('noPlan') : (r.name || <code dir="ltr" className="font-mono text-xs">{r.key}</code>)}</Cell>
                <Cell>{appLabel(ft, r.app)}</Cell>
                <Cell>{money(r.payments, r.currency)} <span className="text-[11px] text-ink-muted">({fa(r.count)})</span></Cell>
                <Cell>{r.adjustments ? money(r.adjustments, r.currency) : '—'}</Cell>
                <Cell><b>{money(r.net, r.currency)}</b></Cell>
              </Row>
            ))}
          </Table>
          <Pager offset={offset} limit={limit} total={Number(d.total) || 0} onChange={setOffset} />
        </>
      )}
    </FinCard>
  );
}

function Overview() {
  const ft = useFinT();
  const [period, setPeriod] = useState<Period>({ group: 'day', custom: false, fromDate: '', toDate: '', app: 'all' });
  const url = finUrl('/summary', {
    group: period.group, app: period.app, ...(period.custom ? { fromDate: period.fromDate, toDate: period.toDate } : {}),
  });
  const load = useLoad<Summary | Unavail>(url);
  return (
    <div className="space-y-4">
      <FinCard title={ft('tabOverview')} icon={<BarChart3 size={16} />} source="/api/admin/finance/summary" load={load}
               action={<PeriodPicker value={period} onApply={setPeriod} />}>
        {(d) => <SummaryBody d={d} />}
      </FinCard>
      <BreakdownCard key={url} period={period} />
    </div>
  );
}

/* ─────────────────────────────── خودِ زبانه ─────────────────────────────── */

const SUBTABS = ['overview', 'payments', 'adjustments', 'receivables', 'pending', 'recon', 'history', 'record'] as const;
const SUBTAB_LABEL: Record<(typeof SUBTABS)[number], FinKey> = {
  overview: 'tabOverview', payments: 'tabPayments', adjustments: 'tabAdjustments', receivables: 'tabReceivables',
  pending: 'tabPending', recon: 'tabRecon', history: 'tabHistory', record: 'tabRecord',
};

export default function ShopFinance() {
  const ft = useFinT();
  const [params, setParams] = useSearchParams();
  const want = params.get('fin') || 'overview';
  const active = (SUBTABS as readonly string[]).includes(want) ? want : 'overview';
  const go = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', 'finance');
    if (id === 'overview') next.delete('fin'); else next.set('fin', id);
    setParams(next);
  };
  return (
    <div className="space-y-3" data-module="finance">
      <p className="flex items-start gap-2 text-[12px] text-ink-muted"><Wallet size={14} className="mt-0.5 shrink-0" /> {ft('intro')}</p>
      <Tabs tabs={SUBTABS.map((id) => ({ id, label: ft(SUBTAB_LABEL[id]) }))} active={active} onChange={go} />
      {active === 'overview' && <Overview />}
      {active === 'payments' && <PaymentsView />}
      {active === 'adjustments' && <AdjustmentsView />}
      {active === 'receivables' && <ReceivablesView />}
      {active === 'pending' && <PendingView />}
      {active === 'recon' && <ReconView />}
      {active === 'history' && <HistoryView />}
      {/* ⛔ همان صفحهٔ «فروش و درآمد» ِ پیشین (ثبتِ پرداخت، رسیدِ چاپی، رو به پایان + یادآوری) — دست‌نخورده، تا هیچ کاری گم نشود */}
      {active === 'record' && <Sales fixedApp="shop" />}
    </div>
  );
}
