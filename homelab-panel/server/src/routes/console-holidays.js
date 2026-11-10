// ---------------------------------------------------------------------------
//  LOC-04 در پنلِ مرکزی — جدولِ تعطیلاتِ رسمی (۴.۱۲ «تنظیماتِ مرکزی»؛ shop ‎claude/loc-04‎، توانایی ‎holidays.v1‎)
//
//    GET /console/calendar/holidays   ⇐ GET /api/admin/calendar/holidays   (هر نقشی که ماژولِ «تنظیمات» را می‌بیند)
//    PUT /console/calendar/holidays   ⇐ PUT /api/admin/calendar/holidays   (admin ِ پنل؛ آن‌جا «فقط ارشد»)
//
//  ⛔ بی `holidays.v1` (سرورِ حسابِ کهنه) ⇒ خواندن `unavailable` (رابط: «سرورِ حساب کهنه است»)، نوشتن ‎501 capability_missing‎ —
//     هیچ جدولِ ساختگی، هیچ پرسشِ بی‌نتیجه از سرورِ حساب.
//  ⛔ نوشتن: admin + دلیلِ ۳ تا ۲۰۰ + تأیید + کلیدِ یکتاییِ رابط (یادِ پل، `makeIdemOnce`؛ بالادست کلید ندارد، ولی «همان جدول ⇒
//     `unchanged`» تکرار را بی‌اثر می‌کند) + سقفِ نرخِ هر کاربر + ردیفِ دفترِ پنل (`account.holidays.updated`).
//  ⛔ جدول **همان سنجشِ سرورِ حساب** را پیش از پل می‌گذرد (`lib/holidays.js` ⇒ `validate` / `isDate` ِ shop): فهرست، حدِ ۵۰۰،
//     تاریخِ میلادیِ واقعیِ ‎YYYY-MM-DD‎ در ۲۰۰۰-۰۱-۰۱ تا ۲۱۹۹-۱۲-۳۱ (۲۰۲۶-۰۲-۳۰ نه، سالِ خورشیدیِ ۱۴۰۵ نه)، بی تاریخِ تکراری،
//     نامِ دری لازم، هر نام متن و پس از برداشتنِ نویسه‌های کنترلی تا ۸۰ نویسه — ردیفِ بد کلِ درخواست را رد می‌کند (‎400 holiday_invalid‎).
//  ⛔ نسخه (‎version‎ ِ همان جدولی که دیده شد) لازم است: ‎409 holiday_version‎ ِ سرورِ حساب همان‌طور بالا می‌رود ⇒ رابط:
//     «کسِ دیگری در این میان عوضش کرد — دوباره بخوانید»، نه رونویسیِ بی‌صدا.
//  ⛔ پاسخ فقط فیلدهای شناخته؛ نام‌ها متنِ ساده‌اند و رابط هرگز از آن‌ها HTML نمی‌سازد.
// ---------------------------------------------------------------------------
import * as panelRoles from '../control/roles.js';
import { audit } from '../control/audit.js';
import { cloudRaw } from '../stations/cloud.js';
import { rateLimit } from '../platform/rate-limit.js';
import { requireModule } from '../console/modules.js';
import { checkIdemKey, makeIdemOnce } from '../account/idem-once.js';

const { requireRole } = panelRoles;
const CAP = 'holidays.v1';
export const HOLIDAYS_MAX = 500;
export const HOLIDAY_NAME_MAX = 80;
const LANGS = ['fa', 'en', 'ps'];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;

const monthDays = (y, m) => (m === 2 ? ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28) : (m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31));

/** همان `isDate` ِ shop (`lib/holidays.js` + `jdnOfIso` ِ `calendar-core.js`): میلادیِ واقعی، ۲۰۰۰ تا ۲۱۹۹ */
export function isHolidayDate(iso) {
  const m = typeof iso === 'string' ? DATE_RE.exec(iso) : null;
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > monthDays(y, mo)) return false;
  return iso >= '2000-01-01' && iso <= '2199-12-31';
}

const invalid = (badInput, message) => badInput('holiday_invalid', message);

/** همان `validate` ِ shop ⇒ جدولِ پاک و مرتب؛ هر ردیفِ نادرست ⇒ ‎400 holiday_invalid‎ (نه نادیده گرفتنِ بی‌صدا). */
export function validateHolidays(list, badInput) {
  if (!Array.isArray(list)) throw invalid(badInput, 'جدول باید فهرست باشد');
  if (list.length > HOLIDAYS_MAX) throw invalid(badInput, `بیش از ${HOLIDAYS_MAX} روز`);
  const seen = new Set();
  const out = list.map((h, i) => {
    if (!h || typeof h !== 'object' || Array.isArray(h)) throw invalid(badInput, `ردیفِ ${i + 1} نادرست است`);
    const date = typeof h.date === 'string' ? h.date.trim() : '';
    if (!isHolidayDate(date)) throw invalid(badInput, `ردیفِ ${i + 1}: تاریخ درست نیست (میلادیِ YYYY-MM-DD، ۲۰۰۰ تا ۲۱۹۹)`);
    if (seen.has(date)) throw invalid(badInput, `تاریخِ ${date} دو بار آمده است`);
    seen.add(date);
    const src = h.name && typeof h.name === 'object' && !Array.isArray(h.name) ? h.name : {};
    const name = {};
    for (const lang of LANGS) {
      const v = src[lang];
      if (v === undefined || v === null || v === '') continue;
      if (typeof v !== 'string') throw invalid(badInput, `ردیفِ ${i + 1}: نامِ ${lang} باید متن باشد`);
      const s = v.replace(CONTROL, '').trim();
      if (s.length > HOLIDAY_NAME_MAX) throw invalid(badInput, `ردیفِ ${i + 1}: نامِ ${lang} بلندتر از ${HOLIDAY_NAME_MAX} نویسه است`);
      if (s) name[lang] = s;
    }
    if (!name.fa) throw invalid(badInput, `ردیفِ ${i + 1}: نامِ دری لازم است`);
    return { date, name };
  });
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** پاسخِ بالادست ⇒ فقط فیلدهای شناخته؛ ردیفِ خراب کنار می‌رود (همان `parse` ِ shop)، نسخهٔ نادرست ⇒ null (نوشتن بسته). */
export function shapeHolidays(out) {
  const version = Number.isSafeInteger(out?.version) && out.version >= 0 ? out.version : null;
  const seen = new Set();
  const holidays = [];
  for (const h of (Array.isArray(out?.holidays) ? out.holidays : []).slice(0, HOLIDAYS_MAX)) {
    if (!h || typeof h !== 'object' || !isHolidayDate(h.date) || seen.has(h.date)) continue;
    seen.add(h.date);
    const src = h.name && typeof h.name === 'object' && !Array.isArray(h.name) ? h.name : {};
    const name = {};
    for (const lang of LANGS) {
      if (typeof src[lang] === 'string') {
        const s = src[lang].replace(CONTROL, '').slice(0, HOLIDAY_NAME_MAX);
        if (s) name[lang] = s;
      }
    }
    holidays.push({ date: h.date, name });
  }
  const updatedAt = Number(out?.updatedAt);
  return { version, updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : null, holidays };
}

const str = (v, max) => (typeof v === 'string' ? v.replace(CONTROL, ' ').slice(0, max) : '');

/**
 * @param {import('express').Router} router  همان روترِ ‎account-admin.js‎ (همان «انجام‌دهنده»، فهرستِ سفید و ‎bridge-roles.mjs‎)
 * @param {{ guard: Function, badInput: Function, actorOf: Function, capListed: (cap: string) => Promise<boolean>,
 *           missingErr: Function, unavailable: Function }} d
 */
export function mountConsoleHolidays(router, { guard, badInput, actorOf, capListed, missingErr, unavailable }) {
  const once = makeIdemOnce();
  //  ⛔ سقفِ هر کاربر روی کارِ حساس (سطلِ عمومیِ IP ِ ‎/api‎ پیش از ورود هم هست)
  const writeLimit = rateLimit({ name: 'console-holidays-write', max: 30, windowMs: 10 * 60_000, key: (req) => `u${req.user?.id ?? 'x'}` });
  const read = requireModule('settings');

  router.get('/console/calendar/holidays', read, guard(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!(await capListed(CAP))) return res.json(unavailable(CAP));
    const doc = shapeHolidays(await cloudRaw('GET', '/api/admin/calendar/holidays'));
    res.json({ available: true, fetchedAt: Date.now(), ...doc, max: HOLIDAYS_MAX, nameMax: HOLIDAY_NAME_MAX });
  }));

  router.put('/console/calendar/holidays', read, requireRole('admin'), writeLimit, guard(async (req, res) => {
    //  همهٔ ورودی پیش از هر پرسش از سرورِ حساب
    if (req.body?.confirm !== true) throw badInput('confirm_required', 'این کار پیش از فرستادن تأیید می‌خواهد');
    const reason = str(req.body?.reason, 400).trim();
    if (reason.length < 3 || reason.length > 200) throw badInput('reason_required', 'دلیل را بنویسید (۳ تا ۲۰۰ نویسه) — در دفترِ پنل و سرورِ حساب می‌ماند');
    const key = checkIdemKey(req.body?.idempotencyKey);
    const version = req.body?.version;
    if (!Number.isSafeInteger(version) || version < 0) throw badInput('bad_version', 'نسخهٔ همان جدولی که دیدید لازم است');
    const holidays = validateHolidays(req.body?.holidays, badInput);
    if (!(await capListed(CAP))) throw missingErr(CAP);
    const out = await once(req, key, `${version}|${reason}|${JSON.stringify(holidays)}`, 'calendar:holidays', async () => {
      const r = await cloudRaw('PUT', '/api/admin/calendar/holidays', { body: { holidays, version, reason } });
      const doc = shapeHolidays(r);
      const unchanged = r?.unchanged === true;
      audit({ actor: actorOf(req), action: 'account.holidays.updated', entity: 'calendar', entityId: 'holidays',
        detail: { reason, from: version, version: doc.version, count: doc.holidays.length, unchanged } });
      return { ok: true, ...doc, unchanged, confirmedAt: Date.now() };
    });
    res.json(out);
  }));
}

