// ---------------------------------------------------------------------------
//  💰 مالیِ مرکزی — ماژولِ ۴.۵ ِ پنلِ مرکزیِ مالک، پلِ پنل ⇄ سرورِ حساب
//
//      /api/account-admin/console/finance/*  ──(کلیدِ سرویس + «انجام‌دهنده»، یا راهِ پیشین)──▶  /api/admin/finance/*
//
//  سوار زیرِ ‎routes/account-admin.js‎ (پس همان ‎requireAuth‎ + ‎writeNeedsOperator‎ ِ ‎index.js‎، همان
//  «انجام‌دهنده» و همان ۴۰۴ ِ پورتِ عمومی). مالیِ مرکزی = پولِ اشتراکِ خودِ پلتفرم، جدا از دفترِ دکان‌ها.
//
//  ⛔ **هیچ عددی این‌جا ساخته یا جمع نمی‌شود.** پاسخِ سرورِ حساب همان‌طور (با ‎checkedAt‎ ِ خودش) + ‎fetchedAt‎.
//  ⛔ سرورِ حسابِ بی ‎finance.v1‎ ⇒ خواندن: ‎200 {available:false, reason, capability}‎؛ نوشتن: ‎501‎ — نه صفر.
//  ⛔ فهرستِ سفید: هر پارامترِ پرس‌وجو شکلِ خودش را دارد؛ ناشناخته‌ها نمی‌روند، نادرست ⇒ ۴۰۰.
//  ⛔ مرزِ نقش (همان سرورِ حساب یا تنگ‌تر):
//       خواندن                   همهٔ نقش‌های پنل (viewer ⇒ viewer ِ سرورِ حساب: فقط GET)
//       تطبیقِ فروشِ آنلاین (#411) admin (آن‌جا فقط ارشد)
//       خروجیِ CSV · سندِ اصلاحی  admin ِ پنل (⇒ ارشد)، یا نقشِ «مالی» ِ پنل روزی که ۴.۳ آن را بسازد
//                                (آن‌جا: مالی/ارشد؛ مدیرِ عادی و viewer نه)
//  ⛔ سندِ اصلاحی (هیچ ویرایش/حذفی نیست): دلیل + تأیید + کلیدِ یکتاییِ رابط + **رمزِ پنلِ همین کاربر** (یا نشستِ
//     تازهٔ فاز ۱) — و فقط از راهِ کلیدِ سرویس، تا نامِ آدمِ واقعی در سندِ سرورِ حساب بنشیند (نه ارشدِ مشترک).
//     زمانِ احرازِ دوباره با ‎X-Actor-Reauth-At‎ به سرورِ حساب می‌رود؛ آن‌جا هم سنجیده می‌شود.
// ---------------------------------------------------------------------------
import express from 'express';
import { cloudRaw, serviceKeyStatus } from '../stations/cloud.js';
import { roleOf, requireRole } from '../control/roles.js';
import { audit } from '../control/audit.js';
import * as panelAuth from '../auth.js';
import { db } from '../db.js';
import { rateLimit } from '../platform/rate-limit.js';

const router = express.Router();

export const FINANCE_CAPABILITY = 'finance.v1';
const NEEDS = 'GET /api/admin/finance/* · POST /api/admin/finance/adjustments (shop: claude/console-finance-api، مهاجرتِ ۱۷۱)';

function fail(res, err) {
  return res.status(err.status || 502).json({ error: err.code || 'cloud_error', message: err.message || 'سرورِ حساب جواب نداد' });
}
const guard = (handler) => async (req, res) => {
  try { await handler(req, res); } catch (err) { fail(res, err); }
};
function bad(code, message, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}
const actorOf = (req) => req.user?.username || 'admin';

/* ─────────────────────────── پرس‌وجوی فهرست‌سفید ─────────────────────────── */

const ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const SPEC = {
  app: /^(shop|pump|all)$/, group: /^(day|week|month)$/, calendar: /^(persian|gregorian)$/, by: /^(shop|plan)$/,
  from: /^\d{1,16}$/, to: /^\d{1,16}$/, fromDate: /^\d{4}-\d{2}-\d{2}$/, toDate: /^\d{4}-\d{2}-\d{2}$/,
  limit: /^\d{1,5}$/, offset: /^\d{1,7}$/, cursor: /^[A-Za-z0-9_-]{1,300}$/,
  shopId: ID, paymentId: ID, targetId: ID,
  method: /^(cash|hawala|exchange)$/, currency: /^(AFN|USD)$/, kind: /^(correction|refund|reversal|reference)$/,
  status: /^(all|active|deleted|created|pending|paid|failed|expired|cancelled|refunded)$/,
  review: /^[01]$/, match: /^unmatched$/, action: /^admin\.[a-z_]{1,60}$/, dataset: /^(payments|adjustments)$/,
};
/** فقط کلیدهای `keys`، هر کدام با شکلِ خودش؛ `q` متنِ آزاد (بی نویسهٔ کنترلی، ۸۰ نویسه). */
function pick(query, keys) {
  const out = {};
  for (const k of keys) {
    const raw = query?.[k];
    if (raw === undefined || raw === '') continue;
    const val = String(Array.isArray(raw) ? raw[0] : raw).trim();
    if (!val) continue;
    if (k === 'q') {
      // eslint-disable-next-line no-control-regex
      out.q = val.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80);
      continue;
    }
    if (!SPEC[k].test(val)) throw bad('bad_query', `پارامترِ «${k}» درست نیست`);
    out[k] = val;
  }
  return out;
}
const WINDOW = ['from', 'to', 'fromDate', 'toDate', 'group', 'calendar', 'app'];
const PAYMENT_FILTERS = ['app', 'shopId', 'from', 'to', 'fromDate', 'toDate', 'method', 'currency', 'status', 'q', 'limit', 'cursor'];
const ADJ_FILTERS = ['kind', 'app', 'shopId', 'paymentId', 'from', 'to', 'q', 'limit', 'cursor'];

/* ─────────────────────────── «توانایی» ِ سرورِ حساب ─────────────────────────── */

/*
 *  ⚠️ کَش نمی‌شود (همان قاعدهٔ درهای فاز ۳ در ‎account-admin.js‎): یک ‎GET /api/admin/me‎ ِ سبک، تا روزی که
 *  سرورِ حساب به‌روز شد همان لحظه دیده شود.
 */
async function hasFinance() {
  const me = await cloudRaw('GET', '/api/admin/me');
  return Array.isArray(me?.capabilities) && me.capabilities.map(String).includes(FINANCE_CAPABILITY);
}
function unavailable() {
  return {
    available: false, reason: 'capability_missing', capability: FINANCE_CAPABILITY, needs: NEEDS,
    message: 'داده در دسترس نیست — سرورِ حساب هنوز مالیِ مرکزی (finance.v1) را ندارد', fetchedAt: Date.now(),
  };
}
function missingErr() {
  return bad('capability_missing', `این کار روی نسخهٔ فعلیِ سرورِ حساب نیست (${FINANCE_CAPABILITY}) — سرورِ حساب را به‌روز کنید`, 501);
}
const stamped = (out) => ({ available: true, ...(out && typeof out === 'object' ? out : {}), fetchedAt: Date.now() });

/** مرزِ «مالی»: admin ِ پنل امروز؛ نقشِ «مالی» ِ پنل هم، روزی که ماژولِ ۴.۳ آن را بسازد. */
function financeWriter(req, res, next) {
  const role = roleOf(req);
  if (role === 'admin' || role === 'finance') return next();
  audit({ actor: actorOf(req), action: 'access.denied', entity: req.baseUrl + req.path, result: 'forbidden', detail: { role, needed: 'admin|finance' } });
  return res.status(403).json({ error: 'forbidden', detail: { role, needed: 'admin' } });
}

/* ─────────────────────────────── خواندنی‌ها ─────────────────────────────── */

for (const [local, remote, keys] of [
  ['/summary', '/api/admin/finance/summary', WINDOW],
  ['/breakdown', '/api/admin/finance/breakdown', [...WINDOW, 'by', 'limit', 'offset']],
  ['/payments', '/api/admin/finance/payments', PAYMENT_FILTERS],
  ['/adjustments', '/api/admin/finance/adjustments', ADJ_FILTERS],
  ['/receivables', '/api/admin/finance/receivables', ['app', 'shopId', 'limit', 'offset']],
  ['/pending', '/api/admin/finance/pending', ['limit', 'offset']],
  ['/gateway', '/api/admin/finance/gateway', ['status', 'review', 'match', 'limit', 'cursor']],
  ['/discrepancies', '/api/admin/finance/discrepancies', []],
  ['/history', '/api/admin/finance/history', ['action', 'targetId', 'limit', 'cursor']],
]) {
  router.get(local, guard(async (req, res) => {
    const query = pick(req.query, keys);
    if (!(await hasFinance())) return res.json(unavailable());
    res.json(stamped(await cloudRaw('GET', remote, { query })));
  }));
}

router.get('/payments/:id', guard(async (req, res) => {
  const id = String(req.params.id || '');
  if (!ID.test(id)) throw bad('bad_id', 'شناسه معتبر نیست');
  if (!(await hasFinance())) return res.json(unavailable());
  res.json(stamped(await cloudRaw('GET', `/api/admin/finance/payments/${id}`)));
}));

/*
 *  تطبیقِ فروشِ آنلاینِ دکان‌ها (shop #411، ‎GET /api/admin/system/reconciliation‎) — فقط ارشد در سرورِ حساب ⇒
 *  این‌جا admin. ⛔ «مالِ دکان» است (فروش، بازپرداخت، نقدِ پیک)، نه درآمدِ اشتراک؛ در گزارشِ مغایرت کنارِ هم
 *  دیده می‌شوند، نه جمع. سرورِ حسابِ بی #411 ⇒ «در دسترس نیست»، نه خطای گنگ.
 */
router.get('/online-reconciliation', requireRole('admin'), guard(async (req, res) => {
  const query = pick(req.query, ['from', 'to', 'fromDate', 'toDate']);
  try {
    res.json(stamped(await cloudRaw('GET', '/api/admin/system/reconciliation', { query })));
  } catch (err) {
    if (err.code === 'route_not_found' || err.code === 'account_server_outdated' || err.status === 404) {
      return res.json({
        available: false, reason: 'route_missing', capability: 'shop#411',
        needs: 'GET /api/admin/system/reconciliation (shop #411)', message: 'تطبیقِ فروشِ آنلاین روی این نسخهٔ سرورِ حساب نیست', fetchedAt: Date.now(),
      });
    }
    throw err;
  }
}));

/* ───────────────────────────── خروجیِ CSV ───────────────────────────── */

/*
 *  ⛔ صفحه‌به‌صفحه (هر بار حداکثر ۵۰۰۰ ردیف؛ نشانگرِ بعدی در ‎X-Next-Cursor‎) — سرورِ حساب هر صفحه را در سابقهٔ
 *  خودش می‌نویسد؛ پنل هم یک ردیف. فایل با نشستِ پنل گرفته می‌شود (توکن در نشانی نیست).
 */
router.get('/export', financeWriter, guard(async (req, res) => {
  const query = pick(req.query, ['dataset', ...PAYMENT_FILTERS, 'kind', 'paymentId']);
  if (!(await hasFinance())) throw missingErr();
  const out = await cloudRaw('GET', '/api/admin/finance/export', { query });
  const csv = typeof out?.csv === 'string' ? out.csv : '';
  const name = /^[A-Za-z0-9_.-]{1,120}$/.test(String(out?.filename || '')) ? out.filename : 'vill3n-finance.csv';
  audit({
    actor: actorOf(req), action: 'account.finance.exported', entity: 'finance', entityId: query.dataset || 'payments',
    detail: { rows: Number(out?.rows) || 0, more: Boolean(out?.nextCursor), filters: Object.keys(query) },
  });
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${name}"`,
    'Cache-Control': 'no-store',
    'X-Row-Count': String(Number(out?.rows) || 0),
    ...(out?.nextCursor && /^[A-Za-z0-9_-]{1,300}$/.test(out.nextCursor) ? { 'X-Next-Cursor': out.nextCursor } : {}),
    'Access-Control-Expose-Headers': 'X-Next-Cursor, X-Row-Count',
  });
  res.send(csv);
}));

/* ───────────────────────────── سندِ اصلاحی ───────────────────────────── */

const reauthLimit = rateLimit({
  name: 'finance-reauth', max: 5, windowMs: 15 * 60_000,
  key: (req) => `u${req.user?.id ?? 'x'}`,
  skipSuccess: true, countIf: (_req, res) => res.locals?.reauthFailed === true,
});

/** احرازِ دوباره: رمزِ پنلِ همین کاربر همراهِ درخواست، یا — اگر فاز ۱ در پایه است — نشستِ تازه. */
function reauth(req, res, next) {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (password) {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(Number(req.user.id));
    if (!row || !panelAuth.verifyPassword(password, row.password_hash)) {
      res.locals.reauthFailed = true;
      audit({ actor: actorOf(req), action: 'account.finance.reauth_failed', entity: 'finance', result: 'forbidden' });
      return res.status(403).json({ error: 'reauth_failed', message: 'رمزِ پنل درست نیست' });
    }
    if (typeof panelAuth.markFresh === 'function' && req.user?.sessionId) panelAuth.markFresh(req.user.sessionId);
    res.locals.reauthAt = Date.now();
    return next();
  }
  if (typeof panelAuth.requireRecentAuth === 'function') {
    return panelAuth.requireRecentAuth(req, res, () => { res.locals.reauthAt = Date.now(); next(); });
  }
  return res.status(403).json({ error: 'reauth_required', message: 'برای سندِ اصلاحی رمزِ پنلِ خودتان را دوباره بزنید' });
}

const IDEM_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
const KINDS = ['correction', 'refund', 'reversal', 'reference'];

function adjustmentBody(b = {}) {
  const kind = String(b.kind || '');
  if (!KINDS.includes(kind)) throw bad('bad_kind', 'نوعِ سند درست نیست');
  const paymentId = String(b.paymentId || '');
  if (!ID.test(paymentId)) throw bad('bad_id', 'شناسهٔ پرداخت درست نیست');
  const reason = String(b.reason ?? '').trim();
  if (reason.length < 3 || reason.length > 300) throw bad('reason_required', 'دلیلِ سند را بنویسید (۳ تا ۳۰۰ نویسه) — در سابقهٔ سرورِ حساب می‌ماند');
  if (b.confirm !== true) throw bad('confirm_required', 'این کار پیش از فرستادن تأیید می‌خواهد');
  const key = String(b.idempotencyKey ?? '').trim();
  if (!IDEM_RE.test(key)) throw bad('idempotency_key_required', 'کلیدِ یکتایی لازم است (رابطِ پنل خودش می‌فرستد)');
  const num = (x) => (x === undefined || x === null || x === '' ? undefined : Number(x));
  const amount = num(b.amount);
  if (amount !== undefined && (!Number.isSafeInteger(amount) || Math.abs(amount) > 1e9)) throw bad('bad_amount', 'مبلغ عددِ صحیح نیست');
  const expectedNet = num(b.expectedNet);
  if (expectedNet !== undefined && !Number.isSafeInteger(expectedNet)) throw bad('bad_expected_net', 'خالصِ مورد انتظار عدد نیست');
  const reference = String(b.reference ?? '').trim().slice(0, 120);
  //  ⚠️ بدنهٔ بالادست همیشه همین کلیدها و به همین ترتیب: سرورِ حساب کلیدِ یکتایی را به هشِ بدنه می‌بندد
  return {
    key,
    body: {
      paymentId, kind, reason,
      ...(amount !== undefined ? { amount } : {}),
      ...(reference ? { reference } : {}),
      ...(expectedNet !== undefined ? { expectedNet } : {}),
    },
  };
}

router.post('/adjustments', financeWriter, reauthLimit, reauth, guard(async (req, res) => {
  const { key, body } = adjustmentBody(req.body);
  if (!(await hasFinance())) throw missingErr();
  //  ⛔ فقط با کلیدِ سرویس: راهِ پیشین (ارشدِ مشترک) آدمِ واقعی را به سندِ پولی نمی‌برد (یافتهٔ S4)
  const st = await serviceKeyStatus();
  if (st.mode !== 'service') {
    throw bad('service_key_required', 'سندِ اصلاحی فقط از راهِ کلیدِ سرویس ثبت می‌شود تا نامِ شما در سندِ سرورِ حساب بماند — از «یکپارچه‌سازی» کلیدِ سرویس را بسازید', 409);
  }
  const out = await cloudRaw('POST', '/api/admin/finance/adjustments', {
    body,
    headers: { 'idempotency-key': key, 'x-actor-reauth-at': String(res.locals.reauthAt || Date.now()) },
  });
  audit({
    actor: actorOf(req), action: 'account.finance.adjustment', entity: 'payment', entityId: body.paymentId,
    detail: {
      kind: body.kind, reason: body.reason, docNo: out?.adjustment?.docNo || null, amount: out?.adjustment?.amount ?? null,
      netAfter: out?.adjustment?.netAfter ?? null, replayed: out?.replayed === true,
    },
  });
  res.status(out?.replayed ? 200 : 201).json(stamped(out));
}));

export default router;
