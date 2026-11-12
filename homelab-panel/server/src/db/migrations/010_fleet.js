// ---------------------------------------------------------------------------
//  ۰۱۰ — «سرورهای من» (۱.۵۰.۹۴، گامِ ۲ ِ docs/MULTI-SERVER-fa.md)
//
//  فقط افزودنی: پنج جدولِ تازه، هیچ ستون یا ردیفِ موجودی دست نمی‌خورد.
//
//  روی **مرکز**:
//    • `fleet_nodes`      هر گرهٔ وصل‌شده: کلیدِ عمومیِ Ed25519، وضعیت (active|revoked)، حالتِ نگه‌داری که مالک
//                          خواسته، آخرین تپش و آخرین گزارشِ پاک‌شده. جدا کردن ردیف را پاک نمی‌کند (status=revoked).
//    • `fleet_join_codes` کدِ یک‌بارهٔ ۱۰ دقیقه‌ای — فقط HMAC ِ نمک‌دار، هرگز خودِ کد.
//    • `fleet_nonces`     nonce ِ هر پیامِ پذیرفته‌شده، تا پنجرهٔ بازپخش (≥ ۱۰ دقیقه) بگذرد.
//  روی **گره**:
//    • `fleet_link`       هر بار وصل شدن به یک مرکز یک ردیف (نشانی، شناسهٔ گره، کلیدِ عمومیِ مرکز)؛
//                          جدا شدن ردیف را نگه می‌دارد (status=left|revoked) و وصلِ دوباره ردیفِ تازه است.
//  روی **هر نصب**:
//    • `fleet_local`      حالتِ نگه‌داریِ همین کامپیوتر (چه کسی خواست، از کِی، و چه چیزی پیش از آن روشن بود).
//  ⛔ کلیدِ خصوصی در هیچ جدولی نیست — فقط در ‎<پوشهٔ داده>/fleet/‎ با ‎0600‎ (src/fleet/keys.js).
// ---------------------------------------------------------------------------
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fleet_nodes (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      kind            TEXT NOT NULL DEFAULT 'home',
      public_key      TEXT NOT NULL UNIQUE,
      status          TEXT NOT NULL DEFAULT 'active',
      maintenance     INTEGER NOT NULL DEFAULT 0,
      maintenance_at  INTEGER,
      maintenance_by  TEXT,
      joined_at       INTEGER NOT NULL,
      joined_by       TEXT,
      join_ip         TEXT,
      last_seen_at    INTEGER,
      last_ip         TEXT,
      last_report     TEXT,
      revoked_at      INTEGER,
      revoked_by      TEXT
    );

    CREATE TABLE IF NOT EXISTS fleet_join_codes (
      id          TEXT PRIMARY KEY,
      salt        TEXT NOT NULL,
      mac         TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL,
      created_by  TEXT,
      used_at     INTEGER,
      used_node   TEXT,
      burned_at   INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_fleet_codes_created ON fleet_join_codes(created_at);

    CREATE TABLE IF NOT EXISTS fleet_nonces (
      node_id  TEXT NOT NULL,
      nonce    TEXT NOT NULL,
      seen_at  INTEGER NOT NULL,
      PRIMARY KEY (node_id, nonce)
    );
    CREATE INDEX IF NOT EXISTS idx_fleet_nonces_seen ON fleet_nonces(seen_at);

    CREATE TABLE IF NOT EXISTS fleet_link (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      center_url     TEXT NOT NULL,
      node_id        TEXT NOT NULL,
      center_key     TEXT NOT NULL,
      center_name    TEXT,
      name           TEXT,
      kind           TEXT,
      status         TEXT NOT NULL DEFAULT 'active',
      joined_at      INTEGER NOT NULL,
      joined_by      TEXT,
      last_ok_at     INTEGER,
      last_error     TEXT,
      last_error_at  INTEGER,
      ended_at       INTEGER
    );

    CREATE TABLE IF NOT EXISTS fleet_local (
      id           INTEGER PRIMARY KEY CHECK (id = 1),
      maintenance  INTEGER NOT NULL DEFAULT 0,
      source       TEXT,
      since        INTEGER,
      saved        TEXT
    );
  `);
}
