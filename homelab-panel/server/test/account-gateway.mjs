// ---------------------------------------------------------------------------
//  درِ سرورِ حساب — از تونل تا shop/server، با سرورِ واقعیِ همین پنل
//      node test/account-gateway.mjs
//
//  چرا این آزمون هست: تونل «api.<دامنه>» را به پورتِ عمومیِ همین پنل می‌آورد،
//  ولی حساب و اشتراکِ هر چهار برنامه روی shop/server است. تا پیش از این در،
//  هر لاگینی از راهِ تونل «not found» می‌گرفت — و هیچ آزمونی نمی‌گرفتش، چون
//  هیچ آزمونی از دیدِ برنامه‌ها به این پورت نگاه نمی‌کرد.
//
//  این‌جا خودِ index.js بالا می‌آید (نه یک اپِ ساختگی) تا ترتیبِ واقعیِ
//  میان‌افزارها سنجیده شود: CORS، درِ مدیر، express.json، روترِ عمومی.
//  سرورِ حساب یک سرویسِ ساختگی روی پورتِ آزاد است که هرچه دید را پس می‌دهد.
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { accountRoute, ACCOUNT_PREFIXES } from '../src/api/account-proxy.js';

const PANEL = Number(process.env.TEST_PORT || 4861);
const PUBLIC = PANEL + 1;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'acct-gw-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 220)}`);
};

// ── ۱) قاعدهٔ مسیرها — بی هیچ سروری ─────────────────────────────────────────
console.log('\n── قاعدهٔ «چه چیزی مالِ سرورِ حساب است» ──');
for (const [p, want] of [
  ['/api/auth/register/start', true],
  ['/api/auth/login?x=1', true],
  ['/api/pump/me', true],
  ['/api/pump/device/bind', true],
  ['/api/me/backups', true],
  ['/api/health', true],
  ['/api/config', true],
  ['/api/admin/pump/subscriptions', true],
  ['/api/v1/auth/login', true],
  ['/api/v1/admin/login', true],
  ['/api/v1/shop/sync/push', true],
  ['/admin/', true],
  ['/admin', true],
  ['/admin/app.js', true],
  //  مالِ خودِ این سرور
  ['/api/v1/health', false],
  ['/api/v1/ready', false],
  ['/api/v1/app/config', false],
  ['/api/app/ping', false],
  ['/api/stations/p1/live', false],
  ['/api/v1/stations/p1/live', false],
  ['/api/messenger/topics', false],
  ['/api/notify/subscribe', false],
  ['/api/admin-gate/enroll', false],
  ['/api', false],
  ['/api/v1', false],
  ['/health', false],
  ['/', false],
  ['/ai/support/health', false],
  //  خصوصیِ پنل — روی پورتِ عمومی «نبوده» است و به آن‌طرف هم نمی‌رود
  ['/api/control/tohid/overview', false],
  ['/api/files/list', false],
  ['/api/sites', false],
  ['/api/settings', false],
  ['/adminx', false],
]) {
  check(`${p} ⇒ ${want ? 'سرورِ حساب' : 'همین سرور'}`, accountRoute(p) === want);
}
check('پیشوندهای shop/server همه هستند',
  ['auth', 'me', 'shop', 'pump', 'admin', 'plans', 'health', 'config', 'license', 'support', 'events', 'vip', 'billing']
    .every((k) => ACCOUNT_PREFIXES.includes(k)));

// ── ۲) سرورِ حسابِ ساختگی ───────────────────────────────────────────────────
const seen = [];
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    seen.push({ method: req.method, url: req.url, headers: req.headers, size: body.length });
    //  همان شکلِ پاسخ‌های shop/server
    res.setHeader('content-type', 'application/json; charset=utf-8');
    //  ⚠️ عمداً CORS می‌دهد — باید دور ریخته شود، وگرنه دو Allow-Origin روی هم می‌نشیند
    res.setHeader('access-control-allow-origin', '*');
    const p = req.url.split('?')[0];
    if (p === '/api/health') return res.end(JSON.stringify({ ok: true, server: 'online', version: '2.5.5' }));
    if (p === '/api/auth/login') {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: { code: 'bad_credentials', message: 'ایمیل/شماره یا رمز درست نیست' } }));
    }
    if (p === '/api/auth/register/start') {
      res.statusCode = 201;
      return res.end(JSON.stringify({ ok: true, echo: body.toString('utf8'), appId: req.headers['x-app-id'] || null }));
    }
    if (p === '/admin/' || p === '/admin') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      return res.end('<html><body>پنلِ مدیریتِ سرورِ حساب</body></html>');
    }
    if (p === '/api/me/backups') return res.end(JSON.stringify({ ok: true, bytes: body.length }));
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { code: 'not_found', message: 'این مسیر وجود ندارد' } }));
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const FAKE_URL = `http://127.0.0.1:${fake.address().port}`;

// ── ۳) خودِ پنل، با درِ سرورِ حساب روشن ────────────────────────────────────
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
         HLP_SITESYNC: '1', HLP_SITESYNC_PORT: String(PUBLIC),
         HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_ACCOUNT_API: FAKE_URL },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const hit = async (port, p, { method = 'GET', body, headers = {} } = {}) => {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers, body });
  const raw = res.headers.raw ? res.headers.raw() : null;
  return { status: res.status, text: await res.text(), headers: res.headers, raw };
};

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PANEL}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log('\n── از راهِ پورتِ عمومی (همان چیزی که تونل می‌بیند) ──');

  // سلامتِ سرورِ حساب — همان چیزی که برنامهٔ پمپ سرِ هر ۴۰۴ می‌پرسد
  {
    const r = await hit(PUBLIC, '/api/health');
    const j = JSON.parse(r.text);
    check('GET /api/health به سرورِ حساب می‌رسد', r.status === 200 && j.version === '2.5.5', r.text.slice(0, 100));
    const acao = r.headers.get('access-control-allow-origin');
    check('فقط یک Allow-Origin — مالِ همین پورت، نه آن‌طرف', acao !== null && !String(acao).includes(','), String(acao));
  }

  // ثبت‌نامِ سه‌پله‌ای — بدنه، هدرِ برنامه و IP همه باید برسند
  {
    const body = JSON.stringify({ name: 'حاجی', email: 'h@example.com', password: 'Salam12345', app: 'pump' });
    const r = await hit(PUBLIC, '/api/auth/register/start', {
      method: 'POST', body,
      headers: { 'content-type': 'application/json', 'x-app-id': 'tohid-pump-app', cookie: 'panel=SECRET' },
    });
    const j = JSON.parse(r.text);
    check('POST /api/auth/register/start ⇒ ۲۰۱ از سرورِ حساب', r.status === 201, r.text.slice(0, 120));
    check('بدنهٔ JSON دست‌نخورده می‌رسد', j.echo === body, j.echo);
    check('هدرِ X-App-Id می‌رسد', j.appId === 'tohid-pump-app', String(j.appId));
    const last = seen.at(-1);
    check('کوکیِ پنل به سرورِ حساب درز نمی‌کند', last && !last.headers.cookie);
    check('IPِ واقعی در X-Forwarded-For می‌رود', last && typeof last.headers['x-forwarded-for'] === 'string' && last.headers['x-forwarded-for'].length > 0);
  }

  // خطای خودِ سرورِ حساب همان‌طور برمی‌گردد — رمزِ غلط ۴۰۱ است، نه ۵۰۲
  {
    const r = await hit(PUBLIC, '/api/auth/login', {
      method: 'POST', body: JSON.stringify({ email: 'a@b.co', password: 'x', app: 'pump' }),
      headers: { 'content-type': 'application/json' },
    });
    const j = JSON.parse(r.text);
    check('رمزِ غلط ⇒ ۴۰۱ با پیامِ خودِ سرورِ حساب', r.status === 401 && j.error?.code === 'bad_credentials', r.text.slice(0, 120));
  }

  // برنامهٔ دکان و اپِ مدیرش با /api/v1 حرف می‌زنند — همان‌جا می‌روند
  {
    const before = seen.length;
    await hit(PUBLIC, '/api/v1/auth/login', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    await hit(PUBLIC, '/api/v1/admin/login', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    const paths = seen.slice(before).map((s) => s.url);
    check('/api/v1/auth/login و /api/v1/admin/login هر دو به سرورِ حساب می‌روند',
      paths.includes('/api/v1/auth/login') && paths.includes('/api/v1/admin/login'), paths.join(' '));
  }

  // رشتهٔ پرسش گم نمی‌شود
  {
    await hit(PUBLIC, '/api/plans?app=pump');
    check('رشتهٔ پرسش می‌رسد', seen.at(-1)?.url === '/api/plans?app=pump', seen.at(-1)?.url);
  }

  // پنلِ مدیریتِ سرورِ حساب — همان‌جا که اشتراک داده می‌شود
  {
    const r = await hit(PUBLIC, '/admin/');
    check('GET /admin/ پنلِ مدیریتِ سرورِ حساب را می‌آورد', r.status === 200 && r.text.includes('پنلِ مدیریت'), r.text.slice(0, 80));
  }

  // پشتیبانِ چند مگابایتی جریانی رد می‌شود
  {
    const big = Buffer.alloc(2 * 1024 * 1024, 7);
    const r = await hit(PUBLIC, '/api/me/backups', { method: 'POST', body: big, headers: { 'content-type': 'application/octet-stream' } });
    const j = JSON.parse(r.text);
    check('بدنهٔ ۲ مگابایتی سالم می‌رسد', r.status === 200 && j.bytes === big.length, r.text.slice(0, 80));
  }

  // پیش‌پروازِ CORS — اپِ کارمندان از مرورگر X-App-Id می‌فرستد
  {
    const res = await fetch(`http://127.0.0.1:${PUBLIC}/api/auth/login`, {
      method: 'OPTIONS',
      headers: { origin: 'https://yaqobipump.top', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-app-id' },
    });
    const allow = String(res.headers.get('access-control-allow-headers') || '');
    check('پیش‌پروازِ CORS با X-App-Id پذیرفته می‌شود', res.status === 204 && /x-app-id/i.test(allow), `${res.status} ${allow}`);
  }

  console.log('\n── مسیرهای خودِ این سرور دست‌نخورده‌اند ──');
  {
    const before = seen.length;
    const health = await hit(PUBLIC, '/api/v1/health');
    const hj = JSON.parse(health.text);
    check('/api/v1/health مالِ همین سرور است', health.status === 200 && hj.service === 'control-center', health.text.slice(0, 80));
    const ping = await hit(PUBLIC, '/api/app/ping');
    check('/api/app/ping مالِ همین سرور است', ping.status !== 404 && ping.status !== 503, `${ping.status}`);
    const cfg = await hit(PUBLIC, '/api/v1/app/config');
    check('/api/v1/app/config مالِ همین سرور است', cfg.status !== 404 && cfg.status !== 503, `${cfg.status}`);
    const st = await hit(PUBLIC, '/api/stations/nope/live?token=x');
    check('/api/stations/… مالِ همین سرور است', st.status !== 503, `${st.status}`);
    const ctl = await hit(PUBLIC, '/api/control/tohid/overview');
    check('مرکز فرمان روی پورتِ عمومی همچنان «نبوده» است', ctl.status === 404, `${ctl.status} ${ctl.text.slice(0, 60)}`);
    check('هیچ‌کدام به سرورِ حساب نرفتند', seen.length === before, seen.slice(before).map((s) => s.url).join(' '));
    const idx = JSON.parse((await hit(PUBLIC, '/api')).text);
    check('فهرستِ /api درِ سرورِ حساب را می‌گوید', idx.endpoints.some((e) => String(e.what).includes('سرورِ حساب')));
  }

  console.log('\n── پنلِ خصوصی هیچ تغییری نکرده ──');
  {
    const setup = await hit(PANEL, '/api/auth/setup', {
      method: 'POST', body: JSON.stringify({ username: 'admin', password: 'ControlCenter!2026' }),
      headers: { 'content-type': 'application/json' },
    });
    check('/api/auth/setup روی پورتِ پنل همان پنل است، نه سرورِ حساب',
      setup.status === 200 && !seen.some((s) => s.url === '/api/auth/setup'), `${setup.status} ${setup.text.slice(0, 80)}`);
  }

  console.log('\n── رمزِ غلطِ یک نفر، بقیه را قفل نمی‌کند ──');
  {
    //  ⛔ شمارندهٔ درِ مدیر روی همهٔ پورتِ عمومی نشسته بود و هر ۴۰۱ را شکست
    //  می‌شمرد: بیست رمزِ غلط در ده دقیقه = ۴۲۹ برای کلِ api.<دامنه>.
    let last = 0;
    for (let i = 0; i < 25; i++) {
      const r = await hit(PUBLIC, '/api/auth/login', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
      last = r.status;
    }
    check('۲۵ رمزِ غلطِ پشتِ سرِ هم ⇒ همچنان ۴۰۱ از سرورِ حساب، نه ۴۲۹', last === 401, String(last));
    const h = await hit(PUBLIC, '/api/v1/health');
    check('و مسیرهای خودِ سرور هم قفل نشدند', h.status === 200, String(h.status));
    const live = await hit(PUBLIC, '/api/stations/nope/live?token=x');
    check('و دادهٔ زندهٔ پمپ هم', live.status !== 429, String(live.status));
    //  ولی خودِ در همان‌قدر سخت‌گیر مانده: بیست کلیدِ غلط ⇒ ۴۲۹
    let gate = 0;
    for (let i = 0; i < 22; i++) {
      const r = await hit(PUBLIC, '/api/admin-gate/control/overview', { headers: { 'x-admin-gate': 'kelide-ghalat-' + i } });
      gate = r.status;
    }
    check('حدسِ کلیدِ درِ مدیر همچنان بعد از بیست تلاش ۴۲۹ می‌گیرد', gate === 429, String(gate));
  }

  console.log('\n── سرورِ حساب خاموش ──');
  {
    await new Promise((r) => fake.close(r));
    const r = await hit(PUBLIC, '/api/auth/login', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    const j = JSON.parse(r.text);
    check('۵۰۳ با کدِ account_server_down و راهِ درست کردنش',
      r.status === 503 && j.error?.code === 'account_server_down' && /سرورِ حساب/.test(j.error?.message || '') && !/docker/.test(j.error?.message || ''), r.text.slice(0, 160));
    const h = await hit(PUBLIC, '/api/v1/health');
    check('و سرورِ خانگی خودش سالم می‌ماند', h.status === 200, `${h.status}`);
  }
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  server.kill();
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز · ${fail} سرخ`);
if (fail) { console.log(out.slice(-1500)); process.exit(1); }
