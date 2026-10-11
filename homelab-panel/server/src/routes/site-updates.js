// ---------------------------------------------------------------------------
//  آینهٔ به‌روزرسانیِ سایت‌ها برای خودِ سایت‌ها (src/siteupdates/mirror.js)
//
//      GET /site-updates/<شناسه>/release.json
//      GET /site-updates/<شناسه>/<مسیرِ فایل>
//      POST /site-updates/<شناسه>/__refresh   «همین حالا از ریپو بگیر» (دکمهٔ «بررسی» در پنلِ سایت)
//
//  ⛔ فقط از خودِ همین کامپیوتر: اتصالِ لوکال‌هاست و بی هیچ نشانِ پراکسی/تونل.
//     سایت‌ها روی همین کامپیوترند؛ از اینترنت این در بسته است (۴۰۴).
// ---------------------------------------------------------------------------
import express from 'express';
import { servedFile, refreshSite } from '../siteupdates/mirror.js';
import { logEvent } from '../db.js';

const router = express.Router();
const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;
const PROXY_HEADERS = ['x-forwarded-for', 'cf-connecting-ip', 'cf-ray', 'x-real-ip', 'forwarded', 'via', 'cdn-loop'];

export function fromThisComputer(req) {
  if (!LOOPBACK.test(String(req.socket?.remoteAddress || ''))) return false;
  return !PROXY_HEADERS.some((h) => req.headers[h]);
}

router.get(/^\/([a-z0-9-]{1,40})\/(.+)$/, (req, res) => {
  if (!fromThisComputer(req)) return res.status(404).end();
  let rel;
  try { rel = decodeURIComponent(req.params[1]); } catch { return res.status(404).end(); }
  const file = servedFile(req.params[0], rel);
  if (!file) return res.status(404).end();
  res.set('Cache-Control', 'no-store');
  res.sendFile(file, { dotfiles: 'allow' }, (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

router.post(/^\/([a-z0-9-]{1,40})\/__refresh$/, async (req, res) => {
  if (!fromThisComputer(req)) return res.status(404).end();
  const out = await refreshSite(req.params[0], { log: (m) => logEvent('info', 'site-mirror', m) });
  if (!out) return res.status(404).end();
  res.set('Cache-Control', 'no-store').json(out);
});

export default router;
