#!/usr/bin/env node
// ---------------------------------------------------------------------------
//  به‌روزرسانی از GitHub — از خطِ فرمان
//
//      npm run update              # بررسی و نصبِ آخرین نسخه
//      npm run update -- --check   # فقط بگو نسخهٔ تازه هست یا نه
//      npm run update -- --force   # حتی اگر نسخه یکی است، دوباره نصب کن
//      npm run update -- --rollback
//
//  همان کدی را اجرا می‌کند که دکمهٔ «دانلود و نصب» در پنل صدا می‌زند:
//  بکاپ ← دانلود ← بررسی ← جایگزینی ← npm install ← گزارش.
//  پوشهٔ data و فایل .env هرگز دست نمی‌خورند.
// ---------------------------------------------------------------------------
import { ensureControlSchema } from '../src/control/schema.js';
import { checkForUpdate, downloadUpdate, applyUpdate, rollback, updateStatus } from '../src/update/github.js';

// وقتی از خط فرمان اجرا می‌شویم، سرور بالا نیامده و جدول‌ها هنوز ساخته نشده‌اند
ensureControlSchema();

const args = new Set(process.argv.slice(2));
const bytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

const line = () => console.log('─'.repeat(62));

async function main() {
  const status = updateStatus();
  line();
  console.log('  به‌روزرسانی از GitHub');
  line();
  console.log(`  مخزن:        ${status.repo}`);
  console.log(`  کانال:       ${status.channel === 'branch' ? `شاخهٔ ${status.branch}` : 'نسخه‌های رسمی'}`);
  console.log(`  نسخهٔ فعلی:  ${status.current || '?'}`);
  console.log(`  محلِ نصب:    ${status.installRoot}`);
  line();

  if (args.has('--rollback')) {
    console.log('  برگشت به بکاپِ آخرین نصب…');
    const res = await rollback({ actor: 'cli' });
    console.log(`  ✅ ${res.copied} فایل برگشت — پنل دوباره بالا می‌آید.`);
    return;
  }

  console.log('  در حال پرسیدن از GitHub…');
  const info = await checkForUpdate({ force: args.has('--force') });

  if (info.error) {
    console.error(`  ❌ ارتباط با GitHub برقرار نشد: ${info.error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`  آخرین نسخه: ${info.latest || '?'}`);
  if (!info.available) {
    console.log('  ✅ همین نسخه، تازه‌ترین است.');
    return;
  }
  console.log('  ⬆️  نسخهٔ تازه در دسترس است.');
  if (info.notes) {
    line();
    console.log(info.notes.split('\n').slice(0, 12).map((l) => `  ${l}`).join('\n'));
  }
  line();

  if (args.has('--check')) {
    console.log('  (فقط بررسی — چیزی نصب نشد)');
    process.exitCode = 10;
    return;
  }

  console.log('  دانلود…');
  const downloaded = await downloadUpdate(info);
  console.log(`  ✅ ${bytes(downloaded.size)} — ${downloaded.entries} فایل`);

  console.log('  نصب (اول بکاپ گرفته می‌شود)…');
  try {
    const result = await applyUpdate(info, downloaded, { actor: 'cli', restart: false });
    line();
    for (const step of result.steps) {
      const mark = step.status === 'ok' ? '✅' : step.status === 'error' ? '❌' : '•';
      console.log(`  ${mark} ${step.name}`);
    }
    line();
    console.log(`  ✅ نصب شد: نسخهٔ ${result.version}`);
    console.log(`  بکاپِ نسخهٔ قبلی: ${result.backup?.path}`);
    console.log('  حالا پنل را دوباره اجرا کنید.');
  } catch (e) {
    console.error(`  ❌ نصب ناموفق بود: ${e.message}`);
    for (const step of e.steps || []) console.error(`     ${step.name}: ${step.status}`);
    console.error('  نصبِ قبلی دست‌نخورده است.');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`❌ ${e.stack}`);
  process.exit(1);
});
