// ---------------------------------------------------------------------------
//  ۰۱۴ — دروازهٔ پیام به مالک (۱.۵۳.۰): «سیلِ پیام» بسته شد، هیچ چیزی گم نشد
//
//  فقط افزودنی؛ هیچ جدولِ کهنه‌ای دست نمی‌خورد.
//
//  • `owner_alerts`        دفترِ هر هشدار/خبر برای مالک — چه رفت، چه نرفت و چرا (`decision`)
//                          ⇒ صفحهٔ «اعلان‌ها» و خلاصهٔ شب از همین خوانده می‌شوند؛ ردیفِ `pending` همان صفِ ارسال است،
//                          `waiting` (با `due_at`) یعنی «فقط اگر تا آن لحظه هنوز برقرار بود» (حافظه ۱۰ دقیقه، پردازنده ۱۵).
//  • `owner_alert_state`   حالِ هر کلید: باز است؟ از کی؟ آخرین پیام کِی رفت؟ (تکرار، یادآوری، «برطرف شد» ِ یک‌باره)
//  • `owner_alert_counts`  شمارِ پیام‌های واقعاً فرستاده‌شده در هر روز (به وقتِ کابل) و هر نوع — سقفِ روزانه و «امروز چند پیام»
// ---------------------------------------------------------------------------
export function up(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS owner_alerts (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        INTEGER NOT NULL,
  type      TEXT NOT NULL,
  key       TEXT NOT NULL,
  severity  TEXT NOT NULL,
  phase     TEXT NOT NULL,
  title     TEXT NOT NULL,
  body      TEXT,
  extra     TEXT,
  decision  TEXT NOT NULL,
  attempts  INTEGER NOT NULL DEFAULT 0,
  sent_at   INTEGER,
  due_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_owner_alerts_at ON owner_alerts(at);
CREATE INDEX IF NOT EXISTS idx_owner_alerts_decision ON owner_alerts(decision, id);
CREATE INDEX IF NOT EXISTS idx_owner_alerts_key ON owner_alerts(key, id);

CREATE TABLE IF NOT EXISTS owner_alert_state (
  key          TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  severity     TEXT NOT NULL,
  title        TEXT NOT NULL,
  active       INTEGER NOT NULL DEFAULT 0,
  since        INTEGER,
  notified     INTEGER NOT NULL DEFAULT 0,
  last_sent_at INTEGER,
  last_seen_at INTEGER,
  episodes     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS owner_alert_counts (
  day  TEXT NOT NULL,
  type TEXT NOT NULL,
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, type)
);
`);
}
