// ---------------------------------------------------------------------------
//  🏪 سنجهٔ ساختِ جدای «فروشگاه» — پس از ‎npm run build:shop-standalone‎ (همان ‎npm run test:shop-standalone‎)
//
//  ⛔ ساخت سبز است و سایتِ ایستا در پوشهٔ جدا (‎web/dist/shop-standalone/‎) با نشانیِ نسبیِ داراییها؛
//  ⛔ در بسته فقط خودِ ماژول و تکه‌های ‎standalone/shared-pieces.json‎ (فهرستِ واقعیِ ‎modules.json‎ ِ همان ساخت)؛
//  ⛔ هیچ نشانه‌ای از صفحه‌های فقط‌پنل (ترمینال، فایل‌ها، پمپ‌ها، سایت‌ها…) — و هر نشانه **در بستهٔ پنل هست**، تا سنجه پوچ نباشد.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';

const web = path.resolve(import.meta.dirname, '..');
const out = path.join(web, 'dist', 'shop-standalone');
const panelAssets = path.join(web, '..', 'server', 'public', 'assets');

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 600)}`);
};
const jsOf = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n') : '');

console.log('\n══ ساختِ جدای «فروشگاه» ══\n');
const html = fs.existsSync(path.join(out, 'index.html')) ? fs.readFileSync(path.join(out, 'index.html'), 'utf8') : '';
check('سایتِ ایستا در پوشهٔ جدا ساخته شد (index.html + داراییها)', Boolean(html) && fs.existsSync(path.join(out, 'assets')));
check('⛔ پوشهٔ خروجی جدا از server/public ِ پنل', path.relative(path.join(web, '..', 'server', 'public'), out).startsWith('..'));
check('داراییها نسبی‌اند (زیرِ هر مسیر یا درونِ برنامهٔ دسکتاپ/موبایل)', /src="\.\/assets\/[^"]+\.js"/.test(html), html);
check('قلم‌های پنل همراهِ سایت', fs.existsSync(path.join(out, 'fonts', 'Vazirmatn-Regular.woff2')));

const shared = new Set(JSON.parse(fs.readFileSync(path.join(web, 'src', 'modules', 'shop', 'standalone', 'shared-pieces.json'), 'utf8')).files);
const mods = fs.existsSync(path.join(out, 'modules.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'modules.json'), 'utf8')) : [];
const outside = mods.filter((f) => !f.startsWith('modules/shop/') && !shared.has(f));
check('فهرستِ پرونده‌های بسته آمد', mods.length > 50, String(mods.length));
check('⛔ از پنل فقط تکه‌های فهرست‌شده (shared-pieces.json)', outside.length === 0, outside.join(' '));
check('⛔ میزبانِ پنل (modules/shop/host.ts) جایش را به میزبانِ جدا داد', !mods.includes('modules/shop/host.ts') && mods.includes('modules/shop/standalone/host.tsx'));
check('خودِ ماژول در بسته است (پوسته، شناسنامه، زیرماژول‌ها)',
  ['modules/shop/index.ts', 'modules/shop/console/Shell.tsx', 'modules/shop/console/registry.ts', 'modules/shop/ShopConsole.tsx', 'modules/shop/market/MarketConsole.tsx', 'modules/shop/finance/Ledger.tsx']
    .every((f) => mods.includes(f)) && mods.filter((f) => f.startsWith('modules/shop/console/modules/')).length >= 15);
check('⛔ هیچ صفحه، منو یا پوستهٔ پنل (App، Layout، pages/* جز تکه‌های مشترکِ سرورِ حساب)',
  !mods.some((f) => f === 'App.tsx' || f === 'main.tsx' || f === 'components/Layout.tsx' || /^pages\/(?!account\/)/.test(f) || f === 'pages/control/PanelUsers.tsx'));

const js = jsOf(path.join(out, 'assets'));
const panel = jsOf(panelAssets);
check('بستهٔ جاوااسکریپت ساخته شد', js.length > 100_000, String(js.length));
check('درهای خودِ فروشگاه و ورود در بسته‌اند', js.includes('/api/account-admin/console/modules') && js.includes('/api/auth/login') && js.includes('/api/auth/me'));

/** نشانه‌های صفحه‌های فقط‌پنل — هر کدام باید در بستهٔ پنل باشد و در بستهٔ فروشگاه نه */
const PANEL_ONLY = {
  'ترمینال (Terminal.tsx)': "'term:open'",
  'فایل‌ها (Files.tsx)': '/api/files',
  'پمپ‌بنزین‌ها (Stations.tsx، StationProfile.tsx)': '/api/stations',
  'سایت‌ها (Sites.tsx)': '/api/sites',
  'پایگاه‌داده (Databases.tsx)': '/api/databases',
  'سرورهای من (MyServers.tsx)': '/api/fleet',
  'دستیار (Assistant.tsx)': '/api/agent',
  'اتوماسیون (Automation.tsx)': '/api/automation',
  'دامنه‌ها (Domains.tsx)': '/api/domains',
  'کاربرانِ پنل (PanelUsers.tsx)': '/api/auth/users',
};
const panelBuilt = panel.length > 0;
check('بستهٔ پنل برای سنجشِ نشانه‌ها هست (npm run build پیش از این)', panelBuilt);
for (const [what, marker] of Object.entries(PANEL_ONLY)) {
  const m = marker.replace(/^'|'$/g, '');
  const inPanel = panel.includes(m);
  check(`⛔ ${what} در ساختِ جدا نیست`, inPanel && !js.includes(m), inPanel ? `«${m}» در بستهٔ فروشگاه هست` : `نشانهٔ «${m}» دیگر در بستهٔ پنل هم نیست — نشانه را تازه کنید`);
}

console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
