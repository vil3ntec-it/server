// ---------------------------------------------------------------------------
//  آزمونِ پوشهٔ اطلاعاتِ حساب‌ها و کدِ دستی
//      node test/vault-manual.mjs
//
//  دو چیزی که این‌جا سنجیده می‌شود، همان دو مشکلی است که گزارش شد:
//
//    ۱) ایمیل خودکار نمی‌رود ⇒ باید بشود کد را در پنل دید و با یک کلیک
//       فرستاد. کد نباید هیچ‌جا لاگ شود.
//    ۲) اطلاعاتِ هر حساب باید روی درایوِ خودِ کاربر بنشیند تا با عوض شدنِ
//       کامپیوتر از دست نرود.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4798);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'vault-test-'));
const drive = path.join(tmp, 'D');           // «درایوِ» کاربر
fs.mkdirSync(path.join(tmp, 'sites'), { recursive: true });
fs.mkdirSync(drive, { recursive: true });

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

const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
  env: {
    ...process.env,
    HLP_PORT: String(PORT), HLP_HOST: '127.0.0.1',
    HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
    HLP_SITESYNC: '0', HLP_TUNNEL: '0', HLP_AI_ENABLED: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));

let token = null;
async function api(method, url, body, opts = {}) {
  const headers = {};
  const use = opts.token !== undefined ? opts.token : token;
  if (use) headers.Authorization = `Bearer ${use}`;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* JSON نبود */ }
  const code = typeof json?.error === 'string' ? json.error : json?.error?.code || null;
  return { status: res.status, json, text, code };
}

async function main() {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  let r = await api('POST', '/api/auth/setup', { username: 'admin', password: 'VaultPanel!2026' });
  token = r.json?.token;
  check('حسابِ مدیر ساخته شد', Boolean(token), r.text);

  console.log('\n── پوشهٔ اطلاعاتِ حساب‌ها ──');
  r = await api('GET', '/api/control/tohid/vault');
  check('اول خاموش است', r.json?.enabled === false, r.text);

  r = await api('POST', '/api/control/tohid/vault', { dir: drive });
  check('مسیر پذیرفته شد', r.status === 200 && r.json?.enabled === true, r.text);
  // نامِ پوشه خودش اضافه می‌شود تا کلِ درایو پر از پوشهٔ حساب نشود
  check('پوشهٔ «اطلاعات حساب‌ها» ساخته شد', String(r.json?.root || '').includes('اطلاعات حساب‌ها'), r.json?.root);
  check('نوشتنی است', r.json?.writable === true, r.text);
  const root = r.json.root;
  check('روی دیسک واقعاً هست', fs.existsSync(root));

  console.log('\n── حسابِ تازه، پوشهٔ تازه ──');
  await api('POST', '/api/v1/auth/register', {
    name: 'احمد رضایی', email: 'ahmad@gmail.com', password: 'Passw0rd!',
  }, { token: null });
  // نوشتنِ فایل عمداً await نمی‌شود تا ثبت‌نام را کند نکند
  await new Promise((res) => setTimeout(res, 600));

  const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  check('یک پوشه ساخته شد', dirs.length === 1, JSON.stringify(dirs));
  check('نامِ پوشه ایمیل را دارد', (dirs[0] || '').includes('ahmad@gmail.com'), dirs[0]);

  const accountFile = path.join(root, dirs[0], 'حساب.json');
  check('پروندهٔ حساب نوشته شد', fs.existsSync(accountFile));
  const saved = JSON.parse(fs.readFileSync(accountFile, 'utf8'));
  check('ایمیل داخلش هست', saved.email === 'ahmad@gmail.com', JSON.stringify(saved));
  check('نام داخلش هست', saved.name === 'احمد رضایی', JSON.stringify(saved));
  check('رمز داخلش نیست', !JSON.stringify(saved).includes('Passw0rd'), 'رمز نشت کرده');
  check('پوشهٔ بکاپ هست', fs.existsSync(path.join(root, dirs[0], 'بکاپ')));

  console.log('\n── کدِ دستی ──');
  r = await api('POST', '/api/control/tohid/otp/manual', { method: 'email', to: 'ahmad@gmail.com' });
  check('کد ساخته شد', r.json?.ok === true && /^\d{6}$/.test(String(r.json?.code || '')), r.text);
  const manual = r.json;
  check('گیرنده برمی‌گردد', manual?.to === 'ahmad@gmail.com', r.text);
  check('لینکِ mailto دارد', String(manual?.mailto || '').startsWith('mailto:'), manual?.mailto);
  check('لینکِ جیمیل دارد', String(manual?.gmail || '').includes('mail.google.com'), manual?.gmail);
  check('کد داخلِ متنِ لینک هست', decodeURIComponent(manual.mailto).includes(manual.code));
  check('مدتِ اعتبار برمی‌گردد', Number(manual?.minutes) > 0, r.text);

  // همان کد باید واقعاً کار کند — وگرنه فرستادنش به مشتری بی‌فایده است
  r = await api('POST', '/api/v1/auth/otp/verify', {
    method: 'email', value: 'ahmad@gmail.com', code: manual.code,
  }, { token: null });
  check('کدِ دستی واقعاً وارد می‌کند', r.status === 200 && r.json?.ok !== false, r.text);

  console.log('\n── راز در لاگ نیست ──');
  check('کد در خروجیِ سرور چاپ نشده', !out.includes(manual.code), 'کد در لاگ دیده می‌شود');

  r = await api('GET', '/api/control/logs?limit=200');
  check('کد در لاگِ پنل هم نیست', !JSON.stringify(r.json || {}).includes(manual.code));

  console.log('\n── مرزِ نقش‌ها ──');
  r = await api('POST', '/api/auth/users', { username: 'oper', password: 'NoVault!2026', role: 'operator' });
  if (r.status === 200 || r.status === 201) {
    const op = (await api('POST', '/api/auth/login', { username: 'oper', password: 'NoVault!2026' }, { token: null })).json?.token;
    r = await api('POST', '/api/control/tohid/otp/manual', { method: 'email', to: 'x@y.com' }, { token: op });
    check('operator کدِ دستی نمی‌گیرد', r.status === 403, `${r.status} ${r.text}`);
    r = await api('POST', '/api/control/tohid/vault', { dir: drive }, { token: op });
    check('operator مسیرِ پوشه را عوض نمی‌کند', r.status === 403, `${r.status} ${r.text}`);
  }

  console.log('\n── بدنهٔ درخواست دوبار کدگذاری نشود ──');
  /*
   *  باگِ واقعی: کلاینتِ پنل body را JSON.stringify می‌کرد و api() هم دوباره
   *  همان را stringify می‌کرد. سرور ۵۰۰ می‌داد و در رابط کاربری فقط «انجام
   *  نشد» دیده می‌شد — «دادن اشتراک» هم از همین می‌افتاد.
   *
   *  این‌جا هر دو شکل زده می‌شود: شکلِ درست باید کار کند و شکلِ دوبار
   *  کدگذاری‌شده باید خطای روشن بدهد، نه اینکه بی‌صدا رد شود.
   */
  const acc = (await api('GET', '/api/control/tohid/accounts')).json?.items?.[0];
  check('حسابی برای آزمون هست', Boolean(acc?.accountId));

  if (acc?.accountId) {
    r = await api('POST', `/api/control/tohid/accounts/${acc.accountId}/vip`, { plan: 'm1', amount: 1, unit: 'month' });
    check('دادنِ اشتراک با بدنهٔ درست کار می‌کند', r.status === 200, `${r.status} ${r.text}`);

    const after = (await api('GET', '/api/control/tohid/accounts')).json?.items?.[0];
    check('حساب واقعاً VIP شد', after?.vip === true, JSON.stringify(after));

    // همان درخواست، ولی با بدنه‌ای که دوبار کدگذاری شده
    const res = await fetch(`${BASE}/api/control/tohid/accounts/${acc.accountId}/vip`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.stringify({ plan: 'm1', amount: 1, unit: 'month' })),
    });
    check('بدنهٔ دوبار کدگذاری‌شده رد می‌شود', res.status >= 400, String(res.status));
  }

  console.log('\n── بازسازی ──');
  r = await api('POST', '/api/control/tohid/vault/rebuild');
  check('بازسازی کار می‌کند', r.json?.ok === true && r.json?.saved >= 1, r.text);
}

let error = null;
try {
  await main();
} catch (e) {
  error = e;
  console.log(`\n💥 ${e.message}`);
  console.log(out.slice(-1200));
}

child.kill();
await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
console.log(`\n${failed === 0 && !error ? '✅' : '❌'} ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed === 0 && !error ? 0 : 1);
