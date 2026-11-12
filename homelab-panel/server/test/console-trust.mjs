// ---------------------------------------------------------------------------
//  ABUSE-01 در پل — صفِ گزارش و شکایت، مسئول، تصمیم، رأیِ اعتراض و برداشتنِ جریمه (۱.۵۰.۹۷)
//      node test/console-trust.mjs
//
//  سرورِ حسابِ ساختگی به شکلِ ‎routes/admin-trust.js‎ + ‎lib/market-trust.js‎ ِ shop (همه «فقط ارشد»؛ ماشینِ وضعیت:
//  ‎open ⇒ in_review ⇒ decided ⇒ appealed ⇒ closed‎؛ تصمیمِ دوم ‎409 already_decided‎، جریمهٔ برداشته ‎409 already_lifted‎،
//  رأی بی اعتراض ‎409 no_pending_appeal‎؛ «مسئول» = ‎req.admin.id‎ که از راهِ پل شناسهٔ کلیدِ سرویس است).
//  سنجیده می‌شود: ۴۰۳ ِ viewer و operator روی هر هفت در بی درخواست به سرورِ حساب؛ پالایشِ صف (وضعیت/دکان/تعداد) همان‌طور
//  به بالادست و پالایشِ بد ۴۰۰ پیش از پل؛ ‎no-store‎؛ تأیید/دلیل/کلید پیش از پل؛ همان کلید ⇒ همان پاسخ با ‎replayed‎ و بی درخواست و
//  ردیفِ دوم؛ همان کلید برای کارِ دیگر ⇒ ۴۰۹؛ همان پرونده هم‌زمان ⇒ ‎409 action_in_progress‎؛ «نامعلوم» با همان کلید کارِ دوم
//  نمی‌سازد؛ ۴۰۹ های ماشینِ وضعیت همان‌طور؛ «مسئول» به نامِ کاربرِ پنل فقط وقتی همان مسئولِ امروزِ سرورِ حساب است؛
//  ردیفِ دفتر برای هر کارِ تأییدشده (بی کلید و رمز)؛ سقفِ نرخِ هر کاربر.
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PANEL = Number(process.env.TEST_PORT || 4943);
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-trust-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 400)}`);
};

/* ───────────── سرورِ حسابِ ساختگی (شکلِ admin-trust.js) ───────────── */
const NOW = Date.now();
const KEY_ID = 'svk_bridge01';          //  ‎req.admin.id‎ ِ درخواستِ کلیدِ سرویس
const seen = [];
const held = new Set();
let hangNext = false;                   //  کار انجام می‌شود، پاسخ گم می‌شود
let slow = 0;                           //  تأخیرِ پاسخِ نوشتن (هم‌زمانی)
let caps = ['actor.v1'];                //  + ‎trust-read.v1‎ (shop ‎claude/e-rows-25s‎) ⇒ خواندن برای operator/viewer
const mk = (id, status, extra = {}) => ({
  id, shopId: 'shpA', shopName: 'دکانِ کریم', kind: 'report', subject: 'product', orderNo: null, productId: 'rice', category: 'counterfeit',
  status, createdAt: NOW - 9000, updatedAt: NOW - 9000, severity: 'high', assignee: '', outcome: null, appealOutcome: null,
  flags: [], duplicateOf: null, evidenceCount: 1, ...extra,
});
const cases = {
  tc_1: mk('tc_1', 'open'),
  tc_2: mk('tc_2', 'open'),
  tc_3: mk('tc_3', 'open'),
  tc_4: mk('tc_4', 'appealed', { outcome: 'upheld' }),
  tc_5: mk('tc_5', 'open', { shopId: 'shpB' }),
  tc_9: mk('tc_9', 'closed', { outcome: 'upheld', appealOutcome: 'upheld', assignee: 'panel:3', assigneeName: 'علی' }),
};
//  پروندهٔ کاملِ «ارشد» (همان شکلِ ‎adminView‎ ِ shop) — برای سنجشِ نمای کم‌ترِ پنل
const FULL9 = { reporterHint: '+937•••201', reporterStats: { total: 3, upheld: 1, dismissed: 0, shops: 2 }, sameText: ['tc_8'],
  evidence: [{ id: 'tev_secret', mime: 'image/jpeg', size: 10, createdAt: NOW }],
  decision: { outcome: 'upheld', reason: 'ثابت شد', by: 'adm_root', at: NOW }, appeal: { body: 'فرستادیم', by: 'usr_shop_9', at: NOW, outcome: 'upheld',
    reason: 'می‌ماند', decidedBy: 'adm_root', decidedAt: NOW },
  sanctions: [{ id: 'tsn_9', kind: 'warning', reason: 'ثابت شد', createdAt: NOW, active: true, liftedAt: null, liftReason: '', shopId: 'shpA', createdBy: 'adm_root', liftedBy: '' }],
  history: [{ type: 'shop_response', at: NOW, actor: 'shop', actorId: 'usr_shop_9', body: 'پاسخ', data: {} },
    { type: 'assigned', at: NOW, actor: 'admin', actorId: 'panel:3', body: '', data: { assignee: 'panel:3' } }] };
const sanctions = {
  tsn_1: { id: 'tsn_1', caseId: 'tc_4', shopId: 'shpA', kind: 'hide_listing', productId: 'rice', reason: 'تقلبی', createdAt: NOW - 5000, active: true, liftedAt: null },
};
const history = [];

const fake = http.createServer((req, res) => {
  held.add(res);
  res.on('close', () => held.delete(res));
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    let body = null;
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null; } catch { body = null; }
    const j = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const later = (code, obj) => (hangNext ? (hangNext = false, undefined) : slow ? setTimeout(() => j(code, obj), slow) : j(code, obj));
    if (p === '/api/health') return j(200, { ok: true, version: '9.9.9' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: caps, serverTime: NOW });
    seen.push({ method: req.method, path: p, query: Object.fromEntries(u.searchParams), body, idem: String(req.headers['idempotency-key'] || '') });
    if (p === '/api/admin/trust/cases' && req.method === 'GET') {
      const st = u.searchParams.get('status') || 'pending';
      const shop = u.searchParams.get('shopId') || '';
      const list = Object.values(cases).filter((c) => (st === 'all' || (st === 'pending' ? ['open', 'in_review', 'appealed'].includes(c.status) : c.status === st))
        && (!shop || c.shopId === shop));
      return j(200, { cases: list.slice(0, Number(u.searchParams.get('limit') || 50)) });
    }
    const m = /^\/api\/admin\/trust\/cases\/([^/]+)(?:\/(assign|decide|appeal-decision))?$/.exec(p);
    if (m) {
      const c = cases[m[1]];
      if (!c) return j(404, { error: { code: 'not_found', message: 'پرونده پیدا نشد' } });
      if (!m[2] && c.id === 'tc_9') return j(200, { case: { ...c, body: 'متنِ شاکی', ...FULL9 } });
      if (!m[2]) {
        return j(200, { case: { ...c, body: 'کالای <b>تقلبی</b>', reporterHint: '07•••12', reporterStats: { total: 1, upheld: 0, dismissed: 0, shops: 1 },
          sameText: [], decision: null, appeal: null, evidence: [], sanctions: [], history: history.filter((h) => h.caseId === c.id) } });
      }
      if (m[2] === 'assign') {
        if (!['open', 'in_review', 'appealed'].includes(c.status)) return j(409, { error: { code: 'case_decided', message: 'این پرونده رسیدگی‌شده است' } });
        if (c.status === 'open') c.status = 'in_review';
        c.assignee = KEY_ID;
        return later(200, { id: c.id, shopId: c.shopId, status: c.status, assignee: KEY_ID });
      }
      if (m[2] === 'decide') {
        if (String(body?.reason || '').trim().length < 3) return j(400, { error: { code: 'reason_required', message: 'دلیل' } });
        if (c.status !== 'open' && c.status !== 'in_review') return j(409, { error: { code: 'already_decided', message: 'این پرونده پیش‌تر تصمیم گرفته است' } });
        Object.assign(c, { status: 'decided', outcome: body.outcome, assignee: c.assignee || KEY_ID });
        let sanction = null;
        if (body.sanction) {
          sanction = { id: `tsn_${c.id}`, kind: body.sanction.kind, productId: body.sanction.productId || '' };
          sanctions[sanction.id] = { ...sanction, caseId: c.id, shopId: c.shopId, reason: body.reason, createdAt: Date.now(), active: true, liftedAt: null };
        }
        history.push({ caseId: c.id, type: 'decided', at: Date.now(), actor: 'admin', body: body.reason, data: { outcome: body.outcome } });
        return later(200, { id: c.id, shopId: c.shopId, outcome: body.outcome, sanction });
      }
      if (c.status !== 'appealed') return j(409, { error: { code: 'no_pending_appeal', message: 'این پرونده اعتراضِ در انتظار ندارد' } });
      Object.assign(c, { status: 'closed', appealOutcome: body.outcome });
      const lifted = body.outcome === 'reversed' ? Object.values(sanctions).filter((s) => s.caseId === c.id && s.active).map((s) => {
        Object.assign(s, { active: false, liftedAt: Date.now(), liftReason: body.reason });
        return s.id;
      }) : [];
      return later(200, { id: c.id, shopId: c.shopId, outcome: body.outcome, lifted });
    }
    if (p === '/api/admin/trust/sanctions' && req.method === 'GET') {
      const shop = u.searchParams.get('shopId') || '';
      const act = u.searchParams.get('active') === '1';
      return j(200, { sanctions: Object.values(sanctions).filter((s) => (!shop || s.shopId === shop) && (!act || s.active))
        .map((s) => ({ ...s, createdBy: 'adm_root', liftedBy: s.active ? '' : 'adm_root' })) });
    }
    const sm = /^\/api\/admin\/trust\/sanctions\/([^/]+)\/lift$/.exec(p);
    if (sm && req.method === 'POST') {
      const s = sanctions[sm[1]];
      if (!s) return j(404, { error: { code: 'sanction_not_found', message: 'این جریمه پیدا نشد' } });
      if (!s.active) return j(409, { error: { code: 'already_lifted', message: 'این جریمه پیش‌تر برداشته شده است' } });
      Object.assign(s, { active: false, liftedAt: Date.now(), liftReason: body?.reason || '' });
      return later(200, { id: s.id, shopId: s.shopId, caseId: s.caseId, kind: s.kind });
    }
    return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

/* ───────────── پنلِ واقعی ───────────── */
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  cwd: path.join(import.meta.dirname, '..'),
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_SITESYNC: '0',
         HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_AUTOMATION: '0', HLP_STATIONS: '0',
         HLP_ACCOUNT_API: `http://127.0.0.1:${fake.address().port}`, HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret',
         HLP_BRIDGE_TIMEOUT_MS: '800', HLP_AUTH_RATE_LIMIT: '100000', HLP_TG_WATCH_MS: '0', HLP_TG_LONGPOLL: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const BASE = `http://127.0.0.1:${PANEL}`;
async function api(method, p, body, token) {
  const res = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text, headers: res.headers };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const C = '/api/account-admin/console/market/trust';
const ups = (re) => seen.filter((s) => re.test(s.path));
const writes = () => seen.filter((s) => s.method === 'POST');
const ledger = async (tok) => ((await api('GET', '/api/control/audit?q=account.market&limit=200&offset=0', undefined, tok)).json?.rows || [])
  .filter((r) => /^account\.market\.(case_assigned|case_decided|appeal_decided|sanction_lifted)$/.test(r.action));

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await sleep(250);
  }
  await api('POST', '/api/auth/setup', { username: 'owner', password: 'Trust-1405-owner' });
  const login = async (u, pw) => (await api('POST', '/api/auth/login', { username: u, password: pw })).json?.token;
  const owner = await login('owner', 'Trust-1405-owner');
  for (const [u, role] of [['adm1', 'admin'], ['adm2', 'admin'], ['op1', 'operator'], ['view1', 'viewer']]) {
    await api('POST', '/api/auth/users', { username: u, password: `Trust-${role}-1405-${u}`, role }, owner);
  }
  const T = { owner, adm: await login('adm1', 'Trust-admin-1405-adm1'), adm2: await login('adm2', 'Trust-admin-1405-adm2'),
    op: await login('op1', 'Trust-operator-1405-op1'), view: await login('view1', 'Trust-viewer-1405-view1') };
  check('پنج نشست', Object.values(T).every(Boolean));
  const PW = { adm: 'Trust-admin-1405-adm1', adm2: 'Trust-admin-1405-adm2' };
  const decide = (k, extra = {}) => ({ outcome: 'upheld', severity: 'high', sanction: { kind: 'hide_listing', productId: 'rice' }, reason: 'کالای تقلبی',
    confirm: true, password: PW.adm, idempotencyKey: `trust-dec-${k}-0001`, ...extra });

  console.log('\n── ۱) نقش: هر هفت در فقط admin؛ ۴۰۳ پیش از هر درخواست به سرورِ حساب ──');
  const doors = [
    ['GET', `${C}/cases`], ['GET', `${C}/cases/tc_1`], ['GET', `${C}/sanctions`],
    ['POST', `${C}/cases/tc_1/assign`, { confirm: true, idempotencyKey: 'trust-role-0001' }],
    ['POST', `${C}/cases/tc_1/decide`, decide('role', { password: 'x' })],
    ['POST', `${C}/cases/tc_4/appeal-decision`, { outcome: 'upheld', reason: 'آزمونِ نقش', confirm: true, password: 'x', idempotencyKey: 'trust-role-0002' }],
    ['POST', `${C}/sanctions/tsn_1/lift`, { reason: 'آزمونِ نقش', confirm: true, password: 'x', idempotencyKey: 'trust-role-0003' }],
  ];
  for (const [who, tok] of [['viewer', T.view], ['operator', T.op]]) {
    const n = seen.length;
    const codes = [];
    for (const [m, p, b] of doors) codes.push((await api(m, p, b, tok)).status);
    check(`⛔ ${who}: هر هفت در ۴۰۳ و هیچ درخواستی به سرورِ حساب`, codes.every((c) => c === 403) && seen.length === n, `${codes.join(' ')} · ${seen.slice(n).map((s) => s.path)}`);
  }
  const anon = await api('GET', `${C}/cases`);
  check('بی نشست ⇒ ۴۰۱', anon.status === 401);

  console.log('\n── ۱ب) ‎trust-read.v1‎ (shop ‎claude/e-rows-25s‎): operator و viewer می‌خوانند، نمای کم‌تر؛ نوشتن همچنان فقط admin ──');
  const nb = seen.length;
  const noCap = await api('GET', `${C}/cases/tc_9`, undefined, T.view);
  check('بی ‎trust-read.v1‎ ⇒ viewer ۴۰۳ با نامِ توانایی و هیچ درِ پرونده‌ای پرسیده نشد', noCap.status === 403 && noCap.json?.capability === 'trust-read.v1'
    && seen.length === nb, `${noCap.status} ${noCap.text.slice(0, 160)}`);
  caps = ['actor.v1', 'trust-read.v1'];
  const SECRET = ['reporterHint', 'reporterStats', 'sameText', 'evidence'];
  const less = (c) => c && SECRET.every((k) => !(k in c)) && !('by' in (c.decision || {})) && !('by' in (c.appeal || {})) && !('decidedBy' in (c.appeal || {}))
    && (c.sanctions || []).every((x) => !('createdBy' in x) && !('liftedBy' in x)) && (c.history || []).every((e) => !('actorId' in e) && !('assignee' in (e.data || {})))
    && !JSON.stringify(c).includes('usr_shop_9') && !JSON.stringify(c).includes('adm_root') && !JSON.stringify(c).includes('+937');
  for (const [who, tok] of [['viewer', T.view], ['operator', T.op]]) {
    const q0 = await api('GET', `${C}/cases?status=all`, undefined, tok);
    const v9 = await api('GET', `${C}/cases/tc_9`, undefined, tok);
    const sv = await api('GET', `${C}/sanctions`, undefined, tok);
    check(`${who} با ‎trust-read.v1‎: صف، پرونده و جریمه‌ها ۲۰۰ — پنل خودش هم نمای کم‌تر می‌بُرد (راهِ پیشینِ پل نمای کامل می‌گیرد)`,
      q0.status === 200 && v9.status === 200 && less(v9.json?.case) && v9.json.case.body === 'متنِ شاکی' && v9.json.case.assignee === 'panel:3'
        && v9.json.case.assigneeName === 'علی' && v9.json.case.history.length === 2 && sv.status === 200 && sv.json.sanctions.length >= 1
        && sv.json.sanctions.every((x) => !('createdBy' in x) && !('liftedBy' in x)), `${q0.status} ${v9.status} ${v9.text.slice(0, 300)}`);
    const n2 = seen.length;
    const codes = [];
    for (const [m, p, b] of doors.slice(3)) codes.push((await api(m, p, b, tok)).status);
    check(`⛔ ${who} با ‎trust-read.v1‎ هم هیچ نوشتنی ندارد (۴۰۳، هیچ درخواست)`, codes.every((c) => c === 403) && seen.length === n2, codes.join(' '));
  }
  const a9 = await api('GET', `${C}/cases/tc_9`, undefined, T.adm);
  check('admin ِ پنل همان نمای کامل', SECRET.every((k) => k in (a9.json?.case || {})) && a9.json.case.decision.by === 'adm_root'
    && a9.json.case.history.every((e) => 'actorId' in e), a9.text.slice(0, 200));
  caps = ['actor.v1'];

  console.log('\n── ۲) صف و پالایش ──');
  const q1 = await api('GET', `${C}/cases?status=in_review&shopId=shpA&limit=20`, undefined, T.adm);
  const u1 = ups(/\/trust\/cases$/).at(-1);
  check('admin: پالایشِ وضعیت، دکان و تعداد همان‌طور به بالادست؛ ‎fetchedAt‎ و ‎no-store‎',
    q1.status === 200 && JSON.stringify(u1?.query) === JSON.stringify({ status: 'in_review', shopId: 'shpA', limit: '20' }) && typeof q1.json?.fetchedAt === 'number'
      && /no-store/.test(q1.headers.get('cache-control') || ''), `${q1.status} ${JSON.stringify(u1?.query)} ${q1.headers.get('cache-control')}`);
  const nq = seen.length;
  const badQ = [];
  for (const qs of ['status=maybe', 'shopId=bad%20id', 'limit=0', 'limit=201', 'limit=x']) badQ.push(await api('GET', `${C}/cases?${qs}`, undefined, T.adm));
  const badS = await api('GET', `${C}/sanctions?limit=501`, undefined, T.adm);
  const badId = await api('GET', `${C}/cases/${encodeURIComponent('tc_1/../x')}`, undefined, T.adm);
  check('⛔ پالایشِ بد (وضعیتِ ناشناخته، شناسهٔ دکان، تعداد) و شناسهٔ پروندهٔ بد ⇒ ۴۰۰ پیش از پل',
    badQ.every((r) => r.status === 400) && badS.status === 400 && badId.status === 400 && seen.length === nq,
    badQ.map((r) => `${r.status}/${r.json?.error}`).join(' ') + ` ${badS.status} ${badId.status}`);
  const d1 = await api('GET', `${C}/cases/tc_1`, undefined, T.adm);
  check('جزئیات: همان پروندهٔ سرورِ حساب، ‎no-store‎', d1.status === 200 && d1.json?.case?.id === 'tc_1' && d1.json.case.body === 'کالای <b>تقلبی</b>'
    && /no-store/.test(d1.headers.get('cache-control') || ''), d1.text.slice(0, 200));
  const d404 = await api('GET', `${C}/cases/tc_77`, undefined, T.adm);
  check('پروندهٔ ناموجود ⇒ ‎404 not_found‎ ِ سرورِ حساب همان‌طور', d404.status === 404 && d404.json?.error === 'not_found', `${d404.status} ${d404.json?.error}`);
  const s1 = await api('GET', `${C}/sanctions?active=1&shopId=shpA`, undefined, T.adm);
  check('جریمه‌ها: «فقط فعال» و دکان همان‌طور به بالادست', s1.status === 200 && s1.json?.sanctions?.length === 1
    && JSON.stringify(ups(/\/trust\/sanctions$/).at(-1)?.query) === JSON.stringify({ shopId: 'shpA', active: '1' }), s1.text.slice(0, 200));

  console.log('\n── ۳) مسئول: تأیید و کلید پیش از پل، یک بار، نامِ کاربرِ پنل ──');
  let nw = writes().length;
  const a0 = await api('POST', `${C}/cases/tc_1/assign`, { idempotencyKey: 'trust-asg-0001' }, T.adm);
  const a00 = await api('POST', `${C}/cases/tc_1/assign`, { confirm: true }, T.adm);
  const a01 = await api('POST', `${C}/cases/tc_1/assign`, { confirm: true, idempotencyKey: 'bad key!' }, T.adm);
  check('⛔ بی تأیید / بی کلید / کلیدِ بد ⇒ ۴۰۰ با کدِ خودش، بی درخواست به سرورِ حساب',
    a0.json?.error === 'confirm_required' && a00.json?.error === 'idempotency_key_required' && a01.json?.error === 'bad_idempotency_key' && writes().length === nw,
    `${a0.json?.error} ${a00.json?.error} ${a01.json?.error}`);
  const a1 = await api('POST', `${C}/cases/tc_1/assign`, { confirm: true, idempotencyKey: 'trust-asg-0001' }, T.adm);
  const a2 = await api('POST', `${C}/cases/tc_1/assign`, { confirm: true, idempotencyKey: 'trust-asg-0001' }, T.adm);
  check('«مسئولش من» ⇒ ۲۰۰ از سرورِ حساب (بالادست فقط ‎{}‎)؛ همان کلید ⇒ همان پاسخ با ‎replayed‎ و بی درخواستِ دوم',
    a1.status === 200 && a1.json?.status === 'in_review' && a2.status === 200 && a2.json?.replayed === true && writes().length === nw + 1
      && JSON.stringify(writes().at(-1).body) === '{}', `${a1.status} ${a2.status} ${a2.text.slice(0, 120)} ${writes().length - nw}`);
  const ru = await api('POST', `${C}/cases/tc_2/assign`, { confirm: true, idempotencyKey: 'trust-asg-0001' }, T.adm);
  check('⛔ همان کلید برای پروندهٔ دیگر ⇒ ‎409 idempotency_key_reused‎', ru.status === 409 && ru.json?.error === 'idempotency_key_reused' && writes().length === nw + 1,
    `${ru.status} ${ru.json?.error}`);
  let q = await api('GET', `${C}/cases?status=all`, undefined, T.adm);
  const row = (id) => q.json?.cases?.find((c) => c.id === id);
  check('صف: مسئولِ سرورِ حساب همان شناسهٔ کلید است و پنل نامِ کاربرِ خودش را کنارش می‌گذارد (‎panelAssignee‎)؛ بقیه بی',
    row('tc_1')?.assignee === KEY_ID && row('tc_1')?.panelAssignee?.by === 'adm1' && typeof row('tc_1')?.panelAssignee?.at === 'number'
      && row('tc_2')?.panelAssignee === undefined, JSON.stringify(row('tc_1')));
  await api('POST', `${C}/cases/tc_1/assign`, { confirm: true, idempotencyKey: 'trust-asg-0002' }, T.adm2);
  q = await api('GET', `${C}/cases?status=all`, undefined, T.adm);
  const dd = await api('GET', `${C}/cases/tc_1`, undefined, T.adm);
  check('کاربرِ دیگر برداشت ⇒ نامِ همان (در صف و جزئیات)', row('tc_1')?.panelAssignee?.by === 'adm2' && dd.json?.case?.panelAssignee?.by === 'adm2',
    `${JSON.stringify(row('tc_1')?.panelAssignee)} ${JSON.stringify(dd.json?.case?.panelAssignee)}`);
  cases.tc_1.assignee = 'adm_direct';          //  کسی در کنسولِ خودِ سرورِ حساب برداشت
  q = await api('GET', `${C}/cases?status=all`, undefined, T.adm);
  check('⛔ مسئولِ دیگری در خودِ سرورِ حساب ⇒ نامِ کهنهٔ پنل نمی‌آید؛ فقط شناسهٔ سرورِ حساب', row('tc_1')?.assignee === 'adm_direct' && row('tc_1')?.panelAssignee === undefined,
    JSON.stringify(row('tc_1')));

  console.log('\n── ۴) تصمیم: یک بار، ماشینِ وضعیت، هم‌زمانی، نامعلوم ──');
  nw = writes().length;
  const dk = await api('POST', `${C}/cases/tc_1/decide`, decide('x', { idempotencyKey: undefined }), T.adm);
  check('⛔ تصمیم بی کلید ⇒ ‎400 idempotency_key_required‎ بی درخواست', dk.status === 400 && dk.json?.error === 'idempotency_key_required' && writes().length === nw, `${dk.status} ${dk.json?.error}`);
  const r1 = await api('POST', `${C}/cases/tc_1/decide`, decide('d1'), T.adm);
  const up1 = writes().at(-1);
  const r2 = await api('POST', `${C}/cases/tc_1/decide`, decide('d1'), T.adm);
  check('تصمیم ⇒ ۲۰۰ با جریمه؛ بالادست فقط ‎outcome, reason, sanction, severity‎ (بی رمز، تأیید و کلید)؛ همان کلید ⇒ ‎replayed‎ بی درخواستِ دوم',
    r1.status === 200 && r1.json?.sanction?.id === 'tsn_tc_1' && Object.keys(up1?.body || {}).sort().join() === 'outcome,reason,sanction,severity'
      && r2.status === 200 && r2.json?.replayed === true && writes().length === nw + 1, `${r1.status} ${JSON.stringify(up1?.body)} ${r2.text.slice(0, 120)}`);
  const r3 = await api('POST', `${C}/cases/tc_1/decide`, decide('d2'), T.adm);
  check('⛔ کلیدِ تازه روی پروندهٔ تصمیم‌شده ⇒ ‎409 already_decided‎ ِ سرورِ حساب (ماشینِ وضعیت، نه کارِ دوم)', r3.status === 409 && r3.json?.error === 'already_decided',
    `${r3.status} ${r3.json?.error}`);
  const r4 = await api('POST', `${C}/cases/tc_2/decide`, decide('d1'), T.adm);
  check('⛔ همان کلید برای پروندهٔ دیگر ⇒ ‎409 idempotency_key_reused‎', r4.status === 409 && r4.json?.error === 'idempotency_key_reused', `${r4.status} ${r4.json?.error}`);
  const r5 = await api('POST', `${C}/cases/tc_2/decide`, decide('d1', { password: PW.adm2 }), T.adm2);
  check('همان کلیدِ رابط از کاربرِ دیگرِ پنل ⇒ کارِ خودِ او، نه بازپخشِ پاسخِ کسِ دیگر (یادِ کلید بسته به کاربر)',
    r5.status === 200 && r5.json?.replayed !== true && r5.json?.id === 'tc_2' && cases.tc_2.status === 'decided', `${r5.status} ${r5.text.slice(0, 160)}`);

  slow = 400;
  nw = writes().length;
  const [c1, c2] = await Promise.all([
    api('POST', `${C}/cases/tc_5/decide`, decide('c1', { outcome: 'dismissed', sanction: undefined }), T.adm),
    (async () => { await sleep(60); return api('POST', `${C}/cases/tc_5/decide`, decide('c2', { outcome: 'dismissed', sanction: undefined }), T.adm); })(),
  ]);
  slow = 0;
  check('⛔ همان پرونده هم‌زمان از دو پنجره ⇒ یکی ۲۰۰ و دیگری ‎409 action_in_progress‎؛ یک درخواست به سرورِ حساب',
    c1.status === 200 && c2.status === 409 && c2.json?.error === 'action_in_progress' && writes().length === nw + 1, `${c1.status} ${c2.status} ${c2.json?.error}`);

  hangNext = true;
  nw = writes().length;
  const h1 = await api('POST', `${C}/cases/tc_3/decide`, decide('h1', { outcome: 'dismissed', sanction: undefined }), T.adm);
  const h2 = await api('POST', `${C}/cases/tc_3/decide`, decide('h1', { outcome: 'dismissed', sanction: undefined }), T.adm);
  check('پاسخِ گم‌شده ⇒ ‎504 outcome_unknown‎؛ همان کلید ⇒ باز «نامعلوم» و **بی** درخواستِ دوم (کار یک بار انجام شد)',
    h1.status === 504 && h1.json?.outcome === 'unknown' && h2.status === 504 && h2.json?.outcome === 'unknown' && writes().length === nw + 1 && cases.tc_3.status === 'decided',
    `${h1.status} ${h2.status} ${writes().length - nw}`);
  const h3 = await api('GET', `${C}/cases/tc_3`, undefined, T.adm);
  check('خواندنِ دوبارهٔ پرونده (کارِ رابط پس از «نامعلوم») ⇒ «تصمیم گرفته شد»', h3.json?.case?.status === 'decided', h3.text.slice(0, 120));

  console.log('\n── ۵) رأیِ اعتراض و برداشتنِ جریمه ──');
  const ap0 = await api('POST', `${C}/cases/tc_2/appeal-decision`, { outcome: 'reversed', reason: 'مدرکِ تازه', confirm: true, password: PW.adm, idempotencyKey: 'trust-app-0000' }, T.adm);
  check('رأی بر پروندهٔ بی اعتراض ⇒ ‎409 no_pending_appeal‎ همان‌طور', ap0.status === 409 && ap0.json?.error === 'no_pending_appeal', `${ap0.status} ${ap0.json?.error}`);
  const apb = await api('POST', `${C}/cases/tc_4/appeal-decision`, { outcome: 'maybe', reason: 'مدرکِ تازه', confirm: true, password: PW.adm, idempotencyKey: 'trust-app-0009' }, T.adm);
  check('رأیِ ناشناخته ⇒ ۴۰۰ پیش از پل', apb.status === 400);
  nw = writes().length;
  const ap1 = await api('POST', `${C}/cases/tc_4/appeal-decision`, { outcome: 'reversed', reason: 'مدرکِ تازه', confirm: true, password: PW.adm, idempotencyKey: 'trust-app-0001' }, T.adm);
  const ap2 = await api('POST', `${C}/cases/tc_4/appeal-decision`, { outcome: 'reversed', reason: 'مدرکِ تازه', confirm: true, password: PW.adm, idempotencyKey: 'trust-app-0001' }, T.adm);
  check('«برگشت» ⇒ جریمه‌های همان پرونده برداشته؛ همان کلید ⇒ ‎replayed‎ بی درخواستِ دوم', ap1.status === 200 && JSON.stringify(ap1.json?.lifted) === '["tsn_1"]'
    && ap2.json?.replayed === true && writes().length === nw + 1 && JSON.stringify(writes().at(-1).body) === JSON.stringify({ outcome: 'reversed', reason: 'مدرکِ تازه' }),
    `${ap1.status} ${ap1.text.slice(0, 120)}`);
  nw = writes().length;
  const l1 = await api('POST', `${C}/sanctions/tsn_tc_1/lift`, { reason: 'اشتباه بود', confirm: true, password: PW.adm, idempotencyKey: 'trust-lift-0001' }, T.adm);
  const l2 = await api('POST', `${C}/sanctions/tsn_tc_1/lift`, { reason: 'اشتباه بود', confirm: true, password: PW.adm, idempotencyKey: 'trust-lift-0001' }, T.adm);
  const l3 = await api('POST', `${C}/sanctions/tsn_tc_1/lift`, { reason: 'اشتباه بود', confirm: true, password: PW.adm, idempotencyKey: 'trust-lift-0002' }, T.adm);
  check('برداشتنِ جریمه ⇒ ۲۰۰؛ همان کلید ⇒ ‎replayed‎؛ کلیدِ تازه ⇒ ‎409 already_lifted‎ ِ سرورِ حساب',
    l1.status === 200 && l1.json?.kind === 'hide_listing' && l2.json?.replayed === true && l3.status === 409 && l3.json?.error === 'already_lifted' && writes().length === nw + 2,
    `${l1.status} ${l2.json?.replayed} ${l3.status}/${l3.json?.error}`);
  nw = writes().length;
  const lnp = await api('POST', `${C}/sanctions/tsn_1/lift`, { reason: 'اشتباه بود', confirm: true, password: 'wrong-pass', idempotencyKey: 'trust-lift-0003' }, T.adm);
  check('⛔ رمزِ غلط ⇒ ‎403 reauth_failed‎ و هیچ درخواستی (احرازِ دوباره پیش از کلید و پل)', lnp.status === 403 && lnp.json?.error === 'reauth_failed' && writes().length === nw,
    `${lnp.status} ${lnp.json?.error}`);

  console.log('\n── ۶) دفتر و سقفِ نرخ ──');
  const rows = await ledger(T.owner);
  const by = (a) => rows.filter((r) => r.action === `account.market.${a}`);
  check('دفتر: یک ردیف برای هر کارِ تأییدشده — مسئول ×۲ (adm1، adm2)، تصمیم ×۳ (tc_1، tc_2 ِ adm2، tc_5)، رأی ×۱، برداشتن ×۱؛ بازپخش و ۴۰۹ و «نامعلوم» بی ردیف',
    by('case_assigned').length === 2 && by('case_assigned').some((r) => r.actor === 'adm1') && by('case_assigned').some((r) => r.actor === 'adm2')
      && by('case_decided').length === 3 && by('case_decided').some((r) => r.actor === 'adm2' && r.entity_id === 'tc_2') && by('appeal_decided').length === 1 && by('sanction_lifted').length === 1,
    JSON.stringify(rows.map((r) => [r.action, r.actor, r.entity_id])).slice(0, 500));
  const blob = JSON.stringify(rows);
  check('⛔ نه کلیدِ یکتایی و نه رمز در دفتر؛ دلیل هست', !/trust-(asg|dec|app|lift)-/.test(blob) && !blob.includes(PW.adm) && blob.includes('کالای تقلبی'));

  const before = writes().length;
  const lim = [];
  for (let i = 0; i < 31; i++) lim.push((await api('POST', `${C}/cases/tc_2/assign`, { confirm: false, idempotencyKey: `trust-lim-${i}-0001` }, T.adm2)).status);
  const other = await api('POST', `${C}/cases/tc_2/assign`, { confirm: false, idempotencyKey: 'trust-lim-other-1' }, T.owner);
  check('سقفِ نرخِ نوشتنِ هر کاربر (۳۰ در ده دقیقه، ردِ ۴۰۰ هم): سی‌ویکمین ‎429‎ برای adm2 (با کارهای پیشینش)؛ کاربرِ دیگر جدا؛ بی درخواست',
    lim.includes(429) && lim.at(-1) === 429 && lim.filter((s) => s === 400).length >= 25 && other.status === 400 && writes().length === before,
    `${lim.join(' ')} · ${other.status}`);
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  server.kill('SIGTERM');
  for (const r of held) r.destroy();
  fake.close();
  await sleep(400);
  await fsp.rm(tmp, { recursive: true, force: true });
}

if (fail) console.log('\n' + out.slice(-1500));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
