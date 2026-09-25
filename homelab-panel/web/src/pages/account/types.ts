// شکل‌هایی که سرورِ حساب می‌دهد — یک‌به‌یک از پاسخِ همان مسیرها.
// ⛔ این‌جا چیزی «حساب» نمی‌شود؛ فقط نامِ فیلدها نوشته شده تا TypeScript
//    بتواند بگوید کدام فیلد واقعاً هست و کدام را حدس زده‌ایم.
import type { AppId } from './shared';

export type SubRow = {
  id: string | number;
  app: AppId;
  tenantId: string;
  tenantName: string;
  ownerUserId: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  city: string;
  plan: string;
  planTitle: string;
  status: string;
  active: boolean;
  startsAt: number;
  endsAt: number;
  daysLeft: number;
  permanent: boolean;
  price: number | null;
  currency: string;
  paid: number;
  features: string[];
  note: string;
  createdAt?: number;
  /**
   *  ⚠️ این ردیف اشتراک نیست، **خودِ حساب** است: پمپ یا دکانی که ثبت شده و
   *  هیچ‌وقت چیزی نخریده. تا ۱۴۰۵/۰۷/۱۱ اصلاً در این فهرست نبود (فهرست از
   *  `sales/subscriptions` می‌آمد) و صاحبِ سامانه همین را «حساب‌های ثبت‌شده
   *  بالا نمیاد» می‌دید.
   *
   *  ⛔ نشانِ صریح است، نه نتیجه‌گیری از خالی بودنِ فیلدها — وگرنه روزی
   *  اشتراکی با پلنِ بی‌نام هم «بی‌اشتراک» خوانده می‌شد.
   */
  neverSubscribed?: boolean;
};

export type DeviceRow = { id: string; uid: string; name: string; lastSeenAt: number; revoked: boolean };

export type ShopProfile = {
  account: {
    accountId: string; name: string; ownerName: string; ownerUserId: string;
    email: string; phone: string; note: string; disabled: boolean;
    createdAt: number; lastLoginAt: number | null;
  };
  entitlement: {
    isPaid: boolean; source: string; status: string; daysLeft: number; plan: string;
    planTitle: string; subEndsAt: number | null; maxDevices: number; features: string[]; message: string;
  };
  subscriptions: { id: string | number; plan_code: string; plan_title: string; status: string; starts_at: number; ends_at: number; note?: string }[];
  devices: DeviceRow[];
  members: { id: string; role: string; status: string; name?: string }[];
  counts: Record<string, number>;
};

export type PumpProfile = {
  station: { id: string; code?: string; name: string; status?: string; createdAt?: number; ownerUserId?: string } | null;
  accessCode: string;
  owner: { id: string; name: string; email: string; phone: string; status: string } | null;
  members: { id: string; role: string; status: string; name?: string }[];
  entitlement: { source?: string; features?: string[]; subscription?: Record<string, unknown> } | null;
  subscription: Record<string, unknown> | null;
  files: { path: string; rev: number; size: number; updatedAt: number }[];
  devices: DeviceRow[];
  /** کامپیوترهای ثبت‌شده به همین پمپ — نه دستگاه‌های ورودِ صاحب حساب. */
  computers?: PumpComputer[];
  deviceLimit?: number;
};

export type PumpComputer = {
  id: string; uid: string; name: string; platform: string;
  createdAt: number; lastSeenAt: number; revoked: boolean;
};

export type Payment = {
  id: string; app: AppId; tenantId: string; subscriptionId: string; amount: number; currency: string;
  method: string; receiptNo: string; note: string; paidAt: number; createdAt: number;
  tenantName?: string; ownerName?: string; ownerEmail?: string; ownerPhone?: string;
};

export type Addon = {
  id: string; app: AppId; subscriptionId: string; feature: string;
  price: number; currency: string; note: string; createdAt: number;
};

export type Plan = {
  code: string; title: string; amount: number; unit: string; price: number; fullPrice: number;
  discount: { percent: number; savings: number; label: string; until: number | null } | null;
  negotiable: boolean; badge: string; features: string[]; maxDevices: number; active: boolean; days: number;
};

export type PriceChange = {
  id: string; app: AppId; plan: string; prevPrice: number | null; price: number;
  currency: string; changedAt: number; changedBy: string;
};

export type DiscountCode = {
  id: string; code: string; app: AppId; plan: string; kind: 'percent' | 'amount'; value: number;
  currency: string; userId: string; expiresAt: number | null; maxUses: number | null;
  oncePerCustomer: boolean; uses: number; note: string; status: string; createdBy: string; createdAt: number;
};

export type Campaign = {
  id: string; name: string; app: string; filter: Record<string, unknown>;
  discountCodeId: string; noticeId: string; status: string; createdBy: string; createdAt: number;
};

export type CampaignStats = {
  campaign: Campaign; codes: DiscountCode[];
  recipients: number; sent: number; seen: number; codeUses: number; renewed: number;
};

export type Notice = {
  id: string; app: string; audience: Record<string, unknown>; channels: string[];
  title: string; body: string; templateKey: string; variables: Record<string, string>;
  scheduleAt: number | null; repeat: string; status: string; system: boolean;
  createdBy: string; createdAt: number; updatedAt: number; sentAt: number | null;
  runs: number; counts: Record<string, number>;
};

export type NoticeTemplate = { key: string; app: string; title: string; body: string; channels: string[]; editable: boolean; updatedAt: number };

export type Delivery = {
  id: string; noticeId: string; app: string; userId: string; tenantId: string;
  channel: string; status: string; who: string; address: string; title: string; body: string;
  error: string | null; run: number; createdAt: number; sentAt: number | null;
  deliveredAt: number | null; readAt: number | null;
};

export type Recipient = {
  app: string; userId: string; tenantId: string; name: string; tenantName: string;
  email: string; city: string; plan: string; status: string; daysLeft: number | null; permanent: boolean;
};

export type SalesSummary = {
  revenue: Record<string, Record<string, Record<string, number>>>;
  series: { month: string; from: number; to: number; shop: Record<string, number>; pump: Record<string, number>; payments: number }[];
  counts: Record<string, { active: number; expired: number; suspended: number; tenants: number }>;
  serverTime: number;
};

export type Expiring = {
  subscriptionId: string | number; app: AppId; tenantId: string; tenantName: string;
  ownerName: string; ownerEmail: string; ownerPhone: string; plan: string;
  status: string; endsAt: number; graceEndsAt: number; daysLeft: number; note: string;
};

export type Debt = SubRow & { debt: number };

export type SyncDevice = {
  account: { kind: string; id: string };
  device_id: string; cursor: number; last_push_at: number | null; last_pull_at: number | null;
  last_op_at: number | null; queued_count: number; app_version: string; schema_version: number;
  last_seen_at: number; head: number; behind: number; conflicts: number; deleted: number;
};

export type SyncConflict = {
  id: number; app: string; account: { kind: string; id: string };
  table: string; row_id: string; field: string;
  loser_op_id: string; winner_op_id: string; loser_device: string; winner_device: string;
  at: number; restored_at: number | null;
};

export type ClientError = {
  id: string; app: string; account_id: string; device_id: string; user_id: string; tenant_id: string;
  app_version: string; version: string; platform: string; message: string; at: number;
};

export type LoginRequest = {
  request_id: string; app: string; masked_email?: string; email?: string; status: string;
  created_at: number; expires_at?: number; tries?: number; ip?: string;
};

export type Thread = {
  id: string; app: string; who: string; status: string; unreadAdmin: number;
  lastMessage: string; lastSender: string; createdAt: number; updatedAt: number;
  accountName?: string; shopName?: string; stationName?: string;
};

export type Message = {
  id: string; threadId: string; sender: string; senderId: string; senderName: string;
  body: string; kind: string; readAt: number | null; createdAt: number;
};
