// ---------------------------------------------------------------------------
//  کلیدِ سرویسِ پلِ سرورِ حساب + «انجام‌دهنده» — چسبِ فاز ۲ ِ پنل و فاز ۳ ِ سرورِ حساب
//  (‎docs/spec/ADMIN-CONTROL-PLANE.md‎ ِ ریپوی shop، بندهای ۱۲.۲ و ۱۲.۶)
//
//  تا امروز پل (‎stations/cloud.js‎) با **رمزِ یک ارشدِ مشترک** وارد سرورِ حساب می‌شد و هر کارِ پنل در
//  سابقهٔ آن‌جا به نامِ همان یک حساب می‌نشست (یافتهٔ S4 ِ ممیزی). سرورِ حسابِ فاز ۳ «کلیدِ سرویس»
//  (‎Bearer vsk_…‎) و سرآیندهای «انجام‌دهنده» (‎X-Actor-Id/Role/Name‎) را می‌پذیرد: نقشِ مؤثر =
//  کم‌رتبه‌ترِ انجام‌دهنده و سقفِ کلید، و مرز را **خودِ سرورِ حساب** می‌سنجد.
//
//  ⛔ کلید فقط در گاوصندوقِ پنل: جدولِ ‎settings‎ زیرِ ‎account_service_key‎، رمزشده با ‎data/vault.key‎
//     (‎SECRET_SETTINGS.whole‎ ِ ‎db.js‎). هیچ مسیری آن را برنمی‌گرداند، در لاگ و دفتر نمی‌آید
//     (‎publicServiceKey‎ فقط فراداده)، و حتی چهار نویسهٔ آخرش (مثلِ «hint» ِ گاوصندوقِ رازها) دیده نمی‌شود.
//  ⛔ «انجام‌دهنده» از نشستِ خودِ پنل و نقشِ **امروزِ** کاربر در پایگاه (‎roleOf‎)، نه از درخواست:
//       admin ⇒ superadmin · operator ⇒ admin · viewer ⇒ viewer  (همان نگاشتِ بندِ ۱۲.۲)
//     کارِ بی‌نشست (ربات‌ها، آینه، دیدبان) ⇒ ‎panel:system‎ — همان اختیارِ امروزِ پل، ولی با نامِ روشن.
//  ⚠️ خودِ تصمیمِ «کلید یا راهِ پیشین» در ‎stations/cloud.js‎ است (‎serviceKeyInUse‎).
// ---------------------------------------------------------------------------
import { AsyncLocalStorage } from 'node:async_hooks';
import { getSetting, setSetting } from '../db.js';
import { roleOf } from '../control/roles.js';

/** نامِ ردیفِ رمزشده در ‎settings‎ — در ‎SECRET_SETTINGS.whole‎ ِ ‎db.js‎ هم هست. */
export const SERVICE_KEY_SETTING = 'account_service_key';
/** شکلِ کلیدِ سرورِ حساب (‎lib/admin-service.js‎: ‎vsk_‎ + ۳۲ بایتِ base64url). */
export const SERVICE_KEY_RE = /^vsk_[A-Za-z0-9_-]{20,200}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

/** کلیدِ ذخیره‌شده (با خودِ کلید — فقط برای ‎cloud.js‎)، یا null. */
export function readServiceKey() {
  const v = getSetting(SERVICE_KEY_SETTING, null);
  if (!v || typeof v !== 'object' || !SERVICE_KEY_RE.test(String(v.key || '')) || !ID_RE.test(String(v.id || ''))) return null;
  return v;
}

/** فقط فراداده — هرگز خودِ کلید، پیشوندش یا تکه‌ای از آن. */
export function publicServiceKey(v) {
  if (!v) return null;
  return {
    id: String(v.id),
    name: v.name ? String(v.name) : null,
    roleCap: v.roleCap ? String(v.roleCap) : null,
    createdAt: Number(v.createdAt) > 0 ? Number(v.createdAt) : null,
    createdBy: v.createdBy ? String(v.createdBy) : null,
    storedAt: Number(v.storedAt) > 0 ? Number(v.storedAt) : null,
    rotatedFrom: v.rotatedFrom ? String(v.rotatedFrom) : null,
  };
}

export function storeServiceKey({ key, id, name, roleCap, createdAt, createdBy, rotatedFrom = null }) {
  if (!SERVICE_KEY_RE.test(String(key || '')) || !ID_RE.test(String(id || ''))) throw new Error('bad_service_key');
  setSetting(SERVICE_KEY_SETTING, {
    key: String(key), id: String(id), name: name ? String(name).slice(0, 80) : null,
    roleCap: roleCap ? String(roleCap) : null, createdAt: Number(createdAt) || null,
    createdBy: createdBy ? String(createdBy).slice(0, 80) : null, storedAt: Date.now(),
    rotatedFrom: rotatedFrom ? String(rotatedFrom) : null,
  });
}

export function forgetServiceKey() {
  setSetting(SERVICE_KEY_SETTING, null);
}

/* ───────────────────────────── «انجام‌دهنده» ───────────────────────────── */

const store = new AsyncLocalStorage();

/** نقشِ پنل ⇒ نقشِ سرورِ حساب (بندِ ۱۲.۲). نقشِ ناشناخته ⇒ کمترین. */
export const ACTOR_ROLE = Object.freeze({ admin: 'superadmin', operator: 'admin', viewer: 'viewer' });

/** کارِ بی‌نشستِ خودِ پنل (ربات، آینه، دیدبان) — همان اختیارِ امروزِ پل، با نامِ روشن در سابقه. */
export const SYSTEM_ACTOR = Object.freeze({ id: 'panel:system', role: 'superadmin', name: 'پنل (کارِ خودکار)' });

export function actorOfReq(req) {
  const role = roleOf(req);
  return {
    id: `panel:${Number(req.user.id)}`,
    role: ACTOR_ROLE[role] || 'viewer',
    name: String(req.user.username || '').slice(0, 80),
  };
}

/** میان‌افزار — ادامهٔ درخواست با «انجام‌دهنده»ِ همین نشست. بی نشست ⇒ همان «کارِ خودکار». */
export function withPanelActor(req, res, next) {
  if (!req.user?.id) return next();
  return store.run(actorOfReq(req), next);
}

export function currentActor() {
  return store.getStore() || SYSTEM_ACTOR;
}

/** سرآیندهای «انجام‌دهنده» برای سرورِ حساب — نام percent-encoded (فارسی در سرآیند جا نمی‌شود). */
export function actorHeaders(actor = currentActor()) {
  return {
    'x-actor-id': actor.id,
    'x-actor-role': actor.role,
    ...(actor.name ? { 'x-actor-name': encodeURIComponent(actor.name) } : {}),
  };
}
