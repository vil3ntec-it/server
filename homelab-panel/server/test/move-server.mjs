// ---------------------------------------------------------------------------
//  آزمونِ جابه‌جاییِ داده — scripts/move-server.mjs
//      node test/move-server.mjs
//
//  پوشهٔ دادهٔ ساختگی ولی با شکلِ واقعی (panel.db با جدول و نشانیِ ویندوزی،
//  سرورِ حساب: pg + secrets.json + پشتیبانِ ابریِ مشتری، پمپ‌ها، کلیدِ گاوصندوق)
//  ⇒ export ⇒ inspect ⇒ import ⇒ compare؛ و هر راهِ خرابی:
//  رمزِ غلط، بستهٔ دست‌خورده، مقصدِ پر، پنلِ روشن، و تطبیقِ سرورِ حساب که نخواند.
// ---------------------------------------------------------------------------
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  exportData, importData, inspectBundle, compareData, remapPath, sameAccountReport, EXCLUDES,
} from '../scripts/move-server.mjs';

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 400) : ''}`); }
};
const rejects = async (fn, re) => { try { await fn(); return { ok: false, msg: 'رد نشد' }; } catch (e) { return { ok: re.test(e.message), msg: e.message }; } };

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-move-'));
const SRC = path.join(tmp, 'home-data');
const PASS = 'correct horse battery staple';
const OLD_ROOT = 'C:\\Users\\Owner\\VILL3N\\data';

/* ─────────────────── پوشهٔ دادهٔ «خانه» با شکلِ واقعی ─────────────────── */
function write(rel, data) {
  const p = path.join(SRC, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
}
fs.mkdirSync(SRC, { recursive: true });
{
  const db = new DatabaseSync(path.join(SRC, 'panel.db'));
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
  db.exec('CREATE TABLE sites (id INTEGER PRIMARY KEY, slug TEXT, root_path TEXT NOT NULL UNIQUE)');
  db.exec('CREATE TABLE events (id INTEGER PRIMARY KEY, msg TEXT)');
  const ins = db.prepare('INSERT INTO settings(key, value) VALUES(?, ?)');
  ins.run('server_name', JSON.stringify('خانه'));
  ins.run('sites_root', JSON.stringify(path.join(SRC, 'websites')));
  ins.run('scan_roots', JSON.stringify([path.join(SRC, 'websites'), 'D:\\Other\\projects']));
  ins.run('cc_storage_root', JSON.stringify('E:\\Library'));
  db.prepare('INSERT INTO sites(slug, root_path) VALUES(?, ?)').run('pump', path.join(SRC, 'websites', 'pump'));
  db.prepare('INSERT INTO sites(slug, root_path) VALUES(?, ?)').run('ext', 'D:\\Other\\site');
  const ev = db.prepare('INSERT INTO events(msg) VALUES(?)');
  for (let i = 0; i < 500; i++) ev.run(`رویداد ${i}`);
  db.close(); // WAL پس از بستن هم می‌ماند اگر checkpoint نشود — VACUUM INTO همان را می‌گیرد
}
write('vault.key', crypto.randomBytes(32));
write('local-admin.key', 'k'.repeat(48));
write('push-keys.json', JSON.stringify({ publicKey: 'pub', privateKey: 'priv' }));
write('account-server/secrets.json', JSON.stringify({ apiSecret: 'A'.repeat(43), otpSecret: 'O'.repeat(43), jwtSecret: 'J'.repeat(43), adminUser: 'admin', adminPassword: 'Pxyz' }));
write('account-server/pg/base/1/1259', crypto.randomBytes(200_000)); //  فایلِ دیتابیسِ PGlite (دودویی)
write('account-server/pg/PG_VERSION', '17\n');
write('account-server/backups/accounts/pump/t1/cloud-1.bin', crypto.randomBytes(5000)); //  پشتیبانِ ابریِ مشتری
write('stations/pump1/live.json', JSON.stringify({ litres: 1234 }));
write('support-media/a.jpg', crypto.randomBytes(3000));
write('uploads/logo.png', crypto.randomBytes(900));
write('empty.txt', '');
//  آن‌چه نباید برود
write('cloudflared/cert.json', '{"secret":"tunnel"}');
write('logs/panel.log', 'x');
write('bin/cloudflared.exe', 'MZ');
write('backups/panel-old.db', 'old');
write('pump-updates/1.0/app.zip', 'zip');
write('panel.db-wal', 'stale');
write('.vmove-before-2026/panel.db', 'old import');

//  ابزارِ تطبیقِ ساختگیِ سرورِ حساب — همان قراردادِ ‎move-db.js inspect --json‎:
//  شمار و «هش» از روی فایل‌های پوشهٔ pg، و جمعِ مبلغ از یک فایلِ متنی.
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
write('account-server/pg/money.txt', '12345678');

try {
  console.log('── قاعده‌های خالص ──');
  check('نشانیِ ویندوزیِ زیرِ پوشهٔ داده ⇒ پوشهٔ تازه', remapPath(`${OLD_ROOT}\\websites\\pump`, OLD_ROOT, '/data') === path.join('/data', 'websites', 'pump'));
  check('حروفِ بزرگ/کوچکِ ویندوز فرق نمی‌کند', remapPath('c:\\users\\owner\\vill3n\\DATA\\x', OLD_ROOT, '/data') === path.join('/data', 'x'));
  check('نشانیِ بیرون از پوشهٔ داده دست نمی‌خورد', remapPath('D:\\Other\\site', OLD_ROOT, '/data') === 'D:\\Other\\site');
  check('پیشوندِ هم‌نام (data2) پوشهٔ داده نیست', remapPath(`${OLD_ROOT}2\\x`, OLD_ROOT, '/data') === `${OLD_ROOT}2\\x`);
  check('نشانیِ لینوکسی هم', remapPath('/srv/vill3n/data/core/websites', '/srv/vill3n/data/core', '/data') === path.join('/data', 'websites'));
  check('مقایسهٔ گزارشِ سرورِ حساب: جمعِ مبلغِ متفاوت دیده می‌شود',
    !sameAccountReport({ tables: { p: { rows: 1, hash: 'a', sums: { amount: '10' } } } }, { tables: { p: { rows: 1, hash: 'a', sums: { amount: '11' } } } }).same);
  check('پیوندها و فایل‌های پروسه کنار می‌مانند', EXCLUDES.some((x) => x.match('panel.pid')) && EXCLUDES.some((x) => x.match('cloudflared/cert.json')));

  console.log('── export ──');
  const before = fs.readdirSync(SRC).sort().join(',');
  const srcSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(SRC, 'account-server', 'pg', 'base', '1', '1259'))).digest('hex');
  const shortPass = await rejects(() => exportData({ dataDir: SRC, out: path.join(tmp, 'x.vmove'), pass: 'short', accountTool: TOOL }), /۱۲ نویسه/);
  check('رمزِ کوتاه پذیرفته نیست', shortPass.ok, shortPass.msg);

  //  پنلِ روشن ⇒ export نمی‌کند
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], { stdio: 'ignore' });
  fs.writeFileSync(path.join(SRC, 'panel.pid'), String(sleeper.pid));
  const hot = await rejects(() => exportData({ dataDir: SRC, out: path.join(tmp, 'hot.vmove'), pass: PASS, accountTool: TOOL }), /پنل روشن است/);
  check('پنلِ روشن (panel.pid زنده) ⇒ export نمی‌کند', hot.ok, hot.msg);
  sleeper.kill();
  await new Promise((r) => sleeper.once('exit', r));
  fs.rmSync(path.join(SRC, 'panel.pid')); //  همان کاری که خاموش‌سازیِ تمیزِ پنل می‌کند

  const BUNDLE = path.join(tmp, 'home.vmove');
  const ex = await exportData({ dataDir: SRC, out: BUNDLE, pass: PASS, accountTool: TOOL });
  const names = ex.manifest.files.map((f) => f.name);
  check('بسته ساخته شد', fs.existsSync(BUNDLE) && ex.manifest.files.length > 5);
  check('panel.db از عکسِ VACUUM INTO (نه فایلِ WAL)', names.includes('data/panel.db') && !names.includes('data/panel.db-wal'));
  check('شمارِ ردیفِ جدول‌های پنل در مانیفست', ex.manifest.panelDb.tables.events === 500 && ex.manifest.panelDb.tables.sites === 2);
  check('رازهای سرورِ حساب، دیتابیس، پشتیبانِ ابریِ مشتری، پمپ‌ها و کلیدِ گاوصندوق در بسته',
    ['data/account-server/secrets.json', 'data/account-server/pg/base/1/1259', 'data/account-server/backups/accounts/pump/t1/cloud-1.bin', 'data/stations/pump1/live.json', 'data/vault.key', 'data/push-keys.json', 'data/empty.txt'].every((n) => names.includes(n)));
  check('تونلِ خانه، لاگ، ابزارِ ویندوز، آینه، پشتیبانِ قدیمیِ پنل و import پیشین نمی‌روند',
    !names.some((n) => /cloudflared|logs\/|bin\/|pump-updates|data\/backups\/|\.vmove-|panel\.pid/.test(n)), names.join(' '));
  check('تطبیقِ سرورِ حساب پیش از انتقال انجام شد', ex.manifest.account.reconciled === true && ex.manifest.account.report.totals.money === '12345678');
  check('نشانی‌های بیرون از پوشهٔ داده گفته می‌شوند', ex.manifest.outside.some((o) => o.path === 'E:\\Library') && ex.manifest.outside.some((o) => o.path === 'D:\\Other\\projects'));
  check('پوشهٔ مبدأ دست نخورد (export فقط می‌خواند)', fs.readdirSync(SRC).sort().join(',') === before
    && crypto.createHash('sha256').update(fs.readFileSync(path.join(SRC, 'account-server', 'pg', 'base', '1', '1259'))).digest('hex') === srcSha);
  const raw = fs.readFileSync(BUNDLE);
  check('بسته رمزشده است (هیچ رازی به‌صورتِ متن در فایل نیست)', !raw.includes(Buffer.from('A'.repeat(43))) && !raw.includes(Buffer.from('رویداد')) && !raw.includes(Buffer.from('tunnel')));
  if (process.platform !== 'win32') check('بسته فقط برای صاحبش خواندنی (۶۰۰)', (fs.statSync(BUNDLE).mode & 0o777) === 0o600, (fs.statSync(BUNDLE).mode & 0o777).toString(8));

  console.log('── inspect ──');
  const ins = await inspectBundle({ file: BUNDLE, pass: PASS });
  check('inspect: همهٔ فایل‌ها با sha256 می‌خوانند', ins.ok && ins.bad.length === 0, JSON.stringify(ins.bad));
  const wrong = await rejects(() => inspectBundle({ file: BUNDLE, pass: 'not the right passphrase' }), /رمز نادرست|دست خورده/);
  check('رمزِ غلط ⇒ باز نمی‌شود', wrong.ok, wrong.msg);
  const TAMPER = path.join(tmp, 'tampered.vmove');
  const t = Buffer.from(raw);
  t[Math.floor(t.length / 2)] ^= 0x01;
  fs.writeFileSync(TAMPER, t);
  const tam = await rejects(() => inspectBundle({ file: TAMPER, pass: PASS }), /رمز نادرست|دست خورده|incorrect header|invalid/i);
  check('یک بیتِ دست‌خورده ⇒ رد', tam.ok, tam.msg);
  const TRUNC = path.join(tmp, 'trunc.vmove');
  fs.writeFileSync(TRUNC, raw.subarray(0, raw.length - 500));
  const tr = await rejects(() => inspectBundle({ file: TRUNC, pass: PASS }), /.+/);
  check('بستهٔ ناقص (نیمه‌دانلود) ⇒ رد', tr.ok, tr.msg);

  console.log('── import ──');
  const DEST = path.join(tmp, 'vps-data');
  const tamImp = await rejects(() => importData({ file: TAMPER, dataDir: DEST, pass: PASS, accountTool: TOOL }), /.+/);
  check('بستهٔ دست‌خورده ⇒ import رد و مقصد خالی ماند', tamImp.ok && (!fs.existsSync(DEST) || fs.readdirSync(DEST).length === 0), fs.existsSync(DEST) ? fs.readdirSync(DEST).join(',') : '');
  const imp = await importData({ file: BUNDLE, dataDir: DEST, pass: PASS, accountTool: TOOL, accountEnv: path.join(tmp, 'account.env') });
  check('import: همهٔ فایل‌ها باز و سنجیده شدند', imp.files === ex.manifest.files.length);
  check('import: سرورِ حساب پس از انتقال همان شمار/هش/مبلغ', imp.account.reconciled === true && imp.account.totals.money === '12345678', JSON.stringify(imp.account));
  check('فایلِ دودوییِ PGlite بایت‌به‌بایت همان', crypto.createHash('sha256').update(fs.readFileSync(path.join(DEST, 'account-server', 'pg', 'base', '1', '1259'))).digest('hex') === srcSha);
  const ndb = new DatabaseSync(path.join(DEST, 'panel.db'), { readOnly: true });
  const sitesRoot = JSON.parse(ndb.prepare("SELECT value FROM settings WHERE key='sites_root'").get().value);
  const pumpRoot = ndb.prepare("SELECT root_path FROM sites WHERE slug='pump'").get().root_path;
  const extRoot = ndb.prepare("SELECT root_path FROM sites WHERE slug='ext'").get().root_path;
  const scan = JSON.parse(ndb.prepare("SELECT value FROM settings WHERE key='scan_roots'").get().value);
  const events = ndb.prepare('SELECT COUNT(*) AS n FROM events').get().n;
  ndb.close();
  check('نشانیِ پوشهٔ داده در تنظیمات به پوشهٔ تازه برگشت', sitesRoot === path.join(DEST, 'websites'), sitesRoot);
  check('… و در ردیفِ سایت', pumpRoot === path.join(DEST, 'websites', 'pump'), pumpRoot);
  check('نشانیِ بیرونی دست نخورد (و گزارش شد)', extRoot === 'D:\\Other\\site' && scan[1] === 'D:\\Other\\projects');
  check('همهٔ ۵۰۰ رویداد آمد', events === 500);
  check('نشانیِ بیرونی دست نخورد حتی وقتی شبیهِ ویندوز است', extRoot === 'D:\\Other\\site');
  check(`${imp.remapped} نشانی برگشت (۳ مورد: sites_root، scan_roots[0]، ردیفِ سایت)`, imp.remapped === 3, String(imp.remapped));
  const envText = fs.readFileSync(path.join(tmp, 'account.env'), 'utf8');
  check('رازهای سرورِ حساب برای سرورِ جدا، همان مقدارها', envText.includes(`API_SECRET=${'A'.repeat(43)}`) && envText.includes('ADMIN_BOOTSTRAP_USER=admin'));
  if (process.platform !== 'win32') check('فایلِ رازها ۶۰۰', (fs.statSync(path.join(tmp, 'account.env')).mode & 0o777) === 0o600);
  check('پوشهٔ موقت پاک شد', !fs.readdirSync(DEST).some((n) => n.startsWith('.vmove-')));

  console.log('── compare و راهِ برگشت ──');
  const cmp = await compareData({ file: BUNDLE, dataDir: DEST, pass: PASS, accountTool: TOOL });
  check('compare: پوشهٔ تازه همان بسته است', cmp.same, cmp.diffs.join(' | '));
  fs.writeFileSync(path.join(DEST, 'account-server', 'pg', 'money.txt'), '12345677');
  const cmp2 = await compareData({ file: BUNDLE, dataDir: DEST, pass: PASS, accountTool: TOOL });
  check('compare: یک ریال کم ⇒ دیده می‌شود', !cmp2.same && cmp2.diffs.some((d) => d.includes('amount')), cmp2.diffs.join(' | '));
  const full = await rejects(() => importData({ file: BUNDLE, dataDir: DEST, pass: PASS, accountTool: TOOL }), /خالی نیست/);
  check('مقصدِ پر بی --force دست نمی‌خورد', full.ok, full.msg);
  const again = await importData({ file: BUNDLE, dataDir: DEST, pass: PASS, force: true, accountTool: TOOL });
  check('با --force: دادهٔ قبلی کنار رفت (نه پاک شد)', again.previous && fs.existsSync(path.join(again.previous, 'account-server', 'pg', 'money.txt'))
    && fs.readFileSync(path.join(again.previous, 'account-server', 'pg', 'money.txt'), 'utf8') === '12345677');
  check('… و دادهٔ تازه همان بسته', (await compareData({ file: BUNDLE, dataDir: DEST, pass: PASS, accountTool: TOOL })).same);

  console.log('── بی ابزارِ تطبیق: صادقانه ──');
  const NOTOOL = path.join(tmp, 'notool.vmove');
  const saved = process.env.HLP_ACCOUNT_DIR;
  delete process.env.HLP_ACCOUNT_DIR;
  const ex2 = await exportData({ dataDir: SRC, out: NOTOOL, pass: PASS, accountTool: path.join(tmp, 'nope.js') });
  if (saved !== undefined) process.env.HLP_ACCOUNT_DIR = saved;
  check('بی move-db.js ⇒ «سنجیده نشد» با دلیل، نه سبزِ ساختگی', ex2.manifest.account.reconciled === false && /پیدا نشد/.test(ex2.manifest.account.reason), JSON.stringify(ex2.manifest.account));

  console.log('── خطِ فرمان ──');
  const cli = spawnSync(process.execPath, [path.join(import.meta.dirname, '..', 'scripts', 'move-server.mjs'), 'inspect', BUNDLE], {
    env: { ...process.env, VILL3N_MOVE_PASSPHRASE: PASS }, encoding: 'utf8',
  });
  check('node scripts/move-server.mjs inspect ⇒ کدِ ۰ و خلاصه', cli.status === 0 && cli.stdout.includes('✅') && cli.stdout.includes('events=500'), cli.stdout + cli.stderr);
  const cliBad = spawnSync(process.execPath, [path.join(import.meta.dirname, '..', 'scripts', 'move-server.mjs'), 'inspect', TAMPER], {
    env: { ...process.env, VILL3N_MOVE_PASSPHRASE: PASS }, encoding: 'utf8',
  });
  check('… بستهٔ دست‌خورده ⇒ کدِ غیرِ صفر', cliBad.status !== 0, cliBad.stdout + cliBad.stderr);
} finally {
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failed ? '❌' : '✅'} جابه‌جاییِ داده: ${passed} درست، ${failed} نادرست`);
process.exit(failed ? 1 : 0);
