'use strict';
// آزمون کامل سایت روی یک پوشهٔ دادهٔ موقت.  اجرا:  node test/smoke.js
// سرور واقعی بالا می‌آید و همهٔ مسیرها با درخواست واقعی HTTP سنجیده می‌شوند.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');
const { createSite, listen } = require('../src/app');
const fx = require('./fixtures');
const { zipBuffer } = require('../src/core/zip');
const { zipEntries } = require('../src/core/detect');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass++; if (process.env.VERBOSE) console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail !== undefined ? `  →  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); }
}
function section(t) { console.log(`\n■ ${t}`); }

let base = '', cookie = '', ipSeq = 10;
// درخواست خام (بدون fetch) تا سرآیندها و فشرده‌سازی را دقیق ببینیم
function req(method, url, { body, headers = {}, json, admin = false, ip, raw = false, host } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + url);
    const h = Object.assign({}, headers);
    let data = body;
    if (json !== undefined) { data = Buffer.from(JSON.stringify(json)); h['content-type'] = 'application/json'; }
    if (data !== undefined) h['content-length'] = Buffer.byteLength(data);
    if (admin) { h['x-v3'] = '1'; if (cookie) h.cookie = cookie; }
    if (ip) h['x-forwarded-for'] = ip;
    if (host) h.host = host;
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        const enc = res.headers['content-encoding'];
        if (!raw) { if (enc === 'br') buf = zlib.brotliDecompressSync(buf); else if (enc === 'gzip') buf = zlib.gunzipSync(buf); }
        let parsed = null;
        if (/json/.test(res.headers['content-type'] || '')) { try { parsed = JSON.parse(buf.toString('utf8')); } catch (_) { /* نه */ } }
        resolve({ status: res.statusCode, headers: res.headers, buf, text: buf.toString('utf8'), json: parsed });
      });
    });
    r.on('error', reject);
    if (data !== undefined) r.write(data);
    r.end();
  });
}
const A = (method, url, opts = {}) => req(method, `/api/admin${url}`, Object.assign({ admin: true }, opts));
const freshIp = () => `203.0.113.${ipSeq++}`;

async function upload(appId, name, buf, { chunkOverride } = {}) {
  const start = await A('POST', `/apps/${appId}/upload`, { json: { name, size: buf.length } });
  if (start.status !== 200) return start;
  const size = chunkOverride || start.json.chunk;
  let i = 0;
  for (let off = 0; off < buf.length; off += size, i++) {
    const r = await A('PUT', `/uploads/${start.json.uploadId}?i=${i}`, { body: buf.subarray(off, off + size), headers: { 'content-type': 'application/octet-stream' } });
    if (r.status !== 200) return r;
  }
  return A('POST', `/uploads/${start.json.uploadId}/finish`, { json: {} });
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vill3n-test-'));
  const make = () => createSite({ dataDir, publicDir: path.join(ROOT, 'public'), config: { port: 0, host: '127.0.0.1', seed: false } });
  let site = make();
  let server = await listen(site, { port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${server.address().port}`;
  const db = () => site.db.data;

  section('پایه و سرآیندهای امنیتی');
  let r = await req('GET', '/healthz');
  ok(r.status === 200 && r.json.ok === true, 'healthz');
  r = await req('GET', '/', { headers: { 'accept-encoding': 'br' }, raw: true });
  ok(r.status === 200 && r.headers['content-encoding'] === 'br', 'صفحهٔ اصلی با فشرده‌سازی brotli');
  r = await req('GET', '/');
  ok(r.text.includes('VILL3N') && r.text.includes('dir="rtl"'), 'صفحهٔ اصلی فارسی و راست‌به‌چپ');
  ok(/default-src 'self'/.test(r.headers['content-security-policy'] || ''), 'Content-Security-Policy');
  ok(r.headers['x-content-type-options'] === 'nosniff' && r.headers['x-frame-options'] === 'DENY', 'nosniff و ضد قاب');
  ok(r.text.includes('هنوز برنامه‌ای منتشر نشده'), 'حالت خالی وقتی برنامه‌ای نیست');
  const etag = r.headers.etag;
  r = await req('GET', '/', { headers: { 'if-none-match': etag } });
  ok(r.status === 304, 'پاسخ 304 با ETag');
  r = await req('GET', '/nope');
  ok(r.status === 404 && r.text.includes('پیدا نشد'), 'صفحهٔ 404 فارسی');
  r = await req('GET', '/robots.txt');
  ok(r.text.includes('Disallow: /admin'), 'robots.txt پنل را می‌بندد');
  r = await req('GET', '/assets/..%2f..%2fserver.js');
  ok(r.status === 404, 'خروج از پوشهٔ assets ممکن نیست');
  r = await req('GET', '/media/..%2Fdb.json');
  ok(r.status === 404, 'خروج از پوشهٔ media ممکن نیست');
  r = await req('GET', '/', { host: 'admin.vill3n.top' });
  ok(r.status === 200 && r.text.includes('پنل مالک') && /noindex/.test(r.headers['x-robots-tag'] || ''), 'admin.vill3n.top پنل را باز می‌کند (noindex)');
  r = await req('GET', '/admin/owner');
  ok(r.status === 200 && r.text.includes('پنل مالک'), '/admin/owner پنل را باز می‌کند');

  section('راه‌اندازی اولیه و ورود');
  r = await A('GET', '/state');
  ok(r.json.setup === true && r.json.authed === false, 'وضعیت: نیاز به راه‌اندازی');
  ok(path.isAbsolute(r.json.codeFile), 'روی خودِ سرور، نشانی کامل فایل کد گفته می‌شود');
  r = await A('GET', '/state', { ip: freshIp() });
  ok(r.json.codeFile === 'data/SETUP-CODE.txt', 'از بیرون، نشانی پوشه‌های سرور گفته نمی‌شود');
  const code = fs.readFileSync(path.join(dataDir, 'SETUP-CODE.txt'), 'utf8').match(/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/)[0];
  r = await A('POST', '/setup', { json: { username: 'owner', password: 'CorrectHorse-77', code: 'AAAA-BBBB-CCCC' }, ip: freshIp() });
  ok(r.status === 403, 'راه‌اندازی با کد غلط رد می‌شود');
  r = await A('POST', '/setup', { json: { username: 'owner', password: 'short', code }, ip: freshIp() });
  ok(r.status === 400, 'رمز کوتاه رد می‌شود');
  r = await req('POST', '/api/admin/setup', { json: { username: 'owner', password: 'CorrectHorse-77', code } });
  ok(r.status === 403, 'درخواست بدون سرآیند پنل رد می‌شود (ضد CSRF)');
  r = await A('POST', '/setup', { json: { username: 'owner', password: 'CorrectHorse-77', email: 'me@example.com', code }, headers: { 'x-forwarded-proto': 'https' }, ip: freshIp() });
  ok(r.status === 200, 'راه‌اندازی موفق', r.text);
  const sc = String(r.headers['set-cookie'] || '');
  ok(/HttpOnly/.test(sc) && /SameSite=Strict/.test(sc) && /Secure/.test(sc), 'کوکی HttpOnly + SameSite=Strict + Secure (پشت https)');
  cookie = sc.split(';')[0];
  ok(!fs.existsSync(path.join(dataDir, 'SETUP-CODE.txt')), 'کد راه‌اندازی پاک شد');
  r = await A('POST', '/setup', { json: { username: 'x2', password: 'CorrectHorse-78', code } });
  ok(r.status === 409, 'راه‌اندازی دوباره ممکن نیست');
  ok(!JSON.stringify(db().owner).includes('CorrectHorse'), 'رمز به‌صورت متن ذخیره نمی‌شود');
  r = await req('GET', '/api/admin/apps');
  ok(r.status === 401, 'API پنل بدون ورود → 401');
  r = await A('POST', '/apps', { json: { name: 'x' }, headers: { origin: 'https://evil.example' } });
  ok(r.status === 403, 'درخواست از نشانی دیگر رد می‌شود');
  r = await A('GET', '/state');
  ok(r.json.authed === true && r.json.username === 'owner', 'نشست فعال است');

  section('برنامه‌ها');
  r = await A('POST', '/apps', { json: { name: 'VILL3N Shop', slug: 'vill3n-shop', tagline: 'مدیریت دکان', status: 'published', color: '#2f6bff', category: 'دکان', features: [{ title: 'فاکتور', text: 'ساخت فاکتور' }] } });
  ok(r.status === 200 && r.json.app.slug === 'vill3n-shop', 'ساخت برنامه', r.text);
  const shop = r.json.app.id;
  r = await A('POST', '/apps', { json: { name: 'دیگر', slug: 'vill3n-shop' } });
  ok(r.status === 409, 'نشانی تکراری رد می‌شود');
  r = await A('POST', '/apps', { json: { name: 'x', slug: 'admin' } });
  ok(r.status === 400, 'نشانی رزرو رد می‌شود');
  r = await A('POST', '/apps', { json: { name: '<script>alert(1)</script>', slug: 'xss', tagline: '"><img src=x onerror=alert(1)>', status: 'published', color: 'red;background:url(x)' } });
  const xss = r.json.app.id;
  ok(r.json.app.color === '#3b6cff', 'رنگ نامعتبر پذیرفته نمی‌شود');
  r = await req('GET', '/app/xss');
  ok(r.status === 200 && !r.text.includes('<script>alert(1)') && !r.text.includes('<img src=x') && r.text.includes('&lt;script&gt;'), 'متن برنامه در صفحه بی‌خطر می‌شود (ضد XSS)');
  r = await A('POST', '/apps', { json: { name: 'پیش‌نویس', slug: 'draft-app', status: 'draft' } });
  const draft = r.json.app.id;
  r = await req('GET', '/app/draft-app');
  ok(r.status === 404, 'برنامهٔ پیش‌نویس دیده نمی‌شود');
  ok(fs.existsSync(path.join(dataDir, 'inbox', 'vill3n-shop')), 'پوشهٔ ورودی خودکار ساخته شد');

  section('بارگذاری و تشخیص خودکار نسخه');
  const apk1 = await fx.apk({ version: '2.4.1', code: 241 });
  r = await upload(shop, 'app-release.apk', apk1);
  ok(r.status === 200 && r.json.version.version === '2.4.1' && r.json.version.platform === 'android' && r.json.version.published === true, 'APK: نسخه 2.4.1 از داخل فایل خوانده و منتشر شد', r.text);
  ok(r.json.version.package === 'af.vill3n.shop' && r.json.version.minOs.includes('۷'), 'APK: نام بسته و حداقل اندروید');
  ok(r.json.version.sha256 === crypto.createHash('sha256').update(apk1).digest('hex'), 'SHA-256 درست حساب شد');
  const v1 = r.json.version.id;
  r = await upload(shop, 'copy.apk', apk1);
  ok(r.status === 409, 'همان فایل دوباره ثبت نمی‌شود');
  // فایل بزرگ چندتکه‌ای (۹ مگابایت → دو تکه)
  const bigApk = await zipBuffer([{ name: 'AndroidManifest.xml', data: fx.axml({ version: '2.10.0', code: 2100 }) }, { name: 'assets/big.bin', data: crypto.randomBytes(9 * 1024 * 1024), store: true }]);
  r = await upload(shop, 'shop-big.apk', bigApk);
  ok(r.status === 200 && r.json.version.version === '2.10.0' && r.json.version.size === bigApk.length, 'APK ۹ مگابایتی در دو تکه رسید و سالم است', r.text);
  const v2 = r.json.version.id;
  ok(crypto.createHash('sha256').update(fs.readFileSync(path.join(dataDir, 'files', db().apps[0].versions[0].file))).digest('hex') === crypto.createHash('sha256').update(bigApk).digest('hex'), 'فایل ذخیره‌شده بایت‌به‌بایت همان است');
  r = await upload(shop, 'VILL3N-Setup.exe', fx.exe({ fileVersion: [3, 1, 0, 0], productVersion: '3.1.0' }));
  ok(r.status === 200 && r.json.version.version === '3.1.0' && r.json.version.platform === 'windows', 'EXE: نسخه از مشخصات ویندوز خوانده شد', r.text);
  r = await upload(shop, 'pump.html', fx.html('1.7.2', 'meta'));
  ok(r.status === 200 && r.json.version.version === '1.7.2' && r.json.version.platform === 'web', 'HTML تک‌فایل: نسخه از متا تگ خوانده شد', r.text);
  const vHtml = r.json.version.id;
  r = await upload(shop, 'mystery.dmg', Buffer.from('no version anywhere in here'));
  ok(r.status === 200 && r.json.version.version === '' && r.json.version.published === false, 'وقتی نسخه پیدا نشود، منتشر نمی‌شود', r.text);
  const vUnknown = r.json.version.id;
  r = await A('PUT', `/apps/${shop}/versions/${vUnknown}`, { json: { published: true } });
  ok(r.status === 400, 'انتشار بدون شمارهٔ نسخه ممکن نیست');
  r = await A('PUT', `/apps/${shop}/versions/${vUnknown}`, { json: { version: '۱.۰.۰', published: true, notes: 'اولین نسخهٔ مک' } });
  ok(r.status === 200 && db().apps[0].versions.find((v) => v.id === vUnknown).version === '1.0.0', 'نسخهٔ دستی (با رقم فارسی) پذیرفته شد');
  r = await upload(xss, 'weird.html', Buffer.from('<meta name="app-version" content="9.1.0&quot;&gt;&lt;x">'.replace(/&quot;/g, '').replace('&gt;&lt;x', ' beta\r\nX: y')));
  ok(r.status === 200 && /^[\w.+-]*$/.test(r.json.version.version), 'شمارهٔ نسخهٔ خوانده‌شده از فایل پاک‌سازی می‌شود', r.json && r.json.version && r.json.version.version);
  r = await A('POST', `/apps/${shop}/upload`, { json: { name: 'evil.php', size: 10 } });
  ok(r.status === 400, 'پسوند ناشناس رد می‌شود');
  r = await A('POST', `/apps/${shop}/upload`, { json: { name: 'huge.apk', size: 9e12 } });
  ok(r.status === 413, 'فایل بزرگ‌تر از سقف رد می‌شود');
  r = await A('POST', `/apps/${shop}/upload`, { json: { name: 'x.apk', size: 100 } });
  const uid = r.json.uploadId;
  r = await A('PUT', `/uploads/${uid}?i=3`, { body: Buffer.alloc(10) });
  ok(r.status === 409, 'تکهٔ خارج از ترتیب رد می‌شود');
  r = await A('PUT', `/uploads/${uid}?i=0`, { body: Buffer.alloc(200) });
  ok(r.status === 413, 'تکهٔ بزرگ‌تر از اندازهٔ اعلام‌شده رد می‌شود');
  r = await A('POST', `/uploads/${uid}/finish`, { json: {} });
  ok(r.status === 400, 'پایان‌دادن به فایل ناقص ممکن نیست');
  await A('DELETE', `/uploads/${uid}`);
  ok(fs.readdirSync(path.join(dataDir, 'tmp')).length === 0, 'فایل موقت پاک شد');

  section('دانلود');
  r = await req('GET', '/app/vill3n-shop');
  ok(r.status === 200 && r.text.includes('v2.10.0') && r.text.includes('فاکتور'), 'صفحهٔ برنامه نسخهٔ تازه را نشان می‌دهد');
  ok(r.text.indexOf('v2.10.0') < r.text.indexOf('v2.4.1'), 'ترتیب نسخه‌ها درست است (2.10 بالاتر از 2.4)');
  r = await req('GET', '/download/vill3n-shop?p=android', { ip: freshIp(), headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14)' } });
  ok(r.status === 200 && r.buf.length === bigApk.length && /vill3n-shop-2\.10\.0\.apk/.test(r.headers['content-disposition']), 'دانلود آخرین نسخهٔ اندروید', r.headers);
  ok(r.headers['x-checksum-sha256'] === crypto.createHash('sha256').update(bigApk).digest('hex'), 'سرآیند SHA-256 دانلود');
  r = await req('GET', '/download/vill3n-shop', { ip: freshIp(), headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
  ok(/3\.1\.0\.exe/.test(r.headers['content-disposition'] || ''), 'انتخاب خودکار نسخهٔ ویندوز از روی دستگاه');
  r = await req('GET', `/download/vill3n-shop/${v1}`, { headers: { range: 'bytes=10-109' }, ip: freshIp() });
  ok(r.status === 206 && r.buf.length === 100 && r.buf.equals(apk1.subarray(10, 110)) && /bytes 10-109\//.test(r.headers['content-range']), 'ادامهٔ دانلود (Range)');
  r = await req('GET', `/download/vill3n-shop/${v1}`, { headers: { range: 'bytes=99999999-' } });
  ok(r.status === 416, 'Range نامعتبر → 416');
  r = await req('GET', `/download/vill3n-shop/${vHtml}`, { ip: freshIp() });
  ok(/attachment/.test(r.headers['content-disposition']) && r.headers['content-type'] === 'application/octet-stream', 'فایل HTML فقط دانلود می‌شود و در سایت اجرا نمی‌شود');
  const before = db().apps[0].versions.find((v) => v.id === v2).downloads;
  const sameIp = freshIp();
  await req('GET', `/download/vill3n-shop/${v2}`, { ip: sameIp, headers: { 'user-agent': 'Mozilla/5.0' } });
  await req('GET', `/download/vill3n-shop/${v2}`, { ip: sameIp, headers: { 'user-agent': 'Mozilla/5.0' } });
  await req('GET', `/download/vill3n-shop/${v2}`, { ip: sameIp, headers: { 'user-agent': 'Mozilla/5.0', range: 'bytes=500-' } });
  ok(db().apps[0].versions.find((v) => v.id === v2).downloads === before + 1, 'شمارش دانلود: تکرار و تکه‌های Range دوباره شمرده نمی‌شوند', db().apps[0].versions.find((v) => v.id === v2).downloads - before);
  r = await req('GET', '/download/draft-app');
  ok(r.status === 404, 'دانلود برنامهٔ پیش‌نویس ممکن نیست');
  r = await req('GET', '/api/apps/vill3n-shop/latest?platform=android&current=2.4.1');
  ok(r.json.update === true && r.json.latest.version === '2.10.0' && r.headers['access-control-allow-origin'] === '*', 'API به‌روزرسانی برای خودِ برنامه‌ها');
  r = await req('GET', '/api/apps/vill3n-shop/latest?platform=android&current=2.10.0');
  ok(r.json.update === false, 'API: وقتی نسخه تازه است، به‌روزرسانی نیست');
  r = await req('GET', '/api/apps');
  ok(r.json.apps.length === 2 && !r.json.apps.some((a) => a.slug === 'draft-app'), 'فهرست عمومی برنامه‌ها پیش‌نویس را نشان نمی‌دهد');
  await A('PUT', `/apps/${shop}/versions/${v2}`, { json: { published: false } });
  r = await req('GET', '/api/apps/vill3n-shop/latest?platform=android');
  ok(r.json.latest.version === '2.4.1', 'با برداشتن انتشار، نسخهٔ قبلی آخرین نسخه می‌شود');
  await A('PUT', `/apps/${shop}/versions/${v2}`, { json: { published: true } });

  section('پوشه‌های خودکار');
  const apk3 = await fx.apk({ version: '2.11.0', code: 2110 });
  fs.writeFileSync(path.join(dataDir, 'inbox', 'vill3n-shop', 'shop-new.apk'), apk3);
  r = await A('POST', '/scan', { json: {} });
  ok(r.json.added.length === 1 && r.json.added[0].version === '2.11.0', 'پوشهٔ ورودی: نسخهٔ 2.11.0 خودکار پیدا و ثبت شد', r.text);
  ok(!fs.existsSync(path.join(dataDir, 'inbox', 'vill3n-shop', 'shop-new.apk')), 'فایل از پوشهٔ ورودی برداشته شد');
  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-out-'));
  const full = (await A('GET', `/apps/${shop}`)).json.app;
  r = await A('PUT', `/apps/${shop}`, { json: Object.assign({}, full, { watchDir: path.join(buildDir, 'nope') }) });
  ok(r.status === 400, 'پوشهٔ ساختِ ناموجود رد می‌شود');
  r = await A('PUT', `/apps/${shop}`, { json: Object.assign({}, full, { watchDir: buildDir }) });
  ok(r.status === 200 && r.json.app.versions.length === full.versions.length, 'ذخیرهٔ برنامه نسخه‌ها را دست نمی‌زند');
  const apk4 = await fx.apk({ version: '2.12.0', code: 2120 });
  fs.writeFileSync(path.join(buildDir, 'app-release.apk'), apk4);
  fs.writeFileSync(path.join(buildDir, 'notes.txt'), 'ignore me');
  r = await A('POST', '/scan', { json: {} });
  ok(r.json.added.length === 1 && r.json.added[0].version === '2.12.0' && fs.existsSync(path.join(buildDir, 'app-release.apk')), 'پوشهٔ ساخت: نسخهٔ 2.12.0 کپی شد و اصل فایل سر جایش ماند', r.text);
  r = await A('POST', '/scan', { json: {} });
  ok(r.json.added.length === 0, 'بررسی دوباره، نسخهٔ تکراری نمی‌سازد');
  r = await req('GET', '/api/apps/vill3n-shop/latest?platform=android');
  ok(r.json.latest.version === '2.12.0', 'آخرین نسخهٔ عمومی حالا 2.12.0 است');

  section('تصویرها');
  r = await A('PUT', `/apps/${shop}/icon`, { body: fx.PNG, headers: { 'content-type': 'image/png' } });
  ok(r.status === 200 && /\.png$/.test(r.json.icon), 'آیکن PNG پذیرفته شد');
  const iconName = r.json.icon;
  r = await req('GET', `/media/${iconName}`);
  ok(r.status === 200 && r.headers['content-type'] === 'image/png' && /immutable/.test(r.headers['cache-control']), 'تصویر با کش بلندمدت داده می‌شود');
  r = await A('PUT', `/apps/${shop}/icon`, { body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'.padEnd(64, ' ')) });
  ok(r.status === 400, 'SVG (که می‌تواند کد اجرا کند) رد می‌شود');
  r = await A('POST', `/apps/${shop}/screenshots`, { body: Buffer.from('this is not an image at all, just text') });
  ok(r.status === 400, 'فایل غیرتصویری رد می‌شود');
  r = await A('POST', `/apps/${shop}/screenshots`, { body: fx.PNG });
  ok(r.status === 200, 'تصویر برنامه اضافه شد');

  section('تم هر برنامه، جست‌وجو و هوش مصنوعی');
  let doc = (await A('GET', `/apps/${shop}`)).json.app;
  ok(/^#[0-9a-f]{6}$/.test(doc.color2) && doc.scene === 'code', 'رنگ دوم و صحنهٔ پیش‌فرض برای برنامهٔ تازه');
  ok(doc.screenshots[0].w === 1 && doc.screenshots[0].h === 1, 'اندازهٔ تصویر از خودِ فایل خوانده و ذخیره شد');
  r = await A('PUT', `/apps/${shop}`, { json: Object.assign({}, doc, { scene: 'bars', color2: '#22d3ee', faq: [{ q: 'بدون اینترنت کار می‌کند؟', a: 'بله، همه‌چیز روی دستگاه است.' }, { q: '', a: 'x' }] }) });
  ok(r.status === 200 && r.json.app.scene === 'bars' && r.json.app.faq.length === 1, 'صحنه، رنگ دوم و پرسش‌ها ذخیره شدند (پرسش خالی حذف شد)');
  r = await A('PUT', `/apps/${shop}`, { json: Object.assign({}, r.json.app, { scene: '<script>', color2: 'javascript:1' }) });
  ok(r.json.app.scene === 'bars' && /^#[0-9a-f]{6}$/.test(r.json.app.color2), 'صحنه و رنگ نامعتبر پذیرفته نمی‌شود');
  r = await req('GET', '/app/vill3n-shop');
  const page = r.text;
  ok(/<canvas class="scene" data-scene="bars"/.test(page) && /--app:#2f6bff;--app2:#[0-9a-f]{6};--cta-app:#[0-9a-f]{6};--on-app:#/.test(page), 'صفحهٔ برنامه تم و صحنهٔ خودش را دارد');
  const lds = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const soft = lds.find((x) => x['@type'] === 'SoftwareApplication');
  ok(soft && soft.softwareVersion === '2.12.0' && soft.operatingSystem.includes('Android') && lds.some((x) => x['@type'] === 'BreadcrumbList') && lds.some((x) => x['@type'] === 'FAQPage'), 'دادهٔ ساختاریافته: برنامه، مسیر و پرسش‌ها', soft);
  ok(/<link rel="canonical" href="https:\/\/vill3n\.top\/app\/vill3n-shop">/.test(page) && /<meta name="description" content="[^"]{20,}/.test(page) && /property="og:image" content="https:\/\/vill3n\.top\/media\//.test(page), 'نشانی اصلی، توضیح و تصویر اشتراک‌گذاری');
  ok((page.match(/<h1[\s>]/g) || []).length === 1 && !/<img(?![^>]*\balt=)[^>]*>/.test(page) && /<html lang="fa" dir="rtl"/.test(page), 'یک تیتر اصلی، متن جایگزین برای همهٔ تصویرها، زبان صفحه');
  const ids = [...page.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  ok(new Set(ids).size === ids.length, 'شناسهٔ تکراری در صفحه نیست', ids);
  r = await req('GET', '/');
  ok(/class="editor-code"/.test(r.text) && (r.text.match(/class="stage-app /g) || []).length === 2 && (r.text.match(/class="chapter" /g) || []).length === 2 && /<span>apps\.<\/span><span class="c-fn">publish<\/span>/.test(r.text), 'صفحهٔ اصلی: کدِ خودتایپ و برنامه‌های بیرون‌آمده از آن');
  ok(JSON.parse(r.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'].some((x) => x['@type'] === 'Organization'), 'دادهٔ ساختاریافتهٔ برند در صفحهٔ اصلی');
  r = await req('GET', '/llms.txt');
  ok(r.status === 200 && /^# VILL3N/.test(r.text) && r.text.includes('/app/vill3n-shop.md') && r.text.includes('2.12.0') && !r.text.includes('draft-app'), 'llms.txt: خلاصهٔ سایت برای هوش مصنوعی');
  r = await req('GET', '/app/vill3n-shop.md');
  ok(r.status === 200 && /markdown/.test(r.headers['content-type']) && r.text.includes('# VILL3N Shop') && r.text.includes('SHA-256') && r.text.includes('بدون اینترنت کار می‌کند؟'), 'متن سادهٔ هر برنامه (Markdown)');
  r = await req('GET', '/app/draft-app.md');
  ok(r.status === 404, 'برنامهٔ پیش‌نویس متن ساده ندارد');
  r = await req('GET', '/llms-full.txt');
  ok(r.status === 200 && r.text.includes('## VILL3N Shop'), 'llms-full.txt: متن کامل همهٔ برنامه‌ها');
  r = await req('GET', '/robots.txt');
  ok(/User-agent: GPTBot/.test(r.text) && /User-agent: ClaudeBot/.test(r.text) && /User-agent: PerplexityBot/.test(r.text) && /Sitemap: https:\/\/vill3n\.top\/sitemap\.xml/.test(r.text) && !/User-agent: GPTBot[\s\S]*?\nDisallow: \/\n/.test(r.text), 'robots.txt به خزنده‌های هوش مصنوعی اجازه می‌دهد');
  r = await req('GET', '/api/openapi.json');
  ok(r.status === 200 && r.json.openapi === '3.1.0' && r.json.paths['/api/apps/{slug}/latest'], 'توضیح ماشینی API (OpenAPI)');
  r = await req('GET', '/sitemap.xml');
  ok(r.text.includes('<loc>https://vill3n.top/app/vill3n-shop</loc>') && r.text.includes('<lastmod>') && !r.text.includes('draft-app'), 'نقشهٔ سایت');
  r = await req('GET', `/${db().meta.indexNowKey}.txt`);
  ok(r.status === 200 && r.text === db().meta.indexNowKey, 'فایل کلید IndexNow');
  r = await req('GET', '/0123456789abcdef0123456789abcdef.txt');
  ok(r.status === 404, 'کلید ناشناس → 404');
  r = await A('POST', '/seo/indexnow', { json: {} });
  ok(r.status === 200 || r.status === 400 || r.status === 502, 'فرستادن دستی IndexNow بدون خطای سرور', r.status);
  r = await A('PUT', '/settings', { json: { allowAI: false, googleVerify: 'abc_DEF-123"><script>' } });
  ok(r.status === 200 && r.json.settings.googleVerify === 'abc_DEF-123script', 'کد تأیید جست‌وجو پاک‌سازی می‌شود');
  r = await req('GET', '/llms.txt');
  const rb = await req('GET', '/robots.txt');
  ok(r.status === 404 && /User-agent: GPTBot[\s\S]*\nDisallow: \/\n/.test(rb.text), 'با خاموش‌کردن، هوش مصنوعی‌ها بسته می‌شوند');
  r = await req('GET', '/');
  ok(r.text.includes('<meta name="google-site-verification" content="abc_DEF-123script">'), 'کد تأیید Google در صفحه می‌آید');
  await A('PUT', '/settings', { json: { allowAI: true, googleVerify: '' } });

  section('اشتراک، تخفیف و کد تخفیف');
  const past = new Date(Date.now() - 86400000).toISOString(), future = new Date(Date.now() + 86400000).toISOString();
  let appDoc = (await A('GET', `/apps/${shop}`)).json.app;
  appDoc.plans = [
    { name: 'ماهانه', period: 'month', price: 1000 },
    { name: 'سالانه', period: 'year', price: 10000, popular: true, discount: { type: 'percent', value: 20, to: future, label: 'جشن' } },
    { name: 'دایمی', period: 'lifetime', price: 30000, vip: true, discount: { type: 'amount', value: 5000, to: past } },
    { name: 'خاموش', period: 'month', price: 1, active: false },
  ];
  r = await A('PUT', `/apps/${shop}`, { json: appDoc });
  ok(r.status === 200 && r.json.app.plans.length === 4, 'اشتراک‌ها ذخیره شدند', r.text);
  const [pMonth, pYear, pLife, pOff] = r.json.app.plans.map((p) => p.id);
  r = await req('POST', '/api/quote', { json: { appId: shop, planId: pYear } });
  ok(r.json.base === 10000 && r.json.planOff === 2000 && r.json.total === 8000, 'تخفیف ۲۰٪ اشتراک: ۱۰٬۰۰۰ → ۸٬۰۰۰', r.json);
  r = await req('POST', '/api/quote', { json: { appId: shop, planId: pLife } });
  ok(r.json.total === 30000 && r.json.planOff === 0, 'تخفیفِ تمام‌شده حساب نمی‌شود');
  r = await req('POST', '/api/quote', { json: { appId: shop, planId: pOff } });
  ok(r.status === 404, 'اشتراک خاموش قابل سفارش نیست');
  r = await req('GET', '/app/vill3n-shop');
  ok(r.text.includes('۲۰٪ تخفیف') && r.text.includes('۸٬۰۰۰') && r.text.includes('<s>'), 'صفحهٔ برنامه قیمت قبل و بعد از تخفیف را نشان می‌دهد');
  r = await A('POST', '/coupons', { json: { code: 'eid10', type: 'percent', value: 10, maxUses: 1 } });
  ok(r.status === 200 && r.json.coupon.code === 'EID10', 'کد تخفیف ساخته شد');
  await A('POST', '/coupons', { json: { code: 'OLD', type: 'amount', value: 500, to: past } });
  await A('POST', '/coupons', { json: { code: 'OTHERAPP', type: 'amount', value: 500, appIds: [xss] } });
  await A('POST', '/coupons', { json: { code: 'BIG', type: 'amount', value: 999999 } });
  r = await A('POST', '/coupons', { json: { code: 'EID10', type: 'percent', value: 5 } });
  ok(r.status === 409, 'کد تکراری رد می‌شود');
  r = await A('POST', '/coupons', { json: { code: 'P150', type: 'percent', value: 150 } });
  ok(r.status === 200 && r.json.coupon.value === 100, 'درصد بیشتر از ۱۰۰ به ۱۰۰ محدود می‌شود');
  r = await req('POST', '/api/quote', { json: { appId: shop, planId: pYear, coupon: 'eid10' } });
  ok(r.json.total === 7200 && r.json.couponOff === 800, 'کد ۱۰٪ روی قیمتِ بعد از تخفیف: ۸٬۰۰۰ → ۷٬۲۰۰', r.json);
  r = await req('POST', '/api/quote', { json: { appId: shop, planId: pMonth, coupon: 'OLD' } });
  ok(/مهلت/.test(r.json.couponError) && r.json.total === 1000, 'کد منقضی اعمال نمی‌شود');
  r = await req('POST', '/api/quote', { json: { appId: shop, planId: pMonth, coupon: 'OTHERAPP' } });
  ok(/این برنامه/.test(r.json.couponError), 'کدِ برنامهٔ دیگر اعمال نمی‌شود');
  r = await req('POST', '/api/quote', { json: { appId: shop, planId: pMonth, coupon: 'BIG' } });
  ok(r.json.total === 0, 'قیمت هیچ‌وقت منفی نمی‌شود');
  r = await req('POST', '/api/quote', { json: { appId: shop, planId: pMonth, coupon: 'NOPE' } });
  ok(/معتبر نیست/.test(r.json.couponError), 'کد ناموجود');
  {
    const plans = (await A('GET', `/apps/${shop}`)).json.app.plans;
    const page = (await req('GET', '/app/vill3n-shop')).text;
    ok(plans[2].vip === true && plans[0].vip === false && plans[1].vip === false, 'نشان VIP فقط روی همان اشتراک ذخیره می‌شود');
    ok(/<li class="plan spot ring is-vip">\s*<p class="plan-flags"><span class="plan-flag is-vip">/.test(page) && page.includes('<bdi dir="ltr">VIP</bdi>') && /class="btn btn-vip" href="[^"]+"[^>]*data-order="/.test(page) && page.includes('دایمی (VIP) —') && (page.match(/class="plan spot[^"]*is-vip/g) || []).length === 1, 'اشتراک VIP در سایت کارت طلایی و نشان خودش را دارد');
    ok(/\*\*دایمی\*\* \[VIP\]/.test((await req('GET', '/app/vill3n-shop.md')).text), 'نسخهٔ متنی هم VIP را می‌گوید');

    // برنامه‌های نمونه: فقط دست‌نخورده‌ها یک‌جا پاک می‌شوند؛ با ذخیرهٔ مالک دیگر نمونه نیستند
    const mk = async (name, slug) => (await A('POST', '/apps', { json: { name, slug, status: 'draft' } })).json.app.id;
    const s1 = await mk('نمونهٔ یک', 'sample-one'), s2 = await mk('نمونهٔ دو', 'sample-two'), s3 = await mk('نمونهٔ سه', 'sample-three');
    for (const sid of [s1, s2, s3]) db().apps.find((a) => a.id === sid).sample = true;
    db().apps.find((a) => a.id === s2).plans = [require('../src/core/model').cleanPlan({ name: 'ماهانه', price: 10 })];
    let list = (await A('GET', '/apps')).json.apps;
    ok(list.filter((a) => a.sample).length === 3 && list.filter((a) => a.untouched).map((a) => a.slug).sort().join() === 'sample-one,sample-three' && !list.find((a) => a.id === shop).sample, 'فهرست پنل برنامه‌های نمونه و دست‌نخورده را نشان می‌دهد');
    r = await A('PUT', `/apps/${s3}`, { json: Object.assign({}, (await A('GET', `/apps/${s3}`)).json.app, { tagline: 'حالا مال خودم است' }) });
    ok(r.status === 200 && !db().apps.find((a) => a.id === s3).sample, 'برنامه‌ای که مالک ذخیره کند دیگر نمونه نیست');
    const before = db().apps.length;
    r = await A('POST', '/apps/clear-samples');
    list = db().apps.map((a) => a.slug);
    ok(r.status === 200 && r.json.removed === 1 && db().apps.length === before - 1 && !list.includes('sample-one') && list.includes('sample-two') && list.includes('sample-three') && list.includes('vill3n-shop') && db().apps.map((a) => a.order).join() === db().apps.map((_, i) => i).join(), 'فقط نمونهٔ دست‌نخورده پاک شد؛ بقیه و ترتیبشان سر جایشان است', r.text);
    ok((await A('POST', '/apps/clear-samples')).status === 409 && (await req('POST', '/api/admin/apps/clear-samples', { headers: { 'x-v3': '1' } })).status === 401, 'بار دوم چیزی برای پاک‌کردن نیست؛ بدون ورود هم ممکن نیست');
    ok((await A('DELETE', `/apps/${s2}`)).status === 200 && (await A('DELETE', `/apps/${s3}`)).status === 200 && db().apps.length === before - 3, 'برنامه‌های آزمایشی پاک شدند');
    const sd = require('../src/seed'); const fake = { data: { apps: [], settings: db().settings, home: { blocks: [] }, pages: [] }, touch() {}, saveNow() {} };
    try { sd.seed(fake); } catch (_) { /* دانه فقط برای نشان نمونه بررسی می‌شود */ }
    ok(fake.data.apps.length > 0 && fake.data.apps.every((a) => a.sample === true), 'برنامه‌های آمادهٔ اول کار نشان «نمونه» دارند');
    ok(require('../src/core/model').normalizeBackup({ apps: [{ id: 'a1', name: 'x', slug: 'x', sample: true }, { id: 'a2', name: 'y', slug: 'y', sample: 'yes' }] }).apps.map((a) => a.sample).join() === 'true,false', 'نشان نمونه در بازگردانی پشتیبان می‌ماند و فقط مقدار درست پذیرفته می‌شود');
  }

  section('سفارش');
  r = await req('POST', '/api/order', { body: 'appId=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  ok(r.status === 415, 'فقط JSON پذیرفته می‌شود (ضد فرم بین‌سایتی)');
  r = await req('POST', '/api/order', { json: { appId: shop, planId: pYear, name: 'ا', phone: '0792236008' }, ip: freshIp() });
  ok(r.status === 400, 'نام خیلی کوتاه رد می‌شود');
  r = await req('POST', '/api/order', { json: { appId: shop, planId: pYear, name: 'احمد', phone: 'abc' }, ip: freshIp() });
  ok(r.status === 400, 'شمارهٔ نادرست رد می‌شود');
  r = await req('POST', '/api/order', { json: { appId: shop, planId: pYear, name: 'احمد', phone: '0700000001', website: 'http://spam' }, ip: freshIp() });
  ok(r.status === 200 && r.json.no === 0 && db().orders.length === 0, 'تلهٔ ربات: سفارش ثبت نمی‌شود');
  // قیمتِ فرستاده‌شده از مرورگر نادیده گرفته می‌شود
  r = await req('POST', '/api/order', { json: { appId: shop, planId: pYear, name: 'احمد', phone: '۰۷۰۰۰۰۰۰۰۱', coupon: 'EID10', total: 1, price: 1 }, ip: freshIp() });
  ok(r.status === 200 && r.json.total === 7200 && db().orders[0].total === 7200, 'قیمت فقط روی سرور حساب می‌شود', r.json);
  const order1 = db().orders[0];
  ok(order1.phone === '0700000001', 'شماره با رقم فارسی به رقم لاتین تبدیل شد');
  r = await req('POST', '/api/order', { json: { appId: shop, planId: pYear, name: 'احمد', phone: '0700000001', coupon: 'EID10' }, ip: freshIp() });
  ok(r.json.duplicate === true && db().orders.length === 1, 'دوبار زدن دکمه، سفارش دوم نمی‌سازد');
  r = await req('POST', '/api/order', { json: { appId: shop, planId: pYear, name: 'محمود', phone: '0700000002', coupon: 'EID10' }, ip: freshIp() });
  ok(r.status === 400 && /ظرفیت/.test(r.json.error), 'ظرفیت کد تخفیف (۱ بار) رعایت می‌شود');
  // هم‌زمانی: ۲۰ درخواست یکسان
  const burst = await Promise.all(Array.from({ length: 20 }, () => req('POST', '/api/order', { json: { appId: shop, planId: pMonth, name: 'هم‌زمان', phone: '0700000003' }, ip: freshIp() })));
  ok(burst.every((x) => x.status === 200) && db().orders.filter((o) => o.phone === '0700000003').length === 1, '۲۰ درخواست هم‌زمان فقط یک سفارش می‌سازد');
  const spamIp = freshIp();
  let limited = false;
  for (let i = 0; i < 8; i++) { const x = await req('POST', '/api/order', { json: { appId: shop, planId: pMonth, name: 'مزاحم', phone: `07100000${10 + i}` }, ip: spamIp }); if (x.status === 429) limited = true; }
  ok(limited, 'سفارش پشت‌سرهم از یک نشانی محدود می‌شود');

  section('سخت‌گیری روی ورودی‌ها و محدودیت‌ها');
  r = await req('POST', '/api/order', { json: { appId: shop, planId: pMonth, name: { toString: 1 }, phone: ['0700000009'] }, ip: freshIp() });
  ok(r.status === 400, 'ورودی از نوع نادرست (شیء به‌جای متن) خطای 400 می‌دهد، نه خطای سرور', r.status);
  let deep = 'x'; for (let i = 0; i < 3000; i++) deep = [deep];
  r = await req('POST', '/api/quote', { json: { appId: shop, planId: pMonth, coupon: deep }, ip: freshIp() });
  ok(r.status === 200 && r.json.total === 1000, 'آرایهٔ تودرتوی عمیق سرور را نمی‌اندازد', r.status);
  r = await req('POST', '/api/admin/login', { json: { username: { a: 1 }, password: ['x'] }, admin: true, ip: freshIp() });
  ok(r.status === 401, 'ورود با ورودی خراب فقط رد می‌شود', r.status);
  r = await req('GET', '/download/vill3n-shop?p=__proto__', { ip: freshIp() });
  ok(r.status === 404, 'پلتفرم ساختگی (__proto__) → 404', r.status);
  r = await req('GET', '/api/apps/vill3n-shop/latest?platform=constructor');
  ok(r.status === 200 && r.json.latest === null, 'API: پلتفرم ناشناس نسخه‌ای برنمی‌گرداند');
  r = await req('GET', '/api/apps/vill3n-shop/latest?platform=ios');
  ok(r.json.latest === null && r.json.update === false, 'API: برای پلتفرمی که نسخه ندارد، نسخهٔ پلتفرم دیگر داده نمی‌شود');
  r = await req('GET', '/download/vill3n-shop?p=ios', { ip: freshIp() });
  ok(r.status === 404, 'دانلودِ پلتفرمی که نسخه ندارد → 404');
  r = await req('GET', '/api/apps/vill3n-shop/latest?platform=android&current=v2.12.0');
  ok(r.json.update === false, 'API: نسخهٔ فعلی با پیشوند v هم درست مقایسه می‌شود');
  for (const bad of ['//', '/\\', '//evil.example/x']) { r = await req('GET', bad); if (r.status !== 400 && r.status !== 404) break; }
  ok(r.status === 400 || r.status === 404, 'نشانی ناقص یا عجیب خطای سرور نمی‌سازد', r.status);
  const etagDl = (await req('GET', `/download/vill3n-shop/${v1}`, { ip: freshIp() })).headers.etag;
  r = await req('GET', `/download/vill3n-shop/${v1}`, { headers: { range: 'bytes=10-19', 'if-range': '"another-file"' }, ip: freshIp() });
  ok(r.status === 200 && r.buf.length === apk1.length, 'ادامهٔ دانلود با فایلِ عوض‌شده: کل فایل از نو داده می‌شود');
  r = await req('GET', `/download/vill3n-shop/${v1}`, { headers: { range: 'bytes=10-19', 'if-range': etagDl }, ip: freshIp() });
  ok(r.status === 206 && r.buf.length === 10, 'ادامهٔ دانلود با همان فایل: فقط همان تکه');
  // نشانیِ جعلی در سرآیند، محدودیت را دور نمی‌زند
  const fixed = freshIp();
  let blocked = 0;
  for (let i = 0; i < 10; i++) { const x = await req('POST', '/api/order', { json: { appId: shop, planId: pMonth, name: 'جعل نشانی', phone: `07200000${10 + i}` }, ip: fixed, headers: { 'cf-connecting-ip': `198.51.100.${i}`, 'x-real-ip': `198.51.100.${i + 50}` } }); if (x.status === 429) blocked++; }
  ok(blocked === 4, 'سرآیند جعلیِ CF-Connecting-IP محدودیت سفارش را دور نمی‌زند', blocked);
  // درخواست‌های خرابِ یک نفر جلوی مشتری‌های دیگر را نمی‌گیرد
  for (let i = 0; i < 45; i++) await req('POST', '/api/order', { json: {}, ip: `203.0.113.${200 + (i % 3)}` });
  r = await req('POST', '/api/order', { json: { appId: shop, planId: pMonth, name: 'مشتری واقعی', phone: '0700000077' }, ip: freshIp() });
  ok(r.status === 200 && r.json.no > 0, 'سفارش‌های خرابِ دیگران جلوی سفارش مشتری واقعی را نمی‌گیرد', r.status);
  // IPv6: یک شبکهٔ /64 یک نشانی حساب می‌شود
  let v6blocked = false;
  for (let i = 0; i < 45; i++) { const x = await req('POST', '/api/quote', { json: { appId: shop, planId: pMonth }, ip: `2001:db8:77:1::${(i + 1).toString(16)}` }); if (x.status === 429) v6blocked = true; }
  ok(v6blocked, 'نشانی‌های IPv6 از یک شبکه با هم شمرده می‌شوند');
  // قیمت با جداکننده و قیمتِ غیرعددی
  appDoc = (await A('GET', `/apps/${xss}`)).json.app;
  r = await A('PUT', `/apps/${xss}`, { json: Object.assign({}, appDoc, { plans: [{ name: 'الف', period: 'month', price: '1,500' }, { name: 'ب', period: 'custom', days: '۴۵', price: '۲٬۰۰۰', discount: { type: 'percent', value: '10%' } }] }) });
  ok(r.status === 200 && r.json.app.plans[0].price === 1500 && r.json.app.plans[1].price === 2000 && r.json.app.plans[1].days === 45 && r.json.app.plans[1].discount.value === 10, 'قیمت با جداکننده و رقم فارسی درست خوانده می‌شود', r.json.app && r.json.app.plans);
  r = await A('PUT', `/apps/${xss}`, { json: Object.assign({}, appDoc, { plans: [{ name: 'خراب', period: 'month', price: 'هزار' }] }) });
  ok(r.status === 400 && /قیمت باید عدد باشد/.test(r.json.error), 'قیمتِ غیرعددی رد می‌شود (بی‌صدا «رایگان» نمی‌شود)', r.text);
  // برنامهٔ «به‌زودی» حتی با فایل، پیوند دانلود ندارد
  r = await A('POST', '/apps', { json: { name: 'به‌زودی', slug: 'soon-app', status: 'soon' } });
  const soonId = r.json.app.id;
  await upload(soonId, 'soon.apk', await fx.apk({ version: '0.9.0', code: 9, pkg: 'af.vill3n.soon' }));
  r = await req('GET', '/app/soon-app');
  const soonApi = (await req('GET', '/api/apps')).json.apps.find((x) => x.slug === 'soon-app');
  ok(r.status === 200 && !r.text.includes('/download/soon-app') && r.text.includes('به‌زودی برای دانلود آماده می‌شود') && Object.keys(soonApi.latest).length === 0, 'برنامهٔ «به‌زودی» پیوند دانلودِ خراب ندارد');
  ok((await req('GET', '/download/soon-app', { ip: freshIp() })).status === 404, 'دانلود برنامهٔ «به‌زودی» بسته است');
  await A('DELETE', `/apps/${soonId}`);

  section('پرداخت و اشتراک');
  r = await A('PUT', `/orders/${order1.id}`, { json: { status: 'paid' } });
  ok(r.status === 200 && r.json.license && /^V3-[A-Z2-9]{4}-/.test(r.json.license.code), 'پرداخت → کد فعال‌سازی ساخته شد', r.text);
  const lic = r.json.license;
  ok(Math.abs((new Date(lic.endAt) - new Date(lic.startAt)) / 86400000 - 365) < 0.01, 'اشتراک سالانه ۳۶۵ روز است');
  r = await A('PUT', `/orders/${order1.id}`, { json: { status: 'paid' } });
  ok(db().licenses.filter((l) => l.orderId === order1.id).length === 1, 'پرداختِ دوباره اشتراک دوم نمی‌سازد');
  r = await req('GET', `/api/license/${lic.code}`);
  ok(r.json.found && r.json.valid === true && r.json.app === 'VILL3N Shop' && r.json.daysLeft === 365, 'بررسی عمومی کد: فعال', r.json);
  ok(!JSON.stringify(r.json).includes('احمد') && !JSON.stringify(r.json).includes('0700000001'), 'بررسی عمومی، نام و شمارهٔ مشتری را نشان نمی‌دهد');
  r = await req('GET', `/api/license/${lic.code.toLowerCase()}`);
  ok(r.json.valid === true, 'کد با حروف کوچک هم پذیرفته می‌شود');
  r = await req('GET', '/api/license/V3-AAAA-BBBB-CCCC-DDDD');
  ok(r.json.found === false, 'کد ناموجود');
  r = await A('PUT', `/orders/${order1.id}`, { json: { status: 'cancelled' } });
  r = await req('GET', `/api/license/${lic.code}`);
  ok(r.json.state === 'revoked' && r.json.valid === false, 'لغو سفارش → اشتراک باطل می‌شود');
  r = await A('PUT', `/orders/${order1.id}`, { json: { status: 'paid' } });
  ok(r.status === 409, 'سفارش لغوشده مستقیم پرداخت‌شده نمی‌شود');
  await A('PUT', `/orders/${order1.id}`, { json: { status: 'new' } });
  r = await A('PUT', `/orders/${order1.id}`, { json: { status: 'paid' } });
  ok(r.json.license.code === lic.code && r.json.license.state === 'active' && db().licenses.length === 1, 'برگرداندن و پرداخت دوباره همان اشتراک را فعال می‌کند');
  ok(db().coupons.find((c) => c.code === 'EID10').used === 1, 'شمار استفادهٔ کد تخفیف درست مانده است');
  r = await A('POST', '/licenses', { json: { appId: shop, customer: 'مشتری دستی', days: 30, planName: 'آزمایشی' } });
  ok(r.status === 200, 'ساخت دستی اشتراک');
  const manual = r.json.license;
  r = await A('PUT', `/licenses/${manual.id}`, { json: { action: 'extend', days: 10 } });
  ok(Math.abs((new Date(r.json.license.endAt) - new Date(manual.endAt)) / 86400000 - 10) < 0.01, 'تمدید ۱۰ روزه از تاریخ پایان');
  // اشتراکِ تمام‌شده
  site.db.data.licenses.find((l) => l.id === manual.id).endAt = past;
  r = await req('GET', `/api/license/${manual.code}`);
  ok(r.json.state === 'expired' && r.json.valid === false && r.json.daysLeft === 0, 'اشتراک تمام‌شده معتبر نیست (ساعت سرور ملاک است)');
  r = await A('PUT', `/licenses/${manual.id}`, { json: { action: 'extend', days: 5 } });
  ok(new Date(r.json.license.endAt) > new Date() && r.json.license.state === 'active', 'تمدیدِ اشتراک تمام‌شده از امروز حساب می‌شود');
  r = await A('DELETE', `/apps/${shop}`);
  ok(r.status === 409 && r.json.needsForce, 'حذف برنامه‌ای که اشتراک فعال دارد تأیید دوباره می‌خواهد');
  r = await A('GET', '/overview');
  ok(r.status === 200 && r.json.totals.paidOrders === 1 && r.json.totals.revenue === 7200 && r.json.days.length === 30, 'داشبورد: درآمد و آمار ۳۰ روز', r.json && r.json.totals);

  section('ورود با کد ۶ رقمی ایمیل (سرویس خودِ مالک)');
  let lastMail = null;
  const mock = http.createServer((q, s) => { let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => { lastMail = { auth: q.headers.authorization, body: JSON.parse(b) }; s.end('{"ok":true}'); }); });
  await new Promise((res) => mock.listen(0, '127.0.0.1', res));
  const mockUrl = `http://127.0.0.1:${mock.address().port}/send`;
  r = await A('PUT', '/security/email-code', { json: { url: mockUrl, headers: 'Authorization: Bearer test-key', body: '{"email":"{{email}}","otp":"{{code}}"}' } });
  ok(r.status === 200, 'تنظیم سرویس ایمیل');
  r = await A('POST', '/security/email-code/test', { json: {} });
  ok(r.status === 200 && lastMail && /^\d{6}$/.test(lastMail.body.otp) && lastMail.body.email === 'me@example.com' && lastMail.auth === 'Bearer test-key', 'کد آزمایشی به سرویس ایمیل رسید', lastMail);
  let ticket = r.json.ticket;
  r = await A('POST', '/security/email-code/enable', { json: { ticket, code: '000000' === lastMail.body.otp ? '111111' : '000000' } });
  ok(r.status === 403 && !db().owner.emailCode.enabled, 'کد غلط، قابلیت را روشن نمی‌کند (و مالک را از پنل بیرون نمی‌اندازد)');
  r = await A('POST', '/security/email-code/enable', { json: { ticket, code: lastMail.body.otp } });
  ok(r.status === 200 && db().owner.emailCode.enabled, 'با کد درست روشن شد');
  r = await A('PUT', '/security/email-code', { json: { url: 'http://127.0.0.1:1/x', body: '{"c":"{{code}}"}' } });
  ok(r.status === 403 && db().owner.emailCode.enabled && db().owner.emailCode.url === mockUrl, 'وقتی کد ایمیل روشن است، تغییر تنظیمش بدون رمز فعلی ممکن نیست');
  ok(!('pending' in db()) && !JSON.stringify(db().owner).includes(`"${lastMail.body.otp}"`), 'کد ایمیل در پایگاه‌داده ذخیره نمی‌شود');
  const adminCookie = cookie;
  cookie = '';
  const loginIp = freshIp();
  r = await A('POST', '/login', { json: { username: 'owner', password: 'CorrectHorse-77' }, ip: loginIp });
  ok(r.status === 200 && r.json.step === 'code' && !r.headers['set-cookie'], 'رمز درست → هنوز وارد نشده، کد لازم است');
  ticket = r.json.ticket;
  const realCode = lastMail.body.otp;
  r = await A('POST', '/login/code', { json: { ticket, code: realCode === '123456' ? '654321' : '123456' }, ip: loginIp });
  ok(r.status === 401 && !r.headers['set-cookie'], 'کد غلط رد می‌شود');
  r = await A('POST', '/login/code', { json: { ticket, code: realCode }, ip: loginIp });
  ok(r.status === 200 && r.headers['set-cookie'], 'کد درست → ورود');
  const cookie2 = String(r.headers['set-cookie']).split(';')[0];
  r = await A('POST', '/login/code', { json: { ticket, code: realCode }, ip: loginIp });
  ok(r.status === 401, 'کد یک‌بارمصرف است');
  cookie = cookie2;
  r = await A('POST', '/security/email-code/disable', { json: { current: 'CorrectHorse-77' } });
  ok(r.status === 200, 'خاموش‌کردن با رمز فعلی');
  mock.close();

  section('قفل ضد حدس‌زدن و نشست‌ها');
  cookie = '';
  const badIp = freshIp();
  let locked = 0;
  for (let i = 0; i < 9; i++) { const x = await A('POST', '/login', { json: { username: 'owner', password: `wrong-password-${i}` }, ip: badIp }); if (x.status === 429) locked++; }
  ok(locked >= 2, 'بعد از ۶ رمز غلط، آن نشانی قفل می‌شود');
  r = await A('POST', '/login', { json: { username: 'owner', password: 'CorrectHorse-77' }, ip: badIp });
  ok(r.status === 429, 'در زمان قفل، حتی رمز درست هم پذیرفته نمی‌شود');
  r = await A('POST', '/login', { json: { username: 'nobody', password: 'CorrectHorse-77' }, ip: freshIp() });
  ok(r.status === 401 && r.json.error === 'نام کاربری یا رمز درست نیست', 'پیام خطا نمی‌گوید کدام‌یک غلط بود');
  r = await A('POST', '/login', { json: { username: 'owner', password: 'CorrectHorse-77' }, ip: freshIp() });
  ok(r.status === 200 && r.json.step === 'done', 'ورود از نشانی دیگر سالم است');
  // حمله از نشانی‌های گوناگون نباید مالک را پشت در نگه دارد
  for (let i = 0; i < 24; i++) await A('POST', '/login', { json: { username: 'owner', password: `guess-${i}` }, ip: `198.51.100.${i + 1}` });
  const t0 = Date.now();
  r = await A('POST', '/login', { json: { username: 'owner', password: 'CorrectHorse-77' }, ip: freshIp() });
  ok(r.status === 200 && r.json.step === 'done', 'حملهٔ حدس رمز از ده‌ها نشانی، مالک را قفل نمی‌کند', r.status);
  ok(Date.now() - t0 > 900, 'هنگام حمله، هر تلاش ورود با مکث بررسی می‌شود', Date.now() - t0);
  cookie = String(r.headers['set-cookie']).split(';')[0];
  r = await A('POST', '/security/password', { json: { current: 'wrong', next: 'NewStrongPass-2026' } });
  ok(r.status === 403, 'تغییر رمز با رمز فعلیِ غلط رد می‌شود');
  r = await A('POST', '/security/password', { json: { current: 'CorrectHorse-77', next: 'NewStrongPass-2026' } });
  ok(r.status === 200, 'تغییر رمز');
  const keep = cookie;
  cookie = adminCookie;
  r = await A('GET', '/apps');
  ok(r.status === 401, 'با تغییر رمز، نشست‌های دیگر بسته می‌شوند');
  cookie = keep;
  r = await A('GET', '/security');
  ok(r.status === 200 && r.json.sessions.length === 1 && r.json.sessions[0].current && r.json.audit.length > 5, 'فهرست نشست‌ها و گزارش رویدادها');
  ok(!JSON.stringify(r.json).includes(db().owner.pass.hash), 'هش رمز از API بیرون نمی‌رود');

  section('پشتیبان، بازگردانی و ماندگاری');
  r = await A('GET', '/backup');
  const backup = JSON.parse(r.text);
  ok(backup.owner === null && backup.sessions.length === 0 && backup.apps.length === 3, 'پشتیبان بدون رمز و نشست');
  r = await A('GET', '/backup.zip');
  const zipFile = path.join(dataDir, 'tmp', 'check.zip');
  fs.writeFileSync(zipFile, r.buf);
  const fd = fs.openSync(zipFile, 'r');
  const entries = zipEntries(fd, r.buf.length);
  fs.closeSync(fd); fs.unlinkSync(zipFile);
  ok(entries && entries.some((e) => e.name === 'db.json') && entries.filter((e) => e.name.startsWith('files/')).length === db().apps.reduce((n, x) => n + x.versions.length, 0), 'پشتیبان کامل ZIP همهٔ فایل‌ها را دارد', entries && entries.length);
  r = await A('POST', '/restore', { json: { data: backup } });
  ok(r.status === 400, 'بازگردانی بدون تأیید انجام نمی‌شود');
  await A('DELETE', `/apps/${draft}`);
  // پشتیبانِ خراب یا دست‌کاری‌شده سایت را نمی‌شکند
  const before3 = JSON.stringify(db().apps.map((x) => x.id));
  r = await A('POST', '/restore', { json: { data: { meta: {}, settings: [], apps: [null] }, confirm: 'RESTORE' } });
  ok(r.status === 400 && JSON.stringify(db().apps.map((x) => x.id)) === before3, 'پشتیبانِ خراب رد می‌شود و دادهٔ فعلی دست نمی‌خورد', r.status);
  const evil = JSON.parse(JSON.stringify(backup));
  evil.apps.push(null, 7, { id: 'zz1', name: 'بد', slug: '../../x', color: 'red;}', scene: '__proto__', status: 'published', versions: [{ id: 'v', file: '../../../db.json', version: '"><b>', platform: 'toString', published: true }, 'x'], plans: [{ price: 'abc' }, { name: 'خوب', price: 10 }], screenshots: [{ file: '../x.png' }], icon: '../../x.png', features: 'nope' });
  evil.orders.push(null, { id: 'o9', no: 'x', total: {}, status: 'weird' });
  evil.settings.siteUrl = 'javascript:alert(1)';
  r = await A('POST', '/restore', { json: { data: evil, confirm: 'RESTORE' } });
  const bad = db().apps.find((x) => x.id === 'zz1');
  ok(r.status === 200 && bad && bad.slug === 'x' && bad.color === '#3b6cff' && bad.scene === 'code' && bad.icon === '' && bad.screenshots.length === 0 && bad.plans.length === 1 && bad.versions.length === 1 && bad.versions[0].file === 'db.json' && bad.versions[0].version === 'b' && bad.versions[0].platform === 'other' && db().settings.siteUrl === 'https://vill3n.top', 'پشتیبانِ دست‌کاری‌شده پاک‌سازی می‌شود', bad);
  ok((await req('GET', '/')).status === 200 && (await req('GET', '/app/x')).status === 200 && (await A('GET', '/overview')).status === 200 && (await A('GET', '/orders')).status === 200, 'بعد از آن، سایت و پنل سالم کار می‌کنند');
  ok((await req('GET', '/download/x', { ip: freshIp() })).status === 404, 'نسخه‌ای که فایل واقعی ندارد دانلود نمی‌شود (و به فایل‌های سرور راه ندارد)');
  r = await A('POST', '/restore', { json: { data: backup, confirm: 'RESTORE' } });
  ok(r.status === 200 && db().apps.length === 3 && db().owner && db().owner.username === 'owner', 'بازگردانی: محتوا برگشت و مالک دست نخورد', r.text);
  r = await A('GET', '/apps');
  ok(r.status === 200, 'بعد از بازگردانی نشست فعلی معتبر می‌ماند');
  r = await A('POST', '/export', { json: {} });
  const exp = path.join(dataDir, 'export', 'site');
  ok(r.status === 200 && fs.existsSync(path.join(exp, 'index.html')) && fs.existsSync(path.join(exp, 'app', 'vill3n-shop', 'index.html')) && fs.existsSync(path.join(exp, '.htaccess')), 'خروجی ایستا ساخته شد', r.text);
  const expHtml = fs.readFileSync(path.join(exp, 'app', 'vill3n-shop', 'index.html'), 'utf8');
  ok(/href="\/files\/vill3n-shop-2\.12\.0-android\.apk"/.test(expHtml) && !expHtml.includes('/download/') && !expHtml.includes('<dialog') && expHtml.includes('wa.me/'), 'خروجی ایستا: پیوند مستقیم فایل و سفارش از واتساپ');
  ok(fs.existsSync(path.join(exp, 'files', 'vill3n-shop-2.12.0-android.apk')) && !fs.existsSync(path.join(exp, 'assets', 'admin.js')), 'خروجی ایستا: فایل برنامه هست و فایل‌های پنل نیست');

  const ordersBefore = db().orders.length, licBefore = db().licenses.length;
  site.stop(); await new Promise((res) => server.close(res));
  site = make(); server = await listen(site, { port: 0, host: '127.0.0.1' }); base = `http://127.0.0.1:${server.address().port}`;
  ok(site.db.data.orders.length === ordersBefore && site.db.data.licenses.length === licBefore && site.db.data.apps.length === 3, 'بعد از خاموش و روشن‌شدن، همهٔ داده سر جایش است');
  r = await A('GET', '/apps');
  ok(r.status === 200, 'نشست بعد از راه‌اندازی دوباره معتبر می‌ماند');
  // فایل گم‌شده
  const anyV = site.db.data.apps.find((a) => a.slug === 'vill3n-shop').versions.find((v) => v.version === '3.1.0');
  fs.unlinkSync(path.join(dataDir, 'files', anyV.file));
  site.files.verify();
  r = await req('GET', '/api/apps/vill3n-shop/latest?platform=windows');
  ok(r.json.latest === null || r.json.latest.platform !== 'windows', 'نسخه‌ای که فایلش نیست، دیگر عرضه نمی‌شود');
  // خرابی پایگاه‌داده → بازیابی از نسخهٔ قبلی
  site.stop(); await new Promise((res) => server.close(res));
  fs.writeFileSync(path.join(dataDir, 'db.json'), '{"meta": broken json');
  site = make();
  ok(site.db.data.apps.length === 3 && site.db.data.owner, 'اگر db.json خراب شود، از db.json.bak بازیابی می‌شود');
  site.stop();

  /* ═══════════════════════════════════════════════════════════════════════════════
     بخش‌های صفحه (بلوک‌ها)، صفحهٔ اصلی و صفحه‌های دلخواه — روی یک پوشهٔ دادهٔ جدا و سرور تازه
     ═══════════════════════════════════════════════════════════════════════════════ */
  {
    const model = require('../src/core/model');
    const ai = require('../src/ai');
    const { PICK, ICONS } = require('../src/icons');
    const T = (type, extra) => Object.assign({ type }, extra);
    const long = (n) => 'ا'.repeat(n);

    section('بخش‌های صفحه: پاک‌سازی ورودی (مدل)');
    ok(Object.keys(model.BLOCK_TYPES).join() === 'text,cards,table,stats,steps,image,video,quote,reviews,cta,faq' && model.BLOCK_TYPES.table === 'جدول' && model.BLOCK_TYPES.cta === 'دعوت به اقدام' && model.BLOCK_TYPES.video === 'ویدیو' && model.BLOCK_TYPES.reviews === 'نظر مشتری‌ها', 'یازده نوع بخش با نام فارسی');
    let bl = model.cleanBlocks([null, 5, 'x', [], { type: 'nope', title: 'a' }, JSON.parse('{"type":"__proto__","title":"a"}'), { type: 'constructor', title: 'a' }, { type: 'toString' }, { type: ['text'], title: 'a' }, T('text', { title: 'ok' })], [], 30);
    ok(bl.length === 1 && bl[0].type === 'text' && bl[0].title === 'ok' && typeof bl[0].id === 'string' && bl[0].id.length >= 3, 'نوع ناشناس و ورودیِ غیرشیء کنار گذاشته می‌شود', bl);
    ok(model.cleanBlocks('x', [], 30).length === 0 && model.cleanBlocks({ length: 3 }, [], 30).length === 0 && model.cleanBlocks(undefined).length === 0, 'ورودیِ غیرآرایه → فهرست خالی');
    bl = model.cleanBlocks([T('text', { title: long(300), intro: long(900), body: long(7000) + '\u0000\u0007', align: 'left' }), T('text', { body: 'x', align: 'center' }), T('text', { intro: 'فقط مقدمه' }), T('text', { title: { a: 1 }, body: ['x'] })], [], 30);
    ok(bl.length === 2 && bl[0].title.length === 120 && bl[0].intro.length === 400 && bl[0].body.length === 6000 && bl[0].align === 'start' && bl[1].align === 'center', 'متن: سقف طول‌ها، چینش مجاز و حذف متنِ خالی', bl.map((x) => [x.title.length, x.body.length, x.align]));
    const proto = JSON.parse('{"icon":"__proto__","title":"پ"}');
    bl = model.cleanBlocks([T('cards', { layout: 'weird', items: [{ icon: 'bolt', title: 'سریع', text: long(400) }, { icon: 'nope', title: 'ب' }, proto, { icon: 'bolt', title: '' }, null, 'x'].concat(Array.from({ length: 30 }, (_, i) => ({ title: `ک${i}` }))) }), T('cards', { layout: 'grid', items: [{ title: 'x' }] }), T('cards', { title: 'بدون کادر', items: [{ text: 'x' }] }), T('cards', { items: 'nope' })], [], 30);
    ok(bl.length === 2 && bl[0].layout === 'bento' && bl[1].layout === 'grid' && bl[0].items.length === 12 && bl[0].items[0].icon === 'bolt' && bl[0].items[0].text.length === 300 && bl[0].items[1].icon === '' && bl[0].items[2].icon === '' && bl[0].items.every((x) => x.title), 'کادرها: سقف ۱۲، نشانهٔ ناشناس خالی، کادرِ بی‌عنوان حذف', bl[0] && bl[0].items.slice(0, 4));
    bl = model.cleanBlocks([T('table', { head: ['الف', 'ب', 'ج'], rows: [['۱'], ['۱', '۲', '۳', '۴', '۵'], 'x', null, { 0: 'a' }, [], ['', '', ''], [long(300), 5, { a: 1 }]], firstCol: 'true', note: long(500) }), T('table', { head: Array.from({ length: 12 }, (_, i) => long(100) + i), rows: Array.from({ length: 70 }, (_, i) => [`r${i}`]) }), T('table', { rows: [['x']] }), T('table', { head: [], rows: [['x']] }), T('table', { head: ['', ''], rows: [['', '']] }), T('table', { head: 'nope' })], [], 30);
    ok(bl.length === 2 && bl[0].rows.length === 3 && bl[0].rows.every((r) => r.length === 3) && bl[0].rows[0].join('|') === '۱||' && bl[0].rows[1].join('|') === '۱|۲|۳' && bl[0].rows[2][0].length === 160 && bl[0].rows[2][1] === '5' && bl[0].rows[2][2] === '' && bl[0].firstCol === true && bl[0].note.length === 300, 'جدول: هر ردیف هم‌اندازهٔ سرستون‌ها، ردیف خراب یا خالی حذف', bl[0]);
    ok(bl[1].head.length === 8 && bl[1].head[0].length === 60 && bl[1].rows.length === 40 && bl[1].rows.every((r) => r.length === 8) && bl[1].firstCol === false, 'جدول: سقف ۸ ستون و ۴۰ ردیف؛ جدولِ بی‌سرستون حذف', [bl[1].head.length, bl[1].rows.length]);
    bl = model.cleanBlocks([T('stats', { items: Array.from({ length: 9 }, (_, i) => ({ value: long(30) + i, label: `ب${i}` })).concat([{ value: '۱' }, { label: 'x' }]) }), T('stats', { items: [{ value: '۱' }] }), T('steps', { items: Array.from({ length: 12 }, (_, i) => ({ title: `گام ${i}`, text: long(400) })).concat([{ text: 'x' }]) }), T('steps', { items: [] }), T('faq', { items: Array.from({ length: 25 }, (_, i) => ({ q: `پ${i}`, a: long(2000) })).concat([{ q: 'x' }]) }), T('faq', { items: [{ a: 'x' }] }), T('quote', { text: long(900), by: long(100), role: long(100) }), T('quote', { by: 'x' })], [], 30);
    ok(bl.map((x) => x.type).join() === 'stats,steps,faq,quote' && bl[0].items.length === 6 && bl[0].items[0].value.length === 16 && bl[1].items.length === 8 && bl[1].items[0].text.length === 300 && bl[2].items.length === 20 && bl[2].items[0].a.length === 1500 && bl[3].text.length === 600 && bl[3].by.length === 80 && bl[3].role.length === 80, 'آمار، مرحله‌ها، پرسش‌ها و نقل‌قول: سقف‌ها و حذف موردهای ناقص', bl.map((x) => [x.type, (x.items || []).length]));
    const good = ['/app/vill3n-shop', '#plans', 'https://vill3n.top/x?a=1', 'http://example.com', 'tel:+93792236008', 'mailto:vill3ntec@gmail.com', 'HTTPS://EXAMPLE.COM'];
    const evilHref = ['javascript:alert(1)', ' javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', '\u0001javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'ftp://example.com', 'www.example.com', 'file:///etc/passwd', { href: '/x' }, ['/x'], 7];
    bl = model.cleanBlocks(good.concat(evilHref).map((href) => T('cta', { title: 'ت', label: 'دکمه', href })), [], 40);
    ok(bl.length === good.length + evilHref.length && bl.slice(0, good.length).every((x, i) => x.href === good[i]) && bl.slice(good.length).every((x) => x.href === ''), 'دعوت به اقدام: فقط پیوندهای مجاز می‌مانند (javascript: و مانند آن خالی می‌شود)', bl.map((x) => x.href));
    ok(model.cleanBlocks([T('cta', { label: 'x', href: 'javascript:1' }), T('cta', { label: 'x' }), T('cta', { href: '/x' }), T('cta', { label: 'x', href: '/x' })], [], 30).length === 1, 'دعوت به اقدامِ بی‌متن و بی‌پیوند حذف می‌شود');
    bl = model.cleanBlocks([T('text', { title: '۱' }), T('text', { id: 'same-id', title: '۲' }), T('text', { id: 'same-id', title: '۳' }), T('text', { id: 'a b', title: '۴' }), T('text', { id: '<img src=x>', title: '۵' }), T('text', { id: { x: 1 }, title: '۶' }), T('text', { id: 'keep_Me-1', title: '۷' })], [], 30);
    ok(bl.length === 7 && new Set(bl.map((x) => x.id)).size === 7 && bl.every((x) => /^[A-Za-z0-9_-]{3,24}$/.test(x.id)) && bl[1].id === 'same-id' && bl[6].id === 'keep_Me-1', 'شناسهٔ نبوده، تکراری یا نادرست از نو ساخته می‌شود', bl.map((x) => x.id));
    const oldBlocks = [{ id: 'img1', type: 'image', title: '', intro: '', image: { file: 'real-file.png', w: 10, h: 20 }, alt: '', text: '', side: 'start' }, { id: 'txt1', type: 'text', title: 'x', image: { file: 'sneaky.png' } }];
    bl = model.cleanBlocks([T('image', { id: 'new1', image: { file: 'injected.png', w: 1, h: 1 }, alt: 'x' }), T('image', { id: 'img1', image: { file: 'other.png' }, side: 'full' }), T('image', { id: 'txt1', image: { file: 'sneaky.png' }, alt: 'x' }), T('image', { id: 'copy1', imageFrom: 'img1' }), T('image', { id: 'copy2', imageFrom: 'txt1', alt: 'x' }), T('image', { id: 'empty1', image: { file: 'injected.png' } }), T('text', { id: 'img1b', title: 't', image: { file: 'x.png' } })], oldBlocks, 30);
    ok(bl.length === 6 && bl[0].image === null && bl[1].image.file === 'real-file.png' && bl[1].image.w === 10 && bl[1].side === 'full' && bl[2].image === null && bl[3].image.file === 'real-file.png' && bl[4].image === null && !('image' in bl[5]) && !bl.some((x) => x.id === 'empty1') && !JSON.stringify(bl).includes('injected') && !JSON.stringify(bl).includes('sneaky'), 'تصویرِ بخش از مرورگر پذیرفته نمی‌شود؛ فقط از بخشِ ذخیره‌شده با همان شناسه می‌آید', bl.map((x) => [x.id, x.image]));
    bl = model.cleanBlocks([T('image', { image: { file: 'ok-1.png', w: '30', h: 9e9 } }), T('image', { image: { file: '../../db.json' }, alt: 'x' }), T('image', { image: { file: 'x.svg' }, alt: 'x' }), T('image', { image: 'a.png', alt: 'x' })], [], 30, { trustImages: true });
    ok(bl.length === 4 && bl[0].image.file === 'ok-1.png' && bl[0].image.w === 30 && bl[0].image.h === 20000 && bl.slice(1).every((x) => x.image === null), 'بازگردانی: نام فایل تصویرِ بخش با الگوی نام تصویر سنجیده می‌شود', bl.map((x) => x.image));
    ok(model.cleanBlocks(Array.from({ length: 80 }, (_, i) => T('text', { title: `ت${i}` })), [], 30).length === 30 && model.cleanBlocks(Array.from({ length: 80 }, (_, i) => T('text', { title: `ت${i}` })), [], 40).length === 40, 'سقف تعداد بخش‌ها رعایت می‌شود');
    const junk = Array.from({ length: 200000 }, () => ({ type: 'x' })), wide = [T('table', { head: ['a'], rows: Array.from({ length: 50000 }, () => Array.from({ length: 30 }, () => 'x')) }), T('cards', { items: Array.from({ length: 100000 }, () => ({ title: '' })) })];
    const t0b = Date.now();
    ok(model.cleanBlocks(junk, [], 30).length === 0 && model.cleanBlocks(wide, [], 30)[0].rows.length === 40 && Date.now() - t0b < 500, 'آرایهٔ خیلی بزرگ سرور را معطل نمی‌کند (فقط تا سقف خوانده می‌شود)', Date.now() - t0b);
    let threw = (fn) => { try { fn(); return 0; } catch (e) { return e.status || 500; } };
    ok(threw(() => model.cleanPage({}, null, [])) === 400 && threw(() => model.cleanPage({ title: { a: 1 } }, null, [])) === 400 && threw(() => model.cleanPage(null, null, [])) === 400, 'صفحهٔ بی‌عنوان رد می‌شود (خطای 400، نه خطای سرور)');
    ok(model.PAGE_RESERVED.every((sl) => threw(() => model.cleanPage({ title: 'x', slug: sl }, null, [])) === 400), 'نشانی‌های رزرو برای صفحه رد می‌شوند');
    let pg = model.cleanPage({ title: 'About Us', description: long(500), nav: 'true', status: 'weird', blocks: [T('text', { title: 'x' }), { type: 'bad' }] }, null, []);
    ok(pg.slug === 'about-us' && pg.description.length === 300 && pg.nav === true && pg.status === 'draft' && pg.blocks.length === 1 && pg.createdAt && pg.updatedAt && typeof pg.id === 'string', 'صفحه: نشانی از عنوان، وضعیت پیش‌فرض پیش‌نویس', pg);
    ok(threw(() => model.cleanPage({ title: 'دیگر', slug: 'About Us' }, null, [pg])) === 409 && threw(() => model.cleanPage({ title: 'خودش', slug: 'about-us' }, pg, [pg])) === 0 && /^page-[a-z0-9]+$/.test(model.cleanPage({ title: 'دربارهٔ ما' }, null, []).slug), 'صفحه: نشانی تکراری رد می‌شود؛ عنوان فارسی نشانی خودکار می‌گیرد');
    let ap = model.cleanApp({ name: 'x', badges: ['بدون اینترنت', 'بدون اینترنت', long(60), '', null, { a: 1 }, 'ب', 'ج', 'د', 'ه', 'و', 'ز'], features: [{ icon: 'shield', title: 'امن' }, { icon: 'javascript:', title: 'ب' }, JSON.parse('{"icon":"constructor","title":"ج"}')], blocks: [T('text', { title: 'x' })] }, null, []);
    ok(ap.badges.length === 6 && ap.badges[0] === 'بدون اینترنت' && ap.badges[1].length === 28 && ap.features.map((f) => f.icon).join('|') === 'shield||' && ap.blocks.length === 1, 'برنامه: برچسب‌ها (۶ تا، بدون تکرار) و نشانهٔ ویژگی‌ها', [ap.badges, ap.features]);
    const ap2 = model.cleanApp({ name: 'x', blocks: 'nope', badges: 7 }, ap, [ap]);
    ok(ap2.blocks.length === 1 && ap2.blocks[0].id === ap.blocks[0].id && ap2.badges.length === 6 && model.cleanApp({ name: 'y', slug: 'y' }, null, []).blocks.length === 0, 'برنامه: اگر بخش‌ها در فرم نباشند، همان قبلی‌ها می‌مانند');

    section('بخش‌های صفحه: API پنل');
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'vill3n-blocks-'));
    const make2 = () => createSite({ dataDir: dir2, publicDir: path.join(ROOT, 'public'), config: { port: 0, host: '127.0.0.1', seed: false } });
    let site2 = make2();
    let server2 = await listen(site2, { port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${server2.address().port}`; cookie = '';
    const d2 = () => site2.db.data;
    const imgFile = (name) => path.join(dir2, 'images', name);
    // پاک‌شدن فایل تصویر ناهم‌زمان است؛ کمی صبر می‌کنیم
    const gone = async (name) => { for (let i = 0; i < 80 && fs.existsSync(imgFile(name)); i++) await new Promise((res) => setTimeout(res, 25)); return !fs.existsSync(imgFile(name)); };
    await A('GET', '/state');
    const code2 = fs.readFileSync(path.join(dir2, 'SETUP-CODE.txt'), 'utf8').match(/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/)[0];
    r = await A('POST', '/setup', { json: { username: 'owner', password: 'CorrectHorse-77', code: code2 } });
    const myCookie = String(r.headers['set-cookie'] || '').split(';')[0];
    // بدون ورود و بدون سرآیند پنل
    const guarded = [['GET', '/home'], ['PUT', '/home'], ['GET', '/pages'], ['POST', '/pages'], ['PUT', '/pages/x'], ['DELETE', '/pages/x'], ['POST', '/pages/order'], ['PUT', '/home/blocks/x/image'], ['DELETE', '/home/blocks/x/image'], ['PUT', '/apps/x/blocks/y/image'], ['PUT', '/pages/x/blocks/y/image']];
    let codes = [];
    for (const [m, u] of guarded) codes.push((await A(m, u, m === 'GET' || m === 'DELETE' ? {} : { json: { blocks: [], title: 'x' } })).status);
    ok(r.status === 200 && codes.every((c) => c === 401), 'مسیرهای تازهٔ پنل بدون ورود → 401', codes);
    cookie = myCookie;
    r = await req('PUT', '/api/admin/home', { json: { blocks: [] }, headers: { cookie } });
    const rr = await A('PUT', '/home', { json: { blocks: [] }, headers: { origin: 'https://evil.example' } });
    ok(r.status === 403 && rr.status === 403, 'بدون سرآیند پنل یا از نشانی دیگر → 403 (ضد CSRF)', [r.status, rr.status]);

    r = await A('GET', '/apps');
    ok(r.status === 200 && r.json.blockTypes.table === 'جدول' && Object.keys(r.json.icons).join() === Object.keys(PICK).join() && r.json.icons.bolt.label === PICK.bolt && r.json.icons.bolt.svg === ICONS.bolt && Object.values(r.json.icons).every((x) => x.svg && x.label) && r.json.blockLimits.app === 30, 'پنل نوع بخش‌ها و نشانه‌های قابل‌انتخاب را از سرور می‌گیرد');

    // صفحهٔ اصلی
    r = await A('GET', '/home');
    ok(r.status === 200 && Array.isArray(r.json.blocks) && r.json.blocks.length === 0, 'صفحهٔ اصلی: در آغاز بدون بخش');
    r = await A('PUT', '/home', { json: { blocks: [T('stats', { title: 'در یک نگاه', items: [{ value: '۵', label: 'برنامه' }] }), T('image', { id: 'homeimg', alt: 'نمای دفتر', image: { file: 'injected.png' } }), T('quote', {}), { type: 'zzz' }] } });
    ok(r.status === 200 && r.json.blocks.length === 2 && r.json.blocks[1].image === null && d2().home.blocks.length === 2, 'صفحهٔ اصلی: ذخیرهٔ بخش‌ها (خالی و ناشناس حذف، تصویرِ تزریقی نادیده)', r.text);
    r = await A('GET', '/home');
    ok(r.json.blocks.length === 2 && r.json.blocks[0].items[0].label === 'برنامه' && r.json.blocks[1].id === 'homeimg', 'صفحهٔ اصلی: خواندن دوباره همان را می‌دهد');
    const revBefore = site2.db.rev;
    await A('PUT', '/home', { json: { blocks: r.json.blocks } });
    ok(site2.db.rev > revBefore && d2().audit.some((x) => x.action === 'home-update'), 'تغییر بخش‌ها کش صفحه‌ها را باطل و رویداد ثبت می‌کند');

    // صفحه‌ها
    r = await A('POST', '/pages', { json: { title: 'دربارهٔ ما', slug: 'About', description: 'معرفی', status: 'published', nav: true, blocks: [T('text', { title: 'ما که هستیم', body: 'متن معرفی' }), T('table', { title: 'خدمت‌ها', head: ['خدمت', 'قیمت'], rows: [['وب‌سایت', '۲۰٬۰۰۰'], ['اپ', '✓']] })] } });
    ok(r.status === 200 && r.json.page.slug === 'about' && r.json.page.status === 'published' && r.json.page.nav === true && r.json.page.blocks.length === 2, 'ساخت صفحه', r.text);
    const pageId = r.json.page.id;
    r = await A('POST', '/pages', { json: { title: 'دیگر', slug: 'about' } });
    ok(r.status === 409 && /about/.test(r.json.error), 'نشانی تکراری صفحه رد می‌شود');
    codes = [];
    for (const sl of ['admin', 'api', 'p', 'app', 'media']) codes.push((await A('POST', '/pages', { json: { title: 'x', slug: sl } })).status);
    r = await A('POST', '/pages', { json: { slug: 'no-title' } });
    ok(codes.every((c) => c === 400) && r.status === 400 && /عنوان/.test(r.json.error), 'نشانی رزرو و صفحهٔ بی‌عنوان → 400 با پیام فارسی', codes);
    r = await A('POST', '/pages', { json: { title: 'پیش‌نویس', slug: 'draft-page', blocks: [T('text', { title: 'محرمانه‌ی پیش‌نویس' })] } });
    const draftPage = r.json.page.id;
    ok(r.status === 200 && r.json.page.status === 'draft' && r.json.page.nav === false, 'صفحهٔ تازه پیش‌نویس است');
    r = await A('PUT', `/pages/${pageId}`, { json: { title: 'دربارهٔ VILL3N', slug: 'draft-page' } });
    ok(r.status === 409, 'ویرایش صفحه هم نشانی تکراری را رد می‌کند');
    r = await A('PUT', `/pages/${pageId}`, { json: { title: 'دربارهٔ VILL3N' } });
    ok(r.status === 200 && r.json.page.title === 'دربارهٔ VILL3N' && r.json.page.slug === 'about' && r.json.page.blocks.length === 2 && r.json.page.status === 'published' && r.json.page.nav === true, 'ویرایش صفحه: آنچه فرستاده نشده (بخش‌ها، وضعیت، منو) دست نمی‌خورد', r.text);
    r = await A('GET', '/pages');
    ok(r.json.pages.length === 2 && r.json.pages[0].id === pageId, 'فهرست صفحه‌ها');
    await A('POST', '/pages/order', { json: { ids: [draftPage, pageId, 'ghost', 7] } });
    ok(d2().pages.map((x) => x.id).join() === [draftPage, pageId].join() && (await A('GET', `/pages/${pageId}`)).json.page.slug === 'about' && (await A('GET', '/pages/nope')).status === 404 && (await A('PUT', '/pages/nope', { json: { title: 'x' } })).status === 404, 'ترتیب صفحه‌ها و صفحهٔ ناموجود (404)');

    // برنامه با بخش، برچسب و نشانهٔ ویژگی
    r = await A('POST', '/apps', { json: { name: 'VILL3N Shop', slug: 'shop', status: 'published', badges: ['بدون اینترنت', 'فارسی'], features: [{ icon: 'receipt', title: 'فاکتور', text: 'ساخت فاکتور' }, { icon: 'bad', title: 'انبار' }], blocks: [T('cards', { title: 'مزیت‌ها', items: [{ icon: 'bolt', title: 'سریع', text: 'در یک ثانیه' }] })] } });
    ok(r.status === 200 && r.json.app.badges.length === 2 && r.json.app.features[0].icon === 'receipt' && r.json.app.features[1].icon === '' && r.json.app.blocks.length === 1 && r.json.app.blocks[0].items[0].icon === 'bolt', 'ساخت برنامه با بخش، برچسب و نشانهٔ ویژگی', r.text);
    const app2 = r.json.app.id;
    let adoc = r.json.app;
    adoc.blocks.push(T('image', { id: 'appimg', title: 'نمای برنامه', text: 'همه‌چیز در یک صفحه', side: 'end' }), T('table', { title: 'مقایسه', head: ['', 'رایگان', 'کامل'], rows: [['فاکتور', '✓', '✓'], ['گزارش', '✗', '✓']], firstCol: true, note: 'قیمت‌ها به افغانی' }), T('steps', { items: [{ title: 'نصب' }, { title: 'شروع' }] }), T('faq', { items: [{ q: 'رایگان است؟', a: 'نسخهٔ پایه بله.' }] }), T('cta', { title: 'شروع کنید', label: 'اشتراک‌ها', href: '#plans' }));
    r = await A('PUT', `/apps/${app2}`, { json: Object.assign({}, adoc, { badges: ['اندروید'] }) });
    ok(r.status === 200 && r.json.app.blocks.map((x) => x.type).join() === 'cards,image,table,steps,faq,cta' && r.json.app.badges.join() === 'اندروید' && r.json.app.blocks[1].id === 'appimg' && r.json.app.blocks[2].rows[1].join() === 'گزارش,✗,✓', 'ویرایش برنامه با بخش‌ها و برچسب‌ها', r.text);
    adoc = r.json.app;
    r = await A('PUT', `/apps/${app2}`, { json: { name: adoc.name, slug: adoc.slug, status: 'published' } });
    ok(r.status === 200 && r.json.app.blocks.length === 6 && r.json.app.badges.join() === 'اندروید', 'ذخیرهٔ برنامه بدون فیلد بخش‌ها، بخش‌ها و برچسب‌ها را نگه می‌دارد');
    r = await A('PUT', `/apps/${app2}`, { json: adoc });
    adoc = r.json.app;

    section('بخش‌های صفحه: تصویر بخش');
    r = await A('PUT', `/apps/${app2}/blocks/nope/image`, { body: fx.PNG });
    const r2 = await A('PUT', `/apps/${app2}/blocks/${adoc.blocks[0].id}/image`, { body: fx.PNG });
    const r3 = await A('PUT', `/apps/nope/blocks/appimg/image`, { body: fx.PNG });
    ok(r.status === 404 && /ذخیره/.test(r.json.error) && r2.status === 400 && /تصویر/.test(r2.json.error) && r3.status === 404, 'تصویر فقط روی بخشِ «تصویر و متن»ِ ذخیره‌شده می‌نشیند', [r.status, r2.status, r3.status]);
    r = await A('PUT', `/apps/${app2}/blocks/appimg/image`, { body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'.padEnd(64, ' ')) });
    ok(r.status === 400 && fs.readdirSync(path.join(dir2, 'images')).length === 0, 'فایل غیرتصویری (SVG) برای بخش رد می‌شود');
    r = await A('PUT', `/apps/${app2}/blocks/appimg/image`, { body: fx.PNG, headers: { 'content-type': 'image/png' } });
    ok(r.status === 200 && /^[\w-]+\.png$/.test(r.json.image.file) && r.json.image.w === 1 && r.json.image.h === 1 && fs.existsSync(imgFile(r.json.image.file)) && d2().apps[0].blocks[1].image.file === r.json.image.file, 'بارگذاری تصویر بخش', r.text);
    const img1 = r.json.image.file;
    ok((await req('GET', `/media/${img1}`)).status === 200, 'تصویر بخش از /media داده می‌شود');
    // ذخیرهٔ دوبارهٔ فرم (با تصویرِ جعلی در بدنه) تصویر واقعی را نگه می‌دارد
    adoc = (await A('GET', `/apps/${app2}`)).json.app;
    adoc.blocks[1].image = { file: 'injected.png', w: 9, h: 9 };
    r = await A('PUT', `/apps/${app2}`, { json: adoc });
    ok(r.json.app.blocks[1].image.file === img1 && fs.existsSync(imgFile(img1)), 'ذخیرهٔ فرم، تصویرِ بخش را نگه می‌دارد و نام فایلِ فرستاده‌شده را نمی‌پذیرد');
    r = await A('PUT', `/apps/${app2}/blocks/appimg/image`, { body: fx.PNG });
    const img2 = r.json.image.file;
    ok(r.status === 200 && img2 !== img1 && await gone(img1) && fs.existsSync(imgFile(img2)), 'عوض‌کردن تصویر، فایل قبلی را پاک می‌کند');
    // کپیِ بخش همان فایل را نشان می‌دهد؛ حذف یکی فایل را نمی‌برد
    adoc = (await A('GET', `/apps/${app2}`)).json.app;
    adoc.blocks.push(T('image', { id: 'appimg2', imageFrom: 'appimg', alt: 'کپی' }));
    r = await A('PUT', `/apps/${app2}`, { json: adoc });
    ok(r.json.app.blocks[6].image.file === img2 && !('imageFrom' in r.json.app.blocks[6]), 'کپیِ بخشِ تصویری همان تصویر را می‌گیرد (از دادهٔ سرور)');
    adoc = r.json.app;
    adoc.blocks = adoc.blocks.filter((x) => x.id !== 'appimg');
    r = await A('PUT', `/apps/${app2}`, { json: adoc });
    await new Promise((res) => setTimeout(res, 120));
    ok(r.json.app.blocks.length === 6 && fs.existsSync(imgFile(img2)), 'تصویری که هنوز در بخش دیگری هست پاک نمی‌شود');
    r = await A('DELETE', `/apps/${app2}/blocks/appimg2/image`);
    ok(r.status === 200 && await gone(img2) && d2().apps[0].blocks.find((x) => x.id === 'appimg2').image === null, 'برداشتن تصویر بخش، فایل را هم پاک می‌کند');
    // حذف خودِ بخش
    r = await A('PUT', `/apps/${app2}/blocks/appimg2/image`, { body: fx.PNG });
    const img3 = r.json.image.file;
    adoc = (await A('GET', `/apps/${app2}`)).json.app;
    adoc.blocks = adoc.blocks.filter((x) => x.id !== 'appimg2');
    r = await A('PUT', `/apps/${app2}`, { json: adoc });
    ok(r.status === 200 && await gone(img3), 'با حذف بخش، تصویرش هم پاک می‌شود');
    // صفحهٔ اصلی و صفحه
    r = await A('PUT', '/home/blocks/homeimg/image', { body: fx.PNG });
    let imgHome = r.json.image && r.json.image.file;
    ok(r.status === 200 && d2().home.blocks[1].image.file === imgHome && (await A('PUT', '/home/blocks/nope/image', { body: fx.PNG })).status === 404, 'تصویر بخشِ صفحهٔ اصلی');
    r = await A('PUT', `/pages/${pageId}`, { json: { title: 'دربارهٔ VILL3N', blocks: d2().pages.find((x) => x.id === pageId).blocks.concat([T('image', { id: 'pgimg', alt: 'دفتر ما', text: 'دفتر کابل' })]) } });
    r = await A('PUT', `/pages/${pageId}/blocks/pgimg/image`, { body: fx.PNG });
    const imgPage = r.json.image && r.json.image.file;
    ok(r.status === 200 && fs.existsSync(imgFile(imgPage)), 'تصویر بخشِ یک صفحه');
    r = await A('POST', '/pages', { json: { title: 'موقت', slug: 'temp', blocks: [T('image', { id: 'tmpimg', alt: 'x' })] } });
    const tempPage = r.json.page.id;
    r = await A('PUT', `/pages/${tempPage}/blocks/tmpimg/image`, { body: fx.PNG });
    const imgTemp = r.json.image.file;
    r = await A('DELETE', `/pages/${tempPage}`);
    ok(r.status === 200 && await gone(imgTemp) && d2().pages.length === 2 && fs.existsSync(imgFile(imgPage)), 'حذف صفحه، تصویرهای بخش‌هایش را پاک می‌کند');
    r = await A('POST', '/apps', { json: { name: 'موقت', slug: 'temp-app', blocks: [T('image', { id: 'tmpa', alt: 'x' })] } });
    const tempApp = r.json.app.id;
    r = await A('PUT', `/apps/${tempApp}/blocks/tmpa/image`, { body: fx.PNG });
    const imgTempApp = r.json.image.file;
    r = await A('DELETE', `/apps/${tempApp}`);
    ok(r.status === 200 && await gone(imgTempApp), 'حذف برنامه، تصویرهای بخش‌هایش را پاک می‌کند');

    section('بخش‌های صفحه: ویدیو و نظر مشتری‌ها');
    {
      const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(200, 7)]);
      const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(120, 3)]);
      const evil = '<img src=x onerror=alert(1)>"\'';
      let vb = model.cleanBlocks([T('video', { id: 'vid001', title: 't', caption: long(400), video: { file: 'evil.mp4', size: 5, mime: 'text/html' }, poster: { file: 'evil.png', w: 1, h: 1 } }), T('video', {}), T('reviews', { items: [{ text: '', by: 'x' }, { text: long(900), by: long(90), role: long(120) }, 'x', null].concat(Array.from({ length: 20 }, () => ({ text: 'خوب بود' }))) }), T('reviews', { title: 'فقط عنوان' })], [], 30);
      ok(vb.length === 2 && vb[0].video === null && vb[0].poster === null && vb[0].caption.length === 200 && vb[1].items.length === 12 && vb[1].items[0].text.length === 600 && vb[1].items[0].by.length === 60 && vb[1].items[0].role.length === 80, 'ویدیو و تصویر پیش‌نمایش از مرورگر پذیرفته نمی‌شود؛ نظرها پاک‌سازی و سقف‌دار می‌شوند', vb);
      vb = model.cleanBlocks([T('video', { id: 'vid001', video: { file: '../../x.mp4' }, poster: { file: 'a.svg' } }), T('video', { id: 'vid002', video: { file: 'ok-1.webm', size: 9, mime: 'x' }, poster: { file: 'p.png', w: 3, h: 2 } })], [], 30, { trustImages: true });
      ok(vb.length === 1 && vb[0].video.file === 'ok-1.webm' && vb[0].video.mime === 'video/webm' && vb[0].poster.file === 'p.png', 'در بازگردانی پشتیبان فقط نام فایلِ درست می‌ماند و نوع از روی پسوند نوشته می‌شود', vb);
      const htmlOf = require('../src/blocks').renderBlocks;
      const out = htmlOf([{ id: 'a', type: 'video', title: evil, intro: evil, caption: evil, video: { file: 'v.mp4' }, poster: { file: 'p.png', w: 1280, h: 720 } }, { id: 'b', type: 'video', title: 'بدون فایل', caption: 'x' }, { id: 'c', type: 'reviews', title: evil, items: [{ text: evil, by: evil, role: evil }, { text: 'بدون نام' }, { by: 'بدون متن' }] }, { id: 'd', type: 'reviews', items: [] }]);
      ok(!/<img src=x/.test(out) && !/onerror=alert\(1\)>"/.test(out) && out.includes('<video controls preload="none" playsinline poster="/media/p.png" width="1280" height="720"') && out.includes('<source src="/media/v.mp4" type="video/mp4">') && !out.includes('id="b-b"') && !out.includes('id="b-d"') && (out.match(/class="review spot ring"/g) || []).length === 2 && (out.match(/<footer>/g) || []).length === 1 && out.includes('<ul class="reviews" data-n="2">'), 'نمایش ویدیو و نظرها: متن بی‌خطر، بخشِ بی‌ویدیو و بی‌نظر دیده نمی‌شود', out);

      r = await A('POST', '/pages', { json: { title: 'ویدیوها', slug: 'videos', status: 'published', blocks: [T('video', { id: 'vid001', title: 'معرفی', caption: 'یک دقیقه با برنامه' }), T('reviews', { id: 'rev001', title: 'مشتری‌ها', items: [{ text: 'کارم نصف شد', by: 'احمد', role: 'دکان‌دار، کابل' }] }), T('text', { id: 'txt001', title: 'متن' })] } });
      const vp = r.json.page.id;
      ok(r.status === 200 && r.json.page.blocks.length === 3 && r.json.page.blocks[0].video === null, 'صفحه با بخش ویدیو و نظرها ساخته شد', r.text);
      ok(!(await req('GET', '/p/videos')).text.includes('blk-video') && (await req('GET', '/p/videos')).text.includes('class="review spot ring"'), 'تا ویدیو گذاشته نشود، بخش ویدیو در سایت نیست');
      const bad = [await A('PUT', `/pages/${vp}/blocks/txt001/video`, { body: MP4 }), await A('PUT', `/pages/${vp}/blocks/nope/video`, { body: MP4 }), await A('PUT', `/pages/${vp}/blocks/vid001/video`, { body: fx.PNG }), await A('PUT', `/pages/${vp}/blocks/vid001/video`, { body: Buffer.from('<html><script>alert(1)</script></html>'.padEnd(80, ' ')) }), await A('PUT', `/pages/${vp}/blocks/vid001/poster`, { body: MP4 }), await A('PUT', `/pages/${vp}/blocks/rev001/poster`, { body: fx.PNG }), await req('PUT', `/api/admin/pages/${vp}/blocks/vid001/video`, { body: MP4, headers: { 'x-v3': '1' } })];
      ok(bad.map((x) => x.status).join() === '400,404,400,400,400,400,401' && !fs.readdirSync(path.join(dir2, 'images')).some((n) => /\.(mp4|webm)$/.test(n)), 'ویدیو فقط روی بخشِ «ویدیو»ی ذخیره‌شده، فقط MP4/WebM واقعی و فقط با ورود', bad.map((x) => x.status));
      r = await A('PUT', `/pages/${vp}/blocks/vid001/video`, { body: Buffer.concat([MP4, Buffer.alloc(60 * 1024 * 1024)]) });
      ok(r.status === 413 && /مگابایت/.test(r.json.error), 'ویدیوی بزرگ‌تر از ۶۰ مگابایت رد می‌شود', [r.status]);
      r = await A('PUT', `/pages/${vp}/blocks/vid001/video`, { body: MP4, headers: { 'content-type': 'text/html' } });
      const v1 = r.json.video && r.json.video.file;
      ok(r.status === 200 && /^[\w-]+\.mp4$/.test(v1) && r.json.video.size === MP4.length && r.json.video.mime === 'video/mp4' && fs.existsSync(imgFile(v1)), 'بارگذاری ویدیو (نوع از روی بایت‌های فایل)', r.text);
      r = await req('GET', `/media/${v1}`);
      const part = await req('GET', `/media/${v1}`, { headers: { range: 'bytes=4-11' } });
      ok(r.status === 200 && r.headers['content-type'] === 'video/mp4' && r.headers['accept-ranges'] === 'bytes' && part.status === 206 && part.headers['content-range'] === `bytes 4-11/${MP4.length}` && part.buf.toString() === 'ftypisom', 'ویدیو با نوع درست و با Range (جلو و عقب بردن) داده می‌شود', [r.status, part.status, part.headers['content-range']]);
      r = await A('PUT', `/pages/${vp}/blocks/vid001/poster`, { body: fx.PNG });
      const po1 = r.json.poster && r.json.poster.file;
      ok(r.status === 200 && r.json.poster.w === 1 && fs.existsSync(imgFile(po1)), 'تصویر پیش‌نمایش ویدیو');
      let pdoc = (await A('GET', '/pages')).json.pages.find((x) => x.id === vp);
      pdoc.blocks[0].video = { file: 'injected.mp4', size: 1, mime: 'text/html' }; pdoc.blocks[0].poster = { file: 'injected.png', w: 9, h: 9 };
      r = await A('PUT', `/pages/${vp}`, { json: pdoc });
      ok(r.json.page.blocks[0].video.file === v1 && r.json.page.blocks[0].poster.file === po1, 'ذخیرهٔ فرم، ویدیو و تصویر پیش‌نمایش را نگه می‌دارد و نام فرستاده‌شده را نمی‌پذیرد', r.text);
      const pub = (await req('GET', '/p/videos')).text;
      ok(pub.includes(`<source src="/media/${v1}" type="video/mp4">`) && pub.includes(`poster="/media/${po1}" width="1" height="1"`) && pub.includes('<figcaption>یک دقیقه با برنامه</figcaption>') && pub.includes('<span class="review-av" aria-hidden="true">ا</span><b>احمد</b><span>دکان‌دار، کابل</span>'), 'ویدیو و نظرها در صفحهٔ عمومی');
      const mdv = (await req('GET', '/p/videos.md')).text;
      ok(mdv.includes(`/media/${v1})`) && mdv.includes('> کارم نصف شد') && mdv.includes('— احمد، دکان‌دار، کابل'), 'متن ساده: نشانی ویدیو و نظرها', mdv);
      r = await A('PUT', `/pages/${vp}/blocks/vid001/video`, { body: WEBM });
      const v2 = r.json.video.file;
      ok(r.status === 200 && /\.webm$/.test(v2) && await gone(v1) && (await req('GET', `/media/${v2}`)).headers['content-type'] === 'video/webm', 'عوض‌کردن ویدیو، فایل قبلی را پاک می‌کند (WebM هم پذیرفته می‌شود)');
      pdoc = (await A('GET', '/pages')).json.pages.find((x) => x.id === vp);
      pdoc.blocks.push(T('video', { id: 'vid002', videoFrom: 'vid001', posterFrom: 'vid001', title: 'کپی' }));
      r = await A('PUT', `/pages/${vp}`, { json: pdoc });
      ok(r.json.page.blocks[3].video.file === v2 && r.json.page.blocks[3].poster.file === po1 && !('videoFrom' in r.json.page.blocks[3]), 'کپیِ بخش ویدیو همان فایل‌ها را می‌گیرد (از دادهٔ سرور)');
      r = await A('DELETE', `/pages/${vp}/blocks/vid001/video`);
      await new Promise((res) => setTimeout(res, 120));
      ok(r.status === 200 && fs.existsSync(imgFile(v2)) && d2().pages.find((x) => x.id === vp).blocks[0].video === null, 'ویدیویی که هنوز در بخش دیگری هست پاک نمی‌شود');
      const ex = await require('../src/export').buildExport({ db: site2.db, files: site2.files, assets: site2.assets, dataDir: dir2, env: (extra) => Object.assign({ settings: d2().settings, assets: site2.assets, apps: d2().apps.filter((a) => a.status !== 'draft'), pages: d2().pages.filter((x) => x.status === 'published'), home: d2().home }, extra) });
      ok(fs.existsSync(path.join(ex.dir, 'media', v2)) && fs.existsSync(path.join(ex.dir, 'media', po1)), 'خروجی ایستا ویدیو و تصویر پیش‌نمایش را هم می‌برد');
      r = await A('DELETE', `/pages/${vp}`);
      ok(r.status === 200 && await gone(v2) && await gone(po1), 'حذف صفحه، ویدیو و تصویر پیش‌نمایش را هم پاک می‌کند');
    }

    section('بخش‌های صفحه: ورودی خصمانه (4xx، نه 5xx)');
    let deep2 = 'x'; for (let i = 0; i < 2000; i++) deep2 = [deep2];
    const hostile = [
      ['PUT', '/home', {}], ['PUT', '/home', { blocks: 'x' }], ['PUT', '/home', { blocks: { length: 5 } }], ['PUT', '/home', { blocks: null }],
      ['PUT', '/home', { blocks: [null, 7, 'x', [[]], { type: null }, { type: {} }, { type: 'text', title: {}, body: [] }, { type: 'table', head: { 0: 'a' }, rows: 'x' }, { type: 'table', head: ['a'], rows: [null, 5, {}, [{}, []]] }, { type: 'cards', items: { length: 9 } }, { type: 'faq', items: [null, 4, 'x', []] }, { type: 'image', image: 'x', side: {} }, { type: 'cta', href: {}, label: [] }] }],
      ['PUT', '/home', { blocks: [{ type: 'text', title: deep2, body: deep2 }, { type: 'cards', items: deep2 }, { type: 'table', head: deep2, rows: deep2 }] }],
      ['PUT', '/home', { blocks: Array.from({ length: 5000 }, () => ({ type: 'text', title: 'x' })) }],
      ['POST', '/pages', { title: ['x'] }], ['POST', '/pages', { title: 'x', slug: { a: 1 }, blocks: 'x', nav: {}, status: [] }],
      ['PUT', `/pages/${pageId}`, { title: 'دربارهٔ VILL3N', blocks: { a: 1 }, description: {}, slug: [] }],
      ['PUT', `/apps/${app2}`, { name: 'VILL3N Shop', slug: 'shop', status: 'published', blocks: [{ type: 'text', title: 'x', __x: 1 }, null], badges: [{}, [], null, 'ok'], features: [{ icon: {}, title: 'x' }, { icon: ['bolt'], title: 'y' }] }],
      ['POST', '/pages/order', { ids: 'x' }], ['POST', '/pages/order', { ids: [{}, null] }],
    ];
    codes = [];
    for (const [m, u, j] of hostile) codes.push((await A(m, u, { json: j })).status);
    // کلیدهای __proto__ باید با متن خام فرستاده شوند (JSON.stringify آن‌ها را نمی‌نویسد)
    const rawBodies = ['{"blocks":[{"type":"text","title":"x","__proto__":{"polluted":1}},{"__proto__":{"type":"text","title":"y"}}],"__proto__":{"blocks":[]}}', '{"blocks":[{"type":"cards","items":[{"__proto__":{"title":"x"},"icon":"__proto__"}]},{"type":"__proto__"},{"type":"hasOwnProperty","title":"x"}]}', '[1,2,3]', '"x"', 'null', '{bad json'];
    for (const body of rawBodies) codes.push((await A('PUT', '/home', { body, headers: { 'content-type': 'application/json' } })).status);
    ok(codes.every((c) => c >= 200 && c < 500) && codes.slice(0, 4).every((c) => c === 400) && ({}).polluted === undefined, 'هیچ ورودی خرابی خطای سرور نمی‌سازد', codes);
    ok(d2().home.blocks.length <= 40 && d2().pages.length <= 40 && d2().apps.find((x) => x.id === app2).badges.join() === 'ok' && (await A('GET', '/home')).status === 200 && (await req('GET', '/')).status === 200 && (await req('GET', '/app/shop')).status === 200, 'بعد از ورودی‌های خراب، داده در سقف‌ها می‌ماند و سایت سالم است');
    r = await A('PUT', '/home', { body: Buffer.alloc(3 * 1024 * 1024, 0x20), headers: { 'content-type': 'application/json' } });
    ok(r.status === 413, 'فرمِ خیلی حجیم → 413', r.status);
    codes = [];
    for (let i = d2().pages.length; i < 42; i++) codes.push((await A('POST', '/pages', { json: { title: `ص ${i}`, slug: `bulk-${i}` } })).status);
    ok(d2().pages.length === 40 && codes.filter((c) => c === 400).length === 2, 'حداکثر ۴۰ صفحه', d2().pages.length);
    for (const p of d2().pages.filter((x) => x.slug.startsWith('bulk-') || x.slug.startsWith('page-') || x.slug === 'x')) await A('DELETE', `/pages/${p.id}`);

    section('بخش‌های صفحه: متن ساده برای هوش مصنوعی');
    ok(await gone(imgHome), 'جایگزین‌شدن بخش‌های صفحهٔ اصلی، تصویرِ بخشِ حذف‌شده را پاک می‌کند');
    await A('PUT', '/home', { json: { blocks: [T('stats', { title: 'در یک نگاه', items: [{ value: '۵', label: 'برنامهٔ آماده' }] }), T('image', { id: 'homeimg', alt: 'نمای دفتر' })] } });
    imgHome = (await A('PUT', '/home/blocks/homeimg/image', { body: fx.PNG })).json.image.file;
    adoc = (await A('GET', `/apps/${app2}`)).json.app;
    adoc.blocks = [T('cards', { title: 'مزیت‌ها', items: [{ icon: 'bolt', title: 'سریع', text: 'در یک ثانیه' }] }), T('table', { title: 'مقایسهٔ نسخه‌ها', head: ['', 'رایگان', 'کامل'], rows: [['فاکتور', '✓', '✓'], ['گزارش|سود', '✗', '✓']], note: 'قیمت‌ها به افغانی' }), T('steps', { title: 'نصب', items: [{ title: 'دانلود', text: 'فایل را بگیرید' }, { title: 'اجرا' }] }), T('quote', { text: 'حسابم منظم شد', by: 'احمد', role: 'دکاندار' }), T('cta', { title: 'شروع کنید', label: 'اشتراک‌ها', href: '/app/shop' }), T('faq', { title: 'پرسش‌ها', items: [{ q: 'بلوک پرسش؟', a: 'بلوک پاسخ.' }] })];
    await A('PUT', `/apps/${app2}`, { json: adoc });
    const mdOut = ai.blocksMarkdown(d2().apps.find((x) => x.id === app2).blocks, 2, 'https://vill3n.top');
    ok(mdOut.includes('## مزیت‌ها') && mdOut.includes('- **سریع**: در یک ثانیه') && mdOut.includes('|   | رایگان | کامل |') && mdOut.includes('| --- | --- | --- |') && mdOut.includes('| گزارش\\|سود | ✗ | ✓ |') && mdOut.includes('1. **دانلود**: فایل را بگیرید') && mdOut.includes('2. **اجرا**') && mdOut.includes('> حسابم منظم شد') && mdOut.includes('> — احمد، دکاندار') && mdOut.includes('[اشتراک‌ها](https://vill3n.top/app/shop)') && mdOut.includes('**بلوک پرسش؟**') && mdOut.includes('قیمت‌ها به افغانی'), 'blocksMarkdown: تیتر، فهرست، جدول، مرحله، نقل‌قول، پیوند و پرسش', mdOut);
    ok(ai.blocksMarkdown(null) === '' && ai.blocksMarkdown([null, 5, { type: 'zzz', title: 'x' }, { type: 'table' }, { type: 'cards' }, { type: 'image', image: { file: 'a.png' }, alt: 'عکس' }], 3, '').includes('![عکس](/media/a.png)') && ai.blocksMarkdown([T('text', { title: 'ت', body: 'ب' })], 4).startsWith('#### ت'), 'blocksMarkdown با دادهٔ ناقص هم خطا نمی‌دهد');
    r = await req('GET', '/app/shop.md');
    ok(r.status === 200 && r.text.includes('## مقایسهٔ نسخه‌ها') && r.text.includes('| فاکتور | ✓ | ✓ |') && r.text.includes('**بلوک پرسش؟**') && r.text.includes('- **سریع**: در یک ثانیه'), 'متن سادهٔ برنامه بخش‌های صفحه را هم دارد', r.text);
    r = await req('GET', '/llms-full.txt');
    ok(r.status === 200 && r.text.includes('## صفحهٔ اصلی') && r.text.includes('- **۵** برنامهٔ آماده') && r.text.includes('## دربارهٔ VILL3N') && r.text.includes('https://vill3n.top/p/about') && r.text.includes('| وب‌سایت | ۲۰٬۰۰۰ |') && r.text.includes('### مقایسهٔ نسخه‌ها') && !r.text.includes('محرمانه‌ی پیش‌نویس') && !r.text.includes('/p/draft-page'), 'llms-full.txt: بخش‌های صفحهٔ اصلی و صفحه‌های منتشرشده (نه پیش‌نویس)', r.text);
    r = await req('GET', '/llms.txt');
    ok(r.status === 200 && r.text.includes('[دربارهٔ VILL3N](https://vill3n.top/p/about)') && !r.text.includes('draft-page') && !r.text.includes('مقایسهٔ نسخه‌ها'), 'llms.txt: پیوند صفحه‌های منتشرشده');
    r = await req('GET', '/api/openapi.json');
    ok(!/admin|blocks|pages/.test(JSON.stringify(r.json.paths)), 'مسیرهای پنل در توضیح API عمومی نمی‌آید');

    section('بخش‌های صفحه: پشتیبان، بازگردانی و ماندگاری');
    r = await A('PUT', `/apps/${app2}`, { json: Object.assign({}, adoc, { blocks: (await A('GET', `/apps/${app2}`)).json.app.blocks.concat([T('image', { id: 'keepimg', alt: 'نمای برنامه' })]) }) });
    r = await A('PUT', `/apps/${app2}/blocks/keepimg/image`, { body: fx.PNG });
    const imgKeep = r.json.image.file;
    r = await A('GET', '/backup');
    const bk = JSON.parse(r.text);
    ok(bk.home.blocks.length === 2 && bk.home.blocks[1].image.file === imgHome && bk.pages.length === 2 && bk.pages.find((x) => x.slug === 'about').blocks.some((x) => x.image && x.image.file === imgPage) && bk.apps[0].blocks.length === 7 && bk.apps[0].badges.length === 1 && bk.apps[0].features.length === 2, 'پشتیبان JSON بخش‌ها، صفحه‌ها، برچسب‌ها و نشانه‌ها را دارد');
    r = await A('GET', '/backup.zip');
    const zf = path.join(dir2, 'tmp', 'b.zip');
    fs.writeFileSync(zf, r.buf);
    const zfd = fs.openSync(zf, 'r');
    const zent = zipEntries(zfd, r.buf.length);
    fs.closeSync(zfd); fs.unlinkSync(zf);
    ok(zent && [imgHome, imgPage, imgKeep].every((n) => zent.some((e) => e.name === `images/${n}`)) && zent.some((e) => e.name === 'db.json'), 'پشتیبان ZIP فایلِ تصویرِ بخش‌ها را دارد', zent && zent.map((e) => e.name));
    // همه‌چیز عوض می‌شود، بعد پشتیبان برمی‌گردد
    await A('PUT', '/home', { json: { blocks: [T('text', { title: 'عوض‌شده' })] } });
    await A('DELETE', `/pages/${draftPage}`);
    await A('PUT', `/apps/${app2}`, { json: { name: 'VILL3N Shop', slug: 'shop', status: 'published', blocks: [], badges: [], features: [] } });
    r = await A('POST', '/restore', { json: { data: bk, confirm: 'RESTORE' } });
    const back = d2().apps.find((x) => x.slug === 'shop');
    ok(r.status === 200 && d2().home.blocks.length === 2 && d2().home.blocks[0].items[0].label === 'برنامهٔ آماده' && d2().pages.map((x) => x.slug).sort().join() === 'about,draft-page' && d2().pages.find((x) => x.slug === 'about').nav === true && back.blocks.map((x) => x.type).join() === 'cards,table,steps,quote,cta,faq,image' && back.blocks[6].image.file === imgKeep && back.badges.join() === 'ok' && back.features.length === 2, 'بازگردانی: بخش‌ها، صفحه‌ها، برچسب‌ها و تصویرِ بخش‌ها برمی‌گردند', r.text);
    ok(JSON.stringify(d2().home) === JSON.stringify(bk.home) && JSON.stringify(d2().pages.map((x) => x.blocks)) === JSON.stringify(bk.pages.map((x) => x.blocks)) && JSON.stringify(back.blocks) === JSON.stringify(bk.apps[0].blocks), 'رفت و برگشتِ پشتیبان، بخش‌ها را بی‌تغییر نگه می‌دارد');
    // پشتیبانِ دست‌کاری‌شده
    const evil2 = JSON.parse(JSON.stringify(bk));
    evil2.home = { blocks: [T('image', { image: { file: '../../db.json', w: 1, h: 1 }, alt: 'x' }), T('cta', { title: 'x', label: 'x', href: 'javascript:alert(1)' }), { type: 'evil' }, null, T('cards', { items: [{ icon: 'constructor', title: 'x' }] })] };
    evil2.pages = [null, 7, { id: 'pz', title: '', slug: '../../admin', status: 'weird', nav: 'yes', blocks: 'x' }, { id: 'pz2', title: 'دو', slug: 'about' }, { id: 'pz3', title: 'سه', slug: 'about', blocks: [T('table', { head: ['a'], rows: [['<script>alert(1)</script>']] })] }, { title: 'بی‌شناسه' }].concat(Array.from({ length: 60 }, (_, i) => ({ id: `many${i}`, title: `ص${i}`, slug: `m-${i}` })));
    evil2.apps[0].blocks = [T('image', { image: { file: 'x.php' }, alt: 'a' }), { type: 'weird' }, T('text', { title: long(999) })];
    evil2.apps[0].badges = [long(99), {}, 'خوب'];
    evil2.apps[0].features = [{ icon: '__proto__', title: 'x' }];
    r = await A('POST', '/restore', { json: { data: evil2, confirm: 'RESTORE' } });
    const eApp = d2().apps.find((x) => x.slug === 'shop');
    ok(r.status === 200 && d2().home.blocks.length === 3 && d2().home.blocks[0].image === null && d2().home.blocks[1].href === '' && d2().home.blocks[2].items[0].icon === '' && d2().pages.length === 40 && d2().pages[0].slug !== 'admin' && d2().pages[0].title === 'بدون عنوان' && d2().pages[0].status === 'draft' && d2().pages[0].blocks.length === 0 && new Set(d2().pages.map((x) => x.slug)).size === 40 && eApp.blocks.length === 2 && eApp.blocks[0].image === null && eApp.blocks[1].title.length === 120 && eApp.badges.length === 2 && eApp.badges[0].length === 28 && eApp.features[0].icon === '', 'پشتیبانِ دست‌کاری‌شده: بخش‌ها و صفحه‌ها پاک‌سازی می‌شوند', [d2().home.blocks, d2().pages.slice(0, 3)]);
    ok((await req('GET', '/')).status === 200 && (await req('GET', '/app/shop')).status === 200 && (await A('GET', '/pages')).status === 200 && (await req('GET', '/llms-full.txt')).status === 200, 'بعد از آن، سایت و پنل سالم کار می‌کنند');
    // پشتیبانِ قدیمی (پیش از این قابلیت): بدون home و pages و بدون بخش در برنامه‌ها
    const oldBk = JSON.parse(JSON.stringify(bk));
    delete oldBk.home; delete oldBk.pages;
    for (const a of oldBk.apps) { delete a.blocks; delete a.badges; for (const f of a.features) delete f.icon; }
    r = await A('POST', '/restore', { json: { data: oldBk, confirm: 'RESTORE' } });
    ok(r.status === 200 && d2().home.blocks.length === 0 && d2().pages.length === 0 && d2().apps[0].blocks.length === 0 && d2().apps[0].badges.length === 0 && d2().apps[0].features[0].icon === '' && (await A('GET', `/apps/${d2().apps[0].id}`)).json.app.blocks.length === 0, 'پشتیبانِ قدیمی (بدون بخش‌ها) هم سالم بازگردانی می‌شود', r.text);
    await A('POST', '/restore', { json: { data: bk, confirm: 'RESTORE' } });
    // دادهٔ قدیمی روی دیسک: فیلدهای تازه هنگام بالا آمدن پر می‌شوند
    site2.stop(); await new Promise((res) => server2.close(res));
    const rawDb = JSON.parse(fs.readFileSync(path.join(dir2, 'db.json'), 'utf8'));
    ok(rawDb.home.blocks.length === 2 && rawDb.pages.length === 2 && rawDb.apps[0].blocks.length === 7, 'بخش‌ها و صفحه‌ها روی دیسک ذخیره شده‌اند');
    delete rawDb.home; delete rawDb.pages;
    for (const a of rawDb.apps) { delete a.blocks; delete a.badges; for (const f of a.features) delete f.icon; }
    fs.writeFileSync(path.join(dir2, 'db.json'), JSON.stringify(rawDb));
    site2 = make2(); server2 = await listen(site2, { port: 0, host: '127.0.0.1' }); base = `http://127.0.0.1:${server2.address().port}`;
    ok(Array.isArray(d2().home.blocks) && Array.isArray(d2().pages) && d2().apps.every((a) => Array.isArray(a.blocks) && Array.isArray(a.badges) && a.features.every((f) => f.icon === '')), 'دادهٔ نسخهٔ قبلی (بدون این فیلدها) هنگام بالا آمدن کامل می‌شود');
    r = await A('GET', `/apps/${d2().apps[0].id}`);
    const r4 = await A('PUT', `/apps/${d2().apps[0].id}`, { json: Object.assign({}, r.json.app, { blocks: [T('text', { title: 'بعد از مهاجرت' })] }) });
    ok(r.status === 200 && r4.status === 200 && r4.json.app.blocks.length === 1 && (await A('GET', '/home')).json.blocks.length === 0 && (await req('GET', '/')).status === 200 && (await req('GET', '/llms-full.txt')).status === 200, 'روی دادهٔ قدیمی هم پنل و سایت کار می‌کنند');
    site2.stop(); await new Promise((res) => server2.close(res));
    fs.rmSync(dir2, { recursive: true, force: true });
  }
  /* ═════════════ پایان بخشِ «بخش‌های صفحه» ═════════════ */

  /* ═════════════ نمایش عمومی: طرح تازه، بخش‌ها و صفحه‌های دلخواه ═════════════ */
  {
    section('نمایش عمومی: صفحهٔ اصلی، فصل‌ها و بخش‌ها');
    const model3 = require('../src/core/model');
    const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-pub-'));
    const site3 = createSite({ dataDir: dir3, publicDir: path.join(__dirname, '..', 'public'), config: { port: 0, host: '127.0.0.1' } });
    const server3 = await listen(site3, { port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${server3.address().port}`;
    const d3 = site3.db.data;
    const lds3 = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const idsOf = (html) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    let r = await req('GET', '/');
    const n = d3.apps.length;
    ok(r.status === 200 && n === 5 && (r.text.match(/class="stage-app /g) || []).length === n && (r.text.match(/class="stage-tab[ "]/g) || []).length === n && (r.text.match(/<li class="chapter" /g) || []).length === n && (r.text.match(/class="mock k-/g) || []).length === n * 2, 'صفحهٔ اصلی: صحنهٔ قهرمان، فصل هر برنامه و رابط نمایشی هر دستگاه', [n]);
    ok(/<h1 class="display" aria-label="[^"]{10,}">/.test(r.text) && (r.text.match(/<h1[\s>]/g) || []).length === 1 && /data-scene="dust"/.test(r.text) && /data-scene-src="\/assets\/scene\.js/.test(r.text), 'صفحهٔ اصلی: یک تیتر اصلی با متن کامل برای صفحه‌خوان، و صحنهٔ پس‌زمینه');
    ok(['blk-cards', 'blk-stats', 'blk-table', 'blk-steps', 'blk-faq'].every((c) => r.text.includes(`class="blk ${c}"`)) && /class="tiles is-bento" data-n="6"/.test(r.text) && /<span class="yes">/.test(r.text) && /<span class="no">/.test(r.text) && /<b data-count>۲۵۶<\/b>/.test(r.text), 'بخش‌های آمادهٔ صفحهٔ اصلی: کادرها، آمار، جدول (با ✓ و ✗)، مرحله‌ها و پرسش‌ها');
    ok(lds3(r.text).some((x) => x['@type'] === 'FAQPage' && x.mainEntity.length >= 4) && new Set(idsOf(r.text)).size === idsOf(r.text).length && !/<img(?![^>]*\balt=)[^>]*>/.test(r.text), 'صفحهٔ اصلی: پرسش‌ها در دادهٔ ساختاریافته، شناسهٔ تکراری نیست، همهٔ تصویرها متن جایگزین دارند');
    ok(!/position:\s*fixed/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'site.css'), 'utf8').replace(/\.progress \{[^}]*\}/, '')), 'هیچ لایهٔ ثابتِ تمام‌صفحه‌ای در طرح نیست (فقط خط باریک پیشرفت)');

    r = await req('GET', '/app/pump-yaqoubi');
    ok(r.status === 200 && /<ul class="badges"><li>دیزل و پطرول<\/li>/.test(r.text) && (r.text.match(/<li class="tile spot"/g) || []).length === 9 && /class="tile-wm"/.test(r.text) && /<nav class="subnav"/.test(r.text) && /class="blk blk-quote"/.test(r.text) && /class="blk blk-table"/.test(r.text) && /<section class="sec blk-faq" id="faq">/.test(r.text), 'صفحهٔ برنامه: برچسب‌ها، کاشی ویژگی‌ها با نشانه، نوار بخش‌ها، بخش‌های دلخواه و پرسش‌ها');
    ok((r.text.match(/<h1[\s>]/g) || []).length === 1 && new Set(idsOf(r.text)).size === idsOf(r.text).length && /class="mock k-fuel m-wide"/.test(r.text) && /style="--app:#f2a23a;--app2:#ff5d3a;/.test(r.text) && lds3(r.text).some((x) => x['@type'] === 'FAQPage'), 'صفحهٔ برنامه: یک تیتر، شناسهٔ یکتا، رابط نمایشی و رنگ خودِ برنامه');

    section('نمایش عمومی: ورودی خطرناک در بخش‌ها بی‌خطر می‌شود');
    const evil = '<script>alert(1)</script>"><img src=x onerror=alert(2)>';
    d3.home = { blocks: model3.cleanBlocks([
      { type: 'text', title: evil, body: `${evil}\n\n- ${evil}` },
      { type: 'cards', title: 'ک', items: [{ icon: 'bolt', title: evil, text: evil }] },
      { type: 'table', head: [evil, 'ب'], rows: [[evil, '✓'], ['x', '✗']], firstCol: true, note: evil },
      { type: 'stats', items: [{ value: '<b>1', label: evil }] },
      { type: 'steps', items: [{ title: evil, text: evil }] },
      { type: 'quote', text: evil, by: evil, role: evil },
      { type: 'cta', title: evil, text: evil, label: evil, href: 'https://example.com/?a="><script>alert(3)</script>' },
      { type: 'faq', items: [{ q: evil, a: evil }] },
      { type: 'image', title: evil, alt: evil, text: evil },
    ], [], 40) };
    site3.db.touch();
    r = await req('GET', '/');
    const noLd = r.text.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
    ok(r.status === 200 && d3.home.blocks.length === 9 && !/<script>alert/.test(noLd) && !/<img src=x/.test(noLd) && !/onerror=alert\(2\)>/.test(noLd.replace(/&[a-z#0-9]+;/g, '')) && noLd.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'متن خطرناک در هر ۹ نوع بخش فقط به‌صورت نوشته دیده می‌شود');
    ok(!/<\/script>\s*"/.test(r.text.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g).join('')) && lds3(r.text).some((x) => x['@type'] === 'FAQPage' && x.mainEntity[0].name === evil), 'دادهٔ ساختاریافته با متن خطرناک سالم می‌ماند و از برچسب بیرون نمی‌زند');
    ok(/href="https:\/\/example\.com\/\?a=&quot;&gt;&lt;script&gt;alert\(3\)&lt;\/script&gt;" target="_blank" rel="noopener"/.test(r.text), 'پیوندِ دکمه داخل نقل‌قول می‌ماند');

    section('نمایش عمومی: صفحه‌های دلخواه');
    d3.pages = [
      model3.cleanPage({ title: 'دربارهٔ ما', slug: 'about', description: 'معرفی VILL3N', status: 'published', nav: true, blocks: [{ type: 'text', title: 'ما که هستیم', body: 'برنامه می‌سازیم.' }, { type: 'faq', items: [{ q: 'کجا هستید؟', a: 'افغانستان' }] }] }, null, []),
      model3.cleanPage({ title: 'محرمانه', slug: 'secret', status: 'draft', blocks: [{ type: 'text', title: 'پنهان' }] }, null, []),
    ];
    site3.db.touch();
    r = await req('GET', '/p/about');
    ok(r.status === 200 && /<title>دربارهٔ ما \| VILL3N<\/title>/.test(r.text) && /<link rel="canonical" href="https:\/\/vill3n\.top\/p\/about">/.test(r.text) && r.text.includes('ما که هستیم') && lds3(r.text).some((x) => x['@type'] === 'WebPage') && lds3(r.text).some((x) => x['@type'] === 'FAQPage') && (r.text.match(/<h1[\s>]/g) || []).length === 1, 'صفحهٔ منتشرشده: عنوان، نشانی اصلی، بخش‌ها و دادهٔ ساختاریافته');
    ok((await req('GET', '/p/secret')).status === 404 && (await req('GET', '/p/nope')).status === 404 && (await req('GET', '/p/secret.md')).status === 404, 'صفحهٔ پیش‌نویس و ناموجود → 404');
    r = await req('GET', '/');
    ok(/<a href="\/p\/about">دربارهٔ ما<\/a>/.test(r.text) && !r.text.includes('/p/secret'), 'صفحهٔ «نمایش در فهرست» در منوی سایت می‌آید؛ پیش‌نویس نه');
    r = await req('GET', '/sitemap.xml');
    ok(r.text.includes('<loc>https://vill3n.top/p/about</loc>') && !r.text.includes('secret'), 'نقشهٔ سایت صفحهٔ منتشرشده را دارد');
    r = await req('GET', '/p/about.md');
    ok(r.status === 200 && /markdown/.test(r.headers['content-type']) && r.text.includes('دربارهٔ ما') && r.text.includes('کجا هستید؟'), 'متن سادهٔ صفحه برای هوش مصنوعی');
    r = await req('GET', '/llms.txt');
    ok(r.text.includes('/p/about') && !r.text.includes('secret'), 'llms.txt صفحهٔ منتشرشده را فهرست می‌کند');

    section('نمایش عمومی: اصلاح‌های بازبینی');
    r = await req('GET', '/check?code=abc');
    ok(r.status === 200 && r.text.includes('کد کامل نیست') && /noindex/.test(r.headers['x-robots-tag'] || '') && /no-store/.test(r.headers['cache-control'] || ''), 'بررسی اشتراک بدون جاوااسکریپت: کد کوتاه پیام می‌دهد و در جست‌وجو و کش نمی‌ماند');
    r = await req('GET', '/check?code=V3-AAAA-BBBB-CCCC-DDDD');
    ok(r.status === 200 && r.text.includes('این کد پیدا نشد') && /<p class="verdict is-bad">/.test(r.text), 'بررسی اشتراک بدون جاوااسکریپت: کد ناموجود روی سرور جواب می‌گیرد');
    ok((await req('GET', '/check')).text.includes('data-check-out aria-live="polite"></div>'), 'صفحهٔ بررسی بدون کد، خالی و قابل‌کش می‌ماند');
    const pump3 = d3.apps.find((x) => x.slug === 'pump-yaqoubi');
    pump3.plans = [model3.cleanPlan({ name: 'ماهانه', period: 'month', price: '۵۰۰', popular: true })];
    site3.db.touch();
    r = await req('GET', '/app/pump-yaqoubi');
    const soft3 = lds3(r.text).find((x) => x['@type'] === 'SoftwareApplication');
    ok(new RegExp(`<a class="btn btn-app" href="https://wa\\.me/93792236008\\?text=[^"]+" target="_blank" rel="noopener" data-order="${pump3.plans[0].id}">`).test(r.text) && r.text.includes('<span class="plan-flag">پیشنهادی</span>') && r.text.includes('class="order-actions"'), 'دکمهٔ سفارش پیوند واقعی است (بدون جاوااسکریپت به واتساپ می‌رود) و برچسب «پیشنهادی» دارد');
    ok(soft3.offers[0].priceCurrency === 'AFN' && soft3.offers[0].availability.endsWith('/PreOrder') && soft3.offers[0].price === '500', 'دادهٔ ساختاریافته: واحد پول از تنظیمات و وضعیت «پیش‌سفارش» برای برنامهٔ به‌زودی');
    d3.settings.currency = 'سکهٔ دلخواه'; site3.db.touch();
    ok(!lds3((await req('GET', '/app/pump-yaqoubi')).text).find((x) => x['@type'] === 'SoftwareApplication').offers, 'واحد پولِ ناشناخته در دادهٔ ساختاریافته نوشته نمی‌شود');
    d3.settings.currency = 'افغانی'; d3.settings.allowAI = false; site3.db.touch();
    r = await req('GET', '/app/pump-yaqoubi');
    ok(!r.text.includes('/llms.txt') && !r.text.includes('.md"') && (await req('GET', '/llms.txt')).status === 404, 'با خاموش‌بودن «خواندن برای هوش مصنوعی» پیوندهایش هم در صفحه نمی‌آید');
    d3.settings.allowAI = true; pump3.plans = []; site3.db.touch();
    ok((r.text.match(/class="art art-/g) || []).length === 9 && r.text.includes('aria-label="پمپ یعقوبی، بالای صفحه"') && /<p class="statement-big" aria-label="[^"]{20,}"><span aria-hidden="true">/.test(r.text), 'کاشی‌ها نگاره دارند؛ نوار بخش‌ها و متن معرفی نام خوانا برای صفحه‌خوان دارند');
    const many = { apps: [], pages: [] };
    for (let i = 0; i < 40; i++) { many.apps.push({ id: `a${i}`, name: 'x', slug: 'a'.repeat(48) }); many.pages.push({ id: `p${i}`, title: 'x', slug: 'b'.repeat(48) }); }
    const t0 = Date.now();
    const nb = model3.normalizeBackup(many);
    ok(Date.now() - t0 < 2000 && new Set(nb.apps.map((x) => x.slug)).size === 40 && new Set(nb.pages.map((x) => x.slug)).size === 40 && nb.apps.every((x) => x.slug.length <= 48), 'بازگردانی با ده‌ها نشانیِ تکراری گیر نمی‌کند و نشانی‌ها یکتا می‌شوند', [Date.now() - t0]);
    const viewsMod = require('../src/views');
    const stEnv = { settings: d3.settings, assets: site3.assets, apps: d3.apps, pages: [], home: { blocks: [] }, static: true };
    const stHome = viewsMod.home(stEnv), stApp = viewsMod.appPage(stEnv, pump3);
    ok(stHome.includes('href="/app/pump-yaqoubi/"') && !/href="\/app\/[a-z0-9-]+"/.test(stHome) && stApp.includes('<link rel="canonical" href="https://vill3n.top/app/pump-yaqoubi/">') && viewsMod.sitemap(stEnv).includes('/app/pump-yaqoubi/</loc>') && !stHome.includes('/llms.txt'), 'خروجی ایستا: نشانی صفحه‌ها با «/» پایانی (بدون تغییر مسیر)');

    section('نمایش عمومی: دادهٔ قدیمی و خروجی ایستا');
    const a0 = d3.apps[0];
    delete a0.blocks; delete a0.badges; delete a0.faq; delete a0.testimonials; for (const f of a0.features) delete f.icon;
    delete d3.home; d3.pages = undefined;
    site3.db.touch();
    ok((await req('GET', `/app/${a0.slug}`)).status === 200 && (await req('GET', '/')).status === 200 && (await req('GET', '/sitemap.xml')).status === 200 && (await req('GET', '/p/about')).status === 404, 'برنامه و صفحهٔ اصلی با دادهٔ بدون فیلدهای تازه هم باز می‌شوند');
    d3.home = { blocks: [] };
    d3.pages = [model3.cleanPage({ title: 'دربارهٔ ما', slug: 'about', status: 'published', blocks: [{ type: 'text', title: 'ما' }] }, null, [])];
    site3.db.touch();
    const out3 = await require('../src/export').buildExport({ db: site3.db, files: site3.files, assets: site3.assets, dataDir: dir3,
      env: (extra) => Object.assign({ settings: d3.settings, assets: site3.assets, apps: d3.apps, pages: d3.pages, home: d3.home }, extra) });
    const exHome = fs.readFileSync(path.join(out3.dir, 'index.html'), 'utf8');
    ok(fs.existsSync(path.join(out3.dir, 'p', 'about', 'index.html')) && out3.pages === 2 + d3.apps.length + 1 && !exHome.includes('href="/check"') && exHome.includes('class="stage-app '), 'خروجی ایستا صفحه‌های دلخواه را هم می‌سازد');
    const ht = fs.readFileSync(path.join(out3.dir, '.htaccess'), 'utf8');
    ok(!/html\?/.test(ht) && !/noindex/.test(ht) && /noindex/.test(fs.readFileSync(path.join(out3.dir, 'files', '.htaccess'), 'utf8')), 'خروجی ایستا: صفحه‌ها در جست‌وجو می‌آیند؛ فقط پوشهٔ فایل‌های دانلود «noindex» است');
    site3.stop(); await new Promise((res) => server3.close(res));
    fs.rmSync(dir3, { recursive: true, force: true });
  }

  console.log(`\n${fail ? '✗' : '✓'} ${pass}/${pass + fail} سبز${fail ? `\nناموفق‌ها:\n - ${failures.join('\n - ')}` : ''}\n`);
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('\nآزمون متوقف شد:', e); process.exit(1); });
