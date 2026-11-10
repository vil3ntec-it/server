// ---------------------------------------------------------------------------
//  آزمونِ «پوشهٔ داده ‎700‎ و ‎panel.db‎ ‎600‎ روی لینوکس» (۱.۵۰.۸۵)
//      node test/data-perms.mjs
//
//  یافته (تصمیمِ ۱.۵۰.۸۴ ⇐ ساخته در ۱.۵۰.۸۵): پوشهٔ داده و `panel.db` با umask ِ
//  پیش‌فرض ساخته می‌شدند (۷۵۵/۶۴۴) ⇒ هر کاربرِ دیگرِ همان لینوکس پایگاهِ پنل را — درهمِ
//  رمزها، نشست‌ها، رازِ امضای نشست (`jwt_secret` وقتی ‎HLP_SECRET_KEY‎ نیست)، دفتر —
//  می‌خواند. رازهای تکی خودشان ۶۰۰ بودند (`vault.key`، `local-admin.key`).
//  حالا پنل پوشه را ‎700‎ و پایگاه را ‎600‎ می‌سازد و نصبِ موجود را در هر بالا آمدن **تنگ**
//  می‌کند — هرگز گشادتر (۵۰۰/۴۰۰ همان می‌ماند)؛ روی ویندوز دست نمی‌زند (ACL ِ پوشهٔ کاربر).
//
//  ۱) قاعدهٔ خالص (`src/lib/data-perms.js`)
//  ۲) پنلِ واقعی: نصبِ تازه، و نصبِ کهنهٔ ۷۵۵/۶۴۴ که با بالا آمدن تنگ می‌شود
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = path.join(import.meta.dirname, '..', 'src');
let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`); }
};
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-data-perms-'));
fs.chmodSync(tmp, 0o755);
const mode = (f) => { try { return (fs.statSync(f).mode & 0o777).toString(8); } catch { return 'نیست'; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

if (process.platform === 'win32') {
  console.log('  ⏭️  ویندوز: پنل به دسترسیِ پرونده دست نمی‌زند (ACL ِ پوشهٔ کاربر) — این آزمون مالِ لینوکس/مک است');
  process.exit(0);
}

/* ─────────────────────── ۱) قاعدهٔ خالص ─────────────────────── */
console.log('── ۱) tightenDataPerms — خالص ──');
let mod = null;
try {
  mod = await import(pathToFileURL(path.join(SRC, 'lib', 'data-perms.js')).href);
} catch (e) {
  check('ماژولِ src/lib/data-perms.js هست', false, e.message);
}
if (mod) {
  const umask = process.umask(0o022);
  try {
    const fresh = path.join(tmp, 'pure-fresh', 'data');
    const db = path.join(fresh, 'panel.db');
    mod.tightenDataPerms({ dataDir: fresh, dbFile: db });
    check('نصبِ تازه: پوشهٔ داده ‎700‎', mode(fresh) === '700', mode(fresh));
    check('نصبِ تازه: panel.db پیش از SQLite با ‎600‎ ساخته شد (و خالی — SQLite همان را پایگاه می‌کند)',
      mode(db) === '600' && fs.statSync(db).size === 0, mode(db));

    const old = path.join(tmp, 'pure-old');
    fs.mkdirSync(old, { mode: 0o755 });
    fs.chmodSync(old, 0o775);
    const odb = path.join(old, 'panel.db');
    fs.writeFileSync(odb, 'x');
    fs.chmodSync(odb, 0o664);
    fs.writeFileSync(`${odb}-wal`, '');
    fs.chmodSync(`${odb}-wal`, 0o644);
    fs.writeFileSync(`${odb}-shm`, '');
    fs.chmodSync(`${odb}-shm`, 0o666);
    const r = mod.tightenDataPerms({ dataDir: old, dbFile: odb });
    check('نصبِ کهنه: ‎775 ⇒ 700‎', mode(old) === '700', mode(old));
    check('نصبِ کهنه: panel.db ‎664 ⇒ 600‎ و WAL/SHM هم', mode(odb) === '600' && mode(`${odb}-wal`) === '600' && mode(`${odb}-shm`) === '600',
      [mode(odb), mode(`${odb}-wal`), mode(`${odb}-shm`)].join(','));
    check('گزارش می‌گوید چه تنگ شد (بی رازی)', Array.isArray(r?.tightened) && r.tightened.length === 4, JSON.stringify(r));
    check('محتوای پایگاه دست نخورد', fs.readFileSync(odb, 'utf8') === 'x');

    const strict = path.join(tmp, 'pure-strict');
    fs.mkdirSync(strict);
    fs.chmodSync(strict, 0o500);
    const sdb = path.join(strict, 'panel.db');
    fs.chmodSync(strict, 0o700);
    fs.writeFileSync(sdb, 'y');
    fs.chmodSync(sdb, 0o400);
    fs.chmodSync(strict, 0o500);
    const r2 = mod.tightenDataPerms({ dataDir: strict, dbFile: sdb });
    check('⛔ هرگز گشادتر: ‎500‎ و ‎400‎ همان می‌مانند', mode(strict) === '500' && mode(sdb) === '400', `${mode(strict)} ${mode(sdb)}`);
    check('…و چیزی «تنگ» گزارش نشد', Array.isArray(r2?.tightened) && r2.tightened.length === 0, JSON.stringify(r2));
    fs.chmodSync(strict, 0o700);

    const exe = path.join(tmp, 'pure-exe');
    fs.mkdirSync(exe);
    const edb = path.join(exe, 'panel.db');
    fs.writeFileSync(edb, 'z');
    fs.chmodSync(edb, 0o755);
    mod.tightenDataPerms({ dataDir: exe, dbFile: edb });
    check('پایگاهِ اجرایی ‎755 ⇒ 600‎ (بیتِ اجرا هم نه)', mode(edb) === '600', mode(edb));

    const win = path.join(tmp, 'pure-win');
    fs.mkdirSync(win);
    fs.chmodSync(win, 0o755);
    const wr = mod.tightenDataPerms({ dataDir: win, dbFile: path.join(win, 'panel.db'), platform: 'win32' });
    check('ویندوز: هیچ دست‌زدنی (نه chmod، نه ساختنِ پایگاه)', wr?.skipped === true && mode(win) === '755' && !fs.existsSync(path.join(win, 'panel.db')), JSON.stringify(wr));
  } finally {
    process.umask(umask);
  }
}

/* ─────────────── ۲) پنلِ واقعی: تازه، و نصبِ کهنه ─────────────── */
console.log('\n── ۲) پنلِ واقعی ──');
const PASS = 'Perm-Test-2026!x';
/** ‎adminEnvPass‎ فقط بارِ اول مدیر می‌سازد (نصبِ موجود دست نمی‌خورد) */
function runPanel(dataDir, port, adminEnvPass = PASS) {
  return new Promise((resolve) => {
    fs.mkdirSync(path.join(tmp, `sites-${port}`), { recursive: true });
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(SRC, 'index.js')], {
      env: {
        ...process.env, HLP_DEPLOY: 'home', HLP_PORT: String(port), HLP_SITESYNC_PORT: String(port + 1), HLP_HOST: '127.0.0.1',
        HLP_DATA_DIR: dataDir, HLP_SITES_ROOT: path.join(tmp, `sites-${port}`),
        HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_SITESYNC: '0', HLP_DISCOVERY: '0', HLP_ACCOUNT_API: '0',
        HLP_ADMIN_USER: 'admin', HLP_ADMIN_PASSWORD: adminEnvPass,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    (async () => {
      let up = false;
      for (const end = Date.now() + 30000; Date.now() < end;) {
        try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) { up = true; break; } } catch { /* هنوز */ }
        await wait(200);
      }
      //  یک ورود (نوشتنِ نشست ⇒ WAL ساخته می‌شود) — و نشانِ سالم ماندنِ دادهٔ نصب
      let login = false;
      if (up) {
        const r = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: PASS }),
        }).then((x) => x.json(), () => ({}));
        login = Boolean(r?.token);
      }
      await wait(300);
      const snap = { up, login, dir: mode(dataDir), db: mode(path.join(dataDir, 'panel.db')), wal: mode(path.join(dataDir, 'panel.db-wal')), shm: mode(path.join(dataDir, 'panel.db-shm')), out };
      child.kill('SIGTERM');
      child.on('exit', () => resolve(snap));
      setTimeout(() => resolve(snap), 5000);
    })();
  });
}
const PORT = Number(process.env.TEST_PORT || 4896);
const umask = process.umask(0o022);
try {
  const fresh = path.join(tmp, 'fresh-data');
  const a = await runPanel(fresh, PORT);
  check('پنل بالا آمد (نصبِ تازه)', a.up, a.out.slice(-600));
  check('⛔ نصبِ تازه: پوشهٔ داده ‎700‎ (نه ‎755‎ ِ umask)', a.dir === '700', a.dir);
  check('⛔ نصبِ تازه: panel.db ‎600‎ (نه ‎644‎)', a.db === '600', a.db);
  check('WAL/SHM ِ SQLite همان دسترسیِ پایگاه را گرفتند', a.wal === '600' && a.shm === '600', `${a.wal} ${a.shm}`);

  const old = path.join(tmp, 'old-data');
  const b0 = await runPanel(old, PORT + 10);
  fs.chmodSync(old, 0o755);
  for (const f of ['panel.db', 'panel.db-wal', 'panel.db-shm']) { try { fs.chmodSync(path.join(old, f), 0o644); } catch { /* نیست */ } }
  //  بارِ دوم بی مدیرِ محیط: ورودِ موفق یعنی همان پایگاهِ کهنه سالم خوانده شد، نه پایگاهِ تازه
  const b = await runPanel(old, PORT + 20, '');
  check('پنل بالا آمد (نصبِ کهنهٔ ۷۵۵/۶۴۴)', b0.up && b.up, b.out.slice(-600));
  check('⛔ نصبِ کهنه با بالا آمدن تنگ شد: پوشه ‎700‎، panel.db ‎600‎', b.dir === '700' && b.db === '600', `${b.dir} ${b.db}`);
  check('و دادهٔ نصب سالم ماند (همان مدیرِ بارِ اول وارد می‌شود)', b0.login && b.login, `${b0.login} ${b.login}`);
} finally {
  process.umask(umask);
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failed ? '❌' : '✅'} data-perms: ${passed} درست، ${failed} نادرست`);
process.exit(failed ? 1 : 0);
