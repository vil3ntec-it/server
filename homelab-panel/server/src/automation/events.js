// ---------------------------------------------------------------------------
//  رویدادهای اتوماسیون — «چیزی اتفاق افتاد، هر کاری که به آن گوش می‌دهد بدود»
//
//  این فایل عمداً سبک است و جز دیتابیس چیزی وارد نمی‌کند: routes/auth.js و
//  metrics و agent همه از این‌جا رویداد می‌دهند و اگر این فایل خودِ موتور را
//  وارد می‌کرد، حلقهٔ وابستگی درست می‌شد.
//
//  پرامپت (بخشِ ۱۰.۱) Redis Pub/Sub می‌گوید؛ این‌جا یک پروسه است و
//  EventEmitter همان کار را بی هیچ سرویسِ اضافه می‌کند. هر رویداد در جدول
//  automation_events هم می‌نشیند تا در پنل دیده شود که چه شد و کِی.
// ---------------------------------------------------------------------------
import { EventEmitter } from 'node:events';
import { db } from '../db.js';

export const automationEvents = new EventEmitter();
automationEvents.setMaxListeners(50);

/** رویدادهایی که سرچشمهٔ واقعی دارند */
export const KNOWN_EVENTS = Object.freeze({
  'service.down': 'سرویس یا سایتی که باید بالا باشد، پایین است',
  'disk.high': 'دیسک از آستانهٔ هشدار پر‌تر شده',
  'backup.failed': 'یک پشتیبان ناموفق ماند',
  'backup.done': 'یک پشتیبان ساخته شد (ورودیِ ارسال به خارجِ سرور)',
  'login.suspicious': 'رگبارِ ورودِ ناموفق یا ورود از IPِ تازه',
  'temp.high': 'دمای پردازنده از آستانه گذشت',
});

const KEEP_EVENTS = 500;
let insert = null;
let pruneStmt = null;

function statements() {
  if (insert) return;
  insert = db.prepare('INSERT INTO automation_events(name, source, payload, at) VALUES(?, ?, ?, ?)');
  pruneStmt = db.prepare(
    `DELETE FROM automation_events WHERE id NOT IN (SELECT id FROM automation_events ORDER BY id DESC LIMIT ${KEEP_EVENTS})`
  );
}

/**
 * یک رویداد می‌دهد. برمی‌گرداند شمارهٔ ردیفِ ثبت‌شده.
 * @param {string} name       مثلِ service.down
 * @param {object} payload    هر چیزی که شنونده لازم دارد (slug، ip، usage…)
 * @param {string} source     چه کسی گفت (monitor، metrics، auth، guard، job:<name>)
 */
export function emit(name, payload = {}, source = 'system') {
  const at = Date.now();
  let id = null;
  try {
    statements();
    const info = insert.run(String(name).slice(0, 60), String(source).slice(0, 60), JSON.stringify(payload ?? {}).slice(0, 4000), at);
    id = Number(info.lastInsertRowid);
    if (id % 50 === 0) pruneStmt.run();
  } catch { /* دفتر نباید جلوی خودِ رویداد را بگیرد */ }
  const event = { id, name, payload: payload ?? {}, source, at };
  // یک شنوندهٔ سراسری برای موتور، و یک شنونده به نامِ خودِ رویداد برای هر کسِ دیگر
  automationEvents.emit('event', event);
  automationEvents.emit(name, event);
  return event;
}

export function recentEvents({ limit = 100, name = null } = {}) {
  const n = Math.min(500, Math.max(1, Number(limit) || 100));
  const rows = name
    ? db.prepare('SELECT * FROM automation_events WHERE name = ? ORDER BY id DESC LIMIT ?').all(String(name), n)
    : db.prepare('SELECT * FROM automation_events ORDER BY id DESC LIMIT ?').all(n);
  return rows.map((r) => {
    let payload = {};
    try { payload = JSON.parse(r.payload || '{}'); } catch { /* خراب */ }
    return { id: r.id, name: r.name, source: r.source, payload, at: r.at };
  });
}
