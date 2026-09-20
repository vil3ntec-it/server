// ---------------------------------------------------------------------------
//  ۰۰۶ — ورودِ دوعاملی (TOTP) و ردِ نشست‌ها
//
//  بخشِ ۴ پرامپت: «2FA اختیاری با TOTP برای مدیر» و «فهرستِ دستگاه‌های
//  واردشده، خروج از همهٔ دستگاه‌ها». راز فقط برای کاربری که خودش روشن کرده
//  پر می‌شود؛ هیچ کاربرِ موجودی با این مهاجرت تغییری نمی‌بیند.
// ---------------------------------------------------------------------------
export function up(db) {
  const users = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!users.includes('totp_secret')) db.exec('ALTER TABLE users ADD COLUMN totp_secret TEXT');
  if (!users.includes('totp_pending')) db.exec('ALTER TABLE users ADD COLUMN totp_pending TEXT');
  if (!users.includes('totp_enabled')) db.exec('ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0');
  if (!users.includes('totp_recovery')) db.exec('ALTER TABLE users ADD COLUMN totp_recovery TEXT');
  const sessions = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
  if (!sessions.includes('last_seen_at')) db.exec('ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER');
}
