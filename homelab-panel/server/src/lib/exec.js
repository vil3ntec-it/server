// اجرای امنِ دستورهای سیستمی با مهلت زمانی (برای خواندن اطلاعات واقعی سیستم‌عامل)
import { execFile } from 'node:child_process';

export function run(cmd, args = [], { timeout = 5000, maxBuffer = 4 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer, windowsHide: true }, (err, stdout, stderr) => {
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
