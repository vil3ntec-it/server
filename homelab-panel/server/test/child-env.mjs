// ---------------------------------------------------------------------------
//  آزمونِ «رازهای پنل به فرزندها نمی‌رسد» (۱.۵۰.۸۳، S4/۶-۶)
//      node test/child-env.mjs
//
//  سایت‌ها (`siteEnv`) و ترمینال کلِ `process.env` را به فرزند می‌دادند — از جمله کلیدِ امضای نشست و رمزها.
//  این سنجه می‌بیند که محیطِ سایت و محیطِ ترمینال بی آن رازهاست، ولی متغیرهای بی‌خطر (PATH، SITE_*) سرِ جا.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 200) : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-childenv-'));
//  رازها را در محیطِ همین فرآیند می‌گذاریم تا ببینیم به فرزند نشت نمی‌کنند
process.env.HLP_DATA_DIR = path.join(tmp, 'data');
process.env.HLP_SECRET_KEY = 'leak-secret-key-9b3f';
process.env.HLP_ADMIN_PASSWORD = 'leak-admin-pw-7788';
process.env.HLP_SITESYNC_TOKEN = 'leak-sitesync-token';
process.env.OTP_SMS_KEY = 'leak-sms-key';
process.env.HLP_SITES_ROOT = path.join(tmp, 'sites');
fs.mkdirSync(process.env.HLP_SITES_ROOT, { recursive: true });

try {
  const { siteEnv } = await import('../src/sites/workspace.js');
  const env = siteEnv({ slug: 'app1', name: 'App One', port: 4321, root_path: path.join(tmp, 'sites', 'app1') });

  console.log('\n▶ محیطِ سایت بی رازهای پنل است');
  check('⛔ HLP_SECRET_KEY به سایت نمی‌رسد', env.HLP_SECRET_KEY === undefined, String(env.HLP_SECRET_KEY));
  check('⛔ HLP_ADMIN_PASSWORD به سایت نمی‌رسد', env.HLP_ADMIN_PASSWORD === undefined, String(env.HLP_ADMIN_PASSWORD));
  check('⛔ HLP_SITESYNC_TOKEN به سایت نمی‌رسد', env.HLP_SITESYNC_TOKEN === undefined, String(env.HLP_SITESYNC_TOKEN));
  check('⛔ OTP_SMS_KEY به سایت نمی‌رسد', env.OTP_SMS_KEY === undefined, String(env.OTP_SMS_KEY));

  console.log('\n▶ ولی چیزهای لازم سرِ جایشان‌اند');
  check('PATH ِ محیط دست‌نخورده', typeof env.PATH === 'string' && env.PATH.length > 0);
  check('SITE_SLUG و PORT ِ خودِ سایت', env.SITE_SLUG === 'app1' && env.PORT === '4321', `${env.SITE_SLUG}/${env.PORT}`);

  console.log('\n▶ ترمینال هم همان محیطِ پاک را به پوسته می‌دهد');
  const terminal = await import('../src/system/terminal.js');
  const made = terminal.create({ userId: 1, username: 'owner' });
  if (!made.ok) {
    check('ترمینال باز شد', false, JSON.stringify(made));
  } else {
    let out = '';
    await terminal.run(made.id, 'echo "KEY=[$HLP_SECRET_KEY] PW=[$HLP_ADMIN_PASSWORD] PATHSET=[${PATH:+yes}]"', {
      onData: (chunk) => { out += chunk; },
    });
    terminal.close(made.id);
    check('⛔ HLP_SECRET_KEY در پوستهٔ ترمینال نیست', /KEY=\[\]/.test(out) && !out.includes('leak-secret-key-9b3f'), out.slice(0, 160));
    check('⛔ HLP_ADMIN_PASSWORD در پوسته نیست', /PW=\[\]/.test(out) && !out.includes('leak-admin-pw-7788'), out.slice(0, 160));
    check('ولی PATH ِ پوسته هست', /PATHSET=\[yes\]/.test(out), out.slice(0, 160));
  }
} catch (e) {
  failed++;
  console.log(`\n❌ ${e.stack || e.message}`);
} finally {
  await wait(50);
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failed === 0 ? '✅' : '❌'}  ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed === 0 ? 0 : 1);
