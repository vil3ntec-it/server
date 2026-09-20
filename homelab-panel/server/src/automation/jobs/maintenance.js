// ---------------------------------------------------------------------------
//  نگهداریِ شبانه — لاگ، فایلِ موقت، دیتابیس، و گزارشِ به‌روزرسانی‌های امنیتی
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { defineJob } from '../engine.js';
import { db } from '../../db.js';
import { config, paths } from '../../config.js';
import { listSitesRaw } from '../../sites/registry.js';
import { workspacePaths } from '../../sites/workspace.js';
import { cleanTemp, isConfigured as libraryConfigured } from '../../storage/library.js';
import { run } from '../../lib/exec.js';

export const LOG_ROTATE_BYTES = Math.max(64 * 1024, Number(process.env.HLP_LOG_ROTATE_BYTES) || 5 * 1024 * 1024);
export const LOG_KEEP = Math.max(1, Number(process.env.HLP_LOG_KEEP) || 7);

/* ------------------------------ log-rotate ------------------------------ */

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * یک پوشهٔ لاگ: هر *.log بزرگ‌تر از آستانه ⇒ نام‌گذاریِ تاریخ‌دار + gzip؛ و از
 * هر پایه فقط N فشرده می‌ماند. فایلِ زنده با rename جدا می‌شود — نویسنده‌ها
 * (appendFileSync در sites/process.js) با نوشتنِ بعدی فایلِ تازه می‌سازند.
 */
export async function rotateDir(dir, { threshold = LOG_ROTATE_BYTES, keep = LOG_KEEP } = {}) {
  const result = { dir, rotated: [], removed: [] };
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return result; }
  const logs = entries.filter((e) => e.isFile() && /\.log$/i.test(e.name));
  for (const e of logs) {
    const full = path.join(dir, e.name);
    let size = 0;
    try { size = (await fsp.stat(full)).size; } catch { continue; }
    if (size < threshold) continue;
    const base = e.name.replace(/\.log$/i, '');
    const rotatedName = `${base}.${stamp()}.log`;
    const rotated = path.join(dir, rotatedName);
    await fsp.rename(full, rotated);
    await pipeline(fs.createReadStream(rotated), zlib.createGzip({ level: 6 }), fs.createWriteStream(`${rotated}.gz`));
    await fsp.rm(rotated, { force: true });
    result.rotated.push({ file: e.name, bytes: size, to: `${rotatedName}.gz` });
  }
  // از هر پایه فقط N فشرده
  const gz = (await fsp.readdir(dir)).filter((n) => /\.\d{8}-\d{6}\.log\.gz$/.test(n));
  const byBase = new Map();
  for (const n of gz) {
    const base = n.replace(/\.\d{8}-\d{6}\.log\.gz$/, '');
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(n);
  }
  for (const list of byBase.values()) {
    list.sort().reverse();
    for (const n of list.slice(keep)) {
      await fsp.rm(path.join(dir, n), { force: true });
      result.removed.push(n);
    }
  }
  return result;
}

export const logRotate = defineJob({
  name: 'log-rotate',
  title: 'چرخش و فشرده‌سازیِ لاگ',
  description: `هر شب ۱:۰۰ — لاگِ هر سایت و لاگ‌های پنل که از ${Math.round(LOG_ROTATE_BYTES / 1024 / 1024)} مگابایت گذشته‌اند gzip می‌شوند؛ ${LOG_KEEP} نسخه می‌ماند`,
  schedule: '0 1 * * *',
  timeout: 20 * 60_000,
  async run(ctx) {
    const dirs = new Set();
    for (const s of listSitesRaw()) dirs.add(workspacePaths(s.slug).logs);
    // پوشهٔ لاگِ خودِ پنل، اگر وجود داشته باشد (service-*.sh / start-*.bat آن‌جا می‌نویسند)
    dirs.add(path.join(config.dataDir, 'logs'));
    let rotated = 0;
    let removed = 0;
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      const r = await rotateDir(dir);
      rotated += r.rotated.length;
      removed += r.removed.length;
      for (const x of r.rotated) ctx.log(`${path.relative(config.dataDir, dir)}/${x.file} (${Math.round(x.bytes / 1024)} کیلوبایت) ⇒ ${x.to}`);
    }
    return { dirs: dirs.size, rotated, removed };
  },
});

/* ----------------------------- temp-cleanup ----------------------------- */

export const tempCleanup = defineJob({
  name: 'temp-cleanup',
  title: 'پاک‌سازیِ فایل‌های موقت',
  description: 'هر شب ۱:۳۰ — پوشهٔ Temp/ انبار (فایل‌های کهنه‌تر از ۲۴ ساعت) و پوشهٔ موقتِ پنل',
  schedule: '30 1 * * *',
  timeout: 10 * 60_000,
  async run(ctx) {
    let removed = 0;
    if (libraryConfigured()) {
      const r = await cleanTemp({ olderThanHours: 24 });
      removed += r.removed;
      ctx.log(`انبار/Temp: ${r.removed} مورد پاک شد`);
    } else {
      ctx.log('انبار تنظیم نشده — Temp/ ندارد');
    }
    const tmp = path.join(config.dataDir, 'tmp');
    if (fs.existsSync(tmp)) {
      const cutoff = Date.now() - 24 * 3600e3;
      for (const e of await fsp.readdir(tmp)) {
        const full = path.join(tmp, e);
        try {
          if ((await fsp.stat(full)).mtimeMs < cutoff) { await fsp.rm(full, { recursive: true, force: true }); removed++; }
        } catch { /* بی‌خیال */ }
      }
    }
    return { removed };
  },
});

/* ------------------------------- db-vacuum ------------------------------ */

export const dbVacuum = defineJob({
  name: 'db-vacuum',
  title: 'بهینه‌سازیِ دیتابیس (VACUUM)',
  description: 'یکشنبه ۴:۰۰ — wal_checkpoint(TRUNCATE) و VACUUM روی panel.db',
  schedule: '0 4 * * 0',
  timeout: 20 * 60_000,
  async run(ctx) {
    const size = () => { try { return fs.statSync(paths.db).size; } catch { return 0; } };
    const before = size();
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.exec('VACUUM');
    db.exec('PRAGMA optimize');
    const after = size();
    ctx.log(`${Math.round(before / 1024)} ⇒ ${Math.round(after / 1024)} کیلوبایت`);
    return { beforeBytes: before, afterBytes: after };
  },
});

/* --------------------------- security-updates --------------------------- */

/** فقط گزارش. هیچ‌وقت چیزی نصب نمی‌کند — نصب کارِ خودِ صاحبِ سرور است. */
export async function listUpgrades() {
  if (process.platform === 'linux') {
    const which = await run('sh', ['-c', 'command -v apt-get >/dev/null 2>&1 && echo apt'], { timeout: 5000 });
    if (!/apt/.test(which.stdout)) return { supported: false, tool: null, items: [] };
    const r = await run('apt', ['list', '--upgradable'], { timeout: 60_000, env: { ...process.env, LANG: 'C', DEBIAN_FRONTEND: 'noninteractive' } });
    const items = r.stdout.split('\n').map((l) => l.trim()).filter((l) => l && !/^Listing/.test(l))
      .map((l) => ({ line: l, security: /-security/i.test(l) }));
    return { supported: true, tool: 'apt', items, error: r.ok ? null : (r.stderr || r.error?.message || null) };
  }
  if (process.platform === 'win32') {
    const r = await run('winget', ['upgrade', '--include-unknown', '--accept-source-agreements', '--disable-interactivity'], { timeout: 120_000 });
    if (!r.ok && /ENOENT/.test(String(r.error?.code || ''))) return { supported: false, tool: null, items: [] };
    const items = r.stdout.split('\n').map((l) => l.trim()).filter((l) => l && !/^(Name|-{3,}|\d+ upgrades)/i.test(l) && /\S+\s+\S+\s+\S+/.test(l))
      .map((l) => ({ line: l, security: false }));
    return { supported: true, tool: 'winget', items, error: r.ok ? null : (r.stderr || null) };
  }
  return { supported: false, tool: null, items: [] };
}

export const securityUpdates = defineJob({
  name: 'security-updates',
  title: 'بررسیِ به‌روزرسانی‌های امنیتی',
  description: 'هر روز ۵:۰۰ — فقط گزارش (apt list --upgradable / winget upgrade)؛ هیچ‌چیزی نصب نمی‌شود',
  schedule: '0 5 * * *',
  timeout: 5 * 60_000,
  async run(ctx) {
    const r = await listUpgrades();
    if (!r.supported) return { skipped: true, reason: 'ابزارِ بسته‌ها روی این سیستم پیدا نشد (apt یا winget)' };
    if (r.error && !r.items.length) throw new Error(r.error);
    const security = r.items.filter((i) => i.security);
    ctx.log(`${r.tool}: ${r.items.length} به‌روزرسانی${security.length ? `، ${security.length} امنیتی` : ''}`);
    for (const i of r.items.slice(0, 60)) ctx.log(`  ${i.security ? '🔒 ' : ''}${i.line}`);
    if (security.length) await ctx.notify('warn', `${security.length} به‌روزرسانیِ امنیتی منتظرِ نصب است`);
    return { tool: r.tool, total: r.items.length, security: security.length };
  },
});

export default [logRotate, tempCleanup, dbVacuum, securityUpdates];
