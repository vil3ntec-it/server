// ---------------------------------------------------------------------------
//  بایگانیِ دفترِ رخداد پیش از هرس (۱.۵۰.۷۱، S9 ِ ممیزیِ پنلِ مرکزی)
//
//  ⛔ تا ۱.۵۰.۷۰ هرسِ ربع‌ساعته ردیف‌های قدیمی‌ترِ `audit_log` و `cc_audit` را **پاک** می‌کرد، بی هیچ
//  خروجی. هر واردشده‌ای با یک سیلِ ارزان (۴۰۳های پشتِ هم، تلاش‌های ردشده) ۲۰ هزار ردیف می‌ساخت و
//  ردِ کارِ پیشین را از دفتر بیرون می‌راند. حالا:
//
//    • ردیف‌هایی که بیرون می‌روند اول به `data/audit-archive/<دفتر>-<سال-ماه>.jsonl` افزوده می‌شوند
//      (فقط افزودن، 0600، یک خط JSON برای هر ردیف با همهٔ ستون‌ها)؛
//    • ⛔ اگر نوشتن نشد (دیسک پر، دسترسی) **هیچ** ردیفی پاک نمی‌شود — دفتر بزرگ‌تر می‌ماند، نه کوتاه‌تر؛
//    • تکه‌تکه (۵۰۰۰ ردیف) تا یک سیلِ بزرگ حافظه را نبرد؛
//    • سقفِ کلِ بایگانی `HLP_AUDIT_ARCHIVE_MAX_MB` (پیش‌فرض ۲۵۶): فقط کهنه‌ترین پرونده‌ها، هرگز پروندهٔ
//      همین ماه. یعنی بیرون راندنِ یک ردیف دیگر ۲۰ هزار نه، صدها هزار ردیف و ساعت‌ها سیلِ دیده‌شده می‌خواهد.
//
//  ⚠️ هیچ درِ HTTPی این پوشه را نمی‌خواند یا پاک نمی‌کند؛ `GET /api/audit` فقط نام و اندازهٔ پرونده‌ها را
//  می‌گوید. مدیری که ترمینال یا پوشهٔ داده را دارد همچنان به آن دست می‌رسد — گزارشِ ممیزیِ ۱.۵۰.۷۱.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const CHUNK = 5000;
const NAME_RE = /^(audit_log|cc_audit)-\d{4}-\d{2}\.jsonl$/;

export function archiveDir() {
  return path.join(config.dataDir, 'audit-archive');
}

function monthOf(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function capBytes() {
  const mb = Number(process.env.HLP_AUDIT_ARCHIVE_MAX_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 256) * 1024 * 1024;
}

/**
 * همهٔ ردیف‌های `table` جز `keep` تای تازه‌تر را بایگانی و سپس پاک می‌کند.
 * `table` فقط از فهرستِ ثابتِ همین فایل است (نامِ جدول از بیرون نمی‌آید).
 * @returns {{ archived: number, file: string|null }}
 */
export function archiveAndPrune(db, table, keep) {
  if (table !== 'audit_log' && table !== 'cc_audit') throw new Error('bad_table');
  const k = Math.max(0, Math.floor(Number(keep) || 0));
  //  کوچک‌ترین id ِ ماندنی؛ هر چه کوچک‌تر از آن است بیرون می‌رود
  const cutRow = k > 0
    ? db.prepare(`SELECT id FROM ${table} ORDER BY id DESC LIMIT 1 OFFSET ?`).get(k - 1)
    : db.prepare(`SELECT MAX(id) + 1 AS id FROM ${table}`).get();
  const cut = cutRow?.id;
  if (cut == null) return { archived: 0, file: null };
  const dir = archiveDir();
  const file = path.join(dir, `${table}-${monthOf()}.jsonl`);
  const select = db.prepare(`SELECT * FROM ${table} WHERE id < ? ORDER BY id LIMIT ${CHUNK}`);
  const del = db.prepare(`DELETE FROM ${table} WHERE id <= ?`);
  let archived = 0;
  for (;;) {
    const rows = select.all(cut);
    if (!rows.length) break;
    //  ⛔ اول نوشتن، بعد پاک کردن — خطای نوشتن همین‌جا بیرون می‌پرد و چیزی پاک نمی‌شود
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const fd = fs.openSync(file, 'a', 0o600);
    try {
      fs.writeSync(fd, `${rows.map((r) => JSON.stringify({ book: table, ...r })).join('\n')}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    del.run(rows[rows.length - 1].id);
    archived += rows.length;
    if (rows.length < CHUNK) break;
  }
  if (archived) enforceCap(file);
  return { archived, file: archived ? file : null };
}

/** سقفِ کلِ بایگانی — کهنه‌ترین پرونده‌ها می‌روند، هرگز پرونده‌ای که همین حالا نوشته شد */
function enforceCap(current) {
  try {
    const dir = archiveDir();
    const files = fs.readdirSync(dir).filter((f) => NAME_RE.test(f))
      .map((f) => ({ f, p: path.join(dir, f), size: fs.statSync(path.join(dir, f)).size }))
      .sort((a, b) => a.f.slice(-13).localeCompare(b.f.slice(-13)) || a.f.localeCompare(b.f));
    let total = files.reduce((n, x) => n + x.size, 0);
    for (const x of files) {
      if (total <= capBytes()) break;
      if (x.p === current || x.f.endsWith(`${monthOf()}.jsonl`)) continue;
      fs.rmSync(x.p, { force: true });
      total -= x.size;
    }
  } catch { /* سقف نباید خودِ هرس را بخواباند */ }
}

/** فقط نام و اندازه — محتوای بایگانی از هیچ درِ HTTPی بیرون نمی‌رود */
export function archiveInfo() {
  try {
    const dir = archiveDir();
    const files = fs.readdirSync(dir).filter((f) => NAME_RE.test(f)).sort()
      .map((f) => ({ name: f, bytes: fs.statSync(path.join(dir, f)).size }));
    return { dir: 'data/audit-archive', files, bytes: files.reduce((n, x) => n + x.bytes, 0) };
  } catch {
    return { dir: 'data/audit-archive', files: [], bytes: 0 };
  }
}
