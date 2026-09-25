// ---------------------------------------------------------------------------
//  آزمونِ «گروهِ کارکنان»ِ هر پمپ (‎src/stations/chat.js‎)
//
//  سرورِ واقعی دو بار بالا می‌آید (بارِ دوم برای هرسِ ۱۵روزه روی دیسک) و
//  این‌ها قفل می‌شوند:
//    ۱) فرستادن و خواندن، ‎since‎ و ‎limit‎، شکلِ دقیقِ پاسخ
//    ۲) رمزِ برنامه و رمزِ خواندن هر دو؛ بی‌رمز ⇒ ۴۰۱؛ رمزِ غلط ⇒ ۴۰۴
//    ۳) ⛔ جداسازی: رمزِ پمپِ دیگر ⇒ ۴۰۴، و گروهِ هر پمپ فقط مالِ خودش
//    ۴) ‎cid‎ِ تکراری پیامِ دوتایی نمی‌سازد
//    ۵) سنجشِ ورودی (متنِ خالی و بلند، نقش، نام، ‎cid‎)
//    ۶) بیست پیامِ هم‌زمان ⇒ بیست شمارهٔ یکتا، همه روی دیسک
//    ۷) سقفِ شمار، هرسِ ۱۵ روزه، و ‎seq‎ که هرگز عقب نمی‌رود
//    ۸) دفترِ ‎sitesync‎ به ‎chat.json‎ دست نمی‌زند
//    ۹) پورتِ عمومی (همان که تونل و گوشیِ بیرون از پمپ می‌بیند)
//
//      node test/station-chat.mjs
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4941);
const SYNC_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const PUBLIC = `http://127.0.0.1:${SYNC_PORT}`;
const KEEP = 60;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-station-chat-'));
const dataDir = path.join(tmp, 'data');
const root = path.join(dataDir, 'stations');

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
let child = null;
let serverOut = '';

function boot(extraEnv = {}) {
  serverOut = '';
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', serverPath], {
    env: {
      ...process.env,
      HLP_PORT: String(PORT),
      HLP_SITESYNC_PORT: String(SYNC_PORT),
      HLP_HOST: '127.0.0.1',
      HLP_DATA_DIR: dataDir,
      HLP_SITES_ROOT: path.join(tmp, 'sites'),
      HLP_TUNNEL: '0',
      HLP_ACCOUNT_AUTOSTART: '0',
      HLP_METRICS_INTERVAL: '5000',
      HLP_CHAT_KEEP: String(KEEP),
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => (serverOut += d));
  child.stderr.on('data', (d) => (serverOut += d));
}

async function stop() {
  if (!child) return;
  const c = child;
  child = null;
  const gone = new Promise((r) => c.once('exit', r));
  c.kill('SIGTERM');
  await Promise.race([gone, new Promise((r) => setTimeout(r, 3000))]);
  if (c.exitCode === null && c.signalCode === null) {
    c.kill('SIGKILL');
    await Promise.race([gone, new Promise((r) => setTimeout(r, 2000))]);
  }
}

async function waitForServer(timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await fetch(`${BASE}/health`)).ok && (await fetch(`${PUBLIC}/health`)).ok) return true;
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

const bearer = (k) => ({ Authorization: `Bearer ${k}` });
const chatUrl = (code, q = '') => `/api/stations/${code}/chat${q}`;
const say = (code, key, body) => api('POST', chatUrl(code), body, bearer(key));
const shapeOk = (m) =>
  m && Number.isInteger(m.seq) && typeof m.cid === 'string' && typeof m.from === 'string'
  && ['admin', 'mirza', 'staff'].includes(m.role) && typeof m.text === 'string' && typeof m.at === 'number'
  && Object.keys(m).sort().join(',') === 'at,cid,from,role,seq,text';
const readDisk = (code) => JSON.parse(fs.readFileSync(path.join(root, code, 'chat.json'), 'utf8'));

try {
  boot();
  if (!(await waitForServer())) throw new Error('سرور بالا نیامد:\n' + serverOut);

  const one = await api('POST', '/api/stations/enroll', { code: 'chat1', name: 'پمپ یک' });
  const two = await api('POST', '/api/stations/enroll', { code: 'chat2', name: 'پمپ دو' });
  if (!one.json?.ok || !two.json?.ok) throw new Error('ثبتِ پمپ نشد: ' + JSON.stringify([one.json, two.json]));
  const T1 = one.json.token, R1 = one.json.readKey, T2 = two.json.token, R2 = two.json.readKey;

  // ── ۱) احراز و جداسازی ────────────────────────────────────────────────
  console.log('\n۱) رمز، و ⛔ جداسازیِ پمپ‌ها');
  const none = await api('GET', chatUrl('chat1'));
  check('بی‌رمز ⇒ ۴۰۱', none.status === 401 && none.json?.error === 'auth_required', JSON.stringify(none));
  const noneUnknown = await api('GET', chatUrl('nope-nope'));
  check('بی‌رمز روی پمپِ نبوده هم ۴۰۱ (بودنِ پمپ لو نمی‌رود)', noneUnknown.status === 401);
  const wrong = await api('GET', chatUrl('chat1'), undefined, bearer('wrong-wrong-wrong-key'));
  check('رمزِ غلط ⇒ ۴۰۴ با همان شکلِ خطا', wrong.status === 404 && wrong.json?.error === 'not_found', JSON.stringify(wrong.json));
  const crossT = await api('GET', chatUrl('chat1'), undefined, bearer(T2));
  check('⛔ رمزِ برنامهٔ پمپِ دیگر ⇒ ۴۰۴', crossT.status === 404);
  const crossR = await api('GET', chatUrl('chat1', `?token=${R2}`));
  check('⛔ رمزِ خواندنِ پمپِ دیگر ⇒ ۴۰۴', crossR.status === 404);
  const crossPost = await say('chat1', R2, { from: 'نفوذی', text: 'سلام' });
  check('⛔ فرستادن با رمزِ پمپِ دیگر ⇒ ۴۰۴', crossPost.status === 404);
  const unknown = await api('GET', chatUrl('nope-nope'), undefined, bearer(T1));
  check('پمپِ نبوده ⇒ ۴۰۴', unknown.status === 404 && unknown.json?.error === 'not_found');

  // ── ۲) فرستادن و خواندن ───────────────────────────────────────────────
  console.log('\n۲) فرستادن و خواندن');
  const empty = await api('GET', chatUrl('chat1'), undefined, bearer(R1));
  check('گروهِ تازه خالی است', empty.status === 200 && empty.json?.ok === true && empty.json.last === 0
    && Array.isArray(empty.json.messages) && empty.json.messages.length === 0, JSON.stringify(empty.json));
  check('relayDays = ۱۵', empty.json?.relayDays === 15);

  const a = await say('chat1', T1, { cid: 'desk-1', from: '  مدیر  ', role: 'admin', text: '  سلام به همه  ' });
  check('رمزِ برنامه (Bearer) می‌فرستد', a.status === 200 && a.json?.ok === true && shapeOk(a.json.message), JSON.stringify(a.json));
  check('نام و متن تمیز می‌شوند', a.json?.message?.from === 'مدیر' && a.json.message.text === 'سلام به همه');
  check('شمارهٔ اول ۱ است', a.json?.message?.seq === 1);

  const b = await api('POST', chatUrl('chat1', `?token=${R1}`), { cid: 'phone-1', from: 'کریم', text: 'حاضرم' });
  check('رمزِ خواندن (?token=) هم می‌فرستد', b.status === 200 && b.json?.message?.seq === 2, JSON.stringify(b.json));
  check('نقشِ پیش‌فرض staff', b.json?.message?.role === 'staff');
  const c = await say('chat1', R1, { cid: 'phone-2', from: 'میرزا', role: 'mirza', text: 'حساب‌ها بسته شد' });
  check('رمزِ خواندن (Bearer) هم می‌فرستد', c.json?.message?.seq === 3 && c.json.message.role === 'mirza');
  const xr = await api('POST', chatUrl('chat1'), { cid: 'phone-3', from: 'علی', text: 'با X-Read-Key' }, { 'X-Read-Key': R1 });
  check('X-Read-Key هم پذیرفته است', xr.status === 200 && xr.json?.message?.seq === 4);

  const all = await api('GET', chatUrl('chat1'), undefined, bearer(T1));
  check('همهٔ پیام‌ها به ترتیب', all.json?.messages?.map((m) => m.seq).join(',') === '1,2,3,4', JSON.stringify(all.json));
  check('هر پیام همان شکلِ قرارداد', all.json?.messages?.every(shapeOk));
  check('last = بزرگ‌ترین شماره', all.json?.last === 4);
  const since = await api('GET', chatUrl('chat1', `?since=2&token=${R1}`));
  check('since فقط پیام‌های بعدی را می‌دهد', since.json?.messages?.map((m) => m.seq).join(',') === '3,4' && since.json.last === 4);
  const lim = await api('GET', chatUrl('chat1', `?since=0&limit=2&token=${R1}`));
  check('limit رعایت می‌شود (اولی‌ها)', lim.json?.messages?.map((m) => m.seq).join(',') === '1,2' && lim.json.last === 4);
  const big = await api('GET', chatUrl('chat1', `?limit=99999&token=${R1}`));
  check('limitِ خیلی بزرگ خطا نیست', big.status === 200 && big.json.messages.length === 4);

  const other = await api('GET', chatUrl('chat2'), undefined, bearer(R2));
  check('⛔ گروهِ پمپِ دیگر پیام‌های این پمپ را ندارد', other.status === 200 && other.json.messages.length === 0 && other.json.last === 0);

  // ── ۳) ‎cid‎ِ تکراری ────────────────────────────────────────────────────
  console.log('\n۳) تکرارپذیری با cid');
  const dup = await say('chat1', R1, { cid: 'phone-1', from: 'کریم', text: 'حاضرم' });
  check('همان cid ⇒ همان پیام', dup.status === 200 && dup.json?.message?.seq === 2 && dup.json.duplicate === true, JSON.stringify(dup.json));
  const dupDiff = await say('chat1', T1, { cid: 'phone-1', from: 'دیگری', text: 'متنِ دیگر' });
  check('همان cid با متنِ دیگر هم پیامِ تازه نمی‌سازد', dupDiff.json?.message?.text === 'حاضرم');
  const afterDup = await api('GET', chatUrl('chat1'), undefined, bearer(T1));
  check('شمارِ پیام‌ها عوض نشد', afterDup.json?.messages?.length === 4 && afterDup.json.last === 4);
  const noCid = await say('chat1', T1, { from: 'مدیر', text: 'بی cid' });
  check('بی cid هم می‌فرستد (سرور شناسه می‌سازد)', noCid.status === 200 && noCid.json?.message?.cid.length > 0 && noCid.json.message.seq === 5);

  // ── ۴) سنجشِ ورودی ─────────────────────────────────────────────────────
  console.log('\n۴) سنجشِ ورودی');
  const bad = async (name, body, code) => {
    const r = await say('chat1', T1, body);
    check(name, r.status === 400 && r.json?.error === code && typeof r.json?.message === 'string', `${r.status} ${JSON.stringify(r.json)}`);
  };
  await bad('متنِ خالی رد می‌شود', { from: 'مدیر', text: '' }, 'empty');
  await bad('متنِ فقط فاصله رد می‌شود', { from: 'مدیر', text: '   \n ' }, 'empty');
  await bad('متنِ ۲۰۰۱ نویسه‌ای رد می‌شود', { from: 'مدیر', text: 'ا'.repeat(2001) }, 'text_too_long');
  await bad('نقشِ ناشناخته رد می‌شود', { from: 'مدیر', role: 'customer', text: 'سلام' }, 'bad_role');
  await bad('بی نامِ فرستنده رد می‌شود', { text: 'سلام' }, 'bad_from');
  await bad('نامِ ۶۱ نویسه‌ای رد می‌شود', { from: 'ن'.repeat(61), text: 'سلام' }, 'from_too_long');
  await bad('cidِ نامعتبر رد می‌شود', { cid: 'a b/c', from: 'مدیر', text: 'سلام' }, 'bad_cid');
  await bad('cidِ ۶۵ نویسه‌ای رد می‌شود', { cid: 'x'.repeat(65), from: 'مدیر', text: 'سلام' }, 'bad_cid');
  const edge = await say('chat1', T1, { cid: 'x'.repeat(64), from: 'ن'.repeat(60), text: 'ا'.repeat(2000) });
  check('مرزها (۶۴ · ۶۰ · ۲۰۰۰) پذیرفته‌اند', edge.status === 200 && edge.json?.message?.seq === 6, JSON.stringify(edge.json).slice(0, 200));
  const afterBad = await api('GET', chatUrl('chat1'), undefined, bearer(T1));
  check('هیچ ورودیِ ردشده‌ای ننشست', afterBad.json?.last === 6 && afterBad.json.messages.length === 6);

  // ── ۵) هم‌زمانی ────────────────────────────────────────────────────────
  console.log('\n۵) بیست پیامِ هم‌زمان');
  const burst = await Promise.all(Array.from({ length: 20 }, (_, i) =>
    say('chat1', i % 2 ? T1 : R1, { cid: `burst-${i}`, from: `کارمند ${i}`, text: `پیام ${i}` })));
  check('هر بیست پذیرفته شد', burst.every((r) => r.status === 200 && r.json?.ok), burst.map((r) => r.status).join(','));
  const seqs = burst.map((r) => r.json?.message?.seq).sort((x, y) => x - y);
  check('بیست شمارهٔ یکتا و پشتِ سرِ هم', new Set(seqs).size === 20 && seqs[0] === 7 && seqs[19] === 26, seqs.join(','));
  const disk = readDisk('chat1');
  check('همه روی دیسک نشستند', disk.seq === 26 && disk.messages.length === 26
    && new Set(disk.messages.map((m) => m.seq)).size === 26, `${disk.seq} ${disk.messages.length}`);
  check('هر بیست cid روی دیسک است', Array.from({ length: 20 }, (_, i) => `burst-${i}`).every((cid) => disk.messages.some((m) => m.cid === cid)));
  if (process.platform !== 'win32') {
    const mode = fs.statSync(path.join(root, 'chat1', 'chat.json')).mode & 0o777;
    check('chat.json با دسترسیِ ۰۶۰۰', mode === 0o600, mode.toString(8));
  }
  check('هیچ فایلِ موقتی نماند', !fs.readdirSync(path.join(root, 'chat1')).some((n) => n.endsWith('.tmp')));

  // ── ۶) دفترِ sitesync به chat.json دست نمی‌زند ─────────────────────────
  console.log('\n۶) chat.json مالِ دفترِ خودش است');
  const put = await api('PUT', '/api/stations/chat1/data/chat', { value: { seq: 0, messages: [] } }, bearer(T1));
  await new Promise((r) => setTimeout(r, 1200)); // از debounceِ دفتر بگذرد
  const diskAfterPut = readDisk('chat1');
  check('⛔ PUT /data/chat فایلِ گروه را پاک نکرد', put.status === 200 && diskAfterPut.messages.length === 26, JSON.stringify(put.json));
  const viaData = await api('GET', '/api/stations/chat1/data/chat', undefined, bearer(T1));
  check('/data/chat چیزی از گروه نشان نمی‌دهد', viaData.status === 200 && viaData.json?.value === null, JSON.stringify(viaData.json));

  // ── ۷) پورتِ عمومی ─────────────────────────────────────────────────────
  console.log('\n۷) پورتِ عمومی (تونل)');
  const pubPost = await api('POST', `${PUBLIC}/api/stations/chat1/chat?token=${R1}`, { cid: 'pub-1', from: 'بیرون از پمپ', text: 'از راهِ تونل' });
  check('فرستادن از پورتِ عمومی', pubPost.status === 200 && pubPost.json?.message?.seq === 27, JSON.stringify(pubPost.json));
  const pubGet = await api('GET', `${PUBLIC}/api/stations/chat1/chat?since=26`, undefined, bearer(R1));
  check('خواندن از پورتِ عمومی', pubGet.status === 200 && pubGet.json?.messages?.[0]?.cid === 'pub-1');
  const pubV1 = await api('GET', `${PUBLIC}/api/v1/stations/chat1/chat?since=26`, undefined, bearer(T1));
  check('از /api/v1 هم', pubV1.status === 200 && pubV1.json?.messages?.length === 1);
  const pubCross = await api('GET', `${PUBLIC}/api/stations/chat1/chat`, undefined, bearer(R2));
  check('⛔ جداسازی روی پورتِ عمومی هم', pubCross.status === 404);
  const pre = await fetch(`${PUBLIC}/api/stations/chat1/chat`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://kar.example', 'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type' },
  });
  const allow = String(pre.headers.get('access-control-allow-headers') || '').toLowerCase();
  check('پیش‌پروازِ CORS: Authorization و Content-Type', pre.status === 204 && allow.includes('authorization') && allow.includes('content-type'), allow);

  // ── ۸) سقفِ شمار ────────────────────────────────────────────────────────
  console.log(`\n۸) سقفِ شمار (${KEEP} در این آزمون، ۲۰۰۰ در کارِ واقعی)`);
  for (let i = 0; i < 40; i++) await say('chat1', T1, { cid: `fill-${i}`, from: 'مدیر', text: `پر کردن ${i}` });
  const capped = await api('GET', chatUrl('chat1', '?limit=500'), undefined, bearer(T1));
  check(`بیش از ${KEEP} پیام نمی‌ماند`, capped.json?.messages?.length === KEEP, String(capped.json?.messages?.length));
  check('کهنه‌ترین‌ها رفتند، تازه‌ترین ماند', capped.json?.last === 67 && capped.json.messages[KEEP - 1].seq === 67
    && capped.json.messages[0].seq === 67 - KEEP + 1);
  check('روی دیسک هم', readDisk('chat1').messages.length === KEEP && readDisk('chat1').seq === 67);
  const next = await say('chat1', T1, { cid: 'after-cap', from: 'مدیر', text: 'بعد از سقف' });
  check('seq پس از بریدن عقب نمی‌رود', next.json?.message?.seq === 68);

  // ── ۹) هرسِ ۱۵ روزه و ماندگاری ──────────────────────────────────────────
  console.log('\n۹) هرسِ ۱۵ روزه — پس از بالا آمدنِ دوباره');
  await stop();
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const d1 = readDisk('chat1');
  d1.messages[0].at = now - 16 * DAY; // کهنه‌ترین پیام ⇒ ۱۶ روز پیش
  d1.messages[1].at = now - 14 * DAY; // هنوز داخلِ ۱۵ روز
  fs.writeFileSync(path.join(root, 'chat1', 'chat.json'), JSON.stringify(d1));
  const oldSeq = d1.messages[0].seq;
  const keptSeq = d1.messages[1].seq;
  // پمپ دوم: همهٔ پیام‌ها کهنه
  fs.writeFileSync(path.join(root, 'chat2', 'chat.json'), JSON.stringify({
    seq: 7,
    messages: [{ seq: 7, cid: 'old', from: 'قدیمی', role: 'staff', text: 'کهنه', at: now - 20 * DAY }],
  }));

  boot();
  if (!(await waitForServer())) throw new Error('سرور بارِ دوم بالا نیامد:\n' + serverOut);
  const re = await api('GET', chatUrl('chat1', '?limit=500'), undefined, bearer(T1));
  check('رمزها پس از بالا آمدنِ دوباره همان‌اند', re.status === 200, JSON.stringify(re.json));
  check('پیامِ ۱۶روزه رفت', !re.json?.messages?.some((m) => m.seq === oldSeq));
  check('پیامِ ۱۴روزه ماند', re.json?.messages?.some((m) => m.seq === keptSeq));
  check('last همان ماند', re.json?.last === 68);
  await new Promise((r) => setTimeout(r, 300));
  check('هرس روی دیسک هم نشست', !readDisk('chat1').messages.some((m) => m.seq === oldSeq));

  const r2 = await api('GET', chatUrl('chat2'), undefined, bearer(R2));
  check('پمپ دوم: همه هرس شدند', r2.json?.messages?.length === 0, JSON.stringify(r2.json));
  check('⛔ ولی last عقب نرفت (۷)', r2.json?.last === 7);
  const p2 = await say('chat2', R2, { cid: 'fresh', from: 'کارمند', text: 'تازه' });
  check('پیامِ بعدی شمارهٔ ۸ می‌گیرد', p2.json?.message?.seq === 8, JSON.stringify(p2.json));
  const p1 = await say('chat1', T1, { cid: 'after-restart', from: 'مدیر', text: 'پس از بالا آمدن' });
  check('پمپ یک هم از ۶۹ ادامه می‌دهد', p1.json?.message?.seq === 69);
  const dupAfterRestart = await say('chat1', T1, { cid: 'after-cap', from: 'مدیر', text: 'بعد از سقف' });
  check('cid پس از بالا آمدنِ دوباره هم شناخته است', dupAfterRestart.json?.duplicate === true && dupAfterRestart.json.message.seq === 68);

  // ── ۱۰) چیدمانِ پوشه ────────────────────────────────────────────────────
  console.log('\n۱۰) چیدمانِ پوشه');
  const { LAYOUT, describeFolder } = await import('../src/stations/layout.js');
  const entry = LAYOUT.find((e) => e.name === 'chat.json');
  check('chat.json در LAYOUT است و راز نیست', entry && !entry.secret);
  const folder = describeFolder(root, 'chat1');
  check('پوشهٔ پمپ chat.json را «هست» می‌بیند، نه ناشناخته',
    folder.items.find((i) => i.name === 'chat.json')?.exists === true && !folder.extras.some((x) => x.name === 'chat.json'));

  // ── ۱۱) قاعده‌های سورس ────────────────────────────────────────────────
  console.log('\n۱۱) قاعده‌های سورس');
  const chatSrc = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'stations', 'chat.js'), 'utf8')
    .replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const idxSrc = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'stations', 'index.js'), 'utf8');
  check('⛔ هیچ setIntervalی در گروهِ کارکنان نیست (هرسِ تنبل)', !/setInterval\s*\(/.test(chatSrc));
  check('نوشتنِ گروه گذرگاهِ زنده را با bumpSoon(\'stations\') بیدار می‌کند',
    /createStationChat\(\{[^}]*bumpSoon\('stations'/.test(idxSrc));
  check('دفترِ sitesync شاخهٔ chat را رزرو کرده', /reserved:\s*\[CHAT_BRANCH\]/.test(idxSrc));
  check('نوشتن اتمی است (فایلِ موقت + rename) و ۰۶۰۰', /\.tmp`/.test(chatSrc) && /fsp\.rename\(/.test(chatSrc) && /0o600/.test(chatSrc));
} catch (e) {
  failed++;
  console.log(`\n❌ آزمون شکست: ${e.message}`);
  if (serverOut) console.log(serverOut.slice(-3000));
} finally {
  await stop();
  await fsp.rm(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} ✅   ${failed} ❌`);
process.exit(failed ? 1 : 0);
