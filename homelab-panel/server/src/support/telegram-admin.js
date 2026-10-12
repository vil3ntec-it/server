// ---------------------------------------------------------------------------
//  رباتِ تلگرامِ مالک — کنترلِ سرور از تلگرام (از ۱۴۰۵/۰۷/۲۰، نسخه 1.50.50)
//
//  خواستهٔ صاحب سامانه: «برنامه‌های زیادی دارم، هر برنامه اشتراک و کاربرانِ زیادی…
//  جواب به همان حساب و پشتیبانی‌اش برود، اشتراک‌ها را از تلگرام به همان حساب بدهم،
//  و تمامِ سرورم را از همان ربات کنترل کنم.»
//
//  همان رباتِ پشتیبانی (`telegram.js`) است؛ این فایل فقط پیام‌ها و دکمه‌های **مالک**
//  را که Reply روی پیامِ کاربر نیستند جواب می‌دهد:
//      /start ‎·‎ /status ‎·‎ /sites ‎·‎ /expiring ‎·‎ هر متنِ دیگر = جست‌وجوی حساب
//
//  ⛔ فقط chat idِ مالک. دکمهٔ هر کسِ دیگری رد می‌شود.
//  ⛔ دکمه‌ها شناسه‌ای را با خود نمی‌برند: هر دکمه یک نشانیِ تصادفی است که کارِ واقعی
//     در `support_tg_acts` (همین پنل) پشتش نشسته ⇒ callback_dataِ جعلی به هیچ حسابی نمی‌رسد.
//  ⛔ هر کارِ پولی یا خاموش‌کننده دو قدم است: دکمه ⇒ «✅ بله، انجام بده».
//  ⛔ اشتراک فقط از راهِ `grantSubscription`/`extendSubscription`/`setSubscriptionStatus`ِ
//     `routes/account-admin.js` — همان درِ پنلِ وب، با همان دفترِ ممیزی. درِ دوم ساخته نشد.
// ---------------------------------------------------------------------------
import os from 'node:os';
import crypto from 'node:crypto';
import { getSetting, setSetting } from '../db.js';
import { cloudRaw } from '../stations/cloud.js';
import { readCpu, readMemory, readDisks } from '../metrics/system.js';
import { listSitesRaw, getSite } from '../sites/registry.js';
import { isRunning, startSite, stopSite, restartSite } from '../sites/process.js';
import { grantSubscription, extendSubscription, setSubscriptionStatus, createOfflineCode, revokeOfflineCode } from '../routes/account-admin.js';
import { tgFile } from './telegram.js';
import * as inbox from './telegram-inbox.js';
import { settingsMessage, reportText, setPrefs } from './telegram-watch.js';
import { serverMenu, serverPage, needsConfirm, confirmServer, runServer } from './telegram-server.js';
import * as menus from './telegram-menus.js';
import * as topics from './telegram-topics.js';

const ACTS = 'support_tg_acts';
const WIZ = 'support_tg_wiz';
const WIZ_MS = 10 * 60e3;
//  همان سه پلنِ `OfflineCodes.tsx`
const OFFLINE_PLANS = [{ code: 'std', title: 'استاندارد', days: 365 }, { code: 'vip', title: 'وی‌آی‌پی', days: 365 }, { code: 'perm', title: 'دائمی', days: null }];
const COMPUTER_RE = /^[A-Za-z0-9-]{4,40}$/;
const EMAIL_RE = /^[^\s@]{1,100}@[^\s@]{1,100}\.[^\s@]{1,20}$/;
const ACTS_MAX = 400;
const ACT_TTL = 24 * 3600e3;
const DAY = 24 * 3600e3;
export const APP = { pump: '🛢 پمپ', shop: '🛒 فروشگاه' };
const STATUS = { active: '✅ فعال', trial: '🎁 آزمایشی', suspended: '⏸ معلق', cancelled: '✖ لغو شده', canceled: '✖ لغو شده', expired: '⌛ منقضی', none: '— بی اشتراک' };
const UNIT = { day: 'روز', week: 'هفته', month: 'ماه', year: 'سال' };
const ACTOR = 'telegram';

export const fa = (n) => Number(n).toLocaleString('fa-IR');
const dateFa = (ms) => { try { return new Date(ms).toLocaleDateString('fa-IR-u-ca-persian'); } catch { return new Date(ms).toISOString().slice(0, 10); } };
const gb = (b) => `${(Number(b) / 1024 ** 3).toFixed(1)}GB`;

// ── دکمه‌ها: نشانیِ تصادفی ⇒ کارِ واقعی ─────────────────────────────────
function acts() {
  const a = getSetting(ACTS, null);
  return a && typeof a === 'object' ? a : {};
}
export function btn(text, act) {
  const all = acts();
  const now = Date.now();
  for (const [k, v] of Object.entries(all)) if (!v || now - v.at > ACT_TTL) delete all[k];
  const keys = Object.keys(all);
  if (keys.length >= ACTS_MAX) for (const k of keys.sort((x, y) => all[x].at - all[y].at).slice(0, keys.length - ACTS_MAX + 1)) delete all[k];
  const id = crypto.randomBytes(6).toString('base64url');
  all[id] = { ...act, at: now };
  setSetting(ACTS, all);
  return { text, callback_data: `a:${id}` };
}
const actOf = (id) => { const v = acts()[id]; return v && Date.now() - v.at <= ACT_TTL ? v : null; };

// ── حساب‌ها ────────────────────────────────────────────────────────────
/** همان شکلِ `grant-targets`ِ پنل. */
export async function search(app, q, limit = 8) {
  if (app === 'pump') {
    const out = await cloudRaw('GET', '/api/admin/pump/stations', { query: { q, limit } });
    return (out.stations || []).map((s) => ({
      app, tenantId: s.id, name: s.name || '', code: s.code || '', ownerName: s.owner_name || '', ownerEmail: s.owner_email || '', ownerPhone: s.owner_phone || '',
      subscriptionId: s.subscription_id || '', plan: s.plan || '', status: s.sub_status || 'none', endsAt: Number(s.ends_at) || 0, createdAt: Number(s.created_at) || 0,
    }));
  }
  const out = await cloudRaw('GET', '/api/admin/shops', { query: { q, limit } });
  return (out.shops || []).map((s) => ({
    app, tenantId: s.id, name: s.name || '', code: '', ownerName: s.owner_name || '', ownerEmail: s.owner_email || '', ownerPhone: s.owner_phone || '',
    subscriptionId: s.subscription_id || '', plan: s.plan || '', status: s.sub_status || 'none', endsAt: Number(s.ends_at) || 0, createdAt: Number(s.created_at) || 0,
  }));
}

/** یک حساب با شناسه‌اش — نام از پرونده، بقیه از همان فهرستِ جست‌وجو (یک شکل برای هر دو برنامه). */
async function accountOf(app, tenantId) {
  const detail = await cloudRaw('GET', app === 'pump' ? `/api/admin/pump/stations/${encodeURIComponent(tenantId)}` : `/api/admin/shops/${encodeURIComponent(tenantId)}`);
  const base = (app === 'pump' ? detail.station : detail.shop) || {};
  const q = (app === 'pump' ? base.code : '') || base.name || '';
  const hit = (await search(app, q, 50)).find((x) => String(x.tenantId) === String(tenantId));
  return hit || { app, tenantId, name: base.name || '', code: base.code || '', ownerName: '', ownerEmail: '', ownerPhone: '', subscriptionId: '', plan: '', status: 'none', endsAt: 0 };
}

export function daysLeft(a) {
  if (!['active', 'trial'].includes(a.status) || !a.endsAt) return 0;
  return Math.max(0, Math.ceil((a.endsAt - Date.now()) / DAY));
}

function cardText(a) {
  const lines = [
    `${APP[a.app]} · ${a.name || 'بی‌نام'}${a.code ? ` (${a.code})` : ''}`,
    a.ownerName || a.ownerEmail || a.ownerPhone ? `👤 ${[a.ownerName, a.ownerEmail, a.ownerPhone].filter(Boolean).join(' · ')}` : null,
    `💳 ${STATUS[a.status] || a.status}${a.plan ? ` · پلنِ ${a.plan}` : ''}`,
    a.endsAt && ['active', 'trial', 'suspended'].includes(a.status) ? `📅 تا ${dateFa(a.endsAt)}${daysLeft(a) ? ` — ${fa(daysLeft(a))} روز مانده` : ''}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}

function cardKeys(a) {
  const ref = { app: a.app, tenantId: a.tenantId };
  const rows = [];
  if (a.subscriptionId && ['active', 'trial', 'suspended', 'expired'].includes(a.status)) {
    rows.push([1, 3, 12].map((n) => btn(`➕ ${fa(n)} ماه`, { k: 'extend', ...ref, subId: a.subscriptionId, amount: n, unit: 'month' })));
    rows.push([
      a.status === 'suspended'
        ? btn('▶ فعال کن', { k: 'status', ...ref, subId: a.subscriptionId, status: 'active' })
        : btn('⏸ تعلیق', { k: 'status', ...ref, subId: a.subscriptionId, status: 'suspended' }),
      btn('✖ لغو', { k: 'status', ...ref, subId: a.subscriptionId, status: 'cancelled' }),
    ]);
  }
  rows.push([btn('🎁 اشتراکِ تازه با پلن', { k: 'plans', ...ref }), btn('🔄 تازه کن', { k: 'card', ...ref })]);
  return { inline_keyboard: rows };
}

// ── سرور و سایت‌ها ──────────────────────────────────────────────────────
export async function statusText() {
  const cpu = readCpu();
  const mem = await readMemory();
  const disks = ((await readDisks().catch(() => null)) || {}).disks || [];
  const sites = listSitesRaw();
  const up = sites.filter((s) => isRunning(s.slug)).length;
  let cloud = '❌ پاسخ نداد';
  //  ⚠️ cloudRaw فقط `/api/admin/…` را باز می‌کند؛ سبک‌ترین درِ مدیر = ورود هم سنجیده می‌شود
  try { await cloudRaw('GET', '/api/admin/support/threads', { query: { limit: 1 } }); cloud = '✅ روشن'; } catch (e) { cloud = `❌ ${String(e.message).slice(0, 80)}`; }
  const lines = [
    '🖥 وضعیتِ سرور — 🟢 روشن',
    `⚙️ پردازنده: ${fa(cpu.usage)}٪ (${fa(cpu.count)} هسته)`,
    `🧠 حافظه: ${fa(mem.usage)}٪ — ${gb(mem.used)} از ${gb(mem.total)}`,
    ...disks.slice(0, 4).map((d) => `💽 ${d.mount}: ${fa(d.usage)}٪ — ${gb(d.free)} خالی${d.usage >= 90 ? ' ⚠️' : ''}`),
    `⏱ روشن از ${fa(Math.floor(os.uptime() / 3600))} ساعت پیش`,
    `🌐 سایت‌ها: ${fa(up)} روشن از ${fa(sites.length)}`,
    `🗄 سرورِ حساب: ${cloud}`,
  ];
  return lines.join('\n');
}

function sitesMessage() {
  const sites = listSitesRaw();
  if (!sites.length) return { text: 'هیچ سایتی ثبت نشده.' };
  const rows = sites.slice(0, 30).map((s) => {
    const on = isRunning(s.slug);
    return [
      { text: `${on ? '🟢' : '⚪️'} ${s.name}`.slice(0, 40), callback_data: 'noop' },
      on ? btn('🔄', { k: 'site', id: s.id, op: 'restart' }) : btn('▶', { k: 'site', id: s.id, op: 'start' }),
      ...(on ? [btn('⏹', { k: 'site', id: s.id, op: 'stop' })] : []),
    ];
  });
  return { text: `🌐 سایت‌ها (${fa(sites.length)})\n🔄 ری‌استارت · ▶ روشن · ⏹ خاموش`, reply_markup: { inline_keyboard: rows } };
}

async function expiringMessage(only = null) {
  const soon = Date.now() + 7 * DAY;
  const list = [];
  for (const app of only ? [only] : ['pump', 'shop']) {
    try { list.push(...(await search(app, '', 200)).filter((a) => ['active', 'trial'].includes(a.status) && a.endsAt && a.endsAt <= soon)); } catch { /* یک برنامه خاموش، بقیه می‌آید */ }
  }
  list.sort((x, y) => x.endsAt - y.endsAt);
  if (!list.length) return { text: '✅ در ۷ روزِ آینده اشتراکی تمام نمی‌شود.' };
  return {
    text: `⏳ اشتراک‌هایی که تا ۷ روزِ دیگر تمام می‌شوند (${fa(list.length)}):`,
    reply_markup: { inline_keyboard: list.slice(0, 25).map((a) => [btn(`${APP[a.app]} ${a.name} — ${fa(daysLeft(a))} روز`.slice(0, 60), { k: 'card', app: a.app, tenantId: a.tenantId })]) },
  };
}

// ── کدِ اشتراکِ آفلاینِ پمپ (همان «اشتراک‌ها ← کدها ← پمپ‌بنزین»ِ پنل) ─────────
const wiz = () => { const w = getSetting(WIZ, null); return w && Date.now() - w.at < WIZ_MS ? w : null; };
const setWiz = (w) => { setSetting(WIZ, w ? { ...w, at: Date.now() } : null); if (w) inbox.setCompose(null); };
export const wizActive = () => !!wiz();

async function codesMessage() {
  const out = await cloudRaw('GET', '/api/admin/pump/offline-codes', { query: { limit: 10 } });
  const codes = out.codes || [];
  if (!codes.length) return { text: 'هنوز کدِ آفلاینی ساخته نشده. ‎/offline‎ برای ساختن.' };
  const stateOf = (c) => (c.status === 'revoked' ? '⛔ باطل' : !c.permanent && c.endsAt < Date.now() ? '⌛ منقضی' : '✅ فعال');
  return {
    text: ['🔑 ۱۰ کدِ آفلاینِ آخر', '', ...codes.map((c) => `${stateOf(c)} · ${c.planTitle || c.plan} · کامپیوترِ ${c.computer}${c.accountEmail ? ` · ${c.accountEmail}` : ''}${c.permanent ? ' · دائمی' : c.endsAt ? ` · تا ${dateFa(c.endsAt)}` : ''}${c.redeemedAt ? ' · سرور دید' : ''}${c.note ? ` · ${c.note}` : ''}`)].join('\n'),
    reply_markup: { inline_keyboard: codes.filter((c) => c.status !== 'revoked').slice(0, 10).map((c) => [btn(`⛔ باطل کن: ${c.computer}${c.note ? ` (${c.note})` : ''}`.slice(0, 60), { k: 'revoke', id: c.id, computer: c.computer })]) },
  };
}

const OFFLINE_START = '🔑 کدِ اشتراکِ آفلاینِ پمپ\n\nکدِ کامپیوترِ مشتری را بفرستید.\n(در برنامهٔ پمپ: پروفایل ← اشتراک و پلن‌ها)\n‎/cancel‎ برای انصراف';

/** پاسخِ قدمِ بعدیِ ساختنِ کد — true یعنی پیام مالِ همین بود. */
async function wizardStep(send, text) {
  const w = wiz();
  if (!w || text.startsWith('/')) return false;
  if (w.step === 'quick_add') {
    setWiz(null);
    inbox.addQuick(text);
    await send({ text: '✅ افزوده شد.' });
    await send(inbox.quickManage());
    return true;
  }
  if (w.step === 'bc_text') {
    setWiz(null);
    const body = text.slice(0, 4000);
    const yes = btn('📤 بله، بفرست', { k: 'bcSend', app: w.app, target: w.target, body });
    await send({ text: `📣 پیش‌نمایش — ${inbox.BC_APPS[w.app]} · ${inbox.BC_TARGETS[w.target]}\n\n${body}\n\nبه همه فرستاده شود؟`, reply_markup: { inline_keyboard: [[{ ...yes, callback_data: yes.callback_data.replace(/^a:/, 'y:') }]] } });
    return true;
  }
  if (w.step === 'computer') {
    const computer = text.replace(/\s+/g, '').toUpperCase();
    if (!COMPUTER_RE.test(computer)) { await send({ text: '❌ کدِ کامپیوتر فقط حرف و رقم و خطِ تیره است (۴ تا ۴۰). دوباره بفرستید یا ‎/cancel‎.' }); return true; }
    setWiz({ step: 'account', computer });
    await send({ text: `کامپیوتر: ${computer}\n\nایمیلِ حسابِ مشتری را بفرستید تا کد فقط به همان حساب بخورد،\nیا «-» برای هر حساب.` });
    return true;
  }
  if (w.step === 'account') {
    const account = text === '-' || text === '—' ? '' : text.toLowerCase();
    if (account && !EMAIL_RE.test(account)) { await send({ text: '❌ ایمیل درست نیست. دوباره بفرستید، یا «-» برای هر حساب.' }); return true; }
    setWiz(null);
    await send({
      text: `کامپیوتر: ${w.computer}\nحساب: ${account || 'هر حساب'}\n\nکدام پلن؟`,
      reply_markup: { inline_keyboard: [OFFLINE_PLANS.map((p) => btn(`${p.title}${p.days ? ` · ${fa(p.days)} روز` : ''}`, { k: 'offline', computer: w.computer, account, plan: p.code, planTitle: p.title, days: p.days }))] },
    });
    return true;
  }
  return false;
}

async function sendOffline(tok, chatId, out) {
  const o = out.offline || {};
  const msg = `کدِ اشتراکِ آفلاینِ برنامهٔ پمپ بنزین (${o.planTitle || o.plan}${o.permanent ? '' : o.endsAt ? ` تا ${dateFa(o.endsAt)}` : ''}) — فقط برای کامپیوترِ ${o.computer}:\n\n${out.code}\n\nدر برنامه: پروفایل ← اشتراک و پلن‌ها ← کدِ اشتراکِ آفلاین ← چسباندن و «ثبتِ کد».`;
  const tgSend = (body) => tgFile(tok, 'sendDocument', { chat_id: chatId, caption: '📎 فایلِ ‎.pumpkey‎ — همین را هم می‌شود برای مشتری فرستاد', ...body },
    { name: `pump-${o.computer}.pumpkey`, data: JSON.stringify(out.file || {}, null, 2), type: 'application/json' });
  return { msg, tgSend };
}

//  پیشنهادِ دستورها در تلگرام («/» را که بزنید) — فقط برای گفت‌وگوی مالک
export const COMMANDS = [
  ['start', 'منوی اصلی'], ['pump', 'منوی پمپ بنزین'], ['shop', 'منوی فروشگاه'], ['sites', 'منوی سایت‌ها'], ['server', 'منوی سرور'], ['inbox', 'گفت‌وگوهای منتظرِ جواب'], ['find', 'جست‌وجوی حساب'], ['expiring', 'اشتراک‌های رو به پایان'],
  ['offline', 'کدِ اشتراکِ آفلاینِ پمپ'], ['codes', 'کدهای آفلاین و باطل کردن'], ['status', 'وضعیتِ سرور'],
  ['update', 'آپدیتِ کنترول سنتر'], ['report', 'گزارشِ امروز'], ['broadcast', 'پیامِ همگانی'], ['quick', 'جواب‌های آماده'], ['settings', 'تنظیماتِ ربات'],
  ['done', 'پایانِ «در حالِ نوشتن»'], ['cancel', 'انصراف'], ['logout', 'خروج'],
].map(([command, description]) => ({ command, description }));

const MENU_TEXT = [
  '🤖 رباتِ کنترول سنتر — راهنما',
  '',
  'پایینِ صفحه منوی شماست و هر بخش منوی خودش را دارد:',
  '⛽ پمپ بنزین — پیام‌ها، جست‌وجو، اشتراک‌ها، کدِ آفلاین، آپدیتِ برنامه، پیامِ همگانی، گزارش',
  '🛒 فروشگاه — پیام‌ها، جست‌وجو، اشتراک‌ها، پیامِ همگانی، گزارش',
  '🌐 سایت‌ها — هر سایت: گفت‌وگوها، وضعیت، ری‌استارت، روشن/خاموش؛ و آپدیتِ سایت‌ها',
  '🛠 سرور — وضعیت، آپدیتِ کنترول سنتر، سرورِ حساب، پشتیبان، کارهای خودکار، تونل، خطاها، ری‌استارت',
  '',
  '💬 پیامِ هر کاربر همان لحظه این‌جا می‌آید (با عکس و صدا). زیرش: ✍️ جواب · ⚡ آماده · 💬 گفت‌وگو · 👤 حساب · ✅ بستن. یا روی خودِ پیام Reply بزنید.',
  '🔎 هر متنی که بی Reply بنویسید جست‌وجوی حساب است — در منوی پمپ فقط پمپ‌ها، در فروشگاه فقط فروشگاه‌ها.',
  '🟢 پیامِ سنجاق‌شدهٔ بالا یعنی سرور روشن است. «/» همهٔ دستورها را پیشنهاد می‌کند.',
].join('\n');

// ── دکمه‌های منوی پایینِ صفحه ────────────────────────────────────────────
async function handleKey(key, send) {
  const ctx = { reportText, statusText };
  switch (key.a) {
    case 'menu': {
      menus.setMenu(key.to, key.siteId || null);
      await send({ text: (await menus.menuText(key.to, ctx)).slice(0, 4000), reply_markup: menus.keyboardFor(key.to) });
      return true;
    }
    case 'help': await send({ text: MENU_TEXT, reply_markup: menus.keyboardFor() }); return true;
    case 'start': menus.setMenu('main'); await send({ text: MENU_TEXT, reply_markup: menus.keyboardFor('main') }); return true;
    case 'inbox': await send(await inbox.inboxMessage(key.app ? { app: key.app } : {})); return true;
    case 'find': await send({ text: `🔎 نام، ایمیل، شماره یا کدِ ${key.app === 'pump' ? 'پمپ' : key.app === 'shop' ? 'فروشگاه' : 'حساب'} را بنویسید و بفرستید.` }); return true;
    case 'expiring': await send(await expiringMessage(key.app || null)); return true;
    case 'offline': setWiz({ step: 'computer' }); await send({ text: OFFLINE_START }); return true;
    case 'codes': await send(await codesMessage()); return true;
    case 'broadcast': await send(key.app ? inbox.broadcastTargets(key.app) : inbox.broadcastStart()); return true;
    case 'report': await send({ text: await reportText(key.app || null) }); return true;
    case 'settings': await send(settingsMessage()); return true;
    case 'status': await send({ text: await statusText() }); return true;
    case 'sv': await send(await serverPage(key.p)); return true;
    case 'panelRestart': {
      const act = { k: 'svDo', op: 'panelRestart' };
      const yes = btn('✅ بله، انجام بده', act);
      await send({ text: confirmServer(act), reply_markup: { inline_keyboard: [[{ ...yes, callback_data: yes.callback_data.replace(/^a:/, 'y:') }]] } });
      return true;
    }
    case 'siteChats': case 'siteInfo': case 'siteOp': {
      const site = menus.currentSite();
      if (!site) { menus.setMenu('sites'); await send({ text: 'اول یک سایت را بزنید.', reply_markup: menus.keyboardFor('sites') }); return true; }
      if (key.a === 'siteChats') await send(await inbox.inboxMessage({ app: 'site', slug: site.slug }));
      else if (key.a === 'siteInfo') await send({ text: menus.siteInfo(site) });
      else await send(menus.siteOpConfirm(site, key.op));
      return true;
    }
    default: return false;
  }
}

// ── پیامِ مالک (نه Reply) ──────────────────────────────────────────────
export async function handleCommand(tg, tok, chatId, m) {
  const text = String(m.text || '').trim();
  if (!text) return false;
  const send = (body) => tg(tok, 'sendMessage', { chat_id: chatId, reply_to_message_id: m.message_id, disable_web_page_preview: true, ...body });
  if (/^\/(cancel|done)(@\w+)?$/i.test(text)) {
    const c = inbox.compose();
    setWiz(null); inbox.setCompose(null);
    await send({ text: c ? `✅ نوشتن به ${c.label} تمام شد.` : 'لغو شد.', reply_markup: menus.keyboardFor() });
    return true;
  }
  const key = menus.resolveKey(text);
  // ⛔ دکمهٔ منو = تغییرِ کار ⇒ «در حالِ نوشتن» و پرسش‌های نیمه‌کاره بسته می‌شوند
  if (key) { setWiz(null); inbox.setCompose(null); return handleKey(key, send); }
  if (await wizardStep(send, text)) return true;
  const cmd = /^\/(\w+)(?:@\w+)?\s*(.*)$/s.exec(text);
  const name = cmd ? cmd[1].toLowerCase() : '';
  const SLASH = { pump: { a: 'menu', to: 'pump' }, shop: { a: 'menu', to: 'shop' }, sites: { a: 'menu', to: 'sites' }, server: { a: 'menu', to: 'server' }, start: { a: 'start' }, menu: { a: 'menu', to: 'main' }, help: { a: 'help' }, inbox: { a: 'inbox' }, report: { a: 'report' }, settings: { a: 'settings' }, broadcast: { a: 'broadcast' }, expiring: { a: 'expiring' }, status: { a: 'status' }, update: { a: 'sv', p: 'panel' } };
  if (SLASH[name] && !(name === 'find')) { setWiz(null); inbox.setCompose(null); return handleKey(SLASH[name], send); }
  if (name === 'find' && !(cmd && cmd[2].trim())) return handleKey({ a: 'find', app: menus.menuApp() }, send);
  if (name === 'quick') { await send(inbox.quickManage()); return true; }
  if (name === 'offline') { setWiz({ step: 'computer' }); await send({ text: OFFLINE_START }); return true; }
  if (name === 'codes') { await send(await codesMessage()); return true; }
  const q = (name === 'find' ? cmd[2] : cmd ? '' : text).trim().slice(0, 60);
  if (!q) { await send({ text: `دستورِ «${text.slice(0, 30)}» را نمی‌شناسم.\n\n${MENU_TEXT}`, reply_markup: menus.keyboardFor() }); return true; }
  const found = [];
  const only = menus.menuApp();
  for (const app of only ? [only] : ['pump', 'shop']) {
    try { found.push(...await search(app, q, 6)); } catch (e) { await send({ text: `⚠️ ${APP[app]}: ${e.message}` }); }
  }
  if (!found.length) { await send({ text: `🔎 «${q}» — حسابی پیدا نشد.\n(برای جواب به کاربر، روی پیامِ خودِ او Reply یا «✍️ جواب» بزنید.)` }); return true; }
  if (found.length > 8) await send({ text: `🔎 ${fa(found.length)} حساب پیدا شد؛ ۸ تای اول — برای دقیق‌تر، ایمیل یا کد را بنویسید.` });
  for (const a of found.slice(0, 8)) await send({ text: cardText(a), reply_markup: cardKeys(a) });
  return true;
}

// ── دکمه‌ها ────────────────────────────────────────────────────────────
const CONFIRM = new Set(['extend', 'status', 'grant', 'site', 'offline', 'revoke', 'quickSend', 'quickDel', 'bcSend']);

function confirmText(a) {
  if (a.k === 'extend') return `➕ ${fa(a.amount)} ${UNIT[a.unit] || a.unit} به این اشتراک اضافه شود؟`;
  if (a.k === 'status') return { active: '▶ این اشتراک دوباره فعال شود؟', suspended: '⏸ این اشتراک معلق شود؟ برنامهٔ کاربر قفل می‌شود.', cancelled: '✖ این اشتراک لغو شود؟ روزهای مانده صفر می‌شود.' }[a.status] || 'انجام شود؟';
  if (a.k === 'grant') return `🎁 پلنِ «${a.planName || a.plan}» به این حساب داده شود؟`;
  if (a.k === 'offline') return `🔑 کدِ آفلاینِ «${a.planTitle}»${a.days ? ` (${fa(a.days)} روز)` : ''} برای کامپیوترِ ${a.computer}${a.account ? ` و حسابِ ${a.account}` : ''} ساخته شود؟`;
  if (a.k === 'revoke') return `⛔ کدِ آفلاینِ کامپیوترِ ${a.computer} باطل شود؟ (روی کامپیوتری که هرگز آنلاین نشود تا پایانِ مهلتش اثر ندارد)`;
  if (a.k === 'quickSend') return `⚡ این جواب به ${a.label} برود؟\n\n«${a.text}»`;
  if (a.k === 'quickDel') return `🗑 این جوابِ آماده پاک شود؟\n\n«${a.text}»`;
  if (a.k === 'bcSend') return `📣 به ${inbox.BC_APPS[a.app]} · ${inbox.BC_TARGETS[a.target]} فرستاده شود؟`;
  if (a.k === 'site') return `${{ restart: '🔄 ری‌استارت', start: '▶ روشن کردنِ', stop: '⏹ خاموش کردنِ' }[a.op]} سایتِ «${a.siteName || ''}»؟`;
  return 'انجام شود؟';
}

async function run(a) {
  if (a.k === 'extend') await extendSubscription(a.app, a.subId, a.amount, a.unit, ACTOR);
  else if (a.k === 'status') await setSubscriptionStatus(a.app, a.subId, a.status, ACTOR);
  else if (a.k === 'grant') await grantSubscription(a.app, a.tenantId, { plan: a.plan, note: 'از رباتِ تلگرام' }, ACTOR);
  else if (a.k === 'revoke') await revokeOfflineCode(a.id, ACTOR);
  else if (a.k === 'site') {
    const site = getSite(a.id);
    if (!site) throw new Error('سایت پیدا نشد');
    const r = await ({ restart: restartSite, start: startSite, stop: stopSite }[a.op])(site);
    if (r && r.ok === false) throw new Error(r.error || r.message || 'نشد');
  }
}

export async function handleCallback(tg, tok, chatId, cq) {
  const answer = (text) => tg(tok, 'answerCallbackQuery', { callback_query_id: cq.id, ...(text ? { text: String(text).slice(0, 190) } : {}) }).catch(() => {});
  const msg = cq.message;
  if (!msg || String(msg.chat && msg.chat.id) !== chatId) { await answer('اجازه ندارید'); return; } // ⛔ فقط مالک
  const data = String(cq.data || '');
  if (data === 'noop') { await answer(); return; }
  const m = /^([ay]):([A-Za-z0-9_-]{4,16})$/.exec(data);
  const a = m && actOf(m[2]);
  if (!a) { await answer('این دکمه کهنه شده؛ دوباره بگردید'); return; }
  const edit = (body) => tg(tok, 'editMessageText', { chat_id: chatId, message_id: msg.message_id, disable_web_page_preview: true, ...body })
    .catch(() => tg(tok, 'sendMessage', { chat_id: chatId, disable_web_page_preview: true, ...body }));
  // دکمه‌ای که در تاپیکِ صندوق زده شد ⇒ جواب در همان تاپیک
  const thread = msg.message_thread_id ? { message_thread_id: msg.message_thread_id } : {};
  const send = (body) => tg(tok, 'sendMessage', { chat_id: chatId, disable_web_page_preview: true, ...thread, ...body });
  try {
    if (a.k === 'srv') { await answer(); await send({ text: await statusText() }); return; }
    if (a.k === 'conv') { await answer(); await send(await inbox.conversation(a.ref)); return; }
    if (a.k === 'compose') {
      setWiz(null);
      inbox.setCompose(a.ref, a.label);
      await answer('بنویسید…');
      await send({ text: `✍️ در حالِ نوشتن به ${a.label}\n\nهر پیامی که حالا بفرستید (متن، عکس، ویدیو، پیامِ صوتی) به همین کاربر می‌رود.\nبرای پایان ‎/done‎ یا یکی از دکمه‌های منو. (۱۰ دقیقه بی‌کاری ⇒ خودش تمام می‌شود)` });
      return;
    }
    if (a.k === 'quick') { await answer(); await send(inbox.quickPick(a.ref, a.label)); return; }
    if (a.k === 'quickManage') { await answer(); await send(inbox.quickManage()); return; }
    if (a.k === 'quickAdd') { await answer(); setWiz({ step: 'quick_add' }); await send({ text: '➕ متنِ جوابِ آمادهٔ تازه را بفرستید. (‎/cancel‎ برای انصراف)' }); return; }
    if (a.k === 'close' || a.k === 'reopen') {
      await inbox.setThreadStatus(a.ref, a.k === 'close' ? 'closed' : 'open');
      if (a.k === 'close') await topics.closeTopic(tg, tok, a.ref); else await topics.reopenTopic(tg, tok, a.ref);
      await answer(a.k === 'close' ? '✅ بسته شد' : '↩️ باز شد');
      await send({ text: a.k === 'close' ? `✅ گفت‌وگوی ${a.label} بسته شد. اگر کاربر دوباره بنویسد در صندوق برمی‌گردد.` : `↩️ گفت‌وگوی ${a.label} دوباره باز شد.` });
      return;
    }
    if (a.k === 'bcApp') { await answer(); await send(inbox.broadcastTargets(a.app)); return; }
    if (a.k === 'bcTarget') { await answer(); setWiz({ step: 'bc_text', app: a.app, target: a.target }); await send({ text: `📣 ${inbox.BC_APPS[a.app]} · ${inbox.BC_TARGETS[a.target]}\n\nمتنِ پیام را بفرستید. پیش از فرستادن پیش‌نمایش می‌بینید. (‎/cancel‎ برای انصراف)` }); return; }
    if (a.k === 'pref') { setPrefs(a.patch || {}); await answer('ذخیره شد'); await edit(settingsMessage()); return; }
    if (a.k === 'sv') { await answer(); await send(await serverPage(a.p)); return; }
    if (a.k === 'svDo') {
      if (needsConfirm(a) && m[1] === 'a') {
        await answer();
        const yes = btn('✅ بله، انجام بده', a);
        await send({ text: confirmServer(a), reply_markup: { inline_keyboard: [[{ ...yes, callback_data: yes.callback_data.replace(/^a:/, 'y:') }]] } });
        return;
      }
      // ⛔ تأیید یک بار: پیش از کار پاک می‌شود
      if (needsConfirm(a)) { const all = acts(); delete all[m[2]]; setSetting(ACTS, all); }
      await answer('در حالِ انجام…');
      await send(await runServer(a, { tg, tok, chatId }));
      return;
    }
    if (a.k === 'inbox') { await answer(); await send(await inbox.inboxMessage()); return; }
    if (a.k === 'sites') { await answer(); await send(sitesMessage()); return; }
    if (a.k === 'expiring') { await answer(); await send(await expiringMessage()); return; }
    if (a.k === 'offlineStart') { await answer(); setWiz({ step: 'computer' }); await send({ text: OFFLINE_START }); return; }
    if (a.k === 'codes') { await answer(); await send(await codesMessage()); return; }
    if (a.k === 'card') { await answer(); const acc = await accountOf(a.app, a.tenantId); await send({ text: cardText(acc), reply_markup: cardKeys(acc) }); return; }
    if (a.k === 'plans') {
      await answer();
      const out = await cloudRaw('GET', '/api/admin/plans', { query: { app: a.app } });
      const plans = (out.plans || []).filter((p) => (p.active === true || p.active === 1) && !/^free$/i.test(p.code));
      if (!plans.length) { await send({ text: 'پلنِ فعالی برای این برنامه نیست؛ از پنلِ کنترول سنتر بسازید.' }); return; }
      await send({
        text: '🎁 کدام پلن؟ (مدت از خودِ پلن است؛ اگر اشتراکِ فعلی هنوز اعتبار دارد از پایانِ آن جلو می‌رود)',
        reply_markup: { inline_keyboard: plans.slice(0, 12).map((p) => [btn(`${p.name || p.code}${p.amount && p.unit ? ` — ${fa(p.amount)} ${UNIT[p.unit] || p.unit}` : ''}`.slice(0, 60), { k: 'grant', app: a.app, tenantId: a.tenantId, plan: p.code, planName: p.name || p.code })]) },
      });
      return;
    }
    if (a.k === 'site' && !a.siteName) a.siteName = (getSite(a.id) || {}).name || '';
    if (CONFIRM.has(a.k) && m[1] === 'a') {
      await answer();
      const yes = btn('✅ بله، انجام بده', a);
      await send({ text: confirmText(a), reply_markup: { inline_keyboard: [[{ ...yes, callback_data: yes.callback_data.replace(/^a:/, 'y:') }]] } });
      return;
    }
    if (!CONFIRM.has(a.k)) { await answer(); return; }
    // ⛔ دکمهٔ تأیید یک بار: پیش از کار پاک می‌شود ⇒ دو بار زدن دو بار تمدید نمی‌کند
    const all = acts(); delete all[m[2]]; setSetting(ACTS, all);
    await answer('در حالِ انجام…');
    if (a.k === 'offline') {
      // ⛔ خودِ کد فقط در تلگرامِ مالک — نه در لاگ، نه در دفترِ ممیزی
      const out = await createOfflineCode({ plan: a.plan, computer: a.computer, account: a.account, days: a.days, note: 'از رباتِ تلگرام' }, ACTOR);
      const { msg, tgSend } = await sendOffline(tok, chatId, out);
      await edit({ text: '✅ کد ساخته شد. پیامِ زیر را برای مشتری Forward کنید:' });
      await send({ text: msg });
      await tgSend({}).catch((e) => send({ text: `⚠️ فایلِ ‎.pumpkey‎ نرفت: ${e.message}` }));
      return;
    }
    if (a.k === 'quickSend') { await inbox.replyTo(tok, a.ref, { text: a.text }); await edit({ text: `✅ به ${a.label} رسید:\n«${a.text}»` }); return; }
    if (a.k === 'quickDel') { inbox.removeQuick(inbox.quickList().indexOf(a.text)); await edit({ text: '🗑 پاک شد.' }); await send(inbox.quickManage()); return; }
    if (a.k === 'bcSend') {
      const out = await inbox.broadcastSend(a.app, a.target, a.body);
      await edit({ text: `✅ پیامِ همگانی به ${fa(Number(out.sent) || 0)} نفر رسید${Number(out.failed) ? ` (${fa(out.failed)} نرسید)` : ''}.` });
      return;
    }
    await run(a);
    if (a.k === 'revoke') { await edit({ text: `✅ کدِ کامپیوترِ ${a.computer} باطل شد.` }); return; }
    if (a.k === 'site') { await edit({ text: `✅ انجام شد: ${confirmText(a).replace(/؟$/, '')}` }); await send(sitesMessage()); return; }
    const acc = await accountOf(a.app, a.tenantId);
    await edit({ text: `✅ انجام شد.\n\n${cardText(acc)}`, reply_markup: cardKeys(acc) });
  } catch (e) {
    await answer('نشد');
    await send({ text: `⚠️ نشد: ${String(e.message || e).slice(0, 300)}` }).catch(() => {});
  }
}
