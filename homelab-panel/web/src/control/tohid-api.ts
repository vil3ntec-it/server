// ---------------------------------------------------------------------------
//  ⚠️ body را رشته نکنید.
//
//  api() در src/api.ts خودش JSON.stringify می‌کند. اگر این‌جا هم رشته بدهیم،
//  دوبار کدگذاری می‌شود و سرور می‌گیرد:
//
//      Unexpected token '"', ""{\"method"... is not valid JSON
//
//  همهٔ نوشتن‌های این فایل — از جمله «دادن اشتراک» — با همین باگ ۵۰۰ می‌دادند
//  و در رابط کاربری فقط «انجام نشد» دیده می‌شد.
// ---------------------------------------------------------------------------
// لایهٔ نازکی روی api() برای بخشِ برنامهٔ توحید
import { api } from '../api';

const T = '/api/control/tohid';

export type ThAddresses = {
  port: number;
  lan: { ip: string; otp: string; api: string }[];
  local: { otp: string; api: string };
  /** نشانیِ عمومی — فقط وقتی تونل روشن است، وگرنه null */
  remote: { api: string; otp: string; permanent: boolean; hostname: string | null } | null;
  tunnelStatus: string;
};

export type ThOverview = {
  accounts: number; disabled: number; withVip: number; expiring: number;
  devices: number; newRequests: number; online: number; activeToday: number;
  keyId: string | null;
  settings: ThSettings;
  addresses: ThAddresses;
  features: { paid: string[]; free: string[]; core: string[] };
};

export type ThSettings = {
  enabled: boolean; serverToken: string; otpTtlSeconds: number;
  resendSeconds: number; maxTries: number; currency: string;
  whatsapp: string; purchaseMessage: string;
  otpMessage: string;
  mail: {
    host: string; port: number; secure: boolean; user: string;
    from: string; fromName: string; passwordSet?: boolean;
  };
  sms: {
    enabled: boolean; url: string; method: string; contentType: string;
    headers: string; body: string; tokenSet?: boolean;
  };
};

export type ThOtpStatus = {
  channels: {
    email: { ready: boolean; host: string };
    sms: { ready: boolean; url: string };
  };
  ttlSeconds: number;
  resendSeconds: number;
  maxTries: number;
  pending: {
    method: string; value: string; name: string; tries: number;
    createdAt: number; expiresAt: number; expired: boolean;
  }[];
};

export type ThAccount = {
  accountId: string; name: string; email: string; phone: string;
  disabled: boolean; createdAt: number; lastLoginAt: number | null;
  lastSeenAt: number | null; devices: number; vip: boolean;
  plan: string | null; planCode: string | null; daysLeft: number;
  subEndsAt: number | null; status: string;
};

export type ThSubscription = {
  id: number; account_id: string; plan_code: string; plan_title: string;
  features: string[]; status: string; starts_at: number; ends_at: number;
  grace_days: number; max_devices: number; price: number | null;
  currency: string | null; note: string | null;
};

export type ThDevice = {
  id: number; uid: string; name: string | null; platform: string | null;
  revoked: number; first_seen: number; last_seen: number;
};

export type ThPlan = {
  id: number; code: string; title: string; amount: number; unit: string;
  price: number; negotiable: number; badge: string; features: string[];
  max_devices: number; sort: number; active: number;
};

export type ThOnline = {
  accountId: string | null; name: string; contact: string;
  deviceUid: string | null; kind: string; ip: string | null;
  startedAt: number; lastSeen: number; connectedMs: number;
};

export type ThRequest = {
  id: number; account_id: string | null; plan_code: string | null;
  contact: string | null; message: string | null; status: string;
  created_at: number; name: string | null; email: string | null; phone: string | null;
};

export const th = {
  overview: () => api<ThOverview>(`${T}/overview`),
  online: () => api<{ items: ThOnline[]; online: number; activeToday: number }>(`${T}/online`),

  accounts: (q?: string) => api<{ items: ThAccount[] }>(`${T}/accounts${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  account: (id: string) => api<{
    account: ThAccount & { note: string };
    entitlement: Record<string, unknown> & { isPaid: boolean; planTitle?: string; daysLeft: number; status: string };
    subscriptions: ThSubscription[];
    devices: ThDevice[];
    shop: { shop: { name: string; rev: number } | null; members: { userId: string; name: string }[] };
  }>(`${T}/accounts/${id}`),
  createAccount: (body: { name?: string; email?: string; phone?: string; password?: string }) =>
    api(`${T}/accounts`, { method: 'POST', body }),
  setDisabled: (id: string, disabled: boolean) =>
    api(`${T}/accounts/${id}/disable`, { method: 'POST', body: { disabled } }),
  deleteAccount: (id: string) => api(`${T}/accounts/${id}`, { method: 'DELETE' }),

  grantVip: (id: string, body: Record<string, unknown>) =>
    api(`${T}/accounts/${id}/vip`, { method: 'POST', body }),
  extend: (subId: number, body: { amount: number; unit: string }) =>
    api(`${T}/subscriptions/${subId}/extend`, { method: 'POST', body }),
  setStatus: (subId: number, status: string) =>
    api(`${T}/subscriptions/${subId}/status`, { method: 'POST', body: { status } }),
  revokeDevice: (deviceId: number, revoked: boolean) =>
    api(`${T}/devices/${deviceId}/revoke`, { method: 'POST', body: { revoked } }),

  plans: () => api<{ items: ThPlan[] }>(`${T}/plans`),
  savePlan: (plan: Record<string, unknown>) => api(`${T}/plans`, { method: 'PUT', body: plan }),
  deletePlan: (code: string) => api(`${T}/plans/${encodeURIComponent(code)}`, { method: 'DELETE' }),

  requests: () => api<{ items: ThRequest[] }>(`${T}/requests`),
  setRequestStatus: (id: number, status: string) =>
    api(`${T}/requests/${id}/status`, { method: 'POST', body: { status } }),

  settings: () => api<{ settings: ThSettings; addresses: ThAddresses; keyId: string | null }>(`${T}/settings`),
  saveSettings: (body: Record<string, unknown>) =>
    api<{ settings: ThSettings }>(`${T}/settings`, { method: 'PUT', body }),
  testMail: (to: string) =>
    api<{ ok: boolean; error?: string; detail?: string }>(`${T}/settings/test-mail`, {
      method: 'POST', body: { to },
    }),

  otp: () => api<ThOtpStatus>(`${T}/otp`),
  purgeOtp: () => api<{ ok: boolean; removed: number }>(`${T}/otp/purge`, { method: 'POST' }),
  testOtp: (method: string, to: string) =>
    api<{ ok: boolean; error?: string; detail?: string }>(`${T}/otp/test`, {
      method: 'POST', body: { method, to },
    }),

  /** کد را می‌سازد ولی نمی‌فرستد — برای وقتی که ایمیل تنظیم نشده */
  manualOtp: (method: string, to: string) =>
    api<ThManualCode>(`${T}/otp/manual`, {
      method: 'POST', body: { method, to },
    }),

  /** دکانِ یک حساب و کدهای پیوستنش */
  shop: (id: string) => api<ThShopView>(`${T}/accounts/${id}/shop`),
  shopInvite: (id: string, body: { role: string; uses: number; days: number }) =>
    api<ThShopView & { ok: boolean; code: string; role: string; uses: number; expiresAt: number | null }>(
      `${T}/accounts/${id}/shop-invite`, { method: 'POST', body },
    ),
  revokeShopInvite: (id: string, code: string) =>
    api<ThShopView>(`${T}/accounts/${id}/shop-invite/${code}/revoke`, { method: 'POST' }),

  vault: () => api<ThVault>(`${T}/vault`),
  saveVault: (dir: string) =>
    api<ThVault>(`${T}/vault`, { method: 'POST', body: { dir } }),
  rebuildVault: () =>
    api<ThVault & { total: number; saved: number }>(`${T}/vault/rebuild`, { method: 'POST' }),
};

export type ThManualCode = {
  ok: boolean;
  code?: string;
  minutes?: number;
  to?: string;
  subject?: string;
  body?: string;
  mailto?: string;
  gmail?: string;
  whatsapp?: string | null;
  error?: string;
  detail?: string;
};

export type ThVault = {
  enabled: boolean;
  root: string;
  writable: boolean;
  folders: number;
  error?: string | null;
};

export type ThShopInvite = {
  code: string;
  role: string;
  uses: number;
  maxUses: number;
  usedCount: number;
  createdAt: number;
  expiresAt: number | null;
  revoked: boolean;
  active: boolean;
};

export type ThShopView = {
  shop: { id: string; name: string; ownerId: string; maxMembers: number; rev: number } | null;
  members: { userId: string; name: string; email: string; phone: string; role: string }[];
  invites: ThShopInvite[];
};
