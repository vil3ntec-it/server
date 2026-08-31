// ---------------------------------------------------------------------------
//  ۰۰۳ — دفترِ بکاپ‌ها
//
//  خودِ فایلِ بکاپ روی دیسک است؛ این جدول فقط «چه وقت، چرا، چقدر» را نگه
//  می‌دارد تا پنل بتواند وضعیت را نشان بدهد بدونِ اسکنِ هر بارهٔ پوشه، و تا
//  معلوم باشد کدام بکاپ خودکار بوده و کدام پیش از مهاجرت گرفته شده.
// ---------------------------------------------------------------------------
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS backups (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      file       TEXT NOT NULL UNIQUE,
      reason     TEXT NOT NULL,          -- manual / scheduled / pre-migration / pre-restore
      size_bytes INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      ok         INTEGER NOT NULL DEFAULT 1,
      note       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_backups_time ON backups(created_at DESC);
  `);
}
