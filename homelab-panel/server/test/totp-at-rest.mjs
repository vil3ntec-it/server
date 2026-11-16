// ---------------------------------------------------------------------------
//  C-02 (۱.۵۳.۲) — رازِ دوعاملیِ کاربرانِ پنل روی دیسک رمزشده است، نه base32 ِ خام
//      node test/totp-at-rest.mjs
//
//  روی سرورِ واقعی و ردیفِ واقعیِ ‎panel.db‎:
//   ۱) پس از setup/enable نه ‎totp_pending‎ نه ‎totp_secret‎ رازی که به کاربر نشان داده شد نیستند؛ ورودِ دوگامی کار می‌کند
//   ۲) ردیفِ کهنهٔ خام (پیش از ۱.۵۳.۲) با بالا آمدنِ بعدی (مهاجرتِ ۰۱۵) رمز می‌شود و ورود همان می‌ماند
//   ۳) پاکتِ یک کاربر روی کاربرِ دیگر باز نمی‌شود؛ پاکتِ دست‌خورده ⇒ هیچ
//   ۴) برگشت (‎scripts/totp-unseal.mjs‎) همان خام را برمی‌گرداند
// ---------------------------------------------------------------------------
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { totp, newSecret, STEP_SECONDS } from '../src/lib/totp.js';

const PORT = Number(process.env.TEST_PORT || 4829);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-totp-rest-'));
fs.mkdirSync(path.join(tmp, 'sites'), { recursive: true });
process.env.HLP_DATA_DIR = tmp;
const seal = await import('../src/lib/totp-seal.js');

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`); }
};

const ENV = {
  ...process.env, HLP_PORT: String(PORT), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: tmp, HLP_SITES_ROOT: path.join(tmp, 'sites'),
  HLP_TUNNEL: '0', HLP_DISCOVERY: '0', HLP_AGENT: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_RATE_LOGIN: '1000',
};
let child = null;
let out = '';
async function start() {
  out = '';
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')],
    { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) return true; } catch { /* */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
async function stop() {
  if (!child) return;
  const c = child; child = null;
  const gone = new Promise((r) => c.once('exit', r));
  c.kill('SIGTERM');
  await Promise.race([gone, new Promise((r) => setTimeout(r, 5000))]);
}
async function call(method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await r.json(); } catch { /* */ }
  return { status: r.status, json };
}
const withDb = (fn) => {
  const d = new DatabaseSync(path.join(tmp, 'panel.db'));
  try { d.exec('PRAGMA busy_timeout = 5000'); return fn(d); } finally { d.close(); }
};
const row = () => withDb((d) => d.prepare("SELECT id, totp_secret, totp_pending FROM users WHERE username = 'admin'").get());
const freshStep = () => withDb((d) => d.exec('UPDATE users SET totp_last_step = NULL'));
const PASS = 'Passw0rd!xyz';
/** فقط شکل، هرگز خودِ مقدار (حتی رازِ آزمون) */
const shape = (v) => (String(v || '').startsWith('enc1:') ? 'enc1' : (v ? 'raw' : 'empty'));
async function twoStep(secret) {
  const s1 = await call('POST', '/api/auth/login', { username: 'admin', password: PASS });
  if (!s1.json?.ticket) return { status: 0, json: s1.json };
  return call('POST', '/api/auth/login/totp', { ticket: s1.json.ticket, code: totp(secret, Date.now() + STEP_SECONDS * 1000) });
}

try {
  console.log('── ۱) راهِ واقعی: setup/enable ──');
  check('سرور بالا آمد', await start(), out.slice(-400));
  const setup = await call('POST', '/api/auth/setup', { username: 'admin', password: PASS });
  check('حسابِ مدیر ساخته شد', setup.status === 200 && setup.json?.token, JSON.stringify(setup.json));
  const t1 = setup.json.token;
  const s = await call('POST', '/api/auth/totp/setup', {}, t1);
  check('راز آمد', /^[A-Z2-7]{32}$/.test(String(s.json?.secret || '')), JSON.stringify(s.json).slice(0, 80));
  const secret = s.json.secret;
  const p = row();
  check('⛔ totp_pending خام نیست (پاکتِ enc1:)', p.totp_pending !== secret && !String(p.totp_pending).includes(secret)
    && String(p.totp_pending).startsWith('enc1:'), shape(p.totp_pending));
  const en = await call('POST', '/api/auth/totp/enable', { code: totp(secret) }, t1);
  check('با کدِ درست روشن شد', en.status === 200 && en.json?.recoveryCodes?.length === 10, JSON.stringify(en.json).slice(0, 120));
  const e = row();
  check('⛔ totp_secret خام نیست (پاکتِ enc1:)، totp_pending خالی', e.totp_secret !== secret && !String(e.totp_secret).includes(secret)
    && String(e.totp_secret).startsWith('enc1:') && !e.totp_pending, shape(e.totp_secret));
  freshStep();
  const ok1 = await twoStep(secret);
  check('ورودِ دوگامی با رازِ رمزشده کار می‌کند', ok1.status === 200 && ok1.json?.token, JSON.stringify(ok1.json));

  console.log('── ۳) پاکتِ کاربرِ دیگر / دست‌خورده ──');
  check('پاکتِ همین کاربر باز می‌شود', seal.openTotp(e.id, e.totp_secret) === secret);
  check('⛔ پاکتِ این کاربر برای کاربرِ دیگر باز نمی‌شود', seal.openTotp(e.id + 1, e.totp_secret) === null);
  const broken = String(e.totp_secret).slice(0, -6) + (String(e.totp_secret).endsWith('AAAAAA') ? 'BBBBBB' : 'AAAAAA');
  check('⛔ پاکتِ دست‌خورده ⇒ null', seal.openTotp(e.id, broken) === null);
  check('⛔ رشتهٔ غیرِ base32 ِ خام ⇒ null (نه راز)', seal.openTotp(e.id, 'not-base32!') === null);
  withDb((d) => d.prepare("UPDATE users SET totp_secret = ? WHERE username = 'admin'").run(broken));
  freshStep();
  const bad = await twoStep(secret);
  check('⛔ با پاکتِ دست‌خورده هیچ کدی پذیرفته نیست', bad.status === 401, JSON.stringify(bad.json));
  withDb((d) => d.prepare("UPDATE users SET totp_secret = ? WHERE username = 'admin'").run(e.totp_secret));
  await stop();

  console.log('── ۲) ردیفِ کهنهٔ خام ⇒ مهاجرتِ ۰۱۵ ──');
  const legacy = newSecret();
  withDb((d) => {
    d.prepare("UPDATE users SET totp_secret = ?, totp_pending = ? WHERE username = 'admin'").run(legacy, newSecret());
    d.exec('DELETE FROM schema_migrations WHERE version = 15');
  });
  check('ردیفِ کهنه خام است (پیش از مهاجرت)', row().totp_secret === legacy);
  check('سرور دوباره بالا آمد', await start(), out.slice(-400));
  const m = row();
  check('⛔ مهاجرتِ ۰۱۵ هر دو ستون را رمز کرد', String(m.totp_secret).startsWith('enc1:') && String(m.totp_pending).startsWith('enc1:')
    && !String(m.totp_secret).includes(legacy), shape(m.totp_secret));
  const left = withDb((d) => d.prepare(`SELECT COUNT(*) AS n FROM users WHERE (totp_secret IS NOT NULL AND totp_secret <> '' AND totp_secret NOT LIKE 'enc1:%')
    OR (totp_pending IS NOT NULL AND totp_pending <> '' AND totp_pending NOT LIKE 'enc1:%')`).get().n);
  check('هیچ رازِ خامی در جدول نماند', Number(left) === 0, String(left));
  freshStep();
  const ok2 = await twoStep(legacy);
  check('ورود با همان رازِ کهنه (حالا رمزشده) کار می‌کند', ok2.status === 200 && ok2.json?.token, JSON.stringify(ok2.json));
  await stop();

  console.log('── ۴) برگشت ──');
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'scripts', 'totp-unseal.mjs')],
    { env: ENV, encoding: 'utf8' });
  check('totp-unseal اجرا شد', r.status === 0, (r.stderr || r.stdout || '').slice(-300));
  check('⛔ خروجیِ برگشت هیچ رازی چاپ نمی‌کند', !String(r.stdout).includes(legacy) && !String(r.stderr).includes(legacy));
  check('پس از برگشت همان خام (برای ۱.۵۳.۱)', row().totp_secret === legacy);
  check('sealLegacyTotp دوباره رمز می‌کند (idempotent: بارِ دوم صفر)', withDb((d) => seal.sealLegacyTotp(d)) === 1
    && withDb((d) => seal.sealLegacyTotp(d)) === 0 && String(row().totp_secret).startsWith('enc1:'));
} finally {
  await stop();
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${passed} درست، ${failed} نادرست`);
process.exit(failed ? 1 : 0);
