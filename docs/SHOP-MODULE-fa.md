# 🏪 بخشِ «فروشگاه» — ماژولِ جداشدنی (از ۱۴۰۵/۰۸/۲۳، نسخهٔ 1.51.0)

> دستورِ صاحب محصول: «کدهای بخشِ فروشگاه در برنامهٔ سرور جوری باشد که بشود در جا همه را استخراج کرد و برایش یک برنامهٔ
> جدا ساخت. الان روی برنامهٔ سرور باشد، ولی اگر خواستم بی‌دردسر از برنامهٔ سرور جدایش کنم و برایش برنامه یا سایت یا هر
> چیز دیگری بسازم.»

**امروز هیچ چیزِ پنل عوض نشده است**: همان `/shop`، همان آیتمِ منو (بینِ «پمپ‌بنزین‌ها» و «کدها»)، همان ۱۶ زیرماژول با همان
`?tab=`، همان نقش‌ها و همان درهای `/api/account-admin/*`. فقط کد یک جا جمع شده، یک درِ مشخص به پنل دارد، و یک ساختِ جدا ثابت
می‌کند که بی پنل هم بالا می‌آید.

پیوندها: پوسته و افزودنِ زیرماژول ⇐ `docs/CONSOLE-SHELL-fa.md` · قاعدهٔ ماندگار ⇐ بخشِ «بخشِ فروشگاه جداشدنی است» در
`docs/RULES-fa.md`.

---

## ۱. نقشه

```
homelab-panel/web/src/
├─ modules/
│  ├─ registry.ts          ← فهرستِ ماژول‌های پنل؛ «فروشگاه» = یک ورود (import shop from './shop' و [shop])
│  ├─ types.ts             ← قراردادِ ماژولِ پنل: routes · menu · minRole · apiPrefixes
│  └─ shop/
│     ├─ index.ts          ← شناسنامه: مسیرِ /shop ⇐ console/Shell، آیتمِ منوی «هر روز» (navShops)، minRole
│     ├─ host.ts           ← ⛔ تنها درِ ماژول به پنل (پایین: «رابطِ میزبان»)
│     ├─ ShopConsole.tsx · ShopDesk.tsx · ShopFinance.tsx · ConsoleOps.tsx · consoleOpsI18n.ts · consoleData.ts
│     ├─ console/          ← پوسته (Shell، Dashboard، Search، registry، contract) + کارت‌ها + modules/<id>.tsx (۱۶ زیرماژول)
│     ├─ market/           ← ۴.۶ بازار و ۴.۷ پیک
│     ├─ finance/          ← ۴.۵ مالیِ مرکزی
│     └─ standalone/       ← ساختِ جدا: index.html · main.tsx · StandaloneApp.tsx · host.tsx · host.check.ts · shared-pieces.json
├─ App.tsx                 ← مسیرها را از PANEL_MODULES می‌چیند (نامِ فروشگاه را نمی‌داند)
└─ components/Layout.tsx   ← آیتمِ منو با ...moduleMenu('daily') سرِ همان جای پیشین

homelab-panel/server/src/
├─ modules/
│  ├─ registry.js          ← فهرستِ ماژول‌های سرور؛ mountModules(router, deps) و MODULE_CAPABILITIES
│  └─ shop/
│     ├─ index.js          ← شناسنامه + mount(router, deps): همهٔ درهای ماژول‌دارِ /console/* به همان ترتیبِ پیشین
│     ├─ host.js           ← ⛔ تنها درِ ماژول به پنل
│     ├─ routes/           ← console-shell · market · ops · staff · image-bank · holidays · image-changes · synonyms ·
│     │                       support-access · parity (+ GET /console/release/beta) · account-finance
│     └─ console/          ← modules.js (فهرستِ ۱۶ زیرماژول و minRole) · summaries.js (کارت‌های داشبورد)
└─ routes/account-admin.js ← پلِ سرورِ حساب؛ ماژول را فقط با mountModules و MODULE_CAPABILITIES می‌شناسد
```

## ۲. فهرستِ کد (سیاهه)

### ۲-الف) فقط‌فروشگاه — جابه‌جا شد

| | تعداد | پرونده‌ها |
|---|---|---|
| وب، ریشهٔ ماژول | ۶ | `ShopConsole.tsx` · `ShopDesk.tsx` · `ShopFinance.tsx` · `ConsoleOps.tsx` · `consoleOpsI18n.ts` · `consoleData.ts` |
| وب، پوسته | ۲۱ | `Shell` · `Dashboard` · `Search` · `registry.ts` · `contract.ts` · `UsersModule` · `SettingsModule` · `ImageBankModule` · `ImageBankTools` · `UnifiedAudit` · و کارت‌های `Backups` · `Beta` · `Contract` · `Downloads` · `Holidays` · `ImageChanges` · `NotifyUsage` · `Staff` · `SupportAccess` · `Synonyms` · `TenantBackups` |
| وب، زیرماژول‌ها | ۱۶ | `console/modules/`: dash · shops · subs · codes · imagebank · finance · market · courier · versions · health · errors · alerts · users · settings · integrations · audit |
| وب، بازار و پیک | ۵ | `market/`: `MarketConsole` · `CourierConsole` · `marketData.ts` · `parts.tsx` · `tx.ts` |
| وب، مالی | ۵ | `finance/`: `Ledger` · `Checks` · `data.ts` · `parts.tsx` · `strings.ts` |
| **وب، جمع** | **۵۳** | از `web/src/pages/account/…` به `web/src/modules/shop/…` (چیدمانِ درونی همان ⇒ وارد کردن‌های درونی دست نخورد) |
| سرور، درها | ۱۱ | `routes/console-{shell,market,ops,staff,image-bank,holidays,image-changes,synonyms,support-access,parity}.js` · `routes/account-finance.js` |
| سرور، فهرست و داشبورد | ۲ | `console/modules.js` · `console/summaries.js` |
| **سرور، جمع** | **۱۳** | از `server/src/{routes,console}/` به `server/src/modules/shop/{routes,console}/` |

و تازه: `web/src/modules/{registry,types}.ts`، `web/src/modules/shop/{index,host}.ts`، ۶ پروندهٔ `standalone/`،
`web/vite.shop-standalone.config.ts`، `web/scripts/check-shop-standalone.mjs`، `server/src/modules/registry.js`،
`server/src/modules/shop/{index,host}.js`، و آزمون‌های `module-boundary.mjs` و `shop-standalone-ui.mjs`.

### ۲-ب) مشترک — سرِ جایش ماند، ماژول فقط از `host` به آن می‌رسد

| پرونده | چرا مشترک است |
|---|---|
| `pages/account/AppSubscriptions.tsx` (و `Customers` · `Plans` · `Discounts` · `VipCodes` · `OfflineCodes` · `Visitors` · `SalesReps` · `PurchaseRequests` · `GrantSub` · `DeleteAccount`) | اشتراکِ **پمپ** هم همین است (`/stations#subs`)؛ زیرماژولِ `subs` با `app="shop"` آن را می‌گذارد |
| `pages/account/Sales.tsx` (+ `Revenue.tsx`) | صفحهٔ `/sales` ِ پنل و داشبورد؛ زیرماژولِ «مالی» با `fixedApp="shop"` |
| `pages/account/shared.tsx` (`useLoad` · `CloudProblem` · `fa` · `money`) · `subsPath.ts` · `types.ts` | همهٔ صفحه‌های سرورِ حساب (پمپ، پیام، پشتیبانی، همگام‌سازی) |
| `pages/account/console/parts.tsx` (`SensitiveDialog` · `Guarded` · حالت‌ها) | صفحهٔ «همگام‌سازی» (`SyncStatus`) هم پنجرهٔ کارِ حساس را دارد. ⚠️ دو تابعِ کوچکِ `reasonOk`/`newIdemKey` از `consoleData.ts` این‌جا **کپی** شد (این پرونده نباید از ماژول وارد کند) — `module-boundary.mjs` یکی ماندنشان را می‌سنجد |
| `pages/account/console/text.ts` (`useTx` · `usePick`) | همان `parts.tsx` و `GrantNeeded.tsx`؛ نوعِ `Tri` حالا همین‌جا هم تعریف شده |
| `pages/account/console/GrantNeeded.tsx` | «اجازهٔ پشتیبانی لازم است» در `Customers` و `SyncStatus` هم هست |
| `pages/control/PanelUsers.tsx` | کاربرانِ **پنل** (نه مدیرانِ سرورِ حساب) — مالِ پنل؛ ماژول فقط وقتی میزبان بدهد نشانش می‌دهد |
| سرور: `support/telegram-console-alerts.js` | رباتِ تلگرامِ مالک (`telegram-watch.js` ِ پنل) هشدارهای کنسول را می‌فرستد |

### ۲-پ) زیرساختِ پنل — ماژول از `host` می‌گیرد

وب: `api.ts` (توکنِ نشست، ۴۰۱، «احرازِ دوباره»)، `app-context.tsx` (`useApp`)، `components/ui.tsx` (کارت، پنجره، `toast`)،
`control/ui.tsx` (جدول، `Notice`)، `i18n.ts`، `format.ts`، `features.ts`، `useLive.ts`.
سرور: `db.js`، `control/roles.js`، `auth.js`، `control/audit.js`، `stations/cloud.js` (**پلِ سرورِ حساب** — مشترک با پمپ؛ دست
نخورد)، `account/bridge-fail.js`، `account/idem-once.js`، `platform/rate-limit.js`، `api/account-proxy.js`، `version.js`.

### ۲-ت) هنوز در پلِ مشترک (`routes/account-admin.js`) — عمداً

- ۱۶ درِ تکیِ `/console/*`: `system/health|providers|versions|chain-verify` · `version-health` · `live-config` · `capabilities` ·
  `shops/:id/health` · `shops/:id/holds` (+ گذاشتن و `lift`) · `flags` · `flags/history` · `service-key` (+ ساختن و `revoke`).
  چرا: با درونِ خودِ پل بافته‌اند (`guard`، `capabilities()`، `PHASE3`، کلیدِ سرویس) و چند تا پمپ را هم می‌دهند (`live-config`،
  `version-health?app=`، کلیدِ سرویس). جابه‌جاییِ این‌ها کارِ گامِ بعد است (پایین: «مانده‌ها»).
- `/shop-desk/*` و `/shop-accounts/*`: بخشی از قراردادِ «مشتری‌ها و اشتراک‌ها» ِ هر دو برنامه.
- ⛔ پمپ و تانک‌تیل دست نخورد، و قراردادِ سرورِ حساب همان است (همهٔ ۲۴۷ مسیرِ روترِ پل همان‌اند؛ فقط جای دو دسته عوض شد که با
  هم برخورد ندارند: درهای ماژول همه با `/console/` شروع می‌شوند و شش خواندنیِ `/stats`، `/shops`… نه).

## ۳. مرز و رابطِ میزبان

**قاعده (سنجه: `server/test/module-boundary.mjs` در `npm test`):**
- ⛔ هیچ پرونده‌ای بیرون از `modules/shop/` از درونش وارد نمی‌کند — جز `modules/registry.ts` / `src/modules/registry.js`.
- ⛔ هیچ پرونده‌ای درونِ `modules/shop/` از پنل وارد نمی‌کند — فقط `./` و `../` ِ خودِ ماژول، `host`، و بسته‌های npm (سرور:
  `node:*` هم). خودِ `host` درِ پنل است.
- ⛔ `standalone/` فقط تکه‌های `shared-pieces.json` را از پنل می‌گیرد و میزبانِ پنل را جز به‌صورتِ نوع (`import type`) نه.

**`web/src/modules/shop/host.ts`:**

| گروه | نام‌ها |
|---|---|
| درخواستِ واردشده | `api` · `ApiError` · `getToken` · `fetchBlobUrl` |
| کاربر و نقش (فقط این پنج) | `useApp(): { can, dir, lang, t, username }` (نوعِ `HostApp`) |
| پیمایش | `SHOP_HOME = '/shop'` + `react-router-dom` (npm) |
| اعلان و تکه‌های رابط | `toast` · `Card` · `Modal` · `ConfirmDialog` · `CopyButton` · `Loading` · `Skeleton` · `ActionButton` · `Cell` · `KV` · `Notice` · `Row` · `Select` · `Stat` · `Table` · `Tabs` |
| زبان و قالب‌بندی | `Dict` (نوع) · `dateTime` · `useTx` · `usePick` · `Tx` |
| تکه‌های مشترکِ سرورِ حساب | `useLoad` · `Load` · `CloudProblem` · `fa` · `money` · `SensitiveDialog` · `SensitiveSubmit` · `Guarded` · `Forbidden` · `NotSupported` · `StateEmpty` · `StateLoading` · `errCode` · `errText` · `fmtTime` · `outcomeUnknown` · `GrantNeeded` · `GRANT_REQUIRED` · `SUPPORT_ACCESS_ANCHOR` |
| جای صفحه‌های مشترک | `AppSubscriptions` · `Sales` · `PanelUsers` (`ComponentType \| null` — میزبانِ جدا `null`) |
| قرارداد | `PanelModule` (نوع) |

جای صفحه (layout): پنل مسیرهای `index.ts` را زیرِ `Layout` ِ خودش می‌گذارد؛ ساختِ جدا زیرِ یک نوارِ ساده. ماژول خودش چیدمانِ
بیرونی نمی‌سازد.

**`server/src/modules/shop/host.js`:** `db` · `getSetting` · `setSetting` · `panelRoles` · `requireRole` · `roleOf` · `panelAuth` ·
`audit` · `cloudRaw` · `cloudRawBytes` · `cloudRawText` · `cloudCall` · `cloudStatus` · `bridgeTimeouts` · `legacyAvailable` ·
`serviceKeyStatus` · `bridgeFail` · `ACCOUNT_PREFIXES` · `accountApiUrl` · `rateLimit` · `checkIdemKey` · `makeIdemOnce` ·
`makeUpstreamOnce` · `serverPathFor` · `upstreamKey` · `versionInfo` · `CONSOLE_ALERT_RULES` · `consoleAlertPrefs` ·
`setConsoleAlertPrefs`. و آن‌چه پل به ماژول می‌دهد در `deps` ِ `mount(router, deps)` است (`guard` · `capabilities` · `capListed` ·
`unavailable` · `missingErr` · `badInput` · `stamped` · `actorOf` · `isPanelOwner` · `reauthLimit` · `reauth`) — نه وارد کردنِ دوطرفه.

⛔ نامِ تازه در `host.ts` ⇒ همان نام با همان نوع در `standalone/host.tsx` (وگرنه `standalone/host.check.ts` و `npm run build`
سرخ). تکهٔ مشترکِ تازه ⇒ یک خط در `shared-pieces.json` (وگرنه ساختِ جدا سرخ).

## ۴. (الف) درونِ پنل — امروز

هیچ کارِ تازه‌ای لازم نیست: `npm run build` ِ `web` همان `server/public` را می‌سازد و `/shop` همان است.

- **ثبت:** `web/src/modules/registry.ts` (`import shop from './shop'` و `[shop]`) و `server/src/modules/registry.js`
  (`import shop from './shop/index.js'`).
- **برداشتن از پنل** (روزی که برنامهٔ جدا جایش را گرفت): همان ورود در دو `registry` و دو پوشهٔ `modules/shop` ⇒ مسیر، آیتمِ منو،
  درهای `/console/*` ِ ماژول‌دار و توانایی‌های بازار/پیک با هم می‌روند. ⚠️ این پیوندهای پنل به `/shop` آن روز به خانه برمی‌گردند
  (پیوند‌اند، نه وارد کردن): `pages/hubs.tsx` (`AUDIT_HOME`)، `pages/Dashboard.tsx` و `PALETTE_EXTRA` ِ `Layout.tsx`
  (`subsPath('shop')`)، `GrantNeeded.tsx` (`supportAccessHref`)؛ و ۱۶ درِ بخشِ ۲-ت در پل می‌مانند تا جدا شوند.

## ۵. (ب) ساختنِ سایتِ جدا

```bash
cd homelab-panel/web
npm ci
npm run build:shop-standalone        # ⇒ web/dist/shop-standalone/  (index.html · assets/ · fonts/ · modules.json)
npm run test:shop-standalone         # ساخت + سنجهٔ بسته (همان که CI بعد از ساختِ پنل می‌زند)
SHOP_API=http://localhost:4700 npm run dev:shop-standalone       # توسعه روی 5274، /api به پنلِ در حالِ اجرا
SHOP_API=http://localhost:4700 npm run preview:shop-standalone   # همان ساخت روی 5275
```

- ⛔ جایی فرستاده نمی‌شود و به `server/public` دست نمی‌زند (`dist/` در `.gitignore` است).
- **ورود** همان ورودِ پنل است روی همان سروری که `/api/account-admin/*` را می‌دهد: `POST /api/auth/login` (و `/login/totp` با
  دوعاملی)، نقش و «مالک» از `GET /api/auth/me`، کارِ حساس با همان پنجرهٔ رمزِ `ReauthHost`. رمز نگه داشته نمی‌شود.
- **یک مبدأ:** صفحه `/api/…` را نسبی صدا می‌زند و پنل سرآیندِ CORS نمی‌دهد (عمداً — قراردادِ پنل عوض نشد). پس سایت و `/api` باید
  پشتِ **یک نشانی** باشند: پراکسیِ معکوس (Caddy/nginx) که پوشه را سرو کند و `/api/*` را به پنل بفرستد، مثلاً:

  ```
  shop.example.com {
    handle /api/* { reverse_proxy 127.0.0.1:4700 }
    handle { root * /srv/shop-standalone; try_files {path} /index.html; file_server }
  }
  ```
- داراییها نسبی‌اند (`base: './'`) ⇒ زیرِ هر مسیری می‌نشیند؛ نشانی‌های درونی همان `/shop?tab=…` است.
- سنجه‌ها: بسته فقط خودِ ماژول و تکه‌های `shared-pieces.json` را دارد (افزونهٔ ساخت سرخ می‌کند)، و `check-shop-standalone.mjs`
  ده نشانهٔ صفحه‌های فقط‌پنل (ترمینال، فایل‌ها، پمپ‌ها، سایت‌ها، پایگاه‌داده، سرورهای من، دستیار، اتوماسیون، دامنه‌ها، کاربرانِ
  پنل) را در بستهٔ پنل می‌یابد و در این نه. `test/shop-standalone-ui.mjs` (کرومیوم) همان را از پوشهٔ جدا با پراکسیِ `/api` باز
  می‌کند، وارد می‌شود و ماژول‌ها را می‌گردد.

## ۶. (ج) برنامهٔ دسکتاپ یا موبایل

همان پوشهٔ `web/dist/shop-standalone/` پوسته‌ای می‌خواهد که `/api` را هم‌مبدأ نگه دارد:

- **ساده‌ترین (هر دو):** سایت را مثلِ بخشِ ۵ روی دامنه بگذارید و برنامه فقط همان نشانی را باز کند — Electron (`loadURL`)،
  Tauri (`url` ِ پنجره)، یا Capacitor (`server.url`). به‌روزرسانی = ساختِ تازهٔ سایت؛ برنامه دست نمی‌خورد.
- **با پرونده‌های درونِ برنامه:** `VITE_SHOP_ROUTER=hash npm run build:shop-standalone` (نشانی‌ها `#/shop?tab=…`، بی نیاز به
  سرورِ صفحه) و پوسته `/api/*` را به سرور برساند: در Electron یک `protocol.handle` یا سرورِ محلیِ کوچک که پوشه را سرو و `/api` را
  پراکسی کند (همان کارِ `shop-standalone-ui.mjs`)؛ در Capacitor پراکسیِ `server.url`/`hostname` ِ خودش. پنل تغییری نمی‌خواهد.

## ۷. بیرون بردن به ریپوی جدا

۱) **وب:** `web/src/modules/shop/` + پرونده‌های `standalone/shared-pieces.json` (همان مسیرها، زیرِ `src/`):

| | پرونده‌ها |
|---|---|
| زیرساخت | `api.ts` · `app-context.tsx` · `features.ts` · `format.ts` · `i18n.ts` · `index.css` · `useLive.ts` · `types.ts`⁽ⁿ⁾ |
| رابط | `components/ui.tsx` · `components/ReauthHost.tsx` · `components/CodeInput.tsx` · `control/ui.tsx` · `control/types.ts`⁽ⁿ⁾ |
| قرارداد | `modules/types.ts`⁽ⁿ⁾ |
| سرورِ حساب، مشترک با پمپ | `pages/account/{AppSubscriptions,Customers,DeleteAccount,Discounts,GrantSub,OfflineCodes,Plans,PurchaseRequests,Revenue,Sales,SalesReps,VipCodes,Visitors}.tsx` · `pages/account/{shared.tsx,subsPath.ts,types.ts⁽ⁿ⁾}` · `pages/account/console/{GrantNeeded.tsx,parts.tsx,text.ts}` |

⁽ⁿ⁾ فقط نوع (برای `tsc`؛ در بسته نمی‌آید). و `web/public/fonts/`، `tailwind.config.js`، `postcss.config.js`،
`vite.shop-standalone.config.ts` (که آن‌جا همان `vite.config.ts` می‌شود) و وابستگی‌های `web/package.json`.
⚠️ `i18n.ts` (فرهنگِ پنل) کامل می‌آید؛ کوچک کردنش (فقط کلیدهای `sc…`/`shopDesk…`/اشتراک) کارِ همان روز است. `app-context.tsx`
بستهٔ `socket.io-client` را هم می‌آورد (برای `AppProvider` ِ پنل)؛ با جدا کردنِ `useApp`/`AppStateProvider` به پرونده‌ای کوچک
می‌رود.

۲) **سرور (اگر پشتِ برنامهٔ جدا پنل نباشد):** `server/src/modules/shop/` + پیاده‌سازیِ تازهٔ `host.js` با همان نام‌ها: پلِ سرورِ
حساب (`stations/cloud.js` ← کلیدِ سرویس و مهلت‌ها)، نقش و نشست (`control/roles.js`، `auth.js`)، دفتر (`control/audit.js`، `db.js`)،
نگهبان‌ها (`rate-limit.js`، `idem-once.js`، `bridge-fail.js`) و `deps` ِ `mount` (از `account-admin.js`). و ۱۶ درِ بخشِ ۲-ت.
**ساده‌تر:** برنامهٔ جدا همان پنل را پشتِ `/api` نگه دارد (بخشِ ۵) — امروز همین کار می‌کند و چیزی از سرور کپی نمی‌شود.

## ۸. سنجه‌ها

| سنجه | کجا | چه |
|---|---|---|
| `server/test/module-boundary.mjs` | `npm test` (CI «آزمون‌ها») | مرزِ وب و سرور، `shared-pieces.json`، یکی ماندنِ دو کپی، ثبتِ یک‌ورودی، ۹ جهش |
| `web/src/modules/shop/standalone/host.check.ts` | `npm run build` (`tsc -b`) | دو میزبان همان نام‌ها و نوع‌ها |
| افزونهٔ `shop-standalone-boundary` | `npm run build:shop-standalone` | پروندهٔ پنل بیرون از فهرست ⇒ ساخت سرخ |
| `web/scripts/check-shop-standalone.mjs` | `npm run test:shop-standalone` (CI «ساخت») | پوشهٔ جدا، فقط ماژول و تکه‌ها، بی نشانهٔ صفحه‌های فقط‌پنل |
| `server/test/shop-standalone-ui.mjs` | `npm run test:shop-standalone-ui` (کرومیوم) | ورود، ماژول‌ها، نشست، خروج در سایتِ جدا؛ همان ماژول در پنل |
| `live-pages` · `console-shell` · `console-market` · `bridge-roles` | `npm test` | همان سنجه‌های پیشین روی نشانی‌های تازه |

## ۹. مانده‌ها

- بردنِ ۱۶ درِ تکیِ `/console/*` از `account-admin.js` به `modules/shop` (با `capabilities()` و `PHASE3` از راهِ `deps`).
- `useApp`/`AppStateProvider` در پرونده‌ای جدا از `AppProvider` ⇒ ساختِ جدا بی `socket.io-client`.
- فرهنگِ کوچکِ خودِ فروشگاه به جای کلِ `i18n.ts` (امروز ساختِ جدا ~۹۸۵ کیلوبایت است؛ پنل ~۱٫۴۷ مگابایت).
- ساختِ جدا تازه شدنِ زنده (سوکتِ پنل، `useLive`) ندارد؛ صفحه‌ها با باز شدن خوانده می‌شوند (و تورِ ایمنیِ زمان‌دارِ همان صفحه‌ها، اگر دارند).
