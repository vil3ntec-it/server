// ---------------------------------------------------------------------------
// آزمونِ «دامنه‌های قُرق»
//
// پنل نباید هرگز رکورد DNS سایتِ عمومی (yaqobipump.top روی GitHub Pages) را با
// تونل بازنویسی کند؛ چون هم سایت می‌خوابد و هم گیت‌هاب گواهی https آن را
// برمی‌دارد و مرورگر ERR_CERT_COMMON_NAME_INVALID می‌دهد.
//
//   node test/protected-domains.mjs
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-protected-'));
fs.mkdirSync(path.join(tmp, 'sites'), { recursive: true });
process.env.HLP_DATA_DIR = path.join(tmp, 'data');
process.env.HLP_SITES_ROOT = path.join(tmp, 'sites');
delete process.env.HLP_PROTECTED_DOMAINS;

const { db, setSetting } = await import('../src/db.js');
const { isProtectedHost, protectedHosts } = await import('../src/protected-hosts.js');
const { routedHostnames, skippedProtectedHostnames, addHostname, namedSetup } = await import('../src/tunnel.js');

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`);
  }
};

console.log('\n🛡️  دامنه‌های قُرق');

// ۱) پیش‌فرض: دامنهٔ سایتِ عمومی قُرق است، زیردامنه‌هایش آزادند
check('دامنهٔ سایت عمومی در فهرست قُرق است', protectedHosts().includes('yaqobipump.top'));
check('خودِ دامنه قُرق است', isProtectedHost('yaqobipump.top'));
check('حروف بزرگ هم قُرق است', isProtectedHost('YAQOBIPUMP.top'));
check('زیردامنه آزاد است', !isProtectedHost('shop.yaqobipump.top'));
check('دامنهٔ بی‌ربط آزاد است', !isProtectedHost('example.com'));

// ۲) دامنهٔ قُرق نه در مسیرهای تونل می‌آید نه رکوردش بازنویسی می‌شود
const now = Date.now();
db.prepare(
  `INSERT INTO sites(slug, name, root_path, domain, port, kind, autostart, enabled, created_at, updated_at)
   VALUES('pump', 'پمپ', ?, 'yaqobipump.top', 8100, 'static', 0, 1, ?, ?)`
).run(path.join(tmp, 'sites'), now, now);
const siteId = db.prepare("SELECT id FROM sites WHERE slug = 'pump'").get().id;
for (const name of ['yaqobipump.top', 'shop.yaqobipump.top']) {
  db.prepare('INSERT INTO domains(name, site_id, created_at) VALUES(?, ?, ?)').run(name, siteId, now);
}

const routed = routedHostnames().map((r) => r.hostname);
check('دامنهٔ قُرق به تونل نمی‌رود', !routed.includes('yaqobipump.top'), routed.join(', ') || 'خالی');
check('زیردامنه به تونل می‌رود', routed.includes('shop.yaqobipump.top'));
check('در فهرست کنارگذاشته‌ها گزارش می‌شود', skippedProtectedHostnames().includes('yaqobipump.top'));

// ۳) وصل کردنِ دستیِ دامنهٔ قُرق به تونل رد می‌شود — پیش از هر تماس با cloudflared
const added = await addHostname({ hostname: 'yaqobipump.top', port: 8100 });
check('addHostname دامنهٔ قُرق را رد می‌کند', added.error === 'protected_hostname', added.error || 'بدون خطا');
const named = await namedSetup({ hostname: 'yaqobipump.top' });
check('namedSetup دامنهٔ قُرق را رد می‌کند', named.error === 'protected_hostname', named.error || 'بدون خطا');

const okSub = await addHostname({ hostname: 'shop.yaqobipump.top', port: 8100 });
check('زیردامنه به گاردِ قُرق نمی‌خورد', okSub.error !== 'protected_hostname', okSub.error || 'بدون خطا');

// ۴) قابلِ تغییر: تنظیم و متغیرِ محیطی
setSetting('protected_domains', []);
check('با فهرستِ خالیِ تنظیم، دیگر قُرقی نیست', !isProtectedHost('yaqobipump.top'));
check('و همان دامنه دوباره در مسیرها می‌آید', routedHostnames().some((r) => r.hostname === 'yaqobipump.top'));

process.env.HLP_PROTECTED_DOMAINS = 'example.com, Foo.example ';
check('متغیرِ محیطی بر تنظیم مقدم است', isProtectedHost('example.com') && isProtectedHost('foo.example'));
check('و بقیه آزاد می‌شوند', !isProtectedHost('yaqobipump.top'));
delete process.env.HLP_PROTECTED_DOMAINS;
setSetting('protected_domains', null);
check('برگشت به پیش‌فرض', isProtectedHost('yaqobipump.top'));

await fsp.rm(tmp, { recursive: true, force: true });
console.log(`\n${fail ? '❌' : '✅'} ${pass} قبول، ${fail} رد\n`);
process.exit(fail ? 1 : 0);
