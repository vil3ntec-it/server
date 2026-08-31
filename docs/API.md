# API — نسخهٔ ۱

```
پایه:  https://api.YOURDOMAIN.com/api/v1
```

کلاینت‌ها **فقط همین آدرس** را می‌شناسند. IP سرور، پورت و اینکه پشتِ تونل
است یا reverse proxy، هیچ‌کدام به کلاینت مربوط نیست.

## قرارداد

| موضوع | قاعده |
| --- | --- |
| احراز هویت | `Authorization: Bearer <token>` |
| قالبِ خطا | `{ "error": "code", ... }` با کدِ HTTPِ متناسب |
| نسخه | تغییرِ شکسته → `v2`. افزودنِ فیلد → همان `v1` |
| سازگاری | کلاینت باید فیلدهای ناشناس را نادیده بگیرد |
| مسیرِ قدیمیِ `/api/...` | کار می‌کند ولی `Deprecation: true` می‌گیرد |

خطاهای پرتکرار:

| کد | یعنی |
| --- | --- |
| `401 unauthorized` | توکن نیست، منقضی شده، یا حساب بسته شده |
| `403 forbidden` | نقشِ کاربر اجازه نمی‌دهد (پاسخ `needed` و `role` دارد) |
| `400 invalid_input` | ورودیِ نامعتبر (پاسخ `field` و `rule` دارد) |
| `429 rate_limited` | سقفِ نرخ؛ هدرِ `Retry-After` را ببینید |
| `503` روی `/ready` | سرویس آماده نیست |

## سلامت

بدونِ احراز هویت. هیچ اطلاعاتِ حساسی نمی‌دهند.

| مسیر | سؤال | مصرف |
| --- | --- | --- |
| `GET /health` | پروسه زنده است؟ | ناظرِ سرویس، Docker healthcheck |
| `GET /ready` | الان می‌تواند کار کند؟ | لبه/بارمتعادل‌کن؛ `503` یعنی ترافیک نفرست |

`/ready` دیتابیس و نوشتن روی دیسک را واقعاً می‌زند:

```json
{ "ready": true, "checks": [
  { "name": "database", "ok": true, "ms": 0, "detail": { "migrations": 3 } },
  { "name": "storage",  "ok": true, "ms": 1, "detail": { "writable": true } } ] }
```

## نقش‌ها

| نقش | می‌تواند |
| --- | --- |
| `viewer` | دیدنِ داشبورد، سرویس‌ها، دامنه‌ها، لاگ‌ها |
| `operator` | + اجرا/توقف/ری‌استارت، فایل‌منیجر، ساختِ سرویس و دامنه، گرفتنِ بکاپ |
| `admin` | + کاربران، تنظیمات، بازگردانیِ بکاپ، پاک کردنِ لاگ |

نقش از دیتابیس خوانده می‌شود، نه از توکن: تنزلِ نقش یا بستنِ حساب **همان
لحظه** اثر می‌کند.

## مسیرها

### احراز هویت — `/auth`

| متد و مسیر | نقش | کار |
| --- | --- | --- |
| `GET /auth/status` | — | آیا پنل راه‌اندازی شده؟ |
| `POST /auth/setup` | — | ساختِ اولین مدیر (فقط بارِ اول) |
| `POST /auth/login` | — | ورود → `{ token, expiresAt, user }` |
| `POST /auth/logout` | هر کاربر | پایانِ نشست |
| `GET /auth/me` | هر کاربر | کاربر و نشست‌های فعالش |
| `POST /auth/change-password` | هر کاربر | تغییرِ رمزِ خود |

`login`، `setup` و `change-password` سقفِ نرخِ سخت‌گیرانه دارند.

### کاربران — `/users` (فقط admin)

`GET /users` · `POST /users` · `PUT /users/:id` · `PUT /users/:id/password` · `DELETE /users/:id`

`password_hash` هرگز برنمی‌گردد. مدیر نمی‌تواند خودش را تنزل بدهد، ببندد یا
حذف کند، و آخرین مدیرِ فعال باقی می‌ماند.

### زیرساخت — `/system`

`GET /system` → نسخهٔ سرویس و اسکیما، میزبان، دامنه‌های پیکربندی‌شده،
`apiUrl` و وضعیتِ آمادگی. هیچ رازی برنمی‌گردد — از `SECRET_KEY` فقط
«تنظیم شده یا نه».

### سرویس‌ها — `/services` (هم‌نامِ `/sites`)

`GET` فهرست و جزئیات · `POST /services/create` · `POST /services/:id/start|stop|restart`
· `GET /services/:id/logs` · `POST /services/discover`

نوشتن → `operator`.

### دامنه‌ها — `/domains`

`GET /domains` · `POST /domains` · `PUT /domains/:id` · `DELETE /domains/:id`
· `POST /domains/:id/check` · `POST /domains/check-all`

بررسی واقعی است: DNS، گواهیِ SSL و تاریخِ انقضا، تاریخِ انقضای ثبت و وضعیتِ HTTP.

### بکاپ — `/backups`

| متد و مسیر | نقش | کار |
| --- | --- | --- |
| `GET /backups` | operator | فهرست، حجمِ کل، کهنگیِ آخرین بکاپ |
| `POST /backups` | operator | گرفتنِ بکاپِ تازه |
| `POST /backups/:file/restore` | **admin** | زمان‌بندیِ بازگردانی |
| `DELETE /backups` | admin | اعمالِ قاعدهٔ نگهداری |

بازگردانی **سرد** است: فایل کنارِ دیتابیس گذاشته و در راه‌اندازیِ بعدی
جایگزین می‌شود. پیش از آن یک بکاپِ `prerestore` گرفته می‌شود.

### بقیه

`/dashboard` (خلاصهٔ وضعیت) · `/network` · `/logs` (حذف: admin) ·
`/files` (کلاً operator) · `/settings` (نوشتن: admin) · `/site-server` ·
`/messenger` · `/notify` · `/ai`

## بلادرنگ

`Socket.IO` روی `/socket.io/` با توکن در `auth.token`. رویدادها: `metrics`،
`history`، `tunnel`، `site:tunnel`.

## نمونه

```bash
API=https://api.YOURDOMAIN.com/api/v1

TOKEN=$(curl -s -X POST $API/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"..."}' | jq -r .token)

curl -s $API/system -H "Authorization: Bearer $TOKEN" | jq .domain
```
