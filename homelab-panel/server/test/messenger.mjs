// ---------------------------------------------------------------------------
//  آزمونِ پیام‌رسان — با دو کاربر واقعی و اتصال واقعی
//
//      node test/messenger.mjs
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocket } from 'ws';

const PORT = Number(process.env.TEST_PORT || 4860);
const PUBLIC_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-msg-'));

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

// سرویسِ پوشِ ساختگی — جای سرور نوتیفیکیشنِ مرورگر را می‌گیرد
const pushHits = [];
const pushServer = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    pushHits.push({ url: req.url, auth: req.headers.authorization || '', bytes: Buffer.concat(chunks).length });
    res.writeHead(201).end();
  });
});
await new Promise((r) => pushServer.listen(0, '127.0.0.1', r));
const pushPort = pushServer.address().port;

const child = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')],
  {
    env: {
      ...process.env,
      HLP_PORT: String(PORT),
      HLP_SITESYNC_PORT: String(PUBLIC_PORT),
      HLP_HOST: '127.0.0.1',
      HLP_DATA_DIR: path.join(tmp, 'data'),
      HLP_SITES_ROOT: path.join(tmp, 'sites'),
      HLP_METRICS_INTERVAL: '3000',
      HLP_TUNNEL: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);
let serverOut = '';
child.stdout.on('data', (d) => (serverOut += d));
child.stderr.on('data', (d) => (serverOut += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, body, token, base = BASE) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch { /* JSON نبود */ }
  return { status: res.status, json, text };
}

async function waitForServer(timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return true;
    } catch { /* هنوز */ }
    await sleep(250);
  }
  return false;
}

/** کدِ ورود را از پنل می‌گیرد (سرور خانگی پیامک نمی‌فرستد) */
async function codeFor(phone, adminToken) {
  const r = await api('GET', '/api/site-server/messenger/codes', undefined, adminToken);
  const normalized = phone.startsWith('0') ? `+93${phone.slice(1)}` : phone;
  return r.json?.codes?.find((c) => c.phone === normalized)?.code ?? null;
}

/** یک کاربر می‌سازد و توکنش را برمی‌گرداند */
async function signUp(phone, name, adminToken) {
  await api('POST', '/api/messenger/request-code', { phone });
  const code = await codeFor(phone, adminToken);
  const r = await api('POST', '/api/messenger/verify-code', { phone, code, name });
  return { token: r.json?.token, user: r.json?.user, code };
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/messenger?token=${encodeURIComponent(token)}`);
    const inbox = [];
    const timer = setTimeout(() => reject(new Error('timeout')), 6000);
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      inbox.push(m);
      if (m.op === 'ready') {
        clearTimeout(timer);
        resolve({ ws, inbox });
      }
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

const waitFor = async (inbox, op, ms = 4000) => {
  const started = Date.now();
  while (Date.now() - started < ms) {
    const found = inbox.find((m) => m.op === op);
    if (found) return found;
    await sleep(100);
  }
  return null;
};

async function main() {
  console.log('\n▶ راه‌اندازی سرور آزمایشی...');
  if (!(await waitForServer())) {
    console.log(serverOut);
    throw new Error('سرور بالا نیامد');
  }
  const adminToken = (
    await api('POST', '/api/auth/setup', { username: 'admin', password: 'HomeServer!2026' })
  ).json?.token;

  console.log('\n── ثبت‌نام با شمارهٔ موبایل ──');
  const ali = await signUp('0700123456', 'علی', adminToken);
  const sara = await signUp('0700999888', 'سارا', adminToken);
  check('کدِ ورود ساخته شد', Boolean(ali.code) && /^\d{6}$/.test(ali.code));
  check('کاربر اول ساخته شد', Boolean(ali.token) && ali.user?.name === 'علی', JSON.stringify(ali.user));
  check('کاربر دوم ساخته شد', Boolean(sara.token));
  check('شماره به شکل بین‌المللی ذخیره شد', ali.user?.phone === '+93700123456', String(ali.user?.phone));

  let r = await api('POST', '/api/messenger/verify-code', { phone: '0700123456', code: '000000' });
  check('کدِ غلط رد می‌شود', r.status === 400);

  console.log('\n── پیدا کردن مخاطب از روی دفترچهٔ گوشی ──');
  r = await api('POST', '/api/messenger/contacts/lookup', { phones: ['0700999888', '0700000000'] }, ali.token);
  check('فقط شماره‌هایی که حساب دارند برمی‌گردند', r.json?.contacts?.length === 1, JSON.stringify(r.json?.contacts));
  check('و خودش در فهرست نیست', !r.json?.contacts?.some((c) => c.id === ali.user.id));

  console.log('\n── پیام زنده، وقتی هر دو آنلاین‌اند ──');
  const aliWs = await connect(ali.token);
  const saraWs = await connect(sara.token);
  check('هر دو وصل شدند', Boolean(aliWs.ws && saraWs.ws));

  r = await api('POST', '/api/messenger/chats/direct', { phone: '0700999888' }, ali.token);
  const chatId = r.json?.chatId;
  check('گفت‌وگوی دونفره ساخته شد', Boolean(chatId));

  r = await api('POST', '/api/messenger/chats/direct', { phone: '0700999888' }, ali.token);
  check('دوباره ساخته نمی‌شود — همان قبلی', r.json?.chatId === chatId);

  aliWs.ws.send(JSON.stringify({ op: 'send', id: 'm1', chatId, body: 'سلام سارا' }));
  const got = await waitFor(saraWs.inbox, 'message');
  check('پیام فوری به طرف مقابل رسید', got?.message?.body === 'سلام سارا', JSON.stringify(got?.message));
  check('و فرستنده معلوم است', got?.sender?.name === 'علی');

  console.log('\n── تیک‌ها ──');
  const msgId = got.message.id;
  r = await api('GET', `/api/messenger/messages/${msgId}/receipts`, undefined, ali.token);
  check('پیام «رسیده» علامت خورد', r.json?.delivered === 1 && r.json?.read === 0, JSON.stringify(r.json));

  await api('POST', `/api/messenger/chats/${chatId}/read`, { upToId: msgId }, sara.token);
  r = await api('GET', `/api/messenger/messages/${msgId}/receipts`, undefined, ali.token);
  check('بعد از خواندن، «خوانده‌شده» می‌شود', r.json?.read === 1, JSON.stringify(r.json));
  const readEvent = await waitFor(aliWs.inbox, 'read');
  check('و فرستنده زنده خبردار می‌شود', readEvent?.chatId === chatId);

  console.log('\n── پیام وقتی برنامه بسته است (نوتیفیکیشن) ──');
  // سارا دستگاهش را ثبت می‌کند، بعد برنامه را می‌بندد
  // کلیدِ واقعیِ P-256، دقیقاً همان چیزی که مرورگر می‌سازد — تا رمزگذاری
  // واقعاً آزموده شود، نه با کلیدِ الکی
  const browserKey = crypto.createECDH('prime256v1');
  browserKey.generateKeys();
  const fakeKeys = {
    p256dh: browserKey.getPublicKey().toString('base64url'),
    auth: crypto.randomBytes(16).toString('base64url'),
  };
  r = await api(
    'POST',
    '/api/messenger/devices',
    { subscription: { endpoint: `http://127.0.0.1:${pushPort}/push/sara`, keys: fakeKeys }, label: 'گوشی سارا' },
    sara.token
  );
  check('دستگاه برای نوتیفیکیشن ثبت شد', r.json?.ok === true && r.json?.devices >= 1);

  saraWs.ws.close();
  await sleep(600); // تا سرور بفهمد آفلاین شده

  const before = pushHits.length;
  r = await api('POST', `/api/messenger/chats/${chatId}/messages`, { body: 'بیداری؟' }, ali.token);
  check('پیام ذخیره شد', r.json?.ok === true && r.json?.message?.body === 'بیداری؟');
  await sleep(1200);
  check('نوتیفیکیشن فرستاده شد', pushHits.length > before, `${before} → ${pushHits.length}`);
  const hit = pushHits[pushHits.length - 1];
  check('به آدرسِ همان دستگاه رفت', hit?.url === '/push/sara', String(hit?.url));
  check('با امضای VAPID', /^vapid t=.+, k=.+/.test(hit?.auth || ''), String(hit?.auth).slice(0, 40));
  check('و بدنه رمزگذاری‌شده است', (hit?.bytes || 0) > 80, String(hit?.bytes));

  console.log('\n── پیام‌ها گم نمی‌شوند ──');
  const back = await connect(sara.token);
  const ready = back.inbox.find((m) => m.op === 'ready');
  const chat = ready?.chats?.find((c) => c.id === chatId);
  check('بعد از باز کردن دوباره، گفت‌وگو هست', Boolean(chat));
  check('و پیامِ نخوانده شمرده شده', chat?.unread === 1, String(chat?.unread));
  r = await api('GET', `/api/messenger/chats/${chatId}/messages`, undefined, sara.token);
  check('تاریخچه کامل است', r.json?.messages?.length === 2, String(r.json?.messages?.length));

  console.log('\n── بدون محدودیتِ حجم پیام ──');
  // یک پیامِ خیلی بلند (۳ مگابایت) — باید سالم برسد، نه بریده و نه رد شده
  const big = 'ی'.repeat(3 * 1024 * 1024);
  r = await api('POST', `/api/messenger/chats/${chatId}/messages`, { body: big }, ali.token);
  check('پیام ۳ مگابایتی از راه HTTP پذیرفته شد', r.json?.ok === true, `${r.status} ${r.text.slice(0, 80)}`);
  check('و بریده نشده', r.json?.message?.body?.length === big.length, String(r.json?.message?.body?.length));

  r = await api('GET', `/api/messenger/chats/${chatId}/messages?limit=5`, undefined, sara.token);
  const stored = r.json?.messages?.find((m) => m.body?.length === big.length);
  check('همان‌طور کامل ذخیره شد', Boolean(stored), String(r.json?.messages?.map((m) => m.body?.length)));

  // و از راه WebSocket هم
  const bigWs = 'x'.repeat(2 * 1024 * 1024);
  const beforeCount = back.inbox.filter((m) => m.op === 'message').length;
  aliWs.ws.send(JSON.stringify({ op: 'send', id: 'big', chatId, body: bigWs }));
  let arrived = null;
  for (let i = 0; i < 60 && !arrived; i++) {
    await sleep(150);
    arrived = back.inbox.filter((m) => m.op === 'message').slice(beforeCount).find((m) => m.message?.body?.length === bigWs.length);
  }
  check('پیام ۲ مگابایتی از راه WebSocket هم رسید', Boolean(arrived), String(arrived?.message?.body?.length));

  console.log('\n── گروه ──');
  r = await api('POST', '/api/messenger/chats/group', { title: 'کارکنان پمپ', memberIds: [sara.user.id] }, ali.token);
  const groupId = r.json?.chatId;
  check('گروه ساخته شد', Boolean(groupId));
  aliWs.ws.send(JSON.stringify({ op: 'send', id: 'g1', chatId: groupId, body: 'سلام به همه' }));
  // در صندوق ورودی پیام‌های قبلی هم هست، پس دنبال همین گروه می‌گردیم
  let inGroup = null;
  for (let i = 0; i < 40 && !inGroup; i++) {
    await sleep(100);
    inGroup = back.inbox.find((m) => m.op === 'message' && m.message?.chatId === groupId);
  }
  check('پیام گروه به عضو رسید', inGroup?.message?.body === 'سلام به همه', String(inGroup?.message?.chatId));

  console.log('\n── امنیت ──');
  r = await api('GET', `/api/messenger/chats/${chatId}/messages`);
  check('بدون توکن دسترسی نیست', r.status === 401);
  const stranger = await signUp('0700555444', 'غریبه', adminToken);
  r = await api('GET', `/api/messenger/chats/${chatId}/messages`, undefined, stranger.token);
  check('غریبه پیام‌های دیگران را نمی‌بیند', r.status === 403, String(r.status));
  r = await api('POST', `/api/messenger/chats/${chatId}/messages`, { body: 'نفوذ' }, stranger.token);
  check('و نمی‌تواند در گفت‌وگوی دیگران بنویسد', r.status === 403);

  console.log('\n── از راه تونل هم در دسترس است ──');
  r = await api('GET', '/api/messenger/config', undefined, null, `http://127.0.0.1:${PUBLIC_PORT}`);
  check('API پیام‌رسان روی پورت عمومی هست', r.status === 200 && Boolean(r.json?.vapidPublicKey));
  r = await api('GET', '/api/sites', undefined, adminToken, `http://127.0.0.1:${PUBLIC_PORT}`);
  check('ولی پنل روی پورت عمومی نیست', r.status === 404, String(r.status));

  aliWs.ws.close();
  back.ws.close();

  console.log('\n════════════════════════════════════');
  console.log(`  موفق: ${passed}    ناموفق: ${failed}`);
  console.log('════════════════════════════════════\n');
}

try {
  await main();
} catch (e) {
  failed++;
  console.error('\n❌ آزمون شکست:', e.message);
  console.error(serverOut.slice(-1500));
} finally {
  child.kill('SIGTERM');
  pushServer.close();
  await sleep(400);
  await fsp.rm(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
