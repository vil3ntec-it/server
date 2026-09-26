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
  const at = m.html.indexOf(pre);
  check(`${app}: ⛔ پیش‌نمایشِ پنهانِ بی‌کد سرِ نامه`, at > m.html.indexOf('<body') && at < m.html.indexOf('<table') && !pre.includes('201060'));
  check(`${app}: ⛔ خطِ نخستِ متن بی کد`, !/\d{6}/.test(m.text.split('\n')[0]));
  const digitsOf = (h) => (/<!--digits-->[^]*?<!--\/digits-->/.exec(h)?.[0].match(/>(\d)<\/td>/g) || []).map((x) => x[1]).join('');
  check(`${app}: کد داخلِ خودِ نامه هست`, m.html.includes('">201060</div>') || digitsOf(m.html) === '201060');
  const raw = fs.readFileSync(path.join(t.DIR, t.EMAIL_FILES[key]), 'utf8');
  const body = m.html.slice(0, at) + m.html.slice(at + pre.length + 1);
  const expected = key === 'pump'
    ? raw.replace(`">${t.SAMPLE}</div>`, '">201060</div>')
    : raw.replace(/<!--digits-->[^]*?<!--\/digits-->/, (b) => { let k = 0; return b.replace(/>(\d)<\/td>/g, () => `>${'201060'[k++]}</td>`); });
  check(`${app}: ⛔ بقیهٔ نامه بایت‌به‌بایت نسخهٔ فرستادنیِ فایلِ صاحبِ سامانه است`, body === expected);
  //  ⛔ نوشته‌ها واژه‌به‌واژه همان فایلِ او؛ و چیزی که جیمیل دور می‌ریزد نیست
  const text = (h) => h.replace(/<!--[^]*?-->/g, '').replace(/<(script|style|title|head)[^]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const orig = fs.readFileSync(path.join(t.DIR, t.FILES[key]), 'utf8');
  check(`${app}: ⛔ نوشته‌های نسخهٔ فرستادنی همان فایلِ صاحبِ سامانه`, text(raw) === text(orig));
  check(`${app}: ⛔ بی برگهٔ سبک، متغیر، SVG و اسکریپت`, !/<style|<script|var\(--|<svg|class="/.test(raw));
  const parts = t.inlineParts(m.html);
  check(`${app}: هر تصویر یک PNGِ پیوستی`, parts.length > 10 && parts.length === new Set([...m.html.matchAll(/src="(cid:[^"]+)"/g)].map((x) => x[1])).size);
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
  for (const f of [...Object.values(t.FILES), ...Object.values(t.EMAIL_FILES)]) {
    const a = crypto.createHash('sha256').update(fs.readFileSync(path.join(t.DIR, f))).digest('hex');
    const b = crypto.createHash('sha256').update(fs.readFileSync(path.join(sibling, f))).digest('hex');
    check(`${f} بایت‌به‌بایت همان فایلِ سرورِ حساب است`, a === b);
  }
} else {
  console.log('  ⚠️  ریپوی shop کنارِ این ریپو نیست — سنجشِ یکسانیِ فایل‌ها رد شد');
}

//  ⛔ نامهٔ SMTPِ پنل تصویرها را درون‌خطی (cid) پیوست می‌کند
const { buildMessage } = await import('../src/appauth/smtp.js');
const letter = buildCodeMail({ to: 'a@b.com', code: '201060', app: 'pump', settings });
const raw822 = buildMessage({ from: 'a@b.com', to: 'x@y.z', subject: letter.subject, text: letter.text, html: letter.html });
check('نامه multipart/related است', raw822.includes('Content-Type: multipart/related; type="multipart/alternative"'));
check('هر تصویر Content-IDِ خودش را دارد', t.inlineParts(letter.html).every((p) => raw822.includes(`Content-ID: <${p.cid}>`)));

const qsrc = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'codes', 'queue.js'), 'utf8');
check('⛔ صف نامِ برنامه (app) را به نامه می‌دهد', /\n\s+app: row\.app,\n/.test(qsrc));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} سبز، ${fails.length} سرخ`);
if (fails.length) { for (const f of fails) console.log('  ✖', f); process.exit(1); }
