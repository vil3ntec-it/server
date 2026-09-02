// ---------------------------------------------------------------------------
//  فهرستِ پروسه‌های سیستم
//
//  کشتنِ یک پروسه برگشت‌پذیر نیست و می‌تواند خودِ سرور را از پا دربیاورد، پس
//  این ماژول چند مرزِ سفت دارد:
//
//    • PID یک عددِ صحیحِ مثبت است — نه رشته، نه منفی. منفی در kill(2) یعنی
//      «کلِ گروهِ پروسه»؛ یعنی یک ورودیِ بی‌دقت می‌توانست ده‌ها پروسه را با
//      هم ببرد.
//    • PID ۱ هرگز. init/systemd را که بکشی، ماشین می‌خوابد.
//    • خودِ پنل و والدش هرگز. وگرنه پنل می‌توانست خودش را بکشد و کاربر با
//      یک صفحهٔ سفید و بدونِ راهِ برگشت می‌ماند.
//    • فقط سه سیگنالِ متعارف. رشتهٔ دلخواه به kill نمی‌رود.
//
//  «ری‌استارت» این‌جا عمداً نیست: یک PIDِ دلخواه را نمی‌شود دوباره بالا آورد،
//  چون کسی نمی‌داند با چه محیط و چه کاربری اجرا شده بود. ری‌استارتِ چیزهایی
//  که پنل خودش راه انداخته، جای خودش در sites/process.js است.
// ---------------------------------------------------------------------------
import os from 'node:os';
import { run, powershell } from '../lib/exec.js';

const T_READ = 8000;

/** سیگنال‌های مجاز — هر چیزِ دیگری رد می‌شود */
const SIGNALS = { TERM: 'SIGTERM', KILL: 'SIGKILL', INT: 'SIGINT' };

function fail(code, detail = null) {
  return { ok: false, error: code, detail };
}

/** PID معتبر: عددِ صحیحِ مثبت و در بازهٔ منطقی */
export function validPid(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 2 ** 31 - 1;
}

/**
 * پروسه‌هایی که هیچ‌وقت نباید کشته شوند.
 *
 * process.pid خودِ پنل است و process.ppid پروسه‌ای که آن را راه انداخته —
 * روی لینوکس معمولاً systemd یا پوستهٔ کاربر، روی ویندوز سرویس‌منیجر. کشتنِ
 * هرکدام یعنی پنل بی‌صدا می‌رود و کسی نمی‌فهمد چرا.
 */
export function isProtectedPid(pid) {
  const n = Number(pid);
  return n === 1 || n === process.pid || n === process.ppid;
}

/* -------------------------------------------------------------------------- */
/*  خواندنِ فهرست                                                              */
/* -------------------------------------------------------------------------- */

const num = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/**
 * وضعیتِ کوتاهِ ps را به چیزی که آدم می‌فهمد تبدیل می‌کند.
 * حرفِ اول تعیین‌کننده است؛ بقیه پرچم‌اند (< بالا، N پایین، s رهبرِ نشست…).
 */
function stateOf(stat) {
  switch (String(stat || '').charAt(0)) {
    case 'R': return 'running';
    case 'S': return 'sleeping';
    case 'D': return 'waiting';   // خوابِ بی‌وقفه — معمولاً منتظرِ دیسک
    case 'T': return 'stopped';
    case 'Z': return 'zombie';
    case 'I': return 'idle';
    default: return 'unknown';
  }
}

/**
 * لینوکس و مک.
 *
 * ترتیبِ ستون‌ها عمدی است: args آخر است چون تنها فیلدی است که فاصله دارد.
 * اگر وسط بود، هیچ تجزیه‌ای درست از آب درنمی‌آمد.
 *
 * etimes (ثانیهٔ سپری‌شده) به‌جای lstart، چون lstart خودش چند کلمه است.
 */
async function listUnix() {
  const res = await run(
    'ps',
    ['-eo', 'pid=,ppid=,user=,pcpu=,pmem=,rss=,stat=,etimes=,args='],
    { timeout: T_READ, maxBuffer: 8 * 1024 * 1024 }
  );
  if (!res.ok) return fail('ps_failed', res.stderr.trim().slice(0, 300) || null);

  const items = [];
  for (const line of res.stdout.split('\n')) {
    const text = line.trim();
    if (!text) continue;
    // هشت فیلدِ بدونِ فاصله، و هرچه ماند فرمانِ کامل است
    const parts = text.split(/\s+/);
    if (parts.length < 9) continue;
    const [pid, ppid, user, pcpu, pmem, rss, stat, etimes] = parts;
    const command = parts.slice(8).join(' ');
    if (!validPid(pid)) continue;

    items.push({
      pid: Number(pid),
      ppid: Number(ppid) || 0,
      user,
      cpuPercent: num(pcpu),
      memPercent: num(pmem),
      rssBytes: num(rss) * 1024, // ps واحدش کیلوبایت است
      state: stateOf(stat),
      uptimeSeconds: num(etimes),
      name: command.split(/\s+/)[0].split('/').pop() || command,
      command,
      protectedPid: isProtectedPid(pid),
    });
  }
  return { ok: true, items };
}

/**
 * ویندوز.
 *
 * ConvertTo-Json روی یک عنصر، یک شیء می‌دهد نه آرایه — بارها همین یک تفاوت
 * باعثِ خطای «items.map is not a function» می‌شود. با -AsArray حل شده و
 * پایین‌تر هم دوباره سنجیده می‌شود.
 *
 * CPU در Get-Process ثانیهٔ پردازنده است، نه درصد. آن را به‌جای درصدِ جعلی،
 * همان‌طور که هست می‌دهیم و رابط کاربری هم همان را نشان می‌دهد.
 */
async function listWindows() {
  const script = `Get-Process | Select-Object Id,Name,CPU,WorkingSet64,StartTime | ConvertTo-Json -Compress -Depth 2 -AsArray`;
  const res = await powershell(script, { timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
  if (!res.ok) return fail('ps_failed', res.stderr.trim().slice(0, 300) || null);

  let rows;
  try {
    rows = JSON.parse(res.stdout || '[]');
  } catch {
    return fail('parse_failed');
  }
  if (!Array.isArray(rows)) rows = [rows];

  const totalMem = os.totalmem() || 1;
  const now = Date.now();

  const items = rows
    .filter((row) => validPid(row?.Id))
    .map((row) => {
      // StartTime در JSONِ پاورشل به شکلِ /Date(1712345678901)/ می‌آید
      const match = /\/Date\((\d+)\)\//.exec(String(row.StartTime ?? ''));
      const started = match ? Number(match[1]) : null;
      const rss = num(row.WorkingSet64);
      return {
        pid: Number(row.Id),
        ppid: 0,
        user: '',
        cpuPercent: null,          // ویندوز درصد نمی‌دهد — دروغ نمی‌سازیم
        cpuSeconds: num(row.CPU),
        memPercent: totalMem ? (rss / totalMem) * 100 : 0,
        rssBytes: rss,
        state: 'unknown',
        uptimeSeconds: started ? Math.max(0, Math.round((now - started) / 1000)) : 0,
        name: String(row.Name || ''),
        command: String(row.Name || ''),
        protectedPid: isProtectedPid(row.Id),
      };
    });

  return { ok: true, items };
}

export async function list({ query = '', sort = 'cpu', limit = 300 } = {}) {
  const res = process.platform === 'win32' ? await listWindows() : await listUnix();
  if (!res.ok) return res;

  let items = res.items;

  // جست‌وجو روی نام و فرمان — کاربر معمولاً «node» را می‌داند، نه PID را
  const q = String(query || '').trim().toLowerCase();
  if (q) {
    items = items.filter(
      (p) => p.name.toLowerCase().includes(q) || p.command.toLowerCase().includes(q) || String(p.pid) === q
    );
  }

  const total = items.length;

  const by = {
    cpu: (a, b) => (b.cpuPercent ?? b.cpuSeconds ?? 0) - (a.cpuPercent ?? a.cpuSeconds ?? 0),
    memory: (a, b) => b.rssBytes - a.rssBytes,
    pid: (a, b) => a.pid - b.pid,
    name: (a, b) => a.name.localeCompare(b.name),
  };
  items = [...items].sort(by[sort] ?? by.cpu);

  const capped = Math.min(1000, Math.max(1, Number(limit) || 300));
  return { ok: true, items: items.slice(0, capped), total, shown: Math.min(total, capped) };
}

/* -------------------------------------------------------------------------- */
/*  کشتن                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * سیگنال را به پروسه می‌فرستد — با process.kill خودِ Node، نه دستورِ kill.
 *
 * چرا: هیچ فرایندِ جانبی‌ای ساخته نمی‌شود، پس هیچ رشته‌ای هم به هیچ پوسته‌ای
 * نمی‌رسد. تنها ورودی یک عددِ صحیح و یک سیگنالِ از فهرستِ بسته است.
 */
export function kill(pid, signal = 'TERM') {
  if (!validPid(pid)) return fail('invalid_pid');

  const sig = SIGNALS[String(signal || 'TERM').toUpperCase()];
  if (!sig) return fail('invalid_signal');

  const target = Number(pid);
  if (isProtectedPid(target)) {
    return fail('protected_pid', {
      reason: target === 1 ? 'init' : target === process.pid ? 'panel' : 'panel_parent',
    });
  }

  try {
    process.kill(target, sig);
    return { ok: true, pid: target, signal: sig };
  } catch (e) {
    if (e?.code === 'ESRCH') return fail('not_found');
    if (e?.code === 'EPERM') return fail('forbidden_by_os');
    return fail('kill_failed', String(e?.message || e).slice(0, 200));
  }
}

/* -------------------------------------------------------------------------- */
/*  خلاصه                                                                      */
/* -------------------------------------------------------------------------- */

export async function summary() {
  const res = await list({ limit: 1000 });
  if (!res.ok) return { ok: true, total: 0, running: 0, available: false };

  return {
    ok: true,
    available: true,
    total: res.total,
    running: res.items.filter((p) => p.state === 'running').length,
    zombies: res.items.filter((p) => p.state === 'zombie').length,
  };
}
