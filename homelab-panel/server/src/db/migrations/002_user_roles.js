// ---------------------------------------------------------------------------
//  ۰۰۲ — نقشِ کاربران
//
//  تا امروز هر کسی که وارد می‌شد همه‌کاره بود: می‌توانست فایل پاک کند، پروسه
//  اجرا کند و تنظیمات را عوض کند. برای اینکه بشود به کسی فقط «دیدن» داد،
//  ستونِ نقش اضافه می‌شود.
//
//  سازگاری: همهٔ کاربرانِ موجود admin می‌شوند — یعنی هیچ‌کس با این مهاجرت
//  دسترسی‌اش را از دست نمی‌دهد. اولین کاربرِ سیستم هم همیشه admin است.
// ---------------------------------------------------------------------------
export function up(db) {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('role')) {
    db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'`);
  }
  if (!cols.includes('disabled')) {
    db.exec('ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('last_login_at')) {
    db.exec('ALTER TABLE users ADD COLUMN last_login_at INTEGER');
  }
  // کاربرانِ قدیمی نباید دسترسی از دست بدهند
  db.exec(`UPDATE users SET role = 'admin' WHERE role IS NULL OR role = ''`);
}
