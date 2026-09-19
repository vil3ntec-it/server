// ---------------------------------------------------------------------------
//  آزمونِ «اطلاعیه» — روی سرورِ واقعی
//
//      node test/announce.mjs
//
//  سؤالی که می‌سنجد ساده است: اگر از برنامهٔ مدیر یک پیام بگذارم، آیا
//  همان پیام روی صفحهٔ همان برنامه‌ها می‌آید — و آیا روی صفحهٔ برنامه‌های
//  دیگر *نمی‌آید*؟
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4793);
const BASE = `http://127.0.0.1:${PORT}`;

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-announce-'));
const sitesRoot = path.join(tmp, 'sites');
fs.mkdirSync(sitesRoot, { recursive: true });

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

const child = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')],
  {
    env: {
      ...process.env,
      HLP_PORT: String(PORT),
      HLP_SITESYNC_PORT: String(PORT + 1),
      HLP_HOST: '127.0.0.1',
      HLP_DATA_DIR: path.join(tmp, 'data'),
      HLP_SITES_ROOT: sitesRoot,
      HLP_TUNNEL: '0',
      HLP_AI_ENABLED: '0',
      HLP_SITESYNC: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));

let token = null;
const call = async (method, url, body, extra = {}) => {
  const headers = { 'Content-Type': 'application/json', ...extra };
  if (token && !extra.noAuth) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const started = Date.now();
  let up = false;
  while (Date.now() - started < 25_000) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) {
        up = true;
        break;
      }
    } catch { /* هنوز */ }
    await wait(200);
  }
  if (!up) throw new Error(`سرور بالا نیامد:\n${out}`);

  console.log('\n── ورودِ مدیر ──');
  const setup = await call('POST', '/api/auth/setup', { username: 'admin', password: 'ControlCenter!2026' });
  token = setup.body?.token
    || (await call('POST', '/api/auth/login', { username: 'admin', password: 'ControlCenter!2026' })).body?.token;
  check('مدیر وارد شد', Boolean(token));

  console.log('\n── بی اطلاعیه، هیچ‌کس چیزی نمی‌بیند ──');
  const empty = await call('GET', '/api/announce?audience=shop', undefined, { noAuth: true });
  check('فهرست خالی است', empty.status === 200 && empty.body.notices?.length === 0,
    JSON.stringify(empty.body));

  console.log('\n── نوشتنِ اطلاعیه از برنامهٔ مدیر ──');
  const made = await call('POST', '/api/announce-admin', {
    audience: 'shop',
    title: 'تخفیفِ این هفته',
    body: 'تا جمعه ۲۰ درصد روی همهٔ اشتراک‌ها',
    kind: 'success',
  });
  check('ساخته شد', made.status === 200 && made.body.ok === true, JSON.stringify(made.body));
  check('همان لحظه زنده است', made.body.item?.live === true, JSON.stringify(made.body.item));
  const shopId = made.body.item?.id;

  const noTitle = await call('POST', '/api/announce-admin', { audience: 'all', body: 'بی عنوان' });
  check('بی عنوان رد می‌شود', noTitle.status === 400, JSON.stringify(noTitle.body));

  console.log('\n── فروشگاه می‌بیندش ──');
  const shopSees = await call('GET', '/api/announce?audience=shop', undefined, { noAuth: true });
  check('روی صفحهٔ فروشگاه هست', shopSees.body.notices?.[0]?.title === 'تخفیفِ این هفته',
    JSON.stringify(shopSees.body));
  check('متن هم می‌آید', shopSees.body.notices?.[0]?.body?.includes('۲۰ درصد'));
  check('رنگش گفته می‌شود', shopSees.body.notices?.[0]?.kind === 'success');

  console.log('\n── پمپ نمی‌بیندش ──');
  const pumpSees = await call('GET', '/api/announce?audience=station', undefined, { noAuth: true });
  check('روی صفحهٔ پمپ نیست', pumpSees.body.notices?.length === 0, JSON.stringify(pumpSees.body));

  console.log('\n── «همه» یعنی همه ──');
  await call('POST', '/api/announce-admin', {
    audience: 'all',
    title: 'سرور فردا ساعت ۲ خاموش می‌شود',
    kind: 'warn',
  });
  const everyone = await call('GET', '/api/announce?audience=station', undefined, { noAuth: true });
  check('پمپ اطلاعیهٔ عمومی را می‌بیند', everyone.body.notices?.length === 1, JSON.stringify(everyone.body));
  const bothForShop = await call('GET', '/api/announce?audience=shop', undefined, { noAuth: true });
  check('فروشگاه هر دو را می‌بیند', bothForShop.body.notices?.length === 2);
  check('مهم‌تر اول می‌آید', bothForShop.body.notices?.[0]?.kind === 'warn',
    JSON.stringify(bothForShop.body.notices?.map((n) => n.kind)));

  console.log('\n── پیامِ خصوصیِ یک حساب ──');
  await call('POST', '/api/announce-admin', {
    audience: 'shop',
    targetId: 'acct-42',
    title: 'اشتراکِ شما فردا تمام می‌شود',
    kind: 'danger',
  });
  const mine = await call('GET', '/api/announce?audience=shop&id=acct-42', undefined, { noAuth: true });
  check('صاحبش می‌بیند', mine.body.notices?.some((n) => n.title.includes('اشتراکِ شما')),
    JSON.stringify(mine.body.notices?.map((n) => n.title)));
  const others = await call('GET', '/api/announce?audience=shop&id=acct-99', undefined, { noAuth: true });
  check('بقیه نمی‌بینند', !others.body.notices?.some((n) => n.title.includes('اشتراکِ شما')),
    JSON.stringify(others.body.notices?.map((n) => n.title)));
  const anonymous = await call('GET', '/api/announce?audience=shop', undefined, { noAuth: true });
  check('بی‌نام هم نمی‌بیند', !anonymous.body.notices?.some((n) => n.title.includes('اشتراکِ شما')));

  console.log('\n── خاموش کردن و مهلت ──');
  const off = await call('PUT', `/api/announce-admin/${shopId}`, { enabled: false });
  check('خاموش شد', off.body.item?.enabled === false, JSON.stringify(off.body.item));
  const afterOff = await call('GET', '/api/announce?audience=shop', undefined, { noAuth: true });
  check('دیگر دیده نمی‌شود', !afterOff.body.notices?.some((n) => n.id === shopId));

  await call('POST', '/api/announce-admin', {
    audience: 'shop',
    title: 'گذشته',
    endsAt: Date.now() - 1000,
  });
  const expired = await call('GET', '/api/announce?audience=shop', undefined, { noAuth: true });
  check('اطلاعیهٔ منقضی نمی‌آید', !expired.body.notices?.some((n) => n.title === 'گذشته'));

  await call('POST', '/api/announce-admin', {
    audience: 'shop',
    title: 'هفتهٔ بعد',
    startsAt: Date.now() + 86_400_000,
  });
  const future = await call('GET', '/api/announce?audience=shop', undefined, { noAuth: true });
  check('اطلاعیهٔ آینده هنوز نمی‌آید', !future.body.notices?.some((n) => n.title === 'هفتهٔ بعد'));

  console.log('\n── درِ خودِ اطلاعیه‌ها روی پورتِ عمومی هم هست ──');
  /*
   *  تا ۱.۴۰.۰ اطلاعیه روی پاسخِ قیمت‌نامه و سلامتِ دفترِ حسابِ قدیمیِ پنل
   *  (‎/api/v1/plans‎ · ‎/api/v1/health‎ی توحید) هم سوار می‌شد. آن دفتر رفت و
   *  آن دو مسیر حالا مالِ سرورِ حساب‌اند؛ برنامه‌ها اطلاعیه را از درِ خودش
   *  می‌گیرند — که باید از تونل هم باز باشد.
   */
  const pub = await fetch(`http://127.0.0.1:${PORT + 1}/api/announce?audience=shop`).then((r) => r.json()).catch(() => ({}));
  check('‎/api/announce‎ روی پورتِ عمومی جواب می‌دهد', Array.isArray(pub.notices), JSON.stringify(pub).slice(0, 120));
  check('و همان اطلاعیه‌های فروشگاه است', pub.notices?.some((n) => n.title.includes('سرور فردا')),
    JSON.stringify(pub.notices?.map((n) => n.title)));

  console.log('\n── فهرستِ مدیر ──');
  const list = await call('GET', '/api/announce-admin');
  check('مدیر همه را می‌بیند', list.body.items?.length >= 5, String(list.body.items?.length));
  check('مخاطب‌ها گفته می‌شوند', list.body.audiences?.some((a) => a.key === 'station'));
  const gone = await call('DELETE', `/api/announce-admin/${shopId}`);
  check('پاک کردن کار می‌کند', gone.body.ok === true);

  console.log('\n── بی ورودِ مدیر، نوشتن ممکن نیست ──');
  const stranger = await call('POST', '/api/announce-admin', { title: 'من' }, { noAuth: true });
  check('ناشناس نمی‌تواند اطلاعیه بگذارد', stranger.status === 401, `status ${stranger.status}`);
} finally {
  child.kill('SIGTERM');
  await wait(400);
  await fsp.rm(tmp, { recursive: true, force: true });
}

console.log(`\n${failed ? '❌' : '✅'} ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed ? 1 : 0);
