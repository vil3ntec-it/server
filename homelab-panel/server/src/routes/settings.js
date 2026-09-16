// تنظیمات پنل: نام سرور، لوگو، تم، زبان، ریشه‌های اسکن و فایل‌منیجر
import { Router } from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { requireAuth, requireWriteRole } from '../auth.js';
import { allSettings, getSetting, setSetting, logEvent } from '../db.js';
import { config, paths } from '../config.js';
import { versionInfo } from '../version.js';
import { sitesRoot, setSitesRoot, NEXT_TO_SERVER } from '../sites/root.js';
import { folderReport, moveSitesIntoFolder } from '../sites/portable.js';
import { normalizeDomain } from '../sites/registry.js';
import { adminUrl, publicState as tunnelState } from '../tunnel.js';
import {
  GATE_HEADER,
  GATE_PREFIX,
  issueGateKey,
  listGateDevices,
  revokeGateDevice,
} from '../api/admin-gate.js';

const router = Router();

const LOGO_TYPES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico',
};

function logoFile() {
  const name = getSetting('logo_file', null);
  if (!name) return null;
  const full = path.join(paths.uploads, name);
  return fs.existsSync(full) ? full : null;
}

// لوگو باید در صفحهٔ ورود هم دیده شود، پس بدون احراز هویت سرو می‌شود
router.get('/logo', (req, res) => {
  const file = logoFile();
  if (!file) return res.status(404).end();
  res.sendFile(file);
});

// اطلاعات عمومیِ لازم برای صفحهٔ ورود (بدون هیچ دادهٔ حساس)
router.get('/public', (req, res) => {
  res.json({
    serverName: getSetting('server_name', os.hostname()),
    hasLogo: Boolean(logoFile()),
    language: getSetting('language', 'fa'),
    theme: getSetting('theme', 'dark'),
  });
});

router.use(requireAuth, requireWriteRole('admin'));

router.get('/', (req, res) => {
  const s = allSettings();
  delete s.jwt_secret; // هرگز بیرون نمی‌رود
  res.json({
    settings: {
      serverName: s.server_name ?? os.hostname(),
      language: s.language ?? 'fa',
      theme: s.theme ?? 'dark',
      scanRoots: s.scan_roots ?? null,
      extraFileRoots: s.extra_file_roots ?? [],
      hasLogo: Boolean(logoFile()),
      // راه‌اندازی خودکار سایت تازه: دامنه، پوشهٔ داده و آدرس اینترنتی
      siteAutoSetup: s.site_autosetup !== false,
      sitesBaseDomain: s.sites_base_domain ?? null,
    },
    paths: {
      dataDir: config.dataDir,
      sitesRoot: sitesRoot(),
      sitesRootDefault: config.sitesRoot,
      sitesRootNextToServer: NEXT_TO_SERVER,
      uploads: paths.uploads,
    },
    system: {
      hostname: os.hostname(),
      platform: process.platform,
      node: process.version,
      panelPort: config.port,
      panelVersion: versionInfo.version,
      panelBuild: versionInfo.build,
      panelRoot: versionInfo.root,
    },
  });
});

router.put('/', async (req, res) => {
  const body = req.body || {};
  if (typeof body.serverName === 'string' && body.serverName.trim()) {
    setSetting('server_name', body.serverName.trim().slice(0, 60));
  }
  if (['fa', 'en', 'ar', 'ps'].includes(body.language)) setSetting('language', body.language);
  if (['dark', 'light', 'system'].includes(body.theme)) setSetting('theme', body.theme);
  if (Array.isArray(body.scanRoots)) {
    setSetting('scan_roots', body.scanRoots.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim()));
  }
  if (Array.isArray(body.extraFileRoots)) {
    setSetting(
      'extra_file_roots',
      body.extraFileRoots.filter((r) => typeof r === 'string' && r.trim()).map((r) => path.resolve(r.trim()))
    );
  }
  if ('sitesRoot' in body) {
    const moved = await setSitesRoot(body.sitesRoot);
    if (!moved.ok) return res.status(400).json(moved);
  }
  if (typeof body.siteAutoSetup === 'boolean') setSetting('site_autosetup', body.siteAutoSetup);
  if ('sitesBaseDomain' in body) {
    const raw = String(body.sitesBaseDomain ?? '').trim();
    if (!raw) setSetting('sites_base_domain', null);
    else {
      const clean = normalizeDomain(raw);
      if (!clean) return res.status(400).json({ error: 'invalid_domain' });
      setSetting('sites_base_domain', clean);
    }
  }
  logEvent('info', 'panel', 'تنظیمات پنل بروزرسانی شد');
  res.json({ ok: true });
});

// آپلود لوگو — بدنهٔ خام تصویر
router.put('/logo', async (req, res) => {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim();
  const ext = LOGO_TYPES[type];
  if (!ext) return res.status(415).json({ error: 'unsupported_type', allowed: Object.keys(LOGO_TYPES) });
  const size = Number(req.headers['content-length'] || 0);
  if (size > 3 * 1024 * 1024) return res.status(413).json({ error: 'too_large' });

  const name = `logo${ext}`;
  const target = path.join(paths.uploads, name);
  try {
    await fsp.mkdir(paths.uploads, { recursive: true });
    // لوگوهای قبلی با پسوند دیگر پاک شوند
    for (const e of Object.values(LOGO_TYPES)) {
      if (e !== ext) await fsp.rm(path.join(paths.uploads, `logo${e}`), { force: true });
    }
    await pipeline(req, fs.createWriteStream(target));
    setSetting('logo_file', name);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/logo', async (req, res) => {
  const file = logoFile();
  if (file) await fsp.rm(file, { force: true });
  setSetting('logo_file', null);
  res.json({ ok: true });
});

/* ── پوشهٔ قابل‌حمل ────────────────────────────────────────────────────────
   «اگر همین الان پوشه را بردارم و ببرم، چه چیزی جا می‌ماند؟» — جوابش را
   پیش از جابه‌جایی باید دید، نه بعد از اینکه سرور روی کامپیوترِ تازه بالا
   نیامد. */
router.get('/portable', (req, res) => {
  res.json({ ok: true, ...folderReport() });
});

/* آوردنِ سایت‌ها به داخلِ پوشه — فایل‌ها واقعاً جابه‌جا می‌شوند، پس فقط با
   درخواستِ صریح. گزارش می‌گوید کدام رفت و کدام نه. */
router.post('/portable/move-sites', async (req, res) => {
  try {
    const report = await moveSitesIntoFolder({ actor: req.user?.username || 'admin' });
    logEvent('info', 'panel', `سایت‌ها به داخلِ پوشهٔ داده آورده شدند (${report.moved.length} مورد)`);
    res.json(report);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ── درِ مدیر: رسیدن به کلِ سرور از راهِ دامنه ──────────────────────────────
   تونل فقط پورتِ عمومی را بیرون می‌دهد و پنل هرگز به اینترنت درز نمی‌کند —
   آن تصمیم سرِ جایش است. برنامهٔ مدیر اما باید از بیرونِ خانه به همه‌چیز
   برسد، پس درِ جداگانه‌ای دارد که پشتِ کلیدِ مخصوصِ همان دستگاه است.

   ⚠️ صدورِ کلید فقط از همین مسیرِ خصوصی ممکن است — یعنی از داخلِ خانه و با
   ورودِ مدیر. از خودِ دامنه هیچ‌وقت نمی‌شود کلیدِ تازه گرفت، وگرنه آن در
   خودش را باز می‌کرد. */
router.get('/remote', (req, res) => {
  const tunnel = tunnelState();
  const admin = adminUrl();
  res.json({
    ok: true,
    /*
     *  آدرسی که برنامه باید از بیرونِ خانه بزند.
     *
     *  ⚠️ اگر دامنه‌ای ساخته شده، آدرسِ اختصاصیِ برنامه (admin.<دامنه>)
     *  ترجیح دارد: ثابت است، جدا از سایت، و پشتش فقط همان در است. آدرسِ
     *  تونلِ سریع فقط وقتی می‌آید که دامنه‌ای نباشد — و آن آدرس با هر بار
     *  روشن شدنِ سرور عوض می‌شود.
     */
    url: admin || tunnel.url || null,
    adminUrl: admin,
    tunnelUrl: tunnel.url || null,
    hostname: tunnel.hostname || null,
    running: tunnel.status === 'running',
    permanent: Boolean(tunnel.permanent),
    gatePath: GATE_PREFIX,
    gateHeader: GATE_HEADER,
    devices: listGateDevices(),
  });
});

/* کلیدِ تازه برای یک دستگاه. خودِ کلید فقط همین یک بار برمی‌گردد و هیچ‌جا
   ذخیره نمی‌شود؛ اگر گم شد، کلیدِ تازه صادر می‌شود. */
router.post('/remote/device', (req, res) => {
  const name = String(req.body?.name || '').trim() || 'برنامهٔ مدیر';
  const deviceId = String(req.body?.deviceId || '').trim();
  const issued = issueGateKey({ deviceId, name, actor: req.user?.username || 'admin' });
  const tunnel = tunnelState();
  res.json({
    ok: true,
    ...issued,
    url: adminUrl() || tunnel.url || null,
    gatePath: GATE_PREFIX,
    gateHeader: GATE_HEADER,
  });
});

/* گوشیِ گم‌شده: کلیدش همین‌جا باطل می‌شود و همان لحظه از کار می‌افتد */
router.delete('/remote/device/:id', (req, res) => {
  res.json({ ok: revokeGateDevice(req.params.id, req.user?.username || 'admin') });
});

export default router;
