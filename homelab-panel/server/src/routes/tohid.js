// ---------------------------------------------------------------------------
//  API عمومیِ برنامهٔ توحید — /api/v1/**
//
//  این مسیرها را خودِ برنامه صدا می‌زند، پس شکلِ درخواست و پاسخ دستِ ما نیست:
//  دقیقاً همانی است که برنامه انتظار دارد. شکلِ خطا هم همان است که کلاینت
//  می‌خواند:  { error: { code, message } }
// ---------------------------------------------------------------------------
import express from 'express';
import {
  createAccount, findAccount, checkPassword, issueTokens, refreshAccess,
  accountFromToken, publicUser, accountById, accountForContact,
} from '../tohid/accounts.js';
import { licensePublicKey } from '../tohid/keys.js';
import { issueLicense, LicenseError } from '../tohid/license.js';
import { entitlementFor } from '../tohid/subscriptions.js';
import { plansPayload } from '../tohid/plans.js';
import { readTohidSettings } from '../tohid/settings.js';
import {
  createShop, createInvite, joinShop, removeMember, shopInfo, pushChanges, pullChanges,
  listInvites, revokeInvite, SHOP_FEATURES,
} from '../tohid/shop.js';
import { noteActivity } from '../tohid/presence.js';
import { sendCode, verifyCode } from '../tohid/otp.js';
import { db } from '../db.js';
import { versionInfo } from '../version.js';

const router = express.Router();

const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });

/** خطاهایی که خودِ ماژول‌ها با code می‌دهند، همان‌طور به برنامه می‌رسند */
function guard(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (e) {
      if (e instanceof LicenseError) return fail(res, 403, e.code, e.message);
      if (e.code) return fail(res, 400, e.code, e.message);
      return fail(res, 500, 'server_error', e.message || 'خطای سرور');
    }
  };
}

function requireAccount(req, res) {
  const account = accountFromToken(req.headers.authorization);
  if (!account) {
    fail(res, 401, 'invalid_token', 'دوباره وارد شوید');
    return null;
  }
  return account;
}

const clientIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || null;

/* ------------------------------- حساب --------------------------------- */

router.post('/auth/register', guard(async (req, res) => {
  const { name, email, phone, password } = req.body || {};
  if (!password || String(password).length < 6) {
    return fail(res, 400, 'weak_password', 'رمز عبور باید دست‌کم ۶ نویسه باشد');
  }
  const account = createAccount({ name, email, phone, password });
  noteActivity({ accountId: account.account_id, kind: 'api', ip: clientIp(req) });
  res.json({ ok: true, user: publicUser(account) });
}));

router.post('/auth/login', guard(async (req, res) => {
  const { identifier, password } = req.body || {};
  const account = findAccount(identifier);
  // پیامِ یکسان برای «نبود» و «رمز غلط» — وگرنه می‌شود فهرستِ حساب‌ها را ساخت
  if (!account || !checkPassword(account, password)) {
    return fail(res, 401, 'bad_credentials', 'نام کاربری یا رمز عبور درست نیست');
  }
  if (account.disabled) return fail(res, 403, 'account_disabled', 'این حساب غیرفعال شده است');

  const tokens = issueTokens(account);
  noteActivity({ accountId: account.account_id, kind: 'api', ip: clientIp(req) });
  res.json({ ...tokens, user: publicUser(account) });
}));

router.post('/auth/refresh', guard(async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return fail(res, 400, 'invalid_token', 'توکن لازم است');
  res.json(refreshAccess(refreshToken));
}));

/* ------------------------------ اشتراک -------------------------------- */

router.get('/license/public-key', guard(async (_req, res) => {
  const { publicKey, keyId } = licensePublicKey();
  res.json({ publicKey, keyId });
}));

const licenseHandler = guard(async (req, res) => {
  const account = requireAccount(req, res);
  if (!account) return;
  const device = req.body?.device || {};
  const result = issueLicense(account, device);
  noteActivity({
    accountId: account.account_id, deviceUid: device.uid,
    kind: 'api', ip: clientIp(req),
  });
  res.json(result);
});

router.post('/license/activate', licenseHandler);
router.post('/license/sync', licenseHandler);

/* ------------------------------ خرید ---------------------------------- */

router.get('/billing/plans', guard(async (_req, res) => {
  res.json(plansPayload());
}));

router.get('/billing/status', guard(async (req, res) => {
  const account = accountFromToken(req.headers.authorization);
  if (!account) {
    // مهمان: فقط بگو چه چیزی رایگان است — نه خطا، وگرنه برنامه فکر می‌کند
    // سرور خراب است
    const { CORE, FREE } = await import('../tohid/subscriptions.js');
    return res.json({
      entitlement: {
        source: 'guest', features: FREE.slice(), free: FREE, core: CORE,
        trial: { used: false, active: false, daysLeft: 0 },
        isPaid: false, message: '',
      },
    });
  }
  noteActivity({ accountId: account.account_id, kind: 'api', ip: clientIp(req) });
  res.json({ entitlement: entitlementFor(account.account_id), serverTime: Date.now() });
}));

router.post('/billing/request', guard(async (req, res) => {
  const account = accountFromToken(req.headers.authorization);
  const { plan, planCode, contact, message } = req.body || {};
  db.prepare(`
    INSERT INTO th_billing_requests (account_id, plan_code, contact, message, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    account?.account_id || null,
    String(planCode || plan || '').slice(0, 40) || null,
    String(contact || '').slice(0, 120) || null,
    String(message || '').slice(0, 500) || null,
    Date.now(),
  );
  res.json({ ok: true });
}));

/* ------------------------------- دکان --------------------------------- */

router.get('/shop/me', guard(async (req, res) => {
  const account = requireAccount(req, res);
  if (!account) return;
  noteActivity({ accountId: account.account_id, kind: 'sync', ip: clientIp(req) });
  res.json(shopInfo(account.account_id));
}));

router.post('/shop/create', guard(async (req, res) => {
  const account = requireAccount(req, res);
  if (!account) return;
  createShop(account.account_id, req.body || {});
  res.json(shopInfo(account.account_id));
}));

/*
 *  کدِ پیوستن.
 *
 *  کلِ بدنه رد می‌شود، نه فقط role — نسخه‌های تازهٔ برنامه نقش و تعدادِ
 *  استفاده و مدتِ اعتبار را با هم می‌فرستند و خودِ createInvite نام‌های
 *  مختلفِ این فیلدها را می‌شناسد.
 */
router.post('/shop/invite', guard(async (req, res) => {
  const account = requireAccount(req, res);
  if (!account) return;
  res.json(createInvite(account.account_id, req.body || {}));
}));

// نامِ دیگری که بعضی نسخه‌ها می‌زنند — همان کار
router.post('/shop/invites', guard(async (req, res) => {
  const account = requireAccount(req, res);
  if (!account) return;
  res.json(createInvite(account.account_id, req.body || {}));
}));

router.get('/shop/invites', guard(async (req, res) => {
  const account = requireAccount(req, res);
  if (!account) return;
  res.json({ invites: listInvites(account.account_id) });
}));

router.post('/shop/invites/:code/revoke', guard(async (req, res) => {
  const account = requireAccount(req, res);
  if (!account) return;
  revokeInvite(account.account_id, req.params.code);
  res.json(shopInfo(account.account_id));
}));

router.delete('/shop/invites/:code', guard(async (req, res) => {
  const account = requireAccount(req, res);
  if (!account) return;
  revokeInvite(account.account_id, req.params.code);
  res.json(shopInfo(account.account_id));
}));

router.post('/shop/join', guard(async (req, res) => {
  const account = requireAccount(req, res);
  if (!account) return;
  joinShop(account.account_id, req.body?.code);
  res.json(shopInfo(account.account_id));
}));

router.post('/shop/members/:id/remove', guard(async (req, res) => {
  const account = requireAccount(req, res);
  if (!account) return;
  removeMember(account.account_id, req.params.id);
  res.json(shopInfo(account.account_id));
}));

router.post('/shop/sync/push', guard(async (req, res) => {
  const account = requireAccount(req, res);
  if (!account) return;
  noteActivity({
    accountId: account.account_id, deviceUid: req.body?.deviceId,
    kind: 'sync', ip: clientIp(req),
  });
  res.json(pushChanges(account.account_id, req.body || {}));
}));

router.get('/shop/sync/pull', guard(async (req, res) => {
  const account = requireAccount(req, res);
  if (!account) return;
  res.json(pullChanges(account.account_id, {
    since: req.query.since,
    deviceId: req.query.deviceId,
  }));
}));


/* ─────────────────────── ورود با کد یک‌بارمصرف ───────────────────────
   همان منطقِ WebSocket، این بار روی HTTP. برنامهٔ اندروید بقیهٔ کارهایش
   را با HTTP می‌کند؛ یک کانالِ جدا فقط برای ورود، یعنی راهی که ممکن است
   پشتِ فایروال یا پروکسیِ کسی بسته باشد و کاربر اصلاً نتواند وارد شود. */

router.post('/auth/otp/send', guard(async (req, res) => {
  const method = req.body?.method === 'phone' ? 'phone' : 'email';
  try {
    await sendCode({ method, value: req.body?.value, name: req.body?.name });
    noteActivity({ kind: 'otp', ip: clientIp(req) });
    // زمانِ اعتبار برگردانده می‌شود تا برنامه بتواند شمارنده نشان دهد
    res.json({ ok: true, ttlSeconds: readTohidSettings().otpTtlSeconds });
  } catch (e) {
    fail(res, e.code === 'too_soon' ? 429 : 400, e.code || 'send_failed', e.message);
  }
}));

router.post('/auth/otp/verify', guard(async (req, res) => {
  const method = req.body?.method === 'phone' ? 'phone' : 'email';
  try {
    const { contact, name } = verifyCode({ method, value: req.body?.value, code: req.body?.code });
    const account = accountForContact({ method, value: contact, name: req.body?.name || name });
    const tokens = issueTokens(account);
    noteActivity({ accountId: account.account_id, kind: 'otp', ip: clientIp(req) });
    res.json({ ...tokens, user: publicUser(account) });
  } catch (e) {
    fail(res, 400, e.code || 'bad_code', e.message);
  }
}));

/* ------------------------------ سلامت --------------------------------- */

/*
 *  سلامتِ سرورِ برنامه.
 *
 *  فهرستِ قابلیت‌ها این‌جا هم می‌آید: برنامه پیش از هر کاری همین را می‌زند و
 *  با آن می‌فهمد سرورِ روبه‌رو چه چیزی بلد است. بدونِ این، تنها راهِ فهمیدن،
 *  خوردنِ ۴۰۴ وسطِ کار بود.
 */
router.get('/health', (_req, res) => {
  const cfg = readTohidSettings();
  res.json({
    ok: true,
    serverTime: Date.now(),
    otpReady: Boolean(cfg.mail?.host),
    version: versionInfo.version,
    features: SHOP_FEATURES,
  });
});

export default router;
