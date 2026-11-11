// فایل‌منیجر واقعی — فقط داخل ریشه‌های مجاز (پوشهٔ سایت‌ها و فضای کاری پنل)
import { Router } from 'express';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { requireAuth, requireRole, userRole } from '../auth.js';
import { resolveSafe, rootsWithMeta, safeName, realPath } from '../lib/safe-path.js';
import { streamToFileCapped } from '../lib/capped-upload.js';
import { audit } from '../lib/audit.js';
import { config, paths } from '../config.js';
import { sitesRoot } from '../sites/root.js';
import { logEvent } from '../db.js';
import { invalidateSizeCache, listSitesRaw } from '../sites/registry.js';
import { featureGate } from '../lib/feature-gate.js';
import { denyUnlessShellAllowed } from '../lib/shell-owner.js';

const router = Router();
// فایل‌منیجر خطرناک‌ترین سطح است: viewer اصلاً واردش نمی‌شود
router.use(requireAuth, requireRole('operator'));
//  ⛔ روی میزبانِ عمومی پیش‌فرض خاموش — خواندن/نوشتنِ دیسکِ سرور (src/deploy.js)
router.use(featureGate('files'));

const TEXT_EXT = new Set([
  '.txt', '.md', '.json', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css', '.scss', '.html',
  '.htm', '.xml', '.yml', '.yaml', '.env', '.ini', '.conf', '.log', '.sh', '.bat', '.php', '.py',
  '.sql', '.csv', '.svg', '.toml', '.gitignore', '.htaccess',
]);

const MAX_EDIT_BYTES = 2 * 1024 * 1024;

function fail(res, code, error, extra = {}) {
  return res.status(code).json({ error, ...extra });
}

/*
 *  ⛔ (۱.۵۰.۸۶، تصمیمِ ۲-۱۱ «الف») نوشتن در **پوشهٔ سایت** = اجرای کد: سایت با کاربرِ سیستم‌عاملِ پنل اجرا می‌شود و
 *  پرونده‌ای که این‌جا نوشته شود در روشن شدنِ بعدی اجرا می‌شود (‎server.js‎، ‎package.json‎ ِ ‎npm start‎). فضای کاریِ
 *  هر سایت (‎data/sites/<نام>‎) هم همین است: ‎config.json‎ ِ آن متغیرهای محیطیِ سایت (‎NODE_OPTIONS‎) را دارد — تا
 *  ۱.۵۰.۸۵ کارگزار از همین در، مرزِ «env فقط admin/مالک» ِ ‎PUT /api/sites/:id/config‎ را دور می‌زد.
 *  پس هر نوشتن (ویرایش، بارگذاری، پوشهٔ تازه، تغییرِ نام، کپی/جابه‌جایی به آن‌جا، حذف) که به پوشهٔ سایت‌ها، ریشهٔ
 *  یک سایت یا فضای کاریِ سایت‌ها برسد — یا پوشه‌ای را جابه‌جا/حذف کند که یکی از آن‌ها داخلش است — فقط مالک
 *  (و کلیدِ محلی، که این روتر نمی‌پذیرد). خواندن آزاد ماند؛ کتابخانه و ریشهٔ افزوده هم.
 */
function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
function siteAreas() {
  const out = [sitesRoot(), paths.sitesData];
  for (const s of listSitesRaw()) if (s?.root_path) out.push(s.root_path);
  return out.filter(Boolean).map((p) => realPath(p));
}
/** این مسیر داخلِ یک پوشهٔ سایت است؟ ‎subtree‎: یا یک پوشهٔ سایت داخلِ آن (جابه‌جایی/حذفِ پوشهٔ بالاتر) */
function touchesSite(p, { subtree = false } = {}) {
  if (!p) return false;
  const real = realPath(p);
  return siteAreas().some((area) => isInside(real, area) || (subtree && isInside(area, real)));
}
function guardSiteWrite(req, res, targets) {
  if (!targets.some(([p, subtree]) => touchesSite(p, { subtree }))) return true;
  return denyUnlessShellAllowed(req, res, 'files.site');
}

/*
 *  ⛔ (۱.۵۰.۸۶، تصمیمِ ۲-۲۶ پرسشِ ۵) مقدارِ متغیرهای سایت فقط برای admin: ‎config.json‎ (env) و ‎panel.key‎ ِ فضای
 *  کاریِ هر سایت را کارگزار از فایل‌منیجر نمی‌خواند و نمی‌گیرد — همان مرزِ ‎GET /api/sites/:id‎.
 */
const SITE_SECRETS = new Set(['config.json', 'panel.key']);
function siteSecret(p) {
  const rel = path.relative(realPath(paths.sitesData), realPath(p));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const parts = rel.split(path.sep);
  return parts.length === 2 && SITE_SECRETS.has(parts[1]);
}
function guardSecretRead(req, res, p) {
  if (!siteSecret(p) || userRole(req.user?.id) === 'admin') return true;
  fail(res, 403, 'forbidden', { needed: 'admin', message: 'مقدارِ متغیرهای سایت فقط برای مدیر است' });
  return false;
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
  if (!guardSecretRead(req, res, safe.path)) return;
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
  if (!guardSiteWrite(req, res, [[safe.path]])) return;
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
  if (!guardSiteWrite(req, res, [[safeTarget.path]])) return;

  //  ⛔ `content-length` فقط ردِ زودهنگام است؛ سقفِ واقعی در جریان شمرده می‌شود
  //  وگرنه `Transfer-Encoding: chunked` (بی طول) بی‌سقف روی دیسک می‌ریخت.
  const size = Number(req.headers['content-length'] || 0);
  if (size > config.maxUploadBytes) return fail(res, 413, 'too_large', { max: config.maxUploadBytes });

  try {
    await fsp.mkdir(dir.path, { recursive: true });
    await streamToFileCapped(req, safeTarget.path, config.maxUploadBytes);
    invalidateSizeCache();
    logEvent('info', 'panel', `فایل آپلود شد: ${safeTarget.path}`);
    res.json({ ok: true, path: safeTarget.path });
  } catch (e) {
    if (e.code === 'TOO_LARGE') return fail(res, 413, 'too_large', { max: config.maxUploadBytes });
    fail(res, 500, e.code || 'upload_failed');
  }
});

router.get('/download', async (req, res) => {
  const safe = resolveSafe(req.query.path);
  if (!safe.ok) return fail(res, 403, safe.error);
  if (!guardSecretRead(req, res, safe.path)) return;
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
  if (!guardSiteWrite(req, res, [[target]])) return;
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
  const name = safeName(req.body?.newName);
  if (!name) return fail(res, 400, 'bad_name');
  const target = path.join(path.dirname(safe.path), name);
  if (!resolveSafe(target).ok) return fail(res, 403, 'path_not_allowed');
  if (!guardSiteWrite(req, res, [[safe.path, true], [target]])) return;
  try {
    await fsp.rename(safe.path, target);
    invalidateSizeCache();
    audit(req, 'file.rename', { target: `${safe.path} → ${target}` });
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
  if (!guardSiteWrite(req, res, [[target]])) return;
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
  if (!guardSiteWrite(req, res, [[from.path, true], [target]])) return;
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
  if (!guardSiteWrite(req, res, [[safe.path, true]])) return;
  try {
    await fsp.rm(safe.path, { recursive: true, force: false });
    invalidateSizeCache();
    logEvent('warn', 'panel', `حذف شد: ${safe.path}`);
    audit(req, 'file.delete', { target: safe.path });
    res.json({ ok: true });
  } catch (e) {
    audit(req, 'file.delete', { target: safe.path, ok: false, detail: e.code });
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
