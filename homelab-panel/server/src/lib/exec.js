// اجرای امنِ دستورهای سیستمی با مهلت زمانی (برای خواندن اطلاعات واقعی سیستم‌عامل)
import { execFile } from 'node:child_process';

/**
 * cwd و env باید واقعاً منتقل شوند.
 *
 * قبلاً فقط timeout و maxBuffer خوانده می‌شد و cwd بی‌صدا دور ریخته می‌شد؛
 * یعنی «npm install» بعد از به‌روزرسانی نه در ریشهٔ نصب، بلکه در هر پوشه‌ای
 * که پروسه از آن شروع شده بود اجرا می‌شد.
 */
export function run(cmd, args = [], { timeout = 5000, maxBuffer = 4 * 1024 * 1024, cwd, env } = {}) {
  return new Promise((resolve) => {
    const options = { timeout, maxBuffer, windowsHide: true };
    if (cwd) options.cwd = cwd;
    if (env) options.env = env;
    execFile(cmd, args, options, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err || null });
    });
  });
}

// اجرای یک اسکریپت PowerShell (فقط ویندوز)
export function powershell(script, opts) {
  return run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    opts
  );
}
