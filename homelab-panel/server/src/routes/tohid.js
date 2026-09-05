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
import {
  threadFor, postMessage, messagesOf, markRead, shapeThread, unreadForUser,
} from '../tohid/support.js';
import { touchVisitor, claimVisitor } from '../tohid/visitors.js';
import { redeemVipCode } from '../tohid/vip-codes.js';
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


/* ==========================================================
   بخش‌های تازه — قیمت‌نامهٔ باز، پشتیبانی، تپشِ بازدید، کد اشتراک
   ----------------------------------------------------------
   سه‌تای اولی عمداً توکن نمی‌خواهند. کسی که هنوز حساب نساخته و همان اولِ
   کار گیر کرده، بیشتر از همه به آن‌ها نیاز دارد.
   ========================================================== */

/**
 *  قیمت‌نامه — بی‌نیاز به ورود.
 *
 *  ── چه چیزی این را لازم کرد ──────────────────────────────────────
 *  تنها راهِ گرفتنِ قیمت‌ها `/billing/plans` بود که توکن می‌خواهد. نسخهٔ
 *  وب آن را بی‌توکن صدا می‌زد، همیشه ۴۰۱ می‌گرفت و بی‌صدا به فهرستِ
 *  قیمتِ داخلِ خودش برمی‌گشت — یعنی هر تغییرِ قیمتی که در پنل داده
 *  می‌شد روی سایت دیده نمی‌شد، و تخفیف هم هرگز نمی‌رسید.
 *
 *  قیمت راز نیست: هر کسی که صفحهٔ اشتراک را باز کند باید ببیندش.
 */
router.get('/plans', guard(async (_req, res) => {
  res.json({ ...plansPayload(), serverTime: Date.now() });
}));

/* --------------------------- پشتیبانی --------------------------- */

/**
 *  کیستیِ درخواست — با توکن اگر بود، وگرنه با شناسهٔ دستگاه.
 *
 *  توکنِ نامعتبر خطا نمی‌دهد، فقط نادیده گرفته می‌شود: کاربری که نشستش
 *  منقضی شده هم باید بتواند بپرسد «چرا نمی‌توانم وارد شوم؟».
 */
function whoIs(req) {
  const account = accountFromToken(req.headers.authorization);
  const body = req.body || {};
  const deviceUid = String(body.deviceUid || body.device?.uid || req.query.deviceUid || '').slice(0, 64).trim();
  if (!account && !deviceUid) {
    throw Object.assign(new Error('برای پشتیبانی، شناسهٔ دستگاه لازم است'), { code: 'device_required' });
  }
  return {
    app: String(body.app || req.query.app || 'shop').slice(0, 40),
    accountId: account ? account.account_id : '',
    deviceUid,
    who: account ? (account.name || '') : String(body.name || req.query.name || '').slice(0, 80),
    contact: account ? (account.email || account.phone || '') : String(body.contact || '').slice(0, 120),
  };
}

/** گفت‌وگوی من، با پیام‌هایش. `after` یعنی فقط تازه‌ها. */
router.get('/support/thread', guard(async (req, res) => {
  const id = whoIs(req);
  const thread = threadFor(id);
  res.json({
    thread: shapeThread(thread),
    messages: messagesOf(thread.thread_id, { after: Number(req.query.after || 0) || 0 }),
    serverTime: Date.now(),
    greeting: 'سلام. هر مشکلی یا سؤالی دارید همین‌جا بنویسید — پاسخ می‌دهیم.',
  });
}));

router.post('/support/messages', guard(async (req, res) => {
  const id = whoIs(req);
  const thread = threadFor(id);
  const body = String((req.body || {}).body ?? (req.body || {}).text ?? '');
  const message = postMessage(thread.thread_id, {
    sender: 'user', senderName: id.who, body,
  });
  res.json({
    message,
    thread: shapeThread(
      db.prepare('SELECT * FROM th_support_threads WHERE thread_id = ?').get(thread.thread_id),
    ),
  });
}));

/** «خواندم» — نقطهٔ قرمز را پاک می‌کند */
router.post('/support/read', guard(async (req, res) => {
  const id = whoIs(req);
  const thread = threadFor(id);
  markRead(thread.thread_id, 'user');
  res.json({ ok: true });
}));

/**
 *  ثبتِ توکنِ پوش.
 *
 *  پوش هنوز روی این سرور راه نیفتاده، ولی توکن‌ها از همین حالا ثبت
 *  می‌شوند تا روزی که راه افتاد، دستگاه‌ها از قبل شناخته باشند.
 */
router.post('/support/push', guard(async (req, res) => {
  const id = whoIs(req);
  const token = String((req.body || {}).token || '').trim();
  if (!token || token.length > 500) return fail(res, 400, 'bad_token', 'توکن پوش درست نیست');
  const now = Date.now();
  db.prepare(`
    INSERT INTO th_push_tokens (app, token, account_id, device_uid, platform, status, created_at, updated_at)
    VALUES (?,?,?,?,?, 'active', ?, ?)
    ON CONFLICT(app, token) DO UPDATE SET account_id = excluded.account_id,
      device_uid = excluded.device_uid, platform = excluded.platform,
      status = 'active', updated_at = excluded.updated_at
  `).run(id.app, token, id.accountId, id.deviceUid,
    String((req.body || {}).platform || ''), now, now);
  res.json({ ok: true });
}));

/* -------------------------- تپشِ بازدید -------------------------- */

/**
 *  «من آمدم» — بی‌توکن هم کار می‌کند.
 *
 *  تمامِ نکتهٔ این مسیر همان کسی است که هنوز حساب ندارد. اگر توکن
 *  می‌خواست، دقیقاً کسانی را می‌شمرد که از قبل شمرده شده بودند.
 *
 *  پاسخ عمداً کوچک است و چیزی دربارهٔ بقیه نمی‌گوید: ساعتِ سرور و اینکه
 *  پیامِ پشتیبانیِ خوانده‌نشده دارد یا نه.
 */
router.post('/visit', guard(async (req, res) => {
  const b = req.body || {};
  const deviceUid = String(b.deviceUid || b.device?.uid || '').slice(0, 64).trim();
  if (!deviceUid) return res.json({ ok: true, serverTime: Date.now() });

  const account = accountFromToken(req.headers.authorization);
  const accountId = account ? account.account_id : '';

  const visitor = touchVisitor({
    app: String(b.app || 'shop').slice(0, 40),
    deviceUid,
    platform: String(b.platform || ''),
    appVersion: String(b.version || ''),
    accountId,
    name: account ? (account.name || '') : String(b.name || ''),
    ip: clientIp(req) || '',
    userAgent: String(req.headers['user-agent'] || ''),
    language: String(b.language || ''),
    location: b.location && typeof b.location === 'object' ? b.location : null,
  });

  //  مهمانی که حالا حساب دارد، ردیف‌های قبلی‌اش هم به حسابش می‌چسبند
  if (accountId) claimVisitor(deviceUid, accountId);

  res.json({
    ok: true,
    serverTime: Date.now(),
    supportUnread: unreadForUser({ accountId, deviceUid }),
    visits: visitor ? visitor.visits : 1,
  });
}));

/* --------------------------- کد اشتراک --------------------------- */

/**
 *  خرج کردنِ کدِ شش‌رقمی که صاحب سامانه به ایمیلِ کاربر فرستاده.
 *
 *  این یکی **حساب لازم دارد**: اشتراک روی حساب می‌نشیند.
 */
router.post('/vip/redeem', guard(async (req, res) => {
  const account = requireAccount(req, res);
  if (!account) return undefined;

  const out = redeemVipCode(String((req.body || {}).code || ''), {
    accountId: account.account_id,
    actor: 'vip-code',
  });

  return res.json({
    ok: true,
    message: `اشتراک شما فعال شد — ${out.days} روز.`,
    subscription: out.subscription,
    entitlement: entitlementFor(account.account_id),
    serverTime: Date.now(),
  });
}));

export default router;
