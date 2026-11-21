// ---------------------------------------------------------------------------
//  حساب‌پیِ خودکارِ دکان‌ها روی سرورِ حسابی که پنل بالا می‌آورد — کلیدِ رمزگذاری (۱.۵۱.۳)
//      node test/hesabpay-cred-key.mjs
//
//  چرا: سرورِ حساب (shop ‎server/src/lib/hesabpay-account.js‎) کلیدِ پذیرنده و رازِ وب‌هوکِ هر دکان را با
//  ‎HESABPAY_CRED_KEY‎ رمز می‌کند و بی آن «حساب‌پیِ خودکار» برای همهٔ دکان‌ها خاموش است. پنل هیچ‌وقت آن را نمی‌داد.
//  این‌جا سنجیده می‌شود:
//    ۱) ناظر یک بار می‌سازد (۶۴ hex)، پایدار در هر بالا آمدن، هرگز رونویسی نمی‌شود (حتی فایلِ خراب/کهنه/کلیدِ کوتاه)،
//       تنظیمِ صریحِ ‎HESABPAY_CRED_KEY‎ ِ پنل جلوتر است، و به محیطِ فرزند می‌رود — به سایت/ترمینال نه.
//    ۲) قاعدهٔ «پذیرفته/کوتاه» همان قاعدهٔ خودِ shop است — با **خودِ فایلِ shop** سنجیده می‌شود (اگر کدش هست)،
//       و shop با کلیدِ ساخته‌شده واقعاً رمز می‌کند/می‌گشاید و «live» می‌گوید.
//    ۳) ‎move-server --account-env‎، بستهٔ هاستِ cPanel (فقط نام، نه مقدار) و پشتیبان/بازگردانیِ پنل آن را می‌برند/می‌آورند.
//    ۴) وب‌هوک: ‎POST /api/(v1/)payments/webhook/…‎ از پورتِ عمومی با سرآیندِ امضا و **بایت‌به‌بایت** همان بدنهٔ خام
//       به سرورِ حساب می‌رسد (HMAC روی بدنهٔ خام؛ پنل JSON را دوباره نمی‌سازد).
//    ۵) با سرورِ حسابِ واقعی (‎ACCOUNT_SERVER_DIR‎): «حساب‌پیِ خودکار: آماده»، کلید در محیطِ واقعیِ پروسهٔ فرزند،
//       ‎providers.payment = live‎ از خودِ shop، پایدار پس از راه‌اندازیِ دوبارهٔ سرورِ حساب و خودِ پنل؛ و کلید در
//       هیچ پاسخِ GET ِ پنل، لاگِ پنل/فرزند، یا فایلِ دیگری از پوشهٔ داده نیست.
//  ⛔ هیچ کلیدِ واقعی: همه‌چیز همین‌جا ساخته و دور ریخته می‌شود؛ هیچ مقداری چاپ نمی‌شود.
// ---------------------------------------------------------------------------
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRV = path.resolve(here, '..');
const BASE_PORT = Number(process.env.TEST_PORT || 4971);
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-hpkey-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 300)}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const HEX64 = /^[0-9a-f]{64}$/;
const SAFE_ENV = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: '' };

//  کدِ واقعیِ سرورِ حساب — همان نامزدهای ‎account-supervisor.mjs‎ (نبودش فقط بخش‌های «واقعی» را رد می‌کند)
const ACCOUNT_DIR = [
  process.env.ACCOUNT_SERVER_DIR, process.env.HLP_ACCOUNT_DIR,
  path.resolve(SRV, '..', 'account-server'), path.resolve(SRV, '..', '..', '..', 'shop', 'server'),
].filter(Boolean).find((d) => fs.existsSync(path.join(d, 'src', 'index.js')) && fs.existsSync(path.join(d, 'node_modules')));

/* ── سرورِ حسابِ «نصب‌شده»ی ساختگی (فقط دو مسیری که ناظر می‌پرسد + package.json برای بستهٔ هاست) ── */
const FAKE = path.join(tmp, 'fake-account');
fs.mkdirSync(path.join(FAKE, 'src'), { recursive: true });
fs.mkdirSync(path.join(FAKE, 'node_modules'), { recursive: true });
fs.writeFileSync(path.join(FAKE, 'src', 'index.js'), '// ساختگی\n');
fs.writeFileSync(path.join(FAKE, 'package.json'), JSON.stringify({ name: 'fake-account', version: '0.0.1' }));

/** یک تکه ESM در فرآیندِ جدا با پوشهٔ دادهٔ خودش ⇐ JSON ِ سطرِ آخر (هرگز چاپ نمی‌شود) */
function runModule(body, { data, env = {} } = {}) {
  const script = `${body}\n`;
  const out = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', script], {
    cwd: SRV,
    env: {
      ...SAFE_ENV, HLP_DATA_DIR: data, HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_TUNNEL: '0', HLP_AI_ENABLED: '0',
      HLP_ACCOUNT_API: 'http://127.0.0.1:4999', HLP_ACCOUNT_DIR: FAKE, HLP_ACCOUNT_AUTOSTART: '1',
      HLP_LIBRARY_ROOT: path.join(tmp, 'library'), HLP_BACKUP_ROOT: path.join(tmp, 'backups-root'), HLP_BACKUP_ENCRYPT: '0',
      ...env,
    },
    encoding: 'utf8',
    timeout: 60_000,
  });
  const line = (out.stdout || '').trim().split('\n').pop() || '';
  try { return JSON.parse(line); } catch {
    console.log(`  [فرآیندِ کمکی] ${String(out.stderr || '').slice(-600)}`);
    return null;
  }
}
const SUP = `import * as sup from './src/account/supervisor.js';`;
const secretsOf = (data) => JSON.parse(fs.readFileSync(path.join(data, 'account-server', 'secrets.json'), 'utf8'));
const writeSecrets = (data, obj) => {
  fs.mkdirSync(path.join(data, 'account-server'), { recursive: true });
  fs.writeFileSync(path.join(data, 'account-server', 'secrets.json'), typeof obj === 'string' ? obj : JSON.stringify(obj), { mode: 0o600 });
};

try {
  /* ══════════════════════════ ۱) ناظر: ساختن، پایداری، محیطِ فرزند ══════════════════════════ */
  console.log('── ۱) یک بار ساخته می‌شود و همیشه همان است ──');
  const D1 = path.join(tmp, 'd1');
  const a = runModule(`${SUP}
    const s = sup.ensureSecrets();
    console.log(JSON.stringify({ key: s.hesabpayCredKey, env: sup.accountChildEnv(process.env.HLP_ACCOUNT_DIR), status: sup.accountStatus() }));`, { data: D1 });
  const key1 = a?.key || '';
  check('کلید ساخته شد: ۶۴ رقمِ hex (۳۲ بایتِ تصادفی)', HEX64.test(key1));
  check('همان کلید در secrets.json نشست', fs.existsSync(path.join(D1, 'account-server', 'secrets.json')) && secretsOf(D1).hesabpayCredKey === key1);
  if (process.platform !== 'win32') check('secrets.json فقط‌خواندنیِ صاحبِ سرور (۶۰۰)', (fs.statSync(path.join(D1, 'account-server', 'secrets.json')).mode & 0o077) === 0);
  check('و همان به محیطِ پروسهٔ فرزند می‌رود (HESABPAY_CRED_KEY)', a?.env?.HESABPAY_CRED_KEY === key1 && key1.length > 0);
  check('رازهای پیشین هم سرِ جا (API/OTP/JWT، مدیر)', !!(a?.env?.API_SECRET && a?.env?.OTP_SECRET && a?.env?.JWT_SECRET && a?.env?.ADMIN_BOOTSTRAP_PASSWORD));
  check('وضعیت: «حساب‌پیِ خودکار» با روشن شدن آماده (ok، managed) — بی کلید',
    a?.status?.hesabpay?.state === 'ok' && a.status.hesabpay.source === 'managed' && a.status.hesabpay.ready === false && a.status.hesabpay.running === false, JSON.stringify(a?.status?.hesabpay));
  check('⛔ کلید در هیچ جای پاسخِ وضعیت نیست', !!a && !JSON.stringify(a.status).includes(key1));

  const before = fs.readFileSync(path.join(D1, 'account-server', 'secrets.json'));
  const b = runModule(`${SUP}
    console.log(JSON.stringify({ key: sup.ensureSecrets().hesabpayCredKey, env: sup.accountChildEnv(process.env.HLP_ACCOUNT_DIR).HESABPAY_CRED_KEY }));`, { data: D1 });
  check('بالا آمدنِ دوباره (فرآیندِ تازه) ⇒ همان کلید، همان محیطِ فرزند', b?.key === key1 && b?.env === key1);
  check('فایل حتی یک بایت عوض نشد', fs.readFileSync(path.join(D1, 'account-server', 'secrets.json')).equals(before));

  const D2 = path.join(tmp, 'd2');
  const old = { apiSecret: 'A'.repeat(43), otpSecret: 'O'.repeat(43), jwtSecret: 'J'.repeat(43), adminUser: 'admin', adminPassword: 'Pold-pass-1405' };
  writeSecrets(D2, old);
  const c = runModule(`${SUP} console.log(JSON.stringify({ key: sup.ensureSecrets().hesabpayCredKey }));`, { data: D2 });
  const s2 = secretsOf(D2);
  check('secrets.json ِ نسخهٔ پیشین (بی کلید) ⇒ فقط کلید اضافه شد', HEX64.test(c?.key || '') && s2.hesabpayCredKey === c.key);
  check('… و رازهای پیشین دست نخوردند', ['apiSecret', 'otpSecret', 'jwtSecret', 'adminUser', 'adminPassword'].every((k) => s2[k] === old[k]));

  const D3 = path.join(tmp, 'd3');
  writeSecrets(D3, { ...old, hesabpayCredKey: 'short-key', futureField: 'x' });
  const d = runModule(`${SUP} console.log(JSON.stringify({ key: sup.ensureSecrets().hesabpayCredKey, st: sup.accountStatus().hesabpay }));`, { data: D3 });
  check('⛔ کلیدِ موجود هرگز عوض نمی‌شود — حتی کوتاه (و ناظر «کوتاه» می‌گوید، نه «آماده»)', d?.key === 'short-key' && secretsOf(D3).hesabpayCredKey === 'short-key' && d?.st?.state === 'weak', JSON.stringify(d?.st));
  check('… و فیلدِ ناشناختهٔ فایل هم نمی‌افتد', secretsOf(D3).futureField === 'x');

  const D4 = path.join(tmp, 'd4');
  const brokenText = `{"apiSecret":"${'B'.repeat(43)}","hesabpayCredKey":"${'c'.repeat(64)}"`; //  نیمه‌نوشته
  writeSecrets(D4, brokenText);
  const e = runModule(`${SUP} console.log(JSON.stringify({ key: sup.ensureSecrets().hesabpayCredKey }));`, { data: D4 });
  const aside = fs.readdirSync(path.join(D4, 'account-server')).filter((n) => n.startsWith('secrets.json.broken-'));
  check('⛔ secrets.json ِ خراب پاک نمی‌شود: کنار گذاشته می‌شود و کلیدِ پیشین از آن برمی‌گردد',
    aside.length === 1 && fs.readFileSync(path.join(D4, 'account-server', aside[0]), 'utf8') === brokenText && HEX64.test(e?.key || ''), aside.join(','));

  const D5 = path.join(tmp, 'd5');
  const explicit = crypto.randomBytes(32).toString('hex');
  const f = runModule(`${SUP}
    const s = sup.ensureSecrets();
    console.log(JSON.stringify({ stored: s.hesabpayCredKey, env: sup.accountChildEnv(process.env.HLP_ACCOUNT_DIR).HESABPAY_CRED_KEY, st: sup.accountStatus().hesabpay }));`, { data: D5, env: { HESABPAY_CRED_KEY: explicit } });
  check('تنظیمِ صریحِ HESABPAY_CRED_KEY در محیطِ پنل جلوتر است (فرزند همان را می‌گیرد، منبع env)', f?.env === explicit && f?.st?.source === 'env' && f?.st?.state === 'ok');
  check('… و نخستین بار همان نگه داشته می‌شود تا پشتیبان و جابه‌جایی با همان بروند', f?.stored === explicit);
  const g = runModule(`${SUP}
    const s = sup.ensureSecrets();
    console.log(JSON.stringify({ stored: s.hesabpayCredKey, env: sup.accountChildEnv(process.env.HLP_ACCOUNT_DIR).HESABPAY_CRED_KEY }));`, { data: D1, env: { HESABPAY_CRED_KEY: explicit } });
  check('کلیدِ صریحِ تازه روی کلیدِ ذخیره‌شده: فرزند صریح را می‌گیرد، ذخیره‌شده دست نمی‌خورد', g?.env === explicit && g?.stored === key1);
  const h = runModule(`
    import { childBaseEnv, PANEL_SECRET_ENV } from './src/lib/child-env.js';
    console.log(JSON.stringify({ list: PANEL_SECRET_ENV, leaked: 'HESABPAY_CRED_KEY' in childBaseEnv() || 'HESABPAY_CRED_KEY_PREVIOUS' in childBaseEnv() }));`,
  { data: path.join(tmp, 'd6'), env: { HESABPAY_CRED_KEY: explicit, HESABPAY_CRED_KEY_PREVIOUS: explicit } });
  check('⛔ کلیدِ صریح به سایت‌ها و ترمینال (childBaseEnv) نمی‌رسد', h && h.list.includes('HESABPAY_CRED_KEY') && h.leaked === false);

  /* ══════════════════════════ ۲) همان قاعدهٔ shop ══════════════════════════ */
  console.log('\n── ۲) قاعدهٔ «پذیرفته/کوتاه» همان قاعدهٔ shop است ──');
  const rnd = (n, abc) => Array.from(crypto.randomBytes(n), (x) => abc[x % abc.length]).join('');
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const URLB64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const samples = [
    '', '   ', 'a', 'x'.repeat(31), 'x'.repeat(32), ` ${'x'.repeat(31)} `, `\t${key1}\n`, key1, key1.toUpperCase(),
    key1.slice(1), `${key1}0`, crypto.randomBytes(32).toString('base64'), crypto.randomBytes(32).toString('base64url'),
    crypto.randomBytes(31).toString('base64'), `${rnd(42, B64)}=`, rnd(43, URLB64), 'ک'.repeat(31), 'ک'.repeat(32), '😀'.repeat(16),
  ];
  for (let i = 0; i < 160; i++) samples.push(rnd(i % 71, i % 3 ? URLB64 : `${B64}= -_ک`));
  const ours = runModule(`${SUP} console.log(JSON.stringify(${JSON.stringify(samples)}.map(sup.hesabpayCredKeyState)));`, { data: path.join(tmp, 'd7') });
  check('قاعدهٔ پنل: ۶۴ hex ⇒ ok · ۳۱ نویسه ⇒ weak · خالی ⇒ missing', ours?.[7] === 'ok' && ours?.[3] === 'weak' && ours?.[0] === 'missing' && ours?.[5] === 'weak');
  if (!ACCOUNT_DIR) {
    console.log('  ⚠️  کدِ سرورِ حساب نیست (ACCOUNT_SERVER_DIR) — سنجشِ با خودِ فایلِ shop رد شد.');
  } else {
    const shopFile = path.join(ACCOUNT_DIR, 'src', 'lib', 'hesabpay-account.js');
    const shop = spawnSync(process.execPath, ['-e', `
      const m = require(${JSON.stringify(shopFile)});
      const states = ${JSON.stringify(samples)}.map((s) => { process.env.HESABPAY_CRED_KEY = s; return m.credKeyState(); });
      process.env.HESABPAY_CRED_KEY = ${JSON.stringify(key1)};
      const sealed = m._seal('shop-a', 'api_key', 'merchant-key-test');
      const round = m._unseal('shop-a', 'api_key', sealed) === 'merchant-key-test' && m._unseal('shop-b', 'api_key', sealed) === null;
      const live = require(${JSON.stringify(path.join(ACCOUNT_DIR, 'src', 'lib', 'payment-providers.js'))}).providerState();
      const configured = require(${JSON.stringify(path.join(ACCOUNT_DIR, 'src', 'lib', 'payment-hesabpay.js'))}).configured();
      process.env.HESABPAY_CRED_KEY = 'x'.repeat(31);
      const weak = require(${JSON.stringify(path.join(ACCOUNT_DIR, 'src', 'lib', 'payment-providers.js'))}).providerState().state;
      console.log(JSON.stringify({ states, round, live: live.state, perShop: live.perShop === true, configured, weak }));
      process.exit(0);`], { env: { ...SAFE_ENV, NODE_ENV: 'production', ENV_FILE: path.join(tmp, 'env.none') }, encoding: 'utf8', timeout: 60_000 });
    let sj = null;
    try { sj = JSON.parse((shop.stdout || '').trim().split('\n').pop()); } catch { console.log(`  [shop] ${String(shop.stderr || '').slice(-500)}`); }
    const mism = sj && ours ? samples.map((_, i) => i).filter((i) => sj.states[i] !== ours[i]) : ['?'];
    check(`با خودِ shop ‎lib/hesabpay-account.js‎ ⇐ credKeyState: هر ${samples.length} نمونه یکسان`, mism.length === 0, `ناهمسان: ${mism.slice(0, 5).join(',')}`);
    check('shop با کلیدِ ساختهٔ ناظر رمز می‌کند و می‌گشاید (و برای دکانِ دیگر نه)', sj?.round === true);
    check('shop ‎providerState‎ ⇒ live، هر دکان کلیدِ خودش؛ ‎payment-hesabpay.configured() = true‎', sj?.live === 'live' && sj?.perShop && sj?.configured === true, JSON.stringify(sj && { live: sj.live, configured: sj.configured }));
    check('… و کلیدِ کوتاه ⇒ incomplete (پس «آماده» ِ پنل برای کوتاه دروغ می‌بود)', sj?.weak === 'incomplete');
  }

  /* ══════════════════════════ ۳) جابه‌جایی، بستهٔ هاست، پشتیبان ══════════════════════════ */
  console.log('\n── ۳) با رازهای دیگر می‌رود: move-server، بستهٔ هاست، پشتیبان/بازگردانی ──');
  const { accountEnvLines } = await import('../scripts/move-server.mjs');
  const lines = accountEnvLines({ ...old, hesabpayCredKey: key1 });
  check('move-server ‎--account-env‎: ‎HESABPAY_CRED_KEY=‎ همان مقدار، کنارِ API/OTP/JWT و ADMIN_BOOTSTRAP',
    lines.includes(`HESABPAY_CRED_KEY=${key1}`) && lines.includes(`API_SECRET=${old.apiSecret}`) && lines.includes('ADMIN_BOOTSTRAP_USER=admin'));
  const noKey = accountEnvLines(old);
  check('… secrets.json ِ بی کلید ⇒ هیچ کلیدِ ساختگی، فقط راهنمای یک‌خطی', !noKey.some((l) => l.startsWith('HESABPAY_CRED_KEY=')) && noKey.some((l) => l.startsWith('# HESABPAY_CRED_KEY')));

  const hb = runModule(`
    import { buildHostBundle } from './src/fleet/host-bundle.js';
    import { readZipIndex, extractZip } from './src/control/zip.js';
    import fs from 'node:fs'; import path from 'node:path';
    const b = await buildHostBundle({ centerUrl: 'https://center.example' });
    const out = path.join(process.env.HLP_DATA_DIR, 'bundle');
    await extractZip(b.file, out);
    const readme = fs.readFileSync(path.join(out, 'vill3n-host', 'README-fa.txt'), 'utf8');
    const all = []; const walk = (d) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); fs.statSync(p).isDirectory() ? walk(p) : all.push(fs.readFileSync(p, 'latin1')); } }; walk(out);
    b.cleanup();
    console.log(JSON.stringify({ readme, text: all.join('\\n') }));`, { data: D1 });
  check('بستهٔ هاستِ cPanel: README نامِ HESABPAY_CRED_KEY را کنارِ API_SECRET می‌آورد', /API_SECRET · OTP_SECRET · JWT_SECRET · HESABPAY_CRED_KEY/.test(hb?.readme || ''));
  check('⛔ و خودِ کلید در بسته نیست', !!hb && !hb.text.includes(key1));

  const bk = runModule(`${SUP}
    import fs from 'node:fs'; import path from 'node:path';
    const { createBackup, restoreBackup } = await import('./src/storage/backup.js');
    const key = sup.ensureSecrets().hesabpayCredKey;
    const made = await createBackup({ kind: 'Manual', note: 'hp' });
    const copy = JSON.parse(fs.readFileSync(path.join(made.path, 'account-server', 'secrets.json'), 'utf8')).hesabpayCredKey;
    const live = path.join(process.env.HLP_DATA_DIR, 'account-server', 'secrets.json');
    const lost = JSON.parse(fs.readFileSync(live, 'utf8')); delete lost.hesabpayCredKey; fs.writeFileSync(live, JSON.stringify(lost));
    const r = await restoreBackup(made.path);
    const back = JSON.parse(fs.readFileSync(live, 'utf8')).hesabpayCredKey;
    console.log(JSON.stringify({ included: made.included, same: copy === key, ok: r.ok, back: back === key }));`, { data: D1 });
  check('پشتیبانِ پنل secrets.json ِ سرورِ حساب را با همان کلید دارد', bk?.same === true && (bk?.included || []).includes('account-server/secrets.json'), JSON.stringify(bk?.included));
  check('بازگردانی کلیدِ گم‌شده را همان برمی‌گرداند', bk?.ok === true && bk?.back === true);

  /* ══════════════════════════ ۴) وب‌هوک: بدنهٔ خام و امضا دست‌نخورده ══════════════════════════ */
  console.log('\n── ۴) وب‌هوکِ حساب‌پی از درِ عمومی: سرآیندِ امضا و بدنهٔ خام، بایت‌به‌بایت ──');
  {
    const PANEL = BASE_PORT, PUBLIC = BASE_PORT + 1, UP = BASE_PORT + 2;
    const got = [];
    const upstream = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        got.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end('{"ok":true,"from":"account"}');
      });
    });
    await new Promise((r) => upstream.listen(UP, '127.0.0.1', r));
    const D8 = path.join(tmp, 'd8');
    let out8 = '';
    const panel = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
      cwd: SRV,
      env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: D8, HLP_SITES_ROOT: path.join(tmp, 'sites8'),
        HLP_SITESYNC: '1', HLP_SITESYNC_PORT: String(PUBLIC), HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_DISCOVERY: '0', HLP_AGENT: '0',
        HLP_AUTOMATION: '0', HLP_UPDATE_AUTO: '0', HLP_STATIONS: '0', HLP_LIBRARY_ROOT: path.join(tmp, 'lib8'),
        HLP_ACCOUNT_API: `http://127.0.0.1:${UP}`, HLP_ACCOUNT_AUTOSTART: '0', HLP_ACCOUNT_DIR: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    panel.stdout.on('data', (x) => (out8 += x));
    panel.stderr.on('data', (x) => (out8 += x));
    try {
      let up = false;
      for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PUBLIC}/api/v1/health`)).status < 500; } catch { /* هنوز */ } if (!up) await wait(250); }
      check('پنل با درِ عمومی بالا آمد', up, out8.slice(-500));
      const hookSecret = crypto.randomBytes(24).toString('hex');
      const sign = (buf) => crypto.createHmac('sha256', hookSecret).update(buf).digest('hex');
      const send = (p, body, headers, { chunked = false } = {}) => new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: PUBLIC, method: 'POST', path: p, headers: chunked ? headers : { ...headers, 'content-length': body.length } }, (res) => {
          const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(c).toString('utf8') }));
        });
        req.on('error', reject);
        if (chunked) { req.write(body.subarray(0, 7)); setTimeout(() => { req.write(body.subarray(7)); req.end(); }, 30); } else req.end(body);
      });
      const token = crypto.randomBytes(24).toString('base64url');
      const cases = [
        { name: 'JSON با فاصله‌ها، ترتیبِ کلیدها، یونیکد و ۱.۱۰ (JSON.stringify دوباره همه را عوض می‌کرد)', path: `/api/v1/payments/webhook/hesabpay/${token}`,
          body: Buffer.from('{ "status":"paid",  "amount" : 1.10, "b":2,"a":1, "note":"حساب‌پی ✓", "n":[1, 2 ,3] }\r\n', 'utf8'), header: 'x-hesab-signature', prefix: 'sha256=' },
        { name: 'درِ کهنهٔ بی‌دکان ‎/api/payments/webhook/hesabpay‎ با x-signature', path: '/api/payments/webhook/hesabpay',
          body: Buffer.from('{"order_id":"o-1","status":"success"}', 'utf8'), header: 'x-signature', prefix: '' },
        { name: 'JSON ِ نامعتبر با content-type ِ JSON (express.json آن را ۴۰۰ می‌کرد) و x-hesabpay-signature', path: `/api/v1/payments/webhook/hesabpay/${token}`,
          body: Buffer.from('{"status":"paid",,}', 'utf8'), header: 'x-hesabpay-signature', prefix: '' },
        { name: 'بدنهٔ تکه‌تکه (chunked، بی content-length)', path: `/api/payments/webhook/hesabpay/${token}`, chunked: true,
          body: Buffer.from(JSON.stringify({ status: 'paid', ref: crypto.randomUUID(), pad: 'x'.repeat(5000) }), 'utf8'), header: 'x-hesab-signature', prefix: 'sha256=' },
      ];
      for (const cs of cases) {
        const before = got.length;
        const sig = `${cs.prefix}${sign(cs.body)}`;
        const r = await send(cs.path, cs.body, { 'content-type': 'application/json; charset=utf-8', [cs.header]: sig }, { chunked: cs.chunked });
        const g = got[before];
        const ok = r.status === 200 && /"from":"account"/.test(r.text) && g && g.method === 'POST' && g.url === cs.path
          && g.body.equals(cs.body) && g.headers[cs.header] === sig && sign(g.body) === sig.replace(/^sha256=/, '');
        check(`به سرورِ حساب رسید، بایت‌به‌بایت و HMAC ِ همان بدنه درست: ${cs.name}`, ok,
          `${r.status} ${r.text.slice(0, 120)} url=${g?.url} same=${g?.body?.equals(cs.body)} sig=${g?.headers?.[cs.header] === sig}`);
      }
      const hooks = got.filter((g) => g.url.includes('/payments/webhook/'));
      check('content-type ِ اصلی هم دست‌نخورده رسید (همهٔ وب‌هوک‌ها)', hooks.length === cases.length && hooks.every((g) => g.headers['content-type'] === 'application/json; charset=utf-8'),
        JSON.stringify(hooks.map((g) => g.headers['content-type'])));
    } finally {
      panel.kill('SIGTERM');
      await new Promise((r) => { panel.once('exit', r); setTimeout(r, 4000); });
      upstream.close();
    }
  }

  /* ══════════════════════════ ۵) با سرورِ حسابِ واقعی ══════════════════════════ */
  console.log('\n── ۵) پنلِ واقعی + سرورِ حسابِ واقعی ──');
  if (!ACCOUNT_DIR) {
    console.log('  ⚠️  کدِ سرورِ حساب پیدا نشد (ACCOUNT_SERVER_DIR یا ../shop/server با node_modules) — این بخش رد شد.');
  } else {
    const PANEL = BASE_PORT + 3, PUBLIC = BASE_PORT + 4, ACCOUNT = BASE_PORT + 5;
    const D9 = path.join(tmp, 'd9');
    let out = '';
    let panel = null;
    const boot = () => {
      panel = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
        cwd: SRV,
        env: { ...process.env, HESABPAY_CRED_KEY: '', HESABPAY_CRED_KEY_PREVIOUS: '',
          HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: D9, HLP_SITES_ROOT: path.join(tmp, 'sites9'),
          HLP_SITESYNC: '1', HLP_SITESYNC_PORT: String(PUBLIC), HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_DISCOVERY: '0', HLP_AGENT: '0',
          HLP_AUTOMATION: '0', HLP_UPDATE_AUTO: '0', HLP_STATIONS: '0', HLP_LIBRARY_ROOT: path.join(tmp, 'lib9'), HLP_BACKUP_ROOT: path.join(tmp, 'bk9'),
          HLP_ACCOUNT_API: `http://127.0.0.1:${ACCOUNT}`, HLP_ACCOUNT_DIR: ACCOUNT_DIR, HLP_ACCOUNT_AUTOSTART: '1',
          HLP_ACCOUNT_ADMIN_USER: '', HLP_ACCOUNT_ADMIN_PASSWORD: '', HLP_RATE_LOGIN: '1000' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      panel.stdout.on('data', (x) => (out += x));
      panel.stderr.on('data', (x) => (out += x));
    };
    const stop = async () => {
      if (!panel) return;
      const p = panel; panel = null;
      p.kill('SIGTERM');
      await new Promise((r) => { p.once('exit', r); setTimeout(r, 8000); });
    };
    const hit = async (port, p, { method = 'GET', body, headers = {}, raw = false } = {}) => {
      const res = await fetch(`http://127.0.0.1:${port}${p}`, {
        method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      const buf = Buffer.from(await res.arrayBuffer());
      const text = raw ? buf.toString('latin1') : buf.toString('utf8');
      let json = null;
      try { json = JSON.parse(text); } catch { /* غیرِ JSON */ }
      return { status: res.status, json, text };
    };
    const waitReady = async (auth) => {
      for (let i = 0; i < 160; i++) {
        const st = await hit(PANEL, '/api/account-server/status', { headers: auth }).catch(() => null);
        if (st?.json?.up && st.json.running && st.json.hesabpay) return st.json;
        await wait(500);
      }
      return null;
    };
    const login = async () => {
      for (let i = 0; i < 120; i++) { try { if ((await fetch(`http://127.0.0.1:${PANEL}/health`)).ok) break; } catch { /* هنوز */ } await wait(250); }
      await hit(PANEL, '/api/auth/setup', { method: 'POST', body: { username: 'owner', password: 'Hp-1405-test-pass' } }).catch(() => null);
      const l = await hit(PANEL, '/api/auth/login', { method: 'POST', body: { username: 'owner', password: 'Hp-1405-test-pass' } });
      return { Authorization: `Bearer ${l.json?.token}` };
    };
    const envOfPid = (pid) => {
      try { return Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`, 'latin1').split('\0').filter(Boolean).map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)])); } catch { return null; }
    };
    try {
      boot();
      let auth = await login();
      const st = await waitReady(auth);
      check('سرورِ حساب با پنل بالا آمد', !!st, out.slice(-1200));
      const key = secretsOf(D9).hesabpayCredKey;
      check('کلید یک بار ساخته شد (۶۴ hex) در secrets.json ِ پوشهٔ داده', HEX64.test(key || ''));
      check('وضعیتِ پنل: «حساب‌پیِ خودکار: آماده» (ready، ok، managed)', st?.hesabpay?.ready === true && st.hesabpay.state === 'ok' && st.hesabpay.source === 'managed', JSON.stringify(st?.hesabpay));
      if (process.platform === 'linux' && st?.pid) {
        const ce = envOfPid(st.pid);
        check('محیطِ واقعیِ پروسهٔ فرزند (‎/proc/<pid>/environ‎) همان کلید را دارد — و هیچ HLP_ ای نه', ce?.HESABPAY_CRED_KEY === key && !Object.keys(ce || {}).some((k) => k.startsWith('HLP_')));
      }

      //  خودِ shop: مدیرِ خودساخته ⇐ از درِ عمومی ⇐ providers و اعتبارنامه‌ها
      const rev = await hit(PANEL, '/api/account-server/admin-password/reveal', { method: 'POST', body: {}, headers: auth });
      const al = await hit(PUBLIC, '/api/admin/login', { method: 'POST', body: { username: rev.json?.username, password: rev.json?.password } });
      const sAuth = { Authorization: `Bearer ${al.json?.token || al.json?.accessToken}` };
      const prov = await hit(PUBLIC, '/api/admin/system/providers', { headers: sAuth });
      const pay = (prov.json?.providers || []).find((p) => p.id === 'payment');
      check('shop خودش می‌گوید: پرداختِ آنلاین ‎hesabpay / live‎، هر دکان کلیدِ خودش (پشتِ پرچمِ pay.hesabpay)',
        pay?.mode === 'hesabpay' && pay?.state === 'live' && pay?.perShop === true && pay?.flag === 'pay.hesabpay', `${prov.status} ${JSON.stringify(pay)}`);
      const integ = await hit(PUBLIC, '/api/admin/ops/integrations', { headers: sAuth });
      const cred = (integ.json?.credentials || []).find((c) => c.id === 'HESABPAY_CRED_KEY');
      check('نمای «اعتبارنامه‌ها» ِ shop: HESABPAY_CRED_KEY «هست» (و بی مقدار)', cred?.set === true && !integ.text.includes(key), `${integ.status} ${JSON.stringify(cred)}`);
      const wh = (integ.json?.webhooks || []).find((w) => w.id === 'hesabpay');
      check('… و کارتِ وب‌هوکِ حساب‌پی ‎live‎ (نه BLOCKED ِ cred_key_missing)', wh?.state === 'live' && wh?.signatureSecretSet === true, JSON.stringify(wh));
      const hook = await hit(PUBLIC, `/api/v1/payments/webhook/hesabpay/${crypto.randomBytes(24).toString('base64url')}`, { method: 'POST', body: { status: 'paid' }, headers: { 'x-hesab-signature': 'sha256=00' } });
      check('وب‌هوک از درِ عمومی به shop ِ واقعی می‌رسد (پاسخِ خودِ shop، نه ۵۰۳/۵۰۲ ِ درگاه)', ![502, 503, 504].includes(hook.status) && hook.json?.error?.code !== 'account_server_down', `${hook.status} ${hook.text.slice(0, 160)}`);

      //  پایداری: راه‌اندازیِ دوبارهٔ سرورِ حساب و خودِ پنل
      const pid1 = st?.pid;
      await hit(PANEL, '/api/account-server/restart', { method: 'POST', body: {}, headers: auth });
      let st2 = null;
      for (let i = 0; i < 160 && !(st2?.pid && st2.pid !== pid1); i++) { await wait(500); st2 = await waitReady(auth); }
      check('پس از «راه‌اندازیِ دوباره» ِ سرورِ حساب: پروسهٔ تازه، همان کلید، باز «آماده»',
        !!st2 && st2.pid !== pid1 && secretsOf(D9).hesabpayCredKey === key && st2.hesabpay?.ready === true && (process.platform !== 'linux' || envOfPid(st2.pid)?.HESABPAY_CRED_KEY === key), JSON.stringify(st2?.hesabpay));
      await stop();
      //  همان کاری که به‌روزرسانیِ پنل می‌کند: پنل می‌بندد (فرزند هم) و دوباره بالا می‌آید — پس از آزاد شدنِ پورتِ سرورِ حساب
      for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${ACCOUNT}/api/health`, { signal: AbortSignal.timeout(1000) }); await wait(250); } catch { break; } }
      boot();
      auth = await login();
      const st3 = await waitReady(auth);
      check('پس از خاموش/روشن شدنِ خودِ پنل: همان کلید و «آماده»', !!st3 && secretsOf(D9).hesabpayCredKey === key && st3.hesabpay?.ready === true
        && (process.platform !== 'linux' || envOfPid(st3.pid)?.HESABPAY_CRED_KEY === key), out.slice(-600));

      //  ⛔ کلید در هیچ پاسخِ GET ِ پنل نیست — فهرستِ درها از خودِ کد (index.js ⇐ app.use ⇐ router.get بی پارامتر)
      const routes = panelGetRoutes();
      const leaks = [];
      let answered = 0;
      for (let i = 0; i < routes.length; i += 8) {
        await Promise.all(routes.slice(i, i + 8).map(async (r) => {
          try {
            const x = await hit(PANEL, r, { headers: auth, raw: true });
            answered++;
            if (x.text.includes(key)) leaks.push(r);
          } catch { /* مهلت یا جریانِ بی‌پایان — بی پاسخ چیزی هم لو نمی‌رود */ }
        }));
      }
      check(`⛔ کلید در پاسخِ هیچ‌کدام از ${routes.length} درِ GET ِ پنل نیست (${answered} پاسخ داد)`, routes.length > 150 && answered > 100 && leaks.length === 0, leaks.join(' '));
      const pubHits = await Promise.all(['/api/health', '/api/v1/health', '/health', '/api/account-server/status'].map((p) => hit(PUBLIC, p, { raw: true }).catch(() => ({ text: '' }))));
      check('⛔ … و نه در پاسخِ درِ عمومی', !pubHits.some((x) => x.text.includes(key)));
      const logs = await hit(PANEL, '/api/account-server/logs?limit=200', { headers: auth });
      check('⛔ نه در لاگِ پنل (stdout/stderr) و نه در لاگِ سرورِ حساب', !out.includes(key) && logs.status === 200 && !logs.text.includes(key));
      await stop();
      const holders = [];
      const walkFiles = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const file = path.join(directory, entry.name);
          try {
            if (entry.isDirectory()) walkFiles(file);
            else if (entry.isFile() && fs.readFileSync(file).includes(key)) holders.push(path.relative(D9, file));
          } catch (error) {
            // PostgreSQL may remove transient files as the account server shuts down.
            if (error.code !== 'ENOENT') throw error;
          }
        }
      };
      walkFiles(D9);
      check('⛔ در پوشهٔ داده فقط secrets.json کلید را دارد (نه panel.db، نه لاگ، نه دیتابیسِ سرورِ حساب)',
        holders.length === 1 && holders[0] === path.join('account-server', 'secrets.json'), holders.join(' | '));
    } finally {
      await stop();
    }
  }

  /* ══════════════════════════ ۶) نگهبانِ ایستا ══════════════════════════ */
  console.log('\n── ۶) کلید فقط از یک جا خوانده می‌شود ──');
  const srcFiles = [];
  const walkSrc = (d) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); fs.statSync(p).isDirectory() ? walkSrc(p) : /\.(m?js)$/.test(n) && srcFiles.push(p); } };
  walkSrc(path.join(SRV, 'src'));
  const codeOf = (p) => fs.readFileSync(p, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  //  خواندنِ مقدار: فیلدِ ‎hesabpayCredKey‎ ِ secrets.json، ‎env.HESABPAY_CRED_KEY‎، یا گذاشتنش در شیءِ محیط (نامِ خالی در متن/فهرست نه)
  const users = srcFiles.filter((p) => /hesabpayCredKey|env\.HESABPAY_CRED_KEY|HESABPAY_CRED_KEY\s*:/.test(codeOf(p))).map((p) => path.relative(SRV, p)).sort();
  check('در کدِ پنل فقط ناظر مقدارِ کلید را می‌خواند یا جایی می‌گذارد', JSON.stringify(users) === JSON.stringify(['src/account/supervisor.js']), users.join(' '));
  const envCallers = srcFiles.filter((p) => /accountChildEnv\(/.test(codeOf(p))).map((p) => path.relative(SRV, p));
  check('محیطِ فرزند (accountChildEnv) فقط در خودِ ناظر ساخته می‌شود، هیچ مسیری آن را برنمی‌گرداند', JSON.stringify(envCallers) === JSON.stringify(['src/account/supervisor.js']), envCallers.join(' '));
} finally {
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

/** درهای GET ِ بی‌پارامترِ پنل از خودِ کد: ‎app.use('/api/…', …, X)‎ ِ index.js ⇐ فایلِ X ⇐ ‎<router>.get('…')‎ */
function panelGetRoutes() {
  const idx = fs.readFileSync(path.join(SRV, 'src', 'index.js'), 'utf8');
  const vars = new Map();
  for (const m of idx.matchAll(/^import\s+(.+?)\s+from\s+'\.\/(routes\/[^']+|modules\/[^']+)';/gm)) {
    const spec = m[1].trim();
    const def = /^([A-Za-z_$][\w$]*)/.exec(spec);
    if (def) vars.set(def[1], { file: m[2], exp: 'default' });
    const named = /\{([^}]*)\}/.exec(spec);
    if (named) {
      for (const part of named[1].split(',')) {
        const [x, y] = part.trim().split(/\s+as\s+/);
        if (x) vars.set((y || x).trim(), { file: m[2], exp: x.trim() });
      }
    }
  }
  const out = new Set();
  const getsOf = (file, rv) => {
    const src = fs.readFileSync(path.join(SRV, 'src', file), 'utf8');
    return [...src.matchAll(new RegExp(`\\b${rv}\\.get\\(\\s*'([^']*)'`, 'g'))].map((x) => x[1]).filter((p) => !/[:*(]/.test(p));
  };
  for (const m of idx.matchAll(/app\.use\('(\/api\/[^']+)',([^;\n]*)\);/g)) {
    const last = m[2].split(',').pop().trim();
    const v = vars.get(last);
    if (!v) continue;
    const src = fs.readFileSync(path.join(SRV, 'src', v.file), 'utf8');
    const rv = v.exp === 'default' ? (/export default\s+([A-Za-z_$][\w$]*)/.exec(src)?.[1] || 'router') : v.exp;
    for (const p of getsOf(v.file, rv)) out.add(`${m[1]}${p === '/' ? '' : p}`);
    //  درهای ماژولِ فروشگاه زیرِ همان ‎/api/account-admin‎
    if (v.file === 'routes/account-admin.js') {
      const dir = path.join(SRV, 'src', 'modules', 'shop', 'routes');
      for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) for (const p of getsOf(path.join('modules', 'shop', 'routes', f), 'router')) out.add(`${m[1]}${p}`);
    }
  }
  return [...out].sort();
}

console.log(`\n${fail ? '❌' : '✅'} ${pass} درست، ${fail} نادرست`);
process.exit(fail ? 1 : 0);
