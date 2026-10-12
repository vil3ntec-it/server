// ---------------------------------------------------------------------------
//  🛠 مدیریتِ سرور از رباتِ مالک — همان پنل، در تلگرام (از ۱۴۰۵/۰۷/۲۰، نسخه 1.50.53)
//
//  خواستهٔ صاحب سامانه: «تمامِ سرور از این طریق کنترل شود، حتی دستور بدهم که
//  به‌روزرسانی شود… انگار همان سرور را می‌آوری توی بات.»
//
//      ⬆️ آپدیتِ کنترول سنتر   بررسی · نصب · برگشت به نسخهٔ قبل · نصبِ خودکار روشن/خاموش
//      🗄 سرورِ حساب            حال · ری‌استارت · آپدیت
//      ⛽ آپدیتِ برنامهٔ پمپ     بپرس از گیت‌هاب · انتشار · نگه‌دار/خودکار
//      🌐 آپدیتِ سایت‌ها         بپرس از گیت‌هاب
//      💾 پشتیبان‌ها             فهرست · پشتیبانِ تازه
//      ⚙️ کارهای خودکار          فهرست · اجرای همین حالا
//      🌍 تونل و دامنه           حال · تعمیر
//      📜 خطاهای اخیر            ۱۵ خطا/هشدارِ آخرِ لاگ
//      🔄 ری‌استارتِ کنترول سنتر
//
//  ⛔ هیچ راهِ دومی ساخته نشد: هر دکمه همان تابعی را صدا می‌زند که دکمهٔ پنل
//     (`installLatest`، `rollback`، `restartAccountServer`، `apply`، `setMode`،
//     `publish`، `createBackup`، `runJob`، `repairTunnel`، `scheduleRestart`).
//  ⛔ هر کارِ برگشت‌ناپذیر یا خاموش‌کننده دو قدم است (دکمه ⇒ «✅ بله»)؛ نصب و
//     دانلودهای طولانی پشتِ صحنه می‌روند و نتیجه‌شان جدا پیام می‌شود (کارِ ۵ ثانیه‌ایِ
//     `support-telegram` منتظرِ دانلودِ ۱۶۰ مگابایتی نمی‌ماند).
//  ⛔ برگرداندنِ پشتیبانِ دیتابیس از تلگرام نیست — آن فقط از پنل (پیش‌نمایش و هشدار).
// ---------------------------------------------------------------------------
import { db, setSetting } from '../db.js';
import { versionInfo } from '../version.js';
import { checkForUpdate, installLatest, rollback, updateStatus, autoInstallEnabled, scheduleRestart, installProgress } from '../update/github.js';
import { accountStatus, restartAccountServer } from '../account/supervisor.js';
import * as accountUpdater from '../account/updater.js';
import * as pumpMirror from '../pumpupdates/mirror.js';
import * as siteMirror from '../siteupdates/mirror.js';
import { createBackup, listBackups } from '../backup/index.js';
import { listJobs, runJob } from '../automation/engine.js';
import { publicState as tunnelState, repairTunnel } from '../tunnel.js';
import { audit } from '../control/audit.js';
import { btn, fa } from './telegram-admin.js';

const ACTOR = 'telegram';
const busy = new Set();
const clock = (ms) => (ms ? new Date(ms).toLocaleString('fa-IR', { hour: '2-digit', minute: '2-digit', month: 'numeric', day: 'numeric' }) : '—');
const mb = (b) => `${(Number(b || 0) / 1024 ** 2).toFixed(1)}MB`;
//  ⚠️ پرسش از گیت‌هاب گاهی بی‌جواب می‌ماند؛ صفحهٔ ربات نباید منتظرش بماند
const within = (p, ms, fallback) => Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))]);
const span = (ms) => { const m = Math.round(ms / 60e3); return m < 60 ? `${fa(m)} دقیقه` : m < 2880 ? `${fa(Math.floor(m / 60))} ساعت` : `${fa(Math.floor(m / 1440))} روز`; };

/**
 * کارِ طولانی پشتِ صحنه — یک بار در هر لحظه، نتیجه با پیامِ جدا.
 * @returns {boolean} false اگر همین کار از قبل در جریان است
 */
function background(key, tg, tok, chatId, fn) {
  if (busy.has(key)) return false;
  busy.add(key);
  const send = (text) => tg(tok, 'sendMessage', { chat_id: chatId, text: String(text).slice(0, 4000), disable_web_page_preview: true }).catch(() => {});
  Promise.resolve()
    .then(fn)
    .then((text) => text && send(text))
    .catch((e) => send(`⚠️ نشد: ${String(e && e.message || e).slice(0, 400)}`))
    .finally(() => busy.delete(key));
  return true;
}

export function serverMenu() {
  return {
    text: `🛠 مدیریتِ سرور — کنترول سنتر ${versionInfo.version}\n\nهمان کارهای پنل، از همین‌جا. کارهای برگشت‌ناپذیر تأیید می‌خواهند.`,
    reply_markup: {
      inline_keyboard: [
        [btn('⬆️ آپدیتِ کنترول سنتر', { k: 'sv', p: 'panel' }), btn('🗄 سرورِ حساب', { k: 'sv', p: 'account' })],
        [btn('⛽ آپدیتِ برنامهٔ پمپ', { k: 'sv', p: 'pump' }), btn('🌐 آپدیتِ سایت‌ها', { k: 'sv', p: 'siteup' })],
        [btn('💾 پشتیبان‌ها', { k: 'sv', p: 'backup' }), btn('⚙️ کارهای خودکار', { k: 'sv', p: 'jobs' })],
        [btn('🌍 تونل و دامنه', { k: 'sv', p: 'tunnel' }), btn('📜 خطاهای اخیر', { k: 'sv', p: 'logs' })],
        [btn('🔄 ری‌استارتِ کنترول سنتر', { k: 'svDo', op: 'panelRestart' })],
      ],
    },
  };
}

// ── صفحه‌ها ─────────────────────────────────────────────────────────────
async function panelPage() {
  const st = updateStatus();
  const prog = installProgress();
  let info = null;
  try { info = await within(checkForUpdate(), 15000, { error: 'گیت‌هاب در ۱۵ ثانیه جواب نداد' }); } catch (e) { info = { error: e.message }; }
  const lines = [
    '⬆️ آپدیتِ کنترول سنتر',
    '',
    `📦 نسخهٔ نصب‌شده: ${st.current}`,
    info && info.latest ? `🆕 تازه‌ترین روی گیت‌هاب: ${info.latest}${info.available ? ' — ✨ آمادهٔ نصب' : ' — ✅ به‌روز هستید'}` : `⚠️ گیت‌هاب: ${info && info.error ? info.error : 'جواب نداد'}`,
    `🤖 نصبِ خودکار (هر ساعت): ${autoInstallEnabled() ? '✅ روشن' : '⛔ خاموش'}`,
    st.lastBackup ? '↩️ برگشت به نسخهٔ قبل: ممکن است' : null,
    prog && prog.running ? `⏳ در حالِ نصب: ${prog.phase}${prog.total ? ` ${fa(Math.round((prog.got / prog.total) * 100))}٪` : ''}` : null,
  ].filter(Boolean);
  const rows = [];
  if (info && info.available) rows.push([btn(`⬇️ نصبِ ${info.latest}`, { k: 'svDo', op: 'panelInstall', version: info.latest })]);
  rows.push([btn('🔄 دوباره بپرس', { k: 'sv', p: 'panel' }), btn(autoInstallEnabled() ? '🔕 نصبِ خودکار خاموش' : '🔔 نصبِ خودکار روشن', { k: 'svDo', op: 'panelAuto', on: !autoInstallEnabled() })]);
  if (st.lastBackup) rows.push([btn('↩️ برگشت به نسخهٔ قبل', { k: 'svDo', op: 'panelRollback' })]);
  return { text: lines.join('\n'), reply_markup: { inline_keyboard: rows } };
}

async function accountPage() {
  const s = accountStatus();
  let up = null;
  try { up = await within(accountUpdater.check(), 15000, { ok: false, why: 'گیت‌هاب در ۱۵ ثانیه جواب نداد' }); } catch (e) { up = { ok: false, why: e.message }; }
  const lines = [
    '🗄 سرورِ حساب (پمپ و فروشگاه)',
    '',
    `${s.running ? '🟢 روشن' : '🔴 خاموش'}${s.running && s.uptimeMs ? ` — از ${span(s.uptimeMs)} پیش` : ''}`,
    `📦 نسخه: ${(up && up.current) || '—'}${up && up.ok && up.latest ? (up.available ? ` — 🆕 ${up.latest} آمادهٔ نصب` : ' — ✅ به‌روز') : ''}`,
    s.restarts ? `🔁 ری‌استارت‌های خودکار: ${fa(s.restarts)}` : null,
    s.lastError ? `⚠️ آخرین خطا: ${String(s.lastError).slice(0, 200)}` : null,
    !s.installed ? '⚠️ روی این کامپیوتر نصب نیست' : null,
  ].filter(Boolean);
  const rows = [[btn('🔄 ری‌استارت', { k: 'svDo', op: 'accountRestart' }), btn('🔄 تازه کن', { k: 'sv', p: 'account' })]];
  if (up && up.available) rows.unshift([btn(`⬇️ نصبِ ${up.latest}`, { k: 'svDo', op: 'accountInstall', version: up.latest })]);
  return { text: lines.join('\n'), reply_markup: { inline_keyboard: rows } };
}

async function pumpPage() {
  if (!pumpMirror.mirrorEnabled()) return { text: '⛽ آینهٔ آپدیتِ پمپ روی این نصب خاموش است.' };
  const s = await pumpMirror.status();
  const sy = s.syncing;
  const lines = [
    '⛽ آپدیتِ برنامهٔ پمپ (از همین سرور به همهٔ پمپ‌ها)',
    '',
    `📥 گرفته‌شده از گیت‌هاب: ${s.version || '—'}`,
    `📤 منتشرشده برای پمپ‌ها: ${s.served || '—'}${s.stable ? ` · پایدار: ${s.stable}` : ''}`,
    `🚦 حالت: ${s.mode === 'hold' ? '⏸ نگه‌دار (تا خودتان منتشر کنید)' : '▶ خودکار'}`,
    s.waiting ? `✨ ${s.version} منتظرِ انتشارِ شماست` : null,
    `🕒 آخرین پرسش: ${clock(s.checkedAt ? Date.parse(s.checkedAt) || s.checkedAt : 0)}`,
    s.error ? `⚠️ ${String(s.error).slice(0, 200)}` : null,
    sy ? `⏳ در حالِ دانلود: ${sy.version || ''} ${sy.total ? `${fa(Math.round((sy.got / sy.total) * 100))}٪` : ''}` : null,
  ].filter(Boolean);
  const rows = [[btn('🔄 بپرس از گیت‌هاب', { k: 'svDo', op: 'pumpCheck' }), btn('🔄 تازه کن', { k: 'sv', p: 'pump' })]];
  if (s.waiting && s.version) rows.unshift([btn(`📤 انتشارِ ${s.version} برای همهٔ پمپ‌ها`, { k: 'svDo', op: 'pumpPublish', version: s.version })]);
  rows.push([s.mode === 'hold' ? btn('▶ خودکار کن', { k: 'svDo', op: 'pumpMode', mode: 'auto' }) : btn('⏸ نگه‌دار', { k: 'svDo', op: 'pumpMode', mode: 'hold' })]);
  return { text: lines.join('\n'), reply_markup: { inline_keyboard: rows } };
}

function siteUpPage() {
  if (!siteMirror.siteMirrorEnabled()) return { text: '🌐 آینهٔ آپدیتِ سایت‌ها روی این نصب خاموش است.' };
  return {
    text: '🌐 آپدیتِ سایت‌ها\n\nکنترول سنتر هر ۱۰ دقیقه از گیت‌هاب می‌پرسد و سایت‌ها هر ساعت از همین سرور می‌گیرند.\n«همین حالا بپرس» دورِ بعد را جلو می‌اندازد.',
    reply_markup: { inline_keyboard: [[btn('🔄 همین حالا بپرس', { k: 'svDo', op: 'siteCheck' })]] },
  };
}

function backupPage() {
  const list = listBackups().slice(0, 6);
  return {
    text: ['💾 پشتیبان‌های کنترول سنتر', '', ...(list.length ? list.map((b) => `• ${clock(b.createdAt)} — ${mb(b.sizeBytes)}${b.reason ? ` (${b.reason})` : ''}`) : ['هنوز پشتیبانی نیست.']), '', 'برگرداندنِ پشتیبان فقط از پنل است (پیش‌نمایش و هشدار دارد).'].join('\n'),
    reply_markup: { inline_keyboard: [[btn('📦 پشتیبانِ تازه همین حالا', { k: 'svDo', op: 'backupNow' })]] },
  };
}

function jobsPage() {
  const jobs = listJobs().filter((j) => !j.quiet).slice(0, 20);
  const icon = (j) => (j.running ? '⏳' : !j.enabled ? '⏸' : j.last_status === 'ok' ? '✅' : j.last_status === 'failed' || j.last_status === 'timeout' ? '❌' : '•');
  return {
    text: ['⚙️ کارهای خودکار', '', ...jobs.map((j) => `${icon(j)} ${j.title || j.name}${j.last_run_at ? ` — ${clock(j.last_run_at)}` : ''}`)].join('\n').slice(0, 4000),
    reply_markup: { inline_keyboard: jobs.map((j) => [btn(`▶ ${j.title || j.name}`.slice(0, 60), { k: 'svDo', op: 'jobRun', name: j.name, title: j.title || j.name })]) },
  };
}

function tunnelPage() {
  const t = tunnelState();
  const lines = [
    '🌍 تونل و دامنه',
    '',
    `${t.status === 'running' || t.status === 'connected' || t.url ? '🟢' : '🔴'} وضعیت: ${t.status || '—'}`,
    t.hostname ? `🌐 دامنه: ${t.hostname}` : null,
    t.url ? `🔗 ${t.url}` : null,
    t.error ? `⚠️ ${String(t.error).slice(0, 200)}` : null,
    t.restarts ? `🔁 ری‌استارت‌ها: ${fa(t.restarts)}` : null,
  ].filter(Boolean);
  return { text: lines.join('\n'), reply_markup: { inline_keyboard: [[btn('🛠 تعمیرِ تونل', { k: 'svDo', op: 'tunnelRepair' }), btn('🔄 تازه کن', { k: 'sv', p: 'tunnel' })]] } };
}

function logsPage() {
  const rows = db.prepare("SELECT level, source, message, created_at FROM events WHERE level IN ('error','warn') ORDER BY id DESC LIMIT 15").all();
  if (!rows.length) return { text: '📜 خطا یا هشداری در لاگ نیست ✅' };
  return { text: ['📜 ۱۵ خطا و هشدارِ آخر', '', ...rows.map((r) => `${r.level === 'error' ? '❌' : '⚠️'} ${clock(r.created_at)} · ${r.source}\n${String(r.message).slice(0, 200)}`)].join('\n\n').slice(0, 4000) };
}

export async function serverPage(p) {
  switch (p) {
    case 'panel': return panelPage();
    case 'account': return accountPage();
    case 'pump': return pumpPage();
    case 'siteup': return siteUpPage();
    case 'backup': return backupPage();
    case 'jobs': return jobsPage();
    case 'tunnel': return tunnelPage();
    case 'logs': return logsPage();
    default: return serverMenu();
  }
}

// ── کارها ───────────────────────────────────────────────────────────────
const CONFIRM_OPS = new Set(['panelInstall', 'panelRollback', 'panelRestart', 'accountRestart', 'accountInstall', 'pumpPublish', 'pumpMode']);
export const needsConfirm = (a) => CONFIRM_OPS.has(a.op);

export function confirmServer(a) {
  return {
    panelInstall: `⬇️ نسخهٔ ${a.version} کنترول سنتر نصب شود؟\nپیش از نصب از کد و داده پشتیبان گرفته می‌شود؛ کنترول سنتر چند لحظه خاموش و دوباره روشن می‌شود (چراغِ 🔴/🟢 همین‌جا).`,
    panelRollback: '↩️ کنترول سنتر به نسخهٔ پیش از آخرین آپدیت برگردد؟ (دوباره باز می‌شود)',
    panelRestart: '🔄 کنترول سنتر ری‌استارت شود؟ چند ثانیه همهٔ سایت‌ها و ربات قطع می‌شوند.',
    accountRestart: '🔄 سرورِ حساب ری‌استارت شود؟ برنامه‌های پمپ و فروشگاه چند ثانیه وصل نمی‌شوند.',
    accountInstall: `⬇️ نسخهٔ ${a.version} سرورِ حساب نصب شود؟ (پشتیبان، نصب، ری‌استارت؛ اگر بالا نیامد خودش برمی‌گردد)`,
    pumpPublish: `📤 نسخهٔ ${a.version} برنامهٔ پمپ برای همهٔ پمپ‌ها منتشر شود؟`,
    pumpMode: a.mode === 'hold' ? '⏸ آپدیتِ پمپ نگه داشته شود؟ نسخه‌های تازه گرفته می‌شوند ولی تا «انتشار» نزنید به پمپ‌ها نمی‌روند.' : '▶ آپدیتِ پمپ خودکار شود؟ هر نسخهٔ سالمِ تازه همان لحظه به پمپ‌ها می‌رود.',
  }[a.op] || 'انجام شود؟';
}

/** @returns {Promise<{text: string, reply_markup?: object}>} پیامِ نتیجه (یا «شروع شد») */
export async function runServer(a, { tg, tok, chatId }) {
  const bg = (key, fn, started) => (background(key, tg, tok, chatId, fn) ? { text: started } : { text: '⏳ همین کار از قبل در جریان است؛ نتیجه‌اش همین‌جا می‌آید.' });
  switch (a.op) {
    case 'panelInstall':
      audit({ actor: ACTOR, action: 'update.install.requested', entity: 'panel', detail: { version: a.version } });
      return bg('panelInstall', async () => {
        const r = await installLatest({ actor: ACTOR, restart: true });
        if (r.ok) return `✅ نسخهٔ ${r.version || a.version} نصب شد. کنترول سنتر همین حالا دوباره باز می‌شود؛ «🟢 دوباره روشن شد» را همین‌جا می‌بینید.`;
        return { already_up_to_date: '✅ از قبل به‌روز بود.', install_running: '⏳ نصبِ دیگری در جریان است.', github_unreachable: '⚠️ گیت‌هاب جواب نداد؛ کمی بعد دوباره.' }[r.reason] || `⚠️ نصب نشد: ${r.reason}`;
      }, `⏳ نصبِ ${a.version} شروع شد (دانلود ⇒ پشتیبان ⇒ نصب). نتیجه همین‌جا می‌آید.`);
    case 'panelRollback':
      return bg('panelRollback', async () => { await rollback({ actor: ACTOR }); return '↩️ نسخهٔ قبلی برگشت؛ کنترول سنتر دوباره باز می‌شود.'; }, '⏳ برگرداندن شروع شد…');
    case 'panelAuto':
      setSetting('cc_update_autoinstall', !!a.on);
      audit({ actor: ACTOR, action: 'update.autoinstall', entity: 'panel', detail: { on: !!a.on } });
      return panelPage();
    case 'panelRestart':
      audit({ actor: ACTOR, action: 'panel.restart', entity: 'panel' });
      scheduleRestart(1500);
      return { text: '🔄 کنترول سنتر ری‌استارت می‌شود… چراغِ بالا 🔴 و بعد «🟢 دوباره روشن شد» می‌آید.' };
    case 'accountRestart':
      audit({ actor: ACTOR, action: 'account.restart', entity: 'account' });
      return bg('accountRestart', async () => { await restartAccountServer(); return accountStatus().running ? '✅ سرورِ حساب ری‌استارت شد و روشن است.' : '⚠️ سرورِ حساب پس از ری‌استارت هنوز بالا نیامده؛ «🗄 سرورِ حساب» را دوباره ببینید.'; }, '⏳ ری‌استارتِ سرورِ حساب…');
    case 'accountInstall':
      return bg('accountInstall', async () => {
        const r = await accountUpdater.apply({ actor: ACTOR });
        if (r && r.ok && r.changed === false) return `✅ ${r.why || 'سرورِ حساب از قبل به‌روز بود.'}`;
        if (r && r.ok) return `✅ سرورِ حساب به ${r.to || r.version || a.version} رسید و روشن است.`;
        return `⚠️ سرورِ حساب آپدیت نشد: ${(r && (r.why || r.error || r.reason)) || 'نامعلوم'}`;
      }, `⏳ آپدیتِ سرورِ حساب به ${a.version} شروع شد. نتیجه همین‌جا می‌آید.`);
    case 'pumpCheck':
      return bg('pumpCheck', async () => {
        await pumpMirror.syncOnce();
        const s = await pumpMirror.status();
        return s.error ? `⚠️ آپدیتِ پمپ: ${s.error}` : `✅ آپدیتِ پمپ: گرفته‌شده ${s.version || '—'} · منتشرشده ${s.served || '—'}${s.waiting ? ` — ✨ ${s.version} منتظرِ انتشار (⛽ آپدیتِ برنامهٔ پمپ)` : ''}`;
      }, '⏳ از گیت‌هاب می‌پرسم؛ نصابِ بزرگ ممکن است چند دقیقه طول بکشد. نتیجه همین‌جا می‌آید.');
    case 'pumpPublish':
      await pumpMirror.publish(a.version, { by: ACTOR });
      audit({ actor: ACTOR, action: 'pump_updates.publish', detail: { version: a.version } });
      return { text: `✅ ${a.version} برای همهٔ پمپ‌ها منتشر شد.` };
    case 'pumpMode':
      await pumpMirror.setMode(a.mode, { by: ACTOR });
      audit({ actor: ACTOR, action: 'pump_updates.mode', detail: { mode: a.mode } });
      return pumpPage();
    case 'siteCheck':
      return bg('siteCheck', async () => { await siteMirror.syncOnce(); return '✅ آپدیتِ سایت‌ها از گیت‌هاب پرسیده شد؛ سایت‌ها در دورِ بعدشان (حداکثر یک ساعت) می‌گیرند.'; }, '⏳ از گیت‌هاب می‌پرسم…');
    case 'backupNow': {
      const b = createBackup({ reason: 'manual', note: 'از رباتِ تلگرام' });
      audit({ actor: ACTOR, action: 'backup.create', entity: 'backup', detail: { file: b.file } });
      return { text: `✅ پشتیبان ساخته شد — ${mb(b.sizeBytes)}`, reply_markup: backupPage().reply_markup };
    }
    case 'jobRun':
      return bg(`job:${a.name}`, async () => {
        const r = await runJob(a.name, { trigger: 'manual' });
        if (r && r.error === 'already_running') return `⏳ «${a.title}» همین حالا در حالِ اجراست.`;
        return `${r && r.status === 'ok' ? '✅' : '⚠️'} «${a.title}»: ${r && r.status ? r.status : 'نامعلوم'}${r && r.error ? ` — ${String(r.error).slice(0, 200)}` : ''}`;
      }, `⏳ «${a.title}» اجرا شد…`);
    case 'tunnelRepair':
      return bg('tunnelRepair', async () => { await repairTunnel(); const t = tunnelState(); return `🛠 تعمیرِ تونل تمام شد — وضعیت: ${t.status || '—'}${t.error ? `\n⚠️ ${t.error}` : ''}`; }, '⏳ تعمیرِ تونل…');
    default:
      return serverMenu();
  }
}
