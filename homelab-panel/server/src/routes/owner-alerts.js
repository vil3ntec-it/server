// ---------------------------------------------------------------------------
//  دروازهٔ پیام به مالک (src/notify/owner.js) — صفحهٔ «اعلان‌ها»ی پنل، فقط مدیر
//
//      GET  /api/owner-alerts            تنظیمات، نوع‌ها، شمارِ امروز، هشدارهای باز، ۱۰۰ رخدادِ آخر
//      PUT  /api/owner-alerts/settings   { cooldownH?, criticalCooldownH?, dailyCap?, digestHour?, quiet?, quietFrom?, quietTo?, codesSilent?, types? }
//      GET  /api/owner-alerts/history    ?limit=&type=
//      GET  /api/owner-alerts/digest     پیش‌نمایشِ خلاصهٔ امشب (همان متنی که ساعتِ خلاصه می‌رود)
//
//  ⛔ هشدارهای امنیتی خاموش یا کم‌اهمیت نمی‌شوند (۴۰۰، نه نادیده گرفتنِ بی‌صدا).
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { requireAuth, requireWriteRole } from '../auth.js';
import { audit } from '../control/audit.js';
import * as owner from '../notify/owner.js';

const router = Router();
router.use(requireAuth);
router.use(requireWriteRole('admin'));

const actorOf = (req) => req.user?.username || 'admin';

router.get('/', (req, res) => {
  res.json({
    settings: owner.settings(),
    defaults: owner.DEFAULTS,
    types: owner.catalog(),
    countOnly: owner.COUNT_ONLY,
    stats: owner.stats(),
    history: owner.history({ limit: 100 }),
  });
});

router.put('/settings', (req, res) => {
  try {
    const before = owner.settings();
    const out = owner.setSettings(req.body || {});
    const changed = Object.keys(out).filter((k) => JSON.stringify(out[k]) !== JSON.stringify(before[k]));
    audit({ actor: actorOf(req), action: 'owner-alerts.settings', entity: 'setting', detail: { changed, types: out.types } });
    res.json({ settings: out, stats: owner.stats() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, field: e.field || null });
  }
});

router.get('/history', (req, res) => {
  res.json({ items: owner.history({ limit: req.query.limit, type: req.query.type ? String(req.query.type) : null }) });
});

router.get('/digest', (req, res) => {
  const st = owner.stats();
  res.json({ text: owner.digestText({ since: st.lastDigestAt || Date.now() - 24 * 3600e3 }).text });
});

export default router;
