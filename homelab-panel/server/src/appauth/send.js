// ---------------------------------------------------------------------------
//  رساندنِ کدِ شش‌رقمی به دستِ کاربر
//
//  دو راه دارد و هر دو اختیاری است:
//    • پیامک  → کاوه‌نگار، sms.ir، ملی‌پیامک، قاصدک، یا «هر سرویسِ دیگر» (webhook)
//    • ایمیل  → هر SMTP‌ای (جی‌میل، یاهو، میل‌سرورِ خودتان)
//
//  اگر هیچ‌کدام تنظیم نشده باشد، کد در لاگِ پنل نوشته می‌شود تا کارتان نخوابد:
//  خودتان کد را می‌بینید و همان لحظه می‌توانید تست کنید.
// ---------------------------------------------------------------------------
import { logEvent } from '../db.js';
import { sendMail } from './smtp.js';
import { otpEmail } from '../emails/otp.js';

/** {code} و {app} و {to} را در متن جای‌گذاری می‌کند */
export function fill(template, values) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, key) =>
    values[key] === undefined || values[key] === null ? m : String(values[key])
  );
}

/** شمارهٔ محلیِ ایران برای سرویس‌های ایرانی: +989121234567 → 09121234567 */
export function localPhone(e164) {
  const s = String(e164 || '');
  if (s.startsWith('+98')) return '0' + s.slice(3);
  if (s.startsWith('+')) return s;
  return s;
}

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`سرویسِ پیامک ${res.status} داد: ${text.slice(0, 300)}`);
  return text;
}

// ---------------------------- سرویس‌های پیامک ------------------------------
const SMS_PROVIDERS = {
  /** کاوه‌نگار — اگر template بگذارید از «لوکاپ» (تأییدیه) استفاده می‌شود */
  async kavenegar({ sms, to, code, text }) {
    if (!sms.apiKey) throw new Error('کلیدِ کاوه‌نگار (OTP_SMS_KEY) خالی است');
    const receptor = localPhone(to);
    const url = sms.template
      ? `https://api.kavenegar.com/v1/${sms.apiKey}/verify/lookup.json?receptor=${encodeURIComponent(receptor)}&token=${encodeURIComponent(code)}&template=${encodeURIComponent(sms.template)}`
      : `https://api.kavenegar.com/v1/${sms.apiKey}/sms/send.json?receptor=${encodeURIComponent(receptor)}&message=${encodeURIComponent(text)}${sms.sender ? `&sender=${encodeURIComponent(sms.sender)}` : ''}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const body = await res.text();
    if (!res.ok) throw new Error(`کاوه‌نگار ${res.status} داد: ${body.slice(0, 300)}`);
    return body;
  },

  /** sms.ir نسخهٔ ۱ — با «قالبِ تأیید» (templateId عددی) */
  async smsir({ sms, to, code, text }) {
    if (!sms.apiKey) throw new Error('کلیدِ sms.ir (OTP_SMS_KEY) خالی است');
    const mobile = localPhone(to);
    if (sms.template) {
      return postJson(
        'https://api.sms.ir/v1/send/verify',
        { mobile, templateId: Number(sms.template), parameters: [{ name: 'CODE', value: String(code) }] },
        { 'x-api-key': sms.apiKey, Accept: 'text/plain' }
      );
    }
    return postJson(
      'https://api.sms.ir/v1/send/bulk',
      { lineNumber: sms.sender, messageText: text, mobiles: [mobile] },
      { 'x-api-key': sms.apiKey, Accept: 'text/plain' }
    );
  },

  /** ملی‌پیامک — با bodyId (قالب) یا ارسالِ ساده */
  async melipayamak({ sms, to, code, text }) {
    const to0 = localPhone(to);
    if (sms.template) {
      return postJson('https://rest.payamak-panel.com/api/SendSMS/BaseServiceNumber', {
        username: sms.username,
        password: sms.password,
        text: String(code),
        to: to0,
        bodyId: Number(sms.template),
      });
    }
    return postJson('https://rest.payamak-panel.com/api/SendSMS/SendSMS', {
      username: sms.username,
      password: sms.password,
      to: to0,
      from: sms.sender,
      text,
      isflash: false,
    });
  },

  /** قاصدک */
  async ghasedak({ sms, to, code, text }) {
    if (!sms.apiKey) throw new Error('کلیدِ قاصدک (OTP_SMS_KEY) خالی است');
    const receptor = localPhone(to);
    const form = new URLSearchParams(
      sms.template
        ? { receptor, type: '1', template: sms.template, param1: String(code) }
        : { receptor, message: text, linenumber: sms.sender || '' }
    );
    const url = sms.template
      ? 'https://api.ghasedak.me/v2/verification/send'
      : 'https://api.ghasedak.me/v2/sms/send/simple';
    const res = await fetch(url, {
      method: 'POST',
      headers: { apikey: sms.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(20000),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`قاصدک ${res.status} داد: ${body.slice(0, 300)}`);
    return body;
  },

  /**
   * هر سرویسِ دیگری در دنیا — فقط آدرس و قالبِ بدنه را بدهید:
   *   OTP_SMS_URL=https://example.com/send
   *   OTP_SMS_BODY={"to":"{to}","text":"{text}"}
   *   OTP_SMS_HEADERS={"Authorization":"Bearer xyz"}
   * جاهای {to} {code} {text} {sender} خودشان پر می‌شوند.
   */
  async webhook({ sms, to, code, text }) {
    if (!sms.url) throw new Error('آدرسِ سرویس (OTP_SMS_URL) خالی است');
    const values = { to, to0: localPhone(to), code, text, sender: sms.sender || '' };
    let headers = {};
    try {
      headers = sms.headers ? (typeof sms.headers === 'string' ? JSON.parse(sms.headers) : sms.headers) : {};
    } catch {
      throw new Error('OTP_SMS_HEADERS باید JSON درست باشد');
    }
    const url = fill(sms.url, { ...values, to: encodeURIComponent(to), to0: encodeURIComponent(values.to0), text: encodeURIComponent(text) });
    const method = (sms.method || 'POST').toUpperCase();
    if (method === 'GET') {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
      const body = await res.text();
      if (!res.ok) throw new Error(`سرویسِ پیامک ${res.status} داد: ${body.slice(0, 300)}`);
      return body;
    }
    const raw = fill(sms.body || '{"to":"{to}","text":"{text}"}', values);
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: raw,
      signal: AbortSignal.timeout(20000),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`سرویسِ پیامک ${res.status} داد: ${body.slice(0, 300)}`);
    return body;
  },
};

export const smsProviders = Object.keys(SMS_PROVIDERS);

// -------------------------------- ایمیل ------------------------------------
//  قالب در src/emails/otp.js است — همان قالبی که بخشِ فروشگاه هم می‌فرستد،
//  تا کاربر از هر دو راه یک ایمیلِ یکسان ببیند و اصلاح در یک جا کافی باشد.

// ------------------------------ نقطهٔ ورود ---------------------------------
/**
 * کد را می‌فرستد و می‌گوید از چه راهی رفت.
 * هیچ‌وقت خطا پرتاب نمی‌کند؛ نتیجه را برمی‌گرداند تا مسیرِ API تصمیم بگیرد.
 */
export async function deliverCode({ channel, to, code, settings }) {
  const appName = settings.appName || '';
  const minutes = Math.max(1, Math.round(settings.codeTtlSeconds / 60));
  const text = fill(settings.smsText, { code, app: appName, to });

  if (channel === 'sms') {
    const provider = (settings.sms.provider || 'none').toLowerCase();
    if (provider === 'none' || !SMS_PROVIDERS[provider]) {
      return fallback('sms', to, code, provider === 'none' ? null : `سرویسِ «${provider}» را نمی‌شناسم`);
    }
    try {
      await SMS_PROVIDERS[provider]({ sms: settings.sms, to, code, text });
      logEvent('info', 'panel', `کد ورود با پیامک (${provider}) به ${mask(to)} رفت`);
      return { sent: true, via: provider, channel: 'sms' };
    } catch (e) {
      logEvent('error', 'panel', `پیامکِ کد ورود به ${mask(to)} نرفت: ${e.message}`);
      return { sent: false, via: provider, channel: 'sms', error: e.message };
    }
  }

  if (channel === 'email') {
    const provider = (settings.email.provider || 'none').toLowerCase();
    if (provider !== 'smtp' || !settings.email.host) {
      return fallback('email', to, code, provider === 'none' ? null : 'آدرسِ سرورِ ایمیل خالی است');
    }
    try {
      const mail = otpEmail({ code, minutes, appName: appName || 'کد ورود' });
      await sendMail({
        host: settings.email.host,
        port: Number(settings.email.port) || 465,
        secure: settings.email.secure !== false,
        username: settings.email.username,
        password: settings.email.password,
        from: settings.email.from || settings.email.username,
        fromName: settings.email.fromName || appName,
        rejectUnauthorized: settings.email.rejectUnauthorized !== false,
        to,
        // اگر کاربر عنوانِ خودش را نوشته، همان؛ وگرنه عنوانِ خودِ قالب
        subject: settings.emailSubject
          ? fill(settings.emailSubject, { code, app: appName })
          : mail.subject,
        text: mail.text,
        html: mail.html,
      });
      logEvent('info', 'panel', `کد ورود با ایمیل به ${mask(to)} رفت`);
      return { sent: true, via: 'smtp', channel: 'email' };
    } catch (e) {
      logEvent('error', 'panel', `ایمیلِ کد ورود به ${mask(to)} نرفت: ${e.message}`);
      return { sent: false, via: 'smtp', channel: 'email', error: e.message };
    }
  }

  return { sent: false, via: 'none', channel, error: 'راهِ نامعتبر' };
}

/** وقتی هیچ سرویسی تنظیم نشده: کد را جایی می‌نویسیم که صاحبِ سرور ببیند */
function fallback(channel, to, code, error) {
  const how = channel === 'sms' ? 'پیامک' : 'ایمیل';
  logEvent(
    'warn',
    'panel',
    `${how} تنظیم نشده است — کد ورودِ ${mask(to)} این است: ${code} ` +
      '(برای فرستادنِ واقعی، در پنل یا فایل .env سرویسِ پیامک/ایمیل را بگذارید)'
  );
  console.log(`\n📮 کد ورود برای ${to}  →  ${code}   (${how} هنوز تنظیم نشده)\n`);
  return { sent: false, via: 'panel', channel, needsSetup: true, error: error || null };
}

/** برای لاگ: 0912***4567 — شماره و ایمیلِ کامل در لاگ نمی‌ماند */
export function mask(value) {
  const s = String(value || '');
  if (s.includes('@')) {
    const [name, domain] = s.split('@');
    return `${name.slice(0, 2)}***@${domain}`;
  }
  return s.length > 7 ? `${s.slice(0, 5)}***${s.slice(-3)}` : s;
}
