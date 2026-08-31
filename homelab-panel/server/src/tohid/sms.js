// ---------------------------------------------------------------------------
//  فرستادنِ پیامک
//
//  هیچ سرویسِ خاصی اینجا سیم‌کشی نشده، چون سرویسِ پیامکِ هر کشور و هر
//  فروشنده فرق دارد و حدس زدنش یعنی چیزی که روی کاغذ کار می‌کند و در
//  عمل نه. به‌جایش، هر دروازه‌ای که با یک درخواستِ HTTP کار کند پشتیبانی
//  می‌شود: نشانی، روش، سربرگ‌ها و قالبِ بدنه را خودِ مدیر می‌دهد.
//
//  دو جای‌گیر در قالب پر می‌شوند: {to} شمارهٔ گیرنده و {text} متنِ پیام.
//  هر دو برای امن بودن در JSON، رشته‌ای escape می‌شوند.
// ---------------------------------------------------------------------------
import { readTohidSettings, smsToken } from './settings.js';

const TIMEOUT_MS = 15000;

/** جای‌گیرها را پر می‌کند. در قالبِ JSON، مقدارها escape می‌شوند. */
export function fillTemplate(template, { to, text }, forJson = true) {
  const esc = (v) => (forJson ? JSON.stringify(String(v)).slice(1, -1) : String(v));
  return String(template || '')
    .replaceAll('{to}', esc(to))
    .replaceAll('{text}', esc(text));
}

function parseHeaders(raw) {
  const out = {};
  for (const line of String(raw || '').split('\n')) {
    const at = line.indexOf(':');
    if (at < 1) continue;
    const name = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}

/**
 * فرستادنِ یک پیامک.
 *
 * اگر دروازه تنظیم نشده باشد، صریح می‌گوید — نه اینکه وانمود کند فرستاده
 * شد. کاربری که منتظرِ کدی است که هرگز نمی‌آید، بدترین حالت است.
 */
export async function sendSms({ to, text }) {
  const cfg = readTohidSettings();
  const sms = cfg.sms || {};

  if (!sms.enabled) {
    throw Object.assign(
      new Error('فرستادن پیامک تنظیم نشده است. در پنل، بخش توحید ← کد ورود، دروازهٔ پیامک را تنظیم کنید.'),
      { code: 'sms_unavailable' },
    );
  }
  if (!/^https?:\/\//i.test(sms.url || '')) {
    throw Object.assign(new Error('نشانی دروازهٔ پیامک درست نیست'), { code: 'sms_bad_url' });
  }

  const method = (sms.method || 'POST').toUpperCase();
  const headers = parseHeaders(sms.headers);
  const token = smsToken();
  if (token && sms.headers && sms.headers.includes('{token}')) {
    for (const [k, v] of Object.entries(headers)) headers[k] = v.replaceAll('{token}', token);
  }

  let url = fillTemplate(sms.url, { to, text }, false);
  if (token) url = url.replaceAll('{token}', encodeURIComponent(token));

  const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) };

  if (method !== 'GET' && method !== 'HEAD') {
    const body = fillTemplate(sms.body, { to, text }, (sms.contentType || 'json') === 'json');
    init.body = token ? body.replaceAll('{token}', token) : body;
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      init.headers['Content-Type'] =
        (sms.contentType || 'json') === 'json' ? 'application/json' : 'application/x-www-form-urlencoded';
    }
  }

  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw Object.assign(
      new Error(`دروازهٔ پیامک جواب نداد: ${e.name === 'TimeoutError' ? 'زمان تمام شد' : e.message}`),
      { code: 'sms_network' },
    );
  }

  const reply = (await res.text().catch(() => '')).slice(0, 400);
  if (!res.ok) {
    throw Object.assign(
      new Error(`دروازهٔ پیامک خطا داد (${res.status})${reply ? ': ' + reply : ''}`),
      { code: 'sms_rejected' },
    );
  }
  return { ok: true, reply };
}

/** آیا پیامک آمادهٔ کار است؟ — برای نمایش در پنل */
export function smsReady() {
  const sms = readTohidSettings().sms || {};
  return Boolean(sms.enabled && /^https?:\/\//i.test(sms.url || ''));
}
