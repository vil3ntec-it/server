// ---------------------------------------------------------------------------
//  ۰۱۷ — رمزِ نوشتن/خواندنِ موضوع‌های اعلان روی دیسک فقط هش (C-05، ۱.۵۳.۳)
//
//  ‎ntf_topics.write_token/read_token‎ ِ خام در جا ‎sha256:‎ ِ برچسب‌دار می‌شوند (‎lib/app-key.js‎)؛ همان رمز کار می‌کند.
//  فرستندهٔ درونی (هشدارِ پمپ، «فرستادن از پنل») از درِ مطمئنِ ‎publish(…, { trusted: true })‎ می‌آید و خامِ رمز را
//  لازم ندارد. رمزِ خواندنِ همگانی (‎notify_read_key‎، جدولِ settings) در پنل نشان داده می‌شود و رمزشده با گاوصندوق می‌ماند.
//  جدول را ماژولِ اعلان می‌سازد؛ روی نصبِ تازه هنوز نیست ⇒ هیچ کاری. برگشت: بکاپِ خودکارِ پیش از مهاجرت.
// ---------------------------------------------------------------------------
import { hashTopicToken, HASH_PREFIX } from '../../lib/app-key.js';

export function up(db) {
  const cols = db.prepare('PRAGMA table_info(ntf_topics)').all().map((c) => c.name);
  if (!cols.length) return;
  for (const col of ['write_token', 'read_token']) {
    if (!cols.includes(col)) continue;
    const rows = db.prepare(`SELECT name, ${col} AS t FROM ntf_topics
      WHERE ${col} IS NOT NULL AND ${col} <> '' AND ${col} NOT LIKE '${HASH_PREFIX}%'`).all();
    const upd = db.prepare(`UPDATE ntf_topics SET ${col} = ? WHERE name = ? AND ${col} = ?`);
    for (const r of rows) upd.run(hashTopicToken(r.t), r.name, r.t);
  }
}
