// ---------------------------------------------------------------------------
//  🛒 ۴.۶ مدیریتِ بازار — **فقط سمتِ مدیریت** (برنامه و سایتِ خرید بیرون است، §۴۰.۵)
//
//  نما‌ها (‎?view=‎): نمای کلی · فروشنده‌ها · سفارش‌ها · گزارش‌ها و جریمه‌ها · کمیسیون · سابقهٔ کارهای حساس.
//  ⛔ هر عدد از سرورِ حساب (`/api/admin/market/*` و `/api/admin/trust/*` ِ shop) با منبع و زمان؛ نیامده «—».
//  ⛔ آن‌چه در مدل نیست صادقانه گفته می‌شود: فروشندهٔ مستقل، «تأییدِ فروشنده»، سبدِ چنددکانی، کمیسیون (#432)،
//     تسویه با فروشنده (پول فقط نقد و به دکان می‌رسد، D-08) — نه عددِ ساختگی، نه دکمهٔ بی‌عمل.
//  ⛔ تعلیقِ فروشنده = همان حالتِ «خاموشیِ سرویس» ِ دکان (`market.directory` / `shop.storefront`)، نه درِ دوم.
//  ⛔ مجوز در سرور است؛ پنهان کردنِ دکمه برای غیرِ admin فقط برای این است که درخواستِ بی‌نتیجه نزند.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { AlertTriangle, BadgePercent, FileClock, Flag, ShoppingBag, Store } from 'lucide-react';

import { api } from '../../../api';
import { useApp } from '../../../app-context';
import { Cell, KV, Notice, Row, Stat, Table, Tabs } from '../../../control/ui';
import { isUnavailable } from '../consoleData';
import { useLoad } from '../shared';
import {
  GATE_LABEL, MC, ORDER_GROUPS, SANCTION_LABEL, SELLER_STATES, money, shownNum,
  type Commission, type History, type MarketOrders, type MarketOverview, type Sanction, type Seller, type Sellers,
  type TrustCase, type TrustCaseFull,
} from './marketData';
import { Box, Chip, CsvButton, IssueChips, Pager, SensitiveDialog, ServiceHoldDialog, errText, moment } from './parts';
import { useTx } from './tx';

export type ModuleProps = { params: URLSearchParams; setParams: (next: Record<string, string>) => void };

const VIEWS = ['overview', 'sellers', 'orders', 'reports', 'commission', 'history'] as const;
type View = (typeof VIEWS)[number];

/* ───────────────────────────── نمای کلی ───────────────────────────── */

function Overview({ go }: { go: (v: View, extra?: Record<string, string>) => void }) {
  const { tx, tri } = useTx();
  const [days, setDays] = useState(30);
  const load = useLoad<MarketOverview>(MC.overview(days), [days]);
  const d = load.data && !isUnavailable(load.data) ? load.data : null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        {tx('بازهٔ سفارش‌ها', 'Orders window', 'د فرمایشونو موده')}:
        {[1, 7, 30, 90].map((n) => (
          <button key={n} className={`btn btn-sm ${days === n ? 'btn-primary' : ''}`} onClick={() => setDays(n)}>
            {tx('{n} روز', '{n} d', '{n} ورځې', { n: shownNum(n) })}
          </button>
        ))}
      </div>
      <Box title={tx('بازار — نمای کلی', 'Marketplace — overview', 'بازار — عمومي کتنه')} icon={<Store size={16} />}
           source="/api/admin/market/overview" load={load}>
        {() => d && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={tx('فروشنده (دکانِ VILL3N)', 'Sellers (VILL3N shops)', 'پلورونکي (VILL3N هټۍ)')} value={shownNum(d.sellers?.total)}
                    sub={tx('در فهرست: {a} · باز: {b}', 'listed: {a} · open: {b}', 'په لړلیک کې: {a} · خلاص: {b}', { a: shownNum(d.sellers?.listed), b: shownNum(d.sellers?.listedOpen) })}
                    onClick={() => go('sellers')} />
              <Stat label={tx('بازارِ همگانی', 'Marketplace (all shops)', 'عمومي بازار')}
                    value={d.directory?.on === true ? tx('روشن', 'On', 'روښانه') : d.directory?.on === false ? tx('خاموش', 'Off', 'بند') : '—'}
                    tone={d.directory?.on ? 'good' : 'warn'}
                    sub={tx('پرچمِ {f} · دکان‌های روشن/خاموش: {a}/{b}', 'flag {f} · shops on/off: {a}/{b}', 'بیرغ {f}: {a}/{b}', { f: d.directory?.flag || 'market.directory', a: shownNum(d.directory?.perShop?.on), b: shownNum(d.directory?.perShop?.off) })} />
              <Stat label={tx('گزارشِ کالا در انتظار', 'Product reports pending', 'د توکو راپورونه په تمه')} value={shownNum(d.trust?.productReports)}
                    tone={(d.trust?.productReports || 0) > 0 ? 'warn' : undefined}
                    sub={tx('شکایت: {a} · اعتراض: {b}', 'complaints: {a} · appeals: {b}', 'شکایت: {a} · اعتراض: {b}', { a: shownNum(d.trust?.complaints), b: shownNum(d.trust?.appealed) })}
                    onClick={() => go('reports')} />
              <Stat label={tx('سفارش‌های مشکل‌دار', 'Problem orders', 'ستونزمن فرمایشونه')}
                    value={shownNum((d.orders?.problems?.stuck ?? 0) + (d.orders?.problems?.mismatch ?? 0) + (d.orders?.problems?.discrepancy ?? 0))}
                    tone={((d.orders?.problems?.stuck ?? 0) + (d.orders?.problems?.mismatch ?? 0) + (d.orders?.problems?.discrepancy ?? 0)) > 0 ? 'bad' : undefined}
                    sub={tx('گیرکرده {a} · ناهم‌خوان {b} · اختلاف {c}', 'stuck {a} · mismatch {b} · discrepancy {c}', 'بند {a} · ناسمون {b} · توپیر {c}', { a: shownNum(d.orders?.problems?.stuck), b: shownNum(d.orders?.problems?.mismatch), c: shownNum(d.orders?.problems?.discrepancy) })}
                    onClick={() => go('orders', { problem: '1' })} />
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              <div>
                <h4 className="mb-1 text-[11px] font-semibold">{tx('سفارش‌های ویترین در بازه', 'Storefront orders in window', 'د ننداریز فرمایشونه')}</h4>
                <KV label={tx('همه', 'All', 'ټول')}>{shownNum(d.orders?.total)}</KV>
                {ORDER_GROUPS.map((g) => <KV key={g} label={groupLabel(tx, g)}>{shownNum(d.orders?.groups?.[g])}</KV>)}
                {Object.entries(d.orders?.completedTotalMinor || {}).map(([cur, v]) => (
                  <KV key={cur} label={tx('مبلغِ تحویل‌شده', 'Completed amount', 'د سپارل شویو مبلغ')}>{money(v, cur)}</KV>
                ))}
              </div>
              <div>
                <h4 className="mb-1 text-[11px] font-semibold">{tx('بستنِ مدیر', 'Admin blocks', 'د مدیر بندیزونه')}</h4>
                {Object.entries(d.holds || {}).map(([svc, n]) => <KV key={svc} label={`${tx('سرویسِ خاموش', 'Service off', 'بند خدمت')} · ${svc}`}>{shownNum(n)}</KV>)}
                {Object.entries(d.sanctions || {}).map(([k, n]) => <KV key={k} label={`${tx('جریمهٔ فعال', 'Active sanction', 'فعاله جریمه')} · ${tri(SANCTION_LABEL[k], k)}`}>{shownNum(n)}</KV>)}
              </div>
              <div>
                <h4 className="mb-1 text-[11px] font-semibold">{tx('آن‌چه در مدل هست و نیست', 'What the model has', 'څه په ماډل کې شته')}</h4>
                <KV label={tx('فروشندهٔ مستقل (بیرون از VILL3N)', 'Independent sellers', 'خپلواک پلورونکي')}>
                  {d.sellerKinds?.independent === null ? tx('در مدل نیست', 'Not in the model', 'په ماډل کې نشته') : shownNum(d.sellerKinds?.independent)}
                </KV>
                <KV label={tx('تأییدِ فروشنده', 'Seller approval', 'د پلورونکي تایید')}>
                  {tx('مرحله‌ای نیست: صاحبِ دکان خودش در فهرست می‌آید؛ سامانه با دروازه‌ها می‌بندد', 'No approval step: owners opt in; the platform blocks via gates', 'تایید نشته: خاوند پخپله راځي؛ سیستم په دروازو بندوي')}
                </KV>
                <KV label={tx('سبدِ چنددکانی', 'Multi-seller cart', 'څو هټۍ ټوکرۍ')}>
                  {d.multiSeller?.inModel ? shownNum(d.multiSeller?.groups) : tx('در مدل نیست (#432)', 'Not in the model (#432)', 'په ماډل کې نشته (#432)')}
                </KV>
                <KV label={tx('کمیسیون/کارمزد', 'Commission / fee', 'کمیشن')}>
                  {d.commission?.inModel ? tx('در مدل', 'In model', 'په ماډل کې') : tx('ستونش نیست — تصمیم: فعلاً صفر', 'No column — decision: zero for now', 'ستون نشته — پرېکړه: اوس صفر')}
                </KV>
                <KV label={tx('تسویه با فروشنده', 'Seller settlement', 'له پلورونکي سره تصفیه')}>
                  {tx('نیست: پول نقد و مستقیم به دکان می‌رسد (D-08)؛ تسویهٔ پیک ⇐ دکان در «پیک»', 'None: cash goes straight to the shop (D-08); courier→shop settlements are under Couriers', 'نشته: نغدې مستقیم هټۍ ته (D-08)')}
                </KV>
              </div>
            </div>
          </div>
        )}
      </Box>
    </div>
  );
}

const groupLabel = (tx: ReturnType<typeof useTx>['tx'], g: string) => ({
  awaiting: tx('منتظرِ پذیرش', 'Awaiting acceptance', 'د منلو په تمه'),
  in_progress: tx('در کار', 'In progress', 'په کار کې'),
  completed: tx('تحویل/برده‌شده', 'Completed', 'بشپړ'),
  cancelled: tx('رد/لغو', 'Rejected/cancelled', 'رد/لغوه'),
  returns: tx('برگشت و بازپرداخت', 'Returns & refunds', 'بېرته ورکړه'),
} as Record<string, string>)[g] || g;

/* ───────────────────────────── فروشنده‌ها ───────────────────────────── */

const SELLER_PAGE = 25;

function Sellers() {
  const { tx, tri } = useTx();
  const { can } = useApp();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [state, setState] = useState('');
  const [offset, setOffset] = useState(0);
  const [dialog, setDialog] = useState<{ s: Seller; service: string; hold?: { id: string } | null } | null>(null);
  const [done, setDone] = useState('');
  const load = useLoad<Sellers>(MC.sellers(query, state, SELLER_PAGE, offset), [query, state, offset]);
  const d = load.data && !isUnavailable(load.data) ? load.data : null;
  const stateLabel: Record<string, string> = {
    listed: tx('در فهرست', 'Listed', 'په لړلیک کې'), unlisted: tx('بیرون از فهرست', 'Not listed', 'بهر'),
    held: tx('بستهٔ مدیر', 'Blocked by admin', 'د مدیر بند'), sanctioned: tx('جریمه‌دار', 'Sanctioned', 'جریمه شوی'),
    inactive: tx('دکانِ غیرفعال', 'Inactive shop', 'غیرفعاله هټۍ'),
  };
  return (
    <div className="space-y-3">
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); setOffset(0); setQuery(q.trim()); }}>
        <input className="input w-60" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('نام، نشانیِ ویترین یا شناسه', 'Name, slug or id', 'نوم یا پېژند')} />
        <select className="input w-auto" value={state} onChange={(e) => { setOffset(0); setState(e.target.value); }} aria-label="state">
          <option value="">{tx('همه', 'All', 'ټول')}</option>
          {SELLER_STATES.map((s) => <option key={s} value={s}>{stateLabel[s]}</option>)}
        </select>
        <button className="btn btn-sm" type="submit">{tx('جست‌وجو', 'Search', 'لټون')}</button>
      </form>
      {done && <Notice tone="good">{done}</Notice>}
      <Box title={tx('فروشنده‌ها و دروازه‌هایشان', 'Sellers and their gates', 'پلورونکي او دروازې')} icon={<Store size={16} />}
           source="/api/admin/market/sellers" load={load}>
        {() => d && (
          <>
            <Table head={[tx('دکان', 'Shop', 'هټۍ'), tx('در بازار؟', 'In market?', 'په بازار کې؟'), tx('دروازه‌های بسته', 'Closed gates', 'بندې دروازې'),
              tx('بستن و جریمه', 'Holds & sanctions', 'بندیز او جریمه'), tx('پرونده', 'Cases', 'دوسیې'), tx('سفارشِ ۳۰ روز', 'Orders 30d', 'فرمایش ۳۰ ورځې'),
              tx('پیک', 'Courier', 'پېک'), tx('آخرین دیده', 'Last seen', 'وروستی لیدل'), '']} empty={(d.sellers || []).length === 0}>
              {(d.sellers || []).map((s) => {
                const marketHold = (s.holds || []).find((h) => h.kind === 'service_disabled' && h.service === 'market.directory');
                const sfHold = (s.holds || []).find((h) => h.kind === 'service_disabled' && h.service === 'shop.storefront');
                const blocked = s.blockedBy || [];
                return (
                  <Row key={s.shopId}>
                    <Cell>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-[11px] text-ink-muted" dir="ltr">{s.slug || '—'} · {s.category || '—'} · {s.shopId}</div>
                    </Cell>
                    <Cell>{blocked.length === 0 ? <Chip tone="good">{tx('همهٔ دروازه‌ها باز', 'All gates open', 'ټولې دروازې خلاصې')}</Chip>
                      : <Chip tone="warn">{tx('نه', 'No', 'نه')}</Chip>}</Cell>
                    <Cell><span className="flex flex-wrap gap-1">{blocked.map((g) => <Chip key={g} tone="warn" title={g}>{tri(GATE_LABEL[g], g)}</Chip>)}</span></Cell>
                    <Cell>
                      <span className="flex flex-wrap gap-1">
                        {(s.holds || []).map((h) => <Chip key={h.id} tone="bad" title={h.id}>{h.kind === 'service_disabled' ? h.service : h.kind}</Chip>)}
                        {(s.sanctions || []).map((x) => <Chip key={x.id} tone="bad" title={x.id}>{tri(SANCTION_LABEL[x.kind], x.kind)}</Chip>)}
                        {!(s.holds || []).length && !(s.sanctions || []).length && '—'}
                      </span>
                    </Cell>
                    <Cell>{shownNum(s.casesPending)}</Cell>
                    <Cell>{shownNum(s.orders30d)}</Cell>
                    <Cell>{s.delivery?.flag ? tx('روشن', 'On', 'روښانه') : tx('خاموش', 'Off', 'بند')} · {shownNum(s.delivery?.couriersActive)}/{shownNum(s.delivery?.couriersTotal)}</Cell>
                    <Cell>{moment(s.lastSeenAt)}</Cell>
                    <Cell>
                      {can('admin') && (
                        <span className="flex flex-col gap-1">
                          <button className="btn btn-sm" onClick={() => { setDone(''); setDialog({ s, service: 'market.directory', hold: marketHold || null }); }}>
                            {marketHold ? tx('بازگرداندن به بازار', 'Restore to market', 'بازار ته بېرته') : tx('تعلیق در بازار', 'Suspend in market', 'په بازار کې ځنډول')}
                          </button>
                          <button className="btn btn-sm" onClick={() => { setDone(''); setDialog({ s, service: 'shop.storefront', hold: sfHold || null }); }}>
                            {sfHold ? tx('روشن کردنِ ویترین', 'Re-enable storefront', 'ننداریز فعالول') : tx('خاموش کردنِ ویترین', 'Disable storefront', 'ننداریز بندول')}
                          </button>
                        </span>
                      )}
                    </Cell>
                  </Row>
                );
              })}
            </Table>
            <Pager total={d.total} limit={SELLER_PAGE} offset={offset} onChange={setOffset} />
            <p className="mt-2 text-[11px] text-ink-muted">
              {tx('«در بازار» فقط وقتی است که همهٔ دروازه‌های سرور باز باشند (همان شرط‌های خودِ بازار). تعلیق و خاموشی از همان درِ «حالت‌های دکان» است — با دلیل، برگشت‌پذیر و در سابقه.',
                '"In market" only when every server gate is open (the marketplace\'s own conditions). Suspend/disable use the shop holds door — with reason, reversible, audited.',
                '«په بازار کې» یوازې کله چې ټولې دروازې خلاصې وي. ځنډول د هټۍ د حالتونو له لارې دي — له لامل سره، بېرته کېدونکي.')}
            </p>
          </>
        )}
      </Box>
      {dialog && (
        <ServiceHoldDialog shopId={dialog.s.shopId} shopName={dialog.s.name} service={dialog.service} hold={dialog.hold}
                           onClose={() => setDialog(null)}
                           onDone={() => { setDialog(null); setDone(tx('سرورِ حساب تأیید کرد.', 'Confirmed by the account server.', 'د حساب سرور تایید کړ.')); void load.reload(); }} />
      )}
    </div>
  );
}

/* ───────────────────────────── سفارش‌ها ───────────────────────────── */

const ORDER_PAGE = 50;

function Orders({ params, setParams }: ModuleProps) {
  const { tx } = useTx();
  const { can } = useApp();
  const problem = params.get('problem') === '1';
  const group = params.get('group') || '';
  const shopId = params.get('shop') || '';
  const [days, setDays] = useState(30);
  const [offset, setOffset] = useState(0);
  const [shopInput, setShopInput] = useState(shopId);
  const filter = { days, shopId, group, problem };
  const load = useLoad<MarketOrders>(MC.orders({ ...filter, limit: ORDER_PAGE, offset }), [days, shopId, group, problem, offset]);
  const d = load.data && !isUnavailable(load.data) ? load.data : null;
  const set = (patch: Record<string, string>) => {
    setOffset(0);
    const next: Record<string, string> = { view: 'orders', problem: problem ? '1' : '', group, shop: shopId, ...patch };
    setParams(Object.fromEntries(Object.entries(next).filter(([, v]) => v)));
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select className="input w-auto" value={days} onChange={(e) => { setOffset(0); setDays(Number(e.target.value)); }} aria-label="days">
          {[1, 7, 30, 90, 365].map((n) => <option key={n} value={n}>{tx('{n} روز', '{n} days', '{n} ورځې', { n: shownNum(n) })}</option>)}
        </select>
        <select className="input w-auto" value={group} onChange={(e) => set({ group: e.target.value })} aria-label="group">
          <option value="">{tx('همهٔ وضعیت‌ها', 'All statuses', 'ټول حالتونه')}</option>
          {ORDER_GROUPS.map((g) => <option key={g} value={g}>{groupLabel(tx, g)}</option>)}
        </select>
        <label className="flex items-center gap-1"><input type="checkbox" checked={problem} onChange={(e) => set({ problem: e.target.checked ? '1' : '' })} />
          {tx('فقط مشکل‌دار', 'Problems only', 'یوازې ستونزمن')}</label>
        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); set({ shop: shopInput.trim() }); }}>
          <input className="input w-44" dir="ltr" value={shopInput} onChange={(e) => setShopInput(e.target.value)} placeholder={tx('شناسهٔ دکان', 'Shop id', 'د هټۍ پېژند')} />
          <button className="btn btn-sm" type="submit">{tx('پالایش', 'Filter', 'چاڼ')}</button>
        </form>
        {can('admin') && <CsvButton url={MC.ordersCsv(filter)} name="market-orders.csv" />}
      </div>
      <Box title={tx('سفارش‌های بازار (ویترین)', 'Marketplace orders (storefront)', 'د بازار فرمایشونه')} icon={<ShoppingBag size={16} />}
           source="/api/admin/market/orders" load={load}>
        {() => d && (
          <>
            {d.truncated && <Notice tone="warn">{tx('بیش از ۵۰۰۰ سفارش در بازه؛ فقط تازه‌ترین‌ها سنجیده شدند — بازه را کوتاه کنید.', 'More than 5000 orders in window; only the newest were checked — narrow the window.', 'له ۵۰۰۰ زیات؛ موده لنډه کړئ.')}</Notice>}
            <Table head={[tx('دکان', 'Shop', 'هټۍ'), '#', tx('وضعیت', 'Status', 'حالت'), tx('پرداخت', 'Payment', 'تادیه'),
              tx('مبلغ', 'Amount', 'مبلغ'), tx('مأموریت', 'Mission', 'ماموریت'), tx('مشکل', 'Issues', 'ستونزې'), tx('شکایت', 'Complaints', 'شکایت'), tx('ثبت', 'Created', 'ثبت')]}
                   empty={(d.orders || []).length === 0}>
              {(d.orders || []).map((o) => (
                <Row key={o.id}>
                  <Cell>{o.shopName || o.shopId}</Cell>
                  <Cell mono>{shownNum(o.orderNo)}</Cell>
                  <Cell mono>{o.status}</Cell>
                  <Cell mono>{o.payment?.method || '—'} · {o.payment?.status || '—'}{o.payment?.cod ? ` · ${o.payment.cod}` : ''}</Cell>
                  <Cell>{money(o.totalMinor, o.currency)}</Cell>
                  <Cell mono>{o.mission ? `${o.mission.status} (${o.mission.mode || '—'})` : '—'}</Cell>
                  <Cell><IssueChips issues={o.issues} /></Cell>
                  <Cell>{shownNum(o.complaintsOpen)}</Cell>
                  <Cell>{moment(o.createdAt)}</Cell>
                </Row>
              ))}
            </Table>
            <Pager total={d.total} limit={ORDER_PAGE} offset={offset} onChange={setOffset} />
            <p className="mt-2 text-[11px] text-ink-muted">{tx('نام، شماره و نشانیِ مشتری این‌جا نیست (سرور نمی‌فرستد). سفارشِ بازار تک‌دکانی است.',
              'Customer name, phone and address are not here (the server does not send them). Marketplace orders are single-shop.',
              'د پېرودونکي نوم، شمېره او پته دلته نشته.')}</p>
          </>
        )}
      </Box>
    </div>
  );
}

/* ───────────────────────────── گزارش‌ها، شکایت‌ها و جریمه‌ها ───────────────────────────── */

function CaseDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { tx, tri } = useTx();
  const load = useLoad<{ case?: TrustCaseFull; fetchedAt?: number }>(MC.caseOne(id), [id]);
  const c = load.data?.case;
  const [mode, setMode] = useState<'decide' | 'appeal' | null>(null);
  const [outcome, setOutcome] = useState('upheld');
  const [sanction, setSanction] = useState('');
  const [productId, setProductId] = useState('');
  const [done, setDone] = useState('');
  const [err, setErr] = useState('');
  const assign = async () => {
    setErr('');
    try { await api(MC.caseAssign(id), { method: 'POST', body: { confirm: true } }); setDone(tx('مسئولِ پرونده شدید (تأییدِ سرور).', 'You are now the assignee (server-confirmed).', 'تاسو مسئول شوئ.')); void load.reload(); onChanged(); }
    catch (e) { setErr(errText(e)); }
  };
  return (
    <Box title={`${tx('پرونده', 'Case', 'دوسیه')} ${id}`} icon={<Flag size={16} />} source="/api/admin/trust/cases/:id" load={load}
         action={<button className="btn btn-sm" onClick={onClose}>{tx('بستن', 'Close', 'بندول')}</button>}>
      {() => c && (
        <div className="space-y-2 text-sm">
          {done && <Notice tone="good">{done}</Notice>}
          {err && <Notice tone="bad">{err}</Notice>}
          <KV label={tx('دکان', 'Shop', 'هټۍ')}>{c.shopName || c.shopId}</KV>
          <KV label={tx('نوع', 'Kind', 'ډول')}>{c.kind} · {c.subject} · {c.category}{c.productId ? ` · ${c.productId}` : ''}</KV>
          <KV label={tx('شدت / وضعیت', 'Severity / status', 'شدت / حالت')}>{c.severity} · {c.status}</KV>
          <KV label={tx('سابقهٔ همین گزارش‌دهنده (۳۰ روز)', 'Same reporter (30d)', 'همدا راپور ورکوونکی')}>
            {tx('همه {a} · وارد {b} · رد {c} · دکان {d}', 'all {a} · upheld {b} · dismissed {c} · shops {d}', '{a} · {b} · {c} · {d}', {
              a: shownNum(c.reporterStats?.total), b: shownNum(c.reporterStats?.upheld), c: shownNum(c.reporterStats?.dismissed), d: shownNum(c.reporterStats?.shops),
            })}
          </KV>
          <div className="rounded-lg bg-surface-raised p-2 text-xs whitespace-pre-wrap">{c.body || '—'}</div>
          {(c.sanctions || []).length > 0 && <KV label={tx('جریمه‌ها', 'Sanctions', 'جریمې')}>{(c.sanctions || []).map((s) => `${tri(SANCTION_LABEL[s.kind], s.kind)}${s.liftedAt ? ' ✓' : ''}`).join('، ')}</KV>}
          <h4 className="mt-2 text-[11px] font-semibold">{tx('تاریخچه', 'History', 'تاریخچه')}</h4>
          <ul className="space-y-1 text-[11px]">
            {(c.history || []).map((h, i) => <li key={i}>{moment(h.at)} · {h.actor} · {h.type}{h.body ? ` — ${h.body}` : ''}</li>)}
          </ul>
          <p className="text-[11px] text-ink-muted">{tx('مدرکِ پیوست ({n}) فقط در کنسولِ خودِ سرورِ حساب دیده می‌شود (این‌جا پل نشده).', 'Attached evidence ({n}) is viewable only in the account server console (not bridged here).', 'ضمیمه ({n}) یوازې د حساب سرور په کنسول کې.', { n: shownNum(c.evidenceCount) })}</p>
          <div className="flex flex-wrap gap-2">
            {(c.status === 'open' || c.status === 'in_review' || c.status === 'appealed') && <button className="btn btn-sm" onClick={assign}>{tx('مسئولش من', 'Assign to me', 'زه مسئول')}</button>}
            {(c.status === 'open' || c.status === 'in_review') && <button className="btn btn-sm btn-danger" onClick={() => setMode('decide')}>{tx('تصمیم', 'Decide', 'پرېکړه')}</button>}
            {c.status === 'appealed' && <button className="btn btn-sm btn-danger" onClick={() => { setOutcome('upheld'); setMode('appeal'); }}>{tx('رأیِ اعتراض', 'Decide appeal', 'د اعتراض پرېکړه')}</button>}
          </div>
          {mode === 'decide' && (
            <SensitiveDialog title={tx('تصمیمِ پرونده', 'Decide case', 'د دوسیې پرېکړه')} onClose={() => setMode(null)}
              ready={outcome === 'upheld' || !sanction}
              effect={tx('تصمیم و جریمه در سابقهٔ پرونده و سرورِ حساب می‌ماند؛ جریمه برگشت‌پذیر است (برداشتن با دلیل). پرونده دوباره تصمیم نمی‌گیرد.',
                'The decision and sanction are recorded on the case and the account server; sanctions are reversible (lift with reason). A case is decided once.',
                'پرېکړه او جریمه ثبتېږي؛ جریمه بېرته کېدونکې ده.')}
              send={async (reason, password) => {
                const body: Record<string, unknown> = { outcome, reason, password, confirm: true };
                if (outcome === 'upheld' && sanction) body.sanction = { kind: sanction, ...(sanction === 'hide_listing' && productId ? { productId } : {}) };
                const out = await api<{ sanction?: { id: string } | null }>(MC.caseDecide(id), { method: 'POST', body });
                setMode(null);
                setDone(tx('تصمیم ثبت شد (تأییدِ سرور){s}.', 'Decision recorded (server-confirmed){s}.', 'پرېکړه ثبت شوه{s}.', { s: out?.sanction?.id ? ` · ${out.sanction.id}` : '' }));
                void load.reload();
                onChanged();
              }}>
              <div className="flex flex-wrap gap-2 text-xs">
                <select className="input w-auto" value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="outcome">
                  <option value="upheld">{tx('وارد است', 'Upheld', 'وارد دی')}</option>
                  <option value="dismissed">{tx('رد', 'Dismissed', 'رد')}</option>
                </select>
                <select className="input w-auto" value={sanction} onChange={(e) => setSanction(e.target.value)} disabled={outcome !== 'upheld'} aria-label="sanction">
                  <option value="">{tx('بی جریمه', 'No sanction', 'بې جریمې')}</option>
                  {Object.keys(SANCTION_LABEL).map((k) => <option key={k} value={k}>{tri(SANCTION_LABEL[k], k)}</option>)}
                </select>
                {sanction === 'hide_listing' && (
                  <input className="input w-40" dir="ltr" value={productId} onChange={(e) => setProductId(e.target.value)} placeholder={c.productId || 'productId'} />
                )}
              </div>
            </SensitiveDialog>
          )}
          {mode === 'appeal' && (
            <SensitiveDialog title={tx('رأیِ اعتراض', 'Appeal decision', 'د اعتراض پرېکړه')} onClose={() => setMode(null)}
              effect={tx('«برگشت» جریمه‌های همین پرونده را برمی‌دارد؛ «تصمیم می‌ماند» چیزی را عوض نمی‌کند.', '"Reversed" lifts this case\'s sanctions; "upheld" changes nothing.', '«بېرته» جریمې لرې کوي.')}
              send={async (reason, password) => {
                await api(MC.caseAppeal(id), { method: 'POST', body: { outcome, reason, password, confirm: true } });
                setMode(null);
                setDone(tx('رأیِ اعتراض ثبت شد (تأییدِ سرور).', 'Appeal decided (server-confirmed).', 'ثبت شو.'));
                void load.reload();
                onChanged();
              }}>
              <select className="input w-auto text-xs" value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="appeal">
                <option value="upheld">{tx('تصمیم می‌ماند', 'Decision stands', 'پرېکړه پاتې')}</option>
                <option value="reversed">{tx('برگشت', 'Reversed', 'بېرته')}</option>
              </select>
            </SensitiveDialog>
          )}
        </div>
      )}
    </Box>
  );
}

function Reports() {
  const { tx, tri } = useTx();
  const { can } = useApp();
  const [status, setStatus] = useState('pending');
  const [open, setOpen] = useState<string | null>(null);
  const [lift, setLift] = useState<Sanction | null>(null);
  const [done, setDone] = useState('');
  const cases = useLoad<{ cases?: TrustCase[]; fetchedAt?: number }>(can('admin') ? MC.cases(status) : null, [status]);
  const sanctions = useLoad<{ sanctions?: Sanction[]; fetchedAt?: number }>(can('admin') ? MC.sanctions(true) : null, []);
  if (!can('admin')) {
    return <Notice tone="info">{tx('پرونده‌های گزارش و شکایت دادهٔ حساس‌اند و سرورِ حساب فقط به مدیرِ ارشد می‌دهد؛ این‌جا فقط admin ِ پنل.',
      'Report/complaint cases are sensitive; the account server serves them to superadmins only — here admin only.', 'دا یوازې د admin لپاره.')}</Notice>;
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="status">
          {['pending', 'open', 'in_review', 'appealed', 'decided', 'closed', 'all'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {done && <Notice tone="good">{done}</Notice>}
      {open && <CaseDetail id={open} onClose={() => setOpen(null)} onChanged={() => { void cases.reload(); void sanctions.reload(); }} />}
      <Box title={tx('صفِ گزارش‌های کالا و شکایت‌ها', 'Product reports & complaints queue', 'د راپورونو کتار')} icon={<Flag size={16} />}
           source="/api/admin/trust/cases" load={cases}>
        {(d) => (
          <Table head={[tx('نوع', 'Kind', 'ډول'), tx('دکان', 'Shop', 'هټۍ'), tx('دسته', 'Category', 'ډله'), tx('شدت', 'Severity', 'شدت'),
            tx('وضعیت', 'Status', 'حالت'), tx('مدرک', 'Evidence', 'ضمیمه'), tx('نشانه', 'Flags', 'نښې'), tx('ثبت', 'Created', 'ثبت')]}
                 empty={(d.cases || []).length === 0}>
            {(d.cases || []).map((c) => (
              <Row key={c.id} onClick={() => setOpen(c.id)}>
                <Cell>{c.kind === 'report' ? tx('گزارشِ کالا', 'Product report', 'د توکي راپور') : tx('شکایت', 'Complaint', 'شکایت')}{c.productId ? <span dir="ltr"> · {c.productId}</span> : null}</Cell>
                <Cell>{c.shopName || c.shopId}</Cell>
                <Cell mono>{c.category}</Cell>
                <Cell><Chip tone={c.severity === 'high' ? 'bad' : c.severity === 'medium' ? 'warn' : 'neutral'}>{c.severity}</Chip></Cell>
                <Cell mono>{c.status}</Cell>
                <Cell>{shownNum(c.evidenceCount)}</Cell>
                <Cell mono>{(c.flags || []).join(' ') || '—'}</Cell>
                <Cell>{moment(c.createdAt)}</Cell>
              </Row>
            ))}
          </Table>
        )}
      </Box>
      <Box title={tx('جریمه‌های فعال', 'Active sanctions', 'فعالې جریمې')} icon={<AlertTriangle size={16} />}
           source="/api/admin/trust/sanctions" load={sanctions}>
        {(d) => (
          <Table head={[tx('نوع', 'Kind', 'ډول'), tx('دکان', 'Shop', 'هټۍ'), tx('کالا', 'Product', 'توکی'), tx('دلیل', 'Reason', 'لامل'), tx('از', 'Since', 'له'), '']}
                 empty={(d.sanctions || []).length === 0}>
            {(d.sanctions || []).map((s) => (
              <Row key={s.id}>
                <Cell>{tri(SANCTION_LABEL[s.kind], s.kind)}</Cell>
                <Cell mono>{s.shopId || '—'}</Cell>
                <Cell mono>{s.productId || '—'}</Cell>
                <Cell>{s.reason || '—'}</Cell>
                <Cell>{moment(s.createdAt)}</Cell>
                <Cell><button className="btn btn-sm" onClick={() => { setDone(''); setLift(s); }}>{tx('برداشتن', 'Lift', 'لرې کول')}</button></Cell>
              </Row>
            ))}
          </Table>
        )}
      </Box>
      {lift && (
        <SensitiveDialog title={`${tx('برداشتنِ جریمه', 'Lift sanction', 'جریمه لرې کول')} · ${tri(SANCTION_LABEL[lift.kind], lift.kind)}`}
          effect={tx('جریمه همان دم برداشته می‌شود؛ ردیفش و دلیل در سابقه می‌ماند.', 'The sanction is lifted at once; its row and reason stay in history.', 'جریمه سمدستي لرې کېږي.')}
          onClose={() => setLift(null)}
          send={async (reason, password) => {
            await api(MC.sanctionLift(lift.id), { method: 'POST', body: { reason, password, confirm: true } });
            setLift(null);
            setDone(tx('برداشته شد (تأییدِ سرور).', 'Lifted (server-confirmed).', 'لرې شوه.'));
            void sanctions.reload();
          }} />
      )}
    </div>
  );
}

/* ───────────────────────────── کمیسیون ───────────────────────────── */

function CommissionView() {
  const { tx } = useTx();
  const [days, setDays] = useState(30);
  const load = useLoad<Commission>(MC.commission(days), [days]);
  return (
    <Box title={tx('کمیسیون و کارمزدِ سامانه', 'Commission & platform fee', 'کمیشن او فیس')} icon={<BadgePercent size={16} />}
         source="/api/admin/market/commission" load={load}
         action={<select className="input w-auto text-xs" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="days">
           {[7, 30, 90, 365].map((n) => <option key={n} value={n}>{tx('{n} روز', '{n} days', '{n} ورځې', { n: shownNum(n) })}</option>)}
         </select>}>
      {(d) => (
        <div className="space-y-2 text-sm">
          <Notice tone="info">{tx('تصمیمِ صاحب محصول ({date}): {text}', 'Owner decision ({date}): {text}', 'پرېکړه ({date}): {text}', { date: d.decision?.date || '—', text: d.decision?.text || '—' })}</Notice>
          {d.inModel === false ? (
            <Notice tone="warn">{tx('ستونِ کارمزد/کمیسیون روی سفارش هنوز نیست — پس هیچ مبلغی نشان داده نمی‌شود (نه صفرِ ساختگی). لازم: {n}',
              'No fee/commission column on orders yet — so no amount is shown (no fake zero). Needs: {n}', 'ستون نشته — مبلغ نه ښودل کېږي. اړتیا: {n}', { n: d.needs || '—' })}</Notice>
          ) : (
            <Table head={[tx('ارز', 'Currency', 'اسعار'), tx('سفارش', 'Orders', 'فرمایش'), tx('با کارمزد', 'Charged', 'له فیس سره'), tx('کارمزد', 'Fee', 'فیس'), tx('کمیسیون', 'Commission', 'کمیشن')]}
                   empty={(d.totals || []).length === 0}>
              {(d.totals || []).map((r) => (
                <Row key={r.currency}><Cell>{r.currency}</Cell><Cell>{shownNum(r.orders)}</Cell><Cell>{shownNum(r.charged)}</Cell>
                  <Cell>{money(r.platformFeeMinor, r.currency)}</Cell><Cell>{money(r.commissionMinor, r.currency)}</Cell></Row>
              ))}
            </Table>
          )}
          <h4 className="text-[11px] font-semibold">{tx('نرخ‌های نوشته‌شده در تنظیماتِ زنده', 'Rates written in live config', 'په ژوندیو تنظیماتو کې نرخونه')}</h4>
          {(d.policy || []).length === 0 ? <p className="text-[11px] text-ink-muted">{tx('هیچ نرخی نوشته نشده (پیش‌فرض ۰).', 'No rate written (default 0).', 'هېڅ نرخ نشته (۰).')}</p>
            : (d.policy || []).map((p) => <KV key={`${p.scope}:${p.key}`} label={`${p.key} · ${p.scope}`} mono>{JSON.stringify(p.value)}</KV>)}
        </div>
      )}
    </Box>
  );
}

/* ───────────────────────────── سابقهٔ کارهای حساس ───────────────────────────── */

function HistoryView() {
  const { tx } = useTx();
  const [before, setBefore] = useState<number | null>(null);
  const load = useLoad<History>(MC.history(50, before), [before]);
  const d = load.data && !isUnavailable(load.data) ? load.data : null;
  const entries = d?.entries || [];
  const last = entries.length === 50 ? entries[entries.length - 1]?.at : null;
  return (
    <Box title={tx('سابقهٔ کارهای حساسِ بازار', 'Sensitive marketplace actions', 'د بازار حساس کارونه')} icon={<FileClock size={16} />}
         source="/api/admin/market/history" load={load}
         action={before ? <button className="btn btn-sm" onClick={() => setBefore(null)}>{tx('تازه‌ترین', 'Newest', 'نوي')}</button> : undefined}>
      {() => (
        <>
          <Table head={[tx('زمان', 'Time', 'وخت'), tx('کار', 'Action', 'کار'), tx('دکان', 'Shop', 'هټۍ'), tx('هدف', 'Target', 'موخه'), tx('جزئیات', 'Detail', 'جزئیات')]} empty={entries.length === 0}>
            {entries.map((e) => (
              <Row key={e.id}>
                <Cell>{moment(e.at)}</Cell>
                <Cell mono>{e.action}</Cell>
                <Cell mono>{e.shopId || '—'}</Cell>
                <Cell mono>{e.targetType ? `${e.targetType}:${e.targetId || ''}` : '—'}</Cell>
                <Cell className="max-w-xs truncate text-[11px]">{e.detail ? JSON.stringify(e.detail) : '—'}</Cell>
              </Row>
            ))}
          </Table>
          {last ? <button className="btn btn-sm mt-2" onClick={() => setBefore(Number(last))}>{tx('قدیمی‌تر', 'Older', 'زاړه')}</button> : null}
        </>
      )}
    </Box>
  );
}

/* ───────────────────────────── خودِ ماژول ───────────────────────────── */

export default function MarketModule({ params, setParams }: ModuleProps) {
  const { tx } = useTx();
  const wanted = params.get('view') as View | null;
  const view: View = wanted && (VIEWS as readonly string[]).includes(wanted) ? wanted : 'overview';
  const go = (v: View, extra: Record<string, string> = {}) => setParams(v === 'overview' ? {} : { view: v, ...extra });
  const label: Record<View, string> = {
    overview: tx('نمای کلی', 'Overview', 'عمومي'), sellers: tx('فروشنده‌ها', 'Sellers', 'پلورونکي'),
    orders: tx('سفارش‌ها', 'Orders', 'فرمایشونه'), reports: tx('گزارش‌ها و جریمه‌ها', 'Reports & sanctions', 'راپورونه او جریمې'),
    commission: tx('کمیسیون', 'Commission', 'کمیشن'), history: tx('سابقه', 'History', 'تاریخچه'),
  };
  return (
    <div className="space-y-3">
      <Tabs tabs={VIEWS.map((id) => ({ id, label: label[id] }))} active={view} onChange={(id) => go(id as View)} />
      {view === 'overview' && <Overview go={go} />}
      {view === 'sellers' && <Sellers />}
      {view === 'orders' && <Orders params={params} setParams={setParams} />}
      {view === 'reports' && <Reports />}
      {view === 'commission' && <CommissionView />}
      {view === 'history' && <HistoryView />}
    </div>
  );
}
