// ---------------------------------------------------------------------------
//  آزمونِ ایمیلِ کدِ ورود
//      node test/otp-email.mjs
//
//  این آزمون به سرورِ ایمیل نیاز ندارد — قالب فقط متن می‌سازد. آن‌چه سنجیده
//  می‌شود همان چیزهایی است که اگر بشکنند، ایمیل در صندوقِ کاربر خراب دیده
//  می‌شود و هیچ خطایی هم جایی چاپ نمی‌شود.
// ---------------------------------------------------------------------------
import { otpEmail } from '../src/emails/otp.js';

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

console.log('\n── قالبِ ایمیل ──');
const mail = otpEmail({ code: '481902', minutes: 5, appName: 'فروشگاه توحید' });

check('سه بخش برمی‌گرداند', Boolean(mail.subject && mail.html && mail.text));
check('کد داخلِ html هست', mail.html.includes('481902'));
check('کد داخلِ text هست', mail.text.includes('481902'));
check('کد در عنوان هست', mail.subject.includes('481902'));
check('نسخهٔ text خالی نیست', mail.text.trim().length > 20);
check('نامِ برنامه در html هست', mail.html.includes('فروشگاه توحید'));
check('مدتِ اعتبار در html هست', mail.html.includes('5 دقیقه'));

console.log('\n── راست‌به‌چپ و فارسی ──');
check('dir="rtl" دارد', mail.html.includes('dir="rtl"'));
check('lang="fa" دارد', mail.html.includes('lang="fa"'));
check('charset دارد', /charset=["']?UTF-8/i.test(mail.html));
check('فونتِ Tahoma با جایگزین', /Tahoma\s*,/.test(mail.html));

console.log('\n── چیزهایی که در کلاینتِ ایمیل می‌شکنند ──');
/*
 *  هر کدام از این‌ها یک‌بار در دنیای واقعی خراب کرده است:
 *  Gmail تگِ <style> را از بدنه برمی‌دارد، Outlook با موتورِ Word رندر می‌کند
 *  و flex/grid را نمی‌فهمد، و هیچ کلاینتی جاوااسکریپت اجرا نمی‌کند.
 */
check('تگِ <style> ندارد', !/<style[\s>]/i.test(mail.html));
check('تگِ <script> ندارد', !/<script/i.test(mail.html));
check('onclick ندارد', !/onclick/i.test(mail.html));
check('display:flex ندارد', !/display\s*:\s*flex/i.test(mail.html));
check('display:grid ندارد', !/display\s*:\s*grid/i.test(mail.html));
check('چیدمان با table است', /<table/i.test(mail.html));
check('عرضِ ۶۰۰ دارد', mail.html.includes('600'));
check('تصویرِ بیرونی بار نمی‌کند', !/<img/i.test(mail.html));
check('CSS داخلِ style="" است', (mail.html.match(/style="/g) || []).length > 8);

console.log('\n── ظاهرِ کد ──');
check('فاصلهٔ حروف دارد', /letter-spacing/i.test(mail.html));
check('فونتِ mono دارد', /Courier New|monospace/i.test(mail.html));
check('رنگِ برند هست', mail.html.includes('#0F62B4'));
check('زمینهٔ صفحه هست', mail.html.includes('#F2F5FA'));
check('راهنمای کپی هست', mail.html.includes('لمس'));
check('پانویسِ «نخواسته‌اید» هست', mail.html.includes('نخواسته‌اید'));

console.log('\n── مرزها ──');
const noArgs = otpEmail();
check('بدونِ ورودی هم نمی‌شکند', Boolean(noArgs.html && noArgs.text && noArgs.subject));

const injected = otpEmail({ code: '111111', appName: '<script>bad()</script>' });
check(
  'نامِ برنامه از تگ بیرون نمی‌زند',
  !injected.html.includes('<script>bad()') && injected.html.includes('&lt;script&gt;'),
);

const withButton = otpEmail({ code: '222222', actionUrl: 'https://api.vill3n.top' });
check('با actionUrl دکمه می‌آید', withButton.html.includes('href="https://api.vill3n.top"'));
check('بدونِ actionUrl دکمه نمی‌آید', !mail.html.includes('<a href='));

const rounded = otpEmail({ code: '333333', minutes: 0 });
check('دقیقهٔ نامعتبر به پیش‌فرض برمی‌گردد', rounded.html.includes('5 دقیقه'));

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed === 0 ? 0 : 1);
