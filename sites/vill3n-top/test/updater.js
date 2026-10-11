'use strict';
// آزمونِ به‌روزرسانی از GitHub: یک «GitHub» محلی، نسخهٔ تازه، فایلِ دست‌کاری‌شده و مسیرِ خطرناک
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { checkAndApply, newer, safePath } = require('../src/core/updater');

let fail = 0;
const ok = (name, cond, extra = '') => { console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : `  →  ${extra}`}`); if (!cond) fail++; };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-upd-'));
  const remote = path.join(tmp, 'remote');
  const root = path.join(tmp, 'site');
  const dataDir = path.join(root, 'data');
  const put = (dir, p, c) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), c); };
  const manifest = (version, files) => JSON.stringify({ version, files: Object.entries(files).map(([p, c]) => ({ path: p, size: Buffer.byteLength(c), sha256: sha(Buffer.from(c)) })) });

  put(root, 'release.json', manifest('1.0.0', { 'src/a.js': 'old-a', 'keep.txt': 'same' }));
  put(root, 'src/a.js', 'old-a'); put(root, 'keep.txt', 'same'); put(root, 'data/db.json', '{"mine":1}');

  let served = [];
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0].slice(1));
    served.push(p);
    try { res.end(fs.readFileSync(path.join(remote, p))); } catch (_) { res.statusCode = 404; res.end(); }
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${srv.address().port}/`;

  console.log('\n■ نسخه‌ها و مسیرها');
  ok('2.1.0 از 2.0.9 تازه‌تر است', newer('2.1.0', '2.0.9'));
  ok('2.0.0 از 2.0.0 تازه‌تر نیست', !newer('2.0.0', '2.0.0'));
  ok('مسیرِ data رد می‌شود', !safePath('data/db.json'));
  ok('مسیرِ ‎..‎ رد می‌شود', !safePath('src/../../x'));
  ok('config.json رد می‌شود', !safePath('config.json'));
  ok('مسیرِ معمولی پذیرفته است', safePath('src/core/http.js'));

  console.log('\n■ همان نسخه ⇒ کاری نمی‌شود');
  put(remote, 'release.json', manifest('1.0.0', { 'src/a.js': 'new-a' }));
  let r = await checkAndApply({ root, dataDir, baseUrl });
  ok('up-to-date', r.status === 'up-to-date', JSON.stringify(r));
  ok('فایل دست نخورد', fs.readFileSync(path.join(root, 'src/a.js'), 'utf8') === 'old-a');

  console.log('\n■ فایلِ دست‌کاری‌شده ⇒ هیچ فایلی عوض نمی‌شود');
  put(remote, 'release.json', manifest('1.1.0', { 'src/a.js': 'new-a', 'src/b.js': 'new-b', 'keep.txt': 'same' }));
  put(remote, 'src/a.js', 'new-a'); put(remote, 'src/b.js', 'TAMPERED'); put(remote, 'keep.txt', 'same');
  let err = null;
  try { await checkAndApply({ root, dataDir, baseUrl }); } catch (e) { err = e; }
  ok('خطا داد', !!err);
  ok('a.js قدیمی ماند', fs.readFileSync(path.join(root, 'src/a.js'), 'utf8') === 'old-a');
  ok('b.js ساخته نشد', !fs.existsSync(path.join(root, 'src/b.js')));
  ok('نسخهٔ محلی همان ماند', JSON.parse(fs.readFileSync(path.join(root, 'release.json'), 'utf8')).version === '1.0.0');

  console.log('\n■ نسخهٔ تازه ⇒ فقط فایل‌های عوض‌شده');
  put(remote, 'src/b.js', 'new-b');
  served = [];
  r = await checkAndApply({ root, dataDir, baseUrl });
  ok('updated', r.status === 'updated' && r.version === '1.1.0', JSON.stringify(r));
  ok('a.js تازه شد', fs.readFileSync(path.join(root, 'src/a.js'), 'utf8') === 'new-a');
  ok('b.js آمد', fs.readFileSync(path.join(root, 'src/b.js'), 'utf8') === 'new-b');
  ok('فایلِ یکسان دوباره گرفته نشد', !served.includes('keep.txt'), served.join(','));
  ok('data دست نخورد', fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8') === '{"mine":1}');
  ok('پوشهٔ موقت پاک شد', !fs.existsSync(path.join(dataDir, 'update', '1.1.0')));

  console.log('\n■ فهرستی که به data دست می‌زند ⇒ رد');
  put(remote, 'release.json', manifest('1.2.0', { 'data/db.json': 'pwned' }));
  err = null;
  try { await checkAndApply({ root, dataDir, baseUrl }); } catch (e) { err = e; }
  ok('رد شد', !!err);
  ok('data سالم ماند', fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8') === '{"mine":1}');

  srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? `\n✗ ${fail} مورد ناموفق` : '\n✓ همه سبز');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
