// ---------------------------------------------------------------------------
//  🛒 ۴.۶ مدیریتِ بازار — **فقط سمتِ مدیریت** (برنامه و سایتِ خرید بیرون است، §۴۰.۵)
//
//  نما‌ها (‎?view=‎): نمای کلی · فروشنده‌ها · سفارش‌ها · گزارش‌ها و جریمه‌ها · کمیسیون · سابقهٔ کارهای حساس.
//  ⛔ هر عدد از سرورِ حساب (`/api/admin/market/*` و `/api/admin/trust/*` ِ shop) با منبع و زمان؛ نیامده «—».
//  ⛔ آن‌چه در مدل نیست صادقانه گفته می‌شود: فروشندهٔ مستقل، «تأییدِ فروشنده»، سبدِ چنددکانی، کمیسیون (#432)،
//     تسویه با فروشنده (پول فقط نقد و به دکان می‌رسد، D-08) — نه عددِ ساختگی، نه دکمهٔ بی‌عمل.
//  ⛔ تعلیقِ فروشنده = همان حالتِ «خاموشیِ سرویس» ِ دکان (`market.directory` / `shop.storefront`)، نه درِ دوم.
//  ⛔ مجوز در سرور است؛ پنهان کردنِ دکمه برای غیرِ admin فقط برای این است که درخواستِ بی‌نتیجه نزند.
//  ⛔ مدرکِ پیوستِ پرونده (۱.۵۰.۹۸): فقط admin، بایت با سرآیندِ نشست (`fetchBlobUrl`، نه توکن در نشانی)، بندانگشتی + بزرگ‌نمایی؛
//     پاسخِ غیرِتصویر یا بزرگ را پل رد می‌کند و این‌جا فقط «نشان داده نشد» با دلیل.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { AlertTriangle, BadgePercent, FileClock, Flag, MapPin, ShoppingBag, Store } from 'lucide-react';

import { ApiError, api, fetchBlobUrl } from '../../../api';
import { useApp } from '../../../app-context';
import { Card, Modal } from '../../../components/ui';
import { Cell, KV, Notice, Row, Stat, Table, Tabs } from '../../../control/ui';
import { isUnavailable, newIdemKey, reasonOk } from '../consoleData';
import { SHELL_API } from '../console/contract';
import { SensitiveDialog as KeyDialog, outcomeUnknown, type SensitiveSubmit } from '../console/parts';
import { useLoad } from '../shared';
import {
  CASE_ACTOR_LABEL, CASE_EVENT_LABEL, CASE_STATUSES, CASE_STATUS_LABEL, CENSUS_KINDS, GATE_LABEL, MC, ORDER_GROUPS, OUTCOME_LABEL, SANCTION_LABEL,
  SELLER_STATES, STOREFRONT_FLAG, money, regionMismatches, regionRows, shopFilterOk, shownNum,
  storefrontFlagEdit, type Commission, type Regions, type History, type MarketOrders, type MarketOverview, type Sanction, type Seller, type Sellers,
  type TrustCase, type TrustCaseFull,
} from './marketData';
import { Box, Chip, CsvButton, IssueChips, Pager, ServiceHoldDialog, errText, moment } from './parts';
import { useTx } from './tx';

export type ModuleProps = { params: URLSearchParams; setParams: (next: Record<string, string>) => void };

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;   //  همان مرزِ شناسهٔ پل (‎console-market.js‎)
const VIEWS = ['overview', 'sellers', 'regions', 'orders', 'reports', 'commission', 'history'] as const;
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
  const [flagEdit, setFlagEdit] = useState<{ s: Seller; e: NonNullable<ReturnType<typeof storefrontFlagEdit>> } | null>(null);
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
                          {(() => {
                            //  OPS-09: پرچمِ ویترینِ همین دکان — حالتِ نیامده ⇒ دکمه نیست (نه حدس)
                            const e = storefrontFlagEdit(s);
                            return e && (
                              <button className="btn btn-sm" onClick={() => { setDone(''); setFlagEdit({ s, e }); }}>
                                {e.to ? tx('روشن کردنِ پرچمِ ویترین', 'Turn storefront flag on', 'د ننداریز بیرغ روښانول')
                                  : tx('خاموش کردنِ پرچمِ ویترین', 'Turn storefront flag off', 'د ننداریز بیرغ بندول')}
                              </button>
                            );
                          })()}
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
      {flagEdit && (
        //  ⛔ همان درِ «پرچم‌های شناخته» (‎PUT /console/flags‎، scope = همین دکان): پرخطر ⇒ نامِ کلید + رمزِ پنل، کلیدِ یکتایی
        <KeyDialog danger needPassword confirmKey={STOREFRONT_FLAG}
                   title={tx('پرچمِ ویترینِ «{n}»', 'Storefront flag of “{n}”', 'د «{n}» د ننداریز بیرغ', { n: flagEdit.s.name })}
                   onClose={() => setFlagEdit(null)} onUnknown={() => void load.reload()}
                   onSubmit={async (x: SensitiveSubmit) => {
                     await api(SHELL_API.flags, { method: 'PUT', body: { scope: flagEdit.e.scope, key: flagEdit.e.key, value: flagEdit.e.to, ...x, confirm: true } });
                     setFlagEdit(null);
                     setDone(tx('سرورِ حساب تأیید کرد.', 'Confirmed by the account server.', 'د حساب سرور تایید کړ.'));
                     void load.reload();
                   }}
                   effect={<>
                     <code dir="ltr">{flagEdit.e.scope} · {STOREFRONT_FLAG}</code>: {flagEdit.e.from ? tx('روشن', 'On', 'روښانه') : tx('خاموش', 'Off', 'بند')} ⇒ {flagEdit.e.to ? tx('روشن', 'On', 'روښانه') : tx('خاموش', 'Off', 'بند')}
                     <span className="block">{tx('فقط همین یک دکان. ویترین وقتی باز است که پرچمِ سفارش و اشتراک هم باشد؛ «خاموش کردنِ ویترین» (حالتِ دکان) جداست.',
                       'This one shop only. The storefront opens only with the orders flag and an entitlement too; “Disable storefront” (shop hold) is separate.',
                       'یوازې همدا هټۍ. ننداریز هغه وخت خلاص دی چې د فرمایش بیرغ او ګډون هم وي.')}</span>
                   </>} />
      )}
    </div>
  );
}

/* ───────────────────────────── S109: شمارشِ منطقه‌ای ───────────────────────────── */

function CensusCard({ onDone }: { onDone: () => void }) {
  const { tx } = useTx();
  const [shopId, setShopId] = useState('');
  const [kind, setKind] = useState<string>('test');
  const [dup, setDup] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const id = shopId.trim();
  const of = dup.trim();
  const ok = ID_RE.test(id) && reasonOk(reason) && (kind !== 'duplicate' || (ID_RE.test(of) && of !== id)) && !busy;
  const kindLabel: Record<string, string> = {
    test: tx('آزمایشی', 'Test', 'ازمایښتي'), duplicate: tx('تکراری', 'Duplicate', 'تکراري'), none: tx('برداشتنِ نشان', 'Remove mark', 'نښه لرې کول'),
  };
  const send = async () => {
    if (!ok) return;
    setBusy(true);
    setMsg(null);
    try {
      await api(MC.census(id), { method: 'PUT', body: { kind, ...(kind === 'duplicate' ? { duplicateOf: of } : {}), reason: reason.trim(), confirm: true } });
      setMsg({ tone: 'good', text: tx('سرورِ حساب تأیید کرد.', 'Confirmed by the account server.', 'د حساب سرور تایید کړ.') });
      setReason('');
      onDone();
    } catch (e) { setMsg({ tone: 'bad', text: errText(e) }); }
    finally { setBusy(false); }
  };
  return (
    <Card title={tx('نشانِ «آزمایشی/تکراری» ِ دکان', 'Mark a shop as test/duplicate', 'د هټۍ «ازمایښتي/تکراري» نښه')} icon={<Flag size={16} />}>
      <p className="mb-2 text-[11px] text-ink-muted">{tx('دکانِ نشان‌دار در این شمارش و در گزارشِ پولِ مدیر نیست؛ دلیل و سابقه در سرورِ حساب می‌ماند و برداشتنی است.',
        'A marked shop is left out of this count and of the admin money report; the reason and history stay on the account server, and it can be removed.',
        'نښه شوې هټۍ په دې شمېرنه کې نه راځي؛ لامل او تاریخچه پاتې کېږي.')}</p>
      <div className="flex flex-wrap items-end gap-2">
        <input className="input w-48" dir="ltr" aria-label="census-shop" value={shopId} onChange={(e) => setShopId(e.target.value)} placeholder={tx('شناسهٔ دکان', 'Shop id', 'د هټۍ پېژند')} />
        <select className="input w-auto" aria-label="census-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {CENSUS_KINDS.map((k) => <option key={k} value={k}>{kindLabel[k]}</option>)}
        </select>
        {kind === 'duplicate' && (
          <input className="input w-48" dir="ltr" aria-label="census-of" value={dup} onChange={(e) => setDup(e.target.value)} placeholder={tx('دکانِ اصل', 'Original shop', 'اصلي هټۍ')} />
        )}
        <input className="input w-64" aria-label="census-reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tx('دلیل (۳ تا ۲۰۰ نویسه)', 'Reason (3–200 chars)', 'لامل')} />
        <button className="btn btn-sm" disabled={!ok} onClick={send}>{busy ? '…' : tx('ثبتِ نشان', 'Save mark', 'نښه ثبتول')}</button>
      </div>
      {msg && <div className="mt-2"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
    </Card>
  );
}

function RegionsView() {
  const { tx } = useTx();
  const { can } = useApp();
  const load = useLoad<Regions>(MC.regions);
  const d = load.data && !isUnavailable(load.data) ? load.data : null;
  const rows = regionRows(d);
  const bad = regionMismatches(d);
  const three = (x: { registered?: number; accepting?: number; temporarilyClosed?: number } | undefined) => [
    <Cell key="r">{shownNum(x?.registered)}</Cell>, <Cell key="a">{shownNum(x?.accepting)}</Cell>, <Cell key="c">{shownNum(x?.temporarilyClosed)}</Cell>,
  ];
  return (
    <div className="space-y-3">
      <Box title={tx('شمارشِ منطقه‌ایِ فروشگاه‌های عمومی', 'Public shops by region', 'عامې هټۍ د سیمې له مخې')} icon={<MapPin size={16} />}
           source="/api/admin/market/regions" load={load}>
        {() => d && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label={tx('ثبت‌شده (عمومی)', 'Registered (public)', 'ثبت شوې (عامې)')} value={shownNum(d.totals?.registered)} />
              <Stat label={tx('سفارش‌پذیر', 'Accepting orders', 'فرمایش مني')} value={shownNum(d.totals?.accepting)} />
              <Stat label={tx('موقتاً بسته', 'Temporarily closed', 'لنډمهاله بندې')} value={shownNum(d.totals?.temporarilyClosed)} />
            </div>
            <div className="mt-2">
              <Notice>{tx('«آنلاینِ همین لحظه» در مدل نیست (‎onlineNow: null‎) — این سه عدد وضعیتِ ثبت‌شده‌اند، نه حضورِ زنده.',
                '“Online right now” is not in the model (onlineNow: null) — these three are recorded states, not live presence.',
                '«همدا اوس آنلاین» په ماډل کې نشته — دا درې شمېرې ثبت شوي حالتونه دي.')}</Notice>
            </div>
            {bad.length > 0 && <div className="mt-2"><Notice tone="bad">{tx('جمعِ ولایت‌ها با جمعِ کل نمی‌خواند: {k}', 'Provinces do not add up to the total: {k}', 'د ولایتونو جمع له ټول سره نه سمون خوري: {k}', { k: bad.join('، ') })}</Notice></div>}
            <div className="mt-3">
              <Table head={[tx('ولایت', 'Province', 'ولایت'), tx('ثبت‌شده', 'Registered', 'ثبت شوې'), tx('سفارش‌پذیر', 'Accepting', 'فرمایش مني'),
                tx('موقتاً بسته', 'Temporarily closed', 'لنډمهاله بندې'), tx('ولسوالی‌ها (ثبت‌شده/سفارش‌پذیر/بسته)', 'Districts (registered/accepting/closed)', 'ولسوالۍ')]}
                     empty={rows.length === 0}>
                {rows.map((p) => (
                  <Row key={p.code}>
                    <Cell><div className="font-medium">{p.name}</div><div className="text-[11px] text-ink-muted" dir="ltr">{p.code}</div></Cell>
                    {three(p)}
                    <Cell>
                      {(p.districts || []).length ? (
                        <span className="flex flex-wrap gap-1">
                          {(p.districts || []).map((x, i) => (
                            <Chip key={`${x.name}-${i}`}>{x.name || tx('بی ولسوالی', 'No district', 'بې ولسوالۍ')}: {shownNum(x.registered)}/{shownNum(x.accepting)}/{shownNum(x.temporarilyClosed)}</Chip>
                          ))}
                        </span>
                      ) : '—'}
                    </Cell>
                  </Row>
                ))}
                <Row>
                  <Cell>{tx('ولایتِ نامعلوم', 'Unknown province', 'ناڅرګند ولایت')}</Cell>
                  {three(d.unknownProvince)}
                  <Cell>—</Cell>
                </Row>
              </Table>
            </div>
            <p className="mt-2 text-[11px] text-ink-muted">
              {tx('بیرون از شمارش — آزمایشی: {t} · تکراری: {d} · تعلیق یا غیرفعال: {s} · بی وضعیتِ عمومی: {n}',
                'Left out — test: {t} · duplicate: {d} · suspended or inactive: {s} · not public: {n}',
                'بهر — ازمایښتي: {t} · تکراري: {d} · ځنډول شوې: {s} · نا عامې: {n}',
                { t: shownNum(d.excluded?.test), d: shownNum(d.excluded?.duplicate), s: shownNum(d.excluded?.suspended), n: shownNum(d.excluded?.notPublic) })}
            </p>
          </>
        )}
      </Box>
      {can('admin') && <CensusCard onDone={() => void load.reload()} />}
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

/* ───────────────────────────── گزارش‌ها، شکایت‌ها و جریمه‌ها (ABUSE-01) ───────────────────────────── */
//  ⛔ هر نوشتن با کلیدِ یکتاییِ همان پنجره/پرونده (دوکلیک یا تکرار پس از قطعِ شبکه = همان یک کار) و پاسخِ «نامعلوم» ⇒ هشدار و
//     خواندنِ دوبارهٔ پرونده، نه سرخِ «نشد». متنِ شاکی، دلیل و شناسه‌ها فقط متن‌اند (هیچ HTML).

const OPEN_STATES = ['open', 'in_review', 'appealed'];

function Assignee({ c }: { c: TrustCase }) {
  const { tx } = useTx();
  const { username } = useApp();
  if (c.panelAssignee?.by) {
    return (
      <span data-case-assignee={c.panelAssignee.by}>
        {c.panelAssignee.by}{c.panelAssignee.by === username ? ` (${tx('شما', 'you', 'تاسو')})` : ''}
      </span>
    );
  }
  //  سرورِ حسابِ تازه (shop ‎claude/e-rows-25s‎): مسئولِ کارِ پل = کاربرِ پنل و نامش (‎assigneeName‎)
  if (c.assigneeName) {
    return <span data-case-assignee={c.assigneeName}>{c.assigneeName}{c.assigneeName === username ? ` (${tx('شما', 'you', 'تاسو')})` : ''}</span>;
  }
  if (c.assignee) return <span className="font-mono text-xs" dir="ltr" title={tx('شناسهٔ مسئول در سرورِ حساب', 'Assignee id on the account server', 'د حساب سرور مسئول')}>{c.assignee}</span>;
  return <span className="text-ink-muted">{tx('بی مسئول', 'Unassigned', 'بې مسئوله')}</span>;
}

type Evidence = { id: string; mime?: string; size?: number; createdAt?: number };

/** چرا مدرک نشان داده نشد — از کدِ پل/سرورِ حساب، نه «خطا» ِ گنگ */
function evidenceProblem(tx: (fa: string, en: string, ps: string) => string, code: string) {
  if (code === 'evidence_not_image') return tx('پاسخ عکس نبود — نشان داده نشد', 'Not an image — not shown', 'انځور نه و');
  if (code === 'evidence_too_large' || code === 'account_server_too_large') return tx('بزرگ‌تر از سقف — نشان داده نشد', 'Too large — not shown', 'ډېر لوی');
  if (code === 'media_gone' || code === 'not_found') return tx('روی سرورِ حساب نیست', 'Not on the account server', 'په سرور کې نشته');
  if (code === 'forbidden') return tx('فقط مدیرِ پنل', 'Panel admins only', 'یوازې مدیر');
  if (code === 'rate_limited') return tx('زیاد دیده شد — کمی بعد', 'Too many views — try later', 'وروسته');
  return tx('عکس نیامد', 'Could not load', 'انځور رانغی');
}

/** یک مدرک: بندانگشتی (دکمه) و بزرگ‌نمایی در پنجره — یک بار گرفته می‌شود (هر دیدن یک ردیفِ دفتر است) */
function EvidenceThumb({ caseId, ev, index, total }: { caseId: string; ev: Evidence; index: number; total: number }) {
  const { tx } = useTx();
  const [src, setSrc] = useState('');
  const [err, setErr] = useState('');
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    let made = '';
    setSrc(''); setErr('');
    fetchBlobUrl(MC.caseEvidence(caseId, ev.id), ctrl.signal)
      .then((u) => { made = u; setSrc(u); })
      .catch((e) => { if (!ctrl.signal.aborted) setErr(e instanceof ApiError ? e.code : 'request_failed'); });
    return () => { ctrl.abort(); if (made) URL.revokeObjectURL(made); };
  }, [caseId, ev.id]);
  const alt = tx('مدرکِ {i} از {n} ِ پروندهٔ {c} — عکسی که شاکی پیوست کرده', 'Evidence {i} of {n} for case {c} — photo attached by the reporter',
    'د {c} دوسیې {n} څخه {i} ضمیمه — د شکایت کوونکي انځور', { i: shownNum(index + 1), n: shownNum(total), c: caseId });
  const box = 'inline-flex h-16 w-16 items-center justify-center rounded border border-line bg-surface-sunken';
  if (err) {
    return <span className={`${box} p-1 text-center text-[10px] leading-tight`} role="img" aria-label={`${alt} — ${evidenceProblem(tx, err)}`} title={err} data-evidence-error={err}>{evidenceProblem(tx, err)}</span>;
  }
  if (!src) return <span className={`${box} animate-pulse`} role="img" aria-label={alt} aria-busy="true" data-evidence-loading={ev.id} />;
  const meta = [ev.mime, ev.size ? `${shownNum(Math.max(1, Math.round(ev.size / 1024)))} KB` : '', ev.createdAt ? moment(ev.createdAt) : ''].filter(Boolean).join(' · ');
  return (
    <>
      <button type="button" className="rounded focus-visible:outline focus-visible:outline-2" data-evidence-thumb={ev.id} onClick={() => setZoom(true)}
              title={tx('بزرگ‌نمایی', 'Zoom', 'لوی کول')}>
        <img src={src} alt={alt} className="h-16 w-16 rounded border border-line object-cover" />
      </button>
      {zoom && (
        <Modal open wide onClose={() => setZoom(false)} title={tx('مدرکِ {i} از {n} — پروندهٔ {c}', 'Evidence {i} of {n} — case {c}', 'ضمیمه {i} له {n} — {c}',
          { i: shownNum(index + 1), n: shownNum(total), c: caseId })}>
          <img src={src} alt={alt} className="mx-auto block max-h-[70vh] max-w-full object-contain" data-evidence-full={ev.id} />
          {meta && <p className="mt-2 text-center text-[11px] text-ink-muted" dir="ltr">{meta}</p>}
        </Modal>
      )}
    </>
  );
}

function CaseDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { tx, tri } = useTx();
  //  نوشتن فقط admin ِ پنل (مرز در پل و سرورِ حساب است؛ این فقط دکمهٔ بی‌نتیجه نمی‌سازد)
  const { can } = useApp();
  const writer = can('admin');
  const load = useLoad<{ case?: TrustCaseFull; fetchedAt?: number }>(MC.caseOne(id), [id]);
  const c = load.data?.case;
  const [mode, setMode] = useState<'decide' | 'appeal' | null>(null);
  const [outcome, setOutcome] = useState('upheld');
  const [sanction, setSanction] = useState('');
  const [productId, setProductId] = useState('');
  const [done, setDone] = useState('');
  const [err, setErr] = useState('');
  const [unknown, setUnknown] = useState(false);
  const [busy, setBusy] = useState(false);
  //  یک کلید برای «مسئولش من» ِ همین پرونده تا تأییدِ سرور؛ پس از آن کلیدِ تازه
  const [assignKey, setAssignKey] = useState(newIdemKey);
  const refresh = () => { void load.reload(); onChanged(); };
  const assign = async () => {
    if (busy) return;
    setBusy(true); setErr(''); setDone(''); setUnknown(false);
    try {
      await api(MC.caseAssign(id), { method: 'POST', body: { confirm: true, idempotencyKey: assignKey } });
      setAssignKey(newIdemKey());
      setDone(tx('مسئولِ پرونده شدید (تأییدِ سرور).', 'You are now the assignee (server-confirmed).', 'تاسو مسئول شوئ (د سرور تایید).'));
      refresh();
    } catch (e) {
      if (outcomeUnknown(e)) { setUnknown(true); refresh(); } else setErr(errText(e));
    } finally { setBusy(false); }
  };
  const open = Boolean(c && OPEN_STATES.includes(String(c.status)));
  const evidence = (Array.isArray(c?.evidence) ? c!.evidence : []).filter((e) => ID_RE.test(String(e?.id || ''))).slice(0, 10);
  return (
    <Box title={`${tx('پرونده', 'Case', 'دوسیه')} ${id}`} icon={<Flag size={16} />} source="/api/admin/trust/cases/:id" load={load}
         action={<button className="btn btn-sm" data-case-close onClick={onClose}>{tx('بستن', 'Close', 'بندول')}</button>}>
      {() => c && (
        <div className="space-y-2 text-sm" data-case-detail={id}>
          {done && <Notice tone="good">{done}</Notice>}
          {err && <Notice tone="bad">{err}</Notice>}
          {unknown && <div data-outcome="unknown"><Notice tone="warn">{tx('نتیجه معلوم نیست — سرورِ حساب به‌موقع جواب نداد؛ وضعِ پرونده دوباره خوانده شد. پیش از تکرار همین‌جا ببینید.',
            'Outcome unknown — the account server did not answer in time; the case was re-read. Check it here before retrying.', 'پایله معلومه نه ده — له بیا هڅې مخکې همدلته وګورئ.')}</Notice></div>}
          <KV label={tx('دکان', 'Shop', 'هټۍ')}>{c.shopName || '—'} <span className="font-mono text-xs" dir="ltr">{c.shopId}</span></KV>
          <KV label={tx('نوع', 'Kind', 'ډول')}>{c.kind === 'report' ? tx('گزارشِ کالا', 'Product report', 'د توکي راپور') : tx('شکایت', 'Complaint', 'شکایت')} · {c.category}{c.productId ? ` · ${c.productId}` : ''}</KV>
          <KV label={tx('شدت / وضعیت', 'Severity / status', 'شدت / حالت')}>{c.severity} · <span data-case-status={c.status}>{tri(CASE_STATUS_LABEL[String(c.status)], c.status)}</span></KV>
          <KV label={tx('مسئول', 'Assignee', 'مسئول')}><Assignee c={c} /></KV>
          {/* ⛔ سابقهٔ شاکی فقط برای ارشد (نقشِ زیرِ آن از سرورِ حساب و پل نمای کم‌تر می‌گیرد) */}
          {c.reporterStats && (
            <KV label={tx('سابقهٔ همین گزارش‌دهنده (۳۰ روز)', 'Same reporter (30d)', 'همدا راپور ورکوونکی')}>
              {tx('همه {a} · وارد {b} · رد {c} · دکان {d}', 'all {a} · upheld {b} · dismissed {c} · shops {d}', '{a} · {b} · {c} · {d}', {
                a: shownNum(c.reporterStats?.total), b: shownNum(c.reporterStats?.upheld), c: shownNum(c.reporterStats?.dismissed), d: shownNum(c.reporterStats?.shops),
              })}
            </KV>
          )}
          <div className="rounded-lg bg-surface-raised p-2 text-xs whitespace-pre-wrap break-words" data-case-body>{c.body || '—'}</div>
          {(c.sameText || []).length > 0 && (
            <p className="text-[11px] text-ink-muted">{tx('پرونده‌های هم‌متن در همین دکان:', 'Same-text cases at this shop:', 'ورته متن:')} <span className="font-mono" dir="ltr">{(c.sameText || []).join(' ')}</span></p>
          )}
          {c.decision && (
            <div className="rounded-lg border border-line p-2 text-xs" data-case-decision>
              <span className="font-semibold">{tx('تصمیم', 'Decision', 'پرېکړه')}: {tri(OUTCOME_LABEL[String(c.decision.outcome)], c.decision.outcome)}</span>
              <span className="text-ink-muted"> · {moment(c.decision.at)}</span>
              <span className="block whitespace-pre-wrap break-words">{c.decision.reason || '—'}</span>
            </div>
          )}
          {c.appeal && (
            <div className="rounded-lg border border-line p-2 text-xs" data-case-appeal-box>
              <span className="font-semibold">{tx('اعتراضِ دکان', 'Shop appeal', 'د هټۍ اعتراض')}</span>
              <span className="text-ink-muted"> · {moment(c.appeal.at)}</span>
              <span className="block whitespace-pre-wrap break-words">{c.appeal.body || '—'}</span>
              {c.appeal.outcome && (
                <span className="mt-1 block">{tx('رأی', 'Ruling', 'پرېکړه')}: {tri(OUTCOME_LABEL[c.appeal.outcome], c.appeal.outcome)} — {c.appeal.reason || '—'} <span className="text-ink-muted">· {moment(c.appeal.decidedAt)}</span></span>
              )}
            </div>
          )}
          {(c.sanctions || []).length > 0 && (
            <ul className="space-y-1 text-xs" data-case-sanctions>
              {(c.sanctions || []).map((s) => (
                <li key={s.id}>
                  <Chip tone={s.liftedAt ? 'neutral' : 'bad'}>{tri(SANCTION_LABEL[s.kind], s.kind)}</Chip>
                  {s.productId ? <span className="font-mono" dir="ltr"> {s.productId}</span> : null}
                  {' · '}{s.liftedAt ? `${tx('برداشته شد', 'lifted', 'لرې شوه')} ${moment(s.liftedAt)} — ${s.liftReason || '—'}` : tx('فعال', 'active', 'فعاله')}
                </li>
              ))}
            </ul>
          )}
          <h4 className="mt-2 text-[11px] font-semibold">{tx('تاریخچه', 'History', 'تاریخچه')}</h4>
          <ol className="space-y-1 text-[11px]" data-case-history>
            {(c.history || []).map((h, i) => {
              const o = typeof h.data?.outcome === 'string' ? h.data.outcome : '';
              return (
                <li key={i} data-event={h.type} className="break-words">
                  <span className="text-ink-muted">{moment(h.at)}</span> · {tri(CASE_ACTOR_LABEL[String(h.actor)], h.actor)} · {tri(CASE_EVENT_LABEL[h.type], h.type)}
                  {o ? ` (${tri(OUTCOME_LABEL[o], o)})` : ''}{h.body ? ` — ${h.body}` : ''}
                </li>
              );
            })}
          </ol>
          {/* ۱.۵۰.۹۸: مدرکِ پیوست — همان قاعدهٔ «مدرک فقط ارشد» ِ سرورِ حساب ⇒ فقط admin ِ پنل */}
          {writer && evidence.length > 0 ? (
            <div data-case-evidence>
              <h4 className="mt-2 text-[11px] font-semibold">{tx('مدرکِ پیوست ({n})', 'Attached evidence ({n})', 'ضمیمه ({n})', { n: shownNum(evidence.length) })}</h4>
              <ul className="mt-1 flex flex-wrap gap-2">
                {evidence.map((ev, i) => <li key={ev.id}><EvidenceThumb caseId={id} ev={ev} index={i} total={evidence.length} /></li>)}
              </ul>
              <p className="mt-1 text-[11px] text-ink-muted">{tx('برای بزرگ‌نمایی روی عکس بزنید. هر دیدن در دفترِ پنل و سابقهٔ سرورِ حساب می‌ماند.',
                'Tap a photo to zoom. Every view is logged in the panel ledger and on the account server.', 'د لویولو لپاره پر انځور ووهئ. هر لیدل ثبتېږي.')}</p>
            </div>
          ) : (c.evidenceCount || 0) > 0 && (
            <p className="text-[11px] text-ink-muted" data-evidence-hidden>{writer
              ? tx('مدرکِ پیوست ({n}) — سرورِ حساب فهرستش را نداد.', 'Attached evidence ({n}) — the account server did not list it.', 'ضمیمه ({n}) — لېست رانغی.', { n: shownNum(c.evidenceCount) })
              : tx('مدرکِ پیوست ({n}) فقط برای مدیرِ پنل نشان داده می‌شود (سرورِ حساب هم مدرک را فقط به ارشد می‌دهد).',
                'Attached evidence ({n}) is shown to panel admins only (the account server gives evidence to super admins only).', 'ضمیمه ({n}) یوازې د پینل مدیر ته.', { n: shownNum(c.evidenceCount) })}</p>
          )}
          {writer && <div className="flex flex-wrap gap-2">
            {/* ⛔ برچسب در حالِ فرستادن عوض نمی‌شود: کوتاه شدنش دکمهٔ «تصمیم» را زیرِ کلیکِ دومِ دوکلیک می‌آورد */}
            {open && <button className="btn btn-sm" data-case-assign disabled={busy} aria-busy={busy} onClick={assign}>{tx('مسئولش من', 'Assign to me', 'زه مسئول')}</button>}
            {(c.status === 'open' || c.status === 'in_review') && <button className="btn btn-sm btn-danger" data-case-decide onClick={() => { setDone(''); setMode('decide'); }}>{tx('تصمیم', 'Decide', 'پرېکړه')}</button>}
            {c.status === 'appealed' && <button className="btn btn-sm btn-danger" data-case-appeal onClick={() => { setDone(''); setOutcome('upheld'); setMode('appeal'); }}>{tx('رأیِ اعتراض', 'Decide appeal', 'د اعتراض پرېکړه')}</button>}
          </div>}
          {mode === 'decide' && (
            <KeyDialog danger needPassword title={tx('تصمیمِ پرونده', 'Decide case', 'د دوسیې پرېکړه')} onClose={() => setMode(null)}
              disabled={!(outcome === 'upheld' || !sanction)} onUnknown={refresh}
              effect={tx('تصمیم و جریمه در سابقهٔ پرونده و سرورِ حساب می‌ماند و دکان دلیل را می‌بیند؛ جریمه برگشت‌پذیر است (برداشتن با دلیل). پرونده فقط یک بار تصمیم می‌گیرد.',
                'The decision and sanction are recorded on the case and the account server and the shop sees the reason; sanctions are reversible (lift with reason). A case is decided once.',
                'پرېکړه او جریمه ثبتېږي او هټۍ لامل ویني؛ جریمه بېرته کېدونکې ده.')}
              onSubmit={async (x: SensitiveSubmit) => {
                const body: Record<string, unknown> = { outcome, ...x, confirm: true };
                if (outcome === 'upheld' && sanction) body.sanction = { kind: sanction, ...(sanction === 'hide_listing' && productId ? { productId } : {}) };
                const out = await api<{ sanction?: { id: string } | null }>(MC.caseDecide(id), { method: 'POST', body });
                setMode(null);
                setDone(tx('تصمیم ثبت شد (تأییدِ سرور){s}.', 'Decision recorded (server-confirmed){s}.', 'پرېکړه ثبت شوه{s}.', { s: out?.sanction?.id ? ` · ${out.sanction.id}` : '' }));
                refresh();
              }}>
              <div className="flex flex-wrap gap-2 text-xs">
                <select className="input w-auto" value={outcome} onChange={(e) => { setOutcome(e.target.value); if (e.target.value !== 'upheld') setSanction(''); }} aria-label={tx('نتیجه', 'Outcome', 'پایله')}>
                  <option value="upheld">{tri(OUTCOME_LABEL.upheld)}</option>
                  <option value="dismissed">{tri(OUTCOME_LABEL.dismissed)}</option>
                </select>
                <select className="input w-auto" value={sanction} onChange={(e) => setSanction(e.target.value)} disabled={outcome !== 'upheld'} aria-label={tx('جریمه', 'Sanction', 'جریمه')}>
                  <option value="">{tx('بی جریمه', 'No sanction', 'بې جریمې')}</option>
                  {Object.keys(SANCTION_LABEL).map((k) => <option key={k} value={k}>{tri(SANCTION_LABEL[k], k)}</option>)}
                </select>
                {sanction === 'hide_listing' && (
                  <input className="input w-40" dir="ltr" value={productId} onChange={(e) => setProductId(e.target.value)} placeholder={c.productId || 'productId'}
                         aria-label={tx('شناسهٔ کالا', 'Product id', 'د توکي پېژند')} />
                )}
              </div>
            </KeyDialog>
          )}
          {mode === 'appeal' && (
            <KeyDialog danger needPassword title={tx('رأیِ اعتراض', 'Appeal decision', 'د اعتراض پرېکړه')} onClose={() => setMode(null)} onUnknown={refresh}
              effect={tx('«برگشت» همهٔ جریمه‌های فعالِ همین پرونده را برمی‌دارد؛ «تصمیم می‌ماند» چیزی را عوض نمی‌کند. پرونده پس از رأی بسته می‌شود.',
                '"Reversed" lifts all active sanctions of this case; "Decision stands" changes nothing. The case closes after the ruling.', '«بېرته» جریمې لرې کوي.')}
              onSubmit={async (x: SensitiveSubmit) => {
                await api(MC.caseAppeal(id), { method: 'POST', body: { outcome, ...x, confirm: true } });
                setMode(null);
                setDone(tx('رأیِ اعتراض ثبت شد (تأییدِ سرور).', 'Appeal decided (server-confirmed).', 'ثبت شو.'));
                refresh();
              }}>
              <select className="input w-auto text-xs" value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label={tx('رأی', 'Ruling', 'پرېکړه')}>
                <option value="upheld">{tx('تصمیم می‌ماند', 'Decision stands', 'پرېکړه پاتې')}</option>
                <option value="reversed">{tri(OUTCOME_LABEL.reversed)}</option>
              </select>
            </KeyDialog>
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
  const [shopDraft, setShopDraft] = useState('');
  const [shop, setShop] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [lift, setLift] = useState<Sanction | null>(null);
  const [done, setDone] = useState('');
  const writer = can('admin');
  //  ‎trust-read.v1‎: operator و viewer هم می‌خوانند (نمای کم‌تر، بی نوشتن)؛ سرورِ حسابِ کهنه ⇒ ۴۰۳ ِ پل با نامِ توانایی
  const cases = useLoad<{ cases?: TrustCase[]; fetchedAt?: number }>(MC.cases(status, shop), [status, shop]);
  const sanctions = useLoad<{ sanctions?: Sanction[]; fetchedAt?: number }>(MC.sanctions(activeOnly, shop), [activeOnly, shop]);
  if (!writer && cases.code === 'forbidden') {
    return <div data-trust-readonly-off><Notice tone="info">{tx('پرونده‌های گزارش و شکایت دادهٔ حساس‌اند (متنِ شاکی و سابقه‌اش)؛ برای نقشِ شما سرورِ حسابِ تازه (trust-read.v1) لازم است — تا آن روز فقط admin ِ پنل.',
      'Report/complaint cases are sensitive (reporter text and history); your role needs an updated account server (trust-read.v1) — until then panel admins only.', 'ستاسو رول ته د حساب نوی سرور (trust-read.v1) پکار دی.')}</Notice></div>;
  }
  const shopOk = shopFilterOk(shopDraft.trim());
  return (
    <div className="space-y-3">
      <form className="flex flex-wrap items-center gap-2 text-xs" onSubmit={(e) => { e.preventDefault(); if (shopOk) { setShop(shopDraft.trim()); setOpen(null); } }}>
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('وضعیت', 'Status', 'حالت')} data-trust-status>
          {CASE_STATUSES.map((s) => <option key={s} value={s}>{tri(CASE_STATUS_LABEL[s], s)}</option>)}
        </select>
        <input className="input w-48" dir="ltr" value={shopDraft} onChange={(e) => setShopDraft(e.target.value)} data-trust-shop
               placeholder={tx('شناسهٔ دکان (همه)', 'Shop id (all)', 'د هټۍ پېژند (ټول)')} aria-label={tx('شناسهٔ دکان', 'Shop id', 'د هټۍ پېژند')} />
        <button className="btn btn-sm" type="submit" disabled={!shopOk}>{tx('پالایش', 'Filter', 'چاڼ')}</button>
        {shop && <button className="btn btn-sm" type="button" onClick={() => { setShop(''); setShopDraft(''); }}>{tx('همهٔ دکان‌ها', 'All shops', 'ټولې هټۍ')}</button>}
        {!shopOk && <span className="text-[11px]" style={{ color: 'var(--status-critical)' }}>{tx('فقط حرف و رقمِ لاتین، _ و -', 'Latin letters, digits, _ and - only', 'یوازې لاتیني توري او شمېرې')}</span>}
      </form>
      {done && <Notice tone="good">{done}</Notice>}
      {open && <CaseDetail id={open} onClose={() => setOpen(null)} onChanged={() => { void cases.reload(); void sanctions.reload(); }} />}
      <Box title={tx('صفِ گزارش‌های کالا و شکایت‌ها', 'Product reports & complaints queue', 'د راپورونو کتار')} icon={<Flag size={16} />}
           source="/api/admin/trust/cases" load={cases}>
        {(d) => (
          <Table head={[tx('نوع', 'Kind', 'ډول'), tx('دکان', 'Shop', 'هټۍ'), tx('دسته', 'Category', 'ډله'), tx('شدت', 'Severity', 'شدت'),
            tx('وضعیت', 'Status', 'حالت'), tx('مسئول', 'Assignee', 'مسئول'), tx('مدرک', 'Evidence', 'ضمیمه'), tx('نشانه', 'Flags', 'نښې'), tx('ثبت', 'Created', 'ثبت'), '']}
                 empty={(d.cases || []).length === 0}>
            {(d.cases || []).map((c) => (
              <Row key={c.id} onClick={() => setOpen(c.id)}>
                <Cell><span data-case-row={c.id}>{c.kind === 'report' ? tx('گزارشِ کالا', 'Product report', 'د توکي راپور') : tx('شکایت', 'Complaint', 'شکایت')}</span>{c.productId ? <span dir="ltr"> · {c.productId}</span> : null}</Cell>
                <Cell>{c.shopName || c.shopId}</Cell>
                <Cell mono>{c.category}</Cell>
                <Cell><Chip tone={c.severity === 'high' ? 'bad' : c.severity === 'medium' ? 'warn' : 'neutral'}>{c.severity}</Chip></Cell>
                <Cell>{tri(CASE_STATUS_LABEL[String(c.status)], c.status)}{c.outcome ? ` · ${tri(OUTCOME_LABEL[c.outcome], c.outcome)}` : ''}</Cell>
                <Cell><Assignee c={c} /></Cell>
                <Cell>{shownNum(c.evidenceCount)}</Cell>
                <Cell mono>{(c.flags || []).join(' ') || '—'}</Cell>
                <Cell>{moment(c.createdAt)}</Cell>
                <Cell><button className="btn btn-sm" data-case-open={c.id} onClick={(e) => { e.stopPropagation(); setOpen(c.id); }}>{tx('باز کردن', 'Open', 'خلاصول')}</button></Cell>
              </Row>
            ))}
          </Table>
        )}
      </Box>
      <Box title={activeOnly ? tx('جریمه‌های فعال', 'Active sanctions', 'فعالې جریمې') : tx('همهٔ جریمه‌ها', 'All sanctions', 'ټولې جریمې')} icon={<AlertTriangle size={16} />}
           source="/api/admin/trust/sanctions" load={sanctions}
           action={<label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} data-trust-active />{tx('فقط فعال', 'Active only', 'یوازې فعالې')}</label>}>
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
                <Cell>{s.liftedAt
                  ? <span className="text-[11px] text-ink-muted">{tx('برداشته شد', 'Lifted', 'لرې شوه')} {moment(s.liftedAt)}</span>
                  : !writer ? <span className="text-[11px] text-ink-muted">{tx('فعال', 'Active', 'فعاله')}</span> : <button className="btn btn-sm" data-sanction-lift={s.id} onClick={() => { setDone(''); setLift(s); }}>{tx('برداشتن', 'Lift', 'لرې کول')}</button>}</Cell>
              </Row>
            ))}
          </Table>
        )}
      </Box>
      {lift && (
        <KeyDialog needPassword title={`${tx('برداشتنِ جریمه', 'Lift sanction', 'جریمه لرې کول')} · ${tri(SANCTION_LABEL[lift.kind], lift.kind)}`}
          effect={tx('جریمه همان دم برداشته می‌شود؛ ردیفش و دلیل در سابقهٔ پرونده می‌ماند و دکان می‌بیند.', 'The sanction is lifted at once; its row and reason stay in the case history and the shop sees it.', 'جریمه سمدستي لرې کېږي.')}
          onClose={() => setLift(null)} onUnknown={() => void sanctions.reload()}
          onSubmit={async (x: SensitiveSubmit) => {
            await api(MC.sanctionLift(lift.id), { method: 'POST', body: { ...x, confirm: true } });
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
    regions: tx('شمارشِ منطقه‌ای', 'By region', 'د سیمې شمېرنه'),
    orders: tx('سفارش‌ها', 'Orders', 'فرمایشونه'), reports: tx('گزارش‌ها و جریمه‌ها', 'Reports & sanctions', 'راپورونه او جریمې'),
    commission: tx('کمیسیون', 'Commission', 'کمیشن'), history: tx('سابقه', 'History', 'تاریخچه'),
  };
  return (
    <div className="space-y-3">
      <Tabs tabs={VIEWS.map((id) => ({ id, label: label[id] }))} active={view} onChange={(id) => go(id as View)} />
      {view === 'overview' && <Overview go={go} />}
      {view === 'sellers' && <Sellers />}
      {view === 'regions' && <RegionsView />}
      {view === 'orders' && <Orders params={params} setParams={setParams} />}
      {view === 'reports' && <Reports />}
      {view === 'commission' && <CommissionView />}
      {view === 'history' && <HistoryView />}
    </div>
  );
}
