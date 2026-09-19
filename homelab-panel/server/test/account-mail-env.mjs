// ---------------------------------------------------------------------------
//  سرورِ حساب ایمیلِ خودِ پنل را می‌گیرد — و نام/رمزِ مدیرش دیده می‌شود
//      node test/account-mail-env.mjs
//
//  چرا (۱۴۰۵/۰۷/۰۲): ثبت‌نامِ هر سه برنامه با کدِ ایمیل است. سرورِ حسابِ
//  خودساخته هیچ ایمیلی نداشت (register/start ⇒ delivery_failed) و نام و رمزِ
//  مدیرش فقط در secrets.json بود — پس نه کسی می‌توانست ثبت‌نام کند و نه صاحبِ
//  سامانه می‌توانست با اپِ مدیریت واردِ سرورِ حسابِ خودش شود تا SMTP بنویسد.
//  این‌جا accountChildEnv و accountStatus در یک فرآیندِ جدا با محیطِ ساختگی
//  سنجیده می‌شوند — بی بالا آوردنِ هیچ سروری.
// ---------------------------------------------------------------------------
import { spawnSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 300)}`);
};

const script = `
  import { accountChildEnv, accountStatus, mailEnvForChild, managedAdminCreds } from './src/account/supervisor.js';
  const dir = process.argv[1];
  console.log(JSON.stringify({ env: accountChildEnv(dir), status: accountStatus(), mail: mailEnvForChild(), creds: managedAdminCreds() }));
`;

async function run(extraEnv, label) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'acct-mail-'));
  //  یک «سرورِ حسابِ نصب‌شده»ی ساختگی — فقط دو مسیری که ناظر می‌پرسد
  const fake = path.join(tmp, 'account-server');
  await fsp.mkdir(path.join(fake, 'src'), { recursive: true });
  await fsp.mkdir(path.join(fake, 'node_modules'), { recursive: true });
  await fsp.writeFile(path.join(fake, 'src', 'index.js'), '// ساختگی\n');
  const out = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', script, fake], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME,
      HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
      HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_ACCOUNT_API: 'http://127.0.0.1:4893',
      HLP_ACCOUNT_DIR: fake, HLP_ACCOUNT_AUTOSTART: '1',
      ...extraEnv,
    },
    encoding: 'utf8',
  });
  const line = out.stdout.trim().split('\n').pop() || '';
  let json = null;
  try { json = JSON.parse(line); } catch { /* پایین گزارش می‌شود */ }
  if (!json) console.log(`  [${label}] خروجی: ${out.stdout.slice(-400)} ${out.stderr.slice(-600)}`);
  await fsp.rm(tmp, { recursive: true, force: true });
  return json;
}

console.log('── بی ایمیل: هیچ SMTPی به فرزند نمی‌رود ──');
const bare = await run({}, 'بی ایمیل');
check('فرآیند جواب داد', !!bare);
check('SMTP_HOST در محیطِ فرزند نیست', bare && !('SMTP_HOST' in bare.env));
check('status.mail دروغ نمی‌گوید (false)', bare?.status?.mail === false);
check('مدیرِ خودساخته دیده می‌شود: نام admin و رمزِ غیرِ خالی', bare?.status?.admin?.username === 'admin' && (bare?.status?.admin?.password || '').length >= 12, JSON.stringify(bare?.status?.admin));
check('و منبعش «managed» است', bare?.status?.admin?.source === 'managed');
check('همان رمز به فرزند به‌عنوانِ ADMIN_BOOTSTRAP می‌رود', bare && bare.env.ADMIN_BOOTSTRAP_PASSWORD === bare.status.admin.password);
check('رازها به فرزند می‌روند و DATABASE_URL همان PGlite در پوشهٔ داده است',
  bare && bare.env.API_SECRET && bare.env.JWT_SECRET && /^pglite:/.test(bare.env.DATABASE_URL));

console.log('\n── با رباتِ ایمیلِ پنل: همان SMTP به فرزند می‌رود ──');
const mail = await run({
  OTP_EMAIL_HOST: 'smtp.example.com', OTP_EMAIL_PORT: '465', OTP_EMAIL_USER: 'robot@example.com',
  OTP_EMAIL_PASS: 'app-pass-1405', OTP_EMAIL_FROM: 'robot@example.com', OTP_EMAIL_FROM_NAME: 'کدها',
}, 'با ایمیل');
check('فرآیند جواب داد', !!mail);
check('SMTP_HOST / PORT / USER / PASS همان تنظیماتِ پنل‌اند',
  mail?.env?.SMTP_HOST === 'smtp.example.com' && mail?.env?.SMTP_PORT === '465'
  && mail?.env?.SMTP_USER === 'robot@example.com' && mail?.env?.SMTP_PASS === 'app-pass-1405', JSON.stringify(mail?.mail));
check('پورتِ ۴۶۵ یعنی ssl', mail?.env?.SMTP_SECURE === 'ssl');
check('فرستنده و نامش', mail?.env?.EMAIL_FROM === 'robot@example.com' && mail?.env?.EMAIL_FROM_NAME === 'کدها');
check('status.mail راست است', mail?.status?.mail === true);

console.log('\n── ۵۸۷ یعنی starttls ──');
const tls = await run({ OTP_EMAIL_HOST: 'smtp.example.com', OTP_EMAIL_PORT: '587', OTP_EMAIL_SECURE: '0', OTP_EMAIL_FROM: 'a@example.com' }, '۵۸۷');
check('SMTP_SECURE=starttls', tls?.env?.SMTP_SECURE === 'starttls', JSON.stringify(tls?.mail));

console.log('\n── نام/رمزِ صریحِ .env جلوتر از خودساخته است ──');
const env = await run({ HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'Boss-1405-secret' }, 'صریح');
check('admin از .env', env?.status?.admin?.username === 'boss' && env?.status?.admin?.password === 'Boss-1405-secret' && env?.status?.admin?.source === 'env', JSON.stringify(env?.status?.admin));

console.log('\n── ناظرِ خاموش: هیچ مدیری ادعا نمی‌شود ──');
const off = await run({ HLP_ACCOUNT_AUTOSTART: '0' }, 'خاموش');
check('admin تهی است', off?.status?.admin === null, JSON.stringify(off?.status?.admin));

console.log(`\n${pass} سبز، ${fail} سرخ`);
process.exit(fail ? 1 : 0);
