// ---------------------------------------------------------------------------
//  آزمونِ کارهای زمان‌بندی‌شده
//      node test/cron.mjs
//
//  تجزیه‌کنندهٔ cron را خودمان نوشته‌ایم، پس باید خودمان هم ثابت کنیم درست
//  است — به‌ویژه قاعدهٔ عجیبی که همه از قلم می‌اندازند: وقتی هم روزِ‌ماه و هم
//  روزِ‌هفته مشخص باشند، «یا» است نه «و».
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4795);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cron-test-'));
const dataDir = path.join(tmp, 'data');
const sitesRoot = path.join(tmp, 'sites');
fs.mkdirSync(sitesRoot, { recursive: true });

// دیتابیس باید پیش از importِ ماژولِ cron ساخته شود
process.env.HLP_DATA_DIR = dataDir;
process.env.HLP_SITES_ROOT = sitesRoot;

const { parseSchedule, nextRunAt, isValidSchedule } = await import('../src/system/cron.js');

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`);
  }
};

/* ───────────────────────── تجزیهٔ الگو ──────────────────────────────── */

console.log('\n── الگوهای درست ──');
for (const expr of [
  '* * * * *', '0 3 * * *', '*/15 * * * *', '0 0 1 * *',
  '30 2 * * 1-5', '0 */4 * * *', '0 0 1,15 * *', '0 9 * jan mon',
  '@daily', '@hourly', '@weekly',
]) {
  check(`«${expr}» پذیرفته می‌شود`, isValidSchedule(expr), JSON.stringify(parseSchedule(expr)));
}

console.log('\n── الگوهای غلط ──');
for (const [expr, why] of [
  ['', 'خالی'],
  ['* * * *', 'چهار فیلد'],
  ['* * * * * *', 'شش فیلد'],
  ['60 * * * *', 'دقیقهٔ ۶۰'],
  ['* 24 * * *', 'ساعتِ ۲۴'],
  ['* * 32 * *', 'روزِ ۳۲'],
  ['* * * 13 *', 'ماهِ ۱۳'],
  ['abc * * * *', 'حرفِ بی‌معنی'],
  ['5-1 * * * *', 'بازهٔ برعکس'],
  ['*/0 * * * *', 'گامِ صفر'],
]) {
  check(`«${expr}» رد می‌شود (${why})`, !isValidSchedule(expr));
}

console.log('\n── محاسبهٔ اجرای بعدی ──');
// ۱۵ ژانویهٔ ۲۰۲۵، ساعت ۱۰:۳۰ — یک چهارشنبه
const base = new Date(2025, 0, 15, 10, 30, 0, 0);

let at = new Date(nextRunAt('0 3 * * *', base));
check('«هر شب ۳» فردا ۳ بامداد است', at.getHours() === 3 && at.getMinutes() === 0 && at.getDate() === 16, at.toString());

at = new Date(nextRunAt('*/15 * * * *', base));
check('«هر ۱۵ دقیقه» می‌شود ۱۰:۴۵', at.getHours() === 10 && at.getMinutes() === 45, at.toString());

at = new Date(nextRunAt('0 0 1 * *', base));
check('«اولِ هر ماه» می‌شود ۱ فوریه', at.getDate() === 1 && at.getMonth() === 1, at.toString());

at = new Date(nextRunAt('0 12 * * 0', base));
check('«یکشنبه ظهر» می‌شود ۱۹ ژانویه', at.getDate() === 19 && at.getHours() === 12, at.toString());

at = new Date(nextRunAt('0 12 * * 7', base));
check('یکشنبه با ۷ هم همان جواب را می‌دهد', at.getDate() === 19 && at.getHours() === 12, at.toString());

// قاعدهٔ «یا» — «0 0 1 * mon» یعنی اولِ ماه، و هر دوشنبه
at = new Date(nextRunAt('0 0 1 * mon', base));
check(
  'روزِ‌ماه و روزِ‌هفته با هم «یا» می‌شوند (دوشنبهٔ ۲۰ ژانویه)',
  at.getDate() === 20 && at.getDay() === 1,
  at.toString()
);

check('الگوی غلط اجرای بعدی ندارد', nextRunAt('nope') === null);

const error = null;
await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});

console.log(`\n${failed === 0 && !error ? '✅' : '❌'} ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed === 0 && !error ? 0 : 1);
