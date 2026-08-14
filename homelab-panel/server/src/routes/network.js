// شبکه: پینگ، سرعت دانلود/آپلود، IP، MAC، Gateway
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { readNetwork, readPublicIp, tcpPing } from '../metrics/network.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  res.json(await readNetwork());
});

router.post('/ping', async (req, res) => {
  const target = String(req.body?.target || '').trim();
  if (!/^[a-zA-Z0-9._-]+(:\d{1,5})?$/.test(target)) return res.status(400).json({ error: 'invalid_target' });
  const samples = [];
  for (let i = 0; i < 4; i++) {
    samples.push(await tcpPing(target));
  }
  const valid = samples.filter((n) => n != null);
  res.json({
    target,
    samples,
    min: valid.length ? Math.min(...valid) : null,
    max: valid.length ? Math.max(...valid) : null,
    avg: valid.length ? Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10 : null,
    lossPercent: Math.round(((samples.length - valid.length) / samples.length) * 100),
  });
});

router.post('/public-ip/refresh', async (req, res) => {
  res.json({ publicIp: await readPublicIp({ force: true }) });
});

export default router;
