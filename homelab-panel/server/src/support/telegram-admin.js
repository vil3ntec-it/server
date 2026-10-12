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
import { grantSubscription, extendSubscription, setSubscriptionStatus } from '../routes/account-admin.js';

const ACTS = 'support_tg_acts';
const ACTS_MAX = 400;
const ACT_TTL = 24 * 3600e3;
const DAY = 24 * 3600e3;
const APP = { pump: '🛢 پمپ', shop: '🛒 فروشگاه' };
const STATUS = { active: '✅ فعال', trial: '🎁 آزمایشی', suspended: '⏸ معلق', cancelled: '✖ لغو شده', canceled: '✖ لغو شده', expired: '⌛ منقضی', none: '— بی اشتراک' };
const UNIT = { day: 'روز', week: 'هفته', month: 'ماه', year: 'سال' };
const ACTOR = 'telegram';

const fa = (n) => Number(n).toLocaleString('fa-IR');
const dateFa = (ms) => { try { return new Date(ms).toLocaleDateString('fa-IR-u-ca-persian'); } catch { return new Date(ms).toISOString().slice(0, 10); } };
const gb = (b) => `${(Number(b) / 1024 ** 3).toFixed(1)}GB`;

// ── دکمه‌ها: نشانیِ تصادفی ⇒ کارِ واقعی ─────────────────────────────────
function acts() {
  const a = getSetting(ACTS, null);
  return a && typeof a === 'object' ? a : {};
}
function btn(text, act) {
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
async function search(app, q, limit = 8) {
  if (app === 'pump') {
    const out = await cloudRaw('GET', '/api/admin/pump/stations', { query: { q, limit } });
    return (out.stations || []).map((s) => ({
      app, tenantId: s.id, name: s.name || '', code: s.code || '', ownerName: s.owner_name || '', ownerEmail: s.owner_email || '', ownerPhone: s.owner_phone || '',
      subscriptionId: s.subscription_id || '', plan: s.plan || '', status: s.sub_status || 'none', endsAt: Number(s.ends_at) || 0,
    }));
  }
  const out = await cloudRaw('GET', '/api/admin/shops', { query: { q, limit } });
  return (out.shops || []).map((s) => ({
    app, tenantId: s.id, name: s.name || '', code: '', ownerName: s.owner_name || '', ownerEmail: s.owner_email || '', ownerPhone: s.owner_phone || '',
    subscriptionId: s.subscription_id || '', plan: s.plan || '', status: s.sub_status || 'none', endsAt: Number(s.ends_at) || 0,
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

function daysLeft(a) {
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
async function statusText() {
  const cpu = readCpu();
  const mem = await readMemory();
  const disks = ((await readDisks().catch(() => null)) || {}).disks || [];
  const sites = listSitesRaw();
  const up = sites.filter((s) => isRunning(s.slug)).length;
  let cloud = '❌ پاسخ نداد';
  //  ⚠️ cloudRaw فقط `/api/admin/…` را باز می‌کند؛ سبک‌ترین درِ مدیر = ورود هم سنجیده می‌شود
  try { await cloudRaw('GET', '/api/admin/support/threads', { query: { limit: 1 } }); cloud = '✅ روشن'; } catch (e) { cloud = `❌ ${String(e.message).slice(0, 80)}`; }
  const lines = [
    '🖥 وضعیتِ سرور',
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

async function expiringMessage() {
  const soon = Date.now() + 7 * DAY;
  const list = [];
  for (const app of ['pump', 'shop']) {
    try { list.push(...(await search(app, '', 200)).filter((a) => ['active', 'trial'].includes(a.status) && a.endsAt && a.endsAt <= soon)); } catch { /* یک برنامه خاموش، بقیه می‌آید */ }
  }
  list.sort((x, y) => x.endsAt - y.endsAt);
  if (!list.length) return { text: '✅ در ۷ روزِ آینده اشتراکی تمام نمی‌شود.' };
  return {
    text: `⏳ اشتراک‌هایی که تا ۷ روزِ دیگر تمام می‌شوند (${fa(list.length)}):`,
    reply_markup: { inline_keyboard: list.slice(0, 25).map((a) => [btn(`${APP[a.app]} ${a.name} — ${fa(daysLeft(a))} روز`.slice(0, 60), { k: 'card', app: a.app, tenantId: a.tenantId })]) },
  };
}

const MENU_TEXT = [
  '🤖 رباتِ کنترول سنتر',
  '',
  '💬 پیامِ کاربرانِ پمپ، فروشگاه و سایت‌ها خودش این‌جا می‌آید. برای جواب، روی همان پیام Reply بزنید؛ جواب به همان حساب و همان پشتیبانی می‌رود.',
  '👤 زیرِ هر پیامِ کاربر دکمهٔ «حساب» هست: اشتراک، تمدید، تعلیق.',
  '🔎 برای پیدا کردنِ هر حساب فقط نام، ایمیل، شماره یا کدش را بنویسید.',
  '',
  '/status وضعیتِ سرور',
  '/sites سایت‌ها و ری‌استارت',
  '/expiring اشتراک‌هایی که به‌زودی تمام می‌شوند',
].join('\n');
const MENU_KEYS = () => ({ inline_keyboard: [[btn('🖥 وضعیتِ سرور', { k: 'srv' }), btn('🌐 سایت‌ها', { k: 'sites' })], [btn('⏳ اشتراک‌های رو به پایان', { k: 'expiring' })]] });

/** دکمهٔ «👤 حساب» زیرِ پیامِ کاربرِ پمپ/فروشگاه. */
export function threadKeys(t) {
  const tenantId = t.app === 'pump' ? t.stationId : t.shopId;
  if (!tenantId || !APP[t.app]) return undefined;
  return { inline_keyboard: [[btn('👤 حساب و اشتراک', { k: 'card', app: t.app, tenantId })]] };
}

// ── پیامِ مالک (نه Reply) ──────────────────────────────────────────────
export async function handleCommand(tg, tok, chatId, m) {
  const text = String(m.text || '').trim();
  if (!text) return false;
  const send = (body) => tg(tok, 'sendMessage', { chat_id: chatId, reply_to_message_id: m.message_id, disable_web_page_preview: true, ...body });
  const cmd = /^\/(\w+)(?:@\w+)?\s*(.*)$/s.exec(text);
  const name = cmd ? cmd[1].toLowerCase() : '';
  if (['start', 'menu', 'help'].includes(name)) { await send({ text: MENU_TEXT, reply_markup: MENU_KEYS() }); return true; }
  if (name === 'status') { await send({ text: await statusText() }); return true; }
  if (name === 'sites') { await send(sitesMessage()); return true; }
  if (name === 'expiring') { await send(await expiringMessage()); return true; }
  const q = (name === 'find' ? cmd[2] : cmd ? '' : text).trim().slice(0, 60);
  if (!q) { await send({ text: MENU_TEXT, reply_markup: MENU_KEYS() }); return true; }
  const found = [];
  for (const app of ['pump', 'shop']) {
    try { found.push(...await search(app, q, 6)); } catch (e) { await send({ text: `⚠️ ${APP[app]}: ${e.message}` }); }
  }
  if (!found.length) { await send({ text: `🔎 «${q}» — حسابی پیدا نشد.\n(برای جواب به کاربر، روی پیامِ خودِ او Reply بزنید.)` }); return true; }
  for (const a of found.slice(0, 8)) await send({ text: cardText(a), reply_markup: cardKeys(a) });
  return true;
}

// ── دکمه‌ها ────────────────────────────────────────────────────────────
const CONFIRM = new Set(['extend', 'status', 'grant', 'site']);

function confirmText(a) {
  if (a.k === 'extend') return `➕ ${fa(a.amount)} ${UNIT[a.unit] || a.unit} به این اشتراک اضافه شود؟`;
  if (a.k === 'status') return { active: '▶ این اشتراک دوباره فعال شود؟', suspended: '⏸ این اشتراک معلق شود؟ برنامهٔ کاربر قفل می‌شود.', cancelled: '✖ این اشتراک لغو شود؟ روزهای مانده صفر می‌شود.' }[a.status] || 'انجام شود؟';
  if (a.k === 'grant') return `🎁 پلنِ «${a.planName || a.plan}» به این حساب داده شود؟`;
  if (a.k === 'site') return `${{ restart: '🔄 ری‌استارت', start: '▶ روشن کردنِ', stop: '⏹ خاموش کردنِ' }[a.op]} سایتِ «${a.siteName || ''}»؟`;
  return 'انجام شود؟';
}

async function run(a) {
  if (a.k === 'extend') await extendSubscription(a.app, a.subId, a.amount, a.unit, ACTOR);
  else if (a.k === 'status') await setSubscriptionStatus(a.app, a.subId, a.status, ACTOR);
  else if (a.k === 'grant') await grantSubscription(a.app, a.tenantId, { plan: a.plan, note: 'از رباتِ تلگرام' }, ACTOR);
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
  const send = (body) => tg(tok, 'sendMessage', { chat_id: chatId, disable_web_page_preview: true, ...body });
  try {
    if (a.k === 'srv') { await answer(); await send({ text: await statusText() }); return; }
    if (a.k === 'sites') { await answer(); await send(sitesMessage()); return; }
    if (a.k === 'expiring') { await answer(); await send(await expiringMessage()); return; }
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
    await run(a);
    if (a.k === 'site') { await edit({ text: `✅ انجام شد: ${confirmText(a).replace(/؟$/, '')}` }); await send(sitesMessage()); return; }
    const acc = await accountOf(a.app, a.tenantId);
    await edit({ text: `✅ انجام شد.\n\n${cardText(acc)}`, reply_markup: cardKeys(acc) });
  } catch (e) {
    await answer('نشد');
    await send({ text: `⚠️ نشد: ${String(e.message || e).slice(0, 300)}` }).catch(() => {});
  }
}
