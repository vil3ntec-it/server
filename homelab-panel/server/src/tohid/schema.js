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

-- ─────────────────── دفترِ تغییرهای اشتراک ───────────────────
-- جدولِ th_subscriptions فقط «حالا» را نگه می‌دارد. این یکی می‌گوید چه کسی
-- کِی چه کرد و تاریخِ پایان از چه به چه رسید — تا اگر روزی سرِ یک تمدید
-- حرف شد، جواب از روی ردیف باشد نه از روی حافظه.
CREATE TABLE IF NOT EXISTS th_subscription_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id      TEXT    NOT NULL,
  subscription_id INTEGER,
  action          TEXT    NOT NULL,   -- grant | extend | set_end | status
  plan_code       TEXT,
  prev_ends_at    INTEGER,
  new_ends_at     INTEGER,
  status          TEXT,
  note            TEXT,
  actor           TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS th_sub_log_account ON th_subscription_log(account_id, created_at DESC);

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
    -- ─────────────────────────── کد اشتراک ───────────────────────────
    --
    --  مدیر کد می‌سازد، سرور خودش ایمیلش می‌کند، کاربر در برنامه یا سایت
    --  می‌زند و اشتراکش فعال می‌شود. صاحب سامانه دیگر واسطه نیست.
    --
    --  خودِ کد اینجا نیست — فقط HMACش. پس کسی که به فایلِ دیتابیس دست
    --  پیدا کند نمی‌تواند کدها را بردارد و برای خودش اشتراک بسازد.
    CREATE TABLE IF NOT EXISTS th_vip_codes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      code_id       TEXT    NOT NULL UNIQUE,       -- vip_xxxxxxxx
      code_hash     TEXT    NOT NULL UNIQUE,
      code_hint     TEXT    NOT NULL DEFAULT '',   -- دو رقم آخر، برای شناختن در فهرست
      plan          TEXT    NOT NULL DEFAULT 'custom',
      days          INTEGER,
      note          TEXT    NOT NULL DEFAULT '',
      -- به کدام ایمیل رفت و آیا رسید
      email         TEXT    NOT NULL DEFAULT '',
      email_status  TEXT    NOT NULL DEFAULT 'none',   -- none | sent | failed
      email_error   TEXT    NOT NULL DEFAULT '',
      email_sent_at INTEGER,
      -- اگر برای حسابِ مشخصی صادر شده باشد، فقط همان می‌تواند خرجش کند
      account_id    TEXT,
      created_by    TEXT    NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL,
      expires_at    INTEGER,
      status        TEXT    NOT NULL DEFAULT 'active', -- active | used | revoked | expired
      used_at       INTEGER,
      used_by       TEXT    NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS th_vip_codes_status ON th_vip_codes(status, created_at DESC);

    -- ─────────────────────────── بازدیدکننده‌ها ───────────────────────────
    --
    --  تا امروز فقط کسی دیده می‌شد که ثبت‌نام کرده بود. کسی که برنامه را
    --  باز کرده ولی هنوز حساب نساخته — یعنی همان کسی که باید دنبالش رفت —
    --  هیچ‌جا شمرده نمی‌شد.
    --
    --  ردیف به «دستگاه» بسته است نه به حساب، چون مهمان حسابی ندارد. اگر
    --  بعداً حساب ساخت، account_id همان ردیف پر می‌شود و تاریخِ اولین
    --  باری که آمده گم نمی‌شود.
    CREATE TABLE IF NOT EXISTS th_visitors (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      app           TEXT    NOT NULL DEFAULT 'shop',
      device_uid    TEXT    NOT NULL,
      platform      TEXT    NOT NULL DEFAULT '',   -- web | android | ios | desktop
      app_version   TEXT    NOT NULL DEFAULT '',
      account_id    TEXT    NOT NULL DEFAULT '',   -- خالی یعنی مهمان
      name          TEXT    NOT NULL DEFAULT '',
      ip            TEXT    NOT NULL DEFAULT '',
      user_agent    TEXT    NOT NULL DEFAULT '',
      language      TEXT    NOT NULL DEFAULT '',
      lat           REAL,
      lng           REAL,
      accuracy      REAL,
      place         TEXT    NOT NULL DEFAULT '',
      first_seen_at INTEGER NOT NULL,
      last_seen_at  INTEGER NOT NULL,
      visits        INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX IF NOT EXISTS th_visitors_device ON th_visitors(app, device_uid);
    CREATE INDEX IF NOT EXISTS th_visitors_seen ON th_visitors(last_seen_at DESC);

    -- ─────────────────────────── چت پشتیبانی ───────────────────────────
    --
    --  هر «گفت‌وگو» یک نفر است، نه یک موضوع: کسی که وسطِ فروش گیر کرده،
    --  موضوع نمی‌سازد و شمارهٔ پیگیری دنبال نمی‌کند.
    --
    --  مهمانِ بی‌حساب هم می‌تواند بنویسد — با شناسهٔ دستگاهش. کسی که هنوز
    --  ثبت‌نام نکرده و همان‌جا گیر کرده، بیشتر از همه به این نیاز دارد.
    CREATE TABLE IF NOT EXISTS th_support_threads (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id    TEXT    NOT NULL UNIQUE,        -- thr_xxxxxxxx
      app          TEXT    NOT NULL DEFAULT 'shop',
      account_id   TEXT    NOT NULL DEFAULT '',
      device_uid   TEXT    NOT NULL DEFAULT '',
      who          TEXT    NOT NULL DEFAULT '',
      contact      TEXT    NOT NULL DEFAULT '',
      status       TEXT    NOT NULL DEFAULT 'open',  -- open | closed
      unread_admin INTEGER NOT NULL DEFAULT 0,
      unread_user  INTEGER NOT NULL DEFAULT 0,
      last_message TEXT    NOT NULL DEFAULT '',
      last_sender  TEXT    NOT NULL DEFAULT '',
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS th_threads_updated ON th_support_threads(updated_at DESC);
    CREATE INDEX IF NOT EXISTS th_threads_account ON th_support_threads(account_id);
    CREATE INDEX IF NOT EXISTS th_threads_device  ON th_support_threads(device_uid);

    CREATE TABLE IF NOT EXISTS th_support_messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id  TEXT    NOT NULL UNIQUE,
      thread_id   TEXT    NOT NULL,
      sender      TEXT    NOT NULL DEFAULT 'user',  -- user | admin | system
      sender_name TEXT    NOT NULL DEFAULT '',
      body        TEXT    NOT NULL,
      kind        TEXT    NOT NULL DEFAULT 'text',
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS th_messages_thread ON th_support_messages(thread_id, created_at);

    -- ─────────────────────────── توکن پوش ───────────────────────────
    --
    --  «حتی برنامه‌اش که بسته بود پیام برود» فقط با این ممکن است: برنامهٔ
    --  بسته هیچ درخواستی نمی‌زند، پس سرور باید پیام را به سرویسِ پوش
    --  بسپارد نه به برنامه‌ای که باز نیست.
    CREATE TABLE IF NOT EXISTS th_push_tokens (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      app         TEXT    NOT NULL DEFAULT 'shop',
      token       TEXT    NOT NULL,
      account_id  TEXT    NOT NULL DEFAULT '',
      admin_user  TEXT    NOT NULL DEFAULT '',
      device_uid  TEXT    NOT NULL DEFAULT '',
      platform    TEXT    NOT NULL DEFAULT '',
      status      TEXT    NOT NULL DEFAULT 'active', -- active | stale
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      last_error  TEXT    NOT NULL DEFAULT ''
    );
    CREATE UNIQUE INDEX IF NOT EXISTS th_push_token ON th_push_tokens(app, token);

    -- ─────────────────────── برنامه‌ها و سایت‌های دیگر ───────────────────────
    --
    --  قرارِ صاحب سامانه: این پنل فقط برای فروشگاه نباشد. از هر برنامه سه
    --  چیز دیده می‌شود: بالا هست یا نه، چند نفر آمده‌اند، و چند گفت‌وگوی
    --  پشتیبانیِ باز دارد.
    CREATE TABLE IF NOT EXISTS th_managed_apps (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      slug          TEXT    NOT NULL UNIQUE,
      title         TEXT    NOT NULL DEFAULT '',
      kind          TEXT    NOT NULL DEFAULT 'app',   -- app | site | service
      url           TEXT    NOT NULL DEFAULT '',
      health_url    TEXT    NOT NULL DEFAULT '',
      note          TEXT    NOT NULL DEFAULT '',
      -- کلیدِ برنامه‌ای که خودش می‌خواهد به این سرور خبر بدهد.
      -- خام هرگز ذخیره نمی‌شود؛ فقط HMACش و چهار نویسهٔ آخر برای شناختن.
      api_key_hash  TEXT    NOT NULL DEFAULT '',
      api_key_hint  TEXT    NOT NULL DEFAULT '',
      status        TEXT    NOT NULL DEFAULT 'active',-- active | paused | archived
      last_check_at INTEGER,
      last_ok       INTEGER,
      last_status   INTEGER,
      last_ms       INTEGER,
      last_error    TEXT    NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );
  `);

  addMissingColumns();
  seedPlans();
  seedApps();
}

/**
 * ستون‌هایی که بعداً اضافه شده‌اند.
 *
 * ⚠️ CREATE TABLE IF NOT EXISTS روی دیتابیسی که از قبل هست هیچ کاری نمی‌کند،
 * پس ستونِ تازه به جدولِ قدیمی اضافه نمی‌شود. برای همین این‌جا جدا انجام
 * می‌شود — و چون ALTER TABLE برای ستونِ تکراری خطا می‌دهد، اول پرسیده می‌شود.
 */
function addMissingColumns() {
  const add = (table, column, definition) => {
    const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  // کدِ پیوستن: چند بار قابل استفاده باشد (۰ = بی‌شمار) و تا حالا چند بار
  // استفاده شده. کدهای قدیمی یک‌بارمصرف بودند، پس پیش‌فرض ۱ است.
  add('th_shop_invites', 'max_uses', 'INTEGER NOT NULL DEFAULT 1');
  add('th_shop_invites', 'used_count', 'INTEGER NOT NULL DEFAULT 0');
  add('th_shop_invites', 'revoked', 'INTEGER NOT NULL DEFAULT 0');
  add('th_shop_invites', 'created_by', 'TEXT');

  /*
   *  تخفیف روی نرخ‌ها.
   *
   *  قیمتِ اصلی (`price`) دست نمی‌خورد؛ تخفیف کنارش می‌نشیند. پس وقتی
   *  مهلتش تمام شد، قیمتِ خودش برمی‌گردد و کسی لازم نیست عددِ قبلی را به
   *  یاد داشته باشد.
   *
   *  دو راه: درصد یا قیمتِ ثابتِ تخفیفی. اگر هر دو پر باشند، قیمتِ ثابت
   *  می‌چربد — عددِ صریح از درصد روشن‌تر است و گِردکردن ندارد.
   */
  add('th_plans', 'discount_percent', 'INTEGER NOT NULL DEFAULT 0');
  add('th_plans', 'discount_price', 'REAL');
  add('th_plans', 'discount_label', 'TEXT');
  //  NULL یعنی بی‌مهلت
  add('th_plans', 'discount_until', 'INTEGER');
}

/**
 * دو برنامهٔ همیشگی — فروشگاه و خودِ پنل.
 *
 * تا فهرست خالی نباشد؛ صفحهٔ «برنامه‌ها» با صفرِ خالی، آدم را به این فکر
 * می‌اندازد که چیزی خراب است.
 */
function seedApps() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM th_managed_apps').get().n;
  if (count > 0) return;
  const now = Date.now();
  const insert = db.prepare(`
    INSERT INTO th_managed_apps (slug, title, kind, url, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `);
  insert.run('shop', 'فروشگاه توحید', 'app', 'https://vil3ntec-it.github.io/shop/', now, now);
  insert.run('admin', 'برنامهٔ مدیریت', 'app', '', now, now);
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
