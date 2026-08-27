// ---------------------------------------------------------------------------
//  تنظیماتِ بخشِ توحید
//
//  رمزِ ایمیل داخلِ گاوصندوق می‌نشیند، نه در جدولِ تنظیمات — و هیچ‌وقت به
//  رابط کاربری برنمی‌گردد. بقیهٔ تنظیمات ساده‌اند و در settings می‌مانند.
// ---------------------------------------------------------------------------
import { getSetting, setSetting } from '../db.js';
import { putSecret, readSecret, listSecrets, deleteSecret } from '../control/vault.js';

const MAIL_SECRET = 'tohid_smtp_password';
const KEY = 'tohid_settings';

const DEFAULTS = {
  enabled: false,
  serverToken: '',          // رمزی که برنامه هنگام اتصالِ WebSocket می‌دهد
  otpTtlSeconds: 300,
  resendSeconds: 60,
  maxTries: 5,
  mail: { host: '', port: 465, secure: true, user: '', from: '', fromName: 'مرکز فرمان' },
  currency: 'افغانی',
  whatsapp: '',
  purchaseMessage: 'سلام، می‌خواهم اشتراک برنامه توحید را بخرم.',
};

export function readTohidSettings() {
  let saved = {};
  try {
    saved = JSON.parse(getSetting(KEY, '{}')) || {};
  } catch { saved = {}; }
  return { ...DEFAULTS, ...saved, mail: { ...DEFAULTS.mail, ...(saved.mail || {}) } };
}

/** نسخهٔ قابلِ نمایش — رمز هرگز داخلش نیست */
export function publicTohidSettings() {
  const s = readTohidSettings();
  return {
    ...s,
    serverToken: s.serverToken ? `••••${s.serverToken.slice(-4)}` : '',
    mail: { ...s.mail, passwordSet: Boolean(mailPassword()) },
  };
}

export function writeTohidSettings(patch = {}) {
  const current = readTohidSettings();
  const next = {
    ...current,
    ...patch,
    mail: { ...current.mail, ...(patch.mail || {}) },
  };
  // رمز از این مسیر ذخیره نمی‌شود
  if (next.mail) delete next.mail.password;
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
