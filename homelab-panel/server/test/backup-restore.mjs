// ---------------------------------------------------------------------------
//  آزمونِ بازگردانیِ بکاپ — بکاپی که برگردانده نشده، بکاپ نیست
//      node test/backup-restore.mjs
//
//  ⚠️ چرا این فایل هست: بکاپ گرفته می‌شد، فهرست می‌شد، و هیچ‌وقت کسی
//  امتحان نکرده بود که واقعاً برمی‌گردد یا نه. یک بکاپِ آزموده‌نشده فقط یک
//  فایل است؛ روزی به دردت می‌خورد که دیگر فرصتِ امتحان کردن نداری.
//
//  این‌جا کلِ چرخه روی سرورِ واقعی طی می‌شود:
//    داده می‌سازیم → بکاپ می‌گیریم → داده را عوض می‌کنیم → برمی‌گردانیم
//    → سرور را دوباره بالا می‌آوریم → دادهٔ قدیمی باید سرِ جایش باشد
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4802);
const BASE = `http://127.0.0.1:${PORT}`;

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-restore-'));
const dataDir = path.join(tmp, 'data');
fs.mkdirSync(path.join(tmp, 'sites'), { recursive: true });

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`); }
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (h = {}) => ({ 'content-type': 'application/json', ...h });

let child = null;
async function boot() {
  child = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')],
    {
      env: {
        ...process.env,
        HLP_PORT: String(PORT), HLP_SITESYNC_PORT: String(PORT + 1), HLP_HOST: '127.0.0.1',
        HLP_DATA_DIR: dataDir, HLP_SITES_ROOT: path.join(tmp, 'sites'),
        HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_SITESYNC: '0',
        HLP_BACKUP_SCHEDULE: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const started = Date.now();
  while (Date.now() - started < 25000) {
    try { if ((await fetch(`${BASE}/health`)).ok) return out; } catch { /* هنوز */ }
    await wait(200);
  }
  throw new Error(`سرور بالا نیامد:\n${out}`);
}
async function down() {
  if (!child) return;
  child.kill('SIGTERM');
  await wait(600);
  child = null;
}

try {
  await boot();

  const BK = `${BASE}/api/panel/v1/backups`;

  console.log('\n── داده می‌سازیم ──');
  const token = (await fetch(`${BASE}/api/auth/setup`, { method: 'POST', headers: J(),
    body: JSON.stringify({ username: 'admin', password: 'ControlCenter!2026' }) }).then((r) => r.json())).token;
  const admin = { authorization: `Bearer ${token}` };
  check('مدیر ساخته شد', Boolean(token));

  const mk = (slug, name) => fetch(`${BASE}/api/codes-admin/apps`, { method: 'POST', headers: J(admin),
    body: JSON.stringify({ slug, name, kind: 'app' }) }).then((r) => r.json());
  await mk('before-backup', 'پیش از بکاپ');
  const apps1 = await fetch(`${BASE}/api/codes-admin/apps`, { headers: admin }).then((r) => r.json());
  check('برنامهٔ اول ثبت شد', (apps1.apps || []).some((a) => a.slug === 'before-backup'));

  console.log('\n── بکاپ می‌گیریم ──');
  /*
   *  ⚠️ بکاپِ *دیتابیس* زیرِ /api/panel/v1/backups است، نه
   *  /api/storage/backups — آن یکی بکاپِ فایل و پوشه است. اولین باری که
   *  این آزمون نوشته شد نشانیِ اشتباه زده بود و ۹ سنجه قرمز شد؛ همان
   *  نشان داد که این دو سامانهٔ بکاپِ جدا هستند و جای اشتباه رفتن دارند.
   */
  const made = await fetch(BK, { method: 'POST', headers: J(admin) })
    .then((r) => r.json()).catch(() => ({}));
  const backups = await fetch(BK, { headers: admin }).then((r) => r.json()).catch(() => ({}));
  const list = backups.backups || backups.items || [];
  check('بکاپ گرفته شد', list.length > 0, JSON.stringify({ made, backups }).slice(0, 250));
  const file = list[0]?.file;
  check('نامِ فایل برگشت', Boolean(file), JSON.stringify(list[0]));
  const onDisk = path.join(dataDir, 'backups', String(file));
  check('فایل واقعاً روی دیسک است', fs.existsSync(onDisk), onDisk);
  check('و خالی نیست', fs.existsSync(onDisk) && fs.statSync(onDisk).size > 1000,
    fs.existsSync(onDisk) ? String(fs.statSync(onDisk).size) : '—');

  console.log('\n── بعدِ بکاپ، داده را عوض می‌کنیم ──');
  await mk('after-backup', 'بعد از بکاپ');
  const apps2 = await fetch(`${BASE}/api/codes-admin/apps`, { headers: admin }).then((r) => r.json());
  check('برنامهٔ دوم هم ثبت شد', (apps2.apps || []).some((a) => a.slug === 'after-backup'));

  console.log('\n── بازگردانی ──');
  const restore = await fetch(`${BK}/${encodeURIComponent(file)}/restore`,
    { method: 'POST', headers: J(admin) }).then((r) => r.json()).catch((e) => ({ error: e.message }));
  check('بازگردانی پذیرفته شد', restore.ok === true || restore.pending === true, JSON.stringify(restore).slice(0, 200));
  /*
   *  ⚠️ بازگردانی *در لحظه* انجام نمی‌شود و این عمدی است: فایلِ دیتابیسِ
   *  باز را نمی‌شود زیرِ پای خودش عوض کرد. فایل کنار گذاشته می‌شود و
   *  راه‌اندازیِ بعدی اعمالش می‌کند.
   */
  check('نسخهٔ ایمنی هم گرفته شد', Boolean(restore.safetyCopy), JSON.stringify(restore).slice(0, 200));
  check('فایلِ در انتظار ساخته شد', fs.existsSync(path.join(dataDir, 'panel.db.restore')));

  console.log('\n── سرور را دوباره بالا می‌آوریم ──');
  await down();
  const out2 = await boot();
  check('سرور با دیتابیسِ بازگردانده‌شده بالا آمد', true);
  check('و در لاگ گفت بازگردانی شد', /بازگردان/.test(out2), out2.split('\n').slice(0, 4).join(' | '));

  const token2 = (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: J(),
    body: JSON.stringify({ username: 'admin', password: 'ControlCenter!2026' }) }).then((r) => r.json())).token;
  check('با همان رمزِ قبلی می‌شود وارد شد', Boolean(token2));

  const apps3 = await fetch(`${BASE}/api/codes-admin/apps`, { headers: { authorization: `Bearer ${token2}` } })
    .then((r) => r.json());
  const slugs = (apps3.apps || []).map((a) => a.slug);
  /*  ⚠️ قلبِ آزمون: وضعیتِ *لحظهٔ بکاپ* برگشته باشد، نه چیزی جز آن.  */
  check('دادهٔ پیش از بکاپ برگشت', slugs.includes('before-backup'), slugs.join(', '));
  check('و تغییرِ بعد از بکاپ رفت', !slugs.includes('after-backup'), slugs.join(', '));

  console.log('\n── محافظ‌ها ──');
  const bad = await fetch(`${BK}/${encodeURIComponent('../../etc/passwd')}/restore`,
    { method: 'POST', headers: J({ authorization: `Bearer ${token2}` }) });
  check('مسیرِ خطرناک رد می‌شود', bad.status >= 400, `status ${bad.status}`);
  const missing = await fetch(`${BK}/${encodeURIComponent('nope.db')}/restore`,
    { method: 'POST', headers: J({ authorization: `Bearer ${token2}` }) });
  check('فایلِ ناموجود رد می‌شود', missing.status >= 400, `status ${missing.status}`);
} finally {
  await down();
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed === 0 ? 0 : 1);
