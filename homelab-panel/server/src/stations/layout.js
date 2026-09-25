// ---------------------------------------------------------------------------
//  ══ چیدمانِ پوشهٔ هر حساب ═══════════════════════════════════════════════════
//
//  خواستهٔ صاحب سامانه: «روی فولدرِ سرور برای هر حسابِ کاربر یک فولدرِ مخصوصِ
//  خودش ساخته بشه و دقیق و منظم هم شون چیده بشه و اطلاعات شون ذخیره بشن و
//  دیده بشه و بک‌اپ‌ها هم همین‌طور.»
//
//      data/stations/<کدِ پمپ>/        ← پوشهٔ اختصاصیِ همان حساب
//        station.json                  نام و کدِ پمپ        (شاخهٔ ‎station‎)
//        live.json                     عکسِ زندهٔ برنامه     (شاخهٔ ‎live‎)
//        inbox.json                    صندوقِ گوشی‌ها        (شاخهٔ ‎inbox‎)
//        acct.json                     حساب‌های کیو‌آرِ زنده  (شاخهٔ ‎acct‎)
//        chat.json                     گروهِ کارکنان، ۱۵ روز (‎chat.js‎)
//        token.txt                     رمزِ برنامهٔ کامپیوتر — می‌نویسد
//        readkey.txt                   رمزِ گوشی‌ها — فقط می‌خواند
//        backups/                      پشتیبان‌های همان پمپ (‎backups.js‎)
//
//  ⛔ **این فایل تنها جای نوشته شدنِ این فهرست است.** تا امروز نام‌ها در
//  ‎index.js‎ و ‎backups.js‎ و کامنت‌ها پخش بودند و هیچ‌کس نمی‌توانست بگوید
//  «پوشهٔ یک حساب باید چه داشته باشد». دو فهرست یعنی روزی یکی فایلی اضافه
//  می‌کند و آن یکی هیچ‌وقت نشانش نمی‌دهد.
//
//  ⛔ **این‌جا هیچ دفترِ تازه‌ای ساخته نمی‌شود.** فقط همان چیزی که روی دیسک
//  هست **توصیف** می‌شود — بودن/نبودن، حجم و زمانِ آخرین نوشتن. هیچ فایلی
//  از این فایل نوشته نمی‌شود.
//
//  ⛔ **و راز بیرون نمی‌رود**: ‎token.txt‎ و ‎readkey.txt‎ در فهرست هستند (تا
//  «هست یا نیست» دیده شود) ولی ‎secret: true‎ دارند و **محتوایشان هیچ‌وقت
//  خوانده نمی‌شود**. رمزِ خواندن راهِ خودش را دارد (کارتِ کیو‌آر، پشتِ نقشِ
//  مدیر)، و رمزِ برنامه هیچ راهی ندارد و نباید داشته باشد.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';

/**
 * چیدمانِ ثابت. ترتیبش همان ترتیبی است که در پنل دیده می‌شود، پس از
 * «مهم‌ترین» به «کم‌کاربردترین» چیده شده، نه الفبایی.
 */
export const LAYOUT = [
  { name: 'station.json', kind: 'file', branch: 'station', title: 'نام و کدِ پمپ' },
  { name: 'live.json',    kind: 'file', branch: 'live',    title: 'عکسِ زندهٔ برنامه' },
  { name: 'inbox.json',   kind: 'file', branch: 'inbox',   title: 'صندوقِ گوشی‌ها' },
  { name: 'acct.json',    kind: 'file', branch: 'acct',    title: 'حساب‌های کیو‌آرِ زنده' },
  //  ⚠️ شاخهٔ دفترِ ‎sitesync‎ نیست (‎chat.js‎ خودش می‌نویسد)، پس ‎branch‎ ندارد
  { name: 'chat.json',    kind: 'file',                    title: 'گروهِ کارکنان — ۱۵ روزِ آخر' },
  { name: 'token.txt',    kind: 'file', secret: true,      title: 'رمزِ برنامهٔ کامپیوتر' },
  { name: 'readkey.txt',  kind: 'file', secret: true,      title: 'رمزِ گوشی‌ها (فقط‌خواندنی)' },
  { name: 'backups',      kind: 'dir',                     title: 'پشتیبان‌های همین پمپ' },
];

/** پوشهٔ یک حساب. ⚠️ ‎code‎ باید از قبل ‎safeCode‎ شده باشد. */
export function folderOf(dataDir, code) {
  return path.join(dataDir, code);
}

/**
 * پوشه را **توصیف** می‌کند، نه می‌سازد: هر قلم از ‎LAYOUT‎ با
 * ‎exists‎ · ‎bytes‎ · ‎at‎ (آخرین نوشتن) و برای پوشه‌ها ‎children‎.
 *
 * ⚠️ نبودنِ یک فایل خطا نیست: پمپی که هنوز چیزی نفرستاده ‎live.json‎ ندارد
 * و این درست است. ‎missing‎ همان را به پنل می‌گوید تا صفحه بتواند فرقِ
 * «هنوز نیامده» و «خراب شد» را نشان بدهد.
 */
export function describeFolder(dataDir, code) {
  const dir = folderOf(dataDir, code);
  let dirOk = false;
  try { dirOk = fs.statSync(dir).isDirectory(); } catch { /* هنوز ساخته نشده */ }

  const items = LAYOUT.map((entry) => {
    const full = path.join(dir, entry.name);
    const row = {
      name: entry.name,
      kind: entry.kind,
      title: entry.title,
      branch: entry.branch || null,
      secret: Boolean(entry.secret),
      exists: false,
      bytes: 0,
      at: null,
      children: null,
    };
    let st;
    try { st = fs.statSync(full); } catch { return row; }
    row.exists = true;
    row.at = st.mtime.toISOString();
    if (entry.kind === 'dir') {
      let names = [];
      try { names = fs.readdirSync(full); } catch { names = []; }
      row.children = names.length;
      let sum = 0;
      for (const n of names) {
        try { sum += fs.statSync(path.join(full, n)).size; } catch { /* همان لحظه رفت */ }
      }
      row.bytes = sum;
    } else {
      row.bytes = st.size;
    }
    return row;
  });

  //  ⚠️ فایلی که در ‎LAYOUT‎ نیست هم گفته می‌شود، نه پنهان: پوشهٔ ناشناخته
  //  یعنی یا کسی دستی چیزی گذاشته یا نسخه‌ای فایلی ساخته که این فهرست
  //  نمی‌شناسد — و هر دو باید دیده شوند.
  const known = new Set(LAYOUT.map((e) => e.name));
  const extras = [];
  if (dirOk) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { names = []; }
    for (const n of names) {
      if (known.has(n)) continue;
      let st;
      try { st = fs.statSync(path.join(dir, n)); } catch { continue; }
      extras.push({ name: n, kind: st.isDirectory() ? 'dir' : 'file', bytes: st.isDirectory() ? 0 : st.size, at: st.mtime.toISOString() });
    }
  }

  const bytes = items.reduce((s, i) => s + i.bytes, 0) + extras.reduce((s, i) => s + i.bytes, 0);
  return {
    path: dir,
    exists: dirOk,
    items,
    extras,
    bytes,
    missing: items.filter((i) => !i.exists).map((i) => i.name),
  };
}
