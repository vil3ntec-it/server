// ---------------------------------------------------------------------------
//  API کتابخانه — انتخابِ محلِ ذخیره‌سازی و دیدنِ آن‌چه داخلش است
//
//  با حسابِ مدیرِ پنل، یا با کلیدِ محلیِ برنامهٔ رویِ همین کامپیوتر.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import path from 'node:path';
import { requireLocalOrAuth } from '../local-key.js';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';
import {
  overview,
  suggestRoot,
  setLibraryRoot,
  ensureLibrary,
  canUse,
  createSiteFolder,
  createAppFolder,
  listBranch,
  cleanTemp,
  libraryRoot,
  libraryPath,
  safeFolderName,
} from '../storage/library.js';
import { scanStray, planMove, applyMove } from '../storage/migrate.js';

const router = Router();
router.use(requireLocalOrAuth);

// ------------------------------ وضعیت ---------------------------------------
router.get('/', async (req, res) => {
  const withSize = req.query.size !== '0';
  res.json({ ok: true, ...(await overview({ withSize })), suggested: suggestRoot() });
});

router.get('/branch/:name', async (req, res) => {
  const allowed = ['Sites', 'Apps', 'Backups', 'Downloads', 'Temp', 'Unsorted', 'Server'];
  if (!allowed.includes(req.params.name)) {
    return res.status(400).json({ ok: false, error: 'bad_branch' });
  }
  res.json({ ok: true, branch: req.params.name, items: await listBranch(req.params.name) });
});

// --------------------------- انتخابِ محل ------------------------------------
/* بررسی می‌کند بدونِ اینکه چیزی را عوض کند — برای دکمهٔ «بررسی» در برنامه */
router.post('/check', async (req, res) => {
  const target = String(req.body?.root || '').trim();
  if (!target) return res.status(400).json({ ok: false, error: 'empty_path', message: 'مسیر را بنویسید' });
  res.json(await canUse(target));
});

router.post('/setup', async (req, res) => {
  const target = String(req.body?.root || '').trim() || libraryRoot();
  const result = await setLibraryRoot(target);
  audit(req, 'storage.setRoot', { target, ok: result.ok });
  if (!result.ok) return res.status(400).json(result);
  res.json({ ok: true, ...result, ...(await overview({ withSize: false })) });
});

/* فقط ساختار را دوباره می‌سازد (اگر کسی پوشه‌ای را دستی پاک کرده باشد) */
router.post('/repair', async (req, res) => {
  res.json({ ok: true, ...(await ensureLibrary()) });
});

// ------------------------- پوشهٔ پروژه‌ها ------------------------------------
router.post('/sites', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ ok: false, error: 'no_name', message: 'نامِ سایت را بنویسید' });
  res.json({ ok: true, folders: await createSiteFolder(name) });
});

router.post('/apps', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ ok: false, error: 'no_name', message: 'نامِ برنامه را بنویسید' });
  res.json({ ok: true, folders: await createAppFolder(name) });
});

// ---------------------- مرتب کردنِ پراکنده‌ها --------------------------------
router.get('/scan', async (req, res) => {
  // جاهایی که پیش از کتابخانه ممکن بود پوشه ساخته شود
  const roots = [config.sitesRoot, path.dirname(config.dataDir)];
  if (req.query.root) roots.push(String(req.query.root));
  res.json({ ok: true, found: await scanStray({ extraRoots: roots }) });
});

router.post('/organize/preview', async (req, res) => {
  res.json({ ok: true, ...(await planMove(req.body?.items || [])) });
});

router.post('/organize/apply', async (req, res) => {
  const items = req.body?.items || [];
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: 'nothing_to_move' });
  }
  // پاک کردنِ منبع فقط وقتی صریحاً خواسته شود
  audit(req, 'storage.organize', { target: `${items.length} پوشه`, detail: req.body?.removeSource === true ? 'با پاک کردنِ منبع' : 'فقط کپی' });
  res.json({ ok: true, ...(await applyMove(items, { removeSource: req.body?.removeSource === true })) });
});

// ------------------------------ نظافت ---------------------------------------
router.post('/clean-temp', async (req, res) => {
  res.json({ ok: true, ...(await cleanTemp({ olderThanHours: Number(req.body?.olderThanHours) || 24 })) });
});

// مسیرِ پیشنهادی برای یک نامِ تازه — تا برنامه بتواند پیش از ساخت نشانش دهد
router.get('/suggest-folder', (req, res) => {
  const name = safeFolderName(req.query.name || '');
  const branch = req.query.branch === 'Apps' ? 'Apps' : 'Sites';
  res.json({ ok: true, name, path: libraryPath(branch, name) });
});

export default router;
