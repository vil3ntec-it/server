// ---------------------------------------------------------------------------
//  🏪 ۴.۶ مدیریتِ بازار و ۴.۷ نظارت بر پیک — درهای پلِ پنل (‎/api/account-admin/console/{market,delivery}/…‎)
//      node test/console-market.mjs
//
//  پنلِ واقعی + سرورِ حسابِ ساختگیِ ضبط‌کننده (به شکلِ ‎/api/admin/market|delivery|trust‎ ِ shop). سنجیده می‌شود:
//    ۱) شکل: پاسخِ بالادست همان‌طور + `available: true` + `fetchedAt`؛ پارامترِ ناشناخته نمی‌رود؛ ورودیِ بد ۴۰۰ پیش از پل.
//    ۲) بی توانایی (`market-admin.v1` / `delivery-watch.v1`): خواندن «داده در دسترس نیست»، نوشتن ۵۰۱ — نه عددِ ساختگی.
//    ۳) نقش: viewer خواندنی‌ها را دارد؛ پرونده، CSV و هر نوشتنی فقط admin — و ۴۰۳ پیش از هر درخواست به سرورِ حساب.
//    ۴) کارِ حساس: تأیید، دلیل، احرازِ دوباره (رمزِ غلط ۴۰۳، پنج بار ⇒ ۴۲۹)؛ رمز و «تأیید» به سرورِ حساب نمی‌روند.
//    ۵) خطای بالادست با کدِ خودش (۴۰۹ ِ «پیش‌تر تصمیم گرفته» همان ۴۰۹).
//    ۶) CSV: سرآیند، BOM، صفحه‌به‌صفحه، خنثیِ فرمول (=…)، یک ردیفِ دفترِ پنل.
//    ۷) پورتِ عمومی: هیچ‌کدام نیست (۴۰۴) و به سرورِ حساب نمی‌رسد.
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PANEL = Number(process.env.TEST_PORT || 4941);
const PUBLIC = PANEL + 1;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-market-'));
/*  ⛔ فاز ۱ (۶-۵): نشستِ تازه (ورود یا رمزِ درخواستِ قبلی، ده دقیقه) بی رمز هم از `requireRecentAuth` می‌گذرد؛
    «بی رمز ⇒ reauth_required» فقط روی نشستِ کهنه معنا دارد — همان روشِ `roles-logs` / `totp` / `security`. */
const staleAll = async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const d = new DatabaseSync(path.join(tmp, 'data', 'panel.db'));
  try { d.exec('PRAGMA busy_timeout = 5000'); d.exec('UPDATE sessions SET auth_at = 0'); } finally { d.close(); }
};

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 400)}`);
};

/* ───────────── ۰) قراردادِ دادهٔ رابط (‎web/…/market/marketData.ts‎ با خودِ Node) ───────────── */
console.log('\n── ۰) marketData.ts: «نیامده = —»، پول، سنجشِ جمع ──');
{
  const webSrc = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'web', 'src');
  let m = null;
  try { m = await import(new URL('file://' + path.join(webSrc, 'pages', 'account', 'market', 'marketData.ts')).href); }
  catch (e) { check('marketData.ts با Node اجرا می‌شود', false, e.message); }
  if (m) {
    check('⛔ نیامده «—»، صفرِ واقعی «۰»', m.shownNum(undefined) === '—' && m.shownNum(null) === '—' && m.shownNum('') === '—'
      && m.shownNum(true) === '—' && m.shownNum(0) === '۰' && m.shownNum('12') === '۱۲');
    check('پول از یک‌صدم: ۲۴۰۰۰۰ ⇒ ۲٬۴۰۰ AFN؛ نیامده «—»', m.money(240000) === '۲٬۴۰۰ AFN' && m.money(undefined) === '—', m.money(240000));
    check('سن: ۵۹ دقیقه، ۳ ساعت، ۲ روز؛ نیامده «—»', m.age(59 * 60e3) === '۵۹ دقیقه' && m.age(3 * 3600e3) === '۳ ساعت'
      && m.age(2 * 86400e3) === '۲ روز' && m.age(null) === '—' && m.age(30 * 60e3, 'en') === '30 min' && m.age(3600e3, 'en') === '1 h', `${m.age(3 * 3600e3)} ${m.age(3600e3, 'en')}`);
    check('جمعِ ردیف‌ها = جمعِ کل؛ ناهم‌خوان ⇒ نامِ ستون (و ستونِ نیامده سنجیده نمی‌شود)',
      m.sumMismatches([{ a: 1, b: 2 }, { a: 2, b: 2 }], { a: 3, b: 4 }).length === 0
      && m.sumMismatches([{ a: 1 }], { a: 2, c: null }).join() === 'a');
    check('آستانه: فقط عددِ صحیحِ ۱ تا ۱۰٬۰۸۰', m.thresholdOk(1) && m.thresholdOk(10080) && !m.thresholdOk(0) && !m.thresholdOk(1.5)
      && !m.thresholdOk('30') && !m.thresholdOk(10081));
    check('S109: نشانیِ شمارش و نشان (شناسه رمزگذاری‌شده)', m.MC?.regions === '/api/account-admin/console/market/regions'
      && m.MC?.census?.('a/b') === '/api/account-admin/console/market/census/a%2Fb', `${m.MC?.regions} ${m.MC?.census?.('a/b')}`);
    const RG = { provinces: [{ code: 'AF-BAL', name: 'بلخ', registered: 0 }, { code: 'AF-KAB', name: 'کابل', registered: 2, accepting: 1, temporarilyClosed: 1 },
      { code: 'AF-HER', name: 'هرات', registered: 1, accepting: 1, temporarilyClosed: 0 }], unknownProvince: { registered: 1, accepting: 0, temporarilyClosed: 1 },
      totals: { registered: 4, accepting: 2, temporarilyClosed: 2 } };
    check('S109: ولایتِ دکان‌دار اول؛ جمعِ ولایت‌ها + نامعلوم = جمعِ کل، ناهم‌خوان ⇒ نامِ ستون',
      m.regionRows?.(RG)?.map((p) => p.code).join() === 'AF-KAB,AF-HER,AF-BAL' && m.regionRows?.(null)?.length === 0
        && m.regionMismatches?.(RG)?.length === 0 && m.regionMismatches?.({ ...RG, totals: { ...RG.totals, accepting: 3 } })?.join() === 'accepting',
      JSON.stringify(m.regionRows?.(RG)));
    check('OPS-09: پرچمِ ویترینِ یک دکان ⇒ scope همان دکان و مقدارِ وارونه؛ حالتِ نیامده ⇒ دکمه نیست',
      JSON.stringify(m.storefrontFlagEdit?.({ shopId: 's1', gates: { storefrontFlag: false } })) === JSON.stringify({ scope: 's1', key: 'shop.storefront', from: false, to: true })
        && m.storefrontFlagEdit?.({ shopId: 's1', gates: { storefrontFlag: true } })?.to === false
        && m.storefrontFlagEdit?.({ shopId: 's1', gates: {} }) === null && m.storefrontFlagEdit?.({ shopId: '', gates: { storefrontFlag: true } }) === null);
    check('کدها به ترتیب و نوع؛ نیامده ⇒ خالی', JSON.stringify(m.issuesOf({ mismatch: ['x'], stuck: ['y'] })) === '[{"code":"y","kind":"stuck"},{"code":"x","kind":"mismatch"}]'
      && m.issuesOf(null).length === 0);
    check('هر کدِ سرور برچسبِ سه‌زبانه دارد', ['accept_overdue', 'dispatch_overdue', 'courier_unaccepted', 'pickup_overdue', 'delivery_overdue',
      'failed_unresolved', 'recall_pending', 'delivered_not_reflected', 'departed_not_reflected', 'failed_not_reflected', 'returned_not_reflected',
      'closed_order_live_mission', 'cod_not_recorded', 'cash_review', 'payment_unconfirmed'].every((k) => m.ISSUE_LABEL[k]?.fa && m.ISSUE_LABEL[k]?.en && m.ISSUE_LABEL[k]?.ps));
    check('نشانی‌ها: پارامترِ خالی نمی‌رود و شناسه رمزگذاری می‌شود', m.MC.orders({ days: 7, shopId: '', problem: false }) === '/api/account-admin/console/market/orders?days=7'
      && m.MC.caseOne('a/b') === '/api/account-admin/console/market/trust/cases/a%2Fb' && m.MC.dQueue({ view: 'stuck', shopId: 's 1' }).endsWith('view=stuck&shopId=s%201'));
  }
}

/* ───────────── سرورِ حسابِ ساختگی ───────────── */
const NOW = Date.now();
const seen = [];
const ALL_CAPS = ['market-admin.v1', 'delivery-watch.v1', 'market-regions.v1'];
let caps = [...ALL_CAPS];
let decided = false;
const ORDERS = Array.from({ length: 230 }, (_, i) => ({
  id: `o${i}`, shopId: 's1', shopName: i === 0 ? '=HYPERLINK("x")' : 'دکانِ یک', orderNo: i + 1, status: 'new',
  fulfillment: 'delivery', payment: { method: 'cod', status: 'unpaid', cod: 'to_collect' }, currency: 'AFN', totalMinor: 1000,
  createdAt: NOW, mission: null, issues: { stuck: i === 1 ? ['accept_overdue'] : [], mismatch: [], discrepancy: [] }, complaintsOpen: 0,
}));
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    let body = null;
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null; } catch { body = '<bad>'; }
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, server: 'online', version: '9.9.9' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/stamps') return j(200, {});
    seen.push({ method: req.method, path: p, query: Object.fromEntries(u.searchParams), body });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', role: 'superadmin' }, capabilities: caps, serverTime: NOW });
    if (p === '/api/admin/market/overview') return j(200, { serverTime: NOW, sellers: { total: 3 }, sellerKinds: { independent: null } });
    if (p === '/api/admin/market/sellers') return j(200, { serverTime: NOW, total: 1, sellers: [{ shopId: 's1', gates: {}, blockedBy: [] }] });
    if (p === '/api/admin/market/orders') {
      const off = Number(u.searchParams.get('offset') || 0);
      const lim = Number(u.searchParams.get('limit') || 50);
      return j(200, { serverTime: NOW, total: ORDERS.length, orders: ORDERS.slice(off, off + lim) });
    }
    if (p === '/api/admin/market/commission') return j(200, { serverTime: NOW, inModel: false, reason: 'not_in_schema' });
    if (p === '/api/admin/market/history') return j(200, { serverTime: NOW, entries: [] });
    if (p === '/api/admin/market/regions') {
      const z = (a, b, c) => ({ registered: a, accepting: b, temporarilyClosed: c });
      return j(200, { generatedAt: NOW, provinces: [{ code: 'AF-KAB', name: 'کابل', ...z(2, 1, 1), districts: [{ name: 'ناحیهٔ ۴', ...z(2, 1, 1) }] }],
        unknownProvince: z(1, 1, 0), totals: z(3, 2, 1), excluded: { test: 1, duplicate: 0, suspended: 2, notPublic: 0 },
        statuses: ['registered', 'accepting', 'temporarilyClosed'], onlineNow: null });
    }
    if (p === '/api/admin/shops/s1/census' && req.method === 'PUT') {
      return j(200, { shopId: 's1', mark: body?.kind === 'none' ? null : { kind: body?.kind, duplicateOf: body?.duplicateOf || null, reason: body?.reason } });
    }
    if (p === '/api/admin/trust/cases') return j(200, { cases: [{ id: 'tc_1', kind: 'report', status: 'open' }] });
    if (p === '/api/admin/trust/cases/tc_1') return j(200, { case: { id: 'tc_1', kind: 'report' } });
    if (p === '/api/admin/trust/sanctions') return j(200, { sanctions: [] });
    if (p === '/api/admin/trust/cases/tc_1/assign') return j(200, { id: 'tc_1', status: 'in_review' });
    if (p === '/api/admin/trust/cases/tc_1/decide') {
      if (decided) return j(409, { error: { code: 'already_decided', message: 'این پرونده پیش‌تر تصمیم گرفته است' } });
      decided = true;
      return j(200, { id: 'tc_1', shopId: 's1', outcome: body?.outcome, sanction: body?.sanction ? { id: 'tsn_1', ...body.sanction } : null });
    }
    if (p === '/api/admin/trust/cases/tc_1/appeal-decision') return j(200, { id: 'tc_1', outcome: body?.outcome, lifted: [] });
    if (p === '/api/admin/trust/sanctions/tsn_1/lift') return j(200, { id: 'tsn_1', kind: 'hide_listing', shopId: 's1' });
    if (p === '/api/admin/delivery/overview') return j(200, { serverTime: NOW, stages: { dispatch: 2 } });
    if (p === '/api/admin/delivery/queue') {
      return j(200, { serverTime: NOW, total: 1, rows: [{ orderId: 'o1', shopId: 's1', shopName: '+cmd', orderNo: 1, status: 'packed', stage: 'dispatch', ageMs: 3600e3, issues: { stuck: ['dispatch_overdue'], mismatch: [], discrepancy: [] } }] });
    }
    if (p === '/api/admin/delivery/events') return j(200, { serverTime: NOW, events: [] });
    if (p === '/api/admin/delivery/connectivity') return j(200, { serverTime: NOW, heartbeat: { inModel: false }, shops: [] });
    if (p === '/api/admin/delivery/report') return j(200, { serverTime: NOW, rows: [], totals: {} });
    if (p === '/api/admin/delivery/thresholds' && req.method === 'GET') return j(200, { values: { dispatchMin: 30 }, source: { dispatchMin: 'default' } });
    if (p === '/api/admin/delivery/thresholds' && req.method === 'PUT') return j(200, { ok: true, unchanged: false, values: body?.thresholds });
    return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

/* ───────────── پنلِ واقعی ───────────── */
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  cwd: path.join(path.dirname(new URL(import.meta.url).pathname), '..'),
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
         HLP_SITESYNC: '1', HLP_SITESYNC_PORT: String(PUBLIC), HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_AUTOMATION: '0',
         HLP_STATIONS: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_ACCOUNT_API: `http://127.0.0.1:${fake.address().port}`,
         HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret', HLP_AUTH_RATE_LIMIT: '100000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const BASE = `http://127.0.0.1:${PANEL}`;
async function api(method, p, body, token, base = BASE) {
  const res = await fetch(base + p, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString('utf8');
  let json = null;
  try { json = JSON.parse(text); } catch { /* CSV */ }
  return { status: res.status, json, text, buf, headers: res.headers };
}
const C = '/api/account-admin/console';
const since = (n) => seen.slice(n);
const up = (n, pth) => since(n).filter((c) => c.path === pth);

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await api('POST', '/api/auth/setup', { username: 'admin', password: 'Market-1405-test' });
  const login = async (u, pw) => (await api('POST', '/api/auth/login', { username: u, password: pw })).json?.token;
  const admin = await login('admin', 'Market-1405-test');
  for (const [u, role] of [['op1', 'operator'], ['view1', 'viewer']]) {
    await api('POST', '/api/auth/users', { username: u, password: `Market-${role}-1405`, role }, admin);
  }
  const op = await login('op1', 'Market-operator-1405');
  const viewer = await login('view1', 'Market-viewer-1405');
  check('سه نشست', Boolean(admin && op && viewer));

  console.log('\n── ۱) شکل و پارامترها ──');
  let n = seen.length;
  const ov = await api('GET', `${C}/market/overview?days=7&evil=1`, undefined, viewer);
  check('viewer: نمای کلیِ بازار ۲۰۰ با available و fetchedAt و همان دادهٔ بالادست',
    ov.status === 200 && ov.json?.available === true && ov.json?.fetchedAt > 0 && ov.json?.sellers?.total === 3 && ov.json?.sellerKinds?.independent === null,
    JSON.stringify(ov.json));
  const ovUp = up(n, '/api/admin/market/overview')[0];
  check('فقط پارامترِ شناخته (days) به سرورِ حساب رفت', ovUp && ovUp.query.days === '7' && !('evil' in ovUp.query), JSON.stringify(ovUp));
  n = seen.length;
  const so = await api('GET', `${C}/market/sellers?q=${encodeURIComponent('کریم')}&state=held&limit=10&offset=5`, undefined, viewer);
  const soUp = up(n, '/api/admin/market/sellers')[0];
  check('فروشنده‌ها: q، state، limit، offset همان‌طور', so.status === 200 && soUp?.query.q === 'کریم' && soUp?.query.state === 'held' && soUp?.query.limit === '10' && soUp?.query.offset === '5', JSON.stringify(soUp));
  for (const [pth, why] of [['market/sellers?state=bogus', 'state'], ['market/sellers?limit=51', 'limit>50'], ['market/orders?shopId=a/b', 'shopId'],
    ['market/orders?group=x', 'group'], ['market/overview?days=0', 'days'], ['delivery/queue?view=x', 'view'], ['delivery/events?kind=x', 'kind'],
    ['delivery/queue?limit=201', 'limit>200']]) {
    n = seen.length;
    const r = await api('GET', `${C}/${pth}`, undefined, admin);
    check(`ورودیِ بد (${why}) ⇒ ۴۰۰ پیش از پل`, r.status === 400 && since(n).length === 0, `${r.status} ${since(n).length}`);
  }
  for (const pth of ['market/commission', 'market/history', 'delivery/overview', 'delivery/queue?view=stuck', 'delivery/events',
    'delivery/connectivity', 'delivery/report?days=30', 'delivery/thresholds', 'market/orders?problem=1']) {
    const r = await api('GET', `${C}/${pth}`, undefined, viewer);
    check(`viewer: ${pth} ۲۰۰`, r.status === 200 && r.json?.available === true, `${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
  }

  console.log('\n── ۲) بی توانایی: «داده در دسترس نیست»، نوشتن ۵۰۱ ──');
  caps = [];
  n = seen.length;
  const na = await api('GET', `${C}/market/overview`, undefined, viewer);
  check('خواندن ⇒ ۲۰۰ ِ available:false با نامِ توانایی، بی صدا زدنِ مقصد',
    na.status === 200 && na.json?.available === false && na.json?.capability === 'market-admin.v1' && up(n, '/api/admin/market/overview').length === 0,
    JSON.stringify(na.json));
  const nd = await api('GET', `${C}/delivery/queue`, undefined, viewer);
  check('۴.۷ هم همین', nd.json?.available === false && nd.json?.capability === 'delivery-watch.v1');
  n = seen.length;
  const nw = await api('PUT', `${C}/delivery/thresholds`, { thresholds: { dispatchMin: 40 }, reason: 'آزمون', confirm: true, password: 'Market-1405-test' }, admin);
  check('نوشتنِ آستانه ⇒ ۵۰۱ capability_missing، نه «انجام شد»', nw.status === 501 && nw.json?.error === 'capability_missing' && up(n, '/api/admin/delivery/thresholds').length === 0, JSON.stringify(nw.json));
  const ncsv = await api('GET', `${C}/market/orders.csv`, undefined, admin);
  check('CSV بی توانایی ⇒ ۵۰۱', ncsv.status === 501);
  caps = [...ALL_CAPS];

  console.log('\n── ۳) نقش: پرونده، CSV و نوشتن فقط admin، و ۴۰۳ پیش از پل ──');
  for (const [method, pth, body] of [
    ['GET', 'market/trust/cases', undefined], ['GET', 'market/trust/cases/tc_1', undefined], ['GET', 'market/trust/sanctions', undefined],
    ['POST', 'market/trust/cases/tc_1/assign', { confirm: true }],
    ['POST', 'market/trust/cases/tc_1/decide', { outcome: 'dismissed', reason: 'آزمونِ نقش', confirm: true, password: 'x' }],
    ['POST', 'market/trust/cases/tc_1/appeal-decision', { outcome: 'upheld', reason: 'آزمونِ نقش', confirm: true, password: 'x' }],
    ['POST', 'market/trust/sanctions/tsn_1/lift', { reason: 'آزمونِ نقش', confirm: true, password: 'x' }],
    ['GET', 'market/orders.csv', undefined], ['GET', 'delivery/queue.csv', undefined],
    ['PUT', 'delivery/thresholds', { thresholds: { dispatchMin: 40 }, reason: 'آزمونِ نقش', confirm: true, password: 'x' }],
  ]) {
    for (const [who, t] of [['operator', op], ['viewer', viewer]]) {
      n = seen.length;
      const r = await api(method, `${C}/${pth}`, body, t);
      check(`${who}: ${method} ${pth} ⇒ ۴۰۳ و هیچ درخواستی به سرورِ حساب`, r.status === 403 && since(n).length === 0, `${r.status} ${since(n).map((c) => c.path).join(',')}`);
    }
  }
  const noAuth = await api('GET', `${C}/market/overview`);
  check('بی نشست ⇒ ۴۰۱', noAuth.status === 401);

  console.log('\n── ۴) کارِ حساس: تأیید، دلیل، احرازِ دوباره ──');
  const good = { outcome: 'upheld', severity: 'high', sanction: { kind: 'hide_listing', productId: 'rice' }, reason: 'کالای تقلبی', confirm: true, password: 'Market-1405-test', idempotencyKey: 'mkt-decide-0001' };
  for (const [why, b, code] of [
    ['بی تأیید', { ...good, confirm: false }, 'confirm_required'],
    ['بی دلیل', { ...good, reason: 'ab' }, 'reason_required'],
    ['نتیجهٔ ناشناخته', { ...good, outcome: 'maybe' }, 'bad_query'],
    ['جریمه با «رد»', { ...good, outcome: 'dismissed' }, 'bad_sanction'],
    ['نوعِ جریمهٔ ناشناخته', { ...good, sanction: { kind: 'ban_forever' } }, 'bad_query'],
  ]) {
    n = seen.length;
    const r = await api('POST', `${C}/market/trust/cases/tc_1/decide`, b, admin);
    check(`${why} ⇒ ۴۰۰ ${code} و هیچ تصمیمی نرفت`, r.status === 400 && r.json?.error === code && up(n, '/api/admin/trust/cases/tc_1/decide').length === 0, `${r.status} ${JSON.stringify(r.json)}`);
  }
  n = seen.length;
  await staleAll();
  const noPw = await api('POST', `${C}/market/trust/cases/tc_1/decide`, { ...good, password: undefined }, admin);
  check('بی رمز ⇒ ۴۰۳ reauth_required', noPw.status === 403 && noPw.json?.error === 'reauth_required' && since(n).length === 0, JSON.stringify(noPw.json));
  const ok = await api('POST', `${C}/market/trust/cases/tc_1/decide`, good, admin);
  const dUp = up(n, '/api/admin/trust/cases/tc_1/decide')[0];
  check('با رمز ⇒ ۲۰۰ و تصمیم با دلیل به سرورِ حساب رفت', ok.status === 200 && ok.json?.sanction?.id === 'tsn_1' && dUp?.body?.reason === 'کالای تقلبی' && dUp?.body?.sanction?.kind === 'hide_listing', JSON.stringify(dUp));
  check('⛔ رمز، «تأیید»، کلیدِ رابط و فیلدِ ناشناخته به سرورِ حساب نرفتند', dUp && !('password' in dUp.body) && !('confirm' in dUp.body) && !('idempotencyKey' in dUp.body)
    && Object.keys(dUp.body).sort().join() === 'outcome,reason,sanction,severity', JSON.stringify(dUp?.body));
  const again = await api('POST', `${C}/market/trust/cases/tc_1/decide`, { ...good, idempotencyKey: 'mkt-decide-0002' }, admin);
  check('⛔ تکرار ⇒ ۴۰۹ already_decided ِ همان سرورِ حساب (کدِ خودش، نه ۵۰۲)', again.status === 409 && again.json?.error === 'already_decided', JSON.stringify(again.json));
  const ap = await api('POST', `${C}/market/trust/cases/tc_1/appeal-decision`, { outcome: 'reversed', reason: 'مدرکِ تازه', confirm: true, password: 'Market-1405-test', idempotencyKey: 'mkt-appeal-0001' }, admin);
  check('رأیِ اعتراض ۲۰۰', ap.status === 200 && ap.json?.outcome === 'reversed');
  const lf = await api('POST', `${C}/market/trust/sanctions/tsn_1/lift`, { reason: 'اشتباه بود', confirm: true, password: 'Market-1405-test', idempotencyKey: 'mkt-lift-0001' }, admin);
  check('برداشتنِ جریمه ۲۰۰', lf.status === 200 && lf.json?.kind === 'hide_listing');
  const asg = await api('POST', `${C}/market/trust/cases/tc_1/assign`, { confirm: true, idempotencyKey: 'mkt-assign-0001' }, admin);
  check('مسئولِ پرونده ۲۰۰', asg.status === 200 && asg.json?.status === 'in_review');
  n = seen.length;
  const th = await api('PUT', `${C}/delivery/thresholds`, { thresholds: { dispatchMin: 45, inDeliveryMin: 180 }, reason: 'شبِ شلوغ', confirm: true, password: 'Market-1405-test' }, admin);
  const tUp = up(n, '/api/admin/delivery/thresholds')[0];
  check('آستانه‌ها: PUT با دلیل؛ بدنهٔ بالادست فقط thresholds و reason', th.status === 200 && tUp?.method === 'PUT'
    && Object.keys(tUp.body).sort().join() === 'reason,thresholds' && tUp.body.thresholds.dispatchMin === 45, JSON.stringify(tUp));
  for (const bad of [{ zzz: 5 }, { dispatchMin: 0 }, { dispatchMin: 1.5 }, {}]) {
    n = seen.length;
    const r = await api('PUT', `${C}/delivery/thresholds`, { thresholds: bad, reason: 'آزمون', confirm: true, password: 'Market-1405-test' }, admin);
    check(`آستانهٔ بد ${JSON.stringify(bad)} ⇒ ۴۰۰ پیش از پل`, r.status === 400 && r.json?.error === 'bad_thresholds' && since(n).length === 0, JSON.stringify(r.json));
  }
  //  حدسِ رمز: پنج غلط ⇒ ۴۲۹ (همان سطلِ کاربر)
  let codes = [];
  for (let i = 0; i < 6; i++) {
    codes.push((await api('POST', `${C}/market/trust/sanctions/tsn_1/lift`, { reason: 'حدس', confirm: true, password: `wrong-${i}` }, admin)).status);
  }
  check('⛔ رمزِ غلط ۴۰۳ و ششمی ۴۲۹', codes.slice(0, 5).every((c) => c === 403) && codes[5] === 429, codes.join(','));

  console.log('\n── ۵) CSV ──');
  n = seen.length;
  const csv = await api('GET', `${C}/market/orders.csv?days=30`, undefined, admin);
  const lines = csv.text.replace(/^\uFEFF/, '').trim().split('\n');
  check('CSV: text/csv، BOM، سرآیند و همهٔ ۲۳۰ ردیف (دو صفحه)', csv.status === 200 && /text\/csv/.test(csv.headers.get('content-type') || '')
    && csv.buf[0] === 0xef && csv.buf[1] === 0xbb && csv.buf[2] === 0xbf && lines[0].startsWith('orderId,shopId,shopName') && lines.length === 231
    && up(n, '/api/admin/market/orders').length === 2, `${csv.status} ${lines.length} ${up(n, '/api/admin/market/orders').length}`);
  check('⛔ خانهٔ فرمول‌دار خنثی شد (=… ⇒ \'=…)', lines[1].includes(`"'=HYPERLINK(""x"")"`), lines[1]);
  check('کدهای «گیر کرده» در ستونِ issues', lines[2].includes('accept_overdue'), lines[2]);
  const qcsv = await api('GET', `${C}/delivery/queue.csv?view=stuck`, undefined, admin);
  check('CSV ِ صفِ تحویل: + هم خنثی و سن به دقیقه', qcsv.status === 200 && qcsv.text.includes("'+cmd") && qcsv.text.includes(',60,'), qcsv.text.slice(0, 300));
  const log = await api('GET', '/api/control/audit?limit=80', undefined, admin);
  const logText = JSON.stringify(log.json || {});
  for (const a of ['account.market.orders_exported', 'account.delivery.queue_exported', 'account.market.case_decided',
    'account.market.appeal_decided', 'account.market.sanction_lifted', 'account.market.case_assigned',
    'account.delivery.thresholds_set', 'account.market.reauth_failed']) {
    check(`دفترِ پنل: ${a}`, logText.includes(a));
  }
  check('⛔ هیچ رمزی در دفترِ پنل نیست', !logText.includes('Market-1405-test') && !logText.includes('wrong-1'));

  console.log('\n── ۷) S109: شمارشِ منطقه‌ای و نشانِ «آزمایشی/تکراری» ──');
  n = seen.length;
  const rg = await api('GET', `${C}/market/regions?evil=1`, undefined, viewer);
  const rgUp = up(n, '/api/admin/market/regions')[0];
  check('viewer: شمارشِ منطقه‌ای ۲۰۰ با available، fetchedAt و همان دادهٔ بالادست (onlineNow: null)',
    rg.status === 200 && rg.json?.available === true && Number.isFinite(rg.json?.fetchedAt) && rg.json?.provinces?.[0]?.code === 'AF-KAB'
      && rg.json?.provinces?.[0]?.districts?.[0]?.registered === 2 && rg.json?.excluded?.test === 1 && rg.json?.onlineNow === null,
    `${rg.status} ${JSON.stringify(rg.json).slice(0, 200)}`);
  check('هیچ پارامتری (حتی evil) به سرورِ حساب نرفت', rgUp && Object.keys(rgUp.query).length === 0, JSON.stringify(rgUp));
  const cgood = { kind: 'duplicate', duplicateOf: 's2', reason: 'دو بار ثبت شده', confirm: true };
  for (const [who, h] of [['operator', op], ['viewer', viewer]]) {
    n = seen.length;
    const r = await api('PUT', `${C}/market/census/s1`, cgood, h);
    check(`⛔ ${who}: نشانِ سرشماری ۴۰۳ و هیچ درخواستی بالا نرفت`, r.status === 403 && since(n).length === 0, `${r.status} ${since(n).map((x) => x.path)}`);
  }
  for (const [why, sid, b] of [
    ['نوعِ ناشناخته', 's1', { ...cgood, kind: 'fake' }], ['بی نوع', 's1', { ...cgood, kind: undefined }],
    ['تکراری بی دکانِ اصل', 's1', { ...cgood, duplicateOf: '' }], ['تکراریِ خودش', 's1', { ...cgood, duplicateOf: 's1' }],
    ['بی دلیل', 's1', { ...cgood, reason: '' }], ['بی تأیید', 's1', { ...cgood, confirm: false }], ['شناسهٔ بد', 'a%20b', cgood],
  ]) {
    n = seen.length;
    const r = await api('PUT', `${C}/market/census/${sid}`, b, admin);
    check(`نشانِ بد (${why}) ⇒ ۴۰۰ پیش از پل`, r.status === 400 && since(n).length === 0, `${r.status} ${JSON.stringify(r.json)}`);
  }
  n = seen.length;
  const cs = await api('PUT', `${C}/market/census/s1`, { ...cgood, extra: 'x' }, admin);
  const csUp = up(n, '/api/admin/shops/s1/census')[0];
  check('admin: نشان ⇒ PUT ِ ‎/api/admin/shops/s1/census‎ فقط با kind، duplicateOf و reason؛ «تأییدشده از سرور»',
    cs.status === 200 && cs.json?.confirmedByServer === true && cs.json?.mark?.kind === 'duplicate' && csUp?.method === 'PUT'
      && JSON.stringify(csUp.body) === JSON.stringify({ kind: 'duplicate', duplicateOf: 's2', reason: 'دو بار ثبت شده' }),
    `${cs.status} ${JSON.stringify(cs.json)} ${JSON.stringify(csUp)}`);
  n = seen.length;
  const cn = await api('PUT', `${C}/market/census/s1`, { kind: 'none', duplicateOf: 's2', reason: 'برداشتنِ نشان', confirm: true }, admin);
  check('برداشتنِ نشان (none) ⇒ duplicateOf نمی‌رود', cn.status === 200
    && JSON.stringify(up(n, '/api/admin/shops/s1/census')[0]?.body) === JSON.stringify({ kind: 'none', reason: 'برداشتنِ نشان' }), JSON.stringify(cn.json));
  caps = ['market-admin.v1', 'delivery-watch.v1'];
  n = seen.length;
  const rgNo = await api('GET', `${C}/market/regions`, undefined, viewer);
  const csNo = await api('PUT', `${C}/market/census/s1`, cgood, admin);
  check('بی ‎market-regions.v1‎: خواندن «در دسترس نیست» با نامِ توانایی، نوشتن ۵۰۱ — هیچ‌کدام به مقصد نرسید',
    rgNo.json?.available === false && rgNo.json?.capability === 'market-regions.v1' && csNo.status === 501 && csNo.json?.error === 'capability_missing'
      && up(n, '/api/admin/market/regions').length === 0 && up(n, '/api/admin/shops/s1/census').length === 0, `${JSON.stringify(rgNo.json)} ${csNo.status}`);
  caps = [...ALL_CAPS];
  n = seen.length;
  const pubR = [await api('GET', `${C}/market/regions`, undefined, admin, `http://127.0.0.1:${PUBLIC}`),
    await api('PUT', `${C}/market/census/s1`, cgood, admin, `http://127.0.0.1:${PUBLIC}`)];
  check('⛔ شمارش و نشان روی پورتِ عمومی نیستند', pubR.every((r) => r.status === 404) && since(n).length === 0, pubR.map((r) => r.status).join(' '));
  const log2 = await api('GET', '/api/control/audit?limit=80', undefined, admin);
  check('دفترِ پنل: account.market.census_marked', JSON.stringify(log2.json || {}).includes('account.market.census_marked'));

  console.log('\n── ۶) پورتِ عمومی ──');
  n = seen.length;
  const bad = [];
  for (const [m, pth] of [['GET', 'market/overview'], ['GET', 'market/orders.csv'], ['GET', 'market/trust/cases'],
    ['POST', 'market/trust/cases/tc_1/decide'], ['GET', 'delivery/queue'], ['PUT', 'delivery/thresholds'], ['GET', 'delivery/report']]) {
    const r = await api(m, `${C}/${pth}`, m === 'GET' ? undefined : {}, admin, `http://127.0.0.1:${PUBLIC}`);
    if (r.status !== 404) bad.push(`${m} ${pth} ⇒ ${r.status}`);
  }
  check('⛔ هیچ درِ ۴.۶/۴.۷ روی پورتِ عمومی نیست و به سرورِ حساب نمی‌رسد', bad.length === 0 && since(n).length === 0, bad.join(' · '));
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  server.kill('SIGTERM');
  fake.close();
  await new Promise((r) => setTimeout(r, 300));
  await fsp.rm(tmp, { recursive: true, force: true });
}

if (fail) console.log('\n' + out.slice(-1500));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
