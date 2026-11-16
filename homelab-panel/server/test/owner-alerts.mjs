// ---------------------------------------------------------------------------
//  آزمونِ دروازهٔ پیام به مالک (src/notify/owner.js، ۱.۵۳.۰) — «سیلِ پیام» بسته شد، هیچ چیزی گم نشد
//
//      node test/owner-alerts.mjs
//
//  ۱) تا وقتی مشکل هست تکرار نمی‌شود · ۲) «برطرف شد» یک بار · ۳) مهلتِ تکرار و یادآوری · ۴) سقفِ روزانه و پیامِ جمعی
//  ۵) خلاصهٔ روزانه · ۶) ساعتِ آرام و گذرِ بحرانی · ۷) ماندگاریِ تنظیمات (و قفلِ امنیت) · و پل از هشدارهای مرکز فرمان
//  زمان دستی جلو می‌رود (`now`)؛ ساعتِ دیوار در هیچ سنجه‌ای نیست.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-owner-alerts-'));
process.env.HLP_DATA_DIR = path.join(tmp, 'unit');
process.env.HLP_SITES_ROOT = path.join(tmp, 'unit-sites');

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const owner = await import('../src/notify/owner.js');
const { getSetting } = await import('../src/db.js');
const { raiseAlert, clearAlert } = await import('../src/control/alerts.js');
(await import('../src/control/schema.js')).ensureControlSchema();

//  ظهرِ ۲۵ آبان به وقتِ کابل (UTC+4:30)
const MIN = 60e3;
const H = 3600e3;
const kabul = (d, h, m = 0) => Date.UTC(2026, 10, d, h, m) - 4.5 * H;
const NOON = kabul(16, 12);

const sent = [];
let failNext = 0;
const send = async (text, extra = {}) => {
  if (failNext > 0) { failNext -= 1; throw new Error('تلگرام: 502'); }
  sent.push({ text, extra });
};
const since = (n) => sent.slice(n).map((x) => x.text);

try {
  console.log('\n── پیش‌فرض‌ها ──');
  const d0 = owner.settings();
  check('مهلت ۶ ساعت، بحرانی ۲، سقف ۲۰، خلاصه ۲۱، ساعتِ آرام ۲۳ تا ۷، کابل، کدها بی‌صدا',
    d0.cooldownH === 6 && d0.criticalCooldownH === 2 && d0.dailyCap === 20 && d0.digestHour === 21 && d0.quiet && d0.quietFrom === 23 && d0.quietTo === 7 && d0.tz === 'Asia/Kabul' && d0.codesSilent,
    JSON.stringify(d0));
  check('ساعتِ کابل درست خوانده می‌شود', owner.clock(NOON).hour === 12 && owner.clock(kabul(16, 23, 30)).hour === 23 && owner.clock(NOON).day === '2026-11-16');
  check('۰۱:۰۰ ساعتِ آرام است، ظهر نه', owner.inQuiet(kabul(17, 1)) && !owner.inQuiet(NOON));

  console.log('\n── ۱) تا وقتی مشکل هست تکرار نمی‌شود ──');
  let n = sent.length;
  let r = owner.report({ type: 'disk', key: 'disk:/', severity: 'warn', title: 'دیسکِ / پر شده: ۹۱٪', now: NOON });
  check('مشکلِ تازه ⇒ در صف', r.decision === 'pending', JSON.stringify(r));
  await owner.flush(send, { now: NOON });
  for (let i = 1; i <= 30; i++) {
    const again = owner.report({ type: 'disk', key: 'disk:/', severity: 'warn', title: 'دیسکِ / پر شده: ۹۱٪', now: NOON + i * MIN });
    if (again.decision !== 'ongoing') check(`دورِ ${i} نباید پیام بسازد`, false, JSON.stringify(again));
    await owner.flush(send, { now: NOON + i * MIN });
  }
  check('۳۰ دورِ پشتِ هم با همان دیسکِ پر ⇒ فقط یک پیام', sent.length - n === 1, since(n).join(' | '));

  console.log('\n── ۲) «برطرف شد» یک بار ──');
  n = sent.length;
  r = owner.resolve('disk:/', { text: '🟢 دیسکِ / دوباره جا دارد: ۸۰٪', now: NOON + 40 * MIN });
  await owner.flush(send, { now: NOON + 40 * MIN });
  const again = owner.resolve('disk:/', { now: NOON + 41 * MIN });
  await owner.flush(send, { now: NOON + 41 * MIN });
  check('برگشت ⇒ یک پیام، بی‌صدا', sent.length - n === 1 && /دوباره جا دارد/.test(sent.at(-1).text) && sent.at(-1).extra.disable_notification === true, since(n).join(' | '));
  check('برگشتِ دوباره ⇒ هیچ', again.decision === 'none');

  console.log('\n── ۳) مهلتِ تکرار، رفت‌وبرگشت و یادآوری ──');
  n = sent.length;
  r = owner.report({ type: 'disk', key: 'disk:/', severity: 'warn', title: 'دیسکِ / پر شده: ۹۲٪', now: NOON + 60 * MIN });
  await owner.flush(send, { now: NOON + 60 * MIN });
  const flapBack = owner.resolve('disk:/', { now: NOON + 70 * MIN });
  await owner.flush(send, { now: NOON + 70 * MIN });
  check('همان کلید زودتر از ۶ ساعت دوباره باز شد ⇒ «تکراری»، بی پیام', r.decision === 'suppressed' && sent.length === n, JSON.stringify(r));
  check('و «برطرف شد» ِ مشکلی که نرفته بود هم نمی‌رود', flapBack.decision === 'panel', JSON.stringify(flapBack));
  const T7 = NOON + 7 * H;
  r = owner.report({ type: 'disk', key: 'disk:/', severity: 'warn', title: 'دیسکِ / پر شده: ۹۳٪', now: T7 });
  await owner.flush(send, { now: T7 });
  check('پس از مهلت ⇒ دوباره می‌رود', r.decision === 'pending' && sent.length - n === 1, JSON.stringify(r));
  n = sent.length;
  r = owner.report({ type: 'disk', key: 'disk:/', severity: 'warn', title: 'دیسکِ / پر شده: ۹۳٪', now: T7 + 5 * H });
  check('هنوز برقرار و مهلت نگذشته ⇒ یادآوری نه', r.decision === 'ongoing');
  //  یادآوری پس از ۶ ساعت — ولی ۲۳:۰۰ به بعد ساعتِ آرام است؛ پس روزِ بعد ظهر
  const NOON2 = kabul(17, 12);
  r = owner.report({ type: 'disk', key: 'disk:/', severity: 'warn', title: 'دیسکِ / پر شده: ۹۳٪', now: NOON2 });
  await owner.flush(send, { now: NOON2 });
  check('پس از مهلت و هنوز برقرار ⇒ یک «⏰ هنوز برقرار است»', r.decision === 'pending' && /⏰ هنوز برقرار است/.test(sent.at(-1)?.text || ''), JSON.stringify(r) + since(n).join(' | '));
  r = owner.report({ type: 'disk', key: 'disk:/', severity: 'critical', title: 'دیسکِ / پر شده: ۹۶٪', now: NOON2 + 2 * MIN });
  await owner.flush(send, { now: NOON2 + 2 * MIN });
  const down = owner.report({ type: 'disk', key: 'disk:/', severity: 'warn', title: 'دیسکِ / پر شده: ۹۴٪', now: NOON2 + 3 * MIN });
  const up = owner.report({ type: 'disk', key: 'disk:/', severity: 'critical', title: 'دیسکِ / پر شده: ۹۶٪', now: NOON2 + 4 * MIN });
  check('بالا رفتن به بحرانی همان دم یک پیام؛ لرزیدنِ ۹۴/۹۶ دوباره نه', r.decision === 'pending' && down.decision === 'ongoing' && up.decision === 'ongoing', JSON.stringify([r, down, up]));
  owner.resolve('disk:/', { now: NOON2 + 10 * MIN });
  await owner.flush(send, { now: NOON2 + 10 * MIN });

  console.log('\n── ۴) ساعتِ آرام و گذرِ بحرانی ──');
  const NIGHT = kabul(18, 1);
  n = sent.length;
  const crit = owner.report({ type: 'cloud_down', key: 'cloud', severity: 'critical', title: 'سرورِ حساب جواب نمی‌دهد', text: '🚨 سرورِ حساب جواب نمی‌دهد', now: NIGHT });
  const warn = owner.report({ type: 'site_down', key: 'site:a', severity: 'warn', title: 'سایتِ «الف» خاموش شد', now: NIGHT });
  const ev = owner.report({ type: 'restart', key: 'restart', severity: 'warn', title: 'سرور دوباره روشن شد', event: true, now: NIGHT + MIN });
  await owner.flush(send, { now: NIGHT + MIN });
  check('ساعتِ ۱ شب: بحرانی همان دم رفت، هشدار و رخدادِ معمولی ماندند', crit.decision === 'pending' && warn.decision === 'held' && ev.decision === 'held' && sent.length - n === 1 && /سرورِ حساب/.test(sent.at(-1).text), JSON.stringify([crit, warn, ev]) + since(n).join(' | '));
  const back = owner.resolve('cloud', { text: '🟢 سرورِ حساب برگشت', now: NIGHT + 20 * MIN });
  await owner.flush(send, { now: NIGHT + 20 * MIN });
  check('برگشتِ بحرانی در ساعتِ آرام هم می‌رسد (مالک بیدار شده بود)', back.decision === 'pending' && /برگشت/.test(sent.at(-1).text));
  owner.resolve('site:a', { now: NIGHT + 30 * MIN });
  n = sent.length;
  await owner.flush(send, { now: kabul(18, 6, 59) });
  check('تا پایانِ ساعتِ آرام هیچ', sent.length === n);
  await owner.flush(send, { now: kabul(18, 7, 1) });
  const morning = sent.at(-1)?.text || '';
  check('ساعتِ ۷: همهٔ ماندهٔ شب در **یک** پیام، با «برطرف شد» برای آن‌چه گذشت', sent.length - n === 1 && /ساعتِ آرام/.test(morning) && /الف/.test(morning) && /برطرف شد/.test(morning) && /روشن شد/.test(morning), morning);
  await owner.flush(send, { now: kabul(18, 7, 5) });
  check('و دوباره نمی‌آید', sent.length - n === 1);

  console.log('\n── ۵) سقفِ روزانه، پیامِ جمعی و بحرانی‌ای که همیشه می‌رسد ──');
  owner.setSettings({ dailyCap: 5 });
  const DAY3 = kabul(19, 10);
  n = sent.length;
  const decisions = [];
  for (let i = 0; i < 8; i++) {
    decisions.push(owner.report({ type: 'automation', key: `job:x${i}`, severity: 'warn', title: `کارِ ${i} ناموفق`, event: true, now: DAY3 + i * MIN }).decision);
    await owner.flush(send, { now: DAY3 + i * MIN });
  }
  //  «کارهای خودکار» پیش‌فرضش «خبر» است ⇒ همه فقط خلاصه
  check('کارهای خودکار پیش‌فرض «خبر» ⇒ فقط خلاصه، هیچ پیامی', decisions.every((d) => d === 'digest') && sent.length === n, decisions.join(','));
  decisions.length = 0;
  for (let i = 0; i < 8; i++) {
    decisions.push(owner.report({ type: 'site_down', key: `site:s${i}`, severity: 'warn', title: `سایتِ ${i} خاموش شد`, now: DAY3 + (10 + i) * MIN }).decision);
    await owner.flush(send, { now: DAY3 + (10 + i) * MIN });
  }
  const capText = sent.find((x) => /سقفِ روزانه/.test(x.text))?.text || '';
  check('۵ تا رفت، بقیه «سقف» و فقط یک پیامِ «🔕 سقف پر شد»', decisions.filter((d) => d === 'pending').length === 5 && decisions.filter((d) => d === 'capped').length === 3 && sent.length - n === 6 && /بحرانی‌ها همچنان می‌رسند/.test(capText), decisions.join(',') + ' | ' + since(n).join(' | '));
  n = sent.length;
  const critOver = owner.report({ type: 'backup', key: 'job:backup-daily:critical', severity: 'critical', title: 'پشتیبانِ روزانه ناموفق', event: true, now: DAY3 + 30 * MIN });
  await owner.flush(send, { now: DAY3 + 30 * MIN });
  check('بحرانی بالای سقف هم می‌رود', critOver.decision === 'pending' && sent.length - n === 1);
  owner.setSettings({ dailyCap: 20 });
  for (let i = 0; i < 8; i++) owner.resolve(`site:s${i}`, { now: DAY3 + 35 * MIN });
  await owner.flush(send, { now: DAY3 + 35 * MIN });
  check('برگشت فقط برای آن ۵ سایتی که خبرشان رفته بود', sent.filter((x) => /برطرف شد: سایتِ/.test(x.text)).length === 5, since(n).join(' | '));
  //  رگبار در یک دور ⇒ ۵ پیام + یک «و n هشدارِ دیگر»
  n = sent.length;
  for (let i = 0; i < 7; i++) owner.report({ type: 'service_down', key: `svc:${i}`, severity: 'critical', title: `سرویسِ ${i} بالا نماند`, event: true, now: DAY3 + 40 * MIN });
  const burst = await owner.flush(send, { now: DAY3 + 40 * MIN });
  check('رگبارِ ۷ تایی ⇒ ۵ پیام + یک پیامِ جمعیِ «و ۲ هشدارِ دیگر»', burst.sent === 5 && burst.more === 2 && sent.length - n === 6 && /و ۲ هشدارِ دیگر/.test(sent.at(-1).text), JSON.stringify(burst));

  console.log('\n── ۶) خلاصهٔ روزانه ──');
  owner.report({ type: 'backup', key: 'job:backup-daily:info', severity: 'info', title: 'پشتیبانِ روزانه ساخته شد', event: true, now: DAY3 + 50 * MIN });
  owner.report({ type: 'backup', key: 'job:backup-weekly:info', severity: 'info', title: 'پشتیبانِ هفتگی ساخته شد', event: true, now: DAY3 + 51 * MIN });
  const upd = owner.report({ type: 'update', key: 'job:panel-update:warn', severity: 'warn', title: 'نسخهٔ ۱.۵۳.۰ آماده است', event: true, now: DAY3 + 52 * MIN });
  check('به‌روزرسانی پیش‌فرض «خبر» است', upd.decision === 'digest' && upd.severity === 'info');
  n = sent.length;
  const early = await owner.maybeDigest(send, { now: kabul(19, 20, 59), report: async () => '📊 گزارشِ کنترول سنتر' });
  check('پیش از ساعتِ ۲۱ ⇒ هیچ', early === null && sent.length === n);
  const dg = await owner.maybeDigest(send, { now: kabul(19, 21, 2), report: async () => '📊 گزارشِ کنترول سنتر' });
  const dtext = sent.at(-1)?.text || '';
  check('ساعتِ ۲۱: **یک** پیام — گزارش بالا، خلاصه زیر', dg?.sent === true && sent.length - n === 1 && dtext.startsWith('📊 گزارشِ کنترول سنتر') && /خلاصهٔ امروزِ اعلان‌ها/.test(dtext), dtext);
  check('خلاصه: خبرها دسته‌بندی‌شده (پشتیبان ×۲، به‌روزرسانی)', /پشتیبان ×۲/.test(dtext) && /به‌روزرسانی/.test(dtext), dtext);
  check('خلاصه: «و ۳ هشدارِ دیگر» ِ سقف، و پرسروصداترین نوع', /و ۳ هشدارِ دیگر/.test(dtext) && /پرسروصداترین/.test(dtext), dtext);
  check('خلاصه بی‌صدا می‌رسد', sent.at(-1).extra.disable_notification === true);
  const twice = await owner.maybeDigest(send, { now: kabul(19, 22), report: async () => 'x' });
  check('همان روز دوباره نه', twice === null && sent.length - n === 1);
  owner.setSettings({ digestHour: 20 });
  n = sent.length;
  const calm = await owner.maybeDigest(send, { now: kabul(20, 20, 30), report: null });
  check('روزِ آرام و گزارشِ خاموش ⇒ هیچ پیامی («همه‌چیز خوب است» ارزشِ زنگ ندارد)', calm?.sent === false && sent.length === n, JSON.stringify(calm));
  owner.setSettings({ digestHour: 21 });

  console.log('\n── ۷) «پیوسته N دقیقه»، نوعِ خاموش و اهمیتِ دلخواه ──');
  const M0 = kabul(21, 11);
  n = sent.length;
  r = owner.report({ type: 'memory', key: 'mem:a', severity: 'warn', title: 'حافظهٔ «الف» ۹۴٪', sustainMs: 10 * MIN, now: M0 });
  owner.resolve('mem:a', { now: M0 + 4 * MIN });
  await owner.flush(send, { now: M0 + 11 * MIN });
  check('جهشِ ۴ دقیقه‌ایِ حافظه ⇒ هیچ پیامی', r.decision === 'waiting' && sent.length === n, JSON.stringify(r));
  owner.report({ type: 'memory', key: 'mem:b', severity: 'warn', title: 'حافظهٔ «ب» ۹۴٪', sustainMs: 10 * MIN, now: M0 });
  await owner.flush(send, { now: M0 + 9 * MIN });
  const before = sent.length;
  await owner.flush(send, { now: M0 + 10 * MIN });
  check('۱۰ دقیقه پیوسته ⇒ همان موقع یک پیام', before === n && sent.length - n === 1 && /حافظهٔ «ب»/.test(sent.at(-1).text));
  owner.setSettings({ types: { site_down: { on: false }, disk: { severity: 'info' } } });
  const muted = owner.report({ type: 'site_down', key: 'site:z', severity: 'warn', title: 'سایتِ ز خاموش شد', now: M0 + 20 * MIN });
  const lowered = owner.report({ type: 'disk', key: 'disk:/data', severity: 'critical', title: 'دیسکِ /data ۹۷٪', now: M0 + 20 * MIN });
  check('نوعِ خاموش ⇒ فقط پنل؛ اهمیتِ دلخواه «خبر» ⇒ فقط خلاصه', muted.decision === 'panel' && lowered.decision === 'digest', JSON.stringify([muted, lowered]));
  owner.setSettings({ types: { site_down: { on: true }, disk: { severity: 'auto' } } });
  check('برگرداندن به خودکار', !owner.settings().types.site_down && !owner.settings().types.disk);

  console.log('\n── ۸) امنیت همیشه روشن و بحرانی ──');
  let refused = null;
  try { owner.setSettings({ types: { security: { on: false } } }); } catch (e) { refused = e; }
  check('خاموش کردنِ امنیت ⇒ ۴۰۰، نه بی‌صدا', refused?.status === 400);
  refused = null;
  try { owner.setSettings({ types: { security: { severity: 'info' } } }); } catch (e) { refused = e; }
  check('پایین آوردنِ اهمیتِ امنیت ⇒ ۴۰۰', refused?.status === 400);
  n = sent.length;
  const sec = owner.report({ type: 'security', key: 'login:1.2.3.4', severity: 'warn', title: 'ورود از IPِ تازه', event: true, now: kabul(22, 2) });
  await owner.flush(send, { now: kabul(22, 2) });
  check('ورودِ مشکوکِ ساعتِ ۲ شب ⇒ بحرانی و همان دم', sec.severity === 'critical' && sec.decision === 'pending' && sent.length - n === 1);

  console.log('\n── ۹) تلگرامِ قطع: پیام در صف می‌ماند و یک بار می‌رود ──');
  const F0 = kabul(22, 12);
  n = sent.length;
  owner.report({ type: 'service_down', key: 'svc:z', severity: 'critical', title: 'سرویسِ ز بالا نماند', event: true, now: F0 });
  failNext = 1;
  const f1 = await owner.flush(send, { now: F0 });
  const f2 = await owner.flush(send, { now: F0 + MIN });
  const f3 = await owner.flush(send, { now: F0 + 2 * MIN });
  check('نرفت ⇒ دورِ بعد همان، یک بار', f1.failed && f2.sent === 1 && f3.sent === 0 && sent.length - n === 1, JSON.stringify([f1, f2, f3]));

  console.log('\n── ۱۰) پل از هشدارهای مرکز فرمان و کارهای خودکار ──');
  owner.attachAlertBridge();
  n = sent.length;
  const B0 = Date.now();
  raiseAlert({ key: 'server:vps1:offline', kind: 'server_offline', severity: 'critical', title: 'سرور «vps1» گزارش نمی‌دهد' });
  raiseAlert({ key: 'server:vps1:offline', kind: 'server_offline', severity: 'critical', title: 'سرور «vps1» گزارش نمی‌دهد' });
  raiseAlert({ key: 'automation:x', kind: 'automation', severity: 'warn', title: 'کارِ x' });
  raiseAlert({ key: 'disk:high', kind: 'disk_high', severity: 'warn', title: 'دیسک ۸۵٪ پر است' });
  await owner.flush(send, { now: B0 + 1000 });
  check('سرورِ خاموش ⇒ یک پیام (دوبار دیدنِ همان هشدار یکی است)؛ «کارِ خودکار» و «دیسک» از راهِ خودشان', sent.length - n === 1 && /vps1/.test(sent.at(-1).text), since(n).join(' | '));
  clearAlert('server:vps1:offline');
  await owner.flush(send, { now: B0 + 2000 });
  check('بسته شدنِ هشدار ⇒ «✅ برطرف شد»', sent.length - n === 2 && /برطرف شد/.test(sent.at(-1).text), since(n).join(' | '));
  raiseAlert({ key: 'server:vps2:memory', kind: 'high_ram', severity: 'warn', title: 'حافظهٔ «vps2» ۹۳٪ پر است' });
  const waitRow = owner.history({ limit: 1 })[0];
  check('حافظهٔ بالا ⇒ «در انتظارِ ۱۰ دقیقه»، نه پیامِ همان دم', waitRow.type === 'memory' && waitRow.decision === 'waiting', JSON.stringify(waitRow));
  check('کارِ «هشدارِ دیسک» دوباره نمی‌رود؛ خبرِ پشتیبان فقط خلاصه', owner.fromJob('disk-alert', 'warn', 'x') === null && owner.fromJob('backup-daily', 'info', 'پشتیبانِ روزانه ساخته شد').decision === 'digest');
  check('کدی که با ایمیل نرفت ⇒ هشدار (هر کاربر جدا)', owner.fromJob('code-rescue', 'warn', 'کدِ a@x نرفت').decision !== 'digest' && owner.fromJob('code-rescue', 'warn', 'کدِ b@x نرفت').decision !== 'suppressed');
  owner.detachAlertBridge();

  console.log('\n── ۱۱) ماندگاریِ تنظیمات و شمارِ امروز ──');
  owner.setSettings({ cooldownH: 3, criticalCooldownH: 1, digestHour: 20, quietFrom: 22, quietTo: 6, codesSilent: false });
  const raw = getSetting('owner_alerts', null);
  check('تنظیم در دیتابیس نوشته شد و همان خوانده می‌شود', raw?.cooldownH === 3 && raw?.digestHour === 20 && owner.settings().quietFrom === 22 && owner.settings().codesSilent === false, JSON.stringify(raw));
  let bad = null;
  try { owner.setSettings({ cooldownH: 0 }); } catch (e) { bad = e; }
  check('مقدارِ نادرست ⇒ ۴۰۰ با نامِ فیلد، و تنظیمِ قبلی دست نخورد', bad?.status === 400 && bad.field === 'cooldownH' && owner.settings().cooldownH === 3);
  owner.count('inbox', { now: F0 });
  owner.count('codes', { now: F0 });
  const st = owner.stats({ now: F0 + 3 * MIN });
  check('شمارِ امروز: هشدار و پیامِ کاربر و کد جدا', st.total >= 4 && st.sentByType.inbox === 1 && st.sentByType.codes === 1 && st.alerts === st.total - 2, JSON.stringify(st));
  check('پرسروصداترین نوع‌ها', Array.isArray(st.top) && st.top.length > 0 && st.top[0].n >= st.top.at(-1).n);
  const hist = owner.history({ limit: 500 });
  check('هیچ چیزی گم نشد: تکراری، سقف، خلاصه، ساعتِ آرام و فقط‌پنل همه در دفتر', ['suppressed', 'capped', 'digest', 'summarized', 'panel', 'dropped', 'sent'].every((d) => hist.some((h) => h.decision === d)), [...new Set(hist.map((h) => h.decision))].join(','));
} catch (e) {
  check('خطای غیرمنتظره (واحد)', false, e.stack || e.message);
}

/* ───────────── درِ پنل: فقط مدیر، و ماندگار پس از ری‌استارت ───────────── */
console.log('\n── ۱۲) درِ پنل ──');
const PORT = Number(process.env.TEST_PORT || 5535);
const BASE = `http://127.0.0.1:${PORT}`;
const env = {
  ...process.env,
  HLP_PORT: String(PORT), HLP_SITESYNC_PORT: String(PORT + 1), HLP_HOST: '127.0.0.1',
  HLP_DATA_DIR: path.join(tmp, 'srv'), HLP_SITES_ROOT: path.join(tmp, 'srv-sites'), HLP_TUNNEL: '0', HLP_AUTOMATION: '0',
};
let child = null;
let out = '';
const start = () => {
  const c = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  c.stdout.on('data', (d) => (out += d));
  c.stderr.on('data', (d) => (out += d));
  return c;
};
const up = async () => {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${BASE}/health`)).ok) return true; } catch { /* هنوز */ } await new Promise((r) => setTimeout(r, 250)); }
  return false;
};
const call = async (method, url, body, token) => {
  const res = await fetch(BASE + url, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
};
try {
  child = start();
  check('سرور بالا آمد', await up(), out.slice(-400));
  const PASS = 'Owner-Alerts-1405';
  await call('POST', '/api/auth/setup', { username: 'admin', password: PASS });
  let token = (await call('POST', '/api/auth/login', { username: 'admin', password: PASS })).json?.token;
  let r = await call('GET', '/api/owner-alerts');
  check('بی ورود ⇒ ۴۰۱', r.status === 401, String(r.status));
  r = await call('GET', '/api/owner-alerts', null, token);
  check('مدیر: تنظیم، نوع‌ها (امنیت قفل)، شمار و دفتر', r.status === 200 && r.json.settings.digestHour === 21 && r.json.types.some((t) => t.id === 'security' && t.locked) && typeof r.json.stats.total === 'number' && Array.isArray(r.json.history), r.text.slice(0, 300));
  r = await call('PUT', '/api/owner-alerts/settings', { cooldownH: 4, quietFrom: 0, quietTo: 6, types: { cpu: { on: false }, shop: { severity: 'critical' } } }, token);
  check('ذخیرهٔ تنظیم', r.status === 200 && r.json.settings.cooldownH === 4 && r.json.settings.types.cpu?.on === false, r.text.slice(0, 300));
  r = await call('PUT', '/api/owner-alerts/settings', { types: { security: { on: false } } }, token);
  check('خاموش کردنِ امنیت از پنل ⇒ ۴۰۰', r.status === 400 && /امنیتی/.test(r.json?.error || ''), r.text);
  r = await call('PUT', '/api/owner-alerts/settings', { dailyCap: 1 }, token);
  check('سقفِ نادرست ⇒ ۴۰۰ با نامِ فیلد', r.status === 400 && r.json?.field === 'dailyCap', r.text);
  await call('POST', '/api/auth/users', { username: 'viewer9', password: 'Viewer-Only-2026', role: 'viewer' }, token);
  const vt = (await call('POST', '/api/auth/login', { username: 'viewer9', password: 'Viewer-Only-2026' })).json?.token;
  r = await call('PUT', '/api/owner-alerts/settings', { cooldownH: 9 }, vt);
  check('بیننده نمی‌نویسد', r.status === 403, String(r.status));
  r = await call('GET', '/api/owner-alerts/digest', null, token);
  check('پیش‌نمایشِ خلاصه', r.status === 200 && /خلاصهٔ امروزِ اعلان‌ها/.test(r.json?.text || ''), r.text.slice(0, 200));
  child.kill('SIGTERM');
  await new Promise((res) => (child.exitCode !== null ? res() : child.once('exit', res)));
  child = start();
  check('دوباره بالا آمد', await up(), out.slice(-400));
  token = (await call('POST', '/api/auth/login', { username: 'admin', password: PASS })).json?.token;
  r = await call('GET', '/api/owner-alerts', null, token);
  check('پس از ری‌استارت تنظیم همان است', r.json?.settings?.cooldownH === 4 && r.json.settings.quietFrom === 0 && r.json.settings.types.cpu?.on === false && r.json.settings.types.shop?.severity === 'critical', r.text.slice(0, 300));
} catch (e) {
  check('خطای غیرمنتظره (پنل)', false, e.stack || e.message);
} finally {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise((res) => child.once('exit', res));
  }
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

if (fail) console.log('\n' + out.slice(-1500));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
