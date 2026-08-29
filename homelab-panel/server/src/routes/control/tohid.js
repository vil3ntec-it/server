// ---------------------------------------------------------------------------
//  بخشِ توحید در پنل — کارهای مدیر
//
//  دادنِ VIP، تمدید، قطع، دیدنِ مدت و نوعِ اشتراک، دستگاه‌ها، و اینکه همین
//  حالا چند نفر وصل‌اند. همه‌چیز از روی ردیف‌های واقعی است.
// ---------------------------------------------------------------------------
import express from 'express';
import { db } from '../../db.js';
import { requireRole } from '../../control/roles.js';
import { audit } from '../../control/audit.js';
import {
  entitlementFor, subscriptionsFor, grantSubscription, extendSubscription,
  setSubscriptionStatus, PAID, FREE, CORE,
} from '../../tohid/subscriptions.js';
import { listDevices, revokeSessions, accountById, createAccount } from '../../tohid/accounts.js';
import { listPlans, upsertPlan, deletePlan, planByCode } from '../../tohid/plans.js';
import {
  publicTohidSettings, writeTohidSettings, setMailPassword, mailSettings, readTohidSettings,
  setSmsToken, mailPassword,
} from '../../tohid/settings.js';
import { sendMail } from '../../tohid/smtp.js';
import { smsReady } from '../../tohid/sms.js';
import { sendCode } from '../../tohid/otp.js';
import { onlineNow, connectionStats } from '../../tohid/presence.js';
import { shopInfo } from '../../tohid/shop.js';
import { licensePublicKey } from '../../tohid/keys.js';
import { readInterfaces } from '../../metrics/network.js';
import { config } from '../../config.js';

const router = express.Router();

const fail = (res, status, error, detail = null) => res.status(status).json({ error, detail });

function guard(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (e) {
      if (e.code) return fail(res, 400, e.code, e.message);
      return fail(res, 500, 'server_error', e.message);
    }
  };
}

const actorOf = (req) => req.user?.username || 'admin';

/* ------------------------------ خلاصه --------------------------------- */

/**
 * آدرس‌هایی که باید در خودِ برنامه وارد شود.
 *
 * هیچ دامنه‌ای و هیچ سرویسِ بیرونی‌ای لازم نیست: برنامه مستقیم به همین
 * کامپیوتر وصل می‌شود. اینجا همان آی‌پی‌های واقعیِ این دستگاه خوانده می‌شود
 * تا کاربر چیزی را حدس نزند.
 */
function appAddresses() {
  const port = config.port;
  const ips = readInterfaces().map((i) => i.address).filter(Boolean);
  const hosts = [...new Set(ips)];
  return {
    port,
    lan: hosts.map((ip) => ({
      ip,
      otp: `ws://${ip}:${port}/tohid`,
      api: `http://${ip}:${port}`,
    })),
    local: { otp: `ws://127.0.0.1:${port}/tohid`, api: `http://127.0.0.1:${port}` },
  };
}

router.get('/overview', guard(async (_req, res) => {
  const accounts = db.prepare('SELECT COUNT(*) AS n FROM th_accounts').get().n;
  const disabled = db.prepare('SELECT COUNT(*) AS n FROM th_accounts WHERE disabled = 1').get().n;
  const now = Date.now();
  const withVip = db.prepare(`
    SELECT COUNT(DISTINCT account_id) AS n FROM th_subscriptions
    WHERE status = 'active' AND starts_at <= ? AND ends_at >= ?
  `).get(now, now).n;
  const expiring = db.prepare(`
    SELECT COUNT(DISTINCT account_id) AS n FROM th_subscriptions
    WHERE status = 'active' AND ends_at BETWEEN ? AND ?
  `).get(now, now + 7 * 24 * 60 * 60 * 1000).n;
  const devices = db.prepare('SELECT COUNT(*) AS n FROM th_devices WHERE revoked = 0').get().n;
  const requests = db.prepare("SELECT COUNT(*) AS n FROM th_billing_requests WHERE status = 'new'").get().n;

  res.json({
    accounts, disabled, withVip, expiring, devices, newRequests: requests,
    ...connectionStats(),
    settings: publicTohidSettings(),
    addresses: appAddresses(),
    keyId: licensePublicKey().keyId,
    features: { paid: PAID, free: FREE, core: CORE },
  });
}));

router.get('/online', guard(async (_req, res) => {
  res.json({ items: onlineNow(), ...connectionStats() });
}));

/* ----------------------------- حساب‌ها -------------------------------- */

router.get('/accounts', guard(async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const rows = db.prepare('SELECT * FROM th_accounts ORDER BY created_at DESC').all();
  const items = rows
    .filter((a) => !q
      || (a.name || '').toLowerCase().includes(q)
      || (a.email || '').toLowerCase().includes(q)
      || (a.phone || '').includes(q)
      || a.account_id.includes(q))
    .map((a) => {
      const ent = entitlementFor(a.account_id);
      return {
        accountId: a.account_id,
        name: a.name || '',
        email: a.email || '',
        phone: a.phone || '',
        disabled: Boolean(a.disabled),
        createdAt: a.created_at,
        lastLoginAt: a.last_login_at,
        lastSeenAt: a.last_seen_at,
        devices: listDevices(a.account_id).filter((d) => !d.revoked).length,
        vip: ent.isPaid,
        plan: ent.planTitle || null,
        planCode: ent.plan || null,
        daysLeft: ent.daysLeft,
        subEndsAt: ent.subEndsAt,
        status: ent.status,
      };
    });
  res.json({ items });
}));

router.get('/accounts/:id', guard(async (req, res) => {
  const account = accountById(req.params.id);
  if (!account) return fail(res, 404, 'not_found');
  res.json({
    account: {
      accountId: account.account_id,
      name: account.name || '',
      email: account.email || '',
      phone: account.phone || '',
      note: account.note || '',
      disabled: Boolean(account.disabled),
      createdAt: account.created_at,
      lastLoginAt: account.last_login_at,
      lastSeenAt: account.last_seen_at,
    },
    entitlement: entitlementFor(account.account_id),
    subscriptions: subscriptionsFor(account.account_id).map((s) => ({
      ...s,
      features: JSON.parse(s.features || '[]'),
    })),
    devices: listDevices(account.account_id),
    shop: shopInfo(account.account_id),
  });
}));

router.post('/accounts', requireRole('operator'), guard(async (req, res) => {
  const account = createAccount(req.body || {});
  audit({ actor: actorOf(req), action: 'tohid.account.create', entity: 'tohid_account', entityId: account.account_id });
  res.json({ ok: true, accountId: account.account_id });
}));

router.post('/accounts/:id/disable', requireRole('admin'), guard(async (req, res) => {
  const account = accountById(req.params.id);
  if (!account) return fail(res, 404, 'not_found');
  const disabled = req.body?.disabled !== false;
  db.prepare('UPDATE th_accounts SET disabled = ? WHERE account_id = ?').run(disabled ? 1 : 0, account.account_id);
  // حسابی که بسته می‌شود، همان لحظه باید از همه‌جا بیرون بیفتد
  if (disabled) revokeSessions(account.account_id);
  audit({ actor: actorOf(req), action: disabled ? 'tohid.account.disable' : 'tohid.account.enable',
    entity: 'tohid_account', entityId: account.account_id });
  res.json({ ok: true, disabled });
}));

router.post('/accounts/:id/note', requireRole('operator'), guard(async (req, res) => {
  db.prepare('UPDATE th_accounts SET note = ? WHERE account_id = ?')
    .run(String(req.body?.note || '').slice(0, 500), req.params.id);
  res.json({ ok: true });
}));

router.delete('/accounts/:id', requireRole('admin'), guard(async (req, res) => {
  const account = accountById(req.params.id);
  if (!account) return fail(res, 404, 'not_found');
  db.prepare('DELETE FROM th_accounts WHERE account_id = ?').run(account.account_id);
  audit({ actor: actorOf(req), action: 'tohid.account.delete', entity: 'tohid_account', entityId: account.account_id });
  res.json({ ok: true });
}));

/* ----------------------------- دستگاه‌ها ------------------------------ */

router.post('/devices/:id/revoke', requireRole('operator'), guard(async (req, res) => {
  const revoked = req.body?.revoked !== false;
  const row = db.prepare('SELECT * FROM th_devices WHERE id = ?').get(Number(req.params.id));
  if (!row) return fail(res, 404, 'not_found');
  db.prepare('UPDATE th_devices SET revoked = ? WHERE id = ?').run(revoked ? 1 : 0, row.id);
  audit({ actor: actorOf(req), action: 'tohid.device.revoke', entity: 'tohid_account',
    entityId: row.account_id, detail: { uid: row.uid, revoked } });
  res.json({ ok: true });
}));

/* ------------------------------ اشتراک -------------------------------- */

router.post('/accounts/:id/vip', requireRole('operator'), guard(async (req, res) => {
  const account = accountById(req.params.id);
  if (!account) return fail(res, 404, 'not_found');

  const body = req.body || {};
  const plan = body.planCode ? planByCode(body.planCode) : null;
  const amount = Number(body.amount) || plan?.amount || 1;
  const unit = String(body.unit || plan?.unit || 'month');

  const sub = grantSubscription({
    accountId: account.account_id,
    planCode: body.planCode || 'custom',
    planTitle: body.planTitle || plan?.title || 'دستی',
    features: Array.isArray(body.features) ? body.features : plan?.features,
    amount,
    unit,
    startsAt: Number(body.startsAt) || Date.now(),
    graceDays: Number(body.graceDays) || 0,
    maxDevices: Number(body.maxDevices) || plan?.max_devices || 1,
    price: body.price === undefined ? plan?.price ?? null : Number(body.price),
    currency: body.currency || readTohidSettings().currency,
    note: body.note || null,
    actor: actorOf(req),
  });
  res.json({ ok: true, subscription: sub, entitlement: entitlementFor(account.account_id) });
}));

router.post('/subscriptions/:id/extend', requireRole('operator'), guard(async (req, res) => {
  const row = extendSubscription(Number(req.params.id), {
    amount: Number(req.body?.amount) || 1,
    unit: String(req.body?.unit || 'month'),
    actor: actorOf(req),
  });
  res.json({ ok: true, subscription: row, entitlement: entitlementFor(row.account_id) });
}));

router.post('/subscriptions/:id/status', requireRole('operator'), guard(async (req, res) => {
  const row = setSubscriptionStatus(Number(req.params.id), String(req.body?.status || ''), {
    actor: actorOf(req),
  });
  res.json({ ok: true, subscription: row, entitlement: entitlementFor(row.account_id) });
}));

/* ------------------------------- پلن‌ها -------------------------------- */

router.get('/plans', guard(async (_req, res) => {
  res.json({ items: listPlans({ includeInactive: true }) });
}));

router.put('/plans', requireRole('operator'), guard(async (req, res) => {
  const row = upsertPlan(req.body || {});
  audit({ actor: actorOf(req), action: 'tohid.plan.save', entity: 'tohid_plan', entityId: row.code });
  res.json({ ok: true, plan: row });
}));

router.delete('/plans/:code', requireRole('operator'), guard(async (req, res) => {
  deletePlan(req.params.code);
  audit({ actor: actorOf(req), action: 'tohid.plan.delete', entity: 'tohid_plan', entityId: req.params.code });
  res.json({ ok: true });
}));

/* --------------------------- درخواست خرید ----------------------------- */

router.get('/requests', guard(async (_req, res) => {
  const items = db.prepare(`
    SELECT r.*, a.name, a.email, a.phone
    FROM th_billing_requests r
    LEFT JOIN th_accounts a ON a.account_id = r.account_id
    ORDER BY r.created_at DESC LIMIT 200
  `).all();
  res.json({ items });
}));

router.post('/requests/:id/status', requireRole('operator'), guard(async (req, res) => {
  const status = ['new', 'done', 'rejected'].includes(req.body?.status) ? req.body.status : 'done';
  db.prepare('UPDATE th_billing_requests SET status = ? WHERE id = ?').run(status, Number(req.params.id));
  res.json({ ok: true });
}));

/* ------------------------------ تنظیمات ------------------------------- */

router.get('/settings', guard(async (_req, res) => {
  res.json({
    settings: publicTohidSettings(),
    addresses: appAddresses(),
    keyId: licensePublicKey().keyId,
  });
}));

router.put('/settings', requireRole('admin'), guard(async (req, res) => {
  const body = { ...(req.body || {}) };
  const password = body.mailPassword;
  const token = body.smsToken;
  delete body.mailPassword;
  delete body.smsToken;
  // رمزِ ماسک‌شده نباید دوباره ذخیره شود
  if (typeof body.serverToken === 'string' && body.serverToken.startsWith('••')) delete body.serverToken;

  const saved = writeTohidSettings(body);
  if (password !== undefined) setMailPassword(password, actorOf(req));
  if (token !== undefined) setSmsToken(token, actorOf(req));
  audit({ actor: actorOf(req), action: 'tohid.settings.save', entity: 'tohid' });
  res.json({ ok: true, settings: publicTohidSettings(), saved });
}));

/** آزمونِ واقعیِ ایمیل — یک نامهٔ واقعی فرستاده می‌شود */
router.post('/settings/test-mail', requireRole('admin'), guard(async (req, res) => {
  const to = String(req.body?.to || '').trim();
  if (!to) return fail(res, 400, 'to_required', 'نشانی گیرنده را بنویسید');
  try {
    await sendMail(mailSettings(), {
      to,
      subject: 'آزمایش ایمیل مرکز فرمان',
      text: 'اگر این نامه به دستتان رسید، فرستادن کد ورود کار می‌کند.',
    });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.code || 'mail_failed', detail: e.message });
  }
}));

/* ──────────────────────────── کد ورود ──────────────────────────── */

/**
 * وضعیتِ کد ورود و درخواست‌های در جریان.
 *
 * خودِ کدها هرگز برنمی‌گردند — فقط hash‌شان در جدول است و همان هم اینجا
 * خوانده نمی‌شود. مدیر باید ببیند «برای چه کسی کد رفته و کِی تمام می‌شود»،
 * نه اینکه بتواند کدِ کسی را بخواند و به جای او وارد شود.
 */
router.get('/otp', guard(async (_req, res) => {
  const cfg = readTohidSettings();
  const now = Date.now();
  const rows = db.prepare('SELECT method, value, name, tries, created_at, expires_at FROM th_otp ORDER BY created_at DESC LIMIT 50').all();

  res.json({
    channels: {
      email: { ready: Boolean(cfg.mail?.host && mailPassword()), host: cfg.mail?.host || '' },
      sms: { ready: smsReady(), url: cfg.sms?.url || '' },
    },
    ttlSeconds: cfg.otpTtlSeconds,
    resendSeconds: cfg.resendSeconds,
    maxTries: cfg.maxTries,
    pending: rows.map((r) => ({
      method: r.method,
      // نشانی نیمه‌پوشیده: برای شناختن کافی است، برای سوءاستفاده نه
      value: mask(r.method, r.value),
      name: r.name || '',
      tries: r.tries,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      expired: r.expires_at <= now,
    })),
  });
}));

function mask(method, value) {
  const v = String(value || '');
  if (method === 'email') {
    const at = v.indexOf('@');
    if (at < 1) return v;
    const head = v.slice(0, at);
    return `${head.slice(0, 2)}${'•'.repeat(Math.max(1, head.length - 2))}${v.slice(at)}`;
  }
  return v.length > 4 ? `${'•'.repeat(v.length - 4)}${v.slice(-4)}` : v;
}

/** پاک کردنِ کدهای منقضی — کاری که خودِ سرور هم می‌کند، اینجا دستی */
router.post('/otp/purge', requireRole('operator'), guard(async (req, res) => {
  const info = db.prepare('DELETE FROM th_otp WHERE expires_at <= ?').run(Date.now());
  audit({ actor: actorOf(req), action: 'tohid.otp.purge', entity: 'tohid' });
  res.json({ ok: true, removed: info.changes });
}));

/**
 * آزمونِ واقعیِ کد ورود — یک کدِ واقعی به گیرنده می‌رود.
 *
 * کد در پاسخ برنمی‌گردد. اگر برمی‌گشت، همین مسیر می‌شد راهی برای گرفتنِ
 * کدِ هر شماره‌ای بدونِ دسترسی به آن شماره.
 */
router.post('/otp/test', requireRole('admin'), guard(async (req, res) => {
  const method = req.body?.method === 'phone' ? 'phone' : 'email';
  const to = String(req.body?.to || '').trim();
  if (!to) return fail(res, 400, 'to_required', 'گیرنده را بنویسید');
  try {
    await sendCode({ method, value: to, name: '' });
    audit({ actor: actorOf(req), action: 'tohid.otp.test', entity: 'tohid', detail: method });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.code || 'send_failed', detail: e.message });
  }
}));

export default router;
