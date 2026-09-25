// ---------------------------------------------------------------------------
//  ایمیلِ کدِ پنل با قالبِ صاحبِ سامانه — بی کد در عنوان و اعلان
//
//  گزارشِ صاحب سامانه (۱۴۰۵/۰۷/۱۳، عکسِ جیمیل): «ساختِ کد و فرستادن»ِ پنل
//  هنوز قالبِ قدیمی را می‌فرستاد، با «کد ورود: ۲۰۱۰۶۰» در عنوان و کد در
//  پیش‌نمایش. بی شبکه: فقط خودِ نامه ساخته و سنجیده می‌شود.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'code-mail-'));
process.env.HLP_DATA_DIR = path.join(tmp, 'data');
process.env.HLP_SITES_ROOT = path.join(tmp, 'sites');
fs.mkdirSync(process.env.HLP_DATA_DIR, { recursive: true });

let pass = 0; const fails = [];
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}`); } else { fails.push(name); console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

const t = await import('../src/emails/app-templates.js');
const { buildCodeMail } = await import('../src/codes/mail.js');
const settings = { subject: 'کد ورود: {code}', appName: '', email: { from: 'bot@example.com', fromName: '', host: 'x' } };

const cases = [
  ['pump-station', 'پمپ‌بنزین', 'کد ورود ویلن', 'ویلن', 'pump'],
  ['main', 'مرکز فرمان', 'کد ورود ویلن', 'ویلن', 'pump'],
  ['shop', 'فروشگاه', 'کد ورود VILL3N Shop', 'VILL3N Shop', 'shop'],
];
for (const [app, appName, subject, brand, key] of cases) {
  const m = buildCodeMail({ to: 'a@b.com', code: '201060', name: 'h', app, appName, settings });
  check(`${app}: عنوان همان <title>ِ قالب است`, m.subject === subject, m.subject);
  check(`${app}: ⛔ کد در عنوان نیست`, !/\d{6}/.test(m.subject));
  check(`${app}: فرستنده «${brand}»`, m.fromName === brand, m.fromName);
  const pre = t.preheader();
  check(`${app}: ⛔ پیش‌نمایشِ پنهانِ بی‌کد سرِ نامه`, m.html.startsWith(pre) && !pre.includes('201060'));
  check(`${app}: ⛔ خطِ نخستِ متن بی کد`, !/\d{6}/.test(m.text.split('\n')[0]));
  check(`${app}: کد داخلِ خودِ نامه هست`, m.html.includes('201060') || m.html.includes('<span>2</span><span>0</span><span>1</span>'));
  const raw = fs.readFileSync(path.join(t.DIR, t.FILES[key]), 'utf8');
  const body = m.html.slice(pre.length);
  const expected = key === 'pump'
    ? raw.replace(`id="code" dir="ltr">${t.SAMPLE}<`, 'id="code" dir="ltr">201060<')
    : raw.replace(t.SAMPLE.split('').map((d) => `<span>${d}</span>`).join(''), '201060'.split('').map((d) => `<span>${d}</span>`).join(''));
  check(`${app}: ⛔ بقیهٔ نامه بایت‌به‌بایت فایلِ صاحبِ سامانه است`, body === expected);
  check(`${app}: ⛔ قالبِ قدیمی نیامد`, !m.html.includes('کد تأیید حساب شما در VILL3N'));
}

//  عنوانی که صاحبِ سامانه خودش نوشته، بی کد می‌رود
const own = buildCodeMail({ to: 'a@b.com', code: '111222', app: 'pump', settings: { ...settings, subject: 'ورود به پمپ یعقوبی — {code}' } });
check('عنوانِ دست‌نوشته می‌ماند، بی کد', own.subject === 'ورود به پمپ یعقوبی', own.subject);
//  نامِ فرستنده‌ای که در تنظیمات نوشته شده جلوتر است
const named = buildCodeMail({ to: 'a@b.com', code: '111222', app: 'pump', settings: { ...settings, email: { ...settings.email, fromName: 'پمپ یعقوبی' } } });
check('نامِ فرستندهٔ تنظیمات جلوتر است', named.fromName === 'پمپ یعقوبی');

//  ⛔ و قالب‌ها همان فایل‌های سرورِ حساب‌اند — اگر ریپوی خواهر کنارِ این ریپو است
const sibling = path.resolve(import.meta.dirname, '..', '..', '..', '..', 'shop', 'server', 'src', 'lib', 'mail-templates');
if (fs.existsSync(sibling)) {
  for (const f of Object.values(t.FILES)) {
    const a = crypto.createHash('sha256').update(fs.readFileSync(path.join(t.DIR, f))).digest('hex');
    const b = crypto.createHash('sha256').update(fs.readFileSync(path.join(sibling, f))).digest('hex');
    check(`${f} بایت‌به‌بایت همان فایلِ سرورِ حساب است`, a === b);
  }
} else {
  console.log('  ⚠️  ریپوی shop کنارِ این ریپو نیست — سنجشِ یکسانیِ فایل‌ها رد شد');
}

const qsrc = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'codes', 'queue.js'), 'utf8');
check('⛔ صف نامِ برنامه (app) را به نامه می‌دهد', /\n\s+app: row\.app,\n/.test(qsrc));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} سبز، ${fails.length} سرخ`);
if (fails.length) { for (const f of fails) console.log('  ✖', f); process.exit(1); }
