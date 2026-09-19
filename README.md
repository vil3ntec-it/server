# VILL3N Server — سرورِ خانگی

پنلِ مدیریتِ سرورِ خانگی، درگاهِ سرورِ حساب، و مرکزِ فرمان؛ روی **همین کامپیوترِ
خانگی** (ویندوز)، پشتِ تونلِ Cloudflare. همهٔ برنامه‌ها به یک نشانی وصل‌اند:
`https://api.<دامنه>`.

## چه چیزی کجاست

| پوشه | چیست |
|---|---|
| `homelab-panel/server/` | پنل و API (Express + SQLite) — رابطِ ساخته‌شده در `server/public` |
| `homelab-panel/web/` | سورسِ رابطِ کاربریِ پنل (React + Vite) |
| `homelab-panel/desktop/` | برنامهٔ ویندوز (Electron): پنل + ترمینال در یک پنجره، **بی نیاز به Node** |
| `homelab-panel/admin-android/` | اپِ مدیریت روی گوشی |
| `homelab-panel/agent/` | Agent سبک برای سرورهای دیگر (VPS) |
| `ai-support/` | دستیارِ پشتیبانیِ هوشمند (Ollama، محلی) |
| `docs/` | معماری، API، پمپ‌بنزین‌ها |

سرورِ حساب (ثبت‌نام، ورود، اشتراک، پلن، پشتیبانی، پنلِ `/admin/`) کدش در ریپوی
`vil3ntec-it/shop` (`server/`) است و **داخلِ فایلِ نصبیِ ویندوز** می‌آید؛ پنل خودش
بالا می‌آوردش (PGlite، بی داکر و بی PostgreSQL).

```
📱🖥️📲🌐 ──▶ https://api.<دامنه> ──▶ تونل ──▶ پورتِ عمومیِ پنل (۴۷۰۱)
                                            ├─ /api/app · /api/stations · /api/messenger · /api/notify   ← خودِ پنل
                                            └─ /api/auth · /api/pump · /api/shop · /api/me · /admin …    ← سرورِ حساب (127.0.0.1:3000)
```

## نصب

**ویندوز (تنها راهِ پشتیبانی‌شده):** از [Releases](https://github.com/vil3ntec-it/server/releases)
فایلِ `ControlCenter-Setup-<نسخه>.exe` را بگیرید و نصب کنید. سرورِ حساب، Node و
پنل همه داخلِ همان فایل‌اند. به‌روزرسانی‌های بعدی از داخلِ خودِ پنل انجام می‌شود
(مرکز فرمان ← به‌روزرسانی)؛ پوشهٔ داده و `.env` هیچ‌وقت دست نمی‌خورند.

**لینوکس / مک (فقط برای توسعه):**

```bash
cd homelab-panel && chmod +x نصب.sh && ./نصب.sh
```

سرورِ حساب روی لینوکس: ریپوی `shop` را کنارِ همین ریپو بگذارید و
`ln -s ../../shop/server homelab-panel/account-server` (یا `HLP_ACCOUNT_DIR`).

## بعد از نصب

1. پنل ← پمپ‌ها ← تنظیمات و داده‌ها ← کارتِ **«سرورِ حساب»** باید «بالاست» بگوید.
   همان‌جا نام و رمزِ مدیرِ سرورِ حساب هست (برای اپِ مدیریت و `api.<دامنه>/admin/`).
2. پنل ← **کدهای شش‌رقمی** ← تنظیمات: SMTP را بنویسید. کدِ ثبت‌نامِ همهٔ برنامه‌ها
   از همین می‌رود.
3. `https://api.<دامنه>/api/health` باید `"server":"online"` بدهد.
4. «چه چیزی خراب است؟» در پنل (`/api/diagnostics`) هر کمبودی را با راهِ حلش می‌گوید.

## آزمون‌ها

```bash
cd homelab-panel/server && npm test          # پنل، درگاه، ناظرِ سرورِ حساب
cd homelab-panel/desktop && npm test         # برنامهٔ ویندوز (xvfb روی لینوکس)
cd ai-support && npm test                    # دستیار
```

## مستندات

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — معماری و دلیلِ هر تصمیم
- [`docs/API.md`](docs/API.md) — مرجعِ API نسخهٔ ۱
- [`docs/STATIONS-fa.md`](docs/STATIONS-fa.md) — پمپ‌بنزین‌ها: پوشه و رمزِ هر پمپ، اتصالِ برنامه‌ها
- [`homelab-panel/مرکز-فرمان.md`](homelab-panel/مرکز-فرمان.md) — راهنمای مرکزِ فرمان
- [`homelab-panel/README-fa.md`](homelab-panel/README-fa.md) — پنل: تنظیمات، توسعه، آزمون‌ها
- [`homelab-panel/desktop/README-fa.md`](homelab-panel/desktop/README-fa.md) — برنامهٔ ویندوز
- [`ai-support/README-fa.md`](ai-support/README-fa.md) — دستیار
- [`CLAUDE.md`](CLAUDE.md) — قاعده‌هایی که نباید برگردند

پیکربندی از راهِ متغیرهای محیطی است؛ نمونه‌ها در `homelab-panel/server/.env.example`.
