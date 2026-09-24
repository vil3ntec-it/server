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

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} سبز، ${fails.length} سرخ`);
if (fails.length) { for (const f of fails) console.log('  ✖', f); process.exit(1); }
