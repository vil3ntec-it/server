// لایهٔ نازکی روی api() برای بخشِ برنامهٔ توحید
import { api } from '../api';

const T = '/api/control/tohid';

export type ThOverview = {
  accounts: number; disabled: number; withVip: number; expiring: number;
  devices: number; newRequests: number; online: number; activeToday: number;
  keyId: string | null;
  settings: ThSettings;
  features: { paid: string[]; free: string[]; core: string[] };
};

export type ThSettings = {
  enabled: boolean; serverToken: string; otpTtlSeconds: number;
  resendSeconds: number; maxTries: number; currency: string;
  whatsapp: string; purchaseMessage: string;
  mail: {
    host: string; port: number; secure: boolean; user: string;
    from: string; fromName: string; passwordSet?: boolean;
  };
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
    api(`${T}/accounts`, { method: 'POST', body: JSON.stringify(body) }),
  setDisabled: (id: string, disabled: boolean) =>
    api(`${T}/accounts/${id}/disable`, { method: 'POST', body: JSON.stringify({ disabled }) }),
  deleteAccount: (id: string) => api(`${T}/accounts/${id}`, { method: 'DELETE' }),

  grantVip: (id: string, body: Record<string, unknown>) =>
    api(`${T}/accounts/${id}/vip`, { method: 'POST', body: JSON.stringify(body) }),
  extend: (subId: number, body: { amount: number; unit: string }) =>
    api(`${T}/subscriptions/${subId}/extend`, { method: 'POST', body: JSON.stringify(body) }),
  setStatus: (subId: number, status: string) =>
    api(`${T}/subscriptions/${subId}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  revokeDevice: (deviceId: number, revoked: boolean) =>
    api(`${T}/devices/${deviceId}/revoke`, { method: 'POST', body: JSON.stringify({ revoked }) }),

  plans: () => api<{ items: ThPlan[] }>(`${T}/plans`),
  savePlan: (plan: Record<string, unknown>) => api(`${T}/plans`, { method: 'PUT', body: JSON.stringify(plan) }),
  deletePlan: (code: string) => api(`${T}/plans/${encodeURIComponent(code)}`, { method: 'DELETE' }),

  requests: () => api<{ items: ThRequest[] }>(`${T}/requests`),
  setRequestStatus: (id: number, status: string) =>
    api(`${T}/requests/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),

  settings: () => api<{ settings: ThSettings; keyId: string | null }>(`${T}/settings`),
  saveSettings: (body: Record<string, unknown>) =>
    api<{ settings: ThSettings }>(`${T}/settings`, { method: 'PUT', body: JSON.stringify(body) }),
  testMail: (to: string) =>
    api<{ ok: boolean; error?: string; detail?: string }>(`${T}/settings/test-mail`, {
      method: 'POST', body: JSON.stringify({ to }),
    }),
};
