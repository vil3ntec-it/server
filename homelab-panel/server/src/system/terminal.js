// ---------------------------------------------------------------------------
//  ترمینالِ داخلِ پنل
//
//  ── چرا PTY نیست ─────────────────────────────────────────────────────────
//  یک ترمینالِ واقعی به node-pty نیاز دارد که ماژولِ بومی است و باید کامپایل
//  شود. کلِ این پروژه عمداً هیچ وابستگیِ کامپایل‌شدنی ندارد (حتی دیتابیس از
//  node:sqlite داخلی است) تا روی ویندوزِ خانگی هم بدونِ ابزارِ ساخت نصب شود.
//  اضافه کردنِ node-pty یعنی شکستنِ همان قاعده برای همه، به‌خاطرِ یک صفحه.
//
//  پس این یک «اجراکنندهٔ فرمان» است، نه شبیه‌سازِ پایانه:
//     • فرمان اجرا می‌شود و خروجی زنده می‌آید           ✅
//     • پوشهٔ جاری بینِ فرمان‌ها می‌ماند (cd کار می‌کند)   ✅
//     • با Ctrl+C می‌شود فرمانِ در حالِ اجرا را کشت        ✅
//     • ویرایشگرِ تمام‌صفحه (vim، top، nano) کار نمی‌کند   ❌
//     • رنگ و نوارِ پیشرفتِ برنامه‌ها معمولاً نمی‌آید       ❌
//  این محدودیت در خودِ رابط کاربری هم نوشته شده، تا کسی وسطِ کار غافلگیر
//  نشود و فکر نکند خراب است.
//
//  ── مرزها ────────────────────────────────────────────────────────────────
//  اجرای فرمانِ دلخواه، خودِ کارِ ترمینال است — پس محافظت در «چه کسی» است،
//  نه در «چه فرمانی»: فقط admin، هر فرمان در دفترِ کارها ثبت می‌شود، نشست
//  با بی‌کاری منقضی می‌شود، و خروجی سقف دارد تا یک `cat /dev/urandom` حافظهٔ
//  سرور را نبرد.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const IDLE_MS = 15 * 60 * 1000;      // نشستِ رهاشده بسته می‌شود
const MAX_COMMAND_MS = 10 * 60 * 1000; // یک فرمان تا کِی حق دارد بدود
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024; // سقفِ خروجیِ یک فرمان
const MAX_SESSIONS = 8;
const MAX_COMMAND_LENGTH = 8000;

/**
 * نشانه‌گذارِ پایانِ فرمان.
 *
 * از بایتِ ۰x01 استفاده می‌کنیم چون در خروجیِ متنیِ عادی نمی‌آید. اگر یک
 * رشتهٔ معمولی مثل «---END---» بود، هر برنامه‌ای که همان را چاپ کند
 * می‌توانست پوشهٔ جاریِ ما را جعل کند.
 */
const MARK = '';

/** id -> { userId, username, cwd, child, buffer, lastUsed, timer } */
const sessions = new Map();

function shellFor() {
  if (process.platform === 'win32') {
    return { cmd: process.env.COMSPEC || 'cmd.exe', args: ['/d', '/s', '/q', '/k'] };
  }
  // -s یعنی «اسکریپت را از ورودی بخوان»؛ این‌طور هیچ رشته‌ای وارد argv نمی‌شود
  const sh = process.env.SHELL && !/nologin|false$/.test(process.env.SHELL) ? process.env.SHELL : '/bin/bash';
  return { cmd: sh, args: ['-s'] };
}

function homeDir() {
  try {
    return os.homedir() || process.cwd();
  } catch {
    return process.cwd();
  }
}

export function create({ userId, username, cwd } = {}) {
  if (sessions.size >= MAX_SESSIONS) return { ok: false, error: 'too_many_sessions' };

  const id = crypto.randomBytes(12).toString('base64url');
  const start = cwd && path.isAbsolute(cwd) ? cwd : homeDir();

  sessions.set(id, {
    id,
    userId,
    username,
    cwd: start,
    child: null,
    lastUsed: Date.now(),
    createdAt: Date.now(),
  });

  return { ok: true, id, cwd: start, shell: shellFor().cmd, platform: process.platform };
}

export function get(id) {
  const s = sessions.get(String(id ?? ''));
  if (!s) return null;
  if (Date.now() - s.lastUsed > IDLE_MS) {
    close(id);
    return null;
  }
  return s;
}

export function close(id) {
  const s = sessions.get(String(id ?? ''));
  if (!s) return { ok: true };
  try {
    s.child?.kill('SIGKILL');
  } catch { /* رفته */ }
  sessions.delete(String(id));
  return { ok: true };
}

/** نشست‌های یک کاربر — وقتی از پنل بیرون می‌رود همه بسته می‌شوند */
export function closeAllFor(userId) {
  for (const [id, s] of sessions) {
    if (s.userId === userId) close(id);
  }
}

export function pruneIdle() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastUsed > IDLE_MS) close(id);
  }
}

/** فرمانی که همین حالا در حالِ اجراست را می‌کشد (Ctrl+C) */
export function interrupt(id) {
  const s = get(id);
  if (!s) return { ok: false, error: 'no_session' };
  if (!s.child) return { ok: false, error: 'idle' };
  try {
    s.child.kill('SIGINT');
    // بعضی برنامه‌ها SIGINT را می‌بلعند؛ کمی بعد قاطع‌تر
    setTimeout(() => {
      try { s.child?.kill('SIGKILL'); } catch { /* رفته */ }
    }, 2000);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'kill_failed', detail: String(e?.message || e) };
  }
}

/**
 * اسکریپتی که به پوسته داده می‌شود.
 *
 * سه کار: به پوشهٔ جاری برو، فرمانِ کاربر را اجرا کن، و در پایان پوشهٔ جاری و
 * کدِ خروج را با نشانه‌گذار چاپ کن. بدونِ این، هر `cd` بعد از پایانِ فرمان
 * فراموش می‌شد و ترمینال حسِ «هر بار از نو» می‌داد.
 */
function scriptFor(cwd, command) {
  if (process.platform === 'win32') {
    return `cd /d ${JSON.stringify(cwd)}\r\n${command}\r\necho ${MARK}CWD:%CD%${MARK}EC:%ERRORLEVEL%${MARK}\r\nexit\r\n`;
  }
  const quoted = `'${String(cwd).replace(/'/g, `'\\''`)}'`;
  return [
    `cd ${quoted} 2>/dev/null || cd /`,
    command,
    '__hlp_ec=$?',
    `printf '${MARK}CWD:%s${MARK}EC:%s${MARK}' "$PWD" "$__hlp_ec"`,
    '',
  ].join('\n');
}

/**
 * فرمان را اجرا می‌کند و خروجی را تکه‌تکه به onData می‌دهد.
 * قولی که برمی‌گرداند وقتی حل می‌شود که فرمان تمام شده باشد.
 */
export function run(id, command, { onData } = {}) {
  const s = get(id);
  if (!s) return Promise.resolve({ ok: false, error: 'no_session' });
  if (s.child) return Promise.resolve({ ok: false, error: 'busy' });

  const text = String(command ?? '');
  if (!text.trim()) return Promise.resolve({ ok: true, cwd: s.cwd, exitCode: 0 });
  if (text.length > MAX_COMMAND_LENGTH) return Promise.resolve({ ok: false, error: 'command_too_long' });

  s.lastUsed = Date.now();

  const { cmd, args } = shellFor();
  const child = spawn(cmd, args, {
    cwd: s.cwd,
    env: {
      ...process.env,
      // برنامه‌ها باید بدانند پایانهٔ واقعی نیست تا خروجیِ ساده بدهند
      TERM: 'dumb',
      NO_COLOR: '1',
      CI: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  s.child = child;

  let sent = 0;
  let tail = '';         // دنبالهٔ خروجی، برای پیدا کردنِ نشانه‌گذار
  let capped = false;

  const push = (chunk) => {
    const str = chunk.toString('utf8');
    tail = (tail + str).slice(-4096);

    if (capped) return;
    if (sent + str.length > MAX_OUTPUT_BYTES) {
      capped = true;
      onData?.('\n[خروجی از سقف گذشت و بریده شد]\n');
      try { child.kill('SIGKILL'); } catch { /* رفته */ }
      return;
    }
    sent += str.length;

    // نشانه‌گذارِ پایان نباید به کاربر نشان داده شود
    const visible = str.split(MARK)[0];
    if (visible) onData?.(visible);
  };

  child.stdout.on('data', push);
  child.stderr.on('data', push);

  child.stdin.write(scriptFor(s.cwd, text));
  child.stdin.end();

  const timer = setTimeout(() => {
    try { child.kill('SIGKILL'); } catch { /* رفته */ }
    onData?.('\n[فرمان به مهلتِ زمانی خورد و متوقف شد]\n');
  }, MAX_COMMAND_MS);

  return new Promise((resolve) => {
    child.on('error', (e) => {
      clearTimeout(timer);
      s.child = null;
      s.lastUsed = Date.now();
      resolve({ ok: false, error: 'spawn_failed', detail: String(e?.message || e) });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      s.child = null;
      s.lastUsed = Date.now();

      // پوشهٔ جاری و کدِ خروج از نشانه‌گذارِ انتهای خروجی
      const found = new RegExp(`${MARK}CWD:([\\s\\S]*?)${MARK}EC:(\\d+)${MARK}`).exec(tail);
      if (found) {
        const nextCwd = found[1].trim();
        if (nextCwd && path.isAbsolute(nextCwd)) s.cwd = nextCwd;
      }
      const exitCode = found ? Number(found[2]) : (code ?? 0);

      resolve({ ok: true, cwd: s.cwd, exitCode, truncated: capped });
    });
  });
}

export function stats() {
  return {
    sessions: sessions.size,
    max: MAX_SESSIONS,
    idleTimeoutSeconds: Math.round(IDLE_MS / 1000),
  };
}
