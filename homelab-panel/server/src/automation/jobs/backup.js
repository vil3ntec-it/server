// ---------------------------------------------------------------------------
//  پشتیبان‌ها — روزانه، هفتگی با آزمونِ بازگردانی، ماهانه، و ارسال به بیرون
//
//  دو پشتیبان در پنل هست و هر دو گرفته می‌شوند: دیتابیسِ پنل (backup/index.js،
//  VACUUM INTO) و انبار (storage/backup.js: دیتابیس + site-sync + پمپ‌ها + .env)
//  — دومی فقط وقتی انبار تنظیم شده باشد؛ وگرنه بی سروصدا رد می‌شود و در
//  خروجی نوشته می‌شود.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { defineJob } from '../engine.js';
import { db, setSetting } from '../../db.js';
import { config, paths } from '../../config.js';
import { vacuumInto } from '../../backup/sqlite.js';

const MONTHLY_KEEP = Math.max(1, Number(process.env.HLP_BACKUP_MONTHLY_KEEP) || 3);
const OFFSITE_KEEP = Math.max(1, Number(process.env.HLP_OFFSITE_KEEP) || 5);

async function takeAll(ctx, { kind, note, reason = 'scheduled' }) {
  const made = { panel: null, storage: null };
  const entry = await ctx.backup.panel({ reason, note });
  made.panel = path.join(paths.backups, entry.file);
  ctx.log(`دیتابیسِ پنل: ${entry.file} (${Math.round(entry.sizeBytes / 1024)} کیلوبایت)`);

  const st = await ctx.backup.storage({ kind, note });
  if (st.ok) {
    made.storage = st.path;
    ctx.log(`انبار: ${st.folder} — ${st.included.join('، ')}${st.verified ? '' : ' ⚠️ ناقص'}`);
    if (!st.verified) throw new Error('پشتیبانِ انبار ناقص ماند (دیتابیس در آن نیست)');
  } else if (st.error === 'library_not_configured') {
    ctx.log('انبار تنظیم نشده — فقط دیتابیسِ پنل پشتیبان شد');
  } else {
    throw new Error(st.message || st.error || 'پشتیبانِ انبار نشد');
  }
  setSetting('last_backup_at', Date.now());
  return made;
}

function failHandler(kind) {
  return async (ctx, err) => {
    await ctx.notify('critical', `پشتیبانِ ${kind} ناموفق: ${err.message}`);
    ctx.emit('backup.failed', { kind, error: err.message, runId: ctx.runId });
  };
}

/* ------------------------------ روزانه ---------------------------------- */

export const backupDaily = defineJob({
  name: 'backup-daily',
  title: 'پشتیبانِ روزانه',
  description: 'هر شب ۲:۰۰ — دیتابیسِ پنل و انبار؛ بعد دور ریختنِ کهنه‌ها (۷ روزانه، ۴ هفتگی)',
  schedule: '0 2 * * *',
  timeout: 30 * 60_000,
  async run(ctx) {
    const made = await takeAll(ctx, { kind: 'Daily', note: 'خودکار — روزانه' });
    const rotated = await ctx.backup.rotate({ Daily: 7, Weekly: 4 });
    ctx.log(`دور ریخته شد: پنل ${rotated.panel.length}، انبار ${rotated.storage.length}`);
    ctx.emit('backup.done', { kind: 'daily', ...made });
    return { ...made, rotated };
  },
  onFail: failHandler('روزانه'),
});

/* ----------------------- هفتگی + آزمونِ بازگردانی ----------------------- */

/**
 * بازگردانیِ آزمایشی: تازه‌ترین پشتیبانِ پنل به یک پوشهٔ موقت می‌رود، باز
 * می‌شود، integrity_check و شمارِ جدول‌ها و ردیف‌های کلیدی‌اش با دیتابیسِ زنده
 * سنجیده می‌شود. «بکاپی که برگردانده نشده، بکاپ نیست» (test/backup-restore.mjs).
 */
export async function restoreTest(ctx, file) {
  const source = path.join(paths.backups, path.basename(file));
  if (!fs.existsSync(source)) throw new Error(`فایلِ پشتیبان پیدا نشد: ${file}`);
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-restore-test-'));
  const target = path.join(tmp, 'panel.db');
  try {
    await fsp.copyFile(source, target);
    const probe = new DatabaseSync(target, { readOnly: true });
    try {
      const row = probe.prepare('PRAGMA integrity_check').get();
      const integrity = row?.integrity_check ?? Object.values(row || {})[0];
      if (integrity !== 'ok') throw new Error(`integrity_check: ${integrity}`);
      const tables = probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
      const live = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
      const missing = live.filter((t) => !tables.includes(t));
      if (missing.length) throw new Error(`جدول‌های ${missing.join('، ')} در پشتیبان نیستند`);
      const counts = {};
      for (const t of ['users', 'settings', 'sites', 'domains']) {
        if (!tables.includes(t)) continue;
        counts[t] = probe.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n;
      }
      const liveUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
      if (counts.users == null || counts.users < 1) throw new Error('پشتیبان هیچ کاربری ندارد');
      if (counts.users > liveUsers) throw new Error(`شمارِ کاربران در پشتیبان (${counts.users}) از دیتابیسِ زنده (${liveUsers}) بیشتر است`);
      ctx.log(`آزمونِ بازگردانی: ${path.basename(source)} — integrity ok، ${tables.length} جدول، ${JSON.stringify(counts)}`);
      return { ok: true, file: path.basename(source), tables: tables.length, counts };
    } finally {
      probe.close();
    }
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

export const backupWeekly = defineJob({
  name: 'backup-weekly',
  title: 'پشتیبانِ هفتگی + آزمونِ بازگردانی',
  description: 'یکشنبه ۳:۰۰ — پشتیبانِ تازه، بعد همان پشتیبان در پوشهٔ موقت باز و سنجیده می‌شود',
  schedule: '0 3 * * 0',
  timeout: 45 * 60_000,
  async run(ctx) {
    const made = await takeAll(ctx, { kind: 'Weekly', note: 'خودکار — هفتگی' });
    const test = await restoreTest(ctx, path.basename(made.panel));
    ctx.emit('backup.done', { kind: 'weekly', ...made });
    return { ...made, restoreTest: test };
  },
  onFail: failHandler('هفتگی'),
});

/* ------------------------------- ماهانه --------------------------------- */

export const backupMonthly = defineJob({
  name: 'backup-monthly',
  title: 'پشتیبانِ ماهانه',
  description: 'اولِ هر ماه ۳:۳۰ — نسخهٔ ماهانهٔ دیتابیسِ پنل در backups/monthly (سه ماهِ آخر) و پشتیبانِ انبار',
  schedule: '30 3 1 * *',
  timeout: 45 * 60_000,
  async run(ctx) {
    const dir = path.join(paths.backups, 'monthly');
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const target = path.join(dir, `panel-${stamp}.db`);
    const { sizeBytes } = vacuumInto(db, target);
    ctx.log(`ماهانه: ${path.basename(target)} (${Math.round(sizeBytes / 1024)} کیلوبایت)`);
    const old = (await fsp.readdir(dir)).filter((f) => /^panel-\d{4}-\d{2}\.db$/.test(f)).sort().reverse().slice(MONTHLY_KEEP);
    for (const f of old) await fsp.rm(path.join(dir, f), { force: true });
    if (old.length) ctx.log(`ماهانه‌های کهنه رفتند: ${old.join('، ')}`);
    const st = await ctx.backup.storage({ kind: 'Manual', note: 'خودکار — ماهانه' });
    if (st.ok) ctx.log(`انبار: ${st.folder}`);
    else if (st.error !== 'library_not_configured') throw new Error(st.message || st.error);
    ctx.emit('backup.done', { kind: 'monthly', panel: target, storage: st.ok ? st.path : null });
    return { panel: target, storage: st.ok ? st.path : null, removed: old };
  },
  onFail: failHandler('ماهانه'),
});

/* ------------------------- ارسال به خارجِ سرور -------------------------- */

function runOffsiteCommand(cmd, env, timeoutMs) {
  return new Promise((resolve, reject) => {
    const shell = process.platform === 'win32'
      ? { cmd: process.env.COMSPEC || 'cmd.exe', args: ['/d', '/s', '/c', cmd] }
      : { cmd: '/bin/sh', args: ['-c', cmd] };
    let out = '';
    const child = spawn(shell.cmd, shell.args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', (d) => { if (out.length < 16000) out += d; });
    child.stderr.on('data', (d) => { if (out.length < 16000) out += d; });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* رفته */ } }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`فرمانِ HLP_OFFSITE_CMD با کدِ ${code} تمام شد: ${out.slice(-500)}`));
    });
  });
}

/**
 * «بعد از هر پشتیبان»: نسخه در پوشهٔ offsite-queue/ زیرِ پوشهٔ داده می‌نشیند —
 * پوشه‌ای که هر ابزارِ همگام‌سازیِ خودِ کاربر (rclone، syncthing، یک USB)
 * می‌تواند ببرد. اگر HLP_OFFSITE_CMD تنظیم باشد همان اجرا می‌شود (با
 * OFFSITE_PATH و OFFSITE_QUEUE در محیط). هیچ سرویسِ پولی، هیچ حسابِ ابری.
 */
export const offsitePush = defineJob({
  name: 'offsite-push',
  title: 'ارسالِ پشتیبان به خارجِ سرور',
  description: 'بعد از هر پشتیبان — نسخه به پوشهٔ offsite-queue می‌رود و اگر HLP_OFFSITE_CMD باشد اجرا می‌شود',
  event: 'backup.done',
  timeout: 30 * 60_000,
  async run(ctx) {
    const queue = path.join(config.dataDir, 'offsite-queue');
    await fsp.mkdir(queue, { recursive: true });
    const copied = [];
    const src = ctx.payload?.panel;
    if (src && fs.existsSync(src)) {
      const dest = path.join(queue, path.basename(src));
      await fsp.copyFile(src, dest);
      copied.push(dest);
    }
    const storageDir = ctx.payload?.storage;
    if (storageDir && fs.existsSync(storageDir)) {
      const dest = path.join(queue, path.basename(storageDir));
      await fsp.rm(dest, { recursive: true, force: true });
      await fsp.cp(storageDir, dest, { recursive: true, force: true });
      copied.push(dest);
    }
    if (!copied.length) return { skipped: true, reason: 'در بارِ رویداد هیچ فایلِ پشتیبانی نبود' };
    ctx.log(`در صف: ${copied.map((c) => path.basename(c)).join('، ')}`);

    // صف بی‌نهایت بزرگ نشود: تازه‌ترین‌ها می‌مانند
    const entries = (await fsp.readdir(queue, { withFileTypes: true }))
      .map((e) => ({ name: e.name, full: path.join(queue, e.name), mtime: fs.statSync(path.join(queue, e.name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const e of entries.slice(OFFSITE_KEEP * 2)) await fsp.rm(e.full, { recursive: true, force: true });

    const cmd = String(process.env.HLP_OFFSITE_CMD || '').trim();
    if (cmd) {
      const out = await runOffsiteCommand(cmd, { OFFSITE_PATH: copied[0], OFFSITE_QUEUE: queue }, Math.max(10_000, offsitePush.timeout - 30_000));
      ctx.log(`HLP_OFFSITE_CMD اجرا شد${out.trim() ? `:\n${out.trim().slice(0, 4000)}` : ''}`);
    } else {
      ctx.log('HLP_OFFSITE_CMD تنظیم نیست — فقط در صف ماند');
    }
    return { queue, copied, command: Boolean(cmd) };
  },
  async onFail(ctx, err) {
    await ctx.notify('warn', `ارسالِ پشتیبان به بیرون نشد: ${err.message}`);
  },
});

export default [backupDaily, backupWeekly, backupMonthly, offsitePush];
