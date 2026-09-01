// ---------------------------------------------------------------------------
//  آدرسِ API از روی دامنه
//      node test/api-domain.mjs
//
//      📱 برنامه → https://api.yaqobipump.top → ☁️ Cloudflare → 🏠 سرور
//
//  کاربر فقط دامنه‌اش را می‌نویسد. این آزمون می‌سنجد که:
//      • از «yaqobipump.top» آدرسِ «api.yaqobipump.top» ساخته می‌شود،
//      • روی زیردامنه و روی خودِ api. دوباره ساخته نمی‌شود،
//      • و همان آدرس در مسیرهای تونل، به پورتِ عمومی می‌رود — نه پورتِ پنل.
//
//  آخری مهم‌ترین است: اگر به پورتِ پنل برود، فایل‌منیجر و ترمینال از
//  اینترنت باز می‌شوند.
// ---------------------------------------------------------------------------
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 200)}`);
};

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-api-domain-'));
process.env.HLP_DATA_DIR = path.join(tmp, 'data');
process.env.HLP_SITES_ROOT = path.join(tmp, 'sites');
process.env.HLP_SITESYNC_PORT = '4901';
process.env.HLP_PORT = '4900';

try {
  console.log('\n── از دامنه تا آدرسِ API ──');
  const { apiHostFor, registrableRoot } = await import('../src/platform/domain.js');

  for (const [input, expected] of [
    ['yaqobipump.top', 'api.yaqobipump.top'],
    ['YaqobiPump.Top', 'api.yaqobipump.top'],
    ['www.yaqobipump.top', 'api.yaqobipump.top'],
    ['https://yaqobipump.top/path?x=1', 'api.yaqobipump.top'],
    ['yaqobipump.top.', 'api.yaqobipump.top'],
    ['yaqobipump.top:8443', 'api.yaqobipump.top'],
    // پسوندِ دوتکه‌ای هم یک ریشه است، نه زیردامنه
    ['example.co.uk', 'api.example.co.uk'],
    // زیردامنه‌ها آدرسِ API جدا نمی‌گیرند — آدرسِ کلاینت‌ها باید یکی باشد
    ['shop.yaqobipump.top', null],
    ['a.example.co.uk', null],
    // و روی خودِ نقش‌ها دوباره سوار نمی‌شود
    ['api.yaqobipump.top', null],
    ['admin.yaqobipump.top', null],
    ['files.yaqobipump.top', null],
    // ورودیِ خراب چیزی نمی‌سازد
    ['', null],
    ['بی‌معنی', null],
    ['localhost', null],
    [null, null],
  ]) {
    const got = apiHostFor(input);
    check(`«${input}» → ${expected ?? 'هیچ'}`, got === expected, `گرفتیم: ${got}`);
  }

  check('ریشهٔ yaqobipump.top خودش است', registrableRoot('shop.yaqobipump.top') === null);
  check('ریشهٔ www حساب می‌شود', registrableRoot('www.yaqobipump.top') === 'yaqobipump.top');

  console.log('\n── همان آدرس، در مسیرهای تونل ──');
  const { ensureControlSchema } = await import('../src/control/schema.js');
  ensureControlSchema();
  const { db } = await import('../src/db.js');
  const { config } = await import('../src/config.js');
  const { apiHostnames, routedHostnames } = await import('../src/tunnel.js');

  db.prepare(
    'INSERT INTO sites(name, slug, root_path, port, enabled, created_at, updated_at) VALUES(?,?,?,?,?,?,?)'
  ).run('فروشگاه', 'shop', path.join(tmp, 'sites', 'shop'), 5010, 1, Date.now(), Date.now());
  const siteId = db.prepare('SELECT id FROM sites WHERE slug = ?').get('shop').id;
  for (const name of ['yaqobipump.top', 'shop.yaqobipump.top']) {
    db.prepare('INSERT INTO domains(name, site_id, created_at) VALUES(?,?,?)').run(name, siteId, Date.now());
  }

  const hosts = apiHostnames();
  check('برای دامنهٔ ریشه آدرسِ API ساخته شد', hosts.includes('api.yaqobipump.top'), JSON.stringify(hosts));
  check('برای زیردامنه ساخته نشد', !hosts.includes('api.shop.yaqobipump.top'), JSON.stringify(hosts));
  check('یک‌بار، نه بیشتر', hosts.filter((h) => h === 'api.yaqobipump.top').length === 1, JSON.stringify(hosts));

  const routes = routedHostnames();
  const apiRoute = routes.find((r) => r.hostname === 'api.yaqobipump.top');
  check('آدرسِ API در مسیرهای تونل هست', Boolean(apiRoute), JSON.stringify(routes));
  check(
    'و به پورتِ عمومی می‌رود، نه پورتِ پنل',
    apiRoute?.port === config.siteSync.port && apiRoute.port !== config.port,
    `پورت ${apiRoute?.port} · عمومی ${config.siteSync.port} · پنل ${config.port}`
  );
  check('برچسبش معلوم است', apiRoute?.source === 'api', apiRoute?.source);

  // زیردامنهٔ سایت سرِ جایش می‌ماند — مسیرِ API جای آن را نمی‌گیرد
  const siteRoute = routes.find((r) => r.hostname === 'shop.yaqobipump.top');
  check('زیردامنهٔ سایت هنوز به پورتِ خودِ سایت می‌رود', siteRoute?.port === 5010, JSON.stringify(routes));

  /*
   *  و مهم‌ترین ترکیب: دامنهٔ اصلی قُرق است (روی GitHub Pages می‌ماند و
   *  رکوردش بازنویسی نمی‌شود) ولی api.<همان دامنه> قُرق نیست و به سرور
   *  می‌رسد. دقیقاً همان چیزی که خواسته شده:
   *      yaqobipump.top      → سایتِ عمومی، دست‌نخورده
   *      api.yaqobipump.top  → سرورِ خانگی
   */
  const { isProtectedHost } = await import('../src/protected-hosts.js');
  const { skippedProtectedHostnames } = await import('../src/tunnel.js');
  check('دامنهٔ اصلی قُرق می‌ماند', isProtectedHost('yaqobipump.top'));
  check('و به تونل نمی‌رود', skippedProtectedHostnames().includes('yaqobipump.top'),
    JSON.stringify(skippedProtectedHostnames()));
  check('ولی آدرسِ API قُرق نیست', !isProtectedHost('api.yaqobipump.top'));
  check('پس سایتِ عمومی سرِ جایش می‌ماند و API هم کار می‌کند',
    !routes.some((r) => r.hostname === 'yaqobipump.top')
      && routes.some((r) => r.hostname === 'api.yaqobipump.top'));
} catch (e) {
  fail++;
  console.log(`\n❌ خطای غیرمنتظره: ${e.stack}`);
} finally {
  await fsp.rm(tmp, { recursive: true, force: true });
}

console.log(`\n════════════════════════\n  موفق: ${pass}    ناموفق: ${fail}\n════════════════════════\n`);
process.exit(fail ? 1 : 0);
