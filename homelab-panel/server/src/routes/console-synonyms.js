// ---------------------------------------------------------------------------
//  ۴-۱ «ب» (تصمیمِ ۱۴۰۵/۰۸/۲۰، POS-04 و WEB-05) — فهرستِ مرکزیِ مترادف برای جست‌وجو، در «تنظیماتِ مرکزی» (۱.۵۰.۸۹)
//
//    GET /console/search/synonyms   ⇐ GET /api/admin/search/synonyms   (هر نقشی که ماژولِ «تنظیمات» را می‌بیند)
//    PUT /console/search/synonyms   ⇐ PUT /api/admin/search/synonyms   (admin ِ پنل؛ آن‌جا «فقط ارشد»)
//
//  یک فهرست برای همهٔ دکان‌ها که صاحبِ پلتفرم نگه می‌دارد («بوره = شکر»، نامِ دری/ایرانی/پشتو/انگلیسیِ یک کالا)؛ ویرایشگرِ
//  هر دکان (۴-۱ «الف») بعداً. هستهٔ جست‌وجوی برنامه‌ها (`text-core.matches(text, q, synonyms)` ِ shop، همتای
//  `TextNormalizer.kt`) گروه‌ها را همین شکل می‌پذیرد: ‎[["بوره","شکر"], …]‎ — فرهنگِ ثابت در کد ممنوع است.
//
//  ⛔ قرارداد با سرورِ حساب (ریپوی shop) پشتِ توانایی ‎synonyms.v1‎ — همان الگوی ‎holidays.v1‎ (`console-holidays.js`):
//       GET ⇒ ‎{ version, updatedAt, groups: string[][] }‎ ·  PUT ‎{ groups, version, reason }‎ ⇒ همان + ‎unchanged?‎
//       ‎409 synonyms_version‎ وقتی نسخه کهنه است؛ سرورِ حساب همین سنجش را دوباره می‌کند و فهرست را به برنامه‌ها می‌دهد.
//     بی آن (سرورِ حسابِ امروز) ⇒ خواندن `unavailable` («سرورِ حساب هنوز این را ندارد»)، نوشتن ‎501 capability_missing‎ —
//     هیچ فهرستِ ساختگی، هیچ پرسشِ بی‌نتیجه از سرورِ حساب.
//  ⛔ نوشتن: admin + دلیلِ ۳ تا ۲۰۰ + تأیید + کلیدِ یکتاییِ رابط (`makeIdemOnce`) + نسخهٔ همان فهرستی که دیده شد + سقفِ نرخِ
//     هر کاربر + ردیفِ دفترِ پنل (`account.synonyms.updated`).
//  ⛔ سنجش پیش از پل (`validateSynonyms`): فهرست، حدِ ۵۰۰ گروه، هر گروه ۲ تا ۲۰ واژه، هر واژه متن و پس از برداشتنِ نویسه‌های
//     کنترلی ۱ تا ۶۰ نویسه، یک واژه فقط در یک گروه (با یک‌شکل کردنِ «ي/ی»، «ك/ک»، نیم‌فاصله، اعرابِ عربی، رقمِ فارسی/عربی و
//     بزرگ/کوچکِ لاتین) — گروهِ بد کلِ درخواست را رد می‌کند (‎400 synonym_invalid‎)، نه نادیده گرفتنِ بی‌صدا.
//  ⛔ پاسخ فقط فیلدهای شناخته؛ واژه‌ها متنِ ساده‌اند و رابط هرگز از آن‌ها HTML نمی‌سازد.
// ---------------------------------------------------------------------------
import * as panelRoles from '../control/roles.js';
import { audit } from '../control/audit.js';
import { cloudRaw } from '../stations/cloud.js';
import { rateLimit } from '../platform/rate-limit.js';
import { requireModule } from '../console/modules.js';
import { checkIdemKey, makeIdemOnce } from '../account/idem-once.js';

const { requireRole } = panelRoles;
const CAP = 'synonyms.v1';
const UP = '/api/admin/search/synonyms';
export const SYNONYM_GROUPS_MAX = 500;
export const SYNONYM_TERMS_MAX = 20;
export const SYNONYM_TERM_MAX = 60;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** کلیدِ سنجشِ «همان واژه» — فقط برای تکراری‌ها؛ متنِ ذخیره‌شده همان است که آمد */
export function synonymKey(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[ة]/g, 'ه')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ً-ٰٟـ]/g, '')                    //  اعراب و کشیده
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[‌‍‎‏]/g, '')                    //  نیم‌فاصله و نشانه‌های جهت
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const invalid = (badInput, message) => badInput('synonym_invalid', message);

/** گروه‌ها ⇒ فهرستِ پاک (همان ترتیب)؛ هر گروهِ نادرست ⇒ ‎400 synonym_invalid‎ */
export function validateSynonyms(groups, badInput) {
  if (!Array.isArray(groups)) throw invalid(badInput, 'فهرست باید آرایه‌ای از گروه‌ها باشد');
  if (groups.length > SYNONYM_GROUPS_MAX) throw invalid(badInput, `بیش از ${SYNONYM_GROUPS_MAX} گروه`);
  const owner = new Map();   //  کلیدِ واژه ⇒ شمارهٔ گروه
  return groups.map((g, i) => {
    if (!Array.isArray(g)) throw invalid(badInput, `گروهِ ${i + 1} باید فهرستی از واژه‌ها باشد`);
    if (g.length > SYNONYM_TERMS_MAX) throw invalid(badInput, `گروهِ ${i + 1}: بیش از ${SYNONYM_TERMS_MAX} واژه`);
    const out = [];
    const local = new Set();
    for (const t of g) {
      if (typeof t !== 'string') throw invalid(badInput, `گروهِ ${i + 1}: هر واژه باید متن باشد`);
      const s = t.replace(CONTROL, '').replace(/\s+/g, ' ').trim();
      if (!s) continue;
      if (s.length > SYNONYM_TERM_MAX) throw invalid(badInput, `گروهِ ${i + 1}: «${s.slice(0, 20)}…» بلندتر از ${SYNONYM_TERM_MAX} نویسه است`);
      const k = synonymKey(s);
      if (!k || local.has(k)) continue;                              //  تکرار در همان گروه ⇒ یک بار
      if (owner.has(k)) throw invalid(badInput, `«${s}» هم در گروهِ ${owner.get(k) + 1} و هم در گروهِ ${i + 1} آمده — هر واژه فقط در یک گروه`);
      local.add(k);
      out.push(s);
    }
    if (out.length < 2) throw invalid(badInput, `گروهِ ${i + 1}: دست‌کم دو واژهٔ جدا لازم است`);
    for (const k of local) owner.set(k, i);
    return out;
  });
}

/** پاسخِ بالادست ⇒ فقط فیلدهای شناخته؛ گروهِ خراب کنار می‌رود، نسخهٔ نادرست ⇒ null (نوشتن بسته). */
export function shapeSynonyms(out) {
  const version = Number.isSafeInteger(out?.version) && out.version >= 0 ? out.version : null;
  const groups = [];
  for (const g of (Array.isArray(out?.groups) ? out.groups : []).slice(0, SYNONYM_GROUPS_MAX)) {
    if (!Array.isArray(g)) continue;
    const terms = g.slice(0, SYNONYM_TERMS_MAX).filter((t) => typeof t === 'string')
      .map((t) => t.replace(CONTROL, '').slice(0, SYNONYM_TERM_MAX).trim()).filter(Boolean);
    if (terms.length >= 2) groups.push(terms);
  }
  const updatedAt = Number(out?.updatedAt);
  return { version, updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : null, groups };
}

const str = (v, max) => (typeof v === 'string' ? v.replace(CONTROL, ' ').slice(0, max) : '');

/**
 * @param {import('express').Router} router  همان روترِ ‎account-admin.js‎ (همان «انجام‌دهنده»، فهرستِ سفید و ‎bridge-roles.mjs‎)
 * @param {{ guard: Function, badInput: Function, actorOf: Function, capListed: (cap: string) => Promise<boolean>,
 *           missingErr: Function, unavailable: Function }} d
 */
export function mountConsoleSynonyms(router, { guard, badInput, actorOf, capListed, missingErr, unavailable }) {
  const once = makeIdemOnce();
  const writeLimit = rateLimit({ name: 'console-synonyms-write', max: 30, windowMs: 10 * 60_000, key: (req) => `u${req.user?.id ?? 'x'}` });
  const read = requireModule('settings');

  router.get('/console/search/synonyms', read, guard(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!(await capListed(CAP))) return res.json(unavailable(CAP));
    const doc = shapeSynonyms(await cloudRaw('GET', UP));
    res.json({ available: true, fetchedAt: Date.now(), ...doc, max: SYNONYM_GROUPS_MAX, termsMax: SYNONYM_TERMS_MAX, termMax: SYNONYM_TERM_MAX });
  }));

  router.put('/console/search/synonyms', read, requireRole('admin'), writeLimit, guard(async (req, res) => {
    //  همهٔ ورودی پیش از هر پرسش از سرورِ حساب
    if (req.body?.confirm !== true) throw badInput('confirm_required', 'این کار پیش از فرستادن تأیید می‌خواهد');
    const reason = str(req.body?.reason, 400).trim();
    if (reason.length < 3 || reason.length > 200) throw badInput('reason_required', 'دلیل را بنویسید (۳ تا ۲۰۰ نویسه) — در دفترِ پنل و سرورِ حساب می‌ماند');
    const key = checkIdemKey(req.body?.idempotencyKey);
    const version = req.body?.version;
    if (!Number.isSafeInteger(version) || version < 0) throw badInput('bad_version', 'نسخهٔ همان فهرستی که دیدید لازم است');
    const groups = validateSynonyms(req.body?.groups, badInput);
    if (!(await capListed(CAP))) throw missingErr(CAP);
    const out = await once(req, key, `${version}|${reason}|${JSON.stringify(groups)}`, 'search:synonyms', async () => {
      const r = await cloudRaw('PUT', UP, { body: { groups, version, reason } });
      const doc = shapeSynonyms(r);
      const unchanged = r?.unchanged === true;
      audit({ actor: actorOf(req), action: 'account.synonyms.updated', entity: 'search', entityId: 'synonyms',
        detail: { reason, from: version, version: doc.version, groups: doc.groups.length, terms: doc.groups.reduce((n, g) => n + g.length, 0), unchanged } });
      return { ok: true, ...doc, unchanged, confirmedAt: Date.now() };
    });
    res.json(out);
  }));
}
