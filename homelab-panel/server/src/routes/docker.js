// ---------------------------------------------------------------------------
//  مسیرهای Docker
//
//  مرزِ دسترسی، نه یک قاعدهٔ کلی برای همهٔ مسیرها:
//
//      viewer     می‌بیند — فهرست، جزئیات، لاگ، آمار
//      operator   روشن/خاموش/ری‌استارت می‌کند
//      admin      حذف می‌کند
//
//  چرا حذف جداست: start و stop برگشت‌پذیرند، rm نیست. یک حجمِ پاک‌شده
//  همان دادهٔ رفته است. پس همان مرزی که در بقیهٔ پنل بین operator و admin
//  هست، این‌جا هم هست.
//
//  هر کارِ تغییردهنده در دفترِ کارها ثبت می‌شود — با نتیجه‌اش، نه فقط با
//  خودِ درخواست. یک «stop ناموفق» هم باید در دفتر دیده شود.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { requireAuth, requireWriteRole } from '../auth.js';
import { audit } from '../lib/audit.js';
import {
  available,
  listContainers,
  listImages,
  listVolumes,
  listNetworks,
  stats,
  inspect,
  logs,
  containerAction,
  removeContainer,
  removeImage,
  removeVolume,
  summary,
} from '../system/docker.js';

const router = Router();

// هیچ‌کدام از این مسیرها بدونِ ورود باز نیست
router.use(requireAuth);

/**
 * خطاهای ماژول به کدِ HTTP نگاشت می‌شوند.
 *
 * چرا مهم است: «شناسهٔ نامعتبر» خطای کاربر است (۴۰۰) ولی «داکر جواب نداد»
 * خطای سرور (۵۰۳). اگر همه ۵۰۰ برگردند، رابط کاربری نمی‌تواند تفاوتِ
 * «اشتباه تایپ کردی» و «داکر خاموش است» را به کاربر بگوید.
 */
function send(res, result) {
  if (result.ok) return res.json(result);
  const status =
    result.error === 'invalid_id' || result.error === 'unknown_action' ? 400
      : result.error === 'not_found' ? 404
        : result.error === 'docker_failed' ? 503
          : 500;
  return res.status(status).json(result);
}

/* ------------------------------ خواندن ---------------------------------- */

router.get('/status', async (req, res) => {
  res.json(await available({ force: req.query.force === '1' }));
});

router.get('/summary', async (req, res) => {
  res.json(await summary());
});

router.get('/containers', async (req, res) => {
  send(res, await listContainers({ all: req.query.all !== '0' }));
});

router.get('/images', async (req, res) => {
  send(res, await listImages());
});

router.get('/volumes', async (req, res) => {
  send(res, await listVolumes());
});

router.get('/networks', async (req, res) => {
  send(res, await listNetworks());
});

router.get('/stats', async (req, res) => {
  send(res, await stats());
});

router.get('/containers/:id', async (req, res) => {
  send(res, await inspect(req.params.id));
});

router.get('/containers/:id/logs', async (req, res) => {
  send(res, await logs(req.params.id, { tail: req.query.tail }));
});

/* ------------------------------ کارها ----------------------------------- */

router.post('/containers/:id/:action', requireWriteRole('operator'), async (req, res) => {
  const { id, action } = req.params;
  const result = await containerAction(id, action);
  audit(req, `docker.container.${action}`, {
    target: id,
    ok: result.ok,
    detail: result.ok ? null : result,
  });
  send(res, result);
});

/* ------------------------------ حذف ------------------------------------- */

router.delete('/containers/:id', requireWriteRole('admin'), async (req, res) => {
  const force = req.query.force === '1';
  const result = await removeContainer(req.params.id, { force });
  audit(req, 'docker.container.remove', {
    target: req.params.id,
    ok: result.ok,
    detail: { force, ...(result.ok ? {} : result) },
  });
  send(res, result);
});

router.delete('/images/:id', requireWriteRole('admin'), async (req, res) => {
  const force = req.query.force === '1';
  const result = await removeImage(req.params.id, { force });
  audit(req, 'docker.image.remove', {
    target: req.params.id,
    ok: result.ok,
    detail: { force, ...(result.ok ? {} : result) },
  });
  send(res, result);
});

router.delete('/volumes/:name', requireWriteRole('admin'), async (req, res) => {
  const result = await removeVolume(req.params.name);
  audit(req, 'docker.volume.remove', {
    target: req.params.name,
    ok: result.ok,
    detail: result.ok ? null : result,
  });
  send(res, result);
});

export default router;
