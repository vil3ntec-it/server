// ---------------------------------------------------------------------------
//  برنامهٔ توحید — ساختار دیتابیس
//
//  هر حساب مالِ خودش است: دستگاه‌ها، اشتراک، دکان و داده‌های همگام‌شده همه با
//  account_id بسته می‌شوند و با حذفِ حساب می‌روند. هیچ ردیفی بدونِ صاحب نیست.
// ---------------------------------------------------------------------------
import { db } from '../db.js';

export function ensureTohidSchema() {
  db.exec(`
-- ─────────────────────────── حساب‌ها ───────────────────────────
CREATE TABLE IF NOT EXISTS th_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    TEXT    NOT NULL UNIQUE,        -- acc_xxxxxxxx
  name          TEXT,
  email         TEXT,
  phone         TEXT,
  password_hash TEXT,                            -- scrypt؛ برای ورود با رمز
  disabled      INTEGER NOT NULL DEFAULT 0,
  note          TEXT,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER,
  last_seen_at  INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS th_accounts_email ON th_accounts(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS th_accounts_phone ON th_accounts(phone) WHERE phone IS NOT NULL;

-- ─────────────────────────── دستگاه‌ها ───────────────────────────
CREATE TABLE IF NOT EXISTS th_devices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id   TEXT    NOT NULL REFERENCES th_accounts(account_id) ON DELETE CASCADE,
  uid          TEXT    NOT NULL,                 -- شناسهٔ دستگاه از خودِ برنامه
  name         TEXT,
  platform     TEXT,
  fingerprint  TEXT,
  revoked      INTEGER NOT NULL DEFAULT 0,
  first_seen   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL,
  UNIQUE(account_id, uid)
);

-- ─────────────────────────── اشتراک (VIP) ───────────────────────────
CREATE TABLE IF NOT EXISTS th_subscriptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  TEXT    NOT NULL REFERENCES th_accounts(account_id) ON DELETE CASCADE,
  plan_code   TEXT    NOT NULL,
  plan_title  TEXT,
  features    TEXT    NOT NULL DEFAULT '[]',     -- JSON: قابلیت‌های خریداری‌شده
  status      TEXT    NOT NULL DEFAULT 'active', -- active | suspended | cancelled | expired
  starts_at   INTEGER NOT NULL,
  ends_at     INTEGER NOT NULL,
  grace_days  INTEGER NOT NULL DEFAULT 0,
  max_devices INTEGER NOT NULL DEFAULT 1,
  price       REAL,
  currency    TEXT,
  note        TEXT,
  created_at  INTEGER NOT NULL,
  created_by  TEXT,
  updated_at  INTEGER
);
CREATE INDEX IF NOT EXISTS th_subs_account ON th_subscriptions(account_id);

-- ─────────────────────────── پلن‌ها (قیمت‌نامه) ───────────────────────────
CREATE TABLE IF NOT EXISTS th_plans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL UNIQUE,
  title       TEXT    NOT NULL,
  amount      INTEGER NOT NULL DEFAULT 1,
  unit        TEXT    NOT NULL DEFAULT 'month',  -- day | week | month | year
  price       REAL    NOT NULL DEFAULT 0,
  negotiable  INTEGER NOT NULL DEFAULT 0,
  badge       TEXT,
  features    TEXT    NOT NULL DEFAULT '[]',
  max_devices INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1
);

-- ─────────────────────────── درخواست خرید ───────────────────────────
CREATE TABLE IF NOT EXISTS th_billing_requests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT REFERENCES th_accounts(account_id) ON DELETE CASCADE,
  plan_code  TEXT,
  contact    TEXT,
  message    TEXT,
  status     TEXT NOT NULL DEFAULT 'new',        -- new | done | rejected
  created_at INTEGER NOT NULL
);

-- ─────────────────────────── کد یک‌بارمصرف ───────────────────────────
-- فقط hash کد نگهداری می‌شود و بعد از مصرف یا انقضا پاک می‌شود.
CREATE TABLE IF NOT EXISTS th_otp (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  method     TEXT    NOT NULL,                   -- email | phone
  value      TEXT    NOT NULL,
  code_hash  TEXT    NOT NULL,
  name       TEXT,
  tries      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE(method, value)
);

-- ─────────────────────────── نشست‌ها ───────────────────────────
CREATE TABLE IF NOT EXISTS th_sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id   TEXT    NOT NULL REFERENCES th_accounts(account_id) ON DELETE CASCADE,
  refresh_hash TEXT    NOT NULL UNIQUE,
  device_uid   TEXT,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  revoked      INTEGER NOT NULL DEFAULT 0
);

-- ─────────────────────────── دکان و اعضا ───────────────────────────
CREATE TABLE IF NOT EXISTS th_shops (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id     TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  owner_id    TEXT    NOT NULL REFERENCES th_accounts(account_id) ON DELETE CASCADE,
  max_members INTEGER NOT NULL DEFAULT 5,
  rev         INTEGER NOT NULL DEFAULT 0,
  settings    TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS th_shop_members (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id    TEXT NOT NULL REFERENCES th_shops(shop_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES th_accounts(account_id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'staff',      -- owner | staff
  joined_at  INTEGER NOT NULL,
  UNIQUE(shop_id, account_id)
);

CREATE TABLE IF NOT EXISTS th_shop_invites (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id    TEXT NOT NULL REFERENCES th_shops(shop_id) ON DELETE CASCADE,
  code       TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL DEFAULT 'staff',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_by    TEXT
);

-- تغییرات همگام‌سازی — هر تغییر یک شماره ترتیبی می‌گیرد
CREATE TABLE IF NOT EXISTS th_shop_changes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id    TEXT NOT NULL REFERENCES th_shops(shop_id) ON DELETE CASCADE,
  rev        INTEGER NOT NULL,
  device_id  TEXT,
  account_id TEXT,
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS th_changes_shop_rev ON th_shop_changes(shop_id, rev);

-- ─────────────────────────── اتصال‌ها ───────────────────────────
-- برای اینکه در پنل دیده شود چند نفر وصل‌اند و هرکدام چقدر وصل بوده‌اند.
CREATE TABLE IF NOT EXISTS th_connections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  TEXT,
  device_uid  TEXT,
  kind        TEXT NOT NULL,                     -- otp | api | sync
  ip          TEXT,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  last_seen   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS th_conn_seen ON th_connections(last_seen);
  `);

  seedPlans();
}

/** قیمت‌نامهٔ اولیه — همان چیزی که خودِ برنامه به‌عنوان پیش‌فرض دارد */
function seedPlans() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM th_plans').get().n;
  if (count > 0) return;
  const paid = JSON.stringify(['sales', 'debtors', 'barcode', 'multi_device']);
  const insert = db.prepare(`
    INSERT INTO th_plans (code, title, amount, unit, price, badge, features, max_devices, sort)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run('m1', 'ماهانه', 1, 'month', 500, '', paid, 1, 1);
  insert.run('m6', '۶ ماهه', 6, 'month', 2000, 'پیشنهاد ما', paid, 2, 2);
  insert.run('y1', '۱ ساله', 1, 'year', 3000, 'بیشترین صرفه', paid, 3, 3);
}
