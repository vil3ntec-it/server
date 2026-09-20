// ---------------------------------------------------------------------------
//  ۰۰۵ — موتورِ اتوماسیون (بخشِ ۱۰ پرامپت)
//
//  سه جدول:
//    automation_jobs    حالِ هر کارِ ثبت‌شده در کد (روشن/خاموش، آخرین و بعدی)
//    automation_runs    دفترِ اجراها — هیچ کاری بی ثبتِ نتیجه اجرا نمی‌شود
//    automation_events  رویدادهایی که سرچشمه‌های واقعی (پایش، متریک، ورود،
//                       نگهبانِ حرارتی) بیرون داده‌اند
//
//  چرا کارها در جدول ولی تعریفشان در کد: کار یعنی «چه چیزی، با چه منطقی»
//  و آن در کد است تا با نسخهٔ پنل جلو برود؛ آن‌چه کاربر عوض می‌کند فقط
//  روشن/خاموش است. کارهای دلخواهِ خودِ کاربر (فرمانِ shell) همان cron_jobs
//  می‌مانند و دو چیزِ جدا هستند.
// ---------------------------------------------------------------------------
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS automation_jobs (
      name             TEXT PRIMARY KEY,
      enabled          INTEGER NOT NULL DEFAULT 1,
      last_run_at      INTEGER,
      last_status      TEXT,
      last_duration_ms INTEGER,
      next_run_at      INTEGER,
      updated_at       INTEGER
    );

    CREATE TABLE IF NOT EXISTS automation_runs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      job         TEXT NOT NULL,
      trigger     TEXT NOT NULL,              -- scheduled | event | manual
      started_at  INTEGER NOT NULL,
      finished_at INTEGER,
      duration_ms INTEGER,
      status      TEXT NOT NULL,              -- running | ok | failed | timeout | skipped
      attempts    INTEGER NOT NULL DEFAULT 0,
      error       TEXT,
      output      TEXT,                       -- حداکثر ۶۴ کیلوبایت
      payload     TEXT                        -- بارِ رویداد، اگر بود
    );
    CREATE INDEX IF NOT EXISTS idx_automation_runs_job ON automation_runs(job, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_automation_runs_at ON automation_runs(started_at DESC);

    CREATE TABLE IF NOT EXISTS automation_events (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      name    TEXT NOT NULL,
      source  TEXT,
      payload TEXT,
      at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_automation_events_at ON automation_events(at DESC);
  `);
}
