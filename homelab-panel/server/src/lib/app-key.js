// ═══════════════════════════════════════════════════════════════════════════
//  کلیدها و رمزهای «فقط سنجیدنی» روی دیسک فقط هش‌اند (C-04 و C-05، ممیزیِ رازهای در حالِ سکون، ۱.۵۳.۳)
//
//  کلیدِ برنامه‌ها (‎code_apps.api_key‎ و ‎app_clients.api_key‎) و رمزِ نوشتن/خواندنِ موضوع‌های اعلان
//  (‎ntf_topics.write_token/read_token‎) را فقط کسی که بیرون است می‌فرستد و پنل فقط می‌سنجد؛ هیچ مسیری خامِ آن‌ها را
//  بعداً لازم ندارد (فرستندهٔ درونی ِ اعلان از درِ مطمئنِ ‎publish(…, { trusted })‎ می‌آید). پس به‌جای رمزنگاری با کلیدِ
//  گاوصندوق، هشِ یک‌طرفه: پشتیبانِ ‎panel.db‎ یا جابه‌جایی به کامپیوترِ دیگر بی ‎vault.key‎ هم کلیدها را نمی‌شکند و لو
//  هم نمی‌دهد. کلیدها تصادفی و بلندند (۱۲۸–۱۶۰ بیت؛ رمزِ موضوع ۹۶+ بیت) ⇒ SHA-256 ِ برچسب‌دار بس است (کندی لازم نیست).
//
//  ⛔ مقایسه همیشه ثابت‌زمان (‎sameSecret‎ روی دو هش). ⛔ مقدارِ خامِ کهنه هرگز پذیرفته نیست: مهاجرت‌های ۰۱۶ و ۰۱۷ پیش از
//  نخستین درخواست ردیف‌های کهنه را در جا هش می‌کنند (همان کلید، بی صدورِ دوباره).
// ═══════════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import { sameSecret } from './secret-compare.js';

export const HASH_PREFIX = 'sha256:';
export const isHashed = (v) => typeof v === 'string' && v.startsWith(HASH_PREFIX);

/** ‎label‎ دامنهٔ هش را جدا می‌کند (کلیدِ برنامه با رمزِ موضوع هم‌ارز نمی‌شود) */
export function hashSecret(label, raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  return HASH_PREFIX + crypto.createHash('sha256').update(`${label}:v1:${s}`).digest('hex');
}

/** آیا ‎given‎ (خام، از بیرون) با ‎stored‎ (هشِ روی دیسک) یکی است؟ — فقط هش پذیرفته، ثابت‌زمان */
export function matchesHash(label, given, stored) {
  if (!isHashed(stored)) return false;
  const h = hashSecret(label, given);
  return Boolean(h) && sameSecret(h, stored);
}

/* ── کلیدِ برنامه ───────────────────────────────────────────────────────── */
export const APP_KEY = 'panel-app-key';
export const hashAppKey = (raw) => hashSecret(APP_KEY, raw);
export const appKeyMatches = (given, stored) => matchesHash(APP_KEY, given, stored);
/** نشانه برای فهرست («code_1a2b…»): پیشوند و چهار نویسه — برای شناختن، نه ساختن (۱۶ بیت از ۱۶۰) */
export const appKeyHint = (raw) => {
  const s = String(raw ?? '');
  const m = /^([a-z]+_)/.exec(s);
  return s ? s.slice(0, (m ? m[1].length : 0) + 4) : null;
};

/* ── رمزِ موضوعِ اعلان ──────────────────────────────────────────────────── */
export const TOPIC_TOKEN = 'ntf-topic-token';
export const hashTopicToken = (raw) => hashSecret(TOPIC_TOKEN, raw);
export const topicTokenMatches = (given, stored) => matchesHash(TOPIC_TOKEN, given, stored);
