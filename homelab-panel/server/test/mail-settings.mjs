// ---------------------------------------------------------------------------
//  آزمونِ «تنظیماتِ ایمیل را غلط نگذار»
//      node test/mail-settings.mjs
//
//  ⚠️ این آزمون از یک اسکرین‌شاتِ واقعی درآمد: در خانهٔ «آدرسِ سرور»
//  ایمیل نوشته شده بود (vill3ntec@gmail.com به‌جای smtp.gmail.com). سرور
//  همان را به DNS داد، DNS گفت «چنین نامی نیست»، و تنها نشانه‌اش یک خطای
//  انگلیسیِ خام تهِ صفحه بود: getaddrinfo EAI_FAIL.
//
//  نتیجه: کدها ساخته می‌شدند، هیچ‌کدام نمی‌رفت، و هیچ‌جا نمی‌گفت چرا.
//  یک خانهٔ اشتباه، و کلِ بخشِ کدهای شش‌رقمی از کار افتاده بود.
// ---------------------------------------------------------------------------
import { checkMailSettings } from '../src/codes/settings.js';

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

console.log('\n── همان اشتباهی که واقعاً رخ داد ──');
const real = checkMailSettings({ host: 'vill3ntec@gmail.com', port: 587, username: 'support' });
check('ایمیل در خانهٔ آدرس، رد می‌شود', real.ok === false, JSON.stringify(real));
check('و دلیلش را می‌گوید', real.error === 'host_is_email', real.error);
check('و آدرسِ درست را پیشنهاد می‌دهد', real.suggest?.host === 'smtp.gmail.com', JSON.stringify(real.suggest));
check('و می‌گوید ایمیل کجا برود', real.suggest?.username === 'vill3ntec@gmail.com');
check('پیام فارسی است و راه‌حل دارد',
  real.message.includes('smtp.gmail.com') && real.message.includes('نام کاربری'), real.message);

console.log('\n── سرویس‌های دیگر ──');
for (const [mail, smtp] of [
  ['a@outlook.com', 'smtp-mail.outlook.com'],
  ['a@hotmail.com', 'smtp-mail.outlook.com'],
  ['a@yahoo.com', 'smtp.mail.yahoo.com'],
  ['a@icloud.com', 'smtp.mail.me.com'],
]) {
  const v = checkMailSettings({ host: mail });
  check(`${mail} → ${smtp}`, v.ok === false && v.suggest?.host === smtp, JSON.stringify(v.suggest));
}

const unknown = checkMailSettings({ host: 'ali@my-company.af' });
check('دامنهٔ ناشناس هم رد می‌شود', unknown.ok === false);
check('و حدسِ معقول می‌زند', unknown.suggest?.host === 'smtp.my-company.af', JSON.stringify(unknown.suggest));

console.log('\n── آدرسِ سایت به‌جای آدرسِ سرور ──');
const url = checkMailSettings({ host: 'https://smtp.gmail.com/' });
check('آدرسِ سایت رد می‌شود', url.ok === false && url.error === 'host_is_url');
check('و نامِ تمیز را پیشنهاد می‌دهد', url.suggest?.host === 'smtp.gmail.com', JSON.stringify(url.suggest));

console.log('\n── رمزِ جیمیل ──');
/*
 *  ⚠️ جیمیل رمزِ خودِ حساب را قبول نمی‌کند و خطایش هم گنگ است. این را
 *  پیش از ذخیره می‌گوییم، نه بعد از اینکه اولین کد نرفت.
 */
const badPass = checkMailSettings({ host: 'smtp.gmail.com', password: 'MyRealPassword1' });
check('رمزِ عادیِ جیمیل رد می‌شود', badPass.ok === false && badPass.error === 'gmail_needs_app_password');
check('و می‌گوید App Password بساز', badPass.message.includes('App Password'), badPass.message);

const appPass = checkMailSettings({ host: 'smtp.gmail.com', password: 'abcdefghijklmnop' });
check('رمزِ ۱۶ حرفی قبول می‌شود', appPass.ok === true, JSON.stringify(appPass));

const spaced = checkMailSettings({ host: 'smtp.gmail.com', password: 'abcd efgh ijkl mnop' });
check('همان رمز با فاصله هم قبول می‌شود', spaced.ok === true, JSON.stringify(spaced));

const masked = checkMailSettings({ host: 'smtp.gmail.com', password: '••••••••' });
check('رمزِ ماسک‌شده ایراد نمی‌گیرد', masked.ok === true, JSON.stringify(masked));

console.log('\n── چیزهایی که باید رد شوند و نمی‌شوند ──');
check('تنظیماتِ درست قبول می‌شود', checkMailSettings({ host: 'smtp.gmail.com', port: 587 }).ok === true);
check('سرورِ شخصی قبول می‌شود', checkMailSettings({ host: 'mail.vill3n.top' }).ok === true);
check('خالی ایراد نمی‌گیرد', checkMailSettings({}).ok === true);
check('بدونِ ورودی هم نمی‌شکند', checkMailSettings().ok === true);

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed === 0 ? 0 : 1);
