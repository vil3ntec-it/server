// ---------------------------------------------------------------------------
//  درِ عمومیِ به‌روزرسانیِ برنامهٔ پمپ — فقط خواندنی
//
//      GET /api/pump-updates/latest             ⇒ همان شکلِ پاسخِ «آخرین انتشار»
//      GET /api/pump-updates/files/<نسخه>/<نام>  ⇒ خودِ فایل (Range پشتیبانی می‌شود)
//
//  ⚠️ نشانیِ فایل‌ها **نسبی** است (`/api/pump-updates/files/…`): برنامه آن را
//  روی همان نشانی‌ای که از آن پرسیده می‌نشاند، پس این سرور لازم نیست بداند از
//  بیرون با چه دامنه‌ای دیده می‌شود.
//  ⛔ هیچ نوشتنی این‌جا نیست، و هیچ چیزی از درخواست بی سنجش به مسیر نمی‌رسد.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { served, releaseState, filePath } from '../pumpupdates/mirror.js';

const router = Router();

router.get('/latest', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const cur = await served();
  if (!cur) {
    //  ⛔ پخش خاموش و هنوز هیچ نسخه‌ای منتشر نشده ⇒ «تازه‌ای نیست»، نه خطا.
    //  خطا یعنی برنامه سراغِ راهِ دیگر می‌رفت — همان چیزی که مدیر بسته است.
    if ((await releaseState()).mode === 'hold') {
      return res.json({ tag_name: 'v0.0.0', name: 'held', body: '', published_at: null, held: true, assets: [] });
    }
    return res.status(503).json({ error: 'not_ready', message: 'هنوز نسخه‌ای روی سرور نیامده است' });
  }
  const base = `${req.baseUrl}/files/${cur.version}/`;
  res.json({
    tag_name: cur.tag || `v${cur.version}`,
    name: cur.name || `v${cur.version}`,
    body: cur.notes || '',
    published_at: cur.publishedAt,
    assets: cur.assets.map((a) => ({
      name: a.name,
      size: a.size,
      browser_download_url: base + encodeURIComponent(a.name),
    })),
  });
});

router.get('/files/:version/:name', async (req, res) => {
  const file = await filePath(req.params.version, req.params.name);
  if (!file) return res.status(404).json({ error: 'not_found' });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(file, {
    acceptRanges: true,
    dotfiles: 'deny',
    headers: { 'Content-Type': /\.txt$/i.test(file) ? 'text/plain; charset=utf-8' : 'application/octet-stream' },
  });
});

export default router;
