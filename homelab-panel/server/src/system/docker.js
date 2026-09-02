// ---------------------------------------------------------------------------
//  مدیریتِ Docker
//
//  چرا این‌طور نوشته شده:
//
//  ۱) هیچ‌جا shell صدا زده نمی‌شود. همه‌چیز از راهِ execFile با آرگومان‌های
//     جداست، پس نامِ کانتینری مثل «; rm -rf /» فقط یک نامِ عجیب است، نه یک
//     دستور. این تنها راهِ مطمئن است؛ escape کردنِ دستی همیشه یک حالتِ
//     فراموش‌شده دارد.
//
//  ۲) شناسه‌ها پیش از رسیدن به docker اعتبارسنجی می‌شوند. docker خودش هم
//     چیزِ نامعتبر را رد می‌کند، ولی آن‌وقت پیامِ خطا از آنِ ما نیست و در
//     رابط کاربری گنگ می‌شود.
//
//  ۳) خروجی JSON خط‌به‌خط خوانده می‌شود (--format '{{json .}}'). جدولِ متنیِ
//     docker با فاصله جدا می‌شود و نامِ ایمیج می‌تواند فاصله داشته باشد؛
//     تجزیهٔ متنی همان‌جا می‌شکند.
//
//  ۴) هر فراخوانی مهلتِ زمانی دارد. یک دیمنِ داکرِ گیرکرده نباید یک درخواستِ
//     HTTP را برای همیشه باز نگه دارد.
// ---------------------------------------------------------------------------
import { run } from '../lib/exec.js';

/** مهلت‌ها بر حسبِ کاری که می‌کنند، نه یک عددِ واحد */
const T_READ = 8000;      // فهرست گرفتن
const T_ACTION = 30000;   // start/stop/restart — stop تا ۱۰ ثانیه صبر می‌کند
const T_STATS = 12000;    // آمار یک نمونه‌ای

/**
 * شناسهٔ معتبرِ داکر یا نامِ کانتینر/شبکه/حجم.
 *
 * داکر خودش این‌ها را می‌پذیرد: حروف، رقم، و . _ - و برای ایمیج‌ها / و :
 * هر چیزِ دیگری رد می‌شود — از جمله فاصله، که تنها راهِ تزریقِ آرگومانِ
 * اضافه است اگر روزی کسی این ماژول را به shell وصل کند.
 */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const IMAGE_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/:@]{0,255}$/;

export function validId(value) {
  return ID_RE.test(String(value ?? ''));
}
export function validImage(value) {
  return IMAGE_RE.test(String(value ?? ''));
}

/** خطاهای این ماژول همیشه همین شکل‌اند تا مسیرها بتوانند یکسان جوابشان بدهند */
function fail(code, detail = null) {
  return { ok: false, error: code, detail };
}

/* -------------------------------------------------------------------------- */
/*  در دسترس بودنِ داکر                                                        */
/* -------------------------------------------------------------------------- */

let cached = { at: 0, value: null };

/**
 * آیا داکر هست و به دیمنش می‌رسیم؟
 *
 * دو حالتِ متفاوت که نباید قاطی شوند: «نصب نیست» یعنی کاری از پنل برنمی‌آید،
 * ولی «نصب هست و دیمن نمی‌دهد» معمولاً یعنی کاربر در گروهِ docker نیست — و
 * آن یک راهنماییِ مشخص دارد. جوابِ «داکر کار نمی‌کند» هر دو را می‌پوشاند و
 * هیچ‌کدام را حل نمی‌کند.
 *
 * نتیجه ۵ ثانیه کش می‌شود: هر بار که صفحه باز می‌شود چند درخواست می‌آید و
 * اجرای `docker version` برای هرکدام بی‌فایده است.
 */
export async function available({ force = false } = {}) {
  if (!force && cached.value && Date.now() - cached.at < 5000) return cached.value;

  const version = await run('docker', ['version', '--format', '{{json .}}'], { timeout: T_READ });
  let value;

  if (!version.ok && /ENOENT|not found|not recognized/i.test(version.error?.message || version.stderr || '')) {
    value = { ok: false, installed: false, running: false, reason: 'not_installed' };
  } else if (!version.ok) {
    // داکر هست ولی جواب نداد — تقریباً همیشه دسترسی یا خاموش بودنِ دیمن
    const text = `${version.stderr}${version.stdout}`;
    const denied = /permission denied|dial unix|cannot connect/i.test(text);
    value = {
      ok: false,
      installed: true,
      running: false,
      reason: denied ? 'daemon_unreachable' : 'error',
      detail: text.trim().slice(0, 400) || null,
    };
  } else {
    let client = null;
    let server = null;
    try {
      const parsed = JSON.parse(version.stdout);
      client = parsed?.Client?.Version ?? null;
      server = parsed?.Server?.Version ?? null;
    } catch { /* نسخه ندانستن، مانعِ کار نیست */ }
    value = { ok: true, installed: true, running: true, client, server };
  }

  cached = { at: Date.now(), value };
  return value;
}

/* -------------------------------------------------------------------------- */
/*  خواندنِ فهرست‌ها                                                            */
/* -------------------------------------------------------------------------- */

/**
 * خروجیِ `--format '{{json .}}'` یک شیءِ JSON در هر خط است، نه یک آرایه.
 * خطِ خراب دور ریخته می‌شود، نه اینکه کلِ فهرست بیفتد.
 */
function parseJsonLines(stdout) {
  const rows = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    try {
      rows.push(JSON.parse(text));
    } catch { /* یک خطِ ناقص نباید بقیه را ببرد */ }
  }
  return rows;
}

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** وضعیت را به چند حالتِ ثابت می‌بریم تا رابط کاربری رنگ‌ها را حدس نزند */
function normalizeState(state) {
  const s = String(state || '').toLowerCase();
  if (s.includes('running')) return 'running';
  if (s.includes('paused')) return 'paused';
  if (s.includes('restarting')) return 'restarting';
  if (s.includes('created')) return 'created';
  if (s.includes('dead')) return 'dead';
  return 'stopped';
}

export async function listContainers({ all = true } = {}) {
  const args = ['ps', '--no-trunc', '--format', '{{json .}}'];
  if (all) args.push('--all');
  const res = await run('docker', args, { timeout: T_READ });
  if (!res.ok) return fail('docker_failed', res.stderr.trim().slice(0, 400) || null);

  const items = parseJsonLines(res.stdout).map((row) => ({
    id: row.ID || '',
    shortId: String(row.ID || '').slice(0, 12),
    name: row.Names || '',
    image: row.Image || '',
    command: row.Command || '',
    createdAt: row.CreatedAt || null,
    status: row.Status || '',
    state: normalizeState(row.State || row.Status),
    ports: String(row.Ports || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean),
    // برچسبِ compose — تا بشود کانتینرهای یک استقرار را کنارِ هم دید
    project: row.Labels ? labelValue(row.Labels, 'com.docker.compose.project') : null,
  }));

  return { ok: true, items };
}

/** Labels یک رشتهٔ «k=v,k=v» است */
function labelValue(labels, key) {
  for (const part of String(labels).split(',')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === key) return part.slice(eq + 1).trim();
  }
  return null;
}

export async function listImages() {
  const res = await run('docker', ['images', '--format', '{{json .}}'], { timeout: T_READ });
  if (!res.ok) return fail('docker_failed', res.stderr.trim().slice(0, 400) || null);

  const items = parseJsonLines(res.stdout).map((row) => ({
    id: row.ID || '',
    repository: row.Repository || '',
    tag: row.Tag || '',
    createdAt: row.CreatedAt || null,
    size: row.Size || '',
    dangling: row.Repository === '<none>' || row.Tag === '<none>',
  }));

  return { ok: true, items };
}

export async function listVolumes() {
  const res = await run('docker', ['volume', 'ls', '--format', '{{json .}}'], { timeout: T_READ });
  if (!res.ok) return fail('docker_failed', res.stderr.trim().slice(0, 400) || null);

  const items = parseJsonLines(res.stdout).map((row) => ({
    name: row.Name || '',
    driver: row.Driver || '',
    scope: row.Scope || '',
    mountpoint: row.Mountpoint || null,
  }));

  return { ok: true, items };
}

export async function listNetworks() {
  const res = await run('docker', ['network', 'ls', '--no-trunc', '--format', '{{json .}}'], { timeout: T_READ });
  if (!res.ok) return fail('docker_failed', res.stderr.trim().slice(0, 400) || null);

  const items = parseJsonLines(res.stdout).map((row) => ({
    id: row.ID || '',
    name: row.Name || '',
    driver: row.Driver || '',
    scope: row.Scope || '',
  }));

  return { ok: true, items };
}

/**
 * مصرفِ لحظه‌ایِ منابع.
 *
 * --no-stream یعنی یک نمونه بگیر و برگرد. بدونش دستور تا ابد باز می‌ماند و
 * مهلتِ زمانی هر بار می‌بُرَدش — یعنی همیشه خطا، حتی وقتی داکر سالم است.
 */
export async function stats() {
  const res = await run(
    'docker',
    ['stats', '--no-stream', '--format', '{{json .}}'],
    { timeout: T_STATS }
  );
  if (!res.ok) return fail('docker_failed', res.stderr.trim().slice(0, 400) || null);

  const items = parseJsonLines(res.stdout).map((row) => ({
    id: row.ID || row.Container || '',
    name: row.Name || '',
    cpuPercent: num(row.CPUPerc),
    memPercent: num(row.MemPerc),
    memUsage: row.MemUsage || '',
    netIO: row.NetIO || '',
    blockIO: row.BlockIO || '',
    pids: num(row.PIDs),
  }));

  return { ok: true, items };
}

/* -------------------------------------------------------------------------- */
/*  جزئیات و لاگ                                                               */
/* -------------------------------------------------------------------------- */

export async function inspect(id) {
  if (!validId(id)) return fail('invalid_id');
  const res = await run('docker', ['inspect', id], { timeout: T_READ });
  if (!res.ok) return fail('not_found', res.stderr.trim().slice(0, 400) || null);
  try {
    const parsed = JSON.parse(res.stdout);
    return { ok: true, item: Array.isArray(parsed) ? parsed[0] : parsed };
  } catch {
    return fail('parse_failed');
  }
}

/**
 * لاگِ کانتینر.
 *
 * tail سقف دارد چون خروجی به حافظهٔ همین پروسه می‌آید؛ یک کانتینرِ پرحرف
 * می‌تواند صدها مگابایت لاگ داشته باشد و maxBuffer را بترکاند.
 */
export async function logs(id, { tail = 200 } = {}) {
  if (!validId(id)) return fail('invalid_id');
  const lines = Math.min(2000, Math.max(1, Number(tail) || 200));
  const res = await run(
    'docker',
    ['logs', '--tail', String(lines), '--timestamps', id],
    { timeout: T_READ, maxBuffer: 8 * 1024 * 1024 }
  );
  // داکر لاگِ stderrِ کانتینر را روی stderr می‌دهد؛ هر دو لاگ‌اند
  if (!res.ok && !res.stdout && !res.stderr) return fail('not_found');
  return { ok: true, text: `${res.stdout}${res.stderr}` };
}

/* -------------------------------------------------------------------------- */
/*  کارها                                                                      */
/* -------------------------------------------------------------------------- */

/** کارهایی که روی یک کانتینر مجازند — هر چیزِ دیگری رد می‌شود */
const CONTAINER_ACTIONS = {
  start: ['start'],
  stop: ['stop'],
  restart: ['restart'],
  pause: ['pause'],
  unpause: ['unpause'],
  kill: ['kill'],
};

/**
 * چرا allowlist و نه رشتهٔ دلخواه: اگر کارِ درخواستی مستقیم به docker برود،
 * «rm -f» یا «exec» هم از همین در وارد می‌شود. این فهرست همان مرزِ سیاست است
 * و در یک جا نوشته شده، نه پخش در مسیرها.
 */
export async function containerAction(id, action) {
  if (!validId(id)) return fail('invalid_id');
  const args = CONTAINER_ACTIONS[String(action || '')];
  if (!args) return fail('unknown_action');

  const res = await run('docker', [...args, id], { timeout: T_ACTION });
  if (!res.ok) return fail('action_failed', res.stderr.trim().slice(0, 400) || null);
  return { ok: true, action, id };
}

/** حذف — جدا از بقیه، چون برگشت‌ناپذیر است و مسیر باید نقشِ بالاتری بخواهد */
export async function removeContainer(id, { force = false } = {}) {
  if (!validId(id)) return fail('invalid_id');
  const args = ['rm'];
  if (force) args.push('--force');
  args.push(id);

  const res = await run('docker', args, { timeout: T_ACTION });
  if (!res.ok) return fail('remove_failed', res.stderr.trim().slice(0, 400) || null);
  return { ok: true, id };
}

export async function removeImage(id, { force = false } = {}) {
  if (!validImage(id)) return fail('invalid_id');
  const args = ['rmi'];
  if (force) args.push('--force');
  args.push(id);

  const res = await run('docker', args, { timeout: T_ACTION });
  if (!res.ok) return fail('remove_failed', res.stderr.trim().slice(0, 400) || null);
  return { ok: true, id };
}

export async function removeVolume(name) {
  if (!validId(name)) return fail('invalid_id');
  const res = await run('docker', ['volume', 'rm', name], { timeout: T_ACTION });
  if (!res.ok) return fail('remove_failed', res.stderr.trim().slice(0, 400) || null);
  return { ok: true, name };
}

/* -------------------------------------------------------------------------- */
/*  خلاصه برای داشبورد                                                         */
/* -------------------------------------------------------------------------- */

/**
 * یک عددِ کوچک برای کارتِ داشبورد. اگر داکر نباشد، خطا نیست — فقط «نیست».
 * داشبورد نباید به‌خاطرِ نبودنِ داکر قرمز شود.
 */
export async function summary() {
  const state = await available();
  if (!state.ok) {
    return { ok: true, installed: state.installed, running: false, containers: 0, runningContainers: 0, images: 0 };
  }

  const [containers, images] = await Promise.all([listContainers({ all: true }), listImages()]);
  const list = containers.ok ? containers.items : [];

  return {
    ok: true,
    installed: true,
    running: true,
    containers: list.length,
    runningContainers: list.filter((c) => c.state === 'running').length,
    images: images.ok ? images.items.length : 0,
  };
}
