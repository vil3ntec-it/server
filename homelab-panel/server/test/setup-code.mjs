// ---------------------------------------------------------------------------
//  آزمونِ «ساختِ نخستین مدیر فقط از همین کامپیوتر، یا با کدِ یک‌بار» (۱.۵۰.۸۵)
//      node test/setup-code.mjs
//
//  یافته (تصمیمِ ۱.۵۰.۸۴ ⇐ ساخته در ۱.۵۰.۸۵): تا نخستین مدیر نیست،
//  ‎POST /api/auth/setup‎ از **هر** همتای شبکهٔ خانه پذیرفته می‌شد (برنامهٔ ویندوز
//  پیش‌فرض روی ‎0.0.0.0‎، `service-linux.sh` هم) ⇒ هر که زودتر می‌رسید مالک می‌شد.
//  حالا:
//    • از خودِ همین کامپیوتر (لوپ‌بک، بی سرآیندِ پراکسی، با Host/Origin ِ لوپ‌بک —
//      برنامهٔ ویندوز و مرورگرِ همین کامپیوتر) مثلِ امروز، بی کد؛
//    • از هر جای دیگر فقط با کدِ یک‌باری که سرور در بارِ اول می‌سازد و فقط در
//      کنسول/لاگِ خودش (و ترمینالِ برنامهٔ ویندوز) چاپ می‌کند — درهم‌شده نگه‌داری،
//      یک‌بارمصرف، با ساختِ مدیر باطل، و حدسش سقف دارد.
//
//  ⚠️ کد هرگز در خروجیِ همین آزمون چاپ نمی‌شود (`redact`): فقط از خروجیِ پروسهٔ
//  فرزند خوانده و همان‌جا به‌کار می‌رود.
//
//  ۱) قاعده‌های خالص (`src/lib/setup-code.js`)
//  ۲) پنلِ واقعی بی مدیرِ محیط: همتای شبکهٔ خانه (نشانیِ غیرِ لوپ‌بکِ همین کامپیوتر)
//  ۳) راهِ مالک از همین کامپیوتر، سقفِ هر IP، و نصبی که مدیر را از محیط می‌سازد
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = path.join(import.meta.dirname, '..', 'src');
let passed = 0;
let failed = 0;
const CODE_RE = /[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/g;
const redact = (s) => String(s ?? '').replace(CODE_RE, '****-****-****');
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + redact(extra).slice(0, 400) : ''}`); }
};
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-setup-code-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─────────────────────── ۱) قاعده‌های خالص ─────────────────────── */
console.log('── ۱) کدِ یک‌بار و «همین کامپیوتر» — خالص ──');
let mod = null;
try {
  mod = await import(pathToFileURL(path.join(SRC, 'lib', 'setup-code.js')).href);
} catch (e) {
  check('ماژولِ src/lib/setup-code.js هست', false, e.message);
}
if (mod) {
  const quiet = () => {};
  const a = mod.issueSetupCode({ announce: quiet });
  const b = mod.issueSetupCode({ announce: quiet });
  check('کد: ۱۲ نویسهٔ base32 ِ کراکفورد در سه گروه (۶۰ بیت)', /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){2}$/.test(a));
  check('هر بار تازه (تصادفیِ رمزنگاری)', a !== b);
  check('کدِ پیشین با کدِ تازه باطل شد', mod.checkSetupCode(a).ok === false);
  check('کدِ درست پذیرفته می‌شود — و با یک بار سنجیدن مصرف نمی‌شود (رمزِ کوتاه کد را نسوزاند)',
    mod.checkSetupCode(b).ok === true && mod.checkSetupCode(b).ok === true);
  const loose = b.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l')
    .replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
  check('نوشتنِ آزاد: حروفِ کوچک، فاصله، ‎O/L‎ به‌جای ‎0/1‎، رقمِ فارسی', mod.checkSetupCode(loose).ok === true);
  check('خالی ⇒ missing (حدس شمرده نمی‌شود)', mod.checkSetupCode('').reason === 'missing' && mod.checkSetupCode(undefined).reason === 'missing');
  check('نادرست ⇒ invalid', mod.checkSetupCode('AAAA-BBBB-CCCC').reason === 'invalid');
  check('سقفِ حدسِ همه با هم (نه فقط هر IP) عدد است', Number.isInteger(mod.SETUP_CODE_MAX_FAILS) && mod.SETUP_CODE_MAX_FAILS > 0 && mod.SETUP_CODE_MAX_FAILS <= 20);

  //  ⛔ سقفِ حدس: پس از N حدسِ نادرست کد می‌سوزد و کدِ تازه فقط در کنسول چاپ می‌شود
  let announced = [];
  const c = mod.issueSetupCode({ announce: (code, why) => announced.push([code, why]) });
  announced = [];
  let last = null;
  for (let i = 0; i < mod.SETUP_CODE_MAX_FAILS; i++) last = mod.checkSetupCode(`WRNG-${String(i).padStart(4, '0')}-ZZZZ`);
  check(`⛔ ${mod.SETUP_CODE_MAX_FAILS} حدسِ نادرست ⇒ کد سوخت و کدِ تازه (فقط به اعلان‌گر) داده شد`,
    last?.rotated === true && announced.length === 1 && announced[0][0] !== c, JSON.stringify(last));
  check('⛔ کدِ سوخته دیگر درست نیست — حتی درستش', mod.checkSetupCode(c).ok === false);
  check('کدِ تازه کار می‌کند', announced[0] && mod.checkSetupCode(announced[0][0]).ok === true);
  check('پاسخِ سنجش هرگز خودِ کد را ندارد', !JSON.stringify(last).match(CODE_RE));

  mod.clearSetupCode();
  check('پس از ساختِ مدیر (clear): هیچ کدی معتبر نیست', mod.checkSetupCode(announced[0]?.[0] || 'x').ok === false && mod.hasSetupCode() === false);

  const req = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });
  check('همین کامپیوتر: 127.0.0.1 بی سرآیند', mod.isDirectLocal(req('127.0.0.1', { host: '127.0.0.1:4700' })));
  check('همین کامپیوتر: ‎::1‎ و ‎::ffff:127.0.0.1‎ و localhost', mod.isDirectLocal(req('::1', { host: '[::1]:4700' }))
    && mod.isDirectLocal(req('::ffff:127.0.0.1', { host: 'localhost:4700', origin: 'http://localhost:4700' })));
  check('برنامهٔ ویندوز (‎<webview>‎ از ‎http://127.0.0.1:پورت‎ با Origin ِ خودش)',
    mod.isDirectLocal(req('127.0.0.1', { host: '127.0.0.1:4711', origin: 'http://127.0.0.1:4711' })));
  check('⛔ همتای شبکهٔ خانه همین کامپیوتر نیست', !mod.isDirectLocal(req('192.168.1.50', { host: '192.168.1.5:4700' })));
  check('⛔ پراکسی/تونلِ همین کامپیوتر (XFF/CF/X-Real-IP/Forwarded) همین کامپیوتر نیست',
    ['x-forwarded-for', 'cf-connecting-ip', 'x-real-ip', 'forwarded'].every((h) => !mod.isDirectLocal(req('127.0.0.1', { host: 'localhost', [h]: '198.51.100.7' }))));
  check('⛔ بازپیوندِ DNS: Host ِ بیگانه از لوپ‌بک همین کامپیوتر نیست', !mod.isDirectLocal(req('127.0.0.1', { host: 'evil.example:4700' })));
  check('⛔ صفحهٔ بیگانه در مرورگرِ همین کامپیوتر (Origin ِ بیگانه یا null) همین کامپیوتر نیست',
    !mod.isDirectLocal(req('127.0.0.1', { host: '127.0.0.1:4700', origin: 'https://evil.example' }))
    && !mod.isDirectLocal(req('127.0.0.1', { host: '127.0.0.1:4700', origin: 'null' })));
}

/* ──────────────── ۲) پنلِ واقعی، همتای شبکهٔ خانه ──────────────── */
const lanIp = Object.values(os.networkInterfaces()).flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))?.address;
check('این کامپیوتر نشانیِ غیرِ لوپ‌بک دارد (همتای «شبکهٔ خانه»)', Boolean(lanIp), 'بی کارتِ شبکه بخشِ ۲ و ۳ سنجیده نمی‌شود');

const children = [];
function startPanel(name, port, extraEnv = {}) {
  const dataDir = path.join(tmp, name, 'data');
  fs.mkdirSync(path.join(tmp, name, 'sites'), { recursive: true });
  const env = {
    ...process.env,
    HLP_DEPLOY: 'home', HLP_PORT: String(port), HLP_SITESYNC_PORT: String(port + 1), HLP_HOST: '0.0.0.0',
    HLP_PANEL_NETS: `${lanIp}/32`,
    HLP_DATA_DIR: dataDir, HLP_SITES_ROOT: path.join(tmp, name, 'sites'),
    HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_SITESYNC: '0', HLP_DISCOVERY: '0', HLP_ACCOUNT_API: '0',
    ...extraEnv,
  };
  for (const k of ['HLP_ADMIN_USER', 'HLP_ADMIN_PASSWORD']) if (!(k in extraEnv)) delete env[k];
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(SRC, 'index.js')], {
    env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const p = { child, out: '', dataDir, loop: `http://127.0.0.1:${port}`, lan: `http://${lanIp}:${port}` };
  child.stdout.on('data', (d) => (p.out += d));
  child.stderr.on('data', (d) => (p.out += d));
  children.push(child);
  return p;
}
async function up(p) {
  for (const end = Date.now() + 30000; Date.now() < end;) {
    try { if ((await fetch(`${p.loop}/health`)).ok) return true; } catch { /* هنوز */ }
    await wait(200);
  }
  throw new Error(`پنل بالا نیامد:\n${redact(p.out.slice(-1500))}`);
}
const call = async (base, method, url, body, headers = {}) => {
  const r = await fetch(`${base}${url}`, {
    method, headers: { 'content-type': 'application/json', ...headers }, body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* متن */ }
  return { status: r.status, json, text };
};
/** با ‎node:http‎ — ‎fetch‎ سرآیندِ Host را خودش می‌نویسد و نمی‌گذارد بازپیوندِ DNS ساخته شود */
const rawCall = (base, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const u = new URL(url, base);
  const data = body == null ? null : Buffer.from(JSON.stringify(body));
  const r = http.request({
    host: u.hostname, port: u.port, path: u.pathname + u.search, method,
    headers: { 'content-type': 'application/json', ...(data ? { 'content-length': data.length } : {}), ...headers },
  }, (res) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', (d) => (text += d));
    res.on('end', () => {
      let json = null;
      try { json = JSON.parse(text); } catch { /* متن */ }
      resolve({ status: res.statusCode, json, text });
    });
  });
  r.on('error', reject);
  if (data) r.write(data);
  r.end();
});
const CODE_LINE = /setup code\): ([0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4})/g;
const codesIn = (out) => [...String(out).matchAll(CODE_LINE)].map((m) => m[1]);
/** هر پرونده‌ای زیرِ پوشهٔ داده که یکی از این رشته‌ها را دارد */
function filesContaining(dir, needles) {
  const hits = [];
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { walk(f); continue; }
      let buf;
      try { buf = fs.readFileSync(f); } catch { continue; }
      for (const n of needles) {
        if (buf.includes(Buffer.from(n)) || buf.includes(Buffer.from(n, 'utf16le'))) hits.push(path.relative(dir, f));
      }
    }
  };
  walk(dir);
  return hits;
}

const BASE_PORT = Number(process.env.TEST_PORT || 4874);
try {
  if (lanIp) {
    console.log('\n── ۲) پنلِ واقعی بی مدیرِ محیط: دستگاهِ دیگرِ شبکهٔ خانه ──');
    //  سقفِ هر IP جدا سنجیده می‌شود (بخشِ ۳)؛ این‌جا بالا تا سقفِ «همه با هم» ِ خودِ کد دیده شود
    const p = startPanel('lan', BASE_PORT, { HLP_RATE_SETUP: '1000', HLP_AUTH_RATE_LIMIT: '1000' });
    await up(p);
    await wait(300);
    const first = codesIn(p.out);
    check('سرور در بارِ اول یک کدِ یک‌بار در کنسولِ خودش چاپ کرد — یک بار', first.length === 1, `${first.length} خط`);
    const code1 = first[0] || '';
    check('همان کد فقط یک بار در خروجیِ سرور آمده', code1 && p.out.split(code1).length - 1 === 1);

    const stLan = await call(p.lan, 'GET', '/api/auth/status');
    const stLoop = await call(p.loop, 'GET', '/api/auth/status');
    check('وضعیت از شبکهٔ خانه: «کد لازم است»', stLan.json?.initialized === false && stLan.json?.setupCode === true, stLan.text);
    check('وضعیت از همین کامپیوتر: کد لازم نیست', stLoop.json?.initialized === false && stLoop.json?.setupCode === false, stLoop.text);
    check('پاسخِ وضعیت خودِ کد را ندارد', !CODE_RE.test(stLan.text + stLoop.text));
    CODE_RE.lastIndex = 0;

    const OWNER = { username: 'owner', password: 'Owner-Pass-2026!x' };
    const s0 = await call(p.lan, 'POST', '/api/auth/setup', { username: 'stranger', password: 'Stranger-2026!x' });
    check('⛔ غریبهٔ شبکهٔ خانه بی کد مالک نمی‌شود ⇒ 403 setup_code_required', s0.status === 403 && s0.json?.error === 'setup_code_required', `${s0.status} ${s0.text.slice(0, 160)}`);
    const s0v1 = await call(p.lan, 'POST', '/api/panel/v1/auth/setup', { username: 'stranger', password: 'Stranger-2026!x' });
    check('⛔ همان در از راهِ ‎/api/panel/v1‎ هم', s0v1.status === 403 && s0v1.json?.error === 'setup_code_required', `${s0v1.status}`);
    const sx = await call(p.loop, 'POST', '/api/auth/setup', { username: 'stranger', password: 'Stranger-2026!x' }, { 'x-forwarded-for': '198.51.100.9' });
    check('⛔ از راهِ پراکسی/تونلِ همین کامپیوتر (XFF) هم بی کد نه', sx.status === 403 && sx.json?.error === 'setup_code_required', `${sx.status}`);
    const sh = await rawCall(p.loop, 'POST', '/api/auth/setup', { username: 'stranger', password: 'Stranger-2026!x' }, { host: `evil.example:${BASE_PORT}` });
    check('⛔ بازپیوندِ DNS (Host ِ بیگانه روی لوپ‌بک) بی کد نه', sh.status === 403 && sh.json?.error === 'setup_code_required', `${sh.status}`);
    const so = await rawCall(p.loop, 'POST', '/api/auth/setup', { username: 'stranger', password: 'Stranger-2026!x' }, { origin: 'https://evil.example' });
    check('⛔ صفحهٔ بیگانه در مرورگرِ همین کامپیوتر (Origin ِ بیگانه) بی کد نه', so.status === 403 && so.json?.error === 'setup_code_required', `${so.status}`);
    check('هنوز هیچ مدیری ساخته نشده', (await call(p.loop, 'GET', '/api/auth/status')).json?.initialized === false);

    let wrong = null;
    const MAX = mod?.SETUP_CODE_MAX_FAILS ?? 10;
    for (let i = 0; i < MAX; i++) {
      wrong = await call(p.lan, 'POST', '/api/auth/setup', { ...OWNER, username: 'stranger', setupCode: `WRNG-${String(i).padStart(4, '0')}-ZZZZ` });
    }
    check('⛔ کدِ نادرست ⇒ 403 setup_code_invalid', wrong.status === 403 && wrong.json?.error === 'setup_code_invalid', `${wrong.status} ${wrong.text.slice(0, 160)}`);
    await wait(200);
    const all = codesIn(p.out);
    const code2 = all[all.length - 1] || '';
    check(`⛔ پس از ${MAX} حدسِ نادرست (از هر IP) کد سوخت و کدِ تازه فقط در کنسول آمد`, all.length === 2 && code2 && code2 !== code1, `${all.length} خط`);
    const old = await call(p.lan, 'POST', '/api/auth/setup', { ...OWNER, setupCode: code1 });
    check('⛔ کدِ سوخته (حتی درستِ پیشین) دیگر کار نمی‌کند', old.status === 403 && old.json?.error === 'setup_code_invalid', `${old.status}`);

    const short = await call(p.lan, 'POST', '/api/auth/setup', { username: 'owner', password: 'short', setupCode: code2 });
    check('کدِ درست + رمزِ کوتاه ⇒ 400 password_too_short و کد نسوخت', short.status === 400 && short.json?.error === 'password_too_short', `${short.status}`);

    const ok = await call(p.lan, 'POST', '/api/auth/setup', { ...OWNER, setupCode: code2.toLowerCase().replace(/-/g, ' ') });
    check('✅ مالک از گوشی/کامپیوترِ دیگرِ شبکه با کدِ کنسول مدیر را ساخت', ok.status === 200 && Boolean(ok.json?.token), `${ok.status} ${ok.text.slice(0, 160)}`);
    const me = ok.json?.token ? await call(p.lan, 'GET', '/api/auth/me', null, { authorization: `Bearer ${ok.json.token}` }) : null;
    check('همان حساب مالکِ پنل است', me?.json?.owner === true && me?.json?.user?.username === 'owner', me?.text?.slice(0, 160));
    const again = await call(p.lan, 'POST', '/api/auth/setup', { username: 'second', password: 'Second-2026!x', setupCode: code2 });
    check('⛔ یک‌بارمصرف: همان کد پس از ساخت ⇒ 409 already_initialized', again.status === 409 && again.json?.error === 'already_initialized', `${again.status}`);
    await wait(200);
    check('پس از ساخت کنسول می‌گوید کد باطل شد (خطِ کد دیگر معتبر نیست)', /کدِ راه‌اندازی باطل شد/.test(p.out));
    check('پس از ساخت هیچ کدِ تازه‌ای چاپ نشد', codesIn(p.out).length === 2);

    if (ok.json?.token) {
      const auth = { authorization: `Bearer ${ok.json.token}` };
      const audit = await call(p.loop, 'GET', '/api/audit?source=panel&limit=200', null, auth);
      const events = await call(p.loop, 'GET', '/api/logs?limit=500', null, auth);
      const setupRows = (audit.json?.rows || []).filter((r) => r.action === 'panel.setup');
      check('دفترِ رخداد: تلاش‌های بی کد/با کدِ نادرست و ساختِ موفق ثبت شد', setupRows.some((r) => r.result !== 'ok') && setupRows.some((r) => r.result === 'ok'),
        JSON.stringify(setupRows.slice(0, 3).map((r) => [r.result, r.detail])));
      check('⛔ نه دفترِ رخداد نه لاگِ پنل (که viewer می‌خواند) هیچ‌کدام از دو کد را ندارد',
        audit.status === 200 && events.status === 200 && ![code1, code2].some((c) => c && (audit.text.includes(c) || events.text.includes(c))),
        `${audit.status}/${events.status}`);
    }
    await wait(500);
    const leaked = filesContaining(p.dataDir, [code1, code2, code1.replace(/-/g, ''), code2.replace(/-/g, '')].filter(Boolean));
    check('⛔ هیچ پرونده‌ای در پوشهٔ داده (panel.db، WAL، لاگ…) کد را به متنِ ساده ندارد', leaked.length === 0, leaked.join(', '));

    console.log('\n── ۳) راهِ مالک از همین کامپیوتر · سقفِ هر IP · مدیرِ محیطِ نصب ──');
    const q = startPanel('loop', BASE_PORT + 10);
    await up(q);
    let limited = 0;
    for (let i = 0; i < 7; i++) {
      const r = await call(q.lan, 'POST', '/api/auth/setup', { username: 'stranger', password: 'Stranger-2026!x', setupCode: `WRNG-${String(i).padStart(4, '0')}-YYYY` });
      if (r.status === 429) limited++;
    }
    check('⛔ سقفِ هر IP (پیش‌فرض) حدسِ کد را از یک دستگاه می‌بندد ⇒ 429', limited >= 1, `${limited} از ۷`);
    const local = await call(q.loop, 'POST', '/api/auth/setup', { username: 'owner', password: 'Owner-Pass-2026!x' });
    check('✅ مالک روی همین کامپیوتر (مرورگر/برنامهٔ ویندوز) بی کد می‌سازد — و سقفِ دستگاهِ دیگر قفلش نکرد',
      local.status === 200 && Boolean(local.json?.token), `${local.status} ${local.text.slice(0, 160)}`);
    await wait(200);
    check('پس از ساختِ محلی هم کنسول «باطل شد» می‌گوید', /کدِ راه‌اندازی باطل شد/.test(q.out));

    const r = startPanel('env', BASE_PORT + 20, { HLP_ADMIN_USER: 'admin', HLP_ADMIN_PASSWORD: 'Install-Pass-2026!x' });
    await up(r);
    await wait(300);
    check('نصبی که مدیر را از محیط می‌سازد (install.sh/داکر): هیچ کدی چاپ نمی‌شود', codesIn(r.out).length === 0);
    const late = await call(r.lan, 'POST', '/api/auth/setup', { username: 'stranger', password: 'Stranger-2026!x' });
    check('و درِ ساخت بسته است ⇒ 409', late.status === 409, `${late.status}`);
  }
} catch (e) {
  check('اجرای بخشِ ۲/۳', false, e.stack || e.message);
} finally {
  for (const c of children) c.kill('SIGTERM');
  await wait(400);
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failed ? '❌' : '✅'} setup-code: ${passed} درست، ${failed} نادرست`);
process.exit(failed ? 1 : 0);
