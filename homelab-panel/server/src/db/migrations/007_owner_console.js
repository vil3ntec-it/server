// ---------------------------------------------------------------------------
//  ۰۰۷ — پایهٔ امنِ پنلِ مرکزی (فاز ۱ ِ ممیزی، ۱۴۰۵/۰۸/۰۹)
//
//  • `users.must_change_password` — رمزی که `vill3n owner-reset` روی همین
//    کامپیوتر می‌سازد یک‌بارمصرف است: با آن فقط می‌شود وارد شد و رمزِ تازه
//    گذاشت؛ هر درِ دیگری ۴۰۳ ِ `password_change_required` می‌دهد (auth.js).
//  • `sessions.auth_at` — آخرین باری که **همین نشست** رمز را زده (ورود یا
//    `POST /api/auth/reauth`). کارِ حساس فقط از نشستی که در ده دقیقهٔ گذشته
//    احراز شده پذیرفته می‌شود (`requireRecentAuth`). نشست‌های پیش از این
//    مهاجرت `NULL` دارند، یعنی «تازه نیستند» — هیچ‌کس بیرون نمی‌افتد، فقط
//    برای کارِ حساس یک بار رمز می‌خواهد.
//
//  ⚠️ هر دو با «اگر نبود» افزوده می‌شوند: `vill3n owner-reset` روی دیتابیسی که
//  پنلِ تازه هنوز رویش بالا نیامده، همین ستون را خودش می‌سازد (بی هیچ import
//  از کدِ پنل)، و این مهاجرت نباید آن‌جا با «ستونِ تکراری» بیفتد.
// ---------------------------------------------------------------------------
export function up(db) {
  const users = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!users.includes('must_change_password')) {
    db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
  }
  const sessions = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
  if (!sessions.includes('auth_at')) db.exec('ALTER TABLE sessions ADD COLUMN auth_at INTEGER');
}
