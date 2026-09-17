// ---------------------------------------------------------------------------
//  آزمونِ ایمیلِ کدِ ورود — قالبِ VILL3N
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
check('نامِ برنامه در عنوان هست', mail.subject.includes('فروشگاه توحید'));
check('مدتِ اعتبار در html هست', mail.html.includes('5 دقیقه'));

console.log('\n── راست‌به‌چپ و فارسی ──');
check('dir="rtl" دارد', mail.html.includes('dir="rtl"'));
check('lang="fa" دارد', mail.html.includes('lang="fa"'));
check('charset دارد', /charset=["']?utf-8/i.test(mail.html));
check('فونتِ Vazirmatn با جایگزین', /Vazirmatn['"]?\s*,/.test(mail.html));

console.log('\n── چیزهایی که در کلاینتِ ایمیل می‌شکنند ──');
/*
 *  هر کدام از این‌ها یک‌بار در دنیای واقعی خراب کرده است:
 *  Outlook با موتورِ Word رندر می‌کند و flex/grid را نمی‌فهمد، و هیچ
 *  کلاینتی جاوااسکریپت اجرا نمی‌کند.
 */
check('تگِ <script> ندارد', !/<script/i.test(mail.html));
check('onclick ندارد', !/onclick/i.test(mail.html));
check('display:flex ندارد', !/display\s*:\s*flex/i.test(mail.html));
check('display:grid ندارد', !/display\s*:\s*grid/i.test(mail.html));
check('چیدمان با table است', /<table/i.test(mail.html));
check('عرضِ ۶۰۰ دارد', mail.html.includes('600'));
check('تصویرِ بیرونی بار نمی‌کند', !/<img/i.test(mail.html));
check('CSS داخلِ style="" است', (mail.html.match(/style="/g) || []).length > 20);

/*
 *  ⚠️ تگِ <style> این‌جا هست و عمدی است — جای مدیا‌کوئریِ موبایل.
 *
 *  ولی Gmail گاهی برش می‌دارد، پس طرح نباید به آن *وابسته* باشد. این را
 *  با برداشتنِ خودِ تگ و نگاه کردن به آنچه می‌ماند می‌سنجیم: کد، کارت و
 *  رنگ‌ها باید هنوز سرِ جایشان باشند.
 */
const withoutStyle = mail.html.replace(/<style[\s\S]*?<\/style>/gi, '');
check('بی تگِ <style> هم کد دیده می‌شود', withoutStyle.includes('481902'));
check('بی تگِ <style> هم رنگ‌ها سرِ جایشان‌اند', withoutStyle.includes('#e8458b'));
check('بی تگِ <style> هم چیدمان می‌ماند', (withoutStyle.match(/<table/gi) || []).length > 5);
check('هر گرادیان یک bgcolor هم دارد',
  (mail.html.match(/linear-gradient/gi) || []).length <= (mail.html.match(/bgcolor=/gi) || []).length);

console.log('\n── ظاهرِ کد ──');
check('فاصلهٔ حروف دارد', /letter-spacing/i.test(mail.html));
check('فونتِ mono دارد', /Courier New|monospace|SF Mono|Menlo/i.test(mail.html));
check('رنگِ برندِ VILL3N هست', mail.html.includes('#e8458b') && mail.html.includes('#7b3fe4'));
check('زمینهٔ صفحه هست', mail.html.includes('#f6e3d8'));
check('نامِ VILL3N هست', mail.html.includes('VILL3N'));
check('راهنمای کپی هست', mail.html.includes('برای کپی، روی کد بزنید'));
check('پانویسِ هشدار هست', mail.html.includes('در اختیار هیچ‌کس قرار ندهید'));
check('سالِ جاری در پانویس هست', mail.html.includes(String(new Date().getFullYear())));

console.log('\n── نامِ گیرنده ──');
const named = otpEmail({ code: '123456', name: 'احمد' });
check('با نام، خوش‌آمدِ شخصی می‌آید', named.html.includes('احمد عزیز، به VILL3N خوش آمدید'));
check('و در نسخهٔ متنی هم هست', named.text.includes('احمد عزیز'));
check('بی نام، «عزیز» تنها نمی‌ماند',
  !mail.html.includes('عزیز،') && mail.html.includes('به VILL3N خوش آمدید'));

console.log('\n── مرزها ──');
const noArgs = otpEmail();
check('بدونِ ورودی هم نمی‌شکند', Boolean(noArgs.html && noArgs.text && noArgs.subject));

const injected = otpEmail({ code: '111111', appName: '<script>bad()</script>', name: '<b>x</b>' });
check(
  'نامِ برنامه از تگ بیرون نمی‌زند',
  !injected.html.includes('<script>bad()') && injected.html.includes('&lt;script&gt;'),
);
check('نامِ گیرنده هم از تگ بیرون نمی‌زند',
  !injected.html.includes('<b>x</b>') && injected.html.includes('&lt;b&gt;x&lt;/b&gt;'));

const withButton = otpEmail({ code: '222222', actionUrl: 'https://api.vill3n.top' });
check('با actionUrl دکمه می‌آید', withButton.html.includes('href="https://api.vill3n.top"'));
check('و متنِ دکمه درست است', withButton.html.includes('تأیید حساب کاربری'));
check('بدونِ actionUrl دکمه نمی‌آید', !mail.html.includes('تأیید حساب کاربری'));

/*
 *  ⚠️ آدرس ممکن است از تنظیمات بیاید. اگر کسی آن‌جا javascript: بگذارد،
 *  در بعضی کلاینت‌های قدیمی اجرا می‌شود. پس هر چیزی جز http/https رد.
 */
const evil = otpEmail({ code: '444444', actionUrl: 'javascript:alert(1)' });
check('آدرسِ خطرناک رد می‌شود', !/javascript:/i.test(evil.html));
const evilSite = otpEmail({ code: '444444', siteUrl: 'javascript:alert(1)' });
check('آدرسِ سایتِ خطرناک هم رد می‌شود', !/javascript:/i.test(evilSite.html));
check('و به آدرسِ پیش‌فرض برمی‌گردد', evilSite.html.includes('https://vill3n.top'));

const rounded = otpEmail({ code: '333333', minutes: 0 });
check('دقیقهٔ نامعتبر به پیش‌فرض برمی‌گردد', rounded.html.includes('5 دقیقه'));

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed === 0 ? 0 : 1);
