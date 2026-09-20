// ---------------------------------------------------------------------------
//  آزمونِ بندِ ۷ی پرامپت — رمزنگاری، چرخش، تستِ بازیابی و نسخهٔ خارج از سرور
//      node test/backup-rotation.mjs
//
//  چرا این فایل هست: سه ادعای بزرگ این‌جا هست که هیچ‌کدام با نگاه کردن به کد
//  ثابت نمی‌شوند —
//    ۱) «بکاپ رمز می‌شود» ⇒ فایلِ رمزشده باید واقعاً باز شود و **بایت‌به‌بایت**
//       همان باشد؛ و فایلِ دست‌خورده باید **رد** شود، نه بی‌صدا باز شود.
//    ۲) «۷ روزانه، ۴ هفتگی، ۳ ماهانه» ⇒ باید همان‌ها بمانند که **تازه‌ترند**،
//       و آرشیوِ رمزشدهٔ پشتیبانِ حذف‌شده هم با خودش برود.
//    ۳) «تستِ بازیابیِ خودکار» ⇒ باید روی پشتیبانِ سالم سبز و روی پشتیبانِ
//       خراب **سرخ** شود. سنجه‌ای که فقط سبز شدن را ببیند هیچ چیزی ثابت نمی‌کند.
//
//  همه در همین فرآیند: محیط پیش از اولین import نشانده می‌شود، پس config و db
//  روی پوشهٔ موقت باز می‌شوند. هیچ سروری بالا نمی‌آید و هیچ شبکه‌ای لازم نیست.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'vill3n-rotation-'));
const BACKUPS = path.join(tmp, 'backups');
const SECRETS = path.join(tmp, 'secrets');
const REMOTE = path.join(tmp, 'remote');

//  ⚠️ پیش از هر importی از src/ — config.js محیط را سرِ بار شدن می‌خواند
process.env.HLP_DATA_DIR = path.join(tmp, 'data');
process.env.HLP_SITES_ROOT = path.join(tmp, 'sites');
process.env.HLP_LIBRARY_ROOT = path.join(tmp, 'library');
process.env.HLP_BACKUP_ROOT = BACKUPS;
process.env.HLP_BACKUP_KEY_DIR = SECRETS;
process.env.HLP_BACKUP_CIPHER = 'aes'; // age روی ماشینِ CI نیست؛ مسیرِ داخلی سنجیده می‌شود
process.env.HLP_TUNNEL = '0';
process.env.HLP_AI_ENABLED = '0';
delete process.env.HLP_OFFSITE_CMD;
delete process.env.HLP_OFFSITE_REMOTE;

const crypt = await import('../src/backup/crypto.js');
const rotation = await import('../src/backup/rotation.js');
const store = await import('../src/storage/backup.js');
const { getSetting } = await import('../src/db.js');

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`); }
};

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** یک دیتابیسِ SQLiteِ کوچکِ واقعی با شمارِ ردیفِ معلوم */
function makeDb(file, rows) {
  const h = new DatabaseSync(file);
  h.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
  h.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
  for (let i = 1; i <= rows; i++) h.prepare('INSERT INTO users (name) VALUES (?)').run(`کاربرِ ${i}`);
  h.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('نمونه', 'بله');
  h.close();
  return { users: rows, settings: 1 };
}

/** یک پوشهٔ پشتیبانِ ساختگی با manifest — همان شکلی که createBackup می‌سازد */
async function fakeBackup(kind, name, { createdAt = Date.now(), rows = 3, tables = null, encrypted = null } = {}) {
  const dir = path.join(store.branchDir(kind), name);
  await fsp.mkdir(dir, { recursive: true });
  const counts = makeDb(path.join(dir, 'panel.db'), rows);
  const manifest = {
    createdAt, kind, folder: name, included: ['panel.db'], bytes: 1, files: 1,
    tables: tables === null ? counts : tables, encrypted,
  };
  await fsp.writeFile(path.join(dir, 'backup.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return { dir, manifest };
}

const names = async (dir) => { try { return (await fsp.readdir(dir)).sort(); } catch { return []; } };

try {
  /* ═══════════════ ۱) رمزنگاری: رفت و برگشت ═══════════════ */
  console.log('\n۱) رمزنگاریِ آرشیو — رفت و برگشت');
  check('روشِ رمزنگاری از HLP_BACKUP_CIPHER قفل می‌شود', crypt.cipherMethod() === 'aes');
  check('پوشهٔ کلید از HLP_BACKUP_KEY_DIR می‌آید', crypt.keyDir() === SECRETS, crypt.keyDir());

  const info = await crypt.ensureKey();
  const keyFile = path.join(SECRETS, 'backup.aes.key');
  check('کلید ساخته شد و با ۶۰۰ نشست', fs.existsSync(keyFile) && (fs.statSync(keyFile).mode & 0o777) === 0o600);
  check('پوشهٔ کلیدها ۷۰۰ است', (fs.statSync(SECRETS).mode & 0o777) === 0o700);
  check('encryptionInfo روش، برچسب و پسوند را می‌گوید', info.method === 'aes' && info.keyExists === true && info.keyPermsOk === true && info.extension === '.enc', JSON.stringify(info));

  //  فایلِ نمونه: هم تصادفی (تراکم‌ناپذیر) هم متنِ فارسی — تا قالب واقعاً سنجیده شود
  const plain = path.join(tmp, 'sample.bin');
  await fsp.writeFile(plain, Buffer.concat([crypto.randomBytes(200 * 1024), Buffer.from('دفترِ سرورِ خانگی\n', 'utf8')]));
  const plainHash = sha(plain);

  const sealed = await crypt.encryptFile(plain);
  check('نامِ فایلِ رمزشده پسوندِ .enc می‌گیرد', sealed === `${plain}.enc` && fs.existsSync(sealed));
  const head = Buffer.alloc(4);
  const fh = await fsp.open(sealed, 'r'); await fh.read(head, 0, 4, 0); await fh.close();
  check('قالبِ VLN1 در سرِ فایل', head.toString('latin1') === 'VLN1');
  check('متنِ فایل واقعاً رمز شده (نه کپی)', sha(sealed) !== plainHash && fs.statSync(sealed).size >= fs.statSync(plain).size + 4 + 12 + 16);

  const back = await crypt.decryptFile(sealed, path.join(tmp, 'back.bin'));
  check('رمزگشایی بایت‌به‌بایت همان فایل را می‌دهد', sha(back) === plainHash);

  const keyBefore = await fsp.readFile(keyFile, 'utf8');
  await crypt.ensureKey();
  check('کلید هیچ‌وقت بازنویسی نمی‌شود (وگرنه پشتیبان‌های قبلی باز نمی‌شوند)', await fsp.readFile(keyFile, 'utf8') === keyBefore);

  /* ═══════════════ ۲) فایلِ دست‌خورده باز نمی‌شود ═══════════════ */
  console.log('\n۲) فایلِ دست‌خورده هیچ‌وقت بی‌صدا باز نمی‌شود');
  const flip = async (file, at) => {
    const buf = await fsp.readFile(file);
    buf[at] ^= 0xff;
    await fsp.writeFile(file, buf);
  };
  const tampered = path.join(tmp, 'tampered.enc');
  await fsp.copyFile(sealed, tampered);
  await flip(tampered, 5000);
  let err = null;
  try { await crypt.decryptFile(tampered, path.join(tmp, 'nope.bin')); } catch (e) { err = e; }
  check('یک بایتِ عوض‌شده ⇒ خطای برچسبِ GCM', !!err, 'بی‌صدا باز شد!');

  const truncated = path.join(tmp, 'short.enc');
  await fsp.writeFile(truncated, Buffer.from('VLN1'));
  err = null;
  try { await crypt.decryptFile(truncated, path.join(tmp, 'nope2.bin')); } catch (e) { err = e; }
  check('فایلِ کوتاه‌تر از سرآیند ⇒ خطا', !!err && /کوتاه/.test(err.message), err?.message);

  const alien = path.join(tmp, 'alien.enc');
  await fsp.writeFile(alien, Buffer.concat([Buffer.from('ZZZZ'), crypto.randomBytes(200)]));
  err = null;
  try { await crypt.decryptFile(alien, path.join(tmp, 'nope3.bin')); } catch (e) { err = e; }
  check('فایلی که با قالبِ ما رمز نشده ⇒ خطای روشن', !!err && /قالبِ پشتیبانِ پنل/.test(err.message), err?.message);

  /* ═══════════════ ۳) چرخش: ۷ · ۴ · ۳ ═══════════════ */
  console.log('\n۳) چرخش — ۷ روزانه · ۴ هفتگی · ۳ ماهانه');
  check('عددهای نگه‌داری همان‌های پرامپت‌اند', store.KEEP.Daily === 7 && store.KEEP.Weekly === 4 && store.KEEP.Monthly === 3, JSON.stringify(store.KEEP));

  const day = 86_400_000;
  const base = Date.UTC(2026, 0, 20);
  //  ده روزانه، شش هفتگی، پنج ماهانه — همه بیش از سهمشان
  for (let i = 0; i < 10; i++) await fakeBackup('Daily', `backup-daily-${String(i).padStart(2, '0')}`, { createdAt: base - i * day });
  for (let i = 0; i < 6; i++) await fakeBackup('Weekly', `backup-weekly-${String(i).padStart(2, '0')}`, { createdAt: base - i * 7 * day });
  for (let i = 0; i < 5; i++) await fakeBackup('Monthly', `backup-monthly-${String(i).padStart(2, '0')}`, { createdAt: base - i * 30 * day });
  //  یک روزانهٔ کهنه که آرشیوِ رمزشده‌اش هنوز در صف است — باید با خودش برود
  const orphan = path.join(BACKUPS, 'offsite-queue', 'backup-daily-09.zip.enc');
  await fsp.mkdir(path.dirname(orphan), { recursive: true });
  await fsp.writeFile(orphan, crypto.randomBytes(64));
  const oldFolder = path.join(store.branchDir('Daily'), 'backup-daily-09');
  const oldManifest = JSON.parse(await fsp.readFile(path.join(oldFolder, 'backup.json'), 'utf8'));
  oldManifest.encrypted = { path: orphan, bytes: 64, method: 'aes' };
  await fsp.writeFile(path.join(oldFolder, 'backup.json'), JSON.stringify(oldManifest), 'utf8');

  const rot = await rotation.rotate();
  const daily = await names(store.branchDir('Daily'));
  const weekly = await names(store.branchDir('Weekly'));
  const monthly = await names(store.branchDir('Monthly'));
  check('۷ روزانه ماند', daily.length === 7, daily.join(','));
  check('۴ هفتگی ماند', weekly.length === 4, weekly.join(','));
  check('۳ ماهانه ماند', monthly.length === 3, monthly.join(','));
  check('آن‌هایی ماندند که تازه‌ترند، نه آن‌هایی که اولِ الفبا هستند',
    daily[0] === 'backup-daily-00' && daily.at(-1) === 'backup-daily-06' && !daily.includes('backup-daily-09'), daily.join(','));
  check('پشتیبان‌های کهنه در نتیجهٔ چرخش نام برده شدند', rot.removed.length === 3 + 2 + 2 && rot.removed.includes('backup-daily-09'), rot.removed.join(','));
  check('آرشیوِ رمزشدهٔ پشتیبانِ حذف‌شده هم از صف رفت', !fs.existsSync(orphan));
  check('نتیجهٔ چرخش در تنظیمات نشست', getSetting('backup_rotation', null)?.removed?.length === rot.removed.length);

  console.log('\n۳ب) صفِ offsite سقف دارد');
  const queueDir = store.offsiteQueueDir();
  await fsp.mkdir(queueDir, { recursive: true });
  for (let i = 0; i < rotation.QUEUE_MAX + 6; i++) {
    const f = path.join(queueDir, `queued-${String(i).padStart(2, '0')}.zip.enc`);
    await fsp.writeFile(f, crypto.randomBytes(32));
    await fsp.utimes(f, new Date(base + i * 1000), new Date(base + i * 1000));
  }
  await fsp.writeFile(path.join(queueDir, 'not-encrypted.txt'), 'این فایل رمزشده نیست');
  const rot2 = await rotation.rotate();
  const q = (await names(queueDir)).filter((n) => n.endsWith('.enc'));
  check(`صف به ${rotation.QUEUE_MAX} فایل بریده شد`, q.length === rotation.QUEUE_MAX, String(q.length));
  check('کهنه‌ترها رفتند، تازه‌ها ماندند', !q.includes('queued-00.zip.enc') && q.includes(`queued-${String(rotation.QUEUE_MAX + 5).padStart(2, '0')}.zip.enc`), q.join(','));
  check('فایلِ رمزنشده در صف دست نخورد', fs.existsSync(path.join(queueDir, 'not-encrypted.txt')));
  check('بریدنِ صف در نتیجه گزارش شد', rot2.queueTrimmed.length === 6, rot2.queueTrimmed.join(','));
  for (const n of q) await fsp.rm(path.join(queueDir, n), { force: true });

  /* ═══════════════ ۴) تستِ بازیابی ═══════════════ */
  console.log('\n۴) تستِ بازیابی — سالم سبز، خراب سرخ');
  const good = await fakeBackup('Manual', 'backup-good', { createdAt: base + day, rows: 5 });
  const goodRow = (await store.listBackups()).find((b) => b.name === 'backup-good');
  const okResult = await rotation.restoreTest({ backup: goodRow });
  check('پشتیبانِ سالم ⇒ ok', okResult.ok === true && okResult.problems.length === 0, JSON.stringify(okResult.problems));
  check('از پوشه بازگردانده شد و شمارِ ردیف‌ها خوانده شد', okResult.source === 'folder' && okResult.tables?.users === 5 && okResult.tables?.settings === 1, JSON.stringify(okResult.tables));
  check('نتیجه با کلیدِ هفته در تنظیمات نشست', getSetting('backup_restore_test', null)?.ok === true && /^\d{4}-\d{2}$/.test(getSetting('backup_restore_test', {}).week || ''));

  //  همان پشتیبان، این بار از راهِ آرشیوِ **رمزشده** — مسیرِ واقعیِ بازگشت از بیرونِ خانه
  const archive = await store.archiveEncrypted(good.dir);
  check('archiveEncrypted یک آرشیوِ رمزشده در صف گذاشت', archive.ok && fs.existsSync(archive.path) && archive.path.startsWith(queueDir) && archive.method === 'aes', archive.path);
  //  ⚠️ restoreTest مسیرِ آرشیو را از backup.jsonِ خودِ پوشه می‌خواند، نه از ردیفِ فهرست
  const goodManifest = JSON.parse(await fsp.readFile(path.join(good.dir, 'backup.json'), 'utf8'));
  goodManifest.encrypted = { path: archive.path, bytes: archive.bytes, method: archive.method };
  await fsp.writeFile(path.join(good.dir, 'backup.json'), JSON.stringify(goodManifest, null, 2), 'utf8');
  const sealedRow = (await store.listBackups()).find((b) => b.name === 'backup-good');
  check('مسیرِ آرشیوِ رمزشده در manifest نشست', sealedRow.encrypted?.path === archive.path);
  const sealedResult = await rotation.restoreTest({ backup: sealedRow });
  check('آرشیوِ رمزشده رمزگشایی و باز می‌شود و سالم است', sealedResult.ok === true && sealedResult.source === 'encrypted', JSON.stringify(sealedResult.problems));
  check('و همان شمارِ ردیف‌ها از آن درمی‌آید', sealedResult.tables?.users === 5, JSON.stringify(sealedResult.tables));

  //  خرابِ شمارهٔ ۱: دیتابیسِ نابود‌شده
  const broken = await fakeBackup('Manual', 'backup-broken', { createdAt: base + 2 * day, rows: 4 });
  await fsp.writeFile(path.join(broken.dir, 'panel.db'), crypto.randomBytes(40 * 1024));
  const brokenRow = (await store.listBackups()).find((b) => b.name === 'backup-broken');
  const badResult = await rotation.restoreTest({ backup: brokenRow });
  check('دیتابیسِ خراب ⇒ تستِ بازیابی رد می‌شود', badResult.ok === false && badResult.problems.length > 0, JSON.stringify(badResult.problems));
  check('خرابیِ نتیجه در تنظیمات نشست (هشدار از همین‌جاست)', getSetting('backup_restore_test', null)?.ok === false);

  //  خرابِ شمارهٔ ۲: دیتابیس باز می‌شود ولی ردیف‌ها کم شده‌اند — بدترین حالت،
  //  چون «فایل باز شد» می‌گوید سالم است
  const short = await fakeBackup('Manual', 'backup-short', { createdAt: base + 3 * day, rows: 2, tables: { users: 9, settings: 1 } });
  const shortRow = (await store.listBackups()).find((b) => b.name === 'backup-short');
  const shortResult = await rotation.restoreTest({ backup: shortRow });
  check('ردیفِ کم ⇒ رد می‌شود («فایل باز شد» کافی نیست)', shortResult.ok === false && shortResult.problems.some((p) => /users/.test(p) && /۹|9/.test(p)), JSON.stringify(shortResult.problems));

  //  خرابِ شمارهٔ ۳: پوشه‌ای که اصلاً panel.db ندارد
  const empty = path.join(store.branchDir('Manual'), 'backup-empty');
  await fsp.mkdir(empty, { recursive: true });
  await fsp.writeFile(path.join(empty, 'backup.json'), JSON.stringify({ createdAt: base + 4 * day, kind: 'Manual' }), 'utf8');
  const emptyResult = await rotation.restoreTest({ backup: { name: 'backup-empty', kind: 'Manual', path: empty } });
  check('پشتیبانِ بی panel.db ⇒ رد', emptyResult.ok === false && emptyResult.problems.join(' ').includes('panel.db'), JSON.stringify(emptyResult.problems));
  await fsp.rm(empty, { recursive: true, force: true });

  //  بی آرگومان ⇒ تازه‌ترین پشتیبان
  const newest = await rotation.restoreTest();
  check('بی آرگومان تازه‌ترین پشتیبان را می‌آزماید', newest.backup === 'backup-short', newest.backup || 'هیچ');

  /* ═══════════════ ۵) نسخهٔ خارج از سرور ═══════════════ */
  console.log('\n۵) نسخهٔ خارج از سرور — صف با HLP_OFFSITE_CMD');
  check('بی مقصد: «تنظیم نشده» و صف دست نمی‌خورد', rotation.offsiteTarget().kind === 'none');
  //  صف را خالی می‌کنیم تا آرشیوِ بندِ ۴ عددها را به‌هم نزند
  for (const n of await names(queueDir)) if (n.endsWith('.enc')) await fsp.rm(path.join(queueDir, n), { force: true });
  const stash = path.join(tmp, 'stash.zip.enc');
  await fsp.writeFile(stash, crypto.randomBytes(16));
  await fsp.copyFile(stash, path.join(queueDir, 'a.zip.enc'));
  const noneResult = await rotation.offsitePush();
  check('بی مقصد هیچ فایلی از صف برداشته نمی‌شود', noneResult.target === 'none' && noneResult.sent.length === 0 && fs.existsSync(path.join(queueDir, 'a.zip.enc')));

  //  یک «مقصدِ خارج از سرور»ی ساختگی: همان چیزی که صاحبِ سرور با rclone یا
  //  rsync می‌نویسد — فایل را می‌گیرد و جای دیگری می‌گذارد
  await fsp.mkdir(REMOTE, { recursive: true });
  const pushScript = path.join(tmp, 'push.mjs');
  await fsp.writeFile(pushScript, `
import fs from 'node:fs';
import path from 'node:path';
const file = process.argv[2] || process.env.OFFSITE_FILE;
if (!file || !fs.existsSync(file)) { console.error('فایلی نیامد'); process.exit(3); }
if (process.env.OFFSITE_FAIL === '1') { console.error('مقصد جواب نداد'); process.exit(4); }
fs.copyFileSync(file, path.join(${JSON.stringify(REMOTE)}, path.basename(file)));
fs.appendFileSync(${JSON.stringify(path.join(tmp, 'push.log'))}, \`\${process.env.OFFSITE_NAME}\\n\`);
`, 'utf8');
  process.env.HLP_OFFSITE_CMD = `${JSON.stringify(process.execPath)} ${JSON.stringify(pushScript)}`;

  check('با HLP_OFFSITE_CMD مقصد «دستورِ سفارشی» است', rotation.offsiteTarget().kind === 'command');
  await fsp.copyFile(stash, path.join(queueDir, 'b.zip.enc'));
  const sentResult = await rotation.offsitePush();
  check('هر دو فایلِ صف فرستاده شدند', sentResult.sent.sort().join(',') === 'a.zip.enc,b.zip.enc', JSON.stringify(sentResult));
  check('صف خالی شد', (await names(queueDir)).filter((n) => n.endsWith('.enc')).length === 0 && sentResult.pending === 0);
  check('فایل‌ها واقعاً به مقصد رسیدند', (await names(REMOTE)).join(',') === 'a.zip.enc,b.zip.enc');
  check('دستور نامِ فایل را هم در OFFSITE_NAME گرفت', (await fsp.readFile(path.join(tmp, 'push.log'), 'utf8')).trim().split('\n').sort().join(',') === 'a.zip.enc,b.zip.enc');
  check('نتیجه در تنظیمات نشست', getSetting('backup_offsite', null)?.sent?.length === 2);

  console.log('\n۵ب) مقصدی که جواب نداد');
  await fsp.copyFile(stash, path.join(queueDir, 'c.zip.enc'));
  process.env.OFFSITE_FAIL = '1';
  const failResult = await rotation.offsitePush();
  delete process.env.OFFSITE_FAIL;
  check('فایلِ نرفته از صف پاک نمی‌شود', failResult.sent.length === 0 && failResult.failed.length === 1 && fs.existsSync(path.join(queueDir, 'c.zip.enc')));
  check('دلیلِ نرفتن نگه داشته می‌شود', /مقصد جواب نداد/.test(failResult.failed[0].error), failResult.failed[0].error);
  const retry = await rotation.offsitePush();
  check('بارِ بعد دوباره تلاش می‌شود و می‌رود', retry.sent.join(',') === 'c.zip.enc' && !fs.existsSync(path.join(queueDir, 'c.zip.enc')), JSON.stringify(retry));

  /* ═══════════════ ۶) خلاصه برای پنل و vill3n ═══════════════ */
  console.log('\n۶) backupStatus — همان چیزی که پنل و «vill3n status» نشان می‌دهند');
  const st = await rotation.backupStatus();
  check('رمزنگاری، نگه‌داری، چرخش، تستِ بازیابی و مقصد در یک شیء',
    st.encryption?.method === 'aes' && st.keep?.Daily === 7 && st.rotation?.at > 0
      && st.restoreTest !== null && st.offsite?.kind === 'command',
    JSON.stringify({ e: st.encryption?.method, k: st.keep, o: st.offsite?.kind }));
  check('صفِ خالی هم گزارش می‌شود', Array.isArray(st.offsite.queue) && st.offsite.queue.length === 0);
} finally {
  delete process.env.HLP_OFFSITE_CMD;
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n  ${passed} سبز، ${failed} سرخ\n`);
process.exit(failed ? 1 : 0);
