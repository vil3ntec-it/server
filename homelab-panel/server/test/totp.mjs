// ---------------------------------------------------------------------------
//  آزمونِ ورودِ دوعاملی (TOTP) و دستگاه‌های واردشده
//      node test/totp.mjs
//
//  بخشِ ۴ پرامپت: «2FA اختیاری با TOTP برای مدیر»، «فهرستِ دستگاه‌های
//  واردشده، خروج از همه دستگاه‌ها». همه روی سرورِ واقعی، با کدی که همان
//  الگوریتمِ RFC 6238 می‌سازد — نه کدِ ساختگی.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as totpLib from '../src/lib/totp.js';

const { totp, hotp, verifyTotp, base32Encode, normalizeDigits, STEP_SECONDS } = totpLib;

const PORT = Number(process.env.TEST_PORT || 4823);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-totp-'));
fs.mkdirSync(path.join(tmp, 'sites'), { recursive: true });

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`); }
};

/* ۰) خودِ الگوریتم با بردارِ آزمونِ RFC 4226 (راز "12345678901234567890") */
console.log('── الگوریتم ──');
const rfcSecret = base32Encode(Buffer.from('12345678901234567890'));
check('HOTP بردارِ RFC 4226 (شمارندهٔ ۰ ⇒ 755224)', hotp(rfcSecret, 0) === '755224', hotp(rfcSecret, 0));
check('HOTP بردارِ RFC 4226 (شمارندهٔ ۹ ⇒ 520489)', hotp(rfcSecret, 9) === '520489');
check('پنجرهٔ ±۳۰ ثانیه پذیرفته می‌شود', verifyTotp(rfcSecret, totp(rfcSecret, Date.now() - 30_000)));
check('کدِ دو گام پیش رد می‌شود', !verifyTotp(rfcSecret, totp(rfcSecret, Date.now() - 90_000)));
check('ارقامِ فارسی همان ارقام‌اند', normalizeDigits('۱۲۳۴۵۶') === '123456');
{
  //  ⛔ S13: گامی که کد با آن جور شد، نه شمارندهٔ ساعتِ سرور — وگرنه کدِ «گامِ بعد» (ساعتِ گوشیِ جلو)
  //  پس از ثبتِ شمارندهٔ امروز، سی ثانیهٔ دیگر دوباره پذیرفته می‌شد.
  const at = Date.now();
  const c = Math.floor(at / 1000 / STEP_SECONDS);
  const m = totpLib.matchTotpStep;
  check('⛔ S13: matchTotpStep گامِ جورشده را می‌دهد (−۱ و +۱)', typeof m === 'function'
    && m(rfcSecret, totp(rfcSecret, at - 30_000), { at }) === c - 1 && m(rfcSecret, totp(rfcSecret, at + 30_000), { at }) === c + 1);
  check('⛔ S13: همان گام یا گامِ کهنه‌تر از «آخرین پذیرفته» ⇒ ‎-1‎', typeof m === 'function'
    && m(rfcSecret, totp(rfcSecret, at), { at, after: c }) === -1 && m(rfcSecret, totp(rfcSecret, at - 30_000), { at, after: c }) === -1
    && m(rfcSecret, totp(rfcSecret, at + 30_000), { at, after: c }) === c + 1);
  check('⛔ S13: بیرون از پنجره و کدِ بدشکل ⇒ ‎-1‎', typeof m === 'function'
    && m(rfcSecret, totp(rfcSecret, at - 90_000), { at }) === -1 && m(rfcSecret, '12345', { at }) === -1 && m('', '123456', { at }) === -1);
}

const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
  env: { ...process.env, HLP_PORT: String(PORT), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: tmp, HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_TUNNEL: '0', HLP_DISCOVERY: '0', HLP_AGENT: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_RATE_LOGIN: '1000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));

async function up() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) return true; } catch { /* */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
async function call(method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await r.json(); } catch { /* */ }
  return { status: r.status, json };
}

try {
  check('سرور بالا آمد', await up(), out.slice(-400));

  console.log('── راه‌اندازی و ورودِ ساده ──');
  const setup = await call('POST', '/api/auth/setup', { username: 'admin', password: 'Passw0rd!xyz' });
  check('حسابِ مدیر ساخته شد', setup.status === 200 && setup.json?.token, JSON.stringify(setup.json));
  const t1 = setup.json.token;
  const st = await call('GET', '/api/auth/totp', undefined, t1);
  check('دوعاملی پیش‌فرض خاموش است', st.json?.enabled === false);

  console.log('── روشن کردنِ دوعاملی ──');
  /*
   *  ⛔ (۱.۵۰.۶۲، ۶-۵) روشن کردن هم رمزِ تازه می‌خواهد: نشستِ دزدیده‌شده با اپِ
   *  خودش دوعاملی را روی حسابِ مالک روشن می‌کرد و صاحبِ سامانه بیرون می‌ماند.
   */
  const staleAll = () => {
    const d = new DatabaseSync(path.join(tmp, 'panel.db'));
    try { d.exec('PRAGMA busy_timeout = 5000'); d.exec('UPDATE sessions SET auth_at = 0'); } finally { d.close(); }
  };
  /*
   *  ⛔ S13: هر کدِ دوعاملی یک بار. آزمون برای گامِ بعدی سی ثانیه صبر نمی‌کند — «آخرین گامِ پذیرفته» را
   *  پاک می‌کند، یعنی «یک دقیقه از کدِ قبلی گذشته» (همان کاری که `staleAll` با ده دقیقهٔ احرازِ دوباره می‌کند).
   */
  const dbGet = (sql, ...a) => {
    const d = new DatabaseSync(path.join(tmp, 'panel.db'));
    try { d.exec('PRAGMA busy_timeout = 5000'); return d.prepare(sql).get(...a); } finally { d.close(); }
  };
  const forgetUsedSteps = () => {
    const d = new DatabaseSync(path.join(tmp, 'panel.db'));
    try { d.exec('PRAGMA busy_timeout = 5000'); d.exec('UPDATE users SET totp_last_step = NULL'); } finally { d.close(); }
  };
  const lastStep = () => { try { return dbGet("SELECT totp_last_step AS s FROM users WHERE username = 'admin'")?.s ?? null; } catch { return 'no-column'; } };
  /** کدِ گامِ بعد (ساعتِ گوشیِ کمی جلو) — در پنجرهٔ ±۱ ِ سرور، و گامش را هم می‌دهد */
  const nextCode = (sec) => { const at = Date.now() + STEP_SECONDS * 1000; return { code: totp(sec, at), step: Math.floor(at / 1000 / STEP_SECONDS) }; };
  staleAll();
  const staleSetup = await call('POST', '/api/auth/totp/setup', {}, t1);
  check('⛔ نشستِ کهنه دوعاملی را روشن نمی‌کند (۴۰۳ reauth_required)', staleSetup.status === 403 && staleSetup.json?.error === 'reauth_required', JSON.stringify(staleSetup.json));
  const re1 = await call('POST', '/api/auth/reauth', { password: 'Passw0rd!xyz' }, t1);
  check('با رمز دوباره تازه شد', re1.status === 200, JSON.stringify(re1.json));
  const s = await call('POST', '/api/auth/totp/setup', {}, t1);
  check('راز و QR و otpauth آمد', s.json?.secret && s.json?.qr?.startsWith('data:image/png') && s.json?.url?.startsWith('otpauth://totp/'), JSON.stringify(s.json).slice(0, 120));
  const secret = s.json.secret;
  const bad = await call('POST', '/api/auth/totp/enable', { code: '000000' }, t1);
  check('کدِ غلط روشن نمی‌کند', bad.status === 400 && bad.json?.error === 'totp_invalid');
  const loginStill = await call('POST', '/api/auth/login', { username: 'admin', password: 'Passw0rd!xyz' });
  check('تا روشن نشده، ورود همان یک‌گامی است', loginStill.json?.ok === true && loginStill.json?.token);
  const enableCode = totp(secret);
  const en = await call('POST', '/api/auth/totp/enable', { code: enableCode }, t1);
  check('با کدِ درست روشن شد و ۱۰ کدِ بازیابی داد', en.status === 200 && Array.isArray(en.json?.recoveryCodes) && en.json.recoveryCodes.length === 10, JSON.stringify(en.json));
  const recovery = en.json.recoveryCodes;
  check('وضعیت: روشن، ۱۰ کدِ بازیابی', (await call('GET', '/api/auth/totp', undefined, t1)).json?.recoveryLeft === 10);

  console.log('── ورودِ دوگامی ──');
  const step1 = await call('POST', '/api/auth/login', { username: 'admin', password: 'Passw0rd!xyz' });
  check('گامِ اول: نشست نمی‌دهد، بلیت می‌دهد', step1.json?.ok === false && step1.json?.totpRequired === true && step1.json?.ticket && !step1.json?.token, JSON.stringify(step1.json));
  const ticket = step1.json.ticket;
  const meWithTicket = await call('GET', '/api/auth/me', undefined, ticket);
  check('بلیت به‌جای توکن کار نمی‌کند', meWithTicket.status === 401);
  const wrong = await call('POST', '/api/auth/login/totp', { ticket, code: '123456' });
  check('کدِ غلط ⇒ ۴۰۱', wrong.status === 401 && wrong.json?.error === 'totp_invalid');
  const fake = await call('POST', '/api/auth/login/totp', { ticket: 'x.y.z', code: totp(secret) });
  check('بلیتِ جعلی ⇒ ۴۰۱', fake.status === 401);
  const reusedEnable = await call('POST', '/api/auth/login/totp', { ticket, code: enableCode });
  check('⛔ S13: کدی که دوعاملی را روشن کرد ورود نمی‌دهد (همان گام)', reusedEnable.status === 401 && reusedEnable.json?.error === 'totp_invalid', JSON.stringify(reusedEnable.json));
  const n1 = nextCode(secret);
  const step2 = await call('POST', '/api/auth/login/totp', { ticket, code: n1.code.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]) });
  check('گامِ دوم با کدِ درست (ارقامِ فارسی، گامِ بعد) ⇒ نشست', step2.status === 200 && step2.json?.token, JSON.stringify(step2.json));
  const t2 = step2.json.token;
  check('⛔ S13: گامِ جورشده ثبت شد، نه شمارندهٔ ساعتِ سرور', lastStep() === n1.step, `${lastStep()} ≠ ${n1.step}`);

  console.log('── ⛔ S13: کدِ دوعاملی یک‌بارمصرف است ──');
  const sR = await call('POST', '/api/auth/login', { username: 'admin', password: 'Passw0rd!xyz' });
  const replay = await call('POST', '/api/auth/login/totp', { ticket: sR.json.ticket, code: n1.code });
  check('⛔ همان کد با بلیتِ تازه ⇒ ۴۰۱ (بازپخش)', replay.status === 401 && replay.json?.error === 'totp_invalid' && !replay.json?.token, JSON.stringify(replay.json));
  const older = await call('POST', '/api/auth/login/totp', { ticket: sR.json.ticket, code: totp(secret) });
  check('⛔ کدِ گامِ کهنه‌تر (هنوز در پنجرهٔ ±۱) ⇒ ۴۰۱', older.status === 401 && !older.json?.token, JSON.stringify(older.json));
  staleAll();
  const reReplay = await call('POST', '/api/auth/reauth', { password: 'Passw0rd!xyz', code: n1.code }, t2);
  check('⛔ کدِ ورود در احرازِ دوباره هم دوباره پذیرفته نمی‌شود', reReplay.status === 400 && reReplay.json?.error === 'totp_invalid', JSON.stringify(reReplay.json));
  check('⛔ و نشست تازه نشد', !((await call('GET', '/api/auth/me', undefined, t2)).json?.freshUntil > Date.now()));
  forgetUsedSteps();
  const raceCode = totp(secret);
  const tickets = [];
  for (let i = 0; i < 5; i++) tickets.push((await call('POST', '/api/auth/login', { username: 'admin', password: 'Passw0rd!xyz' })).json?.ticket);
  const race = await Promise.all(tickets.map((tk) => call('POST', '/api/auth/login/totp', { ticket: tk, code: raceCode })));
  check('⛔ پنج درخواستِ هم‌زمان با یک کد ⇒ دقیقاً یک نشست', race.filter((r) => r.status === 200 && r.json?.token).length === 1
    && race.filter((r) => r.status === 401).length === 4, race.map((r) => r.status).join(' '));

  console.log('── کدِ بازیابی ──');
  const s1 = await call('POST', '/api/auth/login', { username: 'admin', password: 'Passw0rd!xyz' });
  const rec = await call('POST', '/api/auth/login/totp', { ticket: s1.json.ticket, code: recovery[0] });
  check('کدِ بازیابی ورود می‌دهد', rec.status === 200 && rec.json?.token);
  const s2 = await call('POST', '/api/auth/login', { username: 'admin', password: 'Passw0rd!xyz' });
  const rec2 = await call('POST', '/api/auth/login/totp', { ticket: s2.json.ticket, code: recovery[0] });
  check('همان کد بارِ دوم رد می‌شود (یک‌بارمصرف)', rec2.status === 401);
  check('۹ کدِ بازیابی مانده', (await call('GET', '/api/auth/totp', undefined, t2)).json?.recoveryLeft === 9);
  const meRec = await call('GET', '/api/auth/me', undefined, rec.json.token);
  check('ورود با کدِ بازیابی هم نشستِ «تازه» می‌سازد', meRec.json?.freshUntil > Date.now(), JSON.stringify(meRec.json).slice(0, 160));

  console.log('── احرازِ دوباره با دوعاملیِ روشن: رمز + کد ──');
  staleAll();
  const reNoCode = await call('POST', '/api/auth/reauth', { password: 'Passw0rd!xyz' }, t2);
  check('⛔ فقط رمز کافی نیست (۴۰۰ totp_invalid، totpRequired)', reNoCode.status === 400 && reNoCode.json?.error === 'totp_invalid' && reNoCode.json?.totpRequired === true, JSON.stringify(reNoCode.json));
  const reBadPw = await call('POST', '/api/auth/reauth', { password: 'nope', code: totp(secret) }, t2);
  check('⛔ کد بی رمزِ درست هم نه', reBadPw.status === 400 && reBadPw.json?.error === 'wrong_password', JSON.stringify(reBadPw.json));
  forgetUsedSteps();
  const reCode = totp(secret);
  const reBoth = await call('POST', '/api/auth/reauth', { password: 'Passw0rd!xyz', code: reCode }, t2);
  check('رمز + کد ⇒ تازه', reBoth.status === 200 && reBoth.json?.freshUntil > Date.now(), JSON.stringify(reBoth.json));
  staleAll();
  const reAgain = await call('POST', '/api/auth/reauth', { password: 'Passw0rd!xyz', code: reCode }, t2);
  check('⛔ S13: همان کد برای احرازِ دوبارهٔ دوم ⇒ ۴۰۰ totp_invalid', reAgain.status === 400 && reAgain.json?.error === 'totp_invalid', JSON.stringify(reAgain.json));
  const sL = await call('POST', '/api/auth/login', { username: 'admin', password: 'Passw0rd!xyz' });
  const afterRe = await call('POST', '/api/auth/login/totp', { ticket: sL.json.ticket, code: reCode });
  check('⛔ S13: و کدِ احرازِ دوباره ورود هم نمی‌دهد', afterRe.status === 401 && !afterRe.json?.token, JSON.stringify(afterRe.json));

  console.log('── دستگاه‌های واردشده ──');
  const list = await call('GET', '/api/auth/sessions', undefined, t2);
  check('فهرستِ نشست‌ها با نشانِ «همین دستگاه»', list.json?.sessions?.length >= 3 && list.json.sessions.some((x) => x.current) && list.json.current, JSON.stringify(list.json).slice(0, 200));
  const other = list.json.sessions.find((x) => !x.current);
  const rev = await call('DELETE', `/api/auth/sessions/${other.id}`, undefined, t2);
  check('یک دستگاهِ دیگر بسته شد', rev.status === 200);
  check('نشستِ همین دستگاه از این راه بسته نمی‌شود', (await call('DELETE', `/api/auth/sessions/${list.json.current}`, undefined, t2)).status === 400);
  const all = await call('POST', '/api/auth/logout-all', {}, t2);
  check('خروج از همهٔ دستگاه‌های دیگر', all.status === 200 && all.json?.revoked >= 1, JSON.stringify(all.json));
  check('توکنِ اولی دیگر کار نمی‌کند', (await call('GET', '/api/auth/me', undefined, t1)).status === 401);
  check('همین دستگاه هنوز وارد است', (await call('GET', '/api/auth/me', undefined, t2)).status === 200);

  console.log('── خاموش کردن ──');
  check('خاموش کردن بی رمز رد می‌شود', (await call('POST', '/api/auth/totp/disable', { password: 'nope', code: totp(secret) }, t2)).status === 400);
  check('خاموش کردن بی کد رد می‌شود', (await call('POST', '/api/auth/totp/disable', { password: 'Passw0rd!xyz', code: '000000' }, t2)).status === 400);
  forgetUsedSteps();
  const disCode = totp(secret);
  const dis = await call('POST', '/api/auth/totp/disable', { password: 'Passw0rd!xyz', code: disCode }, t2);
  check('با رمز و کد خاموش شد', dis.status === 200);
  check('⛔ S13: خاموش شد ⇒ «آخرین گام» هم پاک شد (رازِ بعدی از صفر)', lastStep() === null, String(lastStep()));
  const plain = await call('POST', '/api/auth/login', { username: 'admin', password: 'Passw0rd!xyz' });
  check('ورود دوباره یک‌گامی است', plain.json?.ok === true && plain.json?.token);
  const auditRows = await call('GET', '/api/app-admin/audit?limit=100', undefined, plain.json.token);
  const actions = JSON.stringify(auditRows.json || '');
  check('روشن/خاموش و خروج از همه در دفترِ رخدادها ثبت شد', actions.includes('panel.totp.enable') && actions.includes('panel.totp.disable') && actions.includes('panel.logout_all'), actions.slice(0, 200));
  check('⛔ S13: کدِ بازپخش‌شده در دفتر «reused» نوشته شد', /reused\\?"\s*:\s*true/.test(actions), actions.slice(0, 200));
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}
console.log(`\n${failed ? '❌' : '✅'} ${passed} سبز، ${failed} قرمز`);
process.exit(failed ? 1 : 0);
