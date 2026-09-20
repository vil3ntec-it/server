// ---------------------------------------------------------------------------
//  پشتیبان‌گیری و بازگرداندن
//
//  سه چیز پشتیبان می‌شود:
//      دیتابیسِ پنل   · تنظیمات، کاربران، برنامه‌ها، دفترِ کارها
//      دادهٔ سایت‌ها   · دفترهای site-sync
//      دادهٔ پمپ‌ها    · پوشهٔ هر پمپ بنزین
//      فایلِ .env     · رمزهای پیامک و ایمیل
//
//  قانون‌ها:
//    • هر پشتیبان یک پوشهٔ تاریخ‌دار است، نه یک فایلِ درهم
//    • بعد از ساخت، بررسی می‌شود (شمارِ فایل و اندازه)
//    • پیش از بازگرداندن، از وضعِ فعلی پشتیبان گرفته می‌شود — تا اگر
//      پشیمان شدید راهِ برگشت باشد
//    • اگر فضای دیسک بحرانی باشد، پشتیبان‌گیری انجام نمی‌شود (وگرنه هم
//      پشتیبان ناقص می‌ماند هم دیتابیس در خطر می‌افتد)
//
//  بندِ ۷ی پرامپت (از ۱۴۰۵/۰۷/۰۳):
//    • چهار شاخه: Manual · Daily · Weekly · Monthly — ۷ / ۴ / ۳ نگه‌داری
//      (چرخش در backup/rotation.js)
//    • هر پشتیبان یک آرشیوِ **رمزشده** هم می‌سازد و در صفِ offsite می‌گذارد
//      (backup/crypto.js)؛ نسخهٔ محلی برای بازگردانیِ یک‌کلیکی رمز نمی‌شود
//    • manifest شمارِ ردیفِ هر جدول را دارد تا تستِ بازیابیِ هفتگی بتواند
//      «همان داده برگشت؟» را بسنجد، نه فقط «فایل باز شد؟»
//    • HLP_BACKUP_ROOT (نصب‌کننده: /srv/vill3n/backups) جای شاخه‌ها را از
//      کتابخانه به همان پوشه می‌برد: <ریشه>/daily · weekly · monthly · manual ·
//      offsite-queue — دقیقاً ساختارِ بندِ ۳ی پرامپت
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config, paths } from '../config.js';
import { db, logEvent, getSetting, setSetting } from '../db.js';
import { libraryPath, ensureLibrary, diskInfo, diskWarning, folderSize } from './library.js';
import { createZip, walk } from '../control/zip.js';
import { encryptFile, encryptionInfo } from '../backup/crypto.js';

export const KINDS = ['Manual', 'Daily', 'Weekly', 'Monthly'];

/** نگه‌داریِ چرخشی — همان عددهای پرامپت */
export const KEEP = Object.freeze({ Daily: 7, Weekly: 4, Monthly: 3, Manual: 10 });

/** ریشهٔ پشتیبان‌ها: HLP_BACKUP_ROOT یا شاخهٔ Backupsِ کتابخانه */
export function backupRoot() {
  return process.env.HLP_BACKUP_ROOT ? path.resolve(process.env.HLP_BACKUP_ROOT) : libraryPath('Backups');
}

/** پوشهٔ یک شاخه (Daily ⇒ <ریشه>/daily وقتی HLP_BACKUP_ROOT هست، وگرنه Backups/Daily) */
export function branchDir(kind) {
  const branch = KINDS.includes(kind) ? kind : 'Manual';
  return process.env.HLP_BACKUP_ROOT ? path.join(backupRoot(), branch.toLowerCase()) : libraryPath('Backups', branch);
}

/** صفِ نسخه‌های خارج از سرور — فقط فایل‌های رمزشده */
export function offsiteQueueDir() {
  return process.env.HLP_BACKUP_ROOT ? path.join(backupRoot(), 'offsite-queue') : libraryPath('Backups', 'OffsiteQueue');
}

/** شمارِ ردیفِ هر جدولِ دیتابیسِ پنل — برای سنجشِ بازیابی */
export function tableCounts(handle = db) {
  const out = {};
  try {
    const tables = handle.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all();
    for (const { name } of tables) {
      try {
        out[name] = Number(handle.prepare(`SELECT COUNT(*) AS n FROM "${String(name).replace(/"/g, '""')}"`).get().n);
      } catch { /* جدولِ خراب — تستِ بازیابی خودش می‌گیرد */ }
    }
  } catch { /* بی جدول */ }
  return out;
}

/**
 * آرشیوِ رمزشده از پوشهٔ پشتیبان: zip (خودِ پنل، بی وابستگی) ⇒ رمز ⇒ صف.
 * نرفتنش پشتیبان را باطل نمی‌کند — فقط در manifest و لاگ می‌نشیند.
 */
export async function archiveEncrypted(folder) {
  const queue = offsiteQueueDir();
  await fsp.mkdir(queue, { recursive: true });
  const zip = path.join(queue, `${path.basename(folder)}.zip`);
  try {
    const entries = await walk(folder);
    await createZip(zip, entries);
    const sealed = await encryptFile(zip);
    const size = (await fsp.stat(sealed)).size;
    return { ok: true, path: sealed, bytes: size, method: encryptionInfo().method };
  } finally {
    await fsp.rm(zip, { force: true });
  }
}

function stamp() {
  const now = new Date();
  const two = (n) => String(n).padStart(2, '0');
  // ثانیه هم هست: پشتیبانِ ایمنیِ پیش از بازگرداندن، بی‌درنگ بعدِ یکی دیگر
  // ساخته می‌شود و نباید به هم بخورند
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
}

/** آن‌چه باید پشتیبان شود */
function sources() {
  return [
    { name: 'panel.db', from: paths.db, kind: 'file' },
    { name: 'site-sync', from: config.siteSync.dataDir, kind: 'dir' },
    // دادهٔ هر پمپ بنزین — پوشهٔ جدا برای هرکدام
    { name: 'stations', from: config.stations.dataDir, kind: 'dir' },
    { name: '.env', from: path.join(path.dirname(paths.db), '..', '.env'), kind: 'file' },
  ];
}

async function copyInto(from, to, kind) {
  if (!fs.existsSync(from)) return false;
  if (kind === 'file') {
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.copyFile(from, to);
    return true;
  }
  await fsp.cp(from, to, { recursive: true, force: true, dereference: false });
  return true;
}

/**
 * یک پشتیبانِ تازه می‌سازد.
 */
export async function createBackup({ kind = 'Manual', note = null } = {}) {
  const branch = KINDS.includes(kind) ? kind : 'Manual';

  const disk = diskInfo();
  const warning = diskWarning(disk);
  if (warning && warning.level === 'critical') {
    return { ok: false, error: 'disk_critical', message: warning.message };
  }

  await ensureLibrary();
  const parent = branchDir(branch);
  await fsp.mkdir(parent, { recursive: true });

  let folder = `backup-${stamp()}`;
  let target = path.join(parent, folder);
  for (let i = 2; fs.existsSync(target) && i < 100; i++) {
    folder = `backup-${stamp()}-${i}`;
    target = path.join(parent, folder);
  }
  await fsp.mkdir(target, { recursive: true });

  // دیتابیس را پیش از کپی روی دیسک می‌نشانیم تا نصفه نباشد
  try {
    db.exec('PRAGMA wal_checkpoint(FULL)');
  } catch { /* اهمیتی ندارد */ }

  const included = [];
  for (const item of sources()) {
    try {
      const copied = await copyInto(item.from, path.join(target, item.name), item.kind);
      if (copied) included.push(item.name);
    } catch (e) {
      logEvent('warn', 'panel', `پشتیبانِ «${item.name}» ناقص ماند: ${e.message}`);
    }
  }

  const size = await folderSize(target);
  const manifest = {
    createdAt: Date.now(),
    kind: branch,
    note: note ? String(note).slice(0, 200) : null,
    included,
    bytes: size.bytes,
    files: size.files,
    version: getSetting('last_version', null),
    // شمارِ ردیفِ هر جدول در لحظهٔ پشتیبان — تستِ بازیابی همین را می‌سنجد
    tables: tableCounts(),
    encrypted: null,
  };
  await fsp.writeFile(path.join(target, 'backup.json'), JSON.stringify(manifest, null, 2), 'utf8');

  // بررسی: دستِ‌کم دیتابیس باید آمده باشد
  const verified = included.includes('panel.db') && size.files > 0;
  logEvent(verified ? 'info' : 'warn', 'panel', `پشتیبان ساخته شد: ${folder} (${included.join('، ')})`);

  // آرشیوِ رمزشده برای صفِ offsite (بندِ ۷). HLP_BACKUP_ENCRYPT=0 خاموشش می‌کند.
  if ((process.env.HLP_BACKUP_ENCRYPT ?? '1') !== '0' && verified) {
    try {
      const sealed = await archiveEncrypted(target);
      manifest.encrypted = { path: sealed.path, bytes: sealed.bytes, method: sealed.method };
      await fsp.writeFile(path.join(target, 'backup.json'), JSON.stringify(manifest, null, 2), 'utf8');
    } catch (e) {
      logEvent('warn', 'panel', `آرشیوِ رمزشدهٔ «${folder}» ساخته نشد: ${e.message}`);
    }
  }

  setSetting('last_backup', { at: manifest.createdAt, kind: branch, path: target, verified });
  return { ok: true, path: target, folder, verified, ...manifest };
}

/** فهرستِ پشتیبان‌ها */
export async function listBackups() {
  await ensureLibrary();
  const rows = [];
  for (const branch of KINDS) {
    const parent = branchDir(branch);
    let entries = [];
    try {
      entries = await fsp.readdir(parent, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const base = path.join(parent, entry.name);
      let manifest = null;
      try {
        manifest = JSON.parse(await fsp.readFile(path.join(base, 'backup.json'), 'utf8'));
      } catch { /* دستی ساخته شده */ }
      rows.push({
        name: entry.name,
        kind: branch,
        path: base,
        createdAt: manifest?.createdAt ?? null,
        bytes: manifest?.bytes ?? null,
        files: manifest?.files ?? null,
        included: manifest?.included ?? [],
        note: manifest?.note ?? null,
        tables: manifest?.tables ?? null,
        encrypted: manifest?.encrypted ?? null,
        healthy: fs.existsSync(path.join(base, 'panel.db')),
      });
    }
  }
  return rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/**
 * پشتیبان‌های قدیمی را دور می‌ریزد. پیش‌فرض: ۷ روزانه، ۴ هفتگی، ۳ ماهانه، ۱۰ دستی.
 * آرشیوِ رمزشده‌ای که هنوز در صف است با پوشهٔ خودش می‌رود (rotation.js صف را
 * جدا سقف می‌زند تا صفی که هیچ‌وقت خالی نشده دیسک را پر نکند).
 */
export async function pruneBackups({ Daily = KEEP.Daily, Weekly = KEEP.Weekly, Monthly = KEEP.Monthly, Manual = KEEP.Manual } = {}) {
  const keep = { Daily, Weekly, Monthly, Manual };
  const all = await listBackups();
  const removed = [];

  for (const branch of KINDS) {
    const rows = all.filter((b) => b.kind === branch);
    for (const old of rows.slice(keep[branch])) {
      try {
        await fsp.rm(old.path, { recursive: true, force: true });
        if (old.encrypted?.path) await fsp.rm(old.encrypted.path, { force: true });
        removed.push(old.name);
      } catch { /* بعداً */ }
    }
  }
  return { removed };
}

/**
 * بازگرداندن. اول از وضعِ فعلی پشتیبان می‌گیریم — همیشه راهِ برگشت باشد.
 * فایل‌ها کنارِ اصلی نوشته می‌شوند و سرور باید دوباره بالا بیاید.
 */
export async function restoreBackup(folderPath) {
  const source = path.resolve(String(folderPath || ''));
  if (!source || !fs.existsSync(source)) {
    return { ok: false, error: 'not_found', message: 'این پشتیبان پیدا نشد' };
  }
  if (!fs.existsSync(path.join(source, 'panel.db'))) {
    return { ok: false, error: 'incomplete', message: 'این پوشه دیتابیس ندارد — پشتیبانِ سالمی نیست' };
  }

  // راهِ برگشت
  const safety = await createBackup({ kind: 'Manual', note: 'خودکار — پیش از بازگرداندن' });

  const restored = [];
  for (const item of sources()) {
    const from = path.join(source, item.name);
    if (!fs.existsSync(from)) continue;
    try {
      if (item.kind === 'file') {
        await fsp.mkdir(path.dirname(item.from), { recursive: true });
        await fsp.copyFile(from, item.from);
      } else {
        await fsp.rm(item.from, { recursive: true, force: true });
        await fsp.cp(from, item.from, { recursive: true, force: true, dereference: false });
      }
      restored.push(item.name);
    } catch (e) {
      logEvent('error', 'panel', `بازگرداندنِ «${item.name}» ناموفق بود: ${e.message}`);
      return { ok: false, error: 'restore_failed', message: e.message, restored, safety: safety.path };
    }
  }

  logEvent('warn', 'panel', `از پشتیبان بازگردانده شد: ${path.basename(source)}`);
  return {
    ok: true,
    restored,
    safety: safety.ok ? safety.path : null,
    message: 'بازگردانده شد. سرور باید یک بار خاموش و روشن شود تا دادهٔ تازه خوانده شود.',
  };
}

// ---------------------------------------------------------------------------
//  زمان‌بندی
// ---------------------------------------------------------------------------
let timer = null;

export function backupSchedule() {
  return { monthly: false, ...getSetting('backup_schedule', { daily: false, weekly: false, hour: 3 }) };
}

export function setBackupSchedule(patch = {}) {
  const current = backupSchedule();
  const next = {
    daily: patch.daily === undefined ? current.daily : Boolean(patch.daily),
    weekly: patch.weekly === undefined ? current.weekly : Boolean(patch.weekly),
    monthly: patch.monthly === undefined ? current.monthly : Boolean(patch.monthly),
    hour: Math.min(23, Math.max(0, Number(patch.hour ?? current.hour) || 3)),
  };
  setSetting('backup_schedule', next);
  return next;
}

/** کلیدِ هفته (سال-هفته) — «این هفته تستِ بازیابی شده؟» */
export function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-${String(Math.ceil(((t - start) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}

/** هر ساعت نگاه می‌کند آیا وقتِ پشتیبان‌گیری هست */
export function startBackupSchedule() {
  if (timer) return;
  const tick = async () => {
    try {
      const plan = backupSchedule();
      if (!plan.daily && !plan.weekly) return;

      const now = new Date();
      if (now.getHours() !== plan.hour) return;

      const last = getSetting('last_auto_backup', {});
      const today = now.toISOString().slice(0, 10);

      if (plan.daily && last.daily !== today) {
        await createBackup({ kind: 'Daily', note: 'خودکار — روزانه' });
        setSetting('last_auto_backup', { ...last, daily: today });
        await pruneBackups();
      }
      // شنبه‌ها (روزِ ۶ در جاوااسکریپت)
      if (plan.weekly && now.getDay() === 6 && last.weekly !== today) {
        await createBackup({ kind: 'Weekly', note: 'خودکار — هفتگی' });
        setSetting('last_auto_backup', { ...getSetting('last_auto_backup', {}), weekly: today });
        await pruneBackups();
      }
      // اولِ هر ماه
      if (plan.monthly && now.getDate() === 1 && last.monthly !== today) {
        await createBackup({ kind: 'Monthly', note: 'خودکار — ماهانه' });
        setSetting('last_auto_backup', { ...getSetting('last_auto_backup', {}), monthly: today });
        await pruneBackups();
      }
      /*
       *  کارهای بندِ ۷ که موتورِ اتوماسیون قرار است به شکلِ job سوارشان کند
       *  (backup/rotation.js). تا آن روز، همین تیک جانشینِ حداقلی است:
       *  چرخش و صفِ offsite بعد از هر پشتیبانِ خودکار، تستِ بازیابی هفته‌ای یک بار.
       */
      const rotation = await import('../backup/rotation.js');
      await rotation.rotate();
      await rotation.offsitePush();
      if (now.getDay() === 6 && getSetting('backup_restore_test', {})?.week !== weekKey(now)) {
        await rotation.restoreTest();
      }
    } catch (e) {
      logEvent('error', 'panel', `پشتیبانِ خودکار ناموفق بود: ${e.message}`);
    }
  };

  timer = setInterval(tick, 15 * 60 * 1000);
  timer.unref?.();
}

export function stopBackupSchedule() {
  if (timer) clearInterval(timer);
  timer = null;
}
