// فایل‌منیجر واقعی — فقط داخل ریشه‌های مجاز (پوشهٔ سایت‌ها و فضای کاری پنل)
import { Router } from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { requireAuth, requireRole } from '../auth.js';
import { resolveSafe, rootsWithMeta } from '../lib/safe-path.js';
import { config } from '../config.js';
import { sitesRoot } from '../sites/root.js';
import { logEvent } from '../db.js';
import { invalidateSizeCache } from '../sites/registry.js';

const router = Router();
// فایل‌منیجر خطرناک‌ترین سطح است: viewer اصلاً واردش نمی‌شود
router.use(requireAuth, requireRole('operator'));

const TEXT_EXT = new Set([
  '.txt', '.md', '.json', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css', '.scss', '.html',
  '.htm', '.xml', '.yml', '.yaml', '.env', '.ini', '.conf', '.log', '.sh', '.bat', '.php', '.py',
  '.sql', '.csv', '.svg', '.toml', '.gitignore', '.htaccess',
]);

const MAX_EDIT_BYTES = 2 * 1024 * 1024;

function fail(res, code, error, extra = {}) {
  return res.status(code).json({ error, ...extra });
}

router.get('/roots', (req, res) => {
  res.json({ roots: rootsWithMeta(), sitesRoot: sitesRoot() });
});

router.get('/list', async (req, res) => {
  const safe = resolveSafe(req.query.path || sitesRoot());
  if (!safe.ok) return fail(res, 403, safe.error, { roots: safe.roots });
  let entries;
  try {
    entries = await fsp.readdir(safe.path, { withFileTypes: true });
  } catch (e) {
    return fail(res, 404, e.code === 'ENOENT' ? 'not_found' : e.code || 'read_failed');
  }

  const items = [];
  for (const e of entries) {
    const full = path.join(safe.path, e.name);
    let st = null;
    try {
      st = await fsp.lstat(full);
    } catch { /* ناپدید شد */ }
    items.push({
      name: e.name,
      path: full,
      isDir: e.isDirectory(),
      isLink: e.isSymbolicLink(),
      size: st && e.isFile() ? st.size : null,
      modified: st ? st.mtimeMs : null,
      editable: e.isFile() && (TEXT_EXT.has(path.extname(e.name).toLowerCase()) || !path.extname(e.name)),
    });
  }
  items.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));

  const parent = path.dirname(safe.path);
  const parentSafe = resolveSafe(parent);
  res.json({
    path: safe.path,
    root: safe.root,
    parent: parentSafe.ok && parent !== safe.path ? parent : null,
    items,
  });
});

router.get('/read', async (req, res) => {
  const safe = resolveSafe(req.query.path);
  if (!safe.ok) return fail(res, 403, safe.error);
  try {
    const st = await fsp.stat(safe.path);
    if (!st.isFile()) return fail(res, 400, 'not_a_file');
    if (st.size > MAX_EDIT_BYTES) return fail(res, 413, 'file_too_large', { size: st.size });
    const content = await fsp.readFile(safe.path, 'utf8');
    res.json({ path: safe.path, content, size: st.size, modified: st.mtimeMs });
  } catch (e) {
    fail(res, 404, e.code || 'read_failed');
  }
});

router.put('/write', async (req, res) => {
  const safe = resolveSafe(req.body?.path);
  if (!safe.ok) return fail(res, 403, safe.error);
  if (typeof req.body?.content !== 'string') return fail(res, 400, 'content_required');
  try {
    await fsp.writeFile(safe.path, req.body.content, 'utf8');
    invalidateSizeCache();
    logEvent('info', 'panel', `فایل ویرایش شد: ${safe.path}`);
    res.json({ ok: true });
  } catch (e) {
    fail(res, 500, e.code || 'write_failed');
  }
});

// آپلود: بدنهٔ خام فایل (بدون multipart) — از حافظه عبور نمی‌کند، مستقیم روی دیسک
router.put('/upload', async (req, res) => {
  const dir = resolveSafe(req.query.dir);
  if (!dir.ok) return fail(res, 403, dir.error);
  const name = path.basename(String(req.query.name || ''));
  if (!name || name === '.' || name === '..') return fail(res, 400, 'bad_name');

  const target = path.join(dir.path, name);
  const safeTarget = resolveSafe(target);
  if (!safeTarget.ok) return fail(res, 403, safeTarget.error);

  const size = Number(req.headers['content-length'] || 0);
  if (size > config.maxUploadBytes) return fail(res, 413, 'too_large', { max: config.maxUploadBytes });

  try {
    await fsp.mkdir(dir.path, { recursive: true });
    await pipeline(req, fs.createWriteStream(safeTarget.path));
    invalidateSizeCache();
    logEvent('info', 'panel', `فایل آپلود شد: ${safeTarget.path}`);
    res.json({ ok: true, path: safeTarget.path });
  } catch (e) {
    fail(res, 500, e.code || 'upload_failed');
  }
});

router.get('/download', async (req, res) => {
  const safe = resolveSafe(req.query.path);
  if (!safe.ok) return fail(res, 403, safe.error);
  try {
    const st = await fsp.stat(safe.path);
    if (!st.isFile()) return fail(res, 400, 'not_a_file');
    res.download(safe.path);
  } catch (e) {
    fail(res, 404, e.code || 'not_found');
  }
});

router.post('/mkdir', async (req, res) => {
  const parent = resolveSafe(req.body?.path);
  if (!parent.ok) return fail(res, 403, parent.error);
  const name = path.basename(String(req.body?.name || '').trim());
  if (!name || name === '.' || name === '..') return fail(res, 400, 'bad_name');
  const target = path.join(parent.path, name);
  if (!resolveSafe(target).ok) return fail(res, 403, 'path_not_allowed');
  try {
    await fsp.mkdir(target, { recursive: false });
    res.json({ ok: true, path: target });
  } catch (e) {
    fail(res, 400, e.code || 'mkdir_failed');
  }
});

router.post('/rename', async (req, res) => {
  const safe = resolveSafe(req.body?.path);
  if (!safe.ok) return fail(res, 403, safe.error);
  const name = path.basename(String(req.body?.newName || '').trim());
  if (!name || name === '.' || name === '..') return fail(res, 400, 'bad_name');
  const target = path.join(path.dirname(safe.path), name);
  if (!resolveSafe(target).ok) return fail(res, 403, 'path_not_allowed');
  try {
    await fsp.rename(safe.path, target);
    invalidateSizeCache();
    res.json({ ok: true, path: target });
  } catch (e) {
    fail(res, 400, e.code || 'rename_failed');
  }
});

async function copyRecursive(from, to) {
  await fsp.cp(from, to, { recursive: true, errorOnExist: true, force: false });
}

router.post('/copy', async (req, res) => {
  const from = resolveSafe(req.body?.from);
  const toDir = resolveSafe(req.body?.to);
  if (!from.ok || !toDir.ok) return fail(res, 403, 'path_not_allowed');
  const target = path.join(toDir.path, path.basename(from.path));
  if (!resolveSafe(target).ok) return fail(res, 403, 'path_not_allowed');
  try {
    await copyRecursive(from.path, target);
    invalidateSizeCache();
    res.json({ ok: true, path: target });
  } catch (e) {
    fail(res, 400, e.code || 'copy_failed');
  }
});

router.post('/move', async (req, res) => {
  const from = resolveSafe(req.body?.from);
  const toDir = resolveSafe(req.body?.to);
  if (!from.ok || !toDir.ok) return fail(res, 403, 'path_not_allowed');
  const target = path.join(toDir.path, path.basename(from.path));
  if (!resolveSafe(target).ok) return fail(res, 403, 'path_not_allowed');
  try {
    await fsp.rename(from.path, target);
    invalidateSizeCache();
    res.json({ ok: true, path: target });
  } catch (e) {
    if (e.code === 'EXDEV') {
      // بین دو دیسک مختلف: کپی + حذف
      try {
        await copyRecursive(from.path, target);
        await fsp.rm(from.path, { recursive: true, force: true });
        return res.json({ ok: true, path: target });
      } catch (e2) {
        return fail(res, 400, e2.code || 'move_failed');
      }
    }
    fail(res, 400, e.code || 'move_failed');
  }
});

router.delete('/', async (req, res) => {
  const safe = resolveSafe(req.query.path);
  if (!safe.ok) return fail(res, 403, safe.error);
  // ریشه‌ها را نمی‌شود پاک کرد
  if (rootsWithMeta().some((r) => r.path === safe.path)) return fail(res, 400, 'cannot_delete_root');
  try {
    await fsp.rm(safe.path, { recursive: true, force: false });
    invalidateSizeCache();
    logEvent('warn', 'panel', `حذف شد: ${safe.path}`);
    res.json({ ok: true });
  } catch (e) {
    fail(res, 400, e.code || 'delete_failed');
  }
});

router.get('/search', async (req, res) => {
  const safe = resolveSafe(req.query.path || sitesRoot());
  if (!safe.ok) return fail(res, 403, safe.error);
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return fail(res, 400, 'query_too_short');

  const results = [];
  const stack = [safe.path];
  let visited = 0;
  while (stack.length && results.length < 300 && visited < 50000) {
    const cur = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      visited++;
      const full = path.join(cur, e.name);
      if (e.name.toLowerCase().includes(q)) {
        let st = null;
        try {
          st = await fsp.lstat(full);
        } catch { /* ناپدید شد */ }
        results.push({
          name: e.name,
          path: full,
          isDir: e.isDirectory(),
          size: st && e.isFile() ? st.size : null,
          modified: st ? st.mtimeMs : null,
        });
      }
      if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git') stack.push(full);
    }
  }
  res.json({ path: safe.path, query: q, results, truncated: results.length >= 300 });
});

export default router;
