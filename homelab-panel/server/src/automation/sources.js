// ---------------------------------------------------------------------------
//  سرچشمه‌های رویداد — پلِ بینِ چیزهای واقعیِ پنل و موتورِ اتوماسیون
//
//    control/alerts.js  ⇒ service.down (هدفِ پایشی که افتاد) · backup.failed
//    routes/auth.js     ⇒ login.suspicious (رگبارِ ورودِ ناموفق، یا IPِ تازه)
//
//  disk.high از کارِ metrics و temp.high از کارِ thermal-guard می‌آیند
//  (jobs/health.js) — همان‌جا که عدد خوانده می‌شود.
// ---------------------------------------------------------------------------
import { getSetting, setSetting } from '../db.js';
import { alertEvents } from '../control/alerts.js';
import { emit } from './events.js';

/** چند ورودِ ناموفق از یک IP در پنجره، مشکوک است — HLP_LOGIN_BURST */
export const LOGIN_BURST = Math.max(2, Number(process.env.HLP_LOGIN_BURST) || 5);
export const LOGIN_WINDOW_MS = 10 * 60e3;
const KNOWN_IPS_KEY = 'automation_known_login_ips';
const KNOWN_IPS_MAX = 20;

/* ------------------------------- هشدارها -------------------------------- */

let onAlert = null;

export function attachAlertSource() {
  if (onAlert) return;
  onAlert = (a) => {
    if (/_offline$/.test(String(a.kind || ''))) {
      emit('service.down', { kind: a.kind, key: a.key, title: a.title, detail: a.detail, projectId: a.projectId ?? null, serverId: a.serverId ?? null, source: 'monitor' }, 'monitor');
    } else if (a.kind === 'backup_failed') {
      emit('backup.failed', { key: a.key, title: a.title, detail: a.detail, projectId: a.projectId ?? null }, 'monitor');
    }
  };
  alertEvents.on('alert', onAlert);
}

export function detachAlertSource() {
  if (onAlert) alertEvents.off('alert', onAlert);
  onAlert = null;
}

/* --------------------------------- ورود --------------------------------- */

/** ip → زمانِ شکست‌های اخیر */
const failures = new Map();
/** ip → کِی برای رگبار خبر دادیم (تا هر شکستِ بعدی دوباره زنگ نزند) */
const burstTold = new Map();

/**
 * از routes/auth.js صدا زده می‌شود — هم شکست هم موفقیت.
 * چیزی برنمی‌گرداند و هرگز استثنا نمی‌دهد؛ ورود نباید به دفترِ اتوماسیون گره بخورد.
 */
export function noteLogin({ ok, username = '', userId = null, ip = '', userAgent = '' }) {
  try {
    const now = Date.now();
    const addr = String(ip || 'unknown');
    if (!ok) {
      const list = (failures.get(addr) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
      list.push(now);
      failures.set(addr, list);
      const told = burstTold.get(addr) || 0;
      if (list.length >= LOGIN_BURST && now - told > LOGIN_WINDOW_MS) {
        burstTold.set(addr, now);
        emit('login.suspicious', { reason: 'burst', ip: addr, username: String(username).slice(0, 40), failures: list.length, windowMs: LOGIN_WINDOW_MS, userAgent: String(userAgent).slice(0, 200) }, 'auth');
      }
      return;
    }
    failures.delete(addr);
    if (userId == null) return;
    const known = getSetting(KNOWN_IPS_KEY, {});
    const mine = Array.isArray(known[userId]) ? known[userId] : [];
    // نخستین ورودِ این حساب مرجع است، نه مشکوک
    if (mine.length && !mine.includes(addr)) {
      emit('login.suspicious', { reason: 'new_ip', ip: addr, username: String(username).slice(0, 40), userId, knownIps: mine.length, userAgent: String(userAgent).slice(0, 200) }, 'auth');
    }
    if (!mine.includes(addr)) {
      known[userId] = [...mine, addr].slice(-KNOWN_IPS_MAX);
      setSetting(KNOWN_IPS_KEY, known);
    }
  } catch { /* دفترِ ورود نباید ورود را بخواباند */ }
}

/** برای آزمون و پنل: حالِ شمارنده‌ها */
export function loginSourceStatus() {
  return { burst: LOGIN_BURST, windowMs: LOGIN_WINDOW_MS, ipsWithFailures: failures.size, knownUsers: Object.keys(getSetting(KNOWN_IPS_KEY, {})).length };
}

// جدولِ نشست‌ها برای «IPِ تازه» خوانده نمی‌شود: هر ۱۲ ساعت هرس می‌شود و
// حافظه‌اش کوتاه است. فهرستِ IPهای شناخته در settings می‌ماند.
