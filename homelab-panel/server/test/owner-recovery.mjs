// ---------------------------------------------------------------------------
//  بازیابیِ مالکِ اصلی از خطِ فرمانِ خودِ سرور — `vill3n owner-reset`
//      node test/owner-recovery.mjs
//
//  فاز ۱ ِ ممیزیِ پنلِ مرکزی، ۶-۳ / S6 (۱۴۰۵/۰۸/۰۹): رمزِ فراموش‌شده + گم شدنِ
//  اپِ دوعاملی تا امروز یعنی دست‌کاریِ دستیِ دیتابیس. این آزمون روی **پنلِ
//  واقعیِ در حالِ اجرا** و **همان دستورِ واقعی** می‌سنجد که:
//    • بی `--yes` (و بی ترمینال) هیچ چیزی عوض نمی‌شود
//    • پیش از تغییر پشتیبانِ دیتابیس گرفته می‌شود و باز می‌شود
//    • همهٔ نشست‌ها — مالک، مدیرِ دوم، بیننده — همان لحظه می‌میرند
//    • رمزِ قدیمی دیگر کار نمی‌کند، دوعاملی خاموش است
//    • رمزِ تازه یک‌بارمصرف است: با آن فقط «رمزِ تازه بگذار» باز است (سرور اجبار می‌کند)
//    • یک ردیفِ `panel.owner.reset` در دفترِ رخدادها، با جزئیاتِ JSON
//    • ⛔ هیچ درِ HTTPی برای این کار نیست
//    • مالک همان مالک می‌ماند و پس از رمزِ تازه همه‌چیز عادی است
// ---------------------------------------------------------------------------
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { totp } from '../src/lib/totp.js';

const PORT = Number(process.env.TEST_PORT || 4867);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-owner-'));
const dataDir = path.join(tmp, 'data');
const VILL3N = path.join(import.meta.dirname, '..', 'bin', 'vill3n.mjs');
const SRC = path.join(import.meta.dirname, '..', 'src');

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`); }
};

const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(SRC, 'index.js')], {
  env: {
    ...process.env, HLP_PORT: String(PORT), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: dataDir,
    HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_SITESYNC: '0',
    HLP_ACCOUNT_AUTOSTART: '0', HLP_RATE_LOGIN: '1000', HLP_DISCOVERY: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));

async function call(method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* */ }
  return { status: r.status, json, text };
}

/** همان دستوری که صاحبِ سامانه روی سرور می‌زند — بی HLP_DATA_DIR ِ محیط، فقط با --data-dir */
function reset(...extra) {
  const env = { ...process.env, VILL3N_ROOT: path.join(tmp, 'no-such-root') };
  delete env.HLP_DATA_DIR;
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', VILL3N, 'owner-reset', '--data-dir', dataDir, ...extra], {
    env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000,
  });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* متن */ }
  return { code: r.status, out: `${r.stdout}${r.stderr}`, json };
}

try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log('\n── پیش از بازیابی: مالک با دوعاملی، مدیرِ دوم، بیننده ──');
  const setup = await call('POST', '/api/auth/setup', { username: 'owner', password: 'Owner-Original-2026' });
  const tOwner = setup.json?.token;
  check('مالک ساخته شد', Boolean(tOwner), setup.text);
  const s = await call('POST', '/api/auth/totp/setup', {}, tOwner);
  const en = await call('POST', '/api/auth/totp/enable', { code: totp(s.json?.secret) }, tOwner);
  check('دوعاملیِ مالک روشن شد', en.status === 200, en.text);
  await call('POST', '/api/auth/users', { username: 'admin2', password: 'Admin2-Pass-2026', role: 'admin' }, tOwner);
  await call('POST', '/api/auth/users', { username: 'viewer1', password: 'Viewer-Pass-2026', role: 'viewer' }, tOwner);
  const tAdmin2 = (await call('POST', '/api/auth/login', { username: 'admin2', password: 'Admin2-Pass-2026' })).json?.token;
  const tViewer = (await call('POST', '/api/auth/login', { username: 'viewer1', password: 'Viewer-Pass-2026' })).json?.token;
  check('مدیرِ دوم و بیننده وارد شدند', Boolean(tAdmin2 && tViewer));
  const step1 = await call('POST', '/api/auth/login', { username: 'owner', password: 'Owner-Original-2026' });
  check('ورودِ مالک دوگامی است (رمز + کد)', step1.json?.totpRequired === true, step1.text);

  console.log('\n── ⛔ بی تأیید هیچ چیز عوض نمی‌شود ──');
  const noYes = reset('--json');
  check('بی --yes و بی ترمینال ⇒ کدِ ۲', noYes.code === 2, noYes.out);
  check('و نشستِ مالک هنوز زنده است', (await call('GET', '/api/auth/me', undefined, tOwner)).status === 200);
  const noUser = reset('--yes', '--json', '--user', 'nobody-here');
  check('کاربرِ ناموجود ⇒ کدِ ۱، بی تغییر', noUser.code === 1 && (await call('GET', '/api/auth/me', undefined, tOwner)).status === 200, noUser.out);
  const noDb = spawnSync(process.execPath, [VILL3N, 'owner-reset', '--yes', '--data-dir', path.join(tmp, 'nowhere')], {
    env: { ...process.env, HLP_DATA_DIR: '', VILL3N_ROOT: path.join(tmp, 'no-such-root') }, encoding: 'utf8',
  });
  check('دیتابیسِ پیدانشده ⇒ کدِ ۱ و پیامِ روشن', noDb.status === 1 && /panel\.db/.test(noDb.stdout), noDb.stdout);

  console.log('\n── vill3n owner-reset روی پنلِ در حالِ اجرا ──');
  const r = reset('--yes', '--json');
  check('دستور موفق برگشت', r.code === 0 && r.json?.ok === true, r.out);
  const otp = r.json?.oneTimePassword || '';
  check('برای همان مالک (قدیمی‌ترین مدیر)', r.json?.username === 'owner', JSON.stringify(r.json));
  check('رمزِ یک‌بارمصرفِ بلند و تصادفی', /^[A-Za-z0-9]{5}(-[A-Za-z0-9]{5}){3}$/.test(otp), otp.length);
  check('همهٔ نشست‌ها شمرده و باطل شدند (≥۳)', r.json?.sessionsRevoked >= 3, String(r.json?.sessionsRevoked));
  check('دوعاملی خاموش شد', r.json?.totpReset === true);
  const bk = r.json?.backup || '';
  check('پشتیبان پیش از تغییر در پوشهٔ backups', fs.existsSync(bk) && path.dirname(bk) === path.join(dataDir, 'backups'), bk);
  if (fs.existsSync(bk)) {
    const b = new DatabaseSync(bk, { readOnly: true });
    const row = b.prepare("SELECT totp_enabled, must_change_password FROM users WHERE username = 'owner'").get();
    b.close();
    check('و پشتیبان حالِ **پیش** از بازیابی را دارد (دوعاملی روشن، رمزِ عادی)', row?.totp_enabled === 1 && row?.must_change_password === 0, JSON.stringify(row));
  }

  console.log('\n── همهٔ نشست‌ها مردند، رمزِ قدیمی هم ──');
  const dead = await Promise.all([tOwner, tAdmin2, tViewer].map((t) => call('GET', '/api/auth/me', undefined, t)));
  check('مالک، مدیرِ دوم و بیننده همه ۴۰۱', dead.every((x) => x.status === 401), dead.map((x) => x.status).join(' '));
  const oldPw = await call('POST', '/api/auth/login', { username: 'owner', password: 'Owner-Original-2026' });
  check('رمزِ قدیمیِ مالک دیگر کار نمی‌کند', oldPw.status === 401, oldPw.text);

  console.log('\n── رمزِ یک‌بارمصرف: فقط «رمزِ تازه بگذار» ──');
  const login = await call('POST', '/api/auth/login', { username: 'owner', password: otp });
  check('ورود با آن یک‌گامی است (دوعاملی خاموش) و mustChangePassword', login.status === 200 && login.json?.token && !login.json?.totpRequired
    && login.json?.mustChangePassword === true, login.text);
  const tTemp = login.json?.token;
  const me = await call('GET', '/api/auth/me', undefined, tTemp);
  check('/me باز است و می‌گوید رمزِ تازه لازم است', me.status === 200 && me.json?.mustChangePassword === true && me.json?.owner === true, me.text);
  const blocked = await Promise.all([
    call('GET', '/api/dashboard', undefined, tTemp),
    call('GET', '/api/auth/users', undefined, tTemp),
    call('GET', '/api/audit', undefined, tTemp),
    call('POST', '/api/auth/totp/setup', {}, tTemp),
    call('GET', '/api/panel/v1/users', undefined, tTemp),
  ]);
  check('⛔ هر درِ دیگری ۴۰۳ password_change_required', blocked.every((x) => x.status === 403 && x.json?.error === 'password_change_required'),
    blocked.map((x) => `${x.status}:${x.json?.error}`).join(' '));
  const same = await call('POST', '/api/auth/change-password', { oldPassword: otp, newPassword: otp }, tTemp);
  check('رمزِ تازه نمی‌تواند همان یک‌بارمصرف باشد', same.status === 400 && same.json?.error === 'same_password', same.text);
  const changed = await call('POST', '/api/auth/change-password', { oldPassword: otp, newPassword: 'Owner-Brand-New-2026' }, tTemp);
  check('رمزِ تازه نشست', changed.status === 200, changed.text);
  check('و نشستِ یک‌بارمصرف هم بسته شد', (await call('GET', '/api/auth/me', undefined, tTemp)).status === 401);
  const again = await call('POST', '/api/auth/login', { username: 'owner', password: otp });
  check('⛔ رمزِ یک‌بارمصرف بارِ دوم کار نمی‌کند', again.status === 401, again.text);
  const fresh = await call('POST', '/api/auth/login', { username: 'owner', password: 'Owner-Brand-New-2026' });
  const tNew = fresh.json?.token;
  check('ورود با رمزِ تازه، عادی', fresh.status === 200 && fresh.json?.mustChangePassword === false, fresh.text);
  const me2 = await call('GET', '/api/auth/me', undefined, tNew);
  check('همان مالکِ اصلی، با نقشِ مدیر', me2.json?.owner === true && me2.json?.user?.role === 'admin', me2.text);
  check('و پنل دوباره کار می‌کند', (await call('GET', '/api/dashboard', undefined, tNew)).status === 200);
  check('دوعاملی خاموش است تا دوباره روشن شود', (await call('GET', '/api/auth/totp', undefined, tNew)).json?.enabled === false);

  console.log('\n── دفترِ رخدادها ──');
  const ua = await call('GET', '/api/audit?source=panel&q=panel.owner.reset', undefined, tNew);
  const row = (ua.json?.rows || []).find((x) => x.action === 'panel.owner.reset');
  check('یک ردیفِ panel.owner.reset در دفترِ یکپارچه', (ua.json?.rows || []).filter((x) => x.action === 'panel.owner.reset').length === 1, ua.text.slice(0, 300));
  let detail = null;
  try { detail = JSON.parse(row?.detail || ''); } catch { /* */ }
  check('با کاربرِ سیستم‌عامل و جزئیاتِ JSON (نه «[object Object]»)', /^cli:/.test(row?.actor || '') && row?.target === 'user:owner'
    && detail?.totpReset === true && detail?.sessionsRevoked >= 3 && detail?.via === 'vill3n owner-reset', JSON.stringify(row));
  check('⛔ و رمزِ یک‌بارمصرف در دفتر نیست', !JSON.stringify(ua.json).includes(otp));
  const logs = await call('GET', '/api/logs?limit=50', undefined, tNew);
  check('و یک خطِ هشدار در لاگِ پنل', (logs.json?.events || []).some((e) => /بازیابیِ مالک/.test(e.message)), logs.text.slice(0, 200));

  console.log('\n── --keep-2fa: فقط رمز ──');
  const s2 = await call('POST', '/api/auth/totp/setup', {}, tNew);
  await call('POST', '/api/auth/totp/enable', { code: totp(s2.json?.secret) }, tNew);
  const k = reset('--yes', '--json', '--keep-2fa');
  check('دستور با --keep-2fa موفق', k.code === 0 && k.json?.totpReset === false, k.out);
  const kl = await call('POST', '/api/auth/login', { username: 'owner', password: k.json?.oneTimePassword });
  check('دوعاملی ماند: ورود با رمزِ یک‌بارمصرف هنوز کد می‌خواهد', kl.json?.totpRequired === true && !kl.json?.token, kl.text);

  console.log('\n── ⛔ هیچ درِ HTTPی برای بازیابیِ مالک نیست ──');
  const local = fs.readFileSync(path.join(dataDir, 'local-admin.key'), 'utf8').trim();
  const http = await Promise.all(['/api/platform/owner-reset', '/api/auth/owner-reset', '/api/panel/v1/auth/owner-reset']
    .map((p) => fetch(BASE + p, { method: 'POST', headers: { 'X-Local-Key': local, 'Content-Type': 'application/json' }, body: '{}' })));
  check('حتی با کلیدِ محلی ۴۰۴/۴۰۱', http.every((x) => x.status === 404 || x.status === 401), http.map((x) => x.status).join(' '));
  const routeFiles = (await fsp.readdir(path.join(SRC, 'routes'), { recursive: true })).filter((f) => f.endsWith('.js'));
  const offenders = [];
  for (const f of routeFiles) {
    const text = await fsp.readFile(path.join(SRC, 'routes', f), 'utf8');
    if (/\.(get|post|put|patch|delete|all|use)\(\s*['"`][^'"`]*owner[-_]?reset/i.test(text)) offenders.push(f);
  }
  check('و در سورسِ روترها هیچ مسیری به نامِ owner-reset نیست', offenders.length === 0, offenders.join(', '));
  const cli = await fsp.readFile(VILL3N, 'utf8');
  const fn = cli.slice(cli.indexOf('async function ownerReset'), cli.indexOf('function help()'));
  check('و خودِ دستور هیچ درخواستی به پنل نمی‌زند (نه api(، نه fetch)', fn.length > 100 && !/\bapi\(|fetch\(/.test(fn), fn.length);
} catch (e) {
  fail++;
  console.log(`\n❌ خطای غیرمنتظره: ${e.stack}`);
  console.log(out.slice(-1500));
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  child.kill('SIGKILL');
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
