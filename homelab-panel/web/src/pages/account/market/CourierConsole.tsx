// ---------------------------------------------------------------------------
//  🛵 ۴.۷ نظارت بر پیک و تحویل — همهٔ دکان‌ها، از دادهٔ واقعیِ سرورِ حساب (`/api/admin/delivery/*` ِ shop)
//
//  نما‌ها (‎?view=‎): نمای کلی · صفِ کار (منتظرِ ارسال، سپرده، در راه، ناموفق، گیرکرده، ناهم‌خوان، اختلاف) ·
//  رویدادها · اتصالِ پیک · گزارشِ کارکرد · آستانه‌ها.
//  ⛔ جای «میزِ تحویلِ» دکان را نمی‌گیرد: سپردن، فراخوانی و تسویه همان‌جا می‌ماند. کنترلِ مرکزی فقط دو تا و امن:
//     آستانه‌های «گیر کرده» (ارشد + دلیل + احرازِ دوباره) و خاموش کردنِ سرویسِ تحویلِ یک دکان (همان درِ حالت‌ها).
//  ⛔ بی دادهٔ شخصیِ مشتری؛ نیامده «—»؛ تپشِ قلبِ پیک در مدل نیست و همین گفته می‌شود.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { Activity, BarChart3, ListChecks, Radio, Settings2, Truck } from 'lucide-react';

import { api } from '../../../api';
import { useApp } from '../../../app-context';
import { Cell, KV, Notice, Row, Stat, Table, Tabs } from '../../../control/ui';
import { isUnavailable } from '../consoleData';
import { useLoad } from '../shared';
import {
  ISSUE_LABEL, MC, QUEUE_VIEWS, STAGE_LABEL, THRESHOLD_KEYS, THRESHOLD_LABEL, age, money, shownNum, sumMismatches, thresholdOk,
  type Connectivity, type DEvents, type DReport, type DeliveryOverview, type Queue, type Thresholds,
} from './marketData';
import { Box, Chip, CsvButton, IssueChips, Pager, SensitiveDialog, ServiceHoldDialog, moment } from './parts';
import { useTx } from './tx';
import type { ModuleProps } from './MarketConsole';

const VIEWS = ['overview', 'queue', 'events', 'connectivity', 'report', 'thresholds'] as const;
type View = (typeof VIEWS)[number];

/* ───────────────────────────── نمای کلی ───────────────────────────── */

function Overview({ go }: { go: (v: View, extra?: Record<string, string>) => void }) {
  const { tx, tri } = useTx();
  const load = useLoad<DeliveryOverview>(MC.dOverview(7), []);
  const d = load.data && !isUnavailable(load.data) ? load.data : null;
  return (
    <Box title={tx('پیک و تحویل — نمای کلی', 'Couriers & delivery — overview', 'پېک او سپارنه')} icon={<Truck size={16} />}
         source="/api/admin/delivery/overview" load={load}>
      {() => d && (
        <div className="space-y-3">
          {d.truncated && <Notice tone="warn">{tx('بیش از ۵۰۰۰ سفارش زیرِ نظر؛ فقط تازه‌ترین‌ها شمرده شدند.', 'More than 5000 watched orders; only the newest were counted.', 'له ۵۰۰۰ زیات.')}</Notice>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {(['dispatch', 'assigned', 'in_delivery', 'failed', 'preparing'] as const).map((s) => (
              <Stat key={s} label={tri(STAGE_LABEL[s], s)} value={shownNum(d.stages?.[s])} onClick={() => go('queue', { q: s })}
                    tone={s === 'failed' && (d.stages?.failed || 0) > 0 ? 'warn' : undefined} />
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label={tx('گیرکرده', 'Stuck', 'بند')} value={shownNum(d.ordersWith?.stuck)} tone={(d.ordersWith?.stuck || 0) > 0 ? 'warn' : undefined} onClick={() => go('queue', { q: 'stuck' })} />
            <Stat label={tx('ناهم‌خوانیِ سفارش و تحویل', 'Order vs delivery mismatch', 'ناسمون')} value={shownNum(d.ordersWith?.mismatch)} tone={(d.ordersWith?.mismatch || 0) > 0 ? 'bad' : undefined} onClick={() => go('queue', { q: 'mismatch' })} />
            <Stat label={tx('اختلافِ پول', 'Money discrepancy', 'د پیسو توپیر')} value={shownNum(d.ordersWith?.discrepancy)} tone={(d.ordersWith?.discrepancy || 0) > 0 ? 'bad' : undefined} onClick={() => go('queue', { q: 'discrepancy' })} />
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <div>
              <h4 className="mb-1 text-[11px] font-semibold">{tx('کدها', 'Codes', 'کوډونه')}</h4>
              {Object.entries({ ...(d.stuck || {}), ...(d.mismatch || {}), ...(d.discrepancy || {}) }).map(([k, n]) => (
                <KV key={k} label={tri(ISSUE_LABEL[k], k)}>{shownNum(n)}</KV>
              ))}
            </div>
            <div>
              <h4 className="mb-1 text-[11px] font-semibold">{tx('۲۴ ساعتِ گذشته', 'Last 24h', 'تېر ۲۴ ساعته')}</h4>
              <KV label={tx('مأموریتِ تازه', 'New missions', 'نوي ماموریتونه')}>{shownNum(d.last24h?.created)}</KV>
              <KV label={tx('تحویل شد', 'Delivered', 'سپارل شوي')}>{shownNum(d.last24h?.delivered)}</KV>
              <KV label={tx('ناموفق', 'Failed', 'ناکام')}>{shownNum(d.last24h?.failed)}</KV>
              <KV label={tx('برگشت', 'Returned', 'بېرته')}>{shownNum(d.last24h?.returned)}</KV>
            </div>
            <div>
              <h4 className="mb-1 text-[11px] font-semibold">{tx('پیک و سرویس', 'Couriers & service', 'پېک او خدمت')}</h4>
              <KV label={tx('پیک (فعال/همه)', 'Couriers (active/all)', 'پېک')}>{shownNum(d.couriers?.active)}/{shownNum(d.couriers?.total)} · {tx('{n} دکان', '{n} shops', '{n} هټۍ', { n: shownNum(d.couriers?.shops) })}</KV>
              <KV label={tx('پرچمِ shop.delivery برای همه', 'shop.delivery for all', 'د ټولو لپاره')}>{d.service?.flagAllSet ? (d.service?.flagAll ? tx('روشن', 'On', 'روښانه') : tx('خاموش', 'Off', 'بند')) : tx('نوشته نشده (خاموش)', 'Not set (off)', 'نه دی لیکل (بند)')}</KV>
              <KV label={tx('دکان‌های روشن/خاموش', 'Shops on/off', 'هټۍ')}>{shownNum(d.service?.shopsOn)}/{shownNum(d.service?.shopsOff)}</KV>
              <KV label={tx('خاموش به دستِ مدیر', 'Disabled by admin', 'د مدیر لخوا بند')}>{shownNum(d.service?.heldByAdmin)}</KV>
            </div>
          </div>
          <p className="text-[11px] text-ink-muted">{tx('زیرِ نظر: سفارش‌های باز و آن‌ها که در {n} روزِ گذشته عوض شده‌اند ({s} سفارش).', 'Watched: open orders and those changed in the last {n} days ({s} orders).', 'تر نظر لاندې: {s}.', { n: shownNum(d.windowDays), s: shownNum(d.scanned) })}</p>
        </div>
      )}
    </Box>
  );
}

/* ───────────────────────────── صفِ کار ───────────────────────────── */

const PAGE = 50;

function QueueView({ params, setParams }: ModuleProps) {
  const { tx, tri, lang } = useTx();
  const { can } = useApp();
  const view = QUEUE_VIEWS.includes(params.get('q') || '') ? (params.get('q') as string) : 'all';
  const shopId = params.get('shop') || '';
  const [offset, setOffset] = useState(0);
  const [shopInput, setShopInput] = useState(shopId);
  const [hold, setHold] = useState<{ shopId: string; shopName?: string } | null>(null);
  const [done, setDone] = useState('');
  const load = useLoad<Queue>(MC.dQueue({ view, shopId, limit: PAGE, offset }), [view, shopId, offset]);
  const d = load.data && !isUnavailable(load.data) ? load.data : null;
  const set = (patch: Record<string, string>) => {
    setOffset(0);
    const next: Record<string, string> = { view: 'queue', q: view, shop: shopId, ...patch };
    setParams(Object.fromEntries(Object.entries(next).filter(([, v]) => v)));
  };
  const viewLabel = (v: string) => STAGE_LABEL[v] ? tri(STAGE_LABEL[v], v) : ({
    all: tx('همه', 'All', 'ټول'), stuck: tx('گیرکرده', 'Stuck', 'بند'), mismatch: tx('ناهم‌خوان', 'Mismatch', 'ناسمون'),
    discrepancy: tx('اختلافِ پول', 'Money discrepancy', 'توپیر'),
  } as Record<string, string>)[v] || v;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select className="input w-auto" value={view} onChange={(e) => set({ q: e.target.value })} aria-label="view">
          {QUEUE_VIEWS.map((v) => <option key={v} value={v}>{viewLabel(v)}</option>)}
        </select>
        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); set({ shop: shopInput.trim() }); }}>
          <input className="input w-44" dir="ltr" value={shopInput} onChange={(e) => setShopInput(e.target.value)} placeholder={tx('شناسهٔ دکان', 'Shop id', 'د هټۍ پېژند')} />
          <button className="btn btn-sm" type="submit">{tx('پالایش', 'Filter', 'چاڼ')}</button>
        </form>
        {can('admin') && <CsvButton url={MC.dQueueCsv({ view, shopId })} name="delivery-queue.csv" />}
      </div>
      {done && <Notice tone="good">{done}</Notice>}
      <Box title={`${tx('صفِ تحویل', 'Delivery queue', 'د سپارنې کتار')} — ${viewLabel(view)}`} icon={<ListChecks size={16} />}
           source="/api/admin/delivery/queue" load={load}>
        {() => d && (
          <>
            {d.truncated && <Notice tone="warn">{tx('فقط ۵۰۰۰ سفارشِ تازه‌تر سنجیده شد.', 'Only the newest 5000 orders were checked.', 'یوازې ۵۰۰۰.')}</Notice>}
            <Table head={[tx('دکان', 'Shop', 'هټۍ'), '#', tx('سفارش', 'Order', 'فرمایش'), tx('جای در صف', 'Stage', 'پړاو'), tx('مأموریت', 'Mission', 'ماموریت'),
              tx('پیک', 'Courier', 'پېک'), tx('بی تغییر از', 'Unchanged for', 'بې بدلون'), tx('مشکل', 'Issues', 'ستونزې'), '']} empty={(d.rows || []).length === 0}>
              {(d.rows || []).map((r) => (
                <Row key={r.orderId}>
                  <Cell>{r.shopName || r.shopId}</Cell>
                  <Cell mono>{shownNum(r.orderNo)}</Cell>
                  <Cell mono>{r.status}</Cell>
                  <Cell>{r.stage ? tri(STAGE_LABEL[r.stage], r.stage) : '—'}</Cell>
                  <Cell mono>{r.mission ? `${r.mission.status} (${r.mission.mode || '—'}) #${shownNum(r.mission.attemptNo)}` : '—'}</Cell>
                  <Cell>{r.mission?.courierName || '—'}</Cell>
                  <Cell>{age(r.ageMs, lang)}</Cell>
                  <Cell><IssueChips issues={r.issues} /></Cell>
                  <Cell>{can('admin') && <button className="btn btn-sm" onClick={() => { setDone(''); setHold({ shopId: r.shopId, shopName: r.shopName }); }}>{tx('خاموشیِ تحویلِ دکان', 'Disable shop delivery', 'سپارنه بندول')}</button>}</Cell>
                </Row>
              ))}
            </Table>
            <Pager total={d.total} limit={PAGE} offset={offset} onChange={setOffset} />
            <p className="mt-2 text-[11px] text-ink-muted">{tx('سپردن، پس گرفتن و فراخوانی کارِ میزِ تحویلِ خودِ دکان است؛ این‌جا فقط دیدن و خاموش کردنِ سرویسِ یک دکان.',
              'Assigning, withdrawing and recalling stay in each shop\'s delivery desk; here you only watch, or disable one shop\'s service.', 'سپارل د هټۍ کار دی.')}</p>
          </>
        )}
      </Box>
      {hold && (
        <ServiceHoldDialog shopId={hold.shopId} shopName={hold.shopName} service="shop.delivery" onClose={() => setHold(null)}
                           onDone={() => { setHold(null); setDone(tx('سرورِ حساب تأیید کرد — تحویلِ این دکان خاموش شد (از «فروشگاه‌ها ← پرونده» برداشتنی است).', 'Confirmed by the account server — delivery is off for this shop (lift it from Shops → profile).', 'تایید شو.')); }} />
      )}
    </div>
  );
}

/* ───────────────────────────── رویدادها ───────────────────────────── */

function EventsView() {
  const { tx } = useTx();
  const [kind, setKind] = useState('');
  const [before, setBefore] = useState<number | null>(null);
  const load = useLoad<DEvents>(MC.dEvents({ kind, before, limit: 50 }), [kind, before]);
  const d = load.data && !isUnavailable(load.data) ? load.data : null;
  const ev = d?.events || [];
  const last = ev.length === 50 ? ev[ev.length - 1]?.serverTime : null;
  return (
    <Box title={tx('رویدادهای کلیدی', 'Key events', 'مهمې پېښې')} icon={<Activity size={16} />} source="/api/admin/delivery/events" load={load}
         action={<span className="flex gap-1">
           <select className="input w-auto text-xs" value={kind} onChange={(e) => { setBefore(null); setKind(e.target.value); }} aria-label="kind">
             <option value="">{tx('همه', 'All', 'ټول')}</option>
             {['status', 'recall', 'code', 'photo', 'created'].map((k) => <option key={k} value={k}>{k}</option>)}
           </select>
           {before ? <button className="btn btn-sm" onClick={() => setBefore(null)}>{tx('تازه‌ترین', 'Newest', 'نوي')}</button> : null}
         </span>}>
      {() => (
        <>
          <Table head={[tx('زمانِ سرور', 'Server time', 'د سرور وخت'), tx('دکان', 'Shop', 'هټۍ'), '#', tx('نوع', 'Kind', 'ډول'), tx('گذار', 'Transition', 'بدلون'),
            tx('کننده', 'Actor', 'کوونکی'), tx('دلیل', 'Reason', 'لامل'), tx('اختلافِ ساعتِ دستگاه', 'Device clock skew', 'د وسیلې ساعت')]} empty={ev.length === 0}>
            {ev.map((e) => (
              <Row key={e.id}>
                <Cell>{moment(e.serverTime)}</Cell>
                <Cell>{e.shopName || e.shopId}</Cell>
                <Cell mono>{shownNum(e.orderNo)}</Cell>
                <Cell mono>{e.kind}</Cell>
                <Cell mono>{e.from || '·'} → {e.to || '·'}</Cell>
                <Cell mono>{e.actorType || '—'}</Cell>
                <Cell mono>{e.reason || '—'}</Cell>
                <Cell>{e.skewMs === null || e.skewMs === undefined ? '—' : `${Math.round(e.skewMs / 1000).toLocaleString('fa-AF')} s`}</Cell>
              </Row>
            ))}
          </Table>
          {last ? <button className="btn btn-sm mt-2" onClick={() => setBefore(Number(last))}>{tx('قدیمی‌تر', 'Older', 'زاړه')}</button> : null}
        </>
      )}
    </Box>
  );
}

/* ───────────────────────────── اتصالِ پیک ───────────────────────────── */

function ConnectivityView() {
  const { tx } = useTx();
  const load = useLoad<Connectivity>(MC.dConnectivity, []);
  return (
    <Box title={tx('اتصالِ سرویسِ پیک', 'Courier service connectivity', 'د پېک خدمت اړیکه')} icon={<Radio size={16} />}
         source="/api/admin/delivery/connectivity" load={load}>
      {(d) => (
        <div className="space-y-2">
          <Notice tone="info">{tx('برنامهٔ پیک رویدادهایش را به همین سرورِ حساب (‎/api/courier‎) می‌فرستد؛ تنها نشانهٔ زنده بودن رسیدنِ رویداد است. تپشِ قلب در مدل نیست و رویدادِ ردشده ذخیره نمی‌شود — پس «سبز» ِ اتصال ساخته نمی‌شود.',
            'The courier app posts events to this account server (/api/courier); the only live signal is events arriving. There is no heartbeat in the model and rejected events are not stored — so no "green" is invented.',
            'یوازې د پېښو رسېدل نښه ده؛ زړه ټکان په ماډل کې نشته.')}</Notice>
          <KV label={tx('آخرین رویدادِ پیک (همهٔ دکان‌ها)', 'Last courier event (all shops)', 'وروستۍ پېښه')}>{moment(d.lastCourierEventAt)}</KV>
          <Table head={[tx('دکان', 'Shop', 'هټۍ'), tx('پیک (فعال/همه)', 'Couriers', 'پېک'), tx('آخرین رویداد', 'Last event', 'وروستۍ پېښه'),
            tx('رویداد ۲۴ساعت', 'Events 24h', 'پېښې ۲۴'), tx('دستگاه ۲۴ساعت', 'Devices 24h', 'وسیلې'), tx('بیشترین اختلافِ ساعت', 'Max clock skew', 'ساعت'),
            tx('مأموریتِ زنده', 'Live missions', 'ژوندي ماموریتونه')]} empty={(d.shops || []).length === 0}>
            {(d.shops || []).map((s) => (
              <Row key={s.shopId}>
                <Cell>{s.shopName || s.shopId}</Cell>
                <Cell>{shownNum(s.active)}/{shownNum(s.couriers)}</Cell>
                <Cell>{moment(s.lastCourierEventAt)}</Cell>
                <Cell>{shownNum(s.events24h)}</Cell>
                <Cell>{shownNum(s.devices24h)}</Cell>
                <Cell>{s.maxSkewMs === null || s.maxSkewMs === undefined ? '—' : `${Math.round(s.maxSkewMs / 1000).toLocaleString('fa-AF')} s`}</Cell>
                <Cell>{shownNum(s.liveMissions)}{(s.liveMissions || 0) > 0 && !s.events24h ? <> <Chip tone="warn">{tx('مأموریت هست، رویداد نه', 'Missions but no events', 'ماموریت شته، پېښه نه')}</Chip></> : null}</Cell>
              </Row>
            ))}
          </Table>
        </div>
      )}
    </Box>
  );
}

/* ───────────────────────────── گزارشِ کارکرد ───────────────────────────── */

function ReportView() {
  const { tx } = useTx();
  const [days, setDays] = useState(7);
  const load = useLoad<DReport>(MC.dReport(days), [days]);
  return (
    <Box title={tx('گزارشِ کارکردِ پیک و نقد', 'Courier performance & cash', 'د پېک کارکرد او نغدې')} icon={<BarChart3 size={16} />}
         source="/api/admin/delivery/report" load={load}
         action={<select className="input w-auto text-xs" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="days">
           {[1, 7, 30, 90].map((n) => <option key={n} value={n}>{tx('{n} روز', '{n} days', '{n} ورځې', { n: shownNum(n) })}</option>)}
         </select>}>
      {(d) => {
        const rows = d.rows || [];
        const bad = sumMismatches(rows, d.totals);
        return (
          <div className="space-y-2">
            {bad.length === 0
              ? <Chip tone="good">{tx('جمعِ ردیف‌ها = جمعِ کل', 'Rows add up to totals', 'جمع سمه ده')}</Chip>
              : <Chip tone="bad">{tx('جمعِ ردیف‌ها با کل نمی‌خواند: {k}', 'Rows do not add up: {k}', 'جمع نه برابرېږي: {k}', { k: bad.join(', ') })}</Chip>}
            <Table head={[tx('دکان', 'Shop', 'هټۍ'), tx('پیک', 'Courier', 'پېک'), tx('تحویل', 'Delivered', 'سپارل'), tx('برگشت', 'Returned', 'بېرته'),
              tx('ردِ پیک', 'Rejected', 'رد'), tx('میانه (دقیقه)', 'Median (min)', 'منځنی'), tx('نقدِ گرفته', 'Cash collected', 'نغدې'), tx('تسویه‌نشده', 'Unsettled', 'نه تصفیه'),
              tx('کسری/اضافه', 'Short/excess', 'کمی/زیات'), tx('در دست', 'In hand', 'په لاس کې')]} empty={rows.length === 0}>
              {rows.map((r) => (
                <Row key={`${r.shopId}-${r.courierId || 'x'}`}>
                  <Cell>{r.shopName || r.shopId}</Cell>
                  <Cell>{r.courierName || (r.courierId ? r.courierId : tx('بی پیکِ دکان', 'No shop courier', 'بې پېکه'))}</Cell>
                  <Cell>{shownNum(r.delivered)}</Cell>
                  <Cell>{shownNum(r.returned)}</Cell>
                  <Cell>{shownNum(r.rejected)}</Cell>
                  <Cell>{shownNum(r.medianMinutes)}</Cell>
                  <Cell>{money(r.collectedCashMinor)}</Cell>
                  <Cell>{money(r.unsettledMinor)}</Cell>
                  <Cell>{money(r.shortageMinor)} / {money(r.excessMinor)}</Cell>
                  <Cell>{money(r.inHandMinor)}</Cell>
                </Row>
              ))}
              {rows.length > 0 && (
                <Row>
                  <Cell className="font-semibold">{tx('جمعِ کل', 'Totals', 'ټول')}</Cell><Cell>{''}</Cell>
                  <Cell>{shownNum(d.totals?.delivered)}</Cell><Cell>{shownNum(d.totals?.returned)}</Cell><Cell>{shownNum(d.totals?.rejected)}</Cell><Cell>{'—'}</Cell>
                  <Cell>{money(d.totals?.collectedCashMinor)}</Cell><Cell>{money(d.totals?.unsettledMinor)}</Cell>
                  <Cell>{money(d.totals?.shortageMinor)} / {money(d.totals?.excessMinor)}</Cell><Cell>{money(d.totals?.inHandMinor)}</Cell>
                </Row>
              )}
            </Table>
            <p className="text-[11px] text-ink-muted">{tx('تعریف‌ها همان گزارشِ نقدِ پیکِ دکان (RPT-15) است: «گرفته» از زمانِ تحویل، «تسویه» از زمانِ سند، «در دست» همین لحظه. دیدنِ این گزارش در سابقهٔ سرورِ حساب ثبت می‌شود.',
              'Same definitions as the shop courier cash report (RPT-15): collected by delivery time, settled by document time, in-hand right now. Viewing is logged on the account server.',
              'تعریفونه د RPT-15 دي.')}</p>
          </div>
        );
      }}
    </Box>
  );
}

/* ───────────────────────────── آستانه‌ها ───────────────────────────── */

function ThresholdsView() {
  const { tx, tri } = useTx();
  const { can } = useApp();
  const load = useLoad<Thresholds>(MC.dThresholds, []);
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState('');
  const d = load.data && !isUnavailable(load.data) ? load.data : null;
  const parsed = edit ? Object.fromEntries(Object.entries(edit).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])) : {};
  const valid = Object.keys(parsed).length > 0 && Object.values(parsed).every(thresholdOk);
  return (
    <div className="space-y-3">
      {done && <Notice tone="good">{done}</Notice>}
      <Box title={tx('آستانه‌های «گیر کرده» (دقیقه)', '"Stuck" thresholds (minutes)', 'د «بند» حدونه (دقیقې)')} icon={<Settings2 size={16} />}
           source="/api/admin/delivery/thresholds" load={load}
           action={can('admin') && d ? <button className="btn btn-sm" onClick={() => setEdit(Object.fromEntries(THRESHOLD_KEYS.map((k) => [k, String(d.values?.[k] ?? '')])))}>{tx('ویرایش', 'Edit', 'سمول')}</button> : undefined}>
        {() => d && (
          <>
            {THRESHOLD_KEYS.map((k) => (
              <KV key={k} label={tri(THRESHOLD_LABEL[k], k)}>
                {edit ? (
                  <input className="input w-24 text-end" dir="ltr" inputMode="numeric" value={edit[k] ?? ''}
                         onChange={(e) => setEdit({ ...edit, [k]: e.target.value.replace(/[^0-9]/g, '') })} aria-label={k} />
                ) : <>{shownNum(d.values?.[k])} · <span className="text-[11px] text-ink-muted">{d.source?.[k] === 'live_config' ? tx('تنظیم‌شده', 'set', 'ټاکل شوی') : tx('پیش‌فرض', 'default', 'اصلي')}</span></>}
              </KV>
            ))}
            {edit && (
              <div className="mt-2 flex gap-2">
                <button className="btn btn-sm" onClick={() => setEdit(null)}>{tx('انصراف', 'Cancel', 'لغوه')}</button>
                <button className="btn btn-sm btn-primary" disabled={!valid} onClick={() => setConfirm(true)}>{tx('ذخیره…', 'Save…', 'خوندي…')}</button>
                {!valid && <span className="text-[11px] text-ink-muted">{tx('هر عدد ۱ تا ۱۰٬۰۸۰ دقیقه', 'Each 1–10,080 minutes', 'هر عدد ۱ تر ۱۰٬۰۸۰')}</span>}
              </div>
            )}
          </>
        )}
      </Box>
      {confirm && (
        <SensitiveDialog title={tx('ذخیرهٔ آستانه‌ها', 'Save thresholds', 'حدونه خوندي کول')} onClose={() => setConfirm(false)}
          effect={tx('فقط نمایشِ «گیر کرده» در همین بخش عوض می‌شود؛ هیچ سفارش یا مأموریتی دست نمی‌خورد. مقدارِ پیشین و دلیل در تاریخچهٔ تنظیماتِ سرورِ حساب می‌ماند.',
            'Only what this console flags as "stuck" changes; no order or mission is touched. The previous value and reason stay in the account server\'s settings history.',
            'یوازې د «بند» ښودنه بدلېږي.')}
          send={async (reason, password) => {
            const out = await api<Thresholds>(MC.dThresholds, { method: 'PUT', body: { thresholds: parsed, reason, password, confirm: true } });
            setConfirm(false);
            setEdit(null);
            setDone(out?.unchanged ? tx('همان مقدارِ پیشین بود — چیزی عوض نشد.', 'Same as before — nothing changed.', 'هماغه و.') : tx('ذخیره شد (تأییدِ سرور).', 'Saved (server-confirmed).', 'خوندي شو.'));
            void load.reload();
          }} />
      )}
    </div>
  );
}

/* ───────────────────────────── خودِ ماژول ───────────────────────────── */

export default function CourierModule({ params, setParams }: ModuleProps) {
  const { tx } = useTx();
  const wanted = params.get('view') as View | null;
  const view: View = wanted && (VIEWS as readonly string[]).includes(wanted) ? wanted : 'overview';
  const go = (v: View, extra: Record<string, string> = {}) => setParams(v === 'overview' ? {} : { view: v, ...extra });
  const label: Record<View, string> = {
    overview: tx('نمای کلی', 'Overview', 'عمومي'), queue: tx('صفِ کار', 'Queue', 'کتار'), events: tx('رویدادها', 'Events', 'پېښې'),
    connectivity: tx('اتصالِ پیک', 'Connectivity', 'اړیکه'), report: tx('گزارشِ کارکرد', 'Performance', 'کارکرد'),
    thresholds: tx('آستانه‌ها', 'Thresholds', 'حدونه'),
  };
  return (
    <div className="space-y-3">
      <Tabs tabs={VIEWS.map((id) => ({ id, label: label[id] }))} active={view} onChange={(id) => go(id as View)} />
      {view === 'overview' && <Overview go={go} />}
      {view === 'queue' && <QueueView params={params} setParams={setParams} />}
      {view === 'events' && <EventsView />}
      {view === 'connectivity' && <ConnectivityView />}
      {view === 'report' && <ReportView />}
      {view === 'thresholds' && <ThresholdsView />}
    </div>
  );
}
