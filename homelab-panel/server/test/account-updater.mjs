// ---------------------------------------------------------------------------
//  سرورِ حساب خودش تازه می‌شود — بی نصبِ دوبارهٔ مرکز فرمان
//
//  گزارشِ صاحب سامانه (۱۴۰۵/۰۷/۱۱): برنامهٔ پمپ «نسخهٔ 2.7.0» نشان می‌داد
//  در حالی که `shop` روی ۲.۹.۰ بود — و روی ۲.۷.۰ فروشِ اشتراک کار نمی‌کند.
//  ریشه ساختاری بود: کدِ سرورِ حساب فقط با فایلِ نصب می‌آمد و همان‌جا یخ
//  می‌زد.
//
//  ⚠️ این‌جا **هیچ سروری بالا نمی‌آید**: بسته با `tar` واقعی ساخته و باز
//  می‌شود و جابه‌جایی روی دیسکِ واقعی سنجیده می‌شود. پس سریع است و به
//  اینترنت هم دست نمی‌زند.
// ---------------------------------------------------------------------------
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let pass = 0; const fails = [];
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fails.push(name); console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acct-upd-'));
process.env.HLP_DATA_DIR = path.join(tmp, 'data');
process.env.HLP_SITES_ROOT = path.join(tmp, 'sites');
fs.mkdirSync(process.env.HLP_DATA_DIR, { recursive: true });

const { usable, versionAt, newer, pickDir } = await import('../src/account/bundle.js');

/** یک پوشهٔ سرورِ حسابِ ساختگی که `usable` قبولش کند. */
function makeServer(dir, version, marker = '') {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'account-server', version }));
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), `// ${marker || version}\n`);
  return dir;
}

console.log('\n── ۱) مقایسهٔ نسخه — تلهٔ ۲.۱۰ در برابرِ ۲.۹ ──');
check('۲.۱۰.۰ از ۲.۹.۰ تازه‌تر است (الفبایی مقایسه نمی‌شود)', newer('2.10.0', '2.9.0'));
check('و برعکسش نه', !newer('2.9.0', '2.10.0'));
check('نسخهٔ برابر تازه‌تر نیست', !newer('2.9.0', '2.9.0'));
check('۲.۹.۰ از ۲.۷.۰ تازه‌تر است (همان حالِ صاحب سامانه)', newer('2.9.0', '2.7.0'));
check('نسخهٔ خالی هیچ‌وقت برنده نیست', !newer('', '2.7.0'));

console.log('\n── ۲) کدام پوشه برنده است ──');
const bundled = makeServer(path.join(tmp, 'bundled'), '2.7.0');
const downloaded = path.join(tmp, 'data', 'account-server', 'app');

check('بی پوشهٔ دانلودی، همان بستهٔ نصاب', pickDir({ bundled: [bundled], downloaded }) === bundled);

makeServer(downloaded, '2.9.0');
check('⛔ دانلودیِ تازه‌تر برنده است — ریشهٔ همین باگ',
  pickDir({ bundled: [bundled], downloaded }) === downloaded,
  pickDir({ bundled: [bundled], downloaded }) || 'null');

//  نصابِ تازه باید از دانلودیِ کهنه جلو بزند، وگرنه یکی دیگری را قفل می‌کند
makeServer(bundled, '3.0.0');
check('⚠️ و نصابِ تازه‌تر دوباره جلو می‌زند (قفل نمی‌شوند)',
  pickDir({ bundled: [bundled], downloaded }) === bundled);

makeServer(bundled, '2.7.0');
const forced = makeServer(path.join(tmp, 'forced'), '1.0.0');
check('⛔ مسیرِ صریح همیشه جلوتر است، حتی اگر کهنه باشد',
  pickDir({ forced, bundled: [bundled], downloaded }) === forced);

check('پوشهٔ بی node_modules اصلاً شمرده نمی‌شود', !usable(path.join(tmp, 'nope')));
fs.mkdirSync(path.join(tmp, 'half', 'src'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'half', 'src', 'index.js'), '');
check('و پوشهٔ نیمه هم نه', !usable(path.join(tmp, 'half')));

console.log('\n── ۳) گرفتن و نشاندنِ بستهٔ واقعی ──');
//  یک بستهٔ واقعی با همان شکلی که ورک‌فلو می‌سازد: یک پوشهٔ سرآمد
const pack = path.join(tmp, 'pack');
makeServer(path.join(pack, 'account-server'), '2.9.0', 'NEW');
const archive = path.join(tmp, 'account-server.tar.gz');
const tar = spawnSync('tar', ['-czf', archive, '-C', pack, 'account-server']);
check('بسته ساخته شد', tar.status === 0 && fs.existsSync(archive), tar.stderr?.toString().slice(0, 120));

//  حالِ پیش از به‌روزرسانی: دانلودیِ کهنه، و دادهٔ کنارش
makeServer(downloaded, '2.7.0', 'OLD');
const secrets = path.join(tmp, 'data', 'account-server', 'secrets.json');
fs.writeFileSync(secrets, '{"adminUser":"مدیر"}');
const pg = path.join(tmp, 'data', 'account-server', 'pg');
fs.mkdirSync(pg, { recursive: true });
fs.writeFileSync(path.join(pg, 'db.bin'), 'دیتابیسِ مشتری');

const updater = await import('../src/account/updater.js');

/** یک گیت‌هابِ ساختگی که همان شکلِ واقعی را می‌دهد. */
const gh = (release) => async (url) => {
  if (String(url).includes('/releases/tags/')) {
    return release
      ? { ok: true, status: 200, json: async () => release }
      : { ok: false, status: 404 };
  }
  return { ok: true, status: 200, arrayBuffer: async () => fs.readFileSync(archive) };
};

const release = {
  name: 'سرورِ حساب — 2.9.0',
  body: 'بستهٔ آمادهٔ اجرا',
  published_at: '2026-09-22T00:00:00Z',
  assets: [{ name: 'account-server.tar.gz', size: fs.statSync(archive).size,
             browser_download_url: 'https://example.invalid/account-server.tar.gz' }],
};

const seen = await updater.check({ fetchImpl: gh(release) });
check('⇒ تازه‌تری هست و دیده می‌شود', seen.ok && seen.available === true && seen.latest === '2.9.0',
  JSON.stringify(seen).slice(0, 200));

const done = await updater.apply({ fetchImpl: gh(release), restart: false });
check('⇒ نشست', done.ok && done.changed === true && done.to === '2.9.0',
  JSON.stringify(done).slice(0, 200));
check('⇒ و نسخهٔ روی دیسک واقعاً عوض شد', versionAt(downloaded) === '2.9.0', versionAt(downloaded));
check('⇒ و محتوایش همان بستهٔ تازه است',
  fs.readFileSync(path.join(downloaded, 'src', 'index.js'), 'utf8').includes('NEW'));

console.log('\n── ۴) ⛔ دادهٔ مشتری دست نمی‌خورد ──');
check('رازها سرِ جایشان', fs.existsSync(secrets)
  && fs.readFileSync(secrets, 'utf8').includes('مدیر'));
check('دیتابیس سرِ جایش', fs.existsSync(path.join(pg, 'db.bin'))
  && fs.readFileSync(path.join(pg, 'db.bin'), 'utf8') === 'دیتابیسِ مشتری');

console.log('\n── ۵) ⛔ بستهٔ خراب هیچ‌وقت جای سالم را نمی‌گیرد ──');
const broken = path.join(tmp, 'broken.tar.gz');
fs.writeFileSync(broken, 'این یک آرشیو نیست');
const before = versionAt(downloaded);
const bad = await updater.apply({
  restart: false,
  fetchImpl: async (url) => String(url).includes('/releases/tags/')
    ? { ok: true, status: 200, json: async () => ({ ...release, name: 'سرورِ حساب — 9.9.9' }) }
    : { ok: true, status: 200, arrayBuffer: async () => fs.readFileSync(broken) },
});
check('⇒ شکست را می‌گوید، نه این‌که وانمود کند شد', bad.ok === false, JSON.stringify(bad).slice(0, 160));
check('⇒ و سرورِ حسابِ در حالِ اجرا دست‌نخورده ماند', versionAt(downloaded) === before,
  `${before} ⇒ ${versionAt(downloaded)}`);

console.log('\n── ۶) ⛔ نبودِ انتشار، صفحه را نمی‌شکند ──');
const none = await updater.check({ fetchImpl: gh(null) });
check('⇒ پیامِ آدمیزاد، بی استثنا', none.ok === false && none.code === 'no_release',
  JSON.stringify(none).slice(0, 160));

const same = await updater.apply({
  restart: false,
  fetchImpl: gh({ ...release, name: 'سرورِ حساب — 2.9.0' }),
});
check('⇒ و وقتی همان نسخه است، چیزی دانلود نمی‌شود',
  same.ok === true && same.changed === false, JSON.stringify(same).slice(0, 160));

console.log('\n── ۷) ⛔ ورک‌فلوی بسته خودش را نمی‌اندازد ──');
//  ۱۴۰۵/۰۷/۱۳: هر چهار اجرای account-server.yml با «node_modules در بسته نیست»
//  افتادند در حالی که بود — `tar -tzf | grep -q` زیرِ `pipefail` (SIGPIPE).
{
  const wf = fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', '..', '.github', 'workflows', 'account-server.yml'), 'utf8');
  const code = wf.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  check('⇒ هیچ «| grep -q»ی زیرِ pipefail نیست', !/\|\s*grep\s+-q/.test(code));
  check('⇒ فهرستِ بسته اول در فایل نوشته می‌شود', /tar -tzf "\$ASSET" > /.test(code));
  check('⇒ و همان دو سنجه سرِ جایشان‌اند (node_modules و src/index.js)',
    code.includes("'^account-server/node_modules/'") && code.includes("'^account-server/src/index.js$'"));
  //  ۱۴۰۵/۰۷/۱۳ (بارِ دوم): کار checkout ندارد، پس `gh release` بی GH_REPO با
  //  «not a git repository» می‌افتاد و بستهٔ ۲.۱۰.۰ منتشر نشد.
  check('⇒ گامِ انتشار ریپو را صریح به gh می‌گوید (GH_REPO)',
    /GH_REPO:\s*\$\{\{\s*github\.repository\s*\}\}/.test(code) || /actions\/checkout/.test(code));
  //  و خودِ آن خطِ پوسته واقعاً می‌دود — با بسته‌ای به بزرگیِ واقعی
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'wfpk-'));
  fs.mkdirSync(path.join(box, 'account-server', 'src'), { recursive: true });
  fs.writeFileSync(path.join(box, 'account-server', 'src', 'index.js'), '');
  for (let i = 0; i < 4000; i++) {
    const d = path.join(box, 'account-server', 'node_modules', 'p' + (i % 90));
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'f' + i + '.js'), 'x');
  }
  spawnSync('tar', ['-czf', 'a.tgz', 'account-server'], { cwd: box });
  const run = (sh) => spawnSync('bash', ['-c', 'set -euo pipefail\n' + sh], { cwd: box, env: { ...process.env, ASSET: 'a.tgz' } }).status;
  const lines = code.split('\n');
  const at = lines.findIndex((l) => l.includes('tar -tzf "$ASSET" >'));
  const fixed = lines.slice(at, at + 5).join('\n').replace(/\/tmp\/pack\/list\.txt/g, 'list.txt');
  check('⇒ خطِ تازه روی بستهٔ پُر سبز است', run(fixed) === 0);
  check('⇒ و خطِ قدیمی همان‌جا می‌افتاد (دندانِ این سنجه)',
    run(`tar -tzf "$ASSET" | grep -q '^account-server/node_modules/' || exit 1`) !== 0);
  fs.rmSync(box, { recursive: true, force: true });
}

// ── ۸) صفحهٔ «به‌روزرسانی»ِ مرکز فرمان سرورِ حساب را هم به‌روز می‌کند ───
//  ۱۴۰۵/۰۷/۱۳: صاحب سامانه «بررسیِ به‌روزرسانی» را زد و چیزی نیامد — سرورِ
//  حساب فقط از کارِ «اتوماسیون» به‌روز می‌شد. حالا همان صفحه هر دو را دارد.
{
  const ui = fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', 'web', 'src', 'pages', 'control', 'Updates.tsx'), 'utf8');
  check('⇒ صفحهٔ به‌روزرسانی سرورِ حساب را می‌سنجد', ui.includes("api<AcctUpdate>('/api/account-server/update')"));
  check('⇒ و همان‌جا نصبش می‌کند (همان درِ کارِ اتوماسیون، نه راهِ دوم)',
    /'\/api\/account-server\/update',\s*\{\s*method:\s*'POST'/.test(ui));
  check('⇒ و دکمهٔ «بررسیِ به‌روزرسانی» هر دو را می‌سنجد',
    /loadAcct\(\);\s*const res = await cc\.checkUpdate\(\)/.test(ui));
  const route = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'routes', 'account-server.js'), 'utf8');
  check('⇒ نصب در پس‌زمینه شروع می‌شود و درخواست منتظرِ دانلود نمی‌ماند',
    /router\.post\('\/update'[\s\S]{0,120}startBundle\(/.test(route) && !/await\s+applyBundle/.test(route));
  check('⇒ و حالِ کار از یک درِ جدا خوانده می‌شود (بی درخواست به گیت‌هاب)',
    /router\.get\('\/update\/progress'[\s\S]{0,80}bundleProgress\(\)/.test(route));
  check('⇒ صفحه هر ثانیه همان را می‌خواند و مگابایت را نشان می‌دهد',
    ui.includes("'/api/account-server/update/progress'") && /MB/.test(ui));
  const bots = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'automation', 'jobs', 'bots.js'), 'utf8');
  check('⇒ کارِ روزانه هم از همان درِ یگانه می‌رود (نه applyِ دوم)',
    bots.includes('startBundle(') && !/applyBundle\(/.test(bots));
  const ops = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'routes', 'control', 'ops.js'), 'utf8');
  check('⛔ نصبِ خودِ مرکز فرمان هم کارِ دوم را رد می‌کند (رفتن و برگشتن از سر نمی‌کند)',
    /if \(updater\.installBusy\(\)\) return res\.status\(409\)/.test(ops));
  check('⇒ و حالِ نصب (مگابایت) در GET /update است و صفحه نشانش می‌دهد',
    /progress: updater\.installProgress\(\)/.test(ops) && ui.includes('<InstallBar p={prog} />'));
  const gh = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'update', 'github.js'), 'utf8');
  check('⇒ دانلودِ نصب بایت‌ها را می‌شمارد', /install\.got \+= chunk\.length/.test(gh));
  const sup = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'account', 'supervisor.js'), 'utf8');
  check('⛔ راه‌اندازیِ دوباره منتظرِ مردنِ پروسهٔ قبلی می‌ماند',
    /export async function restartAccountServer\(\)\s*\{\s*stopAccountServer\(\);\s*await waitAccountServerExit/.test(sup));
}

// ── ۹) ⛔ «دانلود کنسل می‌شود، از سر می‌شود، مگابایت نشان نمی‌دهد» ─────────
//  گزارشِ صاحب سامانه (۱۴۰۵/۰۷/۱۳). رفتاری، با tarِ واقعی و دیسکِ واقعی.
console.log('\n── ۹) دانلودِ ادامه‌دار، یک کار در هر لحظه، و پیوندِ نمادین ──');
{
  /** بسته‌ای با همان شکلِ ورک‌فلو — و یک پیوندِ نمادین در node_modules/.bin */
  const packOf = (version) => {
    const dir = path.join(tmp, `pack-${version}`);
    const srv = makeServer(path.join(dir, 'account-server'), version, `V${version}`);
    fs.mkdirSync(path.join(srv, 'node_modules', 'web-push', 'src'), { recursive: true });
    fs.writeFileSync(path.join(srv, 'node_modules', 'web-push', 'src', 'cli.js'), '// cli\n');
    fs.mkdirSync(path.join(srv, 'node_modules', '.bin'), { recursive: true });
    fs.symlinkSync('../web-push/src/cli.js', path.join(srv, 'node_modules', '.bin', 'web-push'));
    //  کمی حجم تا «نیمه» معنا داشته باشد
    fs.writeFileSync(path.join(srv, 'node_modules', 'big.bin'), crypto.randomBytes(200_000));
    const file = path.join(tmp, `acct-${version}.tar.gz`);
    spawnSync('tar', ['-czf', file, '-C', dir, 'account-server']);
    return file;
  };
  const rel = (version, file) => ({
    name: `سرورِ حساب — ${version}`, body: '', published_at: '2026-09-25T00:00:00Z',
    assets: [{ name: 'account-server.tar.gz', size: fs.statSync(file).size, browser_download_url: `https://example.invalid/${version}` }],
  });
  const hdr = (map) => ({ get: (k) => map[String(k).toLowerCase()] ?? null });

  // ۹الف) اینترنت وسطِ دانلود قطع می‌شود — تلاشِ بعدی با Range ادامه می‌دهد
  const f1 = packOf('5.0.0');
  const bytes = fs.readFileSync(f1);
  const half = Math.floor(bytes.length / 2);
  const ranges = [];
  let calls = 0;
  const flaky = async (url, opts = {}) => {
    if (String(url).includes('/releases/tags/')) return { ok: true, status: 200, json: async () => rel('5.0.0', f1) };
    calls++;
    const range = opts.headers?.range || '';
    ranges.push(range);
    if (calls === 1) {
      //  نیمه می‌آید و بعد اتصال می‌میرد
      return { ok: true, status: 200, headers: hdr({ 'content-length': String(bytes.length) }),
        body: (async function* () { yield bytes.subarray(0, half); throw new Error('ECONNRESET'); })() };
    }
    const from = Number(/bytes=(\d+)-/.exec(range)?.[1] || 0);
    return { ok: true, status: from ? 206 : 200, headers: hdr({ 'content-length': String(bytes.length - from) }),
      body: (async function* () { yield bytes.subarray(from); })() };
  };
  const r1 = await updater.apply({ fetchImpl: flaky, restart: false, retryDelays: [1] });
  check('⇒ قطعی وسطِ دانلود کار را نمی‌کُشد — تمام شد', r1.ok && r1.to === '5.0.0', JSON.stringify(r1).slice(0, 200));
  check('⛔ تلاشِ دوم از همان‌جا ادامه داد، نه از صفر (Range)', ranges[1] === `bytes=${half}-`, JSON.stringify(ranges));
  check('⇒ و نسخهٔ روی دیسک همان بستهٔ تازه است', versionAt(downloaded) === '5.0.0', versionAt(downloaded));
  const p1 = updater.progress();
  check('⇒ حالِ کار مگابایت‌ها را درست می‌شمارد (آمده = کل)', p1.got === bytes.length && p1.total === bytes.length,
    `${p1.got}/${p1.total}`);
  check('⛔ پیوندِ نمادینِ node_modules/.bin باز نمی‌شود (tar.exe ویندوز بی مدیر نمی‌سازدش)',
    !fs.existsSync(path.join(downloaded, 'node_modules', '.bin')));
  check('⇒ و بقیهٔ node_modules سرِ جایش', fs.existsSync(path.join(downloaded, 'node_modules', 'web-push', 'src', 'cli.js')));
  check('⇒ فایلِ نیمه‌کاره پس از موفقیت پاک شد',
    !fs.readdirSync(path.join(tmp, 'data', 'account-server')).some((f) => f.endsWith('.part')));

  // ۹ب) کلیکِ کاربر پس از شکستِ کامل هم از همان‌جا ادامه می‌دهد
  const f2 = packOf('5.1.0');
  const b2 = fs.readFileSync(f2);
  const cut = Math.floor(b2.length / 3);
  let mode = 'die';
  const seen2 = [];
  const net2 = async (url, opts = {}) => {
    if (String(url).includes('/releases/tags/')) return { ok: true, status: 200, json: async () => rel('5.1.0', f2) };
    seen2.push(opts.headers?.range || '');
    if (mode === 'die') {
      return { ok: true, status: 200, headers: hdr({}),
        body: (async function* () { yield b2.subarray(0, cut); throw new Error('ETIMEDOUT'); })() };
    }
    const from = Number(/bytes=(\d+)-/.exec(opts.headers?.range || '')?.[1] || 0);
    return { ok: true, status: 206, headers: hdr({}), body: (async function* () { yield b2.subarray(from); })() };
  };
  const bad2 = await updater.apply({ fetchImpl: net2, restart: false, retryDelays: [] });
  check('⇒ بی اینترنت شکست را راست می‌گوید و می‌گوید از همان‌جا ادامه می‌دهد',
    bad2.ok === false && bad2.code === 'download' && /ادامه/.test(bad2.why), JSON.stringify(bad2).slice(0, 200));
  check('⇒ و سرورِ حسابِ فعلی دست نخورد', versionAt(downloaded) === '5.0.0');
  mode = 'ok';
  const ok2 = await updater.apply({ fetchImpl: net2, restart: false, retryDelays: [] });
  check('⛔ کلیکِ بعدی از همان یک‌سوم ادامه داد، نه از صفر', ok2.ok && seen2.at(-1) === `bytes=${cut}-`,
    `${JSON.stringify(seen2)} ${JSON.stringify(ok2).slice(0, 120)}`);

  // ۹ج) یک کار در هر لحظه — کلیکِ دوم کارِ اولی را پاک نمی‌کند
  const f3 = packOf('5.2.0');
  const b3 = fs.readFileSync(f3);
  let release3;
  const gate = new Promise((r) => { release3 = r; });
  const slow = async (url) => {
    if (String(url).includes('/releases/tags/')) return { ok: true, status: 200, json: async () => rel('5.2.0', f3) };
    return { ok: true, status: 200, headers: hdr({ 'content-length': String(b3.length) }),
      body: (async function* () { yield b3.subarray(0, 1000); await gate; yield b3.subarray(1000); })() };
  };
  const a = updater.start({ fetchImpl: slow, restart: false });
  const b = updater.start({ fetchImpl: slow, restart: false });
  check('⇒ کلیکِ نخست کار را شروع کرد', a.started === true);
  check('⛔ کلیکِ دوم کارِ دوم راه نینداخت', b.started === false);
  await new Promise((r) => setTimeout(r, 60));
  const mid = updater.progress();
  check('⇒ وسطِ کار، حال «دانلود» است و مگابایتِ آمده را دارد',
    mid.running && mid.phase === 'download' && mid.got >= 1000 && mid.total === b3.length, JSON.stringify(mid));
  release3();
  const end3 = await updater.settled();
  const fin = updater.progress();
  check('⇒ کار تمام شد و حال «تمام» شد', end3?.ok && fin.phase === 'done' && !fin.running, JSON.stringify(fin));
  check('⇒ و نسخه واقعاً عوض شد', versionAt(downloaded) === '5.2.0');

  check('⇒ روی لینوکس tar همان tar است', updater.tarCommand() === 'tar');
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'account', 'updater.js'), 'utf8');
  check('⛔ روی ویندوز tar.exe خودِ ویندوز (System32)، نه tarِ گیت', /System32', 'tar\.exe'/.test(src));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} سبز، ${fails.length} سرخ`);
if (fails.length) { for (const f of fails) console.log('  ✖', f); process.exit(1); }
