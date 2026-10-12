// ---------------------------------------------------------------------------
//  منوهای پایینِ صفحهٔ رباتِ مالک — هر برنامه منوی خودش (از ۱۴۰۵/۰۷/۲۰، نسخه 1.50.53)
//
//  خواستهٔ صاحب سامانه: «هر برنامه را بزنم همان برنامه یا منو، کادری بیاید که بالای
//  نوشتنِ پیام است.»
//
//      🏠 اصلی ──▶ ⛽ پمپ بنزین · 🛒 فروشگاه · 🌐 سایت‌ها ──▶ 🌐 <هر سایت> · 🛠 سرور
//
//  ⛔ منوی فعلی (`support_tg_menu`) فقط «جا»ست: جست‌وجوی بی‌دکمه در منوی پمپ فقط
//     پمپ‌ها را می‌گردد، در فروشگاه فقط فروشگاه‌ها، جای دیگر هر دو.
//  ⛔ برچسب‌ها در همهٔ منوها یکتا هستند؛ دکمهٔ هر منو از هر جا کار می‌کند (منوی کهنهٔ
//     گوشی هم درست جواب می‌گیرد).
//  ⛔ هیچ برچسبی هرگز به کاربر نمی‌رود (`resolveKey` در `telegram.js` پیش از Reply).
// ---------------------------------------------------------------------------
import { getSetting, setSetting } from '../db.js';
import { listSitesRaw, getSite } from '../sites/registry.js';
import { isRunning } from '../sites/process.js';
import { fa, btn } from './telegram-admin.js';

const KEY = 'support_tg_menu';
const SITE_PREFIX = '🌐 ';

const MENUS = {
  main: [
    [['⛽ پمپ بنزین', { a: 'menu', to: 'pump' }], ['🛒 فروشگاه', { a: 'menu', to: 'shop' }]],
    [['🌐 سایت‌ها', { a: 'menu', to: 'sites' }], ['🛠 سرور', { a: 'menu', to: 'server' }]],
    [['💬 همهٔ پیام‌ها', { a: 'inbox' }], ['🔎 جست‌وجو', { a: 'find' }]],
    [['📊 گزارش', { a: 'report' }], ['⚙️ تنظیمات', { a: 'settings' }]],
    [['❓ راهنما', { a: 'help' }]],
  ],
  pump: [
    [['💬 پیام‌های پمپ', { a: 'inbox', app: 'pump' }], ['🔎 جست‌وجوی پمپ', { a: 'find', app: 'pump' }]],
    [['⏳ اشتراک‌های پمپ', { a: 'expiring', app: 'pump' }], ['🔑 کدِ آفلاین', { a: 'offline' }]],
    [['📋 کدهای آفلاین', { a: 'codes' }], ['⬆️ آپدیتِ برنامهٔ پمپ', { a: 'sv', p: 'pump' }]],
    [['📣 پیام به همهٔ پمپ‌ها', { a: 'broadcast', app: 'pump' }], ['📊 گزارشِ پمپ', { a: 'report', app: 'pump' }]],
    [['🏠 منوی اصلی', { a: 'menu', to: 'main' }]],
  ],
  shop: [
    [['💬 پیام‌های فروشگاه', { a: 'inbox', app: 'shop' }], ['🔎 جست‌وجوی فروشگاه', { a: 'find', app: 'shop' }]],
    [['⏳ اشتراک‌های فروشگاه', { a: 'expiring', app: 'shop' }], ['📣 پیام به همهٔ فروشگاه‌ها', { a: 'broadcast', app: 'shop' }]],
    [['📊 گزارشِ فروشگاه', { a: 'report', app: 'shop' }], ['🏠 منوی اصلی', { a: 'menu', to: 'main' }]],
  ],
  sitesTail: [
    [['💬 پیام‌های سایت‌ها', { a: 'inbox', app: 'site' }], ['⬆️ آپدیتِ سایت‌ها', { a: 'sv', p: 'siteup' }]],
    [['🏠 منوی اصلی', { a: 'menu', to: 'main' }]],
  ],
  site: [
    [['💬 گفت‌وگوهای این سایت', { a: 'siteChats' }], ['ℹ️ وضعیتِ این سایت', { a: 'siteInfo' }]],
    [['🔄 ری‌استارتِ این سایت', { a: 'siteOp', op: 'restart' }], ['⏯ روشن/خاموشِ این سایت', { a: 'siteOp', op: 'toggle' }]],
    [['🔙 سایت‌ها', { a: 'menu', to: 'sites' }], ['🏠 منوی اصلی', { a: 'menu', to: 'main' }]],
  ],
  server: [
    [['🖥 وضعیتِ سرور', { a: 'status' }], ['⬆️ آپدیتِ کنترول سنتر', { a: 'sv', p: 'panel' }]],
    [['🗄 سرورِ حساب', { a: 'sv', p: 'account' }], ['💾 پشتیبان‌ها', { a: 'sv', p: 'backup' }]],
    [['⚙️ کارهای خودکار', { a: 'sv', p: 'jobs' }], ['🌍 تونل و دامنه', { a: 'sv', p: 'tunnel' }]],
    [['📜 خطاهای اخیر', { a: 'sv', p: 'logs' }], ['🔄 ری‌استارتِ کنترول سنتر', { a: 'panelRestart' }]],
    [['🏠 منوی اصلی', { a: 'menu', to: 'main' }]],
  ],
};

const FIXED = new Map();
for (const rows of Object.values(MENUS)) for (const row of rows) for (const [label, act] of row) FIXED.set(label, act);

export function menuState() {
  const m = getSetting(KEY, null);
  return m && typeof m === 'object' && m.menu ? m : { menu: 'main' };
}
export function setMenu(menu, siteId = null) { setSetting(KEY, { menu, siteId }); }
/** برنامهٔ منوی فعلی برای جست‌وجوی بی‌دکمه: 'pump' · 'shop' · null (هر دو). */
export function menuApp() { const m = menuState().menu; return m === 'pump' || m === 'shop' ? m : null; }
export function currentSite() { const m = menuState(); return m.menu === 'site' && m.siteId ? getSite(m.siteId) : null; }

const siteLabel = (s) => `${SITE_PREFIX}${s.name}`.slice(0, 40);

/** متنِ یک دکمهٔ منو ⇒ کار (یا null). */
export function resolveKey(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (FIXED.has(t)) return FIXED.get(t);
  if (t.startsWith(SITE_PREFIX)) {
    const s = listSitesRaw().find((x) => siteLabel(x) === t);
    if (s) return { a: 'menu', to: 'site', siteId: s.id };
  }
  return null;
}

const rowsToKeys = (rows) => rows.map((r) => r.map(([text]) => ({ text })));

export function keyboardFor(menu = menuState().menu) {
  let keyboard;
  if (menu === 'sites') {
    const sites = listSitesRaw().slice(0, 30);
    const siteRows = [];
    for (let i = 0; i < sites.length; i += 2) siteRows.push(sites.slice(i, i + 2).map((s) => ({ text: siteLabel(s) })));
    keyboard = [...siteRows, ...rowsToKeys(MENUS.sitesTail)];
  } else {
    keyboard = rowsToKeys(MENUS[menu] || MENUS.main);
  }
  const hint = { main: 'یک بخش را بزنید، یا نام/ایمیلِ حساب را بنویسید', pump: 'نام، کد یا ایمیلِ پمپ…', shop: 'نام یا ایمیلِ فروشگاه…', sites: 'یک سایت را بزنید', site: 'کارِ این سایت را بزنید', server: 'کارِ سرور را بزنید' }[menu] || '';
  return { keyboard, resize_keyboard: true, is_persistent: true, input_field_placeholder: hint };
}
export const mainKeyboard = () => keyboardFor('main');

/** سرخطِ هر منو — کوتاه و زنده. */
export async function menuText(menu, { reportText, statusText }) {
  if (menu === 'main') return '🏠 منوی اصلی\n\nیک بخش را از پایینِ صفحه بزنید. هر برنامه منوی خودش را دارد.';
  if (menu === 'pump') return `⛽ پمپ بنزین\n\n${await reportText('pump')}`;
  if (menu === 'shop') return `🛒 فروشگاه\n\n${await reportText('shop')}`;
  if (menu === 'server') return statusText();
  if (menu === 'sites') {
    const sites = listSitesRaw();
    if (!sites.length) return '🌐 سایت‌ها\n\nهنوز سایتی ثبت نشده.';
    return ['🌐 سایت‌ها — یکی را بزنید', '', ...sites.map((s) => `${isRunning(s.slug) ? '🟢' : '⚪️'} ${s.name}${s.domain ? ` — ${s.domain}` : ''}`)].join('\n');
  }
  if (menu === 'site') {
    const s = currentSite();
    return s ? siteInfo(s) : 'این سایت دیگر نیست.';
  }
  return '';
}

export function siteInfo(s) {
  const on = isRunning(s.slug);
  return [`🌐 ${s.name}`, '', `${on ? '🟢 روشن' : '⚪️ خاموش'}`, s.domain ? `🔗 ${s.domain}` : null, s.port ? `🔌 پورت ${Number(s.port).toLocaleString('fa-IR', { useGrouping: false })}` : null].filter(Boolean).join('\n');
}

/** پیامِ تأییدِ کارِ یک سایت (ری‌استارت/روشن/خاموش) — همان کارِ `site`ِ telegram-admin. */
export function siteOpConfirm(s, op) {
  const real = op === 'toggle' ? (isRunning(s.slug) ? 'stop' : 'start') : op;
  const text = { restart: `🔄 سایتِ «${s.name}» ری‌استارت شود؟`, start: `▶ سایتِ «${s.name}» روشن شود؟`, stop: `⏹ سایتِ «${s.name}» خاموش شود؟ تا روشنش نکنید از دسترس بیرون است.` }[real];
  const yes = btn('✅ بله، انجام بده', { k: 'site', id: s.id, op: real, siteName: s.name });
  return { text, reply_markup: { inline_keyboard: [[{ ...yes, callback_data: yes.callback_data.replace(/^a:/, 'y:') }]] } };
}
