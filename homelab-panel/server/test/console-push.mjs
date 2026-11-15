// ---------------------------------------------------------------------------
//  «اعلانِ گوشی (Firebase)» و «پنلِ مدیرِ سرور»، ۱.۵۱.۲ — روی پنلِ واقعی با سرورِ حسابِ ساختگیِ حالت‌دار
//      node test/console-push.mjs
//
//   ۰) قاعده‌های خالص: سنجشِ کلید (سرور ⇄ وب، یک قاعده)، فهرستِ سفیدِ پاسخ، نشانیِ ‎/admin/‎ از تنظیم (بی دامنهٔ نوشته‌شده)،
//      دسته‌بندیِ «باز می‌شود؟» (DNS، گواهی، تونل، مسیر، فقط ‎/api‎، …) — و همان دسته‌بندی روی پاسخ‌های واقعیِ HTTP
//   ۱) فهرستِ سفید: فقط ‎GET|PUT /console/push‎؛ درِ کهنهٔ ‎PUT /api/account-admin/push‎ نیست؛ فقط ‎enabled‎ و ‎serviceAccount‎ می‌رود
//   ۲) نقش و «حالتِ تغییر»: operator/viewer ۴۰۳؛ بی رمز ۴۰۳؛ رمزِ غلط ۴۰۳؛ رمزِ درست ⇒ پنجره؛ در پنجره بی رمز
//   ۳) بدنه: کلیدِ بد پیش از احراز و پیش از سرورِ حساب رد می‌شود؛ بیش از ۶۴ کیلوبایت ⇒ ۴۱۳
//   ۴) ⛔ کلید هیچ‌جا نمی‌ماند: نه لاگ و خروجیِ پنل، نه هیچ پرونده‌ای زیرِ پوشهٔ داده (دفتر، WAL)، نه پاسخی از پنل
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PANEL = Number(process.env.TEST_PORT || 4991);
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-push-'));
process.env.HLP_DATA_DIR = path.join(tmp, 'unit');

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 1200)}`);
};

/** کلیدِ ساختگی، همین لحظه — ⛔ هیچ چیزِ شبیهِ رازِ واقعی در سورس نیست (بی سرآیندِ PEM) */
const MARK = `pkmark${crypto.randomBytes(12).toString('hex')}`;
const fakeKey = (over = {}) => JSON.stringify({
  type: 'service_account', project_id: 'demo-push-test', private_key_id: crypto.randomBytes(8).toString('hex'),
  private_key: `TEST-ONLY-NOT-A-KEY-${MARK}-${crypto.randomBytes(16).toString('hex')}`,
  client_email: 'push-probe@demo-push-test.example', client_id: '0', ...over,
});

/* ── ۰) قاعده‌های خالص ── */
console.log('\n── ۰) قاعده‌های خالص ──');
const push = await import('../src/modules/shop/routes/console-push.js');
const web = await import(new URL('file://' + path.join(here, '..', '..', 'web', 'src', 'modules', 'shop', 'consoleData.ts')).href);
const aw = await import('../src/account/admin-web.js');

const cases = [
  ['', 'sa_empty'], ['   ', 'sa_empty'], ['not json', 'sa_not_json'], ['{"type":"service_account"', 'sa_not_json'],
  ['[]', 'sa_not_key'], ['null', 'sa_not_key'], ['{"type":"authorized_user"}', 'sa_not_key'],
  [JSON.stringify({ project_info: { project_id: 'demo-push-test' }, client: [{}] }), 'sa_app_config'],
  [fakeKey({ private_key: '' }), 'sa_incomplete'], [fakeKey({ client_email: 'nobody' }), 'sa_incomplete'],
  [fakeKey({ project_id: undefined }), 'sa_incomplete'], [fakeKey({ project_id: 'X_bad' }), 'sa_bad_project'],
  [fakeKey(), null], ['x'.repeat(push.PUSH_SA_MAX + 1), 'sa_too_large'],
];
const mism = cases.filter(([t, want]) => push.checkServiceAccount(t) !== want || web.serviceAccountProblem(t) !== want);
check(`سنجشِ کلید: ${cases.length} نمونه، سرور و وب یک جواب (JSON، type، project_id، client_email، private_key)`, mism.length === 0,
  mism.map(([t, w]) => `${String(t).slice(0, 30)} ⇒ ${push.checkServiceAccount(t)}/${web.serviceAccountProblem(t)} ≠ ${w}`).join(' · '));
check('سقفِ متن یکی است (سرور ⇄ وب)', push.PUSH_SA_MAX === web.PUSH_SA_MAX);
check('پیامِ «این فایلِ کلید نیست…» برای فایلِ اشتباه', /این فایلِ کلید نیست؛ فایلی را بزنید که از Service accounts ← Generate new private key گرفتید/.test(push.SA_MESSAGES.sa_not_key)
  && Object.values(push.SA_MESSAGES).every((m) => !m.includes(MARK)));
check('خلاصهٔ وب فقط پروژه و حساب — هرگز private_key', JSON.stringify(web.serviceAccountSummary(fakeKey())) === JSON.stringify({ project: 'demo-push-test', account: 'push-probe@demo-push-test.example' })
  && web.serviceAccountSummary('nope') === null);
const view = push.pushView({ push: { enabled: true, configured: true, source: 'panel', project: 'p1', account: 'a@b.c', devices: 4, serviceAccount: MARK, private_key: MARK, apns: { configured: false, env: '', reason: 'off', key: MARK } } });
check('⛔ فهرستِ سفیدِ پاسخ: کلید (اگر روزی سرورِ حساب برگرداند) به رابط نمی‌رسد', !JSON.stringify(view).includes(MARK) && view.devices === 4 && view.enabled === true, JSON.stringify(view));
check('پاسخِ ناقص ⇒ «—» نه صفر (devices: null)', push.pushView({ push: { enabled: false } }).devices === null);

const t1 = aw.adminWebTarget([{ hostname: 'API.Shop-One.test', primary: true, auto: true }, { hostname: 'alias.shop-one.test', primary: false }, { hostname: 'bad host!' }]);
check('نشانیِ ‎/admin/‎ از نامِ اصلیِ سرورِ حساب (کوچک، https)، نام‌های دیگر جدا', t1.url === 'https://api.shop-one.test/admin/' && t1.others.length === 1 && t1.others[0] === 'https://alias.shop-one.test/admin/', JSON.stringify(t1));
check('صریح جلوتر از خودکار', aw.adminWebTarget([{ hostname: 'api.a.test', auto: true }, { hostname: 'pay.a.test', primary: true }]).host === 'pay.a.test');
check('⛔ بی نام ⇒ بی نشانی (هیچ دامنهٔ پیش‌فرضِ نوشته‌شده)', aw.adminWebTarget([]).url === null && aw.adminWebTarget(null).url === null);
const awSrc = fs.readFileSync(path.join(here, '..', 'src', 'account', 'admin-web.js'), 'utf8');
check('⛔ در سورسِ «پنلِ مدیرِ سرور» هیچ دامنه‌ای نوشته نشده', !/vill3n|https:\/\/api\.|\.top['"`]|CLOUD_BASE/.test(awSrc));

const T = { url: 'https://api.x.test/admin/', host: 'api.x.test' };
const named = { tunnelMode: 'named', tunnelRunning: true, inTunnel: true, dnsRouted: true, gateway: true, accountManaged: true, accountRunning: true };
const C = (local, probe) => aw.classifyAdminWeb(T, local, probe).code;
const table = [
  ['بی دامنه', aw.classifyAdminWeb({ url: null }, named, null).code, 'no_domain'],
  ['۲۰۰ html', C(named, { ok: true, status: 200, type: 'text/html; charset=utf-8', body: '<html>' }), 'ok'],
  ['DNS', C(named, { ok: false, error: 'dns' }), 'dns'],
  ['گواهی', C(named, { ok: false, error: 'tls' }), 'tls'],
  ['مهلت', C(named, { ok: false, error: 'timeout' }), 'timeout'],
  ['رد', C(named, { ok: false, error: 'refused' }), 'refused'],
  ['۵۳۰ / ۱۰۳۳', C(named, { ok: true, status: 530, body: 'error code: 1033' }), 'tunnel_down'],
  ['۵۰۳ سرورِ حسابِ خاموش', C(named, { ok: true, status: 503, body: '{"error":{"code":"account_server_down"}}', cfRay: true }), 'account_down'],
  ['۵۰۲ از Cloudflare', C(named, { ok: true, status: 502, cfRay: true, body: '' }), 'origin_down'],
  ['۴۰۴ + درِ خاموش', C({ ...named, gateway: false }, { ok: true, status: 404, body: '' }), 'gateway_off'],
  ['۴۰۴ + نام در تونل نیست', C({ ...named, inTunnel: false }, { ok: true, status: 404, body: '' }), 'route_missing'],
  ['۴۰۴ روی ‎/admin/‎ ولی ‎/api/health‎ ۲۰۰ ⇒ فقط ‎/api‎', C(named, { ok: true, status: 404, body: '', health: { status: 200, json: true } }), 'admin_not_forwarded'],
  ['۴۰۴ + تونلِ توکنی (مسیر در داشبورد)', C({ ...named, tunnelMode: 'token' }, { ok: true, status: 404, body: '', health: { status: 404 } }), 'route_missing'],
  ['۴۰۴ + تونلِ سریع', C({ ...named, tunnelMode: 'quick' }, { ok: true, status: 404, body: '', health: { status: 404 } }), 'tunnel_quick'],
  ['Cloudflare Access', C(named, { ok: true, status: 302, location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login' }), 'access'],
  ['۴۰۳', C(named, { ok: true, status: 403, cfRay: true, body: '' }), 'blocked'],
  ['۲۰۰ غیرِ html', C(named, { ok: true, status: 200, type: 'application/json', body: '{}' }), 'wrong_app'],
];
const badRows = table.filter(([, got, want]) => got !== want);
check(`دسته‌بندیِ «باز می‌شود؟»: ${table.length} حالت`, badRows.length === 0, badRows.map(([n, g, w]) => `${n}: ${g} ≠ ${w}`).join(' · '));
const hinted = aw.classifyAdminWeb(T, { tunnelMode: 'named', tunnelRunning: false, inTunnel: true, dnsRouted: false, gateway: true, accountManaged: true, accountRunning: false }, { ok: false, error: 'dns' });
check('اشاره‌های «روی این کامپیوتر»: تونلِ خاموش، DNS ِ ساخته‌نشده، سرورِ حسابِ خاموش', ['tunnel_stopped', 'dns_not_routed', 'account_stopped'].every((h) => hinted.hints.includes(h)), JSON.stringify(hinted));
check('خطای شبکه ⇒ نوع', aw.networkKind({ name: 'TimeoutError' }) === 'timeout' && aw.networkKind({ cause: { code: 'ENOTFOUND' } }) === 'dns'
  && aw.networkKind({ cause: { code: 'CERT_HAS_EXPIRED' } }) === 'tls' && aw.networkKind({ cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } }) === 'tls'
  && aw.networkKind({ cause: { code: 'ECONNREFUSED' } }) === 'refused' && aw.networkKind({ cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }) === 'timeout');
check('وب برای هر دلیلِ درست‌شدنی راهِ همین پنل را دارد', ['no_domain', 'dns', 'route_missing', 'admin_not_forwarded', 'tunnel_down'].every((c) => web.adminWebFixPath(c) === '/domains?tab=tunnel')
  && web.adminWebFixPath('tls') === '/domains?tab=cloudflare' && web.adminWebFixPath('account_down') === '/account-server?tab=status' && web.adminWebFixPath('ok') === null);

//  همان دسته‌بندی روی پاسخ‌های واقعیِ HTTP (سرورِ محلی که رفتارِ Cloudflare/تونل را می‌سازد)
const modes = new Map();
const edge = http.createServer((req, res) => {
  const [mode] = String(req.url).split('/').filter(Boolean);
  const rest = String(req.url).slice(mode.length + 1);
  const m = modes.get(mode);
  if (m === 'ok') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end('<!doctype html><title>admin</title>'); }
  if (m === 'tunnel') { res.statusCode = 530; res.setHeader('cf-ray', '1-x'); return res.end('error code: 1033'); }
  if (m === 'apionly') {
    if (rest.startsWith('/api/health')) { res.setHeader('content-type', 'application/json'); return res.end('{"ok":true}'); }
    res.statusCode = 404; return res.end();
  }
  if (m === 'access') { res.statusCode = 302; res.setHeader('location', 'https://team.cloudflareaccess.com/cdn-cgi/access/login/x'); return res.end(); }
  if (m === 'down') { res.statusCode = 503; res.setHeader('content-type', 'application/json'); return res.end('{"error":{"code":"account_server_down","message":"x"}}'); }
  res.statusCode = 500; return res.end();
});
await new Promise((r) => edge.listen(0, '127.0.0.1', r));
const E = `http://127.0.0.1:${edge.address().port}`;
//  ‎/api/health‎ ِ همان «نام» = همان سرورِ محلی با پیشوندِ حالت (‎new URL('/api/health', …)‎ ریشه را می‌گیرد) ⇒ کاوش با fetchImpl
const viaMode = (mode) => (u, o) => fetch(u.replace(E + '/', `${E}/${mode}/`).replace(`${E}/${mode}/${mode}/`, `${E}/${mode}/`), o);
for (const [mode, want] of [['ok', 'ok'], ['tunnel', 'tunnel_down'], ['apionly', 'admin_not_forwarded'], ['access', 'access'], ['down', 'account_down']]) {
  modes.set(mode, mode);
  const p = await aw.probeAdminWeb(`${E}/${mode}/admin/`, { timeoutMs: 3000, fetchImpl: viaMode(mode) });
  check(`پاسخِ واقعی «${mode}» ⇒ ${want}`, aw.classifyAdminWeb(T, named, p).code === want, JSON.stringify({ ...p, body: String(p.body || '').slice(0, 60) }));
}
const dead = await aw.probeAdminWeb('http://127.0.0.1:1/admin/', { timeoutMs: 2000 }).catch((e) => ({ ok: false, error: String(e) }));
check('کاوش هرگز پرتاب نمی‌کند (نشانیِ مرده ⇒ نتیجهٔ «نشد»)', dead.ok === false, JSON.stringify(dead));
edge.close();

/* ── ۱) سرورِ حسابِ ساختگیِ حالت‌دار ── */
const NOW = Date.now();
const state = { enabled: false, configured: false, project: '', account: '', sa: '' };
const seen = [];
let upstreamMode = 'normal';
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const raw = Buffer.concat(chunks).toString();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, server: 'online' });
    const M = `${req.method} ${p}`;
    if (M === 'POST /api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (M === 'GET /api/admin/me') return j(200, { admin: { id: 'adm', username: 'boss', role: 'superadmin' }, capabilities: ['flags.v1'], serverTime: NOW });
    seen.push({ method: req.method, path: p, body });
    const masked = () => ({ push: { enabled: state.enabled, configured: state.configured, source: state.configured ? 'panel' : '', project: state.project, account: state.account,
      devices: 3, apns: { configured: false, env: '', reason: 'off' },
      //  ⛔ سرورِ حسابِ «بدرفتار»: کلید را هم برمی‌گرداند — پنل نباید رد کند
      serviceAccount: state.sa } });
    if (M === 'GET /api/admin/push') return j(200, masked());
    if (M === 'PUT /api/admin/push') {
      if (upstreamMode === 'reject') return j(400, { error: { code: 'bad_service_account', message: 'فایل حساب سرویس ناقص است: client_email، private_key و project_id لازم است' } });
      //  سرورِ حسابِ «پرحرف» که تکه‌ای از بدنه را در پیامِ خطا می‌گذارد
      if (upstreamMode === 'leaky') return j(400, { error: { code: 'bad_service_account', message: `نشد: ${String(body?.serviceAccount || '').slice(0, 400)}` } });
      if (typeof body?.enabled === 'boolean') state.enabled = body.enabled;
      if (typeof body?.serviceAccount === 'string') {
        const sa = JSON.parse(body.serviceAccount);
        Object.assign(state, { configured: true, project: sa.project_id, account: sa.client_email, sa: body.serviceAccount });
      }
      return j(200, masked());
    }
    return j(404, { error: { code: 'not_found', message: 'نیست' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

/* ── ۲) پنلِ واقعی ── */
const DATA = path.join(tmp, 'data');
const env = { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: DATA, HLP_SITES_ROOT: path.join(tmp, 'sites'),
  HLP_SITESYNC: '0', HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_AUTOMATION: '0', HLP_STATIONS: '0', HLP_ACCOUNT_AUTOSTART: '0',
  HLP_ACCOUNT_API: `http://127.0.0.1:${fake.address().port}`, HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret',
  HLP_AUTH_RATE_LIMIT: '100000', HLP_RATE_API: '100000', HLP_DOMAIN: 'push-check.invalid' };
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], { cwd: path.join(here, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const { DatabaseSync } = await import('node:sqlite');
const sql = (q, ...args) => {
  const d = new DatabaseSync(path.join(DATA, 'panel.db'));
  try { d.exec('PRAGMA busy_timeout = 5000'); const st = d.prepare(q); return /^\s*select/i.test(q) ? st.all(...args) : st.run(...args); } finally { d.close(); }
};
const stale = () => sql('UPDATE sessions SET auth_at = 0, sudo_at = NULL, sudo_seen = NULL');
const BASE = `http://127.0.0.1:${PANEL}`;
const replies = [];
async function api(method, p, body, token, rawBody) {
  const res = await fetch(BASE + p, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  replies.push(text);
  let json = null;
  try { json = JSON.parse(text); } catch { /* غیرِ JSON */ }
  return { status: res.status, json, text };
}
const PW = 'Push-1405-owner';
const putsSince = (n) => seen.slice(n).filter((c) => c.method === 'PUT' && c.path === '/api/admin/push');

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await api('POST', '/api/auth/setup', { username: 'owner', password: PW });
  const login = async (u, p) => (await api('POST', '/api/auth/login', { username: u, password: p })).json?.token;
  const owner = await login('owner', PW);
  for (const [u, role] of [['op1', 'operator'], ['view1', 'viewer']]) await api('POST', '/api/auth/users', { username: u, password: `Push-${role}-1405`, role }, owner);
  const op = await login('op1', 'Push-operator-1405');
  const viewer = await login('view1', 'Push-viewer-1405');
  check('سه نشست', Boolean(owner && op && viewer));

  console.log('\n── ۱) فهرستِ سفید ──');
  const g = await api('GET', '/api/account-admin/console/push', undefined, viewer);
  check('خواندنِ حال برای هر نقشِ «تنظیمات» (viewer هم)', g.status === 200 && g.json?.push?.devices === 3 && g.json.push.configured === false, g.text);
  const old = await api('PUT', '/api/account-admin/push', { enabled: true, serviceAccount: fakeKey() }, owner);
  check('⛔ درِ کهنهٔ بی‌نگهبان (‎PUT /api/account-admin/push‎) دیگر نیست', old.status === 404 && putsSince(0).length === 0, `${old.status}`);
  const oldGet = await api('GET', '/api/account-admin/push', undefined, owner);
  check('خواندنِ کهنه (صفحهٔ «پیامک و پوش») سرِ جایش', oldGet.status === 200);

  console.log('\n── ۲) نقش و «حالتِ تغییر» ──');
  stale();
  let n = seen.length;
  for (const [who, tok] of [['operator', op], ['viewer', viewer]]) {
    const r = await api('PUT', '/api/account-admin/console/push', { enabled: true, serviceAccount: fakeKey(), password: `Push-${who}-1405` }, tok);
    check(`⛔ ${who} ⇒ ۴۰۳ و هیچ درخواستی به سرورِ حساب`, r.status === 403 && putsSince(n).length === 0, `${r.status} ${r.text}`);
  }
  const noPw = await api('PUT', '/api/account-admin/console/push', { enabled: true, serviceAccount: fakeKey() }, owner);
  check('⛔ بی رمز و بی پنجره ⇒ ‎403 reauth_required‎، بی نوشتن', noPw.status === 403 && noPw.json?.error === 'reauth_required' && putsSince(n).length === 0, noPw.text);
  const wrong = await api('PUT', '/api/account-admin/console/push', { enabled: true, serviceAccount: fakeKey(), password: 'not-the-password' }, owner);
  check('⛔ رمزِ غلط ⇒ ‎403 reauth_failed‎، بی نوشتن', wrong.status === 403 && wrong.json?.error === 'reauth_failed' && putsSince(n).length === 0, wrong.text);

  console.log('\n── ۳) بدنه ──');
  for (const [name, sa, problem] of [['متنِ نیمه', '{"type":"service_account",', 'sa_not_json'], ['google-services.json', JSON.stringify({ project_info: {}, client: [] }), 'sa_app_config'],
    ['بی private_key', fakeKey({ private_key: '' }), 'sa_incomplete']]) {
    const r = await api('PUT', '/api/account-admin/console/push', { enabled: true, serviceAccount: sa, password: PW }, owner);
    check(`کلیدِ بد (${name}) ⇒ ۴۰۰ با پیامِ فارسی، پیش از احراز و سرورِ حساب`, r.status === 400 && r.json?.problem === problem && /[آ-ی]/.test(r.json?.message || '') && putsSince(n).length === 0, r.text);
  }
  const notBool = await api('PUT', '/api/account-admin/console/push', { enabled: 'yes' }, owner);
  check('«روشن» فقط بله/نه', notBool.status === 400 && notBool.json?.error === 'bad_enabled');
  const nothing = await api('PUT', '/api/account-admin/console/push', { clearServiceAccount: true, password: PW }, owner);
  check('⛔ ‎clearServiceAccount‎ از این در نمی‌رود (چیزی برای ذخیره نیست)', nothing.status === 400 && nothing.json?.error === 'nothing_to_change' && putsSince(n).length === 0, nothing.text);
  const auditBefore = sql("SELECT COUNT(*) n FROM cc_audit WHERE action = 'account.console.reauth_failed'")[0].n;
  check('بدنهٔ بد رمز را نمی‌سنجد (ردیفِ «رمزِ غلط» ِ تازه‌ای نیست جز همان یکی)', auditBefore === 1, String(auditBefore));
  const big = JSON.stringify({ enabled: true, serviceAccount: fakeKey({ pad: 'z'.repeat(70 * 1024) }), password: PW });
  const tooBig = await api('PUT', '/api/account-admin/console/push', undefined, owner, big);
  check('⛔ بیش از ۶۴ کیلوبایت ⇒ ‎413 payload_too_large‎، بی نوشتن', tooBig.status === 413 && tooBig.json?.error === 'payload_too_large' && putsSince(n).length === 0, `${tooBig.status} ${tooBig.text}`);
  const tooBigSlash = await api('PUT', '/api/account-admin/CONSOLE/push/', undefined, owner, big);
  check('سقف با «/» ِ آخر یا حروفِ بزرگ هم دور زده نمی‌شود', tooBigSlash.status === 413, String(tooBigSlash.status));
  const keyMissing = await api('PUT', '/api/account-admin/console/push', { enabled: true, password: PW }, owner);
  check('«روشن» بی کلید (هنوز کلیدی نیست) ⇒ ‎400 push_key_missing‎، بی نوشتن', keyMissing.status === 400 && keyMissing.json?.error === 'push_key_missing' && putsSince(n).length === 0, keyMissing.text);
  stale();

  upstreamMode = 'reject';
  const rej = await api('PUT', '/api/account-admin/console/push', { enabled: true, serviceAccount: fakeKey(), password: PW }, owner);
  check('ردِ سرورِ حساب ⇒ همان کد و پیامِ فارسی‌اش', rej.status === 400 && rej.json?.error === 'bad_service_account' && /ناقص/.test(rej.json?.message || ''), rej.text);
  upstreamMode = 'leaky';
  const leak = await api('PUT', '/api/account-admin/console/push', { enabled: true, serviceAccount: fakeKey(), password: PW }, owner);
  check('⛔ سرورِ حسابِ پرحرف: تکهٔ کلید در پیامِ خطا به رابط نمی‌رسد', leak.status === 400 && !leak.text.includes(MARK) && /نپذیرفت/.test(leak.json?.message || ''), leak.text.slice(0, 200));
  upstreamMode = 'normal';
  stale();

  console.log('\n── ۴) ذخیره ──');
  n = seen.length;
  const key = fakeKey();
  const ok1 = await api('PUT', '/api/account-admin/console/push', { enabled: true, serviceAccount: `  ${key}\n`, password: PW, code: '', clearServiceAccount: true, extra: 'x' }, owner);
  const sent = putsSince(n);
  check('رمزِ درست ⇒ ذخیره، «تأییدشده از سرورِ حساب»', ok1.status === 200 && ok1.json?.ok === true && ok1.json.confirmedByServer === true && ok1.json.push?.enabled === true && ok1.json.push.project === 'demo-push-test', ok1.text);
  check('⛔ به سرورِ حساب فقط ‎enabled‎ و ‎serviceAccount‎ (بریده) — نه رمز، نه ‎clearServiceAccount‎، نه چیزِ دیگر',
    sent.length === 1 && JSON.stringify(Object.keys(sent[0].body).sort()) === '["enabled","serviceAccount"]' && sent[0].body.serviceAccount === key, JSON.stringify(sent.map((s) => Object.keys(s.body || {}))));
  check('⛔ پاسخِ ذخیره کلید را برنمی‌گرداند (با این‌که سرورِ حسابِ ساختگی برمی‌گرداند)', !ok1.text.includes(MARK) && !('serviceAccount' in (ok1.json?.push || {})));
  check('رمزِ درست «حالتِ تغییر» را باز کرد', ok1.json?.sudo?.open === true, JSON.stringify(ok1.json?.sudo));
  n = seen.length;
  const off = await api('PUT', '/api/account-admin/console/push', { enabled: false }, owner);
  check('در پنجرهٔ باز بی رمز: خاموش', off.status === 200 && off.json?.push?.enabled === false && putsSince(n).length === 1 && JSON.stringify(putsSince(n)[0].body) === '{"enabled":false}', off.text);
  const onAgain = await api('PUT', '/api/account-admin/console/push', { enabled: true }, owner);
  check('کلید هست ⇒ «روشن» بی متنِ تازه هم', onAgain.status === 200 && onAgain.json?.push?.enabled === true, onAgain.text);
  const g2 = await api('GET', '/api/account-admin/console/push', undefined, owner);
  check('⛔ خواندنِ حال: کلید نیست (فهرستِ سفید)، حال هست', g2.status === 200 && g2.json?.push?.configured === true && !g2.text.includes(MARK), g2.text.slice(0, 200));

  const rows = sql("SELECT action, detail FROM cc_audit WHERE action = 'account.push.update' ORDER BY id");
  const d0 = JSON.parse(rows[0]?.detail || '{}');
  check('دفتر: یک ردیف برای هر ذخیره — «کلید عوض شد» و پروژه، بی خودِ کلید', rows.length === 3 && d0.keyChanged === true && d0.project === 'demo-push-test' && rows.every((r) => !String(r.detail).includes(MARK)), JSON.stringify(rows));
  check('دفتر: ذخیره در پنجره نشانِ ‎viaSudo‎ دارد', JSON.parse(rows[1]?.detail || '{}').viaSudo === true);

  console.log('\n── ۵) «پنلِ مدیرِ سرور» ──');
  const info = await api('GET', '/api/account-server/admin-web', undefined, viewer);
  check('نشانی از تنظیمِ همین پنل (HLP_DOMAIN ⇒ api.<دامنه>/admin/)', info.status === 200 && info.json?.url === 'https://api.push-check.invalid/admin/', info.text);
  check('نامِ کاربری هست، رمز نه (همان قاعدهٔ ‎/status‎)', info.json?.admin?.username === 'boss' && info.json.admin.passwordSet === true && !info.text.includes('top-secret'), info.text);
  const t0 = Date.now();
  const c1 = await api('GET', '/api/account-server/admin-web/check', undefined, owner);
  check('«باز می‌شود؟» ⇒ دلیلِ روشن (نامِ ناموجود ⇒ DNS) و زود', c1.status === 200 && ['dns', 'network', 'timeout'].includes(c1.json?.code) && Date.now() - t0 < 9000, c1.text);
  check('اشاره‌های همین کامپیوتر (تونل در این آزمون خاموش/سریع)', Array.isArray(c1.json?.hints) && c1.json.hints.length > 0 && typeof c1.json.local?.gateway === 'boolean', JSON.stringify(c1.json?.hints));
  const c2 = await api('GET', '/api/account-server/admin-web/check', undefined, owner);
  check('نتیجه نگه داشته می‌شود (بی کاوشِ دوباره)', c2.json?.checkedAt === c1.json?.checkedAt);
  const c3 = await api('GET', '/api/account-server/admin-web/check?fresh=1', undefined, owner);
  check('«دوباره بسنج» زودتر از ۵ ثانیه ⇒ همان نتیجه (نه بارانِ کاوش)', c3.json?.checkedAt === c1.json?.checkedAt);
  const anon = await fetch(`${BASE}/api/account-server/admin-web/check`);
  check('بی ورود ⇒ ۴۰۱', anon.status === 401);

  console.log('\n── ۶) ⛔ کلید هیچ‌جا نماند ──');
  await new Promise((r) => setTimeout(r, 300));
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else files.push(f); } };
  walk(DATA);
  const hit = files.filter((f) => { try { return fs.readFileSync(f).includes(MARK); } catch { return false; } });
  check(`هیچ پرونده‌ای زیرِ پوشهٔ دادهٔ پنل (${files.length} پرونده: پایگاه، WAL، لاگ) نشانِ کلید را ندارد`, files.length > 0 && hit.length === 0, hit.join(' · '));
  check('خروجی و لاگِ پروسهٔ پنل نشانِ کلید را ندارد', !out.includes(MARK) && !out.includes('TEST-ONLY-NOT-A-KEY'), out.slice(-300));
  const logs = await api('GET', '/api/logs?limit=500', undefined, owner);
  check('دفترِ رخدادهای پنل (‎/api/logs‎) نشانِ کلید را ندارد', !logs.text.includes(MARK), String(logs.status));
  check(`هیچ پاسخی از پنل (${replies.length}) نشانِ کلید را ندارد`, replies.every((t) => !t.includes(MARK)));
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
