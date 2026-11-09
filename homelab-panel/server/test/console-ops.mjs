// ---------------------------------------------------------------------------
//  ماژول‌های عملیاتِ کنسولِ فروشگاه (۴.۸ · ۴.۹ · ۴.۱۰ · ۴.۱۱ · ۴.۱۳) — پلِ ‎routes/console-ops.js‎
//      node test/console-ops.mjs
//
//  پنلِ واقعی بالا می‌آید و یک سرورِ حسابِ ساختگی درهای ‎/api/admin/ops/*‎ و ‎/api/admin/release/stage‎ را
//  به شکلِ shop ِ ‎claude/console-ops-api‎ (و #559) جواب می‌دهد. سنجیده می‌شود:
//    • شکلِ پاسخِ پل (‎available‎، ‎fetchedAt‎) و این‌که فقط پارامترهای شناخته بالا می‌روند
//    • «توانایی» نیامده ⇒ خواندن «داده در دسترس نیست»، نوشتن ‎501‎ — نه «انجام شد» ِ دروغ
//    • نقش: viewer می‌خواند، operator تریاژ می‌کند، CSV فقط admin، انتشارِ مرحله‌ای فقط مالک + رمز + دلیل + تأیید
//    • رمزِ احرازِ دوباره هرگز بالا نمی‌رود؛ خطای بالادست با کدِ خودش؛ پورتِ عمومی ۴۰۴
//    • سلامت: سرورِ حسابِ خاموش ⇒ سنجه‌های پنل می‌مانند و «از کار افتاده» با کدِ خطا (نه کلِ صفحه)
//    • CSV: BOM، بی تزریقِ فرمول، یک ردیفِ دفترِ پنل
//    • هشدار به رباتِ مالک: فقط نوعِ برگزیده، از «حالا» به بعد، یک بار برای هر هشدار، سقفِ ۵ + پیامِ جمعی،
//      پیامِ نرفته دوباره، بی راز
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PANEL = Number(process.env.TEST_PORT || 4941);
const PUBLIC = PANEL + 1;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-ops-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 400)}`);
};

/* ───────────── سرورِ حسابِ ساختگی ───────────── */
const NOW = Date.now();
const seen = [];
let caps = ['actor.v1', 'ops.v1', 'release-stage.v1'];
let down = false;
let alertsFeed = [];
const INCIDENTS = [
  { id: 'inc_1', source: 'client', app: 'shop', title: '=HYPERLINK("http://x")', kind: 'k', status: 'open', priority: 'p2', occurrences: 3, firstSeenAt: NOW - 9e5, lastSeenAt: NOW, lastVersion: '2.14.5', supportThreadId: '', version: 2 },
  { id: 'inc_2', source: 'server', app: 'server', title: 'GET /api/x — "boom", again', kind: 'Error', status: 'resolved', priority: 'p3', occurrences: 1, firstSeenAt: NOW - 9e5, lastSeenAt: NOW - 1e5, lastVersion: '2.14.5', supportThreadId: 'thr_1', version: 4 },
];
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    let body = null;
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null; } catch { body = null; }
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, version: '9.9.9' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    seen.push({ method: req.method, path: p, query: Object.fromEntries(u.searchParams), body, idem: req.headers['idempotency-key'] || '' });
    if (down) return j(503, { error: { code: 'db_unavailable', message: 'پایگاه در دسترس نیست' } });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: caps, serverTime: NOW });
    if (p === '/api/admin/ops/releases') return j(200, { checkedAt: NOW, api: { version: '2.14.5' }, schema: { migration: '173_ops_console.sql' }, channels: [], apps: {}, stage: { supported: true, rollback: { supported: false } } });
    if (p === '/api/admin/ops/health') return j(200, { checkedAt: NOW, status: 'warn', parts: { jobs: 'warn' }, jobs: [{ name: 'login-outbox', status: 'unknown' }], definitions: { ok: 'x', warn: 'y', down: 'z', unknown: 'w' } });
    if (p === '/api/admin/ops/integrations') return j(200, { checkedAt: NOW, providers: [], credentials: [{ id: 'HESABPAY_API_KEY', set: false }], webhooks: [{ id: 'hesabpay', state: 'blocked' }] });
    if (p === '/api/admin/ops/incidents') {
      const off = Number(u.searchParams.get('offset') || 0);
      return j(200, { incidents: off === 0 ? INCIDENTS : [], total: INCIDENTS.length, limit: 200, offset: off, counts: { open: 1, resolved: 1 } });
    }
    if (p === '/api/admin/ops/incidents/inc_1') return j(200, { incident: INCIDENTS[0], occurrences: [], events: [], checkedAt: NOW });
    if (p === '/api/admin/ops/incidents/inc_stale/status') return j(409, { error: { code: 'incident_changed', message: 'این رخداد همین حالا عوض شد' } });
    if (/^\/api\/admin\/ops\/incidents\/[^/]+\/(status|priority|link)$/.test(p)) return j(200, { incident: INCIDENTS[0], changed: true });
    if (/^\/api\/admin\/ops\/incidents\/[^/]+\/notes$/.test(p)) return j(201, { ok: true });
    if (p === '/api/admin/ops/alerts') {
      const since = Number(u.searchParams.get('since') || 0);
      const list = alertsFeed.filter((a) => a.liveSince > since);
      return j(200, { alerts: list, total: list.length, counts: {}, definitions: [], evaluation: { evaluatedAt: NOW } });
    }
    if (p === '/api/admin/ops/alerts/evaluate') return j(200, { evaluatedAt: NOW, rules: [] });
    if (/^\/api\/admin\/ops\/alerts\/[^/]+\/(ack|resolve)$/.test(p)) return j(200, { alert: { id: 'alr_1', status: 'acknowledged' }, changed: true });
    if (p === '/api/admin/release/stage') {
      if (req.method === 'GET') return j(200, { stages: { 'tohid-native': null }, version: 1 });
      if (req.method === 'PUT') return j(200, { ok: true, stages: { 'tohid-native': { version: body?.version, percent: body?.percent } } });
      if (req.method === 'DELETE') return j(200, { ok: true, removed: true, stages: { 'tohid-native': null } });
    }
    return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const FAKE_URL = `http://127.0.0.1:${fake.address().port}`;

/* ───────────── پنلِ واقعی ───────────── */
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
         HLP_SITESYNC: '1', HLP_SITESYNC_PORT: String(PUBLIC),
         HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_AUTOMATION: '0', HLP_STATIONS: '0',
         HLP_ACCOUNT_API: FAKE_URL, HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret',
         HLP_AUTH_RATE_LIMIT: '100000', HLP_TG_WATCH_MS: '0', HLP_TG_LONGPOLL: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const BASE = `http://127.0.0.1:${PANEL}`;
async function api(method, p, body, headers = {}, base = BASE) {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text, headers: res.headers };
}
const lastTo = (p) => [...seen].reverse().find((s) => s.path === p);

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await api('POST', '/api/auth/setup', { username: 'owner', password: 'Ops-1405-owner' });
  const login = async (u, pw) => (await api('POST', '/api/auth/login', { username: u, password: pw })).json?.token;
  const owner = await login('owner', 'Ops-1405-owner');
  const H = (t) => ({ Authorization: `Bearer ${t}` });
  for (const [u, role] of [['admin2', 'admin'], ['op1', 'operator'], ['view1', 'viewer']]) {
    await api('POST', '/api/auth/users', { username: u, password: `Ops-${role}-1405`, role }, H(owner));
  }
  const T = { owner, admin2: await login('admin2', 'Ops-admin-1405'), op: await login('op1', 'Ops-operator-1405'), view: await login('view1', 'Ops-viewer-1405') };
  check('چهار نشست: مالک · admin ِ دوم · operator · viewer', Object.values(T).every(Boolean));

  console.log('\n── خواندن: شکل، منبع و پارامترهای شناخته ──');
  for (const p of ['releases', 'integrations', 'incidents', 'alerts']) {
    const r = await api('GET', `/api/account-admin/console/ops/${p}`, undefined, H(T.view));
    check(`viewer ‎${p}‎ ⇒ ۲۰۰، available و fetchedAt`, r.status === 200 && r.json?.available === true && r.json?.fetchedAt > 0, `${r.status} ${r.text.slice(0, 200)}`);
  }
  await api('GET', '/api/account-admin/console/ops/incidents?q=boom&shop=s1&status=open&evil=1&limit=25', undefined, H(T.view));
  const iq = lastTo('/api/admin/ops/incidents')?.query || {};
  check('فقط پارامترهای شناخته به سرورِ حساب می‌رود (evil نه)', iq.q === 'boom' && iq.shop === 's1' && iq.status === 'open' && iq.limit === '25' && iq.evil === undefined, JSON.stringify(iq));
  const integ = await api('GET', '/api/account-admin/console/ops/integrations', undefined, H(T.view));
  check('یکپارچه‌سازی: درگاهِ همین پنل گفته می‌شود — وب‌هوکِ پرداخت از اینترنت می‌رسد یا نه', typeof integ.json?.panel?.gateway?.paymentsWebhookForwarded === 'boolean', JSON.stringify(integ.json?.panel));
  check('یکپارچه‌سازی: هیچ رمز یا توکنی از پنل نمی‌آید', !integ.text.includes('top-secret') && !integ.text.includes('tok-1'));

  console.log('\n── سلامت: سنجه‌های پنل همیشه؛ سرورِ حسابِ خاموش کلِ صفحه را نمی‌خواباند ──');
  const hOk = await api('GET', '/api/account-admin/console/ops/health', undefined, H(T.view));
  check('پنل + سرورِ حساب', hOk.status === 200 && hOk.json?.panel?.bridge?.status && hOk.json?.account?.available === true && hOk.json?.panel?.panel?.version !== undefined, hOk.text.slice(0, 300));
  check('رفت‌وبرگشتِ پل سنجیده شد (عدد، نه حدس)', Number.isFinite(hOk.json?.panel?.bridge?.latencyMs), JSON.stringify(hOk.json?.panel?.bridge));
  check('سلامت: نه رمزِ ارشد، نه پوشهٔ سرورِ حساب', !hOk.text.includes('top-secret') && !hOk.text.includes(tmp));
  down = true;
  const hDown = await api('GET', '/api/account-admin/console/ops/health', undefined, H(T.view));
  down = false;
  check('سرورِ حسابِ خاموش ⇒ ۲۰۰ با پنل و «از کار افتاده» با کدِ خطا', hDown.status === 200 && hDown.json?.panel?.bridge?.status === 'down'
    && hDown.json?.account?.available === false && hDown.json?.panel?.panel?.status === 'ok', hDown.text.slice(0, 300));

  console.log('\n── «توانایی» نیامده ──');
  caps = ['actor.v1'];
  const noCap = await api('GET', '/api/account-admin/console/ops/incidents', undefined, H(T.view));
  check('خواندن ⇒ ۲۰۰ ِ «داده در دسترس نیست» با نامِ توانایی', noCap.status === 200 && noCap.json?.available === false && noCap.json?.capability === 'ops.v1', noCap.text);
  const before = seen.length;
  const noCapW = await api('POST', '/api/account-admin/console/ops/incidents/inc_1/status', { status: 'investigating' }, H(T.op));
  check('نوشتن ⇒ ۵۰۱ capability_missing و هیچ نوشتنی بالا نمی‌رود', noCapW.status === 501 && noCapW.json?.error === 'capability_missing'
    && !seen.slice(before).some((s) => s.method !== 'GET'), noCapW.text);
  const noStage = await api('GET', '/api/account-admin/console/release/stage', undefined, H(T.owner));
  check('بی release-stage.v1 ⇒ انتشارِ مرحله‌ای «داده در دسترس نیست»', noStage.json?.available === false && noStage.json?.capability === 'release-stage.v1', noStage.text);
  caps = ['actor.v1', 'ops.v1', 'release-stage.v1'];

  console.log('\n── رخداد: نقش، کدِ خطای بالادست، کلیدِ یکتایی ──');
  const vw = await api('POST', '/api/account-admin/console/ops/incidents/inc_1/status', { status: 'investigating' }, H(T.view));
  check('viewer تریاژ نمی‌کند (۴۰۳)', vw.status === 403, vw.text);
  const badSt = await api('POST', '/api/account-admin/console/ops/incidents/inc_1/status', { status: 'closed' }, H(T.op));
  check('وضعیتِ ناشناخته ۴۰۰ و بالا نمی‌رود', badSt.status === 400 && badSt.json?.error === 'bad_status');
  const st = await api('POST', '/api/account-admin/console/ops/incidents/inc_1/status', { status: 'investigating', note: 'دیدم', expectedVersion: 2, extra: 'x' }, H(T.op));
  const stUp = lastTo('/api/admin/ops/incidents/inc_1/status');
  check('operator ⇒ وضعیت؛ بدنهٔ بالادست فقط status/note/expectedVersion', st.status === 200 && JSON.stringify(Object.keys(stUp.body).sort()) === JSON.stringify(['expectedVersion', 'note', 'status']), JSON.stringify(stUp?.body));
  const stale = await api('POST', '/api/account-admin/console/ops/incidents/inc_stale/status', { status: 'resolved' }, H(T.op));
  check('خطای بالادست با کدِ خودش (۴۰۹ incident_changed)', stale.status === 409 && stale.json?.error === 'incident_changed', stale.text);
  const nt = await api('POST', '/api/account-admin/console/ops/incidents/inc_1/notes', { note: 'تماس گرفتم', idempotencyKey: 'ops-note-key-001' }, H(T.op));
  check('یادداشت: کلیدِ یکتاییِ رابط در Idempotency-Key بالا می‌رود', nt.status === 201 && lastTo('/api/admin/ops/incidents/inc_1/notes')?.idem === 'ops-note-key-001', nt.text);
  const badKey = await api('POST', '/api/account-admin/console/ops/incidents/inc_1/notes', { note: 'x y', idempotencyKey: 'bad key!' }, H(T.op));
  check('کلیدِ یکتاییِ ناجور ۴۰۰', badKey.status === 400 && badKey.json?.error === 'bad_idempotency_key');
  const badId = await api('GET', '/api/account-admin/console/ops/incidents/..%2F..%2Fadmins', undefined, H(T.view));
  check('شناسهٔ خراب به آن‌طرف نمی‌رود', badId.status === 400 || badId.status === 404, `${badId.status}`);

  console.log('\n── CSV ──');
  const csvOp = await api('GET', '/api/account-admin/console/ops/incidents.csv', undefined, H(T.op));
  check('operator خروجی نمی‌گیرد (۴۰۳)', csvOp.status === 403);
  const csv = await api('GET', '/api/account-admin/console/ops/incidents.csv?status=open', undefined, H(T.owner));
  //  ⚠️ ‎res.text()‎ ِ fetch خودش BOM را می‌خورد ⇒ بایت‌ها خوانده می‌شوند
  const rawCsv = Buffer.from(await (await fetch(`${BASE}/api/account-admin/console/ops/incidents.csv`, { headers: H(T.owner) })).arrayBuffer());
  check('admin ⇒ text/csv با BOM و سرستون', csv.status === 200 && /text\/csv/.test(csv.headers.get('content-type') || '')
    && rawCsv.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) && csv.text.startsWith('id,status'), csv.text.slice(0, 120));
  check('⛔ بی تزریقِ فرمول: خانهٔ «=…» با ‎\'‎ شروع می‌شود', csv.text.includes(`"'=HYPERLINK(""http://x"")"`), csv.text);
  check('ویرگول و گیومه درست نقل شد', csv.text.includes('"GET /api/x — ""boom"", again"'), csv.text);
  const audit = await api('GET', '/api/control/audit?q=account.ops_incidents_exported&limit=5&offset=0', undefined, H(T.owner));
  check('یک ردیفِ دفترِ پنل برای خروجی', (audit.json?.rows || []).some((r) => r.action === 'account.ops_incidents_exported'), audit.text.slice(0, 300));

  console.log('\n── هشدار: تأیید/بستن، و انتخابِ نوع برای رباتِ مالک ──');
  const ack = await api('POST', '/api/account-admin/console/ops/alerts/alr_1/ack', { note: 'دیدم' }, H(T.op));
  check('operator ⇒ تأیید', ack.status === 200 && lastTo('/api/admin/ops/alerts/alr_1/ack')?.body?.note === 'دیدم');
  const noR = await api('POST', '/api/account-admin/console/ops/alerts/alr_1/resolve', {}, H(T.op));
  check('بستن بی دلیل ۴۰۰ (پیش از رفتن)', noR.status === 400 && noR.json?.error === 'reason_required');
  const vEval = await api('POST', '/api/account-admin/console/ops/alerts/evaluate', {}, H(T.view));
  check('viewer «همین حالا بسنج» نمی‌زند', vEval.status === 403);
  const tgGet = await api('GET', '/api/account-admin/console/ops/alerts/telegram', undefined, H(T.view));
  check('کانال‌ها: تلگرام هست، پیامک و ایمیل «آینده»', tgGet.status === 200 && tgGet.json?.channels?.sms === 'future' && tgGet.json?.channels?.email === 'future'
    && Array.isArray(tgGet.json?.types) && tgGet.json.types.length === 0, tgGet.text);
  const tgV = await api('PUT', '/api/account-admin/console/ops/alerts/telegram', { types: ['service_down'] }, H(T.view));
  const tgOp = await api('PUT', '/api/account-admin/console/ops/alerts/telegram', { types: ['service_down'] }, H(T.op));
  check('انتخابِ نوع فقط admin (viewer و operator ۴۰۳)', tgV.status === 403 && tgOp.status === 403);
  const tgBad = await api('PUT', '/api/account-admin/console/ops/alerts/telegram', { types: ['nope'] }, H(T.owner));
  check('نوعِ ناشناخته ۴۰۰', tgBad.status === 400);
  const tgOk = await api('PUT', '/api/account-admin/console/ops/alerts/telegram', { types: ['service_down', 'payment_failed'] }, H(T.owner));
  check('ذخیره شد', tgOk.status === 200 && tgOk.json?.types?.length === 2 && tgOk.json?.enabledAt > 0, tgOk.text);

  console.log('\n── انتشارِ مرحله‌ای: مالک + رمز + دلیل + تأیید؛ رمز بالا نمی‌رود ──');
  const good = { tag: 'tohid-native', version: '2.14.5', percent: 10, reason: 'ده درصدِ اول', confirm: true, password: 'Ops-1405-owner' };
  const n0 = seen.filter((s) => s.path === '/api/admin/release/stage' && s.method !== 'GET').length;
  const sView = await api('PUT', '/api/account-admin/console/release/stage', good, H(T.view));
  const sOp = await api('PUT', '/api/account-admin/console/release/stage', good, H(T.op));
  const sAdmin2 = await api('PUT', '/api/account-admin/console/release/stage', { ...good, password: 'Ops-admin-1405' }, H(T.admin2));
  check('viewer/operator ۴۰۳؛ admin ِ غیرِمالک ۴۰۳ owner_only', sView.status === 403 && sOp.status === 403 && sAdmin2.status === 403 && sAdmin2.json?.error === 'owner_only', `${sView.status} ${sOp.status} ${sAdmin2.text}`);
  const sNoPw = await api('PUT', '/api/account-admin/console/release/stage', { ...good, password: undefined }, H(T.owner));
  const sBadPw = await api('PUT', '/api/account-admin/console/release/stage', { ...good, password: 'wrong-pass-1' }, H(T.owner));
  check('مالک بی رمز ⇒ reauth_required (یا نشستِ تازه)، رمزِ غلط ⇒ reauth_failed', (sNoPw.json?.error === 'reauth_required' || sNoPw.status === 403) && sBadPw.json?.error === 'reauth_failed', `${sNoPw.text} ${sBadPw.text}`);
  const sNoR = await api('PUT', '/api/account-admin/console/release/stage', { ...good, reason: '' }, H(T.owner));
  const sNoC = await api('PUT', '/api/account-admin/console/release/stage', { ...good, confirm: false }, H(T.owner));
  const sBadP = await api('PUT', '/api/account-admin/console/release/stage', { ...good, percent: 150 }, H(T.owner));
  check('بی دلیل / بی تأیید / درصدِ بیرون از بازه ⇒ ۴۰۰', sNoR.json?.error === 'reason_required' && sNoC.json?.error === 'confirm_required' && sBadP.json?.error === 'bad_stage', `${sNoR.text} ${sNoC.text} ${sBadP.text}`);
  check('هیچ‌کدامِ این‌ها به سرورِ حساب نرسید', seen.filter((s) => s.path === '/api/admin/release/stage' && s.method !== 'GET').length === n0);
  const sOk = await api('PUT', '/api/account-admin/console/release/stage', good, H(T.owner));
  const up = lastTo('/api/admin/release/stage');
  check('مالک ⇒ PUT بالادست با فقط tag/version/percent/reason', sOk.status === 200 && up.method === 'PUT'
    && JSON.stringify(Object.keys(up.body).sort()) === JSON.stringify(['percent', 'reason', 'tag', 'version']), JSON.stringify(up?.body));
  check('⛔ رمزِ پنل هرگز به سرورِ حساب نمی‌رود', !JSON.stringify(seen).includes('Ops-1405-owner'));
  const sEnd = await api('POST', '/api/account-admin/console/release/stage/end', { tag: 'tohid-native', reason: 'پایانِ مرحله', confirm: true, password: 'Ops-1405-owner' }, H(T.owner));
  const upEnd = lastTo('/api/admin/release/stage');
  check('پایانِ مرحله ⇒ DELETE بالادست با tag و دلیل', sEnd.status === 200 && upEnd.method === 'DELETE' && upEnd.query.tag === 'tohid-native' && upEnd.query.reason === 'پایانِ مرحله', JSON.stringify(upEnd));
  const stAudit = await api('GET', '/api/control/audit?q=account.release_stage&limit=20&offset=0', undefined, H(T.owner));
  const acts = (stAudit.json?.rows || []).map((r) => r.action);
  check('دفترِ پنل: set، ended، denied و reauth_failed ِ همین کار', ['account.release_stage.set', 'account.release_stage.ended', 'account.release_stage.denied', 'account.release_stage.reauth_failed'].every((a) => acts.includes(a)), acts.join(' '));

  console.log('\n── پورتِ عمومی ──');
  for (const p of ['/api/account-admin/console/ops/health', '/api/account-admin/console/ops/incidents.csv', '/api/account-admin/console/release/stage']) {
    const r = await api('GET', p, undefined, H(T.owner), `http://127.0.0.1:${PUBLIC}`);
    check(`پورتِ عمومی ${p} ⇒ ۴۰۴`, r.status === 404, `${r.status}`);
  }
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  server.kill('SIGTERM');
}

/* ───────────── هشدار به رباتِ مالک — همان ماژول، درونِ همین پروسه ───────────── */
console.log('\n── رباتِ مالک: فقط نوعِ برگزیده، یک بار، سقف، و پیامِ نرفته دوباره ──');
try {
  process.env.HLP_DATA_DIR = path.join(tmp, 'unit');
  process.env.HLP_ACCOUNT_API = FAKE_URL;
  process.env.HLP_ACCOUNT_ADMIN_USER = 'boss';
  process.env.HLP_ACCOUNT_ADMIN_PASSWORD = 'top-secret';
  const m = await import('../src/support/telegram-console-alerts.js');
  const sent = [];
  let failNext = false;
  const send = async (text) => { if (failNext) { failNext = false; throw new Error('telegram 502'); } sent.push(text); };
  check('بی انتخاب ⇒ هیچ (حتی پرسش)', (await m.deliverConsoleAlerts(send)) === null && sent.length === 0);
  const t0 = Date.now();
  alertsFeed = [{ id: 'alr_old', rule: 'service_down', severity: 'critical', title: 'کهنه', liveSince: t0 - 60_000 }];
  m.setConsoleAlertPrefs(['service_down', 'payment_failed']);
  await new Promise((r) => setTimeout(r, 5));
  await m.deliverConsoleAlerts(send);
  check('روشن کردن از «حالا»: هشدارِ زندهٔ کهنه سرازیر نمی‌شود', sent.length === 0, sent.join(' | '));
  const t1 = Date.now();
  alertsFeed = [
    ...Array.from({ length: 7 }, (_, i) => ({ id: `alr_s${i}`, rule: 'service_down', severity: 'critical', title: `سرویس ${i} — token abc`, liveSince: t1 + i })),
    { id: 'alr_x', rule: 'order_stuck', severity: 'medium', title: 'برگزیده نیست', liveSince: t1 + 1 },
  ];
  const r1 = await m.deliverConsoleAlerts(send);
  check(`سقف: ${m.MAX_PER_RUN} پیام + یک پیامِ جمعی («و ۲ هشدارِ دیگر»)`, r1?.sent === m.MAX_PER_RUN && sent.length === m.MAX_PER_RUN + 1 && /و 2 هشدارِ دیگر/.test(sent.at(-1)), JSON.stringify(r1) + sent.join(' | '));
  check('نوعِ برگزیده‌نشده نرفت', !sent.some((s) => s.includes('برگزیده نیست')));
  check('پیام: نوع و اهمیت به فارسی، بی هیچ رازی', sent[0].includes('سرویسِ از کار افتاده') && sent[0].includes('بحرانی') && !sent.join('').includes('top-secret'));
  const n1 = sent.length;
  await m.deliverConsoleAlerts(send);
  check('دورِ بعد: همان هشدارها دوباره نمی‌روند', sent.length === n1, sent.slice(n1).join(' | '));
  const t2 = Date.now() + 10;
  alertsFeed.push({ id: 'alr_pay', rule: 'payment_failed', severity: 'high', title: 'پرداختِ ناموفق', liveSince: t2 });
  failNext = true;
  await m.deliverConsoleAlerts(send);
  check('تلگرام شکست خورد ⇒ «رفته» ثبت نمی‌شود', !sent.some((s) => s.includes('پرداختِ ناموفق')));
  await m.deliverConsoleAlerts(send);
  check('دورِ بعد همان پیام می‌رود — یک بار', sent.filter((s) => s.includes('پرداختِ ناموفق')).length === 1, sent.join(' | '));
  //  همان هشدار با همان liveSince (تکرار/چشمک در سرورِ حساب) ⇒ دوباره نه
  await m.deliverConsoleAlerts(send);
  check('تکرارِ همان هشدار (همان liveSince) پیامِ دوم نمی‌سازد', sent.filter((s) => s.includes('پرداختِ ناموفق')).length === 1);
} catch (e) {
  check('خطای غیرمنتظره (ربات)', false, e.stack || e.message);
} finally {
  fake.close();
  await new Promise((r) => setTimeout(r, 400));
  await fsp.rm(tmp, { recursive: true, force: true });
}

if (fail) console.log('\n' + out.slice(-1500));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
