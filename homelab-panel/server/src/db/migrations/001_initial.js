// ---------------------------------------------------------------------------
//  ۰۰۱ — اسکیمای پایه
//
//  عیناً همان چیزی که تا امروز در db.js بود. عمداً دست‌نخورده کپی شده تا روی
//  دیتابیس‌های موجود هیچ اتفاقی نیفتد: همهٔ دستورها IF NOT EXISTS هستند، پس
//  اجرای این مهاجرت روی نصبِ قدیمی بی‌اثر است و فقط ثبت می‌شود.
// ---------------------------------------------------------------------------
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      user_agent TEXT,
      ip         TEXT
    );

    CREATE TABLE IF NOT EXISTS sites (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      slug          TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      root_path     TEXT NOT NULL UNIQUE,
      domain        TEXT,
      port          INTEGER,
      kind          TEXT,
      start_command TEXT,
      autostart     INTEGER NOT NULL DEFAULT 0,
      enabled       INTEGER NOT NULL DEFAULT 1,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS domains (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      site_id    INTEGER REFERENCES sites(id) ON DELETE SET NULL,
      note       TEXT,
      created_at INTEGER NOT NULL,
      checked_at    INTEGER,
      dns_status    TEXT,
      dns_records   TEXT,
      ssl_status    TEXT,
      ssl_issuer    TEXT,
      ssl_expires   INTEGER,
      reg_expires   INTEGER,
      http_status   INTEGER
    );

    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id    INTEGER REFERENCES sites(id) ON DELETE CASCADE,
      level      TEXT NOT NULL,
      source     TEXT NOT NULL,
      message    TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_time ON events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_site ON events(site_id, created_at DESC);
  `);
}
