// ---------------------------------------------------------------------------
//  موتورِ اتوماسیون — ثبتِ کارها، زمان‌بند، رویداد، قفل، تلاشِ دوباره و دفتر
//
//  قاعده‌های بخشِ ۱۰.۱ پرامپت که این فایل ضامنِ همه‌شان است:
//    • هیچ کاری هم‌زمان دو بار اجرا نمی‌شود (قفلِ هر کار: `running`).
//    • هر اجرا مهلت دارد؛ از مهلت که گذشت، «timeout» ثبت می‌شود و تمام.
//    • خطا ⇒ تا سه تلاش با فاصلهٔ فزاینده (۲، ۴، ۸ ثانیه)، بعد «failed» و onFail.
//    • **هیچ اجرایی بی ثبتِ نتیجه نیست**: ردیفِ automation_runs پیش از شروع
//      نوشته می‌شود («running») و در پایان کامل می‌شود — حتی اجرایی که به قفل
//      خورد، «skipped» ثبت می‌شود.
//    • زمان‌بندی روی همان تجزیه‌کنندهٔ cronِ خودمان (system/cron.js) و به
//      وقتِ محلی؛ کارهای زیرِ یک دقیقه (`every`) با فاصلهٔ ثابت.
//
//  این موتور **تنها صاحبِ زمان‌بندی‌های داخلیِ پنل** است: پشتیبانِ خودکار،
//  پایشِ uptime، نگهبانِ حرارتی و گزارشِ صبحگاهی دیگر شمارندهٔ خودشان را
//  ندارند (index.js آن‌ها را با ownTimers:false بالا می‌آورد) — وگرنه یک کار دو
//  بار می‌دوید و هیچ‌کدام در دفتر نبود.
// ---------------------------------------------------------------------------
import { db, logEvent } from '../db.js';
import { parseSchedule, nextRunAt } from '../system/cron.js';
import { automationEvents, emit as emitEvent } from './events.js';
import { raiseAlert } from '../control/alerts.js';
import { getIo } from '../state.js';
import { buildContext } from './context.js';

export const MAX_OUTPUT = 64 * 1024;
const KEEP_RUNS = 100;         // اجراهای اخیرِ هر کار
const KEEP_RUNS_QUIET = 30;    // برای کارهای پرتکرار (هر ۳۰ ثانیه)
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_ATTEMPTS = 3;

function envList(name, fallback) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return fallback;
  const nums = raw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 0);
  return nums.length ? nums : fallback;
}
/** فاصلهٔ تلاش‌ها — HLP_AUTOMATION_BACKOFF="2000,4000,8000" */
export const BACKOFF_MS = envList('HLP_AUTOMATION_BACKOFF', [2000, 4000, 8000]);
/** هر چند میلی‌ثانیه زمان‌بند نگاه می‌کند (cron همچنان دقیقه‌ای است) */
export const TICK_MS = Math.max(1000, Number(process.env.HLP_AUTOMATION_TICK_MS) || 10_000);

const STATUSES = ['running', 'ok', 'failed', 'timeout', 'skipped'];
const TRIGGERS = ['scheduled', 'event', 'manual'];

/** name → تعریفِ کار */
const registry = new Map();
/** name → { runId, startedAt, trigger } — قفلِ هر کار */
const running = new Map();
let timer = null;
let onEvent = null;
let started = false;

/* -------------------------------------------------------------------------- */
/*  تعریف                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * تعریفِ یک کار. چیزی را ثبت نمی‌کند؛ فقط شکل را می‌سنجد و پیش‌فرض‌ها را
 * می‌نشاند. ثبت با register().
 *
 *   name         شناسهٔ لاتینِ ثابت (backup-daily)
 *   title        نامِ فارسی برای پنل
 *   description  یک جملهٔ فارسی: چه می‌کند
 *   schedule     پنج‌فیلدیِ cron، یا تابعی که همان را برمی‌گرداند (برای ساعتِ
 *                تنظیم‌شدنی مثلِ گزارشِ صبحگاهی)
 *   every        فاصلهٔ ثابت به میلی‌ثانیه (برای زیرِ یک دقیقه)
 *   event        نامِ رویدادی که این کار را می‌دواند
 *   timeout      مهلت به میلی‌ثانیه
 *   attempts     حداکثر تلاش (پیش‌فرض ۳)
 *   quiet        پرتکرار است؛ تاریخچهٔ کوتاه‌تر و بیرون از فهرستِ «اجراهای اخیر»
 *   catchUp      اگر پنل خاموش بود و وقتش گذشت، سرِ بالا آمدن اجرا شود
 *   runOnStart   چند میلی‌ثانیه بعد از بالا آمدن یک بار اجرا شود
 *   run(ctx)     خودِ کار؛ می‌تواند { skipped: true, reason } برگرداند
 *   onFail(ctx, err)
 */
export function defineJob(def) {
  if (!def || typeof def !== 'object') throw new Error('automation: تعریفِ کار خالی است');
  const name = String(def.name || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(name)) throw new Error(`automation: نامِ کار نامعتبر است: «${name}»`);
  if (typeof def.run !== 'function') throw new Error(`automation: کارِ «${name}» تابعِ run ندارد`);
  const kinds = ['schedule', 'every', 'event'].filter((k) => def[k] != null);
  if (kinds.length > 1) throw new Error(`automation: کارِ «${name}» فقط یکی از schedule/every/event را می‌تواند داشته باشد`);
  if (typeof def.schedule === 'string' && !parseSchedule(def.schedule).ok) {
    throw new Error(`automation: الگوی cronِ کارِ «${name}» نامعتبر است: «${def.schedule}»`);
  }
  if (def.every != null && !(Number(def.every) >= 1000)) throw new Error(`automation: everyِ کارِ «${name}» باید دستِ‌کم ۱۰۰۰ میلی‌ثانیه باشد`);
  return Object.freeze({
    name,
    title: String(def.title || name),
    description: String(def.description || ''),
    schedule: def.schedule ?? null,
    every: def.every != null ? Number(def.every) : null,
    event: def.event ? String(def.event) : null,
    timeout: Math.max(1000, Number(def.timeout) || DEFAULT_TIMEOUT_MS),
    attempts: Math.max(1, Math.min(10, Number(def.attempts) || DEFAULT_ATTEMPTS)),
    backoff: Array.isArray(def.backoff) && def.backoff.length ? def.backoff.map(Number) : BACKOFF_MS,
    quiet: Boolean(def.quiet),
    catchUp: def.catchUp !== false && Boolean(def.schedule),
    runOnStart: def.runOnStart != null ? Math.max(0, Number(def.runOnStart) || 0) : null,
    enabledByDefault: def.enabled !== false,
    run: def.run,
    onFail: typeof def.onFail === 'function' ? def.onFail : null,
  });
}

/** الگوی فعلیِ یک کار (تابع ⇒ همین حالا صدا زده می‌شود) */
export function scheduleOf(def) {
  if (typeof def.schedule === 'function') {
    try {
      const s = String(def.schedule() || '');
      return parseSchedule(s).ok ? s : null;
    } catch {
      return null;
    }
  }
  return def.schedule;
}

function computeNext(def, from = Date.now()) {
  if (def.every) return from + def.every;
  const s = scheduleOf(def);
  if (!s) return null;
  return nextRunAt(s, new Date(from));
}

/* -------------------------------------------------------------------------- */
/*  دفتر                                                                       */
/* -------------------------------------------------------------------------- */

const q = {
  upsertJob: () => db.prepare('INSERT OR IGNORE INTO automation_jobs(name, enabled, updated_at) VALUES(?, ?, ?)'),
  jobRow: () => db.prepare('SELECT * FROM automation_jobs WHERE name = ?'),
  setNext: () => db.prepare('UPDATE automation_jobs SET next_run_at = ? WHERE name = ?'),
  setEnabled: () => db.prepare('UPDATE automation_jobs SET enabled = ?, next_run_at = ?, updated_at = ? WHERE name = ?'),
  insertRun: () => db.prepare('INSERT INTO automation_runs(job, trigger, started_at, status, attempts, payload) VALUES(?, ?, ?, ?, ?, ?)'),
  finishRun: () => db.prepare('UPDATE automation_runs SET finished_at = ?, duration_ms = ?, status = ?, attempts = ?, error = ?, output = ? WHERE id = ?'),
  afterRun: () => db.prepare('UPDATE automation_jobs SET last_run_at = ?, last_status = ?, last_duration_ms = ?, updated_at = ? WHERE name = ?'),
  pruneRuns: () => db.prepare('DELETE FROM automation_runs WHERE job = ? AND id NOT IN (SELECT id FROM automation_runs WHERE job = ? ORDER BY id DESC LIMIT ?)'),
};

/** ثبتِ یک کار در موتور و در جدول (روشن/خاموشِ ذخیره‌شدهٔ کاربر نگه داشته می‌شود) */
export function register(def) {
  const job = Object.isFrozen(def) && def.run ? def : defineJob(def);
  if (registry.has(job.name)) throw new Error(`automation: کارِ «${job.name}» دو بار ثبت شد`);
  registry.set(job.name, job);
  q.upsertJob().run(job.name, job.enabledByDefault ? 1 : 0, Date.now());
  const row = q.jobRow().get(job.name);
  q.setNext().run(row.enabled ? computeNext(job) : null, job.name);
  return job;
}

export function getJob(name) {
  return registry.get(String(name)) || null;
}

export function jobNames() {
  return [...registry.keys()];
}

function publicJob(def) {
  const row = q.jobRow().get(def.name) || {};
  const live = running.get(def.name) || null;
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    schedule: scheduleOf(def),
    every: def.every,
    event: def.event,
    trigger: def.every ? 'interval' : def.schedule ? 'schedule' : def.event ? 'event' : 'manual',
    timeout: def.timeout,
    attempts: def.attempts,
    quiet: def.quiet,
    enabled: Boolean(row.enabled),
    running: Boolean(live),
    runningSince: live?.startedAt ?? null,
    last_run_at: row.last_run_at ?? null,
    last_status: row.last_status ?? null,
    last_duration_ms: row.last_duration_ms ?? null,
    next_run_at: row.enabled ? (row.next_run_at ?? null) : null,
  };
}

export function listJobs() {
  return [...registry.values()].map(publicJob);
}

export function setEnabled(name, on) {
  const def = registry.get(String(name));
  if (!def) return null;
  q.setEnabled().run(on ? 1 : 0, on ? computeNext(def) : null, Date.now(), def.name);
  return publicJob(def);
}

const rowToRun = (r) => {
  let payload = null;
  try { payload = r.payload ? JSON.parse(r.payload) : null; } catch { payload = null; }
  return { ...r, payload };
};

export function listRuns(name, { limit = 20 } = {}) {
  const n = Math.min(200, Math.max(1, Number(limit) || 20));
  return db.prepare('SELECT * FROM automation_runs WHERE job = ? ORDER BY id DESC LIMIT ?').all(String(name), n).map(rowToRun);
}

export function recentRuns({ limit = 50, all = false } = {}) {
  const n = Math.min(500, Math.max(1, Number(limit) || 50));
  const quiet = [...registry.values()].filter((d) => d.quiet).map((d) => d.name);
  if (all || !quiet.length) {
    return db.prepare('SELECT * FROM automation_runs ORDER BY id DESC LIMIT ?').all(n).map(rowToRun);
  }
  const marks = quiet.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM automation_runs WHERE job NOT IN (${marks}) ORDER BY id DESC LIMIT ?`).all(...quiet, n).map(rowToRun);
}

export function getRun(id) {
  const r = db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(Number(id));
  return r ? rowToRun(r) : null;
}

export function isRunning(name) {
  return running.has(String(name));
}

/* -------------------------------------------------------------------------- */
/*  اجرا                                                                       */
/* -------------------------------------------------------------------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => {
      const e = new Error(`از مهلتِ ${Math.round(ms / 1000)} ثانیه گذشت`);
      e.code = 'TIMEOUT';
      reject(e);
    }, ms);
    t.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

function recordSkipped(def, trigger, payload, reason) {
  const now = Date.now();
  const info = q.insertRun().run(def.name, trigger, now, 'skipped', 0, payload == null ? null : JSON.stringify(payload).slice(0, 4000));
  const id = Number(info.lastInsertRowid);
  q.finishRun().run(now, 0, 'skipped', 0, reason, null, id);
  q.pruneRuns().run(def.name, def.name, def.quiet ? KEEP_RUNS_QUIET : KEEP_RUNS);
  return id;
}

/** اعلانِ یک کار — به لاگ، و برای warn/critical به هشدارهای مرکز فرمان */
export function notifyFrom(def, level, text) {
  const lvl = level === 'critical' ? 'critical' : level === 'warn' ? 'warn' : 'info';
  logEvent(lvl === 'critical' ? 'error' : lvl === 'warn' ? 'warn' : 'info', 'automation', `${def.title}: ${text}`);
  if (lvl !== 'info') {
    try {
      raiseAlert({ key: `automation:${def.name}`, kind: 'automation', severity: lvl, title: String(text).slice(0, 200), detail: def.title });
    } catch { /* هشدار نباید کار را بخواباند */ }
  }
  try {
    getIo()?.emit('automation:notice', { job: def.name, title: def.title, level: lvl, text: String(text).slice(0, 500), at: Date.now() });
  } catch { /* هنوز کسی وصل نیست */ }
}

/**
 * اجرای یک کار — همان چیزی که زمان‌بند، رویداد و دکمهٔ «اجرا کن» صدا می‌زنند.
 * هرگز استثنا بیرون نمی‌دهد؛ نتیجه را برمی‌گرداند.
 */
export async function runJob(name, { trigger = 'manual', payload = null } = {}) {
  const def = registry.get(String(name));
  if (!def) return { ok: false, error: 'not_found' };
  const trig = TRIGGERS.includes(trigger) ? trigger : 'manual';

  if (running.has(def.name)) {
    const runId = recordSkipped(def, trig, payload, 'already_running');
    return { ok: false, error: 'already_running', status: 'skipped', runId };
  }
  const row = q.jobRow().get(def.name);
  if (trig !== 'manual' && !row?.enabled) {
    const runId = recordSkipped(def, trig, payload, 'disabled');
    return { ok: false, error: 'disabled', status: 'skipped', runId };
  }

  const startedAt = Date.now();
  const info = q.insertRun().run(def.name, trig, startedAt, 'running', 0, payload == null ? null : JSON.stringify(payload).slice(0, 4000));
  const runId = Number(info.lastInsertRowid);
  running.set(def.name, { runId, startedAt, trigger: trig });

  let output = '';
  const log = (msg) => {
    if (output.length >= MAX_OUTPUT) return;
    const stamp = new Date().toLocaleTimeString('fa-IR', { hour12: false });
    output += `[${stamp}] ${String(msg)}\n`;
    if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT);
  };

  let status = 'failed';
  let attempt = 0;
  let lastError = null;
  let ctx = null;

  while (attempt < def.attempts) {
    attempt++;
    ctx = buildContext({ def, runId, trigger: trig, payload, attempt, log, notify: (lvl, text) => notifyFrom(def, lvl, text), emit: (ev, p) => emitEvent(ev, p, `job:${def.name}`) });
    try {
      const result = await withTimeout(Promise.resolve().then(() => def.run(ctx)), def.timeout);
      if (result && typeof result === 'object' && result.skipped) {
        status = 'skipped';
        lastError = result.reason ? String(result.reason) : 'skipped';
        log(`رد شد: ${lastError}`);
      } else {
        status = 'ok';
        if (typeof result === 'string') log(result);
        else if (result && typeof result === 'object') log(JSON.stringify(result).slice(0, 4000));
      }
      lastError = status === 'ok' ? null : lastError;
      break;
    } catch (e) {
      lastError = e;
      if (e?.code === 'TIMEOUT') {
        status = 'timeout';
        log(`⏱ ${e.message}`);
        break;
      }
      const msg = String(e?.message || e);
      if (attempt < def.attempts) {
        const wait = def.backoff[Math.min(attempt - 1, def.backoff.length - 1)] ?? 0;
        log(`✖ تلاشِ ${attempt} ناموفق: ${msg} — ${wait} میلی‌ثانیه بعد دوباره`);
        await sleep(wait);
      } else {
        status = 'failed';
        log(`✖ تلاشِ ${attempt} ناموفق: ${msg} — تسلیم`);
      }
    }
  }

  const finishedAt = Date.now();
  const durationMs = finishedAt - startedAt;
  const errorText = lastError ? String(lastError?.message || lastError).slice(0, 2000) : null;
  try {
    q.finishRun().run(finishedAt, durationMs, status, attempt, errorText, output.slice(0, MAX_OUTPUT) || null, runId);
    q.afterRun().run(startedAt, status, durationMs, finishedAt, def.name);
    q.pruneRuns().run(def.name, def.name, def.quiet ? KEEP_RUNS_QUIET : KEEP_RUNS);
  } catch (e) {
    logEvent('error', 'automation', `ثبتِ نتیجهٔ «${def.name}» نشد: ${e.message}`);
  }
  running.delete(def.name);

  if (status === 'failed' || status === 'timeout') {
    logEvent('error', 'automation', `کارِ «${def.title}» ${status === 'timeout' ? 'به مهلت خورد' : 'ناموفق ماند'}: ${errorText}`);
    if (def.onFail) {
      try {
        await def.onFail(ctx, lastError instanceof Error ? lastError : new Error(errorText || status));
      } catch (e) {
        logEvent('warn', 'automation', `onFailِ «${def.name}» هم خطا داد: ${e.message}`);
      }
    }
  }
  try {
    getIo()?.emit('automation:run', { job: def.name, runId, status, trigger: trig, durationMs, at: finishedAt });
  } catch { /* هنوز کسی وصل نیست */ }

  return { ok: status === 'ok' || status === 'skipped', status, runId, attempts: attempt, durationMs, error: errorText, output: output.slice(0, MAX_OUTPUT) };
}

/* -------------------------------------------------------------------------- */
/*  زمان‌بند                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * یک تیک. ملاک next_run_at ذخیره‌شده است، نه تطبیقِ دوبارهٔ الگو (همان قاعدهٔ
 * cron.js): پیش از اجرا زمانِ بعدی جلو می‌رود تا کارِ کند در تیکِ بعدی دوباره
 * «سررسیده» دیده نشود. کارها موازی شروع می‌شوند — پشتیبانِ سی‌دقیقه‌ای نباید
 * پایشِ دو دقیقه‌ای را نگه دارد.
 */
export function tick(now = Date.now()) {
  let startedCount = 0;
  for (const def of registry.values()) {
    if (!def.schedule && !def.every) continue;
    const row = q.jobRow().get(def.name);
    if (!row?.enabled || row.next_run_at == null || row.next_run_at > now) continue;
    q.setNext().run(computeNext(def, now), def.name);
    startedCount++;
    runJob(def.name, { trigger: 'scheduled' }).catch((e) => logEvent('error', 'automation', `اجرای «${def.name}» نشد: ${e.message}`));
  }
  return startedCount;
}

/** پس از بالا آمدن: زمانِ بعدیِ همه از نو، و کارِ عقب‌افتاده‌ای که catchUp دارد همان اول */
export function reschedule({ now = Date.now(), catchUpDelayMs = 20_000 } = {}) {
  const overdue = [];
  for (const def of registry.values()) {
    const row = q.jobRow().get(def.name);
    if (!row?.enabled) { q.setNext().run(null, def.name); continue; }
    if (def.catchUp && row.next_run_at != null && row.next_run_at < now) overdue.push(def.name);
    q.setNext().run(computeNext(def, now), def.name);
  }
  for (const name of overdue) {
    const t = setTimeout(() => {
      logEvent('info', 'automation', `کارِ «${name}» وقتش در خاموشیِ پنل گذشته بود — همین حالا اجرا می‌شود`);
      runJob(name, { trigger: 'scheduled' }).catch(() => {});
    }, catchUpDelayMs);
    t.unref?.();
  }
  return overdue;
}

export function start({ tickMs = TICK_MS } = {}) {
  if (started) return false;
  started = true;
  reschedule();
  timer = setInterval(() => {
    try { tick(); } catch (e) { logEvent('error', 'automation', `تیکِ زمان‌بند ناموفق بود: ${e.message}`); }
  }, tickMs);
  timer.unref?.();

  onEvent = (ev) => {
    for (const def of registry.values()) {
      if (def.event !== ev.name) continue;
      runJob(def.name, { trigger: 'event', payload: ev.payload }).catch(() => {});
    }
  };
  automationEvents.on('event', onEvent);

  for (const def of registry.values()) {
    if (def.runOnStart == null) continue;
    const t = setTimeout(() => runJob(def.name, { trigger: 'scheduled' }).catch(() => {}), def.runOnStart);
    t.unref?.();
  }
  return true;
}

export function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  if (onEvent) automationEvents.off('event', onEvent);
  onEvent = null;
  started = false;
}

export function engineStatus() {
  return {
    started,
    tickMs: TICK_MS,
    backoffMs: BACKOFF_MS,
    jobs: registry.size,
    running: [...running.entries()].map(([name, r]) => ({ name, ...r })),
    statuses: STATUSES,
  };
}
