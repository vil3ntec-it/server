// ---------------------------------------------------------------------------
//  تنظیماتِ بخشِ توحید
//
//  رمزِ ایمیل داخلِ گاوصندوق می‌نشیند، نه در جدولِ تنظیمات — و هیچ‌وقت به
//  رابط کاربری برنمی‌گردد. بقیهٔ تنظیمات ساده‌اند و در settings می‌مانند.
// ---------------------------------------------------------------------------
import { getSetting, setSetting } from '../db.js';
import { putSecret, readSecret, listSecrets, deleteSecret } from '../control/vault.js';

const MAIL_SECRET = 'tohid_smtp_password';
const SMS_SECRET = 'tohid_sms_token';
const KEY = 'tohid_settings';

const DEFAULTS = {
  enabled: false,
  serverToken: '',          // رمزی که برنامه هنگام اتصالِ WebSocket می‌دهد
  otpTtlSeconds: 300,
  resendSeconds: 60,
  maxTries: 5,
  mail: { host: '', port: 465, secure: true, user: '', from: '', fromName: 'مرکز فرمان' },
  // دروازهٔ پیامک — هر سرویسی که با یک درخواستِ HTTP کار کند
  sms: {
    enabled: false,
    url: '',
    method: 'POST',
    contentType: 'json',
    headers: '',
    body: '{"to":"{to}","message":"{text}"}',
  },
  otpMessage: 'کد ورود شما: {code}',
  currency: 'افغانی',
  whatsapp: '',
  purchaseMessage: 'سلام، می‌خواهم اشتراک برنامه توحید را بخرم.',
};

export function readTohidSettings() {
  let saved = {};
  try {
    saved = JSON.parse(getSetting(KEY, '{}')) || {};
  } catch { saved = {}; }
  return {
    ...DEFAULTS, ...saved,
    mail: { ...DEFAULTS.mail, ...(saved.mail || {}) },
    sms: { ...DEFAULTS.sms, ...(saved.sms || {}) },
  };
}

/** نسخهٔ قابلِ نمایش — رمز هرگز داخلش نیست */
export function publicTohidSettings() {
  const s = readTohidSettings();
  return {
    ...s,
    serverToken: s.serverToken ? `••••${s.serverToken.slice(-4)}` : '',
    mail: { ...s.mail, passwordSet: Boolean(mailPassword()) },
    sms: { ...s.sms, tokenSet: Boolean(smsToken()) },
  };
}

export function writeTohidSettings(patch = {}) {
  const current = readTohidSettings();
  const next = {
    ...current,
    ...patch,
    mail: { ...current.mail, ...(patch.mail || {}) },
    sms: { ...current.sms, ...(patch.sms || {}) },
  };
  // رمز و توکن از این مسیر ذخیره نمی‌شوند
  if (next.mail) delete next.mail.password;
  if (next.sms) delete next.sms.token;
  setSetting(KEY, JSON.stringify(next));
  return publicTohidSettings();
}

export function setMailPassword(password, actor = 'admin') {
  const existing = listSecrets({ scope: 'global' }).find((s) => s.name === MAIL_SECRET);
  if (existing) deleteSecret(existing.id, actor);
  if (!password) return { ok: true, cleared: true };
  putSecret({
    name: MAIL_SECRET, kind: 'api_key', scope: 'global', value: password,
    note: 'رمز ایمیل برای فرستادن کد ورود برنامهٔ توحید', actor,
  });
  return { ok: true };
}

export function mailPassword() {
  const row = listSecrets({ scope: 'global' }).find((s) => s.name === MAIL_SECRET);
  return row ? readSecret(row.id) : null;
}

/** تنظیماتِ کاملِ ایمیل، همراه با رمز — فقط برای فرستادن */
export function mailSettings() {
  const s = readTohidSettings();
  return { ...s.mail, pass: mailPassword() || '' };
}

/**
 * توکنِ دروازهٔ پیامک — مثل رمزِ ایمیل، در گاوصندوق می‌ماند و هرگز به
 * رابط کاربری برنمی‌گردد. در نشانی و سربرگ و بدنه با {token} صدا زده می‌شود.
 */
export function setSmsToken(token, actor = 'admin') {
  const existing = listSecrets({ scope: 'global' }).find((s) => s.name === SMS_SECRET);
  if (existing) deleteSecret(existing.id, actor);
  if (!token) return { ok: true, cleared: true };
  putSecret({
    name: SMS_SECRET, kind: 'api_key', scope: 'global', value: token,
    note: 'توکن دروازهٔ پیامک برای فرستادن کد ورود برنامهٔ توحید', actor,
  });
  return { ok: true };
}

export function smsToken() {
  const row = listSecrets({ scope: 'global' }).find((s) => s.name === SMS_SECRET);
  return row ? readSecret(row.id) : null;
}
