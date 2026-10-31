// ---------------------------------------------------------------------------
//  پلِ مالیِ مرکزی (ماژولِ ۴.۵) — پنلِ واقعی + سرورِ حسابِ ساختگی به شکلِ ‎routes/admin-finance.js‎ ِ shop
//      node test/account-finance.mjs
//
//  سنجیده می‌شود:
//    ⛔ سرورِ حسابِ بی ‎finance.v1‎ ⇒ خواندن «داده در دسترس نیست» با نامِ توانایی؛ نوشتن/خروجی ‎501‎ — نه عدد
//    ⛔ پرس‌وجوی فهرست‌سفید: کلیدِ ناشناخته نمی‌رود، شکلِ نادرست ۴۰۰ و هیچ درخواستی بالا نمی‌رود
//    ⛔ مرزِ نقش: خواندن همه؛ خروجی/سند/تطبیقِ آنلاین فقط admin — operator و viewer ۴۰۳ و هیچ درخواستی بالا
//    ⛔ سندِ اصلاحی: دلیل + تأیید + کلیدِ یکتایی + رمزِ پنل (سقفِ حدس) + فقط با کلیدِ سرویس؛ زمانِ احرازِ دوباره
//       و «انجام‌دهنده» به سرورِ حساب می‌رسد؛ رمز و کلیدِ سرویس هرگز در بدنهٔ بالادست/پاسخ نیست
//    ⛔ خروجیِ CSV با سرآیندها؛ خطای بالادست با کدِ خودش؛ پورتِ عمومی ۴۰۴؛ ردیفِ دفترِ پنل
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PANEL = Number(process.env.TEST_PORT || 4956);
const PUBLIC = PANEL + 1;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'acct-finance-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 400)}`);
};

/* ───────────────────── سرورِ حسابِ ساختگی ───────────────────── */

const NOW = Date.now();
const seen = [];
let caps = ['shop-health.v1', 'shop-holds.v1', 'flags.v1', 'actor.v1', 'service-key.v1'];
let failCode = '';           // خطای بالادست برای درهای مالی
let reconMissing = false;    // سرورِ حسابِ بی #411
const svcKeys = new Map();
const idemSeen = new Map();
let svcSeq = 0;

const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, server: 'online', version: '2.14.5' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* نه JSON */ }
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    seen.push({
      method: req.method, path: p, query: Object.fromEntries(u.searchParams), body, bearer, rawBody: raw,
      idem: req.headers['idempotency-key'] || '', reauthAt: req.headers['x-actor-reauth-at'] || '',
      actor: { id: req.headers['x-actor-id'], role: req.headers['x-actor-role'] },
    });
    const svc = bearer.startsWith('vsk_') ? svcKeys.get(bearer) : null;
    if (bearer !== 'tok-1' && !(svc && svc.status === 'active')) return j(401, { error: { code: 'unauthorized', message: 'احراز' } });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: caps, serverTime: NOW });
    if (p === '/api/admin/service-keys' && req.method === 'POST') {
      if (svc) return j(403, { error: { code: 'service_forbidden', message: 'کلیدِ سرویس' } });
      const key = `vsk_${'f'.repeat(12)}${++svcSeq}${'Q'.repeat(30)}`;
      svcKeys.set(key, { id: `svk${svcSeq}`, status: 'active' });
      return j(201, { key, serviceKey: { id: `svk${svcSeq}`, roleCap: 'superadmin', status: 'active' }, shownOnce: true });
    }
    if (p === '/api/admin/system/reconciliation') {
      if (reconMissing) return j(404, { error: { code: 'route_not_found', message: 'این مسیرِ مدیر روی این سرور نیست' } });
      return j(200, { window: { from: 1, to: 2 }, currency: 'AFN', checkedAt: NOW, shopsTotal: 1, totals: { netMinor: 12345 }, shops: [] });
    }
    if (p.startsWith('/api/admin/finance/')) {
      if (!caps.includes('finance.v1')) return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
      if (failCode) return j(503, { error: { code: failCode, message: 'پایگاهِ داده در دسترس نیست' } });
      if (p === '/api/admin/finance/summary') {
        return j(200, { window: { from: 1, to: 2, group: u.searchParams.get('group') || 'day' }, totals: { AFN: { payments: { count: 2, amount: 1100 }, net: 1100 } }, series: [], checkedAt: NOW });
      }
      if (p === '/api/admin/finance/export') {
        return j(200, { dataset: 'payments', filename: 'vill3n-finance-payments-2026-10-31.csv', rows: 1, nextCursor: 'WzE3MDAsInBheTEiXQ',
          csv: '﻿payment_id,amount\r\npay1,600\r\n', checkedAt: NOW });
      }
      if (p === '/api/admin/finance/adjustments' && req.method === 'POST') {
        if (!svc) return j(403, { error: { code: 'reauth_required', message: 'نشستِ کهنه' } });
        const at = Number(req.headers['x-actor-reauth-at']);
        if (!at || Date.now() - at > 600000) return j(403, { error: { code: 'reauth_required', message: 'احرازِ دوباره' } });
        const k = req.headers['idempotency-key'];
        if (idemSeen.has(k)) return j(200, { ...idemSeen.get(k), replayed: true });
        const out = { adjustment: { id: 'fad1', docNo: 'ADJ-2026-00001', kind: body?.kind, amount: -100, netBefore: 600, netAfter: 500 },
          payment: { id: body?.paymentId, net: 500 } };
        idemSeen.set(k, out);
        return j(201, { ...out, replayed: false });
      }
      return j(200, { ok: true, path: p, checkedAt: NOW, payments: [], nextCursor: null });
    }
    return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

/* ───────────────────── پنلِ واقعی ───────────────────── */

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
         HLP_SITESYNC: '1', HLP_SITESYNC_PORT: String(PUBLIC),
         HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_AUTOMATION: '0', HLP_STATIONS: '0',
         HLP_ACCOUNT_API: `http://127.0.0.1:${fake.address().port}`,
         HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret', HLP_AUTH_RATE_LIMIT: '100000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const BASE = `http://127.0.0.1:${PANEL}`;
async function api(method, p, body, headers = {}, base = BASE) {
  const res = await fetch(base + p, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  //  ⚠️ `res.text()` نشانهٔ BOM را می‌بُرد — متن از بایت‌ها، بی بریدن
  const text = bytes.toString('utf8');
  let json = null;
  try { json = JSON.parse(text); } catch { /* غیرِ JSON */ }
  return { status: res.status, json, text, headers: res.headers };
}
const F = '/api/account-admin/console/finance';
const PASS = 'Fin-1405-owner';

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await api('POST', '/api/auth/setup', { username: 'admin', password: PASS });
  const tokOf = async (u, p) => (await api('POST', '/api/auth/login', { username: u, password: p })).json?.token;
  const admin = { Authorization: `Bearer ${await tokOf('admin', PASS)}` };
  for (const [u, role] of [['op1', 'operator'], ['view1', 'viewer']]) {
    await api('POST', '/api/auth/users', { username: u, password: `Fin-${role}-1405`, role }, admin);
  }
  const op = { Authorization: `Bearer ${await tokOf('op1', 'Fin-operator-1405')}` };
  const viewer = { Authorization: `Bearer ${await tokOf('view1', 'Fin-viewer-1405')}` };
  check('سه نشست', Boolean(admin.Authorization.length > 20 && op.Authorization.length > 20 && viewer.Authorization.length > 20));

  console.log('\n── سرورِ حسابِ بی finance.v1 ──');
  let mark = seen.length;
  const u0 = await api('GET', `${F}/summary`, undefined, viewer);
  check('خواندن ⇒ ۲۰۰ «داده در دسترس نیست» با نامِ توانایی، بی هیچ عدد',
    u0.status === 200 && u0.json?.available === false && u0.json?.capability === 'finance.v1' && !('totals' in (u0.json || {}))
      && !seen.slice(mark).some((x) => x.path.startsWith('/api/admin/finance')), `${u0.status} ${u0.text.slice(0, 200)}`);
  const ok0Body = { paymentId: 'pay1', kind: 'refund', amount: 100, reason: 'بازپرداختِ آزمون', confirm: true, idempotencyKey: 'pnl-fin-0001-aaaa', password: PASS };
  const w0 = await api('POST', `${F}/adjustments`, ok0Body, admin);
  check('نوشتن ⇒ ‎501 capability_missing‎', w0.status === 501 && w0.json?.error === 'capability_missing', `${w0.status} ${w0.text}`);
  const x0 = await api('GET', `${F}/export`, undefined, admin);
  check('خروجی ⇒ ‎501‎', x0.status === 501, `${x0.status}`);

  caps = [...caps, 'finance.v1'];
  console.log('\n── خواندن: فهرستِ سفیدِ پرس‌وجو، زمانِ رسیدن ──');
  mark = seen.length;
  const s1 = await api('GET', `${F}/summary?group=week&app=shop&evil=1&calendar=persian&fromDate=2026-10-01`, undefined, viewer);
  const up = seen.slice(mark).find((x) => x.path === '/api/admin/finance/summary');
  check('viewer می‌خواند؛ پاسخِ بالادست همان‌طور + fetchedAt و available',
    s1.status === 200 && s1.json?.available === true && s1.json?.totals?.AFN?.net === 1100 && s1.json?.checkedAt === NOW && Number(s1.json?.fetchedAt) >= NOW,
    `${s1.status} ${s1.text.slice(0, 200)}`);
  check('⛔ فقط پارامترهای شناخته به سرورِ حساب رفت (evil نه)',
    Boolean(up) && up.query.group === 'week' && up.query.app === 'shop' && up.query.fromDate === '2026-10-01' && !('evil' in up.query),
    JSON.stringify(up?.query));
  check('«انجام‌دهنده» ِ راهِ پیشین: توکنِ ارشدِ خودکار (هنوز کلیدِ سرویسی نیست)', up?.bearer === 'tok-1');
  mark = seen.length;
  const bq = await api('GET', `${F}/summary?group=year`, undefined, viewer);
  const bid = await api('GET', `${F}/payments/..%2Fadmins`, undefined, viewer);
  const bc = await api('GET', `${F}/payments?cursor=${encodeURIComponent('a"b')}`, undefined, viewer);
  check('⛔ پارامتر/شناسهٔ نادرست ⇒ ۴۰۰ و هیچ درخواستی بالا نرفت',
    bq.status === 400 && bq.json?.error === 'bad_query' && bid.status === 400 && bc.status === 400
      && !seen.slice(mark).some((x) => x.path.startsWith('/api/admin/finance')), `${bq.status} ${bid.status} ${bc.status}`);
  for (const pth of ['breakdown?by=plan', 'payments?status=deleted&q=HW', 'payments/pay1', 'adjustments?kind=refund', 'receivables', 'pending',
    'gateway?match=unmatched', 'discrepancies', 'history?targetId=pay1']) {
    mark = seen.length;
    const r = await api('GET', `${F}/${pth}`, undefined, viewer);
    const hit = seen.slice(mark).find((x) => x.path.startsWith('/api/admin/finance/'));
    check(`GET ${pth} ⇒ ۲۰۰ و همان درِ سرورِ حساب`, r.status === 200 && r.json?.available === true
      && hit?.path === `/api/admin/finance/${pth.split('?')[0]}`, `${r.status} ${hit?.path}`);
  }

  console.log('\n── مرزِ نقش ──');
  for (const [who, h] of [['operator', op], ['viewer', viewer]]) {
    mark = seen.length;
    const e = await api('GET', `${F}/export`, undefined, h);
    const a = await api('POST', `${F}/adjustments`, ok0Body, h);
    const r = await api('GET', `${F}/online-reconciliation`, undefined, h);
    check(`⛔ ${who}: خروجی، سند و تطبیقِ آنلاین ۴۰۳ و هیچ درخواستی بالا نرفت`,
      e.status === 403 && a.status === 403 && r.status === 403 && seen.length === mark, `${e.status} ${a.status} ${r.status} ${seen.slice(mark).map((x) => x.path)}`);
  }

  console.log('\n── خروجیِ CSV ──');
  mark = seen.length;
  const csv = await api('GET', `${F}/export?dataset=payments&fromDate=2026-10-01&evil=x`, undefined, admin);
  check('admin ⇒ فایلِ CSV با BOM، نامِ فایل، شمار و نشانگرِ صفحهٔ بعد',
    csv.status === 200 && csv.headers.get('content-type')?.startsWith('text/csv') && csv.text.startsWith('﻿payment_id,amount')
      && csv.headers.get('content-disposition') === 'attachment; filename="vill3n-finance-payments-2026-10-31.csv"'
      && csv.headers.get('x-row-count') === '1' && csv.headers.get('x-next-cursor') === 'WzE3MDAsInBheTEiXQ'
      && csv.headers.get('cache-control') === 'no-store', `${csv.status} ${[...csv.headers].join(' ')}`);
  const eUp = seen.slice(mark).find((x) => x.path === '/api/admin/finance/export');
  check('پالایش با همان فهرستِ سفید به سرورِ حساب رفت', eUp?.query?.dataset === 'payments' && eUp?.query?.fromDate === '2026-10-01' && !('evil' in (eUp?.query || {})));

  console.log('\n── تطبیقِ فروشِ آنلاین (#411) ──');
  const rc = await api('GET', `${F}/online-reconciliation?fromDate=2026-10-01&toDate=2026-10-31`, undefined, admin);
  check('admin ⇒ پاسخِ ‎/api/admin/system/reconciliation‎', rc.status === 200 && rc.json?.available === true && rc.json?.totals?.netMinor === 12345
    && seen.at(-1)?.path === '/api/admin/system/reconciliation' && seen.at(-1)?.query?.fromDate === '2026-10-01');
  reconMissing = true;
  const rc2 = await api('GET', `${F}/online-reconciliation`, undefined, admin);
  check('سرورِ حسابِ بی #411 ⇒ ۲۰۰ «در دسترس نیست» (route_missing)، نه خطای گنگ',
    rc2.status === 200 && rc2.json?.available === false && rc2.json?.reason === 'route_missing', `${rc2.status} ${rc2.text}`);
  reconMissing = false;

  console.log('\n── سندِ اصلاحی ──');
  mark = seen.length;
  const bad = async (patch, code, status = 400) => {
    const r = await api('POST', `${F}/adjustments`, { ...ok0Body, ...patch }, admin);
    return r.status === status && (r.json?.error === code);
  };
  check('⛔ بی دلیل / بی تأیید / بی کلیدِ یکتایی / نوعِ نادرست ⇒ ۴۰۰ با کدِ خودش',
    await bad({ reason: ' a ' }, 'reason_required') && await bad({ confirm: 'yes' }, 'confirm_required')
      && await bad({ idempotencyKey: '' }, 'idempotency_key_required') && await bad({ kind: 'delete' }, 'bad_kind')
      && await bad({ amount: 1.5 }, 'bad_amount'));
  check('⛔ بی رمز ⇒ ‎403 reauth_required‎؛ رمزِ نادرست ⇒ ‎403 reauth_failed‎',
    await bad({ password: undefined }, 'reauth_required', 403) && await bad({ password: 'wrong-pass' }, 'reauth_failed', 403));
  check('⛔ هیچ‌کدام از این‌ها به درِ مالیِ سرورِ حساب نرسید', !seen.slice(mark).some((x) => x.path.startsWith('/api/admin/finance')));
  const legacy = await api('POST', `${F}/adjustments`, ok0Body, admin);
  check('⛔ راهِ پیشین (ارشدِ مشترک) ⇒ ‎409 service_key_required‎ و سندی فرستاده نشد',
    legacy.status === 409 && legacy.json?.error === 'service_key_required'
      && !seen.slice(mark).some((x) => x.path === '/api/admin/finance/adjustments'), `${legacy.status} ${legacy.text}`);

  //  کلیدِ سرویس: مالکِ پنل با رمز
  const mk = await api('POST', '/api/account-admin/console/service-key', { reason: 'پلِ مالی', confirm: true, password: PASS }, admin);
  check('کلیدِ سرویس ساخته شد (راهِ امروزِ پل: service)', mk.status === 201 && mk.json?.mode === 'service', `${mk.status} ${mk.text.slice(0, 200)}`);
  mark = seen.length;
  const t0 = Date.now();
  const made = await api('POST', `${F}/adjustments`, ok0Body, admin);
  const sent = seen.slice(mark).find((x) => x.path === '/api/admin/finance/adjustments');
  check('سند ⇒ ۲۰۱ با پاسخِ تأییدشدهٔ سرورِ حساب (شمارهٔ سند)',
    made.status === 201 && made.json?.adjustment?.docNo === 'ADJ-2026-00001' && made.json?.replayed === false && made.json?.available === true,
    `${made.status} ${made.text.slice(0, 200)}`);
  check('با کلیدِ سرویس و «انجام‌دهنده» ِ همین کاربرِ پنل (admin ⇒ superadmin)',
    sent?.bearer?.startsWith('vsk_') && sent?.actor?.id === 'panel:1' && sent?.actor?.role === 'superadmin', JSON.stringify(sent?.actor));
  check('کلیدِ یکتاییِ رابط و زمانِ احرازِ دوبارهٔ پنل در سرآیند',
    sent?.idem === 'pnl-fin-0001-aaaa' && Number(sent?.reauthAt) >= t0 && Number(sent?.reauthAt) <= Date.now(), `${sent?.idem} ${sent?.reauthAt}`);
  check('⛔ بدنهٔ بالادست فقط فیلدهای سند — نه رمز، نه confirm، نه کلید',
    JSON.stringify(Object.keys(sent?.body || {})) === JSON.stringify(['paymentId', 'kind', 'reason', 'amount'])
      && !sent?.rawBody.includes(PASS), JSON.stringify(sent?.body));
  check('⛔ کلیدِ سرویس در پاسخِ پنل نیست', !made.text.includes('vsk_'));
  const again = await api('POST', `${F}/adjustments`, ok0Body, admin);
  check('همان کلید ⇒ ۲۰۰ و replayed (پاسخِ سرورِ حساب)', again.status === 200 && again.json?.replayed === true, `${again.status}`);

  console.log('\n── سقفِ حدسِ رمز ──');
  let last = null;
  for (let i = 0; i < 6; i++) last = await api('POST', `${F}/adjustments`, { ...ok0Body, password: `bad-${i}` }, admin);
  check('ششمین رمزِ نادرست در ربع ساعت ⇒ ۴۲۹', last.status === 429, `${last.status}`);

  console.log('\n── خطای بالادست و پورتِ عمومی ──');
  failCode = 'db_unavailable';
  const fe = await api('GET', `${F}/summary`, undefined, viewer);
  check('خطای بالادست با کدِ خودش (۵۰۳ db_unavailable)، نه ۵۰۰ِ گنگ', fe.status === 503 && fe.json?.error === 'db_unavailable', `${fe.status} ${fe.text}`);
  failCode = '';
  const pub = await api('GET', `${F}/summary`, undefined, admin, `http://127.0.0.1:${PUBLIC}`);
  check('⛔ پورتِ عمومی ⇒ ۴۰۴', pub.status === 404, `${pub.status}`);

  console.log('\n── دفترِ پنل ──');
  const log = await api('GET', '/api/control/audit?limit=200&q=account.finance', undefined, admin);
  const actions = new Set((log.json?.items || log.json?.entries || log.json?.rows || []).map((r) => r.action));
  check('ردیف‌های دفترِ پنل: خروجی، سند، رمزِ نادرست', actions.has('account.finance.exported') && actions.has('account.finance.adjustment')
    && actions.has('account.finance.reauth_failed'), `${log.status} ${JSON.stringify([...actions])} ${log.text.slice(0, 200)}`);
  check('⛔ رمز در دفترِ پنل نیست', !log.text.includes(PASS) && !log.text.includes('bad-1'));
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  server.kill('SIGTERM');
  fake.close();
  await new Promise((r) => setTimeout(r, 400));
  await fsp.rm(tmp, { recursive: true, force: true });
}

if (fail) console.log('\n' + out.slice(-1500));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
