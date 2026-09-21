// ---------------------------------------------------------------------------
//  ربات‌های گامِ ۵ — با سرورِ حسابِ ساختگی و پنلِ واقعی
//      node test/bots.mjs
//
//  ⛔ **هر ده قاعدهٔ بندِ ۵.۰ سنجهٔ خودش را دارد.** سندی که قاعده بنویسد و
//  کسی نسنجدش از نبودنش بدتر است — همان درسی که `remake-spec.mjs` را
//  ساخت.
//
//  ⚠️ و بیشترِ بندها **رفتاری**‌اند، نه گشتنِ سورس: ربات واقعاً می‌دود،
//  سرورِ حسابِ ساختگی جواب می‌دهد، و بعد `automation_runs` و
//  `automation_events` خوانده می‌شوند.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4931);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-bots-'));
const dataDir = path.join(tmp, 'data');
fs.mkdirSync(path.join(tmp, 'sites'), { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 300)}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const NOW = Date.now();
const DAY = 86400_000;
const HOUR = 3600_000;

/*  ══ سرورِ حسابِ ساختگی ═══════════════════════════════════════════════════
 *  حالِ عمدی: یک پمپ رو به پایان، یکی با پشتیبانِ دیرکرده، یک دکانِ
 *  بی‌اشتراک، رباتِ ایمیلِ تنظیم‌نشده، و یک کدِ نرفته.
 */
const state = {
  mailProvider: 'log',
  rateLimit: false,
  resends: [],
  stations: [
    { id: 'st-1', name: 'پمپِ یک', owner_email: 'a@x.com', sub_status: 'active', ends_at: NOW + 3 * DAY, plan: 'm1' },
    { id: 'st-2', name: 'پمپِ دو', owner_email: 'b@x.com', sub_status: 'active', ends_at: NOW + 200 * DAY, plan: 'm1' },
  ],
  details: {
    'st-1': { last_backup_at: NOW - 2 * HOUR, home_seen_at: NOW - 5 * 60_000 },
    //  ⛔ پشتیبانِ ۳۰ ساعته — بالاتر از ۲۶ ساعتِ خودِ برنامهٔ پمپ
    'st-2': { last_backup_at: NOW - 30 * HOUR, home_seen_at: NOW - 6 * HOUR },
  },
  shops: [
    { id: 'sh-1', name: 'دکانِ یک', owner_email: 'c@x.com', sub_status: 'none', ends_at: 0, plan: '' },
  ],
  /*
   *  دو راهِ «نرفت»، و عمداً جدا — چون رفتارِ `code-rescue` برایشان
   *  **باید** فرق کند:
   *    · `req-1` سرور تلاش کرد و SMTP ردش کرد ⇒ دوباره فرستادن معنا دارد
   *    · `req-2` رباتِ `log` بود ⇒ فرستادنِ دوباره یعنی یک ردیفِ
   *      «فرستادم» و صفر ایمیل، پس اصلاً نباید تلاش شود
   */
  logins: [
    { request_id: 'req-1', app: 'pump', email: 'a@x.com', masked_email: 'a***@x.com',
      created_at: NOW - 60_000, expires_at: NOW + 500_000, active: true, state: 'failed',
      reason: 'smtp_error', last_error: 'SMTP refused', code_attempts: 0 },
    { request_id: 'req-2', app: 'shop', email: 'c@x.com', masked_email: 'c***@x.com',
      created_at: NOW - 70_000, expires_at: NOW + 500_000, active: true, state: 'sent',
      reason: 'log_only', code_attempts: 0 },
  ],
  otp: [
    { id: 'otp-1', app: 'shop', destination: 'c@x.com', masked_destination: 'c***@x.com',
      purpose: 'register', created_at: NOW - 90_000, expires_at: NOW + 400_000,
      active: true, via: 'log', log_only: true, sent_at: NOW - 90_000, attempts: 0 },
  ],
};

const seen = [];
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, server: 'online', version: '9.9.9' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * HOUR });
    seen.push({ method: req.method, path: p, query: Object.fromEntries(u.searchParams) });
    if (state.rateLimit && p !== '/api/admin/email') {
      return j(429, { error: { code: 'rate_limited', message: 'تعداد درخواست بیش از حد' } });
    }
    let m;
    if (p === '/api/admin/pump/stations') return j(200, { stations: state.stations, total: state.stations.length });
    if (p === '/api/admin/shops') return j(200, { shops: state.shops, total: state.shops.length });
    if ((m = /^\/api\/admin\/pump\/stations\/([^/]+)$/.exec(p))) {
      const d = state.details[m[1]];
      if (!d) return j(404, { error: { code: 'not_found', message: 'نیست' } });
      return j(200, { station: { id: m[1], ...d } });
    }
    /*
     *  ⛔ **همان لایه‌ای که سرورِ حسابِ واقعی می‌دهد**: `admin-platform.js`
     *  پاسخ را در `{ email: … }` می‌پیچد. ساختگیِ صاف، بندِ «رباتِ ایمیل
     *  تنظیم است» را سبزِ دروغ می‌کرد در حالی که ربات روی سرورِ واقعی
     *  همیشه می‌گفت تنظیم نیست.
     */
    if (p === '/api/admin/email') return j(200, { email: { provider: state.mailProvider } });
    if (p === '/api/admin/logins') return j(200, { requests: state.logins });
    if (p === '/api/admin/otp') return j(200, { requests: state.otp });
    if ((m = /^\/api\/admin\/(logins|otp)\/([^/]+)\/resend$/.exec(p)) && req.method === 'POST') {
      state.resends.push(`${m[1]}/${m[2]}`);
      return j(200, { ok: true, via: 'smtp' });
    }
    return j(404, { error: { code: 'not_found', message: 'این مسیر وجود ندارد' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const FAKE_PORT = fake.address().port;

const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'),
  env: {
    ...process.env,
    HLP_PORT: String(PORT), HLP_SITESYNC_PORT: String(PORT + 1), HLP_HOST: '127.0.0.1',
    HLP_DATA_DIR: dataDir, HLP_SITES_ROOT: path.join(tmp, 'sites'),
    HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_SITESYNC: '1',
    HLP_ACCOUNT_API: `http://127.0.0.1:${FAKE_PORT}`, HLP_ACCOUNT_AUTOSTART: '0',
    HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret',
    HLP_AUTOMATION_TICK_MS: '2000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));

let token = '';
const api = async (method, url, body) => {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* بدنه نداشت */ }
  return { status: res.status, json };
};

/** یک کار را می‌دواند و نتیجهٔ ثبت‌شده‌اش را برمی‌گرداند. */
const runJob = async (name) => {
  const r = await api('POST', `/api/automation/jobs/${name}/run`, {});
  for (let i = 0; i < 80; i++) {
    const runs = (await api('GET', `/api/automation/jobs/${name}/runs?limit=3`)).json?.items || [];
    const fresh = runs.find((x) => x.status !== 'running');
    if (fresh) return { start: r, run: fresh };
    await wait(250);
  }
  return { start: r, run: null };
};

const events = async (name) =>
  (await api('GET', `/api/automation/events?name=${encodeURIComponent(name)}&limit=50`)).json?.items || [];

const here = path.dirname(new URL(import.meta.url).pathname);
const src = (rel) => fs.readFileSync(path.join(here, '..', 'src', rel), 'utf8');

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await wait(250);
  }
  token = (await api('POST', '/api/auth/setup', { username: 'admin', password: 'ControlCenter!2026' })).json?.token;
  check('پنل بالا آمد و مدیر ساخته شد', Boolean(token), out.slice(-600));

  /* ══ ۵.۰ — ده قاعده ══════════════════════════════════════════════════ */
  console.log('\n── ۵.۰ ده قاعده ──');
  const jobs = (await api('GET', '/api/automation/jobs')).json?.items || [];
  const byName = Object.fromEntries(jobs.map((j) => [j.name, j]));
  const BOTS = ['pump-watch', 'shop-watch', 'login-watch', 'code-rescue'];

  //  ۱) هیچ رباتی setInterval ندارد — هر چهارتا `defineJob`اند
  check('۱ ⛔ هر چهار ربات کارِ ثبت‌شدهٔ موتورند', BOTS.every((n) => byName[n]), Object.keys(byName).join(','));
  const botSrc = ['automation/bots/watch.js', 'automation/bots/upstream.js', 'automation/bots/rescue.js', 'automation/jobs/bots.js']
    .map((f) => src(f)).join('\n');
  check('۱ ⛔ و هیچ `setInterval`ی در کدِ ربات‌ها نیست', !/setInterval\(/.test(botSrc));

  //  ۲) هر اجرا ثبت می‌شود — خودِ موتور می‌نویسد
  const pumpRun = await runJob('pump-watch');
  check('۲ ⛔ اجرای ربات در دفتر نشست', pumpRun.run?.status === 'ok', JSON.stringify(pumpRun.run));

  //  ۳) دفترِ دوم ساخته نمی‌شود
  check('۳ ⛔ ربات هیچ جدولی نمی‌سازد', !/CREATE TABLE/i.test(botSrc));
  check('۳ ⛔ و از همان پلِ موجود می‌خواند', /cloudRaw/.test(botSrc));

  //  ۴) رمز خوانده و نوشته نمی‌شود
  check('۴ ⛔ هیچ رمزی در کدِ ربات‌ها نیست',
    !/password|passwordHash|رمزِ خام|hashPassword/i.test(botSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));

  //  ۵) یک خبر برای یک حال — دومین اجرا خبرِ تازه نمی‌دهد
  const before = (await events('bot.subscription_expiring')).length;
  check('۵ ⛔ اشتراکِ رو به پایان خبر داد', before >= 1, String(before));
  await runJob('pump-watch');
  const after = (await events('bot.subscription_expiring')).length;
  check('۵ ⛔ و دورِ دوم همان خبر را دوباره نداد', after === before, `${before} ⇒ ${after}`);

  //  و متنِ خبر **عدد** دارد (بندِ ۵.۴)
  const expEv = (await events('bot.subscription_expiring'))[0];
  check('۵.۴ ⛔ متنِ خبر عدد دارد، نه «رو به پایان»',
    /\d+\s*روز دیگر تمام می‌شود/.test(String(expEv?.payload?.text || '')), JSON.stringify(expEv?.payload));

  //  ۸) هر یافته یک رویداد است — ربات خودش ایمیل نمی‌زند
  check('۸ ⛔ ربات خودش ایمیل نمی‌زند', !/sendCodeEmail|nodemailer|createTransport/.test(botSrc));

  // ۱۰) بی مدل کار می‌کند
  check('۱۰ ⚠️ ربات به مدلِ هوش مصنوعی بند نیست', !/ollama|agent\/chat/i.test(botSrc));

  /* ══ ۵.۱ — رباتِ پمپ ═════════════════════════════════════════════════ */
  console.log('\n── ۵.۱ رباتِ پمپ ──');
  const lateEv = await events('bot.backup_late');
  check('۵.۱ پشتیبانِ ۳۰ ساعته دیرکرده شناخته شد',
    lateEv.some((e) => e.payload?.tenantId === 'st-2'), JSON.stringify(lateEv.map((e) => e.payload?.tenantId)));
  //  ⛔ و پشتیبانِ ۲ ساعته هشدار نگرفت — وگرنه هر پمپِ سالمی سرخ می‌شد
  check('⛔ و پشتیبانِ تازه هشدار نگرفت', !lateEv.some((e) => e.payload?.tenantId === 'st-1'));
  const staleEv = await events('bot.live_stale');
  check('۵.۱ عکسِ زندهٔ ۶ ساعته کهنه شناخته شد', staleEv.some((e) => e.payload?.tenantId === 'st-2'));
  check('⛔ و عکسِ پنج‌دقیقه‌ای کهنه شمرده نشد', !staleEv.some((e) => e.payload?.tenantId === 'st-1'));

  /* ══ ۵.۲ — رباتِ فروشگاه، همان کد ════════════════════════════════════ */
  console.log('\n── ۵.۲ رباتِ فروشگاه ──');
  const shopRun = await runJob('shop-watch');
  check('۵.۲ رباتِ فروشگاه دوید', shopRun.run?.status === 'ok', JSON.stringify(shopRun.run));
  check('۵.۲ و دکانِ بی‌اشتراک را دید',
    (await events('bot.no_subscription')).some((e) => e.payload?.tenantId === 'sh-1'));
  /*
   *  ⛔ **«جداگانه» یعنی دو کار، نه دو رونوشت.** با دو نسخه، روزی یکی
   *  اصلاح می‌شود و دیگری نه — و آن‌وقت کارتِ یک بخش سرخ است و بخشِ
   *  دیگر ساکت.
   */
  check('۵.۲ ⛔ و منطقش یک بار نوشته شده، نه دو بار',
    /runWatch\(/.test(src('automation/jobs/bots.js'))
    && (src('automation/jobs/bots.js').match(/runWatch\(/g) || []).length === 1);

  /* ══ ۵.۳ — رباتِ بالادست ═════════════════════════════════════════════ */
  console.log('\n── ۵.۳ رباتِ بالادست ──');
  const loginRun = await runJob('login-watch');
  check('۵.۳ رباتِ ورود دوید', loginRun.run?.status === 'ok', JSON.stringify(loginRun.run));
  check('۵.۳ ⛔ رباتِ ایمیلِ تنظیم‌نشده بحرانی‌ترین یافته است',
    (await events('bot.mail_not_configured')).length >= 1);
  //  هر دو دفترِ کد خوانده شدند
  check('۵.۳ هر دو دفترِ کد خوانده شد',
    seen.some((s) => s.path === '/api/admin/logins') && seen.some((s) => s.path === '/api/admin/otp'));
  //  و کدِ نرفته رویداد ساخت ⇒ ورودیِ ۵.۵
  const failEv = await events('code.delivery_failed');
  check('۵.۳ کدهای نرفته رویداد ساختند', failEv.length >= 1, String(failEv.length));

  /* ══ ۵.۵ — نجاتِ کد ══════════════════════════════════════════════════ */
  console.log('\n── ۵.۵ نجاتِ کد ──');
  //  ⛔ رویدادی است، نه دوره‌ای
  check('۵.۵ ⛔ کارش رویدادی است، نه زمان‌بندی‌شده',
    byName['code-rescue']?.trigger === 'event' && byName['code-rescue']?.next_run_at == null,
    JSON.stringify(byName['code-rescue']));
  /*
   *  ⛔ **با رباتِ ایمیلِ تنظیم‌نشده اصلاً تلاش نمی‌کند.** `req-1` مهرِ
   *  `log_only` دارد، پس هیچ `resend`ی نباید زده شده باشد — وگرنه سه
   *  ردیفِ «فرستادم» در دفتر و صفر ایمیل در دنیا.
   */
  await wait(2000);
  /*
   *  ⛔ و این بند **مثبت** سنجیده می‌شود، نه فقط با «چیزی نرفت»: یک
   *  «نرفت» می‌تواند از نرسیدنِ رویداد هم بیاید و سنجه سبزِ دروغ بدهد.
   *  پس اول ثابت می‌شود که کارِ نجات برای همان کد **واقعاً دوید**، و بعد
   *  که تصمیمش «تلاش نکن، چون رباتِ ایمیل تنظیم نیست» بود.
   */
  const rescueRuns = (await api('GET', '/api/automation/jobs/code-rescue/runs?limit=20')).json?.items || [];
  /*
   *  ⛔ **یک اجرا برای دستهٔ کدها، نه یکی برای هر کد** — و این بند از یک
   *  باگِ واقعی درآمد: با رویدادِ تک‌کدی، قفلِ کار دو تا از سه کد را
   *  `already_running` می‌کرد و آن‌ها برای همیشه گم می‌شدند، با دفترِ
   *  کاملاً سبز. سنجه گرفتش، نه بازبینیِ چشمی.
   */
  check('۵.۵ کارِ نجات دوید و هیچ اجرایی به قفل نخورد',
    rescueRuns.length >= 1 && !rescueRuns.some((r) => r.error === 'already_running'),
    JSON.stringify(rescueRuns.map((r) => [r.status, r.error])));
  check('۵.۵ ⛔ و هر سه کدِ نرفته در همان یک اجرا رسیدگی شدند',
    rescueRuns.some((r) => /"count":3/.test(String(r.output || ''))),
    JSON.stringify(rescueRuns.map((r) => String(r.output || '').slice(0, 70))));
  check('۵.۵ ⛔ و برای کدِ «فقط در لاگ» تصمیمش «تلاش نکن» بود',
    rescueRuns.some((r) => String(r.output || '').includes('mail_not_configured')),
    JSON.stringify(rescueRuns.map((r) => String(r.output || '').slice(0, 60))));
  check('۵.۵ ⛔ پس کدِ «فقط در لاگ» دوباره فرستاده نشد',
    !state.resends.some((x) => x === 'logins/req-2') && !state.resends.some((x) => x === 'otp/otp-1'),
    state.resends.join(','));
  //  ⚠️ ولی کدی که سرور تلاش کرد و SMTP ردش کرد، دوباره می‌رود
  check('۵.۵ ⚠️ ولی کدی که سرور ردش کرد دوباره رفت',
    state.resends.some((x) => x === 'logins/req-1'), state.resends.join(','));

  //  حداکثر دو تلاش
  const runsOf = async () => (await api('GET', '/api/automation/jobs/code-rescue/runs?limit=20')).json?.items || [];
  for (let i = 0; i < 3; i++) {
    await api('POST', '/api/automation/jobs/code-rescue/run',
      { payload: { id: 'req-1', source: 'account', app: 'pump', email: 'a@x.com' } });
    await wait(600);
  }
  const otpTries = state.resends.filter((x) => x === 'logins/req-1').length;
  check('۵.۵ ⛔ حداکثر دو تلاش، نه حلقهٔ بی‌پایان', otpTries <= 2, String(otpTries));

  /* ══ و حالِ **سالم** هم سنجیده می‌شود، نه فقط حالِ خراب ══════════════
   *
   *  ⛔ این بند از یک باگِ واقعی درآمد (۱۴۰۵/۰۷/۱۱): ربات شکلِ پاسخِ
   *  رباتِ ایمیل را غلط می‌خواند (`{provider}` به‌جای `{email:{provider}}`)،
   *  پس **همیشه** می‌گفت «تنظیم نیست» — حتی با SMTPِ کاملاً درست. و
   *  هیچ بندی نمی‌گرفتش، چون همهٔ بندهای بالا فقط حالِ `log` را
   *  می‌سنجیدند: سنجه‌ای که فقط یک طرفِ شرط را ببیند، نصفِ کد را بی‌سنجه
   *  می‌گذارد.
   *
   *  ⚠️ همان درسِ `account-link.mjs`: «هر دو حال سنجیده می‌شود» — بی
   *  SMTP هشدار، با SMTP سکوت.
   */
  console.log('\n── ۵.۳ب رباتِ ایمیلِ **تنظیم‌شده** ──');
  state.mailProvider = 'smtp';
  const warnBefore = (await events('bot.mail_not_configured')).length;
  const okRun = await runJob('login-watch');
  check('۵.۳ب رباتِ ورود با SMTPِ تنظیم‌شده هم می‌دود', okRun.run?.status === 'ok',
    JSON.stringify(okRun.run));
  check('۵.۳ب ⛔ و دیگر «رباتِ ایمیل تنظیم نیست» نمی‌گوید',
    (await events('bot.mail_not_configured')).length === warnBefore,
    `${warnBefore} ⇒ ${(await events('bot.mail_not_configured')).length}`);

  //  ⛔ و کارِ درست‌کننده‌اش هم آزاد می‌شود: کدی که با ربات‌ِ خاموش
  //  «تلاش نکن» گرفته بود، حالا واقعاً دوباره می‌رود.
  await api('POST', '/api/automation/jobs/code-rescue/run',
    { payload: { id: 'otp-1', source: 'account-otp', app: 'pump', email: 'a@x.com' } });
  await wait(900);
  check('۵.۳ب ⛔ و حالا کدِ قبلاً رهاشده واقعاً دوباره فرستاده شد',
    state.resends.some((x) => x === 'otp/otp-1'), state.resends.join(','));
  check('۵.۵ و تلاشِ سوم در دفتر «رد شد» ثبت می‌شود',
    (await runsOf()).some((r) => String(r.output || '').includes('max_tries')),
    JSON.stringify((await runsOf()).slice(0, 3).map((r) => String(r.output || '').slice(0, 80))));

  /* ══ ۵.۶ — سرورِ خواب ⇒ هشدار، نه سکوت ═══════════════════════════════ */
  console.log('\n── ۵.۶ سرورِ خواب ──');
  fake.close();
  await wait(300);
  const downRun = await runJob('pump-watch');
  const downRes = String(downRun.run?.output || '');
  check('۵.۶ ⛔ با سرورِ خاموش، «نسنجیده» ثبت می‌شود نه «سالم»',
    downRes.includes('unchecked') && !downRes.includes('"findings":[{'), downRes.slice(0, 200));
  check('۵.۶ ⛔ و شمارِ سنجیده‌شده‌ها صفر است، نه عددِ دروغ',
    /"checked":0/.test(downRes), downRes.slice(0, 200));

  /* ══ ۵.۷ — سقفِ نرخ ══════════════════════════════════════════════════ */
  console.log('\n── ۵.۷ سقفِ نرخ ──');
  /*
   *  ⛔ درسِ ۱.۴۷.۴: تلاشِ تکراریِ بی‌مهلت خودش سقف را پر می‌کند و بعد
   *  **حتی با رمزِ درست** هیچ‌وقت وارد نمی‌شود. پس ربات روی ۴۲۹ باید
   *  همان دور را رها کند، نه این‌که به حسابِ بعدی برود و باز بزند.
   */
  check('۵.۷ ⛔ ربات روی ۴۲۹ همان دور را رها می‌کند',
    /rateLimited = true/.test(src('automation/bots/watch.js'))
    && /unchecked\.push\(\{ tenantId: tenant\.id, why: 'rate_limited' \}\)/.test(src('automation/bots/watch.js')));
  check('۵.۷ ⛔ و یک تلاش بیشتر ندارد (تلاشِ دوباره سقف را پر می‌کند)',
    BOTS.every((n) => byName[n]?.attempts === 1 || byName[n]?.attempts == null),
    JSON.stringify(BOTS.map((n) => [n, byName[n]?.attempts])));

  /* ══ عددهای زمان‌بندی ════════════════════════════════════════════════ */
  console.log('\n── عددهای زمان‌بندی ──');
  check('⚠️ ربات‌های حساب هر ۱۵ دقیقه (سقفِ ورود ده در ربع ساعت است)',
    byName['pump-watch']?.every === 15 * 60_000 && byName['shop-watch']?.every === 15 * 60_000,
    `${byName['pump-watch']?.every} / ${byName['shop-watch']?.every}`);
  check('⚠️ رباتِ بالادست هر ۵ دقیقه', byName['login-watch']?.every === 5 * 60_000, String(byName['login-watch']?.every));
  check('⛔ و ۲۶ ساعتِ پشتیبان همان عددِ خودِ برنامهٔ پمپ است',
    /26 \* HOUR/.test(src('automation/bots/watch.js')));
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  child.kill('SIGTERM');
  try { fake.close(); } catch { /* بسته */ }
  await wait(400);
  child.kill('SIGKILL');
  await fsp.rm(tmp, { recursive: true, force: true });
}

if (fail) console.log('\n' + out.slice(-2000));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
