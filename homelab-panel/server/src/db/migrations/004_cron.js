// ---------------------------------------------------------------------------
//  ۰۰۴ — کارهای زمان‌بندی‌شده
//
//  چرا زمان‌بندِ خودِ پنل و نه crontab سیستم:
//
//    • روی ویندوز crontab وجود ندارد؛ نصبِ خانگی هم باید همین قابلیت را
//      داشته باشد.
//    • crontab نوشتن یعنی بازنویسیِ فایلی که چیزهای دیگرِ کاربر هم در آن
//      است — یک باگ در پنل می‌توانست زمان‌بندی‌های خودِ کاربر را پاک کند.
//    • این‌طور تاریخچهٔ اجرا، خروجی و کدِ خروجِ هر بار در همین دیتابیس می‌ماند
//      و با بکاپِ پنل هم برداشته می‌شود.
//
//  عوارضش: کار فقط وقتی اجرا می‌شود که پنل بالا باشد. برای پنلی که خودش
//  همیشه‌روشن است این معامله می‌ارزد، و crontabِ سیستم هم فقط‌خواندنی در
//  همان صفحه نشان داده می‌شود تا کسی دو جا را قاطی نکند.
// ---------------------------------------------------------------------------
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cron_jobs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      schedule    TEXT NOT NULL,             -- پنج‌فیلدیِ cron
      command     TEXT NOT NULL,
      cwd         TEXT,
      enabled     INTEGER NOT NULL DEFAULT 1,
      created_at  INTEGER NOT NULL,
      created_by  TEXT,
      last_run_at INTEGER,
      last_ok     INTEGER,
      last_ms     INTEGER,
      next_run_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_cron_enabled ON cron_jobs(enabled, next_run_at);

    CREATE TABLE IF NOT EXISTS cron_runs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id     INTEGER NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
      started_at INTEGER NOT NULL,
      ms         INTEGER NOT NULL,
      exit_code  INTEGER,
      ok         INTEGER NOT NULL,
      output     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cron_runs_job ON cron_runs(job_id, started_at DESC);
  `);
}
