// ---------------------------------------------------------------------------
//  🏪 ۴.۶ مدیریتِ بازار و ۴.۷ نظارت بر پیک — قراردادِ داده، نشانی‌ها و برچسب‌ها، بی React
//
//  ⛔ هیچ عددی این‌جا ساخته نمی‌شود — همه از سرورِ حساب (`/api/admin/market|delivery/*` ِ shop، از راهِ پلِ پنل).
//  ⛔ نیامده = «—»، نه صفر (`num`/`shownNum`)؛ «در مدل نیست» (`inModel: false`، `independent: null`) هم «—» نیست،
//     جمله است: صفحه می‌گوید چرا نیست.
//  ⚠️ بی import و فقط نحوِ قابلِ‌حذفِ TypeScript: `test/console-market.mjs` همین فایل را مستقیم با Node اجرا می‌کند.
// ---------------------------------------------------------------------------

export type Tri = { fa: string; en: string; ps: string };
const T = (fa: string, en: string, ps: string): Tri => ({ fa, en, ps });

/** عدد اگر واقعاً آمده؛ وگرنه `null` (نه صفر). */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
export function shownNum(v: unknown, locale = 'fa-AF'): string {
  const n = num(v);
  return n === null ? '—' : n.toLocaleString(locale);
}
/** مبلغِ یک‌صدم (Minor) ⇒ «۱۲٬۴۰۰ AFN»؛ نیامده ⇒ «—». */
export function money(minor: unknown, currency = 'AFN', locale = 'fa-AF'): string {
  const n = num(minor);
  if (n === null) return '—';
  return `${(n / 100).toLocaleString(locale, { maximumFractionDigits: 2 })} ${currency}`;
}
/** میلی‌ثانیهٔ سن ⇒ دقیقه/ساعت/روز (گرد به پایین)؛ نیامده ⇒ «—». */
export function age(ms: unknown, lang: 'fa' | 'en' | 'ps' = 'fa'): string {
  const n = num(ms);
  if (n === null || n < 0) return '—';
  const m = Math.floor(n / 60000);
  const unit = (fa: string, en: string, ps: string) => (lang === 'en' ? en : lang === 'ps' ? ps : fa);
  if (m < 60) return `${m.toLocaleString(lang === 'en' ? 'en' : 'fa-AF')} ${unit('دقیقه', 'min', 'دقیقې')}`;
  if (m < 48 * 60) return `${Math.floor(m / 60).toLocaleString(lang === 'en' ? 'en' : 'fa-AF')} ${unit('ساعت', 'h', 'ساعته')}`;
  return `${Math.floor(m / 1440).toLocaleString(lang === 'en' ? 'en' : 'fa-AF')} ${unit('روز', 'd', 'ورځې')}`;
}

/* ───────────────────────── برچسب‌های قرارداد (کلیدِ سرور ⇒ سه‌زبانه) ───────────────────────── */

export const ISSUE_LABEL: Record<string, Tri> = {
  accept_overdue: T('پذیرفته نشده', 'Not accepted', 'نه دی منل شوی'),
  dispatch_overdue: T('منتظرِ ارسال، دیر', 'Waiting dispatch (late)', 'د لېږلو په تمه (ناوخته)'),
  courier_unaccepted: T('پیک قبول نکرده', 'Courier not accepted', 'پېک نه دی منلی'),
  pickup_overdue: T('از دکان برداشته نشده', 'Not picked up', 'له هټۍ نه دی اخیستل شوی'),
  delivery_overdue: T('در راه، بی خبر', 'In delivery, no update', 'په لاره کې، بې خبره'),
  failed_unresolved: T('ناموفق، بی تصمیم', 'Failed, unresolved', 'ناکام، بې پرېکړې'),
  recall_pending: T('فراخوانی بی نتیجه', 'Recall pending', 'بېرته غوښتنه بې پایلې'),
  delivered_not_reflected: T('تحویل شد ولی سفارش نه', 'Delivered, order not updated', 'سپارل شوی، فرمایش نه'),
  departed_not_reflected: T('در راه ولی سفارش نه', 'Departed, order not updated', 'په لاره کې، فرمایش نه'),
  failed_not_reflected: T('ناموفق ولی سفارش نه', 'Failed, order not updated', 'ناکام، فرمایش نه'),
  returned_not_reflected: T('برگشت ولی سفارش نه', 'Returned, order not updated', 'بېرته راغلی، فرمایش نه'),
  closed_order_live_mission: T('سفارش بسته، مأموریت زنده', 'Order closed, mission live', 'فرمایش بند، ماموریت ژوندی'),
  cod_not_recorded: T('نقد گرفته شد، ثبت نشد', 'Cash taken, not recorded', 'نغدې اخیستل شوې، ثبت نه شوې'),
  cash_review: T('اختلافِ نقد', 'Cash difference', 'د نغدو توپیر'),
  payment_unconfirmed: T('پرداخت تأیید نشده', 'Payment unconfirmed', 'تادیه نه ده تایید شوې'),
};
export const GATE_LABEL: Record<string, Tri> = {
  directory: T('بازارِ همگانی روشن', 'Marketplace on (all)', 'عمومي بازار روښانه'),
  marketFlag: T('پرچم/حالتِ بازارِ این دکان', 'Shop market flag / hold', 'د هټۍ د بازار بیرغ'),
  storefrontFlag: T('پرچمِ ویترین', 'Storefront flag', 'د ننداریز بیرغ'),
  ordersFlag: T('پرچمِ سفارشِ آنلاین', 'Online orders flag', 'د آنلاین فرمایش بیرغ'),
  entitled: T('اشتراکِ ویترین', 'Storefront entitlement', 'د ننداریز ګډون'),
  storefrontEnabled: T('ویترین روشن', 'Storefront enabled', 'ننداریز فعال'),
  shopActive: T('دکان فعال', 'Shop active', 'هټۍ فعاله'),
  listed: T('صاحب خواسته در فهرست باشد', 'Owner opted in', 'خاوند غوښتي'),
  notSuspended: T('بی جریمهٔ تعلیق', 'No storefront suspension', 'بې ځنډونې جریمې'),
  hasPublished: T('کالای منتشرشده', 'Published products', 'خپاره توکي'),
};
export const STAGE_LABEL: Record<string, Tri> = {
  preparing: T('آماده‌سازی', 'Preparing', 'چمتووالی'),
  dispatch: T('منتظرِ ارسال', 'Waiting dispatch', 'د لېږلو په تمه'),
  assigned: T('سپرده به پیک', 'Assigned', 'پېک ته سپارل شوی'),
  in_delivery: T('در راه', 'In delivery', 'په لاره کې'),
  failed: T('ناموفق', 'Failed', 'ناکام'),
};
export const SANCTION_LABEL: Record<string, Tri> = {
  warning: T('هشدار', 'Warning', 'خبرداری'),
  hide_listing: T('پنهان کردنِ کالا', 'Hide product', 'توکی پټول'),
  suspend_storefront: T('تعلیقِ ویترین', 'Suspend storefront', 'ننداریز ځنډول'),
};
export const THRESHOLD_LABEL: Record<string, Tri> = {
  acceptMin: T('پذیرشِ سفارش', 'Order acceptance', 'د فرمایش منل'),
  dispatchMin: T('ارسالِ سفارشِ آماده', 'Dispatch of packed order', 'د چمتو فرمایش لېږل'),
  courierAcceptMin: T('قبولِ پیک', 'Courier acceptance', 'د پېک منل'),
  pickupMin: T('برداشتن از دکان', 'Pickup from shop', 'له هټۍ اخیستل'),
  inDeliveryMin: T('در راه بی خبر', 'In delivery without update', 'په لاره کې بې خبره'),
  failedMin: T('ناموفقِ بی تصمیم', 'Failed without decision', 'ناکام بې پرېکړې'),
  recallMin: T('فراخوانیِ بی نتیجه', 'Recall without result', 'بېرته غوښتنه بې پایلې'),
};
export const THRESHOLD_KEYS = Object.keys(THRESHOLD_LABEL);

export const QUEUE_VIEWS = ['all', 'dispatch', 'assigned', 'in_delivery', 'failed', 'preparing', 'stuck', 'mismatch', 'discrepancy'];
export const ORDER_GROUPS = ['awaiting', 'in_progress', 'completed', 'cancelled', 'returns'];
export const SELLER_STATES = ['listed', 'unlisted', 'held', 'sanctioned', 'inactive'];

/** همهٔ کدهای یک ردیف — برای نمایش؛ ترتیب: گیر کرده، ناهم‌خوان، اختلاف. */
export function issuesOf(i: { stuck?: string[]; mismatch?: string[]; discrepancy?: string[] } | null | undefined) {
  if (!i) return [] as { code: string; kind: 'stuck' | 'mismatch' | 'discrepancy' }[];
  const out: { code: string; kind: 'stuck' | 'mismatch' | 'discrepancy' }[] = [];
  for (const kind of ['stuck', 'mismatch', 'discrepancy'] as const) {
    for (const code of Array.isArray(i[kind]) ? i[kind] : []) out.push({ code, kind });
  }
  return out;
}

/** «جمعِ ردیف‌ها = جمعِ کل» برای هر ستونِ عددیِ `totals` — سنجش، نه ساختنِ عدد. ناهم‌خوان ⇒ نامِ ستون‌ها. */
export function sumMismatches(rows: Record<string, unknown>[] | undefined, totals: Record<string, unknown> | undefined): string[] {
  if (!totals || typeof totals !== 'object') return [];
  const list = Array.isArray(rows) ? rows : [];
  const bad: string[] = [];
  for (const [k, v] of Object.entries(totals)) {
    const t = num(v);
    if (t === null) continue;
    const s = list.reduce((acc, r) => acc + (num(r[k]) ?? 0), 0);
    if (s !== t) bad.push(k);
  }
  return bad;
}

/** آستانه‌ها: فقط عددِ صحیحِ ۱ تا ۱۰٬۰۸۰ دقیقه — همان مرزِ سرور. */
export function thresholdOk(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10_080;
}

/** نشانیِ هر در — یک جا. */
const C = '/api/account-admin/console';
const qs = (o: Record<string, unknown>) => {
  const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return p.length ? `?${p.join('&')}` : '';
};
export const MC = {
  overview: (days: number) => `${C}/market/overview${qs({ days })}`,
  sellers: (q: string, state: string, limit: number, offset: number) => `${C}/market/sellers${qs({ q, state, limit, offset })}`,
  orders: (o: { days?: number; shopId?: string; group?: string; problem?: boolean; limit?: number; offset?: number }) =>
    `${C}/market/orders${qs({ ...o, problem: o.problem ? '1' : '' })}`,
  ordersCsv: (o: { days?: number; shopId?: string; group?: string; problem?: boolean }) =>
    `${C}/market/orders.csv${qs({ ...o, problem: o.problem ? '1' : '' })}`,
  commission: (days: number) => `${C}/market/commission${qs({ days })}`,
  history: (limit: number, before?: number | null, shopId?: string) => `${C}/market/history${qs({ limit, before, shopId })}`,
  cases: (status: string, shopId?: string) => `${C}/market/trust/cases${qs({ status, shopId, limit: 100 })}`,
  caseOne: (id: string) => `${C}/market/trust/cases/${encodeURIComponent(id)}`,
  caseAssign: (id: string) => `${C}/market/trust/cases/${encodeURIComponent(id)}/assign`,
  caseDecide: (id: string) => `${C}/market/trust/cases/${encodeURIComponent(id)}/decide`,
  caseAppeal: (id: string) => `${C}/market/trust/cases/${encodeURIComponent(id)}/appeal-decision`,
  sanctions: (active: boolean, shopId?: string) => `${C}/market/trust/sanctions${qs({ active: active ? '1' : '', shopId, limit: 200 })}`,
  sanctionLift: (id: string) => `${C}/market/trust/sanctions/${encodeURIComponent(id)}/lift`,
  dOverview: (days: number) => `${C}/delivery/overview${qs({ days })}`,
  dQueue: (o: { view?: string; shopId?: string; days?: number; limit?: number; offset?: number }) => `${C}/delivery/queue${qs(o)}`,
  dQueueCsv: (o: { view?: string; shopId?: string; days?: number }) => `${C}/delivery/queue.csv${qs(o)}`,
  dEvents: (o: { shopId?: string; kind?: string; before?: number | null; limit?: number }) => `${C}/delivery/events${qs(o)}`,
  dConnectivity: `${C}/delivery/connectivity`,
  dReport: (days: number) => `${C}/delivery/report${qs({ days })}`,
  dThresholds: `${C}/delivery/thresholds`,
  shopHolds: (id: string) => `${C}/shops/${encodeURIComponent(id)}/holds`,
  liftHold: (id: string, holdId: string) => `${C}/shops/${encodeURIComponent(id)}/holds/${encodeURIComponent(holdId)}/lift`,
};

/* ───────────────────────── شکلِ پاسخ‌ها (همان shop/server/src/lib/admin-*.js) ───────────────────────── */

export type Issues = { stuck?: string[]; mismatch?: string[]; discrepancy?: string[] };
export type Stamped = { available?: boolean; fetchedAt?: number; serverTime?: number };
export type MarketOverview = Stamped & {
  window?: { from: number; to: number };
  directory?: { on?: boolean; flag?: string; perShop?: { on?: number; off?: number } };
  sellers?: { total?: number; storefrontOn?: number; listed?: number; listedOpen?: number; shopInactive?: number };
  sellerKinds?: { vill3nShops?: number; independent?: number | null; note?: string };
  holds?: Record<string, number>;
  sanctions?: Record<string, number>;
  trust?: { productReports?: number; complaints?: number; appealed?: number };
  orders?: { total?: number; groups?: Record<string, number>; completedTotalMinor?: Record<string, number>;
             problems?: { stuck?: number; mismatch?: number; discrepancy?: number; truncated?: boolean } };
  multiSeller?: { inModel?: boolean; groups?: number | null; needs?: string };
  commission?: { inModel?: boolean };
};
export type SellerHold = { id: string; kind: string; service?: string | null; placedAt?: number | null };
export type Seller = {
  shopId: string; name: string; shopStatus?: string; kind?: string; slug?: string | null; category?: string | null;
  lastSeenAt?: number | null; publishedProducts?: number; gates?: Record<string, boolean>; blockedBy?: string[];
  holds?: SellerHold[]; sanctions?: { id: string; kind: string; productId?: string; at?: number | null }[];
  casesPending?: number; orders30d?: number; delivery?: { flag?: boolean; couriersActive?: number; couriersTotal?: number };
};
export type Sellers = Stamped & { total?: number; limit?: number; offset?: number; sellers?: Seller[]; categories?: { key: string; label: string }[] };
export type Mission = { id: string; status: string; mode?: string; attemptNo?: number | null; courierId?: string | null;
  courierName?: string | null; updatedAt?: number | null; cashReview?: boolean; recall?: string | null;
  expectedCollectMinor?: number | null; cashCollectedMinor?: number | null };
export type MarketOrder = {
  id: string; shopId: string; shopName?: string; orderNo?: number | null; status: string; fulfillment?: string;
  payment?: { method?: string; status?: string; cod?: string | null }; currency?: string; totalMinor?: number | null;
  createdAt?: number | null; mission?: Mission | null; issues?: Issues; complaintsOpen?: number;
};
export type MarketOrders = Stamped & { total?: number; limit?: number; offset?: number; orders?: MarketOrder[]; truncated?: boolean; scanned?: number };
export type Commission = Stamped & {
  inModel?: boolean; reason?: string; needs?: string; decision?: { by?: string; date?: string; text?: string };
  policy?: { scope: string; key: string; value: unknown; updatedAt?: number | null }[];
  totals?: { currency: string; orders: number; charged: number; platformFeeMinor: number; commissionMinor: number }[];
};
export type HistoryEntry = { id: string; shopId?: string | null; actorType?: string; userId?: string | null; action: string;
  targetType?: string | null; targetId?: string | null; detail?: Record<string, unknown> | null; at?: number | null };
export type History = Stamped & { entries?: HistoryEntry[] };
export type TrustCase = { id: string; shopId?: string; shopName?: string; kind?: string; subject?: string; category?: string;
  severity?: string; status?: string; orderNo?: number | null; productId?: string; createdAt?: number | null;
  evidenceCount?: number; flags?: string[]; outcome?: string };
export type TrustCaseFull = TrustCase & { body?: string; reporterHint?: string;
  reporterStats?: { total?: number; upheld?: number; dismissed?: number; shops?: number };
  decision?: { outcome?: string; reason?: string; by?: string; at?: number } | null;
  appeal?: { body?: string; at?: number; outcome?: string | null; reason?: string } | null;
  sanctions?: { id: string; kind: string; productId?: string; liftedAt?: number | null }[];
  history?: { type: string; at?: number; actor?: string; body?: string }[] };
export type Sanction = { id: string; shopId?: string; caseId?: string; kind: string; productId?: string; reason?: string;
  createdAt?: number | null; liftedAt?: number | null };

export type DeliveryOverview = Stamped & {
  windowDays?: number; scanned?: number; truncated?: boolean;
  thresholds?: { values?: Record<string, number>; source?: Record<string, string>; updatedAt?: number | null };
  stages?: Record<string, number>; stuck?: Record<string, number>; mismatch?: Record<string, number>;
  discrepancy?: Record<string, number>; ordersWith?: { stuck?: number; mismatch?: number; discrepancy?: number };
  last24h?: { delivered?: number; failed?: number; returned?: number; created?: number };
  couriers?: { total?: number; active?: number; shops?: number };
  service?: { flagAll?: boolean; flagAllSet?: boolean; shopsOn?: number; shopsOff?: number; heldByAdmin?: number };
};
export type QueueRow = { orderId: string; shopId: string; shopName?: string; orderNo?: number | null; status: string;
  stage?: string | null; mission?: Mission | null; ageMs?: number | null; issues?: Issues; totalMinor?: number | null; currency?: string };
export type Queue = Stamped & { view?: string; total?: number; limit?: number; offset?: number; rows?: QueueRow[]; truncated?: boolean };
export type DEvent = { id: string; shopId: string; shopName?: string; orderNo?: number | null; kind: string; from?: string | null;
  to?: string | null; actorType?: string; reason?: string | null; serverTime?: number | null; skewMs?: number | null };
export type DEvents = Stamped & { events?: DEvent[] };
export type Connectivity = Stamped & { lastCourierEventAt?: number | null; heartbeat?: { inModel?: boolean };
  rejectedEvents?: { stored?: boolean };
  shops?: { shopId: string; shopName?: string; couriers?: number; active?: number; lastCourierEventAt?: number | null;
    events24h?: number; devices24h?: number; maxSkewMs?: number | null; liveMissions?: number }[] };
export type ReportRow = Record<string, unknown> & { shopId: string; shopName?: string; courierId?: string | null; courierName?: string };
export type DReport = Stamped & { window?: { from: number; to: number }; rows?: ReportRow[]; totals?: Record<string, number> };
export type Thresholds = Stamped & { values?: Record<string, number>; source?: Record<string, string>;
  defaults?: Record<string, number>; updatedAt?: number | null; updatedBy?: string | null; unchanged?: boolean };
