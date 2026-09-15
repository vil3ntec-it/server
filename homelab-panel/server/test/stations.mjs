// ---------------------------------------------------------------------------
//  آزمونِ بخشِ پمپ‌بنزین‌ها
//
//  چیزهایی که این‌جا قفل می‌شوند — هر کدام یک چالهٔ واقعی:
//    ۱) برنامهٔ نیتیو از شبکهٔ خانگی خودش را ثبت می‌کند و پوشهٔ خودش را می‌گیرد
//    ۲) هر پمپ پوشه و رمزِ کاملاً جدا دارد؛ رمزِ پمپِ الف به پمپِ ب نمی‌خورد
//    ۳) رمزِ کیو‌آرِ کارمند فقط می‌خواند — نه با HTTP می‌نویسد نه با وب‌سوکت
//    ۴) داده هم می‌رود (live) و هم می‌آید (inbox)
//    ۵) اپِ کارمندان با وب‌سوکت همان لحظه تغییر را می‌بیند
//    ۶) شورت‌کاتِ آیفون با یک GET ساده جواب می‌گیرد
//    ۷) روترِ پنل هرگز روی پورتِ عمومی نیست
//
//      node test/stations.mjs
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

const PORT = Number(process.env.TEST_PORT || 4797);
const SYNC_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const PUBLIC = `http://127.0.0.1:${SYNC_PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-stations-'));
const dataDir = path.join(tmp, 'data');

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`);
  }
};

const serverPath = path.join(import.meta.dirname, '..', 'src', 'index.js');
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', serverPath], {
  env: {
    ...process.env,
    HLP_PORT: String(PORT),
    HLP_SITESYNC_PORT: String(SYNC_PORT),
    HLP_HOST: '127.0.0.1',
    HLP_DATA_DIR: dataDir,
    HLP_SITES_ROOT: path.join(tmp, 'sites'),
    HLP_TUNNEL: '0',
    HLP_METRICS_INTERVAL: '5000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOut = '';
child.stdout.on('data', (d) => (serverOut += d));
child.stderr.on('data', (d) => (serverOut += d));

async function waitForServer(timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return true;
    } catch { /* هنوز بالا نیامده */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function api(method, url, body, headers = {}) {
  const res = await fetch(url.startsWith('http') ? url : BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch { /* بدنهٔ غیرِ JSON */ }
  return { status: res.status, json, headers: res.headers };
}

/** یک اتصالِ وب‌سوکت به دفترِ یک پمپ، با همان پروتکلِ خودِ برنامه */
function connect(base, code, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `${base.replace(/^http/, 'ws')}/station?station=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`
    );
    const inbox = [];
    let hello = null;
    ws.on('message', (raw) => {
      let m = null;
      try {
        m = JSON.parse(raw.toString());
      } catch { return; }
      if (m.op === 'connected' || m.op === 'error') {
        hello = m;
        resolve({ ws, hello, inbox, next: () => nextOf(inbox) });
        return;
      }
      inbox.push(m);
      const waiter = inbox._waiter;
      if (waiter) {
        inbox._waiter = null;
        waiter(inbox.shift());
      }
    });
    ws.on('error', reject);
    setTimeout(() => (hello ? null : reject(new Error('timeout'))), 8000).unref();
  });
}

function nextOf(inbox, timeoutMs = 5000) {
  if (inbox.length) return Promise.resolve(inbox.shift());
  return new Promise((resolve, reject) => {
    inbox._waiter = resolve;
    setTimeout(() => {
      if (inbox._waiter === resolve) {
        inbox._waiter = null;
        reject(new Error('no message'));
      }
    }, timeoutMs).unref();
  });
}

const sendOp = (ws, msg) => ws.send(JSON.stringify(msg));

try {
  if (!(await waitForServer())) throw new Error('سرور بالا نیامد:\n' + serverOut);

  // ── ۱) ثبتِ خودکار از شبکهٔ خانگی ──────────────────────────────────────
  console.log('\n۱) ثبتِ خودکارِ برنامهٔ نیتیو');
  const one = await api('POST', '/api/stations/enroll', { code: 'pump1', name: 'پمپ یعقوبی' });
  check('پمپ اول ثبت شد', one.status === 200 && one.json?.ok === true, JSON.stringify(one.json));
  check('پمپِ تازه ساخته شد', one.json?.created === true);
  check('رمزِ برنامه آمد', typeof one.json?.token === 'string' && one.json.token.length >= 16);
  check('رمزِ خواندن جداست', one.json?.readKey && one.json.readKey !== one.json.token);

  const two = await api('POST', '/api/stations/enroll', { code: 'pump2', name: 'پمپ دوم' });
  check('پمپ دوم هم ثبت شد', two.json?.ok === true && two.json.code === 'pump2');
  check('رمزِ دو پمپ یکی نیست', one.json.token !== two.json.token);

  // ── ۲) پوشهٔ جدا ────────────────────────────────────────────────────────
  console.log('\n۲) پوشهٔ اختصاصیِ هر پمپ');
  const root = path.join(dataDir, 'stations');
  // نوشتنِ شاخه‌ها عمداً چند صد میلی‌ثانیه جمع می‌شود (debounce)
  await new Promise((r) => setTimeout(r, 900));
  check('پوشهٔ پمپ اول ساخته شد', fs.existsSync(path.join(root, 'pump1', 'token.txt')));
  check('پوشهٔ پمپ دوم ساخته شد', fs.existsSync(path.join(root, 'pump2', 'token.txt')));
  check('رمزِ خواندن روی دیسک است', fs.existsSync(path.join(root, 'pump1', 'readkey.txt')));
  check('نام و کد ذخیره شد', fs.existsSync(path.join(root, 'pump1', 'station.json')));

  // ── ۳) ثبتِ دوباره با همان رمز، و بی‌رمز ────────────────────────────────
  console.log('\n۳) نصبِ دوبارهٔ همان برنامه');
  const again = await api('POST', '/api/stations/enroll', { code: 'pump1', token: one.json.token });
  check('با رمزِ درست همان رمز برمی‌گردد', again.json?.token === one.json.token && again.json.created === false);
  const stolen = await api('POST', '/api/stations/enroll', { code: 'pump1', token: 'رمزِ-غلط' });
  check('با رمزِ غلط، پمپِ گرفته‌شده پس داده نمی‌شود', stolen.status === 409);

  // ── ۴) برنامهٔ نیتیو می‌نویسد، کارمند می‌خواند ──────────────────────────
  console.log('\n۴) داده می‌رود و همان لحظه دیده می‌شود');
  const app1 = await connect(BASE, 'pump1', one.json.token);
  check('برنامهٔ نیتیو وصل شد', app1.hello.op === 'connected');
  check('اتصالِ برنامه فقط‌خواندنی نیست', !app1.hello.readOnly);

  const staff = await connect(BASE, 'pump1', one.json.readKey);
  check('کارمند با رمزِ خواندن وصل شد', staff.hello.op === 'connected');
  check('اتصالِ کارمند فقط‌خواندنی است', staff.hello.readOnly === true);

  sendOp(staff.ws, { op: 'sub', subId: 'live', event: 'value', path: 'live' });
  await staff.next(); // عکسِ اولیه (خالی)

  sendOp(app1.ws, {
    op: 'set',
    id: 1,
    path: 'live',
    value: { seq: 1, at: Date.now(), station: { name: 'پمپ یعقوبی' }, tank: { petrol: 4200 } },
  });
  const ack = await app1.next();
  check('نوشتنِ برنامه تایید شد', ack.op === 'ack' && ack.ok === true);

  const pushed = await staff.next();
  check('کارمند همان لحظه تغییر را دید', pushed.op === 'event' && pushed.value?.tank?.petrol === 4200);

  // ── ۵) رمزِ کیو‌آر هرگز نمی‌نویسد ───────────────────────────────────────
  console.log('\n۵) رمزِ کیو‌آرِ کارمند فقط می‌خواند');
  sendOp(staff.ws, { op: 'set', id: 9, path: 'live', value: { hacked: true } });
  const denied = await staff.next();
  check('نوشتنِ کارمند با وب‌سوکت رد شد', denied.op === 'ack' && denied.ok === false && denied.error === 'read_only');

  const httpWrite = await api('PUT', '/api/stations/pump1/data/live', { value: { hacked: true } }, {
    'X-Station-Token': one.json.readKey,
  });
  check('نوشتنِ کارمند با HTTP هم رد شد', httpWrite.status === 403);

  const stillThere = await api('GET', `/api/stations/pump1/live?token=${one.json.readKey}`);
  check('دادهٔ پمپ دست‌نخورده ماند', stillThere.json?.live?.tank?.petrol === 4200);

  // ── ۶) رمزِ یک پمپ به پمپِ دیگر نمی‌خورد ────────────────────────────────
  console.log('\n۶) مرزِ بینِ پمپ‌ها');
  const cross = await api('GET', `/api/stations/pump2/live?token=${one.json.token}`);
  check('رمزِ پمپ اول به پمپ دوم نمی‌خورد', cross.status === 404);
  const crossWs = await connect(BASE, 'pump2', one.json.token);
  check('وب‌سوکت هم اجازه نمی‌دهد', crossWs.hello.op === 'error');
  const p2live = await api('GET', `/api/stations/pump2/live?token=${two.json.readKey}`);
  check('پمپ دوم خالی است — دادهٔ پمپ اول را ندید', p2live.json?.live === null);

  // ── ۷) راهِ برگشت: گوشی چیزی بالا می‌فرستد ──────────────────────────────
  console.log('\n۷) داده برمی‌گردد (صندوقِ ورودی)');
  sendOp(app1.ws, { op: 'sub', subId: 'box', event: 'value', path: 'inbox' });
  await app1.next();

  const sent = await api('POST', '/api/stations/pump1/inbox', { text: 'تیلِ دیزل کم است', from: 'احمد' }, {
    'X-Read-Key': one.json.readKey,
  });
  check('گوشی توانست پیام بگذارد', sent.status === 200 && Boolean(sent.json?.id));
  const arrived = await app1.next();
  check(
    'برنامهٔ نیتیو همان لحظه دیدش',
    arrived.op === 'event' && Object.values(arrived.value || {}).some((m) => m.text === 'تیلِ دیزل کم است')
  );

  const cleared = await api('DELETE', `/api/stations/pump1/inbox/${sent.json.id}`, undefined, {
    'X-Station-Token': one.json.token,
  });
  check('برنامه پیامِ خوانده‌شده را پاک کرد', cleared.status === 200);

  // ── ۸) شورت‌کاتِ آیفون و پورتِ عمومی ────────────────────────────────────
  console.log('\n۸) پورتِ عمومی — همان چیزی که تونل به آن می‌رسد');
  const viaPublic = await api('GET', `${PUBLIC}/api/stations/pump1/live?token=${one.json.readKey}`);
  check('آیفون از پورتِ عمومی داده گرفت', viaPublic.json?.live?.tank?.petrol === 4200);
  const viaV1 = await api('GET', `${PUBLIC}/api/v1/stations/pump1/live?token=${one.json.readKey}`);
  check('مسیرِ نسخه‌دار هم هست', viaV1.json?.live?.tank?.petrol === 4200);

  const adminLeak = await api('GET', `${PUBLIC}/api/stations-admin/`);
  check('روترِ پنل روی پورتِ عمومی نیست', adminLeak.status === 404, String(adminLeak.status));

  // ── کیو‌آرِ زندهٔ مشتری: فقط رمزِ همان یک حساب، بی رمزِ پمپ ───────────
  console.log('\n۸ب) کیو‌آرِ زندهٔ مشتری');
  sendOp(app1.ws, {
    op: 'set', id: 7, path: 'acct/d12',
    value: { v: 1, k: 'abcdef0123456789abcd', at: 1700000000000, d: { n: 'محمد', s: [['الباقی', '640']] } },
  });
  await app1.next();
  const acctOk = await api('GET', `${PUBLIC}/api/stations/pump1/acct/d12?k=abcdef0123456789abcd`);
  check('با رمزِ همان حساب، حساب برمی‌گردد', acctOk.json?.d?.n === 'محمد' && acctOk.json.at === 1700000000000);
  check('رمزِ حساب در پاسخ نیست', !JSON.stringify(acctOk.json).includes('abcdef0123456789abcd'));
  check('CORS باز است تا صفحهٔ مشتری بتواند بپرسد', acctOk.headers.get('access-control-allow-origin') === '*');
  const acctBad = await api('GET', `${PUBLIC}/api/stations/pump1/acct/d12?k=abcdef0123456789abce`);
  check('رمزِ غلط ⇒ ۴۰۴', acctBad.status === 404);
  const acctNone = await api('GET', `${PUBLIC}/api/stations/pump1/acct/d99?k=abcdef0123456789abcd`);
  check('حسابِ نبوده ⇒ همان ۴۰۴', acctNone.status === 404);
  const acctNoKey = await api('GET', `${PUBLIC}/api/stations/pump1/acct/d12`);
  check('بی رمز ⇒ ۴۰۴، نه داده', acctNoKey.status === 404);
  const acctReadKey = await api('GET', `${PUBLIC}/api/stations/pump1/acct/d12?k=${one.json.readKey}`);
  check('رمزِ خواندنِ پمپ این در را باز نمی‌کند', acctReadKey.status === 404);

  const listed = await api('GET', `${PUBLIC}/api`);
  check(
    'در فهرستِ رسمیِ APIِ عمومی آمده',
    (listed.json?.endpoints || []).some((e) => e.path === '/api/v1/stations')
  );

  // ── ۹) پنل ──────────────────────────────────────────────────────────────
  console.log('\n۹) پنل');
  const noAuth = await api('GET', '/api/stations-admin/');
  check('پنل بی ورود جواب نمی‌دهد', noAuth.status === 401, String(noAuth.status));

  await api('POST', '/api/auth/setup', { username: 'admin', password: 'Pump-1405-test' });
  const login = await api('POST', '/api/auth/login', { username: 'admin', password: 'Pump-1405-test' });
  const auth = { Authorization: `Bearer ${login.json?.token}` };
  check('ورود به پنل', Boolean(login.json?.token), JSON.stringify(login.json));

  const panel = await api('GET', '/api/stations-admin/', undefined, auth);
  check('پنل هر دو پمپ را می‌بیند', (panel.json?.stations || []).length === 2, JSON.stringify(panel.json)?.slice(0, 200));
  check(
    'پنل رمزِ کامل را در فهرست لو نمی‌دهد',
    !JSON.stringify(panel.json).includes(one.json.token)
  );

  const keys = await api('GET', '/api/stations-admin/pump1/keys', undefined, auth);
  check('رمزهای کامل جداگانه دیده می‌شوند', keys.json?.token === one.json.token);

  const made = await api('POST', '/api/stations-admin/', { code: 'pump3', name: 'پمپ سوم' }, auth);
  check('پنل خودش پمپ می‌سازد', made.status === 200 && fs.existsSync(path.join(root, 'pump3', 'token.txt')));

  const noConfirm = await api('DELETE', '/api/stations-admin/pump3', undefined, auth);
  check('حذف بی تاییدِ نام انجام نمی‌شود', noConfirm.status === 400);
  const gone = await api('DELETE', '/api/stations-admin/pump3?confirm=pump3', undefined, auth);
  check('حذف با تاییدِ نام انجام شد', gone.status === 200 && !fs.existsSync(path.join(root, 'pump3')));

  // ── پلِ ابر: حساب‌ها و اشتراکِ پمپ ─────────────────────────────────
  //
  //  مرکز فرمان اشتراک را خودش نگه نمی‌دارد؛ از ابر می‌پرسد. این‌جا
  //  سنجیده می‌شود که پل بسته و امن باشد تا وقتی وصل نشده‌ایم.

  const cloudSt = await api('GET', '/api/stations-admin/cloud/status', undefined, auth);
  check('حالِ پل خوانده می‌شود', cloudSt.status === 200, String(cloudSt.status));
  check('نشانیِ ابر قفل است', cloudSt.json?.base === 'https://api.vill3n.top', String(cloudSt.json?.base));
  check('تا وصل نشده‌ایم، linked دروغ نمی‌گوید', cloudSt.json?.linked === false);

  //  ⚠️ مهم‌ترین سنجه: تا توکنی نیست، هیچ‌کدام از خواندنی‌ها نباید
  //  چیزی برگردانند — نه خطای گنگ، نه دادهٔ خالیِ گمراه‌کننده.
  const notLinked = await api('GET', '/api/stations-admin/cloud/users', undefined, auth);
  check('بی وصل بودن، «وصل نشده‌اید» می‌گوید',
    notLinked.status === 409 && notLinked.json?.error === 'not_linked',
    `${notLinked.status} ${JSON.stringify(notLinked.json)}`);

  //  مسیری که در فهرستِ سفید نیست اصلاً روتی ندارد — پروکسیِ باز نیست
  const notAllowed = await api('GET', '/api/stations-admin/cloud/shops', undefined, auth);
  check('مسیرِ بیرون از فهرستِ سفید باز نیست', notAllowed.status === 404, String(notAllowed.status));

  const cloudNoAuth = await api('GET', '/api/stations-admin/cloud/status');
  check('پلِ ابر هم بی ورود بسته است', cloudNoAuth.status === 401, String(cloudNoAuth.status));

  //  آینهٔ ابر در پوشهٔ داده — «حساب‌ها از سرور به فولدرِ خودِ سرور ثبت می‌شه؟»
  const mirrorSt = await api('GET', '/api/stations-admin/cloud/mirror', undefined, auth);
  check('حالِ آینه خوانده می‌شود و پوشه‌اش داخلِ پوشهٔ داده است',
    mirrorSt.status === 200 && String(mirrorSt.json?.dir || '').startsWith(dataDir), JSON.stringify(mirrorSt.json));
  const mirrorNow = await api('POST', '/api/stations-admin/cloud/mirror', {}, auth);
  check('بی وصل بودن، آینه «وصل نشده‌اید» می‌گوید', mirrorNow.status === 409 && mirrorNow.json?.error === 'not_linked',
    `${mirrorNow.status} ${JSON.stringify(mirrorNow.json)}`);
  check('و همان را در mirror.json می‌نویسد', fs.existsSync(path.join(dataDir, 'cloud', 'mirror.json')));
  const mirrorNoAuth = await api('POST', '/api/stations-admin/cloud/mirror', {});
  check('آینه بی ورود بسته است', mirrorNoAuth.status === 401, String(mirrorNoAuth.status));

  // ── ۱۰) کدِ جفت‌شدن — برای برنامه‌ای که در شبکهٔ خانگی نیست ─────────────
  console.log('\n۱۰) کدِ جفت‌شدن');
  const pair = await api('POST', '/api/stations-admin/pair', { code: 'pump4', name: 'پمپ چهارم' }, auth);
  check('کدِ شش‌رقمی ساخته شد', /^\d{6}$/.test(pair.json?.pin || ''));
  const bad = await api('POST', '/api/stations/enroll', { code: 'pump4', pin: '000000' });
  check('کدِ غلط کار نمی‌کند', bad.status === 403, String(bad.status));
  const paired = await api('POST', '/api/stations/enroll', { code: 'pump4', pin: pair.json.pin });
  check('با کدِ درست ثبت شد', paired.json?.ok === true && paired.json.created === true);
  const reuse = await api('POST', '/api/stations/enroll', { code: 'pump5', pin: pair.json.pin });
  check('کد یک‌بارمصرف است', reuse.status === 403);

  // ── ۱۱) داده پس از راه‌اندازیِ دوباره سرِ جایش است ──────────────────────
  console.log('\n۱۱) ماندگاری');
  app1.ws.close();
  staff.ws.close();
  crossWs.ws.close();
  await new Promise((r) => setTimeout(r, 800));
  const onDisk = JSON.parse(fs.readFileSync(path.join(root, 'pump1', 'live.json'), 'utf8'));
  check('عکسِ زنده روی دیسکِ همان پمپ نشست', onDisk?.tank?.petrol === 4200);
} catch (e) {
  failed++;
  console.log(`\n❌ آزمون شکست: ${e.message}`);
  if (serverOut) console.log(serverOut.slice(-3000));
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 600));
  child.kill('SIGKILL');
  await fsp.rm(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} ✅   ${failed} ❌`);
process.exit(failed ? 1 : 0);
