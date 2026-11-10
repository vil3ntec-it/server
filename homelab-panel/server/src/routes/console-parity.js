// ---------------------------------------------------------------------------
//  S11 «هم‌ترازی با ‎/admin/‎» (۱.۵۰.۸۰، ممیزی §۹ ردیفِ ۱.۵۰.۷۹) — درهایی که تا امروز فقط کنسولِ وبِ سرورِ حساب داشت
//
//    PUT /console/release/beta                    ⇐ GET + PUT /api/admin/release/beta     (admin ِ پنل؛ آن‌جا «فقط ارشد»)
//    GET /console/downloads                       ⇐ GET /api/downloads (عمومی، `cloudCall('downloads')`)   (ماژولِ «نسخه‌ها»)
//    PUT /console/downloads                       ⇐ PUT /api/admin/downloads               (admin ِ پنل؛ آن‌جا «فقط ارشد»)
//    GET /console/system/notify-usage[?days=]     ⇐ GET /api/admin/system/notify-usage     (ماژولِ «سلامت»، سقفِ نرخِ هر کاربر)
//    GET /console/accounts/:app/:tenantId/backups ⇐ GET /api/admin/accounts/:app/:tenantId/backups   (ماژولِ «فروشگاه‌ها»، فقط فهرست)
//
//  قرارداد = main ِ shop (‎28f6acc29‎): ‎routes/admin-release.js‎، ‎admin-sales.js‎ (‎PUT /downloads‎)، ‎portal.js‎ (‎downloadsOf‎)،
//  ‎admin-system.js‎ + ‎lib/notify-usage.js‎، ‎admin-platform.js‎ + ‎lib/account-backups.js‎.
//
//  ⛔ نوشتن: admin + دلیلِ ۳ تا ۲۰۰ + تأیید + کلیدِ یکتاییِ رابط + سقفِ نرخِ هر کاربر + ردیفِ دفترِ پنل. ⚠️ این دو درِ بالادست
//     ‎Idempotency-Key‎ را **نمی‌شناسند** (‎lib/admin-write-once.js‎ فقط دستگاه، بانکِ عکس و ‎POST /backups‎؛ `idempotent-writes.v1`
//     همین را می‌گوید) ⇒ همیشه یادِ پل (`makeIdemOnce`) و هیچ سرآیندی — فرستادنِ کلیدی که نادیده گرفته می‌شود «محافظت‌شده» نشان
//     می‌داد بی آن‌که باشد. مهلت ⇒ «نامعلوم» (‎504 outcome_unknown‎ + ردیفِ `account.bridge.outcome_unknown` ِ `bridgeFail`)، و
//     همان کلید همان «نامعلوم» را بی درخواستِ دوم برمی‌گرداند.
//  ⛔ کانالِ آزمایشی: بالادست فهرست را **جایگزین** می‌کند و نسخه نمی‌گیرد ⇒ پل پیش از نوشتن همان ‎GET‎ را می‌خواند و نسخهٔ scope ِ
//     ‎release‎ (هر ‎live_config.set‎ یکی بالا) باید همانی باشد که مدیر دید؛ نه ⇒ ‎409 beta_version‎ و هیچ نوشتن (نه رونویسیِ
//     بی‌صدای فهرستِ تازهٔ دیگری). شناسه همان ‎parse‎ ِ آن‌جا (‎[A-Za-z0-9_-]{1,80}‎، تا ۲۰۰، ویرگول/ویرگولِ فارسی/فاصله).
//  ⛔ دانلود: نشانی به دستِ **همهٔ** مشتری‌ها می‌رسد (پورتال و SDK) ⇒ فقط ‎http(s)‎ ِ کامل، بی فاصله، تا ۳۰۰ (سرورِ حساب هیچ
//     سنجشی ندارد — ‎javascript:‎ هم می‌پذیرفت). فقط فیلدِ داده‌شده می‌رود؛ رشتهٔ خالی = پاک کردن (همان قرارداد). ‎min_above_latest‎ و
//     ‎bad_version‎ ِ آن‌جا همان‌طور بالا می‌روند.
//  ⛔ خواندن: viewer به بالا، **فقط** فیلدهای شناخته — نه شماره و متنِ پیام، نه مسیرِ دیسکِ سرورِ حساب، نه فیلدِ تازهٔ بی‌نام.
//  ⛔ نیست، عمداً: ‎DELETE …/backups/:id‎ (حذفِ دائمیِ پشتیبانِ مشتری ⇐ تصمیمِ مالک، «بایگانی به‌جای حذف») و دانلودِ همان پشتیبان
//     (خروجیِ دادهٔ خصوصی)؛ و ‎PUT /api/admin/telegram‎ (رازِ رباتِ **پمپ** — بیرون از این کار).
// ---------------------------------------------------------------------------
import * as panelRoles from '../control/roles.js';
import { audit } from '../control/audit.js';
import { cloudRaw, cloudCall } from '../stations/cloud.js';
import { rateLimit } from '../platform/rate-limit.js';
import { requireModule } from '../console/modules.js';
import { checkIdemKey, makeIdemOnce } from '../account/idem-once.js';

const { requireRole } = panelRoles;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]+/g;
const str = (v, max) => (typeof v === 'string' ? v.replace(CONTROL, ' ').slice(0, max) : '');
/** عددِ صحیحِ نامنفیِ آمده؛ وگرنه null (نیامده «—» است، نه صفر) */
const nn = (v) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);
const ts = (v) => (nn(v) && v > 0 ? v : null);
const word = (v, re) => (typeof v === 'string' && re.test(v) ? v : '');

/* ───────────────────────── کانالِ آزمایشی ───────────────────────── */

export const BETA_ID = /^[A-Za-z0-9_-]{1,80}$/;
export const BETA_MAX_IDS = 200;
const BETA_SHOW = 1000;
const BETA_LABEL = { shops: 'دکان‌ها', devices: 'دستگاه‌ها' };

function betaList(m) {
  const all = [...new Set((Array.isArray(m?.ids) ? m.ids : []).filter((x) => typeof x === 'string' && BETA_ID.test(x)))];
  return { ids: all.slice(0, BETA_SHOW), truncated: all.length > BETA_SHOW, updatedAt: ts(m?.updatedAt), updatedBy: str(m?.updatedBy, 120) };
}

/** پاسخِ ‎/api/admin/release/beta‎ ⇒ فقط شناسه‌ها، زمان، انجام‌دهنده و نسخهٔ scope ِ ‎release‎ (نادرست ⇒ null ⇒ نوشتن بسته) */
export function shapeBeta(out) {
  return { shops: betaList(out?.shops), devices: betaList(out?.devices), version: nn(out?.version) };
}

/** همان ‎parse‎ ِ ‎admin-release.js‎ — ولی فقط فهرست یا رشته (‎null‎، عدد، شیء ⇒ ‎bad_body‎، نه «پاک کن» ِ بی‌صدا) */
function betaIds(input, field, badInput) {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) && typeof input !== 'string') throw badInput('bad_body', `${BETA_LABEL[field]} باید فهرست باشد`);
  const raw = Array.isArray(input) ? input : input.split(/[\s,،]+/);
  if (raw.length > BETA_MAX_IDS * 4) throw badInput('too_many_ids', `حداکثر ${BETA_MAX_IDS} شناسه در ${BETA_LABEL[field]}`);
  const ids = [...new Set(raw.map((x) => (typeof x === 'string' ? x.trim() : String(x ?? '').trim())).filter(Boolean))];
  const bad = ids.filter((x) => !BETA_ID.test(x));
  if (bad.length) throw badInput('bad_release_id', `شناسهٔ نامعتبر در ${BETA_LABEL[field]}: ${bad.slice(0, 3).map((x) => x.slice(0, 40)).join('، ')} — فقط حروفِ انگلیسی، رقم، - و _`);
  if (ids.length > BETA_MAX_IDS) throw badInput('too_many_ids', `حداکثر ${BETA_MAX_IDS} شناسه در ${BETA_LABEL[field]}`);
  return ids;
}

/* ───────────────────────── دانلودِ برنامه‌ها ───────────────────────── */

export const DL_APPS = ['shop', 'pump'];
const DL_FIELDS = [['url', 300], ['version', 32], ['notes', 1000]];
const VERSION_RE = /^\d+(\.\d+){1,3}$/;

function shapeDownload(d) {
  return {
    app: word(d?.app, /^(shop|pump)$/), title: str(d?.title, 80), url: str(d?.url, 300), version: str(d?.version, 32),
    notes: str(d?.notes, 1000), minVersion: word(d?.minVersion, VERSION_RE),
  };
}
const shapeDownloads = (out) => (Array.isArray(out?.downloads) ? out.downloads : []).map(shapeDownload).filter((d) => d.app);

/** نشانیِ دانلود: خالی (پاک کردن) یا ‎http(s)‎ ِ کامل بی فاصله و بی نام/رمز، تا ۳۰۰ */
function downloadUrlOk(s) {
  if (s === '') return true;
  if (s.length > 300 || /\s/.test(s)) return false;
  try {
    const u = new URL(s);
    return (u.protocol === 'https:' || u.protocol === 'http:') && Boolean(u.hostname) && !u.username && !u.password;
  } catch { return false; }
}

/* ───────────────────────── مصرف و هزینهٔ پیام ───────────────────────── */

const CH_RE = /^[a-z][a-z0-9_]{0,19}$/;
const counts = (c) => ({ attempts: nn(c?.attempts), sent: nn(c?.sent), failed: nn(c?.failed), mock: nn(c?.mock), other: nn(c?.other), parts: nn(c?.parts), costMinor: nn(c?.costMinor) });

/** همان شکلِ ‎lib/notify-usage.js‎ ِ shop — فقط شناسه/نامِ دکان، کانال و عدد (آن‌جا هم «بی شماره و متن»؛ این‌جا دوباره بسته) */
export function shapeNotifyUsage(out) {
  const channels = (Array.isArray(out?.channels) ? out.channels : []).slice(0, 10)
    .filter((c) => CH_RE.test(String(c?.channel || ''))).map((c) => ({ channel: c.channel, unitMicros: nn(c.unitMicros), capMicros: nn(c.capMicros) }));
  const known = new Set(channels.map((c) => c.channel));
  const t = out?.totals || {};
  return {
    days: nn(out?.days), since: ts(out?.since), checkedAt: ts(out?.checkedAt), channels,
    totals: { sent: nn(t.sent), costMicros: nn(t.costMicros), costCap: nn(t.costCap), rateLimited: nn(t.rateLimited), shops: nn(t.shops) },
    shops: (Array.isArray(out?.shops) ? out.shops : []).slice(0, 100).map((s) => {
      const by = s?.byChannel && typeof s.byChannel === 'object' && !Array.isArray(s.byChannel) ? s.byChannel : {};
      return {
        shopId: word(s?.shopId, /^[A-Za-z0-9_-]{1,80}$/), name: str(s?.name, 200), sent: nn(s?.sent), costMicros: nn(s?.costMicros),
        byChannel: Object.fromEntries([...known].filter((ch) => by[ch] && typeof by[ch] === 'object')
          .map((ch) => [ch, { sent: nn(by[ch].sent), costMicros: nn(by[ch].costMicros), last24hMicros: nn(by[ch].last24hMicros) }])),
        costCap: nn(s?.costCap), rateLimited: nn(s?.rateLimited),
        nearCap: (Array.isArray(s?.nearCap) ? s.nearCap : []).filter((ch) => known.has(ch)),
      };
    }).filter((s) => s.shopId),
    shopsTruncated: out?.shopsTruncated === true, truncated: out?.truncated === true,
    codes: {
      currency: word(out?.codes?.currency, /^[A-Z]{3}$/), unitCostMinor: nn(out?.codes?.unitCostMinor), total: counts(out?.codes?.total),
      byPurpose: (Array.isArray(out?.codes?.byPurpose) ? out.codes.byPurpose : []).slice(0, 60)
        .map((p) => ({ purpose: word(p?.purpose, /^[a-z0-9_.-]{0,40}$/), shop: p?.shop === true, ...counts(p) })),
    },
  };
}

/* ───────────────────────── پشتیبان‌های هر حساب ───────────────────────── */

const TENANT_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** همان ‎shape‎ و ‎stats‎ ِ ‎lib/account-backups.js‎ — نه مسیرِ دیسک، نه ستونِ خام */
export function shapeTenantBackups(out, app) {
  const st = out?.stats || {};
  return {
    app,
    backups: (Array.isArray(out?.backups) ? out.backups : []).slice(0, 500).map((b) => ({
      id: word(b?.id, TENANT_RE), bytes: nn(b?.bytes), sha256: word(b?.sha256, /^[a-f0-9]{64}$/), label: str(b?.label, 120),
      kind: word(b?.kind, /^[a-z_]{1,20}$/), appVersion: str(b?.appVersion, 32), createdAt: ts(b?.createdAt), name: str(b?.name, 200),
    })).filter((b) => b.id),
    stats: {
      count: nn(st.count), usedBytes: nn(st.usedBytes), lastAt: ts(st.lastAt), keep: nn(st.keep), quotaBytes: nn(st.quotaBytes),
      maxBytes: nn(st.maxBytes), freeBytes: nn(st.freeBytes), paid: typeof st.paid === 'boolean' ? st.paid : null, source: word(st.source, /^[a-z_]{1,20}$/),
    },
  };
}

/* ───────────────────────── درها ───────────────────────── */

/**
 * @param {import('express').Router} router  همان روترِ ‎account-admin.js‎ (همان «انجام‌دهنده»، فهرستِ سفید و ‎bridge-roles.mjs‎)
 * @param {{ guard: Function, badInput: Function, actorOf: Function }} d
 */
export function mountConsoleParity(router, { guard, badInput, actorOf }) {
  const once = makeIdemOnce();
  const perUser = (req) => `u${req.user?.id ?? 'x'}`;
  //  ⛔ سقفِ هر کاربر روی کارِ حساس (سطلِ عمومیِ IP ِ ‎/api‎ پیش از ورود هم هست)
  const writeLimit = rateLimit({ name: 'console-parity-write', max: 30, windowMs: 10 * 60_000, key: perUser });
  //  گزارشِ مصرف تا ۳۱ روز و ۲۰٬۰۰۰ ردیفِ هر صندوق را آن‌جا می‌شمارد ⇒ viewer نباید بتواند سرورِ حساب را با آن بخواباند
  const usageLimit = rateLimit({ name: 'console-notify-usage', max: 60, windowMs: 10 * 60_000, key: perUser });

  /** دلیل + تأیید + کلید — پیش از هر پرسش از سرورِ حساب */
  const sensitive = (req) => {
    if (req.body?.confirm !== true) throw badInput('confirm_required', 'این کار پیش از فرستادن تأیید می‌خواهد');
    const reason = str(req.body?.reason, 400).trim();
    if (reason.length < 3 || reason.length > 200) throw badInput('reason_required', 'دلیل را بنویسید (۳ تا ۲۰۰ نویسه) — در دفترِ پنل می‌ماند');
    return { reason, key: checkIdemKey(req.body?.idempotencyKey) };
  };

  router.put('/console/release/beta', requireRole('admin'), writeLimit, guard(async (req, res) => {
    const { reason, key } = sensitive(req);
    const version = req.body?.version;
    if (!Number.isSafeInteger(version) || version < 0) throw badInput('bad_version', 'نسخهٔ همان فهرستی که دیدید لازم است');
    const shops = betaIds(req.body?.shops, 'shops', badInput);
    const devices = betaIds(req.body?.devices, 'devices', badInput);
    if (shops === undefined && devices === undefined) throw badInput('bad_body', 'فهرستِ دکان‌ها یا دستگاه‌ها لازم است');
    const out = await once(req, key, `beta|${version}|${reason}|${JSON.stringify([shops ?? null, devices ?? null])}`, 'release:beta', async () => {
      const cur = shapeBeta(await cloudRaw('GET', '/api/admin/release/beta'));
      if (cur.version === null || cur.version !== version) {
        throw Object.assign(new Error('کسِ دیگری در این میان فهرستِ کانالِ آزمایشی را عوض کرد — فهرستِ شما نوشته نشد؛ دوباره بخوانید'),
          { code: 'beta_version', status: 409 });
      }
      const r = await cloudRaw('PUT', '/api/admin/release/beta', {
        body: { ...(shops !== undefined ? { shops } : {}), ...(devices !== undefined ? { devices } : {}), reason },
      });
      const doc = shapeBeta(r);
      const changed = (Array.isArray(r?.changed) ? r.changed : []).filter((x) => x === 'shops' || x === 'devices');
      const diff = (field, ids) => {
        if (ids === undefined) return undefined;
        const prev = cur[field].ids;
        return { added: ids.filter((x) => !prev.includes(x)).join(', ').slice(0, 600), removed: prev.filter((x) => !ids.includes(x)).join(', ').slice(0, 600), count: ids.length };
      };
      audit({ actor: actorOf(req), action: 'account.release_beta.updated', entity: 'release', entityId: 'beta',
        detail: { reason, from: version, version: doc.version, changed, shops: diff('shops', shops), devices: diff('devices', devices) } });
      return { ok: true, ...doc, changed, confirmedAt: Date.now() };
    });
    res.json(out);
  }));

  router.get('/console/downloads', requireModule('versions'), guard(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const out = await cloudCall('downloads');
    res.json({ fetchedAt: Date.now(), serverTime: ts(out?.serverTime), downloads: shapeDownloads(out) });
  }));

  router.put('/console/downloads', requireRole('admin'), writeLimit, guard(async (req, res) => {
    const { reason, key } = sensitive(req);
    const app = String(req.body?.app ?? '');
    if (!DL_APPS.includes(app)) throw badInput('bad_app', 'برنامه دکان (shop) یا پمپ (pump) است');
    const body = { app };
    const fields = [];
    for (const [k, max] of DL_FIELDS) {
      const v = req.body?.[k];
      if (v === undefined) continue;
      if (typeof v !== 'string') throw badInput('bad_field', `«${k}» باید متن باشد`);
      const s = v.replace(CONTROL, ' ').trim();
      if (k === 'url' ? !downloadUrlOk(s) : s.length > max) {
        throw badInput(k === 'url' ? 'bad_url' : 'bad_field', k === 'url'
          ? 'نشانیِ دانلود باید نشانیِ کاملِ http یا https باشد (بی فاصله، تا ۳۰۰ نویسه) — یا خالی برای پاک کردن'
          : `«${k}» بلندتر از ${max} نویسه است`);
      }
      body[k] = s;
      fields.push(k);
    }
    if (req.body?.minVersion !== undefined) {
      if (typeof req.body.minVersion !== 'string') throw badInput('bad_field', '«minVersion» باید متن باشد');
      const raw = req.body.minVersion.replace(CONTROL, '').trim();
      const min = raw.replace(/^v/i, '');
      if (raw && (raw.length > 32 || !VERSION_RE.test(min))) throw badInput('bad_version', 'حداقل نسخه باید مثلِ 2.14.2 باشد');
      body.minVersion = raw ? min : '';
      fields.push('minVersion');
    }
    if (!fields.length) throw badInput('bad_body', 'دست‌کم یکی از نشانی، نسخه، یادداشت یا حداقل نسخه لازم است');
    const out = await once(req, key, `downloads|${reason}|${JSON.stringify(body)}`, `downloads:${app}`, async () => {
      const r = await cloudRaw('PUT', '/api/admin/downloads', { body });
      const download = shapeDownloads(r).find((d) => d.app === app) || null;
      audit({ actor: actorOf(req), action: 'account.downloads.updated', entity: 'downloads', entityId: app,
        detail: { app, reason, fields, ...(body.url !== undefined ? { url: body.url } : {}), ...(body.version !== undefined ? { version: body.version } : {}),
          ...(body.minVersion !== undefined ? { minVersion: body.minVersion } : {}), ...(body.notes !== undefined ? { notesLength: body.notes.length } : {}) } });
      return { ok: true, download, confirmedAt: Date.now() };
    });
    res.json(out);
  }));

  router.get('/console/system/notify-usage', requireModule('health'), usageLimit, guard(async (req, res) => {
    const raw = req.query.days;
    let days;
    if (raw !== undefined && raw !== '') {
      days = typeof raw === 'string' && /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
      if (!(days >= 1 && days <= 31)) throw badInput('bad_days', 'بازه ۱ تا ۳۱ روز است');
    }
    res.setHeader('Cache-Control', 'no-store');
    const out = await cloudRaw('GET', '/api/admin/system/notify-usage', { query: days ? { days: String(days) } : {} });
    res.json({ fetchedAt: Date.now(), ...shapeNotifyUsage(out) });
  }));

  router.get('/console/accounts/:app/:tenantId/backups', requireModule('shops'), guard(async (req, res) => {
    const app = String(req.params.app || '');
    if (!DL_APPS.includes(app)) throw badInput('bad_app', 'بخش دکان (shop) یا پمپ (pump) است');
    const tenantId = String(req.params.tenantId || '');
    if (!TENANT_RE.test(tenantId)) throw badInput('bad_tenant', 'شناسهٔ حساب معتبر نیست');
    const raw = req.query.limit;
    let limit;
    if (raw !== undefined && raw !== '') {
      limit = typeof raw === 'string' && /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
      if (!(limit >= 1 && limit <= 500)) throw badInput('bad_limit', 'تعداد ۱ تا ۵۰۰ است');
    }
    res.setHeader('Cache-Control', 'no-store');
    const out = await cloudRaw('GET', `/api/admin/accounts/${app}/${tenantId}/backups`, { query: limit ? { limit: String(limit) } : {} });
    res.json({ fetchedAt: Date.now(), ...shapeTenantBackups(out, app) });
  }));
}
