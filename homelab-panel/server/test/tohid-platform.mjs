// ---------------------------------------------------------------------------
//  آزمونِ سکوی مدیریت — کد اشتراک، تخفیف، پشتیبانی، بازدیدکننده‌ها،
//  اشتراک‌های رو به پایان، برنامه‌های دیگر و ایمیل.
//      node test/tohid-platform.mjs
//
//  همان مسیرهایی صدا زده می‌شود که برنامهٔ مدیریتِ تازه و خودِ برنامهٔ
//  فروشگاه صدا می‌زنند — با همان نام‌های میدان که آن‌ها می‌خوانند. اگر
//  اسمی عوض شود، اینجا می‌شکند، نه روی گوشیِ کسی.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4847);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'th-platform-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 240)}`);
};

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PORT), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
         HLP_SITESYNC: '0', HLP_AI_ENABLED: '0', HLP_TUNNEL: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const api = async (p, { method = 'GET', body, token } = {}) => {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

const ADMIN_PASSWORD = 'ControlCenter!2026';

try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز بالا نیامده */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  await api('/api/auth/setup', { method: 'POST', body: { username: 'admin', password: ADMIN_PASSWORD } });
  const adminLogin = await api('/api/v1/admin/login', {
    method: 'POST', body: { username: 'admin', password: ADMIN_PASSWORD },
  });
  const token = adminLogin.data.token;
  check('مدیر وارد شد', Boolean(token), JSON.stringify(adminLogin.data).slice(0, 160));

  //  یک مشتریِ واقعی، از راهِ خودِ برنامه
  await api('/api/v1/auth/register', {
    method: 'POST',
    body: { name: 'کریم', email: 'karim@example.com', phone: '0700333444', password: 'shop-pass-1' },
  });
  const login = await api('/api/v1/auth/login', {
    method: 'POST', body: { identifier: 'karim@example.com', password: 'shop-pass-1' },
  });
  const customer = login.data.accessToken;
  check('مشتری وارد شد', Boolean(customer));

  /* ═════════════════════════ قیمت‌نامهٔ باز ═════════════════════════ */

  console.log('\n── قیمت‌نامه، بی‌نیاز به ورود ──');

  //  همان کاری که سایت می‌کند: بی هیچ توکنی
  const openPlans = await api('/api/v1/plans');
  check('بی‌توکن هم قیمت‌ها می‌آید', openPlans.status === 200 && Array.isArray(openPlans.data.plans),
    JSON.stringify(openPlans.data).slice(0, 160));
  check('لینک واتساپ ساخته می‌شود',
    typeof openPlans.data.whatsapp?.url === 'string');

  /* ═════════════════════════ تخفیف ═════════════════════════ */

  console.log('\n── تخفیف ──');

  const before = openPlans.data.plans.find((p) => p.code === 'm1');
  const fullPrice = before.fullPrice ?? before.price;

  const setOff = await api('/api/v1/admin/plans/m1/discount', {
    method: 'PUT', token, body: { percent: 20, label: 'جشنواره' },
  });
  check('تخفیف درصدی گذاشته شد', setOff.status === 200, JSON.stringify(setOff.data).slice(0, 200));

  const withOff = (await api('/api/v1/plans')).data.plans.find((p) => p.code === 'm1');
  check('قیمتِ اصلی گم نمی‌شود', withOff.fullPrice === fullPrice,
    `${withOff.fullPrice} ≠ ${fullPrice}`);
  check('قیمت با تخفیف درست است', withOff.price === Math.round(fullPrice * 0.8),
    `${withOff.price} ≠ ${Math.round(fullPrice * 0.8)}`);
  check('نامِ تخفیف می‌آید', withOff.discount?.label === 'جشنواره');
  check('صرفه‌جویی درست است', withOff.discount?.savings === fullPrice - withOff.price);

  //  قیمتِ ثابت
  await api('/api/v1/admin/plans/y1/discount', { method: 'PUT', token, body: { price: 1500 } });
  const fixed = (await api('/api/v1/plans')).data.plans.find((p) => p.code === 'y1');
  check('تخفیف با قیمتِ ثابت', fixed.price === 1500, String(fixed.price));

  //  تخفیفِ بی‌معنی
  const tooHigh = await api('/api/v1/admin/plans/m1/discount', {
    method: 'PUT', token, body: { price: fullPrice + 100 },
  });
  check('تخفیفِ گران‌تر از قیمت رد می‌شود', tooHigh.status === 400, String(tooHigh.status));

  const past = await api('/api/v1/admin/plans/m1/discount', {
    method: 'PUT', token, body: { percent: 10, until: Date.now() - 5000 },
  });
  check('مهلتِ گذشته رد می‌شود', past.status === 400, String(past.status));

  //  برداشتن
  await api('/api/v1/admin/plans/y1/discount', { method: 'DELETE', token });
  const cleared = (await api('/api/v1/plans')).data.plans.find((p) => p.code === 'y1');
  check('برداشتنِ تخفیف قیمت را برمی‌گرداند', cleared.discount === null && cleared.price === cleared.fullPrice,
    JSON.stringify(cleared).slice(0, 160));

  //  عوض کردنِ خودِ نرخ
  const saved = await api('/api/v1/admin/plans/m1', {
    method: 'PATCH', token, body: { price: 750, title: 'ماهانه' },
  });
  check('نرخ از برنامهٔ مدیریت عوض می‌شود', saved.status === 200, JSON.stringify(saved.data).slice(0, 160));
  const repriced = (await api('/api/v1/plans')).data.plans.find((p) => p.code === 'm1');
  check('قیمتِ تازه به قیمت‌نامه می‌رسد', repriced.fullPrice === 750, String(repriced.fullPrice));

  /* ═════════════════════════ کد اشتراک ═════════════════════════ */

  console.log('\n── کد اشتراک ──');

  const made = await api('/api/v1/admin/vip-codes', {
    method: 'POST', token, body: { plan: 'm6', days: 180, note: 'هدیه' },
  });
  check('کد ساخته شد', /^\d{6}$/.test(String(made.data.code)), JSON.stringify(made.data).slice(0, 200));

  const list = await api('/api/v1/admin/vip-codes', { token });
  const row = list.data.codes.find((c) => c.id === made.data.vipCode.id);
  check('کد در فهرست هست', Boolean(row));
  check('کدِ خام در فهرست نیست', !JSON.stringify(list.data).includes(made.data.code));

  const redeem = await api('/api/v1/vip/redeem', {
    method: 'POST', token: customer, body: { code: made.data.code },
  });
  check('کاربر کد را خرج کرد', redeem.status === 200 && redeem.data.ok === true,
    JSON.stringify(redeem.data).slice(0, 200));
  check('اشتراک فعال شد', redeem.data.entitlement?.source === 'subscription',
    JSON.stringify(redeem.data.entitlement).slice(0, 160));

  const again = await api('/api/v1/vip/redeem', {
    method: 'POST', token: customer, body: { code: made.data.code },
  });
  check('همان کد بار دوم کار نمی‌کند', again.data?.error?.code === 'code_used',
    JSON.stringify(again.data).slice(0, 160));

  const bogus = await api('/api/v1/vip/redeem', { method: 'POST', token: customer, body: { code: '000000' } });
  check('کدِ نادرست رد می‌شود', Boolean(bogus.data?.error), JSON.stringify(bogus.data).slice(0, 120));

  const short = await api('/api/v1/vip/redeem', { method: 'POST', token: customer, body: { code: '12' } });
  check('کدِ کوتاه رد می‌شود', bogus.status >= 400 && short.status >= 400);

  //  بی‌توکن نمی‌شود
  const anon = await api('/api/v1/vip/redeem', { method: 'POST', body: { code: '123456' } });
  check('بی‌حساب نمی‌شود کد خرج کرد', anon.status === 401, String(anon.status));

  //  باطل کردن
  const made2 = await api('/api/v1/admin/vip-codes', { method: 'POST', token, body: { plan: 'm1', days: 30 } });
  await api(`/api/v1/admin/vip-codes/${made2.data.vipCode.id}/revoke`, { method: 'POST', token });
  const dead = await api('/api/v1/vip/redeem', {
    method: 'POST', token: customer, body: { code: made2.data.code },
  });
  check('کدِ باطل‌شده کار نمی‌کند', dead.data?.error?.code === 'code_inactive',
    JSON.stringify(dead.data).slice(0, 160));

  /* ═════════════════════════ پشتیبانی ═════════════════════════ */

  console.log('\n── پشتیبانی ──');

  //  مهمانِ بی‌حساب — همان کسی که همان اولِ کار گیر کرده
  const guestMsg = await api('/api/v1/support/messages', {
    method: 'POST',
    body: { deviceUid: 'guest-1', name: 'مهمان', body: 'سلام، نمی‌توانم ثبت‌نام کنم' },
  });
  check('مهمانِ بی‌حساب پیام می‌دهد', guestMsg.status === 200 && Boolean(guestMsg.data.message),
    JSON.stringify(guestMsg.data).slice(0, 200));

  const guestView = await api('/api/v1/support/thread?deviceUid=guest-1');
  check('مهمان گفت‌وگویش را می‌بیند', guestView.data.messages?.length === 1);

  const threads = await api('/api/v1/admin/support/threads', { token });
  const thread = threads.data.threads.find((t) => t.deviceUid === 'guest-1');
  check('مدیر گفت‌وگو را می‌بیند', Boolean(thread), JSON.stringify(threads.data).slice(0, 200));
  check('خوانده‌نشده شمرده می‌شود', thread?.unreadAdmin === 1, String(thread?.unreadAdmin));

  const reply = await api(`/api/v1/admin/support/threads/${thread.id}/messages`, {
    method: 'POST', token, body: { body: 'سلام! بفرمایید.' },
  });
  check('مدیر جواب می‌دهد', reply.status === 200 && reply.data.message?.sender === 'admin',
    JSON.stringify(reply.data).slice(0, 160));

  const backToGuest = await api('/api/v1/support/thread?deviceUid=guest-1');
  check('جواب به مهمان می‌رسد', backToGuest.data.messages?.length === 2);
  check('نقطهٔ قرمزِ کاربر روشن است', backToGuest.data.thread?.unreadUser === 1,
    String(backToGuest.data.thread?.unreadUser));

  await api('/api/v1/support/read', { method: 'POST', body: { deviceUid: 'guest-1' } });
  const afterRead = await api('/api/v1/support/thread?deviceUid=guest-1');
  check('«خواندم» نقطه را پاک می‌کند', afterRead.data.thread?.unreadUser === 0);

  //  هر دستگاه فقط مالِ خودش
  await api('/api/v1/support/messages', { method: 'POST', body: { deviceUid: 'guest-2', body: 'رازِ دو' } });
  const one = await api('/api/v1/support/thread?deviceUid=guest-1');
  check('گفت‌وگوها با هم قاطی نمی‌شوند', !JSON.stringify(one.data).includes('رازِ دو'));

  //  مهمانی که حساب می‌سازد، همان گفت‌وگو را دارد
  await api('/api/v1/support/messages', { method: 'POST', body: { deviceUid: 'becomes-user', body: 'پیش از ثبت‌نام' } });
  const beforeId = (await api('/api/v1/support/thread?deviceUid=becomes-user')).data.thread.id;
  await api('/api/v1/support/messages', {
    method: 'POST', token: customer, body: { deviceUid: 'becomes-user', body: 'بعد از ثبت‌نام' },
  });
  const afterJoin = await api('/api/v1/support/thread?deviceUid=becomes-user', { token: customer });
  check('گفت‌وگوی مهمان به حسابش می‌چسبد', afterJoin.data.thread.id === beforeId,
    `${afterJoin.data.thread.id} ≠ ${beforeId}`);
  check('هر دو پیام سرِ جایشان‌اند', afterJoin.data.messages.length === 2);

  //  پیام خالی و بی‌هویت
  const empty = await api('/api/v1/support/messages', { method: 'POST', body: { deviceUid: 'g', body: '  ' } });
  check('پیام خالی رد می‌شود', empty.status >= 400, String(empty.status));
  const noId = await api('/api/v1/support/messages', { method: 'POST', body: { body: 'بی‌شناسه' } });
  check('پیام بی‌شناسه رد می‌شود', noId.status >= 400, String(noId.status));

  //  کاربر عادی به فهرست مدیر نمی‌رسد
  const peek = await api('/api/v1/admin/support/threads', { token: customer });
  check('کاربر عادی فهرست گفت‌وگوها را نمی‌بیند', peek.status === 401, String(peek.status));

  //  بستن و باز شدنِ دوباره
  await api(`/api/v1/admin/support/threads/${thread.id}/status`, {
    method: 'POST', token, body: { status: 'closed' },
  });
  await api('/api/v1/support/messages', { method: 'POST', body: { deviceUid: 'guest-1', body: 'یک سؤال دیگر' } });
  const reopened = await api(`/api/v1/admin/support/threads/${thread.id}`, { token });
  check('پیام تازه گفت‌وگوی بسته را باز می‌کند', reopened.data.thread?.status === 'open',
    String(reopened.data.thread?.status));

  /* ═════════════════════════ بازدیدکننده‌ها ═════════════════════════ */

  console.log('\n── بازدیدکننده‌ها ──');

  const visit = await api('/api/v1/visit', {
    method: 'POST',
    body: { deviceUid: 'visitor-1', platform: 'web', language: 'fa',
            location: { lat: 34.5553, lng: 69.2075, accuracy: 30 } },
  });
  check('تپشِ بازدید پذیرفته می‌شود', visit.status === 200 && visit.data.ok === true,
    JSON.stringify(visit.data).slice(0, 160));

  const seen = await api('/api/v1/admin/visitors?guests=1', { token });
  const v1 = seen.data.visitors.find((v) => v.deviceUid === 'visitor-1');
  check('مهمان در فهرست دیده می‌شود', Boolean(v1));
  check('مهمان، مهمان شمرده می‌شود', v1?.guest === true);
  check('لوکیشن ثبت می‌شود', Math.round((v1?.location?.lat || 0) * 100) === 3456,
    JSON.stringify(v1?.location));
  check('شمارشِ مهمان‌ها درست است', seen.data.summary?.guests >= 1, JSON.stringify(seen.data.summary));

  //  همان دستگاه دو بار، یک ردیف
  await api('/api/v1/visit', { method: 'POST', body: { deviceUid: 'visitor-1', platform: 'web' } });
  const twice = await api('/api/v1/admin/visitors', { token });
  check('یک دستگاه یک ردیف می‌سازد',
    twice.data.visitors.filter((v) => v.deviceUid === 'visitor-1').length === 1);

  //  حساب‌دار دیگر مهمان نیست
  await api('/api/v1/visit', { method: 'POST', token: customer, body: { deviceUid: 'visitor-2', platform: 'android' } });
  const known = (await api('/api/v1/admin/visitors', { token })).data.visitors
    .find((v) => v.deviceUid === 'visitor-2');
  check('کاربرِ حساب‌دار مهمان شمرده نمی‌شود', known?.guest === false, JSON.stringify(known).slice(0, 160));
  check('نامِ حساب کنارش می‌آید', known?.accountName === 'کریم', String(known?.accountName));

  //  بی شناسهٔ دستگاه چیزی نمی‌شکند
  const noDevice = await api('/api/v1/visit', { method: 'POST', body: { platform: 'web' } });
  check('تپش بی‌شناسه چیزی نمی‌شکند', noDevice.status === 200 && noDevice.data.ok === true);

  //  تپش می‌گوید پیامِ خوانده‌نشده هست
  const pulse = await api('/api/v1/visit', { method: 'POST', body: { deviceUid: 'guest-2', platform: 'web' } });
  check('تپش، خوانده‌نشده‌ها را می‌گوید', typeof pulse.data.supportUnread === 'number');

  const guestsOnly = await api('/api/v1/admin/visitors', { token: customer });
  check('کاربر عادی بازدیدکننده‌ها را نمی‌بیند', guestsOnly.status === 401, String(guestsOnly.status));

  /* ════════════════ اشتراک‌های رو به پایان ════════════════ */

  console.log('\n── اشتراک‌های رو به پایان ──');

  /*
   *  حسابِ تازه، عمداً.
   *
   *  «کریم» بالاتر یک کدِ ۱۸۰ روزه خرج کرد و تمدیدِ بعدی روی همان
   *  می‌نشیند — یعنی اشتراکش ۱۸۲ روز دیگر تمام می‌شود، نه دو روز. اگر
   *  همان حساب را می‌گرفتیم، این آزمون چیزی را می‌سنجید که خودش خراب
   *  کرده بود.
   */
  await api('/api/v1/auth/register', {
    method: 'POST',
    body: { name: 'نزدیکِ‌پایان', email: 'soon@example.com', phone: '0700555666', password: 'shop-pass-2' },
  });
  const soonLogin = await api('/api/v1/auth/login', {
    method: 'POST', body: { identifier: 'soon@example.com', password: 'shop-pass-2' },
  });
  const soonToken = soonLogin.data.accessToken;

  const shops = await api('/api/v1/admin/shops', { token });
  const shopId = shops.data.shops.find((s) => s.owner_email === 'soon@example.com')?.id;
  check('حسابِ تازه در فهرست هست', Boolean(shopId), JSON.stringify(shops.data.shops).slice(0, 200));

  //  اشتراکی که دو روز دیگر تمام می‌شود
  await api('/api/v1/admin/subscriptions', {
    method: 'POST', token, body: { shopId, plan: 'm1', days: 2 },
  });

  const expiring = await api('/api/v1/admin/subscriptions/expiring?days=7', { token });
  check('اشتراکِ رو به پایان دیده می‌شود',
    Array.isArray(expiring.data.expiring) && expiring.data.expiring.some((e) => e.shopId === shopId),
    JSON.stringify(expiring.data).slice(0, 240));

  const notified = await api('/api/v1/admin/subscriptions/notify-expiring', { method: 'POST', token });
  check('خبر به دکان‌دار رفت', notified.data.sent >= 1, JSON.stringify(notified.data));

  const mine = await api('/api/v1/support/thread', { token: soonToken });
  check('خبر در چت پشتیبانیِ خودش نشست',
    mine.data.messages?.some((m) => m.sender === 'system' && m.body.includes('اشتراک')),
    JSON.stringify(mine.data.messages || []).slice(0, 200));

  const twiceNotified = await api('/api/v1/admin/subscriptions/notify-expiring', { method: 'POST', token });
  check('خبرِ تکراری فرستاده نمی‌شود', twiceNotified.data.sent === 0, JSON.stringify(twiceNotified.data));

  /* ════════════════════ برنامه‌های دیگر ════════════════════ */

  console.log('\n── برنامه‌های دیگر ──');

  const apps = await api('/api/v1/admin/apps', { token });
  check('فروشگاه و پنل از اول در فهرست‌اند',
    apps.data.apps?.some((a) => a.slug === 'shop') && apps.data.apps?.some((a) => a.slug === 'admin'),
    JSON.stringify(apps.data).slice(0, 200));

  const newApp = await api('/api/v1/admin/apps', {
    method: 'POST', token,
    body: { slug: 'my-site', title: 'سایت شخصی', kind: 'site', url: 'https://example.com' },
  });
  check('برنامهٔ تازه اضافه می‌شود', newApp.status === 200 && newApp.data.app?.slug === 'my-site',
    JSON.stringify(newApp.data).slice(0, 200));

  const dup = await api('/api/v1/admin/apps', { method: 'POST', token, body: { slug: 'my-site', title: 'تکراری' } });
  check('نامِ تکراری رد می‌شود', dup.status >= 400, String(dup.status));

  const badSlug = await api('/api/v1/admin/apps', { method: 'POST', token, body: { slug: 'x' } });
  check('نامِ کوتاه رد می‌شود', badSlug.status >= 400, String(badSlug.status));

  //  بازدیدِ یک برنامهٔ دیگر، زیرِ همان برنامه شمرده می‌شود
  await api('/api/v1/visit', { method: 'POST', body: { app: 'my-site', deviceUid: 'other-1', platform: 'ios' } });
  const counted = (await api('/api/v1/admin/apps', { token })).data.apps.find((a) => a.slug === 'my-site');
  check('بازدیدِ هر برنامه جدا شمرده می‌شود', counted?.visitors === 1, String(counted?.visitors));
  const shopOnly = await api('/api/v1/admin/visitors?app=shop', { token });
  check('بازدیدِ برنامهٔ دیگر در فهرستِ فروشگاه نیست',
    !shopOnly.data.visitors.some((v) => v.deviceUid === 'other-1'));

  //  کلید، فقط یک بار
  const keyed = await api(`/api/v1/admin/apps/${newApp.data.app.id}/key`, { method: 'POST', token });
  check('کلید ساخته می‌شود', String(keyed.data.key || '').startsWith('ak_'),
    JSON.stringify(keyed.data).slice(0, 160));
  const afterKey = (await api('/api/v1/admin/apps', { token })).data.apps.find((a) => a.slug === 'my-site');
  check('کلیدِ خام در فهرست نیست', afterKey?.keySet === true && !JSON.stringify(afterKey).includes(keyed.data.key));

  //  بایگانی، نه پاک کردن
  await api(`/api/v1/admin/apps/${newApp.data.app.id}`, { method: 'DELETE', token });
  const normal = await api('/api/v1/admin/apps', { token });
  const archived = await api('/api/v1/admin/apps?archived=1', { token });
  check('بایگانی از فهرست بیرون می‌رود', !normal.data.apps.some((a) => a.slug === 'my-site'));
  check('ولی پاک نمی‌شود', archived.data.apps.some((a) => a.slug === 'my-site'));

  /* ═════════════════════════ ایمیل ═════════════════════════ */

  console.log('\n── ایمیل ──');

  const emailBefore = await api('/api/v1/admin/email', { token });
  check('ایمیلِ تنظیم‌نشده «آماده» شمرده نمی‌شود', emailBefore.data.email?.ready === false,
    JSON.stringify(emailBefore.data.email).slice(0, 200));
  check('می‌گوید چه چیزی کم است', (emailBefore.data.email?.missing || []).length > 0,
    JSON.stringify(emailBefore.data.email?.missing));

  const savedMail = await api('/api/v1/admin/email', {
    method: 'PUT', token,
    body: { host: 'smtp.example.com', port: 587, secure: 'starttls',
            user: 'me@example.com', pass: 'super-secret', from: 'me@example.com', fromName: 'توحید' },
  });
  check('تنظیماتِ ایمیل ذخیره می‌شود', savedMail.data.email?.host === 'smtp.example.com',
    JSON.stringify(savedMail.data).slice(0, 200));
  check('رمز هرگز برنمی‌گردد', !JSON.stringify(savedMail.data).includes('super-secret'));
  check('حالا آماده است', savedMail.data.email?.ready === true, JSON.stringify(savedMail.data.email?.missing));

  //  ذخیرهٔ بعدی بدونِ رمز، رمزِ قبلی را پاک نمی‌کند
  await api('/api/v1/admin/email', { method: 'PUT', token, body: { fromName: 'فروشگاه توحید' } });
  const kept = await api('/api/v1/admin/email', { token });
  check('رمز با ذخیرهٔ بعدی پاک نمی‌شود', kept.data.email?.passSet === true);
  check('نامِ فرستنده عوض شد', kept.data.email?.fromName === 'فروشگاه توحید');

  const peekMail = await api('/api/v1/admin/email', { token: customer });
  check('کاربر عادی تنظیماتِ ایمیل را نمی‌بیند', peekMail.status === 401, String(peekMail.status));

  /* ═════════════════════════ خلاصهٔ خانه ═════════════════════════ */

  console.log('\n── خلاصهٔ خانه ──');

  const overview = await api('/api/v1/admin/overview', { token });
  check('خلاصه در یک درخواست می‌آید', overview.status === 200, JSON.stringify(overview.data).slice(0, 160));
  for (const key of ['expiring', 'supportUnread', 'visitors', 'apps', 'email', 'push', 'vipCodesActive']) {
    check(`«${key}» در خلاصه هست`, key in overview.data);
  }

  /* ═════════════════════ سلامتِ سرور ═════════════════════ */

  const health = await api('/api/v1/health');
  check('نسخهٔ سرور در /health می‌آید', typeof health.data.version === 'string',
    JSON.stringify(health.data).slice(0, 160));
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  server.kill();
  await new Promise((r) => setTimeout(r, 200));
  if (fail) console.log(`\n${out.slice(-4000)}`);
  await fsp.rm(tmp, { recursive: true, force: true });
  console.log(`\n════════════════════════\n  موفق: ${pass}    ناموفق: ${fail}\n════════════════════════`);
  process.exit(fail ? 1 : 0);
}
