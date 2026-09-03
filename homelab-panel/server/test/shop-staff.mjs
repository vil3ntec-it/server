// ---------------------------------------------------------------------------
//  آزمونِ کارمندانِ دکان
//      node test/shop-staff.mjs
//
//  چیزی که این‌جا سنجیده می‌شود همان چیزی است که در برنامه نبود: کدِ پیوستن
//  با نقش، با تعدادِ استفاده، و با مدتِ اعتبار — و اینکه شاگرد نتواند کارهایی
//  بکند که مالِ صاحبِ دکان است.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4796);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'shop-test-'));
fs.mkdirSync(path.join(tmp, 'sites'), { recursive: true });

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

async function api(method, url, body, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* JSON نبود */ }
  // خطا تودرتو می‌آید: {"error":{"code":"…","message":"…"}}
  const code = typeof json?.error === 'string' ? json.error : json?.error?.code || null;
  return { status: res.status, json, text, code };
}

/** یک حسابِ تازه، با توکنش */
async function newUser(email) {
  await api('POST', '/api/v1/auth/register', { name: email, email, password: 'Passw0rd!' });
  const r = await api('POST', '/api/v1/auth/login', { identifier: email, password: 'Passw0rd!' });
  return r.json?.tokens?.access || r.json?.accessToken || r.json?.token;
}

async function main() {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log('\n── سرور چه چیزی بلد است ──');
  // بدونِ این، برنامه فقط ۴۰۴ می‌گیرد و می‌گوید «این قابلیت روی سرور نیست»
  let r = await api('GET', '/api/v1/health');
  const features = r.json?.features || [];
  check('سلامت، فهرستِ قابلیت‌ها می‌دهد', Array.isArray(features) && features.length > 0, r.text);
  for (const f of ['invites', 'invite_roles', 'invite_uses', 'invite_days', 'invite_list', 'invite_revoke']) {
    check(`قابلیتِ ${f} اعلام شده`, features.includes(f), JSON.stringify(features));
  }

  const owner = await newUser('owner@shop.test');
  check('صاحبِ دکان وارد شد', Boolean(owner));

  console.log('\n── ساختِ دکان ──');
  r = await api('POST', '/api/v1/shop/create', { name: 'دکان توحید', maxMembers: 5 }, owner);
  check('دکان ساخته شد', r.status === 200 && Boolean(r.json?.shop), r.text);
  check('نقشِ من owner است', r.json?.shop?.myRole === 'owner', JSON.stringify(r.json?.shop));
  check('اجازهٔ ساختِ کد دارم', r.json?.shop?.canInvite === true);

  console.log('\n── کدِ پیوستن با نقش و تعداد و مدت ──');
  r = await api('POST', '/api/v1/shop/invite', { role: 'staff', uses: 2, days: 3 }, owner);
  const code = r.json?.code;
  check('کد ساخته شد', r.status === 200 && /^[0-9A-F]{8}$/.test(code || ''), r.text);
  check('نقشِ کد شاگرد است', r.json?.role === 'staff', r.text);
  check('تعدادِ استفاده رعایت شد', r.json?.uses === 2, r.text);
  check('مدتِ اعتبار رعایت شد', r.json?.days === 3, r.text);

  // نام‌های دیگرِ همان فیلدها — نسخه‌های مختلفِ برنامه یکسان نمی‌فرستند
  r = await api('POST', '/api/v1/shop/invite', { role: 'staff', maxUses: 4, expiresDays: 10 }, owner);
  check('نامِ maxUses هم فهمیده می‌شود', r.json?.uses === 4, r.text);
  check('نامِ expiresDays هم فهمیده می‌شود', r.json?.days === 10, r.text);

  r = await api('POST', '/api/v1/shop/invite', { role: 'staff', uses: 0, days: 0 }, owner);
  check('صفر یعنی بی‌شمار', r.json?.uses === 0, r.text);
  check('صفر یعنی همیشه', r.json?.expiresAt === null, r.text);

  console.log('\n── فهرستِ کدها ──');
  r = await api('GET', '/api/v1/shop/invites', undefined, owner);
  check('فهرست می‌آید', Array.isArray(r.json?.invites) && r.json.invites.length >= 3, r.text);
  const listed = (r.json?.invites || []).find((x) => x.code === code);
  check('کدِ ما در فهرست هست', Boolean(listed));
  check('وضعیتش فعال است', listed?.active === true, JSON.stringify(listed));
  check('شمارشِ استفاده صفر است', listed?.usedCount === 0, JSON.stringify(listed));

  console.log('\n── پیوستنِ شاگرد ──');
  const staff = await newUser('staff@shop.test');
  r = await api('POST', '/api/v1/shop/join', { code }, staff);
  check('شاگرد پیوست', r.status === 200 && Boolean(r.json?.shop), r.text);
  check('نقشش شاگرد است', r.json?.shop?.myRole === 'staff', JSON.stringify(r.json?.shop));
  check('شاگرد کد نمی‌سازد', r.json?.shop?.canInvite === false, JSON.stringify(r.json?.shop));
  check('دو عضو دارد', (r.json?.members || []).length === 2, r.text);

  // همان کد بارِ دوم — چون uses=2 بود باید کار کند
  const staff2 = await newUser('staff2@shop.test');
  r = await api('POST', '/api/v1/shop/join', { code }, staff2);
  check('کدِ دوبار مصرف، بارِ دوم هم کار می‌کند', r.status === 200, r.text);

  // بارِ سوم دیگر نه
  const staff3 = await newUser('staff3@shop.test');
  r = await api('POST', '/api/v1/shop/join', { code }, staff3);
  check('بارِ سوم رد می‌شود', r.status >= 400 && r.code === 'invite_used', `${r.status} ${r.text}`);

  console.log('\n── مرزِ نقش‌ها ──');
  r = await api('POST', '/api/v1/shop/invite', { role: 'staff' }, staff);
  check('شاگرد کد نمی‌سازد (۴۰۰)', r.status >= 400 && r.code === 'not_allowed', `${r.status} ${r.text}`);

  r = await api('POST', '/api/v1/shop/invite', { role: 'manager' }, owner);
  const mgrCode = r.json?.code;
  check('صاحبِ دکان می‌تواند مدیر بسازد', r.json?.role === 'manager', r.text);

  const manager = await newUser('manager@shop.test');
  r = await api('POST', '/api/v1/shop/join', { code: mgrCode }, manager);
  check('مدیر پیوست', r.json?.shop?.myRole === 'manager', JSON.stringify(r.json?.shop));
  check('مدیر می‌تواند کد بسازد', r.json?.shop?.canInvite === true);

  r = await api('POST', '/api/v1/shop/invite', { role: 'manager' }, manager);
  check('مدیر، مدیرِ دیگر نمی‌سازد', r.status >= 400 && r.code === 'owner_only', `${r.status} ${r.text}`);

  r = await api('POST', '/api/v1/shop/invite', { role: 'staff' }, manager);
  check('مدیر، شاگرد می‌سازد', r.status === 200 && r.json?.role === 'staff', r.text);

  console.log('\n── باطل کردنِ کد ──');
  r = await api('POST', '/api/v1/shop/invite', { role: 'staff', uses: 0 }, owner);
  const doomed = r.json?.code;
  r = await api('POST', `/api/v1/shop/invites/${doomed}/revoke`, {}, owner);
  check('کد باطل شد', r.status === 200, r.text);

  const late = await newUser('late@shop.test');
  r = await api('POST', '/api/v1/shop/join', { code: doomed }, late);
  check('کدِ باطل‌شده کار نمی‌کند', r.status >= 400 && r.code === 'invite_revoked', `${r.status} ${r.text}`);

  console.log('\n── حذفِ عضو ──');
  const staffId = (await api('GET', '/api/v1/shop/me', undefined, owner)).json
    ?.members?.find((m) => m.email === 'staff@shop.test')?.userId;
  r = await api('POST', `/api/v1/shop/members/${staffId}/remove`, {}, manager);
  check('مدیر شاگرد را برمی‌دارد', r.status === 200, r.text);

  const ownerId = (await api('GET', '/api/v1/shop/me', undefined, owner)).json?.shop?.ownerId;
  r = await api('POST', `/api/v1/shop/members/${ownerId}/remove`, {}, manager);
  check('صاحبِ دکان حذف نمی‌شود', r.status >= 400, `${r.status} ${r.text}`);
}

let error = null;
try {
  await main();
} catch (e) {
  error = e;
  console.log(`\n💥 ${e.message}`);
  console.log(out.slice(-1500));
}

child.kill();
await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
console.log(`\n${failed === 0 && !error ? '✅' : '❌'} ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed === 0 && !error ? 0 : 1);
