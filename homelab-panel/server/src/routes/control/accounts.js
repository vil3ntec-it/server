// ---------------------------------------------------------------------------
//  حساب‌ها — کاربران، فروشگاه‌ها، کارکنان و اشتراک‌ها
//
//  این‌ها کاربرانِ *پروژه‌ها* هستند، نه مدیرِ پنل. کاربرِ پروژهٔ الف هرگز در
//  فهرستِ پروژهٔ ب دیده نمی‌شود؛ همهٔ پرس‌وجوها با project_id بسته می‌شوند.
//
//  رمزِ عبورِ این کاربران این‌جا ذخیره نمی‌شود و کدِ یک‌بارمصرف هم نگه داشته
//  نمی‌شود — فقط چیزی که برای مدیریت لازم است.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { db } from '../../db.js';
import { shops as shopModel, appUsers, subscriptions, newPublicId } from '../../control/models.js';
import { auditFromReq } from '../../control/audit.js';
import { guard, fail, withProject, num, str } from './_shared.js';

const router = Router({ mergeParams: true });

const ROLES = ['owner', 'manager', 'staff', 'user'];
const SUB_STATUS = ['active', 'expired', 'suspended', 'cancelled'];

/* ----------------------------- فروشگاه‌ها ------------------------------ */

router.get(
  '/:id/shops',
  withProject,
  guard(async (req, res) => {
    const shops = db
      .prepare(
        `SELECT s.*,
                (SELECT COUNT(*) FROM cc_app_users u WHERE u.shop_id = s.id) AS user_count,
                (SELECT COUNT(*) FROM cc_subscriptions sb WHERE sb.shop_id = s.id AND sb.status = 'active') AS active_subs
           FROM cc_shops s WHERE s.project_id = ? ORDER BY s.name COLLATE NOCASE`
      )
      .all(req.project.id);
    res.json({ shops });
  })
);

router.post(
  '/:id/shops',
  withProject,
  guard(async (req, res) => {
    const name = str(req.body?.name, 160);
    if (!name) return fail(res, 400, 'name_required');
    const row = shopModel.create(req.project.id, {
      // شناسهٔ فروشگاه را همیشه خودمان می‌سازیم — از بیرون پذیرفته نمی‌شود
      shop_id: newPublicId('shop'),
      name,
      owner_name: str(req.body?.owner_name, 120),
      owner_phone: str(req.body?.owner_phone, 40),
      manager: str(req.body?.manager, 120),
      address: str(req.body?.address, 400),
      status: req.body?.status || 'active',
      note: str(req.body?.note, 500),
    });
    const shop = db.prepare('SELECT * FROM cc_shops WHERE id = ?').get(row.id);
    auditFromReq(req, 'shop.create', { entity: 'shop', entityId: shop.shop_id, projectId: req.project.id, detail: { name } });
    res.status(201).json({ shop });
  })
);

router.patch(
  '/:id/shops/:shopId',
  withProject,
  guard(async (req, res) => {
    const { shop_id: _ignored, ...patch } = req.body || {};
    const row = shopModel.update(req.params.shopId, patch, req.project.id);
    if (!row) return fail(res, 404, 'not_found');
    auditFromReq(req, 'shop.update', { entity: 'shop', entityId: row.shop_id, projectId: req.project.id });
    res.json({ shop: row });
  })
);

router.delete(
  '/:id/shops/:shopId',
  withProject,
  guard(async (req, res) => {
    const row = shopModel.get(req.params.shopId, req.project.id);
    if (!row) return fail(res, 404, 'not_found');
    const users = db.prepare('SELECT COUNT(*) AS n FROM cc_app_users WHERE shop_id = ?').get(row.id).n;
    if (users && req.query.confirm !== 'true') return res.status(409).json({ error: 'shop_has_users', detail: { users } });
    shopModel.remove(row.id, req.project.id);
    auditFromReq(req, 'shop.delete', { entity: 'shop', entityId: row.shop_id, projectId: req.project.id, detail: { name: row.name, users } });
    res.json({ ok: true });
  })
);

/* ------------------------------ کاربران -------------------------------- */

router.get(
  '/:id/users',
  withProject,
  guard(async (req, res) => {
    const where = ['u.project_id = ?'];
    const args = [req.project.id];
    if (req.query.shop_id) {
      where.push('u.shop_id = ?');
      args.push(num(req.query.shop_id));
    }
    if (req.query.role && ROLES.includes(req.query.role)) {
      where.push('u.role = ?');
      args.push(req.query.role);
    }
    if (req.query.q) {
      where.push('(u.name LIKE ? OR u.phone LIKE ? OR u.email LIKE ? OR u.user_uid LIKE ?)');
      const like = `%${String(req.query.q).slice(0, 60)}%`;
      args.push(like, like, like, like);
    }
    const limit = Math.min(500, num(req.query.limit, 200));
    const users = db
      .prepare(
        `SELECT u.*, s.name AS shop_name,
                (SELECT sb.plan FROM cc_subscriptions sb WHERE sb.user_id = u.id AND sb.status = 'active' ORDER BY sb.end_at DESC LIMIT 1) AS active_plan
           FROM cc_app_users u LEFT JOIN cc_shops s ON s.id = u.shop_id
          WHERE ${where.join(' AND ')} ORDER BY u.created_at DESC LIMIT ?`
      )
      .all(...args, limit);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM cc_app_users u WHERE ${where.join(' AND ')}`).get(...args).n;
    res.json({ users, total, roles: ROLES });
  })
);

router.post(
  '/:id/users',
  withProject,
  guard(async (req, res) => {
    const uid = str(req.body?.user_uid, 80) || newPublicId('usr');
    if (db.prepare('SELECT 1 AS x FROM cc_app_users WHERE project_id = ? AND user_uid = ?').get(req.project.id, uid)) {
      return fail(res, 409, 'user_exists');
    }
    const shopId = num(req.body?.shop_id);
    // فروشگاه باید مالِ همین پروژه باشد — وگرنه پذیرفته نمی‌شود
    if (shopId && !shopModel.get(shopId, req.project.id)) return fail(res, 400, 'shop_not_in_project');

    const row = appUsers.create(req.project.id, {
      user_uid: uid,
      shop_id: shopId,
      name: str(req.body?.name, 160),
      phone: str(req.body?.phone, 40),
      email: str(req.body?.email, 200),
      role: ROLES.includes(req.body?.role) ? req.body.role : 'user',
      status: req.body?.status || 'active',
      registered_at: num(req.body?.registered_at) ?? Date.now(),
      note: str(req.body?.note, 500),
    });
    auditFromReq(req, 'user.create', { entity: 'app_user', entityId: uid, projectId: req.project.id, detail: { role: row.role } });
    res.status(201).json({ user: row });
  })
);

router.patch(
  '/:id/users/:userId',
  withProject,
  guard(async (req, res) => {
    if (req.body?.shop_id != null && !shopModel.get(num(req.body.shop_id), req.project.id)) {
      return fail(res, 400, 'shop_not_in_project');
    }
    const row = appUsers.update(req.params.userId, req.body || {}, req.project.id);
    if (!row) return fail(res, 404, 'not_found');
    auditFromReq(req, 'user.update', { entity: 'app_user', entityId: row.user_uid, projectId: req.project.id });
    res.json({ user: row });
  })
);

router.delete(
  '/:id/users/:userId',
  withProject,
  guard(async (req, res) => {
    const row = appUsers.get(req.params.userId, req.project.id);
    if (!row) return fail(res, 404, 'not_found');
    appUsers.remove(row.id, req.project.id);
    auditFromReq(req, 'user.delete', { entity: 'app_user', entityId: row.user_uid, projectId: req.project.id });
    res.json({ ok: true });
  })
);

/* ----------------------------- اشتراک‌ها ------------------------------- */

router.get(
  '/:id/subscriptions',
  withProject,
  guard(async (req, res) => {
    const where = ['s.project_id = ?'];
    const args = [req.project.id];
    if (req.query.status && SUB_STATUS.includes(req.query.status)) {
      where.push('s.status = ?');
      args.push(req.query.status);
    }
    const rows = db
      .prepare(
        `SELECT s.*, sh.name AS shop_name, u.name AS user_name, u.user_uid
           FROM cc_subscriptions s
      LEFT JOIN cc_shops     sh ON sh.id = s.shop_id
      LEFT JOIN cc_app_users u  ON u.id = s.user_id
          WHERE ${where.join(' AND ')} ORDER BY s.end_at DESC LIMIT 500`
      )
      .all(...args);
    const summary = Object.fromEntries(
      db
        .prepare('SELECT status, COUNT(*) AS n FROM cc_subscriptions WHERE project_id = ? GROUP BY status')
        .all(req.project.id)
        .map((r) => [r.status, r.n])
    );
    res.json({ subscriptions: rows, summary, statuses: SUB_STATUS });
  })
);

router.post(
  '/:id/subscriptions',
  withProject,
  guard(async (req, res) => {
    const plan = str(req.body?.plan, 80);
    if (!plan) return fail(res, 400, 'plan_required');
    const start = num(req.body?.start_at) ?? Date.now();
    const end = num(req.body?.end_at);
    if (!end || end <= start) return fail(res, 400, 'invalid_period');

    const shopId = num(req.body?.shop_id);
    const userId = num(req.body?.user_id);
    if (shopId && !shopModel.get(shopId, req.project.id)) return fail(res, 400, 'shop_not_in_project');
    if (userId && !appUsers.get(userId, req.project.id)) return fail(res, 400, 'user_not_in_project');

    const row = subscriptions.create(req.project.id, {
      plan,
      shop_id: shopId,
      user_id: userId,
      start_at: start,
      end_at: end,
      status: 'active',
      price: str(req.body?.price, 40),
      note: str(req.body?.note, 500),
    });
    auditFromReq(req, 'subscription.create', { entity: 'subscription', entityId: row.id, projectId: req.project.id, detail: { plan, start, end } });
    res.status(201).json({ subscription: row });
  })
);

/** تمدید / تعلیق / فعال‌سازی / لغو — همه از یک درِ کنترل‌شده */
router.post(
  '/:id/subscriptions/:subId/:action',
  withProject,
  guard(async (req, res) => {
    const row = subscriptions.get(req.params.subId, req.project.id);
    if (!row) return fail(res, 404, 'not_found');
    const action = req.params.action;
    const now = Date.now();
    let patch = {};

    if (action === 'extend') {
      const days = num(req.body?.days);
      if (!days || days <= 0 || days > 3650) return fail(res, 400, 'invalid_days');
      const base = Math.max(row.end_at, now);
      patch = { end_at: base + days * 86400000, status: 'active' };
    } else if (action === 'suspend') {
      patch = { status: 'suspended' };
    } else if (action === 'activate') {
      if (row.end_at <= now) return fail(res, 400, 'already_expired');
      patch = { status: 'active' };
    } else if (action === 'cancel') {
      patch = { status: 'cancelled' };
    } else {
      return fail(res, 400, 'unknown_action');
    }

    const updated = subscriptions.update(row.id, patch, req.project.id);
    auditFromReq(req, `subscription.${action}`, { entity: 'subscription', entityId: row.id, projectId: req.project.id, detail: patch });
    res.json({ subscription: updated });
  })
);

router.delete(
  '/:id/subscriptions/:subId',
  withProject,
  guard(async (req, res) => {
    if (!subscriptions.remove(req.params.subId, req.project.id)) return fail(res, 404, 'not_found');
    auditFromReq(req, 'subscription.delete', { entity: 'subscription', entityId: req.params.subId, projectId: req.project.id });
    res.json({ ok: true });
  })
);

export default router;
