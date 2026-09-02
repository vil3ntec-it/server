// ---------------------------------------------------------------------------
//  کارهای زمان‌بندی‌شده
//
//  یک تجزیه‌کنندهٔ cron کوچک و کاملاً درون‌خانگی. چرا کتابخانه نیاورده‌ایم:
//  کلِ کاری که لازم داریم «آیا این دقیقه با این الگو می‌خواند؟» است، و همان
//  در صد خط جا می‌شود — در برابرِ یک وابستگیِ تازه که باید سال‌ها نگه‌داری و
//  به‌روزرسانی شود.
//
//  الگوی پشتیبانی‌شده، همان پنج‌فیلدیِ متعارف:
//
//      دقیقه  ساعت  روزِ‌ماه  ماه  روزِ‌هفته
//        *      *      *       *       *
//
//  با  *  و  عدد  و  a-b  و  a,b,c  و  *​/n  و  a-b/n
//  نامِ ماه و روز (jan، mon) هم پذیرفته می‌شود چون آدم‌ها همان را می‌نویسند.
//
//  ⚠️ زمانِ محلیِ همین ماشین ملاک است، نه UTC — چون کاربر «هر شب ساعت ۲»
//  را به وقتِ خودش می‌گوید.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import { db, logEvent } from '../db.js';

const MAX_OUTPUT = 64 * 1024;      // خروجیِ ذخیره‌شدهٔ هر اجرا
const MAX_RUN_MS = 30 * 60 * 1000; // یک کار تا کِی حق دارد بدود
const KEEP_RUNS = 50;              // چند اجرای اخیرِ هر کار نگه داشته شود

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** میان‌برهایی که مردم می‌نویسند و انتظار دارند کار کند */
const ALIASES = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dom', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MONTHS, offset: 1 },
  { name: 'dow', min: 0, max: 6, names: DAYS, offset: 0 },
];

function fail(code, detail = null) {
  return { ok: false, error: code, detail };
}

/** یک فیلد را به مجموعه‌ای از عددهای مجاز تبدیل می‌کند */
function parseField(text, spec) {
  const values = new Set();

  for (const part of String(text).split(',')) {
    const piece = part.trim().toLowerCase();
    if (!piece) return null;

    // a-b/n یا */n
    const [rangePart, stepPart] = piece.split('/');
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) return null;

    let from;
    let to;

    if (rangePart === '*') {
      from = spec.min;
      to = spec.max;
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-');
      from = toNumber(a, spec);
      to = toNumber(b, spec);
    } else {
      from = toNumber(rangePart, spec);
      to = from;
    }

    if (from === null || to === null) return null;
    // یکشنبه هم ۰ است هم ۷ — هر دو را می‌پذیریم
    if (spec.name === 'dow') {
      if (from === 7) from = 0;
      if (to === 7) to = 0;
    }
    if (from > to || from < spec.min || to > spec.max) return null;

    for (let v = from; v <= to; v += step) values.add(v);
  }

  return values.size ? values : null;
}

function toNumber(token, spec) {
  const text = String(token).trim().toLowerCase();
  if (spec.names) {
    const idx = spec.names.indexOf(text.slice(0, 3));
    if (idx >= 0) return idx + (spec.offset ?? 0);
  }
  const n = Number(text);
  return Number.isInteger(n) ? n : null;
}

/** الگو را به پنج مجموعه تبدیل می‌کند، یا می‌گوید چرا نشد */
export function parseSchedule(expression) {
  const raw = String(expression ?? '').trim().toLowerCase();
  if (!raw) return fail('empty_schedule');

  const text = ALIASES[raw] ?? raw;
  const parts = text.split(/\s+/);
  if (parts.length !== 5) return fail('need_five_fields');

  const sets = [];
  for (let i = 0; i < 5; i++) {
    const set = parseField(parts[i], FIELDS[i]);
    if (!set) return fail('bad_field', FIELDS[i].name);
    sets.push(set);
  }
  return { ok: true, sets, normalized: parts.join(' ') };
}

export function isValidSchedule(expression) {
  return parseSchedule(expression).ok === true;
}

/**
 * آیا این لحظه با الگو می‌خواند؟
 *
 * قاعدهٔ عجیبِ cron که همه از قلم می‌اندازند: اگر هم روزِ‌ماه و هم روزِ‌هفته
 * مشخص شده باشند (هیچ‌کدام *)، **یا**ی منطقی است نه **و**. یعنی
 * «0 0 1 * mon» یعنی اولِ هر ماه، و هر دوشنبه.
 */
function matches(sets, date) {
  const [minute, hour, dom, month, dow] = sets;
  if (!minute.has(date.getMinutes())) return false;
  if (!hour.has(date.getHours())) return false;
  if (!month.has(date.getMonth() + 1)) return false;

  const domRestricted = dom.size !== 31;
  const dowRestricted = dow.size !== 7;
  const domHit = dom.has(date.getDate());
  const dowHit = dow.has(date.getDay());

  if (domRestricted && dowRestricted) return domHit || dowHit;
  if (domRestricted) return domHit;
  if (dowRestricted) return dowHit;
  return true;
}

/** اجرای بعدی چه وقتی است؟ حداکثر چهار سال جلو می‌رود، بعد تسلیم */
export function nextRunAt(expression, from = new Date()) {
  const parsed = parseSchedule(expression);
  if (!parsed.ok) return null;

  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const limit = 60 * 24 * 366 * 4;
  for (let i = 0; i < limit; i++) {
    if (matches(parsed.sets, cursor)) return cursor.getTime();
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  CRUD                                                                       */
/* -------------------------------------------------------------------------- */

const publicRow = (row) => (row ? { ...row, enabled: Boolean(row.enabled), lastOk: row.last_ok === null ? null : Boolean(row.last_ok) } : null);

export function list() {
  const rows = db.prepare('SELECT * FROM cron_jobs ORDER BY id DESC').all();
  return { ok: true, items: rows.map(publicRow) };
}

export function get(id) {
  return publicRow(db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(Number(id)));
}

export function create({ name, schedule, command, cwd = null, enabled = true, actor = null }) {
  const cleanName = String(name ?? '').trim();
  const cleanCommand = String(command ?? '').trim();

  if (!cleanName) return fail('name_required');
  if (!cleanCommand) return fail('command_required');
  if (cleanCommand.length > 4000) return fail('command_too_long');

  const parsed = parseSchedule(schedule);
  if (!parsed.ok) return parsed;

  const now = Date.now();
  const info = db.prepare(`
    INSERT INTO cron_jobs (name, schedule, command, cwd, enabled, created_at, created_by, next_run_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    cleanName, parsed.normalized, cleanCommand, cwd || null,
    enabled ? 1 : 0, now, actor, enabled ? nextRunAt(parsed.normalized) : null
  );

  return { ok: true, job: get(info.lastInsertRowid) };
}

export function update(id, patch = {}) {
  const current = get(id);
  if (!current) return fail('not_found');

  const next = {
    name: patch.name !== undefined ? String(patch.name).trim() : current.name,
    schedule: patch.schedule !== undefined ? String(patch.schedule).trim() : current.schedule,
    command: patch.command !== undefined ? String(patch.command).trim() : current.command,
    cwd: patch.cwd !== undefined ? (patch.cwd || null) : current.cwd,
    enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : current.enabled,
  };

  if (!next.name) return fail('name_required');
  if (!next.command) return fail('command_required');

  const parsed = parseSchedule(next.schedule);
  if (!parsed.ok) return parsed;

  db.prepare(`
    UPDATE cron_jobs SET name = ?, schedule = ?, command = ?, cwd = ?, enabled = ?, next_run_at = ?
    WHERE id = ?
  `).run(
    next.name, parsed.normalized, next.command, next.cwd,
    next.enabled ? 1 : 0, next.enabled ? nextRunAt(parsed.normalized) : null, Number(id)
  );

  return { ok: true, job: get(id) };
}

export function remove(id) {
  const current = get(id);
  if (!current) return fail('not_found');
  db.prepare('DELETE FROM cron_runs WHERE job_id = ?').run(Number(id));
  db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(Number(id));
  return { ok: true, id: Number(id) };
}

export function runs(id, limit = 20) {
  const rows = db.prepare(
    'SELECT * FROM cron_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?'
  ).all(Number(id), Math.min(200, Math.max(1, Number(limit) || 20)));
  return { ok: true, items: rows.map((r) => ({ ...r, ok: Boolean(r.ok) })) };
}

/* -------------------------------------------------------------------------- */
/*  اجرا                                                                       */
/* -------------------------------------------------------------------------- */

/** کارهایی که همین حالا در حالِ اجرا هستند — تا یک کارِ کند دو بار شروع نشود */
const inFlight = new Set();

export function execute(id, { reason = 'scheduled' } = {}) {
  const job = get(id);
  if (!job) return Promise.resolve(fail('not_found'));
  if (inFlight.has(job.id)) return Promise.resolve(fail('already_running'));

  inFlight.add(job.id);
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const shell = process.platform === 'win32'
      ? { cmd: process.env.COMSPEC || 'cmd.exe', args: ['/d', '/s', '/c', job.command] }
      : { cmd: '/bin/sh', args: ['-c', job.command] };

    let output = '';
    const collect = (chunk) => {
      if (output.length < MAX_OUTPUT) output += chunk.toString('utf8');
    };

    let child;
    try {
      child = spawn(shell.cmd, shell.args, {
        cwd: job.cwd || undefined,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (e) {
      inFlight.delete(job.id);
      return resolve(fail('spawn_failed', String(e?.message || e)));
    }

    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    const timer = setTimeout(() => {
      output += '\n[به مهلتِ زمانی خورد و متوقف شد]\n';
      try { child.kill('SIGKILL'); } catch { /* رفته */ }
    }, MAX_RUN_MS);

    const finish = (exitCode) => {
      clearTimeout(timer);
      inFlight.delete(job.id);

      const ms = Date.now() - startedAt;
      const ok = exitCode === 0;

      db.prepare(`
        INSERT INTO cron_runs (job_id, started_at, ms, exit_code, ok, output)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(job.id, startedAt, ms, exitCode, ok ? 1 : 0, output.slice(0, MAX_OUTPUT));

      // تاریخچه نباید بی‌نهایت رشد کند
      db.prepare(`
        DELETE FROM cron_runs WHERE job_id = ? AND id NOT IN (
          SELECT id FROM cron_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?
        )
      `).run(job.id, job.id, KEEP_RUNS);

      db.prepare('UPDATE cron_jobs SET last_run_at = ?, last_ok = ?, last_ms = ?, next_run_at = ? WHERE id = ?')
        .run(startedAt, ok ? 1 : 0, ms, job.enabled ? nextRunAt(job.schedule) : null, job.id);

      if (!ok) {
        logEvent('warn', 'cron', `کارِ «${job.name}» با کدِ ${exitCode} تمام شد`);
      }
      resolve({ ok: true, exitCode, ms, output: output.slice(0, MAX_OUTPUT), reason });
    };

    child.on('error', (e) => {
      output += `\n[${e.message}]\n`;
      finish(-1);
    });
    child.on('close', (code) => finish(code ?? -1));
  });
}

/**
 * یک تیکِ زمان‌بند — هر دقیقه صدا زده می‌شود.
 *
 * ملاک next_run_at است، نه تطبیقِ دوبارهٔ الگو: اگر پنل یک دقیقه خواب بوده
 * (بار زیاد، یا تازه بالا آمده)، کاری که وقتش گذشته باید همان بارِ اول اجرا
 * شود، نه اینکه تا چرخهٔ بعدیِ الگو منتظر بماند.
 */
export async function tick(now = Date.now()) {
  const due = db.prepare(
    'SELECT id FROM cron_jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?'
  ).all(now);

  for (const row of due) {
    // پیش از اجرا زمانِ بعدی را جلو می‌بریم تا یک کارِ کند در تیکِ بعدی
    // دوباره «سررسیده» دیده نشود
    const job = get(row.id);
    if (job) {
      db.prepare('UPDATE cron_jobs SET next_run_at = ? WHERE id = ?')
        .run(nextRunAt(job.schedule, new Date(now)), job.id);
    }
    await execute(row.id, { reason: 'scheduled' });
  }
  return due.length;
}

/** پس از بالا آمدنِ پنل، زمانِ بعدیِ همهٔ کارهای فعال دوباره حساب می‌شود */
export function reschedule() {
  const rows = db.prepare('SELECT id, schedule, enabled FROM cron_jobs').all();
  for (const row of rows) {
    db.prepare('UPDATE cron_jobs SET next_run_at = ? WHERE id = ?')
      .run(row.enabled ? nextRunAt(row.schedule) : null, row.id);
  }
  return rows.length;
}
