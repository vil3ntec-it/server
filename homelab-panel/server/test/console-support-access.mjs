// ---------------------------------------------------------------------------
//  ۲-۹ (G1، ACP-D1 الف و ACP-D2 الف) در پل — اجازهٔ موقتِ دسترسیِ پشتیبانی به دادهٔ یک دکان (۱.۵۰.۹۰)
//      node test/console-support-access.mjs
//
//  سرورِ حسابِ ساختگی به شکلِ قراردادِ `routes/console-support-access.js` (‎support-access.v1‎). سنجیده می‌شود:
//    • بی توانایی ⇒ «در دسترس نیست» و هر نوشتن ‎501‎ بی درخواست
//    • ACP-D1: مدت پیش‌فرض ۶۰، ۵ تا ۱۴۴۰ دقیقه؛ بیش از ۲۴ ساعت ⇒ ‎400 bad_minutes‎ (نه بریدنِ بی‌صدا)؛ دامنهٔ شناخته
//    • درخواست (رضایتِ دکان): admin + دلیل + تأیید + کلید ⇒ ‎consent: tenant‎؛ operator/viewer ۴۰۳ بی درخواست
//    • ACP-D2 «شکستنِ شیشه»: فقط مالکِ پنل (مدیرِ دوم ۴۰۳ owner_only، پیش از رمز)، رمزِ دوباره (بی رمز/رمزِ غلط ⇒ ۴۰۳)،
//      دلیلِ ۱۰ تا ۳۰۰، ‎consent: break_glass‎ و ‎notify_owner: true‎ به سرورِ حساب، و ‎notified‎ همان که آن‌جا گفت
//    • لغو: admin + دلیل؛ کلیدِ یکتایی ⇒ یک بار؛ پاسخ فقط فیلدهای شناخته؛ ردیف‌های دفترِ پنل
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PANEL = Number(process.env.TEST_PORT || 4967);
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'support-access-'));
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 400)}`);
};

const NOW = Date.now();
let caps = ['actor.v1'];
let notifyOk = true;
const seen = [];
const grants = [{ id: 'gr_old', scope: 'read_private', consent: 'tenant', status: 'expired', reason: 'تیکتِ ۱۲', requested_by: 'boss', granted_by: 'owner-of-shop',
  starts_at: NOW - 7200e3, expires_at: NOW - 3600e3, uses: 3, token: 'SECRET-TOKEN', password: 'x' }];
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const p = new URL(req.url, 'http://x').pathname;
    let body = null;
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null; } catch { body = null; }
    const j = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, version: '9.9.9' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: caps, serverTime: NOW });
    seen.push({ method: req.method, path: p, body });
    if (!caps.includes('support-access.v1')) return j(401, { error: { code: 'invalid_token', message: 'نشست' } });
    if (p === '/api/admin/shops/s1/access-grants' && req.method === 'GET') return j(200, { grants });
    if (p === '/api/admin/shops/s1/access-grants' && req.method === 'POST') {
      const g = { id: `gr_${seen.length}`, scope: body.scope, consent: 'tenant', status: 'pending', reason: body.reason, requested_by: 'boss', expires_at: null };
      grants.push(g);
      return j(201, { grant: g });
    }
    if (p === '/api/admin/shops/s1/access-grants/break-glass' && req.method === 'POST') {
      const g = { id: `gr_${seen.length}`, scope: body.scope, consent: 'break_glass', status: 'active', reason: body.reason, starts_at: NOW, expires_at: NOW + body.minutes * 60e3, notified_at: notifyOk ? NOW : null };
      grants.push(g);
      return j(201, { grant: g, notified: notifyOk });
    }
    const rv = /^\/api\/admin\/shops\/s1\/access-grants\/([^/]+)\/revoke$/.exec(p);
    if (rv) { const g = grants.find((x) => x.id === rv[1]); if (!g) return j(404, { error: { code: 'grant_not_found', message: 'نیست' } }); g.status = 'revoked'; g.revoked_at = NOW; return j(200, { grant: g }); }
    return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const FAKE_URL = `http://127.0.0.1:${fake.address().port}`;
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
    HLP_SITESYNC: '0', HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_AUTOMATION: '0', HLP_STATIONS: '0',
    HLP_ACCOUNT_API: FAKE_URL, HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret',
    HLP_AUTH_RATE_LIMIT: '100000', HLP_TG_WATCH_MS: '0', HLP_TG_LONGPOLL: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));
const BASE = `http://127.0.0.1:${PANEL}`;
async function api(method, p, body, token) {
  const res = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}
const posts = (re) => seen.filter((s) => s.method === 'POST' && re.test(s.path)).length;
const lastPost = (re) => seen.filter((s) => s.method === 'POST' && re.test(s.path)).at(-1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AG = '/api/account-admin/console/shops/s1/access-grants';

try {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ } await sleep(250); }
  await api('POST', '/api/auth/setup', { username: 'owner', password: 'Acc-1405-owner' });
  const login = async (u, pw) => (await api('POST', '/api/auth/login', { username: u, password: pw })).json?.token;
  const owner = await login('owner', 'Acc-1405-owner');
  for (const [u, role] of [['admin2', 'admin'], ['op1', 'operator'], ['view1', 'viewer']]) await api('POST', '/api/auth/users', { username: u, password: `Acc-${role}-1405`, role }, owner);
  const admin2 = await login('admin2', 'Acc-admin-1405');
  const op = await login('op1', 'Acc-operator-1405');
  const viewer = await login('view1', 'Acc-viewer-1405');
  check('چهار نشست', Boolean(owner && admin2 && op && viewer));
  const R = (over = {}) => ({ reason: 'تیکتِ ۴۵ — صورت‌حساب', confirm: true, idempotencyKey: `acc-${Math.random().toString(36).slice(2, 12)}`, ...over });

  console.log('\n── بی `support-access.v1` ──');
  const old = await api('GET', AG, undefined, viewer);
  check('⛔ خواندن ⇒ ‎available: false‎ با نامِ درِ لازم (نه فهرستِ ساختگی)', old.status === 200 && old.json?.available === false && old.json?.capability === 'support-access.v1', old.text.slice(0, 200));
  const oldW = await api('POST', AG, R(), owner);
  const oldB = await api('POST', `${AG}/break-glass`, R({ reason: 'خرابیِ فوری در همگام‌سازی', password: 'Acc-1405-owner' }), owner);
  check('⛔ درخواست و شکستنِ شیشه ⇒ ‎501 capability_missing‎ و هیچ درخواستی', oldW.status === 501 && oldB.status === 501 && posts(/access-grants/) === 0, `${oldW.status} ${oldB.status}`);

  caps = ['actor.v1', 'support-access.v1'];
  console.log('\n── خواندن ──');
  const rd = await api('GET', AG, undefined, viewer);
  const g0 = rd.json?.grants?.[0];
  check('viewer فهرست را می‌بیند؛ سیاست ۶۰ / ۱۴۴۰ دقیقه', rd.status === 200 && rd.json?.available === true && rd.json.policy?.defaultMinutes === 60 && rd.json.policy.maxMinutes === 1440, rd.text.slice(0, 200));
  check('⛔ پاسخ فقط فیلدهای شناخته — نه توکن، نه رمز', g0?.id === 'gr_old' && g0.status === 'expired' && g0.uses === 3 && !rd.text.includes('SECRET-TOKEN') && !('password' in (g0 || {})), JSON.stringify(g0));

  console.log('\n── درخواست با رضایتِ دکان (ACP-D1) ──');
  const n0 = posts(/access-grants$/);
  const opW = await api('POST', AG, R(), op);
  const vW = await api('POST', AG, R(), viewer);
  check('⛔ operator و viewer درخواست نمی‌دهند (۴۰۳) و هیچ درخواستی بالا نمی‌رود', opW.status === 403 && vW.status === 403 && posts(/access-grants$/) === n0, `${opW.status} ${vW.status}`);
  const long = await api('POST', AG, R({ minutes: 1441 }), owner);
  const short = await api('POST', AG, R({ minutes: 4 }), owner);
  const frac = await api('POST', AG, R({ minutes: 30.5 }), owner);
  const scope = await api('POST', AG, R({ scope: 'everything' }), owner);
  const why = await api('POST', AG, R({ reason: 'ab' }), owner);
  const conf = await api('POST', AG, R({ confirm: false }), owner);
  check('⛔ بیش از ۲۴ ساعت / کمتر از ۵ دقیقه / کسری / دامنهٔ ناشناخته / دلیلِ کوتاه / بی تأیید ⇒ ۴۰۰، پیش از سرورِ حساب',
    long.status === 400 && long.json?.error === 'bad_minutes' && short.status === 400 && frac.status === 400 && scope.json?.error === 'bad_scope' && why.status === 400 && conf.status === 400 && posts(/access-grants$/) === n0,
    [long, short, frac, scope, why, conf].map((r) => `${r.status}:${r.json?.error}`).join(' '));
  const key1 = 'acc-request-0001';
  const rq = await api('POST', AG, R({ idempotencyKey: key1 }), admin2);
  const up = lastPost(/access-grants$/);
  check('درخواست ⇒ پیش‌فرضِ ۶۰ دقیقه، ‎read_private‎، ‎consent: tenant‎؛ منتظرِ پذیرشِ دکان', rq.status === 200 && rq.json?.grant?.status === 'pending'
    && up?.body?.minutes === 60 && up.body.scope === 'read_private' && up.body.consent === 'tenant' && up.body.reason === 'تیکتِ ۴۵ — صورت‌حساب', `${rq.text.slice(0, 160)} ${JSON.stringify(up?.body)}`);
  const rq2 = await api('POST', AG, R({ idempotencyKey: key1 }), admin2);
  check('⛔ همان کلید ⇒ همان پاسخ، درخواستِ دوم نه', rq2.json?.grant?.id === rq.json?.grant?.id && posts(/access-grants$/) === n0 + 1, `${posts(/access-grants$/) - n0}`);
  const max = await api('POST', AG, R({ minutes: 1440, scope: 'export', ticketId: 'T-45' }), owner);
  check('سقفِ دقیقِ ۲۴ ساعت و دامنهٔ «خروجی» پذیرفته', max.status === 200 && lastPost(/access-grants$/)?.body?.minutes === 1440 && lastPost(/access-grants$/).body.scope === 'export' && lastPost(/access-grants$/).body.ticket_id === 'T-45', max.text.slice(0, 160));

  console.log('\n── «شکستنِ شیشه» (ACP-D2) ──');
  const b0 = posts(/break-glass$/);
  const bg2 = await api('POST', `${AG}/break-glass`, R({ reason: 'خرابیِ فوری در همگام‌سازی', password: 'Acc-admin-1405' }), admin2);
  check('⛔ مدیرِ دوم با رمزِ درستِ خودش هم نه — ‎403 owner_only‎ پیش از رمز', bg2.status === 403 && bg2.json?.error === 'owner_only' && posts(/break-glass$/) === b0, bg2.text.slice(0, 160));
  //  نشستِ مالک را کهنه می‌کنیم (بیش از ده دقیقه از رمز) — همان قاعدهٔ احرازِ دوبارهٔ پنل (S7): نشستِ تازه یا رمزِ همان درخواست
  { const db = new DatabaseSync(path.join(tmp, 'data', 'panel.db')); db.exec('UPDATE sessions SET auth_at = 1'); db.close(); }
  const noPw = await api('POST', `${AG}/break-glass`, R({ reason: 'خرابیِ فوری در همگام‌سازی' }), owner);
  const badPw = await api('POST', `${AG}/break-glass`, R({ reason: 'خرابیِ فوری در همگام‌سازی', password: 'wrong-password' }), owner);
  check('⛔ مالکِ با نشستِ کهنه و بی رمز ⇒ ‎reauth_required‎، رمزِ غلط ⇒ ‎reauth_failed‎؛ هیچ درخواستی', noPw.status === 403 && noPw.json?.error === 'reauth_required' && badPw.status === 403 && badPw.json?.error === 'reauth_failed' && posts(/break-glass$/) === b0,
    `${noPw.json?.error} ${badPw.json?.error}`);
  const shortWhy = await api('POST', `${AG}/break-glass`, R({ reason: 'فوری', password: 'Acc-1405-owner' }), owner);
  check('⛔ دلیلِ کمتر از ۱۰ نویسه ⇒ ۴۰۰', shortWhy.status === 400 && shortWhy.json?.error === 'reason_required' && posts(/break-glass$/) === b0, shortWhy.text.slice(0, 160));
  const bg = await api('POST', `${AG}/break-glass`, R({ reason: 'خرابیِ فوری در همگام‌سازی', minutes: 30, password: 'Acc-1405-owner' }), owner);
  const bgUp = lastPost(/break-glass$/);
  check('مالک + رمز + دلیل ⇒ ‎consent: break_glass‎، ‎notify_owner: true‎، و «خبر رفت» همان که سرورِ حساب گفت', bg.status === 200 && bg.json?.notified === true && bg.json.grant?.consent === 'break_glass'
    && bgUp?.body?.consent === 'break_glass' && bgUp.body.notify_owner === true && bgUp.body.minutes === 30 && !('password' in (bgUp.body || {})), `${bg.text.slice(0, 200)} ${JSON.stringify(bgUp?.body)}`);
  notifyOk = false;
  const bgN = await api('POST', `${AG}/break-glass`, R({ reason: 'خرابیِ فوری در همگام‌سازی ۲', password: 'Acc-1405-owner' }), owner);
  notifyOk = true;
  check('سرورِ حساب نگفت خبر رفت ⇒ ‎notified: false‎ (رابط «معلوم نیست» می‌گوید)، نه «رفت» ِ دروغ', bgN.status === 200 && bgN.json?.notified === false, bgN.text.slice(0, 160));

  console.log('\n── لغو ──');
  const gid = rq.json?.grant?.id;
  const opR = await api('POST', `${AG}/${gid}/revoke`, R(), op);
  const rvBad = await api('POST', `${AG}/bad id/revoke`, R(), owner);
  check('⛔ operator لغو نمی‌کند؛ شناسهٔ نادرست ⇒ ۴۰۰', opR.status === 403 && (rvBad.status === 400 || rvBad.status === 404), `${opR.status} ${rvBad.status}`);
  const rv = await api('POST', `${AG}/${gid}/revoke`, R({ reason: 'کار تمام شد' }), admin2);
  check('admin لغو می‌کند ⇒ ‎revoked‎', rv.status === 200 && rv.json?.grant?.status === 'revoked' && lastPost(/revoke$/)?.body?.reason === 'کار تمام شد', rv.text.slice(0, 160));

  const aud = await api('GET', '/api/control/audit?q=account.support_access&limit=50&offset=0', undefined, owner);
  const acts = (aud.json?.rows || []).map((r) => r.action);
  check('دفترِ پنل: درخواست‌ها، شکستنِ شیشه‌ها، لغو و ردِ مدیرِ دوم — بازپخشِ همان کلید نه',
    acts.filter((a) => a === 'account.support_access.requested').length === 2 && acts.filter((a) => a === 'account.support_access.break_glass').length === 2
    && acts.includes('account.support_access.revoked') && acts.includes('account.support_access.denied') && acts.includes('account.support_access.reauth_failed'), acts.join(' '));
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  server.kill('SIGTERM');
  fake.close();
  await sleep(300);
  await fsp.rm(tmp, { recursive: true, force: true });
}
if (fail) console.log('\n' + out.slice(-1500));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
