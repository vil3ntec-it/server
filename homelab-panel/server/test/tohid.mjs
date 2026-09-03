// ---------------------------------------------------------------------------
//  آزمونِ واقعیِ بخشِ توحید
//      node test/tohid.mjs
//
//  سرورِ واقعی بالا می‌آید و دقیقاً همان درخواست‌هایی به آن زده می‌شود که خودِ
//  برنامهٔ توحید می‌زند — با همان آدرس‌ها، همان بدنه‌ها و همان بررسیِ امضا که
//  در مرورگر اجرا می‌شود. اگر اینجا سبز باشد، برنامه هم کار می‌کند.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import { execSync } from 'node:child_process';
import { WebSocket } from 'ws';
import { mailText } from './lib-mail.mjs';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  (ok ? pass++ : fail++);
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 220)}`);
};

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'tohid-'));
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

/* ---------------- سرورِ ایمیلِ آزمایشی (واقعی، با TLS) ---------------- */
const certDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cert-'));
execSync(`openssl req -x509 -newkey rsa:2048 -keyout ${certDir}/k.pem -out ${certDir}/c.pem -days 1 -nodes -subj "/CN=127.0.0.1"`, { stdio: 'ignore' });
const inbox = [];
const mailServer = tls.createServer(
  { key: fs.readFileSync(`${certDir}/k.pem`), cert: fs.readFileSync(`${certDir}/c.pem`) },
  (sock) => {
    let buf = '', inData = false, authStep = 0, body = [];
    const say = (s) => sock.write(s + '\r\n');
    say('220 test ESMTP');
    sock.setEncoding('utf8');
    sock.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; inbox.push(body.join('\n')); body = []; say('250 queued'); }
          else body.push(line);
          continue;
        }
        if (/^EHLO/i.test(line)) { say('250-test'); say('250 AUTH LOGIN'); }
        else if (/^AUTH LOGIN/i.test(line)) { authStep = 1; say('334 VXNlcm5hbWU6'); }
        else if (authStep === 1) { authStep = 2; say('334 UGFzc3dvcmQ6'); }
        else if (authStep === 2) { authStep = 0; say('235 ok'); }
        else if (/^MAIL FROM/i.test(line)) say('250 ok');
        else if (/^RCPT TO/i.test(line)) say('250 ok');
        else if (/^DATA/i.test(line)) { inData = true; say('354 go'); }
        else if (/^QUIT/i.test(line)) { say('221 bye'); sock.end(); }
        else say('250 ok');
      }
    });
    sock.on('error', () => {});
  },
);
await new Promise((r) => mailServer.listen(0, '127.0.0.1', r));
const mailPort = mailServer.address().port;

/* ------------------------------ سرورِ پنل ----------------------------- */
const freePort = await new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

const child = spawn(process.execPath, [path.join(ROOT, 'src', 'index.js')], {
  cwd: ROOT,
  env: {
    ...process.env,
    HLP_DATA_DIR: tmp,
    HLP_PORT: String(freePort),
    HLP_HOST: '127.0.0.1',
    HLP_AI_ENABLED: '0',
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
    NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLog = [];
child.stdout.on('data', (d) => serverLog.push(String(d)));
child.stderr.on('data', (d) => serverLog.push(String(d)));

const BASE = `http://127.0.0.1:${freePort}`;
const api = async (p, { method = 'GET', body, token } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* بدنه‌ی خالی */ }
  return { status: res.status, data };
};

async function waitUp(ms = 40000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    try { const r = await fetch(BASE + '/health'); if (r.ok) return true; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

try {
  if (!await waitUp()) throw new Error('سرور بالا نیامد:\n' + serverLog.join('').slice(-1500));

  console.log('\n── ورودِ پنل (برای کارهای مدیر) ──');
  const admin = await api('/api/auth/setup', { method: 'POST', body: { username: 'boss', password: 'Str0ng!pass' } });
  const adminToken = admin.data?.token
    || (await api('/api/auth/login', { method: 'POST', body: { username: 'boss', password: 'Str0ng!pass' } })).data?.token;
  check('مدیر پنل ساخته شد', Boolean(adminToken), JSON.stringify(admin.data || {}).slice(0, 150));
  const adminApi = (p, o = {}) => api(p, { ...o, token: adminToken });

  console.log('\n── آنچه برنامه بدونِ حساب می‌بیند ──');
  const plans = await api('/api/v1/billing/plans');
  check('قیمت‌نامه می‌آید', Array.isArray(plans.data?.plans) && plans.data.plans.length === 3, JSON.stringify(plans.data).slice(0, 150));
  check('شکلش همان است که برنامه می‌خواند',
    plans.data.plans.every((p) => p.code && p.title && 'price' in p && 'approxDays' in p && Array.isArray(p.features)));
  const guest = await api('/api/v1/billing/status');
  check('مهمان خطا نمی‌گیرد، فقط رایگان می‌بیند',
    guest.status === 200 && guest.data?.entitlement?.isPaid === false,
    JSON.stringify(guest.data).slice(0, 150));

  console.log('\n── ساختِ حساب و ورود (همان مسیرِ برنامه) ──');
  const reg = await api('/api/v1/auth/register', {
    method: 'POST', body: { name: 'احمد', email: 'ahmad@example.com', password: 'رمز-قوی-۱۲۳' },
  });
  check('حساب ساخته شد', reg.status === 200 && reg.data?.user?.id, JSON.stringify(reg.data).slice(0, 150));

  const dupe = await api('/api/v1/auth/register', {
    method: 'POST', body: { name: 'دیگری', email: 'ahmad@example.com', password: 'رمز-قوی-۱۲۳' },
  });
  check('ایمیل تکراری رد می‌شود', dupe.status === 400 && dupe.data?.error?.code === 'email_taken', JSON.stringify(dupe.data));

  const login = await api('/api/v1/auth/login', {
    method: 'POST', body: { identifier: 'ahmad@example.com', password: 'رمز-قوی-۱۲۳' },
  });
  check('ورود کار می‌کند', login.status === 200 && login.data?.accessToken, JSON.stringify(login.data).slice(0, 150));
  check('شکلِ پاسخ همان است که برنامه می‌خواند',
    login.data?.user?.id && login.data?.refreshToken && login.data?.accessExpiresAt);
  const accountId = login.data.user.id;
  let token = login.data.accessToken;

  const bad = await api('/api/v1/auth/login', {
    method: 'POST', body: { identifier: 'ahmad@example.com', password: 'غلط' },
  });
  check('رمزِ غلط رد می‌شود', bad.status === 401 && bad.data?.error?.code, JSON.stringify(bad.data));
  check('پیامِ خطا نمی‌گوید کدام‌یک غلط بود',
    !/رمز عبور نادرست|کاربر پیدا نشد/.test(bad.data?.error?.message || ''), bad.data?.error?.message);

  const refreshed = await api('/api/v1/auth/refresh', {
    method: 'POST', body: { refreshToken: login.data.refreshToken },
  });
  check('تازه‌سازی توکن کار می‌کند', refreshed.status === 200 && refreshed.data?.accessToken);

  console.log('\n── License: همان بررسیِ امضا که در مرورگر اجرا می‌شود ──');
  const pk = await api('/api/v1/license/public-key');
  check('کلید عمومی می‌آید', pk.data?.publicKey && pk.data?.keyId);

  const device = { uid: 'dev-1', name: 'گوشی احمد', platform: 'Android', fingerprint: 'fp1' };
  const act = await api('/api/v1/license/activate', { method: 'POST', body: { device }, token });
  check('فعال‌سازی جواب می‌دهد', act.status === 200 && act.data?.license, JSON.stringify(act.data?.error || {}).slice(0, 150));

  const verify = await verifyLikeApp(act.data.license, pk.data.publicKey, device.uid);
  check('امضا در WebCrypto معتبر است', verify.ok, verify.reason);
  check('بدونِ اشتراک، قابلیت‌های پولی بسته‌اند',
    !verify.payload.feat.includes('sales'), JSON.stringify(verify.payload.feat));
  check('قابلیت‌های رایگان باز است', verify.payload.feat.includes('warehouse'));

  console.log('\n── دادنِ VIP از پنل ──');
  const grant = await adminApi(`/api/control/tohid/accounts/${accountId}/vip`, {
    method: 'POST', body: { planCode: 'm6', maxDevices: 2 },
  });
  check('VIP داده شد', grant.status === 200 && grant.data?.entitlement?.isPaid, JSON.stringify(grant.data).slice(0, 200));
  check('نوعِ اشتراک دیده می‌شود', grant.data.entitlement.planTitle === '۶ ماهه', grant.data.entitlement.planTitle);
  check('مدت درست حساب شده',
    grant.data.entitlement.daysLeft >= 179 && grant.data.entitlement.daysLeft <= 181,
    String(grant.data.entitlement.daysLeft));

  const sync = await api('/api/v1/license/sync', { method: 'POST', body: { device }, token });
  const v2 = await verifyLikeApp(sync.data.license, pk.data.publicKey, device.uid);
  check('License تازه امضایش درست است', v2.ok, v2.reason);
  check('حالا فروش باز است', v2.payload.feat.includes('sales'), JSON.stringify(v2.payload.feat));
  check('قرض‌داران هم باز است', v2.payload.feat.includes('debtors'));
  check('تاریخِ پایان داخلِ License است', v2.payload.sub_ends > Date.now());

  console.log('\n── سقفِ دستگاه ──');
  const d2 = await api('/api/v1/license/activate', {
    method: 'POST', body: { device: { uid: 'dev-2', name: 'گوشی دوم' } }, token,
  });
  check('دستگاه دوم مجاز است (سقف ۲)', d2.status === 200 && d2.data?.license);
  const d3 = await api('/api/v1/license/activate', {
    method: 'POST', body: { device: { uid: 'dev-3', name: 'گوشی سوم' } }, token,
  });
  check('دستگاه سوم رد می‌شود', d3.status === 403 && d3.data?.error?.code === 'device_limit', JSON.stringify(d3.data));

  console.log('\n── قطع کردنِ اشتراک ──');
  const subs = await adminApi(`/api/control/tohid/accounts/${accountId}`);
  const subId = subs.data.subscriptions[0].id;
  await adminApi(`/api/control/tohid/subscriptions/${subId}/status`, { method: 'POST', body: { status: 'suspended' } });
  const afterCut = await api('/api/v1/license/sync', { method: 'POST', body: { device }, token });
  const v3 = await verifyLikeApp(afterCut.data.license, pk.data.publicKey, device.uid);
  check('بعد از قطع، فروش بسته می‌شود', !v3.payload.feat.includes('sales'), JSON.stringify(v3.payload.feat));

  await adminApi(`/api/control/tohid/subscriptions/${subId}/status`, { method: 'POST', body: { status: 'active' } });
  const back = await api('/api/v1/billing/status', { token });
  check('با فعال کردن دوباره برمی‌گردد', back.data.entitlement.isPaid);

  console.log('\n── تمدید ──');
  const before = (await api('/api/v1/billing/status', { token })).data.entitlement.daysLeft;
  await adminApi(`/api/control/tohid/subscriptions/${subId}/extend`, { method: 'POST', body: { amount: 1, unit: 'month' } });
  const after = (await api('/api/v1/billing/status', { token })).data.entitlement.daysLeft;
  check('تمدید مدت را زیاد می‌کند', after >= before + 29, `${before} → ${after}`);

  console.log('\n── بستنِ حساب ──');
  await adminApi(`/api/control/tohid/accounts/${accountId}/disable`, { method: 'POST', body: { disabled: true } });
  const denied = await api('/api/v1/license/sync', { method: 'POST', body: { device }, token });
  check('حسابِ بسته دیگر License نمی‌گیرد', denied.status === 401 || denied.status === 403, JSON.stringify(denied.data));
  await adminApi(`/api/control/tohid/accounts/${accountId}/disable`, { method: 'POST', body: { disabled: false } });
  token = (await api('/api/v1/auth/login', {
    method: 'POST', body: { identifier: 'ahmad@example.com', password: 'رمز-قوی-۱۲۳' },
  })).data.accessToken;

  console.log('\n── دکان و همگام‌سازی ──');
  await api('/api/v1/shop/create', { method: 'POST', body: { name: 'دکان احمد', maxMembers: 3 }, token });
  const me = await api('/api/v1/shop/me', { token });
  check('دکان ساخته شد', me.data?.shop?.name === 'دکان احمد', JSON.stringify(me.data).slice(0, 150));
  check('شکلِ اعضا همان است که برنامه می‌خواند',
    Array.isArray(me.data.members) && me.data.members[0]?.userId === accountId);

  await api('/api/v1/shop/sync/push', {
    method: 'POST', token,
    body: { deviceId: 'dev-1', changes: [{ t: 'product', id: 'p1', name: 'برنج' }], settings: { currency: 'AFN' } },
  });
  const pulled = await api('/api/v1/shop/sync/pull?since=0&deviceId=dev-2', { token });
  check('تغییر به دستگاهِ دیگر می‌رسد',
    pulled.data?.changes?.[0]?.name === 'برنج', JSON.stringify(pulled.data).slice(0, 200));
  const mine = await api('/api/v1/shop/sync/pull?since=0&deviceId=dev-1', { token });
  check('تغییرِ خودِ دستگاه به خودش برنمی‌گردد', mine.data.changes.length === 0, JSON.stringify(mine.data.changes));

  const invite = await api('/api/v1/shop/invite', { method: 'POST', body: { role: 'staff' }, token });
  check('کد دعوت ساخته می‌شود', /^[0-9A-F]{8}$/.test(invite.data?.code || ''), invite.data?.code);

  await api('/api/v1/auth/register', { method: 'POST', body: { name: 'شاگرد', email: 'kar@example.com', password: 'رمز-قوی-۱۲۳' } });
  const staffToken = (await api('/api/v1/auth/login', {
    method: 'POST', body: { identifier: 'kar@example.com', password: 'رمز-قوی-۱۲۳' },
  })).data.accessToken;
  const joined = await api('/api/v1/shop/join', { method: 'POST', body: { code: invite.data.code }, token: staffToken });
  check('شاگرد به دکان می‌پیوندد', joined.data?.members?.length === 2, JSON.stringify(joined.data?.members || []).slice(0, 150));
  const reuse = await api('/api/v1/shop/join', { method: 'POST', body: { code: invite.data.code }, token: staffToken });
  check('کد دعوت دوباره کار نمی‌کند', reuse.status === 400, JSON.stringify(reuse.data));

  console.log('\n── مرزِ حساب‌ها ──');
  const otherPull = await api('/api/v1/shop/sync/pull?since=0&deviceId=x', { token: staffToken });
  check('عضوِ دکان همان داده را می‌بیند', otherPull.status === 200);
  await api('/api/v1/auth/register', { method: 'POST', body: { name: 'غریبه', email: 'gh@example.com', password: 'رمز-قوی-۱۲۳' } });
  const strangerToken = (await api('/api/v1/auth/login', {
    method: 'POST', body: { identifier: 'gh@example.com', password: 'رمز-قوی-۱۲۳' },
  })).data.accessToken;
  const strangerPull = await api('/api/v1/shop/sync/pull?since=0', { token: strangerToken });
  check('غریبه داده‌ی دکانِ دیگر را نمی‌بیند',
    strangerPull.status === 400 && strangerPull.data?.error?.code === 'no_shop', JSON.stringify(strangerPull.data));
  const noToken = await api('/api/v1/shop/me');
  check('بدونِ توکن هیچ‌چیز', noToken.status === 401);

  console.log('\n── ورود با کدِ شش‌رقمی (WebSocket + ایمیل واقعی) ──');
  await adminApi('/api/control/tohid/settings', {
    method: 'PUT',
    body: {
      enabled: true, serverToken: 'رمزِ-سرور',
      mail: { host: '127.0.0.1', port: mailPort, secure: true, user: 'panel@test', from: 'panel@test', fromName: 'مرکز فرمان' },
      mailPassword: 'app-password',
    },
  });
  const savedSettings = await adminApi('/api/control/tohid/settings');
  check('رمز ایمیل در پاسخ نیست',
    !JSON.stringify(savedSettings.data).includes('app-password'), JSON.stringify(savedSettings.data).slice(0, 200));
  check('رمز سرور ماسک می‌شود', String(savedSettings.data.settings.serverToken).startsWith('••'));

  const WS = `ws://127.0.0.1:${freePort}/tohid`;
  const wrongToken = await wsOnce(`${WS}?token=غلط`, { action: 'send-code', method: 'email', value: 'a@b.com' });
  check('رمزِ سرورِ غلط وصل نمی‌شود', wrongToken.failed, JSON.stringify(wrongToken));

  const sent = await wsOnce(`${WS}?token=${encodeURIComponent('رمزِ-سرور')}`,
    { action: 'send-code', method: 'email', value: 'Ali@Example.com', name: 'علی' });
  check('کد فرستاده شد', sent.data?.ok === true, JSON.stringify(sent));
  check('ایمیل واقعاً رفت', inbox.length === 1, `${inbox.length} نامه`);

  // نامه چندتکه است (متن + HTML)، پس با خوانندهٔ مشترک باز می‌شود
  const body = mailText(inbox[0]);
  const code = (body.match(/\d{6}/) || [])[0];
  check('کدِ شش‌رقمی داخلِ نامه است', Boolean(code), body.slice(0, 80));
  check('کد در لاگِ سرور نیست', !serverLog.join('').includes(code), 'کد نباید در لاگ بنشیند');

  const tooSoon = await wsOnce(`${WS}?token=${encodeURIComponent('رمزِ-سرور')}`,
    { action: 'send-code', method: 'email', value: 'ali@example.com' });
  check('درخواستِ پشتِ‌هم رد می‌شود', tooSoon.data?.ok === false, JSON.stringify(tooSoon.data));

  const wrongCode = await wsOnce(`${WS}?token=${encodeURIComponent('رمزِ-سرور')}`,
    { action: 'verify-code', method: 'email', value: 'ali@example.com', code: '000000' });
  check('کدِ غلط رد می‌شود', wrongCode.data?.ok === false, JSON.stringify(wrongCode.data));

  const verified = await wsOnce(`${WS}?token=${encodeURIComponent('رمزِ-سرور')}`,
    { action: 'verify-code', method: 'email', value: 'ali@example.com', code, name: 'علی' });
  check('کدِ درست وارد می‌کند', verified.data?.ok === true && verified.data?.token, JSON.stringify(verified.data).slice(0, 200));
  check('پاسخ شکلی دارد که برنامه می‌خواند', Boolean(verified.data?.user?.name));

  const replay = await wsOnce(`${WS}?token=${encodeURIComponent('رمزِ-سرور')}`,
    { action: 'verify-code', method: 'email', value: 'ali@example.com', code });
  check('کد بارِ دوم کار نمی‌کند', replay.data?.ok === false, JSON.stringify(replay.data));

  const otpStatus = await api('/api/v1/billing/status', { token: verified.data.token });
  check('توکنِ ورودِ با کد روی API هم کار می‌کند', otpStatus.status === 200, JSON.stringify(otpStatus.data).slice(0, 120));

  console.log('\n── پنل: شمارش و فهرست ──');
  const overview = await adminApi('/api/control/tohid/overview');
  check('تعدادِ حساب‌ها درست است', overview.data?.accounts === 4, String(overview.data?.accounts));
  check('تعدادِ VIP دیده می‌شود', overview.data?.withVip === 1, String(overview.data?.withVip));
  check('تعدادِ دستگاه‌ها دیده می‌شود', overview.data?.devices >= 2, String(overview.data?.devices));
  const list = await adminApi('/api/control/tohid/accounts');
  check('فهرستِ حساب‌ها می‌آید', list.data?.items?.length === 4, String(list.data?.items?.length));
  const ahmad = list.data.items.find((a) => a.accountId === accountId);
  check('نوعِ اشتراکِ هر حساب دیده می‌شود', ahmad.plan === '۶ ماهه', String(ahmad.plan));
  check('روزهای باقی‌مانده دیده می‌شود', ahmad.daysLeft > 200, String(ahmad.daysLeft));
  const online = await adminApi('/api/control/tohid/online');
  check('کسانی که وصل بوده‌اند شمرده می‌شوند', online.data?.online >= 1, JSON.stringify(online.data).slice(0, 150));
  check('مدتِ اتصال ثبت می‌شود', online.data.items.every((i) => typeof i.connectedMs === 'number'));

  const detail = await adminApi(`/api/control/tohid/accounts/${accountId}`);
  check('جزئیاتِ حساب کامل است',
    detail.data?.account && detail.data?.entitlement && Array.isArray(detail.data?.devices),
    JSON.stringify(Object.keys(detail.data || {})));
  check('رمزِ حساب هیچ‌جا برنمی‌گردد', !JSON.stringify(detail.data).includes('password_hash'));

  console.log('\n── هیچ رازی در پاسخ‌ها نیست ──');
  const everything = JSON.stringify([overview.data, list.data, detail.data, savedSettings.data]);
  check('کلید خصوصی بیرون نمی‌رود', !everything.includes('PRIVATE KEY'));
  check('رمزِ ایمیل بیرون نمی‌رود', !everything.includes('app-password'));
} catch (e) {
  fail++;
  console.log(`\n❌ ${e.message}\n${(e.stack || '').split('\n').slice(1, 4).join('\n')}`);
} finally {
  child.kill('SIGTERM');
  mailServer.close();
  await new Promise((r) => setTimeout(r, 300));
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  await fsp.rm(certDir, { recursive: true, force: true }).catch(() => {});
}

console.log('\n════════════════════════════════════');
console.log(`  موفق: ${pass}    ناموفق: ${fail}`);
console.log('════════════════════════════════════');
process.exit(fail ? 1 : 0);

/* ---------------------------------------------------------------------- */

/** دقیقاً همان کاری که verifyLicense برنامه در مرورگر می‌کند */
async function verifyLikeApp(tokenStr, publicKeyB64, deviceUid) {
  if (typeof tokenStr !== 'string' || tokenStr.split('.').length !== 3) return { ok: false, reason: 'format' };
  const [h, b, s] = tokenStr.split('.');
  const b64u = (v) => Uint8Array.from(Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  const header = JSON.parse(Buffer.from(b64u(h)).toString('utf8'));
  const payload = JSON.parse(Buffer.from(b64u(b)).toString('utf8'));
  if (header.alg !== 'ES256' || header.typ !== 'TLIC') return { ok: false, reason: 'header', payload };

  const key = await crypto.subtle.importKey(
    'spki', Uint8Array.from(Buffer.from(publicKeyB64, 'base64')),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
  );
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, key, b64u(s), new TextEncoder().encode(`${h}.${b}`),
  );
  if (!ok) return { ok: false, reason: 'signature', payload };
  if (payload.iss !== 'tohid-license-server') return { ok: false, reason: 'issuer', payload };
  if (payload.aud !== 'tohid-shop-app') return { ok: false, reason: 'audience', payload };
  if (payload.duid !== deviceUid) return { ok: false, reason: 'device_mismatch', payload };
  return { ok: true, payload };
}

/** یک اتصال، یک پیام، یک پاسخ — همان کاری که برنامه می‌کند */
function wsOnce(url, message) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(() => finish({ failed: true, reason: 'timeout' }), 10000);
    let ws;
    try { ws = new WebSocket(url); } catch { clearTimeout(timer); return finish({ failed: true, reason: 'bad_url' }); }
    ws.on('open', () => ws.send(JSON.stringify(message)));
    ws.on('message', (raw) => {
      clearTimeout(timer);
      try { finish({ data: JSON.parse(String(raw)) }); } catch { finish({ failed: true, reason: 'bad_json' }); }
      try { ws.close(); } catch { /* بسته */ }
    });
    ws.on('error', () => { clearTimeout(timer); finish({ failed: true, reason: 'error' }); });
    ws.on('close', () => { clearTimeout(timer); finish({ failed: true, reason: 'closed' }); });
  });
}
