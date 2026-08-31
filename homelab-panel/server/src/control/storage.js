// ---------------------------------------------------------------------------
//  انبار — هر پروژه پوشهٔ خودش را دارد و پا از آن بیرون نمی‌گذارد
//
//  ریشهٔ انبار در اولین راه‌اندازی انتخاب می‌شود (مثلاً D:\Projects یا
//  E:\ServerData) و ساختارِ زیرش را خودِ برنامه می‌سازد:
//
//      <ریشه>/ShopApp/{app,config,data,database,backups,logs,releases,uploads,cache}
//
//  داخلِ هر پوشهٔ پروژه یک فایلِ project.json هست که project_id را نگه می‌دارد؛
//  اگر روزی پوشه‌ای جابه‌جا شد، باز هم معلوم است مالِ کدام پروژه است.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { getSetting, setSetting } from '../db.js';
import { audit } from './audit.js';

/** پوشه‌هایی که هر پروژه — بسته به نوعش — دارد */
const BASE_FOLDERS = ['app', 'config', 'data', 'backups', 'logs', 'releases'];
const EXTRA_BY_TYPE = {
  android: ['uploads'],
  desktop: [],
  website: ['database', 'uploads', 'cache'],
  webapp: ['database', 'uploads', 'cache'],
  backend: ['database', 'uploads', 'cache'],
  api: ['database', 'uploads', 'cache'],
  websocket: ['cache'],
  database: ['database'],
  service: ['cache'],
};

export function foldersFor(type) {
  return [...BASE_FOLDERS, ...(EXTRA_BY_TYPE[type] || [])];
}

const DEFAULT_ROOT = path.join(config.dataDir, 'Projects');

/** ریشهٔ انبار — از تنظیمات، وگرنه کنارِ دادهٔ پنل */
export function storageRoot() {
  const saved = getSetting('cc_storage_root', null);
  return saved && String(saved).trim() ? path.resolve(String(saved).trim()) : DEFAULT_ROOT;
}

export function storageChosen() {
  return Boolean(getSetting('cc_storage_root', null));
}

/** ریشهٔ تازه را می‌سنجد (واقعاً می‌نویسد و پاک می‌کند) و ذخیره می‌کند */
export async function setStorageRoot(target, actor = 'admin') {
  const resolved = path.resolve(String(target || '').trim());
  if (!resolved || resolved === path.parse(resolved).root) throw new Error('invalid_path');
  await fsp.mkdir(resolved, { recursive: true });
  const probe = path.join(resolved, `.write-test-${Date.now()}`);
  await fsp.writeFile(probe, 'ok');
  await fsp.rm(probe, { force: true });
  const previous = storageRoot();
  setSetting('cc_storage_root', resolved);
  audit({ actor, action: 'storage.root.set', entity: 'storage', detail: { from: previous, to: resolved } });
  return { root: resolved, previous };
}

export function projectDir(project) {
  if (!project?.slug) throw new Error('project_required');
  return path.join(storageRoot(), project.slug);
}

/** پوشه‌های پروژه را می‌سازد (اگر بودند دست نمی‌خورند) و شناسنامه را می‌نویسد */
export async function ensureProjectStorage(project) {
  const dir = projectDir(project);
  await fsp.mkdir(dir, { recursive: true });
  const created = [];
  for (const folder of foldersFor(project.type)) {
    const full = path.join(dir, folder);
    if (!fs.existsSync(full)) {
      await fsp.mkdir(full, { recursive: true });
      created.push(folder);
    }
  }
  await fsp.writeFile(
    path.join(dir, 'project.json'),
    JSON.stringify(
      {
        project_id: project.project_id,
        slug: project.slug,
        name: project.name,
        type: project.type,
        created_at: project.created_at,
        managed_by: 'control-center',
      },
      null,
      2
    ),
    'utf8'
  );
  return { dir, created, folders: foldersFor(project.type) };
}

/** حجم و تعدادِ فایلِ یک پوشه — با سقفِ تعداد تا روی پوشه‌های عظیم گیر نکند */
export async function dirStats(dir, { maxEntries = 200000 } = {}) {
  let bytes = 0;
  let files = 0;
  let dirs = 0;
  let truncated = false;

  async function visit(current) {
    if (truncated) return;
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files + dirs > maxEntries) {
        truncated = true;
        return;
      }
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        dirs++;
        await visit(full);
      } else if (entry.isFile()) {
        try {
          const st = await fsp.stat(full);
          bytes += st.size;
          files++;
        } catch { /* فایل همان لحظه پاک شد */ }
      }
    }
  }

  if (!fs.existsSync(dir)) return { exists: false, bytes: 0, files: 0, dirs: 0, truncated: false };
  await visit(dir);
  return { exists: true, bytes, files, dirs, truncated };
}

/** فضای آزادِ دیسکی که ریشهٔ انبار رویش است */
export async function diskFree(target = storageRoot()) {
  try {
    const st = await fsp.statfs(target);
    const total = st.blocks * st.bsize;
    const free = st.bavail * st.bsize;
    return { total, free, used: total - free, usage: total ? Math.round(((total - free) / total) * 100) : null };
  } catch {
    return { total: null, free: null, used: null, usage: null };
  }
}

/** نمای کلیِ انبار — برای صفحهٔ Storage */
export async function storageOverview(projects) {
  const root = storageRoot();
  const disk = await diskFree(root);
  const items = [];
  for (const p of projects) {
    const dir = path.join(root, p.slug);
    const stats = await dirStats(dir);
    const backups = await dirStats(path.join(dir, 'backups'));
    const logs = await dirStats(path.join(dir, 'logs'));
    const releases = await dirStats(path.join(dir, 'releases'));
    items.push({
      project_id: p.project_id,
      id: p.id,
      name: p.name,
      slug: p.slug,
      type: p.type,
      dir,
      exists: stats.exists,
      bytes: stats.bytes,
      files: stats.files,
      backupsBytes: backups.bytes,
      logsBytes: logs.bytes,
      releasesBytes: releases.bytes,
    });
  }
  return { root, chosen: storageChosen(), disk, items, total: items.reduce((s, i) => s + i.bytes, 0) };
}

/** پوشه‌های زیرِ ریشه که در دیتابیس پروژه‌ای برایشان نیست */
export async function orphanFolders(projects) {
  const root = storageRoot();
  if (!fs.existsSync(root)) return [];
  const known = new Set(projects.map((p) => p.slug));
  const out = [];
  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || known.has(entry.name)) continue;
    let meta = null;
    try {
      meta = JSON.parse(await fsp.readFile(path.join(root, entry.name, 'project.json'), 'utf8'));
    } catch { /* پوشهٔ بی‌ربط */ }
    out.push({ folder: entry.name, path: path.join(root, entry.name), meta });
  }
  return out;
}

/** مسیرِ درخواستی باید داخلِ پوشهٔ همین پروژه باشد — وگرنه رد */
export function insideProject(project, target) {
  const base = projectDir(project);
  const resolved = path.resolve(base, String(target || '.'));
  const rel = path.relative(base, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}
