# سرورِ خانگیِ پمپ یعقوبی

نسخهٔ برنامه: **2.9.316**

این مخزن دو بخش دارد که باید **کنارِ هم** بمانند؛ پنل، دستیار را از همین‌جا پیدا می‌کند:

| پوشه | چیست |
| --- | --- |
| `homelab-panel/` | پنلِ مدیریتِ سرورِ خانگی (Express + Socket.IO + SQLite) به‌همراه رابط کاربریِ ساخته‌شده در `server/public` |
| `ai-support/` | دستیارِ پشتیبانیِ هوشمند — فقط‌خواندنی، بدون وابستگیِ npm |

راهنمای گام‌به‌گامِ راه‌اندازی در فایل [`از-اینجا-شروع-کنید.txt`](از-اینجا-شروع-کنید.txt) است.

## راه‌اندازیِ سریع

پیش‌نیاز: Node.js نسخهٔ ۲۲ به بالا

```bash
cd homelab-panel/server
npm install
bash start-linux.sh          # ویندوز: start-windows.bat
```

دستیار خودش با پنل بالا می‌آید (پورت محلیِ 8788) و سایت از راهِ `/ai/support` به آن می‌رسد.
پنل روی پورت `4700` است؛ برای دیدنِ نسخهٔ در حالِ اجرا: `http://localhost:4700/health`

## آزمون‌ها

```bash
cd homelab-panel/server && npm test    # پنل
cd ai-support && npm test              # دستیار
```

## مستنداتِ بیشتر

- [`homelab-panel/README-fa.md`](homelab-panel/README-fa.md)
- [`ai-support/README-fa.md`](ai-support/README-fa.md)
- [`ai-support/ARCHITECTURE-fa.md`](ai-support/ARCHITECTURE-fa.md)

پیکربندی از راهِ متغیرهای محیطی انجام می‌شود؛ نمونه‌ها در `homelab-panel/server/.env.example`
و `ai-support/.env.example` هستند. فایلِ `.env` و پوشهٔ `data/` روی گیت نمی‌روند.
