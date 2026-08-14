// ═══════════════════════════════════════════════════════════════════════════
//  حافظهٔ کاربر
//
//  سه قاعده که این حافظه را از «جاسوسی» جدا می‌کند:
//    ۱) فقط ترجیحات — نه دادهٔ مالی، نه عدد، نه نام.
//    ۲) هرچه از redact رد نشود اصلاً وارد نمی‌شود.
//    ۳) کاربر همیشه می‌تواند ببیند و پاک کند.
//
//  و مهم‌تر: این حافظه در پوشهٔ خودِ سرویس است، نه در دیتابیسِ برنامه. حتی
//  نوشتنِ حافظه هم به دادهٔ اصلی دست نمی‌زند.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import config, { DATA_DIR } from '../config.js';
import { assertWritable, safeJoin } from '../security/guard.js';
import { containsSecret, redactText } from '../security/redact.js';

const MEM_DIR = path.join(DATA_DIR, 'memory');

/** کلیدهایی که اجازهٔ ذخیره شدن دارند — هر چیزِ دیگری رد می‌شود */
const ALLOWED_KEYS = new Set([
  'language',        // زبانِ ترجیحی
  'tone',            // لحنِ پاسخ: کوتاه یا کامل
  'role_hint',       // «من کارمندم» — فقط برای لحن، نه برای دسترسی
  'frequent_section',// بخشی که زیاد سراغش می‌رود
  'device',          // گوشی یا کامپیوتر
  'note',            // یادداشتِ آزادِ کوتاه
]);

function fileFor(user) {
  // نامِ فایل از هشِ کاربر ساخته می‌شود، نه از خودِ شناسه: هم مسیرپیمایی ممکن
  // نیست، هم فهرستِ پوشه چیزی دربارهٔ کاربران لو نمی‌دهد
  const h = crypto.createHash('sha256').update(String(user || 'anon')).digest('hex').slice(0, 24);
  return safeJoin(MEM_DIR, `${h}.json`);
}

function read(user) {
  try {
    const p = fileFor(user);
    if (!fs.existsSync(p)) return [];
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(data?.items) ? data.items : [];
  } catch {
    return [];
  }
}

function write(user, items) {
  const p = assertWritable(fileFor(user));
  fs.mkdirSync(MEM_DIR, { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ updated: new Date().toISOString(), items }), { mode: 0o600 });
}

/** آنچه در prompt می‌نشیند */
export function getMemory(user) {
  if (!config.memory.enabled) return [];
  return read(user);
}

/**
 * ذخیرهٔ یک ترجیح.
 * @returns {{ok: boolean, reason?: string}}
 */
export function rememberFact(user, key, value) {
  if (!config.memory.enabled) return { ok: false, reason: 'حافظه خاموش است' };

  const k = String(key || '').trim().toLowerCase();
  if (!ALLOWED_KEYS.has(k)) {
    return { ok: false, reason: `کلیدِ «${k}» اجازهٔ ذخیره ندارد. فقط: ${[...ALLOWED_KEYS].join('، ')}` };
  }

  const raw = String(value || '').trim().slice(0, config.memory.maxValueChars);
  if (!raw) return { ok: false, reason: 'مقدار خالی است' };

  // قاعدهٔ ۲ — چیزی که بوی راز بدهد اصلاً وارد نمی‌شود
  if (containsSecret(raw)) return { ok: false, reason: 'این مقدار شبیهِ رمز یا کلید است و ذخیره نمی‌شود' };

  const items = read(user).filter(i => i.key !== k);
  items.push({ key: k, value: redactText(raw), at: new Date().toISOString() });

  while (items.length > config.memory.maxItems) items.shift();
  write(user, items);
  return { ok: true };
}

/** کاربر حافظهٔ خودش را پاک می‌کند */
export function forgetMemory(user, key = null) {
  if (!config.memory.enabled) return { ok: true, removed: 0 };
  const items = read(user);
  if (!key) {
    try {
      const p = fileFor(user);
      if (fs.existsSync(p)) fs.unlinkSync(assertWritable(p));
    } catch { /* نبودنش هم یعنی پاک است */ }
    return { ok: true, removed: items.length };
  }
  const k = String(key).toLowerCase();
  const kept = items.filter(i => i.key !== k);
  write(user, kept);
  return { ok: true, removed: items.length - kept.length };
}

export { ALLOWED_KEYS };
