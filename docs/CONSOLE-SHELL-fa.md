# پوستهٔ بخشِ «فروشگاه» — نقطهٔ گسترشِ ماژول‌ها (از ۱۴۰۵/۰۸/۱۰، نسخه 1.50.65)

> دستورِ صاحب محصول (۱۴۰۵/۰۸/۱۰): بخشِ «فروشگاه» ِ پنل (`/shop`) یک برنامهٔ کاملِ جدا باشد با هر ۱۳ ماژولِ
> «VILL3N — MASTER PROMPT: Central Owner Console». برنامه و قاعده‌ها: `docs/OWNER-CONSOLE-PROGRAM-fa.md`، ممیزی:
> `docs/OWNER-CONSOLE-AUDIT-fa.md`. این سند فقط می‌گوید **ماژولِ تازه کجا و چطور وصل می‌شود** — و این قرارداد پایدار است.

## ۱. پوسته چه می‌دهد

| | کجا |
|---|---|
| منوی گروه‌بندی‌شده (کناره روی صفحهٔ پهن، فهرستِ کشویی روی گوشی)، ردِ نان، جست‌وجوی سراسری | `web/src/pages/account/console/Shell.tsx`، `Search.tsx` |
| لینکِ مستقیم: `/shop?tab=<id>&…` (همان `?tab=` ِ پیشین؛ برگشتِ مرورگر کار می‌کند) | همان |
| نگهبانِ خطای جدا برای هر ماژول و هر کارتِ داشبورد | `parts.tsx` ⇒ `Guarded` |
| حالت‌های یک‌دست: بارگذاری، خالی، «پشتیبانی نمی‌شود»، «برای نقشِ شما نیست»، «ساخته نشده» | `parts.tsx` |
| پنجرهٔ کارِ حساس: دلیل (۳ تا ۲۰۰) + تأیید + رمزِ پنل (در صورتِ نیاز) + نوشتنِ نام (پرخطر) + **یک** کلیدِ یکتایی برای هر پنجره | `parts.tsx` ⇒ `SensitiveDialog` |
| سه‌زبانه بی جدولِ مشترک: `tx('فارسی', 'English', 'پښتو')` (عربی ⇐ انگلیسی) | `text.ts` |
| داشبورد (۴.۱): کارتِ هر ماژول با منبع و زمان، «—» برای نیامده، خلاصهٔ هشدارها | `Dashboard.tsx` ⇐ `GET /api/account-admin/console/summary` |

**مرز:** کدام ماژول برای کدام نقش را **سرورِ پنل** می‌گوید (`GET /api/account-admin/console/modules`) و همان را روی درهای
ماژول می‌سنجد. پنهان یعنی سرور هم نمی‌دهد — `test/console-shell.mjs` برای هر ماژول درِ `probe` را با سه نقش می‌زند.

## ۲. افزودنِ ماژولِ تازه — دو جا، بی دست زدن به `App.tsx`، `ShopDesk.tsx` یا `i18n.ts`

**الف) سرور — یک ردیف در `homelab-panel/server/src/console/modules.js`** (`CONSOLE_MODULES`):

```js
{ id: 'market', spec: '4.6', group: 'market', order: 10, minRole: 'viewer',
  label: L('مدیریتِ بازار', 'Marketplace management', 'د بازار مدیریت'), probe: '/api/account-admin/market/cases' },
```

- `id` = همان `?tab=` و نامِ فایلِ وب. **شناسه‌های رزرو** (ردیفشان از پیش هست، فقط `probe: null` را با درِ واقعی عوض کنید):
  `market` (۴.۶)، `courier` (۴.۷)، `errors` (۴.۱۰)، `alerts` (۴.۱۱). موجودها: `dash` · `shops` · `subs` · `codes` · `finance` ·
  `versions` · `health` · `users` · `settings` · `integrations` · `audit`.
- گروه‌ها: `overview` · `shops` · `money` · `market` · `ops` · `control`.
- `minRole` = کم‌ترین نقشی که درِ **خواندنیِ** ماژول را امروز در سرور می‌گیرد (`viewer` | `operator` | `admin`). درهای تازهٔ خودتان
  را با `requireModule('<id>')` ببندید تا منو و سرور یکی بمانند.
- `probe` = یک GET ِ واقعیِ خودِ ماژول (زیرِ `/api/account-admin/…`). تا `null` است، ماژول در وب دیده نمی‌شود و لینکِ مستقیم
  صادقانه «هنوز ساخته نشده» می‌گوید — زبانهٔ خالی یا «به‌زودی» ساخته نمی‌شود.
- کارتِ داشبورد (اختیاری): یک تابع در `src/console/summaries.js` با کلیدِ همان `id` —
  `async (ctx) => ({ source, at, metrics: [{ id, label: {fa,en,ps}, value }], alerts?: [{ level, text, link }] })`.
  `ctx.get(path, query)` همان پلِ فهرست‌سفید است و هر مسیر را در هر درخواستِ داشبورد یک بار می‌زند. نیامده ⇒ `null`؛ خطا ⇒
  پرتاب کنید (همان کارت «—» با کد می‌شود، بقیه سرِ جایشان). ماژولِ بی تابع کارتِ «خلاصه‌ای ندارد» می‌گیرد.

**ب) وب — یک فایل `homelab-panel/web/src/pages/account/console/modules/<id>.tsx`:**

```tsx
import { Store } from 'lucide-react';
import MarketModule from '../../market/MarketModule';
import { defineModule } from '../contract';          // ⛔ نه از '../registry' — حلقه ⇒ کلِ پنل سفید

export default defineModule({ id: 'market', icon: Store, component: MarketModule, crumb: (p) => p.get('case') });
```

- `registry.ts` همهٔ `./modules/*.tsx` را خودکار جمع می‌کند (`import.meta.glob`)؛ فهرستِ دستی نیست.
- `component` این‌ها را می‌گیرد: `params` (پارامترهای نشانی)، `setParams(next)` (`tab` خودش می‌ماند)، `info` (ردیفِ سرور)،
  `role`، `owner` — فقط برای نشان دادن؛ مرز در سرور است.
- عنوان، گروه و ترتیب از سرور می‌آیند؛ در فایلِ وب تکرار نکنید.

## ۳. قاعده‌های ثابت (از پرامپتِ مالک — برای هر ماژولِ تازه)

- هر عدد از منبعِ واقعی، با منبع و زمان (`SourceLine`)؛ نیامده «—» (`shown`)، نه صفر؛ خطا با کدِ خودش (`Problem`).
- نوشتن: مجوز در سرور، دلیل + تأیید + کلیدِ یکتایی (`SensitiveDialog`)؛ کارِ حساس + رمزِ پنل؛ نتیجه «تأییدشده از سرور».
- هر کارِ مدیریتیِ مهم یک ردیفِ دفترِ پنل (`audit`) — چه کسی، چه، روی چه، نتیجه، دلیل، «پیشین ⇒ تازه»؛ هرگز رمز/کلید.
- فهرستِ بزرگ: جست‌وجو، پالایش و صفحه‌بندی سمتِ سرور.
- نوعِ تازهٔ جست‌وجوی سراسری: در `routes/console-shell.js` (`KIND_MODULE` و منبعِ همان نوع) و در `Search.tsx` (`view`).
- آزمون: ردیفِ تازه خودکار در `test/console-shell.mjs` (نقشِ `probe`، هم‌خوانیِ سرور ⇄ وب) و `test/bridge-roles.mjs` (هر درِ پل).
