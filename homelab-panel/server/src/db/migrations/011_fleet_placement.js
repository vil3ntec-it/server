// ---------------------------------------------------------------------------
//  ۰۱۱ — «این برنامه/سایت روی کدام سرور» (۱.۵۰.۹۵، گامِ ۳ ِ docs/MULTI-SERVER-fa.md)
//
//  فقط افزودنی: چهار جدولِ تازه، هیچ ستون یا ردیفِ موجودی دست نمی‌خورد.
//
//  روی **مرکز**:
//    • `fleet_placement`  جدولِ «جا»: هر برنامه یک گرهٔ فعال (‎'self'‎ = خودِ مرکز). ردیف فقط پس از جابه‌جاییِ موفق
//                          نوشته می‌شود؛ بی ردیف، پیش‌فرض همان است که گزارشِ تپش می‌گوید رویش روشن است.
//    • `fleet_moves`      هر کارِ جابه‌جایی: گام‌ها و نتیجه برای صفحه — ⛔ بی هیچ کلید/رمزی (کلیدِ بسته فقط در حافظه).
//                          `active = 1` تا پایانِ کار؛ نمایهٔ یکتای جزئی ⇒ **در هر لحظه یک کار برای هر برنامه** (یک نویسنده).
//  روی **هر نصب** (مبدأ/مقصد، خودِ مرکز هم):
//    • `fleet_move_local` سهمِ همین نصب در یک کار (ایستاده/جای‌گرفته/روشن/کنار) و آن‌چه پیش از آن بود — تا پنلی که
//                          وسطِ کار دوباره بالا بیاید برنامه را خودسرانه روشن نکند و «برگشت» بداند به چه برگردد.
//    • `fleet_aside`      برنامه‌ای که از این نصب رفت (یا برگشتِ مقصد): پوشه‌هایش کجا کنار رفت. ⛔ هیچ چیز پاک نمی‌شود.
// ---------------------------------------------------------------------------
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fleet_placement (
      app_id      TEXT PRIMARY KEY,
      node_id     TEXT NOT NULL,
      app_type    TEXT,
      app_name    TEXT,
      move_id     TEXT,
      updated_at  INTEGER NOT NULL,
      updated_by  TEXT
    );

    CREATE TABLE IF NOT EXISTS fleet_moves (
      id           TEXT PRIMARY KEY,
      app_id       TEXT NOT NULL,
      app_type     TEXT,
      app_name     TEXT,
      from_node    TEXT NOT NULL,
      to_node      TEXT NOT NULL,
      from_name    TEXT,
      to_name      TEXT,
      state        TEXT NOT NULL,
      active       INTEGER,
      step         TEXT,
      progress     TEXT,
      steps        TEXT,
      route        TEXT,
      error        TEXT,
      bytes        INTEGER,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      finished_at  INTEGER,
      created_by   TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fleet_moves_one_writer ON fleet_moves(app_id) WHERE active = 1;
    CREATE INDEX IF NOT EXISTS idx_fleet_moves_created ON fleet_moves(created_at);

    CREATE TABLE IF NOT EXISTS fleet_move_local (
      move_id     TEXT PRIMARY KEY,
      app_id      TEXT NOT NULL,
      role        TEXT NOT NULL,
      state       TEXT NOT NULL,
      saved       TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_fleet_move_local_app ON fleet_move_local(app_id, state);

    CREATE TABLE IF NOT EXISTS fleet_aside (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id       TEXT NOT NULL,
      slug         TEXT,
      move_id      TEXT,
      aside_dir    TEXT,
      items        TEXT,
      saved        TEXT,
      at           INTEGER NOT NULL,
      restored_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_fleet_aside_app ON fleet_aside(app_id, restored_at);
  `);
}
