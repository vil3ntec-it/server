// ---------------------------------------------------------------------------
//  بندِ ۷ی پرامپت — چرخش، تستِ بازیابیِ خودکار، و نسخهٔ خارج از سرور
//
//  سه تابعِ خالص که هر کدام یک کار می‌کند و نتیجه‌اش را در تنظیمات می‌نشاند:
//      rotate()       ۷ روزانه · ۴ هفتگی · ۳ ماهانه · ۱۰ دستی، و سقفِ صفِ offsite
//      restoreTest()  تازه‌ترین پشتیبان را واقعاً باز می‌کند: آرشیوِ رمزشده ⇒
//                     رمزگشایی ⇒ باز کردنِ zip ⇒ PRAGMA integrity_check ⇒
//                     شمارِ ردیفِ هر جدول با manifest یکی باشد. رد شد ⇒ هشدار.
//      offsitePush()  فایل‌های رمزشدهٔ صف را با HLP_OFFSITE_CMD یا rclone
//                     (HLP_OFFSITE_REMOTE) می‌فرستد و از صف برمی‌دارد.
//
//  ⚠️ هیچ زمان‌بندی این‌جا نیست: موتورِ اتوماسیون (src/automation، سیزنِ دیگر)
//  این‌ها را job می‌کند. تا آن روز تیکِ storage/backup.js جانشینِ حداقلی است.
//  ⚠️ «تستِ بازیابی در Container موقت»ِ پرامپت این‌جا «پوشهٔ موقت» است:
//  دیتابیس SQLite است و برای باز کردنش هیچ سرویسی لازم نیست؛ داکر فقط هزینه
//  اضافه می‌کرد و روی ویندوزِ صاحب سامانه اصلاً نیست.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { getSetting, setSetting, logEvent } from '../db.js';
import { listBackups, pruneBackups, offsiteQueueDir, tableCounts, KEEP, weekKey } from '../storage/backup.js';
import { decryptFile, isEncryptedName, encryptionInfo } from './crypto.js';
import { extractZip } from '../control/zip.js';
import { raiseAlert, clearAlert } from '../control/alerts.js';

/** سقفِ صفِ offsite وقتی هیچ مقصدی تنظیم نشده — تا دیسک را پر نکند */
export const QUEUE_MAX = 14;

/** خبر به صاحبِ سرور: هشدارِ مرکز فرمان (پنل، دستیار، پوش) + دفترِ رخدادها */
function tell(key, severity, title, detail) {
  try { logEvent(severity === 'info' ? 'info' : 'error', 'backup', `${title}${detail ? ' — ' + detail : ''}`); } catch { /* */ }
  try {
    if (severity === 'info') clearAlert(key);
    else raiseAlert({ key, kind: 'backup', severity, title, detail });
  } catch { /* دفترِ هشدار نباید کار را بخواباند */ }
}

async function queueFiles() {
  const dir = offsiteQueueDir();
  let names = [];
  try { names = await fsp.readdir(dir); } catch { return []; }
  const rows = [];
  for (const name of names) {
    if (!isEncryptedName(name)) continue;
    try {
      const st = await fsp.stat(path.join(dir, name));
      rows.push({ name, path: path.join(dir, name), bytes: st.size, mtime: st.mtimeMs });
    } catch { /* همین لحظه رفت */ }
  }
  return rows.sort((a, b) => a.mtime - b.mtime);
}

/**
 * چرخش: پوشه‌های اضافه (و آرشیوشان) می‌روند؛ صف هم سقف دارد.
 */
export async function rotate(keep = KEEP) {
  const pruned = await pruneBackups(keep);
  const queue = await queueFiles();
  const overflow = queue.length > QUEUE_MAX ? queue.slice(0, queue.length - QUEUE_MAX) : [];
  for (const f of overflow) {
    try { await fsp.rm(f.path, { force: true }); } catch { /* بعداً */ }
  }
  const result = {
    at: Date.now(),
    removed: pruned.removed,
    queueTrimmed: overflow.map((f) => f.name),
    keep: { ...keep },
  };
  setSetting('backup_rotation', result);
  return result;
}

function openReadOnly(file) {
  return new DatabaseSync(file, { readOnly: true });
}

/** بررسیِ یک فایلِ دیتابیسِ بازگردانده‌شده در برابرِ manifest */
function inspectRestored(dbFile, manifest) {
  const problems = [];
  let handle;
  try {
    handle = openReadOnly(dbFile);
  } catch (e) {
    return { ok: false, problems: [`دیتابیس باز نشد: ${e.code || e.message}`], tables: null };
  }
  try {
    let integrity = null;
    try {
      const row = handle.prepare('PRAGMA integrity_check').get();
      integrity = row?.integrity_check ?? Object.values(row || {})[0];
    } catch (e) {
      integrity = `error: ${e.code || e.message}`;
    }
    if (integrity !== 'ok') problems.push(`integrity_check: ${integrity}`);

    let counts = {};
    try { counts = tableCounts(handle); } catch { /* */ }
    const expected = manifest?.tables || null;
    if (expected) {
      for (const [table, n] of Object.entries(expected)) {
        if (counts[table] === undefined) problems.push(`جدولِ «${table}» در نسخهٔ بازگردانده نیست`);
        else if (counts[table] !== n) problems.push(`جدولِ «${table}»: ${counts[table]} ردیف به‌جای ${n}`);
      }
    } else if (!('users' in counts) || !('settings' in counts)) {
      problems.push('جدول‌های پایهٔ پنل (users/settings) پیدا نشد');
    }
    return { ok: problems.length === 0, problems, tables: counts, integrity };
  } finally {
    try { handle.close(); } catch { /* */ }
  }
}

/**
 * تستِ بازیابیِ خودکار روی تازه‌ترین پشتیبان.
 * @param {{backup?: object}} [opts] پشتیبانِ مشخص به‌جای تازه‌ترین (برای آزمون)
 */
export async function restoreTest(opts = {}) {
  const started = Date.now();
  const all = await listBackups();
  const target = opts.backup || all[0] || null;
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'vill3n-restore-test-'));
  const result = {
    at: started, week: weekKey(new Date(started)), ok: false, backup: target?.name ?? null, kind: target?.kind ?? null,
    source: null, problems: [], durationMs: 0, tables: null,
  };

  try {
    if (!target) {
      result.problems.push('هیچ پشتیبانی برای آزمودن نیست');
      return finish(result, temp);
    }
    let manifest = null;
    try { manifest = JSON.parse(await fsp.readFile(path.join(target.path, 'backup.json'), 'utf8')); } catch { /* دستی */ }

    let dbFile = null;
    const sealed = manifest?.encrypted?.path;
    if (sealed && fs.existsSync(sealed)) {
      // مسیرِ واقعیِ بازگشت از بیرونِ خانه: رمزگشایی ⇒ zip ⇒ پوشه
      result.source = 'encrypted';
      const zip = path.join(temp, 'backup.zip');
      await decryptFile(sealed, zip);
      const out = path.join(temp, 'restored');
      await extractZip(zip, out);
      dbFile = path.join(out, 'panel.db');
    } else {
      result.source = 'folder';
      dbFile = path.join(temp, 'panel.db');
      await fsp.copyFile(path.join(target.path, 'panel.db'), dbFile);
    }
    if (!fs.existsSync(dbFile)) {
      result.problems.push('panel.db داخلِ پشتیبان نبود');
      return finish(result, temp);
    }
    const check = inspectRestored(dbFile, manifest);
    result.ok = check.ok;
    result.problems = check.problems;
    result.tables = check.tables;
    return finish(result, temp);
  } catch (e) {
    result.problems.push(e.message);
    return finish(result, temp);
  }
}

async function finish(result, temp) {
  result.durationMs = Date.now() - result.at;
  try { await fsp.rm(temp, { recursive: true, force: true }); } catch { /* */ }
  setSetting('backup_restore_test', result);
  if (result.ok) {
    tell('backup_restore_test', 'info', `تستِ بازیابیِ پشتیبان «${result.backup}» سالم بود`);
  } else {
    tell('backup_restore_test', 'critical', 'تستِ بازیابیِ پشتیبان رد شد', result.problems.join(' · ').slice(0, 900));
  }
  return result;
}

function exec(cmd, args, { cwd, env, timeout = 30 * 60_000 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, env, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err });
    });
  });
}

/** مقصدِ offsite: دستورِ دلخواه (HLP_OFFSITE_CMD) یا rclone (HLP_OFFSITE_REMOTE) */
export function offsiteTarget() {
  const cmd = String(process.env.HLP_OFFSITE_CMD || '').trim();
  const remote = String(process.env.HLP_OFFSITE_REMOTE || '').trim();
  if (cmd) return { kind: 'command', label: 'دستورِ سفارشی' };
  if (remote) return { kind: 'rclone', remote, label: `rclone ⇒ ${remote}` };
  return { kind: 'none', label: 'تنظیم نشده — فایل‌ها در صف می‌مانند' };
}

/**
 * صف را می‌فرستد. هر فایل جدا: رفت ⇒ از صف پاک، نرفت ⇒ می‌ماند و بارِ بعد.
 */
export async function offsitePush() {
  const target = offsiteTarget();
  const queue = await queueFiles();
  const result = { at: Date.now(), target: target.kind, sent: [], failed: [], pending: queue.length };
  if (target.kind === 'none' || queue.length === 0) {
    setSetting('backup_offsite', result);
    return result;
  }
  for (const f of queue) {
    let r;
    if (target.kind === 'command') {
      //  فایل هم آرگومانِ آخر است هم در OFFSITE_FILE — هر دو شکلِ اسکریپت کار می‌کند
      r = await exec('/bin/sh', ['-c', `${process.env.HLP_OFFSITE_CMD} "$1"`, 'offsite', f.path], {
        env: { ...process.env, OFFSITE_FILE: f.path, OFFSITE_NAME: f.name },
      });
    } else {
      r = await exec('rclone', ['copyto', f.path, `${target.remote.replace(/\/+$/, '')}/${f.name}`]);
    }
    if (r.ok) {
      try { await fsp.rm(f.path, { force: true }); } catch { /* */ }
      result.sent.push(f.name);
    } else {
      result.failed.push({ name: f.name, error: (r.stderr || r.error?.message || 'ناموفق').trim().slice(0, 300) });
    }
  }
  result.pending = queue.length - result.sent.length;
  setSetting('backup_offsite', result);
  if (result.failed.length) {
    tell('backup_offsite', 'warn', `${result.failed.length} پشتیبان به مقصدِ خارج از سرور نرفت`, result.failed[0].error);
  } else {
    tell('backup_offsite', 'info', `${result.sent.length} پشتیبان به مقصدِ خارج از سرور رفت`);
  }
  return result;
}

/** خلاصه برای صفحهٔ پشتیبان‌ها و «vill3n status» */
export async function backupStatus() {
  const queue = await queueFiles();
  return {
    encryption: encryptionInfo(),
    keep: { ...KEEP },
    rotation: getSetting('backup_rotation', null),
    restoreTest: getSetting('backup_restore_test', null),
    offsite: { ...offsiteTarget(), queue: queue.map((f) => ({ name: f.name, bytes: f.bytes })), last: getSetting('backup_offsite', null) },
  };
}
