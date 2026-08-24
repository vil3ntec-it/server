// ---------------------------------------------------------------------------
//  پشتیبان‌گیری و بازگرداندن
//
//  سه چیز پشتیبان می‌شود:
//      دیتابیسِ پنل   · تنظیمات، کاربران، برنامه‌ها، دفترِ کارها
//      دادهٔ سایت‌ها   · دفترهای site-sync
//      فایلِ .env     · رمزهای پیامک و ایمیل
//
//  قانون‌ها:
//    • هر پشتیبان یک پوشهٔ تاریخ‌دار است، نه یک فایلِ درهم
//    • بعد از ساخت، بررسی می‌شود (شمارِ فایل و اندازه)
//    • پیش از بازگرداندن، از وضعِ فعلی پشتیبان گرفته می‌شود — تا اگر
//      پشیمان شدید راهِ برگشت باشد
//    • اگر فضای دیسک بحرانی باشد، پشتیبان‌گیری انجام نمی‌شود (وگرنه هم
//      پشتیبان ناقص می‌ماند هم دیتابیس در خطر می‌افتد)
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config, paths } from '../config.js';
import { db, logEvent, getSetting, setSetting } from '../db.js';
import { libraryPath, ensureLibrary, diskInfo, diskWarning, folderSize } from './library.js';

export const KINDS = ['Manual', 'Daily', 'Weekly'];

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
  const parent = libraryPath('Backups', branch);
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
  };
  await fsp.writeFile(path.join(target, 'backup.json'), JSON.stringify(manifest, null, 2), 'utf8');

  // بررسی: دستِ‌کم دیتابیس باید آمده باشد
  const verified = included.includes('panel.db') && size.files > 0;
  logEvent(verified ? 'info' : 'warn', 'panel', `پشتیبان ساخته شد: ${folder} (${included.join('، ')})`);

  setSetting('last_backup', { at: manifest.createdAt, kind: branch, path: target, verified });
  return { ok: true, path: target, folder, verified, ...manifest };
}

/** فهرستِ پشتیبان‌ها */
export async function listBackups() {
  await ensureLibrary();
  const rows = [];
  for (const branch of KINDS) {
    const parent = libraryPath('Backups', branch);
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
        healthy: fs.existsSync(path.join(base, 'panel.db')),
      });
    }
  }
  return rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/**
 * پشتیبان‌های قدیمی را دور می‌ریزد. پیش‌فرض: ۷ روزانه، ۴ هفتگی، ۱۰ دستی.
 */
export async function pruneBackups({ Daily = 7, Weekly = 4, Manual = 10 } = {}) {
  const keep = { Daily, Weekly, Manual };
  const all = await listBackups();
  const removed = [];

  for (const branch of KINDS) {
    const rows = all.filter((b) => b.kind === branch);
    for (const old of rows.slice(keep[branch])) {
      try {
        await fsp.rm(old.path, { recursive: true, force: true });
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
  return getSetting('backup_schedule', { daily: false, weekly: false, hour: 3 });
}

export function setBackupSchedule(patch = {}) {
  const current = backupSchedule();
  const next = {
    daily: patch.daily === undefined ? current.daily : Boolean(patch.daily),
    weekly: patch.weekly === undefined ? current.weekly : Boolean(patch.weekly),
    hour: Math.min(23, Math.max(0, Number(patch.hour ?? current.hour) || 3)),
  };
  setSetting('backup_schedule', next);
  return next;
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
