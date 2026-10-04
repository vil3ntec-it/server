// ═══════════════════════════════════════════════════════════════════════════
//  درِ ارتقای وب‌سوکت — شورا، پ۳ (ممیزی M10)
//
//  تا ۱.۵۰.۳۱ هر ارتقای وب‌سوکت **پیش از** سنجشِ رمز انجام می‌شد: سرور دست
//  می‌داد، بعد می‌سنجید و با `{op:'error'}` می‌بست. پس حدس زدنِ رمزِ یک پمپ یا
//  یک سایت هیچ سقفی نداشت و هر حدس یک وب‌سوکتِ کامل می‌ساخت.
//
//  حالا:
//    ۱) رمز **پیش از** ارتقا سنجیده می‌شود (`route(req)` بی هیچ اتصالی).
//    ۲) درست ⇒ ارتقا، مثلِ همیشه.
//    ۳) غلط ⇒ اگر این IP از سقف گذشته: پاسخِ HTTPِ ۴۲۹ **بی ارتقا** و بستنِ
//       سوکت. وگرنه همان `{op:'error'}` و بستن — تا برنامه‌ها همچنان «رمز غلط»
//       را از «پیدا نشد» جدا کنند (اپِ کارمندان و برنامهٔ کامپیوتر با همین پیام
//       درِ بعدی را امتحان می‌کنند؛ ۴۰۱ِ HTTP در مرورگر هیچ پیامی به صفحه
//       نمی‌رساند).
//
//  ⛔ **یک رمزِ غلط، هرچند بار تکرار شود، یک حدس است** — همان درسِ
//  `admin-gate.js`: گوشیِ کلیدمرده هر چند ثانیه دوباره وصل می‌شود و اگر هر
//  تلاش شمرده می‌شد، همان گوشی سقف را برای همیشه پر نگه می‌داشت.
//  ⛔ **رمزِ درست هیچ‌وقت ۴۲۹ نمی‌گیرد** — سقف فقط جلوی حدس است، نه جلوی صاحبش.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import { clientIp } from '../platform/security.js';

export function createWsGate({ name = 'ws', max = 20, windowMs = 60_000 } = {}) {
  /** ip ⇒ Map(اثرِ رمز ⇒ زمان) */
  const guesses = new Map();

  function prune(map, now) {
    for (const [k, t] of map) if (t <= now - windowMs) map.delete(k);
  }

  function tokenOf(req) {
    let url = null;
    try { url = new URL(req.url, 'http://x'); } catch { /* مسیر خراب */ }
    const t = url?.searchParams.get('token')
      || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const where = url?.searchParams.get('station') || url?.searchParams.get('code')
      || url?.searchParams.get('pump') || url?.searchParams.get('site') || '';
    return createHash('sha256').update(where + '\u0000' + t).digest('hex').slice(0, 24);
  }

  /** این IP از سقفِ حدس گذشته؟ (پس از ثبتِ همین تلاش) */
  function failed(req) {
    const ip = clientIp(req);
    const now = Date.now();
    let m = guesses.get(ip);
    if (!m) { m = new Map(); guesses.set(ip, m); }
    prune(m, now);
    const key = tokenOf(req);
    const seen = m.has(key);
    if (!seen && m.size >= max) {
      const oldest = Math.min(...m.values());
      return { blocked: true, retryAfter: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
    }
    m.set(key, now);
    if (guesses.size > 50_000) for (const [k, v] of guesses) { prune(v, now); if (!v.size) guesses.delete(k); }
    return { blocked: false, retryAfter: 0 };
  }

  /** پاسخِ HTTP پیش از ارتقا — هیچ وب‌سوکتی ساخته نمی‌شود */
  function refuse(socket, retryAfter) {
    try {
      socket.write(`HTTP/1.1 429 Too Many Requests\r\nRetry-After: ${retryAfter}\r\n`
        + 'Connection: close\r\nContent-Length: 0\r\n\r\n');
    } catch { /* بسته شد */ }
    try { socket.destroy(); } catch { /* بسته شد */ }
  }

  /**
   * ‎route(req) ⇒ { ok, … }‎ پیش از ارتقا؛ ‎onOk(ws, r)‎ پس از ارتقای درست؛
   * ‎onBad(ws, r)‎ برای رمزِ غلطِ زیرِ سقف.
   */
  function handle(wss, req, socket, head, route, onOk, onBad) {
    const r = route(req);
    if (r.ok) return wss.handleUpgrade(req, socket, head, (ws) => onOk(ws, r));
    const f = failed(req);
    if (f.blocked) return refuse(socket, f.retryAfter);
    return wss.handleUpgrade(req, socket, head, (ws) => onBad(ws, r));
  }

  return { handle, failed, stats: () => ({ name, ips: guesses.size }) };
}
