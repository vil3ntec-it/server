// ---------------------------------------------------------------------------
//  آزمونِ دسترسیِ نقش‌محور، لاگِ اختصاصیِ پروژه‌ها و https
//      node test/roles-logs.mjs
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4801);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-roles-'));
const storageRoot = path.join(tmp, 'Projects');

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 250) : ''}`);
  }
};

const server = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')],
  {
    env: {
      ...process.env,
      HLP_PORT: String(PORT),
      HLP_HOST: '127.0.0.1',
      HLP_DATA_DIR: path.join(tmp, 'data'),
      HLP_SITES_ROOT: path.join(tmp, 'sites'),
      HLP_SITESYNC: '0',
      HLP_AI_ENABLED: '0',
      HLP_TUNNEL: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const tokens = {};
async function api(method, url, body, who = 'admin') {
  const headers = {};
  if (tokens[who]) headers.Authorization = `Bearer ${tokens[who]}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch { /* JSON نبود */ }
  return { status: res.status, json, text };
}

try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) break;
    } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log('\n── نقش‌ها ──');
  let r = await api('POST', '/api/auth/setup', { username: 'admin', password: 'ControlCenter!2026' });
  tokens.admin = r.json?.token;
  check('اولین حساب، مدیرِ کامل است', r.json?.user?.role === 'admin', r.text);

  r = await api('GET', '/api/auth/me');
  check('نقش در /me برمی‌گردد', r.json?.user?.role === 'admin' && Array.isArray(r.json?.abilities), r.text);

  r = await api('POST', '/api/auth/users', { username: 'operator1', password: 'Operator!2026', role: 'operator' });
  check('ساختِ کاربرِ operator', r.status === 201 && r.json.user.role === 'operator', r.text);
  r = await api('POST', '/api/auth/users', { username: 'viewer1', password: 'Viewer!2026', role: 'viewer' });
  check('ساختِ کاربرِ viewer', r.status === 201, r.text);
  r = await api('POST', '/api/auth/users', { username: 'x', password: 'short', role: 'nope' });
  check('نقشِ نامعتبر رد می‌شود', r.status === 400, r.text);

  tokens.operator = (await api('POST', '/api/auth/login', { username: 'operator1', password: 'Operator!2026' }, 'none')).json?.token;
  tokens.viewer = (await api('POST', '/api/auth/login', { username: 'viewer1', password: 'Viewer!2026' }, 'none')).json?.token;
  check('operator وارد شد', Boolean(tokens.operator));
  check('viewer وارد شد', Boolean(tokens.viewer));

  await api('POST', '/api/control/storage/root', { path: storageRoot });

  console.log('\n── viewer: می‌بیند ولی نمی‌نویسد ──');
  r = await api('GET', '/api/control/overview', undefined, 'viewer');
  check('viewer داشبورد را می‌بیند', r.status === 200, r.text);
  r = await api('POST', '/api/control/projects', { name: 'NopeApp', type: 'api' }, 'viewer');
  check('viewer پروژه نمی‌سازد (۴۰۳)', r.status === 403 && r.json?.error === 'forbidden', r.text);
  r = await api('GET', '/api/control/vault', undefined, 'viewer');
  check('viewer گاوصندوق را نمی‌بیند', r.status === 403, r.text);

  console.log('\n── operator: می‌سازد ولی به گاوصندوق نمی‌رسد ──');
  r = await api('POST', '/api/control/projects', { name: 'ShopApp', type: 'api', version: '1.0.0' }, 'operator');
  check('operator پروژه می‌سازد', r.status === 201, r.text);
  const project = r.json.project;

  r = await api('POST', '/api/control/vault', { name: 'k', scope: 'global', value: 'v' }, 'operator');
  check('operator راز ذخیره نمی‌کند', r.status === 403, r.text);
  r = await api('DELETE', `/api/control/projects/${project.project_id}?confirm=true`, undefined, 'operator');
  check('operator پروژه حذف نمی‌کند', r.status === 403, r.text);
  r = await api('POST', `/api/control/projects/${project.project_id}/migrate`, { to_server_id: 1, confirm: true }, 'operator');
  check('operator پروژه را جابه‌جا نمی‌کند', r.status === 403, r.text);
  r = await api('POST', '/api/control/update/install', { confirm: true }, 'operator');
  check('operator برنامه را به‌روز نمی‌کند', r.status === 403, r.text);

  console.log('\n── آزمایشِ اتصال برای همه باز است ──');
  r = await api('POST', `/api/control/projects/${project.project_id}/test`, {}, 'viewer');
  check('viewer می‌تواند آزمایش کند', r.status === 200, r.text);

  console.log('\n── آخرین مدیر نباید برود ──');
  const users = (await api('GET', '/api/auth/users')).json.users;
  const adminId = users.find((u) => u.username === 'admin').id;
  r = await api('PATCH', `/api/auth/users/${adminId}`, { role: 'viewer' });
  check('نقشِ آخرین مدیر پایین نمی‌آید', r.status === 400 && r.json.error === 'last_admin', r.text);
  r = await api('PATCH', `/api/auth/users/${adminId}`, { disabled: true });
  check('آخرین مدیر از کار نمی‌افتد', r.status === 400 && r.json.error === 'last_admin', r.text);
  r = await api('DELETE', `/api/auth/users/${adminId}`);
  check('مدیر خودش را حذف نمی‌کند', r.status === 400, r.text);

  /*
   *  ⛔ مالکِ اصلی (۱۴۰۵/۰۸/۰۹) — نه فقط «آخرین مدیر». مدیرِ دوم (یا نشستِ
   *  دزدیده‌شدهٔ او) نباید بتواند صاحبِ سامانه را تنزل دهد، ببندد، پاک کند یا
   *  رمزش را عوض کند؛ از هیچ‌کدام از دو درِ کاربران (‎/api/auth/users‎ و
   *  ‎/api/panel/v1/users‎).
   */
  console.log('\n── مالکِ اصلی بیرون گذاشته نمی‌شود ──');
  r = await api('POST', '/api/auth/users', { username: 'admin2', password: 'Admin2!2026x', role: 'admin' });
  check('مدیرِ دوم ساخته شد', r.status === 201, r.text);
  tokens.admin2 = (await api('POST', '/api/auth/login', { username: 'admin2', password: 'Admin2!2026x' }, 'none')).json?.token;
  const listed = (await api('GET', '/api/auth/users')).json?.users || [];
  const admin2Id = listed.find((u) => u.username === 'admin2')?.id;
  check('فهرست مالک را نشان می‌دهد (فقط یکی)', listed.find((u) => u.id === adminId)?.owner === true
    && listed.filter((u) => u.owner).length === 1, JSON.stringify(listed));
  const denied = [
    await api('PATCH', `/api/auth/users/${adminId}`, { role: 'viewer' }, 'admin2'),
    await api('PATCH', `/api/auth/users/${adminId}`, { disabled: true }, 'admin2'),
    await api('DELETE', `/api/auth/users/${adminId}`, undefined, 'admin2'),
    await api('PUT', `/api/panel/v1/users/${adminId}`, { role: 'operator' }, 'admin2'),
    await api('PUT', `/api/panel/v1/users/${adminId}`, { disabled: true }, 'admin2'),
    await api('PUT', `/api/panel/v1/users/${adminId}/password`, { password: 'Taken!Over2026' }, 'admin2'),
    await api('DELETE', `/api/panel/v1/users/${adminId}`, undefined, 'admin2'),
  ];
  check('مدیرِ دوم نه تنزل، نه بستن، نه حذف، نه رمزِ مالک (۴۰۳ owner_protected)',
    denied.every((x) => x.status === 403 && x.json?.error === 'owner_protected'), denied.map((x) => `${x.status}:${x.json?.error}`).join(' '));
  r = await api('GET', '/api/auth/me');
  check('نشستِ مالک هنوز زنده است', r.status === 200 && r.json?.user?.role === 'admin', r.text);
  r = await api('POST', '/api/auth/login', { username: 'admin', password: 'ControlCenter!2026' }, 'none');
  check('رمزِ مالک دست نخورده', Boolean(r.json?.token), r.text);
  r = await api('PUT', `/api/panel/v1/users/${admin2Id}/password`, { password: 'NoOldPass!2026' }, 'admin2');
  check('رمزِ خودت بی رمزِ فعلی عوض نمی‌شود', r.status === 400 && r.json?.error === 'use_change_password', r.text);
  r = await api('GET', '/api/control/audit?q=owner_protected');
  check('هر تلاش در دفترِ رخدادها می‌ماند', (r.json?.rows || []).filter((x) => x.action === 'panel.user.owner_protected').length === denied.length, r.text.slice(0, 300));

  // دوعاملیِ روشن با یک نشست جا زده نمی‌شود
  const { totp: totpNow } = await import('../src/lib/totp.js');
  const setup1 = await api('POST', '/api/auth/totp/setup', {}, 'admin2');
  const en1 = await api('POST', '/api/auth/totp/enable', { code: totpNow(setup1.json?.secret) }, 'admin2');
  check('مدیرِ دوم دوعاملی را روشن کرد', en1.status === 200 && Array.isArray(en1.json?.recoveryCodes), en1.text);
  const setup2 = await api('POST', '/api/auth/totp/setup', {}, 'admin2');
  const en2 = await api('POST', '/api/auth/totp/enable', { code: '000000' }, 'admin2');
  check('رازِ روشن با نشست عوض نمی‌شود (اول خاموش، با رمز + کد)', setup2.status === 409 && setup2.json?.error === 'totp_already_enabled'
    && en2.status === 409, `${setup2.status} ${en2.status}`);

  // و مالک بیش از اندازه قفل نشده: مدیرِ دیگر را هنوز اداره می‌کند
  r = await api('PATCH', `/api/auth/users/${admin2Id}`, { role: 'operator' });
  check('مالک مدیرِ دوم را تنزل می‌دهد', r.status === 200, r.text);
  r = await api('DELETE', `/api/auth/users/${admin2Id}`);
  check('و حذف می‌کند', r.status === 200, r.text);

  console.log('\n── حسابِ از کار افتاده ──');
  const viewerId = users.find((u) => u.username === 'viewer1').id;
  await api('PATCH', `/api/auth/users/${viewerId}`, { disabled: true });
  r = await api('GET', '/api/control/overview', undefined, 'viewer');
  check('نشستِ حسابِ از کار افتاده باطل می‌شود', r.status === 401, r.text);
  r = await api('POST', '/api/auth/login', { username: 'viewer1', password: 'Viewer!2026' }, 'none');
  check('حسابِ از کار افتاده وارد نمی‌شود', r.status === 403 && r.json.error === 'account_disabled', r.text);

  console.log('\n── لاگِ اختصاصیِ پروژه ──');
  r = await api('POST', `/api/control/storage/projects/${project.project_id}/backups`, { note: 'برای لاگ' });
  check('بکاپ گرفته شد', r.status === 201, r.text);

  r = await api('POST', `/api/control/storage/projects/${project.project_id}/config`, {
    environment: 'production',
    data: { API_BASE_URL: 'https://api.example.com/api' },
  });
  check('پیکربندی ذخیره شد', r.status === 201, r.text);

  r = await api('GET', `/api/control/storage/projects/${project.project_id}/logs`);
  check('فهرستِ فایل‌های لاگ', r.status === 200 && r.json.files.length >= 2, r.text);
  const files = r.json.files.map((f) => f.category);
  check('لاگِ بکاپ ساخته شد', files.includes('backup'), JSON.stringify(files));
  check('لاگِ استقرار ساخته شد', files.includes('deployment'), JSON.stringify(files));

  const backupFile = r.json.files.find((f) => f.category === 'backup').name;
  r = await api('GET', `/api/control/storage/projects/${project.project_id}/logs/${backupFile}`);
  check('سطرهای لاگ خوانده می‌شوند', r.status === 200 && r.json.rows.length > 0, r.text);
  check('هر سطر شناسهٔ همین پروژه را دارد', r.json.rows.every((x) => x.project === project.project_id), JSON.stringify(r.json.rows[0]));

  const logDir = path.join(storageRoot, project.slug, 'logs');
  check('لاگ داخلِ پوشهٔ همین پروژه است', fs.existsSync(logDir));

  // پروژهٔ دوم نباید لاگِ اولی را ببیند
  r = await api('POST', '/api/control/projects', { name: 'OtherApp', type: 'website' });
  const other = r.json.project;
  r = await api('GET', `/api/control/storage/projects/${other.project_id}/logs`);
  check('پروژهٔ دیگر لاگِ خالی دارد', r.json.files.length === 0, r.text);
  r = await api('GET', `/api/control/storage/projects/${other.project_id}/logs/${backupFile}`);
  check('فایلِ لاگِ پروژهٔ الف از مسیرِ ب خوانده نمی‌شود', r.status === 404, r.text);

  r = await api('GET', `/api/control/storage/projects/${project.project_id}/logs/${encodeURIComponent('../../../etc/passwd')}`);
  check('مسیرِ دست‌کاری‌شده رد می‌شود', r.status === 400 || r.status === 404, r.text);

  console.log('\n── رمز در لاگ نمی‌نشیند ──');
  // ماژول‌ها را در همین پروسه بار می‌زنیم، ولی روی همان دیتابیس و همان انبارِ
  // سرور — چون هیچ مسیرِ APIی متنِ دلخواه لاگ نمی‌کند.
  process.env.HLP_DATA_DIR = path.join(tmp, 'data');
  const { writeProjectLog, maskLine } = await import('../src/control/project-log.js');
  const { getProject } = await import('../src/control/models.js');

  check(
    'پوشانندهٔ متن، توکن و رمز را می‌گیرد',
    maskLine('token=abc123 password=hunter2 ok') === 'token=•••••••• password=•••••••• ok',
    maskLine('token=abc123 password=hunter2 ok')
  );

  writeProjectLog(getProject(project.project_id), {
    category: 'authentication',
    message: 'ورود با token=abc123secret و password=hunter2',
    detail: { token: 'abc123secret', note: 'ok' },
  });
  r = await api('GET', `/api/control/storage/projects/${project.project_id}/logs`);
  const authFile = r.json.files.find((f) => f.category === 'authentication');
  check('فایلِ authentication ساخته شد', Boolean(authFile), JSON.stringify(r.json.files));
  if (authFile) {
    r = await api('GET', `/api/control/storage/projects/${project.project_id}/logs/${authFile.name}`);
    const dump = JSON.stringify(r.json.rows);
    check('توکن در متنِ لاگ پوشانده شد', !dump.includes('abc123secret'), dump.slice(0, 200));
    check('رمز در متنِ لاگ پوشانده شد', !dump.includes('hunter2'), dump.slice(0, 200));
  }
} catch (e) {
  fail++;
  console.log(`\n❌ خطای غیرمنتظره: ${e.stack}`);
  console.log(out.slice(-2000));
} finally {
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 800));
  server.kill('SIGKILL');
  await fsp.rm(tmp, { recursive: true, force: true });
}

console.log('\n════════════════════════════════════');
console.log(`  موفق: ${pass}    ناموفق: ${fail}`);
console.log('════════════════════════════════════\n');
process.exit(fail ? 1 : 0);
