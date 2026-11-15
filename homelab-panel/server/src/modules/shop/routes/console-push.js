// ---------------------------------------------------------------------------
//  🔔 «اعلانِ گوشی (Firebase)» — کلیدِ حسابِ سرویس و کلیدِ «روشن» ِ پوشِ سرورِ حساب، از مرکزِ فرمان (۱.۵۱.۲)
//
//    GET  /console/push     حالِ پوشیده (‎GET /api/admin/push‎): روشن؟ کلید هست؟ پروژه، دستگاه‌ها — **هرگز خودِ کلید**
//    PUT  /console/push     ‎{ enabled?, serviceAccount? }‎ ⇒ ‎PUT /api/admin/push‎ (فقط ارشد در سرورِ حساب)
//
//  دستورِ صاحب سامانه: «‎api.<دامنه>/admin/‎ برایم باز نمی‌شود، مرکزِ فرمان باز می‌شود؛ کلیدِ پوش را همان‌جا بگذارم.»
//
//  ⛔ کمترین اختیار: فقط همین دو در و فقط همین دو فیلد به سرورِ حساب می‌رود — نه ‎clearServiceAccount‎، نه رمز، نه هر
//     فیلدِ دیگری از بدنه. نوشتن فقط admin ِ پنل (⇐ ارشدِ سرورِ حساب، `ACTOR_ROLE`) و **همیشه** پشتِ «حالتِ تغییر»/احرازِ
//     دوباره (`flagStepUp(() => true)` ِ ‎console-shell.js‎ — همان پنجرهٔ ۱.۵۱.۱: یک بار رمز، ۱۵ دقیقهٔ لغزان، سقفِ ۶۰).
//  ⛔ شکل و کلید **پیش از** احرازِ دوباره سنجیده می‌شود (کدِ دوعاملی برای بدنهٔ بد نمی‌سوزد) و پیش از سرورِ حساب: JSON،
//     ‎type === "service_account"‎، ‎project_id‎ (همان الگوی ‎PROJECT_ID‎ ِ shop ‎lib/push.js‎)، ‎client_email‎، ‎private_key‎.
//     همان قاعده در وب: `serviceAccountProblem` ِ ‎web/src/modules/shop/consoleData.ts‎ (آزمون یکی بودنشان را می‌سنجد).
//  ⛔ کلید هرگز در پاسخ، خطا، دفتر، لاگ یا نشانی نیست: پیامِ خطا ثابت است (نه تکه‌ای از متن)، دفتر فقط «کلید عوض شد/نشد»
//     و نامِ پروژه، و پاسخِ سرورِ حساب هم از فهرستِ سفید ِ `pushView` می‌گذرد (اگر روزی کلید را برگرداند، این‌جا می‌ماند).
//     سقفِ بدنه ۶۴ کیلوبایت (‎src/index.js‎) و خطای بدنهٔ بد/بزرگ همان پیامِ ثابتِ پنل است (بی تکهٔ بدنه).
// ---------------------------------------------------------------------------
import { audit, bridgeFail, cloudRaw, panelAuth, panelRoles } from '../host.js';
import { requireModule } from '../console/modules.js';
import { flagStepUp, sudoView } from './console-shell.js';

const { requireRole } = panelRoles;
const actorOf = (req) => req.user?.username || 'admin';

/** بلندترین متنِ کلید (نویسه) — یک فایلِ کلیدِ واقعی حدودِ ۲٫۳ کیلوبایت است؛ سقفِ بدنهٔ درِ پنل ۶۴ کیلوبایت. */
export const PUSH_SA_MAX = 60_000;
/** همان الگوی ‎PROJECT_ID‎ ِ shop ‎lib/push.js‎ — شناسهٔ دیگر را سرورِ حساب هرگز نمی‌فرستد (‎fcm_bad_project_id‎). */
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * متنِ فایلِ کلید درست است؟ ⇒ `null`؛ وگرنه کدِ مشکل (بی هیچ تکه‌ای از خودِ متن).
 *   sa_empty · sa_too_large · sa_not_json · sa_app_config (google-services.json) · sa_not_key · sa_incomplete · sa_bad_project
 */
export function checkServiceAccount(text) {
  if (typeof text !== 'string' || !text.trim()) return 'sa_empty';
  if (text.length > PUSH_SA_MAX) return 'sa_too_large';
  let sa;
  try { sa = JSON.parse(text); } catch { return 'sa_not_json'; }
  if (!sa || typeof sa !== 'object' || Array.isArray(sa)) return 'sa_not_key';
  if (sa.type !== 'service_account') return sa.project_info || sa.client ? 'sa_app_config' : 'sa_not_key';
  const str = (v) => typeof v === 'string' && v.trim() !== '';
  if (!str(sa.project_id) || !str(sa.client_email) || !str(sa.private_key) || !EMAIL.test(sa.client_email)) return 'sa_incomplete';
  if (!PROJECT_ID.test(sa.project_id)) return 'sa_bad_project';
  return null;
}

const NOT_KEY = 'این فایلِ کلید نیست؛ فایلی را بزنید که از Service accounts ← Generate new private key گرفتید';
export const SA_MESSAGES = Object.freeze({
  sa_empty: 'متنِ فایلِ کلید خالی است',
  sa_too_large: 'این متن از یک فایلِ کلید بسیار بزرگ‌تر است',
  sa_not_json: `${NOT_KEY} (متن JSON ِ درست نیست — شاید نیمه کپی شده)`,
  sa_app_config: `${NOT_KEY} (این google-services.json ِ برنامه است، نه کلیدِ سرویس)`,
  sa_not_key: NOT_KEY,
  sa_incomplete: `${NOT_KEY} (project_id، client_email یا private_key ندارد)`,
  sa_bad_project: 'شناسهٔ پروژه (project_id) در این فایل شکلِ درستی ندارد',
});

/** فهرستِ سفیدِ پاسخِ سرورِ حساب — فقط حال، هرگز کلید */
export function pushView(raw) {
  const p = raw && typeof raw === 'object' ? (raw.push && typeof raw.push === 'object' ? raw.push : raw) : {};
  const s = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
  const n = Number(p.devices);
  const a = p.apns && typeof p.apns === 'object' ? p.apns : null;
  return {
    enabled: p.enabled === true,
    configured: p.configured === true,
    source: s(p.source, 20),
    project: s(p.project, 60),
    account: s(p.account),
    devices: Number.isFinite(n) && n >= 0 ? n : null,
    apns: a ? { configured: a.configured === true, env: s(a.env, 20), reason: s(a.reason, 60) } : null,
  };
}

function guard(handler) {
  return async (req, res) => {
    try { await handler(req, res); } catch (err) { bridgeFail(res, err); }
  };
}
function fail(code, status, message) {
  return Object.assign(new Error(message), { code, status });
}

/**
 * خطای سرورِ حساب هرگز تکه‌ای از کلید را به رابط نمی‌برد: پیامی که نشانِ کلید دارد (‎PRIVATE KEY‎، آغازِ ‎private_key‎ یا
 * ‎client_email‎) با پیامِ ثابت عوض می‌شود. امروز shop فقط پیامِ ثابت می‌دهد؛ این برای فردای ناپیدا است.
 */
function scrubUpstream(err, text) {
  if (!err || typeof err.message !== 'string' || !text) return err;
  let sa = null;
  try { sa = JSON.parse(text); } catch { sa = null; }
  const pk = typeof sa?.private_key === 'string' ? sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '') : '';
  const leaks = /PRIVATE KEY/i.test(err.message)
    || (pk.length >= 24 && err.message.replace(/\s+/g, '').includes(pk.slice(0, 24)))
    || (typeof sa?.client_email === 'string' && sa.client_email && err.message.includes(sa.client_email));
  if (leaks) err.message = 'سرورِ حساب این کلید را نپذیرفت';
  return err;
}

/** شکلِ بدنه، پیش از احرازِ دوباره و پیش از سرورِ حساب. فقط ‎enabled‎ و ‎serviceAccount‎ برداشته می‌شوند. */
function pushShape(req, res, next) {
  const bad = (error, message, extra = {}) => res.status(400).json({ error, message, ...extra });
  const b = req.body;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return bad('bad_body', 'بدنهٔ درخواست درست نیست');
  const out = {};
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') return bad('bad_enabled', '«روشن» فقط بله یا نه است');
    out.enabled = b.enabled;
  }
  if (b.serviceAccount !== undefined && b.serviceAccount !== null && b.serviceAccount !== '') {
    const problem = checkServiceAccount(b.serviceAccount);
    if (problem) return bad('bad_service_account', SA_MESSAGES[problem], { problem });
    out.serviceAccount = b.serviceAccount.trim();
  }
  if (out.enabled === undefined && !out.serviceAccount) return bad('nothing_to_change', 'چیزی برای ذخیره نیامد — کلید را بگذارید یا «روشن» را عوض کنید');
  res.locals.push = out;
  return next();
}

/**
 * درها را روی همان روترِ پل سوار می‌کند (‎/api/account-admin/console/push‎).
 * @param {import('express').Router} router
 */
export function mountConsolePush(router) {
  router.get('/console/push', requireModule('settings'), guard(async (req, res) => {
    const out = await cloudRaw('GET', '/api/admin/push');
    res.setHeader('Cache-Control', 'no-store');
    res.json({ push: pushView(out), fetchedAt: Date.now() });
  }));

  router.put('/console/push', requireModule('settings'), requireRole('admin'), pushShape, flagStepUp(() => true), guard(async (req, res) => {
    //  ⛔ کمربندِ دوم: بی احرازِ همین درخواست یا پنجرهٔ باز به این‌جا نمی‌رسد
    if (res.locals.reauthed !== true) throw fail('reauth_required', 403, 'برای این کار رمزِ پنلِ خودتان را دوباره بزنید');
    const { enabled, serviceAccount } = res.locals.push;
    if (enabled === true && !serviceAccount) {
      //  «روشن» بی کلید ⇒ سرورِ حساب روشن می‌گفت و هیچ پیامی نمی‌رفت — راست بگوییم، پیش از نوشتن
      const cur = pushView(await cloudRaw('GET', '/api/admin/push'));
      if (!cur.configured) throw fail('push_key_missing', 400, 'اول متنِ فایلِ کلید را بگذارید؛ بی کلید «روشن» هیچ پیامی نمی‌فرستد');
    }
    const body = {};
    if (enabled !== undefined) body.enabled = enabled;
    if (serviceAccount) body.serviceAccount = serviceAccount;
    let view;
    try {
      view = pushView(await cloudRaw('PUT', '/api/admin/push', { body }));
    } catch (err) {
      throw scrubUpstream(err, serviceAccount);
    }
    if (res.locals.viaSudo) panelAuth.touchSudo(req.user?.sessionId);
    audit({
      actor: actorOf(req), action: 'account.push.update', entity: 'push', entityId: view.project || null,
      detail: { enabled: enabled ?? null, keyChanged: Boolean(serviceAccount), project: view.project || null, ...(res.locals.viaSudo ? { viaSudo: true } : {}) },
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, push: view, confirmedByServer: true, sudo: sudoView(req.user?.sessionId), fetchedAt: Date.now() });
  }));
}
