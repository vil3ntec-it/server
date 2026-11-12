// ---------------------------------------------------------------------------
//  آزمونِ «فقط یک برنامه» — ‎scripts/move-server.mjs export|import --only <app>‎ (۱.۵۰.۹۵)
//      node test/move-only.mjs
//
//  پوشهٔ دادهٔ مبدأ و مقصدِ ساختگی ولی با شکلِ واقعی (panel.db با جدول‌های sites/domains/settings/events ِ مهاجرتِ ۰۰۱،
//  فضای کاریِ سایت با دیتابیسِ SQLite، دفترِ سرورِ سایت، سرورِ حساب با ابزارِ تطبیقِ ساختگیِ همان قراردادِ move-db.js،
//  پمپ‌ها) — همه از راهِ خطِ فرمان، مثلِ صاحب‌کار:
//    • export ِ یک سایت ⇒ فقط پوشه‌های همان سایت (نه سایتِ دیگر، نه panel.db، نه سرورِ حساب)؛ مبدأ بایت‌به‌بایت همان
//    • رمزِ غلط / بستهٔ دست‌خورده / بستهٔ کامل با ‎--only‎ ⇒ رد و مقصد بایت‌به‌بایت همان (هشِ کلِ پوشه پیش و پس)
//    • import ⇒ ردیف و دامنه‌ها در مقصد، پوشه‌ها سرِ جا، sha256 و شمارِ ردیف همان؛ دادهٔ برنامه‌های دیگرِ مقصد دست‌نخورده
//    • سایتِ هم‌نام ⇒ رد؛ با ‎--force‎ نسخهٔ پیشین کنار (پاک نه)؛ دامنهٔ مالِ سایتِ دیگر ⇒ رد
//    • سرورِ حساب همیشه کامل (با تطبیقِ move-db)، پمپ‌ها فقط با پنلِ بسته
// ---------------------------------------------------------------------------
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inspectBundle, parseOnly, importData } from '../scripts/move-server.mjs';

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 500) : ''}`); }
};
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-move-only-'));
const SCRIPT = path.join(import.meta.dirname, '..', 'scripts', 'move-server.mjs');
const PASS = 'one app at a time 2026';

const write = (root, rel, data) => {
  const p = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
};
/** هشِ هر فایلِ زیرِ یک پوشه (نام ⇒ sha256) — «بایت‌به‌بایت همان» */
function tree(dir) {
  const out = {};
  const walk = (d) => {
    let names = [];
    try { names = fs.readdirSync(d).sort(); } catch { return; }
    for (const n of names) {
      const p = path.join(d, n);
      const st = fs.lstatSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) out[path.relative(dir, p).split(path.sep).join('/')] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    }
  };
  walk(dir);
  return out;
}
const sameTree = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** همهٔ ردیف‌های همهٔ جدول‌های panel.db — «دیتابیس همان ماند» (بایت‌هایش با checkpoint ِ WAL عوض می‌شود، داده نه) */
function dbDump(file) {
  const d = new DatabaseSync(file, { readOnly: true });
  try {
    const out = {};
    for (const { name } of d.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()) out[name] = d.prepare(`SELECT * FROM "${name}"`).all();
    return JSON.stringify(out);
  } finally { d.close(); }
}
/** پوشهٔ داده بی بایت‌های panel.db* + محتوای دیتابیس */
const destState = (dir) => { const t = tree(dir); for (const k of Object.keys(t)) if (/^panel\.db/.test(k)) delete t[k]; return { t, db: dbDump(path.join(dir, 'panel.db')) }; };
const sameState = (a, b) => sameTree(a.t, b.t) && a.db === b.db;
const treeDiff = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).slice(0, 8).join(' ');

/** panel.db با همان ستون‌های مهاجرتِ ۰۰۱ (و fleet_aside ِ ۰۱۱) */
function makePanelDb(file, { sites = [], domains = [], settings = {} }) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE sites (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, root_path TEXT NOT NULL UNIQUE,
      domain TEXT, port INTEGER, kind TEXT, start_command TEXT, autostart INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
      note TEXT, created_at INTEGER NOT NULL, checked_at INTEGER, dns_status TEXT, dns_records TEXT, ssl_status TEXT, ssl_issuer TEXT,
      ssl_expires INTEGER, reg_expires INTEGER, http_status INTEGER);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE, msg TEXT);
    CREATE TABLE fleet_aside (id INTEGER PRIMARY KEY AUTOINCREMENT, app_id TEXT NOT NULL, slug TEXT, move_id TEXT, aside_dir TEXT, items TEXT,
      saved TEXT, at INTEGER NOT NULL, restored_at INTEGER);`);
  for (const [k, v] of Object.entries(settings)) db.prepare('INSERT INTO settings(key, value) VALUES(?, ?)').run(k, JSON.stringify(v));
  for (const s of sites) {
    db.prepare(`INSERT INTO sites(slug, name, root_path, domain, port, kind, start_command, autostart, enabled, created_at, updated_at)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1)`).run(s.slug, s.name, s.root, s.domain || null, s.port, s.kind || 'node', s.cmd || 'node server.js', s.autostart ? 1 : 0);
  }
  for (const d of domains) db.prepare('INSERT INTO domains(name, site_id, created_at) VALUES(?, (SELECT id FROM sites WHERE slug = ?), 1)').run(d.name, d.slug);
  for (let i = 0; i < 40; i++) db.prepare('INSERT INTO events(site_id, msg) VALUES((SELECT id FROM sites LIMIT 1), ?)').run(`e${i}`);
  db.close();
}
const rows = (file, sql, ...a) => { const d = new DatabaseSync(file, { readOnly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
function sqliteFile(file, n) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new DatabaseSync(file);
  d.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, amount INTEGER); CREATE TABLE notes (t TEXT)');
  for (let i = 0; i < n; i++) d.prepare('INSERT INTO orders(amount) VALUES(?)').run(i * 7);
  d.prepare('INSERT INTO notes(t) VALUES(?)').run('سلام');
  d.close();
}

const cli = (args, env = {}) => spawnSync(process.execPath, [SCRIPT, ...args], {
  encoding: 'utf8', timeout: 120000, env: { ...process.env, VILL3N_MOVE_PASSPHRASE: PASS, ...env },
});

//  ابزارِ تطبیقِ ساختگیِ سرورِ حساب — همان قراردادِ ‎move-db.js inspect --json‎ (مثلِ test/move-server.mjs)
const TOOL = path.join(tmp, 'fake-move-db.mjs');
fs.writeFileSync(TOOL, `
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const i = process.argv.indexOf('--db'); const dir = process.argv[i + 1].replace(/^pglite:/, '');
const h = crypto.createHash('sha256'); let rows = 0;
const walk = (d) => { for (const n of fs.readdirSync(d).sort()) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else { h.update(n); h.update(fs.readFileSync(p)); rows++; } } };
walk(dir);
const money = fs.existsSync(path.join(dir, 'money.txt')) ? fs.readFileSync(path.join(dir, 'money.txt'), 'utf8').trim() : '0';
console.log(JSON.stringify({ tables: { files: { rows, hash: h.digest('hex'), sums: { amount: money } } }, totals: { rows, money } }));
`);

/* ───────── مبدأ: سه سایت (shop، blog، و سایتِ اصلی)، سرورِ حساب، پمپ‌ها ───────── */
const S = path.join(tmp, 'S', 'data');
const S_SITES = path.join(tmp, 'S', 'sites');
fs.mkdirSync(S, { recursive: true });
makePanelDb(path.join(S, 'panel.db'), {
  sites: [
    { slug: 'shop', name: 'فروشگاه', root: path.join(S_SITES, 'shop'), port: 8150, domain: 'shop.example.com', autostart: true },
    { slug: 'blog', name: 'Blog', root: path.join(S_SITES, 'blog'), port: 8151 },
    { slug: 'mainsite', name: 'Main', root: path.join(S_SITES, 'mainsite'), port: 8152 },
  ],
  domains: [{ name: 'shop.example.com', slug: 'shop' }, { name: 'www.shop.example.com', slug: 'shop' }, { name: 'blog.example.com', slug: 'blog' }],
  settings: { main_site_id: 3, server_name: 'خانه' },
});
write(S_SITES, 'shop/server.js', 'require("http").createServer((q,s)=>s.end("shop")).listen(process.env.PORT)');
write(S_SITES, 'shop/public/logo.png', crypto.randomBytes(4000));
write(S_SITES, 'shop/upload.part', 'half');
write(S_SITES, 'blog/index.html', '<h1>blog</h1>');
write(S_SITES, 'mainsite/index.html', 'main');
write(S, 'sites/shop/config.json', JSON.stringify({ env: { A: '1' } }));
write(S, 'sites/shop/panel.key', 'p'.repeat(64));
sqliteFile(path.join(S, 'sites', 'shop', 'db', 'app.sqlite'), 37);
write(S, 'site-sync/sites/shop/token.txt', 'tenant-token-shop');
write(S, 'site-sync/sites/shop/main.json', JSON.stringify({ orders: [1, 2, 3] }));
write(S, 'sites/blog/config.json', '{}');
write(S, 'site-sync/sites/blog/token.txt', 'tenant-token-blog');
write(S, 'account-server/secrets.json', JSON.stringify({ apiSecret: 'S'.repeat(43) }));
write(S, 'account-server/pg/base/1/1259', crypto.randomBytes(50_000));
write(S, 'account-server/pg/money.txt', '987654');
write(S, 'stations/pump1/live.json', JSON.stringify({ litres: 4321 }));
sqliteFile(path.join(S, 'stations', 'pump1', 'ledger.db'), 12);
write(S, 'vault.key', crypto.randomBytes(32));

/* ───────── مقصد: پنلِ راه‌افتاده با سایتِ خودش، سرورِ حسابِ خودش ───────── */
function makeDest(name, { shopDomainOnOther = false } = {}) {
  const D = path.join(tmp, name, 'data');
  const DS = path.join(tmp, name, 'sites');
  fs.mkdirSync(D, { recursive: true });
  makePanelDb(path.join(D, 'panel.db'), {
    sites: [{ slug: 'other', name: 'Other', root: path.join(DS, 'other'), port: 8150 }],
    domains: [{ name: 'other.example.com', slug: 'other' }, ...(shopDomainOnOther ? [{ name: 'shop.example.com', slug: 'other' }] : [])],
    settings: { sites_root: DS, server_name: name },
  });
  write(DS, 'other/index.html', 'other');
  write(D, 'sites/other/config.json', '{"env":{}}');
  write(D, 'site-sync/sites/other/token.txt', 'tenant-token-other');
  write(D, 'account-server/secrets.json', JSON.stringify({ apiSecret: 'D'.repeat(43) }));
  write(D, 'account-server/pg/money.txt', '111');
  write(D, 'stations/pumpD/live.json', '{"litres":1}');
  return { D, DS };
}
const { D, DS } = makeDest('D');
const destTree = () => ({ data: tree(D), sites: tree(DS) });

try {
  console.log('── نامِ برنامه ──');
  check('site:<نامک>، نامکِ تنها، account-server، stations', parseOnly('site:shop').id === 'site:shop' && parseOnly('shop').slug === 'shop'
    && parseOnly('account-server').kind === 'account' && parseOnly('stations').kind === 'stations');
  let bad = null;
  try { parseOnly('../etc'); } catch (e) { bad = e.message; }
  check('⛔ نامِ بیرون‌زن (../) پذیرفته نیست', /ناشناخته/.test(bad || ''), bad);

  console.log('── export --only site:shop ──');
  const srcBefore = { data: tree(S), sites: tree(S_SITES) };
  const SHOP = path.join(tmp, 'shop.vmove');
  const ex = cli(['export', '--data', S, '--out', SHOP, '--only', 'site:shop']);
  check('ساخته شد (کدِ ۰)', ex.status === 0 && fs.existsSync(SHOP), ex.stdout + ex.stderr);
  check('مبدأ بایت‌به‌بایت همان ماند (حتی panel.db و WAL)', sameTree(srcBefore.data, tree(S)) && sameTree(srcBefore.sites, tree(S_SITES)), treeDiff(srcBefore.data, tree(S)));
  const ins = await inspectBundle({ file: SHOP, pass: PASS });
  const names = ins.manifest.files.map((f) => f.name);
  check('بسته سالم و «فقط site:shop»', ins.ok && ins.manifest.only === 'site:shop' && ins.manifest.panelDb === null, JSON.stringify(ins.bad));
  check('فقط پوشه‌های همان سایت: ریشه، فضای کاری، دفترِ سرورِ سایت', names.every((n) => /^data\/(site-root|sites\/shop|site-sync\/sites\/shop)\//.test(n))
    && names.includes('data/site-root/server.js') && names.includes('data/sites/shop/db/app.sqlite') && names.includes('data/site-sync/sites/shop/main.json'), names.join(' '));
  check('⛔ نه سایتِ دیگر، نه panel.db، نه سرورِ حساب، نه پمپ، نه کلیدِ گاوصندوق', !names.some((n) => /blog|mainsite|panel\.db|account-server|stations|vault/.test(n)));
  check('نیمه‌نوشته (*.part) نرفت', !names.some((n) => n.endsWith('.part')) && ins.manifest.excluded.some((x) => x.endsWith('upload.part')));
  check('شمارِ ردیفِ دیتابیسِ SQLite ِ سایت در مانیفست (۳۷ سفارش، ۱ یادداشت)', ins.manifest.sqlite?.['data/sites/shop/db/app.sqlite']?.orders === 37
    && ins.manifest.sqlite['data/sites/shop/db/app.sqlite'].notes === 1, JSON.stringify(ins.manifest.sqlite));
  check('ردیفِ سایت و هر دو دامنه در مانیفست', ins.manifest.app?.name === 'فروشگاه' && ins.manifest.app.port === 8150
    && ins.manifest.app.domains.join(',') === 'shop.example.com,www.shop.example.com' && ins.manifest.app.autostart === true, JSON.stringify(ins.manifest.app));
  check('⛔ بسته رمزشده است (نامِ فایل‌ها و توکن در بایت‌های خام نیست)', !fs.readFileSync(SHOP).includes(Buffer.from('tenant-token-shop'))
    && !fs.readFileSync(SHOP).includes(Buffer.from('server.js')));

  const mainSite = cli(['export', '--data', S, '--out', path.join(tmp, 'main.vmove'), '--only', 'site:mainsite']);
  check('⛔ سایتِ اصلی (دفترِ اصلیِ سرورِ سایت) جدا نمی‌رود', mainSite.status === 1 && /سایتِ اصلی/.test(mainSite.stderr), mainSite.stderr);
  const nope = cli(['export', '--data', S, '--out', path.join(tmp, 'n.vmove'), '--only', 'site:nothere']);
  check('⛔ سایتِ ناموجود ⇒ کدِ ۱', nope.status === 1 && /نیست/.test(nope.stderr), nope.stderr);
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], { stdio: 'ignore' });
  fs.writeFileSync(path.join(S, 'panel.pid'), String(sleeper.pid));
  const hot = cli(['export', '--data', S, '--out', path.join(tmp, 'hot.vmove'), '--only', 'site:shop']);
  check('⛔ پنلِ مبدأ روشن ⇒ export نمی‌کند', hot.status === 1 && /پنل روشن است/.test(hot.stderr), hot.stderr);
  const hotPump = cli(['export', '--data', S, '--out', path.join(tmp, 'hotp.vmove'), '--only', 'stations', '--force']);
  check('⛔ پمپ‌ها با پنلِ روشن (حتی با ‎--force‎) نه — فقط با پنلِ بسته', hotPump.status === 1 && /فقط با پنلِ بسته/.test(hotPump.stderr), hotPump.stderr);
  sleeper.kill();
  await new Promise((r) => sleeper.once('exit', r));
  fs.rmSync(path.join(S, 'panel.pid'));

  console.log('── import: رمزِ غلط، بستهٔ دست‌خورده، بستهٔ کامل ⇒ هیچ تغییر ──');
  const d0 = destTree();
  const wrong = cli(['import', SHOP, '--data', D, '--only'], { VILL3N_MOVE_PASSPHRASE: 'wrong pass phrase 99' });
  check('⛔ رمزِ غلط ⇒ کدِ ۱', wrong.status === 1 && /رمز نادرست|دست خورده/.test(wrong.stderr), wrong.stderr);
  check('… مقصد بایت‌به‌بایت همان (پنل، سایت‌ها، سرورِ حساب) و پوشهٔ موقتی نماند', sameTree(d0.data, tree(D)) && sameTree(d0.sites, tree(DS))
    && !fs.readdirSync(D).some((n) => n.startsWith('.vmove-')), treeDiff(d0.data, tree(D)));
  const TAMPER = path.join(tmp, 'tampered.vmove');
  const buf = fs.readFileSync(SHOP);
  buf[Math.floor(buf.length / 2)] ^= 0x40;
  fs.writeFileSync(TAMPER, buf);
  const tam = cli(['import', TAMPER, '--data', D, '--only']);
  check('⛔ بستهٔ دست‌خورده (یک بیت) ⇒ کدِ ۱', tam.status === 1 && /دست خورده|نادرست/.test(tam.stderr), tam.stderr);
  check('… مقصد بایت‌به‌بایت همان', sameTree(d0.data, tree(D)) && sameTree(d0.sites, tree(DS)) && !fs.readdirSync(D).some((n) => n.startsWith('.vmove-')), treeDiff(d0.data, tree(D)));
  const FULL = path.join(tmp, 'full.vmove');
  const exFull = cli(['export', '--data', S, '--out', FULL]);
  const fullOnly = cli(['import', FULL, '--data', D, '--only']);
  check('⛔ بستهٔ کامل با ‎--only‎ ⇒ رد، مقصد همان', exFull.status === 0 && fullOnly.status === 1 && /بستهٔ کامل/.test(fullOnly.stderr)
    && sameTree(d0.data, tree(D)), fullOnly.stderr + exFull.stderr);
  const wrongApp = cli(['import', SHOP, '--data', D, '--only', 'site:blog']);
  check('⛔ ‎--only site:blog‎ برای بستهٔ shop ⇒ رد', wrongApp.status === 1 && /نه «site:blog»/.test(wrongApp.stderr) && sameTree(d0.data, tree(D)), wrongApp.stderr);
  const emptyDir = path.join(tmp, 'empty');
  fs.mkdirSync(emptyDir);
  let fullErr = '';
  try { await importData({ file: SHOP, dataDir: emptyDir, pass: PASS }); } catch (e) { fullErr = e.message; }
  check('⛔ بستهٔ «فقط یک برنامه» بی ‎--only‎ (جابه‌جاییِ کامل) ⇒ رد، پوشه خالی ماند', /import --only/.test(fullErr) && fs.readdirSync(emptyDir).length === 0, fullErr);

  console.log('── import --only site:shop ──');
  const dOtherBefore = { site: tree(path.join(DS, 'other')), ws: tree(path.join(D, 'sites', 'other')), store: tree(path.join(D, 'site-sync', 'sites', 'other')),
    acct: tree(path.join(D, 'account-server')), pumps: tree(path.join(D, 'stations')) };
  const otherRow0 = JSON.stringify(rows(path.join(D, 'panel.db'), "SELECT * FROM sites WHERE slug = 'other'"));
  const im = cli(['import', SHOP, '--data', D, '--only', 'site:shop']);
  check('import (کدِ ۰) و «پس از جای‌نشستن همان بسته»', im.status === 0 && /همان بسته است/.test(im.stdout), im.stdout + im.stderr);
  const row = rows(path.join(D, 'panel.db'), "SELECT * FROM sites WHERE slug = 'shop'")[0];
  check('ردیفِ سایت در مقصد: نام، گونه، فرمان، اجرای خودکار', row && row.name === 'فروشگاه' && row.kind === 'node' && row.start_command === 'node server.js' && row.autostart === 1 && row.enabled === 1, JSON.stringify(row));
  check('⛔ پورتِ ۸۱۵۰ مالِ سایتِ دیگرِ مقصد بود ⇒ پورتِ آزادِ تازه', row && row.port !== 8150 && row.port >= 8100, String(row?.port));
  check('ریشهٔ سایت زیرِ «ریشهٔ سایت‌ها» ِ مقصد', row?.root_path === path.join(DS, 'shop') && fs.existsSync(path.join(DS, 'shop', 'server.js')), row?.root_path);
  const doms = rows(path.join(D, 'panel.db'), 'SELECT d.name FROM domains d JOIN sites s ON s.id = d.site_id WHERE s.slug = ? ORDER BY d.name', 'shop').map((r) => r.name);
  check('هر دو دامنه به سایت وصل شدند', doms.join(',') === 'shop.example.com,www.shop.example.com', doms.join(','));
  const srcShop = { root: tree(path.join(S_SITES, 'shop')), ws: tree(path.join(S, 'sites', 'shop')), store: tree(path.join(S, 'site-sync', 'sites', 'shop')) };
  delete srcShop.root['upload.part'];
  check('دادهٔ سایت در مقصد همان هش (ریشه، فضای کاری با SQLite، دفترِ سرورِ سایت)', sameTree(srcShop.root, tree(path.join(DS, 'shop')))
    && sameTree(srcShop.ws, tree(path.join(D, 'sites', 'shop'))) && sameTree(srcShop.store, tree(path.join(D, 'site-sync', 'sites', 'shop'))), treeDiff(srcShop.ws, tree(path.join(D, 'sites', 'shop'))));
  const cnt = rows(path.join(D, 'sites', 'shop', 'db', 'app.sqlite'), 'SELECT COUNT(*) AS n FROM orders')[0].n;
  check('دیتابیسِ سایت در مقصد باز می‌شود: ۳۷ سفارش', cnt === 37, String(cnt));
  check('⛔ دادهٔ برنامه‌های دیگرِ مقصد دست‌نخورده: سایتِ other (ریشه، فضای کاری، دفتر)، سرورِ حساب، پمپ‌ها',
    sameTree(dOtherBefore.site, tree(path.join(DS, 'other'))) && sameTree(dOtherBefore.ws, tree(path.join(D, 'sites', 'other')))
    && sameTree(dOtherBefore.store, tree(path.join(D, 'site-sync', 'sites', 'other'))) && sameTree(dOtherBefore.acct, tree(path.join(D, 'account-server')))
    && sameTree(dOtherBefore.pumps, tree(path.join(D, 'stations'))));
  check('… و ردیفِ سایتِ other در دیتابیسِ مقصد همان', JSON.stringify(rows(path.join(D, 'panel.db'), "SELECT * FROM sites WHERE slug = 'other'")) === otherRow0);
  check('… و پوشهٔ موقت نماند', !fs.readdirSync(D).some((n) => n.startsWith('.vmove-importing-')));

  console.log('── دوباره همان سایت: بی ‎--force‎ رد، با ‎--force‎ کنار (پاک نه) ──');
  const d1 = { s: destState(D), sites: tree(DS) };
  const again = cli(['import', SHOP, '--data', D, '--only']);
  check('⛔ سایتِ هم‌نام ⇒ کدِ ۱ و هیچ تغییر (پوشه‌ها و ردیف‌های دیتابیس)', again.status === 1 && /از پیش/.test(again.stderr) && sameState(d1.s, destState(D)) && sameTree(d1.sites, tree(DS)), again.stderr);
  fs.writeFileSync(path.join(DS, 'shop', 'changed-on-D.txt'), 'نوشتهٔ مقصد');
  const forced = cli(['import', SHOP, '--data', D, '--only', '--force']);
  const asideRoot = path.join(D, '.vmove-aside');
  const asides = fs.existsSync(asideRoot) ? fs.readdirSync(asideRoot) : [];
  const asideDir = asides.length ? path.join(asideRoot, asides[0]) : '';
  check('با ‎--force‎ وارد شد', forced.status === 0, forced.stdout + forced.stderr);
  check('… نسخهٔ پیشینِ مقصد (با نوشتهٔ تازه‌اش) کنار رفت، پاک نشد', Boolean(asideDir) && fs.existsSync(path.join(asideDir, 'root', 'changed-on-D.txt'))
    && fs.existsSync(path.join(asideDir, 'workspace', 'db', 'app.sqlite')) && fs.existsSync(path.join(asideDir, 'aside.json')), asides.join(','));
  check('… و جای سایت دوباره همان بسته است', sameTree(srcShop.root, tree(path.join(DS, 'shop'))), treeDiff(srcShop.root, tree(path.join(DS, 'shop'))));
  check('… یک ردیف (نه دو)', rows(path.join(D, 'panel.db'), "SELECT COUNT(*) AS n FROM sites WHERE slug = 'shop'")[0].n === 1);

  const { D: D2, DS: DS2 } = makeDest('D2', { shopDomainOnOther: true });
  const d2 = { s: destState(D2), sites: tree(DS2) };
  const dom = cli(['import', SHOP, '--data', D2, '--only']);
  check('⛔ دامنهٔ shop.example.com روی مقصد مالِ سایتِ دیگر ⇒ رد و هیچ تغییر', dom.status === 1 && /مالِ سایتِ «other»/.test(dom.stderr)
    && sameState(d2.s, destState(D2)) && sameTree(d2.sites, tree(DS2)), dom.stderr);

  console.log('── سرورِ حساب: همیشه کامل، با تطبیقِ move-db ──');
  const ACCT = path.join(tmp, 'acct.vmove');
  const exA = cli(['export', '--data', S, '--out', ACCT, '--only', 'account-server', '--account-tool', TOOL]);
  check('export ‎--only account-server‎', exA.status === 0 && /شمرده و هش شد/.test(exA.stdout), exA.stdout + exA.stderr);
  const insA = await inspectBundle({ file: ACCT, pass: PASS });
  check('فقط ‎account-server/‎ (کلِ پوشه: رازها و pg)', insA.manifest.files.every((f) => f.name.startsWith('data/account-server/'))
    && insA.manifest.files.some((f) => f.name === 'data/account-server/secrets.json') && insA.manifest.files.some((f) => f.name === 'data/account-server/pg/money.txt'));
  const { D: D3, DS: DS3 } = makeDest('D3');
  const d3Sites = { root: tree(DS3), ws: tree(path.join(D3, 'sites')), sync: tree(path.join(D3, 'site-sync')), pumps: tree(path.join(D3, 'stations')) };
  const d3Acct = tree(path.join(D3, 'account-server'));
  const tamA = Buffer.from(fs.readFileSync(ACCT));
  tamA[tamA.length - 40] ^= 1;
  fs.writeFileSync(path.join(tmp, 'acct-t.vmove'), tamA);
  const d3all = tree(D3);
  const tA = cli(['import', path.join(tmp, 'acct-t.vmove'), '--data', D3, '--only', '--account-tool', TOOL]);
  check('⛔ بستهٔ دست‌خوردهٔ سرورِ حساب ⇒ رد و مقصد بایت‌به‌بایت همان', tA.status === 1 && sameTree(d3all, tree(D3)), tA.stderr);
  const imA = cli(['import', ACCT, '--data', D3, '--only', 'account-server', '--account-tool', TOOL]);
  check('import ‎--only account-server‎: شمار، هش و جمعِ مبلغ همان مبدأ', imA.status === 0 && /همان مبدأ ✅/.test(imA.stdout), imA.stdout + imA.stderr);
  check('… سرورِ حسابِ مقصد همان مبدأ است (هش)', sameTree(tree(path.join(S, 'account-server')), tree(path.join(D3, 'account-server'))));
  const asideA = fs.readdirSync(path.join(D3, '.vmove-aside')).map((n) => path.join(D3, '.vmove-aside', n));
  check('… سرورِ حسابِ پیشینِ مقصد کنار رفت، پاک نشد (همان هش)', asideA.some((p) => sameTree(d3Acct, tree(path.join(p, 'account-server')))), asideA.join(','));
  check('⛔ … سایت‌ها و پمپ‌های مقصد دست‌نخورده', sameTree(d3Sites.root, tree(DS3)) && sameTree(d3Sites.ws, tree(path.join(D3, 'sites')))
    && sameTree(d3Sites.sync, tree(path.join(D3, 'site-sync'))) && sameTree(d3Sites.pumps, tree(path.join(D3, 'stations'))));
  const sleeperD = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], { stdio: 'ignore' });
  fs.writeFileSync(path.join(D3, 'panel.pid'), String(sleeperD.pid));
  const hotD = cli(['import', ACCT, '--data', D3, '--only', '--account-tool', TOOL]);
  check('⛔ پنلِ مقصد روشن ⇒ import ‎--only‎ نمی‌کند', hotD.status === 1 && /روشن است/.test(hotD.stderr), hotD.stderr);
  sleeperD.kill();
  await new Promise((r) => sleeperD.once('exit', r));
  fs.rmSync(path.join(D3, 'panel.pid'));

  console.log('── پمپ‌ها: فقط با پنلِ بسته ──');
  const PUMP = path.join(tmp, 'pump.vmove');
  const exP = cli(['export', '--data', S, '--out', PUMP, '--only', 'stations']);
  const insP = exP.status === 0 ? await inspectBundle({ file: PUMP, pass: PASS }) : null;
  check('export ‎--only stations‎ با پنلِ بسته: فقط ‎stations/‎ و شمارِ ردیفِ دفترِ پمپ', exP.status === 0 && insP.manifest.files.every((f) => f.name.startsWith('data/stations/'))
    && insP.manifest.sqlite?.['data/stations/pump1/ledger.db']?.orders === 12, exP.stdout + exP.stderr);
  const imP = cli(['import', PUMP, '--data', D3, '--only', 'stations']);
  check('import ‎--only stations‎ ⇒ همان هش؛ پمپ‌های پیشینِ مقصد کنار', imP.status === 0 && sameTree(tree(path.join(S, 'stations')), tree(path.join(D3, 'stations')))
    && fs.readdirSync(path.join(D3, '.vmove-aside')).some((n) => fs.existsSync(path.join(D3, '.vmove-aside', n, 'stations', 'pumpD', 'live.json'))), imP.stdout + imP.stderr);
} catch (e) {
  check('بی خطای پیش‌بینی‌نشده', false, e.stack);
} finally {
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failed ? '❌' : '✅'} فقط یک برنامه (--only): ${passed} سبز، ${failed} قرمز`);
process.exit(failed ? 1 : 0);
