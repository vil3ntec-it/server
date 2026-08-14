// ---------------------------------------------------------------------------
// فضای کاریِ مستقل هر سایت
// هر سایت پوشهٔ جدا دارد؛ هیچ چیزی بین سایت‌ها مشترک نیست:
//   data/sites/<slug>/config.json   تنظیمات اختصاصی همان سایت
//   data/sites/<slug>/logs/         لاگ اختصاصی
//   data/sites/<slug>/backups/      بکاپ اختصاصی
//   data/sites/<slug>/db/           دیتابیس اختصاصی
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../config.js';

export function slugify(name) {
  const base = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'site';
}

export function workspaceDir(slug) {
  return path.join(paths.sitesData, slug);
}

export function workspacePaths(slug) {
  const base = workspaceDir(slug);
  return {
    base,
    config: path.join(base, 'config.json'),
    logs: path.join(base, 'logs'),
    logFile: path.join(base, 'logs', 'site.log'),
    backups: path.join(base, 'backups'),
    db: path.join(base, 'db'),
  };
}

export function ensureWorkspace(slug) {
  const p = workspacePaths(slug);
  fs.mkdirSync(p.logs, { recursive: true });
  fs.mkdirSync(p.backups, { recursive: true });
  fs.mkdirSync(p.db, { recursive: true });
  if (!fs.existsSync(p.config)) {
    fs.writeFileSync(p.config, JSON.stringify({ env: {}, createdAt: Date.now() }, null, 2), 'utf8');
  }
  return p;
}

export function readSiteConfig(slug) {
  const p = workspacePaths(slug);
  try {
    return JSON.parse(fs.readFileSync(p.config, 'utf8'));
  } catch {
    return { env: {} };
  }
}

export function writeSiteConfig(slug, cfg) {
  const p = ensureWorkspace(slug);
  fs.writeFileSync(p.config, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

export async function removeWorkspace(slug) {
  await fsp.rm(workspaceDir(slug), { recursive: true, force: true });
}

// متغیرهای محیطیِ اختصاصی هر سایت — تضمین می‌کند هیچ سایتی به دادهٔ سایت دیگر نرسد
export function siteEnv(site) {
  const p = workspacePaths(site.slug);
  const cfg = readSiteConfig(site.slug);
  return {
    ...process.env,
    ...(cfg.env || {}),
    PORT: String(site.port || ''),
    SITE_NAME: site.name,
    SITE_SLUG: site.slug,
    SITE_ROOT: site.root_path,
    SITE_DATA_DIR: p.base,
    SITE_DB_DIR: p.db,
    SITE_BACKUP_DIR: p.backups,
    SITE_LOG_DIR: p.logs,
  };
}
