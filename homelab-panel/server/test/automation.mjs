// ---------------------------------------------------------------------------
//  آزمونِ موتورِ اتوماسیون (بخشِ ۱۰ پرامپت)
//      node test/automation.mjs
//
//  سرورِ واقعی روی پورتِ تصادفی با پوشهٔ دادهٔ موقت بالا می‌آید و هر ادعا از
//  روی خودِ دیتابیس و API سنجیده می‌شود:
//    • همهٔ کارهای جدولِ ۱۰.۲ ثبت شده‌اند و مهاجرتِ ۰۰۵ اعمال شده
//    • اجرای دستی یک ردیف در automation_runs می‌سازد (trigger، مدت، وضعیت)
//    • قفل: اجرای دوم روی کارِ در جریان ⇒ ۴۰۹ و ردیفِ «skipped»
//    • خطا ⇒ سه تلاش با فاصله، بعد «failed» و onFail (رویدادش ثبت می‌شود)
//    • مهلت ⇒ «timeout»
//    • رویدادِ واقعی: پنج ورودِ ناموفق ⇒ login.suspicious ⇒ کارِ هشدار ⇒ هشدارِ مرکز فرمان
//    • روشن/خاموش را زمان‌بند رعایت می‌کند و next_run_at حساب می‌شود
//    • پشتیبانِ هفتگی واقعاً بازگردانیِ آزمایشی می‌کند و offsite-push پشتش می‌دود
//    • هیچ اجرایی بی ثبتِ نتیجه نمی‌ماند
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PORT = Number(process.env.TEST_PORT || 4907);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-automation-'));
const dataDir = path.join(tmp, 'data');
fs.mkdirSync(path.join(tmp, 'sites'), { recursive: true });

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const REQUIRED = [
  'backup-daily', 'backup-weekly', 'backup-monthly', 'offsite-push',
  'health-check', 'uptime', 'metrics', 'thermal-guard',
  'log-rotate', 'temp-cleanup', 'db-vacuum', 'security-updates',
  'agent-morning-report', 'restart-on-down', 'disk-alert', 'suspicious-login-alert', 'agent-idle-off',
];

const TICK_MS = 2000;
const child = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')],
  {
    env: {
      ...process.env,
      HLP_PORT: String(PORT), HLP_SITESYNC_PORT: String(PORT + 1), HLP_HOST: '127.0.0.1',
      HLP_DATA_DIR: dataDir, HLP_SITES_ROOT: path.join(tmp, 'sites'),
      HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_SITESYNC: '1', HLP_ACCOUNT_API: '0', HLP_ACCOUNT_AUTOSTART: '0',
      HLP_AUTOMATION_TEST_JOBS: '1',
      HLP_AUTOMATION_BACKOFF: '50,100,200',
      HLP_AUTOMATION_TICK_MS: String(TICK_MS),
      HLP_AUTOMATION_TEST_SLEEP_MS: '2500',
      HLP_RATE_LOGIN: '100',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));

async function waitForServer(timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { if ((await fetch(`${BASE}/health`)).ok) return true; } catch { /* هنوز */ }
    await wait(200);
  }
  return false;
}

let token = '';
const api = async (method, url, body, auth = token) => {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* بدنه نداشت */ }
  return { status: res.status, json };
};

function openDb() {
  return new DatabaseSync(path.join(dataDir, 'panel.db'));
}

try {
  check('سرور بالا آمد', await waitForServer(), out.slice(-800));
  token = (await api('POST', '/api/auth/setup', { username: 'admin', password: 'ControlCenter!2026' }, null)).json?.token;
  check('مدیر ساخته شد', Boolean(token));

  /* ────────────────────────── ثبت و مهاجرت ────────────────────────────── */
  console.log('\n── ثبتِ کارها ──');
  //  ⚠️ «در آینده» نسبت به لحظهٔ **پرسیدن**، با یک تیکِ زمان‌بند ارفاق: کاری
  //  که سرِ دقیقه‌اش رسیده ولی تیکِ بعدی هنوز نزده، سالم است. سنجهٔ قبلی
  //  `Date.now()`ِ پس از پاسخ را می‌گرفت و سرِ مرزِ دقیقه گاهی سرخ می‌شد
  //  (CI، ۱۴۰۵/۰۷/۰۳: health-check درست ۶۶ میلی‌ثانیه پیش از سنجش سررسید).
  const askedAt = Date.now();
  const jobs = (await api('GET', '/api/automation/jobs')).json?.items || [];
  const names = jobs.map((j) => j.name);
  for (const n of REQUIRED) check(`کارِ «${n}» ثبت شده`, names.includes(n));
  check('همه از اول روشن‌اند', REQUIRED.every((n) => jobs.find((j) => j.name === n)?.enabled === true));
  const withSchedule = jobs.filter((j) => j.trigger === 'schedule');
  check('هر کارِ زمان‌بندی‌شده next_run_at دارد و در آینده است',
    withSchedule.length >= 9 && withSchedule.every((j) => j.next_run_at > askedAt - 60_000), JSON.stringify(withSchedule.map((j) => [j.name, j.next_run_at])));
  check('گزارشِ صبحگاهی ساعتش را از تنظیماتِ دستیار می‌گیرد', jobs.find((j) => j.name === 'agent-morning-report')?.schedule === '0 8 * * *');
  check('کارهای رویدادی next_run_at ندارند', jobs.filter((j) => j.trigger === 'event').every((j) => j.next_run_at == null));
  check('کارهای هر ۳۰ ثانیه فاصلهٔ ثابت دارند', ['metrics', 'thermal-guard'].every((n) => jobs.find((j) => j.name === n)?.every === 30000));
  {
    const db = openDb();
    const v = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()?.v;
    check('مهاجرتِ ۰۰۵ اعمال شده', Number(v) >= 5, String(v));
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'automation_%'").all().map((r) => r.name);
    check('سه جدولِ اتوماسیون هست', ['automation_jobs', 'automation_runs', 'automation_events'].every((t) => tables.includes(t)), tables.join(','));
    const rows = db.prepare('SELECT COUNT(*) AS n FROM automation_jobs').get().n;
    check('هر کار یک ردیف در automation_jobs دارد', rows === jobs.length, `${rows} ≠ ${jobs.length}`);
    db.close();
  }

  /* ─────────────────────────── دسترسی ─────────────────────────────────── */
  console.log('\n── دسترسی ──');
  check('بی توکن ۴۰۱', (await api('GET', '/api/automation/jobs', undefined, null)).status === 401);
  await api('POST', '/api/auth/users', { username: 'viewer1', password: 'Viewer-1405-x', role: 'viewer' });
  const viewer = (await api('POST', '/api/auth/login', { username: 'viewer1', password: 'Viewer-1405-x' }, null)).json?.token;
  check('viewer فهرست را می‌بیند', (await api('GET', '/api/automation/jobs', undefined, viewer)).status === 200);
  check('viewer نمی‌تواند اجرا کند', (await api('POST', '/api/automation/jobs/db-vacuum/run', {}, viewer)).status === 403);
  check('viewer نمی‌تواند خاموش کند', (await api('PATCH', '/api/automation/jobs/db-vacuum', { enabled: false }, viewer)).status === 403);
  check('کارِ نبوده ۴۰۴', (await api('POST', '/api/automation/jobs/nope/run', {})).status === 404);
  const pub = await fetch(`http://127.0.0.1:${PORT + 1}/api/automation/jobs`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.status).catch(() => 0);
  check('روی پورتِ عمومی هیچ چیزی نیست', pub === 404, String(pub));

  /* ─────────────────────────── اجرای دستی ──────────────────────────────── */
  console.log('\n── اجرای دستی ثبت می‌شود ──');
  const vac = await api('POST', '/api/automation/jobs/db-vacuum/run', {});
  check('db-vacuum اجرا شد', vac.status === 200 && vac.json?.status === 'ok', JSON.stringify(vac.json).slice(0, 200));
  check('خروجی دارد', /کیلوبایت/.test(vac.json?.output || ''));
  const vacRuns = (await api('GET', '/api/automation/jobs/db-vacuum/runs?limit=5')).json?.items || [];
  check('یک ردیفِ اجرا با trigger=manual', vacRuns.length === 1 && vacRuns[0].trigger === 'manual' && vacRuns[0].status === 'ok');
  check('finished_at و duration_ms پر است', vacRuns[0]?.finished_at > 0 && vacRuns[0]?.duration_ms >= 0 && vacRuns[0]?.attempts === 1);
  const vacJob = (await api('GET', '/api/automation/jobs/db-vacuum')).json?.job;
  check('حالِ کار به‌روز شد (last_status=ok)', vacJob?.last_status === 'ok' && vacJob?.last_run_at > 0);
  const aud = (await api('GET', '/api/app-admin/audit?action=automation.run')).json?.entries || [];
  check('اجرای دستی در دفترِ حسابرسی است', aud.some((e) => e.target === 'db-vacuum' && e.actor === 'panel:admin'), JSON.stringify(aud.slice(0, 2)));

  /* ─────────────────────────────── قفل ─────────────────────────────────── */
  console.log('\n── قفل: هیچ کاری دو بار هم‌زمان ──');
  const first = api('POST', '/api/automation/jobs/test-sleep/run', {});
  await wait(300);
  const second = await api('POST', '/api/automation/jobs/test-sleep/run', {});
  check('اجرای دوم ۴۰۹ می‌گیرد', second.status === 409 && second.json?.error === 'already_running', JSON.stringify(second.json));
  const live = (await api('GET', '/api/automation/jobs/test-sleep')).json?.job;
  check('کار «در جریان» دیده می‌شود', live?.running === true);
  const firstRes = await first;
  check('اجرای اول سالم تمام شد', firstRes.status === 200 && firstRes.json?.status === 'ok' && firstRes.json?.durationMs >= 2400, JSON.stringify(firstRes.json).slice(0, 200));
  const sleepRuns = (await api('GET', '/api/automation/jobs/test-sleep/runs')).json?.items || [];
  check('ردیفِ «skipped» با دلیلِ already_running ثبت شد', sleepRuns.some((r) => r.status === 'skipped' && r.error === 'already_running'), JSON.stringify(sleepRuns.map((r) => [r.status, r.error])));
  check('و ردیفِ ok هم هست', sleepRuns.some((r) => r.status === 'ok'));

  /* ─────────────────────────── تلاشِ دوباره ────────────────────────────── */
  console.log('\n── تلاشِ دوباره با فاصله، بعد failed و onFail ──');
  const fail = await api('POST', '/api/automation/jobs/test-fail/run', {});
  check('نتیجه failed است', fail.json?.status === 'failed' && fail.json?.ok === false, JSON.stringify(fail.json).slice(0, 200));
  check('سه تلاش', fail.json?.attempts === 3);
  check('فاصلهٔ ۵۰ + ۱۰۰ میلی‌ثانیه رعایت شد', fail.json?.durationMs >= 150 && fail.json?.durationMs < 5000, String(fail.json?.durationMs));
  check('خطای آخر ثبت شد', /تلاشِ 3/.test(fail.json?.error || ''));
  check('خروجی هر سه تلاش و onFail را دارد', /تلاشِ 1[\s\S]*تلاشِ 2[\s\S]*تلاشِ 3[\s\S]*onFail/.test(fail.json?.output || ''));
  {
    const db = openDb();
    const row = db.prepare("SELECT * FROM automation_runs WHERE job = 'test-fail' ORDER BY id DESC LIMIT 1").get();
    check('در دیتابیس: status=failed، attempts=3، finished_at پر', row?.status === 'failed' && row?.attempts === 3 && row?.finished_at > 0);
    const st = db.prepare("SELECT last_status FROM automation_jobs WHERE name = 'test-fail'").get();
    check('last_status کار failed شد', st?.last_status === 'failed');
    db.close();
  }
  const evs = (await api('GET', '/api/automation/events?limit=50')).json?.items || [];
  check('onFail رویدادش را داد و ثبت شد', evs.some((e) => e.name === 'test.failed' && e.source === 'job:test-fail'), JSON.stringify(evs.slice(0, 3)));

  console.log('\n── مهلت ──');
  const to = await api('POST', '/api/automation/jobs/test-timeout/run', {});
  check('از مهلت گذشت ⇒ timeout، بی تلاشِ دوباره', to.json?.status === 'timeout' && to.json?.attempts === 1 && to.json?.durationMs < 3000, JSON.stringify(to.json).slice(0, 200));

  /* ─────────────────────── رویدادِ واقعی: ورودِ مشکوک ───────────────────── */
  console.log('\n── رویدادِ واقعی: پنج ورودِ ناموفق ⇒ login.suspicious ⇒ هشدار ──');
  for (let i = 0; i < 5; i++) await api('POST', '/api/auth/login', { username: 'admin', password: 'wrong-' + i }, null);
  await wait(800);
  const evs2 = (await api('GET', '/api/automation/events?name=login.suspicious')).json?.items || [];
  check('رویدادِ login.suspicious از auth ثبت شد', evs2.some((e) => e.payload?.reason === 'burst' && e.payload?.failures >= 5), JSON.stringify(evs2[0]));
  const slRuns = (await api('GET', '/api/automation/jobs/suspicious-login-alert/runs')).json?.items || [];
  check('کارِ رویدادی اجرا شد (trigger=event) و بار را گرفت', slRuns.some((r) => r.trigger === 'event' && r.status === 'ok' && r.payload?.reason === 'burst'), JSON.stringify(slRuns.map((r) => [r.trigger, r.status])));
  const alerts = (await api('GET', '/api/control/alerts')).json?.alerts || [];
  check('هشدارِ ورودِ مشکوک در مرکز فرمان باز است', alerts.some((a) => a.kind === 'login_suspicious' && a.severity === 'critical'), JSON.stringify(alerts.map((a) => a.kind)));
  const evLog = (await api('GET', '/api/automation/events')).json;
  check('فهرستِ رویدادهای شناخته همراهِ پاسخ است', evLog?.known && 'service.down' in evLog.known && 'disk.high' in evLog.known);

  /* ─────────────────────── روشن/خاموش و زمان‌بند ────────────────────────── */
  console.log('\n── روشن/خاموش و زمان‌بند ──');
  /*
   *  ⚠️ `test-minutely` واقعاً دقیقه‌ای است و زمان‌بند از لحظهٔ بالا آمدنِ
   *  سرور رویش کار می‌کند. پس «تا حالا هیچ‌وقت نباید دویده باشد» ادعای
   *  غلطی بود: اگر آزمون از مرزِ یک دقیقه رد می‌شد — روی رانرِ کندِ CI
   *  همین شد (اجرای #۱۵۴) — یک اجرای کاملاً **سالم** آن‌جا بود و سنجه
   *  سرخ می‌شد در حالی که هیچ چیزی خراب نبود. و برعکسش هم بود: سنجهٔ
   *  «کارِ روشن دوید» می‌توانست با همان اجرای قدیمی سبزِ دروغ بدهد.
   *
   *  پس ترتیب عوض شد تا به ساعتِ دیوار بند نباشد: اول عمداً یک اجرای
   *  زمان‌بندی‌شده می‌سازیم (همان شرطی که CI را سرخ کرد)، بعد خاموش
   *  می‌کنیم و می‌پرسیم «اجرای **تازه‌ای** اضافه شد؟». مرز، شناسهٔ آخرین
   *  اجراست، نه صفر بودنِ فهرست.
   */
  const runsOf = async () => (await api('GET', '/api/automation/jobs/test-minutely/runs')).json?.items || [];
  const maxId = (rows) => rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
  const pushToPast = () => {
    const db = openDb();
    db.prepare("UPDATE automation_jobs SET next_run_at = ? WHERE name = 'test-minutely'").run(Date.now() - 1000);
    db.close();
  };

  //  ۱) کارِ روشن با وقتِ گذشته باید در تیکِ بعدی بدود
  let mark = maxId(await runsOf());
  pushToPast();
  await wait(TICK_MS * 2 + 500);
  let fresh = (await runsOf()).filter((r) => Number(r.id) > mark);
  check('کارِ روشن با وقتِ گذشته در تیکِ بعدی اجرا شد (trigger=scheduled)', fresh.some((r) => r.trigger === 'scheduled' && r.status === 'ok'), JSON.stringify(fresh));
  const after = (await api('GET', '/api/automation/jobs/test-minutely')).json?.job;
  check('و next_run_at دوباره به آینده رفت', after?.next_run_at > Date.now() && after?.last_status === 'ok', String(after?.next_run_at));

  //  ۲) حالا که یک اجرای واقعی در دفتر هست، خاموشش می‌کنیم
  mark = maxId(await runsOf());
  const off = await api('PATCH', '/api/automation/jobs/test-minutely', { enabled: false });
  check('خاموش شد و next_run_at خالی', off.status === 200 && off.json?.job?.enabled === false && off.json?.job?.next_run_at == null, JSON.stringify(off.json));
  pushToPast();   // وقتش را دستی به گذشته می‌بریم — کارِ خاموش نباید بدود
  await wait(TICK_MS * 2 + 500);
  fresh = (await runsOf()).filter((r) => Number(r.id) > mark);
  check('کارِ خاموش با وقتِ گذشته هم اجرا نشد', fresh.length === 0, JSON.stringify(fresh));

  //  ۳) و روشن کردنِ دوباره، وقتِ بعدی را سرِ دقیقه می‌گذارد
  const on = await api('PATCH', '/api/automation/jobs/test-minutely', { enabled: true });
  const next = on.json?.job?.next_run_at;
  check('روشن شد و next_run_at سرِ دقیقهٔ بعد است', on.json?.job?.enabled === true && next > Date.now() && new Date(next).getSeconds() === 0 && next - Date.now() <= 60_000, String(next));

  const audT = (await api('GET', '/api/app-admin/audit?action=automation.toggle')).json?.entries || [];
  check('روشن/خاموش در دفترِ حسابرسی است', audT.length >= 2 && audT.every((e) => e.target === 'test-minutely'));

  /* ──────────────── پشتیبانِ هفتگی + آزمونِ بازگردانی + offsite ───────────── */
  console.log('\n── پشتیبانِ هفتگی: بازگردانیِ آزمایشی و ارسال به بیرون ──');
  const weekly = await api('POST', '/api/automation/jobs/backup-weekly/run', {});
  check('backup-weekly موفق', weekly.json?.status === 'ok', JSON.stringify(weekly.json).slice(0, 300));
  check('بازگردانیِ آزمایشی انجام و integrity ok شد', /آزمونِ بازگردانی[^\n]*integrity ok/.test(weekly.json?.output || ''), weekly.json?.output);
  check('شمارِ جدول و کاربران سنجیده شد', /"users":\d+/.test(weekly.json?.output || '') && /جدول/.test(weekly.json?.output || ''));
  const backupFiles = fs.existsSync(path.join(dataDir, 'backups')) ? fs.readdirSync(path.join(dataDir, 'backups')).filter((f) => f.endsWith('.db')) : [];
  check('فایلِ پشتیبان روی دیسک است', backupFiles.length >= 1, backupFiles.join(','));
  await wait(1500);
  const offRuns = (await api('GET', '/api/automation/jobs/offsite-push/runs')).json?.items || [];
  check('offsite-push با رویدادِ backup.done دوید', offRuns.some((r) => r.trigger === 'event' && r.status === 'ok' && r.payload?.kind === 'weekly'), JSON.stringify(offRuns.map((r) => [r.trigger, r.status, r.error])));
  const queue = path.join(dataDir, 'offsite-queue');
  check('نسخه در offsite-queue نشست', fs.existsSync(queue) && fs.readdirSync(queue).some((f) => f.endsWith('.db')), fs.existsSync(queue) ? fs.readdirSync(queue).join(',') : 'نیست');
  check('بی HLP_OFFSITE_CMD فقط در صف ماند', offRuns.some((r) => /تنظیم نیست/.test(r.output || '')));

  console.log('\n── پشتیبانِ روزانه و رویدادش ──');
  const daily = await api('POST', '/api/automation/jobs/backup-daily/run', {});
  check('backup-daily موفق و دور ریختن گزارش شد', daily.json?.status === 'ok' && /دور ریخته شد/.test(daily.json?.output || ''), JSON.stringify(daily.json).slice(0, 200));
  const bdEvents = (await api('GET', '/api/automation/events?name=backup.done')).json?.items || [];
  check('دو رویدادِ backup.done (هفتگی و روزانه) ثبت شده', bdEvents.filter((e) => ['weekly', 'daily'].includes(e.payload?.kind)).length >= 2);

  console.log('\n── کارهای دیگر واقعاً می‌دوند ──');
  for (const [n, expect] of [['health-check', /checked/], ['metrics', /sampledAt|نمونه‌ای نگرفته/], ['thermal-guard', /دما|سنسور/], ['temp-cleanup', /removed/], ['log-rotate', /rotated/], ['uptime', /checked|پایش|قبلی/], ['agent-idle-off', /unloaded|دستیار/]]) {
    const r = await api('POST', `/api/automation/jobs/${n}/run`, {});
    check(`${n} اجرا شد`, r.status === 200 && ['ok', 'skipped'].includes(r.json?.status) && expect.test(r.json?.output || ''), JSON.stringify(r.json).slice(0, 220));
  }
  const su = await api('POST', '/api/automation/jobs/security-updates/run', {});
  check('security-updates فقط گزارش می‌دهد (ok یا skipped، هرگز failed)', ['ok', 'skipped'].includes(su.json?.status), JSON.stringify(su.json).slice(0, 220));

  /* ───────────────────── هیچ اجرایی بی ثبتِ نتیجه ────────────────────────── */
  console.log('\n── دفتر ──');
  await wait(1500);
  {
    const db = openDb();
    const running = db.prepare("SELECT COUNT(*) AS n FROM automation_runs WHERE status = 'running'").get().n;
    const unfinished = db.prepare('SELECT COUNT(*) AS n FROM automation_runs WHERE finished_at IS NULL').get().n;
    const total = db.prepare('SELECT COUNT(*) AS n FROM automation_runs').get().n;
    check(`همهٔ ${total} اجرا نتیجه دارند (هیچ running/بی‌پایانی نمانده)`, running === 0 && unfinished === 0, `running=${running} unfinished=${unfinished}`);
    const bad = db.prepare("SELECT COUNT(*) AS n FROM automation_runs WHERE status NOT IN ('ok','failed','timeout','skipped')").get().n;
    check('وضعیت‌ها فقط از مجموعهٔ مجازند', bad === 0);
    db.close();
  }
  const recent = (await api('GET', '/api/automation/runs?limit=100')).json?.items || [];
  check('فهرستِ اجراهای اخیر کارهای پرتکرار را نمی‌آورد', recent.length > 0 && !recent.some((r) => ['metrics', 'thermal-guard'].includes(r.job)));
  const recentAll = (await api('GET', '/api/automation/runs?limit=200&all=1')).json?.items || [];
  check('ولی با all=1 همه هستند', recentAll.some((r) => r.job === 'metrics'));
  const status = (await api('GET', '/api/automation/status')).json;
  check('حالِ موتور: بالا و بی کارِ در جریان', status?.started === true && Array.isArray(status.running) && status.running.length === 0, JSON.stringify(status).slice(0, 200));
  check('سرور در طولِ آزمون خطای اتوماسیون چاپ نکرد', !/automation.*(TypeError|ReferenceError)|Cannot read|is not a function/.test(out), out.split('\n').filter((l) => /Error/.test(l)).slice(0, 3).join(' | '));
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  child.kill('SIGTERM');
  await wait(800);
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed === 0 ? 0 : 1);
