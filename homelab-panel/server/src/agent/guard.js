// ---------------------------------------------------------------------------
//  نگهبانِ دستیار — روشن/خاموش، حرارت، بی‌کاری، و «یکی یکی»
//
//  قاعده‌های پرامپت (بخشِ ۹):
//    • یک دکمهٔ روشن/خاموش. خاموش = مدل از رَم بیرون، مصرف صفر.
//    • دمای CPU بالای ۷۵ ⇒ مکث؛ بالای ۸۵ ⇒ خاموشیِ خودکار و اعلان.
//    • بی‌کاریِ ۳۰ دقیقه ⇒ مدل از رَم بیرون.
//    • حداکثر یک درخواستِ هم‌زمان.
//
//  تصمیم (`decide`) از حالت جداست تا بشود بی سنسورِ واقعی سنجیدش.
// ---------------------------------------------------------------------------
import { getSetting, setSetting, logEvent } from '../db.js';
import { readTemperature } from '../metrics/system.js';
import { unload } from './ollama.js';

export const DEFAULTS = Object.freeze({
  enabled: true,
  idleMinutes: 30,
  pauseAtC: 75,
  stopAtC: 85,
  resumeBelowC: 70,
});

const state = {
  paused: false,
  pausedReason: '',
  stoppedByHeat: false,
  lastActivityAt: 0,
  lastTempC: null,
  modelLoaded: false,
  busy: false,
  timer: null,
  ticks: 0,
};

export function settings() {
  const num = (k, d) => { const v = Number(getSetting(k, '')); return Number.isFinite(v) && v > 0 ? v : d; };
  return {
    enabled: getSetting('agent_enabled', DEFAULTS.enabled ? '1' : '0') !== '0',
    model: String(getSetting('agent_model', '') || ''),
    idleMinutes: num('agent_idle_minutes', DEFAULTS.idleMinutes),
    pauseAtC: num('agent_pause_c', DEFAULTS.pauseAtC),
    stopAtC: num('agent_stop_c', DEFAULTS.stopAtC),
    resumeBelowC: num('agent_resume_c', DEFAULTS.resumeBelowC),
    reportHour: Math.min(23, Math.max(0, Number(getSetting('agent_report_hour', '8')) || 0)),
    reportEmail: String(getSetting('agent_report_email', '') || ''),
  };
}

export function saveSettings(patch = {}) {
  if (patch.enabled !== undefined) setSetting('agent_enabled', patch.enabled ? '1' : '0');
  if (patch.model !== undefined) setSetting('agent_model', String(patch.model || ''));
  for (const [k, key] of [['idleMinutes', 'agent_idle_minutes'], ['pauseAtC', 'agent_pause_c'], ['stopAtC', 'agent_stop_c'], ['resumeBelowC', 'agent_resume_c'], ['reportHour', 'agent_report_hour']]) {
    if (patch[k] !== undefined) setSetting(key, String(Number(patch[k]) || 0));
  }
  if (patch.reportEmail !== undefined) setSetting('agent_report_email', String(patch.reportEmail || '').slice(0, 200));
  if (patch.enabled === false) { state.stoppedByHeat = false; state.paused = false; state.pausedReason = ''; }
  return settings();
}

/**
 * تصمیمِ حرارتی — خالص و بی حالتِ پنهان.
 * @returns {'stop'|'pause'|'resume'|'none'}
 */
export function decide({ tempC, paused, cfg = DEFAULTS }) {
  if (tempC == null || !Number.isFinite(tempC)) return paused ? 'resume' : 'none';
  if (tempC > cfg.stopAtC) return 'stop';
  if (tempC > cfg.pauseAtC) return paused ? 'none' : 'pause';
  if (paused && tempC < cfg.resumeBelowC) return 'resume';
  return 'none';
}

export function touch() { state.lastActivityAt = Date.now(); state.modelLoaded = true; }
export function markUnloaded() { state.modelLoaded = false; }

/** آیا همین حالا می‌شود پرسید؟ */
export function canServe() {
  const cfg = settings();
  if (!cfg.enabled) return { ok: false, code: 'disabled', reason: 'دستیار خاموش است — از همین صفحه روشنش کنید' };
  if (state.stoppedByHeat) return { ok: false, code: 'overheated', reason: `دستیار به‌خاطرِ دمای بالای پردازنده (${state.lastTempC}°C) خاموش شد؛ وقتی خنک شد از همین‌جا روشنش کنید` };
  if (state.paused) return { ok: false, code: 'paused', reason: state.pausedReason || 'دستیار موقتاً مکث کرده' };
  if (state.busy) return { ok: false, code: 'busy', reason: 'دستیار مشغولِ یک درخواستِ دیگر است — چند لحظه بعد' };
  return { ok: true };
}

export function setBusy(v) { state.busy = !!v; if (v) touch(); }

export function guardStatus() {
  const cfg = settings();
  return {
    ...cfg,
    paused: state.paused,
    pausedReason: state.pausedReason,
    stoppedByHeat: state.stoppedByHeat,
    busy: state.busy,
    modelLoaded: state.modelLoaded,
    lastActivityAt: state.lastActivityAt || null,
    lastTempC: state.lastTempC,
    idleUnloadAt: state.modelLoaded && state.lastActivityAt ? state.lastActivityAt + cfg.idleMinutes * 60e3 : null,
  };
}

/**
 * بی‌کاری ⇒ مدل از رَم بیرون. جدا از تیکِ حرارتی، چون موتورِ اتوماسیون این
 * دو را دو کارِ جدا می‌داند (thermal-guard هر ۳۰ ثانیه، agent-idle-off هر
 * دقیقه)؛ tick() خودش هر دو را می‌زند تا رفتارِ قدیمی و آزمون‌ها دست نخورد.
 */
export async function idleCheck() {
  const cfg = settings();
  const idle = state.modelLoaded && !state.busy && cfg.model && state.lastActivityAt && Date.now() - state.lastActivityAt > cfg.idleMinutes * 60e3;
  if (!idle) return { unloaded: false, modelLoaded: state.modelLoaded, idleMinutes: cfg.idleMinutes };
  await unload(cfg.model);
  state.modelLoaded = false;
  logEvent('info', 'agent', `مدل بعد از ${cfg.idleMinutes} دقیقه بی‌کاری از حافظه بیرون رفت`);
  return { unloaded: true, modelLoaded: false, idleMinutes: cfg.idleMinutes };
}

/** یک تیک — جداست تا آزمون بتواند با دمای ساختگی صدایش بزند */
export async function tick({ tempC: forced, notify, idle = true } = {}) {
  state.ticks++;
  const cfg = settings();
  let tempC = forced;
  if (tempC === undefined) {
    try { tempC = (await readTemperature())?.max ?? null; } catch { tempC = null; }
  }
  state.lastTempC = tempC;

  if (cfg.enabled && !state.stoppedByHeat) {
    const d = decide({ tempC, paused: state.paused, cfg });
    if (d === 'stop') {
      state.stoppedByHeat = true;
      state.paused = false;
      if (state.modelLoaded && cfg.model) { await unload(cfg.model); state.modelLoaded = false; }
      logEvent('warn', 'agent', `دستیار به‌خاطرِ دمای ${tempC}°C پردازنده خاموش شد`);
      notify?.({ kind: 'overheat', title: 'دستیار به‌خاطرِ دمای بالا خاموش شد', detail: `دمای پردازنده ${tempC}°C` });
    } else if (d === 'pause') {
      state.paused = true;
      state.pausedReason = `دمای پردازنده ${tempC}°C است — تا خنک شدن مکث می‌کنم`;
      logEvent('info', 'agent', state.pausedReason);
    } else if (d === 'resume') {
      state.paused = false;
      state.pausedReason = '';
    }
  }

  // بی‌کاری ⇒ مدل از رَم بیرون
  if (idle) await idleCheck();
  return guardStatus();
}

export function startGuard({ notify, intervalMs = 30_000 } = {}) {
  stopGuard();
  state.timer = setInterval(() => { tick({ notify }).catch(() => {}); }, intervalMs);
  state.timer.unref?.();
}

export function stopGuard() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

/** خاموش کردنِ صریح — مدل از رَم بیرون، مصرف صفر */
export async function powerOff() {
  const cfg = settings();
  if (cfg.model) await unload(cfg.model);
  state.modelLoaded = false;
  state.paused = false;
  state.pausedReason = '';
  state.stoppedByHeat = false;
  saveSettings({ enabled: false });
}

export function powerOn() {
  state.stoppedByHeat = false;
  state.paused = false;
  state.pausedReason = '';
  saveSettings({ enabled: true });
}
