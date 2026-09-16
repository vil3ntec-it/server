// ---------------------------------------------------------------------------
//  آزمون: «پوشه را بردار و ببر»
//
//      node test/portable-folder.mjs
//
//  چیزی که سنجیده می‌شود:
//    • وقتی پوشهٔ داده را کاربر داده، سایت‌ها هم پیش‌فرض داخلِ همان پوشه‌اند
//    • گزارشِ سلامت، تکه‌ای که بیرون افتاده را پیدا می‌کند
//    • جابه‌جایی، هم فایل‌ها را می‌برد و هم مسیر را در دیتابیس درست می‌کند
//    • سایتی که از قبل داخل بوده، بی‌خود دست‌کاری نمی‌شود
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-portable-'));
const dataDir = path.join(tmp, 'ControlCenterData');
const outside = path.join(tmp, 'somewhere-else');

process.env.HLP_DATA_DIR = dataDir;
process.env.HLP_SITESYNC = '0';
process.env.HLP_AI_ENABLED = '0';
process.env.HLP_TUNNEL = '0';
delete process.env.HLP_SITES_ROOT;

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

const { config, ensureDirs } = await import('../src/config.js');
ensureDirs();

console.log('\n── ریشهٔ سایت‌ها داخلِ پوشهٔ داده ──');
check(
  'پیش‌فرض داخلِ پوشهٔ داده است',
  path.resolve(config.sitesRoot) === path.resolve(path.join(dataDir, 'websites')),
  config.sitesRoot,
);
check(
  'با فضای کاریِ سایت‌ها (data/sites) قاطی نشده',
  path.resolve(config.sitesRoot) !== path.resolve(path.join(dataDir, 'sites')),
);

// جدول‌ها با همین import ساخته می‌شوند — مهاجرت‌ها خودشان اجرا می‌شوند
const { db } = await import('../src/db.js');

const { folderReport, moveSitesIntoFolder, isInside } = await import('../src/sites/portable.js');

console.log('\n── داخل و بیرون ──');
check('پوشهٔ داده داخلِ خودش است', isInside(dataDir, path.join(dataDir, 'x')));
check('پوشهٔ بیرونی، بیرون شمرده می‌شود', !isInside(dataDir, outside));
check('نامِ هم‌آغاز، «داخل» حساب نمی‌شود', !isInside(path.join(tmp, 'data'), path.join(tmp, 'data-old')));

// یک سایت بیرونِ پوشه و یک سایت داخلِ پوشه می‌سازیم
const strayRoot = path.join(outside, 'my-shop');
await fsp.mkdir(strayRoot, { recursive: true });
await fsp.writeFile(path.join(strayRoot, 'index.html'), '<h1>دکان</h1>', 'utf8');

const homeRoot = path.join(config.sitesRoot, 'already-home');
await fsp.mkdir(homeRoot, { recursive: true });
await fsp.writeFile(path.join(homeRoot, 'index.html'), '<h1>خانه</h1>', 'utf8');

const now = Date.now();
const insert = db.prepare(
  `INSERT INTO sites(slug, name, root_path, kind, enabled, created_at, updated_at)
   VALUES(?,?,?,?,1,?,?)`,
);
insert.run('my-shop', 'دکان', strayRoot, 'static', now, now);
insert.run('already-home', 'خانه', homeRoot, 'static', now, now);

console.log('\n── گزارشِ سلامتِ پوشه ──');
const before = folderReport();
check('گزارش می‌گوید پوشه هنوز قابلِ حمل نیست', before.portable === false);
check('سایتِ بیرونی پیدا شد', before.strays.some((s) => s.slug === 'my-shop'));
check('سایتِ داخلی جزوِ بیرونی‌ها نیست', !before.strays.some((s) => s.slug === 'already-home'));
check('دیتابیسِ پنل داخلِ پوشه است', before.items.find((i) => i.key === 'db')?.inside === true);

console.log('\n── آوردنِ سایت‌ها به داخل ──');
const moved = await moveSitesIntoFolder({ actor: 'test' });
check('جابه‌جایی بدونِ خطا تمام شد', moved.ok === true, JSON.stringify(moved.failed));
check('یک سایت جابه‌جا شد', moved.moved.length === 1, JSON.stringify(moved.moved));
check('سایتِ داخلی دست نخورد', moved.skipped.some((s) => s.slug === 'already-home' && s.reason === 'already_inside'));

const row = db.prepare('SELECT root_path FROM sites WHERE slug = ?').get('my-shop');
check('مسیرِ دیتابیس به جای تازه اشاره می‌کند', isInside(dataDir, row.root_path), row.root_path);
check('فایل‌ها واقعاً آن‌جا هستند', fs.existsSync(path.join(row.root_path, 'index.html')));
check('جای قبلی خالی شد', !fs.existsSync(strayRoot));
check(
  'محتوای فایل سالم ماند',
  (await fsp.readFile(path.join(row.root_path, 'index.html'), 'utf8')).includes('دکان'),
);

const after = folderReport();
check('حالا پوشه قابلِ حمل است', after.portable === true, after.summary);

await fsp.rm(tmp, { recursive: true, force: true });
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
