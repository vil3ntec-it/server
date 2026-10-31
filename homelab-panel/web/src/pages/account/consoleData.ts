// ---------------------------------------------------------------------------
//  🏪 کنسولِ فروشگاه (فاز ۲ ِ پنلِ مرکزیِ مالک) — قراردادِ داده و قاعدهٔ نمایش، بی React
//
//  ⛔ **نیامده = «—»، نه صفر.** هر عددی که از سرورِ حساب نیامده (نبودِ فیلد، `null`، رشتهٔ خالی، NaN)
//     «—» نشان داده می‌شود؛ صفرِ واقعی «۰». صفرِ دروغ بدتر از خالی است: مدیر «صفر خطا» می‌بیند و باور می‌کند.
//  ⛔ **هر عدد منبع و زمان دارد**: `stampOf` زمانِ «سنجیدهٔ سرورِ حساب» (`checkedAt`/`serverTime`) را جلوتر
//     از «رسیدن به پنل» (`fetchedAt`) می‌گذارد و می‌گوید کدام است — هرگز ساعتِ مرورگر.
//  ⛔ **هیچ عددی این‌جا ساخته نمی‌شود**؛ جمع، گروه و حالت همه از سرورِ حساب‌اند.
//
//  ⚠️ این پرونده هیچ import و هیچ نحوِ غیرِ قابلِ‌حذفِ TypeScript ندارد: `test/live-pages.mjs` همین فایل را
//     مستقیم با Node اجرا و قاعدهٔ «نیامده = —» را روی خودِ کد می‌سنجد (همان الگوی `subsPath.ts`).
// ---------------------------------------------------------------------------

/** عدد اگر واقعاً آمده؛ وگرنه `null`. ⛔ `undefined`/`null`/`''`/NaN هرگز صفر نمی‌شوند. */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** نمایشِ یک عدد با ارقامِ همان زبان؛ نیامده ⇒ «—». */
export function shown(v: unknown, locale = 'fa-AF'): string {
  const n = num(v);
  return n === null ? '—' : n.toLocaleString(locale);
}

/** بایت ⇒ «۱٫۲ GB»؛ نیامده ⇒ «—». */
export function bytes(v: unknown, locale = 'fa-AF'): string {
  const n = num(v);
  if (n === null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let x = n;
  let i = 0;
  while (Math.abs(x) >= 1024 && i < units.length - 1) { x /= 1024; i += 1; }
  return `${x.toLocaleString(locale, { maximumFractionDigits: 1 })} ${units[i]}`;
}

export type Stamp = { at: number; kind: 'server' | 'panel' } | null;

/**
 * زمانِ «آخرین به‌روزرسانی» یک پاسخ: سنجیدهٔ سرورِ حساب اگر گفته (`checkedAt` / `serverTime`)،
 * وگرنه زمانِ رسیدن به پنل (`fetchedAt`). هیچ‌کدام ⇒ `null` (صفحه «—» می‌گوید، نه «همین حالا»).
 */
export function stampOf(data: unknown): Stamp {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const server = num(d.checkedAt) ?? num(d.serverTime);
  if (server !== null && server > 0) return { at: server, kind: 'server' };
  const panel = num(d.fetchedAt);
  if (panel !== null && panel > 0) return { at: panel, kind: 'panel' };
  return null;
}

/** چند دقیقه پیش (گرد به پایین)؛ آینده/نامعتبر ⇒ ۰، نیامده ⇒ `null`. */
export function minutesAgo(at: unknown, now: number): number | null {
  const n = num(at);
  if (n === null || n <= 0) return null;
  return Math.max(0, Math.floor((now - n) / 60000));
}

/** حالتِ سلامت (ok | warn | down | unknown) ⇒ رنگ؛ ناشناخته هرگز سبز نیست. */
export function healthTone(status: unknown): 'good' | 'warn' | 'bad' | 'neutral' {
  if (status === 'ok') return 'good';
  if (status === 'warn') return 'warn';
  if (status === 'down') return 'bad';
  return 'neutral';
}

/** حالتِ سرویسِ بیرونی (live | mock | incomplete | off | none | unknown) ⇒ رنگ؛ فقط `live` سبز است. */
export function providerTone(state: unknown): 'good' | 'warn' | 'bad' | 'neutral' {
  if (state === 'live') return 'good';
  if (state === 'mock' || state === 'off') return 'warn';
  if (state === 'incomplete') return 'bad';
  return 'neutral';
}

/* ───────────────── پاسخِ «داده در دسترس نیست» (فاز ۳ نیامده) ───────────────── */

export type Unavailable = {
  available: false;
  reason: string;
  capability: string;
  needs: string;
  message?: string;
  fetchedAt?: number;
};

export function isUnavailable(x: unknown): x is Unavailable {
  return Boolean(x) && typeof x === 'object' && (x as { available?: unknown }).available === false;
}

/* ───────────────── شکلِ پاسخ‌ها — همان سرورِ حساب (shop/server/src/lib/system-health.js و …) ───────────────── */

export type HealthStatus = 'ok' | 'warn' | 'down' | 'unknown';

export type SystemHealth = {
  status?: HealthStatus;
  checkedAt?: number;
  fetchedAt?: number;
  api?: { status?: HealthStatus; version?: string; uptimeSeconds?: number; rssBytes?: number };
  database?: { status?: HealthStatus; latencyMs?: number; driver?: string };
  queues?: {
    email?: { status?: HealthStatus; worker?: string; queued?: number; sending?: number; failed24h?: number; oldestAgeMs?: number | null };
    telegram?: { status?: HealthStatus; pending?: number; failed24h?: number; oldestAgeMs?: number | null };
  };
  sync?: { status?: HealthStatus; clientErrors24h?: number; conflicts24h?: number };
  storage?: { status?: HealthStatus; freeBytes?: number; totalBytes?: number; freePct?: number | null };
  backups?: { status?: HealthStatus; enabled?: boolean; encryption?: boolean; count?: number;
              last?: { at?: number; kind?: string; bytes?: number; encrypted?: boolean } | null; ageMs?: number | null };
};

export type ProviderRow = { id: string; mode?: string; state?: string; missing?: string[]; decision?: string };
export type Providers = { checkedAt?: number; fetchedAt?: number; production?: boolean;
                          counts?: Record<string, number>; providers?: ProviderRow[] };

export type VersionRow = { version: string; devices?: number; lastSeenAt?: number | null; state?: string };
export type AppVersions = { app: string; latest?: string; minVersion?: string; devices?: number; unknown?: number;
                            belowMin?: number; outdated?: number | null; status?: HealthStatus; versions?: VersionRow[];
                            versionsTruncated?: boolean };
export type Versions = { checkedAt?: number; fetchedAt?: number; activeDays?: number; truncated?: boolean;
                         status?: HealthStatus; apps?: AppVersions[] };

export type ReleaseBeta = {
  shops?: { ids?: string[]; updatedAt?: number; updatedBy?: string };
  devices?: { ids?: string[]; updatedAt?: number; updatedBy?: string };
  version?: number; fetchedAt?: number;
};
export type VersionHealth = { app?: string; version?: string; installs?: number; crashes?: number; fetchedAt?: number };
export type LiveConfig = { scope?: string; version?: number; fetchedAt?: number;
                           items?: { key: string; value: unknown; updatedAt?: number; updatedBy?: string }[] };
export type ChainReport = { ok?: boolean; checkedAt?: number; enabled?: boolean; total?: number; okCount?: number;
                            brokenCount?: number; broken?: { chain: string; seq?: number; reason?: string }[] };

/* ───────────────── فاز ۳ (ریپوی shop) — قراردادِ آماده، پشتِ «توانایی» ───────────────── */

/**
 * سلامتِ یک دکان — ‎GET /api/admin/shops/:id/health‎ (توانایی `shop-health.v1`).
 * ⛔ `online` و `lastSyncAt` را سرورِ حساب می‌گوید؛ نیامده ⇒ «—».
 */
export type ShopHealth = {
  available: true; shopId?: string; checkedAt?: number; fetchedAt?: number;
  online?: boolean | null; onlineWithinMs?: number; lastSyncAt?: number | null;
  devices?: { deviceId: string; app?: string; appVersion?: string; lastSeenAt?: number | null; online?: boolean }[];
};
/** حالتِ دسترسیِ یک دکان — ‎GET /api/admin/shops/:id/suspension‎ (توانایی `shop-suspension.v1`). */
export type ShopSuspension = {
  available: true; fetchedAt?: number;
  state?: 'active' | 'access_suspended' | 'service_disabled' | 'subscription_ended' | 'archived';
  reason?: string; since?: number | null; by?: string;
};
/** پرچم‌ها با تاریخچه — ‎GET /api/admin/flags‎ و ‎/flags/history‎ (توانایی `flags.v1`). */
export type Flags = { available: true; checkedAt?: number; fetchedAt?: number;
                      flags?: { key: string; value: unknown; updatedAt?: number; updatedBy?: string; reason?: string }[] };
export type FlagHistory = { available: true; fetchedAt?: number; next?: number | null;
                            entries?: { key: string; from?: unknown; to?: unknown; at?: number; by?: string; reason?: string }[] };

export type Capabilities = { capabilities?: string[]; checkedAt?: number;
                             known?: { id: string; needs: string; available: boolean }[] };

/** نشانیِ هر درِ پلِ کنسول — یک جا؛ صفحه نشانی را دستی نمی‌سازد. */
export const CONSOLE = {
  health: '/api/account-admin/console/system/health',
  providers: '/api/account-admin/console/system/providers',
  versions: '/api/account-admin/console/system/versions',
  chainVerify: '/api/account-admin/console/system/chain-verify',
  releaseBeta: '/api/account-admin/console/release/beta',
  capabilities: '/api/account-admin/console/capabilities',
  versionHealth: (app: string, version: string) =>
    `/api/account-admin/console/version-health?app=${encodeURIComponent(app)}&version=${encodeURIComponent(version)}`,
  liveConfig: (scope: string) => `/api/account-admin/console/live-config?scope=${encodeURIComponent(scope)}`,
  shopHealth: (id: string) => `/api/account-admin/console/shops/${encodeURIComponent(id)}/health`,
  shopSuspension: (id: string) => `/api/account-admin/console/shops/${encodeURIComponent(id)}/suspension`,
  flags: '/api/account-admin/console/flags',
  flagHistory: (key: string, before?: number) =>
    `/api/account-admin/console/flags/history?key=${encodeURIComponent(key)}${before ? `&before=${before}` : ''}`,
  accountAudit: (limit: number, shopId?: string) =>
    `/api/account-admin/account-audit?limit=${limit}${shopId ? `&shopId=${encodeURIComponent(shopId)}` : ''}`,
  shops: (q: string, limit: number, offset: number) =>
    `/api/account-admin/shops?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`,
};
