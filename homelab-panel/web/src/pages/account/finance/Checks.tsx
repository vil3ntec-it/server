// ---------------------------------------------------------------------------
//  ماژولِ «مالی» (۴.۵) — بدهی‌ها، در انتظار/ناموفق (درخواستِ خرید و درگاه)، مغایرت (مرکزی + تطبیقِ فروشِ آنلاینِ
//  #411 + درگاهِ #529) و تاریخچهٔ کارهای مالی.
//
//  ⛔ درگاهِ حساب‌پی تا کلیدش نیامده «BLOCKED-EXTERNAL: کلیدِ حساب‌پی نیامده» است — نه عدد، نه سبز.
//  ⛔ پولِ درگاه و فروشِ آنلاینِ دکان‌ها (یکصدمِ افغانی) هرگز با درآمدِ اشتراک یکی/جمع نمی‌شود؛ کنارِ هم دیده می‌شوند.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { AlertTriangle, Clock, History as HistoryIcon, Scale, Store, Wallet } from 'lucide-react';

import { api, ApiError } from '../../../api';
import { Card, toast } from '../../../components/ui';
import { useApp } from '../../../app-context';
import { ActionButton, Cell, Notice, Row, Stat, Table } from '../../../control/ui';
import { fa, money, useLoad } from '../shared';
import { useFinT, type FinKey } from './strings';
import {
  actorText, dateOf, finUrl, isUnavail, minorText, timeOf,
  type Discrepancies, type Gateway, type History, type OnlineRecon, type Pending, type Receivables, type Unavail,
} from './data';
import { AppSelect, FinCard, Pager, SourceLine, appLabel } from './parts';
import { actionLabel } from './Ledger';

const errText = (e: unknown) => (e instanceof ApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e));

/* ─────────────────────────────── بدهی‌ها ─────────────────────────────── */

export function ReceivablesView() {
  const ft = useFinT();
  const [app, setApp] = useState('all');
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const load = useLoad<Receivables | Unavail>(finUrl('/receivables', { app, limit, offset }));
  return (
    <FinCard title={ft('tabReceivables')} icon={<Wallet size={16} />} source="/api/admin/finance/receivables" load={load}
             action={<AppSelect value={app} onChange={(v) => { setApp(v); setOffset(0); }} />}>
      {(d) => (
        <>
          <p className="mb-2 text-[11px] text-ink-muted">{ft('debtRule')}</p>
          {Object.keys(d.totals || {}).length > 0 && (
            <div className="mb-3 grid gap-3 sm:grid-cols-3">
              {Object.entries(d.totals).map(([cur, x]) => (
                <Stat key={cur} label={`${ft('debt')} · ${cur}`} value={money(x.debt, cur)} sub={`${ft('count')}: ${fa(x.count)}`} tone="warn" />
              ))}
            </div>
          )}
          {!d.rows?.length ? <Notice tone="good">{ft('noDebts')}</Notice> : (
            <Table head={[ft('shop'), ft('plan'), ft('status'), ft('price'), ft('paid'), ft('debt')]}>
              {d.rows.map((r) => (
                <Row key={r.subscriptionId}>
                  <Cell>{r.tenantName || r.tenantId} <span className="text-[11px] text-ink-muted">· {appLabel(ft, r.app)}</span></Cell>
                  <Cell>{r.plan || '—'}</Cell>
                  <Cell>{r.status}</Cell>
                  <Cell>{money(r.price, r.currency)}{r.priceSource === 'plan' && <span className="text-[11px] text-ink-muted"> ({ft('priceFromPlan')})</span>}</Cell>
                  <Cell>{money(r.paid, r.currency)}</Cell>
                  <Cell style={{ color: 'var(--status-warning)' }}><b>{money(r.debt, r.currency)}</b></Cell>
                </Row>
              ))}
            </Table>
          )}
          {d.truncated && <p className="mt-2 text-[11px] text-ink-muted">{ft('truncated')}</p>}
          <Pager offset={offset} limit={limit} total={Number(d.total) || 0} onChange={setOffset} />
        </>
      )}
    </FinCard>
  );
}

/* ─────────────────────────────── درگاه ─────────────────────────────── */

export function GatewayCard({ gw }: { gw: Gateway | null | undefined }) {
  const ft = useFinT();
  if (!gw) return null;
  if (gw.state !== 'live') {
    return (
      <Notice tone="warn">
        <b dir="auto">{gw.message || ft('gatewayBlocked')}</b>
        <span className="mt-1 block text-[11px] text-ink-muted">{ft('gatewayWhy')}</span>
        <span className="mt-1 block text-[11px] text-ink-muted">
          <code dir="ltr" className="font-mono">{gw.code || 'blocked_external'}</code>{gw.needs ? <> · {ft('needs')}: <span dir="ltr">{gw.needs}</span></> : null}
        </span>
      </Notice>
    );
  }
  return (
    <div className="space-y-2">
      <Notice>{ft('gatewayLive')}</Notice>
      <Table head={[ft('status'), ft('count'), ft('amount'), ft('unmatched'), ft('review')]} empty={!gw.byStatus?.length}>
        {(gw.byStatus || []).map((s) => (
          <Row key={s.status}>
            <Cell mono>{s.status}</Cell>
            <Cell>{fa(s.count)}</Cell>
            <Cell>{minorText(s.amountMinor)}</Cell>
            <Cell style={s.unmatched ? { color: 'var(--status-warning)' } : undefined}>{fa(s.unmatched)}</Cell>
            <Cell style={s.review ? { color: 'var(--status-critical)' } : undefined}>{fa(s.review)}</Cell>
          </Row>
        ))}
      </Table>
    </div>
  );
}

/* ─────────────────────────────── در انتظار و ناموفق ─────────────────────────────── */

export function PendingView() {
  const ft = useFinT();
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const load = useLoad<Pending | Unavail>(finUrl('/pending', { limit, offset }));
  const d = load.data && !isUnavail(load.data) ? load.data : null;
  return (
    <div className="space-y-4">
      <FinCard title={ft('purchaseRequests')} icon={<Clock size={16} />} source="/api/admin/finance/pending" load={load}>
        {(x) => {
          const pr = x.purchaseRequests;
          return (
            <>
              <p className="mb-2 text-xs">{ft('pendingCount', { p: fa(pr?.counts?.pending), a: fa(pr?.counts?.approved), r: fa(pr?.counts?.rejected) })}</p>
              {!pr?.items?.length ? <Notice tone="good">{ft('noPending')}</Notice> : (
                <Table head={[ft('shop'), ft('plan'), ft('quoted'), ft('date'), ft('age')]}>
                  {pr.items.map((r) => (
                    <Row key={r.id}>
                      <Cell>{r.shopName || r.shopId}</Cell>
                      <Cell>{r.planTitle || r.planCode}</Cell>
                      <Cell>{money(r.quotedPrice, r.currency)}</Cell>
                      <Cell>{dateOf(r.createdAt)}</Cell>
                      <Cell style={r.ageDays > 3 ? { color: 'var(--status-warning)' } : undefined}>{fa(r.ageDays)}</Cell>
                    </Row>
                  ))}
                </Table>
              )}
              <Pager offset={offset} limit={limit} total={Number(pr?.total) || 0} onChange={setOffset} />
              <div className="mt-3"><Notice>{ft('manualOnly')}</Notice></div>
            </>
          );
        }}
      </FinCard>
      {d && (
        <Card title={ft('gateway')} icon={<Scale size={16} />}>
          <GatewayCard gw={d.gateway} />
          <SourceLine source="/api/admin/finance/gateway" data={d.gateway} at={load.at} />
        </Card>
      )}
    </div>
  );
}

/* ─────────────────────────────── مغایرت ─────────────────────────────── */

function OnlineReconCard() {
  const ft = useFinT();
  const { can } = useApp();
  const load = useLoad<OnlineRecon>(can('admin') ? finUrl('/online-reconciliation') : null);
  return (
    <Card title={ft('onlineRecon')} icon={<Store size={16} />}>
      <p className="mb-2 text-[11px] text-ink-muted">{ft('onlineReconWhy')}</p>
      {!can('admin') ? <Notice>{ft('ownerOnly')}</Notice>
        : load.error ? <Notice tone="bad">{load.code}: {load.error}</Notice>
        : !load.data ? <p className="text-xs text-ink-muted">…</p>
        : load.data.available === false ? <Notice tone="warn">{ft('onlineMissing')} <span dir="ltr" className="text-[11px]">({load.data.needs})</span></Notice>
        : (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label={ft('sales')} value={minorText(load.data.totals?.salesMinor)} />
              <Stat label={ft('refunds')} value={minorText(load.data.totals?.refundsMinor)} />
              <Stat label={ft('net')} value={minorText(load.data.totals?.netMinor)} tone="info" />
              <Stat label={ft('issues')} value={fa(load.data.totals?.issues ?? null)} tone={Number(load.data.totals?.issues) ? 'bad' : undefined}
                    sub={`${ft('courierHeld')}: ${minorText(load.data.totals?.courierHeldMinor)}`} />
            </div>
            {!!load.data.shops?.length && (
              <div className="mt-3">
                <Table head={[ft('shops'), ft('net'), ft('issues'), ft('courierHeld')]}>
                  {load.data.shops.slice(0, 50).map((s) => (
                    <Row key={s.shopId}>
                      <Cell>{s.shopName || s.shopId}</Cell>
                      <Cell>{minorText(s.netMinor)}</Cell>
                      <Cell style={s.issues?.length ? { color: 'var(--status-critical)' } : undefined}>{fa(s.issues?.length ?? 0)}</Cell>
                      <Cell>{minorText(s.courier?.heldMinor)}</Cell>
                    </Row>
                  ))}
                </Table>
              </div>
            )}
            <SourceLine source="/api/admin/system/reconciliation" data={load.data} at={load.at} />
          </>
        )}
    </Card>
  );
}

export function ReconView() {
  const ft = useFinT();
  const load = useLoad<Discrepancies | Unavail>(finUrl('/discrepancies'));
  return (
    <div className="space-y-4">
      <FinCard title={ft('findings')} icon={<AlertTriangle size={16} />} source="/api/admin/finance/discrepancies" load={load}>
        {(d) => {
          const found = (d.findings || []).filter((f) => f.count > 0);
          return (
            <div className="space-y-3">
              {found.length === 0 ? <Notice tone="good">{ft('noFindings')}</Notice> : found.map((f) => (
                <details key={f.code} className="rounded-lg border border-line p-3" open>
                  <summary className="cursor-pointer text-sm">
                    <span style={{ color: f.severity === 'bad' ? 'var(--status-critical)' : 'var(--status-warning)' }}>●</span>{' '}
                    <b>{ft(`f_${f.code}` as FinKey) === `f_${f.code}` ? f.code : ft(`f_${f.code}` as FinKey)}</b> — <b>{fa(f.count)}</b>
                    <span className="ms-2 text-[11px] text-ink-muted">· <span dir="ltr">{f.source}</span></span>
                  </summary>
                  <div className="mt-2">
                    <p className="mb-1 text-[11px] text-ink-muted">{ft('items')}</p>
                    <Table head={[ft('shop'), ft('receipt'), ft('amount'), ft('date'), '']} empty={!f.items?.length}>
                      {(f.items || []).map((it, i) => (
                        <Row key={`${it.paymentId || it.subscriptionId}-${i}`}>
                          <Cell>{it.tenantName || it.tenantId || String((it as { shopId?: string }).shopId || '—')} {it.app && <span className="text-[11px] text-ink-muted">· {appLabel(ft, it.app)}</span>}</Cell>
                          <Cell mono>{it.receiptNo || it.paymentId || it.subscriptionId || String((it as { id?: string }).id || '—')}</Cell>
                          <Cell>{it.currency ? money(it.amount, it.currency) : minorText((it as { amountMinor?: number }).amountMinor)}</Cell>
                          <Cell>{dateOf(it.paidAt)}</Cell>
                          <Cell mono>{['subscriptionCurrency', 'reference', 'excess', 'price'].filter((k) => it[k] !== undefined).map((k) => `${k}=${String(it[k])}`).join(' · ') || ''}</Cell>
                        </Row>
                      ))}
                    </Table>
                  </div>
                </details>
              ))}
              <div>
                <h3 className="mb-2 text-sm font-semibold">{ft('gateway')}</h3>
                <GatewayCard gw={d.gateway as Gateway} />
              </div>
            </div>
          );
        }}
      </FinCard>
      <OnlineReconCard />
    </div>
  );
}

/* ─────────────────────────────── تاریخچه ─────────────────────────────── */

export function HistoryView() {
  const ft = useFinT();
  const [action, setAction] = useState('');
  const [extra, setExtra] = useState<History['entries']>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const url = finUrl('/history', { action: action || undefined, limit: 50 });
  const load = useLoad<History | Unavail>(url);
  useEffect(() => { setExtra([]); setCursor(null); }, [url]);
  const first = load.data && !isUnavail(load.data) ? load.data : null;
  const rows = [...(first?.entries || []), ...extra];
  const nextCursor = cursor ?? first?.nextCursor ?? null;
  const more = async () => {
    try {
      const page = await api<History>(finUrl('/history', { action: action || undefined, limit: 50, cursor: nextCursor }));
      setExtra((x) => [...x, ...(page.entries || [])]);
      setCursor(page.nextCursor || '');
    } catch (e) { toast(errText(e), 'bad'); }
  };
  return (
    <FinCard title={ft('tabHistory')} icon={<HistoryIcon size={16} />} source="/api/admin/finance/history" load={load}
             action={(
               <select className="input w-auto" value={action} aria-label={ft('action')} onChange={(e) => setAction(e.target.value)}>
                 <option value="">{ft('anyAction')}</option>
                 {(first?.actions || []).map((a) => <option key={a} value={a}>{actionLabel(ft, a)}</option>)}
               </select>
             )}>
      {() => (
        <>
          {rows.length === 0 ? <Notice>{ft('historyEmpty')}</Notice> : (
            <Table head={[ft('date'), ft('action'), ft('actor'), ft('target'), ft('reason')]}>
              {rows.map((x) => (
                <Row key={x.id}>
                  <Cell>{timeOf(x.at)}</Cell>
                  <Cell>{actionLabel(ft, x.action)}</Cell>
                  <Cell>{actorText(x.actor, x.adminId)}</Cell>
                  <Cell mono>{x.targetId || '—'}</Cell>
                  <Cell>{typeof x.detail?.reason === 'string' ? x.detail.reason : '—'}</Cell>
                </Row>
              ))}
            </Table>
          )}
          {nextCursor && <div className="mt-3"><ActionButton onClick={more}>{ft('more')}</ActionButton></div>}
        </>
      )}
    </FinCard>
  );
}
