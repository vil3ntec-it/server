// ---------------------------------------------------------------------------
//  آزمونِ آینهٔ ابر در پوشهٔ داده
//    ۱) بی وصل بودن به ابر هیچ چیزی نمی‌گیرد ولی mirror.json می‌گوید چرا
//    ۲) با ابر، هر فهرست (پمپ و دکان) به فایلِ خودش می‌رود
//    ۳) یک مسیرِ خراب بقیه را نمی‌خواباند و فایلِ قبلی می‌ماند
//    ۴) هیچ رمز/توکنی در پوشه نمی‌نشیند
//
//      node test/cloud-mirror.mjs
// ---------------------------------------------------------------------------
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runMirror, MIRROR_PLAN, readMirrorStatus } from '../src/stations/cloud-mirror.js';

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-mirror-'));
try {
  console.log('\n۱) وصل نیست');
  const off = await runMirror({ dataDir: tmp, status: () => ({ linked: false, base: 'x' }), call: async () => { throw new Error('نباید صدا زده شود'); } });
  check('رد می‌شود، بی خطا', off.skipped === 'not_linked');
  check('mirror.json نوشته شد', readMirrorStatus(tmp)?.skipped === 'not_linked');
  check('هیچ فایلِ داده‌ای ساخته نشد', !fs.existsSync(path.join(tmp, 'cloud', 'pump')));

  console.log('\n۲) وصل است — همه‌چیز به پوشه می‌آید');
  const calls = [];
  const fake = async (name, { query }) => {
    calls.push(name);
    if (name === 'users') return { users: [{ id: 'u1', name: 'کریم', email: 'k@x', token: undefined }], total: 1 };
    if (name === 'shops') return { shops: [{ id: 's1', name: 'دکانِ الف' }] };
    return { [name]: [], query };
  };
  const rep = await runMirror({ dataDir: tmp, status: () => ({ linked: true, base: 'https://api.vill3n.top' }), call: fake, reason: 'manual' });
  check('همهٔ مسیرهای نقشه صدا زده شدند', calls.length === MIRROR_PLAN.length, `${calls.length}/${MIRROR_PLAN.length}`);
  check('هیچ‌کدام نرفت‌نشده', rep.failed.length === 0 && rep.ok.length === MIRROR_PLAN.length);
  const users = JSON.parse(fs.readFileSync(path.join(tmp, 'cloud', 'pump', 'users.json'), 'utf8'));
  check('حساب‌های پمپ در cloud/pump/users.json', users.data.users[0].name === 'کریم' && users.source === 'users');
  const shops = JSON.parse(fs.readFileSync(path.join(tmp, 'cloud', 'shop', 'shops.json'), 'utf8'));
  check('دکان‌ها هم در cloud/shop/shops.json', shops.data.shops[0].name === 'دکانِ الف');
  check('اشتراک‌های دکان هم هست', fs.existsSync(path.join(tmp, 'cloud', 'shop', 'subscriptions.json')));
  check('کدهای شش‌رقمی هم هست', fs.existsSync(path.join(tmp, 'cloud', 'pump', 'vip-codes.json')));
  check('گزارش می‌گوید دستی بود', readMirrorStatus(tmp)?.reason === 'manual');

  console.log('\n۳) یک مسیر خراب است');
  const half = async (name, o) => (name === 'shops' ? Promise.reject(new Error('cloud_session_expired')) : fake(name, o));
  const rep2 = await runMirror({ dataDir: tmp, status: () => ({ linked: true, base: 'x' }), call: half });
  check('فقط همان یکی نرفت', rep2.failed.length === 1 && rep2.failed[0].file === 'shop/shops');
  check('دلیلش نوشته شد', rep2.failed[0].error.includes('expired'));
  const shops2 = JSON.parse(fs.readFileSync(path.join(tmp, 'cloud', 'shop', 'shops.json'), 'utf8'));
  check('فایلِ قبلی سرِ جایش ماند', shops2.data.shops[0].name === 'دکانِ الف');

  console.log('\n۴) هیچ رمزی در پوشه نیست');
  let leak = false;
  for (const f of fs.readdirSync(path.join(tmp, 'cloud'), { recursive: true })) {
    const full = path.join(tmp, 'cloud', String(f));
    if (fs.statSync(full).isFile() && /Bearer |"token":"/.test(fs.readFileSync(full, 'utf8'))) leak = true;
  }
  check('نه توکن نه رمز', !leak);
  check('فایلِ موقتی جا نمانده', !fs.readdirSync(path.join(tmp, 'cloud', 'pump')).some((f) => f.endsWith('.tmp')));
} catch (e) {
  failed++;
  console.log(`\n❌ آزمون شکست: ${e.stack}`);
} finally {
  await fsp.rm(tmp, { recursive: true, force: true });
}
console.log(`\n${passed} ✅   ${failed} ❌`);
process.exit(failed ? 1 : 0);
