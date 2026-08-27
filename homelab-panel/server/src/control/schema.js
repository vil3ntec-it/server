// ---------------------------------------------------------------------------
//  مرکز فرمان — ساختار دیتابیس
//
//  قانونِ مطلق: هر ردیفی که به یک پروژه تعلق دارد، ستون project_id دارد و با
//  حذفِ پروژه، خودش هم می‌رود (ON DELETE CASCADE). هیچ جدولی بدونِ مسیرِ
//  روشنِ «این ردیف مالِ کدام پروژه است» ساخته نمی‌شود.
//
//  همهٔ جدول‌ها با CREATE TABLE IF NOT EXISTS ساخته می‌شوند و ستون‌های تازه با
//  addColumn اضافه می‌شوند، پس به‌روزرسانیِ نسخهٔ قدیمی هیچ داده‌ای را نمی‌برد.
// ---------------------------------------------------------------------------
import { db } from '../db.js';

/** ستون را فقط وقتی نبود اضافه می‌کند — برای مهاجرتِ بی‌دردسر */
function addColumn(table, column, definition) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (cols.some((c) => c.name === column)) return false;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    return true;
  } catch {
    return false;
  }
}

export function ensureControlSchema() {
  db.exec(`
-- ─────────────────────────── سرورها ───────────────────────────
CREATE TABLE IF NOT EXISTS cc_servers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id    TEXT    NOT NULL UNIQUE,          -- srv_xxxxxxxx
  name         TEXT    NOT NULL,
  kind         TEXT    NOT NULL DEFAULT 'home',  -- home | vps | dedicated | cloud | hosting
  hostname     TEXT,
  ip           TEXT,
  ipv6         TEXT,
  ssh_port     INTEGER,
  os           TEXT,
  provider     TEXT,
  location     TEXT,
  note         TEXT,
  is_local     INTEGER NOT NULL DEFAULT 0,       -- همین کامپیوتری که پنل رویش است
  agent_key    TEXT,                             -- کلیدِ هش‌شدهٔ Agent (خودِ کلید ذخیره نمی‌شود)
  agent_seen   INTEGER,                          -- آخرین گزارشِ Agent
  agent_report TEXT,                             -- آخرین گزارشِ کامل (JSON)
  status       TEXT    NOT NULL DEFAULT 'unknown',
  checked_at   INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- ─────────────────────────── پروژه‌ها ──────────────────────────
CREATE TABLE IF NOT EXISTS cc_projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT    NOT NULL UNIQUE,           -- prj_xxxxxxxx — شناسهٔ ثابت و غیرقابل‌تغییر
  slug        TEXT    NOT NULL UNIQUE,           -- نامِ پوشه روی دیسک
  name        TEXT    NOT NULL,
  type        TEXT    NOT NULL,                  -- android|desktop|website|webapp|backend|api|websocket|database|service
  version     TEXT,
  status      TEXT    NOT NULL DEFAULT 'active', -- active | paused | archived
  description TEXT,
  server_id   INTEGER REFERENCES cc_servers(id) ON DELETE SET NULL,
  storage_path TEXT,                             -- پوشهٔ اختصاصیِ همین پروژه
  repo_url    TEXT,
  site_id     INTEGER REFERENCES sites(id) ON DELETE SET NULL,  -- اگر سایتِ اجراییِ پنل هم هست
  db_kind     TEXT,                              -- postgres | mysql | sqlite | mongo | none
  db_host     TEXT,
  db_port     INTEGER,
  db_name     TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_type ON cc_projects(type);

-- ─────────────────────────── آدرس‌های IP ───────────────────────
CREATE TABLE IF NOT EXISTS cc_ips (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER REFERENCES cc_projects(id) ON DELETE CASCADE,
  server_id   INTEGER REFERENCES cc_servers(id)  ON DELETE CASCADE,
  address     TEXT    NOT NULL,
  family      TEXT    NOT NULL DEFAULT 'ipv4',   -- ipv4 | ipv6
  kind        TEXT    NOT NULL DEFAULT 'local',  -- local | lan | public | server | vps
  port        INTEGER,
  environment TEXT    NOT NULL DEFAULT 'production',
  status      TEXT    NOT NULL DEFAULT 'unknown',
  latency_ms  INTEGER,
  checked_at  INTEGER,
  description TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ips_project ON cc_ips(project_id);

-- ─────────────────────────── پورت‌ها ───────────────────────────
CREATE TABLE IF NOT EXISTS cc_ports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER REFERENCES cc_projects(id) ON DELETE CASCADE,
  server_id   INTEGER REFERENCES cc_servers(id)  ON DELETE CASCADE,
  port        INTEGER NOT NULL,
  protocol    TEXT    NOT NULL DEFAULT 'tcp',    -- tcp | udp | http | https | ws | wss
  service     TEXT,
  environment TEXT    NOT NULL DEFAULT 'production',
  status      TEXT    NOT NULL DEFAULT 'unknown',
  checked_at  INTEGER,
  note        TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ports_project ON cc_ports(project_id);
CREATE INDEX IF NOT EXISTS idx_ports_server  ON cc_ports(server_id, port);

-- ─────────────────────── نقاط اتصال (Endpoint) ────────────────
CREATE TABLE IF NOT EXISTS cc_endpoints (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES cc_projects(id) ON DELETE CASCADE,
  server_id   INTEGER REFERENCES cc_servers(id) ON DELETE SET NULL,
  name        TEXT,
  protocol    TEXT    NOT NULL,                  -- http | https | ws | wss
  host        TEXT    NOT NULL,
  ip          TEXT,
  port        INTEGER,
  path        TEXT    NOT NULL DEFAULT '/',
  environment TEXT    NOT NULL DEFAULT 'production',
  is_primary  INTEGER NOT NULL DEFAULT 0,
  monitored   INTEGER NOT NULL DEFAULT 1,
  status      TEXT    NOT NULL DEFAULT 'unknown',
  status_code INTEGER,
  latency_ms  INTEGER,
  error       TEXT,
  checked_at  INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_endpoints_project ON cc_endpoints(project_id);

-- ───────────────────── مسیرِ دامنه → سرویس ─────────────────────
CREATE TABLE IF NOT EXISTS cc_routes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_id   INTEGER REFERENCES domains(id) ON DELETE CASCADE,
  hostname    TEXT    NOT NULL UNIQUE,           -- api.example.com
  project_id  INTEGER REFERENCES cc_projects(id) ON DELETE SET NULL,
  server_id   INTEGER REFERENCES cc_servers(id)  ON DELETE SET NULL,
  tunnel_id   INTEGER REFERENCES cc_tunnels(id)  ON DELETE SET NULL,
  kind        TEXT    NOT NULL DEFAULT 'tunnel', -- tunnel | dns | proxy | manual
  service     TEXT,                              -- http://localhost:3000
  label       TEXT,                              -- «REST API» ، «WebSocket» …
  status      TEXT    NOT NULL DEFAULT 'unknown',
  checked_at  INTEGER,
  note        TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- ──────────────────── حساب و تونل‌های Cloudflare ───────────────
CREATE TABLE IF NOT EXISTS cc_cf_accounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  account_id  TEXT,
  email       TEXT,
  secret_id   INTEGER REFERENCES cc_secrets(id) ON DELETE SET NULL,
  status      TEXT    NOT NULL DEFAULT 'unknown',
  verified_at INTEGER,
  last_error  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cc_tunnels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  tunnel_uuid TEXT,
  account_ref INTEGER REFERENCES cc_cf_accounts(id) ON DELETE SET NULL,
  server_id   INTEGER REFERENCES cc_servers(id)  ON DELETE SET NULL,
  project_id  INTEGER REFERENCES cc_projects(id) ON DELETE SET NULL,
  managed_by  TEXT    NOT NULL DEFAULT 'panel',  -- panel | external
  status      TEXT    NOT NULL DEFAULT 'unknown',
  conns       INTEGER,
  last_check  INTEGER,
  last_error  TEXT,
  note        TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cc_tunnel_routes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tunnel_id   INTEGER NOT NULL REFERENCES cc_tunnels(id) ON DELETE CASCADE,
  hostname    TEXT    NOT NULL,
  service     TEXT    NOT NULL,
  project_id  INTEGER REFERENCES cc_projects(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE(tunnel_id, hostname)
);

-- ───────────────────────── فروشگاه‌ها ─────────────────────────
CREATE TABLE IF NOT EXISTS cc_shops (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id     TEXT    NOT NULL UNIQUE,           -- shop_xxxxxxxx
  project_id  INTEGER NOT NULL REFERENCES cc_projects(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  owner_name  TEXT,
  owner_phone TEXT,
  manager     TEXT,
  address     TEXT,
  status      TEXT    NOT NULL DEFAULT 'active',
  note        TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shops_project ON cc_shops(project_id);

-- ─────────── کاربرانِ خودِ پروژه‌ها (نه مدیرِ پنل) ─────────────
CREATE TABLE IF NOT EXISTS cc_app_users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_uid    TEXT    NOT NULL,                  -- شناسهٔ کاربر در خودِ آن پروژه
  project_id  INTEGER NOT NULL REFERENCES cc_projects(id) ON DELETE CASCADE,
  shop_id     INTEGER REFERENCES cc_shops(id) ON DELETE SET NULL,
  name        TEXT,
  phone       TEXT,
  email       TEXT,
  role        TEXT    NOT NULL DEFAULT 'user',   -- owner | manager | staff | user
  status      TEXT    NOT NULL DEFAULT 'active',
  registered_at INTEGER,
  last_login  INTEGER,
  note        TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(project_id, user_uid)
);
CREATE INDEX IF NOT EXISTS idx_app_users_project ON cc_app_users(project_id);

-- ───────────────────────── اشتراک‌ها ──────────────────────────
CREATE TABLE IF NOT EXISTS cc_subscriptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES cc_projects(id) ON DELETE CASCADE,
  shop_id     INTEGER REFERENCES cc_shops(id)     ON DELETE CASCADE,
  user_id     INTEGER REFERENCES cc_app_users(id) ON DELETE CASCADE,
  plan        TEXT    NOT NULL,
  start_at    INTEGER NOT NULL,
  end_at      INTEGER NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'active', -- active | expired | suspended | cancelled
  price       TEXT,
  note        TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subs_project ON cc_subscriptions(project_id, status);

-- ────────────────────────── بکاپ‌ها ───────────────────────────
CREATE TABLE IF NOT EXISTS cc_backups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES cc_projects(id) ON DELETE CASCADE,
  filename    TEXT    NOT NULL,
  path        TEXT    NOT NULL,
  size        INTEGER NOT NULL DEFAULT 0,
  kind        TEXT    NOT NULL DEFAULT 'manual', -- manual | auto | pre-restore | pre-migrate | pre-delete
  version     TEXT,
  checksum    TEXT,
  status      TEXT    NOT NULL DEFAULT 'ok',     -- ok | failed | running
  entries     INTEGER,
  error       TEXT,
  note        TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backups_project ON cc_backups(project_id, created_at DESC);

-- ────────────────────────── انتشارها ──────────────────────────
CREATE TABLE IF NOT EXISTS cc_releases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES cc_projects(id) ON DELETE CASCADE,
  platform    TEXT    NOT NULL,                  -- android | windows | linux | mac | web | backend
  version     TEXT    NOT NULL,
  build       TEXT,
  channel     TEXT    NOT NULL DEFAULT 'stable',
  file_path   TEXT,
  file_size   INTEGER,
  checksum    TEXT,
  min_version TEXT,
  mandatory   INTEGER NOT NULL DEFAULT 0,
  notes       TEXT,
  published   INTEGER NOT NULL DEFAULT 0,
  released_at INTEGER,
  created_at  INTEGER NOT NULL,
  UNIQUE(project_id, platform, version, channel)
);

-- ──────────────── پیکربندیِ مرکزیِ برنامه‌ها (نسخه‌دار) ─────────
CREATE TABLE IF NOT EXISTS cc_configs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES cc_projects(id) ON DELETE CASCADE,
  environment TEXT    NOT NULL DEFAULT 'production',
  version     INTEGER NOT NULL,
  data        TEXT    NOT NULL,                  -- JSON — فقط مقادیرِ عمومی، بدون رمز
  active      INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  created_by  TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE(project_id, environment, version)
);

-- ─────────────────── گاوصندوقِ رمزها (رمزنگاری‌شده) ────────────
CREATE TABLE IF NOT EXISTS cc_secrets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  kind        TEXT    NOT NULL DEFAULT 'other',  -- cf_token | api_key | database | server | deploy | ssh | other
  scope       TEXT    NOT NULL DEFAULT 'global', -- global | project | server
  project_id  INTEGER REFERENCES cc_projects(id) ON DELETE CASCADE,
  server_id   INTEGER REFERENCES cc_servers(id)  ON DELETE CASCADE,
  ciphertext  TEXT    NOT NULL,                  -- base64 — AES-256-GCM
  iv          TEXT    NOT NULL,
  tag         TEXT    NOT NULL,
  hint        TEXT,                              -- چهار نویسهٔ آخر، فقط برای تشخیص
  note        TEXT,
  last_used   INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(scope, name, project_id, server_id)
);

-- ────────────────────── هدف‌های مانیتورینگ ────────────────────
CREATE TABLE IF NOT EXISTS cc_monitors (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT    NOT NULL,                 -- endpoint | domain | server | tunnel | database | port
  ref_id       INTEGER,                          -- شناسهٔ ردیفِ اصلی در جدولِ خودش
  project_id   INTEGER REFERENCES cc_projects(id) ON DELETE CASCADE,
  server_id    INTEGER REFERENCES cc_servers(id)  ON DELETE CASCADE,
  label        TEXT    NOT NULL,
  target       TEXT    NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  interval_sec INTEGER NOT NULL DEFAULT 300,
  status       TEXT    NOT NULL DEFAULT 'unknown',
  status_code  INTEGER,
  latency_ms   INTEGER,
  error        TEXT,
  checked_at   INTEGER,
  fails        INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE(kind, ref_id)
);

CREATE TABLE IF NOT EXISTS cc_monitor_results (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id INTEGER NOT NULL REFERENCES cc_monitors(id) ON DELETE CASCADE,
  status     TEXT    NOT NULL,
  code       INTEGER,
  latency_ms INTEGER,
  error      TEXT,
  at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_results_monitor ON cc_monitor_results(monitor_id, at DESC);

-- ───────────────────────────  هشدارها ─────────────────────────
CREATE TABLE IF NOT EXISTS cc_alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT    NOT NULL,                  -- برای جلوگیری از تکرارِ یک هشدار
  kind        TEXT    NOT NULL,
  severity    TEXT    NOT NULL DEFAULT 'warn',   -- info | warn | critical
  project_id  INTEGER REFERENCES cc_projects(id) ON DELETE CASCADE,
  server_id   INTEGER REFERENCES cc_servers(id)  ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  detail      TEXT,
  status      TEXT    NOT NULL DEFAULT 'open',   -- open | ack | resolved
  count       INTEGER NOT NULL DEFAULT 1,
  first_at    INTEGER NOT NULL,
  last_at     INTEGER NOT NULL,
  resolved_at INTEGER,
  UNIQUE(key, status)
);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON cc_alerts(status, last_at DESC);

-- ───────────────────────── دفترِ رخدادها ──────────────────────
CREATE TABLE IF NOT EXISTS cc_audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor      TEXT    NOT NULL,
  action     TEXT    NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  project_id INTEGER,
  detail     TEXT,
  result     TEXT    NOT NULL DEFAULT 'ok',
  ip         TEXT,
  at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON cc_audit(at DESC);

-- ───────────────── کلیدهای Agent (یک‌بار نشان داده می‌شوند) ────
CREATE TABLE IF NOT EXISTS cc_migrations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES cc_projects(id) ON DELETE CASCADE,
  from_server INTEGER REFERENCES cc_servers(id) ON DELETE SET NULL,
  to_server   INTEGER REFERENCES cc_servers(id) ON DELETE SET NULL,
  backup_id   INTEGER REFERENCES cc_backups(id) ON DELETE SET NULL,
  status      TEXT    NOT NULL DEFAULT 'planned', -- planned | backed_up | moved | verified | failed | done
  steps       TEXT,                               -- JSON — گزارشِ گام‌به‌گام
  error       TEXT,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER
);
`);

  // ستون‌های تازه روی جدولِ دامنه‌های موجود — دامنه‌ها یک‌جا می‌مانند
  addColumn('domains', 'project_id', 'INTEGER REFERENCES cc_projects(id) ON DELETE SET NULL');
  addColumn('domains', 'server_id', 'INTEGER REFERENCES cc_servers(id) ON DELETE SET NULL');
  addColumn('domains', 'registrar', 'TEXT');
  addColumn('domains', 'cf_zone_id', 'TEXT');
  addColumn('domains', 'cf_account_ref', 'INTEGER');
  addColumn('domains', 'purchased_at', 'INTEGER');
  addColumn('domains', 'updated_at', 'INTEGER');
}

export { addColumn };
