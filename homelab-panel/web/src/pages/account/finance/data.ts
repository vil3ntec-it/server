// ---------------------------------------------------------------------------
//  ماژولِ «مالی» (۴.۵) — نشانی‌های پل، شکلِ پاسخ‌ها و چند کمکیِ نمایشی.
//
//  ⛔ هیچ جمع یا حسابی این‌جا نیست: همهٔ عددها از سرورِ حساب (‎/api/admin/finance/*‎ از راهِ
//     ‎/api/account-admin/console/finance/*‎) می‌آیند. نیامده ⇒ «—»، نه صفر (`money`/`fa` ِ ‎shared.tsx‎).
// ---------------------------------------------------------------------------
import { getToken } from '../../../api';

export const FIN = '/api/account-admin/console/finance';

/** نشانی با پرس‌وجو؛ مقدارِ خالی نمی‌رود. */
export function finUrl(path: string, q: Record<string, string | number | null | undefined> = {}): string {
  const qs = new URLSearchParams(
    Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]),
  ).toString();
  return `${FIN}${path}${qs ? `?${qs}` : ''}`;
}

export type Unavail = { available: false; reason?: string; capability?: string; needs?: string; message?: string; fetchedAt?: number };
export const isUnavail = (x: unknown): x is Unavail =>
  Boolean(x && typeof x === 'object' && (x as { available?: unknown }).available === false);

export type Box = { count: number; amount: number };
export type CurrencyTotals = { payments: Box; correction: Box; refund: Box; reversal: Box; net: number };
export type Window = { from: number; to: number; timezone: string; group: string; calendar: string; fromDate: string; toDate: string };
export type Summary = {
  available: true; window: Window; app: string; currencies: string[]; totals: Record<string, CurrencyTotals>;
  series: { key: string; label: string; from: number; to: number; currencies: Record<string, { payments: number; adjustments: number; net: number; count: number }> }[];
  byService: { app: string; currency: string; payments: number; adjustments: number; net: number; count: number }[];
  byMethod: { method: string; currency: string; count: number; amount: number }[];
  checkedAt?: number; fetchedAt?: number;
};
export type Breakdown = {
  available: true; by: 'shop' | 'plan'; total: number; limit: number; offset: number;
  rows: { app: string; key: string; name: string; currency: string; payments: number; adjustments: number; net: number; count: number }[];
  checkedAt?: number;
};
export type Payment = {
  id: string; app: string; tenantId: string; tenantName: string | null; subscriptionId: string; plan: string;
  amount: number; currency: string; method: string; receiptNo: string; note: string; paidAt: number; createdBy: string;
  createdAt: number; deleted: boolean; net: number; references: string[]; revisions: number;
  adjustments: { count: number; total: number; refunded: number; reversed: boolean };
};
export type Payments = { available: true; payments: Payment[]; nextCursor: string | null; checkedAt?: number };
export type Actor = { kind?: string; id?: string; name?: string; role?: string } | null;
export type Adjustment = {
  id: string; docNo: string; kind: string; paymentId: string; app: string; tenantId: string; tenantName?: string | null;
  amount: number; currency: string; netBefore: number; netAfter: number; reference: string; reason: string;
  createdBy: string; actor: Actor; reauth: string; createdAt: number; receiptNo?: string;
};
export type Adjustments = { available: true; adjustments: Adjustment[]; totals: Record<string, Box>; nextCursor: string | null; checkedAt?: number };
export type Revision = { id: number; op: string; changedAt: number; changed: string[]; before: Record<string, unknown> | null; after: Record<string, unknown> | null };
export type AuditEntry = { id: string; at: number; action: string; adminId: string; actor: Actor; targetType: string; targetId: string; shopId: string; detail: Record<string, unknown> };
export type PaymentDetail = { available: true; payment: Payment; adjustments: Adjustment[]; revisions: Revision[]; audit: AuditEntry[]; checkedAt?: number };
export type Receivables = {
  available: true; total: number; limit: number; offset: number; truncated: boolean; totals: Record<string, { count: number; debt: number }>;
  rows: { subscriptionId: string; app: string; tenantId: string; tenantName: string; plan: string; status: string; price: number; priceSource: string;
          currency: string; paid: number; debt: number; endsAt: number }[];
  checkedAt?: number;
};
export type Gateway = {
  state: 'blocked_external' | 'live'; code?: string; message?: string; needs?: string; intents?: number; unit?: string;
  byStatus?: { status: string; count: number; review: number; unmatched: number; amountMinor: number }[];
  items?: { id: string; shopId: string; shopName: string | null; kind: string; amountMinor: number; status: string; providerRef: string;
            matched: boolean; needsReview: boolean; updatedAt: number }[];
  nextCursor?: string | null; checkedAt?: number;
};
export type Pending = {
  available: true;
  purchaseRequests: { counts: { pending: number; approved: number; rejected: number }; total: number; limit: number; offset: number;
    items: { id: string; shopId: string; shopName: string | null; planCode: string; planTitle: string | null; quotedPrice: number | null;
             currency: string; createdAt: number; ageDays: number }[] };
  subscriptionPayments: { failed: null; reason: string };
  gateway: Gateway; checkedAt?: number;
};
export type FindingItem = { paymentId: string; app: string; tenantId: string; tenantName: string | null; amount: number; currency: string;
  receiptNo: string; paidAt: number; subscriptionId: string; [k: string]: unknown };
export type Discrepancies = {
  available: true; findings: { code: string; severity: 'bad' | 'warn'; source: string; count: number; items: FindingItem[] }[];
  gateway: { state: string; code: string | null; message: string | null; needs: string | null };
  totals: { findings: number; items: number }; checkedAt?: number;
};
export type OnlineRecon = {
  available: boolean; reason?: string; needs?: string; checkedAt?: number; fetchedAt?: number;
  local?: { fromDate: string; toDate: string; timezone: string };
  totals?: { salesMinor?: number; refundsMinor?: number; netMinor?: number; issues?: number; courierHeldMinor?: number; cancellations?: number };
  shops?: { shopId: string; shopName: string; netMinor: number; issues: unknown[]; courier?: { heldMinor?: number } }[];
};
export type History = { available: true; entries: AuditEntry[]; actions: string[]; nextCursor: string | null; checkedAt?: number };
export type AdjustResult = { adjustment?: Adjustment; payment?: { id: string; net: number }; replayed?: boolean; checkedAt?: number };

export const KINDS = ['correction', 'refund', 'reversal', 'reference'] as const;
export type Kind = (typeof KINDS)[number];

const DATE_OPTS: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };
export function dateOf(ms: unknown): string {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toLocaleDateString('fa-AF', DATE_OPTS) : '—';
}
export function timeOf(ms: unknown): string {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0
    ? new Date(n).toLocaleString('fa-AF', { ...DATE_OPTS, hour: '2-digit', minute: '2-digit' })
    : '—';
}
/** مبلغِ یکصدم (درگاه/تطبیقِ آنلاین) ⇒ افغانی، با دو رقمِ اعشار اگر لازم است. */
export function minorText(minor: unknown): string {
  const n = Number(minor);
  if (!Number.isFinite(n)) return '—';
  return `${(n / 100).toLocaleString('fa-AF', { maximumFractionDigits: 2 })} افغانی`;
}
/** نامِ «انجام‌دهنده»: آدمِ پشتِ پنل اگر سرورِ حساب گفته، وگرنه شناسهٔ مدیر. */
export function actorText(a: Actor | undefined, fallback = ''): string {
  return a?.name || a?.id || fallback || '—';
}

/**
 * دانلودِ یک صفحه از CSV با نشستِ پنل (توکن در نشانی نمی‌رود). ⇒ { rows, next }
 * ⛔ خطا با کدِ سرور برمی‌گردد (۴۰۳/۵۰۱/…)، نه «دانلود شد» ِ دروغ.
 */
export async function downloadCsv(q: Record<string, string | number | null | undefined>): Promise<{ rows: number; next: string | null }> {
  const res = await fetch(finUrl('/export', q), { headers: { Authorization: `Bearer ${getToken() || ''}` } });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg = `${j?.error || res.status}: ${j?.message || ''}`; } catch { /* نه JSON */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] || 'vill3n-finance.csv';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { rows: Number(res.headers.get('x-row-count')) || 0, next: res.headers.get('x-next-cursor') };
}
