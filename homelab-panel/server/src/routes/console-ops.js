// ---------------------------------------------------------------------------
//  🛠 کنسولِ فروشگاه — ماژول‌های عملیاتِ پنلِ مرکزیِ مالک (۴.۸ · ۴.۹ · ۴.۱۰ · ۴.۱۱ · ۴.۱۳)
//
//  همان پلِ فهرست‌سفیدِ ‎/api/account-admin/console/…‎ (‎account-admin.js‎)؛ این فایل فقط مسیرهای همین
//  ماژول‌ها را **روی همان روتر** می‌نشاند (‎mountConsoleOps(router, deps)‎) تا ‎test/bridge-roles.mjs‎
//  آن‌ها را هم از ‎router.stack‎ ببیند و مرزِ نقششان را از روی کدِ سرورِ حساب بسنجد.
//
//     پنل ‎/console/ops/…‎             ⇐ سرورِ حساب ‎/api/admin/ops/…‎        نقشِ پنل        آن‌جا
//     releases · integrations          ⇐ همان (GET)                          viewer          admin/viewer
//     health                           ⇐ همان + **سنجه‌های خودِ پنل**         viewer          admin/viewer
//     incidents · incidents/:id        ⇐ همان (GET)                          viewer          admin/viewer
//     incidents.csv                    ⇐ همان، تا ۱۰۰۰ ردیف، با دفترِ پنل     admin           admin/viewer
//     incidents/:id/status|priority|notes|link (POST)                          operator        admin
//     alerts (GET) · alerts/evaluate|:id/ack|:id/resolve (POST)                viewer/operator admin
//     alerts/telegram (GET/PUT)        ⇐ محلی: کدام نوعِ هشدار با رباتِ مالک   viewer/admin    —
//     release/stage (GET)              ⇐ ‎/api/admin/release/stage‎ (OPS-01)   admin           superadmin
//     release/stage (PUT) · release/stage/end (POST ⇒ DELETE) ⇐ همان، با مالک/فنی + احرازِ دوباره + دلیل + تأیید   superadmin
//
//  ⛔ پشتِ «توانایی»: ‎ops.v1‎ و ‎release-stage.v1‎ (‎GET /api/admin/me‎). نیامده ⇒ خواندن «داده در دسترس
//     نیست» (۲۰۰ ِ صریح)، نوشتن ‎501 capability_missing‎ — هرگز «انجام شد» ِ دروغ.
//  ⛔ هیچ عددی این‌جا ساخته نمی‌شود؛ جز «سنجه‌های پنل» (‎panelProbes‎) که **همین پنل** همین حالا می‌سنجد
//     (زمانِ رفت‌وبرگشتِ پل، حالِ پروسهٔ سرورِ حساب، نسخه و زمانِ روشن بودنِ پنل) — هر کدام با تعریف.
//  ⛔ هیچ راز: نه کلیدِ سرویس، نه رمزِ ارشد، نه توکنِ ربات — فقط «هست / نیست».
// ---------------------------------------------------------------------------
import { cloudRaw, cloudStatus } from '../stations/cloud.js';
import { audit } from '../control/audit.js';
import * as panelRoles from '../control/roles.js';
import { getSetting, setSetting } from '../db.js';
import { versionInfo } from '../version.js';
import { ACCOUNT_PREFIXES, accountApiUrl } from '../api/account-proxy.js';
import { CONSOLE_ALERT_RULES, consoleAlertPrefs, setConsoleAlertPrefs } from '../support/telegram-console-alerts.js';
import { requireModule } from '../console/modules.js';

const { requireRole } = panelRoles;
const IDEM_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const TAG_RE = /^[a-z][a-z0-9-]{0,40}$/;
const VERSION_RE = /^\d{1,6}(\.\d{1,6}){1,3}$/;

/** تعریفِ حالت‌های سنجه‌های پنل — همان چهار حالتِ سرورِ حساب. */
export const PANEL_LIMITS = Object.freeze({ bridgeWarnMs: 1500, bridgeDownMs: 8000 });

/*
 *  ⚠️ «زمانِ رفت‌وبرگشتِ پل» یک سنجهٔ واقعی است، نه حدس: ‎GET /api/admin/me‎ ِ سبک با همان راهِ پل (کلید یا
 *  رمزِ ارشد). شکست ⇒ «از کار افتاده» با کدِ خطای خودش؛ کندتر از آستانه ⇒ «هشدار».
 */
async function bridgeProbe() {
  const t0 = Date.now();
  try {
    const me = await cloudRaw('GET', '/api/admin/me');
    const ms = Date.now() - t0;
    return {
      status: ms > PANEL_LIMITS.bridgeDownMs ? 'down' : ms > PANEL_LIMITS.bridgeWarnMs ? 'warn' : 'ok',
      latencyMs: ms, checkedAt: Date.now(),
      capabilities: Array.isArray(me?.capabilities) ? me.capabilities.filter((c) => typeof c === 'string').slice(0, 40) : [],
      serverTime: Number(me?.serverTime) || null,
    };
  } catch (err) {
    return { status: 'down', latencyMs: Date.now() - t0, checkedAt: Date.now(), error: err.code || 'cloud_error', message: String(err.message || '').slice(0, 200) };
  }
}

async function supervisorProbe() {
  try {
    const { accountStatus } = await import('../account/supervisor.js');
    const s = accountStatus();
    //  ⛔ فقط حال و شمار؛ نه پوشه، نه رمزِ مدیر، نه خطِ لاگ
    return {
      managed: s.enabled === true, installed: s.installed === true, running: s.running === true,
      startedAt: s.startedAt || null, uptimeMs: s.uptimeMs || 0, restarts: Number(s.restarts) || 0,
      lastCrashAt: s.lastCrash?.at || null, lastCrashCode: s.lastCrash?.code ?? null,
      status: !s.enabled ? 'unknown' : s.running ? 'ok' : 'down',
    };
  } catch (err) {
    return { status: 'unknown', error: err.code || 'probe_failed' };
  }
}

export async function panelProbes() {
  const [bridge, supervisor] = await Promise.all([bridgeProbe(), supervisorProbe()]);
  const mem = process.memoryUsage();
  const cs = cloudStatus();
  return {
    checkedAt: Date.now(),
    panel: { version: versionInfo.version || '', build: versionInfo.build || '', startedAt: versionInfo.startedAt, uptimeMs: Date.now() - versionInfo.startedAt, rssBytes: mem.rss, node: process.version, status: 'ok' },
    bridge: { ...bridge, local: cs.local === true, linked: cs.linked === true, serviceKey: cs.serviceKey === true },
    accountProcess: supervisor,
    limits: PANEL_LIMITS,
  };
}

/** فقط پارامترهای شناخته به سرورِ حساب می‌روند — نه querystring ِ دلخواه. */
function pick(query, keys) {
  const out = {};
  for (const k of keys) {
    const v = query?.[k];
    if (v === undefined || v === null || v === '') continue;
    out[k] = String(v).slice(0, 80);
  }
  return out;
}

const INCIDENT_Q = ['q', 'status', 'source', 'app', 'priority', 'shop', 'version', 'sort', 'limit', 'offset'];
const ALERT_Q = ['status', 'severity', 'rule', 'since', 'limit', 'offset'];

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  //  ⛔ تزریقِ فرمول در Excel: خانه‌ای که با = + - @ شروع شود متن می‌شود
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * @param {import('express').Router} router  همان روترِ ‎account-admin.js‎
 * @param {object} d  کمک‌هایی که همان فایل دارد (یک قاعده، یک جا)
 */
export function mountConsoleOps(router, d) {
  const { guard, capabilities, unavailable, missingErr, badInput, stamped, actorOf, isPanelOwner, reauthLimit, reauth } = d;

  const has = async (cap) => (await capabilities()).list.includes(cap);
  const readThrough = (cap, upstream, keys = []) => guard(async (req, res) => {
    if (!(await has(cap))) return res.json(unavailable(cap));
    res.json({ available: true, ...stamped(await cloudRaw('GET', upstream, { query: pick(req.query, keys) })) });
  });
  const idOf = (raw) => {
    const s = String(raw || '').trim();
    if (!ID_RE.test(s)) throw badInput('bad_id', 'شناسه درست نیست');
    return s;
  };
  const textOf = (v, max) => String(v ?? '').trim().slice(0, max);

  //  ⛔ خواندن‌ها پشتِ `requireModule(<id>)` ِ پوسته (‎console/modules.js‎) — همان `minRole` ِ منو؛ نوشتن‌ها نگهبانِ خودشان را دارند
  /* ───── ۴.۸ نسخه‌ها و انتشار ───── */
  router.get('/console/ops/releases', requireModule('versions'), readThrough('ops.v1', '/api/admin/ops/releases'));

  /* ───── ۴.۹ سلامت: سنجه‌های پنل همیشه؛ سرورِ حساب اگر هست — یکی بخوابد دیگری می‌ماند ───── */
  router.get('/console/ops/health', requireModule('health'), guard(async (req, res) => {
    const panel = await panelProbes();
    let account;
    if (panel.bridge.status === 'down') {
      account = { available: false, reason: 'bridge_down', error: panel.bridge.error || 'cloud_error', message: panel.bridge.message || '' };
    } else if (!panel.bridge.capabilities.includes('ops.v1')) {
      account = unavailable('ops.v1');
    } else {
      try {
        account = { available: true, ...stamped(await cloudRaw('GET', '/api/admin/ops/health')) };
      } catch (err) {
        account = { available: false, reason: 'upstream_error', error: err.code || 'cloud_error', message: String(err.message || '').slice(0, 200) };
      }
    }
    res.json({ panel, account, fetchedAt: Date.now() });
  }));

  /* ───── ۴.۱۳ یکپارچه‌سازی: سرورِ حساب + درگاهِ همین پنل ───── */
  router.get('/console/ops/integrations', requireModule('integrations'), guard(async (req, res) => {
    const gateway = {
      accountApi: Boolean(accountApiUrl()),
      prefixes: [...ACCOUNT_PREFIXES],
      //  وب‌هوکِ حساب‌پی روی ‎/api/v1/payments/webhook/hesabpay‎ ِ سرورِ حساب است؛ تا ‎payments‎ در فهرستِ درگاه
      //  نباشد از اینترنت به آن‌جا نمی‌رسد (کارِ PAY-21، تصمیمِ صاحب محصول)
      paymentsWebhookForwarded: ACCOUNT_PREFIXES.includes('payments'),
    };
    let telegram = null;
    try {
      const tgm = await import('../support/telegram.js');
      const st = tgm.status();
      //  ⛔ نه توکن، نه حتی چهار نویسهٔ آخرش
      telegram = { enabled: st.enabled === true, hasToken: st.hasToken === true, chatSet: Boolean(st.chatId), ownerLoggedIn: st.bot?.loggedIn === true };
    } catch { telegram = null; }
    const panel = { gateway, telegram, bridge: { contract: 'console-ops.v1', retry: 'یک بار پس از ۴۰۱ (ورودِ دوباره یا راهِ پیشین)؛ خطای دیگر بی تلاشِ دوباره' } };
    if (!(await has('ops.v1'))) return res.json({ ...unavailable('ops.v1'), panel });
    res.json({ available: true, panel, ...stamped(await cloudRaw('GET', '/api/admin/ops/integrations')) });
  }));

  /* ───── ۴.۱۰ رخدادها ───── */
  router.get('/console/ops/incidents', requireModule('errors'), readThrough('ops.v1', '/api/admin/ops/incidents', INCIDENT_Q));

  //  ⛔ خروجیِ CSV: فقط admin، حداکثر ۱۰۰۰ ردیف (پنج صفحهٔ ۲۰۰تایی ِ همان پالایش)، با یک ردیفِ دفترِ پنل
  router.get('/console/ops/incidents.csv', requireRole('admin'), guard(async (req, res) => {
    if (!(await has('ops.v1'))) throw missingErr('ops.v1');
    const q = pick(req.query, INCIDENT_Q.filter((k) => k !== 'limit' && k !== 'offset'));
    const rows = [];
    let total = null;
    for (let offset = 0; offset < 1000; offset += 200) {
      const page = await cloudRaw('GET', '/api/admin/ops/incidents', { query: { ...q, limit: '200', offset: String(offset) } });
      const list = Array.isArray(page?.incidents) ? page.incidents : [];
      total = Number(page?.total) || 0;
      rows.push(...list);
      if (list.length < 200) break;
    }
    const head = ['id', 'status', 'priority', 'source', 'app', 'title', 'kind', 'occurrences', 'firstSeenAt', 'lastSeenAt', 'lastVersion', 'supportThreadId'];
    const iso = (ms) => (Number(ms) > 0 ? new Date(Number(ms)).toISOString() : '');
    const lines = [head.join(',')].concat(rows.map((r) => [
      r.id, r.status, r.priority, r.source, r.app, r.title, r.kind, r.occurrences, iso(r.firstSeenAt), iso(r.lastSeenAt), r.lastVersion, r.supportThreadId,
    ].map(csvCell).join(',')));
    audit({ actor: actorOf(req), action: 'account.ops_incidents_exported', entity: 'ops_incident', detail: { rows: rows.length, total, filter: q } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="incidents-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`\uFEFF${lines.join('\r\n')}\r\n`);
  }));

  router.get('/console/ops/incidents/:id', requireModule('errors'), guard(async (req, res) => {
    const id = idOf(req.params.id);
    if (!(await has('ops.v1'))) return res.json(unavailable('ops.v1'));
    res.json({ available: true, ...stamped(await cloudRaw('GET', `/api/admin/ops/incidents/${id}`)) });
  }));

  const STATUSES = ['open', 'investigating', 'resolved'];
  const PRIORITIES = ['p1', 'p2', 'p3', 'p4'];
  const expected = (v) => (Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : undefined);

  router.post('/console/ops/incidents/:id/status', requireRole('operator'), guard(async (req, res) => {
    const id = idOf(req.params.id);
    const status = String(req.body?.status || '');
    if (!STATUSES.includes(status)) throw badInput('bad_status', 'وضعیت درست نیست');
    if (!(await has('ops.v1'))) throw missingErr('ops.v1');
    const note = textOf(req.body?.note, 1000);
    const out = await cloudRaw('POST', `/api/admin/ops/incidents/${id}/status`, {
      body: { status, ...(note ? { note } : {}), ...(expected(req.body?.expectedVersion) ? { expectedVersion: expected(req.body.expectedVersion) } : {}) },
    });
    audit({ actor: actorOf(req), action: 'account.ops_incident.status', entity: 'ops_incident', entityId: id, detail: { to: status, changed: out?.changed === true } });
    res.json(stamped(out));
  }));

  router.post('/console/ops/incidents/:id/priority', requireRole('operator'), guard(async (req, res) => {
    const id = idOf(req.params.id);
    const priority = String(req.body?.priority || '');
    if (!PRIORITIES.includes(priority)) throw badInput('bad_priority', 'اولویت درست نیست');
    if (!(await has('ops.v1'))) throw missingErr('ops.v1');
    const reason = textOf(req.body?.reason, 200);
    const out = await cloudRaw('POST', `/api/admin/ops/incidents/${id}/priority`, {
      body: { priority, ...(reason ? { reason } : {}), ...(expected(req.body?.expectedVersion) ? { expectedVersion: expected(req.body.expectedVersion) } : {}) },
    });
    audit({ actor: actorOf(req), action: 'account.ops_incident.priority', entity: 'ops_incident', entityId: id, detail: { to: priority, changed: out?.changed === true } });
    res.json(stamped(out));
  }));

  //  ⛔ یادداشت: کلیدِ یکتایی از **رابط** (یکی برای هر پنجره) ⇒ دوبار زدن یک یادداشت است
  router.post('/console/ops/incidents/:id/notes', requireRole('operator'), guard(async (req, res) => {
    const id = idOf(req.params.id);
    const note = textOf(req.body?.note, 1000);
    if (note.length < 2) throw badInput('note_required', 'یادداشت را بنویسید');
    const key = String(req.body?.idempotencyKey ?? '').trim();
    if (key && !IDEM_RE.test(key)) throw badInput('bad_idempotency_key', 'کلیدِ یکتایی نامعتبر است');
    if (!(await has('ops.v1'))) throw missingErr('ops.v1');
    const out = await cloudRaw('POST', `/api/admin/ops/incidents/${id}/notes`, { body: { note }, headers: key ? { 'idempotency-key': key } : {} });
    audit({ actor: actorOf(req), action: 'account.ops_incident.note', entity: 'ops_incident', entityId: id, detail: { length: note.length, replayed: out?.replayed === true } });
    res.status(out?.replayed ? 200 : 201).json(stamped(out));
  }));

  router.post('/console/ops/incidents/:id/link', requireRole('operator'), guard(async (req, res) => {
    const id = idOf(req.params.id);
    const thread = String(req.body?.supportThreadId ?? '').trim();
    if (thread && !ID_RE.test(thread)) throw badInput('bad_thread_id', 'شناسهٔ گفت‌وگو درست نیست');
    if (!(await has('ops.v1'))) throw missingErr('ops.v1');
    const out = await cloudRaw('POST', `/api/admin/ops/incidents/${id}/link`, { body: { supportThreadId: thread } });
    audit({ actor: actorOf(req), action: 'account.ops_incident.link', entity: 'ops_incident', entityId: id, detail: { thread } });
    res.json(stamped(out));
  }));

  /* ───── ۴.۱۱ هشدارها ───── */
  router.get('/console/ops/alerts', requireModule('alerts'), readThrough('ops.v1', '/api/admin/ops/alerts', ALERT_Q));

  router.post('/console/ops/alerts/evaluate', requireRole('operator'), guard(async (req, res) => {
    if (!(await has('ops.v1'))) throw missingErr('ops.v1');
    const out = await cloudRaw('POST', '/api/admin/ops/alerts/evaluate', { body: {} });
    audit({ actor: actorOf(req), action: 'account.ops_alerts.evaluated', entity: 'ops_alert' });
    res.json(stamped(out));
  }));

  router.post('/console/ops/alerts/:id/ack', requireRole('operator'), guard(async (req, res) => {
    const id = idOf(req.params.id);
    if (!(await has('ops.v1'))) throw missingErr('ops.v1');
    const note = textOf(req.body?.note, 300);
    const out = await cloudRaw('POST', `/api/admin/ops/alerts/${id}/ack`, { body: note ? { note } : {} });
    audit({ actor: actorOf(req), action: 'account.ops_alert.ack', entity: 'ops_alert', entityId: id, detail: { changed: out?.changed === true } });
    res.json(stamped(out));
  }));

  router.post('/console/ops/alerts/:id/resolve', requireRole('operator'), guard(async (req, res) => {
    const id = idOf(req.params.id);
    const reason = textOf(req.body?.reason, 200);
    if (reason.length < 3) throw badInput('reason_required', 'دلیلِ بستن را بنویسید (۳ تا ۲۰۰ نویسه)');
    if (!(await has('ops.v1'))) throw missingErr('ops.v1');
    const out = await cloudRaw('POST', `/api/admin/ops/alerts/${id}/resolve`, { body: { reason } });
    audit({ actor: actorOf(req), action: 'account.ops_alert.resolved', entity: 'ops_alert', entityId: id, detail: { reason, changed: out?.changed === true } });
    res.json(stamped(out));
  }));

  /*
   *  ارسالِ بیرونیِ هشدار: **فقط رباتِ تلگرامِ مالک** (همان که هست؛ ‎support/telegram-watch.js‎). پیامک و
   *  ایمیل برای هشدار ساخته نشده‌اند ⇒ رابط «آینده» می‌گوید. انتخابِ نوع‌ها (opt-in) فقط admin.
   */
  router.get('/console/ops/alerts/telegram', requireModule('alerts'), guard(async (req, res) => {
    let bot = null;
    try {
      const tgm = await import('../support/telegram.js');
      const st = tgm.status();
      bot = { enabled: st.enabled === true, hasToken: st.hasToken === true, chatSet: Boolean(st.chatId), ownerLoggedIn: st.bot?.loggedIn === true };
    } catch { bot = null; }
    res.json({ ...consoleAlertPrefs(), rules: CONSOLE_ALERT_RULES, bot, channels: { telegram: 'available', sms: 'future', email: 'future' }, checkedAt: Date.now() });
  }));

  router.put('/console/ops/alerts/telegram', requireRole('admin'), guard(async (req, res) => {
    const types = Array.isArray(req.body?.types) ? req.body.types.map(String) : null;
    if (!types) throw badInput('bad_types', 'فهرستِ نوع‌ها لازم است');
    const bad = types.filter((x) => !CONSOLE_ALERT_RULES.includes(x));
    if (bad.length) throw badInput('bad_types', `نوعِ ناشناخته: ${bad.slice(0, 3).join('، ')}`);
    const out = setConsoleAlertPrefs(types);
    audit({ actor: actorOf(req), action: 'account.ops_alerts.telegram_prefs', entity: 'telegram', detail: { types: out.types } });
    res.json({ ...out, rules: CONSOLE_ALERT_RULES, checkedAt: Date.now() });
  }));

  /* ───── ۴.۸ انتشارِ مرحله‌ای (OPS-01، ‎#559‎) ───── */

  /*
   *  ⛔ چه کسی: **مالکِ پنل**، یا نقشِ «فنی» اگر روزی در جدولِ نقش‌های پنل آمد (‎control/roles.js‎) — نه هر
   *     admin. و همیشه احرازِ دوباره (رمزِ همین درخواست یا نشستِ تازهٔ فاز ۱)، دلیلِ ۳ تا ۲۰۰ و تأیید.
   *  ⛔ «برگشت» (پایین آوردنِ نسخهٔ نصب‌شده) نیست و ساخته نمی‌شود: درصدِ ۰ می‌ایستاند، پایانِ مرحله برچسبِ
   *     روان را برای بقیه برمی‌گرداند؛ دستگاهی که گرفته پایین نمی‌آید — رابط همین را می‌گوید.
   */
  const technicalRole = () => (Array.isArray(panelRoles.ROLES) && panelRoles.ROLES.includes('technical') ? 'technical' : null);
  function releaseActor(req, res, next) {
    const tech = technicalRole();
    if (isPanelOwner(req) || (tech && panelRoles.roleOf(req) === tech)) return next();
    audit({ actor: actorOf(req), action: 'account.release_stage.denied', entity: 'release_stage', result: 'forbidden', detail: { why: 'not_owner_or_technical' } });
    return res.status(403).json({ error: 'owner_only', message: 'انتشارِ مرحله‌ای را فقط مالکِ پنل (یا نقشِ فنی) تغییر می‌دهد' });
  }
  const stageInput = (req, { needsVersion }) => {
    const b = req.body || {};
    const tag = String(b.tag || '').trim();
    if (!TAG_RE.test(tag)) throw badInput('bad_release_tag', 'برچسبِ انتشار درست نیست');
    const reason = textOf(b.reason, 200);
    if (reason.length < 3) throw badInput('reason_required', 'دلیل را بنویسید (۳ تا ۲۰۰ نویسه) — در سابقهٔ سرورِ حساب می‌ماند');
    if (b.confirm !== true) throw badInput('confirm_required', 'این کار پیش از فرستادن تأیید می‌خواهد');
    if (!needsVersion) return { tag, reason };
    const version = String(b.version || '').trim();
    const percent = Number(b.percent);
    if (!VERSION_RE.test(version)) throw badInput('bad_stage', 'نسخه (مثلِ 2.14.5) لازم است');
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw badInput('bad_stage', 'درصد عددِ صحیحِ ۰ تا ۱۰۰');
    return { tag, version, percent, reason };
  };

  router.get('/console/release/stage', requireRole('admin'), guard(async (req, res) => {
    //  `canChange`: همین کاربر (مالک یا «فنی») دکمه‌ها را ببیند؛ مرزِ واقعی همان ‎releaseActor‎ ِ نوشتن است
    const tech = technicalRole();
    const canChange = isPanelOwner(req) || Boolean(tech && panelRoles.roleOf(req) === tech);
    if (!(await has('release-stage.v1'))) return res.json({ ...unavailable('release-stage.v1'), canChange });
    res.json({ available: true, canChange, ...stamped(await cloudRaw('GET', '/api/admin/release/stage')) });
  }));

  router.put('/console/release/stage', requireRole('admin'), releaseActor, reauthLimit, reauth, guard(async (req, res) => {
    const input = stageInput(req, { needsVersion: true });
    if (!(await has('release-stage.v1'))) throw missingErr('release-stage.v1');
    //  ⛔ رمزِ پنل (احرازِ دوباره) هرگز بالا نمی‌رود: بدنهٔ بالادست فقط همین چهار فیلد
    const out = await cloudRaw('PUT', '/api/admin/release/stage', { body: input });
    audit({ actor: actorOf(req), action: 'account.release_stage.set', entity: 'release_stage', entityId: input.tag, detail: { version: input.version, percent: input.percent, reason: input.reason } });
    res.json(stamped(out));
  }));

  //  ⚠️ پایانِ مرحله در پنل POST است (بدنه: دلیل، تأیید، رمز) و بالادست همان ‎DELETE /api/admin/release/stage‎
  router.post('/console/release/stage/end', requireRole('admin'), releaseActor, reauthLimit, reauth, guard(async (req, res) => {
    const input = stageInput(req, { needsVersion: false });
    if (!(await has('release-stage.v1'))) throw missingErr('release-stage.v1');
    const out = await cloudRaw('DELETE', '/api/admin/release/stage', { query: { tag: input.tag, reason: input.reason } });
    audit({ actor: actorOf(req), action: 'account.release_stage.ended', entity: 'release_stage', entityId: input.tag, detail: { reason: input.reason, removed: out?.removed === true } });
    res.json(stamped(out));
  }));

  return router;
}

/** فقط برای آزمون (‎test/console-ops.mjs‎). */
export const _csvCell = csvCell;
export const _setting = { getSetting, setSetting };
