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

/* ───────────── فاز ۳ (ریپوی shop، PR #597 + چسب) — شکلِ واقعیِ پاسخ‌ها، پشتِ «توانایی» ─────────────
 *  همان شکلی که ‎server/src/lib/shop-health.js‎، ‎lib/shop-holds.js‎ و ‎routes/admin-flags.js‎ ِ shop برمی‌گردانند.
 *  ⛔ نامِ توانایی‌ها همان نام‌های سرورِ حساب‌اند (‎CAPABILITIES‎ ِ ‎routes/admin.js‎): یکی برای هر دو سو.
 */

/** سلامتِ یک دکان — ‎GET /api/admin/shops/:id/health‎ (`shop-health.v1`). زمانِ سنجش = `at` ِ سرورِ حساب. */
export type HealthDevice = {
  engine?: 'v1' | 'v3'; deviceId: string; appVersion?: string | null; schemaVersion?: number | null;
  lastPushAt?: number | null; lastPullAt?: number | null; lastSeenAt?: number | null;
  queued?: number; behind?: number | null; lastErrorAt?: number | null;
};
export type ShopHealth = {
  available: true; fetchedAt?: number; at?: number;
  shop?: { id: string; name?: string; status?: string; createdAt?: number };
  state?: HoldState;
  subscription?: { source?: string; status?: string; phase?: string; plan?: string | null; endsAt?: number | null;
                   graceEndsAt?: number | null; daysLeft?: number | null; endedByAdmin?: boolean;
                   trial?: { active?: boolean; endsAt?: number | null } | null };
  sync?: {
    lastSyncAt?: number | null;
    v1?: { devices?: number; lastPushAt?: number | null; lastPullAt?: number | null; queued?: number;
           behindMax?: number | null; openConflicts?: number };
    v3?: { devices?: number; lastPushAt?: number | null; lastPullAt?: number | null; lastErrorAt?: number | null };
    legacy?: { lastPushAt?: number | null; devices?: number; lastSyncAt?: number | null };
  };
  devices?: HealthDevice[];
  versions?: { appVersion: string | null; devices: number }[];
  errors?: { last24h?: number; last7d?: number; lastAt?: number | null; lastAppVersion?: string | null };
};

/** چهار حالتِ جدا + بایگانی (‎lib/shop-holds.js‎). هیچ‌کدام چیزی پاک نمی‌کند؛ همه برداشتنی‌اند. */
export type HoldKind = 'access_suspended' | 'service_disabled' | 'subscription_ended' | 'deletion_requested' | 'archived';
export const HOLD_KINDS: HoldKind[] = ['access_suspended', 'service_disabled', 'subscription_ended', 'deletion_requested', 'archived'];
/** سرویس‌هایی که «غیرفعال کردنِ سرویس» می‌شناسد — کلیدِ پرچمِ هر کدام. */
export const HOLD_SERVICES: string[] = ['shop.storefront', 'shop.orders', 'shop.delivery', 'shop.chat', 'market.directory'];
/** پول‌مجاور ⇒ سرورِ حساب کلیدِ یکتایی را اجباری می‌داند (رابط برای همه می‌فرستد). */
export const MONEY_HOLDS: HoldKind[] = ['subscription_ended'];

export type HoldActor = { kind?: string; id?: string; name?: string; role?: string; effectiveRole?: string } | null;
export type Hold = {
  id: string; shopId?: string; kind: HoldKind | string; service?: string | null; reason?: string;
  placedBy?: string; placedActor?: HoldActor; placedAt?: number | null;
  liftedAt?: number | null; liftedBy?: string | null; liftedActor?: HoldActor; liftReason?: string | null; active?: boolean;
};
export type HoldState = {
  access?: 'open' | 'blocked'; blockedBy?: string[]; servicesDisabled?: string[];
  subscriptionEnded?: boolean; deletionRequested?: boolean; archived?: boolean;
};
/** ‎GET /api/admin/shops/:id/holds‎ (`shop-holds.v1`) */
export type ShopHolds = {
  available: true; fetchedAt?: number; shopId?: string; state?: HoldState; open?: Hold[]; history?: Hold[];
  kinds?: string[]; services?: Record<string, string>; roles?: Record<string, string[]>;
};
/** پاسخِ گذاشتن/برداشتن — `replayed` ⇒ همان کارِ پیشین (کلیدِ یکتایی)، نه کارِ دوم. */
export type HoldResult = { hold?: Hold; state?: HoldState; replayed?: boolean; fetchedAt?: number };

/** دلیل: ۳ تا ۲۰۰ نویسه — همان مرزِ سرورِ حساب (‎REASON_MIN/MAX‎). */
export function reasonOk(v: unknown): boolean {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length >= 3 && s.length <= 200;
}

/** کلیدِ یکتایی برای یک پنجرهٔ تأیید — ⚠️ ‎crypto.randomUUID‎ روی http ِ شبکهٔ خانه نیست؛ ‎getRandomValues‎ هست. */
export function newIdemKey(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return `pnl-${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/** نامِ «انجام‌دهنده» ِ یک حالت: آدمِ پشتِ پنل اگر سرورِ حساب گفته، وگرنه شناسهٔ مدیر؛ هیچ ⇒ «—». */
export function actorLabel(actor: HoldActor | undefined, by?: string | null): string {
  if (actor && (actor.name || actor.id)) return String(actor.name || actor.id);
  return by ? String(by) : '—';
}

/** پرچم‌ها — ‎GET /api/admin/flags‎ (`flags.v1`): مقدارهای یک scope + کاتالوگِ پرچم‌های شناخته. */
export type FlagItem = { key: string; value: unknown; updatedAt?: number; updatedBy?: string };
export type KnownFlag = { key: string; scope?: string; default?: unknown; what?: string };
export type Flags = { available: true; fetchedAt?: number; scope?: string; version?: number;
                      items?: FlagItem[]; known?: KnownFlag[]; reserved?: string[] };
/** ‎GET /api/admin/flags/history‎ — چه کسی، کی، پیشین ⇒ تازه، چرا. صفحه‌بندی با `before` (زمانِ آخرین ردیف). */
export type FlagHistoryEntry = { id?: string; scope?: string; key: string; action?: string; oldValue?: unknown;
                                 newValue?: unknown; changedBy?: string; actor?: HoldActor; reason?: string | null; at?: number };
export type FlagHistory = { available: true; fetchedAt?: number; entries?: FlagHistoryEntry[] };

/** صفحهٔ بعدیِ تاریخچه: فقط وقتی صفحه پر آمده؛ وگرنه `null` (نه «شاید بیشتر هست»). */
export function nextBefore(entries: { at?: number }[] | undefined, limit: number): number | null {
  if (!Array.isArray(entries) || entries.length < limit) return null;
  const last = num(entries[entries.length - 1]?.at);
  return last !== null && last > 0 ? last : null;
}

/** مقدارِ پرچم برای نمایش: نیامده (`undefined`) ⇒ «—»؛ `null`/`false`/`0` همان خودشان. */
export function flagValue(v: unknown): string {
  if (v === undefined) return '—';
  try { return JSON.stringify(v); } catch { return '—'; }
}

export type Capabilities = { capabilities?: string[]; checkedAt?: number;
                             known?: { id: string; needs: string; available: boolean }[] };

/** حالِ پل — ‎GET /api/account-admin/console/service-key‎. ⛔ خودِ کلید هرگز در این شکل نیست. */
export type ServiceKeyStatus = {
  stored?: boolean; mode?: 'service' | 'legacy' | 'none'; reason?: string | null; legacy?: boolean; owner?: boolean;
  checkedAt?: number;
  probe?: { ok?: boolean; code?: string | null; at?: number; capabilities?: string[] } | null;
  serviceKey?: { id: string; name?: string | null; roleCap?: string | null; createdAt?: number | null;
                 createdBy?: string | null; storedAt?: number | null; rotatedFrom?: string | null } | null;
  previous?: { id: string; revoked?: boolean; error?: string | null } | null;
  rotated?: boolean;
};

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
  shopHolds: (id: string) => `/api/account-admin/console/shops/${encodeURIComponent(id)}/holds`,
  liftHold: (id: string, holdId: string) =>
    `/api/account-admin/console/shops/${encodeURIComponent(id)}/holds/${encodeURIComponent(holdId)}/lift`,
  flags: (scope = 'all') => `/api/account-admin/console/flags?scope=${encodeURIComponent(scope)}`,
  flagHistory: (key: string, before?: number | null, limit = 50) =>
    `/api/account-admin/console/flags/history?key=${encodeURIComponent(key)}&limit=${limit}${before ? `&before=${before}` : ''}`,
  serviceKey: '/api/account-admin/console/service-key',
  serviceKeyRevoke: '/api/account-admin/console/service-key/revoke',
  accountAudit: (limit: number, shopId?: string) =>
    `/api/account-admin/account-audit?limit=${limit}${shopId ? `&shopId=${encodeURIComponent(shopId)}` : ''}`,
  shops: (q: string, limit: number, offset: number, hold = '') =>
    `/api/account-admin/shops?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}${hold ? `&hold=${encodeURIComponent(hold)}` : ''}`,
};
