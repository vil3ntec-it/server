// ---------------------------------------------------------------------------
// آزمونِ بارِ سرورِ سایت — «چرا برنامه یخ می‌زد»
//   node test/sitesync-load.mjs
//
// دو چیز را با هم ثابت می‌کند:
//   ۱) پروتکل مو‌به‌مو همان است (value / child_added / child_changed /
//      child_removed / limitToLast / get / push / update / onDisconnect)
//   ۲) و در عینِ حال، ویرایشِ یک حسابِ بزرگ نه حلقهٔ رویدادِ سرور را قفل می‌کند
//      نه ده‌ها مگابایت به گوشی می‌ریزد.
//
// عددهای نسخهٔ قبل روی همین آزمون: ۶۷۰۰ میلی‌ثانیه قفل و ۱۹۴ مگابایت ترافیک.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/sitesync/store.js';

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`);
  }
};

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-sitesync-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** رویدادها در یک «تیک» جمع می‌شوند، پس برای دیدنشان باید یک نفس صبر کرد */
const settle = () => sleep(40);

/** یک وب‌سوکتِ ساختگی که هرچه سرور فرستاد را نگه می‌دارد */
function fakeSocket() {
  const ws = {
    readyState: 1,
    OPEN: 1,
    bufferedAmount: 0,
    frames: [],
    bytes: 0,
    send(text) {
      ws.bytes += text.length;
      ws.frames.push(JSON.parse(text));
    },
    ping() {},
    close() {
      ws.readyState = 3;
      ws._close?.();
    },
    on(ev, fn) {
      if (ev === 'message') ws._msg = fn;
      if (ev === 'close') ws._close = fn;
    },
  };
  ws.tell = (obj) => ws._msg(Buffer.from(JSON.stringify(obj)));
  ws.events = (subId, type) =>
    ws.frames.filter((f) => f.op === 'event' && f.subId === subId && (!type || f.type === type));
  ws.reset = () => {
    ws.frames = [];
    ws.bytes = 0;
  };
  return ws;
}

function newStore(name) {
  const dir = path.join(tmp, name);
  const store = createStore({ key: name, dataDir: dir, token: '' });
  const ws = fakeSocket();
  store.handleConnection(ws, { socket: { remoteAddress: '127.0.0.1' } });
  return { store, ws, dir };
}

// ===========================================================================
console.log('\n── پروتکل: هرچه سایت انتظار دارد، همان می‌آید ──');
// ===========================================================================
{
  const { store, ws } = newStore('protocol');

  ws.tell({ op: 'set', id: 1, path: 'debtors', value: { a: { name: 'احمد', debt: 100 }, b: { name: 'بلال', debt: 200 } } });
  ws.tell({ op: 'sub', subId: 'v', path: 'debtors', event: 'value' });
  ws.tell({ op: 'sub', subId: 'ca', path: 'debtors', event: 'child_added' });
  ws.tell({ op: 'sub', subId: 'cc', path: 'debtors', event: 'child_changed' });
  ws.tell({ op: 'sub', subId: 'cr', path: 'debtors', event: 'child_removed' });
  await settle();

  const primed = ws.events('v', 'value').at(-1);
  check('اشتراکِ value همان لحظهٔ اول کلِ مقدار را می‌گیرد', primed?.value?.a?.name === 'احمد');
  check('اشتراکِ child_added برای بچه‌های موجود آتش می‌کند', ws.events('ca', 'child_added').length === 2);

  ws.reset();
  ws.tell({ op: 'set', id: 2, path: 'debtors/a/debt', value: 150 });
  await settle();
  check('عوض شدنِ یک بچه → child_changed برای همان یکی', ws.events('cc', 'child_changed').length === 1);
  check('و بچه‌های دست‌نخورده هیچ رویدادی نمی‌گیرند', ws.events('cc', 'child_changed')[0]?.key === 'a');
  check('value تازه هم می‌رسد', ws.events('v', 'value').at(-1)?.value?.a?.debt === 150);

  ws.reset();
  ws.tell({ op: 'push', id: 3, path: 'debtors', value: { name: 'جمال', debt: 5 } });
  await settle();
  const ack = ws.frames.find((f) => f.op === 'ack' && f.id === 3);
  check('push شناسه برمی‌گرداند', typeof ack?.key === 'string' && ack.key.length === 20);
  check('و child_added می‌فرستد', ws.events('ca', 'child_added').length === 1);

  ws.reset();
  ws.tell({ op: 'remove', id: 4, path: 'debtors/b' });
  await settle();
  check('remove → child_removed', ws.events('cr', 'child_removed')[0]?.key === 'b');

  ws.reset();
  ws.tell({ op: 'update', id: 5, path: 'debtors/a', value: { debt: 900, note: 'تسویه شد' } });
  await settle();
  const afterUpdate = ws.events('v', 'value').at(-1)?.value?.a;
  check('update هر دو کلید را می‌نشاند', afterUpdate?.debt === 900 && afterUpdate?.note === 'تسویه شد');
  check('و برای یک update فقط یک child_changed می‌آید (نه یکی به‌ازای هر کلید)',
    ws.events('cc', 'child_changed').length === 1, `${ws.events('cc', 'child_changed').length} رویداد`);

  ws.reset();
  ws.tell({ op: 'get', id: 6, path: 'debtors/a/debt' });
  const got = ws.frames.find((f) => f.op === 'result' && f.id === 6);
  check('get مقدارِ درست را برمی‌گرداند', got?.value === 900);
  ws.tell({ op: 'get', id: 7, path: 'debtors/nothing/here' });
  check('get روی مسیرِ نبوده null می‌دهد', ws.frames.find((f) => f.op === 'result' && f.id === 7)?.value === null);

  ws.reset();
  ws.tell({ op: 'set', id: 8, path: 'debtors/a/debt', value: 900 });
  await settle();
  check('نوشتنِ همان مقدارِ قبلی هیچ رویدادی نمی‌سازد', ws.events('v').length === 0 && ws.events('cc').length === 0);

  ws.reset();
  ws.tell({ op: 'unsub', subId: 'v' });
  ws.tell({ op: 'set', id: 9, path: 'debtors/a/debt', value: 1 });
  await settle();
  check('بعد از unsub دیگر رویداد نمی‌آید', ws.events('v').length === 0);
  check('ولی بقیهٔ اشتراک‌ها سرِ جایشان هستند', ws.events('cc', 'child_changed').length === 1);

  store.stop();
}

// ===========================================================================
console.log('\n── limitToLast: پنجرهٔ آخرین‌ها ──');
// ===========================================================================
{
  const { store, ws } = newStore('limit');
  ws.tell({ op: 'set', id: 1, path: 'log', value: { a: 1, b: 2, c: 3, d: 4 } });
  ws.tell({ op: 'sub', subId: 'L', path: 'log', event: 'child_added', limitToLast: 2 });
  await settle();
  const first = ws.events('L', 'child_added').map((e) => e.key);
  check('فقط دو تای آخر می‌آید', first.join(',') === 'c,d', first.join(','));

  ws.reset();
  ws.tell({ op: 'set', id: 2, path: 'log/e', value: 5 });
  await settle();
  check('کلیدِ تازه وارد پنجره می‌شود', ws.events('L', 'child_added').map((e) => e.key).join(',') === 'e');
  store.stop();
}

// ===========================================================================
console.log('\n── onDisconnect: وقتی گوشی قطع شد ──');
// ===========================================================================
{
  const { store, ws } = newStore('ondisc');
  const watcher = fakeSocket();
  store.handleConnection(watcher, { socket: { remoteAddress: '127.0.0.2' } });

  ws.tell({ op: 'set', id: 1, path: 'presence/ali', value: true });
  ws.tell({ op: 'onDisc', path: 'presence/ali', action: 'remove' });
  watcher.tell({ op: 'sub', subId: 'p', path: 'presence', event: 'value' });
  await settle();

  watcher.reset();
  ws.close();
  await settle();
  // مثل همیشه: بچه پاک می‌شود ولی خودِ شاخه (حتی خالی) سرِ جایش می‌ماند
  check('با قطع شدن، مقدار پاک می‌شود', watcher.events('p', 'value').at(-1)?.value?.ali === undefined);
  check('و اشتراک‌های همان اتصال هم پاک می‌شوند', store.snapshot().subscriptions === 1);
  check('اتصالِ بسته از فهرست بیرون می‌رود', store.snapshot().liveConnections === 1);
  store.stop();
}

// ===========================================================================
console.log('\n── ماندگاری روی دیسک ──');
// ===========================================================================
{
  const { store, ws, dir } = newStore('persist');
  ws.tell({ op: 'set', id: 1, path: 'settings', value: { theme: 'dark', pin: '1234' } });
  await store.flush();
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  check('همان چیزی که نوشته شد روی دیسک است', onDisk.theme === 'dark' && onDisk.pin === '1234');

  const before = fs.statSync(path.join(dir, 'settings.json')).mtimeMs;
  ws.tell({ op: 'set', id: 2, path: 'settings/theme', value: 'dark' }); // بی‌تغییر
  await store.flush();
  await sleep(20);
  check('نوشتنِ تکراری دیسک را بی‌جهت نمی‌چرخاند',
    fs.statSync(path.join(dir, 'settings.json')).mtimeMs === before);

  ws.tell({ op: 'remove', id: 3, path: 'settings' });
  await store.flush();
  check('حذفِ شاخه فایلش را هم می‌برد', !fs.existsSync(path.join(dir, 'settings.json')));
  store.stop();
}

// ===========================================================================
console.log('\n── تایپِ پیوسته روی یک حسابِ بزرگ (همان جایی که یخ می‌زد) ──');
// ===========================================================================
{
  const { store, ws } = newStore('load');

  // ۶۰۰ قرض‌دار، هرکدام ۴۰ ردیف — یعنی همان حجمی که روی گوشی هنگ می‌کرد
  const debtors = {};
  for (let i = 0; i < 600; i++) {
    const rows = {};
    for (let r = 0; r < 40; r++) {
      rows['r' + r] = { d: `1405/05/${(r % 30) + 1}`, amount: r * 137, note: `یادداشتِ نمونهٔ ${r}`, kind: r % 3 ? 'oil' : 'cash' };
    }
    debtors['p' + i] = { name: `قرض‌دارِ شمارهٔ ${i}`, phone: `+9370000${i}`, pct: { petrol: 3, diesel: 2 }, rows };
  }
  ws.tell({ op: 'set', id: 1, path: 'debtors', value: debtors });
  ws.tell({ op: 'sub', subId: 'v', path: 'debtors', event: 'value' });
  ws.tell({ op: 'sub', subId: 'cc', path: 'debtors', event: 'child_changed' });
  ws.tell({ op: 'sub', subId: 'ca', path: 'debtors', event: 'child_added' });
  await settle();
  ws.reset();

  const WRITES = 100;
  let blockedMs = 0;
  for (let i = 0; i < WRITES; i++) {
    const t = process.hrtime.bigint();
    ws.tell({ op: 'set', id: 100 + i, path: `debtors/p5/rows/r${i % 40}/amount`, value: i });
    blockedMs += Number(process.hrtime.bigint() - t) / 1e6;
    if (i % 10 === 9) await settle();   // مثل تایپِ واقعی، نه یک انفجارِ یک‌جا
  }
  await sleep(400);

  const mb = ws.bytes / 1048576;
  check('حلقهٔ رویدادِ سرور قفل نمی‌شود', blockedMs < 300, `${blockedMs.toFixed(1)}ms برای ${WRITES} نوشتن (قبلاً ~6700ms)`);
  check('ترافیکِ گوشی معقول می‌ماند', mb < 25, `${mb.toFixed(1)}MB (قبلاً ~194MB)`);
  check('برای هر تغییر فقط همان یک قرض‌دار child_changed می‌گیرد',
    ws.events('cc', 'child_changed').every((e) => e.key === 'p5'));
  check('هیچ قرض‌دارِ تازه‌ای از هوا ساخته نمی‌شود', ws.events('ca', 'child_added').length === 0);

  // مهم‌ترین چیز: با همهٔ این جمع‌وجور کردن‌ها، آخرین حالت باید درست رسیده باشد
  // ردیفِ r9 در نوشتن‌های ۹ و ۴۹ و ۸۹ عوض شد، پس مقدارِ نهایی‌اش ۸۹ است
  const last = ws.events('v', 'value').at(-1)?.value;
  check('آخرین مقدار دقیقاً همان چیزی است که نوشته شد',
    last?.p5?.rows?.r9?.amount === 89, `r9 = ${last?.p5?.rows?.r9?.amount}`);
  check('و شاخهٔ دست‌نخورده سالم مانده', last?.p600 === undefined && last?.p7?.rows?.r0?.amount === 0);
  store.stop();
}

// ===========================================================================
console.log('\n── گوشیِ کند: پیام روی پیام تلنبار نمی‌شود ──');
// ===========================================================================
{
  const { store, ws } = newStore('slow');
  ws.tell({ op: 'set', id: 1, path: 'big', value: Object.fromEntries([...Array(400)].map((_, i) => [i, 'x'.repeat(500)])) });
  ws.tell({ op: 'sub', subId: 'v', path: 'big', event: 'value' });
  await settle();

  ws.reset();
  ws.bufferedAmount = 64 * 1024 * 1024;   // گوشی عقب افتاده
  ws.tell({ op: 'set', id: 2, path: 'big/0', value: 'تازه' });
  await settle();
  // ack کوچک است و باید برسد؛ آنچه عقب می‌افتد دادهٔ حجیمِ رویداد است
  check('تا صفِ اتصال خالی نشده، دادهٔ حجیم فرستاده نمی‌شود', ws.events('v').length === 0);

  ws.bufferedAmount = 0;                   // شبکه برگشت
  await sleep(300);
  check('به‌محضِ خالی شدنِ صف، آخرین حالت می‌رسد', ws.events('v', 'value').at(-1)?.value?.['0'] === 'تازه');
  store.stop();
}

// ===========================================================================
console.log('\n── از راهِ یک وب‌سوکتِ واقعی (همان‌طور که خودِ سایت وصل می‌شود) ──');
// ===========================================================================
{
  const { spawn } = await import('node:child_process');
  const { WebSocket } = await import('ws');

  const PORT = Number(process.env.TEST_PORT || 4796);
  const child = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')],
    {
      env: {
        ...process.env,
        HLP_PORT: String(PORT),
        HLP_SITESYNC_PORT: '0',
        HLP_HOST: '127.0.0.1',
        HLP_DATA_DIR: path.join(tmp, 'e2e-data'),
        HLP_SITES_ROOT: path.join(tmp, 'e2e-sites'),
        HLP_TUNNEL: '0',
        HLP_AI_ENABLED: '0',
      },
      stdio: 'ignore',
    }
  );

  try {
    let up = false;
    for (let i = 0; i < 80 && !up; i++) {
      try {
        up = (await fetch(`http://127.0.0.1:${PORT}/health`)).ok;
      } catch { /* هنوز */ }
      if (!up) await sleep(250);
    }
    if (!up) throw new Error('سرور بالا نیامد');

    const token = (await fsp.readFile(path.join(tmp, 'e2e-data', 'site-sync', 'token.txt'), 'utf8')).trim();
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${encodeURIComponent(token)}`);
    const got = [];
    ws.on('message', (raw) => got.push(JSON.parse(raw.toString())));
    await new Promise((res, rej) => {
      ws.once('open', res);
      ws.once('error', rej);
      setTimeout(() => rej(new Error('اتصال برقرار نشد')), 8000);
    });
    const tell = (o) => ws.send(JSON.stringify(o));

    tell({ op: 'set', id: 1, path: 'tank/level', value: 10 });
    tell({ op: 'sub', subId: 's', path: 'tank', event: 'value' });
    await sleep(200);
    check('اشتراک از راهِ وب‌سوکتِ واقعی کار می‌کند',
      got.some((f) => f.op === 'event' && f.subId === 's' && f.value?.level === 10));

    // ۲۰۰ نوشتنِ پشت‌سرهم — روی سوکتِ واقعی هم باید جمع شود، نه ۲۰۰ پیام
    got.length = 0;
    for (let i = 0; i < 200; i++) tell({ op: 'set', id: 10 + i, path: 'tank/level', value: i });
    await sleep(600);
    const events = got.filter((f) => f.op === 'event');
    check('۲۰۰ نوشتنِ پشت‌سرهم چند پیام می‌شود، نه ۲۰۰ تا', events.length < 30, `${events.length} رویداد`);
    check('و آخرین حالت درست است', events.at(-1)?.value?.level === 199, `level = ${events.at(-1)?.value?.level}`);

    // ping/pong: اتصالِ زنده نباید قربانیِ ضربان شود
    const pinged = new Promise((res) => ws.once('ping', () => res(true)));
    ws.ping();
    await sleep(200);
    check('اتصال بعد از رفت‌وبرگشتِ ضربان باز می‌ماند', ws.readyState === WebSocket.OPEN);
    void pinged;
    ws.close();
  } catch (e) {
    fail++;
    console.log(`  ❌ آزمونِ سرتاسری اجرا نشد — ${e.message}`);
  } finally {
    child.kill('SIGTERM');
    await sleep(600);
    child.kill('SIGKILL');
  }
}

await fsp.rm(tmp, { recursive: true, force: true });

console.log('\n════════════════════════════════════');
console.log(`  موفق: ${pass}    ناموفق: ${fail}`);
console.log('════════════════════════════════════\n');
process.exit(fail ? 1 : 0);
