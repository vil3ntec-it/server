// ---------------------------------------------------------------------------
//  درِ عمومیِ به‌روزرسانیِ برنامهٔ پمپ — فقط خواندنی
//
//      GET /api/pump-updates/latest[?channel=testing] ⇒ همان شکلِ پاسخِ «آخرین انتشار»
//                                                (بی کانال = پایدار؛ شورا، ت۱)
//      GET /api/pump-updates/files/<نسخه>/<نام>  ⇒ خودِ فایل (Range پشتیبانی می‌شود)
//
//  ⚠️ نشانیِ فایل‌ها **نسبی** است (`/api/pump-updates/files/…`): برنامه آن را
//  روی همان نشانی‌ای که از آن پرسیده می‌نشاند، پس این سرور لازم نیست بداند از
//  بیرون با چه دامنه‌ای دیده می‌شود.
//  ⛔ هیچ نوشتنی این‌جا نیست، و هیچ چیزی از درخواست بی سنجش به مسیر نمی‌رسد.
//
//  🧪 پمپِ آزمایشی (۱۴۰۵/۰۷/۲۱): برنامه‌ای که ‎X-Station-Code‎ + ‎X-Station-Token‎
//  (رمزِ **برنامهٔ** همان پمپ در سرورِ خانگی) بفرستد و کدش در فهرستِ آزمایشیِ
//  پنل باشد، تازه‌ترین نسخهٔ سنجیده‌شده را می‌گیرد، با ‎tester: true‎.
//  ⛔ رمزِ غلط، رمزِ خواندن (کیو‌آر) یا پمپِ بیرونِ فهرست ⇒ مو‌به‌مو همان پاسخِ
//  همیشگی — هیچ خطایی که بگوید کدام کد هست یا رمز غلط است.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { servedFor, releaseState, filePath, testers, servedForTester } from '../pumpupdates/mirror.js';
import { getStations } from '../state.js';
import { safeCode } from '../stations/index.js';

const router = Router();

/** این درخواست از یک پمپِ آزمایشی است؟ (رمزِ برنامهٔ همان پمپ، نه رمزِ خواندن) */
async function isTester(req) {
  try {
    const code = safeCode(req.get('x-station-code'));
    const token = String(req.get('x-station-token') || '').trim();
    if (!code || !token) return false;
    const stations = getStations();
    if (!stations) return false;
    //  ⛔ اول رمز (زمان‌ثابت)، بعد فهرست — رمزِ خواندن ‎'read'‎ است، نه ‎'owner'‎
    if (stations.accessOf(code, token) !== 'owner') return false;
    return (await testers()).includes(code);
  } catch {
    return false;
  }
}

router.get('/latest', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  //  🛤️ کانال (شورا، ت۱): برنامه‌ای که نگوید ⇒ پایدار
  const channel = req.query.channel === 'testing' ? 'testing' : 'stable';
  const t = (await isTester(req)) ? await servedForTester() : null;
  const cur = t || (await servedFor(channel));
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
    channel,
    ...(t ? { tester: true } : {}),
    assets: cur.assets.map((a) => ({
      name: a.name,
      size: a.size,
      browser_download_url: base + encodeURIComponent(a.name),
    })),
  });
});

router.get('/files/:version/:name', async (req, res) => {
  const file = await filePath(req.params.version, req.params.name, { tester: await isTester(req) });
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
