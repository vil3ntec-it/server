// ---------------------------------------------------------------------------
//  آزمونِ «کدهای شش‌رقمی»
//
//      node test/codes.mjs
//
//  سرورِ ایمیلِ ساختگی روی یک پورتِ محلی بالا می‌آید و واقعاً SMTP حرف می‌زند،
//  پس مسیرِ ارسال هم سنجیده می‌شود نه فقط منطقِ کد.
// ---------------------------------------------------------------------------
import net from 'node:net';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-codes-'));
process.env.HLP_DATA_DIR = path.join(tmp, 'data');
process.env.HLP_SITESYNC = '0';
process.env.HLP_AI_ENABLED = '0';
process.env.HLP_TUNNEL = '0';

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`);
  }
};

/* ------------------------- سرورِ ایمیلِ ساختگی ---------------------------- */

const delivered = [];
const smtp = net.createServer((socket) => {
  let buffer = '';
  let inData = false;
  let message = '';
  socket.write('220 fake ESMTP\r\n');
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let line;
    while ((line = buffer.slice(0, buffer.indexOf('\r\n') + 2)) && buffer.includes('\r\n')) {
      buffer = buffer.slice(line.length);
      const text = line.trim();
      if (inData) {
        if (text === '.') {
          inData = false;
          delivered.push(message);
          message = '';
          socket.write('250 OK queued\r\n');
        } else {
          message += text + '\n';
        }
        continue;
      }
      if (/^EHLO|^HELO/i.test(text)) socket.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n');
      else if (/^AUTH/i.test(text)) socket.write('235 ok\r\n');
      else if (/^MAIL FROM/i.test(text)) socket.write('250 ok\r\n');
      else if (/^RCPT TO/i.test(text)) socket.write('250 ok\r\n');
      else if (/^DATA/i.test(text)) {
        inData = true;
        socket.write('354 go ahead\r\n');
      } else if (/^QUIT/i.test(text)) {
        socket.write('221 bye\r\n');
        socket.end();
      } else socket.write('250 ok\r\n');
    }
  });
  socket.on('error', () => {});
});
await new Promise((resolve) => smtp.listen(0, '127.0.0.1', resolve));
const smtpPort = smtp.address().port;

/* ------------------------------ راه‌اندازی ------------------------------- */

await import('../src/db.js');
const { saveCodeSettings, codeSettings } = await import('../src/codes/settings.js');
const { ensureApp, getApp, liveRequest, recentRequests } = await import('../src/codes/store.js');
const { issueCode, verifyCode, makeCode, normalizeEmail, revealCode } = await import('../src/codes/service.js');
const { drainQueue, sweepAutoResend, queueStatus } = await import('../src/codes/queue.js');

saveCodeSettings({
  email: {
    host: '127.0.0.1',
    port: smtpPort,
    secure: false,
    from: 'server@example.com',
    fromName: 'مرکز فرمان',
    rejectUnauthorized: false,
  },
  ttlSeconds: 120,
  resendSeconds: 60,
  workers: 4,
  autoResendSeconds: 60,
  autoResendMax: 1,
});

console.log('\n── ساختِ کد ──');
const codes = new Set();
for (let i = 0; i < 400; i++) codes.add(makeCode(6));
check('همیشه شش رقم است', [...codes].every((c) => /^\d{6}$/.test(c)));
check('رقمِ اولش صفر نمی‌شود', [...codes].every((c) => c[0] !== '0'));
check('کدها تکراری نیستند', codes.size > 380, `${codes.size} از ۴۰۰`);

console.log('\n── ایمیل ──');
check('ایمیلِ درست پذیرفته می‌شود', normalizeEmail(' Ali@Example.COM ') === 'ali@example.com');
check('ایمیلِ غلط رد می‌شود', normalizeEmail('نه') === null);
check('ارقامِ فارسی تبدیل می‌شوند', normalizeEmail('user۱@example.com') === 'user1@example.com');

console.log('\n── هر برنامه، کدِ خودش ──');
ensureApp('app-fuel', { name: 'پمپ بنزین' });
ensureApp('app-shop', { name: 'فروشگاه' });

const fuel = issueCode({ app: 'app-fuel', email: 'ali@example.com', subjectId: 'FUEL-001' });
const shop = issueCode({ app: 'app-shop', email: 'ali@example.com', subjectId: 'SHOP-017' });
check('پمپ کد گرفت', fuel.ok === true, JSON.stringify(fuel));
check('فروشگاه هم کد گرفت', shop.ok === true, JSON.stringify(shop));

const fuelCode = revealCode(liveRequest('app-fuel', 'ali@example.com'));
const shopCode = revealCode(liveRequest('app-shop', 'ali@example.com'));
check('کدِ دو برنامه فرق دارد', fuelCode !== shopCode, `${fuelCode} / ${shopCode}`);
check('کدِ پمپ در فروشگاه کار نمی‌کند',
  verifyCode({ app: 'app-shop', email: 'ali@example.com', code: fuelCode }).error === 'wrong_code');
check('ایمیلِ دیگری با همین کد وارد نمی‌شود',
  verifyCode({ app: 'app-fuel', email: 'other@example.com', code: fuelCode }).error === 'no_code');

console.log('\n── یک‌بارمصرف ──');
const first = verifyCode({ app: 'app-fuel', email: 'ali@example.com', code: fuelCode });
check('کدِ درست قبول شد', first.ok === true, JSON.stringify(first));
check('شناسهٔ کاربر برگشت', first.subjectId === 'FUEL-001');
const again = verifyCode({ app: 'app-fuel', email: 'ali@example.com', code: fuelCode });
check('همان کد بارِ دوم کار نمی‌کند', again.ok === false && again.error === 'no_code');

console.log('\n── انقضا ──');
saveCodeSettings({ ttlSeconds: 30 });
const shortLived = issueCode({ app: 'app-fuel', email: 'expire@example.com', force: true });
check('کد ساخته شد', shortLived.ok === true);
const { db } = await import('../src/db.js');
db.prepare('UPDATE code_requests SET expires_at = ? WHERE id = ?').run(Date.now() - 1000, shortLived.id);
const expired = verifyCode({ app: 'app-fuel', email: 'expire@example.com', code: '000000' });
check('کدِ منقضی رد می‌شود', expired.error === 'expired', JSON.stringify(expired));
saveCodeSettings({ ttlSeconds: 120 });

console.log('\n── کدِ تازه، کدِ قبلی را باطل می‌کند ──');
issueCode({ app: 'app-fuel', email: 'ali@example.com', force: true });
const old = revealCode(liveRequest('app-fuel', 'ali@example.com'));
issueCode({ app: 'app-fuel', email: 'ali@example.com', force: true });
const fresh = revealCode(liveRequest('app-fuel', 'ali@example.com'));
check('کدِ تازه فرق دارد', old !== fresh);
check('کدِ قبلی دیگر کار نمی‌کند',
  verifyCode({ app: 'app-fuel', email: 'ali@example.com', code: old }).error === 'wrong_code');
check('کدِ تازه کار می‌کند',
  verifyCode({ app: 'app-fuel', email: 'ali@example.com', code: fresh }).ok === true);

console.log('\n── فاصلهٔ اجباری برای یک نفر ──');
issueCode({ app: 'app-fuel', email: 'fast@example.com', force: true });
const tooSoon = issueCode({ app: 'app-fuel', email: 'fast@example.com' });
check('همان نفر بلافاصله کدِ دوم نمی‌گیرد', tooSoon.error === 'too_soon', JSON.stringify(tooSoon));
check('می‌گوید چند ثانیه صبر کند', Number(tooSoon.retryAfter) > 0);

console.log('\n── فشارِ زیاد: ۵۰۰ درخواستِ هم‌زمان ──');
delivered.length = 0;
const started = Date.now();
const many = [];
for (let i = 0; i < 500; i++) {
  many.push(issueCode({ app: 'app-shop', email: `user${i}@example.com` }));
}
const tookIssue = Date.now() - started;
//  ⚠️ **ساعتِ دیوار از این سنجه بیرون رفت** (۱۴۰۵/۰۷/۰۷). سقفِ «زیر سه
//  ثانیه» روی رانرِ کندِ CI ۹٬۰۵۷ms داد و سرخ شد، در حالی که رفتار کاملاً
//  سالم بود: پانصد هشِ رمز و پانصد درجِ SQLite روی ماشینِ مشترک همین‌قدر
//  طول می‌کشد. آن‌چه واقعاً باید ثابت شود «سریع بود» نیست، **«منتظرِ
//  ایمیل نماند»** است — و آن یک حقیقتِ ساختاری است: تا این لحظه هنوز
//  **هیچ** ایمیلی نرفته و هر پانصدتا در صف نشسته‌اند.
//  ⛔ سقف را بالا نبرید و «چند ثانیه بیشتر صبر کن» ننویسید؛ عددِ ساختاری
//  دروغ نمی‌گوید و وقت روی ماشینِ CI نوسان دارد.
const sentWhileIssuing = delivered.length;
check('همهٔ ۵۰۰ کد ساخته شد', many.every((r) => r.ok), JSON.stringify(many.find((r) => !r.ok)));
check('ساختِ کدها منتظرِ ایمیل نماند', sentWhileIssuing === 0,
  `${sentWhileIssuing} ایمیل وسطِ ساخت رفته بود · ${tookIssue}ms`);

const uniqueCodes = new Set(
  recentRequests({ app: 'app-shop', limit: 500 }).map((row) => revealCode(row))
);
check('کدها تکراری نیستند', uniqueCodes.size > 480, `${uniqueCodes.size} یکتا`);

const before = queueStatus();
check('همه در صف نشسته‌اند', before.waiting >= 500, JSON.stringify(before));

const sendStart = Date.now();
await drainQueue();
const tookSend = Date.now() - sendStart;
check('صف خالی شد', queueStatus().waiting === 0);
check('۵۰۰ ایمیل واقعاً رفت', delivered.length >= 500, `${delivered.length} رفت در ${tookSend}ms`);

/** بدنهٔ ایمیل base64 است (متن و HTML هر دو) — باز می‌کنیم تا ببینیم چه رفته */
function decodeMail(raw) {
  return String(raw)
    .split('\n')
    .map((line) => {
      const clean = line.trim();
      if (clean.length < 24 || !/^[A-Za-z0-9+/=]+$/.test(clean)) return clean;
      try {
        return Buffer.from(clean, 'base64').toString('utf8');
      } catch {
        return clean;
      }
    })
    .join('\n');
}

const sample = decodeMail(delivered[0] || '');
check('ایمیل، کد را در خودش دارد', /\d{6}/.test(sample), sample.slice(0, 200));
check('عنوانِ ایمیل نوشته شده', /Subject:/i.test(delivered[0] || ''));

console.log('\n── ربات: کدِ تازه بدونِ اینکه کسی بخواهد ──');
const pending = issueCode({ app: 'app-fuel', email: 'slow@example.com', force: true });
await drainQueue();
const firstCode = revealCode(liveRequest('app-fuel', 'slow@example.com'));
// یک دقیقه عقب می‌بریم تا وقتش برسد
db.prepare('UPDATE code_requests SET created_at = ? WHERE id = ?')
  .run(Date.now() - 61_000, pending.id);

const swept = sweepAutoResend(codeSettings());
check('ربات یک کدِ تازه ساخت', swept.made === 1, JSON.stringify(swept));
const secondCode = revealCode(liveRequest('app-fuel', 'slow@example.com'));
check('کدِ تازه با قبلی فرق دارد', secondCode && secondCode !== firstCode);
check('کدِ قبلی باطل شد',
  verifyCode({ app: 'app-fuel', email: 'slow@example.com', code: firstCode }).error === 'wrong_code');
check('کدِ تازه کار می‌کند',
  verifyCode({ app: 'app-fuel', email: 'slow@example.com', code: secondCode }).ok === true);

// بارِ دوم نباید تکرار شود — سقفِ زنجیره یک است
const pending2 = issueCode({ app: 'app-fuel', email: 'loop@example.com', force: true });
db.prepare('UPDATE code_requests SET created_at = ? WHERE id = ?').run(Date.now() - 61_000, pending2.id);
sweepAutoResend(codeSettings());
const chained = liveRequest('app-fuel', 'loop@example.com');
db.prepare('UPDATE code_requests SET created_at = ? WHERE id = ?').run(Date.now() - 61_000, chained.id);
const third = sweepAutoResend(codeSettings());
check('ربات تا بی‌نهایت تکرار نمی‌کند', third.made === 0, JSON.stringify(third));

console.log('\n── تلاشِ ناموفق ──');
issueCode({ app: 'app-fuel', email: 'guess@example.com', force: true });
const real = revealCode(liveRequest('app-fuel', 'guess@example.com'));
let lastError = null;
for (let i = 0; i < 6; i++) {
  const wrong = String((Number(real) + i + 1) % 1000000).padStart(6, '0');
  lastError = verifyCode({ app: 'app-fuel', email: 'guess@example.com', code: wrong });
}
check('بعد از چند غلط، کد می‌سوزد',
  ['too_many_tries', 'no_code'].includes(lastError.error), JSON.stringify(lastError));
check('کدِ درست هم دیگر کار نمی‌کند',
  verifyCode({ app: 'app-fuel', email: 'guess@example.com', code: real }).ok === false);

console.log('\n── برنامهٔ خاموش ──');
const { saveApp } = await import('../src/codes/store.js');
saveApp('app-shop', { enabled: false });
check('برنامهٔ خاموش کد نمی‌گیرد',
  issueCode({ app: 'app-shop', email: 'x@example.com', force: true }).error === 'app_disabled');
saveApp('app-shop', { enabled: true });
check('برنامهٔ ناشناس کد نمی‌گیرد',
  issueCode({ app: 'nope', email: 'x@example.com', force: true }).error === 'unknown_app');

console.log('\n── کلیدِ هر برنامه ──');
check('برنامهٔ تازه کلید دارد', /^code_[0-9a-f]{40}$/.test(getApp('app-fuel').api_key));
check('کلید اجباری است', getApp('app-fuel').require_key === 1);

smtp.close();
await fsp.rm(tmp, { recursive: true, force: true });
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
