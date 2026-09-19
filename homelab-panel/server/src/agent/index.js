// ---------------------------------------------------------------------------
//  دستیارِ هوشمندِ سرور — نقطهٔ راه‌اندازی
//
//  همه‌چیز داخلِ خودِ پنل است (قاعدهٔ پرامپت: «ایجنت داخلِ خودِ پنل است، نه
//  برنامهٔ جدا»): یک نگهبان (حرارت/بی‌کاری/خاموش)، یک زمان‌بندِ گزارش، و
//  شنوندهٔ هشدارها. مغز روی Ollama است که جدا نصب می‌شود.
// ---------------------------------------------------------------------------
import { ensureAgentSchema, expireActions } from './memory.js';
import * as guard from './guard.js';
import { startScheduler, stopScheduler, analyzeAlert } from './reports.js';
import { alertEvents } from '../control/alerts.js';
import { getIo } from '../state.js';
import { logEvent } from '../db.js';
import { config } from '../config.js';

let onAlert = null;
let analyzing = false;

export function startAgent() {
  ensureAgentSchema();
  expireActions();
  if (!config.agent?.enabled) return false;
  guard.startGuard({
    notify: (n) => getIo()?.emit('agent:notice', { ...n, at: Date.now() }),
  });
  startScheduler();
  onAlert = (alert) => {
    // یک تحلیل در یک زمان — هشدارِ رگباری نباید مدل را رگباری صدا بزند
    if (analyzing || !guard.settings().enabled) return;
    analyzing = true;
    analyzeAlert(alert).catch((e) => logEvent('warn', 'agent', `تحلیلِ هشدار نشد: ${e.message}`)).finally(() => { analyzing = false; });
  };
  alertEvents.on('alert', onAlert);
  return true;
}

export function stopAgent() {
  guard.stopGuard();
  stopScheduler();
  if (onAlert) alertEvents.off('alert', onAlert);
  onAlert = null;
}
