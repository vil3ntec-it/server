// ---------------------------------------------------------------------------
//  ۰۱۲ — «چند دامنه برای هر برنامه» (۱.۵۰.۹۹)
//
//  فقط افزودنی: یک جدولِ تازه و چهار نگهبان؛ هیچ ستون یا ردیفِ موجودی دست نمی‌خورد.
//
//  • `app_hostnames`  نام‌های میزبانِ برنامه‌هایی که سایت نیستند — سرورِ حساب (‎account-server‎) و پمپ‌ها (‎stations‎،
//                      فقط داده؛ کدِ پمپ دست نمی‌خورد). سایت‌ها همان جدولِ `domains` (ستونِ `site_id`) را دارند و دامنهٔ
//                      اصلی‌شان `sites.domain` است. `is_primary` = نامِ اصلی (یکی برای هر برنامه — نمایهٔ یکتای جزئی).
//                      `move_id`: ردیفی که یک کارِ «جابه‌جایی به این سرور» آورد — برگشتِ همان کار همان را برمی‌دارد.
//  • ⛔ یک نام، یک صاحب: نامی که مالِ یک سایت است (‎domains.site_id IS NOT NULL‎) در `app_hostnames` نمی‌نشیند و برعکس —
//    نگهبان در خودِ SQLite، تا هیچ راهی (در، خطِ فرمان، move-server.mjs) دو صاحب برای یک نام نسازد.
// ---------------------------------------------------------------------------
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_hostnames (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id      TEXT NOT NULL,
      hostname    TEXT NOT NULL UNIQUE,
      is_primary  INTEGER NOT NULL DEFAULT 0,
      move_id     TEXT,
      created_at  INTEGER NOT NULL,
      created_by  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_app_hostnames_app ON app_hostnames(app_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_app_hostnames_one_primary ON app_hostnames(app_id) WHERE is_primary = 1;

    CREATE TRIGGER IF NOT EXISTS app_hostnames_not_site_ins BEFORE INSERT ON app_hostnames
      WHEN EXISTS (SELECT 1 FROM domains WHERE name = NEW.hostname AND site_id IS NOT NULL)
      BEGIN SELECT RAISE(ABORT, 'hostname_taken'); END;
    CREATE TRIGGER IF NOT EXISTS app_hostnames_not_site_upd BEFORE UPDATE OF hostname ON app_hostnames
      WHEN EXISTS (SELECT 1 FROM domains WHERE name = NEW.hostname AND site_id IS NOT NULL)
      BEGIN SELECT RAISE(ABORT, 'hostname_taken'); END;
    CREATE TRIGGER IF NOT EXISTS domains_not_app_ins BEFORE INSERT ON domains
      WHEN NEW.site_id IS NOT NULL AND EXISTS (SELECT 1 FROM app_hostnames WHERE hostname = NEW.name)
      BEGIN SELECT RAISE(ABORT, 'hostname_taken'); END;
    CREATE TRIGGER IF NOT EXISTS domains_not_app_upd BEFORE UPDATE OF name, site_id ON domains
      WHEN NEW.site_id IS NOT NULL AND EXISTS (SELECT 1 FROM app_hostnames WHERE hostname = NEW.name)
      BEGIN SELECT RAISE(ABORT, 'hostname_taken'); END;
  `);
}
